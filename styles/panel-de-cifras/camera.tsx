// Panel de cifras: the camera for the "world" half of a video (SKILL.md). Copy to src/film/camera.tsx.
// One wide SVG world on a ground line, filmed by a camera with keys timed off the voice; from cesantias-cuota-inicial.
import React from 'react';
import {interpolate, spring} from 'remotion';
import {ease, easeInOut, FPS, lerp} from '../lib';

// [frame, x, y, zoom]: the camera looks at world point (x, y) with that zoom. Eases between keys, holds outside them.
export type CamKey = [number, number, number, number];
export const camAt = (fr: number, keys: CamKey[]): CamKey => {
  if (fr <= keys[0][0]) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const [b, bx, by, bz] = keys[i], [a, ax, ay, az] = keys[i - 1];
    if (fr < b) {
      const t = easeInOut((fr - a) / (b - a));
      // zoom eased in log space, so a push-in feels even instead of rushing at the end
      return [fr, lerp(ax, bx, t), lerp(ay, by, t), Math.exp(lerp(Math.log(az), Math.log(bz), t))];
    }
  }
  return keys[keys.length - 1];
};

// The world, drawn in world coordinates; the camera's point lands at screen (540, 1000), under the captions.
export const Stage: React.FC<{cam: CamKey; children: React.ReactNode; style?: React.CSSProperties}> = ({cam, children, style}) => (
  <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', ...style}}>
    <g transform={`translate(540 1000) scale(${cam[3]}) translate(${-cam[1]} ${-cam[2]})`}>{children}</g>
  </svg>
);

// A spring that starts at frame a (0 before): props pop in with a little overshoot.
export const sp = (fr: number, a: number, damping = 12) =>
  fr < a ? 0 : spring({frame: fr - a, fps: FPS, config: {damping, stiffness: 170, mass: 0.7}});

// Flight from a to b at t∈[0,1], arcing h above the straight line (an envelope into a jar, bills to a TV).
export const arc = (a: [number, number], b: [number, number], t: number, h = 200) => {
  const e = ease(Math.max(0, Math.min(1, t)));
  return [lerp(a[0], b[0], e), lerp(a[1], b[1], e) - h * 4 * e * (1 - e)] as const;
};

// 0 → 1 → 0 around [a, b]: a label that is only there while its part is said.
export const fadeIO = (fr: number, a: number, b: number, d = 8) =>
  interpolate(fr, [a - d, a, b - d, b], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
