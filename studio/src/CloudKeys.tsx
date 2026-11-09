import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowRight, CloudDownload, CloudUpload, Loader2, Settings} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cloudApi, useSocket} from './api';
import {useConfirm} from './confirm';
import type {CloudKey, CloudKeyState, CloudKeys} from '../shared/types';

// Ajustes → Claves y servicios: each key here and in the account, and moving them by hand. What runs is always this
// computer's copy, so nothing here changes on its own. Values never reach this page: only their last characters.

const STATE: Record<CloudKeyState, {label: string; hint: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'}> = {
  none: {label: 'Sin configurar', hint: '', variant: 'outline'},
  local: {label: 'Local', hint: 'Está solo en este equipo, no en tu cuenta.', variant: 'secondary'},
  cloud: {label: 'Nube', hint: 'Está solo en tu cuenta, no en este equipo.', variant: 'secondary'},
  same: {label: 'Sincronizado', hint: 'Está en este equipo y en tu cuenta, y es la misma.', variant: 'default'},
  different: {label: 'Conflicto', hint: 'Este equipo y tu cuenta tienen valores distintos. Elige cuál usar.', variant: 'destructive'},
};

const KEY_GROUPS = [
  {title: 'Configuradas', configured: true},
  {title: 'Sin configurar', configured: false},
];

// Where a key is entered: the screen of whatever uses it.
const setUpAt = (name: string) => (name === 'ELEVENLABS_API_KEY' ? {hash: '#/ajustes/voz', label: 'Voz'} : {hash: '#/ajustes/datos', label: 'Extracción de datos'});

const dots = (last4: string | null) => (last4 ? `····${last4}` : 'clave corta');
const when = (at: string) => new Date(at).toLocaleString('es', {dateStyle: 'medium', timeStyle: 'short'});
const saved = (k: CloudKey) => [k.updatedAt && `guardada el ${when(k.updatedAt)}`, k.updatedBy].filter(Boolean).join(' · ');
const canBring = (k: CloudKey) => k.state === 'cloud' && !k.unreadable;

function detail(k: CloudKey) {
  if (k.unreadable) return 'La copia de tu cuenta no se puede leer: vuelve a subirla desde un equipo que la tenga.';
  if (k.state === 'local' || k.state === 'same') return dots(k.localLast4);
  if (k.state === 'cloud') return [dots(k.cloudLast4), saved(k)].filter(Boolean).join(' · ');
  if (k.state === 'different') return `Aquí ${dots(k.localLast4)} · En tu cuenta ${dots(k.cloudLast4)}${saved(k) ? ` (${saved(k)})` : ''}`;
  return '';
}

function StateBadge({state}: {state: CloudKeyState}) {
  const {label, hint, variant} = STATE[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default">
          <Badge variant={variant}>{label}</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function SetUpLink({name}: {name: string}) {
  const {hash, label} = setUpAt(name);
  return (
    <a href={hash} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
      Ir a {label} <ArrowRight className="size-3" />
    </a>
  );
}

// The last answer, so coming back shows it at once while it refreshes: asking the account takes a moment.
let lastKeys: CloudKeys | null = null;

// The shape of the two lists; the split is a guess until the answer arrives (seven keys in all).
function KeysSkeleton() {
  return (
    <>
      <section className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <div className="divide-y rounded-lg border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1 p-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <div className="divide-y rounded-lg border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between p-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function CloudKeysCard() {
  const confirm = useConfirm();
  const [data, setState] = useState<CloudKeys | null>(lastKeys);
  const setData = useCallback((v: CloudKeys) => {
    lastKeys = v;
    setState(v);
  }, []);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => void cloudApi.keys().then(setData, (e: Error) => setErr(e.message)), [setData]);
  useEffect(load, [load]);
  const [panelUrl, setPanelUrl] = useState<string>();
  useEffect(() => void cloudApi.status().then((s) => setPanelUrl(s.panelUrl), () => {}), []);
  useSocket((msg) => msg.type === 'cloud' && load(), load);

  const act = async (id: string, fn: () => Promise<CloudKeys>) => {
    setBusy(id);
    setErr('');
    try {
      setData(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const moveMissing = (direction: 'upload' | 'download') =>
    act(direction, async () => {
      const r = await cloudApi.moveMissingKeys(direction);
      if (r.failed.length) setErr(r.failed.map((f) => `${f.label}: ${f.error}`).join(' · '));
      return r;
    });

  const useThisOne = async (k: CloudKey) => {
    if (await confirm({title: `¿Usar en tu cuenta la clave de ${k.label} de este equipo?`, description: `La de tu cuenta (${dots(k.cloudLast4)}) se reemplaza por la de este equipo (${dots(k.localLast4)}).`, action: 'Usar la de este equipo'})) void act(k.name, () => cloudApi.uploadKey(k.name));
  };
  const useAccounts = async (k: CloudKey) => {
    if (await confirm({title: `¿Usar en este equipo la clave de ${k.label} de tu cuenta?`, description: `La de este equipo (${dots(k.localLast4)}) se reemplaza por la de tu cuenta (${dots(k.cloudLast4)}).`, action: 'Usar la de mi cuenta'})) void act(k.name, () => cloudApi.downloadKey(k.name));
  };

  const live = !!data?.signedIn && !data.error;
  const toUpload = live ? data.keys.filter((k) => k.state === 'local').length : 0;
  const toBring = live ? data.keys.filter(canBring).length : 0;
  const disabled = busy !== null;
  const spin = (id: string, icon: React.ReactNode) => (busy === id ? <Loader2 className="animate-spin" /> : icon);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus claves</CardTitle>
        <CardDescription>Reel Studio siempre usa las de este equipo. En tu cuenta se guardan cifradas para llevarlas a otros equipos.</CardDescription>
        {(!data || data.signedIn) && (
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm">
                  <a href={panelUrl && `${panelUrl}/keys`} target="_blank" rel="noreferrer" aria-label="Configurar en el panel">
                    <Settings />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Configurar en el panel</TooltipContent>
            </Tooltip>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data && !data.signedIn && (
          <p className="text-sm text-muted-foreground">
            <a href="#/ajustes/cuenta" className="underline hover:text-foreground">
              Inicia sesión
            </a>{' '}
            para guardarlas en tu cuenta y traerlas a un equipo nuevo.
          </p>
        )}
        {data?.error && <p className="text-sm text-destructive">No se pudo consultar tu cuenta: {data.error}</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {(toUpload > 0 || toBring > 0) && (
          <div className="flex flex-wrap gap-2">
            {toUpload > 0 && (
              <Button variant="secondary" disabled={disabled} onClick={() => void moveMissing('upload')}>
                {spin('upload', <CloudUpload />)} Subir las que faltan ({toUpload})
              </Button>
            )}
            {toBring > 0 && (
              <Button variant="secondary" disabled={disabled} onClick={() => void moveMissing('download')}>
                {spin('download', <CloudDownload />)} Traer las que faltan ({toBring})
              </Button>
            )}
          </div>
        )}
        {!data && !err && <KeysSkeleton />}
        {data &&
          KEY_GROUPS.map(({title, configured}) => {
            const keys = data.keys.filter((k) => (k.state !== 'none') === configured);
            if (!keys.length) return null;
            return (
              <section key={title} className="flex flex-col gap-2">
                <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
                <ul className="divide-y rounded-lg border">
                  {keys.map((k) => (
                  <li key={k.name} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {k.label} {live && k.state !== 'none' && <StateBadge state={k.state} />}
                      </span>
                      {k.state !== 'none' && (
                          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span className="break-words">{live ? detail(k) : dots(k.localLast4)}</span>
                            <SetUpLink name={k.name} />
                          </span>
                        )}
                    </div>
                    {live && (
                      <div className="flex flex-wrap gap-2">
                        {k.state === 'local' && (
                          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void act(k.name, () => cloudApi.uploadKey(k.name))}>
                            {spin(k.name, <CloudUpload />)} Sincronizar
                          </Button>
                        )}
                        {canBring(k) && (
                          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void act(k.name, () => cloudApi.downloadKey(k.name))}>
                            {spin(k.name, <CloudDownload />)} Traer a este equipo
                          </Button>
                        )}
                        {k.state === 'different' && (
                          <>
                            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void useThisOne(k)}>
                              {spin(k.name, <CloudUpload />)} Usar la de este equipo
                            </Button>
                            {!k.unreadable && (
                              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void useAccounts(k)}>
                                <CloudDownload /> Usar la de mi cuenta
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {k.state === 'none' && <SetUpLink name={k.name} />}
                  </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </CardContent>
    </Card>
  );
}

// After logging in, wherever that happened: keys this computer doesn't have yet are offered, and nothing comes down
// without saying yes. Not when the app just opens with a session already there.
export function CloudKeysOffer() {
  const confirm = useConfirm();
  const wasIn = useRef<boolean | null>(null);
  const offer = async () => {
    const missing = (await cloudApi.keys()).keys.filter(canBring);
    if (!missing.length) return;
    const names = missing.map((k) => k.label).join(', ');
    const one = missing.length === 1;
    const yes = await confirm({
      title: one ? 'Tienes una clave en tu cuenta' : `Tienes ${missing.length} claves en tu cuenta`,
      description: `${names}: ${one ? 'este equipo no la tiene' : 'este equipo no las tiene'}. Se guardarán en el .env de tu carpeta de trabajo.`,
      action: 'Traer a este equipo',
    });
    if (!yes) return;
    await cloudApi.moveMissingKeys('download');
    location.hash = '#/ajustes/modo';
  };
  const check = () =>
    void cloudApi.session().then((s) => {
      const before = wasIn.current;
      wasIn.current = s.signedIn;
      if (before === false && s.signedIn) void offer().catch(() => {}); // from another computer on the network: not allowed, nothing to offer
    }, () => {});
  useEffect(check, []);
  useSocket((msg) => msg.type === 'cloud' && check(), check);
  return null;
}
