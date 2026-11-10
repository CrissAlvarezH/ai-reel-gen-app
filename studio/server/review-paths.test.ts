// The script reviews, as an agent reads them (curl …/hook-check?format=text): the file they name is where it is from
// the agent's folder, the workspace's root (not from the project's). Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-review-paths-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test("each review names its file by its path from the workspace, the agent's working folder", async () => {
  const ws = await import('./workspace.ts');
  const hook = await import('./hook-check.ts');
  const audience = await import('./script-check.ts');
  ws.openProject('p');
  const dir = path.join(ws.VIDEOS, 'v');
  fs.mkdirSync(path.join(dir, 'audio'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'audio/vo.txt'), 'Una línea.');
  fs.writeFileSync(path.join(dir, 'hook-check.json'), JSON.stringify(hook.clean({}, 'Una línea.')));
  fs.writeFileSync(path.join(dir, 'audience-check.json'), JSON.stringify(audience.clean({}, 'Una línea.')));

  for (const [text, name] of [[hook.agentText('v'), 'hook-check.json'], [audience.agentText('v'), 'audience-check.json']] as const) {
    const named = text.match(/([\w./-]+\.json)\)/)?.[1];
    assert.equal(named, `projects/p/videos/v/${name}`);
    assert.ok(fs.existsSync(path.join(ws.ROOT, named!)));
  }
});
