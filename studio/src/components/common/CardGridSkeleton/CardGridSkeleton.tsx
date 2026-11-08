import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import * as s from './CardGridSkeleton.styles';
import type {CardGridSkeletonProps} from './CardGridSkeleton.types';
import {slots} from './CardGridSkeleton.utils';

export default function CardGridSkeleton({count = 8, className, mediaClassName, progress = true, announce = true}: CardGridSkeletonProps) {
  return (
    <div role={announce ? 'status' : undefined} aria-live={announce ? 'polite' : undefined} className={cn(s.grid, className)}>
      {announce && <span className="sr-only">Cargando…</span>}
      {slots(count).map((i) => (
        <div key={i} className={s.card}>
          <Skeleton className={cn(s.media, mediaClassName)} />
          <div className={s.body}>
            <Skeleton className={s.title} />
            <Skeleton className={s.line} />
            {progress && <Skeleton className={s.bar} />}
          </div>
        </div>
      ))}
    </div>
  );
}
