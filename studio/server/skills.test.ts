import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-skills-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-skills-outside-'));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
process.on('exit', () => {
  fs.rmSync(root, {recursive: true, force: true});
  fs.rmSync(outside, {recursive: true, force: true});
});
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
  fs.writeFileSync(path.join(root, file), content);
};
write('projects/p/project.json', JSON.stringify({name: 'p', created: 1}));
write('.claude/skills/story/SKILL.md', '---\nname: story\ndescription: >-\n  Primero escribe el guion.\n  Después revisa el gancho.\n---\n\n# Story\n');
write('.claude/skills/story/references/guide.md', '# Guía\nConsulta esta referencia.');
write('.claude/skills/story/scripts/run.py', 'raise RuntimeError("este script no debe ejecutarse")');
write('.claude/skills/story/example.png', 'imagen');
write('.claude/skills/story/.env', 'SECRET=hidden');
write('.claude/skills/story/node_modules/pkg/index.js', 'dependencia');
write('.agents/skills/codex-skill/SKILL.md', '---\nname: "codex-skill"\ndescription: Skill local.\n---\n# Codex');
write('styles/paper/style.json', JSON.stringify({name: 'Papel', summary: 'Collage de papel.', skill: 'styles/paper/SKILL.md'}));
write('styles/paper/SKILL.md', '# Papel\nInstrucciones visuales.');
write('formats/voice/format.json', JSON.stringify({name: 'Tu voz', skill: 'formats/voice/SKILL.md'}));
write('formats/voice/SKILL.md', '# Tu voz');
fs.writeFileSync(path.join(outside, 'secret.md'), 'fuera de la carpeta de trabajo');
fs.symlinkSync(outside, path.join(root, '.claude/skills/external'));
fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, '.claude/skills/story/references/external.md'));
fs.symlinkSync(path.join(root, '.claude/skills/story'), path.join(root, '.claude/skills/story/references/loop'));
write('.claude/skills/escaped/SKILL.md', 'reemplazado');
fs.unlinkSync(path.join(root, '.claude/skills/escaped/SKILL.md'));
fs.symlinkSync(path.join(root, '.claude/skills/story/SKILL.md'), path.join(root, '.claude/skills/escaped/SKILL.md'));

test('lists workspace skills with folded descriptions, style metadata and no duplicates', async () => {
  const skills = await import('./skills.ts');
  const all = skills.listSkills();
  assert.equal(all.length, 4);
  assert.equal(all.find((s) => s.name === 'story')?.description, 'Primero escribe el guion. Después revisa el gancho.');
  assert.equal(all.find((s) => s.name === 'codex-skill')?.category, 'general');
  const style = all.find((s) => s.name === 'Papel')!;
  assert.equal(style.description, 'Collage de papel.');
  assert.equal(style.category, 'style');
  assert.equal(all.find((s) => s.name === 'Tu voz')?.category, 'format');
});

test('reads instructions, references and scripts as text, leaving binary files to the file manager', async () => {
  const skills = await import('./skills.ts');
  const story = skills.listSkills().find((s) => s.name === 'story')!;
  const detail = skills.skillDetail(story.id);
  assert.equal(detail.entry, 'SKILL.md');
  assert.equal(detail.files.length, 4);
  assert.match(skills.skillDocument(story.id, 'references/guide.md').content!, /Consulta esta referencia/);
  assert.match(skills.skillDocument(story.id, 'scripts/run.py').content!, /no debe ejecutarse/);
  assert.equal(skills.skillDocument(story.id, 'example.png').content, null);
});

test('rejects unregistered paths, traversal and symlinks outside a skill', async () => {
  const skills = await import('./skills.ts');
  const story = skills.listSkills().find((s) => s.name === 'story')!;
  for (const file of ['../SKILL.md', '../../../../../.env', '.env', 'references/external.md', path.join(outside, 'secret.md')]) {
    assert.throws(() => skills.skillDocument(story.id, file), /no pertenece/);
  }
  assert.throws(() => skills.skillDetail('no-existe'), /no está disponible/);
  // A reference replaced since it was listed must not expose the new symlink target.
  const guide = path.join(root, '.claude/skills/story/references/guide.md');
  fs.unlinkSync(guide);
  fs.symlinkSync(path.join(outside, 'secret.md'), guide);
  assert.throws(() => skills.skillDocument(story.id, 'references/guide.md'), /no pertenece/);
});
