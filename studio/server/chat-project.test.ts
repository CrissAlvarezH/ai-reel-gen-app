// An agent working in a project that isn't the open one (he switched meanwhile, or an automation of another project):
// the videos it creates are its project's. Stand-in CLI, temp workspace.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import type {TurnOptions} from './agent.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-chat-project-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
for (const [id, name, created] of [['uno', 'Canal Uno', 1], ['dos', 'Canal Dos', 2]] as const) {
  fs.mkdirSync(path.join(root, 'projects', id, 'videos'), {recursive: true});
  fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), JSON.stringify({name, created}));
}
const video = (project: string, slug: string) => fs.mkdirSync(path.join(root, 'projects', project, 'videos', slug, 'audio'), {recursive: true});
video('dos', 'solo-en-dos');

// Claude Code's stream for a turn that says "hecho", written once its stdin is closed (the test says when).
const turns: TurnOptions[] = [];
const procs: ReturnType<typeof spawn>[] = [];
after(() => procs.forEach((p) => p.kill())); // a failed test leaves its turn waiting
async function standIn() {
  const {claude} = await import('./agent.ts');
  const lines = [{type: 'system', subtype: 'init', session_id: 's1'}, {type: 'assistant', message: {content: [{type: 'text', text: 'hecho'}]}}, {type: 'result', is_error: false, result: 'hecho'}];
  claude.turn = (o) => {
    turns.push(o);
    const p = spawn(process.execPath, ['-e', `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(lines.map((l) => JSON.stringify(l)).join('\n'))}))`], {stdio: 'pipe'});
    procs.push(p);
    return p;
  };
}

test('a video an agent creates in its project counts and the conversation goes on there, whatever project is open', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  await standIn();
  ws.openProject('dos');
  fs.mkdirSync(ws.DATA, {recursive: true});
  const dosData = ws.DATA;
  const conversation = chat.backgroundChat(chat.GENERAL);
  const done = new Promise<{video?: string; created: string[]}>((resolve) => chat.send(chat.GENERAL, {text: 'haz un video'}, conversation, {system: '', onDone: resolve}));
  ws.openProject('uno'); // a cron of «dos» while «uno» is open works the same way

  video('dos', 'nuevo-en-dos'); // scripts/new-video.sh, in the agent's project…
  assert.deepEqual(chat.requestMove(chat.GENERAL, conversation, 'nuevo-en-dos', true), {slug: 'nuevo-en-dos', when: 'al terminar este turno'}); // …tells the studio
  procs.at(-1)!.stdin!.end();
  const r = await done;
  assert.deepEqual(r.created, ['nuevo-en-dos']);
  assert.equal(r.video, 'nuevo-en-dos');
  const moved = JSON.parse(fs.readFileSync(path.join(dosData, 'nuevo-en-dos.json'), 'utf8')) as {chats: {id: string}[]};
  assert.ok(moved.chats.some((c) => c.id === conversation));
  assert.equal(ws.PROJECT, 'uno');
  // A video that isn't in its project is still refused.
  assert.throws(() => chat.requestMove(chat.GENERAL, conversation, 'no-existe', true), /durante su turno|no existe/);
});
