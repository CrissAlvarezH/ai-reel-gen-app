// Reel page, next to Alineación con tu audiencia: how strong the script's opening is (server/hook-check.ts). Like that
// one, it judges itself when the saved script changes, a few seconds after the last change, and on Revisar; opening a
// video never spends a check. Its agent reads it on its own (…/hook-check?format=text), so there's no "Agregar al chat".
import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowRight, Check, ChevronDown, Lightbulb, RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {cn} from '@/lib/utils';
import {api, fmtAgo, useLive, type HookCheck, type HookCheckState} from './api';
import {ModelBadge, Ring, SETTLE, bar, tone} from './AudienceFit';

const word = (score: number) => (score >= 75 ? 'Gancho fuerte' : score >= 50 ? 'Mejorable' : 'Débil');

export function HookStrength({slug, script}: {slug: string; script: string}) {
  const [s, setS] = useState<HookCheckState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.hookCheck(slug).then(setS, (e: Error) => setErr(e.message)), [slug]);
  useEffect(() => void load(), [load]);
  useLive((x) => x === slug && load());

  const judge = useCallback(
    async (force: boolean) => {
      setBusy(true);
      setErr('');
      try {
        setS(await api.runHookCheck(slug, force));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [slug],
  );

  // Judge when the saved script changes while the page is open, once it has settled.
  const seen = useRef(script);
  useEffect(() => {
    if (script === seen.current) return;
    seen.current = script;
    const t = setTimeout(() => void judge(false), SETTLE);
    return () => clearTimeout(t);
  }, [script, judge]);

  if (!s) return err ? <p className="rounded-xl border px-4 py-3 text-xs text-destructive">No pude leer la fuerza del gancho: {err}</p> : <div className="h-[82px] rounded-xl border bg-card" aria-hidden />;

  const running = busy || s.running;
  const c: HookCheck | null = s.check;
  const error = err || s.error;
  const stale = s.stale && !running;
  const status = running
    ? 'Revisando el gancho…'
    : !s.script
      ? 'Cuando haya guion, reviso su gancho.'
      : !c
        ? 'Aún sin revisar. Se revisa solo cada vez que cambia el guion.'
        : stale
          ? 'El guion cambió desde esta revisión.'
          : null;

  return (
    <Collapsible open={open && !!c} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <div className="flex items-center gap-4 px-4 py-3">
        <Ring score={c ? c.score : null} busy={running} dim={stale} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">Fuerza del gancho</span>
            {c && !running && <span className={cn('text-xs font-medium', stale ? 'text-muted-foreground' : tone(c.score))}>{word(c.score)}</span>}
            <ModelBadge check="hook" judged={c?.model} disabled={running} onChange={() => s.script && void judge(true)} />
          </div>
          <p className={cn('line-clamp-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error || status || c?.verdict}</p>
        </div>
        <div className="flex flex-none items-center gap-1">
          {c && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={open ? 'Ocultar detalle' : 'Ver detalle'}>
                Detalle <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          )}
          <Button variant="outline" size="sm" disabled={running || !s.script} onClick={() => void judge(!stale)} title={c ? `Revisado ${fmtAgo(c.at)}` : undefined}>
            <RefreshCw className={cn(running && 'animate-spin')} /> {c ? 'Revisar de nuevo' : 'Revisar'}
          </Button>
        </div>
      </div>
      {c && (
        <CollapsibleContent>
          <div className="grid gap-6 border-t px-4 py-4 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              {c.hook && (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Gancho revisado</h3>
                  <q className="text-sm">{c.hook}</q>
                  {c.question && <p className="text-xs text-muted-foreground">Pregunta que abre: {c.question}</p>}
                </section>
              )}
              <ul className="flex flex-col gap-3">
                {c.criteria.map((k) => (
                  <li key={k.key} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="font-medium">{k.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {k.score}/{k.max}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', bar(k.score / k.max))} style={{width: `${(k.score / k.max) * 100}%`}} />
                    </div>
                    {k.note && <p className="text-xs text-muted-foreground">{k.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              {c.verdict && <p className="text-sm">{c.verdict}</p>}
              {c.fixes.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Qué cambiar</h3>
                  <ol className="flex flex-col gap-3">
                    {c.fixes.map((f, i) => (
                      <li key={i} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-xs">
                        {f.line && <q className="text-muted-foreground line-through decoration-muted-foreground/40">{f.line}</q>}
                        {f.why && <span>{f.why}</span>}
                        {f.try && (
                          <span className="flex gap-1.5 text-foreground">
                            <Lightbulb className="mt-0.5 size-3.5 flex-none text-amber-400" /> {f.try}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {c.alternatives.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ganchos alternativos</h3>
                  <ul className="flex flex-col gap-2">
                    {c.alternatives.map((a, i) => (
                      <li key={i} className="flex flex-col gap-1 rounded-lg border p-3 text-xs">
                        <span className="font-medium">«{a.hook}»</span>
                        {a.second && (
                          <span className="flex gap-1.5 text-muted-foreground">
                            <ArrowRight className="mt-0.5 size-3.5 flex-none" /> {a.second}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {c.good.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Lo que ya funciona</h3>
                  <ul className="flex flex-col gap-1.5">
                    {c.good.map((g, i) => (
                      <li key={i} className="flex gap-1.5 text-xs">
                        <Check className="mt-0.5 size-3.5 flex-none text-emerald-500" /> {g}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="text-[11px] text-muted-foreground">Revisado {fmtAgo(c.at)}. El agente de este video la lee solo: pídele que aplique los cambios o uno de los ganchos alternativos.</p>
            </div>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
