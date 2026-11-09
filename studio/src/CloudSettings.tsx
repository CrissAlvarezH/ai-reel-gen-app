// His Reel Studio account (the site that holds his Meta app and Instagram connections; the studio only keeps its
// session, server/cloud.ts): the header's indicator, Ajustes → Cuenta, and Ajustes → Instagram, which of its
// accounts this project uses for Instagram's own numbers in Mi cuenta and, later, publishing.
import {useCallback, useEffect, useState} from 'react';
import {AlertTriangle, AtSign, ExternalLink, Loader2, LogOut, Mail, RefreshCw} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {cloudApi, useSocket, type CloudSession, type CloudStatus} from './api';

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

// /api/cloud, reloaded whenever the session changes elsewhere (the panel closed it, or the other section did).
function useCloudStatus() {
  const [s, setS] = useState<CloudStatus | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => void cloudApi.status().then(setS, (e: Error) => setErr(e.message)), []);
  useEffect(load, [load]);
  useSocket((msg) => msg.type === 'cloud' && load());
  return {s, setS, err, load};
}

function Loading({err}: {err: string}) {
  return err ? (
    <p className="text-sm text-destructive">{err}</p>
  ) : (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export function AccountSection() {
  const {s, setS, err, load} = useCloudStatus();
  return s ? <AccountCard s={s} onChange={setS} reload={load} /> : <Loading err={err} />;
}

export function InstagramSection() {
  const {s, setS, err, load} = useCloudStatus();
  if (!s) return <Loading err={err} />;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuenta de Reel Studio</CardTitle>
        <CardDescription>
          {s.signedIn
            ? 'Tu app de Meta y tus cuentas de Instagram se conectan en tu panel web. Este equipo guarda la sesión, nunca las claves de Meta.'
            : 'Es opcional. Sin cuenta, todo sigue funcionando en este equipo. Con ella: Instagram, tus proyectos en la nube, tus claves y la sincronización.'}
        </CardDescription>
        {s.signedIn && (
          <CardAction>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(async () => onChange(await cloudApi.logout()))}>
              <LogOut /> Cerrar sesión
            </Button>
          </CardAction>
        )}
      </CardHeader>
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
          </div>
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
                  setCode('');
                });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cloud-email">Correo</Label>
              <Input id="cloud-email" type="email" autoComplete="email" value={email} disabled={busy || sent} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
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
          </form>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
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
            <div className="flex flex-wrap items-center gap-3">
              <Select value={a ? String(a.id) : NONE} onValueChange={(v) => void pick(v)} disabled={busy}>
                <SelectTrigger className="w-72" aria-label="Cuenta de Instagram de este proyecto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {s.accounts.map((x) => (
                    <SelectItem key={x.id} value={String(x.id)}>
                      <AtSign className="size-3.5" /> {x.username}
                    </SelectItem>
                  ))}
                  <SelectItem value={NONE}>Ninguna</SelectItem>
                </SelectContent>
              </Select>
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              {panel('Conectar otra')}
            </div>
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
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
