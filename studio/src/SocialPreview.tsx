import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Bookmark, Camera, ChevronDown, Heart, Home, MessageCircle, MoreHorizontal, Music2, Pause, Play, Plus, Search, Send, Share2, Smartphone, SquarePlay, ThumbsDown, ThumbsUp, UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Label} from '@/components/ui/label';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {fmtTime, projectsApi, type Project, type ReelDetail} from './api';
import {LivePreview, type PreviewControls} from './Preview';

type Platform = 'instagram' | 'tiktok' | 'youtube';
const platforms = [
  {id: 'instagram', name: 'Instagram', format: 'Reels', icon: Camera},
  {id: 'tiktok', name: 'TikTok', format: 'Para ti', icon: Music2},
  {id: 'youtube', name: 'YouTube', format: 'Shorts', icon: SquarePlay},
] as const;

export function SocialPreview({reel, src, live, version, initialTime, onOpen}: {
  reel: ReelDetail;
  src: string;
  live: boolean;
  version: string;
  initialTime: number;
  onOpen: () => void;
}) {
  return (
    <Dialog onOpenChange={(open) => { if (open) onOpen(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0" aria-label="Vista previa en redes" title="Vista previa en Instagram, TikTok y YouTube Shorts">
          <Smartphone />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Vista previa en redes</DialogTitle>
          <DialogDescription>Mira cómo se ve tu video con la interfaz de cada plataforma.</DialogDescription>
        </DialogHeader>
        <SocialPlayer key={`${live ? 'live' : src}`} reel={reel} src={src} live={live} version={version} initialTime={initialTime} />
      </DialogContent>
    </Dialog>
  );
}

function SocialPlayer({reel, src, live, version, initialTime}: {
  reel: ReelDetail; src: string; live: boolean; version: string; initialTime: number;
}) {
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [showInterface, setShowInterface] = useState(true);
  const [project, setProject] = useState<Project>();
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [start] = useState(initialTime);
  const video = useRef<HTMLVideoElement>(null);
  const preview = useRef<PreviewControls | null>(null);
  useEffect(() => {
    let active = true;
    projectsApi.list().then((all) => { if (active) setProject(all.find((p) => p.current)); }, () => {});
    return () => { active = false; };
  }, []);
  const loaded = (duration: number) => {
    setDuration(duration);
    setReady(true);
  };
  const toggle = async () => {
    if (live) preview.current?.toggle();
    else if (video.current) {
      if (video.current.paused) {
        try { await video.current.play(); } catch { setError('No se pudo reproducir el video. Intenta de nuevo.'); }
      } else video.current.pause();
    }
  };
  const seek = (t: number) => {
    if (live) preview.current?.seek(t);
    else if (video.current) video.current.currentTime = t;
    setTime(t);
  };
  const name = project?.name ?? 'Tu cuenta';
  const avatar = project?.avatar != null ? `/project-files/${project.id}/avatar?v=${project.avatar}` : undefined;
  const selected = platforms.find((p) => p.id === platform)!;
  return (
    <Tabs value={platform} onValueChange={(value) => setPlatform(value as Platform)} className="gap-4">
      <TabsList className="w-full" aria-label="Plataforma de la vista previa">
        {platforms.map((p) => <TabsTrigger key={p.id} value={p.id}><p.icon /><span>{p.name}</span></TabsTrigger>)}
      </TabsList>
      <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="w-full max-w-[320px] overflow-hidden rounded-[1.5rem] border-4 border-zinc-800 bg-black text-white shadow-xl" style={{width: 'min(100%, 32dvh)'}}>
            <div className="relative isolate aspect-[9/16] overflow-hidden">
              <div className="absolute inset-0 grid place-items-center">
                {live && reel.previewEntry ? (
                  <LivePreview slug={reel.slug} entry={reel.previewEntry} controls={preview} initialTime={start} showControls={false} onTime={setTime} onDuration={loaded} onPlayingChange={setPlaying} />
                ) : (
                  <video ref={video} src={src} playsInline preload="auto" className="size-full object-contain"
                    onLoadedMetadata={(e) => { const v = e.currentTarget; loaded(v.duration); v.currentTime = Math.min(start, Math.max(0, v.duration - 0.01)); }}
                    onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => { setPlaying(true); setError(''); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                    onError={() => { setReady(false); setError('No se pudo cargar esta versión del video.'); }} />
                )}
              </div>
              {platforms.map((p) => (
                <TabsContent key={p.id} value={p.id} className="pointer-events-none absolute inset-0 m-0 text-white" aria-label={`${p.name} ${p.format}`}>
                  {showInterface && <PlatformOverlay platform={p.id} name={name} avatar={avatar} caption={reel.caption.trim() || reel.title || 'Tu video'} />}
                </TabsContent>
              ))}
            </div>
            {showInterface && <BottomNav platform={platform} />}
          </div>
          <div className="flex w-full items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => void toggle()} disabled={!ready} aria-label={playing ? 'Pausar vista previa' : 'Reproducir vista previa'}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Slider aria-label="Posición del video" value={[Math.min(time, duration)]} min={0} max={duration || 1} step={0.1} disabled={!ready} onValueChange={([t]) => seek(t)} className="min-w-0 flex-1" />
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtTime(time)} / {fmtTime(duration)}</span>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted"><selected.icon className="size-5" /></div>
            <div><p className="font-medium">{selected.name}</p><p className="text-xs text-muted-foreground">{selected.format} · Vista móvil</p></div>
          </div>
          <div className="flex flex-col gap-1"><p className="text-xs text-muted-foreground">Versión seleccionada</p><p className="text-sm break-all">{version}</p></div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="social-preview-interface">Mostrar interfaz</Label>
            <Switch id="social-preview-interface" checked={showInterface} onCheckedChange={setShowInterface} />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">Revisa que los botones y la descripción no cubran textos o elementos importantes de tu video.</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Simulación visual. La interfaz puede variar según el dispositivo y la versión de la app.</p>
        </div>
      </div>
    </Tabs>
  );
}

function Avatar({name, src}: {name: string; src?: string}) {
  return <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-white/50 bg-zinc-700 text-[10px] font-semibold">{src ? <img src={src} alt="" className="size-full object-cover" /> : name.slice(0, 2).toUpperCase()}</span>;
}

function Action({children, label}: {children: ReactNode; label?: string}) {
  return <span className="flex flex-col items-center gap-1 [&_svg]:size-5">{children}{label && <span className="text-[8px] font-medium">{label}</span>}</span>;
}

function PlatformOverlay({platform, name, avatar, caption}: {platform: Platform; name: string; avatar?: string; caption: string}) {
  const instagram = platform === 'instagram';
  const youtube = platform === 'youtube';
  return (
    <div className="absolute inset-0 text-[10px] [text-shadow:0_1px_4px_#000]" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/75 to-transparent" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 py-4">
        {instagram ? <><span className="flex items-center gap-1 text-base font-semibold">Reels <ChevronDown className="size-3" /></span><Camera className="size-5" /></>
          : youtube ? <><span className="flex items-center gap-1 font-semibold"><SquarePlay className="size-5" /> Shorts</span><Search className="size-4" /></>
          : <><span className="text-white/70">LIVE</span><span className="text-white/70">Siguiendo</span><span className="border-b-2 border-white pb-1 font-semibold">Para ti</span><Search className="size-4" /></>}
      </div>
      <div className="absolute right-2 bottom-5 flex w-8 flex-col items-center gap-4">
        {!instagram && !youtube && <Avatar name={name} src={avatar} />}
        <Action label={youtube ? 'Me gusta' : undefined}>{youtube ? <ThumbsUp /> : <Heart />}</Action>
        {youtube && <Action label="No me gusta"><ThumbsDown /></Action>}
        <Action label={youtube ? 'Comentarios' : undefined}><MessageCircle /></Action>
        <Action label={youtube ? 'Compartir' : undefined}>{instagram ? <Send /> : <Share2 />}</Action>
        {!youtube && <Action>{instagram ? <MoreHorizontal /> : <Bookmark />}</Action>}
        <span className="grid size-6 place-items-center rounded-md border border-white/60 bg-zinc-800"><Music2 className="size-3" /></span>
      </div>
      <div className="absolute right-12 bottom-4 left-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          {(instagram || youtube) && <Avatar name={name} src={avatar} />}
          <span className="truncate font-semibold">{youtube ? '@' : ''}{name}</span>
          {(instagram || youtube) && <span className={youtube ? 'rounded-full bg-white px-2 py-1 text-[8px] text-black [text-shadow:none]' : 'rounded border border-white/60 px-1.5 py-0.5 text-[8px]'}>{youtube ? 'Suscribirse' : 'Seguir'}</span>}
        </div>
        <p className="line-clamp-2 leading-relaxed whitespace-pre-line">{caption}</p>
        <span className="flex items-center gap-1 text-[9px]"><Music2 className="size-3 shrink-0" /><span className="truncate">{instagram ? 'Audio original' : 'Sonido original'} · {name}</span></span>
      </div>
    </div>
  );
}

function BottomNav({platform}: {platform: Platform}) {
  return (
    <div aria-hidden="true" className="flex h-10 items-center justify-around border-t border-white/10 bg-black px-2 text-white [&_svg]:size-4">
      <Home /><Search />{platform === 'tiktok' ? <span className="rounded bg-white px-2 py-0.5 text-black"><Plus /></span> : <Plus />}{platform === 'youtube' ? <SquarePlay /> : <MessageCircle />}<UserRound />
    </div>
  );
}
