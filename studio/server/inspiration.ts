// Inspiración: reels of other Instagram accounts, to learn what works. Loose videos (Agregar video: reel URLs)
// and accounts (Escanear cuenta: @user) are downloaded with the scraper chosen in Ajustes → Extracción de datos (config/social.json):
// Apify's Instagram Reel Scraper (APIFY_TOKEN; it charges per reel) or ScrapeCreators (server/scrapecreators.ts; prepaid credits),
// then each reel is processed on this machine by tools/inspiration.py (cover, frame sheets, transcript with
// faster-whisper; the MP4 is deleted afterwards), analysed by the agent (hook, structure, pace, visuals, CTA)
// and, for followed accounts, the account as a whole (what beats its median).
//
// In the workspace:
//   projects/<id>/inspiration/<account>/account.json   {username, fullName, followed, added, fetched, analysis, error}
//   projects/<id>/inspiration/<account>/<code>/        reel.json (metrics, metricsAt and Instagram's links), meta.json (all
//                                        that the scraper returned, as of metricsAt), thumb.jpg, hook.jpg,
//                                        sheet_NN.jpg, transcript.json, analysis.json
// A reel's metrics and meta.json are read again with "Actualizar métricas" (refreshReel), without
// downloading or analysing the video again.
// Loose reels go under their owner's folder, with followed false until the account itself is added.
// Jobs live in memory: a reel left half-way shows as pending and "Procesar" picks it up again.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PROJECT, PROJECT_DIR, ROOT, rel} from './workspace.ts';
import {GROUP, killTree, readJson, writeJson as writeJsonFile} from './platform.ts';
import {getKey} from './settings.ts';
import {httpError} from './reels.ts';
import {agentCli, onAbort} from './agent.ts';
import {authorName, getProfile, getSocialSource} from './config.ts';
import * as sc from './scrapecreators.ts';
import {transcriberReady, venvPy} from './requirements.ts';
import {BEAT_TAGS, SOCIAL_SOURCES} from '../shared/types.ts';
import * as index from './inspiration-index.ts';
import * as db from './db.ts';
import type {InspirationAccount, InspirationJob, InspirationList, InspirationProfile, InspirationReel, InspirationRef, InspirationStatus, ReelAnalysis, ReelTranscript, ServerEvent} from '../shared/types.ts';

const ACTOR = 'apify~instagram-reel-scraper';
const PROFILE_ACTOR = 'apify~instagram-profile-scraper'; // the account's picture, followers and bio
export const USER = /^[a-z0-9._]{1,30}$/; // Instagram usernames (lowercased); no "-", so it can't clash with anything else
const CODE = /^[A-Za-z0-9_-]{5,40}$/;
const MIN_FOR_MEDIAN = 5;

const DIR = () => path.join(PROJECT_DIR, 'inspiration');
const accDir = (u: string) => path.join(DIR(), u);
const reelDir = (u: string, c: string) => path.join(DIR(), u, c);

const writeJson = (p: string, v: unknown) => writeJsonFile(p, v, 1);
const dirs = (p: string) => {
  try {
    return fs.readdirSync(p, {withFileTypes: true}).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  } catch {
    return [];
  }
};

/* ───── Live updates ───── */

let broadcast: (e: ServerEvent) => void = () => {};
export const setBroadcast = (fn: typeof broadcast) => {
  broadcast = fn;
  warm();
};
let pending: NodeJS.Timeout | undefined;
// Every change also brings the studio's index up to date (db.ts), so the agent's queries see it too.
const changed = () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      db.sync(true);
    } catch (e) {
      console.error('índice de inspiración:', e);
    }
    broadcast({type: 'inspiration'});
  }, 250);
};
// At start, and after a workspace switch: build the index if it's missing.
const warm = () =>
  setTimeout(() => {
    try {
      db.sync(true);
    } catch (e) {
      console.error('índice de inspiración:', e);
    }
  }, 1000);

/* ───── Reading ───── */

type AccountFile = {username: string; fullName: string | null; followed: boolean; added: number; fetched: number | null; analysis: InspirationAccount['analysis']; error: string | null; profile?: InspirationProfile | null};
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
  videoUrl: string | null;
  displayUrl: string | null;
  added: number;
  metricsAt?: number; // when the metrics and meta.json were read (older reels: their account's fetch or added)
  error?: string | null;
};

const jobs = new Map<string, InspirationJob>(); // by account
let looseJob: InspirationJob | null = null; // fetching loose reels (their owners aren't known yet)
const busy = new Map<string, 'processing' | 'analyzing'>(); // by "<account>/<code>"
const refreshing = new Set<string>(); // "<account>/<code>" whose metrics are being read again
let looseError: string | null = null; // the last loose download's problem

// Every path here hangs from the open project. When the studio switches to another project or workspace, work
// started in the old one must not land in the new one: reset() bumps the generation, forgets the jobs and stops the
// transcriptions; anything in flight checks its generation after each wait (alive) and gives up.
let gen = 0;
class Stale extends Error {}
const alive = (g: number) => {
  if (g !== gen) throw new Stale('cambió el proyecto o la carpeta de trabajo');
};
const procs = new Set<ReturnType<typeof spawn>>();
// "Detener": each account's pipeline has its controller; aborting it kills the transcription and the
// agent's process in flight, and the reels go back to where they were (pending or not analysed), not to error.
const stops = new Map<string, AbortController>();
export class Stopped extends Error {}
export function reset() {
  gen++;
  for (const c of stops.values()) c.abort();
  stops.clear();
  jobs.clear();
  busy.clear();
  refreshing.clear();
  pipelines.clear();
  again.clear();
  looseJob = null;
  looseError = null;
  for (const p of procs) killTree(p);
  procs.clear();
  db.close();
  changed();
}

const readAccount = (u: string) => readJson<AccountFile>(path.join(accDir(u), 'account.json'));
const saveAccount = (a: AccountFile) => writeJson(path.join(accDir(a.username), 'account.json'), a);
const readReel = (u: string, c: string) => readJson<ReelFile>(path.join(reelDir(u, c), 'reel.json'));
// Transcribed and with its frames: the video is gone and the agent can analyse it.
const processed = (d: string) => fs.existsSync(path.join(d, 'transcript.json')) && fs.existsSync(path.join(d, 'hook.jpg'));
const reelCodes = (u: string) => dirs(accDir(u)).filter((c) => CODE.test(c) && fs.existsSync(path.join(reelDir(u, c), 'reel.json')));

function median(xs: number[]) {
  if (xs.length < MIN_FOR_MEDIAN) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const accountMedian = (u: string) => median(reelCodes(u).map((c) => readReel(u, c)?.views).filter((v): v is number => typeof v === 'number'));

function reel(u: string, c: string, med: number | null): InspirationReel | null {
  const r = readReel(u, c);
  if (!r) return null;
  const d = reelDir(u, c);
  const has = (f: string) => fs.existsSync(path.join(d, f));
  let sheets: string[] = [];
  try {
    sheets = fs.readdirSync(d).filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).sort();
  } catch {
    /* gone */
  }
  const analysis = readJson<ReelAnalysis>(path.join(d, 'analysis.json'));
  const b = busy.get(`${u}/${c}`);
  const meta = readJson<Record<string, unknown>>(path.join(d, 'meta.json'));
  return {
    account: u,
    code: c,
    url: r.url,
    caption: r.caption,
    posted: r.posted,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    duration: r.duration,
    music: r.music,
    ratio: med && r.views != null ? r.views / med : null,
    files: {thumb: has('thumb.jpg'), hook: has('hook.jpg'), sheets},
    transcript: readJson<ReelTranscript>(path.join(d, 'transcript.json')),
    analysis,
    state: b ?? (r.error ? 'error' : analysis ? 'ready' : processed(d) ? 'processed' : 'pending'),
    error: r.error ?? null,
    added: r.added,
    metricsAt: r.metricsAt ?? readAccount(u)?.fetched ?? r.added,
    refreshing: refreshing.has(`${u}/${c}`),
    meta: meta && typeof meta === 'object' ? metaFields(meta) : null,
  };
}

// The saved metadata the page lists: text, numbers, yes/no and lists of text, objects one level deep
// (musicInfo.song_name…). Left out: what the page already shows, Instagram's links (they expire) and
// lists of objects (comments, tagged users: in meta.json for the agent).
const SHOWN = new Set(['caption', 'url', 'inputUrl', 'videoUrl', 'displayUrl', 'images', 'shortCode']);
export function metaFields(raw: Record<string, unknown>) {
  const out: Record<string, string | number | boolean | string[]> = {};
  const put = (k: string, v: unknown) => {
    if (typeof v === 'string') {
      if (v && !/^https?:\/\//.test(v)) out[k] = v.slice(0, 500);
    } else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) out[k] = (v as string[]).filter((x) => !/^https?:\/\//.test(x)).slice(0, 50);
  };
  for (const [k, v] of Object.entries(raw)) {
    if (SHOWN.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) put(`${k}.${k2}`, v2);
    else put(k, v);
  }
  return out;
}

function summary(u: string): InspirationAccount | null {
  const a = readAccount(u);
  if (!a) return null;
  return {...a, profile: a.profile ?? null, avatar: fs.existsSync(path.join(accDir(u), 'avatar.jpg')), reels: reelCodes(u).length, median: accountMedian(u), job: jobs.get(u) ?? null};
}

export async function status(): Promise<InspirationStatus> {
  const accounts = dirs(DIR())
    .filter((u) => USER.test(u))
    .map(summary)
    .filter((a): a is InspirationAccount => !!a)
    .sort((a, b) => a.added - b.added);
  const src = source();
  return {accounts, scraper: {id: src.id, label: src.label, ready: !!getKey(src.key)}, transcriber: await transcriberReady(), loose: {job: looseJob, error: looseError}};
}

const checkAccount = (u: string) => {
  if (!USER.test(u) || !readAccount(u)) throw httpError(404, 'cuenta no encontrada');
};

// The reels of a followed account, or (account null) the loose ones of every account not followed.
export function reels(u: string | null): InspirationReel[] {
  const accounts = u ? (checkAccount(u), [u]) : dirs(DIR()).filter((x) => USER.test(x) && readAccount(x)?.followed === false);
  return accounts.flatMap((acc) => {
    const med = accountMedian(acc);
    return reelCodes(acc)
      .map((c) => reel(acc, c, med))
      .filter((r): r is InspirationReel => !!r);
  });
}

// The reels table: one page of the index, with what's running now over its saved state.
const STATES = ['ready', 'unanalysed', 'error'] as const;
const DURS = ['short', 'mid', 'long', 'xl'] as const;
export function list(scope: string, raw: Record<string, unknown>): InspirationList {
  if (scope !== 'all' && scope !== 'loose') checkAccount(scope);
  const s = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined);
  const n = (k: string) => (Number.isFinite(Number(raw[k])) && Number(raw[k]) > 0 ? Number(raw[k]) : undefined);
  const pick = <T extends string>(k: string, xs: readonly T[]) => (xs.includes(raw[k] as T) ? (raw[k] as T) : undefined);
  const account = s('account')?.toLowerCase();
  const {rows, total, counts} = index.list({
    scope,
    q: s('q')?.slice(0, 200),
    account: account && USER.test(account) ? account : undefined,
    minRatio: n('minRatio'),
    minViews: n('minViews'),
    sinceDays: n('sinceDays'),
    dur: pick('dur', DURS),
    beat: pick('beat', BEAT_TAGS),
    cta: pick('cta', ['yes', 'no'] as const),
    state: pick('state', STATES),
    sort: s('sort'),
    desc: raw.desc !== 'false' && raw.desc !== false,
    page: n('page') ?? 0,
    size: n('size') ?? 10,
  });
  return {
    rows: rows.map((r) => {
      const k = `${r.account}/${r.code}`;
      return {
        account: r.account,
        code: r.code,
        url: r.url,
        title: r.topic || r.caption?.split('\n')[0] || r.code,
        hook: r.hook_text,
        posted: r.posted,
        views: r.views,
        likes: r.likes,
        comments: r.comments,
        duration: r.duration,
        ratio: r.ratio,
        wps: r.wps,
        state: busy.get(k) ?? r.state,
        error: r.error,
        thumb: !!r.thumb,
        metricsAt: r.metrics_at,
      };
    }),
    total,
    counts,
    accounts: scope === 'all' ? index.accountNames() : [],
  };
}

// One whole reel, for its card; without the account, the one it's under.
export function detail(c: string, account?: unknown) {
  const u = typeof account === 'string' && account ? account : CODE.test(c) ? index.accountOf(c) : null;
  if (!u) throw httpError(404, 'reel no encontrado');
  checkAccount(u);
  const r = CODE.test(c) ? reel(u, c, accountMedian(u)) : null;
  if (!r) throw httpError(404, 'reel no encontrado');
  return r;
}

/* ───── What to download ───── */

// "@user", "user", a profile URL or a reel URL; several separated by spaces, commas or lines. kind: what the
// card it came from takes (Agregar video: reel URLs · Escanear cuenta: accounts); none, both.
export type AddKind = 'video' | 'account' | undefined;
export function parse(input: unknown, kind?: AddKind) {
  if (typeof input !== 'string' || !input.trim())
    throw httpError(400, kind === 'video' ? 'pega el enlace de un reel' : kind === 'account' ? 'escribe una cuenta (@usuario)' : 'escribe una cuenta (@usuario) o la URL de un reel');
  const accounts = new Set<string>();
  const urls = new Set<string>();
  const bad: string[] = [];
  for (const tok of input.split(/[\s,]+/).filter(Boolean)) {
    const reelM = tok.match(/instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i);
    const profM = tok.match(/instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i);
    const u = (profM?.[1] ?? tok.replace(/^@/, '')).toLowerCase();
    if (reelM) urls.add(`https://www.instagram.com/reel/${reelM[1]}/`);
    else if (USER.test(u) && !['reel', 'reels', 'p', 'tv', 'explore', 'stories'].includes(u)) accounts.add(u);
    else bad.push(tok);
  }
  if (bad.length) throw httpError(400, `no entiendo: ${bad.join(', ')}. ${kind === 'video' ? 'Pega el enlace de un reel' : kind === 'account' ? 'Escribe @usuario' : 'Escribe @usuario o la URL de un reel'}`);
  if (kind === 'video' && accounts.size) throw httpError(400, `${[...accounts].map((a) => `@${a}`).join(', ')} es una cuenta: para traer sus reels usa Escanear cuenta`);
  if (kind === 'account' && urls.size) throw httpError(400, 'eso es el enlace de un video: añádelo en Agregar video');
  return {accounts: [...accounts], urls: [...urls]};
}

// The scraper in use (Ajustes → Extracción de datos → Redes sociales), and it with its key, to download.
export const source = () => SOCIAL_SOURCES.find((s) => s.id === getSocialSource((k) => !!getKey(k)))!;
export function requireSource() {
  const s = source();
  if (!getKey(s.key)) throw httpError(400, `falta la clave de ${s.label}: ponla en Ajustes → Extracción de datos → Redes sociales`);
  return s;
}
export const fmtUsd = (v: number) => `${v.toLocaleString('es', {minimumFractionDigits: 2, maximumFractionDigits: 4})} US$`;

// The actors' prices (per reel, per profile, per run), for the creator's plan when Apify says it (else the
// free plan's, the highest). Cached for an hour.
let pricing: {at: number; reel: number; profile: number; start: number; tier: string} | null = null;
async function prices() {
  if (pricing && Date.now() - pricing.at < 3600_000) return pricing;
  const fallback = {at: Date.now(), reel: 0.0026, profile: 0.0026, start: 0.001, tier: 'FREE'};
  try {
    const token = getKey('APIFY_TOKEN');
    type Data = {data?: Record<string, any>}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const [act, prof, me] = await Promise.all([
      fetch(`https://api.apify.com/v2/acts/${ACTOR}`).then((r) => r.json() as Promise<Data>),
      fetch(`https://api.apify.com/v2/acts/${PROFILE_ACTOR}`).then((r) => r.json() as Promise<Data>).catch(() => null),
      token ? fetch('https://api.apify.com/v2/users/me', {headers: {Authorization: `Bearer ${token}`}}).then((r) => r.json() as Promise<Data>).catch(() => null) : null,
    ]);
    type Tiered = {eventTieredPricingUsd?: Record<string, {tieredEventPriceUsd: number}>; eventPriceUsd?: number};
    const events = (act.data?.pricingInfos?.at(-1)?.pricingPerEvent?.actorChargeEvents ?? {}) as Record<string, Tiered>;
    const tier = String(me?.data?.plan?.tier ?? 'FREE').toUpperCase();
    const price = (e?: Tiered) => e?.eventTieredPricingUsd?.[tier]?.tieredEventPriceUsd ?? e?.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? e?.eventPriceUsd;
    const reel = price(events.reel);
    const start = price(events['actor-start']);
    const profEvents = (prof?.data?.pricingInfos?.at(-1)?.pricingPerEvent?.actorChargeEvents ?? {}) as Record<string, Tiered>;
    const profile = price(profEvents.profile) ?? fallback.profile;
    pricing = reel ? {at: Date.now(), reel, profile, start: start ?? 0, tier: events.reel?.eventTieredPricingUsd?.[tier] ? tier : 'FREE'} : fallback;
  } catch {
    pricing = fallback;
  }
  return pricing;
}

// What a download would bring and cost at most, before launching it.
// charge: what it will take, in words, for the confirmation.
export async function estimate(input: unknown, limit: number, kind?: AddKind) {
  const {accounts, urls} = parse(input, kind);
  return {accounts, urls, ...(await cost(accounts.map((u) => ({limit, known: reelCodes(u).length})), urls.length))};
}

// What downloading would cost at most: accounts (up to limit reels each, known of them already saved: their
// captions aren't read again), their profiles (profiles: false leaves them out) and loose reels.
export async function cost(accounts: {limit: number; known: number}[], loose: number, profiles = true) {
  const count = accounts.reduce((n, a) => n + a.limit, 0) + loose;
  if (source().id === 'scrapecreators') {
    // Per account: its pages of reels, the caption of each reel not seen before (at most), its profile. One per loose reel.
    const credits = accounts.reduce((n, a) => n + Math.ceil(a.limit / sc.PAGE) + Math.max(0, a.limit - a.known) + (profiles ? 1 : 0), 0) + loose;
    const usd = Math.ceil(credits * sc.CREDIT_USD * 1000) / 1000;
    const charge = `ScrapeCreators gasta como mucho ${credits} crédito${credits > 1 ? 's' : ''} de tu saldo (≈ ${fmtUsd(usd)} al precio del paquete de 25 000)`;
    return {reels: count, usd, perReel: sc.CREDIT_USD, perRun: 0, tier: 'créditos', source: 'ScrapeCreators', charge};
  }
  const p = await prices();
  // One run per account and one for all the loose reels, plus one per account for its profile (picture,
  // followers, bio).
  const runs = accounts.length * (profiles ? 2 : 1) + (loose ? 1 : 0);
  const usd = count * p.reel + (profiles ? accounts.length * p.profile : 0) + runs * p.start;
  const total = Math.ceil(usd * 1000) / 1000;
  const charge = `Apify cobra de tu saldo como mucho ${fmtUsd(total)} (${fmtUsd(p.reel)} por reel y ${fmtUsd(p.start)} por descarga en tu plan, ${p.tier})`;
  return {reels: count, usd: total, perReel: p.reel, perRun: p.start, tier: p.tier, source: 'Apify', charge};
}

/* ───── Downloading (Apify or ScrapeCreators) ───── */

// Apify's item; ScrapeCreators' answers come in the same shape (raw: its own answer).
export type ApifyItem = sc.SourceItem;

const runApify = (usernames: string[], limit: number, maxUsd: number) => runActor<ApifyItem>(ACTOR, {username: usernames, resultsLimit: limit}, maxUsd);

// The reels of one account (as) or the loose reel URLs (targets), from the scraper in use. Apify: one run,
// capped at what the estimate said (plus a margin). ScrapeCreators: its pages, captions only for reels it
// doesn't know (caption: the one saved, if any; the rest keep the one they have); one request per loose reel.
export async function fetchItems(targets: string[], as: string | null, limit: number, caption?: (code: string) => string | null): Promise<{items: ApifyItem[]; problem: string | null}> {
  if (source().id === 'apify') {
    const p = await prices();
    return runApify(targets, limit, (as ? limit : targets.length) * p.reel * 1.25 + p.start + 0.01);
  }
  if (as) return sc.accountReels(as, limit, caption ?? ((c) => readReel(as, c)?.caption ?? null));
  const items: ApifyItem[] = [];
  const errors: string[] = [];
  for (const url of targets) {
    try {
      const it = await sc.post(url);
      if (it) items.push({...it, inputUrl: url});
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!items.length && errors.length) throw new Error(errors[0]);
  return {items, problem: errors[0] ?? null};
}

async function runActor<T>(actor: string, input: unknown, maxUsd: number): Promise<{items: T[]; problem: string | null}> {
  const token = getKey('APIFY_TOKEN');
  if (!token) throw httpError(400, 'falta la clave de Apify: ponla en Ajustes → Extracción de datos → Redes sociales');
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  const api = async (url: string, init?: RequestInit) => {
    const r = await fetch(`https://api.apify.com/v2${url}`, {...init, headers});
    const body = (await r.json().catch(() => null)) as {data?: Record<string, unknown>; error?: {message?: string}} | T[] | null;
    if (!r.ok) throw new Error(`Apify respondió ${r.status}${!Array.isArray(body) && body?.error?.message ? `: ${body.error.message}` : ''}`);
    return body;
  };
  // maxTotalChargeUsd caps what the run may charge, whatever happens.
  const started = (await api(`/acts/${actor}/runs?maxTotalChargeUsd=${maxUsd.toFixed(4)}`, {method: 'POST', body: JSON.stringify(input)})) as {data: {id: string}};
  let run = started.data as {id: string; status: string; statusMessage?: string; defaultDatasetId: string};
  const deadline = Date.now() + 15 * 60_000;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() > deadline) throw new Error('Apify tarda más de 15 minutos; inténtalo más tarde');
    run = ((await api(`/actor-runs/${run.id}?waitForFinish=60`)) as {data: typeof run}).data;
  }
  const items = ((await api(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`)) ?? []) as T[];
  const problem = run.status === 'SUCCEEDED' ? null : `la descarga en Apify terminó en ${run.status}${run.statusMessage ? ` (${run.statusMessage})` : ''}`;
  if (!items.length && problem) throw new Error(problem);
  return {items, problem};
}

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// What reel.json keeps of an Apify item: the metrics as of now and Instagram's (expiring) links.
export const metricsOf = (it: ApifyItem) => ({
  caption: it.caption ?? '',
  posted: it.timestamp ?? null,
  views: num(it.videoPlayCount) ?? num(it.videoViewCount),
  likes: num(it.likesCount), // -1 when the owner hides likes
  comments: num(it.commentsCount),
  duration: num(it.videoDuration),
  music: [it.musicInfo?.artist_name, it.musicInfo?.song_name].filter(Boolean).join(' — ') || null,
  videoUrl: it.videoUrl ?? null,
  displayUrl: it.displayUrl ?? null,
  metricsAt: Date.now(),
});
// Everything the scraper returned about the reel, for the page's Metadatos and for the agent.
const saveMeta = (u: string, c: string, it: ApifyItem) => writeJson(path.join(reelDir(u, c), 'meta.json'), it.raw ?? it);

// Save what the scraper returned: one folder per reel (metrics refreshed, analysis kept), under the account it was
// downloaded for (as; a collab reel may name the partner as its owner) or, for loose reels, under its owner.
// Returns the accounts that got reels.
function store(items: ApifyItem[], as: string | null) {
  const touched = new Set<string>();
  for (const it of items) {
    const owner = String(it.ownerUsername ?? '').toLowerCase();
    const u = as ?? owner;
    const code = it.shortCode ?? '';
    if (it.error || !USER.test(u) || !CODE.test(code) || !it.videoUrl) continue;
    const acc = readAccount(u);
    saveAccount({
      username: u,
      fullName: (owner === u && it.ownerFullName) || acc?.fullName || null,
      followed: !!as || !!acc?.followed,
      added: acc?.added ?? Date.now(),
      fetched: as ? Date.now() : (acc?.fetched ?? null),
      analysis: acc?.analysis ?? null,
      error: as ? null : (acc?.error ?? null),
      profile: acc?.profile ?? null,
    });
    const old = readReel(u, code);
    writeJson(path.join(reelDir(u, code), 'reel.json'), {
      code,
      url: it.url ?? `https://www.instagram.com/reel/${code}/`,
      ...metricsOf(it),
      added: old?.added ?? Date.now(),
      error: null, // fresh links: a reel that failed before can be tried again
    } satisfies ReelFile);
    saveMeta(u, code, it);
    touched.add(u);
  }
  return touched;
}

export async function download(url: string, dest: string) {
  const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'}});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// Add accounts and loose reels: download them with the scraper, then process and analyse in the background.
// refresh ("Actualizar" of an account): only the metrics, the metadata and the profile; nothing is
// transcribed or analysed (reels posted since stay pending, for "Procesar").
export async function add(input: unknown, limitIn: unknown, kind?: AddKind, refresh = false) {
  const g = gen;
  // Up to 500: "Cargar más" asks for the reels it has plus the new ones (neither scraper can skip the first ones).
  const limit = Math.min(500, Math.max(1, Math.round(Number(limitIn) || 30)));
  const est = await estimate(input, limit, kind);
  alive(g);
  const {accounts, urls} = est;
  const src = requireSource();
  const runningNow = accounts.filter((u) => jobs.has(u));
  if (runningNow.length) throw httpError(409, `ya se está descargando o analizando: ${runningNow.map((u) => `@${u}`).join(', ')}`);
  if (urls.length && looseJob) throw httpError(409, 'ya se están descargando reels sueltos; espera a que termine');

  // The accounts show up right away, with their job.
  const job = (): InspirationJob => ({stage: 'fetching', done: 0, total: 0, started: Date.now()});
  for (const u of accounts) {
    const a = readAccount(u);
    saveAccount({username: u, fullName: a?.fullName ?? null, followed: true, added: a?.added ?? Date.now(), fetched: a?.fetched ?? null, analysis: a?.analysis ?? null, error: null, profile: a?.profile ?? null});
    jobs.set(u, job());
  }
  if (urls.length) {
    looseJob = job();
    looseError = null;
  }
  changed();

  // One download per account (so each reel lands in the account it was asked for) and one for the loose reels.
  const fetchOne = async (targets: string[], as: string | null) => {
    try {
      const {items, problem} = await fetchItems(targets, as, limit);
      alive(g);
      const got = store(items, as);
      // Covers first, so the table has pictures while the rest runs.
      await Promise.all(
        [...got].flatMap((u) =>
          reelCodes(u).map(async (c) => {
            const r = readReel(u, c);
            const thumb = path.join(reelDir(u, c), 'thumb.jpg');
            if (r?.displayUrl && !fs.existsSync(thumb)) await download(r.displayUrl, thumb).catch(() => {});
          }),
        ),
      );
      alive(g);
      if (as) {
        if (!got.has(as)) setAccountError(as, `${src.label} no devolvió reels de @${as}: ¿la cuenta es privada, no tiene reels o el nombre está mal escrito?`);
        else if (problem) setAccountError(as, problem);
        jobs.delete(as);
      } else {
        const missing = targets.filter((url) => !items.some((it) => it.shortCode && url.includes(`/${it.shortCode}/`) && !it.error));
        looseError = missing.length ? `${src.label} no devolvió ${missing.length === 1 ? 'este reel' : 'estos reels'}: ${missing.join(' ')}` : problem;
        looseJob = null;
      }
      changed();
      if (!refresh) for (const u of got) void pipeline(u);
    } catch (e) {
      if (g !== gen) return; // another workspace now: nothing to report here
      if (as) {
        jobs.delete(as);
        setAccountError(as, (e as Error).message);
      } else {
        looseError = (e as Error).message;
        looseJob = null;
      }
      changed();
    }
  };
  for (const u of accounts) {
    void fetchOne([u], u);
    void fetchProfile(u, g);
  }
  if (urls.length) void fetchOne(urls, null);
  return est;
}


// "Actualizar métricas": read one reel's metrics and metadata again from the scraper (one reel's price). The video
// isn't downloaded or analysed again; its links are fresh, so a reel that failed can then be processed.
export async function refreshReel(u: string, c: string) {
  checkAccount(u);
  const r = CODE.test(c) ? readReel(u, c) : null;
  if (!r) throw httpError(404, 'reel no encontrado');
  const k = `${u}/${c}`;
  if (refreshing.has(k)) throw httpError(409, 'ya se están actualizando sus métricas');
  const g = gen;
  refreshing.add(k);
  changed();
  try {
    const {items} = await fetchItems([r.url], null, 1);
    alive(g);
    const it = items.find((i) => i.shortCode === c && !i.error);
    if (!it) throw httpError(502, `${source().label} no devolvió este reel: ¿lo borraron o la cuenta ahora es privada?`);
    const now = readReel(u, c);
    if (!now) throw httpError(404, 'el reel ya no está');
    writeJson(path.join(reelDir(u, c), 'reel.json'), {...now, ...metricsOf(it)} satisfies ReelFile);
    saveMeta(u, c, it);
    return reel(u, c, accountMedian(u));
  } finally {
    if (g === gen) {
      refreshing.delete(k);
      changed();
    }
  }
}

// The account's profile (Apify's profile scraper or ScrapeCreators' profile, one profile's price): its picture, saved as avatar.jpg (the
// link expires), and its followers, bio… in account.json. Not essential: a failure only gets logged.
type ProfileItem = {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  verified?: boolean;
  isBusinessAccount?: boolean;
  businessCategoryName?: string;
  externalUrl?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  error?: string;
};
// One account's profile from the scraper in use: its name, picture's link (it expires) and profile.
export async function profileOf(u: string): Promise<{fullName: string | null; picture: string | null; profile: InspirationProfile} | null> {
  let it: ProfileItem | null | undefined;
  if (source().id === 'apify') {
    const p = await prices();
    const {items} = await runActor<ProfileItem>(PROFILE_ACTOR, {usernames: [u]}, p.profile * 1.25 + p.start + 0.01);
    it = items.find((i) => !i.error && String(i.username ?? '').toLowerCase() === u) ?? items.find((i) => !i.error);
  } else it = await sc.profile(u);
  if (!it) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    fullName: str(it.fullName),
    picture: str(it.profilePicUrlHD) ?? str(it.profilePicUrl),
    profile: {
      followers: num(it.followersCount),
      following: num(it.followsCount),
      posts: num(it.postsCount),
      bio: str(it.biography),
      verified: !!it.verified,
      category: str(it.businessCategoryName),
      website: str(it.externalUrl),
      at: Date.now(),
    },
  };
}

async function fetchProfile(u: string, g: number) {
  try {
    const it = await profileOf(u);
    alive(g);
    if (!it) return;
    if (it.picture) await download(it.picture, path.join(accDir(u), 'avatar.jpg')).catch((e) => console.error(`foto de @${u}:`, e));
    alive(g);
    const a = readAccount(u);
    if (!a) return; // removed meanwhile
    saveAccount({...a, fullName: it.fullName ?? a.fullName, profile: it.profile});
    changed();
  } catch (e) {
    if (!(e instanceof Stale)) console.error(`perfil de @${u}:`, e);
  }
}

function setAccountError(u: string, error: string | null) {
  const a = readAccount(u);
  if (a) saveAccount({...a, error});
}

/* ───── Processing and analysis ───── */

// At most n at once (transcription uses every core: one at a time).
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
// Shared with Mi cuenta (account.ts): one transcription at a time across the studio.
export const processSlot = limiter(1);
export const analyseSlot = limiter(3);

// tools/inspiration.py with the venv's Python (it has faster-whisper) on a reel's folder (reel.json with
// videoUrl): cover, frame sheets, transcript. Its last stderr line is the error. Also Mi cuenta's (account.ts).
// Stopped (signal): what it left half-way (the video, the audio, a partial download) is deleted.
const processReel = (u: string, c: string, signal?: AbortSignal) => processDir(reelDir(u, c), signal);
export function processDir(d: string, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(venvPy(), [path.join(ROOT, 'tools', 'inspiration.py'), d], {cwd: ROOT, env: process.env, detached: GROUP});
    procs.add(p);
    let err = '';
    const timer = setTimeout(() => killTree(p), 10 * 60_000);
    const unhook = onAbort(signal, () => killTree(p));
    p.stderr.on('data', (d: Buffer) => (err = (err + d).slice(-3000)));
    p.on('error', (e) => (procs.delete(p), unhook(), reject(e)));
    p.on('close', (code) => {
      procs.delete(p);
      clearTimeout(timer);
      unhook();
      if (signal?.aborted) {
        for (const f of ['video.mp4', 'video.mp4.part', 'audio.wav']) fs.rmSync(path.join(d, f), {force: true});
        return reject(new Stopped('detenido'));
      }
      if (code === 0) resolve();
      else reject(new Error(err.trim().split('\n').filter(Boolean).pop() ?? `terminó con código ${code}`));
    });
  });
}

export const fmtS = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('es'));

const ANALYST = () => {
  const p = getProfile();
  return [
    `Analizas reels de Instagram de otras cuentas para que ${authorName()}, que hace videos explicativos para ${p.platform}${p.audience ? ` (público: ${p.audience})` : ''}, aprenda qué funciona y qué puede tomar.`,
    IMAGES_NOTE,
    analysisShape(p.language, '2–4 cosas concretas que vale la pena tomar para videos propios'),
  ].join('\n');
};

async function analyseReel(u: string, c: string, med: number | null, g: number, signal?: AbortSignal) {
  alive(g);
  const r = reel(u, c, med);
  if (!r) throw new Error('el reel ya no está');
  const d = reelDir(u, c);
  const prompt = [
    `Reel de @${u}: ${r.url}`,
    `Publicado: ${r.posted?.slice(0, 10) ?? '—'} · duración ${r.duration != null ? `${Math.round(r.duration)} s` : '—'} · vistas ${n(r.views)}${r.ratio != null ? ` (${r.ratio.toFixed(1)}× la mediana de la cuenta)` : ''} · likes ${n(r.likes)} · comentarios ${n(r.comments)}${r.music ? ` · música: ${r.music}` : ''}`,
    `Caption:\n${r.caption.slice(0, 1500) || '(vacío)'}`,
    transcriptText(r.transcript),
  ].join('\n\n');
  const images = [r.files.hook ? path.join(d, 'hook.jpg') : null, ...r.files.sheets.slice(0, 4).map((s) => path.join(d, s))].filter((x): x is string => !!x);
  const reply = await agentCli.ask(prompt, ANALYST(), {model: 'smart', images, timeout: 4 * 60_000, signal});
  alive(g);
  writeJson(path.join(d, 'analysis.json'), parseAnalysis(reply));
}

// The agent's reply as analysis.json: what's missing or isn't of its shape is left out. Also Mi cuenta's.
export function parseAnalysis(reply: string): ReelAnalysis {
  let a: Partial<ReelAnalysis>;
  try {
    a = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '');
  } catch {
    throw new Error(`${agentCli.label} no devolvió un análisis legible`);
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    topic: str(a.topic),
    hook: {text: str(a.hook?.text), visual: str(a.hook?.visual), why: str(a.hook?.why)},
    structure: (Array.isArray(a.structure) ? a.structure : [])
      .filter((s) => (BEAT_TAGS as readonly string[]).includes(s?.tag))
      .map((s) => ({tag: s.tag, start: Number(s.start) || 0, end: Number(s.end) || 0, summary: str(s.summary)})),
    visuals: list(a.visuals),
    cta: str(a.cta) || null,
    takeaways: list(a.takeaways),
    at: Date.now(),
  };
}

// For the analyst's prompt: the transcript with its times (or why there's none).
export const transcriptText = (t: ReelTranscript | null) =>
  t?.noAudio
    ? 'Transcripción: el video no tiene audio.'
    : t?.segments.length
      ? `Transcripción (${t.language ?? '?'}, ${t.wps ?? '—'} palabras/s):\n${t.segments.map((s) => `[${fmtS(s.start)}–${fmtS(s.end)}] ${s.text}`).join('\n')}`
      : 'Transcripción: no se detectó voz.';

// What the analyst gets besides the text: the first 3 s and the first sheets of frames (2 min).
export const IMAGES_NOTE =
  'Recibes las métricas, el caption, la transcripción con tiempos y dos tipos de imagen: la primera muestra los primeros 3 segundos (12 fotogramas cada 0,25 s, de izquierda a derecha y de arriba abajo); las siguientes, el reel completo a un fotograma por segundo (30 por hoja, 6 columnas × 5 filas; el fotograma i de la hoja n es el segundo (n−1)×30+i).';
// The JSON the analyst answers (analysis.json); takeaways says what that list is for.
export const analysisShape = (language: string, takeaways: string) =>
  [
    `Responde SOLO con un objeto JSON, con todos los textos en ${language}:`,
    '{"topic": "el tema en una frase",',
    ' "hook": {"text": "lo que se dice y lo que se lee en pantalla en los primeros 3 s, literal", "visual": "qué se ve en esos 3 s", "why": "por qué engancha (o por qué no)"},',
    ` "structure": [{"tag": una de ${BEAT_TAGS.map((t) => `"${t}"`).join(', ')}, "start": segundos, "end": segundos, "summary": "qué pasa"}],`,
    ' "visuals": ["recursos visuales: texto en pantalla, cara a cámara, b-roll, capturas, gráficos, cortes, subtítulos…"],',
    ' "cta": "la llamada a la acción, literal, o null si no hay",',
    ` "takeaways": ["${takeaways}"]}`,
    'Si no hay voz (solo música o texto en pantalla), básate en el texto de las imágenes. No inventes lo que no se ve ni se oye.',
  ].join('\n');

const STRATEGIST = () => {
  const p = getProfile();
  return [
    `Estudias una cuenta de Instagram para ${authorName()}, que hace videos explicativos para ${p.platform}${p.audience ? ` (público: ${p.audience})` : ''}, de unos ${p.duration} s. Recibes sus reels con métricas y el análisis de cada uno.`,
    `Responde en markdown, en ${p.language}, en 350 palabras como mucho, con estas secciones:`,
    '## Qué funciona — compara los reels por encima de la mediana de vistas con los de debajo; cita los reels por su código entre corchetes, p. ej. [C1a2B3].',
    '## Ganchos que se repiten — fórmulas concretas, con un ejemplo literal.',
    '## Temas y formato — duración, ritmo (palabras/s), recursos visuales, estructura y CTA de los que mejor van.',
    '## Para tus videos — 3 a 5 ideas concretas que puede adaptar a su perfil.',
    'Sé concreto y no inventes: si hay pocos reels o la diferencia no es clara, dilo.',
  ].join('\n');
};

async function analyseAccount(u: string, g: number, signal?: AbortSignal) {
  const med = accountMedian(u);
  const rs = reels(u).filter((r) => r.analysis);
  const lines = rs
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .map((r) =>
      [
        `[${r.code}] ${r.posted?.slice(0, 10) ?? '—'} · ${n(r.views)} vistas${r.ratio != null ? ` (${r.ratio.toFixed(1)}×)` : ''} · ${n(r.likes)} likes · ${n(r.comments)} coment. · ${r.duration != null ? Math.round(r.duration) : '—'} s · ${r.transcript?.wps ?? '—'} pal/s`,
        `  Tema: ${r.analysis!.topic}`,
        `  Gancho: «${r.analysis!.hook.text}» — ${r.analysis!.hook.visual}`,
        `  Estructura: ${r.analysis!.structure.map((s) => s.tag).join(' → ')}`,
        `  Visual: ${r.analysis!.visuals.join('; ')}`,
        `  CTA: ${r.analysis!.cta ?? 'ninguna'}`,
      ].join('\n'),
    );
  const prompt = `Cuenta @${u}: ${rs.length} reels analizados; mediana de vistas ${n(med)}.\n\n${lines.join('\n\n')}`;
  const text = await agentCli.ask(prompt, STRATEGIST(), {model: 'smart', timeout: 4 * 60_000, signal});
  alive(g);
  const a = readAccount(u);
  if (!a) return; // removed meanwhile
  saveAccount({...a, analysis: {text: text.trim(), at: Date.now(), reels: rs.length}});
}

// Process what's missing, then, for a followed account, analyse what isn't yet and the account (with enough
// reels). Loose videos (Agregar video) are only processed: the agent analyses one when the creator asks
// ("Analizar video": opts.analyse, its code), never on its own. Reels that failed are tried again (each call
// comes from the creator: a download, "Procesar" or "Analizar video").
const pipelines = new Set<string>();
const again = new Set<string>(); // new reels arrived while it ran: go once more at the end
async function pipeline(u: string, opts: {reanalyse?: boolean; analyse?: string[]} = {}) {
  if (pipelines.has(u)) return void again.add(u);
  const g = gen;
  pipelines.add(u);
  const ctrl = new AbortController();
  stops.set(u, ctrl);
  const stopped = () => ctrl.signal.aborted;
  // After each wait: the workspace is the same and nobody pressed Detener.
  const live = () => {
    alive(g);
    if (stopped()) throw new Stopped('detenido');
  };
  const followed = !!readAccount(u)?.followed;
  for (const c of opts.analyse ?? reelCodes(u)) {
    const r = readReel(u, c);
    if (r?.error) writeJson(path.join(reelDir(u, c), 'reel.json'), {...r, error: null});
  }
  const job: InspirationJob = {stage: 'processing', done: 0, total: 0, started: Date.now()};
  jobs.set(u, job);
  const fail = (c: string, e: unknown) => {
    const r = readReel(u, c);
    if (r) writeJson(path.join(reelDir(u, c), 'reel.json'), {...r, error: (e as Error).message});
  };
  try {
    const codes = opts.analyse ?? reelCodes(u);
    const d = (c: string, f: string) => fs.existsSync(path.join(reelDir(u, c), f));
    const ready = await transcriberReady();
    live();
    const toProcess = ready ? codes.filter((c) => !d(c, 'transcript.json') || !d(c, 'hook.jpg')) : [];
    Object.assign(job, {stage: 'processing', done: 0, total: toProcess.length});
    changed();
    await Promise.all(
      toProcess.map((c) =>
        processSlot(async () => {
          live(); // waited in the queue
          busy.set(`${u}/${c}`, 'processing');
          changed();
          try {
            await processReel(u, c, ctrl.signal);
          } catch (e) {
            if (g === gen && !stopped()) fail(c, e);
          } finally {
            if (g === gen) {
              busy.delete(`${u}/${c}`);
              job.done++;
              changed();
            }
          }
        }),
      ),
    );

    live();
    const med = accountMedian(u);
    const wanted = (c: string) => (opts.analyse ? true : followed && (opts.reanalyse || !d(c, 'analysis.json')));
    const toAnalyse = codes.filter((c) => processed(reelDir(u, c)) && !readReel(u, c)?.error && wanted(c));
    Object.assign(job, {stage: 'analyzing', done: 0, total: toAnalyse.length});
    changed();
    await Promise.all(
      toAnalyse.map((c) =>
        analyseSlot(async () => {
          live();
          busy.set(`${u}/${c}`, 'analyzing');
          changed();
          try {
            await analyseReel(u, c, med, g, ctrl.signal);
          } catch (e) {
            if (g === gen && !stopped()) fail(c, e);
          } finally {
            if (g === gen) {
              busy.delete(`${u}/${c}`);
              job.done++;
              changed();
            }
          }
        }),
      ),
    );

    live();
    const a = readAccount(u);
    const analysed = reelCodes(u).filter((c) => d(c, 'analysis.json')).length;
    if (a?.followed && !opts.analyse && analysed >= MIN_FOR_MEDIAN && (toAnalyse.length || !a.analysis || opts.reanalyse)) {
      Object.assign(job, {stage: 'summary', done: 0, total: 1});
      changed();
      await analyseAccount(u, g, ctrl.signal).catch((e) => {
        if (e instanceof Stale || stopped()) throw e;
        setAccountError(u, `análisis de la cuenta: ${(e as Error).message}`);
      });
    }
  } catch (e) {
    // It runs in the background (nobody awaits it): an error here must not take the server down.
    if (!(e instanceof Stale) && !stopped()) console.error(`inspiración @${u}:`, e);
  } finally {
    if (g === gen) {
      jobs.delete(u);
      pipelines.delete(u);
      if (stops.get(u) === ctrl) stops.delete(u);
      changed();
      if (again.delete(u) && !stopped()) void pipeline(u);
    }
  }
}

// "Procesar" (pending and failed reels) and "Volver a analizar" (every reel and the account).
export function processAccount(u: string, reanalyse = false) {
  checkAccount(u);
  if (pipelines.has(u) || jobs.has(u)) throw httpError(409, `@${u} ya está trabajando`);
  setAccountError(u, null);
  void pipeline(u, {reanalyse});
}

// "Analizar video" (and "Volver a analizar" for one reel): process it if needed, then the agent analyses it.
export async function analyseOne(u: string, c: string) {
  checkAccount(u);
  if (!CODE.test(c) || !readReel(u, c)) throw httpError(404, 'reel no encontrado');
  if (pipelines.has(u) || jobs.has(u) || busy.has(`${u}/${c}`)) throw httpError(409, `@${u} está trabajando; espera a que termine`);
  if (!processed(reelDir(u, c)) && !(await transcriberReady())) throw httpError(400, 'falta la transcripción: instálala en Ajustes → Requisitos → Transcripción');
  void pipeline(u, {analyse: [c]});
}

// "Detener": stop what's transcribing or analysing in this account (the download from Apify, if any,
// finishes on its own: it's already paid and capped).
export function stopAccount(u: string) {
  checkAccount(u);
  const c = stops.get(u);
  if (!c) throw httpError(409, `@${u} no tiene nada en marcha`);
  c.abort();
  changed();
}

export function removeAccount(u: string) {
  checkAccount(u);
  if (jobs.has(u)) throw httpError(409, `@${u} está trabajando; espera a que termine`);
  fs.rmSync(accDir(u), {recursive: true, force: true});
  changed();
}

export function removeReel(u: string, c: string) {
  checkAccount(u);
  if (!CODE.test(c) || !readReel(u, c)) throw httpError(404, 'reel no encontrado');
  if (busy.has(`${u}/${c}`) || refreshing.has(`${u}/${c}`)) throw httpError(409, 'ese reel está trabajando; espera a que termine');
  fs.rmSync(reelDir(u, c), {recursive: true, force: true});
  // An account that was only there for its loose reels goes when its last one does.
  const a = readAccount(u);
  if (a && !a.followed && !reelCodes(u).length && !jobs.has(u)) fs.rmSync(accDir(u), {recursive: true, force: true});
  changed();
}

// An account's picture (avatar.jpg), when it has one.
export function avatar(u: string) {
  if (!USER.test(u)) return null;
  const p = path.join(accDir(u), 'avatar.jpg');
  return fs.existsSync(p) ? p : null;
}

// Files the page shows: the cover and the frame sheets.
export function file(u: string, c: string, f: string) {
  if (!USER.test(u) || !CODE.test(c) || !/^(thumb|hook|sheet_\d{2})\.jpg$/.test(f)) return null;
  const p = path.join(reelDir(u, c), f);
  return fs.existsSync(p) ? p : null;
}

/* ───── For the agent ───── */

// Reels attached to a message of the general conversation ("Usar como referencia"): only existing ones.
export function validRefs(refs: unknown): InspirationRef[] {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((r): r is InspirationRef => !!r && !r.own && typeof r.account === 'string' && typeof r.code === 'string' && USER.test(r.account) && CODE.test(r.code) && !!readReel(r.account, r.code))
    .map((r) => ({account: r.account, code: r.code, label: String(r.label ?? '').slice(0, 120)}))
    .slice(0, 12);
}

export function refsText(refs: InspirationRef[]) {
  if (!refs.length) return '';
  const lines = refs.map((r) => {
    const x = reel(r.account, r.code, accountMedian(r.account));
    const metrics = x ? ` — ${n(x.views)} vistas${x.ratio != null ? ` (${x.ratio.toFixed(1)}× su mediana)` : ''}` : '';
    return `- @${r.account} · ${x?.url ?? r.code}${metrics}: ${rel(DIR())}/${r.account}/${r.code}/`;
  });
  return `Reels de referencia de Inspiración. Antes de responder, lee de cada uno reel.json (métricas y caption), transcript.json y analysis.json, y mira hook.jpg y sheet_*.jpg si te sirve lo visual:\n${lines.join('\n')}`;
}

// Where Inspiración keeps its data, for the general conversation's instructions.
export const agentNote = () => {
  const d = rel(DIR());
  return (
    `Inspiración (página de la app; ${d}/, solo de este proyecto): reels de otras cuentas de Instagram que estudia. ${d}/<cuenta>/account.json (con analysis.text, el análisis de la cuenta, y profile: seguidores, bio…) y avatar.jpg (su foto de perfil) y una carpeta por reel con reel.json (métricas a la fecha de metricsAt, caption), meta.json (todo lo que devolvió el scraper, Apify o ScrapeCreators: hashtags, menciones, comentarios recientes…), transcript.json, analysis.json (gancho, estructura, recursos visuales, CTA, qué tomar), hook.jpg (primeros 3 s) y sheet_NN.jpg (1 fotograma por segundo). Para comparar o contar entre reels y cuentas (qué ganchos, temas, duraciones, estructuras o CTA van mejor, buscar en transcripciones…), consulta el índice de la app con SQL (tools/studio_sql.py): sus tablas insp_accounts, insp_reels e insp_beats, siempre con project = '${PROJECT}'. Luego abre los archivos de los reels que te interesen si necesitas el detalle o ver los fotogramas. ` +
    'Úsalos cuando te pida ideas a partir de lo que funciona en otras cuentas; no copies guiones: adapta las ideas a su perfil.'
  );
};
