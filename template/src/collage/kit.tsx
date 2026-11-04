// Paper-collage kit: paper board, cutout images, torn paper strips, marker strokes.
import React from 'react';
import {Img, staticFile} from 'remotion';

export const C = {
  paper: '#EEEAE1', ink: '#151413', red: '#E0262B', yellow: '#FFD23F', white: '#FBFAF6',
};
export const FONT = {
  head: 'Anton, sans-serif', type: '"Special Elite", monospace', sans: 'Inter, sans-serif', mark: '"Permanent Marker", cursive',
};

// deterministic pseudo-random
export const rnd = (seed: number) => {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
};

// paper board with fibre grain
export const Paper: React.FC<{tone?: string}> = ({tone = C.paper}) => (
  <svg width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
      <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0 0.08  0 0 0 0.09 0" />
    </filter>
    <filter id="blotch">
      <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="3" seed="9" />
      <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.25  0 0 0 0.12 0" />
    </filter>
    <rect width="100%" height="100%" fill={tone} />
    <rect width="100%" height="100%" filter="url(#blotch)" />
    <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>
);

// a sourced cutout PNG placed as paper on the board
export const Cutout: React.FC<{src: string; x: number; y: number; w: number; rot?: number; lift?: number; style?: React.CSSProperties}> = ({src, x, y, w, rot = 0, lift = 1, style}) => (
  <Img src={staticFile(src)} style={{
    position: 'absolute', left: x, top: y, width: w, transform: `rotate(${rot}deg)`,
    filter: `drop-shadow(${4 * lift}px ${8 * lift}px ${10 * lift}px rgba(30,20,10,${0.28 + 0.1 * lift}))`, ...style,
  }} />
);

// torn-edge polygon around a w x h box
export const tornPath = (w: number, h: number, seed: number, amp = 6, step = 14) => {
  const r = rnd(seed); const pts: string[] = [];
  const j = () => (r() - 0.5) * 2 * amp;
  for (let x = 0; x <= w; x += step) pts.push(`${x},${j()}`);
  for (let y = 0; y <= h; y += step) pts.push(`${w + j()},${y}`);
  for (let x = w; x >= 0; x -= step) pts.push(`${x},${h + j()}`);
  for (let y = h; y >= 0; y -= step) pts.push(`${j()},${y}`);
  return pts.join(' ');
};

// a torn paper piece holding children
export const Torn: React.FC<{x: number; y: number; w: number; h: number; seed?: number; fill?: string; rot?: number; lift?: number; children?: React.ReactNode; style?: React.CSSProperties}> =
  ({x, y, w, h, seed = 1, fill = C.white, rot = 0, lift = 1, children, style}) => (
  <div style={{position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rot}deg)`,
    filter: `drop-shadow(${3 * lift}px ${6 * lift}px ${8 * lift}px rgba(30,20,10,0.3))`, ...style}}>
    <svg width={w} height={h} style={{position: 'absolute', overflow: 'visible'}}>
      <polygon points={tornPath(w, h, seed)} fill={fill} />
    </svg>
    <div style={{position: 'relative', width: '100%', height: '100%'}}>{children}</div>
  </div>
);

// rough hand-drawn ellipse that draws on with p in 0..1
export const MarkerCircle: React.FC<{cx: number; cy: number; rx: number; ry: number; p?: number; color?: string; width?: number; seed?: number}> =
  ({cx, cy, rx, ry, p = 1, color = C.red, width = 9, seed = 2}) => {
  const r = rnd(seed); const pts: string[] = []; const N = 40; const turns = 1.15;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2 * turns - 0.6; const k = 1 + (r() - 0.5) * 0.06 + i / N * 0.08;
    pts.push(`${cx + Math.cos(t) * rx * k},${cy + Math.sin(t) * ry * k}`);
  }
  const len = 2 * Math.PI * Math.max(rx, ry) * turns * 1.1;
  return (
    <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width="100%" height="100%">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={len} strokeDashoffset={len * (1 - p)} opacity={0.92} />
    </svg>
  );
};

// highlighter swipe behind text
export const Highlight: React.FC<{p?: number; color?: string; children: React.ReactNode}> = ({p = 1, color = C.yellow, children}) => (
  <span style={{position: 'relative', display: 'inline-block'}}>
    <span style={{position: 'absolute', left: -6, right: -6, top: '18%', bottom: '8%', background: color,
      transformOrigin: 'left', transform: `scaleX(${p}) rotate(-1deg)`, borderRadius: 3, opacity: 0.9}} />
    <span style={{position: 'relative'}}>{children}</span>
  </span>
);

// hand-drawn arrow
export const Arrow: React.FC<{d: string; p?: number; color?: string; width?: number; head?: [number, number, number]}> = ({d, p = 1, color = C.red, width = 8, head}) => (
  <svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width="100%" height="100%">
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    {head && p > 0.95 && <path d={`M ${head[0]} ${head[1]} l -30 -14 M ${head[0]} ${head[1]} l -14 30`} transform={`rotate(${head[2]} ${head[0]} ${head[1]})`}
      stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />}
  </svg>
);

// halftone dot field as a texture block
export const Dots: React.FC<{w: number; h: number; color?: string; size?: number; style?: React.CSSProperties}> = ({w, h, color = C.ink, size = 10, style}) => (
  <div style={{position: 'absolute', width: w, height: h,
    backgroundImage: `radial-gradient(${color} 32%, transparent 36%)`, backgroundSize: `${size}px ${size}px`, ...style}} />
);
