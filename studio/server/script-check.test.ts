// Alineación con tu audiencia: the model's answer is held to the rubric. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-check-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

test('scores are clamped to each criterion, unknown ones dropped, the total recomputed', async () => {
  const {clean, CRITERIA} = await import('./script-check.ts');
  const c = clean(
    {
      criteria: {problem: {score: 99, note: 'toca la cuota inicial'}, hook: {score: -3}, level: {score: '10'}, made_up: {score: 50}},
      level: 'problemAware',
      problem: 'No me alcanza para la cuota inicial',
      fixes: [{line: 'a', why: 'b', try: 'c'}, {}, {why: 'x'}, {try: 'y'}, {try: 'z'}],
      good: ['bien', '', 'claro'],
      score: 100,
    },
    'guion',
  );
  assert.equal(c.criteria.length, CRITERIA.length);
  assert.deepEqual(c.criteria.slice(0, 3).map((k) => k.score), [30, 0, 10]);
  assert.equal(c.score, 40); // not the model's 100
  assert.equal(c.level, 'problemAware');
  assert.equal(c.fixes.length, 3);
  assert.deepEqual(c.good, ['bien', 'claro']);
  assert.equal(clean({level: 'whatever'}, 'g').level, '');
  assert.notEqual(clean({}, 'uno').script, clean({}, 'otro').script);
});
