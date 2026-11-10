// The workspace: the folder with the creator's videos, styles, settings, keys and tools, where the agent
// runs (its CLAUDE.md and .claude/skills/ are there). The app carries everything a new workspace needs
// (template, tools, styles, formats, scripts, skills, agent instructions) and copies what's missing into the folder
// chosen the first time (welcome page). It never overwrites a file that's already there.
//
// Which folder: REEL_STUDIO_WORKSPACE, else the one saved in the app's config (config.json in the app's
// settings folder), else, when running from the source repo, the repo itself if it already holds videos/
// (Cristian's setup). The installed app has no default: the welcome page asks.
//
// Projects: each channel the creator makes videos for is a project, in projects/<id>/ — its videos/, its
// config/ (profile.json, voice.json, account.json: its Instagram; images.json, social.json, chat.json: its
// preferences), ideas.json, account/ (Mi cuenta's downloads), inspiration/ (other accounts' reels) and
// .reel-studio/chats (its conversations). Everything else is shared by every project, at the workspace's
// root: tools, template, scripts, styles, skills, agent instructions, .venv, .env (keys) and the SQLite index,
// which spans them. A workspace from before projects gets its videos, profile, voice, account and conversations
// moved into projects/principal/ when it's opened, and an inspiration/ from when it was shared goes to the project
// open last.
// Which project is open is this machine's choice (the app's config, per workspace).
//
// The paths below are live bindings: setWorkspace() and openProject() repoint them and every module that
// imports them sees the new folder. No imports from the other server modules (they import this one).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The source repo (studio/..). In the installed app it holds the studio's code only.
export const APP_ROOT = path.resolve(import.meta.dirname, '../..');
// The files a workspace starts with: in the repo (dev), or bundled by the installer (desktop/main.ts sets it).
export const PACKAGED = !!process.env.REEL_STUDIO_RESOURCES;
const RESOURCES = process.env.REEL_STUDIO_RESOURCES ?? APP_ROOT;
// A file the app carries at the same place in the repo and in the bundle (e.g. scripts/new-video.mjs).
export const resource = (rel: string) => path.join(RESOURCES, rel);

function configDir() {
  if (process.env.REEL_STUDIO_CONFIG_DIR) return process.env.REEL_STUDIO_CONFIG_DIR;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support/Reel Studio');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'Reel Studio');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Reel Studio');
}
export const CONFIG_DIR = configDir();
const APP_CONFIG = path.join(CONFIG_DIR, 'config.json');

export let ROOT = ''; // '' until there is a workspace
export let STYLES = '';
export let FORMATS = ''; // formats/: the kinds of video (animated, talking head…)
export let GLOBAL_CONFIG = ''; // the workspace's config/: images.json, social.json, for projects without their own
export let ENV = '';
// The open project and its folders.
export let PROJECT = ''; // its id (the folder's name)
export let PROJECT_DIR = '';
export let VIDEOS = '';
export let CONFIG = ''; // the project's config/: profile.json, voice.json, account.json, images.json, social.json, chat.json
export let DATA = ''; // the project's conversations

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
// This machine's settings (not the workspace's): which folder, which agent CLI.
// chat: the model and effort last chosen in a conversation, per agent (new conversations start with it).
// claudeCommands: the slash commands Claude Code's last session listed.
// projects: the project open last in each workspace (by its path).
type AppConfig = {workspace?: string; projects?: Record<string, string>; agent?: string; chat?: Record<string, {model: string; effort: string}>; claudeCommands?: string[]};
const readConfig = (): AppConfig => {
  try {
    return JSON.parse(fs.readFileSync(APP_CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
function writeConfig(patch: AppConfig) {
  fs.mkdirSync(path.dirname(APP_CONFIG), {recursive: true});
  fs.writeFileSync(APP_CONFIG, JSON.stringify({...readConfig(), ...patch}, null, 2) + '\n');
}
export const appConfig = readConfig;
export const setAppConfig = writeConfig;

function apply(dir: string) {
  ROOT = dir;
  STYLES = path.join(dir, 'styles');
  FORMATS = path.join(dir, 'formats');
  GLOBAL_CONFIG = path.join(dir, 'config');
  ENV = path.join(dir, '.env');
  migrate(dir);
  const saved = readConfig().projects?.[dir];
  const ids = projectIds(dir);
  const open = saved && ids.includes(saved) ? saved : ids[0];
  migrateInspiration(dir, open);
  applyProject(open);
}

function applyProject(id: string) {
  PROJECT = id;
  PROJECT_DIR = path.join(ROOT, 'projects', id);
  VIDEOS = path.join(PROJECT_DIR, 'videos');
  CONFIG = path.join(PROJECT_DIR, 'config');
  DATA = path.join(PROJECT_DIR, '.reel-studio', 'chats');
  fs.mkdirSync(DATA, {recursive: true});
  fs.mkdirSync(VIDEOS, {recursive: true});
}

/* ───── Projects ───── */

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
type ProjectFile = {name: string; created: number};
export type {Project as ProjectInfo} from '../shared/types.ts';
import type {Project as ProjectInfo, ProjectContents} from '../shared/types.ts';
const projectFile = (root: string, id: string) => path.join(root, 'projects', id, 'project.json');
const readProject = (root: string, id: string): ProjectFile | null => {
  try {
    const j = JSON.parse(fs.readFileSync(projectFile(root, id), 'utf8'));
    return j && typeof j === 'object' ? {name: typeof j.name === 'string' && j.name ? j.name : id, created: Number(j.created) || 0} : null;
  } catch {
    return null;
  }
};
const writeProject = (root: string, id: string, p: ProjectFile) => {
  fs.mkdirSync(path.dirname(projectFile(root, id)), {recursive: true});
  fs.writeFileSync(projectFile(root, id), JSON.stringify(p, null, 2) + '\n');
};
// Its projects, oldest first.
function projectIds(root: string) {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(path.join(root, 'projects')).filter((n) => PROJECT_ID.test(n) && readProject(root, n));
  } catch {
    /* none yet */
  }
  return ids.sort((a, b) => readProject(root, a)!.created - readProject(root, b)!.created || a.localeCompare(b));
}

// A workspace without projects gets its first one, with what it already had: the videos, the profile, the
// voice, Mi cuenta's account and downloads, and the conversations (older ones in studio/data/ of the repo).
function migrate(root: string) {
  if (projectIds(root).length) return;
  const id = 'principal';
  const dir = path.join(root, 'projects', id);
  const move = (from: string, to: string) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), {recursive: true});
    fs.renameSync(from, to);
  };
  move(path.join(root, 'videos'), path.join(dir, 'videos'));
  for (const f of ['profile.json', 'voice.json', 'account.json']) move(path.join(root, 'config', f), path.join(dir, 'config', f));
  move(path.join(root, 'account'), path.join(dir, 'account'));
  move(path.join(root, 'studio/data'), path.join(dir, '.reel-studio/chats'));
  move(path.join(root, '.reel-studio/chats'), path.join(dir, '.reel-studio/chats'));
  writeProject(root, id, {name: 'Principal', created: Date.now()});
}

// Inspiración used to be one folder for every project. It can't be told whose each account was: all of it goes to
// the project open last, unless that one already has its own (then it stays, for him to sort out).
function migrateInspiration(root: string, id: string) {
  const from = path.join(root, 'inspiration');
  let names: string[];
  try {
    names = fs.readdirSync(from);
  } catch {
    return;
  }
  if (!names.some((n) => !n.startsWith('.'))) return void fs.rmSync(from, {recursive: true, force: true});
  const to = path.join(root, 'projects', id, 'inspiration');
  if (fs.existsSync(to)) return console.warn(`inspiration/ sigue en la raíz: ${to} ya existe`);
  fs.renameSync(from, to);
  fs.rmSync(path.join(to, '.index.sqlite'), {force: true});
}

const videoCount = (root: string, id: string) => {
  try {
    return fs.readdirSync(path.join(root, 'projects', id, 'videos')).filter((n) => !n.startsWith('.') && !n.startsWith('_')).length;
  } catch {
    return 0;
  }
};
// Its link to the account (server/cloud.ts reads it, from the project's own folder and without the network).
let projectCloud: (dir: string) => ProjectInfo['cloud'] = () => null;
export const setProjectCloudReader = (fn: typeof projectCloud) => void (projectCloud = fn);
export const listProjects = (): ProjectInfo[] =>
  ROOT
    ? projectIds(ROOT).map((id) => {
        const pic = projectAvatar(id);
        return {id, ...readProject(ROOT, id)!, videos: videoCount(ROOT, id), current: id === PROJECT, avatar: pic ? Math.round(fs.statSync(pic).mtimeMs) : null, cloud: projectCloud(projectDir(id))};
      })
    : [];

// The project's picture (Ajustes → Proyecto): projects/<id>/avatar.png|jpg|webp, or none.
const AVATAR_TYPES: Record<string, string> = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'};
export function projectAvatar(id: string) {
  if (!ROOT || !PROJECT_ID.test(id)) return null;
  for (const ext of Object.values(AVATAR_TYPES)) {
    const p = path.join(ROOT, 'projects', id, `avatar.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
export function setProjectAvatar(id: string, data: Buffer, type: string) {
  if (!ROOT || !PROJECT_ID.test(id) || !readProject(ROOT, id)) throw bad('proyecto no encontrado', 404);
  const ext = AVATAR_TYPES[type];
  if (!ext) throw bad('usa una imagen PNG, JPG o WebP');
  if (!data.length) throw bad('la imagen está vacía');
  removeProjectAvatar(id);
  fs.writeFileSync(path.join(ROOT, 'projects', id, `avatar.${ext}`), data);
  return listProjects();
}
export function removeProjectAvatar(id: string) {
  for (let p = projectAvatar(id); p; p = projectAvatar(id)) fs.rmSync(p);
  return listProjects();
}

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), {status});
const cleanName = (v: unknown) => {
  const n = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!n) throw bad('ponle un nombre al proyecto');
  return n;
};

// A new project (its folder is named after it), opened. It starts with the open project's profile and voice,
// to change in Ajustes; no videos, account or conversations. The audience and rules are each channel's own: the
// audience is what he typed, or empty for the agent to fill in when it's clear; the rules start from the defaults.
export function createProject(nameIn: unknown, audienceIn?: unknown) {
  if (!ROOT) throw bad('aún no hay carpeta de trabajo');
  const name = cleanName(nameIn);
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'proyecto';
  let id = base;
  for (let i = 2; fs.existsSync(path.join(ROOT, 'projects', id)); i++) id = `${base}-${i}`;
  writeProject(ROOT, id, {name, created: Date.now()});
  const config = path.join(ROOT, 'projects', id, 'config');
  fs.mkdirSync(config, {recursive: true});
  for (const f of ['profile.json', 'voice.json', 'images.json', 'social.json', 'chat.json']) {
    const from = path.join(CONFIG, f);
    if (CONFIG && fs.existsSync(from)) fs.copyFileSync(from, path.join(config, f));
  }
  const profile = path.join(config, 'profile.json');
  let inherited: Record<string, unknown> = {};
  try {
    inherited = JSON.parse(fs.readFileSync(profile, 'utf8'));
  } catch {
    // no profile to start from: the defaults apply
  }
  delete inherited.caption;
  delete inherited.notes;
  const audience = typeof audienceIn === 'string' ? audienceIn.trim().slice(0, 300) : '';
  fs.writeFileSync(profile, JSON.stringify({...inherited, audience}, null, 2) + '\n');
  openProject(id);
  return listProjects();
}

// Its name only: the folder keeps its id.
export function renameProject(id: string, nameIn: unknown) {
  const p = ROOT && PROJECT_ID.test(id) ? readProject(ROOT, id) : null;
  if (!p) throw bad('proyecto no encontrado', 404);
  writeProject(ROOT, id, {...p, name: cleanName(nameIn)});
  return listProjects();
}

export const projectDir = (id: string) => path.join(ROOT, 'projects', id);
const subdirs = (dir: string) => {
  try {
    return fs.readdirSync(dir, {withFileTypes: true}).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
};
const jsonOf = (file: string): Record<string, unknown> => {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
};
const deletable = (id: string) => {
  if (!ROOT || !PROJECT_ID.test(id) || !readProject(ROOT, id)) throw bad('proyecto no encontrado', 404);
  if (projectIds(ROOT).length < 2) throw bad('es tu único proyecto: crea otro antes de borrarlo', 409);
};

// What deleting it would take with it, to say so before asking.
export function projectContents(id: string): ProjectContents {
  deletable(id);
  const dir = projectDir(id);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const board = jsonOf(path.join(dir, 'ideas.json'));
  const username = jsonOf(path.join(dir, 'config', 'account.json')).username;
  const chats = path.join(dir, '.reel-studio', 'chats');
  let files: string[] = [];
  try {
    files = fs.readdirSync(chats).filter((n) => n.endsWith('.json'));
  } catch {
    /* none yet */
  }
  return {
    videos: videoCount(ROOT, id),
    ideas: list(board.lists).reduce((n: number, l: {cards?: unknown}) => n + list(l?.cards).length, 0),
    verticals: list(board.verticals ?? board.categories).length,
    account: typeof username === 'string' && username ? username : null,
    reels: subdirs(path.join(dir, 'account')).reduce((n, u) => n + subdirs(path.join(dir, 'account', u)).length, 0),
    inspiration: subdirs(path.join(dir, 'inspiration')).length,
    // Only those with something in them: an empty one is a tab that was opened.
    conversations: files.reduce((n, f) => n + list(jsonOf(path.join(chats, f)).chats).filter((c: {items?: unknown}) => list(c?.items).length).length, 0),
  };
}

// Gone for good, with all it holds. Its name has to come typed again; if it's the open one, another opens first so
// nothing is still reading or watching its folders.
export function checkDeleteName(id: string, nameIn: unknown) {
  deletable(id);
  if (typeof nameIn !== 'string' || nameIn.trim() !== readProject(ROOT, id)!.name) throw bad('el nombre no coincide con el del proyecto');
}
export function deleteProject(id: string, nameIn: unknown) {
  checkDeleteName(id, nameIn);
  if (id === PROJECT) openProject(projectIds(ROOT).find((x) => x !== id)!);
  fs.rmSync(projectDir(id), {recursive: true, force: true, maxRetries: 3});
  return listProjects();
}

// A folder a download filled in: writing this last is what makes it a project the app can see.
export function finishProject(id: string, name: string, created: number) {
  if (!ROOT || !PROJECT_ID.test(id)) throw bad('proyecto no encontrado', 404);
  writeProject(ROOT, id, {name, created});
  return listProjects();
}
// "styles/<id>" and "formats/<id>" that come with the app, and where its own LESSONS.md is: they don't need to travel.
export const seedPaths = () => new Set(seeds().map((s) => s.to));
export const lessonsSeed = () => source(seeds().find((s) => s.to === 'LESSONS.md')!);
export const isProjectId = (v: unknown): v is string => typeof v === 'string' && PROJECT_ID.test(v);

const projectListeners: ((id: string) => void)[] = [];
export const onProjectChange = (fn: (id: string) => void) => projectListeners.push(fn);

export function openProject(id: string) {
  if (!ROOT || !PROJECT_ID.test(id) || !readProject(ROOT, id)) throw bad('proyecto no encontrado', 404);
  writeConfig({projects: {...readConfig().projects, [ROOT]: id}});
  if (id === PROJECT) return listProjects();
  applyProject(id);
  for (const fn of projectListeners) fn(id);
  return listProjects();
}
// Runs a synchronous fn with the bindings on another project, for work of one that isn't open (an automation that
// starts a turn). Nothing else can run meanwhile and no listener hears it, so the pages stay on the open one.
export function withProject<T>(id: string, fn: () => T): T {
  if (!ROOT || !readProject(ROOT, id)) throw bad('proyecto no encontrado', 404);
  const open = PROJECT;
  applyProject(id);
  try {
    return fn();
  } finally {
    applyProject(open);
  }
}
// fn on the bindings of a project named by its id, or on the open one without it: for the calls of an agent, which name
// its own project (it goes on in it after he opens another one).
export function inProject<T>(project: string | undefined, fn: () => T): T {
  if (!project || project === PROJECT) return fn();
  if (!PROJECT_ID.test(project)) throw bad('proyecto no encontrado', 404);
  return withProject(project, fn);
}
export const projectName = () => (ROOT && PROJECT ? (readProject(ROOT, PROJECT)?.name ?? PROJECT) : '');
// A path inside the workspace as the agent sees it (from the workspace's root), with forward slashes.
export const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

const initial = process.env.REEL_STUDIO_WORKSPACE || readConfig().workspace || (!PACKAGED && (isDir(path.join(APP_ROOT, 'videos')) || isDir(path.join(APP_ROOT, 'projects'))) ? APP_ROOT : '');
if (initial && isDir(initial)) apply(path.resolve(initial));

/* ───── What a workspace starts with ───── */

// to: where it goes in the workspace. from: where it is in the repo (dev); the installer bundles each one
// at RESOURCES/<to>. Styles and skills go one by one, so a workspace that has some keeps them and gets the rest.
type Seed = {to: string; from: string};
const SEED_FIXED: Seed[] = [
  {to: 'template', from: 'template'},
  {to: 'tools', from: 'tools'},
  {to: 'scripts', from: 'scripts'},
  {to: 'refs/style-collage', from: 'refs/style-collage'},
  {to: 'CLAUDE.md', from: 'studio/workspace/CLAUDE.md'},
  {to: 'LESSONS.md', from: 'studio/workspace/LESSONS.md'},
  {to: '.gitignore', from: 'studio/workspace/gitignore'},
];
const children = (rel: string) => {
  try {
    return fs.readdirSync(path.join(RESOURCES, rel)).filter((n) => !n.startsWith('.') && isDir(path.join(RESOURCES, rel, n)));
  } catch {
    return [];
  }
};
// Only product styles seed new workspaces or ship in the installer. Other folders in this
// development workspace may be a customer's custom styles and must remain local.
const BUILTIN_STYLES = ['collage-semitono', 'cuaderno-apuntes', 'plano-tecnico'];
export const seeds = (): Seed[] => [
  ...SEED_FIXED,
  ...BUILTIN_STYLES.map((n) => ({to: `styles/${n}`, from: `styles/${n}`})),
  ...children('formats').map((n) => ({to: `formats/${n}`, from: `formats/${n}`})),
  ...children('.claude/skills').map((n) => ({to: `.claude/skills/${n}`, from: `.claude/skills/${n}`})),
];
const source = (s: Seed) => path.join(RESOURCES, PACKAGED ? s.to : s.from);
const SKIP = /(^|[\\/])(node_modules|out|__pycache__|\.DS_Store|\.venv)([\\/]|$)/;

// The seed entries a folder doesn't have yet.
export const missing = (dir: string) => seeds().filter((s) => fs.existsSync(source(s)) && !fs.existsSync(path.join(dir, s.to)));

// Copy into dir what it's missing. Returns what was copied.
function seed(dir: string): string[] {
  const todo = missing(dir);
  for (const s of todo) {
    const from = source(s);
    fs.mkdirSync(path.dirname(path.join(dir, s.to)), {recursive: true});
    fs.cpSync(from, path.join(dir, s.to), {recursive: true, filter: (src) => !SKIP.test(path.relative(from, src))});
  }
  return todo.map((s) => s.to);
}

// For the installer: copy every seed from the repo into out/<to> (the layout RESOURCES has when packaged).
export function stageResources(out: string) {
  if (PACKAGED) throw new Error('stageResources runs from the source repo');
  fs.rmSync(out, {recursive: true, force: true});
  for (const s of seeds()) {
    const from = source(s);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(out, s.to)), {recursive: true});
    fs.cpSync(from, path.join(out, s.to), {recursive: true, filter: (src) => !SKIP.test(path.relative(from, src))});
  }
}

/* ───── Choosing the folder ───── */

export const expand = (p: string) => path.resolve(p.trim().replace(/^~(?=$|[\\/])/, os.homedir()));
export const suggested = () => path.join(os.homedir(), 'Documents', 'Reel Studio');

// What's in a folder the user is about to choose.
export function inspect(p: string) {
  const dir = expand(p);
  const exists = fs.existsSync(dir);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
  } catch {
    /* doesn't exist or can't be read */
  }
  return {
    path: dir,
    exists,
    isDir: isDir(dir),
    empty: entries.length === 0,
    // It already looks like a workspace (styles/, projects/, the studio's data, or videos/ next to template/).
    workspace: isDir(path.join(dir, 'styles')) || isDir(path.join(dir, 'projects')) || isDir(path.join(dir, '.reel-studio')) || (isDir(path.join(dir, 'videos')) && isDir(path.join(dir, 'template'))),
    // Its videos: in every project, or (before projects) in videos/.
    videos: (() => {
      const count = (d: string) => {
        try {
          return fs.readdirSync(d).filter((n) => !n.startsWith('.') && !n.startsWith('_')).length;
        } catch {
          return 0;
        }
      };
      return count(path.join(dir, 'videos')) + projectIds(dir).reduce((n, id) => n + count(path.join(dir, 'projects', id, 'videos')), 0);
    })(),
    missing: missing(dir).map((s) => s.to),
  };
}

const listeners: ((dir: string) => void)[] = [];
export const onChange = (fn: (dir: string) => void) => listeners.push(fn);

// Use dir as the workspace (created if needed), fill in what it lacks and remember it for next time.
export function setWorkspace(p: string) {
  const dir = expand(p);
  if (fs.existsSync(dir) && !isDir(dir)) throw Object.assign(new Error('esa ruta es un archivo, no una carpeta'), {status: 400});
  fs.mkdirSync(dir, {recursive: true});
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw Object.assign(new Error('no puedo escribir en esa carpeta'), {status: 400});
  }
  const copied = seed(dir);
  writeConfig({workspace: dir});
  const changed = dir !== ROOT;
  apply(dir);
  if (changed) for (const fn of listeners) fn(dir);
  return copied;
}

export const status = () => ({
  configured: !!ROOT,
  path: ROOT || null,
  packaged: PACKAGED,
  suggested: suggested(),
  missing: ROOT ? missing(ROOT).map((s) => s.to) : [],
});
