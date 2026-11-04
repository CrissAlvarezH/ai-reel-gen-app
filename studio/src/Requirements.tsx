import {useEffect, useRef, useState} from 'react';
import {AlertTriangle, CheckCircle2, Copy, Loader2, RefreshCw, XCircle} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {requirementsApi, type Requirement} from './api';

// Ajustes → Requisitos (and a step of the welcome page): what this machine has of what the studio needs,
// with a button to install or repair what it can do itself. Refreshes every 1.5 s while something installs.
export function RequirementsCard() {
  const [reqs, setReqs] = useState<Requirement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const load = async () => {
    setBusy(true);
    try {
      const r = await requirementsApi.list();
      setReqs(r);
      setErr('');
      clearTimeout(timer.current);
      if (r.some((x) => x.job?.running)) timer.current = window.setTimeout(load, 1500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fix = async (id: string) => {
    setErr('');
    try {
      await requirementsApi.fix(id);
    } catch (e) {
      setErr((e as Error).message);
    }
    void load();
  };
  const missing = reqs?.filter((r) => !r.ok && (r.neededBy === null || r.neededBy.length > 0)).length ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requisitos</CardTitle>
        <CardDescription>
          Lo que Reel Studio usa en este equipo además del agente.{' '}
          {reqs && (missing ? `Falta${missing > 1 ? 'n' : ''} ${missing}.` : 'Está todo.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!reqs && !err && <p className="text-sm text-muted-foreground">Comprobando…</p>}
        {reqs?.map((r) => <Row key={r.id} r={r} onFix={() => fix(r.id)} />)}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={load}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Comprobar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({r, onFix}: {r: Requirement; onFix: () => void}) {
  const optional = r.neededBy !== null && r.neededBy.length === 0;
  const running = !!r.job?.running;
  const failed = r.job?.ok === false;
  const [showLog, setShowLog] = useState(false);
  const Icon = r.ok ? CheckCircle2 : optional ? AlertTriangle : XCircle;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={cn('size-4', r.ok ? 'text-emerald-500' : optional ? 'text-amber-500' : 'text-destructive')} />
        <span className="font-medium">{r.label}</span>
        {r.version && <Badge variant="secondary">{r.version}</Badge>}
        {r.neededBy && (
          <Badge variant="outline" className="font-normal">
            {r.neededBy.length ? `Para ${r.neededBy.join(', ')}` : `Opcional: ${r.unused ?? 'ningún estilo lo usa'}`}
          </Badge>
        )}
        {!r.ok && r.fix?.auto && (
          <Button size="sm" variant="secondary" className="ml-auto" disabled={running} onClick={onFix}>
            {running && <Loader2 className="animate-spin" />} {running ? 'Instalando…' : r.fix.label}
          </Button>
        )}
      </div>
      <p className="break-all text-sm text-muted-foreground">{r.detail}</p>
      {!r.ok && r.fix && !r.fix.auto && <CopyCommand text={r.fix.command} />}
      {r.job && (running || failed || showLog) && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{r.job.log.trim() || '…'}</pre>
      )}
      {r.job && !running && (
        <button type="button" className={cn('self-start text-xs underline-offset-2 hover:underline', failed ? 'text-destructive' : 'text-muted-foreground')} onClick={() => setShowLog(!showLog)}>
          {failed ? 'Falló la instalación' : 'Instalado'} · {showLog ? 'ocultar' : 'ver'} el registro
        </button>
      )}
    </div>
  );
}

function CopyCommand({text}: {text: string}) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
      <code className="flex-1 break-all text-xs">{text}</code>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Copiar"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => setDone(true), () => {});
        }}
      >
        {done ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
