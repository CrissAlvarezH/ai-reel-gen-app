import {useEffect, useRef, useState} from 'react';
import {AudioLines, Check, Loader2, Mic, Pause, Play, Sparkles} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import ListSkeleton from '@/components/common/ListSkeleton';
import {FPS_OPTIONS, PLATFORM_FORMATS, platformFormat, type Format} from '../shared/types';
import {profileApi, voiceApi, type Profile, type Voice, type VoiceModel, type VoiceOption, type VoiceSample} from './api';
import {useStyles} from './StylePicker';

// Ajustes → Perfil and Voz: who makes the videos and the voice that narrates them (config/*.json at the
// workspace). The agent gets both with every message; tools/tts.py reads the voice.

const PLATFORMS = Object.keys(PLATFORM_FORMATS);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Field({label, hint, children, className}: {label: string; hint?: string; children: React.ReactNode; className?: string}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SaveBar({dirty, busy, saved, err, onSave, onReset}: {dirty: boolean; busy: boolean; saved: boolean; err: string; onSave: () => void; onReset: () => void}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {err && <span className="mr-auto text-sm text-destructive">{err}</span>}
      {!err && saved && !dirty && (
        <span className="mr-auto flex items-center gap-1 text-sm text-emerald-500">
          <Check className="size-4" /> Guardado
        </span>
      )}
      {dirty && (
        <Button variant="ghost" onClick={onReset} disabled={busy}>
          Descartar
        </Button>
      )}
      <Button onClick={onSave} disabled={!dirty || busy}>
        {busy && <Loader2 className="animate-spin" />} Guardar
      </Button>
    </div>
  );
}

// A form over a saved value: edits stay in a draft until Guardar.
function useDraft<T>(load: () => Promise<T>, save: (v: T) => Promise<T>) {
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    load().then(
      (v) => {
        setSaved(v);
        setDraft(v);
      },
      (e: Error) => setErr(e.message),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<T>) => {
    setJustSaved(false);
    setDraft((d) => (d ? {...d, ...patch} : d));
  };
  const commit = async () => {
    if (!draft) return;
    setBusy(true);
    setErr('');
    try {
      const v = await save(draft);
      setSaved(v);
      setDraft(v);
      setJustSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {saved, draft, set, commit, reset: () => setDraft(saved), dirty: !!draft && !same(draft, saved), busy, err, justSaved};
}

// Each card saves only its own fields: the agent may have filled in the audience meanwhile.
export function ProfileCard() {
  const f = useDraft<Profile>(profileApi.get, ({audience: _a, caption: _c, notes: _n, ...own}) => profileApi.save(own));
  const p = f.draft;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>Quién hace los videos y cómo. El agente lo recibe en cada mensaje y manda sobre lo que digan las skills.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!p && !f.err && <ListSkeleton variant="lines" count={6} />}
        {p && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tu nombre" hint="Así te llama el agente.">
                <Input value={p.name} onChange={(e) => f.set({name: e.target.value})} placeholder="Tu nombre" />
              </Field>
              <Field label="Idioma" hint="De los videos y de la conversación.">
                <Input value={p.language} onChange={(e) => f.set({language: e.target.value})} placeholder="español" />
              </Field>
              <Field label="Plataforma">
                <Select value={p.platform} onValueChange={(v) => f.set({platform: v, format: platformFormat(v)})}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...PLATFORMS, p.platform])].map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Duración objetivo" hint="Para escribir los guiones.">
                <div className="flex items-center gap-2">
                  <Input type="number" min={10} max={600} value={p.duration} onChange={(e) => f.set({duration: Number(e.target.value) || 0})} className="w-28" />
                  <span className="text-sm text-muted-foreground">segundos</span>
                </div>
              </Field>
              <FormatField format={p.format} platform={p.platform} onChange={(format) => f.set({format})} />
              <StyleField value={p.style} onChange={(style) => f.set({style})} />
            </div>
          </>
        )}
        <SaveBar dirty={f.dirty} busy={f.busy} saved={f.justSaved} err={f.err} onSave={f.commit} onReset={f.reset} />
      </CardContent>
    </Card>
  );
}

// What's particular to the open channel (Ajustes → Proyecto): who it's for and the rules the agent follows there.
export function ProjectRulesCard() {
  const f = useDraft<Profile>(profileApi.get, ({caption, notes}) => profileApi.save({caption, notes}));
  const p = f.draft;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Público y reglas</CardTitle>
        <CardDescription>Para quién es este canal y qué debe seguir el agente en él. Lo recibe en cada mensaje y manda sobre lo que digan las skills.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!p && !f.err && <ListSkeleton variant="lines" count={6} />}
        {p && (
          <>
            <Field label="Público">
              <p className="text-sm">
                {p.audience || <span className="text-muted-foreground">Sin definir.</span>}{' '}
                <a href="#/audiencia" className="underline underline-offset-2">
                  Cámbialo en Perfil de audiencia
                </a>
              </p>
            </Field>
            <Field label="Reglas del caption" hint="Cómo escribir la descripción de cada publicación.">
              <Textarea value={p.caption} onChange={(e) => f.set({caption: e.target.value})} rows={4} className="text-sm" />
            </Field>
            <Field label="Otras indicaciones" hint="Cualquier cosa que el agente deba tener siempre en cuenta (tono, temas que evitar…).">
              <Textarea value={p.notes} onChange={(e) => f.set({notes: e.target.value})} rows={3} className="text-sm" placeholder="Opcional" />
            </Field>
          </>
        )}
        <SaveBar dirty={f.dirty} busy={f.busy} saved={f.justSaved} err={f.err} onSave={f.commit} onReset={f.reset} />
      </CardContent>
    </Card>
  );
}

// The style this project's new videos start in (Nuevo reel and scripts/new-video.sh); also set from a
// style's page. None: the workspace's default style.
const GENERAL = '__general';
function StyleField({value, onChange}: {value: string | null; onChange: (id: string | null) => void}) {
  const styles = useStyles();
  const general = styles?.find((s) => s.default) ?? styles?.[0];
  const missing = !!value && !!styles && !styles.some((s) => s.id === value);
  return (
    <Field
      label="Estilo por defecto"
      className="sm:col-span-2"
      hint={missing ? `El estilo «${value}» ya no existe: los videos nuevos usan el predeterminado.` : 'Con el que empiezan los videos nuevos de este proyecto. Al crear uno puedes elegir otro.'}
    >
      <Select value={value && !missing ? value : GENERAL} onValueChange={(v) => onChange(v === GENERAL ? null : v)} disabled={!styles}>
        <SelectTrigger className="w-full sm:w-96">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GENERAL}>El predeterminado{general ? ` (${general.name})` : ''}</SelectItem>
          {styles?.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  {s.palette.slice(0, 4).map((c) => (
                    <span key={c.hex} className="size-2.5 rounded-full border border-foreground/15" style={{background: c.hex}} />
                  ))}
                </span>
                {s.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// Size, frame rate and loudness of new videos: the platform's preset, editable. Each video keeps the one
// it was made with (src/format.json).
function FormatField({format, platform, onChange}: {format: Format; platform: string; onChange: (f: Format) => void}) {
  const preset = platformFormat(platform);
  const isPreset = same(format, preset);
  const n = (k: keyof Format) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({...format, [k]: Number(e.target.value) || 0});
  return (
    <Field
      label="Tamaño y calidad"
      className="sm:col-span-2"
      hint={isPreset ? `El de ${platform}. Se aplica a los videos nuevos; cada video guarda el suyo.` : 'Personalizado. Se aplica a los videos nuevos; cada video guarda el suyo.'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" step={2} min={240} max={4096} value={format.width} onChange={n('width')} className="w-24" aria-label="Ancho" />
        <span className="text-sm text-muted-foreground">×</span>
        <Input type="number" step={2} min={240} max={4096} value={format.height} onChange={n('height')} className="w-24" aria-label="Alto" />
        <span className="mr-2 text-sm text-muted-foreground">px</span>
        <Select value={String(format.fps)} onValueChange={(v) => onChange({...format, fps: Number(v)})}>
          <SelectTrigger className="w-28" aria-label="Fotogramas por segundo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FPS_OPTIONS.map((x) => (
              <SelectItem key={x} value={String(x)}>
                {x} fps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" step={0.5} min={-30} max={-6} value={format.lufs} onChange={n('lufs')} className="ml-2 w-20" aria-label="Volumen" />
        <span className="text-sm text-muted-foreground">LUFS</span>
        {!isPreset && (
          <Button variant="ghost" size="sm" onClick={() => onChange(preset)}>
            Usar el de {platform}
          </Button>
        )}
      </div>
    </Field>
  );
}

/* ───── Voice ───── */

const CATEGORY: Record<string, string> = {cloned: 'Clon instantáneo', generated: 'Diseñada', professional: 'Clon profesional', premade: 'De ElevenLabs', famous: 'Famosa'};

// One audio element for every "listen" button: starting one stops the other.
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (url: string) => {
    if (playing === url) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(url);
    a.onended = () => setPlaying((p) => (p === url ? null : p));
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(url);
  };
  return {playing, toggle};
}

export function useVoiceOptions() {
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    voiceApi.voices().then(setVoices, (e: Error) => setErr(e.message));
  }, []);
  return {voices, err};
}

// The account's voices, to choose one. With `fallback`, the first option goes back to the voice in Ajustes.
export function VoiceDialog({
  open,
  onOpenChange,
  current,
  onPick,
  fallback,
  title = 'Elegir voz',
  description = 'Las voces de tu cuenta de ElevenLabs. Escucha cada una antes de elegir.',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: string | null;
  onPick: (v: VoiceOption | null) => void;
  fallback?: string | null;
  title?: string;
  description?: string;
}) {
  const {voices, err} = useVoiceOptions();
  const player = usePlayer();
  const [q, setQ] = useState('');
  const shown = voices?.filter((v) => !q.trim() || `${v.name} ${v.labels.join(' ')} ${v.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!voices && !err && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {voices && (
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, acento, tono…" />
            <div className="-mx-2 flex min-h-0 flex-col gap-1 overflow-y-auto px-2">
              {fallback !== undefined && (
                <button
                  onClick={() => onPick(null)}
                  className={cn('flex items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50', !current && 'border-foreground/50 bg-muted/40')}
                >
                  <span className="grid size-9 flex-none place-items-center rounded-full bg-muted">
                    <AudioLines className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">La voz de Ajustes</span>
                    <span className="block text-xs text-muted-foreground">{fallback ? `«${fallback}», la misma que los demás videos` : 'Todavía no hay una elegida en Ajustes'}</span>
                  </span>
                  {!current && <Check className="size-4" />}
                </button>
              )}
              {shown?.map((v) => (
                <div key={v.id} className={cn('flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50', v.id === current && 'border-foreground/50 bg-muted/40')}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="flex-none rounded-full"
                    disabled={!v.previewUrl}
                    onClick={() => v.previewUrl && player.toggle(v.previewUrl)}
                    title={v.previewUrl ? 'Escuchar' : 'Sin muestra'}
                  >
                    {player.playing === v.previewUrl ? <Pause /> : <Play />}
                  </Button>
                  <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => onPick(v)}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{v.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {CATEGORY[v.category] ?? v.category}
                      </Badge>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{v.labels.join(' · ') || v.description}</span>
                  </button>
                  {v.id === current ? <Check className="size-4 flex-none" /> : null}
                </div>
              ))}
              {shown?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Ninguna voz coincide.</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SliderField({label, hint, value, min, max, step, fmt, onChange}: {label: string; hint: string; value: number; min: number; max: number; step: number; fmt: (n: number) => string; onChange: (n: number) => void}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm">{label}</Label>
        <span className="text-sm tabular-nums">{fmt(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([n]) => onChange(n)} />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function VoiceCardHeader() {
  return (
    <CardHeader>
      <CardTitle>Voz</CardTitle>
      <CardDescription>La voz que narra los videos, en tu cuenta de ElevenLabs. Cada video puede usar otra desde su página.</CardDescription>
    </CardHeader>
  );
}

// The shape of the controls below, while they load.
function VoiceControlsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Cargando…</span>
      <div className="flex items-center gap-3 rounded-lg border p-4">
        <Skeleton className="size-10 flex-none rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48 max-w-full" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-18 flex-col gap-2">
            <div className="flex justify-between gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-10" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-3 w-80 max-w-full" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>
      <Skeleton className="h-4 w-64 max-w-full" />
    </div>
  );
}

// VoiceCard before it can mount (it asks ElevenLabs for the voices, so it waits for the key's check).
export function VoiceCardSkeleton() {
  return (
    <Card>
      <VoiceCardHeader />
      <CardContent className="flex flex-col gap-5">
        <VoiceControlsSkeleton />
        <div className="flex justify-end">
          <Button disabled>Guardar</Button>
        </div>
      </CardContent>
    </Card>
  );
}

const SAMPLE_TEXT = 'Hola, esta es una prueba de mi voz. Así sonarán mis videos: claros, cercanos y al ritmo justo.';
const pct = (n: number) => `${Math.round(n * 100)} %`;

export function VoiceCard() {
  const f = useDraft<Voice>(voiceApi.get, voiceApi.save);
  const v = f.draft;
  const [models, setModels] = useState<VoiceModel[] | null>(null);
  const {voices, err: voicesErr} = useVoiceOptions();
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [sample, setSample] = useState<(VoiceSample & {for: string}) | null>(null);
  const [sampling, setSampling] = useState(false);
  const [sampleErr, setSampleErr] = useState('');
  const player = usePlayer();
  useEffect(() => {
    voiceApi.models().then(setModels, () => setModels([]));
  }, []);

  // The pace only holds for the settings it was measured with.
  const heard = (x: Voice) => JSON.stringify([x.voiceId, x.model, x.speed, x.stability, x.similarity, x.style, x.speakerBoost]);
  const soundChanged = !!v && !!f.saved && heard(v) !== heard(f.saved);
  const measured = sample && v && sample.for === heard(v);

  const listen = async () => {
    if (!v) return;
    setSampling(true);
    setSampleErr('');
    try {
      const s = await voiceApi.sample(text, v);
      setSample({...s, for: heard(v)});
      f.set({wordsPerSec: s.wordsPerSec});
      player.toggle(s.audio);
    } catch (e) {
      setSampleErr((e as Error).message);
    } finally {
      setSampling(false);
    }
  };

  const current = voices?.find((x) => x.id === v?.voiceId);
  return (
    <Card>
      <VoiceCardHeader />
      <CardContent className="flex flex-col gap-5">
        {!v && !f.err && <VoiceControlsSkeleton />}
        {v && (
          <>
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <span className="grid size-10 flex-none place-items-center rounded-full bg-muted">
                <Mic className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{v.voiceName ?? (v.voiceId ? v.voiceId : 'Sin voz elegida')}</span>
                  {current && <Badge variant="outline">{CATEGORY[current.category] ?? current.category}</Badge>}
                </div>
                {v.voiceId && !voices && !voicesErr ? (
                  <Skeleton className="mt-1.5 h-3 w-48 max-w-full" />
                ) : (
                  <p className="truncate text-xs text-muted-foreground">
                    {voicesErr ? voicesErr : current ? current.labels.join(' · ') || current.description : v.voiceId ? v.voiceId : 'Elige una voz para poder generar la narración.'}
                  </p>
                )}
              </div>
              {current?.previewUrl && (
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => player.toggle(current.previewUrl!)} title="Escuchar la muestra de ElevenLabs">
                  {player.playing === current.previewUrl ? <Pause /> : <Play />}
                </Button>
              )}
              <Button variant="outline" onClick={() => setPicking(true)} disabled={!!voicesErr}>
                {v.voiceId ? 'Cambiar' : 'Elegir voz'}
              </Button>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Modelo" className="sm:col-span-2">
                {models ? (
                  <Select value={v.model} onValueChange={(m) => f.set({model: m})}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!models.some((m) => m.id === v.model) && <SelectItem value={v.model}>{v.model}</SelectItem>}
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} <span className="text-muted-foreground">{m.id}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Skeleton className="h-8 w-full rounded-lg" />
                )}
              </Field>
              <SliderField label="Velocidad" hint="1 es la velocidad natural de la voz." value={v.speed} min={0.7} max={1.2} step={0.01} fmt={(n) => `${n.toFixed(2)}×`} onChange={(n) => f.set({speed: n})} />
              <SliderField label="Estabilidad" hint="Más alta: más pareja. Más baja: más expresiva." value={v.stability} min={0} max={1} step={0.01} fmt={pct} onChange={(n) => f.set({stability: n})} />
              <SliderField label="Similitud" hint="Cuánto se ciñe a la voz original." value={v.similarity} min={0} max={1} step={0.01} fmt={pct} onChange={(n) => f.set({similarity: n})} />
              <SliderField label="Estilo" hint="Exagera el estilo de la voz; 0 es lo más natural." value={v.style} min={0} max={1} step={0.01} fmt={pct} onChange={(n) => f.set({style: n})} />
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <div className="flex flex-col">
                  <Label className="text-sm">Realzar la voz</Label>
                  <span className="text-xs text-muted-foreground">Speaker boost: más parecida a la original, algo más lenta de generar.</span>
                </div>
                <Switch checked={v.speakerBoost} onCheckedChange={(b) => f.set({speakerBoost: b})} />
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <Label className="text-sm">Probar</Label>
                <span className="text-xs text-muted-foreground">Genera una muestra con estos ajustes (gasta caracteres de ElevenLabs) y mide el ritmo.</span>
              </div>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-sm" />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={listen} disabled={sampling || !v.voiceId || !text.trim()}>
                  {sampling ? <Loader2 className="animate-spin" /> : <Sparkles />} Generar muestra
                </Button>
                {sample && (
                  <Button variant="ghost" size="icon" className="rounded-full" onClick={() => player.toggle(sample.audio)} title="Escuchar otra vez">
                    {player.playing === sample.audio ? <Pause /> : <Play />}
                  </Button>
                )}
                {sample && (
                  <span className="text-xs text-muted-foreground">
                    {sample.words} palabras en {sample.seconds.toFixed(1)} s
                  </span>
                )}
                {sampleErr && <span className="text-sm text-destructive">{sampleErr}</span>}
              </div>
            </div>

            <p className="text-sm">
              Ritmo: <span className="font-medium tabular-nums">{v.wordsPerSec.toFixed(2)} palabras/s</span>
              <span className="text-muted-foreground">
                {' '}
                · con él se calcula cuánto dura cada guion{measured ? ' · medido con esta muestra' : ''}
              </span>
              {soundChanged && !measured && <span className="block text-xs text-amber-400">Cambiaste la voz o sus ajustes: genera una muestra para medir el ritmo de nuevo.</span>}
            </p>
          </>
        )}
        <SaveBar dirty={f.dirty} busy={f.busy} saved={f.justSaved} err={f.err} onSave={f.commit} onReset={f.reset} />
      </CardContent>
      <VoiceDialog
        open={picking}
        onOpenChange={setPicking}
        current={v?.voiceId ?? null}
        onPick={(o) => {
          setPicking(false);
          if (o) f.set({voiceId: o.id, voiceName: o.name});
        }}
      />
    </Card>
  );
}
