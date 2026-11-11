import {Check} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import type {ProgressStep} from './api';

// How far the video is from done: one section per step, filled as it's completed. No buttons: the
// agent does every step; the steps are judged from the reel's files (server/reels.ts → progress).

const nextOf = (steps: ProgressStep[]) => steps.find((s) => !s.done)?.key;
// A carousel's steps have its slides (server/carousel.ts → progress).
const ready = (steps: ProgressStep[]) => (steps.some((s) => s.key === 'laminas') ? 'Carrusel listo' : 'Video listo');

export function ReelProgress({steps}: {steps: ProgressStep[]}) {
  const done = steps.filter((s) => s.done).length;
  const next = nextOf(steps);
  const missing = steps.filter((s) => !s.done).map((s) => s.label.toLowerCase());
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{done === steps.length ? ready(steps) : `${done} de ${steps.length}`}</span>
        {done < steps.length && <span className="text-muted-foreground">· falta {missing.join(', ')}</span>}
      </div>
      <div className="grid gap-1.5" style={{gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`}}>
        {steps.map((s) => (
          <div key={s.key} className="flex min-w-0 flex-col gap-1.5">
            <div className={cn('h-2 rounded-full', s.done ? 'bg-emerald-500' : s.key === next ? 'bg-muted-foreground/40' : 'bg-muted')} />
            <span className={cn('flex min-w-0 items-center gap-1 text-xs', s.done ? 'text-foreground' : s.key === next ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {s.done && <Check className="size-3.5 flex-none text-emerald-500" />}
              <span className="truncate">{s.label}</span>
            </span>
            {s.note && <span className="text-[11px] leading-tight text-amber-400">{s.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// The same, small, for the library cards.
export function ReelProgressMini({steps}: {steps: ProgressStep[]}) {
  const done = steps.filter((s) => s.done).length;
  const next = nextOf(steps);
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-0.5">
        {steps.map((s) => (
          <Tooltip key={s.key}>
            <TooltipTrigger asChild>
              <span className={cn('h-1.5 flex-1 rounded-full', s.done ? 'bg-emerald-500' : s.key === next ? 'bg-muted-foreground/40' : 'bg-muted')} />
            </TooltipTrigger>
            <TooltipContent>
              {s.label}: {s.done ? 'hecho' : 'pendiente'}
              {s.note ? ` (${s.note})` : ''}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{done === steps.length ? 'listo' : `${done}/${steps.length}`}</span>
    </div>
  );
}

// The same as a ring, for the sidebar: one arc per step, in order; a check when it's all done.
export function ReelProgressRing({steps, className}: {steps: ProgressStep[]; className?: string}) {
  const done = steps.filter((s) => s.done).length;
  const next = nextOf(steps);
  const r = 7;
  const c = 2 * Math.PI * r;
  const gap = steps.length > 1 ? 1.6 : 0;
  const seg = c / Math.max(steps.length, 1);
  const label = done === steps.length ? ready(steps) : `${done} de ${steps.length}: ${steps.map((s) => `${s.label} ${s.done ? '✓' : '·'}`).join(', ')}`;
  return (
    <span className={cn('relative grid size-4 place-items-center', className)} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 18 18" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        {steps.map((s, i) => (
          <circle
            key={s.key}
            cx="9"
            cy="9"
            r={r}
            fill="none"
            strokeWidth="2.2"
            strokeDasharray={`${seg - gap} ${c - seg + gap}`}
            strokeDashoffset={-i * seg}
            className={s.done ? 'stroke-emerald-500' : s.key === next ? 'stroke-muted-foreground/60' : 'stroke-muted-foreground/20'}
          />
        ))}
      </svg>
      {done === steps.length && <Check className="size-2.5 text-emerald-500" strokeWidth={3} />}
    </span>
  );
}
