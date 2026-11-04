// Seeded scatter and vegetation constructors. Geometry carries a `bend` attribute (0 root .. 1 tip)
// for shade.ts's wind, and vertex colours darkening toward the root (cheap ambient occlusion).
//
//   const spots = scatter({seed: 1, count: 60000, bounds: [-20, -40, 20, 4], density: (x, z) => ...});
//   const grass = instances(tuft({seed: 2}), grassMaterial, spots, {color: (s) => ...});
import {BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, InstancedMesh, type Material, Matrix4, Quaternion, Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {rng} from './noise.ts';

export type Spot = {x: number; y: number; z: number; rot: number; scale: number; r: number; rx?: number; rz?: number};

// Rejection-sampled placement: `density(x, z)` 0..1 is the chance a candidate is kept, so it can
// encode both where things grow and level of detail (denser where the camera looks).
export const scatter = (o: {
  seed: number; count: number; bounds: [number, number, number, number];
  density?: (x: number, z: number) => number; ground?: (x: number, z: number) => number;
  scale?: [number, number]; tilt?: number;
}): Spot[] => {
  const r = rng(o.seed), out: Spot[] = [];
  const [x0, z0, x1, z1] = o.bounds, [s0, s1] = o.scale ?? [1, 1];
  for (let tries = 0; out.length < o.count && tries < o.count * 40; tries++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0), keep = r();
    if (o.density && keep >= o.density(x, z)) continue;
    const t = o.tilt ?? 0;
    out.push({x, z, y: o.ground?.(x, z) ?? 0, rot: r() * Math.PI * 2, scale: s0 + (s1 - s0) * r(), r: r(), rx: (r() - 0.5) * t, rz: (r() - 0.5) * t});
  }
  return out;
};

const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), s = new Vector3();
export const instances = (g: BufferGeometry, mat: Material, spots: Spot[], o: {color?: (s: Spot) => Color; depth?: Material; shadows?: boolean} = {}) => {
  const im = new InstancedMesh(g, mat, spots.length);
  spots.forEach((p, i) => {
    q.setFromEuler(e.set(p.rx ?? 0, p.rot, p.rz ?? 0));
    im.setMatrixAt(i, m4.compose(v.set(p.x, p.y, p.z), q, s.setScalar(p.scale)));
    if (o.color) im.setColorAt(i, o.color(p));
  });
  im.castShadow = o.shadows ?? true;
  im.receiveShadow = true;
  if (o.depth) im.customDepthMaterial = o.depth;
  im.frustumCulled = false; // instances span the set; the bounding sphere is the template geometry's
  return im;
};

// A tuft of curved, V-folded grass blades, 1 unit tall (scale per instance for height).
export const tuft = (o: {seed: number; blades?: number; width?: number; segments?: number; spread?: number; curl?: number}) => {
  const r = rng(o.seed), n = o.blades ?? 5, seg = o.segments ?? 5, w0 = o.width ?? 0.012, curl = o.curl ?? 0.5;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], bend: number[] = [], col: number[] = [], idx: number[] = [];
  for (let b = 0; b < n; b++) {
    const yaw = r() * Math.PI * 2, h = 0.55 + 0.45 * r(), lean = 0.1 + r() * 0.35, bendTo = curl * (0.5 + r());
    const ox = (r() - 0.5) * (o.spread ?? 0.05), oz = (r() - 0.5) * (o.spread ?? 0.05), shade = 0.85 + 0.3 * r();
    const dir = [Math.cos(yaw), Math.sin(yaw)], side = [-dir[1], dir[0]];
    const base = pos.length / 3;
    let px = ox, py = 0, pz = oz;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg, a = lean + bendTo * t * t; // angle from vertical grows toward the tip
      const w = w0 * (1 - Math.pow(t, 1.6)) * (0.8 + 0.4 * h);
      const tx = Math.sin(a) * dir[0], ty = Math.cos(a), tz = Math.sin(a) * dir[1];
      // face normal = side x tangent, tilted toward the sky so blades read like a canopy
      let fx = side[1] * ty, fy = side[0] * tz - side[1] * tx, fz = -side[0] * ty;
      if (fy < 0) { fx = -fx; fy = -fy; fz = -fz; }
      const nl = Math.hypot(fx * 0.5, fy * 0.5 + 0.5, fz * 0.5);
      const ao = 0.35 + 0.65 * Math.pow(t, 0.7);
      for (const k of [-1, 0, 1]) {
        const fold = k === 0 ? w * 0.35 : 0; // V fold: midrib raised along the face normal
        pos.push(px + side[0] * w * k + fx * fold, py + fy * fold, pz + side[1] * w * k + fz * fold);
        nrm.push((fx * 0.5) / nl, (fy * 0.5 + 0.5) / nl, (fz * 0.5) / nl);
        uv.push(0.5 + k * 0.5, t);
        bend.push(t);
        col.push(ao * shade, ao * shade, ao * shade);
      }
      if (i < seg) {
        const a0 = base + i * 3;
        idx.push(a0, a0 + 3, a0 + 1, a0 + 1, a0 + 3, a0 + 4, a0 + 1, a0 + 4, a0 + 2, a0 + 2, a0 + 4, a0 + 5);
      }
      const step = h / seg;
      px += tx * step; py += ty * step; pz += tz * step;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('bend', new Float32BufferAttribute(bend, 1));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
};

// A small flower: a thin stem with a flat head of petals, 1 unit tall. Vertex colours: green
// stem, white petals, yellow centre; tint petals with the instance colour.
export const flower = (o: {seed: number; petals?: number; radius?: number}) => {
  const r = rng(o.seed), n = o.petals ?? 6, rad = o.radius ?? 0.035;
  const pos: number[] = [], col: number[] = [], bend: number[] = [], idx: number[] = [];
  const lx = (r() - 0.5) * 0.12, lz = (r() - 0.5) * 0.12;
  const put = (x: number, y: number, z: number, c: number[], b: number) => { pos.push(x, y, z); col.push(...c); bend.push(b); return pos.length / 3 - 1; };
  const stem = [0.12, 0.22, 0.08];
  for (let i = 0; i < 4; i++) { // stem: a thin strip curving to the head
    const t = i / 3, w = 0.0025;
    put(lx * t * t - w, t, lz * t * t, stem, t); put(lx * t * t + w, t, lz * t * t, stem, t);
    if (i < 3) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const c = put(lx, 1.01, lz, [0.95, 0.75, 0.15], 1);
  for (let p = 0; p < n; p++) {
    const a1 = ((p + 0.5) / n) * Math.PI * 2, rr = rad * (0.8 + 0.4 * r());
    const i1 = put(lx + Math.cos(a1 - 0.35) * rr * 0.6, 1.0, lz + Math.sin(a1 - 0.35) * rr * 0.6, [1, 1, 1], 1);
    const i2 = put(lx + Math.cos(a1) * rr, 1.0 - 0.01, lz + Math.sin(a1) * rr, [1, 1, 1], 1);
    const i3 = put(lx + Math.cos(a1 + 0.35) * rr * 0.6, 1.0, lz + Math.sin(a1 + 0.35) * rr * 0.6, [1, 1, 1], 1);
    idx.push(c, i1, i2, c, i2, i3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('bend', new Float32BufferAttribute(bend, 1));
  g.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal; // heads face up whichever way they were wound
  for (let i = 0; i < nr.count; i++) if (nr.getY(i) < 0) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
  return g;
};

// A broadleaf tree: tapered branching wood plus leaf-card positions clustered at the branch tips.
// Returns geometry in the tree's own space (root at the origin); place it with a Mesh, and place
// the leaves with instances() after offsetting them (see the example).
export const tree = (o: {seed: number; height?: number; trunk?: number; leaves?: number; depth?: number}) => {
  const r = rng(o.seed), H = o.height ?? 9, parts: BufferGeometry[] = [], tips: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  const grow = (p: Vector3, d: Vector3, len: number, rad: number, depth: number) => {
    const end = p.clone().addScaledVector(d, len);
    const cyl = new CylinderGeometry(rad * 0.7, rad, len * 1.04, 7, 1, true);
    cyl.applyQuaternion(new Quaternion().setFromUnitVectors(up, d));
    cyl.translate((p.x + end.x) / 2, (p.y + end.y) / 2, (p.z + end.z) / 2);
    parts.push(cyl);
    if (depth >= (o.depth ?? 4)) { tips.push(end); return; }
    // A leader carries on upward; side branches leave along the upper part of the parent.
    const kids = depth === 0 ? 6 : 3;
    for (let k = 0; k < kids; k++) {
      const lead = k === 0, spin = (k / kids) * Math.PI * 2 + r() * 1.5;
      const ang = lead ? 0.1 + r() * 0.15 : (depth === 0 ? 0.7 : 0.5) + r() * 0.45;
      const axis = new Vector3(Math.cos(spin), 0, Math.sin(spin)).cross(d);
      const nd = d.clone().applyAxisAngle(axis.lengthSq() > 1e-6 ? axis.normalize() : new Vector3(1, 0, 0), ang);
      nd.y += 0.2; nd.normalize(); // branches reach for the light
      const at = lead ? end : p.clone().addScaledVector(d, len * (0.4 + 0.6 * r()));
      grow(at, nd, len * (lead ? 0.75 : 0.6 + 0.15 * r()), rad * (lead ? 0.75 : 0.55), depth + 1);
    }
  };
  grow(new Vector3(), new Vector3((r() - 0.5) * 0.1, 1, (r() - 0.5) * 0.1).normalize(), H * 0.36, o.trunk ?? H * 0.035, 0);
  for (const g of parts) { g.deleteAttribute('uv'); }
  const wood = mergeGeometries(parts)!;
  const n = o.leaves ?? 1600, leaves: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const t = tips[i % tips.length], R = H * 0.11;
    const u = r() * 2 - 1, ph = r() * Math.PI * 2, rr = R * (0.45 + 0.55 * Math.sqrt(r())); // mostly on the cluster's shell
    leaves.push({x: t.x + rr * Math.sqrt(1 - u * u) * Math.cos(ph), y: t.y + rr * u * 0.8, z: t.z + rr * Math.sqrt(1 - u * u) * Math.sin(ph), rot: r() * Math.PI * 2, rx: (r() - 0.5) * 2.4, rz: (r() - 0.5) * 2.4, scale: 0.8 + 0.4 * r(), r: r()});
  }
  return {wood, leaves, tips};
};

// A leaf card for leaf() in shade.ts: a square with `bend` = 1 so it sways and flutters.
export const leafCard = (size = 0.5) => {
  const g = new BufferGeometry();
  const h = size / 2;
  g.setAttribute('position', new Float32BufferAttribute([-h, 0, 0, h, 0, 0, h, size, 0, -h, size, 0], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0.5, 0.87, 0, 0.5, 0.87, 0, 0.5, 0.87, 0, 0.5, 0.87], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setAttribute('bend', new Float32BufferAttribute([1, 1, 1, 1], 1));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
};
