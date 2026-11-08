/** 0..n-1, for rendering n placeholder slots. */
export const slots = (n: number) => Array.from({length: n}, (_, i) => i);

/** Every fourth line of a paragraph ends short, like real text. */
export const isShort = (i: number) => i % 4 === 3;
