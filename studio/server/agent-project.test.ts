// What an agent asks the studio during its turn (its reviews of the script, moving its conversation to a video it made,
// its instructions) is answered in its own project, even after he opens another one. Temp workspace.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-agent-project-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
for (const [id, created] of [['canal-a', 1], ['canal-b', 2]] as const) {
  fs.mkdirSync(path.join(root, 'projects', id, 'config'), {recursive: true});
  fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), JSON.stringify({name: id, created}));
}
const video = path.join(root, 'projects/canal-a/videos/solo-en-a');
const script = '¿Sabías que el CDT paga impuestos? Te lo explico.';
fs.mkdirSync(path.join(video, 'audio'), {recursive: true});
fs.writeFileSync(path.join(video, 'audio/vo.txt'), `${script}\n`);
const sha = crypto.createHash('sha1').update(script).digest('hex');
const crit = (key: string) => ({key, label: key, score: 5, max: 10, note: ''});
fs.writeFileSync(path.join(video, 'hook-check.json'), JSON.stringify({score: 71, verdict: 'Gancho claro', hook: script, question: '', criteria: [crit('a')], fixes: [], alternatives: [], good: [], script: sha, at: 1}));
fs.writeFileSync(path.join(video, 'audience-check.json'), JSON.stringify({score: 64, verdict: 'Le habla a su audiencia', problem: '', level: '', criteria: [crit('b')], fixes: [], good: [], script: sha, at: 1}));
fs.writeFileSync(path.join(root, 'projects/canal-a/config/audience.json'), JSON.stringify({who: 'ahorradores', result: 'invertir', wants: [{want: 'ahorrar', so1: 'a', so2: 'b'}], problems: ['impuestos'], levels: [], onboarded: true}));

test('the script reviews an agent reads or runs are its own project’s video', async () => {
  const ws = await import('./workspace.ts');
  const hook = await import('./hook-check.ts');
  const aud = await import('./script-check.ts');
  ws.openProject('canal-b'); // he moved on; the agent of canal-a goes on

  const h = await hook.run('solo-en-a', false, 'canal-a'); // the same script: answers with the last review, spends nothing
  assert.equal(h.check?.score, 71);
  assert.equal(h.stale, false);
  const a = await aud.run('solo-en-a', false, 'canal-a');
  assert.equal(a.check?.score, 64);
  assert.equal(a.audience, true); // canal-a's Perfil de audiencia, not canal-b's (empty)
  assert.match(ws.inProject('canal-a', () => hook.agentText('solo-en-a')), /71\/100/);
  assert.equal(ws.PROJECT, 'canal-b');

  // Without a project, the open one, as before; a bad id is no project.
  assert.equal(hook.state('solo-en-a').check, null);
  assert.throws(() => ws.inProject('../..', () => 1), /proyecto no encontrado/);
  assert.throws(() => ws.inProject('no-existe', () => 1), /proyecto no encontrado/);
});

test('a conversation moves to a video of its own project, not of the open one', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  ws.openProject('canal-b');
  const chatsOfA = path.join(root, 'projects/canal-a/.reel-studio/chats');
  assert.equal(chat.videoOfChats(chatsOfA, 'solo-en-a'), true);
  assert.equal(chat.videoOfChats(path.join(root, 'projects/canal-b/.reel-studio/chats'), 'solo-en-a'), false);
  assert.equal(chat.videoOfChats(chatsOfA, '../canal-a'), false);
});

test('the curl lines an agent is given name its project', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'chat.ts'), 'utf8');
  for (const line of src.match(/\$REEL_STUDIO_URL\/api\/reels\/[^"]*/g) ?? []) assert.match(line, /[?&]project=\$REEL_STUDIO_PROJECT_ID/, line);
  assert.ok((src.match(/\$REEL_STUDIO_URL\/api\/reels\//g) ?? []).length >= 2);
});
