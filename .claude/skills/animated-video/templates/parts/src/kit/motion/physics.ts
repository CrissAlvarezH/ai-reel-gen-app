// Ballistic particles: sparks, debris, droplets, dust. Each burst is simulated once (gravity, air
// drag, bounces on a floor plane with friction) at four sub-steps per frame and stored, then read
// back by frame, so any frame or sub-frame renders the same. Pure function of its options.
//
//   const sparks = burst({n: 16, seed: 7, at: 146, origin: coil, speed: [60, 180], gravity: 980,
//                         drag: 2.5, floor: 0, bounce: 0.3});      // a handful, gone in ~10 frames
// Draw bursts through a budget (budget.ts) so they stay small and never cover the hero.
//   per frame: for (let i = 0; i < sparks.n; i++) { const age = sparks.at(fr, i, p); if (age < 0) continue; ... }
//
// Units are the scene's; speed in units/s, gravity in units/s² (980 for a scene in centimetres).
import {Quaternion, Vector3} from 'three';
import {rand} from './time.ts';

export type BurstOpts = {
  n: number;
  seed: number;
  at: number; // frame of the first birth
  spread?: number; // births spread over this many frames (0 = all at once; a stream when larger)
  origin: Vector3 | ((i: number, r: (k: number) => number) => Vector3); // r(k) is a seeded value per particle
  dir?: Vector3; // mean launch direction (default up)
  cone?: number; // half-angle around dir, radians (default PI: every direction)
  speed: [number, number]; // launch speed range, units/s (skewed toward the low end, like real fragments)
  inherit?: Vector3; // velocity added to every particle (the emitter's own motion), units/s
  gravity?: number; // units/s², along -y (default 0)
  drag?: number; // 1/s: velocity loses this fraction per second (sparks 2-4, chunks 0.3-1, dust 4-8)
  floor?: number; // y of a ground plane to bounce on (none by default)
  bounce?: number; // restitution 0..1 (default 0.35)
  friction?: number; // share of sideways speed kept per bounce (default 0.6)
  life?: [number, number]; // seconds (default 0.12-0.36 s, 4-11 frames: effects are punctuation; give
  //                           debris that must settle and stay an explicit long life)
  spin?: number; // max tumble, rad/s (for chunks)
  sizes?: [number, number]; // size range (power-law: many small, few large); read with size(i)
  fps?: number;
};

const SUB = 4;

export const burst = (o: BurstOpts) => {
  const fps = o.fps ?? 30, dt = 1 / (fps * SUB), g = o.gravity ?? 0, drag = o.drag ?? 0;
  const dir = (o.dir ?? new Vector3(0, 1, 0)).clone().normalize(), cone = o.cone ?? Math.PI;
  // a frame for the cone around dir
  const t1 = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0).cross(dir).normalize() : new Vector3(1, 0, 0).cross(dir).normalize();
  const t2 = dir.clone().cross(t1);
  const born = new Float32Array(o.n), life = new Float32Array(o.n), size = new Float32Array(o.n), spin = new Float32Array(o.n);
  const axis: Vector3[] = [], offs = new Int32Array(o.n + 1);
  const tracks: Float32Array[] = [];
  for (let i = 0; i < o.n; i++) {
    const r = (k: number) => rand(o.seed, i, k);
    born[i] = o.at + (o.spread ?? 0) * r(1);
    const L = o.life ?? [0.12, 0.36];
    life[i] = L[0] + (L[1] - L[0]) * r(2);
    size[i] = o.sizes ? o.sizes[0] + (o.sizes[1] - o.sizes[0]) * r(3) ** 3 : 1;
    spin[i] = (o.spin ?? 0) * (r(4) * 2 - 1);
    axis.push(new Vector3(r(5) - 0.5, r(6) - 0.5, r(7) - 0.5).normalize());
    // direction uniform over the spherical cap of half-angle `cone`
    const cz = 1 - r(8) * (1 - Math.cos(cone)), sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = 2 * Math.PI * r(9);
    const sp = o.speed[0] + (o.speed[1] - o.speed[0]) * r(10) ** 1.6;
    const v = dir.clone().multiplyScalar(cz).addScaledVector(t1, sz * Math.cos(ph)).addScaledVector(t2, sz * Math.sin(ph)).multiplyScalar(sp);
    if (o.inherit) v.add(o.inherit);
    const p = (typeof o.origin === 'function' ? o.origin(i, r) : o.origin).clone();
    const steps = Math.ceil(life[i] * fps * SUB) + 1, tr = new Float32Array(steps * 3);
    for (let s = 0; s < steps; s++) {
      tr[s * 3] = p.x; tr[s * 3 + 1] = p.y; tr[s * 3 + 2] = p.z;
      v.y -= g * dt;
      v.multiplyScalar(Math.exp(-drag * dt));
      p.addScaledVector(v, dt);
      if (o.floor !== undefined && p.y < o.floor) {
        p.y = 2 * o.floor - p.y;
        v.y = -v.y * (o.bounce ?? 0.35);
        v.x *= o.friction ?? 0.6; v.z *= o.friction ?? 0.6;
        spin[i] *= 0.5;
      }
    }
    tracks.push(tr);
    offs[i + 1] = offs[i] + steps;
  }
  const q = new Quaternion();
  return {
    n: o.n,
    born, life, size,
    // Position of particle i at frame fr (float) into `out`; returns its age 0..1, or -1 when it
    // isn't alive. Sub-frame times interpolate between the stored sub-steps.
    at(fr: number, i: number, out: Vector3) {
      const tau = (fr - born[i]) / fps;
      if (tau < 0 || tau > life[i]) return -1;
      const tr = tracks[i], x = tau * fps * SUB, s = Math.min(Math.floor(x), tr.length / 3 - 2), f = x - s;
      out.set(tr[s * 3] + (tr[s * 3 + 3] - tr[s * 3]) * f, tr[s * 3 + 1] + (tr[s * 3 + 4] - tr[s * 3 + 1]) * f, tr[s * 3 + 2] + (tr[s * 3 + 5] - tr[s * 3 + 2]) * f);
      return tau / life[i];
    },
    // Tumble of particle i at frame fr (slows with drag, halves at each bounce in the bake's spin).
    turn(fr: number, i: number, out = q) {
      const tau = Math.max(0, (fr - born[i]) / fps);
      const a = drag > 0 ? (spin[i] * (1 - Math.exp(-drag * 0.5 * tau))) / (drag * 0.5) : spin[i] * tau;
      return out.setFromAxisAngle(axis[i], a);
    },
    // Where particle i was `back` frames ago (clamped to its birth), for a streak tail.
    tail(fr: number, i: number, back: number, out: Vector3) {
      return this.at(Math.max(born[i], fr - back), i, out);
    },
  };
};
export type Burst = ReturnType<typeof burst>;

// Heat colour of a cooling spark (linear RGB, HDR): white-hot, yellow, orange, dull red. age 0..1.
export const heat = (age: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  const t = Math.min(1, Math.max(0, age)), k = (1 - t) ** 1.5 * 6 + 0.15;
  out[0] = k; out[1] = k * Math.max(0.12, 0.9 - t * 1.1); out[2] = k * Math.max(0.02, 0.6 - t * 2.2);
  return out;
};
