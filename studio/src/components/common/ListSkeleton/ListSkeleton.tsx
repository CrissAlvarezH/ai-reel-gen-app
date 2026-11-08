import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import * as s from './ListSkeleton.styles';
import type {ListSkeletonProps} from './ListSkeleton.types';
import {isShort, slots} from './ListSkeleton.utils';

export default function ListSkeleton({variant = 'rows', count = 5, columns = 4, announce = true, className}: ListSkeletonProps) {
  return (
    <div role={announce ? 'status' : undefined} aria-live={announce ? 'polite' : undefined} className={cn(s.container[variant], className)}>
      {announce && <span className="sr-only">Cargando…</span>}
      {variant === 'table' && (
        <div className={s.tableHead}>
          <span className={s.thumbHead} />
          <Skeleton className={cn(s.headCell, 'flex-[3]')} />
          {slots(columns).map((c) => (
            <Skeleton key={c} className={s.headCell} />
          ))}
        </div>
      )}
      {slots(count).map((i) =>
        variant === 'table' ? (
          <div key={i} className={s.tableRow}>
            <Skeleton className={s.thumb} />
            <div className={s.main}>
              <Skeleton className={s.rowTitle} />
              <Skeleton className={s.rowLine} />
            </div>
            {slots(columns).map((c) => (
              <Skeleton key={c} className={s.cell} />
            ))}
          </div>
        ) : variant === 'lines' ? (
          <Skeleton key={i} className={isShort(i) ? s.lineShort : s.lineLong} />
        ) : (
          <div key={i} className={s.row}>
            <Skeleton className={s.avatar} />
            <div className={s.text}>
              <Skeleton className={s.rowTitle} />
              <Skeleton className={s.rowLine} />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
