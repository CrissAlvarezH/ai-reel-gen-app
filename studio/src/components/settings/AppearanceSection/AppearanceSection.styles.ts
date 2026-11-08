// Tailwind classes for the component (this app styles with Tailwind, not styled-components).
export const grid = 'grid gap-3 sm:grid-cols-3';

export const tile =
  'group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const tileOn = 'border-primary ring-2 ring-primary/40';
export const tileOff = 'hover:border-primary/40';

export const preview = 'flex h-28 gap-1.5 border-b bg-muted/40 p-2.5';
export const pane = 'flex min-w-0 flex-1 overflow-hidden rounded-md border shadow-sm';
export const paneSide = 'flex w-1/3 flex-none flex-col gap-1 border-r p-1.5';
export const paneMain = 'flex min-w-0 flex-1 flex-col gap-1.5 p-2';
export const dot = 'h-1.5 w-full rounded-full';
export const bar = 'h-1 w-full rounded-full';
export const title = 'h-1.5 w-3/4 rounded-full';
export const line = 'h-1 w-full rounded-full';
export const lineShort = 'h-1 w-2/3 rounded-full';
export const button = 'mt-auto h-2.5 w-1/2 rounded-sm';

export const footer = 'flex items-start gap-2.5 p-3';
export const radio = 'mt-0.5 grid size-4 flex-none place-items-center rounded-full border transition-colors';
export const radioOn = 'border-primary';
export const radioOff = 'border-muted-foreground/50';
export const radioDot = 'size-2 rounded-full bg-primary';
export const label = 'flex items-center gap-1.5 text-sm font-medium';
export const icon = 'size-3.5 text-muted-foreground';
export const description = 'text-xs text-muted-foreground';
export const text = 'flex min-w-0 flex-col gap-0.5';
