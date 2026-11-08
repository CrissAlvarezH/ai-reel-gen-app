// Tailwind classes for the component (this app styles with Tailwind, not styled-components).
export const root = 'flex-none md:sticky md:top-6 md:max-h-[calc(100vh-6.5rem)] md:w-56 md:overflow-y-auto md:pb-4';

// Phones: one grouped selector.
export const mobile = 'flex flex-col gap-1.5 md:hidden';
export const mobileLabel = 'text-xs font-medium text-muted-foreground';
export const select =
  'h-10 w-full rounded-lg border bg-card px-3 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// From md: the side nav, in groups.
export const nav = 'hidden flex-col md:flex';
export const heading = 'mb-3 px-3 text-2xl font-semibold tracking-tight';
export const group = 'flex flex-col gap-0.5';
export const groupSeparated = 'mt-3 border-t pt-3';
export const groupLabel = 'px-3 pb-1 text-xs font-semibold text-muted-foreground';

export const item =
  'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:transition-colors';
export const itemActive = 'bg-primary/10 font-medium text-primary before:bg-primary';
export const itemIdle = 'text-muted-foreground before:bg-transparent hover:bg-muted hover:text-foreground';
export const icon = 'size-4 flex-none';

// The active item's cards, indented, on a vertical line.
export const subList = 'animate-fade-in my-1 ml-5 flex flex-col border-l pl-2';
export const sub = 'w-full truncate rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-150';
export const subCurrent = 'text-primary';
export const subIdle = 'text-muted-foreground hover:bg-muted hover:text-foreground';
