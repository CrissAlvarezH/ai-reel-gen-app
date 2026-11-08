import {create} from 'zustand';
import {read, write} from './storage';
import type {ResolvedTheme, ThemeOrigin, ThemePreference, ThemeState} from './theme.types';

// Light/dark theme: the .dark class on <html> (index.css). index.html applies the saved one before the first
// paint, so the page doesn't flash; this store keeps it in sync afterwards, also when the system's changes.
// A switch animates with the View Transitions API: the new theme grows as a circle from where you clicked
// (or from the centre), over a snapshot of the old one.
export const THEME_KEY = 'studio.theme';

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const resolve = (p: ThemePreference): ResolvedTheme => (p === 'system' ? (media()?.matches ? 'dark' : 'light') : p);

const saved = (): ThemePreference => {
  const v = read(THEME_KEY, 'system');
  return v === 'light' || v === 'dark' ? v : 'system';
};

function setClass(t: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');
  root.style.colorScheme = t;
}

function apply(t: ResolvedTheme, origin?: ThemeOrigin) {
  const root = document.documentElement;
  if (root.classList.contains('dark') === (t === 'dark')) return;
  const start = (document as Document & {startViewTransition?: (cb: () => void) => {ready: Promise<void>}}).startViewTransition;
  if (!start || reducedMotion()) {
    setClass(t);
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  // No CSS transitions inside the new snapshot: every colour is already final when it's taken.
  root.classList.add('theme-switching');
  const vt = start.call(document, () => setClass(t));
  vt.ready
    .then(() =>
      root.animate(
        {clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`]},
        {duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)'},
      ).finished,
    )
    .catch(() => {})
    .finally(() => root.classList.remove('theme-switching'));
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  preference: saved(),
  resolved: resolve(saved()),
  setPreference: (p, origin) => {
    write(THEME_KEY, p);
    const resolved = resolve(p);
    apply(resolved, origin);
    set({preference: p, resolved});
  },
  toggle: (origin) => get().setPreference(get().resolved === 'dark' ? 'light' : 'dark', origin),
}));

// Follow the system while the preference is "system".
media()?.addEventListener('change', () => {
  if (useThemeStore.getState().preference !== 'system') return;
  const resolved = resolve('system');
  apply(resolved);
  useThemeStore.setState({resolved});
});
