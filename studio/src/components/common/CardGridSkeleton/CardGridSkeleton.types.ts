export interface CardGridSkeletonProps {
  /** Cuántas tarjetas (por defecto 8). */
  count?: number;
  /** Clases de la rejilla; se mezclan con la por defecto (auto-fill de 240px). */
  className?: string;
  /** Clases de la imagen de cada tarjeta (por defecto aspect-[3/4]). */
  mediaClassName?: string;
  /** Barra de progreso fina bajo el texto, como en la Biblioteca (por defecto sí). */
  progress?: boolean;
  /** false si va dentro de otro skeleton que ya anuncia la carga (p.ej. PageSkeleton). */
  announce?: boolean;
}
