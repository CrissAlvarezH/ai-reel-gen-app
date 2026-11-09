// Reel Studio's account (the ai-reel-gen-cloud site), optional: without it everything local works the same. Logs
// in with an email code and keeps the session's token in this computer's config (CONFIG_DIR/cloud.json, 0600),
// never in the workspace, which may be shared. Through it: the Instagram accounts he connected in the site's panel (with his own Meta app), their reels' private
// insights for Mi cuenta (saves, shares, reach, watch time), and publishing. The studio never holds Meta or AWS
// credentials. Each project uses one of those accounts (its config/instagram.json; by default the one with Mi
// cuenta's handle).
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONFIG, CONFIG_DIR} from './workspace.ts';
import {readJson} from './platform.ts';
import {httpError} from './reels.ts';
import type {CloudAccount, CloudReelInsights, CloudSession, CloudStatus} from '../shared/types.ts';

// REEL_STUDIO_CLOUD_URL and the one saved from Ajustes win over it.
const DEFAULT_URL = 'https://ai-reel-gen.socialsannin.com';
const PING_MS = 5 * 60_000;
const FILE = () => path.join(CONFIG_DIR, 'cloud.json');
const LINK = () => path.join(CONFIG, 'instagram.json');

// deviceId identifies this computer and outlives the session; userId goes with it.
type Saved = {url?: string; token?: string; email?: string; deviceId?: string; userId?: number};
const saved = (): Saved => readJson<Saved>(FILE()) ?? {};
function save(s: Saved) {
  fs.mkdirSync(CONFIG_DIR, {recursive: true});
  fs.writeFileSync(FILE(), JSON.stringify(s, null, 1) + '\n', {mode: 0o600});
  fs.chmodSync(FILE(), 0o600);
}
export const baseUrl = () => (process.env.REEL_STUDIO_CLOUD_URL || saved().url || DEFAULT_URL).replace(/\/+$/, '');
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

function forget(extra: Partial<Saved> = {}) {
  const {token: _gone, userId: _user, ...rest} = saved();
  save({...rest, ...extra});
  online = checkedAt = null;
  changed();
}

type Init = {method?: string; body?: unknown; auth?: boolean; timeout?: number};
async function call<T>(p: string, {method, body, auth = true, timeout = 60_000}: Init = {}): Promise<T> {
  const token = saved().token;
  if (auth && !token) throw httpError(401, 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta');
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
  } catch {
    if (current()) reached(false);
    throw httpError(502, `no hay conexión con tu cuenta de Reel Studio (${baseUrl()})`);
  }
  const j = (await r.json().catch(() => null)) as {error?: string} | null;
  if (auth && r.status === 401) {
    if (current()) forget();
    throw httpError(401, 'tu sesión de Reel Studio se cerró: vuelve a iniciarla en Ajustes → Cuenta');
  }
  if (current()) reached(true);
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
  return status();
}

export async function logout() {
  if (saved().token) await call('/api/studio/auth/logout', {body: {}}).catch(() => null);
  forget();
  return status();
}

// Another server (the deployed one, or a local one while developing it): its sessions are others, so it logs out.
export function setUrl(raw: unknown) {
  const v = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  if (v && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(v)) throw httpError(400, 'la dirección es como https://reelstudio.app');
  forget({url: v || undefined});
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

// Keeps session().online current for as long as the studio runs. Signed out, it never reaches the network.
export function startPing() {
  const ping = () => void (signedIn() && fetchMe(15_000).catch(() => null));
  ping();
  setInterval(ping, PING_MS).unref();
}

const link = () => readJson<Link>(LINK());
const writeLink = (l: Link | null) => (l ? fs.writeFileSync(LINK(), JSON.stringify(l, null, 1) + '\n') : fs.rmSync(LINK(), {force: true}));

// The account this project uses: the one picked, else (and then saved) the one with Mi cuenta's handle.
function resolve(accounts: CloudAccount[], handle: string | null) {
  const l = link();
  const picked = l && accounts.find((a) => a.id === l.accountId);
  if (picked) return picked;
  const same = handle ? accounts.find((a) => a.username.toLowerCase() === handle.toLowerCase()) : undefined;
  if (same) writeLink({accountId: same.id, username: same.username});
  return same ?? null;
}

export async function status(handle: string | null = null): Promise<CloudStatus> {
  const s = saved();
  const base = {url: baseUrl(), email: s.email ?? null, signedIn: !!s.token, user: null, metaApp: false, accounts: [], panelUrl: `${baseUrl()}/panel`, officialUrl: DEFAULT_URL, account: null, error: null};
  if (!s.token) return base;
  try {
    const me = await fetchMe(15_000);
    return {...base, user: me.user, metaApp: me.metaApp, accounts: me.accounts, panelUrl: me.panelUrl, account: resolve(me.accounts, handle)};
  } catch (e) {
    return {...base, signedIn: signedIn(), error: (e as Error).message};
  }
}

export async function setAccount(idIn: unknown, handle: string | null) {
  if (idIn === null) {
    writeLink(null);
    return status(handle);
  }
  const me = await fetchMe();
  const a = me.accounts.find((x) => x.id === Number(idIn));
  if (!a) throw httpError(404, 'esa cuenta no está conectada en tu panel de Reel Studio');
  writeLink({accountId: a.id, username: a.username});
  return status(handle);
}

// For Mi cuenta's download, read before it awaits anything (an automation may run it for another project): the
// account to ask, or null when he's not signed in or the project has none.
export const linkedAccount = () => (signedIn() ? link() : null);

// Its newest reels' insights (the cloud asks Meta; null where Meta has nothing yet).
export const reelInsights = (accountId: number, limit: number) =>
  call<{username: string; fetchedAt: string; reels: CloudReelInsights[]}>(`/api/studio/accounts/${accountId}/reels?limit=${Math.max(1, Math.min(50, limit))}`, {timeout: 120_000});
