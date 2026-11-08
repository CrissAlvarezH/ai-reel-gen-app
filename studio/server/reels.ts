// Reads a reel's state straight from its folder in videos/ (in the workspace). The files are the source of truth:
// nothing here is cached or stored elsewhere (only the reel it was posted as comes from the studio's index).
import fs from 'node:fs';
import path from 'node:path';
import {styleRef, findStyle} from './styles.ts';
import {formatRef} from './formats.ts';
import * as footage from './footage.ts';
import {videoVoice, voiceRef} from './config.ts';
import {fsUrl, readJson} from './platform.ts';
import {BEAT_TAGS, type Act, type Format, type Beat, type BoardGroup, type ReelDetail, type ReelSummary, type ProgressStep, type Version, type Word} from '../shared/types.ts';

import {ROOT, VIDEOS, PROJECT} from './workspace.ts';
import {postedAs} from './projects-index.ts';
export {ROOT, VIDEOS};

export const httpError = (status: number, message: string) => Object.assign(new Error(message), {status});

function read(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
function stat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
function ls(dir: string, filter: (name: string) => boolean = () => true): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.') && filter(n)).sort();
  } catch {
    return [];
  }
}
const isImg = (n: string) => /\.(png|jpe?g|webp)$/i.test(n);
const url = (slug: string, rel: string) => `/files/${encodeURIComponent(slug)}/${rel.split('/').map(encodeURIComponent).join('/')}`;

// A video still saying its template's placeholder script has no script of its own yet. Its template is its
// style's (create.ts copies it), or the default one for videos made before styles had their own.
// Until the agent writes its own scenes, src/ is still the template's playable example (plus its format's overlay):
// nothing to preview yet. Data files the tools rewrite (timings, the format, the cut) don't count.
const SRC_DATA = new Set(['words.json', 'vo_env.json', 'format.json', 'footage.json']);
export function hasOwnScenes(slug: string) {
  const src = path.join(VIDEOS, slug, 'src');
  const template = path.join(ROOT, styleOf(slug)?.template || 'template', 'src');
  const overlay = readJson<{overlay?: unknown}>(path.join(ROOT, 'formats', read(path.join(VIDEOS, slug, 'format.txt'))?.trim() || '-', 'format.json'))?.overlay;
  const over = typeof overlay === 'string' ? path.join(ROOT, overlay, 'src') : null;
  const files = (fs.readdirSync(src, {recursive: true, withFileTypes: true}) as fs.Dirent[]).filter((d) => d.isFile() && !SRC_DATA.has(d.name));
  return files.some((d) => {
    const rel = path.relative(src, path.join(d.parentPath, d.name));
    const mine = read(path.join(src, rel));
    const theirs = (over && read(path.join(over, rel))) ?? read(path.join(template, rel));
    return theirs === null || mine !== theirs;
  });
}

export function isPlaceholder(slug: string, script: string) {
  const templates = new Set([styleOf(slug)?.template, 'template'].filter((t): t is string => !!t));
  return [...templates].some((t) => read(path.join(ROOT, t, 'audio/vo.txt'))?.trim() === script);
}

export const validSlug = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
export const listSlugs = () => ls(VIDEOS, (n) => validSlug(n) && !!stat(path.join(VIDEOS, n))?.isDirectory());

// Same normalisation as cue() in the reels' src/lib.ts.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9']/g, '');
const tokens = (text: string) => text.split(/\s+/).map(norm).filter(Boolean);

function cue(words: Word[], phrase: string, nth = 0): number | undefined {
  const p = tokens(phrase);
  const hits: number[] = [];
  for (let i = 0; i + p.length <= words.length; i++) {
    if (p.every((x, j) => norm(words[i + j].w) === x)) hits.push(words[i].s);
  }
  return hits[nth];
}

// Split "a, b" at the top-level comma (ignores commas inside quotes or parens).
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function cueEnd(words: Word[], phrase: string, nth = 0): number | undefined {
  const start = cue(words, phrase, nth);
  if (start === undefined) return undefined;
  return words[words.findIndex((w) => w.s === start) + tokens(phrase).length - 1]?.e;
}

// A helper a reel's lib.ts defines over cue, like: const start = (phrase: string, nth?: number) => cue(phrase, nth) - 0.08;
type CueHelper = {fn: 'cue' | 'cueEnd'; offset: number};
function cueHelpers(libSrc: string): Map<string, CueHelper> {
  const helpers = new Map<string, CueHelper>();
  const re = /const\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*(?::\s*number\s*)?=>\s*(cue|cueEnd)\(\s*\2\s*(?:,\s*\w+\s*)?\)\s*(?:([+-])\s*([\d.]+))?/g;
  for (const m of libSrc.matchAll(re)) helpers.set(m[1], {fn: m[3] as CueHelper['fn'], offset: m[4] ? (m[4] === '+' ? 1 : -1) * Number(m[5]) : 0});
  return helpers;
}

// Evaluate the small expression language used in ACTS: 0, cue("x") - 0.08, cue("x", 1), cueEnd("x"), VO_END + 1.2,
// and calls to the file's own helpers over cue, start("x") - 0.75.
function evalTime(expr: string, words: Word[], helpers: Map<string, CueHelper>): number | null {
  if (/^-?[\d.]+$/.test(expr)) return Number(expr);
  if (expr === 'VO_END') return words.length ? words[words.length - 1].e : 0;
  const sum = expr.match(/^(.+?)\s*([+-])\s*([\d.]+)$/);
  if (sum) {
    const base = evalTime(sum[1], words, helpers);
    return base === null ? null : base + (sum[2] === '+' ? 1 : -1) * Number(sum[3]);
  }
  const call = expr.match(/^(\w+)\((["'])(.+?)\2(?:\s*,\s*(\d+))?\)$/);
  if (!call) return null;
  const helper: CueHelper | undefined = call[1] === 'cue' || call[1] === 'cueEnd' ? {fn: call[1], offset: 0} : helpers.get(call[1]);
  if (!helper) return null;
  const t = (helper.fn === 'cue' ? cue : cueEnd)(words, call[3], call[4] ? Number(call[4]) : 0);
  return t === undefined ? null : t + helper.offset;
}

function parseActs(libSrc: string | null, words: Word[]): Act[] {
  if (!libSrc) return [];
  const block = libSrc.match(/export const ACTS = \{([\s\S]*?)\}\s*as const/);
  if (!block) return [];
  const helpers = cueHelpers(libSrc);
  const acts: Act[] = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*(\w+):\s*\[(.*)\],?\s*(\/\/.*)?$/);
    if (!m) continue;
    const [a, b] = splitArgs(m[2]);
    acts.push({name: m[1], start: evalTime(a ?? '', words, helpers), end: evalTime(b ?? '', words, helpers)});
  }
  return acts;
}

// render.sh writes out/<name>.raw.mp4, then out/<name>.mp4 from it, and only then deletes the raw. The raw isn't
// a version, and the final file can't be played until ffmpeg closes it (its index is written last). A copy older
// than the raw is the previous render of that name, which still plays.
function versions(slug: string, dir: string): Version[] {
  const out = path.join(dir, 'out');
  const files = ls(out, (n) => /\.mp4$/i.test(n)).flatMap((n) => {
    const st = stat(path.join(out, n));
    return st ? [{n, st}] : [];
  });
  const rawAt = new Map(files.filter((f) => /\.raw\.mp4$/i.test(f.n)).map((f) => [f.n.replace(/\.raw\.mp4$/i, ''), f.st.mtimeMs]));
  return files
    .filter(({n, st}) => {
      if (/\.raw\.mp4$/i.test(n)) return false;
      const raw = rawAt.get(n.replace(/\.mp4$/i, ''));
      return raw === undefined || st.mtimeMs < raw;
    })
    .map(({n, st}) => ({name: n.replace(/\.mp4$/i, ''), url: url(slug, `out/${n}`), size: st.size, mtime: st.mtimeMs}))
    .sort((a, b) => b.mtime - a.mtime);
}

const THUMB = /^miniatura\.(png|jpe?g|webp)$/i;

// Image groups under out/ (boards, mute-test sheets, fix stills): one group per folder, plus loose pngs (not the thumbnail).
function boards(slug: string, dir: string): BoardGroup[] {
  const out = path.join(dir, 'out');
  const groups: BoardGroup[] = [];
  const mtime = (p: string) => stat(p)?.mtimeMs ?? 0;
  const loose = ls(out, (n) => isImg(n) && !THUMB.test(n));
  if (loose.length) groups.push({name: 'out/', images: loose.map((n) => url(slug, `out/${n}`)), mtime: Math.max(...loose.map((n) => mtime(path.join(out, n))))});
  for (const d of ls(out, (n) => n !== 'studio-frames' && !!stat(path.join(out, n))?.isDirectory())) {
    const imgs = ls(path.join(out, d), isImg);
    if (!imgs.length) continue;
    // sheets first, then stills in time order (t4.5.png before t13.6.png)
    const key = (n: string) => (/sheet/.test(n) ? -1 : Number(n.match(/\d+(\.\d+)?/)?.[0] ?? 0));
    imgs.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
    groups.push({name: d, images: imgs.map((n) => url(slug, `out/${d}/${n}`)), mtime: mtime(path.join(out, d))});
  }
  return groups.sort((a, b) => b.mtime - a.mtime);
}

// Words and estimated length, at the pace of the voice that narrates the video (Ajustes → Voz).
function scriptInfo(slug: string, text: string | null) {
  const n = tokens(text ?? '').length;
  const pace = videoVoice(slug).wordsPerSec;
  return {words: n, seconds: Math.round((n / pace) * 10) / 10, pace, voice: voiceRef(slug)};
}

// Newest modification time inside a folder (node_modules, dotfiles and the folders in skip left out).
function newest(p: string, skip: string[] = []): number {
  const st = stat(p);
  if (!st) return 0;
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...ls(p, (n) => n !== 'node_modules' && !skip.includes(n)).map((n) => newest(path.join(p, n))));
}

// The voice is stale when vo.txt no longer says what words.json (the timed VO) says.
const isStale = (script: string, words: Word[]) => words.length > 0 && tokens(script).join(' ') !== words.map((w) => norm(w.w)).filter(Boolean).join(' ');

// Where the video stands, from its files. A step that depends on the voice stops counting when the
// voice is newer than it (its timings changed). With footage (his own recording) the voice is the cut:
// public/footage.mp4 (public/vo.wav when only his voice is used), made by tools/footage.py, which also writes vo.txt
// and words.json.
function progress(dir: string, script: string, words: Word[], vers: Version[], withFootage = false, voiceOnly = false): ProgressStep[] {
  const mt = (rel: string) => stat(path.join(dir, rel))?.mtimeMs ?? 0;
  const voiceAt = mt(withFootage ? (voiceOnly ? 'public/vo.wav' : 'public/footage.mp4') : 'audio/vo.mp3');
  const stale = isStale(script, words);
  const voz = voiceAt > 0 && words.length > 0 && !stale;
  if (withFootage)
    return [
      {key: 'guion', label: 'Grabación', done: ls(path.join(dir, 'footage'), (n) => /\.(mp4|mov|m4v|webm|mkv|m4a|mp3|wav|aac|ogg|opus|flac)$/i.test(n)).length > 0},
      {key: 'voz', label: 'Cortes', done: voz, note: voiceAt > 0 && stale ? 'audio/vo.txt ya no dice lo que dice el corte' : undefined},
      ...rest(),
    ];
  return [
    {key: 'guion', label: 'Guion', done: !!script.trim() && !isPlaceholder(path.basename(dir), script.trim())},
    {key: 'voz', label: 'Voz', done: voz, note: voiceAt > 0 && stale ? 'el guion cambió después de grabarla' : undefined},
    ...rest(),
  ];
  function rest(): ProgressStep[] {
    const mixAt = mt('public/mix.wav');
    const renderAt = vers[0]?.mtime ?? 0;
    // src/thumbnail/ is the cover (./thumb.sh), not the film: changing it doesn't call for a new render.
    const inputsAt = Math.max(newest(path.join(dir, 'src'), ['thumbnail']), newest(path.join(dir, 'public')), voiceAt);
    const what = withFootage ? 'el corte' : 'la voz';
    return [
      {key: 'sonido', label: 'Efectos de sonido', done: voz && mixAt > 0 && mixAt >= voiceAt, note: mixAt > 0 && mixAt < voiceAt ? `${what} cambió: hay que volver a mezclar` : undefined},
      {key: 'render', label: 'Render', done: renderAt > 0 && renderAt >= inputsAt, note: renderAt > 0 && renderAt < inputsAt ? `hay cambios después de ${vers[0].name}` : undefined},
    ];
  }
}

// The video's name in the UI: title.txt (set from its first message, the agent may change it), or the slug.
export const title = (slug: string) => read(path.join(VIDEOS, slug, 'title.txt'))?.trim() || null;

// The video's size, fps and loudness (src/format.json, set when it was created); null in older videos.
export const formatOf = (slug: string) => readJson<Format>(path.join(VIDEOS, slug, 'src/format.json'));

// The video's visual style: style.txt holds an id from styles/ (none: the default style).
export const styleOf = (slug: string) => styleRef(read(path.join(VIDEOS, slug, 'style.txt'))?.trim());
// The kind of video: format.txt holds an id from formats/ (none: the default format, animated).
export const videoFormatOf = (slug: string) => formatRef(read(path.join(VIDEOS, slug, 'format.txt'))?.trim());

export function setStyle(slug: string, id: unknown) {
  const s = findStyle(id);
  if (!s) throw httpError(400, 'ese estilo no existe');
  fs.writeFileSync(path.join(VIDEOS, slug, 'style.txt'), `${s.id}\n`);
  return s;
}

export function summary(slug: string): ReelSummary {
  const dir = path.join(VIDEOS, slug);
  const script = read(path.join(dir, 'audio/vo.txt'));
  const cuts = ls(path.join(dir, 'public/cut'), isImg);
  const vers = versions(slug, dir);
  const bds = boards(slug, dir);
  const board = bds.find((g) => /board/.test(g.name));
  const thumb = board?.images.find((u) => /t\d/.test(u)) ?? (cuts[0] ? url(slug, `public/cut/${cuts[0]}`) : null);
  const mtimes = [stat(dir)?.mtimeMs, stat(path.join(dir, 'audio/vo.txt'))?.mtimeMs, vers[0]?.mtime].filter((x): x is number => !!x);
  const kind = videoFormatOf(slug);
  return {
    slug,
    title: title(slug),
    style: styleOf(slug),
    videoFormat: kind,
    hook: script?.trim().split(/(?<=[.?!])\s/)[0] ?? '',
    progress: progress(dir, script ?? '', readJson<Word[]>(path.join(dir, 'src/words.json')) ?? [], vers, !!kind?.footage, !!kind?.voiceOnly),
    latest: vers[0] ?? null,
    versionCount: vers.length,
    thumb,
    updated: Math.max(...mtimes),
    ...scriptInfo(slug, script),
    instagram: postedAs(PROJECT, slug),
  };
}

function beats(dir: string): Beat[] {
  const raw = readJson<unknown>(path.join(dir, 'audio/beats.json'));
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is Beat => !!b && (BEAT_TAGS as readonly string[]).includes(b.tag) && typeof b.line === 'string');
}

// The cover: out/miniatura.png (or .jpg/.webp), rendered by ./thumb.sh next to the renders, so it's in the folder
// "Descargar video" opens. The mtime in its url makes the browser fetch it again when it's re-rendered.
function thumbnailOf(slug: string, dir: string): ReelDetail['thumbnail'] {
  const name = ls(path.join(dir, 'out'), (n) => THUMB.test(n))[0];
  const st = name ? stat(path.join(dir, 'out', name)) : null;
  return name && st ? {url: `${url(slug, `out/${name}`)}?v=${Math.round(st.mtimeMs)}`, mtime: st.mtimeMs} : null;
}

export function detail(slug: string): ReelDetail {
  const dir = path.join(VIDEOS, slug);
  const script = read(path.join(dir, 'audio/vo.txt')) ?? '';
  const words = readJson<Word[]>(path.join(dir, 'src/words.json')) ?? [];
  const cuts = ls(path.join(dir, 'public/cut'), isImg);
  const voiceStale = isStale(script, words);
  return {
    ...summary(slug),
    script,
    beats: beats(dir),
    words,
    voiceStale,
    hasVoice: !!stat(path.join(dir, 'audio/vo.mp3')),
    acts: parseActs(read(path.join(dir, 'src/lib.ts')), words),
    versions: versions(slug, dir),
    cutouts: cuts.map((n) => ({name: n.replace(/\.\w+$/, ''), url: url(slug, `public/cut/${n}`)})),
    boards: boards(slug, dir),
    credits: read(path.join(dir, 'CREDITS.md')) ?? '',
    caption: read(path.join(dir, 'caption.md')) ?? '',
    automation: read(path.join(dir, 'automatizacion.json')) ?? '',
    thumbnail: thumbnailOf(slug, dir),
    // New reels copy a playable example from the template. Wait for their own script and scenes before
    // offering that code as a preview, so the example doesn't look like an already-made video.
    previewEntry: script.trim() && !isPlaceholder(slug, script.trim()) && stat(path.join(dir, 'src/Root.tsx')) && hasOwnScenes(slug) ? fsUrl(path.join(dir, 'src/Root.tsx')) : null,
    format: formatOf(slug),
    footage: footage.list(slug),
  };
}

// Files the UI may write. Everything else in the reel is Claude's or the tools' to change.
const WRITABLE = [/^audio\/vo\.txt$/, /^audio\/beats\.json$/, /^CREDITS\.md$/, /^caption\.md$/, /^automatizacion\.json$/];

export function writeFile(slug: string, rel: string, content: string) {
  if (!WRITABLE.some((re) => re.test(rel))) throw httpError(403, `no se puede escribir ${rel}`);
  const p = path.join(VIDEOS, slug, rel);
  fs.mkdirSync(path.dirname(p), {recursive: true});
  fs.writeFileSync(p, content);
}
