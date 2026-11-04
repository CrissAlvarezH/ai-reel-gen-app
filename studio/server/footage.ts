// The creator's own recording, for formats with footage (formats/<id>/format.json "footage": true; with "voiceOnly"
// it can be audio alone): the clips of a
// video live in its footage/ folder (not versioned), named 01-…, 02-… in the order they play; tools/footage.py
// transcribes and cuts them. They arrive as a stream (they can weigh gigabytes): into a video's footage/, or, from
// Nuevo reel before the video exists, into the project's .reel-studio/uploads/ until the video is created.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {Readable} from 'node:stream';
import type {FootageClip} from '../shared/types.ts';
import {PROJECT_DIR, VIDEOS} from './workspace.ts';
import {httpError} from './reels.ts';

const EXT = /\.(mp4|mov|m4v|webm|mkv|m4a|mp3|wav|aac|ogg|opus|flac)$/i;
const MAX = 20 * 1024 ** 3; // 20 GB per clip
const STAGED = /^[a-f0-9]{16}-[a-z0-9-]{1,40}\.(mp4|mov|m4v|webm|mkv|m4a|mp3|wav|aac|ogg|opus|flac)$/;
const stageDir = () => path.join(PROJECT_DIR, '.reel-studio', 'uploads');
const dirOf = (slug: string) => path.join(VIDEOS, slug, 'footage');

// "Toma 2 (final).MOV" → "toma-2-final.mov"
function safeName(name: unknown) {
  const n = typeof name === 'string' ? path.basename(name) : '';
  const ext = n.match(EXT)?.[0].toLowerCase();
  if (!ext) throw httpError(415, 'solo video (MP4, MOV, M4V, WebM, MKV) o audio (M4A, MP3, WAV, AAC, OGG, Opus, FLAC)');
  const base = n
    .slice(0, -ext.length)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${base || 'clip'}${ext}`;
}

async function receive(body: Readable, size: number, to: string) {
  if (size > MAX) throw httpError(413, 'el clip pesa más de 20 GB');
  fs.mkdirSync(path.dirname(to), {recursive: true});
  const part = `${to}.part`;
  try {
    await pipeline(body, fs.createWriteStream(part));
    if (!fs.statSync(part).size) throw httpError(400, 'el video llegó vacío');
    fs.renameSync(part, to);
  } catch (e) {
    fs.rmSync(part, {force: true});
    throw e;
  }
}

// The next name in a video's footage/: 01-…, 02-…, after the highest number there.
function nextName(slug: string, name: string) {
  const n = Math.max(0, ...list(slug).map((c) => Number(c.name.match(/^(\d+)-/)?.[1] ?? 0)));
  return `${String(n + 1).padStart(2, '0')}-${name}`;
}

// A clip for a video that doesn't exist yet (Nuevo reel). Staged clips older than a day are cleared on the way.
export async function stage(body: Readable, name: unknown, size: number) {
  const dir = stageDir();
  const clean = safeName(name);
  try {
    for (const n of fs.readdirSync(dir)) if (Date.now() - fs.statSync(path.join(dir, n)).mtimeMs > 864e5) fs.rmSync(path.join(dir, n), {force: true});
  } catch {
    /* no uploads yet */
  }
  const id = `${crypto.randomBytes(8).toString('hex')}-${clean}`;
  await receive(body, size, path.join(dir, id));
  return {id};
}

// Move staged clips (in the order given) into a new video's footage/.
export function adopt(slug: string, ids: unknown): string[] {
  const names: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !STAGED.test(id)) continue;
    const from = path.join(stageDir(), id);
    if (!fs.existsSync(from)) continue;
    const name = nextName(slug, id.slice(17));
    fs.mkdirSync(dirOf(slug), {recursive: true});
    fs.renameSync(from, path.join(dirOf(slug), name));
    names.push(name);
  }
  return names;
}

// A clip uploaded to an existing video: it goes last.
export async function upload(slug: string, body: Readable, name: unknown, size: number) {
  const n = nextName(slug, safeName(name));
  await receive(body, size, path.join(dirOf(slug), n));
  return {name: n};
}

export function list(slug: string): FootageClip[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dirOf(slug)).filter((n) => EXT.test(n) && !n.startsWith('.')).sort();
  } catch {
    return [];
  }
  return names.map((n) => {
    const st = fs.statSync(path.join(dirOf(slug), n));
    return {name: n, url: `/files/${encodeURIComponent(slug)}/footage/${encodeURIComponent(n)}`, size: st.size, mtime: st.mtimeMs};
  });
}

export function remove(slug: string, name: string) {
  if (!list(slug).some((c) => c.name === name)) throw httpError(404, 'ese clip no existe');
  fs.rmSync(path.join(dirOf(slug), name));
}
