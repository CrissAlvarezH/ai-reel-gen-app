// Turns a fresh render (a folder of frames, one per slide, from ./render.sh) into the carousel's next version:
// out/vN/01.png … NN.png in the order of carousel.json, out/vN/version.json and out/vN/source/ (carousel.json and src/
// as they were). A version is complete and never changes afterwards: comments and exports point at it.
// usage: node version.mjs <frames dir> <snapshot dir> [note]   → prints out/vN
// The snapshot is carousel.json and src/ as ./render.sh found them before rendering: what the frames were made from,
// even if the draft changed while they rendered.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [framesDir, snapshot, note = ''] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const carousel = JSON.parse(fs.readFileSync(path.join(snapshot, 'carousel.json'), 'utf8'));
const slides = carousel.slides ?? [];
const frames = fs
  .readdirSync(framesDir)
  .filter((n) => /\.png$/i.test(n))
  .sort((a, b) => Number(a.match(/(\d+)\.png$/i)?.[1] ?? 0) - Number(b.match(/(\d+)\.png$/i)?.[1] ?? 0));
if (frames.length !== slides.length) {
  console.error(`se renderizaron ${frames.length} imágenes para ${slides.length} láminas`);
  process.exit(1);
}

// The next free vN, claimed by creating it: two renders at once (the studio's and the agent's) never share one.
const out = path.join(here, 'out');
fs.mkdirSync(out, {recursive: true});
let name, dir;
for (;;) {
  const taken = fs.readdirSync(out).map((n) => Number(/^v(\d+)$/.exec(n)?.[1] ?? 0));
  name = `v${Math.max(0, ...taken) + 1}`;
  dir = path.join(out, name);
  try {
    fs.mkdirSync(dir);
    break;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) : null);
const pad = (i) => String(i + 1).padStart(2, '0');
const entries = slides.map((s, i) => {
  const file = `${pad(i)}.png`;
  fs.copyFileSync(path.join(framesDir, frames[i]), path.join(dir, file));
  return {id: s.id, title: s.title ?? '', text: s.text ?? '', file, source: sha(path.join(snapshot, 'src/slides', `${s.id}.tsx`))};
});

// What it was made from, to read it back or render it again.
const src = path.join(dir, 'source');
fs.mkdirSync(src, {recursive: true});
fs.copyFileSync(path.join(snapshot, 'carousel.json'), path.join(src, 'carousel.json'));
fs.cpSync(path.join(snapshot, 'src'), path.join(src, 'src'), {recursive: true});
for (const f of ['caption.md', 'CREDITS.md']) if (fs.existsSync(path.join(here, f))) fs.copyFileSync(path.join(here, f), path.join(src, f));

fs.writeFileSync(
  path.join(dir, 'version.json'),
  JSON.stringify({name, created: Date.now(), width: carousel.width ?? 1080, height: carousel.height ?? 1350, note: String(note).slice(0, 500), slides: entries}, null, 2) + '\n',
);
console.log(`out/${name}`);
