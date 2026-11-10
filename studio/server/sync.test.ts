// Sync against a fake cloud (server/sync-fake-cloud.ts) in a temp workspace. Two project folders linked to the same
// project in the account play the two computers.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, beforeEach, test} from 'node:test';
import type {SyncGroupId} from '../shared/types.ts';
import {fakeCloud, type FakeProject} from './sync-fake-cloud.ts';
import {GROUPS, classify, parseScope} from './sync-rules.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-sync-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

const fake = fakeCloud();
const base = await fake.listen();
process.env.REEL_STUDIO_CLOUD_URL = base;
fs.mkdirSync(process.env.REEL_STUDIO_CONFIG_DIR, {recursive: true});
fs.writeFileSync(path.join(process.env.REEL_STUDIO_CONFIG_DIR, 'cloud.json'), JSON.stringify({token: 'tok', email: 'yo@x.co', userId: 42, deviceId: 'este-equipo'}));

const ws = await import('./workspace.ts');
const cloud = await import('./cloud.ts');
const engine = await import('./sync.ts');
const queue = await import('./sync-queue.ts');
queue.timing.groupWait = 150;
queue.timing.maxWait = 2000;
queue.timing.renderWait = 100;
queue.timing.retries = [120, 240, 480];
queue.timing.statusCache = 0;
engine.tuning.putRetries = [5, 10, 20];

after(async () => {
  queue.stopSync();
  await fake.close();
});

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const write = (dir: string, rel: string, content: string | Buffer, mtime?: number) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, content);
  if (mtime) fs.utimesSync(abs, mtime / 1000, mtime / 1000);
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir: string, rel: string) => fs.existsSync(path.join(dir, rel));
const until = async (fn: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let n = 0;
let cp: FakeProject;
let A: string;
let B: string;
let idA: string;
let idB: string;

function linkProject(id: string, cloudId: string) {
  const dir = path.join(root, 'projects', id);
  fs.mkdirSync(path.join(dir, '.reel-studio'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({name: id, created: 1000 + n}));
  fs.writeFileSync(path.join(dir, '.reel-studio/cloud.json'), JSON.stringify({cloudId, userId: 42, server: base, linkedAt: 1, localOnly: false}));
  return dir;
}

beforeEach(() => {
  n++;
  queue.stopSync();
  for (const p of fs.readdirSync(path.join(root, 'projects'))) fs.rmSync(path.join(root, 'projects', p), {recursive: true, force: true});
  fake.projects.clear();
  fake.blobs.clear();
  fake.log.length = 0;
  fake.ctl.down = false;
  fake.ctl.quotaFull = false;
  fake.ctl.fetchLimit = 3_000_000;
  fake.ctl.onFetch = null;
  fake.ctl.corrupt.clear();
  fake.ctl.extraEntries.length = 0;
  fake.ctl.putHeaders.length = 0;
  fake.ctl.putStatus = 0;
  fake.ctl.onPut = null;
  fake.ctl.apiStatus = 0;
  fake.ctl.commitReject.clear();
  fake.ctl.downAfterCommits = 0;
  fake.resetPuts();
  const cloudId = randomUUID();
  cp = fake.addProject(cloudId, 'canal', 'Canal');
  idA = `a${n}`;
  idB = `b${n}`;
  A = linkProject(idA, cloudId);
  B = linkProject(idB, cloudId);
  ws.openProject(idA);
  queue.configure({send: () => {}, videoBusy: () => false});
});

const ctx = (dir: string, over: Partial<Parameters<typeof engine.runCycle>[0]> = {}) => ({dir, channel: 'project' as const, cloudId: cp.id, scope: {kind: 'full' as const}, active: new Set<SyncGroupId>(GROUPS), ...over});
const sync = (dir: string, over: Partial<Parameters<typeof engine.runCycle>[0]> = {}) => engine.runCycle(ctx(dir, over));
const stateOf = (dir: string) => engine.loadState(dir, 'project', cp.id);
const commits = () => fake.log.filter((l) => l.url.endsWith('/commit')).length;

/* ───── The list ───── */

test('the allow-list: what goes and what never goes', () => {
  for (const ok of ['ideas.json', 'config/profile.json', 'videos/a/audio/vo.mp3', 'videos/a/public/words.json', 'videos/a/public/mix.wav', 'account/u/abc/reel.json', 'inspiration/u/abc/sheet_01.jpg', 'inspiration/u/abc/sheet_100.jpg', 'sources/items/x.md', 'avatar.png']) assert.ok(classify(ok, 'project'), ok);
  for (const no of ['.env', 'videos/a/.env', 'videos/a/.env.local', 'config/instagram.json', 'config/chrome.json', 'project.json', 'videos/a/node_modules/x/y.js', 'videos/a/out/v1.mp4', 'videos/a/footage/c.mp4', 'videos/a/public/vo.wav', 'videos/a/public/mix.raw.wav', 'videos/a/public/footage.mp4', 'videos/a/x.raw.mp4', 'videos/a/src/__pycache__/a.pyc', 'videos/a/x.tmp', 'inspiration/u/abc/video.mp4', 'inspiration/u/abc/audio.wav', '.reel-studio/chats/a.json', 'ideas.antes.json', '../fuera', 'videos/../../fuera', '/abs', 'videos/a\\b'])
    assert.equal(classify(no, 'project'), null, no);
  assert.equal(classify('styles/mio/style.json', 'shared', new Set())?.group, 'styles');
  assert.equal(classify('styles/plano/style.json', 'shared', new Set(['styles/plano'])), null);
  assert.equal(classify('styles/mio/out/x.png', 'shared'), null);
  assert.equal(parseScope('video:../x'), null);
  assert.equal(parseScope('group:nada'), null);
  assert.deepEqual(parseScope('group:ideas'), {kind: 'group', group: 'ideas'});
});

/* ───── The protocol ───── */

test('first sync uploads what is listed and nothing else', async () => {
  write(A, 'ideas.json', '{"lists":[]}');
  write(A, 'videos/v/audio/vo.mp3', Buffer.alloc(2000, 7));
  write(A, 'videos/v/node_modules/x/a.js', 'no');
  write(A, 'videos/v/out/v1.mp4', 'no');
  write(A, 'videos/v/.env', 'SECRETO=1');
  write(A, 'config/instagram.json', '{}');
  fs.symlinkSync('/etc/hosts', path.join(A, 'videos/v/enlace'));
  const r = await sync(A);
  assert.equal(r.uploaded, 2);
  assert.deepEqual([...cp.entries.keys()].sort(), ['ideas.json', 'videos/v/audio/vo.mp3']);
  assert.ok(fake.blobs.has(sha(Buffer.alloc(2000, 7))));
  assert.equal(fake.ctl.putHeaders[0]['content-length'], '2000', 'S3 needs the length up front');
  const st = stateOf(A);
  assert.equal(st.files['ideas.json'].rev, 1);
  assert.equal(st.baseRev, cp.rev);
});

test('what one computer changes reaches the other, with its date, and is not seen as a change there', async () => {
  write(A, 'ideas.json', '{"a":1}', 1_700_000_000_000);
  write(A, 'videos/v/audio/vo.mp3', Buffer.alloc(500, 1), 1_700_000_001_000);
  await sync(A);
  const r = await sync(B);
  assert.equal(r.downloaded, 2);
  assert.equal(read(B, 'ideas.json'), '{"a":1}');
  assert.equal(Math.round(fs.statSync(path.join(B, 'ideas.json')).mtimeMs), 1_700_000_000_000);
  const before = commits();
  const again = await sync(B);
  assert.equal(commits(), before, 'nothing to upload');
  assert.equal(again.downloaded, 0);
});

test('no temporary files stay after landing', async () => {
  write(A, 'videos/v/a.txt', 'x');
  await sync(A);
  await sync(B);
  assert.deepEqual(fs.readdirSync(path.join(B, 'videos/v')), ['a.txt']);
});

test('the older edit loses, and its copy is kept before the winner lands', async () => {
  write(A, 'ideas.json', '{"v":0}', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'ideas.json', '{"v":"nuevo"}', 1_700_000_100_000);
  write(B, 'ideas.json', '{"v":"viejo"}', 1_700_000_050_000);
  await sync(A);
  const r = await sync(B);
  assert.equal(read(B, 'ideas.json'), '{"v":"nuevo"}');
  const c = cp.conflicts.find((x) => x.status === 'open')!;
  assert.equal(read(B, `.reel-studio/conflicts/${c.id}/ideas.json`), '{"v":"viejo"}');
  assert.equal(r.downloaded, 1);
  await sync(B);
  assert.equal(read(B, 'ideas.json'), '{"v":"nuevo"}');
});

test('the newer edit wins even if it syncs later', async () => {
  write(A, 'ideas.json', '{"v":0}', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'ideas.json', '{"v":"viejo"}', 1_700_000_050_000);
  write(B, 'ideas.json', '{"v":"nuevo"}', 1_700_000_100_000);
  await sync(A);
  const r = await sync(B);
  assert.equal(r.conflicts, 1);
  assert.equal(cp.entries.get('ideas.json')!.content, '{"v":"nuevo"}');
  await sync(A);
  assert.equal(read(A, 'ideas.json'), '{"v":"nuevo"}');
});

test('a commit retried after its answer was lost is the same change', async () => {
  write(A, 'ideas.json', '{"v":1}', 1_700_000_000_000);
  await sync(A);
  const st = stateOf(A);
  st.files = {};
  engine.saveState(A, 'project', st);
  const r = await sync(A);
  assert.equal(r.uploaded, 0);
  assert.equal(cp.conflicts.length, 0);
  assert.equal(stateOf(A).files['ideas.json'].rev, 1);
});

test('a delete travels, and a deleted file can come back without a conflict', async () => {
  write(A, 'videos/v/a.txt', 'x', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  fs.rmSync(path.join(A, 'videos/v/a.txt'));
  await sync(A);
  assert.equal(cp.entries.get('videos/v/a.txt')!.deleted, true);
  const r = await sync(B);
  assert.equal(r.deleted, 1);
  assert.equal(exists(B, 'videos/v/a.txt'), false);
  write(B, 'videos/v/a.txt', 'otra vez', 1_700_000_200_000);
  await sync(B);
  assert.equal(cp.conflicts.length, 0);
});

test('mass deletes stop and ask, and go through once confirmed', async () => {
  for (let i = 0; i < 60; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  fs.rmSync(path.join(A, 'videos/v'), {recursive: true});
  const before = commits();
  const r = await sync(A);
  assert.equal(r.needsConfirm, 60);
  assert.equal(commits(), before, 'nothing went up');
  const ok = await sync(A, {confirmDeletes: true});
  assert.equal(ok.needsConfirm, null);
  assert.equal(ok.deleted, 60);
});

test('50 deletes or a small share of the files do not ask', async () => {
  for (let i = 0; i < 400; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  for (let i = 0; i < 70; i++) fs.rmSync(path.join(A, `videos/v/f${i}.txt`));
  const r = await sync(A);
  assert.equal(r.needsConfirm, null, '70 of 400 is under 20%');
  assert.equal(r.deleted, 70);
});

test('a file that changes during the cycle is not overwritten', async () => {
  write(A, 'videos/v/a.txt', 'nube', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'videos/v/a.txt', 'nube 2', 1_700_000_100_000);
  await sync(A);
  // Edited right when the cloud is answering: after the review, before the write.
  fake.ctl.onFetch = () => write(B, 'videos/v/a.txt', 'editado justo ahora', 1_700_000_200_000);
  const r = await sync(B);
  fake.ctl.onFetch = null;
  assert.equal(read(B, 'videos/v/a.txt'), 'editado justo ahora');
  assert.ok(r.skipped >= 1);
  await sync(B);
  assert.equal(cp.entries.get('videos/v/a.txt')!.sha256, sha('editado justo ahora'), 'it goes up the normal way next time');
});

test('a download that does not match its hash is refused', async () => {
  write(A, 'videos/v/a.txt', 'bueno');
  write(A, 'ideas.json', '{"bueno":1}');
  await sync(A);
  fake.ctl.corrupt.add(sha('bueno'));
  fake.ctl.corrupt.add(sha('{"bueno":1}'));
  const r = await sync(B);
  assert.equal(r.downloaded, 0);
  assert.equal(exists(B, 'videos/v/a.txt'), false);
  assert.equal(exists(B, 'ideas.json'), false);
  assert.ok(r.warnings.some((w) => w.includes('verificación')));
  assert.deepEqual(fs.readdirSync(path.join(B)).filter((n) => n.includes('synctmp')), []);
  // It's read again next time, once the cloud sends the right bytes.
  fake.ctl.corrupt.clear();
  const again = await sync(B);
  assert.equal(again.downloaded, 2);
});

test('paths from the cloud that leave the project or the list are ignored', async () => {
  const bad = (p: string) => ({path: p, rev: 9, sha256: 'a'.repeat(64), size: 1, mtime: 1, deleted: false, storage: 'doc' as const, content: 'x'});
  fake.ctl.extraEntries.push(bad('../../fuera.txt'), bad('.env'), bad('videos/v/.env'), bad('videos/v/node_modules/a.js'), bad('config/instagram.json'), bad('project.json'), bad('/etc/passwd'));
  const r = await sync(B);
  assert.equal(r.downloaded, 0);
  assert.equal(exists(B, '.env'), false);
  assert.equal(fs.existsSync(path.join(root, 'projects/fuera.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'fuera.txt')), false);
});

test('a symbolic link cannot take a write out of the project', async () => {
  const outside = fs.mkdtempSync(path.join(root, 'outside-'));
  write(A, 'videos/v/assets/a.txt', 'x');
  await sync(A);
  fs.mkdirSync(path.join(B, 'videos/v'), {recursive: true});
  fs.symlinkSync(outside, path.join(B, 'videos/v/assets'));
  await sync(B);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('automations travel without their runs, and an unattended run is not a change', async () => {
  write(A, 'automations.json', JSON.stringify({automations: [{id: 'x', name: 'Una'}], runs: [{id: 'r1'}]}));
  await sync(A);
  const stored = cp.entries.get('automations.json')!;
  assert.deepEqual(JSON.parse(stored.content!), {automations: [{id: 'x', name: 'Una'}]});
  write(B, 'automations.json', JSON.stringify({automations: [], runs: [{id: 'solo-b'}]}), 1);
  await sync(B);
  assert.deepEqual(JSON.parse(read(B, 'automations.json')), {automations: [{id: 'x', name: 'Una'}], runs: [{id: 'solo-b'}]});
  const before = commits();
  write(A, 'automations.json', JSON.stringify({automations: [{id: 'x', name: 'Una'}], runs: [{id: 'r1'}, {id: 'r2'}]}));
  await sync(A);
  assert.equal(commits(), before, 'only the runs changed');
});

test('a video with an agent working is skipped both ways and catches up afterwards', async () => {
  write(A, 'videos/v/a.txt', '1', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'videos/v/a.txt', '2', 1_700_000_100_000);
  write(B, 'videos/o/b.txt', 'otro');
  await sync(A);
  const r = await sync(B, {busyVideo: (s) => s === 'v'});
  assert.equal(read(B, 'videos/v/a.txt'), '1', 'not applied while the agent works');
  assert.ok(r.skipped >= 1);
  assert.ok(cp.entries.has('videos/o/b.txt'), 'the other video went up');
  write(A, 'videos/v/x.txt', 'agente', 1);
  const u = await sync(A, {busyVideo: (s) => s === 'v'});
  assert.equal(cp.entries.has('videos/v/x.txt'), false, 'not uploaded while the agent works');
  assert.ok(u.skipped >= 1);
  const later = await sync(B);
  assert.equal(read(B, 'videos/v/a.txt'), '2', 'the held change lands once the agent is done');
  assert.equal(later.downloaded >= 1, true);
});

test('fetch comes back in pieces when it passes the size limit', async () => {
  for (let i = 0; i < 5; i++) write(A, `config/${['profile', 'voice', 'audience', 'images', 'social'][i]}.json`, JSON.stringify({x: 'y'.repeat(1000)}));
  await sync(A);
  fake.ctl.fetchLimit = 1500;
  const r = await sync(B);
  assert.equal(r.downloaded, 5);
});

test('changes are read across pages', async () => {
  for (let i = 0; i < 20; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  fake.log.length = 0;
  const r = await sync(B);
  assert.equal(r.downloaded, 20);
});

test('a document too big for the cloud is skipped with a warning, not sent', async () => {
  write(A, 'ideas.json', JSON.stringify({x: 'y'.repeat(600 * 1024)}));
  write(A, 'config/profile.json', '{"p":1}');
  const r = await sync(A);
  assert.ok(r.warnings.some((w) => w.includes('512 KB')));
  assert.equal(cp.entries.has('ideas.json'), false);
  assert.equal(cp.entries.has('config/profile.json'), true);
});

/* ───── Scopes ───── */

test('a group job only touches its group and does not move the base', async () => {
  write(A, 'ideas.json', '{"i":1}');
  write(A, 'config/profile.json', '{"p":1}');
  const r = await sync(A, {scope: {kind: 'group', group: 'ideas'}});
  assert.equal(r.uploaded, 1);
  assert.deepEqual([...cp.entries.keys()], ['ideas.json']);
  assert.equal(stateOf(A).baseRev, 0);
  assert.equal(stateOf(A).files['ideas.json'].rev, 1);
  await sync(A);
  assert.equal(cp.entries.has('config/profile.json'), true);
  assert.equal(commits(), 2);
});

test('a video job only touches that video, and a later full resolves what it uploaded by hash', async () => {
  write(A, 'videos/a/x.txt', 'a');
  write(A, 'videos/b/y.txt', 'b');
  await sync(A, {scope: {kind: 'video', slug: 'a'}});
  assert.deepEqual([...cp.entries.keys()], ['videos/a/x.txt']);
  const before = fake.log.length;
  const r = await sync(A);
  assert.equal(r.uploaded, 1);
  assert.equal(r.downloaded, 0);
  assert.ok(fake.log.length > before);
});

test('a video job deletes only inside that video', async () => {
  write(A, 'videos/a/x.txt', 'a');
  write(A, 'videos/b/y.txt', 'b');
  await sync(A);
  fs.rmSync(path.join(A, 'videos/a/x.txt'));
  fs.rmSync(path.join(A, 'videos/b/y.txt'));
  await sync(A, {scope: {kind: 'video', slug: 'a'}});
  assert.equal(cp.entries.get('videos/a/x.txt')!.deleted, true);
  assert.equal(cp.entries.get('videos/b/y.txt')!.deleted, false);
});

test('a video job does not apply anything outside its scope', async () => {
  write(A, 'ideas.json', '{"i":1}');
  await sync(A);
  write(B, 'videos/b/x.txt', 'b');
  const r = await sync(B, {scope: {kind: 'video', slug: 'b'}});
  assert.equal(r.downloaded, 0);
  assert.equal(exists(B, 'ideas.json'), false);
});

const without = (...off: SyncGroupId[]) => new Set(GROUPS.filter((g) => !off.includes(g)));

test('a group that is off: not looked at, not uploaded, not applied, and never deleted in the account', async () => {
  write(A, 'videos/v/a.txt', 'a');
  write(A, 'ideas.json', '{"i":1}');
  await sync(A);
  await sync(B);
  // Nothing of the group is on this disk, as if the folder had gone.
  fs.rmSync(path.join(B, 'videos'), {recursive: true});
  write(B, 'videos/w/nuevo.txt', 'nuevo');
  write(A, 'videos/v/b.txt', 'mas');
  await sync(A);
  const before = commits();
  const r = await sync(B, {active: without('videos')});
  assert.equal(commits(), before, 'nothing was proposed for the group that is off');
  assert.equal(r.needsConfirm, null);
  assert.equal(cp.entries.get('videos/v/a.txt')!.deleted, false);
  assert.equal(cp.entries.has('videos/w/nuevo.txt'), false);
  assert.equal(exists(B, 'videos/v/a.txt'), false, 'nothing of it landed');
  assert.equal(exists(B, 'videos/v/b.txt'), false);
});

test('a group turned back on catches up with what happened while it was off', async () => {
  write(A, 'ideas.json', '{"v":1}', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'ideas.json', '{"v":2}', 1_700_000_100_000);
  await sync(A);
  await sync(B, {active: without('ideas')});
  assert.equal(read(B, 'ideas.json'), '{"v":1}');
  assert.deepEqual(stateOf(B).behind.includes('ideas'), true);
  write(A, 'config/profile.json', '{"p":1}');
  await sync(A);
  await sync(B);
  assert.equal(read(B, 'ideas.json'), '{"v":2}', 'not lost because the base moved while it was off');
  assert.equal(stateOf(B).behind.includes('ideas'), false);
});

test('a state from another project in the account is not used', async () => {
  write(A, 'ideas.json', '{"i":1}');
  await sync(A);
  assert.equal(engine.loadState(A, 'project', randomUUID()).baseRev, 0);
});

/* ───── The queue ───── */

const firstFull = (dir: string) => engine.saveState(dir, 'project', {...stateOf(dir), firstFullAt: 1});
const jobs = (dir: string) => queue.queueOf(path.basename(dir)).jobs;
const history = (dir: string) => queue.queueOf(path.basename(dir)).history;

// A job can't merge with one that's already going, so these first let each one fail and wait out a long backoff.
const parked = async (project: string, dir: string, scope: string) => {
  const j = queue.enqueue(project, scope);
  await until(() => jobs(dir).some((x) => x.id === j.id && x.state === 'pending' && x.attempts > 0));
  return j;
};

test('duplicates merge and a full absorbs the partials waiting', async () => {
  fake.ctl.down = true;
  const saved = queue.timing.retries;
  queue.timing.retries = [60_000];
  try {
    await parked(idA, A, 'group:ideas');
    await parked(idA, A, 'video:v');
    queue.enqueue(idA, 'group:ideas');
    queue.enqueue(idA, 'video:v');
    const scopes = () => jobs(A).map((j) => j.scope).sort();
    assert.deepEqual(scopes(), ['group:ideas', 'video:v']);
    await parked(idA, A, 'full');
    assert.deepEqual(scopes(), ['full']);
    queue.enqueue(idA, 'group:sources');
    assert.deepEqual(scopes(), ['full'], 'a waiting full already covers it');
  } finally {
    queue.timing.retries = saved;
  }
});

test('group:videos absorbs the waiting video jobs', async () => {
  fake.ctl.down = true;
  const saved = queue.timing.retries;
  queue.timing.retries = [60_000];
  try {
    await parked(idA, A, 'video:a');
    await parked(idA, A, 'video:b');
    queue.enqueue(idA, 'group:videos');
    assert.deepEqual(jobs(A).map((j) => j.scope).sort(), ['group:videos']);
  } finally {
    queue.timing.retries = saved;
  }
});

test('a job left running when the app closed goes back to pending', () => {
  fs.writeFileSync(path.join(A, '.reel-studio/sync-queue.json'), JSON.stringify({jobs: [{id: 'x1', scope: 'group:ideas', state: 'running', trigger: 'auto', created: 1, started: 2, ended: null, attempts: 0, nextAt: 0, waiting: null, error: null, confirmDeletes: false, deletes: 0, done: 3, total: 9, stats: null, warnings: []}], history: []}));
  fake.ctl.down = true;
  queue.startSync();
  const j = jobs(A)[0];
  assert.equal(j.state === 'pending' || j.state === 'running', true);
  assert.equal(j.done, 0);
});

test('without a network it stays pending, retrying with the backoff, and finishes when it comes back', async () => {
  fake.ctl.down = true;
  write(A, 'ideas.json', '{"i":1}');
  queue.enqueue(idA, 'full', {trigger: 'manual'});
  await until(() => jobs(A)[0]?.attempts === 1);
  const first = jobs(A)[0];
  assert.equal(first.state, 'pending');
  assert.equal(first.error, null);
  await until(() => jobs(A)[0]?.attempts === 2, 2000);
  fake.ctl.down = false;
  await until(() => history(A)[0]?.state === 'done', 3000);
  assert.equal(jobs(A).length, 0);
  assert.equal(cp.entries.has('ideas.json'), true);
});

test('a refusal like the quota is an error with Reintentar', async () => {
  fake.ctl.quotaFull = true;
  write(A, 'videos/v/a.txt', 'x');
  queue.enqueue(idA, 'full', {trigger: 'manual'});
  await until(() => history(A)[0]?.state === 'error');
  assert.match(history(A)[0].error!, /espacio/);
  fake.ctl.quotaFull = false;
  queue.retry(idA, history(A)[0].id);
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.entries.has('videos/v/a.txt'), true);
});

test('only the last 20 finished are kept', async () => {
  for (let i = 0; i < 23; i++) {
    queue.enqueue(idA, 'full', {trigger: 'manual'});
    await until(() => !jobs(A).length);
  }
  assert.equal(history(A).length, 20);
});

test('a confirmation job asks once and runs when confirmed', async () => {
  for (let i = 0; i < 60; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  firstFull(A);
  fs.rmSync(path.join(A, 'videos/v'), {recursive: true});
  queue.runNow(idA, {scope: 'full'});
  await until(() => jobs(A)[0]?.state === 'confirm');
  assert.equal(jobs(A)[0].deletes, 60);
  queue.runNow(idA, {scope: 'full', confirmDeletes: true});
  await until(() => history(A)[0]?.state === 'done' && !jobs(A).length);
  assert.equal(cp.entries.get('videos/v/f0.txt')!.deleted, true);
});

test('cancelling a waiting job drops it', () => {
  fake.ctl.down = true;
  queue.enqueue(idB, 'group:ideas');
  const j = queue.enqueue(idA, 'group:ideas');
  queue.cancel(idA, j.id);
  assert.equal(jobs(A).some((x) => x.id === j.id && x.state === 'pending'), false);
});

test('the job ends in the project it started in, whichever one gets opened', async () => {
  write(A, 'ideas.json', '{"de":"a"}');
  write(A, 'videos/v/a.txt', 'x');
  ws.openProject(idA);
  queue.enqueue(idA, 'full', {trigger: 'manual'});
  ws.openProject(idB);
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.entries.get('ideas.json')!.content, '{"de":"a"}');
  assert.equal(exists(B, 'ideas.json'), false);
  assert.equal(ws.PROJECT, idB);
  assert.equal(jobs(B).length, 0);
});

test('a video job waits for its agent and then runs', async () => {
  write(A, 'videos/v/a.txt', 'x');
  await sync(A);
  firstFull(A);
  let agent = true;
  queue.configure({videoBusy: (_d, s) => s === 'v' && agent});
  write(A, 'videos/v/b.txt', 'y');
  queue.runNow(idA, {scope: 'video:v'});
  await sleep(120);
  assert.equal(jobs(A)[0]?.state, 'pending');
  assert.equal(cp.entries.has('videos/v/b.txt'), false);
  agent = false;
  queue.pump();
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.entries.has('videos/v/b.txt'), true);
});

test('the first full sync has to be started by hand', () => {
  assert.throws(() => queue.runNow(idA, {scope: 'group:ideas'}), /completa/);
});

/* ───── What enqueues ───── */

test('a write to ideas.json enqueues its group once, after the wait', async () => {
  await sync(A);
  firstFull(A);
  queue.startSync();
  write(A, 'ideas.json', '{"i":1}');
  write(A, 'ideas.json', '{"i":2}');
  await until(() => history(A)[0]?.scope === 'group:ideas' && history(A)[0]?.state === 'done');
  assert.equal(cp.entries.get('ideas.json')!.content, '{"i":2}');
  assert.equal(history(A).filter((j) => j.scope === 'group:ideas').length, 1);
});

test('an agent writing straight to disk counts too, in any project, open or not', async () => {
  ws.openProject(idB);
  await sync(A);
  firstFull(A);
  queue.startSync();
  fs.mkdirSync(path.join(A, 'sources'), {recursive: true});
  write(A, 'sources/sources.json', '{"sources":[]}');
  await until(() => history(A)[0]?.scope === 'group:sources');
  assert.equal(cp.entries.has('sources/sources.json'), true);
});

test('writes that are not content changes do not enqueue', async () => {
  write(A, 'automations.json', JSON.stringify({automations: [{id: 'x'}], runs: []}));
  await sync(A);
  firstFull(A);
  queue.startSync();
  write(A, 'automations.json', JSON.stringify({automations: [{id: 'x'}], runs: [{id: 'r1'}]}));
  await sleep(450);
  assert.equal(jobs(A).length + history(A).length, 0);
});

test('nothing is enqueued before the first full, with the group off, or local only', async () => {
  queue.startSync();
  write(A, 'ideas.json', '{"i":1}');
  await sleep(350);
  assert.equal(jobs(A).length, 0);

  await sync(A);
  firstFull(A);
  cloud.setSyncGroups(A, {ideas: false});
  queue.startSync();
  write(A, 'ideas.json', '{"i":2}');
  await sleep(350);
  assert.equal(jobs(A).length + history(A).length, 0);

  cloud.setSyncGroups(A, {ideas: true});
  cloud.setLocalOnly(idA, true);
  queue.refreshWatchers();
  write(A, 'ideas.json', '{"i":3}');
  await sleep(350);
  assert.equal(jobs(A).length + history(A).length, 0);
});

test('the working files of a video do not enqueue; finishing its render does', async () => {
  write(A, 'videos/v/audio/vo.txt', 'hola');
  await sync(A);
  firstFull(A);
  queue.startSync();
  write(A, 'videos/v/src/Scene.tsx', 'x');
  await sleep(250);
  assert.equal(jobs(A).length + history(A).length, 0, 'a save is not the video being finished');
  // render.sh: the raw first, the final next to it, and the raw deleted last.
  write(A, 'videos/v/out/v1.raw.mp4', 'raw');
  await sleep(40);
  write(A, 'videos/v/out/v1.mp4', 'final');
  await sleep(250);
  assert.equal(jobs(A).length + history(A).length, 0, 'still rendering while the raw is there');
  fs.rmSync(path.join(A, 'videos/v/out/v1.raw.mp4'));
  await until(() => history(A)[0]?.scope === 'video:v' && history(A)[0]?.state === 'done');
  assert.equal(cp.entries.has('videos/v/src/Scene.tsx'), true);
  assert.equal([...cp.entries.keys()].some((p) => p.includes('/out/')), false);
});

test('what a sync lands does not enqueue another sync', async () => {
  write(A, 'ideas.json', '{"i":1}', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  firstFull(B);
  queue.startSync();
  write(A, 'ideas.json', '{"i":2}', 1_700_000_100_000);
  await sync(A);
  await sync(B);
  await sleep(400);
  assert.equal(jobs(B).length + history(B).length, 0);
});

/* ───── Conflicts, primary, bringing a project over ───── */

test('Restaurar writes the other version as a new local change that goes up', async () => {
  write(A, 'ideas.json', '{"v":0}', 1_700_000_000_000);
  await sync(A);
  await sync(B);
  write(A, 'ideas.json', '{"v":"nuevo"}', 1_700_000_100_000);
  write(B, 'ideas.json', '{"v":"viejo"}', 1_700_000_050_000);
  await sync(A);
  await sync(B);
  firstFull(B);
  const [c] = await queue.conflicts(idB);
  assert.equal(c.path, 'ideas.json');
  await queue.restore(idB, c.id, 'project');
  assert.equal(read(B, 'ideas.json'), '{"v":"viejo"}');
  await until(() => history(B)[0]?.scope === 'group:ideas' && history(B)[0]?.state === 'done');
  assert.equal(cp.entries.get('ideas.json')!.content, '{"v":"viejo"}');
  assert.equal(cp.conflicts.find((x) => x.id === c.id)!.status, 'dismissed');
});

test('the first computer to sync claims the project; the others skip its automations', async () => {
  write(A, 'ideas.json', '{}');
  queue.enqueue(idA, 'full', {trigger: 'manual'});
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.primaryDeviceId, 'este-equipo');
  assert.equal(cloud.runsElsewhere(A), false);
  cp.primaryDeviceId = 'otro-equipo';
  queue.enqueue(idB, 'full', {trigger: 'manual'});
  await until(() => history(B)[0]?.state === 'done');
  assert.equal(cloud.runsElsewhere(B), true);
  await queue.primary(idB);
  assert.equal(cp.primaryDeviceId, 'este-equipo');
  assert.equal(cloud.runsElsewhere(B), false);
});

test('switches are saved in cloud.json and survive registering again under the same id', () => {
  cloud.setSyncGroups(A, {videos: false});
  assert.deepEqual(JSON.parse(read(A, '.reel-studio/cloud.json')).groups, {videos: false});
  assert.equal(cloud.syncGroups(A).has('videos'), false);
});

const projectFile = (folder: string) => path.join(root, 'projects', folder, 'project.json');

test('bringing a project over: it appears whole, or it does not appear', async () => {
  write(A, 'ideas.json', '{"i":1}');
  for (let i = 0; i < 5; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  const other = fake.addProject(randomUUID(), 'traido', 'Traído');
  other.entries = new Map(cp.entries);
  other.rev = cp.rev;
  // Cut off on the way: no project.json yet, so the app can't see it.
  fake.ctl.fetchLimit = 10;
  let downNext = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
    if (String(a[0]).includes('/sync/fetch') && downNext) {
      downNext = false;
      throw new TypeError('cortado');
    }
    return originalFetch(...a);
  }) as typeof fetch;
  await queue.clone(other.id);
  await until(() => !queue.partial(other.id)?.running);
  assert.equal(fs.existsSync(projectFile('traido')), false, 'not visible while it is incomplete');
  assert.equal(ws.listProjects().some((p) => p.id === 'traido'), false);
  globalThis.fetch = originalFetch;
  fake.ctl.fetchLimit = 3_000_000;
  await queue.clone(other.id);
  await until(() => fs.existsSync(projectFile('traido')));
  assert.equal(read(path.join(root, 'projects/traido'), 'ideas.json'), '{"i":1}');
  assert.ok(ws.listProjects().some((p) => p.id === 'traido'));
  assert.equal(engine.loadState(path.join(root, 'projects/traido'), 'project', other.id).baseRev, other.rev);
  assert.equal(other.primaryDeviceId, null, 'a project brought over does not claim it');
  // project.json shows up before the clone ends (refreshRemote still runs): until then a second clone returns the running one.
  await until(() => !queue.partial(other.id));
  await assert.rejects(queue.clone(other.id), /ya está/);
});

test('scripts arrive runnable: the sync carries no permissions, and render.sh has to run', async () => {
  write(A, 'videos/v/render.sh', '#!/bin/bash\necho hola\n');
  write(A, 'videos/v/title.txt', 'x');
  await sync(A);
  await sync(B);
  assert.ok(fs.statSync(path.join(B, 'videos/v/render.sh')).mode & 0o100, 'render.sh is executable');
  assert.equal(fs.statSync(path.join(B, 'videos/v/title.txt')).mode & 0o111, 0, 'and nothing else becomes so');
});

test('a project brought over knows another computer runs its automations', async () => {
  write(A, 'ideas.json', '{"i":1}');
  await sync(A);
  const other = fake.addProject(randomUUID(), 'con-principal', 'Con principal');
  other.entries = new Map(cp.entries);
  other.rev = cp.rev;
  other.primaryDeviceId = 'el-otro-equipo';
  await queue.clone(other.id);
  await until(() => fs.existsSync(projectFile('con-principal')));
  await until(() => !queue.partial(other.id));
  assert.equal(cloud.runsElsewhere(path.join(root, 'projects/con-principal')), true);
});

test('changes in a video an agent is working on stay as pending, not as synced', async () => {
  write(A, 'videos/v/a.txt', 'x');
  queue.runNow(idA, {scope: 'full'});
  await until(() => history(A)[0]?.state === 'done');
  assert.equal((await queue.detail(idA, false)).status.up, 0);
  queue.configure({videoBusy: (_d, s) => s === 'v'});
  assert.equal((await queue.detail(idA, false)).status.up, 0, 'being worked on is not a change by itself');
  write(A, 'videos/v/a.txt', 'cambiado');
  const d = await queue.detail(idA, false);
  assert.equal(d.status.up, 1);
  assert.equal(d.status.state, 'changes');
});

test('the storage failing with a 5xx sends the job back to wait, and what failed goes up on the retry', async () => {
  write(A, 'videos/v/a.txt', 'uno');
  write(A, 'ideas.json', '{"i":1}');
  fake.ctl.putStatus = 503;
  const saved = queue.timing.retries;
  queue.timing.retries = [60_000];
  try {
    queue.runNow(idA, {scope: 'full'});
    await until(() => jobs(A)[0]?.attempts === 1);
    assert.match(jobs(A)[0].waiting!, /almacenamiento falló \(503\)/);
    assert.equal(cp.entries.has('ideas.json'), true, 'what could go up, went up');
    assert.equal(cp.entries.has('videos/v/a.txt'), false);
  } finally {
    queue.timing.retries = saved;
    fake.ctl.putStatus = 0;
  }
  queue.retry(idA, jobs(A)[0].id);
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.entries.has('videos/v/a.txt'), true);
});

test('the account name goes up trimmed and comes back', async () => {
  const r = await cloud.setName('  Cristian  ');
  assert.equal(fake.ctl.userName, 'Cristian');
  assert.equal(r.user.name, 'Cristian');
  await cloud.setName('   ');
  assert.equal(fake.ctl.userName, null);
  const long = await cloud.setName('x'.repeat(200));
  assert.equal(long.user.name!.length, 120);
  await assert.rejects(cloud.setName(5), /nombre válido/);
});

test('a cycle that fails halfway keeps what it did', async () => {
  write(A, 'videos/v/a.txt', 'a');
  write(A, 'ideas.json', '{"i":1}');
  fake.ctl.quotaFull = true;
  await assert.rejects(sync(A), /espacio/);
  fake.ctl.quotaFull = false;
  await sync(A);
  assert.equal(cp.entries.size, 2);
});


/* ───── After the first real sync: telling what happened, and not starting over ───── */

const quietly = async <T,>(fn: (lines: string[]) => Promise<T>) => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    return await fn(lines);
  } finally {
    console.warn = original;
  }
};
const parkedRetries = async (fn: () => Promise<void>) => {
  const saved = queue.timing.retries;
  queue.timing.retries = [60_000];
  try {
    await fn();
  } finally {
    queue.timing.retries = saved;
  }
};

test('a storage 5xx says the storage failed, keeps the cause and never the presigned URL', () =>
  quietly((lines) =>
    parkedRetries(async () => {
      write(A, 'videos/v/a.txt', 'uno');
      fake.ctl.putStatus = 503;
      queue.runNow(idA, {scope: 'full'});
      await until(() => jobs(A)[0]?.attempts === 1);
      const j = jobs(A)[0];
      assert.match(j.waiting!, /almacenamiento falló \(503\)/);
      assert.doesNotMatch(j.waiting!, /Sin conexión/);
      assert.deepEqual({where: j.cause?.where, kind: j.cause?.kind, status: j.cause?.status, path: j.cause?.path}, {where: 'storage', kind: 'server', status: 503, path: 'videos/v/a.txt'});
      assert.ok(lines.some((l) => l.includes('503') && l.includes('videos/v/a.txt')), 'it is in the log');
      assert.equal([...lines, read(A, '.reel-studio/sync-queue.json')].some((l) => l.includes('SECRETO') || l.includes('X-Amz')), false);
    }),
  ));

test('a cut on the way to the storage says so, with the real code', () =>
  quietly(() =>
    parkedRetries(async () => {
      write(A, 'videos/v/a.txt', 'uno');
      fake.ctl.onPut = () => 'cut';
      queue.runNow(idA, {scope: 'full'});
      await until(() => jobs(A)[0]?.attempts === 1);
      const j = jobs(A)[0];
      assert.match(j.waiting!, /Sin conexión con el almacenamiento/);
      assert.equal(j.cause?.kind, 'network');
      assert.equal(j.cause?.path, 'videos/v/a.txt');
      assert.ok(j.cause?.code, 'cause.code is kept');
    }),
  ));

test('the cloud not answering says no connection; the cloud failing says the server failed', () =>
  quietly(() =>
    parkedRetries(async () => {
      write(A, 'videos/v/a.txt', 'uno');
      fake.ctl.down = true;
      queue.runNow(idA, {scope: 'full'});
      await until(() => jobs(A)[0]?.attempts === 1);
      assert.match(jobs(A)[0].waiting!, /^Sin conexión con tu cuenta/);
      assert.equal(jobs(A)[0].cause?.where, 'cloud');
      assert.ok(jobs(A)[0].cause?.code, 'cause.code travels through cloud.ts');
      fake.ctl.down = false;
      fake.ctl.apiStatus = 503;
      queue.retry(idA, jobs(A)[0].id);
      await until(() => jobs(A)[0]?.attempts === 1 && /servidor/.test(jobs(A)[0].waiting ?? ''));
      assert.doesNotMatch(jobs(A)[0].waiting!, /Sin conexión/);
      assert.equal(jobs(A)[0].cause?.kind, 'server');
    }),
  ));

test('nothing that looks like a URL or a token survives in a cause', () => {
  const c = engine.netCause(new TypeError('fetch failed', {cause: Object.assign(new Error('bad https://s3.x/a?X-Amz-Signature=SECRETO y Bearer SECRETO'), {code: 'EPIPE'})}));
  assert.equal(c.code, 'EPIPE');
  assert.equal(c.message!.includes('SECRETO'), false);
});

test('a PUT that fails is retried on the spot and the job does not notice', async () => {
  const body = 'a veces falla';
  write(A, 'videos/v/a.txt', body);
  fake.ctl.onPut = (s, nth) => (s === sha(body) && nth < 2 ? (nth ? 'cut' : 503) : 0);
  queue.runNow(idA, {scope: 'full'});
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(history(A)[0].attempts, 0, 'never went back to the queue');
  assert.equal(fake.ctl.putHeaders.length, 3, 'a 503, a cut, and the one that worked');
  assert.equal(cp.entries.has('videos/v/a.txt'), true);
});

test('a file that runs out of tries is left out, the others go up, and the job comes back for it', () =>
  quietly(() =>
    parkedRetries(async () => {
      const bad = 'este no sube';
      write(A, 'videos/v/malo.txt', bad);
      write(A, 'videos/v/bueno.txt', 'este sí');
      write(A, 'ideas.json', '{"i":1}');
      fake.ctl.onPut = (s) => (s === sha(bad) ? 502 : 0);
      queue.runNow(idA, {scope: 'full'});
      await until(() => jobs(A)[0]?.attempts === 1);
      assert.equal(fake.ctl.putHeaders.length, 5, 'one try and three retries, plus the good one');
      assert.equal(cp.entries.has('videos/v/bueno.txt'), true);
      assert.equal(cp.entries.has('ideas.json'), true);
      assert.equal(cp.entries.has('videos/v/malo.txt'), false);
      assert.equal(jobs(A)[0].state, 'pending');
      fake.ctl.onPut = null;
      queue.retry(idA, jobs(A)[0].id);
      await until(() => history(A)[0]?.state === 'done');
      assert.equal(cp.entries.has('videos/v/malo.txt'), true);
    }),
  ));

test('when the storage is gone it stops trying file after file', () =>
  quietly(() =>
    parkedRetries(async () => {
      for (let i = 0; i < 300; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
      write(A, 'ideas.json', '{"i":1}');
      fake.ctl.putStatus = 503;
      queue.runNow(idA, {scope: 'full'});
      await until(() => jobs(A)[0]?.attempts === 1, 8000);
      assert.ok(fake.ctl.putHeaders.length < 300, `tried ${fake.ctl.putHeaders.length} PUTs`);
      assert.equal(cp.entries.has('ideas.json'), true, 'what needs no storage still goes');
    }),
  ));

test('a cut between batches does not repeat what was already confirmed, and progress adds up', async () => {
  for (let i = 0; i < 450; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  // The network goes in the middle of the second batch's uploads.
  let put = 0;
  fake.ctl.onPut = () => {
    if (++put === 260) fake.ctl.down = true;
    return 0;
  };
  await quietly(() => assert.rejects(sync(A)));
  assert.equal(cp.entries.size, 200, 'the first batch is confirmed');
  assert.equal(Object.keys(stateOf(A).files).length, 200, 'and saved');
  fake.ctl.down = false;
  fake.ctl.onPut = null;
  fake.ctl.putHeaders.length = 0;
  const seen: {done: number; total: number}[] = [];
  const r = await sync(A, {onProgress: (p) => void (p.phase === 'upload' && seen.push(p))});
  assert.equal(r.uploaded, 250);
  assert.equal(fake.ctl.putHeaders.length, 250, 'only what was not confirmed goes up');
  assert.equal(cp.entries.size, 450);
  assert.equal(seen.at(-1)!.done, seen.at(-1)!.total, 'it ends at x/x');
  assert.equal(seen.at(-1)!.total, 250 * 2);
  assert.ok(seen.every((p, i) => !i || p.done === seen[i - 1].done + 1), 'one step at a time');
});

test('documents and deletes are confirmed batch by batch too', async () => {
  for (let i = 0; i < 300; i++) write(A, `videos/v/f${i}.txt`, `x${i}`);
  await sync(A);
  for (let i = 0; i < 260; i++) fs.rmSync(path.join(A, `videos/v/f${i}.txt`));
  write(A, 'ideas.json', '{"i":1}');
  fake.ctl.downAfterCommits = 1;
  await assert.rejects(sync(A, {confirmDeletes: true}));
  assert.equal(cp.entries.get('ideas.json')?.content, '{"i":1}');
  const gone = [...cp.entries.values()].filter((e) => e.deleted).length;
  assert.equal(gone, 199, 'the document and 199 deletes made the first batch');
  fake.ctl.down = false;
  fake.ctl.downAfterCommits = 0;
  const r = await sync(A, {confirmDeletes: true});
  assert.equal(r.deleted, 61);
});

test('progress adds up when the storage already has some and others fail', async () => {
  write(A, 'videos/v/ya.txt', 'ya estaba');
  await sync(A);
  write(A, 'videos/w/ya.txt', 'ya estaba');
  write(A, 'videos/v/nuevo.txt', 'nuevo');
  write(A, 'videos/v/rechazado.txt', 'rechazado');
  fake.ctl.onPut = (s) => (s === sha('rechazado') ? 403 : 0);
  const seen: {done: number; total: number}[] = [];
  const r = await quietly(() => sync(A, {onProgress: (p) => void (p.phase === 'upload' && seen.push(p))}));
  assert.equal(seen.at(-1)!.total, 6);
  assert.equal(seen.at(-1)!.done, 6);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].retry, false);
});

test('files the account turned down do not read as done: grouped, capped, with Reintentar', () =>
  quietly(async (lines) => {
    for (let i = 0; i < 60; i++) {
      write(A, `videos/v/f${i}.txt`, `x${i}`);
      fake.ctl.commitReject.set(`videos/v/f${i}.txt`, 'Este archivo no se preparó');
    }
    write(A, 'videos/v/otro.txt', 'otro');
    fake.ctl.commitReject.set('videos/v/otro.txt', 'Ruta no válida');
    write(A, 'videos/v/bien.txt', 'bien');
    queue.runNow(idA, {scope: 'full'});
    await until(() => history(A)[0]?.state === 'partial');
    const j = history(A)[0];
    assert.equal(j.error, '61 archivos no se sincronizaron');
    assert.deepEqual(j.failures!.groups.map((g) => [g.reason, g.count]), [['Este archivo no se preparó', 60], ['Ruta no válida', 1]]);
    assert.ok(j.failures!.groups[0].sample.length <= 5);
    assert.ok(j.warnings.length <= 50, 'the list does not flood the job');
    assert.equal(j.failures!.total, 61);
    assert.equal(cp.entries.has('videos/v/bien.txt'), true);
    assert.ok(lines.length < 20, 'nor the log');
    const d = await queue.detail(idA, false);
    assert.equal(d.status.error, '61 archivos no se sincronizaron', 'the project says so, not "synced"');
    assert.notEqual(d.status.state, 'synced');
    fake.ctl.commitReject.clear();
    queue.retry(idA, j.id);
    await until(() => history(A)[0]?.state === 'done');
    assert.equal(cp.entries.size, 62);
    assert.equal(history(A)[0].failures ?? null, null);
    assert.equal((await queue.detail(idA, false)).status.state, 'synced');
  }));

test('a file too big to go is reported too, not hidden behind done', async () => {
  write(A, 'ideas.json', JSON.stringify({x: 'y'.repeat(600 * 1024)}));
  queue.runNow(idA, {scope: 'full'});
  await until(() => history(A)[0]?.state === 'partial');
  assert.equal(history(A)[0].error, '1 archivo no se sincronizó');
  assert.equal(history(A)[0].failures!.groups[0].reason, 'pasa de 512 KB');
});

test('a file edited during its upload is pending work, not a failure', async () => {
  write(A, 'videos/v/a.txt', 'antes');
  fake.ctl.onPut = () => (write(A, 'videos/v/a.txt', 'después de empezar', Date.now() + 5000), 0);
  queue.runNow(idA, {scope: 'full'});
  await until(() => history(A)[0]?.state === 'done');
  assert.equal(cp.entries.has('videos/v/a.txt'), false);
  fake.ctl.onPut = null;
  assert.equal((await queue.detail(idA, false)).status.up, 1);
});

test('cancelling while a PUT waits for its next try stops right there', () =>
  quietly(async () => {
    const saved = engine.tuning.putRetries;
    engine.tuning.putRetries = [60_000];
    try {
      write(A, 'videos/v/a.txt', 'uno');
      fake.ctl.putStatus = 503;
      const j = queue.runNow(idA, {scope: 'full'});
      await until(() => fake.ctl.putHeaders.length === 1);
      await sleep(30);
      queue.cancel(idA, j.id);
      await until(() => !jobs(A).length);
      assert.equal(history(A).length, 0);
    } finally {
      engine.tuning.putRetries = saved;
    }
  }));
