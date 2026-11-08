// Fuentes de información: what each project follows to find material for its videos (official blogs, changelogs,
// news pages, feeds…) and what an agent extracted from them. In projects/<id>/sources/: sources.json (the sources: what
// he wants in his words, links, how to read them and instructions for the agent), items.json (the results, without
// their text) and items/<id>.md (each result's text, in markdown).
//
// Extracting is always an agent's job, never this server's: from the page ("Extraer", a new general conversation he
// watches, which can use his Chrome), or from an automation's step (unattended, without it). The agent saves through
// tools/sources.py, which comes through here like the page, so the page follows. The project is passed explicitly
// when the caller may be in another one than the open project (an agent keeps working in its own after he switches).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {SOURCE_ITEM_STATES, type Source, type SourceItem, type SourceItemDetail, type SourceItemList, type SourceItemState, type SourceLink, type SourcesView} from '../shared/types.ts';
import {readJson, writeJson} from './platform.ts';
import {norm} from './db.ts';
import {getKey} from './settings.ts';
import {PROJECT, ROOT, listProjects} from './workspace.ts';

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), {status});
const newId = () => crypto.randomBytes(4).toString('hex');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_MARKDOWN = 200_000;

function dirOf(project?: string) {
  const id = project || PROJECT;
  if (!listProjects().some((p) => p.id === id)) throw bad(`no existe el proyecto «${id}»`, 404);
  return path.join(ROOT, 'projects', id, 'sources');
}
const sourcesFile = (dir: string) => path.join(dir, 'sources.json');
const itemsFile = (dir: string) => path.join(dir, 'items.json');
const mdFile = (dir: string, id: string) => path.join(dir, 'items', `${id}.md`);

/* ───── Reading what comes in ───── */

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const urlOf = (v: unknown) => {
  const u = text(v, 2000);
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return parsed.toString();
  } catch {
    throw bad(`no es un enlace válido: «${u}» (empieza por https://)`);
  }
};
// The same page, written slightly differently (a trailing slash, #fragment, utm_ tracking, www.), is the same result.
export const sameUrl = (u: string) => {
  try {
    const p = new URL(u);
    p.hash = '';
    for (const k of [...p.searchParams.keys()]) if (k.startsWith('utm_')) p.searchParams.delete(k);
    return `${p.hostname.replace(/^www\./, '')}${p.pathname.replace(/\/+$/, '')}${p.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
// A link as he writes it: "https://…", or "Etiqueta | https://…"; objects {url, label} as the API sends them.
export function linksOf(v: unknown): SourceLink[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  const out: SourceLink[] = [];
  for (const l of raw) {
    let url: unknown;
    let label = '';
    if (isObj(l)) {
      url = l.url;
      label = text(l.label, 120);
    } else if (typeof l === 'string') {
      const line = l.trim();
      if (!line) continue;
      const cut = line.lastIndexOf(' | ');
      [label, url] = cut >= 0 ? [line.slice(0, cut).trim().slice(0, 120), line.slice(cut + 3)] : ['', line];
    } else continue;
    const u = urlOf(url);
    if (!out.some((x) => sameUrl(x.url) === sameUrl(u))) out.push({url: u, label: label || hostOf(u)});
  }
  if (out.length > 50) throw bad('como mucho 50 enlaces');
  return out;
}
const stateOf = (v: unknown): SourceItemState => {
  if (!SOURCE_ITEM_STATES.includes(v as SourceItemState)) throw bad(`estado no válido: usa ${SOURCE_ITEM_STATES.join(', ')}`);
  return v as SourceItemState;
};
const tagsOf = (v: unknown) => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  for (const t of raw) {
    const tag = text(t, 40).replace(/\s+/g, ' ').toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 12);
};
const dateOf = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const s = text(v, 40);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw bad(`fecha no válida: «${s}» (usa AAAA-MM-DD)`);
  return d.toISOString().slice(0, 10);
};
const nameOf = (v: unknown) => {
  const n = text(v, 80).replace(/\s+/g, ' ');
  if (!n) throw bad('ponle un nombre a la fuente');
  return n;
};

/* ───── The files ───── */

// Forgiving of hand edits: what can't be read as a source or a result is left out. A file that can't be read at all
// stops here, so the next change doesn't write an empty list over his sources.
function readList<T>(file: string, key: string, clean: (x: Record<string, unknown>) => T[]): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = readJson<unknown>(file);
  if (!isObj(raw) || !Array.isArray(raw[key])) throw bad(`no se puede leer ${path.relative(ROOT, file)}: arréglalo o bórralo`, 500);
  return (raw[key] as unknown[]).filter(isObj).flatMap(clean);
}
const safeLinks = (v: unknown) => {
  try {
    return linksOf(v);
  } catch {
    return [];
  }
};
const readSources = (dir: string): Source[] =>
  readList(sourcesFile(dir), 'sources', (s) =>
    typeof s.id !== 'string' || typeof s.name !== 'string'
      ? []
      : [
          {
            id: s.id,
            name: s.name,
            description: typeof s.description === 'string' ? s.description : '',
            instructions: typeof s.instructions === 'string' ? s.instructions : '',
            links: safeLinks(s.links),
            enabled: s.enabled !== false,
            created: Number(s.created) || 0,
            updated: Number(s.updated) || 0,
            lastRun: isObj(s.lastRun) ? {at: Number(s.lastRun.at) || 0, ok: s.lastRun.ok !== false, added: Number(s.lastRun.added) || 0, note: typeof s.lastRun.note === 'string' ? s.lastRun.note : ''} : null,
          },
        ],
  );
const readItems = (dir: string): SourceItem[] =>
  readList(itemsFile(dir), 'items', (i) =>
    typeof i.id !== 'string' || typeof i.title !== 'string' || typeof i.source !== 'string'
      ? []
      : [
          {
            id: i.id,
            source: i.source,
            title: i.title,
            url: typeof i.url === 'string' ? i.url : '',
            links: safeLinks(i.links),
            summary: typeof i.summary === 'string' ? i.summary : '',
            published: typeof i.published === 'string' ? i.published : null,
            extracted: Number(i.extracted) || 0,
            tags: Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === 'string') : [],
            state: SOURCE_ITEM_STATES.includes(i.state as SourceItemState) ? (i.state as SourceItemState) : 'new',
          },
        ],
  );

// A source by its id or its name (without caring for accents or capitals).
function find(sources: Source[], ref: unknown) {
  const r = norm(String(ref ?? '').trim());
  const hit = sources.find((s) => s.id === ref) ?? sources.find((s) => norm(s.name) === r);
  if (!hit) throw bad(`no existe la fuente «${String(ref)}». Hay: ${sources.map((s) => s.name).join(', ') || 'ninguna'}`, 404);
  return hit;
}
function itemIn(items: SourceItem[], id: string) {
  const hit = items.find((i) => i.id === id);
  if (!hit) throw bad(`no existe el resultado ${id}`, 404);
  return hit;
}

/* ───── The page ───── */

export function view(project?: string): SourcesView {
  const dir = dirOf(project);
  const items = readItems(dir);
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    sources: readSources(dir).map((s) => {
      const own = items.filter((i) => i.source === s.id);
      return {...s, items: own.length, fresh: own.filter((i) => i.state === 'new').length};
    }),
    tags,
  };
}

export function source(project: string | undefined, ref: string) {
  return find(readSources(dirOf(project)), ref);
}

function changeSources(project: string | undefined, fn: (all: Source[]) => void) {
  const dir = dirOf(project);
  const all = readSources(dir);
  fn(all);
  writeJson(sourcesFile(dir), {sources: all});
  return view(project);
}

export const addSource = (project: string | undefined, input: Record<string, unknown>) =>
  changeSources(project, (all) => {
    const name = nameOf(input.name);
    if (all.some((s) => norm(s.name) === norm(name))) throw bad(`ya hay una fuente «${name}»`, 409);
    const now = Date.now();
    all.push({
      id: newId(),
      name,
      description: text(input.description, 4000),
      instructions: text(input.instructions, 20000),
      links: linksOf(input.links),
      enabled: input.enabled !== false,
      created: now,
      updated: now,
      lastRun: null,
    });
  });

export const editSource = (project: string | undefined, ref: string, input: Record<string, unknown>) =>
  changeSources(project, (all) => {
    const s = find(all, ref);
    if (input.name !== undefined) {
      const name = nameOf(input.name);
      if (all.some((x) => x !== s && norm(x.name) === norm(name))) throw bad(`ya hay una fuente «${name}»`, 409);
      s.name = name;
    }
    if (input.description !== undefined) s.description = text(input.description, 4000);
    if (input.instructions !== undefined) s.instructions = text(input.instructions, 20000);
    if (input.links !== undefined) s.links = linksOf(input.links);
    if (input.enabled !== undefined) s.enabled = input.enabled !== false;
    s.updated = Date.now();
  });

// Its results go with it.
export function removeSource(project: string | undefined, ref: string) {
  const dir = dirOf(project);
  const {id} = find(readSources(dir), ref);
  const items = readItems(dir);
  for (const i of items.filter((x) => x.source === id)) fs.rmSync(mdFile(dir, i.id), {force: true});
  writeJson(itemsFile(dir), {items: items.filter((x) => x.source !== id)});
  return changeSources(project, (all) => void all.splice(all.findIndex((s) => s.id === id), 1));
}

// An agent finished going through it (whether it found anything or not).
export const markRun = (project: string | undefined, ref: string, input: Record<string, unknown>) =>
  changeSources(project, (all) => {
    const s = find(all, ref);
    const added = Number(input.added);
    s.lastRun = {at: Date.now(), ok: input.ok !== false, added: Number.isInteger(added) && added >= 0 ? added : 0, note: text(input.note, 2000)};
  });

/* ───── Results ───── */

export type ItemQuery = {q?: unknown; source?: unknown; state?: unknown; tag?: unknown; sinceDays?: unknown; sort?: unknown; desc?: unknown; page?: unknown; size?: unknown};

// The table: filtered, ordered and paged here. The search also looks in each result's text.
export function listItems(project: string | undefined, query: ItemQuery): SourceItemList {
  const dir = dirOf(project);
  let rows = readItems(dir);
  const sources = readSources(dir);
  if (typeof query.source === 'string' && query.source) {
    const id = find(sources, query.source).id;
    rows = rows.filter((r) => r.source === id);
  }
  if (typeof query.state === 'string' && query.state) {
    // "pending": what he hasn't decided on yet (new or read).
    rows = query.state === 'pending' ? rows.filter((r) => r.state === 'new' || r.state === 'read') : rows.filter((r) => r.state === query.state);
  }
  if (typeof query.tag === 'string' && query.tag) rows = rows.filter((r) => r.tags.includes(query.tag as string));
  const days = Number(query.sinceDays);
  if (days > 0) {
    const since = Date.now() - days * 86_400_000;
    rows = rows.filter((r) => (r.published ? Date.parse(`${r.published}T23:59:59Z`) : r.extracted) >= since);
  }
  if (typeof query.q === 'string' && query.q.trim()) {
    const words = norm(query.q).split(/\s+/).filter(Boolean);
    const names = new Map(sources.map((s) => [s.id, s.name]));
    rows = rows.filter((r) => {
      const head = norm([r.title, r.summary, r.url, r.tags.join(' '), names.get(r.source) ?? ''].join(' '));
      if (words.every((w) => head.includes(w))) return true;
      const body = norm(`${head} ${fs.existsSync(mdFile(dir, r.id)) ? fs.readFileSync(mdFile(dir, r.id), 'utf8') : ''}`);
      return words.every((w) => body.includes(w));
    });
  }
  // Undated results go by when they were extracted.
  const when = (r: SourceItem) => (r.published ? Date.parse(`${r.published}T12:00:00Z`) : r.extracted);
  const key = query.sort === 'extracted' ? (r: SourceItem) => r.extracted : query.sort === 'title' ? null : when;
  rows.sort((a, b) => (key ? key(a) - key(b) : a.title.localeCompare(b.title, 'es')));
  if (query.desc !== 'false' && query.desc !== false) rows.reverse();
  const size = Math.min(Math.max(Number(query.size) || 25, 1), 500);
  const page = Math.max(Number(query.page) || 0, 0);
  return {rows: rows.slice(page * size, page * size + size), total: rows.length};
}

export function item(project: string | undefined, id: string): SourceItemDetail {
  const dir = dirOf(project);
  const it = itemIn(readItems(dir), id);
  const file = mdFile(dir, id);
  return {...it, markdown: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''};
}

function changeItems<T>(project: string | undefined, fn: (items: SourceItem[], dir: string) => T): T {
  const dir = dirOf(project);
  const items = readItems(dir);
  const out = fn(items, dir);
  writeJson(itemsFile(dir), {items});
  return out;
}

// A result found by an agent. The same page again in the same source isn't saved twice: it says so (created: false),
// and replaces it only with update.
export const addItem = (project: string | undefined, input: Record<string, unknown>) =>
  changeItems(project, (items, dir) => {
    const src = find(readSources(dir), input.source);
    const title = text(input.title, 300);
    if (!title) throw bad('el resultado necesita un título');
    const url = urlOf(input.url);
    const markdown = typeof input.markdown === 'string' ? input.markdown.slice(0, MAX_MARKDOWN) : '';
    const fields = {title, url, links: input.links === undefined ? [] : linksOf(input.links), summary: text(input.summary, 1000), published: dateOf(input.published), tags: tagsOf(input.tags)};
    const same = items.find((i) => i.source === src.id && sameUrl(i.url) === sameUrl(url));
    if (same && input.update !== true) return {created: false, item: same};
    if (same) {
      Object.assign(same, fields);
      if (markdown) fs.writeFileSync(mdFile(dir, same.id), markdown);
      return {created: false, updated: true, item: same};
    }
    const it: SourceItem = {id: newId(), source: src.id, ...fields, extracted: Date.now(), state: 'new'};
    fs.mkdirSync(path.dirname(mdFile(dir, it.id)), {recursive: true});
    fs.writeFileSync(mdFile(dir, it.id), markdown);
    items.push(it);
    return {created: true, item: it};
  });

export const editItem = (project: string | undefined, id: string, input: Record<string, unknown>) =>
  changeItems(project, (items, dir) => {
    const it = itemIn(items, id);
    if (input.title !== undefined) {
      const t = text(input.title, 300);
      if (!t) throw bad('el resultado necesita un título');
      it.title = t;
    }
    if (input.url !== undefined) it.url = urlOf(input.url);
    if (input.links !== undefined) it.links = linksOf(input.links);
    if (input.summary !== undefined) it.summary = text(input.summary, 1000);
    if (input.published !== undefined) it.published = dateOf(input.published);
    if (input.tags !== undefined) it.tags = tagsOf(input.tags);
    if (input.state !== undefined) it.state = stateOf(input.state);
    if (typeof input.markdown === 'string') fs.writeFileSync(mdFile(dir, it.id), input.markdown.slice(0, MAX_MARKDOWN));
    return it;
  });

export const removeItem = (project: string | undefined, id: string) =>
  changeItems(project, (items, dir) => {
    const i = items.indexOf(itemIn(items, id));
    items.splice(i, 1);
    fs.rmSync(mdFile(dir, id), {force: true});
    return {ok: true};
  });

/* ───── Apify, for the agent (sources.py apify) ───── */

// Runs an actor and waits for its items (up to 5 min), with the key in Ajustes; the agent never sees the key.
// Spends from his Apify balance: the agent is told to keep runs small.
export async function apify(input: Record<string, unknown>) {
  const token = getKey('APIFY_TOKEN');
  if (!token) throw bad('falta la clave de Apify: ponla en Ajustes → Extracción de datos');
  const actor = text(input.actor, 200).replace('/', '~');
  if (!/^[\w.-]+~[\w.-]+$/.test(actor)) throw bad('actor no válido: usa usuario/actor, p. ej. apify/website-content-crawler');
  const maxItems = Math.min(Math.max(Number(input.maxItems) || 20, 1), 500);
  const body = isObj(input.input) ? input.input : {};
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=300&maxItems=${maxItems}`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(320_000),
  });
  const data = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw bad(`Apify respondió ${r.status}: ${isObj(data) && isObj(data.error) ? String(data.error.message) : 'sin detalle'}`, 502);
  return Array.isArray(data) ? data.slice(0, maxItems) : [];
}

/* ───── For the agent ───── */

// The request "Extraer" sends to a new general conversation, and an automation's step to its agent. ids: those
// sources (none: every active one). unattended: nobody is watching, so no Chrome.
export function extractRequest(project: string | undefined, ids: string[], run: string, unattended = false) {
  const all = readSources(dirOf(project));
  // Chosen ones that were deleted since (an automation's step) are skipped.
  const chosen = ids.length ? all.filter((s) => ids.includes(s.id)) : all.filter((s) => s.enabled);
  if (!chosen.length) throw bad(ids.length ? 'esas fuentes ya no existen' : all.length ? 'no hay fuentes activas' : 'todavía no hay fuentes: crea una primero');
  const list = chosen.map((s) => `- «${s.name}» (id ${s.id}; ${s.links.length} enlaces${s.lastRun ? `; última vez ${new Date(s.lastRun.at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '; nunca extraída'})`);
  const text = chosen.length === 1 ? `Extrae lo nuevo de la fuente «${chosen[0].name}».` : `Extrae lo nuevo de estas ${chosen.length} fuentes de información.`;
  const note = [
    'Extracción de Fuentes de información. Fuentes:',
    ...list,
    `Para cada una, una a una: lee su definición completa (${run} show <id>: enlaces, método e instrucciones) y lo que ya se guardó (${run} items --source <id> --limit 40), visita sus enlaces con lo que tengas (mira abajo: Leer la web) y guarda cada cosa nueva y relevante según su descripción e instrucciones con ${run} add (título claro en el idioma del proyecto, enlace propio, fecha de publicación, resumen de 1-2 frases, 1-4 etiquetas, y el contenido en markdown con --markdown-file: lo importante, con datos, cifras y citas textuales, no solo un resumen). No dupliques: si add dice que ya existía, sigue. Al terminar cada fuente: ${run} done <id> --added N --note "…" (o --error "…" si no se pudo leer).`,
    `Leer la web: tú eliges cómo, con lo que tengas, de lo más barato a lo más caro: ${READ_WEB}${unattended ? ' Nadie está delante: no tienes su Chrome.' : ' Si tienes Claude in Chrome, sirve para lo que pide sesión iniciada: úsalo solo para leer, en una pestaña nueva.'} Si una fuente no se deja leer de ninguna forma, márcala con done --error y sigue.`,
    'Al final, un resumen breve por fuente: cuántos resultados nuevos y lo más interesante para un video.',
  ].join('\n');
  return {text, note};
}

// How the extracting agent reads the web: whatever it has, never a method fixed by him.
const READ_WEB =
  'curl o tu herramienta de fetch; el feed RSS/Atom o el sitemap si los hay; https://r.jina.ai/<url> para una página que necesita JavaScript (devuelve markdown); y para lo que no salga así, Apify con sources.py apify (gasta de su saldo).';
const INSTRUCTIONS_LINE =
  'Las instrucciones (markdown) son para el agente que la extraerá cada vez, sin contexto ni nadie a quien preguntar: qué buscar y qué ignorar, dónde mirar en cada enlace, cómo reconocer lo nuevo, qué datos guardar de cada resultado (cifras, fechas, citas), qué etiquetas usar y cómo leer cada enlace si lo comprobaste (p. ej. «tiene RSS en …», «necesita r.jina.ai»).';

// "Nueva fuente": he says in a line what he wants to extract, and the agent interviews him in a new general
// conversation, finds the links he doesn't have, and creates the source when it has all it needs.
export function createRequest(project: string | undefined, want: unknown, run: string) {
  const what = text(want, 2000);
  if (!what) throw bad('di qué información quieres extraer');
  const existing = readSources(dirOf(project)).map((s) => `«${s.name}»`);
  const note = [
    'Crear una fuente de información (página Fuentes de información) con él, en esta conversación. Él está delante: es una entrevista corta, no un formulario.',
    existing.length ? `Fuentes que ya tiene: ${existing.join(', ')}. Si lo que pide encaja en una, díselo y propón ampliarla en vez de duplicarla.` : 'Todavía no tiene fuentes.',
    '1. Pregúntale en un solo mensaje, breve, solo lo que no esté claro en lo que escribió: qué quiere sacar exactamente y para qué videos, si tiene enlaces o sitios concretos (si no, los buscas tú), qué ignorar, y lo que haga falta para entenderlo. Si ya está todo claro, no preguntes y sigue.',
    `2. Con sus respuestas, busca en internet las páginas oficiales y fiables que falten (blogs, notas de prensa, changelogs, documentación, feeds RSS/Atom) y comprueba que se pueden leer (${READ_WEB}).`,
    '3. Enséñale la propuesta: nombre corto, qué se extrae, los enlaces con una línea de por qué cada uno, y el resumen de las instrucciones. Termina preguntando si la creas así.',
    `4. Cuando diga que sí: ${run} source add "nombre" --description "lo que quiere, en sus palabras" --link "Etiqueta | https://…" (uno por enlace) --instructions-file <archivo.md>. ${INSTRUCTIONS_LINE} Luego dile que ya está en la página y pregúntale si extraes ahora (no lo hagas sin su sí).`,
  ].join('\n');
  return {text: what, note};
}

// "Completar con el agente": he described the source in words; the agent finds its links and writes its instructions.
export function configureRequest(project: string | undefined, ref: string, run: string) {
  const s = find(readSources(dirOf(project)), ref);
  const text = `Configura la fuente de información «${s.name}».`;
  const note = [
    `Fuente de información a configurar (id ${s.id}). Lo que quiere de ella, en sus palabras: ${s.description || '(no lo dijo: dedúcelo del nombre)'}`,
    s.links.length ? `Enlaces que ya tiene: ${s.links.map((l) => l.url).join(', ')}` : 'Todavía no tiene enlaces.',
    s.instructions ? `Instrucciones actuales:\n${s.instructions}` : '',
    `Busca en internet las páginas oficiales y fiables de donde sacarlo (blogs, notas de prensa, changelogs, documentación, feeds RSS/Atom si los hay), comprueba que se pueden leer y cómo (${READ_WEB}), y guárdalo con ${run} source edit ${s.id} --link "Etiqueta | https://…" (uno por enlace; reemplaza los que tenga) --instructions-file <archivo.md>. ${INSTRUCTIONS_LINE} No extraigas resultados ahora salvo que te lo pida. Al final, enséñale los enlaces y un resumen de las instrucciones, y pregúntale si quiere ajustar algo o extraer ya.`,
  ]
    .filter(Boolean)
    .join('\n');
  return {text, note};
}

// "Convertir en idea": a result to the Ideas de contenido board.
export function ideaRequest(project: string | undefined, id: string, run: string) {
  const it = item(project, id);
  return {
    text: `Convierte en idea de contenido el resultado «${it.title}» de Fuentes de información.`,
    note: `Resultado ${it.id} de Fuentes de información (léelo entero con ${run} item ${it.id}). Propón 1-3 ángulos para un reel según su perfil de audiencia, y al aprobar uno, añádelo al tablero de ideas con el enlace original en las notas; luego márcalo como usado con ${run} edit ${it.id} --state used.`,
  };
}

export const agentNote = (run: string) =>
  `Fuentes de información (página del mismo nombre, encima de Inspiración; por proyecto): las fuentes que sigue para encontrar material (blogs oficiales, changelogs, noticias, feeds…), cada una con lo que quiere en sus palabras, enlaces e instrucciones para el agente que la extrae (cómo leerla lo decides tú, con lo que tengas), y debajo una tabla con lo extraído (título, enlace, fecha, resumen, etiquetas, estado new/read/used/discarded y el contenido en markdown). Todo con ${run} (nunca editando projects/<id>/sources/ a mano: la página no se enteraría): show [fuente] [--json] · source add "nombre" [--description "…"] [--link "Etiqueta | URL"]… [--instructions-file f] · source edit F [--name] [--description] [--link …] (reemplaza los enlaces) [--instructions-file f] [--enable|--disable] · source rm F (borra también sus resultados: solo si te lo pidió) · items [--source F] [--state s] [--q "…"] [--since-days N] [--limit N] [--json] · item <id> (con su markdown) · add --source F --title "…" --url URL [--published AAAA-MM-DD] [--summary "…"] [--tag t]… [--link URL]… [--markdown-file f] [--update] · edit <id> [--state s] [--title] [--summary] [--tag]… [--markdown-file f] · rm <id> · done F [--added N] [--note "…"|--error "…"] · apify <usuario/actor> --input '{…}' [--max-items N] [--out f.json] (con su clave de Apify, sin que la veas; gasta de su saldo: usa pocos ítems; p. ej. apify/website-content-crawler con {"startUrls":[{"url":"…"}],"maxCrawlPages":10} devuelve markdown). Para leer la web: ${READ_WEB} Si te pide crear una fuente, entrevístale corto (qué quiere y para qué, sus enlaces si los tiene), busca tú los que falten, enséñale la propuesta y créala con source add cuando diga que sí. Fuentes por nombre o id. Cuando busque ideas o temas de actualidad, mira primero aquí (items --state pending).`;
