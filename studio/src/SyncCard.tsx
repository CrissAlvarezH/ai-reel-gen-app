// Ajustes → Cuenta: which of this project's data goes to the account, and how that's going. The groups follow the
// allow-list in the cloud's docs/studio-cloud.md; the work itself is server/sync-queue.ts.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, CalendarClock, Clapperboard, Film, KeyRound, Lightbulb, Loader2, MessagesSquare, Newspaper, Palette, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Video, X, type LucideIcon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {Switch} from '@/components/ui/switch';
import {fmtAgo, syncApi, useSocket, type SyncConflict, type SyncDetail, type SyncGroupId, type SyncJob} from './api';
import {useConfirm} from './confirm';
import {useProjects} from './ProjectPicker';

type Group = {id: string; icon: LucideIcon; title: string; text: string};

const SYNCED: (Group & {id: SyncGroupId})[] = [
  {id: 'videos', icon: Clapperboard, title: 'Insumos de videos', text: 'Guion, código, voz e imágenes de cada uno.'},
  {id: 'ideas', icon: Lightbulb, title: 'Ideas', text: 'Tu tablero de ideas de contenido.'},
  {id: 'settings', icon: SlidersHorizontal, title: 'Perfil y ajustes', text: 'Voz, perfil de audiencia y salida de los videos.'},
  {id: 'sources', icon: Newspaper, title: 'Fuentes', text: 'Tus fuentes y lo que se extrajo de ellas.'},
  {id: 'reels', icon: Sparkles, title: 'Reels analizados', text: 'Mi cuenta e Inspiración: traerlos otra vez gasta saldo.'},
  {id: 'automations', icon: CalendarClock, title: 'Automatizaciones', text: 'Qué corre y cuándo; no su historial.'},
  {id: 'audit', icon: ShieldCheck, title: 'Auditoría', text: 'Lo que se verificó de cada video.'},
  {id: 'styles', icon: Palette, title: 'Estilos y formatos', text: 'Los tuyos, compartidos entre proyectos.'},
];

const LOCAL_ONLY: Group[] = [
  {id: 'chats', icon: MessagesSquare, title: 'Conversaciones', text: 'Tus chats con los agentes.'},
  {id: 'renders', icon: Film, title: 'Videos renderizados', text: 'Los MP4 finales de cada video.'},
  {id: 'footage', icon: Video, title: 'Grabaciones', text: 'El material que grabaste para tus videos.'},
];

// Not part of the sync cycle: keys are moved by hand from their own screen, and .env never syncs.
const SECRETS: Group = {id: 'secrets', icon: KeyRound, title: 'Secretos', text: 'Las API keys de tus servicios, cifradas en tu cuenta.'};

const NEVER = 'Nunca';
const GROUP_TITLE = Object.fromEntries(SYNCED.map((g) => [g.id, g.title])) as Record<SyncGroupId, string>;

// While loading, each text keeps its real size under the skeleton, so it wraps like the card that replaces it.
function Text({loading, children}: {loading?: boolean; children: React.ReactNode}) {
  return loading ? <Skeleton className="w-fit max-w-full text-transparent">{children}</Skeleton> : <>{children}</>;
}

function Row({group, last, loading, children}: {group: Group; last?: string; loading?: boolean; children?: React.ReactNode}) {
  const Icon = group.icon;
  return (
    <li className="flex items-center gap-3 py-2.5">
      {loading ? <Skeleton className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            <Text loading={loading}>{group.title}</Text>
          </span>
          {last && (
            <span className="shrink-0 text-xs text-muted-foreground">
              <Text loading={loading}>{last}</Text>
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          <Text loading={loading}>{group.text}</Text>
        </span>
      </span>
      {children}
    </li>
  );
}

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toLocaleString('es', {maximumFractionDigits: v < 10 ? 1 : 0})} ${units[u]}`;
};
const when = (ms: number) => new Date(ms).toLocaleString('es', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

function statusLabel(d: SyncDetail) {
  const s = d.status;
  switch (s.state) {
    case 'syncing':
      return s.total ? `Sincronizando… (${s.done}/${s.total})` : 'Sincronizando…';
    case 'conflict':
      return `Conflicto (${s.conflicts})`;
    case 'changes':
      return `Con cambios (↑${s.up} ↓${s.down})`;
    case 'error':
      return 'Error';
    case 'synced':
      return 'Sincronizado';
    default:
      return 'Solo local';
  }
}

function scopeLabel(scope: string) {
  if (scope === 'full') return 'Todo el proyecto';
  const [kind, id] = scope.split(':');
  return kind === 'group' ? (GROUP_TITLE[id as SyncGroupId] ?? id) : `Video ${id}`;
}

function jobState(j: SyncJob) {
  if (j.state === 'running') return j.total ? `Sincronizando (${j.done}/${j.total})` : 'Sincronizando…';
  if (j.state === 'pending') return j.waiting ?? 'En cola';
  if (j.state === 'done') return j.ended ? `Hecho · ${fmtAgo(j.ended)}` : 'Hecho';
  if (j.state === 'error') return j.error ?? 'Error';
  return `Se borrarían ${j.deletes} archivos en tu cuenta`;
}

// Coming back to Ajustes shows the last answer while it refreshes. A page reload (changing project does one) starts empty.
let last: SyncDetail | null = null;

export function SyncCard({loading: outerLoading}: {loading?: boolean}) {
  const {projects} = useProjects();
  const project = projects?.find((p) => p.current)?.id ?? null;
  const [detail, setDetail] = useState<SyncDetail | null>(() => last);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{path: string; content?: string; url?: string; deleted: boolean} | null>(null);
  const confirm = useConfirm();
  const seen = useRef(false);

  const apply = useCallback((d: SyncDetail) => {
    last = d;
    setDetail(d);
    setErr('');
  }, []);
  const load = useCallback(
    (refresh = false) => {
      if (!project) return;
      syncApi.detail(project, refresh).then(apply, (e: Error) => setErr(e.message));
    },
    [project, apply],
  );
  // The fast answer first, then the one that asks the account how much it holds.
  useEffect(() => {
    if (!project) return;
    load(false);
    load(true);
  }, [project, load]);
  useEffect(() => {
    if (!project) return;
    if (!detail?.status.conflicts) return setConflicts([]);
    syncApi.conflicts(project).then(setConflicts, () => {});
  }, [project, detail?.status.conflicts]);

  useSocket((m) => {
    if (m.type === 'cloud') return load(false);
    if (m.type !== 'sync' || m.project !== project) return;
    if (m.state === 'running') {
      setDetail((d) => (d ? {...d, status: {...d.status, state: 'syncing', done: m.done, total: m.total}, queue: {...d.queue, jobs: d.queue.jobs.map((j) => (j.state === 'running' ? {...j, done: m.done, total: m.total} : j))}} : d));
      if (!seen.current) load(false);
      seen.current = true;
      return;
    }
    seen.current = false;
    load(m.state === 'done');
  }, () => load(false));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = () =>
    act(async () => {
      if (!project || !detail) return;
      if (detail.first) {
        const p = await syncApi.preview(project);
        const parts = SYNCED.flatMap((g) => (p.groups[g.id] ? [`${g.title}: ${bytes(p.groups[g.id]!.bytes)}`] : []));
        const yes = await confirm({
          title: `Se van a subir ${p.files} archivos (${bytes(p.bytes)})`,
          description: `Es la primera sincronización de este proyecto. ${parts.join(' · ')}. Lo que apagues arriba no se sube.`,
          action: 'Sincronizar',
        });
        if (!yes) return;
      }
      await syncApi.run(project, {scope: 'full'});
      load(false);
    });

  const toggle = (g: SyncGroupId, on: boolean) => {
    if (!project || !detail) return;
    apply({...detail, groups: {...detail.groups, [g]: on}});
    syncApi.setGroups(project, {[g]: on}).then(apply, (e: Error) => {
      setErr(e.message);
      load(false);
    });
  };

  const confirmDeletes = async (j: SyncJob) => {
    if (!project) return;
    const yes = await confirm({
      title: `¿Borrar ${j.deletes} archivos de tu cuenta?`,
      description: 'Faltan en este equipo. Si no los borraste tú (un disco sin montar, una carpeta a medias), cancela y revisa antes.',
      action: 'Borrar en mi cuenta',
      destructive: true,
    });
    if (yes) await act(() => syncApi.run(project, {scope: j.scope, confirmDeletes: true}));
    else await act(() => syncApi.cancel(project, j.id));
    load(false);
  };

  const loading = !!outerLoading || !detail;
  const running = detail?.status.state === 'syncing';
  const history = useMemo(() => detail?.queue.history.slice(0, 5) ?? [], [detail]);
  const active = detail ? SYNCED.filter((g) => detail.groups[g.id]).length : 0;
  const remote = detail?.remote;
  const unavailable = !detail && !!err;
  const emptyDash = (v: string | undefined) => v ?? '—';
  const quota = remote ? `Proyecto: ${bytes(remote.bytes)} de ${bytes(remote.quota.projectBytes)} · Cuenta: ${bytes(remote.quota.accountUsedBytes)} de ${bytes(remote.quota.accountBytes)}` : 'Espacio en tu cuenta: aún sin datos';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text loading={loading && !unavailable}>Sincronización</Text>{' '}
          {loading && !unavailable ? <Skeleton className="h-5 w-24 rounded-full" /> : detail && <Badge variant={detail.status.state === 'error' ? 'destructive' : 'outline'}>{statusLabel(detail)}</Badge>}
        </CardTitle>
        <CardDescription>
          <Text loading={loading && !unavailable}>Lo que se guarda de este proyecto en tu cuenta, para tenerlo en otro equipo.</Text>
        </CardDescription>
        <CardAction>
          {loading && !unavailable ? (
            <Skeleton className="h-7 w-36" />
          ) : (
            <Button variant="outline" size="sm" disabled={busy || running || !detail?.linked || !active} onClick={() => void syncNow()}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar ahora
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading && !unavailable}>Última sincronización</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading && !unavailable}>{detail?.lastAt ? fmtAgo(detail.lastAt) : NEVER}</Text>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading && !unavailable}>Activos</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading && !unavailable}>
                {active} de {SYNCED.length}
              </Text>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading && !unavailable}>Base de datos</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading && !unavailable}>{emptyDash(remote ? bytes(remote.docBytes) : undefined)}</Text>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              <Text loading={loading && !unavailable}>Archivos</Text>
            </dt>
            <dd className="text-sm font-medium">
              <Text loading={loading && !unavailable}>{emptyDash(remote ? bytes(remote.fileBytes) : undefined)}</Text>
            </dd>
          </div>
          <div className="col-span-2 text-xs text-muted-foreground">
            <Text loading={loading && !unavailable}>{quota}</Text>
          </div>
        </dl>
        {running && detail && <Progress value={detail.status.total ? (detail.status.done / detail.status.total) * 100 : 5} className="h-1.5" />}
        {detail && !detail.linked && (
          <p className="text-xs text-muted-foreground">
            Este proyecto aún no está en tu cuenta. Regístralo en{' '}
            <a href="#/ajustes/proyecto" className="underline">
              Ajustes → Proyecto
            </a>{' '}
            para sincronizarlo.
          </p>
        )}
        {unavailable && <p className="text-xs text-muted-foreground">No se pudo leer el estado de la sincronización. Si acabas de actualizar la app, reiníciala.</p>}
        <ul className="flex flex-col divide-y">
          {SYNCED.map((g) => (
            <Row key={g.id} group={g} last={detail?.groupsAt[g.id] ? fmtAgo(detail.groupsAt[g.id]!) : NEVER} loading={loading && !unavailable}>
              {loading && !unavailable ? <Skeleton className="h-[18px] w-8 rounded-full" /> : <Switch checked={!!detail?.groups[g.id]} disabled={!detail?.linked} aria-label={`Sincronizar ${g.title}`} onCheckedChange={(on) => toggle(g.id, on)} />}
            </Row>
          ))}
          <Row group={SECRETS} loading={loading && !unavailable}>
            {loading && !unavailable ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <a href="#/ajustes/modo" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                Gestionar
              </a>
            )}
          </Row>
        </ul>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Text loading={loading && !unavailable}>Se quedan solo en este equipo</Text>
          </h4>
          <ul className="flex flex-col divide-y">
            {LOCAL_ONLY.map((g) => (
              <Row key={g.id} group={g} loading={loading && !unavailable} />
            ))}
          </ul>
        </div>

        {/* These only exist when there's something in them; last, so nothing above moves when they arrive. */}
        {!!conflicts.length && (
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">Conflictos</h4>
            <ul className="flex flex-col divide-y">
              {conflicts.map((c) => (
                <li key={`${c.channel}:${c.id}`} className="flex flex-col gap-1 py-2.5 text-sm">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span className="min-w-0">
                      <code className="text-xs break-all">{c.path}</code>: ganó el cambio de <em>{c.winnerDevice ?? 'otro equipo'}</em>
                      {c.winnerMtime ? ` (${when(c.winnerMtime)})` : ''}. La otra versión ({c.loserDevice ?? 'otro equipo'}
                      {c.loserMtime ? `, ${when(c.loserMtime)}` : ''}) está guardada.
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1 pl-6">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => project && void act(async () => setView(await syncApi.conflictContent(project, c.id, c.channel)))}>
                      Ver esa versión
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => project && void act(async () => (setConflicts(await syncApi.restore(project, c.id, c.channel)), load(true)))}>
                      Restaurarla
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => project && void act(async () => (setConflicts(await syncApi.dismiss(project, c.id, c.channel)), load(true)))}>
                      Descartar aviso
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!detail && (detail.queue.jobs.length > 0 || history.length > 0) && (
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-medium text-muted-foreground">Cola</h4>
            <ul className="flex flex-col divide-y">
              {[...detail.queue.jobs, ...history].map((j) => (
                <li key={j.id} className="flex items-center gap-2 py-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{scopeLabel(j.scope)}</span>
                    <span className={`truncate text-xs ${j.state === 'error' ? 'text-destructive' : j.state === 'confirm' ? 'text-amber-500' : 'text-muted-foreground'}`}>{jobState(j)}</span>
                  </span>
                  {j.state === 'confirm' && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void confirmDeletes(j)}>
                      Revisar
                    </Button>
                  )}
                  {j.state === 'error' && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => project && void act(() => syncApi.retry(project, j.id)).then(() => load(false))}>
                      <RotateCcw /> Reintentar
                    </Button>
                  )}
                  {(j.state === 'pending' || j.state === 'running') && (
                    <Button variant="ghost" size="icon" aria-label="Cancelar" disabled={busy} onClick={() => project && void act(() => syncApi.cancel(project, j.id)).then(() => load(false))}>
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && !unavailable && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-all">{view?.path}</DialogTitle>
            <DialogDescription>{view?.deleted ? 'Esa versión era un borrado del archivo.' : 'La versión que no ganó, guardada en tu cuenta.'}</DialogDescription>
          </DialogHeader>
          {view?.content !== undefined ? (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all">{view.content}</pre>
          ) : (
            view?.url && (
              <Button asChild variant="outline" size="sm" className="self-start">
                <a href={view.url} target="_blank" rel="noreferrer">
                  Abrir el archivo
                </a>
              </Button>
            )
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
