// Secondary mechanics: the small machine motions that make a transformation read as engineered.
// Each returns a scalar (a distance or an angle) for one local transform; pure functions of frame.
//
//   panel.rotation.x = hinge(fr, {start: 90, dur: 10, angle: 1.9});
//   rotor.rotation.z = spin(fr, {at: 100, rps: 6, up: 12, down: 20, stop: 160});
//   latch.position.x = slide(fr, {start: 96, dur: 5, dist: 0.4, lock: {}});   // slams and rings
import {type Move, clamp01, kick, move} from './time.ts';

// A linear slide with wind-up and a soft stop or a slam (lock) that overshoots and rings.
export const slide = (fr: number, o: Move & {dist: number}) => o.dist * move(fr, o);

// A hinged panel swinging open under its own weight: it accelerates through the swing (no ease-out),
// hits its stop and bounces back `bounce` of the angle a few times, each bounce shorter.
export const hinge = (fr: number, o: {start: number; dur: number; angle: number; bounce?: number; bounces?: number; from?: number}) => {
  const from = o.from ?? 0, t = (fr - o.start) / o.dur;
  if (t <= 0) return from;
  if (t < 1) return from + (o.angle - from) * t * t; // gravity-like: speed grows linearly
  // bounces: arcs of decaying height and length, the first a third of the swing time
  let s = (t - 1) * o.dur, len = o.dur / 3, h = o.bounce ?? 0.12;
  for (let i = 0; i < (o.bounces ?? 3); i++) {
    if (s < len) { const u = s / len; return o.angle - (o.angle - from) * h * 4 * u * (1 - u); }
    s -= len; len *= 0.55; h *= 0.35;
  }
  return o.angle;
};

// Angle (radians) of a rotor that spins up smoothly to `rps` turns per second over `up` frames,
// and (when `stop` is given) spins down over `down` frames from `stop`. The angle is the exact
// integral of the speed, so it never jumps; reversing `rps` spins the other way.
export const spin = (fr: number, o: {at: number; rps: number; up?: number; down?: number; stop?: number; fps?: number}) => {
  const w = (2 * Math.PI * o.rps) / (o.fps ?? 30), up = o.up ?? 10, down = o.down ?? 15;
  // integral of smoothstep(u) from 0 to u is u^3 - u^4 / 2
  const I = (u: number) => { u = clamp01(u); return u * u * u - (u * u * u * u) / 2; };
  const ramped = (t: number) => (t <= 0 ? 0 : t < up ? up * I(t / up) : up * 0.5 + (t - up));
  let a = ramped(fr - o.at);
  if (o.stop !== undefined && fr > o.stop) {
    const t = fr - o.stop;
    a = ramped(o.stop - o.at) + (t < down ? down * (t / down - I(t / down)) : down * 0.5);
  }
  return a * w;
};

// A latch or bolt that locks with a recoil: travels `dist`, slams, and the part it hits jolts
// `recoil` back and rings. Returns [travel, jolt] so a shot can move the bolt and shake the body.
export const latch = (fr: number, o: {start: number; dur: number; dist: number; recoil?: number}) => {
  const travel = o.dist * clamp01((fr - o.start) / o.dur) ** 2;
  return [travel, (o.recoil ?? 0.15) * o.dist * kick(fr, o.start + o.dur, {freq: 5, decay: 4})] as const;
};

// A run of panels unfolding one after another (a fan, a solar wing, a dish): angles for n hinges,
// each starting `every` frames after the last, each swinging `angle` with a bounce.
export const unfold = (fr: number, o: {start: number; n: number; every: number; dur: number; angle: number; bounce?: number}) =>
  Array.from({length: o.n}, (_, i) => hinge(fr, {start: o.start + i * o.every, dur: o.dur, angle: o.angle, bounce: o.bounce}));

// Crank-slider: piston displacement from the crank angle (radius r, rod length l), +r at top dead
// centre, -r at the bottom, with the real slow-top/fast-middle rhythm. Drive the crank with spin().
export const piston = (crank: number, r: number, l: number) => r * Math.cos(crank) + Math.sqrt(l * l - (r * Math.sin(crank)) ** 2) - l;

// A driven gear's angle from the driver's: meshed gears turn opposite ways at the teeth ratio.
export const gear = (driver: number, teethDriver: number, teethDriven: number, phase = 0) => -driver * (teethDriver / teethDriven) + phase;

// A screw driving home: turns while it sinks `depth` over `dur` frames, fast then slowing as it
// seats, then a small jolt when it bottoms out. Returns [sink, angle]. Run backwards (start later,
// depth negative) to back one out.
export const screw = (fr: number, o: {start: number; dur: number; depth: number; turns?: number}) => {
  const t = clamp01((fr - o.start) / o.dur), e = 1 - (1 - t) ** 2;
  return [o.depth * e + 0.06 * o.depth * kick(fr, o.start + o.dur, {freq: 6, decay: 3}), 2 * Math.PI * (o.turns ?? 4) * e] as const;
};
