// Sun, sky, environment light and air from one physical sky model (three's Preetham `Sky`), so
// the sun's colour, the sky reflected in every surface, the ground bounce and the haze all agree.
//
//   const s = skyLight(gl, {elevation: 12, azimuth: 200, turbidity: 3, clouds: 0.3, ground: '#4a5a2c'});
//   scene.add(s.sky); scene.environment = s.envMap;      // background sky + PBR reflections
//   sun: s.sunColor, s.sunIntensity, s.sunDir             // feed sun.ts
//   airUniforms (shade.ts) are set from the sky's horizon colours
import {Color, FloatType, MathUtils, Mesh, MeshBasicMaterial, CircleGeometry, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGLRenderTarget, type Texture, type WebGLRenderer} from 'three';
import {Sky} from 'three/examples/jsm/objects/Sky.js';
import {airUniforms} from './shade.ts';

export type SkyOpts = {
  elevation: number; // sun height above the horizon, degrees
  azimuth: number; // degrees: 0 = sun toward +z, 90 = toward +x
  turbidity?: number; // 2 clear .. 10 hazy
  rayleigh?: number; // 1 normal blue; higher = deeper blue / redder low sun
  mie?: number; // aerosol amount (glow around the sun), default 0.005
  mieG?: number; // glow tightness, default 0.8
  clouds?: number; // coverage 0..1 (0 = none)
  cloudTime?: number; // pick a different cloud pattern
  ground?: Color | string; // ground albedo for the bounce light under the horizon
  visibility?: number; // metres at which the haze hides 98% of contrast (default 1500)
  hazeHeight?: number; // metres over which the haze thins by e (default 40)
};

export const sunDirection = (elevation: number, azimuth: number) =>
  new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - elevation), MathUtils.degToRad(azimuth));

// The sun as seen through the same atmosphere as the sky shader (a CPU port of its extinction).
// Its irradiance is the shader's own sun-disc radiance (760 x sunE x extinction) times the disc's
// solid angle, so sunlight and skylight keep the sky model's ratio (about 1.5-2 : 1 direct to
// diffuse on the ground at a 13 degree sun, close to measured clear-sky values).
export const sunColor = (o: SkyOpts) => {
  const d = sunDirection(o.elevation, o.azimuth);
  const zen = Math.acos(Math.min(Math.max(d.y, -1), 1));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - zen) / 1.5));
  const za = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  const ray = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  const mieK = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const mie = 0.434 * 0.2 * (o.turbidity ?? 2) * 10e-18 * (o.mie ?? 0.005);
  const fex = ray.map((r, i) => Math.exp(-(r * (o.rayleigh ?? 1) * 8.4e3 * inv + mie * mieK[i] * 1.25e3 * inv)));
  const disc = 760 * 2 * Math.PI * (1 - 0.999956676946448443553574619906976478926848692873900859324);
  const rgb = fex.map((f) => sunE * f * disc);
  const intensity = Math.max(...rgb, 1e-6);
  return {color: new Color(rgb[0] / intensity, rgb[1] / intensity, rgb[2] / intensity), intensity, direction: d};
};

export const makeSky = (o: SkyOpts) => {
  const sky = new Sky();
  const u = sky.material.uniforms;
  u.turbidity.value = o.turbidity ?? 2;
  u.rayleigh.value = o.rayleigh ?? 1;
  u.mieCoefficient.value = o.mie ?? 0.005;
  u.mieDirectionalG.value = o.mieG ?? 0.8;
  u.cloudCoverage.value = o.clouds ?? 0;
  u.time.value = o.cloudTime ?? 0;
  u.sunPosition.value.copy(sunDirection(o.elevation, o.azimuth));
  sky.scale.setScalar(1000);
  sky.frustumCulled = false;
  return sky;
};

// Average sky radiance (linear) looking along `dir`, read back from a tiny float target.
const probe = (gl: WebGLRenderer, scene: Scene, dir: Vector3) => {
  const rt = new WebGLRenderTarget(4, 4, {type: FloatType});
  const cam = new PerspectiveCamera(6, 1, 0.1, 2000);
  cam.lookAt(dir);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, cam);
  const px = new Float32Array(64);
  gl.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
  gl.setRenderTarget(prev);
  rt.dispose();
  const c = new Color();
  for (let i = 0; i < 16; i++) c.add(new Color(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]));
  return c.multiplyScalar(1 / 16);
};

// Everything light-related a realistic outdoor shot needs, from one sky. Call once (it renders
// a few dozen tiny probes and one PMREM); the results are deterministic.
export const skyLight = (gl: WebGLRenderer, o: SkyOpts) => {
  const sun = sunColor(o);
  const probeSky = makeSky(o);
  probeSky.material.uniforms.showSunDisc.value = 0;
  const ps = new Scene().add(probeSky);
  const az = MathUtils.degToRad(o.azimuth);
  const at = (elev: number, a: number) => new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - elev), a);

  // Haze colours: the horizon away from the sun (averaged round the ring) and toward it.
  const ring = new Color();
  for (let i = 0; i < 12; i++) ring.add(probe(gl, ps, at(2, az + (i / 12) * Math.PI * 2)));
  ring.multiplyScalar(1 / 12);
  const towardSun = probe(gl, ps, at(Math.max(o.elevation, 2), az));

  // Sky irradiance on the ground (cosine-weighted hemisphere), for the bounce light.
  const sky = new Color();
  let wsum = 0;
  for (let e = 5; e < 90; e += 15) for (let i = 0; i < 12; i++) {
    const w = Math.sin(MathUtils.degToRad(e)) * Math.cos(MathUtils.degToRad(e));
    sky.add(probe(gl, ps, at(e, (i / 12) * Math.PI * 2)).multiplyScalar(w));
    wsum += w;
  }
  const skyIrradiance = sky.multiplyScalar(Math.PI / wsum);
  const groundIrr = skyIrradiance.clone().add(sun.color.clone().multiplyScalar(sun.intensity * Math.max(sun.direction.y, 0)));
  const ground = new Color(o.ground ?? '#4d5233').multiply(groundIrr).multiplyScalar(1 / Math.PI);

  // Environment: the sky over a ground disc lit by the sun and sky.
  const env = new Scene().add(makeSky(o));
  const disc = new Mesh(new CircleGeometry(900, 48), new MeshBasicMaterial({color: ground}));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -5;
  env.add(disc);
  const pm = new PMREMGenerator(gl);
  const envMap: Texture = pm.fromScene(env, 0, 0.1, 2000).texture;
  pm.dispose();

  airUniforms.uAirColor.value.copy(ring);
  airUniforms.uAirSunColor.value.copy(towardSun);
  airUniforms.uSunDirW.value.copy(sun.direction);
  airUniforms.uAirDensity.value = 3.912 / (o.visibility ?? 1500);
  airUniforms.uAirFalloff.value = 1 / (o.hazeHeight ?? 40);

  return {sky: makeSky(o), envMap, sunColor: sun.color, sunIntensity: sun.intensity, sunDir: sun.direction, horizon: ring, horizonSun: towardSun, skyIrradiance, ground};
};
