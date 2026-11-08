import {cva} from 'class-variance-authority';

// A wide invisible grab area over the edge, with a thin line that shows faintly on hover and while dragging.
export const handle = cva('group absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none md:block', {
  variants: {
    edge: {
      left: '-left-1.5',
      right: '-right-1.5',
    },
  },
});

export const line = 'mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-foreground/30 group-active:bg-foreground/50';
