// The sync engine: one cycle of the protocol in the cloud's docs/studio-cloud.md §7 for one channel (a project, or what
// the workspace shares). Upload first, then read what's new, so the winner of anything we lost comes back in that same
// read. The cloud is the only arbiter; this side never decides a conflict.
//
// Every cycle works on the folder and scope it was given and never looks at which project is open: he can switch
// projects in the middle of one.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {DOC_LIMIT, FILE_LIMIT, classify, inScope, pruned, startsOf, validPath, videoOf, type Channel, type Scope, type Storage} from './sync-rules.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {syncApi, type SyncChange, type SyncEntry, type SyncResult} from './cloud.ts';
import type {SyncGroupId, SyncJobStats, SyncRemoteState} from '../shared/types.ts';

export type FileState = {sha256: string | null; size: number; mtime: number; rev: number; deleted?: boolean};
// baseRev only moves with a full cycle. behind: groups that were off while it moved, so what happened in them since
// is still unread. remote: the account's last answer, to show without a network.
export type SyncState = {cloudId: string; baseRev: number; files: Record<string, FileState>; firstFullAt: number | null; groupsAt: Partial<Record<SyncGroupId, number>>; behind: SyncGroupId[]; remote: SyncRemoteState | null};

const fresh = (cloudId: string): SyncState => ({cloudId, baseRev: 0, files: {}, firstFullAt: null, groupsAt: {}, behind: [], remote: null});
export const stateFile = (dir: string, channel: Channel) => path.join(dir, '.reel-studio', channel === 'project' ? 'sync-state.json' : 'sync-state-shared.json');
// A state from another project in the account (it was registered again under a new id) says nothing about this one.
export function loadState(dir: string, channel: Channel, cloudId: string): SyncState {
  const s = readJson<Partial<SyncState>>(stateFile(dir, channel));
  return s?.cloudId === cloudId && s.files ? {...fresh(cloudId), ...s, files: s.files} : fresh(cloudId);
}
// The state as it is on disk, without asking for a particular project in the account: only to count.
export const peekState = (dir: string, channel: Channel, cloudId = ''): SyncState => ({...fresh(cloudId), ...readJson<Partial<SyncState>>(stateFile(dir, channel))});
export const saveState = (dir: string, channel: Channel, s: SyncState) => writeJson(stateFile(dir, channel), s, 0);

export type Progress = {phase: 'review' | 'upload' | 'download'; done: number; total: number};
export type Context = {
  dir: string;
  channel: Channel;
  cloudId: string;
  scope: Scope;
  active: ReadonlySet<SyncGroupId>; // a group that's off isn't looked at, uploaded, applied or deleted
  builtin?: ReadonlySet<string>; // shared channel: what comes with the app
  seedSha?: string | null; // shared channel: LESSONS.md as the app ships it
  confirmDeletes?: boolean;
  signal?: AbortSignal;
  busyVideo?: (slug: string) => boolean;
  onProgress?: (p: Progress) => void;
};
export type CycleResult = SyncJobStats & {paths: string[]; warnings: string[]; needsConfirm: number | null};

const MAX_BATCH = 200;
const MAX_BODY = 2_500_000; // the API's limit is 3 MB; JSON escaping and the rest of the body fit in the difference
const PUT_AT_ONCE = 8;
const GET_AT_ONCE = 4;
const MASS_DELETES = 50;
const MASS_SHARE = 0.2;

// held: it differs from the account and didn't go up (too big, unreadable, still changing), so nothing may overwrite it.
// seed: the app's own unedited copy, which anything from the account may replace.
type Local = {path: string; abs: string; size: number; mtime: number; sha256: string; storage: Storage; content?: string; held?: boolean; seed?: boolean};

// One cycle per folder: a job and a download of the same project must not interleave.
const locks = new Map<string, Promise<unknown>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve();
  const mine = before.catch(() => {}).then(fn);
  locks.set(key, mine);
  try {
    return await mine;
  } finally {
    if (locks.get(key) === mine) locks.delete(key);
  }
}

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const hashFile = (abs: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(abs).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
const stamp = (st: fs.Stats) => Math.round(st.mtimeMs);
const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

// automations.json without its runs: those are each computer's own, and a run mustn't look like a change.
export function automationsProjection(text: string) {
  const j = JSON.parse(text) as {automations?: unknown};
  return JSON.stringify({automations: Array.isArray(j?.automations) ? j.automations : []}, null, 2) + '\n';
}

function docContent(rel: string, buf: Buffer) {
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) return null; // the cloud stores text: bytes it can't hold would change the hash
  return rel === 'automations.json' ? automationsProjection(text) : text;
}

async function walk(root: string, rel: string, channel: Channel, visit: (rel: string, abs: string, st: fs.Stats) => Promise<void>) {
  const abs = path.join(root, rel);
  let st: fs.Stats;
  try {
    st = await fsp.lstat(abs);
  } catch (e) {
    if (isEnoent(e)) return; // not there is an answer; anything else (a disk gone away) stops the cycle below
    throw e;
  }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) return visit(rel.normalize('NFC'), abs, st);
  if (!st.isDirectory() || pruned(rel, channel)) return;
  let names: string[];
  try {
    names = await fsp.readdir(abs);
  } catch (e) {
    if (isEnoent(e)) return;
    throw e;
  }
  for (const n of names) await walk(root, `${rel}/${n}`, channel, visit);
}

const allowed = (ctx: Context, rel: string) => {
  const c = classify(rel, ctx.channel, ctx.builtin);
  return c && ctx.active.has(c.group) && inScope(rel, c.group, ctx.scope) ? c : null;
};
const busy = (ctx: Context, rel: string) => {
  const slug = videoOf(rel);
  return !!slug && !!ctx.busyVideo?.(slug);
};

// busy: videos an agent is working on, left out. busyChanged: files in them that differ, which stay as pending.
export type Review = {seen: Map<string, Local>; changed: Local[]; deletes: string[]; busy: number; busyChanged: number; warnings: string[]};

// What's different from the last time this computer and the account agreed. statOnly: without reading anything, to
// count before asking (a changed date counts as a change).
export async function review(ctx: Context, state: SyncState, statOnly = false): Promise<Review> {
  const out: Review = {seen: new Map(), changed: [], deletes: [], busy: 0, busyChanged: 0, warnings: []};
  const busySlugs = new Set<string>();
  const busyFound = new Set<string>();
  const visit = async (rel: string, abs: string, st: fs.Stats) => {
    const c = allowed(ctx, rel);
    if (!c) return;
    const old = state.files[rel];
    if (busy(ctx, rel)) {
      busySlugs.add(videoOf(rel)!);
      busyFound.add(rel);
      if (!old || old.deleted || old.size !== st.size || old.mtime !== stamp(st)) out.busyChanged++;
      return;
    }
    const local: Local = {path: rel, abs, size: st.size, mtime: stamp(st), sha256: '', storage: c.storage};
    out.seen.set(rel, local);
    if (old && !old.deleted && old.size === st.size && old.mtime === local.mtime) return void (local.sha256 = old.sha256!);
    if (statOnly) return void out.changed.push(local);
    try {
      if (c.storage === 'doc') {
        const buf = await fsp.readFile(abs);
        const content = buf.length <= DOC_LIMIT ? docContent(rel, buf) : null;
        if (content === null) {
          out.warnings.push(buf.length > DOC_LIMIT ? `${rel} pasa de 512 KB y no se sincronizó` : `${rel} no se puede leer como texto y no se sincronizó`);
          return void (local.held = true);
        }
        local.content = content;
        local.sha256 = sha(content);
      } else {
        if (st.size > FILE_LIMIT) {
          out.warnings.push(`${rel} pasa de 100 MB y no se sincronizó`);
          return void (local.held = true);
        }
        local.sha256 = await hashFile(abs);
      }
    } catch (e) {
      if (isEnoent(e)) return void out.seen.delete(rel);
      if (e instanceof SyntaxError) {
        out.warnings.push(`${rel} no es un JSON válido y no se sincronizó`);
        return void (local.held = true);
      }
      throw e;
    }
    if (old && !old.deleted && old.sha256 === local.sha256) {
      // Touched, not changed: the same content under a new date.
      state.files[rel] = {...old, size: local.size, mtime: local.mtime};
      return;
    }
    // LESSONS.md as the app installs it says nothing: uploading it would overwrite the real one in the account.
    if (ctx.channel === 'shared' && rel === 'LESSONS.md' && local.sha256 === ctx.seedSha) return void (local.seed = true);
    out.changed.push(local);
  };
  for (const start of startsOf(ctx.scope, ctx.channel)) await walk(ctx.dir, start, ctx.channel, visit);
  for (const [rel, st] of Object.entries(state.files)) {
    if (st.deleted || out.seen.has(rel) || !allowed(ctx, rel)) continue;
    if (busy(ctx, rel)) {
      busySlugs.add(videoOf(rel)!);
      if (!busyFound.has(rel)) out.busyChanged++;
    } else out.deletes.push(rel);
  }
  out.busy = busySlugs.size;
  return out;
}

async function pool<T>(items: T[], at: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(at, items.length)}, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const offline = (e: unknown) => Object.assign(httpError(502, 'se cortó la conexión con el almacenamiento'), {offline: true, cause: e});

function changedSince(l: Local) {
  try {
    const st = fs.lstatSync(l.abs);
    return !st.isFile() || st.size !== l.size || stamp(st) !== l.mtime;
  } catch {
    return true;
  }
}

async function putBlobs(ctx: Context, blobs: Local[], tick: () => void, warn: (m: string) => void, storageTrouble: () => void) {
  const failed = new Set<string>();
  for (let i = 0; i < blobs.length; i += MAX_BATCH) {
    ctx.signal?.throwIfAborted();
    const batch = blobs.slice(i, i + MAX_BATCH);
    const r = await syncApi.prepare(ctx.cloudId, batch.map((b) => ({path: b.path, sha256: b.sha256, size: b.size})));
    for (const x of r.rejected ?? []) {
      warn(`${x.path}: ${x.error}`);
      failed.add(x.path);
    }
    await pool(r.uploads ?? [], PUT_AT_ONCE, async (u) => {
      ctx.signal?.throwIfAborted();
      const owners = batch.filter((b) => b.sha256 === u.sha256);
      const file = owners.find((b) => !changedSince(b));
      const fail = () => owners.forEach((b) => failed.add(b.path));
      if (!file) return fail(); // he's still editing it: the next cycle takes it
      let res: Response;
      try {
        // A Blob and not a stream: S3 needs the length up front, and this doesn't load the file in memory.
        res = await fetch(u.url, {method: u.method, headers: u.headers, body: await fs.openAsBlob(file.abs), signal: ctx.signal});
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        if ((e as Error).name === 'NotReadableError') return fail();
        throw offline(e);
      }
      if (!res.ok) {
        // A 5xx is the storage having a bad moment, not this file's fault: the job comes back for it.
        if (res.status >= 500) storageTrouble();
        else warn(`${file.path}: el almacenamiento respondió ${res.status}`);
        return fail();
      }
      owners.forEach(tick);
    });
  }
  return failed;
}

type Lost = Map<string, {conflictId: string | null; rev: number}>;

async function commitAll(ctx: Context, state: SyncState, changes: {wire: SyncChange; local: Local | null}[], stats: SyncJobStats, lost: Lost, tick: () => void, warn: (m: string) => void) {
  const size = (c: {wire: SyncChange}) => Buffer.byteLength(JSON.stringify(c.wire));
  let batch: typeof changes = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    ctx.signal?.throwIfAborted();
    const r = await syncApi.commit(ctx.cloudId, batch.map((c) => c.wire));
    const byPath = new Map(batch.map((c) => [c.wire.path, c]));
    for (const res of r.results as SyncResult[]) {
      const c = byPath.get(res.path);
      if (!c) continue;
      tick();
      if (res.status === 'lost') lost.set(res.path, {conflictId: res.conflictId ?? null, rev: res.rev ?? 0});
      else if (res.status === 'applied' || res.status === 'won' || res.status === 'same') {
        state.files[res.path] = c.wire.deleted ? {sha256: null, size: 0, mtime: c.wire.mtime, rev: res.rev ?? 0, deleted: true} : {sha256: c.wire.sha256!, size: c.local!.size, mtime: c.local!.mtime, rev: res.rev ?? 0};
        if (res.status !== 'same') c.wire.deleted ? stats.deleted++ : stats.uploaded++;
        if (res.status === 'won') stats.conflicts++;
      } else {
        // Its file didn't arrive, or the cloud won't take that path: it stays here as a local change for another try.
        warn(`${res.path}: ${res.error ?? 'tu cuenta no lo aceptó'}`);
        stats.skipped++;
        if (c.local) c.local.held = true;
      }
    }
    saveState(ctx.dir, ctx.channel, state);
    batch = [];
    bytes = 0;
  };
  for (const c of changes) {
    const n = size(c);
    if (batch.length && (batch.length >= MAX_BATCH || bytes + n > MAX_BODY)) await flush();
    batch.push(c);
    bytes += n;
  }
  await flush();
}

/* ───── Landing what the cloud sends ───── */

// Where a path from the cloud may be written, or null: on the list and, resolved, inside this channel's folder with no
// symbolic link on the way. The list alone isn't enough: a link in a video's folder would take the write outside.
export function target(ctx: Context, rel: string) {
  if (!validPath(rel) || !allowed(ctx, rel)) return null;
  const root = path.resolve(ctx.dir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  let at = root;
  for (const part of rel.split('/')) {
    at = path.join(at, part);
    try {
      if (fs.lstatSync(at).isSymbolicLink()) return null;
    } catch (e) {
      if (isEnoent(e)) break;
      return null;
    }
  }
  return abs;
}

const tmpOf = (abs: string) => path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.synctmp`);

// utimes before the rename: the file never shows up with a date of its own, which the next cycle would take for a change.
export async function land(abs: string, mtime: number, write: (tmp: string) => Promise<void>) {
  await fsp.mkdir(path.dirname(abs), {recursive: true});
  const tmp = tmpOf(abs);
  try {
    await write(tmp);
    if (abs.endsWith('.sh')) await fsp.chmod(tmp, 0o755); // the sync carries no permissions, and a video's render.sh has to run
    await fsp.utimes(tmp, mtime / 1000, mtime / 1000);
    await fsp.rename(tmp, abs);
  } finally {
    await fsp.rm(tmp, {force: true});
  }
}

// A doc as it goes on disk: automations.json keeps this computer's runs.
export function docOnDisk(rel: string, abs: string, content: string) {
  if (rel !== 'automations.json') return content;
  const j = JSON.parse(content) as {automations?: unknown};
  const runs = readJson<{runs?: unknown}>(abs)?.runs;
  return JSON.stringify({automations: j?.automations ?? [], runs: Array.isArray(runs) ? runs : []}, null, 2) + '\n';
}

export async function download(url: string, tmp: string, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, {signal});
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw offline(e);
  }
  if (!res.ok || !res.body) throw httpError(502, `el almacenamiento respondió ${res.status}`);
  const h = createHash('sha256');
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    new Transform({
      transform(chunk, _enc, done) {
        h.update(chunk);
        done(null, chunk);
      },
    }),
    fs.createWriteStream(tmp),
  );
  return h.digest('hex');
}

const CONFLICT_ID = /^[\w-]{1,64}$/;
async function keepLoser(ctx: Context, rel: string, conflictId: string | null, local: Local | undefined) {
  if (!local || !conflictId || !CONFLICT_ID.test(conflictId)) return;
  const to = path.join(ctx.dir, '.reel-studio', 'conflicts', conflictId, rel);
  await fsp.mkdir(path.dirname(to), {recursive: true});
  await fsp.copyFile(local.abs, to);
}

// Empty folders a deleted file leaves, up to its group's own folder.
async function pruneEmpty(ctx: Context, abs: string) {
  const root = path.resolve(ctx.dir);
  for (let d = path.dirname(abs); d !== root && path.dirname(d) !== root; d = path.dirname(d)) {
    try {
      await fsp.rmdir(d);
    } catch {
      return;
    }
  }
}

/* ───── One cycle ───── */

export function runCycle(ctx: Context): Promise<CycleResult> {
  return withLock(ctx.dir, () => cycle(ctx));
}

async function cycle(ctx: Context): Promise<CycleResult> {
  const state = loadState(ctx.dir, ctx.channel, ctx.cloudId);
  const stats: SyncJobStats = {uploaded: 0, downloaded: 0, deleted: 0, skipped: 0, conflicts: 0};
  const paths: string[] = [];
  ctx.onProgress?.({phase: 'review', done: 0, total: 0});
  const r = await review(ctx, state);
  const warnings = r.warnings;
  const warn = (m: string) => void warnings.push(m);
  stats.skipped += r.busy;
  const done = (needsConfirm: number | null = null): CycleResult => ({...stats, paths, warnings, needsConfirm});

  // 2. A disk that isn't mounted, or a folder half-copied, looks exactly like having deleted everything.
  const live = Object.entries(state.files).filter(([p, s]) => !s.deleted && allowed(ctx, p)).length;
  if (r.deletes.length > MASS_DELETES && r.deletes.length > live * MASS_SHARE && !ctx.confirmDeletes) {
    saveState(ctx.dir, ctx.channel, state);
    return done(r.deletes.length);
  }

  // 3. Upload.
  const blobs = r.changed.filter((l) => l.storage === 'blob');
  const upSteps = blobs.length + r.changed.length + r.deletes.length;
  let finished = 0;
  const tick = () => ctx.onProgress?.({phase: 'upload', done: ++finished, total: upSteps});
  let storageDown = false;
  const failed = await putBlobs(ctx, blobs, tick, warn, () => void (storageDown = true));
  const changes: {wire: SyncChange; local: Local | null}[] = [];
  for (const l of r.changed) {
    if (failed.has(l.path) || changedSince(l) || busy(ctx, l.path)) {
      stats.skipped++;
      l.held = true;
      continue;
    }
    changes.push({wire: {path: l.path, baseRev: state.files[l.path]?.rev ?? 0, sha256: l.sha256, size: l.content === undefined ? l.size : Buffer.byteLength(l.content), mtime: l.mtime, ...(l.content === undefined ? {} : {content: l.content})}, local: l});
  }
  for (const p of r.deletes) if (!busy(ctx, p)) changes.push({wire: {path: p, baseRev: state.files[p].rev, deleted: true, mtime: Date.now()}, local: null});
  const lost: Lost = new Map();
  await commitAll(ctx, state, changes, stats, lost, tick, warn);
  saveState(ctx.dir, ctx.channel, state);

  // 4. Read what's new, now that our own changes are in.
  const catching = ctx.scope.kind === 'full' ? state.behind.some((g) => ctx.active.has(g)) : ctx.scope.kind === 'group' ? state.behind.includes(ctx.scope.group) : state.behind.includes('videos');
  let since = catching ? 0 : state.baseRev;
  for (const l of lost.values()) since = Math.min(since, l.rev - 1);
  const entries: SyncEntry[] = [];
  let head = 0;
  for (let cursor: string | null = null, first = true; first || cursor; first = false) {
    ctx.signal?.throwIfAborted();
    const page: Awaited<ReturnType<typeof syncApi.changes>> = await syncApi.changes(ctx.cloudId, Math.max(0, since), cursor);
    if (first) head = page.rev; // anything newer than the first page comes round again in the next cycle
    entries.push(...page.entries);
    cursor = page.next ?? null;
  }

  // 5 and 6. Apply, keeping a copy of whatever lost.
  let held = Infinity;
  const hold = (rev: number) => void (held = Math.min(held, rev - 1));
  const toFetch: SyncEntry[] = [];
  for (const e of entries) {
    if (!allowed(ctx, e.path)) {
      if (!validPath(e.path)) console.warn(`[sync] ruta ignorada: ${JSON.stringify(e.path)}`);
      continue;
    }
    const st = state.files[e.path];
    if (st && st.rev >= e.rev) continue;
    if (!e.deleted && !/^[0-9a-f]{64}$/.test(e.sha256 ?? '')) {
      console.warn(`[sync] entrada inválida: ${e.path}`);
      continue;
    }
    const local = r.seen.get(e.path);
    const isLost = lost.has(e.path);
    if (busy(ctx, e.path)) {
      hold(e.rev);
      stats.skipped++;
      continue;
    }
    // Ours differs from what we last agreed on and didn't make it into a commit (too big, failed, still changing): it isn't ours to overwrite yet.
    const pendingHere = !!local && !local.seed && (local.held || local.sha256 !== st?.sha256) && !isLost;
    if (e.deleted) {
      if (!local) {
        state.files[e.path] = {sha256: null, size: 0, mtime: e.mtime, rev: e.rev, deleted: true};
        continue;
      }
      if (pendingHere) {
        hold(e.rev);
        continue;
      }
      if (changedSince(local)) {
        hold(e.rev);
        stats.skipped++;
        continue;
      }
      const abs = target(ctx, e.path);
      if (!abs) continue;
      if (isLost) await keepLoser(ctx, e.path, lost.get(e.path)!.conflictId, local);
      await fsp.rm(abs, {force: true});
      await pruneEmpty(ctx, abs);
      state.files[e.path] = {sha256: null, size: 0, mtime: e.mtime, rev: e.rev, deleted: true};
      stats.deleted++;
      paths.push(e.path);
      continue;
    }
    if (local && !local.held && local.sha256 === e.sha256) {
      state.files[e.path] = {sha256: e.sha256, size: local.size, mtime: local.mtime, rev: e.rev};
      continue;
    }
    if (pendingHere) {
      hold(e.rev);
      continue;
    }
    toFetch.push(e);
  }
  saveState(ctx.dir, ctx.channel, state);

  const total = toFetch.length;
  finished = 0;
  const byPath = new Map(toFetch.map((e) => [e.path, e]));
  const report = () => ctx.onProgress?.({phase: 'download', done: ++finished, total});
  for (let i = 0; i < toFetch.length; i += MAX_BATCH) {
    let ask = toFetch.slice(i, i + MAX_BATCH).map((e) => e.path);
    while (ask.length) {
      ctx.signal?.throwIfAborted();
      const got = await syncApi.fetch(ctx.cloudId, ask);
      await pool(got.items, GET_AT_ONCE, async (item) => {
        const e = byPath.get(item.path);
        if (!e) return;
        const local = r.seen.get(e.path);
        const skip = () => {
          hold(e.rev);
          stats.skipped++;
          report();
        };
        const abs = target(ctx, e.path);
        if (!abs) {
          console.warn(`[sync] ruta ignorada: ${JSON.stringify(e.path)}`);
          return report();
        }
        // It may have changed since the review, or an agent may have started on this video.
        const now = (() => {
          try {
            return fs.lstatSync(abs);
          } catch {
            return null;
          }
        })();
        if (busy(ctx, e.path) || (local ? changedSince(local) : !!now)) return skip();
        let wrote = true;
        if (typeof item.content === 'string') {
          if (sha(item.content) !== e.sha256) {
            warn(`${e.path}: no coincide con su verificación y no se aplicó`);
            return skip();
          }
          if (lost.has(e.path)) await keepLoser(ctx, e.path, lost.get(e.path)!.conflictId, local);
          let body: string;
          try {
            body = docOnDisk(e.path, abs, item.content);
          } catch {
            warn(`${e.path}: llegó con un formato inválido y no se aplicó`);
            return skip();
          }
          await land(abs, e.mtime, (tmp) => fsp.writeFile(tmp, body));
        } else if (item.url) {
          if (lost.has(e.path)) await keepLoser(ctx, e.path, lost.get(e.path)!.conflictId, local);
          await land(abs, e.mtime, async (tmp) => {
            const got256 = await download(item.url!, tmp, ctx.signal);
            if (got256 !== e.sha256) {
              wrote = false;
              throw Object.assign(new Error('mismatch'), {mismatch: true});
            }
          }).catch((err) => {
            if (!(err as {mismatch?: boolean}).mismatch) throw err;
          });
        } else wrote = false;
        if (!wrote) {
          warn(`${e.path}: no coincide con su verificación y no se aplicó`);
          return skip();
        }
        const st = await fsp.lstat(abs);
        state.files[e.path] = {sha256: e.sha256, size: st.size, mtime: stamp(st), rev: e.rev};
        stats.downloaded++;
        paths.push(e.path);
        report();
      });
      saveState(ctx.dir, ctx.channel, state);
      const answered = new Set(got.items.map((x) => x.path));
      const omitted = (got.omitted ?? []).filter((p) => ask.includes(p));
      // What it neither sent nor promised for later can't be waited for in this cycle.
      for (const p of ask) if (!answered.has(p) && !omitted.includes(p)) hold(byPath.get(p)!.rev);
      if (!answered.size && omitted.length) {
        for (const p of omitted) hold(byPath.get(p)!.rev);
        break;
      }
      ask = omitted;
    }
  }

  // 7. Only a full cycle moves the base; anything held back above is read again next time.
  const now = Date.now();
  if (ctx.scope.kind === 'full') {
    // Catching up read from 0: what it had to leave for later may be older than the base, which then steps back for it.
    state.baseRev = !Number.isFinite(held) ? Math.max(state.baseRev, head) : catching ? Math.min(head, held) : Math.max(state.baseRev, Math.min(head, held));
    state.behind = ctx.channel === 'project' ? (['videos', 'ideas', 'settings', 'sources', 'reels', 'automations', 'audit'] as SyncGroupId[]).filter((g) => !ctx.active.has(g)) : [];
    for (const g of ctx.active) state.groupsAt[g] = now;
  } else {
    const g = ctx.scope.kind === 'group' ? ctx.scope.group : 'videos';
    state.groupsAt[g] = now;
    if (ctx.scope.kind === 'group' && !Number.isFinite(held)) state.behind = state.behind.filter((x) => x !== g);
  }
  saveState(ctx.dir, ctx.channel, state);
  // Everything that could happen, happened and is saved; the retry only has what the storage turned down left to do.
  if (storageDown) throw offline(new Error('el almacenamiento falló'));
  return done();
}
