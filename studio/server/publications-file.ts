// videos/<slug>/publicaciones.json: what each video sent to Instagram from here (publish.ts writes it; the library reads it).
import path from 'node:path';
import {readJson} from './platform.ts';
import type {VideoPublication} from '../shared/types.ts';

export const FILE = 'publicaciones.json';

// Every record with an id, as it is in the file (one this version can't show is kept when the file is rewritten), and
// those the pages can show: with the fields the calendar and its ordering read. The file travels with the video's sync
// and can be edited by hand, so one record that lacks them can't take the whole calendar down.
export const rawOf = (dir: string) => {
  const raw = readJson<unknown>(path.join(dir, FILE));
  return Array.isArray(raw) ? (raw as VideoPublication[]).filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : [];
};
const shown = (r: VideoPublication) =>
  typeof r.version === 'string' && typeof r.createdAt === 'string' && typeof r.status === 'string' && (r.scheduledAt == null || typeof r.scheduledAt === 'string');
export const recordsOf = (dir: string) => rawOf(dir).filter(shown);
