// Reel Studio's account: the session stays in this computer's config, the project's Instagram account is picked
// by Mi cuenta's handle, and a rejected session is forgotten. Temp workspace, a fake cloud on a local port.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-cloud-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/canal/config'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/canal/project.json'), JSON.stringify({name: 'canal', created: 1}));

const accounts = [
  {id: 3, username: 'otra.cuenta', name: null, pictureUrl: null, tokenExpiresAt: '2027-01-01T00:00:00Z', insights: true},
  {id: 7, username: 'entiende.finanzas.ya', name: null, pictureUrl: null, tokenExpiresAt: '2027-01-01T00:00:00Z', insights: true},
];
let valid = 'tok-1';
let down = false;
let answerLate: (() => void) | null = null; // a request held open until a test lets it answer 401
const seen: string[] = [];
const verifications: Record<string, unknown>[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    const send = (status: number, v: unknown) => (res.writeHead(status, {'content-type': 'application/json'}), res.end(JSON.stringify(v)));
    if (req.url === '/api/studio/auth/code') return send(200, {ok: true});
    if (down) return req.socket.destroy();
    if (req.url?.startsWith('/api/studio/accounts/')) return void (answerLate = () => send(401, {error: 'Inicia sesión primero'}));
    if (req.url === '/api/studio/auth/verify') {
      const b = JSON.parse(body);
      verifications.push(b);
      return b.code === '123456' ? send(200, {token: valid, user: {id: 42, email: b.email, name: null}}) : send(400, {error: 'Código incorrecto'});
    }
    if (req.headers.authorization !== `Bearer ${valid}`) return send(401, {error: 'Inicia sesión primero'});
    if (req.url === '/api/studio/me') return send(200, {user: {id: 42, email: 'yo@x.co', name: null}, metaApp: true, accounts, panelUrl: 'http://cloud/panel'});
    send(404, {error: 'no'});
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
process.env.REEL_STUDIO_CLOUD_URL = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
after(() => server.close());

test('logs in with the code, keeps the token private, links the account with Mi cuenta\'s handle', async () => {
  const ws = await import('./workspace.ts');
  const cloud = await import('./cloud.ts');
  ws.openProject('canal');

  await assert.rejects(cloud.verify('yo@x.co', '000000'), /Código incorrecto/);
  await cloud.sendCode(' Yo@X.co ');
  const s = await cloud.verify('yo@x.co', '123 456');
  assert.equal(s.signedIn, true);
  const file = path.join(root, '.cfg/cloud.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).email, 'yo@x.co');
  assert.ok(!fs.readdirSync(root).includes('cloud.json')); // not in the workspace

  // No pick yet: the one with Mi cuenta's handle, saved for the project (downloads read it without asking).
  const st = await cloud.status('Entiende.Finanzas.Ya');
  assert.equal(st.account?.id, 7);
  assert.deepEqual(cloud.linkedAccount(), {accountId: 7, username: 'entiende.finanzas.ya'});
  // A pick wins over the handle; an unknown one is refused.
  assert.equal((await cloud.setAccount(3, 'entiende.finanzas.ya')).account?.id, 3);
  await assert.rejects(cloud.setAccount(99, null), /no está conectada/);
  assert.equal((await cloud.setAccount(null, null)).account, null);
});

test('a session the cloud rejects is forgotten', async () => {
  const cloud = await import('./cloud.ts');
  valid = 'tok-2'; // e.g. closed from the panel
  const st = await cloud.status(null);
  assert.equal(st.signedIn, false);
  assert.match(st.error ?? '', /sesión de Reel Studio se cerró/);
  assert.equal(cloud.linkedAccount(), null);
  assert.ok(seen.some((x) => x.startsWith('GET /api/studio/me Bearer tok-1')));
});

const cfg = () => JSON.parse(fs.readFileSync(path.join(root, '.cfg/cloud.json'), 'utf8'));

test('the deviceId is created once and survives logging out; the userId goes with the session', async () => {
  const cloud = await import('./cloud.ts');
  valid = 'tok-3';
  await cloud.verify('yo@x.co', '123456');
  const first = cfg();
  assert.match(first.deviceId, /^[0-9a-f-]{36}$/);
  assert.equal(first.userId, 42);
  assert.equal(verifications.at(-1)?.deviceId, first.deviceId);

  await cloud.logout();
  assert.equal(cfg().deviceId, first.deviceId);
  assert.equal(cfg().token, undefined);
  assert.equal(cfg().userId, undefined);

  await cloud.verify('yo@x.co', '123456');
  assert.equal(verifications.at(-1)?.deviceId, first.deviceId);
  assert.equal(cfg().deviceId, first.deviceId);
});

test('a session from before userId was kept gets it from /me', async () => {
  const cloud = await import('./cloud.ts');
  const {userId: _gone, ...older} = cfg();
  fs.writeFileSync(path.join(root, '.cfg/cloud.json'), JSON.stringify(older));
  await cloud.status(null);
  assert.equal(cfg().userId, 42);
});

test('session() answers without the network and follows what signed-in calls found', async () => {
  const cloud = await import('./cloud.ts');
  let changes = 0;
  cloud.onCloudChange(() => changes++);

  await cloud.status(null);
  const before = seen.length;
  const up = cloud.session();
  assert.equal(seen.length, before);
  assert.deepEqual({signedIn: up.signedIn, email: up.email, online: up.online}, {signedIn: true, email: 'yo@x.co', online: true});
  assert.equal(typeof up.checkedAt, 'number');
  assert.equal(changes, 0); // still reachable: nothing to tell the pages

  down = true;
  const st = await cloud.status(null);
  down = false;
  assert.equal(st.signedIn, true); // no network doesn't end the session
  assert.equal(cloud.session().online, false);
  assert.equal(changes, 1);

  await cloud.status(null);
  assert.equal(cloud.session().online, true);
  assert.equal(changes, 2);
});

test('a 401 forgets the session and announces it; signed out, nothing reaches the network', async () => {
  const cloud = await import('./cloud.ts');
  let changes = 0;
  cloud.onCloudChange(() => changes++);
  valid = 'tok-4';
  await cloud.status(null);
  assert.equal(changes, 1);
  assert.deepEqual({signedIn: cloud.session().signedIn, online: cloud.session().online, checkedAt: cloud.session().checkedAt}, {signedIn: false, online: null, checkedAt: null});

  const before = seen.length;
  cloud.startPing();
  await cloud.status(null);
  assert.equal(seen.length, before);
  await assert.rejects(cloud.reelInsights(7, 5), /Ajustes → Cuenta/);
  assert.equal(seen.length, before);
});

test('a late 401 for a previous session leaves the new one alone', async () => {
  const cloud = await import('./cloud.ts');
  valid = 'tok-5';
  await cloud.verify('yo@x.co', '123456');
  const stale = cloud.reelInsights(7, 5).catch((e: Error) => e.message);
  while (!answerLate) await new Promise((r) => setTimeout(r, 5));
  await cloud.logout();
  valid = 'tok-6';
  await cloud.verify('yo@x.co', '123456');
  answerLate();
  assert.match(String(await stale), /se cerró/);
  assert.equal(cfg().token, 'tok-6');
  assert.equal(cloud.session().signedIn, true);
});

test('the official server is the default, and a url left in an old cloud.json is ignored', async () => {
  const cloud = await import('./cloud.ts');
  const env = process.env.REEL_STUDIO_CLOUD_URL;
  delete process.env.REEL_STUDIO_CLOUD_URL;
  const file = path.join(process.env.REEL_STUDIO_CONFIG_DIR!, 'cloud.json');
  const before = fs.readFileSync(file, 'utf8');
  try {
    fs.writeFileSync(file, JSON.stringify({...JSON.parse(before), url: 'https://mio.example'}));
    assert.equal(cloud.baseUrl(), 'https://ai-reel-gen.socialsannin.com');
  } finally {
    fs.writeFileSync(file, before);
    process.env.REEL_STUDIO_CLOUD_URL = env;
  }
});
