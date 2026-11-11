// Carousels next to videos: what a publication is (kind.txt, none = a video from before carousels), a carousel's draft
// and versions, reorders that keep each slide's id, comments that follow the slide they were about, the export, the
// audit by slide, the index and each project keeping its own. Temp workspace, no agent.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {test} from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-carousel-'));
process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
process.env.REEL_STUDIO_WORKSPACE = root;
process.env.REEL_STUDIO_CONFIG_DIR = path.join(root, '.cfg');
for (const [id, name, created] of [['uno', 'Canal Uno', 1], ['dos', 'Canal Dos', 2]] as const) {
  fs.mkdirSync(path.join(root, 'projects', id, 'videos'), {recursive: true});
  fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), JSON.stringify({name, created}));
}
// The app's own styles and carousel template, as a workspace has them.
const repo = path.resolve(import.meta.dirname, '../..');
fs.cpSync(path.join(repo, 'styles'), path.join(root, 'styles'), {recursive: true});
fs.cpSync(path.join(repo, 'carousel-template'), path.join(root, 'carousel-template'), {recursive: true});

const dir = (project: string, slug: string) => path.join(root, 'projects', project, 'videos', slug);
const write = (p: string, s: string) => (fs.mkdirSync(path.dirname(p), {recursive: true}), fs.writeFileSync(p, s));

// A real PNG of w×h (one flat colour), small enough to keep in memory many times.
function png(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((w + 1) * h, 0);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// A version as ./render.sh leaves it: NN.png in order, version.json with each slide's id, text and source hash.
function version(project: string, slug: string, name: string, slides: {id: string; text: string; source?: string | null}[], created: number, size = [1080, 1350]) {
  const out = path.join(dir(project, slug), 'out', name);
  fs.mkdirSync(out, {recursive: true});
  const entries = slides.map((s, i) => {
    const file = `${String(i + 1).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(out, file), png(size[0], size[1]));
    return {id: s.id, title: s.id, text: s.text, file, source: s.source ?? null};
  });
  write(path.join(out, 'version.json'), JSON.stringify({name, created, width: 1080, height: 1350, note: '', slides: entries}));
}

// The names of the files in a zip, from its central directory.
function zipNames(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    names.push(buf.toString('utf8', at + 46, at + 46 + n));
    at += 46 + n + extra + comment;
  }
  return names;
}

const ws = await import('./workspace.ts');
const reels = await import('./reels.ts');
const carousel = await import('./carousel.ts');
const {scaffoldCarousel} = await import('./scaffold.ts');
ws.openProject('uno');

// A video from before carousels: no kind.txt.
write(path.join(dir('uno', 'video-viejo'), 'audio/vo.txt'), 'Tu banco te cobra 4 por mil. Así se calcula.\n');
write(path.join(dir('uno', 'video-viejo'), 'title.txt'), 'Video viejo\n');
const slug = 'cuota-real';
scaffoldCarousel({root, project: path.join(root, 'projects', 'uno'), slug, style: 'panel-de-cifras', title: 'Cuota real', from: 'video-viejo'});
const slides = [
  {id: 'portada', title: 'Portada', text: 'Tu cuota no es lo que pagas'},
  {id: 'cifra', title: 'Cifra', text: 'La tasa efectiva anual es 28% en 2026'},
  {id: 'cta', title: 'CTA', text: 'Comenta CUOTA'},
];
write(path.join(dir('uno', slug), 'carousel.json'), JSON.stringify({width: 1080, height: 1350, slides}));
for (const s of slides) write(path.join(dir('uno', slug), 'src/slides', `${s.id}.tsx`), `export default () => null; // ${s.id}\n`);

test('a folder without kind.txt is a video, as before; a new carousel says it is one', () => {
  assert.equal(carousel.kindOf('video-viejo'), 'video');
  const v = reels.summary('video-viejo');
  assert.equal(v.kind, 'video');
  assert.equal(v.slideCount, null);
  assert.ok(v.words > 0 && v.seconds > 0);
  assert.equal(reels.detail('video-viejo').script.trim(), 'Tu banco te cobra 4 por mil. Así se calcula.');
  assert.equal(fs.readFileSync(path.join(dir('uno', slug), 'kind.txt'), 'utf8').trim(), 'carousel');
  assert.equal(fs.readFileSync(path.join(dir('uno', slug), 'from.txt'), 'utf8').trim(), 'video-viejo');
  const c = reels.summary(slug);
  assert.equal(c.kind, 'carousel');
  assert.equal(c.slideCount, 3);
  assert.equal(c.seconds, 0);
  assert.equal(c.voice, null);
  assert.deepEqual(c.progress.map((p) => p.key), ['textos', 'laminas', 'render', 'caption']);
});

test('a slug is never both: a carousel cannot take a video\'s folder', () => {
  assert.throws(() => scaffoldCarousel({root, project: path.join(root, 'projects', 'uno'), slug: 'video-viejo', style: 'panel-de-cifras'}), /ya existe/);
  assert.throws(() => scaffoldCarousel({root, project: path.join(root, 'projects', 'uno'), slug: 'otro', style: 'panel-de-cifras', from: 'no-existe'}), /no existe el video/);
});

test('versions are read in order, newest first; the draft shows each slide\'s newest picture and whether it changed since', () => {
  const hash = (id: string) => {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir('uno', slug), 'src/slides', `${id}.tsx`))).digest('hex').slice(0, 16);
  };
  version('uno', slug, 'v1', slides.map((s) => ({id: s.id, text: s.text, source: hash(s.id)})), 1000);
  version('uno', slug, 'v2', [{id: 'portada', text: slides[0].text, source: hash('portada')}], 2000);
  const vers = carousel.versions(slug);
  assert.deepEqual(vers.map((v) => v.name), ['v2', 'v1']);
  assert.deepEqual(vers[1].slides.map((s) => s.file), ['01.png', '02.png', '03.png']);
  const draft = carousel.draftSlides(slug);
  assert.deepEqual(draft.map((s) => s.image?.version), ['v2', 'v1', 'v1']);
  assert.ok(draft.every((s) => !s.image!.stale && s.source));
  write(path.join(dir('uno', slug), 'src/slides/cifra.tsx'), 'export default () => null; // cambiada\n');
  assert.equal(carousel.draftSlides(slug)[1].image!.stale, true);
  assert.equal(reels.summary(slug).thumb, vers[0].slides[0].url);
});

test('reordering keeps every id and refuses an order that loses or repeats one', () => {
  assert.throws(() => carousel.reorder(slug, ['cta', 'portada']), /cada lámina una vez/);
  assert.throws(() => carousel.reorder(slug, ['cta', 'cta', 'portada']), /cada lámina una vez/);
  const next = carousel.reorder(slug, ['cta', 'portada', 'cifra']);
  assert.deepEqual(next.map((s) => s.id), ['cta', 'portada', 'cifra']);
  assert.equal(next[2].text, slides[1].text);
  carousel.reorder(slug, ['portada', 'cifra', 'cta']);
});

test('a comment keeps the slide and version it was about after the slides move', () => {
  const comment = {id: 'portada', n: 1, title: 'Portada', version: 'v1'};
  assert.match(carousel.commentWhere(slug, comment), /lámina «portada» \(Portada\): era la 1 en out\/v1\/$/);
  carousel.reorder(slug, ['cifra', 'cta', 'portada']);
  assert.match(carousel.commentWhere(slug, comment), /era la 1 en out\/v1\/, ahora es la 3$/);
  assert.match(carousel.commentWhere(slug, {id: 'cta', n: 3, version: 'v1', draft: true}), /era la 3 en el borrador, con su imagen de out\/v1\/, ahora es la 2/);
  carousel.reorder(slug, ['portada', 'cifra', 'cta']);
});

test('adding and duplicating give new ids and files; removing leaves the file, and its id is not taken again', () => {
  const dup = carousel.addSlide(slug, {duplicate: 'cifra'});
  assert.equal(dup.id, 'cifra-2');
  assert.deepEqual(dup.slides.map((s) => s.id), ['portada', 'cifra', 'cifra-2', 'cta']);
  assert.equal(fs.readFileSync(path.join(dir('uno', slug), 'src/slides/cifra-2.tsx'), 'utf8'), fs.readFileSync(path.join(dir('uno', slug), 'src/slides/cifra.tsx'), 'utf8'));
  const add = carousel.addSlide(slug, {after: 'portada'});
  assert.equal(add.id, 'lamina');
  assert.equal(add.slides[1].id, 'lamina');
  carousel.removeSlide(slug, 'cifra-2');
  assert.ok(fs.existsSync(path.join(dir('uno', slug), 'src/slides/cifra-2.tsx')));
  assert.equal(carousel.addSlide(slug, {duplicate: 'cifra'}).id, 'cifra-3');
  carousel.removeSlide(slug, 'cifra-3');
  carousel.removeSlide(slug, 'lamina');
  assert.deepEqual(carousel.manifest(slug).slides.map((s) => s.id), ['portada', 'cifra', 'cta']);
  assert.throws(() => carousel.removeSlide(slug, 'no-esta'), /no está/);
});

test('export: a version\'s images numbered in its order, 1080×1350, with caption and credits', () => {
  write(path.join(dir('uno', slug), 'caption.md'), 'Tu cuota no es lo que pagas. Guárdalo.\n');
  const {filename, data} = carousel.exportVersion(slug, 'v1');
  assert.equal(filename, `${slug}-v1.zip`);
  const names = zipNames(data);
  assert.deepEqual(names.filter((n) => n.endsWith('.png')), [`${slug}-v1/01.png`, `${slug}-v1/02.png`, `${slug}-v1/03.png`]);
  assert.ok(names.includes(`${slug}-v1/caption.txt`));
  // The first image in the zip is the version's first slide, byte for byte.
  const first = fs.readFileSync(path.join(dir('uno', slug), 'out/v1/01.png'));
  assert.ok(data.includes(first));
  assert.deepEqual(carousel.pngSize(first), {width: 1080, height: 1350});
  assert.throws(() => carousel.exportVersion(slug, 'v9'), /no existe/);
  version('uno', slug, 'v3', [{id: 'portada', text: 'x'}], 3000, [1080, 1920]);
  assert.throws(() => carousel.exportVersion(slug, 'v3'), /no mide 1080×1350/);
  fs.rmSync(path.join(dir('uno', slug), 'out/v3'), {recursive: true});
});

test('the audit reads the slides\' text and points each claim at its slide, even after a reorder', () => {
  const script = carousel.scriptOf(carousel.manifest(slug).slides);
  assert.match(script, /^Lámina 1 \(portada, «Portada»\): Tu cuota no es lo que pagas$/m);
  assert.match(script, /^Lámina 2 \(cifra, «Cifra»\): La tasa efectiva anual es 28% en 2026$/m);
  const parsed = carousel.manifest(slug).slides;
  assert.deepEqual(carousel.slideOfClaim(parsed, 'Lámina 2: La tasa efectiva anual es 28%'), {id: 'cifra', n: 2, title: 'Cifra'});
  assert.deepEqual(carousel.slideOfClaim(parsed, 'tasa efectiva anual es 28% en 2026'), {id: 'cifra', n: 2, title: 'Cifra'});
  assert.equal(carousel.slideOfClaim(parsed, 'algo que no dice ninguna'), undefined);
  // A slide without text is left out but the others keep their real number.
  assert.match(carousel.scriptOf([{id: 'a', title: '', text: ''}, {id: 'b', title: '', text: 'dato'}]), /^Lámina 2 \(b\): dato$/);
});

test('only styles with a "carousel" block are offered; a built-in style copied before carousels takes it from the app', async () => {
  const styles = await import('./styles.ts');
  const ids = styles.listStyles().filter((s) => s.carousel).map((s) => s.id).sort();
  assert.deepEqual(ids, ['cuaderno-apuntes', 'panel-de-cifras']);
  // An older copy in the workspace, without the block.
  const p = path.join(root, 'styles/cuaderno-apuntes/style.json');
  const old = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete old.carousel;
  fs.writeFileSync(p, JSON.stringify(old));
  assert.ok(styles.listStyles().find((s) => s.id === 'cuaderno-apuntes')?.carousel?.look.length);
  assert.equal(styles.carouselStyle('collage-semitono'), null);
  assert.equal(styles.carouselStyle('panel-de-cifras')?.id, 'panel-de-cifras');
});

test('the index says what each publication is', async () => {
  const db = await import('./db.ts');
  db.sync(true);
  const rows = db.read().prepare("SELECT slug, kind, slides FROM videos WHERE project = 'uno' ORDER BY slug").all() as {slug: string; kind: string; slides: number | null}[];
  assert.deepEqual(rows.map((r) => ({...r})), [
    {slug: slug, kind: 'carousel', slides: 3},
    {slug: 'video-viejo', kind: 'video', slides: null},
  ]);
});

test('each project keeps its own: a carousel of «uno» is not in «dos»', () => {
  ws.openProject('dos');
  try {
    assert.deepEqual(reels.listSlugs(), []);
    assert.equal(carousel.isCarousel(slug), false);
    scaffoldCarousel({root, project: path.join(root, 'projects', 'dos'), slug, style: 'cuaderno-apuntes'});
    assert.equal(reels.summary(slug).slideCount, 0);
  } finally {
    ws.openProject('uno');
  }
  assert.equal(reels.summary(slug).slideCount, 3);
  assert.equal(fs.readFileSync(path.join(dir('dos', slug), 'style.txt'), 'utf8').trim(), 'cuaderno-apuntes');
});
