import {cn} from '@/lib/utils';
import {DEFAULT_SIZE, NAME, PLAY, REEL, SPARK, VIEW_BOX} from './Logo.constants';
import * as s from './Logo.styles';
import type {LogoProps} from './Logo.types';

// In the text's colour (black on light, white on dark), with the play cut out in the background's.
export default function Logo({variant = 'mark', size = DEFAULT_SIZE, className}: LogoProps) {
  return (
    <span className={cn(s.root, className)}>
      <svg width={size} height={size} viewBox={VIEW_BOX} className={s.mark} role="img" aria-label={NAME} aria-hidden={variant === 'full' || undefined}>
        <rect {...REEL} fill="currentColor" />
        <path d={PLAY} fill="var(--background)" />
        <path d={SPARK} fill="currentColor" />
      </svg>
      {variant === 'full' && <span className={s.name}>{NAME}</span>}
    </span>
  );
}
