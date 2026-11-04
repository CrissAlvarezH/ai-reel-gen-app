// Suggest the structure tags of a script (audio/beats.json) with a quick one-off agent call.
import {agentCli} from './agent.ts';
import {httpError} from './reels.ts';
import {getProfile} from './config.ts';
import {BEAT_TAGS, type Beat, type BeatTag} from '../shared/types.ts';

const TAGGER = (lang: string) => [
  `Etiquetas la estructura del guion de un video explicativo narrado (vertical, en ${lang}). Cada línea es un bloque.`,
  'Etiquetas posibles:',
  '- hook: la primera frase, 0–3 s, lo que está en juego para quien mira.',
  '- contexto: la segunda frase o el planteamiento que responde al hook o sube lo que está en juego.',
  '- rehook: un giro que reengancha a mitad del video ("pero hay un problema", "y aquí viene lo bueno").',
  '- desarrollo: la explicación, cómo funciona.',
  '- ejemplo: un caso concreto, una analogía o una demostración.',
  '- payoff: la conclusión que cumple la promesa del hook.',
  '- cta: la llamada a la acción (seguir, guardar, comentar).',
  '- cierre: el remate final o la frase resumen.',
  'Responde SOLO con un array JSON con una etiqueta por línea, en el mismo orden y con la misma cantidad de líneas. Ejemplo: ["hook","contexto","desarrollo","desarrollo","payoff"].',
].join('\n');

const isTag = (t: unknown): t is BeatTag => (BEAT_TAGS as readonly unknown[]).includes(t);

export async function suggest(text: unknown): Promise<Beat[]> {
  if (typeof text !== 'string') throw httpError(400, 'falta el guion');
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) throw httpError(400, 'el guion está vacío');
  const reply = await agentCli.ask(lines.map((l, i) => `${i + 1}. ${l.trim()}`).join('\n'), TAGGER(getProfile().language));
  let tags: unknown;
  try {
    tags = JSON.parse(reply.match(/\[[\s\S]*\]/)?.[0] ?? '');
  } catch {
    throw httpError(502, `${agentCli.label} no devolvió etiquetas legibles; prueba otra vez`);
  }
  if (!Array.isArray(tags)) throw httpError(502, `${agentCli.label} no devolvió etiquetas legibles; prueba otra vez`);
  // A part starts where the tag changes; the lines after it belong to it.
  const out: Beat[] = [];
  lines.forEach((line, i) => {
    const t = tags[i];
    if (isTag(t) && t !== out.at(-1)?.tag) out.push({tag: t, line});
  });
  return out;
}
