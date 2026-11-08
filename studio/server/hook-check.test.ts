// Fuerza del gancho: the model's answer is held to the rubric, and the agent's reading says what it found. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-hook-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test('the rubric adds up to 100; scores are clamped, unknown criteria dropped, the total recomputed', async () => {
  const {clean, CRITERIA} = await import('./hook-check.ts');
  assert.equal(CRITERIA.reduce((t, c) => t + c.max, 0), 100);
  const c = clean(
    {
      criteria: {forMe: {score: 99, note: 'nombra el CDT'}, specific: {score: -3}, question: {score: '12'}, made_up: {score: 50}},
      hook: 'Tu CDT dice que ganarás doce por ciento…',
      fixes: [{line: 'a', why: 'b', try: 'c'}, {}, {why: 'x'}, {try: 'y'}, {try: 'z'}],
      alternatives: [{hook: 'uno', second: 'dos'}, {second: 'sin gancho'}, {hook: 'tres'}, {hook: 'cuatro'}, {hook: 'cinco'}],
      good: ['bien', '', 'claro'],
      score: 100,
    },
    'guion',
  );
  assert.equal(c.criteria.length, CRITERIA.length);
  assert.deepEqual(c.criteria.slice(0, 3).map((k) => k.score), [20, 0, 12]);
  assert.equal(c.score, 32); // not the model's 100
  assert.equal(c.fixes.length, 3);
  assert.deepEqual(c.alternatives.map((a) => a.hook), ['uno', 'tres', 'cuatro']); // one without a hook dropped
  assert.deepEqual(c.good, ['bien', 'claro']);
  assert.notEqual(clean({}, 'uno').script, clean({}, 'otro').script);
});

test("the agent's reading: none yet, then the check with its alternatives, and stale once the script changes", async () => {
  const ws = await import('./workspace.ts');
  const {agentText, clean} = await import('./hook-check.ts');
  ws.openProject('p');
  const dir = path.join(ws.VIDEOS, 'v');
  fs.mkdirSync(path.join(dir, 'audio'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'audio/vo.txt'), 'Primera línea.\nSegunda.');
  assert.match(agentText('v'), /aún no tiene revisión del gancho/);

  const check = clean({criteria: {question: {score: 20, note: 'abre bien'}}, verdict: 'Bien', alternatives: [{hook: 'Otro arranque', second: 'y su segunda'}]}, 'Primera línea.\nSegunda.');
  fs.writeFileSync(path.join(dir, 'hook-check.json'), JSON.stringify(check));
  const text = agentText('v');
  assert.match(text, /Fuerza del gancho \(.*hook-check\.json\): 20\/100\./);
  assert.match(text, /- Abre una pregunta: 20\/25 \(abre bien\)/);
  assert.match(text, /«Otro arranque» → «y su segunda»/);
  assert.doesNotMatch(text, /cambió/);

  fs.writeFileSync(path.join(dir, 'audio/vo.txt'), 'Otro guion.');
  assert.match(agentText('v'), /el guion cambió después de esta revisión/);
});

test("each review's model: chosen per project and agent, only one the agent offers, '' back to the default", async () => {
  const ws = await import('./workspace.ts');
  const {models, modelFor, setModel} = await import('./script-check.ts');
  ws.openProject('p'); // a fresh config: the agent is Claude
  const m = models();
  assert.deepEqual(m.chosen, {audience: '', hook: ''});
  assert.match(m.options[0].label, /Predeterminado \(Sonnet/); // the reviews' default, not the CLI's
  assert.equal(setModel('hook', 'opus').chosen.hook, 'opus');
  assert.equal(modelFor('hook'), 'opus');
  assert.equal(modelFor('audience'), ''); // each review has its own
  assert.throws(() => setModel('hook', 'no-existe'), /no tiene ese modelo/);
  assert.throws(() => setModel('otra', 'opus'), /no existe/);
  assert.equal(setModel('hook', '').chosen.hook, '');
  assert.ok(fs.existsSync(path.join(ws.CONFIG, 'checks.json'))); // in the project's config/
});
