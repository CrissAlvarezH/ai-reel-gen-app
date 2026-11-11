// Carousels: Instagram posts of several images (4:5, 1080×1350), made by the agent like a video, in Remotion. They live
// with the videos in projects/<id>/videos/<slug>/ (one namespace of slugs), marked by kind.txt = "carousel":
//
//   carousel.json        the draft: size and slides in order, each {id, title, text, notes?}; the id never changes
//   src/slides/<id>.tsx  each slide's picture (carousel-template/src/lib.ts finds them by id)
//   out/vN/              a version: NN.png in its order, version.json (ids, text, source hashes) and source/ (what it
//                        was rendered from). Made by ./render.sh, never changed afterwards.
//   caption.md, CREDITS.md, automatizacion.json   like a video's
//   from.txt             the video whose script it started from, if any
//
// Reordering, adding or duplicating a slide only changes the draft; the agent (or Renderizar) makes the next version.
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type {CarouselDetail, CarouselSlide, CarouselSlideEntry, CarouselVersion, CommentSlide, ProgressStep, PublicationKind} from '../shared/types.ts';
import {readJson, writeJson} from './platform.ts';
import {VIDEOS} from './workspace.ts';
import {createdOf} from './created.ts';

export const KIND_FILE = 'kind.txt';
export const MANIFEST = 'carousel.json';
export const WIDTH = 1080;
export const HEIGHT = 1350;
export const SLIDE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const MAX_SLIDES = 20; // Instagram takes up to 20 images in a carousel

const httpError = (status: number, message: string) => Object.assign(new Error(message), {status});
const dirOf = (slug: string) => path.join(VIDEOS, slug);
const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const mtime = (p: string) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
const fileUrl = (slug: string, rel: string) => `/files/${encodeURIComponent(slug)}/${rel.split('/').map(encodeURIComponent).join('/')}`;

/* ───── Kind ───── */

export function kindIn(dir: string): PublicationKind {
  return read(path.join(dir, KIND_FILE))?.trim() === 'carousel' ? 'carousel' : 'video';
}
export const kindOf = (slug: string): PublicationKind => kindIn(dirOf(slug));
export const isCarousel = (slug: string) => kindOf(slug) === 'carousel';

/* ───── The draft (carousel.json) ───── */

type Manifest = {width: number; height: number; slides: CarouselSlideEntry[]};

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');
// What carousel.json says, made safe to use: unknown fields dropped, bad or repeated ids left out.
export function manifestIn(dir: string): Manifest {
  const raw = readJson<{width?: unknown; height?: unknown; slides?: unknown}>(path.join(dir, MANIFEST)) ?? {};
  const seen = new Set<string>();
  const slides = (Array.isArray(raw.slides) ? raw.slides : []).flatMap((x): CarouselSlideEntry[] => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!SLIDE_ID.test(id) || seen.has(id)) return [];
    seen.add(id);
    const notes = clean(o.notes, 2000);
    return [{id, title: clean(o.title, 200), text: clean(o.text, 4000), ...(notes ? {notes} : {})}];
  });
  const size = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 240 && v <= 4096 ? Math.round(v) : d);
  return {width: size(raw.width, WIDTH), height: size(raw.height, HEIGHT), slides};
}
export const manifest = (slug: string) => manifestIn(dirOf(slug));

// Writes the draft back keeping any field the agent added to the file that this code doesn't know.
function saveManifest(slug: string, slides: CarouselSlideEntry[]) {
  const p = path.join(dirOf(slug), MANIFEST);
  const raw = readJson<Record<string, unknown>>(p) ?? {};
  const before = new Map((Array.isArray(raw.slides) ? (raw.slides as Record<string, unknown>[]) : []).map((s) => [s?.id, s]));
  writeJson(p, {...raw, width: raw.width ?? WIDTH, height: raw.height ?? HEIGHT, slides: slides.map((s) => ({...(before.get(s.id) ?? {}), ...s}))});
}

const slideFile = (slug: string, id: string) => path.join(dirOf(slug), 'src', 'slides', `${id}.tsx`);
const hashOf = (p: string) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
};

/* ───── Versions (out/vN/) ───── */

export function versionsIn(dir: string, slug: string): CarouselVersion[] {
  const out = path.join(dir, 'out');
  let names: string[] = [];
  try {
    names = fs.readdirSync(out).filter((n) => /^v\d+$/.test(n));
  } catch {
    /* none yet */
  }
  return names
    .flatMap((name): CarouselVersion[] => {
      const v = readJson<{created?: unknown; width?: unknown; height?: unknown; note?: unknown; slides?: unknown}>(path.join(out, name, 'version.json'));
      if (!v || !Array.isArray(v.slides)) return [];
      const slides = (v.slides as Record<string, unknown>[]).flatMap((s) => {
        const file = typeof s?.file === 'string' && /^\d{2,3}\.png$/.test(s.file) ? s.file : null;
        if (!file || typeof s.id !== 'string' || !fs.existsSync(path.join(out, name, file))) return [];
        return [{id: s.id, title: clean(s.title, 200), text: clean(s.text, 4000), file, url: `${fileUrl(slug, `out/${name}/${file}`)}`, source: typeof s.source === 'string' ? s.source : null}];
      });
      if (!slides.length) return [];
      return [{name, created: typeof v.created === 'number' ? v.created : mtime(path.join(out, name)), width: Number(v.width) || WIDTH, height: Number(v.height) || HEIGHT, note: clean(v.note, 500), slides}];
    })
    .sort((a, b) => Number(b.name.slice(1)) - Number(a.name.slice(1)));
}
export const versions = (slug: string) => versionsIn(dirOf(slug), slug);

// The draft's slides, each with the newest picture rendered of it and whether that picture is behind its source.
export function draftSlides(slug: string, vers = versions(slug)): CarouselSlide[] {
  return manifest(slug).slides.map((s) => {
    const src = slideFile(slug, s.id);
    const hash = hashOf(src);
    for (const v of vers) {
      const hit = v.slides.find((x) => x.id === s.id);
      if (hit) return {...s, source: hash !== null, image: {version: v.name, url: hit.url, stale: (hit.source !== null && hit.source !== hash) || hit.text !== s.text}};
    }
    return {...s, source: hash !== null, image: null};
  });
}

/* ───── Summary and detail ───── */

function newestIn(p: string): number {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...fs.readdirSync(p).filter((n) => !n.startsWith('.')).map((n) => newestIn(path.join(p, n))));
}

// Where the carousel stands, from its files: the slides' text → each slide drawn → a version with all of it → caption.
export function progress(slug: string, slides: CarouselSlide[], vers: CarouselVersion[]): ProgressStep[] {
  const dir = dirOf(slug);
  const has = slides.length > 0;
  const latest = vers[0];
  const inputsAt = Math.max(mtime(path.join(dir, MANIFEST)), newestIn(path.join(dir, 'src')));
  const sameOrder = !!latest && latest.slides.map((s) => s.id).join(',') === slides.map((s) => s.id).join(',');
  const rendered = !!latest && sameOrder && slides.every((s) => s.image && !s.image.stale) && latest.created >= inputsAt - 2000;
  return [
    {key: 'textos', label: 'Textos', done: has && slides.every((s) => s.text.trim())},
    {key: 'laminas', label: 'Láminas', done: has && slides.every((s) => s.source), note: has && !slides.every((s) => s.source) ? `faltan ${slides.filter((s) => !s.source).length} en src/slides/` : undefined},
    {key: 'render', label: 'Render', done: rendered, note: latest && !rendered ? `hay cambios después de ${latest.name}` : undefined},
    {key: 'caption', label: 'Caption', done: !!read(path.join(dir, 'caption.md'))?.trim()},
  ];
}

// What the library and the sidebar need of a carousel (reels.ts summary() fills the rest).
export function summaryParts(slug: string) {
  const dir = dirOf(slug);
  const vers = versions(slug);
  const slides = draftSlides(slug, vers);
  const words = slides.reduce((n, s) => n + s.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);
  const first = slides.find((s) => s.image)?.image?.url ?? vers[0]?.slides[0]?.url ?? null;
  const updated = Math.max(mtime(dir), mtime(path.join(dir, MANIFEST)), mtime(path.join(dir, 'caption.md')), ...vers.map((v) => v.created));
  return {
    slides,
    vers,
    words,
    hook: slides[0]?.text.trim().split(/\n|(?<=[.?!])\s/)[0] ?? '',
    thumb: first,
    progress: progress(slug, slides, vers),
    created: createdOf(dir) ?? updated,
    updated,
  };
}

export const installs = new Set<string>();
const renders = new Map<string, {log: string}>();
export const rendering = (slug: string) => renders.has(slug);

export function detailParts(slug: string, vers: CarouselVersion[], slides: CarouselSlide[]) {
  const dir = dirOf(slug);
  const m = manifest(slug);
  const from = read(path.join(dir, 'from.txt'))?.trim() || null;
  return {
    kind: 'carousel' as const,
    width: m.width,
    height: m.height,
    slides,
    versions: vers,
    credits: read(path.join(dir, 'CREDITS.md')) ?? '',
    caption: read(path.join(dir, 'caption.md')) ?? '',
    automation: read(path.join(dir, 'automatizacion.json')) ?? '',
    from: from && fs.existsSync(path.join(VIDEOS, from)) ? {slug: from, title: read(path.join(VIDEOS, from, 'title.txt'))?.trim() || null} : null,
    rendering: rendering(slug),
    installing: installs.has(slug),
  } satisfies Partial<CarouselDetail>;
}

/* ───── Changes from the editor ───── */

// Not while the studio renders it: the version being made is the draft as it was when it started.
function editable(slug: string) {
  if (renders.has(slug)) throw httpError(409, 'espera a que termine el render para cambiar las láminas');
}

// A new order: the same ids, each once.
export function reorder(slug: string, order: unknown) {
  editable(slug);
  const {slides} = manifest(slug);
  if (!Array.isArray(order) || order.length !== slides.length || new Set(order).size !== order.length || !order.every((id) => slides.some((s) => s.id === id)))
    throw httpError(400, 'el orden tiene que nombrar cada lámina una vez');
  saveManifest(slug, order.map((id) => slides.find((s) => s.id === id)!));
  return manifest(slug).slides;
}

function freeId(slug: string, base: string) {
  const taken = new Set(manifest(slug).slides.map((s) => s.id));
  // Ids of slides taken out of the draft keep their file: a new slide doesn't take it over.
  const used = (id: string) => taken.has(id) || fs.existsSync(slideFile(slug, id));
  const b = base.replace(/-\d+$/, '').slice(0, 34) || 'lamina';
  if (!used(b)) return b;
  for (let i = 2; ; i++) if (!used(`${b}-${i}`)) return `${b}-${i}`;
}

const STUB = (title: string) => `// A slide added from Reel Studio: the agent draws it in the carousel's style.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SlideProps} from '../lib';

export default function Slide({index, total, title}: SlideProps) {
  return (
    <AbsoluteFill style={{background: '#F5F5F5', color: '#111', fontFamily: 'Inter, sans-serif', justifyContent: 'center', alignItems: 'center', padding: 120, textAlign: 'center'}}>
      <div style={{fontSize: 40, opacity: 0.5}}>{index + 1}/{total}</div>
      <div style={{fontSize: 84, fontWeight: 800}}>{title || ${JSON.stringify(title || 'Nueva lámina')}}</div>
    </AbsoluteFill>
  );
}
`;

// A new slide after another (or at the end), with a placeholder picture the agent replaces; or a copy of one.
export function addSlide(slug: string, body: {after?: unknown; duplicate?: unknown; title?: unknown}) {
  editable(slug);
  const {slides} = manifest(slug);
  if (slides.length >= MAX_SLIDES) throw httpError(400, `un carrusel lleva ${MAX_SLIDES} láminas como mucho`);
  const of = typeof body.duplicate === 'string' ? slides.find((s) => s.id === body.duplicate) : undefined;
  if (body.duplicate !== undefined && !of) throw httpError(404, 'esa lámina no está en el carrusel');
  const after = typeof body.after === 'string' ? slides.findIndex((s) => s.id === body.after) : of ? slides.indexOf(of) : slides.length - 1;
  const title = of ? `${of.title} (copia)`.slice(0, 200) : clean(body.title, 200).trim() || 'Nueva lámina';
  const id = freeId(slug, of ? of.id : 'lamina');
  fs.mkdirSync(path.dirname(slideFile(slug, id)), {recursive: true});
  if (of && fs.existsSync(slideFile(slug, of.id))) fs.copyFileSync(slideFile(slug, of.id), slideFile(slug, id));
  else fs.writeFileSync(slideFile(slug, id), STUB(title));
  const entry: CarouselSlideEntry = of ? {...of, id, title} : {id, title, text: ''};
  const next = [...slides];
  next.splice(after < 0 ? slides.length : after + 1, 0, entry);
  saveManifest(slug, next);
  return {id, slides: manifest(slug).slides};
}

// Out of the draft; its file stays in src/slides/ (and in every version that has it).
export function removeSlide(slug: string, id: string) {
  editable(slug);
  const {slides} = manifest(slug);
  if (!slides.some((s) => s.id === id)) throw httpError(404, 'esa lámina no está en el carrusel');
  saveManifest(slug, slides.filter((s) => s.id !== id));
  return manifest(slug).slides;
}

/* ───── Render from the studio ───── */

// ./render.sh in the carousel's folder: the next version. One at a time per carousel. onDone: the version, or the error.
export function render(slug: string, note: string, onDone: (r: {ok: boolean; version?: string; error?: string}) => void) {
  const dir = dirOf(slug);
  if (renders.has(slug)) throw httpError(409, 'ya se está renderizando');
  if (installs.has(slug) || !fs.existsSync(path.join(dir, 'node_modules', '.bin', 'remotion'))) throw httpError(409, 'aún se están instalando sus dependencias');
  if (!manifest(slug).slides.length) throw httpError(400, 'el carrusel no tiene láminas todavía');
  const job = {log: ''};
  renders.set(slug, job);
  const p = spawn('bash', ['render.sh', note.slice(0, 200)], {cwd: dir, env: process.env});
  const add = (d: Buffer) => (job.log = (job.log + d).slice(-4000));
  p.stdout.on('data', add);
  p.stderr.on('data', add);
  const end = (ok: boolean) => {
    if (!renders.delete(slug)) return;
    const version = /out\/(v\d+)\s*$/.exec(job.log.trim())?.[1];
    onDone(ok && version ? {ok, version} : {ok: false, error: job.log.trim().split('\n').slice(-6).join('\n') || 'falló el render'});
  };
  p.on('error', () => end(false));
  p.on('close', (code) => end(code === 0));
}

/* ───── Export ───── */

// Width and height of a PNG, from its header.
export function pngSize(buf: Buffer): {width: number; height: number} | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
}

// A plain zip (stored: PNGs don't compress further), enough for Finder, Windows and phones.
export function zip(files: {name: string; data: Buffer}[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.data.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, name, f.data);
    central.push(cd, name);
    offset += local.length + name.length + f.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

// A version's images, numbered in its order (01.png…), with the caption, the credits and the comment automation as
// they are now, in one zip named after the carousel and the version. Every image must be the carousel's size.
export function exportVersion(slug: string, name: unknown) {
  const v = versions(slug).find((x) => x.name === name);
  if (!v) throw httpError(404, 'esa versión no existe');
  const dir = dirOf(slug);
  const folder = `${slug}-${v.name}`;
  const files = v.slides.map((s, i) => {
    const data = fs.readFileSync(path.join(dir, 'out', v.name, s.file));
    const size = pngSize(data);
    if (!size || size.width !== v.width || size.height !== v.height) throw httpError(422, `la lámina ${i + 1} no mide ${v.width}×${v.height}`);
    return {name: `${folder}/${String(i + 1).padStart(2, '0')}.png`, data};
  });
  const text = (f: string) => read(path.join(dir, f))?.trim() ?? '';
  const extras = [
    {name: 'caption.txt', body: text('caption.md')},
    {name: 'creditos.md', body: text('CREDITS.md')},
    {name: 'automatizacion.json', body: text('automatizacion.json')},
  ].flatMap((x) => (x.body ? [{name: `${folder}/${x.name}`, data: Buffer.from(`${x.body}\n`, 'utf8')}] : []));
  return {filename: `${folder}.zip`, data: zip([...files, ...extras])};
}

/* ───── For the agent ───── */

// The carousel's text, one line per slide, for the audit (fact-audit.ts) and the agent: "Lámina 2 (id): text".
// Slides without text are left out, keeping each one's real number.
export function scriptOf(slides: CarouselSlideEntry[]) {
  const line = (t: string) => t.replace(/\s+/g, ' ').trim();
  return slides.flatMap((s, i) => (s.text.trim() ? [`Lámina ${i + 1} (${s.id}${line(s.title) ? `, «${line(s.title)}»` : ''}): ${line(s.text)}`] : [])).join('\n');
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%$.,]+/g, ' ').trim();
// The slide a claim quoted from scriptOf() is on: the one named in it, else the one whose text shares most of its words.
export function slideOfClaim(slides: CarouselSlideEntry[], claim: string): {id: string; n: number; title: string} | undefined {
  const named = /L[áa]mina\s+(\d+)/i.exec(claim);
  if (named) {
    const s = slides[Number(named[1]) - 1];
    if (s?.id) return {id: s.id, n: Number(named[1]), title: s.title};
  }
  const words = new Set(norm(claim.replace(/^L[áa]mina\s+\d+\s*\([^)]*\):\s*/i, '')).split(' ').filter((w) => w.length > 2));
  if (!words.size) return undefined;
  let best: {i: number; score: number} | null = null;
  slides.forEach((s, i) => {
    if (!s?.id) return;
    const t = norm(s.text);
    const tw = new Set(t.split(' '));
    const score = t.includes([...words].join(' ')) ? 2 : [...words].filter((w) => tw.has(w)).length / words.size;
    if (score > (best?.score ?? 0.34)) best = {i, score};
  });
  const hit = best as {i: number; score: number} | null;
  return hit ? {id: slides[hit.i].id, n: hit.i + 1, title: slides[hit.i].title} : undefined;
}

// How a slide comment reads for the agent: where it is now (it may have moved since) and what it was looking at.
export function commentWhere(slug: string, c: CommentSlide) {
  const now = manifest(slug).slides.findIndex((s) => s.id === c.id);
  const moved = now < 0 ? ', ya no está en el borrador' : now + 1 !== c.n ? `, ahora es la ${now + 1}` : '';
  const seen = c.draft || !c.version ? `en el borrador${c.version ? `, con su imagen de out/${c.version}/` : ', sin render'}` : `en out/${c.version}/`;
  return `lámina «${c.id}»${c.title ? ` (${c.title})` : ''}: era la ${c.n} ${seen}${moved}`;
}
