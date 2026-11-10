// A workspace from before projects (videos/ at the root) opened for the first time: everything goes into
// projects/principal/, including the conversations from both places they used to live (studio/data/, older, and
// .reel-studio/chats/), even when both are there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-ws-migrate-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
delete process.env.REEL_STUDIO_RESOURCES;

const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true});
  fs.writeFileSync(path.join(root, rel), text);
};
put('videos/un-video/style.txt', 'collage-semitono\n');
put('config/profile.json', '{"audience":"ficticia"}');
put('config/images.json', '{}');
put('studio/data/viejo.json', '{"chats":[{"id":"a"}]}');
put('studio/data/repetido.json', '{"de":"studio/data"}');
put('.reel-studio/chats/_general.json', '{"chats":[{"id":"b"}]}');
put('.reel-studio/chats/repetido.json', '{"de":".reel-studio"}');
put('.reel-studio/index.sqlite', 'x');

const workspace = await import('./workspace.ts');
const chats = path.join(root, 'projects', 'principal', '.reel-studio', 'chats');

test('the old layout moves into projects/principal', () => {
  assert.equal(workspace.PROJECT, 'principal');
  assert.ok(fs.existsSync(path.join(root, 'projects/principal/videos/un-video/style.txt')));
  assert.ok(fs.existsSync(path.join(root, 'projects/principal/config/profile.json')));
  assert.ok(fs.existsSync(path.join(root, 'config/images.json')), 'shared settings stay at the root');
});

test('conversations from studio/data and .reel-studio/chats all reach the project', () => {
  assert.deepEqual(fs.readdirSync(chats).sort(), ['_general.json', 'repetido.json', 'viejo.json']);
  // Same name in both: the newer place (.reel-studio/chats) wins, the other stays where it was.
  assert.equal(fs.readFileSync(path.join(chats, 'repetido.json'), 'utf8'), '{"de":".reel-studio"}');
  assert.ok(fs.existsSync(path.join(root, 'studio/data/repetido.json')));
  assert.ok(!fs.existsSync(path.join(root, 'studio/data/viejo.json')));
  assert.ok(!fs.existsSync(path.join(root, '.reel-studio/chats')));
  assert.ok(fs.existsSync(path.join(root, '.reel-studio/index.sqlite')), 'the index stays at the root');
});
