// A conversations file that can't be read (cut by a crash while it was being written) is kept, not overwritten
// with an empty one; and saving never leaves a cut file behind. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-chat-file-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test('reading a cut conversations file keeps its content to recover it', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  ws.openProject('p');
  fs.mkdirSync(ws.DATA, {recursive: true});
  const cut = '{"active":"a","chats":[{"id":"a","sessionId":"s-a","items":[{"id":"i1","role":"user","text":"la conversación importante","comments":[],"ts":1}';
  fs.writeFileSync(path.join(ws.DATA, '_general.json'), cut);

  const list = chat.list('_general'); // the page still opens, with a new empty conversation
  assert.equal(list.chats.length, 1);

  const kept = fs.readdirSync(ws.DATA).filter((n) => n.startsWith('_general.json.'));
  assert.equal(kept.length, 1, `se guarda una copia del archivo ilegible (hay: ${fs.readdirSync(ws.DATA).join(', ')})`);
  assert.equal(fs.readFileSync(path.join(ws.DATA, kept[0]), 'utf8'), cut);
  // and it isn't taken for another conversations file
  assert.ok(!kept[0].endsWith('.json'));
});

test('saving a conversation leaves no temporary files and the file is whole JSON', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  chat.newChat('_general');
  const names = fs.readdirSync(ws.DATA);
  assert.ok(!names.some((n) => n.endsWith('.tmp')), names.join(', '));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(ws.DATA, '_general.json'), 'utf8')));
});
