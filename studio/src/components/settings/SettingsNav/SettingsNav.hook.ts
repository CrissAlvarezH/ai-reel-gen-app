import {useEffect, useState, type ChangeEvent} from 'react';
import type {SettingsGroup, SettingsSubsection} from './SettingsNav.types';

const keyOf = (s: SettingsSubsection) => `${s.anchor}:${s.child ?? ''}`;

// Where a subsection is on the page: its wrapper, or one of the wrapper's cards.
function target(s: SettingsSubsection) {
  const el = document.getElementById(s.anchor);
  if (!el || s.child == null) return el;
  return (el.children[s.child] as HTMLElement | undefined) ?? el;
}

export function useSettingsNav(groups: SettingsGroup[], active: string) {
  // The subsection last clicked, highlighted until the section changes.
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => setCurrent(null), [active]);

  const goTo = (s: SettingsSubsection) => {
    setCurrent(keyOf(s));
    target(s)?.scrollIntoView({behavior: 'smooth', block: 'start'});
  };

  // Phones: the <select> moves between sections.
  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    location.hash = `#/ajustes/${e.target.value}`;
  };

  const items = groups.map((g) => ({
    ...g,
    sections: g.sections.map((s) => ({
      ...s,
      active: s.id === active,
      subsections: s.subsections.map((sub) => ({...sub, key: keyOf(sub), current: keyOf(sub) === current})),
    })),
  }));

  return {items, goTo, onSelect};
}
