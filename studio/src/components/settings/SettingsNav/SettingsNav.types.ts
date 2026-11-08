import type {LucideIcon} from 'lucide-react';

/** A card (or block) inside a section, listed under the active item of the nav; a click scrolls to it. */
export interface SettingsSubsection {
  label: string;
  /** The id of the element to scroll to (a wrapper in Settings.tsx). */
  anchor: string;
  /** When the wrapper holds several cards drawn by another component: which child (0-based) is this one. */
  child?: number;
}

export interface SettingsSection {
  /** Its route: #/ajustes/<id>. */
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  subsections: SettingsSubsection[];
}

export interface SettingsGroup {
  id: string;
  label: string;
  sections: SettingsSection[];
}

export interface SettingsNavProps {
  groups: SettingsGroup[];
  /** The id of the open section. */
  active: string;
}
