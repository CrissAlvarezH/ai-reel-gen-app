export type LogoVariant = 'mark' | 'full';

export interface LogoProps {
  /** mark = only the symbol; full = symbol + "Reel Studio". */
  variant?: LogoVariant;
  /** Size of the symbol in px. */
  size?: number;
  className?: string;
}
