export type ListSkeletonVariant = 'rows' | 'table' | 'lines';

export interface ListSkeletonProps {
  /** rows: ícono + 2 líneas; table: tabla con cabecera y columnas; lines: párrafo de texto. */
  variant?: ListSkeletonVariant;
  /** Cuántas filas o líneas (por defecto 5). */
  count?: number;
  /** Columnas de la variante table, además de la miniatura (por defecto 4). */
  columns?: number;
  /** false si va dentro de otro skeleton que ya anuncia la carga (p.ej. PageSkeleton). */
  announce?: boolean;
  className?: string;
}
