// Camera language from keyframes in frames: speed-ramped moves, whip pans, orbits, push-throughs,
// crash zooms, and impact shake. A rig is a pure function of the (float) frame.
//
//   const cam = rig([
//     {at: 0,  pos: orbit(C, 60, 10, 20), look: C, mm: 35},
//     {at: 24, pos: orbit(C, 55, 8, 95),  look: C, mm: 35, ease: whip},          // whip pan
//     {at: 60, pos: orbit(C, 40, -6, 140), look: C, mm: 50, ease: ramp({peak: 0.3})},
//   ]);
//   per frame: aim(camera, cam(fr), shake(fr, [{at: 146, amp: 1}]));
import {CatmullRomCurve3, Euler, type PerspectiveCamera, Quaternion, Vector3} from 'three';
import {noise2} from '../realism/noise.ts';
import {type Ease, clamp01, easeInOut, lerp} from './time.ts';

export type CamKey = {
  at: number; // frame the camera reaches this key
  pos: Vector3;
  look: Vector3;
  mm?: number; // focal length on a 36 mm film height (portrait) / width (landscape); default 35
  roll?: number; // radians
  ease?: Ease; // the move INTO this key (default easeInOut); may overshoot (values past 1)
};
export type CamPose = {pos: Vector3; look: Vector3; mm: number; roll: number};

// A point on a circle around `center`: `radius` away horizontally, `height` above, at `deg`
// (0 = +z, 90 = +x). Use it to write orbit keys.
export const orbit = (center: Vector3, radius: number, height: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return new Vector3(center.x + radius * Math.sin(a), center.y + height, center.z + radius * Math.cos(a));
};

export const rig = (keys: CamKey[]) => {
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const pc = new CatmullRomCurve3(ks.map((k) => k.pos), false, 'centripetal');
  const lc = new CatmullRomCurve3(ks.map((k) => k.look), false, 'centripetal');
  const n = ks.length;
  const along = (c: CatmullRomCurve3, i: number, e: number) => {
    // index parametrisation: segment i at local e; past the ends, carry on along the tangent
    const ce = clamp01(e), u = (i + ce) / (n - 1), p = c.getPoint(u);
    if (e !== ce) p.addScaledVector(c.getTangent(u), (e - ce) * c.points[i].distanceTo(c.points[Math.min(i + 1, n - 1)]));
    return p;
  };
  return (fr: number): CamPose => {
    if (fr <= ks[0].at || n < 2) return {pos: ks[0].pos.clone(), look: ks[0].look.clone(), mm: ks[0].mm ?? 35, roll: ks[0].roll ?? 0};
    let i = 0;
    while (i < n - 2 && fr >= ks[i + 1].at) i++;
    const a = ks[i], b = ks[i + 1];
    const e = fr >= b.at && i === n - 2 ? 1 : (b.ease ?? easeInOut)((fr - a.at) / Math.max(b.at - a.at, 1e-6));
    return {
      pos: along(pc, i, e), look: along(lc, i, e),
      mm: Math.exp(lerp(Math.log(a.mm ?? 35), Math.log(b.mm ?? 35), e)), // zooms feel even in log space
      roll: lerp(a.roll ?? 0, b.roll ?? 0, e),
    };
  };
};

// Impact shake: trauma per hit decays linearly over `len` frames (starting a frame after the hit),
// and the shake is trauma² times smooth noise, mostly rotation. amp 1 ≈ 1.5° of pitch/yaw at the
// first frame; keep each shake under about half a second. Returns small Euler angles (radians) and
// an offset in camera space (scene units, scaled by `move`).
export type Shake = {at: number; amp?: number; len?: number; freq?: number};
export const shake = (fr: number, hits: Shake[], o: {seed?: number; move?: number} = {}) => {
  let pitch = 0, yaw = 0, roll = 0;
  const s = o.seed ?? 11;
  for (const h of hits) {
    const t = fr - h.at - 1;
    if (t < 0 || t > (h.len ?? 12)) continue;
    const trauma = (h.amp ?? 1) * (1 - t / (h.len ?? 12)), k = trauma * trauma, f = h.freq ?? 0.9;
    pitch += k * 0.026 * (noise2(t * f, 0.5, s) * 2 - 1);
    yaw += k * 0.026 * (noise2(t * f, 3.5, s) * 2 - 1);
    roll += k * 0.018 * (noise2(t * f, 7.5, s) * 2 - 1);
  }
  const m = o.move ?? 0;
  return {rot: new Euler(pitch, yaw, roll), offset: new Vector3(yaw * m, -pitch * m, 0)};
};

// Put a pose (and an optional shake) on a three.js camera.
export const aim = (cam: PerspectiveCamera, p: CamPose, sh?: {rot: Euler; offset: Vector3}) => {
  cam.filmGauge = 36;
  cam.setFocalLength(p.mm);
  cam.position.copy(p.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.look);
  if (p.roll) cam.rotateZ(p.roll);
  if (sh) {
    cam.position.add(sh.offset.clone().applyQuaternion(cam.quaternion));
    cam.quaternion.multiply(new Quaternion().setFromEuler(sh.rot));
  }
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
};

// How fast the picture moves at frame fr, in pixels per frame at the frame centre (rotation plus
// the parallax of the look point), for a frame `heightPx` tall. Use it to pick blur samples.
export const pixelSpeed = (r: (fr: number) => CamPose, fr: number, heightPx = 1920) => {
  const a = r(fr - 0.5), b = r(fr + 0.5);
  const da = a.look.clone().sub(a.pos).normalize(), db = b.look.clone().sub(b.pos).normalize();
  const ang = Math.acos(Math.min(1, da.dot(db))); // radians per frame
  const fovV = 2 * Math.atan(18 / ((a.mm + b.mm) / 2));
  const zoom = Math.abs(Math.log(b.mm / a.mm)) * heightPx * 0.5; // edge pixels per frame from a zoom
  const dolly = a.pos.distanceTo(b.pos) / Math.max(1e-6, a.pos.distanceTo(a.look)) * heightPx * 0.5;
  return (ang / fovV) * heightPx + zoom + dolly;
};
