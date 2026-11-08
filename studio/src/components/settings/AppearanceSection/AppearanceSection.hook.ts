import type {MouseEvent} from 'react';
import type {ThemePreference} from '@/store/theme.types';
import {useThemeStore} from '@/store/useThemeStore';
import {THEME_OPTIONS} from './AppearanceSection.constants';

export function useAppearanceSection() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const options = THEME_OPTIONS.map((o) => ({...o, selected: o.id === preference}));
  // The new theme grows from where the tile was clicked.
  const choose = (id: ThemePreference, e: MouseEvent<HTMLElement>) => setPreference(id, {x: e.clientX, y: e.clientY});
  return {options, choose};
}
