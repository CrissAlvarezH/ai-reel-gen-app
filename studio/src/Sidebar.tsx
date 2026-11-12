import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertCircle, CalendarClock, CalendarDays, Circle, CircleDot, LayoutGrid, Lightbulb, Loader2, MessageCircleQuestion, Newspaper, Palette, Plus, ShieldCheck, Sparkles, Target, Telescope, UserRound} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {agentsApi, api, fmtAgo, useAgentId, useSocket, type Agent, type AgentState, type ProgressStep, type ReelSummary} from './api';
import {ReelProgressRing} from './ReelProgress';
import {AgentLogo} from './AgentLogo';
import {useStudio, type UiContext} from './studio';
import {KIND, KindIcon, publicationHref} from './PublicationKind';
import {NewPublicationMenu} from './NewPublicationMenu';
import {ProjectPicker} from './ProjectPicker';
import {SidebarAccount} from './SidebarAccount';

type Page = UiContext['page'];

// Left sidebar: every publication's agent (videos and carousels) in one list, most recent first; the icons on the
// left say its state and what it is. The library's general conversation shows its state next to "Biblioteca".
// Contracted (⌘B or the header's button, studio.tsx), it's a column of icons: the project, the pages and each
// publication's state, named on hover.

const STATE_LABEL: Record<AgentState, string> = {
  working: 'Trabajando',
  needs: 'Te hizo una pregunta',
  review: 'Terminó, sin ver todavía',
  error: 'Con error',
  idle: 'Terminado',
  new: 'Sin conversación todavía',
};

function StateIcon({state}: {state: AgentState}) {
  return (
    <span title={STATE_LABEL[state]} className="flex flex-none">
      <StateGlyph state={state} />
    </span>
  );
}

function StateGlyph({state}: {state: AgentState}) {
  switch (state) {
    case 'working':
      return <Loader2 className="size-4 animate-spin text-foreground" />;
    case 'needs':
      return <MessageCircleQuestion className="size-4 text-amber-400" />;
    case 'review':
      return <CircleDot className="size-4 text-sky-400" />;
    case 'error':
      return <AlertCircle className="size-4 text-destructive" />;
    case 'idle':
      return <Circle className="size-4 text-muted-foreground" />;
    default:
      return <Circle className="size-4 text-muted-foreground/40" strokeDasharray="3 3" />;
  }
}

function subtitle(a: Agent, st: AgentState) {
  if (a.state === 'working') return a.tool ?? 'pensando…';
  if (a.state === 'error') return a.error ?? 'error';
  if (a.state === 'new') return 'Sin conversación todavía';
  return a.snippet;
}

// A page of the sidebar: its icon and name, or only the icon (named on hover) when contracted.
function NavLink({href, icon: I, label, active, compact, children}: {href: string; icon: typeof UserRound; label: string; active: boolean; compact: boolean; children?: React.ReactNode}) {
  return (
    <a
      href={href}
      title={compact ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'mx-2 mt-0.5 flex items-center gap-2 rounded-md py-1.5 text-sm transition-colors duration-150',
        compact ? 'relative justify-center px-0' : 'px-2',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
      )}
    >
      <I className="size-4 flex-none" />
      {!compact && <span className="animate-fade-in flex-1 truncate">{label}</span>}
      {children && (compact ? <span className="absolute -top-0.5 -right-0.5 scale-75">{children}</span> : children)}
    </a>
  );
}

// Published on Instagram (Mi cuenta has its reel): opens it there.
function Posted({p}: {p: NonNullable<ReelSummary['instagram']>}) {
  const when = p.posted ? ` el ${new Date(p.posted).toLocaleDateString('es', {day: 'numeric', month: 'long'})}` : '';
  const views = p.views == null ? '' : ` · ${p.views.toLocaleString('es')} vistas`;
  return (
    <a href={p.url} target="_blank" rel="noreferrer" title={`Publicado en Instagram${when}${views}`} aria-label="Publicado en Instagram" className="grid size-6 place-items-center rounded-md text-pink-400 hover:bg-background/60">
      <InstagramGlyph className="size-4" />
    </a>
  );
}

// Scheduled on Instagram (publicaciones.json): opens Publicaciones programadas. Its time in a tooltip that waits a moment
// (a quick one gets in the way while moving over the list).
function Scheduled({at}: {at: string}) {
  const when = new Date(at).toLocaleString('es', {weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit'});
  return (
    <Tooltip delayDuration={1500}>
      <TooltipTrigger asChild>
        <a href="#/programados" aria-label={`Programado para el ${when}`} className="grid size-6 place-items-center rounded-md text-sky-600 hover:bg-background/60 dark:text-sky-400">
          <CalendarClock className="size-4" />
        </a>
      </TooltipTrigger>
      <TooltipContent side="right">Programado para el {when}</TooltipContent>
    </Tooltip>
  );
}

// Instagram's glyph: a rounded square, a lens and the flash dot.
export function InstagramGlyph({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

// The pages, in groups (their names are hidden when contracted).
const GROUPS: {label: string; pages: {href: string; icon: typeof UserRound; label: string; is: Page[]}[]}[] = [
  {
    label: 'Crear',
    pages: [
      {href: '#/', icon: LayoutGrid, label: 'Biblioteca', is: ['library']},
      {href: '#/programados', icon: CalendarDays, label: 'Publicaciones programadas', is: ['scheduled']},
      {href: '#/ideas', icon: Lightbulb, label: 'Ideas de contenido', is: ['ideas']},
      {href: '#/estilos', icon: Palette, label: 'Estilos y formatos', is: ['styles', 'formats']},
    ],
  },
  {
    label: 'Analizar',
    pages: [
      {href: '#/cuenta', icon: UserRound, label: 'Mi cuenta', is: ['account']},
      {href: '#/audiencia', icon: Target, label: 'Perfil de audiencia', is: ['audience']},
      {href: '#/inspiracion', icon: Sparkles, label: 'Inspiración', is: ['inspiration']},
      {href: '#/investigacion', icon: Telescope, label: 'Investigación', is: ['research']},
      {href: '#/fuentes', icon: Newspaper, label: 'Fuentes de información', is: ['sources']},
      {href: '#/auditoria', icon: ShieldCheck, label: 'Auditoría', is: ['audit']},
    ],
  },
  {
    label: 'Automatizar',
    pages: [{href: '#/automatizaciones', icon: CalendarClock, label: 'Automatizaciones', is: ['automations']}],
  },
];

export function Sidebar({slug, page}: {slug: string | null; page: Page}) {
  const {setOpen, sideOpen} = useStudio();
  const compact = !sideOpen;
  const inUse = useAgentId();
  const [agents, setAgents] = useState<Agent[]>([]);
  // The empty list's line waits for the first answer (else it flashes before the rows).
  const [loaded, setLoaded] = useState(false);
  // Each publication's progress (Guion → Voz → … → Render, or Textos → Láminas → …) and when its files last changed.
  const [reels, setReels] = useState<Record<string, {progress: ProgressStep[]; updated: number; instagram: ReelSummary['instagram']; release: ReelSummary['release']}>>({});
  const load = useCallback(() => {
    agentsApi.list().then((list) => {
      setAgents(list);
      setLoaded(true);
    }, () => {});
    api.reels().then((list) => setReels(Object.fromEntries(list.map((r) => [r.slug, {progress: r.progress, updated: r.updated, instagram: r.instagram, release: r.release}]))), () => {});
  }, []);
  // A publication's last activity: its conversation's last message or its files, whichever is newer (one made by an
  // automation, or by the general conversation, has no conversation of its own yet).
  const last = (a: Agent) => Math.max(a.lastTs ?? 0, (a.slug && reels[a.slug]?.updated) || 0) || null;
  useEffect(() => void load(), [load]);

  // Refresh on any agent/file event (debounced; streaming deltas don't change the state).
  const timer = useRef<number | undefined>(undefined);
  useSocket((msg) => {
    if (msg.type === 'chat' && msg.op === 'delta') return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(load, 300);
  }, load);
  // Relative times and "working" elapsed stay fresh.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Tab title shows how many agents are waiting on you.
  const waiting = agents.filter((a) => a.state === 'needs' || a.state === 'review').length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Reel Studio` : 'Reel Studio';
  }, [waiting]);

  const go = (a: Agent) => {
    location.hash = publicationHref(a.kind ?? undefined, a.slug!);
    setOpen(true);
  };

  // The publication list's height, dragged from its top edge (null: the room the pages leave).
  const {videosHeight, setVideosHeight} = useStudio();
  const menuRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<HTMLDivElement>(null);
  const rowDrag = useRef<{y: number; start: number; last: number | null} | null>(null);
  const endRowDrag = () => {
    if (!rowDrag.current) return;
    setVideosHeight(rowDrag.current.last, true);
    rowDrag.current = null;
    document.documentElement.classList.remove('resizing-rows');
  };

  const general = agents.find((a) => !a.slug);
  const rows = agents
    .filter((a) => a.slug)
    .map((a) => ({a, st: a.state}))
    .sort((x, y) => (last(y.a) ?? 0) - (last(x.a) ?? 0));

  const generalState =
    general && general.state !== 'idle' && general.state !== 'new' ? (
      <>
        {!compact && <AgentLogo agent={general.agent ?? inUse} />}
        <StateIcon state={general.state} />
      </>
    ) : null;
  return (
    <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] flex-col overflow-hidden border-r bg-card/40 lg:flex">
      <ProjectPicker compact={compact} />
      {/* The pages scroll on their own when they don't fit (a short window, or the video list dragged up). */}
      <div ref={menuRef} className="flex min-h-12 flex-col overflow-y-auto overscroll-contain" style={{flex: videosHeight && !compact ? '1 1 0' : '0 1 auto'}}>
      {GROUPS.map((g) => (
        <div key={g.label} className={cn('flex flex-none flex-col', compact ? 'mx-2 mt-2 border-t pt-1.5 [&>a]:mx-0' : 'mt-3')}>
          {!compact && <p className="animate-fade-in px-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>}
          {g.pages.map((p) => (
            <NavLink key={p.href} href={p.href} icon={p.icon} label={p.label} active={p.is.includes(page)} compact={compact}>
              {p.href === '#/' ? generalState : undefined}
            </NavLink>
          ))}
        </div>
      ))}
      </div>
      {/* Shown even with no publications yet: its + is the sidebar's way to start the first one. */}
      {compact ? (
        <div className="mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-0.5 border-t pt-3">
          <NewPublicationMenu side="right" align="start">
            <button
              title="Nueva publicación"
              aria-label="Nueva publicación"
              className="flex flex-none justify-center rounded-md py-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          </NewPublicationMenu>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {rows.map(({a, st}) => (
              <button
                key={a.key}
                onClick={() => go(a)}
                title={`${KIND[a.kind ?? 'video'].label} · ${a.title ?? a.slug} · ${STATE_LABEL[st]}`}
                className={cn('relative flex flex-none justify-center rounded-md py-2 transition-colors duration-150 hover:bg-muted', a.slug === slug && 'bg-primary/10 hover:bg-primary/10')}
              >
                <StateGlyph state={st} />
                <AgentLogo agent={a.agent ?? inUse} className="absolute right-1.5 bottom-1 size-2.5" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={videosRef} className="relative mt-1 flex min-h-24 flex-col pt-2" style={{flex: videosHeight ? `0 0 ${videosHeight}px` : '1 1 0'}}>
          <RowResizeHandle
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              rowDrag.current = {y: e.clientY, start: videosRef.current!.getBoundingClientRect().height, last: videosHeight};
              document.documentElement.classList.add('resizing-rows');
            }}
            onPointerMove={(e) => {
              const d = rowDrag.current;
              if (!d) return;
              // Up makes the list taller; the pages above keep at least a little room (and scroll).
              const max = videosRef.current!.getBoundingClientRect().height + menuRef.current!.getBoundingClientRect().height - 48;
              d.last = Math.round(Math.max(96, Math.min(max, d.start - (e.clientY - d.y))));
              setVideosHeight(d.last, false);
            }}
            onPointerUp={endRowDrag}
            onPointerCancel={endRowDrag}
            onDoubleClick={() => setVideosHeight(null)}
          />
          <div className="group/videos flex items-center justify-between pr-3 pb-1 pl-4">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Publicaciones <span className="tabular-nums">{rows.length}</span>
            </p>
            {/* Faint until the header is hovered or the + focused; stays while its menu is open, and always when the
                list is empty (it's the way to start one from here). */}
            <NewPublicationMenu>
              <button
                title="Nueva publicación"
                aria-label="Nueva publicación"
                className={cn(
                  '-my-1.5 flex-none rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover/videos:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:opacity-100',
                  loaded && rows.length === 0 && 'opacity-100',
                )}
              >
                <Plus className="size-4" />
              </button>
            </NewPublicationMenu>
          </div>
          {/* Only the list scrolls; the pages above and Ajustes below stay put. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loaded && rows.length === 0 && <p className="px-4 py-1 text-xs text-muted-foreground">Aún no hay publicaciones</p>}
            {rows.map(({a, st}) => (
              <div key={a.key} className={cn('group mx-2 flex items-center rounded-md transition-colors duration-150 hover:bg-muted', a.slug === slug && 'bg-primary/10 hover:bg-primary/10')}>
                {/* Left column, as wide as the state icon was: the state on the title's line, the kind on the last
                    line (they spread apart as the row grows). The logo and title keep their place to its right. */}
                <button onClick={() => go(a)} className="flex min-w-0 flex-1 items-stretch gap-2 py-2 pl-2 text-left">
                  <span className="flex flex-none flex-col justify-between gap-1">
                    <span className="flex h-5 items-center">
                      <StateIcon state={st} />
                    </span>
                    <KindIcon kind={a.kind ?? 'video'} className="size-4 text-muted-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm">
                      <AgentLogo agent={a.agent ?? inUse} />
                      <span className="min-w-0 flex-1 truncate font-medium">{a.title ?? a.slug}</span>
                    </span>
                    {(subtitle(a, st) || (last(a) && st !== 'working')) && (
                      <span className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="line-clamp-2 min-w-0 flex-1">{subtitle(a, st)}</span>
                        {last(a) && st !== 'working' && <span className="flex-none text-[11px] leading-4">{fmtAgo(last(a)!)}</span>}
                      </span>
                    )}
                  </span>
                </button>
                <div className="mr-1 flex flex-none flex-col items-center self-start pt-0.5">
                  {reels[a.slug!]?.progress.length ? <ReelProgressRing steps={reels[a.slug!].progress} className="m-1.5 mb-1" /> : null}
                  {reels[a.slug!]?.release?.state === 'scheduled' && reels[a.slug!].release!.at && <Scheduled at={reels[a.slug!].release!.at!} />}
                  {reels[a.slug!]?.instagram && <Posted p={reels[a.slug!].instagram!} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-none flex-col border-t pt-1 pb-2">
        <SidebarAccount onSettings={page === 'settings'} compact={compact} />
      </div>
    </nav>
  );
}

// The top edge of the publication list: drag it up or down; double click, back to the room the pages leave. A thin line that
// shows faintly on hover, like the columns' edges (components/common/ResizeHandle).
function RowResizeHandle(props: Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onDoubleClick'>) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Cambiar el alto de la lista de publicaciones"
      title="Arrastra para cambiar el alto · doble clic: el alto por defecto"
      className="group absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize touch-none"
      {...props}
    >
      <div className="absolute inset-x-0 top-1.5 h-px bg-border transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/50" />
    </div>
  );
}
