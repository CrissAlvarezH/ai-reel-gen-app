// Seeded randomness and noise. Every random value in a realistic shot comes from here (CPU) or
// from GLSL_NOISE (GPU), so a rerender of any frame is identical. Never use Math.random.

// Deterministic generator: rng(seed)() -> [0, 1).
export const rng = (seed: number) => {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Integer lattice hash -> [0, 1).
const hash = (x: number, y: number, z: number, seed: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Smooth value noise in [0, 1].
export const noise3 = (x: number, y: number, z: number, seed = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k, seed);
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), u), mix(c(0, 1, 0), c(1, 1, 0), u), v),
    mix(mix(c(0, 0, 1), c(1, 0, 1), u), mix(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
};
export const noise2 = (x: number, y: number, seed = 0) => noise3(x, y, 0.5, seed);

// Fractal noise in about [-1, 1].
export const fbm2 = (x: number, y: number, seed = 0, octaves = 4) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += a * (noise2(x * f, y * f, seed + i * 31) * 2 - 1); f *= 2.03; a *= 0.5; }
  return s;
};
export const fbm3 = (x: number, y: number, z: number, seed = 0, octaves = 4) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += a * (noise3(x * f, y * f, z * f, seed + i * 31) * 2 - 1); f *= 2.03; a *= 0.5; }
  return s;
};

// GPU noise with a sine-free hash, so every GPU produces the same pattern. `fbmAA(p, fw)` fades
// out each octave whose period is under about two pixels (fw = pixel footprint in noise units,
// e.g. length(fwidth(p))), which keeps fine detail from crawling and shimmering as the camera moves.
export const GLSL_NOISE = /* glsl */ `
float rzHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float rzNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(rzHash(i), rzHash(i + vec3(1,0,0)), u.x), mix(rzHash(i + vec3(0,1,0)), rzHash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(rzHash(i + vec3(0,0,1)), rzHash(i + vec3(1,0,1)), u.x), mix(rzHash(i + vec3(0,1,1)), rzHash(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbmAA(vec3 p, float fw) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * clamp(1.5 - fw * 2.0, 0.0, 1.0) * (rzNoise(p) * 2.0 - 1.0);
    p = p * 2.03 + 17.1; fw *= 2.03; a *= 0.5;
  }
  return s;
}
`;
