// What a new workspace (and the installer) gets from the repo, and the images a style lists: nothing Git ignores
// travels (refs/style-collage/ is third-party), and a style doesn't show images its workspace doesn't have.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-style-refs-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
delete process.env.REEL_STUDIO_RESOURCES;

fs.mkdirSync(path.join(root, 'styles', 'mio'), {recursive: true});
fs.mkdirSync(path.join(root, 'refs', 'mio'), {recursive: true});
fs.writeFileSync(path.join(root, 'refs', 'mio', 'esta.png'), 'png');
fs.writeFileSync(
  path.join(root, 'styles', 'mio', 'style.json'),
  JSON.stringify({name: 'Mío', examples: ['refs/mio/esta.png', 'refs/mio/no-esta.png'], references: ['refs/mio/esta.png', 'refs/otra/falta.png']}),
);

const {APP_ROOT, seeds} = await import('./workspace.ts');
const {listStyles} = await import('./styles.ts');

// A seed may be missing from this checkout (Git can't tell a folder pattern from a file then): ask for a file in it too.
const gitIgnored = (rel: string) =>
  [rel, `${rel}/x`].some((p) => {
    try {
      execFileSync('git', ['-C', APP_ROOT, 'check-ignore', '-q', '--', p], {stdio: 'ignore'});
      return true; // exit 0: ignored
    } catch {
      return false;
    }
  });

test('nothing a new workspace or the installer gets from the repo is ignored by Git', (t) => {
  try {
    execFileSync('git', ['-C', APP_ROOT, 'rev-parse', '--git-dir'], {stdio: 'ignore'});
  } catch {
    return t.skip('not a Git checkout');
  }
  assert.deepEqual(
    seeds().filter((s) => gitIgnored(s.from)).map((s) => s.from),
    [],
  );
});

test("a style only lists the examples and references its workspace has", () => {
  const s = listStyles().find((x) => x.id === 'mio')!;
  assert.deepEqual(s.examples, ['/style-files/refs/mio/esta.png']);
  assert.deepEqual(s.references, ['/style-files/refs/mio/esta.png']);
});
