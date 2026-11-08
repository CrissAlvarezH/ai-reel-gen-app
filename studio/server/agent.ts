// The coding-agent CLI the studio drives. Like Orca or Conductor, it uses the one installed on this
// machine, with its owner's own login and subscription: nothing is bundled and no API key is needed.
// Everything specific to a CLI (how to find it, its arguments, its stream format, its login check)
// lives behind AgentCli, so chat.ts and create.ts don't depend on a CLI's details. Claude Code, Codex or OpenCode,
// chosen in Ajustes → Agente (kept in the app's config.json: it's this machine's, not the workspace's).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile, spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio} from 'node:child_process';
import type {AgentCliStatus, AgentModel, AgentUsage, AgentUsageWindow, ChatCommand, PermissionMode} from '../shared/types.ts';
import {GROUP, IS_MAC, IS_WIN, killTree, needsShell} from './platform.ts';
import {appConfig, setAppConfig, ROOT} from './workspace.ts';
import {killServer, startServer} from './opencode-server.ts';
import type {OpenCodeTurn} from './opencode-turn.ts';

// What a turn's output means, whatever CLI produced it.
export type AgentEvent =
  | {kind: 'session'; id: string; commands?: string[]} // commands: the slash commands this session accepts
  | {kind: 'context'; used?: number | null; window?: number} // used: tokens in context now (null: unknown; missing: unchanged)
  | {kind: 'delta'; text: string} // streaming text of the reply being written
  | {kind: 'text'; text: string} // a finished block of the reply
  | {kind: 'tool'; id: string; name: string; input: Record<string, unknown>}
  | {kind: 'tool_result'; id: string; content: unknown; isError: boolean}
  | {kind: 'permission'; id: string; name: string; input: Record<string, unknown>}
  | {kind: 'permission_cancel'; id: string}
  | {kind: 'result'; ok: boolean; text?: string};

// onModel: told the model that answered (as its CLI names it), when it says.
// use: one of the CLI's models() by id, in place of the tier's ('' or absent: the tier's). effort: its reasoning effort
// (absent: Claude's own default, Codex's by tier; OpenCode has none).
export type AskOptions = {model?: 'fast' | 'smart'; use?: string; effort?: string; images?: string[]; timeout?: number; signal?: AbortSignal; onModel?: (model: string) => void};

// model / effort: '' or missing = the CLI's own default.
// chrome: Ajustes → Agente's switch; only Claude Code has this.
export type TurnOptions = {prompt: string; systemPrompt: string; resume: string | null; cwd: string; env?: Record<string, string>; model?: string; effort?: string; chrome?: boolean; mode?: string};

export interface AgentCli {
  id: string;
  label: string;
  status(force?: boolean): Promise<AgentCliStatus>;
  // One turn of a conversation: a process whose stdout is one JSON event per line (see parse).
  turn(opts: TurnOptions): ChildProcessWithoutNullStreams;
  parse(event: unknown): AgentEvent[];
  // A one-off answer with no tools: by default the CLI's fastest model (e.g. naming a new reel). images:
  // JPEG or PNG files sent with the prompt. timeout in ms. signal stops it (rejects with «detenido»).
  ask(prompt: string, system: string, opts?: AskOptions): Promise<string>;
  // The command that continues a conversation in a terminal.
  resumeCommand(sessionId: string): string;
  // The models it can run a turn with (the first, id '', is the CLI's default) and their reasoning efforts.
  models(): AgentModel[];
  // How a conversation may ask for permission; none: this CLI offers no choice here.
  permissionModes?(): PermissionMode[];
  // Answers a {kind: 'permission'} event of a running turn.
  answerPermission?(proc: ChildProcess, id: string, allow: boolean, input: Record<string, unknown>, message: string): void;
  // The slash commands a turn's prompt may start with (without the slash).
  commands(): ChatCommand[];
  // How full a session's context is, for a CLI that doesn't say it in its stream (read after a turn).
  contextOf?(sessionId: string): {used: number; window: number | null} | null;
  // How much of the plan's limits is used (see agentUsage).
  usage?(): Promise<AgentUsage>;
}

// The efforts, in the menu's language.
export const EFFORT_LABELS: Record<string, string> = {none: 'Ninguno', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', ultra: 'Ultra'};

// A skill's or command's description: the description line of its front matter.
function describe(file: string) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const fm = head.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const d = fm.match(/^description:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    return d.length > 140 ? `${d.slice(0, 140)}…` : d;
  } catch {
    return '';
  }
}
// The skills and commands in these .claude folders: name → description.
function scanCommands(dirs: string[]) {
  const out = new Map<string, string>();
  for (const dir of dirs) {
    const skills = path.join(dir, 'skills');
    const cmds = path.join(dir, 'commands');
    try {
      for (const n of fs.readdirSync(skills)) if (fs.existsSync(path.join(skills, n, 'SKILL.md')) && !out.has(n)) out.set(n, describe(path.join(skills, n, 'SKILL.md')));
    } catch {
      /* none */
    }
    try {
      for (const f of fs.readdirSync(cmds)) if (f.endsWith('.md') && !out.has(f.slice(0, -3))) out.set(f.slice(0, -3), describe(path.join(cmds, f)));
    } catch {
      /* none */
    }
  }
  return out;
}

// Call fn when signal aborts (now, if it already has); returns the unhook.
export function onAbort(signal: AbortSignal | undefined, fn: () => void) {
  if (!signal) return () => {};
  if (signal.aborted) {
    fn();
    return () => {};
  }
  signal.addEventListener('abort', fn, {once: true});
  return () => signal.removeEventListener('abort', fn);
}

const run = (file: string, args: string[], timeout = 10000) => {
  const c = command(file, args);
  return new Promise<string>((resolve, reject) =>
    execFile(c.file, c.args, {timeout, maxBuffer: 1 << 20, shell: c.shell}, (err, stdout) => {
      cleanup(c.temp);
      if (err) reject(err);
      else resolve(stdout);
    }),
  );
};
// Both streams and the exit code, for commands that answer on stderr (codex login status).
const runAll = (file: string, args: string[], timeout = 10000) => {
  const c = command(file, args);
  return new Promise<{code: number; out: string}>((resolve) =>
    execFile(c.file, c.args, {timeout, maxBuffer: 1 << 20, shell: c.shell}, (err, stdout, stderr) => {
      cleanup(c.temp);
      resolve({code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}\n${stderr}`.trim()});
    }),
  );
};

// How to start a CLI found at `file`. On Windows an npm install is a claude.cmd / codex.cmd shim, which Node only runs
// through cmd.exe (and cmd.exe mangles empty, quoted and multi-line arguments): run its JavaScript with this
// same Node instead, found next to it or named inside the shim. Returns the files to delete afterwards.
function command(file: string, args: string[]): {file: string; args: string[]; shell: boolean; temp: string[]} {
  if (!needsShell(file)) return {file, args, shell: false, temp: []};
  const js = shimTarget(file);
  if (js) return {file: process.execPath, args: [js, ...args], shell: false, temp: []};
  // Last resort, through cmd.exe: system prompts go in a file, every other argument in double quotes.
  const temp: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--system-prompt' || args[i] === '--append-system-prompt') && i + 1 < args.length) {
      const f = path.join(os.tmpdir(), `reel-studio-prompt-${process.pid}-${Date.now()}-${i}.txt`);
      fs.writeFileSync(f, args[++i]);
      temp.push(f);
      out.push(`${args[i - 1]}-file`, `"${f}"`);
    } else out.push(`"${args[i].replace(/"/g, '""')}"`);
  }
  return {file: `"${file}"`, args: out, shell: true, temp};
}
// The script a .cmd shim runs: the npm layout next to it, or a .js path written inside it (pnpm, Volta…).
function shimTarget(cmd: string): string | null {
  const dir = path.dirname(cmd);
  for (const js of ['@anthropic-ai/claude-code/cli.js', '@openai/codex/bin/codex.js']) {
    const p = path.join(dir, 'node_modules', js);
    if (fs.existsSync(p)) return p;
  }
  let text = '';
  try {
    text = fs.readFileSync(cmd, 'utf8');
  } catch {
    return null;
  }
  for (const m of text.matchAll(/"([^"]+\.(?:c|m)?js)"/gi)) {
    const p = m[1].replace(/%~?dp0%?\\?/gi, dir + path.sep);
    if (path.isAbsolute(p) && fs.existsSync(p)) return p;
  }
  return null;
}
const cleanup = (files: string[]) => files.forEach((f) => fs.rmSync(f, {force: true}));
const start = (file: string, args: string[], opts: SpawnOptionsWithoutStdio) => {
  const c = command(file, args);
  const p = spawn(c.file, c.args, {...opts, shell: c.shell});
  if (c.temp.length) p.on('close', () => cleanup(c.temp)).on('error', () => cleanup(c.temp));
  return p;
};

// The lines of a CLI's JSON output that parse.
const jsonLines = (out: string) =>
  out.split('\n').flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });

const executable = (p: string) => {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// Find a CLI the way a terminal would. An app opened from the Dock doesn't get the shell's PATH, so
// ask the login shell first (Windows: where), then try the usual install locations.
async function locate(name: string, known: string[]): Promise<string | null> {
  if (IS_WIN) {
    try {
      const hits = (await run('where', [name], 8000)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const hit = hits.find((h) => /\.exe$/i.test(h)) ?? hits.find((h) => /\.(cmd|bat)$/i.test(h));
      if (hit) return hit;
    } catch {
      /* not on PATH */
    }
    return known.find((p) => fs.existsSync(p)) ?? null;
  }
  const shell = process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash');
  try {
    const out = await run(shell, ['-lic', `command -v ${name}`], 8000);
    const hit = out
      .split('\n')
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith('/'));
    if (hit && executable(hit)) return hit;
  } catch {
    /* fall through to the known paths */
  }
  return known.find(executable) ?? null;
}

/* ───── Claude Code ───── */

const HOME = os.homedir();
let claudePath: string | null = null;
let claudeStatus: AgentCliStatus | null = null;

export const claude: AgentCli = {
  id: 'claude',
  label: 'Claude Code',

  async status(force = false) {
    if (claudeStatus && !force) return claudeStatus;
    const s: AgentCliStatus = {id: this.id, label: this.label, installed: false, path: null, version: null, loggedIn: false, account: null, error: null, checkedAt: Date.now()};
    claudePath = await locate(
      'claude',
      IS_WIN
        ? [path.join(HOME, '.local/bin/claude.exe'), path.join(process.env.APPDATA ?? path.join(HOME, 'AppData/Roaming'), 'npm/claude.cmd')]
        : [path.join(HOME, '.claude/local/claude'), path.join(HOME, '.local/bin/claude'), path.join(HOME, '.npm-global/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'],
    );
    if (!claudePath) {
      s.error = 'No encuentro el comando claude. Instala Claude Code: npm install -g @anthropic-ai/claude-code';
      return (claudeStatus = s);
    }
    s.installed = true;
    s.path = claudePath;
    try {
      s.version = (await run(claudePath, ['--version'])).trim().replace(/\s*\(Claude Code\)$/, '');
    } catch {
      /* old or broken install: the auth check below says more */
    }
    try {
      const a = JSON.parse(await run(claudePath, ['auth', 'status'])) as {loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string; authMethod?: string};
      s.loggedIn = !!a.loggedIn;
      s.account = [a.email, a.orgName, a.subscriptionType && `plan ${a.subscriptionType}`].filter(Boolean).join(' · ') || a.authMethod || null;
      if (!s.loggedIn) s.error = 'Claude Code no tiene sesión: abre una terminal, ejecuta claude e inicia sesión.';
    } catch (e) {
      s.error = `No pude comprobar la sesión (claude auth status): ${(e as Error).message.split('\n')[0]}`;
    }
    return (claudeStatus = s);
  },

  permissionModes: () => CLAUDE_MODES,

  turn({prompt, systemPrompt, resume, cwd, env, model, effort, chrome, mode}) {
    const asks = !!mode && mode !== 'bypassPermissions';
    // Said either way: the CLI's own default must not turn it on behind the project's switch.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', asks ? mode : 'bypassPermissions', chrome ? '--chrome' : '--no-chrome', '--append-system-prompt', systemPrompt];
    // To ask, the CLI writes each question to stdout and reads the answer from stdin, which stays open until the turn's result.
    if (asks) args.push('--input-format', 'stream-json', '--permission-prompt-tool', 'stdio');
    if (resume) args.push('--resume', resume);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    const proc = start(claudePath ?? 'claude', args, {cwd, env: {...process.env, ...env}});
    if (asks) {
      proc.stdin.on('error', () => {}); // an answer to a turn that just ended
      proc.stdin.write(`${JSON.stringify({type: 'user', message: {role: 'user', content: prompt}})}\n`);
    } else proc.stdin.end(prompt);
    return proc;
  },

  answerPermission(proc, id, allow, input, message) {
    const response = allow ? {behavior: 'allow', updatedInput: input} : {behavior: 'deny', message};
    proc.stdin?.write(`${JSON.stringify({type: 'control_response', response: {subtype: 'success', request_id: id, response}})}\n`);
  },

  parse(raw) {
    const c = raw as {type?: string; request_id?: string; request?: {subtype?: string; tool_name?: string; input?: Record<string, unknown>}};
    if (c.type === 'control_request' && c.request?.subtype === 'can_use_tool' && c.request_id) return [{kind: 'permission', id: c.request_id, name: c.request.tool_name ?? 'Herramienta', input: c.request.input ?? {}}];
    if (c.type === 'control_cancel_request' && c.request_id) return [{kind: 'permission_cancel', id: c.request_id}];
    // Claude Code's stream-json. Events from inside a subagent (parent_tool_use_id) are left out.
    const e = raw as {
      type?: string;
      subtype?: string;
      session_id?: string;
      parent_tool_use_id?: string | null;
      event?: {type?: string; delta?: {type?: string; text?: string}};
      message?: {
        content?: {type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean}[];
        usage?: {input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number};
      };
      is_error?: boolean;
      result?: string;
      slash_commands?: string[];
      terminal_slash_commands?: string[];
      modelUsage?: Record<string, {contextWindow?: number}>;
    };
    if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
      // The commands this session takes headless (the terminal-only ones left out), kept for the message box.
      const terminal = new Set(e.terminal_slash_commands ?? []);
      const commands = (e.slash_commands ?? []).filter((c) => !terminal.has(c));
      if (commands.length) rememberClaudeCommands(commands);
      return [{kind: 'session', id: e.session_id, commands}];
    }
    if (e.type === 'system' && e.subtype === 'compact_boundary') return [{kind: 'context', used: null}];
    if (e.parent_tool_use_id) return [];
    // Each reply says how much it read: everything in the context so far, plus what it wrote.
    const u = e.type === 'assistant' ? e.message?.usage : undefined;
    const used = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) : 0;
    const ctx: AgentEvent[] = used ? [{kind: 'context', used}] : [];
    if (e.type === 'stream_event') {
      const ev = e.event;
      return ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text ? [{kind: 'delta', text: ev.delta.text}] : [];
    }
    if (e.type === 'result') {
      // The model's window (the largest of those used: a subagent may have run a smaller one).
      const window = Math.max(0, ...Object.values(e.modelUsage ?? {}).map((m) => m.contextWindow ?? 0));
      return [...(window ? [{kind: 'context' as const, window}] : []), {kind: 'result', ok: !e.is_error, text: e.result}];
    }
    const out: AgentEvent[] = [...ctx];
    for (const b of e.message?.content ?? []) {
      if (e.type === 'assistant' && b.type === 'text' && b.text?.trim()) out.push({kind: 'text', text: b.text});
      if (e.type === 'assistant' && b.type === 'tool_use') out.push({kind: 'tool', id: b.id!, name: b.name!, input: b.input ?? {}});
      if (e.type === 'user' && b.type === 'tool_result') out.push({kind: 'tool_result', id: b.tool_use_id!, content: b.content, isError: !!b.is_error});
    }
    return out;
  },

  ask(prompt, system, {model = 'fast', use, effort, images = [], timeout = 30000, signal, onModel} = {}) {
    // No tools, no session saved, run outside the workspace so it doesn't load its CLAUDE.md. The message
    // goes in as stream-json so it can carry images. Haiku ~3 s; Sonnet for analysis.
    const content = [
      ...images.map((f) => ({type: 'image', source: {type: 'base64', media_type: f.endsWith('.png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(f).toString('base64')}})),
      {type: 'text', text: prompt},
    ];
    const alias = use || (model === 'fast' ? 'haiku' : 'sonnet');
    const args = ['-p', '--model', alias, ...(effort ? ['--effort', effort] : []), '--no-session-persistence', '--tools', '', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--system-prompt', system];
    return new Promise((resolve, reject) => {
      const p = start(claudePath ?? 'claude', args, {cwd: os.tmpdir(), detached: GROUP});
      let out = '';
      let err = '';
      const timer = setTimeout(() => killTree(p), timeout);
      const unhook = onAbort(signal, () => killTree(p));
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      p.on('error', reject);
      p.on('close', () => {
        clearTimeout(timer);
        unhook();
        if (signal?.aborted) return reject(new Error('detenido'));
        const r = jsonLines(out).find((e) => e.type === 'result') as {is_error?: boolean; result?: string} | undefined;
        if (!r) return reject(new Error(err.trim().split('\n').pop() || 'respuesta ilegible de claude'));
        if (r.is_error) return reject(new Error(r.result || 'claude devolvió un error'));
        const init = jsonLines(out).find((e) => e.type === 'system' && typeof (e as {model?: unknown}).model === 'string') as {model: string} | undefined;
        onModel?.(init?.model ?? alias);
        resolve(String(r.result ?? ''));
      });
      p.stdin.end(JSON.stringify({type: 'user', message: {role: 'user', content}}) + '\n');
    });
  },

  resumeCommand: (id) => `claude --resume ${id}`,

  // Its own /usage, which answers without calling a model (no tokens); no session is left in the history.
  usage() {
    return new Promise<AgentUsage>((resolve, reject) => {
      const p = start(claudePath ?? 'claude', ['-p', '--output-format', 'json', '--no-session-persistence'], {cwd: os.tmpdir(), detached: GROUP});
      let out = '';
      let err = '';
      const timer = setTimeout(() => killTree(p), 30_000);
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      p.on('error', reject);
      p.on('close', () => {
        clearTimeout(timer);
        const r = jsonLines(out).find((e) => e.type === 'result') as {is_error?: boolean; result?: string} | undefined;
        if (!r || r.is_error) return reject(new Error(r?.result || err.trim().split('\n').pop() || 'respuesta ilegible de claude'));
        const windows = parseClaudeUsage(String(r.result ?? ''));
        resolve({windows, asOf: null, note: windows.length ? null : 'Claude Code no informó límites de plan para esta sesión.'});
      });
      p.stdin.end('/usage');
    });
  },

  // The ids are Claude Code's aliases, which move to newer versions on their own: update the labels when they do.
  models: () => [
    {id: '', label: 'Predeterminado', efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: null},
    {id: 'fable', label: 'Fable 5.1', efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: null},
    {id: 'opus', label: 'Opus 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: null},
    {id: 'sonnet', label: 'Sonnet 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: null},
    {id: 'haiku', label: 'Haiku 5.5', efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: null},
  ],

  commands() {
    // The list the last session gave (skills, plugins, built-ins); before any, the built-ins below and the
    // skills and commands on disk. Descriptions from their SKILL.md / command file.
    const disk = scanCommands([...(ROOT ? [path.join(ROOT, '.claude')] : []), path.join(HOME, '.claude')]);
    const names = appConfig().claudeCommands ?? [...Object.keys(CLAUDE_BUILTINS), ...disk.keys()];
    return names
      .filter((n) => !CLAUDE_HIDDEN.has(n) && !n.startsWith('_'))
      .map((name) => ({name, description: CLAUDE_BUILTINS[name] ?? disk.get(name) ?? disk.get(name.split(':').pop()!) ?? ''}));
  },
};

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Built-ins that work in a headless turn, described in the studio's language.
const CLAUDE_BUILTINS: Record<string, string> = {
  compact: 'Resume la conversación para liberar contexto (puedes decirle qué conservar)',
  context: 'Muestra qué ocupa el contexto de esta conversación',
  cost: 'Lo que ha costado esta sesión',
  usage: 'Uso de tu plan',
  init: 'Crea o actualiza el CLAUDE.md de la carpeta',
  review: 'Revisa los cambios pendientes',
  'security-review': 'Revisión de seguridad de los cambios pendientes',
  recap: 'Resumen de lo hecho en esta conversación',
};
// Ones that only make sense in Claude Code's own terminal, or that the studio does itself (clear, model, effort).
// The first is what every conversation starts on.
const CLAUDE_MODES: PermissionMode[] = [
  {id: 'bypassPermissions', label: 'Permitir todo', description: 'Hace todo sin preguntar.'},
  {id: 'auto', label: 'Automático', description: 'Decide solo y frena lo que considere riesgoso.'},
  {id: 'acceptEdits', label: 'Aceptar ediciones', description: 'Edita archivos sin preguntar; lo demás puede pedirte permiso.'},
  {id: 'manual', label: 'Preguntar cada cambio', description: 'Te pide permiso en el chat antes de cada acción que cambie algo.'},
  {id: 'plan', label: 'Planear primero', description: 'Propone un plan y espera tu aprobación antes de cambiar nada.'},
];

const CLAUDE_HIDDEN = new Set(['clear', 'model', 'effort', 'config', 'agents', 'mcp', 'color', 'focus', 'heapdump', 'doctor', 'fast', 'output-style', 'autocompact', 'auto-mode-setup', 'reload-plugins', 'reload-skills', 'rename', 'import', 'design-consent', 'design-revoke', 'list-agents', 'workflow-launch-exec', 'extra-usage', 'usage-credits']);
// The last session's list of commands, kept so the message box has it before the next turn starts.
function rememberClaudeCommands(names: string[]) {
  const prev = appConfig().claudeCommands;
  if (!prev || prev.join('\n') !== names.join('\n')) setAppConfig({claudeCommands: names});
}

/* ───── Codex ───── */

let codexPath: string | null = null;
let codexStatus: AgentCliStatus | null = null;

// A TOML string for -c key=value (JSON's escapes are all valid TOML ones).
const toml = (v: unknown) => JSON.stringify(v);
// Codex reads AGENTS.md, not CLAUDE.md, and finds skills elsewhere: point it at the workspace's.
const CODEX_NOTE =
  'Las instrucciones de esta carpeta están en CLAUDE.md (léelo si no lo tienes ya). Las skills que se nombran ' +
  '(reel-studio, la del estilo, animated-video, video-script, content-ideas…) son archivos: .claude/skills/<nombre>/SKILL.md, o la ruta ' +
  'que se indique (p. ej. styles/<id>/SKILL.md). Antes de seguir una, lee su SKILL.md y los archivos que cite.';
// "/bin/zsh -lc 'cat a.txt'" → "cat a.txt"
const bareCommand = (c: string) => c.match(/^\S*?(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/)?.[2] ?? c;

type CodexItem = {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: {path: string; kind: string}[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: {message?: string} | string | null;
  query?: string;
};

// The lines of Claude Code's /usage: "Current session: 63% used · resets Nov 3 at 7:20pm (America/Bogota)". It has no
// other form to ask in, so a change in its wording leaves no windows and the page says so.
export function parseClaudeUsage(text: string, now = new Date()): AgentUsageWindow[] {
  const windows: AgentUsageWindow[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*Current ([^:]+):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets\s+(.+))?\s*$/i.exec(line);
    if (!m) continue;
    const week = /^week(?:\s*\((.+)\))?$/i.exec(m[1].trim());
    const label = /^session$/i.test(m[1].trim()) ? 'Sesión actual' : week ? (week[1] && !/^all models$/i.test(week[1]) ? `Semana (${week[1]})` : 'Semana (todos los modelos)') : m[1].trim();
    windows.push({label, percent: Number(m[2]), resetsAt: m[3] ? parseClaudeReset(m[3], now) : null});
  }
  return windows;
}

// "Nov 3 at 7:20pm (America/Bogota)", or only the hour when it's today: the CLI writes this machine's own time zone.
function parseClaudeReset(text: string, now: Date) {
  const m = /^(?:([a-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text.trim());
  if (!m) return null;
  const month = m[1] ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()) : now.getMonth();
  if (month < 0) return null;
  const hour = (Number(m[4]) % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0);
  const at = new Date(m[3] ? Number(m[3]) : now.getFullYear(), month, m[2] ? Number(m[2]) : now.getDate(), hour, Number(m[5] ?? 0));
  // Always ahead: a date in the past is next year's, an hour in the past is tomorrow's.
  if (at.getTime() < now.getTime()) {
    if (m[3]) return null;
    if (m[2]) at.setFullYear(at.getFullYear() + 1);
    else at.setDate(at.getDate() + 1);
  }
  return at.getTime();
}

const codexWindowLabel = (minutes: number) =>
  minutes === 10080 ? 'Semana' : minutes % 1440 === 0 ? (minutes === 1440 ? 'Día' : `${minutes / 1440} días`) : minutes % 60 === 0 ? `${minutes / 60} horas` : `${minutes} min`;

type CodexLimit = {used_percent?: number; window_minutes?: number; resets_at?: number} | null;

// Codex only says its limits while working: each token count in a session's log carries them. The latest of those, from
// the newest logs (~/.codex/sessions/YYYY/MM/DD/rollout-…jsonl). A window that has reset since is back at 0.
export function codexUsageFrom(root: string, now = Date.now()): AgentUsage {
  const newestFirst = (dir: string) => {
    try {
      return fs.readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  const logs: string[] = [];
  for (const y of newestFirst(root))
    for (const m of newestFirst(path.join(root, y)))
      for (const d of newestFirst(path.join(root, y, m))) {
        if (logs.length >= 30) break;
        for (const f of newestFirst(path.join(root, y, m, d))) if (f.endsWith('.jsonl')) logs.push(path.join(root, y, m, d, f));
      }
  const mtime = (f: string) => {
    try {
      return fs.statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  };
  for (const file of logs.map((f) => ({f, t: mtime(f)})).sort((a, b) => b.t - a.t).map((x) => x.f)) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const i = text.lastIndexOf('"rate_limits":{');
    if (i < 0) continue;
    const line = text.slice(text.lastIndexOf('\n', i) + 1, (text.indexOf('\n', i) + 1 || text.length + 1) - 1);
    try {
      const e = JSON.parse(line) as {timestamp?: string; payload?: {rate_limits?: {primary?: CodexLimit; secondary?: CodexLimit}}};
      const limits = e.payload?.rate_limits;
      const windows = [limits?.primary, limits?.secondary].flatMap((l): AgentUsageWindow[] => {
        if (typeof l?.used_percent !== 'number' || typeof l.window_minutes !== 'number') return [];
        const resetsAt = typeof l.resets_at === 'number' ? l.resets_at * 1000 : null;
        const over = resetsAt !== null && resetsAt <= now;
        return [{label: codexWindowLabel(l.window_minutes), percent: over ? 0 : l.used_percent, resetsAt: over ? null : resetsAt}];
      });
      if (windows.length) return {windows, asOf: Date.parse(e.timestamp ?? '') || mtime(file), note: null};
    } catch {
      /* a line it was still writing: the next log */
    }
  }
  return {windows: [], asOf: null, note: 'Todavía no hay datos: Codex anota sus límites cuando trabaja.'};
}

export const codex: AgentCli = {
  id: 'codex',
  label: 'Codex',

  async status(force = false) {
    if (codexStatus && !force) return codexStatus;
    const s: AgentCliStatus = {id: this.id, label: this.label, installed: false, path: null, version: null, loggedIn: false, account: null, error: null, checkedAt: Date.now()};
    codexPath = await locate(
      'codex',
      IS_WIN
        ? [path.join(process.env.APPDATA ?? path.join(HOME, 'AppData/Roaming'), 'npm/codex.cmd')]
        : [path.join(HOME, '.local/bin/codex'), path.join(HOME, '.npm-global/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex', '/usr/bin/codex', '/Applications/Codex.app/Contents/Resources/codex'],
    );
    if (!codexPath) {
      s.error = 'No encuentro el comando codex. Instala Codex: npm install -g @openai/codex';
      return (codexStatus = s);
    }
    s.installed = true;
    s.path = codexPath;
    try {
      s.version = (await run(codexPath, ['--version'])).trim().replace(/^codex(-cli)?\s*/, '');
    } catch {
      /* the login check below says more */
    }
    // Exit 0 and "Logged in using ChatGPT" (or "using an API key - sk-…", never shown) on stderr.
    const a = await runAll(codexPath, ['login', 'status']);
    s.loggedIn = a.code === 0 && /logged in/i.test(a.out);
    if (s.loggedIn) s.account = /chatgpt/i.test(a.out) ? 'cuenta de ChatGPT' : /api key/i.test(a.out) ? 'clave de API de OpenAI' : null;
    else s.error = 'Codex no tiene sesión: abre una terminal, ejecuta codex login e inicia sesión.';
    return (codexStatus = s);
  },

  turn({prompt, systemPrompt, resume, cwd, env, model, effort}) {
    // Full access like Claude Code's bypassPermissions; the workspace needn't be a git repo.
    const args = [
      'exec',
      ...(resume ? ['resume'] : []),
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      ...(model ? ['-m', model] : []),
      ...(effort ? ['-c', `model_reasoning_effort=${toml(effort)}`] : []),
      '-c',
      `developer_instructions=${toml(`${CODEX_NOTE}\n\n${systemPrompt}`)}`,
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      ...(resume ? [resume] : []),
      '-',
    ];
    const proc = start(codexPath ?? 'codex', args, {cwd, env: {...process.env, ...env}});
    proc.stdin.end(prompt);
    return proc;
  },

  parse(raw) {
    // codex exec --json: thread.started, item.started / item.completed, turn.completed / turn.failed.
    // No streaming text: each message arrives whole. A tool may only come as item.completed, so a
    // completed one is sent as the tool and its result (chat.ts ignores a tool id it already has).
    const e = raw as {type?: string; thread_id?: string; item?: CodexItem; error?: {message?: string}};
    if (e.type === 'thread.started' && e.thread_id) return [{kind: 'session', id: e.thread_id}];
    if (e.type === 'turn.completed') return [{kind: 'result', ok: true}];
    if (e.type === 'turn.failed') return [{kind: 'result', ok: false, text: e.error?.message}];
    const it = e.item;
    if (!it || (e.type !== 'item.started' && e.type !== 'item.completed')) return [];
    const done = e.type === 'item.completed';
    const errText = (x: CodexItem['error']) => (typeof x === 'string' ? x : x?.message);
    const tool = (id: string, name: string, input: Record<string, unknown>, content: unknown, isError: boolean): AgentEvent[] => [
      {kind: 'tool', id, name, input},
      ...(done ? [{kind: 'tool_result' as const, id, content, isError}] : []),
    ];
    switch (it.type) {
      case 'agent_message':
        return done && it.text?.trim() ? [{kind: 'text', text: it.text}] : [];
      case 'command_execution':
        return tool(it.id, 'Bash', {command: bareCommand(it.command ?? '')}, it.aggregated_output ?? '', it.exit_code != null && it.exit_code !== 0);
      case 'file_change':
        return (it.changes ?? []).flatMap((c, i) => tool(`${it.id}:${i}`, c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit', {file_path: c.path}, c.kind, it.status === 'failed'));
      case 'mcp_tool_call':
        return tool(it.id, `${it.server}.${it.tool}`, (it.arguments ?? {}) as Record<string, unknown>, errText(it.error) ?? it.result ?? '', !!it.error || it.status === 'failed');
      case 'web_search':
        return tool(it.id, 'WebSearch', {query: it.query}, '', false);
    }
    return []; // reasoning, todo_list, warnings
  },

  ask(prompt, system, {model = 'fast', use, effort, images = [], timeout = 30000, signal, onModel} = {}) {
    // Read-only, no session saved, without the user's config (plugins, hooks), outside the workspace so it
    // doesn't read its instructions. Its default model; less reasoning for the fast answers.
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '-s',
      'read-only',
      ...(use ? ['-m', use] : []),
      '-c',
      `model_reasoning_effort=${toml(effort || (model === 'fast' ? 'low' : 'medium'))}`,
      '-c',
      `developer_instructions=${toml(`${system}\n\nResponde solo con texto: no uses herramientas ni comandos.`)}`,
      ...images.map((f) => `--image=${f}`),
      '-',
    ];
    return new Promise((resolve, reject) => {
      const p = start(codexPath ?? 'codex', args, {cwd: os.tmpdir(), detached: GROUP});
      let out = '';
      let err = '';
      const timer = setTimeout(() => killTree(p), timeout);
      const unhook = onAbort(signal, () => killTree(p));
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      p.on('error', reject);
      p.on('close', () => {
        clearTimeout(timer);
        unhook();
        if (signal?.aborted) return reject(new Error('detenido'));
        const evs = jsonLines(out) as {type?: string; item?: CodexItem; error?: {message?: string}}[];
        const failed = evs.find((e) => e.type === 'turn.failed');
        if (failed) return reject(new Error(failed.error?.message || 'codex devolvió un error'));
        const msgs = evs.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item!.text ?? '');
        if (!evs.some((e) => e.type === 'turn.completed') || !msgs.length) return reject(new Error(err.trim().split('\n').pop() || 'respuesta ilegible de codex'));
        const m = use || codexDefaultModel();
        if (m) onModel?.(m);
        resolve(msgs[msgs.length - 1]);
      });
      p.stdin.end(prompt);
    });
  },

  resumeCommand: (id) => `codex resume ${id}`,

  models() {
    // The models Codex lists in its own picker (its cache in ~/.codex), after its default.
    const list = codexModels();
    const def = list.find((m) => m.id === codexDefaultModel());
    return [{id: '', label: def ? `Predeterminado (${def.label})` : 'Predeterminado', efforts: def?.efforts ?? ['low', 'medium', 'high'], defaultEffort: null, contextWindow: def?.contextWindow ?? null}, ...list];
  },

  // codex exec has no slash commands: only the studio's own.
  commands: () => [],

  usage: async () => codexUsageFrom(path.join(CODEX_HOME, 'sessions')),

  contextOf(sessionId) {
    // The session's rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl): its last token count.
    const file = findRollout(sessionId);
    if (!file) return null;
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const i = text.lastIndexOf('"token_count"');
    if (i < 0) return null;
    const line = text.slice(text.lastIndexOf('\n', i) + 1, (text.indexOf('\n', i) + 1 || text.length + 1) - 1);
    try {
      const info = (JSON.parse(line) as {payload?: {info?: {last_token_usage?: {total_tokens?: number}; model_context_window?: number}}}).payload?.info;
      const used = info?.last_token_usage?.total_tokens;
      return typeof used === 'number' ? {used, window: info?.model_context_window ?? null} : null;
    } catch {
      return null;
    }
  },
};

const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
function codexModels(): AgentModel[] {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, 'models_cache.json'), 'utf8')) as {
      models?: {slug: string; display_name?: string; visibility?: string; supported_reasoning_levels?: {effort: string}[]; default_reasoning_level?: string; context_window?: number}[];
    };
    return (d.models ?? [])
      .filter((m) => m.visibility !== 'hide')
      .map((m) => ({
        id: m.slug,
        label: m.display_name ?? m.slug,
        efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort),
        defaultEffort: m.default_reasoning_level ?? null,
        contextWindow: m.context_window ?? null,
      }));
  } catch {
    return [];
  }
}
const codexDefaultModel = () => {
  try {
    return fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8').match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
};
// The newest days first: a session is usually from today.
function findRollout(id: string) {
  const root = path.join(CODEX_HOME, 'sessions');
  const ls = (d: string) => {
    try {
      return fs.readdirSync(d).sort().reverse();
    } catch {
      return [];
    }
  };
  for (const y of ls(root))
    for (const m of ls(path.join(root, y)))
      for (const d of ls(path.join(root, y, m))) {
        const f = ls(path.join(root, y, m, d)).find((n) => n.endsWith(`${id}.jsonl`));
        if (f) return path.join(root, y, m, d, f);
      }
  return null;
}

/* ───── OpenCode ───── */

let opencodePath: string | null = null;
let opencodeStatus: AgentCliStatus | null = null;
let opencodeModels: AgentModel[] = [];

// What each of its tools is called in the chat, with the fields toolSummary reads.
const OPENCODE_TOOLS: Record<string, string> = {shell: 'Bash', bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', grep: 'Grep', glob: 'Glob', skill: 'Skill', task: 'Task', webfetch: 'WebFetch', websearch: 'WebSearch'};
const opencodeInput = (i: Record<string, unknown>): Record<string, unknown> => ({...i, file_path: i.file_path ?? i.filePath ?? i.path, skill: i.skill ?? i.id ?? i.name});

// The models it can use with tools, from a private server: that list is the only one that gives their efforts and context.
async function listOpenCodeModels(bin: string): Promise<AgentModel[]> {
  const s = await startServer(bin, os.tmpdir(), process.env, 15_000);
  try {
    const r = (await (await s.call('GET', '/api/model', {signal: AbortSignal.timeout(10_000)})).json()) as {
      data?: {id: string; providerID: string; name?: string; capabilities?: {tools?: boolean}; variants?: {id: string}[]; limit?: {context?: number}}[];
    };
    const names = new Set((r.data ?? []).map((m) => m.providerID));
    return (r.data ?? [])
      .filter((m) => m.capabilities?.tools !== false)
      .map((m) => ({
        id: `${m.providerID}/${m.id}`,
        label: `${m.name ?? m.id}${names.size > 1 ? ` · ${m.providerID}` : ''}`,
        efforts: (m.variants ?? []).map((v) => v.id),
        defaultEffort: null,
        contextWindow: m.limit?.context ?? null,
      }));
  } finally {
    killServer(s.proc);
  }
}

export const opencode: AgentCli = {
  id: 'opencode',
  label: 'OpenCode',

  async status(force = false) {
    if (opencodeStatus && !force) return opencodeStatus;
    const s: AgentCliStatus = {id: this.id, label: this.label, installed: false, path: null, version: null, loggedIn: false, account: null, error: null, checkedAt: Date.now()};
    opencodePath = await locate(
      'opencode',
      IS_WIN
        ? [path.join(process.env.APPDATA ?? path.join(HOME, 'AppData/Roaming'), 'npm/opencode.cmd')]
        : [path.join(HOME, '.opencode/bin/opencode'), path.join(HOME, '.local/bin/opencode'), path.join(HOME, '.npm-global/bin/opencode'), '/opt/homebrew/bin/opencode', '/usr/local/bin/opencode', '/usr/bin/opencode'],
    );
    if (!opencodePath) {
      s.error = 'No encuentro el comando opencode. Instala OpenCode: npm install -g opencode-ai';
      return (opencodeStatus = s);
    }
    s.installed = true;
    s.path = opencodePath;
    try {
      s.version = (await run(opencodePath, ['--version'])).trim().replace(/^opencode\s+v?/, '');
    } catch {
      /* the check below says more */
    }
    // Some of its models need no login, so what counts is having one to use. --standalone below: without it, auth list would start its background service.
    try {
      opencodeModels = await listOpenCodeModels(opencodePath);
      s.loggedIn = opencodeModels.length > 0;
      if (!s.loggedIn) s.error = 'OpenCode no tiene modelos disponibles: abre una terminal, ejecuta opencode auth login e inicia sesión.';
      // "OpenCode Console  Personal   stored", never a credential.
      const line = (await run(opencodePath, ['auth', 'list', '--standalone'])).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean);
      if (line) s.account = line.replace(/\s+stored$/, '').replace(/\s{2,}/g, ' · ');
    } catch (e) {
      s.error ??= `No pude comprobar OpenCode: ${(e as Error).message.split('\n')[0]}`;
    }
    return (opencodeStatus = s);
  },

  turn({prompt, systemPrompt, resume, cwd, env, model, effort}) {
    // Its own process (see opencode-turn.ts): a stop and the stream work like any other CLI's.
    const proc = start(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, 'opencode-turn.ts')], {cwd, env: {...process.env, ...env}});
    const t: OpenCodeTurn = {bin: opencodePath ?? 'opencode', prompt, systemPrompt, resume, model, effort};
    // Stopped before it has read all this (the turn plus its system prompt don't fit the pipe's buffer): the write fails, and unhandled it would take the studio down.
    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(t));
    return proc;
  },

  parse(raw) {
    // What opencode-turn.ts passes on: its server's events for this session, plus session and done.
    const e = raw as {type?: string; id?: string; ok?: boolean; text?: string; data?: Record<string, never>};
    const d = (e.data ?? {}) as {
      id?: string;
      name?: string;
      delta?: string;
      text?: string;
      input?: Record<string, unknown>;
      content?: unknown;
      error?: {message?: string};
      tokens?: {input?: number; output?: number; cache?: {read?: number; write?: number}};
    };
    switch (e.type) {
      case 'session':
        return e.id ? [{kind: 'session', id: e.id}] : [];
      case 'session.text.delta':
        return d.delta ? [{kind: 'delta', text: d.delta}] : [];
      case 'session.text.ended':
        return d.text?.trim() ? [{kind: 'text', text: d.text}] : [];
      case 'session.tool.called':
        return d.id ? [{kind: 'tool', id: d.id, name: OPENCODE_TOOLS[d.name ?? ''] ?? d.name ?? 'Herramienta', input: opencodeInput(d.input ?? {})}] : [];
      case 'session.tool.success':
        return d.id ? [{kind: 'tool_result', id: d.id, content: d.content ?? '', isError: false}] : [];
      case 'session.tool.failed':
        return d.id ? [{kind: 'tool_result', id: d.id, content: d.error?.message ?? 'falló', isError: true}] : [];
      case 'session.step.ended': {
        const t = d.tokens;
        const used = t ? (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0) + (t.output ?? 0) : 0;
        return used ? [{kind: 'context', used}] : [];
      }
      case 'done':
        return [{kind: 'result', ok: !!e.ok, text: e.text}];
    }
    return [];
  },

  ask(prompt, system, {use, images = [], timeout = 30000, signal, onModel} = {}) {
    // No write or command tools, outside the workspace so it doesn't read its instructions. Its default model, and the
    // session is deleted afterwards. By name: denying "*" gets refused as a usage limit on its free models.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-studio-ask-'));
    const file = path.join(dir, 'system.md');
    fs.writeFileSync(file, `${system}\n\nResponde solo con texto: no uses herramientas ni comandos.`);
    const deny = Object.fromEntries(['shell', 'bash', 'edit', 'write', 'task', 'webfetch', 'websearch', 'skill'].map((t) => [t, 'deny']));
    const config = {agent: {ask: {mode: 'primary', prompt: `{file:${file}}`, permission: deny}}};
    const args = ['run', '--standalone', '--format', 'json', '--agent', 'ask', ...(use ? ['--model', use] : []), ...images.flatMap((f) => ['-f', f])];
    const bin = opencodePath ?? 'opencode';
    return new Promise((resolve, reject) => {
      const p = start(bin, args, {cwd: dir, env: {...process.env, PWD: dir, OPENCODE_CONFIG_CONTENT: JSON.stringify(config)}, detached: GROUP});
      let out = '';
      let err = '';
      const timer = setTimeout(() => killTree(p), timeout);
      const unhook = onAbort(signal, () => killTree(p));
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      const done = () => {
        clearTimeout(timer);
        unhook();
        fs.rmSync(dir, {recursive: true, force: true});
      };
      p.on('error', (e) => {
        done();
        reject(e);
      });
      p.on('close', () => {
        done();
        if (signal?.aborted) return reject(new Error('detenido'));
        const evs = jsonLines(out) as {type?: string; sessionID?: string; part?: {text?: string}; error?: {message?: string; type?: string}}[];
        const sid = evs.find((e) => e.sessionID)?.sessionID;
        if (sid) void run(bin, ['session', 'delete', sid, '--standalone'], 15_000).catch(() => {});
        const failed = evs.find((e) => e.type === 'error');
        if (failed) return reject(new Error(failed.error?.message || failed.error?.type || 'opencode devolvió un error'));
        const texts = evs.filter((e) => e.type === 'text').map((e) => e.part?.text ?? '');
        if (!texts.length) return reject(new Error(err.trim().split('\n').pop() || 'respuesta ilegible de opencode'));
        if (use) onModel?.(use);
        resolve(texts[texts.length - 1]);
      });
      p.stdin.end(prompt);
    });
  },

  resumeCommand: (id) => `opencode --session ${id}`,

  models() {
    if (!opencodeModels.length && opencodePath) void listOpenCodeModels(opencodePath).then((m) => (opencodeModels = m), () => {});
    return [{id: '', label: 'Predeterminado', efforts: [], defaultEffort: null, contextWindow: null}, ...opencodeModels];
  },

  // A turn is plain text here: only the studio's own commands.
  commands: () => [],

  usage: async () => ({windows: [], asOf: null, note: 'Reel Studio no puede leer los límites de OpenCode.'}),
};

/* ───── The one in use ───── */

export const AGENTS: AgentCli[] = [claude, codex, opencode];

// Ajustes → Agente. Asked again at most once a minute per agent, unless he presses Comprobar.
const usageCache = new Map<string, {at: number; value: Promise<AgentUsage>}>();
export async function agentUsage(id: string, force = false): Promise<AgentUsage> {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent?.usage) throw Object.assign(new Error('agente desconocido'), {status: 404});
  const s = await agent.status();
  if (!s.installed || !s.loggedIn) throw Object.assign(new Error(`${agent.label} no tiene sesión`), {status: 409});
  const hit = usageCache.get(id);
  if (hit && !force && Date.now() - hit.at < 60_000) return hit.value;
  const value = agent.usage();
  usageCache.set(id, {at: Date.now(), value});
  value.catch(() => usageCache.delete(id));
  return value;
}
export const agentById = (id: string | undefined) => AGENTS.find((a) => a.id === id) ?? claude;
export const currentAgent = () => agentById(appConfig().agent);
export function setAgent(id: string) {
  if (!AGENTS.some((a) => a.id === id)) throw Object.assign(new Error('agente desconocido'), {status: 400});
  setAppConfig({agent: id});
}

// Whichever is chosen at the time of each call. A conversation pins the one that started its session
// (chat.ts): use agentById for those.
export const agentCli: AgentCli = {
  get id() {
    return currentAgent().id;
  },
  get label() {
    return currentAgent().label;
  },
  status: (force) => currentAgent().status(force),
  turn: (o) => currentAgent().turn(o),
  parse: (e) => currentAgent().parse(e),
  ask: (p, s, o) => currentAgent().ask(p, s, o),
  resumeCommand: (id) => currentAgent().resumeCommand(id),
  models: () => currentAgent().models(),
  commands: () => currentAgent().commands(),
  contextOf: (id) => currentAgent().contextOf?.(id) ?? null,
};
