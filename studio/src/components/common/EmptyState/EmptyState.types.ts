import type {LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Un botón o enlace bajo el texto. */
  action?: ReactNode;
  className?: string;
}
