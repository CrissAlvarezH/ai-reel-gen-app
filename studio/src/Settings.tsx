import {useEffect, useRef, useState} from 'react';
import {AtSign, Bot, CheckCircle2, Cloud, Database, FolderKanban, FolderOpen, ImageUp, KeyRound, UserRound, ListChecks, Loader2, Mic, Monitor, Pencil, Puzzle, RefreshCw, SunMoon, Trash2, User, XCircle} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import {IMAGE_SOURCES, SOCIAL_SOURCES, type ImageSources, type ProjectContents, type SocialSourceId, type Voice} from '../shared/types';
import {Switch} from '@/components/ui/switch';
import {accountApi, fmtAgo, imagesApi, noteAgent, projectsApi, socialApi, settingsApi, voiceApi, workspaceApi, type WorkspaceStatus, type AgentChoice, type AgentUsage, type KeyStatus, type Project, type Settings as SettingsT} from './api';
import {useConfirm} from './confirm';
import {useStudio} from './studio';
import {ProfileCard, ProjectRulesCard, VoiceCard, VoiceCardSkeleton} from './ProfileVoice';
import {RequirementsCard} from './Requirements';
import {ProjectAvatar, useProjects} from './ProjectPicker';
import {SkillsSection} from './Skills';
import {CloudSection} from './CloudSettings';
import AppearanceSection from '@/components/settings/AppearanceSection';
import SettingsHeader from '@/components/settings/SettingsHeader';
import SettingsNav from '@/components/settings/SettingsNav';
import type {SettingsGroup} from '@/components/settings/SettingsNav/SettingsNav.types';

// Ajustes (#/ajustes/<section>), in groups: General (Proyecto, Cuenta, Apariencia), Creación de videos (Agente,
// Voz, Skills), Conexiones (Instagram, Extracción de datos, Claves y servicios) and Sistema (Requisitos). Skills reads the workspace's instructions and supporting files. Each service key is
// asked for where it's used.

// What each key is used for, in the UI's words.
const USES: Record<string, string> = {
  ELEVENLABS_API_KEY: 'La voz que narra los reels. Se guarda en este equipo.',
  PEXELS_API_KEY: 'Buscar fotos en Pexels.',
  PIXABAY_API_KEY: 'Gratis: con tu sesión iniciada en pixabay.com, aparece en pixabay.com/api/docs.',
  UNSPLASH_ACCESS_KEY: 'Es la «Access Key» de tu aplicación en Unsplash.',
  OPENAI_API_KEY: 'Genera las imágenes con gpt-image-1.',
  APIFY_TOKEN: 'Inspiración descarga reels y cuentas de Instagram con Apify, que cobra por reel de tu saldo (el plan gratuito trae 5 US$ al mes).',
  SCRAPECREATORS_API_KEY: 'Tu API key de scrapecreators.com (Dashboard). Gasta créditos de prepago que no caducan.',
};

// The API keys' state, shared by every section that asks for one. The welcome page passes the workspace's
// path: none until a folder is chosen, and another folder has other keys.
export function useKeys(workspace: string | null = 'current') {
  const [s, setS] = useState<SettingsT | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setS(null);
    if (workspace) settingsApi.get().then(setS, (e: Error) => setErr(e.message));
  }, [workspace]);
  return {keys: s?.keys, setKeys: setS, err};
}

// compact: inside another row (no frame of its own, no title).
export function KeyRow({k, onChange, compact = false}: {k: KeyStatus; onChange: (s: SettingsT) => void; compact?: boolean}) {
  const confirm = useConfirm();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'verify' | 'remove' | null>(null);
  // A configured key shows its actions; the input appears only to enter one or after "Editar".
  const [editing, setEditing] = useState(false);
  const showInput = !k.set || editing;
  const [err, setErr] = useState('');
  const act = async (kind: 'save' | 'verify' | 'remove', fn: () => Promise<SettingsT>) => {
    setBusy(kind);
    setErr('');
    try {
      onChange(await fn());
      if (kind === 'save') {
        setValue('');
        setEditing(false);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn('flex flex-col gap-3', !compact && 'rounded-lg border p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className={cn(compact ? 'text-sm' : 'font-medium')}>{compact ? `Clave de ${k.label}` : k.label}</span>
        {k.set ? <Badge variant="secondary">Configurada · ····{k.last4}</Badge> : <Badge variant="outline">Sin configurar</Badge>}
        {!compact && <span className="w-full text-sm text-muted-foreground">{USES[k.name]}</span>}
      </div>
      {k.check && (
        <p className={cn('flex items-center gap-1.5 text-sm', k.check.ok ? 'text-emerald-500' : 'text-destructive')}>
          {k.check.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {k.check.info}
          <span className="text-muted-foreground">· comprobada {fmtAgo(k.check.at)}</span>
        </p>
      )}
      {showInput ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) act('save', () => settingsApi.setKey(k.name, value));
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            autoFocus={editing}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={k.set ? 'Pega la clave nueva' : `Pega tu clave de ${k.label}`}
            className="min-w-64 flex-1 font-mono"
          />
          <Button type="submit" disabled={!value.trim() || !!busy}>
            {busy === 'save' && <Loader2 className="animate-spin" />} Guardar
          </Button>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setEditing(false);
                setValue('');
                setErr('');
              }}
            >
              Cancelar
            </Button>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size={compact ? 'sm' : 'default'} disabled={!!busy} onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </Button>
          <Button variant="outline" size={compact ? 'sm' : 'default'} disabled={!!busy} onClick={() => act('verify', () => settingsApi.verify(k.name))}>
            {busy === 'verify' && <Loader2 className="animate-spin" />} Comprobar
          </Button>
          <Button
            variant="ghost"
            size={compact ? 'sm' : 'default'}
            disabled={!!busy}
            onClick={async () =>
              (await confirm({title: `¿Quitar la clave de ${k.label}?`, description: 'Se borra del .env de la carpeta de trabajo.', action: 'Quitar', destructive: true})) &&
              act('remove', () => settingsApi.setKey(k.name, ''))
            }
          >
            Quitar
          </Button>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

/* ───── Cuenta ───── */

// The folder the studio works on. Changing it goes through the welcome page.
function WorkspaceCard() {
  const [ws, setWs] = useState<WorkspaceStatus | null>(null);
  useEffect(() => {
    workspaceApi.status().then(setWs, () => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Carpeta de trabajo</CardTitle>
        <CardDescription>Donde viven tus videos, estilos, ajustes y claves, y donde trabaja el agente.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="break-all font-mono text-sm">{ws?.path ?? '…'}</p>
        {!!ws?.missing.length && <p className="text-sm text-amber-500">Le falta: {ws.missing.join(', ')}. Ábrela con «Cambiar…» y «Seguir con esta carpeta» para añadirlo.</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => workspaceApi.reveal()}>
            <FolderOpen /> Abrir
          </Button>
          <Button variant="ghost" asChild>
            <a href="#/bienvenida">Cambiar…</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ───── Modo ───── */

function ModeCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dónde se guardan tus claves</CardTitle>
        <CardDescription>Cada clave se pide donde se usa (Voz, Extracción de datos…); aquí eliges dónde viven.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-foreground/40 bg-muted/40 p-4">
          <span className="flex items-center gap-2 font-medium">
            <Monitor className="size-4" /> Local <Badge>Activo</Badge>
          </span>
          <span className="text-sm text-muted-foreground">Tus propias claves, guardadas en este equipo (.env de la carpeta de trabajo).</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-dashed p-4 opacity-60">
          <span className="flex items-center gap-2 font-medium">
            <Cloud className="size-4" /> Cuenta <Badge variant="outline">Próximamente</Badge>
          </span>
          <span className="text-sm text-muted-foreground">Inicias sesión y usas Apify desde tu cuenta, sin clave propia. ElevenLabs sigue siendo local.</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ───── Agente ───── */

// When a limit starts over: "hoy a las 7:20 p. m.", "mañana a las…", "vie, 7 de nov, 4:00 p. m.".
function fmtReset(at: number) {
  const d = new Date(at);
  const time = d.toLocaleTimeString('es', {hour: 'numeric', minute: '2-digit'});
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `hoy a las ${time}`;
  if (days === 1) return `mañana a las ${time}`;
  return `${d.toLocaleDateString('es', {weekday: 'short', day: 'numeric', month: 'short'})}, ${time}`;
}

// The plan's limits of a connected agent, read apart from its status: the CLI takes a moment to answer.
function AgentUsageView({id, checks}: {id: string; checks: number}) {
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [err, setErr] = useState('');
  const first = useRef(checks);
  useEffect(() => {
    let current = true;
    settingsApi.agentUsage(id, checks !== first.current).then(
      (u) => {
        if (!current) return;
        setUsage(u);
        setErr('');
      },
      (e: Error) => {
        if (!current) return;
        setUsage(null); // no old figures next to the error
        setErr(e.message);
      },
    );
    return () => {
      current = false;
    };
  }, [id, checks]);
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Uso del plan</span>
      {/* Two windows (session and week), as most plans have, so the card doesn't jump when they arrive. */}
      {!usage &&
        !err &&
        [0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1.5" aria-hidden>
            <div className="flex h-5 items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      {err && <p className="text-sm text-destructive">No pude leer el uso: {err}</p>}
      {usage && !usage.windows.length && !err && <p className="text-sm text-muted-foreground">{usage.note}</p>}
      {usage?.windows.map((w) => (
        <div key={w.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{w.label}</span>
            <span className="tabular-nums">{Math.round(w.percent)} % usado</span>
          </div>
          <Progress
            value={Math.min(w.percent, 100)}
            aria-label={`${w.label}: ${Math.round(w.percent)} % usado`}
            className={cn('h-1.5', w.percent >= 90 ? '[&>[data-slot=progress-indicator]]:bg-destructive' : w.percent >= 70 && '[&>[data-slot=progress-indicator]]:bg-amber-400')}
          />
          {w.resetsAt && <span className="text-xs text-muted-foreground">Se reinicia {fmtReset(w.resetsAt)}</span>}
        </div>
      ))}
      {usage?.asOf && <p className="text-xs text-muted-foreground">Dato de su última sesión, {fmtAgo(usage.asOf)}.</p>}
    </div>
  );
}

// The agent is a coding-agent CLI already installed here (Claude Code, Codex or OpenCode), with its own login: like
// Orca or Conductor, the studio doesn't bundle one or ask for an API key. One is the default at a time: each video
// can still pick its own when it starts.
// Per project, on by default; only Claude Code has it. The agent runs without asking for each action, so this says what turning it on means.
function ChromeAccess() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<{enabled: boolean}>) => {
    setBusy(true);
    setErr('');
    try {
      setOn((await fn()).enabled);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void act(settingsApi.chrome), []);
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Chrome · en este proyecto</span>
      <div className="flex items-start gap-3">
        <Switch id="chrome-on" checked={on === true} disabled={on === null || busy} onCheckedChange={(v) => void act(() => settingsApi.setChrome(v))} className="mt-0.5" aria-label="Permitir que el agente use Chrome" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="chrome-on" className="cursor-pointer font-medium">
            Permitir que el agente use Chrome
          </label>
          <span className="text-sm text-muted-foreground">
            Usa tu navegador con tus sesiones iniciadas y puede actuar sin preguntarte.
          </span>
        </span>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

// chrome: the project's Chrome switch, under Claude. Not on the welcome page, where no project is open yet.
export function AgentCard({chrome = false}: {chrome?: boolean}) {
  const [c, setC] = useState<AgentChoice | null>(null);
  // Comprobar asks for the usage again too.
  const [checks, setChecks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<AgentChoice>) => {
    setBusy(true);
    setErr('');
    try {
      const next = await fn();
      setC(next);
      noteAgent(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => void act(() => settingsApi.agents(false)), []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agente</CardTitle>
        <CardDescription>Los agentes de cada video usan la herramienta instalada en este equipo, con tu propia sesión. No hace falta clave.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
              setChecks((n) => n + 1);
              void act(() => settingsApi.agents(true));
            }}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Comprobar
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!c && !err && (
          <div role="status" className="flex flex-col gap-3 rounded-lg border p-4">
            <span className="sr-only">Buscando…</span>
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        )}
        {c?.agents.map((a) => {
          const ok = a.installed && a.loggedIn;
          const used = a.id === c.current;
          return (
            <div key={a.id} className={cn('flex flex-col gap-3 rounded-lg border p-4', used && 'border-foreground/40')}>
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="size-4 text-muted-foreground" />
                <span className="font-medium">{a.label}</span>
                {a.installed ? <Badge variant="secondary">{a.version ? `v${a.version}` : 'Instalado'}</Badge> : <Badge variant="destructive">No encontrado</Badge>}
                {used ? (
                  <Badge className="ml-auto">Por defecto</Badge>
                ) : (
                  <Button variant="outline" size="sm" className="ml-auto" disabled={busy || !ok} onClick={() => act(() => settingsApi.setAgent(a.id))}>
                    Usar por defecto
                  </Button>
                )}
              </div>
              {a.path && <p className="font-mono text-xs break-all text-muted-foreground">{a.path}</p>}
              <div className="flex items-start gap-2 text-sm">
                {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className={cn('mt-0.5 size-4 shrink-0', used ? 'text-destructive' : 'text-muted-foreground')} />}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={ok ? 'text-emerald-500' : used ? 'text-destructive' : 'text-muted-foreground'}>{ok ? 'Sesión iniciada' : a.error}</span>
                  {ok && a.account && <span className="break-words text-muted-foreground">{a.account}</span>}
                  <span className="text-xs text-muted-foreground">Comprobado {fmtAgo(a.checkedAt)}</span>
                </div>
              </div>
              {ok && <AgentUsageView id={a.id} checks={checks} />}
              {chrome && a.id === 'claude' && <ChromeAccess />}
            </div>
          );
        })}
        {c && c.agents.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Es el agente con el que empiezan los videos nuevos; al crear cada uno puedes elegir otro. Al cambiarlo, cada
            conversación sigue en una sesión nueva del agente elegido, que recibe lo hablado hasta entonces.
          </p>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

/* ───── Voz ───── */

// On/off first. On: the ElevenLabs key (asked for here, checked against the service when it hasn't been
// yet), and once it works, the voice and its settings.
export function VoiceSection({keys, keysErr, onKeys}: {keys: KeyStatus[] | undefined; keysErr?: string; onKeys: (s: SettingsT) => void}) {
  const [voice, setVoice] = useState<Voice | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const k = keys?.find((x) => x.name === 'ELEVENLABS_API_KEY');
  useEffect(() => {
    voiceApi.get().then(setVoice, (e: Error) => setErr(e.message));
  }, []);

  // A saved key that hasn't been checked since the server started: check it now (it costs no characters).
  const checking = useRef(false);
  const [checkErr, setCheckErr] = useState('');
  useEffect(() => {
    if (!voice?.enabled || !k?.set || k.check || checking.current) return;
    checking.current = true;
    settingsApi.verify(k.name).then(onKeys, (e: Error) => setCheckErr(e.message));
  }, [voice?.enabled, k?.set, k?.check]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setErr('');
    try {
      setVoice(await voiceApi.save({enabled}));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const on = !!voice?.enabled;
  const keyLoading = on && !keys && !keysErr;
  const keyChecking = on && !!k?.set && !k.check && !checkErr;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Generación de voz</CardTitle>
          <CardDescription>El agente genera la narración de cada video con ElevenLabs, con la voz y los ajustes de aquí.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!voice && !err && (
            <div role="status" className="flex items-start gap-3 rounded-lg border p-4">
              <span className="sr-only">Cargando…</span>
              <Skeleton className="mt-0.5 h-5 w-8 flex-none rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          )}
          {voice && (
            <div className="flex items-start gap-3 rounded-lg border p-4">
              <Switch id="voice-on" checked={on} disabled={saving} onCheckedChange={toggle} className="mt-0.5" aria-label="Generar la voz" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="voice-on" className="cursor-pointer font-medium">
                  Generar la voz con ElevenLabs
                </label>
                <span className="text-sm text-muted-foreground">
                  {on ? 'Activada.' : 'Desactivada: el agente no genera la narración y trabaja con tiempos provisionales; la voz la pones tú.'}
                </span>
              </span>
            </div>
          )}
          {keyLoading && (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-8 w-40 rounded-lg" />
            </div>
          )}
          {on && k && <KeyRow k={k} onChange={onKeys} />}
          {keyChecking && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Comprobando la clave…
            </p>
          )}
          {checkErr && <p className="text-sm text-destructive">{checkErr}</p>}
          {on && k?.check && !k.check.ok && <p className="text-sm text-muted-foreground">Arregla la clave para elegir la voz.</p>}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </CardContent>
      </Card>
      {(keyLoading || keyChecking) && <VoiceCardSkeleton />}
      {on && k?.check?.ok && <VoiceCard />}
    </>
  );
}

/* ───── Extracción de datos ───── */

// Where the agent may get pictures from, each with its key right there. Saved on each switch; a source
// that needs a key is only used once its key is set.
export function ImagesCard({keys, onKeys}: {keys: KeyStatus[] | undefined; onKeys: (s: SettingsT) => void}) {
  const [on, setOn] = useState<ImageSources | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    imagesApi.get().then(setOn, (e: Error) => setErr(e.message));
  }, []);
  const toggle = async (id: keyof ImageSources, v: boolean) => {
    setErr('');
    setOn((o) => (o ? {...o, [id]: v} : o));
    try {
      setOn(await imagesApi.save({[id]: v}));
    } catch (e) {
      setErr((e as Error).message);
      imagesApi.get().then(setOn, () => {});
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Imágenes</CardTitle>
        <CardDescription>El agente puede buscar imágenes libremente en internet, sin configurar fuentes. Aquí puedes activar servicios adicionales con API key y la generación de imágenes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!on &&
          !err &&
          [0, 1, 2].map((i) => (
            <div key={i} role={i ? undefined : 'status'} className="flex items-start gap-3 rounded-lg border p-4">
              {!i && <span className="sr-only">Cargando…</span>}
              <Skeleton className="mt-0.5 h-5 w-8 flex-none rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-72 max-w-full" />
              </div>
            </div>
          ))}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {on &&
          IMAGE_SOURCES.filter((s) => s.key).map((s) => {
            const k = s.key ? keys?.find((x) => x.name === s.key) : null;
            return (
              <div key={s.id} className="flex items-start gap-3 rounded-lg border p-4">
                <Switch id={`img-${s.id}`} checked={on[s.id]} onCheckedChange={(v) => toggle(s.id, v)} className="mt-0.5" aria-label={s.label} />
                <span className="flex min-w-0 flex-1 flex-col gap-3">
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <label htmlFor={`img-${s.id}`} className="cursor-pointer">
                        {s.label}
                      </label>
                      {!s.key && <Badge variant="secondary">No necesita clave</Badge>}
                      {on[s.id] && k && !k.set && <span className="text-xs font-normal text-amber-500">Falta la clave: sin ella no se usa</span>}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {s.license}.{k && USES[k.name] ? ` ${USES[k.name]}` : ''}
                    </span>
                  </span>
                  {on[s.id] && k && <KeyRow k={k} onChange={onKeys} compact />}
                </span>
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

// Inspiración's downloads of other accounts' reels: one scraper at a time (Apify or ScrapeCreators), each with
// its own key right under it. Saved on each choice.
export function SocialCard({keys, onKeys}: {keys: KeyStatus[] | undefined; onKeys: (s: SettingsT) => void}) {
  const [source, setSource] = useState<SocialSourceId | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    socialApi.get().then((r) => setSource(r.source), (e: Error) => setErr(e.message));
  }, []);
  const choose = async (id: SocialSourceId) => {
    setErr('');
    setSource(id);
    try {
      setSource((await socialApi.save(id)).source);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scraper de redes sociales</CardTitle>
        <CardDescription>Para Inspiración: descarga los reels de otras cuentas de Instagram para estudiarlos. Usa uno, el que elijas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3" role="radiogroup" aria-label="Scraper">
        {(!keys || !source) &&
          !err &&
          [0, 1].map((i) => (
            <div key={i} role={i ? undefined : 'status'} className="flex items-start gap-3 rounded-lg border p-3">
              {!i && <span className="sr-only">Cargando…</span>}
              <Skeleton className="mt-0.5 size-4 flex-none rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
            </div>
          ))}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {keys &&
          source &&
          SOCIAL_SOURCES.map((s) => {
            const k = keys.find((x) => x.name === s.key);
            const on = s.id === source;
            return (
              <div key={s.id} className={cn('flex items-start gap-3 rounded-lg border p-3 transition-colors', on ? 'border-ring/60 bg-muted/30' : 'hover:bg-muted/20')}>
                <button
                  role="radio"
                  aria-checked={on}
                  aria-label={s.label}
                  onClick={() => choose(s.id)}
                  className={cn('mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border', on ? 'border-primary' : 'border-muted-foreground/50')}
                >
                  {on && <span className="size-2 rounded-full bg-primary" />}
                </button>
                <span className="flex min-w-0 flex-1 flex-col gap-3">
                  <button className="flex flex-col gap-1 text-left" onClick={() => choose(s.id)}>
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {s.label}
                      {on && <Badge variant="secondary">En uso</Badge>}
                      {on && k && !k.set && <span className="text-xs font-normal text-amber-500">Falta la clave: sin ella Inspiración no descarga</span>}
                    </span>
                    <span className="text-sm text-muted-foreground">{s.pricing}</span>
                  </button>
                  {(on || k?.set) && k && <KeyRow k={k} onChange={onKeys} compact />}
                </span>
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

/* ───── Proyecto ───── */

// The open project: its name and its picture (an image, or the photo of its Instagram account from Mi cuenta).
function ProjectCard() {
  const {projects, setProjects} = useProjects();
  const p = projects?.find((x) => x.current) ?? null;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'name' | 'pic' | null>(null);
  const [err, setErr] = useState('');
  const [igPhoto, setIgPhoto] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p) setName(p.name);
  }, [p?.id, p?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    accountApi.status().then((a) => setIgPhoto(a.avatar), () => {});
  }, [p?.id]);
  const run = async (what: 'name' | 'pic', fn: () => Promise<typeof projects>) => {
    setBusy(what);
    setErr('');
    try {
      setProjects(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!p)
    return (
      <Card role="status">
        <span className="sr-only">Cargando…</span>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-xl" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full max-w-sm rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.name}</CardTitle>
        <CardDescription>
          El canal abierto: tiene sus propios videos, su cuenta de Instagram (Mi cuenta), su perfil, su voz y sus conversaciones, en projects/{p.id}/. Se cambia con el selector de arriba a la izquierda.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-4">
          <ProjectAvatar project={p} className="size-16 rounded-xl text-2xl" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Imagen</span>
            <div className="flex flex-wrap gap-2">
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void run('pic', () => projectsApi.setAvatar(p.id, f));
                }}
              />
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => file.current?.click()}>
                {busy === 'pic' ? <Loader2 className="animate-spin" /> : <ImageUp />} {p.avatar ? 'Cambiar imagen' : 'Subir imagen'}
              </Button>
              {igPhoto && (
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void run('pic', () => projectsApi.avatarFromInstagram(p.id))} title="La foto de perfil de su cuenta de Instagram, de Mi cuenta">
                  <UserRound /> Usar la de Instagram
                </Button>
              )}
              {p.avatar && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run('pic', () => projectsApi.removeAvatar(p.id))}>
                  <Trash2 /> Quitar
                </Button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">PNG, JPG o WebP. Sin imagen se ve su inicial.</span>
          </div>
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('name', () => projectsApi.rename(p.id, name));
          }}
        >
          <label htmlFor="project-name" className="text-sm font-medium">
            Nombre
          </label>
          <div className="flex gap-2">
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="max-w-sm" />
            <Button type="submit" disabled={!!busy || !name.trim() || name.trim() === p.name}>
              {busy === 'name' && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">Solo cambia el nombre que ves: la carpeta sigue siendo projects/{p.id}/.</span>
        </form>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// What deleting the project takes with it, one line each, leaving out what it doesn't have.
function deletionSummary(c: ProjectContents) {
  const ideas = [c.ideas && plural(c.ideas, 'idea', 'ideas'), c.verticals && plural(c.verticals, 'vertical', 'verticales')].filter(Boolean).join(' y ');
  const reels = c.reels ? plural(c.reels, 'reel descargado', 'reels descargados') : '';
  const lines = [
    c.videos > 0 && `${plural(c.videos, 'video', 'videos')}, con sus guiones, voces y renders`,
    c.account ? `La sincronización con @${c.account}${reels ? ` y sus ${reels}` : ''}` : reels && `${reels} en Mi cuenta`,
    ideas && `${ideas} de contenido`,
    c.inspiration > 0 && `${plural(c.inspiration, 'cuenta', 'cuentas')} de Inspiración`,
    c.conversations > 0 && plural(c.conversations, 'conversación', 'conversaciones'),
    'Su perfil, su voz y sus ajustes',
  ].filter(Boolean);
  return [
    'Se borrará para siempre:',
    ...lines.map((l) => `• ${l}`),
    '',
    c.account ? 'Tu cuenta de Instagram no se toca. Esto no se puede deshacer.' : 'Esto no se puede deshacer.',
  ].join('\n');
}

// Deleting the open project: the button opens the dialog, and there its name is typed, once, before it goes.
function DangerZone() {
  const {projects} = useProjects();
  const p = projects?.find((x) => x.current) ?? null;
  const [open, setOpen] = useState(false);
  if (!p || !projects) return null;
  const only = projects.length < 2;
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Zona de peligro</CardTitle>
        <CardDescription>Borra este proyecto y todo lo que tiene. No se puede deshacer.</CardDescription>
      </CardHeader>
      <CardContent>
        {only ? (
          <p className="text-sm text-muted-foreground">Es tu único proyecto: crea otro antes de borrarlo.</p>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 /> Borrar proyecto
          </Button>
        )}
      </CardContent>
      {open && <DeleteProject project={p} onClose={() => setOpen(false)} />}
    </Card>
  );
}

// The dialog: what deleting it would take with it, and the project's name typed. The same shape as deleting a video.
function DeleteProject({project: p, onClose}: {project: Project; onClose: () => void}) {
  const confirm = useConfirm();
  const [contents, setContents] = useState<ProjectContents | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ok = typed.trim() === p.name;
  // What it holds, to say it before it goes.
  useEffect(() => {
    projectsApi.contents(p.id).then(setContents, (e: Error) => setErr(e.message));
  }, [p.id]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    // Another project opens and the page reloads on the server's word: leave the settings first, as when
    // changing project, so it lands in the library. The confirm() of the app says any error: this dialog unmounts.
    location.hash = '#/';
    try {
      await projectsApi.remove(p.id, typed);
    } catch (e) {
      confirm({title: 'No se pudo borrar el proyecto', description: (e as Error).message, action: 'Entendido'});
    }
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{p.name}»?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {contents ? deletionSummary(contents) : 'Contando lo que se borraría…'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>
              Escribe <strong className="font-semibold">{p.name}</strong> para confirmar
            </span>
            <Input ref={input} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} placeholder={p.name} />
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              Cancelar
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!ok || busy}>
              {busy && <Loader2 className="animate-spin" />} Borrar proyecto
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ───── The page ───── */

// Grouped like GitHub's settings. The ids are routes (#/ajustes/<id>) linked from other pages: keep them.
// Each subsection is a card of the section, with its wrapper's id below (child: a card drawn by another file).
const GROUPS: SettingsGroup[] = [
  {
    id: 'general',
    label: 'General',
    sections: [
      {
        id: 'proyecto',
        label: 'Proyecto',
        icon: FolderKanban,
        description: 'El canal abierto: su nombre, su imagen, su público y sus reglas. También se borra aquí.',
        subsections: [
          {label: 'Nombre e imagen', anchor: 'ajustes-proyecto'},
          {label: 'Público y reglas', anchor: 'ajustes-reglas'},
          {label: 'Zona de peligro', anchor: 'ajustes-peligro'},
        ],
      },
      {
        id: 'cuenta',
        label: 'Cuenta',
        icon: User,
        description: 'Tu carpeta de trabajo y quién hace los videos.',
        subsections: [
          {label: 'Carpeta de trabajo', anchor: 'ajustes-carpeta'},
          {label: 'Perfil', anchor: 'ajustes-perfil'},
        ],
      },
      {id: 'apariencia', label: 'Apariencia', icon: SunMoon, description: 'Claro, oscuro o el que use tu equipo.', subsections: []},
    ],
  },
  {
    id: 'creacion',
    label: 'Creación de videos',
    sections: [
      {id: 'agente', label: 'Agente', icon: Bot, description: 'La herramienta que trabaja en cada video: la que va por defecto.', subsections: []},
      {
        id: 'voz',
        label: 'Voz',
        icon: Mic,
        description: 'La narración de los videos.',
        subsections: [
          {label: 'Generación de voz', anchor: 'ajustes-voz', child: 0},
          {label: 'Voz del narrador', anchor: 'ajustes-voz', child: 1},
        ],
      },
      {id: 'skills', label: 'Skills', icon: Puzzle, description: 'Las instrucciones que usan los agentes para crear tus videos. Ábrelas para consultar su contenido y sus archivos.', subsections: []},
    ],
  },
  {
    id: 'conexiones',
    label: 'Conexiones',
    sections: [
      {
        id: 'instagram',
        label: 'Instagram',
        icon: AtSign,
        description: 'Tu cuenta de Reel Studio y la cuenta de Instagram de este proyecto: sus números privados y, pronto, publicar.',
        subsections: [
          {label: 'Cuenta de Reel Studio', anchor: 'ajustes-instagram', child: 0},
          {label: 'Instagram de este proyecto', anchor: 'ajustes-instagram', child: 1},
        ],
      },
      {
        id: 'datos',
        label: 'Extracción de datos',
        icon: Database,
        description: 'De dónde salen los reels de Inspiración y las imágenes.',
        subsections: [
          {label: 'Scraper de redes sociales', anchor: 'ajustes-scraper'},
          {label: 'Imágenes', anchor: 'ajustes-imagenes'},
        ],
      },
      // Its id stays 'modo' (old links).
      {id: 'modo', label: 'Claves y servicios', icon: KeyRound, description: 'Dónde se guardan las claves de los servicios externos (ElevenLabs, Apify, Pexels…).', subsections: []},
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    sections: [{id: 'requisitos', label: 'Requisitos', icon: ListChecks, description: 'Lo que necesita este equipo.', subsections: []}],
  },
];

const SECTIONS = GROUPS.flatMap((g) => g.sections.map((s) => ({...s, group: g.label})));

// Without a section in the route (#/ajustes): Proyecto, the first of General, as before.
const DEFAULT_SECTION = 'proyecto';

// A card's wrapper, for the nav's subsections to scroll to. Empty: takes no gap.
const ANCHOR = 'flex scroll-mt-6 flex-col gap-4 empty:hidden';

export function Settings({section: wanted}: {section?: string | null}) {
  const {uiRef} = useStudio();
  const section = SECTIONS.find((s) => s.id === wanted) ?? SECTIONS.find((s) => s.id === DEFAULT_SECTION)!;
  uiRef.current = {page: 'settings'};
  const {keys, setKeys, err} = useKeys();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:flex-row md:items-start md:gap-8">
      <SettingsNav groups={GROUPS} active={section.id} />

      <div key={section.id} className="animate-fade-in flex min-w-0 flex-1 flex-col gap-4">
        <SettingsHeader group={section.group} title={section.label} description={section.description} />
        {err && <p className="text-destructive">{err}</p>}

        {section.id === 'proyecto' && (
          <>
            <div id="ajustes-proyecto" className={ANCHOR}>
              <ProjectCard />
            </div>
            <div id="ajustes-reglas" className={ANCHOR}>
              <ProjectRulesCard />
            </div>
            <div id="ajustes-peligro" className={ANCHOR}>
              <DangerZone />
            </div>
          </>
        )}
        {section.id === 'instagram' && (
          <div id="ajustes-instagram" className={ANCHOR}>
            <CloudSection />
          </div>
        )}
        {section.id === 'cuenta' && (
          <>
            <div id="ajustes-carpeta" className={ANCHOR}>
              <WorkspaceCard />
            </div>
            <div id="ajustes-perfil" className={ANCHOR}>
              <ProfileCard />
            </div>
          </>
        )}
        {section.id === 'apariencia' && <AppearanceSection />}
        {section.id === 'modo' && <ModeCard />}
        {section.id === 'agente' && <AgentCard chrome />}
        {section.id === 'skills' && <SkillsSection />}
        {section.id === 'voz' && (
          <div id="ajustes-voz" className={ANCHOR}>
            <VoiceSection keys={keys} keysErr={err} onKeys={setKeys} />
          </div>
        )}
        {section.id === 'datos' && (
          <>
            <div id="ajustes-scraper" className={ANCHOR}>
              <SocialCard keys={keys} onKeys={setKeys} />
            </div>
            <div id="ajustes-imagenes" className={ANCHOR}>
              <ImagesCard keys={keys} onKeys={setKeys} />
            </div>
          </>
        )}
        {section.id === 'requisitos' && <RequirementsCard />}
      </div>
    </main>
  );
}
