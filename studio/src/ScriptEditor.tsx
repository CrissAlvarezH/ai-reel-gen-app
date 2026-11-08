import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {EditorState, StateEffect, StateField, type Text, type Transaction} from '@codemirror/state';
import {Decoration, EditorView, GutterMarker, gutter, keymap, type DecorationSet} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {BEAT_TAGS, type Beat, type BeatTag, type Word} from '../shared/types';
import {fmtTime} from './api';

// The script editor: plain text, one line per block (exactly what goes to the voice), with the
// structure in a gutter. A part starts at a tagged line and runs until the next tag; its lines get
// the tag's colour on the left. Tags live in audio/beats.json, never in vo.txt.

// CodeMirror's state lives outside React: a hot update would leave the open editor with the old
// module's fields (tags stop working until a reload). Reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

// Colours are CSS variables (index.css, --beat-*): lighter on the dark theme, deeper on the light one.
export const BEATS: Record<BeatTag, {label: string; color: string; hint: string}> = {
  hook: {label: 'Hook', color: 'var(--beat-hook)', hint: '0–3 s: lo que está en juego'},
  contexto: {label: 'Contexto', color: 'var(--beat-contexto)', hint: 'Responde al hook o sube lo que está en juego'},
  rehook: {label: 'Re-hook', color: 'var(--beat-rehook)', hint: 'Un giro que reengancha'},
  desarrollo: {label: 'Desarrollo', color: 'var(--beat-desarrollo)', hint: 'La explicación'},
  ejemplo: {label: 'Ejemplo', color: 'var(--beat-ejemplo)', hint: 'Un caso, analogía o demo'},
  payoff: {label: 'Payoff', color: 'var(--beat-payoff)', hint: 'Cumple la promesa del hook'},
  cta: {label: 'CTA', color: 'var(--beat-cta)', hint: 'Seguir, guardar, comentar'},
  cierre: {label: 'Cierre', color: 'var(--beat-cierre)', hint: 'El remate final'},
};

export type ScriptValue = {text: string; beats: Beat[]};

/* ───── Where each tag sits: a line start, mapped through edits ───── */

type Mark = {from: number; tag: BeatTag};
const setMark = StateEffect.define<{from: number; tag: BeatTag | null}>();
const resetMarks = StateEffect.define<Mark[]>();

function remap(marks: Mark[], tr: Transaction): Mark[] {
  const old = tr.startState.doc;
  const doc = tr.state.doc;
  const byPos = new Map<number, {tag: BeatTag; old: number}>();
  for (const m of marks) {
    // A line that disappeared (its text and its line break deleted) takes its tag with it.
    const line = old.lineAt(m.from);
    let gone = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if ((fromA <= line.from && toA > line.to) || (fromA < line.from && toA >= line.to)) gone = true;
    });
    if (gone) continue;
    // assoc -1: typing at the very start of a line keeps the tag on that line.
    let p = tr.changes.mapPos(m.from, -1);
    let at = doc.lineAt(p);
    if (at.from !== p) continue; // merged into the line above: that line keeps its own tag
    // Enter at the start of a tagged line leaves an empty line above: the tag follows the text.
    while (!at.text.trim() && at.number < doc.lines) at = doc.line(at.number + 1);
    p = at.from;
    const prev = byPos.get(p);
    if (!prev || m.from > prev.old) byPos.set(p, {tag: m.tag, old: m.from});
  }
  return [...byPos].sort((a, b) => a[0] - b[0]).map(([from, {tag}]) => ({from, tag}));
}

const marksField = StateField.define<Mark[]>({
  create: () => [],
  update(marks, tr) {
    let next = tr.docChanged ? remap(marks, tr) : marks;
    for (const e of tr.effects) {
      if (e.is(resetMarks)) next = e.value;
      if (e.is(setMark)) {
        next = next.filter((m) => m.from !== e.value.from);
        if (e.value.tag) next = [...next, {from: e.value.from, tag: e.value.tag}].sort((a, b) => a.from - b.from);
      }
    }
    return next;
  },
});

// An editor built by an older copy of this module (hot reload in development) has no field: no tags.
const NONE: Mark[] = [];
const marksOf = (state: EditorState) => state.field(marksField, false) ?? NONE;

// Tags → marks: find each tag's line again by its text (exact first, then by how it starts).
const key = (s: string) => s.trim().toLowerCase().slice(0, 40);
function marksFor(doc: Text, beats: Beat[]): Mark[] {
  const out: Mark[] = [];
  let from = 1;
  for (const b of beats) {
    let hit = 0;
    for (const exact of [true, false]) {
      for (let n = from; n <= doc.lines && !hit; n++) {
        const t = doc.line(n).text;
        if (t.trim() && (exact ? t.trim() === b.line.trim() : key(t) === key(b.line))) hit = n;
      }
      if (hit) break;
    }
    if (!hit) continue;
    out.push({from: doc.line(hit).from, tag: b.tag});
    from = hit + 1;
  }
  return out;
}
const beatsFor = (state: EditorState): Beat[] => marksOf(state).map((m) => ({tag: m.tag, line: state.doc.lineAt(m.from).text}));

/* ───── Gutter chips and coloured lines ───── */

class Chip extends GutterMarker {
  tag: BeatTag;
  constructor(tag: BeatTag) {
    super();
    this.tag = tag;
  }
  eq(o: GutterMarker) {
    return o instanceof Chip && o.tag === this.tag;
  }
  toDOM() {
    const b = BEATS[this.tag];
    const el = document.createElement('span');
    el.className = 'cm-beat-chip';
    el.textContent = b.label;
    el.style.color = b.color;
    el.style.background = `color-mix(in oklab, ${b.color} 16%, transparent)`;
    return el;
  }
}
class AddChip extends GutterMarker {
  eq(o: GutterMarker) {
    return o instanceof AddChip;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-beat-add';
    el.textContent = '+ etiqueta';
    return el;
  }
}
const addChip = new AddChip();

function lineColors(state: EditorState): DecorationSet {
  const marks = marksOf(state);
  const ranges = [];
  let mi = 0;
  let tag: BeatTag | null = null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    while (mi < marks.length && marks[mi].from <= line.from) tag = marks[mi++].tag;
    if (tag && line.text.trim()) ranges.push(Decoration.line({attributes: {style: `--beat: ${BEATS[tag].color}`}, class: 'cm-beat-line'}).range(line.from));
  }
  return Decoration.set(ranges);
}

const theme = EditorView.theme(
  {
    '&': {fontSize: '15px', backgroundColor: 'transparent', height: '100%'},
    '&.cm-focused': {outline: 'none'},
    '.cm-scroller': {fontFamily: 'inherit', lineHeight: '1.65', overflow: 'auto'},
    '.cm-content': {padding: '10px 0', caretColor: 'var(--foreground)'},
    '.cm-line': {padding: '3px 14px 7px 12px', borderLeft: '3px solid transparent'},
    '.cm-beat-line': {borderLeftColor: 'var(--beat)'},
    '.cm-gutters': {backgroundColor: 'transparent', border: 'none', color: 'inherit'},
    '.cm-beats .cm-gutterElement': {padding: '3px 4px 0 10px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end'},
    '.cm-beat-chip': {fontSize: '11px', fontWeight: '500', lineHeight: '1', padding: '5px 7px', borderRadius: '6px', whiteSpace: 'nowrap', marginTop: '2px'},
    '.cm-beat-add': {fontSize: '11px', lineHeight: '1', padding: '5px 7px', marginTop: '2px', borderRadius: '6px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)', opacity: '0', border: '1px dashed var(--border)'},
    '.cm-gutterElement:hover .cm-beat-add': {opacity: '1'},
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {backgroundColor: 'color-mix(in oklab, var(--foreground) 22%, transparent)'},
  },
  {dark: true},
);

/* ───── Timing: real from the voice when it matches, else estimated ───── */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9']/g, '');
const tokens = (t: string) => t.split(/\s+/).map(norm).filter(Boolean);
export type Part = {tag: BeatTag | null; start: number; end: number; words: number};

// The index of each line that starts a part, with its tag.
function tagsByLine(value: ScriptValue) {
  const doc = EditorState.create({doc: value.text}).doc;
  return new Map(marksFor(doc, value.beats).map((m) => [doc.lineAt(m.from).number - 1, m.tag]));
}

// The script to paste elsewhere: each part under its name, "[hook]\n…\n\n[contexto]\n…".
export function taggedScript(value: ScriptValue) {
  const starts = tagsByLine(value);
  const out: string[] = [];
  value.text.split('\n').forEach((line, i) => {
    const tag = starts.get(i);
    if (tag) {
      while (out.length && !out.at(-1)!.trim()) out.pop();
      if (out.length) out.push('');
      out.push(`[${BEATS[tag].label.toLowerCase()}]`);
    }
    out.push(line);
  });
  return out.join('\n').trim();
}

// pace: spoken words per second of the video's voice (Ajustes → Voz), for lines without a timed voice.
export function parts(value: ScriptValue, voice: Word[] | null, pace: number): Part[] {
  const lines = value.text.split('\n');
  const spoken = voice?.filter((w) => norm(w.w)) ?? null;
  // Seconds per line: from the timed voice when it says exactly this text, else at the voice's pace.
  const counts = lines.map((l) => tokens(l).length);
  const exact = spoken && spoken.length === counts.reduce((a, b) => a + b, 0);
  let wi = 0;
  let clock = 0;
  const times = counts.map((n) => {
    if (!n) return null;
    if (exact) {
      const t = {start: spoken[wi].s, end: spoken[wi + n - 1].e};
      wi += n;
      return t;
    }
    const t = {start: clock, end: clock + n / pace};
    clock = t.end;
    return t;
  });
  // Group lines into parts: a tag starts one; untagged lines before the first tag form their own.
  const starts = tagsByLine(value);
  const out: Part[] = [];
  lines.forEach((_, i) => {
    const t = times[i];
    if (!t) return;
    const cur = out.at(-1);
    if (!cur || starts.has(i)) out.push({tag: starts.get(i) ?? null, start: t.start, end: t.end, words: counts[i]});
    else {
      cur.end = t.end;
      cur.words += counts[i];
    }
  });
  return out;
}

/* ───── Component ───── */

type Props = {
  value: ScriptValue;
  onChange: (v: ScriptValue) => void;
  onSave: () => void;
};

export function ScriptEditor({value, onChange, onSave}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({onChange, onSave});
  cb.current = {onChange, onSave};
  const [menu, setMenu] = useState<{from: number; x: number; top: number; bottom: number; tag: BeatTag | null} | null>(null);

  useLayoutEffect(() => {
    const state = EditorState.create({
      doc: value.text,
      extensions: [
        marksField,
        history(),
        keymap.of([{key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true)}, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({spellcheck: 'true', lang: 'es', autocorrect: 'off'}),
        EditorView.decorations.compute([marksField, 'doc'], lineColors),
        gutter({
          class: 'cm-beats',
          lineMarker: (v, line) => {
            if (!v.state.doc.lineAt(line.from).text.trim()) return null;
            const m = marksOf(v.state).find((x) => x.from === line.from);
            return m ? new Chip(m.tag) : addChip;
          },
          lineMarkerChange: (u) => marksOf(u.startState) !== marksOf(u.state),
          initialSpacer: () => new Chip('desarrollo'),
          domEventHandlers: {
            mousedown: (v, line, e) => {
              if (!v.state.doc.lineAt(line.from).text.trim()) return false;
              // Anchor to the chip itself: the gutter element is as tall as the whole wrapped line.
              const el = (e.target as HTMLElement).closest('.cm-gutterElement')!;
              const r = (el.querySelector('.cm-beat-chip, .cm-beat-add') ?? el).getBoundingClientRect();
              setMenu({from: line.from, x: r.left, top: r.top, bottom: r.bottom, tag: marksOf(v.state).find((x) => x.from === line.from)?.tag ?? null});
              e.preventDefault();
              return true;
            },
          },
        }),
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged || marksOf(u.startState) !== marksOf(u.state)) {
            cb.current.onChange({text: u.state.doc.toString(), beats: beatsFor(u.state)});
          }
        }),
      ],
    });
    const v = new EditorView({state, parent: host.current!});
    v.dispatch({effects: resetMarks.of(marksFor(v.state.doc, value.beats))});
    view.current = v;
    return () => v.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow changes from outside (disk, Descartar) without fighting the typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    const beats = beatsFor(v.state);
    if (text === value.text && JSON.stringify(beats) === JSON.stringify(value.beats)) return;
    const changes = text === value.text ? undefined : {from: 0, to: v.state.doc.length, insert: value.text};
    const doc = changes ? EditorState.create({doc: value.text}).doc : v.state.doc;
    v.dispatch({changes, effects: resetMarks.of(marksFor(doc, value.beats))});
  }, [value]);

  // Close the tag menu on outside click or Escape.
  const menuRef = useRef<HTMLDivElement>(null);
  // Open below the chip, or above it when there's no room below.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const h = el.offsetHeight;
    el.style.top = `${menu.bottom + 4 + h <= window.innerHeight - 8 ? menu.bottom + 4 : Math.max(8, menu.top - h - 4)}px`;
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    // The click that opens the menu (on the gutter) reaches the window too: ignore the gutter.
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!menuRef.current?.contains(t) && !t.closest('.cm-beats')) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const pick = (tag: BeatTag | null) => {
    if (menu) view.current?.dispatch({effects: setMark.of({from: menu.from, tag})});
    setMenu(null);
    view.current?.focus();
  };

  return (
    <>
      <div ref={host} className="min-h-72 flex-1 xl:min-h-0 overflow-hidden rounded-md border bg-input/20 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50" />
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 flex w-64 flex-col gap-0.5 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          style={{left: menu.x, top: menu.bottom + 4}}
        >
          {BEAT_TAGS.map((t) => (
            <button key={t} onClick={() => pick(t)} className={cn('flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent', menu.tag === t && 'bg-accent')}>
              <span className="size-2.5 flex-none rounded-full" style={{background: BEATS[t].color}} />
              <span className="font-medium">{BEATS[t].label}</span>
              <span className="truncate text-xs text-muted-foreground">{BEATS[t].hint}</span>
            </button>
          ))}
          {menu.tag && (
            <button onClick={() => pick(null)} className="mt-0.5 flex items-center gap-2 rounded-sm border-t px-2 py-1.5 text-left text-muted-foreground hover:bg-accent">
              <X className="size-3.5" /> Quitar etiqueta
            </button>
          )}
        </div>
      )}
    </>
  );
}

// The script's shape at a glance: one segment per part, as long as it lasts.
export function StructureBar({parts: ps}: {parts: Part[]}) {
  const total = ps.at(-1)?.end ?? 0;
  const memo = useMemo(() => ps.filter((p) => p.end > p.start), [ps]);
  if (!memo.length || !total) return null;
  if (memo.every((p) => !p.tag))
    return <p className="text-xs text-muted-foreground">Sin etiquetas todavía: pulsa a la izquierda de una línea para marcar dónde empieza cada parte.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-md">
        {memo.map((p, i) => {
          const b = p.tag ? BEATS[p.tag] : null;
          const secs = p.end - p.start;
          return (
            <div
              key={i}
              title={`${b?.label ?? 'Sin etiqueta'} · ${fmtTime(p.start)}–${fmtTime(p.end)} · ${secs.toFixed(1)} s · ${p.words} palabras`}
              className="flex min-w-0 items-center px-1.5 text-[11px] font-medium"
              style={{
                flexGrow: secs,
                flexBasis: 0,
                color: b?.color ?? 'var(--muted-foreground)',
                background: b ? `color-mix(in oklab, ${b.color} 18%, transparent)` : 'var(--muted)',
              }}
            >
              <span className="truncate">{b?.label ?? '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
