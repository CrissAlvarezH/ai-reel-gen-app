// A new reel starts like a new chat: its author writes the first message, a quick one-off agent call
// names the video (title + slug), the folder is copied from its style's template and the reel's own agent gets
// that message. npm install runs in the background so the conversation doesn't wait for it.
import {ROOT, httpError, listSlugs, validSlug} from './reels.ts';
import {findStyle, newVideoStyle} from './styles.ts';
import {findFormat} from './formats.ts';
import * as footage from './footage.ts';
import {agentCli} from './agent.ts';
import {getProfile, newVideoFormat} from './config.ts';
import {PROJECT_DIR, VIDEOS, seedMissing} from './workspace.ts';
import {npm} from './platform.ts';
import {resolveFormat, scaffold, scaffoldCarousel} from './scaffold.ts';
import {carouselStyle, newCarouselStyle} from './styles.ts';
import * as carousel from './carousel.ts';
import fs from 'node:fs';
import path from 'node:path';

const NAMER = (lang: string, what = 'un video explicativo nuevo (vertical') => [
  `Le pones nombre a ${what}, en ${lang}) a partir del primer mensaje de su autor.`,
  'Responde SOLO con JSON, sin texto alrededor: {"title": "...", "slug": "..."}.',
  `title: corto (2 a 6 palabras), en ${lang}, con mayúscula solo al inicio, sin comillas ni punto final; nombra el tema, no el gancho.`,
  'slug: 2 a 4 palabras clave del tema en minúsculas separadas por guiones, sin tildes ni ñ (p. ej. jwt-datos-sensibles).',
].join('\n');

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

async function askName(text: string, what?: string): Promise<{title: string; slug: string} | null> {
  try {
    const reply = await agentCli.ask(text.slice(0, 4000), NAMER(getProfile().language, what));
    const j = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '') as {title?: unknown; slug?: unknown};
    return {title: String(j.title ?? '').trim().slice(0, 80), slug: slugify(String(j.slug ?? j.title ?? ''))};
  } catch {
    return null; // fall back to the message's first words
  }
}

function unique(base: string) {
  const taken = new Set(listSlugs());
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// Videos whose npm install is still running: deleting one now would leave npm writing into its folder.
const installs = carousel.installs;
export const installing = (slug: string) => installs.has(slug);

function install(slug: string, dir: string, onInstalled?: (slug: string, ok: boolean, log: string) => void) {
  installs.add(slug);
  const p = npm(['install', '--silent'], {cwd: dir});
  let log = '';
  p.stderr?.on('data', (d: Buffer) => (log = (log + d).slice(-2000)));
  let ended = false;
  const done = (ok: boolean) => {
    if (ended) return;
    ended = true;
    installs.delete(slug);
    onInstalled?.(slug, ok, log);
  };
  p.on('error', () => done(false));
  p.on('close', (code) => done(code === 0));
}

// A new carousel: named like a video from its first message, copied from carousel-template/ in the style chosen (one
// that does carousels; none: the project's, else the first), optionally from a video of the project (its script is
// the agent's input; the carousel keeps its own conversation and files).
export async function createCarousel(text: unknown, styleId: unknown, fromVideo: unknown, onInstalled?: (slug: string, ok: boolean, log: string) => void) {
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'escribe de qué va el carrusel');
  const style = styleId == null ? newCarouselStyle() : carouselStyle(styleId);
  if (!style) throw httpError(400, styleId == null ? 'ningún estilo hace carruseles todavía' : 'ese estilo no hace carruseles');
  const from = fromVideo == null || fromVideo === '' ? undefined : fromVideo;
  if (from !== undefined && !(validSlug(from) && listSlugs().includes(from) && carousel.kindIn(path.join(VIDEOS, from)) === 'video')) throw httpError(400, 'ese video no existe en este proyecto');
  // A workspace from before carousels gets the template and the skill (only what's missing; nothing is replaced).
  seedMissing(['carousel-template', '.claude/skills/carousel']);
  const named = await askName(text.trim(), 'un carrusel de Instagram nuevo (láminas de 4:5');
  const fallback = text.trim().split(/\s+/).slice(0, 6).join(' ');
  const title = named?.title || fallback.slice(0, 60);
  const slug = unique((named && validSlug(named.slug) && named.slug) || slugify(fallback) || 'carrusel');
  const dir = scaffoldCarousel({root: ROOT, project: PROJECT_DIR, slug, style: style.id, title, from});
  if (!fs.existsSync(path.join(dir, carousel.MANIFEST))) throw httpError(500, 'no se pudo copiar la plantilla del carrusel');
  install(slug, dir, onInstalled);
  return {slug, title, style, from: from ?? null};
}

// formatId: the kind of video (formats/<id>; null: the default). clips: his recording, staged by Nuevo reel
// (footage.ts), for formats that need it.
export async function create(text: unknown, styleId: unknown, formatId: unknown, clips: unknown, onInstalled?: (slug: string, ok: boolean, log: string) => void) {
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'escribe de qué va el video');
  const style = styleId == null ? newVideoStyle() : findStyle(styleId);
  if (!style) throw httpError(400, 'ese estilo no existe');
  const kind = findFormat(formatId);
  if (kind === undefined) throw httpError(400, 'ese formato no existe');
  if (kind?.footage && !(Array.isArray(clips) && clips.length)) throw httpError(400, `el formato «${kind.name}» necesita tu ${kind.voiceOnly ? 'audio' : 'video'}: súbelo antes de crear el reel`);
  const named = await askName(text.trim());
  const fallback = text.trim().split(/\s+/).slice(0, 6).join(' ');
  const title = named?.title || fallback.slice(0, 60);
  const slug = unique((named && validSlug(named.slug) && named.slug) || slugify(fallback) || 'reel');

  // The same routine as scripts/new-video.sh (scripts/new-video.mjs).
  const dir = scaffold({root: ROOT, project: PROJECT_DIR, slug, style: style.id, template: style.template, kind: resolveFormat(ROOT, kind?.id), title, format: newVideoFormat()});
  const uploaded = kind?.footage ? footage.adopt(slug, clips) : [];

  install(slug, dir, onInstalled);
  return {slug, title, style, kind, uploaded};
}
