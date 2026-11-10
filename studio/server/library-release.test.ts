// The library card's line under the hook (summary.release): published and when, scheduled and for when, on its way,
// or finished and not sent yet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {PostedReel, VideoPublication} from '../shared/types.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-library-release-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

const ws = await import('./workspace.ts');
const reels = await import('./reels.ts');

const pub = (status: VideoPublication['status'], scheduledAt: string | null, createdAt = '2026-11-01T10:00:00.000Z'): VideoPublication => ({
  id: `${status}-${scheduledAt}-${createdAt}`,
  version: 'v',
  account: 'canal',
  scheduledAt,
  createdAt,
  status,
  error: null,
  permalink: null,
});
const posted: PostedReel = {code: 'ABC', url: 'https://www.instagram.com/reel/ABC/', views: 10, ratio: 1, posted: '2026-10-20T15:00:00.000Z'};

test('a finished video not sent yet is ready; an unfinished one shows nothing', () => {
  assert.deepEqual(reels.releaseOf([], null, true), {state: 'ready', at: null});
  assert.equal(reels.releaseOf([], null, false), null);
  // Canceled or failed ones don't count as sent.
  assert.deepEqual(reels.releaseOf([pub('canceled', '2026-12-01T10:00:00.000Z'), pub('error', null)], null, true), {state: 'ready', at: null});
});

test('published: when it went out (its scheduled time, or when it was sent), the latest one', () => {
  assert.deepEqual(reels.releaseOf([pub('published', null, '2026-11-02T09:00:00.000Z'), pub('published', '2026-11-05T18:00:00.000Z')], null, true), {
    state: 'published',
    at: '2026-11-05T18:00:00.000Z',
  });
  // Posted outside the app: Mi cuenta knows it, with its date.
  assert.deepEqual(reels.releaseOf([], posted, false), {state: 'published', at: '2026-10-20T15:00:00.000Z'});
  assert.deepEqual(reels.releaseOf([], {...posted, posted: null}, true), {state: 'published', at: null});
});

test('scheduled: for its time, the nearest one, ahead of one already out', () => {
  const r = reels.releaseOf([pub('scheduled', '2026-12-09T18:00:00.000Z'), pub('scheduled', '2026-12-02T18:00:00.000Z'), pub('published', null)], posted, true);
  assert.deepEqual(r, {state: 'scheduled', at: '2026-12-02T18:00:00.000Z'});
  // Still uploading, for a time: scheduled too.
  assert.deepEqual(reels.releaseOf([pub('uploading', '2026-12-02T18:00:00.000Z')], null, true), {state: 'scheduled', at: '2026-12-02T18:00:00.000Z'});
});

test('on its way: sent for now, or its time came and Instagram is taking it', () => {
  assert.deepEqual(reels.releaseOf([pub('uploading', null)], null, true), {state: 'publishing', at: null});
  assert.deepEqual(reels.releaseOf([pub('processing', '2026-11-02T18:00:00.000Z'), pub('scheduled', '2026-12-02T18:00:00.000Z')], null, true), {state: 'publishing', at: null});
});

test('the summary reads publicaciones.json, and a record it cannot read does not break the card', () => {
  const dir = path.join(root, 'projects', 'canal');
  const video = path.join(dir, 'videos', 'mi-video');
  fs.mkdirSync(video, {recursive: true});
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({name: 'Canal', created: 1}));
  ws.openProject('canal');
  assert.equal(reels.summary('mi-video').release, null, 'nothing done yet');
  fs.writeFileSync(path.join(video, 'publicaciones.json'), JSON.stringify([{id: 'x', status: 'published'}, pub('scheduled', '2026-12-02T18:00:00.000Z')]));
  assert.deepEqual(reels.summary('mi-video').release, {state: 'scheduled', at: '2026-12-02T18:00:00.000Z'});
  fs.writeFileSync(path.join(video, 'publicaciones.json'), '{no es json');
  assert.equal(reels.summary('mi-video').release, null);
});
