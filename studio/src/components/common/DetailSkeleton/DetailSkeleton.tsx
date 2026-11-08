import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import {SCRIPT_LINES} from './DetailSkeleton.constants';
import * as s from './DetailSkeleton.styles';
import type {DetailSkeletonProps} from './DetailSkeleton.types';

export default function DetailSkeleton({className}: DetailSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={cn(s.page, className)}>
      <span className="sr-only">Cargando…</span>
      <Skeleton className={s.review} />
      <Skeleton className={s.review} />
      <div className={s.columns}>
        <Skeleton className={s.player} />
        <div className={s.script}>
          <Skeleton className={s.scriptTitle} />
          {SCRIPT_LINES.map((short, i) => (
            <Skeleton key={i} className={short ? s.lineShort : s.lineLong} />
          ))}
        </div>
      </div>
      <Skeleton className={s.footer} />
    </div>
  );
}
