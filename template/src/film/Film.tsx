// The reel in halftone paper collage. Acts and captions time off the VO words (lib.ts).
import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
import {ACTS, ActName, FPS} from '../lib';
import {CAPTIONS, DISPLAY} from '../captions';
import {C, Paper} from '../collage/kit';
import {Caption} from './stage';
import {Hook, Point} from './scenes';

const SCENES: Record<ActName, React.FC<{fr: number}>> = {hook: Hook, point: Point};
const actAt = (t: number): ActName => (Object.keys(ACTS) as ActName[]).find((k) => t >= ACTS[k][0] && t < ACTS[k][1]) ?? 'point';

export const Film: React.FC<{audio?: boolean}> = ({audio = true}) => {
  const raw = useCurrentFrame(), fr = Math.floor(raw / (FPS / 12)) * (FPS / 12); // drawn at 12 fps
  const t = raw / FPS, Scene = SCENES[actAt(t)];
  const c = CAPTIONS.find((x) => t >= x.s - 0.05 && t < x.e);
  const text = c ? (DISPLAY[c.words.map((w) => w.w).join(' ')] ?? c.words.map((w) => w.w).join(' ')) : null;
  return (
    <AbsoluteFill style={{background: C.paper}}>
      <Paper />
      <Scene fr={fr} />
      {text && <Caption text={text} seed={CAPTIONS.indexOf(c!) + 3} />}
      {audio && <Audio src={staticFile('mix.wav')} />}
    </AbsoluteFill>
  );
};
