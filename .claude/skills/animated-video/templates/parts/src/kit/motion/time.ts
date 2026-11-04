// Timing: speed ramps, anticipation, slam-and-recoil arrivals, springs, staggers, hit-stop and an
// energy curve. Everything is a pure function of a frame number (floats allowed, for sub-frame
// motion blur) and a seed; nothing reads a clock or Math.random.
export type Ease = (t: number) => number;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Linear 0..1 over [at, at + dur] frames.
export const win = (fr: number, at: number, dur: number) => clamp01((fr - at) / Math.max(dur, 1e-6));

// Seeded hash -> [0, 1) for item i of a seeded set (k picks an independent value of the same item).
export const rand = (seed: number, i: number, k = 0) => {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(i | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// Seeded value in [a, b).
export const range = (seed: number, i: number, k: number, a: number, b: number) => a + (b - a) * rand(seed, i, k);

// A speed ramp: slow, a fast middle, slow. `peak` is where speed peaks (0..1), `inP`/`outP` how hard
// it accelerates and brakes (1 = constant speed on that side, 2 = quadratic, 4 = very sharp).
// Velocity is continuous at the peak. outP = 1 arrives at full speed: use it for slams (move()).
export const ramp = (o: {peak?: number; inP?: number; outP?: number} = {}): Ease => {
  const a = Math.min(0.999, Math.max(0.001, o.peak ?? 0.5)), pi = o.inP ?? 3, po = o.outP ?? 3;
  const ya = (po * a) / (pi * (1 - a) + po * a);
  return (t) => {
    t = clamp01(t);
    return t < a ? ya * (t / a) ** pi : 1 - (1 - ya) * ((1 - t) / (1 - a)) ** po;
  };
};
// Arrival speed (progress per unit of t) of a ramp at t = 1; non-zero only when outP = 1.
const endSpeed = (o: {peak?: number; inP?: number; outP?: number}) => {
  if ((o.outP ?? 3) !== 1) return 0;
  const a = Math.min(0.999, Math.max(0.001, o.peak ?? 0.5)), pi = o.inP ?? 3;
  const ya = a / (pi * (1 - a) + a);
  return (1 - ya) / (1 - a);
};
export const easeInOut = ramp({inP: 2, outP: 2});
export const whip = ramp({inP: 4, outP: 4}); // nearly all of the move happens in the middle third
export const easeOut = ramp({peak: 0.001, outP: 3}); // leaves at full speed, brakes hard

// Closed-form damped spring from 0 to 1 (no state): freq in Hz, damping ratio 0..1 (0.3 bouncy,
// 0.7 firm, 1 no overshoot). `frames` since release.
export const spring = (frames: number, o: {freq?: number; damp?: number; fps?: number} = {}) => {
  if (frames <= 0) return 0;
  const w = 2 * Math.PI * (o.freq ?? 2.2), z = Math.min(o.damp ?? 0.45, 0.999), t = frames / (o.fps ?? 30);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
};
// A decaying kick for a hit or a lock: 0 at `at`, jumps with speed, rings down. Multiply by the
// size of the recoil (units or radians). freq in Hz, decay in frames.
export const kick = (fr: number, at: number, o: {freq?: number; decay?: number; fps?: number} = {}) => {
  const t = fr - at;
  if (t <= 0) return 0;
  return Math.exp(-t / (o.decay ?? 5)) * Math.sin((2 * Math.PI * (o.freq ?? 3) * t) / (o.fps ?? 30));
};

export type Move = {
  start: number; // frame the main motion begins (after the wind-up)
  dur: number; // frames from start to arrival
  antic?: number; // wind-up: how far it first pulls back, as a fraction of the move (0.05-0.15)
  anticDur?: number; // frames of wind-up before `start` (default a third of dur, at most 8)
  peak?: number; inP?: number; outP?: number; // speed ramp (see ramp)
  lock?: {freq?: number; damp?: number}; // arrive at speed and spring past the target (forces outP = 1)
  fps?: number;
};
// Progress of a move at a frame: wind-up (negative), a speed-ramped main motion, then either a
// soft stop or a slam that overshoots and settles. Values outside 0..1 are wind-up and overshoot;
// feed them to parts.ts fly() or scale an offset with them.
export const move = (fr: number, m: Move) => {
  const shape = {peak: m.peak ?? 0.5, inP: m.inP ?? 3, outP: m.lock ? 1 : m.outP ?? 3};
  const a = m.antic ?? 0, ad = m.anticDur ?? Math.min(8, m.dur / 3);
  if (fr < m.start) {
    if (!a || fr <= m.start - ad) return 0;
    const u = (fr - (m.start - ad)) / ad;
    return -a * (1 - Math.cos(Math.PI * u)) / 2; // eases into the pulled-back pose, stops there
  }
  const t = (fr - m.start) / m.dur;
  if (t <= 1) return lerp(-a, 1, ramp(shape)(t));
  if (!m.lock) return 1;
  // arrived at speed v: a damped oscillator that starts at the target with that velocity
  const v = (endSpeed(shape) * (1 + a)) / m.dur; // progress per frame
  const w = (2 * Math.PI * (m.lock.freq ?? 4)) / (m.fps ?? 30), z = Math.min(m.lock.damp ?? 0.35, 0.999);
  const wd = w * Math.sqrt(1 - z * z), s = fr - m.start - m.dur;
  return 1 + (v / wd) * Math.exp(-z * w * s) * Math.sin(wd * s);
};
export const arrive = (m: Move) => m.start + m.dur; // the contact frame, for events

// Per-item delays (frames) for a staggered action. `keys` orders the items: index for a sweep,
// distance from a point for a radial wave, height for a rising wave, rand() for chaos. Items are
// placed by rank over `spread` frames, shaped by `curve` (x => x * x starts slow then floods),
// split into `waves` groups separated by `gap` frames, and jittered by up to ±`jitter` frames.
export const stagger = (keys: number[], o: {spread: number; curve?: Ease; waves?: number; gap?: number; jitter?: number; seed?: number}) => {
  const n = keys.length, order = keys.map((_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
  const rank = new Array<number>(n);
  order.forEach((i, r) => (rank[i] = n > 1 ? r / (n - 1) : 0));
  const W = Math.max(1, o.waves ?? 1), c = o.curve ?? ((x: number) => x);
  return rank.map((r, i) => {
    const w = Math.min(W - 1, Math.floor(r * W));
    return Math.max(0, c(r) * o.spread + w * (o.gap ?? 0) + (rand(o.seed ?? 0, i, 7) * 2 - 1) * (o.jitter ?? 0));
  });
};

// Hit-stop and slow motion: map output frames to story frames. Inside a stop the story runs at
// `rate` (0 freezes it) for `len` output frames. Drive the action with story(fr) and keep camera
// shake, flashes and grain on the output frame. output() inverts it for exporting events.
export type Stop = {at: number; len: number; rate?: number};
export const timeline = (stops: Stop[]) => {
  const s = [...stops].sort((a, b) => a.at - b.at);
  const story = (fr: number) => {
    let lost = 0;
    for (const p of s) lost += Math.max(0, Math.min(fr, p.at + p.len) - p.at) * (1 - (p.rate ?? 0));
    return fr - lost;
  };
  const output = (sfr: number) => {
    let lo = sfr, hi = sfr + s.reduce((a, p) => a + p.len, 0) + 1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (story(m) < sfr) lo = m; else hi = m; }
    return Math.round(lo); // the first output frame that reaches story frame sfr (stops freeze on it)
  };
  return {story, output};
};

// Energy: how hard the shot is hitting right now, from its hero events. Rises over `rise` frames
// before each hit (anticipation builds), decays exponentially over `fall` after it. Drive the
// layers from it with lags so they answer the hero in order: primary = energy(fr),
// secondary = energy(fr - 3), ambient = 0.3 + 0.7 * energy(fr - 8), shake = energy(fr) ** 2.
export type Hit = {at: number; gain?: number; rise?: number; fall?: number};
export const energy = (fr: number, hits: Hit[]) => {
  let e = 0;
  for (const h of hits) {
    const g = h.gain ?? 1, d = fr - h.at;
    if (d < 0) { const r = h.rise ?? 6; if (-d < r) e += g * (1 - -d / r) ** 2 * 0.6; }
    else e += g * Math.exp(-d / (h.fall ?? 14));
  }
  return e;
};
// A flash envelope for a light or an emissive boost: a few frames up, exponential decay.
export const flash = (fr: number, at: number, o: {attack?: number; decay?: number} = {}) => {
  const d = fr - at, a = o.attack ?? 1;
  if (d < -a) return 0;
  return d < 0 ? (1 + d / a) ** 2 : Math.exp(-d / (o.decay ?? 5));
};
