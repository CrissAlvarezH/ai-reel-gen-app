// The sync queue: what decides when server/sync.ts runs. Jobs are per project (.reel-studio/sync-queue.json), and one
// runs at a time across all of them. The only sources are the button and the changes that matter happening on disk;
// there is no periodic check and nothing runs on opening a project. Everything takes the project explicitly, because a
// job has to end in the project it started in whatever he opens meanwhile.
import {createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as cloud from './cloud.ts';
import {GROUPS, classify, covers, isGroup, parseScope, scopeKey, type Channel, type Scope} from './sync-rules.ts';
import {download, docOnDisk, land, loadState, peekState, review, runCycle, saveState, target, type Context, type CycleResult} from './sync.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {ROOT, finishProject, isProjectId, lessonsSeed, listProjects, projectDir, seedPaths} from './workspace.ts';
import type {ServerEvent, SyncActivity, SyncClone, SyncConflict, SyncDetail, SyncGroupId, SyncJob, SyncJobStats, SyncOverview, SyncPreview, SyncProjectStatus, SyncQueue} from '../shared/types.ts';

const HISTORY = 20;
export const timing = {groupWait: 30_000, maxWait: 5 * 60_000, renderWait: 3_000, retries: [60_000, 5 * 60_000, 15 * 60_000], statusCache: 15_000};

let send: (e: ServerEvent) => void = () => {};
let videoBusy: (dir: string, slug: string) => boolean = () => false;
export function configure(deps: {send?: typeof send; videoBusy?: typeof videoBusy}) {
  if (deps.send) send = deps.send;
  if (deps.videoBusy) videoBusy = deps.videoBusy;
}

/* ───── The queue on disk ───── */

const queueFile = (dir: string) => path.join(dir, '.reel-studio', 'sync-queue.json');
const readQueue = (dir: string): SyncQueue => ({jobs: [], history: [], ...readJson<Partial<SyncQueue>>(queueFile(dir))});
// A project deleted while its job was going on stays deleted.
const writeQueue = (dir: string, q: SyncQueue) => {
  if (fs.existsSync(dir)) writeJson(queueFile(dir), q, 0);
};
function change<T>(dir: string, fn: (q: SyncQueue) => T): T {
  const q = readQueue(dir);
  const out = fn(q);
  writeQueue(dir, q);
  return out;
}
const known = (id: string) => {
  if (!isProjectId(id) || !listProjects().some((p) => p.id === id)) throw httpError(404, 'proyecto no encontrado');
  return projectDir(id);
};
const waitingJob = (j: SyncJob) => j.state === 'pending' || j.state === 'confirm';

type Running = {project: string; job: string; ctl: AbortController; done: number; total: number};
let running: Running | null = null;
const emit = (project: string, state: SyncActivity, done = 0, total = 0) => send({type: 'sync', project, state, done, total});

function archive(q: SyncQueue, job: SyncJob) {
  q.jobs = q.jobs.filter((j) => j.id !== job.id);
  q.history = [job, ...q.history.filter((j) => j.id !== job.id)].slice(0, HISTORY);
}

/* ───── Adding work ───── */

export type EnqueueOptions = {trigger?: 'manual' | 'auto'; confirmDeletes?: boolean};
export function enqueue(project: string, scope: string, {trigger = 'auto', confirmDeletes = false}: EnqueueOptions = {}) {
  const dir = projectDir(project);
  const job = change(dir, (q) => {
    // A wider job does what the narrower ones waiting would have done.
    q.jobs = q.jobs.filter((j) => !(waitingJob(j) && j.scope !== scope && covers(scope, j.scope)));
    const same = q.jobs.find((j) => waitingJob(j) && covers(j.scope, scope));
    if (same) {
      if (trigger === 'manual') {
        same.trigger = 'manual';
        same.nextAt = 0;
        same.attempts = 0;
      }
      if (confirmDeletes) {
        same.confirmDeletes = true;
        if (same.state === 'confirm') same.state = 'pending';
      }
      return same;
    }
    const j: SyncJob = {id: randomBytes(4).toString('hex'), scope, state: 'pending', trigger, created: Date.now(), started: null, ended: null, attempts: 0, nextAt: 0, waiting: null, error: null, confirmDeletes, deletes: 0, done: 0, total: 0, stats: null, warnings: []};
    q.jobs.push(j);
    return j;
  });
  forgetStatus(project);
  emit(project, 'waiting');
  pump();
  return job;
}

// What's allowed to enqueue something by itself. Anything else: nothing, and no noise.
function eligible(dir: string, group?: SyncGroupId) {
  if (!cloud.signedIn()) return false;
  const l = cloud.syncLink(dir);
  if (!l || !loadState(dir, 'project', l.cloudId!).firstFullAt) return false;
  return !group || cloud.syncGroups(dir).has(group);
}

/* ───── Running it ───── */

let timer: NodeJS.Timeout | undefined;
const blockedByAgent = (dir: string, j: SyncJob) => {
  const scope = parseScope(j.scope);
  return scope?.kind === 'video' && videoBusy(dir, scope.slug);
};

export function pump() {
  clearTimeout(timer);
  if (running || !ROOT || !cloud.signedIn()) return;
  const now = Date.now();
  let next: {project: string; dir: string; job: SyncJob} | null = null;
  let soonest = Infinity;
  for (const {id} of listProjects()) {
    const dir = projectDir(id);
    for (const job of readQueue(dir).jobs) {
      if (job.state !== 'pending') continue;
      if (job.nextAt > now) {
        soonest = Math.min(soonest, job.nextAt);
        continue;
      }
      if (blockedByAgent(dir, job)) continue;
      if (!next || job.created < next.job.created) next = {project: id, dir, job};
    }
  }
  if (next) return void run(next.project, next.dir, next.job.id);
  if (Number.isFinite(soonest)) {
    timer = setTimeout(pump, Math.max(50, soonest - now));
    timer.unref();
  }
}

const emptyStats = (): SyncJobStats => ({uploaded: 0, downloaded: 0, deleted: 0, skipped: 0, conflicts: 0});
const hasNetworkProblem = (e: unknown) => {
  const {offline, status} = e as {offline?: boolean; status?: number};
  return !!offline || (status ?? 0) >= 500;
};
const sharedSeeds = () => new Set([...seedPaths()].filter((p) => /^(styles|formats)\//.test(p)));
function lessonsSha() {
  try {
    return createHash('sha256').update(fs.readFileSync(lessonsSeed())).digest('hex');
  } catch {
    return null;
  }
}

async function run(project: string, dir: string, jobId: string) {
  const ctl = new AbortController();
  const me: Running = {project, job: jobId, ctl, done: 0, total: 0};
  running = me;
  const job = change(dir, (q) => {
    const j = q.jobs.find((x) => x.id === jobId)!;
    Object.assign(j, {state: 'running', started: Date.now(), waiting: null});
    return {...j};
  });
  emit(project, 'running');
  let lastEmit = 0;
  const progress = (done: number, total: number) => {
    me.done = done;
    me.total = total;
    if (Date.now() - lastEmit < 200) return;
    lastEmit = Date.now();
    emit(project, 'running', done, total);
  };
  const finish = (fn: (q: SyncQueue, j: SyncJob) => void) =>
    change(dir, (q) => {
      const j = q.jobs.find((x) => x.id === jobId);
      if (j) fn(q, j);
    });
  try {
    const out = await execute(project, dir, job, ctl.signal, progress);
    finish((q, j) => {
      Object.assign(j, {stats: out.stats, warnings: out.warnings, attempts: 0, nextAt: 0, error: null});
      if (out.confirm !== null) Object.assign(j, {state: 'confirm', deletes: out.confirm, started: null});
      else {
        Object.assign(j, {state: 'done', ended: Date.now()});
        archive(q, j);
      }
    });
    if (out.paths.length) announce(project, out.paths);
    emit(project, out.confirm !== null ? 'confirm' : 'done');
  } catch (e) {
    const err = e as Error & {status?: number};
    if (err.name === 'AbortError' || ctl.signal.aborted) {
      finish((q, j) => void (q.jobs = q.jobs.filter((x) => x.id !== j.id)));
      emit(project, 'idle');
    } else if (err.status === 401) {
      // The session ended: it waits for the next one, without a red line about it.
      finish((_q, j) => Object.assign(j, {state: 'pending', started: null, waiting: 'Sin sesión'}));
      emit(project, 'waiting');
    } else if (hasNetworkProblem(e)) {
      finish((_q, j) => {
        const wait = timing.retries[Math.min(j.attempts, timing.retries.length - 1)];
        Object.assign(j, {state: 'pending', started: null, attempts: j.attempts + 1, nextAt: Date.now() + wait, waiting: 'Sin conexión: se reintenta'});
      });
      emit(project, 'waiting');
    } else {
      finish((q, j) => {
        Object.assign(j, {state: 'error', ended: Date.now(), error: err.message});
        archive(q, j);
      });
      emit(project, 'error');
    }
  } finally {
    running = null;
    forgetStatus(project);
    refreshWatchers();
    pump();
  }
}

type Done = {stats: SyncJobStats; warnings: string[]; paths: string[]; confirm: number | null};

async function execute(project: string, dir: string, job: SyncJob, signal: AbortSignal, progress: (d: number, t: number) => void): Promise<Done> {
  const scope = parseScope(job.scope);
  if (!scope) throw httpError(400, 'alcance no válido');
  const link = cloud.syncLink(dir);
  if (!link) throw httpError(409, 'este proyecto ya no está vinculado a tu cuenta');
  const cloudId = link.cloudId!;
  const active = cloud.syncGroups(dir);
  const out: Done = {stats: emptyStats(), warnings: [], paths: [], confirm: null};
  const group = scope.kind === 'video' ? 'videos' : scope.kind === 'group' ? scope.group : null;
  if (group && !active.has(group)) return out; // switched off after it was queued
  if (scope.kind === 'full' && job.trigger === 'manual') {
    const st = loadState(dir, 'project', cloudId);
    if (!st.firstFullAt) saveState(dir, 'project', {...st, firstFullAt: Date.now()});
  }
  const base = {scope, active, confirmDeletes: job.confirmDeletes, signal, busyVideo: (slug: string) => videoBusy(dir, slug)};
  let offset = 0;
  let lastTotal = 0;
  const channel = async (ctx: Context) => {
    offset += lastTotal;
    lastTotal = 0;
    const r = await runCycle({...ctx, onProgress: (p) => {
      lastTotal = Math.max(lastTotal, p.total);
      progress(offset + p.done, offset + p.total);
    }});
    merge(out, r);
  };
  if (scope.kind !== 'group' || scope.group !== 'styles') await channel({...base, dir, channel: 'project', cloudId});
  if (out.confirm === null && active.has('styles') && (scope.kind === 'full' || (scope.kind === 'group' && scope.group === 'styles'))) {
    const {project: shared} = await cloud.syncApi.shared();
    await channel({...base, dir: ROOT, channel: 'shared', cloudId: shared.id, builtin: sharedSeeds(), seedSha: lessonsSha()});
    if (out.confirm === null) {
      const st = loadState(dir, 'project', cloudId);
      saveState(dir, 'project', {...st, groupsAt: {...st.groupsAt, styles: Date.now()}});
    }
  }
  if (out.confirm === null) await refreshRemote(dir, cloudId, scope.kind === 'full').catch(() => {});
  return out;
}

function merge(out: Done, r: CycleResult) {
  for (const k of Object.keys(out.stats) as (keyof SyncJobStats)[]) out.stats[k] += r[k];
  out.warnings.push(...r.warnings);
  out.paths.push(...r.paths);
  if (r.needsConfirm !== null) out.confirm = r.needsConfirm;
}

// claim: only a full sync started here makes this computer the one that runs the automations.
async function refreshRemote(dir: string, cloudId: string, claim: boolean) {
  const remote = await cloud.syncApi.state(cloudId);
  const st = loadState(dir, 'project', cloudId);
  saveState(dir, 'project', {...st, remote});
  await cloud.settlePrimary(dir, cloudId, remote.primaryDeviceId ?? null, claim);
  return remote;
}

// The pages that show what just landed. No {type: 'workspace'}: that one reloads the whole page.
function announce(project: string, paths: string[]) {
  send({type: 'synced', project, paths});
  if (paths.includes('automations.json')) send({type: 'automations'});
  if (paths.includes('fact-audit.json')) send({type: 'audit'});
  if (paths.some((p) => p.startsWith('avatar.'))) send({type: 'projects'});
}

/* ───── The disk ───── */

// One watcher per project that can enqueue: recursive, because a per-folder one would mean thousands of them with
// Inspiración. Agents that write straight to disk are seen the same as the app's endpoints.
const watchers = new Map<string, fs.FSWatcher>();
const pending = new Map<string, {timer: NodeJS.Timeout; first: number}>();
const rendered = new Map<string, number>();
const RENDER = /^videos\/([a-z0-9][a-z0-9-]{0,60})\/out\/([^/]+?)(\.raw)?\.mp4$/i;

function later(key: string, wait: number, fn: () => void, cap = Infinity) {
  const old = pending.get(key);
  if (old) clearTimeout(old.timer);
  const first = old?.first ?? Date.now();
  const delay = Math.min(wait, Math.max(0, first + cap - Date.now()));
  const t = setTimeout(() => {
    pending.delete(key);
    fn();
  }, delay);
  t.unref();
  pending.set(key, {timer: t, first});
}

// A render counts once it's a playable file with its raw gone, which is what render.sh does last. Render by render:
// a draft leaves its own raw behind only while it's being made, and another video's render says nothing about this one.
function checkRender(project: string, dir: string, slug: string, name: string) {
  const out = path.join(dir, 'videos', slug, 'out');
  if (fs.existsSync(path.join(out, `${name}.raw.mp4`))) return;
  let st: fs.Stats;
  try {
    st = fs.statSync(path.join(out, `${name}.mp4`));
  } catch {
    return;
  }
  const key = `${dir}/${slug}/${name}`;
  if (!st.size || rendered.get(key) === st.mtimeMs) return;
  rendered.set(key, st.mtimeMs);
  if (eligible(dir, 'videos')) enqueue(project, `video:${slug}`);
}

// The app's own writes (a sync landing, an automation run that only touched its history) don't count: they aren't new content.
async function flushGroup(project: string, dir: string, group: SyncGroupId) {
  if (!eligible(dir, group)) return;
  const l = cloud.syncLink(dir);
  if (!l) return;
  const state = loadState(dir, 'project', l.cloudId!);
  const r = await review({dir, channel: 'project', cloudId: l.cloudId!, scope: {kind: 'group', group}, active: new Set([group])}, state);
  if (r.changed.length || r.deletes.length) enqueue(project, `group:${group}`);
}

function onDisk(project: string, dir: string, nameIn: string | null) {
  if (!nameIn) return;
  const rel = nameIn.split(path.sep).join('/').normalize('NFC');
  const render = RENDER.exec(rel);
  if (render) return later(`render:${project}:${render[1]}:${render[2]}`, timing.renderWait, () => checkRender(project, dir, render[1], render[2]));
  const c = classify(rel, 'project');
  // A video's working files don't enqueue anything: it syncs when it's finished, not on every save.
  if (!c || c.group === 'videos') return;
  later(`group:${project}:${c.group}`, timing.groupWait, () => void flushGroup(project, dir, c.group).catch((e) => console.error('[sync]', (e as Error).message)), timing.maxWait);
}

export function refreshWatchers() {
  const wanted = new Set(ROOT ? listProjects().filter((p) => eligible(projectDir(p.id))).map((p) => p.id) : []);
  for (const [id, w] of watchers) {
    if (wanted.has(id)) continue;
    w.close();
    watchers.delete(id);
  }
  for (const id of wanted) {
    if (watchers.has(id)) continue;
    const dir = projectDir(id);
    try {
      const w = fs.watch(dir, {recursive: true}, (_ev, name) => onDisk(id, dir, name));
      w.on('error', () => {
        w.close();
        watchers.delete(id);
      });
      watchers.set(id, w);
    } catch (e) {
      console.error('[sync] no se pudo vigilar', id, (e as Error).message);
    }
  }
}

function stopWatching() {
  for (const w of watchers.values()) w.close();
  watchers.clear();
  for (const {timer: t} of pending.values()) clearTimeout(t);
  pending.clear();
}

// When the studio starts, and in a workspace just opened: anything left running was cut off and goes back in line.
export function startSync() {
  if (ROOT)
    for (const {id} of listProjects()) {
      const dir = projectDir(id);
      const q = readQueue(dir);
      if (!q.jobs.some((j) => j.state === 'running')) continue;
      for (const j of q.jobs) if (j.state === 'running') Object.assign(j, {state: 'pending', started: null, done: 0, total: 0});
      writeQueue(dir, q);
    }
  refreshWatchers();
  pump();
}

// Another workspace: nothing of the old one goes on.
export function resetSync() {
  running?.ctl.abort();
  stopWatching();
  rendered.clear();
  clones.clear();
  statusCache.clear();
  startSync();
}

export function stopSync() {
  stopWatching();
  clearTimeout(timer);
  running?.ctl.abort();
}

/* ───── Status ───── */

const statusCache = new Map<string, {at: number; up: number}>();
const forgetStatus = (id: string) => statusCache.delete(id);

async function pendingUploads(id: string, dir: string, cloudId: string) {
  const cached = statusCache.get(id);
  if (cached && Date.now() - cached.at < timing.statusCache) return cached.up;
  const state = loadState(dir, 'project', cloudId);
  const r = await review({dir, channel: 'project', cloudId, scope: {kind: 'full'}, active: cloud.syncGroups(dir), busyVideo: (s) => videoBusy(dir, s)}, state, true);
  const up = r.changed.length + r.deletes.length + r.busyChanged;
  statusCache.set(id, {at: Date.now(), up});
  return up;
}

async function statusOf(id: string): Promise<SyncProjectStatus> {
  const dir = projectDir(id);
  const base: SyncProjectStatus = {id, state: 'local', up: 0, down: 0, conflicts: 0, done: 0, total: 0, error: null, lastAt: null};
  const link = cloud.syncLink(dir);
  if (!link) return base;
  const st = loadState(dir, 'project', link.cloudId!);
  const q = readQueue(dir);
  const lastAt = Math.max(0, ...Object.values(st.groupsAt).map((n) => n ?? 0)) || null;
  const conflicts = st.remote?.openConflicts ?? 0;
  const seenUpTo = Math.max(st.baseRev, ...Object.values(st.files).map((f) => f.rev), 0);
  const down = st.remote && st.remote.rev > seenUpTo ? st.remote.rev - seenUpTo : 0;
  const up = await pendingUploads(id, dir, link.cloudId!);
  const common = {...base, up, down, conflicts, lastAt};
  if (running?.project === id) return {...common, state: 'syncing', done: running.done, total: running.total};
  const err = q.history[0]?.state === 'error' ? q.history[0].error : null;
  if (err) return {...common, state: 'error', error: err};
  if (conflicts) return {...common, state: 'conflict'};
  return {...common, state: up || down ? 'changes' : 'synced'};
}

function partialClones(): SyncClone[] {
  if (!ROOT) return [...clones.values()];
  const out = new Map(clones);
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(ROOT, 'projects'));
  } catch {
    /* none yet */
  }
  for (const folder of names) {
    const dir = path.join(ROOT, 'projects', folder);
    if (fs.existsSync(path.join(dir, 'project.json'))) continue;
    const l = cloud.linkOf(dir);
    if (l?.cloudId && cloud.syncLink(dir) && !out.has(l.cloudId)) out.set(l.cloudId, {cloudId: l.cloudId, folder, running: false, done: 0, total: 0, error: null});
  }
  return [...out.values()];
}

export async function overview(): Promise<SyncOverview> {
  if (!cloud.signedIn()) return {signedIn: false, projects: ROOT ? listProjects().map((p) => ({id: p.id, state: 'local', up: 0, down: 0, conflicts: 0, done: 0, total: 0, error: null, lastAt: null})) : [], clones: []};
  return {signedIn: true, projects: await Promise.all(listProjects().map((p) => statusOf(p.id))), clones: partialClones()};
}

export async function detail(project: string, refresh: boolean): Promise<SyncDetail> {
  const dir = known(project);
  const active = cloud.syncGroups(dir);
  const link = cloud.syncLink(dir);
  if (refresh && link) await refreshRemote(dir, link.cloudId!, false).catch(() => {});
  const st = link ? loadState(dir, 'project', link.cloudId!) : null;
  const q = readQueue(dir);
  const live = running?.project === project ? q.jobs.map((j) => (j.id === running!.job ? {...j, done: running!.done, total: running!.total} : j)) : q.jobs;
  return {
    project,
    signedIn: cloud.signedIn(),
    linked: !!link,
    online: cloud.session().online,
    groups: Object.fromEntries(GROUPS.map((g) => [g, active.has(g)])) as SyncDetail['groups'],
    groupsAt: st?.groupsAt ?? {},
    lastAt: Math.max(0, ...Object.values(st?.groupsAt ?? {}).map((n) => n ?? 0)) || null,
    first: !st?.firstFullAt,
    status: await statusOf(project),
    queue: {jobs: live, history: q.history},
    remote: st?.remote ?? null,
    primary: {deviceId: cloud.deviceId(), elsewhere: cloud.runsElsewhere(dir)},
  };
}

// What the first sync would send, without reading the files: it's asked before anything leaves.
export async function preview(project: string): Promise<SyncPreview> {
  const dir = known(project);
  const active = cloud.syncGroups(dir);
  const out: SyncPreview = {files: 0, bytes: 0, groups: {}};
  const add = async (ctx: Context, state: ReturnType<typeof peekState>) => {
    const r = await review(ctx, state, true);
    for (const l of r.changed) {
      const group = classify(l.path, ctx.channel, ctx.builtin)?.group;
      if (!group) continue;
      const g = (out.groups[group] ??= {files: 0, bytes: 0});
      g.files++;
      g.bytes += l.size;
      out.files++;
      out.bytes += l.size;
    }
  };
  const l = cloud.syncLink(dir);
  await add({dir, channel: 'project', cloudId: l?.cloudId ?? '', scope: {kind: 'full'}, active}, l?.cloudId ? loadState(dir, 'project', l.cloudId) : peekState(dir, 'project'));
  if (active.has('styles') && ROOT) await add({dir: ROOT, channel: 'shared', cloudId: '', scope: {kind: 'full'}, active, builtin: sharedSeeds(), seedSha: lessonsSha()}, peekState(ROOT, 'shared'));
  return out;
}

export function queueOf(project: string) {
  return readQueue(known(project));
}

/* ───── Endpoints ───── */

const linkedDir = (project: string) => {
  const dir = known(project);
  if (!cloud.signedIn()) throw httpError(401, 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta');
  const l = cloud.syncLink(dir);
  if (!l) throw httpError(409, 'este proyecto aún no está en tu cuenta');
  return {dir, cloudId: l.cloudId!};
};

export function runNow(project: string, body: {scope?: unknown; confirmDeletes?: unknown}) {
  const {dir, cloudId} = linkedDir(project);
  const scope: Scope | null = parseScope(body?.scope);
  if (!scope) throw httpError(400, 'alcance no válido');
  const active = cloud.syncGroups(dir);
  const group = scope.kind === 'video' ? 'videos' : scope.kind === 'group' ? scope.group : null;
  if (group && !active.has(group)) throw httpError(409, 'ese grupo está apagado');
  if (!active.size) throw httpError(409, 'activa al menos un grupo');
  if (scope.kind !== 'full' && !loadState(dir, 'project', cloudId).firstFullAt) throw httpError(409, 'primero haz una sincronización completa');
  return enqueue(project, scopeKey(scope), {trigger: 'manual', confirmDeletes: body?.confirmDeletes === true});
}

export function cancel(project: string, id: string) {
  const dir = known(project);
  if (running?.project === project && running.job === id) {
    running.ctl.abort();
    return readQueue(dir);
  }
  const q = change(dir, (x) => {
    x.jobs = x.jobs.filter((j) => j.id !== id);
    return x;
  });
  emit(project, 'idle');
  return q;
}

export function retry(project: string, id: string) {
  const dir = known(project);
  const q = change(dir, (x) => {
    const old = x.history.find((j) => j.id === id && j.state === 'error');
    if (old) {
      x.history = x.history.filter((j) => j !== old);
      if (!x.jobs.some((j) => waitingJob(j) && covers(j.scope, old.scope))) x.jobs.push({...old, state: 'pending', error: null, attempts: 0, nextAt: 0, started: null, ended: null, waiting: null, done: 0, total: 0});
    }
    for (const j of x.jobs) if (j.id === id && j.state === 'pending') Object.assign(j, {nextAt: 0, attempts: 0});
    return x;
  });
  emit(project, 'waiting');
  pump();
  return q;
}

export function setGroups(project: string, groupsIn: unknown) {
  const dir = known(project);
  if (!groupsIn || typeof groupsIn !== 'object') throw httpError(400, 'grupos no válidos');
  const groups = Object.fromEntries(Object.entries(groupsIn).filter(([g, v]) => isGroup(g) && typeof v === 'boolean')) as Partial<Record<SyncGroupId, boolean>>;
  cloud.setSyncGroups(dir, groups);
  // Anything of a group he just turned off that was still waiting goes too.
  change(dir, (q) => {
    q.jobs = q.jobs.filter((j) => {
      if (!waitingJob(j)) return true;
      const s = parseScope(j.scope);
      const g = s?.kind === 'video' ? 'videos' : s?.kind === 'group' ? s.group : null;
      return !g || groups[g] !== false;
    });
  });
  forgetStatus(project);
  return detail(project, false);
}

export async function primary(project: string) {
  const {dir} = linkedDir(project);
  await cloud.makePrimary(dir);
  send({type: 'automations'});
  return detail(project, false);
}

/* ───── Conflicts ───── */

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
function normalise(c: Record<string, unknown>, channel: Channel): SyncConflict & {loserSha256: string | null} {
  return {
    id: String(c.id),
    channel,
    path: String(c.path),
    winnerDevice: str(c.winnerDevice ?? c.winner_device),
    winnerMtime: num(c.winnerMtime ?? c.winner_mtime),
    loserDevice: str(c.loserDevice ?? c.loser_device),
    loserMtime: num(c.loserMtime ?? c.loser_mtime),
    loserDeleted: !!(c.loserDeleted ?? c.loser_deleted),
    loserStorage: (str(c.loserStorage ?? c.loser_storage) as SyncConflict['loserStorage']) ?? null,
    created: str(c.createdAt ?? c.created_at),
    loserSha256: str(c.loserSha256 ?? c.loser_sha256),
  };
}

const sharedOf = async () => (await cloud.syncApi.shared()).project.id;

async function openConflicts(project: string) {
  const {dir, cloudId} = linkedDir(project);
  const own = (await cloud.syncApi.conflicts(cloudId)).conflicts.map((c) => normalise(c, 'project'));
  if (!cloud.syncGroups(dir).has('styles')) return own;
  const shared = await sharedOf().then((id) => cloud.syncApi.conflicts(id)).catch(() => ({conflicts: []}));
  return [...own, ...shared.conflicts.map((c) => normalise(c, 'shared'))];
}

export const conflicts = async (project: string): Promise<SyncConflict[]> => (await openConflicts(project)).map(({loserSha256: _sha, ...c}) => c);

async function conflictCtx(project: string, id: string, channelIn: unknown) {
  const channel: Channel = channelIn === 'shared' ? 'shared' : 'project';
  const c = (await openConflicts(project)).find((x) => x.id === id && x.channel === channel);
  if (!c) throw httpError(404, 'ese conflicto ya no está abierto');
  const {dir, cloudId} = linkedDir(project);
  const ctx: Context =
    channel === 'project'
      ? {dir, channel, cloudId, scope: {kind: 'full'}, active: new Set(GROUPS)}
      : {dir: ROOT, channel, cloudId: await sharedOf(), scope: {kind: 'full'}, active: new Set(GROUPS), builtin: sharedSeeds()};
  return {c, ctx, dir};
}

export async function conflictContent(project: string, id: string, channelIn: unknown) {
  const {c, ctx} = await conflictCtx(project, id, channelIn);
  if (c.loserDeleted) return {path: c.path, deleted: true}; // that version was a deletion: there's no content to ask for
  return {...(await cloud.syncApi.conflictContent(ctx.cloudId, id)), path: c.path, deleted: false};
}

// It becomes a normal local change, dated now, and goes up the usual way.
export async function restore(project: string, id: string, channelIn: unknown) {
  const {c, ctx} = await conflictCtx(project, id, channelIn);
  const abs = target(ctx, c.path);
  const group = classify(c.path, ctx.channel, ctx.builtin)?.group;
  if (!abs || !group) throw httpError(400, 'esa ruta no se puede restaurar');
  if (!cloud.syncGroups(projectDir(project)).has(group)) throw httpError(409, 'ese grupo está apagado: actívalo para restaurar');
  if (c.loserDeleted) await fsp.rm(abs, {force: true});
  else {
    const got = await cloud.syncApi.conflictContent(ctx.cloudId, id);
    const now = Date.now();
    if (typeof got.content === 'string') {
      const body = docOnDisk(c.path, abs, got.content);
      await land(abs, now, (tmp) => fsp.writeFile(tmp, body));
    } else if (got.url) {
      await land(abs, now, async (tmp) => {
        const sha = await download(got.url!, tmp);
        if (c.loserSha256 && sha !== c.loserSha256) throw httpError(502, 'la copia guardada no coincide con su verificación');
      });
    } else throw httpError(502, 'tu cuenta no devolvió esa versión');
  }
  await cloud.syncApi.dismiss(ctx.cloudId, id);
  await fsp.rm(path.join(ctx.dir, '.reel-studio', 'conflicts', id), {recursive: true, force: true});
  announce(project, [c.path]);
  enqueue(project, ctx.channel === 'shared' ? 'group:styles' : `group:${group}`, {trigger: 'manual'});
  return conflicts(project);
}

export async function dismiss(project: string, id: string, channelIn: unknown) {
  const {ctx} = await conflictCtx(project, id, channelIn);
  await cloud.syncApi.dismiss(ctx.cloudId, id);
  await fsp.rm(path.join(ctx.dir, '.reel-studio', 'conflicts', id), {recursive: true, force: true});
  const {cloudId} = linkedDir(project);
  await refreshRemote(projectDir(project), cloudId, false).catch(() => {});
  forgetStatus(project);
  return conflicts(project);
}

/* ───── Bringing a project over ───── */

const clones = new Map<string, SyncClone>();

function folderFor(cloudId: string, slug: string) {
  const projects = path.join(ROOT, 'projects');
  fs.mkdirSync(projects, {recursive: true});
  for (const n of fs.readdirSync(projects)) {
    const dir = path.join(projects, n);
    if (!fs.existsSync(path.join(dir, 'project.json')) && cloud.linkOf(dir)?.cloudId === cloudId) return n;
  }
  const base = isProjectId(slug) ? slug : 'proyecto';
  let id = base;
  for (let i = 2; fs.existsSync(path.join(projects, id)); i++) id = `${base.slice(0, 36)}-${i}`;
  return id;
}

export const partial = (cloudId: string) => clones.get(cloudId) ?? null;

export async function clone(cloudIdIn: unknown) {
  if (!cloud.validCloudId(cloudIdIn)) throw httpError(400, 'ese proyecto de tu cuenta no es válido');
  const cloudId = cloudIdIn;
  if (!ROOT) throw httpError(409, 'aún no hay carpeta de trabajo');
  if (!cloud.signedIn()) throw httpError(401, 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta');
  const going = clones.get(cloudId);
  if (going?.running) return going;
  if (listProjects().some((p) => cloud.linkOf(projectDir(p.id))?.cloudId === cloudId)) throw httpError(409, 'ese proyecto ya está en este equipo');
  const remote = await cloud.remoteProject(cloudId);
  const folder = folderFor(cloudId, remote.slug);
  const dir = path.join(ROOT, 'projects', folder);
  await cloud.beginClone(dir, cloudId);
  const entry: SyncClone = {cloudId, folder, running: true, done: 0, total: 0, error: null};
  clones.set(cloudId, entry);
  const root = ROOT;
  void bringOver(dir, root, cloudId, folder, remote.name, remote.localCreated ?? Date.now(), entry)
    .catch((e) => {
      entry.error = (e as Error).message;
      emit(folder, 'error');
    })
    .finally(() => {
      entry.running = false;
    });
  return entry;
}

async function bringOver(dir: string, root: string, cloudId: string, folder: string, name: string, created: number, entry: SyncClone) {
  const active = new Set(GROUPS);
  const st = loadState(dir, 'project', cloudId);
  saveState(dir, 'project', {...st, firstFullAt: st.firstFullAt ?? Date.now()});
  const onProgress = (p: {done: number; total: number}) => {
    entry.done = p.done;
    entry.total = p.total;
    emit(folder, 'cloning', p.done, p.total);
  };
  await runCycle({dir, channel: 'project', cloudId, scope: {kind: 'full'}, active, onProgress});
  const {project: shared} = await cloud.syncApi.shared();
  await runCycle({dir: root, channel: 'shared', cloudId: shared.id, scope: {kind: 'full'}, active, builtin: sharedSeeds(), seedSha: lessonsSha(), onProgress});
  // Only now does the app see it: complete, or not at all.
  finishProject(folder, name, created);
  // After project.json: without it the link won't save which computer runs the automations, and this one would run them too.
  await refreshRemote(dir, cloudId, false).catch(() => {});
  clones.delete(cloudId);
  send({type: 'projects'});
  cloud.announceProjects();
  emit(folder, 'done');
  refreshWatchers();
}
