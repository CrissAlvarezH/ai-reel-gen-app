// Inspiración's part of the studio's index (db.ts): other accounts' reels, for its table (search, filters,
// order, pages across every account) and for the agent's queries. Its tables are insp_accounts, insp_reels
// and insp_beats, one set per project (each has its own Inspiración), rebuilt from the files in
// projects/<id>/inspiration/ (they stay the source of truth): sync re-reads only
// the reels whose files changed (by their modification times).
import fs from 'node:fs';
import path from 'node:path';
import {PROJECT, ROOT, listProjects} from './workspace.ts';
import {readJson} from './platform.ts';
import {register, read, dirs, mtime, median, norm, strs, json, row as toRow, words, since, durationWhere, type DB, type DURATIONS} from './db.ts';
import type {InspirationProfile, ReelAnalysis, ReelTranscript} from '../shared/types.ts';

const USER = /^[a-z0-9._]{1,30}$/;
const CODE = /^[A-Za-z0-9_-]{5,40}$/;

const DIR = (project: string) => path.join(ROOT, 'projects', project, 'inspiration');

// The schema, with what each column means (tools/studio_sql.py --schema shows it to the agent).
const SCHEMA = `
CREATE TABLE insp_accounts ( -- Inspiración: the accounts it studies
  project     TEXT NOT NULL,    -- projects.id: each project studies its own accounts
  username    TEXT NOT NULL,    -- Instagram user, lowercase, without @
  full_name   TEXT,
  followed    INTEGER NOT NULL, -- 1: scanned as an account (Escanear cuenta); 0: only loose videos of it (Agregar video)
  added       INTEGER,          -- ms since epoch
  fetched     INTEGER,          -- last scan, ms
  reels       INTEGER NOT NULL, -- reels downloaded
  median      REAL,             -- median views of its reels (null with fewer than 5)
  analysis    TEXT,             -- the agent's analysis of the whole account (markdown), or null
  analysis_at INTEGER,
  error       TEXT,
  followers   INTEGER,          -- from its profile (scanned accounts; null until scanned or updated)
  following   INTEGER,
  posts       INTEGER,          -- posts of every kind on its profile
  bio         TEXT,
  verified    INTEGER,
  category    TEXT,             -- Instagram's business category, if any
  website     TEXT,
  profile_at  INTEGER,          -- when the profile was read, ms
  PRIMARY KEY (project, username)
);
CREATE TABLE insp_reels (    -- Inspiración: their reels
  project     TEXT NOT NULL,    -- projects.id
  account     TEXT NOT NULL,    -- insp_accounts.username (a loose video goes under its owner)
  code        TEXT NOT NULL,    -- Instagram shortcode: https://www.instagram.com/reel/<code>/
  url         TEXT NOT NULL,
  caption     TEXT,
  posted      TEXT,             -- ISO date-time it was published
  views       INTEGER,          -- plays shown on Instagram
  likes       INTEGER,          -- null when the owner hides them
  comments    INTEGER,
  duration    REAL,             -- seconds
  music       TEXT,
  ratio       REAL,             -- views / its account's median (null when the account has fewer than 5 reels)
  metrics_at  INTEGER,          -- when views, likes and comments were read, ms
  added       INTEGER,
  state       TEXT NOT NULL,    -- pending (not transcribed) · processed (transcribed, not analysed) · ready (analysed) · error
  error       TEXT,
  language    TEXT,             -- of the voice
  words       INTEGER,
  wps         REAL,             -- words per second of the voice
  no_audio    INTEGER,          -- 1: the video has no audio
  transcript  TEXT,             -- full text of the voice
  topic       TEXT,             -- the agent's analysis (analysis.json) from here on
  hook_text   TEXT,             -- what's said and read in the first 3 s
  hook_visual TEXT,
  hook_why    TEXT,             -- why it hooks (or doesn't)
  cta         TEXT,             -- the call to action, literal, or null
  visuals     TEXT,             -- JSON array of visual devices (text on screen, face to camera, b-roll…)
  takeaways   TEXT,             -- JSON array: what's worth borrowing
  analysed_at INTEGER,
  hashtags    TEXT,             -- JSON array, from Instagram (meta.json)
  mentions    TEXT,             -- JSON array
  product_type TEXT,            -- clips, igtv…
  sponsored   INTEGER,          -- 1: paid partnership
  thumb       INTEGER NOT NULL, -- 1: thumb.jpg exists
  sheets      INTEGER NOT NULL, -- frame sheets (sheet_NN.jpg, 30 s each)
  search      TEXT NOT NULL,    -- internal: every text above, lowercase and without accents, for LIKE
  sig         TEXT NOT NULL,    -- internal: the files' modification times when it was indexed
  PRIMARY KEY (project, account, code)
);
CREATE TABLE insp_beats (    -- Inspiración: each reel's structure
  project TEXT NOT NULL,        -- projects.id
  account TEXT NOT NULL,
  code    TEXT NOT NULL,        -- insp_reels.(account, code)
  idx     INTEGER NOT NULL,     -- order in the reel
  tag     TEXT NOT NULL,        -- hook · contexto · rehook · desarrollo · ejemplo · payoff · cta · cierre
  start   REAL,                 -- seconds
  "end"   REAL,
  summary TEXT,
  PRIMARY KEY (project, account, code, idx)
);
CREATE INDEX insp_beats_tag ON insp_beats (tag);
CREATE INDEX insp_reels_posted ON insp_reels (posted);
`;

const SIG_FILES = ['reel.json', 'analysis.json', 'transcript.json', 'meta.json', 'thumb.jpg', 'hook.jpg'];

type ReelFile = {
  code: string;
  url: string;
  caption: string;
  posted: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: number | null;
  music: string | null;
  added: number;
  metricsAt?: number;
  error?: string | null;
};
type AccountFile = {username: string; fullName: string | null; followed: boolean; added: number; fetched: number | null; analysis: {text: string; at: number} | null; error: string | null; profile?: InspirationProfile | null};
type Meta = {hashtags?: unknown; mentions?: unknown; productType?: unknown; isSponsored?: unknown};

// Re-read what changed on disk (inside db.ts's transaction).
function sync(d: DB) {
  const known = new Map((d.prepare('SELECT project, account, code, sig FROM insp_reels').all() as {project: string; account: string; code: string; sig: string}[]).map((r) => [`${r.project}/${r.account}/${r.code}`, r.sig]));
  const seen = new Set<string>();
  const accounts: {project: string; a: AccountFile; reels: number}[] = [];

  const upsert = d.prepare(`INSERT OR REPLACE INTO insp_reels (project, account, code, url, caption, posted, views, likes, comments, duration, music, ratio, metrics_at, added, state, error,
      language, words, wps, no_audio, transcript, topic, hook_text, hook_visual, hook_why, cta, visuals, takeaways, analysed_at, hashtags, mentions, product_type, sponsored,
      thumb, sheets, search, sig) VALUES (${Array(37).fill('?').join(', ')})`);
  const delBeats = d.prepare('DELETE FROM insp_beats WHERE project = ? AND account = ? AND code = ?');
  const addBeat = d.prepare('INSERT INTO insp_beats (project, account, code, idx, tag, start, "end", summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const views = d.prepare('SELECT views FROM insp_reels WHERE project = ? AND account = ?');

  for (const {id: project} of listProjects())
  for (const u of dirs(DIR(project)).filter((x) => USER.test(x))) {
    const a = readJson<AccountFile>(path.join(DIR(project), u, 'account.json'));
    if (!a) continue;
    let count = 0;
    for (const c of dirs(path.join(DIR(project), u)).filter((x) => CODE.test(x))) {
      const rd = path.join(DIR(project), u, c);
      let files: string[];
      try {
        files = fs.readdirSync(rd);
      } catch {
        continue;
      }
      if (!files.includes('reel.json')) continue;
      count++;
      const sheets = files.filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).length;
      const sig = SIG_FILES.map((f) => (files.includes(f) ? mtime(path.join(rd, f)) : 0)).join(',') + `,${sheets}`;
      const key = `${project}/${u}/${c}`;
      seen.add(key);
      if (known.get(key) === sig) continue;
      const r = readJson<ReelFile>(path.join(rd, 'reel.json'));
      if (!r) continue;
      const an = readJson<ReelAnalysis>(path.join(rd, 'analysis.json'));
      const t = readJson<ReelTranscript>(path.join(rd, 'transcript.json'));
      const meta = readJson<Meta>(path.join(rd, 'meta.json')) ?? {};
      const processed = !!t && files.includes('hook.jpg');
      const state = r.error ? 'error' : an ? 'ready' : processed ? 'processed' : 'pending';
      const visuals = strs(an?.visuals);
      const takeaways = strs(an?.takeaways);
      const structure = Array.isArray(an?.structure) ? an.structure : [];
      const hashtags = strs(meta.hashtags);
      const search = norm(
        [r.caption, t?.text, an?.topic, an?.hook?.text, an?.hook?.visual, an?.hook?.why, an?.cta, ...visuals, ...takeaways, ...structure.map((s) => s.summary), ...hashtags.map((h) => `#${h}`), r.music]
          .filter(Boolean)
          .join('\n'),
      );
      const row = toRow([
        project, u, c, r.url, r.caption ?? '', r.posted, r.views, r.likes, r.comments, r.duration, r.music, null, r.metricsAt ?? a.fetched ?? r.added, r.added, state, r.error ?? null,
        t?.language ?? null, t?.words ?? null, t?.wps ?? null, t?.noAudio ? 1 : 0, t?.text ?? null,
        an?.topic ?? null, an?.hook?.text ?? null, an?.hook?.visual ?? null, an?.hook?.why ?? null, an?.cta ?? null, json(visuals), json(takeaways), an?.at ?? null,
        json(hashtags), json(strs(meta.mentions)), typeof meta.productType === 'string' ? meta.productType : null, meta.isSponsored === true ? 1 : 0,
        files.includes('thumb.jpg') ? 1 : 0, sheets, search, sig,
      ]);
      upsert.run(...row);
      delBeats.run(project, u, c);
      structure.forEach((s, i) => addBeat.run(project, u, c, i, String(s.tag), Number(s.start) || 0, Number(s.end) || 0, s.summary ?? ''));
    }
    accounts.push({project, a, reels: count});
  }
  // Gone from disk: out of the index.
  for (const key of known.keys()) {
    if (seen.has(key)) continue;
    const [project, u, c] = key.split('/');
    d.prepare('DELETE FROM insp_reels WHERE project = ? AND account = ? AND code = ?').run(project, u, c);
    delBeats.run(project, u, c);
  }
  // Accounts, their medians and each reel's ratio to it.
  d.exec('DELETE FROM insp_accounts');
  const addAcc = d.prepare(
    'INSERT INTO insp_accounts (project, username, full_name, followed, added, fetched, reels, median, analysis, analysis_at, error, followers, following, posts, bio, verified, category, website, profile_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const setRatio = d.prepare('UPDATE insp_reels SET ratio = CASE WHEN ? IS NULL OR views IS NULL THEN NULL ELSE views * 1.0 / ? END WHERE project = ? AND account = ?');
  for (const {project, a, reels} of accounts) {
    const med = median((views.all(project, a.username) as {views: number | null}[]).map((x) => x.views).filter((v): v is number => typeof v === 'number'));
    const pr = a.profile;
    const row = [project, a.username, a.fullName, a.followed ? 1 : 0, a.added, a.fetched, reels, med, a.analysis?.text ?? null, a.analysis?.at ?? null, a.error,
      pr?.followers, pr?.following, pr?.posts, pr?.bio, pr ? (pr.verified ? 1 : 0) : null, pr?.category, pr?.website, pr?.at];
    addAcc.run(...toRow(row));
    setRatio.run(med, med, project, a.username);
  }
  d.exec(`DELETE FROM insp_reels WHERE project || '/' || account NOT IN (SELECT project || '/' || username FROM insp_accounts); DELETE FROM insp_beats WHERE project || '/' || account || '/' || code NOT IN (SELECT project || '/' || account || '/' || code FROM insp_reels);`);
}
register({name: 'inspiration', schema: SCHEMA, sync});

/* ───── The table ───── */

export type ListQuery = {
  scope: 'all' | 'loose' | string; // every reel, the loose videos (accounts not followed), or one account
  q?: string; // words, all of them somewhere in the reel's texts
  account?: string; // within "all"
  minRatio?: number;
  minViews?: number;
  sinceDays?: number;
  dur?: (typeof DURATIONS)[number];
  beat?: string; // has that part in its structure
  cta?: 'yes' | 'no';
  state?: 'ready' | 'unanalysed' | 'error';
  sort?: string;
  desc?: boolean;
  page?: number;
  size?: number;
};

export type IndexRow = {
  account: string;
  code: string;
  url: string;
  caption: string;
  posted: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: number | null;
  ratio: number | null;
  wps: number | null;
  state: 'pending' | 'processed' | 'ready' | 'error';
  error: string | null;
  topic: string | null;
  hook_text: string | null;
  thumb: number;
  metrics_at: number;
};

const SORTS: Record<string, string> = {posted: 'r.posted', views: 'r.views', ratio: 'r.ratio', likes: 'r.likes', comments: 'r.comments', duration: 'r.duration', wps: 'r.wps'};

export function list(q: ListQuery) {
  const d = read();
  // Only the open project's.
  const where: string[] = ['r.project = ?'];
  const args: (string | number)[] = [PROJECT];
  if (q.scope === 'loose') where.push('a.followed = 0');
  else if (q.scope !== 'all') where.push('r.account = ?'), args.push(q.scope);
  const scopeWhere = [...where];
  const scopeArgs = [...args];

  if (q.account && q.scope === 'all') where.push('r.account = ?'), args.push(q.account);
  for (const w of words(q.q)) where.push("r.search LIKE ? ESCAPE '\\'"), args.push(w);
  if (q.minRatio) where.push('r.ratio >= ?'), args.push(q.minRatio);
  if (q.minViews) where.push('r.views >= ?'), args.push(q.minViews);
  if (q.sinceDays) where.push('r.posted >= ?'), args.push(since(q.sinceDays));
  if (q.dur) where.push(durationWhere('r.duration', q.dur));
  if (q.beat) where.push('EXISTS (SELECT 1 FROM insp_beats b WHERE b.project = r.project AND b.account = r.account AND b.code = r.code AND b.tag = ?)'), args.push(q.beat);
  if (q.cta === 'yes') where.push("r.cta IS NOT NULL AND r.cta <> ''");
  if (q.cta === 'no') where.push("r.state = 'ready' AND (r.cta IS NULL OR r.cta = '')");
  if (q.state === 'ready') where.push("r.state = 'ready'");
  if (q.state === 'unanalysed') where.push("r.state IN ('pending', 'processed')");
  if (q.state === 'error') where.push("r.state = 'error'");

  const from = 'FROM insp_reels r JOIN insp_accounts a ON a.project = r.project AND a.username = r.account';
  const w = (xs: string[]) => (xs.length ? `WHERE ${xs.join(' AND ')}` : '');
  const col = SORTS[q.sort ?? ''] ?? 'r.posted';
  const dir = q.desc === false ? 'ASC' : 'DESC';
  const size = Math.min(100, Math.max(1, q.size ?? 10));
  const page = Math.max(0, q.page ?? 0);
  const total = (d.prepare(`SELECT count(*) n ${from} ${w(where)}`).get(...args) as {n: number}).n;
  const rows = d
    .prepare(
      `SELECT r.account, r.code, r.url, r.caption, r.posted, r.views, r.likes, r.comments, r.duration, r.ratio, r.wps, r.state, r.error, r.topic, r.hook_text, r.thumb, r.metrics_at
       ${from} ${w(where)} ORDER BY (${col} IS NULL), ${col} ${dir}, r.posted DESC, r.code LIMIT ? OFFSET ?`,
    )
    .all(...args, size, page * size) as IndexRow[];
  // What "Procesar" would pick up, in the whole scope (not only what the filters show).
  const counts = Object.fromEntries((d.prepare(`SELECT r.state, count(*) n ${from} ${w(scopeWhere)} GROUP BY r.state`).all(...scopeArgs) as {state: string; n: number}[]).map((x) => [x.state, x.n]));
  return {rows, total, counts};
}

// The accounts with reels in the index (for the "Todos" filter).
export function accountNames() {
  return (read().prepare('SELECT username FROM insp_accounts WHERE project = ? AND reels > 0 ORDER BY username').all(PROJECT) as {username: string}[]).map((a) => a.username);
}

// The account a reel is under, from its code (the card opened from "Todos" or the loose videos).
export function accountOf(code: string) {
  return (read().prepare('SELECT account FROM insp_reels WHERE project = ? AND code = ? ORDER BY account LIMIT 1').get(PROJECT, code) as {account: string} | undefined)?.account ?? null;
}
