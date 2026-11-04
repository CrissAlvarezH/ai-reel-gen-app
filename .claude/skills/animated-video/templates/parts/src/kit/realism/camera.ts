// A camera set like a real one: a focal length on a full-frame (36 mm wide) sensor, moved along a
// smooth path with eased acceleration, so a dolly, crane or drone move starts and stops with mass.
//
//   track(camera, prog(frame), {path: [...], look: [...], mm: 35})
import {CatmullRomCurve3, type PerspectiveCamera, Vector3} from 'three';

// 0..1 over [start, end] frames with zero velocity at both ends and bounded acceleration.
export const move = (frame: number, start: number, end: number) => {
  const t = Math.min(Math.max((frame - start) / (end - start), 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const curves = new WeakMap<Vector3[], CatmullRomCurve3>();
const curve = (pts: Vector3[]) => {
  let c = curves.get(pts);
  if (!c) { c = new CatmullRomCurve3(pts, false, 'centripetal'); curves.set(pts, c); }
  return c;
};

// Place the camera at `t` (0..1, by arc length) along `path`, aimed at the matching point on
// `look`, with lens `mm`. Pass the same arrays every frame (they are cached).
export const track = (cam: PerspectiveCamera, t: number, o: {path: Vector3[]; look: Vector3[]; mm?: number; roll?: number}) => {
  cam.filmGauge = 36;
  cam.setFocalLength(o.mm ?? 35);
  cam.position.copy(o.path.length > 1 ? curve(o.path).getPointAt(t) : o.path[0]);
  cam.lookAt(o.look.length > 1 ? curve(o.look).getPointAt(t) : o.look[0]);
  if (o.roll) cam.rotateZ(o.roll);
  cam.updateMatrixWorld();
};
