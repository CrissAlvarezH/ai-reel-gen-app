import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertCircle, CalendarClock, Circle, CircleDot, LayoutGrid, Lightbulb, Loader2, MessageCircleQuestion, Palette, Plus, Settings as SettingsIcon, Sparkles, Target, UserRound} from 'lucide-react';
import {cn} from '@/lib/utils';
import {agentsApi, api, fmtAgo, useAgentId, useSocket, type Agent, type AgentState, type ProgressStep, type ReelSummary} from './api';
import {ReelProgressRing} from './ReelProgress';
import {AgentLogo} from './AgentLogo';
import {useStudio, type UiContext} from './studio';
import {ProjectPicker} from './ProjectPicker';

type Page = UiContext['page'];

// Left sidebar: every video's agent in one list, most recent first; the icon on the left says its state.
// The library's general conversation shows its state next to "Biblioteca". Contracted (⌘B or the header's
// button, studio.tsx), it's a column of icons: the project, the pages and each video's state, named on hover.

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
function NavLink({href, icon: I, label, active, compact, first, children}: {href: string; icon: typeof UserRound; label: string; active: boolean; compact: boolean; first?: boolean; children?: React.ReactNode}) {
  return (
    <a
      href={href}
      title={compact ? label : undefined}
      className={cn(
        'mx-2 flex items-center gap-2 rounded-md py-1.5 text-sm hover:bg-muted',
        first ? 'mt-3' : 'mt-0.5',
        compact ? 'relative justify-center px-0' : 'px-2',
        active && 'bg-muted font-medium',
      )}
    >
      <I className="size-4 flex-none" />
      {!compact && <span className="flex-1">{label}</span>}
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
      {/* Instagram's glyph: a rounded square, a lens and the flash dot. */}
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    </a>
  );
}

export function Sidebar({slug, page}: {slug: string | null; page: Page}) {
  const {setOpen, sideOpen} = useStudio();
  const compact = !sideOpen;
  const inUse = useAgentId();
  const [agents, setAgents] = useState<Agent[]>([]);
  // Each video's progress (Guion → Voz → … → Render) and when its files last changed.
  const [reels, setReels] = useState<Record<string, {progress: ProgressStep[]; updated: number; instagram: ReelSummary['instagram']}>>({});
  const load = useCallback(() => {
    agentsApi.list().then(setAgents, () => {});
    api.reels().then((list) => setReels(Object.fromEntries(list.map((r) => [r.slug, {progress: r.progress, updated: r.updated, instagram: r.instagram}]))), () => {});
  }, []);
  // A video's last activity: its conversation's last message or its files, whichever is newer (one made by an
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
    location.hash = `#/reel/${a.slug}`;
    setOpen(true);
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
      <NavLink href="#/cuenta" icon={UserRound} label="Mi cuenta" active={page === 'account'} compact={compact} first />
      <NavLink href="#/" icon={LayoutGrid} label="Biblioteca" active={page === 'library'} compact={compact}>
        {generalState}
      </NavLink>
      <NavLink href="#/audiencia" icon={Target} label="Perfil de audiencia" active={page === 'audience'} compact={compact} />
      <NavLink href="#/ideas" icon={Lightbulb} label="Ideas de contenido" active={page === 'ideas'} compact={compact} />
      <NavLink href="#/automatizaciones" icon={CalendarClock} label="Automatizaciones" active={page === 'automations'} compact={compact} />
      <NavLink href="#/inspiracion" icon={Sparkles} label="Inspiración" active={page === 'inspiration'} compact={compact} />
      <NavLink href="#/estilos" icon={Palette} label="Estilos y formatos" active={page === 'styles' || page === 'formats'} compact={compact} />
      {rows.length > 0 &&
        (compact ? (
          <div className="mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain border-t pt-3">
            {rows.map(({a, st}) => (
              <button
                key={a.key}
                onClick={() => go(a)}
                title={`${a.title ?? a.slug} · ${STATE_LABEL[st]}`}
                className={cn('relative flex justify-center rounded-md py-2 hover:bg-muted', a.slug === slug && 'bg-muted')}
              >
                <StateGlyph state={st} />
                <AgentLogo agent={a.agent ?? inUse} className="absolute right-1.5 bottom-1 size-2.5" />
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="group/videos flex items-center justify-between pr-3 pb-1 pl-4">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Videos <span className="tabular-nums">{rows.length}</span>
              </p>
              <a
                href="#/nuevo"
                title="Nuevo video"
                aria-label="Nuevo video"
                className="-my-1.5 flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover/videos:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
              >
                <Plus className="size-4" />
              </a>
            </div>
            {/* Only the video list scrolls; the pages above and Ajustes below stay put. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {rows.map(({a, st}) => (
                <div key={a.key} className={cn('group mx-2 flex items-center rounded-md hover:bg-muted', a.slug === slug && 'bg-muted')}>
                  <button onClick={() => go(a)} className="flex min-w-0 flex-1 flex-col gap-1 py-2 pl-2 text-left">
                    <span className="flex items-center gap-2 text-sm">
                      <StateIcon state={st} />
                      <AgentLogo agent={a.agent ?? inUse} />
                      <span className="min-w-0 flex-1 truncate font-medium">{a.title ?? a.slug}</span>
                      {last(a) && st !== 'working' && <span className="flex-none text-[11px] text-muted-foreground">{fmtAgo(last(a)!)}</span>}
                    </span>
                    {subtitle(a, st) && <span className="line-clamp-2 pl-6 text-xs text-muted-foreground">{subtitle(a, st)}</span>}
                  </button>
                  <div className="mr-1 flex flex-none flex-col items-center self-start pt-0.5">
                    {reels[a.slug!]?.progress.length ? <ReelProgressRing steps={reels[a.slug!].progress} className="m-1.5 mb-1" /> : null}
                    {reels[a.slug!]?.instagram && <Posted p={reels[a.slug!].instagram!} />}
                </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      <div className="mt-auto flex flex-none flex-col border-t pt-1 pb-2">
        <NavLink href="#/ajustes" icon={SettingsIcon} label="Ajustes" active={page === 'settings'} compact={compact} />
      </div>
    </nav>
  );
}
