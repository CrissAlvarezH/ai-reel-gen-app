import {Moon, Sun} from 'lucide-react';
import {cn} from '@/lib/utils';
import {useThemeToggle} from './ThemeToggle.hook';
import * as s from './ThemeToggle.styles';
import type {ThemeToggleProps} from './ThemeToggle.types';

export default function ThemeToggle({className}: ThemeToggleProps) {
  const {dark, label, toggle} = useThemeToggle();
  return (
    <button type="button" onClick={toggle} title={label} aria-label={label} className={cn(s.button, className)}>
      <Sun className={cn(s.icon, dark ? [s.hidden, s.sunHidden] : s.shown)} />
      <Moon className={cn(s.icon, dark ? s.shown : [s.hidden, s.moonHidden])} />
    </button>
  );
}
