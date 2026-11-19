// Kanjo, the open world: an island with a mountain, a small harbour city at its foot, a highway ring round the
// coast, a runway, and roads up, over and down the mountain. No start or finish: you drive where you like, and
// online everyone in the room shares it (free roam, the lobby's Free roam mode).
//
// A race track is one centreline with the ground blended into hills round it (track.ts). The world is many roads:
// every road is sampled every SAMPLE metres like a track, and all the samples go into one set of arrays (a car's
// `hint` is an index into them). The ground is the island's terrain (a coarse precomputed field) pulled onto every
// road nearby: each stretch of road (a run of neighbouring samples) has a plane out to its edge and blends into the
// terrain over BLEND metres, and stretches that overlap (junctions) average. Bridges are a second layer: their
// samples (`deck`) only count for a car whose hint is on that road near the bridge, so everything else (the terrain
// mesh, the road underneath, a car on it) sees the world under the bridge.
//
// Walls are 2D segments with a height range (guard rails, the highway's median, bridge parapets, buildings), hashed
// on a coarse grid; vehicle.ts pushes cars off them. Traffic runs on closed routes (a road, or legs of several,
// at a lane's offset), every car a pure function of the clock like Neon Bay's (traffic.ts).
//
// Everything here is deterministic and shared: the physics, the renderer (kanjo/client/worldview.ts) and the tests
// all ask the same functions.

import { type Ground, type Loc, SAMPLE, SHOULDER, type Track, type TrackDef, type WorldHooks, fbm, smooth, smoothstep, spline } from './track.ts';

export type RoadKind = 'highway' | 'street' | 'avenue' | 'pass' | 'country' | 'lot' | 'runway' | 'ramp';

/** A control point: x, z and optionally y (a number pins the height; 'snap' takes the ground of the roads built before). */
type WP = [number, number] | [number, number, number | 'snap'];

export interface RoadDef {
  id: string;
  name: string;
  kind: RoadKind;
  pts: WP[];
  /** A loop (the last point joins the first). */
  closed?: boolean;
  /** Asphalt width (m). */
  width: number;
  /** Bridge decks: [from, to] control point indexes (the road between them is a deck, not ground). */
  bridges?: [number, number][];
  /** Jumps: the road rises `size` m over `len` m round control point `at` and falls away again. */
  crests?: { at: number; size: number; len: number }[];
  /** Heaved tarmac between two control points (like a hill climb's `bumps`). */
  bumps?: { from: number; to: number; size: number }[];
  /** Steepest grade the profile allows (default 0.11). */
  grade?: number;
  /** Guard rails both sides (default: highway, pass, ramp and every bridge). */
  rails?: boolean;
  /** Smoothing of the auto height profile (samples; default 30). */
  soften?: number;
}

export interface RailRun {
  kind: 'rail' | 'median' | 'parapet';
  /** x, y, z per point (a sample every 4 m), and the side it faces (+1: the road is to its left... see `side`). */
  pts: number[];
  /** Which side of the road it's on (-1 left, +1 right, 0 the median). */
  side: number;
}

/** A kicker ramp: a wedge on the ground, `len` long and rising to `h` at its lip, facing `yaw`. */
export interface Kicker {
  x: number;
  z: number;
  yaw: number;
  len: number;
  width: number;
  h: number;
}

/** Where cars appear: the meet by the harbour, the summit lookout, the runway. */
export interface Spawn {
  name: string;
  x: number;
  z: number;
  yaw: number;
}

/** A speed trap across a fast road: a gate the HUD times you through. */
export interface Trap {
  name: string;
  x: number;
  z: number;
  /** Unit direction along the road. */
  tx: number;
  tz: number;
  /** Half the width it covers. */
  half: number;
}

/** A city block's building: a box (footprint centre, half sizes along x and z, height) on the ground at `y`. */
export interface Building {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  y: number;
  /** 0 offices (glass), 1 flats, 2 shops (low, signs), 3 a landmark tower. */
  kind: number;
  seed: number;
}

export interface Road {
  def: RoadDef;
  /** First and one-past-last sample in the world's arrays. */
  i0: number;
  i1: number;
  half: number;
  /** The road's flat plane reaches this far from the centreline before blending into the terrain. */
  edge: number;
  closed: boolean;
  length: number;
  rails: boolean;
}

/** A traffic lane: a closed polyline every SAMPLE m and how fast its cars go. */
export interface Route {
  name: string;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Unit tangent at each point. */
  tx: Float64Array;
  tz: Float64Array;
  length: number;
  v: number;
  /** Where each car is along it at time 0, and its paint seed. */
  cars: { s0: number; paint: number }[];
}

export interface World {
  def: TrackDef;
  roads: Road[];
  byId: Map<string, Road>;
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  tx: Float64Array;
  tz: Float64Array;
  bank: Float64Array;
  curv: Float64Array;
  /** Which road each sample is on, and its distance along that road. */
  road: Uint16Array;
  rs: Float64Array;
  /** 1 on bridge decks; `deckSpan` gives the deck's [first, last] sample for each deck sample's bridge. */
  deck: Uint8Array;
  deckSpans: [number, number][];
  grid: Map<number, Int32Array>;
  /** Terrain field (before the roads). */
  field: { x0: number; z0: number; nx: number; nz: number; h: Float32Array };
  walls: Float32Array;
  wallGrid: Map<number, Int32Array>;
  /** The rails, the median and the bridge parapets as drawn: runs of points (x, y, z) at the road's surface. */
  railRuns: RailRun[];
  kickers: Kicker[];
  buildings: Building[];
  spawns: Spawn[];
  traps: Trap[];
  routes: Route[];
  bounds: { x0: number; x1: number; z0: number; z1: number };
  water: number;
}

// ---------------------------------------------------------------------------------------------
// Tuning

export const WORLD = {
  seed: 4127,
  /** Sea level. */
  water: 0,
  /** The city's ground (m). */
  cityY: 7,
  /** The terrain field: spacing and how far it reaches (a square, metres from the origin). */
  cell: 8,
  extent: 5200,
  /** Ground blends from a road's plane into the terrain over this far. */
  blend: 26,
  /** A car more than this far under water is put back on the road. */
  drown: 1.6,
};

const VERGE = 3;
/** A pinned height bends the road's profile this far either side of it (m). */
const PIN_REACH = 420;
const EDGE_PAD = 1.5;
const CELL = 16;
const WALL_CELL = 32;
const cellKey = (c: number, r: number) => (c + 4096) * 8192 + (r + 4096);

/** The city: a grid of blocks on the flat by the bay. */
export const CITY = { x0: 700, x1: 1650, z0: 780, z1: 1450, avenues: [890, 1080, 1270, 1460], streets: [1000, 1225] };
const MOUNTAIN = { x: -780, z: -780, h: 470, r: 950 };
/** The Bayshore straight's coastal flat: its line (x), middle and half length (z), and the ground's height. */
const BAYSHORE = { x: 2336, z: -490, half: 1010, y: 7 };
/** The plain round the city: its core rectangles and how far it eases out (m). */
const PLAIN = {
  // x0, x1, z0, z1: north and east of the city to the airfield, and west of the city (clear of the pass's hairpins).
  rects: [
    [650, 2500, -1150, 1500],
    [300, 650, 650, 1500],
  ] as [number, number, number, number][],
  ease: 420,
  /** The plain rises from the city's level north of here to the airfield's. */
  rise0: 700,
};
/** The runway's flat: a plateau north-east of the mountain. */
const RUNWAY = { x0: 520, x1: 1980, z: -1330, y: 34 };

// ---------------------------------------------------------------------------------------------
// The island's terrain

function hash(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

function ridges(x: number, z: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    const r = 1 - Math.abs(vnoise(x, z, seed + o * 17));
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.1;
    z *= 2.1;
  }
  return sum / norm;
}

/** How far inland (x, z) is: 0 on the coast, about 1 in the middle, negative at sea. */
export function landAt(x: number, z: number): number {
  const s = WORLD.seed;
  const e = Math.hypot((x - 60) / 3050, (z + 80) / 2450);
  let m = 1 - e + fbm(x / 1100, z / 1100, s + 1, 3) * 0.1 + fbm(x / 320, z / 320, s + 2, 2) * 0.025;
  // The bay south of the city.
  m -= 0.42 * Math.exp(-(((x - 1180) / 560) ** 2) - ((z - 1980) / 330) ** 2);
  // A cove on the north-west coast under the cliffs.
  m -= 0.12 * Math.exp(-(((x + 1500) / 380) ** 2) - ((z + 2250) / 260) ** 2);
  // The east coast runs straight along the Bayshore, a beach's width past the expressway.
  m -= 0.24 * smoothstep(BAYSHORE.x + 60, BAYSHORE.x + 260, x) * (1 - smoothstep(BAYSHORE.half, BAYSHORE.half + 500, Math.abs(z - BAYSHORE.z)));
  return m;
}

/**
 * 1 on the plain between the city, the Bayshore and the airfield, easing to 0 toward the mountain: the expressway
 * and the roads out of town cross it at grade instead of down 60 m cuttings.
 */
function plainAt(x: number, z: number): number {
  let best = 0;
  for (const r of PLAIN.rects) {
    const dx = Math.max(r[0] - x, x - r[1], 0);
    const dz = Math.max(r[2] - z, z - r[3], 0);
    best = Math.max(best, 1 - smoothstep(0, PLAIN.ease, Math.hypot(dx, dz)));
  }
  return best;
}

/** 1 on the coastal flat the Bayshore straight runs along, easing to 0 inland. */
function bayshoreAt(x: number, z: number): number {
  const dz = Math.max(Math.abs(z - BAYSHORE.z) - BAYSHORE.half, 0);
  const dx = Math.max(BAYSHORE.x - 90 - x, 0);
  return 1 - smoothstep(0, 320, Math.hypot(dx, dz));
}

/** City (1 inside its blocks, easing to 0 over 160 m), so the terrain lies flat there. */
export function cityAt(x: number, z: number): number {
  const dx = Math.max(CITY.x0 - 60 - x, x - CITY.x1 - 60, 0);
  const dz = Math.max(CITY.z0 - 60 - z, z - (CITY.z1 + 260), 0);
  return 1 - smoothstep(0, 160, Math.hypot(dx, dz));
}

function runwayAt(x: number, z: number): number {
  const dx = Math.max(RUNWAY.x0 - 80 - x, x - RUNWAY.x1 - 80, 0);
  const dz = Math.max(Math.abs(z - RUNWAY.z) - 110, 0);
  return 1 - smoothstep(0, 220, Math.hypot(dx, dz));
}

/** The island's ground before any road: coast, hills, the mountain, the flats of the city and the runway. */
export function rawTerrain(x: number, z: number): number {
  const s = WORLD.seed;
  const m = landAt(x, z);
  // Beach, then the land rising inland; under water the seabed falls away.
  let h = m > 0 ? 2.2 + 60 * smoothstep(0.02, 0.4, m) : m * 260 + 2.2 * Math.max(0, 1 + m * 25);
  const inland = smoothstep(0.03, 0.25, m);
  h += fbm(x / 520, z / 520, s + 3, 4) * 34 * inland + fbm(x / 140, z / 140, s + 4, 3) * 6 * inland;
  // The mountain: a broad cone with ridges and gullies, and a lesser peak to its west.
  const r = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
  const cone = Math.exp(-((r / MOUNTAIN.r) ** 1.7));
  h += MOUNTAIN.h * cone * (0.72 + 0.4 * ridges(x / 650, z / 650, s + 5));
  // A shoulder running off it to the north, toward the cliffs.
  const r2 = Math.hypot((x + 900) / 1.6, z + 1550);
  h += 160 * Math.exp(-((r2 / 520) ** 1.8)) * (0.7 + 0.4 * ridges(x / 500, z / 500, s + 6));
  // Cliffs along the north coast: the land stays high right to the water.
  h += 70 * smoothstep(-900, -1900, z) * smoothstep(-0.02, 0.12, m) * (1 - smoothstep(1200, 2200, x));
  // The plain: low rolling ground, rising gently from the city to the airfield's plateau (a little of the hills left).
  const plain = plainAt(x, z) * smoothstep(0.03, 0.1, m);
  const base = WORLD.cityY + (RUNWAY.y - WORLD.cityY) * smoothstep(PLAIN.rise0, RUNWAY.z + 150, z);
  h += (base + (h - base) * 0.18 - h) * plain;
  // Flats.
  h += (BAYSHORE.y - h) * bayshoreAt(x, z);
  h += (WORLD.cityY - h) * cityAt(x, z);
  h += (RUNWAY.y - h) * runwayAt(x, z);
  return h;
}

// ---------------------------------------------------------------------------------------------
// The layout

/** A rounded rectangle's control points (corner radius r), clockwise from its north-west corner. */
function roundRect(x0: number, z0: number, x1: number, z1: number, r: number): WP[] {
  const out: WP[] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let k = 0; k <= 3; k++) {
      const a = a0 + (k / 3) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  corner(x0 + r, z0 + r, Math.PI);
  corner(x1 - r, z0 + r, -Math.PI / 2);
  corner(x1 - r, z1 - r, 0);
  corner(x0 + r, z1 - r, Math.PI / 2);
  return out;
}

/** A circle's control points. */
function circle(cx: number, cz: number, r: number, n: number, a0 = 0): WP[] {
  return Array.from({ length: n }, (_, k) => [cx + Math.cos(a0 + (k / n) * Math.PI * 2) * r, cz + Math.sin(a0 + (k / n) * Math.PI * 2) * r] as WP);
}

const SUMMIT = { x: -265, z: -275, r: 62 };

/** Every road, in build order: a road can snap its ends onto the ground of the roads before it. */
export function layout(): RoadDef[] {
  const { x0, x1, z0, z1, avenues, streets } = CITY;
  const y = WORLD.cityY;
  const roads: RoadDef[] = [
    // The highway ring: the Bayshore straight down the east coast (2 km, flat), over the city's north side on a
    // viaduct past the mountain's foot, round the west hills, along the north cliffs and back.
    {
      id: 'hw',
      name: 'Ring Expressway',
      kind: 'highway',
      closed: true,
      width: 24.8,
      grade: 0.06,
      soften: 60,
      pts: [
        [2330, 520, 9], // 0 south end of the Bayshore straight
        [2340, -200, 9],
        [2340, -900, 10],
        [2330, -1500, 12], // 3 north end of the straight
        [2120, -1880],
        [1600, -2120],
        [900, -2230],
        [200, -2280],
        [-500, -2240], // 8
        [-1150, -2120, 'snap'],
        [-1750, -1830],
        [-2250, -1350],
        [-2580, -700],
        [-2700, 0], // 13
        [-2560, 760],
        [-2050, 1300],
        [-1350, 1440],
        [-650, 1390], // 17
        [-50, 1180],
        [180, 980, 22], // 19 over the country road
        [330, 790, 22],
        [520, 640, 22], // 21 over the pass road
        [760, 560, 18],
        [1250, 540, 12],
        [1750, 560, 9], // 24
        [2150, 620, 9],
      ],
      bridges: [
        [10, 12], // the West Valley viaduct
        [18, 20],
        [20, 22],
      ],
    },
    // The city: a boulevard round it (traffic), avenues north to south and streets east to west across it.
    { id: 'ring', name: 'Minato Boulevard', kind: 'avenue', closed: true, width: 14, pts: roundRect(x0, z0, x1, z1, 46).map(([x, z]) => [x, z, y] as WP) },
    ...avenues.map((ax, k): RoadDef => ({ id: `av${k}`, name: `${['Ichi', 'Ni', 'San', 'Yon'][k]}-dōri`, kind: 'street', width: 10, pts: [[ax, z0, y], [ax, (z0 + z1) / 2, y], [ax, z1, y]] })),
    ...streets.map((sz, k): RoadDef => ({ id: `st${k}`, name: `${['Hana', 'Kaze'][k]} Street`, kind: 'street', width: 10, pts: [[x0, sz, y], [(x0 + x1) / 2, sz, y], [x1, sz, y]] })),
    // Down by the water: the harbour drive and the car meet on the quay.
    {
      id: 'bay',
      name: 'Harbour Drive',
      kind: 'avenue',
      width: 12,
      pts: [
        [x0 + 30, z1, y],
        [x0 - 20, z1 + 90, y],
        [x0 + 160, z1 + 175, y],
        [1180, z1 + 205, y],
        [x1 - 160, z1 + 175, y],
        [x1 + 20, z1 + 90, y],
        [x1 - 30, z1, y],
      ],
    },
    { id: 'meet', name: 'Harbour meet', kind: 'lot', width: 56, pts: [[1060, 1595, y], [1180, 1598, y], [1300, 1595, y]] },
    // Ramps between the city and the expressway at both ends of the viaduct.
    {
      id: 'rampE',
      name: 'East ramp',
      kind: 'ramp',
      width: 9,
      pts: [
        [x1, 980, 'snap'],
        [1760, 900, y],
        [1880, 760],
        [1990, 650],
        [2100, 615, 'snap'],
      ],
    },
    // The summit: a loop round the top, and the lookout over the city.
    { id: 'summit', name: 'Summit loop', kind: 'pass', closed: true, width: 9, rails: true, soften: 80, pts: circle(SUMMIT.x, SUMMIT.z, SUMMIT.r, 10) },
    // The lookout: a lot off the loop with the view over the city (short of the pass's hairpin below its end).
    { id: 'lookout', name: 'Summit lookout', kind: 'lot', width: 34, rails: true, pts: [[SUMMIT.x + 52, SUMMIT.z + 52, 'snap'], [SUMMIT.x + 76, SUMMIT.z + 76], [SUMMIT.x + 98, SUMMIT.z + 98]] },
    // The pass: out of the city's north-west corner, under the viaduct, then hairpins up the mountain's south face
    // to the summit loop.
    {
      id: 'pass',
      name: 'Kanjo Pass',
      kind: 'pass',
      width: 8,
      grade: 0.12,
      soften: 14,
      pts: [
        [x0, 900, 'snap'],
        [600, 800, y],
        [520, 650, 8], // 2 under the viaduct
        [430, 470],
        [300, 330],
        [60, 270],
        [-130, 300], // 6 hairpin
        [-60, 190],
        [190, 120],
        [330, 40], // 9 hairpin
        [250, -70],
        [40, -60],
        [-190, -20], // 12 hairpin
        [-210, -110],
        [-40, -170],
        [80, -260], // 15 hairpin
        [-20, -340],
        [-150, -340],
        [SUMMIT.x + 18, SUMMIT.z - SUMMIT.r + 1, 'snap'],
      ],
      bumps: [{ from: 13, to: 15, size: 0.22 }],
    },
    // The back road: off the summit down the north-west side, with jumps and broken tarmac, to the expressway.
    {
      id: 'kita',
      name: 'Kita Descent',
      kind: 'pass',
      width: 8,
      grade: 0.12,
      soften: 16,
      rails: false,
      pts: [
        [SUMMIT.x - SUMMIT.r + 1, SUMMIT.z + 12, 'snap'],
        [-420, -220],
        [-600, -120],
        [-860, -90],
        [-1100, -200], // 4
        [-1330, -360],
        [-1500, -560],
        [-1620, -820],
        [-1640, -1060], // 8
        [-1560, -1280],
        [-1640, -1480],
        [-1720, -1640],
        [-1760, -1760], // 12
        [-1800, -1830, 'snap'],
      ],
      crests: [
        { at: 3, size: 2.0, len: 34 },
        { at: 7, size: 2.4, len: 38 },
        { at: 10, size: 1.8, len: 30 },
      ],
      bumps: [{ from: 5, to: 6, size: 0.3 }],
    },
    // The country road: west from the city over rolling farmland (crests you can fly off) to the expressway.
    {
      id: 'inaka',
      name: 'Inaka Road',
      kind: 'country',
      width: 8,
      grade: 0.1,
      soften: 20,
      pts: [
        [x0, 1225, 'snap'],
        [520, 1240, y],
        [300, 1180],
        [130, 1040], // 3 under the viaduct
        [-150, 900],
        [-500, 860],
        [-850, 760], // 6
        [-1200, 600],
        [-1550, 520],
        [-1900, 430],
        [-2250, 260],
        [-2590, 160, 'snap'],
      ],
      crests: [
        { at: 5, size: 1.6, len: 30 },
        { at: 7, size: 2.0, len: 32 },
        { at: 9, size: 1.7, len: 30 },
      ],
    },
    // The runway: 1.4 km of flat concrete on the plateau north-east of the mountain, and its taxiway to the expressway.
    { id: 'runway', name: 'Old Airfield', kind: 'runway', width: 46, pts: [[RUNWAY.x0, RUNWAY.z, RUNWAY.y], [(RUNWAY.x0 + RUNWAY.x1) / 2, RUNWAY.z, RUNWAY.y], [RUNWAY.x1, RUNWAY.z, RUNWAY.y]] },
    {
      id: 'taxi',
      name: 'Airfield Road',
      kind: 'ramp',
      width: 9,
      rails: false,
      pts: [
        [RUNWAY.x1 - 60, RUNWAY.z + 20, 'snap'],
        [2070, -1240, RUNWAY.y],
        [2200, -1150],
        [2318, -1120, 'snap'],
      ],
    },
  ];
  return roads;
}

// ---------------------------------------------------------------------------------------------
// Building the world

let built: World | null = null;

/** The world (built once). */
export function getWorld(def: TrackDef): World {
  return (built ??= buildWorld(def));
}

export function buildWorld(def: TrackDef): World {
  const B = WORLD.blend;
  // Terrain field.
  const fx0 = -WORLD.extent;
  const fz0 = -WORLD.extent;
  const fn = Math.round((2 * WORLD.extent) / WORLD.cell) + 1;
  const fh = new Float32Array(fn * fn);
  for (let r = 0; r < fn; r++) for (let c = 0; c < fn; c++) fh[r * fn + c] = rawTerrain(fx0 + c * WORLD.cell, fz0 + r * WORLD.cell);
  const field = { x0: fx0, z0: fz0, nx: fn, nz: fn, h: fh };

  const w: World = {
    def,
    roads: [],
    byId: new Map(),
    n: 0,
    x: new Float64Array(0),
    y: new Float64Array(0),
    z: new Float64Array(0),
    tx: new Float64Array(0),
    tz: new Float64Array(0),
    bank: new Float64Array(0),
    curv: new Float64Array(0),
    road: new Uint16Array(0),
    rs: new Float64Array(0),
    deck: new Uint8Array(0),
    deckSpans: [],
    grid: new Map(),
    field,
    walls: new Float32Array(0),
    wallGrid: new Map(),
    railRuns: [],
    kickers: [],
    buildings: [],
    spawns: [],
    traps: [],
    routes: [],
    bounds: { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity },
    water: WORLD.water,
  };

  // Roads one at a time: each is added (samples + hash) before the next is laid, so 'snap' points can read it.
  const X: number[] = [];
  const Y: number[] = [];
  const Z: number[] = [];
  const TX: number[] = [];
  const TZ: number[] = [];
  const BANK: number[] = [];
  const CURV: number[] = [];
  const RD: number[] = [];
  const RS: number[] = [];
  const DECK: number[] = [];
  const lists = new Map<number, number[]>();
  const commit = () => {
    w.n = X.length;
    w.x = Float64Array.from(X);
    w.y = Float64Array.from(Y);
    w.z = Float64Array.from(Z);
    w.tx = Float64Array.from(TX);
    w.tz = Float64Array.from(TZ);
    w.bank = Float64Array.from(BANK);
    w.curv = Float64Array.from(CURV);
    w.road = Uint16Array.from(RD);
    w.rs = Float64Array.from(RS);
    w.deck = Uint8Array.from(DECK);
    w.grid = new Map([...lists].map(([k, l]) => [k, Int32Array.from(l)]));
  };

  for (const rd of layout()) {
    const closed = !!rd.closed;
    const pts = rd.pts;
    // Plan view: the spline through the points, resampled every SAMPLE m.
    const p3 = pts.map(([x, z]) => [x, 0, z] as [number, number, number]);
    const dense = spline(p3, closed);
    const xs: number[] = [];
    const zs: number[] = [];
    let acc = 0;
    let next = 0;
    let total = 0;
    for (let i = 0; i < dense.length - 1; i++) total += Math.hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][2] - dense[i][2]);
    // A loop's samples are spread evenly so its last one sits a sample short of its first.
    const step = closed ? total / Math.max(3, Math.round(total / SAMPLE)) : SAMPLE;
    for (let i = 0; i < dense.length - 1; i++) {
      const a = dense[i];
      const b = dense[i + 1];
      const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
      while (next <= acc + l + 1e-9 && (!closed || next < total - step / 2)) {
        const f = l > 0 ? (next - acc) / l : 0;
        xs.push(a[0] + (b[0] - a[0]) * f);
        zs.push(a[2] + (b[2] - a[2]) * f);
        next += step;
      }
      acc += l;
    }
    const n = xs.length;
    // Which sample each control point fell nearest.
    const at = pts.map(([px, pz]) => {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (xs[i] - px) ** 2 + (zs[i] - pz) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    });
    // Height: the terrain along the way (smoothed), then pinned where the points say, then grade-limited.
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) ys[i] = Math.max(2.5, fieldAt(field, xs[i], zs[i]));
    const soften = rd.soften ?? 30;
    smoothWrap(ys, soften, 3, closed);
    const pins: { i: number; y: number }[] = [];
    pts.forEach((p, k) => {
      if (p.length < 3) return;
      const v = p[2];
      let py: number;
      if (v === 'snap') py = w.n ? worldHeight(w, p[0], p[1], -1) : ys[at[k]];
      else py = v as number;
      pins.push({ i: at[k], y: py });
    });
    pins.sort((a, b) => a.i - b.i);
    if (pins.length) {
      // The correction each pin needs, spread linearly to the next pin when it's near (a bridge's run of pins), and
      // otherwise fading out over PIN_REACH either side, so a pin only bends the road near it.
      const corr = new Float64Array(n);
      const dv = pins.map((p) => p.y - ys[p.i]);
      const reach = PIN_REACH / SAMPLE;
      const fall = (d: number) => 1 - smoothstep(0, reach, d);
      for (let i = 0; i < n; i++) {
        // The pins either side (wrapping round a loop; an open road's ends hold the outermost pin's correction).
        let k = 0;
        while (k < pins.length && pins[k].i <= i) k++;
        let a = k - 1;
        let b = k;
        let ai = a >= 0 ? pins[a].i : -Infinity;
        let bi = b < pins.length ? pins[b].i : Infinity;
        if (closed) {
          if (a < 0) {
            a = pins.length - 1;
            ai = pins[a].i - n;
          }
          if (b >= pins.length) {
            b = 0;
            bi = pins[0].i + n;
          }
        }
        if (a < 0) corr[i] = dv[b];
        else if (b >= pins.length && !closed) corr[i] = dv[a];
        else if (bi - ai <= 2 * reach) corr[i] = dv[a] + ((dv[b] - dv[a]) * (i - ai)) / Math.max(1, bi - ai);
        else corr[i] = dv[a] * fall(i - ai) + dv[b] * fall(bi - i);
      }
      for (let i = 0; i < n; i++) ys[i] += corr[i];
    }
    // Lots and the runway lie flat at their first pin.
    if ((rd.kind === 'lot' || rd.kind === 'runway') && pins.length) ys.fill(pins[0].y);
    limitGrade(ys, rd.grade ?? 0.11, closed, pins.map((p) => p.i));
    smoothWrap(ys, 4, 2, closed);
    // Keep the pins exact after the last smoothing (an end that meets another road must meet it).
    for (const p of pins) {
      const d = p.y - ys[p.i];
      for (let k = -12; k <= 12; k++) {
        const j = closed ? (p.i + k + n) % n : p.i + k;
        if (j < 0 || j >= n) continue;
        ys[j] += d * (1 - Math.abs(k) / 13);
      }
    }
    // Jumps and bumps go on last, so they stay sharp.
    for (const c of rd.crests ?? []) {
      const ci = at[c.at];
      for (let i = 0; i < n; i++) {
        const u = ((i - ci) * SAMPLE) / (c.len / 2);
        if (Math.abs(u) < 1) ys[i] += (c.size * (1 + Math.cos(Math.PI * u))) / 2;
      }
    }
    for (const b of rd.bumps ?? []) {
      const s0 = Math.min(at[b.from], at[b.to]) * SAMPLE;
      const s1 = Math.max(at[b.from], at[b.to]) * SAMPLE;
      for (let i = Math.floor(s0 / SAMPLE); i <= Math.min(n - 1, Math.ceil(s1 / SAMPLE)); i++) {
        const u = i * SAMPLE;
        const k = smoothstep(s0, s0 + 30, u) * (1 - smoothstep(s1 - 30, s1, u));
        const swell = 0.6 + 0.4 * Math.sin(u / 37 + WORLD.seed);
        ys[i] += b.size * k * swell * (0.62 * Math.sin((u * 2 * Math.PI) / 14) + 0.38 * Math.sin((u * 2 * Math.PI) / 23 + 1.3));
      }
    }
    // Tangents, curvature, banking.
    const txs = new Float64Array(n);
    const tzs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const dx = xs[b] - xs[a];
      const dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dz) || 1;
      txs[i] = dx / l;
      tzs[i] = dz / l;
    }
    const cv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      cv[i] = (txs[a] * tzs[i] - tzs[a] * txs[i]) / SAMPLE;
    }
    smoothWrap(cv, 5, 2, closed);
    const flat = rd.kind === 'lot' || rd.kind === 'runway' || rd.kind === 'street' || rd.kind === 'avenue';
    const deck = new Uint8Array(n);
    for (const [a, b] of rd.bridges ?? []) for (let i = at[a]; i <= at[b]; i++) deck[i] = 1;

    const i0 = X.length;
    for (let i = 0; i < n; i++) {
      X.push(xs[i]);
      Y.push(ys[i]);
      Z.push(zs[i]);
      TX.push(txs[i]);
      TZ.push(tzs[i]);
      BANK.push(flat ? 0 : Math.max(-0.06, Math.min(0.06, cv[i] * (rd.kind === 'highway' ? 6 : 3))));
      CURV.push(cv[i]);
      RD.push(w.roads.length);
      RS.push(i * step);
      DECK.push(deck[i]);
    }
    const half = rd.width / 2;
    const edge = half + (rd.kind === 'lot' || rd.kind === 'runway' ? 4 : SHOULDER + VERGE + EDGE_PAD);
    const road: Road = { def: rd, i0, i1: i0 + n, half, edge, closed, length: n * step, rails: rd.rails ?? (rd.kind === 'highway' || rd.kind === 'pass' || rd.kind === 'ramp') };
    w.roads.push(road);
    w.byId.set(rd.id, road);
    // Deck spans (global sample ranges).
    for (const [a, b] of rd.bridges ?? []) w.deckSpans.push([i0 + at[a], i0 + at[b]]);
    // Hash: each sample in every cell its influence reaches.
    const reach = edge + B + SAMPLE * 2;
    for (let i = i0; i < i0 + n; i++) {
      const c0 = Math.floor((X[i] - reach) / CELL);
      const c1 = Math.floor((X[i] + reach) / CELL);
      const r0 = Math.floor((Z[i] - reach) / CELL);
      const r1 = Math.floor((Z[i] + reach) / CELL);
      for (let c = c0; c <= c1; c++)
        for (let r = r0; r <= r1; r++) {
          const k = cellKey(c, r);
          let l = lists.get(k);
          if (!l) lists.set(k, (l = []));
          l.push(i);
        }
      w.bounds.x0 = Math.min(w.bounds.x0, X[i]);
      w.bounds.x1 = Math.max(w.bounds.x1, X[i]);
      w.bounds.z0 = Math.min(w.bounds.z0, Z[i]);
      w.bounds.z1 = Math.max(w.bounds.z1, Z[i]);
    }
    commit();
  }

  w.kickers = kickers();
  w.walls = new Float32Array(0);
  w.buildings = buildings(w);
  buildWalls(w);
  w.spawns = spawns(w);
  w.traps = traps(w);
  w.routes = routes(w);
  return w;
}

function fieldAt(f: World['field'], x: number, z: number): number {
  const gx = Math.min(f.nx - 1.001, Math.max(0, (x - f.x0) / WORLD.cell));
  const gz = Math.min(f.nz - 1.001, Math.max(0, (z - f.z0) / WORLD.cell));
  const c = Math.floor(gx);
  const r = Math.floor(gz);
  const u = gx - c;
  const v = gz - r;
  const i = r * f.nx + c;
  const h = f.h;
  const a = h[i] + (h[i + 1] - h[i]) * u;
  const b = h[i + f.nx] + (h[i + f.nx + 1] - h[i + f.nx]) * u;
  return a + (b - a) * v;
}

/** The island's terrain at (x, z), before the roads (from the precomputed field). */
export const terrainHeight = (w: World, x: number, z: number) => fieldAt(w.field, x, z);

function smoothWrap(a: Float64Array, radius: number, passes: number, closed: boolean) {
  if (!closed) return smooth(a, radius, passes);
  const n = a.length;
  const pad = Math.min(n, radius * 2);
  const ext = new Float64Array(n + 2 * pad);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < ext.length; i++) ext[i] = a[(((i - pad) % n) + n) % n];
    smooth(ext, radius, 1);
    for (let i = 0; i < n; i++) a[i] = ext[i + pad];
  }
}

/** No steeper than `g` anywhere: lifts dips and trims rises (forward, back, repeated) without moving the pins. */
function limitGrade(y: Float64Array, g: number, closed: boolean, pins: number[]) {
  const n = y.length;
  const d = g * SAMPLE;
  const pinned = new Uint8Array(n);
  for (const p of pins) pinned[p] = 1;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < n + (closed ? n : 0); i++) {
      const a = (i - 1) % n;
      const b = i % n;
      if (pinned[b]) continue;
      y[b] = Math.max(y[a] - d, Math.min(y[a] + d, y[b]));
    }
    for (let i = n - 2 + (closed ? n : 0); i >= 0; i--) {
      const a = (i + 1) % n;
      const b = i % n;
      if (pinned[b]) continue;
      y[b] = Math.max(y[a] - d, Math.min(y[a] + d, y[b]));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The ground

/** Up to this many stretches of road at once (junctions). */
const MAXP = 12;
const pI = new Int32Array(MAXP);
const pD = new Float64Array(MAXP);
const pH = new Float64Array(MAXP);
const pK = new Float64Array(MAXP);
const pW = new Float64Array(MAXP);
const pE = new Float64Array(MAXP);

/** How far before and after a bridge a car still counts as on its way over (samples). */
const APPROACH = 60;

/** The bridge whose layer a hint puts a query on (-1: the ground layer). */
function layerOf(w: World, hint: number): number {
  if (hint < 0 || hint >= w.n || !w.deckSpans.length) return -1;
  const r = w.road[hint];
  for (let k = 0; k < w.deckSpans.length; k++) {
    const [a, b] = w.deckSpans[k];
    if (w.road[a] === r && hint >= a - APPROACH && hint <= b + APPROACH) return k;
  }
  return -1;
}

/** Projects (x, z) onto the segments either side of sample i (within its road; loops wrap). */
function projectOn(w: World, i: number, x: number, z: number, out: Loc): number {
  const rd = w.roads[w.road[i]];
  let best = Infinity;
  for (const k0 of [i - 1, i]) {
    let a = k0;
    let b = k0 + 1;
    if (rd.closed) {
      const n = rd.i1 - rd.i0;
      a = rd.i0 + ((((a - rd.i0) % n) + n) % n);
      b = rd.i0 + ((((b - rd.i0) % n) + n) % n);
    } else if (a < rd.i0 || b >= rd.i1) continue;
    const ax = w.x[a];
    const az = w.z[a];
    const sx = w.x[b] - ax;
    const sz = w.z[b] - az;
    const l2 = sx * sx + sz * sz || 1;
    let f = ((x - ax) * sx + (z - az) * sz) / l2;
    // Past either end of an open road the plane carries on a little (so the end isn't a cliff), then the blend.
    const lo = !rd.closed && a === rd.i0 ? -2 : 0;
    const hi = !rd.closed && b === rd.i1 - 1 ? 3 : 1;
    f = Math.min(hi, Math.max(lo, f));
    const cx = ax + sx * f;
    const cz = az + sz * f;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 < best) {
      best = d2;
      const l = Math.sqrt(l2);
      const tx = sx / l;
      const tz = sz / l;
      const fc = Math.min(1, Math.max(0, f));
      out.i = fc < 0.5 ? a : b;
      out.s = a * SAMPLE + fc * SAMPLE;
      out.d = (x - cx) * -tz + (z - cz) * tx;
      out.cx = cx;
      out.cy = w.y[a] + (w.y[b] - w.y[a]) * f;
      out.cz = cz;
      out.tx = tx;
      out.tz = tz;
    }
  }
  return best;
}

const pl: Loc = { i: 0, s: 0, d: 0, cx: 0, cy: 0, cz: 0, tx: 0, tz: -1 };
/** The stretch of road the last worldHeight call found the point on (its plane), or -1. */
let onPiece = -1;
let onSurf = 0;

/**
 * Collects the stretches of road near (x, z) on the query's layer: for each, the nearest point (pD: offset from the
 * centreline, pH: the road's height there), into the p* arrays. Returns how many.
 */
function pieces(w: World, x: number, z: number, layer: number): number {
  const list = w.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return 0;
  let np = 0;
  let runStart = -2;
  let bestI = -1;
  let bestD = Infinity;
  let prev = -10;
  const deckRoad = layer >= 0 ? w.road[w.deckSpans[layer][0]] : -1;
  const flush = () => {
    if (bestI < 0 || np >= MAXP) return;
    const d2 = projectOn(w, bestI, x, z, pl);
    const rd = w.roads[w.road[bestI]];
    pI[np] = pl.i;
    pD[np] = pl.d;
    pE[np] = Math.sqrt(d2) - rd.edge; // how far past the plane's edge
    pH[np] = pl.cy - w.bank[pl.i] * Math.max(-rd.edge, Math.min(rd.edge, pl.d));
    np++;
  };
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    // On a bridge's layer only that road counts; on the ground layer, no deck does.
    if (layer >= 0 ? w.road[i] !== deckRoad : w.deck[i]) continue;
    if (i !== prev + 1 || w.road[i] !== w.road[Math.max(0, prev)]) {
      flush();
      bestI = -1;
      bestD = Infinity;
      runStart = i;
    }
    prev = i;
    const d = (w.x[i] - x) ** 2 + (w.z[i] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  void runStart;
  flush();
  return np;
}

/**
 * Height of the ground at (x, z): the terrain, pulled onto every road near enough by its plane. `hint` (a car's
 * last sample) picks the layer at a bridge. `out`, when given, receives the road location if the point is on a
 * road's plane (out.i = -1 otherwise).
 */
export function worldHeight(w: World, x: number, z: number, hint: number, out?: Loc): number {
  let layer = layerOf(w, hint);
  let np = pieces(w, x, z, layer);
  // Off the bridge's road altogether (beside the deck, past its plane): the world below.
  if (layer >= 0) {
    let e = Infinity;
    for (let k = 0; k < np; k++) e = Math.min(e, pE[k]);
    if (e > 0.5) {
      layer = -1;
      np = pieces(w, x, z, -1);
    }
  }
  const T = fieldAt(w.field, x, z) + kickerLift(w, x, z);
  onPiece = -1;
  if (out) out.i = -1;
  if (!np) return T;
  const B = WORLD.blend;
  let K = 0;
  let ws = 0;
  let hs = 0;
  let bestE = Infinity;
  let bestK = -1;
  for (let k = 0; k < np; k++) {
    const e = pE[k];
    const kk = 1 - smoothstep(0, B, e);
    // Weight: strongest deep inside a road's plane, fading to the edge of its blend.
    const inner = Math.min(1, Math.max(0, -e / 3));
    const wt = kk * kk * (0.03 + inner);
    pK[k] = kk;
    pW[k] = wt;
    K = Math.max(K, kk);
    ws += wt;
    hs += wt * pH[k];
    if (e < bestE) {
      bestE = e;
      bestK = k;
    }
  }
  if (bestE <= 0) {
    onPiece = pI[bestK];
    onSurf = Math.abs(pD[bestK]);
    if (out) {
      const rd = w.roads[w.road[pI[bestK]]];
      projectOn(w, pI[bestK], x, z, out);
      void rd;
    }
  }
  // On a road's plane, only the roads whose planes cover the point count: a road below the edge of a lookout or
  // a hairpin under a bend's verge mustn't drag the surface you're driving on down with it.
  if (bestE <= 0) {
    ws = hs = 0;
    for (let k = 0; k < np; k++)
      if (pE[k] <= 0) {
        ws += pW[k];
        hs += pW[k] * pH[k];
      }
  }
  if (ws <= 0) return T;
  const R = hs / ws;
  if (layer >= 0) return R;
  return T + (R - T) * K;
}

/** Height, normal and surface at (x, z). */
export function worldGround(w: World, x: number, z: number, out: Ground, hint: number): Ground {
  const h = worldHeight(w, x, z, hint, gl);
  const piece = onPiece;
  const dist = onSurf;
  const e = 0.35;
  const hx = worldHeight(w, x + e, z, hint);
  const hz = worldHeight(w, x, z + e, hint);
  const nx = -(hx - h) / e;
  const nz = -(hz - h) / e;
  const l = Math.hypot(nx, 1, nz);
  out.h = h;
  out.nx = nx / l;
  out.ny = 1 / l;
  out.nz = nz / l;
  if (piece >= 0) {
    const rd = w.roads[w.road[piece]];
    out.surf = dist <= rd.half || rd.def.kind === 'lot' || rd.def.kind === 'runway' ? 'asphalt' : dist <= rd.half + SHOULDER ? 'shoulder' : cityAt(x, z) > 0.9 ? 'shoulder' : 'grass';
  } else out.surf = cityAt(x, z) > 0.9 ? 'shoulder' : fieldAt(w.field, x, z) < 3.2 ? 'dirt' : 'grass';
  return out;
}
const gl: Loc = { i: 0, s: 0, d: 0, cx: 0, cy: 0, cz: 0, tx: 0, tz: -1 };

/**
 * The road a car is on: the stretch nearest (x, z), keeping to the hint's road while the car is still on it (so
 * a car under a bridge stays on the road below, and one on it stays on the deck). Off every road, the hint's
 * stretch with a large offset.
 */
export function worldLocate(w: World, x: number, z: number, hint: number, out: Loc): Loc {
  const layer = layerOf(w, hint);
  const np = pieces(w, x, z, layer);
  let best = -1;
  let bestE = Infinity;
  for (let k = 0; k < np; k++) {
    let e = pE[k];
    // Stickiness: the road the car was on wins a tie by a few metres.
    if (hint >= 0 && w.road[pI[k]] === w.road[hint] && Math.abs(pI[k] - hint) < 40) e -= 4;
    if (e < bestE) {
      bestE = e;
      best = pI[k];
    }
  }
  if (best < 0) best = hint >= 0 && hint < w.n ? hint : 0;
  projectOn(w, best, x, z, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Kickers

function kickers(): Kicker[] {
  return [
    // On the runway's west apron: a pair of launch ramps.
    { x: RUNWAY.x0 + 140, z: RUNWAY.z - 12, yaw: Math.PI / 2, len: 14, width: 7, h: 1.9 },
    { x: RUNWAY.x0 + 140, z: RUNWAY.z + 12, yaw: Math.PI / 2, len: 14, width: 7, h: 1.9 },
    // The big one at the far end: 22 m long, 3.2 m lip.
    { x: RUNWAY.x0 + 60, z: RUNWAY.z, yaw: Math.PI / 2, len: 22, width: 9, h: 3.2 },
    // In the harbour meet's corner.
    { x: 1320, z: 1612, yaw: -Math.PI / 2, len: 12, width: 6, h: 1.3 },
  ];
}

/** A kicker's lift at (x, z) (0 off every kicker). The ramp faces `yaw` (three.js: nose toward -z at yaw 0). */
function kickerLift(w: World, x: number, z: number): number {
  for (const k of w.kickers) {
    const dx = x - k.x;
    const dz = z - k.z;
    if (dx * dx + dz * dz > (k.len + k.width) ** 2) continue;
    const fx = -Math.sin(k.yaw);
    const fz = -Math.cos(k.yaw);
    const along = dx * fx + dz * fz + k.len / 2; // 0 at the foot, len at the lip
    const across = Math.abs(dx * fz - dz * fx);
    if (along < 0 || along > k.len || across > k.width / 2) continue;
    return k.h * (along / k.len) ** 1.3;
  }
  return 0;
}

/** For drawing: the ground under a kicker without the kicker. */
export const kickerAt = kickerLift;

// ---------------------------------------------------------------------------------------------
// Walls

/** A rail's height above the road (m), and the median's. */
export const RAIL_H = 0.8;

function buildWalls(w: World) {
  const segs: number[] = [];
  const add = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => segs.push(ax, az, bx, bz, y0, y1);
  const runs: RailRun[] = [];
  for (const rd of w.roads) {
    const n = rd.i1 - rd.i0;
    const off = rd.half + SHOULDER + 0.6;
    const last = rd.closed ? n : n - 1;
    for (const side of [-1, 1, 0]) {
      if (side === 0 && rd.def.kind !== 'highway') continue;
      let run: RailRun | null = null;
      for (let k = 0; k <= last; k += 2) {
        const i = rd.i0 + (k % n);
        const deck = w.deck[i];
        const want = side === 0 || ((rd.rails || deck) && !railGap(w, rd, i, side, off));
        const kind: RailRun['kind'] = side === 0 ? 'median' : deck ? 'parapet' : 'rail';
        if (!want || (run && run.kind !== kind)) {
          // A parapet hands over to a rail (or back) at the same point, so there's no gap.
          if (run && want) run.pts.push(w.x[i] - w.tz[i] * side * off, w.y[i] - w.bank[i] * side * off, w.z[i] + w.tx[i] * side * off);
          if (run && run.pts.length >= 6) runs.push(run);
          run = null;
          if (!want) continue;
        }
        run ??= { kind, pts: [], side };
        const d = side * off;
        run.pts.push(w.x[i] - w.tz[i] * d, w.y[i] - w.bank[i] * d, w.z[i] + w.tx[i] * d);
      }
      if (run && run.pts.length >= 6) runs.push(run);
    }
  }
  w.railRuns = runs;
  for (const r of runs)
    for (let k = 0; k + 5 < r.pts.length; k += 3) {
      const p = r.pts;
      add(p[k], p[k + 2], p[k + 3], p[k + 5], Math.min(p[k + 1], p[k + 4]) - 1.2, Math.max(p[k + 1], p[k + 4]) + RAIL_H + 0.4);
    }
  // Buildings: four walls each.
  for (const b of w.buildings) {
    const x0 = b.x - b.hx;
    const x1 = b.x + b.hx;
    const z0 = b.z - b.hz;
    const z1 = b.z + b.hz;
    const y0 = b.y - 2;
    const y1 = b.y + b.h;
    add(x0, z0, x1, z0, y0, y1);
    add(x1, z0, x1, z1, y0, y1);
    add(x1, z1, x0, z1, y0, y1);
    add(x0, z1, x0, z0, y0, y1);
  }
  w.walls = Float32Array.from(segs);
  const lists = new Map<number, number[]>();
  for (let s = 0; s < w.walls.length / 6; s++) {
    const o = s * 6;
    const pad = 4;
    const c0 = Math.floor((Math.min(w.walls[o], w.walls[o + 2]) - pad) / WALL_CELL);
    const c1 = Math.floor((Math.max(w.walls[o], w.walls[o + 2]) + pad) / WALL_CELL);
    const r0 = Math.floor((Math.min(w.walls[o + 1], w.walls[o + 3]) - pad) / WALL_CELL);
    const r1 = Math.floor((Math.max(w.walls[o + 1], w.walls[o + 3]) + pad) / WALL_CELL);
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) {
        const k = cellKey(c, r);
        let l = lists.get(k);
        if (!l) lists.set(k, (l = []));
        l.push(s);
      }
  }
  w.wallGrid = new Map([...lists].map(([k, l]) => [k, Int32Array.from(l)]));
}

/** Leave the rail out here: another road meets this one (its surface reaches the rail's line at about this height). */
function railGap(w: World, rd: Road, i: number, side: number, off: number): boolean {
  const px = w.x[i] - w.tz[i] * side * off;
  const pz = w.z[i] + w.tx[i] * side * off;
  const list = w.grid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL)));
  if (!list) return false;
  const me = w.road[i];
  for (const j of list) {
    const o = w.road[j];
    if (o === me || w.deck[j] !== w.deck[i]) continue;
    const other = w.roads[o];
    if (Math.abs(w.y[j] - w.y[i]) > 3) continue;
    const d = Math.hypot(w.x[j] - px, w.z[j] - pz);
    if (d < other.half + 6) return true;
  }
  void rd;
  return false;
}

/** The walls near (x, z): indexes into `w.walls` (6 numbers each: ax, az, bx, bz, bottom, top). */
export function wallsNear(w: World, x: number, z: number): Int32Array | undefined {
  return w.wallGrid.get(cellKey(Math.floor(x / WALL_CELL), Math.floor(z / WALL_CELL)));
}

// ---------------------------------------------------------------------------------------------
// The city's buildings

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blocks between the avenues and streets, filled with buildings set back from the kerb. */
function buildings(w: World): Building[] {
  const out: Building[] = [];
  const r = rng(WORLD.seed * 13);
  const xs = [CITY.x0, ...CITY.avenues, CITY.x1];
  const zs = [CITY.z0, ...CITY.streets, CITY.z1];
  const kerb = 13; // from a street's centre to a building's face
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const bx0 = xs[i] + kerb;
      const bx1 = xs[i + 1] - kerb;
      const bz0 = zs[j] + kerb;
      const bz1 = zs[j + 1] - kerb;
      // Downtown (the middle blocks) grows tall; the edges stay low.
      const cx = (bx0 + bx1) / 2;
      const cz = (bz0 + bz1) / 2;
      const core = 1 - Math.min(1, Math.hypot((cx - 1175) / 520, (cz - 1100) / 420));
      // Lots: split the block into 2-3 along x and 2 along z, each with a building and a gap.
      const nxl = bx1 - bx0 > 150 ? 3 : 2;
      const nzl = 2;
      for (let a = 0; a < nxl; a++)
        for (let b = 0; b < nzl; b++) {
          const lx0 = bx0 + ((bx1 - bx0) * a) / nxl;
          const lx1 = bx0 + ((bx1 - bx0) * (a + 1)) / nxl;
          const lz0 = bz0 + ((bz1 - bz0) * b) / nzl;
          const lz1 = bz0 + ((bz1 - bz0) * (b + 1)) / nzl;
          if (r() < 0.12) continue; // a plaza or a car park
          const gap = 4 + r() * 6;
          const hx = (lx1 - lx0) / 2 - gap / 2;
          const hz = (lz1 - lz0) / 2 - gap / 2;
          const tall = core > 0.35 && r() < 0.35 + core * 0.6;
          const h = tall ? 40 + r() * (60 + core * 90) : 9 + r() * 18;
          const kind = tall ? (r() < 0.75 ? 0 : 3) : r() < 0.5 ? 1 : 2;
          const x = (lx0 + lx1) / 2;
          const z = (lz0 + lz1) / 2;
          out.push({ x, z, hx: tall ? hx * 0.82 : hx, hz: tall ? hz * 0.82 : hz, h, y: WORLD.cityY - 0.2, kind, seed: Math.floor(r() * 1e6) });
        }
    }
  void w;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Spawns, speed traps, traffic

function spawns(w: World): Spawn[] {
  const out: Spawn[] = [];
  // The harbour meet: two rows of four, noses toward the city.
  for (let k = 0; k < 8; k++) out.push({ name: 'Harbour meet', x: 1110 + (k % 4) * 30, z: 1585 + Math.floor(k / 4) * 22, yaw: Math.PI / 2 });
  const lk = w.byId.get('lookout')!;
  const m = (lk.i0 + lk.i1) >> 1;
  out.push({ name: 'Summit lookout', x: w.x[m], z: w.z[m], yaw: Math.atan2(-w.tx[m], -w.tz[m]) });
  out.push({ name: 'Old Airfield', x: RUNWAY.x1 - 120, z: RUNWAY.z, yaw: Math.PI / 2 });
  return out;
}

function traps(w: World): Trap[] {
  const at = (id: string, f: number, name: string): Trap => {
    const rd = w.byId.get(id)!;
    const i = rd.i0 + Math.floor((rd.i1 - rd.i0) * f);
    return { name, x: w.x[i], z: w.z[i], tx: w.tx[i], tz: w.tz[i], half: rd.half + 2 };
  };
  const hw = w.byId.get('hw')!;
  // The middle of the Bayshore straight: the sample nearest (2340, -500).
  let bi = hw.i0;
  let bd = Infinity;
  for (let i = hw.i0; i < hw.i1; i++) {
    const d = (w.x[i] - 2340) ** 2 + (w.z[i] + 500) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return [{ name: 'Bayshore straight', x: w.x[bi], z: w.z[bi], tx: w.tx[bi], tz: w.tz[bi], half: hw.half + 2 }, at('runway', 0.55, 'Old Airfield')];
}

/** A lane of road `id` at offset `d` (+ = right of the road's direction), driven forward (dir 1) or back (-1). */
function lanePath(w: World, id: string, d: number, dir: 1 | -1, from?: number, to?: number) {
  const rd = w.byId.get(id)!;
  const n = rd.i1 - rd.i0;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const a = from ?? 0;
  const b = to ?? (rd.closed ? n : n - 1);
  const count = rd.closed && from === undefined ? n : Math.abs(b - a) + 1;
  for (let k = 0; k < count; k++) {
    const j = rd.closed ? (((a + dir * k) % n) + n) % n : a + dir * k;
    const i = rd.i0 + j;
    xs.push(w.x[i] - w.tz[i] * d);
    ys.push(w.y[i] - w.bank[i] * d);
    zs.push(w.z[i] + w.tx[i] * d);
  }
  return { xs, ys, zs };
}

/** Index along road `id` nearest (x, z). */
function nearestOn(w: World, id: string, x: number, z: number): number {
  const rd = w.byId.get(id)!;
  let bi = 0;
  let bd = Infinity;
  for (let i = rd.i0; i < rd.i1; i++) {
    const d = (w.x[i] - x) ** 2 + (w.z[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      bi = i - rd.i0;
    }
  }
  return bi;
}

function makeRoute(name: string, xs: number[], ys: number[], zs: number[], v: number, gapMin: number, gapMax: number, seed: number): Route {
  // Resample the closed polyline evenly.
  const n0 = xs.length;
  let len = 0;
  const seg: number[] = [];
  for (let i = 0; i < n0; i++) {
    const j = (i + 1) % n0;
    const l = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]);
    seg.push(l);
    len += l;
  }
  const m = Math.max(4, Math.round(len / SAMPLE));
  const x = new Float64Array(m);
  const y = new Float64Array(m);
  const z = new Float64Array(m);
  let i = 0;
  let acc = 0;
  for (let k = 0; k < m; k++) {
    const s = (k * len) / m;
    while (acc + seg[i] < s && i < n0 - 1) acc += seg[i++];
    const f = seg[i] > 0 ? (s - acc) / seg[i] : 0;
    const j = (i + 1) % n0;
    x[k] = xs[i] + (xs[j] - xs[i]) * f;
    y[k] = ys[i] + (ys[j] - ys[i]) * f;
    z[k] = zs[i] + (zs[j] - zs[i]) * f;
  }
  const tx = new Float64Array(m);
  const tz = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const a = (k - 1 + m) % m;
    const b = (k + 1) % m;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[k] = dx / l;
    tz[k] = dz / l;
  }
  const r = rng(seed);
  const cars: Route['cars'] = [];
  for (let s = r() * gapMin; s < len - gapMin; s += gapMin + r() * (gapMax - gapMin)) cars.push({ s0: s, paint: Math.floor(r() * 1000) });
  return { name, x, y, z, tx, tz, length: len, v, cars };
}

/** Traffic keeps left (as in Japan): on a road's direction of travel its cars use the left lanes (negative offsets). */
function routes(w: World): Route[] {
  const out: Route[] = [];
  // The expressway: three lanes each way, slow outside, quick by the median.
  const hwLanes: [number, number][] = [
    [2.65, 31],
    [6.35, 26],
    [10.05, 21],
  ];
  hwLanes.forEach(([d, v], k) => {
    const f = lanePath(w, 'hw', -d, 1);
    out.push(makeRoute(`hw+${k}`, f.xs, f.ys, f.zs, v, 70, 190, WORLD.seed + k * 7));
    const b = lanePath(w, 'hw', d, -1);
    out.push(makeRoute(`hw-${k}`, b.xs, b.ys, b.zs, v - 1, 70, 190, WORLD.seed + k * 7 + 3));
  });
  // The boulevard round the city: two lanes each way.
  (
    [
      [1.9, 13],
      [5.4, 10.5],
    ] as [number, number][]
  ).forEach(([d, v], k) => {
    const f = lanePath(w, 'ring', -d, 1);
    out.push(makeRoute(`ring+${k}`, f.xs, f.ys, f.zs, v, 45, 120, WORLD.seed + 50 + k));
    const b = lanePath(w, 'ring', d, -1);
    out.push(makeRoute(`ring-${k}`, b.xs, b.ys, b.zs, v, 45, 120, WORLD.seed + 60 + k));
  });
  // Up the pass, once round the summit, back down, and round again by the city: one loop.
  {
    const pass = w.byId.get('pass')!;
    const pn = pass.i1 - pass.i0;
    const sm = w.byId.get('summit')!;
    const sn = sm.i1 - sm.i0;
    const top = nearestOn(w, 'summit', w.x[pass.i1 - 1], w.z[pass.i1 - 1]);
    const lane = 2;
    const up = lanePath(w, 'pass', -lane, 1, 14, pn - 6);
    // Round the summit loop the way that keeps left: the loop's own direction, at its left lane.
    const loop = lanePath(w, 'summit', -lane, 1, top, top + sn);
    const down = lanePath(w, 'pass', lane, -1, pn - 6, 14);
    out.push(makeRoute('pass', [...up.xs, ...loop.xs, ...down.xs], [...up.ys, ...loop.ys, ...down.ys], [...up.zs, ...loop.zs, ...down.zs], 12, 120, 300, WORLD.seed + 90));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// As a Track

/** The world as a Track, so the race code (cars, camera, HUD) can run on it: ground queries go to the world. */
export function worldTrack(def: TrackDef): Track {
  const w = getWorld(def);
  const hooks: WorldHooks = {
    world: w,
    height: (x, z, hint, onRoad) => worldHeight(w, x, z, hint, onRoad),
    ground: (x, z, out, hint) => worldGround(w, x, z, out, hint),
    locate: (x, z, hint, out) => worldLocate(w, x, z, hint, out),
  };
  const s = new Float64Array(w.n);
  for (let i = 0; i < w.n; i++) s[i] = i * SAMPLE;
  const zero = new Float64Array(w.n);
  return {
    def,
    n: w.n,
    x: w.x,
    y: w.y,
    z: w.z,
    tx: w.tx,
    tz: w.tz,
    s,
    curv: w.curv,
    bank: w.bank,
    length: w.n * SAMPLE,
    startS: 0,
    // Never reached: free roam has no finish.
    finishS: Infinity,
    lap: 0,
    half: 4,
    shoulder: SHOULDER,
    rail: 4 + SHOULDER + VERGE,
    edge: 4 + SHOULDER + VERGE + EDGE_PAD,
    runL: zero,
    runR: zero,
    edgeMax: 40,
    grid: new Map(),
    coarse: { x0: 0, z0: 0, nx: 2, nz: 2, base: new Float32Array(4), dist: new Float32Array(4).fill(1e4) },
    spans: [],
    crests: [],
    bumps: [],
    gaps: [],
    hole: new Float32Array(w.n),
    rivers: [],
    gravel: new Uint8Array(w.n),
    cuts: [],
    props: [],
    boosts: [],
    cross: null,
    bounds: { x0: -3200, x1: 3200, z0: -2700, z1: 2400 },
    world: hooks,
  };
}

/** Where a car goes back to the road: the nearest road sample to (x, z) on the ground layer, facing along it. */
export function respawnAt(w: World, x: number, z: number, yaw: number): { x: number; y: number; z: number; yaw: number; i: number } {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < w.n; i++) {
    if (w.deck[i]) continue;
    const kind = w.roads[w.road[i]].def.kind;
    if (kind === 'lot') continue;
    const d = (w.x[i] - x) ** 2 + (w.z[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  const rd = w.roads[w.road[bi]];
  // Face whichever way along the road is nearer the car's heading, and stay on the left (keep-left) side.
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dir = fx * w.tx[bi] + fz * w.tz[bi] >= 0 ? 1 : -1;
  const lane = rd.def.kind === 'highway' ? 6.35 : rd.def.kind === 'runway' ? 0 : Math.min(2, rd.half / 2);
  const d = -dir * lane;
  const px = w.x[bi] - w.tz[bi] * d;
  const pz = w.z[bi] + w.tx[bi] * d;
  return { x: px, y: worldHeight(w, px, pz, bi), z: pz, yaw: Math.atan2(-w.tx[bi] * dir, -w.tz[bi] * dir), i: bi };
}

/** Another road's surface (not road `road`'s) covers (x, z) at about height y: for leaving lines and rails out at junctions. */
export function coveredBy(w: World, x: number, z: number, y: number, road: number, margin = 0.5): boolean {
  const list = w.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return false;
  for (const j of list) {
    const o = w.road[j];
    if (o === road || Math.abs(w.y[j] - y) > 3) continue;
    const r = w.roads[o];
    if ((w.x[j] - x) ** 2 + (w.z[j] - z) ** 2 < (r.half + margin + 1) ** 2) return true;
  }
  return false;
}

/** Distance from (x, z) to the nearest road's centreline, if it's within `max` of the road's edge (else Infinity). */
export function roadGap(w: World, x: number, z: number): number {
  const list = w.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return Infinity;
  let best = Infinity;
  for (const j of list) {
    const r = w.roads[w.road[j]];
    const d = Math.sqrt((w.x[j] - x) ** 2 + (w.z[j] - z) ** 2) - r.edge;
    if (d < best) best = d;
  }
  return best;
}

/** Grid slot `k` in free roam: everyone starts side by side at the harbour meet. */
export function worldSlot(w: World, k: number): { x: number; y: number; z: number; yaw: number; s: number } {
  const meet = w.spawns.filter((p) => p.name === w.spawns[0].name);
  const p = meet[k % meet.length];
  const loc = worldLocate(w, p.x, p.z, -1, { i: 0, s: 0, d: 0, cx: 0, cy: 0, cz: 0, tx: 0, tz: -1 });
  return { x: p.x, y: worldHeight(w, p.x, p.z, loc.i), z: p.z, yaw: p.yaw, s: loc.i * SAMPLE };
}

/** The speed trap a car crossed going from (x0, z0) to (x1, z1) this tick, if any. */
export function trapCrossed(w: World, x0: number, z0: number, x1: number, z1: number): Trap | null {
  for (const t of w.traps) {
    const a = (x0 - t.x) * t.tx + (z0 - t.z) * t.tz;
    const b = (x1 - t.x) * t.tx + (z1 - t.z) * t.tz;
    if (a * b > 0 || a === b) continue;
    const across = Math.abs(-(x1 - t.x) * t.tz + (z1 - t.z) * t.tx);
    if (across <= t.half) return t;
  }
  return null;
}
