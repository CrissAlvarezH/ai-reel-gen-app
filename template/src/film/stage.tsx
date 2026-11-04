// Shared pieces for a collage film: drop-in, stamps, folders, captions and title strips.
import React from 'react';
import {Img, interpolate, spring, staticFile} from 'remotion';
import {C, FONT, Torn} from '../collage/kit';
import {cue, f, FPS} from '../lib';

export const at = (phrase: string, nth?: number, off = 0) => f(cue(phrase, nth) + off);
export const clampI = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const p01 = (fr: number, a: number, dur = 10) => interpolate(fr, [a, a + dur], [0, 1], clampI);
export const springAt = (fr: number, a: number, damping = 11) =>
  fr < a ? 0 : spring({frame: fr - a, fps: FPS, config: {damping, stiffness: 150, mass: 0.8}});

// a piece set down by hand: comes from an offset, overshoots, settles
export const Drop: React.FC<{fr: number; at: number; dx?: number; dy?: number; rot?: number; out?: number; children: React.ReactNode}> =
  ({fr, at: a, dx = 0, dy = -140, rot = 6, out, children}) => {
  const p = springAt(fr, a);
  const q = out === undefined ? 0 : p01(fr, out, 6);
  if (p <= 0.001 || q >= 1) return null;
  return <div style={{position: 'absolute', inset: 0, transform: `translate(${(1 - p) * dx + q * 60}px, ${(1 - p) * dy - q * 40}px) rotate(${(1 - p) * rot}deg) scale(${1 + (1 - p) * 0.06})`, opacity: 1 - q}}>{children}</div>;
};

export const typed = (s: string, fr: number, a: number, cps = 28) => s.slice(0, Math.max(0, Math.floor((fr - a) / FPS * cps)));

// rubber stamp: slams in from above-scale, multiply ink
export const Stamp: React.FC<{fr: number; at: number; x: number; y: number; text: string; color?: string; rot?: number; size?: number; bg?: string}> =
  ({fr, at: a, x, y, text, color = C.red, rot = -12, size = 64, bg}) => {
  if (fr < a) return null;
  const k = interpolate(fr - a, [0, 3, 6], [1.8, 0.94, 1], clampI);
  return <div style={{position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) rotate(${rot}deg) scale(${k})`, border: `${size / 9}px solid ${color}`, color,
    fontFamily: FONT.head, fontSize: size, padding: `0 ${size / 3}px`, letterSpacing: 2, whiteSpace: 'nowrap', mixBlendMode: bg ? 'normal' : 'multiply', opacity: 0.94, background: bg}}>{text}</div>;
};

// manila folder with a tab
export const Folder: React.FC<{x: number; y: number; w?: number; color: string; label: string; sub?: string; rot?: number; style?: React.CSSProperties}> =
  ({x, y, w = 300, color, label, sub, rot = 0, style}) => {
  const h = w * 0.72;
  return (
    <div style={{position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rot}deg)`, filter: 'drop-shadow(4px 8px 8px rgba(30,20,10,.35))', ...style}}>
      <div style={{position: 'absolute', left: 0, top: 0, width: w * 0.42, height: h * 0.2, background: color, borderRadius: '10px 10px 0 0'}} />
      <div style={{position: 'absolute', left: 0, top: h * 0.14, width: w, height: h * 0.86, background: color, borderRadius: '0 10px 10px 10px', boxShadow: 'inset 0 -6px 0 rgba(0,0,0,.12)'}}>
        <div style={{margin: `${h * 0.12}px ${w * 0.08}px 0`, background: C.white, padding: '6px 12px', fontFamily: FONT.type, fontSize: w * 0.085, color: C.ink, lineHeight: 1.25}}>
          <div style={{fontFamily: FONT.head, fontSize: w * 0.12}}>{label}</div>{sub && <div>{sub}</div>}
        </div>
      </div>
    </div>
  );
};

// caption on a torn strip
export const Caption: React.FC<{text: string; seed: number}> = ({text, seed}) => (
  <Torn x={70} y={1640} w={940} h={118} seed={seed} rot={-1}>
    <div style={{fontFamily: FONT.sans, fontWeight: 800, fontSize: text.length > 30 ? 44 : 52, color: C.ink, textAlign: 'center', height: 118, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', lineHeight: 1.1}}>{text}</div>
  </Torn>
);

export const TitleStrip: React.FC<{text: string; fr: number; at: number; w?: number; y?: number}> = ({text, fr, at: a, w = 700, y = 120}) => (
  <Drop fr={fr} at={a} dy={-60} rot={-4}>
    <Torn x={50} y={y} w={w} h={110} seed={text.length} rot={-2.5} fill={C.ink}>
      <div style={{fontFamily: FONT.head, color: C.white, fontSize: 74, lineHeight: '110px', paddingLeft: 28, whiteSpace: 'nowrap'}}>{text}</div>
    </Torn>
  </Drop>
);
