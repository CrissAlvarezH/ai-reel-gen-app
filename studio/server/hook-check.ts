// Reel page → Fuerza del gancho: how strong a video's opening is (the first 3–10 s of audio/vo.txt), scored by the
// agent CLI's ask on a fixed rubric. Works like the audience check next to it (script-check.ts): kept in
// videos/<slug>/hook-check.json with a hash of the script it judged, so the same script is never judged twice and a
// changed one shows as stale. The Perfil de audiencia sharpens it when there is one; it isn't needed.
// The rubric comes from video-script's hook rules plus Jun Yuh, "Why Your Content Dies After 1.7 Seconds" (YouTube).
import path from 'node:path';
import type {HookCheck, HookCheckState, ScriptCheckCriterion} from '../shared/types.ts';
import {agentCli} from './agent.ts';
import * as audience from './audience.ts';
import {readJson, writeJson} from './platform.ts';
import {VIDEOS, isPlaceholder} from './reels.ts';
import {arr, hash, modelFor, obj, scriptOf, str} from './script-check.ts';

const FILE = (slug: string) => path.join(VIDEOS, slug, 'hook-check.json');

// The rubric, with its weight. The score is their sum. Whether it works without sound needs the on-screen text,
// which the script doesn't have.
// shortcut: judged from the narration only; add a "sin sonido" criterion once the opening's on-screen text is readable.
export const CRITERIA: {key: string; label: string; max: number; ask: string}[] = [
  {key: 'forMe', label: 'Es para mí', max: 20, ask: 'Does the first sentence make clear, without a wind-up ("you won\'t believe…"), who it is for and which problem, so the right viewer knows at once it is for them?'},
  {key: 'specific', label: 'Específico', max: 15, ask: 'Does the opening name a concrete pain, result, number or situation the viewer recognises, rather than a general topic?'},
  {key: 'question', label: 'Abre una pregunta', max: 25, ask: 'Does it open one question the viewer could put into words, giving just enough to understand the promise and holding back the piece that answers it (not naming what would answer it)?'},
  {key: 'second', label: 'La segunda frase sube la apuesta', max: 15, ask: 'From about 3 to 10 seconds, does the next sentence raise what the viewer gains or loses, or why now, without answering the question yet and without background?'},
  {key: 'belief', label: 'Por qué creerle', max: 10, ask: 'Is there an early proof, figure or concrete case that makes the claim believable, without opening on credentials?'},
  {key: 'promise', label: 'Cumple la promesa', max: 15, ask: 'Does the rest of the script answer exactly what the hook promised (no bait), and end soon after it does?'},
];

function read(slug: string): HookCheck | null {
  const o = obj(readJson(FILE(slug)));
  if (typeof o.script !== 'string' || typeof o.score !== 'number') return null;
  return o as unknown as HookCheck;
}

// The model's answer, kept to the rubric: unknown criteria dropped, scores clamped, the total recomputed.
export function clean(raw: unknown, script: string): HookCheck {
  const o = obj(raw);
  const given = obj(o.criteria);
  const criteria: ScriptCheckCriterion[] = CRITERIA.map((c) => {
    const g = obj(given[c.key]);
    const n = Number(g.score);
    return {key: c.key, label: c.label, max: c.max, score: Number.isFinite(n) ? Math.round(Math.min(Math.max(n, 0), c.max)) : 0, note: str(g.note, 300)};
  });
  return {
    score: criteria.reduce((t, c) => t + c.score, 0),
    verdict: str(o.verdict, 400),
    hook: str(o.hook, 400),
    question: str(o.question, 200),
    criteria,
    good: arr(o.good).map((x) => str(x, 300)).filter(Boolean).slice(0, 3),
    fixes: arr(o.fixes)
      .map((x) => ({line: str(obj(x).line, 300), why: str(obj(x).why, 300), try: str(obj(x).try, 400)}))
      .filter((f) => f.why || f.try)
      .slice(0, 3),
    alternatives: arr(o.alternatives)
      .map((x) => ({hook: str(obj(x).hook, 300), second: str(obj(x).second, 300)}))
      .filter((a) => a.hook)
      .slice(0, 3),
    script: hash(script),
    at: Date.now(),
  };
}

const running = new Map<string, Promise<void>>();
const errors = new Map<string, string>();

export function state(slug: string): HookCheckState {
  const script = scriptOf(slug);
  const check = read(slug);
  return {script: !!script && !isPlaceholder(slug, script), running: running.has(slug), stale: !!check && check.script !== hash(script), check, error: errors.get(slug) ?? ''};
}

// Judges the script unless this very script was judged already (force: again anyway). One at a time per video.
export async function run(slug: string, force = false): Promise<HookCheckState> {
  const s = state(slug);
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

// For the agent (GET or POST …/hook-check?format=text): the check as it is, saying if the script changed since.
export function agentText(slug: string): string {
  const s = state(slug);
  const c = s.check;
  if (!c) return s.error ? `La revisión del gancho falló: ${s.error}` : 'Este video aún no tiene revisión del gancho.';
  const lines = [
    `Fuerza del gancho (${path.relative(path.dirname(VIDEOS), FILE(slug))}): ${c.score}/100${s.stale ? '. Ojo: el guion cambió después de esta revisión, compáralo con audio/vo.txt' : ''}.`,
    c.verdict && `Veredicto: ${c.verdict}`,
    c.hook && `Gancho revisado: «${c.hook}»`,
    c.question && `Pregunta que abre: ${c.question}`,
    'Criterios:',
    ...c.criteria.map((k) => `- ${k.label}: ${k.score}/${k.max}${k.note ? ` (${k.note})` : ''}`),
    c.fixes.length > 0 && 'Qué cambiar:',
    ...c.fixes.map((f) => `- ${f.line ? `«${f.line}»: ` : ''}${f.why}${f.try ? ` Prueba: ${f.try}` : ''}`),
    c.alternatives.length > 0 && 'Ganchos alternativos:',
    ...c.alternatives.map((a) => `- «${a.hook}»${a.second ? ` → «${a.second}»` : ''}`),
    c.good.length > 0 && `Lo que ya funciona (no lo pierdas): ${c.good.join('; ')}`,
    'Si cambias el guion, actualiza beats.json y respeta el skill video-script (todo lo que promete el gancho debe ser cierto y pagarse en pantalla); el estudio vuelve a revisarlo solo.',
  ];
  return lines.filter(Boolean).join('\n');
}

async function judge(script: string): Promise<HookCheck> {
  const a = audience.get();
  const profile = audience.configured(a)
    ? `${audience.context(a)}
My audience's named problems, most important first: ${a.problems.join('; ') || '(empty)'}
What they want: ${a.wants.map((w) => w.want).join('; ') || '(empty)'}`
    : 'I have no audience profile yet: judge "who it is for" from the script itself.';
  let model = '';
  const answer = audience.parseJson(
    await agentCli.ask(
      `${profile}

The narration script of my next short video (one line per beat, spoken at about 3 words a second):
"""
${script}
"""

Judge its HOOK: the first sentence (0–3 s) and the one after it (3–10 s), and whether the rest keeps the hook's promise. The viewer decides in the first second or two whether to keep watching, asking: is this for me, why now, what do I get, should I trust this person. Be honest and strict: a vague or generic opening, a wind-up, or bait the video doesn't pay off should score low. Score each criterion from 0 to its max:
${CRITERIA.map((c) => `- ${c.key} (0–${c.max}): ${c.ask}`).join('\n')}

Write everything for me, the creator, in the script's language, short and plain, no marketing words. Rewrites must stay true to the script: no invented figures, results or guarantees.

Answer with a JSON object:
{"criteria": {${CRITERIA.map((c) => `"${c.key}": {"score": n, "note": "one short sentence on why"}`).join(', ')}},
 "verdict": "one or two sentences: how strong the hook is and the single most important change",
 "hook": "the opening you judged as the hook, quoted exactly from the script",
 "question": "the question it leaves the viewer wanting answered, in their words, or \\"\\" if none",
 "good": ["up to 3 things in the opening that already work"],
 "fixes": [{"line": "the script line to change, quoted exactly (or \\"\\" if it's about something missing)", "why": "why it weakens the hook", "try": "a rewrite or what to add"}],
 "alternatives": [{"hook": "another first sentence", "second": "its second sentence"}]}
Give at most 3 fixes, the ones that would raise the score the most, and 2 or 3 alternatives that open different questions.`,
      'You answer only with the JSON asked for, nothing else.',
      {model: 'smart', effort: 'medium', use: modelFor('hook'), timeout: 4 * 60_000, onModel: (m) => (model = m)},
    ),
  );
  return {...clean(answer, script), model: [agentCli.label, model].filter(Boolean).join(' · ')};
}
