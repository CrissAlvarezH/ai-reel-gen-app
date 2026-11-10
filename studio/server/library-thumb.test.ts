// The library card's picture (summary.thumb): the video's cover (out/miniatura.*) when it has one, else a board still, else a cutout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-library-thumb-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

const ws = await import('./workspace.ts');
const reels = await import('./reels.ts');

const dir = path.join(root, 'projects', 'canal');
const video = path.join(dir, 'videos', 'mi-video');
const put = (rel: string) => {
  fs.mkdirSync(path.dirname(path.join(video, rel)), {recursive: true});
  fs.writeFileSync(path.join(video, rel), Buffer.alloc(8));
};
fs.mkdirSync(video, {recursive: true});
fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({name: 'Canal', created: 1}));
ws.openProject('canal');

const thumb = () => reels.summary('mi-video').thumb;

test('without pictures the card has none', () => {
  assert.equal(thumb(), null);
});

test('a cutout, then a board still, stand in while there is no cover', () => {
  put('public/cut/persona.png');
  assert.equal(thumb(), '/files/mi-video/public/cut/persona.png');
  put('out/board-1/t4.5.png');
  assert.equal(thumb(), '/files/mi-video/out/board-1/t4.5.png');
});

test('the cover wins as soon as it exists, and its url changes when it is rendered again', () => {
  put('out/miniatura.png');
  const first = thumb();
  assert.match(first ?? '', /^\/files\/mi-video\/out\/miniatura\.png\?v=\d+$/);
  assert.equal(reels.coverUrl('mi-video'), first, 'publishing sends the same picture');
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(video, 'out/miniatura.png'), later, later);
  assert.notEqual(thumb(), first, 'a new mtime makes the browser fetch it again');
});

test('a .jpg or .webp cover counts too, and without it the board still comes back', () => {
  fs.rmSync(path.join(video, 'out/miniatura.png'));
  put('out/miniatura.webp');
  assert.match(thumb() ?? '', /^\/files\/mi-video\/out\/miniatura\.webp\?v=\d+$/);
  fs.rmSync(path.join(video, 'out/miniatura.webp'));
  assert.equal(thumb(), '/files/mi-video/out/board-1/t4.5.png');
});
