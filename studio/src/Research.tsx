import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Clock, Copy, Download, ExternalLink, Eye, FileText, Heart, Lightbulb, Loader2, MessageCircle, Plus, RefreshCw, Search, Settings, Share2, Sparkles, Square, Telescope, ThumbsDown, ThumbsUp, Trash2, Users, X} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Label} from '@/components/ui/label';
import {Progress} from '@/components/ui/progress';
import {Switch} from '@/components/ui/switch';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import ListSkeleton from '@/components/common/ListSkeleton';
import {audienceApi, fmtAgo, fmtTime, researchApi, useSocket, type Research, type ResearchDetail, type ResearchJob, type ResearchOptions, type ResearchPlatform, type ResearchSettings, type ResearchSettingsView, type ResearchStatus, type ResearchTask, type ResearchVideo, type ResearchVideoDetail} from './api';
import {RESEARCH_MAX_ANALYSE, RESEARCH_PLATFORMS, RESEARCH_SINCE, RESEARCH_TASKS} from '../shared/types';
import {EFFORT_LABELS} from './ChatControls';
import {md} from './Chat';
import {useConfirm} from './confirm';
import {projectKey, useStudio} from './studio';
import {FilterSelect, SortHead} from './Inspiration';
import {AnalysisSections, FramesSection, Section, StateBadge, TranscriptSection} from './ReelAnalysis';

// Investigación: what's working on a topic in TikTok, YouTube Shorts and Instagram, for the project's audience
// (server/research.ts). A research is a topic and the searches the agent proposes for it (editable); "Buscar" runs them
// on each platform (charged: ScrapeCreators, Apify) and the agent keeps what serves his audience; each video gets a score
// against the rest; "Analizar" downloads, transcribes and analyses the best ones, and the agent writes the report.
// Routes: #/investigacion (the list), #/investigacion/<id>, #/investigacion/<id>/<video key> (a video's card).

const PLATFORM: Record<ResearchPlatform, {label: string; short: string}> = {
  tiktok: {label: 'TikTok', short: 'TikTok'},
  youtube: {label: 'YouTube Shorts', short: 'YouTube'},
  instagram: {label: 'Instagram', short: 'Instagram'},
};
// The platforms' marks (lucide has no brand icons), in the text's colour.
function PlatformIcon({p, className}: {p: ResearchPlatform; className?: string}) {
  const cls = cn('size-3.5 flex-none', className);
  if (p === 'tiktok')
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cls}>
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    );
  if (p === 'youtube')
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cls}>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cls}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}
const SINCE_LABEL = (d: number) => (d === 0 ? 'Cualquier fecha' : d === 7 ? 'Última semana' : d === 30 ? 'Último mes' : d === 365 ? 'Último año' : `Últimos ${Math.round(d / 30)} meses`);
const MAX_SECONDS: [string, string][] = [
  ['60', 'Hasta 1 min'],
  ['90', 'Hasta 1:30'],
  ['180', 'Hasta 3 min'],
  ['600', 'Hasta 10 min'],
];
const STAGE: Record<ResearchJob['stage'], string> = {
  queries: 'El agente propone las búsquedas para tu audiencia',
  searching: 'Buscando en las plataformas (puede tardar unos minutos, sobre todo Instagram)',
  filtering: 'El agente separa los videos que le sirven a tu audiencia',
  processing: 'Bajando, transcribiendo y sacando fotogramas',
  analyzing: 'El agente analiza cada video',
  report: 'El agente escribe el informe',
};

const num = (v: number | null | undefined) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')} M` : v >= 1e4 ? `${Math.round(v / 1e3)} k` : Math.round(v).toLocaleString('es'));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`);
const ratio = (v: number | null) => (v == null ? '—' : v >= 10 ? `${Math.round(v)}×` : `${v.toFixed(1)}×`);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('es', {day: 'numeric', month: 'short', year: '2-digit'}) : '—');
const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

function useResearchHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const m = hash.match(/^#\/investigacion\/([a-f0-9]{8})(?:\/((?:tiktok|youtube|instagram)-[A-Za-z0-9_-]+))?/);
  return {id: m?.[1] ?? null, video: m?.[2] ?? null};
}
const go = (id?: string | null, video?: string | null) => {
  location.hash = `#/investigacion${id ? `/${id}${video ? `/${video}` : ''}` : ''}`;
};

export function ResearchPage() {
  const {id, video} = useResearchHash();
  const {uiRef} = useStudio();
  uiRef.current = {page: 'research', ...(id ? {research: video ? `${id}/${video}` : id} : {})};
  return id ? <ResearchView key={id} id={id} videoKey={video} /> : <ResearchList />;
}

function PlatformBadge({p, className}: {p: ResearchPlatform; className?: string}) {
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal', className)}>
      <PlatformIcon p={p} className="size-3" />
      {PLATFORM[p].short}
    </Badge>
  );
}

/* ───── The list ───── */

function ResearchList() {
  const [st, setSt] = useState<ResearchStatus | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const load = useCallback(() => researchApi.status().then(setSt, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useSocket((m) => (m.type === 'research' || m.type === 'synced') && void load(), load);

  if (err && !st) return <p className="p-6 text-sm text-destructive">{err}</p>;
  if (!st)
    return (
      <PageSkeleton>
        <ListSkeleton count={3} announce={false} />
      </PageSkeleton>
    );
  const has = st.researches.length > 0;
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Investigación</h1>
          <p className="text-sm text-muted-foreground">Busca un tema en TikTok, YouTube Shorts e Instagram, quédate con lo que le sirve a tu audiencia y estudia los videos que mejor funcionan.</p>
        </div>
        <div className="flex gap-2">
          {has && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nueva investigación
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => setConfiguring(true)} aria-label="Configuración" title="Configuración: los modelos del agente para cada tarea">
            <Settings />
          </Button>
        </div>
      </div>
      {!has ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Telescope className="size-5" /> Todavía no tienes investigaciones
            </CardTitle>
            <CardDescription>{NEW_NOTE}</CardDescription>
          </CardHeader>
          <CardContent>
            <NewResearch st={st} />
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {st.researches.map((r) => (
            <ResearchCard key={r.id} r={r} />
          ))}
        </section>
      )}
      {configuring && <SettingsDialog onClose={() => setConfiguring(false)} />}
      {creating && (
        <Dialog open onOpenChange={(o) => !o && setCreating(false)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nueva investigación</DialogTitle>
              <DialogDescription>{NEW_NOTE}</DialogDescription>
            </DialogHeader>
            <NewResearch st={st} autoFocus />
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}

// Configuración: the model and effort the agent uses for each task of a research, for this project; saved with Guardar.
const TASKS: {task: ResearchTask; label: string; hint: string}[] = [
  {task: 'queries', label: 'Proponer las búsquedas', hint: 'Lo que tu audiencia escribiría en cada buscador.'},
  {task: 'relevance', label: 'Filtrar lo que le sirve', hint: 'Lee los captions y separa lo que le sirve a tu audiencia.'},
  {task: 'analysis', label: 'Analizar los mejores', hint: 'Gancho, estructura y recursos de cada video, con sus fotogramas.'},
  {task: 'report', label: 'Escribir el informe', hint: 'Lo que funciona, los huecos y las ideas.'},
];
const NONE = '_'; // '' in a Select: the default
function SettingsDialog({onClose}: {onClose: () => void}) {
  const [view, setView] = useState<ResearchSettingsView | null>(null);
  const [draft, setDraft] = useState<ResearchSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    researchApi.settings().then(
      (v) => (setView(v), setDraft(v.settings)),
      (e: Error) => setErr(e.message),
    );
  }, []);
  const effortsOf = (model: string) => view?.models.find((m) => m.id === model)?.efforts ?? [];
  const set = (task: ResearchTask, v: {model?: string; effort?: string}) =>
    setDraft((d) => {
      if (!d) return d;
      const model = v.model ?? d[task].model;
      const effort = v.effort ?? (effortsOf(model).includes(d[task].effort) ? d[task].effort : '');
      return {...d, [task]: {model, effort}};
    });
  const changed = !!view && !!draft && RESEARCH_TASKS.some((t) => draft[t].model !== view.settings[t].model || draft[t].effort !== view.settings[t].effort);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr('');
    try {
      await researchApi.saveSettings(draft);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configuración de la investigación</DialogTitle>
          <DialogDescription>El modelo y el esfuerzo del agente para cada tarea, en todas las investigaciones de este proyecto.</DialogDescription>
        </DialogHeader>
        {!view || !draft ? (
          err ? <p className="text-sm text-destructive">{err}</p> : <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-col gap-4">
            {TASKS.map(({task, label, hint}) => {
              const efforts = effortsOf(draft[task].model);
              return (
                <div key={task} className="flex flex-col gap-2">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={draft[task].model || NONE} onValueChange={(m) => set(task, {model: m === NONE ? '' : m})}>
                      <SelectTrigger className="w-full" aria-label={`Modelo: ${label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {view.models.map((m) => (
                          <SelectItem key={m.id || NONE} value={m.id || NONE}>
                            {m.id ? m.label : view.defaults[task]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={draft[task].effort || NONE} onValueChange={(e) => set(task, {effort: e === NONE ? '' : e})} disabled={!efforts.length}>
                      <SelectTrigger className="w-full" aria-label={`Esfuerzo: ${label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Esfuerzo predeterminado</SelectItem>
                        {efforts.map((e) => (
                          <SelectItem key={e} value={e}>
                            Esfuerzo {(EFFORT_LABELS[e] ?? e).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">Con {view.agent}, el agente predeterminado de tus ajustes. Lo que ya está trabajando sigue con lo de antes.</p>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !changed} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResearchCard({r}: {r: Research}) {
  return (
    <a href={`#/investigacion/${r.id}`} className="block rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full gap-3 py-4 hover:bg-muted/40">
        <CardHeader className="px-4">
          <CardTitle className="line-clamp-2 leading-snug">{r.topic}</CardTitle>
          <CardDescription className="flex flex-wrap gap-1.5 pt-1">
            {r.options.platforms.map((p) => (
              <PlatformBadge key={p} p={p} />
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 px-4 text-xs text-muted-foreground">
          {r.job ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {STAGE[r.job.stage]}
            </span>
          ) : r.error ? (
            <span className="line-clamp-2 text-destructive">{r.error}</span>
          ) : null}
          <span>
            {r.searched ? `${r.counts.relevant} de ${r.counts.videos} videos le sirven a tu audiencia · ${r.counts.analysed} analizados` : 'Sin buscar todavía'}
          </span>
          <span>{r.report ? `Informe ${fmtAgo(r.report.at)}` : r.searched ? `Buscada ${fmtAgo(r.searched)}` : `Creada ${fmtAgo(r.created)}`}</span>
        </CardContent>
      </Card>
    </a>
  );
}

const NEW_NOTE = 'Escribe el tema. El agente propone las búsquedas que haría tu audiencia; las revisas antes de buscar y ves cuánto cuesta.';

// A new research: the topic (written, or one of his audience's wants and problems), its platforms and window.
function NewResearch({st, autoFocus}: {st: ResearchStatus; autoFocus?: boolean}) {
  const [topic, setTopic] = useState('');
  const [platforms, setPlatforms] = useState<ResearchPlatform[]>(() => {
    const on = RESEARCH_PLATFORMS.filter((p) => st.ready[p.id]).map((p) => p.id);
    return on.length ? on : RESEARCH_PLATFORMS.map((p) => p.id);
  });
  const [since, setSince] = useState('90');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picks, setPicks] = useState<string[]>([]);
  useEffect(() => {
    audienceApi.get().then(
      (a) => setPicks([...a.problems.slice(0, 4), ...a.wants.map((w) => w.want).slice(0, 4)].filter(Boolean)),
      () => {},
    );
  }, []);
  const start = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!topic.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await researchApi.create(topic, {platforms, sinceDays: Number(since)});
      go(r.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={start} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="research-topic">Tema</Label>
        <Input id="research-topic" autoFocus={autoFocus} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="Cómo ahorrar para la cuota inicial de una vivienda" />
        {picks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">De tu perfil de audiencia:</span>
            {picks.map((p) => (
              <button key={p} type="button" onClick={() => setTopic(p)} className={cn('max-w-72 truncate rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground', topic === p && 'border-primary/50 bg-primary/10 text-primary')} title={p}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <PlatformToggles value={platforms} onChange={setPlatforms} ready={st.ready} />
        <div className="flex flex-col gap-2">
          <Label>Antigüedad</Label>
          <FilterSelect value={since} onChange={setSince} label="Antigüedad" options={RESEARCH_SINCE.map((d) => [String(d), SINCE_LABEL(d)])} />
        </div>
        <Button type="submit" className="ml-auto" disabled={!topic.trim() || !platforms.length || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Crear investigación
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </form>
  );
}

function PlatformToggles({value, onChange, ready, disabled}: {value: ResearchPlatform[]; onChange: (v: ResearchPlatform[]) => void; ready: Record<ResearchPlatform, boolean>; disabled?: boolean}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Plataformas</Label>
      <div className="flex flex-wrap gap-1.5">
        {RESEARCH_PLATFORMS.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : RESEARCH_PLATFORMS.map((x) => x.id).filter((x) => x === p.id || value.includes(x)))}
              title={ready[p.id] ? `Busca con ${p.via}` : `Falta la clave de ${p.via}: ponla en Ajustes → Extracción de datos`}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors disabled:opacity-50', on ? 'border-primary/50 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              {on ? <Check className="size-3.5" /> : <span className="size-3.5" />}
              <PlatformIcon p={p.id} className={cn(!on && 'opacity-60')} />
              {p.label}
              {!ready[p.id] && <span className="text-amber-500">· sin clave</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───── One research ───── */

type SortKey = 'score' | 'views' | 'perDay' | 'ratio' | 'engagement' | 'saves' | 'posted' | 'duration';
type Saved = {platform: string; all: boolean; sort: {key: SortKey; desc: boolean}};
const SAVED = () => projectKey('studio.research.table');
const PAGE = 25;

function ResearchView({id, videoKey}: {id: string; videoKey: string | null}) {
  const {uiRef, setOpen} = useStudio();
  const confirm = useConfirm();
  const [r, setR] = useState<ResearchDetail | null>(null);
  const [st, setSt] = useState<ResearchStatus | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const load = useCallback(() => {
    researchApi.detail(id).then(setR, (e: Error) => setErr(e.message));
    researchApi.status().then(setSt, () => {});
  }, [id]);
  useEffect(() => void load(), [load]);
  // While a job runs the socket fires often: one load per moment.
  const timer = useRef<number | undefined>(undefined);
  useSocket(
    (m) => {
      if (m.type !== 'research' && m.type !== 'synced') return;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(load, 300);
    },
    load,
  );

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr('');
    try {
      await fn();
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (err && !r)
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
        <BackLink />
        <p className="text-sm text-destructive">{err}</p>
      </main>
    );
  if (!r || !st)
    return (
      <PageSkeleton>
        <ListSkeleton count={2} announce={false} />
        <ListSkeleton variant="table" count={8} announce={false} />
      </PageSkeleton>
    );

  const working = !!r.job;
  const search = () =>
    act('search', async () => {
      const e = await researchApi.estimate(r.id);
      const ok = await confirm({
        title: '¿Buscar ahora?',
        description: `${r.queries.length} búsqueda${r.queries.length === 1 ? '' : 's'} en ${r.options.platforms.map((p) => PLATFORM[p].label).join(', ')}. ${e.lines.map((l) => `${PLATFORM[l.platform].label}: ${l.text}.`).join(' ')} Después el agente lee los captions con tu suscripción y separa lo que le sirve a tu audiencia.`,
        action: 'Buscar',
      });
      if (ok) await researchApi.search(r.id);
    });
  const analyse = (top: number) =>
    act('analyse', async () => {
      const pending = r.videos.filter((v) => v.relevant !== false && v.score != null && v.state !== 'ready').slice(0, top);
      const yt = pending.filter((v) => v.platform === 'youtube').length;
      if (yt && !st.youtubeDownloader) throw new Error('Para analizar YouTube Shorts falta yt-dlp: instálalo en Ajustes → Requisitos → Descarga de YouTube.');
      const ok = await confirm({
        title: pending.length === 1 ? '¿Analizar el mejor video sin analizar?' : `¿Analizar los ${pending.length} mejores videos sin analizar?`,
        description: 'Los de mejor puntaje que le sirven a tu audiencia y aún no tienen análisis.',
        body: <AnalyseSteps r={r} videos={pending} />,
        action: 'Analizar',
      });
      if (ok) await researchApi.analyse(r.id, {top});
    });
  const remove = async () => {
    if (!(await confirm({title: '¿Borrar esta investigación?', description: 'Se borran sus búsquedas, los videos encontrados, sus análisis y el informe.', action: 'Borrar', destructive: true}))) return;
    try {
      await researchApi.remove(r.id);
      go(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const pendingTop = r.videos.filter((v) => v.relevant !== false && v.score != null && v.state !== 'ready').length;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{r.topic}</h1>
            <p className="text-sm text-muted-foreground">
              {r.searched ? `${r.counts.relevant} de ${r.counts.videos} videos le sirven a tu audiencia · ${r.counts.analysed} analizados · buscada ${fmtAgo(r.searched)}` : 'Revisa las búsquedas y pulsa Buscar.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!r.searched && (
              <Button disabled={working || !!busy || !r.queries.length} onClick={() => void search()}>
                {busy === 'search' ? <Loader2 className="animate-spin" /> : <Search />} Buscar
              </Button>
            )}
            {r.counts.videos > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={working || !!busy || !pendingTop} title={pendingTop ? 'Baja, transcribe y analiza los mejores videos; después escribe el informe' : 'Ya están analizados los videos útiles'}>
                    {busy === 'analyse' ? <Loader2 className="animate-spin" /> : <Sparkles />} Analizar los mejores
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>¿Cuántos?</DropdownMenuLabel>
                  {[...new Set([3, 5, 8, RESEARCH_MAX_ANALYSE].map((x) => Math.min(x, pendingTop)))].map((x) => (
                    <DropdownMenuItem key={x} onSelect={() => void analyse(x)}>
                      {x === 1 ? 'El mejor sin analizar' : `Los ${x} mejores sin analizar`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {r.searched && (
              <Button variant="outline" disabled={working} onClick={() => setDuplicating(true)} title="Una nueva con este tema, sus búsquedas y opciones, para cambiar lo que quieras">
                <Copy /> Duplicar
              </Button>
            )}
            <Button variant="ghost" size="icon" disabled={working} onClick={() => void remove()} aria-label="Borrar la investigación" title="Borrar la investigación">
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>

      {r.job && <JobLine job={r.job} onStop={() => researchApi.stop(r.id)} />}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {r.error && !r.job && (
        <Alert variant="destructive">
          <AlertDescription>{r.error}</AlertDescription>
        </Alert>
      )}

      <Queries r={r} st={st} disabled={working} onSaved={load} />

      {r.report ? (
        <Report r={r} busy={busy} working={working} onRedo={() => void act('report', () => researchApi.report(r.id))} onIdeas={() => void act('ideas', async () => (await researchApi.toIdeas(r.id, uiRef.current), setOpen(true)))} />
      ) : (
        r.counts.relevant > 0 &&
        !working && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4" /> Todavía no hay informe
              </CardTitle>
              <CardDescription>
                Pulsa <span className="font-medium text-foreground">Analizar los mejores</span>: el agente estudia los videos con mejor puntaje y escribe el informe (qué funciona, ganchos, huecos e ideas para ti). O pide el informe ya, solo con las métricas y los captions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void act('report', () => researchApi.report(r.id))}>
                {busy === 'report' ? <Loader2 className="animate-spin" /> : <FileText />} Informe sin analizar
              </Button>
            </CardContent>
          </Card>
        )
      )}

      <Analysed r={r} />
      {r.counts.videos > 0 && <Ranking r={r} />}
      <VideoDialog id={r.id} videoKey={videoKey} st={st} onClose={() => go(r.id)} />
      {duplicating && <DuplicateDialog r={r} st={st} onClose={() => setDuplicating(false)} />}
    </main>
  );
}

// What Analizar los mejores does, for its confirmation: the videos it takes, its three steps and what it spends.
function AnalyseSteps({r, videos}: {r: ResearchDetail; videos: ResearchVideo[]}) {
  const steps: [typeof Download, string, string][] = [
    [Download, 'Los baja y los transcribe', 'En este equipo: el video, sus fotogramas y lo que dice.'],
    [Sparkles, 'El agente analiza cada uno', 'Gancho, estructura con sus tiempos, recursos visuales, CTA y qué tomar para tus videos.'],
    [FileText, 'Reescribe el informe', 'Ángulos y ganchos que funcionan, formato, huecos de tu audiencia e ideas.'],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {videos.map((v) => (
          <span key={v.key} className="relative" title={`@${v.author} · puntaje ${v.score}`}>
            {v.thumb ? <img src={researchApi.file(r.id, v.key, 'thumb.jpg')} alt="" className="h-14 w-10 rounded object-cover" /> : <span className="block h-14 w-10 rounded bg-muted" />}
            <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px] font-medium text-white tabular-nums">{v.score}</span>
          </span>
        ))}
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map(([Icon, title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-7 flex-none place-items-center rounded-full border bg-muted/40 text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <span className="flex flex-col">
              <span className="font-medium">
                {i + 1}. {title}
              </span>
              <span className="text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Usa la suscripción de tu agente. No gasta saldo de ScrapeCreators ni de Apify.</p>
    </div>
  );
}

const BackLink = () => (
  <a href="#/investigacion" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft className="size-4" /> Investigaciones
  </a>
);

function JobLine({job, onStop}: {job: ResearchJob; onStop: () => Promise<unknown>}) {
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex flex-1 items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {STAGE[job.stage]}
          {job.total > 1 && <span className="text-muted-foreground"> · {job.done} de {job.total}</span>}
          <span className="text-muted-foreground"> · desde {fmtAgo(job.started)}</span>
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={stopping}
          title={job.stage === 'searching' ? 'Lo que ya se pidió a las plataformas se cobra igual' : undefined}
          onClick={async () => {
            setStopping(true);
            setErr('');
            await onStop().catch((e: Error) => setErr(e.message));
            setStopping(false);
          }}
        >
          {stopping ? <Loader2 className="animate-spin" /> : <Square />} Detener
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {job.total > 1 && <Progress value={(job.done / job.total) * 100} className="h-1" />}
    </div>
  );
}

type Fields = {queries: string[]; options: ResearchOptions};
type FieldsChange = {queries?: string[]; options?: Partial<ResearchOptions>};

// The searches (chips) and options: before its first search, saved as he changes them. Once searched, a research
// doesn't change: they're shown as they were, with how each platform went, and Duplicar makes a new one to change.
function Queries({r, st, disabled, onSaved}: {r: Research; st: ResearchStatus; disabled: boolean; onSaved: () => void}) {
  const [err, setErr] = useState('');
  const save = (input: FieldsChange) => researchApi.edit(r.id, input).then(onSaved, (e: Error) => setErr(e.message));
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Búsquedas</CardTitle>
        <CardDescription>
          {r.searched ? 'Lo que tu audiencia escribiría en el buscador de cada app; cada una se buscó en cada plataforma. Para cambiarlas, duplica la investigación.' : 'Lo que tu audiencia escribiría en el buscador de cada app. Cámbialas antes de buscar: cada una se busca en cada plataforma.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {r.searched ? <SearchSummary r={r} /> : <SearchFields value={r} onChange={save} ready={st.ready} disabled={disabled} proposing={r.job?.stage === 'queries'} />}
        {r.runs.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            {r.runs.map((run) => (
              <span key={run.platform} className={cn(run.error && !run.found && 'text-destructive')} title={run.error ?? undefined}>
                <span className="font-medium text-foreground">{PLATFORM[run.platform].label}</span>: {run.found} videos · {run.cost}
                {run.error ? ` · ${run.error}` : ''}
              </span>
            ))}
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

// A searched research's searches and options, as they were.
function SearchSummary({r}: {r: Research}) {
  const o = r.options;
  const opts = [SINCE_LABEL(o.sinceDays), MAX_SECONDS.find(([v]) => Number(v) === o.maxSeconds)?.[1] ?? `Hasta ${o.maxSeconds} s`, o.platforms.includes('instagram') ? `${o.perQuery} reels de Instagram por búsqueda` : '', o.country ? `País ${o.country}` : ''].filter(Boolean);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {r.queries.map((q) => (
          <span key={q} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-sm">
            {q}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {o.platforms.map((p) => (
          <PlatformBadge key={p} p={p} />
        ))}
        <span className="ml-1">{opts.join(' · ')}</span>
      </div>
    </>
  );
}

// The searches and options as a form: the research's own before its first search, or a copy's in Duplicar.
function SearchFields({value, onChange, ready, disabled, proposing}: {value: Fields; onChange: (v: FieldsChange) => unknown; ready: Record<ResearchPlatform, boolean>; disabled?: boolean; proposing?: boolean}) {
  const [adding, setAdding] = useState('');
  const {queries, options: o} = value;
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const q = adding.trim();
    if (!q || queries.includes(q)) return;
    void Promise.resolve(onChange({queries: [...queries, q]})).then(() => setAdding(''));
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {proposing && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> El agente está proponiendo las búsquedas…
          </span>
        )}
        {!proposing &&
          queries.map((q) => (
            <span key={q} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-sm">
              {q}
              <button type="button" disabled={disabled || queries.length === 1} onClick={() => void onChange({queries: queries.filter((x) => x !== q)})} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={`Quitar «${q}»`}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        {!proposing && queries.length < 8 && (
          <form onSubmit={add} className="flex items-center gap-1">
            <Input value={adding} onChange={(e) => setAdding(e.target.value)} disabled={disabled} maxLength={80} placeholder="Otra búsqueda…" className="h-7 w-48 text-sm" />
            <Button type="submit" size="icon-sm" variant="ghost" disabled={disabled || !adding.trim()} aria-label="Añadir búsqueda">
              <Plus />
            </Button>
          </form>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <PlatformToggles value={o.platforms} onChange={(platforms) => platforms.length && void onChange({options: {platforms}})} ready={ready} disabled={disabled} />
        <div className="flex flex-col gap-2">
          <Label>Antigüedad</Label>
          <FilterSelect value={String(o.sinceDays)} onChange={(v) => void onChange({options: {sinceDays: Number(v)}})} label="Antigüedad" options={RESEARCH_SINCE.map((d) => [String(d), SINCE_LABEL(d)])} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Duración</Label>
          <FilterSelect value={String(o.maxSeconds)} onChange={(v) => void onChange({options: {maxSeconds: Number(v)}})} label="Duración" options={MAX_SECONDS} />
        </div>
        {o.platforms.includes('instagram') && (
          <div className="flex flex-col gap-2">
            <Label>Reels de Instagram por búsqueda</Label>
            <FilterSelect value={String(o.perQuery)} onChange={(v) => void onChange({options: {perQuery: Number(v)}})} label="Reels" options={['15', '30', '50', '100'].map((x) => [x, `${x} reels`])} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label title="Desde dónde se busca en TikTok y YouTube (código de 2 letras)">País</Label>
          <Input
            key={o.country ?? ''}
            defaultValue={o.country ?? ''}
            disabled={disabled}
            maxLength={2}
            placeholder="CO"
            aria-label="País"
            className="h-8 w-16 uppercase"
            onBlur={(e) => e.target.value.trim().toUpperCase() !== (o.country ?? '') && void onChange({options: {country: e.target.value.trim().toUpperCase() || null}})}
          />
        </div>
      </div>
    </>
  );
}

// Duplicar: a new research with this one's topic, searches and options, changed as he likes; it opens unsearched.
function DuplicateDialog({r, st, onClose}: {r: Research; st: ResearchStatus; onClose: () => void}) {
  const [topic, setTopic] = useState(r.topic);
  const [f, setF] = useState<Fields>({queries: r.queries, options: r.options});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const change = (v: FieldsChange) => setF((x) => ({queries: v.queries ?? x.queries, options: {...x.options, ...v.options}}));
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const n = await researchApi.create(topic, f.options, f.queries);
      onClose();
      go(n.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Duplicar investigación</DialogTitle>
          <DialogDescription>Una nueva con este tema, sus búsquedas y opciones: cambia lo que quieras. Esta queda como está; la nueva empieza sin buscar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="research-copy-topic">Tema</Label>
            <Input id="research-copy-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-4">
            <Label>Búsquedas</Label>
            <SearchFields value={f} onChange={change} ready={st.ready} disabled={busy} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !topic.trim() || !f.queries.length || !f.options.platforms.length}>
              {busy ? <Loader2 className="animate-spin" /> : <Copy />} Crear la copia
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Report({r, busy, working, onRedo, onIdeas}: {r: ResearchDetail; busy: string | null; working: boolean; onRedo: () => void; onIdeas: () => void}) {
  // [tiktok-123…] → a link to that video's card, named by its author.
  const authors = useMemo(() => new Map(r.videos.map((v) => [v.key, v.author])), [r.videos]);
  const html = useMemo(
    () => md(r.report!.text.replace(/\[((?:tiktok|youtube|instagram)-[A-Za-z0-9_-]{3,40})\](?!\()/g, (all, k: string) => (authors.has(k) ? `[@${authors.get(k)}](#/investigacion/${r.id}/${k})` : all))),
    [r.report, r.id, authors],
  );
  const [open, setOpen] = useOpen('report');
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="group/report">
        <CardHeader className="flex flex-row flex-wrap items-start gap-2">
          <CollapsibleTrigger className="min-w-0 flex-1 text-left">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]/report:rotate-90" />
              <FileText className="size-4" /> Informe
            </CardTitle>
            <CardDescription className="pl-6">
              {fmtAgo(r.report!.at)} · {r.report!.keys.length ? `con ${r.report!.keys.length} videos analizados` : 'solo con métricas y captions'}
            </CardDescription>
          </CollapsibleTrigger>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={working || !!busy} onClick={onIdeas} title="Una conversación nueva convierte el informe en ideas para tu tablero">
              {busy === 'ideas' ? <Loader2 className="animate-spin" /> : <Lightbulb />} Llevar a Ideas
            </Button>
            <Button size="sm" variant="ghost" disabled={working || !!busy} onClick={onRedo} title="El agente lo escribe otra vez con lo que hay ahora">
              {busy === 'report' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rehacer
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-5 prose-headings:mb-1.5 prose-headings:text-base prose-p:my-1.5 prose-ul:my-1.5" dangerouslySetInnerHTML={{__html: html}} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Whether a section of the research page is open, per project (open by default).
const OPEN = () => projectKey('studio.research.open');
function useOpen(name: 'report' | 'analysed'): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem(OPEN()) ?? '{}') as Record<string, boolean>)[name] !== false;
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN(), JSON.stringify({...JSON.parse(localStorage.getItem(OPEN()) ?? '{}'), [name]: v}));
    } catch {
      /* private mode */
    }
  };
  return [open, set];
}

// The analysed videos, best first: each card opens its analysis (hook, structure, transcript, frames).
function Analysed({r}: {r: ResearchDetail}) {
  const [open, setOpen] = useOpen('analysed');
  const list = useMemo(() => r.videos.filter((v) => v.state === 'ready' && v.analysis).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), [r.videos]);
  if (!list.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="group/analysed">
        <CardHeader>
          <CollapsibleTrigger className="text-left">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]/analysed:rotate-90" />
              <Sparkles className="size-4" /> Análisis de los mejores
              <span className="font-normal text-muted-foreground">{list.length}</span>
            </CardTitle>
            <CardDescription className="pl-6">Ábrelos para ver su gancho, su estructura, la transcripción y los fotogramas.</CardDescription>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((v) => (
              <button key={v.key} type="button" onClick={() => go(r.id, v.key)} className="flex gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {v.thumb ? <img src={researchApi.file(r.id, v.key, 'thumb.jpg')} alt="" loading="lazy" className="h-28 w-20 flex-none rounded object-cover" /> : <div className="h-28 w-20 flex-none rounded bg-muted" />}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <PlatformBadge p={v.platform} className="px-1.5 py-0 text-[10px]" />
                    {v.score != null && (
                      <span className="ml-auto font-medium text-foreground tabular-nums" title="Puntaje de 0 a 100 frente a los demás videos">
                        {v.score}
                      </span>
                    )}
                  </span>
                  <span className="-mt-1 truncate text-xs text-muted-foreground">@{v.author}</span>
                  <span className="line-clamp-2 text-sm font-medium">{v.analysis!.topic}</span>
                  <span className="line-clamp-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Gancho: </span>
                    {v.analysis!.hook.text}
                  </span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    {num(v.views)} vistas{v.ratio != null && ` · ${ratio(v.ratio)} sus seguidores`}
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

const SORT_KEYS: SortKey[] = ['score', 'views', 'perDay', 'ratio', 'engagement', 'saves', 'posted', 'duration'];
// The table's filters and order, per project (a missing or odd value: its default).
function loadSaved(): Saved {
  const none: Saved = {platform: 'any', all: false, sort: {key: 'score', desc: true}};
  try {
    const s = JSON.parse(localStorage.getItem(SAVED()) ?? 'null');
    if (!s || typeof s !== 'object') return none;
    return {
      platform: ['any', ...RESEARCH_PLATFORMS.map((p) => p.id)].includes(s.platform) ? s.platform : 'any',
      all: s.all === true,
      sort: SORT_KEYS.includes(s.sort?.key) ? {key: s.sort.key, desc: s.sort.desc !== false} : none.sort,
    };
  } catch {
    return none;
  }
}
function saveTable(v: Saved) {
  try {
    localStorage.setItem(SAVED(), JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

function Ranking({r}: {r: ResearchDetail}) {
  const [saved, setSaved] = useState(loadSaved);
  const [page, setPage] = useState(0);
  const set = (v: Partial<Saved>) => {
    const next = {...saved, ...v};
    setSaved(next);
    saveTable(next);
    setPage(0);
  };
  const sortVal = (v: ResearchVideo): number | null =>
    ({score: v.score, views: v.views, perDay: v.perDay, ratio: v.ratio, engagement: v.engagement, saves: v.saves != null && v.views ? v.saves / v.views : null, posted: v.posted ? Date.parse(v.posted) : null, duration: v.duration})[saved.sort.key];
  const rows = useMemo(() => {
    const list = r.videos.filter((v) => (saved.all || v.relevant !== false) && (saved.platform === 'any' || v.platform === saved.platform));
    return list.sort((a, b) => {
      const x = sortVal(a);
      const y = sortVal(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return saved.sort.desc ? y - x : x - y;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.videos, saved]);
  const hidden = r.videos.filter((v) => v.relevant === false).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const sort = saved.sort;
  const setSort = (s: {key: SortKey; desc: boolean}) => set({sort: s});
  const platforms = [...new Set(r.videos.map((v) => v.platform))];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Ranking</h2>
        {platforms.length > 1 && <FilterSelect value={saved.platform} onChange={(v) => set({platform: v})} label="Plataforma" options={[['any', 'Todas'], ...platforms.map((p) => [p, PLATFORM[p].label] as [string, string])]} />}
        {hidden > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={saved.all} onCheckedChange={(all) => set({all})} />
            Ver los {hidden} que no le sirven
          </label>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead className="min-w-72">Video</TableHead>
              <SortHead k="score" sort={sort} setSort={setSort} className="text-right" hover={<ScoreHelp />}>
                Puntaje
              </SortHead>
              <SortHead k="views" sort={sort} setSort={setSort} className="text-right">
                Vistas
              </SortHead>
              <SortHead k="perDay" sort={sort} setSort={setSort} className="text-right" title="Vistas por día desde que se publicó">
                Por día
              </SortHead>
              <SortHead k="ratio" sort={sort} setSort={setSort} className="text-right" title="Vistas sobre los seguidores de su autor (solo TikTok los da)">
                × seguidores
              </SortHead>
              <SortHead k="engagement" sort={sort} setSort={setSort} className="text-right" title="Likes, comentarios, compartidos y guardados sobre las vistas">
                Interacción
              </SortHead>
              <SortHead k="saves" sort={sort} setSort={setSort} className="text-right" title="Guardados sobre las vistas (solo TikTok)">
                Guardados
              </SortHead>
              <SortHead k="posted" sort={sort} setSort={setSort}>
                Fecha
              </SortHead>
              <SortHead k="duration" sort={sort} setSort={setSort} className="text-right">
                Duración
              </SortHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((v, i) => (
              <TableRow key={v.key} className={cn('cursor-pointer', v.relevant === false && 'opacity-60')} onClick={() => go(r.id, v.key)}>
                <TableCell className="text-right text-muted-foreground tabular-nums">{page * PAGE + i + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {v.thumb ? <img src={researchApi.file(r.id, v.key, 'thumb.jpg')} alt="" loading="lazy" className="h-14 w-10 flex-none rounded object-cover" /> : <div className="h-14 w-10 flex-none rounded bg-muted" />}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="line-clamp-2 text-sm font-medium" title={v.title}>
                        {v.analysis?.topic || firstLine(v.title) || v.key}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <PlatformBadge p={v.platform} className="px-1.5 py-0 text-[10px]" />@{v.author}
                        {v.followers != null && ` · ${num(v.followers)} seguidores`}
                        {v.relevant === false && v.reason && <span className="text-amber-500">· {v.reason}</span>}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <ScoreBar score={v.score} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{num(v.views)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(v.perDay)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(v.ratio)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(v.engagement)}</TableCell>
                <TableCell className="text-right tabular-nums">{v.saves != null && v.views ? pct(v.saves / v.views) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{day(v.posted)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{v.duration != null ? fmtTime(v.duration) : '—'}</TableCell>
                <TableCell>
                  {v.state === 'ready' ? (
                    <Badge variant="secondary" className="gap-1 font-normal" title="Ábrelo para ver su análisis">
                      <Sparkles className="size-3" /> Analizado
                    </Badge>
                  ) : v.state === 'pending' || v.state === 'processed' ? null : (
                    <StateBadge r={v} />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!shown.length && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Ningún video con estos filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} de {rows.length}
          <Button size="icon-sm" variant="ghost" disabled={!page} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
            <ChevronRight />
          </Button>
        </div>
      )}
    </section>
  );
}

function ScoreBar({score}: {score: number | null}) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-sky-500' : 'bg-muted-foreground/50')} style={{width: `${score}%`}} />
      </span>
      <span className="w-6 tabular-nums">{score}</span>
    </span>
  );
}

function ScoreHelp() {
  return (
    <div className="space-y-2 font-normal">
      <p className="font-medium">Puntaje (0–100)</p>
      <p className="text-muted-foreground">Cómo rinde el video frente a los demás de esta investigación que le sirven a tu audiencia, en:</p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        <li>vistas por día desde que se publicó (35 %)</li>
        <li>vistas (25 %)</li>
        <li>vistas sobre los seguidores de su autor (20 %; solo TikTok los da)</li>
        <li>interacción: likes, comentarios, compartidos y guardados sobre vistas (20 %)</li>
      </ul>
      <p className="text-muted-foreground">Lo que una plataforma no da se reparte entre lo demás.</p>
    </div>
  );
}

/* ───── A video's card ───── */

function VideoDialog({id, videoKey, st, onClose}: {id: string; videoKey: string | null; st: ResearchStatus; onClose: () => void}) {
  const confirm = useConfirm();
  const [v, setV] = useState<ResearchVideoDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!videoKey) return setV(null);
    researchApi.video(id, videoKey).then(setV, (e: Error) => setErr(e.message));
  }, [id, videoKey]);
  useEffect(() => {
    setErr('');
    load();
  }, [load]);
  useSocket((m) => m.type === 'research' && load());
  const analyse = async (x: ResearchVideoDetail) => {
    if (x.platform === 'youtube' && x.state === 'pending' && !st.youtubeDownloader) return setErr('Para analizar YouTube Shorts falta yt-dlp: instálalo en Ajustes → Requisitos → Descarga de YouTube.');
    if (x.analysis && !(await confirm({title: '¿Volver a analizar este video?', description: 'El agente lo analiza otra vez con tu suscripción y reemplaza el análisis de ahora; después rehace el informe.', action: 'Analizar'}))) return;
    setBusy(true);
    setErr('');
    try {
      await researchApi.analyse(id, {keys: [x.key]});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const relevant = (x: ResearchVideoDetail, ok: boolean) => researchApi.setRelevant(id, x.key, ok).then(load, (e: Error) => setErr(e.message));
  const working = !!v && (v.state === 'processing' || v.state === 'analyzing');
  const a = v?.analysis;
  return (
    <Dialog open={!!videoKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {!v ? (
          <>
            <DialogHeader>
              <DialogTitle>Video</DialogTitle>
            </DialogHeader>
            {err ? <p className="text-sm text-destructive">{err}</p> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{a?.topic || firstLine(v.title) || v.key}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-1.5">
                <PlatformBadge p={v.platform} />
                @{v.author}
                {v.authorName && v.authorName.toLowerCase() !== v.author ? ` (${v.authorName})` : ''} · {v.posted ? new Date(v.posted).toLocaleDateString('es', {day: 'numeric', month: 'long', year: 'numeric'}) : 'sin fecha'}
                {v.region ? ` · ${v.region}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={a ? 'ghost' : 'default'} disabled={busy || working} onClick={() => void analyse(v)} title="Lo baja, lo transcribe y el agente analiza el gancho, la estructura, los recursos visuales y la CTA">
                {busy || working ? <Loader2 className="animate-spin" /> : a ? <RefreshCw /> : <Sparkles />} {v.state === 'analyzing' ? 'Analizando…' : v.state === 'processing' ? 'Bajando y transcribiendo…' : a ? 'Volver a analizar' : 'Analizar video'}
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={v.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Ver en {PLATFORM[v.platform].short}
                </a>
              </Button>
              <div className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
                ¿Le sirve a tu audiencia?
                <Button size="icon-sm" variant={v.relevant === true ? 'secondary' : 'ghost'} onClick={() => void relevant(v, true)} aria-label="Sí le sirve" title="Sí le sirve: entra en el ranking y el informe">
                  <ThumbsUp className={cn(v.relevant === true && 'text-emerald-500')} />
                </Button>
                <Button size="icon-sm" variant={v.relevant === false ? 'secondary' : 'ghost'} onClick={() => void relevant(v, false)} aria-label="No le sirve" title="No le sirve: sale del ranking y del informe">
                  <ThumbsDown className={cn(v.relevant === false && 'text-amber-500')} />
                </Button>
              </div>
            </div>
            {v.reason && <p className="text-xs text-muted-foreground">{v.relevant === false ? 'No le sirve' : 'Le sirve'}: {v.reason}</p>}
            {err && <p className="text-sm text-destructive">{err}</p>}

            <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                {v.files.thumb && <img src={researchApi.file(id, v.key, 'thumb.jpg')} alt="" className="w-full rounded-md" />}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <Stat label="Puntaje" value={v.score != null ? `${v.score}/100` : '—'} />
                  <Stat icon={Eye} label="Vistas" value={num(v.views)} />
                  <Stat label="Por día" value={num(v.perDay)} />
                  <Stat icon={Heart} label="Likes" value={num(v.likes)} />
                  <Stat icon={MessageCircle} label="Coment." value={num(v.comments)} />
                  {v.shares != null && <Stat icon={Share2} label="Compart." value={num(v.shares)} />}
                  {v.saves != null && <Stat icon={Bookmark} label="Guardados" value={num(v.saves)} />}
                  {v.followers != null && <Stat icon={Users} label="Seguidores" value={num(v.followers)} />}
                  {v.ratio != null && <Stat label="× seguid." value={ratio(v.ratio)} />}
                  <Stat label="Interacción" value={pct(v.engagement)} />
                  <Stat icon={Clock} label="Duración" value={v.duration != null ? fmtTime(v.duration) : '—'} />
                  {v.transcript?.wps != null && <Stat label="Palabras/s" value={v.transcript.wps.toFixed(1)} />}
                </dl>
                <p className="text-xs text-muted-foreground">Encontrado con: {v.queries.map((q) => `«${q}»`).join(', ')}</p>
              </div>

              <div className="flex min-w-0 flex-col gap-5 text-sm">
                {v.state === 'error' && <p className="text-destructive">{v.error}</p>}
                {v.state === 'processing' && <p className="text-muted-foreground">Bajando el video, transcribiéndolo y sacando sus fotogramas…</p>}
                {v.state === 'analyzing' && <p className="text-muted-foreground">El agente lo está analizando…</p>}
                {a && <AnalysisSections a={a} takeaways="Qué tomar" />}
                {v.title && (
                  <Section title={v.platform === 'youtube' ? 'Título y descripción' : 'Caption'}>
                    <p className="line-clamp-8 whitespace-pre-wrap text-muted-foreground">{v.title}</p>
                  </Section>
                )}
                {v.transcript && <TranscriptSection key={v.key} t={v.transcript} />}
                <FramesSection key={`f-${v.key}`} files={v.files} url={(f) => researchApi.file(id, v.key, f)} duration={v.duration} />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Icon = React.ComponentType<{className?: string}>;
function Stat({icon: I, label, value}: {icon?: Icon; label: string; value: string}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center justify-end gap-1.5 tabular-nums">
        {I && <I className="size-3.5 flex-none text-muted-foreground" />}
        {value}
      </dd>
    </>
  );
}
