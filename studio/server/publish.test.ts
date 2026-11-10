// Publicar against a fake account (a small HTTP server standing for the cloud and for S3) in a temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, beforeEach, test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-publish-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

type Pub = {id: string; body: Record<string, unknown>; status: string; scheduledAt: string | null; gets: number};
const ctl = {old: false, putStatus: 0, pubs: new Map<string, Pub>(), puts: new Map<string, number>(), n: 0};
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const send = (status: number, body: unknown) => res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
  const url = req.url ?? '';
  if (url.startsWith('/s3/')) {
    if (ctl.putStatus) return res.writeHead(ctl.putStatus).end('<Error><Code>Nope</Code></Error>');
    ctl.puts.set(url.slice(4), raw.length);
    return res.writeHead(200).end();
  }
  if (req.headers.authorization !== 'Bearer tok') return send(401, {error: 'no'});
  const view = (p: Pub) => ({id: p.id, status: p.status, scheduledAt: ctl.old ? undefined : p.scheduledAt, error: null, permalink: p.status === 'published' ? `https://www.instagram.com/reel/R${p.id}code/` : null});
  if (req.method === 'POST' && url === '/api/studio/publications') {
    const body = JSON.parse(raw.toString());
    const id = `P${++ctl.n}`;
    const p: Pub = {id, body, status: 'uploading', scheduledAt: ctl.old ? null : (body.scheduledAt ?? null), gets: 0};
    ctl.pubs.set(id, p);
    const put = (k: string, type: string) => ({url: `${base}/s3/${k}`, method: 'PUT', headers: {'Content-Type': type}});
    return send(200, {id, ...(ctl.old ? {} : {scheduledAt: p.scheduledAt}), upload: put(`${id}.mp4`, 'video/mp4'), cover: body.coverSize ? put(`${id}.jpg`, 'image/jpeg') : null});
  }
  const m = /^\/api\/studio\/publications\/(\w+)(\/uploaded)?$/.exec(url);
  const p = m && ctl.pubs.get(m[1]);
  if (!p) return send(404, {error: 'Publicación no encontrada'});
  if (m[2]) {
    p.status = p.scheduledAt ? 'scheduled' : 'processing';
    return send(200, view(p));
  }
  if (req.method === 'GET') {
    if (p.status === 'processing' && ++p.gets >= 2) p.status = 'published';
    return send(200, view(p));
  }
  if (req.method === 'PATCH') {
    p.scheduledAt = JSON.parse(raw.toString()).scheduledAt;
    return send(200, view(p));
  }
  if (req.method === 'DELETE') {
    p.status = 'canceled';
    return send(200, view(p));
  }
  send(405, {error: 'no'});
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
process.env.REEL_STUDIO_CLOUD_URL = base;
fs.mkdirSync(process.env.REEL_STUDIO_CONFIG_DIR, {recursive: true});
fs.writeFileSync(path.join(process.env.REEL_STUDIO_CONFIG_DIR, 'cloud.json'), JSON.stringify({token: 'tok', email: 'yo@x.co', userId: 42, deviceId: 'este'}));

const ws = await import('./workspace.ts');
const publish = await import('./publish.ts');
publish.timing.follow = 20;
publish.timing.retry = 5;
after(() => server.close());

const dir = path.join(root, 'projects', 'canal');
const video = path.join(dir, 'videos', 'mi-video');
fs.mkdirSync(path.join(video, 'out'), {recursive: true});
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({name: 'Canal', created: 1}));
fs.writeFileSync(path.join(video, 'out', 'mi-video.mp4'), Buffer.alloc(1234));
fs.writeFileSync(path.join(video, 'out', 'miniatura.jpg'), Buffer.alloc(56));
fs.writeFileSync(path.join(video, 'caption.md'), 'Guárdalo #ahorro\n');
ws.openProject('canal');
const link = path.join(dir, 'config', 'instagram.json');

const until = async (fn: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const records = () => JSON.parse(fs.readFileSync(path.join(video, 'publicaciones.json'), 'utf8')) as {id: string; status: string; scheduledAt: string | null; permalink: string | null}[];

beforeEach(() => {
  Object.assign(ctl, {old: false, putStatus: 0, n: ctl.n});
  ctl.pubs.clear();
  ctl.puts.clear();
  fs.rmSync(path.join(video, 'publicaciones.json'), {force: true});
  fs.mkdirSync(path.dirname(link), {recursive: true});
  fs.writeFileSync(link, JSON.stringify({accountId: 7, username: 'entiende.finanzas.ya'}));
});

test('now: uploads the video and its cover, then follows it until it is out', async () => {
  const r = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: null});
  assert.equal(r.status, 'uploading');
  const sent = ctl.pubs.get(r.id)!.body;
  assert.deepEqual([sent.accountId, sent.size, sent.caption, sent.coverSize, sent.shareToFeed], [7, 1234, 'Guárdalo #ahorro', 56, true]);
  await until(() => records()[0].status === 'published');
  assert.equal(ctl.puts.get(`${r.id}.mp4`), 1234);
  assert.equal(ctl.puts.get(`${r.id}.jpg`), 56);
  assert.equal(records()[0].permalink, `https://www.instagram.com/reel/R${r.id}code/`);
});

test('once out, it goes into Mi cuenta at once (when Mi cuenta follows that account), without touching one it has', async () => {
  const mine = path.join(dir, 'account', 'entiende.finanzas.ya');
  fs.writeFileSync(path.join(dir, 'config', 'account.json'), JSON.stringify({username: 'entiende.finanzas.ya'}));
  const r = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: null});
  const reel = path.join(mine, `R${r.id}code`);
  await until(() => fs.existsSync(path.join(reel, 'thumb.jpg')));
  const saved = JSON.parse(fs.readFileSync(path.join(reel, 'reel.json'), 'utf8'));
  assert.deepEqual([saved.code, saved.url, saved.caption, saved.views], [`R${r.id}code`, `https://www.instagram.com/reel/R${r.id}code/`, 'Guárdalo #ahorro', null]);

  // One Mi cuenta already downloaded stays as it is.
  fs.writeFileSync(path.join(reel, 'reel.json'), JSON.stringify({...saved, views: 99}));
  await publish.list('mi-video');
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(JSON.parse(fs.readFileSync(path.join(reel, 'reel.json'), 'utf8')).views, 99);
  fs.rmSync(path.join(dir, 'config', 'account.json'));
  fs.rmSync(path.join(dir, 'account'), {recursive: true});
});

test('scheduled: waits in the account, and can be moved and canceled', async () => {
  const at = new Date(Date.now() + 3600_000).toISOString();
  const r = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: at, shareToFeed: false});
  assert.equal(r.scheduledAt, at);
  await until(() => records()[0].status === 'scheduled');
  assert.equal(ctl.pubs.get(r.id)!.body.shareToFeed, false);

  const later = new Date(Date.now() + 7200_000).toISOString();
  assert.equal((await publish.reschedule('mi-video', r.id, later))!.scheduledAt, later);
  assert.equal((await publish.cancel('mi-video', r.id))!.status, 'canceled');
  const view = await publish.list('mi-video');
  assert.deepEqual([view.account, view.cover, view.items[0].status], ['entiende.finanzas.ya', true, 'canceled']);
});

test('the calendar lists the publications of every video on their day, without the canceled ones', async () => {
  fs.writeFileSync(path.join(video, 'title.txt'), 'Mi video\n');
  const at = new Date(Date.now() + 3600_000).toISOString();
  const kept = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: at});
  const gone = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: at});
  await until(() => records().every((r) => r.status === 'scheduled'));
  await publish.cancel('mi-video', gone.id);
  const cal = await publish.calendar();
  assert.deepEqual(cal.map((p) => [p.id, p.slug, p.title, p.at, p.status, p.caption]), [[kept.id, 'mi-video', 'Mi video', at, 'scheduled', 'Guárdalo #ahorro']]);
  assert.match(cal[0].cover!, /^\/files\/mi-video\/out\/miniatura\.jpg\?v=/);
  fs.rmSync(path.join(video, 'title.txt'));
});

test('a server that does not schedule gets nothing uploaded (it would publish at once)', async () => {
  ctl.old = true;
  await assert.rejects(publish.publish('mi-video', {version: 'mi-video', scheduledAt: new Date(Date.now() + 3600_000).toISOString()}), /aún no permite programar/);
  assert.equal(ctl.puts.size, 0);
  assert.equal(fs.existsSync(path.join(video, 'publicaciones.json')), false);
});

test('a failed upload says so, and a scheduled one is called off in the account', async () => {
  ctl.putStatus = 403;
  const r = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: new Date(Date.now() + 3600_000).toISOString()});
  await until(() => records()[0].status === 'error');
  await until(() => ctl.pubs.get(r.id)!.status === 'canceled');
});

test('no account chosen, a missing version or a bad one stop before anything is sent', async () => {
  await assert.rejects(publish.publish('mi-video', {version: 'otra'}), /ya no está/);
  await assert.rejects(publish.publish('mi-video', {version: '../x'}), /elige una versión/);
  fs.rmSync(link);
  await assert.rejects(publish.publish('mi-video', {version: 'mi-video'}), /cuenta de Instagram/);
  assert.equal(ctl.pubs.size, 0);
});

test('one record the calendar cannot read does not take the calendar down, and stays in the file', async () => {
  const at = new Date(Date.now() + 3600_000).toISOString();
  const ok = await publish.publish('mi-video', {version: 'mi-video', scheduledAt: at});
  await until(() => records()[0].status === 'scheduled');
  // A record written by hand or by another version: no createdAt nor status.
  const odd = {id: 'viejo', version: 'mi-video', account: 'entiende.finanzas.ya', scheduledAt: null};
  fs.writeFileSync(path.join(video, 'publicaciones.json'), JSON.stringify([...records(), odd]));
  const cal = await publish.calendar();
  assert.deepEqual(cal.map((p) => p.id), [ok.id]);
  assert.deepEqual((await publish.list('mi-video')).items.map((p) => p.id), [ok.id]);
  await publish.cancel('mi-video', ok.id); // rewrites the file
  assert.ok(records().some((r) => r.id === 'viejo'));
});
