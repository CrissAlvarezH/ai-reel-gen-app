// Publicar: a version of the video to the project's Instagram account, now or at a time (server/publish.ts). The
// button opens the form; under the player, what was sent from this video and how it's going. A scheduled one goes out
// from the account at its time, with the app closed; until then it can be moved or canceled.
import {useCallback, useEffect, useState} from 'react';
import {CalendarClock, CircleCheck, ExternalLink, Loader2, Send} from 'lucide-react';
import {api, type PostedReel, type PublicationStatus, type VideoPublication, type VideoPublications} from './api';
import {useConfirm} from './confirm';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Switch} from '@/components/ui/switch';
import {cn} from '@/lib/utils';

export const MOVING: ReadonlySet<PublicationStatus> = new Set(['uploading', 'processing', 'publishing']);

export const STATUS: Record<PublicationStatus, {label: string; tone: string}> = {
  uploading: {label: 'Subiendo', tone: 'text-sky-600 dark:text-sky-400'},
  scheduled: {label: 'Programada', tone: 'text-violet-600 dark:text-violet-400'},
  processing: {label: 'Instagram lo procesa', tone: 'text-sky-600 dark:text-sky-400'},
  publishing: {label: 'Publicando', tone: 'text-sky-600 dark:text-sky-400'},
  published: {label: 'Publicado', tone: 'text-emerald-600 dark:text-emerald-400'},
  error: {label: 'No se publicó', tone: 'text-destructive'},
  canceled: {label: 'Cancelada', tone: 'text-muted-foreground'},
};

// A time is a day (<input type="date">, local) and a whole hour: the account's cron publishes on the hour.
type When = {day: string; hour: number};
const whenOf = (d: Date): When => ({day: new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10), hour: d.getHours()});
const dateOf = (w: When) => new Date(`${w.day}T${String(w.hour).padStart(2, '0')}:00`);
// The next o'clock at least 30 minutes away: a sensible first time to offer.
const nextHour = () => {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
};
// When's checked here first, so the form says so before anything is sent.
const whenError = (w: When) => {
  const d = dateOf(w);
  if (Number.isNaN(d.getTime())) return 'Elige una fecha y una hora.';
  if (d.getTime() <= Date.now()) return 'Elige una hora en el futuro.';
  return '';
};

function WhenPicker({id, value, onChange}: {id: string; value: When; onChange: (w: When) => void}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-day`}>Fecha</Label>
        <Input id={`${id}-day`} type="date" value={value.day} min={whenOf(new Date()).day} onChange={(e) => onChange({...value, day: e.target.value})} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-hour`}>Hora</Label>
        <Select value={String(value.hour)} onValueChange={(h) => onChange({...value, hour: Number(h)})}>
          <SelectTrigger id={`${id}-hour`} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({length: 24}, (_, h) => (
              <SelectItem key={h} value={String(h)}>
                {String(h).padStart(2, '0')}:00
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('es', {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

// The video's publications, refreshed every few seconds while one is on its way, every minute while one waits.
export function usePublications(slug: string) {
  const [data, setData] = useState<VideoPublications | null>(null);
  const load = useCallback(() => api.publications(slug).then(setData, () => {}), [slug]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  const moving = data?.items.some((p) => MOVING.has(p.status));
  const waiting = data?.items.some((p) => p.status === 'scheduled');
  useEffect(() => {
    if (!moving && !waiting) return;
    const t = setInterval(load, moving ? 4000 : 60_000);
    return () => clearInterval(t);
  }, [moving, waiting, load]);
  return {data, load};
}

// posted: the reel Mi cuenta found it posted as, when it was posted some other way (or before this button existed).
export function PublishButton({slug, version, data, posted, onDone}: {slug: string; version: string | null; data: VideoPublications | null; posted: PostedReel | null; onDone: () => void}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [when, setWhen] = useState(() => whenOf(nextHour()));
  const [feed, setFeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = !!data?.signedIn && !!data.account;
  // This version's latest publication that went (or is going) somewhere: the button wears its state, and the form
  // warns before sending the same video twice.
  const last = version ? data?.items.find((p) => p.version === version && p.status !== 'error' && p.status !== 'canceled') : undefined;
  // Out on Instagram without a publication from here: Mi cuenta saw it.
  const outside = !last && version ? posted : null;
  const postedOn = outside?.posted ? new Date(outside.posted).toLocaleDateString('es', {day: 'numeric', month: 'long'}) : null;

  const submit = async () => {
    if (!version) return;
    let scheduledAt: string | null = null;
    if (mode === 'later') {
      const bad = whenError(when);
      if (bad) return setError(bad);
      scheduledAt = dateOf(when).toISOString();
    }
    setBusy(true);
    setError('');
    try {
      await api.publish(slug, {version, scheduledAt, shareToFeed: feed});
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message.replace(/^./, (c) => c.toUpperCase()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        disabled={!version}
        className={cn('shrink-0', (last?.status === 'published' || outside) && 'text-emerald-600 dark:text-emerald-400', last?.status === 'scheduled' && 'text-violet-600 dark:text-violet-400')}
        title={!version ? 'Renderiza el video para publicarlo' : last ? `${STATUS[last.status].label}: abre para ver o publicar otra vez` : outside ? `Publicado en Instagram${postedOn ? ` el ${postedOn}` : ''} (lo encontró Mi cuenta): abre para publicar otra vez` : 'Publicar esta versión en Instagram, ahora o programada'}
        onClick={() => {
          setMode('now');
          setWhen(whenOf(nextHour()));
          setError('');
          setOpen(true);
        }}
      >
        {!last && !outside ? (
          <>
            <Send /> Publicar
          </>
        ) : !last || last.status === 'published' ? (
          <>
            <CircleCheck /> Publicado
          </>
        ) : last.status === 'scheduled' ? (
          <>
            <CalendarClock /> Programado
          </>
        ) : (
          <>
            <Loader2 className="animate-spin" /> {STATUS[last.status].label}…
          </>
        )}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publicar en Instagram</DialogTitle>
            <DialogDescription>
              {ready ? (
                <>
                  Versión <span className="font-medium text-foreground">{version}</span> en <span className="font-medium text-foreground">@{data!.account}</span>.
                </>
              ) : (
                'Para publicar, inicia sesión con tu cuenta y elige la cuenta de Instagram de este proyecto.'
              )}
            </DialogDescription>
          </DialogHeader>

          {ready && outside && (
            <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span>Este video ya está en Instagram{postedOn ? ` desde el ${postedOn}` : ''}, según Mi cuenta: si lo publicas otra vez, saldrá repetido.</span>
              <a href={outside.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-xs underline-offset-2 hover:underline">
                Ver en Instagram <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {ready && last && (
            <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span>
                {last.status === 'published'
                  ? `Esta versión ya está en Instagram (${fmtWhen(last.createdAt)}): si la publicas otra vez, saldrá repetida.`
                  : last.status === 'scheduled' && last.scheduledAt
                    ? `Esta versión ya está programada para el ${fmtWhen(last.scheduledAt)}. Cámbiala o cancélala debajo del video.`
                    : 'Esta versión se está publicando ahora mismo.'}
              </span>
              {last.permalink && (
                <a href={last.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-xs underline-offset-2 hover:underline">
                  Ver en Instagram <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}
          {!ready ? (
            <Button asChild variant="outline" className="self-start">
              <a href="#/ajustes/cuenta" onClick={() => setOpen(false)}>
                Ir a Ajustes → Cuenta
              </a>
            </Button>
          ) : (
            <div className="flex flex-col gap-4">
              <div role="radiogroup" aria-label="Cuándo" className="grid grid-cols-2 gap-2">
                {(['now', 'later'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors', mode === m ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground hover:bg-muted/50')}
                  >
                    {m === 'now' ? <Send className="size-4" /> : <CalendarClock className="size-4" />}
                    {m === 'now' ? 'Ahora' : 'Programar'}
                  </button>
                ))}
              </div>
              {mode === 'later' && (
                <div className="flex flex-col gap-1.5">
                  <WhenPicker id="publish-when" value={when} onChange={setWhen} />
                  <p className="text-xs text-muted-foreground">Sale a esa hora en punto (unos minutos después) desde tu cuenta, aunque Reel Studio esté cerrado. Hasta entonces puedes cambiarla o cancelarla.</p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Caption</span>
                {data!.caption ? (
                  <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{data!.caption}</p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Este video no tiene caption: saldrá sin texto. Escríbelo en la pestaña Caption IG.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{data!.cover ? 'Portada: la miniatura del video.' : 'Sin miniatura: Instagram elige la portada del video.'}</p>
              <label className="flex items-center justify-between gap-3 text-sm">
                Mostrar también en el feed
                <Switch checked={feed} onCheckedChange={setFeed} />
              </label>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            {ready && (
              <Button disabled={busy || !version} onClick={submit}>
                {busy && <Loader2 className="animate-spin" />}
                {mode === 'now' ? (last || outside ? 'Publicar otra vez' : 'Publicar ahora') : last || outside ? 'Programar otra vez' : 'Programar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// What was sent from this video, newest first: the ones done long ago stay out of the way (the last 3 finished).
export function PublicationList({slug, data, onChange}: {slug: string; data: VideoPublications | null; onChange: () => void}) {
  const confirm = useConfirm();
  const [moving, setMoving] = useState<VideoPublication | null>(null);
  const [when, setWhen] = useState<When>(() => whenOf(nextHour()));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!data?.items.length) return null;
  const open = data.items.filter((p) => p.status === 'scheduled' || MOVING.has(p.status));
  const done = data.items.filter((p) => !open.includes(p)).slice(0, 3);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError('');
    try {
      await fn();
      onChange();
      return true;
    } catch (e) {
      setError((e as Error).message.replace(/^./, (c) => c.toUpperCase()));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (p: VideoPublication) => {
    if (!(await confirm({title: '¿Cancelar esta publicación?', description: 'No saldrá en Instagram y su copia en tu cuenta se borra.', action: 'Sí, cancelarla', cancel: 'No', destructive: true}))) return;
    await act(p.id, () => api.cancelPublication(slug, p.id));
  };
  const saveTime = async (now: boolean) => {
    if (!moving) return;
    let at = 'now';
    if (!now) {
      const bad = whenError(when);
      if (bad) return setError(bad);
      at = dateOf(when).toISOString();
    }
    if (await act(moving.id, () => api.reschedulePublication(slug, moving.id, at))) setMoving(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">Publicaciones</span>
      <ul className="divide-y rounded-lg border">
        {[...open, ...done].map((p) => {
          const s = STATUS[p.status];
          const pending = p.status === 'scheduled' || (p.status === 'uploading' && p.scheduledAt);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <Badge variant="outline" className={cn('gap-1', s.tone)}>
                {MOVING.has(p.status) && <Loader2 className="size-3 animate-spin" />}
                {s.label}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {p.status === 'scheduled' && p.scheduledAt ? `Sale el ${fmtWhen(p.scheduledAt)}` : fmtWhen(p.createdAt)} · {p.version} · @{p.account}
              </span>
              {pending && p.status === 'scheduled' && (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => {
                      setWhen(whenOf(new Date(p.scheduledAt!)));
                      setError('');
                      setMoving(p);
                    }}
                  >
                    Cambiar hora
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy === p.id} onClick={() => cancel(p)}>
                    {busy === p.id && <Loader2 className="animate-spin" />}
                    Cancelar
                  </Button>
                </span>
              )}
              {p.permalink && (
                <a href={p.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Ver en Instagram <ExternalLink className="size-3" />
                </a>
              )}
              {p.status === 'error' && p.error && <p className="w-full text-xs text-destructive">{p.error}</p>}
            </li>
          );
        })}
      </ul>
      {error && !moving && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog open={!!moving} onOpenChange={(o) => !busy && !o && setMoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cambiar la hora</DialogTitle>
            <DialogDescription>Sale a esa hora en punto desde tu cuenta, aunque Reel Studio esté cerrado. «Publicar ahora» la manda ya.</DialogDescription>
          </DialogHeader>
          <WhenPicker id="publish-move" value={when} onChange={setWhen} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={!!busy} onClick={() => saveTime(true)}>
              Publicar ahora
            </Button>
            <Button disabled={!!busy} onClick={() => saveTime(false)}>
              {busy && <Loader2 className="animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
