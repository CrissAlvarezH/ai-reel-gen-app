// The keys in the account: the five states, what moves between .env and the cloud, and who may ask. Temp workspace,
// a fake cloud on a local port, and no real service: setKey's check is answered here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, beforeEach, test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-keys-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/canal/config'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/canal/project.json'), JSON.stringify({name: 'canal', created: 1}));

const LOCAL_ONLY = 'local-only-value-AAAA';
const CLOUD_ONLY = 'cloud-only-value-BBBB';
const SHARED = 'same-on-both-value-CCCC';
const MINE = 'this-computer-value-DDDD';
const THEIRS = 'the-account-value-EEEE';

type Row = {value: string | null; updatedAt: string; updatedBy: string};
let store: Map<string, Row>;
let down = false;
const seen: string[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (status: number, v: unknown) => (res.writeHead(status, {'content-type': 'application/json'}), res.end(JSON.stringify(v)));
    const url = new URL(req.url!, 'http://x');
    seen.push(`${req.method} ${req.url}`);
    if (url.pathname === '/api/studio/auth/verify') return send(200, {token: 'tok', user: {id: 42}});
    if (url.pathname === '/api/studio/me') return send(200, {user: {id: 42, email: 'yo@x.co', name: null}, metaApp: false, accounts: [], panelUrl: 'http://x'});
    if (url.pathname === '/api/studio/projects') return send(200, {projects: []});
    if (down) return send(500, {error: 'caído'});
    if (url.pathname === '/api/studio/keys') {
      const nonce = url.searchParams.get('nonce')!;
      return send(200, {keys: [...store].map(([name, r]) => ({name, last4: r.value ? r.value.slice(-4) : null, updatedAt: r.updatedAt, updatedBy: r.updatedBy, unreadable: r.value === null, digest: r.value === null ? null : createHash('sha256').update(`${nonce}:${r.value}`).digest('hex')}))});
    }
    const name = url.pathname.split('/').pop()!;
    if (req.method === 'PUT') {
      store.set(name, {value: JSON.parse(body).value, updatedAt: '2026-11-09T10:00:00.000Z', updatedBy: 'test'});
      return send(200, {key: {name}});
    }
    if (req.method === 'DELETE') return store.delete(name), send(200, {ok: true});
    const r = store.get(name);
    if (!r) return send(404, {error: 'Clave no encontrada'});
    if (r.value === null) return send(502, {error: 'No se pudo leer esta clave: vuelve a subirla'});
    send(200, {name, value: r.value, updatedAt: r.updatedAt});
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
process.env.REEL_STUDIO_CLOUD_URL = origin;
after(() => server.close());

// setKey checks each key against its service: answered here, so a test never reaches one.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => (String(input).startsWith(origin) ? realFetch(input, init) : Promise.resolve(new Response('{}', {status: 200})))) as typeof fetch;

const ws = await import('./workspace.ts');
const cloud = await import('./cloud.ts');
ws.openProject('canal');
const ENV = path.join(root, '.env');
const cfg = path.join(root, '.cfg/cloud.json');
const row = (value: string | null): Row => ({value, updatedAt: '2026-11-08T10:00:00.000Z', updatedBy: 'Reel Studio · Otro'});
const stateOf = async () => Object.fromEntries((await cloud.keysStatus()).keys.map((k) => [k.name, k.state]));

beforeEach(async () => {
  down = false;
  seen.length = 0;
  fs.writeFileSync(ENV, `# mis claves\nPEXELS_API_KEY=${LOCAL_ONLY}\nELEVENLABS_API_KEY=${SHARED}\nOPENAI_API_KEY=${MINE}\nOTRA_COSA=se-queda\n`, {mode: 0o600});
  store = new Map([
    ['APIFY_TOKEN', row(CLOUD_ONLY)],
    ['ELEVENLABS_API_KEY', row(SHARED)],
    ['OPENAI_API_KEY', row(THEIRS)],
  ]);
  await cloud.verify('yo@x.co', '123456');
});

test('keyState: the five states', () => {
  const nonce = 'n'.repeat(32);
  const digest = (v: string) => ({digest: createHash('sha256').update(`${nonce}:${v}`).digest('hex')});
  assert.equal(cloud.keyState(null, null, nonce), 'none');
  assert.equal(cloud.keyState('a', null, nonce), 'local');
  assert.equal(cloud.keyState(null, digest('a'), nonce), 'cloud');
  assert.equal(cloud.keyState('a', digest('a'), nonce), 'same');
  assert.equal(cloud.keyState('a', digest('b'), nonce), 'different');
  assert.equal(cloud.keyState('a', {digest: null}, nonce), 'different'); // unreadable in the account
});

test('the listing tells each state apart and has no values in it', async () => {
  const r = await cloud.keysStatus();
  assert.deepEqual(Object.fromEntries(r.keys.map((k) => [k.name, k.state])), {
    ELEVENLABS_API_KEY: 'same',
    PEXELS_API_KEY: 'local',
    PIXABAY_API_KEY: 'none',
    UNSPLASH_ACCESS_KEY: 'none',
    OPENAI_API_KEY: 'different',
    SCRAPECREATORS_API_KEY: 'none',
    APIFY_TOKEN: 'cloud',
  });
  const text = JSON.stringify(r);
  for (const v of [LOCAL_ONLY, CLOUD_ONLY, SHARED, MINE, THEIRS]) assert.ok(!text.includes(v));
  const diff = r.keys.find((k) => k.name === 'OPENAI_API_KEY')!;
  assert.deepEqual({l: diff.localLast4, c: diff.cloudLast4, at: diff.updatedAt, by: diff.updatedBy}, {l: 'DDDD', c: 'EEEE', at: '2026-11-08T10:00:00.000Z', by: 'Reel Studio · Otro'});
});

test('every listing asks with a new nonce', async () => {
  seen.length = 0;
  await cloud.keysStatus();
  await cloud.keysStatus();
  const nonces = seen.filter((s) => s.includes('/keys?')).map((s) => s.split('nonce=')[1]);
  assert.equal(nonces.length, 2);
  assert.match(nonces[0], /^[0-9a-f]{32}$/);
  assert.notEqual(nonces[0], nonces[1]);
});

test('uploading sends what .env has', async () => {
  const r = await cloud.uploadKey('PEXELS_API_KEY');
  assert.equal(store.get('PEXELS_API_KEY')?.value, LOCAL_ONLY);
  assert.equal(r.keys.find((k) => k.name === 'PEXELS_API_KEY')?.state, 'same');
  await assert.rejects(cloud.uploadKey('PIXABAY_API_KEY'), /no hay clave guardada/);
});

test('downloading writes only its line in .env, which stays 0600', async () => {
  await cloud.downloadKey('APIFY_TOKEN');
  const env = fs.readFileSync(ENV, 'utf8');
  assert.ok(env.includes(`APIFY_TOKEN=${CLOUD_ONLY}`));
  for (const line of ['# mis claves', `PEXELS_API_KEY=${LOCAL_ONLY}`, `ELEVENLABS_API_KEY=${SHARED}`, `OPENAI_API_KEY=${MINE}`, 'OTRA_COSA=se-queda']) assert.ok(env.includes(line), line);
  assert.equal(fs.statSync(ENV).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(cfg, 'utf8').includes(CLOUD_ONLY));
});

test('the bulk actions leave a different key alone, in both directions', async () => {
  const up = await cloud.moveMissingKeys('upload');
  assert.deepEqual(up.moved, ['PEXELS_API_KEY']);
  assert.equal(store.get('OPENAI_API_KEY')?.value, THEIRS);
  const down = await cloud.moveMissingKeys('download');
  assert.deepEqual(down.moved, ['APIFY_TOKEN']);
  assert.ok(fs.readFileSync(ENV, 'utf8').includes(`OPENAI_API_KEY=${MINE}`));
  assert.equal((await stateOf()).OPENAI_API_KEY, 'different');
  await assert.rejects(cloud.moveMissingKeys('sideways'), /dirección no válida/);
});

test('removing only touches the account', async () => {
  await cloud.removeCloudKey('ELEVENLABS_API_KEY');
  assert.equal(store.has('ELEVENLABS_API_KEY'), false);
  assert.ok(fs.readFileSync(ENV, 'utf8').includes(`ELEVENLABS_API_KEY=${SHARED}`));
});

test('a key the account cant read: its error, .env untouched, and left out of the bulk download', async () => {
  store.set('OPENAI_API_KEY', row(null));
  store.set('APIFY_TOKEN', row(null));
  const before = fs.readFileSync(ENV, 'utf8');
  await assert.rejects(cloud.downloadKey('OPENAI_API_KEY'), /vuelve a subirla/);
  assert.equal(fs.readFileSync(ENV, 'utf8'), before);
  const r = await cloud.moveMissingKeys('download');
  assert.deepEqual([r.moved, r.failed], [[], []]);
  assert.equal(r.keys.find((k) => k.name === 'APIFY_TOKEN')?.unreadable, true);
  await cloud.uploadKey('OPENAI_API_KEY');
  assert.equal(store.get('OPENAI_API_KEY')?.value, MINE);
});

test('an empty answer from the account never erases the local key', async () => {
  store.set('OPENAI_API_KEY', row(''));
  await assert.rejects(cloud.downloadKey('OPENAI_API_KEY'), /no devolvió/);
  assert.ok(fs.readFileSync(ENV, 'utf8').includes(`OPENAI_API_KEY=${MINE}`));
});

test('names outside the list are refused, without calling the account', async () => {
  seen.length = 0;
  for (const n of ['OTRA_COSA', 'constructor', '__proto__', '../me']) {
    await assert.rejects(cloud.uploadKey(n), /clave desconocida/);
    await assert.rejects(cloud.downloadKey(n), /clave desconocida/);
    await assert.rejects(cloud.removeCloudKey(n), /clave desconocida/);
  }
  assert.deepEqual(seen, []);
});

test('with the account unreachable the local side is still shown, with the reason', async () => {
  down = true;
  const r = await cloud.keysStatus();
  assert.ok(r.error);
  assert.equal(r.keys.find((k) => k.name === 'PEXELS_API_KEY')?.state, 'local');
  await assert.rejects(cloud.moveMissingKeys('download'));
});

test('signed out: only what is local, and no call to the network', async () => {
  await cloud.logout();
  seen.length = 0;
  const r = await cloud.keysStatus();
  assert.equal(r.signedIn, false);
  assert.equal(r.keys.find((k) => k.name === 'APIFY_TOKEN')?.state, 'none');
  assert.deepEqual(seen, []);
  await assert.rejects(cloud.moveMissingKeys('upload'), /inicia sesión/);
});

test('only this computer may ask', () => {
  const ok = {remoteAddress: '127.0.0.1', host: 'localhost:4000'};
  assert.equal(cloud.isLoopback(ok), true);
  assert.equal(cloud.isLoopback({...ok, remoteAddress: '::1'}), true);
  assert.equal(cloud.isLoopback({...ok, remoteAddress: '::ffff:127.0.0.1'}), true);
  assert.equal(cloud.isLoopback({...ok, origin: 'http://localhost:4000'}), true);
  assert.equal(cloud.isLoopback({...ok, remoteAddress: '192.168.1.20'}), false);
  assert.equal(cloud.isLoopback({...ok, remoteAddress: undefined}), false);
  assert.equal(cloud.isLoopback({...ok, host: '192.168.1.5:4000'}), false);
  assert.equal(cloud.isLoopback({...ok, host: 'evil.example:4000'}), false); // DNS rebinding
  assert.equal(cloud.isLoopback({...ok, host: undefined}), false);
  assert.equal(cloud.isLoopback({...ok, origin: 'https://evil.example'}), false); // a page in this computer's browser
  assert.equal(cloud.isLoopback({...ok, origin: 'null'}), false);
});
