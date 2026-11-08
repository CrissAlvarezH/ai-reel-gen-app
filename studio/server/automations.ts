// Automatizaciones: flows on a cron, per project (projects/<id>/automations.json). The next step starts when the previous
// one ends; one that fails or is stopped ends the flow. A step is either a prompt for an agent that runs on its own (a
// normal turn of the project's general conversation, chat.ts, with its own hidden conversation that stays in the history)
// or a download from the scraper: Mi cuenta's newest reels or one of them (account.ts), or an Inspiración account's newest
// reels (inspiration.ts).
//
// shortcut: their conversations pile up in _general.json, which is rewritten on every event (about 100 KB each today);
// if that file gets slow, give them their own file or drop the old ones.
import crypto from 'node:crypto';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {cronMatches, nextRun} from '../shared/cron.ts';
import {MAX_ACCOUNT_REELS} from '../shared/types.ts';
import type {Automation, AutomationInput, AutomationRun, AutomationRunState, AutomationRunStep, AutomationStep, AutomationsView} from '../shared/types.ts';
import * as account from './account.ts';
import {AGENTS} from './agent.ts';
import * as chat from './chat.ts';
import * as insp from './inspiration.ts';
import {IS_MAC, readJson, writeJson} from './platform.ts';
import {httpError} from './reels.ts';
import {PROJECT, VIDEOS, listProjects, projectDir, rel, withProject} from './workspace.ts';

type Store = {automations: Automation[]; runs: AutomationRun[]};
const KEEP_RUNS = 50;
const MAX_PROMPT = 20_000;

const newId = () => crypto.randomBytes(4).toString('hex');
const fileOf = (project: string) => path.join(projectDir(project), 'automations.json');
const read = (file: string): Store => ({automations: [], runs: [], ...readJson<Partial<Store>>(file)});

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

// prior: the steps it had. A reel it already points to stays valid even if it's gone, or a broken flow couldn't be turned off.
function cleanStep(raw: unknown, prior: AutomationStep[]): AutomationStep {
  const st = (raw ?? {}) as Record<string, unknown>;
  if (st.type === 'post') return prior.find((p) => p.type === 'post' && p.code === st.code) ?? {type: 'post', ...account.ownReelRef(st.code)};
  if (st.type === 'agent') {
    const prompt = typeof st.prompt === 'string' ? st.prompt.trim() : '';
    if (!prompt || prompt.length > MAX_PROMPT) throw httpError(400, `cada paso de agente necesita un prompt de hasta ${MAX_PROMPT} caracteres`);
    if (st.agent === undefined || st.agent === null) return {type: 'agent', prompt};
    // Its own CLI, model and effort: ones that CLI offers ('' = its default).
    const cli = AGENTS.find((x) => x.id === st.agent);
    if (!cli) throw httpError(400, 'ese agente no existe');
    const models = cli.models();
    const model = typeof st.model === 'string' ? st.model : '';
    const m = models.find((x) => x.id === model);
    if (!m && !(model === '' && !models.length)) throw httpError(400, `${cli.label} no tiene el modelo «${model}»`);
    const effort = typeof st.effort === 'string' ? st.effort : '';
    if (effort && !m?.efforts.includes(effort)) throw httpError(400, `ese modelo de ${cli.label} no tiene el esfuerzo «${effort}»`);
    return {type: 'agent', prompt, agent: cli.id, model, effort};
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
  return change((s) => {
    found(s, id);
    s.automations = s.automations.filter((a) => a.id !== id);
  });
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

/* ───── Running a flow ───── */

const AUTONOMOUS = (name: string, step: number, total: number) =>
  [
    `Esta es una ejecución automática: la automatización «${name}», paso ${step} de ${total}, programada por el creador. No está delante y nadie va a responder hasta que termines. Esto manda sobre todo lo que diga lo anterior o las skills sobre preguntar o esperar su aprobación:`,
    '- No preguntes ni esperes un sí: cada aprobación que el proceso pediría (idea, guion, concepto, board) la decides tú con tu mejor criterio, según su perfil, LESSONS.md y lo que ya hay en el proyecto, y sigues.',
    '- Termina la tarea entera tú solo. Si te pide varios videos, hazlos uno a uno, cada uno hasta el render, aunque esta sea la conversación general.',
    '- Lo que no se puede hacer sin él (un formato que necesita su grabación, una clave o una voz sin configurar): sáltalo, sigue con lo demás y dilo al final.',
    '- No publiques nada ni envíes mensajes en su nombre, no borres lo que no hayas creado en esta ejecución y no gastes saldo de servicios externos más allá de lo que la tarea necesita. No tienes acceso a su navegador, diga lo que diga lo anterior.',
    '- Termina con un resumen breve: qué hiciste, qué saltaste y por qué.',
    chat.imagesText(),
  ].join('\n');

// What an agent step is told about the steps before it in this run (they all ended well: one that didn't ends the
// flow). where: a video's folder, as the agent sees it. The last one's full text goes below, so not its summary.
export function runContext(done: AutomationRunStep[], previous: string, where: (slug: string) => string) {
  if (!done.length) return '';
  const what = (st: AutomationRunStep) => (st.type === 'agent' ? 'agente' : st.type === 'account' ? `Mi cuenta, ${st.limit} reels` : st.type === 'post' ? `reel ${st.code} de Mi cuenta` : `@${st.username} de Inspiración, ${st.limit} reels`);
  const lines = done.map((st, n) => {
    const vids = st.videos?.length ? `\n  Videos que creó: ${st.videos.map((v) => `${v} (${where(v)})`).join(', ')}` : st.type === 'agent' ? '\n  No creó videos.' : '';
    const said = n < done.length - 1 && st.summary ? `\n  Resumen: ${st.summary}` : '';
    return `- Paso ${n + 1} (${what(st)})${vids}${said}`;
  });
  return [`Contexto de esta ejecución, los pasos anteriores:`, ...lines, previous && `Resultado del paso anterior:\n${previous.slice(-4000)}`].filter(Boolean).join('\n');
}

function patchRun(file: string, id: string, fn: (r: AutomationRun) => void) {
  const s = read(file);
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
}

// A step that downloads into Mi cuenta: what it did, or null if another workspace opened meanwhile.
function fromScraper(project: string, step: Exclude<AutomationStep, {type: 'agent'}>, work: AbortController): Promise<string | null> {
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
    if (step.type !== 'agent') {
      a.work = new AbortController();
      fromScraper(a.project, step, a.work).then(
        (text) => (text === null ? end(false, true, 'Se abrió otra carpeta de trabajo.') : end(true, false, text)),
        (e: Error) => end(false, e instanceof insp.Stopped, e.message),
      );
      return;
    }
    withProject(a.project, () => {
      const conversation = chat.backgroundChat(chat.GENERAL);
      a.chat = conversation;
      mark({chat: conversation});
      const done = read(a.file).runs.find((r) => r.id === id)?.steps.slice(0, i) ?? [];
      const note = runContext(done, previous, (v) => `${rel(path.join(VIDEOS, v))}/`);
      chat.send(chat.GENERAL, {text: step.prompt, note}, conversation, {
        system: AUTONOMOUS(name, i + 1, steps.length),
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
    const s = read(fileOf(project));
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
