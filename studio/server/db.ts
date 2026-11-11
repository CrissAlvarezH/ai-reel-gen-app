// The studio's index: one SQLite database over everything the app keeps in files, for the pages that need to
// search, filter, order or page it, and for the agent's queries (tools/studio_sql.py, read-only). It lives in
// the workspace, .reel-studio/index.sqlite (gitignored), and spans every project. Each part of the app adds
// its tables and keeps them up to date (register): Inspiración (inspiration-index.ts), the projects with their
// videos and Mi cuenta (projects-index.ts), the automations' memory (automation-memory.ts).
//
// The files stay the source of truth: the index is rebuilt from them whenever it's missing, of another
// version, or broken, and sync() re-reads only what changed (by modification times). Nothing writes to it
// but the parts, here.
//
// node:sqlite comes with Node (22.13+, and Electron's). Its build has no FTS5 in every version, so text search
// is a LIKE over a column with every text of the row, lowercased and without accents: plenty for thousands.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import type {DatabaseSync as DB} from 'node:sqlite';
import {ROOT} from './workspace.ts';

export type {DB};

const VERSION = 8; // bump when a part's schema changes: the index is rebuilt
export const INDEX_FILE = () => path.join(ROOT, '.reel-studio', 'index.sqlite');
const OLD_FILE = () => path.join(ROOT, 'inspiration', '.index.sqlite'); // Inspiración's own index, before this one

// A part of the index: its tables (with what each column means: sqlite_master keeps the comments, so
// tools/studio_sql.py --schema shows them to the agent) and how it brings them up to date. sync runs inside
// the transaction of every sync.
type Part = {name: string; schema: string; sync: (d: DB) => void};
const parts: Part[] = [];
export function register(p: Part) {
  if (!parts.some((x) => x.name === p.name)) parts.push(p);
}

let db: DB | null = null;
let dbFile = '';
let lastSync = 0;

const sqlite = () => createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function create(file: string) {
  const d = new (sqlite().DatabaseSync)(file);
  d.exec('PRAGMA busy_timeout = 5000');
  const v = (d.prepare('PRAGMA user_version').get() as {user_version: number}).user_version;
  if (v !== VERSION) {
    const old = d.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as {type: string; name: string}[];
    for (const o of old.filter((o) => o.type === 'table')) d.exec(`DROP TABLE IF EXISTS "${o.name}"`);
    for (const p of parts) d.exec(p.schema);
    d.exec(`PRAGMA user_version = ${VERSION}`);
  }
  return d;
}

// The index of the current workspace (another one after a switch). A broken file is deleted and rebuilt.
export function open(): DB {
  const file = INDEX_FILE();
  if (db && dbFile === file) return db;
  close();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.rmSync(OLD_FILE(), {force: true});
  try {
    db = create(file);
  } catch (e) {
    if ((e as Error).message.includes('node:sqlite')) throw new Error('Reel Studio necesita Node 22.13 o posterior (trae SQLite)');
    fs.rmSync(file, {force: true});
    db = create(file);
  }
  dbFile = file;
  lastSync = 0;
  return db;
}

export function close() {
  db?.close();
  db = null;
  dbFile = '';
}

// Re-read what changed on disk, every part. Cheap when nothing did (a stat per file); at most every 1.5 s
// unless forced (after the studio writes something).
export function sync(force = false) {
  if (!ROOT) return;
  const d = open();
  if (!force && Date.now() - lastSync < 1500) return;
  lastSync = Date.now();
  d.exec('BEGIN');
  try {
    for (const p of parts) p.sync(d);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

// The index, up to date, for a query.
export function read(): DB {
  sync();
  return open();
}

/* ───── For the parts ───── */

export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const dirs = (p: string, ok: (name: string) => boolean = () => true) => {
  try {
    return fs.readdirSync(p, {withFileTypes: true}).filter((d) => d.isDirectory() && !d.name.startsWith('.') && ok(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
};
export const mtime = (p: string) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
export const MIN_FOR_MEDIAN = 5;
export function median(xs: number[]) {
  if (xs.length < MIN_FOR_MEDIAN) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const json = (v: string[]) => (v.length ? JSON.stringify(v) : null);
// undefined isn't a value SQLite takes: a field missing from a file is null.
export const row = (xs: unknown[]) => xs.map((x) => (x === undefined ? null : x)) as (string | number | null)[];
// "LIKE ?" arguments for each word of a search (all of them somewhere in the search column).
export const words = (q: string | undefined) =>
  norm(q ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
export const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
// The table filters' lengths: <30 s, 30–60, 60–90, 90+.
export const DURATIONS = ['short', 'mid', 'long', 'xl'] as const;
export const durationWhere = (col: string, k: (typeof DURATIONS)[number]) =>
  ({short: `${col} < 30`, mid: `${col} >= 30 AND ${col} < 60`, long: `${col} >= 60 AND ${col} < 90`, xl: `${col} >= 90`})[k];
