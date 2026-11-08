import {cn} from '@/lib/utils';
import {DEFAULT_SIZE, GRADIENT_FROM, GRADIENT_TO, NAME, PLAY, REEL, SPARK, VIEW_BOX} from './Logo.constants';
import {useLogo} from './Logo.hook';
import * as s from './Logo.styles';
import type {LogoProps} from './Logo.types';

export default function Logo({variant = 'mark', size = DEFAULT_SIZE, className}: LogoProps) {
  const {reelGradient, sparkGradient} = useLogo();
  return (
    <span className={cn(s.root, className)}>
      <svg width={size} height={size} viewBox={VIEW_BOX} className={s.mark} role="img" aria-label={NAME} aria-hidden={variant === 'full' || undefined}>
        <defs>
          <linearGradient id={reelGradient} x1="6" y1="6" x2="28" y2="45" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={GRADIENT_FROM} />
            <stop offset="1" stopColor={GRADIENT_TO} />
          </linearGradient>
          <linearGradient id={sparkGradient} x1="30.5" y1="1.5" x2="45.5" y2="16.5" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={GRADIENT_TO} />
            <stop offset="1" stopColor={GRADIENT_FROM} />
          </linearGradient>
        </defs>
        <rect {...REEL} fill={`url(#${reelGradient})`} />
        <path d={PLAY} fill="#fff" />
        <path d={SPARK} fill={`url(#${sparkGradient})`} />
      </svg>
      {variant === 'full' && <span className={s.name}>{NAME}</span>}
    </span>
  );
}
