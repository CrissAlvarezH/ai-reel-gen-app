import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import {DEFAULT_MAX_WIDTH} from './PageSkeleton.constants';
import * as s from './PageSkeleton.styles';
import type {PageSkeletonProps} from './PageSkeleton.types';

export default function PageSkeleton({maxWidth = DEFAULT_MAX_WIDTH, action = true, children, className}: PageSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={cn(s.page, maxWidth, className)}>
      <span className="sr-only">Cargando…</span>
      <div className={s.header}>
        <div className={s.heading}>
          <Skeleton className={s.title} />
          <Skeleton className={s.subtitle} />
        </div>
        {action && <Skeleton className={s.action} />}
      </div>
      {children ?? <Skeleton className={s.block} />}
    </div>
  );
}
