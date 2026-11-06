// Reel page, above the video and its script: how well the script fits the Perfil de audiencia (server/script-check.ts).
// It judges itself when the saved script changes (by him or the agent), a few seconds after the last change, and on
// Revisar. Opening a video never spends a check: it shows the last one, marked when the script changed since.
import {useCallback, useEffect, useRef, useState} from 'react';
import {Check, ChevronDown, ChevronRight, Lightbulb, MessageSquarePlus, RefreshCw, Sparkles, Target} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {cn} from '@/lib/utils';
import {api, fmtAgo, useLive, type ScriptCheck, type ScriptCheckState} from './api';
import {LEVELS} from './Audience';
import {useStudio} from './studio';

const SETTLE = 10_000; // the agent writes vo.txt and then beats.json, sometimes several times in a row

const tone = (score: number) => (score >= 75 ? 'text-emerald-500' : score >= 50 ? 'text-amber-400' : 'text-red-500');
const bar = (pct: number) => (pct >= 0.75 ? 'bg-emerald-500' : pct >= 0.5 ? 'bg-amber-400' : 'bg-red-500');
// "Claude Code · claude-sonnet-5-5-2026…" → "Sonnet 5.5"; another CLI's model as it names it.
export function modelName(full: string) {
  const id = full.split(' · ').pop() ?? full;
  const m = /(opus|sonnet|haiku|fable)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?!\d)/i.exec(id);
  if (!m) return id;
  return [m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), m[2] && (m[3] ? `${m[2]}.${m[3]}` : m[2])].filter(Boolean).join(' ');
}
const word = (score: number) => (score >= 75 ? 'Bien alineado' : score >= 50 ? 'A medias' : 'Poco alineado');

// The score as a ring; while judging, a turning arc.
function Ring({score, busy, dim}: {score: number | null; busy: boolean; dim: boolean}) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-14 flex-none place-items-center">
      <svg viewBox="0 0 50 50" className={cn('absolute inset-0 size-full -rotate-90', busy && 'animate-spin [animation-duration:1.4s]')} aria-hidden>
        <circle cx="25" cy="25" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={busy ? c * 0.72 : c * (1 - (score ?? 0) / 100)}
          className={cn('transition-[stroke-dashoffset] duration-700', busy ? 'stroke-foreground/60' : score === null ? 'stroke-transparent' : `stroke-current ${tone(score)}`, dim && !busy && 'opacity-40')}
        />
      </svg>
      {!busy && <span className={cn('text-sm font-semibold tabular-nums', score === null ? 'text-muted-foreground' : dim && 'text-muted-foreground')}>{score ?? '–'}</span>}
    </div>
  );
}

export function AudienceFit({slug, script}: {slug: string; script: string}) {
  const [s, setS] = useState<ScriptCheckState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const {audits, addAudit} = useStudio();
  const attached = audits.includes(slug);
  const load = useCallback(() => api.audienceCheck(slug).then(setS, (e: Error) => setErr(e.message)), [slug]);
  useEffect(() => void load(), [load]);
  useLive((x) => x === slug && load());

  const judge = useCallback(
    async (force: boolean) => {
      setBusy(true);
      setErr('');
      try {
        setS(await api.runAudienceCheck(slug, force));
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
    const t = setTimeout(() => {
      if (s?.audience) void judge(false);
    }, SETTLE);
    return () => clearTimeout(t);
  }, [script, s?.audience, judge]);

  if (!s) return err ? <p className="rounded-xl border px-4 py-3 text-xs text-destructive">No pude leer la alineación con tu audiencia: {err}</p> : <div className="h-[82px] rounded-xl border bg-card" aria-hidden />;

  const shell = 'flex items-center gap-4 rounded-xl border bg-card px-4 py-3';
  if (!s.audience)
    return (
      <div className={cn(shell, 'border-dashed bg-transparent')}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
          <Target className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">Alineación con tu audiencia</span>
          <span className="text-xs text-muted-foreground">Tu perfil de audiencia no está configurado: sin él no hay contra qué revisar el guion.</span>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="#/audiencia">
            Configurarlo <ChevronRight />
          </a>
        </Button>
      </div>
    );

  const running = busy || s.running;
  const c: ScriptCheck | null = s.check;
  const error = err || s.error;
  const stale = s.stale && !running;
  const level = c?.level ? LEVELS.find((l) => l.key === c.level) : null;
  const status = running
    ? 'Revisando el guion contra tu audiencia…'
    : !s.script
      ? 'Cuando haya guion, lo reviso contra tu perfil de audiencia.'
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
            <span className="text-sm font-medium">Alineación con tu audiencia</span>
            {c && !running && <span className={cn('text-xs font-medium', stale ? 'text-muted-foreground' : tone(c.score))}>{word(c.score)}</span>}
            {c && level && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={level.hint}>
                <span className={cn('size-1.5 rounded-full', level.dot)} /> {level.label}
              </span>
            )}
            {c?.model && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" title={`Analizado con ${c.model}`}>
                <Sparkles className="size-3" /> {modelName(c.model)}
              </span>
            )}
            {c?.problem && <span className="max-w-64 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={c.problem}>«{c.problem}»</span>}
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
          <div className="flex flex-col items-stretch gap-1.5">
            <Button variant="outline" size="sm" disabled={running || !s.script} onClick={() => void judge(!stale)} title={c ? `Revisado ${fmtAgo(c.at)}` : undefined}>
              <RefreshCw className={cn(running && 'animate-spin')} /> {c ? 'Revisar de nuevo' : 'Revisar'}
            </Button>
            {c && (
              <Button variant="ghost" size="sm" disabled={running || attached} onClick={() => addAudit(slug)} title="Va con tu próximo mensaje al agente de este video">
                {attached ? <Check /> : <MessageSquarePlus />} {attached ? 'En el chat' : 'Agregar al chat'}
              </Button>
            )}
          </div>
        </div>
      </div>
      {c && (
        <CollapsibleContent>
          <div className="grid gap-6 border-t px-4 py-4 md:grid-cols-2">
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
              <p className="text-[11px] text-muted-foreground">Revisado {fmtAgo(c.at)}. Pídele al agente que aplique estos cambios si te convencen.</p>
            </div>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
