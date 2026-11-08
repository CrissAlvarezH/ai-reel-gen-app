import {cn} from '@/lib/utils';
import * as s from './EmptyState.styles';
import type {EmptyStateProps} from './EmptyState.types';

export default function EmptyState({icon: Icon, title, description, action, className}: EmptyStateProps) {
  return (
    <div className={cn(s.box, className)}>
      <div className={s.inner}>
        <div className={s.badge}>
          <Icon className={s.icon} />
        </div>
        <div>
          <h2 className={s.title}>{title}</h2>
          {description && <p className={s.description}>{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
