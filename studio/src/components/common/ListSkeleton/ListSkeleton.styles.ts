// Tailwind classes for the component (this app styles with Tailwind, not styled-components).
export const list = 'flex flex-col gap-3';
export const row = 'flex items-center gap-3 rounded-lg border bg-card p-3';
export const avatar = 'shimmer size-10 flex-none rounded-full';
export const text = 'flex min-w-0 flex-1 flex-col gap-1.5';
export const rowTitle = 'shimmer h-4 w-1/3';
export const rowLine = 'shimmer h-3 w-2/3';

export const table = 'overflow-hidden rounded-lg border';
export const tableRow = 'flex items-center gap-4 border-b px-3 py-2 last:border-b-0';
export const tableHead = 'flex items-center gap-4 border-b bg-muted/30 px-3 py-3';
export const thumb = 'shimmer h-14 w-8 flex-none rounded-sm';
export const thumbHead = 'w-8 flex-none';
export const main = 'flex min-w-0 flex-[3] flex-col gap-1.5';
export const cell = 'shimmer h-3 flex-1';
export const headCell = 'shimmer h-3 flex-1 opacity-60';

export const lines = 'flex flex-col gap-2.5';
export const lineLong = 'shimmer h-3.5 w-full';
export const lineShort = 'shimmer h-3.5 w-2/3';

export const container = {rows: list, table, lines} as const;
