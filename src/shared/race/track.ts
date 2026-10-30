// Race tracks: a point-to-point road down a mountain, built from a handful of control points, plus the
// ground under it. Shared and deterministic: the car physics, the AI, the renderer and the tests all ask the
// same functions where the ground is, so what you see is what you drive on.
//
// The road is a centreline sampled every SAMPLE metres. Across it the surface is a plane (with a little
// banking in corners) out to the barriers; past them it eases into procedural hills over BLEND metres.

export type Theme = 'alpine' | 'coast';
export type TrackId = 'koripass' | 'saltwind';
export type Surface = 'asphalt' | 'shoulder' | 'grass';

export interface TrackDef {
  id: TrackId;
  name: string;
  blurb: string;
  theme: Theme;
  seed: number;
  /** Control points [x, y, z] the road threads through, start line to finish line. */
  points: [number, number, number][];
  /** Asphalt width (m). */
  width: number;
  /** How tall the far hills get (m). */
  relief: number;
  /** Far terrain leans this way (rise per metre away from the road), e.g. coast hills falling to the sea. */
  tilt?: [number, number];
}

export const SAMPLE = 2; // metres between centreline samples
const PRE = 90; // straight run-up before the start line (the grid sits here)
const RUNOFF = 240; // straight after the finish line to brake in
export const SHOULDER = 2.5; // paved strip outside the white lines
export const VERGE = 3; // grass between the shoulder and the barrier
/** The road's plane carries on this far past the barrier so the rails stand on level ground. */
const EDGE_PAD = 1.5;
const BLEND = 26; // the ground eases from the road's plane into the hills over this many metres
const CELL = 16; // spatial hash cell (m)
const COARSE = 40; // far-terrain field spacing (m)
const MARGIN = 1600; // far terrain reaches this far past the road's bounds
export const SEA_LEVEL = 0;

export interface Track {
  def: TrackDef;
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Unit tangent (xz) of the segment from sample i to i+1. */
  tx: Float64Array;
  tz: Float64Array;
  /** Distance along the road at each sample. */
  s: Float64Array;
  /** Signed curvature (1/m, + = right turn), smoothed over ~20 m. */
  curv: Float64Array;
  /** Cross slope: the surface drops `bank` metres per metre to the right. */
  bank: Float64Array;
  length: number;
  startS: number;
  finishS: number;
  half: number; // half the asphalt width
  rail: number; // barrier distance from the centreline
  edge: number; // where the road's plane ends and the blend begins
  grid: Map<number, Int32Array>;
  coarse: { x0: number; z0: number; nx: number; nz: number; base: Float32Array; dist: Float32Array };
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

// ---------------------------------------------------------------------------------------------
// The tracks

export const TRACK_DEFS: Record<TrackId, TrackDef> = {
  koripass: {
    id: 'koripass',
    name: 'Kōri Pass',
    blurb: 'Snowline to valley floor: a fast opening, six hairpins stacked down the face, forest esses, then a flat-out run to the village.',
    theme: 'alpine',
    seed: 7,
    width: 10,
    relief: 330,
    points: [
      [0, 430, 0], [0, 424, -180], [60, 414, -330], [200, 400, -420], [380, 386, -440],
      [520, 374, -470], [565, 368, -530], [500, 362, -582], [330, 348, -572], [180, 334, -590],
      [108, 328, -642], [170, 322, -692], [350, 306, -702], [520, 292, -722], [582, 286, -782],
      [520, 280, -842], [300, 262, -852], [100, 246, -882], [-60, 232, -962], [-120, 218, -1100],
      [-60, 204, -1250], [-160, 188, -1380], [-300, 176, -1420], [-420, 164, -1520], [-400, 150, -1680],
      [-300, 134, -1820], [-140, 120, -1900], [40, 106, -1960], [240, 94, -2000], [420, 84, -2100],
      [480, 76, -2260], [420, 68, -2400], [300, 62, -2480], [300, 58, -2620], [300, 56, -2720],
    ],
  },
  saltwind: {
    id: 'saltwind',
    name: 'Saltwind Cliffs',
    blurb: 'From the lighthouse along the clifftops, a zigzag down the cliff face, and a sprint along the harbour wall.',
    theme: 'coast',
    seed: 23,
    width: 10,
    relief: 140,
    tilt: [-0.55, 0],
    points: [
      [0, 240, 0], [20, 236, -200], [-30, 228, -400], [40, 218, -600], [120, 206, -760],
      [100, 194, -950], [20, 182, -1100], [60, 170, -1280], [170, 156, -1400], [210, 146, -1540],
      [300, 136, -1640], [380, 128, -1700], [405, 124, -1758], [330, 118, -1792], [180, 104, -1802],
      [118, 98, -1852], [180, 92, -1902], [340, 78, -1912], [402, 72, -1962], [340, 66, -2012],
      [200, 54, -2032], [60, 40, -2100], [-20, 26, -2250], [40, 16, -2400], [180, 10, -2480], [300, 8, -2500],
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Noise (seeded value noise; deterministic everywhere)

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, z, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

/** Sharp crests: mountain ridges. 0..1. */
function ridged(x: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < 5; o++) {
    const r = 1 - Math.abs(vnoise(x, z, seed + o * 17));
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.1;
    z *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Building a track

type P3 = [number, number, number];

/** Centripetal Catmull-Rom through the points, densely sampled. */
function spline(pts: P3[]): P3[] {
  const out: P3[] = [];
  const knot = (a: P3, b: P3) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) || 1e-4;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = 60;
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const p: P3 = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const a1 = ((t1 - t) / t1) * p0[c] + (t / t1) * p1[c];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
        const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        p[c] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      }
      out.push(p);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function smooth(a: Float64Array, radius: number, passes: number) {
  const n = a.length;
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < passes; pass++) {
    let acc = 0;
    let lo = 0;
    let hi = -1;
    for (let i = 0; i < n; i++) {
      const L = Math.max(0, i - radius);
      const H = Math.min(n - 1, i + radius);
      while (hi < H) acc += a[++hi];
      while (lo < L) acc -= a[lo++];
      tmp[i] = acc / (H - L + 1);
    }
    a.set(tmp);
  }
}

const cache = new Map<TrackId, Track>();

/** Builds (once per id) the sampled road, its spatial hash and the far-terrain field. */
export function getTrack(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) cache.set(id, (t = buildTrack(TRACK_DEFS[id])));
  return t;
}

export function buildTrack(def: TrackDef): Track {
  const pts = def.points;
  const dir = (a: P3, b: P3) => {
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return [(b[0] - a[0]) / l, (b[2] - a[2]) / l];
  };
  const [sx, sz] = dir(pts[1], pts[0]);
  const [ex, ez] = dir(pts[pts.length - 2], pts[pts.length - 1]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const ext: P3[] = [
    [first[0] + sx * PRE, first[1], first[2] + sz * PRE],
    [first[0] + sx * PRE * 0.5, first[1], first[2] + sz * PRE * 0.5],
    ...pts,
    [last[0] + ex * RUNOFF * 0.5, last[1] - 1, last[2] + ez * RUNOFF * 0.5],
    [last[0] + ex * RUNOFF, last[1] - 2, last[2] + ez * RUNOFF],
  ];
  const dense = spline(ext);

  // Resample at even arc length.
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  let acc = 0;
  let next = 0;
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    while (next <= acc + l) {
      const f = l > 0 ? (next - acc) / l : 0;
      xs.push(a[0] + (b[0] - a[0]) * f);
      ys.push(a[1] + (b[1] - a[1]) * f);
      zs.push(a[2] + (b[2] - a[2]) * f);
      next += SAMPLE;
    }
    acc += l;
  }
  const n = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const z = Float64Array.from(zs);
  smooth(y, 18, 3); // no steps in the grade, even through hairpins
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + 1);
    const k = j === i ? i - 1 : i;
    const dx = x[j === i ? i : j] - x[k];
    const dz = z[j === i ? i : j] - z[k];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
    s[i] = i * SAMPLE;
  }
  const curv = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) curv[i] = (tx[i - 1] * tz[i] - tz[i - 1] * tx[i]) / SAMPLE;
  smooth(curv, 5, 2);
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = Math.max(-0.07, Math.min(0.07, curv[i] * 3));

  const nearestS = (p: P3) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (x[i] - p[0]) ** 2 + (z[i] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return s[best];
  };

  const half = def.width / 2;
  const rail = half + SHOULDER + VERGE;
  const edge = rail + EDGE_PAD;
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (let i = 0; i < n; i++) {
    bx0 = Math.min(bx0, x[i]);
    bx1 = Math.max(bx1, x[i]);
    bz0 = Math.min(bz0, z[i]);
    bz1 = Math.max(bz1, z[i]);
  }

  // Spatial hash: every sample within reach of a cell is listed in it (ascending), so one lookup finds
  // every stretch of road that can shape the ground at a point.
  const reach = edge + BLEND + SAMPLE;
  const lists = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c0 = Math.floor((x[i] - reach) / CELL);
    const c1 = Math.floor((x[i] + reach) / CELL);
    const r0 = Math.floor((z[i] - reach) / CELL);
    const r1 = Math.floor((z[i] + reach) / CELL);
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) {
        const k = cellKey(c, r);
        let l = lists.get(k);
        if (!l) lists.set(k, (l = []));
        l.push(i);
      }
  }
  const grid = new Map<number, Int32Array>();
  for (const [k, l] of lists) grid.set(k, Int32Array.from(l));

  // Far terrain: a coarse field of "how high the road is around here" (a wide Gaussian average) and the
  // distance to the road, so hills rise with the road and mountains grow the farther you look.
  const x0 = bx0 - MARGIN;
  const z0 = bz0 - MARGIN;
  const nx = Math.ceil((bx1 - bx0 + 2 * MARGIN) / COARSE) + 1;
  const nz = Math.ceil((bz1 - bz0 + 2 * MARGIN) / COARSE) + 1;
  const base = new Float32Array(nx * nz);
  const dist = new Float32Array(nx * nz);
  const sigma2 = 2 * 220 * 220;
  const [gx, gz] = def.tilt ?? [0, 0];
  for (let r = 0; r < nz; r++)
    for (let c = 0; c < nx; c++) {
      const px = x0 + c * COARSE;
      const pz = z0 + r * COARSE;
      let ws = 0;
      let hs = 0;
      let bd = Infinity;
      let bi = 0;
      for (let i = 0; i < n; i += 4) {
        const d2 = (x[i] - px) ** 2 + (z[i] - pz) ** 2;
        if (d2 < bd) {
          bd = d2;
          bi = i;
        }
        if (d2 > sigma2 * 4.5) continue;
        const w = Math.exp(-d2 / sigma2);
        ws += w;
        hs += w * y[i];
      }
      const d = Math.sqrt(bd);
      const h = ws > 1e-6 ? hs / ws : y[bi];
      const lean = (gx * (px - x[bi]) + gz * (pz - z[bi])) * smoothstep(20, 260, d);
      base[r * nx + c] = h + lean;
      dist[r * nx + c] = d;
    }

  const t: Track = {
    def,
    n,
    x,
    y,
    z,
    tx,
    tz,
    s,
    curv,
    bank,
    length: s[n - 1],
    startS: nearestS(first),
    finishS: nearestS(last),
    half,
    rail,
    edge,
    grid,
    coarse: { x0, z0, nx, nz, base, dist },
    bounds: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 },
  };
  return t;
}

const cellKey = (c: number, r: number) => (c + 4096) * 8192 + (r + 4096);

// ---------------------------------------------------------------------------------------------
// Queries

/** A point on the centreline: distance along the road `s`, signed offset `d` (+ = right) and the frame there. */
export interface Loc {
  i: number;
  s: number;
  d: number;
  /** Centreline point (with its height) and unit tangent there. */
  cx: number;
  cy: number;
  cz: number;
  tx: number;
  tz: number;
}

/** Projects (x, z) onto the segments either side of sample i. */
function project(t: Track, i: number, x: number, z: number, out: Loc): number {
  let best = Infinity;
  for (let k = Math.max(0, i - 1); k <= Math.min(t.n - 2, i); k++) {
    const ax = t.x[k];
    const az = t.z[k];
    const sx = t.x[k + 1] - ax;
    const sz = t.z[k + 1] - az;
    const f = Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / (SAMPLE * SAMPLE)));
    const cx = ax + sx * f;
    const cz = az + sz * f;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 < best) {
      best = d2;
      const tx = t.tx[k];
      const tz = t.tz[k];
      out.i = k;
      out.s = t.s[k] + f * SAMPLE;
      out.d = (x - cx) * -tz + (z - cz) * tx; // right = (-tz, tx)
      out.cx = cx;
      out.cy = t.y[k] + (t.y[k + 1] - t.y[k]) * f;
      out.cz = cz;
      out.tx = tx;
      out.tz = tz;
    }
  }
  return best;
}

export const newLoc = (): Loc => ({ i: 0, s: 0, d: 0, cx: 0, cy: 0, cz: 0, tx: 0, tz: -1 });

/**
 * Nearest point on the road. With a `hint` (last frame's sample index) only the nearby stretch is
 * searched, so a car never jumps to a parallel leg of a switchback; without one the spatial hash is used.
 */
export function locate(t: Track, x: number, z: number, hint: number, out: Loc): Loc {
  let bi = -1;
  let bd = Infinity;
  if (hint >= 0) {
    const lo = Math.max(0, hint - 30);
    const hi = Math.min(t.n - 1, hint + 30);
    for (let i = lo; i <= hi; i++) {
      const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
  }
  if (bi < 0 || bi === Math.max(0, hint - 30) || bi === Math.min(t.n - 1, hint + 30)) {
    const list = t.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list)
      for (const i of list) {
        const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    if (bi < 0) {
      for (let i = 0; i < t.n; i += 4) {
        const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    }
  }
  project(t, bi, x, z, out);
  return out;
}

/** Height of the road's surface plane at a location (the centreline height, banked). */
export const roadY = (t: Track, l: Loc) => l.cy - t.bank[l.i] * l.d;

function bilerp(t: Track, f: Float32Array, x: number, z: number): number {
  const { x0, z0, nx, nz } = t.coarse;
  const gx = Math.min(nx - 1.001, Math.max(0, (x - x0) / COARSE));
  const gz = Math.min(nz - 1.001, Math.max(0, (z - z0) / COARSE));
  const c = Math.floor(gx);
  const r = Math.floor(gz);
  const fx = gx - c;
  const fz = gz - r;
  const i = r * nx + c;
  const a = f[i] + (f[i + 1] - f[i]) * fx;
  const b = f[i + nx] + (f[i + nx + 1] - f[i + nx]) * fx;
  return a + (b - a) * fz;
}

/** Distance to the road from the coarse field (good to a few metres; for scenery). */
export const roadDistance = (t: Track, x: number, z: number) => bilerp(t, t.coarse.dist, x, z);

/** The hills, ignoring the road. */
export function terrainAt(t: Track, x: number, z: number): number {
  const seed = t.def.seed;
  const base = bilerp(t, t.coarse.base, x, z);
  const d = bilerp(t, t.coarse.dist, x, z);
  const far = smoothstep(50, 700, d);
  const rolling = fbm(x / 210, z / 210, seed, 4) * (6 + t.def.relief * 0.12 * far);
  const bumps = fbm(x / 34, z / 34, seed + 5, 3) * 1.4;
  const mountains = t.def.theme === 'alpine' ? (ridged(x / 820, z / 820, seed + 9) - 0.25) * t.def.relief * far * 1.6 : fbm(x / 520, z / 520, seed + 9, 3) * t.def.relief * far;
  return base + rolling + bumps + mountains;
}

const tmpLoc = newLoc();
const pieceLoc = newLoc();

/**
 * Height of the ground at (x, z): the road's plane out to `edge`, then a blend into the hills. Every
 * stretch of road within reach contributes (weighted by closeness), so the ground between the legs of a
 * hairpin is continuous. `loc` (optional) receives the nearest road location when the point is on the road plane.
 */
export function heightAt(t: Track, x: number, z: number, onRoad?: Loc): number {
  const list = t.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return terrainAt(t, x, z);
  let wsum = 0;
  let hsum = 0;
  let wmax = 0;
  let runBest = Infinity;
  let runIdx = -1;
  const flush = (): number | null => {
    if (runIdx < 0) return null;
    // True distance (not just the sideways offset), so past either end of the road the ground eases away.
    const dist = Math.sqrt(project(t, runIdx, x, z, pieceLoc));
    const h = roadY(t, pieceLoc);
    runBest = Infinity;
    runIdx = -1;
    if (dist <= t.edge) {
      if (onRoad) Object.assign(onRoad, pieceLoc);
      return h;
    }
    const w = 1 - smoothstep(t.edge, t.edge + BLEND, dist);
    if (w <= 0) return null;
    const om = w / Math.max(1e-3, (dist - t.edge) ** 2);
    wsum += om;
    hsum += om * h;
    if (w > wmax) wmax = w;
    return null;
  };
  let prev = -1000;
  for (const i of list) {
    if (i - prev > 25) {
      const h = flush();
      if (h !== null) return h;
    }
    prev = i;
    const d2 = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
    if (d2 < runBest) {
      runBest = d2;
      runIdx = i;
    }
  }
  const h = flush();
  if (h !== null) return h;
  const T = terrainAt(t, x, z);
  if (wmax <= 0) return T;
  return T + (hsum / wsum - T) * wmax;
}

export interface Ground {
  h: number;
  nx: number;
  ny: number;
  nz: number;
  surf: Surface;
}

export const newGround = (): Ground => ({ h: 0, nx: 0, ny: 1, nz: 0, surf: 'asphalt' });

/** Height, normal and surface at (x, z). On the road the normal is exact; off it, from finite differences. */
export function groundAt(t: Track, x: number, z: number, out: Ground): Ground {
  tmpLoc.i = -1;
  const h = heightAt(t, x, z, tmpLoc);
  out.h = h;
  if (tmpLoc.i >= 0) {
    const i = tmpLoc.i;
    const g = (t.y[i + 1] - t.y[i]) / SAMPLE; // grade along the road
    const b = t.bank[i];
    const rx = -tmpLoc.tz;
    const rz = tmpLoc.tx;
    // n = right3 × tangent3, with right3 = (rx, -b, rz) and tangent3 = (tx, g, tz)
    const ax = rx;
    const ay = -b;
    const az = rz;
    const bx = tmpLoc.tx;
    const by = g;
    const bz = tmpLoc.tz;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz);
    nx /= l;
    ny /= l;
    nz /= l;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    const ad = Math.abs(tmpLoc.d);
    out.surf = ad <= t.half ? 'asphalt' : ad <= t.half + SHOULDER ? 'shoulder' : 'grass';
    return out;
  }
  const e = 0.6;
  const hx = heightAt(t, x + e, z);
  const hz = heightAt(t, x, z + e);
  const nx = -(hx - h) / e;
  const nz = -(hz - h) / e;
  const l = Math.hypot(nx, 1, nz);
  out.nx = nx / l;
  out.ny = 1 / l;
  out.nz = nz / l;
  out.surf = 'grass';
  return out;
}

/** Where grid slot `k` sits: two columns, staggered back from the start line. */
export function gridSlot(t: Track, k: number): { x: number; y: number; z: number; yaw: number; s: number } {
  const row = Math.floor(k / 2);
  const side = k % 2 === 0 ? -2.4 : 2.4;
  const s = t.startS - 7 - row * 8 - (k % 2) * 3;
  const l = pointAt(t, s, side);
  return { ...l, yaw: Math.atan2(-l.tx, -l.tz), s };
}

/** World point at distance `s` along the road, `d` metres to the right, on the surface. */
export function pointAt(t: Track, s: number, d: number) {
  const f = Math.min(t.n - 1.001, Math.max(0, s / SAMPLE));
  const i = Math.floor(f);
  const u = f - i;
  const cx = t.x[i] + (t.x[i + 1] - t.x[i]) * u;
  const cz = t.z[i] + (t.z[i + 1] - t.z[i]) * u;
  const cy = t.y[i] + (t.y[i + 1] - t.y[i]) * u;
  const tx = t.tx[i];
  const tz = t.tz[i];
  return { x: cx - tz * d, y: cy - t.bank[i] * d, z: cz + tx * d, tx, tz, i };
}
