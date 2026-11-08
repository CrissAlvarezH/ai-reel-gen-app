import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';
import {CHIPS, LISTS} from './BoardSkeleton.constants';
import * as s from './BoardSkeleton.styles';
import type {BoardSkeletonProps} from './BoardSkeleton.types';
import {slots} from './BoardSkeleton.utils';

export default function BoardSkeleton({className}: BoardSkeletonProps) {
  return (
    <div role="status" aria-live="polite" className={cn(s.page, className)}>
      <span className="sr-only">Cargando…</span>
      <div className={s.chips}>
        {slots(CHIPS).map((i) => (
          <Skeleton key={i} className={s.chip} />
        ))}
      </div>
      <div className={s.lists}>
        {LISTS.map((cards, l) => (
          <div key={l} className={s.list}>
            <Skeleton className={s.listTitle} />
            {slots(cards).map((i) => (
              <Skeleton key={i} className={s.card} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
