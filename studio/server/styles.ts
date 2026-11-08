// Visual styles a reel can be made in: one folder per style in styles/ of the workspace, described by
// its style.json (see styles/collage-semitono). Images it lists are relative to the workspace and served by
// /style-files/ (only files a style lists).
import fs from 'node:fs';
import path from 'node:path';
import type {Style, StyleRef, StyleThumbnail} from '../shared/types.ts';

import {STYLES} from './workspace.ts';
import {getProfile} from './config.ts';
export {STYLES};

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const list = <T>(v: unknown, ok: (x: Record<string, unknown>) => boolean) =>
  (Array.isArray(v) ? v.filter((x) => !!x && typeof x === 'object' && ok(x as Record<string, unknown>)) : []) as T[];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const fileUrl = (rel: string) => `/style-files/${rel.split('/').map(encodeURIComponent).join('/')}`;

// style.json "thumbnail": {look, avoid, example (a workspace-relative image)}; null when the style has none.
function thumbnail(v: unknown): StyleThumbnail | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  const example = str(t.example);
  return {look: strs(t.look), avoid: strs(t.avoid), example: example && fileUrl(example)};
}

function read(id: string) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STYLES, id, 'style.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listStyles(): Style[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(STYLES).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
  const mine = getProfile().style;
  const out: Style[] = [];
  for (const id of ids) {
    const j = read(id);
    if (!j) continue;
    out.push({
      id,
      name: str(j.name) ?? id,
      summary: str(j.summary) ?? '',
      default: j.default === true,
      projectDefault: id === mine,
      skill: str(j.skill),
      template: str(j.template),
      cutouts: j.cutouts === true,
      palette: list(j.palette, (c) => typeof c.hex === 'string' && typeof c.name === 'string'),
      fonts: list(j.fonts, (f) => typeof f.family === 'string' && typeof f.css === 'string'),
      look: strs(j.look),
      motion: strs(j.motion),
      sources: strs(j.sources),
      avoid: strs(j.avoid),
      thumbnail: thumbnail(j.thumbnail),
      examples: strs(j.examples).map(fileUrl),
      references: strs(j.references).map(fileUrl),
    });
  }
  return out.sort((a, b) => Number(b.projectDefault) - Number(a.projectDefault) || Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
}

// Whether a workspace-relative image path is listed by some style (the only files /style-files/ serves).
export function isStyleFile(rel: string) {
  return listStyles().some((s) => [...s.examples, ...s.references, s.thumbnail?.example].includes(fileUrl(rel)));
}

export const validStyleId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
// A style without a template of its own is built on the default style's.
const ref = (s: Style, all: Style[]): StyleRef => ({
  id: s.id,
  name: s.name,
  ready: !!(s.skill && s.template),
  skill: s.skill,
  template: s.template ?? all.find((x) => x.default)?.template ?? 'template',
});

// The style a video is in: its style.txt if that style exists, else the default one.
export function styleRef(id?: string | null): StyleRef | null {
  const all = listStyles();
  const s = (id && all.find((x) => x.id === id)) || all.find((x) => x.default) || all[0];
  return s ? ref(s, all) : null;
}

// The style a new video starts in: the open project's (Ajustes → Perfil) if it still exists, else the default one.
export function newVideoStyle(): StyleRef | null {
  const all = listStyles();
  const s = all.find((x) => x.projectDefault);
  return s ? ref(s, all) : styleRef();
}

// A style chosen in the UI, or null when it doesn't exist.
export function findStyle(id: unknown): StyleRef | null {
  if (!validStyleId(id)) return null;
  const all = listStyles();
  const s = all.find((x) => x.id === id);
  return s ? ref(s, all) : null;
}
