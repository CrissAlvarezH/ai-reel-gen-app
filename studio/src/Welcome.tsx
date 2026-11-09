import {useEffect, useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Clapperboard, FolderOpen, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {desktop, workspaceApi, type FolderInfo, type WorkspaceStatus} from './api';
import {AgentCard, ImagesCard, SocialCard, VoiceSection, useKeys} from './Settings';
import {ProfileCard, ProjectRulesCard} from './ProfileVoice';
import {RequirementsCard} from './Requirements';

// First run (and Ajustes → Carpeta y perfil → Carpeta de trabajo → Cambiar): choose the workspace, then check the agent,
// what the machine needs, the profile, the voice and where pictures come from (each with its key, as in Ajustes). Only the folder is required; the rest can be done later in Ajustes.

const STEPS = ['Carpeta', 'Agente', 'Requisitos', 'Perfil', 'Voz', 'Datos'] as const;

export function Welcome({status, onDone}: {status: WorkspaceStatus; onDone: () => void}) {
  const [step, setStep] = useState(0);
  const ready = status.configured;
  const {keys, setKeys, err: keysErr} = useKeys(ready ? status.path : null);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
        <span className="flex items-center gap-2 font-semibold">
          <Clapperboard className="size-5" />
          Reel Studio
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Bienvenida</span>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Prepara Reel Studio</h1>
          <p className="text-muted-foreground">Seis pasos. Solo la carpeta es obligatoria: lo demás se puede cambiar luego en Ajustes.</p>
        </div>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={!ready && i > 0}
                onClick={() => setStep(i)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1 text-sm disabled:opacity-50',
                  i === step ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="tabular-nums">{i + 1}</span> {s}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && <FolderStep status={status} onNext={() => setStep(1)} />}
        {step === 1 && <AgentCard />}
        {step === 2 && <RequirementsCard />}
        {step === 3 && (
          <>
            <ProfileCard />
            <ProjectRulesCard />
          </>
        )}
        {step === 4 && <VoiceSection keys={keys} keysErr={keysErr} onKeys={setKeys} />}
        {step === 5 && (
          <>
            <ImagesCard keys={keys} onKeys={setKeys} />
            <SocialCard keys={keys} onKeys={setKeys} />
          </>
        )}

        {step > 0 && (
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft /> Atrás
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>
                Siguiente <ArrowRight />
              </Button>
            ) : (
              <Button onClick={onDone}>
                <Check /> Empezar
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function FolderStep({status, onNext}: {status: WorkspaceStatus; onNext: () => void}) {
  const [path, setPath] = useState(status.path ?? status.suggested);
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState<string[] | null>(null);

  // What's in the folder, as it's typed or picked.
  useEffect(() => {
    setInfo(null);
    setCopied(null);
    if (!path.trim()) return;
    const t = setTimeout(() => {
      workspaceApi.inspect(path).then(setInfo, (e: Error) => setErr(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [path]);

  const pick = async () => {
    const p = await desktop?.pickFolder(info?.exists ? info.path : undefined);
    if (p) setPath(p);
  };
  const use = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await workspaceApi.set(path);
      setCopied(r.copied);
      if (!r.copied.length || status.path === r.path) onNext();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const current = !!status.path && info?.path === status.path;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carpeta de trabajo</CardTitle>
        <CardDescription>
          Donde viven tus videos, estilos, ajustes y claves. Reel Studio copia ahí su plantilla, herramientas, estilos e instrucciones para el agente, y el agente trabaja dentro de ella. Puede ser una
          carpeta nueva o una que ya uses: nunca se reemplaza nada de lo que ya tiene.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-sm" aria-label="Ruta de la carpeta" spellCheck={false} />
          {desktop && (
            <Button variant="secondary" onClick={pick}>
              <FolderOpen /> Elegir…
            </Button>
          )}
        </div>
        {info && <FolderNote info={info} current={current} />}
        {copied && copied.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-500">
              <Check className="size-4" /> Lista. Copiado: {copied.join(', ')}.
            </span>
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          {copied ? (
            <Button onClick={onNext}>
              Siguiente <ArrowRight />
            </Button>
          ) : (
            <Button onClick={use} disabled={busy || !info || (info.exists && !info.isDir)}>
              {busy && <Loader2 className="animate-spin" />}
              {current ? 'Seguir con esta carpeta' : 'Usar esta carpeta'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FolderNote({info, current}: {info: FolderInfo; current: boolean}) {
  const add = info.missing.length ? `Se añade lo que falta: ${info.missing.join(', ')}.` : 'No le falta nada.';
  const text = info.exists && !info.isDir
    ? 'Esa ruta es un archivo, no una carpeta.'
    : !info.exists
      ? 'La carpeta no existe: se creará con todo lo necesario.'
      : current
        ? `Es la carpeta actual${info.videos ? ` (${info.videos} video${info.videos > 1 ? 's' : ''})` : ''}. ${add}`
        : info.workspace
          ? `Ya es una carpeta de Reel Studio${info.videos ? ` con ${info.videos} video${info.videos > 1 ? 's' : ''}` : ''}: no se cambia nada de lo que tiene. ${add}`
          : info.empty
            ? 'La carpeta está vacía: se llenará con todo lo necesario.'
            : `La carpeta ya tiene otros archivos; no se tocan. ${add}`;
  return <p className={cn('text-sm', info.exists && !info.isDir ? 'text-destructive' : 'text-muted-foreground')}>{text}</p>;
}
