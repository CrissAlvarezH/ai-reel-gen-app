// Turns a fresh render (a folder of frames, one per slide, from ./render.sh) into the carousel's next version:
// out/vN/01.png … NN.png in the order of carousel.json, out/vN/version.json and out/vN/source/ (carousel.json and src/
// as they were). A version is complete and never changes afterwards: comments and exports point at it.
// usage: node version.mjs <frames dir> [note]   → prints out/vN
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [framesDir, note = ''] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const carousel = JSON.parse(fs.readFileSync(path.join(here, 'carousel.json'), 'utf8'));
const slides = carousel.slides ?? [];
const frames = fs
  .readdirSync(framesDir)
  .filter((n) => /\.png$/i.test(n))
  .sort((a, b) => Number(a.match(/(\d+)\.png$/i)?.[1] ?? 0) - Number(b.match(/(\d+)\.png$/i)?.[1] ?? 0));
if (frames.length !== slides.length) {
  console.error(`se renderizaron ${frames.length} imágenes para ${slides.length} láminas`);
  process.exit(1);
}

const out = path.join(here, 'out');
const taken = fs.existsSync(out) ? fs.readdirSync(out).map((n) => Number(/^v(\d+)$/.exec(n)?.[1] ?? 0)) : [];
const name = `v${Math.max(0, ...taken) + 1}`;
const dir = path.join(out, name);
fs.mkdirSync(dir, {recursive: true});

const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) : null);
const pad = (i) => String(i + 1).padStart(2, '0');
const entries = slides.map((s, i) => {
  const file = `${pad(i)}.png`;
  fs.copyFileSync(path.join(framesDir, frames[i]), path.join(dir, file));
  return {id: s.id, title: s.title ?? '', text: s.text ?? '', file, source: sha(path.join(here, 'src/slides', `${s.id}.tsx`))};
});

// What it was made from, to read it back or render it again.
const src = path.join(dir, 'source');
fs.mkdirSync(src, {recursive: true});
fs.copyFileSync(path.join(here, 'carousel.json'), path.join(src, 'carousel.json'));
fs.cpSync(path.join(here, 'src'), path.join(src, 'src'), {recursive: true});
for (const f of ['caption.md', 'CREDITS.md']) if (fs.existsSync(path.join(here, f))) fs.copyFileSync(path.join(here, f), path.join(src, f));

fs.writeFileSync(
  path.join(dir, 'version.json'),
  JSON.stringify({name, created: Date.now(), width: carousel.width ?? 1080, height: carousel.height ?? 1350, note: String(note).slice(0, 500), slides: entries}, null, 2) + '\n',
);
console.log(`out/${name}`);
