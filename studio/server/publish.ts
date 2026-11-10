// Publicar: a finished version of a video (out/<name>.mp4) to the project's Instagram account, now or at a time,
// through his Reel Studio account (cloud.ts). Here only the upload and the record of what was sent,
// videos/<slug>/publicaciones.json (it travels with the video's sync); the account has the truth and does the rest,
// a scheduled one at its time with this app closed. The cover is out/miniatura.*, as a JPEG (Instagram's only kind).
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import * as cloud from './cloud.ts';
import type {CloudPublication, PresignedPut} from './cloud.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {VIDEOS} from './workspace.ts';
import type {PublicationStatus, PublishInput, VideoPublication, VideoPublications} from '../shared/types.ts';

const FILE = 'publicaciones.json';
const KEEP = 20;
const FINAL: ReadonlySet<PublicationStatus> = new Set(['published', 'error', 'canceled']);
const MAX_VIDEO = 300 * 1024 * 1024; // Instagram's limits
const MAX_COVER = 8 * 1024 * 1024;
const MAX_CAPTION = 2200;
const THUMB = /^miniatura\.(png|jpe?g|webp)$/i;
// How a publication for now is followed until it's out; tests shorten them.
export const timing = {follow: 5000, followFor: 20 * 60_000, retry: 2000};

const run = promisify(execFile);

// Uploads going on in this process: their record isn't refreshed from the account until they end.
const sending = new Set<string>();

const recordsOf = (dir: string) => {
  const raw = readJson<unknown>(path.join(dir, FILE));
  return Array.isArray(raw) ? (raw as VideoPublication[]).filter((r) => r && typeof r.id === 'string') : [];
};

// Re-read and rewritten on every change: the file is shared by the uploads and the page's refreshes.
function update(dir: string, id: string, set: Partial<VideoPublication>) {
  const list = recordsOf(dir);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const next = {...list[i], ...set};
  if (JSON.stringify(next) === JSON.stringify(list[i])) return next; // unchanged: don't touch the file (it syncs)
  list[i] = next;
  writeJson(path.join(dir, FILE), list);
  return next;
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

/* ───── Sending ───── */

function parse(input: unknown): PublishInput {
  const b = (input ?? {}) as Record<string, unknown>;
  const version = typeof b.version === 'string' ? b.version : '';
  if (!version || /[/\\]/.test(version) || /\.raw$/i.test(version)) throw httpError(400, 'elige una versión del video');
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

export async function publish(slug: string, input: unknown): Promise<VideoPublication> {
  const dir = path.join(VIDEOS, slug); // pinned: the project may change before the upload ends
  const v = parse(input);
  if (!cloud.signedIn()) throw httpError(401, 'inicia sesión con tu cuenta de Reel Studio en Ajustes → Cuenta para publicar');
  const link = cloud.linkedAccount();
  if (!link) throw httpError(409, 'elige la cuenta de Instagram de este proyecto en Ajustes → Cuenta');
  const file = path.join(dir, 'out', `${v.version}.mp4`);
  const size = fs.statSync(file, {throwIfNoEntry: false})?.size;
  if (!size) throw httpError(404, 'esa versión ya no está: renderiza el video de nuevo');
  if (size > MAX_VIDEO) throw httpError(413, 'el video pesa más de 300 MB, el máximo de Instagram');
  const caption = captionOf(dir);
  if (caption.length > MAX_CAPTION) throw httpError(400, `el caption pasa de ${MAX_CAPTION} caracteres`);

  const cover = await coverJpeg(dir);
  const done = () => cover?.temp && fs.rmSync(cover.file, {force: true});
  let r: Awaited<ReturnType<typeof cloud.publicationsApi.create>>;
  try {
    const title = fs.existsSync(path.join(dir, 'title.txt')) ? fs.readFileSync(path.join(dir, 'title.txt'), 'utf8').trim().slice(0, 200) : '';
    r = await cloud.publicationsApi.create({accountId: link.accountId, size, caption, title: title || slug, coverSize: cover?.size ?? null, shareToFeed: v.shareToFeed, scheduledAt: v.scheduledAt});
  } catch (e) {
    done();
    throw e;
  }
  // A server from before scheduling ignores the time and would publish as soon as it's uploaded: upload nothing.
  // Its row stays "uploading" and the account's cleanup gives it up.
  if (v.scheduledAt && !r.scheduledAt) {
    done();
    throw httpError(409, 'tu cuenta de Reel Studio aún no permite programar: publícalo ahora o inténtalo más tarde');
  }
  const rec: VideoPublication = {id: r.id, version: v.version, account: link.username, scheduledAt: r.scheduledAt ?? null, createdAt: new Date().toISOString(), status: 'uploading', error: null, permalink: null};
  writeJson(path.join(dir, FILE), [rec, ...recordsOf(dir)].slice(0, KEEP));
  sending.add(r.id);
  void send(dir, r.id, r.upload, file, r.cover, cover?.file ?? null)
    .catch((e) => {
      update(dir, r.id, {status: 'error', error: `No se pudo subir: ${(e as Error).message}`});
      // A scheduled one can be called off, so its copy doesn't wait in the account; one for now just stays behind.
      if (rec.scheduledAt) cloud.publicationsApi.cancel(r.id).catch(() => {});
    })
    .finally(() => {
      sending.delete(r.id);
      done();
    });
  return rec;
}

async function send(dir: string, id: string, upload: PresignedPut, file: string, coverPut: PresignedPut | null, coverFile: string | null) {
  await put(upload, file);
  if (coverPut && coverFile) await put(coverPut, coverFile);
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
