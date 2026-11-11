import {useCallback, useEffect, useMemo, useState} from 'react';
import {Archive, Check, CheckCircle2, ChevronDown, ExternalLink, Film, Loader2, MessageSquare, RotateCcw, Settings as SettingsIcon, ShieldCheck, Square, Trash2, Undo2, Zap} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import ListSkeleton from '@/components/common/ListSkeleton';
import EmptyState from '@/components/common/EmptyState';
import {api, auditApi, fmtAgo, useSocket, type FactAuditView, type FactFinding, type FactReport, type FactReportState, type FactReviewer, type PostedReel} from './api';
import {useConfirm} from './confirm';
import {EFFORT_LABELS} from './ChatControls';
import {useStudio} from './studio';

// Auditoría: three agents check, each on its own and with web sources, that the facts a video's script states are
// right (server/fact-audit.ts). On top the automatic switch and Empezar auditoría (a dialog to pick videos by their
// thumbnail, or all); the model and his instructions in Configuración. Then the reports: each with its errors and
// matices, their sources, and what he did with it.

const DEFAULT = '_default';
const VERDICT = {
  error: {label: 'Error', className: 'border-destructive/40 bg-destructive/10 text-destructive'},
  matiz: {label: 'Matiz', className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'},
  ok: {label: 'Correcto', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'},
} as const;
const STATE_LABEL: Record<FactReportState, string> = {open: 'Pendiente', resolved: 'Resuelto', archived: 'Archivado'};
const FILTERS: {id: FactReportState | 'all'; label: string}[] = [
  {id: 'open', label: 'Pendientes'},
  {id: 'resolved', label: 'Resueltos'},
  {id: 'archived', label: 'Archivados'},
  {id: 'all', label: 'Todos'},
];
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('es', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Audit() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'audit'};
  const [view, setView] = useState<FactAuditView | null>(null);
  const [err, setErr] = useState('');
  const [dialog, setDialog] = useState<'settings' | 'start' | null>(null);
  // Each video's thumbnail, the library's (slug → url).
  const [thumbs, setThumbs] = useState<Thumbs>({});
  // The ones posted on Instagram (Mi cuenta has their reel).
  const [posted, setPosted] = useState<Record<string, PostedReel>>({});
  const load = useCallback(() => auditApi.view().then(setView, (e: Error) => setErr(e.message)), []);
  const loadThumbs = useCallback(
    () =>
      api.reels().then((list) => {
        setThumbs(Object.fromEntries(list.map((r) => [r.slug, r.thumb])));
        setPosted(Object.fromEntries(list.flatMap((r) => (r.instagram ? [[r.slug, r.instagram]] : []))));
      }, () => {}),
    [],
  );
  useEffect(() => void (load(), loadThumbs()), [load, loadThumbs]);
  // Reports change while their agents work; a video's script or thumbnail changes when its agent saves it.
  useSocket(
    (m) => {
      if (m.type === 'audit') void load();
      if (m.type === 'changed') void (load(), loadThumbs());
    },
    () => void (load(), loadThumbs()),
  );

  const act = (p: Promise<FactAuditView>) => {
    setErr('');
    return p.then(setView, (e: Error) => setErr(e.message));
  };
  const auditable = view?.videos.filter((v) => v.script).length ?? 0;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Auditoría</h1>
          <Button variant="outline" size="sm" className="flex-none" disabled={!view} onClick={() => setDialog('settings')}>
            <SettingsIcon /> Configuración
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tres agentes revisan, cada uno por su lado y sin ver lo que dicen los otros, que los datos de un video sean correctos, con fuentes en la web. Luego se unen sus hallazgos en un reporte: errores, matices y datos correctos. Solo verifica datos: no juzga el estilo, el gancho ni los consejos.
        </p>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!view && !err && <ListSkeleton count={3} />}
      {view && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <Switch id="audit-auto" checked={view.settings.auto} onCheckedChange={(auto) => void act(auditApi.settings({auto}))} className="mt-0.5" aria-label="Auditoría automática" />
              <div className="min-w-0 flex-1">
                <Label htmlFor="audit-auto" className="font-medium">
                  Auditoría automática
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">Audita cada video cuando se guarda su guion, y otra vez cuando cambie. Solo corre con Reel Studio abierto.</p>
              </div>
            </section>
            <section className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
              <div>
                <h2 className="font-medium">Empezar auditoría</h2>
                <p className="mt-1 text-sm text-muted-foreground">Elige los videos que quieres auditar, o audítalos todos.</p>
              </div>
              <Button size="sm" disabled={!auditable} onClick={() => setDialog('start')}>
                <ShieldCheck /> Elegir videos
              </Button>
            </section>
          </div>
          <Reports view={view} act={act} thumbs={thumbs} posted={posted} />
          <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} view={view} act={act} />
          {dialog === 'start' && <StartDialog onClose={() => setDialog(null)} view={view} act={act} thumbs={thumbs} />}
        </>
      )}
    </main>
  );
}

type Act = (p: Promise<FactAuditView>) => Promise<void>;
type Thumbs = Record<string, string | null>;

// Configuración: the reviewers' model and effort, and his instructions for them. All three are a draft until Guardar
// (Cancelar drops them); the effort kept is only one the chosen model has ('' when it has none: its default).
function SettingsDialog({open, onClose, view, act}: {open: boolean; onClose: () => void; view: FactAuditView; act: Act}) {
  const {settings} = view;
  const effortsOf = (model: string) => view.models.find((m) => m.id === model)?.efforts ?? [];
  const [prompt, setPrompt] = useState(settings.prompt);
  const [model, setModel] = useState(settings.model);
  const [effort, setEffort] = useState(settings.effort);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPrompt(settings.prompt);
    setModel(settings.model);
    setEffort(settings.effort);
  }, [open, settings.prompt, settings.model, settings.effort]);
  const efforts = effortsOf(model);
  const pickModel = (m: string) => {
    setModel(m);
    if (!effortsOf(m).includes(effort)) setEffort('');
  };
  const changed = prompt.trim() !== settings.prompt || model !== settings.model || effort !== settings.effort;
  const save = async () => {
    setSaving(true);
    await act(auditApi.settings({prompt, model, ...(effort && efforts.includes(effort) ? {effort} : {})}));
    setSaving(false);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configuración de la auditoría</DialogTitle>
          <DialogDescription>Para todos los reportes nuevos de este proyecto.</DialogDescription>
        </DialogHeader>
        {/* Model and effort side by side; one note under both. */}
        <div className="flex flex-col gap-1.5">
          <div className={cn('grid gap-3', efforts.length > 0 && 'grid-cols-2')}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label className="text-sm">Modelo de los revisores</Label>
              <Select value={model || DEFAULT} onValueChange={(m) => pickModel(m === DEFAULT ? '' : m)}>
                <SelectTrigger className="w-full" aria-label="Modelo de los revisores">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.models.map((m) => (
                    <SelectItem key={m.id || DEFAULT} value={m.id || DEFAULT}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {efforts.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-sm">Nivel de esfuerzo</Label>
                <Select value={effort || efforts[0]} onValueChange={setEffort}>
                  <SelectTrigger className="w-full" aria-label="Nivel de esfuerzo de los revisores">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {efforts.map((e) => (
                      <SelectItem key={e} value={e}>
                        {EFFORT_LABELS[e] ?? e}
                        {e === 'high' && <span className="text-muted-foreground">· por defecto</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Con {view.agent}, el agente predeterminado de tus ajustes.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-prompt" className="text-sm">
            Instrucciones para la auditoría <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="audit-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Ej.: los datos son de Colombia; para tasas e impuestos usa solo fuentes oficiales (Banco de la República, DIAN, Superfinanciera); las cifras redondeadas a un decimal no son matiz."
          />
          <p className="text-xs text-muted-foreground">Van con cada revisor, además de su forma de trabajar.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving || !changed} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Empezar auditoría: the project's videos with their thumbnails (the library's), to pick some or all.
function StartDialog({onClose, view, act, thumbs}: {onClose: () => void; view: FactAuditView; act: Act; thumbs: Thumbs}) {
  const confirm = useConfirm();
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const ready = view.videos.filter((v) => v.script && !v.busy);
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));
  const run = async (slugs: string[]) => {
    if (slugs.length > 3 && !(await confirm({title: `¿Auditar ${slugs.length} videos?`, description: 'Cada video usa cuatro agentes que buscan en la web, uno tras otro: gasta de tu plan y puede tardar un buen rato.', action: 'Auditar'}))) return;
    setSending(true);
    await act(auditApi.run(slugs));
    setSending(false);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Empezar auditoría</DialogTitle>
          <DialogDescription>Elige los videos. Se auditan uno tras otro, cada uno con su guion de ahora.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPicked(ready.filter((v) => !v.lastAudit || v.stale).map((v) => v.slug))}>
            Elegir los no auditados
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(ready.map((v) => v.slug))}>
            Elegir todos
          </Button>
          {picked.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
              Quitar selección
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{picked.length ? plural(picked.length, 'elegido', 'elegidos') : ''}</span>
        </div>
        <ul className="-mx-1 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 overflow-y-auto px-1 py-1">
          {view.videos.map((v) => {
            const disabled = !v.script || v.busy;
            const on = picked.includes(v.slug);
            const thumb = thumbs[v.slug];
            return (
              <li key={v.slug}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => toggle(v.slug)}
                  className={cn('group flex w-full flex-col gap-1.5 rounded-lg text-left outline-none disabled:cursor-default', disabled && 'opacity-50')}
                >
                  <span className={cn('relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring', on ? 'ring-2 ring-primary' : !disabled && 'group-hover:ring-foreground/30')}>
                    {thumb ? <img src={thumb} alt="" loading="lazy" className="size-full object-cover object-top" /> : <Film className="size-6 text-muted-foreground" />}
                    <span className={cn('absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-md border bg-background/80 backdrop-blur', on && 'border-primary bg-primary text-primary-foreground')}>{on && <Check className="size-3.5" />}</span>
                  </span>
                  <span className="line-clamp-2 text-xs font-medium">{v.title}</span>
                  <span className="text-[11px] text-muted-foreground">{!v.script ? 'Sin guion' : v.busy ? 'Auditando…' : v.lastAudit ? (v.stale ? 'El guion cambió' : `Auditado ${fmtAgo(v.lastAudit)}`) : 'Sin auditar'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={sending || !ready.length} onClick={() => void run(ready.map((v) => v.slug))}>
            Auditar todos ({ready.length})
          </Button>
          <Button disabled={sending || !picked.length} onClick={() => void run(picked)}>
            {sending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Auditar{picked.length ? ` ${picked.length === 1 ? '1 video' : `${picked.length} videos`}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Reports({view, act, thumbs, posted}: {view: FactAuditView; act: Act; thumbs: Thumbs; posted: Record<string, PostedReel>}) {
  const [filter, setFilter] = useState<FactReportState | 'all'>('open');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, f.id === 'all' ? view.reports.length : view.reports.filter((r) => r.state === f.id).length])), [view.reports]);
  const list = filter === 'all' ? view.reports : view.reports.filter((r) => r.state === filter);
  // "Enviar al agente" sends a video's latest finished report still pending (server/fact-audit.ts agentText).
  const latest = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of view.reports) if (r.status === 'done' && r.state === 'open' && !m.has(r.slug)) m.set(r.slug, r.id);
    return m;
  }, [view.reports]);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-medium">Reportes</h2>
        <div role="tablist" className="inline-flex rounded-lg bg-muted p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', filter === f.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <EmptyState
          icon={ShieldCheck}
          className="rounded-lg py-10"
          title={filter === 'open' ? 'No hay reportes pendientes.' : filter === 'all' ? 'Todavía no hay reportes en este proyecto.' : `No hay reportes ${filter === 'resolved' ? 'resueltos' : 'archivados'}.`}
          description={filter === 'open' || filter === 'all' ? 'Empieza una auditoría arriba, o activa la automática.' : undefined}
        />
      ) : (
        list.map((r) => <ReportCard key={r.id} report={r} act={act} thumb={thumbs[r.slug] ?? null} posted={posted[r.slug]} sendable={latest.get(r.slug) === r.id} exists={view.videos.some((v) => v.slug === r.slug)} />)
      )}
    </section>
  );
}

// inVideo: on the video's own page, without its thumbnail and title.
function ReportCard({report: r, act, thumb = null, posted, sendable, exists, inVideo = false}: {report: FactReport; act: Act; thumb?: string | null; posted?: PostedReel; sendable: boolean; exists: boolean; inVideo?: boolean}) {
  const confirm = useConfirm();
  const {addAudit} = useStudio();
  const working = r.status === 'running' || r.status === 'queued';
  // Folded until he opens it, on the Auditoría page and on the video's own.
  const [open, setOpen] = useState(false);
  const errors = r.findings.filter((f) => f.verdict === 'error');
  const matices = r.findings.filter((f) => f.verdict === 'matiz');
  const ok = r.findings.filter((f) => f.verdict === 'ok');
  const send = () => {
    addAudit(r.slug, 'facts');
    location.hash = `#/reel/${r.slug}`;
  };
  const remove = async () => {
    if (await confirm({title: `¿Borrar el reporte de «${r.title}»?`, description: 'Se pierden sus hallazgos y fuentes.', action: 'Borrar', destructive: true})) void act(auditApi.remove(r.id));
  };
  return (
    <article className={cn('rounded-lg border bg-card', r.state !== 'open' && 'opacity-80')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn('size-4 flex-none text-muted-foreground transition-transform', !open && '-rotate-90')} />
          {!inVideo && (
            <span className="grid h-14 w-[42px] flex-none place-items-center overflow-hidden rounded-md bg-muted ring-1 ring-border">
              {thumb ? <img src={thumb} alt="" loading="lazy" className="size-full object-cover object-top" /> : <Film className="size-4 text-muted-foreground" />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{inVideo ? 'Última auditoría' : r.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>
                {r.trigger === 'auto' ? 'Automática' : 'Manual'} · {fmtWhen(r.created)}
                {r.stale && ' · el guion cambió desde entonces'}
              </span>
              {posted && (
                <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary" title={`Publicado en Instagram${posted.posted ? ` el ${new Date(posted.posted).toLocaleDateString('es', {day: 'numeric', month: 'long'})}` : ''}`}>
                  Publicado
                </Badge>
              )}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {working ? (
            <Badge variant="secondary">
              <Loader2 className="animate-spin" /> {r.status === 'queued' ? 'En cola' : 'Auditando'}
            </Badge>
          ) : r.status === 'done' ? (
            <>
              {errors.length > 0 && <Badge variant="outline" className={VERDICT.error.className}>{plural(errors.length, 'error', 'errores')}</Badge>}
              {matices.length > 0 && <Badge variant="outline" className={VERDICT.matiz.className}>{plural(matices.length, 'matiz', 'matices')}</Badge>}
              {!errors.length && !matices.length && <Badge variant="outline" className={VERDICT.ok.className}>Sin errores</Badge>}
            </>
          ) : (
            <Badge variant={r.status === 'stopped' ? 'outline' : 'destructive'}>{r.status === 'stopped' ? 'Detenida' : r.status === 'interrupted' ? 'Interrumpida' : 'Con error'}</Badge>
          )}
          <Badge variant="outline">{STATE_LABEL[r.state]}</Badge>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-4 border-t p-3">
          <Reviewers reviewers={r.reviewers} working={working} />
          {r.summary && <p className="text-sm">{r.summary}</p>}
          {r.error && <p className="text-sm text-destructive">{r.error}</p>}
          {r.status === 'interrupted' && <p className="text-sm text-muted-foreground">Reel Studio se cerró mientras auditaba. Vuelve a auditarlo.</p>}
          {[...errors, ...matices].length > 0 && (
            <ul className="flex flex-col gap-3">
              {[...errors, ...matices].map((f) => (
                <Finding key={f.id} f={f} />
              ))}
            </ul>
          )}
          {ok.length > 0 && <Correct findings={ok} />}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {working ? (
              <Button variant="outline" size="sm" onClick={() => void act(auditApi.stop(r.id))}>
                <Square /> Detener
              </Button>
            ) : (
              <>
                {r.state === 'open' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void act(auditApi.setState(r.id, 'resolved'))}>
                      <CheckCircle2 /> Marcar resuelto
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void act(auditApi.setState(r.id, 'archived'))}>
                      <Archive /> Archivar
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void act(auditApi.setState(r.id, 'open'))}>
                    <Undo2 /> Volver a pendiente
                  </Button>
                )}
                {sendable && exists && (errors.length > 0 || matices.length > 0) && (
                  <Button variant="ghost" size="sm" onClick={send} title="Va con tu próximo mensaje al agente de este video">
                    <MessageSquare /> Enviar al agente del video
                  </Button>
                )}
                {exists && (
                  <Button variant="ghost" size="sm" onClick={() => void act(auditApi.run([r.slug]))} title="Un reporte nuevo con el guion de ahora">
                    <RotateCcw /> Volver a auditar
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" className="ml-auto" title="Borrar el reporte" aria-label="Borrar el reporte" onClick={() => void remove()}>
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Reviewers({reviewers, working}: {reviewers: FactReviewer[]; working: boolean}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {reviewers.map((v) => (
        <li key={v.n} className="rounded-md border px-2.5 py-2 text-xs" title={v.model || undefined}>
          <p className="flex items-center gap-1.5 font-medium">
            {v.state === 'running' && working ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5 text-muted-foreground" />}
            Revisor {v.n} · {v.lens}
          </p>
          <p className={cn('mt-0.5 text-muted-foreground', v.state === 'error' && 'text-destructive')}>
            {v.state === 'done'
              ? `${plural(v.claims, 'dato revisado', 'datos revisados')}, ${v.flagged} con observaciones`
              : v.state === 'error'
                ? v.error || 'falló'
                : v.state === 'stopped'
                  ? 'Detenido'
                  : working
                    ? v.state === 'pending'
                      ? 'En espera'
                      : 'Buscando fuentes…'
                    : 'No terminó'}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Finding({f}: {f: FactFinding}) {
  const v = VERDICT[f.verdict];
  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={v.className}>
          {v.label}
        </Badge>
        {f.disputed && <Badge variant="outline">Los revisores no coincidieron</Badge>}
        <span className="text-xs text-muted-foreground">{f.agents.length ? `Lo señaló${f.agents.length > 1 ? 'n' : ''} ${f.agents.length} de 3 revisores` : ''}</span>
      </div>
      <blockquote className="border-l-2 pl-2 text-sm italic">«{f.claim}»</blockquote>
      {f.explanation && <p className="text-sm">{f.explanation}</p>}
      {f.correction && (
        <p className="text-sm">
          <span className="font-medium">Cómo decirlo: </span>
          {f.correction}
        </p>
      )}
      <Sources f={f} />
    </li>
  );
}

function Sources({f}: {f: FactFinding}) {
  if (!f.sources.length) return <p className="text-xs text-amber-600 dark:text-amber-400">Sin fuente verificable: contrástalo tú.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {f.sources.map((s) => (
        <li key={s.url} className="min-w-0 text-xs">
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
            <ExternalLink className="size-3 flex-none" />
            <span className="truncate">{s.title}</span>
            <span className="flex-none opacity-70">· {host(s.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Correct({findings}: {findings: FactFinding[]}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 self-start text-sm font-medium">
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        {plural(findings.length, 'dato correcto', 'datos correctos')}
      </button>
      {open && (
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li key={f.id} className="flex flex-col gap-1 rounded-md border px-3 py-2">
              <p className="text-sm">«{f.claim}»</p>
              {f.explanation && <p className="text-xs text-muted-foreground">{f.explanation}</p>}
              <Sources f={f} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Reel page, under the progress: this video's latest report (the others, on the Auditoría page), or an empty state
// with Auditar.
export function ReelAudit({slug}: {slug: string}) {
  const [view, setView] = useState<FactAuditView | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => auditApi.view().then(setView, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useSocket((m) => (m.type === 'audit' || (m.type === 'changed' && m.slug === slug)) && void load(), () => void load());
  const act = (p: Promise<FactAuditView>) => {
    setErr('');
    return p.then(setView, (e: Error) => setErr(e.message));
  };
  if (!view) return err ? <p className="rounded-xl border px-4 py-3 text-xs text-destructive">No pude leer la auditoría: {err}</p> : <div className="h-[82px] rounded-xl border bg-card" aria-hidden />;
  const video = view.videos.find((v) => v.slug === slug);
  const reports = view.reports.filter((r) => r.slug === slug);
  const latest = reports[0];
  const audit = (
    <Button size="sm" variant={latest ? 'ghost' : 'default'} disabled={!video?.script || video.busy} onClick={() => void act(auditApi.run([slug]))} title={video?.script ? 'Tres agentes verifican los datos del guion de ahora' : 'Este video aún no tiene guion'}>
      <ShieldCheck /> Auditar
    </Button>
  );
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-medium">Auditoría de datos</h2>
        {reports.length > 1 && (
          <a href="#/auditoria" className="text-xs text-muted-foreground hover:text-foreground">
            {plural(reports.length - 1, 'auditoría anterior', 'auditorías anteriores')} ›
          </a>
        )}
        {latest && audit}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {latest ? (
        <ReportCard key={latest.id} report={latest} act={act} sendable={latest.status === 'done' && latest.state === 'open'} exists inVideo />
      ) : (
        <EmptyState
          icon={ShieldCheck}
          className="rounded-lg py-8"
          title="Este video aún no tiene auditoría."
          description={video?.script ? 'Tres agentes verifican, cada uno por su lado y con fuentes, que los datos del guion sean correctos.' : 'Cuando tenga guion, podrás auditar sus datos.'}
          action={audit}
        />
      )}
    </section>
  );
}
