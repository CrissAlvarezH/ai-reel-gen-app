// The running server, as the agents' tools and curl see it: a temp workspace, its own port, no cloud.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-api-'));
fs.mkdirSync(path.join(root, 'ws/projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'ws/projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

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
after(() => {
  server?.kill('SIGTERM');
  fs.rmSync(root, {recursive: true, force: true});
});

test('an /api route that does not exist answers 404 in JSON, not the app page', async () => {
  for (const [method, p] of [
    ['GET', '/api/no-existe'],
    ['GET', '/api/reels/x/hookcheck?format=text'],
    ['GET', '/api/chat/_general/abc/move'],
    ['POST', '/api/no-existe'],
  ]) {
    const r = await fetch(url + p, {method, headers: {'Content-Type': 'application/json'}, body: method === 'POST' ? '{}' : undefined});
    assert.equal(r.status, 404, `${method} ${p}`);
    assert.match(r.headers.get('content-type') ?? '', /application\/json/, `${method} ${p}`);
    const body = (await r.json()) as {error?: string};
    assert.match(body.error ?? '', /no existe/, `${method} ${p}`);
  }
  // The routes that exist still answer, and the app's pages are still the app.
  assert.equal((await fetch(`${url}/api/reels`)).status, 200);
  assert.match(await (await fetch(`${url}/biblioteca`)).text(), /<!doctype html>/i);
});
