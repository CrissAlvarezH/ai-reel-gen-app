// Reel Studio's account (the ai-reel-gen-cloud site), optional: without it everything local works the same. Logs
// in with an email code and keeps the session's token in this computer's config (CONFIG_DIR/cloud.json, 0600),
// never in the workspace, which may be shared. Through it: the Instagram accounts he connected in the site's panel (with his own Meta app), their reels' private
// insights for Mi cuenta (saves, shares, reach, watch time), and publishing. The studio never holds Meta or AWS
// credentials. Each project uses one of those accounts: once registered in the account (its .reel-studio/cloud.json,
// see below) the account decides which; config/instagram.json is what's used without a network, and by default it's
// the one with Mi cuenta's handle.
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONFIG, CONFIG_DIR, PROJECT_DIR, listProjects, projectDir, setProjectCloudReader} from './workspace.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {KEYS, getKey, setKey} from './settings.ts';
import type {CloudAccount, CloudKey, CloudKeyState, CloudKeys, CloudKeysMoved, CloudProjectMatch, CloudProjectState, CloudProjectView, CloudProjects, CloudReelInsights, CloudSession, CloudStatus, LocalCloudProject, SyncGroupId, SyncRemoteState} from '../shared/types.ts';

// REEL_STUDIO_CLOUD_URL wins over it, to develop against a local copy of the cloud.
const DEFAULT_URL = 'https://ai-reel-gen.socialsannin.com';
const PING_MS = 5 * 60_000;
const FILE = () => path.join(CONFIG_DIR, 'cloud.json');

// deviceId identifies this computer and outlives the session; userId goes with it.
type Saved = {token?: string; email?: string; deviceId?: string; userId?: number};
const saved = (): Saved => readJson<Saved>(FILE()) ?? {};
function save(s: Saved) {
  fs.mkdirSync(CONFIG_DIR, {recursive: true});
  fs.writeFileSync(FILE(), JSON.stringify(s, null, 1) + '\n', {mode: 0o600});
  fs.chmodSync(FILE(), 0o600);
}
export const baseUrl = () => (process.env.REEL_STUDIO_CLOUD_URL || DEFAULT_URL).replace(/\/+$/, '');
export const signedIn = () => !!saved().token;

const listeners: (() => void)[] = [];
// The session started or ended, or the cloud became reachable or stopped being so.
export const onCloudChange = (fn: () => void) => listeners.push(fn);
const changed = () => listeners.forEach((fn) => fn());

// What the last signed-in call found, so the app's indicator never has to wait for the network.
let online: boolean | null = null;
let checkedAt: number | null = null;
function reached(ok: boolean) {
  const flipped = ok !== online;
  online = ok;
  checkedAt = Date.now();
  if (flipped) changed();
}

function forget() {
  const {token: _gone, userId: _user, ...rest} = saved();
  save(rest);
  online = checkedAt = null;
  changed();
}

const SIGNED_OUT = 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta';

// routeIsNew: a 404 that isn't the API's own JSON means a server of his from before this function existed.
type Init = {method?: string; body?: unknown; auth?: boolean; timeout?: number; routeIsNew?: boolean};
async function call<T>(p: string, {method, body, auth = true, timeout = 60_000, routeIsNew = false}: Init = {}): Promise<T> {
  const token = saved().token;
  if (auth && !token) throw httpError(401, SIGNED_OUT);
  // A reply can arrive after he logged out or back in: it says nothing about the session he has now.
  const current = () => auth && saved().token === token;
  let r: Response;
  try {
    r = await fetch(baseUrl() + p, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {...(body === undefined ? {} : {'content-type': 'application/json'}), ...(auth ? {authorization: `Bearer ${token}`} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (current()) reached(false);
    throw Object.assign(httpError(502, `no hay conexión con tu cuenta de Reel Studio (${baseUrl()})`), {offline: true, cause: e});
  }
  const j = (await r.json().catch(() => null)) as {error?: string} | null;
  if (auth && r.status === 401) {
    if (current()) forget();
    throw httpError(401, 'tu sesión de Reel Studio se cerró: vuelve a iniciarla en Ajustes → Cuenta');
  }
  if (current()) reached(true);
  if (routeIsNew && r.status === 404 && !j?.error) throw Object.assign(httpError(404, 'tu servidor aún no tiene esta función'), {oldServer: true});
  if (!r.ok) throw httpError(r.status >= 500 ? 502 : r.status, j?.error ?? `tu cuenta de Reel Studio respondió ${r.status}`);
  return j as T;
}

/* ───── Session ───── */

export function deviceId() {
  const s = saved();
  if (s.deviceId) return s.deviceId;
  const id = randomUUID();
  save({...s, deviceId: id});
  return id;
}

// For the app's indicator: what's known already, without touching the network.
export function session(): CloudSession {
  const s = saved();
  return {signedIn: !!s.token, email: s.email ?? null, url: baseUrl(), online, checkedAt};
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const cleanEmail = (v: unknown) => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!EMAIL.test(e)) throw httpError(400, 'escribe un correo válido');
  return e;
};

export async function sendCode(emailIn: unknown) {
  const email = cleanEmail(emailIn);
  await call('/api/studio/auth/code', {body: {email}, auth: false});
  save({...saved(), email});
  return {ok: true};
}

export async function verify(emailIn: unknown, codeIn: unknown) {
  const email = cleanEmail(emailIn);
  const code = typeof codeIn === 'string' ? codeIn.replace(/\D/g, '') : '';
  if (code.length !== 6) throw httpError(400, 'el código son 6 dígitos');
  const r = await call<{token: string; user: {id: number}}>('/api/studio/auth/verify', {body: {email, code, label: `Reel Studio · ${os.hostname().replace(/\.local$/, '')}`, deviceId: deviceId()}, auth: false});
  save({...saved(), email, token: r.token, userId: r.user.id});
  changed();
  void reconcileProjects();
  return status();
}

export async function logout() {
  if (saved().token) await call('/api/studio/auth/logout', {body: {}}).catch(() => null);
  forget();
  return status();
}

/* ───── The project's account ───── */

type Me = {user: {id: number; email: string; name: string | null}; metaApp: boolean; accounts: CloudAccount[]; panelUrl: string};
type Link = {accountId: number; username: string};

// Sessions from before userId was kept get it here.
async function fetchMe(timeout?: number) {
  const token = saved().token;
  const me = await call<Me>('/api/studio/me', {timeout});
  const s = saved();
  if (s.token === token && s.userId !== me.user.id) save({...s, userId: me.user.id});
  return me;
}

// Keeps session().online current for as long as the studio runs. Signed out, it never reaches the network. The
// first one also registers projects, for sessions that started before projects lived in the account; after that
// only those whose registration is still pending.
export function startPing() {
  const ping = (first: boolean) => {
    if (!signedIn()) return;
    void fetchMe(15_000).catch(() => null);
    if (first || locals().some((p) => stateOf(readProjectLink(p.dir)) === 'pending')) void reconcileProjects();
  };
  ping(true);
  setInterval(() => ping(false), PING_MS).unref();
}

// Takes the project's folder and not the open project: these run across awaits, and he may open another meanwhile.
const instagramFile = (dir: string) => path.join(dir, 'config', 'instagram.json');
const link = (dir: string) => readJson<Link>(instagramFile(dir));
function writeLink(dir: string, l: Link | null) {
  if (!l) return fs.rmSync(instagramFile(dir), {force: true});
  if (!stillThere(dir)) return;
  fs.mkdirSync(path.dirname(instagramFile(dir)), {recursive: true});
  fs.writeFileSync(instagramFile(dir), JSON.stringify(l, null, 1) + '\n');
}

// The account this project uses: the one picked, else (and then saved) the one with Mi cuenta's handle.
function resolve(dir: string, accounts: CloudAccount[], handle: string | null) {
  const l = link(dir);
  const picked = l && accounts.find((a) => a.id === l.accountId);
  if (picked) return picked;
  const same = handle ? accounts.find((a) => a.username.toLowerCase() === handle.toLowerCase()) : undefined;
  if (same) writeLink(dir, {accountId: same.id, username: same.username});
  return same ?? null;
}

const patchProject = (cloudId: string, body: Record<string, unknown>) => call<{project: CloudProjectView}>(`/api/studio/projects/${cloudId}`, {method: 'PATCH', body, timeout: 20_000, routeIsNew: true});

// With a registered project and a network the account's choice wins, and instagram.json stays as the local cache
// that linkedAccount() and older versions of the app read. Otherwise, what the app always did with that cache.
async function projectAccount(dir: string, accounts: CloudAccount[], handle: string | null) {
  const local = {disconnected: null, projectGone: false};
  const l = activeLink(dir);
  if (!l) return {account: resolve(dir, accounts, handle), ...local};
  let p: CloudProjectView;
  try {
    p = (await call<{project: CloudProjectView}>(`/api/studio/projects/${l.cloudId}`, {timeout: 15_000, routeIsNew: true})).project;
  } catch (e) {
    const {status: code, oldServer} = e as {status?: number; oldServer?: boolean};
    if (code === 401) throw e;
    return {account: resolve(dir, accounts, handle), disconnected: null, projectGone: code === 410 || (code === 404 && !oldServer)};
  }
  if (p.instagramSetAt) {
    applyAccount(dir, p);
    const id = p.instagram?.accountId;
    return {account: accounts.find((a) => a.id === id) ?? null, disconnected: p.instagram && !p.instagram.connected ? p.instagram.username : null, projectGone: false};
  }
  const account = resolve(dir, accounts, handle);
  if (account) await patchProject(l.cloudId!, {instagramAccountId: account.id}).catch(() => null);
  return {account, ...local};
}

export async function status(handle: string | null = null): Promise<CloudStatus> {
  const s = saved();
  const dir = PROJECT_DIR;
  const base = {url: baseUrl(), email: s.email ?? null, signedIn: !!s.token, user: null, metaApp: false, accounts: [], panelUrl: `${baseUrl()}/panel`, officialUrl: DEFAULT_URL, account: null, disconnected: null, projectGone: false, error: null};
  if (!s.token) return base;
  try {
    const me = await fetchMe(15_000);
    const found = dir ? await projectAccount(dir, me.accounts, handle) : {account: null, disconnected: null, projectGone: false};
    return {...base, user: me.user, metaApp: me.metaApp, accounts: me.accounts, panelUrl: me.panelUrl, ...found};
  } catch (e) {
    return {...base, signedIn: signedIn(), error: (e as Error).message};
  }
}

// The account's copy goes first: if it can't be saved he's told, and this computer doesn't drift from the others.
// A project the account no longer has is just a local one again.
async function saveChoice(dir: string, accountId: number | null) {
  const l = activeLink(dir);
  if (!l) return;
  await patchProject(l.cloudId!, {instagramAccountId: accountId}).catch((e) => {
    if ((e as {status?: number}).status !== 410) throw e;
  });
}

export async function setAccount(idIn: unknown, handle: string | null) {
  const dir = PROJECT_DIR;
  if (idIn === null) {
    await saveChoice(dir, null);
    writeLink(dir, null);
    return status(handle);
  }
  const me = await fetchMe();
  const a = me.accounts.find((x) => x.id === Number(idIn));
  if (!a) throw httpError(404, 'esa cuenta no está conectada en tu panel de Reel Studio');
  await saveChoice(dir, a.id);
  writeLink(dir, {accountId: a.id, username: a.username});
  return status(handle);
}

// For Mi cuenta's download, read before it awaits anything (an automation may run it for another project): the
// account to ask, or null when he's not signed in or the project has none.
export const linkedAccount = () => (signedIn() ? readJson<Link>(path.join(CONFIG, 'instagram.json')) : null);

// Its newest reels' insights (the cloud asks Meta; null where Meta has nothing yet).
export const reelInsights = (accountId: number, limit: number) =>
  call<{username: string; fetchedAt: string; reels: CloudReelInsights[]}>(`/api/studio/accounts/${accountId}/reels?limit=${Math.max(1, Math.min(50, limit))}`, {timeout: 120_000});

/* ───── The projects in the account ───── */

// projects/<id>/.reel-studio/cloud.json. Not in project.json because renaming rewrites that one, also in versions
// already installed. linkedAt stays null until the account confirmed it: the id is written first, so a response lost
// on the way retries with the same id instead of registering the project twice.
// groups: the Ajustes switches that are off stay false; a group that isn't here is on. primaryDeviceId: the computer
// that runs its automations and audits, kept here so that holds without a network.
type ProjectLink = {cloudId: string | null; userId: number | null; server: string | null; linkedAt: number | null; localOnly: boolean; groups?: Partial<Record<SyncGroupId, boolean>>; primaryDeviceId?: string | null};
const projectLinkFile = (dir: string) => path.join(dir, '.reel-studio', 'cloud.json');
const readProjectLink = (dir: string) => readJson<ProjectLink>(projectLinkFile(dir));
// A folder deleted while a call was on its way stays deleted.
const stillThere = (dir: string) => fs.existsSync(path.join(dir, 'project.json'));
function writeProjectLink(dir: string, l: ProjectLink) {
  if (!stillThere(dir)) return;
  fs.mkdirSync(path.dirname(projectLinkFile(dir)), {recursive: true});
  // What's about the link itself is rewritten here; the switches and the primary computer belong to that same project in the account.
  const old = readProjectLink(dir);
  const keep = old && old.cloudId === l.cloudId ? {groups: old.groups, primaryDeviceId: old.primaryDeviceId} : {};
  writeJson(projectLinkFile(dir), {...keep, ...l}, 1);
}

// Only this server and this user: a project linked by someone else's session is left alone.
function sameAccount(l: ProjectLink) {
  const s = saved();
  return !!s.token && l.server === baseUrl() && l.userId === s.userId;
}
function activeLink(dir: string) {
  const l = readProjectLink(dir);
  return l?.cloudId && l.linkedAt && !l.localOnly && sameAccount(l) ? l : null;
}
function stateOf(l: ProjectLink | null): Exclude<CloudProjectState, 'deleted'> {
  if (l?.localOnly) return 'local-only';
  if (!l?.cloudId) return 'none';
  if (!sameAccount(l)) return 'other-account';
  return l.linkedAt ? 'linked' : 'pending';
}

setProjectCloudReader((dir) => {
  const l = readProjectLink(dir);
  return l?.cloudId ? {id: l.cloudId, active: !!activeLink(dir)} : null;
});

type Local = {id: string; dir: string; name: string; created: number; nameAt: number};
const locals = (): Local[] =>
  listProjects().map((p) => {
    const dir = projectDir(p.id);
    return {id: p.id, dir, name: p.name, created: p.created, nameAt: fs.statSync(path.join(dir, 'project.json')).mtimeMs};
  });
function localProject(id: string) {
  const p = locals().find((x) => x.id === id);
  if (!p) throw httpError(404, 'proyecto no encontrado');
  return p;
}

const cloudName = (p: Local) => (p.name.trim() || p.id).slice(0, 60);
const listRemote = async () => (await call<{projects: CloudProjectView[]}>('/api/studio/projects', {timeout: 20_000, routeIsNew: true})).projects;
const currentUserId = async () => saved().userId ?? (await fetchMe(15_000)).user.id;

// Only metadata leaves the computer. When it renames, project.json's own date says when, so a rename made offline
// or by an older version still counts in the account's last-write-wins.
function putProject(p: Local, cloudId: string) {
  const picked = link(p.dir);
  return call<{project: CloudProjectView}>(`/api/studio/projects/${cloudId}`, {
    method: 'PUT',
    body: {slug: p.id, name: cloudName(p), nameUpdatedAt: new Date(p.nameAt).toISOString(), localCreated: Math.round(p.created), ...(picked ? {instagramAccountId: picked.accountId} : {})},
    timeout: 20_000,
    routeIsNew: true,
  });
}

// The account's choice into the local cache; nothing to do while it has none.
function applyAccount(dir: string, p: CloudProjectView) {
  if (!p.instagramSetAt) return;
  const i = p.instagram;
  writeLink(dir, i?.connected && i.accountId != null ? {accountId: i.accountId, username: i.username} : null);
}

async function registerLocal(p: Local, fresh = false): Promise<void> {
  const userId = await currentUserId();
  const server = baseUrl();
  const l = readProjectLink(p.dir);
  const cloudId = !fresh && l?.cloudId && l.server === server && l.userId === userId ? l.cloudId : randomUUID();
  if (l?.cloudId !== cloudId) writeProjectLink(p.dir, {cloudId, userId, server, linkedAt: null, localOnly: false});
  let project: CloudProjectView;
  try {
    ({project} = await putProject(p, cloudId));
  } catch (e) {
    // Back from "solo en este equipo" on a project deleted meanwhile: that id is spent.
    if ((e as {status?: number}).status === 410 && l?.localOnly && !fresh) return registerLocal(p, true);
    throw e;
  }
  writeProjectLink(p.dir, {cloudId, userId, server, linkedAt: Date.now(), localOnly: false});
  applyAccount(p.dir, project);
}

const normal = (v: string) => v.trim().toLowerCase();
function instagramNames(dir: string) {
  const handle = readJson<{username?: string}>(path.join(dir, 'config', 'account.json'))?.username;
  return [link(dir)?.username, handle].filter((n): n is string => !!n).map((n) => normal(n).replace(/^@/, ''));
}
// By folder, name or Instagram account: the projects are never merged because of it, he's asked.
const sameProject = (p: Local, c: CloudProjectView) => c.slug === p.id || normal(c.name) === normal(p.name) || (!!c.instagram && instagramNames(p.dir).includes(normal(c.instagram.username)));

// The account's projects no local one is linked to: the ones an unlinked project could turn out to be.
function remoteOnly(all: Local[], remote: CloudProjectView[]) {
  const linked = new Set(all.map((p) => readProjectLink(p.dir)?.cloudId));
  return remote.filter((c) => !linked.has(c.id));
}

async function runReconcile() {
  const token = saved().token;
  if (!token) return;
  await currentUserId();
  const remote = await listRemote();
  const all = locals();
  const candidates = remoteOnly(all, remote);
  for (const p of all) {
    if (saved().token !== token) return; // logged out meanwhile
    const l = readProjectLink(p.dir);
    const state = stateOf(l);
    try {
      if (state === 'pending' || (state === 'none' && !candidates.some((c) => sameProject(p, c)))) await registerLocal(p);
      else if (state === 'linked') {
        const c = remote.find((x) => x.id === l!.cloudId);
        if (c) {
          applyAccount(p.dir, c);
          if (c.name !== cloudName(p)) await putProject(p, c.id);
        }
      }
    } catch {
      // It stays pending and the next round tries again: nothing local depends on this.
    }
  }
  changed();
}

// After logging in and when the studio starts. One at a time: both can happen together.
let reconciling: Promise<void> | null = null;
export const reconcileProjects = () =>
  (reconciling ??= runReconcile()
    .catch(() => {})
    .finally(() => {
      reconciling = null;
    }));

export async function projects(): Promise<CloudProjects> {
  const all = locals();
  const describe = (p: Local, state: CloudProjectState, cloudId: string | null): LocalCloudProject => ({id: p.id, name: p.name, created: p.created, cloudId, state});
  const plain = () => all.map((p) => describe(p, stateOf(readProjectLink(p.dir)), readProjectLink(p.dir)?.cloudId ?? null));
  if (!signedIn()) return {signedIn: false, local: plain(), remoteOnly: [], matches: [], error: null};
  let remote: CloudProjectView[];
  try {
    await currentUserId();
    remote = await listRemote();
  } catch (e) {
    return {signedIn: signedIn(), local: plain(), remoteOnly: [], matches: [], error: (e as Error).message};
  }
  const local = all.map((p) => {
    const l = readProjectLink(p.dir);
    const state = stateOf(l);
    return describe(p, state === 'linked' && !remote.some((c) => c.id === l!.cloudId) ? 'deleted' : state, l?.cloudId ?? null);
  });
  const others = remoteOnly(all, remote);
  const matches: CloudProjectMatch[] = all.filter((p) => stateOf(readProjectLink(p.dir)) === 'none').flatMap((p) => others.filter((c) => sameProject(p, c)).map((cloud) => ({local: p.id, cloud})));
  return {signedIn: true, local, remoteOnly: others, matches, error: null};
}

export async function registerProject(localId: string, fresh: unknown) {
  await registerLocal(localProject(localId), fresh === true);
  changed();
  return projects();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function linkProject(localId: string, cloudIdIn: unknown) {
  const p = localProject(localId);
  const cloudId = typeof cloudIdIn === 'string' && UUID.test(cloudIdIn) ? cloudIdIn : null;
  if (!cloudId) throw httpError(400, 'ese proyecto de tu cuenta no es válido');
  if (locals().some((x) => x.id !== p.id && readProjectLink(x.dir)?.cloudId === cloudId)) throw httpError(409, 'ese proyecto de tu cuenta ya está vinculado a otro proyecto de este equipo');
  const userId = await currentUserId();
  const {project} = await call<{project: CloudProjectView}>(`/api/studio/projects/${cloudId}`, {timeout: 20_000, routeIsNew: true});
  writeProjectLink(p.dir, {cloudId, userId, server: baseUrl(), linkedAt: Date.now(), localOnly: false});
  applyAccount(p.dir, project);
  changed();
  return projects();
}

export function setLocalOnly(localId: string, value: unknown) {
  const p = localProject(localId);
  const l = readProjectLink(p.dir);
  writeProjectLink(p.dir, {cloudId: l?.cloudId ?? null, userId: l?.userId ?? null, server: l?.server ?? null, linkedAt: l?.linkedAt ?? null, localOnly: value === true});
  changed();
  return projects();
}

// A project made with a session open. It runs on its own: if it fails the project stays pending and creating it
// went fine anyway.
export function registerNew(localId: string) {
  if (!signedIn()) return;
  void registerLocal(localProject(localId)).catch(() => {}).finally(changed);
}

// In the background too: a rename that doesn't reach the account goes with the next reconcile.
export function projectRenamed(localId: string) {
  const p = localProject(localId);
  const l = activeLink(p.dir);
  if (l) void patchProject(l.cloudId!, {name: cloudName(p), nameUpdatedAt: new Date(p.nameAt).toISOString()}).catch(() => {});
}

// Opening a project brings the account's choice for it.
export async function refreshProject(localId: string) {
  const dir = projectDir(localId);
  const l = activeLink(dir);
  if (!l) return;
  const r = await call<{project: CloudProjectView}>(`/api/studio/projects/${l.cloudId}`, {timeout: 15_000, routeIsNew: true}).catch(() => null);
  if (r) applyAccount(dir, r.project);
}

// Only when he ticked it while deleting the local one. Already gone is what he wanted.
export async function deleteFromAccount(localId: string) {
  const l = activeLink(localProject(localId).dir);
  if (!l) return;
  await call(`/api/studio/projects/${l.cloudId}`, {method: 'DELETE', timeout: 20_000, routeIsNew: true}).catch((e) => {
    const {status: code, oldServer} = e as {status?: number; oldServer?: boolean};
    if (!(code === 404 && !oldServer) && code !== 410) throw e;
  });
}

/* ───── The keys in the account ───── */

// The account keeps an encrypted copy; what runs is always the workspace's .env, and nothing moves on its own. A value
// only passes through here between that file and the cloud: never to the browser, a log, an error or any other file.

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
function isLoopbackName(url: string) {
  try {
    return LOOPBACK_NAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
// The server also listens on the network (HOST is 0.0.0.0 by default). The address alone isn't enough: a web page open
// in this computer's browser also comes from loopback, so its Host (DNS rebinding) and Origin have to be this computer too.
export function isLoopback({remoteAddress, host, origin}: {remoteAddress?: string; host?: string; origin?: string}) {
  return LOOPBACK_IPS.has(remoteAddress ?? '') && !!host && isLoopbackName(`http://${host}`) && (!origin || isLoopbackName(origin));
}

type RemoteKey = {name: string; last4: string | null; updatedAt: string; updatedBy: string | null; unreadable?: boolean; digest?: string | null};

const keyDigest = (nonce: string, value: string) => createHash('sha256').update(`${nonce}:${value}`).digest('hex');

export function keyState(local: string | null, cloud: Pick<RemoteKey, 'digest'> | null, nonce: string): CloudKeyState {
  if (!cloud) return local ? 'local' : 'none';
  if (!local) return 'cloud';
  return cloud.digest === keyDigest(nonce, local) ? 'same' : 'different';
}

// Only the keys this version of the app knows. Never fails for the network: the local side is still worth showing.
export async function keysStatus(): Promise<CloudKeys> {
  const describe = (name: string, state: CloudKeyState, cloud: RemoteKey | null): CloudKey => {
    const local = getKey(name);
    return {name, label: KEYS[name].label, state, localLast4: local ? local.slice(-4) : null, cloudLast4: cloud?.last4 ?? null, updatedAt: cloud?.updatedAt ?? null, updatedBy: cloud?.updatedBy ?? null, unreadable: !!cloud?.unreadable};
  };
  const localOnly = (error: string | null): CloudKeys => ({signedIn: signedIn(), keys: Object.keys(KEYS).map((n) => describe(n, keyState(getKey(n), null, ''), null)), error});
  if (!signedIn()) return localOnly(null);
  // New on every call, so a digest is useless for any other one.
  const nonce = randomBytes(16).toString('hex');
  let remote: RemoteKey[];
  try {
    ({keys: remote} = await call<{keys: RemoteKey[]}>(`/api/studio/keys?nonce=${nonce}`, {timeout: 20_000, routeIsNew: true}));
  } catch (e) {
    return localOnly((e as Error).message);
  }
  return {
    signedIn: true,
    keys: Object.keys(KEYS).map((n) => {
      const cloud = remote.find((k) => k.name === n) ?? null;
      return describe(n, keyState(getKey(n), cloud, nonce), cloud);
    }),
    error: null,
  };
}

function knownKey(name: string) {
  if (!Object.hasOwn(KEYS, name)) throw httpError(400, 'clave desconocida');
  return KEYS[name];
}

async function pushKey(name: string) {
  const k = knownKey(name);
  const value = getKey(name);
  if (!value) throw httpError(400, `${k.label}: no hay clave guardada en este equipo`);
  await call(`/api/studio/keys/${name}`, {method: 'PUT', body: {value}, timeout: 20_000, routeIsNew: true});
}

// setKey also checks it against the service, as when it's typed in. An empty answer must not reach it: that erases the key.
async function pullKey(name: string) {
  knownKey(name);
  const {value} = await call<{value?: unknown}>(`/api/studio/keys/${name}`, {timeout: 20_000, routeIsNew: true});
  if (typeof value !== 'string' || !value) throw httpError(502, 'tu cuenta no devolvió esa clave');
  await setKey(name, value);
}

export async function uploadKey(name: string) {
  await pushKey(name);
  return keysStatus();
}

export async function downloadKey(name: string) {
  await pullKey(name);
  return keysStatus();
}

export async function removeCloudKey(name: string) {
  knownKey(name);
  await call(`/api/studio/keys/${name}`, {method: 'DELETE', timeout: 20_000, routeIsNew: true});
  return keysStatus();
}

// "Subir las que faltan" and "Traer las que faltan". Only what's missing on the other side: a key in both, even a
// different one, is never replaced without being asked about it. One that fails doesn't stop the rest.
export async function moveMissingKeys(direction: unknown): Promise<CloudKeysMoved> {
  if (direction !== 'upload' && direction !== 'download') throw httpError(400, 'dirección no válida');
  const before = await keysStatus();
  if (!before.signedIn) throw httpError(401, SIGNED_OUT);
  if (before.error) throw httpError(502, before.error);
  const pending = before.keys.filter((k) => (direction === 'upload' ? k.state === 'local' : k.state === 'cloud' && !k.unreadable));
  const moved: string[] = [];
  const failed: CloudKeysMoved['failed'] = [];
  for (const k of pending) {
    try {
      await (direction === 'upload' ? pushKey(k.name) : pullKey(k.name));
      moved.push(k.name);
    } catch (e) {
      failed.push({name: k.name, label: k.label, error: (e as Error).message});
    }
  }
  return {...(await keysStatus()), moved, failed};
}

/* ───── Name ───── */

// Trimmed, up to 120 characters; empty clears it.
export async function setName(nameIn: unknown) {
  if (nameIn !== null && typeof nameIn !== 'string') throw httpError(400, 'escribe un nombre válido');
  const name = (nameIn ?? '').trim().slice(0, 120) || null;
  const r = await call<{user: {id: number; email: string; name: string | null}}>('/api/studio/me', {method: 'PATCH', body: {name}, timeout: 20_000, routeIsNew: true});
  changed();
  return r;
}

/* ───── What the sync engine needs ───── */

// Always from the project's folder: a job finishes in the project it started in, whichever one is open by then.
export const syncLink = (dir: string) => activeLink(dir);
export const linkOf = (dir: string) => readProjectLink(dir);

export function syncGroups(dir: string) {
  const off = readProjectLink(dir)?.groups ?? {};
  return new Set((['videos', 'ideas', 'settings', 'sources', 'reels', 'automations', 'audit', 'styles'] as const).filter((g) => off[g] !== false));
}

export function setSyncGroups(dir: string, groups: Partial<Record<SyncGroupId, boolean>>) {
  const l = readProjectLink(dir);
  if (!l) throw httpError(409, 'este proyecto aún no está en tu cuenta');
  writeProjectLink(dir, {...l, groups: {...l.groups, ...groups}});
}

function savePrimary(dir: string, primaryDeviceId: string | null) {
  const l = readProjectLink(dir);
  if (l) writeProjectLink(dir, {...l, primaryDeviceId});
}

// A linked project whose automations and audits belong to another computer. Nobody claimed it yet: they run here, as ever.
export function runsElsewhere(dir: string) {
  const l = activeLink(dir);
  return !!l?.primaryDeviceId && l.primaryDeviceId !== deviceId();
}

// After a full sync: the first computer to sync claims the project, and everyone keeps the account's answer for when there's no network.
export async function settlePrimary(dir: string, cloudId: string, primary: string | null, claim: boolean) {
  if (primary || !claim) return savePrimary(dir, primary);
  await patchProject(cloudId, {primaryDeviceId: deviceId()});
  savePrimary(dir, deviceId());
}

export async function makePrimary(dir: string) {
  const l = activeLink(dir);
  if (!l) throw httpError(409, 'este proyecto aún no está en tu cuenta');
  await patchProject(l.cloudId!, {primaryDeviceId: deviceId()});
  savePrimary(dir, deviceId());
}

export type SyncEntry = {path: string; rev: number; sha256: string | null; size: number; mtime: number; deleted: boolean; storage: 'doc' | 'blob'};
export type SyncFetched = {path: string; rev: number; sha256: string; content?: string; url?: string};
export type SyncUpload = {sha256: string; url: string; method: string; headers?: Record<string, string>};
export type SyncChange = {path: string; baseRev: number; sha256?: string; size?: number; mtime: number; content?: string; deleted?: true};
// rev: absent on 'rejected', which didn't change anything.
export type SyncResult = {path: string; status: 'applied' | 'same' | 'won' | 'lost' | 'rejected'; rev?: number; conflictId?: string; error?: string};

const syncBase = (id: string) => `/api/studio/projects/${id}/sync`;
const LONG = 120_000;
export const syncApi = {
  state: (id: string) => call<SyncRemoteState>(`${syncBase(id)}/state`, {timeout: 20_000, routeIsNew: true}),
  changes: (id: string, since: number, cursor: string | null) =>
    call<{rev: number; entries: SyncEntry[]; next: string | null}>(`${syncBase(id)}/changes?since=${since}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {timeout: LONG, routeIsNew: true}),
  fetch: (id: string, paths: string[]) => call<{items: SyncFetched[]; omitted: string[]}>(`${syncBase(id)}/fetch`, {body: {paths}, timeout: LONG, routeIsNew: true}),
  prepare: (id: string, files: {path: string; sha256: string; size: number}[]) =>
    call<{uploads: SyncUpload[]; present: string[]; rejected: {path: string; error: string}[]}>(`${syncBase(id)}/prepare`, {body: {files}, timeout: LONG, routeIsNew: true}),
  commit: (id: string, changes: SyncChange[]) => call<{rev: number; results: SyncResult[]}>(`${syncBase(id)}/commit`, {body: {changes}, timeout: LONG, routeIsNew: true}),
  conflicts: (id: string) => call<{conflicts: Record<string, unknown>[]}>(`${syncBase(id)}/conflicts?status=open`, {timeout: 20_000, routeIsNew: true}),
  conflictContent: (id: string, conflict: string) => call<{content?: string; url?: string}>(`${syncBase(id)}/conflicts/${encodeURIComponent(conflict)}/content`, {timeout: 30_000, routeIsNew: true}),
  dismiss: (id: string, conflict: string) => call<{ok: true}>(`${syncBase(id)}/conflicts/${encodeURIComponent(conflict)}/dismiss`, {body: {}, timeout: 20_000, routeIsNew: true}),
  shared: () => call<{project: {id: string}}>('/api/studio/shared-project', {timeout: 20_000, routeIsNew: true}),
};

// The project as the account has it, to bring it here.
export const remoteProject = async (cloudId: string) => (await call<{project: CloudProjectView}>(`/api/studio/projects/${cloudId}`, {timeout: 20_000, routeIsNew: true})).project;

// A folder for it that the app can't see yet: no project.json until everything has arrived. The link is written first,
// so a download cut in the middle finds its folder again.
export async function beginClone(dir: string, cloudId: string) {
  const userId = await currentUserId();
  fs.mkdirSync(path.dirname(projectLinkFile(dir)), {recursive: true});
  writeJson(projectLinkFile(dir), {cloudId, userId, server: baseUrl(), linkedAt: Date.now(), localOnly: false} satisfies ProjectLink, 1);
}

export function announceProjects() {
  changed();
}

export const validCloudId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
