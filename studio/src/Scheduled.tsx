// Publicaciones programadas: a month calendar of what the project's videos and carousels were sent to Instagram from
// here (Publicar), each on the day and hour it goes out (or went out), with its kind's icon, its title and whether it's
// out yet. One opens its details (cover, caption, state…) with a link to its page, where it can be moved or canceled;
// a day's number opens that day's list. The scheduled ones go out from the account, with this app closed.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowRight, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Loader2, TriangleAlert} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import EmptyState from '@/components/common/EmptyState';
import {api, useLive, type CalendarPublication} from './api';
import {MOVING, STATUS} from './Publish';
import {KIND, KindIcon, publicationHref} from './PublicationKind';
import {InstagramGlyph} from './Sidebar';
import {useStudio} from './studio';

// A week's least height: the day's number and a card.
const WEEK = '7rem';
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hourOf = (iso: string) => new Date(iso).toLocaleTimeString('es', {hour: '2-digit', minute: '2-digit'});
const longDay = (d: Date) => d.toLocaleDateString('es', {weekday: 'long', day: 'numeric', month: 'long'});
const count = (n: number) => `${n} ${n === 1 ? 'publicación' : 'publicaciones'}`;

// The weeks shown for a month: from the Monday on or before the 1st to the Sunday on or after its last day.
function weeksOf(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let d = start; d <= last || days.length % 7; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
  return days;
}

// The calendar last read in this window, shown at once when the page opens again while it's read anew. A project
// switch reloads the window, so it's always this project's.
let last: CalendarPublication[] | null = null;

export function Scheduled() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'scheduled'};
  const [items, setItems] = useState<CalendarPublication[] | null>(last);
  const [shown, setShown] = useState<CalendarPublication | null>(null); // its details' dialog
  const [day, setDay] = useState<Date | null>(null); // that day's list
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return {year: d.getFullYear(), month: d.getMonth()};
  });
  const load = useCallback(
    () =>
      api.calendar().then(
        (x) => ((last = x), setItems(x), setErr('')),
        (e: Error) => setErr(e.message),
      ),
    [],
  );
  useEffect(() => void load(), [load]);
  // The server answers with the files and asks the account in the background: what it learns rewrites a video's
  // publicaciones.json, and the watcher says so. Many changes at once (a render) are read once.
  const soon = useRef<number | undefined>(undefined);
  useLive(() => {
    clearTimeout(soon.current);
    soon.current = window.setTimeout(load, 300);
  });
  useEffect(() => () => clearTimeout(soon.current), []);
  // Fresh while one is on its way (seconds) or waiting for its hour (a minute).
  const moving = items?.some((p) => MOVING.has(p.status));
  const waiting = items?.some((p) => p.status === 'scheduled');
  useEffect(() => {
    if (!moving && !waiting) return;
    const t = setInterval(load, moving ? 4000 : 60_000);
    return () => clearInterval(t);
  }, [moving, waiting, load]);

  const days = useMemo(() => weeksOf(month.year, month.month), [month]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarPublication[]>();
    for (const p of items ?? []) {
      const k = dayKey(new Date(p.at));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [items]);
  const today = dayKey(new Date());
  const inMonth = (items ?? []).filter((p) => {
    const d = new Date(p.at);
    return d.getFullYear() === month.year && d.getMonth() === month.month;
  });
  const pending = (items ?? []).filter((p) => p.status === 'scheduled' && new Date(p.at).getTime() > Date.now());
  const label = new Date(month.year, month.month, 1).toLocaleDateString('es', {month: 'long', year: 'numeric'});
  const go = (n: number) => setMonth((m) => ({year: new Date(m.year, m.month + n, 1).getFullYear(), month: new Date(m.year, m.month + n, 1).getMonth()}));

  return (
    // At least as tall as the window (its column, md+): the weeks share that height, each at least WEEK; a shorter
    // window scrolls the page. A day with more videos than fit scrolls its list, under its fixed number.
    <main className="mx-auto flex max-w-7xl flex-col gap-5 p-6 md:min-h-[calc(100vh-3.5rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-medium first-letter:uppercase">{label}</h2>
        <span className="text-sm text-muted-foreground">
          {pending.length ? `${pending.length} por salir` : 'Nada por salir'}
          {inMonth.length ? ` · ${inMonth.length} este mes` : ''}
        </span>
        <Button variant="outline" size="sm" onClick={() => setMonth({year: new Date().getFullYear(), month: new Date().getMonth()})}>
          Hoy
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Mes anterior" onClick={() => go(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Mes siguiente" onClick={() => go(1)}>
          <ChevronRight />
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {DAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7" style={{gridTemplateRows: `repeat(${days.length / 7}, minmax(${WEEK}, 1fr))`}}>
          {days.map((d, i) => {
            const k = dayKey(d);
            const out = d.getMonth() !== month.month;
            const list = byDay.get(k) ?? [];
            return (
              <div key={k} className={cn('flex min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden border-b p-1.5 [contain:size]', i % 7 !== 6 && 'border-r', out && 'bg-muted/30', Math.floor(i / 7) === Math.floor((days.length - 1) / 7) && 'border-b-0')}>
                <button
                  type="button"
                  onClick={() => setDay(d)}
                  title={list.length ? `Ver ${list.length === 1 ? 'la publicación' : `las ${count(list.length)}`} del ${longDay(d)}` : longDay(d)}
                  aria-label={`${longDay(d)}: ${list.length ? count(list.length) : 'sin publicaciones'}`}
                  className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs transition-colors', k === today ? 'bg-primary font-semibold text-primary-foreground' : cn('hover:bg-muted hover:text-foreground', out ? 'text-muted-foreground/60' : 'text-muted-foreground'))}
                >
                  {d.getDate()}
                </button>
                {/* Only the publications scroll when they don't fit; the day's number stays. */}
                {!!list.length && (
                  <div className="-mx-1.5 -mb-1.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
                    {list.map((p) => (
                      <Item key={p.id} p={p} onOpen={() => setShown(p)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DayDialog day={day} items={day ? (byDay.get(dayKey(day)) ?? []) : []} onClose={() => setDay(null)} onOpen={(p) => (setDay(null), setShown(p))} />
      <DetailDialog p={shown} onClose={() => setShown(null)} />

      {items && !items.length && (
        <EmptyState icon={CalendarDays} className="rounded-lg py-8" title="Todavía no has programado ninguna publicación." description="Abre un video o un carrusel renderizado y pulsa Publicar → Programar: aparecerá aquí en su día." />
      )}
    </main>
  );
}

// How it's going, with Instagram's glyph: pink once it's out (as in the side panel), grey while it waits.
function State({p, className}: {p: CalendarPublication; className?: string}) {
  const s = STATUS[p.status];
  const done = p.status === 'published';
  return (
    <span className={cn('flex items-center gap-1 text-muted-foreground', p.status === 'error' && 'text-destructive', className)}>
      {MOVING.has(p.status) ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : p.status === 'error' ? <TriangleAlert className="size-3.5 shrink-0" /> : <InstagramGlyph className={cn('size-3.5 shrink-0', done ? 'text-pink-500' : 'text-muted-foreground/70')} />}
      <span className="truncate">{done ? 'Publicado' : p.status === 'scheduled' ? 'Programado' : s.label}</span>
    </span>
  );
}

// A video's still is 9:16; a carousel's first slide, 4:5.
const Cover = ({p, className}: {p: CalendarPublication; className?: string}) => {
  const Icon = (KIND[p.kind] ?? KIND.video).icon;
  return (
    <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md bg-muted', p.kind === 'carousel' ? 'aspect-[4/5]' : 'aspect-[9/16]', className)}>
      {p.cover ? <img src={p.cover} alt="" loading="lazy" className="size-full object-cover" /> : <Icon className="size-5 text-muted-foreground" />}
    </div>
  );
};

// A title led by its kind's icon, in the text's flow: a long title wraps under it.
const Title = ({p, className}: {p: CalendarPublication; className?: string}) => (
  <span className={className}>
    <KindIcon kind={p.kind} className="mr-1 size-[1.05em] align-[-0.2em] text-muted-foreground" />
    {p.title}
  </span>
);

// One publication in its day: its kind and title, and under it how it's going and its hour. Opens its details.
function Item({p, onOpen}: {p: CalendarPublication; onOpen: () => void}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={p.title}
      className={cn('flex min-w-0 shrink-0 flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-left transition-colors hover:bg-muted/60', p.status === 'error' && 'border-destructive/60')}
    >
      <Title p={p} className="line-clamp-2 text-xs leading-snug font-medium" />
      <span className="flex min-w-0 items-center gap-1 text-[11px]">
        <State p={p} className="min-w-0" />
        <span className="ml-auto shrink-0 text-muted-foreground">{hourOf(p.at)}</span>
      </span>
    </button>
  );
}

// A day's publications, each with its cover, kind, state, hour and the start of its caption; one opens its details.
function DayDialog({day, items, onClose, onOpen}: {day: Date | null; items: CalendarPublication[]; onClose: () => void; onOpen: (p: CalendarPublication) => void}) {
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="first-letter:uppercase">{day ? longDay(day) : ''}</DialogTitle>
          <DialogDescription>{items.length ? `${count(items.length)} este día.` : 'No hay publicaciones este día. Prográmalas desde la página de cada video o carrusel con Publicar.'}</DialogDescription>
        </DialogHeader>
        {!!items.length && (
          <ul className="-mx-2 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {items.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p)} className="flex w-full gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/60">
                  <Cover p={p} className="w-14" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <Title p={p} className="line-clamp-2 text-sm font-medium" />
                    <span className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{hourOf(p.at)}</span>
                      <State p={p} />
                    </span>
                    {p.caption && <span className="line-clamp-2 text-xs text-muted-foreground">{p.caption}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One publication: cover, title, state and when, version and account, its caption, and the way to it.
function DetailDialog({p, onClose}: {p: CalendarPublication | null; onClose: () => void}) {
  const s = p ? STATUS[p.status] : null;
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {p && s && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">
                <Title p={p} />
              </DialogTitle>
              <DialogDescription className="sr-only">Detalles de la publicación</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Cover p={p} className="w-36 self-center sm:self-start" />
              <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <State p={p} />
                  </Badge>
                  <span className="text-muted-foreground first-letter:uppercase">
                    {p.status === 'published' ? 'Salió el ' : p.status === 'scheduled' ? 'Sale el ' : ''}
                    {longDay(new Date(p.at))}, {hourOf(p.at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Versión {p.version} · @{p.account}
                </p>
                {p.error && <p className="text-sm text-destructive">{p.error}</p>}
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Caption</span>
                  {p.caption ? <p className="max-h-60 overflow-y-auto rounded-md bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap">{p.caption}</p> : <p className="text-xs text-muted-foreground">Sin caption.</p>}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              {p.permalink && (
                <Button asChild variant="outline">
                  <a href={p.permalink} target="_blank" rel="noreferrer">
                    <ExternalLink /> Ver en Instagram
                  </a>
                </Button>
              )}
              <Button asChild>
                <a href={publicationHref(p.kind, p.slug)} onClick={onClose}>
                  {p.kind === 'carousel' ? 'Ir al carrusel' : 'Ir al video'} <ArrowRight />
                </a>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
