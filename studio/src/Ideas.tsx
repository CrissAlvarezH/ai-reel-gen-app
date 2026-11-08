import {useCallback, useEffect, useRef, useState} from 'react';
import {BookOpen, Bot, Brain, Briefcase, Camera, ChevronDown, Clapperboard, Code, Cpu, Dumbbell, Flame, FlaskConical, Gamepad2, Globe, GraduationCap, Heart, HeartPulse, House, Landmark, Leaf, Lightbulb, Megaphone, MessageCircle, MessageSquarePlus, Mic, MoreHorizontal, Music, Newspaper, Palette, PenTool, Pencil, PiggyBank, Plane, Plus, Rocket, Scale, Settings2, Shield, Sparkles, Star, Target, Trash2, TrendingUp, Trophy, Users, Utensils, Wallet, type LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import BoardSkeleton from '@/components/common/BoardSkeleton';
import {IDEA_COLORS, IDEA_ICONS} from '../shared/types';
import {ideasApi, useSocket, type Idea, type IdeaVertical, type IdeaColor, type IdeaIcon, type IdeaList, type IdeasBoard} from './api';
import {useConfirm} from './confirm';
import {projectKey, read, useStudio, write} from './studio';

// Ideas de contenido: the project's board of video ideas (server/ideas.ts). Content verticals on top, as cards that
// also filter the board; below, lists of cards, like Trello. Cards move within a list and between lists, and lists among
// themselves, by dragging (the browser's own drag and drop). The agent changes the same board (tools/ideas.py): the
// server announces every change and the page reloads it.

// Whole class names, for Tailwind to find them.
export const COLORS: Record<IdeaColor, {badge: string; dot: string; page: string}> = {
  blue: {badge: 'border-blue-500/30 bg-blue-500/15 text-blue-300', dot: 'bg-blue-400', page: 'var(--color-blue-400)'},
  green: {badge: 'border-green-500/30 bg-green-500/15 text-green-300', dot: 'bg-green-400', page: 'var(--color-green-400)'},
  amber: {badge: 'border-amber-500/30 bg-amber-500/15 text-amber-300', dot: 'bg-amber-400', page: 'var(--color-amber-400)'},
  pink: {badge: 'border-pink-500/30 bg-pink-500/15 text-pink-300', dot: 'bg-pink-400', page: 'var(--color-pink-400)'},
  violet: {badge: 'border-violet-500/30 bg-violet-500/15 text-violet-300', dot: 'bg-violet-400', page: 'var(--color-violet-400)'},
  teal: {badge: 'border-teal-500/30 bg-teal-500/15 text-teal-300', dot: 'bg-teal-400', page: 'var(--color-teal-400)'},
  orange: {badge: 'border-orange-500/30 bg-orange-500/15 text-orange-300', dot: 'bg-orange-400', page: 'var(--color-orange-400)'},
  red: {badge: 'border-red-500/30 bg-red-500/15 text-red-300', dot: 'bg-red-400', page: 'var(--color-red-400)'},
  gray: {badge: 'border-zinc-500/30 bg-zinc-500/15 text-zinc-300', dot: 'bg-zinc-400', page: 'var(--color-zinc-400)'},
};

export const ICONS: Record<IdeaIcon, LucideIcon> = {
  'lightbulb': Lightbulb,
  'wallet': Wallet,
  'piggy-bank': PiggyBank,
  'trending-up': TrendingUp,
  'landmark': Landmark,
  'briefcase': Briefcase,
  'rocket': Rocket,
  'code': Code,
  'cpu': Cpu,
  'bot': Bot,
  'shield': Shield,
  'globe': Globe,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  'brain': Brain,
  'flask-conical': FlaskConical,
  'heart': Heart,
  'heart-pulse': HeartPulse,
  'dumbbell': Dumbbell,
  'utensils': Utensils,
  'plane': Plane,
  'house': House,
  'leaf': Leaf,
  'camera': Camera,
  'clapperboard': Clapperboard,
  'mic': Mic,
  'music': Music,
  'gamepad-2': Gamepad2,
  'palette': Palette,
  'pen-tool': PenTool,
  'megaphone': Megaphone,
  'users': Users,
  'message-circle': MessageCircle,
  'newspaper': Newspaper,
  'scale': Scale,
  'sparkles': Sparkles,
  'flame': Flame,
  'star': Star,
  'target': Target,
  'trophy': Trophy,
};

function VerticalIcon({icon, className}: {icon: IdeaIcon; className?: string}) {
  const Icon = ICONS[icon] ?? Lightbulb;
  return <Icon className={cn('flex-none', className)} aria-hidden />;
}

const VERTICAL_BADGE = 'inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap';

/* ───── Dragging ───── */

type Drag = {kind: 'card' | 'list'; id: string};
// Where the drop would land: in front of `before` (null: last), in a list for a card, on the board for a list.
type Over = {kind: 'card'; list: string; before: string | null} | {kind: 'list'; before: string | null};
// The browser's drag data: its own type, so dropping on the chat's message box doesn't type anything in it.
const DRAG_TYPE = 'application/x-reel-studio-idea';

// The item the pointer is in front of, by the middle of each one on that axis; null: past the last.
function itemAt(container: HTMLElement, selector: string, dragged: string, pos: number, axis: 'x' | 'y') {
  for (const el of container.querySelectorAll<HTMLElement>(selector)) {
    if (el.dataset.id === dragged) continue;
    const r = el.getBoundingClientRect();
    if (pos < (axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2)) return el.dataset.id!;
  }
  return null;
}

// Whether landing there leaves the item where it already is.
function staysPut(items: {id: string}[], id: string, before: string | null) {
  const i = items.findIndex((x) => x.id === id);
  return i >= 0 && (before === null ? i === items.length - 1 : items[i + 1]?.id === before);
}

function movedCard(b: IdeasBoard, id: string, to: string, before: string | null): IdeasBoard {
  const card = b.lists.flatMap((l) => l.cards).find((c) => c.id === id);
  if (!card) return b;
  return {
    ...b,
    lists: b.lists.map((l) => {
      const cards = l.cards.filter((c) => c.id !== id);
      if (l.id === to) cards.splice(before === null ? cards.length : cards.findIndex((c) => c.id === before), 0, card);
      return {...l, cards};
    }),
  };
}

function movedList(b: IdeasBoard, id: string, before: string | null): IdeasBoard {
  const list = b.lists.find((l) => l.id === id);
  if (!list) return b;
  const lists = b.lists.filter((l) => l.id !== id);
  lists.splice(before === null ? lists.length : lists.findIndex((l) => l.id === before), 0, list);
  return {...b, lists};
}

// A mouse's wheel only turns up and down, and that alone doesn't move a board that scrolls sideways. Over a list that
// has cards to scroll, the wheel is that list's, even at its end, so reaching it doesn't throw the board sideways.
function wheelSideways(e: React.WheelEvent<HTMLElement>) {
  const target = e.target as Element;
  if (!e.currentTarget.contains(target)) return; // a list's menu, in a portal
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.shiftKey) return; // already sideways: the browser's
  const list = target.closest('[data-list]')?.querySelector<HTMLElement>('[data-cards]');
  if (list && list.scrollHeight > list.clientHeight) return;
  e.currentTarget.scrollLeft += e.deltaY;
}

/* ───── The page ───── */

export function Ideas() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'ideas'};
  const confirm = useConfirm();
  const [board, setBoard] = useState<IdeasBoard | null>(null);
  const [err, setErr] = useState('');
  // The vertical selected stays selected, per project: a choice of this window, like the panel's width, so in
  // localStorage. Not in ideas.json (the board, shared with the agent), nor in the index (rebuilt from the files).
  const selectedKey = projectKey('studio.ideas.vertical');
  const [filter, setFilterState] = useState<string | null>(() => read(selectedKey, '') || null);
  const setFilter = (id: string | null) => {
    setFilterState(id);
    write(selectedKey, id ?? '');
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [verticalDialog, setVerticalDialog] = useState<IdeaVertical | 'new' | null>(null);

  // Only the answer to the last request counts: an older one would undo a move just made on the page.
  const last = useRef(0);
  const apply = useCallback(async (request: () => Promise<IdeasBoard>) => {
    const seq = ++last.current;
    try {
      const b = await request();
      if (seq === last.current) {
        setBoard(b);
        setErr('');
      }
    } catch (e) {
      if (seq !== last.current) return;
      setErr((e as Error).message);
      // Whatever the page assumed (a move shown before the server answered) goes back to what's there.
      ideasApi.board().then((b) => seq === last.current && setBoard(b), () => {});
    }
  }, []);
  const load = useCallback(() => void apply(ideasApi.board), [apply]);
  useEffect(load, [load]);
  useSocket((m) => m.type === 'ideas' && load(), load);

  // A vertical the agent deleted stops filtering.
  useEffect(() => {
    if (board && filter && !board.verticals.some((c) => c.id === filter)) setFilter(null);
  }, [board, filter]);

  if (!board) return err ? <main className="p-6"><p className="text-destructive">{err}</p></main> : <BoardSkeleton />;

  // The vertical being filtered: the page around the lists takes its colour (.vertical-page and .vertical-theme in index.css).
  const active = board.verticals.find((v) => v.id === filter);
  const editing = board.lists.flatMap((l) => l.cards).find((c) => c.id === openCard);

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };
  const startDrag = (e: React.DragEvent, d: Drag) => {
    e.dataTransfer.setData(DRAG_TYPE, d.id);
    e.dataTransfer.effectAllowed = 'move';
    // After this event: changing the page during it can cancel the drag.
    setTimeout(() => setDrag(d));
  };
  const overList = (e: React.DragEvent<HTMLElement>, list: string) => {
    if (drag?.kind !== 'card') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = itemAt(e.currentTarget, '[data-card]', drag.id, e.clientY, 'y');
    if (over?.kind !== 'card' || over.list !== list || over.before !== before) setOver({kind: 'card', list, before});
  };
  const overBoard = (e: React.DragEvent<HTMLElement>) => {
    if (drag?.kind !== 'list') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = itemAt(e.currentTarget, '[data-list]', drag.id, e.clientX, 'x');
    if (over?.kind !== 'list' || over.before !== before) setOver({kind: 'list', before});
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    const o = over;
    endDrag();
    if (!d || !o) return;
    if (d.kind === 'card' && o.kind === 'card') {
      const target = board.lists.find((l) => l.id === o.list);
      if (!target || staysPut(target.cards, d.id, o.before)) return;
      setBoard(movedCard(board, d.id, o.list, o.before));
      void apply(() => ideasApi.moveCard(d.id, o.list, o.before));
    }
    if (d.kind === 'list' && o.kind === 'list' && !staysPut(board.lists, d.id, o.before)) {
      setBoard(movedList(board, d.id, o.before));
      void apply(() => ideasApi.moveList(d.id, o.before));
    }
  };

  const removeList = async (list: IdeaList) => {
    const n = list.cards.length;
    const ok =
      !n ||
      (await confirm({
        title: `¿Eliminar la lista «${list.name}»?`,
        description: `Se ${n === 1 ? 'borra 1 idea' : `borran ${n} ideas`} con ella. Si quieres conservar${n === 1 ? 'la' : 'las'}, pása${n === 1 ? 'la' : 'las'} antes a otra lista.`,
        action: 'Eliminar',
        destructive: true,
      }));
    if (ok) void apply(() => ideasApi.removeList(list.id));
  };

  const listLine = over?.kind === 'list' && drag?.kind === 'list' && !staysPut(board.lists, drag.id, over.before) ? over.before : undefined;
  return (
    <main className={cn('flex min-h-full flex-col gap-4 p-6 transition-colors md:h-full', active && 'vertical-page')} style={active ? ({'--vertical': COLORS[active.color].page} as React.CSSProperties) : undefined}>
      <section aria-label="Verticales de contenido" className={cn('flex flex-none flex-col gap-1.5', active && 'vertical-theme')}>
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Verticales de contenido</h2>
        <div className="visible-scroll flex gap-2 overflow-x-auto pb-1" onWheel={wheelSideways}>
          {board.verticals.map((v) => (
            <VerticalCard key={v.id} vertical={v} active={filter === v.id} dimmed={!!filter && filter !== v.id} onToggle={() => setFilter(filter === v.id ? null : v.id)} onEdit={() => setVerticalDialog(v)} />
          ))}
          <button onClick={() => setVerticalDialog('new')} className="flex min-h-[42px] flex-none items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
            <Plus className="size-4" /> Vertical
          </button>
        </div>
      </section>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="visible-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2" onWheel={wheelSideways} onDragOver={overBoard} onDrop={drop}>
        {board.lists.map((list) => (
          <div key={list.id} data-list data-id={list.id} className="relative flex w-72 flex-none">
            {listLine === list.id && <span className="absolute inset-y-0 -left-[7px] w-0.5 rounded bg-primary" />}
            <Column
              list={list}
              board={board}
              filter={filter}
              drag={drag}
              over={over?.kind === 'card' && over.list === list.id ? over : null}
              onDragOver={(e) => overList(e, list.id)}
              onStartDrag={startDrag}
              onEndDrag={endDrag}
              onOpenCard={setOpenCard}
              onAddCard={(title) => apply(() => ideasApi.addCard({title, list: list.id, vertical: filter}))}
              onRename={(name) => apply(() => ideasApi.renameList(list.id, name))}
              onRemove={() => removeList(list)}
            />
          </div>
        ))}
        <div className="relative w-72 flex-none">
          {listLine === null && <span className="absolute inset-y-0 -left-[7px] w-0.5 rounded bg-primary" />}
          <AddList onAdd={(name) => apply(() => ideasApi.addList(name))} />
        </div>
      </div>

      {editing && <CardDialog key={editing.id} card={editing} board={board} onClose={() => setOpenCard(null)} apply={apply} />}
      {verticalDialog && <VerticalDialog key={verticalDialog === 'new' ? 'new' : verticalDialog.id} vertical={verticalDialog === 'new' ? null : verticalDialog} board={board} onClose={() => setVerticalDialog(null)} apply={apply} />}
    </main>
  );
}

/* ───── Verticals ───── */

// Its icon and name. Clicking it filters the board; its description shows on hover. Editing it: once selected, on hover.
function VerticalCard({vertical: v, active, dimmed, onToggle, onEdit}: {vertical: IdeaVertical; active: boolean; dimmed: boolean; onToggle: () => void; onEdit: () => void}) {
  return (
    <div className={cn('group relative max-w-72 min-w-0 flex-none rounded-lg border transition-opacity', COLORS[v.color].badge, active && 'ring-2 ring-foreground/40 ring-inset', dimmed && 'opacity-50 hover:opacity-100')}>
      <button onClick={onToggle} aria-pressed={active} title={v.description || undefined} className="flex size-full items-center gap-2 rounded-lg py-2 pr-9 pl-3 text-left">
        <VerticalIcon icon={v.icon} className="size-6" />
        <span className="truncate text-sm font-medium">{v.name}</span>
      </button>
      {active && (
        <button onClick={onEdit} aria-label={`Editar la vertical ${v.name}`} title="Editar la vertical" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background/40 focus-visible:opacity-100">
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function VerticalDialog({vertical, board, onClose, apply}: {vertical: IdeaVertical | null; board: IdeasBoard; onClose: () => void; apply: (r: () => Promise<IdeasBoard>) => Promise<void>}) {
  const confirm = useConfirm();
  const [name, setName] = useState(vertical?.name ?? '');
  const [description, setDescription] = useState(vertical?.description ?? '');
  // A new one starts with the first colour the board isn't using.
  const [color, setColor] = useState<IdeaColor>(vertical?.color ?? IDEA_COLORS.find((x) => !board.verticals.some((c) => c.color === x)) ?? IDEA_COLORS[0]);
  const [icon, setIcon] = useState<IdeaIcon>(vertical?.icon ?? IDEA_ICONS[0]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await apply(() => (vertical ? ideasApi.editVertical(vertical.id, {name, description, color, icon}) : ideasApi.addVertical({name, description, color, icon})));
    onClose();
  };
  const remove = async () => {
    if (!vertical) return;
    const n = board.lists.flatMap((l) => l.cards).filter((c) => c.vertical === vertical.id).length;
    if (n && !(await confirm({title: `¿Eliminar la vertical «${vertical.name}»?`, description: `${n === 1 ? 'La idea que la tiene se queda' : `Las ${n} ideas que la tienen se quedan`}, sin ella.`, action: 'Eliminar', destructive: true}))) return;
    await apply(() => ideasApi.removeVertical(vertical.id));
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vertical ? 'Editar vertical de contenido' : 'Nueva vertical de contenido'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="idea-vertical-name">Nombre</Label>
            <Input id="idea-vertical-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="idea-vertical-description">Descripción</Label>
            <Textarea id="idea-vertical-description" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="De qué va esta línea de contenido: temas, público, enfoque…" className="max-h-48" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Icono</Label>
            <div className="visible-scroll grid max-h-40 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto">
              {IDEA_ICONS.map((x) => (
                <button key={x} type="button" aria-label={x} title={x} aria-pressed={icon === x} onClick={() => setIcon(x)} className={cn('grid size-9 place-items-center rounded-md border transition-colors', icon === x ? COLORS[color].badge : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  <VerticalIcon icon={x} className="size-4" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {IDEA_COLORS.map((x) => (
                <button key={x} type="button" aria-label={x} aria-pressed={color === x} onClick={() => setColor(x)} className={cn('size-6 rounded-full transition-transform hover:scale-110', COLORS[x].dot, color === x && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover')} />
              ))}
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {vertical ? (
              <Button type="button" variant="ghost" onClick={remove} className="text-destructive hover:text-destructive">
                <Trash2 /> Eliminar
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!name.trim()}>
              {vertical ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ───── A list ───── */

function Column(p: {
  list: IdeaList;
  board: IdeasBoard;
  filter: string | null;
  drag: Drag | null;
  over: Extract<Over, {kind: 'card'}> | null;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onStartDrag: (e: React.DragEvent, d: Drag) => void;
  onEndDrag: () => void;
  onOpenCard: (id: string) => void;
  onAddCard: (title: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onRemove: () => void;
}) {
  const {list, board, filter, drag, over} = p;
  const [renaming, setRenaming] = useState(false);
  const cards = filter ? list.cards.filter((c) => c.vertical === filter) : list.cards;
  // The line that says where the card would land, unless that's where it already is.
  const line = over && drag?.kind === 'card' && !staysPut(list.cards, drag.id, over.before) ? over.before : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <section
      onDragOver={p.onDragOver}
      className={cn('flex min-w-0 flex-1 flex-col rounded-xl border bg-[color-mix(in_oklab,var(--card)_40%,var(--background))] transition-opacity', drag?.kind === 'list' && drag.id === list.id && 'opacity-40', over && 'border-foreground/20')}
    >
      <header
        draggable={!renaming}
        onDragStart={(e) => p.onStartDrag(e, {kind: 'list', id: list.id})}
        onDragEnd={p.onEndDrag}
        className={cn('flex items-center gap-2 px-3 pt-2.5 pb-1.5', !renaming && 'cursor-grab active:cursor-grabbing')}
      >
        {renaming ? (
          <InlineName
            initial={list.name}
            label="Nombre de la lista"
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== list.name) void p.onRename(name);
            }}
          />
        ) : (
          <h2 onDoubleClick={() => setRenaming(true)} className="min-w-0 flex-1 truncate text-sm font-medium" title={list.name}>
            {list.name}
          </h2>
        )}
        <span className="flex-none text-xs text-muted-foreground tabular-nums">{filter ? `${cards.length}/${list.cards.length}` : list.cards.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Opciones de la lista ${list.name}`} className="-mr-1 flex-none rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil /> Renombrar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={p.onRemove}>
              <Trash2 /> Eliminar lista
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div ref={scroller} data-cards className="visible-scroll flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain px-2 py-1.5">
        {cards.map((card, i) => (
          <Card
            key={card.id}
            card={card}
            verticals={filter ? [] : board.verticals} // filtered, they'd all repeat the same tag
            dragging={drag?.kind === 'card' && drag.id === card.id}
            lineAbove={line === card.id}
            lineBelow={line === null && i === cards.length - 1}
            onOpen={() => p.onOpenCard(card.id)}
            onDragStart={(e) => p.onStartDrag(e, {kind: 'card', id: card.id})}
            onDragEnd={p.onEndDrag}
          />
        ))}
        {!cards.length && line === null && <span className="h-0.5 flex-none rounded bg-primary" />}
      </div>

      <div className="p-2 pt-1">
        <AddCard onAdd={p.onAddCard} afterAdd={() => scroller.current?.scrollTo({top: scroller.current.scrollHeight})} />
      </div>
    </section>
  );
}

function Card({card, verticals, dragging, lineAbove, lineBelow, onOpen, onDragStart, onDragEnd}: {card: Idea; verticals: IdeaVertical[]; dragging: boolean; lineAbove: boolean; lineBelow: boolean; onOpen: () => void; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void}) {
  const own = verticals.find((v) => v.id === card.vertical);
  return (
    <div className="relative flex-none">
      {lineAbove && <span className="absolute inset-x-0 -top-[5px] h-0.5 rounded bg-primary" />}
      {lineBelow && <span className="absolute inset-x-0 -bottom-[5px] h-0.5 rounded bg-primary" />}
      <div
        data-card
        data-id={card.id}
        role="button"
        tabIndex={0}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn('flex cursor-grab flex-col gap-1.5 rounded-lg border bg-card p-2.5 transition-colors hover:border-foreground/30 active:cursor-grabbing', dragging && 'opacity-40')}
      >
        {own && (
          <span className={cn('inline-flex h-4 w-fit max-w-full items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium whitespace-nowrap', COLORS[own.color].badge)}>
            <VerticalIcon icon={own.icon} className="size-2.5" />
            <span className="truncate">{own.name}</span>
          </span>
        )}
        <p className="text-sm break-words">{card.title}</p>
        {card.notes && <p className="line-clamp-3 text-xs break-words whitespace-pre-line text-muted-foreground">{card.notes}</p>}
      </div>
    </div>
  );
}

const typing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing;

// The name being edited in place: Enter or leaving it saves, Esc cancels (onDone with nothing).
function InlineName({initial, label, onDone}: {initial: string; label: string; onDone: (name: string) => void}) {
  const [name, setName] = useState(initial);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v.trim());
  };
  return (
    <Input
      autoFocus
      aria-label={label}
      maxLength={60}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(name)}
      onKeyDown={(e) => {
        if (typing(e)) return;
        if (e.key === 'Enter') finish(name);
        if (e.key === 'Escape') finish('');
      }}
      className="h-7 min-w-0 flex-1 px-2 text-sm"
    />
  );
}

// At the foot of a list: Enter adds the idea and stays open for the next one; Esc closes.
function AddCard({onAdd, afterAdd}: {onAdd: (title: string) => Promise<void>; afterAdd: () => void}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const cancelled = useRef(false);
  if (!open)
    return (
      <button
        onClick={() => {
          cancelled.current = false;
          setOpen(true);
        }}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <Plus className="size-4" /> Añadir idea
      </button>
    );
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    await onAdd(t);
    afterAdd();
  };
  return (
    <Input
      autoFocus
      aria-label="Título de la idea"
      placeholder="Título de la idea"
      maxLength={300}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => {
        if (!cancelled.current) void add();
        setOpen(false);
      }}
      onKeyDown={(e) => {
        if (typing(e)) return;
        if (e.key === 'Enter') void add();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setTitle('');
          setOpen(false);
        }
      }}
      className="h-8 text-sm"
    />
  );
}

function AddList({onAdd}: {onAdd: (name: string) => Promise<void>}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-1.5 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
        <Plus className="size-4" /> Añadir lista
      </button>
    );
  return (
    <div className="flex rounded-xl border bg-card/40 p-2">
      <InlineName
        initial=""
        label="Nombre de la lista"
        onDone={(name) => {
          setOpen(false);
          if (name) void onAdd(name);
        }}
      />
    </div>
  );
}

/* ───── A card, open ───── */

function CardDialog({card, board, onClose, apply}: {card: Idea; board: IdeasBoard; onClose: () => void; apply: (r: () => Promise<IdeasBoard>) => Promise<void>}) {
  const confirm = useConfirm();
  const current = board.lists.find((l) => l.cards.some((c) => c.id === card.id));
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [vertical, setVertical] = useState(card.vertical);
  const [list, setList] = useState(current?.id ?? '');
  const {ideaRefs, addIdeaRef, removeIdeaRef} = useStudio();
  const attached = ideaRefs.some((r) => r.id === card.id);
  const persist = () =>
    apply(async () => {
      const edited = await ideasApi.editCard(card.id, {title, notes, vertical});
      return list && list !== current?.id ? ideasApi.moveCard(card.id, list, null) : edited;
    });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await persist();
    onClose();
  };
  // Goes as it reads here: the agent gets the board's version, so what's unsaved is saved first.
  const attach = async () => {
    if (!title.trim()) return;
    if (title !== card.title || notes !== card.notes || vertical !== card.vertical || list !== current?.id) await persist();
    addIdeaRef({id: card.id, title: title.trim()});
    onClose();
  };
  const remove = async () => {
    if (!(await confirm({title: '¿Eliminar esta idea?', description: `«${card.title}»`, action: 'Eliminar', destructive: true}))) return;
    await apply(() => ideasApi.removeCard(card.id));
    removeIdeaRef(card.id);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Idea</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="idea-title">Título</Label>
            <Input id="idea-title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="idea-notes">Notas</Label>
            <Textarea id="idea-notes" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="El ángulo, el gancho, referencias…" className="max-h-72" />
          </div>
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50">
              <Settings2 className="size-4 text-muted-foreground" />
              Configuración
              <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 border-t p-3">
              {board.verticals.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>Vertical</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {board.verticals.map((c) => {
                      const on = vertical === c.id;
                      return (
                        <button key={c.id} type="button" aria-pressed={on} onClick={() => setVertical(on ? null : c.id)} className={cn(VERTICAL_BADGE, 'gap-1.5 transition-opacity', COLORS[c.color].badge, !on && 'opacity-40 hover:opacity-70')}>
                          <VerticalIcon icon={c.icon} className="size-3" />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label>Lista</Label>
                <Select value={list} onValueChange={setList}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {board.lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" onClick={remove} className="self-start text-destructive hover:text-destructive">
                <Trash2 /> Eliminar idea
              </Button>
            </CollapsibleContent>
          </Collapsible>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="secondary" disabled={attached || !title.trim()} onClick={attach} title="Añádela a tu próximo mensaje de la conversación general">
              <MessageSquarePlus /> {attached ? 'En tu próximo mensaje' : 'Adjuntar al chat'}
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
