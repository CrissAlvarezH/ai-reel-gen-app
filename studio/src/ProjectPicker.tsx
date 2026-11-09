// The project selector at the top of the sidebar: which channel the studio is working on. Each project has
// its own videos, Mi cuenta, profile, voice and conversations (projects/<id>/); Inspiración, keys, styles and
// tools are shared. Opening another one reloads every page on it. Its name and picture change in Ajustes → Proyecto.
import {useCallback, useEffect, useState} from 'react';
import {Check, ChevronsUpDown, CloudDownload, Loader2, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';
import {useConfirm} from './confirm';
import {cloudApi, projectsApi, syncApi, useSocket, type CloudProjectView, type Project, type ProjectSyncState, type SyncClone, type SyncOverview, type SyncProjectStatus} from './api';

// A project's picture, or its initial on a soft pastel of its own (the same letter, the same colour).
export function ProjectAvatar({project, className}: {project: Pick<Project, 'id' | 'name' | 'avatar'> | null; className?: string}) {
  const url = project ? projectsApi.avatarUrl(project) : null;
  if (url) return <img src={url} alt="" className={cn('flex-none rounded object-cover', className)} />;
  const letter = (project?.name ?? '·').trim().charAt(0).toUpperCase() || '·';
  const plain = letter.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hue = (plain.charCodeAt(0) * 47) % 360;
  return (
    <span className={cn('flex flex-none items-center justify-center rounded font-semibold', className)} style={{background: `hsl(${hue} 42% 74%)`, color: `hsl(${hue} 38% 22%)`}}>
      {letter}
    </span>
  );
}

// The projects, kept fresh when one is renamed or gets a picture (Ajustes → Proyecto).
export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => projectsApi.list().then(setProjects, (e: Error) => setErr(e.message));
  useEffect(() => void load(), []);
  useSocket((m) => m.type === 'projects' && void load(), load);
  return {projects, setProjects, err, setErr};
}

const SYNC_LABEL: Record<ProjectSyncState, string> = {local: 'Solo local', cloud: 'En la nube', synced: 'Sincronizado', changes: 'Con cambios', conflict: 'Conflicto', syncing: 'Sincronizando…', error: 'Error'};
function syncLabel(s: SyncProjectStatus) {
  if (s.state === 'syncing') return s.total ? `Sincronizando… (${s.done}/${s.total})` : SYNC_LABEL.syncing;
  if (s.state === 'changes') return `Con cambios (↑${s.up} ↓${s.down})`;
  if (s.state === 'conflict') return `Conflicto (${s.conflicts})`;
  return SYNC_LABEL[s.state];
}
const sizeOf = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// compact: only its picture (the sidebar contracted), named on hover.
export function ProjectPicker({compact = false}: {compact?: boolean}) {
  const {projects, setProjects, err, setErr} = useProjects();
  const [creating, setCreating] = useState(false); // the new project's dialog
  const current = projects?.find((p) => p.current) ?? null;
  const [sync, setSync] = useState<SyncOverview | null>(null);
  const [remote, setRemote] = useState<CloudProjectView[]>([]);
  const confirm = useConfirm();
  // On opening the menu: it asks the disk and the account, and nobody is looking until then.
  const loadSync = useCallback(() => {
    syncApi.overview().then(setSync, () => setSync(null));
    cloudApi.projects().then((p) => setRemote(p.remoteOnly), () => setRemote([]));
  }, []);
  const statusOf = (id: string) => sync?.projects.find((p) => p.id === id);
  const cloneOf = (id: string): SyncClone | undefined => sync?.clones.find((c) => c.cloudId === id);
  useSocket((m) => {
    if (m.type === 'projects' || m.type === 'cloud') loadSync();
    if (m.type !== 'sync') return;
    if (m.state === 'cloning') return setSync((s) => (s ? {...s, clones: s.clones.map((c) => (c.folder === m.project ? {...c, running: true, done: m.done, total: m.total} : c))} : s));
    if (m.state === 'done' && sync?.clones.some((c) => c.folder === m.project)) void offerKeys();
    loadSync();
  });
  const bring = async (id: string) => {
    try {
      await syncApi.clone(id);
      loadSync();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  // A computer that just got a project usually doesn't have its keys yet.
  const offerKeys = async () => {
    const keys = await cloudApi.keys().catch(() => null);
    const missing = keys?.keys.filter((k) => k.state === 'cloud' && !k.unreadable).length ?? 0;
    if (missing && (await confirm({title: `Tu cuenta tiene ${missing} ${missing === 1 ? 'clave' : 'claves'} que este equipo no`, description: 'Puedes traerlas para usar el proyecto aquí.', action: 'Ver mis claves'}))) location.hash = '#/ajustes/modo';
  };

  // The page reloads when the server says the project changed (main.tsx); start from the library.
  const open = async (id: string) => {
    if (id === current?.id) return;
    try {
      location.hash = '#/';
      setProjects(await projectsApi.open(id));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && loadSync()}>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <button title={err || `Proyecto: ${current?.name ?? '…'}`} className="mx-2 mt-2 flex justify-center rounded-md border bg-background/40 py-1.5 hover:bg-muted data-[state=open]:bg-muted">
              <ProjectAvatar project={current} className="size-7 text-xs" />
            </button>
          ) : (
            <button
              title={err || 'Proyecto: cada canal con sus videos, su cuenta, su perfil y su voz'}
              className="mx-2 mt-2 flex items-center gap-2 rounded-md border bg-background/40 px-2 py-1.5 text-left text-sm hover:bg-muted data-[state=open]:bg-muted"
            >
              <ProjectAvatar project={current} className="size-6 text-xs" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Proyecto</span>
                <span className={cn('truncate font-medium', !current && 'text-muted-foreground')}>{current?.name ?? (err ? 'Error' : (
                  <span role="status" aria-live="polite" className="shimmer mt-0.5 block h-3.5 w-20 animate-pulse rounded-md bg-muted">
                    <span className="sr-only">Cargando…</span>
                  </span>
                ))}</span>
              </span>
              <ChevronsUpDown className="size-4 flex-none text-muted-foreground" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Proyectos</DropdownMenuLabel>
          {projects?.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => void open(p.id)} className="gap-2">
              <ProjectAvatar project={p} className="size-5 text-[10px]" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{p.name}</span>
                {statusOf(p.id) && <span className="truncate text-[10px] text-muted-foreground">{syncLabel(statusOf(p.id)!)}</span>}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{p.videos}</span>
              <Check className={cn('size-4', !p.current && 'invisible')} />
            </DropdownMenuItem>
          ))}
          {remote.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">En tu cuenta</DropdownMenuLabel>
              {remote.map((r) => {
                const c = cloneOf(r.id);
                const count = r.sync ? r.sync.docs + r.sync.files : 0;
                const size = r.sync ? `${sizeOf(r.sync.bytes)} · ${count} ${count === 1 ? 'archivo' : 'archivos'}` : 'Sin datos todavía';
                return (
                  <DropdownMenuItem key={r.id} disabled={c?.running} onSelect={(e) => (e.preventDefault(), void bring(r.id))} className="gap-2">
                    {c?.running ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{r.name}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {c?.running ? `Trayendo… ${c.total ? `(${c.done}/${c.total})` : ''}` : c?.error ? `Se interrumpió: ${c.error}` : c ? `Continuar · ${size}` : `Traer a este equipo · ${size}`}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2">
            <Plus /> Nuevo proyecto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={creating}
        title="Nuevo proyecto"
        description="Un proyecto es un canal: tendrá sus propios videos, su cuenta de Instagram, su perfil, su voz y sus conversaciones. Inspiración, las claves, los estilos y las herramientas se comparten."
        initial=""
        action="Crear y abrir"
        onOpenChange={setCreating}
        onSubmit={async (name, audience) => {
          location.hash = '#/';
          setProjects(await projectsApi.create(name, audience));
          setCreating(false);
        }}
      />
    </>
  );
}

function NameDialog({
  open,
  title,
  description,
  initial,
  action,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: string;
  action: string;
  onOpenChange: (o: boolean) => void;
  onSubmit: (name: string, audience: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [audience, setAudience] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initial);
      setAudience('');
      setErr('');
    }
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr('');
            try {
              await onSubmit(name, audience);
            } catch (x) {
              setErr((x as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input autoFocus placeholder="Nombre del canal" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-audience">Público (opcional)</Label>
            <Input id="project-audience" placeholder="Para quién son los videos (p. ej. desarrolladores junior)" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} />
            <p className="text-xs text-muted-foreground">Si aún no lo tienes claro, déjalo vacío: el agente lo completará cuando lo tenga claro y te avisará.</p>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />} {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
