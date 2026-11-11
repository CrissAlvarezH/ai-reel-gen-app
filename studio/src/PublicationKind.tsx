// What a publication is (a video or a carousel), as the Biblioteca, its table and the sidebar show it: one icon each
// (film for a video, stacked slides for a carousel), named for screen readers and on hover, and where each one opens.
import {Film, GalleryHorizontalEnd, type LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {PublicationKind} from './api';

export const KIND: Record<PublicationKind, {icon: LucideIcon; label: string; new: string; href: string}> = {
  video: {icon: Film, label: 'Video', new: 'Nuevo video', href: '#/nuevo'},
  carousel: {icon: GalleryHorizontalEnd, label: 'Carrusel', new: 'Nuevo carrusel', href: '#/nuevo-carrusel'},
};
export const NEW_KINDS: PublicationKind[] = ['video', 'carousel'];

// A publication's own page: a video's player, or a carousel's slides.
export const publicationHref = (kind: PublicationKind | undefined, slug: string) => (kind === 'carousel' ? `#/carrusel/${slug}` : `#/reel/${slug}`);

export function KindIcon({kind, className}: {kind: PublicationKind; className?: string}) {
  const k = KIND[kind] ?? KIND.video;
  return (
    <span role="img" aria-label={k.label} title={k.label} className={cn('inline-flex flex-none', className)}>
      <k.icon className="size-full" aria-hidden />
    </span>
  );
}
