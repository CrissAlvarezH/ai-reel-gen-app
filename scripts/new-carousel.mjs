// Copy a new carousel's folder from carousel-template/: the one routine Reel Studio (studio/server/create.ts) and the
// agent use, so a carousel starts the same way from the app or from the agent's shell. Plain Node, no dependencies.
//
//   node scripts/new-carousel.mjs <slug> [style] [--from <video slug>] [--title "name"]   (from the workspace)
//     → installs its dependencies and prints "<style id> <carousel dir>"
//
// A carousel lives with the videos, in the project's videos/<slug>/ (one namespace: a slug is never both), marked by
// kind.txt = "carousel". It gets the template's files (without node_modules/ and out/), package.json named after it,
// kind.txt, created.txt, style.txt, title.txt (when given) and from.txt (the video whose script it starts from).
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectDir, validSlug} from './new-video.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// The workspace's carousel-template/, else the one the app carries next to this script (a workspace made before
// carousels doesn't have it).
export const templateDir = (root) => [path.join(root, 'carousel-template'), path.join(here, '..', 'carousel-template')].find((d) => fs.existsSync(path.join(d, 'carousel.json'))) ?? null;

// A style that does carousels: the one given, else the project's, else the workspace's default, else the first with a
// "carousel" block. builtin: style.json files the app carries (for workspaces whose copy predates carousels).
export function resolveCarouselStyle(root, id, project) {
  let ids = [];
  try {
    ids = fs.readdirSync(path.join(root, 'styles'));
  } catch {
    /* no styles/ */
  }
  const all = ids.flatMap((sid) => {
    const j = readJson(path.join(root, 'styles', sid, 'style.json'));
    if (!j || typeof j !== 'object') return [];
    const carousel = j.carousel ?? readJson(path.join(here, '..', 'styles', sid, 'style.json'))?.carousel;
    return [{id: sid, default: j.default === true, carousel: !!carousel && typeof carousel === 'object'}];
  });
  if (id) return all.find((s) => s.id === id && s.carousel)?.id ?? null;
  const mine = project ? readJson(path.join(project, 'config/profile.json'))?.style : null;
  return (all.find((s) => s.id === mine && s.carousel) ?? all.find((s) => s.default && s.carousel) ?? all.find((s) => s.carousel))?.id ?? null;
}

export function scaffoldCarousel({root, project = projectDir(root), slug, style, title, from}) {
  if (!validSlug(slug)) throw new Error(`nombre de carrusel no válido: ${slug}`);
  const dir = path.join(project, 'videos', slug);
  if (fs.existsSync(dir)) throw new Error(`${path.relative(root, dir)} ya existe`);
  const tpl = templateDir(root);
  if (!tpl) throw new Error('no existe la plantilla carousel-template');
  if (from && !(validSlug(from) && fs.existsSync(path.join(project, 'videos', from)))) throw new Error(`no existe el video ${from}`);
  fs.cpSync(tpl, dir, {recursive: true, filter: (src) => !/(^|[\\/])(node_modules|out)([\\/]|$)/.test(path.relative(tpl, src))});
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace('"name":"carousel"', `"name":${JSON.stringify(slug)}`));
  fs.writeFileSync(path.join(dir, 'kind.txt'), 'carousel\n');
  fs.writeFileSync(path.join(dir, 'created.txt'), `${new Date().toISOString()}\n`);
  fs.writeFileSync(path.join(dir, 'style.txt'), `${style}\n`);
  if (title) fs.writeFileSync(path.join(dir, 'title.txt'), `${title}\n`);
  if (from) fs.writeFileSync(path.join(dir, 'from.txt'), `${from}\n`);
  return dir;
}

// CLI: run from the workspace.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const from = opt('--from');
  const title = opt('--title');
  const [slug, want] = args;
  const root = process.cwd();
  let dir;
  try {
    const project = projectDir(root);
    const style = resolveCarouselStyle(root, want, project);
    if (!style) throw new Error(want ? `el estilo ${want} no existe o no hace carruseles` : 'ningún estilo hace carruseles');
    dir = scaffoldCarousel({root, project, slug, style, title, from});
    const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--silent'], {cwd: dir, stdio: 'inherit', shell: process.platform === 'win32'});
    if (npm.status !== 0) console.error('npm install falló: inténtalo otra vez en su carpeta');
    console.log(style, path.relative(root, dir).split(path.sep).join('/'));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  // Like new-video.mjs: made by the agent of a general conversation, that conversation goes on in it.
  const {REEL_STUDIO: key, REEL_STUDIO_CHAT: chat, REEL_STUDIO_URL: url} = process.env;
  if (key === '_general' && chat && url) {
    try {
      const r = await fetch(`${url}/api/chat/_general/${encodeURIComponent(chat)}/move`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({slug, auto: true})});
      const j = await r.json().catch(() => ({}));
      console.error(j.slug ? `Esta conversación pasa al carrusel ${j.slug} al terminar el turno.` : j.note || j.error || '');
    } catch {
      // the studio isn't answering: the carousel is made all the same
    }
  }
}
