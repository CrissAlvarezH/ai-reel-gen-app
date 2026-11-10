// When a video was created (created.txt): written as it's made, estimated once for older videos, in its summary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-created-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

const ws = await import('./workspace.ts');
const reels = await import('./reels.ts');
const {createdOf} = await import('./created.ts');
const {scaffold} = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../scripts/new-video.mjs')).href);

const project = path.join(root, 'projects', 'canal');
fs.mkdirSync(path.join(project, 'videos'), {recursive: true});
fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({name: 'Canal', created: 1}));
ws.openProject('canal');
const read = (dir: string) => fs.readFileSync(path.join(dir, 'created.txt'), 'utf8').trim();

test('a new video gets its created.txt as it is made', () => {
  fs.mkdirSync(path.join(root, 'tpl'), {recursive: true});
  fs.writeFileSync(path.join(root, 'tpl', 'render.sh'), '');
  const before = Date.now();
  const dir = scaffold({root, project, slug: 'nuevo', style: 'base', template: 'tpl'});
  const at = Date.parse(read(dir));
  assert.ok(at >= before - 1000 && at <= Date.now(), `${read(dir)} is now`);
  assert.equal(createdOf(dir), at);
  assert.equal(reels.summary('nuevo').created, at);
});

test('an older video without it gets the earliest time its files show, written once', () => {
  const dir = path.join(project, 'videos', 'viejo');
  fs.mkdirSync(path.join(dir, 'audio'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'audio', 'vo.txt'), 'Guion.');
  fs.writeFileSync(path.join(dir, 'style.txt'), 'base\n');
  const old = new Date('2026-03-04T05:06:07.000Z');
  fs.utimesSync(path.join(dir, 'style.txt'), old, old);
  assert.equal(createdOf(dir), old.getTime());
  assert.equal(read(dir), old.toISOString(), 'kept in the folder, so it travels with the sync');
  // From then on the file says it, whatever the files do.
  fs.utimesSync(path.join(dir, 'style.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  assert.equal(reels.summary('viejo').created, old.getTime());
});

test('one that cannot be read is estimated again; a folder that is gone has none', () => {
  const dir = path.join(project, 'videos', 'roto');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'created.txt'), 'ayer\n');
  const at = createdOf(dir);
  assert.ok(at && at <= Date.now());
  assert.equal(read(dir), new Date(at!).toISOString());
  assert.equal(createdOf(path.join(project, 'videos', 'no-existe')), null);
});
