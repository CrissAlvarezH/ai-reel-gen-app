// Images pasted or dropped into the chat. Each is saved as it comes in the open project's .reel-studio/images/
// (gitignored), served to the page at /chat-images/<name>, and handed to the agent with the message as a path it
// reads (its Read tool sees images). The message keeps their names, so the transcript shows them again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {PROJECT_DIR, rel} from './workspace.ts';
import {httpError} from './reels.ts';

export const TYPES: Record<string, string> = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};
const NAME = /^\d{8}-[a-f0-9]{12}\.(png|jpg|webp|gif)$/;
const MAX = 10; // per message
const DIR = () => path.join(PROJECT_DIR, '.reel-studio', 'images');

export function save(data: unknown, type: string) {
  const ext = TYPES[type];
  if (!ext) throw httpError(415, 'solo imágenes PNG, JPG, WebP o GIF');
  if (!Buffer.isBuffer(data) || !data.length) throw httpError(400, 'la imagen llegó vacía');
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `${day}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.mkdirSync(DIR(), {recursive: true});
  fs.writeFileSync(path.join(DIR(), name), data);
  return {name};
}

// Images of a conversation being deleted. Each message has its own files, so nothing else shows them.
export function remove(names: string[]) {
  for (const name of names) {
    const p = file(name);
    if (p) fs.rmSync(p, {force: true});
  }
}

// The file of an image of the open project, or null.
export function file(name: string) {
  const p = NAME.test(name) ? path.join(DIR(), name) : null;
  return p && fs.existsSync(p) ? p : null;
}

// The images a message names that exist (at most MAX).
export const valid = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((n): n is string => typeof n === 'string' && !!file(n)))].slice(0, MAX) : []);

// For the agent's prompt: where they are, from the workspace (its working folder).
export const agentText = (names: string[]) =>
  names.length
    ? `[Imágenes que pegó en este mensaje (míralas con Read antes de responder): ${names.map((n) => rel(path.join(DIR(), n))).join(', ')}. Si son para algo que se guarda (referencias de un estilo, fotos de un video…), cópialas a su sitio: esta carpeta es solo del chat.]`
    : '';
