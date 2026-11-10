// Auditoría: the merge of the three reviewers is held to what they gave, and a project's reports go through their
// states. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-audit-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects/p/videos/cdt/audio'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects/p/project.json'), JSON.stringify({name: 'p', created: 1}));
fs.writeFileSync(path.join(root, 'projects/p/videos/cdt/audio/vo.txt'), 'La retención en la fuente de un CDT es del cuatro por ciento de los intereses.\n');

const src = (url: string) => ({title: 'Fuente', url});

test('the merge keeps only reviewers and sources that exist, and puts errors first', async () => {
  const {cleanMerge} = await import('./fact-audit.ts');
  const reviews = [
    {n: 1, claims: [{claim: 'cuatro por ciento', verdict: 'ok' as const, explanation: '', correction: '', sources: [src('https://www.dian.gov.co/retencion/')]}]},
    {n: 3, claims: [{claim: 'cuatro por ciento', verdict: 'error' as const, explanation: '', correction: '', sources: [src('https://example.org/a')]}]},
  ];
  const m = cleanMerge(
    {
      summary: 'Casi todo bien.',
      findings: [
        {claim: 'otro dato', verdict: 'ok', explanation: 'x', correction: 'no aplica', sources: [src('https://www.dian.gov.co/retencion')], agents: [1]},
        {claim: 'cuatro por ciento', verdict: 'error', explanation: 'y', correction: 'z', sources: [src('https://example.org/a'), src('https://made.up/b')], agents: [1, 2, 3, 3], disputed: true},
        {claim: '', verdict: 'error'},
        {claim: 'sin veredicto', verdict: 'quizá'},
      ],
    },
    reviews,
  );
  assert.equal(m.summary, 'Casi todo bien.');
  assert.deepEqual(m.findings.map((f) => f.verdict), ['error', 'ok']);
  const [err, ok] = m.findings;
  assert.deepEqual(err.agents, [1, 3]); // reviewer 2 didn't answer; duplicates dropped
  assert.deepEqual(err.sources.map((s) => s.url), ['https://example.org/a']); // a URL no reviewer gave is dropped
  assert.equal(err.disputed, true);
  assert.equal(ok.correction, ''); // a correct one has nothing to correct
  assert.equal(ok.sources[0].url, 'https://www.dian.gov.co/retencion/'); // the reviewer's own spelling of it
});

test('a report goes through its states; turning automatic on counts the current scripts as seen', async () => {
  const audit = await import('./fact-audit.ts');
  const file = path.join(root, 'projects/p/fact-audit.json');
  let v = audit.setSettings({auto: true, prompt: '  Solo fuentes oficiales.  '});
  assert.equal(v.settings.auto, true);
  assert.equal(v.settings.prompt, 'Solo fuentes oficiales.');
  assert.equal(v.settings.effort, 'high'); // by default
  assert.throws(() => audit.setSettings({effort: 'muchísimo'}), /nivel de esfuerzo/);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).seen.cdt);
  assert.deepEqual(v.videos.map((x) => [x.slug, x.script, x.lastAudit]), [['cdt', true, null]]);
  assert.throws(() => audit.start([]), /elige al menos un video/);
  assert.throws(() => audit.start(['no-existe']), /no existen/);

  // A report as one that finished (no agent runs in this test).
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.reports.push({id: 'r1', slug: 'cdt', title: 'CDT', trigger: 'manual', script: 'x', scriptHash: 'otro', prompt: '', created: 1, finished: 2, status: 'done', state: 'open', reviewers: [], summary: '', error: '', findings: [{id: 'f', claim: 'cuatro por ciento', verdict: 'matiz', explanation: 'Depende.', correction: 'Dilo así.', sources: [src('https://www.dian.gov.co')], agents: [1, 2], disputed: false}]});
  fs.writeFileSync(file, JSON.stringify(s));
  v = audit.view();
  assert.equal(v.reports[0].stale, true); // the script it checked isn't the one there now
  assert.match(audit.agentText('cdt'), /\[Matiz\] «cuatro por ciento»: Depende\. Corrección: Dilo así\. Fuentes: https:\/\/www\.dian\.gov\.co/);
  assert.equal(audit.setState('r1', 'resolved').reports[0].state, 'resolved');
  assert.equal(audit.agentText('cdt'), ''); // only pending reports go to the agent
  assert.throws(() => audit.setState('r1', 'borrado'), /ese estado no existe/);
  assert.equal(audit.remove('r1').reports.length, 0);
});

test('a fact-audit.json that cannot be read is not written over by the next change', async () => {
  const audit = await import('./fact-audit.ts');
  const ws = await import('./workspace.ts');
  ws.openProject('p');
  const file = path.join(ws.projectDir('p'), 'fact-audit.json');
  const cut = '{"settings": {"auto": true, "prompt": "Revisa las cifras con la DIAN"}, "reports": [{"id": "r1", "slug": "cdt"';
  fs.writeFileSync(file, cut);
  assert.throws(() => audit.view(), /no se puede leer projects\/p\/fact-audit\.json/);
  assert.throws(() => audit.setSettings({auto: false}), /no se puede leer/);
  assert.equal(fs.readFileSync(file, 'utf8'), cut);
  fs.rmSync(file);
});
