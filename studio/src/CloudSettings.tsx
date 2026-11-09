// His Reel Studio account (the site that holds his Meta app and Instagram connections; the studio only keeps its
// session, server/cloud.ts): the header's indicator, Ajustes → Cuenta, and Ajustes → Instagram, which of its
// accounts this project uses for Instagram's own numbers in Mi cuenta and, later, publishing.
import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, AtSign, BarChart3, CheckCircle2, ExternalLink, FolderSync, KeyRound, Loader2, LogOut, Mail, RefreshCw, Send, type LucideIcon} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Skeleton} from '@/components/ui/skeleton';
import {cloudApi, useSocket, type CloudSession, type CloudStatus} from './api';
import {useConfirm} from './confirm';
import {SyncCard} from './SyncCard';
import type {CloudProjectState, CloudProjectView, CloudProjects, LocalCloudProject} from '../shared/types';

const NONE = '__none';
const date = (iso: string) => new Date(iso).toLocaleDateString('es', {day: 'numeric', month: 'short', year: 'numeric'});

// The header's indicator: who's signed in and whether the cloud answers. /api/cloud/session never waits on the
// network, so it can't slow any page down.
export function CloudIndicator() {
  const [s, setS] = useState<CloudSession | null>(null);
  const load = useCallback(() => void cloudApi.session().then(setS, () => {}), []);
  useEffect(load, [load]);
  useSocket((msg) => msg.type === 'cloud' && load(), load);
  if (!s) return null;
  const state = !s.signedIn
    ? {label: 'Iniciar sesión', title: 'Trabajando en local. Inicia sesión para usar la nube', dot: null}
    : s.online === false
      ? {label: s.email, title: 'Sin conexión: sigues trabajando en local', dot: 'bg-amber-500'}
      : s.online
        ? {label: s.email, title: 'Conectado a tu cuenta', dot: 'bg-emerald-500'}
        : {label: s.email, title: 'Comprobando la conexión…', dot: 'bg-muted-foreground'};
  return (
    <Button asChild variant="ghost" size="sm" className="min-w-0 font-normal">
      <a href="#/ajustes/cuenta" title={state.title}>
        {state.dot && <span aria-hidden className={`size-2 shrink-0 rounded-full ${state.dot}`} />}
        <span className="max-w-28 truncate sm:max-w-52">{state.label}</span>
      </a>
    </Button>
  );
}

// The last answer, so coming back to a section shows it at once while it refreshes. A page reload (changing
// project does one) starts empty, so it can't show another project's account.
let lastStatus: CloudStatus | null = null;

// /api/cloud, reloaded whenever the session changes elsewhere (the panel closed it, or the other section did).
function useCloudStatus() {
  const [s, setState] = useState<CloudStatus | null>(lastStatus);
  const [err, setErr] = useState('');
  const setS = useCallback((v: CloudStatus) => {
    lastStatus = v;
    setState(v);
  }, []);
  const load = useCallback(() => void cloudApi.status().then(setS, (e: Error) => setErr(e.message)), [setS]);
  useEffect(load, [load]);
  useSocket((msg) => msg.type === 'cloud' && load());
  return {s, setS, err, load};
}

// Each skeleton has the shape of the card that replaces it, so nothing jumps when it arrives.
const ACCOUNT_TITLE = 'Cuenta de Reel Studio';
const ACCOUNT_TEXT = 'Tu app de Meta y tus cuentas de Instagram se conectan en tu panel web. Este equipo guarda la sesión, nunca las claves de Meta.';

function AccountSkeleton({err}: {err: string}) {
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  return (
    <Card>
      <CardHeader>
        {/* The real texts, hidden: they wrap like the card that replaces this one. */}
        <CardTitle>
          <Skeleton className="w-fit max-w-full text-transparent">{ACCOUNT_TITLE}</Skeleton>
        </CardTitle>
        <CardDescription>
          <Skeleton className="w-fit max-w-full text-transparent">{ACCOUNT_TEXT}</Skeleton>
        </CardDescription>
        <CardAction>
          <Skeleton className="h-7 w-28" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-56" />
        <div className="mt-2">
          <NameFieldSkeleton />
        </div>
      </CardContent>
    </Card>
  );
}

function NameFieldSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-3.5 w-14" />
      <div className="flex max-w-md gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

// A short note in a corner, out of the page's flow so nothing moves when it comes and goes.
function SavedToast({text}: {text: string}) {
  if (!text) return null;
  return (
    <div role="status" className="animate-fade-in fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg">
      <CheckCircle2 className="size-4 text-emerald-500" /> {text}
    </div>
  );
}

// What he's called in the app; the login only ever asks for an email.
function NameField({saved, disabled}: {saved: string; disabled: boolean}) {
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setName(saved), [saved]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const dirty = name.trim() !== saved;
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await cloudApi.setName(name);
      setToast('Nombre guardado');
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(''), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      <Label htmlFor="cloud-name">Nombre</Label>
      <div className="flex max-w-md gap-2">
        <Input id="cloud-name" autoComplete="name" maxLength={120} value={name} disabled={busy || disabled} onChange={(e) => setName(e.target.value)} placeholder="Cómo te llamas" className="flex-1" />
        <Button type="submit" variant="outline" disabled={!dirty || busy || disabled} className="w-20">
          {busy ? <Loader2 className="animate-spin" /> : 'Guardar'}
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <SavedToast text={toast} />
    </form>
  );
}

function InstagramSkeleton({err}: {err: string}) {
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-[22px] w-48" />
        <div className="flex h-[60px] flex-col justify-between py-0.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-[62px] w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-32" />
        </div>
        <Skeleton className="h-5 w-44" />
      </CardContent>
    </Card>
  );
}

export function AccountSection() {
  const {s, setS, err, load} = useCloudStatus();
  if (!s)
    return (
      <>
        <AccountSkeleton err={err} />
        {!err && <SyncCard loading />}
      </>
    );
  return (
    <>
      <AccountCard s={s} onChange={setS} reload={load} />
      {s.signedIn && <SyncCard />}
    </>
  );
}

export function InstagramSection() {
  const {s, setS, err, load} = useCloudStatus();
  if (!s) return <InstagramSkeleton err={err} />;
  if (s.signedIn && !s.error) return <ProjectAccountCard s={s} onChange={setS} reload={load} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram de este proyecto</CardTitle>
        <CardDescription>
          {s.signedIn ? s.error : 'Para conectar Instagram necesitas tu cuenta de Reel Studio. El resto de la app sigue funcionando sin ella.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {s.signedIn ? (
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw /> Reintentar
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href="#/ajustes/cuenta">Iniciar sesión</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AccountCard({s, onChange, reload}: {s: CloudStatus; onChange: (s: CloudStatus) => void; reload: () => void}) {
  const [email, setEmail] = useState(s.email ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const confirm = useConfirm();
  const [signingIn, setSigningIn] = useState(false); // the big button first; then the email
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (await confirm({title: '¿Cerrar sesión?', description: 'Este equipo se desconecta de tu cuenta. Tus proyectos locales no se borran.', action: 'Cerrar sesión', destructive: true})) await act(async () => onChange(await cloudApi.logout()));
  };

  return (
    <Card>
      {s.signedIn && (
        <CardHeader>
          <CardTitle>{ACCOUNT_TITLE}</CardTitle>
          <CardDescription>{ACCOUNT_TEXT}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void signOut()}>
              <LogOut /> Cerrar sesión
            </Button>
          </CardAction>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-3">
        {s.signedIn ? (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4 text-muted-foreground" /> {s.user?.email ?? s.email}
            </span>
            {s.error && (
              <span className="flex items-center gap-2 text-sm text-destructive">
                {s.error}
                <Button variant="ghost" size="sm" onClick={reload}>
                  <RefreshCw /> Reintentar
                </Button>
              </span>
            )}
            <div className="mt-2">
              <NameField saved={s.user?.name ?? ''} disabled={!s.user} />
            </div>
          </div>
        ) : (
          <>
          <AccountBenefits />
          {!signingIn ? (
            <Button size="lg" className="h-12 w-full text-base" onClick={() => setSigningIn(true)}>
              Iniciar sesión
            </Button>
          ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!sent) void act(async () => (await cloudApi.sendCode(email), setSent(true)));
              else
                void act(async () => {
                  onChange(await cloudApi.verify(email, code));
                  setSent(false); // so logging out comes back to the email step, not to a spent code
                  setSigningIn(false);
                  setCode('');
                });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cloud-email">Correo</Label>
              <Input id="cloud-email" type="email" autoComplete="email" autoFocus value={email} disabled={busy || sent} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
            </div>
            {sent && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cloud-code">Código de 6 dígitos</Label>
                <Input
                  id="cloud-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-40 font-mono tracking-[0.4em]"
                />
                <span className="text-xs text-muted-foreground">
                  Te lo enviamos a {email}.{' '}
                  <button type="button" className="underline hover:text-foreground" onClick={() => (setSent(false), setCode(''))}>
                    Cambiar correo
                  </button>
                </span>
              </div>
            )}
            <Button type="submit" className="self-start" disabled={busy || (sent ? code.length !== 6 : !email.includes('@'))}>
              {busy && <Loader2 className="animate-spin" />} {sent ? 'Entrar' : 'Enviarme un código'}
            </Button>
            <span className="text-xs text-muted-foreground">Sin contraseña: te enviamos un código a tu correo.</span>
          </form>
          )}
          </>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

// What signing in adds; the app works the same without it. soon: not in the app yet.
const BENEFITS: {icon: LucideIcon; title: string; text: string; soon?: boolean}[] = [
  {icon: BarChart3, title: 'Tus métricas reales', text: 'Guardados, compartidos, alcance y retención de tus reels, directo de Instagram, en Mi cuenta.'},
  {icon: Send, title: 'Publica sin salir de la app', text: 'Sube tus reels a Instagram desde Reel Studio, cada proyecto con su cuenta.', soon: true},
  {icon: FolderSync, title: 'Tus proyectos en cualquier equipo', text: 'Ideas, guiones e inspiración sincronizados entre tus computadores.'},
  {icon: KeyRound, title: 'Tus claves siempre contigo', text: 'Guárdalas cifradas en tu cuenta y tráelas a un equipo nuevo con solo iniciar sesión.'},
];

function AccountBenefits() {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-gradient-to-br from-primary/10 via-muted/30 to-transparent p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">Lleva Reel Studio más lejos</h3>
        <p className="text-sm text-muted-foreground">Esto se suma a lo que ya haces en tu computador:</p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
        {BENEFITS.map(({icon: Icon, title, text, soon}) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {title} {soon && <Badge variant="outline">Próximamente</Badge>}
              </span>
              <span className="text-sm text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Instagram's picture links expire: falls back to the icon.
function AccountAvatar({url}: {url: string | null}) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <AtSign className="size-9 shrink-0 rounded-full bg-muted p-2 text-muted-foreground" />;
  return <img src={url} alt="" className="size-9 shrink-0 rounded-full object-cover" onError={() => setBroken(true)} />;
}

function ProjectAccountCard({s, onChange, reload}: {s: CloudStatus; onChange: (s: CloudStatus) => void; reload: () => void}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (v: string) => {
    setBusy(true);
    setErr('');
    try {
      onChange(await cloudApi.setAccount(v === NONE ? null : Number(v)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const a = s.account;
  const panel = (label: string) => (
    <Button asChild variant="outline" size="sm">
      <a href={s.panelUrl} target="_blank" rel="noreferrer">
        {label} <ExternalLink />
      </a>
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram de este proyecto</CardTitle>
        <CardDescription>Con ella, Mi cuenta trae los números que solo ve el dueño: guardados, compartidos, alcance y retención.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" aria-label="Actualizar" onClick={reload}>
            <RefreshCw />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!s.metaApp || !s.accounts.length ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
            <span className="font-medium">{!s.metaApp ? 'Primero configura tu app de Meta' : 'Aún no conectas ninguna cuenta de Instagram'}</span>
            <span className="text-muted-foreground">
              {!s.metaApp
                ? 'En tu panel: crea tu app de Meta (los pasos están ahí), guarda su ID y su clave, y conecta tu cuenta de Instagram.'
                : 'En tu panel, conecta la cuenta profesional (creador o empresa) de este proyecto.'}{' '}
              Luego vuelve aquí y actualiza.
            </span>
            {panel('Abrir mi panel')}
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label="Cuenta de Instagram de este proyecto" className="flex flex-col gap-2">
              {s.accounts.map((x) => {
                const on = a?.id === x.id;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => !on && void pick(String(x.id))}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-70 ${on ? 'border-foreground/40 bg-muted/50' : 'hover:bg-muted/40'}`}
                  >
                    <AccountAvatar url={x.pictureUrl} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">@{x.username}</span>
                      {x.name && <span className="truncate text-xs text-muted-foreground">{x.name}</span>}
                    </span>
                    {on && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {panel('Configurar')}
              {a && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void pick(NONE)}>
                  No usar ninguna
                </Button>
              )}
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            {s.disconnected && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="size-3.5" /> @{s.disconnected} se desconectó: vuelve a conectarla en tu panel.
              </span>
            )}
            {a ? (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>
                  {!a.tokenExpiresAt ? 'Acceso sin vencimiento.' : `Acceso válido hasta el ${date(a.tokenExpiresAt)}, ${a.renews === false ? 'vuelve a conectarla antes en tu panel' : 'se renueva solo'}.`}{' '}
                  {a.insights && <Badge variant="outline">Métricas</Badge>}
                </span>
                {!a.insights && (
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="size-3.5" /> Le falta el permiso de métricas: vuelve a conectarla en tu panel.
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Sin cuenta, Mi cuenta sigue solo con lo que trae el scraper.</span>
            )}
          </>
        )}
        {s.projectGone && (
          <span className="text-xs text-amber-400">
            Este proyecto se eliminó de tu cuenta. Decide qué hacer en <a href="#/ajustes/proyecto" className="underline">Ajustes → Proyecto</a>.
          </span>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

/* ───── This computer's projects in the account ───── */

const STATE_LABEL: Record<CloudProjectState, string> = {
  none: 'Sin registrar',
  pending: 'Pendiente de registrar',
  linked: 'En tu cuenta',
  'other-account': 'Registrado en otra cuenta',
  'local-only': 'Solo en este equipo',
  deleted: 'Se eliminó de tu cuenta',
};

// Reloaded whenever the session or a link changes (logging in registers the projects in the background).
function useCloudProjects() {
  const [data, setData] = useState<CloudProjects | null>(null);
  const load = useCallback(() => void cloudApi.projects().then(setData, () => {}), []);
  useEffect(load, [load]);
  useSocket((msg) => msg.type === 'cloud' && load(), load);
  return {data, setData, load};
}

// A project without a link that looks like one in the account: they're never merged without asking.
function ProjectMatchDialog({local, matches, onResult, onLater}: {local: LocalCloudProject; matches: CloudProjectView[]; onResult: (d: CloudProjects) => void; onLater: () => void}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<CloudProjects>) => {
    setBusy(true);
    setErr('');
    try {
      onResult(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const one = matches.length === 1 ? matches[0] : null;
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onLater()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{one ? `Ya tienes “${one.name}” en tu cuenta. ¿Es el mismo proyecto?` : 'Ya tienes proyectos parecidos en tu cuenta. ¿Alguno es este?'}</AlertDialogTitle>
          <AlertDialogDescription>
            En este equipo se llama «{local.name}» (carpeta {local.id}). Solo se comparten su nombre y su cuenta de Instagram; ningún archivo sale de este equipo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {matches.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Carpeta {c.slug}
                  {c.instagram ? ` · @${c.instagram.username}` : ''}
                </span>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void act(() => cloudApi.link(local.id, c.id))}>
                Vincular
              </Button>
            </div>
          ))}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onLater}>
            Ahora no
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => cloudApi.setLocalOnly(local.id, true))}>
            Mantener solo en este equipo
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => cloudApi.register(local.id, true))}>
            Crear aparte
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const matchesOf = (d: CloudProjects, id: string) => d.matches.filter((m) => m.local === id).map((m) => m.cloud);

// "Ahora no" lasts until the app reloads: he can still answer from Ajustes → Proyecto.
const later = new Set<string>();

// Wherever he is when logging in finds a project that looks like one in the account.
export function CloudProjectsPrompt() {
  const {data, setData} = useCloudProjects();
  const [, rerender] = useState(0);
  const local = data?.local.find((p) => !later.has(p.id) && matchesOf(data, p.id).length > 0);
  if (!data || !local) return null;
  return (
    <ProjectMatchDialog
      key={local.id}
      local={local}
      matches={matchesOf(data, local.id)}
      onResult={setData}
      onLater={() => {
        later.add(local.id);
        rerender((n) => n + 1);
      }}
    />
  );
}

// Ajustes → Proyecto. Signed out there's nothing to show: everything keeps working locally.
export function ProjectsCloudCard() {
  const {data, setData, load} = useCloudProjects();
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  if (!data?.signedIn) return null;

  const act = async (id: string, fn: () => Promise<CloudProjects>) => {
    setBusy(id);
    setErr('');
    try {
      setData(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const asked = asking ? data.local.find((p) => p.id === asking) : null;
  const button = (p: LocalCloudProject, label: string, fn: () => Promise<CloudProjects>, variant: 'outline' | 'ghost' = 'outline') => (
    <Button variant={variant} size="sm" disabled={!!busy} onClick={() => void act(p.id, fn)}>
      {busy === p.id && <Loader2 className="animate-spin" />} {label}
    </Button>
  );
  const elsewhere = async (p: LocalCloudProject) => {
    const yes = await confirm({title: `¿Registrar «${p.name}» en esta cuenta?`, description: 'Quedará como un proyecto nuevo en la cuenta con la que iniciaste sesión. La otra cuenta no se toca.', action: 'Registrar'});
    if (yes) void act(p.id, () => cloudApi.register(p.id, true));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proyectos en tu cuenta</CardTitle>
        <CardDescription>Registrar un proyecto solo guarda su nombre y su cuenta de Instagram. Ningún archivo sale de este equipo.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {data.local.map((p) => {
          const similar = p.state === 'none' ? matchesOf(data, p.id) : [];
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <Badge variant="outline">{STATE_LABEL[p.state]}</Badge>
              {similar.length > 0 && (
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setAsking(p.id)}>
                  ¿Es el mismo proyecto?
                </Button>
              )}
              {(p.state === 'pending' || (p.state === 'none' && !similar.length) || p.state === 'local-only') && button(p, 'Registrar en mi cuenta', () => cloudApi.register(p.id))}
              {(p.state === 'none' || p.state === 'pending') && !similar.length && button(p, 'Mantener solo en este equipo', () => cloudApi.setLocalOnly(p.id, true), 'ghost')}
              {p.state === 'other-account' && (
                <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void elsewhere(p)}>
                  Registrar en esta cuenta
                </Button>
              )}
              {p.state === 'deleted' && (
                <>
                  {button(p, 'Volver a registrar', () => cloudApi.register(p.id, true))}
                  {button(p, 'Dejar solo local', () => cloudApi.setLocalOnly(p.id, true), 'ghost')}
                </>
              )}
            </div>
          );
        })}
        {data.error && (
          <span className="flex items-center gap-2 text-sm text-destructive">
            {data.error}
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshCw /> Reintentar
            </Button>
          </span>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
      {asked && (
        <ProjectMatchDialog
          local={asked}
          matches={matchesOf(data, asked.id)}
          onResult={(d) => {
            setData(d);
            setAsking(null);
          }}
          onLater={() => setAsking(null)}
        />
      )}
    </Card>
  );
}
