/** What the creator picked: a fixed theme, or follow the system's. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What is actually showing. */
export type ResolvedTheme = 'light' | 'dark';

/** Where the switch was triggered (a click), so the new theme can grow from there. */
export type ThemeOrigin = {x: number; y: number};

export type ThemeState = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference, origin?: ThemeOrigin) => void;
  /** Light ↔ dark (leaves "system" for a fixed theme). */
  toggle: (origin?: ThemeOrigin) => void;
};
