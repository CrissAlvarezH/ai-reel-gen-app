// Fuentes de información: sources and their results live in their own project, a page isn't saved twice, the table
// filters, and the agent's requests name the right sources. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-sources-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
for (const id of ['uno', 'dos']) {
  fs.mkdirSync(path.join(root, 'projects', id), {recursive: true});
  fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), JSON.stringify({name: id, created: id === 'uno' ? 1 : 2}));
}

test('sources and results, per project, without duplicates', async () => {
  const ws = await import('./workspace.ts');
  const s = await import('./sources.ts');
  ws.openProject('uno');

  const v = s.addSource(undefined, {name: 'Modelos de IA', description: 'lanzamientos', links: 'https://www.anthropic.com/news\nOpenAI | https://openai.com/news/\nhttps://anthropic.com/news/'});
  const src = v.sources[0];
  assert.deepEqual(
    src.links.map((l) => l.label),
    ['anthropic.com', 'OpenAI'],
  ); // the same page twice is one link
  assert.throws(() => s.addSource(undefined, {name: 'modelos de ia'}), /ya hay una fuente/);
  assert.throws(() => s.addSource(undefined, {name: 'x', links: 'javascript:alert(1)'}), /no es un enlace válido/);
  assert.equal(s.view('dos').sources.length, 0); // the other project has none

  // By name too, and the same URL (written differently) isn't saved twice.
  const a = s.addItem(undefined, {source: 'modelos de ia', title: 'Claude nuevo', url: 'https://www.anthropic.com/news/claude?utm_source=x', published: '2026-11-01', tags: ['Anthropic', 'lanzamiento'], markdown: '# Claude\nmás rápido'});
  assert.equal(a.created, true);
  const again = s.addItem(undefined, {source: src.id, title: 'Otro título', url: 'https://anthropic.com/news/claude/'});
  assert.equal(again.created, false);
  assert.equal(again.item.title, 'Claude nuevo');
  s.addItem(undefined, {source: src.id, title: 'GPT nuevo', url: 'https://openai.com/news/gpt', summary: 'precios', published: '2025-01-01', tags: ['openai']});

  assert.equal(s.listItems(undefined, {}).total, 2);
  assert.equal(s.listItems(undefined, {}).rows[0].title, 'Claude nuevo'); // newest first
  assert.equal(s.listItems(undefined, {tag: 'anthropic'}).total, 1); // tags are lowercased
  assert.equal(s.listItems(undefined, {q: 'rapido'}).rows[0]?.title, 'Claude nuevo'); // the text, without accents
  assert.equal(s.listItems(undefined, {sinceDays: 60}).total, 1);
  assert.equal(s.item(undefined, a.item.id).markdown, '# Claude\nmás rápido');

  s.editItem(undefined, a.item.id, {state: 'used'});
  assert.equal(s.listItems(undefined, {state: 'pending'}).total, 1);
  assert.throws(() => s.editItem(undefined, a.item.id, {state: 'raro'}), /estado no válido/);

  s.markRun(undefined, src.id, {added: 2, note: 'bien'});
  const after = s.view().sources[0];
  assert.equal(after.lastRun?.added, 2);
  assert.equal(after.items, 2);
  assert.equal(after.fresh, 1);

  // An agent in another project writes there, whichever is open.
  s.addSource('dos', {name: 'Otra'});
  assert.equal(s.view().sources.length, 1);
  assert.equal(s.view('dos').sources[0].name, 'Otra');

  // The requests: every active source, or the chosen ones (deleted ones skipped); never Chrome when unattended.
  s.addSource(undefined, {name: 'Apagada', enabled: false});
  const all = s.extractRequest(undefined, [], 'tool');
  assert.match(all.note, /Modelos de IA/);
  assert.doesNotMatch(all.note, /Apagada/);
  assert.match(s.extractRequest(undefined, [src.id, 'borrada'], 'tool', true).note, /no tienes su Chrome/);
  assert.throws(() => s.extractRequest(undefined, ['borrada'], 'tool'), /ya no existen/);

  // "Nueva fuente": an interview that knows the sources there are, and ends creating it with the tool.
  const create = s.createRequest(undefined, 'novedades de modelos de IA', 'tool');
  assert.equal(create.text, 'novedades de modelos de IA');
  assert.match(create.note, /«Modelos de IA»/);
  assert.match(create.note, /tool source add/);
  assert.throws(() => s.createRequest(undefined, '  ', 'tool'), /qué información/);

  // A source goes with its results.
  s.removeSource(undefined, src.id);
  assert.equal(s.listItems(undefined, {}).total, 0);
  assert.equal(fs.existsSync(path.join(root, 'projects/uno/sources/items', `${a.item.id}.md`)), false);
});
