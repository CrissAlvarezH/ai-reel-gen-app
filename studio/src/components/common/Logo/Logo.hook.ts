import {useId} from 'react';

// Unique gradient ids, so several logos on one page never share (or break) each other's <defs>.
export function useLogo() {
  const id = useId().replace(/:/g, '');
  return {reelGradient: `logo-reel-${id}`, sparkGradient: `logo-spark-${id}`};
}
