import {useEffect, useRef, useState} from 'react';
import {ArrowRight, ArrowUp, Check, ChevronRight, Film, Lightbulb, Loader2, Mic, PenLine, Plus, Target, Video, X, type LucideIcon} from 'lucide-react';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {api, audienceApi, ideasApi, useAgentName} from './api';
import {AgentPicker, ModelPicker, useChatOptions} from './ChatControls';
import {useStudio} from './studio';
import {useStyles} from './StylePicker';
import {AUDIO_ACCEPT, FormatPoster, useFormats} from './Formats';
import {Poster} from './Styles';
import {cn} from '@/lib/utils';
import type {PublicationKind, ReelFormat, ReelSummary, Style} from './api';

// A clip of his recording, uploading (staged on the server) while he writes the message.
type Clip = {key: number; file: File; progress: number; id?: string; error?: string};
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// A new reel starts as a chat: no name to fill in. The first message goes to the server, which names
// the video, creates its folder and hands the message to the reel's agent; then we open the reel with
// its conversation already running.
// What his recording can be: video for formats that show him; audio (or a video, whose sound is used) for voiceOnly.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const AUDIO_OR_VIDEO = /\.(mp4|mov|m4v|webm|mkv|m4a|mp3|wav|aac|ogg|opus|flac)$/i;

// How it starts: he writes the idea (the default), or the agent gets one of these as the first message. A carousel can
// also start from one of the project's videos: its script is the agent's input (the carousel keeps its own files).
type Start = 'write' | 'ideas' | 'audience' | 'video';
// message: what he sees as his first message (and names the video); prompt: what the agent gets too, unseen.
const STARTS: {id: Start; icon: LucideIcon; title: string; summary: string; empty?: string; href?: string; link?: string; message?: string; prompt?: string}[] = [
  {id: 'write', icon: PenLine, title: 'Describir la idea', summary: 'Tú cuentas el tema y el mensaje.'},
  {
    id: 'ideas',
    icon: Lightbulb,
    title: 'Usar una idea guardada',
    summary: 'Te recomienda la mejor de tu tablero.',
    empty: 'Aún no tienes ideas guardadas.',
    href: '#/ideas',
    link: 'Crear ideas',
    message: 'Quiero hacer este reel con una de mis ideas guardadas.',
    prompt:
      'Quiero hacer este reel con una de mis ideas de contenido guardadas. Evalúa las del tablero con el criterio del skill content-ideas y mi perfil de audiencia, si lo tengo: cuál le interesaría más a mi público, cuál tiene el gancho más fuerte y cuál se puede hacer bien en un reel, sin repetir un video que ya hice. Tus 3 propuestas son 3 ideas de mi tablero (di de qué lista y vertical sale cada una), la mejor primero con el porqué.',
  },
  {
    id: 'audience',
    icon: Target,
    title: 'Idear para tu audiencia',
    summary: 'Parte de lo que quiere y vive tu público.',
    empty: 'Aún no has llenado tu perfil de audiencia.',
    href: '#/audiencia',
    link: 'Ir al perfil',
    message: 'Quiero un reel que le interese a mi audiencia.',
    prompt:
      'Quiero un reel que de verdad le interese a mi público. Parte de mi perfil de audiencia (lo que quieren y sus «para poder…», los problemas con los que lidian, sobre todo los primeros, y lo que piensan en cada nivel de conciencia) y del criterio del skill content-ideas. Tus 3 propuestas son 3 videos distintos entre sí (otro problema u otro nivel de conciencia), sin repetir lo que ya está en mis ideas guardadas o en mis videos.',
  },
];

// The same starts for a carousel, said for a carousel, plus starting from a video.
const CAROUSEL_STARTS: typeof STARTS = [
  {id: 'write', icon: PenLine, title: 'Describir la idea', summary: 'Tú cuentas el tema y el mensaje.'},
  {
    ...STARTS[1],
    message: 'Quiero hacer este carrusel con una de mis ideas guardadas.',
    prompt:
      'Quiero hacer este carrusel con una de mis ideas de contenido guardadas. Evalúa las del tablero con el criterio del skill content-ideas y mi perfil de audiencia, si lo tengo: cuál le interesaría más a mi público, cuál tiene la portada más fuerte y cuál se explica bien en láminas, sin repetir algo que ya hice. Tus 3 propuestas son 3 ideas de mi tablero (di de qué lista y vertical sale cada una), la mejor primero con el porqué.',
  },
  {
    ...STARTS[2],
    message: 'Quiero un carrusel que le interese a mi audiencia.',
    prompt:
      'Quiero un carrusel que de verdad le interese a mi público. Parte de mi perfil de audiencia (lo que quieren y sus «para poder…», los problemas con los que lidian, sobre todo los primeros, y lo que piensan en cada nivel de conciencia) y del criterio del skill content-ideas. Tus 3 propuestas son 3 carruseles distintos entre sí (otro problema u otro nivel de conciencia), sin repetir lo que ya está en mis ideas guardadas o en mis publicaciones.',
  },
  {id: 'video', icon: Film, title: 'Desde un video', summary: 'Usa el guion de uno de tus videos.', empty: 'Aún no tienes videos con guion.', href: '#/nuevo', link: 'Crear un video'},
];

// Which starts can be used: ideas needs a saved card; the audience needs its onboarding done with something in it;
// a video, one of the project's with a script.
function useStarts() {
  const [can, setCan] = useState<Record<Start, boolean> | null>(null);
  const [videos, setVideos] = useState<ReelSummary[]>([]);
  useEffect(() => {
    Promise.all([
      ideasApi.board().then((b) => b.lists.some((l) => l.cards.length > 0), () => false),
      audienceApi.get().then((a) => a.onboarded && !!(a.result || a.wants.length || a.problems.length || a.levels.length), () => false),
      api.reels().then((list) => list.filter((r) => r.kind === 'video' && r.progress.find((p) => p.key === 'guion')?.done), () => [] as ReelSummary[]),
    ]).then(([ideas, audience, withScript]) => {
      setVideos(withScript);
      setCan({write: true, ideas, audience, video: withScript.length > 0});
    });
  }, []);
  return {can, videos};
}

export function NewReel({kind: pub = 'video'}: {kind?: PublicationKind}) {
  const carousel = pub === 'carousel';
  const starts = carousel ? CAROUSEL_STARTS : STARTS;
  const agent = useAgentName();
  const {uiRef, setOpen} = useStudio();
  uiRef.current = {page: carousel ? 'newCarousel' : 'new'};
  const [text, setText] = useState('');
  const [start, setStart] = useState<Start>('write');
  const {can, videos} = useStarts();
  const [fromVideo, setFromVideo] = useState<string>('');
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // The visual style starts on the project's (Ajustes → Perfil), else the default one. A carousel offers only the
  // styles that do carousels (style.json "carousel"), starting on the project's if it's one of them.
  const allStyles = useStyles();
  const styles = carousel ? allStyles?.filter((s) => s.carousel) : allStyles;
  const [picked, setPicked] = useState<string | null>(null);
  const defaultStyle = (styles?.find((s) => s.projectDefault) ?? styles?.find((s) => s.default) ?? styles?.[0])?.id ?? null;
  const style = picked ?? defaultStyle;
  // The kind of video: the default one unless he picks another. Some need his recording.
  const formats = useFormats();
  const [pickedFormat, setPickedFormat] = useState<string | null>(null);
  const kind = (pickedFormat ? formats?.find((f) => f.id === pickedFormat) : null) ?? formats?.find((f) => f.default) ?? formats?.[0] ?? null;
  const [clips, setClips] = useState<Clip[]>([]);
  const nextKey = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // The model and effort it starts on: the last ones chosen in this project unless he picks others for this agent.
  const options = useChatOptions();
  const [pickedModel, setPickedModel] = useState<{agent: string; model: string; effort: string} | null>(null);
  const [modelMenu, setModelMenu] = useState(false);
  const chosen = pickedModel && pickedModel.agent === options?.agent ? pickedModel : null;
  const shown = chosen ?? options?.choice;

  // Each clip starts uploading as soon as it's chosen, one after another.
  const queue = useRef(Promise.resolve());
  const addClips = (files: FileList | null) => {
    const add = [...(files ?? [])].filter((f) => (kind?.voiceOnly ? /^(audio|video)\// : /^video\//).test(f.type) || (kind?.voiceOnly ? AUDIO_OR_VIDEO : VIDEO_EXT).test(f.name)).map((file) => ({key: nextKey.current++, file, progress: 0}));
    if (!add.length) return;
    setClips((c) => [...c, ...add]);
    const set = (key: number, patch: Partial<Clip>) => setClips((c) => c.map((x) => (x.key === key ? {...x, ...patch} : x)));
    for (const c of add)
      queue.current = queue.current.then(() =>
        api.uploadClip(c.file, null, (p) => set(c.key, {progress: p})).then(
          (r) => set(c.key, {id: r.id, progress: 1}),
          (e: Error) => set(c.key, {error: e.message}),
        ),
      );
  };
  const needsClips = !carousel && !!kind?.footage;
  const voice = !!kind?.voiceOnly;
  const uploading = needsClips && clips.some((c) => !c.id && !c.error);
  const source = videos.find((v) => v.slug === fromVideo);
  const ready = !!(start !== 'write' || text.trim()) && (start !== 'video' || !!source) && (!needsClips || (clips.some((c) => c.id) && !uploading));

  const submit = async () => {
    const how = starts.find((x) => x.id === start);
    const msg = start === 'video' && source ? `Quiero hacer un carrusel a partir del guion de mi video «${source.title ?? source.slug}».` : (how?.message ?? text.trim());
    if (!msg || sent || !ready) return;
    setSent(msg);
    setErr('');
    try {
      const choice = chosen ? {model: chosen.model, effort: chosen.effort} : undefined;
      if (carousel) {
        const brief = start === 'video' && source ? `Quiero un carrusel a partir del guion de mi video «${source.title ?? source.slug}» (videos/${source.slug}/audio/vo.txt). No es copiar el guion en láminas: adapta su idea a un carrusel que se entienda sin el video, con su propia portada.` : how?.prompt;
        const {slug} = await api.createCarousel(msg, {...uiRef.current}, style ?? undefined, start === 'video' ? source?.slug : undefined, choice, start === 'video' ? undefined : brief);
        // From a video the idea is given: the first turn reads it and asks to start, like a written one.
        setOpen(true);
        location.hash = `#/carrusel/${slug}`;
        return;
      }
      const ids = needsClips ? clips.flatMap((c) => (c.id ? [c.id] : [])) : undefined;
      const {slug} = await api.create(msg, {...uiRef.current}, style ?? undefined, kind?.id, ids, choice, how?.prompt);
      setOpen(true);
      location.hash = `#/reel/${slug}`;
    } catch (e) {
      setErr((e as Error).message);
      setSent('');
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl flex-col justify-center gap-6 p-6">
      {sent ? (
        <div className="flex flex-col gap-4">
          <div className="ml-auto max-w-[88%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{sent}</div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Poniéndole nombre y creando el {carousel ? 'carrusel' : 'video'}…
          </p>
        </div>
      ) : (
        <>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{carousel ? '¿De qué va el próximo carrusel?' : '¿De qué va el próximo reel?'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cuéntale a {agent} la idea. El nombre del {carousel ? 'carrusel' : 'video'} sale de tu primer mensaje.{carousel && ' Láminas de 4:5 (1080×1350) para Instagram.'}
            </p>
          </div>
          <div className={cn('grid gap-2', carousel ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
            {starts.map((x) => (
              <StartCard key={x.id} start={x} active={start === x.id} usable={x.id === 'write' || can?.[x.id]} onPick={() => setStart(x.id)} />
            ))}
          </div>
          {start === 'video' && (
            <div className="-mt-3 flex flex-col gap-1.5">
              <label htmlFor="from-video" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Video de partida
              </label>
              <Select value={fromVideo} onValueChange={setFromVideo}>
                <SelectTrigger id="from-video" className="w-full">
                  <SelectValue placeholder="Elige el video cuyo guion usar" />
                </SelectTrigger>
                <SelectContent>
                  {videos.map((v) => (
                    <SelectItem key={v.slug} value={v.slug}>
                      {v.title ?? v.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {source?.hook && <p className="line-clamp-2 text-xs text-muted-foreground">«{source.hook}»</p>}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {start !== 'write' ? (
              <Button size="lg" className="self-end" onClick={submit} disabled={!ready} title={needsClips && !clips.some((c) => c.id) ? (voice ? 'Sube tu audio primero' : 'Sube tu grabación primero') : uploading ? 'Esperando a que termine de subir' : undefined}>
                Continuar <ArrowRight />
              </Button>
            ) : (
            <div className="relative">
              <Textarea
                ref={input}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={carousel ? 'El tema y la idea que quieres que se lleve quien lo deslice. Si quieres, también cuántas láminas, la portada o un carrusel de referencia.' : 'El tema y la idea que quieres que se lleve quien lo vea. Si quieres, también la duración, el gancho o un reel de referencia.'}
                rows={4}
                className="max-h-72 resize-none pr-12 text-base"
              />
              <Button size="icon-sm" className="absolute right-2 bottom-2" onClick={submit} disabled={!ready} title={needsClips && !clips.some((c) => c.id) ? (voice ? 'Sube tu audio primero' : 'Sube tu grabación primero') : uploading ? 'Esperando a que termine de subir' : 'Enviar (Enter)'}>
                <ArrowUp />
              </Button>
            </div>
            )}
            <div className="flex flex-wrap items-center gap-0.5">
              <AgentPicker />
              <ModelPicker options={options} model={shown?.model ?? ''} effort={shown?.effort ?? ''} onChange={(o) => options && setPickedModel({agent: options.agent, ...o})} open={modelMenu} onOpenChange={setModelMenu} side="bottom" />
            </div>
          </div>
          {!carousel && (
          <Section title="Formato" href="#/formatos" more="Ver formatos">
            <div className="grid gap-2 sm:grid-cols-2">
              {formats?.map((f) => (
                <FormatCard key={f.id} format={f} active={f.id === kind?.id} onPick={() => setPickedFormat(f.id)} />
              ))}
            </div>
          </Section>
          )}
          {needsClips && (
            <div
              className="-mt-3 flex flex-col gap-2 rounded-lg border border-dashed p-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addClips(e.dataTransfer.files);
              }}
            >
              <div className="flex items-center gap-2 text-sm">
                {voice ? <Mic className="size-4 text-muted-foreground" /> : <Video className="size-4 text-muted-foreground" />}
                <span className="flex-1">
                  {voice ? 'Tu voz' : 'Tu grabación'} <span className="text-muted-foreground">· {voice ? 'uno o varios audios' : 'uno o varios clips'}, en el orden en que van</span>
                </span>
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <Plus /> Agregar
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={voice ? AUDIO_ACCEPT : 'video/*,.mov,.mkv'}
                  multiple
                  hidden
                  onChange={(e) => {
                    addClips(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              {clips.length === 0 ? (
                <p className="text-xs text-muted-foreground">Arrástralos aquí o pulsa Agregar. {agent} los transcribe y te propone qué cortar{voice ? ': silencios, errores, frases repetidas' : ''}.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {clips.map((c, i) => (
                    <li key={c.key} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{c.file.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {c.error ? <span className="text-destructive">{c.error}</span> : c.id ? mb(c.file.size) : `${Math.round(c.progress * 100)} % de ${mb(c.file.size)}`}
                      </span>
                      <button onClick={() => setClips((x) => x.filter((y) => y.key !== c.key))} title="Quitar" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Section title="Estilo" href="#/estilos" more="Ver estilos">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
              {styles?.map((st) => (
                <StyleThumb key={st.id} style={st} active={st.id === style} isDefault={st.id === defaultStyle} onPick={() => setPicked(st.id)} carousel={carousel} />
              ))}
            </div>
            {carousel && styles?.length === 0 && <p className="text-sm text-muted-foreground">Ningún estilo hace carruseles todavía.</p>}
          </Section>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </>
      )}
    </main>
  );
}

// A way to start. Can't be picked while what it needs is missing: says so, with a link to go do it.
function StartCard({start: x, active, usable, onPick}: {start: (typeof STARTS)[number]; active: boolean; usable: boolean | undefined; onPick: () => void}) {
  const body = (
    <>
      <span className={cn('grid size-8 flex-none place-items-center rounded-md', active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
        <x.icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 pr-5">
        <span className="text-sm font-medium">{x.title}</span>
        <span className="text-xs text-muted-foreground">{x.summary}</span>
      </span>
    </>
  );
  if (usable === false)
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2.5">
        <div className="flex gap-3 opacity-50">{body}</div>
        <p className="text-xs text-muted-foreground">
          {x.empty}{' '}
          <a href={x.href} className="inline-flex items-center font-medium text-foreground underline-offset-4 hover:underline">
            {x.link} <ChevronRight className="size-3.5" />
          </a>
        </p>
      </div>
    );
  return (
    <button
      onClick={onPick}
      disabled={usable === undefined}
      aria-pressed={active}
      className={cn('relative flex gap-3 rounded-lg border p-2.5 text-left transition-colors hover:border-foreground/40 disabled:opacity-50', active ? 'border-foreground/70 bg-muted/50' : 'bg-card/40')}
    >
      {body}
      {active && <Check className="absolute top-2.5 right-2.5 size-4" />}
    </button>
  );
}

function Section({title, href, more, children}: {title: string; href: string; more: string; children: React.ReactNode}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
        <a href={href} className="ml-auto flex items-center text-xs text-muted-foreground hover:text-foreground">
          {more} <ChevronRight className="size-3.5" />
        </a>
      </div>
      {children}
    </section>
  );
}

// A format to pick: its sketch, name and what it is. The chosen one is outlined.
function FormatCard({format: f, active, onPick}: {format: ReelFormat; active: boolean; onPick: () => void}) {
  return (
    <button
      onClick={onPick}
      aria-pressed={active}
      className={cn('relative flex gap-3 rounded-lg border p-2.5 text-left transition-colors hover:border-foreground/40', active ? 'border-foreground/70 bg-muted/50' : 'bg-card/40')}
    >
      <FormatPoster format={f} className="h-20 flex-none" />
      <span className="flex min-w-0 flex-col gap-1 pr-5">
        <span className="text-sm font-medium">{f.name}</span>
        <span className="line-clamp-3 text-xs text-muted-foreground" title={f.summary}>
          {f.summary}
        </span>
        {f.footage && (
          <span className="mt-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            {f.voiceOnly ? <Mic className="size-3" /> : <Video className="size-3" />} {f.voiceOnly ? 'Necesita tu audio' : 'Necesita tu video'}
          </span>
        )}
      </span>
      {active && <Check className="absolute top-2.5 right-2.5 size-4" />}
    </button>
  );
}

// A style to pick: an approved frame (or a sample from its palette) and its name.
// For a carousel: its sample slide (4:5) when the style has one, and its carousel look as the hover text.
function StyleThumb({style: s, active, isDefault, onPick, carousel}: {style: Style; active: boolean; isDefault: boolean; onPick: () => void; carousel?: boolean}) {
  const ready = !!(s.skill && s.template);
  const sample = carousel ? s.carousel?.examples[0] : s.examples[0];
  const hint = carousel ? `${s.summary}${s.carousel?.look[0] ? `\n\nComo carrusel: ${s.carousel.look[0]}` : ''}` : `${s.summary}${ready ? '' : '\n\nSin plantilla propia: el agente lo hace a partir de su descripción.'}`;
  return (
    <button onClick={onPick} aria-pressed={active} title={hint} className="group flex w-28 flex-none flex-col gap-1.5 text-left">
      <span className={cn('relative block overflow-hidden rounded-md border-2 transition-colors', active ? 'border-foreground' : 'border-transparent group-hover:border-foreground/40')}>
        {sample ? <img src={sample} alt="" loading="lazy" className={cn('w-full object-cover object-top', carousel ? 'aspect-[4/5]' : 'aspect-[9/16]')} /> : <Poster style={s} className={cn('w-full text-[9px]', carousel && 'aspect-[4/5]')} />}
        {active && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background">
            <Check className="size-3.5" />
          </span>
        )}
      </span>
      <span className={cn('line-clamp-2 text-xs leading-snug', active ? 'font-medium' : 'text-muted-foreground group-hover:text-foreground')}>{s.name}</span>
      {isDefault && <span className="-mt-1 text-[11px] text-muted-foreground">Por defecto</span>}
    </button>
  );
}
