// Publicar: a finished version of a video (out/<name>.mp4) or of a carousel (out/<name>/NN.png) to the project's
// Instagram account, now or at a time, through his Reel Studio account (cloud.ts). Here only the upload and the record
// of what was sent, videos/<slug>/publicaciones.json (it travels with the video's sync); the account has the truth and
// does the rest, a scheduled one at its time with this app closed. A video's cover is out/miniatura.*, and a carousel's
// slides go, all as JPEGs (Instagram's only kind of image).
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import * as account from './account.ts';
import {MAX_SLIDES, kindIn, versionsIn} from './carousel.ts';
import * as cloud from './cloud.ts';
import type {CloudPublication, PresignedPut} from './cloud.ts';
import {writeJson} from './platform.ts';
import {FILE, rawOf, recordsOf} from './publications-file.ts';
import {coverUrl, httpError, title as titleOf} from './reels.ts';
import {VIDEOS} from './workspace.ts';
import type {CalendarPublication, PublicationStatus, PublishInput, VideoPublication, VideoPublications} from '../shared/types.ts';

const KEEP = 20;
const FINAL: ReadonlySet<PublicationStatus> = new Set(['published', 'error', 'canceled']);
const MAX_VIDEO = 300 * 1024 * 1024; // Instagram's limits
const MAX_COVER = 8 * 1024 * 1024;
const MAX_CAPTION = 2200;
const MIN_SLIDES = 2;
const THUMB = /^miniatura\.(png|jpe?g|webp)$/i;
// How a publication for now is followed until it's out; tests shorten them.
export const timing = {follow: 5000, followFor: 20 * 60_000, retry: 2000};

const run = promisify(execFile);

// Uploads going on in this process: their record isn't refreshed from the account until they end.
const sending = new Set<string>();

// Re-read and rewritten on every change: the file is shared by the uploads and the page's refreshes.
function update(dir: string, id: string, set: Partial<VideoPublication>) {
  const list = rawOf(dir);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const next = {...list[i], ...set};
  if (JSON.stringify(next) === JSON.stringify(list[i])) return next; // unchanged: don't touch the file (it syncs)
  list[i] = next;
  writeJson(path.join(dir, FILE), list);
  if (next.status === 'published') void noteOut(dir, next);
  return next;
}

// Out on Instagram: into Mi cuenta right away (account.notePublished), with the cover as its picture.
const noting = new Set<string>();
async function noteOut(dir: string, r: VideoPublication) {
  const project = path.basename(path.dirname(path.dirname(dir))); // projects/<id>/videos/<slug>
  // Mi cuenta keeps the account's reels: a carousel isn't one.
  if (!r.permalink || noting.has(r.id) || kindIn(dir) === 'carousel') return;
  noting.add(r.id);
  let cover: Awaited<ReturnType<typeof coverJpeg>> = null;
  try {
    if (account.knowsPublished(project, r.account, r.permalink)) return;
    cover = await coverJpeg(dir).catch(() => null);
    account.notePublished(project, {account: r.account, permalink: r.permalink, caption: captionOf(dir), posted: r.scheduledAt ?? r.createdAt}, cover?.file);
  } catch (e) {
    console.error('Mi cuenta, reel publicado:', (e as Error).message);
  } finally {
    if (cover?.temp) fs.rmSync(cover.file, {force: true});
    noting.delete(r.id);
  }
}

const fromCloud = (p: CloudPublication): Partial<VideoPublication> => ({
  status: p.status,
  error: p.error ?? null,
  permalink: p.permalink ?? null,
  ...(p.scheduledAt !== undefined ? {scheduledAt: p.scheduledAt ?? null} : {}),
});

const coverIn = (dir: string) => {
  try {
    return fs.readdirSync(path.join(dir, 'out')).find((n) => THUMB.test(n)) ?? null;
  } catch {
    return null;
  }
};

const captionOf = (dir: string) => {
  try {
    return fs.readFileSync(path.join(dir, 'caption.md'), 'utf8').trim();
  } catch {
    return '';
  }
};

/* ───── The page ───── */

export async function list(slug: string): Promise<VideoPublications> {
  const dir = path.join(VIDEOS, slug);
  const signedIn = cloud.signedIn();
  // Each one still on its way is asked about (a few at a time is plenty: a video has few).
  const items = await Promise.all(
    recordsOf(dir).map(async (r) => {
      if (r.status === 'published') void noteOut(dir, r); // one published before Mi cuenta was told
      if (!signedIn || FINAL.has(r.status) || sending.has(r.id)) return r;
      try {
        return update(dir, r.id, fromCloud(await cloud.publicationsApi.get(r.id))) ?? r;
      } catch (e) {
        if ((e as {status?: number}).status === 404) return update(dir, r.id, {status: 'error', error: 'Tu cuenta ya no tiene esta publicación'}) ?? r;
        return r; // offline: the last state known
      }
    }),
  );
  return {signedIn, account: cloud.linkedAccount()?.username ?? null, caption: captionOf(dir), cover: !!coverIn(dir), items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))};
}

// The library: its cards show each video's last known state, so the ones whose moment came (sent for now, or scheduled
// for a time already past) are asked about; a change rewrites publicaciones.json and the watcher redraws the card.
// At most once a minute, in the background.
let dueAt = 0;
export function refreshDue(now = Date.now()) {
  if (now - dueAt < 60_000 || !cloud.signedIn()) return;
  dueAt = now;
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(VIDEOS, {withFileTypes: true}).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return;
  }
  const due = (r: {status: PublicationStatus; scheduledAt: string | null}) => !FINAL.has(r.status) && (!r.scheduledAt || Date.parse(r.scheduledAt) <= now);
  for (const slug of slugs) if (recordsOf(path.join(VIDEOS, slug)).some(due)) list(slug).catch(() => {});
}

// Publicaciones programadas: what every video and carousel of the project sent, as its publicaciones.json has it, at once. Each video is
// then refreshed like its page does, in the background (the account takes seconds to answer): a change rewrites the
// file and the page, told by the watcher, reads it again. Asked about once every ASK_EVERY at most, so those reads
// don't ask again. Canceled ones stay out.
const ASK_EVERY = 3000;
const asked = new Map<string, number>(); // video folder → when it was last asked about
export async function calendar(now = Date.now()): Promise<CalendarPublication[]> {
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(VIDEOS, {withFileTypes: true}).filter((d) => d.isDirectory() && fs.existsSync(path.join(VIDEOS, d.name, FILE))).map((d) => d.name);
  } catch {
    return [];
  }
  const all = slugs.map((slug) => {
    const dir = path.join(VIDEOS, slug);
    if (now - (asked.get(dir) ?? 0) >= ASK_EVERY) {
      asked.set(dir, now);
      list(slug).catch(() => {});
    }
    const shown = recordsOf(dir).filter((p) => p.status !== 'canceled');
    if (!shown.length) return [];
    const head = {slug, kind: kindIn(dir), title: titleOf(slug) ?? slug, cover: coverUrl(slug), caption: captionOf(dir)};
    return shown.map((p) => ({...p, ...head, at: p.scheduledAt ?? p.createdAt}));
  });
  return all.flat().sort((a, b) => a.at.localeCompare(b.at));
}

/* ───── Sending ───── */

function parse(input: unknown): PublishInput {
  const b = (input ?? {}) as Record<string, unknown>;
  const version = typeof b.version === 'string' ? b.version : '';
  if (!version || /[/\\]/.test(version) || /\.raw$/i.test(version) || version.startsWith('.')) throw httpError(400, 'elige una versión');
  const scheduledAt = b.scheduledAt == null || b.scheduledAt === '' ? null : String(b.scheduledAt);
  if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) throw httpError(400, 'la fecha de publicación no es válida');
  return {version, scheduledAt, shareToFeed: b.shareToFeed !== false};
}

// The cover as a JPEG: the one he has, or a copy of the PNG/WebP made by ffmpeg in the temp folder.
async function coverJpeg(dir: string): Promise<{file: string; size: number; temp: boolean} | null> {
  const name = coverIn(dir);
  if (!name) return null;
  const src = path.join(dir, 'out', name);
  let file = src;
  const temp = !/\.jpe?g$/i.test(name);
  if (temp) {
    file = path.join(os.tmpdir(), `reel-studio-portada-${randomUUID()}.jpg`);
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-q:v', '2', file], {timeout: 60_000});
    } catch {
      fs.rmSync(file, {force: true});
      throw httpError(500, 'no se pudo preparar la portada como JPEG (¿está instalado ffmpeg?)');
    }
  }
  const size = fs.statSync(file).size;
  if (size > MAX_COVER) {
    if (temp) fs.rmSync(file, {force: true});
    throw httpError(413, 'la portada pesa más de 8 MB, el máximo de Instagram');
  }
  return {file, size, temp};
}

// A carousel's version as JPEGs in a temp folder, in its order, made by ffmpeg from its PNGs. 2 to MAX_SLIDES of them.
async function slidesJpeg(dir: string, slug: string, version: string): Promise<{files: string[]; sizes: number[]; tmp: string}> {
  const v = versionsIn(dir, slug).find((x) => x.name === version);
  if (!v) throw httpError(404, 'esa versión ya no está: renderiza el carrusel de nuevo');
  if (v.slides.length < MIN_SLIDES) throw httpError(400, `un carrusel lleva al menos ${MIN_SLIDES} láminas`);
  if (v.slides.length > MAX_SLIDES) throw httpError(400, `Instagram publica como mucho ${MAX_SLIDES} láminas por carrusel, y ${version} tiene ${v.slides.length}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-carrusel-'));
  try {
    const files: string[] = [];
    const sizes: number[] = [];
    for (const [i, s] of v.slides.entries()) {
      const file = path.join(tmp, `${String(i + 1).padStart(2, '0')}.jpg`);
      try {
        await run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'out', version, s.file), '-q:v', '2', file], {timeout: 60_000});
      } catch {
        throw httpError(500, `no se pudo preparar la lámina ${i + 1} como JPEG (¿está instalado ffmpeg?)`);
      }
      const size = fs.statSync(file).size;
      if (size > MAX_COVER) throw httpError(413, `la lámina ${i + 1} pesa más de 8 MB, el máximo de Instagram`);
      files.push(file);
      sizes.push(size);
    }
    return {files, sizes, tmp};
  } catch (e) {
    fs.rmSync(tmp, {recursive: true, force: true});
    throw e;
  }
}

// What one publication uploads: the files, and what the account is told about them.
type Prepared = {kind: 'video' | 'carousel'; size: number; slides?: number[]; coverSize: number | null; files: string[]; done: () => void};

async function prepare(dir: string, slug: string, version: string): Promise<Prepared> {
  if (kindIn(dir) === 'carousel') {
    const j = await slidesJpeg(dir, slug, version);
    return {kind: 'carousel', size: j.sizes.reduce((a, b) => a + b, 0), slides: j.sizes, coverSize: null, files: j.files, done: () => fs.rmSync(j.tmp, {recursive: true, force: true})};
  }
  const file = path.join(dir, 'out', `${version}.mp4`);
  const size = fs.statSync(file, {throwIfNoEntry: false})?.size;
  if (!size) throw httpError(404, 'esa versión ya no está: renderiza el video de nuevo');
  if (size > MAX_VIDEO) throw httpError(413, 'el video pesa más de 300 MB, el máximo de Instagram');
  const cover = await coverJpeg(dir);
  return {kind: 'video', size, coverSize: cover?.size ?? null, files: cover ? [file, cover.file] : [file], done: () => void (cover?.temp && fs.rmSync(cover.file, {force: true}))};
}

export async function publish(slug: string, input: unknown): Promise<VideoPublication> {
  const dir = path.join(VIDEOS, slug); // pinned: the project may change before the upload ends
  const v = parse(input);
  if (!cloud.signedIn()) throw httpError(401, 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta para publicar');
  const link = cloud.linkedAccount();
  if (!link) throw httpError(409, 'elige la cuenta de Instagram de este proyecto en Ajustes → Cuenta');
  const caption = captionOf(dir);
  if (caption.length > MAX_CAPTION) throw httpError(400, `el caption pasa de ${MAX_CAPTION} caracteres`);

  const p = await prepare(dir, slug, v.version);
  const carousel = p.kind === 'carousel';
  let r: Awaited<ReturnType<typeof cloud.publicationsApi.create>>;
  try {
    const title = fs.existsSync(path.join(dir, 'title.txt')) ? fs.readFileSync(path.join(dir, 'title.txt'), 'utf8').trim().slice(0, 200) : '';
    r = await cloud.publicationsApi.create({
      accountId: link.accountId,
      ...(carousel ? {kind: 'carousel' as const, slides: p.slides} : {}),
      size: p.size,
      caption,
      title: title || slug,
      coverSize: p.coverSize,
      shareToFeed: carousel || v.shareToFeed,
      scheduledAt: v.scheduledAt,
    });
  } catch (e) {
    p.done();
    throw e;
  }
  // A server from before scheduling ignores the time and would publish as soon as it's uploaded, and one from before
  // carousels would take its images for a video: upload nothing. Its row stays "uploading" and the account's cleanup
  // gives it up.
  if (v.scheduledAt && !r.scheduledAt) {
    p.done();
    throw httpError(409, 'tu cuenta de Reel Studio aún no permite programar: publícalo ahora o inténtalo más tarde');
  }
  const puts = carousel ? (r.slides ?? []) : [r.upload, ...(r.cover ? [r.cover] : [])];
  if ((carousel && !Array.isArray(r.slides)) || puts.length !== p.files.length || puts.some((x) => !x)) {
    p.done();
    throw httpError(409, carousel ? 'tu cuenta de Reel Studio aún no publica carruseles: inténtalo más tarde' : 'tu cuenta de Reel Studio no dio dónde subir el video: inténtalo otra vez');
  }
  const rec: VideoPublication = {id: r.id, version: v.version, account: link.username, scheduledAt: r.scheduledAt ?? null, createdAt: new Date().toISOString(), status: 'uploading', error: null, permalink: null};
  writeJson(path.join(dir, FILE), [rec, ...rawOf(dir)].slice(0, KEEP));
  sending.add(r.id);
  void send(dir, r.id, puts.map((u, i) => [u!, p.files[i]] as const))
    .catch((e) => {
      update(dir, r.id, {status: 'error', error: `No se pudo subir: ${(e as Error).message}`});
      // A scheduled one can be called off, so its copy doesn't wait in the account; one for now just stays behind.
      if (rec.scheduledAt) cloud.publicationsApi.cancel(r.id).catch(() => {});
    })
    .finally(() => {
      sending.delete(r.id);
      p.done();
    });
  return rec;
}

// files: each upload with its file (a video and its cover, or a carousel's images in order).
async function send(dir: string, id: string, files: (readonly [PresignedPut, string])[]) {
  for (const [u, file] of files) await put(u, file);
  let p = await cloud.publicationsApi.uploaded(id);
  update(dir, id, fromCloud(p));
  // One for now: followed until it's out, so it's published even if nobody looks at the page.
  const until = Date.now() + timing.followFor;
  while (!FINAL.has(p.status) && p.status !== 'scheduled' && Date.now() < until) {
    await delay(timing.follow);
    p = await cloud.publicationsApi.get(id).catch(() => p);
    update(dir, id, fromCloud(p));
  }
}

// A Blob and not a stream: S3 needs the length up front, and this doesn't load the file in memory. Three tries.
async function put(u: PresignedPut, file: string) {
  for (let attempt = 1; ; attempt++) {
    let why: string;
    try {
      const res = await fetch(u.url, {method: u.method, headers: u.headers, body: await fs.openAsBlob(file)});
      await res.text().catch(() => ''); // S3's error body quotes the signed request: not kept
      if (res.ok) return;
      why = `el almacenamiento respondió ${res.status}`;
      if (res.status < 500) throw new Error(why);
    } catch (e) {
      why = (e as Error).message;
      if (/respondió 4\d\d/.test(why)) throw e;
    }
    if (attempt >= 3) throw new Error(why);
    await delay(timing.retry * attempt);
  }
}

/* ───── A scheduled one, before its time ───── */

const known = (dir: string, id: string) => {
  const r = recordsOf(dir).find((x) => x.id === id);
  if (!r) throw httpError(404, 'publicación no encontrada');
  return r;
};

// at: ISO, or "now".
export async function reschedule(slug: string, id: string, at: unknown) {
  const dir = path.join(VIDEOS, slug);
  known(dir, id);
  if (typeof at !== 'string' || (at !== 'now' && Number.isNaN(Date.parse(at)))) throw httpError(400, 'la fecha de publicación no es válida');
  return update(dir, id, fromCloud(await cloud.publicationsApi.reschedule(id, at)));
}

export async function cancel(slug: string, id: string) {
  const dir = path.join(VIDEOS, slug);
  known(dir, id);
  return update(dir, id, fromCloud(await cloud.publicationsApi.cancel(id)));
}
