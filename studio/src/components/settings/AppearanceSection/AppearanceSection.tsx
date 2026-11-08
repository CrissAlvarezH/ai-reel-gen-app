import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {useAppearanceSection} from './AppearanceSection.hook';
import * as s from './AppearanceSection.styles';
import type {AppearanceSectionProps} from './AppearanceSection.types';

// Ajustes → Apariencia: the theme, as three tiles with a little drawing of each (like GitHub's).
export default function AppearanceSection({className}: AppearanceSectionProps) {
  const {options, choose} = useAppearanceSection();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Tema</CardTitle>
        <CardDescription>Cómo se ve Reel Studio en este equipo. No cambia tus videos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Tema" className={s.grid}>
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={o.selected} onClick={(e) => choose(o.id, e)} className={cn(s.tile, o.selected ? s.tileOn : s.tileOff)}>
              <span className={s.preview} aria-hidden>
                {o.panes.map((p, i) => (
                  <span key={i} className={cn(s.pane, p.root)}>
                    <span className={cn(s.paneSide, p.side)}>
                      <span className={cn(s.dot, p.accent)} />
                      <span className={cn(s.bar, p.line)} />
                      <span className={cn(s.bar, p.line)} />
                    </span>
                    <span className={s.paneMain}>
                      <span className={cn(s.title, p.strong)} />
                      <span className={cn(s.line, p.line)} />
                      <span className={cn(s.lineShort, p.line)} />
                      <span className={cn(s.button, p.accent)} />
                    </span>
                  </span>
                ))}
              </span>
              <span className={s.footer}>
                <span className={cn(s.radio, o.selected ? s.radioOn : s.radioOff)}>{o.selected && <span className={s.radioDot} />}</span>
                <span className={s.text}>
                  <span className={s.label}>
                    <o.icon className={s.icon} /> {o.label}
                  </span>
                  <span className={s.description}>{o.description}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
