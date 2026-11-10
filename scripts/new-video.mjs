// Copy a new video's folder from its style's template: the one routine both Reel Studio (studio/server/create.ts)
// and scripts/new-video.sh use, so a video starts the same way from the app or from the agent's shell.
// Plain Node, no dependencies: it ships in every workspace's scripts/.
//
//   node scripts/new-video.mjs <slug> [style] [format]   (from the workspace) → prints "<style id> <format id> <template dir> <video dir>"
//
// The video goes to a project's videos/ (projects/<id>/videos/<slug>): the one in REEL_STUDIO_PROJECT (Reel
// Studio sets it for its agent: the open project), else the only one there is; a workspace from before
// projects keeps its videos/ at the root.
//
// The video gets: the template's files (without node_modules/ and out/), then its format's overlay (files a format
// adds over the style's template, e.g. the talking-head layer), package.json named after it, style.txt, format.txt
// (the kind of video: formats/<id>), title.txt (when given) and src/format.json. The format is the one given, else the profile's
// (the project's config/profile.json, set in Ajustes → Perfil), else the template's own (1080×1920, 30 fps, -14 LUFS,
// which is also what every platform preset is today).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FPS_OPTIONS = [24, 25, 30, 50, 60];
export const validSlug = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// A valid format, or undefined. Sizes are even (the H.264 encoder needs it), fps one of FPS_OPTIONS.
export function cleanFormat(v) {
  const i = v && typeof v === 'object' ? v : {};
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  const even = (x) => (finite(x) ? Math.round(Math.min(4096, Math.max(240, x)) / 2) * 2 : undefined);
  const width = even(i.width), height = even(i.height);
  const lufs = finite(i.lufs) ? Math.round(Math.min(-6, Math.max(-30, i.lufs)) * 10) / 10 : undefined;
  const fps = FPS_OPTIONS.includes(i.fps) ? i.fps : undefined;
  return width && height && fps && lufs !== undefined ? {width, height, fps, lufs} : undefined;
}

// A style id and its template folder (relative to the workspace), from styles/*/style.json. No id: the
// project's default (its config/profile.json "style", set in Ajustes → Perfil) if it exists, else the
// workspace's default. A style without a template of its own uses the workspace default's. Unknown style: null.
export function resolveStyle(root, id, project) {
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(root, 'styles'));
  } catch {
    /* no styles/ */
  }
  const all = ids.flatMap((sid) => {
    const j = readJson(path.join(root, 'styles', sid, 'style.json'));
    return j && typeof j === 'object' ? [{id: sid, ...j}] : [];
  });
  const def = all.find((s) => s.default) ?? all[0];
  const mine = project ? readJson(path.join(project, 'config/profile.json'))?.style : null;
  const s = id ? all.find((x) => x.id === id) : (all.find((x) => x.id === mine) ?? def);
  if (!s) return null;
  return {id: s.id, template: (typeof s.template === 'string' && s.template) || def?.template || 'template'};
}

// A format id (formats/<id>/format.json: the kind of video, e.g. animated or talking head) and the folder of files it
// adds over the style's template (null: none). No id: the workspace's default format. Unknown format: null. A
// workspace from before formats has none: {id: null}.
export function resolveFormat(root, id) {
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(root, 'formats'));
  } catch {
    /* no formats/ */
  }
  const all = ids.flatMap((fid) => {
    const j = readJson(path.join(root, 'formats', fid, 'format.json'));
    return j && typeof j === 'object' ? [{id: fid, ...j}] : [];
  });
  if (!all.length && !id) return {id: null, overlay: null};
  const f = id ? all.find((x) => x.id === id) : (all.find((x) => x.default) ?? all[0]);
  if (!f) return null;
  return {id: f.id, overlay: (typeof f.overlay === 'string' && f.overlay) || null};
}

// The folder of the project a new video goes to (see above).
export function projectDir(root) {
  if (process.env.REEL_STUDIO_PROJECT) return path.resolve(root, process.env.REEL_STUDIO_PROJECT);
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(root, 'projects')).filter((n) => fs.existsSync(path.join(root, 'projects', n, 'project.json')));
  } catch {
    /* no projects/ */
  }
  if (ids.length === 1) return path.join(root, 'projects', ids[0]);
  if (ids.length > 1) throw new Error(`hay varios proyectos (${ids.join(', ')}): di en cuál con REEL_STUDIO_PROJECT=projects/<id> (Reel Studio lo pone para su agente)`);
  return root;
}

// kind: the video's format from resolveFormat ({id, overlay}); format: its size, fps and loudness.
export function scaffold({root, project = projectDir(root), slug, style, template, kind, title, format}) {
  if (!validSlug(slug)) throw new Error(`nombre de video no válido: ${slug}`);
  const dir = path.join(project, 'videos', slug);
  if (fs.existsSync(dir)) throw new Error(`${path.relative(root, dir)} ya existe`);
  const from = path.join(root, template);
  if (!fs.existsSync(from)) throw new Error(`no existe la plantilla ${template}`);
  fs.cpSync(from, dir, {recursive: true, filter: (src) => !/(^|[\\/])(node_modules|out)([\\/]|$)/.test(path.relative(from, src))});
  if (kind?.overlay) {
    const over = path.join(root, kind.overlay);
    if (!fs.existsSync(over)) throw new Error(`no existe ${kind.overlay}`);
    fs.cpSync(over, dir, {recursive: true});
  }
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('"name":"reel"', `"name":${JSON.stringify(slug)}`));
  fs.writeFileSync(path.join(dir, 'created.txt'), `${new Date().toISOString()}\n`); // when it was made (Reel Studio's library)
  fs.writeFileSync(path.join(dir, 'style.txt'), `${style}\n`);
  if (kind?.id) fs.writeFileSync(path.join(dir, 'format.txt'), `${kind.id}\n`);
  if (title) fs.writeFileSync(path.join(dir, 'title.txt'), `${title}\n`);
  const f = cleanFormat(format) ?? cleanFormat(readJson(path.join(project, 'config/profile.json'))?.format);
  if (f) {
    fs.mkdirSync(path.join(dir, 'src'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'src/format.json'), JSON.stringify(f) + '\n');
  }
  return dir;
}

// CLI (scripts/new-video.sh): run from the workspace.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [slug, want, wantFormat] = process.argv.slice(2);
  const root = process.cwd();
  try {
    const project = projectDir(root);
    const s = resolveStyle(root, want, project);
    if (!s) throw new Error(`no existe el estilo ${want}`);
    const kind = resolveFormat(root, wantFormat);
    if (!kind) throw new Error(`no existe el formato ${wantFormat}`);
    const dir = scaffold({root, project, slug, style: s.id, template: s.template, kind});
    console.log(s.id, kind.id ?? '-', s.template, path.relative(root, dir).split(path.sep).join('/'));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  // Created by the agent of one of Reel Studio's general conversations (it sets these for its agents): that
  // conversation goes on in this video when its turn ends. The studio decides (one video per turn); never fails the creation.
  const {REEL_STUDIO: key, REEL_STUDIO_CHAT: chat, REEL_STUDIO_URL: url} = process.env;
  if (key === '_general' && chat && url) {
    try {
      const r = await fetch(`${url}/api/chat/_general/${encodeURIComponent(chat)}/move`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({slug, auto: true})});
      const j = await r.json().catch(() => ({}));
      console.error(j.slug ? `Esta conversación pasa al video ${j.slug} al terminar el turno.` : j.note || j.error || '');
    } catch {
      // the studio isn't answering: the video is made all the same
    }
  }
}
