// Automatizaciones: flows on a cron, per project (projects/<id>/automations.json). The next step starts when the previous
// one ends; one that fails or is stopped ends the flow. A step is either a prompt for an agent that runs on its own (a
// normal turn of the project's general conversation, chat.ts, with its own hidden conversation that stays in the history)
// or a download from the scraper: Mi cuenta's newest reels or one of them (account.ts), or an Inspiración account's newest
// reels (inspiration.ts).
//
// Memoria: what each automation's agents keep from one run to the next (server/automation-memory.ts). Every agent step
// starts with its brief and is told how to use it (tools/memory.py, with the automation in REEL_STUDIO_AUTOMATION);
// the studio adds a summary of each run when it ends.
//
// shortcut: their conversations pile up in _general.json, which is rewritten on every event (about 100 KB each today);
// if that file gets slow, give them their own file or drop the old ones.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {cronMatches, nextRun} from '../shared/cron.ts';
import {ALL_EXTERNAL, MAX_ACCOUNT_REELS} from '../shared/types.ts';
import type {Automation, AutomationInput, AutomationRun, AutomationRunState, AutomationRunStep, AutomationStep, AutomationsView} from '../shared/types.ts';
import * as account from './account.ts';
import * as memory from './automation-memory.ts';
import {AGENTS, agentCli} from './agent.ts';
import * as chat from './chat.ts';
import * as insp from './inspiration.ts';
import * as sources from './sources.ts';
import {IS_MAC, PY, readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {PROJECT, VIDEOS, listProjects, projectDir, rel, resource, withProject} from './workspace.ts';
import {runsElsewhere} from './cloud.ts';

type Store = {automations: Automation[]; runs: AutomationRun[]};
const KEEP_RUNS = 50;
const MAX_PROMPT = 20_000;

const newId = () => crypto.randomBytes(4).toString('hex');
const fileOf = (project: string) => path.join(projectDir(project), 'automations.json');
// A file that's there but can't be read (edited by hand, cut) stops here, so the next change doesn't write an empty list
// over his automations and their history.
function read(file: string): Store {
  if (!fs.existsSync(file)) return {automations: [], runs: []};
  const s = readJson<Partial<Store>>(file);
  if (!s || typeof s !== 'object' || Array.isArray(s) || (s.automations !== undefined && !Array.isArray(s.automations)) || (s.runs !== undefined && !Array.isArray(s.runs)))
    throw httpError(500, `no se puede leer ${rel(file)}: arréglalo o bórralo`);
  return {automations: [], runs: [], ...s};
}

// The runs going on. file: pinned when it started, since the workspace may change before its last event arrives.
// chat: the conversation of the step going on, if it has one. work: stops a step that processes reels. stopped: asked to stop.
type Active = {automation: string; project: string; file: string; chat: string | null; work?: AbortController; awake: ChildProcess | null; stopped?: boolean};
const active = new Map<string, Active>();

let notify = () => {};

/* ───── The page ───── */

export function view(): AutomationsView {
  const s = read(fileOf(PROJECT));
  const running = new Set([...active.values()].map((a) => a.automation));
  return {
    project: PROJECT,
    elsewhere: runsElsewhere(projectDir(PROJECT)),
    automations: s.automations.map((a) => ({...a, running: running.has(a.id)})),
    // A run still marked running that isn't going on: the studio closed in the middle of it.
    runs: s.runs
      .map((r) => {
        const cut = r.state === 'running' && !active.has(r.id);
        // st.state ?? …: a run from when steps didn't say how they went.
        const steps = r.steps.map((st) => ({...st, state: cut && st.state === 'running' ? ('interrupted' as const) : (st.state ?? (st.chat ? ('done' as const) : ('pending' as const)))}));
        return {...r, state: cut ? ('interrupted' as const) : r.state, steps};
      })
      .reverse(),
  };
}

// An agent step's own CLI, model and effort: ones that CLI offers ('' = its default). None: the one in Ajustes.
function agentChoice(st: Record<string, unknown>): {agent?: string; model?: string; effort?: string} {
  if (st.agent === undefined || st.agent === null) return {};
  const cli = AGENTS.find((x) => x.id === st.agent);
  if (!cli) throw httpError(400, 'ese agente no existe');
  const models = cli.models();
  const model = typeof st.model === 'string' ? st.model : '';
  const m = models.find((x) => x.id === model);
  if (!m && !(model === '' && !models.length)) throw httpError(400, `${cli.label} no tiene el modelo «${model}»`);
  const effort = typeof st.effort === 'string' ? st.effort : '';
  if (effort && !m?.efforts.includes(effort)) throw httpError(400, `ese modelo de ${cli.label} no tiene el esfuerzo «${effort}»`);
  return {agent: cli.id, model, effort};
}

// prior: the steps it had. A reel it already points to stays valid even if it's gone, or a broken flow couldn't be turned off.
function cleanStep(raw: unknown, prior: AutomationStep[]): AutomationStep {
  const st = (raw ?? {}) as Record<string, unknown>;
  if (st.type === 'post') return prior.find((p) => p.type === 'post' && p.code === st.code) ?? {type: 'post', ...account.ownReelRef(st.code)};
  if (st.type === 'agent') {
    const prompt = typeof st.prompt === 'string' ? st.prompt.trim() : '';
    if (!prompt || prompt.length > MAX_PROMPT) throw httpError(400, `cada paso de agente necesita un prompt de hasta ${MAX_PROMPT} caracteres`);
    return {type: 'agent', prompt, ...agentChoice(st)};
  }
  if (st.type === 'sources') {
    // Sources it already had stay, even if they're gone: the run says so, and the switch can still turn it off.
    const had = new Set(prior.flatMap((p) => (p.type === 'sources' ? p.sources : [])));
    const ids = Array.isArray(st.sources) ? [...new Set(st.sources.filter((x): x is string => typeof x === 'string'))] : [];
    const known = new Set(sources.view(PROJECT).sources.map((x) => x.id));
    if (ids.some((id) => !had.has(id) && !known.has(id))) throw httpError(400, 'esa fuente ya no existe: elígela otra vez');
    return {type: 'sources', sources: ids, ...agentChoice(st)};
  }
  if (st.type === 'account') {
    const limit = Number(st.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACCOUNT_REELS) throw httpError(400, `el paso de Mi cuenta descarga de 1 a ${MAX_ACCOUNT_REELS} reels`);
    return {type: 'account', limit};
  }
  if (st.type === 'external') {
    const limit = Number(st.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACCOUNT_REELS) throw httpError(400, `el paso de cuenta externa descarga de 1 a ${MAX_ACCOUNT_REELS} reels`);
    // One it already had stays, even if the account has left Inspiración: the run says so, and the switch can still turn it off.
    if (st.username === ALL_EXTERNAL) return {type: 'external', username: ALL_EXTERNAL, limit};
    if (!prior.some((p) => p.type === 'external' && p.username === st.username) && !insp.isFollowed(st.username)) throw httpError(400, 'elige una cuenta escaneada en Inspiración');
    return {type: 'external', username: st.username as string, limit};
  }
  throw httpError(400, 'ese tipo de paso no existe');
}

function clean(input: unknown, prior: AutomationStep[] = []): AutomationInput {
  const i = (input ?? {}) as Record<string, unknown>;
  const name = typeof i.name === 'string' ? i.name.trim() : '';
  if (!name || name.length > 80) throw httpError(400, 'ponle un nombre de hasta 80 caracteres');
  const cron = typeof i.cron === 'string' ? i.cron.trim().replace(/\s+/g, ' ') : '';
  if (!nextRun(cron)) throw httpError(400, 'esa expresión cron no es válida o nunca ocurre');
  if (!Array.isArray(i.steps) || !i.steps.length) throw httpError(400, 'añade al menos un paso');
  return {name, cron, enabled: i.enabled !== false, steps: i.steps.map((st) => cleanStep(st, prior))};
}

function change(fn: (s: Store) => void) {
  const file = fileOf(PROJECT);
  const s = read(file);
  fn(s);
  writeJson(file, s);
  notify();
  return view();
}
const found = (s: Store, id: string) => {
  const a = s.automations.find((x) => x.id === id);
  if (!a) throw httpError(404, 'esa automatización no existe');
  return a;
};
const isRunning = (id: string) => [...active.values()].some((a) => a.automation === id);

export const add = (input: unknown) => {
  const fields = clean(input);
  return change((s) => void s.automations.push({id: newId(), created: Date.now(), ...fields}));
};
// A run going on keeps the steps it started with.
export const edit = (id: string, input: unknown) => {
  const fields = clean(input, found(read(fileOf(PROJECT)), id).steps);
  return change((s) => void Object.assign(found(s, id), fields));
};
export const remove = (id: string) => {
  if (isRunning(id)) throw httpError(409, 'está en marcha: detenla antes de borrarla');
  const v = change((s) => {
    found(s, id);
    s.automations = s.automations.filter((a) => a.id !== id);
  });
  memory.clear(PROJECT, id);
  return v;
};
export function runNow(id: string) {
  const a = found(read(fileOf(PROJECT)), id);
  if (isRunning(id)) throw httpError(409, 'ya está en marcha');
  start(PROJECT, a, 'manual');
  return view();
}
// An agent stops now. A download already paid for finishes first (it can't be cut short), and no other step follows.
export function stop(run: string) {
  const a = active.get(run);
  if (!a) throw httpError(409, 'ya no está en marcha');
  a.stopped = true;
  a.work?.abort();
  if (a.chat) chat.stop(chat.GENERAL, a.chat);
  else patchRun(a.file, run, (r) => void (r.stopping = true));
  return view();
}
// Any run going on in a project, whatever step it's in (its project can't be deleted under it).
export const runningIn = (project: string) => [...active.values()].some((a) => a.project === project);

/* ───── Memoria ───── */

// The page works on the open project; tools/memory.py names its agent's (an automation runs in its own project).
function memoryOf(id: string, project = PROJECT) {
  if (!listProjects().some((p) => p.id === project)) throw httpError(404, 'proyecto no encontrado');
  found(read(fileOf(project)), id);
  return project;
}
// Who writes: tools/memory.py says it's the agent; the page is him. An agent's entry remembers its run.
const writer = (body: unknown) => ((body as {by?: unknown} | null)?.by === 'agent' ? ('agent' as const) : ('creator' as const));
const runOf = (id: string) => [...active.entries()].find(([, a]) => a.automation === id)?.[0];
const memoryChange = <T,>(fn: () => T) => {
  const r = fn();
  notify();
  return r;
};

export const memoryView = (id: string, project?: string) => memory.view(memoryOf(id, project), id);
export const memoryBrief = (id: string, project?: string) => ({text: memory.brief(memoryOf(id, project), id, MEMORY_TOOL())});
export const memorySearch = (id: string, q: memory.SearchQuery, project?: string) => ({entries: memory.search(memoryOf(id, project), id, q)});
export const memoryCheck = (id: string, key: string, project?: string) => ({entry: memory.check(memoryOf(id, project), id, key)});
export const memoryAdd = (id: string, body: unknown, project?: string) => {
  const p = memoryOf(id, project);
  const by = writer(body);
  return memoryChange(() => memory.add(p, id, (body ?? {}) as Record<string, unknown>, by, by === 'agent' ? runOf(id) : undefined));
};
export const memoryEdit = (id: string, entry: string, body: unknown, project?: string) => {
  const p = memoryOf(id, project);
  return memoryChange(() => ({entry: memory.edit(p, id, entry, (body ?? {}) as Record<string, unknown>, writer(body))}));
};
export const memoryRemove = (id: string, entry: string, project?: string) => {
  const p = memoryOf(id, project);
  return memoryChange(() => (memory.remove(p, id, entry), {ok: true}));
};
export const memoryClear = (id: string) => {
  const p = memoryOf(id);
  return memoryChange(() => (memory.clear(p, id), {ok: true}));
};

// How an agent runs tools/memory.py: the app's own copy, like sources.py.
export const MEMORY_TOOL = () => `${PY} "${resource('tools/memory.py')}"`;

// How an agent step is told to use it (system prompt). Its brief goes with the message.
export const MEMORY_RULES = (tool: string) =>
  [
    'Esta automatización tiene memoria: lo que sus agentes guardan de una ejecución a la siguiente (el de la próxima corrida serás tú mismo, sin recordar nada de esta). Va por entradas, cada una con su id, y la maneja la herramienta de abajo (ya sabe de qué automatización es); el creador la ve y la edita en Automatizaciones → Memoria. Con tu mensaje va un resumen: las notas, los pendientes, lo fijado y las últimas ejecuciones. Lo ya hecho no va entero: se consulta.',
    'Tipos de entrada:',
    '- note: reglas y aprendizajes que valen para todas las corridas. Las del creador son instrucciones suyas: síguelas y no las borres.',
    '- pending: por dónde seguir. Ciérralo (close) cuando quede resuelto.',
    '- done: algo ya hecho que no hay que repetir, con una clave estable y corta (--key: el slug de un video, el tema en pocas palabras, una URL, una cuenta). Una entrada por clave: añadir otra con la misma la actualiza.',
    '- run: el studio anota solo un resumen de cada ejecución al terminar. No las escribas tú.',
    'Cómo usarla:',
    '- Al empezar, lee el resumen y síguelo: retoma los pendientes, respeta las notas y no repitas lo hecho.',
    '- Antes de hacer algo que podría estar repetido (un tema, un video, una fuente, una cuenta), compruébalo con check <clave> o search <palabras>.',
    '- Escribe en cuanto avances, no al final: un done por cada cosa terminada, un pending por lo que quede a medias. Si la ejecución se corta, lo anotado queda.',
    '- Antes de terminar, cierra los pendientes resueltos y deja una note solo si aprendiste algo que sirva siempre. Corrige (edit) o borra (rm) las notas que ya no apliquen en vez de acumular contradicciones.',
    '- Entradas cortas y concretas, una cosa por entrada. Lo que ya está en el índice de la app (videos, Mi cuenta, Inspiración) se consulta allí; no lo copies aquí. Sin claves ni datos sensibles.',
    `Herramienta (${tool}):`,
    `- ${tool} show: el resumen, otra vez`,
    `- ${tool} check <clave>: si ya está hecho`,
    `- ${tool} search [palabras] [--kind note|pending|done|run] [--limit N]: busca en toda la memoria, también lo ya resuelto`,
    `- ${tool} add note|pending|done "texto" [--key <clave>] [--pin]: --key y --pin solo para done; --pin lo deja siempre a la vista en el resumen`,
    `- ${tool} edit <id> [--text "…"] [--key <clave>] [--kind note|pending|done] [--pin | --unpin]`,
    `- ${tool} close <id>: un pendiente resuelto (reopen <id> lo abre otra vez)`,
    `- ${tool} rm <id>`,
  ].join('\n');

// A run's summary for its memory, from how each step went.
export function runSummary(r: AutomationRun) {
  const how = r.state === 'done' ? 'terminó bien' : r.state === 'stopped' ? 'se detuvo' : r.state === 'error' ? 'falló' : 'se interrumpió';
  const steps = r.steps
    .filter((st) => st.state !== 'pending')
    .map((st, i) => {
      const videos = st.videos?.length ? ` Videos creados: ${st.videos.join(', ')}.` : '';
      return `Paso ${i + 1} (${st.type === 'agent' ? 'agente' : st.type === 'sources' ? 'fuentes' : st.type === 'account' ? 'Mi cuenta' : st.type === 'post' ? 'un post' : 'cuenta externa'}): ${(st.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) || 'sin resumen'}${videos}`;
    });
  return [`${r.trigger === 'manual' ? 'A mano' : 'Programada'}, ${how}${r.error ? ` (${r.error.slice(0, 200)})` : ''}.`, ...steps].join('\n');
}

/* ───── Running a flow ───── */

const AUTONOMOUS = (name: string, step: number, total: number, memory: string) =>
  [
    `Esta es una ejecución automática: la automatización «${name}», paso ${step} de ${total}, programada por el creador. No está delante y nadie va a responder hasta que termines. Esto manda sobre todo lo que diga lo anterior o las skills sobre preguntar o esperar su aprobación:`,
    '- No preguntes ni esperes un sí: cada aprobación que el proceso pediría (idea, guion, concepto, board) la decides tú con tu mejor criterio, según su perfil, LESSONS.md y lo que ya hay en el proyecto, y sigues.',
    '- Termina la tarea entera tú solo. Si te pide varios videos, hazlos uno a uno, cada uno hasta el render, aunque esta sea la conversación general.',
    '- Lo que no se puede hacer sin él (un formato que necesita su grabación, una clave o una voz sin configurar): sáltalo, sigue con lo demás y dilo al final.',
    '- No publiques nada ni envíes mensajes en su nombre, no borres lo que no hayas creado en esta ejecución y no gastes saldo de servicios externos más allá de lo que la tarea necesita. No tienes acceso a su navegador, diga lo que diga lo anterior.',
    '- Termina con un resumen breve: qué hiciste, qué saltaste y por qué.',
    chat.imagesText(),
    '',
    MEMORY_RULES(memory),
  ].join('\n');

// What an agent step is told about the steps before it in this run (they all ended well: one that didn't ends the
// flow). where: a video's folder, as the agent sees it. The last one's full text goes below, so not its summary.
export function runContext(done: AutomationRunStep[], previous: string, where: (slug: string) => string) {
  if (!done.length) return '';
  const what = (st: AutomationRunStep) => (st.type === 'agent' ? 'agente' : st.type === 'sources' ? `extraer fuentes de información${st.sources.length ? ` (${st.sources.length})` : ' (todas las activas)'}` : st.type === 'account' ? `Mi cuenta, ${st.limit} reels` : st.type === 'post' ? `reel ${st.code} de Mi cuenta` : st.username === ALL_EXTERNAL ? `todas las cuentas de Inspiración, ${st.limit} reels de cada una` : `@${st.username} de Inspiración, ${st.limit} reels`);
  const lines = done.map((st, n) => {
    const vids = st.videos?.length ? `\n  Videos que creó: ${st.videos.map((v) => `${v} (${where(v)})`).join(', ')}` : st.type === 'agent' || st.type === 'sources' ? '\n  No creó videos.' : '';
    const said = n < done.length - 1 && st.summary ? `\n  Resumen: ${st.summary}` : '';
    return `- Paso ${n + 1} (${what(st)})${vids}${said}`;
  });
  return [`Contexto de esta ejecución, los pasos anteriores:`, ...lines, previous && `Resultado del paso anterior:\n${previous.slice(-4000)}`].filter(Boolean).join('\n');
}

function patchRun(file: string, id: string, fn: (r: AutomationRun) => void) {
  let s: Store;
  try {
    s = read(file);
  } catch (e) {
    return console.error('[automatización] no se pudo anotar la ejecución:', (e as Error).message);
  }
  const r = s.runs.find((x) => x.id === id);
  if (!r) return;
  fn(r);
  writeJson(file, s);
  notify();
}

function finish(id: string, state: AutomationRunState, error?: string) {
  const a = active.get(id);
  if (!a) return;
  active.delete(id);
  a.awake?.kill();
  patchRun(a.file, id, (r) => {
    r.state = state;
    r.ended = Date.now();
    if (error) r.error = error;
  });
  // Its summary in the automation's memory, for the next runs. A run of one deleted meanwhile has nowhere to go.
  try {
    const s = read(a.file);
    const r = s.runs.find((x) => x.id === id);
    if (r && s.automations.some((x) => x.id === a.automation)) memory.logRun(a.project, a.automation, id, runSummary(r));
  } catch (e) {
    console.error('[automatización] no se pudo anotar la ejecución en su memoria:', e);
  }
}

// A step that downloads into Mi cuenta: what it did, or null if another workspace opened meanwhile.
function fromScraper(project: string, step: Exclude<AutomationStep, {type: 'agent' | 'sources'}>, work: AbortController): Promise<string | null> {
  if (step.type === 'external' && step.username === ALL_EXTERNAL) return refreshAllExternal(project, step.limit, work);
  if (step.type === 'external')
    return insp.refreshProjectAccount(project, step.username, step.limit, work).then(
      (r) => r && `@${step.username} actualizada en Inspiración: ${r.reels} reels con sus números (${r.fresh} nuevos, sin analizar)${r.profile ? ', y su perfil' : '; su perfil no se pudo actualizar y conserva los datos anteriores'}.${r.problem ? ` Aviso: ${r.problem}.` : ''}`,
    );
  if (step.type === 'post')
    return account.refreshProjectReel(project, step.code).then((m) => m && `Reel ${step.code} actualizado: ${m.views ?? '?'} vistas, ${m.likes ?? '?'} me gusta y ${m.comments ?? '?'} comentarios.`);
  return account.refreshProject(project, step.limit).then((r) => {
    if (!r) return null;
    if (!r.reels) throw new Error(r.problem ?? 'no llegó ningún reel');
    return `Mi cuenta actualizada: ${r.reels} reels de @${r.username}${r.profile ? ' y su perfil' : '; su perfil no se pudo actualizar y conserva los datos anteriores'}.${r.problem ? ` Aviso: ${r.problem}.` : ''}`;
  });
}

// "Actualizar cuenta externa" with Todas: every scanned account of the project, one after another, only their numbers.
// One that fails (private, renamed…) doesn't stop the rest; the step fails only if none could be updated.
export async function refreshAllExternal(project: string, limit: number, work: AbortController): Promise<string | null> {
  const users = insp.followedIn(project);
  if (!users.length) throw new Error('Inspiración no tiene cuentas escaneadas');
  const ok: string[] = [];
  const failed: string[] = [];
  let fresh = 0;
  for (const u of users) {
    if (work.signal.aborted) throw new insp.Stopped('detenido');
    try {
      const r = await insp.refreshProjectAccount(project, u, limit, work);
      if (r === null) return null;
      fresh += r.fresh;
      ok.push(`@${u} (${r.reels} reels${r.fresh ? `, ${r.fresh} nuevos` : ''}${r.problem ? `; aviso: ${r.problem}` : ''})`);
    } catch (e) {
      if (e instanceof insp.Stopped) throw e;
      failed.push(`@${u}: ${(e as Error).message}`);
    }
  }
  if (!ok.length) throw new Error(`no se pudo actualizar ninguna cuenta. ${failed.join(' · ')}`);
  return `Inspiración actualizada: ${ok.length} de ${users.length} cuentas con sus números y su perfil, ${fresh} reels nuevos sin analizar. ${ok.join(', ')}.${failed.length ? ` Fallaron: ${failed.join(' · ')}.` : ''}`;
}

function runStep(id: string, name: string, steps: AutomationStep[], i: number, previous: string) {
  const a = active.get(id)!;
  const step = steps[i];
  const mark = (fields: Partial<AutomationRunStep>) => patchRun(a.file, id, (r) => void Object.assign(r.steps[i], fields));
  const end = (ok: boolean, stopped: boolean, text: string) => {
    a.chat = null;
    a.work = undefined;
    mark({state: ok ? 'done' : stopped ? 'stopped' : 'error', summary: text.slice(0, 600)});
    if (ok && a.stopped) return finish(id, 'stopped');
    if (ok && i + 1 < steps.length) return runStep(id, name, steps, i + 1, text);
    if (ok) return finish(id, 'done');
    if (stopped) return finish(id, 'stopped');
    finish(id, 'error', `Falló el paso ${i + 1}${text ? `: ${text}` : ''}`);
  };
  mark({state: 'running'});
  try {
    if (step.type !== 'agent' && step.type !== 'sources') {
      a.work = new AbortController();
      fromScraper(a.project, step, a.work).then(
        (text) => (text === null ? end(false, true, 'Se abrió otra carpeta de trabajo.') : end(true, false, text)),
        (e: Error) => end(false, e instanceof insp.Stopped, e.message),
      );
      return;
    }
    withProject(a.project, () => {
      // A sources step: the same request as the page's "Extraer", for an agent nobody is watching.
      const ask = step.type === 'sources' ? sources.extractRequest(a.project, step.sources, chat.SOURCES_TOOL(), true) : {text: step.prompt, note: ''};
      const conversation = chat.backgroundChat(chat.GENERAL);
      a.chat = conversation;
      mark({chat: conversation});
      const done = read(a.file).runs.find((r) => r.id === id)?.steps.slice(0, i) ?? [];
      const note = runContext(done, previous, (v) => `${rel(path.join(VIDEOS, v))}/`);
      const tool = MEMORY_TOOL();
      const brief = `Memoria de esta automatización, el resumen de ahora:\n<memoria>\n${memory.brief(a.project, a.automation, tool)}\n</memoria>`;
      chat.send(chat.GENERAL, {text: ask.text, note: [ask.note, brief, note].filter(Boolean).join('\n\n')}, conversation, {
        system: AUTONOMOUS(name, i + 1, steps.length, tool),
        env: {REEL_STUDIO_AUTOMATION: a.automation},
        ...(step.agent ? {agent: step.agent, model: step.model, effort: step.effort} : {}),
        // Its conversation says why it failed; the run only points there.
        onDone: ({ok, stopped, text, video, created}) => {
          mark({...(video ? {video} : {}), ...(created.length ? {videos: created} : {})});
          end(ok, stopped, ok || stopped ? text : 'abre su conversación para ver qué pasó.');
        },
      });
    });
  } catch (e) {
    end(false, false, (e as Error).message);
  }
}

function start(project: string, a: Automation, trigger: AutomationRun['trigger']) {
  const file = fileOf(project);
  const id = newId();
  const s = read(file);
  s.runs = [...s.runs, {id, automation: a.id, name: a.name, trigger, started: Date.now(), ended: null, state: 'running' as const, steps: a.steps.map((st) => ({...st, state: 'pending' as const, chat: null}))}].slice(-KEEP_RUNS);
  writeJson(file, s);
  // Nobody is there to wake the Mac, and a flow can take hours. With -w it ends with this server if that goes first.
  const awake = IS_MAC ? spawn('caffeinate', ['-i', '-w', String(process.pid)], {stdio: 'ignore'}).on('error', () => {}) : null;
  active.set(id, {automation: a.id, project, file, chat: null, awake});
  notify();
  runStep(id, a.name, a.steps, 0, '');
}

/* ───── The clock ───── */

// shortcut: a time when the studio is closed or the Mac asleep is lost, not made up later; add a catch-up on start if that hurts.
let lastMinute = 0;
function tick(now = new Date()) {
  const minute = Math.floor(now.getTime() / 60_000);
  if (minute === lastMinute) return;
  lastMinute = minute;
  for (const {id: project} of listProjects()) {
    if (runsElsewhere(projectDir(project))) continue; // another computer has this one, or it would all spend twice
    let s: Store;
    try {
      s = read(fileOf(project));
    } catch (e) {
      if (minute % 60 === 0) console.error(`[automatización] ${project}:`, (e as Error).message);
      continue; // the others still run
    }
    for (const a of s.automations) {
      if (!a.enabled || !cronMatches(a.cron, now) || isRunning(a.id)) continue;
      // Restarted within the same minute: it already fired.
      if (s.runs.some((r) => r.automation === a.id && r.trigger === 'cron' && Math.floor(r.started / 60_000) === minute)) continue;
      try {
        start(project, a, 'cron');
      } catch (e) {
        console.error(`[automatización] ${a.name}:`, e);
      }
    }
  }
}

export function startScheduler(onChange: () => void) {
  notify = onChange;
  setInterval(tick, 15_000);
}

// "IA" in the form's schedule: when he says it in words, as a cron in this computer's local time, with a line on what
// it does (and what had to be approximated). The studio checks it with the parser that runs it.
export async function cronFromText(input: unknown) {
  const raw = (input as {text?: unknown} | null)?.text;
  const text = typeof raw === 'string' ? raw.trim().slice(0, 300) : '';
  if (!text) throw httpError(400, 'escribe cuándo quieres que se ejecute');
  const prompt = `Turn this schedule into a standard 5-field cron expression (minute hour day-of-month month day-of-week, 0 = Sunday), in this computer's local time. Now it is ${new Date().toString()}.
Schedule: «${text}»
Answer only with JSON: {"cron": "…", "note": "what it does, in one short sentence in Spanish (only if cron can't do it exactly, also what you approximated)"}. If it isn't a schedule: {"cron": "", "note": "why, in Spanish"}.`;
  const reply = await agentCli.ask(prompt, 'You answer only with the JSON asked for, nothing else.', {timeout: 90_000});
  let o: {cron?: unknown; note?: unknown} = {};
  try {
    o = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  } catch {
    /* not JSON: nothing to use */
  }
  const cron = typeof o.cron === 'string' ? o.cron.trim().replace(/\s+/g, ' ') : '';
  const note = typeof o.note === 'string' ? o.note.trim().slice(0, 300) : '';
  if (!cron || !nextRun(cron)) throw httpError(422, note || 'no pude convertirlo en un horario: dilo de otra forma');
  return {cron, note};
}
