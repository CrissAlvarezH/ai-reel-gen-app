import type {LucideIcon} from 'lucide-react';
import type {ThemePreference} from '@/store/theme.types';

/** The classes that paint one pane of a theme's mini preview. */
export interface PreviewPalette {
  /** The pane itself: its background and border (the dark one carries the .dark class, so tokens resolve dark). */
  root: string;
  /** The little sidebar. */
  side: string;
  /** Text lines. */
  line: string;
  /** The title line. */
  strong: string;
  /** The purple bits: the active page and the button. */
  accent: string;
}

export interface ThemeOption {
  id: ThemePreference;
  label: string;
  description: string;
  icon: LucideIcon;
  /** One pane, or two (light | dark) for "Sistema". */
  panes: PreviewPalette[];
}

export interface AppearanceSectionProps {
  className?: string;
}
