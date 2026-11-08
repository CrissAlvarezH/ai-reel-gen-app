// Auditoría: checks that the facts a video's script (audio/vo.txt) states are right, with sources. Only facts: never
// style, the hook or the advice (script-check.ts and hook-check.ts do those).
//
// Three reviewers, each a one-off answer of the agent CLI with only web search and fetch (agentCli.ask with web), run
// at once and never see each other's work, nor the creator's profile beyond who the video is for: each one starts from
// a different approach (primary sources, a sceptic's, context and validity), so one model's blind spot or a source
// that misleads one of them doesn't decide the report alone. A last answer without tools merges their findings: same
// claim, one finding; where they disagree it decides from the evidence they gave and marks it disputed; it can't add
// claims or sources of its own (sources not given by a reviewer are dropped here).
//
// Per project, in projects/<id>/fact-audit.json: the settings (automatic or not, his instructions, the model), the
// reports with what he did with each (Pendiente, Resuelto, Archivado) and, for the automatic one, the last script
// seen of each video. Videos are audited one at a time, in order, whichever project they're in.
//
// Automatic: every minute, in each project that has it on, a video whose script changed since it was last seen and
// hasn't changed for STABLE (the agent has finished saving it) gets a report. Turning it on doesn't audit the videos
// that already have a script: only the scripts saved from then on (the others, with Auditar).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {FactAuditSettings, FactAuditVideo, FactAuditView, FactFinding, FactReport, FactReportState, FactReviewer, FactSource, FactVerdict} from '../shared/types.ts';
import {agentCli} from './agent.ts';
import {parseJson} from './audience.ts';
import {getProfile} from './config.ts';
import {readJson, writeJson} from './platform.ts';
import {httpError, isPlaceholder, listSlugs, title, validSlug} from './reels.ts';
import {arr, hash, modelOptions, obj, str} from './script-check.ts';
import {PROJECT, ROOT, listProjects, projectDir, withProject} from './workspace.ts';

type Store = {settings: FactAuditSettings; reports: FactReport[]; seen: Record<string, string>};
const DEFAULTS: FactAuditSettings = {auto: false, prompt: '', model: '', effort: 'high'};
const KEEP = 300;
const MAX_PROMPT = 8000;
const STABLE = 3 * 60_000;
const REVIEW_TIMEOUT = 15 * 60_000;
const MERGE_TIMEOUT = 6 * 60_000;

const fileOf = (project: string) => path.join(projectDir(project), 'fact-audit.json');
const scriptFile = (project: string, slug: string) => path.join(projectDir(project), 'videos', slug, 'audio/vo.txt');
const read = (project: string): Store => {
  const s = readJson<Partial<Store>>(fileOf(project)) ?? {};
  return {settings: {...DEFAULTS, ...s.settings}, reports: Array.isArray(s.reports) ? s.reports : [], seen: s.seen && typeof s.seen === 'object' ? s.seen : {}};
};
function change<T>(project: string, fn: (s: Store) => T): T {
  const s = read(project);
  const r = fn(s);
  s.reports = s.reports.slice(-KEEP);
  writeJson(fileOf(project), s);
  notify();
  return r;
}
const newId = () => crypto.randomBytes(5).toString('hex');

let notify = () => {};
export const setNotify = (fn: () => void) => (notify = fn);

/* ───── The reviewers ───── */

const LENSES: {lens: string; how: string}[] = [
  {lens: 'Fuentes primarias', how: 'Go first to primary and official sources for each claim (the institution or regulator itself, the text of the law or rule, official statistics, the original study or data) and judge the claim by exactly what they say, not by what secondary sites repeat.'},
  {lens: 'Escéptico', how: 'Assume each claim may be wrong: search specifically for evidence against it (corrections, newer figures, exceptions, debunks, cases where it fails) before accepting it. Redo every calculation in the script yourself.'},
  {lens: 'Contexto y vigencia', how: 'Focus on whether each claim holds today and for this audience: the date and validity of each figure, the country and jurisdiction, units and currency, who it applies to and who not, and whether a simplification changes what a viewer would understand.'},
];

const SYSTEM = 'You are an independent fact-checker. You answer only with the JSON asked for, nothing else.';
const VERDICTS: FactVerdict[] = ['error', 'matiz', 'ok'];

type Claim = {claim: string; verdict: FactVerdict; explanation: string; correction: string; sources: FactSource[]};

const cleanSources = (v: unknown): FactSource[] =>
  arr(v)
    .map((x) => ({title: str(obj(x).title, 200), url: str(obj(x).url, 600)}))
    .filter((x) => /^https?:\/\/[^\s]+$/i.test(x.url))
    .map((x) => ({...x, title: x.title || new URL(x.url).hostname}))
    .slice(0, 6);
function cleanClaim(x: unknown): Claim | null {
  const o = obj(x);
  const verdict = str(o.verdict, 10).toLowerCase() as FactVerdict;
  const claim = str(o.claim, 600);
  if (!claim || !VERDICTS.includes(verdict)) return null;
  return {claim, verdict, explanation: str(o.explanation, 1200), correction: verdict === 'ok' ? '' : str(o.correction, 800), sources: cleanSources(o.sources)};
}

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

function reviewPrompt(n: number, r: FactReport, audience: string) {
  const l = LENSES[n - 1];
  return `Today is ${today()}. You are reviewer ${n} of three who check, each on their own, the facts stated in the narration script of a short video. You won't see the other reviewers' work and they won't see yours: don't assume anything is right because it's in the script, and don't soften a verdict.
${audience ? `The video is for: ${audience}. Use it to know which country, currency, laws and institutions the claims refer to when the script doesn't say.\n` : ''}
Title: «${r.title}»
The script (one line per beat):
"""
${r.script}
"""

Your approach: ${l.how}

What to do:
1. List every verifiable factual claim in the script: figures, percentages, rates, dates, names, laws and rules, how a product, tax or procedure works, causes and effects stated as fact, comparisons. Include the figures the script computes (check the arithmetic yourself). Skip opinions, advice, jokes, rhetorical questions and the creator's own experience.
2. Check each one on the web, preferring primary and official sources and current ones: figures that change (rates, prices, thresholds, limits, rules) must be checked against their latest value as of today. Open the pages you cite; never cite a page you didn't read or a URL you're not sure exists.
3. Give each claim a verdict:
   - "error": false, outdated, or the figure, date or name is wrong, so a viewer who believes it ends up misinformed.
   - "matiz": essentially right but missing a condition, exception or context that matters, or worded so it could be misread (true only for some people, a simplification that changes the meaning, a figure that is only approximate). Also a claim you couldn't verify with a reliable source: say so in explanation.
   - "ok": confirmed by your sources.
   Only facts: never judge style, tone, the hook or whether the advice is good.
${r.prompt ? `\nThe creator's instructions for this audit (they win over the above on what to check and how, never on citing sources you opened):\n"""\n${r.prompt}\n"""\n` : ''}
Write explanations and corrections in the script's language, short and plain, giving the figure or date your sources state.
Answer with a JSON object:
{"claims": [{"claim": "the script's words, quoted exactly (the line or the part of it)", "verdict": "error" | "matiz" | "ok", "explanation": "what your sources say", "correction": "how the line could say it correctly, in the script's tone (\\"\\" for ok)", "sources": [{"title": "page or document title", "url": "https://…"}]}]}
Every claim needs at least one source you opened.`;
}

function mergePrompt(r: FactReport, reviews: {n: number; claims: Claim[]}[]) {
  return `Three reviewers checked, independently and with web sources, the facts stated in this video script. Merge their work into one report. You are not a fourth reviewer: don't add claims none of them made, don't use sources they didn't give and don't use your own knowledge to overrule their evidence.

The script:
"""
${r.script}
"""

${reviews.map((v) => `Reviewer ${v.n} (approach: ${LENSES[v.n - 1].lens}):\n${JSON.stringify(v.claims)}`).join('\n\n')}

Rules:
- One finding per fact: join the claims that refer to the same fact even if quoted differently. "agents": the numbers of the reviewers who listed it. "claim": the script's words, quoted exactly.
- "verdict": if they agree, that one. If they disagree, decide from the evidence they give (the most specific, primary and recent source wins; a figure a reliable source shows wrong is an "error" even if another reviewer passed it), set "disputed": true and say in explanation what each side found.
- A fact only one reviewer flagged as "error" or "matiz" stays (it may have caught what the others missed) unless the others' sources clearly show it's right.
- "sources": the reviewers' sources for that fact, best first, up to 4, copied exactly (title and url).
- "summary": two or three sentences for the creator: how reliable the script is and the most important thing to fix, if any.
Write in the script's language.
Answer with a JSON object:
{"summary": "…", "findings": [{"claim": "…", "verdict": "error" | "matiz" | "ok", "explanation": "…", "correction": "… (\\"\\" for ok)", "sources": [{"title": "…", "url": "…"}], "agents": [1, 2], "disputed": false}]}`;
}

const normUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
const ORDER: Record<FactVerdict, number> = {error: 0, matiz: 1, ok: 2};
const sortFindings = (f: FactFinding[]) => f.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);

// The merged answer, kept honest: reviewers that exist, sources a reviewer gave.
export function cleanMerge(raw: unknown, reviews: {n: number; claims: Claim[]}[]) {
  const given = new Map(reviews.flatMap((v) => v.claims.flatMap((c) => c.sources)).map((s) => [normUrl(s.url), s]));
  const ns = new Set(reviews.map((v) => v.n));
  const o = obj(raw);
  const findings: FactFinding[] = arr(o.findings).flatMap((x) => {
    const c = cleanClaim(x);
    if (!c) return [];
    const agents = [...new Set(arr(obj(x).agents).map(Number).filter((n) => ns.has(n)))].sort();
    const sources = c.sources.map((s) => given.get(normUrl(s.url))).filter((s): s is FactSource => !!s);
    return [{id: newId(), ...c, sources: [...new Map(sources.map((s) => [normUrl(s.url), s])).values()].slice(0, 4), agents, disputed: obj(x).disputed === true}];
  });
  return {summary: str(o.summary, 800), findings: sortFindings(findings)};
}
// If the merge fails: each reviewer's own findings, side by side.
const unmerged = (reviews: {n: number; claims: Claim[]}[]): FactFinding[] => sortFindings(reviews.flatMap((v) => v.claims.map((c) => ({id: newId(), ...c, agents: [v.n], disputed: false}))));

/* ───── Running them, one video at a time ───── */

type Job = {project: string; id: string};
const queue: Job[] = [];
let current: (Job & {ctrl: AbortController}) | null = null;
const busy = (project: string, id: string) => (current?.project === project && current.id === id) || queue.some((j) => j.project === project && j.id === id);

const update = (project: string, id: string, fn: (r: FactReport) => void) =>
  change(project, (s) => {
    const r = s.reports.find((x) => x.id === id);
    if (r) fn(r);
  });
const reviewer = (project: string, id: string, n: number, patch: Partial<FactReviewer>) => update(project, id, (r) => Object.assign(r.reviewers[n - 1], patch));

// The model chosen for this project, if the agent in Ajustes still offers it ('' otherwise: the smart tier).
const modelFor = (s: FactAuditSettings) => (s.model && agentCli.models().some((m) => m.id === s.model) ? s.model : '');
// Its reasoning effort, if that model has it ('' otherwise: the CLI's own; OpenCode has none).
const effortFor = (s: FactAuditSettings) => {
  const efforts = agentCli.models().find((m) => m.id === modelFor(s))?.efforts ?? [];
  return efforts.includes(s.effort) ? s.effort : efforts.includes(DEFAULTS.effort) ? DEFAULTS.effort : '';
};
// The models a review can run on, with their efforts.
const modelsWithEfforts = () => modelOptions().map((m) => ({...m, efforts: agentCli.models().find((x) => x.id === m.id)?.efforts ?? []}));

async function audit(job: Job, signal: AbortSignal) {
  const s = read(job.project);
  const r = s.reports.find((x) => x.id === job.id);
  if (!r) return;
  const audience = (() => {
    try {
      return withProject(job.project, () => getProfile().audience).trim().slice(0, 600);
    } catch {
      return '';
    }
  })();
  const use = modelFor(s.settings);
  const effort = effortFor(s.settings);
  update(job.project, job.id, (x) => {
    x.status = 'running';
    x.reviewers.forEach((v) => (v.state = 'running'));
  });
  const reviews = await Promise.all(
    LENSES.map(async (_, i) => {
      const n = i + 1;
      let model = '';
      try {
        const answer = await agentCli.ask(reviewPrompt(n, r, audience), SYSTEM, {model: 'smart', use, effort, web: true, timeout: REVIEW_TIMEOUT, signal, onModel: (m) => (model = m)});
        const claims = arr(obj(parseJson(answer)).claims).map(cleanClaim).filter((c): c is Claim => !!c);
        reviewer(job.project, job.id, n, {state: 'done', model: [agentCli.label, model].filter(Boolean).join(' · '), claims: claims.length, flagged: claims.filter((c) => c.verdict !== 'ok').length, at: Date.now()});
        return {n, claims};
      } catch (e) {
        reviewer(job.project, job.id, n, {state: signal.aborted ? 'stopped' : 'error', error: signal.aborted ? '' : (e as Error).message.slice(0, 300), at: Date.now()});
        return null;
      }
    }),
  );
  if (signal.aborted) return update(job.project, job.id, (x) => ((x.status = 'stopped'), (x.finished = Date.now())));
  const ok = reviews.filter((v): v is {n: number; claims: Claim[]} => !!v);
  if (!ok.length) return update(job.project, job.id, (x) => ((x.status = 'error'), (x.error = 'Ningún revisor terminó: mira el error de cada uno.'), (x.finished = Date.now())));
  let merged: {summary: string; findings: FactFinding[]};
  try {
    merged = cleanMerge(parseJson(await agentCli.ask(mergePrompt(r, ok), 'You answer only with the JSON asked for, nothing else.', {model: 'smart', use, effort, timeout: MERGE_TIMEOUT, signal})), ok);
    if (!merged.findings.length && ok.some((v) => v.claims.length)) throw new Error('la unión quedó vacía');
  } catch (e) {
    if (signal.aborted) return update(job.project, job.id, (x) => ((x.status = 'stopped'), (x.finished = Date.now())));
    merged = {summary: `No pude unir los hallazgos de los revisores (${(e as Error).message}): van por separado, y un mismo dato puede salir más de una vez.`, findings: unmerged(ok)};
  }
  update(job.project, job.id, (x) => {
    x.status = 'done';
    x.finished = Date.now();
    x.summary = merged.summary;
    x.findings = merged.findings;
    if (ok.length < LENSES.length) x.error = `Solo terminaron ${ok.length} de ${LENSES.length} revisores.`;
  });
}

async function pump() {
  if (current || !queue.length) return;
  const job = queue.shift()!;
  current = {...job, ctrl: new AbortController()};
  try {
    await audit(job, current.ctrl.signal);
  } catch (e) {
    try {
      update(job.project, job.id, (x) => ((x.status = 'error'), (x.error = (e as Error).message), (x.finished = Date.now())));
    } catch {
      /* the project is gone */
    }
  } finally {
    current = null;
    void pump();
  }
}

// A new report for this video's script as it is now, at the end of the queue. null: no script yet.
function enqueue(project: string, s: Store, slug: string, trigger: 'manual' | 'auto'): string | null {
  let script = '';
  try {
    script = fs.readFileSync(scriptFile(project, slug), 'utf8').trim();
  } catch {
    return null;
  }
  if (!script || withProject(project, () => isPlaceholder(slug, script))) return null;
  const id = newId();
  s.seen[slug] = hash(script);
  s.reports.push({
    id,
    slug,
    title: withProject(project, () => title(slug)) ?? slug,
    trigger,
    script,
    scriptHash: hash(script),
    prompt: s.settings.prompt,
    created: Date.now(),
    finished: null,
    status: 'queued',
    state: 'open',
    reviewers: LENSES.map((l, i) => ({n: i + 1, lens: l.lens, state: 'pending', model: '', error: '', claims: 0, flagged: 0, at: null})),
    summary: '',
    findings: [],
    error: '',
  });
  queue.push({project, id});
  return id;
}

/* ───── The page ───── */

const lastScript = (slug: string) => {
  try {
    return fs.readFileSync(scriptFile(PROJECT, slug), 'utf8').trim();
  } catch {
    return '';
  }
};

export function view(): FactAuditView {
  const s = read(PROJECT);
  const scripts = new Map(listSlugs().map((slug) => [slug, lastScript(slug)]));
  const reports = s.reports
    .map((r) => {
      const cut = (r.status === 'running' || r.status === 'queued') && !busy(PROJECT, r.id);
      const script = scripts.get(r.slug);
      return {...r, status: cut ? ('interrupted' as const) : r.status, stale: script !== undefined && !!script && hash(script) !== r.scriptHash};
    })
    .reverse();
  const videos: FactAuditVideo[] = [...scripts].map(([slug, script]) => {
    const last = reports.find((r) => r.slug === slug && r.status === 'done');
    let updated = 0;
    try {
      updated = fs.statSync(scriptFile(PROJECT, slug)).mtimeMs;
    } catch {
      /* no script */
    }
    return {
      slug,
      title: title(slug) ?? slug,
      script: !!script && !isPlaceholder(slug, script),
      updated: Math.round(updated),
      lastAudit: last?.finished ?? null,
      stale: !!last && hash(script) !== last.scriptHash,
      busy: reports.some((r) => r.slug === slug && (r.status === 'queued' || r.status === 'running')),
    };
  });
  videos.sort((a, b) => b.updated - a.updated);
  return {settings: {...s.settings, model: modelFor(s.settings), effort: effortFor(s.settings)}, agent: agentCli.label, models: modelsWithEfforts(), videos, reports};
}

export function setSettings(input: unknown) {
  const i = obj(input);
  change(PROJECT, (s) => {
    if (typeof i.prompt === 'string') {
      if (i.prompt.length > MAX_PROMPT) throw httpError(400, `las instrucciones caben en ${MAX_PROMPT} caracteres`);
      s.settings.prompt = i.prompt.trim();
    }
    if (typeof i.model === 'string') {
      if (!modelOptions().some((m) => m.id === i.model)) throw httpError(400, `${agentCli.label} no tiene ese modelo`);
      s.settings.model = i.model;
    }
    if (typeof i.effort === 'string') {
      const efforts = modelsWithEfforts().find((m) => m.id === modelFor(s.settings))?.efforts ?? [];
      if (!efforts.includes(i.effort)) throw httpError(400, 'ese modelo no tiene ese nivel de esfuerzo');
      s.settings.effort = i.effort;
    }
    if (typeof i.auto === 'boolean' && i.auto !== s.settings.auto) {
      s.settings.auto = i.auto;
      // From now on: the scripts there already are count as seen.
      if (i.auto)
        for (const slug of listSlugs()) {
          const script = lastScript(slug);
          if (script) s.seen[slug] = hash(script);
        }
    }
  });
  return view();
}

// Auditar: the chosen videos, each with a new report, in this order.
export function start(slugs: unknown) {
  if (!Array.isArray(slugs) || !slugs.length) throw httpError(400, 'elige al menos un video');
  const known = new Set(listSlugs());
  const list = [...new Set(slugs)].filter((x): x is string => validSlug(x) && known.has(x));
  if (!list.length) throw httpError(404, 'esos videos no existen');
  const skipped: string[] = [];
  change(PROJECT, (s) => {
    for (const slug of list) {
      if (s.reports.some((r) => r.slug === slug && busy(PROJECT, r.id))) continue;
      if (!enqueue(PROJECT, s, slug, 'manual')) skipped.push(slug);
    }
  });
  if (skipped.length === list.length) throw httpError(400, list.length > 1 ? 'esos videos aún no tienen guion' : 'este video aún no tiene guion');
  void pump();
  return view();
}

const STATES: FactReportState[] = ['open', 'resolved', 'archived'];
export function setState(id: string, state: unknown) {
  if (!STATES.includes(state as FactReportState)) throw httpError(400, 'ese estado no existe');
  change(PROJECT, (s) => {
    const r = s.reports.find((x) => x.id === id);
    if (!r) throw httpError(404, 'ese reporte no existe');
    r.state = state as FactReportState;
  });
  return view();
}

export function stop(id: string) {
  const i = queue.findIndex((j) => j.project === PROJECT && j.id === id);
  if (i >= 0) {
    queue.splice(i, 1);
    update(PROJECT, id, (r) => {
      r.status = 'stopped';
      r.finished = Date.now();
      r.reviewers.forEach((v) => (v.state = 'stopped'));
    });
  } else if (current?.project === PROJECT && current.id === id) current.ctrl.abort();
  return view();
}

export function remove(id: string) {
  if (busy(PROJECT, id)) throw httpError(409, 'está en marcha: detenla antes de borrarla');
  change(PROJECT, (s) => {
    const n = s.reports.length;
    s.reports = s.reports.filter((r) => r.id !== id);
    if (s.reports.length === n) throw httpError(404, 'ese reporte no existe');
  });
  return view();
}

export const runningIn = (project: string) => current?.project === project || queue.some((j) => j.project === project);
export function stopAll() {
  queue.length = 0;
  current?.ctrl.abort();
}

/* ───── Automatic ───── */

function scan() {
  if (!ROOT) return;
  for (const p of listProjects()) {
    let s: Store;
    try {
      s = read(p.id);
    } catch {
      continue;
    }
    if (!s.settings.auto) continue;
    const dir = path.join(projectDir(p.id), 'videos');
    let slugs: string[] = [];
    try {
      slugs = fs.readdirSync(dir).filter(validSlug);
    } catch {
      continue;
    }
    const due = slugs.filter((slug) => {
      try {
        const f = scriptFile(p.id, slug);
        const st = fs.statSync(f);
        const script = fs.readFileSync(f, 'utf8').trim();
        return !!script && s.seen[slug] !== hash(script) && Date.now() - st.mtimeMs >= STABLE && !s.reports.some((r) => r.slug === slug && busy(p.id, r.id));
      } catch {
        return false;
      }
    });
    if (!due.length) continue;
    change(p.id, (st) => {
      for (const slug of due)
        if (!enqueue(p.id, st, slug, 'auto')) {
          // A placeholder: seen, so it isn't looked at again until it changes.
          try {
            st.seen[slug] = hash(fs.readFileSync(scriptFile(p.id, slug), 'utf8').trim());
          } catch {
            /* gone */
          }
        }
    });
    void pump();
  }
}
let timer: NodeJS.Timeout | undefined;
export function startScanner() {
  clearInterval(timer);
  timer = setInterval(() => {
    try {
      scan();
    } catch (e) {
      console.error('auditoría automática:', (e as Error).message);
    }
  }, 60_000);
}

/* ───── For the video's agent ───── */

// "Enviar al agente del video": the errors and matices of its latest finished report still open, with their sources.
export function agentText(slug: string): string {
  const r = read(PROJECT).reports.filter((x) => x.slug === slug && x.status === 'done' && x.state === 'open').pop();
  if (!r) return '';
  const flagged = r.findings.filter((f) => f.verdict !== 'ok');
  const changed = hash(lastScript(slug)) !== r.scriptHash;
  return [
    `Auditoría de datos del guion (página Auditoría, ${new Date(r.finished ?? r.created).toLocaleString('es')}; tres revisores independientes con fuentes web)${changed ? '. Ojo: el guion cambió después de esta auditoría, compáralo con audio/vo.txt' : ''}.`,
    r.summary && `Resumen: ${r.summary}`,
    flagged.length ? 'Hallazgos:' : 'No encontró errores ni matices.',
    ...flagged.map((f) => `- [${f.verdict === 'error' ? 'Error' : 'Matiz'}${f.disputed ? ', los revisores no coincidieron' : ''}] «${f.claim}»: ${f.explanation}${f.correction ? ` Corrección: ${f.correction}` : ''}${f.sources.length ? ` Fuentes: ${f.sources.map((x) => x.url).join(' · ')}` : ' (sin fuente)'}`),
    'Corrige solo lo que estas fuentes sostengan (ábrelas si dudas) y cuéntale qué cambiaste; si cambias el guion, actualiza beats.json y respeta el skill video-script.',
  ]
    .filter(Boolean)
    .join('\n');
}
