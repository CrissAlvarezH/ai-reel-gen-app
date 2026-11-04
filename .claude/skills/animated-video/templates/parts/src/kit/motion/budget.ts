// Effects budget. Effects are punctuation for events; the hero is always in view.
// Every burst drawn through a budget is capped in particles, at most `maxBursts` are visible at once
// (an older one fades out over 3 frames when a newer one starts), and any particle that would sit
// in front of the hero's box on screen is faded to `cover`. Pure function of the frame and camera.
//
//   const fx = budget({maxLive: 40});
//   per frame (after the camera is placed):
//     fx.frame(fr, camera, heroBox(fr));     // world Box3 of what this beat is about, or null
//     fx.each(BURSTS, (b, i, p, age, a) => sparks.add(tail, p, w, heat(age), a));
//     fx.alpha(p)                             // the same hero test for anything else (debris, rain)
import {type Box3, type Camera, Vector3} from 'three';
import type {Burst} from './physics.ts';
import {rand} from './time.ts';

export type Budget = ReturnType<typeof budget>;
export const budget = (o: {maxBursts?: number; maxLive?: number; cover?: number; pad?: number; fps?: number} = {}) => {
  const maxBursts = o.maxBursts ?? 2, maxLive = o.maxLive ?? 40, cover = o.cover ?? 0.06, pad = o.pad ?? 0.08, fps = o.fps ?? 30;
  const span = new WeakMap<Burst, [number, number]>();
  const life = (b: Burst) => {
    let s = span.get(b);
    if (!s) { s = [Infinity, -Infinity]; for (let i = 0; i < b.n; i++) { s[0] = Math.min(s[0], b.born[i]); s[1] = Math.max(s[1], b.born[i] + b.life[i] * fps); } span.set(b, s); }
    return s;
  };
  const v = new Vector3(), corner = new Vector3(), p = new Vector3();
  let fr = 0, cam: Camera | null = null, rect: [number, number, number, number] | null = null, heroDist = Infinity;
  return {
    // Set the frame, the camera (already placed for this sample) and the hero's world box.
    frame(f: number, camera: Camera, hero: Box3 | null) {
      fr = f; cam = camera; rect = null;
      if (!hero || hero.isEmpty()) return;
      const r: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let k = 0; k < 8; k++) {
        corner.set(k & 1 ? hero.max.x : hero.min.x, k & 2 ? hero.max.y : hero.min.y, k & 4 ? hero.max.z : hero.min.z).project(camera);
        r[0] = Math.min(r[0], corner.x); r[1] = Math.max(r[1], corner.x); r[2] = Math.min(r[2], corner.y); r[3] = Math.max(r[3], corner.y);
      }
      rect = r;
      heroDist = hero.getCenter(v).distanceTo(camera.position);
    },
    // How much of an effect at world point q may show: 1 clear of the hero, `cover` in front of it,
    // a soft ramp across `pad` (screen units) around its box. Things behind the hero are left alone.
    alpha(q: Vector3) {
      if (!rect || !cam || q.distanceTo(cam.position) > heroDist) return 1;
      v.copy(q).project(cam);
      const dx = Math.max(rect[0] - v.x, v.x - rect[1], 0), dy = Math.max(rect[2] - v.y, v.y - rect[3], 0);
      const d = Math.hypot(dx, dy);
      return d >= pad ? 1 : cover + (1 - cover) * (d / pad);
    },
    // Visit the live particles of `bursts` under the budget: fn(burst, index, position, age, alpha).
    each(bursts: Burst[], fn: (b: Burst, i: number, p: Vector3, age: number, a: number) => void) {
      const live = bursts.filter((b) => { const [s, e] = life(b); return fr >= s && fr <= e; }).sort((a, b) => life(b)[0] - life(a)[0]);
      live.forEach((b, rank) => {
        // beyond the newest maxBursts: fade out over 3 frames from when the newer burst started
        const fade = rank < maxBursts ? 1 : Math.max(0, 1 - (fr - life(live[maxBursts - 1])[0]) / 3);
        if (fade <= 0) return;
        const share = Math.min(1, maxLive / b.n);
        for (let i = 0; i < b.n; i++) {
          if (share < 1 && rand(77, i, b.n) >= share) continue;
          const age = b.at(fr, i, p);
          if (age < 0) continue;
          const a = fade * this.alpha(p);
          if (a > 0.01) fn(b, i, p, age, a);
        }
      });
    },
  };
};
