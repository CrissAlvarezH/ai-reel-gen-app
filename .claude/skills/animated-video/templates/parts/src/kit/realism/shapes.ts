// Hard-surface helpers: an `edge` attribute (convexity, for chipped paint and worn stone edges in
// shade.ts's weather), and seeded rocks and flagstones with fractured, bevelled shapes.
import {BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3} from 'three';
import {mergeVertices, toCreasedNormals} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {fbm2, fbm3, rng} from './noise.ts';

// Convexity per vertex in 0..1: 1 where the surface bends as sharply as a `radius`-metre bevel
// (or sharper), 0 on flat or concave areas. Works on any mesh: vertices are welded by position,
// so hard-edged (split-normal) geometry still sees its edges.
export const edges = (g: BufferGeometry, radius = 0.02) => {
  const p = g.attributes.position, n = p.count;
  const weld = new Int32Array(n), keys = new Map<string, number>(), wp: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let w = keys.get(k);
    if (w === undefined) { w = wp.length; keys.set(k, w); wp.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i))); }
    weld[i] = w;
  }
  const tri = g.index ? Array.from(g.index.array) : Array.from({length: n}, (_, i) => i);
  const wn = wp.map(() => new Vector3()), nb = wp.map(() => new Set<number>());
  const ab = new Vector3(), ac = new Vector3();
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [weld[tri[t]], weld[tri[t + 1]], weld[tri[t + 2]]];
    const fn = ab.subVectors(wp[b], wp[a]).cross(ac.subVectors(wp[c], wp[a])); // area-weighted
    wn[a].add(fn); wn[b].add(fn); wn[c].add(fn);
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  wn.forEach((v) => v.normalize());
  const curv = wp.map((pi, i) => {
    let s = 0, k = 0;
    for (const j of nb[i]) {
      const d = new Vector3().subVectors(wp[j], pi), l2 = d.lengthSq();
      if (l2 > 1e-12) { s += new Vector3().subVectors(wn[j], wn[i]).dot(d) / l2; k++; }
    }
    return k ? s / k : 0;
  });
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(Math.max(curv[weld[i]] * radius, 0), 1);
  g.setAttribute('edge', new Float32BufferAttribute(out, 1));
  return g;
};

// Per-vertex weathering masks for weather({masks: true}): fn(world position) -> [wear, wet, moss,
// dirt]. Every geometry drawn with a masked material needs this attribute (a missing one reads as
// (0, 0, 0, 1): full dirt).
export const paint = (g: BufferGeometry, fn: (p: Vector3) => [number, number, number, number], at = new Vector3()) => {
  const p = g.attributes.position, out = new Float32Array(p.count * 4), v = new Vector3();
  for (let i = 0; i < p.count; i++) out.set(fn(v.fromBufferAttribute(p, i).add(at)), i * 4);
  g.setAttribute('mask', new Float32BufferAttribute(out, 4));
  return g;
};

// A fieldstone: a noisy blob cut by a few fracture planes, flattened where it sits. Unit-ish size,
// scaled to `size` metres.
export const rock = (o: {seed: number; size?: [number, number, number]; detail?: number; rough?: number; cuts?: number}) => {
  const r = rng(o.seed);
  const base = new IcosahedronGeometry(1, o.detail ?? 3);
  base.deleteAttribute('normal'); base.deleteAttribute('uv');
  const g = mergeVertices(base);
  const planes = Array.from({length: o.cuts ?? 5}, () => ({n: new Vector3(r() * 2 - 1, (r() * 2 - 1) * 0.6, r() * 2 - 1).normalize(), d: 0.62 + r() * 0.25}));
  const p = g.attributes.position, v = new Vector3(), rough = o.rough ?? 0.22, sd = Math.floor(r() * 1e6);
  const [sx, sy, sz] = o.size ?? [1, 0.6, 0.8];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + rough * fbm3(v.x * 1.3, v.y * 1.3, v.z * 1.3, sd, 4) + 0.04 * fbm3(v.x * 9, v.y * 9, v.z * 9, sd + 7, 2));
    for (const pl of planes) { const k = v.dot(pl.n); if (k > pl.d) v.addScaledVector(pl.n, pl.d - k); }
    if (v.y < -0.45) v.y = -0.45 + (v.y + 0.45) * 0.15;
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  // Sharp where fracture planes meet, smooth within a face (a blob otherwise reads as a pillow).
  // A fracture crease spreads over about one vertex spacing, so it reads as a wide bevel: scale
  // the edge radius to the stone (measured: median edge ~0.3, creases 0.6-0.75).
  return edges(toCreasedNormals(g, 0.5), Math.min(sx, sy, sz) * 0.45);
};

// A flagstone: a bevelled slab with an uneven, slightly dished top, irregular sides and a few
// chipped corners. Origin at the middle of its top face.
export const slab = (o: {seed: number; w: number; d: number; h?: number; bevel?: number}) => {
  const r = rng(o.seed), h = o.h ?? 0.08, sd = Math.floor(r() * 1e6);
  const box = new RoundedBoxGeometry(o.w, h, o.d, 3, o.bevel ?? 0.012);
  box.deleteAttribute('normal'); box.deleteAttribute('uv');
  const g = mergeVertices(box);
  const p = g.attributes.position, bites = Array.from({length: 2 + Math.floor(r() * 3)}, () => new Vector3((r() < 0.5 ? -1 : 1) * o.w / 2, h / 2, (r() < 0.5 ? -1 : 1) * o.d / 2).multiplyScalar(0.8 + r() * 0.2));
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const out = 1 + 0.06 * fbm2(x * 3 + sd, z * 3, sd, 3);
    x *= out; z *= out;
    if (y > 0) {
      const rr = Math.min(1, Math.hypot(x / (o.w / 2), z / (o.d / 2)));
      y += 0.004 * fbm2(x * 12, z * 12, sd + 1, 3) + 0.002 * fbm2(x * 40, z * 40, sd + 2, 2) - 0.004 * (1 - rr * rr);
      for (const b of bites) { const dd = Math.hypot(x - b.x, z - b.z); if (dd < 0.06) y -= (0.06 - dd) * 0.5; }
    }
    p.setXYZ(i, x, y - h / 2, z);
  }
  g.computeVertexNormals();
  return edges(g, 0.01);
};
