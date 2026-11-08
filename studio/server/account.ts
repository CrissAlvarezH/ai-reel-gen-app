// Mi cuenta: the Instagram account of the open project. Its handle is in the project's config/account.json
// (set on the page); its latest reels, with their numbers, are downloaded with the scraper chosen in Ajustes →
// Extracción de datos (the same as Inspiración's, server/inspiration.ts) and kept, gitignored, in the project
// (projects/<id>/):
//   account/<user>/account.json   {username, fullName, profile, fetched, error}, and avatar.jpg
//   account/<user>/<code>/        reel.json (metrics as of metricsAt, Instagram's expiring links), meta.json (all
//                                 the scraper returned), thumb.jpg; once analysed, like Inspiración's: hook.jpg,
//                                 sheet_NN.jpg, transcript.json, analysis.json; insights.json: Instagram's own
//                                 numbers (saves, shares, reach, watch time), when the project has an account in
//                                 Ajustes → Instagram (server/cloud.ts), read with each download
// Nothing is transcribed or analysed on its own: "Analizar" (a reel, or all those not analysed yet) does it
// with Inspiración's tools (tools/inspiration.py, then the agent with the reel's numbers against the account's),
// and "Analizar con el agente" opens a conversation about the whole account. The page's numbers and table come
// from the studio's index (projects-index.ts: own_accounts, own_reels, own_beats).
// The agent can also use the scraper itself, through tools/social.py, which calls this server (scrape*).
import fs from 'node:fs';
import path from 'node:path';
import {CONFIG, PROJECT, PROJECT_DIR, ROOT, rel, withProject} from './workspace.ts';
import {readJson, writeJson as writeJsonFile} from './platform.ts';
import {getKey} from './settings.ts';
import {httpError} from './reels.ts';
import * as insp from './inspiration.ts';
import {agentCli} from './agent.ts';
import {authorName, getProfile} from './config.ts';
import {transcriberReady} from './requirements.ts';
import * as db from './db.ts';
import * as index from './projects-index.ts';
import * as cloud from './cloud.ts';
import {MAX_ACCOUNT_REELS} from '../shared/types.ts';
import type {AccountStatus, InspirationProfile, InspirationRef, OwnReel, OwnReelCard, OwnReelList, ReelAnalysis, ReelTranscript, ServerEvent} from '../shared/types.ts';

const CODE = /^[A-Za-z0-9_-]{5,40}$/;
const TOP = 3; // "Los que mejor van"
export const FIRST = 10; // reels the first download brings; "Cargar más" adds as many again

const CONFIG_FILE = () => path.join(CONFIG, 'account.json');
const accDir = (u: string) => path.join(PROJECT_DIR, 'account', u);
const reelDir = (u: string, c: string) => path.join(accDir(u), c);
const writeJson = (p: string, v: unknown) => writeJsonFile(p, v, 1);

// insightsAt/insightsError: the last read of Instagram's own numbers (cloud.ts), from insightsAccount.
type AccountFile = {
  username: string;
  fullName: string | null;
  profile: InspirationProfile | null;
  fetched: number | null;
  error: string | null;
  insightsAccount?: string | null;
  insightsAt?: number | null;
  insightsError?: string | null;
};
type ReelFile = Omit<OwnReel, 'thumb' | 'ratio' | 'engagement' | 'video' | 'state' | 'error' | 'topic' | 'hook' | 'wps' | 'saves' | 'shares' | 'reach' | 'avgWatch' | 'retention' | 'skipRate'> & {
  added: number;
  videoUrl?: string | null; // Instagram's links: they expire in a day or two
  displayUrl?: string | null;
  error?: string | null; // of the last analysis (a new download clears it: its links are fresh)
};

let broadcast: (e: ServerEvent) => void = () => {};
export const setBroadcast = (fn: typeof broadcast) => (broadcast = fn);
// What changed on disk goes into the index first, so the page reads it.
const changed = () => {
  db.sync(true);
  broadcast({type: 'account'});
};

// Downloads going on, one per account folder. Those from the page give up if another project or workspace opens.
const jobs = new Map<string, NonNullable<AccountStatus['job']>>();
let gen = 0;
export function reset() {
  gen++;
  run?.ctrl.abort();
  run = null;
  busy.clear();
  owner.clear();
  refreshing.clear();
}

export const username = () => {
  const u = readJson<{username?: string}>(CONFIG_FILE())?.username;
  return typeof u === 'string' && insp.USER.test(u) ? u : null;
};

// "@user", "user" or the profile's URL.
export function setUsername(raw: unknown) {
  const {accounts, urls} = insp.parse(raw, 'account');
  if (accounts.length !== 1 || urls.length) throw httpError(400, 'escribe una sola cuenta: @usuario');
  writeJson(CONFIG_FILE(), {username: accounts[0]});
  changed();
  return status();
}

const dirs = (p: string) => {
  try {
    return fs.readdirSync(p, {withFileTypes: true}).filter((d) => d.isDirectory() && CODE.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
};
const readReel = (u: string, c: string) => readJson<ReelFile>(path.join(reelDir(u, c), 'reel.json'));

export async function status(): Promise<AccountStatus> {
  const u = username();
  const src = insp.source();
  const scraper = {id: src.id, label: src.label, ready: !!getKey(src.key)};
  const transcriber = await transcriberReady();
  const analysis = run && {done: run.done, total: run.total, started: run.started};
  const linked = cloud.linkedAccount();
  const none = {account: linked?.username ?? null, at: null, error: null};
  if (!u) return {username: null, fullName: null, profile: null, avatar: false, fetched: null, count: 0, top: [], median: null, engagement: null, job: null, error: null, scraper, states: {}, analysis: null, transcriber, insights: none};
  const a = readJson<AccountFile>(path.join(accDir(u), 'account.json'));
  return {
    username: u,
    fullName: a?.fullName ?? null,
    profile: a?.profile ?? null,
    avatar: fs.existsSync(path.join(accDir(u), 'avatar.jpg')),
    fetched: a?.fetched ?? null,
    ...withBusy(u, index.ownSummary(PROJECT, u, TOP)),
    job: jobs.get(accDir(u)) ?? null,
    error: a?.error ?? null,
    scraper,
    analysis,
    transcriber,
    insights: linked ? {account: linked.username, at: a?.insightsAt ?? null, error: a?.insightsError ?? null} : none,
  };
}

const requireUser = () => {
  const u = username();
  if (!u) throw httpError(400, 'aún no hay cuenta configurada en Mi cuenta');
  return u;
};
const clampLimit = (v: unknown, def: number) => Math.max(1, Math.min(MAX_ACCOUNT_REELS, Math.round(Number(v)) || def));

// What downloading the newest limit reels (and the profile) would cost at most.
export async function estimate(limitIn: unknown) {
  const u = requireUser();
  const limit = clampLimit(limitIn, FIRST);
  return {limit, ...(await insp.cost([{limit, known: dirs(accDir(u)).length}], 0))};
}

// Download the newest limit reels (their numbers as of now) and the profile, into the open project's account as
// of this call: all it needs from the project is read before its first await (see refreshProject). alive: whether
// the result still matters. Null if it stopped mattering.
async function download(u: string, limit: number, alive: () => boolean) {
  const dir = accDir(u);
  if (jobs.has(dir)) throw httpError(409, 'ya se está descargando la cuenta');
  jobs.set(dir, {limit, started: Date.now()});
  changed();
  const scraper = insp.source().label;
  const linked = cloud.linkedAccount();
  const old = (c: string) => readJson<ReelFile>(path.join(dir, c, 'reel.json'));
  const prev = readJson<AccountFile>(path.join(dir, 'account.json'));
  const save = (a: Partial<AccountFile>) => writeJson(path.join(dir, 'account.json'), {username: u, fullName: null, profile: null, fetched: null, error: null, ...prev, ...a});
  let problem: string | null = null;
  let reels = 0;
  try {
    const [res, prof] = await Promise.all([
      insp.fetchItems([u], u, limit, (c) => old(c)?.caption ?? null),
      insp.profileOf(u).catch((e: Error) => (console.error(`perfil de @${u}:`, e), null)),
    ]);
    if (!alive()) return null;
    problem = res.problem;
    for (const it of res.items) {
      const code = it.shortCode ?? '';
      if (it.error || !CODE.test(code)) continue;
      const m = insp.metricsOf(it);
      writeJson(path.join(dir, code, 'reel.json'), {
        code,
        url: it.url ?? `https://www.instagram.com/reel/${code}/`,
        caption: m.caption,
        posted: m.posted,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        duration: m.duration,
        music: m.music,
        metricsAt: m.metricsAt,
        videoUrl: m.videoUrl,
        displayUrl: m.displayUrl,
        added: old(code)?.added ?? Date.now(),
      } satisfies ReelFile);
      writeJson(path.join(dir, code, 'meta.json'), it.raw ?? it);
      reels++;
      const thumb = path.join(dir, code, 'thumb.jpg');
      if (m.displayUrl && !fs.existsSync(thumb)) await insp.download(m.displayUrl, thumb).catch((e) => console.error(`portada de ${code}:`, e));
    }
    if (prof?.picture) await insp.download(prof.picture, path.join(dir, 'avatar.jpg')).catch((e) => console.error(`foto de @${u}:`, e));
    if (!alive()) return null;
    const ins = linked ? await insights(dir, linked, limit) : {};
    if (!alive()) return null;
    if (!res.items.length) problem = problem ?? `${scraper} no devolvió reels de @${u} (¿la cuenta es privada o no existe?)`;
    save({fullName: prof?.fullName ?? prev?.fullName ?? null, profile: prof?.profile ?? prev?.profile ?? null, fetched: Date.now(), error: problem, ...ins});
    return {username: u, reels, problem, profile: !!prof};
  } catch (e) {
    if (alive()) save({error: (e as Error).message});
    throw e;
  } finally {
    jobs.delete(dir);
    if (alive()) changed();
  }
}

// Instagram's own numbers for the newest reels, next to each reel already downloaded (a reel only Meta lists,
// not the scraper yet, waits for the next download). Its failure doesn't fail the download: it's reported apart.
async function insights(dir: string, linked: {accountId: number; username: string}, limit: number): Promise<Partial<AccountFile>> {
  try {
    const r = await cloud.reelInsights(linked.accountId, limit);
    const at = Date.now();
    for (const x of r.reels) {
      if (!x.code || !CODE.test(x.code) || !fs.existsSync(path.join(dir, x.code, 'reel.json'))) continue;
      writeJson(path.join(dir, x.code, 'insights.json'), {mediaId: x.mediaId, metrics: x.metrics, error: x.error, at});
    }
    return {insightsAccount: r.username, insightsAt: at, insightsError: null};
  } catch (e) {
    console.error('métricas de Instagram:', (e as Error).message);
    return {insightsAccount: linked.username, insightsError: (e as Error).message};
  }
}

// From the page: waits until it's done.
export async function fetchLatest(limitIn: unknown) {
  const u = requireUser();
  insp.requireSource();
  const g = gen;
  await download(u, clampLimit(limitIn, FIRST), () => g === gen);
  return status();
}

// An automation's step, in a project that may not be the open one: paths and scraper are read within withProject,
// and opening another project doesn't waste what was paid for (only another workspace does).
export function refreshProject(project: string, limitIn: unknown) {
  const root = ROOT;
  return withProject(project, () => {
    const u = requireUser();
    insp.requireSource();
    return download(u, clampLimit(limitIn, FIRST), () => ROOT === root);
  });
}

// The table: one page of the reels, filtered and in order (query string: q, minRatio, sinceDays, dur, sort,
// desc, page, size).
export function list(raw: Record<string, unknown>): OwnReelList {
  const u = username();
  if (!u) return {rows: [], total: 0};
  const n = (k: string) => (Number.isFinite(Number(raw[k])) && Number(raw[k]) > 0 ? Number(raw[k]) : undefined);
  const dur = db.DURATIONS.find((d) => d === raw.dur);
  const state = (['ready', 'unanalysed', 'error'] as const).find((x) => x === raw.state);
  const res = index.ownList(PROJECT, u, {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : undefined,
    minRatio: n('minRatio'),
    sinceDays: n('sinceDays'),
    dur,
    state,
    sort: typeof raw.sort === 'string' ? raw.sort : undefined,
    desc: raw.desc !== 'false' && raw.desc !== false,
    page: n('page') ?? 0,
    size: n('size') ?? 10,
  });
  return {...res, rows: res.rows.map((r) => live(u, r))};
}

// One reel for its card: its numbers, its place by views, its saved metadata (meta.json, flattened like
// Inspiración's) and, once processed, its transcript, frames and analysis.
export function reel(c: string): OwnReelCard {
  const u = username();
  const r = u && CODE.test(c) ? index.ownReel(PROJECT, u, c) : null;
  if (!u || !r) throw httpError(404, 'reel no encontrado');
  const d = reelDir(u, c);
  const meta = readJson<Record<string, unknown>>(path.join(d, 'meta.json'));
  return {
    reel: live(u, r.reel),
    rank: r.rank,
    meta: meta && typeof meta === 'object' ? insp.metaFields(meta) : null,
    transcript: readJson<ReelTranscript>(path.join(d, 'transcript.json')),
    analysis: readJson<ReelAnalysis>(path.join(d, 'analysis.json')),
    files: {hook: fs.existsSync(path.join(d, 'hook.jpg')), sheets: sheetsOf(d)},
  };
}

// An account's picture and a reel's cover, for the page.
export function avatar() {
  const u = username();
  const p = u && path.join(accDir(u), 'avatar.jpg');
  return p && fs.existsSync(p) ? p : null;
}
// A reel's cover, first 3 s and frame sheets.
export function file(c: string, f: string) {
  const u = username();
  const p = u && CODE.test(c) && /^(thumb|hook|sheet_\d{2})\.jpg$/.test(f) && path.join(reelDir(u, c), f);
  return p && fs.existsSync(p) ? p : null;
}

/* ───── Its reels' analysis ("Analizar") ───── */
// Started by hand, one reel or all those not analysed yet; each one waits its turn (queued), then, if it
// hasn't been yet, its video is downloaded with the link the scraper gave (they expire in a day or two),
// transcribed and its frames taken (tools/inspiration.py, one at a time with Inspiración's), and the agent
// analyses it with its numbers against the account's (analysis.json, the same shape as Inspiración's).
// Errors stay in reel.json until it's analysed again or downloaded again. In memory: a restart forgets what
// was queued, and those reels show as they were.

type Busy = 'queued' | 'processing' | 'analyzing';
const busy = new Map<string, Busy>(); // by "<user>/<code>"
const owner = new Map<string, AbortController>(); // the run each busy reel belongs to
const refreshing = new Set<string>(); // the folders of the reels whose metrics are being read again
let run: {done: number; total: number; started: number; ctrl: AbortController} | null = null;

const sheetsOf = (d: string) => {
  try {
    return fs.readdirSync(d).filter((f) => /^sheet_\d{2}\.jpg$/.test(f)).sort();
  } catch {
    return [];
  }
};
const processed = (d: string) => fs.existsSync(path.join(d, 'transcript.json')) && fs.existsSync(path.join(d, 'hook.jpg'));
// The index's state, or what it's doing now.
const live = (u: string, r: OwnReel): OwnReel => ({...r, state: busy.get(`${u}/${r.code}`) ?? r.state, error: busy.has(`${u}/${r.code}`) ? null : r.error});
const withBusy = <T extends {top: OwnReel[]}>(u: string, x: T): T => ({...x, top: x.top.map((r) => live(u, r))});

const setError = (u: string, c: string, error: string | null) => {
  const r = readReel(u, c);
  if (r && (r.error ?? null) !== error) writeJson(path.join(reelDir(u, c), 'reel.json'), {...r, error});
};

// Instagram's video links carry when they expire (oe: seconds, in hex).
const expired = (url: string) => {
  const m = url.match(/[?&]oe=([0-9A-Fa-f]{6,10})(?:&|$)/);
  return !!m && parseInt(m[1], 16) * 1000 < Date.now() + 60_000;
};
const EXPIRED = 'el enlace del video caducó (Instagram los da por un día o dos): pulsa Actualizar métricas en el reel, que trae uno nuevo, y vuelve a analizarlo';

// reel.json with the video's link for tools/inspiration.py: reels downloaded before it was kept there have it in
// meta.json (Apify: videoUrl; ScrapeCreators: video_versions).
function withLink(u: string, c: string) {
  const r = readReel(u, c);
  if (!r) throw new Error('el reel ya no está');
  type Meta = {videoUrl?: unknown; displayUrl?: unknown; video_versions?: {url?: unknown}[]; image_versions2?: {candidates?: {url?: unknown}[]}};
  const m = readJson<Meta>(path.join(reelDir(u, c), 'meta.json'));
  const str = (v: unknown) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);
  const video = r.videoUrl ?? str(m?.videoUrl) ?? str(m?.video_versions?.[0]?.url);
  if (!video) throw new Error('el scraper no dio el enlace del video: pulsa Actualizar métricas en el reel y vuelve a analizarlo');
  if (expired(video)) throw new Error(EXPIRED);
  if (video !== r.videoUrl) writeJson(path.join(reelDir(u, c), 'reel.json'), {...r, videoUrl: video, displayUrl: r.displayUrl ?? str(m?.displayUrl) ?? str(m?.image_versions2?.candidates?.[0]?.url)});
}

const OWN_ANALYST = () => {
  const p = getProfile();
  return [
    `Analizas un reel de la propia cuenta de Instagram de ${authorName()}, que hace videos explicativos para ${p.platform}${p.audience ? ` (público: ${p.audience})` : ''}, para que vea qué funcionó, qué no y qué cambiar en los próximos. Es un video suyo, no de otra cuenta: no lo trates como una referencia que copiar, sino como su propio trabajo que mejorar. Juzga sus números contra el resto de sus reels: el multiplicador es sus vistas ÷ la mediana de sus reels, y la interacción, (likes + comentarios) ÷ vistas, frente a su media. Escribe los textos hablándole a él, de tú ("tu gancho", "en tus próximos videos").`,
    insp.IMAGES_NOTE,
    insp.analysisShape(p.language, '2–4 cosas concretas: qué repetir y qué cambiar en los próximos, con el porqué'),
  ].join('\n');
};

async function analyseReel(u: string, c: string, signal: AbortSignal) {
  const x = index.ownReel(PROJECT, u, c);
  if (!x) throw new Error('el reel ya no está');
  const r = x.reel;
  const acc = index.ownSummary(PROJECT, u, 0);
  const d = reelDir(u, c);
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('es'));
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`);
  const prompt = [
    `Reel de su cuenta @${u}: ${r.url}`,
    `Publicado: ${r.posted?.slice(0, 10) ?? '—'} · duración ${r.duration != null ? `${Math.round(r.duration)} s` : '—'} · vistas ${n(r.views)}${r.ratio != null ? ` (${r.ratio.toFixed(1)}× su mediana de ${n(acc.median)})` : ''}${x.rank ? ` · el ${x.rank}.º con más vistas de sus ${acc.count} reels descargados` : ''} · likes ${n(r.likes)} · comentarios ${n(r.comments)} · interacción ${pct(r.engagement)} (su media: ${pct(acc.engagement)})${r.music ? ` · música: ${r.music}` : ''}`,
    r.video ? `Lo hizo en el estudio: el video «${r.video.title ?? r.video.slug}».` : '',
    `Caption:\n${r.caption.slice(0, 1500) || '(vacío)'}`,
    insp.transcriptText(readJson<ReelTranscript>(path.join(d, 'transcript.json'))),
  ]
    .filter(Boolean)
    .join('\n\n');
  const images = [fs.existsSync(path.join(d, 'hook.jpg')) ? path.join(d, 'hook.jpg') : null, ...sheetsOf(d).slice(0, 4).map((s) => path.join(d, s))].filter((p): p is string => !!p);
  const reply = await agentCli.ask(prompt, OWN_ANALYST(), {model: 'smart', images, timeout: 4 * 60_000, signal});
  if (signal.aborted) throw new insp.Stopped('detenido');
  writeJson(path.join(d, 'analysis.json'), insp.parseAnalysis(reply));
}

async function task(u: string, c: string, g: number, ctrl: AbortController) {
  const k = `${u}/${c}`;
  const d = reelDir(u, c);
  const go = () => {
    if (g !== gen || ctrl.signal.aborted || owner.get(k) !== ctrl) throw new insp.Stopped('detenido');
  };
  try {
    if (!processed(d))
      await insp.processSlot(async () => {
        go(); // waited in the queue
        withLink(u, c);
        busy.set(k, 'processing');
        changed();
        await insp.processDir(d, ctrl.signal);
      });
    await insp.analyseSlot(async () => {
      go();
      busy.set(k, 'analyzing');
      changed();
      await analyseReel(u, c, ctrl.signal);
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (g === gen && !ctrl.signal.aborted && !(e instanceof insp.Stopped)) setError(u, c, /caduc/.test(msg) ? EXPIRED : msg);
  } finally {
    if (g === gen && owner.get(k) === ctrl) {
      busy.delete(k);
      owner.delete(k);
      if (run?.ctrl === ctrl && ++run.done >= run.total) run = null;
      changed();
    }
  }
}

// "Analizar" (codes: those reels, again if they were already) or "Analizar pendientes" (all: every one not
// analysed yet, those that failed too). Runs in the background.
export async function analyseReels(body: {codes?: unknown; all?: unknown}) {
  const u = requireUser();
  const known = new Set(dirs(accDir(u)).filter((c) => readReel(u, c)));
  const states = index.ownStates(PROJECT, u);
  const codes = body.all
    ? [...known].filter((c) => states.get(c) !== 'ready')
    : Array.isArray(body.codes)
      ? [...new Set(body.codes.filter((c): c is string => typeof c === 'string' && known.has(c)))]
      : [];
  const todo = codes.filter((c) => !busy.has(`${u}/${c}`));
  if (!todo.length) throw httpError(400, codes.length ? 'ya se están analizando' : body.all ? 'todos tus reels ya están analizados' : 'reel no encontrado');
  if (todo.some((c) => !processed(reelDir(u, c))) && !(await transcriberReady())) throw httpError(400, 'falta la transcripción: instálala en Ajustes → Requisitos → Transcripción');
  const g = gen;
  if (!run) run = {done: 0, total: 0, started: Date.now(), ctrl: new AbortController()};
  const ctrl = run.ctrl;
  run.total += todo.length;
  for (const c of todo) {
    busy.set(`${u}/${c}`, 'queued');
    owner.set(`${u}/${c}`, ctrl);
    setError(u, c, null);
  }
  changed();
  for (const c of todo) void task(u, c, g, ctrl);
  return {queued: todo.length};
}

// "Detener": what's queued doesn't start, and what's transcribing or being analysed stops (the reels stay as
// they were).
export function stopAnalysis() {
  if (!run) throw httpError(409, 'no se está analizando nada');
  run.ctrl.abort();
  for (const [k, c] of owner) if (c === run.ctrl) busy.delete(k), owner.delete(k);
  run = null;
  changed();
}

// What reading one reel's numbers again costs at most.
export const refreshCost = () => insp.cost([], 1);

// One reel's numbers, metadata and links again (one reel's price), in the open project's account as of this call: as
// in download, all it needs from the project is read before its first await. Null if the result stopped mattering.
async function readAgain(u: string, c: string, alive: () => boolean) {
  const dir = path.join(accDir(u), c);
  const read = () => readJson<ReelFile>(path.join(dir, 'reel.json'));
  const r = CODE.test(c) ? read() : null;
  if (!r) throw httpError(404, 'ese reel no está en Mi cuenta');
  if (refreshing.has(dir)) throw httpError(409, 'ya se están actualizando sus métricas');
  const scraper = insp.source().label;
  refreshing.add(dir);
  try {
    const {items} = await insp.fetchItems([r.url], null, 1);
    if (!alive()) return null;
    const it = items.find((i) => i.shortCode === c && !i.error);
    if (!it) throw httpError(502, `${scraper} no devolvió este reel: ¿lo borraste o la cuenta ahora es privada?`);
    const now = read() ?? r;
    const m = insp.metricsOf(it);
    writeJson(path.join(dir, 'reel.json'), {
      ...now,
      caption: m.caption,
      posted: m.posted ?? now.posted,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      duration: m.duration ?? now.duration,
      music: m.music,
      metricsAt: m.metricsAt,
      videoUrl: m.videoUrl,
      displayUrl: m.displayUrl,
      error: /caduc|enlace del video/.test(now.error ?? '') ? null : (now.error ?? null),
    } satisfies ReelFile);
    writeJson(path.join(dir, 'meta.json'), it.raw ?? it);
    return m;
  } finally {
    refreshing.delete(dir);
    if (alive()) changed();
  }
}

// "Actualizar métricas", e.g. when its video's link expired before it was analysed.
export async function refreshReel(c: string) {
  const u = requireUser();
  insp.requireSource();
  const g = gen;
  return (await readAgain(u, c, () => g === gen)) && reel(c);
}

// An automation's step, in a project that may not be the open one (see refreshProject).
export function refreshProjectReel(project: string, c: string) {
  const root = ROOT;
  return withProject(project, () => {
    const u = requireUser();
    insp.requireSource();
    return readAgain(u, c, () => ROOT === root);
  });
}

// A reel of the open project's Mi cuenta: what an automation's step keeps of it.
export function ownReelRef(code: unknown) {
  const u = username();
  const r = u && typeof code === 'string' && CODE.test(code) ? readReel(u, code) : null;
  if (!r) throw httpError(400, 'ese reel no está en Mi cuenta: elige otro');
  return {code: code as string, label: r.caption.replace(/\s+/g, ' ').trim().slice(0, 80)};
}

/* ───── The scraper for the agent (tools/social.py) ───── */
// Nothing of what these bring is saved (except "mine", which is fetchLatest): they answer the numbers and
// captions, and what it cost at most.

const strip = (it: insp.ApifyItem) => {
  const m = insp.metricsOf(it);
  return {code: it.shortCode ?? null, url: it.url ?? null, owner: it.ownerUsername ?? null, caption: m.caption, posted: m.posted, views: m.views, likes: m.likes, comments: m.comments, duration: m.duration, music: m.music};
};
const oneAccount = (raw: unknown) => {
  const {accounts} = insp.parse(raw, 'account');
  if (accounts.length !== 1) throw httpError(400, 'una cuenta: @usuario');
  return accounts[0];
};

// kind: "reels" (of an account, up to limit), "reel" (one, by its URL) or "profile".
export async function scrapeCost(kind: unknown, limitIn: unknown) {
  const limit = clampLimit(limitIn, 12);
  if (kind === 'reel') return insp.cost([], 1);
  if (kind === 'profile') return {...(await insp.cost([{limit: 0, known: 0}], 0)), reels: 0};
  return insp.cost([{limit, known: 0}], 0, false);
}

export async function scrapeReels(raw: unknown, limitIn: unknown) {
  insp.requireSource();
  const u = oneAccount(raw);
  const limit = clampLimit(limitIn, 12);
  const [res, c] = await Promise.all([insp.fetchItems([u], u, limit, () => null), insp.cost([{limit, known: 0}], 0, false)]);
  return {account: u, reels: res.items.filter((i) => !i.error).map(strip), problem: res.problem, charge: c.charge};
}

export async function scrapeReel(url: unknown) {
  insp.requireSource();
  const {urls} = insp.parse(url, 'video');
  if (urls.length !== 1) throw httpError(400, 'un enlace de reel');
  const [res, c] = await Promise.all([insp.fetchItems(urls, null, 1), insp.cost([], 1)]);
  return {reels: res.items.filter((i) => !i.error).map(strip), problem: res.problem, charge: c.charge};
}

export async function scrapeProfile(raw: unknown) {
  insp.requireSource();
  const u = oneAccount(raw);
  const p = await insp.profileOf(u);
  return {account: u, fullName: p?.fullName ?? null, profile: p?.profile ?? null};
}

/* ───── For the agent ───── */

const PY = process.platform === 'win32' ? 'python' : 'python3';

// His own reels attached to a message of the general conversation (Mi cuenta → "Preguntar sobre este reel").
export function validOwnRefs(refs: unknown): InspirationRef[] {
  const u = username();
  if (!u || !Array.isArray(refs)) return [];
  return refs
    .filter((r): r is InspirationRef => !!r && r.own === true && r.account === u && typeof r.code === 'string' && CODE.test(r.code) && fs.existsSync(path.join(reelDir(u, r.code), 'reel.json')))
    .map((r) => ({account: u, code: r.code, label: String(r.label ?? '').slice(0, 120), own: true}))
    .slice(0, 12);
}

export function ownRefsText(refs: InspirationRef[]) {
  if (!refs.length) return '';
  const lines = refs.map((r) => {
    const x = index.ownReel(PROJECT, r.account, r.code);
    const v = x?.reel;
    const metrics = v ? ` — ${v.views?.toLocaleString('es') ?? '—'} vistas${v.ratio != null ? ` (${v.ratio.toFixed(1)}× tu mediana)` : ''}${v.engagement != null ? `, interacción ${(v.engagement * 100).toFixed(1)} %` : ''}` : '';
    const from = v?.video ? `; salió del video ${rel(path.join(PROJECT_DIR, 'videos', v.video.slug))}/` : '';
    const done = fs.existsSync(path.join(reelDir(r.account, r.code), 'analysis.json')) ? '' : ' (sin analizar: solo números, caption y portada)';
    return `- ${v?.url ?? r.code}${metrics}: ${rel(reelDir(r.account, r.code))}/${from}${done}`;
  });
  return `Reels de su propia cuenta (@${refs[0].account}, Mi cuenta) sobre los que pregunta: son suyos, no referencias de otra cuenta. Antes de responder, lee de cada uno reel.json (métricas y caption), transcript.json y analysis.json si están, y mira hook.jpg y sheet_*.jpg si te sirve lo visual; compáralo con el resto de sus reels en el índice (own_reels, own_accounts) y, si salió de un video del proyecto, mira su guion y su estructura:\n${lines.join('\n')}`;
}

// In the general conversation's prompt: where the account's data is and how to use the scraper.
export function agentNote() {
  const u = username();
  const src = insp.source();
  return [
    u
      ? `Mi cuenta (página de la app): su cuenta de Instagram es @${u}. Sus reels con sus números están en el índice (own_reels y own_accounts, project = '${PROJECT}'; own_reels.video es el video del proyecto del que salió cada uno; los que analizó en Mi cuenta, con state = 'ready', tienen la transcripción y el análisis del agente: topic, hook_*, cta, visuals, takeaways, y su estructura en own_beats; con su cuenta de Instagram conectada en Ajustes → Instagram, también los números que solo ve el dueño: saves, shares, reach, avg_watch, retention y skip_rate, nulos si Meta aún no los tiene). Su llamado a la acción es guardar: saves es la señal que más le importa. Lo descargado está en ${rel(accDir(u))}/: account.json (perfil) y una carpeta por reel con reel.json (vistas, likes, comentarios, duración, caption, a la fecha de metricsAt), meta.json (todo lo que devolvió el scraper: hashtags, comentarios recientes…), thumb.jpg (portada) y, si se analizó, transcript.json, analysis.json, hook.jpg (primeros 3 s) y sheet_NN.jpg (1 fotograma por segundo).`
      : 'Mi cuenta (página de la app): aún no ha configurado su cuenta de Instagram.',
    `Scraper de redes (${src.label}, el elegido en Ajustes → Extracción de datos; gasta saldo de su cuenta en cada llamada): ${PY} tools/social.py mine [n] (descarga sus n reels más recientes a ${rel(path.join(PROJECT_DIR, 'account'))}/ y los lista) · reels @cuenta [n] (los n más recientes de otra cuenta, sin guardarlos) · reel <url> · profile @cuenta · cost reels|reel|profile [n] (lo que costaría, sin gastar). Cada llamada imprime lo que costó como mucho.`,
    u
      ? `Análisis de sus reels (lo mismo que el botón Analizar de Mi cuenta: se baja el video, se transcribe, se sacan sus fotogramas y un agente lo analiza con sus números; no gasta saldo del scraper sino de su suscripción de Claude, uno o dos minutos por reel): ${PY} tools/social.py analyse <código> […] (esos reels, otra vez si ya estaban) · analyse pending (todos los que no están analizados) · analyse status (cuántos van, cuáles fallaron; gratis) · analyse wait (espera a que termine lo que está en marcha, hasta 9 min; repítelo si sigue) · analyse stop. Corre en segundo plano y él lo ve en Mi cuenta. Después lee los análisis en el índice (own_reels con state = 'ready': topic, hook_*, cta, visuals, takeaways, transcript; own_beats).`
      : '',
    COST_RULE(),
  ]
    .filter(Boolean)
    .join(' ');
}

// What costs: he decides. Repeated in every request of "Analizar con el agente".
const COST_RULE = () =>
  `Costos: trabaja por defecto solo con lo que ya está descargado y analizado (el índice, ${rel(path.join(PROJECT_DIR, 'account'))}/, ${rel(path.join(PROJECT_DIR, 'inspiration'))}/). Nunca uses tools/social.py mine, reels, reel ni profile (gastan saldo del scraper) ni social.py analyse (gasta su suscripción de Claude) sin que él lo haya pedido o aceptado en esta conversación: si crees que hace falta (pocos reels, los importantes sin analizar, comparar con otra cuenta), termina primero con lo que hay y al final propónselo en una línea, con qué traerías o analizarías, para qué y cuánto cuesta (social.py cost …; para analyse, cuántos reels). Lo que ya está descargado no lo vuelvas a pedir.`;

// "Analizar con el agente": what he can ask for (the page's menu), the message he sees, and the instructions
// that go with it.
export const REQUESTS = ['reels', 'ideas', 'variants', 'general'] as const;
export type RequestKind = (typeof REQUESTS)[number];

export function analysisRequest(kindIn: unknown) {
  const u = requireUser();
  const kind: RequestKind = REQUESTS.find((k) => k === kindIn) ?? 'reels';
  const {count, states} = index.ownSummary(PROJECT, u, 0);
  const analysed = states.ready ?? 0;
  const where = `Sus números están en el índice: ${PY} tools/studio_sql.py "SELECT … FROM own_reels WHERE project = '${PROJECT}' AND account = '${u}'" (con ratio, engagement y video, el video de ${rel(path.join(PROJECT_DIR, 'videos'))}/ del que salió; own_accounts tiene la mediana y el perfil). ${analysed} de los ${count} están analizados (state = 'ready'): de esos usa su transcripción y el análisis (topic, hook_text, hook_why, cta, visuals, takeaways, own_beats); de los demás solo hay números, caption y portada. Cuando un reel salga de un video (own_reels.video), mira su guion y su estructura (videos.script, video_beats). El detalle está en ${rel(accDir(u))}/ (meta.json: hashtags, comentarios recientes…; thumb.jpg, y hook.jpg y sheet_NN.jpg de los analizados).`;
  const few = count < 5 ? `Hay pocos reels descargados (${count}): dilo, y al final propón traer más (${PY} tools/social.py cost reels 20 para saber cuánto cuesta).` : '';
  const honest = 'No inventes números: si falta un dato, dilo. Cita los reels por su tema o el inicio del caption, con sus números.';
  const R: Record<RequestKind, {label: string; text: string; task: string}> = {
    reels: {
      label: 'Analizar los videos cargados',
      text: `Analiza mis reels cargados de @${u} (${count}): qué funciona, qué no y qué hago en los próximos.`,
      task: 'Compara cada reel con la mediana de vistas (multiplicador), y mira la interacción ((likes + comentarios) ÷ vistas), la duración, el gancho y el tema. Si sirve, compáralo con lo que funciona en Inspiración (insp_*). Responde en el chat, breve y con datos: 1) qué reels destacan y por qué, 2) qué patrones se repiten en los que van mejor y en los que van peor, 3) de 3 a 5 cambios concretos para los próximos.',
    },
    ideas: {
      label: 'Proponer nuevas ideas',
      text: `Propón ideas para mis próximos reels de @${u}, a partir de lo que mejor me funciona.`,
      task: `Sigue la skill content-ideas. Parte de los reels que superan su mediana (sus temas, ganchos y formatos), de lo que va peor (para evitarlo), de los videos que ya hizo en el proyecto (videos: no repitas temas, aunque una segunda parte o una serie sí vale) y, si ayuda, de lo que funciona en Inspiración (insp_*: adapta, nunca copies). Responde en el chat con 5 a 8 ideas, cada una en pocas líneas: el tema, el gancho literal de los primeros 3 s, por qué debería funcionar (con el reel suyo o de Inspiración en que se apoya y sus números) y la duración. Al final, ofrécele escribir el guion de la que elija o crear el video.`,
    },
    variants: {
      label: 'Crear variantes de contenido',
      text: `Crea variantes de mis reels que mejor van en @${u}: otros ganchos, ángulos y formatos del mismo tema.`,
      task: 'Para los ganchos y ángulos, sigue la skill content-ideas. Elige sus 3 reels con mejor multiplicador (o los que él nombre). Para cada uno, en pocas líneas: por qué funcionó (con sus números), 3 ganchos alternativos literales para los primeros 3 s, 2 ángulos distintos del mismo tema (otra pregunta, otro ejemplo, otro público, el error contrario…), un cambio de formato (más corto, serie en partes, mito contra realidad…) y un caption alternativo. Básate en su transcripción y análisis si están analizados, o en el guion de su video (videos.script) si salió de uno. Al final, ofrécele convertir la variante que elija en un video nuevo.',
    },
    general: {
      label: 'Hacer análisis general',
      text: `Haz un análisis general de mi cuenta @${u}: dónde estoy, qué me funciona y hacia dónde ir.`,
      task: 'Mira la cuenta entera: el perfil (seguidores, bio, publicaciones), cada cuánto publica (las fechas), cómo evolucionan las vistas y la interacción (los recientes contra los anteriores), qué temas, series, duraciones y ganchos van mejor y peor, y cómo está frente a las cuentas de Inspiración (insp_accounts: seguidores, mediana; insp_reels). Responde en el chat, breve y con datos, con estas secciones: Dónde estás (los números clave), Qué te funciona, Qué no, Frente a otras cuentas, y 3 prioridades para las próximas semanas.',
    },
  };
  const r = R[kind];
  return {
    text: r.text,
    note: [`${r.label} (menú «Analizar con el agente» de Mi cuenta).`, where, few, r.task, honest, COST_RULE()].filter(Boolean).join(' '),
  };
}
