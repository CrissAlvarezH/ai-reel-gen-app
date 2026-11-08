import {ChevronRight} from 'lucide-react';
import * as s from './SettingsHeader.styles';
import type {SettingsHeaderProps} from './SettingsHeader.types';

// The top of a settings section: "Ajustes › Grupo", its title and what it's for.
export default function SettingsHeader({group, title, description}: SettingsHeaderProps) {
  return (
    <header className={s.root}>
      <nav aria-label="Ruta" className={s.crumbs}>
        <a href="#/ajustes" className={s.crumbLink}>
          Ajustes
        </a>
        <ChevronRight className={s.chevron} aria-hidden />
        <span>{group}</span>
      </nav>
      <h2 className={s.title}>{title}</h2>
      <p className={s.description}>{description}</p>
    </header>
  );
}
