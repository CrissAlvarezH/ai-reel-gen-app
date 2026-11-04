// A sun whose shadows hold still while the camera moves. The shadow box is fixed over the set
// (or moved in whole shadow-map texels with followSun), never fitted to the view each frame:
// a box that slides or resizes with the camera makes every shadow edge crawl.
//
//   const sun = makeSun({direction: s.sunDir, color: s.sunColor, intensity: s.sunIntensity,
//                        center: new Vector3(0, 0, -6), radius: 14});
//   scene.add(sun, sun.target);
import {type Color, DirectionalLight, Matrix4, Vector3} from 'three';

export type SunOpts = {
  direction: Vector3; // unit vector toward the sun
  color: Color;
  intensity: number;
  center: Vector3; // middle of the area that needs shadows
  radius: number; // half-width of the shadow box in metres; texel size = 2 * radius / mapSize
  mapSize?: number; // default 4096
  distance?: number; // light distance from center (just needs to clear the tallest caster)
};

export const makeSun = (o: SunOpts) => {
  const l = new DirectionalLight(o.color, o.intensity);
  const r = o.radius, dist = o.distance ?? 60;
  l.castShadow = true;
  l.shadow.mapSize.set(o.mapSize ?? 4096, o.mapSize ?? 4096);
  Object.assign(l.shadow.camera, {left: -r, right: r, top: r, bottom: -r, near: 1, far: dist * 2});
  l.shadow.camera.updateProjectionMatrix();
  l.shadow.bias = -0.0003;
  l.shadow.normalBias = (2 * r) / (o.mapSize ?? 4096); // about one texel
  l.userData.sun = {direction: o.direction.clone().normalize(), distance: dist};
  followSun(l, o.center, false);
  return l;
};

// Recentre the shadow box on `center`, rounded to the shadow map's texel grid in light space, so
// the shadows rasterise the same way however the centre moves. Call per frame when the camera
// travels further than the fixed box covers.
export const followSun = (l: DirectionalLight, center: Vector3, snap = true) => {
  const {direction, distance} = l.userData.sun as {direction: Vector3; distance: number};
  const cam = l.shadow.camera;
  const texel = (cam.right - cam.left) / l.shadow.mapSize.x;
  const m = new Matrix4().lookAt(direction, new Vector3(), new Vector3(0, 1, 0));
  const x = new Vector3().setFromMatrixColumn(m, 0), y = new Vector3().setFromMatrixColumn(m, 1);
  const c = center.clone();
  if (snap) {
    const px = c.dot(x), py = c.dot(y);
    c.addScaledVector(x, Math.round(px / texel) * texel - px).addScaledVector(y, Math.round(py / texel) * texel - py);
  }
  l.target.position.copy(c);
  l.position.copy(c).addScaledVector(direction, distance);
  l.target.updateMatrixWorld();
  l.updateMatrixWorld();
  return c;
};
