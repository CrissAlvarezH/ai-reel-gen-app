// What the studio needs on this machine besides the agent (Ajustes → Requisitos and the welcome page):
// Node and npm (each video is a Remotion project), ffmpeg (voice, mix and render), Python (voice, word
// timings and photo search use only its standard library), and, for styles that make photo cutouts, the
// workspace's .venv with tools/requirements.txt and rembg's model. Plus Remotion's headless Chrome, which
// each video downloads on its first render, and, for Inspiración, faster-whisper with its model in the same venv. Installing or repairing runs as a job with a log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {IS_MAC, IS_WIN, PY, needsShell, output as out, venvPython, which} from './platform.ts';
import {ROOT, VIDEOS, listProjects} from './workspace.ts';
import {listStyles} from './styles.ts';
import {listFormats} from './formats.ts';
import {httpError} from './reels.ts';
import type {Requirement} from '../shared/types.ts';

const MODEL = 'isnet-general-use'; // the rembg model tools/cutout.py uses
const WHISPER = 'small'; // the faster-whisper model tools/inspiration.py uses (WHISPER_MODEL there)
const PACKAGES = [
  ['PIL', 'pillow'],
  ['numpy', 'numpy'],
  ['scipy', 'scipy'],
  ['rembg', 'rembg'],
  ['oxipng', 'pyoxipng'],
] as const;

export const venvPy = () => venvPython(ROOT);
const exists = (p: string) => fs.existsSync(p);
const major = (v: string | null) => Number(v?.match(/(\d+)\./)?.[1] ?? 0);

// How to install a program here: Homebrew on macOS, winget on Windows (both run from the studio);
// on Linux, the command to run in a terminal (it needs sudo).
function systemFix(label: string, brew: string, winget: string, apt: string): Requirement['fix'] {
  if (IS_MAC) return which('brew') ? {label: 'Instalar', command: `brew install ${brew}`, auto: true} : {label, command: `Instala Homebrew (https://brew.sh) y luego: brew install ${brew}`, auto: false};
  if (IS_WIN) return which('winget') ? {label: 'Instalar', command: `winget install -e --accept-source-agreements --accept-package-agreements --id ${winget}`, auto: true} : {label, command: `winget install -e --id ${winget}`, auto: false};
  return {label, command: `sudo apt install ${apt}`, auto: false};
}

// The rembg model, wherever this rembg version keeps it (newer: ~/.rembg/models/<name>/, older: ~/.u2net/).
function modelFound() {
  const home = os.homedir();
  const xdg = process.env.XDG_DATA_HOME;
  const dirs = [
    process.env.U2NET_HOME,
    process.env.REMBG_HOME && path.join(process.env.REMBG_HOME, 'models', MODEL),
    path.join(xdg ? path.join(xdg, 'rembg') : path.join(home, '.rembg'), 'models', MODEL),
    path.join(xdg ?? home, '.u2net'),
  ].filter((d): d is string => !!d);
  return dirs.some((d) => {
    try {
      return fs.readdirSync(d).some((n) => n.startsWith(MODEL) && n.endsWith('.onnx'));
    } catch {
      return false;
    }
  });
}

// faster-whisper's model in the Hugging Face cache.
function whisperModelFound() {
  const home = os.homedir();
  const hub = process.env.HF_HUB_CACHE ?? (process.env.HF_HOME ? path.join(process.env.HF_HOME, 'hub') : path.join(process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'huggingface/hub'));
  const snaps = path.join(hub, `models--Systran--faster-whisper-${WHISPER}`, 'snapshots');
  try {
    return fs.readdirSync(snaps).some((d) => exists(path.join(snaps, d, 'model.bin')));
  } catch {
    return false;
  }
}

// Formats that need his recording (tools/footage.py transcribes it with faster-whisper) and some video of the open
// project uses.
const footageFormatsUsed = () => {
  const ids = new Set(listFormats().filter((f) => f.footage).map((f) => f.id));
  if (!ids.size || !VIDEOS) return [];
  const used = new Set<string>();
  try {
    for (const slug of fs.readdirSync(VIDEOS)) {
      try {
        const id = fs.readFileSync(path.join(VIDEOS, slug, 'format.txt'), 'utf8').trim();
        if (ids.has(id)) used.add(id);
      } catch {
        /* no format.txt: animated */
      }
    }
  } catch {
    /* no videos */
  }
  return listFormats().filter((f) => used.has(f.id)).map((f) => f.name);
};
// Inspiración has accounts or reels in some project (projects/<id>/inspiration/<account>/).
const inspirationUsed = () =>
  listProjects().some(({id}) => {
    try {
      return fs.readdirSync(path.join(ROOT, 'projects', id, 'inspiration')).some((n) => !n.startsWith('.'));
    } catch {
      return false;
    }
  });

/* ───── Probes ───── */

// What the commands answer (versions, the venv's packages). Starting them is the slow part, so they run in
// parallel and the answer is kept for a few seconds: the page polls every 1.5 s while a job runs. A job
// that ends clears it, so the next look shows what changed.
type Probe = {
  node: string | null;
  nodeV: string | null;
  npm: string | null;
  npmV: string | null;
  ffmpeg: string | null;
  ffV: string | null;
  py: string | null;
  pyV: string | null;
  venv: {version: string | null; missing: string[]; whisper: boolean; ytdlp: boolean} | null; // null: no .venv
};
const PROBE_TTL = 5000;
let probeCache: {root: string; at: number; p: Promise<Probe>} | null = null;
const forget = () => (probeCache = null);

function probe(): Promise<Probe> {
  if (probeCache && probeCache.root === ROOT && Date.now() - probeCache.at < PROBE_TTL) return probeCache.p;
  const p = runProbes();
  probeCache = {root: ROOT, at: Date.now(), p};
  return p;
}

async function runProbes(): Promise<Probe> {
  const node = which('node'), npm = which('npm'), ffmpeg = which('ffmpeg'), py = which(PY);
  const vpy = ROOT ? venvPy() : null;
  // One Python run for the venv: its version, the packages it lacks, and whether it has faster-whisper.
  const venvProbe = [
    'import sys, importlib.util as u',
    'print(sys.version.split()[0])',
    `print(' '.join(p for m, p in ${JSON.stringify(PACKAGES)} if not u.find_spec(m)))`,
    "print(bool(u.find_spec('faster_whisper')))",
    "print(bool(u.find_spec('yt_dlp')))",
  ].join('\n');
  const [nodeV, npmV, ffOut, pyOut, venvOut] = await Promise.all([
    node ? out(node, ['--version']) : null,
    npm ? out(npm, ['--version']) : null,
    ffmpeg ? out(ffmpeg, ['-version']) : null,
    py ? out(py, ['--version']) : null,
    vpy && exists(vpy) ? out(vpy, ['-c', venvProbe]) : null,
  ]);
  let venv: Probe['venv'] = null;
  if (vpy && exists(vpy)) {
    const [version = null, missing = '', whisper = '', ytdlp = ''] = venvOut?.split('\n') ?? [];
    // It didn't run: say everything is missing (Reparar reinstalls).
    venv = venvOut === null ? {version: null, missing: PACKAGES.map(([, pkg]) => pkg), whisper: false, ytdlp: false} : {version, missing: missing.split(/\s+/).filter(Boolean), whisper: whisper.trim() === 'True', ytdlp: ytdlp.trim() === 'True'};
  }
  return {
    node,
    nodeV,
    npm,
    npmV,
    ffmpeg,
    ffV: ffOut?.match(/ffmpeg version (\S+)/)?.[1] ?? null,
    py,
    pyV: pyOut?.replace(/^Python\s*/, '') ?? null,
    venv,
  };
}

// Whether Investigación can download YouTube Shorts to analyse them: yt-dlp in the venv (YouTube gives no direct link).
export async function ytdlpReady() {
  if (!ROOT || !exists(venvPy())) return false;
  return !!(await probe()).venv?.ytdlp;
}

// Investigación has a research in some project (projects/<id>/research/<id>/).
const researchUsed = () =>
  listProjects().some(({id}) => {
    try {
      return fs.readdirSync(path.join(ROOT, 'projects', id, 'research')).some((n) => !n.startsWith('.'));
    } catch {
      return false;
    }
  });

// Whether Inspiración can transcribe: faster-whisper in the venv and its model downloaded. Inspiración asks
// on every refresh, so this answer is kept longer (and also cleared when a job ends).
const READY_TTL = 60_000;
let readyCache: {root: string; at: number; value: boolean} | null = null;
export async function transcriberReady() {
  if (!ROOT || !exists(venvPy()) || !whisperModelFound()) return false;
  if (readyCache && readyCache.root === ROOT && Date.now() - readyCache.at < READY_TTL) return readyCache.value;
  const value = !!(await probe()).venv?.whisper;
  readyCache = {root: ROOT, at: Date.now(), value};
  return value;
}

// Videos whose node_modules has Remotion but not its headless Chrome yet.
function videosWithoutBrowser() {
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(VIDEOS).filter((n) => !n.startsWith('.') && exists(path.join(VIDEOS, n, 'node_modules/remotion')));
  } catch {
    return {all: 0, missing: []};
  }
  return {all: slugs.length, missing: slugs.filter((n) => !exists(path.join(VIDEOS, n, 'node_modules/.remotion/chrome-headless-shell')))};
}

/* ───── Jobs ───── */

type Job = NonNullable<Requirement['job']>;
const jobs = new Map<string, Job>();

// Run steps one after the other (each [file, args, cwd]); the log keeps the end of their output.
function runJob(id: string, steps: [string, string[], string][]) {
  if (jobs.get(id)?.running) throw httpError(409, 'ya se está instalando');
  const job: Job = {running: true, ok: null, log: '', started: Date.now()};
  jobs.set(id, job);
  const add = (s: string) => (job.log = (job.log + s).slice(-6000));
  // Whatever it installed changes what the checks see.
  const end = (ok: boolean) => {
    Object.assign(job, {running: false, ok});
    forget();
    readyCache = null;
  };
  const next = (i: number) => {
    if (i >= steps.length) return end(true);
    const [file, args, cwd] = steps[i];
    add(`$ ${[path.basename(file), ...args].join(' ')}\n`);
    const p = spawn(file, args, {cwd, shell: needsShell(file), env: process.env});
    p.stdout.on('data', (d: Buffer) => add(String(d)));
    p.stderr.on('data', (d: Buffer) => add(String(d)));
    p.on('error', (e) => {
      add(`\n${e.message}\n`);
      end(false);
    });
    p.on('close', (code) => {
      if (code === 0) return next(i + 1);
      add(`\nterminó con código ${code}\n`);
      end(false);
    });
  };
  next(0);
}

/* ───── Checks ───── */

export async function check(): Promise<Requirement[]> {
  const cutoutStyles = ROOT ? listStyles().filter((s) => s.cutouts).map((s) => s.name) : [];
  const job = (id: string) => jobs.get(id) ?? null;
  const reqs: Requirement[] = [];
  const {node, nodeV, npm, npmV, ffmpeg, ffV, py, pyV, venv} = await probe();

  reqs.push({
    id: 'node',
    label: 'Node.js',
    ok: major(nodeV?.replace(/^v/, '') ?? null) >= 20,
    version: nodeV,
    detail: !node ? 'No está instalado. Cada video es un proyecto de Remotion que se instala y renderiza con Node.' : major(nodeV?.replace(/^v/, '') ?? null) >= 20 ? node : `Hace falta la versión 20 o posterior (${node}).`,
    neededBy: null,
    fix: systemFix('Instálalo', 'node', 'OpenJS.NodeJS.LTS', 'nodejs npm'),
    job: job('node'),
  });

  reqs.push({
    id: 'npm',
    label: 'npm',
    ok: !!npmV,
    version: npmV,
    detail: npmV ? npm! : 'No está instalado (viene con Node.js). Instala las dependencias de cada video.',
    neededBy: null,
    fix: npmV ? null : systemFix('Instálalo', 'node', 'OpenJS.NodeJS.LTS', 'npm'),
    job: job('npm') ?? job('node'),
  });

  reqs.push({
    id: 'ffmpeg',
    label: 'ffmpeg',
    ok: !!ffV,
    version: ffV,
    detail: ffV ? ffmpeg! : 'No está instalado. Convierte la voz, mezcla el sonido y normaliza el volumen del render.',
    neededBy: null,
    fix: systemFix('Instálalo', 'ffmpeg', 'Gyan.FFmpeg', 'ffmpeg'),
    job: job('ffmpeg'),
  });

  const pyOk = !!pyV && (major(pyV) > 3 || (major(pyV) === 3 && Number(pyV.split('.')[1]) >= 10));
  reqs.push({
    id: 'python',
    label: 'Python',
    ok: pyOk,
    version: pyV,
    detail: !pyV ? 'No está instalado. La voz, los tiempos de las palabras y la búsqueda de fotos son scripts de Python (sin paquetes).' : pyOk ? py! : `Hace falta la versión 3.10 o posterior (${py}).`,
    neededBy: null,
    fix: systemFix('Instálalo', 'python', 'Python.Python.3.12', 'python3 python3-venv'),
    job: job('python'),
  });

  // The workspace's venv with tools/requirements.txt: only styles that make cutouts need it.
  if (ROOT) {
    const vpy = venvPy();
    const missing: string[] = venv?.missing ?? PACKAGES.map(([, pkg]) => pkg);
    const vV = venv?.version ?? null;
    reqs.push({
      id: 'venv',
      label: 'Paquetes de Python (.venv)',
      ok: exists(vpy) && missing.length === 0,
      version: vV,
      detail: !exists(vpy)
        ? `No existe ${path.join('.venv')} en la carpeta de trabajo. Recortes de fotos (rembg) y sonido de la plantilla (numpy, scipy).`
        : missing.length
          ? `Faltan: ${missing.join(', ')}.`
          : 'pillow, numpy, scipy, rembg y pyoxipng instalados.',
      neededBy: cutoutStyles,
      fix: pyOk ? {label: exists(vpy) ? 'Reparar' : 'Instalar', command: `${PY} -m venv .venv && pip install -r tools/requirements.txt`, auto: true} : null,
      job: job('venv'),
    });

    const model = modelFound();
    reqs.push({
      id: 'rembg-model',
      label: `Modelo de recorte (${MODEL})`,
      ok: model,
      version: null,
      detail: model ? 'Descargado.' : 'rembg lo descarga la primera vez que recorta una foto (unos 170 MB). Puedes bajarlo ya.',
      neededBy: cutoutStyles,
      fix: exists(vpy) && !missing.includes('rembg') ? {label: 'Descargar', command: `python -c "from rembg import new_session; new_session('${MODEL}')"`, auto: true} : null,
      job: job('rembg-model'),
    });

    const whisperPkg = !!venv?.whisper;
    const whisper = whisperPkg && whisperModelFound();
    readyCache = {root: ROOT, at: Date.now(), value: whisper};
    reqs.push({
      id: 'whisper',
      label: `Transcripción (faster-whisper, modelo ${WHISPER})`,
      ok: whisper,
      version: null,
      detail: whisper
        ? 'Instalada, con el modelo descargado. Transcribe sin conexión y gratis.'
        : `Transcribe los reels de Inspiración y tus grabaciones (formatos con tu video) en este equipo, sin conexión. ${whisperPkg ? 'Falta descargar el modelo (unos 480 MB).' : 'Instala faster-whisper en el .venv y descarga el modelo (unos 600 MB en total).'}`,
      neededBy: [...(inspirationUsed() ? ['Inspiración'] : []), ...footageFormatsUsed()],
      unused: 'para Inspiración y los formatos con tu grabación',
      fix: pyOk ? {label: whisperPkg ? 'Descargar' : 'Instalar', command: `${PY} -m venv .venv && pip install -r tools/requirements-whisper.txt`, auto: true} : null,
      job: job('whisper'),
    });

    const ytdlp = !!venv?.ytdlp;
    reqs.push({
      id: 'ytdlp',
      label: 'Descarga de YouTube (yt-dlp)',
      ok: ytdlp,
      version: null,
      detail: ytdlp ? 'Instalado.' : 'Investigación lo usa para bajar los YouTube Shorts que analiza (YouTube no da el enlace del video). Se instala en el .venv.',
      neededBy: researchUsed() ? ['Investigación'] : [],
      unused: 'para analizar YouTube Shorts en Investigación',
      fix: pyOk ? {label: 'Instalar', command: `${PY} -m venv .venv && pip install yt-dlp`, auto: true} : null,
      job: job('ytdlp'),
    });

    const b = videosWithoutBrowser();
    reqs.push({
      id: 'browser',
      label: 'Chrome headless de Remotion',
      ok: b.missing.length === 0,
      version: null,
      detail: !b.all
        ? 'Cada video lo descarga en su primer render o still.'
        : b.missing.length
          ? `Falta en ${b.missing.length} de ${b.all} video${b.all > 1 ? 's' : ''} (${b.missing.join(', ')}). Se descarga en su primer render, o ahora.`
          : `Descargado en ${b.all === 1 ? 'el video' : `los ${b.all} videos`}.`,
      neededBy: null,
      fix: b.missing.length && npm ? {label: 'Descargar', command: 'npx remotion browser ensure', auto: true} : null,
      job: job('browser'),
    });
  }
  return reqs;
}

// Install or repair one requirement (only the ones with an automatic fix).
export async function fix(id: string) {
  const r = (await check()).find((x) => x.id === id);
  if (!r) throw httpError(404, 'requisito desconocido');
  if (!r.fix?.auto) throw httpError(400, 'esto hay que instalarlo a mano');
  if (['node', 'npm', 'ffmpeg', 'python'].includes(id)) {
    const [cmd, ...args] = r.fix.command.split(' ');
    const file = which(cmd);
    if (!file) throw httpError(400, `no encuentro ${cmd}`);
    return runJob(id, [[file, args, os.homedir()]]);
  }
  if (id === 'venv') {
    const py = which(PY)!;
    const steps: [string, string[], string][] = [];
    if (!exists(venvPy())) steps.push([py, ['-m', 'venv', '.venv'], ROOT]);
    steps.push([venvPy(), ['-m', 'pip', 'install', '--upgrade', '-r', path.join('tools', 'requirements.txt')], ROOT]);
    return runJob(id, steps);
  }
  if (id === 'whisper') {
    const steps: [string, string[], string][] = [];
    if (!exists(venvPy())) steps.push([which(PY)!, ['-m', 'venv', '.venv'], ROOT]);
    steps.push([venvPy(), ['-m', 'pip', 'install', '--upgrade', '-r', path.join('tools', 'requirements-whisper.txt')], ROOT]);
    steps.push([venvPy(), ['-c', `from faster_whisper import WhisperModel; WhisperModel('${WHISPER}', device='cpu', compute_type='int8'); print('modelo listo')`], ROOT]);
    return runJob(id, steps);
  }
  if (id === 'ytdlp') {
    const steps: [string, string[], string][] = [];
    if (!exists(venvPy())) steps.push([which(PY)!, ['-m', 'venv', '.venv'], ROOT]);
    steps.push([venvPy(), ['-m', 'pip', 'install', '--upgrade', 'yt-dlp'], ROOT]);
    return runJob(id, steps);
  }
  if (id === 'rembg-model') return runJob(id, [[venvPy(), ['-c', `from rembg import new_session; new_session('${MODEL}'); print('ok')`], ROOT]]);
  if (id === 'browser') {
    const npx = which('npx');
    if (!npx) throw httpError(400, 'no encuentro npx');
    return runJob(id, videosWithoutBrowser().missing.map((slug) => [npx, ['remotion', 'browser', 'ensure'], path.join(VIDEOS, slug)] as [string, string[], string]));
  }
}
