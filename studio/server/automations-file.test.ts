// An automations.json or a memory file that can't be read (edited by hand, cut) is not written over with an empty
// one by the next change. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-automations-file-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

const CUT = '{"automations": [{"id": "a1", "name": "Semanal", "cron": "0 9 * * 1", "steps": [{"type": "agent", "prompt": "haz un video"}]}], "runs": [';

test('a new automation does not wipe an automations.json that cannot be read', async () => {
  const ws = await import('./workspace.ts');
  const automations = await import('./automations.ts');
  ws.openProject('p');
  const file = path.join(ws.projectDir('p'), 'automations.json');
  fs.writeFileSync(file, CUT);

  assert.throws(() => automations.view(), /no se puede leer projects\/p\/automations\.json/);
  assert.throws(() => automations.add({name: 'Nueva', cron: '0 9 * * *', steps: [{type: 'agent', prompt: 'hola'}]}), /no se puede leer/);
  assert.equal(fs.readFileSync(file, 'utf8'), CUT);

  fs.rmSync(file); // no file yet is an empty list, as before
  assert.equal(automations.view().automations.length, 0);
});

test('the memory of an automation is not written over when its file cannot be read', async () => {
  const ws = await import('./workspace.ts');
  const memory = await import('./automation-memory.ts');
  const file = memory.fileOf('p', 'a1');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const cut = '{"entries": [{"id": "e1", "kind": "note", "text": "Nunca uses la palabra X"';
  fs.writeFileSync(file, cut);

  assert.throws(() => memory.add('p', 'a1', {kind: 'note', text: 'otra'}, 'agent'), /no se puede leer projects\/p\/automation-memory\/a1\.json/);
  assert.throws(() => memory.logRun('p', 'a1', 'r1', 'A mano, terminó bien.'), /no se puede leer/);
  assert.equal(fs.readFileSync(file, 'utf8'), cut);
  assert.ok(ws.ROOT);
});
