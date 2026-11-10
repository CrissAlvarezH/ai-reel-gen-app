// Memoria de las automatizaciones: entries, one per done key, the brief an agent starts with, search through the
// studio's index, and the run summaries kept. Temp workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-memory-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');

test('entries: one per done key, pending closed and opened again, kinds and limits checked', async () => {
  const m = await import('./automation-memory.ts');
  const {PROJECT} = await import('./workspace.ts');
  const P = PROJECT;
  assert.equal(m.brief(P, 'a1'), 'La memoria está vacía: es la primera ejecución o nadie anotó nada todavía.');

  const done = m.add(P, 'a1', {kind: 'done', text: 'Video creado', key: 'Tarjeta de crédito'}, 'agent', 'run1');
  assert.equal(done.existed, false);
  assert.equal(done.entry.run, 'run1');
  // The same key, written another way: that same entry.
  const again = m.add(P, 'a1', {kind: 'done', text: 'Video creado y renderizado', key: 'tarjeta de credito'}, 'agent');
  assert.equal(again.existed, true);
  assert.equal(again.entry.id, done.entry.id);
  assert.equal(m.view(P, 'a1').entries.length, 1);
  assert.equal(m.check(P, 'a1', 'TARJETA DE CRÉDITO')?.text, 'Video creado y renderizado');
  assert.equal(m.check(P, 'a1', 'hipoteca'), null);

  const pend = m.add(P, 'a1', {kind: 'pending', text: 'Falta el render de "cdt"'}, 'agent').entry;
  assert.ok(m.edit(P, 'a1', pend.id, {closed: true}, 'agent').closed);
  assert.equal(m.edit(P, 'a1', pend.id, {closed: false}, 'creator').closed, undefined);

  assert.throws(() => m.add(P, 'a1', {kind: 'run', text: 'x'}, 'agent'), /las ejecuciones las anota el studio/);
  assert.throws(() => m.add(P, 'a1', {kind: 'note', text: 'x', key: 'k'}, 'agent'), /solo para los hechos/);
  assert.throws(() => m.add(P, 'a1', {kind: 'note', text: '  '}, 'agent'), /texto/);
  assert.throws(() => m.edit(P, 'a1', 'nope', {text: 'x'}, 'agent'), /no existe/);
  const other = m.add(P, 'a1', {kind: 'done', text: 'otro', key: 'cdt'}, 'agent').entry;
  assert.throws(() => m.edit(P, 'a1', other.id, {key: 'Tarjeta de crédito'}, 'agent'), /ya hay un hecho/);
  // A done that becomes a note loses its key.
  assert.equal(m.edit(P, 'a1', other.id, {kind: 'note'}, 'creator').key, undefined);
});

test('the brief: notes (his first), open pending, pinned and the last 3 runs; what is done only counted', async () => {
  const m = await import('./automation-memory.ts');
  const {PROJECT: P} = await import('./workspace.ts');
  m.add(P, 'b', {kind: 'note', text: 'Los lunes, temas de tarjetas'}, 'agent');
  m.add(P, 'b', {kind: 'note', text: 'Nunca más de 60 s'}, 'creator');
  m.add(P, 'b', {kind: 'pending', text: 'Terminar el video de CDT'}, 'agent');
  const closed = m.add(P, 'b', {kind: 'pending', text: 'Ya resuelto'}, 'agent').entry;
  m.edit(P, 'b', closed.id, {closed: true}, 'agent');
  m.add(P, 'b', {kind: 'done', text: 'oculto', key: 'oculto'}, 'agent');
  m.add(P, 'b', {kind: 'done', text: 'a la vista', key: 'fijo', pinned: true}, 'agent');
  for (let i = 1; i <= 5; i++) m.logRun(P, 'b', `r${i}`, `corrida ${i}`);

  const b = m.brief(P, 'b', 'memory.py');
  assert.ok(b.indexOf('(del creador) Nunca más de 60 s') < b.indexOf('Los lunes'));
  assert.match(b, /## Pendientes \(1\)\n- \[\w+\] \(desde el .+\) Terminar el video de CDT/);
  assert.doesNotMatch(b, /Ya resuelto/);
  assert.match(b, /## Fijados \(1\)\n- \[\w+\] fijo: a la vista/);
  assert.doesNotMatch(b, /oculto/);
  assert.match(b, /corrida 5[\s\S]*corrida 4[\s\S]*corrida 3/);
  assert.doesNotMatch(b, /corrida 2/);
  assert.match(b, /Hechos registrados: 2 \(1 fijados arriba\)[\s\S]*memory\.py check <clave>/);
});

test("search goes through the studio's index, without accents, by kind, and follows every write", async () => {
  const m = await import('./automation-memory.ts');
  const {PROJECT: P} = await import('./workspace.ts');
  const e = m.add(P, 'c', {kind: 'done', text: 'Guion sobre la cuota de manejo', key: 'cuota-manejo'}, 'agent').entry;
  m.add(P, 'c', {kind: 'note', text: 'La cuota inicial va aparte'}, 'agent');
  assert.deepEqual(m.search(P, 'c', {q: 'CUOTA manejo'}).map((x) => x.id), [e.id]);
  assert.equal(m.search(P, 'c', {q: 'cuota'}).length, 2);
  assert.equal(m.search(P, 'c', {q: 'cuota', kind: 'note'}).length, 1);
  assert.equal(m.search(P, 'c', {q: 'guión'})[0].key, 'cuota-manejo');
  m.remove(P, 'c', e.id);
  assert.equal(m.search(P, 'c', {q: 'manejo'}).length, 0);
  // Another automation's memory isn't searched.
  assert.equal(m.search(P, 'zzz', {q: 'cuota'}).length, 0);
  m.clear(P, 'c');
  assert.ok(!fs.existsSync(m.fileOf(P, 'c')));
  assert.equal(m.search(P, 'c', {}).length, 0);
});

test('run summaries: the oldest unpinned go past 300, pinned ones stay', async () => {
  const m = await import('./automation-memory.ts');
  const {PROJECT: P} = await import('./workspace.ts');
  m.logRun(P, 'd', 'first', 'la primera');
  const first = m.view(P, 'd').entries[0];
  m.edit(P, 'd', first.id, {pinned: true}, 'creator');
  for (let i = 0; i < 305; i++) m.logRun(P, 'd', `r${i}`, `corrida ${i}`);
  const runs = m.view(P, 'd').entries.filter((x) => x.kind === 'run');
  assert.equal(runs.length, 301);
  assert.ok(runs.some((x) => x.text === 'la primera'));
  assert.ok(!runs.some((x) => x.text === 'corrida 4'));
  assert.ok(runs.some((x) => x.text === 'corrida 5'));
});
