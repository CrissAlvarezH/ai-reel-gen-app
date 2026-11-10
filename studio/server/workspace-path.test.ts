// Choosing the workspace (welcome page, Ajustes): a path that isn't absolute would be resolved against the server's
// own folder (inside the app, when installed), so it's refused instead of creating the workspace there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-ws-path-'));
process.on('exit', () => fs.rmSync(tmp, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = path.join(tmp, 'aun-no');
process.env.REEL_STUDIO_CONFIG_DIR = path.join(tmp, 'cfg');
delete process.env.REEL_STUDIO_RESOURCES;

const workspace = await import('./workspace.ts');
const here = process.cwd();

test('a relative path is refused, not created next to the server', () => {
  for (const p of ['Mis reels', './reels', '../reels', 'Documents/Reel Studio']) {
    assert.throws(() => workspace.inspect(p), (e: Error & {status?: number}) => e.status === 400, p);
    assert.throws(() => workspace.setWorkspace(p), (e: Error & {status?: number}) => e.status === 400, p);
  }
  assert.equal(fs.existsSync(path.join(here, 'Mis reels')), false);
  assert.equal(fs.existsSync(path.join(here, 'reels')), false);
  assert.equal(workspace.ROOT, '');
});

test('absolute paths and ~ still work', () => {
  assert.equal(workspace.inspect('~').path, os.homedir());
  assert.equal(workspace.inspect('  ~/Reel Studio ').path, path.join(os.homedir(), 'Reel Studio'));
  const dir = path.join(tmp, 'Mis Vídeos ñandú');
  assert.equal(workspace.inspect(dir).exists, false);
  workspace.setWorkspace(dir);
  assert.equal(workspace.ROOT, dir);
  assert.ok(fs.existsSync(path.join(dir, 'projects', 'principal', 'project.json')));
});
