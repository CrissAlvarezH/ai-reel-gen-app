import type {MouseEvent} from 'react';
import {useThemeStore} from '@/store/useThemeStore';

export function useThemeToggle() {
  const resolved = useThemeStore((s) => s.resolved);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const dark = resolved === 'dark';
  const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  // The new theme grows from the button's centre.
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    toggleTheme({x: r.left + r.width / 2, y: r.top + r.height / 2});
  };
  return {dark, label, toggle};
}
