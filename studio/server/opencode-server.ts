// A private `opencode serve` for this app: on a free local port, with a throwaway password. Unlike the CLI's
// background service (which the person's own OpenCode may be using), it reads the config it's started with and
// goes away with us. No dependency on the rest of the studio: opencode-turn.ts runs this in its own process.
import {spawn, type ChildProcess} from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';

export const IS_WIN = process.platform === 'win32';
// An npm install on Windows is a .cmd shim, which only runs through a shell.
export const shellFor = (bin: string) => IS_WIN && /\.(cmd|bat)$/i.test(bin);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const {port} = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

export function killServer(p: ChildProcess) {
  if (!p.pid || p.exitCode !== null) return;
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], {stdio: 'ignore'}).on('error', () => p.kill());
    return;
  }
  try {
    process.kill(-p.pid, 'SIGTERM');
  } catch {
    p.kill('SIGTERM');
  }
}

export type OpenCodeServer = {
  url: string;
  password: string;
  proc: ChildProcess;
  // A request to it, with its password.
  call(method: string, path: string, opts?: {body?: unknown; signal?: AbortSignal}): Promise<Response>;
};

export async function startServer(bin: string, cwd: string, env: NodeJS.ProcessEnv, timeout = 30_000): Promise<OpenCodeServer> {
  const port = await freePort();
  const password = crypto.randomBytes(24).toString('hex');
  const proc = spawn(bin, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd,
    env: {...env, OPENCODE_SERVER_PASSWORD: password},
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: !IS_WIN,
    shell: shellFor(bin),
  });
  let stderr = '';
  let failed: Error | null = null;
  proc.stderr!.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  proc.on('error', (e) => (failed = e));
  proc.on('close', (code) => (failed ??= new Error(`opencode serve terminó (código ${code}): ${stderr.trim().split('\n').pop() ?? ''}`)));
  const url = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const call: OpenCodeServer['call'] = (method, p, {body, signal} = {}) =>
    fetch(url + p, {method, signal, headers: {Authorization: auth, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const end = Date.now() + timeout;
  for (;;) {
    if (failed) throw failed;
    try {
      if ((await call('GET', '/api/agent', {signal: AbortSignal.timeout(2000)})).ok) return {url, password, proc, call};
    } catch {
      /* not listening yet */
    }
    if (Date.now() > end) {
      killServer(proc);
      throw new Error('opencode serve no respondió a tiempo');
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
