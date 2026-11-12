// Where a publication stands, in a few words: what's missing, ready, when it goes out, or how it did. The sidebar's
// line under each title and the Biblioteca table's Estado column.
import {CalendarClock, Loader2} from 'lucide-react';
import {cn} from '@/lib/utils';
import {fmtTime, type ReelSummary} from './api';
import {ReelProgressRing} from './ReelProgress';

export type StageInput = Pick<ReelSummary, 'kind' | 'slideCount' | 'seconds' | 'progress' | 'instagram' | 'release'>;

const compactNum = new Intl.NumberFormat('es', {notation: 'compact', maximumFractionDigits: 1});

// table: the table has its own Duración and Vistas columns, so there it leaves out the length, and a published one
// says when it went out instead of its views.
export function stageText(r: StageInput, {table = false} = {}): string | null {
  const ig = r.instagram;
  const rel = r.release;
  if (ig || rel?.state === 'published') {
    if (table || ig?.views == null) {
      const at = ig?.posted ?? rel?.at;
      return at ? `Publicada el ${new Date(at).toLocaleDateString('es', {day: 'numeric', month: 'short'}).replace('.', '')}` : 'Publicada';
    }
    const ratio = ig.ratio == null ? '' : ` · ${ig.ratio.toLocaleString('es', {maximumFractionDigits: 1})}×`;
    return `${compactNum.format(ig.views)} vistas${ratio}`;
  }
  if (rel?.state === 'publishing') return 'Publicándose…';
  if (rel?.state === 'scheduled') return rel.at ? `Sale ${outOn(new Date(rel.at))}` : 'Programada';
  const size = table ? '' : r.kind === 'carousel' ? (r.slideCount ? `${r.slideCount} láminas` : '') : r.seconds > 0 ? fmtTime(r.seconds) : '';
  const extra = size ? ` · ${size}` : '';
  if (rel?.state === 'ready') return `Lista para publicar${extra}`;
  const next = r.progress.find((p) => !p.done);
  if (!next) return size || null;
  // "Falta voz", "Faltan láminas": plural when the step's first word is.
  const plural = /s$/i.test(next.label.split(' ')[0]);
  return `${plural ? 'Faltan' : 'Falta'} ${next.label.toLowerCase()}${extra}`;
}

// "hoy 9:00", "mañana 18:30", "jue 9:00" within the week, "20 nov" beyond.
export function outOn(d: Date) {
  const time = d.toLocaleTimeString('es', {hour: 'numeric', minute: '2-digit'});
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date())) / 86400000);
  if (days === 0) return `hoy ${time}`;
  if (days === 1) return `mañana ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString('es', {weekday: 'short'}).replace('.', '')} ${time}`;
  return d.toLocaleDateString('es', {day: 'numeric', month: 'short'}).replace('.', '');
}

// Its mark, like the sidebar's: Instagram's glyph once out, the calendar while scheduled, else the progress ring.
export function StageIcon({r, className}: {r: StageInput; className?: string}) {
  if (r.instagram || r.release?.state === 'published') return <InstagramGlyph className={cn('size-4 text-pink-400', className)} />;
  if (r.release?.state === 'scheduled') return <CalendarClock className={cn('size-4 text-sky-600 dark:text-sky-400', className)} />;
  if (r.release?.state === 'publishing') return <Loader2 className={cn('size-4 animate-spin text-amber-600 dark:text-amber-400', className)} />;
  return r.progress.length ? <ReelProgressRing steps={r.progress} className={className} /> : null;
}

// Instagram's glyph: a rounded square, a lens and the flash dot.
export function InstagramGlyph({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
