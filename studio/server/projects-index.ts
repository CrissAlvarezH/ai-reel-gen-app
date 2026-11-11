// The projects' part of the studio's index (db.ts): every project, its videos (Biblioteca) and its Instagram
// account with its reels (Mi cuenta), for Mi cuenta's table and for the agent's queries across them. Rebuilt
// from the files in projects/<id>/ (they stay the source of truth): sync re-reads only the videos and reels
// whose files changed (by their modification times).
//
// A reel of the project's account is linked to the video it was made from when their texts start the same
// (the reel's caption and the video's caption.md or script): own_reels.video and videos.reel.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, listProjects} from './workspace.ts';
import {readJson} from './platform.ts';
import {CREATED, createdOf} from './created.ts';
import {kindIn, manifestIn} from './carousel.ts';
import {register, read as readIndex, dirs, mtime, median, norm, strs, json, row, words, since, durationWhere, type DB, type DURATIONS} from './db.ts';
import type {CloudReelMetrics, InspirationProfile, OwnReel, PostedReel, ReelAnalysis, ReelTranscript} from '../shared/types.ts';

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const USER = /^[a-z0-9._]{1,30}$/;
const CODE = /^[A-Za-z0-9_-]{5,40}$/;

const SCHEMA = `
CREATE TABLE projects (       -- each channel the studio works on: projects/<id>/
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  created   INTEGER,           -- ms since epoch
  current   INTEGER NOT NULL,  -- 1: the one open in the studio now
  account   TEXT,              -- its Instagram account (Mi cuenta: config/account.json), without @
  videos    INTEGER NOT NULL
);
CREATE TABLE videos (         -- the publications made in the studio (Biblioteca), of every project: videos and carousels
  project   TEXT NOT NULL,     -- projects.id
  slug      TEXT NOT NULL,     -- its folder: projects/<project>/videos/<slug>/
  kind      TEXT NOT NULL,     -- 'video' or 'carousel' (kind.txt; none: video)
  slides    INTEGER,           -- carousels: slides in carousel.json (null for videos)
  title     TEXT,              -- its name in the studio (title.txt)
  style     TEXT,              -- visual style: an id in styles/ (style.txt; null: the default)
  script    TEXT,              -- the narration (audio/vo.txt); carousels: each slide's text, one line per slide
  words     INTEGER,           -- of the script
  hook      TEXT,              -- the script's first sentence
  caption   TEXT,              -- the post's text (caption.md)
  voice     INTEGER NOT NULL,  -- 1: the voice is recorded (audio/vo.mp3)
  seconds   REAL,              -- length of the recorded voice (src/words.json), or null
  renders   INTEGER NOT NULL,  -- versions rendered (out/*.mp4; carousels: out/vN/)
  rendered  INTEGER,           -- newest render, ms (null: none)
  created   INTEGER,           -- ms
  updated   INTEGER,           -- newest of the folder, the script and the renders, ms
  reel      TEXT,              -- own_reels.code of the reel it was posted as (matched by its text), or null
  search    TEXT NOT NULL,     -- internal: title, script and caption, lowercase and without accents, for LIKE
  sig       TEXT NOT NULL,     -- internal
  PRIMARY KEY (project, slug)
);
CREATE TABLE video_beats (    -- each video's script structure (audio/beats.json)
  project   TEXT NOT NULL,
  slug      TEXT NOT NULL,     -- videos.(project, slug)
  idx       INTEGER NOT NULL,  -- order in the script
  tag       TEXT NOT NULL,     -- hook · contexto · rehook · desarrollo · ejemplo · payoff · cta · cierre
  line      TEXT NOT NULL,     -- the script's line where it starts
  PRIMARY KEY (project, slug, idx)
);
CREATE TABLE own_accounts (   -- Mi cuenta: the project's own Instagram account (and any other downloaded into it before)
  project    TEXT NOT NULL,    -- projects.id
  username   TEXT NOT NULL,    -- without @
  configured INTEGER NOT NULL, -- 1: the project's account now (projects.account)
  full_name  TEXT,
  fetched    INTEGER,          -- last download, ms
  error      TEXT,             -- of the last download
  reels      INTEGER NOT NULL, -- reels downloaded
  median     REAL,             -- median views of them (null with fewer than 5)
  engagement REAL,             -- mean of their (likes + comments) / views
  followers  INTEGER,
  following  INTEGER,
  posts      INTEGER,          -- posts of every kind on its profile
  bio        TEXT,
  verified   INTEGER,
  category   TEXT,
  website    TEXT,
  profile_at INTEGER,
  PRIMARY KEY (project, username)
);
CREATE TABLE own_reels (      -- Mi cuenta: its reels, with their numbers
  project    TEXT NOT NULL,    -- own_accounts.(project, username)
  account    TEXT NOT NULL,
  code       TEXT NOT NULL,    -- Instagram shortcode: https://www.instagram.com/reel/<code>/
  url        TEXT NOT NULL,
  caption    TEXT,
  posted     TEXT,             -- ISO date-time it was published
  views      INTEGER,
  likes      INTEGER,          -- null when hidden
  comments   INTEGER,
  duration   REAL,             -- seconds
  music      TEXT,
  ratio      REAL,             -- views / its account's median (null with fewer than 5 reels)
  engagement REAL,             -- (likes + comments) / views
  metrics_at INTEGER,          -- when views, likes and comments were read, ms
  added      INTEGER,
  hashtags   TEXT,             -- JSON array (meta.json)
  thumb      INTEGER NOT NULL, -- 1: thumb.jpg exists
  video      TEXT,             -- videos.slug (same project) it was made from, or null
  state      TEXT NOT NULL,    -- its analysis (Analizar, on the page): pending (not transcribed) · processed (transcribed, not analysed) · ready (analysed) · error
  error      TEXT,             -- of the last processing or analysis
  language   TEXT,             -- of the voice (transcript.json)
  words      INTEGER,
  wps        REAL,             -- words per second of the voice
  no_audio   INTEGER,          -- 1: the video has no audio
  transcript TEXT,             -- full text of the voice
  topic      TEXT,             -- the agent's analysis (analysis.json) from here on
  hook_text  TEXT,             -- what's said and read in the first 3 s
  hook_visual TEXT,
  hook_why   TEXT,             -- why it hooks (or doesn't)
  cta        TEXT,             -- the call to action, literal, or null
  visuals    TEXT,             -- JSON array of visual devices
  takeaways  TEXT,             -- JSON array: what to repeat and what to change
  analysed_at INTEGER,
  sheets     INTEGER NOT NULL, -- frame sheets (sheet_NN.jpg, 30 s each)
  saves      INTEGER,          -- from here on, Instagram's own numbers (insights.json, through his Reel Studio account; null without it or while Meta has none): times saved
  shares     INTEGER,
  reach      INTEGER,          -- accounts that saw it (Meta's estimate)
  avg_watch  REAL,             -- seconds watched per play, on average
  retention  REAL,             -- avg_watch / duration
  skip_rate  REAL,             -- % of plays skipped in the first seconds
  insights_at INTEGER,         -- when they were read, ms
  search     TEXT NOT NULL,    -- internal: caption, hashtags, music, transcript and analysis, lowercase and without accents, for LIKE
  sig        TEXT NOT NULL,    -- internal
  PRIMARY KEY (project, account, code)
);
CREATE INDEX own_reels_posted ON own_reels (posted);
CREATE TABLE own_beats (      -- Mi cuenta: each analysed reel's structure, as the agent saw it
  project TEXT NOT NULL,
  account TEXT NOT NULL,
  code    TEXT NOT NULL,       -- own_reels.(project, account, code)
  idx     INTEGER NOT NULL,
  tag     TEXT NOT NULL,       -- hook · contexto · rehook · desarrollo · ejemplo · payoff · cta · cierre
  start   REAL NOT NULL,       -- seconds
  "end"   REAL NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (project, account, code, idx)
);
`;

const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const ls = (p: string) => {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
};

type ReelFile = {code: string; url: string; caption: string; posted: string | null; views: number | null; likes: number | null; comments: number | null; duration: number | null; music: string | null; metricsAt: number; added: number; error?: string | null};
type AccountFile = {username: string; fullName: string | null; profile: InspirationProfile | null; fetched: number | null; error: string | null};
type InsightsFile = {metrics?: Partial<CloudReelMetrics>; at?: number};

const VIDEO_FILES = [CREATED, 'title.txt', 'style.txt', 'audio/vo.txt', 'audio/beats.json', 'caption.md', 'audio/vo.mp3', 'src/words.json', 'kind.txt', 'carousel.json'];
const REEL_FILES = ['reel.json', 'meta.json', 'thumb.jpg', 'transcript.json', 'hook.jpg', 'analysis.json', 'insights.json'];

// Each returns whether anything changed.
function syncVideos(d: DB, ids: string[]) {
  let changed = false;
  const known = new Map((d.prepare('SELECT project, slug, sig FROM videos').all() as {project: string; slug: string; sig: string}[]).map((r) => [`${r.project}/${r.slug}`, r.sig]));
  const seen = new Set<string>();
  const upsert = d.prepare(
    `INSERT OR REPLACE INTO videos (project, slug, kind, slides, title, style, script, words, hook, caption, voice, seconds, renders, rendered, created, updated, reel, search, sig) VALUES (${Array(19).fill('?').join(', ')})`,
  );
  const delBeats = d.prepare('DELETE FROM video_beats WHERE project = ? AND slug = ?');
  const addBeat = d.prepare('INSERT INTO video_beats (project, slug, idx, tag, line) VALUES (?, ?, ?, ?, ?)');
  const oldReel = d.prepare('SELECT reel FROM videos WHERE project = ? AND slug = ?');
  for (const id of ids) {
    const vids = path.join(ROOT, 'projects', id, 'videos');
    for (const slug of dirs(vids, (n) => SLUG.test(n))) {
      const dir = path.join(vids, slug);
      const kind = kindIn(dir);
      const outs = ls(path.join(dir, 'out')).filter((n) => (kind === 'carousel' ? /^v\d+$/.test(n) : /\.mp4$/i.test(n)));
      const renders = outs.map((n) => mtime(path.join(dir, 'out', n)));
      const sig = [mtime(dir), ...VIDEO_FILES.map((f) => mtime(path.join(dir, f))), ...renders].join(',');
      const key = `${id}/${slug}`;
      seen.add(key);
      if (known.get(key) === sig) continue;
      changed = true;
      const deck = kind === 'carousel' ? manifestIn(dir).slides : null;
      const script = deck ? deck.map((x) => x.text.replace(/\s+/g, ' ').trim()).join('\n').trim() : (read(path.join(dir, 'audio/vo.txt'))?.trim() ?? '');
      const title = read(path.join(dir, 'title.txt'))?.trim() || null;
      const caption = read(path.join(dir, 'caption.md'))?.trim() || null;
      const words = readJson<{e: number}[]>(path.join(dir, 'src/words.json'));
      const beats = readJson<unknown>(path.join(dir, 'audio/beats.json'));
      const rendered = renders.length ? Math.max(...renders) : null;
      const created = createdOf(dir) ?? 0;
      const prev = (oldReel.get(id, slug) as {reel: string | null} | undefined)?.reel ?? null;
      upsert.run(
        ...row([
          id, slug, kind, deck ? deck.length : null, title, read(path.join(dir, 'style.txt'))?.trim() || null, script || null, script ? script.split(/\s+/).filter(Boolean).length : 0,
          script.split(/(?<=[.?!…])\s/)[0] || null, caption, mtime(path.join(dir, 'audio/vo.mp3')) ? 1 : 0,
          Array.isArray(words) && words.length ? Math.round(words[words.length - 1].e * 10) / 10 : null, outs.length, rendered, Math.round(created),
          Math.round(Math.max(mtime(dir), mtime(path.join(dir, 'audio/vo.txt')), rendered ?? 0)), prev, norm([title, script, caption].filter(Boolean).join('\n')), sig,
        ]),
      );
      delBeats.run(id, slug);
      if (Array.isArray(beats))
        beats.forEach((b: {tag?: unknown; line?: unknown}, i) => typeof b?.tag === 'string' && typeof b.line === 'string' && addBeat.run(id, slug, i, b.tag, b.line));
    }
  }
  for (const key of known.keys()) {
    if (seen.has(key)) continue;
    const [p, s] = key.split('/');
    d.prepare('DELETE FROM videos WHERE project = ? AND slug = ?').run(p, s);
    delBeats.run(p, s);
    changed = true;
  }
  return changed;
}

// rebuild: the projects or their accounts changed (own_accounts is made again even if no reel did).
function syncAccounts(d: DB, ids: string[], configured: Map<string, string | null>, rebuild: boolean) {
  let changed = false;
  const known = new Map(
    (d.prepare('SELECT project, account, code, sig FROM own_reels').all() as {project: string; account: string; code: string; sig: string}[]).map((r) => [`${r.project}/${r.account}/${r.code}`, r.sig]),
  );
  const seen = new Set<string>();
  const upsert = d.prepare(
    `INSERT OR REPLACE INTO own_reels (project, account, code, url, caption, posted, views, likes, comments, duration, music, ratio, engagement, metrics_at, added, hashtags, thumb, video,
      state, error, language, words, wps, no_audio, transcript, topic, hook_text, hook_visual, hook_why, cta, visuals, takeaways, analysed_at, sheets,
      saves, shares, reach, avg_watch, retention, skip_rate, insights_at, search, sig) VALUES (${Array(43).fill('?').join(', ')})`,
  );
  const delBeats = d.prepare('DELETE FROM own_beats WHERE project = ? AND account = ? AND code = ?');
  const addBeat = d.prepare('INSERT INTO own_beats (project, account, code, idx, tag, start, "end", summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const oldVideo = d.prepare('SELECT video FROM own_reels WHERE project = ? AND account = ? AND code = ?');
  const accounts: {project: string; a: AccountFile | null; username: string; reels: number}[] = [];
  for (const id of ids) {
    const accs = path.join(ROOT, 'projects', id, 'account');
    for (const u of dirs(accs, (n) => USER.test(n))) {
      const dir = path.join(accs, u);
      let count = 0;
      for (const c of dirs(dir, (n) => CODE.test(n))) {
        const rd = path.join(dir, c);
        const sheets = ls(rd).filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).length;
        const sig = REEL_FILES.map((f) => mtime(path.join(rd, f))).join(',') + `,${sheets}`;
        if (sig.startsWith('0,')) continue; // no reel.json
        count++;
        const key = `${id}/${u}/${c}`;
        seen.add(key);
        if (known.get(key) === sig) continue;
        changed = true;
        const r = readJson<ReelFile>(path.join(rd, 'reel.json'));
        if (!r) continue;
        const meta = readJson<{hashtags?: unknown}>(path.join(rd, 'meta.json')) ?? {};
        const hashtags = strs(meta.hashtags);
        const prev = (oldVideo.get(id, u, c) as {video: string | null} | undefined)?.video ?? null;
        const an = readJson<ReelAnalysis>(path.join(rd, 'analysis.json'));
        const t = readJson<ReelTranscript>(path.join(rd, 'transcript.json'));
        const ins = readJson<InsightsFile>(path.join(rd, 'insights.json'));
        const m = ins?.metrics;
        const avgWatch = typeof m?.avgWatchMs === 'number' ? m.avgWatchMs / 1000 : null;
        const state = r.error ? 'error' : an ? 'ready' : t && mtime(path.join(rd, 'hook.jpg')) ? 'processed' : 'pending';
        const visuals = strs(an?.visuals);
        const takeaways = strs(an?.takeaways);
        const structure = Array.isArray(an?.structure) ? an.structure : [];
        const search = norm(
          [r.caption, ...hashtags.map((h) => `#${h}`), r.music, t?.text, an?.topic, an?.hook?.text, an?.hook?.visual, an?.hook?.why, an?.cta, ...visuals, ...takeaways, ...structure.map((s) => s.summary)]
            .filter(Boolean)
            .join('\n'),
        );
        upsert.run(
          ...row([
            id, u, c, r.url ?? `https://www.instagram.com/reel/${c}/`, r.caption ?? '', r.posted, r.views, r.likes, r.comments, r.duration, r.music, null,
            r.views ? ((r.likes ?? 0) + (r.comments ?? 0)) / r.views : null, r.metricsAt, r.added, json(hashtags), mtime(path.join(rd, 'thumb.jpg')) ? 1 : 0, prev,
            state, r.error ?? null, t?.language ?? null, t?.words ?? null, t?.wps ?? null, t?.noAudio ? 1 : 0, t?.text ?? null,
            an?.topic ?? null, an?.hook?.text ?? null, an?.hook?.visual ?? null, an?.hook?.why ?? null, an?.cta ?? null, json(visuals), json(takeaways), an?.at ?? null, sheets,
            m?.saves ?? null, m?.shares ?? null, m?.reach ?? null, avgWatch, avgWatch != null && r.duration ? avgWatch / r.duration : null, m?.skipRate ?? null, ins?.at ?? null, search, sig,
          ]),
        );
        delBeats.run(id, u, c);
        structure.forEach((s, i) => addBeat.run(id, u, c, i, String(s.tag), Number(s.start) || 0, Number(s.end) || 0, s.summary ?? ''));
      }
      accounts.push({project: id, a: readJson<AccountFile>(path.join(dir, 'account.json')), username: u, reels: count});
    }
  }
  for (const key of known.keys()) {
    if (seen.has(key)) continue;
    const [p, u, c] = key.split('/');
    d.prepare('DELETE FROM own_reels WHERE project = ? AND account = ? AND code = ?').run(p, u, c);
    delBeats.run(p, u, c);
    changed = true;
  }
  if (!changed && !rebuild) return false;
  // The accounts, their medians and each reel's ratio to it.
  d.exec('DELETE FROM own_accounts');
  const add = d.prepare(
    `INSERT INTO own_accounts (project, username, configured, full_name, fetched, error, reels, median, engagement, followers, following, posts, bio, verified, category, website, profile_at) VALUES (${Array(17).fill('?').join(', ')})`,
  );
  const stats = d.prepare('SELECT views, engagement FROM own_reels WHERE project = ? AND account = ?');
  const setRatio = d.prepare('UPDATE own_reels SET ratio = CASE WHEN ? IS NULL OR views IS NULL THEN NULL ELSE views * 1.0 / ? END WHERE project = ? AND account = ?');
  for (const {project, a, username, reels} of accounts) {
    const rs = stats.all(project, username) as {views: number | null; engagement: number | null}[];
    const med = median(rs.map((x) => x.views).filter((v): v is number => v != null));
    const eng = rs.map((x) => x.engagement).filter((v): v is number => v != null);
    const pr = a?.profile;
    add.run(
      ...row([
        project, username, configured.get(project) === username ? 1 : 0, a?.fullName, a?.fetched, a?.error, reels, med, eng.length ? eng.reduce((n, x) => n + x, 0) / eng.length : null,
        pr?.followers, pr?.following, pr?.posts, pr?.bio, pr ? (pr.verified ? 1 : 0) : null, pr?.category, pr?.website, pr?.at,
      ]),
    );
    setRatio.run(med, med, project, username);
  }
  d.exec("DELETE FROM own_reels WHERE project || '/' || account NOT IN (SELECT project || '/' || username FROM own_accounts)");
  d.exec("DELETE FROM own_beats WHERE project || '/' || account || '/' || code NOT IN (SELECT project || '/' || account || '/' || code FROM own_reels)");
  return true;
}

// The start of a text, only its letters and digits: a reel's caption usually begins with the video's
// caption.md or its script's hook, and they part ways after a sentence or so. Two texts are the same post
// when they start with the same 40 letters (some 8 words), or one is all the other's start (at least 24).
const KEY = 80;
const SAME = 40;
const MIN_KEY = 24;
const keyOf = (t: string | null) =>
  norm(t ?? '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, KEY);
const sameStart = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= SAME || (i === n && n >= MIN_KEY);
};

// Each reel of a project's account to the video it came from; each video to its newest reel.
function link(d: DB) {
  const vids = d.prepare("SELECT project, slug, caption, script, reel FROM videos WHERE kind = 'video'").all() as {project: string; slug: string; caption: string | null; script: string | null; reel: string | null}[];
  const reels = d
    .prepare('SELECT r.project, r.account, r.code, r.caption, r.posted, r.video, a.configured FROM own_reels r JOIN own_accounts a ON a.project = r.project AND a.username = r.account')
    .all() as {project: string; account: string; code: string; caption: string; posted: string | null; video: string | null; configured: number}[];
  const keys = vids.map((v) => ({...v, keys: [keyOf(v.caption), keyOf(v.script)].filter((k) => k.length >= MIN_KEY)}));
  const setVideo = d.prepare('UPDATE own_reels SET video = ? WHERE project = ? AND account = ? AND code = ?');
  const setReel = d.prepare('UPDATE videos SET reel = ? WHERE project = ? AND slug = ?');
  const newest = new Map<string, {code: string; posted: string}>();
  for (const r of reels) {
    const k = keyOf(r.caption);
    const v = r.configured ? keys.find((v) => v.project === r.project && v.keys.some((x) => sameStart(x, k))) : undefined;
    const slug = v?.slug ?? null;
    if (slug !== r.video) setVideo.run(slug, r.project, r.account, r.code);
    if (!slug) continue;
    const vk = `${r.project}/${slug}`;
    const cur = newest.get(vk);
    if (!cur || (r.posted ?? '') > cur.posted) newest.set(vk, {code: r.code, posted: r.posted ?? ''});
  }
  for (const v of vids) {
    const code = newest.get(`${v.project}/${v.slug}`)?.code ?? null;
    if (code !== v.reel) setReel.run(code, v.project, v.slug);
  }
}

// What the projects and their accounts were at the last sync (of this database): when nothing changed, a
// sync only looks at the files' times.
let last: {d: DB; sig: string} | null = null;

function sync(d: DB) {
  const projects = listProjects();
  const ids = projects.map((p) => p.id);
  const configured = new Map(
    ids.map((id) => {
      const u = readJson<{username?: unknown}>(path.join(ROOT, 'projects', id, 'config', 'account.json'))?.username;
      return [id, typeof u === 'string' && USER.test(u) ? u : null] as const;
    }),
  );
  const accountFiles = ids.flatMap((id) => dirs(path.join(ROOT, 'projects', id, 'account')).map((u) => `${id}/${u}:${mtime(path.join(ROOT, 'projects', id, 'account', u, 'account.json'))}`));
  const sig = JSON.stringify([projects.map((p) => [p.id, p.name, p.created, p.current, p.videos]), [...configured], accountFiles]);
  const fresh = last?.d !== d || last.sig !== sig;
  if (fresh) {
    d.exec('DELETE FROM projects');
    const add = d.prepare('INSERT INTO projects (id, name, created, current, account, videos) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of projects) add.run(...row([p.id, p.name, p.created, p.current ? 1 : 0, configured.get(p.id), p.videos]));
  }
  const videos = syncVideos(d, ids);
  const reels = syncAccounts(d, ids, configured, fresh);
  if (fresh || videos || reels) link(d);
  last = {d, sig};
}
register({name: 'projects', schema: SCHEMA, sync});

/* ───── Mi cuenta and the library ───── */

export type OwnQuery = {
  q?: string; // words, all of them in the caption, hashtags or music
  minRatio?: number;
  sinceDays?: number;
  dur?: (typeof DURATIONS)[number];
  state?: 'ready' | 'unanalysed' | 'error';
  sort?: string;
  desc?: boolean;
  page?: number;
  size?: number;
};
type OwnRow = {
  code: string;
  url: string;
  caption: string;
  posted: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: number | null;
  music: string | null;
  ratio: number | null;
  engagement: number | null;
  metrics_at: number;
  thumb: number;
  video: string | null;
  video_title: string | null;
  state: OwnReel['state'];
  error: string | null;
  topic: string | null;
  hook_text: string | null;
  wps: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  avg_watch: number | null;
  retention: number | null;
  skip_rate: number | null;
};
const OWN_COLS =
  'r.code, r.url, r.caption, r.posted, r.views, r.likes, r.comments, r.duration, r.music, r.ratio, r.engagement, r.metrics_at, r.thumb, r.video, v.title video_title, r.state, r.error, r.topic, r.hook_text, r.wps, r.saves, r.shares, r.reach, r.avg_watch, r.retention, r.skip_rate';
const OWN_FROM = 'FROM own_reels r LEFT JOIN videos v ON v.project = r.project AND v.slug = r.video';
const own = (r: OwnRow): OwnReel => ({
  code: r.code,
  url: r.url,
  caption: r.caption,
  posted: r.posted,
  views: r.views,
  likes: r.likes,
  comments: r.comments,
  duration: r.duration,
  music: r.music,
  ratio: r.ratio,
  engagement: r.engagement,
  metricsAt: r.metrics_at,
  thumb: !!r.thumb,
  video: r.video ? {slug: r.video, title: r.video_title} : null,
  state: r.state,
  error: r.error,
  topic: r.topic,
  hook: r.hook_text,
  wps: r.wps,
  saves: r.saves,
  shares: r.shares,
  reach: r.reach,
  avgWatch: r.avg_watch,
  retention: r.retention,
  skipRate: r.skip_rate,
});
const OWN_SORTS: Record<string, string> = {
  posted: 'r.posted',
  views: 'r.views',
  ratio: 'r.ratio',
  likes: 'r.likes',
  comments: 'r.comments',
  engagement: 'r.engagement',
  duration: 'r.duration',
  wps: 'r.wps',
  saves: 'r.saves',
  shares: 'r.shares',
  reach: 'r.reach',
  retention: 'r.retention',
  skipRate: 'r.skip_rate',
};

// One page of an account's reels, filtered and in order (missing values last, whichever the direction).
export function ownList(project: string, account: string, q: OwnQuery) {
  const d = readIndex();
  const where = ['r.project = ?', 'r.account = ?'];
  const args: (string | number)[] = [project, account];
  for (const w of words(q.q)) where.push("r.search LIKE ? ESCAPE '\\'"), args.push(w);
  if (q.minRatio) where.push('r.ratio >= ?'), args.push(q.minRatio);
  if (q.sinceDays) where.push('r.posted >= ?'), args.push(since(q.sinceDays));
  if (q.dur) where.push(durationWhere('r.duration', q.dur));
  if (q.state === 'unanalysed') where.push("r.state IN ('pending', 'processed')");
  else if (q.state) where.push('r.state = ?'), args.push(q.state);
  const w = `WHERE ${where.join(' AND ')}`;
  const col = OWN_SORTS[q.sort ?? ''] ?? 'r.posted';
  const size = Math.min(100, Math.max(1, q.size ?? 10));
  const page = Math.max(0, q.page ?? 0);
  const total = (d.prepare(`SELECT count(*) n ${OWN_FROM} ${w}`).get(...args) as {n: number}).n;
  const rows = d
    .prepare(`SELECT ${OWN_COLS} ${OWN_FROM} ${w} ORDER BY (${col} IS NULL), ${col} ${q.desc === false ? 'ASC' : 'DESC'}, r.posted DESC, r.code LIMIT ? OFFSET ?`)
    .all(...args, size, page * size) as OwnRow[];
  return {rows: rows.map(own), total};
}

// The account's numbers and its n most viewed reels.
export function ownSummary(project: string, account: string, n: number) {
  const d = readIndex();
  const a = d.prepare('SELECT reels, median, engagement FROM own_accounts WHERE project = ? AND username = ?').get(project, account) as {reels: number; median: number | null; engagement: number | null} | undefined;
  const top = d.prepare(`SELECT ${OWN_COLS} ${OWN_FROM} WHERE r.project = ? AND r.account = ? AND r.views IS NOT NULL ORDER BY r.views DESC, r.posted DESC LIMIT ?`).all(project, account, n) as OwnRow[];
  const states = d.prepare('SELECT state, count(*) n FROM own_reels WHERE project = ? AND account = ? GROUP BY state').all(project, account) as {state: OwnReel['state']; n: number}[];
  return {count: a?.reels ?? 0, median: a?.median ?? null, engagement: a?.engagement ?? null, top: top.map(own), states: Object.fromEntries(states.map((x) => [x.state, x.n])) as Partial<Record<OwnReel['state'], number>>};
}

// Each reel's analysis state (by code), as the files say.
export const ownStates = (project: string, account: string) =>
  new Map((readIndex().prepare('SELECT code, state FROM own_reels WHERE project = ? AND account = ?').all(project, account) as {code: string; state: OwnReel['state']}[]).map((r) => [r.code, r.state]));

// One reel, and its place by views among the account's (1: the most viewed).
export function ownReel(project: string, account: string, code: string) {
  const d = readIndex();
  const r = d.prepare(`SELECT ${OWN_COLS} ${OWN_FROM} WHERE r.project = ? AND r.account = ? AND r.code = ?`).get(project, account, code) as OwnRow | undefined;
  if (!r) return null;
  const rank = r.views == null ? 0 : 1 + (d.prepare('SELECT count(*) n FROM own_reels WHERE project = ? AND account = ? AND views > ?').get(project, account, r.views) as {n: number}).n;
  return {reel: own(r), rank};
}

// The reel a video of the project was posted as, with its numbers (in the library).
export function postedAs(project: string, slug: string): PostedReel | null {
  const r = readIndex().prepare('SELECT o.code, o.url, o.views, o.ratio, o.posted FROM videos v JOIN own_reels o ON o.project = v.project AND o.code = v.reel WHERE v.project = ? AND v.slug = ?').get(project, slug) as
    | PostedReel
    | undefined;
  return r ?? null;
}
