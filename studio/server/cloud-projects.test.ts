// Projects in the account: when they register on their own, when he's asked, and who decides the Instagram account.
// Temp workspace, a fake cloud on a local port that behaves like the real one's project API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, beforeEach, test} from 'node:test';
import type {CloudProjectView} from '../shared/types.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-cloud-projects-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

const acct = (id: number, username: string) => ({id, username, name: null, pictureUrl: null, tokenExpiresAt: null, insights: true});
const accounts = [acct(3, 'otra.cuenta'), acct(7, 'entiende.finanzas.ya')];

let remote: Map<string, CloudProjectView & {deleted?: boolean}>;
let requests: {method: string; url: string; body: Record<string, unknown> | null}[];
let down: (r: {method: string; url: string}) => boolean;
let oldServer = false;
let userId = 42;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const method = req.method!;
    const url = req.url!;
    const body = raw ? JSON.parse(raw) : null;
    if (down({method, url})) return req.socket.destroy();
    requests.push({method, url, body});
    const send = (status: number, v: unknown) => (res.writeHead(status, {'content-type': 'application/json'}), res.end(JSON.stringify(v)));
    if (url === '/api/studio/auth/verify') return send(200, {token: 'tok', user: {id: userId, email: body.email, name: null}});
    if (url === '/api/studio/auth/logout') return send(200, {ok: true});
    if (url === '/api/studio/me') return send(200, {user: {id: userId, email: 'yo@x.co', name: null}, metaApp: true, accounts, panelUrl: 'http://cloud/panel'});
    if (!url.startsWith('/api/studio/projects')) return send(404, {error: 'no'});
    if (oldServer) return (res.writeHead(404, {'content-type': 'text/html'}), res.end('<html>'));
    if (url === '/api/studio/projects') return send(200, {projects: [...remote.values()].filter((p) => !p.deleted)});
    const id = url.split('/').pop()!;
    const p = remote.get(id);
    if (p?.deleted && method !== 'DELETE') return send(410, {error: 'Este proyecto se eliminó de tu cuenta'});
    if (method === 'GET') return p ? send(200, {project: p}) : send(404, {error: 'Proyecto no encontrado'});
    if (method === 'DELETE') {
      if (!p) return send(404, {error: 'Proyecto no encontrado'});
      p.deleted = true;
      return send(200, {ok: true});
    }
    if (method === 'PUT') {
      const row = p ?? ({id, slug: body.slug, name: body.name, localCreated: body.localCreated, instagram: null, instagramSetAt: null, createdAt: 'x', updatedAt: 'x', sync: null} as CloudProjectView);
      remote.set(id, row);
      return send(200, {project: row});
    }
    if (method === 'PATCH') {
      if (!p) return send(404, {error: 'Proyecto no encontrado'});
      if (body.name) p.name = body.name;
      if ('instagramAccountId' in body) {
        const a = accounts.find((x) => x.id === body.instagramAccountId);
        p.instagram = a ? {accountId: a.id, username: a.username, connected: true} : null;
        p.instagramSetAt = 'set';
      }
      return send(200, {project: p});
    }
    send(405, {error: 'no'});
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
process.env.REEL_STUDIO_CLOUD_URL = URL_;
after(() => server.close());

const dirOf = (id: string) => path.join(root, 'projects', id);
function makeProject(id: string, name = id) {
  fs.mkdirSync(path.join(dirOf(id), 'config'), {recursive: true});
  fs.writeFileSync(path.join(dirOf(id), 'project.json'), JSON.stringify({name, created: 1000}));
}
const linkOf = (id: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOf(id), '.reel-studio/cloud.json'), 'utf8'));
  } catch {
    return null;
  }
};
const igFile = (id: string) => path.join(dirOf(id), 'config/instagram.json');
const igOf = (id: string) => (fs.existsSync(igFile(id)) ? JSON.parse(fs.readFileSync(igFile(id), 'utf8')) : null);
const cloudRow = (id: string, over: Partial<CloudProjectView> = {}): CloudProjectView => ({id, slug: 'otro-slug', name: 'Otro nombre', localCreated: 1, instagram: null, instagramSetAt: null, createdAt: 'x', updatedAt: 'x', sync: null, ...over});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sent = (method: string) => requests.filter((r) => r.method === method && r.url.includes('/projects/'));

makeProject('principal', 'Principal');
const ws = await import('./workspace.ts');
const cloud = await import('./cloud.ts');

async function login() {
  await cloud.verify('yo@x.co', '123456');
  await cloud.reconcileProjects();
}

beforeEach(async () => {
  await cloud.logout();
  for (const id of fs.readdirSync(path.join(root, 'projects'))) if (id !== 'principal') fs.rmSync(dirOf(id), {recursive: true, force: true});
  fs.rmSync(path.join(dirOf('principal'), '.reel-studio/cloud.json'), {force: true});
  fs.rmSync(igFile('principal'), {force: true});
  fs.rmSync(path.join(dirOf('principal'), 'config/account.json'), {force: true});
  ws.openProject('principal');
  remote = new Map();
  requests = [];
  down = () => false;
  oldServer = false;
  userId = 42;
});

test('logging in registers the projects nothing in the account looks like, sending only metadata', async () => {
  makeProject('canal', 'Mi Canal');
  await login();
  assert.equal(remote.size, 2);
  const l = linkOf('canal');
  assert.match(l.cloudId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({userId: l.userId, server: l.server, localOnly: l.localOnly}, {userId: 42, server: URL_, localOnly: false});
  assert.equal(typeof l.linkedAt, 'number');
  assert.deepEqual(Object.keys(sent('PUT')[0].body!).sort(), ['localCreated', 'name', 'nameUpdatedAt', 'slug']);
  assert.deepEqual(ws.listProjects().find((p) => p.id === 'canal')?.cloud, {id: l.cloudId, active: true});
});

test('registering twice keeps the id, and a repeat login adds nothing', async () => {
  await login();
  const id = linkOf('principal').cloudId;
  await cloud.logout();
  await login();
  assert.equal(linkOf('principal').cloudId, id);
  assert.equal(remote.size, 1);
});

test('a response lost on the way retries with the same id instead of duplicating it', async () => {
  down = (r) => r.method === 'PUT';
  await login();
  const first = linkOf('principal');
  assert.ok(first.cloudId);
  assert.equal(first.linkedAt, null);
  assert.equal(ws.listProjects()[0].cloud?.active, false);

  down = () => false;
  await cloud.reconcileProjects();
  assert.equal(linkOf('principal').cloudId, first.cloudId);
  assert.equal(typeof linkOf('principal').linkedAt, 'number');
  assert.equal(remote.size, 1);
});

for (const [what, row] of [
  ['the folder', cloudRow(uuid(1), {slug: 'principal'})],
  ['the name, ignoring case', cloudRow(uuid(1), {name: 'PRINCIPAL'})],
] as const)
  test(`a project with the same ${what} is asked about, not registered`, async () => {
    remote.set(row.id, row);
    await login();
    assert.equal(linkOf('principal'), null);
    assert.equal(remote.size, 1);
    const p = await cloud.projects();
    assert.deepEqual(p.matches.map((m) => [m.local, m.cloud.id]), [['principal', uuid(1)]]);
    assert.deepEqual(p.remoteOnly.map((c) => c.id), [uuid(1)]);
    assert.equal(p.local[0].state, 'none');
  });

test('a project with the same Instagram account is asked about, by the pick or by Mi cuenta\'s handle', async () => {
  const row = cloudRow(uuid(1), {instagram: {accountId: 7, username: 'entiende.finanzas.ya', connected: true}, instagramSetAt: 'set'});
  remote.set(row.id, row);
  fs.writeFileSync(path.join(dirOf('principal'), 'config/account.json'), JSON.stringify({username: '@Entiende.Finanzas.Ya'}));
  await login();
  assert.equal(linkOf('principal'), null);
  assert.equal((await cloud.projects()).matches.length, 1);
});

test('Crear aparte doesn\'t merge them; Vincular uses that id and brings its account', async () => {
  makeProject('canal', 'Canal');
  const row = cloudRow(uuid(1), {slug: 'principal'});
  const other = cloudRow(uuid(2), {slug: 'canal', instagram: {accountId: 7, username: 'entiende.finanzas.ya', connected: true}, instagramSetAt: 'set'});
  remote.set(row.id, row);
  remote.set(other.id, other);
  await login();

  await cloud.registerProject('principal', true);
  assert.notEqual(linkOf('principal').cloudId, uuid(1));
  assert.equal(remote.size, 3);

  const after = await cloud.linkProject('canal', uuid(2));
  assert.equal(linkOf('canal').cloudId, uuid(2));
  assert.deepEqual(igOf('canal'), {accountId: 7, username: 'entiende.finanzas.ya'});
  assert.equal(after.matches.length, 0);
  assert.equal(after.local.find((p) => p.id === 'canal')?.state, 'linked');
});

test('Vincular refuses a bad id, one that isn\'t his, and one another local project already has', async () => {
  makeProject('canal', 'Canal');
  await login();
  await assert.rejects(cloud.linkProject('canal', '../x'), /no es válido/);
  await assert.rejects(cloud.linkProject('canal', uuid(9)), /no encontrado/);
  await assert.rejects(cloud.linkProject('canal', linkOf('principal').cloudId), /ya está vinculado/);
  await assert.rejects(cloud.registerProject('../../etc', false), /no encontrado/);
});

test('Mantener solo en este equipo is remembered: not proposed nor registered again', async () => {
  const row = cloudRow(uuid(1), {slug: 'principal'});
  remote.set(row.id, row);
  await login();
  await cloud.setLocalOnly('principal', true);
  await cloud.reconcileProjects();
  const p = await cloud.projects();
  assert.equal(p.matches.length, 0);
  assert.equal(p.local[0].state, 'local-only');
  assert.equal(remote.size, 1);
  assert.equal(linkOf('principal').cloudId, null);
});

test('renaming keeps the link and tells the account', async () => {
  await login();
  const id = linkOf('principal').cloudId;
  ws.renameProject('principal', 'Nuevo Nombre');
  cloud.projectRenamed('principal');
  while (!sent('PATCH').length) await new Promise((r) => setTimeout(r, 5));
  assert.equal(linkOf('principal').cloudId, id);
  assert.equal(ws.listProjects()[0].cloud?.active, true);
  assert.equal(sent('PATCH')[0].body!.name, 'Nuevo Nombre');
  ws.renameProject('principal', 'Principal');
});

test('a link from another user or server is inactive and nothing touches it until he asks', async () => {
  await login();
  const id = linkOf('principal').cloudId;
  const file = path.join(dirOf('principal'), '.reel-studio/cloud.json');
  const original = linkOf('principal');

  for (const other of [{userId: 99}, {server: 'https://otro.example'}]) {
    fs.writeFileSync(file, JSON.stringify({...original, ...other}));
    assert.equal(ws.listProjects()[0].cloud?.active, false);
    requests = [];
    await cloud.reconcileProjects();
    await cloud.setAccount(7, null);
    assert.equal(sent('PUT').length + sent('PATCH').length, 0);
    assert.deepEqual(linkOf('principal').cloudId, id);
    assert.equal((await cloud.projects()).local[0].state, 'other-account');
  }

  await cloud.registerProject('principal', true);
  const fresh = linkOf('principal');
  assert.notEqual(fresh.cloudId, id);
  assert.deepEqual({userId: fresh.userId, server: fresh.server}, {userId: 42, server: URL_});
});

test('signed out, a project shows inactive and nothing reaches the network', async () => {
  await login();
  await cloud.logout();
  requests = [];
  assert.equal(ws.listProjects()[0].cloud?.active, false);
  assert.equal((await cloud.projects()).signedIn, false);
  await cloud.reconcileProjects();
  assert.deepEqual(requests, []);
});

/* Instagram: who decides */

const registered = async () => {
  await login();
  return remote.get(linkOf('principal').cloudId)!;
};

test('read: the account\'s choice wins and rewrites the cache', async () => {
  const p = await registered();
  Object.assign(p, {instagram: {accountId: 3, username: 'otra.cuenta', connected: true}, instagramSetAt: 'set'});
  fs.writeFileSync(igFile('principal'), JSON.stringify({accountId: 7, username: 'entiende.finanzas.ya'}));
  assert.equal((await cloud.status('entiende.finanzas.ya')).account?.id, 3);
  assert.deepEqual(igOf('principal'), {accountId: 3, username: 'otra.cuenta'});
});

test('read: Ninguna holds even with a matching handle, and the cache goes', async () => {
  const p = await registered();
  Object.assign(p, {instagram: null, instagramSetAt: 'set'});
  fs.writeFileSync(igFile('principal'), JSON.stringify({accountId: 7, username: 'entiende.finanzas.ya'}));
  const st = await cloud.status('entiende.finanzas.ya');
  assert.equal(st.account, null);
  assert.equal(igOf('principal'), null);
});

test('read: nothing chosen yet, today\'s logic finds it by handle and tells the account', async () => {
  const p = await registered();
  requests = [];
  const st = await cloud.status('Entiende.Finanzas.Ya');
  assert.equal(st.account?.id, 7);
  assert.deepEqual(igOf('principal'), {accountId: 7, username: 'entiende.finanzas.ya'});
  assert.deepEqual(sent('PATCH')[0].body, {instagramAccountId: 7});
  assert.equal(p.instagram?.accountId, 7);
});

test('read: nothing chosen and nothing found sends no choice', async () => {
  await registered();
  requests = [];
  assert.equal((await cloud.status(null)).account, null);
  assert.equal(sent('PATCH').length, 0);
});

test('read: without a network for the project, the cache keeps working', async () => {
  await registered();
  fs.writeFileSync(igFile('principal'), JSON.stringify({accountId: 3, username: 'otra.cuenta'}));
  down = (r) => r.url.includes('/projects/');
  assert.equal((await cloud.status(null)).account?.id, 3);
  assert.deepEqual(cloud.linkedAccount(), {accountId: 3, username: 'otra.cuenta'});
});

test('read: not registered is today\'s logic, Ninguna included', async () => {
  const row = cloudRow(uuid(1), {slug: 'principal'});
  remote.set(row.id, row);
  await login();
  requests = [];
  assert.equal((await cloud.status('entiende.finanzas.ya')).account?.id, 7);
  assert.equal(sent('PATCH').length, 0);
  assert.equal(sent('GET').length, 0);
});

test('read: a disconnected account is named and leaves no cache to download with', async () => {
  const p = await registered();
  Object.assign(p, {instagram: {accountId: null, username: 'x', connected: false}, instagramSetAt: 'set'});
  fs.writeFileSync(igFile('principal'), JSON.stringify({accountId: 7, username: 'x'}));
  const st = await cloud.status(null);
  assert.equal(st.account, null);
  assert.equal(st.disconnected, 'x');
  assert.equal(cloud.linkedAccount(), null);
});

test('write: the account goes first and Ninguna is a choice', async () => {
  const p = await registered();
  await cloud.setAccount(7, null);
  assert.equal(p.instagram?.accountId, 7);
  assert.deepEqual(igOf('principal'), {accountId: 7, username: 'entiende.finanzas.ya'});

  await cloud.setAccount(null, 'entiende.finanzas.ya');
  assert.equal(p.instagram, null);
  assert.equal(igOf('principal'), null);
  assert.equal((await cloud.status('entiende.finanzas.ya')).account, null);
});

test('write: if the account can\'t be saved he hears it and the cache doesn\'t change', async () => {
  await registered();
  await cloud.setAccount(3, null);
  down = (r) => r.method === 'PATCH';
  await assert.rejects(cloud.setAccount(7, null), /no hay conexión/);
  await assert.rejects(cloud.setAccount(null, null), /no hay conexión/);
  assert.deepEqual(igOf('principal'), {accountId: 3, username: 'otra.cuenta'});
});

test('write: not registered only touches the cache', async () => {
  const row = cloudRow(uuid(1), {slug: 'principal'});
  remote.set(row.id, row);
  await login();
  requests = [];
  await cloud.setAccount(7, null);
  assert.equal(sent('PATCH').length, 0);
  assert.deepEqual(igOf('principal'), {accountId: 7, username: 'entiende.finanzas.ya'});
});

test('opening a project brings the account\'s choice into its cache', async () => {
  const p = await registered();
  Object.assign(p, {instagram: {accountId: 3, username: 'otra.cuenta', connected: true}, instagramSetAt: 'set'});
  await cloud.refreshProject('principal');
  assert.deepEqual(igOf('principal'), {accountId: 3, username: 'otra.cuenta'});
});

/* Deleted, created, old servers */

test('deleted in the account: he\'s told, nothing local goes, and registering again takes a new id', async () => {
  const p = await registered();
  const id = p.id;
  fs.writeFileSync(igFile('principal'), JSON.stringify({accountId: 7, username: 'entiende.finanzas.ya'}));
  p.deleted = true;

  const st = await cloud.status(null);
  assert.equal(st.projectGone, true);
  assert.equal(st.account?.id, 7); // the local cache keeps working
  assert.ok(fs.existsSync(path.join(dirOf('principal'), 'project.json')));
  assert.equal((await cloud.projects()).local[0].state, 'deleted');

  await cloud.setAccount(3, null); // a project it no longer has is only local
  assert.deepEqual(igOf('principal'), {accountId: 3, username: 'otra.cuenta'});

  await assert.rejects(cloud.registerProject('principal', false), /se eliminó/);
  await cloud.registerProject('principal', true);
  assert.notEqual(linkOf('principal').cloudId, id);
  assert.equal((await cloud.projects()).local[0].state, 'linked');
});

test('back from solo local on a deleted project takes a new id', async () => {
  const p = await registered();
  p.deleted = true;
  await cloud.setLocalOnly('principal', true);
  await cloud.registerProject('principal', false);
  assert.notEqual(linkOf('principal').cloudId, p.id);
  assert.equal((await cloud.projects()).local[0].state, 'linked');
});

test('deleting from the account is only that, and repeating it is fine', async () => {
  const p = await registered();
  await cloud.deleteFromAccount('principal');
  assert.equal(p.deleted, true);
  await cloud.deleteFromAccount('principal');
  assert.ok(fs.existsSync(path.join(dirOf('principal'), 'project.json')));
});

test('a new project with a session registers; without a network it stays pending and retries', async () => {
  await login();
  down = (r) => r.method === 'PUT';
  ws.createProject('Nuevo');
  cloud.registerNew('nuevo');
  while (!linkOf('nuevo')) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(linkOf('nuevo').linkedAt, null);
  const id = linkOf('nuevo').cloudId;

  down = () => false;
  await cloud.reconcileProjects();
  assert.equal(linkOf('nuevo').cloudId, id);
  assert.equal(typeof linkOf('nuevo').linkedAt, 'number');
  assert.equal(remote.has(id), true);
});

test('createProject doesn\'t carry the open project\'s link', async () => {
  await login();
  ws.createProject('Copia');
  assert.equal(linkOf('copia'), null);
});

test('a server without this function says so and local things keep working', async () => {
  await registered();
  oldServer = true;
  await assert.rejects(cloud.registerProject('principal', true), /aún no tiene esta función/);
  assert.equal((await cloud.status(null)).error, null);
  assert.equal((await cloud.status(null)).projectGone, false);
  assert.match((await cloud.projects()).error ?? '', /aún no tiene esta función/);
});
