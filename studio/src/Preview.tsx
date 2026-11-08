import {useEffect, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {AlertTriangle, Loader2, RotateCw, Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {chatApi, useAgentName, useLive} from './api';
import {useStudio} from './studio';

// Live preview: the reel's current code played in the browser with @remotion/player, no render.
// It imports the reel's src/Root.tsx (projects/<id>/videos/<slug>/) and reads the <Composition> it returns, so whatever Root
// declares (component, size, fps, duration, props) is what plays. Edits to the reel's src/ hot-reload.

type CompProps = {
  id?: string;
  component: React.ComponentType<Record<string, unknown>>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps?: Record<string, unknown>;
};

// Root is a plain component returning <Composition/> (maybe inside a fragment or <Folder>): call it and walk.
function findComposition(node: unknown): CompProps | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const c = findComposition(n);
      if (c) return c;
    }
    return null;
  }
  const props = (node as {props?: Record<string, unknown>}).props;
  if (!props) return null;
  if (props.component && props.durationInFrames) return props as unknown as CompProps;
  return findComposition(props.children);
}

export type PreviewControls = {seek: (t: number) => void; pause: () => void; toggle: () => void};

// The reel's code failing, said in plain words, with what to ask Claude. The raw message stays below.
function explain(msg: string): {title: string; detail: string; ask: string} {
  let m = msg.match(/cue not found: (.+)/);
  if (m)
    return {
      title: 'Los actos no coinciden con la voz',
      detail: `El código marca el inicio de un acto con la frase «${m[1]}», pero la voz grabada no la dice. Pasa cuando el guion cambió y los actos (src/lib.ts) siguen siendo los del guion anterior o los del template.`,
      ask: `La vista en vivo no carga: src/lib.ts usa cue("${m[1]}") y esa frase no está en la voz (src/words.json). Escribe los actos y las escenas para el guion actual, o ajusta los cues a lo que dice la voz, y comprueba que la vista en vivo carga.`,
    };
  m = msg.match(/cue "(.+)" is said (\d+) times/);
  if (m)
    return {
      title: 'Una frase de los actos se repite en la voz',
      detail: `El código marca un acto con «${m[1]}», pero la voz la dice ${m[2]} veces y no sabe cuál usar.`,
      ask: `La vista en vivo no carga: cue("${m[1]}") aparece ${m[2]} veces en la voz. Indica cuál es con el parámetro nth (o usa una frase única) y comprueba que la vista en vivo carga.`,
    };
  return {
    title: 'El código del video tiene un error',
    detail: 'La vista en vivo no puede mostrar el video hasta que se corrija.',
    ask: `La vista en vivo no carga con este error:\n${msg}\nCorrígelo y comprueba que la vista en vivo carga.`,
  };
}

function PreviewError({slug, message, onRetry}: {slug: string; message: string; onRetry?: () => void}) {
  const agent = useAgentName();
  const {uiRef, setOpen} = useStudio();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const e = explain(message);
  const ask = async () => {
    setState('sending');
    setErr('');
    try {
      await chatApi.send(slug, 'active', e.ask, [], {...uiRef.current});
      setState('sent');
      setOpen(true);
    } catch (x) {
      setErr((x as Error).message);
      setState('idle');
    }
  };
  return (
    <div className="flex size-full flex-col justify-center gap-3 overflow-auto bg-muted/40 p-5 text-left">
      <AlertTriangle className="size-6 text-amber-400" />
      <p className="font-medium">{e.title}</p>
      <p className="text-sm text-muted-foreground">{e.detail}</p>
      <div className="flex flex-wrap gap-2">
        {state === 'sent' ? (
          <p className="text-sm text-muted-foreground">Enviado a {agent}: mira el panel de la derecha.</p>
        ) : (
          <Button size="sm" onClick={ask} disabled={state === 'sending'}>
            {state === 'sending' ? <Loader2 className="animate-spin" /> : <Sparkles />} Pedir a {agent} que lo arregle
          </Button>
        )}
        {onRetry && (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RotateCw /> Reintentar
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="font-mono text-xs break-words text-muted-foreground/70">{message}</p>
    </div>
  );
}

export function LivePreview({
  slug,
  entry,
  onTime,
  onDuration,
  controls,
  initialTime = 0,
  showControls = true,
  onPlayingChange,
}: {
  slug: string;
  entry: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  controls: React.MutableRefObject<PreviewControls | null>;
  initialTime?: number;
  showControls?: boolean;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const [comp, setComp] = useState<CompProps | null>(null);
  const [err, setErr] = useState('');
  const player = useRef<PlayerRef>(null);
  // Bumped to load the code again after an error (a fresh URL, since the browser keeps a module that failed).
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((n) => n + 1);
  // While it's broken, try again whenever the reel's files change (Claude fixing it).
  const timer = useRef<number | undefined>(undefined);
  useLive((s) => {
    if (s !== slug || !err) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(retry, 800);
  });

  useEffect(() => {
    let alive = true;
    // staticFile('cut/x.png') → /files/<slug>/public/cut/x.png
    window.remotion_staticBase = `/files/${slug}/public`;
    setErr('');
    import(/* @vite-ignore */ attempt ? `${entry}?t=${Date.now()}` : entry)
      .then((mod) => {
        if (!alive) return;
        const Root = mod.Root ?? mod.default;
        if (typeof Root !== 'function') throw new Error('src/Root.tsx no exporta Root');
        const c = findComposition(Root({}));
        if (!c) throw new Error('Root no devuelve ninguna <Composition>');
        setComp(c);
        onDuration(c.durationInFrames / c.fps);
      })
      .catch((e) => alive && setErr(e?.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, [slug, entry, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = player.current;
    if (!p || !comp) return;
    const on = (e: {detail: {frame: number}}) => onTime(e.detail.frame / comp.fps);
    p.addEventListener('frameupdate', on);
    p.addEventListener('seeked', on);
    const playing = () => onPlayingChange?.(true);
    const paused = () => onPlayingChange?.(false);
    p.addEventListener('play', playing);
    p.addEventListener('pause', paused);
    p.addEventListener('ended', paused);
    controls.current = {seek: (t) => p.seekTo(Math.round(t * comp.fps)), pause: () => p.pause(), toggle: () => p.toggle()};
    return () => {
      p.removeEventListener('frameupdate', on);
      p.removeEventListener('seeked', on);
      p.removeEventListener('play', playing);
      p.removeEventListener('pause', paused);
      p.removeEventListener('ended', paused);
      controls.current = null;
    };
  }, [comp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <PreviewError slug={slug} message={err} onRetry={retry} />;
  if (!comp)
    return (
      <Skeleton role="status" aria-live="polite" className="shimmer size-full min-h-40 rounded-none">
        <span className="sr-only">Cargando composición…</span>
      </Skeleton>
    );
  return (
    <Player
      ref={player}
      component={comp.component}
      inputProps={comp.defaultProps ?? {}}
      durationInFrames={comp.durationInFrames}
      compositionWidth={comp.width}
      compositionHeight={comp.height}
      fps={comp.fps}
      controls={showControls}
      initialFrame={Math.max(0, Math.min(comp.durationInFrames - 1, Math.round(initialTime * comp.fps)))}
      clickToPlay
      style={{width: '100%', height: '100%'}}
      errorFallback={({error}: {error: Error}) => <PreviewError slug={slug} message={error.message} />}
    />
  );
}
