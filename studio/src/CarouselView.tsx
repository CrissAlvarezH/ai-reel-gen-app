// A carousel's page: the selected slide big, the slides in order as thumbnails with their number, a counter and the
// arrows (← →) to go through them, in place of a video's player and timeline. The draft (carousel.json) can be
// reordered (drag a thumbnail, or move the selected one), added to or duplicated; a version (out/vN/) is fixed and is
// what gets exported. «Comentar aquí» notes the slide shown (its stable id, its number and the version) for the next
// message, like a video's frame comments. Below: progress, the fact audit by slide, the style, and the caption, credits
// and comment automation.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, Copy, Download, Eye, FolderOpen, GalleryHorizontalEnd, ImageOff, Loader2, MessageSquarePlus, MoveLeft, MoveRight, Palette, Plus, RefreshCw, Trash2, X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import DetailSkeleton from '@/components/common/DetailSkeleton';
import {api, chatApi, fmtAgo, useLive, type CarouselDetail, type Comment} from './api';
import {ReelProgress} from './ReelProgress';
import {ReelAudit} from './Audit';
import {AutomationTab, CaptionTab, TextFileTab} from './ReelView';
import {useStyles} from './StylePicker';
import {Poster} from './Styles';
import {projectKey, useStudio} from './studio';
import {useConfirm} from './confirm';

const DRAFT = 'draft';

// A slide as it's shown: from the draft (with the newest picture rendered of it) or from a version.
type Shown = {id: string; title: string; text: string; url: string | null; version: string | null; stale: boolean; source: boolean};

function shownOf(c: CarouselDetail, sel: string): Shown[] {
  if (sel === DRAFT) return c.slides.map((s) => ({id: s.id, title: s.title, text: s.text, url: s.image?.url ?? null, version: s.image?.version ?? null, stale: !!s.image?.stale, source: s.source}));
  const v = c.versions.find((x) => x.name === sel);
  return (v?.slides ?? []).map((s) => ({id: s.id, title: s.title, text: s.text, url: s.url, version: v!.name, stale: false, source: true}));
}

export function CarouselView({slug}: {slug: string}) {
  const [c, setC] = useState<CarouselDetail | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.carousel(slug).then(setC, (e: Error) => setErr(e.message)), [slug]);
  useEffect(() => void load(), [load]);
  useLive((s) => s === slug && void load());
  const studio = useStudio();
  const comments = studio.comments[slug] ?? [];
  if (studio.uiRef.current.slug !== slug || studio.uiRef.current.page !== 'carousel') studio.uiRef.current = {page: 'carousel', slug};
  const {setReelTitle} = studio;
  const name = c ? (c.title ?? c.slug) : null;
  useEffect(() => {
    setReelTitle(name);
    return () => setReelTitle(null);
  }, [name, setReelTitle]);

  if (err) return <p className="p-6 text-destructive">{err}</p>;
  if (!c) return <DetailSkeleton />;
  return (
    <main className="flex flex-col gap-4 p-6">
      <Slides carousel={c} comments={comments} onComment={(x) => studio.addComment(slug, x)} onChanged={setC} />
      <ReelProgress steps={c.progress} />
      <ReelAudit slug={c.slug} />
      <CarouselStyle carousel={c} onChanged={load} />
      <CarouselTexts carousel={c} />
    </main>
  );
}

/* ───────────── The slides: big one, thumbnails, versions ───────────── */

function Slides({carousel: c, comments, onComment, onChanged}: {carousel: CarouselDetail; comments: Comment[]; onComment: (c: Comment) => void; onChanged: (c: CarouselDetail) => void}) {
  const confirm = useConfirm();
  const [sel, setSel] = useState<string>(DRAFT);
  // A version that's gone (deleted on disk) falls back to the draft; a new render is selected as it appears.
  const newest = c.versions[0]?.name;
  const prevNewest = useRef(newest);
  useEffect(() => {
    if (newest && prevNewest.current && newest !== prevNewest.current && sel !== DRAFT) setSel(newest);
    else if (sel !== DRAFT && !c.versions.some((v) => v.name === sel)) setSel(DRAFT);
    prevNewest.current = newest;
  }, [newest, c.versions, sel]);
  const draft = sel === DRAFT;
  const shown = useMemo(() => shownOf(c, sel), [c, sel]);
  // The selected slide is kept by id, so it stays the same slide when the order changes.
  const [cur, setCur] = useState<string | null>(null);
  const i = Math.max(0, shown.findIndex((s) => s.id === cur));
  const slide = shown[i] ?? null;
  const go = (n: number) => shown.length && setCur(shown[(n + shown.length) % shown.length].id);
  const [busy, setBusy] = useState('');
  const [actionErr, setActionErr] = useState('');
  const run = async (what: string, fn: () => Promise<CarouselDetail | void>) => {
    setBusy(what);
    setActionErr('');
    try {
      const next = await fn();
      if (next) onChanged(next);
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  // Where he is, for the agent.
  const {uiRef} = useStudio();
  Object.assign(uiRef.current, {version: draft ? undefined : sel, slide: slide?.id, slideN: slide ? i + 1 : undefined});

  // ← and → go through the slides when nothing that takes typing has the focus.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
      if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // The draft doesn't change while the studio renders it (the server refuses too).
  const locked = !!busy || c.rendering;
  // to: the place it ends up at.
  const move = (id: string, to: number) => {
    const order = c.slides.map((s) => s.id).filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    if (order.join() === c.slides.map((s) => s.id).join()) return;
    void run('order', () => api.reorderSlides(c.slug, order));
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const commented = new Set(comments.map((x) => x.slide?.id).filter(Boolean));
  const exportName = draft ? newest : sel;

  return (
    <Card className="gap-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-none text-sm text-muted-foreground">Versión</span>
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="min-w-48 flex-1 sm:max-w-80" aria-label="Versión del carrusel">
              {/* Just which one: the list has the details. */}
              <SelectValue>{draft ? `Borrador · ${c.slides.length} ${c.slides.length === 1 ? 'lámina' : 'láminas'}` : sel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DRAFT}>
                Borrador · {c.slides.length} {c.slides.length === 1 ? 'lámina' : 'láminas'}
              </SelectItem>
              {c.versions.length > 0 && <SelectSeparator />}
              {c.versions.map((v) => (
                <SelectItem key={v.name} value={v.name}>
                  {v.name}
                  <span className="text-muted-foreground">
                    {fmtAgo(v.created)} · {v.slides.length} láminas{v.note ? ` · ${v.note.slice(0, 40)}` : ''}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Preview slides={shown} caption={c.caption} start={i} />
            {draft && (
              <Button
                variant="outline"
                onClick={() => run('render', () => api.renderCarousel(c.slug).then(() => {}))}
                disabled={c.rendering || c.installing || !c.slides.length || !!busy}
                title={c.installing ? 'Aún se están instalando sus dependencias' : 'Renderiza el borrador como una versión nueva'}
              >
                {c.rendering || busy === 'render' ? <Loader2 className="animate-spin" /> : <RefreshCw />} {c.rendering ? 'Renderizando…' : 'Renderizar versión'}
              </Button>
            )}
            {exportName && (
              <>
                <Button
                  title={`Descarga las imágenes de ${exportName}, numeradas y en orden (${c.width}×${c.height}), con el caption y los créditos`}
                  disabled={busy === 'export'}
                  onClick={() => run('export', () => download(api.exportUrl(c.slug, exportName), `${c.slug}-${exportName}.zip`))}
                >
                  {busy === 'export' ? <Loader2 className="animate-spin" /> : <Download />} Exportar {exportName}
                </Button>
                <Button variant="outline" size="icon" aria-label={`Mostrar ${exportName} en su carpeta`} title={`Mostrar ${exportName} en su carpeta`} onClick={() => run('reveal', () => api.revealCarouselVersion(c.slug, exportName).then(() => {}))}>
                  <FolderOpen />
                </Button>
              </>
            )}
          </div>
        </div>
        {c.from && (
          <p className="text-xs text-muted-foreground">
            Parte del video{' '}
            <a href={`#/reel/${c.from.slug}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {c.from.title ?? c.from.slug}
            </a>
          </p>
        )}
        {actionErr && <p role="alert" className="text-sm text-destructive">{actionErr}</p>}

        {shown.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
            <GalleryHorizontalEnd className="size-8 text-muted-foreground" />
            <p className="font-medium">Aún no hay láminas</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {c.installing ? 'Se están instalando sus dependencias. ' : ''}Cuéntale al agente la idea en el panel: cuando escriba las láminas aparecerán aquí, y cuando renderice, sus imágenes.
            </p>
            {draft && (
              <Button variant="outline" size="sm" onClick={() => run('add', () => api.addSlide(c.slug, {}).then((r) => (setCur(r.id), r.carousel)))}>
                <Plus /> Añadir lámina
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
            {/* The slide shown big, with the arrows and the counter. */}
            <div className="flex flex-col gap-2">
              <div className="relative mx-auto w-full max-w-[min(100%,calc(70vh*0.8))]">
                <div className="relative grid w-full place-items-center overflow-hidden rounded-lg bg-muted" style={{aspectRatio: `${c.width} / ${c.height}`}}>
                  {slide?.url ? (
                    <img src={slide.url} alt={`Lámina ${i + 1}: ${slide.title || slide.id}`} className="size-full object-contain" />
                  ) : (
                    <NoImage slide={slide} />
                  )}
                  {slide?.stale && (
                    <Badge variant="secondary" className="absolute top-2 left-2" title="Cambió su dibujo o su texto después de esta imagen: renderiza para verla al día">
                      Cambió desde {slide.version}
                    </Badge>
                  )}
                </div>
                <SlideArrow direction="previous" onClick={() => go(i - 1)} disabled={shown.length < 2} />
                <SlideArrow direction="next" onClick={() => go(i + 1)} disabled={shown.length < 2} />
              </div>
              <p className="text-center text-sm text-muted-foreground tabular-nums" aria-live="polite">
                Lámina {i + 1} de {shown.length}
                {slide?.title ? ` · ${slide.title}` : ''}
                {slide && !draft ? ` · ${sel}` : slide?.version ? ` · imagen de ${slide.version}` : ''}
              </p>
            </div>
            {/* What's on the slide, its actions and the comment box. */}
            <div className="flex flex-col gap-3">
              {slide && (
                <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{slide.title || 'Sin título'}</span>
                    <code className="ml-auto text-[11px] text-muted-foreground">{slide.id}</code>
                  </span>
                  <p className="line-clamp-6 text-muted-foreground whitespace-pre-line">{slide.text || 'Sin texto todavía.'}</p>
                </div>
              )}
              {draft && slide && (
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => move(slide.id, i - 1)} disabled={i === 0 || locked} aria-label="Mover la lámina a la izquierda">
                    <MoveLeft /> Antes
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => move(slide.id, i + 1)} disabled={i === shown.length - 1 || locked} aria-label="Mover la lámina a la derecha">
                    Después <MoveRight />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => run('dup', () => api.addSlide(c.slug, {duplicate: slide.id}).then((r) => (setCur(r.id), r.carousel)))} disabled={locked}>
                    <Copy /> Duplicar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => run('add', () => api.addSlide(c.slug, {after: slide.id}).then((r) => (setCur(r.id), r.carousel)))} disabled={locked}>
                    <Plus /> Añadir después
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={locked}
                    onClick={async () => {
                      if (!(await confirm({title: `¿Quitar la lámina ${i + 1}?`, description: 'Sale del borrador; su dibujo (src/slides) y las versiones que la tienen se quedan como están.', action: 'Quitar lámina', destructive: true}))) return;
                      void run('remove', () => api.removeSlide(c.slug, slide.id));
                    }}
                  >
                    <Trash2 /> Quitar
                  </Button>
                </div>
              )}
              {slide && <SlideComment key={`${sel}/${slide.id}`} slug={c.slug} slide={slide} n={i + 1} draft={draft} onComment={onComment} />}
              {comments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {comments.length} {comments.length === 1 ? 'comentario espera' : 'comentarios esperan'} tu próximo mensaje en el panel del agente.
                </p>
              )}
            </div>
          </div>
        )}

        {/* The slides in order: click to show, drag to reorder (the draft). */}
        {shown.length > 0 && (
          <ol className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2" aria-label="Láminas en orden">
            {shown.map((s, k) => (
              <li
                key={s.id}
                draggable={draft && !locked}
                onDragStart={(e) => {
                  setDragging(s.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOver(k);
                }}
                onDragLeave={() => setOver((o) => (o === k ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  // Dropped on a thumbnail: before it (where the line shows).
                  const from = shown.findIndex((x) => x.id === dragging);
                  if (dragging && dragging !== s.id) move(dragging, from < k ? k - 1 : k);
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className={cn('relative flex-none', over === k && dragging !== s.id && 'before:absolute before:inset-y-0 before:-left-1.5 before:w-0.5 before:rounded before:bg-primary')}
              >
                <button
                  onClick={() => setCur(s.id)}
                  aria-current={k === i ? 'true' : undefined}
                  aria-label={`Lámina ${k + 1}: ${s.title || s.id}`}
                  className={cn('group relative block w-24 overflow-hidden rounded-md border-2 transition-colors', k === i ? 'border-foreground' : 'border-transparent hover:border-foreground/40', dragging === s.id && 'opacity-40', draft && 'cursor-grab active:cursor-grabbing')}
                >
                  <span className="block bg-muted" style={{aspectRatio: `${c.width} / ${c.height}`}}>
                    {s.url ? <img src={s.url} alt="" loading="lazy" draggable={false} className="size-full object-cover" /> : <span className="grid size-full place-items-center p-1 text-center text-[10px] leading-tight text-muted-foreground">{s.title || s.id}</span>}
                  </span>
                  <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[11px] font-medium tabular-nums">{k + 1}</span>
                  {commented.has(s.id) && <span className="absolute top-1 right-1 size-2.5 rounded-full bg-amber-400 ring-2 ring-background" title="Tiene un comentario para el agente" />}
                  {s.stale && <span className="absolute top-1 left-1 size-2.5 rounded-full bg-sky-400 ring-2 ring-background" title={`Cambió desde ${s.version}`} />}
                </button>
              </li>
            ))}
            {draft && (
              // Also where a slide is dropped to put it last.
              <li
                className={cn('relative flex-none', over === shown.length && 'before:absolute before:inset-y-0 before:-left-1.5 before:w-0.5 before:rounded before:bg-primary')}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOver(shown.length);
                }}
                onDragLeave={() => setOver((o) => (o === shown.length ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) move(dragging, shown.length - 1);
                  setDragging(null);
                  setOver(null);
                }}
              >
                <button
                  onClick={() => run('add', () => api.addSlide(c.slug, {}).then((r) => (setCur(r.id), r.carousel)))}
                  disabled={locked}
                  className="grid w-24 place-items-center rounded-md border-2 border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                  style={{aspectRatio: `${c.width} / ${c.height}`}}
                  aria-label="Añadir lámina al final"
                  title="Añadir lámina al final"
                >
                  {busy === 'add' ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
                </button>
              </li>
            )}
          </ol>
        )}
        {draft && shown.length > 1 && <p className="-mt-1 text-xs text-muted-foreground">Arrastra las miniaturas para cambiar el orden del borrador; el agente lo verá en tu próximo mensaje. Una versión nueva lo recoge al renderizar.</p>}
      </CardContent>
    </Card>
  );
}

function NoImage({slide}: {slide: Shown | null}) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
      <ImageOff className="size-8" />
      <p className="text-sm font-medium text-foreground">{slide?.title || 'Lámina sin render'}</p>
      <p className="text-xs">{slide?.source ? 'Aún no tiene imagen: aparece al renderizar una versión.' : 'El agente aún no la ha dibujado.'}</p>
    </div>
  );
}

// «Comentar aquí» on the slide shown: its picture goes with the note (copied to out/studio-frames/ like a video's frame).
function SlideComment({slug, slide, n, draft, onComment}: {slug: string; slide: Shown; n: number; draft: boolean; onComment: (c: Comment) => void}) {
  const [draftText, setDraftText] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | undefined>();
  const [grabErr, setGrabErr] = useState('');
  const start = async () => {
    setDraftText('');
    setFrame(undefined);
    setGrabErr('');
    if (!slide.url) return;
    try {
      const blob = await fetch(slide.url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))));
      const {path} = await chatApi.frame(slug, blob.type === 'image/png' ? blob : new Blob([blob], {type: 'image/png'}));
      setFrame(path);
    } catch (e) {
      setGrabErr(`No pude adjuntar la imagen (${(e as Error).message}); el comentario irá sin ella.`);
    }
  };
  const add = () => {
    if (!draftText?.trim()) return;
    onComment({id: `${Date.now()}`, t: 0, text: draftText.trim(), frame, slide: {id: slide.id, n, title: slide.title || undefined, version: slide.version, ...(draft ? {draft: true} : {})}});
    setDraftText(null);
  };
  if (draftText === null)
    return (
      <Button variant="secondary" onClick={start}>
        <MessageSquarePlus /> Comentar aquí · lámina {n}
      </Button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        Comentario en la lámina {n} ({slide.id}) · {!slide.url ? 'sin imagen' : frame ? 'imagen adjunta' : grabErr ? 'sin imagen' : 'adjuntando imagen…'}
      </p>
      {grabErr && <p className="text-xs text-destructive">{grabErr}</p>}
      <Textarea
        autoFocus
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            add();
          }
          if (e.key === 'Escape') setDraftText(null);
        }}
        placeholder="¿Qué cambiarías en esta lámina? (Enter añade)"
        rows={3}
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">Se envía al agente con tu próximo mensaje.</span>
        <Button variant="ghost" size="sm" onClick={() => setDraftText(null)}>
          Cancelar
        </Button>
        <Button size="sm" onClick={add} disabled={!draftText.trim()}>
          Añadir
        </Button>
      </div>
    </div>
  );
}

function SlideArrow({direction, onClick, disabled}: {direction: 'previous' | 'next'; onClick: () => void; disabled?: boolean}) {
  const previous = direction === 'previous';
  const Icon = previous ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={previous ? 'Lámina anterior' : 'Lámina siguiente'}
      title={previous ? 'Anterior (←)' : 'Siguiente (→)'}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm',
        'enabled:cursor-pointer enabled:hover:bg-muted enabled:active:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
        previous ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

// The slides in order as they'd show on Instagram: one at a time, with the dots and the caption under them.
function Preview({slides, caption, start}: {slides: Shown[]; caption: string; start: number}) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState(0);
  const [more, setMore] = useState(false);
  const n = slides.length;
  const s = slides[Math.min(k, n - 1)];
  return (
    <>
      <Button
        variant="outline"
        disabled={!n}
        onClick={() => {
          setK(start);
          setMore(false);
          setOpen(true);
        }}
      >
        <Eye /> Ver en orden
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="gap-3 p-4 sm:max-w-md"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setK((x) => Math.min(n - 1, x + 1));
            if (e.key === 'ArrowLeft') setK((x) => Math.max(0, x - 1));
          }}
        >
          <DialogTitle className="text-base">Vista previa en orden</DialogTitle>
          <DialogDescription className="sr-only">Las láminas una a una, como en Instagram. Usa las flechas para pasar.</DialogDescription>
          {s && (
            <div className="relative overflow-hidden rounded-md bg-muted" style={{aspectRatio: '4 / 5'}}>
              {s.url ? <img src={s.url} alt={`Lámina ${k + 1}: ${s.title || s.id}`} className="size-full object-cover" /> : <NoImage slide={s} />}
              {k > 0 && <SlideArrow direction="previous" onClick={() => setK(k - 1)} />}
              {k < n - 1 && <SlideArrow direction="next" onClick={() => setK(k + 1)} />}
            </div>
          )}
          {/* Under the picture, where it can't hide the slide's own counter. */}
          <div className="flex items-center justify-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {slides.map((x, j) => (
                <span key={x.id} className={cn('size-1.5 rounded-full', j === k ? 'bg-sky-500' : 'bg-muted-foreground/40')} />
              ))}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {k + 1}/{n}
            </span>
          </div>
          {caption.trim() ? (
            <p className={cn('text-sm whitespace-pre-line', !more && 'line-clamp-2')}>
              {caption.trim()}
              {!more && (
                <button className="ml-1 text-muted-foreground" onClick={() => setMore(true)}>
                  … más
                </button>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin caption todavía.</p>
          )}
          <Button variant="ghost" size="sm" className="self-end" onClick={() => setOpen(false)}>
            <X /> Cerrar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────────── Style and texts ───────────── */

// The carousel's style, among the styles that do carousels. Changing it doesn't redo anything: the agent sees it.
function CarouselStyle({carousel: c, onChanged}: {carousel: CarouselDetail; onChanged: () => void}) {
  const confirm = useConfirm();
  const styles = useStyles()?.filter((s) => s.carousel);
  const s = styles?.find((x) => x.id === c.style?.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const change = async (id: string) => {
    if (id === c.style?.id) return;
    if (c.versionCount > 0 && !(await confirm({title: '¿Cambiar el estilo?', description: 'El carrusel ya tiene láminas hechas en el estilo actual. No se rehacen solas: el agente lo verá en tu próximo mensaje y te preguntará antes.', action: 'Cambiar estilo'}))) return;
    setBusy(true);
    setErr('');
    try {
      await api.setStyle(c.slug, id);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sample = s?.carousel?.examples[0];
  return (
    <div className="flex gap-4 rounded-xl border bg-card p-4">
      <a href={s ? `#/estilos/${s.id}` : '#/estilos'} className="h-24 flex-none overflow-hidden rounded-md" title="Ver el estilo">
        {sample ? <img src={sample} alt="" loading="lazy" className="aspect-[4/5] h-full w-auto object-cover" /> : s ? <Poster style={s} className="h-full text-[8px]" /> : <div className="aspect-[4/5] h-full rounded-sm bg-muted" />}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Estilo</span>
          <Select value={c.style?.id ?? ''} onValueChange={change} disabled={busy}>
            <SelectTrigger size="sm" className="ml-auto w-56" aria-label="Estilo del carrusel">
              {busy ? <Loader2 className="animate-spin" /> : <Palette />}
              <SelectValue placeholder="Elige un estilo" />
            </SelectTrigger>
            <SelectContent>
              {styles?.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <span className="font-medium">{s?.name ?? c.style?.name ?? 'Sin estilo'}</span>
        {s?.carousel?.look[0] && <p className="line-clamp-2 text-sm text-muted-foreground">{s.carousel.look[0]}</p>}
        {s && (
          <span className="mt-auto flex gap-1">
            {s.palette.map((p) => (
              <span key={p.hex} title={`${p.name}: ${p.meaning}`} className="size-3.5 rounded-full border border-foreground/15" style={{background: p.hex}} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

const TABS = {caption: 'Caption IG', credits: 'Créditos', automation: 'Instrucciones automatización'} as const;
type Tab = keyof typeof TABS;

function CarouselTexts({carousel: c}: {carousel: CarouselDetail}) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem(projectKey('studio.carousel.tab'));
      return t && t in TABS ? (t as Tab) : 'caption';
    } catch {
      return 'caption';
    }
  });
  const pick = (k: string) => {
    setTab(k as Tab);
    try {
      localStorage.setItem(projectKey('studio.carousel.tab'), k);
    } catch {
      /* private mode */
    }
  };
  useStudio().uiRef.current.tab = TABS[tab];
  return (
    <Card>
      <CardContent>
        <Tabs value={tab} onValueChange={pick}>
          <TabsList>
            {(Object.keys(TABS) as Tab[]).map((k) => (
              <TabsTrigger key={k} value={k}>
                {TABS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="caption" className="pt-3">
            <CaptionTab reel={c} />
          </TabsContent>
          <TabsContent value="credits" className="pt-3">
            <TextFileTab slug={c.slug} path="CREDITS.md" disk={c.credits} hint="de dónde sale cada imagen y cada dato" />
          </TabsContent>
          <TabsContent value="automation" className="pt-3">
            <AutomationTab reel={c} what="este carrusel" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// A file from the server, saved by the browser; its error (a version that's gone, an image of the wrong size) is
// thrown to be shown instead of being saved as the file.
async function download(url: string, name: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as {error?: string} | null)?.error ?? `no se pudo exportar (${r.status})`);
  const href = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), {href, download: name});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
