// Ideas de contenido: each project's board of video ideas, in projects/<id>/ideas.json. Content verticals on top, and
// lists (states: Borrador, Listo para grabar…) holding cards in order, the order of the arrays. The page and the
// agent (tools/ideas.py) both come through here, one synchronous change at a time, and get the whole board back.
//
// A project is passed explicitly when the caller may be in another one than the open project: an agent keeps
// working in its own after he switches (its tool sends REEL_STUDIO_PROJECT). Lists and verticals can be named
// by id or by name, which is why their names are unique within the board; cards only by id.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {IDEA_COLORS, IDEA_ICONS, type Idea, type IdeaVertical, type IdeaColor, type IdeaIcon, type IdeaList, type IdeaRef, type IdeasBoard} from '../shared/types.ts';
import {readJson, writeJson} from './platform.ts';
import {norm} from './db.ts';
import {PROJECT, ROOT, listProjects} from './workspace.ts';

const DEFAULT_LISTS = ['Borrador', 'Descartado', 'Listo para grabar', 'Publicado'];

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), {status});
const newId = () => crypto.randomBytes(4).toString('hex');
// The id of what has none yet (the default lists, a hand-edited entry): the same on every read, since the file may
// not get written until the next change, and the page sends back the ids it was given.
const stableId = (seed: string) => crypto.createHash('md5').update(seed).digest('hex').slice(0, 8);
const idOf = (v: unknown, seed: string) => (typeof v === 'string' && v ? v : stableId(seed));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function fileOf(project?: string) {
  const id = project || PROJECT;
  if (!listProjects().some((p) => p.id === id)) throw bad(`no existe el proyecto «${id}»`, 404);
  return path.join(ROOT, 'projects', id, 'ideas.json');
}

// The file as the board, forgiving of hand edits: what can't be read as a card, list or vertical is left out.
// Verticals were first called categories, without a description: such a file is read as it is, and the next
// change writes it with the new names.
function clean(raw: Record<string, unknown>): IdeasBoard {
  const rawVerticals = raw.verticals ?? raw.categories;
  const verticals: IdeaVertical[] = (Array.isArray(rawVerticals) ? rawVerticals : []).filter(isObj).flatMap((c, i) => {
    if (typeof c.name !== 'string' || !c.name.trim()) return [];
    return [{id: idOf(c.id, c.name), name: c.name, description: typeof c.description === 'string' ? c.description : '', color: IDEA_COLORS.includes(c.color as IdeaColor) ? (c.color as IdeaColor) : IDEA_COLORS[i % IDEA_COLORS.length], icon: IDEA_ICONS.includes(c.icon as IdeaIcon) ? (c.icon as IdeaIcon) : IDEA_ICONS[0]}];
  });
  const known = new Set(verticals.map((c) => c.id));
  const card = (c: Record<string, unknown>): Idea[] => {
    if (typeof c.title !== 'string' || !c.title.trim()) return [];
    // Cards could first have several verticals (or categories): such a card keeps the first.
    const old = c.verticals ?? c.categories;
    const own = c.vertical !== undefined ? [c.vertical] : Array.isArray(old) ? old : [];
    return [
      {
        id: idOf(c.id, c.title),
        title: c.title,
        notes: typeof c.notes === 'string' ? c.notes : '',
        vertical: own.find((x): x is string => typeof x === 'string' && known.has(x)) ?? null,
        created: Number(c.created) || 0,
        updated: Number(c.updated) || 0,
      },
    ];
  };
  const lists: IdeaList[] = (Array.isArray(raw.lists) ? raw.lists : []).filter(isObj).flatMap((l) => {
    if (typeof l.name !== 'string' || !l.name.trim()) return [];
    return [{id: idOf(l.id, l.name), name: l.name, cards: (Array.isArray(l.cards) ? l.cards : []).filter(isObj).flatMap(card)}];
  });
  return {verticals, lists};
}

// The board. A project without a file starts with the default lists; a file that can't be read stops here, so
// the next change doesn't write an empty board over his ideas.
export function board(project?: string): IdeasBoard {
  const file = fileOf(project);
  if (!fs.existsSync(file)) return {verticals: [], lists: DEFAULT_LISTS.map((name) => ({id: stableId(name), name, cards: []}))};
  const raw = readJson<unknown>(file);
  if (!isObj(raw)) throw bad(`no se puede leer ${path.relative(ROOT, file)}: arréglalo o bórralo`, 500);
  return clean(raw);
}

function change(project: string | undefined, fn: (b: IdeasBoard) => void) {
  const b = board(project);
  fn(b);
  writeJson(fileOf(project), b);
  return b;
}

/* ───── Reading what comes in ───── */

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nameOf = (v: unknown, what: string) => {
  const n = text(v, 60).replace(/\s+/g, ' ');
  if (!n) throw bad(`ponle un nombre a la ${what}`);
  return n;
};
const titleOf = (v: unknown) => {
  const t = text(v, 300);
  if (!t) throw bad('la idea necesita un título');
  return t;
};
const colorOf = (v: unknown) => {
  if (!IDEA_COLORS.includes(v as IdeaColor)) throw bad(`color no válido: usa ${IDEA_COLORS.join(', ')}`);
  return v as IdeaColor;
};
const iconOf = (v: unknown) => {
  if (!IDEA_ICONS.includes(v as IdeaIcon)) throw bad(`icono no válido: usa ${IDEA_ICONS.join(', ')}`);
  return v as IdeaIcon;
};
// A list or vertical by its id or its name (without caring for accents or capitals).
function find<T extends {id: string; name: string}>(items: T[], ref: unknown, what: string) {
  const r = norm(String(ref ?? '').trim());
  const hit = items.find((i) => i.id === ref) ?? items.find((i) => norm(i.name) === r);
  if (!hit) throw bad(`no existe la ${what} «${String(ref)}». Hay: ${items.map((i) => i.name).join(', ') || 'ninguna'}`, 404);
  return hit;
}
const unique = (items: {id: string; name: string}[], name: string, what: string, self?: string) => {
  if (items.some((i) => i.id !== self && norm(i.name) === norm(name))) throw bad(`ya hay una ${what} «${name}»`, 409);
};
// A card's vertical: by id or name; null or nothing, none.
const verticalOf = (b: IdeasBoard, v: unknown) => (v === null || v === '' ? null : find(b.verticals, v, 'vertical').id);
function cardIn(b: IdeasBoard, id: string) {
  for (const list of b.lists) {
    const i = list.cards.findIndex((c) => c.id === id);
    if (i >= 0) return {list, i, card: list.cards[i]};
  }
  throw bad(`no existe la idea ${id}`, 404);
}
// Where something goes in an array: before the item with that id, first (top), or last.
function indexFor(items: {id: string}[], before: unknown, top: unknown, what: string) {
  if (top === true) return 0;
  if (before === undefined || before === null) return items.length;
  const i = items.findIndex((x) => x.id === before);
  if (i < 0) throw bad(`${what} «${String(before)}» no está ahí`);
  return i;
}

/* ───── Cards ───── */

export const addCard = (project: string | undefined, input: Record<string, unknown>) =>
  change(project, (b) => {
    if (!b.lists.length) throw bad('el tablero no tiene listas: crea una primero');
    const list = input.list === undefined || input.list === null ? b.lists[0] : find(b.lists, input.list, 'lista');
    const now = Date.now();
    const card: Idea = {id: newId(), title: titleOf(input.title), notes: text(input.notes, 20000), vertical: input.vertical === undefined ? null : verticalOf(b, input.vertical), created: now, updated: now};
    list.cards.splice(indexFor(list.cards, input.before, input.top, 'la idea'), 0, card);
  });

export const editCard = (project: string | undefined, id: string, input: Record<string, unknown>) =>
  change(project, (b) => {
    const {card} = cardIn(b, id);
    if (input.title !== undefined) card.title = titleOf(input.title);
    if (input.notes !== undefined) card.notes = text(input.notes, 20000);
    if (input.vertical !== undefined) card.vertical = verticalOf(b, input.vertical);
    card.updated = Date.now();
  });

// To another place, in its list or another one: before a card of that list, first (top), or last.
export const moveCard = (project: string | undefined, id: string, input: Record<string, unknown>) =>
  change(project, (b) => {
    const from = cardIn(b, id);
    const to = input.list === undefined || input.list === null ? from.list : find(b.lists, input.list, 'lista');
    if (input.before === id) return; // right before itself: it stays where it is
    const rest = to.cards.filter((c) => c.id !== id);
    const at = indexFor(rest, input.before, input.top, 'la idea');
    from.list.cards.splice(from.i, 1);
    to.cards.splice(at, 0, from.card);
    if (to !== from.list) from.card.updated = Date.now();
  });

export const removeCard = (project: string | undefined, id: string) =>
  change(project, (b) => {
    const {list, i} = cardIn(b, id);
    list.cards.splice(i, 1);
  });

/* ───── Lists ───── */

export const addList = (project: string | undefined, input: Record<string, unknown>) =>
  change(project, (b) => {
    const name = nameOf(input.name, 'lista');
    unique(b.lists, name, 'lista');
    const before = input.before === undefined || input.before === null ? null : find(b.lists, input.before, 'lista').id;
    b.lists.splice(indexFor(b.lists, before, input.top, 'la lista'), 0, {id: newId(), name, cards: []});
  });

export const renameList = (project: string | undefined, ref: string, nameIn: unknown) =>
  change(project, (b) => {
    const list = find(b.lists, ref, 'lista');
    const name = nameOf(nameIn, 'lista');
    unique(b.lists, name, 'lista', list.id);
    list.name = name;
  });

export const moveList = (project: string | undefined, ref: string, input: Record<string, unknown>) =>
  change(project, (b) => {
    const list = find(b.lists, ref, 'lista');
    const before = input.before === undefined || input.before === null ? null : find(b.lists, input.before, 'lista').id;
    if (before === list.id) return;
    const rest = b.lists.filter((l) => l !== list);
    rest.splice(indexFor(rest, before, input.top, 'la lista'), 0, list);
    b.lists = rest;
  });

// A list with cards goes only if the caller says what happens to them: moved to another list (moveTo), or deleted
// with it (withCards).
export const removeList = (project: string | undefined, ref: string, opts: {moveTo?: unknown; withCards?: boolean}) =>
  change(project, (b) => {
    const list = find(b.lists, ref, 'lista');
    if (opts.moveTo !== undefined) {
      const to = find(b.lists, opts.moveTo, 'lista');
      if (to === list) throw bad('elige otra lista para sus ideas');
      to.cards.push(...list.cards);
    } else if (list.cards.length && !opts.withCards) {
      throw bad(`«${list.name}» tiene ${list.cards.length} ${list.cards.length === 1 ? 'idea' : 'ideas'}: di a qué lista pasarlas o si se borran con ella`, 409);
    }
    b.lists = b.lists.filter((l) => l !== list);
  });

/* ───── Verticals ───── */

export const addVertical = (project: string | undefined, input: Record<string, unknown>) =>
  change(project, (b) => {
    const name = nameOf(input.name, 'vertical');
    unique(b.verticals, name, 'vertical');
    // Without a colour, the first one the board isn't using yet.
    const free = IDEA_COLORS.find((c) => !b.verticals.some((x) => x.color === c)) ?? IDEA_COLORS[b.verticals.length % IDEA_COLORS.length];
    b.verticals.push({id: newId(), name, description: text(input.description, 2000), color: input.color === undefined ? free : colorOf(input.color), icon: input.icon === undefined ? IDEA_ICONS[0] : iconOf(input.icon)});
  });

export const editVertical = (project: string | undefined, ref: string, input: Record<string, unknown>) =>
  change(project, (b) => {
    const vertical = find(b.verticals, ref, 'vertical');
    if (input.name !== undefined) {
      const name = nameOf(input.name, 'vertical');
      unique(b.verticals, name, 'vertical', vertical.id);
      vertical.name = name;
    }
    if (input.description !== undefined) vertical.description = text(input.description, 2000);
    if (input.color !== undefined) vertical.color = colorOf(input.color);
    if (input.icon !== undefined) vertical.icon = iconOf(input.icon);
  });

// The cards stay, without it.
export const removeVertical = (project: string | undefined, ref: string) =>
  change(project, (b) => {
    const {id} = find(b.verticals, ref, 'vertical');
    b.verticals = b.verticals.filter((c) => c.id !== id);
    for (const list of b.lists) for (const card of list.cards) if (card.vertical === id) card.vertical = null;
  });

/* ───── For the agent ───── */

// How the agent uses the board (run: the command that runs tools/ideas.py, see chat.ts).
// Ideas attached to a message of the general conversation: those still on the board, with the title they have now.
export function validIdeaRefs(refs: unknown): IdeaRef[] {
  if (!Array.isArray(refs)) return [];
  const cards = board().lists.flatMap((l) => l.cards);
  const ids = new Set(refs.map((r) => (r as IdeaRef | null)?.id));
  return cards.filter((c) => ids.has(c.id)).map((c) => ({id: c.id, title: c.title}));
}

export function ideaRefsText(refs: IdeaRef[]) {
  if (!refs.length) return '';
  const b = board();
  const lines = refs.flatMap((r) => {
    const list = b.lists.find((l) => l.cards.some((c) => c.id === r.id));
    const card = list?.cards.find((c) => c.id === r.id);
    if (!list || !card) return [];
    const vertical = b.verticals.find((v) => v.id === card.vertical);
    return [`- «${card.title}» (id ${card.id}) · lista: ${list.name} · vertical: ${vertical ? `${vertical.name} (${vertical.description || 'sin descripción'})` : 'ninguna'}\n  Notas: ${card.notes.trim() || '(sin notas)'}`];
  });
  return `Ideas de contenido que adjuntó a este mensaje, tal como están ahora en el tablero:\n${lines.join('\n')}`;
}

export const agentNote = (run: string) =>
  `Ideas de contenido (página del mismo nombre, debajo de Biblioteca; un tablero por proyecto, como Trello): verticales de contenido arriba (las líneas de contenido del canal, cada una con nombre, descripción e icono) y listas con tarjetas (por defecto Borrador, Descartado, Listo para grabar y Publicado). Puedes hacer todo lo que él hace ahí, siempre con ${run} (nunca editando ideas.json: la página no se enteraría): show (el tablero, con las descripciones de las verticales y los ids de las tarjetas; --json) · add "título" [--list L] [--notes "…"] [--vertical V] [--top] · edit <id> [--title "…"] [--notes "…"] [--vertical V] (una idea está en una sola vertical o en ninguna: --vertical reemplaza la que tenga; --vertical "" la quita) · move <id> [--list L] [--before <id>|--top] (sin posición, al final) · rm <id> · list add "nombre" [--before L] · list rename L "nombre" · list move L [--before M|--top] · list rm L [--to M|--with-cards] · vertical add "nombre" --description "…" --icon i [--color c] · vertical edit V [--name "…"] [--description "…"] [--icon i] [--color c] · vertical rm V (las tarjetas se quedan, sin ella). Listas y verticales van por nombre o id. Colores: ${IDEA_COLORS.join(', ')}. Iconos: ${IDEA_ICONS.join(', ')}. Una vertical se crea antes de usarla, con su descripción y el icono que mejor le vaya. Para crear o afinar ideas, sigue la skill content-ideas. Cuando propongas o clasifiques ideas, guíate por la descripción de cada vertical. Borra (tarjetas, listas con tarjetas) solo si te lo pidió.`;
