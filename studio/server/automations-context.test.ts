// What an automation's agent step is told about the steps before it: their videos, by folder. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-auto-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

test('an agent step is told every earlier step, the videos each made and the last one in full', async () => {
  const {runContext} = await import('./automations.ts');
  const where = (v: string) => `projects/p/videos/${v}/`;
  assert.equal(runContext([], '', where), ''); // the first step: nothing before it

  const note = runContext(
    [
      {type: 'account', limit: 20, state: 'done', chat: null, summary: 'Mi cuenta actualizada: 20 reels'},
      {type: 'agent', prompt: 'crea dos videos', state: 'done', chat: 'c1', videos: ['uno', 'dos'], summary: 'corto'},
    ],
    'Hice uno y dos, hasta el render.',
    where,
  );
  assert.match(note, /Paso 1 \(Mi cuenta, 20 reels\)\n  Resumen: Mi cuenta actualizada/);
  assert.match(note, /Paso 2 \(agente\)\n  Videos que creó: uno \(projects\/p\/videos\/uno\/\), dos \(projects\/p\/videos\/dos\/\)/);
  assert.doesNotMatch(note, /Resumen: corto/); // the last one's full text goes instead
  assert.match(note, /Resultado del paso anterior:\nHice uno y dos/);

  assert.match(runContext([{type: 'agent', prompt: 'x', state: 'done', chat: 'c', summary: 's'}], 's', where), /No creó videos/);
});

test("an agent step is told how to use its automation's memory, with every command of its tool", async () => {
  const {MEMORY_RULES, runSummary} = await import('./automations.ts');
  const rules = MEMORY_RULES('python3 "/app/tools/memory.py"');
  for (const c of ['show', 'check <clave>', 'search', 'add note|pending|done', 'edit <id>', 'close <id>', 'rm <id>']) assert.ok(rules.includes(`python3 "/app/tools/memory.py" ${c}`), c);
  assert.match(rules, /Las del creador son instrucciones suyas/);

  const summary = runSummary({id: 'r', automation: 'a', name: 'n', trigger: 'cron', started: 0, ended: 1, state: 'error', error: 'Falló el paso 2', steps: [
    {type: 'account', limit: 5, state: 'done', chat: null, summary: 'Mi cuenta actualizada'},
    {type: 'agent', prompt: 'x', state: 'error', chat: 'c', summary: 'no pude', videos: ['uno']},
    {type: 'agent', prompt: 'y', state: 'pending', chat: null},
  ]});
  assert.match(summary, /^Programada, falló \(Falló el paso 2\)\.\nPaso 1 \(Mi cuenta\): Mi cuenta actualizada\nPaso 2 \(agente\): no pude Videos creados: uno\.$/);
});
