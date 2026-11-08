import {useCallback, useEffect, useRef, useState} from 'react';
import {Eye, Film, Loader2, MoreHorizontal, Plus, Trash2} from 'lucide-react';
import {AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import PageSkeleton from '@/components/common/PageSkeleton';
import CardGridSkeleton from '@/components/common/CardGridSkeleton';
import EmptyState from '@/components/common/EmptyState';
import {api, fmtAgo, fmtTime, useLive, type ReelSummary} from './api';
import {ReelProgressMini} from './ReelProgress';
import {useStudio} from './studio';

// On a video posted on Instagram (Mi cuenta has its reel): its views, and how it did against the account's median.
function PostedBadge({p}: {p: NonNullable<ReelSummary['instagram']>}) {
  const views = p.views == null ? '—' : p.views >= 1e4 ? `${Math.round(p.views / 1e3)} k` : p.views.toLocaleString('es');
  return (
    <span
      className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium tabular-nums backdrop-blur"
      title={`Publicado en Instagram${p.posted ? ` el ${new Date(p.posted).toLocaleDateString('es', {day: 'numeric', month: 'long'})}` : ''}: ${views} vistas${p.ratio != null ? `, ${p.ratio.toFixed(1)}× tu mediana` : ''} (Mi cuenta)`}
    >
      <Eye className="size-3" /> {views}
      {p.ratio != null && <span className={p.ratio >= 2 ? 'text-emerald-400' : 'text-muted-foreground'}>· {p.ratio.toFixed(1)}×</span>}
    </span>
  );
}

// Deleting a video can't be undone, so it asks for a word typed out, not just a click.
const CONFIRM_WORD = 'borrar';
function DeleteReel({reel: r, onClose, onDeleted}: {reel: ReelSummary; onClose: () => void; onDeleted: () => void}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ok = typed.trim().toLowerCase() === CONFIRM_WORD;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.remove(r.slug);
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{r.title ?? r.slug}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra para siempre todo lo de este video: sus versiones renderizadas, el guion, la voz, las imágenes, tu grabación si la tiene y sus conversaciones con el agente. No se puede deshacer.
              {r.instagram && ' El reel publicado en Instagram no se toca y sigue en Mi cuenta.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>
              Escribe <strong className="font-semibold">{CONFIRM_WORD}</strong> para confirmar
            </span>
            <Input ref={input} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} placeholder={CONFIRM_WORD} />
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              Cancelar
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!ok || busy}>
              {busy && <Loader2 className="animate-spin" />} Borrar video
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Library() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'library'};
  const [reels, setReels] = useState<ReelSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<ReelSummary | null>(null);
  const load = useCallback(() => api.reels().then(setReels, (e) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useLive(load);

  if (err) return <p className="p-6 text-destructive">{err}</p>;
  if (!reels)
    return (
      <PageSkeleton>
        <CardGridSkeleton announce={false} />
      </PageSkeleton>
    );
  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
          <p className="text-sm text-muted-foreground">
            {reels.length} {reels.length === 1 ? 'video' : 'videos'} en este proyecto
          </p>
        </div>
        {/* Like starting a new chat: opens #/nuevo, where the first message names the video. */}
        <Button asChild>
          <a href="#/nuevo">
            <Plus /> Nuevo video
          </a>
        </Button>
      </div>
      {reels.length === 0 ? (
        /* No videos yet: an invitation, not a bare count. Same door as the button above (#/nuevo). */
        <EmptyState
          icon={Film}
          className="rounded-lg py-20"
          title="Aún no hay videos en este proyecto"
          description="Abre una conversación con el agente: le cuentas la idea, la analiza contigo y luego crea el video."
          action={
            <Button asChild>
              <a href="#/nuevo">
                <Plus /> Crear el primer video
              </a>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {reels.map((r, i) => (
            <div key={r.slug} className="group hover-lift animate-fade-in relative rounded-xl" style={{animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'both'}}>
              <a href={`#/reel/${r.slug}`} className="block h-full">
                <Card className="h-full gap-0 overflow-hidden py-0 transition-colors group-hover:border-primary/40">
                  <div className="relative grid aspect-[3/4] place-items-center overflow-hidden bg-muted">
                    {r.instagram && <PostedBadge p={r.instagram} />}
                    {r.thumb ? (
                      <img src={r.thumb} alt="" loading="lazy" className="size-full object-cover object-top transition-transform group-hover:scale-[1.02]" />
                    ) : (
                      <Film className="size-8 text-muted-foreground" />
                    )}
                  </div>
                  <CardHeader className="gap-1 py-4">
                    <CardTitle className="truncate">{r.title ?? r.slug}</CardTitle>
                    <CardDescription className="line-clamp-2">{r.hook || 'Sin guion'}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pb-4">
                    <ReelProgressMini steps={r.progress} />
                    <p className="text-xs text-muted-foreground">
                      {r.videoFormat?.footage ? `${r.videoFormat.name} · ` : ''}{r.style ? `${r.style.name} · ` : ''}{r.words} palabras · ~{fmtTime(r.seconds)} · {r.versionCount} {r.versionCount === 1 ? 'versión' : 'versiones'} · {fmtAgo(r.updated)}
                    </p>
                  </CardContent>
                </Card>
              </a>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    title="Más opciones"
                    aria-label={`Más opciones de ${r.title ?? r.slug}`}
                    className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-md bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(r)}>
                    <Trash2 /> Borrar video
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
      {deleting && (
        <DeleteReel
          key={deleting.slug}
          reel={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </main>
  );
}
