import {cn} from '@/lib/utils';
import {useSettingsNav} from './SettingsNav.hook';
import * as s from './SettingsNav.styles';
import type {SettingsNavProps} from './SettingsNav.types';

// Ajustes' nav, like GitHub's: sections in groups, and under the open one its cards, to jump to.
// On phones it's a grouped selector.
export default function SettingsNav({groups, active}: SettingsNavProps) {
  const {items, goTo, onSelect} = useSettingsNav(groups, active);
  return (
    <div className={s.root}>
      <label className={s.mobile}>
        <span className={s.mobileLabel}>Sección de ajustes</span>
        <select value={active} onChange={onSelect} className={s.select}>
          {items.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <nav aria-label="Ajustes" className={s.nav}>
        <h1 className={s.heading}>Ajustes</h1>
        {items.map((g, i) => (
          <div key={g.id} className={cn(s.group, i > 0 && s.groupSeparated)}>
            <p className={s.groupLabel}>{g.label}</p>
            {g.sections.map((sec) => (
              <div key={sec.id}>
                <a href={`#/ajustes/${sec.id}`} aria-current={sec.active ? 'page' : undefined} className={cn(s.item, sec.active ? s.itemActive : s.itemIdle)}>
                  <sec.icon className={s.icon} /> {sec.label}
                </a>
                {sec.active && sec.subsections.length > 0 && (
                  <ul className={s.subList}>
                    {sec.subsections.map((sub) => (
                      <li key={sub.key}>
                        <button type="button" onClick={() => goTo(sub)} className={cn(s.sub, sub.current ? s.subCurrent : s.subIdle)}>
                          {sub.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
