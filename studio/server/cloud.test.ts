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
const seen: string[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    const send = (status: number, v: unknown) => (res.writeHead(status, {'content-type': 'application/json'}), res.end(JSON.stringify(v)));
    if (req.url === '/api/studio/auth/code') return send(200, {ok: true});
    if (req.url === '/api/studio/auth/verify') return JSON.parse(body).code === '123456' ? send(200, {token: valid}) : send(400, {error: 'Código incorrecto'});
    if (req.headers.authorization !== `Bearer ${valid}`) return send(401, {error: 'Inicia sesión primero'});
    if (req.url === '/api/studio/me') return send(200, {user: {email: 'yo@x.co', name: null}, metaApp: true, accounts, panelUrl: 'http://cloud/panel'});
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
