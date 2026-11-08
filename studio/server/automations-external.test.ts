// An automation's "Actualizar cuenta externa" with Todas: every scanned account of its project, one failing doesn't stop the rest.
// Scraper faked; temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-all-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
const write = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true});
  fs.writeFileSync(path.join(root, p), typeof v === 'string' ? v : JSON.stringify(v));
};
write('.env', 'SCRAPECREATORS_API_KEY=fake\n');
for (const id of ['abierto', 'cerrado']) write(`projects/${id}/project.json`, {name: id, created: id === 'abierto' ? 1 : 2});
const acc = (username: string, added: number, followed = true) => ({username, fullName: null, followed, added, fetched: null, analysis: null, error: null, profile: null});
write('projects/cerrado/inspiration/una/account.json', acc('una', 1));
write('projects/cerrado/inspiration/privada/account.json', acc('privada', 2));
write('projects/cerrado/inspiration/suelta/account.json', acc('suelta', 3, false)); // only a loose reel of it: not scanned
write('projects/abierto/inspiration/otra/account.json', acc('otra', 1)); // another project's

const reel = (u: string, n: number) => ({media: {code: `${u.toUpperCase()}${n}AAAA`, play_count: n, like_count: n, comment_count: n, video_duration: 30, taken_at: 1790000000, video_versions: [{url: 'https://x.test/v.mp4'}], image_versions2: {candidates: [{url: 'https://x.test/c.jpg'}]}, user: {username: u}}});
const asked: string[] = [];
globalThis.fetch = (async (input: string) => {
  const url = new URL(String(input));
  const handle = url.searchParams.get('handle') ?? '';
  if (url.pathname.endsWith('/user/reels')) {
    asked.push(handle);
    return new Response(JSON.stringify({items: handle === 'privada' ? [] : [1, 2].map((n) => reel(handle, n)), paging_info: {more_available: false}}));
  }
  if (url.pathname.endsWith('/profile')) return new Response(JSON.stringify({data: {user: {username: handle, edge_followed_by: {count: 7}}}}));
  return new Response('{}');
}) as typeof fetch;

test('Todas updates every scanned account of its project, only their numbers; one failing leaves the rest', async () => {
  const ws = await import('./workspace.ts');
  const insp = await import('./inspiration.ts');
  const auto = await import('./automations.ts');
  ws.openProject('abierto');
  assert.deepEqual(insp.followedIn('cerrado'), ['una', 'privada']);

  const text = await auto.refreshAllExternal('cerrado', 2, new AbortController());
  assert.deepEqual(asked, ['una', 'privada']);
  assert.match(text!, /1 de 2 cuentas/);
  assert.match(text!, /@una \(2 reels, 2 nuevos\)/);
  assert.match(text!, /Fallaron: @privada/);
  const dir = path.join(root, 'projects/cerrado/inspiration/una/UNA1AAAA');
  assert.ok(fs.existsSync(path.join(dir, 'reel.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'transcript.json'))); // nothing analysed
  assert.equal(ws.PROJECT, 'abierto');
  assert.ok(!fs.existsSync(path.join(root, 'projects/abierto/inspiration/una')));

  // None could be updated: the step fails.
  fs.rmSync(path.join(root, 'projects/cerrado/inspiration/una'), {recursive: true});
  await assert.rejects(auto.refreshAllExternal('cerrado', 2, new AbortController()), /ninguna cuenta/);
  // Stopped before starting: nothing is asked.
  const ctrl = new AbortController();
  ctrl.abort();
  asked.length = 0;
  await assert.rejects(auto.refreshAllExternal('cerrado', 2, ctrl), /detenido/);
  assert.deepEqual(asked, []);
});
