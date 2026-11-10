// What an agent's turn is told, with a stand-in CLI that records it: an automation's (unattended) and one he's watching.
// Temp workspace.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {TurnOptions} from './agent.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-unattended-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

// Claude Code's stream for a turn that says "hecho"; every turn's options are kept.
const turns: TurnOptions[] = [];
const procs: ReturnType<typeof spawn>[] = [];
const ended = (p: ReturnType<typeof spawn>) => new Promise((resolve) => (p.exitCode !== null ? resolve(null) : p.on('close', resolve)));
async function standIn() {
  const {claude} = await import('./agent.ts');
  const lines = [{type: 'system', subtype: 'init', session_id: 's1'}, {type: 'assistant', message: {content: [{type: 'text', text: 'hecho'}]}}, {type: 'result', is_error: false, result: 'hecho'}];
  claude.turn = (o) => {
    turns.push(o);
    const p = spawn(process.execPath, ['-e', `console.log(${JSON.stringify(lines.map((l) => JSON.stringify(l)).join('\n'))})`], {stdio: 'pipe'});
    procs.push(p);
    return p;
  };
}

test("an automation's turn isn't told to swap its instructions for the ones its curl would fetch (they lack its rules)", async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  await standIn();
  ws.openProject('p');
  fs.mkdirSync(ws.DATA, {recursive: true});

  // Unattended: a fresh session every time, so its system prompt is the current one, with the automation's own rules.
  const id = chat.backgroundChat(chat.GENERAL);
  await new Promise<void>((resolve) => chat.send(chat.GENERAL, {text: 'haz un video', note: 'contexto'}, id, {system: 'REGLAS DE LA AUTOMATIZACIÓN', onDone: () => resolve()}));
  const auto = turns.at(-1)!;
  assert.equal(auto.resume, null);
  assert.match(auto.systemPrompt, /REGLAS DE LA AUTOMATIZACIÓN/);
  assert.doesNotMatch(auto.prompt, /instrucciones vigentes/);
  // What that curl would bring back doesn't have them: following it would drop "don't ask, decide yourself".
  assert.doesNotMatch(chat.instructions(chat.GENERAL), /REGLAS DE LA AUTOMATIZACIÓN/);

  // A conversation he's watching still carries it (a resumed session keeps the system prompt it started with).
  const {id: open} = chat.newChat(chat.GENERAL);
  chat.send(chat.GENERAL, {text: 'hola', context: {page: 'library'}}, open);
  assert.match(turns.at(-1)!.prompt, /instrucciones vigentes salen de curl/);
  await ended(procs.at(-1)!);
});
