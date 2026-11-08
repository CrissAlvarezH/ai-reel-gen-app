import type {ReactNode} from 'react';

export interface PageSkeletonProps {
  /** Ancho máximo de la página, como en su <main> (por defecto max-w-7xl). */
  maxWidth?: string;
  /** Muestra el hueco del botón de la cabecera, a la derecha (por defecto sí). */
  action?: boolean;
  /** Lo que va bajo la cabecera; sin él, un bloque. */
  children?: ReactNode;
  className?: string;
}
