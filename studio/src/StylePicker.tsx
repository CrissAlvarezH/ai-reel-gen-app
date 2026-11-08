import {useEffect, useState} from 'react';
import {Check} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import {api, type Style} from './api';
import {Poster} from './Styles';

// Choose a video's visual style (styles/<id>). Styles without their own skill and template can be chosen
// too: Claude builds their look from the style.json.
export function useStyles() {
  const [styles, setStyles] = useState<Style[] | null>(null);
  useEffect(() => {
    api.styles().then(setStyles, () => setStyles([]));
  }, []);
  return styles;
}

// All the styles as cards in a dialog, to change a video's style. The current one is marked.
export function StyleDialog({open, onOpenChange, current, onPick}: {open: boolean; onOpenChange: (o: boolean) => void; current: string | null; onPick: (id: string) => void}) {
  const styles = useStyles();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cambiar estilo</DialogTitle>
          <DialogDescription>Elige cómo se va a ver el video. El agente lo verá en tu próximo mensaje.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {styles?.map((s) => {
            const isCurrent = s.id === current;
            const ready = !!(s.skill && s.template);
            return (
              <button
                key={s.id}
                onClick={() => (isCurrent ? onOpenChange(false) : onPick(s.id))}
                className={cn('flex gap-3 rounded-lg border p-3 text-left transition-colors hover:border-foreground/40 hover:bg-muted/40', isCurrent && 'border-foreground/60 bg-muted/40')}
              >
                <div className="flex h-28 flex-none gap-1 overflow-hidden rounded-md">
                  {s.examples.length ? <img src={s.examples[0]} alt="" loading="lazy" className="h-full w-auto rounded-sm" /> : <Poster style={s} className="h-full text-[9px]" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                    {s.name}
                    {isCurrent && (
                      <Badge>
                        <Check /> Actual
                      </Badge>
                    )}
                    {!ready && <Badge variant="outline">Sin plantilla</Badge>}
                  </span>
                  <span className="line-clamp-3 text-xs text-muted-foreground">{s.summary}</span>
                  <span className="mt-auto flex gap-1 pt-1">
                    {s.palette.map((c) => (
                      <span key={c.hex} title={`${c.name}: ${c.meaning}`} className="size-3 rounded-full border border-foreground/15" style={{background: c.hex}} />
                    ))}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
