// scripts/new-video.mjs, the routine that copies a new video from its style's template. It lives with the
// workspace's scripts (scripts/new-video.sh runs it too), so the server loads the copy the app carries.
import {pathToFileURL} from 'node:url';
import {resource} from './workspace.ts';
import type {Format} from '../shared/types.ts';

type NewVideo = {
  // A valid format, or undefined (even sizes, known fps, LUFS in range).
  cleanFormat(v: unknown): Format | undefined;
  // A format (formats/<id>) and the files it adds over the template; no id: the default. null: no such format.
  resolveFormat(root: string, id?: string | null): {id: string | null; overlay: string | null} | null;
  // Copies the template (and the format's overlay) into videos/<slug>/ and returns that folder. format: else the
  // profile's, else the template's.
  scaffold(o: {root: string; project?: string; slug: string; style: string; template: string; kind?: {id: string | null; overlay: string | null} | null; title?: string; format?: Format}): string;
};

export const {cleanFormat, resolveFormat, scaffold} = (await import(pathToFileURL(resource('scripts/new-video.mjs')).href)) as NewVideo;
