import {Monitor, Moon, Sun} from 'lucide-react';
import type {PreviewPalette, ThemeOption} from './AppearanceSection.types';

// The light preview is painted with explicit colours (only here): with the app in dark mode, the tokens would
// resolve dark. The dark one uses the tokens under a .dark wrapper, so it always shows the real dark theme.
const LIGHT: PreviewPalette = {
  root: 'border-zinc-200 bg-white',
  side: 'border-zinc-200 bg-zinc-100',
  line: 'bg-zinc-200',
  strong: 'bg-zinc-700',
  accent: 'bg-violet-600',
};

const DARK: PreviewPalette = {
  root: 'dark border-border bg-background',
  side: 'border-border bg-card',
  line: 'bg-muted',
  strong: 'bg-foreground/80',
  accent: 'bg-primary',
};

export const THEME_OPTIONS: ThemeOption[] = [
  {id: 'light', label: 'Claro', description: 'Fondo blanco, siempre.', icon: Sun, panes: [LIGHT]},
  {id: 'dark', label: 'Oscuro', description: 'Fondo oscuro, siempre.', icon: Moon, panes: [DARK]},
  {id: 'system', label: 'Sistema', description: 'Sigue el tema de tu equipo.', icon: Monitor, panes: [LIGHT, DARK]},
];
