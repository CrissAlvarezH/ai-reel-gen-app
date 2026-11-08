import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, Check as CheckIcon, ChevronRight, Copy, Download, Film, Info, Loader2, MessageSquarePlus, Mic, MoreHorizontal, Palette, Plus, Radio, Trash2, Video} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';
import DetailSkeleton from '@/components/common/DetailSkeleton';
import {api, chatApi, fmtAgo, fmtSize, fmtTime, useLive, voiceApi, type Act, type Comment, type ReelDetail, type Voice, type Word} from './api';
import {VoiceDialog} from './ProfileVoice';
import {AudienceFit} from './AudienceFit';
import {HookStrength} from './HookStrength';
import {ConflictNote, SaveBar, saveOnCmdS, useEditable} from './Editable';
import {ScriptEditor, StructureBar, parts, taggedScript, type ScriptValue} from './ScriptEditor';
import {LivePreview, type PreviewControls} from './Preview';
import {SocialPreview} from './SocialPreview';
import {ReelProgress} from './ReelProgress';
import {StyleDialog, useStyles} from './StylePicker';
import {Poster} from './Styles';
import {AUDIO_ACCEPT, useFormats} from './Formats';
import {projectKey, useStudio} from './studio';
import {useConfirm} from './confirm';

const LIVE = 'live';

// The video's visual style. Changing it doesn't redo anything by itself: Claude sees the new style with
// the next message (and asks before redoing scenes), so ask first when there's already work done.
function ReelStyle({reel, onChanged}: {reel: ReelDetail; onChanged: () => void}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const change = async (id: string) => {
    setChoosing(false);
    if (id === reel.style?.id) return;
    const started = reel.versionCount > 0 || reel.cutouts.length > 0;
    if (started && !(await confirm({title: '¿Cambiar el estilo?', description: 'El video ya tiene escenas hechas en el estilo actual. No se rehace solo: el agente lo verá en tu próximo mensaje y te preguntará antes de rehacerlas.', action: 'Cambiar estilo'}))) return;
    setBusy(true);
    try {
      await api.setStyle(reel.slug, id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const styles = useStyles();
  const s = styles?.find((x) => x.id === reel.style?.id);
  const ready = !!(s?.skill && s.template);
  return (
    <div className="flex gap-4 rounded-xl border bg-card p-4">
      <a href={s ? `#/estilos/${s.id}` : '#/estilos'} className="flex h-28 flex-none gap-1 overflow-hidden rounded-md" title="Ver el estilo">
        {s?.examples.length ? (
          s.examples.slice(0, 2).map((u) => <img key={u} src={u} alt="" loading="lazy" className="h-full w-auto rounded-sm" />)
        ) : s ? (
          <Poster style={s} className="h-full text-[9px]" />
        ) : (
          <div className="aspect-[9/16] h-full rounded-sm bg-muted" />
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Estilo</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setChoosing(true)} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Palette />} Cambiar
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s?.name ?? reel.style?.name ?? 'Sin estilo'}</span>
          {s && !ready && <Badge variant="outline">Sin plantilla</Badge>}
        </div>
        {s && <p className="line-clamp-2 text-sm text-muted-foreground">{s.summary}</p>}
        {s && (
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex gap-1">
              {s.palette.map((c) => (
                <span key={c.hex} title={`${c.name}: ${c.meaning}`} className="size-3.5 rounded-full border border-foreground/15" style={{background: c.hex}} />
              ))}
            </span>
            <span>{ready ? 'El agente lo hace con su skill y su plantilla.' : 'Sin plantilla propia: el agente lo hace a partir de su descripción.'}</span>
            <a href={`#/estilos/${s.id}`} className="ml-auto hover:text-foreground">Ver estilo ›</a>
          </div>
        )}
      </div>
      <StyleDialog open={choosing} onOpenChange={setChoosing} current={reel.style?.id ?? null} onPick={change} />
    </div>
  );
}
// The kind of video (format.txt, fixed when it was created) and, for formats that need it, his recording:
// the clips in footage/, in the order they play. Adding or removing one doesn't re-cut anything by itself:
// the agent sees it with the next message.
const AUDIO = /\.(m4a|mp3|wav|aac|ogg|opus|flac)$/i;
function ReelFormat({reel, onChanged}: {reel: ReelDetail; onChanged: () => void}) {
  const confirm = useConfirm();
  const formats = useFormats();
  const f = formats?.find((x) => x.id === reel.videoFormat?.id);
  const [uploads, setUploads] = useState<{name: string; progress: number}[]>([]);
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setErr('');
    setUploads(list.map((x) => ({name: x.name, progress: 0})));
    try {
      for (const [i, file] of list.entries()) {
        await api.uploadClip(file, reel.slug, (p) => setUploads((u) => u.map((x, j) => (j === i ? {...x, progress: p} : x))));
        onChanged();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploads([]);
    }
  };
  const remove = async (name: string) => {
    if (!(await confirm({title: `¿Quitar ${name}?`, description: 'Se borra el archivo de footage/ de este video. Si ya estaba en el corte, el agente tendrá que volver a cortar.', action: reel.videoFormat?.voiceOnly ? 'Quitar audio' : 'Quitar clip', destructive: true}))) return;
    await api.removeClip(reel.slug, name).catch((e: Error) => setErr(e.message));
    onChanged();
  };
  const name = f?.name ?? reel.videoFormat?.name;
  const voice = !!reel.videoFormat?.voiceOnly;
  const unit = voice ? 'audio' : 'clip';
  if (!name) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Formato</span>
        <span className="font-medium">{name}</span>
        <a href={`#/formatos/${reel.videoFormat?.id ?? ''}`} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
          Ver formato ›
        </a>
      </div>
      {f && !reel.videoFormat?.footage && <p className="line-clamp-2 text-sm text-muted-foreground">{f.summary}</p>}
      {reel.videoFormat?.footage && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {voice ? <Mic className="size-4 text-muted-foreground" /> : <Video className="size-4 text-muted-foreground" />}
            <span className="flex-1 text-sm">
              {voice ? 'Tu voz' : 'Grabación'} <span className="text-muted-foreground">· {reel.footage.length ? `${reel.footage.length} ${reel.footage.length === 1 ? unit : `${unit}s`}, en el orden en que van` : `todavía no hay ${unit}s`}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploads.length > 0}>
              {uploads.length ? <Loader2 className="animate-spin" /> : <Plus />} Agregar {unit}
            </Button>
            <input
              ref={input}
              type="file"
              accept={voice ? AUDIO_ACCEPT : 'video/*,.mov,.mkv'}
              multiple
              hidden
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {(reel.footage.length > 0 || uploads.length > 0) && (
            <ul className="flex flex-col gap-1">
              {reel.footage.map((c) => (
                <li key={c.name} className="group flex items-center gap-2 text-sm">
                  <button onClick={() => setPlaying(c.url)} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted" title={`Ver el ${unit}`}>
                    {AUDIO.test(c.name) ? <Mic className="size-3.5 flex-none text-muted-foreground" /> : <Film className="size-3.5 flex-none text-muted-foreground" />}
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto flex-none text-xs text-muted-foreground tabular-nums">
                      {fmtSize(c.size)} · {fmtAgo(c.mtime)}
                    </span>
                  </button>
                  <button onClick={() => remove(c.name)} title={`Quitar el ${unit}`} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
              {uploads.map((u) => (
                <li key={u.name} className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto text-xs tabular-nums">{Math.round(u.progress * 100)} %</span>
                </li>
              ))}
            </ul>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      )}
      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="max-h-[92vh] p-2 sm:max-w-3xl">
          <DialogTitle className="sr-only">Clip</DialogTitle>
          {playing && (AUDIO.test(playing) ? <audio src={playing} controls autoPlay className="mx-auto my-6 w-full max-w-xl" /> : <video src={playing} controls autoPlay className="mx-auto max-h-[86vh] w-auto" />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The voice that narrates the video: the one in Ajustes, or its own (voice.json). Changing it doesn't
// re-record anything: Claude sees it with the next message.
function ReelVoice({reel, onChanged}: {reel: ReelDetail; onChanged: () => void}) {
  const confirm = useConfirm();
  const [global, setGlobal] = useState<Voice | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    voiceApi.get().then(setGlobal, () => {});
  }, []);
  const v = reel.voice;
  const change = async (o: {id: string; name: string} | null) => {
    setChoosing(false);
    if ((o?.id ?? null) === (v?.own ? v.id : null)) return;
    if (reel.hasVoice && !(await confirm({title: '¿Cambiar la voz?', description: 'Este video ya tiene la narración grabada. No se vuelve a grabar sola: el agente verá la voz nueva en tu próximo mensaje.', action: 'Cambiar voz'}))) return;
    setBusy(true);
    try {
      await api.setVoice(reel.slug, o ? {voiceId: o.id, voiceName: o.name} : null);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
      <span className="grid size-10 flex-none place-items-center rounded-full bg-muted">
        <Mic className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Voz</span>
          <span className="font-medium">{v?.name ?? 'Sin voz elegida'}</span>
          {v && <Badge variant={v.own ? 'secondary' : 'outline'}>{v.own ? 'Solo este video' : 'La de Ajustes'}</Badge>}
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {v ? (
            <>
              ≈{reel.pace.toFixed(1)} palabras/s{global && ` · ${global.model} · velocidad ${global.speed.toFixed(2)}×`}
            </>
          ) : (
            <>
              Elígela en <a href="#/ajustes/voz" className="underline hover:text-foreground">Ajustes → Voz</a> o solo para este video.
            </>
          )}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={() => setChoosing(true)} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Mic />} Cambiar
      </Button>
      <VoiceDialog
        open={choosing}
        onOpenChange={setChoosing}
        current={v?.own ? v.id : null}
        fallback={global?.voiceName ?? global?.voiceId ?? null}
        onPick={change}
        title="Voz de este video"
        description="Usa la voz de Ajustes o elige otra solo para este video. Los ajustes (modelo, velocidad…) son los de Ajustes."
      />
    </div>
  );
}

const countWords = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function ReelView({slug}: {slug: string}) {
  const [reel, setReel] = useState<ReelDetail | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.reel(slug).then(setReel, (e) => setErr(e.message)), [slug]);
  useEffect(() => void load(), [load]);
  useLive((s) => s === slug && load());
  // Timeline comments wait in the studio context until they go out with the next message to Claude.
  const studio = useStudio();
  const comments = studio.comments[slug] ?? [];
  // Where you are, for the agent: a fresh context per video (the player, tabs and editor fill in the rest).
  if (studio.uiRef.current.slug !== slug) studio.uiRef.current = {page: 'reel', slug};
  const {setReelTitle} = studio;
  const name = reel ? (reel.title ?? reel.slug) : null;
  useEffect(() => {
    setReelTitle(name);
    return () => setReelTitle(null);
  }, [name, setReelTitle]);

  if (err) return <p className="p-6 text-destructive">{err}</p>;
  if (!reel) return <DetailSkeleton />;
  // The video's name lives in the top header; the page starts with the video and its script.
  return (
    <main className="flex flex-col gap-4 p-6">
      {/* The two script reviews, always one above the other; each opens its own detail. */}
      <div className="flex flex-col gap-4">
        <AudienceFit slug={reel.slug} script={reel.script} />
        <HookStrength slug={reel.slug} script={reel.script} />
      </div>
      {/* Side by side, the player sets the row's height and the script fills it (scrolling inside). */}
      <div className="grid gap-4 xl:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
        <Player reel={reel} comments={comments} onComment={(c) => studio.addComment(slug, c)} seekRef={studio.seekRef} />
        <div className="relative">
          <div className="xl:absolute xl:inset-0">
            <ScriptPanel reel={reel} />
          </div>
        </div>
      </div>
      <ReelProgress steps={reel.progress} />
      <ReelFormat reel={reel} onChanged={load} />
      <ReelStyle reel={reel} onChanged={load} />
      {!reel.videoFormat?.footage && <ReelVoice reel={reel} onChanged={load} />}
      <Assets reel={reel} />
    </main>
  );
}

/* ───────────── Player + timeline ───────────── */

type PlayerProps = {
  reel: ReelDetail;
  comments: Comment[];
  onComment: (c: Comment) => void;
  seekRef: React.MutableRefObject<(t: number) => void>;
};

function Player({reel, comments, onComment, seekRef}: PlayerProps) {
  const [sel, setSel] = useState(reel.versions[0]?.url ?? (reel.previewEntry ? LIVE : ''));
  const live = sel === LIVE;
  const video = useRef<HTMLVideoElement>(null);
  const preview = useRef<PreviewControls | null>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState('');
  useEffect(() => setRevealError(''), [sel]);
  const revealSelected = async () => {
    if (!current || revealBusy) return;
    setRevealBusy(true);
    setRevealError('');
    try {
      await api.revealVersion(reel.slug, current.url);
    } catch (e) {
      setRevealError((e as Error).message);
    } finally {
      setRevealBusy(false);
    }
  };

  // Keep the selection valid when versions change on disk (new render → select it).
  const newest = reel.versions[0]?.url;
  const prevNewest = useRef(newest);
  useEffect(() => {
    if (newest && newest !== prevNewest.current) setSel(newest);
    else if (sel === LIVE ? !reel.previewEntry : !reel.versions.some((v) => v.url === sel)) setSel(newest ?? (reel.previewEntry ? LIVE : ''));
    prevNewest.current = newest;
  }, [newest, reel.previewEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smooth playhead while playing (timeupdate is only ~4 Hz).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (video.current) setT(video.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = (s: number) => {
    if (live) preview.current?.seek(s);
    else if (video.current) video.current.currentTime = s;
  };
  seekRef.current = seek;
  const current = reel.versions.find((v) => v.url === sel);
  // Tied to the file's date: a <video> that opened a file still being written, or rewritten under the same name,
  // doesn't notice it changed and has to load it again.
  const videoSrc = current ? `${sel}?v=${Math.round(current.mtime)}` : sel;
  const {uiRef} = useStudio();
  Object.assign(uiRef.current, {
    version: live ? undefined : current?.name,
    live,
    t,
    act: reel.acts.find((a) => a.start != null && a.end != null && t >= a.start && t < a.end)?.name,
    playing: live ? undefined : video.current ? !video.current.paused : false,
  });

  // Comment on the current instant: pause, grab the frame, write a note.
  const [draft, setDraft] = useState<{t: number; frame?: string; text: string} | null>(null);
  const [grabErr, setGrabErr] = useState('');
  const startComment = async () => {
    if (live) {
      // The live preview is DOM, not a video: no frame grab; Claude can render a still of that second.
      preview.current?.pause();
      setGrabErr('');
      setDraft({t, text: ''});
      return;
    }
    const v = video.current;
    if (!v) return;
    v.pause();
    const at = v.currentTime;
    setDraft({t: at, text: ''});
    setGrabErr('');
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('sin imagen');
      const {path} = await chatApi.frame(reel.slug, blob);
      setDraft((d) => (d && d.t === at ? {...d, frame: path} : d));
    } catch (e) {
      setGrabErr(`No pude capturar el frame (${(e as Error).message}); el comentario irá sin imagen.`);
    }
  };
  const addComment = () => {
    if (!draft?.text.trim()) return;
    const act = reel.acts.find((a) => a.start != null && a.end != null && draft.t >= a.start && draft.t < a.end)?.name;
    const said = reel.words
      .filter((w) => w.e >= draft.t - 1.2 && w.s <= draft.t + 1.2)
      .map((w) => w.w)
      .join(' ');
    onComment({id: `${Date.now()}`, t: draft.t, act, said, version: live ? undefined : current?.name, live, text: draft.text.trim(), frame: draft.frame});
    setDraft(null);
  };

  return (
    <Card className="gap-4">
      <CardContent className="flex flex-col gap-3">
        {(reel.versions.length > 0 || reel.previewEntry) && (
          <div className="flex items-center gap-2">
          <span className="flex-none text-sm text-muted-foreground">Versión</span>
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {reel.previewEntry && (
                <>
                  <SelectItem value={LIVE}>
                    <Radio className="text-emerald-500" /> En vivo · código actual
                  </SelectItem>
                  <SelectSeparator />
                </>
              )}
              {reel.versions.map((v) => (
                <SelectItem key={v.url} value={v.url}>
                  {v.name}
                  <span className="text-muted-foreground">
                    {fmtAgo(v.mtime)} · {fmtSize(v.size)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="shrink-0" disabled={!current || revealBusy} onClick={revealSelected} aria-label="Descargar video: mostrar versión seleccionada en su carpeta" title={current ? 'Mostrar esta versión en su carpeta' : 'Renderiza el video para abrir su archivo'}>
            {revealBusy ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
          <SocialPreview reel={reel} src={videoSrc} live={live} version={live ? 'En vivo · código actual' : current?.name ?? 'Video'} initialTime={t} onOpen={() => { video.current?.pause(); preview.current?.pause(); }} />
          </div>
        )}
        {revealError && <p role="alert" className="text-sm text-destructive">{revealError}</p>}
        <div
          className="mx-auto grid max-h-[70vh] w-full place-items-center overflow-hidden rounded-lg bg-black"
          style={{aspectRatio: reel.format ? `${reel.format.width} / ${reel.format.height}` : '9 / 16'}}
        >
          {live && reel.previewEntry ? (
            <LivePreview slug={reel.slug} entry={reel.previewEntry} onTime={setT} onDuration={setDur} controls={preview} />
          ) : sel ? (
            <video ref={video} key={videoSrc} src={videoSrc} controls playsInline className="size-full object-contain" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
          ) : (
            <span className="text-sm text-muted-foreground">Aquí aparecerá el render</span>
          )}
        </div>
        {sel && !draft && (
          <Button variant="secondary" onClick={startComment}>
            <MessageSquarePlus /> Comentar aquí · {fmtTime(t)}
          </Button>
        )}
        {draft && (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              Comentario en {fmtTime(draft.t)} · {live ? 'vista en vivo' : draft.frame ? 'frame capturado' : grabErr ? 'sin frame' : 'capturando frame…'}
            </p>
            {grabErr && <p className="text-xs text-destructive">{grabErr}</p>}
            <Textarea
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({...draft, text: e.target.value})}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addComment();
                }
                if (e.key === 'Escape') setDraft(null);
              }}
              placeholder="¿Qué pasa aquí? (Enter añade)"
              rows={2}
            />
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-muted-foreground">Se envía al agente con tu próximo mensaje.</span>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={addComment} disabled={!draft.text.trim()}>
                Añadir
              </Button>
            </div>
          </div>
        )}
        <Timeline acts={reel.acts} words={reel.words} t={t} dur={dur} onSeek={seek} marks={comments.map((c) => c.t)} />
      </CardContent>
    </Card>
  );
}

function Timeline({acts, words, t, dur, onSeek, marks}: {acts: Act[]; words: Word[]; t: number; dur: number; onSeek: (s: number) => void; marks: number[]}) {
  const total = Math.max(dur, ...acts.map((a) => a.end ?? 0), words.at(-1)?.e ?? 0) || 1;
  const bar = useRef<HTMLDivElement>(null);
  const curAct = acts.find((a) => a.start != null && a.end != null && t >= a.start && t < a.end);
  const curWord = words.findIndex((w) => t >= w.s && t < w.e + 0.12);
  // A window of words around the playhead, like a running caption.
  const around = useMemo(() => {
    const i = curWord >= 0 ? curWord : words.findIndex((w) => w.s > t);
    if (i < 0) return [];
    const from = Math.max(0, i - 5);
    return words.slice(from, from + 12).map((w, k) => ({...w, i: from + k}));
  }, [curWord, words, t]);

  const click = (e: React.MouseEvent) => {
    const r = bar.current!.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * total);
  };

  if (!acts.length && !words.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={bar} onClick={click} className="relative h-8 cursor-pointer overflow-hidden rounded-md bg-muted">
        {acts.map((a, i) =>
          a.start == null || a.end == null ? null : (
            <div
              key={a.name}
              title={`${a.name} · ${a.start.toFixed(2)}–${a.end.toFixed(2)} s`}
              className={cn(
                'absolute inset-y-0 overflow-hidden border-r border-background px-1 py-0.5 text-[10px] whitespace-nowrap',
                curAct?.name === a.name ? 'bg-primary text-primary-foreground' : i % 2 ? 'bg-muted-foreground/15 text-muted-foreground' : 'bg-muted-foreground/25 text-muted-foreground',
              )}
              style={{left: `${(a.start / total) * 100}%`, width: `${((a.end - a.start) / total) * 100}%`}}
            >
              {a.name}
            </div>
          ),
        )}
        {marks.map((m, i) => (
          <div key={i} className="pointer-events-none absolute top-0.5 -ml-1 size-2 rounded-full bg-amber-400 ring-2 ring-background" style={{left: `${(m / total) * 100}%`}} />
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500" style={{left: `${(t / total) * 100}%`}} />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{fmtTime(t)}</span>
        <span>{curAct ? curAct.name : '—'}</span>
        <span>{fmtTime(total)}</span>
      </div>
      {words.length > 0 && (
        <p className="flex min-h-[3.2em] flex-wrap content-start text-sm leading-relaxed font-medium">
          {around.map((w) => (
            <span
              key={w.i}
              onClick={() => onSeek(w.s)}
              className={cn('cursor-pointer rounded px-0.5', w.i === curWord ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {w.w}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/* ───────────── Script ───────────── */

function ScriptPanel({reel}: {reel: ReelDetail}) {
  // One edit buffer for the text (audio/vo.txt) and its structure tags (audio/beats.json), saved together.
  const disk = useMemo(() => JSON.stringify({text: reel.script, beats: reel.beats}), [reel.script, reel.beats]);
  const ed = useEditable(disk, async (json) => {
    const v = JSON.parse(json) as ScriptValue;
    await api.write(reel.slug, 'audio/vo.txt', v.text);
    await api.write(reel.slug, 'audio/beats.json', JSON.stringify(v.beats, null, 1) + '\n');
  });
  const value = useMemo(() => JSON.parse(ed.text) as ScriptValue, [ed.text]);
  const setValue = (v: ScriptValue) => ed.setText(JSON.stringify(v));
  const textDirty = value.text !== reel.script;
  useStudio().uiRef.current.scriptDirty = ed.dirty;
  const n = countWords(value.text);
  // Real timings when the recorded voice says exactly this text.
  const voice = !textDirty && !reel.voiceStale && reel.words.length ? reel.words : null;
  const ps = useMemo(() => parts(value, voice, reel.pace), [value, voice, reel.pace]);
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState('');

  const copy = async () => {
    setCopyErr('');
    try {
      await navigator.clipboard.writeText(taggedScript(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyErr('No se pudo copiar el guion.');
    }
  };

  return (
    <Card className="h-full min-h-0 gap-4">
      <CardHeader>
        <CardTitle>{reel.videoFormat?.footage ? 'Lo que dices' : 'Guion'}</CardTitle>
        {/* With his recording, vo.txt is the cut's transcript: it changes when the cut does. */}
        <CardDescription title={reel.videoFormat?.footage ? 'Es la transcripción del corte de tu grabación: para cambiarlo, pídele al agente otro corte.' : undefined}>
          {n} palabras · ~{fmtTime(ps.at(-1)?.end ?? n / reel.pace)}
          {reel.videoFormat?.footage && ' · del corte'}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={copied ? 'Copiado' : 'Más'} title={copied ? 'Copiado' : undefined}>
                {copied ? <CheckIcon /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copy} disabled={!value.text.trim()}>
                <Copy /> Copiar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {reel.voiceStale && !textDirty && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>El guion ya no coincide con la voz grabada. Hay que regenerar la voz (y re-timear) antes del próximo render.</AlertDescription>
          </Alert>
        )}
        {textDirty && reel.hasVoice && (
          <Alert>
            <Info />
            <AlertDescription>Al guardar, la voz actual quedará desactualizada hasta regenerarla.</AlertDescription>
          </Alert>
        )}
        <ConflictNote ed={ed} />
        {copyErr && <p className="text-sm text-destructive">{copyErr}</p>}
        <StructureBar parts={ps} />
        <ScriptEditor value={value} onChange={setValue} onSave={() => ed.dirty && ed.save()} />
        <SaveBar ed={ed} />

      </CardContent>
    </Card>
  );
}

/* ───────────── Assets: cutouts, boards, credits, caption, thumbnail, automation ───────────── */

function Assets({reel}: {reel: ReelDetail}) {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem(projectKey('studio.tab')) ?? 'cut';
    } catch {
      return 'cut';
    }
  });
  const pick = (k: string) => {
    setTab(k);
    try {
      localStorage.setItem(projectKey('studio.tab'), k);
    } catch {
      /* private mode */
    }
  };
  const [zoom, setZoom] = useState<string | null>(null);
  useStudio().uiRef.current.tab = {cut: 'Recortes', boards: 'Boards y sheets', credits: 'Créditos', caption: 'Caption IG', thumbnail: 'Miniatura', automation: 'Instrucciones automatización'}[tab];

  return (
    <Card>
      <CardContent>
        <Tabs value={tab} onValueChange={pick}>
          <TabsList className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="cut">
              Recortes <Badge variant="secondary">{reel.cutouts.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="boards">
              Boards y sheets <Badge variant="secondary">{reel.boards.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="credits">Créditos</TabsTrigger>
            <TabsTrigger value="caption">Caption IG</TabsTrigger>
            <TabsTrigger value="thumbnail">Miniatura</TabsTrigger>
            <TabsTrigger value="automation">Instrucciones automatización</TabsTrigger>
          </TabsList>
          <TabsContent value="cut" className="pt-3">
            {reel.cutouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin recortes en public/cut/.</p>
            ) : (
              // Grey backdrop on purpose: the skill checks every cutout on a grey board.
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 rounded-lg bg-neutral-500 p-3">
                {reel.cutouts.map((c) => (
                  <figure key={c.url} onClick={() => setZoom(c.url)} className="cursor-zoom-in">
                    <img src={c.url} alt={c.name} loading="lazy" className="aspect-square w-full object-contain" />
                    <figcaption className="mt-1 text-center text-xs text-white">{c.name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="boards" className="pt-3">
            <Boards reel={reel} onZoom={setZoom} />
          </TabsContent>
          <TabsContent value="credits" className="pt-3">
            <TextFileTab slug={reel.slug} path="CREDITS.md" disk={reel.credits} hint="Autor y licencia de cada imagen (CC BY / BY-SA requieren crédito)." />
          </TabsContent>
          <TabsContent value="caption" className="pt-3">
            <CaptionTab reel={reel} />
          </TabsContent>
          <TabsContent value="thumbnail" className="pt-3">
            <ThumbnailTab reel={reel} onZoom={setZoom} />
          </TabsContent>
          <TabsContent value="automation" className="pt-3">
            <AutomationTab reel={reel} />
          </TabsContent>
        </Tabs>
      </CardContent>
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-h-[92vh] max-w-[92vw] p-2 sm:max-w-[92vw]">
          <DialogTitle className="sr-only">Imagen</DialogTitle>
          {zoom && <img src={zoom} alt="" className="mx-auto max-h-[86vh] w-auto object-contain" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Boards({reel, onZoom}: {reel: ReelDetail; onZoom: (u: string) => void}) {
  if (!reel.boards.length) return <p className="text-sm text-muted-foreground">Sin imágenes en out/ todavía.</p>;
  return (
    <div className="flex flex-col gap-1">
      {reel.boards.map((g, i) => (
        <Collapsible key={g.name} defaultOpen={i === 0}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2">
              <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
              {g.name}
              <span className="text-muted-foreground">
                · {g.images.length} · {fmtAgo(g.mtime)}
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex gap-3 overflow-x-auto pt-1 pb-3">
              {g.images.map((u) => (
                <figure key={u} onClick={() => onZoom(u)} className="flex-none cursor-zoom-in">
                  <img src={u} alt="" loading="lazy" className="h-64 w-auto rounded-md border bg-muted" />
                  <figcaption className="mt-1 text-xs text-muted-foreground">{decodeURIComponent(u.split('/').pop()!)}</figcaption>
                </figure>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

function TextFileTab({slug, path, disk, hint}: {slug: string; path: string; disk: string; hint: string}) {
  const ed = useEditable(disk, (text) => api.write(slug, path, text));
  return (
    <div className="flex flex-col gap-3">
      <ConflictNote ed={ed} />
      <Textarea value={ed.text} onChange={(e) => ed.setText(e.target.value)} onKeyDown={saveOnCmdS(ed)} className="min-h-72 font-mono text-sm" />
      <SaveBar ed={ed}>
        <span className="font-mono">{path}</span> · {hint}
      </SaveBar>
    </div>
  );
}

function Check({ok, warn, children}: {ok: boolean; warn?: boolean; children: React.ReactNode}) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn('size-2 rounded-full', ok ? 'bg-emerald-500' : warn ? 'bg-amber-400' : 'bg-red-500')} />
      {children}
    </li>
  );
}

// Copies what's in the box, saved or not; 'done' lasts long enough to be seen.
function useCopy() {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
      timer.current = window.setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
    }
  };
  return [state, copy] as const;
}

function CaptionTab({reel}: {reel: ReelDetail}) {
  const ed = useEditable(reel.caption, (text) => api.write(reel.slug, 'caption.md', text));
  const tags = (ed.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const emoji = /\p{Extended_Pictographic}/u.test(ed.text);
  const firstTwo = ed.text.split('\n').filter((l) => l.trim()).slice(0, 2);
  const [copy, copyText] = useCopy();
  return (
    <div className="flex flex-col gap-3">
      <ConflictNote ed={ed} />
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <Textarea value={ed.text} onChange={(e) => ed.setText(e.target.value)} onKeyDown={saveOnCmdS(ed)} placeholder="Gancho en las dos primeras líneas…" className="min-h-72 text-sm" />
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <Button variant="secondary" disabled={!ed.text.trim()} onClick={() => copyText(ed.text)}>
              {copy === 'done' ? <CheckIcon /> : <Copy />} {copy === 'done' ? 'Copiado' : 'Copiar caption'}
            </Button>
            {copy === 'error' && <p role="alert" className="text-xs text-destructive">No pude copiar al portapapeles; selecciona el texto y cópialo a mano.</p>}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Checklist</p>
            <ul className="flex flex-col gap-1.5">
              <Check ok={ed.text.length <= 2200}>{ed.text.length} / 2200 caracteres</Check>
              <Check ok={tags >= 8 && tags <= 15} warn>
                {tags} hashtags (≈12)
              </Check>
              <Check ok={!emoji}>{emoji ? 'Tiene emojis' : 'Sin emojis'}</Check>
              <Check ok={/guárdalo/i.test(ed.text)} warn>
                CTA “guárdalo”
              </Check>
              <Check ok={/imágenes modificadas/i.test(ed.text) || !/CC BY/.test(reel.credits)} warn>
                Línea de créditos CC BY
              </Check>
            </ul>
          </div>
          {firstTwo.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Antes de “más”</p>
              <blockquote className="rounded-md bg-muted p-3 text-sm">{firstTwo.join(' ')}</blockquote>
            </div>
          )}
        </div>
      </div>
      <SaveBar ed={ed}>
        <span className="font-mono">caption.md</span> · se publica tal cual en Instagram
      </SaveBar>
    </div>
  );
}

/* ───────────── Thumbnail: miniatura.png, the cover posted with the reel ───────────── */

// The cover (out/miniatura.png, next to the renders) as it shows in the reel (9:16) and as the profile grid crops it (3:4, centred), next to how the
// video's style says its thumbnails look (style.json "thumbnail").
function ThumbnailTab({reel, onZoom}: {reel: ReelDetail; onZoom: (u: string) => void}) {
  const style = useStyles()?.find((s) => s.id === reel.style?.id);
  const t = reel.thumbnail;
  const guide = style?.thumbnail;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Like the video's Descargar: shows the file in its folder (Finder, Explorer…) instead of downloading a copy.
  const revealThumb = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.revealThumbnail(reel.slug);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      {t ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-4">
            <figure>
              <button onClick={() => onZoom(t.url)} className="block cursor-zoom-in overflow-hidden rounded-md border">
                <img src={t.url} alt="Miniatura" className="aspect-[9/16] h-96 w-auto object-cover" />
              </button>
              <figcaption className="mt-1 text-xs text-muted-foreground">Reel · 9:16</figcaption>
            </figure>
            <figure>
              <button onClick={() => onZoom(t.url)} className="block cursor-zoom-in overflow-hidden rounded-md border">
                <img src={t.url} alt="Miniatura en la cuadrícula del perfil" className="aspect-[3/4] h-48 w-auto object-cover" />
              </button>
              <figcaption className="mt-1 text-xs text-muted-foreground">Cuadrícula del perfil · 3:4</figcaption>
            </figure>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-mono">out/miniatura.png</span> · {fmtAgo(t.mtime)}
            </span>
            <Button variant="secondary" size="sm" disabled={busy} onClick={revealThumb} title="Mostrar la miniatura en su carpeta">
              {busy ? <Loader2 className="animate-spin" /> : <Download />} Descargar
            </Button>
          </div>
          {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
        </div>
      ) : (
        <div className="flex aspect-[9/16] h-96 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>Todavía no hay miniatura.</p>
          <p className="text-xs">Pídesela al agente en el chat: la hace con el estilo del video y aparece aquí y en out/, junto al video.</p>
        </div>
      )}
      <div className="flex flex-col gap-4 text-sm">
        {guide ? (
          <>
            <p className="text-xs font-medium text-muted-foreground uppercase">Miniatura en «{style.name}»</p>
            {guide.look.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-muted-foreground">
                {guide.look.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            {guide.avoid.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">Evitar</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-muted-foreground">
                  {guide.avoid.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          style && <p className="text-muted-foreground">El estilo «{style.name}» no dice cómo son sus miniaturas: el agente la hará con su paleta y su tipografía.</p>
        )}
        <p className="text-xs text-muted-foreground">En la cuadrícula del perfil Instagram recorta el centro: el texto tiene que caber ahí.</p>
      </div>
    </div>
  );
}

/* ───────────── Automation: what gets pasted into ManyChat or InstantDM ───────────── */

const AUTOMATION_FIELDS = [
  {key: 'keyword', label: 'Palabra clave', placeholder: 'ARRIENDO'},
  {key: 'reply', label: 'Respuesta al comentario', placeholder: 'La respuesta pública a quien comenta…', long: true},
  {key: 'dm', label: 'Mensaje directo', placeholder: 'El mensaje que le llega por DM…', long: true},
  {key: 'link', label: 'Enlace', placeholder: 'https://…'},
] as const;

// The file as an object; null if it isn't one, so nothing gets saved over it without saying so.
function parseAutomation(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const automationText = (o: Record<string, unknown>) => JSON.stringify(o, null, 2) + '\n';

function AutomationField({field, value, onChange, onKeyDown}: {field: (typeof AUTOMATION_FIELDS)[number]; value: string; onChange: (v: string) => void; onKeyDown: (e: React.KeyboardEvent) => void}) {
  const [copy, copyText] = useCopy();
  const id = `automation-${field.key}`;
  const copyLabel = copy === 'error' ? `No pude copiar: ${field.label.toLowerCase()}` : copy === 'done' ? 'Copiado' : `Copiar ${field.label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <div className="relative">
        {'long' in field ? (
          <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={field.placeholder} className="min-h-24 pr-10 text-sm" />
        ) : (
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={field.placeholder} spellCheck={false} className="h-9 pr-10 text-sm" />
        )}
        <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 size-7" disabled={!value.trim()} onClick={() => copyText(value)} aria-label={copyLabel} title={copyLabel}>
          {copy === 'done' ? <CheckIcon /> : copy === 'error' ? <AlertTriangle className="text-destructive" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function AutomationTab({reel}: {reel: ReelDetail}) {
  const disk = parseAutomation(reel.automation);
  const ed = useEditable(disk ? automationText(disk) : reel.automation, (text) => api.write(reel.slug, 'automatizacion.json', text));
  const current = parseAutomation(ed.text);
  const str = (k: string) => (typeof current?.[k] === 'string' ? (current[k] as string) : '');
  const set = (k: string, v: string) => ed.setText(automationText({...current, [k]: v}));
  return (
    <div className="flex flex-col gap-4">
      <ConflictNote ed={ed} />
      {!current && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>automatizacion.json no es un JSON válido, así que no se puede editar aquí. Pídele al agente que lo corrija.</AlertDescription>
        </Alert>
      )}
      {current && AUTOMATION_FIELDS.map((f) => <AutomationField key={f.key} field={f} value={str(f.key)} onChange={(v) => set(f.key, v)} onKeyDown={saveOnCmdS(ed)} />)}
      <SaveBar ed={ed}>
        <span className="font-mono">automatizacion.json</span> · Para configurar ManyChat o InstantDM en este video.
      </SaveBar>
    </div>
  );
}
