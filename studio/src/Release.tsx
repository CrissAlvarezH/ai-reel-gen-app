// A video's line about Instagram (the library's card and table): out, scheduled, on its way, or ready to send.
import {CalendarClock, CircleCheck, Loader2, Send} from 'lucide-react';
import type {ReelSummary} from './api';

// Where the video stands on Instagram, under its hook: out (and when), scheduled (and for when), on its way, or finished
// and not sent yet. A date this year goes without the year; a scheduled one with its hour.
const day = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('es', {day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : {year: 'numeric'})});
};
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es', {hour: 'numeric', minute: '2-digit'});
const full = (iso: string) => new Date(iso).toLocaleString('es', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit'});
// short: in the table, where the ready one says less.
// compact: in the table, only the icon and, when there is one, its date (the words are on hover).
export function ReleaseLine({r, compact}: {r: NonNullable<ReelSummary['release']>; compact?: boolean}) {
  const [Icon, text, date, title, tone] =
    r.state === 'published'
      ? [CircleCheck, r.at ? `Publicado el ${day(r.at)}` : 'Publicado', r.at ? day(r.at) : '', r.at ? `Publicado en Instagram el ${full(r.at)}` : 'Publicado en Instagram', 'text-emerald-600 dark:text-emerald-400']
      : r.state === 'scheduled' && r.at
        ? [CalendarClock, `Programado: ${day(r.at)}, ${hour(r.at)}`, `${day(r.at)}, ${hour(r.at)}`, `Programado: sale en Instagram el ${full(r.at)}`, 'text-sky-600 dark:text-sky-400']
        : r.state === 'publishing'
          ? [Loader2, 'Publicando…', '', 'Publicando: Instagram lo está publicando', 'text-amber-600 dark:text-amber-400']
          : [Send, 'Listo para publicar o programar', '', 'Listo para publicar o programar: está renderizado y aún no lo has enviado a Instagram', 'text-muted-foreground'];
  const shown = compact ? date : text;
  return (
    <p className={`flex items-center gap-1.5 text-xs font-medium ${tone}`} title={title} aria-label={compact ? title : undefined}>
      <Icon className={`size-3.5 shrink-0${r.state === 'publishing' ? ' animate-spin' : ''}`} />
      {shown && <span className="truncate tabular-nums">{shown}</span>}
    </p>
  );
}
