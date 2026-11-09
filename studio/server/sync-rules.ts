// What may leave this computer and what may land on it: the allow-list of the cloud's docs/studio-cloud.md §7, the
// groups the Ajustes switches turn on and off, and a sync job's scope. Pure on purpose: the same rules judge what we
// upload and what the cloud sends back, and anything not listed here stays out.
import type {SyncGroupId} from '../shared/types.ts';

export const GROUPS: SyncGroupId[] = ['videos', 'ideas', 'settings', 'sources', 'reels', 'automations', 'audit', 'styles'];
export const isGroup = (v: unknown): v is SyncGroupId => GROUPS.includes(v as SyncGroupId);

export const DOC_LIMIT = 512 * 1024;
export const FILE_LIMIT = 100 * 1024 * 1024;

export type Channel = 'project' | 'shared';
export type Storage = 'doc' | 'blob';
export type Classified = {group: SyncGroupId; storage: Storage};

const SETTINGS_DOCS = new Set(['profile', 'voice', 'audience', 'images', 'social', 'account', 'chat', 'checks'].map((n) => `config/${n}.json`));
const REEL_FILE = /^(account\.json|avatar\.jpg|reel\.json|meta\.json|transcript\.json|analysis\.json|insights\.json|thumb\.jpg|hook\.jpg|sheet_\d+\.jpg)$/;
const VIDEO = /^videos\/([a-z0-9][a-z0-9-]{0,60})\/(.+)$/;
const JUNK_FILE = /(\.pyc|\.tmp)$/i;

// A path from either side, before anything else looks at it: relative, with forward slashes, in NFC, and without any
// way out of the project. Dotfiles are never synced, which also rules out every .env*.
export function validPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || !rel || rel.length > 512 || rel !== rel.normalize('NFC')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\x00-\x1f]/.test(rel) || rel.startsWith('/')) return false;
  return rel.split('/').every((s) => s && !s.startsWith('.') && !s.endsWith('.') && !s.endsWith(' ') && s !== 'node_modules' && s !== '__pycache__');
}

function videoFile(rest: string) {
  const parts = rest.split('/');
  if (parts[0] === 'out' || parts[0] === 'footage') return false;
  const name = parts.at(-1)!;
  if (JUNK_FILE.test(name) || /\.raw\.mp4$/i.test(name)) return false;
  return !(parts[0] === 'public' && parts.length === 2 && (/\.wav$/i.test(name) || name === 'footage.mp4'));
}

function projectFile(rel: string): Classified | null {
  if (SETTINGS_DOCS.has(rel)) return {group: 'settings', storage: 'doc'};
  if (rel === 'ideas.json') return {group: 'ideas', storage: 'doc'};
  if (rel === 'automations.json') return {group: 'automations', storage: 'doc'};
  if (rel === 'fact-audit.json') return {group: 'audit', storage: 'doc'};
  if (rel === 'sources/sources.json' || rel === 'sources/items.json') return {group: 'sources', storage: 'doc'};
  if (/^avatar\.(png|jpg|webp)$/.test(rel)) return {group: 'settings', storage: 'blob'};
  if (/^sources\/items\/[^/]+\.md$/.test(rel)) return {group: 'sources', storage: 'blob'};
  const v = VIDEO.exec(rel);
  if (v) return videoFile(v[2]) ? {group: 'videos', storage: 'blob'} : null;
  if (/^(account|inspiration)\//.test(rel) && REEL_FILE.test(rel.split('/').at(-1)!)) return {group: 'reels', storage: 'blob'};
  return null;
}

// builtin: "styles/<id>" and "formats/<id>" the app itself ships. Those come with every install, so they don't travel.
function sharedFile(rel: string, builtin: ReadonlySet<string>): Classified | null {
  if (rel === 'LESSONS.md') return {group: 'styles', storage: 'blob'};
  const m = /^((?:styles|formats)\/[^/]+)\/.+$/.exec(rel);
  if (!m || builtin.has(m[1])) return null;
  const parts = rel.split('/');
  return parts.includes('out') || JUNK_FILE.test(parts.at(-1)!) ? null : {group: 'styles', storage: 'blob'};
}

export const classify = (rel: unknown, channel: Channel, builtin: ReadonlySet<string> = new Set()): Classified | null =>
  validPath(rel) ? (channel === 'project' ? projectFile(rel) : sharedFile(rel, builtin)) : null;

// Directories the walk doesn't go into: none of what's inside could be on the list, and node_modules alone is gigabytes.
export function pruned(rel: string, channel: Channel) {
  const parts = rel.split('/');
  const name = parts.at(-1)!;
  if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') return true;
  if (channel === 'shared') return name === 'out';
  return parts.length === 3 && parts[0] === 'videos' && (name === 'out' || name === 'footage');
}

/* ───── Scopes ───── */

export type Scope = {kind: 'full'} | {kind: 'group'; group: SyncGroupId} | {kind: 'video'; slug: string};

export function parseScope(v: unknown): Scope | null {
  if (v === undefined || v === 'full') return {kind: 'full'};
  if (typeof v !== 'string') return null;
  const [kind, value, extra] = v.split(':');
  if (extra !== undefined) return null;
  if (kind === 'group' && isGroup(value)) return {kind, group: value};
  if (kind === 'video' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(value ?? '')) return {kind, slug: value};
  return null;
}

export const scopeKey = (s: Scope) => (s.kind === 'full' ? 'full' : s.kind === 'group' ? `group:${s.group}` : `video:${s.slug}`);

// Whether a job of scope a already does everything a job of scope b would.
export function covers(a: string, b: string) {
  return a === b || a === 'full' || (a === 'group:videos' && b.startsWith('video:'));
}

export const videoOf = (rel: string) => VIDEO.exec(rel)?.[1] ?? null;

export function inScope(rel: string, group: SyncGroupId, scope: Scope) {
  if (scope.kind === 'full') return true;
  if (scope.kind === 'group') return group === scope.group;
  return videoOf(rel) === scope.slug;
}

// Where a walk has to start, relative to the channel's folder: a scope only looks at its own part of the disk.
export function startsOf(scope: Scope, channel: Channel): string[] {
  if (channel === 'shared') return ['LESSONS.md', 'styles', 'formats'];
  const top = ['ideas.json', 'automations.json', 'fact-audit.json', 'avatar.png', 'avatar.jpg', 'avatar.webp'];
  if (scope.kind === 'video') return [`videos/${scope.slug}`];
  if (scope.kind === 'full') return [...top, 'config', 'sources', 'account', 'inspiration', 'videos'];
  const of: Record<SyncGroupId, string[]> = {
    videos: ['videos'],
    ideas: ['ideas.json'],
    settings: ['config', 'avatar.png', 'avatar.jpg', 'avatar.webp'],
    sources: ['sources'],
    reels: ['account', 'inspiration'],
    automations: ['automations.json'],
    audit: ['fact-audit.json'],
    styles: [],
  };
  return of[scope.group];
}
