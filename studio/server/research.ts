// Investigación: what's working on a topic in TikTok, YouTube Shorts and Instagram, for the open project's audience.
//   1. New research: a topic. The agent proposes the searches his audience would type, in its words, and its country.
//   2. Buscar (charged: ScrapeCreators' credits, Apify's balance): every search on every platform chosen
//      (server/research-platforms.ts); the same video found twice is one, with both searches. Too old or too long: out.
//      The agent then reads each video's caption and says whether it's for this audience (relevant, with its reason).
//   3. Each video's score, 0–100: how it ranks in this research on views, views per day, views over its author's
//      followers and interaction (likes, comments, shares and saves over views). Computed on read, never saved.
//   4. Analizar (his agent's subscription): the best ones are downloaded, transcribed and cut into frames
//      (tools/inspiration.py, as Inspiración's), then the agent analyses each one (hook, structure, visuals, CTA).
//   5. The report: the agent reads the ranking and the analyses and writes what works, the hooks, the gaps and ideas.
//
// In the workspace (per project, like Inspiración):
//   projects/<id>/research/<research>/research.json   {id, topic, queries, options, created, searched, runs, report, error}
//   projects/<id>/research/<research>/videos/<platform>-<id>/  reel.json (metrics, author, caption, relevant, reason;
//                                       videoUrl/displayUrl for tools/inspiration.py), meta.json (what the platform
//                                       returned), thumb.jpg, and once analysed: hook.jpg, sheet_NN.jpg, transcript.json, analysis.json
// Jobs live in memory, one per research, by its folder: a research keeps working in its own project after he opens
// another one (every path is taken when it starts); a new workspace stops them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {PROJECT_DIR, ROOT, inProject, rel} from './workspace.ts';
import {readJson, writeJson as writeJsonFile} from './platform.ts';
import {getKey} from './settings.ts';
import {httpError} from './reels.ts';
import {agentCli} from './agent.ts';
import {authorName, getProfile} from './config.ts';
import * as audience from './audience.ts';
import * as insp from './inspiration.ts';
import * as pf from './research-platforms.ts';
import * as sc from './scrapecreators.ts';
import {transcriberReady, ytdlpReady} from './requirements.ts';
import {RESEARCH_MAX_ANALYSE, RESEARCH_PLATFORMS, RESEARCH_SINCE} from '../shared/types.ts';
import type {ReelAnalysis, ReelTranscript, Research, ResearchDetail, ResearchEstimate, ResearchJob, ResearchOptions, ResearchPlatform, ResearchRun, ResearchStatus, ResearchVideo, ResearchVideoDetail, ServerEvent} from '../shared/types.ts';

export const ID = /^[a-f0-9]{8}$/;
export const KEY = /^(tiktok|youtube|instagram)-[A-Za-z0-9_-]{3,40}$/;
const PLATFORMS = RESEARCH_PLATFORMS.map((p) => p.id) as ResearchPlatform[];
const label = (p: ResearchPlatform) => RESEARCH_PLATFORMS.find((x) => x.id === p)!.label;
const MAX_QUERIES = 8;
const MAX_SECONDS = [60, 90, 180, 600] as const;
const YT_DETAILS = 20; // Shorts whose details are read per research (the most viewed of the search; 1 credit each)
const MAX_IG_PER_QUERY = 100;
const RELEVANCE_BATCH = 50;

const DIR = () => path.join(PROJECT_DIR, 'research');
const videoDir = (base: string, key: string) => path.join(base, 'videos', key);
const writeJson = (p: string, v: unknown) => writeJsonFile(p, v, 1);
const dirs = (p: string) => {
  try {
    return fs.readdirSync(p, {withFileTypes: true}).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    return [];
  }
};

/* ───── Files ───── */

type ResearchFile = Pick<Research, 'id' | 'topic' | 'queries' | 'options' | 'created' | 'searched' | 'runs' | 'report' | 'error'>;
// reel.json: what was found (Found without raw and query), the searches that found it and the agent's read of it.
type VideoFile = Omit<pf.Found, 'raw' | 'query'> & {key: string; queries: string[]; relevant: boolean | null; reason: string | null; added: number; error?: string | null};

const readResearch = (base: string) => readJson<ResearchFile>(path.join(base, 'research.json'));
const saveResearch = (base: string, r: ResearchFile) => writeJson(path.join(base, 'research.json'), r);
const readVideo = (base: string, key: string) => readJson<VideoFile>(path.join(videoDir(base, key), 'reel.json'));
const saveVideo = (base: string, v: VideoFile) => writeJson(path.join(videoDir(base, v.key), 'reel.json'), v);
const videoKeys = (base: string) => dirs(path.join(base, 'videos')).filter((k) => KEY.test(k));
const videos = (base: string) => videoKeys(base).map((k) => readVideo(base, k)).filter((v): v is VideoFile => !!v);
const has = (base: string, key: string, f: string) => fs.existsSync(path.join(videoDir(base, key), f));
const processed = (base: string, key: string) => has(base, key, 'transcript.json') && has(base, key, 'hook.jpg');

// A research's folder in the agent's project (or the open one), if it exists.
function baseOf(project: string | undefined, id: string) {
  if (!ID.test(id)) throw httpError(404, 'investigación no encontrada');
  const base = inProject(project, () => path.join(DIR(), id));
  if (!readResearch(base)) throw httpError(404, 'investigación no encontrada');
  return base;
}

/* ───── Live updates and jobs ───── */

let broadcast: (e: ServerEvent) => void = () => {};
export const setBroadcast = (fn: typeof broadcast) => void (broadcast = fn);
let pending: NodeJS.Timeout | undefined;
const changed = () => {
  clearTimeout(pending);
  pending = setTimeout(() => broadcast({type: 'research'}), 250);
};

type Work = {job: ResearchJob; ctrl: AbortController; busy: Map<string, 'processing' | 'analyzing'>; root: string};
const works = new Map<string, Work>(); // by research folder
class Stopped extends Error {}

// A new workspace: whatever runs in the old one stops (its folders aren't this workspace's).
export function reset() {
  for (const [base, w] of works) if (!base.startsWith(ROOT + path.sep)) w.ctrl.abort();
  changed();
}

// Runs fn as the research's job; one at a time per research. Its failure is saved on the research.
function start(base: string, stage: ResearchJob['stage'], fn: (w: Work) => Promise<void>) {
  if (works.has(base)) throw httpError(409, 'esta investigación ya está trabajando; espera a que termine o detenla');
  const w: Work = {job: {stage, done: 0, total: 0, started: Date.now()}, ctrl: new AbortController(), busy: new Map(), root: ROOT};
  works.set(base, w);
  const r = readResearch(base);
  if (r) saveResearch(base, {...r, error: null});
  changed();
  void fn(w)
    .catch((e) => {
      if (e instanceof Stopped || w.ctrl.signal.aborted || ROOT !== w.root) return;
      console.error(`investigación ${path.basename(base)}:`, e);
      const now = readResearch(base);
      if (now) saveResearch(base, {...now, error: (e as Error).message});
    })
    .finally(() => {
      works.delete(base);
      changed();
    });
}
// After every wait: not stopped, and still in the same workspace.
const live = (w: Work) => {
  if (w.ctrl.signal.aborted || ROOT !== w.root) throw new Stopped('detenido');
};
const stage = (w: Work, s: ResearchJob['stage'], total: number, note?: string) => {
  Object.assign(w.job, {stage: s, done: 0, total, note});
  changed();
};

// At most n at once.
async function each<T>(xs: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, xs.length)}, async () => {
    while (i < xs.length) await fn(xs[i++]);
  }));
}

/* ───── Score ───── */

const DAY = 86_400_000;
const metricsOf = (v: VideoFile, now: number) => {
  const views = v.views;
  const days = v.posted ? Math.max(1, (now - Date.parse(v.posted)) / DAY) : null;
  const inter = [v.likes, v.comments, v.shares, v.saves].reduce<number>((s, x) => s + (x ?? 0), 0);
  return {
    views,
    ratio: views != null && v.followers ? views / v.followers : null,
    perDay: views != null && days ? views / days : null,
    engagement: views ? inter / views : null,
  };
};
// What each one weighs in the score; one a video lacks (followers, outside TikTok) leaves its weight to the rest.
const WEIGHTS = {views: 0.25, perDay: 0.35, ratio: 0.2, engagement: 0.2} as const;

// Every video with its metrics and its score against the relevant ones of the research (or all, if none is yet).
export function score(list: VideoFile[], now = Date.now()) {
  const m = new Map(list.map((v) => [v.key, metricsOf(v, now)]));
  const pool = list.filter((v) => v.relevant !== false && v.views != null);
  const sorted = Object.fromEntries(
    (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => [k, pool.map((v) => m.get(v.key)![k]).filter((x): x is number => x != null).sort((a, b) => a - b)]),
  ) as Record<keyof typeof WEIGHTS, number[]>;
  // The share of the others in the pool below x (ties count half); self: x is one of them, so it doesn't count itself.
  const pct = (xs: number[], x: number, self: boolean) => {
    const others = xs.length - (self ? 1 : 0);
    if (others < 1) return 0.5;
    let below = 0;
    let same = 0;
    for (const y of xs) if (y < x) below++;
    else if (y === x) same++;
    return (below + (same - (self ? 1 : 0)) / 2) / others;
  };
  const inPool = new Set(pool.map((v) => v.key));
  return list.map((v) => {
    const x = m.get(v.key)!;
    let sum = 0;
    let weight = 0;
    for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
      const val = x[k];
      if (val == null || !sorted[k].length) continue;
      sum += WEIGHTS[k] * pct(sorted[k], val, inPool.has(v.key));
      weight += WEIGHTS[k];
    }
    return {v, ratio: x.ratio, perDay: x.perDay, engagement: x.engagement, score: weight && v.views != null ? Math.round((100 * sum) / weight) : null};
  });
}

/* ───── Reading ───── */

function view(base: string, v: VideoFile, s: {ratio: number | null; perDay: number | null; engagement: number | null; score: number | null}, w?: Work): ResearchVideo {
  const analysis = readJson<ReelAnalysis>(path.join(videoDir(base, v.key), 'analysis.json'));
  return {
    key: v.key,
    platform: v.platform,
    id: v.id,
    url: v.url,
    author: v.author,
    authorName: v.authorName,
    followers: v.followers,
    title: v.title,
    posted: v.posted,
    duration: v.duration,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saves,
    region: v.region,
    queries: v.queries,
    relevant: v.relevant,
    reason: v.reason,
    ...s,
    thumb: has(base, v.key, 'thumb.jpg'),
    state: w?.busy.get(v.key) ?? (v.error ? 'error' : analysis ? 'ready' : processed(base, v.key) ? 'processed' : 'pending'),
    error: v.error ?? null,
    analysis,
  };
}

// The research's videos, best first (those without a score last).
function scored(base: string) {
  const w = works.get(base);
  return score(videos(base))
    .map(({v, ...s}) => view(base, v, s, w))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.views ?? 0) - (a.views ?? 0));
}

function summary(base: string): Research | null {
  const r = readResearch(base);
  if (!r) return null;
  const vs = videos(base);
  return {
    ...r,
    job: works.get(base)?.job ?? null,
    counts: {videos: vs.length, relevant: vs.filter((v) => v.relevant !== false).length, analysed: vs.filter((v) => has(base, v.key, 'analysis.json')).length},
  };
}

const ready = () => Object.fromEntries(RESEARCH_PLATFORMS.map((p) => [p.id, !!getKey(p.key)])) as Record<ResearchPlatform, boolean>;

export async function status(project?: string): Promise<ResearchStatus> {
  const root = inProject(project, DIR);
  const researches = dirs(root)
    .filter((id) => ID.test(id))
    .map((id) => summary(path.join(root, id)))
    .filter((r): r is Research => !!r)
    .sort((a, b) => b.created - a.created);
  const [transcriber, youtubeDownloader] = await Promise.all([transcriberReady(), ytdlpReady()]);
  return {researches, ready: ready(), transcriber, youtubeDownloader};
}

export function detail(project: string | undefined, id: string): ResearchDetail {
  const base = baseOf(project, id);
  return {...summary(base)!, videos: scored(base)};
}

export function video(project: string | undefined, id: string, key: string): ResearchVideoDetail {
  const base = baseOf(project, id);
  if (!KEY.test(key)) throw httpError(404, 'video no encontrado');
  const v = scored(base).find((x) => x.key === key);
  if (!v) throw httpError(404, 'video no encontrado');
  const d = videoDir(base, key);
  let sheets: string[] = [];
  try {
    sheets = fs.readdirSync(d).filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).sort();
  } catch {
    /* gone */
  }
  return {...v, transcript: readJson<ReelTranscript>(path.join(d, 'transcript.json')), files: {thumb: v.thumb, hook: has(base, key, 'hook.jpg'), sheets}};
}

// Files the page shows (open project): the cover and the frames.
export function file(id: string, key: string, f: string) {
  if (!ID.test(id) || !KEY.test(key) || !/^(thumb|hook|sheet_\d{2})\.jpg$/.test(f)) return null;
  const p = path.join(videoDir(path.join(DIR(), id), key), f);
  return fs.existsSync(p) ? p : null;
}

/* ───── Creating and editing ───── */

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
function cleanQueries(v: unknown) {
  if (!Array.isArray(v)) throw httpError(400, 'las búsquedas deben ser una lista');
  const qs = [...new Set(v.map((q) => text(q, 80)).filter(Boolean))];
  if (!qs.length) throw httpError(400, 'escribe al menos una búsqueda');
  if (qs.length > MAX_QUERIES) throw httpError(400, `como mucho ${MAX_QUERIES} búsquedas`);
  return qs;
}
function cleanOptions(v: unknown, was: ResearchOptions): ResearchOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const platforms = o.platforms === undefined ? was.platforms : Array.isArray(o.platforms) ? PLATFORMS.filter((p) => (o.platforms as unknown[]).includes(p)) : [];
  if (!platforms.length) throw httpError(400, 'elige al menos una plataforma');
  const sinceDays = o.sinceDays === undefined ? was.sinceDays : Number(o.sinceDays);
  if (!(RESEARCH_SINCE as readonly number[]).includes(sinceDays)) throw httpError(400, `antigüedad no válida: ${RESEARCH_SINCE.join(', ')} días (0: sin límite)`);
  const maxSeconds = o.maxSeconds === undefined ? was.maxSeconds : Number(o.maxSeconds);
  if (!(MAX_SECONDS as readonly number[]).includes(maxSeconds)) throw httpError(400, `duración máxima no válida: ${MAX_SECONDS.join(', ')} s`);
  const perQuery = o.perQuery === undefined ? was.perQuery : Number(o.perQuery);
  if (!Number.isInteger(perQuery) || perQuery < 5 || perQuery > MAX_IG_PER_QUERY) throw httpError(400, `de 5 a ${MAX_IG_PER_QUERY} reels de Instagram por búsqueda`);
  const country = o.country === undefined ? was.country : typeof o.country === 'string' && /^[a-z]{2}$/i.test(o.country.trim()) ? o.country.trim().toUpperCase() : null;
  return {platforms, sinceDays, maxSeconds, perQuery, country};
}

// The defaults: the platforms whose key is set (all if none), the last 3 months, up to 3 minutes.
const DEFAULTS = (): ResearchOptions => {
  const r = ready();
  const on = PLATFORMS.filter((p) => r[p]);
  return {platforms: on.length ? on : PLATFORMS, sinceDays: 90, maxSeconds: 180, perQuery: 30, country: null};
};

// A new research: saved now with the topic as its only search; the agent's searches (and country) arrive in the
// background unless they were given (queries).
export function create(project: string | undefined, input: unknown): Research {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const topic = text(i.topic, 200);
  if (!topic) throw httpError(400, 'escribe el tema que quieres investigar');
  const given = i.queries === undefined ? null : cleanQueries(i.queries);
  const options = cleanOptions(i, DEFAULTS());
  const root = inProject(project, DIR);
  let id = crypto.randomBytes(4).toString('hex');
  while (fs.existsSync(path.join(root, id))) id = crypto.randomBytes(4).toString('hex');
  const base = path.join(root, id);
  saveResearch(base, {id, topic, queries: given ?? [topic], options, created: Date.now(), searched: null, runs: [], report: null, error: null});
  if (!given) {
    const prompt = inProject(project, () => queriesPrompt(topic));
    start(base, 'queries', async (w) => {
      const answer = await agentCli.ask(prompt, 'You answer only with the JSON asked for, nothing else.', {timeout: 3 * 60_000, signal: w.ctrl.signal});
      live(w);
      const o = audience.parseJson(answer) as {queries?: unknown; country?: unknown};
      const r = readResearch(base);
      if (!r) return;
      let queries = r.queries;
      try {
        queries = cleanQueries(Array.isArray(o.queries) ? o.queries.slice(0, MAX_QUERIES) : []);
      } catch {
        throw new Error('el agente no propuso búsquedas: escríbelas tú');
      }
      const country = typeof o.country === 'string' && /^[a-z]{2}$/i.test(o.country) ? o.country.toUpperCase() : r.options.country;
      saveResearch(base, {...r, queries, options: {...r.options, country}});
    });
  } else changed();
  return summary(base)!;
}

// What the audience is, wants and suffers, for the agent's prompts (in the research's project).
function audienceText() {
  const a = audience.get();
  return [
    audience.context(a),
    a.wants.length ? `What they want: ${a.wants.slice(0, 15).map((w) => w.want).join('; ')}.` : '',
    a.problems.length ? `What they deal with: ${a.problems.slice(0, 15).join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const queriesPrompt = (topic: string) => `${audienceText()}

He wants to research what short videos work on TikTok, YouTube Shorts and Instagram about: «${topic}».
Propose 4 to 6 searches his audience would actually type in those apps' search bars to find videos on this topic: short (2 to 5 words), in the audience's language and everyday words, using the names they'd use where they live (local programs, institutions, slang). Cover different angles of the topic, not the same words reordered.
Also say the audience's country as an ISO 3166 two-letter code, or null if it isn't one country.
Answer with a JSON object: {"queries": ["…"], "country": "CO"}`;

export function edit(project: string | undefined, id: string, input: unknown): Research {
  const base = baseOf(project, id);
  if (works.has(base)) throw httpError(409, 'espera a que termine lo que está haciendo');
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const r = readResearch(base)!;
  const topic = i.topic === undefined ? r.topic : text(i.topic, 200);
  if (!topic) throw httpError(400, 'escribe el tema que quieres investigar');
  saveResearch(base, {...r, topic, queries: i.queries === undefined ? r.queries : cleanQueries(i.queries), options: cleanOptions(i.options ?? {}, r.options)});
  changed();
  return summary(base)!;
}

export function remove(project: string | undefined, id: string) {
  const base = baseOf(project, id);
  if (works.has(base)) throw httpError(409, 'está trabajando: detenla antes de borrarla');
  fs.rmSync(base, {recursive: true, force: true});
  changed();
}

// He says a video is (or isn't) for his audience: it enters (or leaves) the ranking.
export function setRelevant(project: string | undefined, id: string, key: string, relevant: unknown) {
  const base = baseOf(project, id);
  const v = KEY.test(key) ? readVideo(base, key) : null;
  if (!v) throw httpError(404, 'video no encontrado');
  if (typeof relevant !== 'boolean') throw httpError(400, 'relevant debe ser true o false');
  saveVideo(base, {...v, relevant, reason: relevant === v.relevant ? v.reason : relevant ? 'marcado a mano como útil' : 'marcado a mano como no útil'});
  changed();
}

/* ───── Searching ───── */

const fmtUsd = insp.fmtUsd;

// What a search would cost at most, per platform.
export async function estimate(project: string | undefined, id: string): Promise<ResearchEstimate> {
  const base = baseOf(project, id);
  const r = readResearch(base)!;
  return estimateFor(r);
}
async function estimateFor(r: ResearchFile): Promise<ResearchEstimate> {
  const q = r.queries.length;
  const lines: ResearchEstimate['lines'] = [];
  let usd = 0;
  const credits = (n: number, what: string) => {
    const v = n * sc.CREDIT_USD;
    usd += v;
    return `${n} crédito${n === 1 ? '' : 's'} de ScrapeCreators como mucho (${what}; ≈ ${fmtUsd(Math.ceil(v * 1000) / 1000)})`;
  };
  for (const p of r.options.platforms) {
    if (p === 'tiktok') lines.push({platform: p, text: credits(q, `${q} búsqueda${q === 1 ? '' : 's'} de unos 30 videos`)});
    if (p === 'youtube') lines.push({platform: p, text: credits(q + YT_DETAILS, `${q} búsqueda${q === 1 ? '' : 's'} y el detalle de los ${YT_DETAILS} Shorts más vistos`)});
    if (p === 'instagram') {
      const pr = await pf.igPrices(getKey('APIFY_TOKEN'));
      const v = q * (r.options.perQuery * pr.item + pr.start);
      usd += v;
      lines.push({platform: p, text: `Apify cobra de tu saldo como mucho ${fmtUsd(Math.ceil(v * 1000) / 1000)} (${q} × ${r.options.perQuery} reels a ${fmtUsd(pr.item)} cada uno)`});
    }
  }
  return {lines, usd: Math.ceil(usd * 1000) / 1000};
}

export function search(project: string | undefined, id: string) {
  const base = baseOf(project, id);
  const r = readResearch(base)!;
  const missing = r.options.platforms.filter((p) => !ready()[p]);
  if (missing.length === r.options.platforms.length)
    throw httpError(400, `falta la clave de ${[...new Set(missing.map((p) => RESEARCH_PLATFORMS.find((x) => x.id === p)!.via))].join(' y ')}: ponla en Ajustes → Extracción de datos`);
  const ctx = inProject(project, () => ({audience: audienceText(), language: getProfile().language}));
  start(base, 'searching', (w) => runSearch(base, w, ctx));
  return summary(base)!;
}

type JudgeCtx = {audience: string; language: string};
async function runSearch(base: string, w: Work, ctx: JudgeCtx) {
  const r = readResearch(base)!;
  const {queries, options: o} = r;
  const found: pf.Found[] = [];
  const runs: ResearchRun[] = [];
  const keys = ready();
  const steps = o.platforms.reduce((n, p) => n + queries.length + (p === 'youtube' ? YT_DETAILS : 0), 0);
  stage(w, 'searching', steps);
  const tick = (n = 1) => {
    w.job.done += n;
    changed();
  };
  const errorsOf = (errors: string[]) => (errors.length ? [...new Set(errors)].slice(0, 2).join(' · ') : null);

  await Promise.all(
    o.platforms.map(async (p) => {
      const errors: string[] = [];
      const mine: pf.Found[] = [];
      let cost = '';
      if (!keys[p]) {
        tick(queries.length + (p === 'youtube' ? YT_DETAILS : 0));
        runs.push({platform: p, found: 0, cost: '—', error: `falta la clave de ${RESEARCH_PLATFORMS.find((x) => x.id === p)!.via} (Ajustes → Extracción de datos)`});
        return;
      }
      if (p === 'tiktok') {
        await each(queries, 3, async (q) => {
          try {
            mine.push(...(await pf.searchTikTok(q, o)));
          } catch (e) {
            errors.push((e as Error).message);
          }
          live(w);
          tick();
        });
        cost = `${queries.length} créditos`;
      } else if (p === 'youtube') {
        const hits = new Map<string, pf.ShortHit & {queries: string[]}>();
        await each(queries, 3, async (q) => {
          try {
            for (const h of await pf.searchShorts(q, o)) {
              const was = hits.get(h.id);
              if (was) was.queries.push(q);
              else hits.set(h.id, {...h, queries: [q]});
            }
          } catch (e) {
            errors.push((e as Error).message);
          }
          live(w);
          tick();
        });
        // The details of the most viewed (the search's counts are rounded, and its titles come translated).
        const top = [...hits.values()].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, YT_DETAILS);
        tick(YT_DETAILS - top.length);
        await each(top, 5, async (h) => {
          try {
            const f = await pf.shortDetail(h);
            if (f) for (const q of h.queries) mine.push({...f, query: q});
          } catch (e) {
            errors.push((e as Error).message);
          }
          live(w);
          tick();
        });
        cost = `${queries.length + top.length} créditos`;
      } else {
        const pr = await pf.igPrices(getKey('APIFY_TOKEN'));
        live(w);
        let usd = 0;
        await each(queries, 4, async (q) => {
          const cap = o.perQuery * pr.item * 1.25 + pr.start + 0.01;
          try {
            const {items, problem} = await pf.searchInstagram(q, o.perQuery, cap);
            mine.push(...items);
            if (problem) errors.push(problem);
          } catch (e) {
            errors.push((e as Error).message);
          }
          usd += o.perQuery * pr.item + pr.start;
          live(w);
          tick();
        });
        cost = `≈ ${fmtUsd(Math.ceil(usd * 1000) / 1000)} como mucho`;
      }
      found.push(...mine);
      runs.push({platform: p, found: new Set(mine.map((f) => f.id)).size, cost, error: mine.length ? errorsOf(errors) : (errorsOf(errors) ?? 'no encontró videos')});
    }),
  );
  live(w);

  // Too old or too long: out. The same video from several searches: one, with all of them.
  const cutoff = o.sinceDays ? Date.now() - o.sinceDays * DAY : 0;
  const keep = found.filter((f) => !(cutoff && f.posted && Date.parse(f.posted) < cutoff) && !(f.duration != null && f.duration > o.maxSeconds));
  const byKey = new Map<string, {f: pf.Found; queries: Set<string>}>();
  for (const f of keep) {
    const key = `${f.platform}-${f.id}`;
    if (!KEY.test(key)) continue;
    const was = byKey.get(key);
    if (was) was.queries.add(f.query);
    else byKey.set(key, {f, queries: new Set([f.query])});
  }
  for (const run of runs) run.found = [...byKey.values()].filter((x) => x.f.platform === run.platform).length;

  // Saved: a video seen in an earlier search keeps his and the agent's read of it, its analysis and its cover.
  const covers: {url: string; to: string}[] = [];
  for (const [key, {f, queries: qs}] of byKey) {
    const old = readVideo(base, key);
    const {raw, query: _q, ...rest} = f;
    saveVideo(base, {...rest, key, queries: [...new Set([...(old?.queries ?? []), ...qs])], relevant: old?.relevant ?? null, reason: old?.reason ?? null, added: old?.added ?? Date.now(), error: null});
    writeJson(path.join(videoDir(base, key), 'meta.json'), raw);
    const thumb = path.join(videoDir(base, key), 'thumb.jpg');
    if (f.displayUrl && !fs.existsSync(thumb)) covers.push({url: f.displayUrl, to: thumb});
  }
  const now = readResearch(base);
  if (now) saveResearch(base, {...now, searched: Date.now(), runs: PLATFORMS.flatMap((p) => runs.filter((x) => x.platform === p))});
  changed();
  await each(covers, 8, async (c) => {
    await insp.download(c.url, c.to).catch(() => {});
  });
  live(w);
  await judge(base, w, ctx, r.topic);
}

// The agent reads every video not judged yet and says whether it's for this audience, in batches.
async function judge(base: string, w: Work, ctx: JudgeCtx, topic: string) {
  const todo = videos(base).filter((v) => v.relevant == null);
  stage(w, 'filtering', todo.length);
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('es'));
  const batches: VideoFile[][] = [];
  for (let i = 0; i < todo.length; i += RELEVANCE_BATCH) batches.push(todo.slice(i, i + RELEVANCE_BATCH));
  let failed: string | null = null;
  for (const batch of batches) {
    const lines = batch.map((v) => `${v.key} | ${label(v.platform)} | @${v.author}${v.region ? ` | ${v.region}` : ''} | ${n(v.views)} views | ${v.title.replace(/\s+/g, ' ').slice(0, 240) || '(no caption)'}`);
    const prompt = `${ctx.audience}

He's researching what short videos work about «${topic}». For each video below (key | platform | author | country, if known | views | caption), say whether it's useful to study for HIS audience on this topic.
true: it's about this topic (or one very close) and its content could serve this audience (their language; their country's rules, prices and institutions when the topic depends on them).
false: another topic; another country whose context doesn't apply to this audience; another language; only an ad for one specific product, project or business that teaches nothing; or nothing to go on.
Answer with a JSON object: keys are the video keys, values are [true or false, "the reason in 3 to 8 words, in ${ctx.language}"].

${lines.join('\n')}`;
    try {
      const o = audience.parseJson(await agentCli.ask(prompt, 'You answer only with the JSON asked for, nothing else.', {timeout: 4 * 60_000, signal: w.ctrl.signal})) as Record<string, unknown>;
      live(w);
      for (const v of batch) {
        const a = o[v.key];
        const [ok, why] = Array.isArray(a) ? a : [a, null];
        if (typeof ok !== 'boolean') continue;
        const now = readVideo(base, v.key);
        if (now && now.relevant == null) saveVideo(base, {...now, relevant: ok, reason: typeof why === 'string' ? why.slice(0, 120) : null});
      }
    } catch (e) {
      live(w);
      failed = (e as Error).message;
    }
    w.job.done += batch.length;
    changed();
  }
  if (failed) throw new Error(`el agente no pudo filtrar todos los videos (${failed}); pulsa Buscar de nuevo para reintentarlo`);
}

/* ───── Analysis ───── */

const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('es'));
const fmtRatio = (x: number | null) => (x == null ? null : x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`);

function metricsLine(v: ResearchVideo) {
  return [
    `Publicado: ${v.posted?.slice(0, 10) ?? '—'}`,
    `duración ${v.duration != null ? `${Math.round(v.duration)} s` : '—'}`,
    `vistas ${n(v.views)}`,
    `likes ${n(v.likes)}`,
    `comentarios ${n(v.comments)}`,
    ...(v.shares != null ? [`compartidos ${n(v.shares)}`] : []),
    ...(v.saves != null ? [`guardados ${n(v.saves)}`] : []),
    ...(v.followers != null ? [`seguidores del autor ${n(v.followers)}${v.ratio != null ? ` (vistas = ${fmtRatio(v.ratio)} sus seguidores)` : ''}`] : []),
    ...(v.perDay != null ? [`${n(Math.round(v.perDay))} vistas/día`] : []),
    ...(v.engagement != null ? [`interacción ${(v.engagement * 100).toFixed(1)} %`] : []),
    `puntaje ${v.score ?? '—'}/100 en esta investigación`,
  ].join(' · ');
}

// Analizar: these videos (keys), or the best `top` of the relevant ones not analysed yet; then the report.
export async function analyse(project: string | undefined, id: string, input: unknown) {
  const base = baseOf(project, id);
  if (works.has(base)) throw httpError(409, 'esta investigación ya está trabajando; espera a que termine o detenla');
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const all = scored(base);
  let pick: ResearchVideo[];
  if (Array.isArray(i.keys)) {
    const want = new Set(i.keys.filter((k): k is string => typeof k === 'string'));
    pick = all.filter((v) => want.has(v.key));
    if (!pick.length || pick.length !== want.size) throw httpError(400, 'videos que no son de esta investigación');
  } else {
    const top = Number(i.top ?? 5);
    if (!Number.isInteger(top) || top < 1 || top > RESEARCH_MAX_ANALYSE) throw httpError(400, `de 1 a ${RESEARCH_MAX_ANALYSE} videos`);
    pick = all.filter((v) => v.relevant !== false && v.score != null && v.state !== 'ready').slice(0, top);
    if (!pick.length) throw httpError(400, all.length ? 'no quedan videos útiles sin analizar' : 'primero busca videos');
  }
  if (pick.length > RESEARCH_MAX_ANALYSE) throw httpError(400, `como mucho ${RESEARCH_MAX_ANALYSE} videos a la vez`);
  if (pick.some((v) => !processed(base, v.key)) && !(await transcriberReady())) throw httpError(400, 'falta la transcripción: instálala en Ajustes → Requisitos → Transcripción');
  if (pick.some((v) => v.platform === 'youtube' && !processed(base, v.key)) && !(await ytdlpReady()))
    throw httpError(400, 'para analizar YouTube Shorts falta yt-dlp: instálalo en Ajustes → Requisitos → Descarga de YouTube');
  const ctx = inProject(project, () => ({system: analystPrompt(readResearch(base)!.topic), report: reportPrompt(readResearch(base)!)}));
  start(base, 'processing', async (w) => {
    await runAnalyse(base, w, pick, ctx.system);
    await runReport(base, w, ctx.report);
  });
  return summary(base)!;
}

const analystPrompt = (topic: string) => {
  const p = getProfile();
  return [
    `Analizas videos cortos de TikTok, YouTube Shorts o Instagram sobre «${topic}» para que ${authorName()}, que hace videos explicativos para ${p.platform}${p.audience ? ` (público: ${p.audience})` : ''}, aprenda qué funciona y qué puede tomar.`,
    insp.IMAGES_NOTE,
    insp.analysisShape(p.language, '2–4 cosas concretas que vale la pena tomar para sus propios videos sobre este tema'),
  ].join('\n');
};

async function runAnalyse(base: string, w: Work, pick: ResearchVideo[], system: string) {
  const errors: string[] = [];
  const fail = (key: string, e: unknown) => {
    errors.push((e as Error).message);
    const v = readVideo(base, key);
    if (v) saveVideo(base, {...v, error: (e as Error).message});
  };
  for (const v of pick) {
    const f = readVideo(base, v.key);
    if (f?.error) saveVideo(base, {...f, error: null});
  }
  const toProcess = pick.filter((v) => !processed(base, v.key));
  stage(w, 'processing', toProcess.length);
  await Promise.all(
    toProcess.map((v) =>
      insp.processSlot(async () => {
        live(w); // waited in the queue
        w.busy.set(v.key, 'processing');
        changed();
        try {
          await insp.processDir(videoDir(base, v.key), w.ctrl.signal, true);
        } catch (e) {
          live(w);
          fail(v.key, e);
        } finally {
          w.busy.delete(v.key);
          w.job.done++;
          changed();
        }
      }),
    ),
  );
  live(w);
  const toAnalyse = pick.filter((v) => processed(base, v.key) && !readVideo(base, v.key)?.error);
  stage(w, 'analyzing', toAnalyse.length);
  await Promise.all(
    toAnalyse.map((v) =>
      insp.analyseSlot(async () => {
        live(w);
        w.busy.set(v.key, 'analyzing');
        changed();
        try {
          const d = videoDir(base, v.key);
          const t = readJson<ReelTranscript>(path.join(d, 'transcript.json'));
          const prompt = [
            `Video de ${label(v.platform)} de @${v.author}${v.authorName ? ` (${v.authorName})` : ''}: ${v.url}`,
            metricsLine(v),
            `Caption:\n${v.title.slice(0, 1500) || '(vacío)'}`,
            insp.transcriptText(t),
          ].join('\n\n');
          const sheets = fs.readdirSync(d).filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).sort().slice(0, 4);
          const images = [...(has(base, v.key, 'hook.jpg') ? [path.join(d, 'hook.jpg')] : []), ...sheets.map((s) => path.join(d, s))];
          const reply = await agentCli.ask(prompt, system, {model: 'smart', images, timeout: 4 * 60_000, signal: w.ctrl.signal});
          live(w);
          writeJson(path.join(d, 'analysis.json'), insp.parseAnalysis(reply));
        } catch (e) {
          live(w);
          fail(v.key, e);
        } finally {
          w.busy.delete(v.key);
          w.job.done++;
          changed();
        }
      }),
    ),
  );
  live(w);
  if (errors.length && errors.length === pick.length) throw new Error(errors[0]);
}

/* ───── Report ───── */

const reportPrompt = (r: ResearchFile) => {
  const p = getProfile();
  return [
    `Eres estratega de contenido de ${authorName()}, que hace videos explicativos de unos ${p.duration} s para ${p.platform}.`,
    audienceText(),
    `Investigó qué videos cortos funcionan sobre «${r.topic}» en ${r.options.platforms.map(label).join(', ')} (búsquedas: ${r.queries.map((q) => `«${q}»`).join(', ')}). Recibes los videos encontrados que le sirven a su audiencia, ordenados por puntaje (0–100: cómo rinde cada uno frente a los demás de esta investigación en vistas, vistas por día, vistas sobre los seguidores de su autor y la interacción), y el análisis de los que se analizaron.`,
    `Responde en markdown, en ${p.language}, en 700 palabras como mucho, con estas secciones:`,
    '## Los mejores videos — los 5 a 8 que más vale la pena estudiar, de mejor a peor, cada uno con su clave entre corchetes (p. ej. [tiktok-7299…]) y una línea de por qué funciona: sus datos y lo que hace.',
    '## Ángulos que funcionan — los enfoques del tema que más rinden, con los videos que lo muestran.',
    '## Ganchos que se repiten — fórmulas concretas, con un ejemplo literal.',
    '## Formato — duración, ritmo, recursos visuales, estructura y CTA de los que mejor van.',
    '## Huecos — lo que su audiencia quiere o sufre (su perfil) y estos videos no cubren bien.',
    '## Ideas para tus videos — 3 a 5 ideas concretas para su perfil, cada una con un gancho propuesto entre comillas.',
    'Cita siempre los videos por su clave entre corchetes, tal cual. No inventes: si hay pocos videos, pocos analizados o la diferencia no es clara, dilo. No copies guiones: adapta.',
  ].join('\n');
};

export function report(project: string | undefined, id: string) {
  const base = baseOf(project, id);
  if (!videos(base).length) throw httpError(400, 'primero busca videos');
  const system = inProject(project, () => reportPrompt(readResearch(base)!));
  start(base, 'report', (w) => runReport(base, w, system));
  return summary(base)!;
}

async function runReport(base: string, w: Work, system: string) {
  stage(w, 'report', 1);
  const all = scored(base).filter((v) => v.relevant !== false && v.score != null);
  if (!all.length) throw new Error('no hay videos útiles para el informe: revisa las búsquedas o marca a mano los que sirven');
  const top = all.slice(0, 40);
  const analysed = all.filter((v) => v.analysis).slice(0, RESEARCH_MAX_ANALYSE * 2);
  const lines = top.map((v) => `[${v.key}] ${label(v.platform)} · @${v.author} · ${metricsLine(v)}\n  ${v.title.replace(/\s+/g, ' ').slice(0, 300) || '(sin caption)'}`);
  const details = analysed.map((v) => {
    const a = v.analysis!;
    return [
      `[${v.key}] @${v.author} · puntaje ${v.score}`,
      `  Tema: ${a.topic}`,
      `  Gancho: «${a.hook.text}» — ${a.hook.visual} (${a.hook.why})`,
      `  Estructura: ${a.structure.map((s) => s.tag).join(' → ')}`,
      `  Visual: ${a.visuals.join('; ')}`,
      `  CTA: ${a.cta ?? 'ninguna'}`,
      `  Qué tomar: ${a.takeaways.join('; ')}`,
    ].join('\n');
  });
  const prompt = `${all.length} videos útiles (los ${top.length} mejores):\n\n${lines.join('\n\n')}\n\n${details.length ? `Análisis de los ${details.length} analizados:\n\n${details.join('\n\n')}` : 'Todavía no se analizó ninguno: básate en las métricas y los captions, y dilo.'}`;
  const text = await agentCli.ask(prompt, system, {model: 'smart', timeout: 6 * 60_000, signal: w.ctrl.signal});
  live(w);
  const r = readResearch(base);
  if (r) saveResearch(base, {...r, report: {text: text.trim(), at: Date.now(), keys: analysed.map((v) => v.key)}});
  w.job.done = 1;
}

/* ───── Stop, and for the agent ───── */

export function stop(project: string | undefined, id: string) {
  const base = baseOf(project, id);
  const w = works.get(base);
  if (!w) throw httpError(409, 'no tiene nada en marcha');
  w.ctrl.abort();
  changed();
}

// "Llevar a Ideas": a new general conversation that turns the research into ideas for the board.
export function ideasRequest(project: string | undefined, id: string) {
  const base = baseOf(project, id);
  const r = readResearch(base)!;
  const d = inProject(project, () => rel(base));
  return {
    text: `Convierte la investigación «${r.topic}» en ideas de contenido.`,
    note: `[Botón «Llevar a Ideas» de la página Investigación. Lee ${d}/research.json (report.text es el informe) y de los videos que cita ${d}/videos/<clave>/ (reel.json, analysis.json, transcript.json). Propón de 3 a 5 ideas para su tablero de Ideas de contenido, adaptadas a su perfil y a su audiencia (nunca copies un guion), cada una con su gancho y la vertical que le corresponde, y pregúntale cuáles agregar; cuando diga, agrégalas al tablero con ideas.py como dicen tus instrucciones. Sigue la skill content-ideas.]`,
  };
}

// For the general conversation's instructions.
export const agentNote = (tool: string) => {
  const d = rel(DIR());
  return `Investigación (página de la app; ${d}/, solo de este proyecto): qué videos cortos funcionan sobre un tema en TikTok, YouTube Shorts e Instagram, para su audiencia. Cada investigación en ${d}/<id>/: research.json (tema, búsquedas, opciones, runs: cómo fue cada plataforma, report.text: el informe) y videos/<plataforma>-<id>/ con reel.json (métricas, autor y sus seguidores, caption, relevant y reason: si le sirve a su audiencia), meta.json (lo que devolvió la plataforma) y, los analizados, transcript.json, analysis.json, hook.jpg y sheet_NN.jpg. Con ${tool} (nunca a mano): list · show <id> [--top N] [--json] · new "tema" [--platform tiktok,youtube,instagram] [--since días] [--query "…"]… · edit <id> [--query "…"]… [--platform …] [--since días] · cost <id> · search <id> [--wait] (gasta saldo de ScrapeCreators y de Apify: dile antes el costo de cost y espera su sí) · analyse <id> [--top N | clave…] [--wait] (su suscripción: pregunta antes de más de 5) · report <id> [--wait] · status <id>. Úsala cuando te pida investigar qué funciona sobre un tema o buscar los mejores videos de algo; mira primero si ya hay una investigación de ese tema. Adapta lo que funciona, nunca copies guiones.`;
};
