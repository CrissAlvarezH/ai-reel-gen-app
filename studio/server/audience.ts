// Perfil de audiencia (#/audiencia): who the open project's videos are for and what that audience wants, deals with and
// thinks, in projects/<id>/config/audience.json. The "who" is the profile's audience (config/profile.json), so everything
// that already reads it follows. The agent gets the rest with every message (chat.ts). The suggestions follow the
// creator's guides, through the agent CLI's ask; nothing is saved until he picks.
import path from 'node:path';
import {IDEA_ICONS, type Audience, type AudienceLevels, type AudienceWant, type IdeaIcon, type PillarSet, type WantOption} from '../shared/types.ts';
import {agentCli} from './agent.ts';
import {getProfile, setProfile} from './config.ts';
import {readJson, writeJson} from './platform.ts';
import {CONFIG} from './workspace.ts';

const FILE = () => path.join(CONFIG, 'audience.json');
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const want = (v: unknown): AudienceWant => {
  const o = obj(v);
  return {want: str(o.want, 300), so1: str(o.so1, 300), so2: str(o.so2, 300)};
};
const LEVELS = ['unaware', 'problemAware', 'solutionAware', 'productAware'] as const;
const levels = (v: unknown): AudienceLevels => {
  const o = obj(v);
  return {problem: str(o.problem, 200), ...(Object.fromEntries(LEVELS.map((k) => [k, str(o[k], 400)])) as Omit<AudienceLevels, 'problem'>)};
};

// The file as the page shows it, forgiving of hand edits.
function read(raw: unknown, who: string): Audience {
  const o = obj(raw);
  const p = obj(o.product);
  return {
    who,
    result: str(o.result, 300),
    product: {what: str(p.what, 300), price: str(p.price, 100), problems: str(p.problems, 1000)},
    wants: arr(o.wants).map(want).filter((w) => w.want || w.so1 || w.so2).slice(0, 100),
    problems: [...new Set(arr(o.problems).map((x) => str(x, 200)).filter(Boolean))].slice(0, 50),
    levels: arr(o.levels).map(levels).filter((l) => l.problem).slice(0, 20),
    onboarded: o.onboarded === true,
  };
}

export const get = (): Audience => read(readJson(FILE()), getProfile().audience);

// Saves what's given; the rest stays. The "who" goes to the profile.
export function save(input: unknown): Audience {
  const i = obj(input);
  const next = read({...get(), ...i}, '');
  const {who: _, ...own} = next;
  writeJson(FILE(), own);
  if (typeof i.who === 'string' && i.who.trim() !== getProfile().audience) setProfile({audience: i.who});
  return get();
}

/* ───── Suggestions ───── */

function context(a: Audience) {
  const p = getProfile();
  return [
    `The creator makes short explainer videos for ${p.platform}. Write every suggestion in ${p.language}, the way the audience talks (if it's Spanish, the everyday Spanish of that audience).`,
    `Step 1 offer: "I help ${a.who || '(not set)'} get ${a.result || '(not set)'}."`,
    a.product.what ? `Product: ${a.product.what}${a.product.price ? ` (${a.product.price})` : ''}. Problems it solves: ${a.product.problems || '(not said)'}.` : 'Product: none yet.',
  ].join('\n');
}
const table = (a: Audience) => a.wants.map((w, i) => `${i + 1}. ${w.want} | So I can: ${w.so1 || '(empty)'} | So I can: ${w.so2 || '(empty)'}`).join('\n');

// The JSON in an answer (models sometimes wrap it in prose or a fence).
export function parseJson(answer: string): unknown {
  const start = answer.search(/[[{]/);
  const end = Math.max(answer.lastIndexOf(']'), answer.lastIndexOf('}'));
  if (start < 0 || end < start) throw Object.assign(new Error('la IA no devolvió sugerencias; prueba otra vez'), {status: 502});
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error('la IA no devolvió sugerencias legibles; prueba otra vez'), {status: 502});
  }
}
const need = (ok: boolean, msg: string) => {
  if (!ok) throw Object.assign(new Error(msg), {status: 400});
};
const ask = async (prompt: string) => parseJson(await agentCli.ask(prompt, 'You answer only with the JSON asked for, nothing else.', {model: 'smart', timeout: 4 * 60_000}));

// 3 options for each want in `only` (the page's table as it is, saved or not): {want: options}. Its rows are asked
// as empty, so asking again gives other options.
export async function suggestWants(input: unknown): Promise<Record<string, WantOption[]>> {
  const i = obj(input);
  const wants = arr(i.wants).map(want).filter((w) => w.want).slice(0, 100);
  const only = new Set(arr(i.only).map((x) => str(x, 300)));
  const a = {...get(), wants: wants.map((w) => (only.has(w.want) ? {...w, so1: '', so2: ''} : w))};
  const empty = a.wants.flatMap((w, n) => (only.has(w.want) ? [n] : []));
  need(empty.length > 0, 'no hay deseos para sugerir');
  const answer = await ask(`${context(a)}

My Step 2 table (What they want | So I can… | So I can…):
${table(a)}

Only work on rows where the two "So I can..." columns are empty. Skip any row that's already filled in, but read those rows so your suggestions match the way I've been writing. For each empty row, suggest 3 different options for the two "So I can..." columns. Each option is a full chain: What they want → So I can... → So I can...

Rules:
- Each column must go one real step further than the one before it. Ask "what would that get them?" between columns. Don't ask "how would that feel?", because that leads to the same idea in different words.
- Column 2 is what getting the want would let them do.
- Column 3 is what changes in their life or business because of that.
- Check every option: if you could swap column 2 and column 3 and nothing changes, they say the same thing. Replace it.
- Make the 3 options for each row go in different directions (for example: money, time, how they feel about themselves, how other people see them), not three versions of the same answer.
- Write in my audience's everyday words, short, the way they'd say it to a friend. No marketing language.
- Keep it real for my audience. Don't invent big dramatic outcomes they wouldn't actually say.
- Don't start the columns with "So I can" (or its translation): the table's header already says it.

Answer with a JSON object: keys are the row numbers (${empty.map((i) => i + 1).join(', ')}), values are arrays of 3 {"so1": "...", "so2": "..."}.`);
  const o = obj(answer);
  return Object.fromEntries(
    empty.flatMap((n) => {
      const options = arr(o[String(n + 1)]).map((x) => ({so1: str(obj(x).so1, 300), so2: str(obj(x).so2, 300)})).filter((x) => x.so1 && x.so2);
      return options.length ? [[a.wants[n].want, options.slice(0, 3)]] : [];
    }),
  );
}

export async function suggestPillars(): Promise<PillarSet[]> {
  const a = get();
  need(a.wants.some((w) => w.want), 'primero escribe lo que quiere tu audiencia');
  const answer = await ask(`${context(a)}

My audience's wants:
${a.wants.filter((w) => w.want).map((w) => `- ${w.want}`).join('\n')}

Group my audience's wants into content pillars. Pillars are the main topics I'll keep posting about. The main goal of my content is reach: getting in front of as many people in my target audience as possible (the "who" in my Step 1 offer).

Give me 3 different sets of pillars to choose from. Label them Set A, Set B, and Set C. Each set should group the wants in a different way, not the same pillars with new names.

For each pillar, give me:
- A short name (2 to 5 words) my audience would understand, with one icon that fits, from this list: ${IDEA_ICONS.join(', ')}
- The wants from my list that belong to it
- 2 example post ideas, one about the problem and one about the result, so I can see what posting about it would look like

Rules:
- Every pillar must come from wants that are actually on my list. Don't invent topics my audience didn't say they want.
- Favor pillars that most of my target audience cares about, not just people already deep into the topic. If a pillar would only reach a small slice of my audience, say so next to it.
- Each pillar should be easy to come up with at least 10 post ideas for.
- Name pillars as neutral topics, not as a problem or a promise, so I can post about them from either side.
- Each want goes in the pillar it fits best. If a want doesn't fit anywhere, list it under "Leftovers" instead of forcing it.
- There's no limit on the number of pillars. Make as many as my list needs. Just don't split one topic into two pillars that say the same thing.
- Plain, everyday words. No marketing language.

Answer with a JSON array of 3 sets: [{"name": "Set A", "pillars": [{"name": "...", "icon": "<one from the list>", "wants": ["<exactly as in my list>"], "posts": ["<about the problem>", "<about the result>"], "narrow": "<empty, or why it reaches only a small slice>"}], "leftovers": ["..."]}]. The pillar's name has no emoji.`);
  return arr(answer)
    .slice(0, 3)
    .map((x, n) => {
      const s = obj(x);
      return {
        name: str(s.name, 40) || `Set ${'ABC'[n]}`,
        pillars: arr(s.pillars)
          .map((y) => {
            const p = obj(y);
            const icon = IDEA_ICONS.includes(p.icon as IdeaIcon) ? (p.icon as IdeaIcon) : IDEA_ICONS[0];
            return {name: str(p.name, 60), icon, wants: arr(p.wants).map((w) => str(w, 300)).filter(Boolean), posts: arr(p.posts).map((w) => str(w, 300)).filter(Boolean).slice(0, 2), narrow: str(p.narrow, 300)};
          })
          .filter((p) => p.name),
        leftovers: arr(s.leftovers).map((w) => str(w, 300)).filter(Boolean),
      };
    })
    .filter((s) => s.pillars.length);
}

// 20 named problems and the ones it'd pick first.
export async function suggestProblems(pillars: string[] = []): Promise<{problems: string[]; top: string[]}> {
  const a = get();
  need(a.wants.some((w) => w.want), 'primero escribe lo que quiere tu audiencia');
  const answer = await ask(`${context(a)}

My Step 2 table (What they want | So I can… | So I can…):
${table(a)}
${pillars.length ? `\nMy pillars: ${pillars.join(', ')}\n` : ''}${a.problems.length ? `\nAlready on my list (don't repeat them): ${a.problems.join('; ')}\n` : ''}
The videos that reach the most people name something specific that a lot of my audience has. "Hard days" or "growing your account" is too vague, because nobody feels called out. Use the words people use before they've learned anything about my topic.

List 20 named problems or struggles my audience deals with, in the words they'd use before they've learned anything about my topic.

Every item must pass all of these checks:
- A name people use to describe themselves. Test: would a lot of my audience say "I have ___" or "I deal with ___"? Examples of the right level from different niches: "debilitating anxiety," "chronic back pain" (health), "stuck under 1,000 followers," "videos stuck at 200 views" (content creators), "can't lose the last 10 pounds" (fitness), "a toddler who won't sleep" (parenting). Use my niche, not these. You can add how bad or how long ("anxiety every single day"), but nothing more.
- Not too vague: words like "stress," "hard days," "struggling," or "growing" are too broad. Nobody feels called out.
- Not too situational: don't describe a scene or a moment (like "googling one symptom and losing the afternoon"). Those make great details inside a post, but they're too narrow to open a post with.
- Not too far along: if people only learn this term after researching my topic or following creators like me, it's too far along. Use the words they'd use before that ("anxiety every day," not "compulsive reassurance seeking").
- Common: a big part of my audience has it.

Rules:
- Use my audience's everyday words. No marketing language.
- Base them on my Step 2 table. Don't invent problems my audience doesn't have.
- Spread them across my pillars.
- Keep each one to a few words.

Then recommend your top picks (10 or so) from those 20.

Answer with a JSON object: {"problems": ["<20 items>"], "top": ["<your picks, exactly as written in problems>"]}.`);
  const o = obj(answer);
  const problems = [...new Set(arr(o.problems).map((x) => str(x, 200)).filter(Boolean))].slice(0, 20);
  return {problems, top: arr(o.top).map((x) => str(x, 200)).filter((x) => problems.includes(x))};
}

// What a person with each of the top 8 problems thinks at each level of awareness.
export async function suggestLevels(): Promise<AudienceLevels[]> {
  const a = get();
  const top = a.problems.slice(0, 8);
  need(top.length > 0, 'primero elige los problemas de tu audiencia');
  const answer = await ask(`${context(a)}

My Step 4 problems, most important first:
${top.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Take the top 8 problems from my Step 4 list. For each one, write what a person with that problem is thinking at each of these 4 levels:

1. Unaware: they have the problem but haven't named it yet. They think it's normal, just who they are, or they blame the wrong thing. This thought never names the problem.
2. Problem aware: they know they have the problem and say it in their own words, but they don't know why it's happening or how to fix it. This thought names the problem, but not a fix.
3. Solution aware: they're looking for a fix. This thought mentions a way to fix it, or asks "how do I..."
4. Product aware (ready to buy): they know me and what I sell. This thought is a question or doubt about me or my product before buying. If I don't sell anything yet, write a thought about trusting me as the person to learn from.

Example for one problem, "anxiety every day":
- Unaware: "I'm just a worrier. That's how I've always been."
- Problem aware: "I have anxiety every single day and I don't know why."
- Solution aware: "How do I calm my anxiety without medication?"
- Product aware: "Would this course actually help with my anxiety?"
Use my niche and my problems, not this example.

Rules:
- Write each thought in first person, the way my audience would text it to a friend. Short, casual, everyday words. No marketing language.
- Before you include a thought, ask: would a real person in my audience actually say this? If it sounds polished or like a marketer wrote it, rewrite it.
- Double check each thought is in the right level. An unaware thought never mentions the problem. A problem aware thought never mentions a fix.

Answer with a JSON array, one item per problem in the same order: [{"problem": "<exactly as in my list>", "unaware": "...", "problemAware": "...", "solutionAware": "...", "productAware": "..."}]. No quotation marks around the thoughts.`);
  // In the list's order: a model that retypes a problem (an accent, a capital) doesn't lose its row.
  return arr(answer).slice(0, top.length).map((x, i) => ({...levels(x), problem: top[i]}));
}

// For the agent's prompt (chat.ts): the offer, the product and the problems; the rest is in the file.
export function audienceText(rel: string): string {
  const a = get();
  const lines = [
    a.result && `- Promesa del canal: ayuda a ${a.who || '(público sin definir)'} a conseguir ${a.result}`,
    a.product.what ? `- Producto: ${a.product.what}${a.product.price ? ` (${a.product.price})` : ''}${a.product.problems ? `; resuelve: ${a.product.problems}` : ''}` : a.result && '- Producto: no vende nada todavía',
    a.problems.length && `- Problemas con nombre de su audiencia, los más importantes primero (abrir un video nombrando uno es lo que más alcance da; úsalos con estas palabras): ${a.problems.join('; ')}`,
    (a.wants.length || a.levels.length) && `- Lo que quiere su audiencia (con sus «para poder…») y lo que piensa en cada nivel de conciencia de esos problemas: ${rel}/audience.json (Perfil de audiencia). Léelo para ideas, ganchos y guiones.`,
  ].filter(Boolean);
  return lines.join('\n');
}
