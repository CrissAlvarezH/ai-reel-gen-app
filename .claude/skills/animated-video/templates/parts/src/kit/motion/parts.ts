// Many parts flying between layouts: assemble, disassemble, transform. Each part travels on its own
// curved path with its own delay, duration, tumble, wind-up and arrival, so a group never moves as
// one block. Pure functions of the frame; poses are three.js vectors and quaternions.
//
//   const legs = plan(parts.map((p) => ({from: p.home, to: p.exploded})), {start: 40, spread: 18, seed: 3});
//   per frame: legs.forEach((l, i) => fly(fr, l, meshes[i]));        // sets position/quaternion/scale
import {Quaternion, Vector3} from 'three';
import {type Ease, type Move, clamp01, move, rand, stagger} from './time.ts';

export type Pose = {p: Vector3; q?: Quaternion; s?: number};
export type Leg = Move & {
  from: Pose;
  to: Pose;
  c1: Vector3; c2: Vector3; // Bezier handles of the path
  axis: Vector3; turns: number; // extra whole turns of tumble on the way (0 = none)
  wobble: number; // radians of tilt per unit of overshoot at a slam
};

const ID = new Quaternion();
const tmpQ = new Quaternion(), tmpV = new Vector3(), tmpW = new Vector3();

export type PlanOpts = {
  start: number; // frame the first part leaves
  dur?: number; // mean flight frames (default 18)
  durVar?: number; // ± fraction of dur per part (default 0.35): parts move at different speeds
  spread?: number; // frames over which departures are staggered (default 0.6 * dur)
  order?: number[]; // stagger keys (default: distance from center, so it reads as a wave)
  curve?: Ease; waves?: number; gap?: number; jitter?: number; // see time.ts stagger
  center?: Vector3; // the arcs bulge away from this point (default: mean of the from positions)
  arc?: number; // how far paths bow outward, as a fraction of the distance travelled (default 0.45)
  arcEnd?: number; // the arrival handle's share of the bow (default 0.7: lands coming in from outside,
  //                  the assembly look; negative: arrives moving outward, the explosion look)
  lift?: Vector3; // added to both handles: a shared swing, e.g. up and over
  layer?: number; // spreads paths sideways by stagger rank so neighbours pass, not collide (default 0.15)
  turns?: number; // max extra tumble turns (default 1); each part gets 0..turns
  antic?: number; // wind-up fraction (default 0.06)
  anticDur?: number; // wind-up frames before each start (default a third of the flight, at most 8)
  lock?: {freq?: number; damp?: number}; // slam into place and ring (default: soft stop)
  peak?: number; inP?: number; outP?: number;
  wobble?: number; // default 0.6
  seed?: number;
};

// Legs for a group of parts. Each part gets: a delay from its stagger rank, a duration varied by
// durVar, a path that bows away from the group's centre (plus a sideways layer offset by rank) so
// paths look collision-free, a seeded tumble axis and turn count, and the shared wind-up/arrival.
export const plan = (parts: {from: Pose; to: Pose}[], o: PlanOpts): Leg[] => {
  const seed = o.seed ?? 1, dur = o.dur ?? 18, n = parts.length;
  const center = o.center ?? parts.reduce((a, p) => a.add(p.from.p), new Vector3()).multiplyScalar(1 / Math.max(n, 1));
  const keys = o.order ?? parts.map((p) => p.from.p.distanceTo(center));
  const delays = stagger(keys, {spread: o.spread ?? dur * 0.6, curve: o.curve, waves: o.waves, gap: o.gap, jitter: o.jitter, seed});
  const rank = stagger(keys, {spread: 1});
  return parts.map((p, i) => {
    const a = p.from.p, b = p.to.p, d = a.distanceTo(b), arc = (o.arc ?? 0.45) * d;
    const outA = tmpV.subVectors(a, center).normalize(), outB = tmpW.subVectors(b, center).normalize();
    // sideways: perpendicular to the travel, alternating by rank so neighbours take different lanes
    const travel = new Vector3().subVectors(b, a).normalize();
    const side = new Vector3(rand(seed, i, 1) - 0.5, rand(seed, i, 2) - 0.5, rand(seed, i, 3) - 0.5).cross(travel).normalize()
      .multiplyScalar((o.layer ?? 0.15) * d * (rank[i] - 0.5) * 2);
    const c1 = a.clone().addScaledVector(outA, arc).add(side);
    const c2 = b.clone().addScaledVector(outB, arc * (o.arcEnd ?? 0.7)).add(side);
    if (o.lift) { c1.add(o.lift); c2.add(o.lift); }
    const axis = new Vector3(rand(seed, i, 4) - 0.5, rand(seed, i, 5) - 0.5, rand(seed, i, 6) - 0.5).normalize();
    return {
      from: p.from, to: p.to, c1, c2, axis,
      turns: Math.round(rand(seed, i, 8) * (o.turns ?? 1)),
      wobble: o.wobble ?? 0.6,
      start: o.start + delays[i],
      dur: Math.max(3, dur * (1 + ((rand(seed, i, 9) * 2 - 1) * (o.durVar ?? 0.35)))),
      antic: o.antic ?? 0.06, anticDur: o.anticDur, peak: o.peak, inP: o.inP, outP: o.outP, lock: o.lock,
    };
  });
};
// The frame a leg starts moving (its wind-up included): the part must be at leg.from by then.
export const departs = (l: Leg) => l.start - (l.antic ? l.anticDur ?? Math.min(8, l.dur / 3) : 0);

const bez = (l: Leg, t: number, out: Vector3) => {
  const a = l.from.p, b = l.to.p, u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(l.c1, 3 * u * u * t).addScaledVector(l.c2, 3 * u * t * t).addScaledVector(b, t * t * t);
};

export type Obj = {position: Vector3; quaternion: Quaternion; scale: Vector3};
// Pose a part at a frame. Returns its progress k (0 before it leaves, 1 when it has arrived,
// beyond 0..1 during wind-up and overshoot). Wind-up backs off along the departure tangent;
// overshoot carries on along the arrival tangent and rocks the part about its tumble axis.
export const fly = (fr: number, l: Leg, o: Obj) => {
  const k = move(fr, l);
  const t = clamp01(k);
  bez(l, t, o.position);
  if (k < 0) o.position.addScaledVector(tmpV.subVectors(l.c1, l.from.p), 3 * k);
  if (k > 1) o.position.addScaledVector(tmpV.subVectors(l.to.p, l.c2), 3 * (k - 1));
  o.quaternion.slerpQuaternions(l.from.q ?? ID, l.to.q ?? ID, t);
  if (l.turns) o.quaternion.premultiply(tmpQ.setFromAxisAngle(l.axis, 2 * Math.PI * l.turns * t));
  if (k > 1 || k < 0) o.quaternion.premultiply(tmpQ.setFromAxisAngle(l.axis, l.wobble * (k > 1 ? k - 1 : k)));
  o.scale.setScalar((l.from.s ?? 1) + ((l.to.s ?? 1) - (l.from.s ?? 1)) * t);
  return k;
};
// World speed of a part (units per frame), for velocity streaks and blur decisions.
export const speed = (fr: number, l: Leg) => {
  const o = {position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3()};
  fly(fr - 0.5, l, o); const a = o.position.clone();
  fly(fr + 0.5, l, o);
  return a.distanceTo(o.position);
};

// An exploded layout: each pose pushed away from `center` (scaled by distance, plus `push` for
// parts that start at the centre), with a seeded jitter and a seeded resting tilt.
export const explode = (poses: Pose[], o: {center: Vector3; scale?: number; push?: number; jitter?: number; tilt?: number; bias?: Vector3; seed?: number}) =>
  poses.map((p, i) => {
    const s = o.seed ?? 2, dir = p.p.clone().sub(o.center);
    if (dir.lengthSq() < 1e-8) dir.set(rand(s, i, 1) - 0.5, rand(s, i, 2) - 0.5, rand(s, i, 3) - 0.5);
    const len = dir.length();
    dir.normalize();
    const out = p.p.clone().addScaledVector(dir, len * ((o.scale ?? 2) - 1) + (o.push ?? 0));
    out.add(new Vector3(rand(s, i, 4) - 0.5, rand(s, i, 5) - 0.5, rand(s, i, 6) - 0.5).multiplyScalar(2 * (o.jitter ?? 0)));
    if (o.bias) out.add(o.bias);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(rand(s, i, 7) - 0.5, rand(s, i, 8) - 0.5, rand(s, i, 9) - 0.5).normalize(), (o.tilt ?? 0.6) * (rand(s, i, 10) * 2 - 1));
    return {p: out, q: (p.q ?? ID).clone().premultiply(tilt), s: p.s};
  });
