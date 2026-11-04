// CPU self-check of the motion kit: `node src/kit/motion/selftest.ts` from a film that has `three`
// installed (Node 22.6+ runs TypeScript directly). The GPU side (fx, Shutter) is checked by eye
// and by re-rendering a frame twice (see README).
import {Box3, PerspectiveCamera, Quaternion, Vector3} from 'three';
import {arrive, energy, flash, kick, move, ramp, spring, stagger, timeline} from './time.ts';
import {explode, fly, plan} from './parts.ts';
import {hinge, piston, screw, spin} from './mech.ts';
import {burst, heat} from './physics.ts';
import {budget} from './budget.ts';
import {orbit, pixelSpeed, rig, shake} from './camera.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error('motion selftest: ' + m); };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;

// ramps: ends, monotonic, fastest near the peak
for (const r of [ramp(), ramp({peak: 0.3, inP: 2, outP: 4}), ramp({outP: 1})]) {
  ok(near(r(0), 0) && near(r(1), 1), 'ramp ends');
  let prev = -1, vmax = 0, at = 0;
  for (let i = 0; i <= 100; i++) { const v = r(i / 100); ok(v >= prev - 1e-9, 'ramp monotonic'); if (i && v - prev > vmax) { vmax = v - prev; at = i / 100; } prev = v; }
  ok(at > 0.2, 'ramp peak not at the start');
}
// moves: wind-up goes negative, arrival is exact, a slam overshoots then settles
const m = {start: 10, dur: 10, antic: 0.1};
ok(move(0, m) === 0 && move(9, m) < 0 && near(move(20, m), 1) && move(40, m) === 1, 'move');
const slam = {start: 10, dur: 10, lock: {}};
let peak = 0;
for (let f = 20; f < 30; f += 0.25) peak = Math.max(peak, move(f, slam));
ok(peak > 1.02 && peak < 1.15, `slam overshoot ${peak}`);
ok(near(move(45, slam), 1, 0.01), 'slam settles');
ok(arrive(slam) === 20, 'arrive');
ok(near(spring(200), 1, 1e-4) && spring(0) === 0, 'spring');
ok(kick(5, 5) === 0 && Math.abs(kick(6, 5)) > 0.1 && Math.abs(kick(60, 5)) < 1e-3, 'kick');
// stagger follows the keys, waves add their gap
const d = stagger([3, 1, 2], {spread: 10});
ok(d[1] === 0 && d[2] === 5 && d[0] === 10, 'stagger order');
ok(stagger([0, 1, 2, 3], {spread: 0, waves: 2, gap: 7})[3] === 7, 'stagger waves');
// hit-stop: story freezes inside a stop and output() inverts story()
const tl = timeline([{at: 50, len: 3}, {at: 100, len: 10, rate: 0.5}]);
ok(tl.story(49) === 49 && tl.story(51) === 50 && tl.story(53) === 50 && tl.story(54) === 51, 'hit-stop freeze');
ok(near(tl.story(110), 102), 'slow motion');
for (const s of [10, 50, 51, 80, 103, 140]) ok(tl.story(tl.output(s)) >= s - 1e-6 && tl.story(tl.output(s) - 1) < s, `output(${s})`);
ok(energy(0, [{at: 10}]) === 0 && energy(10, [{at: 10}]) === 1 && energy(9, [{at: 10}]) > 0 && energy(60, [{at: 10}]) < 0.05, 'energy');
ok(flash(10, 10) === 1 && flash(8, 10) === 0 && flash(30, 10) < 0.02, 'flash');
// parts: start at `from`, end at `to`, no NaN in between, different departure times
const A = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 2, 0)];
const legs = plan(A.map((p, i) => ({from: {p}, to: {p: p.clone().add(new Vector3(5, i, 0)), q: new Quaternion()}})), {start: 10, dur: 12, seed: 4, turns: 2, lock: {}});
const o = {position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3()};
legs.forEach((l, i) => {
  fly(0, l, o); ok(o.position.distanceTo(A[i]) < 1e-6, 'fly from');
  fly(l.start + l.dur + 40, l, o); ok(o.position.distanceTo(l.to.p) < 1e-3, 'fly to');
  for (let f = 0; f < 80; f += 0.5) { fly(f, l, o); ok(Number.isFinite(o.position.x + o.quaternion.w), 'fly finite'); }
});
ok(new Set(legs.map((l) => l.start)).size > 1, 'staggered departures');
ok(explode([{p: new Vector3(1, 0, 0)}], {center: new Vector3(), scale: 3})[0].p.distanceTo(new Vector3(3, 0, 0)) < 1e-6, 'explode');
// mechanics: hinge ends at its angle, spin never jumps, screw seats
ok(near(hinge(100, {start: 0, dur: 10, angle: 2}), 2) && hinge(5, {start: 0, dur: 10, angle: 2}) < 1, 'hinge');
const sp = {at: 0, rps: 2, up: 10, stop: 40, down: 10};
for (let f = 0; f < 60; f += 0.5) ok(Math.abs(spin(f + 0.01, sp) - spin(f, sp)) < 0.05, `spin continuous at ${f}`);
ok(near(piston(0, 1, 3), 1) && near(piston(Math.PI, 1, 3), -1), 'piston');
ok(near(screw(100, {start: 0, dur: 10, depth: 2})[0], 2, 1e-3), 'screw');
// bursts: deterministic, stay above their floor, ages in range
const opts = {n: 60, seed: 9, at: 5, origin: new Vector3(0, 10, 0), speed: [50, 200] as [number, number], gravity: 980, drag: 2, floor: 0, life: [0.5, 1.5] as [number, number]};
const b1 = burst(opts), b2 = burst(opts), p1 = new Vector3(), p2 = new Vector3();
for (let i = 0; i < 60; i++) for (let f = 5; f < 50; f += 0.25) {
  const a1 = b1.at(f, i, p1), a2 = b2.at(f, i, p2);
  ok(a1 === a2 && p1.equals(p2), 'burst deterministic');
  if (a1 >= 0) ok(p1.y >= -1e-6 && a1 <= 1, 'burst floor and age');
}
ok(heat(0)[0] > heat(1)[0], 'heat cools');
ok(burst({n: 4, seed: 1, at: 0, origin: new Vector3(), speed: [1, 2]}).life.every((l) => l <= 0.36), 'short default life');
// budget: caps live particles, fades older bursts, hides what is in front of the hero
{
  const cam = new PerspectiveCamera(40, 0.5625, 0.1, 1000); cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const big = burst({n: 400, seed: 3, at: 0, origin: new Vector3(0, 0, 0), speed: [0, 0.01], life: [1, 1]});
  const fx = budget({maxLive: 30});
  fx.frame(5, cam, null); let n = 0; fx.each([big], () => n++);
  ok(n > 15 && n <= 45, `budget caps live particles (${n})`);
  const hero = new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2));
  fx.frame(5, cam, hero);
  ok(fx.alpha(new Vector3(0, 0, 20)) < 0.1 && fx.alpha(new Vector3(0, 0, -20)) === 1 && fx.alpha(new Vector3(30, 0, 20)) === 1, 'budget hero cover');
  const a = burst({n: 10, seed: 4, at: 0, origin: new Vector3(40, 0, 0), speed: [0, 0.01], life: [2, 2]});
  const b = burst({n: 10, seed: 5, at: 10, origin: new Vector3(40, 0, 0), speed: [0, 0.01], life: [2, 2]});
  const c = burst({n: 10, seed: 6, at: 20, origin: new Vector3(40, 0, 0), speed: [0, 0.01], life: [2, 2]});
  const fx2 = budget({maxBursts: 2}); fx2.frame(30, cam, null); const seen = new Set<unknown>(); fx2.each([a, b, c], (bb) => seen.add(bb));
  ok(seen.size === 2 && !seen.has(a), 'budget keeps the newest bursts');
}
// camera: keys are hit exactly, shake is quiet outside its window
const C = new Vector3(0, 5, 0), r = rig([{at: 0, pos: orbit(C, 50, 0, 0), look: C}, {at: 20, pos: orbit(C, 50, 5, 90), look: C, mm: 50}, {at: 30, pos: orbit(C, 40, 0, 120), look: C}]);
ok(r(20).pos.distanceTo(orbit(C, 50, 5, 90)) < 1e-6 && near(r(20).mm, 50) && r(100).pos.distanceTo(orbit(C, 40, 0, 120)) < 1e-6, 'rig keys');
ok(pixelSpeed(r, 10) > pixelSpeed(r, 0.5), 'pixel speed');
ok(shake(5, [{at: 10}]).rot.x === 0 && shake(30, [{at: 10, len: 12}]).rot.x === 0 && shake(14, [{at: 10}]).rot.x !== 0, 'shake window');
console.log('motion selftest ok');
