// The instructions an agent reads during its turn (curl …/instructions) are its own project's, even after he opens
// another one. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-chat-instructions-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
for (const [id, created] of [['canal-a', 1], ['canal-b', 2]] as const) {
  fs.mkdirSync(path.join(root, 'projects', id, 'config'), {recursive: true});
  fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), JSON.stringify({name: id, created}));
}
fs.mkdirSync(path.join(root, 'projects/canal-a/videos/solo-en-a'), {recursive: true});

test('an agent of a project still gets its own instructions after another project opens', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  ws.openProject('canal-b'); // he moved on; the agent of canal-a is still in its turn

  const general = chat.instructions('_general', 'canal-a');
  assert.match(general, /projects\/canal-a\/config/);
  assert.doesNotMatch(general, /projects\/canal-b\//);
  assert.match(chat.instructions('solo-en-a', 'canal-a'), /solo-en-a/);
  assert.equal(ws.PROJECT, 'canal-b'); // the open project doesn't change

  // Without a project, the open one, as before.
  assert.match(chat.instructions('_general'), /projects\/canal-b\/config/);
  assert.throws(() => chat.instructions('solo-en-a'), /conversación no encontrada/);
  assert.throws(() => chat.instructions('_general', '../..'), /proyecto no encontrado/);
  assert.throws(() => chat.instructions('_general', 'no-existe'), /proyecto no encontrado/);
});

test('the line each turn carries asks for the agent’s own project', async () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'chat.ts'), 'utf8');
  assert.match(src, /instructions\?project=\$REEL_STUDIO_PROJECT_ID/);
  assert.match(src, /REEL_STUDIO_PROJECT_ID: PROJECT/);
});
