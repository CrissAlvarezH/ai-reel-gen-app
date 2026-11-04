import {useState} from 'react';
import {ChevronRight, Loader2} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {fmtTime} from './api';
import type {ReelAnalysis, ReelTranscript} from '../shared/types';

// A reel's analysis as the agent wrote it (analysis.json), its transcript and its frames: the same in
// Inspiración (other accounts' reels) and Mi cuenta (his own).

export type ReelState = 'pending' | 'queued' | 'processing' | 'processed' | 'analyzing' | 'ready' | 'error';

// A reel's state in the tables of Inspiración and Mi cuenta: nothing for analysed ones; not transcribed yet
// (pending) and transcribed but not analysed (processed) are both "Sin analizar", like their Estado filter.
export function StateBadge({r}: {r: {state: ReelState; error: string | null}}) {
  if (r.state === 'ready') return null;
  if (r.state === 'error')
    return (
      <Badge variant="destructive" title={r.error ?? ''}>
        Error
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      {(r.state === 'processing' || r.state === 'analyzing') && <Loader2 className="size-3 animate-spin" />}
      {{pending: 'Sin analizar', queued: 'En cola', processing: 'Procesando', processed: 'Sin analizar', analyzing: 'Analizando'}[r.state]}
    </Badge>
  );
}

export function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

// Hook, structure, visual devices, call to action and the takeaways (titled for what they are on each page).
export function AnalysisSections({a, takeaways}: {a: ReelAnalysis; takeaways: string}) {
  return (
    <>
      <Section title="Gancho (0–3 s)">
        <p className="font-medium">«{a.hook.text}»</p>
        <p className="text-muted-foreground">{a.hook.visual}</p>
        <p>{a.hook.why}</p>
      </Section>
      {a.structure.length > 0 && (
        <Section title="Estructura">
          <ol className="flex flex-col gap-1.5">
            {a.structure.map((s, i) => (
              <li key={i} className="grid grid-cols-[88px_76px_minmax(0,1fr)] items-baseline gap-2">
                <Badge variant="outline" className="justify-self-start font-normal">
                  {s.tag}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {fmtTime(s.start)}–{fmtTime(s.end)}
                </span>
                <span>{s.summary}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {a.visuals.length > 0 && (
        <Section title="Recursos visuales">
          <ul className="list-disc space-y-1 pl-5">
            {a.visuals.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Llamada a la acción">
        <p className={a.cta ? '' : 'text-muted-foreground'}>{a.cta ?? 'Ninguna'}</p>
      </Section>
      {a.takeaways.length > 0 && (
        <Section title={takeaways}>
          <ul className="list-disc space-y-1 pl-5">
            {a.takeaways.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// The transcript, folded until he asks for it.
export function TranscriptSection({t}: {t: ReelTranscript}) {
  const [show, setShow] = useState(false);
  return (
    <Section title="Transcripción">
      {t.noAudio ? (
        <p className="text-muted-foreground">El video no tiene audio.</p>
      ) : !t.segments.length ? (
        <p className="text-muted-foreground">No se detectó voz.</p>
      ) : show ? (
        <ol className="flex flex-col gap-1">
          {t.segments.map((s, i) => (
            <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">{fmtTime(s.start)}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <button type="button" className="self-start text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShow(true)}>
          Ver la transcripción ({t.words} palabras, {t.language})
        </button>
      )}
    </Section>
  );
}

// The first 3 s and the sheets at a frame per second, folded. url: where each file of the reel is served.
export function FramesSection({files, url, duration}: {files: {hook: boolean; sheets: string[]}; url: (f: string) => string; duration: number | null}) {
  const n = (files.hook ? 1 : 0) + files.sheets.length;
  if (!n) return null;
  return (
    <Collapsible className="group/frames flex flex-col gap-1.5">
      <CollapsibleTrigger className="flex items-center gap-1 self-start text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/frames:rotate-90" />
        Fotogramas
        <span className="font-normal tracking-normal normal-case">
          · {n} {n === 1 ? 'hoja' : 'hojas'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1.5">
        {files.hook && (
          <figure className="flex flex-col gap-1">
            <img src={url('hook.jpg')} alt="Los primeros 3 segundos" loading="lazy" className="w-full rounded-md" />
            <figcaption className="text-xs text-muted-foreground">Los primeros 3 s, cada 0,25 s</figcaption>
          </figure>
        )}
        {files.sheets.map((s, i) => (
          <figure key={s} className="flex flex-col gap-1">
            <img src={url(s)} alt="" loading="lazy" className="w-full rounded-md" />
            <figcaption className="text-xs text-muted-foreground">
              {fmtTime(i * 30)}–{fmtTime(Math.min((i + 1) * 30, duration ?? (i + 1) * 30))}, un fotograma por segundo
            </figcaption>
          </figure>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
