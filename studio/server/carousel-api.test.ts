// Videos and carousels as the running server shows them: one list of publications, each its own routes, a carousel's
// editor calls and its export. Temp workspace, its own port, no cloud, no agent.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {after, before, test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-carousel-api-'));
const videos = path.join(root, 'ws/projects/p/videos');
fs.mkdirSync(videos, {recursive: true});
fs.writeFileSync(path.join(root, 'ws/projects/p/project.json'), JSON.stringify({name: 'QA Publicaciones', created: 1}));
const write = (p: string, s: string | Buffer) => (fs.mkdirSync(path.dirname(p), {recursive: true}), fs.writeFileSync(p, s));

function png(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}

// A video from before carousels (no kind.txt), older; a carousel with one version, newer.
write(path.join(videos, 'video-viejo/audio/vo.txt'), 'Un guion de prueba para el video.\n');
const old = new Date(Date.now() - 86_400_000);
fs.utimesSync(path.join(videos, 'video-viejo/audio/vo.txt'), old, old);
const c = path.join(videos, 'carrusel-qa');
write(path.join(c, 'kind.txt'), 'carousel\n');
write(path.join(c, 'title.txt'), 'Carrusel QA\n');
const slides = [
  {id: 'portada', title: 'Portada', text: 'Uno'},
  {id: 'medio', title: 'Medio', text: 'Dos'},
];
write(path.join(c, 'carousel.json'), JSON.stringify({width: 1080, height: 1350, slides}));
for (const s of slides) write(path.join(c, `src/slides/${s.id}.tsx`), 'export default () => null;\n');
for (const [i] of slides.entries()) write(path.join(c, `out/v1/0${i + 1}.png`), png(1080, 1350));
write(path.join(c, 'out/v1/version.json'), JSON.stringify({name: 'v1', created: Date.now(), width: 1080, height: 1350, slides: slides.map((s, i) => ({...s, file: `0${i + 1}.png`, source: null}))}));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const {port} = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

let url = '';
let server: ReturnType<typeof spawn>;
before(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, 'index.ts')], {
    env: {...process.env, PORT: String(port), HOST: '127.0.0.1', REEL_STUDIO_WORKSPACE: path.join(root, 'ws'), REEL_STUDIO_CONFIG_DIR: path.join(root, 'cfg'), REEL_STUDIO_CLOUD_URL: 'http://127.0.0.1:9'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`el servidor no arrancó:\n${out}`)), 30_000);
    const read = (d: Buffer) => {
      out += d;
      if (out.includes('Reel Studio →')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout!.on('data', read);
    server.stderr!.on('data', read);
  });
});
after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const gone = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
  }
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
});

const json = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(url + p, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> & {error?: string}};
};

test('one list of publications, newest first, each saying what it is', async () => {
  const {body} = await json('GET', '/api/reels');
  const list = body as unknown as {slug: string; kind: string; slideCount: number | null; thumb: string | null}[];
  assert.deepEqual(list.map((r) => [r.slug, r.kind, r.slideCount]), [['carrusel-qa', 'carousel', 2], ['video-viejo', 'video', null]]);
  assert.equal(list[0].thumb, '/files/carrusel-qa/out/v1/01.png');
  assert.equal((await fetch(url + list[0].thumb)).status, 200);
});

test('a video keeps its routes and is not a carousel; a carousel has its own', async () => {
  const v = await json('GET', '/api/reels/video-viejo');
  assert.equal(v.status, 200);
  assert.equal(v.body.kind, 'video');
  assert.equal((await json('GET', '/api/carousels/video-viejo')).status, 404);
  assert.equal((await json('PUT', '/api/carousels/video-viejo/order', {order: []})).status, 404);
  const d = await json('GET', '/api/carousels/carrusel-qa');
  assert.equal(d.status, 200);
  assert.equal(d.body.width, 1080);
  assert.equal(d.body.height, 1350);
  assert.deepEqual((d.body.slides as {id: string}[]).map((s) => s.id), ['portada', 'medio']);
  assert.deepEqual((d.body.versions as {name: string}[]).map((s) => s.name), ['v1']);
});

test('the editor reorders, adds, duplicates and removes, and the order is kept', async () => {
  assert.equal((await json('PUT', '/api/carousels/carrusel-qa/order', {order: ['medio']})).status, 400);
  const r = await json('PUT', '/api/carousels/carrusel-qa/order', {order: ['medio', 'portada']});
  assert.deepEqual((r.body.slides as {id: string}[]).map((s) => s.id), ['medio', 'portada']);
  const dup = await json('POST', '/api/carousels/carrusel-qa/slides', {duplicate: 'portada'});
  assert.equal(dup.body.id, 'portada-2');
  const add = await json('POST', '/api/carousels/carrusel-qa/slides', {after: 'medio'});
  assert.equal(add.body.id, 'lamina');
  for (const id of ['portada-2', 'lamina']) assert.equal((await json('DELETE', `/api/carousels/carrusel-qa/slides/${id}`)).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(c, 'carousel.json'), 'utf8')) as {slides: {id: string}[]};
  assert.deepEqual(saved.slides.map((s) => s.id), ['medio', 'portada']);
  // Without its packages installed it can't render, and says so instead of failing half way.
  assert.equal((await json('POST', '/api/carousels/carrusel-qa/render', {})).status, 409);
});

test('export: a zip of the version\'s numbered images; an unknown version is refused', async () => {
  const r = await fetch(`${url}/api/carousels/carrusel-qa/export?version=v1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition') ?? '', /carrusel-qa-v1\.zip/);
  const zip = Buffer.from(await r.arrayBuffer());
  assert.ok(zip.includes(Buffer.from('carrusel-qa-v1/01.png')) && zip.includes(Buffer.from('carrusel-qa-v1/02.png')));
  assert.equal((await fetch(`${url}/api/carousels/carrusel-qa/export?version=v7`)).status, 404);
});

test('a carousel is published like a video (here, without a version it says so); deleting it removes only it', async () => {
  const p = await json('POST', '/api/reels/carrusel-qa/publications', {when: 'now'});
  assert.equal(p.status, 400);
  assert.match(p.body.error ?? '', /elige una versión/);
  assert.equal((await json('DELETE', '/api/reels/carrusel-qa')).status, 200);
  const {body} = await json('GET', '/api/reels');
  assert.deepEqual((body as unknown as {slug: string}[]).map((r) => r.slug), ['video-viejo']);
});
