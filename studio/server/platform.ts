// What changes between macOS, Windows and Linux, in one place: opening a folder in the file manager,
// running npm and .cmd files, and where the Python of the workspace's .venv lives. Plus small helpers
// the server modules share (running a command, JSON files).
import fs from 'node:fs';
import path from 'node:path';
import {execFile, spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

// Open a folder in Finder, Explorer or the Linux file manager.
export function reveal(dir: string, selectFile = false) {
  const cmd = IS_MAC ? 'open' : IS_WIN ? 'explorer' : 'xdg-open';
  const args = selectFile ? (IS_MAC ? ['-R', dir] : IS_WIN ? [`/select,${dir}`] : [path.dirname(dir)]) : [dir];
  spawn(cmd, args, {stdio: 'ignore', detached: true}).on('error', () => {}).unref();
}

// A .cmd or .bat (npm.cmd, a claude.cmd shim…) only runs through a shell, on Windows.
export const needsShell = (file: string) => IS_WIN && /\.(cmd|bat)$/i.test(file);

// npm is npm.cmd on Windows.
export const npm = (args: string[], opts: SpawnOptions) => spawn(IS_WIN ? 'npm.cmd' : 'npm', args, {...opts, shell: IS_WIN});

// Python for the tools that only need its standard library (voice, word timings, image search).
export const PY = IS_WIN ? 'python' : 'python3';

// The .venv's Python inside a workspace (VENV_BIN: inside .venv/).
export const VENV_BIN = IS_WIN ? 'Scripts/python.exe' : 'bin/python';
export const venvPython = (root: string) => path.join(root, '.venv', VENV_BIN);

// Run a command and return its output (stdout + stderr), or null if it couldn't run or failed.
export const output = (file: string, args: string[], timeout = 20000) =>
  new Promise<string | null>((resolve) =>
    execFile(file, args, {timeout, shell: needsShell(file), maxBuffer: 1 << 20}, (err, stdout, stderr) => resolve(err ? null : `${stdout}${stderr}`.trim())),
  );

// JSON files: null when missing or unreadable; writing creates the folder.
export function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}
// Atomic: written next to it and renamed over it, so a crash half-way never leaves a cut JSON.
export function writeJson(p: string, v: unknown, indent = 2) {
  fs.mkdirSync(path.dirname(p), {recursive: true});
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, indent) + '\n');
  fs.renameSync(tmp, p);
}

// A path as Vite's /@fs/ URL wants it (forward slashes, also for C:\ on Windows).
export const fsUrl = (p: string) => `/@fs/${p.replace(/\\/g, '/').replace(/^\//, '')}`;

// An app opened from the Dock (or a desktop launcher) doesn't get the terminal's PATH, so Homebrew's node,
// ffmpeg or python aren't found. Add the login shell's PATH to this process once; every command the
// studio starts inherits it. Nothing to do on Windows.
export async function loadShellPath() {
  if (IS_WIN) return;
  const shell = process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash');
  const out = await new Promise<string>((resolve) =>
    execFile(shell, ['-lic', 'printf "\\n__PATH__%s\\n" "$PATH"'], {timeout: 8000}, (_e, stdout) => resolve(String(stdout ?? ''))),
  );
  const login = out.match(/__PATH__(.*)/)?.[1]?.trim();
  const extra = IS_MAC ? ['/opt/homebrew/bin', '/usr/local/bin'] : ['/usr/local/bin'];
  const dirs = [...(login ? login.split(':') : []), ...(process.env.PATH ?? '').split(':'), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(dirs)].join(':');
}

// The full path of a command on PATH (with .exe/.cmd on Windows), or null.
export function which(name: string): string | null {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

// Kill a process and everything it started: codex's npm launcher runs the real binary as its child, and
// tools/inspiration.py runs ffmpeg. On macOS and Linux the process must have been spawned with detached
// (GROUP) so it leads its own group; on Windows taskkill /T walks the tree.
export const GROUP = !IS_WIN;
export function killTree(p: ChildProcess) {
  if (!p.pid || p.exitCode !== null) return;
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], {stdio: 'ignore'}).on('error', () => p.kill());
    return;
  }
  try {
    process.kill(-p.pid, 'SIGKILL');
  } catch {
    p.kill('SIGKILL');
  }
}
