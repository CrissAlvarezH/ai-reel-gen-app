// Reel page → Alineación con tu audiencia: how well a video's script (audio/vo.txt) fits the Perfil de audiencia,
// scored by the agent CLI's ask on a fixed rubric. Kept in videos/<slug>/audience-check.json with a hash of the
// script it judged, so the same script is never judged twice and a changed one shows as stale.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {CheckModels, ScriptCheck, ScriptCheckCriterion, ScriptCheckLevel, ScriptCheckState} from '../shared/types.ts';
import {agentCli} from './agent.ts';
import * as audience from './audience.ts';
import {checkModel, setCheckModel} from './config.ts';
import {readJson, writeJson} from './platform.ts';
import {VIDEOS, isPlaceholder} from './reels.ts';

const FILE = (slug: string) => path.join(VIDEOS, slug, 'audience-check.json');
export const scriptOf = (slug: string) => {
  try {
    return fs.readFileSync(path.join(VIDEOS, slug, 'audio/vo.txt'), 'utf8').trim();
  } catch {
    return '';
  }
};
export const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const arr = (v: unknown) => (Array.isArray(v) ? v : []);
export const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// The rubric: what the profile says matters, with its weight. The score is their sum.
export const CRITERIA: {key: string; label: string; max: number; ask: string}[] = [
  {key: 'problem', label: 'Toca un problema o deseo suyo', max: 30, ask: 'Is the whole video about one specific problem or want from my lists (not a generic topic that merely relates)?'},
  {key: 'hook', label: 'El gancho los nombra', max: 20, ask: 'Do the first one or two lines name that problem or want in my audience\'s own words, so the right person stops scrolling?'},
  {key: 'level', label: 'Le habla a su nivel de conciencia', max: 15, ask: 'Does it talk to one awareness level consistently, using what a person at that level thinks (see the levels table)?'},
  {key: 'stakes', label: 'Muestra lo que ganan', max: 15, ask: 'Does it make clear what they get from it, ideally their "so I can…" steps, rather than just facts?'},
  {key: 'words', label: 'Con sus palabras y su realidad', max: 10, ask: 'Are the examples, numbers and words the ones of my audience (who they are, their country, their situation), with no jargon they wouldn\'t use?'},
  {key: 'end', label: 'Un cierre que les sirve', max: 10, ask: 'Does the ending give them a clear next step or takeaway that fits them (and my product, if I have one), without overclaiming?'},
];
const LEVELS: ScriptCheckLevel[] = ['unaware', 'problemAware', 'solutionAware', 'productAware'];

function read(slug: string): ScriptCheck | null {
  const o = obj(readJson(FILE(slug)));
  if (typeof o.script !== 'string' || typeof o.score !== 'number') return null;
  return o as unknown as ScriptCheck;
}

// The model's answer, kept to the rubric: unknown criteria dropped, scores clamped, the total recomputed.
export function clean(raw: unknown, script: string): ScriptCheck {
  const o = obj(raw);
  const given = obj(o.criteria);
  const criteria: ScriptCheckCriterion[] = CRITERIA.map((c) => {
    const g = obj(given[c.key]);
    const n = Number(g.score);
    return {key: c.key, label: c.label, max: c.max, score: Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), c.max)) : 0, note: str(g.note, 300)};
  });
  const level = str(o.level, 20) as ScriptCheckLevel;
  return {
    score: criteria.reduce((t, c) => t + c.score, 0),
    verdict: str(o.verdict, 400),
    problem: str(o.problem, 200),
    level: LEVELS.includes(level) ? level : '',
    criteria,
    good: arr(o.good).map((x) => str(x, 300)).filter(Boolean).slice(0, 3),
    fixes: arr(o.fixes)
      .map((x) => ({line: str(obj(x).line, 300), why: str(obj(x).why, 300), try: str(obj(x).try, 400)}))
      .filter((f) => f.why || f.try)
      .slice(0, 3),
    script: hash(script),
    at: Date.now(),
  };
}

/* ───── The model each review runs on (its badge on the reel page) ───── */

export const CHECKS = ['audience', 'hook'] as const;
export type CheckKind = (typeof CHECKS)[number];
// The agent's models a review can run on. '' is the review's default: for Claude the 'smart' tier (Sonnet), whose
// "Predeterminado" in models() would mean the CLI's own default instead.
export function modelOptions() {
  const models = agentCli.models();
  const sonnet = agentCli.id === 'claude' ? models.find((m) => m.id === 'sonnet') : undefined;
  return models.map((m) => ({id: m.id, label: m.id === '' && sonnet ? `Predeterminado (${sonnet.label})` : m.label}));
}
// The chosen one, if the agent still offers it ('' otherwise: the default).
export function modelFor(check: CheckKind) {
  const id = checkModel(agentCli.id, check);
  return id && agentCli.models().some((m) => m.id === id) ? id : '';
}
export const models = (): CheckModels => ({agent: agentCli.label, options: modelOptions(), chosen: Object.fromEntries(CHECKS.map((c) => [c, modelFor(c)])) as Record<CheckKind, string>});
export function setModel(check: unknown, model: unknown): CheckModels {
  if (!CHECKS.includes(check as CheckKind)) throw Object.assign(new Error('esa revisión no existe'), {status: 404});
  if (typeof model !== 'string' || !modelOptions().some((m) => m.id === model)) throw Object.assign(new Error(`${agentCli.label} no tiene ese modelo`), {status: 400});
  setCheckModel(agentCli.id, check as string, model);
  return models();
}

const running = new Map<string, Promise<void>>();
const errors = new Map<string, string>();

export function state(slug: string): ScriptCheckState {
  const script = scriptOf(slug);
  const check = read(slug);
  return {
    audience: audience.configured(audience.get()),
    script: !!script && !isPlaceholder(slug, script),
    running: running.has(slug),
    stale: !!check && check.script !== hash(script),
    check,
    error: errors.get(slug) ?? '',
  };
}

// Judges the script unless this very script was judged already (force: again anyway). One at a time per video.
export async function run(slug: string, force = false): Promise<ScriptCheckState> {
  const s = state(slug);
  if (!s.audience) throw Object.assign(new Error('primero llena tu Perfil de audiencia'), {status: 400});
  if (!s.script) throw Object.assign(new Error('este video aún no tiene guion'), {status: 400});
  if (!running.has(slug) && (force || !s.check || s.stale)) {
    const script = scriptOf(slug);
    errors.delete(slug);
    running.set(
      slug,
      judge(script)
        .then((c) => writeJson(FILE(slug), c))
        .catch((e: Error) => void errors.set(slug, e.message))
        .finally(() => running.delete(slug)),
    );
  }
  await running.get(slug);
  return state(slug);
}

// For the agent, when he attaches it to a message ("Agregar al chat"): the check as it is, saying if the script changed since.
export function agentText(slug: string): string {
  const s = state(slug);
  const c = s.check;
  if (!c) return '';
  const lines = [
    `Análisis de audiencia del guion (Alineación con tu audiencia, ${path.relative(path.dirname(VIDEOS), FILE(slug))}): ${c.score}/100${s.stale ? '. Ojo: el guion cambió después de este análisis, compáralo con audio/vo.txt' : ''}.`,
    c.verdict && `Veredicto: ${c.verdict}`,
    (c.problem || c.level) && `Le habla a: ${[c.problem && `«${c.problem}»`, c.level].filter(Boolean).join(', ')}`,
    'Criterios:',
    ...c.criteria.map((k) => `- ${k.label}: ${k.score}/${k.max}${k.note ? ` (${k.note})` : ''}`),
    c.fixes.length > 0 && 'Qué cambiar:',
    ...c.fixes.map((f) => `- ${f.line ? `«${f.line}»: ` : ''}${f.why}${f.try ? ` Prueba: ${f.try}` : ''}`),
    c.good.length > 0 && `Lo que ya funciona (no lo pierdas): ${c.good.join('; ')}`,
    'Si cambias el guion, actualiza beats.json y respeta el skill video-script; el estudio vuelve a analizarlo solo.',
  ];
  return lines.filter(Boolean).join('\n');
}

async function judge(script: string): Promise<ScriptCheck> {
  const a = audience.get();
  let model = '';
  const ask = async (prompt: string) =>
    audience.parseJson(await agentCli.ask(prompt, 'You answer only with the JSON asked for, nothing else.', {model: 'smart', effort: 'medium', use: modelFor('audience'), timeout: 4 * 60_000, onModel: (m) => (model = m)}));
  const answer = await ask(`${audience.context(a)}

My audience profile:
- What they want (What they want | So I can… | So I can…):
${audience.table(a) || '(empty)'}
- Their named problems, most important first: ${a.problems.join('; ') || '(empty)'}
- What they think at each awareness level, for the top problems:
${a.levels.map((l) => `  · ${l.problem}: unaware "${l.unaware}" | problem aware "${l.problemAware}" | solution aware "${l.solutionAware}" | product aware "${l.productAware}"`).join('\n') || '  (empty)'}

The narration script of my next short video (one line per beat):
"""
${script}
"""

Judge how well this script fits MY audience profile above, not scripts in general. Be honest and strict: a generic script that any channel could post should score low. Score each criterion from 0 to its max:
${CRITERIA.map((c) => `- ${c.key} (0–${c.max}): ${c.ask}`).join('\n')}

Write everything for me, the creator, in my language, short and plain, no marketing words.

Answer with a JSON object:
{"criteria": {${CRITERIA.map((c) => `"${c.key}": {"score": n, "note": "one short sentence on why"}`).join(', ')}},
 "verdict": "one or two sentences: how well it fits my audience and the single most important change",
 "problem": "the problem or want from my lists it speaks to, exactly as written there, or \\"\\" if none",
 "level": "unaware" | "problemAware" | "solutionAware" | "productAware" | "",
 "good": ["up to 3 things that already work for my audience"],
 "fixes": [{"line": "the script line to change, quoted exactly (or \\"\\" if it's about something missing)", "why": "why it misses my audience", "try": "a rewrite or what to add, in my audience's words"}]}
Give at most 3 fixes, the ones that would raise the score the most.`);
  return {...clean(answer, script), model: [agentCli.label, model].filter(Boolean).join(' · ')};
}
