import {useCallback, useEffect, useRef, useState} from 'react';
import {Eye, LayoutGrid, Loader2, MoreHorizontal, Table2, Trash2} from 'lucide-react';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import CardGridSkeleton from '@/components/common/CardGridSkeleton';
import EmptyState from '@/components/common/EmptyState';
import {api, fmtAgo, fmtTime, useLive, type ReelSummary} from './api';
import {ReelProgressMini} from './ReelProgress';
import {ReleaseLine} from './Release';
import {LibraryTable} from './LibraryTable';
import {projectKey, read, write, useStudio} from './studio';
import {KIND, KindIcon, publicationHref} from './PublicationKind';

// "1 video", "2 carruseles": a count with its noun.
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Both doors, side by side and with the same weight: a video and a carousel.
function NewButtons({first}: {first?: boolean}) {
  return (
    <div className="flex flex-none flex-wrap justify-center gap-2">
      {(['video', 'carousel'] as const).map((k) => {
        const I = KIND[k].icon;
        return (
          <Button key={k} asChild variant="outline">
            <a href={KIND[k].href}>
              <I /> {first ? (k === 'video' ? 'Crear un video' : 'Crear un carrusel') : KIND[k].new}
            </a>
          </Button>
        );
      })}
    </div>
  );
}

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

// Deleting a publication can't be undone, so it asks for a word typed out, not just a click.
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
              {r.kind === 'carousel'
                ? 'Se borra para siempre todo lo de este carrusel: sus láminas, sus versiones renderizadas, sus imágenes y sus conversaciones con el agente. No se puede deshacer.'
                : 'Se borra para siempre todo lo de este video: sus versiones renderizadas, el guion, la voz, las imágenes, tu grabación si la tiene y sus conversaciones con el agente. No se puede deshacer.'}
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
              {busy && <Loader2 className="animate-spin" />} Borrar {r.kind === 'carousel' ? 'carrusel' : 'video'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type View = 'grid' | 'table';
const VIEW_KEY = 'studio.library.view';

export function Library() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'library'};
  const [reels, setReels] = useState<ReelSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<ReelSummary | null>(null);
  const load = useCallback(() => api.reels().then(setReels, (e) => setErr(e.message)), []);
  // Cuadrícula or Tabla: kept per project, like the table's columns.
  const [view, setView] = useState<View>(() => (read(projectKey(VIEW_KEY), 'grid') === 'table' ? 'table' : 'grid'));
  const pickView = (v: string) => {
    const next: View = v === 'table' ? 'table' : 'grid';
    setView(next);
    write(projectKey(VIEW_KEY), next);
  };
  useEffect(() => void load(), [load]);
  useLive(load);
  const carousels = reels?.filter((r) => r.kind === 'carousel').length ?? 0;
  const videos = (reels?.length ?? 0) - carousels;

  if (err) return <p className="p-6 text-destructive">{err}</p>;
  if (!reels)
    return (
      <PageSkeleton>
        <CardGridSkeleton announce={false} />
      </PageSkeleton>
    );
  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Publicaciones</h1>
            {reels.length > 0 && (
              <Tabs value={view} onValueChange={pickView}>
                <TabsList>
                  <TabsTrigger value="grid" className="px-2.5">
                    <LayoutGrid /> Cuadrícula
                  </TabsTrigger>
                  <TabsTrigger value="table" className="px-2.5">
                    <Table2 /> Tabla
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {count(reels.length, 'publicación', 'publicaciones')} en este proyecto
            {videos > 0 && ` · ${count(videos, 'video', 'videos')}`}
            {carousels > 0 && ` · ${count(carousels, 'carrusel', 'carruseles')}`}
          </p>
        </div>
        {/* Like starting a new chat: opens #/nuevo or #/nuevo-carrusel, where the first message names it. */}
        <NewButtons />
      </div>
      {reels.length === 0 ? (
        /* Nothing yet: an invitation, not a bare count. Same doors as the buttons above. */
        <EmptyState
          icon={LayoutGrid}
          className="rounded-lg py-20"
          title="Aún no hay publicaciones en este proyecto"
          description="Abre una conversación con el agente: le cuentas la idea, la analiza contigo y luego crea el video o el carrusel."
          action={<NewButtons first />}
        />
      ) : view === 'table' ? (
        <LibraryTable reels={reels} onDelete={setDeleting} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {reels.map((r, i) => {
            const carousel = r.kind === 'carousel';
            const K = KIND[r.kind] ?? KIND.video;
            return (
              <div key={r.slug} className="group animate-fade-in relative rounded-xl" style={{animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'both'}}>
                <a href={publicationHref(r.kind, r.slug)} className="block h-full">
                  <Card className="h-full gap-0 overflow-hidden py-0 transition-[box-shadow,color] group-hover:ring-foreground/30">
                    <div className="relative grid aspect-[3/4] place-items-center overflow-hidden bg-muted">
                      {r.instagram && <PostedBadge p={r.instagram} />}
                      {/* A 4:5 slide in the 3:4 box loses only a sliver of its sides, so it fills it like a video's still. */}
                      {r.thumb ? (
                        <img src={r.thumb} alt="" loading="lazy" className={cn('size-full object-cover transition-transform group-hover:scale-[1.02]', !carousel && 'object-top')} />
                      ) : (
                        <K.icon className="size-8 text-muted-foreground" aria-hidden />
                      )}
                      {/* What it is, in the same corner on every card (top-left is Instagram's, top-right the menu). */}
                      <span
                        className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium tabular-nums backdrop-blur"
                        title={carousel && r.slideCount != null ? `${K.label} · ${count(r.slideCount, 'lámina', 'láminas')}` : K.label}
                      >
                        <KindIcon kind={r.kind} className="size-3.5" />
                        {carousel && r.slideCount != null && (
                          <>
                            {r.slideCount}
                            <span className="sr-only"> {r.slideCount === 1 ? 'lámina' : 'láminas'}</span>
                          </>
                        )}
                      </span>
                    </div>
                    <CardHeader className="gap-1 py-4">
                      <CardTitle className="truncate">{r.title ?? r.slug}</CardTitle>
                      <CardDescription className="line-clamp-2">{r.hook || (carousel ? 'Sin textos' : 'Sin guion')}</CardDescription>
                      {r.release && <ReleaseLine r={r.release} />}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 pb-4">
                      <ReelProgressMini steps={r.progress} />
                      <p className="text-xs text-muted-foreground">
                        {carousel ? (
                          <>
                            {r.style ? `${r.style.name} · ` : ''}{count(r.slideCount ?? 0, 'lámina', 'láminas')} · {count(r.versionCount, 'versión', 'versiones')} · {fmtAgo(r.updated)}
                          </>
                        ) : (
                          <>
                            {r.videoFormat?.footage ? `${r.videoFormat.name} · ` : ''}{r.style ? `${r.style.name} · ` : ''}{r.words} palabras · ~{fmtTime(r.seconds)} · {count(r.versionCount, 'versión', 'versiones')} · {fmtAgo(r.updated)}
                          </>
                        )}
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
                      <Trash2 /> Borrar {carousel ? 'carrusel' : 'video'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
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
