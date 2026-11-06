import {useCallback, useEffect, useState} from 'react';
import {Bot, CalendarClock, Check, ChevronDown, Clapperboard, Loader2, MessageSquare, Pencil, Play, Plus, RefreshCw, Search, Sparkles, Square, Trash2, X, type LucideIcon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {cn} from '@/lib/utils';
import {nextRun} from '../shared/cron';
import {MAX_ACCOUNT_REELS} from '../shared/types';
import {accountApi, automationsApi, chatApi, fmtAgo, inspirationApi, useSocket, type Automation, type AutomationInput, type AutomationRun, type AutomationRunStep, type AutomationStep, type AutomationsView, type InspirationAccount, type OwnReel, type OwnReelList} from './api';
import {useConfirm} from './confirm';
import {Avatar} from './Inspiration';
import {useStudio} from './studio';

// Automatizaciones: the open project's flows on a cron, and what they did. The server runs them (server/automations.ts).
// A flow reads as a timeline: its schedule, then each step with its kind. An agent's step is a conversation in the
// project's history, which opens in the side panel.

const PRESETS = [
  {label: 'Cada hora', cron: '0 * * * *'},
  {label: 'Cada 4 horas', cron: '0 */4 * * *'},
  {label: 'Cada día a las 9', cron: '0 9 * * *'},
  {label: 'Lunes a viernes a las 9', cron: '0 9 * * 1-5'},
  {label: 'Los lunes a las 9', cron: '0 9 * * 1'},
];
const DEFAULT_REELS = 10;
// The kinds of step, in the order the menu offers them.
const STEP_KINDS: Record<AutomationStep['type'], {label: string; icon: LucideIcon; description: string; blank: AutomationStep}> = {
  agent: {label: 'Agente', icon: Bot, description: 'Un agente autónomo hace lo que le pidas, sin preguntarte nada.', blank: {type: 'agent', prompt: ''}},
  account: {label: 'Actualizar Mi cuenta', icon: RefreshCw, description: 'Descarga tus reels más recientes con sus números y tu perfil.', blank: {type: 'account', limit: DEFAULT_REELS}},
  post: {label: 'Actualizar un post', icon: Clapperboard, description: 'Trae los números y la metadata de un reel de Mi cuenta.', blank: {type: 'post', code: '', label: ''}},
  external: {label: 'Actualizar cuenta externa', icon: Sparkles, description: 'Trae los reels más recientes de una cuenta de Inspiración con sus números, y su perfil. No analiza nada.', blank: {type: 'external', username: '', limit: DEFAULT_REELS}},
};
const stepText = (s: AutomationStep) =>
  s.type === 'agent' ? s.prompt : s.type === 'account' ? `Tus ${s.limit} reels más recientes con sus números, y tu perfil.` : s.type === 'external' ? `Los ${s.limit} reels más recientes de @${s.username} con sus números, y su perfil.` : s.label || `Reel ${s.code}`;

type RunState = AutomationRunStep['state'];
const STATE: Record<RunState, {label: string; dot: string; variant: 'secondary' | 'outline' | 'destructive'}> = {
  pending: {label: 'En espera', dot: 'border-dashed text-muted-foreground', variant: 'outline'},
  running: {label: 'En marcha', dot: 'border-foreground text-foreground', variant: 'secondary'},
  done: {label: 'Terminado', dot: 'border-emerald-500 text-emerald-400', variant: 'outline'},
  stopped: {label: 'Detenido', dot: 'border-muted-foreground text-muted-foreground', variant: 'outline'},
  error: {label: 'Con error', dot: 'border-destructive text-destructive', variant: 'destructive'},
  interrupted: {label: 'Interrumpido', dot: 'border-destructive text-destructive', variant: 'destructive'},
};
const fmtWhen = (d: Date) => d.toLocaleString('es', {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

// A post's cover. A step only knows its code, so a post without one (or no longer in Mi cuenta) finds out by failing.
function PostThumb({code}: {code: string}) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="h-14 w-8 flex-none rounded-sm bg-muted" />;
  return <img src={accountApi.thumb(code)} alt="" loading="lazy" onError={() => setMissing(true)} className="h-14 w-8 flex-none rounded-sm object-cover" />;
}

// One point of a flow: its icon on the line that joins it to the next.
function Point({icon: I, state, last, children}: {icon: LucideIcon; state?: RunState; last?: boolean; children: React.ReactNode}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={cn('flex size-7 flex-none items-center justify-center rounded-full border bg-background text-muted-foreground', state && STATE[state].dot)}>{state === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <I className="size-3.5" />}</span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1 pt-0.5', !last && 'pb-4')}>{children}</div>
    </li>
  );
}

// A step's number, its kind and, in a run, how it went.
function StepHead({n, type, state}: {n: number; type: AutomationStep['type']; state?: RunState}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground tabular-nums">Paso {n}</span>
      <Badge variant="secondary">{STEP_KINDS[type].label}</Badge>
      {state && state !== 'pending' && <span className="text-xs text-muted-foreground">{STATE[state].label}</span>}
    </div>
  );
}

export function Automations() {
  const {uiRef} = useStudio();
  uiRef.current = {page: 'automations'};
  const confirm = useConfirm();
  const [view, setView] = useState<AutomationsView | null>(null);
  const [err, setErr] = useState('');
  // null: closed; 'new', or the one being edited.
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);
  const load = useCallback(() => automationsApi.view().then(setView, (e: Error) => setErr(e.message)), []);
  useEffect(() => void load(), [load]);
  useSocket((m) => m.type === 'automations' && void load(), () => void load());
  // The next time to fire stays fresh.
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const act = (p: Promise<AutomationsView>) => {
    setErr('');
    return p.then(setView, (e: Error) => setErr(e.message));
  };
  const remove = async (a: Automation) => {
    if (await confirm({title: `¿Borrar «${a.name}»?`, description: 'Deja de ejecutarse. Las conversaciones de sus agentes siguen en el historial del chat.', action: 'Borrar', destructive: true})) void act(automationsApi.remove(a.id));
  };
  // A step that spends from his scraper's balance says what it costs first, like Mi cuenta's own button.
  const run = async (a: Automation) => {
    setErr('');
    try {
      for (const s of a.steps) {
        if (s.type === 'agent') continue;
        const {charge} = await (s.type === 'account' ? accountApi.estimate(s.limit) : s.type === 'external' ? inspirationApi.estimate(s.username, s.limit, 'account') : accountApi.refreshCost());
        if (!(await confirm({title: `¿Ejecutar «${a.name}»?`, description: `${STEP_KINDS[s.type].label}: ${stepText(s)} ${charge}.`, action: 'Ejecutar'}))) return;
      }
    } catch (e) {
      return setErr((e as Error).message);
    }
    void act(automationsApi.run(a.id));
  };
  const runOf = (id: string) => view?.runs.find((r) => r.automation === id && r.state === 'running');

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Automatizaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">Flujos con horario, de este proyecto. Cada paso empieza cuando termina el anterior, y si uno falla el flujo se para. Solo se ejecutan con Reel Studio abierto y el Mac encendido y despierto: una hora perdida no se recupera.</p>
        </div>
        <Button onClick={() => setEditing('new')} className="flex-none">
          <Plus /> Nueva
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!view && !err && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {view && !view.automations.length && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <CalendarClock className="size-6" />
          Todavía no hay automatizaciones en este proyecto.
        </div>
      )}
      {view?.automations.map((a) => {
        const next = a.enabled ? nextRun(a.cron) : null;
        const current = runOf(a.id);
        // While it runs, the steps it started with and how each one goes.
        const steps: (AutomationStep & {state?: RunState; summary?: string})[] = current?.steps ?? a.steps;
        return (
          <section key={a.id} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <Switch checked={a.enabled} aria-label={`Activar ${a.name}`} onCheckedChange={(enabled) => void act(automationsApi.edit(a.id, {name: a.name, cron: a.cron, steps: a.steps, enabled}))} />
              <h2 className="min-w-0 flex-1 truncate font-medium">{a.name}</h2>
              {current ? (
                <Button variant="outline" size="sm" disabled={current.stopping} onClick={() => void act(automationsApi.stop(current.id))}>
                  <Square /> {current.stopping ? 'Terminando la descarga…' : 'Detener'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void run(a)}>
                  <Play /> Ejecutar ahora
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" title="Editar" aria-label={`Editar ${a.name}`} onClick={() => setEditing(a)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" title="Borrar" aria-label={`Borrar ${a.name}`} onClick={() => void remove(a)}>
                <Trash2 />
              </Button>
            </div>
            <ol>
              <Point icon={CalendarClock}>
                <p className="text-sm">
                  <code className="text-xs">{a.cron}</code>
                  <span className="text-muted-foreground"> · {a.enabled ? (next ? `próxima: ${fmtWhen(next)}` : 'nunca ocurre') : 'desactivada'}</span>
                </p>
              </Point>
              {steps.map((s, i) => (
                <Point key={i} icon={STEP_KINDS[s.type].icon} state={s.state} last={i === steps.length - 1}>
                  <StepHead n={i + 1} type={s.type} state={s.state} />
                  <div className="mt-1 flex items-center gap-3">
                    {s.type === 'post' && <PostThumb code={s.code} />}
                    {s.type === 'external' && <Avatar account={{username: s.username, avatar: true, profile: null}} />}
                    <p className="line-clamp-3 min-w-0 flex-1 text-sm whitespace-pre-line">{stepText(s)}</p>
                  </div>
                </Point>
              ))}
            </ol>
          </section>
        );
      })}
      {!!view?.runs.length && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Historial</h2>
          {view.runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </section>
      )}
      {editing && <AutomationForm automation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={setView} />}
    </main>
  );
}

function RunRow({run: r}: {run: AutomationRun}) {
  const {setOpen} = useStudio();
  const [open, setRowOpen] = useState(r.state === 'running');
  const state = STATE[r.state];
  // In the side panel, where its conversation stays as a tab.
  const show = (chat: string) => chatApi.open('_general', chat).then(() => setOpen(true), () => {});
  return (
    <div className="rounded-md border text-sm">
      <button onClick={() => setRowOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted/50">
        <Badge variant={state.variant}>
          {r.state === 'running' && <Loader2 className="animate-spin" />}
          {state.label}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
        {/* The flow at a glance; the same in words when it's open. */}
        <span aria-hidden className="flex items-center">
          {r.steps.map((s, i) => {
            const I = STEP_KINDS[s.type].icon;
            return (
              <span key={i} className="flex items-center">
                {i > 0 && <span className="h-px w-2 bg-border" />}
                <span title={`Paso ${i + 1}: ${STEP_KINDS[s.type].label} · ${STATE[s.state].label}`} className={cn('flex size-5 items-center justify-center rounded-full border', STATE[s.state].dot)}>
                  {s.state === 'running' ? <Loader2 className="size-3 animate-spin" /> : <I className="size-3" />}
                </span>
              </span>
            );
          })}
        </span>
        <span className="text-xs text-muted-foreground">
          {r.trigger === 'manual' ? 'A mano · ' : ''}
          {fmtAgo(r.started)}
        </span>
        <ChevronDown className={cn('size-4 flex-none text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {r.error && <p className="px-3 pb-2 text-xs text-destructive">{r.error}</p>}
      {open && (
        <ol className="border-t px-3 py-3">
          {r.steps.map((s, i) => (
            <Point key={i} icon={STEP_KINDS[s.type].icon} state={s.state} last={i === r.steps.length - 1}>
              <StepHead n={i + 1} type={s.type} state={s.state} />
              <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{stepText(s)}</p>
              {s.summary && <p className="mt-1 line-clamp-4 text-sm whitespace-pre-line">{s.summary}</p>}
              {s.chat && (
                <Button variant="outline" size="xs" className="mt-1.5" onClick={() => void show(s.chat!)}>
                  <MessageSquare /> Ver conversación
                </Button>
              )}
            </Point>
          ))}
        </ol>
      )}
    </div>
  );
}

function AccountStepFields({n, limit, onChange}: {n: number; limit: number; onChange: (limit: number) => void}) {
  const valid = Number.isInteger(limit) && limit >= 1 && limit <= MAX_ACCOUNT_REELS;
  const id = `automation-step-${n}-reels`;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>Reels a actualizar</Label>
        <Input id={id} type="number" min={1} max={MAX_ACCOUNT_REELS} value={Number.isNaN(limit) ? '' : limit} onChange={(e) => onChange(e.target.valueAsNumber)} className="w-24" />
      </div>
      {!valid && <p className="text-xs text-destructive">De 1 a {MAX_ACCOUNT_REELS} reels.</p>}
    </div>
  );
}

const PICKER_PAGE = 12;
const fmtCount = (n: number | null) => (n === null ? '—' : n.toLocaleString('es'));

// Its own dialog: the reels loaded in Mi cuenta, newest first, to choose one. Choosing closes it.
function PostPicker({current, onPick, onClose}: {current: string; onPick: (code: string) => void; onClose: () => void}) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [list, setList] = useState<OwnReelList | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [typed]);
  useEffect(() => {
    let live = true;
    accountApi.list({q, page, size: PICKER_PAGE, sort: 'posted', desc: true}).then(
      (l) => live && setList(l),
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [q, page]);
  const last = list ? Math.max(0, Math.ceil(list.total / PICKER_PAGE) - 1) : 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-2xl">
        <DialogTitle>Elegir post</DialogTitle>
        <DialogDescription>Los reels cargados en Mi cuenta. Si falta alguno, descárgalo allí primero.</DialogDescription>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Buscar en sus textos" aria-label="Buscar post" className="pl-8" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!list && !err && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {list && !list.rows.length && <p className="p-6 text-center text-sm text-muted-foreground">{q ? 'Ningún post con esa búsqueda.' : 'Mi cuenta aún no tiene reels cargados: descárgalos allí primero.'}</p>}
          <ul className="flex flex-col gap-1">
            {list?.rows.map((r) => (
              <li key={r.code}>
                <PostRow reel={r} selected={r.code === current} onClick={() => onPick(r.code)} />
              </li>
            ))}
          </ul>
        </div>
        {list && list.total > PICKER_PAGE && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {page * PICKER_PAGE + 1}–{page * PICKER_PAGE + list.rows.length} de {list.total}
            </span>
            <span className="flex gap-1.5">
              <Button type="button" variant="outline" size="xs" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <Button type="button" variant="outline" size="xs" disabled={page >= last} onClick={() => setPage(page + 1)}>
                Siguiente
              </Button>
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PostRow({reel: r, selected, onClick}: {reel: OwnReel; selected: boolean; onClick: () => void}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cn('flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted', selected && 'bg-muted')}>
      {r.thumb ? <img src={accountApi.thumb(r.code)} alt="" loading="lazy" className="h-14 w-8 flex-none rounded-sm object-cover" /> : <span className="h-14 w-8 flex-none rounded-sm bg-muted" />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm">{r.caption.trim() || 'Sin texto'}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
          {r.posted ? `${new Date(r.posted).toLocaleDateString('es', {day: 'numeric', month: 'short', year: 'numeric'})} · ` : ''}
          {fmtCount(r.views)} vistas · {fmtCount(r.likes)} me gusta · {fmtCount(r.comments)} comentarios
        </span>
      </span>
      {selected && <Check className="size-4 flex-none" />}
    </button>
  );
}

// The post a step points to, as Mi cuenta has it now.
function PostStepFields({code, onChange}: {code: string; onChange: (code: string) => void}) {
  const [picking, setPicking] = useState(false);
  const [found, setFound] = useState<{reel?: OwnReel; error?: string}>({});
  useEffect(() => {
    if (!code) return setFound({});
    let live = true;
    accountApi.reel(code).then(
      ({reel}) => live && setFound({reel}),
      () => live && setFound({error: 'Ese post ya no está en Mi cuenta: elige otro.'}),
    );
    return () => {
      live = false;
    };
  }, [code]);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {found.reel && (
        <div className="flex items-center gap-3 rounded-md border p-2">
          {found.reel.thumb ? <img src={accountApi.thumb(found.reel.code)} alt="" className="h-14 w-8 flex-none rounded-sm object-cover" /> : <span className="h-14 w-8 flex-none rounded-sm bg-muted" />}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm">{found.reel.caption.trim() || 'Sin texto'}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{fmtCount(found.reel.views)} vistas ahora</span>
          </span>
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setPicking(true)}>
        <Clapperboard /> {code ? 'Cambiar post' : 'Elegir post'}
      </Button>
      {found.error && <p className="text-xs text-destructive">{found.error}</p>}
      {picking && (
        <PostPicker
          current={code}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            onChange(picked);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function ExternalRow({account: x}: {account: InspirationAccount}) {
  return (
    <>
      <Avatar account={x} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">@{x.username}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {x.fullName ? `${x.fullName} · ` : ''}
          {x.reels} reels cargados
          {x.profile?.followers != null ? ` · ${fmtCount(x.profile.followers)} seguidores` : ''}
        </span>
      </span>
    </>
  );
}

// The Inspiración account a step points to, chosen in its own dialog like a post. The accounts come from the page's own
// list, so one that isn't there yet is scanned in Inspiración first.
function ExternalStepFields({n, step, onChange}: {n: number; step: Extract<AutomationStep, {type: 'external'}>; onChange: (step: AutomationStep) => void}) {
  const [picking, setPicking] = useState(false);
  const [accounts, setAccounts] = useState<InspirationAccount[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    inspirationApi.status().then((s) => setAccounts(s.accounts.filter((x) => x.followed)), (e: Error) => setErr(e.message));
  }, []);
  const chosen = accounts?.find((x) => x.username === step.username);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {chosen && (
        <div className="flex items-center gap-3 rounded-md border p-2">
          <ExternalRow account={chosen} />
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setPicking(true)}>
        <Sparkles /> {step.username ? 'Cambiar cuenta' : 'Elegir cuenta'}
      </Button>
      {accounts && step.username && !chosen && <p className="text-xs text-destructive">@{step.username} ya no está en Inspiración: elige otra.</p>}
      <AccountStepFields n={n} limit={step.limit} onChange={(limit) => onChange({...step, limit})} />
      {picking && (
        <Dialog open onOpenChange={(o) => !o && setPicking(false)}>
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
            <DialogTitle>Elegir cuenta</DialogTitle>
            <DialogDescription>Las cuentas escaneadas en Inspiración. Si falta alguna, escanéala allí primero.</DialogDescription>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {err && <p className="text-sm text-destructive">{err}</p>}
              {!accounts && !err && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
              {accounts && !accounts.length && <p className="p-6 text-center text-sm text-muted-foreground">Inspiración aún no tiene cuentas: escanea alguna allí primero.</p>}
              <ul className="flex flex-col gap-1">
                {accounts?.map((x) => (
                  <li key={x.username}>
                    <button
                      type="button"
                      aria-pressed={x.username === step.username}
                      className={cn('flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted', x.username === step.username && 'bg-muted')}
                      onClick={() => {
                        onChange({...step, username: x.username});
                        setPicking(false);
                      }}
                    >
                      <ExternalRow account={x} />
                      {x.username === step.username && <Check className="size-4 flex-none" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AutomationForm({automation: a, onClose, onSaved}: {automation: Automation | null; onClose: () => void; onSaved: (v: AutomationsView) => void}) {
  const [name, setName] = useState(a?.name ?? '');
  const [cron, setCron] = useState(a?.cron ?? '0 9 * * *');
  const [steps, setSteps] = useState<AutomationStep[]>(a?.steps ?? [STEP_KINDS.agent.blank]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const next = nextRun(cron);
  const stepReady = (s: AutomationStep) => (s.type === 'agent' ? !!s.prompt.trim() : s.type === 'post' ? !!s.code : (s.type === 'account' || !!s.username) && Number.isInteger(s.limit) && s.limit >= 1 && s.limit <= MAX_ACCOUNT_REELS);
  // What's missing, said next to Guardar so a greyed-out button isn't a riddle.
  const missing = !name.trim() ? 'Ponle un nombre' : !next ? 'Revisa el horario' : !steps.length ? 'Añade un paso' : !steps.every(stepReady) ? `Completa el paso ${steps.findIndex((s) => !stepReady(s)) + 1}` : '';
  const ready = !missing;
  const setStep = (i: number, step: AutomationStep) => setSteps((all) => all.map((s, j) => (j === i ? step : s)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr('');
    const input: AutomationInput = {name, cron, enabled: a?.enabled ?? true, steps};
    try {
      onSaved(await (a ? automationsApi.edit(a.id, input) : automationsApi.add(input)));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>{a ? 'Editar automatización' : 'Nueva automatización'}</DialogTitle>
        <DialogDescription>Nadie estará delante: los agentes no podrán preguntarte nada, así que diles todo lo que necesiten saber.</DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="automation-name">Nombre</Label>
            <Input id="automation-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ideas de los lunes" />
          </div>
          <ol>
            <Point icon={CalendarClock}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="automation-cron">Horario (cron)</Label>
                <Input id="automation-cron" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" aria-describedby="automation-cron-next" />
                <p id="automation-cron-next" className={next ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                  {next ? `Próxima: ${fmtWhen(next)}` : 'Expresión no válida o que nunca ocurre. Son cinco campos: minuto, hora, día, mes y día de la semana.'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <Button key={p.cron} type="button" variant="outline" size="xs" onClick={() => setCron(p.cron)}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
            </Point>
            {steps.map((s, i) => (
              <Point key={i} icon={STEP_KINDS[s.type].icon}>
                <div className="flex items-center justify-between gap-2">
                  <StepHead n={i + 1} type={s.type} />
                  <Button type="button" variant="ghost" size="icon-sm" title="Quitar paso" aria-label={`Quitar el paso ${i + 1}`} onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
                {s.type === 'agent' ? (
                  <Textarea className="mt-2" value={s.prompt} rows={3} aria-label={`Prompt del paso ${i + 1}`} onChange={(e) => setStep(i, {type: 'agent', prompt: e.target.value})} placeholder={i ? 'Toma 2 ideas de cada vertical y conviértelas en videos, una a una' : 'Crea 1 idea en cada vertical'} />
                ) : s.type === 'post' ? (
                  <PostStepFields code={s.code} onChange={(code) => setStep(i, {type: 'post', code, label: ''})} />
                ) : s.type === 'external' ? (
                  <ExternalStepFields n={i + 1} step={s} onChange={(step) => setStep(i, step)} />
                ) : (
                  <AccountStepFields n={i + 1} limit={s.limit} onChange={(limit) => setStep(i, {type: 'account', limit})} />
                )}
              </Point>
            ))}
            <Point icon={Plus} last>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    Añadir paso <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                  {Object.values(STEP_KINDS).map((k) => (
                    <DropdownMenuItem key={k.label} className="items-start" onSelect={() => setSteps((all) => [...all, k.blank])}>
                      <k.icon className="mt-0.5" />
                      <span className="flex flex-col">
                        <span className="font-medium">{k.label}</span>
                        <span className="text-xs text-muted-foreground">{k.description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Point>
          </ol>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex items-center justify-end gap-2">
            {missing && <span className="mr-auto text-xs text-muted-foreground">{missing} para guardar.</span>}
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
