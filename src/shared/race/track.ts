import { type Prop, type Ramp, placeProps, rampLift } from './props.ts';

// Race tracks: a point-to-point road down a mountain, built from a handful of control points, plus the
// ground under it. Shared and deterministic: the car physics, the AI, the renderer and the tests all ask the
// same functions where the ground is, so what you see is what you drive on.
//
// The road is a centreline sampled every SAMPLE metres. Across it the surface is a plane (with a little
// banking in corners) out to the barriers; past them it eases into procedural hills over BLEND metres.

export type Theme = 'alpine' | 'coast' | 'desert' | 'night' | 'autumn' | 'spring';
export type TrackId = 'koripass' | 'saltwind' | 'redmesa' | 'tsukiyo' | 'momiji' | 'sakura';
export type Surface = 'asphalt' | 'shoulder' | 'gravel' | 'grass' | 'dirt';

/**
 * Something special about a stretch of road, between two control points (`from`/`to` are indexes into
 * `points`): a gravel stage, canyon walls (`size` = their height), a bridge over a gorge (`size` = how far the
 * ground drops), a tunnel (a gallery through a raised hillside). A crest is a jump at point `at`: the road
 * rises `size` metres over `len` and falls away again, so a fast car flies.
 */
export type Feature =
  | { kind: 'gravel' | 'canyon' | 'bridge' | 'tunnel'; from: number; to: number; size?: number }
  | { kind: 'crest'; at: number; size: number; len: number }
  /** A shortcut: a gravel track from distance `s0` along the road to `s1`, through gaps in the barrier. */
  | { kind: 'cut'; s0: number; s1: number };

/** A shortcut's path, sampled every SAMPLE metres. */
export interface Cut {
  s0: number;
  s1: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Bounding box [x0, x1, z0, z1], padded by the blend. */
  box: [number, number, number, number];
}

/** Half-width of a shortcut track, and how far its ground blends into the hills. */
export const CUT_HALF = 3.5;
const CUT_BLEND = 14;

/** A feature resolved to distances along the road. */
export interface Span {
  kind: 'gravel' | 'canyon' | 'bridge' | 'tunnel';
  s0: number;
  s1: number;
  size: number;
  /** The stretch's bounding box [x0, x1, z0, z1], for quick rejects. */
  box: [number, number, number, number];
}

export interface TrackDef {
  id: TrackId;
  name: string;
  /** One line for the track card: setting and what's special. */
  tag: string;
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
  /** Height of the sea or lake, if there is one (ground below it is under water). */
  water?: number;
  features?: Feature[];
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
  rail: number; // barrier distance from the centreline, where there's no runoff
  edge: number; // where the road's plane ends and the blend begins, where there's no runoff
  /** Runoff: extra metres of flat dirt before the barrier, left and right of each sample. */
  runL: Float64Array;
  runR: Float64Array;
  /** The widest the road's plane gets anywhere (edge plus the most runoff). */
  edgeMax: number;
  grid: Map<number, Int32Array>;
  coarse: { x0: number; z0: number; nx: number; nz: number; base: Float32Array; dist: Float32Array };
  spans: Span[];
  /** Jumps: where they peak along the road and how long they are (m). */
  crests: { s: number; len: number }[];
  /** 1 where the road is gravel. */
  gravel: Uint8Array;
  cuts: Cut[];
  /** Mystery boxes and obstacles (sorted by s), and launch ramps (part of the ground). */
  props: Prop[];
  ramps: Ramp[];
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

// ---------------------------------------------------------------------------------------------
// The tracks

export const TRACK_DEFS: Record<TrackId, TrackDef> = {
  koripass: {
    id: 'koripass',
    name: 'Kōri Pass',
    blurb: 'Snowline to valley floor: a fast opening, six hairpins stacked down the face, forest esses, then a flat-out run to the village.',
    tag: 'Alpine · 6 hairpins · forest esses',
    theme: 'alpine',
    seed: 7,
    width: 12,
    relief: 330,
    features: [
      { kind: 'cut', s0: 1840, s1: 2230 },
      { kind: 'cut', s0: 3240, s1: 3990 },
    ],
    points: [
      [0, 430, 0], [0, 424, -180], [60, 414, -330], [200, 400, -420], [380, 386, -440],
      [520, 374, -470], [565, 368, -530], [500, 362, -582], [330, 348, -572], [180, 334, -590],
      [108, 328, -642], [170, 322, -692], [350, 306, -702], [520, 292, -722], [582, 286, -782],
      [520, 280, -842], [300, 262, -852], [100, 246, -882], [-60, 232, -962], [-120, 218, -1100],
      [-60, 204, -1250], [-160, 188, -1380], [-300, 176, -1420], [-420, 164, -1520], [-400, 150, -1680],
      [-300, 134, -1820], [-140, 120, -1900], [40, 106, -1960], [120, 102, -1972], [150, 99, -2012], [240, 94, -2004], [420, 84, -2100],
      [480, 76, -2260], [420, 68, -2400], [300, 62, -2480], [300, 58, -2620], [300, 56, -2720],
    ],
  },
  saltwind: {
    id: 'saltwind',
    name: 'Saltwind Cliffs',
    blurb: 'From the lighthouse along the clifftops, a zigzag down the cliff face, and a sprint along the harbour wall.',
    tag: 'Coastal · clifftops · cliff-face zigzag',
    theme: 'coast',
    seed: 23,
    width: 12,
    relief: 140,
    tilt: [-0.55, 0],
    water: 0,
    features: [{ kind: 'cut', s0: 2580, s1: 2870 }],
    points: [
      [0, 240, 0], [20, 236, -200], [5, 233, -280], [-40, 231, -298], [-30, 228, -400], [40, 218, -600], [120, 206, -760],
      [100, 194, -950], [20, 182, -1100], [60, 170, -1280], [170, 156, -1400], [210, 146, -1540],
      [300, 136, -1640], [380, 128, -1700], [405, 124, -1758], [330, 118, -1792], [180, 104, -1802],
      [118, 98, -1852], [180, 92, -1902], [340, 78, -1912], [402, 72, -1962], [340, 66, -2012],
      [200, 54, -2032], [60, 40, -2100], [-20, 26, -2250], [40, 16, -2400], [180, 10, -2480], [300, 8, -2500],
    ],
  },
  redmesa: {
    id: 'redmesa',
    name: 'Red Mesa Rally',
    tag: 'Desert rally · gravel · 4 jumps · canyon',
    blurb: 'A rally stage across the mesas: tarmac into two long gravel sections, four crests that put you in the air, and a narrow red-rock canyon.',
    theme: 'desert',
    seed: 41,
    width: 11,
    relief: 240,
    points: [
      [0, 320, 0], [10, 316, -200], [-60, 308, -380], [-40, 298, -560], [60, 288, -720], [200, 276, -820],
      [380, 262, -860], [540, 250, -940], [600, 240, -1100], [560, 228, -1280], [440, 214, -1400], [300, 200, -1460],
      [160, 188, -1560], [120, 176, -1740], [180, 162, -1920], [320, 150, -2020], [480, 136, -2080], [620, 120, -2200],
      [660, 106, -2380], [600, 92, -2560], [480, 80, -2660], [340, 70, -2700], [280, 68, -2705], [250, 67, -2748], [200, 64, -2780], [120, 60, -2940],
    ],
    features: [
      { kind: 'crest', at: 2, size: 2.2, len: 46 },
      { kind: 'gravel', from: 5, to: 12 },
      { kind: 'crest', at: 8, size: 2.6, len: 50 },
      { kind: 'canyon', from: 12, to: 15, size: 30 },
      { kind: 'crest', at: 16, size: 2.4, len: 46 },
      { kind: 'gravel', from: 17, to: 24 },
      { kind: 'crest', at: 20, size: 2.8, len: 52 },
      { kind: 'crest', at: 4, size: 1.8, len: 40 },
      { kind: 'crest', at: 11, size: 2.2, len: 44 },
    ],
  },
  tsukiyo: {
    id: 'tsukiyo',
    name: 'Tsukiyo Night Pass',
    tag: 'Night · hairpin ladder · bridge · tunnel',
    blurb: 'Moonlight and headlights only. Sweepers off the summit, a ladder of eight hairpins down the face, a bridge over the gorge and a tunnel to the village.',
    theme: 'night',
    seed: 77,
    width: 11,
    relief: 300,
    points: [
      [0, 520, 0], [0, 514, -160], [-80, 506, -300], [-220, 496, -360], [-360, 486, -330], [-470, 476, -230],
      [-500, 470, -150], [-505, 462, -40], [-550, 458, 20], [-595, 452, -40],
      [-595, 436, -250], [-590, 424, -400], [-640, 418, -460], [-690, 412, -400],
      [-690, 396, -200], [-690, 384, -50], [-735, 378, 10], [-780, 372, -50],
      [-780, 356, -250], [-775, 344, -420], [-825, 338, -480], [-870, 332, -420],
      [-875, 318, -250], [-900, 306, -100], [-980, 294, -20], [-1100, 282, -40], [-1200, 268, -120],
      [-1260, 256, -260], [-1240, 242, -420], [-1180, 228, -560], [-1220, 214, -720], [-1320, 200, -800],
      [-1440, 186, -820], [-1560, 172, -860], [-1640, 158, -980], [-1640, 146, -1140], [-1630, 142, -1200], [-1592, 139, -1214], [-1580, 134, -1280],
      [-1500, 126, -1380], [-1480, 122, -1500],
    ],
    features: [
      { kind: 'bridge', from: 25, to: 27, size: 45 },
      { kind: 'tunnel', from: 31, to: 33, size: 18 },
      { kind: 'cut', s0: 240, s1: 1030 },
      { kind: 'cut', s0: 1500, s1: 1790 },
    ],
  },
  momiji: {
    id: 'momiji',
    name: 'Momiji Gorge',
    tag: 'Autumn · river gorge · 2 bridges · gallery',
    blurb: 'Maples on fire with colour. Flowing esses down a river gorge, two bridges, a rock gallery and a few crests, finishing by the lake.',
    theme: 'autumn',
    seed: 59,
    width: 12,
    relief: 220,
    water: 70,
    points: [
      [0, 300, 0], [30, 294, -170], [130, 286, -300], [280, 278, -340], [420, 268, -300], [540, 258, -360],
      [600, 248, -500], [560, 238, -660], [440, 228, -740], [300, 218, -760], [180, 208, -840], [140, 196, -1000],
      [200, 184, -1150], [330, 172, -1220], [470, 160, -1220], [600, 148, -1300], [640, 136, -1460], [580, 124, -1600],
      [530, 120, -1612], [515, 118, -1650], [460, 114, -1666], [320, 104, -1700], [220, 96, -1800], [200, 90, -1960],
    ],
    features: [
      { kind: 'crest', at: 3, size: 1.6, len: 44 },
      { kind: 'bridge', from: 6, to: 7, size: 55 },
      { kind: 'crest', at: 9, size: 1.8, len: 44 },
      { kind: 'tunnel', from: 11, to: 12, size: 16 },
      { kind: 'crest', at: 14, size: 1.6, len: 40 },
      { kind: 'bridge', from: 16, to: 17, size: 50 },
      { kind: 'cut', s0: 620, s1: 1410 },
    ],
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura Ridge',
    tag: 'Spring · cherry blossom · bridge · lake finish',
    blurb: 'Blossom season. A quick run off the ridge with a crest, two hairpins back to back, a bridge over the falls, a gravel shortcut through the orchard and a sprint along the lake.',
    theme: 'spring',
    seed: 88,
    width: 12,
    relief: 200,
    water: 112,
    points: [
      [0, 380, 0], [10, 376, -180], [80, 368, -330], [220, 358, -410], [380, 346, -420], [500, 336, -480],
      [540, 330, -560], [480, 324, -610], [330, 312, -620], [190, 300, -650], [140, 294, -720], [200, 288, -770],
      [360, 276, -790], [500, 264, -850], [560, 252, -980], [530, 240, -1120], [440, 228, -1220], [300, 216, -1260],
      [160, 204, -1320], [60, 192, -1440], [40, 180, -1600], [100, 168, -1740], [220, 158, -1820], [380, 150, -1860],
      [520, 144, -1940], [560, 140, -2080], [500, 134, -2220], [380, 128, -2290], [240, 124, -2320], [120, 122, -2400],
    ],
    features: [
      { kind: 'crest', at: 2, size: 1.8, len: 44 },
      { kind: 'bridge', from: 14, to: 15, size: 45 },
      { kind: 'crest', at: 23, size: 2, len: 46 },
      { kind: 'cut', s0: 2578, s1: 3198 },
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
    return best * SAMPLE;
  };
  // Crests go on after smoothing so they stay sharp enough to fly off.
  const spans: Span[] = [];
  const crests: { s: number; len: number }[] = [];
  for (const f of def.features ?? []) {
    if (f.kind === 'crest') {
      const at = nearestS(pts[f.at]);
      crests.push({ s: at, len: f.len });
      for (let i = 0; i < n; i++) {
        const u = (i * SAMPLE - at) / (f.len / 2);
        if (Math.abs(u) < 1) y[i] += (f.size * (1 + Math.cos(Math.PI * u))) / 2;
      }
    } else if (f.kind === 'cut') continue;
    else {
      const a = nearestS(pts[f.from]);
      const b = nearestS(pts[f.to]);
      const s0 = Math.min(a, b);
      const s1 = Math.max(a, b);
      const box: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = Math.floor(s0 / SAMPLE); i <= Math.min(n - 1, Math.ceil(s1 / SAMPLE)); i++) {
        box[0] = Math.min(box[0], x[i]);
        box[1] = Math.max(box[1], x[i]);
        box[2] = Math.min(box[2], z[i]);
        box[3] = Math.max(box[3], z[i]);
      }
      spans.push({ kind: f.kind, s0, s1, size: f.size ?? (f.kind === 'tunnel' ? 16 : 0), box });
    }
  }
  const gravel = new Uint8Array(n);
  for (const sp of spans) if (sp.kind === 'gravel') for (let i = Math.floor(sp.s0 / SAMPLE); i <= Math.min(n - 1, sp.s1 / SAMPLE); i++) gravel[i] = 1;
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

  const half = def.width / 2;
  const rail = half + SHOULDER + VERGE;
  const edge = rail + EDGE_PAD;
  const startS = nearestS(first);
  const finishS = nearestS(last);
  const [runL, runR] = runoff(def, n, x, z, curv, spans, crests, edge, startS, finishS);
  let edgeMax = edge;
  for (let i = 0; i < n; i++) edgeMax = Math.max(edgeMax, edge + runL[i], edge + runR[i]);
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
  const reach = edgeMax + BLEND + SAMPLE + SOFTMIN * 4; // the smooth minimum reads a little short of the true one
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
    startS,
    finishS,
    half,
    rail,
    edge,
    runL,
    runR,
    edgeMax,
    grid,
    coarse: { x0, z0, nx, nz, base, dist },
    bounds: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 },
    spans,
    crests,
    gravel,
    props: [],
    ramps: [],
    cuts: [],
  };
  for (const f of def.features ?? []) if (f.kind === 'cut') t.cuts.push(makeCut(t, f.s0, f.s1));
  const placed = placeProps(t);
  t.props = placed.props;
  t.ramps = placed.ramps;
  return t;
}

const cellKey = (c: number, r: number) => (c + 4096) * 8192 + (r + 4096);

/** Runoff tuning: the rough speed profile that finds the fast bends, and how much room they get (m). */
const RUN = {
  grip: 1.2 * 9.81, // lateral grip the profile assumes (m/s²)
  vmax: 58,
  brake: 8,
  accel: 3.5,
  vmin: 24, // bends slower than this (hairpins) keep the rail close: they're slow, and their legs are near
  vfull: 42,
  look: 200, // a bend needs runoff if within this far before it (m) the profile is RUN.dropped (m/s) quicker
  dropped: 9,
  min: 3, // runoff at vmin, rising to max by vfull
  max: 8,
  landing: 6, // both sides after a jump
};

/**
 * Where the barrier stands back. A rail right at the verge of a fast bend is a trap: a car a little too quick
 * slides onto it and rides it round. So the outside of every bend taken fast (grip-limited in a rough speed
 * profile, and quicker than RUN.vmin) gets flat dirt before the barrier, widest where it's quickest and
 * carrying on past the exit, where cars run wide under power; both sides after each jump get some, for wonky
 * landings. None on bridges, in tunnels and canyons, at the shortcuts' turn-offs or by the gantries, and
 * never so much that two legs of road come close.
 */
function runoff(
  def: TrackDef, n: number, x: Float64Array, z: Float64Array, curv: Float64Array, spans: Span[], crests: { s: number; len: number }[],
  edge: number, startS: number, finishS: number,
): [Float64Array, Float64Array] {
  const vlim = new Float64Array(n);
  for (let i = 0; i < n; i++) vlim[i] = Math.min(RUN.vmax, Math.sqrt(RUN.grip / Math.max(1e-6, Math.abs(curv[i]))));
  const v = Float64Array.from(vlim);
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * RUN.brake * SAMPLE));
  const i0 = Math.round(startS / SAMPLE);
  for (let i = 0; i <= i0; i++) v[i] = 0;
  for (let i = i0 + 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * RUN.accel * SAMPLE));
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (v[i] < RUN.vmin || vlim[i] >= RUN.vmax || v[i] < vlim[i] * 0.98) continue;
    // Only bends you brake hard for: they're the ones a late braker arrives at too fast.
    let peak = 0;
    for (let j = Math.max(0, i - RUN.look / SAMPLE); j < i; j++) peak = Math.max(peak, v[j]);
    if (peak - v[i] < RUN.dropped) continue;
    const w = RUN.min + (RUN.max - RUN.min) * smoothstep(RUN.vmin, RUN.vfull, v[i]);
    const out = curv[i] > 0 ? L : R; // a right-hander's outside is on the left
    for (let j = Math.max(0, i - 10); j <= Math.min(n - 1, i + 30); j++) out[j] = Math.max(out[j], w);
  }
  for (const c of crests)
    for (let j = Math.round(c.s / SAMPLE) + 4; j <= Math.min(n - 1, Math.round(c.s / SAMPLE) + 70); j++) {
      L[j] = Math.max(L[j], RUN.landing);
      R[j] = Math.max(R[j], RUN.landing);
    }
  // Kept clear: zero there, easing back in over the 60 m around (smoothing alone would spread runoff into it).
  const keep = new Float64Array(n).fill(1);
  const clear = (a: number, b: number) => {
    for (let i = Math.max(0, Math.floor((a - 60) / SAMPLE)); i <= Math.min(n - 1, Math.ceil((b + 60) / SAMPLE)); i++) keep[i] = 0;
  };
  for (const sp of spans) if (sp.kind !== 'gravel') clear(sp.s0 - 10, sp.s1 + 10);
  for (const f of def.features ?? []) if (f.kind === 'cut') for (const e of [f.s0, f.s1]) clear(e - 10, e + 10);
  clear(0, startS + 30);
  clear(finishS - 20, n * SAMPLE);
  smooth(keep, 10, 3);
  // Never so wide that the road's planes of two legs come within 40 m (tests/racephysics checks it).
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = Infinity;
    for (let j = 0; j < n; j++) if (Math.abs(i - j) > 50) c = Math.min(c, (x[i] - x[j]) ** 2 + (z[i] - z[j]) ** 2);
    cap[i] = Math.max(0, (Math.sqrt(c) - 40) / 2 - edge - 1);
  }
  for (const a of [L, R]) {
    for (let i = 0; i < n; i++) a[i] = Math.min(a[i], cap[i]);
    // Ease in and out over ~60 m, so the barrier never kinks toward a car.
    smooth(a, 10, 3);
    for (let i = 0; i < n; i++) a[i] = keep[i] < 1e-3 || a[i] < 0.01 ? 0 : Math.min(a[i] * keep[i], cap[i]); // (the running sum leaves crumbs)
  }
  return [L, R];
}

/** Runoff (m) at sample i on the side of offset `d` (blended across the centreline, where it never matters). */
const runAt = (t: Track, i: number, d: number) => t.runL[i] + (t.runR[i] - t.runL[i]) * smoothstep(-6, 6, d);

/** Runoff (m) at distance `s` along the road, on the side of offset `d`. */
export function runoffAt(t: Track, s: number, d: number): number {
  const f = Math.min(t.n - 1.001, Math.max(0, s / SAMPLE));
  const i = Math.floor(f);
  const u = f - i;
  return runAt(t, i, d) * (1 - u) + runAt(t, i + 1, d) * u;
}

/** The barrier's distance from the centreline at distance `s`, on the side of offset `d`. */
export const railAt = (t: Track, s: number, d: number) => t.rail + runoffAt(t, s, d);

/** Where the road's plane ends at distance `s`, on the side of offset `d`. */
export const edgeAt = (t: Track, s: number, d: number) => t.edge + runoffAt(t, s, d);

/** Runoff of `r` metres is dirt from this far out (|d|): it eats into the grass verge as it widens. */
export const dirtFrom = (t: Track, r: number) => (r < 0.05 ? Infinity : Math.max(t.half + SHOULDER, t.rail - r));

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

/** Flat-topped steps (mesas): x in 0..1. */
function terrace(v: number, steps: number): number {
  const k = v * steps;
  const b = Math.floor(k);
  return (b + smoothstep(0.55, 0.8, k - b)) / steps;
}

/** How far a feature's reshaping of the ground reaches from the road (m, past the edge). */
const FEATURE_REACH = 240;

/**
 * How the features reshape the ground: canyon and tunnel walls rise beside their stretch of road, a
 * bridge's gorge drops away under it. Each is the strongest pull of any of its stretch's samples (by
 * distance, fading in and out at the ends), which is continuous everywhere, even off the inside of a bend.
 */
function featureLift(t: Track, x: number, z: number): number {
  let lift = 0;
  for (const sp of t.spans) {
    if (sp.kind === 'gravel') continue;
    const reach = t.edge + FEATURE_REACH;
    if (x < sp.box[0] - reach || x > sp.box[1] + reach || z < sp.box[2] - reach || z > sp.box[3] + reach) continue;
    let best = 0;
    const i0 = Math.max(0, Math.floor((sp.s0 - 50) / SAMPLE));
    const i1 = Math.min(t.n - 1, Math.ceil((sp.s1 + 50) / SAMPLE));
    for (let i = i0; i <= i1; i += 2) {
      const s = i * SAMPLE;
      const w = smoothstep(sp.s0 - 50, sp.s0 + 10, s) * (1 - smoothstep(sp.s1 - 10, sp.s1 + 50, s));
      if (w <= best) continue;
      const d = Math.hypot(t.x[i] - x, t.z[i] - z);
      const f = sp.kind === 'bridge' ? 1 - smoothstep(t.edge + 50, t.edge + 220, d) : smoothstep(t.edge + 1, t.edge + 14, d) * (1 - smoothstep(t.edge + 70, reach, d));
      if (f * w > best) best = f * w;
    }
    lift += (sp.kind === 'bridge' ? -1 : 1) * sp.size * best;
  }
  return lift;
}

/** The hills, ignoring the road (but shaped by its features). */
export function terrainAt(t: Track, x: number, z: number): number {
  const seed = t.def.seed;
  const base = bilerp(t, t.coarse.base, x, z);
  const cd = bilerp(t, t.coarse.dist, x, z);
  const far = smoothstep(50, 700, cd);
  const theme = t.def.theme;
  const rolling = fbm(x / 210, z / 210, seed, 4) * (6 + t.def.relief * 0.12 * far);
  const bumps = fbm(x / 34, z / 34, seed + 5, 3) * (theme === 'desert' ? 0.8 : 1.4);
  let mountains: number;
  if (theme === 'alpine' || theme === 'night') mountains = (ridged(x / 820, z / 820, seed + 9) - 0.25) * t.def.relief * far * 1.6;
  else if (theme === 'desert') mountains = (terrace(Math.max(0, fbm(x / 600, z / 600, seed + 9, 3) * 0.5 + 0.5), 4) - 0.35) * t.def.relief * far * 1.8;
  else mountains = fbm(x / 520, z / 520, seed + 9, 3) * t.def.relief * far;
  const lift = t.spans.length && cd < t.edge + FEATURE_REACH + 60 ? featureLift(t, x, z) : 0;
  return base + rolling + bumps + mountains + lift;
}


const tmpLoc = newLoc();
let d2s = new Float64Array(256);
const pieceLoc = newLoc();

/** Width (m) of the kernel that averages the road's plane off the road: wide enough to round off the
 * crease where two legs of a hairpin meet, narrow enough that the nearest stretch dominates. */
const KERNEL = 5;
/** Softness (m) of the smooth minimum distance that sets how hard the road pulls the ground. */
const SOFTMIN = 3;

/**
 * Height of the ground at (x, z). On the road it's the road's banked plane, exactly. Off it, the plane as
 * seen from every nearby sample of road (continued along its grade and bank), averaged by a kernel on
 * distance, and blended into the hills by how far the nearest road is. Every weight is a continuous
 * function of distances, so the ground has no seams, even inside hairpins. `onRoad` receives the nearest
 * road location when the point is on the road plane.
 */
export function heightAt(t: Track, x: number, z: number, onRoad?: Loc): number {
  roadHit = false;
  const h = roadHeight(t, x, z, onRoad);
  if (roadHit || !t.cuts.length) return h;
  // A shortcut's track takes over near it, easing back into the hills.
  const c = nearCut(t, x, z);
  if (!c) return h;
  // Fade in past the road's edge, so the turn-off is seamless.
  const w = (1 - smoothstep(CUT_HALF + 1, CUT_HALF + 1 + CUT_BLEND, c.d)) * smoothstep(t.edge, t.edge + 8, roadDist);
  return h + (c.h - h) * w;
}

let roadHit = false;
/** Distance to the nearest road sample in the last roadHeight call (Infinity when none is near). */
let roadDist = Infinity;

function roadHeight(t: Track, x: number, z: number, onRoad?: Loc): number {
  const list = t.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  roadDist = Infinity;
  if (!list) return terrainAt(t, x, z);
  const L = list.length;
  if (d2s.length < L) d2s = new Float64Array(L * 2);
  let dmin2 = Infinity;
  let imin = -1;
  for (let k = 0; k < L; k++) {
    const i = list[k];
    const d2 = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
    d2s[k] = d2;
    if (d2 < dmin2) {
      dmin2 = d2;
      imin = i;
    }
  }
  const dmin = Math.sqrt(dmin2);
  roadDist = dmin;
  if (dmin <= t.edgeMax + SAMPLE) {
    // Legs are always far apart, so a point this close to a road belongs to that one stretch.
    const dist = Math.sqrt(project(t, imin, x, z, pieceLoc));
    if (dist <= edgeAt(t, pieceLoc.s, pieceLoc.d)) {
      roadHit = true;
      if (onRoad) Object.assign(onRoad, pieceLoc);
      return roadY(t, pieceLoc) + (t.ramps.length ? rampLift(t.ramps, pieceLoc.s, pieceLoc.d) : 0);
    }
  }
  // How far past each sample's edge (runoff included) the point is; the road pulls the ground by a smooth
  // minimum of those (the plain minimum has a kink where two legs are equally near, which would crease the
  // ground there).
  let emin = Infinity;
  for (let k = 0; k < L; k++) {
    const i = list[k];
    d2s[k] = Math.sqrt(d2s[k]) - t.edge - runAt(t, i, -(x - t.x[i]) * t.tz[i] + (z - t.z[i]) * t.tx[i]);
    emin = Math.min(emin, d2s[k]);
  }
  let soft = 0;
  for (let k = 0; k < L; k++) {
    d2s[k] -= emin;
    if (d2s[k] < SOFTMIN * 8) soft += Math.exp(-d2s[k] / SOFTMIN);
  }
  const pull = 1 - smoothstep(0, BLEND, emin - SOFTMIN * Math.log(soft));
  const T = terrainAt(t, x, z);
  if (pull <= 0) return T;
  let wsum = 0;
  let hsum = 0;
  for (let k = 0; k < L; k++) {
    const extra = d2s[k];
    if (extra > KERNEL * 3) continue;
    const i = list[k];
    const w = Math.exp(-((extra / KERNEL) ** 2));
    const j = Math.min(t.n - 2, i);
    const rx = x - t.x[i];
    const rz = z - t.z[i];
    const along = rx * t.tx[i] + rz * t.tz[i];
    const lat = -rx * t.tz[i] + rz * t.tx[i];
    const h = t.y[i] + ((t.y[j + 1] - t.y[j]) / SAMPLE) * along - t.bank[i] * lat;
    wsum += w;
    hsum += w * h;
  }
  return T + (hsum / wsum - T) * pull;
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
  if (tmpLoc.i >= 0 && !(t.ramps.length && rampLift(t.ramps, tmpLoc.s, tmpLoc.d) > 0)) {
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
    out.surf =
      ad > t.half + SHOULDER ? (ad >= dirtFrom(t, runoffAt(t, tmpLoc.s, tmpLoc.d)) ? 'dirt' : 'grass') : t.gravel[tmpLoc.i] ? 'gravel' : ad <= t.half ? 'asphalt' : 'shoulder';
    return out;
  }
  const onRamp = tmpLoc.i >= 0;
  const e = onRamp ? 0.25 : 0.6;
  const hx = heightAt(t, x + e, z);
  const hz = heightAt(t, x, z + e);
  const nx = -(hx - h) / e;
  const nz = -(hz - h) / e;
  const l = Math.hypot(nx, 1, nz);
  out.nx = nx / l;
  out.ny = 1 / l;
  out.nz = nz / l;
  out.surf = onRamp ? 'asphalt' : onCut(t, x, z) ? 'gravel' : 'grass';
  return out;
}

/** A shortcut from `s0` to `s1`: a gently curving chord, its height running straight between the ends. */
function makeCut(t: Track, s0: number, s1: number): Cut {
  const a = pointAt(t, s0, 0);
  const b = pointAt(t, s1, 0);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / SAMPLE) + 1);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  // Leave along the road's direction, so the way in reads as a turn-off rather than a wall.
  const k = len * 0.25;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const p0x = a.x + a.tx * k;
    const p0z = a.z + a.tz * k;
    const p1x = b.x - b.tx * k;
    const p1z = b.z - b.tz * k;
    const m = 1 - u;
    x[i] = m * m * m * a.x + 3 * m * m * u * p0x + 3 * m * u * u * p1x + u * u * u * b.x;
    z[i] = m * m * m * a.z + 3 * m * m * u * p0z + 3 * m * u * u * p1z + u * u * u * b.z;
    y[i] = a.y + (b.y - a.y) * (u * u * (3 - 2 * u));
  }
  const pad = CUT_HALF + CUT_BLEND + 2;
  const box: [number, number, number, number] = [Math.min(...x) - pad, Math.max(...x) + pad, Math.min(...z) - pad, Math.max(...z) + pad];
  return { s0, s1, x, y, z, box };
}

/** Nearest point of any shortcut's track (its height and distance), or null if none is near. */
function nearCut(t: Track, x: number, z: number): { h: number; d: number } | null {
  let best: { h: number; d: number } | null = null;
  for (const c of t.cuts) {
    if (x < c.box[0] || x > c.box[1] || z < c.box[2] || z > c.box[3]) continue;
    for (let i = 0; i < c.x.length - 1; i++) {
      const sx = c.x[i + 1] - c.x[i];
      const sz = c.z[i + 1] - c.z[i];
      const l2 = sx * sx + sz * sz || 1;
      const f = Math.max(0, Math.min(1, ((x - c.x[i]) * sx + (z - c.z[i]) * sz) / l2));
      const d = Math.hypot(x - c.x[i] - sx * f, z - c.z[i] - sz * f);
      if (!best || d < best.d) best = { d, h: c.y[i] + (c.y[i + 1] - c.y[i]) * f };
    }
  }
  return best;
}

/** On (or right beside) a shortcut's track: the barrier lets you through here. */
export function onCut(t: Track, x: number, z: number, margin = 1): boolean {
  if (!t.cuts.length) return false;
  const c = nearCut(t, x, z);
  return !!c && c.d <= CUT_HALF + margin;
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
