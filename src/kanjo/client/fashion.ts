// Fashion pieces on your own driver (shared/fashion.ts; the Shop's Fashion page). Made here at assembly, not in
// Blender, from the assembled driver itself, so each fits every body base and every pairing of clothes:
//
// - **Jackets and trousers are shells over the body's own skin.** The body's triangles are cut along smooth fields
//   (height for a hem or waist, the distance along the forearm or shin for a cuff, the neck's bone weight for the
//   collar), so the edges are clean lines, not the mesh's stair steps. Each vertex is lifted off the skin along its
//   normal by the piece's own height (puffer channels, pockets, fur), never less than whatever is worn under it
//   plus a margin (the jeans' waistband under a jacket, boots under trousers) and, for trousers, never more than
//   the top worn over them. It's skinned with the skin's own weights, so it moves exactly as the body does.
// - **Nothing pokes through**: the skin under a piece is dropped (as the wardrobe drops skin under clothes), and so
//   is anything else that ends up inside it (hair tucked into a collar, a waistband deep under a jacket, shoes
//   inside trouser legs). A top worn over trousers hides the trousers where it covers them. The hem, cuffs and
//   collar get a turned-in edge down to the skin, so a piece reads as cloth with a thickness, not a floating skin.
// - **A hat is a dome fitted over the head and hair**, measured direction by direction from the skull's centre
//   (so it clears any hairstyle), with its brim, cuff or peak; shades and chains are measured off the face and the
//   chest (and whatever is worn on it). Hats and shades ride the head bone; chain links take the weights of the
//   skin under them.
//
// Patterns (varsity sleeves and ribs, puffer stitching, race stripes, monogram, camo, knit) are painted in the
// material's shader from per-vertex fields, so they stay crisp at any distance and cost no textures.

import * as THREE from 'three';
import { FASHION, type FashionId, type FashionItem, type FashionKind } from '../shared/fashion.ts';

// ---------------------------------------------------------------------------------------------
// Tunables

/** Jackets: how far below the hips' joint the hem falls (m), the clearance over the skin, and the sleeve's end. */
/** `drape`: how far the torso may bridge hollows; `collar`: a roll at the neck; `puff`: down channels; `fluff`: fur. */
const JACKET: Record<string, { hem: number; lift: number; sleeve: number; drape?: number; collar?: number; fluff?: number; puff?: number }> = {
  varsity: { hem: 0.03, lift: 0.014, sleeve: 0.93, drape: 0.02 },
  puffer: { hem: 0.045, lift: 0.024, sleeve: 0.92, drape: 0.035, collar: 0.022, puff: 0.018 },
  leather: { hem: 0.02, lift: 0.011, sleeve: 0.94, drape: 0.015 },
  monogram: { hem: 0.01, lift: 0.013, sleeve: 0.93, drape: 0.02 },
  chrome: { hem: 0.025, lift: 0.016, sleeve: 0.93, drape: 0.025 },
  fur: { hem: 0.075, lift: 0.026, sleeve: 0.95, drape: 0.035, collar: 0.04, fluff: 0.005 },
};
/** Trousers: the waist above the hips' joint (m), the clearance, the cuff along the shin (0 knee, 1 ankle). */
const PANTS: Record<string, { waist: number; lift: number; ankle: number }> = {
  track: { waist: 0.075, lift: 0.008, ankle: 0.9 },
  camo: { waist: 0.075, lift: 0.009, ankle: 0.88 },
  cargo: { waist: 0.07, lift: 0.01, ankle: 0.9 },
  moto: { waist: 0.075, lift: 0.007, ankle: 0.92 },
};
/** Every layer keeps at least this much air over what's under it, and under what's over it (m). */
const MARGIN = 0.006;
/** The thinnest a piece sits over bare skin (m). */
const MIN_LIFT = 0.005;
/** Passes of height smoothing over the shell. */
const SMOOTH = 8;
/** How far in from a piece's edge something must be to count as fully inside it, and so be dropped (m). */
const INSIDE = 0.025;
/** Points of other meshes further than this from the skin are anchored to nothing (m). */
const ANCHOR_REACH = 0.08;
/** Hats: the air over the hair (m), the grid round the head, and how the brim sits against the eyes (× head height). */
const HAT = { clear: 0.008, around: 48, up: 14, front: 0.42, side: 0.14, back: -0.12 };

// ---------------------------------------------------------------------------------------------
// The body, welded and measured (once per base)

interface Prep {
  /** Welded vertices. */
  n: number;
  /** Body vertex -> welded vertex. */
  rep: Int32Array;
  /** Geometry-space positions and normals; bind-world positions and normals. */
  P: Float32Array;
  N: Float32Array;
  W: Float32Array;
  NW: Float32Array;
  /** Four bone influences per welded vertex. */
  si: Uint16Array;
  sw: Float32Array;
  adj: number[][];
  /** Body triangles, in welded vertices (degenerate ones left out). */
  tris: Int32Array;
  grid: Map<number, number[]>;
  bones: Map<string, THREE.Vector3>;
  boneIdx: Map<string, number>;
  /** Bind-world metres per geometry unit. */
  scale: number;
  toWorld: THREE.Matrix4;
  toGeo: THREE.Matrix4;
}

const preps = new WeakMap<THREE.BufferGeometry, Prep>();
const CELL = 0.03;
const cellKey = (x: number, y: number, z: number) => ((Math.floor(x / CELL) + 512) * 1024 + (Math.floor(y / CELL) + 512)) * 1024 + (Math.floor(z / CELL) + 512);

function prepare(body: THREE.SkinnedMesh, geo: THREE.BufferGeometry): Prep {
  const hit = preps.get(geo);
  if (hit) return hit;
  const pos = geo.getAttribute('position');
  const si0 = geo.getAttribute('skinIndex');
  const sw0 = geo.getAttribute('skinWeight');
  const index = geo.getIndex()!;
  const toWorld = body.bindMatrix.clone();
  const toGeo = toWorld.clone().invert();
  const scale = toWorld.getMaxScaleOnAxis();
  const v = new THREE.Vector3();
  // Weld by bind-world position (the body is split at UV seams; a shell must not tear there).
  const key = new Map<string, number>();
  const rep = new Int32Array(pos.count);
  const firstOf: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toWorld);
    const k = `${Math.round(v.x * 5000)},${Math.round(v.y * 5000)},${Math.round(v.z * 5000)}`;
    let w = key.get(k);
    if (w === undefined) {
      w = firstOf.length;
      key.set(k, w);
      firstOf.push(i);
    }
    rep[i] = w;
  }
  const n = firstOf.length;
  const P = new Float32Array(n * 3), W = new Float32Array(n * 3), N = new Float32Array(n * 3), NW = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  firstOf.forEach((i, w) => {
    v.fromBufferAttribute(pos, i);
    P.set([v.x, v.y, v.z], w * 3);
    v.applyMatrix4(toWorld);
    W.set([v.x, v.y, v.z], w * 3);
    for (let k = 0; k < 4; k++) {
      si[w * 4 + k] = si0.getComponent(i, k);
      sw[w * 4 + k] = sw0.getComponent(i, k);
    }
  });
  const tris: number[] = [];
  const adjSet: Set<number>[] = Array.from({ length: n }, () => new Set());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const i = rep[index.getX(t)], j = rep[index.getX(t + 1)], k = rep[index.getX(t + 2)];
    if (i === j || j === k || i === k) continue;
    tris.push(i, j, k);
    adjSet[i].add(j).add(k);
    adjSet[j].add(i).add(k);
    adjSet[k].add(i).add(j);
    a.fromArray(P, i * 3);
    b.fromArray(P, j * 3);
    c.fromArray(P, k * 3);
    // Area-weighted face normal.
    const fn = b.sub(a).cross(c.sub(a));
    for (const x of [i, j, k]) {
      N[x * 3] += fn.x;
      N[x * 3 + 1] += fn.y;
      N[x * 3 + 2] += fn.z;
    }
  }
  const nm = new THREE.Matrix3().getNormalMatrix(toWorld);
  for (let w = 0; w < n; w++) {
    v.fromArray(N, w * 3).normalize();
    v.toArray(N, w * 3);
    v.applyMatrix3(nm).normalize().toArray(NW, w * 3);
  }
  const grid = new Map<number, number[]>();
  for (let w = 0; w < n; w++) {
    const k = cellKey(W[w * 3], W[w * 3 + 1], W[w * 3 + 2]);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(w);
  }
  const bones = new Map<string, THREE.Vector3>();
  const boneIdx = new Map<string, number>();
  const m = new THREE.Matrix4();
  body.skeleton.bones.forEach((bn, i) => {
    boneIdx.set(bn.name, i);
    bones.set(bn.name, new THREE.Vector3().setFromMatrixPosition(m.copy(body.skeleton.boneInverses[i]).invert()));
  });
  const p: Prep = { n, rep, P, N, W, NW, si, sw, adj: adjSet.map((s) => [...s]), tris: Int32Array.from(tris), grid, bones, boneIdx, scale, toWorld, toGeo };
  preps.set(geo, p);
  return p;
}

/** Each welded vertex's total weight on the bones `match` picks. */
function weightOn(pr: Prep, match: (bone: string) => boolean): Float32Array {
  const pick = new Set<number>();
  for (const [name, i] of pr.boneIdx) if (match(name)) pick.add(i);
  const out = new Float32Array(pr.n);
  for (let w = 0; w < pr.n; w++) for (let k = 0; k < 4; k++) if (pick.has(pr.si[w * 4 + k])) out[w] += pr.sw[w * 4 + k];
  return out;
}

const ARM = (s: string) => new RegExp(`^(upperarm|lowerarm|hand)_${s}$|^(index|middle|ring|pinky|thumb)_0[1-3]_${s}$`);
const LEG = (s: string) => new RegExp(`^(thigh|calf|foot|ball)_${s}$`);

interface Anchors {
  /** Per vertex of the mesh: its welded body vertex (-1: none) and its height over the skin there (m). */
  at: Int32Array;
  h: Float32Array;
}
const anchorCache = new WeakMap<THREE.BufferGeometry, Map<Prep, Anchors>>();

/** Where each vertex of `mesh` (in its bind pose) sits over the body: the nearest skin vertex and the height over it. */
function anchors(pr: Prep, mesh: THREE.SkinnedMesh): Anchors {
  const geo = mesh.geometry;
  let byPrep = anchorCache.get(geo);
  const hit = byPrep?.get(pr);
  if (hit) return hit;
  const pos = geo.getAttribute('position');
  const at = new Int32Array(pos.count).fill(-1);
  const h = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  const reach = Math.ceil(ANCHOR_REACH / CELL);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    let best = -1;
    let bd = ANCHOR_REACH * ANCHOR_REACH;
    // Search outward ring by ring; stop once a ring can't hold anything nearer.
    for (let r = 0; r <= reach && (best < 0 || (r - 1) * CELL < Math.sqrt(bd)); r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const l = pr.grid.get(cellKey(v.x + dx * CELL, v.y + dy * CELL, v.z + dz * CELL));
            if (!l) continue;
            for (const w of l) {
              const ex = pr.W[w * 3] - v.x, ey = pr.W[w * 3 + 1] - v.y, ez = pr.W[w * 3 + 2] - v.z;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < bd) {
                bd = d;
                best = w;
              }
            }
          }
    }
    if (best < 0) continue;
    at[i] = best;
    h[i] = (v.x - pr.W[best * 3]) * pr.NW[best * 3] + (v.y - pr.W[best * 3 + 1]) * pr.NW[best * 3 + 1] + (v.z - pr.W[best * 3 + 2]) * pr.NW[best * 3 + 2];
  }
  const out = { at, h };
  if (!byPrep) anchorCache.set(geo, (byPrep = new Map()));
  byPrep.set(pr, out);
  return out;
}

/** The highest (or lowest) height of `meshes` over each skin vertex, spread `rings` rings out (anchors are sparse). */
function layer(pr: Prep, meshes: THREE.SkinnedMesh[], top: boolean, rings = 2): Float32Array {
  const out = new Float32Array(pr.n).fill(top ? -Infinity : Infinity);
  for (const m of meshes) {
    const an = anchors(pr, m);
    for (let i = 0; i < an.at.length; i++) {
      const w = an.at[i];
      if (w < 0) continue;
      out[w] = top ? Math.max(out[w], an.h[i]) : Math.min(out[w], an.h[i]);
    }
  }
  for (let r = 0; r < rings; r++) {
    const prev = out.slice();
    for (let w = 0; w < pr.n; w++) for (const x of pr.adj[w]) out[w] = top ? Math.max(out[w], prev[x]) : Math.min(out[w], prev[x]);
  }
  return out;
}

/** Drops the triangles `drop` names from a geometry (keeping its material groups), sharing its attributes. */
export function dropTriangles(src: THREE.BufferGeometry, drop: (a: number, b: number, c: number) => boolean): THREE.BufferGeometry {
  const index = src.getIndex()!;
  const groups = src.groups.length ? src.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
  const out: number[] = [];
  for (const gr of groups) {
    const start = out.length;
    for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if (!drop(a, b, c)) out.push(a, b, c);
    }
    if (src.groups.length) g.addGroup(start, out.length - start, gr.materialIndex ?? 0);
  }
  g.setIndex(out);
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

// ---------------------------------------------------------------------------------------------
// Shells: jackets and trousers

interface ShellSpec {
  /** Per welded vertex: > 0 inside the piece, roughly metres to its nearest edge. */
  k: Float32Array;
  /** The height the piece wants over the skin there (m). */
  want: Float32Array;
  /** What it must clear (worn under it) and stay under (worn over it), m over the skin. */
  under: Float32Array;
  over: Float32Array | null;
  /** Four pattern numbers per welded vertex (the shader's `fData`). */
  data: Float32Array;
  /** How far (m) the cloth may stand off the skin to bridge a hollow (cloth drapes over it rather than following
   * it in), per welded vertex; 0 keeps to the body's shape. */
  drape: Float32Array | null;
}

interface Shell {
  geo: THREE.BufferGeometry;
  /** The height it ended up at per welded vertex (inside it). */
  h: Float32Array;
  k: Float32Array;
}

/** Up to four influences out of two vertices' blend. */
function mixWeights(pr: Prep, a: number, b: number, t: number, si: number[], sw: number[]) {
  const acc = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    acc.set(pr.si[a * 4 + k], (acc.get(pr.si[a * 4 + k]) ?? 0) + pr.sw[a * 4 + k] * (1 - t));
    acc.set(pr.si[b * 4 + k], (acc.get(pr.si[b * 4 + k]) ?? 0) + pr.sw[b * 4 + k] * t);
  }
  const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((s, x) => s + x[1], 0) || 1;
  for (let k = 0; k < 4; k++) {
    si.push(top[k]?.[0] ?? 0);
    sw.push((top[k]?.[1] ?? 0) / sum);
  }
}

function buildShell(pr: Prep, s: ShellSpec): Shell {
  const { k } = s;
  const inside = (w: number) => k[w] > 0;
  // Heights: the piece's own shape, never under what's beneath it, and (trousers) under what's over them.
  const floor = new Float32Array(pr.n);
  for (let w = 0; w < pr.n; w++) floor[w] = Math.max(MIN_LIFT, Number.isFinite(s.under[w]) ? s.under[w] + MARGIN : 0);
  const clamp = (w: number, x: number) => {
    let y = Math.max(x, floor[w]);
    const o = s.over?.[w];
    if (o !== undefined && Number.isFinite(o)) y = Math.min(y, Math.max(o - MARGIN, (floor[w] + o) / 2, MIN_LIFT));
    return y;
  };
  let h = new Float32Array(pr.n);
  for (let w = 0; w < pr.n; w++) h[w] = clamp(w, s.want[w]);
  for (let it = 0; it < SMOOTH; it++) {
    const nh = h.slice();
    for (let w = 0; w < pr.n; w++) {
      if (!inside(w)) continue;
      let sum = 0, cnt = 0;
      for (const x of pr.adj[w]) {
        sum += h[x];
        cnt++;
      }
      if (cnt) nh[w] = clamp(w, h[w] * 0.5 + (sum / cnt) * 0.5);
    }
    h = nh;
  }
  // Drape: cloth bridges hollows (between the breasts, the small of the back) instead of following the skin into
  // them. Each pass moves a point out toward its neighbours' mean, never in, never past `drape`.
  if (s.drape) {
    const base = h.slice();
    const q = new Float32Array(pr.n * 3);
    const place = () => {
      for (let w = 0; w < pr.n; w++) for (let c = 0; c < 3; c++) q[w * 3 + c] = pr.W[w * 3 + c] + pr.NW[w * 3 + c] * h[w];
    };
    for (let it = 0; it < 14; it++) {
      place();
      for (let w = 0; w < pr.n; w++) {
        if (!inside(w) || !s.drape[w]) continue;
        let mx = 0, my = 0, mz = 0;
        for (const x of pr.adj[w]) {
          mx += q[x * 3];
          my += q[x * 3 + 1];
          mz += q[x * 3 + 2];
        }
        const n = pr.adj[w].length || 1;
        const up = (mx / n - pr.W[w * 3]) * pr.NW[w * 3] + (my / n - pr.W[w * 3 + 1]) * pr.NW[w * 3 + 1] + (mz / n - pr.W[w * 3 + 2]) * pr.NW[w * 3 + 2];
        h[w] = clamp(w, Math.min(base[w] + s.drape[w], Math.max(h[w], up)));
      }
    }
  }

  // Cut the body's triangles along k = 0 and lift what's inside.
  const P: number[] = [], NN: number[] = [], R: number[] = [], D: number[] = [], SI: number[] = [], SW: number[] = [];
  const own = new Map<number, number>();
  const edgeV = new Map<number, number>();
  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3();
  const put = (pos: THREE.Vector3, n: THREE.Vector3, rest: number[], data: number[], si: number[], sw: number[]) => {
    P.push(pos.x, pos.y, pos.z);
    NN.push(n.x, n.y, n.z);
    R.push(...rest);
    D.push(...data);
    SI.push(...si);
    SW.push(...sw);
    return P.length / 3 - 1;
  };
  const vert = (w: number) => {
    let i = own.get(w);
    if (i !== undefined) return i;
    nrm.fromArray(pr.N, w * 3);
    tmp.fromArray(pr.P, w * 3).addScaledVector(nrm, h[w] / pr.scale);
    i = put(tmp, nrm, [pr.W[w * 3], pr.W[w * 3 + 1], pr.W[w * 3 + 2]], [s.data[w * 4], s.data[w * 4 + 1], s.data[w * 4 + 2], s.data[w * 4 + 3]], [...pr.si.subarray(w * 4, w * 4 + 4)], [...pr.sw.subarray(w * 4, w * 4 + 4)]);
    own.set(w, i);
    return i;
  };
  const cutAt = (a: number, b: number) => {
    const key = Math.min(a, b) * pr.n + Math.max(a, b);
    let i = edgeV.get(key);
    if (i !== undefined) return i;
    const t = k[a] / (k[a] - k[b]);
    const lerp = (arr: Float32Array, n: number, j: number) => arr[a * n + j] * (1 - t) + arr[b * n + j] * t;
    nrm.set(lerp(pr.N, 3, 0), lerp(pr.N, 3, 1), lerp(pr.N, 3, 2)).normalize();
    const hh = h[a] * (1 - t) + h[b] * t;
    tmp.set(lerp(pr.P, 3, 0), lerp(pr.P, 3, 1), lerp(pr.P, 3, 2)).addScaledVector(nrm, hh / pr.scale);
    const si: number[] = [], sw: number[] = [];
    mixWeights(pr, a, b, t, si, sw);
    const data = [0, 1, 2, 3].map((j) => lerp(s.data, 4, j));
    data[1] = 0; // on the edge
    i = put(tmp, nrm, [lerp(pr.W, 3, 0), lerp(pr.W, 3, 1), lerp(pr.W, 3, 2)], data, si, sw);
    edgeV.set(key, i);
    return i;
  };
  const idx: number[] = [];
  for (let t = 0; t < pr.tris.length; t += 3) {
    const tri = [pr.tris[t], pr.tris[t + 1], pr.tris[t + 2]];
    const ins = tri.map(inside);
    if (!ins[0] && !ins[1] && !ins[2]) continue;
    if (ins[0] && ins[1] && ins[2]) {
      idx.push(vert(tri[0]), vert(tri[1]), vert(tri[2]));
      continue;
    }
    // One plane through a triangle: keep the inside polygon (a triangle or a quad), fanned.
    const poly: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if (ins[e]) poly.push(vert(a));
      if (ins[e] !== ins[(e + 1) % 3]) poly.push(cutAt(a, b));
    }
    for (let j = 1; j + 1 < poly.length; j++) idx.push(poly[0], poly[j], poly[j + 1]);
  }

  // The turned-in edge: every open edge gets a band back down toward the skin.
  const uses = new Map<number, number>();
  const ek = (a: number, b: number) => Math.min(a, b) * 1e6 + Math.max(a, b);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) uses.set(ek(idx[t + e], idx[t + ((e + 1) % 3)]), (uses.get(ek(idx[t + e], idx[t + ((e + 1) % 3)])) ?? 0) + 1);
  const tuck = new Map<number, number>();
  const tucked = (i: number) => {
    let j = tuck.get(i);
    if (j !== undefined) return j;
    nrm.fromArray(NN, i * 3);
    // Back to just over the skin (the edge's own height, less a couple of millimetres).
    const lift = Math.max(0, hAt(i) - 0.002);
    tmp.fromArray(P, i * 3).addScaledVector(nrm, -lift / pr.scale);
    j = put(tmp, nrm, R.slice(i * 3, i * 3 + 3), D.slice(i * 4, i * 4 + 4), SI.slice(i * 4, i * 4 + 4), SW.slice(i * 4, i * 4 + 4));
    tuck.set(i, j);
    return j;
  };
  // The height of a shell vertex over the skin: shell position less the skin under it (both known while building).
  const skinOf = new Map<number, THREE.Vector3>();
  for (const [w, i] of own) skinOf.set(i, new THREE.Vector3().fromArray(pr.P, w * 3));
  for (const [key, i] of edgeV) {
    const a = Math.floor(key / pr.n), b = key % pr.n;
    const t = k[a] / (k[a] - k[b]);
    skinOf.set(i, new THREE.Vector3().fromArray(pr.P, a * 3).lerp(new THREE.Vector3().fromArray(pr.P, b * 3), t));
  }
  function hAt(i: number) {
    const sk = skinOf.get(i);
    return sk ? tmp.fromArray(P, i * 3).distanceTo(sk) * pr.scale : 0;
  }
  const n0 = idx.length;
  for (let t = 0; t < n0; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      if (uses.get(ek(a, b)) !== 1) continue;
      const a2 = tucked(a), b2 = tucked(b);
      idx.push(b, a, a2, b, a2, b2);
    }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(NN, 3));
  geo.setAttribute('fRest', new THREE.Float32BufferAttribute(R, 3));
  geo.setAttribute('fData', new THREE.Float32BufferAttribute(D, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  geo.setIndex(idx);
  // Smooth normals over the lifted surface (the tucked band keeps the skin's).
  const lifted = geo.clone();
  lifted.setIndex(idx.slice(0, n0));
  lifted.computeVertexNormals();
  const ln = lifted.getAttribute('normal');
  const gn = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (const i of [...own.values(), ...edgeV.values()]) gn.setXYZ(i, ln.getX(i), ln.getY(i), ln.getZ(i));
  lifted.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, h, k };
}

// Smooth value noise for fur and pocket shapes (deterministic, so every client draws the same coat).
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Rig {
  pr: Prep;
  armL: Float32Array;
  armR: Float32Array;
  legL: Float32Array;
  legR: Float32Array;
  neck: Float32Array;
}
const rigs = new WeakMap<Prep, Rig>();
function rigOf(pr: Prep): Rig {
  let r = rigs.get(pr);
  if (!r) {
    r = {
      pr,
      armL: weightOn(pr, (b) => ARM('l').test(b)),
      armR: weightOn(pr, (b) => ARM('r').test(b)),
      legL: weightOn(pr, (b) => LEG('l').test(b)),
      legR: weightOn(pr, (b) => LEG('r').test(b)),
      neck: weightOn(pr, (b) => b === 'neck_01' || b === 'head'),
    };
    rigs.set(pr, r);
  }
  return r;
}

const V = (pr: Prep, w: number) => new THREE.Vector3(pr.W[w * 3], pr.W[w * 3 + 1], pr.W[w * 3 + 2]);
const bone = (pr: Prep, name: string) => pr.bones.get(name) ?? new THREE.Vector3();

/** Along a limb: `t` from `a` (0) to `b` (1), and the unit direction round it from `ref`, as a cosine. */
function limb(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, ref: THREE.Vector3) {
  const axis = b.clone().sub(a);
  const len = axis.length();
  axis.divideScalar(len);
  const d = p.clone().sub(a);
  const t = d.dot(axis) / len;
  const radial = d.addScaledVector(axis, -d.dot(axis));
  const r = ref.clone().addScaledVector(axis, -ref.dot(axis)).normalize();
  if (radial.lengthSq() < 1e-10) return { t, len, cos: 0, sin: 0 };
  radial.normalize();
  return { t, len, cos: radial.dot(r), sin: radial.dot(axis.clone().cross(r)) };
}

function jacketSpec(r: Rig, kind: FashionKind, under: Float32Array): ShellSpec {
  const pr = r.pr;
  const J = JACKET[kind];
  // A hem never reaches the crotch (the body splits into two legs there; a shell would follow them).
  const pelvis = bone(pr, 'pelvis');
  let crotch = -Infinity;
  for (let w = 0; w < pr.n; w++) {
    const p = V(pr, w);
    if (p.y < pelvis.y && Math.abs(p.x - pelvis.x) < 0.012 && r.armL[w] + r.armR[w] < 0.1) crotch = Math.max(crotch, p.y);
  }
  const hemY = Math.max(pelvis.y - J.hem, crotch + 0.035);
  const sh = { l: bone(pr, 'upperarm_l'), r: bone(pr, 'upperarm_r') };
  const el = { l: bone(pr, 'lowerarm_l'), r: bone(pr, 'lowerarm_r') };
  const wr = { l: bone(pr, 'hand_l'), r: bone(pr, 'hand_r') };
  const chestZ = bone(pr, 'spine_03').z;
  const k = new Float32Array(pr.n), want = new Float32Array(pr.n), data = new Float32Array(pr.n * 4), drape = new Float32Array(pr.n);
  // The sleeve's seam: the arm weights smoothed over the surface, so their half-way line is a clean curve.
  let seam = new Float32Array(pr.n);
  for (let w = 0; w < pr.n; w++) seam[w] = Math.min(1, r.armL[w] + r.armR[w]);
  for (let it = 0; it < 16; it++) {
    const prev = seam;
    seam = new Float32Array(pr.n);
    for (let w = 0; w < pr.n; w++) {
      let sum = prev[w];
      for (const x of pr.adj[w]) sum += prev[x];
      seam[w] = sum / (pr.adj[w].length + 1);
    }
  }
  for (let w = 0; w < pr.n; w++) {
    const p = V(pr, w);
    const arm = r.armL[w] + r.armR[w];
    let kk = (0.35 - r.neck[w]) * 0.15;
    const neckK = kk;
    let cos = 0, coord = p.y;
    if (arm < 0.5) {
      kk = Math.min(kk, p.y - hemY);
      // Torso: how much this is a side (1) rather than front or back (0).
      const dx = p.x, dz = p.z - chestZ;
      cos = Math.abs(dx) / (Math.hypot(dx, dz) || 1);
    }
    for (const s of ['l', 'r'] as const) {
      if ((s === 'l' ? r.armL : r.armR)[w] < 0.5) continue;
      const fore = limb(p, el[s], wr[s], new THREE.Vector3(0, 1, 0));
      kk = Math.min(kk, (J.sleeve - fore.t) * fore.len);
      const whole = limb(p, sh[s], wr[s], new THREE.Vector3(s === 'l' ? 1 : -1, 1.5, 0));
      cos = whole.cos;
      coord = whole.t * whole.len;
    }
    k[w] = kk;
    let h = J.lift;
    if (J.puff) {
      // Down channels: full between the stitch lines, pinched on them.
      const ph = coord / 0.075;
      h += J.puff * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * (ph - Math.floor(ph))), 0.6));
    }
    if (J.collar) h += J.collar * (1 - smooth(0, 0.06, neckK)) * (arm < 0.5 ? 1 : 0);
    if (J.fluff) h += J.fluff * noise3(p.x * 55, p.y * 55, p.z * 55);
    want[w] = h;
    data.set([seam[w], Math.max(0, kk), cos, coord], w * 4);
    // Only the torso drapes (bridging the armpit would web the arm to the body).
    drape[w] = (J.drape ?? 0.012) * (1 - smooth(0.05, 0.3, seam[w]));
  }
  return { k, want, under, over: null, data, drape };
}

function pantsSpec(r: Rig, kind: FashionKind, under: Float32Array, over: Float32Array | null): ShellSpec {
  const pr = r.pr;
  const Pn = PANTS[kind];
  const pelvis = bone(pr, 'pelvis');
  const waistY = pelvis.y + Pn.waist;
  const hip = { l: bone(pr, 'thigh_l'), r: bone(pr, 'thigh_r') };
  const knee = { l: bone(pr, 'calf_l'), r: bone(pr, 'calf_r') };
  const ankle = { l: bone(pr, 'foot_l'), r: bone(pr, 'foot_r') };
  const k = new Float32Array(pr.n), want = new Float32Array(pr.n), data = new Float32Array(pr.n * 4);
  for (let w = 0; w < pr.n; w++) {
    const p = V(pr, w);
    const arm = r.armL[w] + r.armR[w];
    let kk = arm > 0.3 ? -1 : waistY - p.y;
    const side = r.legL[w] >= r.legR[w] ? 'l' : 'r';
    const out = new THREE.Vector3(side === 'l' ? 1 : -1, 0, 0);
    const shin = limb(p, knee[side], ankle[side], out);
    if (r.legL[w] + r.legR[w] > 0.3) kk = Math.min(kk, (Pn.ankle - shin.t) * shin.len);
    const whole = limb(p, hip[side], ankle[side], out);
    k[w] = kk;
    let h = Pn.lift;
    if (kind === 'cargo') {
      // Bellowed pockets on the outer thigh.
      const kneeY = knee[side].y;
      h += 0.011 * smooth(0.45, 0.7, whole.cos) * smooth(kneeY + 0.07, kneeY + 0.1, p.y) * (1 - smooth(kneeY + 0.24, kneeY + 0.27, p.y));
    }
    want[w] = h;
    // Above the crotch the stripe still runs down the side of the hip.
    // Round the leg: (sin, cos) from the outer side; above the crotch, round the hips from the side.
    let cos = whole.cos, sin = whole.sin;
    if (r.legL[w] + r.legR[w] < 0.2) {
      const dx = Math.abs(p.x - pelvis.x), dz = p.z - pelvis.z, l = Math.hypot(dx, dz) || 1;
      cos = dx / l;
      sin = dz / l;
    }
    data.set([sin, Math.max(0, kk), cos, p.y - knee[side].y], w * 4);
  }
  return { k, want, under, over, data, drape: null };
}

// ---------------------------------------------------------------------------------------------
// Materials: one shader patch paints every kind from fRest (bind position), fData and the item's colours

const GLSL_COMMON = `
float fHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float fNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fHash(i), fHash(i + vec3(1,0,0)), f.x), mix(fHash(i + vec3(0,1,0)), fHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fHash(i + vec3(0,0,1)), fHash(i + vec3(1,0,1)), f.x), mix(fHash(i + vec3(0,1,1)), fHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fFbm(vec3 p) { return fNoise(p) * 0.55 + fNoise(p * 2.1) * 0.3 + fNoise(p * 4.3) * 0.15; }
// A monogram tile: a four-petal flower and a small diamond on alternate cells, on a fine lattice.
float fMono(vec2 uv) {
  vec2 c = floor(uv); vec2 f = fract(uv) - 0.5;
  float alt = mod(c.x + c.y, 2.0);
  float a = atan(f.y, f.x); float r = length(f);
  float flower = 1.0 - smoothstep(0.0, 0.03, r - (0.22 + 0.12 * cos(4.0 * a)));
  float dia = 1.0 - smoothstep(0.0, 0.03, abs(f.x) + abs(f.y) - 0.16);
  return mix(flower, dia, alt);
}
float fTri(vec3 p, vec3 n, float s) {
  vec3 w = abs(n); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
  return fMono(p.yz * s) * w.x + fMono(p.xz * s) * w.y + fMono(p.xy * s) * w.z;
}
`;

/** GLSL that sets `fc` (colour, linear) and `fm` (0-1: the shiny/metal parts) per kind. A, B, C are the colours. */
const PAINT: Record<FashionKind, string> = {
  varsity: `
    float sleeve = smoothstep(0.45, 0.55, vData.x);
    fc = mix(fA, fB, sleeve); fm = sleeve;
    float band = 1.0 - smoothstep(0.034, 0.038, vData.y);
    float st = step(0.011, vData.y) * (1.0 - step(0.016, vData.y)) + step(0.021, vData.y) * (1.0 - step(0.026, vData.y));
    fc = mix(fc, mix(fA * 0.82, fC, st), band); fm *= 1.0 - band;`,
  puffer: `
    float ph = fract(vData.w / 0.075); float line = 1.0 - smoothstep(0.0, 0.07, min(ph, 1.0 - ph));
    fc = mix(fA, fB, line * 0.85); fm = 1.0 - line;
    float band = 1.0 - smoothstep(0.03, 0.034, vData.y); fc = mix(fc, fC, band); fm *= 1.0 - band;`,
  leather: `
    fc = fA; fm = 0.0;
    float arm = step(0.5, vData.x);
    float stripe = arm * smoothstep(0.86, 0.875, vData.z);
    float pipe = arm * (smoothstep(0.82, 0.835, vData.z) - smoothstep(0.85, 0.86, vData.z));
    float chest = (1.0 - arm) * (1.0 - smoothstep(0.016, 0.019, abs(vRest.y - fY.x)));
    float panel = (1.0 - arm) * smoothstep(0.84, 0.86, vData.z);
    fc = mix(fc, fB, max(max(stripe, chest), panel)); fc = mix(fc, fC, pipe);
    float zip = (1.0 - arm) * (1.0 - smoothstep(0.003, 0.0045, abs(vRest.x - fY.y))) * step(fY.z, vRest.z);
    fc = mix(fc, fC, zip); fm = zip;
    float band = 1.0 - smoothstep(0.022, 0.025, vData.y); fc = mix(fc, fA * 0.7, band);`,
  monogram: `
    float m = fTri(vRest, vRN, 26.0);
    fc = mix(fA, fB, m); fm = m;
    float lat = fTri(vRest + 0.019, vRN, 26.0);
    fc = mix(fc, fC, lat * 0.35 * (1.0 - m));
    float band = 1.0 - smoothstep(0.035, 0.039, vData.y);
    float st = step(0.014, vData.y) * (1.0 - step(0.02, vData.y));
    fc = mix(fc, mix(fC, fB, st), band); fm = mix(fm, st, band);`,
  chrome: `
    fc = fA; fm = 1.0;
    float band = 1.0 - smoothstep(0.034, 0.038, vData.y);
    float rib = 0.5 + 0.5 * sin(vData.y * 900.0);
    fc = mix(fc, fB * (0.85 + 0.3 * rib), band); fm = 1.0 - band;`,
  fur: `
    // Long soft guard hairs: noise stretched down the body, darker at the roots, tipped lighter.
    float strands = fFbm(vec3(vRest.x * 260.0, vRest.y * 26.0, vRest.z * 260.0));
    float clumps = fFbm(vRest * 38.0);
    fc = mix(fC, fA, smoothstep(0.2, 0.75, clumps));
    fc = mix(fc, fB, smoothstep(0.55, 0.9, strands) * 0.7);
    fc *= 0.85 + 0.25 * strands; fm = 0.0;`,
  track: `
    float a = atan(vData.x, vData.z);
    float st = (step(0.035, a) - step(0.16, a)) + (step(-0.16, a) - step(-0.035, a));
    fc = mix(fA, fB, st); fm = 0.0;
    float band = 1.0 - smoothstep(0.035, 0.038, vData.y); fc = mix(fc, fA * 0.78, band);`,
  camo: `
    float n = fFbm(vRest * 9.0 + 3.1); float n2 = fFbm(vRest * 13.0 - 7.7);
    fc = fA; fc = mix(fc, fB, step(0.56, n)); fc = mix(fc, fC, step(0.6, n2)); fm = 0.0;
    float band = 1.0 - smoothstep(0.04, 0.043, vData.y); fc = mix(fc, fA * 0.75, band);`,
  cargo: `
    fc = fA; fm = 0.0;
    float pocket = smoothstep(0.5, 0.52, vData.z) * step(0.07, vData.w) * (1.0 - step(0.26, vData.w));
    float flap = pocket * step(0.215, vData.w);
    fc = mix(fc, fB, pocket); fc = mix(fc, fB * 0.8, flap);
    float tab = pocket * (1.0 - step(0.012, abs(vData.w - 0.2))) * smoothstep(0.62, 0.64, vData.z) * (1.0 - smoothstep(0.7, 0.72, vData.z));
    fc = mix(fc, fC, tab); fm = tab;
    float band = 1.0 - smoothstep(0.035, 0.038, vData.y); fc = mix(fc, fA * 0.78, band);`,
  moto: `
    fc = fA; fm = 0.0;
    float knee = 1.0 - smoothstep(0.07, 0.075, abs(vData.w + 0.01));
    float q = fract(vData.w / 0.022); float stitch = 1.0 - smoothstep(0.0, 0.12, min(q, 1.0 - q));
    fc = mix(fc, mix(fB, fB * 0.7, stitch), knee);
    float pipe = 1.0 - smoothstep(0.03, 0.04, abs(atan(vData.x, vData.z)));
    fc = mix(fc, fC, pipe); fm = pipe;
    float band = 1.0 - smoothstep(0.03, 0.033, vData.y); fc = mix(fc, fA * 0.75, band);`,
  // Hats (vData: x 0 brim .. 1 crown, y metres up from the brim, z round the head 0-1, w 1 on a brim or peak).
  beanie: `
    float rib = 0.5 + 0.5 * sin(vData.z * 6.2832 * 64.0);
    float cuff = 1.0 - step(0.045, vData.y);
    fc = fA * (0.9 + 0.14 * rib); fc = mix(fc, fB * (0.9 + 0.14 * rib), cuff);
    float fold = 1.0 - smoothstep(0.0, 0.004, abs(vData.y - 0.045)); fc *= 1.0 - 0.25 * fold;
    float tag = cuff * step(0.012, vData.y) * (1.0 - step(0.034, vData.y)) * (1.0 - step(0.035, min(vData.z, 1.0 - vData.z)));
    fc = mix(fc, fC, tag); fm = 0.0;`,
  cap: `
    fc = mix(fA, fB, vData.w); fm = 0.0;
    float seam = 1.0 - smoothstep(0.0, 0.004, abs(fract(vData.z * 6.0 + 0.5) - 0.5)); fc *= 1.0 - 0.22 * seam * (1.0 - vData.w);
    float eye = (1.0 - vData.w) * (1.0 - smoothstep(0.004, 0.006, length(vec2((fract(vData.z * 6.0) - 0.5) * 0.3, vData.x - 0.72))));
    float button = (1.0 - vData.w) * smoothstep(0.965, 0.975, vData.x);
    fc = mix(fc, fC, max(eye, button)); fm = max(eye, button);`,
  bucket: `
    float m = fTri(vRest, vRN, 30.0);
    fc = mix(fA, fB, m * 0.7); fm = 0.0;
    float q = fract(vData.y / 0.011); float stitch = vData.w * (1.0 - smoothstep(0.0, 0.1, min(q, 1.0 - q)));
    fc = mix(fc, fC, stitch * 0.6);`,
  shield: 'fc = fA; fm = 1.0;',
  round: 'fc = fA; fm = 1.0;',
  cuban: 'fc = fA; fm = 1.0;',
  pendant: 'fc = fA; fm = 1.0;',
};

/** How each kind's surface feels: cloth roughness, its shiny parts' roughness and metalness, and the extras. */
const FEEL: Record<FashionKind, { rough: number; shineRough: number; shineMetal: number; coat?: number; sheen?: number; iri?: boolean }> = {
  varsity: { rough: 0.92, shineRough: 0.4, shineMetal: 0 },
  puffer: { rough: 0.85, shineRough: 0.3, shineMetal: 0, coat: 0.6 },
  leather: { rough: 0.38, shineRough: 0.25, shineMetal: 0.9, coat: 0.5 },
  monogram: { rough: 0.6, shineRough: 0.3, shineMetal: 0.9, sheen: 0.5 },
  chrome: { rough: 0.9, shineRough: 0.1, shineMetal: 1, coat: 1, iri: true },
  fur: { rough: 1, shineRough: 1, shineMetal: 0, sheen: 1 },
  track: { rough: 0.55, shineRough: 0.55, shineMetal: 0, sheen: 0.4 },
  camo: { rough: 0.95, shineRough: 0.95, shineMetal: 0 },
  cargo: { rough: 0.8, shineRough: 0.35, shineMetal: 0.8 },
  moto: { rough: 0.42, shineRough: 0.25, shineMetal: 0.9, coat: 0.4 },
  beanie: { rough: 1, shineRough: 1, shineMetal: 0, sheen: 0.6 },
  cap: { rough: 0.85, shineRough: 0.25, shineMetal: 0.9 },
  bucket: { rough: 0.9, shineRough: 0.9, shineMetal: 0, sheen: 0.4 },
  shield: { rough: 0.1, shineRough: 0.1, shineMetal: 1 },
  round: { rough: 0.2, shineRough: 0.2, shineMetal: 1 },
  cuban: { rough: 0.2, shineRough: 0.2, shineMetal: 1 },
  pendant: { rough: 0.15, shineRough: 0.15, shineMetal: 1 },
};

const lin = (c: number) => new THREE.Color().setHex(c);

/** The painted material for a shell or a hat. `y`: extra numbers a kind reads (the leather's chest stripe and zip). */
function clothMaterial(item: FashionItem, y = new THREE.Vector3()): THREE.MeshPhysicalMaterial {
  const f = FEEL[item.kind];
  const m = new THREE.MeshPhysicalMaterial({ name: `fashion_${item.kind}`, color: 0xffffff, roughness: f.rough, metalness: 0, side: THREE.DoubleSide, clearcoat: f.coat ?? 0, clearcoatRoughness: 0.3 });
  if (f.sheen) {
    m.sheen = f.sheen;
    m.sheenColor = lin(item.colors[1]);
    m.sheenRoughness = 0.5;
  }
  if (f.iri) {
    m.iridescence = 1;
    m.iridescenceIOR = 1.7;
    m.iridescenceThicknessRange = [250, 800];
  }
  const uniforms = {
    fA: { value: lin(item.colors[0]) },
    fB: { value: lin(item.colors[1]) },
    fC: { value: lin(item.colors[2]) },
    fY: { value: y },
    fShine: { value: new THREE.Vector2(f.shineRough, f.shineMetal) },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 fRest;\nattribute vec4 fData;\nvarying vec3 vRest;\nvarying vec4 vData;\nvarying vec3 vRN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = fRest; vData = fData; vRN = normal;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 fA; uniform vec3 fB; uniform vec3 fC; uniform vec3 fY; uniform vec2 fShine;\nvarying vec3 vRest;\nvarying vec4 vData;\nvarying vec3 vRN;\n${GLSL_COMMON}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\nvec3 fc = fA; float fm = 0.0;\n{${PAINT[item.kind]}\n}\ndiffuseColor.rgb = fc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, fShine.x, fm);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, fShine.y, fm);`);
  };
  m.customProgramCacheKey = () => `fashion-${item.kind}`;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Hats: a dome over the head and hair

interface HeadFrame {
  /** The skull's centre at eye height, the eyes' height, the crown's height, half the head's width. */
  c: THREE.Vector3;
  eyeY: number;
  top: number;
  half: number;
  /** The face's front at eye height (z), and the head's width there (x, half). */
  front: number;
  temple: number;
}

const worldPoints = (m: THREE.SkinnedMesh, keep: (p: THREE.Vector3, i: number) => boolean = () => true): THREE.Vector3[] => {
  const pos = m.geometry.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix);
    if (keep(p, i)) out.push(p);
  }
  return out;
};

function headFrame(pr: Prep, eyes: THREE.SkinnedMesh | null, faceBits: THREE.SkinnedMesh[]): HeadFrame | null {
  if (!eyes) return null;
  const eyeBox = new THREE.Box3().setFromPoints(worldPoints(eyes));
  const eye = eyeBox.getCenter(new THREE.Vector3());
  const headW = weightOn(pr, (b) => b === 'head');
  const head: THREE.Vector3[] = [];
  for (let w = 0; w < pr.n; w++) if (headW[w] > 0.6) head.push(V(pr, w));
  if (!head.length) return null;
  const top = Math.max(...head.map((p) => p.y));
  const above = head.filter((p) => p.y > eye.y);
  const box = new THREE.Box3().setFromPoints(above);
  const c = new THREE.Vector3((box.min.x + box.max.x) / 2, eye.y, (box.min.z + box.max.z) / 2);
  const band = head.filter((p) => Math.abs(p.y - eye.y) < 0.025);
  // The temples: the head's sides ahead of the ears.
  const temple = Math.min((box.max.x - box.min.x) / 2, Math.max(...band.filter((p) => p.z > c.z + 0.015).map((p) => Math.abs(p.x - c.x))));
  // The front of the face over the eyes: brow ridge, lashes, brows (not the nose: it's in the middle).
  const facePts = [...band, ...faceBits.flatMap((m) => worldPoints(m))].filter((p) => Math.abs(p.y - eye.y) < 0.035 && Math.abs(p.x - c.x) > 0.012);
  const front = Math.max(...facePts.map((p) => p.z), eyeBox.max.z);
  return { c, eyeY: eye.y, top, half: (box.max.x - box.min.x) / 2, front, temple };
}

/** The brim's height round the head (`phi` 0 = front, the file faces +Z). */
function brimY(f: HeadFrame, phi: number): number {
  const h = f.top - f.eyeY;
  const cs = Math.cos(phi);
  const k = cs > 0 ? HAT.side + (HAT.front - HAT.side) * cs : HAT.side + (HAT.back - HAT.side) * -cs;
  return f.eyeY + h * k;
}

/** The dome: radius per (around, up) cell from the skull's centre so every head and hair point is inside, plus air. */
function dome(f: HeadFrame, pts: THREE.Vector3[], extra: (phi: number, u: number) => number) {
  const A = HAT.around, U = HAT.up;
  const R = Array.from({ length: A }, () => new Float32Array(U + 1));
  const base = (phi: number) => Math.atan2(brimY(f, phi) - f.c.y, f.half);
  for (const p of pts) {
    const d = p.clone().sub(f.c);
    const phi = Math.atan2(d.x, d.z);
    const by = brimY(f, phi);
    if (p.y < by - 0.012) continue;
    const r = Math.hypot(d.x, d.z);
    const beta = Math.atan2(d.y, r);
    const b0 = base(phi);
    const u = Math.max(0, Math.min(1, (beta - b0) / (Math.PI / 2 - b0)));
    const i = ((Math.round((phi / (Math.PI * 2)) * A) % A) + A) % A;
    // The top ring stops short of the pole (the pole is its own point), so anything above it counts for it.
    const j = Math.min(U, Math.round(u * (U + 1)));
    R[i][j] = Math.max(R[i][j], d.length());
  }
  // Fill gaps from the row, spread each cell's need to its neighbours (a point between cells must still be inside).
  const fallback = Math.max(...R.map((row) => Math.max(...row)));
  for (const row of R) for (let j = 0; j <= U; j++) if (!row[j]) row[j] = Math.max(...row) || fallback;
  const out = R.map((row) => row.slice());
  for (let i = 0; i < A; i++)
    for (let j = 0; j <= U; j++) {
      let m = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) m = Math.max(m, R[(i + di + A) % A][Math.max(0, Math.min(U, j + dj))]);
      out[i][j] = m;
    }
  // Soften (never inward of the need).
  for (let pass = 0; pass < 2; pass++) {
    const prev = out.map((row) => row.slice());
    for (let i = 0; i < A; i++)
      for (let j = 0; j <= U; j++) {
        let s = 0;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) s += prev[(i + di + A) % A][Math.max(0, Math.min(U, j + dj))];
        out[i][j] = Math.max(prev[i][j], s / 9);
      }
  }
  // Near the top every ring is round (its widest), so the crown closes in one even curve, not a tent.
  for (let j = U - 3; j <= U; j++) {
    let m = 0;
    for (let i = 0; i < A; i++) m = Math.max(m, out[i][j]);
    for (let i = 0; i < A; i++) out[i][j] = out[i][j] + (m - out[i][j]) * Math.min(1, (j - (U - 4)) / 3);
  }
  const ptAt = (i: number, j: number, rad: number) => {
    const phi = (i / A) * Math.PI * 2;
    const b0 = base(phi);
    const beta = b0 + (j / (U + 1)) * (Math.PI / 2 - b0);
    return new THREE.Vector3(Math.sin(phi) * Math.cos(beta), Math.sin(beta), Math.cos(phi) * Math.cos(beta)).multiplyScalar(rad).add(f.c);
  };
  /** Is a point under the crown (above the brim and within the dome)? */
  const inside = (p: THREE.Vector3) => {
    const d = p.clone().sub(f.c);
    const phi = Math.atan2(d.x, d.z);
    if (p.y < brimY(f, phi) + 0.006) return false;
    const b0 = base(phi);
    const u = Math.max(0, Math.min(1, (Math.atan2(d.y, Math.hypot(d.x, d.z)) - b0) / (Math.PI / 2 - b0)));
    const i = ((Math.round((phi / (Math.PI * 2)) * A) % A) + A) % A;
    return d.length() < out[i][Math.min(U, Math.round(u * (U + 1)))] + HAT.clear * 0.5;
  };
  return {
    at: (i: number, j: number) => ptAt(i, j, out[i % A][j] + HAT.clear + extra((i / A) * Math.PI * 2, j / U)),
    inside,
    A,
    U,
  };
}

/** Builds a hat for `item` as a mesh in bind-world space. */
function hatGeometry(item: FashionItem, f: HeadFrame, pts: THREE.Vector3[]): { geo: THREE.BufferGeometry; inside: (p: THREE.Vector3) => boolean } {
  const kind = item.kind;
  const extra = (phi: number, u: number) => {
    if (kind === 'beanie') return (u < 0.28 ? 0.006 : 0) + 0.012 * u * u * Math.max(0, -Math.cos(phi) * 0.6 + 0.4);
    if (kind === 'bucket') return 0.004 + 0.01 * u;
    return 0.002;
  };
  const d = dome(f, pts, extra);
  const P: number[] = [], R: number[] = [], D: number[] = [], idx: number[] = [];
  const add = (p: THREE.Vector3, data: number[]) => {
    P.push(p.x, p.y, p.z);
    R.push(p.x, p.y, p.z);
    D.push(...data);
    return P.length / 3 - 1;
  };
  // Crown: (A + 1) × (U + 1) grid (the seam column doubled so `around` doesn't wrap), the pole closed.
  const grid: number[][] = [];
  for (let i = 0; i <= d.A; i++) {
    grid.push([]);
    for (let j = 0; j <= d.U; j++) {
      const p = d.at(i, j);
      const brim = d.at(i, 0);
      grid[i].push(add(p, [j / d.U, Math.max(0, p.y - brim.y) + (j / d.U) * 0.05, i / d.A, 0]));
    }
  }
  for (let i = 0; i < d.A; i++)
    for (let j = 0; j < d.U; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], e = grid[i][j + 1];
      idx.push(a, e, b, b, e, c);
    }
  // The crown's top: the middle of the top ring, as high as its highest point (so nothing between them pokes out).
  const pole = new THREE.Vector3();
  let poleY = -Infinity;
  for (let i = 0; i < d.A; i++) {
    const p = d.at(i, d.U);
    pole.add(p);
    poleY = Math.max(poleY, p.y);
  }
  pole.divideScalar(d.A).setY(poleY + 0.004);
  const poleI = add(pole, [1, 0.2, 0.5, 0]);
  for (let i = 0; i < d.A; i++) idx.push(grid[i][d.U], poleI, grid[i + 1][d.U]);
  // Brims, peaks and the turned-in edge.
  const edge = (i: number) => d.at(i, 0);
  const outward = (i: number) => {
    const p = edge(i).sub(f.c);
    p.y = 0;
    return p.normalize();
  };
  if (kind === 'bucket') {
    const ring: [number, number][] = [];
    for (let i = 0; i <= d.A; i++) {
      const e = edge(i);
      const o = e.clone().addScaledVector(outward(i), 0.06).add(new THREE.Vector3(0, -0.032, 0));
      ring.push([add(e, [0, 0, i / d.A, 1]), add(o, [0, 0.065, i / d.A, 1])]);
    }
    for (let i = 0; i < d.A; i++) idx.push(ring[i][0], ring[i + 1][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], ring[i][1]);
  } else if (kind === 'cap') {
    // A curved peak over the front third, a little lower at its tips.
    const span = Math.round(d.A * 0.2);
    const row: [number, number][] = [];
    for (let s = -span; s <= span; s++) {
      const i = (s + d.A) % d.A;
      const t = s / span;
      const e = edge(i).add(new THREE.Vector3(0, -0.004, 0));
      const reach = 0.078 * Math.sqrt(1 - t * t * 0.85);
      const o = e.clone().addScaledVector(new THREE.Vector3(0, 0, 1), reach).addScaledVector(outward(i), 0.012).add(new THREE.Vector3(0, -0.012 - 0.01 * t * t, 0));
      row.push([add(e, [0, 0, (s + span) / (2 * span), 1]), add(o, [0, 0.08, (s + span) / (2 * span), 1])]);
    }
    for (let s = 0; s + 1 < row.length; s++) idx.push(row[s][0], row[s + 1][0], row[s][1], row[s + 1][0], row[s + 1][1], row[s][1]);
  }
  // The edge turned in toward the head, so the hat has a thickness.
  const tuck: number[] = [];
  for (let i = 0; i <= d.A; i++) {
    const e = edge(i);
    tuck.push(add(e.clone().addScaledVector(e.clone().sub(f.c).normalize(), -0.006), [0, 0, i / d.A, 0]));
  }
  for (let i = 0; i < d.A; i++) idx.push(grid[i][0], grid[i + 1][0], tuck[i], grid[i + 1][0], tuck[i + 1], tuck[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('fRest', new THREE.Float32BufferAttribute(R, 3));
  g.setAttribute('fData', new THREE.Float32BufferAttribute(D, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, inside: d.inside };
}

// ---------------------------------------------------------------------------------------------
// Shades: lenses in front of the eyes, arms back past the temples

function shadesGroup(item: FashionItem, f: HeadFrame, eyes: THREE.Box3): { group: THREE.Group; mats: THREE.Material[] } {
  const group = new THREE.Group();
  const frame = new THREE.MeshPhysicalMaterial({ name: 'fashion_frame', color: item.colors[0], roughness: 0.22, metalness: 1, clearcoat: 0.5 });
  const lens = new THREE.MeshPhysicalMaterial({ name: 'fashion_lens', color: item.colors[1], roughness: 0.06, metalness: 0.85, clearcoat: 1 });
  if (item.kind === 'shield') {
    lens.iridescence = 1;
    lens.iridescenceIOR = 1.9;
    lens.iridescenceThicknessRange = [300, 900];
    lens.emissive = lin(item.colors[2]);
    lens.emissiveIntensity = 0.12;
  }
  const z = f.front + 0.012;
  const wide = f.temple + 0.005;
  const ex = (eyes.max.x - eyes.min.x) / 2;
  const eyeR = Math.max(0.017, ex * 0.42);
  const backZ = f.c.z - 0.01;
  const dz = z - f.c.z;
  if (item.kind === 'round') {
    for (const s of [-1, 1]) {
      const cx = f.c.x + s * ex * 0.55;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(eyeR, 0.0016, 6, 32), frame);
      rim.position.set(cx, f.eyeY, z);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(eyeR, 32), lens);
      disc.position.set(cx, f.eyeY, z - 0.0008);
      // Temple arms: from the rim's outer edge back past the ear, hugging the head's side.
      const from = new THREE.Vector3(cx + s * eyeR, f.eyeY, z);
      const to = new THREE.Vector3(f.c.x + s * wide, f.eyeY + 0.004, backZ);
      const mid = new THREE.Vector3(f.c.x + s * wide, f.eyeY + 0.003, z - 0.012);
      const arm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, to]), 10, 0.0014, 5), frame);
      group.add(rim, disc, arm);
    }
    const bridge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(f.c.x - ex * 0.55 + eyeR, f.eyeY + 0.004, z), new THREE.Vector3(f.c.x, f.eyeY + 0.012, z + 0.004), new THREE.Vector3(f.c.x + ex * 0.55 - eyeR, f.eyeY + 0.004, z)), 8, 0.0014, 5), frame);
    group.add(bridge);
  } else {
    // One wraparound lens: a band of a cylinder round the skull's centre, reaching back to the temples.
    const r = Math.hypot(dz, 0);
    const reach = Math.min(Math.PI * 0.42, Math.asin(Math.min(0.98, wide / r)) + 0.1);
    const lensG = new THREE.CylinderGeometry(r, r, 0.042, 40, 1, true, -reach, reach * 2);
    const band = new THREE.Mesh(lensG, lens);
    band.material.side = THREE.DoubleSide;
    band.position.set(f.c.x, f.eyeY + 0.003, f.c.z);
    band.scale.set(Math.max(1, wide / r + 0.04), 1, 1);
    const browG = new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.006, 40, 1, true, -reach, reach * 2);
    const brow = new THREE.Mesh(browG, frame);
    brow.material.side = THREE.DoubleSide;
    brow.position.set(f.c.x, f.eyeY + 0.026, f.c.z);
    brow.scale.copy(band.scale);
    group.add(band, brow);
    for (const s of [-1, 1]) {
      const from = new THREE.Vector3(f.c.x + s * wide * 1.02, f.eyeY + 0.02, f.c.z + Math.cos(reach) * r * 0.95);
      const to = new THREE.Vector3(f.c.x + s * wide, f.eyeY + 0.02, backZ);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(from, to), 2, 0.0022, 5), frame));
    }
  }
  return { group, mats: [frame, lens] };
}

// ---------------------------------------------------------------------------------------------
// Chains: links lying on whatever's worn on the chest

function chainGeometry(pr: Prep, item: FashionItem, surface: THREE.Vector3[]): THREE.BufferGeometry {
  const neck = bone(pr, 'neck_01');
  const spine = bone(pr, 'spine_03');
  // Round the base of the neck at the back, down onto the chest in front; the sides stay close to the neck (it
  // drapes over the trapezius, not the shoulders).
  const back = neck.y - 0.008;
  const front = neck.y - (item.kind === 'pendant' ? 0.2 : 0.165);
  const axis = new THREE.Vector2(neck.x, neck.z * 0.7 + spine.z * 0.3);
  const N = 72;
  const rad = new Float32Array(N);
  const yAt = (th: number) => back + (front - back) * smooth(-0.25, 1, Math.cos(th)) ** 2;
  // Nothing further out than this counts (shoulders, arms).
  // The chain rests on whatever is worn, from above: in each direction round the neck it lies at the outermost
  // point that is still at or above its height (the slope of the shoulders, the front of the chest).
  const STEP = 0.004, RMAX = 0.24;
  const tops = Array.from({ length: N }, () => new Float32Array(Math.ceil(RMAX / STEP)).fill(-Infinity));
  for (const p of surface) {
    const dx = p.x - axis.x, dz = p.z - axis.y;
    const r = Math.hypot(dx, dz);
    if (r >= RMAX) continue;
    const th = Math.atan2(dx, dz);
    const i = ((Math.round((th / (Math.PI * 2)) * N) % N) + N) % N;
    const j = Math.floor(r / STEP);
    tops[i][j] = Math.max(tops[i][j], p.y);
  }
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const y = yAt(th);
    // Neighbouring directions count too (a point between two of them must still be under the chain).
    for (let j = tops[i].length - 1; j >= 0; j--) {
      if (Math.max(tops[i][j], tops[(i + 1) % N][j], tops[(i + N - 1) % N][j]) >= y - 0.004) {
        rad[i] = (j + 1) * STEP;
        break;
      }
    }
  }
  for (let pass = 0; pass < N && rad.some((x) => !x); pass++) {
    const prev = rad.slice();
    for (let i = 0; i < N; i++) if (!prev[i]) rad[i] = Math.max(prev[(i + 1) % N], prev[(i + N - 1) % N]);
  }
  if (!rad[0]) rad.fill(0.08);
  const need = rad.slice();
  // An even curve: smoothed, never more than a few millimetres in from what it rests on.
  for (let pass = 0; pass < 8; pass++) {
    const prev = rad.slice();
    for (let i = 0; i < N; i++) rad[i] = Math.max(need[i] - 0.003, (prev[(i + 2) % N] + prev[(i + 1) % N] + prev[i] + prev[(i + N - 1) % N] + prev[(i + N - 2) % N]) / 5);
  }
  const link = item.kind === 'pendant' ? 0.0042 : 0.0062;
  const wire = item.kind === 'pendant' ? 0.0013 : 0.0021;
  const curve: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r = rad[i] + link + 0.004;
    curve.push(new THREE.Vector3(axis.x + Math.sin(th) * r, yAt(th), axis.y + Math.cos(th) * r));
  }
  const path = new THREE.CatmullRomCurve3(curve, true);
  const count = Math.floor(path.getLength() / (link * 1.55));
  const parts: THREE.BufferGeometry[] = [];
  const torus = new THREE.TorusGeometry(link, wire, 5, 10);
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    // The link's ring lies along the chain, every other one turned a quarter about it.
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
    const twist = new THREE.Quaternion().setFromAxisAngle(tan, i % 2 ? Math.PI / 2 : 0.25);
    m.compose(p, twist.multiply(q), new THREE.Vector3(1, 1, 1));
    const g = torus.clone().applyMatrix4(m);
    parts.push(g);
  }
  if (item.kind === 'pendant') {
    // The stone hangs from the lowest link, standing off the chest.
    const p = path.getPointAt(0);
    const out = new THREE.Vector3(0, 0, 1);
    const stone = new THREE.OctahedronGeometry(0.016, 0).scale(0.8, 1.15, 0.45).translate(p.x, p.y - 0.026, p.z + 0.006).toNonIndexed();
    const bail = new THREE.TorusGeometry(0.005, 0.0016, 5, 10).rotateY(Math.PI / 2).translate(p.x, p.y - 0.006, p.z + 0.003);
    parts.push(stone.index ? stone : stone, bail.toNonIndexed());
    void out;
    void up;
  }
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
  }
  const merged = mergeFlat(flat);
  merged.computeVertexNormals();
  return merged;
}

/** Concatenates non-indexed geometries' positions. */
function mergeFlat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = list.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const a = g.getAttribute('position').array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Skins a bind-world geometry with the weights of the skin nearest each vertex, turned into the body's geometry space. */
function skinToBody(pr: Prep, g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const si = new Uint16Array(pos.count * 4), sw = new Float32Array(pos.count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = 0, bd = Infinity;
    for (let r = 0; r <= 3 && bd === Infinity; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const l = pr.grid.get(cellKey(v.x + dx * CELL, v.y + dy * CELL, v.z + dz * CELL));
            if (l) for (const w of l) {
              const d = V(pr, w).distanceToSquared(v);
              if (d < bd) {
                bd = d;
                best = w;
              }
            }
          }
    si.set(pr.si.subarray(best * 4, best * 4 + 4), i * 4);
    sw.set(pr.sw.subarray(best * 4, best * 4 + 4), i * 4);
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.applyMatrix4(pr.toGeo);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Dressing an assembled driver

/** One of the assembled driver's other meshes, by what it is. */
export interface WornMesh {
  mesh: THREE.SkinnedMesh;
  role: 'top' | 'bottom' | 'shoes' | 'hair' | 'brows' | 'kit' | 'other';
}

export interface Dressed {
  /** Materials made for these pieces (the rig frees them). */
  owned: THREE.Material[];
}

/** Geometry is cached per base and per what it was fitted over (like the wardrobe's, never disposed). */
const shells = new Map<string, { geo: THREE.BufferGeometry; h: Float32Array; k: Float32Array }>();
const extras = new Map<string, THREE.BufferGeometry>();
const culls = new Map<string, THREE.BufferGeometry>();
const hats = new Map<string, { geo: THREE.BufferGeometry; tucked: THREE.BufferGeometry[] }>();

/**
 * Puts a look's fashion pieces on an assembled driver (`scene` in its bind pose). `body` is the body mesh with its
 * whole geometry (before clothes hid any skin), `bodyGeo` the geometry the look shows (skin under clothes already
 * gone), `worn` its other meshes; `topCover` says which skin the worn top covers (for trousers under it). Replaces
 * the body's and the worn meshes' geometry where a piece hides some of them.
 */
export function dress(
  scene: THREE.Object3D,
  body: THREE.SkinnedMesh,
  full: THREE.BufferGeometry,
  key: string,
  ids: readonly FashionId[],
  worn: WornMesh[],
  topCover: ((v: number) => boolean) | null,
): Dressed {
  const owned: THREE.Material[] = [];
  if (!ids.length) return { owned };
  const pr = prepare(body, full);
  const rig = rigOf(pr);
  const items = ids.map((id) => ({ id, item: FASHION[id] as FashionItem }));
  const holder = body.parent!;
  const addSkinned = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = name;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.scale.copy(body.scale);
    mesh.castShadow = body.castShadow;
    mesh.frustumCulled = false;
    holder.add(mesh);
    mesh.bind(body.skeleton, body.bindMatrix);
    return mesh;
  };
  const role = (r: WornMesh['role']) => worn.filter((m) => m.role === r).map((m) => m.mesh);
  const hideIn: { k: Float32Array; h: Float32Array }[] = [];
  const pantsIt = items.find((x) => x.item.slot === 'pants');
  const jacketIt = items.find((x) => x.item.slot === 'jacket');
  let pantsH: Float32Array | null = null;
  let pantsK: Float32Array | null = null;

  // Trousers first: the jacket clears them.
  if (pantsIt) {
    const k = `${key}|${pantsIt.id}`;
    let s = shells.get(k);
    if (!s) {
      const under = layer(pr, role('shoes'), true);
      // Stay under the top where it covers (its lowest point over each skin vertex).
      const over = topCover ? layer(pr, role('top'), false, 1) : null;
      const spec = pantsSpec(rig, pantsIt.item.kind, under, over);
      const built = buildShell(pr, spec);
      // Where the top covers the trousers well inside its edge, drop the trousers (nothing to poke out).
      if (topCover) {
        const cover = new Uint8Array(pr.n);
        const index = full.getIndex()!;
        for (let i = 0; i < pr.rep.length; i++) if (topCover(i)) cover[pr.rep[i]] = 1;
        void index;
        for (let r = 0; r < 2; r++) {
          const prev = cover.slice();
          for (let w = 0; w < pr.n; w++) if (prev[w]) for (const x of pr.adj[w]) if (!prev[x]) cover[w] = 0;
        }
        const src = built.geo;
        const rest = src.getAttribute('fRest');
        // Shell vertices map back to skin by their rest position.
        const near = (i: number) => {
          const l = pr.grid.get(cellKey(rest.getX(i), rest.getY(i), rest.getZ(i)));
          if (!l) return -1;
          let best = -1, bd = 1e-8;
          for (const w of l) {
            const d = (pr.W[w * 3] - rest.getX(i)) ** 2 + (pr.W[w * 3 + 1] - rest.getY(i)) ** 2 + (pr.W[w * 3 + 2] - rest.getZ(i)) ** 2;
            if (d < bd) {
              bd = d;
              best = w;
            }
          }
          return best;
        };
        const covered = (i: number) => {
          const w = near(i);
          return w >= 0 && cover[w] === 1;
        };
        built.geo = dropTriangles(src, (a, b, c) => covered(a) && covered(b) && covered(c));
      }
      shells.set(k, (s = built));
    }
    pantsH = s.h;
    pantsK = s.k;
    const mat = clothMaterial(pantsIt.item);
    owned.push(mat);
    addSkinned(s.geo, mat, `fashion_${pantsIt.id}`);
    hideIn.push({ k: s.k, h: s.h });
  }

  if (jacketIt) {
    const k = `${key}|${pantsIt?.id ?? ''}|${jacketIt.id}`;
    let s = shells.get(k);
    if (!s) {
      const under = layer(pr, role('bottom'), true);
      if (pantsH && pantsK) for (let w = 0; w < pr.n; w++) if (pantsK[w] > 0) under[w] = Math.max(under[w], pantsH[w]);
      s = buildShell(pr, jacketSpec(rig, jacketIt.item.kind, under));
      shells.set(k, s);
    }
    const sh = bone(pr, 'upperarm_l').y;
    const y = new THREE.Vector3(sh - 0.13, bone(pr, 'spine_03').x, bone(pr, 'spine_03').z);
    const mat = clothMaterial(jacketIt.item, y);
    owned.push(mat);
    addSkinned(s.geo, mat, `fashion_${jacketIt.id}`);
    hideIn.push({ k: s.k, h: s.h });
  }

  // Skin under the pieces goes, and whatever else ended up deep inside them.
  if (hideIn.length) {
    const ck = `${key}|${ids.join('+')}|body`;
    let bg = culls.get(ck);
    if (!bg) {
      const geo = body.geometry;
      const covered = (v: number) => hideIn.some((s) => s.k[pr.rep[v]] > 0);
      bg = dropTriangles(geo, (a, b, c) => covered(a) && covered(b) && covered(c));
      culls.set(ck, bg);
    }
    body.geometry = bg;
    for (const wm of worn) {
      if (wm.role === 'brows' || wm.role === 'other') continue;
      const mk = `${key}|${ids.join('+')}|${wm.mesh.name}|${wm.mesh.geometry.uuid}`;
      let g = culls.get(mk);
      if (!g) {
        const an = anchors(pr, wm.mesh);
        const inside = (i: number) => {
          const w = an.at[i];
          return w >= 0 && hideIn.some((s) => s.k[w] > INSIDE && an.h[i] < s.h[w] + 0.002);
        };
        g = dropTriangles(wm.mesh.geometry, (a, b, c) => inside(a) && inside(b) && inside(c));
        culls.set(mk, g);
      }
      wm.mesh.geometry = g;
    }
  }

  // Hats, shades and chains.
  const eyes = (() => {
    let e: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && /^low-poly/.test(o.name)) e = o as THREE.SkinnedMesh;
    });
    return e as THREE.SkinnedMesh | null;
  })();
  let headBone: THREE.Bone | null = null;
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone && o.name === 'head') headBone = o as THREE.Bone;
  });
  const lashes = (() => {
    const out: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && /eyelash/.test(o.name)) out.push(o as THREE.SkinnedMesh);
    });
    return out;
  })();
  const frame = headFrame(pr, eyes, [...lashes, ...role('brows')]);
  const onHead = (obj: THREE.Object3D) => {
    if (!headBone) return;
    scene.add(obj);
    obj.updateMatrixWorld(true);
    (headBone as THREE.Bone).attach(obj);
  };
  for (const { id, item } of items) {
    if (item.slot === 'hat' && frame) {
      const k = `${key}|${id}`;
      let hat = hats.get(k);
      const hair = role('hair');
      if (!hat) {
        const pts: THREE.Vector3[] = [];
        const headW = weightOn(pr, (b) => b === 'head');
        for (let w = 0; w < pr.n; w++) if (headW[w] > 0.5) pts.push(V(pr, w));
        for (const m of hair) pts.push(...worldPoints(m));
        const made = hatGeometry(item, frame, pts);
        // Hair under the crown is tucked away, and what's left of it there rides the head like the hat does
        // (strands weighted to the neck would otherwise swing out through the crown as the head turns).
        const tucked = hair.map((m) => {
          const ins = worldPoints(m).map((p) => made.inside(p));
          const g = dropTriangles(m.geometry, (a, b, c) => ins[a] && ins[b] && ins[c]);
          const head = m.skeleton.bones.findIndex((b) => b.name === 'head');
          if (head >= 0) {
            const si = g.getAttribute('skinIndex').clone();
            const sw = g.getAttribute('skinWeight').clone();
            ins.forEach((inn, i) => {
              if (!inn) return;
              si.setXYZW(i, head, 0, 0, 0);
              sw.setXYZW(i, 1, 0, 0, 0);
            });
            g.setAttribute('skinIndex', si);
            g.setAttribute('skinWeight', sw);
          }
          return g;
        });
        hats.set(k, (hat = { geo: made.geo, tucked }));
      }
      hair.forEach((m, i) => (m.geometry = hat!.tucked[i]));
      const g = hat.geo;
      const mat = clothMaterial(item);
      owned.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `fashion_${id}`;
      mesh.castShadow = true;
      onHead(mesh);
    } else if (item.slot === 'shades' && frame && eyes) {
      const { group, mats } = shadesGroup(item, frame, new THREE.Box3().setFromPoints(worldPoints(eyes)));
      owned.push(...mats);
      group.name = `fashion_${id}`;
      onHead(group);
    } else if (item.slot === 'chain') {
      const k = `${key}|${jacketIt?.id ?? ''}|${id}`;
      let g = extras.get(k);
      if (!g) {
        const surface: THREE.Vector3[] = [];
        for (let w = 0; w < pr.n; w++) surface.push(V(pr, w));
        for (const m of role('top')) surface.push(...worldPoints(m));
        for (const m of role('kit')) surface.push(...worldPoints(m));
        if (jacketIt) {
          const s = shells.get(`${key}|${pantsIt?.id ?? ''}|${jacketIt.id}`);
          if (s) {
            const pos = s.geo.getAttribute('position');
            for (let i = 0; i < pos.count; i++) surface.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(pr.toWorld));
          }
        }
        g = skinToBody(pr, chainGeometry(pr, item, surface));
        extras.set(k, g);
      }
      const metal = new THREE.MeshPhysicalMaterial({ name: 'fashion_chain', color: item.colors[0], roughness: 0.18, metalness: 1, clearcoat: 0.6 });
      owned.push(metal);
      const mesh = addSkinned(g, metal, `fashion_${id}`);
      if (item.kind === 'pendant') {
        metal.emissive = lin(item.colors[1]);
        metal.emissiveIntensity = 0.08;
      }
      void mesh;
    }
  }
  return { owned };
}
