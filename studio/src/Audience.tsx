import {useEffect, useRef, useState} from 'react';
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Brain, Check, Clock, Flame, Heart, Layers, Loader2, MoreHorizontal, Package, Pencil, Plus, RotateCcw, Sparkles, Target, X, type LucideIcon} from 'lucide-react';
import {AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import PageSkeleton from '@/components/common/PageSkeleton';
import {audienceApi, ideasApi, useSocket, type Audience, type AudienceLevels, type AudienceWant, type IdeaVertical, type PillarSet, type WantOption} from './api';
import {COLORS, ICONS} from './Ideas';
import {useConfirm} from './confirm';
import {projectKey, read, useStudio, write} from './studio';

// Perfil de audiencia (#/audiencia): who the channel's videos are for, what they want, what they deal with and what they
// think (server/audience.ts). The first time, an onboarding goes through the steps; then each part is a tab with its
// Editar. The AI suggests and he picks: a suggestion is saved only when he takes it. The verticals go to Ideas de contenido.

type Step = 'offer' | 'product' | 'wants' | 'pillars' | 'problems' | 'levels';
const STEPS: {id: Step; title: string; icon: LucideIcon; lead: string}[] = [
  {id: 'offer', title: 'Tu oferta', icon: Target, lead: 'A quién ayudas y a conseguir qué. Es el público de todos tus videos.'},
  {id: 'product', title: 'Tu producto', icon: Package, lead: 'Si vendes algo, el agente lo tiene en cuenta en tus guiones.'},
  {id: 'wants', title: 'Lo que quiere', icon: Heart, lead: 'Todo lo que quiere tu audiencia, con sus palabras, y a dónde la lleva.'},
  {id: 'pillars', title: 'Verticales', icon: Layers, lead: 'Los temas sobre los que vas a publicar siempre, agrupando lo que quiere.'},
  {id: 'problems', title: 'Con lo que lidia', icon: Flame, lead: 'Los problemas que hacen que alguien se detenga y piense «ese soy yo».'},
  {id: 'levels', title: 'Lo que piensa', icon: Brain, lead: 'Qué se dice alguien con cada problema, según cuánto sabe de él.'},
];
export const LEVELS: {key: keyof Omit<AudienceLevels, 'problem'>; label: string; hint: string; dot: string; top: string}[] = [
  {key: 'unaware', label: 'No lo sabe', hint: 'Tiene el problema pero no le ha puesto nombre: cree que es normal o culpa a otra cosa.', dot: 'bg-zinc-400', top: 'border-t-zinc-400/70'},
  {key: 'problemAware', label: 'Sabe del problema', hint: 'Lo nombra con sus palabras, pero no sabe por qué pasa ni cómo arreglarlo.', dot: 'bg-amber-400', top: 'border-t-amber-400/70'},
  {key: 'solutionAware', label: 'Busca solución', hint: 'Busca cómo arreglarlo: «¿cómo hago para…?».', dot: 'bg-sky-400', top: 'border-t-sky-400/70'},
  {key: 'productAware', label: 'Conoce tu producto', hint: 'Te conoce y duda antes de comprarte (o de confiar en ti, si no vendes nada).', dot: 'bg-emerald-400', top: 'border-t-emerald-400/70'},
];
const MIN_PROBLEMS = 10;
const TOP = 8;

// The onboarding's forward button, when a step needs its own: undefined, the usual Siguiente; null, none.
type Forward = {label: string; onClick: () => void} | null | undefined;
// leave: asked before the onboarding's Siguiente moves on; false stays.
type Leave = (() => Promise<boolean>) | null;
type EditorProps = {a: Audience; set: (patch: Partial<Audience>) => void; persist: () => Promise<void>; verticals: IdeaVertical[] | null; setForward?: (f: Forward) => void; setLeave?: (f: Leave) => void};

/* ───── Small pieces ───── */

// Runs a suggestion with its busy state and error.
function useAsk() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async <T,>(fn: () => Promise<T>, then: (v: T) => void) => {
    setBusy(true);
    setErr('');
    try {
      then(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {busy, err, run};
}

function AiButton({busy, onClick, children, disabled, size = 'sm'}: {busy: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; size?: 'sm' | 'default'}) {
  return (
    <Button variant="secondary" size={size} onClick={onClick} disabled={busy || disabled} className="flex-none">
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles className="text-amber-400" />} {busy ? 'Pensando…' : children}
    </Button>
  );
}

// Where the AI is offered: what it'll do, its button, and what it's doing while it thinks.
function AiCallout({text, busy, err, action, onClick, disabled}: {text: React.ReactNode; busy: boolean; err: string; action: string; onClick: () => void; disabled?: boolean}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-amber-400/30 bg-amber-400/[0.04] p-3 @xl:flex-row @xl:items-center">
      <p className="flex-1 text-sm text-muted-foreground">{busy ? 'La IA está pensando. Suele tardar entre uno y dos minutos; puedes seguir escribiendo.' : text}</p>
      <AiButton busy={busy} onClick={onClick} disabled={disabled}>
        {action}
      </AiButton>
      {err && <p className="text-sm text-destructive @xl:basis-full">{err}</p>}
    </div>
  );
}

function Empty({icon: I, children}: {icon: LucideIcon; children: React.ReactNode}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <I className="size-5 text-muted-foreground" />
      </span>
      {children}
    </div>
  );
}

// A field that reads as part of the text until it's touched.
const quiet = 'border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent';

// The result may already end in a full stop.
const bare = (t: string) => t.trim().replace(/[.\s]+$/, '');

/* ───── Editors: the onboarding's steps, and each tab's Editar ───── */

// A blank in the sentence: grows with what's written, Enter doesn't add lines.
function Blank({value, onChange, placeholder, label}: {value: string; onChange: (v: string) => void; placeholder: string; label: string}) {
  return (
    <textarea
      aria-label={label}
      rows={1}
      maxLength={300}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
      className="field-sizing-content mx-1 inline-block max-w-full min-w-[10ch] resize-none rounded-md border-b-2 border-dashed border-foreground/25 bg-foreground/[0.04] px-2 align-top text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-solid focus:border-foreground/60"
    />
  );
}

function OfferEditor({a, set}: EditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border bg-gradient-to-br from-muted/60 to-transparent p-6 text-xl leading-[2.4rem] font-medium @2xl:p-8 @2xl:text-2xl @2xl:leading-[2.8rem]">
        Ayudo a
        <Blank label="A quién ayudas" value={a.who} onChange={(who) => set({who})} placeholder="mamás ocupadas" />
        a conseguir
        <Blank label="A conseguir qué" value={a.result} onChange={(result) => set({result})} placeholder="bajar de peso sin pasar horas en el gimnasio" />
      </div>
      <p className="text-sm text-muted-foreground">
        Por ejemplo: <span className="text-foreground/80">«Ayudo a mamás ocupadas a bajar de peso sin pasar horas en el gimnasio».</span> Cuanto más concreto el quién, mejor apunta cada video.
      </p>
    </div>
  );
}

function Choice({on, onClick, icon: I, title, text}: {on: boolean; onClick: () => void; icon: LucideIcon; title: string; text: string}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn('flex flex-1 items-start gap-3 rounded-xl border p-4 text-left transition-colors', on ? 'border-foreground/60 bg-foreground/[0.04] ring-1 ring-foreground/20' : 'hover:bg-muted/40')}
    >
      <span className={cn('flex size-9 flex-none items-center justify-center rounded-lg', on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
        <I className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{text}</span>
      </span>
      <span className={cn('ml-auto flex size-5 flex-none items-center justify-center rounded-full border', on && 'border-foreground bg-foreground text-background')}>{on && <Check className="size-3" />}</span>
    </button>
  );
}

function ProductEditor({a, set}: EditorProps) {
  const [has, setHas] = useState(!!a.product.what);
  const p = a.product;
  const product = (patch: Partial<Audience['product']>) => set({product: {...p, ...patch}});
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="¿Vendes algo?" className="flex flex-col gap-3 @xl:flex-row">
        <Choice on={has} onClick={() => setHas(true)} icon={Package} title="Vendo algo" text="Un curso, una asesoría, un servicio, un producto…" />
        <Choice on={!has} onClick={() => (setHas(false), set({product: {what: '', price: '', problems: ''}}))} icon={Clock} title="Todavía no" text="Puedes agregarlo cuando lo tengas." />
      </div>
      {has && (
        <div className="grid gap-4 @xl:grid-cols-[1fr_12rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aud-what">Qué es</Label>
            <Input id="aud-what" autoFocus maxLength={300} value={p.what} onChange={(e) => product({what: e.target.value})} placeholder="Un curso de finanzas personales" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aud-price">Cuánto cuesta</Label>
            <Input id="aud-price" maxLength={100} value={p.price} onChange={(e) => product({price: e.target.value})} placeholder="$200.000" />
          </div>
          <div className="flex flex-col gap-1.5 @xl:col-span-2">
            <Label htmlFor="aud-solves">Qué problemas resuelve</Label>
            <Textarea id="aud-solves" rows={3} maxLength={1000} value={p.problems} onChange={(e) => product({problems: e.target.value})} placeholder="Uno por línea, como lo diría tu cliente" />
          </div>
        </div>
      )}
    </div>
  );
}

const same = (o: WantOption, w: AudienceWant) => o.so1 === w.so1 && o.so2 === w.so2;
const WANT_GRID = 'grid gap-2 @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] @3xl:items-center';
const chained = (w: AudienceWant) => !!(w.so1.trim() || w.so2.trim());

// The options the AI wrote for each want, kept while the page is open: going to another step and back doesn't ask again.
const wantOptions = new Map<string, WantOption[]>();

// Writes the options of the wants that have none, in the background: a batch once he stops adding for a moment.
function useWantOptions(rows: AudienceWant[]) {
  const [options, setOptions] = useState(() => new Map(wantOptions));
  const [asking, setAsking] = useState<string[]>([]);
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const todo = rows.filter((w) => w.want.trim() && !chained(w) && !options.has(w.want) && !failed.has(w.want)).map((w) => w.want);
  const key = todo.join('\n');
  useEffect(() => {
    if (!todo.length || asking.length) return;
    const t = setTimeout(() => {
      setAsking(todo);
      audienceApi
        .wants(rows, todo)
        .then(
          (got) => {
            for (const [w, o] of Object.entries(got)) wantOptions.set(w, o);
            const missed = todo.filter((w) => !got[w]);
            if (missed.length) setFailed((f) => new Map([...f, ...missed.map((w) => [w, 'la IA no dio opciones para este'] as const)]));
          },
          (e: Error) => setFailed((f) => new Map([...f, ...todo.map((w) => [w, e.message] as const)])),
        )
        .finally(() => {
          setOptions(new Map(wantOptions));
          setAsking([]);
        });
    }, 1500);
    return () => clearTimeout(t);
  }, [key, asking.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Others for one: forget its options (and its failure), and the effect asks again.
  const again = (want: string) => {
    wantOptions.delete(want);
    setOptions(new Map(wantOptions));
    setFailed((f) => {
      const next = new Map(f);
      next.delete(want);
      return next;
    });
  };
  return {options, asking, failed, again};
}

// Lo que quiere: he adds wants while the AI writes their options in the background; then Continuar asks, one want at a
// time, which of its options it is; then the table. Only the AI's options are offered: he picks, he doesn't write them.
function WantsEditor({a, set, setForward}: EditorProps) {
  const rows = a.wants;
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<'add' | 'pick' | 'done'>(() => (rows.length && rows.every(chained) ? 'done' : 'add'));
  const [queue, setQueue] = useState<string[]>([]); // the wants being picked, in order
  const [at, setAt] = useState(0);
  const gen = useWantOptions(rows);
  const edit = (want: string, patch: Partial<AudienceWant>) => set({wants: rows.map((w) => (w.want === want ? {...w, ...patch} : w))});
  // One per line, so a pasted list becomes rows.
  const add = (text: string) => {
    const fresh = [...new Set(text.split('\n').map((x) => x.trim()))].filter((x) => x && !rows.some((w) => w.want === x));
    if (fresh.length) set({wants: [...rows, ...fresh.map((want) => ({want, so1: '', so2: ''}))]});
    setDraft('');
  };
  const pending = rows.filter((w) => w.want.trim() && !chained(w));
  const pick = (wants: string[], from = 0) => {
    setQueue(wants);
    setAt(from);
    setPhase(wants.length ? 'pick' : 'done');
  };
  const start = () => pick(pending.map((w) => w.want));

  // In the onboarding the footer's button is this step's: Continuar while there are wants to pick, none while picking.
  const forward = phase === 'add' && pending.length ? 'continue' : phase === 'pick' ? 'hide' : 'default';
  useEffect(() => {
    if (!setForward) return;
    setForward(forward === 'continue' ? {label: 'Continuar', onClick: start} : forward === 'hide' ? null : undefined);
  }, [forward, pending.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setForward?.(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'pick') {
    const want = queue[at];
    const row = rows.find((w) => w.want === want);
    if (!row) return <></>;
    const opts = gen.options.get(want);
    const err = gen.failed.get(want);
    const choose = (o: WantOption) => {
      edit(want, o);
      if (at + 1 < queue.length) setAt(at + 1);
      else setPhase('done');
    };
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Progress value={((at + 1) / queue.length) * 100} className="h-1.5 flex-1" />
          <span className="text-xs text-muted-foreground tabular-nums">
            {at + 1} de {queue.length}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu audiencia quiere</span>
          <p className="text-2xl font-semibold tracking-tight">{want}</p>
          <p className="text-sm text-muted-foreground">¿Para poder qué? Elige el camino que más se parece a lo que diría.</p>
        </div>
        <div role="radiogroup" aria-label={`Opciones para «${want}»`} className="grid gap-3 @3xl:grid-cols-3">
          {opts
            ? opts.map((o, k) => {
                const on = same(o, row);
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => choose(o)}
                    className={cn('group flex flex-col gap-3 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/50 hover:bg-foreground/[0.04]', on && 'border-foreground/60 bg-foreground/[0.05] ring-1 ring-foreground/20')}
                  >
                    <span className="flex items-center justify-between text-xs text-muted-foreground">
                      Opción {k + 1}
                      <span className={cn('flex size-5 items-center justify-center rounded-full border transition-colors group-hover:border-foreground/60', on && 'border-foreground bg-foreground text-background')}>{on && <Check className="size-3" />}</span>
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Para poder</span>
                      <span className="text-sm">{o.so1}</span>
                    </span>
                    <ArrowDown className="size-3.5 text-muted-foreground" />
                    <span className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Para poder</span>
                      <span className="text-sm">{o.so2}</span>
                    </span>
                  </button>
                );
              })
            : !err && [0, 1, 2].map((k) => <Skeleton key={k} className="h-52 rounded-xl" />)}
        </div>
        {!opts && !err && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> La IA está escribiendo las opciones de este. Suele tardar entre uno y dos minutos.
          </p>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!at} onClick={() => setAt(at - 1)}>
            <ArrowLeft /> Anterior
          </Button>
          <Button variant="ghost" size="sm" disabled={!opts && !err} onClick={() => gen.again(want)}>
            <Sparkles className="text-amber-400" /> {err ? 'Reintentar' : 'Ninguna me sirve: otras 3'}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'done')
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <div className={cn(WANT_GRID, 'hidden border-b px-2 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase @3xl:grid')}>
            <span>Lo que quiere</span>
            <span>Para poder…</span>
            <span>Para poder…</span>
            <span />
          </div>
          {rows.map((w, i) => (
            <div key={w.want} className={cn(WANT_GRID, 'group border-b px-2 py-2.5 text-sm last:border-b-0')}>
              <span className="font-medium">{w.want}</span>
              <span className="text-muted-foreground">{w.so1 || '—'}</span>
              <span className="text-muted-foreground">{w.so2 || '—'}</span>
              <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Elegir otra opción para «${w.want}»`} onClick={() => pick(rows.map((x) => x.want), i)}>
                <Pencil />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setPhase('add')}>
          <Plus /> Agregar más deseos
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
          className="flex gap-2"
        >
          <Input
            autoFocus
            value={draft}
            maxLength={600}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text');
              if (t.includes('\n')) (e.preventDefault(), add(t));
            }}
            placeholder="Algo que quiere tu audiencia, como lo diría ella… (Enter)"
            aria-label="Nuevo deseo"
            className="h-10"
          />
          <Button type="submit" variant="outline" className="h-10" disabled={!draft.trim()}>
            <Plus /> Agregar
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Incluye lo que quiere dejar de sentir o de hacer. Para creadores de contenido serían: <span className="text-foreground/70">más vistas · saber qué publicar · no sentir que el algoritmo me odia</span>
        </p>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col rounded-xl border">
          {rows.map((w) => {
            return (
              <li key={w.want} className="group flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{w.want}</span>
                  {chained(w) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.so1} → {w.so2}
                    </span>
                  )}
                </span>
                <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Quitar «${w.want}»`} onClick={() => set({wants: rows.filter((x) => x !== w)})}>
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {!setForward && pending.length > 0 && (
        <Button className="self-end" onClick={start}>
          Continuar <ArrowRight />
        </Button>
      )}
    </div>
  );
}

function useVerticals() {
  const [list, setList] = useState<IdeaVertical[] | null>(null);
  const load = () => ideasApi.board().then((b) => setList(b.verticals), () => setList([]));
  useEffect(() => void load(), []);
  useSocket((m) => m.type === 'ideas' && void load());
  return list;
}

// The board's verticals; each can be deleted right there, after asking (its ideas stay, without it).
function VerticalChips({list}: {list: IdeaVertical[]}) {
  const confirm = useConfirm();
  const [err, setErr] = useState('');
  const remove = async (v: IdeaVertical) => {
    setErr('');
    try {
      const n = (await ideasApi.board()).lists.flatMap((l) => l.cards).filter((c) => c.vertical === v.id).length;
      const ideas = n ? ` ${n === 1 ? 'La idea que la tiene se queda' : `Las ${n} ideas que la tienen se quedan`}, sin ella.` : '';
      if (!(await confirm({title: `¿Eliminar la vertical «${v.name}»?`, description: `Se quita de Ideas de contenido.${ideas}`, action: 'Eliminar', destructive: true}))) return;
      await ideasApi.removeVertical(v.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {list.map((v) => {
          const I = ICONS[v.icon];
          return (
            <Badge key={v.id} variant="outline" className={cn('group/v h-7 gap-1.5 pr-1 pl-2.5 text-sm', COLORS[v.color].badge)}>
              <I className="size-3.5" /> {v.name}
              <button type="button" aria-label={`Eliminar la vertical «${v.name}»`} onClick={() => void remove(v)} className="flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/v:opacity-70 hover:bg-foreground/10 hover:!opacity-100 focus-visible:opacity-100">
                <X className="size-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function PillarsEditor({a, persist, verticals, setLeave}: EditorProps) {
  const [sets, setSets] = useState<PillarSet[] | null>(null);
  const [tab, setTab] = useState('0');
  const [off, setOff] = useState<Set<string>>(new Set()); // pillars left out, by "set/name"
  const ask = useAsk();
  const create = useAsk();
  const [created, setCreated] = useState<number | null>(null);
  const [made, setMade] = useState(0); // created in this step, whatever was proposed
  const confirm = useConfirm();
  // In the onboarding, moving on without creating any asks first.
  useEffect(() => {
    setLeave?.(made ? null : () => confirm({title: '¿Seguir sin crear verticales?', description: 'No creaste ninguna vertical en este paso. Ordenan tus ideas de contenido y el agente las usa; las puedes crear después en la pestaña Verticales.', action: 'Seguir sin crearlas'}));
    return () => setLeave?.(null);
  }, [made]); // eslint-disable-line react-hooks/exhaustive-deps
  const exists = (name: string) => !!verticals?.some((v) => v.name.toLowerCase() === name.toLowerCase());
  const wants = a.wants.filter((w) => w.want).length;
  const propose = () =>
    void ask.run(async () => (await persist(), audienceApi.pillars()), (v) => {
      setSets(v);
      setTab('0');
      setOff(new Set());
      setCreated(null);
    });
  const chosen = (s: PillarSet, i: number) => s.pillars.filter((p) => !exists(p.name) && !off.has(`${i}/${p.name}`));
  const take = (s: PillarSet, i: number) =>
    void create.run(async () => {
      const fresh = chosen(s, i);
      for (const p of fresh) await ideasApi.addVertical({name: p.name, description: `Lo que quiere tu audiencia: ${p.wants.join('; ')}.\nEjemplos: ${p.posts.join(' / ')}`, icon: p.icon});
      return fresh.length;
    }, (n) => {
      setCreated(n);
      setMade((m) => m + n);
    });
  const toggle = (key: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      {verticals && verticals.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ya en Ideas de contenido</span>
          <VerticalChips list={verticals} />
        </div>
      )}
      {!sets && !ask.busy && (
        <Empty icon={Layers}>
          <p className="max-w-md text-sm text-muted-foreground">
            {wants ? `La IA agrupa los ${wants} deseos de tu audiencia de tres formas distintas, pensando en llegar a la mayor cantidad de tu público. Eliges una y se crean en Ideas de contenido.` : 'Primero escribe lo que quiere tu audiencia: las verticales salen de ahí.'}
          </p>
          <AiButton busy={false} onClick={propose} disabled={!wants} size="default">
            Proponer verticales
          </AiButton>
          {ask.err && <p className="text-sm text-destructive">{ask.err}</p>}
        </Empty>
      )}
      {ask.busy && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Agrupando lo que quiere tu audiencia. Suele tardar entre uno y dos minutos.
          </p>
          <div className="grid gap-3 @2xl:grid-cols-2">
            {[0, 1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
      )}
      {sets && !ask.busy && (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              {sets.map((s, i) => (
                <TabsTrigger key={i} value={String(i)} className="px-3">
                  {s.name} <span className="text-xs text-muted-foreground tabular-nums">{s.pillars.length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <AiButton busy={false} onClick={propose}>
              Proponer otras
            </AiButton>
          </div>
          {sets.map((s, i) => {
            const n = chosen(s, i).length;
            return (
              <TabsContent key={i} value={String(i)} className="flex flex-col gap-4">
                <div className="grid gap-3 @2xl:grid-cols-2">
                  {s.pillars.map((p) => {
                    const I = ICONS[p.icon];
                    const had = exists(p.name);
                    const on = !had && !off.has(`${i}/${p.name}`);
                    return (
                      <div key={p.name} className={cn('flex flex-col gap-3 rounded-xl border p-4 transition-opacity', !on && 'opacity-55')}>
                        <div className="flex items-start gap-3">
                          <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-muted">
                            <I className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.wants.length} {p.wants.length === 1 ? 'deseo' : 'deseos'}</div>
                          </div>
                          {had ? (
                            <Badge variant="secondary">Ya la tienes</Badge>
                          ) : (
                            <button type="button" role="checkbox" aria-checked={on} aria-label={`Crear «${p.name}»`} onClick={() => toggle(`${i}/${p.name}`)} className={cn('flex size-5 flex-none items-center justify-center rounded-md border', on && 'border-foreground bg-foreground text-background')}>
                              {on && <Check className="size-3" />}
                            </button>
                          )}
                        </div>
                        {p.narrow && <p className="rounded-md bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-500">Alcance limitado: {p.narrow}</p>}
                        <div className="flex flex-wrap gap-1">
                          {p.wants.map((w) => (
                            <span key={w} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {w}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
                          {p.posts.map((x, k) => (
                            <p key={x} className="flex gap-2">
                              <span className={cn('mt-1.5 size-1.5 flex-none rounded-full', k ? 'bg-emerald-400' : 'bg-rose-400')} aria-hidden />
                              <span>
                                <span className="text-muted-foreground">{k ? 'Resultado: ' : 'Problema: '}</span>
                                {x}
                              </span>
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {s.leftovers.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground/80">Sin vertical:</span> {s.leftovers.join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={create.busy || !n} onClick={() => take(s, i)}>
                    {create.busy && <Loader2 className="animate-spin" />} {n === 1 ? 'Crear la vertical seleccionada' : n ? `Crear las ${n} verticales seleccionadas` : 'Selecciona alguna vertical'}
                  </Button>
                  {created !== null && (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-500">
                      <Check className="size-4" /> {created ? `${created === 1 ? 'Creada' : `Creadas ${created}`} en` : 'Ya estaban en'}{' '}
                      Ideas de contenido
                    </span>
                  )}
                  {create.err && <span className="text-sm text-destructive">{create.err}</span>}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}

function ProblemsEditor({a, set, persist, verticals}: EditorProps) {
  const [draft, setDraft] = useState('');
  const [found, setFound] = useState<{problems: string[]; top: string[]} | null>(null);
  const ask = useAsk();
  const list = a.problems;
  const add = (items: string[]) => set({problems: [...new Set([...list, ...items.map((x) => x.trim()).filter(Boolean)])]});
  const swap = (i: number, j: number) => set({problems: list.map((x, k) => (k === i ? list[j] : k === j ? list[i] : x))});
  const fresh = found ? [...found.top, ...found.problems.filter((p) => !found.top.includes(p))].filter((p) => !list.includes(p)) : [];
  const picks = fresh.filter((p) => found?.top.includes(p));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 text-sm @xl:grid-cols-2">
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.04] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-rose-400">
            <X className="size-3.5" /> Muy vago, nadie se siente aludido
          </div>
          <span className="text-muted-foreground">«días difíciles» · «crecer mi cuenta» · «estrés»</span>
        </div>
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <Check className="size-3.5" /> Concreto: «ese soy yo»
          </div>
          <span className="text-muted-foreground">«ansiedad todos los días» · «estancado en 1.000 seguidores»</span>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Con las palabras que usa antes de saber del tema, como diría «tengo ___» o «lidio con ___». El agente usa esta lista para que tus videos lleguen a más gente.</p>

      <div className="grid gap-6 @3xl:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Tu lista</span>
            <Progress value={Math.min(100, (list.length / MIN_PROBLEMS) * 100)} className="h-1.5 flex-1" />
            <span className={cn('text-xs tabular-nums', list.length >= MIN_PROBLEMS ? 'text-emerald-500' : 'text-muted-foreground')}>
              {list.length} / {MIN_PROBLEMS}
            </span>
          </div>
          {list.length > 0 && (
            <ol className="flex flex-col rounded-xl border">
              {list.map((p, i) => (
                <li key={p} className={cn('group flex items-center gap-2 px-3 py-1.5 text-sm', i < TOP && 'bg-foreground/[0.03]', i === TOP - 1 && i < list.length - 1 && 'border-b border-dashed')}>
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="flex-1">{p}</span>
                  <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} aria-label={`Subir «${p}»`} onClick={() => swap(i, i - 1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" disabled={i === list.length - 1} aria-label={`Bajar «${p}»`} onClick={() => swap(i, i + 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Quitar «${p}»`} onClick={() => set({problems: list.filter((x) => x !== p)})}>
                      <X />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {list.length > TOP && <p className="text-xs text-muted-foreground">Los {TOP} primeros (sombreados) son los que se trabajan en «Lo que piensa». Ordénalos por importancia.</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add([draft]);
              setDraft('');
            }}
          >
            <Input value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder="Escribe uno… (Enter)" aria-label="Nuevo problema" />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> Agregar
            </Button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Sugerencias</span>
            {found && (
              <AiButton busy={ask.busy} onClick={() => void ask.run(async () => (await persist(), audienceApi.problems((verticals ?? []).map((v) => v.name))), setFound)}>
                Otras 20
              </AiButton>
            )}
          </div>
          {!found && !ask.busy && (
            <Empty icon={Sparkles}>
              <p className="max-w-xs text-sm text-muted-foreground">La IA te propone 20 a partir de lo que quiere tu audiencia, y marca las que elegiría.</p>
              <AiButton busy={false} onClick={() => void ask.run(async () => (await persist(), audienceApi.problems((verticals ?? []).map((v) => v.name))), setFound)}>
                Sugerir 20
              </AiButton>
              {ask.err && <p className="text-sm text-destructive">{ask.err}</p>}
            </Empty>
          )}
          {ask.busy && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from({length: 12}, (_, k) => (
                <Skeleton key={k} className="h-8 rounded-full" style={{width: `${7 + ((k * 37) % 6)}rem`}} />
              ))}
            </div>
          )}
          {found && !ask.busy && (
            <>
              {picks.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3 text-amber-400" /> Las que la IA elegiría primero: las que más gente de tu audiencia tiene. Haz clic en una para agregarla.
                </p>
              )}
              {fresh.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {fresh.map((p) => {
                    const pick = found.top.includes(p);
                    return (
                      <button key={p} type="button" onClick={() => add([p])} className={cn('group/chip flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:border-foreground/50 hover:bg-foreground/[0.05]', pick ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'text-muted-foreground hover:text-foreground')}>
                        <Plus className="size-3.5 text-muted-foreground group-hover/chip:text-foreground" /> {p}
                        {pick && <Sparkles className="size-3 text-amber-400" aria-label="la IA lo elegiría" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Ya agregaste todas.</p>
              )}
              {picks.length > 1 && (
                <Button variant="outline" size="sm" className="self-start" onClick={() => add(picks)}>
                  <Sparkles className="text-amber-400" /> Agregar las {picks.length} que elegiría la IA
                </Button>
              )}
              {ask.err && <p className="text-sm text-destructive">{ask.err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LevelLegend() {
  return (
    <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
      {LEVELS.map((l, i) => (
        <div key={l.key} className="rounded-lg border p-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={cn('size-2 rounded-full', l.dot)} aria-hidden /> {i + 1}. {l.label}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{l.hint}</p>
        </div>
      ))}
    </div>
  );
}

function LevelsEditor({a, set, persist}: EditorProps) {
  const ask = useAsk();
  const top = a.problems.slice(0, TOP);
  const missing = top.filter((p) => !a.levels.some((l) => l.problem === p));
  const edit = (i: number, patch: Partial<AudienceLevels>) => set({levels: a.levels.map((l, j) => (j === i ? {...l, ...patch} : l))});
  return (
    <div className="flex flex-col gap-5">
      <LevelLegend />
      {!top.length ? (
        <Empty icon={Flame}>
          <p className="text-sm text-muted-foreground">Primero elige los problemas de tu audiencia: esto se escribe para los {TOP} primeros.</p>
        </Empty>
      ) : (
        <>
          {a.levels.map((row, i) => (
            <div key={row.problem} className="group flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{row.problem}</span>
                <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Quitar «${row.problem}» para reescribirlo`} onClick={() => set({levels: a.levels.filter((_, j) => j !== i)})}>
                  <X />
                </Button>
              </div>
              <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
                {LEVELS.map((l) => (
                  <div key={l.key} className={cn('rounded-lg border border-t-2 bg-muted/20', l.top)}>
                    <Textarea aria-label={`${row.problem}: ${l.label}`} rows={2} value={row[l.key]} onChange={(e) => edit(i, {[l.key]: e.target.value})} className={cn(quiet, 'min-h-0 rounded-lg text-sm italic hover:border-transparent focus-visible:border-transparent focus-visible:ring-0')} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {ask.busy &&
            missing.map((p) => (
              <div key={p} className="flex flex-col gap-2">
                <span className="text-sm font-medium text-muted-foreground">{p}</span>
                <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
                  {LEVELS.map((l) => (
                    <Skeleton key={l.key} className="h-16 rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          <AiCallout
            busy={ask.busy}
            err={ask.err}
            disabled={!missing.length}
            onClick={() => void ask.run(async () => (await persist(), audienceApi.levels()), (rows) => set({levels: [...a.levels, ...rows.filter((r) => missing.includes(r.problem))]}))}
            action={missing.length ? `Escribir ${missing.length}` : 'Todo escrito'}
            text={missing.length ? `La IA escribe lo que piensa alguien con ${missing.length === top.length ? `tus ${top.length} primeros problemas` : `los ${missing.length} que faltan`}, en primera persona y como se lo escribiría a un amigo.` : 'Para reescribir uno, quítalo (pasa el cursor sobre su nombre).'}
          />
        </>
      )}
    </div>
  );
}

const EDITORS: Record<Step, (p: EditorProps) => React.ReactElement> = {offer: OfferEditor, product: ProductEditor, wants: WantsEditor, pillars: PillarsEditor, problems: ProblemsEditor, levels: LevelsEditor};

/* ───── The onboarding ───── */

function stepNote(id: Step, a: Audience, verticals: IdeaVertical[] | null) {
  if (id === 'offer') return a.who && a.result ? 'Lista' : 'Por llenar';
  if (id === 'product') return a.product.what || 'Opcional';
  if (id === 'wants') return a.wants.length ? `${a.wants.length} ${a.wants.length === 1 ? 'deseo' : 'deseos'}` : 'Por llenar';
  if (id === 'pillars') return verticals?.length ? `${verticals.length} en Ideas` : 'Por crear';
  if (id === 'problems') return `${a.problems.length} / ${MIN_PROBLEMS}`;
  return `${a.levels.length} / ${Math.min(TOP, a.problems.length) || TOP}`;
}
// The product is optional: done once he's been past it.
const stepDone = (id: Step, a: Audience, verticals: IdeaVertical[] | null, passed: boolean) =>
  id === 'offer' ? !!(a.who && a.result) : id === 'product' ? passed || !!a.product.what : id === 'wants' ? a.wants.length > 0 && a.wants.every((w) => w.so1 && w.so2) : id === 'pillars' ? !!verticals?.length : id === 'problems' ? a.problems.length >= MIN_PROBLEMS : a.levels.length > 0 && a.levels.length >= Math.min(TOP, a.problems.length);

function Stepper({step, a, verticals, go}: {step: number; a: Audience; verticals: IdeaVertical[] | null; go: (i: number) => void}) {
  return (
    <nav aria-label="Pasos" className="@3xl:sticky @3xl:top-6 @3xl:self-start">
      <ol className="flex gap-1 overflow-x-auto pb-1 @3xl:flex-col @3xl:gap-0 @3xl:overflow-visible">
        {STEPS.map((x, i) => {
          const current = i === step;
          const done = !current && stepDone(x.id, a, verticals, i < step);
          return (
            <li key={x.id} className="relative flex-none @3xl:pb-5 @3xl:last:pb-0">
              {i < STEPS.length - 1 && <span aria-hidden className={cn('absolute top-8 left-[15px] hidden h-[calc(100%-2rem)] w-px @3xl:block', i < step ? 'bg-foreground/40' : 'bg-border')} />}
              <button type="button" onClick={() => go(i)} aria-current={current ? 'step' : undefined} className={cn('group flex items-center gap-3 rounded-lg py-0.5 pr-3 text-left', !current && 'hover:bg-muted/40')}>
                <span
                  className={cn(
                    'relative z-10 flex size-8 flex-none items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors',
                    current ? 'border-foreground bg-foreground text-background ring-4 ring-foreground/10' : done ? 'border-foreground/40 bg-background text-foreground' : 'bg-background text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="flex flex-col">
                  <span className={cn('text-sm whitespace-nowrap', current ? 'font-semibold' : 'text-muted-foreground group-hover:text-foreground')}>{x.title}</span>
                  <span className="hidden max-w-40 truncate text-xs text-muted-foreground @3xl:block">{stepNote(x.id, a, verticals)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ───── What each tab shows once the onboarding is done ───── */

function Hero({a}: {a: Audience}) {
  return (
    <p className="text-lg leading-relaxed font-medium @2xl:text-xl">
      <span className="text-muted-foreground">Ayudo a</span> {bare(a.who) || '…'} <span className="text-muted-foreground">a conseguir</span> {bare(a.result) || '…'}.
    </p>
  );
}

function View({step, a, verticals}: {step: Step; a: Audience; verticals: IdeaVertical[] | null}) {
  const none = (t: string) => <p className="py-6 text-center text-sm text-muted-foreground">{t}</p>;
  if (step === 'offer')
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border bg-gradient-to-br from-muted/60 to-transparent p-6">
          <Hero a={a} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu producto</span>
          {a.product.what ? (
            <div className="flex flex-col gap-2 rounded-xl border p-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{a.product.what}</span>
                {a.product.price && <span className="text-sm text-muted-foreground">{a.product.price}</span>}
              </div>
              {a.product.problems && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{a.product.problems}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no vendes nada.</p>
          )}
        </div>
      </div>
    );
  if (step === 'wants')
    return a.wants.length ? (
      <div className="flex flex-col">
        <div className={cn(WANT_GRID, 'hidden border-b px-2 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase @3xl:grid')}>
          <span>Lo que quiere</span>
          <span>Para poder…</span>
          <span>Para poder…</span>
          <span />
        </div>
        {a.wants.map((w, i) => (
          <div key={i} className={cn(WANT_GRID, 'border-b px-2 py-3 text-sm last:border-b-0')}>
            <span className="font-medium">{w.want}</span>
            <span className="text-muted-foreground">{w.so1 || '—'}</span>
            <span className="text-muted-foreground">{w.so2 || '—'}</span>
            <span />
          </div>
        ))}
      </div>
    ) : (
      none('Todavía no hay nada.')
    );
  if (step === 'problems')
    return a.problems.length ? (
      <div className="flex flex-col gap-3">
        {a.problems.length > TOP && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-3 rounded-full bg-foreground" aria-hidden /> Los {TOP} más importantes: de estos se escribe «Lo que piensa».
          </p>
        )}
        {/* In columns, so it reads down like a list: the top ones together on the left. */}
        <ol className="gap-x-6 @2xl:columns-2">
          {a.problems.map((p, i) => (
            <li key={p} className="flex break-inside-avoid items-center gap-3 border-b py-2 text-sm">
              <span className={cn('flex size-6 flex-none items-center justify-center rounded-full text-xs tabular-nums', i < TOP ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
              {p}
            </li>
          ))}
        </ol>
      </div>
    ) : (
      none('Todavía no hay problemas.')
    );
  if (step === 'levels')
    return a.levels.length ? (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 @4xl:sticky @4xl:top-0 @4xl:z-10 @4xl:-mb-2 @4xl:grid @4xl:grid-cols-4 @4xl:gap-2 @4xl:bg-background/90 @4xl:py-2 @4xl:backdrop-blur">
          {LEVELS.map((l, i) => (
            <span key={l.key} className="flex items-center gap-1.5 text-xs text-muted-foreground @4xl:font-medium @4xl:text-foreground/80" title={l.hint}>
              <span className={cn('size-2 rounded-full', l.dot)} aria-hidden /> {i + 1}. {l.label}
            </span>
          ))}
        </div>
        {a.levels.map((row) => (
          <div key={row.problem} className="flex flex-col gap-2">
            <span className="text-sm font-medium">{row.problem}</span>
            <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
              {LEVELS.map((l) => (
                <blockquote key={l.key} className={cn('rounded-lg border border-t-2 bg-muted/20 p-3 text-sm italic', l.top)}>
                  {row[l.key] ? `«${row[l.key]}»` : <span className="text-muted-foreground not-italic">—</span>}
                </blockquote>
              ))}
            </div>
          </div>
        ))}
      </div>
    ) : (
      none('Todavía no hay nada.')
    );
  return verticals?.length ? (
    <div className="grid gap-3 @2xl:grid-cols-2">
      {verticals.map((v) => {
        const I = ICONS[v.icon];
        return (
          <div key={v.id} className="flex gap-3 rounded-xl border p-4">
            <span className={cn('flex size-9 flex-none items-center justify-center rounded-lg border', COLORS[v.color].badge)}>
              <I className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="font-medium">{v.name}</div>
              {v.description && <p className="mt-0.5 line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{v.description}</p>}
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    none('Todavía no hay verticales en Ideas de contenido.')
  );
}

/* ───── The page ───── */

const TABS: {id: Step; title: string; icon: LucideIcon; count?: (a: Audience, v: IdeaVertical[] | null) => number}[] = [
  {id: 'offer', title: 'Oferta', icon: Target},
  {id: 'wants', title: 'Lo que quiere', icon: Heart, count: (a) => a.wants.length},
  {id: 'pillars', title: 'Verticales', icon: Layers, count: (_, v) => v?.length ?? 0},
  {id: 'problems', title: 'Con lo que lidia', icon: Flame, count: (a) => a.problems.length},
  {id: 'levels', title: 'Lo que piensa', icon: Brain, count: (a) => a.levels.length},
];

// ⋯ → Reiniciar: deletes the whole profile once he types the phrase, and the onboarding opens again.
const PHRASE = 'borrar datos de audiencia';
function ResetMenu({onReset}: {onReset: (a: Audience) => void}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = typed.trim().toLowerCase() === PHRASE;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr('');
    try {
      onReset(await audienceApi.reset());
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Más opciones">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem variant="destructive" className="whitespace-nowrap" onSelect={() => (setTyped(''), setErr(''), setOpen(true))}>
            <RotateCcw /> Empezar de cero
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar el perfil de audiencia?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borra la promesa, el producto, lo que quiere, los problemas y lo que piensa, y vuelves al paso 1. Tu público y las verticales de Ideas de contenido se quedan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>
                Escribe <strong className="font-semibold">{PHRASE}</strong> para confirmar
              </span>
              <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} placeholder={PHRASE} />
            </label>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={busy}>
                Cancelar
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!ok || busy}>
                {busy && <Loader2 className="animate-spin" />} Borrar y empezar de cero
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AudiencePage() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'audience'};
  const verticals = useVerticals();
  const [saved, setSaved] = useState<Audience | null>(null);
  const [draft, setDraft] = useState<Audience | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The onboarding's step, kept per project so leaving the page and coming back resumes it.
  const stepKey = projectKey('studio.audience.step');
  const [step, setStepState] = useState(() => Math.min(Math.max(Number(read(stepKey, '0')) || 0, 0), STEPS.length - 1));
  const setStep = (i: number) => {
    setStepState(i);
    write(stepKey, String(i));
  };
  const [tab, setTab] = useState<Step>('offer');
  const [editing, setEditing] = useState(false);
  const [forward, setForward] = useState<Forward>(undefined);
  const leave = useRef<Leave>(null);
  useEffect(() => {
    audienceApi.get().then(
      (a) => (setSaved(a), setDraft(a)),
      (e: Error) => setErr(e.message),
    );
  }, []);

  const set = (patch: Partial<Audience>) => setDraft((d) => (d ? {...d, ...patch} : d));
  const persist = async (extra: Partial<Audience> = {}) => {
    if (!draft) return;
    const a = await audienceApi.save({...draft, ...extra});
    setSaved(a);
    setDraft(a);
  };
  const commit = async (extra: Partial<Audience> = {}, then?: () => void) => {
    setBusy(true);
    setErr('');
    try {
      await persist(extra);
      then?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!draft || !saved)
    return <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">{err ? <p className="text-sm text-destructive">{err}</p> : <PageSkeleton maxWidth="max-w-none" action={false} className="p-0" />}</main>;

  const props = {a: draft, set, persist: () => persist(), verticals};
  const reset = (a: Audience) => {
    wantOptions.clear();
    setSaved(a);
    setDraft(a);
    setStep(0);
    setTab('offer');
    setEditing(false);
    setErr('');
  };

  if (!saved.onboarded) {
    const s = STEPS[step];
    const Editor = EDITORS[s.id];
    const next = STEPS[step + 1];
    const go = (i: number) => void commit({}, () => setStep(i));
    return (
      <main className="@container mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Conoce a tu audiencia</h1>
            <p className="text-sm text-muted-foreground">Seis pasos. La IA te ayuda en los que más cuestan, y todo se puede cambiar después.</p>
          </div>
          <ResetMenu onReset={reset} />
        </div>
        <div className="grid gap-8 @3xl:grid-cols-[12rem_minmax(0,1fr)]">
          <Stepper step={step} a={draft} verticals={verticals} go={go} />
          <section aria-labelledby="aud-step" className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase tabular-nums">
                Paso {step + 1} de {STEPS.length}
              </span>
              <h2 id="aud-step" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                <s.icon className="size-5 text-muted-foreground" /> {s.title}
              </h2>
              <p className="text-sm text-muted-foreground">{s.lead}</p>
            </div>
            <Editor key={s.id} {...props} setForward={setForward} setLeave={(f) => (leave.current = f)} />
            <div className="sticky bottom-0 -mx-1 mt-2 flex items-center gap-2 border-t bg-background/90 px-1 py-4 backdrop-blur">
              {step > 0 && (
                <Button variant="ghost" disabled={busy} onClick={() => go(step - 1)}>
                  <ArrowLeft /> Atrás
                </Button>
              )}
              {err && <span className="text-sm text-destructive">{err}</span>}
              <div className="ml-auto flex items-center gap-3">
                {forward === null ? null : forward ? (
                  <Button disabled={busy} onClick={forward.onClick}>
                    {forward.label} <ArrowRight />
                  </Button>
                ) : next ? (
                  <Button disabled={busy} onClick={async () => (!leave.current || (await leave.current())) && go(step + 1)}>
                    {busy && <Loader2 className="animate-spin" />} Siguiente: {next.title} <ArrowRight />
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => void commit({onboarded: true}, () => setTab('offer'))}>
                    {busy ? <Loader2 className="animate-spin" /> : <Check />} Terminar
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const cancel = () => (setEditing(false), setDraft(saved), setErr(''));
  const Editor = EDITORS[tab];
  return (
    <main className="@container mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-start gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Perfil de audiencia</h1>
          <p className="text-sm text-muted-foreground">Lo que el agente sabe de tu público. Lo tiene en cuenta en cada mensaje.</p>
        </div>
        <ResetMenu onReset={reset} />
      </div>
      <Tabs value={tab} onValueChange={(v) => (cancel(), setTab(v as Step))} className="gap-6">
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="h-11! gap-4 py-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="h-full flex-none rounded-none px-1 group-data-horizontal/tabs:after:bottom-0! focus-visible:border-transparent focus-visible:text-foreground focus-visible:ring-0 focus-visible:outline-none">
                <t.icon /> {t.title}
                {t.count && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{t.count(saved, verticals)}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={tab} className="flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <p className="flex-1 text-sm text-muted-foreground">{STEPS.find((x) => x.id === tab)!.lead}</p>
            {tab !== 'pillars' && !editing && (
              <Button variant="outline" size="sm" onClick={() => (setDraft(saved), setEditing(true))}>
                <Pencil /> Editar
              </Button>
            )}
          </div>
          {tab === 'pillars' ? (
            <PillarsEditor {...props} />
          ) : editing ? (
            <>
              <Editor {...props} />
              {tab === 'offer' && (
                <div className="flex flex-col gap-3 border-t pt-5">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tu producto</span>
                  <ProductEditor {...props} />
                </div>
              )}
              <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-4 backdrop-blur">
                {err && <span className="mr-auto text-sm text-destructive">{err}</span>}
                <Button variant="ghost" disabled={busy} onClick={cancel}>
                  Cancelar
                </Button>
                <Button disabled={busy} onClick={() => void commit({}, () => setEditing(false))}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Guardar
                </Button>
              </div>
            </>
          ) : (
            <View step={tab} a={saved} verticals={verticals} />
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
