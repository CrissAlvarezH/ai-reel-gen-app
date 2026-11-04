// Formats: the kind of video, apart from how it looks (its style). One folder per format in formats/ of the
// workspace, described by its format.json (see formats/persona-hablando): how a video in it gets made, what's on
// screen, how it's cut, and whether it needs the creator's own recording (footage; voiceOnly: only its sound). Images it lists are relative
// to the workspace and served by /format-files/ (only files a format lists).
import fs from 'node:fs';
import path from 'node:path';
import type {ReelFormat, ReelFormatRef} from '../shared/types.ts';
import {FORMATS} from './workspace.ts';

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const fileUrl = (rel: string) => `/format-files/${rel.split('/').map(encodeURIComponent).join('/')}`;

function read(id: string) {
  try {
    return JSON.parse(fs.readFileSync(path.join(FORMATS, id, 'format.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listFormats(): ReelFormat[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(FORMATS).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
  const out: ReelFormat[] = [];
  for (const id of ids) {
    const j = read(id);
    if (!j) continue;
    out.push({
      id,
      name: str(j.name) ?? id,
      summary: str(j.summary) ?? '',
      default: j.default === true,
      skill: str(j.skill),
      overlay: str(j.overlay),
      footage: j.footage === true,
      voiceOnly: j.footage === true && j.voiceOnly === true,
      how: strs(j.how),
      screen: strs(j.screen),
      editing: strs(j.editing),
      avoid: strs(j.avoid),
      examples: strs(j.examples).map(fileUrl),
      references: strs(j.references).map(fileUrl),
    });
  }
  return out.sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
}

// Whether a workspace-relative image path is listed by some format (the only files /format-files/ serves).
export function isFormatFile(rel: string) {
  return listFormats().some((f) => [...f.examples, ...f.references].includes(fileUrl(rel)));
}

export const validFormatId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
const ref = (f: ReelFormat): ReelFormatRef => ({id: f.id, name: f.name, footage: f.footage, voiceOnly: f.voiceOnly, skill: f.skill});

// The format a video is in: its format.txt if that format exists, else the default one (videos made before
// formats are all animated, the default).
export function formatRef(id?: string | null): ReelFormatRef | null {
  const all = listFormats();
  const f = (id && all.find((x) => x.id === id)) || all.find((x) => x.default) || all[0];
  return f ? ref(f) : null;
}

// A format chosen in the UI (null: the default), or undefined when it doesn't exist.
export function findFormat(id: unknown): ReelFormatRef | null | undefined {
  if (id == null) return formatRef();
  if (!validFormatId(id)) return undefined;
  const f = listFormats().find((x) => x.id === id);
  return f ? ref(f) : undefined;
}
