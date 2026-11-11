// The form's "IA": a schedule said in words becomes a cron the studio can run, or a reason why not. The agent is faked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-automations-cron-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));

test('a schedule in words becomes a cron that runs; anything else says why', async () => {
  const {agentCli} = await import('./agent.ts');
  const automations = await import('./automations.ts');
  const asked: string[] = [];
  let reply = '';
  agentCli.ask = async (prompt: string) => (asked.push(prompt), reply);

  reply = '```json\n{"cron": "0  19 * * 2,4", "note": "Martes y jueves a las 7:00 p. m."}\n```';
  assert.deepEqual(await automations.cronFromText({text: 'martes y jueves a las 7 de la noche'}), {cron: '0 19 * * 2,4', note: 'Martes y jueves a las 7:00 p. m.'});
  assert.match(asked[0], /«martes y jueves a las 7 de la noche»/);

  // A cron the studio can't run, or no schedule at all: his answer's reason, or a plain one.
  reply = '{"cron": "0 25 * * *", "note": ""}';
  await assert.rejects(automations.cronFromText({text: 'a las 25'}), /no pude convertirlo/);
  reply = '{"cron": "", "note": "Eso no es un horario."}';
  await assert.rejects(automations.cronFromText({text: 'haz un video'}), /Eso no es un horario/);
  reply = 'no sé';
  await assert.rejects(automations.cronFromText({text: 'cuando sea'}), /no pude convertirlo/);

  // Nothing written: the agent isn't asked.
  await assert.rejects(automations.cronFromText({text: '  '}), /escribe cuándo/);
  assert.equal(asked.length, 4);
});
