// One turn of an OpenCode conversation, as a process of its own so chat.ts treats it like any other CLI: reads the turn
// as JSON on stdin, writes one JSON event per line, and SIGINT stops it. `opencode run --format json` alone only
// says what a tool did once it's over and gives text in whole blocks, while its server's event stream says it
// live. So: a private server for this turn (its config carries this turn's system prompt), its events, and `opencode
// run` against it to send the message. agent.ts reads the lines (opencode.parse).
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {killServer, shellFor, startServer, type OpenCodeServer} from './opencode-server.ts';

export type OpenCodeTurn = {bin: string; prompt: string; systemPrompt: string; resume: string | null; model?: string; effort?: string};
type Ev = {type?: string; data?: Record<string, unknown>};

const out = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`);
const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-opencode-'));
let server: OpenCodeServer | null = null;
let run: ChildProcess | null = null;
let root: string | null = null;
let closing = false;

function finish(code: number) {
  fs.rmSync(tmp, {recursive: true, force: true});
  if (run) run.kill('SIGKILL');
  if (server) killServer(server.proc);
  process.exit(code);
}
// Killing `opencode run` leaves its tools running in the server, so stop them there first.
async function stop() {
  if (closing) return;
  closing = true;
  if (server && root) await server.call('POST', `/api/session/${root}/interrupt`, {body: {}, signal: AbortSignal.timeout(2000)}).catch(() => {});
  finish(130);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// The studio gone without a word (killed, crashed): nobody's left to read this turn.
const parent = process.ppid;
if (process.platform !== 'win32') setInterval(() => process.ppid !== parent && void stop(), 2000);

const readAll = async () => {
  let s = '';
  for await (const d of process.stdin) s += d;
  return s;
};

async function main() {
  const t = JSON.parse(await readAll()) as OpenCodeTurn;
  const system = path.join(tmp, 'system.md');
  fs.writeFileSync(system, t.systemPrompt);
  // Its CLAUDE.md fallback isn't reliable (it didn't load outside a git repo); permission: nobody is there to answer a
  // question, and Claude Code and Codex run with full access too.
  const claudeMd = path.join(cwd, 'CLAUDE.md');
  const config = {permission: 'allow', instructions: [...(fs.existsSync(claudeMd) ? [claudeMd] : []), system]};
  server = await startServer(t.bin, cwd, {...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config)});

  // Subscribed before the message goes in, so nothing is missed.
  const stream = new AbortController();
  const res = await server.call('GET', '/api/event', {signal: stream.signal});
  let settled: () => void = () => {};
  const over = new Promise<void>((r) => (settled = r));
  const names = new Map<string, string>();
  if (t.resume) {
    root = t.resume;
    out({type: 'session', id: root});
  }
  const onEvent = ({type, data}: Ev) => {
    if (!type || !data) return;
    if (type === 'session.created' && !root && !data.parentID && typeof data.sessionID === 'string') {
      root = data.sessionID;
      out({type: 'session', id: root});
    }
    // A subagent's work is its own session: only what this conversation does.
    if (!type.startsWith('session.') || data.sessionID !== root) return;
    if (type === 'session.tool.input.started') names.set(String(data.id), String(data.name));
    if (type === 'session.tool.called') data.name = names.get(String(data.id));
    if (type === 'session.execution.succeeded' || type === 'session.execution.failed' || type === 'session.execution.interrupted') settled();
    out({type, data});
  };
  const reading = (async () => {
    let buf = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += Buffer.from(chunk).toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5)) as Ev);
        } catch {
          /* not an event */
        }
      }
    }
  })().catch(() => {});

  const m = t.model ? [`${t.model}${t.effort ? `#${t.effort}` : ''}`] : [];
  // PWD: `opencode run` tells the server to work in that folder, whatever its real one (the studio's, here).
  run = spawn(t.bin, ['run', '--server', server.url, '--format', 'json', '--auto', ...(m.length ? ['-m', m[0]] : []), ...(t.resume ? ['-s', t.resume] : [])], {
    cwd,
    env: {...process.env, PWD: cwd, OPENCODE_PASSWORD: server.password},
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: shellFor(t.bin),
  });
  let error: string | undefined;
  let buf = '';
  run.stdout!.on('data', (d) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const e = JSON.parse(line) as {type?: string; error?: {message?: string; type?: string}};
        if (e.type === 'error') error = e.error?.message || e.error?.type || 'error de OpenCode';
      } catch {
        /* not an event */
      }
    }
  });
  run.stderr!.on('data', (d) => process.stderr.write(d));
  run.stdin!.end(t.prompt);
  const code = await new Promise<number>((resolve) => {
    run!.on('error', (e) => {
      error = e.message;
      resolve(1);
    });
    run!.on('close', (c) => resolve(c ?? 1));
  });
  if (closing) return;
  // The last events can still be on their way when `run` ends.
  await Promise.race([over, new Promise((r) => setTimeout(r, 1500))]);
  stream.abort();
  await reading;
  const ok = code === 0 && !error;
  out({type: 'done', ok, text: error ?? (ok ? undefined : `opencode run terminó con código ${code}`)});
  finish(ok ? 0 : 1);
}

main().catch((e: Error) => {
  if (closing) return;
  out({type: 'done', ok: false, text: e.message});
  finish(1);
});
