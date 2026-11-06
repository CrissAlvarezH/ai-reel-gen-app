// Perfil de audiencia: what's saved, where the "who" goes, and reading the AI's JSON. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-aud-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/canal'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/canal/project.json'), JSON.stringify({name: 'canal', created: 1}));

test('the "who" is the profile\'s audience; the rest is in audience.json, cleaned', async () => {
  const ws = await import('./workspace.ts');
  const config = await import('./config.ts');
  const aud = await import('./audience.ts');
  ws.openProject('canal');
  config.setProfile({audience: 'mamás ocupadas'});
  assert.equal(aud.get().who, 'mamás ocupadas');
  assert.equal(aud.get().onboarded, false);

  const a = aud.save({who: ' papás ocupados ', result: 'bajar de peso', wants: [{want: 'más energía', so1: '', so2: ''}, {want: '', so1: '', so2: ''}], problems: ['dolor de espalda', 'dolor de espalda', ''], onboarded: true});
  assert.equal(config.getProfile().audience, 'papás ocupados');
  assert.deepEqual([a.who, a.result, a.wants.length, a.problems, a.onboarded], ['papás ocupados', 'bajar de peso', 1, ['dolor de espalda'], true]);
  const file = JSON.parse(fs.readFileSync(path.join(root, 'projects/canal/config/audience.json'), 'utf8'));
  assert.equal(file.who, undefined); // only in the profile

  // A partial save keeps the rest.
  assert.deepEqual(aud.save({product: {what: 'un curso', price: '$50', problems: ''}}).wants, a.wants);
  assert.match(aud.audienceText('cfg'), /ayuda a papás ocupados a conseguir bajar de peso[\s\S]*un curso \(\$50\)[\s\S]*dolor de espalda[\s\S]*cfg\/audience\.json/);
});

test('the AI\'s answer is read even wrapped in prose or a fence', async () => {
  const {parseJson} = await import('./audience.ts');
  assert.deepEqual(parseJson('Aquí va:\n```json\n{"1": [{"so1": "a", "so2": "b"}]}\n```'), {1: [{so1: 'a', so2: 'b'}]});
  assert.deepEqual(parseJson('[{"name": "Set A"}]'), [{name: 'Set A'}]);
  assert.throws(() => parseJson('no puedo'), /no devolvió/);
});
