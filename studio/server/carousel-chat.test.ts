// What the agent of a carousel is told: comments on several slides go with the next message, each by the slide's id and
// the version he was looking at, even after he reordered them; no voice or format; the studio's own changes as notes.
// Stand-in CLI, temp workspace.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import type {Comment} from '../shared/types.ts';
import type {TurnOptions} from './agent.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-carousel-chat-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
fs.mkdirSync(path.join(root, 'projects', 'p', 'videos'), {recursive: true});
fs.writeFileSync(path.join(root, 'projects', 'p', 'project.json'), JSON.stringify({name: 'QA', created: 1}));
const repo = path.resolve(import.meta.dirname, '../..');
fs.cpSync(path.join(repo, 'styles'), path.join(root, 'styles'), {recursive: true});

const slug = 'tres-laminas';
const dir = path.join(root, 'projects', 'p', 'videos', slug);
fs.mkdirSync(path.join(dir, 'out', 'v1'), {recursive: true});
fs.writeFileSync(path.join(dir, 'kind.txt'), 'carousel\n');
fs.writeFileSync(path.join(dir, 'style.txt'), 'panel-de-cifras\n');
const slides = [
  {id: 'portada', title: 'Portada', text: 'El 4x1000 explicado'},
  {id: 'cuenta', title: 'La cuenta', text: '4 pesos por cada 1000'},
  {id: 'cta', title: 'CTA', text: 'Guárdalo'},
];
fs.writeFileSync(path.join(dir, 'carousel.json'), JSON.stringify({width: 1080, height: 1350, slides}));
fs.writeFileSync(path.join(dir, 'out/v1/version.json'), JSON.stringify({name: 'v1', created: 1, width: 1080, height: 1350, slides: slides.map((s, i) => ({...s, file: `0${i + 1}.png`, source: null}))}));

const turns: TurnOptions[] = [];
const procs: ReturnType<typeof spawn>[] = [];
after(() => procs.forEach((p) => p.kill()));

test('comments on two slides reach the agent by id and version after a reorder, with no voice or format', async () => {
  const ws = await import('./workspace.ts');
  const {claude} = await import('./agent.ts');
  const chat = await import('./chat.ts');
  const carousel = await import('./carousel.ts');
  const lines = [{type: 'system', subtype: 'init', session_id: 's1'}, {type: 'result', is_error: false, result: 'hecho'}];
  claude.turn = (o) => {
    turns.push(o);
    const p = spawn(process.execPath, ['-e', `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(lines.map((l) => JSON.stringify(l)).join('\n'))}))`], {stdio: 'pipe'});
    procs.push(p);
    return p;
  };
  ws.openProject('p');
  fs.mkdirSync(ws.DATA, {recursive: true});

  // He comments slide 2 of v1 and slide 3 of the draft, then moves «cta» to the front before sending.
  const comments: Comment[] = [
    {id: 'c1', t: 0, text: 'la cifra más grande', frame: 'frames/a.png', slide: {id: 'cuenta', n: 2, title: 'La cuenta', version: 'v1'}},
    {id: 'c2', t: 0, text: 'que diga comenta 4X1000', slide: {id: 'cta', n: 3, title: 'CTA', version: 'v1', draft: true}},
  ];
  carousel.reorder(slug, ['cta', 'portada', 'cuenta']);
  const done = new Promise((resolve) => chat.send(slug, {text: 'cambia esto', comments, context: {page: 'carousel', slug, slide: 'cuenta', slideN: 3}}, undefined, {system: '', onDone: resolve}));
  procs.at(-1)!.stdin!.end();
  await done;
  const {prompt, systemPrompt} = turns.at(-1)!;
  assert.match(prompt, /Comentarios en las láminas/);
  assert.match(prompt, /lámina «cuenta» \(La cuenta\): era la 2 en out\/v1\/, ahora es la 3\n {2}«la cifra más grande»\n {2}imagen: .*tres-laminas\/frames\/a\.png/);
  assert.match(prompt, /lámina «cta» \(CTA\): era la 3 en el borrador, con su imagen de out\/v1\/, ahora es la 1\n {2}«que diga comenta 4X1000»/);
  assert.doesNotMatch(prompt, /timeline/);
  // A carousel's agent is told about slides, versions and export; never about voice, format or publishing it.
  assert.match(systemPrompt, /carousel\.json/);
  assert.match(systemPrompt, /render\.sh/);
  assert.doesNotMatch(systemPrompt, /voice\.json|tts\.py/);
  // What he sent keeps the comments with their slide, for the transcript.
  const items = chat.state(slug, chat.list(slug).active).items as {role: string; comments?: {slide?: {id: string}}[]}[];
  const sent = items.filter((m) => m.role === 'user').at(-1)!;
  assert.deepEqual(sent.comments!.map((c) => c.slide?.id), ['cuenta', 'cta']);
});
