import {cva} from 'class-variance-authority';

// A wide invisible grab area over the edge, with a thin line that lights up purple on hover and while dragging.
export const handle = cva('group absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none md:block', {
  variants: {
    edge: {
      left: '-left-1.5',
      right: '-right-1.5',
    },
  },
});

export const line =
  'mx-auto h-full w-px bg-transparent transition-all duration-200 group-hover:w-0.5 group-hover:bg-primary/60 group-active:w-0.5 group-active:bg-primary';

// A small grip in the middle, visible on hover, so the edge reads as draggable.
export const grip =
  'pointer-events-none absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow-[0_0_12px_var(--primary)] transition-opacity duration-200 group-hover:opacity-80 group-active:opacity-100';
