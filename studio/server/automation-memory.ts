// Memoria de las automatizaciones: what each automation's agents keep from one run to the next, one entry per thing
// (shared/types.ts: notes, pending, done, the runs' summaries). The source of truth is
// projects/<id>/automation-memory/<automation>.json, written only here: the page through the API, the agents through
// tools/memory.py. The studio's index (db.ts) has them in automation_memory, for search and for the agent's queries.
// It stays on this computer, like the runs: it isn't on the sync's allow-list.
//
// An agent doesn't get the whole memory: brief() is what it starts with (the notes, what's pending, what's pinned and
// the last runs). What's done it looks up (check, search) before doing something that could be a repeat, so that
// history can grow without costing anything until it's needed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {MEMORY_KINDS, type AutomationMemory, type MemoryEntry, type MemoryInput, type MemoryKind} from '../shared/types.ts';
import {register, open as openIndex, sync as syncIndex, mtime, norm, row, words, type DB} from './db.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {listProjects, projectDir, rel} from './workspace.ts';

export const MAX_TEXT = 2000;
const MAX_KEY = 200;
export const MAX_ENTRIES = 5000;
const KEEP_RUNS = 300; // run summaries kept (the oldest unpinned ones go)
const LAST_RUNS = 3; // in the brief
const BRIEF_LIMIT = 15_000;
const DIR = 'automation-memory';

export const fileOf = (project: string, automation: string) => path.join(projectDir(project), DIR, `${automation}.json`);
const newId = () => crypto.randomBytes(4).toString('hex');
const sameKey = (a: string, b: string) => norm(a.trim()) === norm(b.trim());

const valid = (e: unknown): e is MemoryEntry => {
  const x = e as MemoryEntry;
  return !!x && typeof x === 'object' && typeof x.id === 'string' && MEMORY_KINDS.includes(x.kind) && typeof x.text === 'string';
};

// strict, before a change: a file that's there but can't be read stops it, so its entries aren't written over.
function load(project: string, automation: string, strict = false): MemoryEntry[] {
  const file = fileOf(project, automation);
  const raw = readJson<{entries?: unknown}>(file);
  if (strict && fs.existsSync(file) && !Array.isArray(raw?.entries)) throw httpError(500, `no se puede leer ${rel(file)}: arréglalo o bórralo`);
  return Array.isArray(raw?.entries) ? raw.entries.filter(valid) : [];
}

function save(project: string, automation: string, entries: MemoryEntry[]) {
  const file = fileOf(project, automation);
  if (entries.length) writeJson(file, {entries});
  else fs.rmSync(file, {force: true});
  reindex(project, automation);
}

/* ───── The index ───── */

const SCHEMA = `
CREATE TABLE automation_memory ( -- Automatizaciones → Memoria: what each automation's agents keep between runs (projects/<project>/automation-memory/<automation>.json)
  project    TEXT NOT NULL,    -- projects.id
  automation TEXT NOT NULL,    -- the automation's id (in projects/<project>/automations.json)
  id         TEXT NOT NULL,
  kind       TEXT NOT NULL,    -- note (a rule or lesson for every run) · pending (where to pick up) · done (already done, not to repeat) · run (the studio's summary of a run)
  text       TEXT NOT NULL,
  key        TEXT,             -- done: what it is (a slug, a topic, a URL), one entry per key
  pinned     INTEGER NOT NULL, -- 1: the agents always see it
  by         TEXT NOT NULL,    -- who wrote it last: agent · creator · studio
  run        TEXT,             -- the run it was written in
  created    INTEGER NOT NULL, -- ms since epoch
  updated    INTEGER NOT NULL,
  closed     INTEGER,          -- pending: when it was resolved, ms (null: still open)
  search     TEXT NOT NULL,    -- internal: key and text, lowercase and without accents, for LIKE
  PRIMARY KEY (project, automation, id)
);
CREATE INDEX automation_memory_of ON automation_memory (project, automation, kind, updated);
`;

// "project/automation" → its file's time when it was indexed, in this database.
const indexed = new Map<string, number>();
let indexedIn: DB | null = null;

function indexFile(d: DB, project: string, automation: string) {
  d.prepare('DELETE FROM automation_memory WHERE project = ? AND automation = ?').run(project, automation);
  const add = d.prepare('INSERT INTO automation_memory (project, automation, id, kind, text, key, pinned, by, run, created, updated, closed, search) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of load(project, automation))
    add.run(...row([project, automation, e.id, e.kind, e.text, e.key, e.pinned ? 1 : 0, e.by, e.run, e.created, e.updated, e.closed, norm([e.key, e.text].filter(Boolean).join('\n'))]));
  const t = mtime(fileOf(project, automation));
  if (t) indexed.set(`${project}/${automation}`, t);
  else indexed.delete(`${project}/${automation}`);
}

function files(dir: string) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {
    return [];
  }
}

function sync(d: DB) {
  if (indexedIn !== d) {
    indexed.clear();
    indexedIn = d;
    d.exec('DELETE FROM automation_memory');
  }
  const seen = new Set<string>();
  for (const {id: project} of listProjects())
    for (const f of files(path.join(projectDir(project), DIR))) {
      const automation = f.slice(0, -'.json'.length);
      seen.add(`${project}/${automation}`);
      if (indexed.get(`${project}/${automation}`) !== mtime(fileOf(project, automation))) indexFile(d, project, automation);
    }
  for (const k of [...indexed.keys()].filter((k) => !seen.has(k))) {
    const [project, automation] = k.split('/');
    indexFile(d, project, automation);
  }
}
register({name: 'automation-memory', schema: SCHEMA, sync});

// After a write: only that file, unless the index hasn't been read yet.
function reindex(project: string, automation: string) {
  try {
    const d = openIndex();
    if (indexedIn !== d) return syncIndex(true);
    d.exec('BEGIN');
    try {
      indexFile(d, project, automation);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    console.error('[memoria] el índice no se pudo actualizar:', e);
  }
}

/* ───── Reading ───── */

const newest = (a: MemoryEntry, b: MemoryEntry) => b.updated - a.updated;
// Newest first; on a tie, the one written last (the file keeps the order they were written in).
export const view = (project: string, automation: string): AutomationMemory => ({entries: load(project, automation).reverse().sort(newest)});

export type SearchQuery = {q?: string; kind?: string; limit?: number};
export function search(project: string, automation: string, {q, kind, limit = 30}: SearchQuery): MemoryEntry[] {
  if (kind && !MEMORY_KINDS.includes(kind as MemoryKind)) throw httpError(400, `el tipo es uno de: ${MEMORY_KINDS.join(', ')}`);
  syncIndex();
  const where = ['project = ?', 'automation = ?'];
  const args: (string | number)[] = [project, automation];
  if (kind) where.push('kind = ?'), args.push(kind);
  for (const w of words(q)) where.push("search LIKE ? ESCAPE '\\'"), args.push(w);
  const n = Math.min(Math.max(1, Math.floor(limit) || 30), 200);
  const rows = openIndex()
    .prepare(`SELECT id, kind, text, key, pinned, by, run, created, updated, closed FROM automation_memory WHERE ${where.join(' AND ')} ORDER BY updated DESC LIMIT ${n}`)
    .all(...args) as Record<string, unknown>[];
  return rows.map((r) => {
    const e: MemoryEntry = {id: String(r.id), kind: r.kind as MemoryKind, text: String(r.text), by: r.by as MemoryEntry['by'], created: Number(r.created), updated: Number(r.updated)};
    if (r.key !== null) e.key = String(r.key);
    if (r.pinned) e.pinned = true;
    if (r.run !== null) e.run = String(r.run);
    if (r.closed !== null) e.closed = Number(r.closed);
    return e;
  });
}

// Whether something is already done: the done entry with that key (case and accents aside), or null.
export const check = (project: string, automation: string, key: string) => {
  if (!key.trim()) throw httpError(400, 'falta la clave');
  return load(project, automation).find((e) => e.kind === 'done' && e.key && sameKey(e.key, key)) ?? null;
};

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('es', {day: 'numeric', month: 'short', year: 'numeric'});
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('es', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
const indent = (s: string) => s.replace(/\n/g, '\n  ');

// What an agent starts with, and what tools/memory.py show prints: everything but the history of what's done.
export function brief(project: string, automation: string, tool = 'memory.py') {
  const all = load(project, automation).reverse(); // the last written first, for ties
  if (!all.length) return 'La memoria está vacía: es la primera ejecución o nadie anotó nada todavía.';
  const notes = all.filter((e) => e.kind === 'note').sort((a, b) => Number(b.by === 'creator') - Number(a.by === 'creator') || newest(a, b));
  const pending = all.filter((e) => e.kind === 'pending' && !e.closed).reverse().sort((a, b) => a.created - b.created);
  const pinned = all.filter((e) => (e.kind === 'done' || e.kind === 'run') && e.pinned).sort(newest);
  const runs = all.filter((e) => e.kind === 'run' && !e.pinned).sort((a, b) => b.created - a.created).slice(0, LAST_RUNS);
  const done = all.filter((e) => e.kind === 'done');
  const out: string[] = [];
  let size = 0;
  const section = (title: string, items: MemoryEntry[], line: (e: MemoryEntry) => string, more: string) => {
    if (!items.length) return;
    out.push(`## ${title} (${items.length})`);
    for (const [i, e] of items.entries()) {
      const l = line(e);
      if (size + l.length > BRIEF_LIMIT) {
        out.push(`- … y ${items.length - i} más: ${more}`);
        break;
      }
      out.push(l);
      size += l.length;
    }
    out.push('');
  };
  section('Notas', notes, (e) => `- [${e.id}]${e.by === 'creator' ? ' (del creador)' : ''} ${indent(e.text)}`, `${tool} search --kind note`);
  section('Pendientes', pending, (e) => `- [${e.id}] (desde el ${fmtDay(e.created)}) ${indent(e.text)}`, `${tool} search --kind pending`);
  section('Fijados', pinned, (e) => `- [${e.id}] ${e.kind === 'run' ? `ejecución del ${fmtWhen(e.created)}: ` : e.key ? `${e.key}: ` : ''}${indent(e.text)}`, `${tool} search`);
  section('Últimas ejecuciones', runs, (e) => `- ${fmtWhen(e.created)}: ${indent(e.text)}`, `${tool} search --kind run`);
  const pinnedDone = pinned.filter((e) => e.kind === 'done').length;
  out.push(
    done.length
      ? `Hechos registrados: ${done.length}${pinnedDone ? ` (${pinnedDone} fijados arriba)` : ''}, el último el ${fmtDay(Math.max(...done.map((e) => e.updated)))}. No van aquí: antes de hacer algo que podría estar repetido, compruébalo con ${tool} check <clave> o ${tool} search <palabras>.`
      : 'Hechos registrados: ninguno todavía.',
  );
  return out.join('\n');
}

/* ───── Writing ───── */

const text = (v: unknown) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || t.length > MAX_TEXT) throw httpError(400, `cada entrada lleva un texto de hasta ${MAX_TEXT} caracteres`);
  return t;
};
const keyOf = (v: unknown) => {
  if (typeof v !== 'string') throw httpError(400, 'la clave es un texto');
  const k = v.trim();
  if (k.length > MAX_KEY) throw httpError(400, `la clave admite hasta ${MAX_KEY} caracteres`);
  return k;
};
const writable = (v: unknown): Exclude<MemoryKind, 'run'> => {
  if (v === 'note' || v === 'pending' || v === 'done') return v;
  throw httpError(400, 'el tipo es note, pending o done (las ejecuciones las anota el studio)');
};

// A done entry whose key is already there updates that one: one entry per key.
export function add(project: string, automation: string, input: MemoryInput, by: MemoryEntry['by'], run?: string): {entry: MemoryEntry; existed: boolean} {
  const kind = writable(input.kind);
  const fields: Partial<MemoryEntry> = {text: text(input.text)};
  if (input.key !== undefined && input.key !== null) {
    if (kind !== 'done') throw httpError(400, 'la clave es solo para los hechos (done)');
    const k = keyOf(input.key);
    if (k) fields.key = k;
  }
  if (input.pinned !== undefined) {
    if (kind !== 'done') throw httpError(400, 'solo se fijan los hechos y las ejecuciones');
    fields.pinned = input.pinned === true;
  }
  const entries = load(project, automation, true);
  const now = Date.now();
  const same = kind === 'done' && fields.key ? entries.find((e) => e.kind === 'done' && e.key && sameKey(e.key, fields.key!)) : undefined;
  if (same) {
    Object.assign(same, fields, {by, updated: now}, run ? {run} : {});
    if (!same.pinned) delete same.pinned;
    save(project, automation, entries);
    return {entry: same, existed: true};
  }
  if (entries.length >= MAX_ENTRIES) throw httpError(409, `la memoria está llena (${MAX_ENTRIES} entradas): borra o resume algunas`);
  const entry: MemoryEntry = {id: newId(), kind, ...fields, text: fields.text!, by, ...(run ? {run} : {}), created: now, updated: now};
  if (!entry.pinned) delete entry.pinned;
  entries.push(entry);
  save(project, automation, entries);
  return {entry, existed: false};
}

const found = (entries: MemoryEntry[], id: string) => {
  const e = entries.find((x) => x.id === id);
  if (!e) throw httpError(404, 'esa entrada de la memoria no existe');
  return e;
};

// text, key ('' clears it), pinned, closed (a pending: true resolves it, false opens it again) and kind (not to or from run).
export function edit(project: string, automation: string, id: string, input: MemoryInput, by: MemoryEntry['by']): MemoryEntry {
  const entries = load(project, automation, true);
  const e = found(entries, id);
  const kind = input.kind === undefined ? e.kind : e.kind === 'run' ? (input.kind === 'run' ? 'run' : writable('run')) : writable(input.kind);
  if (input.text !== undefined) e.text = text(input.text);
  if (kind !== 'done') delete e.key;
  if (input.key !== undefined && input.key !== null) {
    if (kind !== 'done') throw httpError(400, 'la clave es solo para los hechos (done)');
    const k = keyOf(input.key);
    if (k && entries.some((x) => x !== e && x.kind === 'done' && x.key && sameKey(x.key, k))) throw httpError(409, `ya hay un hecho con la clave «${k}»`);
    if (k) e.key = k;
    else delete e.key;
  }
  if (input.pinned !== undefined) {
    if (kind !== 'done' && kind !== 'run') throw httpError(400, 'solo se fijan los hechos y las ejecuciones');
    if (input.pinned === true) e.pinned = true;
    else delete e.pinned;
  } else if (kind !== 'done' && kind !== 'run') delete e.pinned;
  if (input.closed !== undefined) {
    if (kind !== 'pending') throw httpError(400, 'solo se resuelven los pendientes');
    if (input.closed === true) e.closed = e.closed ?? Date.now();
    else delete e.closed;
  } else if (kind !== 'pending') delete e.closed;
  e.kind = kind;
  e.by = by;
  e.updated = Date.now();
  save(project, automation, entries);
  return e;
}

export function remove(project: string, automation: string, id: string) {
  const entries = load(project, automation, true);
  found(entries, id);
  save(project, automation, entries.filter((e) => e.id !== id));
}

export const clear = (project: string, automation: string) => save(project, automation, []);

// The studio's summary of a run, when it ends. The oldest unpinned ones go past KEEP_RUNS.
export function logRun(project: string, automation: string, run: string, summary: string) {
  const entries = load(project, automation, true);
  const now = Date.now();
  entries.push({id: newId(), kind: 'run', text: summary.slice(0, MAX_TEXT), by: 'studio', run, created: now, updated: now});
  const runs = entries.filter((e) => e.kind === 'run' && !e.pinned).sort((a, b) => a.created - b.created);
  const drop = new Set(runs.slice(0, Math.max(0, runs.length - KEEP_RUNS)).map((e) => e.id));
  save(project, automation, entries.filter((e) => !drop.has(e.id)));
}
