// An automation's update of an Inspiración account lands in its own project, whichever is open. Scraper faked; temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-step-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
const write = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true});
  fs.writeFileSync(path.join(root, p), typeof v === 'string' ? v : JSON.stringify(v));
};
write('.env', 'SCRAPECREATORS_API_KEY=fake\n');
for (const id of ['abierto', 'cerrado']) write(`projects/${id}/project.json`, {name: id, created: id === 'abierto' ? 1 : 2});
write('projects/cerrado/inspiration/otra/account.json', {username: 'otra', fullName: null, followed: true, added: 1, fetched: null, analysis: {text: 'la mía', at: 1, reels: 3}, error: null, profile: null});

// Reel 3 is the long one.
const reel = (n: number) => ({media: {code: `CODE${n}AAAA`, play_count: n, like_count: n, comment_count: n, video_duration: n === 3 ? 200 : 30, taken_at: 1790000000, video_versions: [{url: 'https://x.test/v.mp4'}], image_versions2: {candidates: [{url: 'https://x.test/c.jpg'}]}, user: {username: 'otra'}}});
const answer = (url: string) => (url.includes('/user/reels') ? {items: [1, 2, 3].map(reel), paging_info: {more_available: false}} : url.includes('/profile') ? {data: {user: {username: 'otra', full_name: 'Otra', edge_followed_by: {count: 5}}}} : {data: {}});
globalThis.fetch = (async (u: string) => new Response(JSON.stringify(answer(String(u))))) as typeof fetch;
// Reels 1 and 2 are already done: nothing here may need the transcriber or the agent.
for (const n of [1, 2]) {
  const d = `projects/cerrado/inspiration/otra/CODE${n}AAAA`;
  write(`${d}/transcript.json`, {segments: []});
  write(`${d}/hook.jpg`, 'x');
  write(`${d}/analysis.json`, {topic: 'hecho', hook: {text: '', visual: '', why: ''}, structure: [], visuals: [], cta: null, takeaways: [], at: 1});
}

test('an automation updates an account in its project without analysing; "Analizar…" with its data updated completes those that qualify', async () => {
  const ws = await import('./workspace.ts');
  const insp = await import('./inspiration.ts');
  ws.openProject('abierto');
  const dir = path.join(root, 'projects/cerrado/inspiration/otra');
  const run = (limit: number, seconds?: number) => insp.refreshProjectAccount('cerrado', 'otra', limit, new AbortController(), seconds ? {maxSeconds: seconds, reanalyse: false} : undefined);

  // Done already: only their numbers.
  const done = await run(2, 180);
  assert.deepEqual([done?.reels, done?.processed, done?.analysed, done?.skipped], [2, 0, 0, 0]);
  assert.equal(ws.PROJECT, 'abierto');
  assert.ok(!fs.existsSync(path.join(root, 'projects/abierto/inspiration/otra')));
  const acc = JSON.parse(fs.readFileSync(path.join(dir, 'account.json'), 'utf8'));
  assert.equal(acc.analysis.text, 'la mía'); // what was there stays
  assert.equal(acc.profile.followers, 5);

  // Too long: its numbers arrive, and nothing is asked of the transcriber (not installed here).
  const long = await run(3, 180);
  assert.deepEqual([long?.reels, long?.fresh, long?.skipped], [3, 1, 1]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'CODE3AAAA/reel.json'), 'utf8')).views, 3);
  assert.ok(!fs.existsSync(path.join(dir, 'CODE3AAAA/transcript.json')));

  // Short enough: analysing it needs the transcriber; the automation's update (no analyse) never asks for it.
  await assert.rejects(run(3, 300), /falta la transcripción/);
  const update = await run(3);
  assert.deepEqual([update?.reels, update?.processed, update?.analysed], [3, 0, 0]);
  await assert.rejects(run(3).then(() => insp.refreshProjectAccount('cerrado', 'nadie', 2, new AbortController())), /ya no está en Inspiración/);
});

test('"Analizar…" picks like the step: the newest reels here, then those short enough', async () => {
  const ws = await import('./workspace.ts');
  const insp = await import('./inspiration.ts');
  const dir = path.join(root, 'projects/cerrado/inspiration/otra');
  for (const n of [1, 2, 3]) {
    const f = path.join(dir, `CODE${n}AAAA/reel.json`);
    fs.writeFileSync(f, JSON.stringify({...JSON.parse(fs.readFileSync(f, 'utf8')), posted: `2026-10-0${n}T00:00:00.000Z`}));
  }
  ws.openProject('cerrado');
  assert.deepEqual(insp.newest('otra', 2, 180), ['CODE2AAAA']); // 3 is the newest but too long; 1 is out of the 2
  assert.deepEqual(insp.newest('otra', 3, 180), ['CODE2AAAA', 'CODE1AAAA']);
  assert.throws(() => insp.processAccount('otra', {limit: 0, maxSeconds: 180}), /de 1 a/);
  assert.throws(() => insp.processAccount('otra', {limit: 2, maxSeconds: 181}), /duración máxima/);
  // Destacados' "Analizar": only reels of that account.
  assert.throws(() => insp.processAccount('otra', {codes: []}), /no son de esta cuenta/);
  assert.throws(() => insp.processAccount('otra', {codes: ['NOPE1AAAA']}), /no son de esta cuenta/);
});
