import {useEffect, useState} from 'react';
import {Check, ChevronLeft, Loader2, Palette, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import CardGridSkeleton from '@/components/common/CardGridSkeleton';
import EmptyState from '@/components/common/EmptyState';
import {api, profileApi, useSocket, type Style} from './api';
import {useStudio} from './studio';

// Estilos: the visual styles a reel can be made in, read from styles/<id>/style.json in the workspace.
// #/estilos is the grid of styles; #/estilos/<id> is one style in detail. "Nuevo estilo" opens a conversation
// where the agent asks for it (name, colours, references…) and writes it; the page reloads when it appears.

// The styles' typefaces, so the samples show in their own font (loaded once, only on this page).
function useStyleFonts(styles: Style[] | null) {
  useEffect(() => {
    const fams = [...new Set(styles?.flatMap((s) => s.fonts.map((f) => f.google).filter((g): g is string => !!g)) ?? [])];
    if (!fams.length) return;
    const href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join('&')}&display=swap`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}));
  }, [styles]);
}

const styleIdFromHash = () => location.hash.match(/^#\/estilos\/([a-z0-9-]+)/)?.[1] ?? null;
function useStyleId() {
  const [id, setId] = useState(styleIdFromHash);
  useEffect(() => {
    const on = () => setId(styleIdFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return id;
}

// Estilos and Formatos share one page: its tabs are the two grids' routes, so links and the agent's context stay as they were.
export function StylesFormatsTabs({value}: {value: 'styles' | 'formats'}) {
  return (
    <Tabs value={value} onValueChange={(v) => (location.hash = v === 'formats' ? '#/formatos' : '#/estilos')}>
      <TabsList>
        <TabsTrigger value="styles">Estilos</TabsTrigger>
        <TabsTrigger value="formats">Formatos</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// A video in this style still needs its own skill and template to be made.
const isReady = (s: Style) => !!(s.skill && s.template);

// The style new videos of the open project start in: its own (Ajustes → Perfil), else the workspace's.
const defaultOf = (styles: Style[]) => styles.find((s) => s.projectDefault) ?? styles.find((s) => s.default);
function DefaultBadge({style: s, styles}: {style: Style; styles: Style[]}) {
  if (defaultOf(styles)?.id !== s.id) return null;
  return <Badge variant="secondary">{s.projectDefault ? 'Por defecto en este proyecto' : 'Predeterminado'}</Badge>;
}

export function Styles() {
  const {uiRef} = useStudio();
  const id = useStyleId();
  uiRef.current = {page: 'styles', style: id ?? undefined};
  const [styles, setStyles] = useState<Style[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useStyleFonts(styles);
  useEffect(() => {
    api.styles().then(setStyles, (e: Error) => setError(e.message));
  }, []);
  useSocket(
    (m) => m.type === 'styles' && void api.styles().then(setStyles, () => {}),
    () => void api.styles().then(setStyles, () => {}),
  );
  const open = id ? styles?.find((s) => s.id === id) : undefined;
  // Make a style the project's default (null: back to the workspace's), then show the new state.
  const setDefault = async (sid: string | null) => {
    await profileApi.save({style: sid});
    setStyles(await api.styles());
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!styles && !error && <CardGridSkeleton count={6} className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" mediaClassName="aspect-auto h-64" progress={false} />}
      {styles && (id ? open ? <StyleDetail style={open} styles={styles} setDefault={setDefault} /> : <NotFound /> : <StyleGrid styles={styles} />)}
    </main>
  );
}

function StyleGrid({styles}: {styles: Style[]}) {
  const {uiRef, setOpen} = useStudio();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.newStyle(uiRef.current);
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <StylesFormatsTabs value="styles" />
          {err && <p className="mt-1 text-sm text-destructive">{err}</p>}
        </div>
        <Button onClick={create} disabled={busy} title="Abre una conversación con el agente: te pide el nombre, los colores, referencias e imágenes, y crea el estilo">
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Nuevo estilo
        </Button>
      </div>
      {styles.length === 0 ? (
        <EmptyState icon={Palette} title="Todavía no hay estilos." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {styles.map((s, i) => (
            <a key={s.id} href={`#/estilos/${s.id}`} className="group hover-lift animate-fade-in flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40" style={{animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'both'}}>
              <div className="flex h-64 justify-center gap-2 overflow-hidden border-b bg-muted/30 p-3">
                {s.examples.length ? (
                  s.examples.slice(0, 3).map((u) => <img key={u} src={u} alt="" loading="lazy" className="h-full min-w-0 flex-1 rounded-sm object-cover object-top" />)
                ) : (
                  <Poster style={s} className="h-full" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{s.name}</h2>
                  <DefaultBadge style={s} styles={styles} />
                  {!isReady(s) && <Badge variant="outline">Sin plantilla</Badge>}
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{s.summary}</p>
                <div className="mt-auto flex gap-1 pt-2">
                  {s.palette.map((c) => (
                    <span key={c.hex} title={`${c.name} ${c.hex}`} className="h-3 flex-1 rounded-sm border border-foreground/10" style={{background: c.hex}} />
                  ))}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

// A 9:16 sample frame drawn from the style's palette and fonts, for styles with no approved frames yet.
// Palette order: background, ink, lines, then accents.
export function Poster({style: s, className}: {style: Style; className?: string}) {
  const [bg, ink, line, ...accents] = s.palette.map((c) => c.hex);
  const [title, label, caption] = s.fonts;
  return (
    <div
      className={`relative flex aspect-[9/16] flex-col overflow-hidden rounded-sm ${className ?? ''}`}
      style={{background: bg, color: ink, backgroundImage: line ? `linear-gradient(${line}55 1px, transparent 1px), linear-gradient(90deg, ${line}55 1px, transparent 1px)` : undefined, backgroundSize: '12px 12px'}}
    >
      <div className="flex flex-1 flex-col gap-[6%] p-[9%] pt-[16%]">
        {title && <span style={{fontFamily: title.css, fontWeight: title.weight, fontSize: '1.05em', lineHeight: 1.05}}>{title.sample}</span>}
        <div className="flex items-center gap-[8%]">
          {accents.slice(0, 3).map((a) => (
            <span key={a} className="aspect-square w-[22%] rounded-full border-2" style={{borderColor: ink, background: a}} />
          ))}
        </div>
        {label && <span style={{fontFamily: label.css, fontWeight: label.weight, fontSize: '0.55em', lineHeight: 1.3}}>{label.sample}</span>}
      </div>
      {caption && (
        <span className="mx-[6%] mb-[14%] rounded-[2px] px-[5%] py-[4%] text-center" style={{fontFamily: caption.css, fontWeight: caption.weight, fontSize: '0.5em', background: '#FBFAF6', color: '#151413'}}>
          {caption.sample}
        </span>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <Back />
      <p className="text-sm text-muted-foreground">Ese estilo no existe.</p>
    </div>
  );
}

// Make this style the one the open project's new videos start in, or give that back to the workspace's default.
function DefaultButton({style: s, styles, setDefault}: {style: Style; styles: Style[]; setDefault: (id: string | null) => Promise<void>}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isDefault = defaultOf(styles)?.id === s.id;
  // The workspace's default when the project has none: nothing to change here.
  if (isDefault && !s.projectDefault) return null;
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      await setDefault(s.projectDefault ? null : s.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const general = styles.find((x) => x.default);
  return (
    <span className="ml-auto flex items-center gap-2">
      {err && <span className="text-sm text-destructive">{err}</span>}
      {s.projectDefault ? (
        <Button variant="ghost" size="sm" onClick={run} disabled={busy} title={`Los videos nuevos de este proyecto volverán a empezar en ${general ? `«${general.name}»` : 'el estilo predeterminado'}`}>
          {busy && <Loader2 className="animate-spin" />} Dejar de usar por defecto
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={run} disabled={busy} title="Los videos nuevos de este proyecto empezarán en este estilo (Ajustes → Cuenta → Perfil)">
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Usar por defecto en este proyecto
        </Button>
      )}
    </span>
  );
}

const Back = () => (
  <a href="#/estilos" className="-ml-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    <ChevronLeft className="size-4" /> Estilos
  </a>
);

function StyleDetail({style: s, styles, setDefault}: {style: Style; styles: Style[]; setDefault: (id: string | null) => Promise<void>}) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Back />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
          <DefaultBadge style={s} styles={styles} />
          {!isReady(s) && <Badge variant="outline">Sin plantilla</Badge>}
          <DefaultButton style={s} styles={styles} setDefault={setDefault} />
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{s.summary}</p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Carpeta <code className="text-foreground">styles/{s.id}</code>
          </span>
          {s.skill && (
            <span>
              Skill <code className="text-foreground">{s.skill}</code>
            </span>
          )}
          {s.template && (
            <span>
              Plantilla <code className="text-foreground">{s.template}/</code>
            </span>
          )}
          {!isReady(s) && <span>Todavía no tiene skill ni plantilla: aún no se pueden hacer videos con él.</span>}
        </p>
      </div>

      <div>
        <Heading>{s.examples.length ? 'Fotogramas aprobados' : 'Muestra'}</Heading>
        {s.examples.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {s.examples.map((u) => (
              <button key={u} onClick={() => setZoom(u)} className="cursor-zoom-in overflow-hidden rounded-md border">
                <img src={u} alt="" loading="lazy" className="aspect-[9/16] w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-end gap-4">
            <Poster style={s} className="w-44 text-[22px]" />
            <p className="max-w-xs text-xs text-muted-foreground">Hecha con su paleta y su tipografía. Los fotogramas aprobados aparecerán cuando se haga el primer video en este estilo.</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {s.palette.length > 0 && (
          <div>
            <Heading>Paleta</Heading>
            <ul className="flex flex-col gap-2">
              {s.palette.map((c) => (
                <li key={c.hex} className="flex items-center gap-3">
                  <span className="size-9 flex-none rounded-md border border-foreground/10" style={{background: c.hex}} />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{c.name}</span> <code className="text-xs text-muted-foreground">{c.hex}</code>
                    <span className="block text-xs text-muted-foreground">{c.meaning}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.fonts.length > 0 && (
          <div>
            <Heading>Tipografía</Heading>
            <ul className="flex flex-col gap-2">
              {s.fonts.map((f) => (
                <li key={f.family} className="flex flex-col gap-0.5 rounded-md px-3 py-2" style={{background: s.palette[0]?.hex, color: s.palette[1]?.hex}}>
                  <span className="text-2xl leading-tight break-words" style={{fontFamily: f.css, fontWeight: f.weight}}>
                    {f.sample}
                  </span>
                  <span className="text-xs opacity-70">
                    {f.family} · {f.use}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Rules title="Cómo se ve" items={s.look} />
        <Rules title="Movimiento" items={s.motion} />
        <Rules title="Imágenes" items={s.sources} />
        <Rules title="Evitar" items={s.avoid} />
      </div>

      {s.thumbnail && (
        <div>
          <Heading>Miniatura</Heading>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {s.thumbnail.example && (
              <button onClick={() => setZoom(s.thumbnail!.example)} className="flex-none cursor-zoom-in self-start overflow-hidden rounded-md border">
                <img src={s.thumbnail.example} alt="Ejemplo de miniatura" loading="lazy" className="aspect-[9/16] w-44 object-cover" />
              </button>
            )}
            <div className="grid flex-1 gap-6 md:grid-cols-2">
              <Rules title="Cómo se ve" items={s.thumbnail.look} />
              <Rules title="Evitar" items={s.thumbnail.avoid} />
            </div>
          </div>
        </div>
      )}

      {s.references.length > 0 && (
        <div>
          <Heading>Referencias de las que salió</Heading>
          <div className="flex gap-2 overflow-x-auto">
            {s.references.map((u) => (
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
