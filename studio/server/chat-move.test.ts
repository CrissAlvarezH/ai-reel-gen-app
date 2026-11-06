// A general conversation that created a video goes on there; temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-chat-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test('moveToVideo takes the conversation out of the general ones and opens it in the video', async () => {
  const ws = await import('./workspace.ts');
  const chat = await import('./chat.ts');
  ws.openProject('p');
  fs.mkdirSync(ws.DATA, {recursive: true});
  const item = {id: 'i1', role: 'user', text: 'crea el video', comments: [], ts: 1};
  const conv = (id: string, items: unknown[] = [item]) => ({id, sessionId: `s-${id}`, items, created: 1});
  fs.writeFileSync(path.join(ws.DATA, '_general.json'), JSON.stringify({active: 'a', chats: [conv('a'), conv('b')]}));
  fs.writeFileSync(path.join(ws.DATA, 'mi-video.json'), JSON.stringify({active: 'e', chats: [{...conv('e', []), sessionId: null}]}));

  chat.moveToVideo('a', 'mi-video', ws.DATA);
  const general = JSON.parse(fs.readFileSync(path.join(ws.DATA, '_general.json'), 'utf8'));
  const video = JSON.parse(fs.readFileSync(path.join(ws.DATA, 'mi-video.json'), 'utf8'));
  assert.deepEqual(general.chats.map((c: {id: string}) => c.id), ['b']);
  assert.equal(general.active, 'b');
  assert.deepEqual(video.chats.map((c: {id: string}) => c.id), ['a']); // the empty tab made room
  assert.equal(video.active, 'a');
  assert.equal(video.chats[0].sessionId, 's-a'); // the same session goes on
  assert.equal(video.chats[0].briefing, true); // its next turn is told the video's instructions
  assert.match(video.chats[0].items.at(-1).text, /pasó al video «mi-video»/);

  // Only a general conversation, and only its agent during its turn.
  assert.throws(() => chat.requestMove('mi-video', 'a', 'otro'), /ya tiene video .* no puede cambiarse/);
  assert.throws(() => chat.requestMove('_general', 'b', 'mi-video'), /durante su turno/);
});
