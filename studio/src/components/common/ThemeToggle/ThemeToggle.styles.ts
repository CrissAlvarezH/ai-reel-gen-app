// Tailwind classes for the component (this app styles with Tailwind, not styled-components).
export const button =
  'relative grid size-8 place-items-center overflow-hidden rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

// Sun and moon swap with a turn and a fade.
export const icon = 'absolute size-4 transition-all duration-300 ease-out';
export const shown = 'rotate-0 scale-100 opacity-100';
export const hidden = 'scale-50 opacity-0';
export const sunHidden = '-rotate-90';
export const moonHidden = 'rotate-90';
