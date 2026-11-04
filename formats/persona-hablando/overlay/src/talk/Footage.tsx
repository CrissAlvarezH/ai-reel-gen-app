// The person on camera: the cut that tools/footage.py makes from footage/ (public/footage.mp4, at the video's size
// and fps). It plays muted: its sound is public/vo.wav, which audio/mix.py mixes into mix.wav like any narration.
// Past its end it holds the last frame. Put it as the film's bottom layer; the style's scenes go on top.
import React from 'react';
import {AbsoluteFill, Freeze, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import info from '../footage.json';
import {f} from '../lib';

export const FOOTAGE_END = info.duration; // seconds
// Where each kept piece starts in the cut (seconds): a jump in the picture, worth a zoom or an animation.
export const JUMPS: number[] = (info.segments as {at: number}[]).map((s) => s.at).filter((t) => t > 0);

// zoom: 1 = as shot; > 1 punches in (e.g. 1.08 on a jump). y: vertical offset in % of the height (keep the face clear).
export const Footage: React.FC<{zoom?: number; y?: number; style?: React.CSSProperties}> = ({zoom = 1, y = 0, style}) => {
  const fr = useCurrentFrame();
  const last = Math.max(0, f(info.duration) - 1);
  const video = (
    <OffthreadVideo
      src={staticFile('footage.mp4')}
      muted
      style={{width: '100%', height: '100%', objectFit: 'cover', transform: `translateY(${y}%) scale(${zoom})`, ...style}}
    />
  );
  return <AbsoluteFill style={{background: '#000'}}>{fr > last ? <Freeze frame={last}>{video}</Freeze> : video}</AbsoluteFill>;
};

// Zoom for the piece of the cut playing at second t: pieces alternate between 1 and `to`, so each jump cut reads
// as a change of shot. Pass it to <Footage zoom={…} />.
export const cutZoom = (t: number, to = 1.08) => (JUMPS.filter((x) => t >= x).length % 2 ? to : 1);
