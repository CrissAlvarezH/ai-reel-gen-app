// Shader patches for three.js built-in materials: wind, weathering, aerial perspective, leaf cut-outs
// and translucency. Each is injected into MeshStandardMaterial / MeshPhysicalMaterial (and wind and
// leaf into MeshDepthMaterial, so shadows move and cut out exactly like the surface) with
// onBeforeCompile, so the materials keep three's PBR lighting, shadows and tone mapping.
//
//   patch(material, wind({sway: 0}), weather({...}), air())   // patches compose; call once per material
//   mesh.customDepthMaterial = depthFor(wind(), leaf())        // same motion and cut-out in the shadow
//   time.value = frame / fps                                   // once per frame, before drawing
import {Color, type IUniform, type Material, MeshDepthMaterial, Vector2, Vector3} from 'three';
import {GLSL_NOISE} from './noise.ts';

type Hook = {at: string; code: string; before?: boolean};
export type Patch = {key: string; uniforms?: Record<string, IUniform>; vertexPars?: string; vertex?: Hook[]; fragmentPars?: string; fragment?: Hook[]};

const inject = (src: string, h: Hook) => {
  const tag = `#include <${h.at}>`;
  if (!src.includes(tag)) throw new Error(`shade: shader has no <${h.at}>`);
  return src.replace(tag, h.before ? `${h.code}\n${tag}` : `${tag}\n${h.code}`);
};

export const patch = <M extends Material>(m: M, ...ps: Patch[]): M => {
  const all: Patch[] = [...(m.userData.patches ?? []), ...ps];
  m.userData.patches = all;
  m.onBeforeCompile = (s) => {
    let v = s.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}`);
    let f = s.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_NOISE}`);
    for (const p of all) {
      Object.assign(s.uniforms, p.uniforms);
      if (p.vertexPars) v = v.replace('#include <common>', `#include <common>\n${p.vertexPars}`);
      if (p.fragmentPars) f = f.replace('#include <common>', `#include <common>\n${p.fragmentPars}`);
      for (const h of p.vertex ?? []) v = inject(v, h);
      for (const h of p.fragment ?? []) f = inject(f, h);
    }
    s.vertexShader = v;
    s.fragmentShader = f;
  };
  m.customProgramCacheKey = () => all.map((p) => p.key).join('|');
  m.needsUpdate = true;
  return m;
};

// A depth material for mesh.customDepthMaterial carrying the same vertex motion and cut-out.
export const depthFor = (...ps: Patch[]) => {
  const leafy = ps.some((p) => p.key.startsWith('leaf'));
  return patch(new MeshDepthMaterial({alphaTest: leafy ? 0.5 : 0}), ...ps);
};

// ---------------------------------------------------------------------------------------------
// Time and wind. Shared by every patched material; set time.value = frame / fps each frame.

export const time: IUniform<number> = {value: 0};
export const windDir: IUniform<Vector2> = {value: new Vector2(1, 0)};
export const windStrength: IUniform<number> = {value: 0.12}; // lean (dx/dy) at the strongest gust

// Lean of a plant rooted at (x, z) at time t: travelling gusts along the wind, a slower cross
// sway. Mirrored on the CPU by windAt() (for self-checks and for props that must move with the
// grass). Highest temporal frequency is about 1 Hz, far below a 24 fps frame rate.
const WIND_GLSL = /* glsl */ `
uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
vec2 rzWind(vec2 p, float t) {
  vec2 d = uWindDir, n = vec2(-d.y, d.x);
  float x = dot(p, d), y = dot(p, n);
  float g = 0.55 + 0.25 * sin(0.21 * x - 1.2 * t + 0.6 * sin(0.13 * y)) + 0.15 * sin(0.47 * x + 0.31 * y - 3.1 * t) + 0.05 * sin(1.3 * x - 0.7 * y - 5.3 * t);
  float c = 0.25 * sin(0.37 * y + 1.7 * t + 1.1 * sin(0.5 * x));
  return uWindStrength * (d * g + n * c);
}`;
export const windAt = (x: number, z: number, t: number, dir = windDir.value, strength = windStrength.value): [number, number] => {
  const nx = -dir.y, ny = dir.x, px = x * dir.x + z * dir.y, py = x * nx + z * ny;
  const g = 0.55 + 0.25 * Math.sin(0.21 * px - 1.2 * t + 0.6 * Math.sin(0.13 * py)) + 0.15 * Math.sin(0.47 * px + 0.31 * py - 3.1 * t) + 0.05 * Math.sin(1.3 * px - 0.7 * py - 5.3 * t);
  const c = 0.25 * Math.sin(0.37 * py + 1.7 * t + 1.1 * Math.sin(0.5 * px));
  return [strength * (dir.x * g + nx * c), strength * (dir.y * g + ny * c)];
};

// Bends geometry that has a `bend` attribute (0 at the root, 1 at the tip; plants.ts sets it),
// in world space, so instance rotation and scale don't change the wind's direction.
//   amp      multiplies the global lean (stiff stems < 1, soft grass > 1)
//   sway     metres of rigid sway at full lean (leaf cards on a branch); 0 for grass
//   flutter  metres of fast per-instance flutter at the tip
export const wind = (o: {amp?: number; sway?: number; flutter?: number} = {}): Patch => ({
  key: 'wind',
  uniforms: {uTime: time, uWindDir: windDir, uWindStrength: windStrength, uWindAmp: {value: o.amp ?? 1}, uWindSway: {value: o.sway ?? 0}, uWindFlutter: {value: o.flutter ?? 0}},
  vertexPars: `${WIND_GLSL}\nuniform float uWindAmp, uWindSway, uWindFlutter;\nattribute float bend;`,
  vertex: [{at: 'project_vertex', before: true, code: /* glsl */ `{
  #ifdef USE_INSTANCING
    mat4 rzM = modelMatrix * instanceMatrix;
  #else
    mat4 rzM = modelMatrix;
  #endif
    vec3 rzRoot = rzM[3].xyz;
    float rzH = max((rzM * vec4(transformed, 1.0)).y - rzRoot.y, 0.0);
    float rzPh = dot(rzRoot, vec3(12.989, 4.1414, 78.233));
    vec2 rzLean = rzWind(rzRoot.xz, uTime) * uWindAmp;
    vec2 rzBent = rzLean * rzH * bend;
    vec2 rzOff = rzBent + rzLean * uWindSway + uWindFlutter * bend * vec2(sin(rzPh + 7.0 * uTime), cos(1.3 * rzPh + 5.5 * uTime));
    vec3 rzO = vec3(rzOff.x, -0.5 * dot(rzBent, rzBent) / max(rzH, 0.05), rzOff.y);
    transformed += inverse(mat3(rzM)) * rzO;
  }`}],
});

// ---------------------------------------------------------------------------------------------
// Aerial perspective: exponential height fog lit by the sky. Light from the far surface is
// attenuated by the air and replaced by sky-coloured in-scattered light, brighter toward the sun.
// Applied in linear light before tone mapping. Set the colours from skyLight() (sky.ts).

export const airUniforms = {
  uAirColor: {value: new Color(0.6, 0.65, 0.75)}, // horizon radiance away from the sun
  uAirSunColor: {value: new Color(1, 0.8, 0.6)}, // horizon radiance toward the sun
  uSunDirW: {value: new Vector3(0, 1, 0)},
  uAirDensity: {value: 3.912 / 2000}, // 3.912 / visibility in metres at the ground
  uAirFalloff: {value: 1 / 40}, // 1 / height (m) over which the haze thins by e
  uAirG: {value: 8}, // how tightly the glow hugs the sun
};
export const air = (): Patch => ({
  key: 'air',
  uniforms: airUniforms,
  fragmentPars: 'uniform vec3 uAirColor, uAirSunColor, uSunDirW; uniform float uAirDensity, uAirFalloff, uAirG;',
  fragment: [{at: 'tonemapping_fragment', before: true, code: /* glsl */ `{
    vec3 rzV = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
    float rzD = length(rzV); vec3 rzDir = rzV / rzD;
    float rzK = uAirFalloff * rzDir.y * rzD;
    float rzOd = uAirDensity * rzD * exp(-uAirFalloff * cameraPosition.y) * (abs(rzK) > 1e-4 ? (1.0 - exp(-rzK)) / rzK : 1.0);
    vec3 rzIn = mix(uAirColor, uAirSunColor, pow(max(dot(rzDir, uSunDirW), 0.0), uAirG));
    gl_FragColor.rgb = mix(rzIn, gl_FragColor.rgb, exp(-rzOd));
  }`}],
});

// ---------------------------------------------------------------------------------------------
// Thin foliage lets sunlight through: light from behind the blade, strongest looking toward the
// sun. Uses the shadowed sun from three's own light loop (assumes one directional light).
export const translucent = (amount = 0.8): Patch => ({
  key: 'translucent',
  uniforms: {uTranslucency: {value: amount}},
  fragmentPars: 'uniform float uTranslucency;',
  fragment: [{at: 'lights_fragment_begin', code: /* glsl */ `
  #if NUM_DIR_LIGHTS > 0
    reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * uTranslucency *
      (0.5 * saturate(dot(-geometryNormal, directLight.direction)) + pow(saturate(dot(-geometryViewDir, directLight.direction)), 6.0));
  #endif`}],
});

// A twig of alternating leaves cut out of a square card (uv 0..1), no texture. Set the
// material's alphaTest to 0.5 (and alphaToCoverage with an antialiased canvas).
export const leaf = (o: {leaves?: number; width?: number} = {}): Patch => ({
  key: `leaf${o.leaves ?? 7}`,
  uniforms: {uLeafW: {value: o.width ?? 0.15}},
  vertexPars: 'varying vec2 vRzUv;',
  vertex: [{at: 'project_vertex', code: 'vRzUv = uv;'}],
  fragmentPars: /* glsl */ `varying vec2 vRzUv; uniform float uLeafW;
float rzLeaf(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0; float a = 0.0;
  for (int i = 0; i < ${o.leaves ?? 7}; i++) {
    float fi = float(i), side = mod(fi, 2.0) * 2.0 - 1.0, y = -0.8 + fi * (1.6 / float(${o.leaves ?? 7}));
    vec2 q = p - vec2(side * 0.3 * (1.0 - 0.3 * fi / float(${o.leaves ?? 7})), y + 0.18);
    float ang = side * 0.8; q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
    a = max(a, 1.0 - (q.x * q.x) / (uLeafW * uLeafW) - (q.y * q.y) / 0.11);
  }
  a = max(a, 1.0 - abs(p.x) / 0.02 - step(0.8, p.y) * 9.0); // the twig
  return clamp(a * 3.0 + 0.5, 0.0, 1.0);
}`,
  fragment: [{at: 'alphatest_fragment', before: true, code: 'diffuseColor.a *= rzLeaf(vRzUv);'}],
});

// ---------------------------------------------------------------------------------------------
// Weathering: colour, roughness and normal detail from world-space noise, plus wear driven by
// its causes. Multiplies the material's colour (leave material.color white, or use it as a tint).
//   base, vary, scale     surface colour, how much it varies (0..1), feature size in metres
//   rough [a, b]          roughness range across the variation
//   bump, bumpScale       relief in metres-ish and its feature size
//   chip                  under-layer exposed on convex edges (needs the `edge` attribute, shapes.ts);
//                         amount 0..1 is how far the wear has gone (0.3 a few nicks, 1 bare edges)
//   dust / moss           settle on upward faces; moss also where mask.z says damp/shaded
//   grime                 rises from the ground (rain splash, soil) up to `height` above `ground`
//   streaks               run down from sources (bolts, spouts, ledges): rust, water, soot
//   wet                   darker porous colour, then a glossy film (whole surface, or mask.y)
// Optional per-vertex `mask` attribute (vec4) when `masks: true`: x wear (polished by feet or
// hands: lighter, smoother, flatter), y wet, z moss, w dirt.
export type Weather = {
  base: Color | string; vary?: number; scale?: number; rough?: [number, number]; metal?: number;
  bump?: number; bumpScale?: number;
  chip?: {color: Color | string; amount?: number; rough?: number};
  dust?: {color: Color | string; amount?: number; rough?: number};
  moss?: {color: Color | string; amount?: number};
  grime?: {color: Color | string; amount?: number; height?: number; ground?: number};
  streaks?: {color: Color | string; sources: Vector3[]; amount?: number; width?: number; length?: number};
  wet?: number; masks?: boolean;
};
const col = (c: Color | string | undefined) => new Color(c ?? 0x000000);
export const weather = (w: Weather): Patch => {
  const src = (w.streaks?.sources ?? []).slice(0, 8);
  while (src.length < 8) src.push(new Vector3(0, -1e4, 0));
  const u = {
    uWBase: {value: col(w.base)}, uWVary: {value: w.vary ?? 0.3}, uWScale: {value: 1 / (w.scale ?? 0.5)},
    uWRough: {value: new Vector2(...(w.rough ?? [0.6, 0.9]))},
    uWBump: {value: w.bump ?? 0.002}, uWBumpScale: {value: 1 / (w.bumpScale ?? 0.05)},
    uWChip: {value: col(w.chip?.color)}, uWChipAmt: {value: w.chip ? (w.chip.amount ?? 0.5) : -1}, uWChipRough: {value: w.chip?.rough ?? 0.9},
    uWDust: {value: col(w.dust?.color)}, uWDustAmt: {value: w.dust ? (w.dust.amount ?? 0.5) : 0}, uWDustRough: {value: w.dust?.rough ?? 0.95},
    uWMoss: {value: col(w.moss?.color)}, uWMossAmt: {value: w.moss ? (w.moss.amount ?? 0.5) : 0},
    uWGrime: {value: col(w.grime?.color)}, uWGrimeAmt: {value: w.grime ? (w.grime.amount ?? 0.6) : 0},
    uWGrimeH: {value: w.grime?.height ?? 0.25}, uWGround: {value: w.grime?.ground ?? 0},
    uWStreak: {value: col(w.streaks?.color)}, uWStreakAmt: {value: w.streaks ? (w.streaks.amount ?? 0.7) : 0},
    uWStreakW: {value: w.streaks?.width ?? 0.015}, uWStreakL: {value: w.streaks?.length ?? 0.25}, uWSrc: {value: src},
    uWWet: {value: w.wet ?? 0},
  };
  const masks = w.masks ? '#define RZ_MASK' : '';
  return {
    key: `weather${w.masks ? 'M' : ''}`,
    uniforms: u,
    vertexPars: `${masks}\nvarying vec3 vRzPos; varying vec3 vRzNrm; varying float vRzEdge; attribute float edge;\n#ifdef RZ_MASK\nattribute vec4 mask; varying vec4 vRzMask;\n#endif`,
    vertex: [{at: 'project_vertex', code: /* glsl */ `{
    #ifdef USE_INSTANCING
      mat4 rzW = modelMatrix * instanceMatrix;
    #else
      mat4 rzW = modelMatrix;
    #endif
      vRzPos = (rzW * vec4(transformed, 1.0)).xyz;
      vRzNrm = normalize(mat3(rzW) * objectNormal);
      vRzEdge = edge;
    #ifdef RZ_MASK
      vRzMask = mask;
    #endif
    }`}],
    fragmentPars: /* glsl */ `${masks}
varying vec3 vRzPos; varying vec3 vRzNrm; varying float vRzEdge;
#ifdef RZ_MASK
varying vec4 vRzMask;
#endif
uniform vec3 uWBase, uWChip, uWDust, uWMoss, uWGrime, uWStreak; uniform vec2 uWRough;
uniform float uWVary, uWScale, uWBump, uWBumpScale, uWChipAmt, uWChipRough, uWDustAmt, uWDustRough, uWMossAmt;
uniform float uWGrimeAmt, uWGrimeH, uWGround, uWStreakAmt, uWStreakW, uWStreakL, uWWet; uniform vec3 uWSrc[8];`,
    fragment: [
      {at: 'color_fragment', code: /* glsl */ `
  vec3 rzP = vRzPos, rzN = normalize(vRzNrm);
  float rzFw = length(fwidth(rzP));
  float rzVar = fbmAA(rzP * uWScale, rzFw * uWScale);
  float rzFine = fbmAA(rzP * uWScale * 7.0 + 3.1, rzFw * uWScale * 7.0);
  vec4 rzMk = vec4(0.0);
  #ifdef RZ_MASK
  rzMk = vRzMask;
  #endif
  vec3 rzC = uWBase * max(1.0 + uWVary * rzVar, 0.0) * (1.0 + 0.5 * uWVary * rzFine);
  float rzR = mix(uWRough.x, uWRough.y, 0.5 + 0.5 * rzVar);
  rzC = mix(rzC, rzC * 1.12, rzMk.x); rzR = mix(rzR, rzR * 0.65, rzMk.x);
  float rzChip = uWChipAmt < 0.0 ? 0.0 : smoothstep(0.85 - 0.45 * uWChipAmt, 1.0 - 0.45 * uWChipAmt, vRzEdge * 1.2 + rzFine * 0.6 + rzVar * 0.25);
  rzC = mix(rzC, uWChip * (1.0 + 0.5 * rzFine), rzChip); rzR = mix(rzR, uWChipRough, rzChip);
  float rzSt = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 d = rzP - uWSrc[i]; float below = -d.y;
    rzSt += exp(-dot(d.xz, d.xz) / (uWStreakW * uWStreakW)) * step(0.0, below) * exp(-below / uWStreakL);
  }
  rzSt = uWStreakAmt * clamp(rzSt * (0.4 + 1.2 * rzNoise(vec3(rzP.x * 140.0, rzP.y * 5.0, rzP.z * 140.0))), 0.0, 1.0);
  rzC = mix(rzC, uWStreak, rzSt);
  float rzGr = uWGrimeAmt * clamp(smoothstep(uWGrimeH, 0.0, rzP.y - uWGround) * (0.7 + 0.5 * rzVar) + rzMk.w, 0.0, 1.0);
  rzC = mix(rzC, uWGrime, rzGr);
  float rzUp = smoothstep(0.3, 0.9, rzN.y);
  float rzMoss = clamp(uWMossAmt * (rzUp * smoothstep(-0.05, 0.45, rzVar + 0.5 * rzFine) + rzMk.z) * (1.0 - rzMk.x), 0.0, 1.0);
  rzC = mix(rzC, uWMoss * (0.75 + 0.5 * rzFine), rzMoss); rzR = mix(rzR, 0.92, rzMoss);
  float rzDust = uWDustAmt * rzUp * smoothstep(-0.2, 0.5, rzFine) * (1.0 - rzMoss);
  rzC = mix(rzC, uWDust, rzDust); rzR = mix(rzR, uWDustRough, rzDust);
  float rzWet = clamp(rzMk.y + uWWet, 0.0, 1.0);
  rzC *= mix(1.0, 0.45, rzWet); rzR = mix(rzR, 0.1, rzWet * rzWet);
  diffuseColor.rgb *= rzC;`},
      {at: 'roughnessmap_fragment', code: 'roughnessFactor = rzR;'},
      {at: 'normal_fragment_maps', code: /* glsl */ `{
  float rzHt = uWBump * (fbmAA(rzP * uWBumpScale, rzFw * uWBumpScale) * (1.0 - 0.7 * rzMk.x) * (1.0 - 0.6 * rzMoss) - 0.5 * rzChip);
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  normal = normalize(abs(det) * normal - sign(det) * (dFdx(rzHt) * r1 + dFdy(rzHt) * r2));
  }`},
    ],
  };
};
