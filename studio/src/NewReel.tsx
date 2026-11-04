import {useEffect, useRef, useState} from 'react';
import {ArrowUp, Check, ChevronRight, Loader2, Mic, Plus, Video, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {api, useAgentName} from './api';
import {AgentPicker, ModelPicker, useChatOptions} from './ChatControls';
import {useStudio} from './studio';
import {useStyles} from './StylePicker';
import {AUDIO_ACCEPT, FormatPoster, useFormats} from './Formats';
import {Poster} from './Styles';
import {cn} from '@/lib/utils';
import type {ReelFormat, Style} from './api';

// A clip of his recording, uploading (staged on the server) while he writes the message.
type Clip = {key: number; file: File; progress: number; id?: string; error?: string};
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// A new reel starts as a chat: no name to fill in. The first message goes to the server, which names
// the video, creates its folder and hands the message to the reel's agent; then we open the reel with
// its conversation already running.
// What his recording can be: video for formats that show him; audio (or a video, whose sound is used) for voiceOnly.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const AUDIO_OR_VIDEO = /\.(mp4|mov|m4v|webm|mkv|m4a|mp3|wav|aac|ogg|opus|flac)$/i;

export function NewReel() {
  const agent = useAgentName();
  const {uiRef, setOpen} = useStudio();
  uiRef.current = {page: 'new'};
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // The visual style starts on the project's (Ajustes → Perfil), else the default one.
  const styles = useStyles();
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
  const needsClips = !!kind?.footage;
  const voice = !!kind?.voiceOnly;
  const uploading = needsClips && clips.some((c) => !c.id && !c.error);
  const ready = !!text.trim() && (!needsClips || (clips.some((c) => c.id) && !uploading));

  const submit = async () => {
    const msg = text.trim();
    if (!msg || sent || !ready) return;
    setSent(msg);
    setErr('');
    try {
      const ids = needsClips ? clips.flatMap((c) => (c.id ? [c.id] : [])) : undefined;
      const {slug} = await api.create(msg, {...uiRef.current}, style ?? undefined, kind?.id, ids, chosen ? {model: chosen.model, effort: chosen.effort} : undefined);
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
            <Loader2 className="size-4 animate-spin" /> Poniéndole nombre y creando el video…
          </p>
        </div>
      ) : (
        <>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">¿De qué va el próximo reel?</h1>
            <p className="mt-1 text-sm text-muted-foreground">Cuéntale a {agent} la idea. El nombre del video sale de tu primer mensaje.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="El tema y la idea que quieres que se lleve quien lo vea. Si quieres, también la duración, el gancho o un reel de referencia."
                rows={4}
                className="max-h-72 resize-none pr-12 text-base"
              />
              <Button size="icon-sm" className="absolute right-2 bottom-2" onClick={submit} disabled={!ready} title={needsClips && !clips.some((c) => c.id) ? (voice ? 'Sube tu audio primero' : 'Sube tu grabación primero') : uploading ? 'Esperando a que termine de subir' : 'Enviar (Enter)'}>
                <ArrowUp />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-0.5">
              <AgentPicker />
              <ModelPicker options={options} model={shown?.model ?? ''} effort={shown?.effort ?? ''} onChange={(o) => options && setPickedModel({agent: options.agent, ...o})} open={modelMenu} onOpenChange={setModelMenu} side="bottom" />
            </div>
          </div>
          <Section title="Formato" href="#/formatos" more="Ver formatos">
            <div className="grid gap-2 sm:grid-cols-2">
              {formats?.map((f) => (
                <FormatCard key={f.id} format={f} active={f.id === kind?.id} onPick={() => setPickedFormat(f.id)} />
              ))}
            </div>
          </Section>
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
                <StyleThumb key={st.id} style={st} active={st.id === style} isDefault={st.id === defaultStyle} onPick={() => setPicked(st.id)} />
              ))}
            </div>
          </Section>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </>
      )}
    </main>
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
function StyleThumb({style: s, active, isDefault, onPick}: {style: Style; active: boolean; isDefault: boolean; onPick: () => void}) {
  const ready = !!(s.skill && s.template);
  return (
    <button onClick={onPick} aria-pressed={active} title={`${s.summary}${ready ? '' : '\n\nSin plantilla propia: el agente lo hace a partir de su descripción.'}`} className="group flex w-28 flex-none flex-col gap-1.5 text-left">
      <span className={cn('relative block overflow-hidden rounded-md border-2 transition-colors', active ? 'border-foreground' : 'border-transparent group-hover:border-foreground/40')}>
        {s.examples.length ? <img src={s.examples[0]} alt="" loading="lazy" className="aspect-[9/16] w-full object-cover object-top" /> : <Poster style={s} className="w-full text-[9px]" />}
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
