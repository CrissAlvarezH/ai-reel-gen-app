// GPU-friendly effect objects, one draw call each, filled per frame from the motion functions:
//   streaks()  camera-facing segments: sparks, rain, velocity trails of fast parts, light streaks
//   puffs()    camera-facing soft sprites: dust, smoke, mist, bokeh
//   ring()     a shockwave ring (flat, any orientation); shell() an expanding spherical wavefront
//   chunks()   lit debris: an InstancedMesh posed from bursts (tumbling, settling on the floor)
// Colours are linear and may exceed 1 (HDR) so bloom in the Shutter pass picks out the hot ones.
// Plain three.js objects: add `.mesh` to the scene once, call set()/count each frame.
import {AdditiveBlending, type BufferGeometry, Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, type Material, Matrix4, Mesh, NormalBlending, PlaneGeometry, Quaternion, RingGeometry, ShaderMaterial, SphereGeometry, Vector2, Vector3} from 'three';
import type {Burst} from './physics.ts';

const dyn = (n: number, size: number) => {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
};
const quad = (x0: number, x1: number) => {
  const g = new InstancedBufferGeometry(), p = new PlaneGeometry(x1 - x0, 2);
  p.translate((x0 + x1) / 2, 0, 0);
  g.index = p.index; g.setAttribute('position', p.attributes.position);
  return g;
};

// ---------------------------------------------------------------------------------------------
// Streaks: a segment from tail `a` to head `b`, `w` world units wide (at least ~1 px on screen),
// brightest at the head. With `conserve` 1 a longer streak spreads the same light thinner, like a
// real exposure; sparks look best around 0.5. Additive by default; `blend: 'normal'` for dark ones.
export const streaks = (max: number, o: {conserve?: number; blend?: 'add' | 'normal'; minPx?: number; resolution?: Vector2} = {}) => {
  const g = quad(0, 1), A = dyn(max, 3), B = dyn(max, 3), W = dyn(max, 2), C = dyn(max, 4);
  g.setAttribute('aA', A); g.setAttribute('aB', B); g.setAttribute('aW', W); g.setAttribute('aC', C);
  g.instanceCount = 0;
  const res = o.resolution ?? new Vector2(1080, 1920);
  const mat = new ShaderMaterial({
    uniforms: {uRes: {value: res}, uConserve: {value: o.conserve ?? 0.5}, uMinPx: {value: o.minPx ?? 0.8}},
    vertexShader: /* glsl */ `
      attribute vec3 aA, aB; attribute vec2 aW; attribute vec4 aC;
      uniform vec2 uRes; uniform float uConserve, uMinPx;
      varying vec4 vC; varying vec2 vQ;
      void main() {
        vec4 a = projectionMatrix * viewMatrix * vec4(aA, 1.), b = projectionMatrix * viewMatrix * vec4(aB, 1.);
        // keep both ends in front of the camera
        if (a.w < 0.01) a = mix(b, a, (b.w - 0.01) / max(b.w - a.w, 1e-5));
        if (b.w < 0.01) { gl_Position = vec4(2., 2., 2., 1.); return; }
        vec2 sa = a.xy / a.w * uRes * 0.5, sb = b.xy / b.w * uRes * 0.5;
        vec2 d = sb - sa; float L = length(d); vec2 dir = L > 1e-3 ? d / L : vec2(1., 0.);
        vec2 nrm = vec2(-dir.y, dir.x);
        float t = position.x;
        vec4 c = mix(a, b, t);
        float hw = mix(aW.x, aW.y, t) * projectionMatrix[1][1] * uRes.y / (4. * c.w); // half width, px
        float k = clamp(hw / uMinPx, 0.02, 1.); hw = max(hw, uMinPx);
        vec2 off = nrm * position.y * hw + dir * (t * 2. - 1.) * hw; // round-ish caps
        c.xy += off / (uRes * 0.5) * c.w;
        gl_Position = c;
        float spread = mix(1., min(1., 2. * hw / (L + 2. * hw)), uConserve);
        vC = vec4(aC.rgb, aC.a * k * spread);
        vQ = vec2(t, position.y);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vC; varying vec2 vQ;
      void main() {
        float across = 1. - vQ.y * vQ.y;
        float along = mix(0.06, 1., pow(vQ.x, 1.4)); // dim tail, hot head
        float a = vC.a * across * across * along;
        gl_FragColor = vec4(vC.rgb * a, ${o.blend === 'normal' ? 'a' : '1.'});
      }`,
    transparent: true, depthWrite: false, blending: o.blend === 'normal' ? NormalBlending : AdditiveBlending,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  let n = 0;
  return {
    mesh, max,
    begin() { n = 0; },
    // add one segment; returns false when full
    add(a: Vector3, b: Vector3, w: number, rgb: ArrayLike<number> | Color, alpha = 1, wTail = w) {
      if (n >= max) return false;
      A.setXYZ(n, a.x, a.y, a.z); B.setXYZ(n, b.x, b.y, b.z); W.setXY(n, wTail, w);
      const c = rgb as Color;
      C.setXYZW(n, c.r ?? (rgb as ArrayLike<number>)[0], c.g ?? (rgb as ArrayLike<number>)[1], c.b ?? (rgb as ArrayLike<number>)[2], alpha);
      n++;
      return true;
    },
    end() {
      g.instanceCount = n;
      A.needsUpdate = B.needsUpdate = W.needsUpdate = C.needsUpdate = true;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Puffs: soft round sprites, `size` world units across. `soft` 0 = a crisp bokeh disc with a
// brighter rim, 1 = a gaussian blob; `smoke` > 0 breaks the blob up with drifting noise (smoke,
// dust, mist). Normal blending (dust darkens and catches light) or additive (glows, bokeh).
export const puffs = (max: number, o: {blend?: 'add' | 'normal'; soft?: number; smoke?: number} = {}) => {
  const g = quad(-1, 1), P = dyn(max, 3), S = dyn(max, 2), C = dyn(max, 4);
  g.setAttribute('aP', P); g.setAttribute('aS', S); g.setAttribute('aC', C);
  g.instanceCount = 0;
  const mat = new ShaderMaterial({
    uniforms: {uSoft: {value: o.soft ?? 1}, uSmoke: {value: o.smoke ?? 0}},
    vertexShader: /* glsl */ `
      attribute vec3 aP; attribute vec2 aS; attribute vec4 aC;
      varying vec4 vC; varying vec2 vQ; varying float vSeed;
      void main() {
        vec4 c = viewMatrix * vec4(aP, 1.);
        float r = aS.y; // rotation
        vec2 q = mat2(cos(r), sin(r), -sin(r), cos(r)) * position.xy;
        c.xy += q * aS.x * 0.5;
        gl_Position = projectionMatrix * c;
        vC = aC; vQ = position.xy; vSeed = fract(aS.y * 7.13);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uSoft, uSmoke;
      varying vec4 vC; varying vec2 vQ; varying float vSeed;
      float h(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float r = length(vQ);
        if (r > 1.) discard;
        float disc = smoothstep(1., 0.86, r) * (0.75 + 0.25 * smoothstep(0.55, 0.95, r));
        float blob = exp(-r * r * 3.2);
        float a = mix(disc, blob, uSoft);
        if (uSmoke > 0.) {
          vec2 p = vQ * 2.2 + vSeed * 40.;
          float n = n2(p) * 0.6 + n2(p * 2.1 + 3.) * 0.3 + n2(p * 4.3 + 7.) * 0.1;
          a *= mix(1., smoothstep(0.25, 0.85, n + 0.35 * (1. - r)), uSmoke);
        }
        a *= vC.a;
        gl_FragColor = vec4(vC.rgb * a, ${o.blend === 'add' ? '1.' : 'a'});
      }`,
    transparent: true, depthWrite: false, blending: o.blend === 'add' ? AdditiveBlending : NormalBlending,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  let n = 0;
  return {
    mesh, max,
    begin() { n = 0; },
    add(p: Vector3, size: number, rgb: ArrayLike<number> | Color, alpha = 1, rot = 0) {
      if (n >= max) return false;
      const c = rgb as Color;
      P.setXYZ(n, p.x, p.y, p.z); S.setXY(n, size, rot);
      C.setXYZW(n, c.r ?? (rgb as ArrayLike<number>)[0], c.g ?? (rgb as ArrayLike<number>)[1], c.b ?? (rgb as ArrayLike<number>)[2], alpha);
      n++;
      return true;
    },
    end() { g.instanceCount = n; P.needsUpdate = S.needsUpdate = C.needsUpdate = true; },
  };
};

// ---------------------------------------------------------------------------------------------
// Shockwave ring: a flat annulus whose outer edge is a hot line and whose inside is a faint
// fading fill, broken up by noise. Place with position + quaternion (ring lies in its local xy);
// set(radius, width, intensity) per frame. Add a ripple in the Shutter pass for the air distortion.
const Z = new Vector3(0, 0, 1);
export const ring = (o: {color?: Color; segments?: number; fill?: number} = {}) => {
  const mat = new ShaderMaterial({
    uniforms: {uCol: {value: o.color ?? new Color(1, 1, 1)}, uW: {value: 0.05}, uI: {value: 0}, uFill: {value: o.fill ?? 0.12}},
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uW, uI, uFill; varying vec2 vP;
      void main() {
        float r = length(vP), ang = atan(vP.y, vP.x);
        float brk = 0.8 + 0.2 * sin(ang * 23. + r * 9.) * sin(ang * 7. - 2.);
        float edge = exp(-pow((r - 1. + uW) / uW, 2.));
        float fill = smoothstep(0.2, 1., r) * uFill;
        gl_FragColor = vec4(uCol * uI * (edge * brk + fill), 1.);
      }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
  const mesh = new Mesh(new RingGeometry(0.02, 1, o.segments ?? 128, 1), mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    face(normal: Vector3) { mesh.quaternion.copy(new Quaternion().setFromUnitVectors(Z, normal.clone().normalize())); },
    set(radius: number, width: number, intensity: number) {
      mesh.visible = intensity > 0.001 && radius > 0;
      mesh.scale.setScalar(Math.max(radius, 1e-4));
      mat.uniforms.uW.value = Math.min(0.5, width / Math.max(radius, 1e-4));
      mat.uniforms.uI.value = intensity;
    },
  };
};

// Expanding spherical wavefront: bright where seen edge-on (a rim), nearly clear face-on, so many
// nested shells read as layered rings around the source.
export const shell = (o: {color?: Color} = {}) => {
  const mat = new ShaderMaterial({
    uniforms: {uCol: {value: o.color ?? new Color(1, 1, 1)}, uI: {value: 0}, uP: {value: 4}},
    vertexShader: /* glsl */ `varying vec3 vN, vV; void main() { vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uI, uP; varying vec3 vN, vV;
      void main() { float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), uP); gl_FragColor = vec4(uCol * uI * f, 1.); }`,
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  });
  const mesh = new Mesh(new SphereGeometry(1, 64, 32), mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    set(radius: number, intensity: number, sharp = 4) {
      mesh.visible = intensity > 0.001 && radius > 0;
      mesh.scale.setScalar(Math.max(radius, 1e-4));
      mat.uniforms.uI.value = intensity; mat.uniforms.uP.value = sharp;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Chunks: real lit debris (a lit InstancedMesh: plates, slivers, grit), posed each frame from any
// number of bursts. Each piece tumbles with its burst's turn(), is sized by its burst's size()
// (a power law: many small, few large) times `scale`. `keep(p, i, age)` can drop a piece (one that
// left the floor's edge) by returning false, or nudge p (settled grit hopping on a vibrating floor).
// Burst life sets how long debris stays: give settled debris a long one.
export const chunks = (geometry: BufferGeometry, material: Material, max: number) => {
  const mesh = new InstancedMesh(geometry, material, max);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3();
  return {
    mesh,
    fill(fr: number, bursts: {b: Burst; scale?: number; color?: (i: number) => Color}[], keep?: (p: Vector3, i: number, age: number) => boolean) {
      let n = 0;
      for (const {b, scale = 1, color} of bursts) for (let i = 0; i < b.n && n < max; i++) {
        const age = b.at(fr, i, p);
        if (age < 0 || (keep && !keep(p, i, age))) continue;
        mesh.setMatrixAt(n, m.compose(p, b.turn(fr, i, q), s.setScalar(b.size[i] * scale)));
        if (color) mesh.setColorAt(n, color(i));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
};
