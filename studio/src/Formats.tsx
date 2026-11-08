import {useEffect, useState} from 'react';
import {ChevronLeft, Film, Mic, Video} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import CardGridSkeleton from '@/components/common/CardGridSkeleton';
import EmptyState from '@/components/common/EmptyState';
import {api, useSocket, type ReelFormat} from './api';
import {useStudio} from './studio';
import {StylesFormatsTabs} from './Styles';

// Formatos: the kinds of video, read from formats/<id>/format.json in the workspace — how a video gets made
// (all animation over a generated voice, him talking to camera with animations…), what's on screen and how
// it's cut. How it looks (colours, type, borders) is its style's, not its format's.
// #/formatos is the grid; #/formatos/<id> one format in detail.

// The file picker for a voiceOnly format's recording: audio, or a video whose sound is used.
export const AUDIO_ACCEPT = 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac,video/*,.mov,.mkv';

export function useFormats() {
  const [formats, setFormats] = useState<ReelFormat[] | null>(null);
  const load = () => api.formats().then(setFormats, () => setFormats((f) => f ?? []));
  useEffect(() => void load(), []);
  useSocket((m) => m.type === 'formats' && void load(), () => void load());
  return formats;
}

const formatIdFromHash = () => location.hash.match(/^#\/formatos\/([a-z0-9-]+)/)?.[1] ?? null;
function useFormatId() {
  const [id, setId] = useState(formatIdFromHash);
  useEffect(() => {
    const on = () => setId(formatIdFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return id;
}

export function Formats() {
  const {uiRef} = useStudio();
  const id = useFormatId();
  uiRef.current = {page: 'formats', videoFormat: id ?? undefined};
  const formats = useFormats();
  const open = id ? formats?.find((f) => f.id === id) : undefined;
  return (
    <main className="mx-auto max-w-7xl p-6">
      {!formats && <CardGridSkeleton count={6} className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" mediaClassName="aspect-auto h-64" progress={false} />}
      {formats && (id ? open ? <FormatDetail format={open} /> : <NotFound /> : <FormatGrid formats={formats} />)}
    </main>
  );
}

function Badges({format: f}: {format: ReelFormat}) {
  return (
    <>
      {f.default && <Badge variant="secondary">Predeterminado</Badge>}
      {f.footage && (
        <Badge variant="outline">
          {f.voiceOnly ? (
            <>
              <Mic /> Con tu voz
            </>
          ) : (
            <>
              <Video /> Con tu grabación
            </>
          )}
        </Badge>
      )}
    </>
  );
}

function FormatGrid({formats}: {formats: ReelFormat[]}) {
  return (
    <>
      <div className="mb-6">
        <StylesFormatsTabs value="formats" />
      </div>
      {formats.length === 0 ? (
        <EmptyState icon={Film} title="Todavía no hay formatos." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {formats.map((f, i) => (
            <a key={f.id} href={`#/formatos/${f.id}`} className="group hover-lift animate-fade-in flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40" style={{animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'both'}}>
              <div className="flex h-64 justify-center gap-2 overflow-hidden border-b bg-muted/30 p-3">
                {f.examples.length ? (
                  f.examples.slice(0, 3).map((u) => <img key={u} src={u} alt="" loading="lazy" className="h-full min-w-0 flex-1 rounded-sm object-cover object-top" />)
                ) : (
                  <FormatPoster format={f} className="h-full" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{f.name}</h2>
                  <Badges format={f} />
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{f.summary}</p>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

// A 9:16 sketch of what's on screen, for formats with no frames yet: in grey, since colours are the style's.
// With footage: a person filling the frame, an animation card above. Without: animation full frame (with a mic
// and his voice's wave when the voice is his own recording). An SVG, so
// it reads the same as a small thumbnail (Nuevo reel) or a big one (this page).
export function FormatPoster({format: f, className}: {format: ReelFormat; className?: string}) {
  return (
    <svg viewBox="0 0 90 160" className={cn('aspect-[9/16] rounded-sm border', className)} aria-hidden>
      <rect width="90" height="160" fill="#171717" />
      {f.footage && !f.voiceOnly ? (
        <>
          <circle cx="45" cy="86" r="15" fill="#737373" />
          <rect x="13" y="106" width="64" height="70" rx="30" fill="#737373" />
          <rect x="10" y="14" width="70" height="40" rx="5" fill="#e5e5e5" />
          <rect x="17" y="21" width="34" height="4" rx="2" fill="#737373" />
          <rect x="17" y="38" width="8" height="10" rx="1.5" fill="#a3a3a3" />
          <rect x="29" y="33" width="8" height="15" rx="1.5" fill="#a3a3a3" />
          <rect x="41" y="28" width="8" height="20" rx="1.5" fill="#a3a3a3" />
        </>
      ) : (
        <>
          <rect x="12" y="22" width="52" height="5" rx="2.5" fill="#d4d4d4" />
          <rect x="12" y="32" width="34" height="5" rx="2.5" fill="#d4d4d4" />
          <circle cx="22" cy="62" r="9" fill="#a3a3a3" />
          <rect x="36" y="54" width="15" height="15" rx="2" fill="#737373" transform="rotate(8 43.5 61.5)" />
          <circle cx="66" cy="62" r="6" fill="none" stroke="#a3a3a3" strokeWidth="2" />
          {f.voiceOnly ? (
            <>
              <rect x="8" y="86" width="74" height="40" rx="20" fill="#404040" />
              <circle cx="28" cy="106" r="16" fill="#e5e5e5" />
              <rect x="24" y="96" width="8" height="13" rx="4" fill="#171717" />
              <path d="M20.5 104.5a7.5 7.5 0 0 0 15 0M28 112v4M24 116h8" fill="none" stroke="#171717" strokeWidth="2.2" strokeLinecap="round" />
              {[8, 14, 20, 11, 22, 15, 9].map((h, i) => (
                <rect key={i} x={50 + i * 4.3} y={106 - h / 2} width="2.6" height={h} rx="1.3" fill="#d4d4d4" />
              ))}
            </>
          ) : (
            <rect x="12" y="96" width="66" height="22" rx="4" fill="#404040" />
          )}
        </>
      )}
      <rect x="14" y="134" width="62" height="7" rx="2" fill="#f5f5f5" />
    </svg>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <Back />
      <p className="text-sm text-muted-foreground">Ese formato no existe.</p>
    </div>
  );
}

const Back = () => (
  <a href="#/formatos" className="-ml-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    <ChevronLeft className="size-4" /> Formatos
  </a>
);

function FormatDetail({format: f}: {format: ReelFormat}) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Back />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{f.name}</h1>
          <Badges format={f} />
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{f.summary}</p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Carpeta <code className="text-foreground">formats/{f.id}</code>
          </span>
          {f.skill && (
            <span>
              Skill <code className="text-foreground">{f.skill}</code>
            </span>
          )}
          {f.overlay && (
            <span>
              Añade a la plantilla <code className="text-foreground">{f.overlay}/</code>
            </span>
          )}
          {f.footage && <span>{f.voiceOnly ? 'Al crear un video en este formato subes tu voz grabada (uno o varios audios).' : 'Al crear un video en este formato subes tu grabación (uno o varios clips).'}</span>}
        </p>
      </div>

      <div>
        <Heading>{f.examples.length ? 'Fotogramas' : 'En pantalla, a grandes rasgos'}</Heading>
        {f.examples.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {f.examples.map((u) => (
              <button key={u} onClick={() => setZoom(u)} className="cursor-zoom-in overflow-hidden rounded-md border">
                <img src={u} alt="" loading="lazy" className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-end gap-4">
            <FormatPoster format={f} className="w-44" />
            <p className="max-w-xs text-xs text-muted-foreground">Un boceto en gris: los colores, la tipografía y los bordes los pone el estilo de cada video.</p>
          </div>
        )}
      </div>

      {f.how.length > 0 && (
        <div>
          <Heading>Cómo se hace</Heading>
          <ol className="flex max-w-3xl list-decimal flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
            {f.how.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Rules title="En pantalla" items={f.screen} />
        <Rules title="Edición" items={f.editing} />
        <Rules title="Evitar" items={f.avoid} />
      </div>

      {f.references.length > 0 && (
        <div>
          <Heading>Referencias</Heading>
          <div className="flex gap-2 overflow-x-auto">
            {f.references.map((u) => (
              <button key={u} onClick={() => setZoom(u)} className="flex-none cursor-zoom-in overflow-hidden rounded-md border">
                <img src={u} alt="" loading="lazy" className="h-48 w-auto" />
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-h-[92vh] max-w-[92vw] p-2 sm:max-w-[92vw]">
          <DialogTitle className="sr-only">Imagen</DialogTitle>
          {zoom && <img src={zoom} alt="" className="mx-auto max-h-[86vh] w-auto object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Heading = ({children}: {children: React.ReactNode}) => <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>;

function Rules({title, items}: {title: string; items: string[]}) {
  if (!items.length) return null;
  return (
    <div>
      <Heading>{title}</Heading>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm marker:text-muted-foreground">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
