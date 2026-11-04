import {chunk, WORDS} from './lib';

// Sense units, checked word for word against the transcript at load. Rewrite for each script.
export const CAPTIONS = chunk(WORDS, [
  'Tu historia empieza aquí.', 'Esto es una plantilla', 'de reel en collage de papel.',
]);
// Display text where the spoken form differs from what should be read (numbers spelled out for TTS).
export const DISPLAY: Record<string, string> = {};
