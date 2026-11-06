// Skills available in the workspace, including the ones supplied by styles and formats.
// Only registered skill folders can be read or revealed; paths and symlinks stay inside the workspace.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './workspace.ts';
import {httpError} from './reels.ts';
import {reveal} from './platform.ts';
import type {SkillCategory, SkillDetail, SkillDocument, SkillFile, SkillSummary} from '../shared/types.ts';

const MAX_TEXT = 512 * 1024;
const SKIP = new Set(['node_modules', '__pycache__', 'out']);
const TEXT = /\.(md|mdx|txt|json|ya?ml|toml|csv|tsv|py|sh|bash|zsh|js|jsx|mjs|cjs|ts|tsx|mts|cts|css|html|xml|svg|sql|ini|cfg)$/i;
const rel = (s: string) => s.split(path.sep).join('/');
const inside = (base: string, file: string) => {
  const r = path.relative(base, file);
  return r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
};

function safePath(base: string, file: string): string | null {
  try {
    const b = fs.realpathSync(base);
    const p = fs.realpathSync(path.resolve(base, file));
    return inside(b, p) ? p : null;
  } catch { return null; }
}

function children(dir: string): string[] {
  try { return fs.readdirSync(dir).filter((n) => !n.startsWith('.') && !SKIP.has(n)).sort(); }
  catch { return []; }
}

function filesIn(dir: string): SkillFile[] {
  const files: SkillFile[] = [];
  const visited = new Set<string>();
  const walk = (folder: string) => {
    const p = safePath(dir, folder);
    if (!p || visited.has(p)) return;
    visited.add(p);
    for (const name of children(p)) {
      const relative = path.join(folder, name);
      const file = safePath(dir, relative);
      if (!file) continue;
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(relative);
      else if (stat.isFile()) files.push({path: rel(relative), size: stat.size});
    }
  };
  walk('');
  return files.sort((a, b) => Number(b.path === 'SKILL.md') - Number(a.path === 'SKILL.md') || a.path.localeCompare(b.path));
}

// The skills shipped with the app use plain YAML scalars or folded/literal descriptions.
function field(front: string, key: string): string {
  const value = front.match(new RegExp(`^${key}:\\s*([^\\n]*)(?:\\n((?:[ \\t]+[^\\n]*(?:\\n|$))*))?`, 'm'));
  if (!value) return '';
  const inline = value[1].trim();
  if (/^[>|][+-]?$/.test(inline)) return (value[2] ?? '').trim().replace(/\s+/g, ' ');
  return inline.replace(/^(['"])(.*)\1$/, '$2');
}

type Registered = SkillDetail & {directory: string};
function registered(): Registered[] {
  if (!ROOT) return [];
  const out = new Map<string, Registered>();
  const add = (entry: string, category: SkillCategory, fallbackName?: string, fallbackDescription?: string) => {
    const directory = safePath(ROOT, path.dirname(entry));
    if (!directory || directory === fs.realpathSync(ROOT)) return;
    const file = safePath(directory, path.basename(entry));
    if (!file || out.has(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_TEXT) return;
    const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
    const relative = rel(path.relative(fs.realpathSync(ROOT), file));
    const files = filesIn(directory);
    out.set(file, {
      id: Buffer.from(relative).toString('base64url'),
      name: field(front, 'name') || fallbackName || path.basename(directory),
      description: field(front, 'description') || fallbackDescription || '',
      category, path: relative, directory, entry: path.basename(file), files, fileCount: files.length,
    });
  };
  for (const base of ['.claude/skills', '.agents/skills', '.codex/skills']) {
    const folder = safePath(ROOT, base);
    if (folder) for (const name of children(folder)) add(`${base}/${name}/SKILL.md`, 'general');
  }
  for (const [base, category, manifest] of [['styles', 'style', 'style.json'], ['formats', 'format', 'format.json']] as const) {
    const folder = safePath(ROOT, base);
    if (!folder) continue;
    for (const name of children(folder)) {
      let meta: Record<string, unknown> = {};
      const config = safePath(ROOT, `${base}/${name}/${manifest}`);
      try { if (config) meta = JSON.parse(fs.readFileSync(config, 'utf8')); } catch { /* a standalone SKILL.md still appears */ }
      const label = typeof meta.name === 'string' ? meta.name : name;
      const description = typeof meta.summary === 'string' ? meta.summary : '';
      add(`${base}/${name}/SKILL.md`, category, label, description);
      if (typeof meta.skill === 'string') add(meta.skill, category, label, description);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function find(id: string): Registered {
  const skill = registered().find((s) => s.id === id);
  if (!skill) throw httpError(404, 'La skill ya no está disponible en esta carpeta de trabajo.');
  return skill;
}

export function listSkills(): SkillSummary[] {
  return registered().map(({directory, files, entry, ...summary}) => summary);
}

export function skillDetail(id: string): SkillDetail {
  const {directory, ...detail} = find(id);
  return detail;
}

export function skillDocument(id: string, wanted: unknown): SkillDocument {
  const skill = find(id);
  const entry = skill.files.find((f) => f.path === wanted);
  const file = entry && safePath(skill.directory, entry.path);
  if (!entry || !file) throw httpError(404, 'Este archivo no pertenece a la skill.');
  if (entry.size > MAX_TEXT) return {path: entry.path, content: null, note: 'Este archivo es demasiado grande para la vista previa. Ábrelo desde su carpeta.'};
  if (!TEXT.test(entry.path) && path.basename(file) !== 'SKILL.md') return {path: entry.path, content: null, note: 'Abre la carpeta de la skill para consultar este tipo de archivo.'};
  const content = fs.readFileSync(file, 'utf8');
  return content.includes('\0')
    ? {path: entry.path, content: null, note: 'Este archivo no es de texto. Ábrelo desde su carpeta.'}
    : {path: entry.path, content};
}

export function revealSkill(id: string) {
  reveal(find(id).directory);
}
