import { type BoostPad, placeBoosts } from './boost.ts';
import { type Prop, placeProps } from './props.ts';
import { type World, worldSlot, worldTrack } from './world.ts';

// Race tracks: a point-to-point road down a mountain (or a closed circuit raced for laps), built from a
// handful of control points, plus the ground under it. Shared and deterministic: the car physics, the AI, the
// renderer and the tests all ask the same functions where the ground is, so what you see is what you drive on.
//
// The road is a centreline sampled every SAMPLE metres. Across it the surface is a plane (with a little
// banking in corners) out to the barriers; past them it eases into procedural hills over BLEND metres.
//
// A circuit is unrolled: its samples repeat once per lap (with a run-up before the line and a runoff after the
// last lap), so `s` is the distance raced and everything that reads the road ahead or compares `s` with the
// finish works unchanged. Only one lap's samples go in the spatial hash, and the renderer draws one lap
// (lapView).

export type Theme = 'alpine' | 'coast' | 'desert' | 'night' | 'autumn' | 'spring' | 'city';
export type TrackId = 'koripass' | 'saltwind' | 'redmesa' | 'tsukiyo' | 'momiji' | 'sakura' | 'monza' | 'spa' | 'monaco' | 'neonbay' | 'kodama' | 'karasu' | 'hachi' | 'nagare' | 'minato' | 'akane' | 'kazeoka' | 'ryusei' | 'hayate' | 'seatosky' | 'shiden' | 'isonami' | 'mizuumi' | 'hibari' | 'kamome' | 'shiokaze' | 'taketomi' | 'hallstatt' | 'goreme' | 'oia' | 'chefchaouen' | 'toge' | 'kumo' | 'shura';
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
  | { kind: 'cut'; s0: number; s1: number }
  /**
   * Broken, heaved tarmac between two control points: a run of bumps up to `size` metres high, a few car
   * lengths apart and never evenly spaced, that unsettle the car and lift it light over the crests.
   */
  | { kind: 'bumps'; from: number; to: number; size: number };

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
  /** Control points [x, y, z] the road threads through, start line to finish line (once round a circuit). */
  points: [number, number, number][];
  /** A closed circuit raced this many laps (at least 2). Circuits have no features and no props. */
  laps?: number;
  /** Asphalt width (m). */
  width: number;
  /** How tall the far hills get (m). */
  relief: number;
  /** Far terrain leans this way (rise per metre away from the road), e.g. coast hills falling to the sea. */
  tilt?: [number, number];
  /** Height of the sea or lake, if there is one (ground below it is under water). */
  water?: number;
  /** Four lanes of traffic to dodge (traffic.ts): two each way in town, or all four going your way on a `highway`. */
  traffic?: boolean | 'highway';
  /**
   * One-way lanes painted on the road, with a dashed line between each: a `'highway'` has 4 unless it says otherwise.
   * Six spread evenly across the whole asphalt.
   */
  lanes?: 4 | 6;
  /**
   * Walls right at the asphalt's edge, like a street circuit: no shoulder, no verge, no runoff, so the outer lanes
   * run along the barrier.
   */
  walled?: boolean;
  /**
   * A hill climb (the lobby's Hill climb mode): an uphill run with no bales, barrels or cones; boulders and
   * rocks lie on the road's edges instead (props.ts), and the forest crowds right up to the barrier.
   */
  climb?: boolean;
  /**
   * Clean road for time trials: no obstacles (like a circuit), so a run is only you, the
   * line and the clock.
   */
  clean?: boolean;
  /**
   * A figure 8 (circuits only): the lap crosses itself once, and the first pass through the crossing goes over
   * the second on a bridge this many metres up (the leg underneath dips OVERPASS.dip into a cutting). The ground
   * then has two layers there, so ask heightAt / groundAt with the car's `hint` (see Crossing).
   */
  overpass?: number;
  /**
   * A sky road (circuits only): the road floats high above the clouds with no barriers, no verge and no ground. Off
   * its edge there's nothing: the car drops, and SKY.fall metres under the road it's put back on the middle of the
   * road where it went off, stopped (vehicle.ts `catchFall`).
   */
  sky?: true;
  /**
   * A battle royale arena (circuits only): only the Battle royale mode races it (protocol.ts `modeTracks`), and it keeps
   * out of the other modes' lists, the solo track list and the cups. Its `laps` are the most eliminations a full grid
   * needs (RACE.maxPlayers - 1): the race ends when one car is left (royale.ts).
   */
  royale?: true;
  /**
   * The open world (world.ts): not a race track but an island of roads to drive round freely (the lobby's Free
   * roam mode). `points` only frame its menu map; the roads are world.ts's.
   */
  world?: true;
  features?: Feature[];
}

/**
 * The open world's ground, for a Track built from it (world.ts `worldTrack`): heightAt, groundAt and locate hand
 * over to these, and vehicle.ts asks `world` for walls.
 */
export interface WorldHooks {
  world: World;
  height(x: number, z: number, hint: number, onRoad?: Loc): number;
  ground(x: number, z: number, out: Ground, hint: number): Ground;
  locate(x: number, z: number, hint: number, out: Loc): Loc;
}

/** A figure 8's crossing: how long the bridge deck is and how the road rises to it (m). */
export const OVERPASS = {
  /** The deck reaches this far along the upper road either side of the crossing; past it the road is on an embankment. */
  deck: 48,
  /** The upper road rises (and the lower dips) over this far either side of the crossing. */
  ramp: 125,
  rampUnder: 75,
  dip: 1.5,
  /** Cars this far along the upper road from the crossing drive on the deck's layer of the ground. */
  over: 80,
  /** ...where the lower road this far either side of the crossing doesn't exist. */
  under: 60,
};

/**
 * Where a figure 8 crosses itself. Near it the ground has two layers: the upper road on its bridge deck, and
 * the world underneath (the lower road, the hills). Every sample is flagged by which stretch it belongs to,
 * and a ground query picks its layer by the car's hint: a car on the upper road near the crossing (`up`)
 * sees a world without the lower road there (`low`); anyone else (the terrain mesh, the lower road, any
 * query without a hint) sees a world without the deck (`deck`).
 */
export interface Crossing {
  x: number;
  z: number;
  /** 1 on the samples of the bridge deck. */
  deck: Uint8Array;
  /** 1 on the samples of the upper road near the crossing (wider than the deck), where the deck's layer applies. */
  up: Uint8Array;
  /** 1 on the samples of the lower road near the crossing. */
  low: Uint8Array;
  /** The deck on the lap the renderer draws: samples i0..i1. */
  i0: number;
  i1: number;
  /** A sample on the deck (a hint that puts a query on the upper layer). */
  over: number;
}

export const SAMPLE = 2; // metres between centreline samples
const PRE = 90; // straight run-up before the start line (the grid sits here)
const RUNOFF = 240; // straight after the finish line to brake in
const LAP_PRE = 150; // a circuit's grid: this much of the lap before the line
export const SHOULDER = 2.5; // paved strip outside the white lines
export const VERGE = 3; // grass between the shoulder and the barrier
/** A `walled` road's barrier stands this far outside the white line. */
export const WALL_GAP = 0.3;
/**
 * A `sky` road: a paved lip of `lip` m outside the white lines is the last of it. Past that the ground is `abyss` m
 * under the lowest of the road, and a car that falls `fall` m below the road is put back on it.
 */
export const SKY = { lip: 1.2, abyss: 600, fall: 9 };
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
  /** Samples per lap on a circuit (sample i + lap is the same place as sample i); 0 on a point-to-point road. */
  lap: number;
  half: number; // half the asphalt width
  /** Paved strip outside the white lines: SHOULDER, or none on a `walled` road. */
  shoulder: number;
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
  /** Stretches of bumpy road (from `bumps` features), where the grade jumps about on purpose. */
  bumps: { s0: number; s1: number }[];
  /** 1 where the road is gravel. */
  gravel: Uint8Array;
  cuts: Cut[];
  /** Obstacles (sorted by s). */
  props: Prop[];
  /** Rainbow boost pads (boost.ts), sorted by s. */
  boosts: BoostPad[];
  /** A figure 8's crossing, or null. */
  cross: Crossing | null;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** The open world (free roam): its ground replaces this track's. */
  world?: WorldHooks;
  /** A `sky` road: the height of the nothing off its edge (SKY.abyss under the lowest of the road). */
  abyss?: number;
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
  // Built for grinding time trials: a gentle, wide-open pass with few corners, each with a line worth finding.
  nagare: {
    id: 'nagare',
    name: 'Nagare Pass',
    tag: 'Time trial · 8 corners · gentle descent · clean road',
    blurb: 'A gentle run off the high pasture with nothing on the road but you and the line: a flat-out sweeper, an esse you can straighten, a double-apex left, a corner that tightens, one hairpin and a long sweeper to the line.',
    theme: 'alpine',
    seed: 311,
    width: 13,
    relief: 200,
    clean: true,
    points: [
      [0, 300.0, 0], [0.0, 298.4, -80.0], [0.0, 296.8, -160.0], [0.0, 295.2, -240.0], [0.0, 294.0, -300.0],
      [1.2, 293.6, -322.0], [4.4, 293.1, -343.7], [9.7, 292.7, -365.0], [17.1, 292.2, -385.8], [26.4, 291.5, -405.7],
      [37.5, 290.5, -424.7], [50.4, 289.4, -442.5], [65.0, 288.4, -458.9], [81.1, 287.3, -473.9], [142.4, 283.5, -525.3],
      [203.7, 279.6, -576.8], [220.5, 278.6, -590.9], [235.8, 277.5, -606.7], [247.9, 276.4, -625.0], [256.4, 275.4, -645.3],
      [261.0, 274.3, -666.8], [266.6, 273.3, -688.0], [276.1, 272.2, -707.8], [289.1, 271.2, -725.5], [302.1, 270.3, -738.0],
      [363.3, 267.4, -789.4], [424.6, 265.8, -840.8], [485.9, 264.2, -892.3], [501.2, 263.8, -905.1], [515.9, 263.3, -921.5],
      [525.7, 262.9, -941.0], [530.2, 262.4, -962.5], [529.0, 262.0, -984.4], [522.2, 261.6, -1005.3], [503.6, 260.7, -1045.1],
      [491.4, 260.2, -1063.4], [474.7, 259.5, -1077.6], [454.7, 258.3, -1086.6], [433.0, 257.1, -1089.7], [411.3, 255.9, -1086.8],
      [334.0, 251.7, -1066.1], [256.7, 247.4, -1045.4], [179.4, 243.1, -1024.7], [121.5, 239.9, -1009.1], [99.9, 238.8, -1005.0],
      [77.9, 237.6, -1003.7], [56.0, 236.4, -1005.3], [34.5, 235.6, -1009.8], [13.9, 234.9, -1017.4], [-3.7, 234.2, -1030.5],
      [-16.2, 233.5, -1048.5], [-22.3, 232.8, -1069.5], [-33.5, 230.3, -1148.7], [-44.6, 227.8, -1227.9], [-53.0, 226.0, -1287.4],
      [-56.8, 225.3, -1309.0], [-62.2, 224.6, -1330.3], [-69.0, 223.9, -1351.3], [-77.2, 223.2, -1371.7], [-86.8, 222.6, -1391.4],
      [-97.8, 221.8, -1410.5], [-140.2, 217.8, -1478.4], [-182.6, 213.8, -1546.2], [-220.7, 210.2, -1607.3], [-236.1, 209.1, -1622.8],
      [-256.4, 208.0, -1631.0], [-278.2, 206.9, -1630.5], [-298.1, 205.8, -1621.5], [-309.4, 205.0, -1610.3], [-358.7, 201.4, -1547.2],
      [-407.9, 198.8, -1484.2], [-432.6, 197.6, -1452.7], [-446.9, 196.9, -1436.0], [-462.6, 196.2, -1420.6], [-479.6, 195.5, -1406.6],
      [-497.7, 194.8, -1394.1], [-516.7, 194.1, -1383.2], [-536.7, 193.4, -1373.9], [-557.4, 192.7, -1366.4], [-578.6, 192.0, -1360.6],
      [-656.8, 189.8, -1344.0], [-735.1, 189.0, -1327.4], [-813.3, 188.2, -1310.7]
    ],
  },
  // Circuits after famous Grand Prix tracks, scaled to fit: closed loops raced for laps.
  monza: {
    id: 'monza',
    name: 'Monza',
    tag: 'Temple of speed · 3 laps · chicanes',
    blurb: 'An Italian parkland circuit in autumn: flat-out straights broken by the first-corner chicane, Curva Grande, the Lesmos, Ascari and the long Parabolica onto the line.',
    theme: 'autumn',
    seed: 61,
    width: 12,
    relief: 40,
    laps: 3,
    points: [
      [0, 160, 0], [0, 160, -148.8], [0, 161, -272.8], [6.2, 161, -296.4], [26, 161, -303.8], [32.2, 161, -323.6],
      [34.1, 162, -359.6], [40.3, 162, -409.2], [58.9, 163, -471.2], [108.5, 164, -514.6], [170.5, 165, -533.2],
      [198.4, 165, -540.6], [210.8, 165, -554.9], [228.2, 165, -551.8], [238.7, 165, -534.4], [266.6, 166, -523.9],
      [291.4, 166, -496], [303.8, 165, -452.6], [297.6, 164, -409.2], [279, 163, -365.8], [257.3, 162, -291.4],
      [244.9, 161, -223.2], [260.4, 161, -197.2], [248, 161, -172.4], [230.6, 160, -155], [228.2, 160, -127.1],
      [232.5, 159, 0], [229.4, 158, 111.6], [217, 158, 167.4], [179.8, 158, 207.7], [124, 158, 217],
      [68.2, 159, 192.2], [24.8, 159, 136.4], [5, 160, 68.2],
    ],
  },
  spa: {
    id: 'spa',
    name: 'Spa',
    tag: 'Ardennes · 2 laps · Eau Rouge',
    blurb: 'A long lap through the forest: La Source hairpin, down into Eau Rouge and up Raidillon, the Kemmel straight, Pouhon, Blanchimont and the Bus Stop chicane.',
    theme: 'alpine',
    seed: 73,
    width: 12,
    relief: 160,
    laps: 2,
    points: [
      [0, 100, 0], [0, 101, -90], [15, 102, -135], [55, 102, -150], [85, 101, -120], [110, 97, -40], [135, 93, 60],
      [140, 92, 110], [165, 95, 150], [175, 100, 200], [240, 105, 330], [310, 109, 470], [345, 110, 530],
      [395, 110, 560], [430, 109, 595], [438, 106, 640], [420, 102, 685], [385, 100, 705], [345, 98, 690],
      [260, 94, 720], [200, 90, 760], [180, 87, 820], [190, 85, 880], [160, 83, 920], [120, 82, 940], [60, 82, 930],
      [0, 83, 880], [-40, 87, 700], [-50, 91, 500], [-40, 95, 300], [-30, 97, 180], [-10, 98, 160], [-20, 98, 130],
      [0, 99, 80],
    ],
  },
  monaco: {
    id: 'monaco',
    name: 'Monaco',
    tag: 'Street circuit · 2 laps · hairpin',
    blurb: 'Tight and twisting round the harbour: Sainte Dévote, the climb to Casino, the slowest hairpin anywhere, the run along the sea, the pool chicanes and Rascasse.',
    theme: 'coast',
    seed: 97,
    width: 11,
    relief: 120,
    tilt: [0, -0.25],
    water: 0,
    laps: 2,
    points: [
      [0, 10, 0], [0, 11, -110], [8, 12, -150], [40, 13, -165], [150, 20, -200], [240, 28, -260], [285, 34, -320],
      [300, 38, -380], [330, 40, -410], [400, 40, -412], [460, 37, -380], [490, 34, -330], [487, 31, -268],
      [497, 30, -238], [518, 29, -228], [540, 28, -240], [550, 27, -275], [575, 24, -315], [630, 20, -328],
      [690, 16, -290], [708, 13, -200], [700, 11, -90], [698, 10, -30], [668, 9, 20], [675, 9, 80], [645, 8, 165],
      [560, 8, 195], [470, 8, 182], [445, 8, 215], [400, 8, 224], [340, 8, 224], [312, 8, 186], [270, 8, 180],
      [150, 8, 195], [55, 8, 215], [25, 8, 212], [5, 9, 185], [-5, 9, 100],
    ],
  },
  // Built for the time trial: a short, flowing lap you learn by heart and shave tenths off.
  kodama: {
    id: 'kodama',
    name: 'Kodama Ring',
    tag: 'Time trial · 3 laps · flowing',
    blurb: 'A short ring in the cherry-blossom hills, made for chasing ghosts: a climbing esse, a fast downhill sweeper into the infield hairpin, a long double-apex right and a flat-out run to the line.',
    theme: 'spring',
    seed: 149,
    width: 12,
    relief: 70,
    laps: 3,
    points: [
      [0, 60, 0], [0, 60, -95], [14, 61, -142], [52, 62, -170], [101, 64, -165], [148, 66, -181], [195, 67, -204],
      [250, 67, -201], [287, 66, -170], [298, 64, -117], [289, 62, -76], [250, 60, -61], [179, 58, -56], [129, 57, -45],
      [100, 57, -9], [117, 57, 27], [164, 58, 41], [234, 59, 47], [281, 60, 72], [290, 61, 117], [265, 62, 153],
      [203, 62, 165], [133, 61, 156], [70, 61, 167], [23, 60, 148], [3, 60, 101], [0, 60, 47],
    ],
  },
  // A figure 8 for drifting: two big sweeping loops joined by a crossing, the first pass over it on a bridge.
  hachi: {
    id: 'hachi',
    name: 'Hachi-no-ji',
    tag: 'Figure 8 · 3 laps · drift · overpass',
    blurb: 'A figure 8 on the desert flats, built for big slides: a long right-hand carousel, over the bridge, a left-hand loop that tightens at the far end, and back under the bridge you just crossed.',
    theme: 'desert',
    seed: 233,
    width: 14,
    relief: 60,
    laps: 3,
    overpass: 7.5,
    points: [
      [56.6, 100, -41.1], [89.1, 100, -64.7], [125, 100, -79.2], [163.5, 101.4, -75.2], [195.6, 103, -53.5],
      [213.7, 103.9, -19.4], [213.7, 103.9, 19.4], [195.6, 103, 53.5], [163.5, 101.4, 75.2], [125, 100, 79.2],
      [89.1, 100, 64.7], [72.9, 100, 53], [40.5, 100, 29.5], [8.2, 100, 5.9], [-24.2, 100, -17.6],
      [-56.5, 100, -41.1], [-88.9, 100, -64.6], [-98, 100, -71.2], [-126.9, 100, -85], [-159.2, 99.7, -87.5],
      [-194.2, 98.6, -78.4], [-227.3, 97.8, -58.9], [-251, 97.2, -31.5], [-259.7, 97, 0], [-251, 97.2, 31.5],
      [-227.3, 97.8, 58.9], [-194.2, 98.6, 78.4], [-159.2, 99.7, 87.5], [-126.9, 100, 85], [-98, 100, 71.2],
      [-81.8, 100, 59.4], [-49.4, 100, 35.9], [-17.1, 100, 12.4], [15.3, 100, -11.1]
    ],
  },
  // Three more grand prix circuits, our own layouts: a night street race, a desert GP and a seaside rollercoaster.
  minato: {
    id: 'minato',
    name: 'Minato Street',
    tag: 'Night street circuit · 2 laps · harbour',
    blurb: 'A floodlit street race through the harbour district after dark: right angles through the old town, a flat-out boulevard between the towers, fast sweepers round the bay and a tight hairpin onto the line.',
    theme: 'city',
    seed: 251,
    width: 11,
    relief: 60,
    tilt: [0, -0.25],
    water: 0,
    laps: 2,
    points: [
      [0, 12, 0], [0, 12, -48], [0, 12.2, -96], [0, 12.3, -144], [0, 12.5, -192], [0, 12.5, -240],
      [5, 12.6, -255.3], [18, 12.7, -264.7], [76, 14, -266], [126, 15.9, -266], [142.5, 16.6, -271.3], [152.6, 17.3, -285.3],
      [154, 19.7, -344], [154, 21.3, -394], [159.7, 21.6, -411.6], [174.7, 21.9, -422.5], [226.6, 22, -424], [269.2, 22.2, -424],
      [311.8, 22.5, -424], [354.4, 22.9, -424], [396.9, 23.5, -424], [439.5, 24, -424], [482.1, 24.5, -424], [524.7, 25.1, -424],
      [548, 25.3, -420.9], [569.7, 25.5, -411.9], [591.4, 25.7, -403], [614.7, 25.8, -399.9], [654.7, 26, -399.9], [694.7, 25.9, -399.9],
      [711.2, 25.7, -394.5], [721.3, 25.4, -380.5], [722.7, 23.6, -321.3], [722.7, 21.3, -270.7], [722.7, 18.7, -220.1], [722.7, 16.3, -169.4],
      [725.1, 15.2, -141.7], [732.4, 14.2, -114.7], [739.6, 13.5, -87.8], [742, 13.1, -60], [742, 12.8, -10], [742, 11.4, 40],
      [739.1, 10.6, 58.5], [730.5, 9.7, 75.3], [717.3, 8.7, 88.5], [700.5, 7.7, 97.1], [682, 6.7, 100], [632, 4.4, 100],
      [582, 3.1, 100], [514.7, 3, 108.9], [452, 3, 134.8], [399.8, 3, 153.8], [344.2, 3, 153.8], [292, 3, 134.8],
      [229.3, 3, 108.9], [162, 3, 100], [102, 3, 100], [84.4, 3.1, 105.7], [73.5, 3.6, 120.7], [72, 5.7, 165],
      [72, 8, 200], [69.8, 8.8, 212.3], [63.6, 9.6, 223.1], [54, 10.3, 231.2], [42.3, 10.9, 235.5], [29.7, 11.4, 235.5],
      [18, 11.7, 231.2], [8.4, 11.9, 223.1], [2.2, 12, 212.3], [0, 12, 200], [0, 12, 150], [0, 12, 100],
      [0, 12, 50],
    ],
  },
  akane: {
    id: 'akane',
    name: 'Akane Sands',
    tag: 'Desert GP · 2 laps · long straights',
    blurb: 'A grand prix circuit on the red desert: a long main straight into a heavy-braking first hairpin, a quick esse, a fast sweeper, a tight infield hairpin and a long back straight to the last corner.',
    theme: 'desert',
    seed: 263,
    width: 13,
    relief: 80,
    laps: 2,
    points: [
      [0, 100, 0], [0, 100, -46.7], [0, 100.1, -93.3], [0, 100.3, -140], [0, 100.5, -186.7], [0, 100.8, -233.3],
      [0, 101.2, -280], [0, 101.5, -326.7], [0, 101.9, -373.3], [0, 102.3, -420], [0, 102.6, -466.7], [0, 103, -513.3],
      [0, 103.3, -560], [4.7, 103.4, -572.9], [16.5, 103.4, -579.7], [39.4, 103.6, -579.2], [54.8, 103.6, -583.4], [68.4, 103.7, -591.7],
      [84.9, 103.8, -601.3], [103.7, 103.9, -604.6], [122.5, 103.9, -601.3], [162.8, 104, -586.6], [203.1, 104, -572], [243.4, 103.9, -557.3],
      [283.6, 103.8, -542.6], [323.9, 103.5, -528], [364.2, 103.2, -513.3], [404.4, 102.9, -498.7], [432.5, 102.5, -483.5], [455.1, 102.2, -461],
      [470.2, 101.8, -432.9], [486.2, 101.3, -389.1], [502.1, 100.7, -345.2], [518.1, 100.2, -301.4], [517.3, 99.9, -278.9], [501.1, 99.6, -263.3],
      [447, 99.1, -261.1], [404.2, 98.7, -261.1], [361.3, 98.4, -261.1], [318.5, 98.2, -261.1], [275.6, 98.1, -261.1], [232.7, 98, -261.1],
      [189.9, 98, -261.1], [172.9, 98.1, -254.4], [165, 98.2, -238], [170.3, 98.2, -220.5], [210.6, 98.5, -195.3], [243.8, 98.8, -176.1],
      [276.9, 99.1, -157], [288.9, 99.3, -146.9], [296.7, 99.4, -133.4], [299.4, 99.6, -118], [299.4, 100, -68], [299.4, 100.4, -18],
      [299.4, 100.7, 32], [299.4, 100.9, 82], [296.2, 101, 103], [286.8, 101, 122.1], [272.1, 101, 137.5], [253.4, 101, 147.8],
      [210.2, 100.9, 163.5], [167.1, 100.9, 179.2], [123.9, 100.8, 194.9], [80.7, 100.6, 210.6], [37.6, 100.5, 226.3], [16.6, 100.4, 225.6],
      [2, 100.4, 210.5], [0, 100.2, 150], [0, 100.1, 100], [0, 100, 50],
    ],
  },
  kazeoka: {
    id: 'kazeoka',
    name: 'Kazeoka Dunes',
    tag: 'Seaside · 2 laps · rollercoaster',
    blurb: 'A rollercoaster lap through the dunes above the sea: a hairpin at the end of the straight, climbing esses along the crest, a hairpin at the top, a plunge down to the beach and a long sweeping last corner.',
    theme: 'coast',
    seed: 277,
    width: 12,
    relief: 90,
    tilt: [0, -0.2],
    water: 6,
    laps: 2,
    points: [
      [0, 26, 0], [0, 26.5, -42.9], [0, 27.8, -85.7], [0, 29.6, -128.6], [0, 31.5, -171.4], [0, 33, -214.3],
      [0, 33.9, -257.1], [0, 34.1, -300], [-8, 34.3, -320.4], [-27.8, 34.7, -329.9], [-48.7, 35.3, -323.5], [-72.2, 36.5, -294.5],
      [-93.5, 37.5, -279.6], [-118.3, 38.7, -271.4], [-157.7, 40.6, -264.4], [-197.1, 42.6, -257.5], [-221.4, 43.8, -257.5], [-244.2, 45, -265.8],
      [-262.9, 46.1, -281.4], [-281.5, 47.1, -297], [-304.3, 48, -305.4], [-328.6, 48.7, -305.4], [-366, 49.6, -298.8], [-399.4, 49.9, -298],
      [-431.6, 50, -307.4], [-459.4, 50.2, -326], [-480.3, 50.6, -352.1], [-505.3, 51.6, -395.4], [-530.3, 52.7, -438.7], [-540, 53.1, -450],
      [-553.2, 53.4, -456.9], [-568, 53.8, -458.6], [-582.3, 54.1, -454.7], [-594.3, 54.5, -445.9], [-602.2, 54.8, -433.3], [-605, 55.1, -418.7],
      [-605, 55.7, -374.2], [-605, 56, -329.8], [-605, 55.7, -285.3], [-605, 54.5, -240.9], [-605, 52.3, -196.4], [-605, 49.4, -152],
      [-605, 45.8, -107.5], [-605, 41.9, -63], [-599.8, 37.6, -15.4], [-584.4, 33.4, 29.9], [-569, 29.7, 75.3], [-563.7, 26.8, 122.9],
      [-567.4, 25.8, 143.4], [-577.8, 25, 161.5], [-598.6, 24.1, 197.6], [-605.9, 23.9, 238.6], [-598.6, 23.4, 279.7], [-581.5, 22.1, 326.6],
      [-564.4, 20.3, 373.6], [-547.3, 18.2, 420.6], [-540.5, 17.7, 432.9], [-530.2, 17.1, 442.5], [-517.4, 16.6, 448.5], [-503.5, 16.1, 450.2],
      [-489.6, 15.7, 447.5], [-445.8, 14.5, 431.6], [-401.9, 14, 415.6], [-358.1, 14.1, 399.6], [-314.2, 14.4, 383.7], [-270.4, 15, 367.7],
      [-226.5, 15.7, 351.7], [-182.7, 16.5, 335.8], [-138.8, 17.2, 319.8], [-95, 17.7, 303.9], [-57.9, 17.9, 284.6], [-27.1, 18, 256.4],
      [-4.7, 18.7, 221.1], [0, 19.4, 200], [0, 21.5, 150], [0, 23.7, 100], [0, 25.4, 50],
    ],
  },
  // The hill climb (the lobby's Hill climb mode): uphill all the way, narrow, rough and crowded by the forest.
  karasu: {
    id: 'karasu',
    name: 'Karasu Peak',
    tag: 'Hill climb · uphill · boulders · broken tarmac',
    blurb: 'One run up the mountain where the crow-winged tengu live: a bumpy forest climb, a ladder of hairpins up the face, boulders fallen on the road, a gravel shelf above the trees and a twisting last kilometre to the summit.',
    theme: 'alpine',
    seed: 211,
    width: 9,
    relief: 360,
    climb: true,
    points: [
      [0, 100, 0], [5, 112, -140], [-40, 124, -260], [-20, 136, -380], [60, 146, -470], [200, 158, -500],
      [420, 180, -520], [480, 184, -545], [490, 186, -590], [440, 190, -620],
      [200, 212, -630], [120, 216, -625], [60, 218, -670], [120, 222, -720],
      [380, 246, -730], [520, 258, -780], [580, 270, -900], [520, 282, -1020], [580, 294, -1140],
      [560, 302, -1260], [460, 312, -1340], [320, 324, -1360], [180, 336, -1380], [40, 348, -1360],
      [-30, 352, -1400], [-20, 356, -1460], [40, 360, -1480],
      [200, 374, -1480], [340, 388, -1500], [420, 398, -1560], [420, 410, -1680], [360, 420, -1780], [380, 430, -1880], [400, 436, -1960],
    ],
    features: [
      { kind: 'bumps', from: 0, to: 4, size: 0.32 },
      { kind: 'bumps', from: 15, to: 19, size: 0.26 },
      { kind: 'crest', at: 17, size: 1.4, len: 36 },
      { kind: 'gravel', from: 19, to: 23 },
      { kind: 'bumps', from: 28, to: 32, size: 0.3 },
    ],
  },
  neonbay: {
    id: 'neonbay',
    name: 'Neon Bay',
    tag: 'City at night · live traffic · harbour sweepers',
    blurb: 'Downtown after dark on four lanes of open road, and the city is still driving on them. Block corners between the towers, a hump, then flat-out sweepers along the bay. Dodge the traffic.',
    theme: 'city',
    seed: 131,
    width: 15,
    relief: 70,
    water: 52,
    traffic: true,
    points: [
      [0, 120, 0], [0, 119, -170], [0, 118, -330], [9, 117, -361], [30, 116, -370],
      [200, 114, -370], [330, 112, -372], [351, 111, -381], [360, 110, -402],
      [360, 107, -560], [368, 105, -700], [400, 103, -790], [480, 101, -870], [620, 99, -895],
      [700, 97, -900], [721, 96, -909], [730, 95, -930],
      [730, 92, -1060], [722, 91, -1110], [690, 90, -1135],
      [450, 87, -1135], [429, 86, -1144], [420, 85, -1165],
      [420, 82, -1340], [440, 79, -1480], [530, 76, -1590], [700, 72, -1640], [860, 69, -1640], [960, 67, -1600], [1080, 65, -1600], [1200, 64, -1640],
    ],
    features: [{ kind: 'crest', at: 9, size: 1.6, len: 44 }],
  },
  ryusei: {
    id: 'ryusei',
    name: 'Ryūsei Expressway',
    tag: 'Night highway · four lanes of traffic · street racing',
    blurb: 'Midnight on the bayshore expressway: four lanes all going your way, and the city is still on them. Weave the slow trucks, split the gaps at full song and hold your nerve through the long sweepers.',
    theme: 'city',
    seed: 977,
    width: 16,
    relief: 60,
    water: 22,
    traffic: 'highway',
    points: [
      [0, 42.0, 0], [0, 42.6, -105], [0, 43.2, -210], [0, 43.8, -315], [0, 44.3, -420], [1, 44.4, -450],
      [3, 44.6, -480], [7, 44.7, -510], [12, 44.8, -539], [19, 44.9, -568], [27, 45.0, -597], [37, 45.1, -626],
      [48, 45.2, -653], [61, 45.3, -681], [75, 45.4, -707], [90, 45.5, -733], [107, 45.5, -758], [175, 45.7, -856],
      [244, 45.7, -955], [313, 45.6, -1053], [382, 45.3, -1151], [399, 45.2, -1177], [414, 45.1, -1203],
      [428, 45.0, -1231], [440, 44.8, -1259], [450, 44.7, -1288], [459, 44.5, -1317], [466, 44.4, -1347],
      [472, 44.2, -1377], [475, 44.0, -1408], [477, 43.9, -1438], [477, 43.7, -1469], [475, 43.5, -1500],
      [472, 43.3, -1530], [466, 43.0, -1560], [459, 42.8, -1590], [432, 42.0, -1693], [404, 41.1, -1796],
      [376, 40.1, -1899], [369, 39.8, -1930], [364, 39.5, -1961], [361, 39.2, -1992], [360, 38.9, -2023],
      [361, 38.5, -2055], [364, 38.2, -2086], [369, 37.9, -2117], [374, 37.6, -2148], [377, 37.3, -2180],
      [378, 37.0, -2211], [377, 36.6, -2242], [374, 36.3, -2274], [368, 36.0, -2305], [361, 35.7, -2335],
      [328, 34.4, -2459], [295, 33.2, -2583], [262, 32.1, -2706], [229, 31.1, -2830], [196, 30.2, -2953],
      [189, 30.0, -2983], [183, 29.9, -3012], [179, 29.7, -3042], [177, 29.5, -3072], [176, 29.4, -3102],
      [177, 29.2, -3132], [179, 29.1, -3162], [183, 29.0, -3191], [189, 28.9, -3221], [196, 28.8, -3250],
      [204, 28.7, -3279], [214, 28.6, -3307], [226, 28.5, -3335], [239, 28.5, -3362], [307, 28.3, -3496],
      [375, 28.4, -3629], [387, 28.4, -3655], [399, 28.4, -3682], [409, 28.5, -3710], [417, 28.6, -3737],
      [425, 28.6, -3765], [431, 28.7, -3794], [436, 28.8, -3823], [439, 28.9, -3851], [441, 29.0, -3880],
      [441, 29.1, -3910], [441, 29.2, -3939], [435, 29.7, -4051], [429, 30.2, -4162], [423, 30.8, -4274],
      [417, 31.5, -4386], [411, 32.1, -4498],
    ],
  },
  hayate: {
    id: 'hayate',
    name: 'Hayate Flats',
    tag: 'Desert speedway · four lanes of traffic · no turn past 30°',
    blurb: 'A road as wide as a runway across the salt flats, nothing on it sharper than 30°, and four lanes of traffic heading your way. Flat out the whole way if you dare: the kinks come at over 250 km/h, and only the clean line through the gaps keeps your foot down.',
    theme: 'desert',
    seed: 2203,
    width: 22,
    relief: 120,
    clean: true,
    traffic: 'highway',
    points: [
      [0, 211.7, 0], [0, 211.8, -130], [0, 209.2, -260], [0, 208.3, -390], [0, 209.4, -520], [1, 209.4, -550],
      [4, 209.3, -580], [9, 208.8, -609], [17, 208.2, -638], [26, 207.2, -667], [70, 201.4, -789], [115, 196.7, -911],
      [123, 196.2, -938], [128, 195.8, -966], [131, 195.6, -993], [130, 195.4, -1021], [127, 195.2, -1049],
      [101, 192.6, -1197], [97, 191.6, -1225], [97, 190.6, -1253], [99, 189.5, -1281], [105, 188.4, -1308],
      [113, 187.3, -1335], [155, 184.6, -1451], [198, 185.9, -1568], [240, 187.9, -1684], [283, 187.0, -1801],
      [325, 185.1, -1918], [334, 185.0, -1945], [341, 185.0, -1972], [347, 185.2, -2000], [350, 185.5, -2029],
      [352, 186.0, -2057], [352, 186.5, -2086], [351, 187.1, -2114], [338, 187.8, -2264], [325, 183.0, -2413],
      [321, 181.8, -2443], [313, 180.7, -2472], [303, 179.7, -2500], [290, 178.9, -2527], [274, 178.3, -2553],
      [208, 177.2, -2647], [142, 175.7, -2741], [76, 171.4, -2835], [10, 166.1, -2929], [-8, 165.0, -2957],
      [-23, 164.1, -2987], [-36, 163.5, -3018], [-49, 163.3, -3049], [-64, 163.4, -3078], [-82, 163.6, -3106],
      [-142, 164.5, -3192], [-202, 164.0, -3278], [-263, 161.9, -3364], [-323, 160.7, -3450], [-340, 160.8, -3478],
      [-353, 161.2, -3508], [-362, 161.8, -3539], [-367, 162.5, -3571], [-376, 165.0, -3681], [-386, 165.1, -3790],
      [-390, 164.5, -3820], [-396, 163.8, -3849], [-405, 162.9, -3878], [-417, 162.0, -3906], [-469, 159.1, -4018],
      [-522, 158.6, -4131], [-574, 157.6, -4243], [-627, 153.0, -4355], [-679, 147.0, -4468],
    ],
  },
  // Highway 99 from Horseshoe Bay to Whistler, squeezed into 5.7 km (Andrew, 2026-11-08: "a high average speed race
  // map, so focus more wider corners, but stronger turns where necessary"). Laid out as straights and arcs (320-620 m
  // as drawn; the spline tightens each a little, to 210-430 m) except the three that make you brake: Lions Bay's bluff
  // (54°, ~155 m) and the Cheakamus canyon pair (60° and 71°, ~170 and ~155 m). Grades stay under 6% (`clean`).
  // Howe Sound is on the left (west, the terrain leans down into it), the Coast Mountains on the right.
  seatosky: {
    id: 'seatosky',
    name: 'Sea-to-Sky',
    tag: 'Highway 99 · Howe Sound cliffs · canyon climb · fast',
    blurb: 'Horseshoe Bay to Whistler at full song: up off the ferry dock, long sweepers along the cliffs above Howe Sound, a plunge down past Britannia to the Squamish flats under the Chief, then the Cheakamus canyon climb, the only real braking on the road, and fast again across Daisy Lake into the village.',
    theme: 'alpine',
    seed: 9901,
    width: 15,
    relief: 260,
    tilt: [0.45, 0],
    water: 4,
    clean: true,
    points: [
      [0, 22.0, 0], [0, 23.0, -100], [0, 24.0, -200], [2, 25.9, -233], [7, 27.8, -267], [16, 29.6, -299],
      [28, 31.5, -330], [43, 33.4, -360], [61, 35.3, -388], [79, 37.1, -416], [95, 39.0, -445], [108, 40.8, -475],
      [119, 42.7, -507], [127, 44.5, -539], [132, 46.4, -572], [134, 48.3, -605], [133, 50.1, -638], [129, 52.0, -671],
      [122, 53.8, -703], [86, 62.2, -849], [79, 64.0, -881], [75, 65.9, -913], [72, 67.7, -945], [71, 69.5, -977],
      [73, 71.3, -1010], [76, 73.1, -1042], [82, 74.9, -1074], [87, 76.8, -1106], [89, 78.6, -1139], [87, 80.1, -1172],
      [81, 80.5, -1204], [72, 81.0, -1236], [59, 81.4, -1266], [43, 81.9, -1295], [-20, 83.5, -1397], [-36, 83.9, -1425],
      [-51, 83.9, -1454], [-63, 83.8, -1483], [-73, 83.7, -1514], [-80, 83.6, -1545], [-86, 83.5, -1577], [-89, 83.4, -1609],
      [-90, 83.3, -1641], [-93, 83.2, -1673], [-99, 83.1, -1704], [-110, 83.0, -1734], [-125, 82.8, -1763], [-144, 82.7, -1789],
      [-166, 82.6, -1812], [-192, 82.5, -1831], [-275, 82.2, -1887], [-300, 82.1, -1907], [-324, 81.9, -1928], [-346, 81.2, -1952],
      [-365, 80.6, -1978], [-382, 79.9, -2005], [-396, 79.3, -2034], [-408, 78.7, -2064], [-419, 78.0, -2095], [-431, 76.1, -2125],
      [-445, 74.2, -2154], [-461, 72.3, -2183], [-478, 70.4, -2210], [-496, 68.4, -2237], [-516, 66.5, -2263], [-537, 64.6, -2287],
      [-615, 57.7, -2374], [-693, 50.8, -2461], [-771, 43.9, -2547], [-849, 37.0, -2634], [-927, 30.2, -2721], [-1005, 23.3, -2808],
      [-1027, 21.3, -2833], [-1046, 19.3, -2860], [-1064, 17.3, -2889], [-1080, 15.8, -2918], [-1093, 15.3, -2949], [-1105, 14.8, -2980],
      [-1114, 14.3, -3013], [-1122, 13.9, -3042], [-1132, 13.4, -3070], [-1144, 13.0, -3098], [-1157, 13.1, -3126], [-1171, 13.2, -3152],
      [-1188, 13.2, -3178], [-1205, 13.3, -3202], [-1224, 13.4, -3226], [-1245, 13.5, -3248], [-1265, 13.5, -3272], [-1282, 13.6, -3298],
      [-1295, 13.7, -3327], [-1305, 13.8, -3357], [-1310, 13.9, -3388], [-1312, 13.9, -3419], [-1309, 14.1, -3450], [-1303, 15.4, -3481],
      [-1264, 21.4, -3616], [-1259, 23.0, -3641], [-1257, 24.5, -3668], [-1259, 26.0, -3694], [-1264, 27.6, -3720], [-1273, 29.1, -3745],
      [-1286, 30.6, -3769], [-1301, 32.1, -3790], [-1320, 33.7, -3809], [-1341, 35.2, -3825], [-1440, 42.1, -3893], [-1466, 44.0, -3912],
      [-1489, 45.8, -3934], [-1509, 47.7, -3959], [-1527, 49.5, -3986], [-1541, 51.4, -4015], [-1552, 53.2, -4045], [-1559, 55.1, -4076],
      [-1565, 56.8, -4106], [-1573, 58.6, -4135], [-1582, 60.3, -4164], [-1593, 62.1, -4193], [-1605, 63.8, -4220], [-1619, 65.6, -4247],
      [-1635, 67.3, -4274], [-1651, 69.1, -4299], [-1669, 70.8, -4324], [-1749, 78.3, -4426], [-1829, 85.8, -4528], [-1847, 87.5, -4552],
      [-1864, 89.2, -4577], [-1879, 90.9, -4602], [-1893, 92.5, -4629], [-1906, 93.6, -4656], [-1918, 94.8, -4683], [-1928, 96.0, -4711],
      [-1937, 97.2, -4739], [-1970, 98.7, -4855], [-2003, 99.5, -4970],
    ],
  },
  // Two grand prix highways (Andrew, 2026-11-09: "straight aways with high speed, as well as important breaking
  // points/turns ... make the whole road full of traffic with 6 lanes going in the same direction ... two different
  // maps with the same vibe, but different layouts"). Both 21 m, six lanes painted (`lanes: 6`), walls at the white
  // lines (`walled`), and long flat-out straights that end in hard braking: 90° corners of 40-60 m, a hairpin, a
  // chicane. Laid out as straights and arcs like Sea-to-Sky. They had six lanes of traffic until Andrew asked the
  // same day to "remove traffic/cars from Shiden Boulevard and Isonami Corniche": now `clean`, nothing on the road
  // but the racers.
  shiden: {
    id: 'shiden',
    name: 'Shiden Boulevard',
    tag: 'Night grand prix · six lanes wall to wall · hard braking',
    blurb: 'A grand prix down the city\'s widest boulevards after dark, closed off wall to wall. A kilometre flat out into a square left, a chicane, a hairpin at the end of the longest straight: brake late, hit the apex, and get on the power first.',
    theme: 'city',
    seed: 5113,
    width: 21,
    relief: 50,
    lanes: 6,
    walled: true,
    clean: true,
    points: [
      [0, 40.0, 0], [0, 40.3, -125], [0, 40.7, -250], [0, 41.0, -375], [0, 41.3, -500], [0, 41.7, -625],
      [0, 42.0, -750], [0, 42.3, -875], [0, 42.7, -1000], [0, 42.7, -1006], [-2, 42.7, -1012], [-4, 42.7, -1018],
      [-6, 42.7, -1024], [-10, 42.8, -1029], [-14, 42.8, -1034], [-19, 42.8, -1038], [-24, 42.8, -1042], [-30, 42.8, -1044],
      [-36, 42.8, -1046], [-42, 42.9, -1048], [-48, 42.9, -1048], [-163, 43.2, -1048], [-278, 43.5, -1048], [-393, 43.8, -1048],
      [-508, 43.9, -1048], [-516, 43.9, -1049], [-524, 43.9, -1050], [-531, 43.9, -1053], [-538, 43.9, -1056], [-545, 43.9, -1060],
      [-550, 43.8, -1066], [-556, 43.8, -1071], [-560, 43.8, -1078], [-563, 43.8, -1085], [-566, 43.8, -1092], [-567, 43.8, -1100],
      [-568, 43.7, -1108], [-568, 43.5, -1215], [-568, 43.3, -1321], [-568, 43.1, -1428], [-568, 43.1, -1433], [-569, 43.1, -1438],
      [-571, 43.1, -1443], [-573, 43.1, -1448], [-576, 43.0, -1453], [-579, 43.0, -1457], [-583, 43.0, -1460], [-587, 43.0, -1464],
      [-590, 43.0, -1468], [-593, 43.0, -1472], [-595, 43.0, -1477], [-597, 43.0, -1482], [-598, 43.0, -1487], [-598, 43.0, -1492],
      [-598, 42.7, -1615], [-598, 42.5, -1738], [-598, 42.2, -1861], [-598, 42.0, -1984], [-598, 41.7, -2107], [-598, 41.5, -2229],
      [-598, 41.2, -2352], [-598, 41.2, -2358], [-596, 41.2, -2364], [-594, 41.2, -2370], [-592, 41.2, -2375], [-588, 41.2, -2380],
      [-584, 41.2, -2385], [-579, 41.1, -2388], [-574, 41.1, -2391], [-569, 41.1, -2394], [-563, 41.1, -2395], [-557, 41.1, -2396],
      [-551, 41.1, -2396], [-545, 41.1, -2395], [-539, 41.1, -2394], [-534, 41.1, -2391], [-529, 41.0, -2388], [-524, 41.0, -2385],
      [-520, 41.0, -2380], [-516, 41.0, -2375], [-514, 41.0, -2370], [-512, 41.0, -2364], [-510, 41.0, -2358], [-510, 41.0, -2352],
      [-510, 41.1, -2240], [-510, 41.2, -2128], [-510, 41.3, -2016], [-510, 41.4, -1904], [-510, 41.4, -1792], [-510, 41.5, -1786],
      [-508, 41.5, -1780], [-507, 41.5, -1775], [-504, 41.5, -1769], [-501, 41.5, -1764], [-497, 41.5, -1760], [-492, 41.5, -1756],
      [-487, 41.5, -1753], [-482, 41.5, -1750], [-476, 41.5, -1748], [-470, 41.5, -1747], [-464, 41.5, -1746], [-359, 41.6, -1746],
      [-254, 41.7, -1746], [-149, 41.7, -1746], [-44, 41.8, -1746], [-23, 41.8, -1748], [-3, 41.9, -1752], [17, 41.9, -1759],
      [35, 41.9, -1769], [52, 41.9, -1781], [152, 42.0, -1865], [252, 42.1, -1949], [257, 42.1, -1953], [261, 42.1, -1959],
      [265, 42.1, -1964], [267, 42.1, -1971], [270, 42.1, -1977], [271, 42.1, -1984], [271, 42.1, -1991], [271, 42.2, -2105],
      [271, 42.3, -2219], [271, 42.4, -2334], [271, 42.5, -2448], [271, 42.6, -2562], [271, 42.7, -2676], [271, 42.8, -2791],
    ],
  },
  isonami: {
    id: 'isonami',
    name: 'Isonami Corniche',
    tag: 'Seafront grand prix · six lanes wall to wall · hard braking',
    blurb: 'The coast road closed for a grand prix, six lanes wide between the walls. Flat-out kinks along the sea, then a 95° left, a hairpin by the lighthouse and a chicane, each at the end of a straight you will want to brake too late for.',
    theme: 'coast',
    seed: 6211,
    width: 21,
    relief: 70,
    tilt: [0.25, 0],
    water: 0,
    lanes: 6,
    walled: true,
    clean: true,
    points: [
      [0, 9.0, 0], [0, 9.3, -117], [0, 9.6, -233], [0, 9.9, -350], [0, 10.2, -467], [0, 10.5, -583],
      [0, 10.8, -700], [1, 10.8, -727], [6, 10.9, -754], [13, 11.0, -780], [22, 11.0, -806], [75, 11.3, -925],
      [128, 11.7, -1043], [181, 12.0, -1162], [234, 11.8, -1281], [236, 11.8, -1286], [237, 11.8, -1291], [237, 11.8, -1297],
      [237, 11.7, -1302], [236, 11.7, -1308], [234, 11.7, -1313], [232, 11.7, -1318], [228, 11.7, -1322], [225, 11.7, -1326],
      [220, 11.7, -1330], [216, 11.7, -1333], [210, 11.7, -1335], [91, 11.5, -1376], [-29, 11.3, -1417], [-149, 11.0, -1459],
      [-158, 11.0, -1462], [-166, 11.0, -1467], [-174, 11.0, -1473], [-181, 11.0, -1480], [-187, 11.0, -1488], [-192, 10.9, -1497],
      [-196, 10.9, -1506], [-198, 10.9, -1515], [-199, 10.9, -1525], [-199, 10.9, -1535], [-190, 10.7, -1664], [-181, 10.4, -1794],
      [-181, 10.4, -1801], [-182, 10.4, -1808], [-184, 10.4, -1814], [-187, 10.4, -1821], [-190, 10.4, -1826], [-194, 10.4, -1832],
      [-200, 10.4, -1836], [-205, 10.4, -1840], [-211, 10.3, -1844], [-218, 10.3, -1846], [-224, 10.3, -1847], [-231, 10.3, -1848],
      [-238, 10.3, -1847], [-245, 10.3, -1846], [-360, 10.1, -1813], [-475, 10.2, -1780], [-591, 10.6, -1746], [-706, 11.0, -1713],
      [-822, 11.4, -1680], [-937, 11.8, -1647], [-962, 11.9, -1641], [-987, 12.0, -1636], [-1012, 12.1, -1633], [-1038, 12.2, -1631],
      [-1064, 12.3, -1630], [-1089, 12.3, -1626], [-1114, 12.4, -1621], [-1139, 12.5, -1615], [-1261, 12.9, -1580], [-1383, 13.4, -1545],
      [-1504, 13.8, -1510], [-1510, 13.8, -1509], [-1517, 13.8, -1509], [-1523, 13.8, -1509], [-1529, 13.9, -1510], [-1535, 13.9, -1513],
      [-1540, 13.9, -1515], [-1546, 13.9, -1519], [-1550, 13.9, -1523], [-1554, 14.0, -1528], [-1557, 14.0, -1534], [-1559, 14.0, -1539],
      [-1561, 14.0, -1545], [-1562, 14.0, -1552], [-1562, 13.9, -1558], [-1561, 13.9, -1564], [-1559, 13.9, -1570], [-1556, 13.9, -1576],
      [-1553, 13.9, -1581], [-1549, 13.9, -1586], [-1544, 13.9, -1590], [-1539, 13.8, -1593], [-1533, 13.8, -1596], [-1428, 13.5, -1636],
      [-1324, 13.3, -1676], [-1219, 13.0, -1716], [-1115, 12.7, -1756], [-1010, 12.4, -1796], [-1006, 12.4, -1798], [-1001, 12.4, -1799],
      [-996, 12.4, -1799], [-992, 12.4, -1798], [-987, 12.4, -1797], [-983, 12.3, -1796], [-978, 12.3, -1794], [-974, 12.3, -1793],
      [-969, 12.3, -1793], [-964, 12.3, -1793], [-960, 12.3, -1794], [-955, 12.3, -1795], [-843, 12.0, -1838], [-731, 11.7, -1881],
      [-619, 11.4, -1924], [-507, 11.1, -1967], [-489, 11.0, -1975], [-472, 11.0, -1986], [-456, 11.0, -1998], [-442, 11.0, -2013],
      [-430, 10.9, -2029], [-421, 10.9, -2046], [-413, 10.9, -2064], [-378, 10.8, -2165], [-343, 10.7, -2266], [-309, 10.6, -2367],
      [-306, 10.6, -2374], [-302, 10.6, -2380], [-298, 10.6, -2386], [-292, 10.6, -2391], [-286, 10.6, -2395], [-280, 10.6, -2399],
      [-273, 10.6, -2402], [-266, 10.6, -2403], [-258, 10.6, -2404], [-251, 10.6, -2404], [-243, 10.6, -2402], [-117, 10.5, -2371],
      [9, 10.4, -2339], [135, 10.3, -2308], [261, 10.1, -2276],
    ],
  },
  // Two short sprint rings by day (Andrew, 2026-11-10: "high speed and swiftly turns ... 4 lap races but relatively
  // shorter laps ... day-time maps"). Laid out as straights and arcs with the loop closed exactly: no corner tighter
  // than 60 m and most 70-110 m, so they're taken fast, strung into quick left-right esses with short straights
  // between; ~1.4 km a lap, four laps.
  mizuumi: {
    id: 'mizuumi',
    name: 'Mizuumi Ring',
    tag: 'Lakeside circuit · 4 laps · fast esses',
    blurb: 'A quick ring on a mountain lake: a fast right off the line, a left-right esse, a flick into a long double right round the far shore, another esse on the back stretch and a sweeping right onto the straight. Short laps, no slow corners: keep it flowing.',
    theme: 'alpine',
    seed: 3301,
    width: 13,
    relief: 220,
    tilt: [0.3, 0],
    water: 60,
    laps: 4,
    points: [
      [0, 71.0, 0], [0, 71.7, -45], [0, 71.9, -90], [0, 71.8, -136], [0, 71.5, -181], [1, 71.4, -195],
      [4, 71.3, -208], [9, 71.2, -221], [16, 71.2, -233], [24, 71.1, -244], [34, 71.1, -254], [45, 71.1, -262],
      [57, 71.2, -268], [70, 71.3, -273], [128, 71.9, -288], [138, 72.0, -291], [146, 72.2, -296], [154, 72.3, -301],
      [161, 72.4, -308], [168, 72.6, -316], [174, 72.7, -323], [181, 72.8, -329], [188, 72.9, -335], [197, 73.0, -339],
      [206, 73.1, -342], [215, 73.1, -343], [225, 73.2, -343], [234, 73.2, -342], [243, 73.2, -340], [288, 72.9, -323],
      [334, 72.1, -307], [345, 71.8, -301], [355, 71.5, -295], [364, 71.2, -287], [372, 70.9, -277], [378, 70.6, -267],
      [383, 70.3, -255], [385, 69.9, -244], [386, 69.7, -231], [386, 68.7, -181], [386, 68.1, -131], [386, 68.1, -81],
      [387, 68.1, -70], [389, 68.2, -58], [393, 68.3, -47], [398, 68.4, -36], [403, 68.5, -27], [406, 68.5, -16],
      [408, 68.6, -6], [408, 68.7, 5], [406, 68.8, 15], [402, 68.8, 25], [398, 68.8, 35], [391, 68.9, 44],
      [379, 68.9, 56], [365, 68.8, 67], [350, 68.7, 75], [334, 68.6, 81], [317, 68.4, 85], [299, 68.2, 87],
      [264, 67.7, 87], [229, 67.3, 87], [219, 67.2, 87], [209, 67.0, 89], [199, 67.0, 93], [190, 66.9, 98],
      [181, 66.8, 104], [174, 66.8, 109], [166, 66.8, 113], [158, 66.8, 116], [149, 66.8, 118], [140, 66.9, 118],
      [131, 67.0, 117], [122, 67.0, 114], [66, 68.1, 94], [52, 68.4, 88], [39, 68.8, 79], [28, 69.2, 69],
      [18, 69.6, 57], [10, 70.0, 44], [5, 70.3, 30], [1, 70.7, 15],
    ],
  },
  hibari: {
    id: 'hibari',
    name: 'Hibari Coast',
    tag: 'Seaside circuit · 4 laps · flat-out flicks',
    blurb: 'A sprint ring on the clifftops at midday: a fast left off the line, a quick left along the cliff, a right-left flick, the long left round the headland, a kink and a quick left, then a fast double left back onto the straight. Four short laps, all of them quick.',
    theme: 'coast',
    seed: 3307,
    width: 13,
    relief: 90,
    tilt: [-0.35, 0],
    water: 0,
    laps: 4,
    points: [
      [0, 25.0, 0], [0, 25.7, -43], [0, 25.9, -85], [0, 25.8, -128], [0, 25.5, -171], [0, 25.2, -213],
      [-1, 25.1, -228], [-4, 25.1, -243], [-9, 25.1, -257], [-16, 25.2, -271], [-25, 25.3, -283], [-35, 25.4, -294],
      [-47, 25.6, -304], [-88, 26.3, -332], [-99, 26.5, -339], [-111, 26.7, -344], [-124, 26.8, -347], [-137, 27.0, -348],
      [-150, 27.1, -347], [-162, 27.2, -344], [-174, 27.2, -339], [-185, 27.2, -332], [-218, 26.9, -309], [-228, 26.7, -304],
      [-238, 26.5, -300], [-249, 26.3, -297], [-260, 26.1, -297], [-270, 25.8, -298], [-280, 25.6, -299], [-291, 25.3, -298],
      [-300, 25.0, -296], [-310, 24.7, -292], [-318, 24.5, -287], [-326, 24.2, -281], [-333, 23.9, -273], [-339, 23.7, -265],
      [-343, 23.4, -256], [-363, 22.3, -200], [-369, 22.1, -180], [-371, 22.1, -161], [-370, 22.1, -141], [-367, 22.1, -121],
      [-360, 22.3, -103], [-351, 22.4, -85], [-339, 22.6, -69], [-325, 22.7, -55], [-287, 22.9, -24], [-249, 22.6, 8],
      [-241, 22.5, 16], [-234, 22.4, 24], [-229, 22.2, 34], [-225, 22.1, 44], [-222, 21.9, 55], [-219, 21.8, 65],
      [-216, 21.6, 74], [-210, 21.5, 83], [-204, 21.3, 91], [-196, 21.2, 98], [-188, 21.1, 104], [-179, 21.0, 108],
      [-169, 20.9, 111], [-159, 20.8, 113], [-109, 20.9, 117], [-96, 21.1, 117], [-82, 21.3, 116], [-70, 21.5, 112],
      [-57, 21.8, 107], [-46, 22.1, 100], [-35, 22.4, 91], [-26, 22.8, 81], [-19, 23.1, 70], [-11, 23.6, 54],
      [-5, 24.1, 36], [-1, 24.6, 18],
    ],
  },
  // Two harder seaside sprint rings (Andrew, 2026-11-10: "two more maps similar to Hibari Coast but a bit more
  // challenging"): the same short 4-lap clifftop recipe, but 11.5 m wide, corners down to ~45-50 m, twice the
  // left-right flicks (three-corner esses) and the lap rising and falling ~16 m (grades under 7%).
  kamome: {
    id: 'kamome',
    name: 'Kamome Point',
    tag: 'Seaside circuit · 4 laps · tight esses · hills',
    blurb: 'A narrow ring round a gull-white headland: a tight left off a short straight, a right-left flick, the three-corner esse across the point, a fast left down to the shore and a long climb back to the line. Every lap rewards a cleaner line.',
    theme: 'coast',
    seed: 3313,
    width: 11.5,
    relief: 90,
    tilt: [-0.35, 0],
    water: 0,
    laps: 4,
    points: [
      [0, 36.3, 0], [0, 36.9, -46], [0, 36.6, -93], [0, 35.7, -139], [-1, 35.5, -148], [-3, 35.3, -156],
      [-6, 35.0, -165], [-10, 34.8, -172], [-16, 34.5, -179], [-22, 34.3, -185], [-30, 34.0, -190], [-38, 33.8, -194],
      [-46, 33.6, -197], [-55, 33.3, -199], [-95, 32.4, -202], [-101, 32.3, -203], [-108, 32.1, -205], [-114, 32.0, -208],
      [-120, 31.9, -212], [-125, 31.8, -216], [-130, 31.7, -221], [-134, 31.7, -227], [-138, 31.6, -234], [-144, 31.5, -240],
      [-151, 31.5, -245], [-158, 31.5, -249], [-166, 31.5, -252], [-174, 31.5, -254], [-182, 31.5, -254], [-191, 31.5, -254],
      [-230, 31.9, -247], [-270, 32.4, -240], [-309, 32.9, -233], [-322, 33.0, -229], [-334, 33.1, -224], [-346, 33.1, -217],
      [-356, 33.2, -208], [-365, 33.2, -198], [-372, 33.1, -187], [-378, 33.0, -175], [-381, 32.9, -168], [-385, 32.8, -161],
      [-391, 32.6, -155], [-397, 32.5, -150], [-403, 32.3, -145], [-411, 32.1, -142], [-417, 31.9, -139], [-423, 31.7, -135],
      [-429, 31.4, -130], [-433, 31.2, -125], [-437, 30.9, -119], [-440, 30.6, -112], [-442, 30.4, -105], [-442, 30.1, -98],
      [-442, 29.7, -90], [-440, 29.4, -83], [-438, 29.1, -77], [-419, 26.8, -36], [-400, 24.5, 5], [-391, 23.6, 21],
      [-379, 22.7, 36], [-365, 22.0, 49], [-349, 21.3, 59], [-332, 20.8, 67], [-324, 20.6, 71], [-316, 20.5, 76],
      [-309, 20.4, 83], [-303, 20.3, 90], [-298, 20.2, 98], [-294, 20.3, 105], [-289, 20.3, 112], [-282, 20.4, 118],
      [-275, 20.5, 123], [-268, 20.6, 126], [-259, 20.8, 129], [-251, 21.1, 130], [-243, 21.3, 130], [-234, 21.6, 128],
      [-191, 23.5, 116], [-149, 26.1, 105], [-106, 28.9, 94], [-63, 31.6, 82], [-51, 32.3, 78], [-40, 33.0, 72],
      [-30, 33.6, 65], [-22, 34.2, 57], [-14, 34.8, 47], [-8, 35.2, 36], [-4, 35.6, 24], [-1, 36.0, 12],
    ],
  },
  shiokaze: {
    id: 'shiokaze',
    name: 'Shiokaze Cliffs',
    tag: 'Seaside circuit · 4 laps · tightening bends · hills',
    blurb: 'The hardest of the clifftop rings: a short straight into a right-left flick, a long right that keeps tightening, a dip down the cliff and back up, then a run of quick corners above the sea that never lets you settle. Four laps, no room to waste.',
    theme: 'coast',
    seed: 3319,
    width: 11.5,
    relief: 90,
    tilt: [0.35, 0],
    water: 0,
    laps: 4,
    // The line is 56 m up the short main straight, so the pad out of the last corner comes before it every lap.
    points: [
      [0, 42.7, -56], [0, 42.5, -112], [1, 42.4, -123], [3, 42.2, -133], [7, 42.0, -143],
      [12, 41.7, -152], [19, 41.4, -160], [26, 41.1, -167], [35, 40.8, -173], [41, 40.5, -177], [47, 40.2, -182],
      [51, 39.9, -188], [55, 39.6, -195], [58, 39.3, -202], [59, 39.0, -209], [60, 38.6, -216], [61, 38.2, -225],
      [62, 37.8, -233], [66, 37.4, -240], [70, 36.9, -248], [75, 36.5, -254], [81, 36.0, -260], [88, 35.6, -264],
      [95, 35.1, -268], [103, 34.6, -270], [112, 34.2, -271], [120, 33.7, -271], [160, 31.5, -268], [175, 30.7, -265],
      [189, 29.9, -261], [203, 29.2, -254], [216, 28.6, -246], [228, 28.0, -236], [270, 26.5, -193], [277, 26.4, -187],
      [285, 26.3, -183], [293, 26.2, -179], [302, 26.2, -177], [311, 26.2, -176], [321, 26.3, -176], [329, 26.3, -178],
      [338, 26.4, -182], [351, 26.7, -187], [365, 26.9, -190], [379, 27.3, -191], [392, 27.7, -190], [406, 28.2, -187],
      [413, 28.4, -185], [419, 28.7, -182], [425, 28.9, -178], [430, 29.2, -173], [435, 29.5, -167], [438, 29.8, -161],
      [441, 30.1, -155], [442, 30.5, -148], [449, 32.3, -108], [451, 32.7, -101], [454, 33.1, -93], [459, 33.4, -86],
      [464, 33.8, -80], [469, 34.2, -75], [476, 34.5, -70], [484, 34.9, -65], [491, 35.3, -59], [496, 35.7, -51],
      [501, 36.1, -43], [504, 36.5, -34], [506, 36.8, -25], [506, 37.1, -15], [505, 37.4, -6], [502, 37.7, 3],
      [498, 38.0, 12], [478, 38.8, 46], [471, 39.0, 56], [463, 39.1, 65], [454, 39.2, 72], [443, 39.3, 78],
      [432, 39.3, 83], [421, 39.4, 85], [409, 39.3, 86], [367, 39.1, 86], [325, 38.6, 86], [283, 38.1, 86],
      [241, 37.7, 86], [231, 37.7, 87], [222, 37.6, 89], [213, 37.6, 92], [204, 37.6, 97], [196, 37.6, 103],
      [185, 37.6, 111], [173, 37.6, 117], [160, 37.7, 121], [146, 37.8, 123], [132, 38.0, 123], [119, 38.2, 122],
      [106, 38.4, 118], [93, 38.6, 112], [50, 39.7, 87], [38, 40.1, 78], [27, 40.4, 68], [17, 40.8, 56],
      [10, 41.1, 43], [4, 41.4, 29], [1, 41.8, 15], [0, 42.0, 0],
    ],
  },
  // The Postcard Cup (Michael, 2026-11-10: "5 new maps ... all under the same cup ... based on unique cities like
  // Taketomi Island in Okinawa"): five circuits round five storybook towns, each dressed in its own buildings by
  // toge/client/towns.ts. Laid out as straights and arcs closed exactly (the sprint rings' generator), hills as sine
  // waves round the lap; easiest first, from flat Taketomi to Chefchaouen's hairpins.
  taketomi: {
    id: 'taketomi',
    name: 'Taketomi Island',
    tag: 'Island village circuit · 2 laps · coral lanes',
    blurb: 'A day on the little coral island off Ishigaki: square corners through the village lanes between coral-stone walls and red-tiled roofs, out past the water buffalo carts to a fast sweep along the white beach, then back in through the lanes to the line.',
    theme: 'coast',
    seed: 5101,
    width: 10,
    relief: 10,
    tilt: [-0.12, 0],
    water: 0,
    laps: 2,
    points: [
      [0, 6.6, 0], [0, 6.8, -37.4], [0, 6.9, -74.8], [0, 6.9, -112.2], [0, 6.8, -149.5], [0, 6.7, -186.9],
      [0, 6.6, -224.3], [0, 6.4, -261.7], [0, 6.4, -299.1], [0, 6.3, -336.5], [0, 6.4, -373.9], [0, 6.4, -411.3],
      [0, 6.5, -448.6], [1.2, 6.5, -456.1], [4.6, 6.5, -462.7], [9.9, 6.5, -468.1], [16.6, 6.5, -471.5], [24, 6.5, -472.6],
      [56.5, 6.5, -472.6], [89, 6.4, -472.6], [121.5, 6.2, -472.6], [154, 6, -472.6], [162, 5.9, -473.9], [169.3, 5.9, -477.6],
      [175, 5.8, -483.4], [178.7, 5.7, -490.6], [180, 5.7, -498.6], [180, 5.4, -538.6], [180, 5.1, -578.6], [180, 4.9, -618.6],
      [181.2, 4.9, -626.1], [184.6, 4.9, -632.7], [189.9, 4.8, -638.1], [196.6, 4.8, -641.5], [204, 4.8, -642.6], [238, 4.9, -642.6],
      [272, 5, -642.6], [306, 5.2, -642.6], [340, 5.4, -642.6], [374, 5.6, -642.6], [381.8, 5.6, -642.2], [389.6, 5.7, -640.9],
      [397.1, 5.7, -638.7], [404.4, 5.8, -635.7], [411.2, 5.8, -631.9], [417.6, 5.8, -627.4], [423.5, 5.9, -622.1], [450.2, 6, -595.4],
      [476.9, 6, -568.7], [503.6, 6, -542], [509.8, 6, -535.6], [515.6, 6, -529], [521.2, 6, -522.1], [526.4, 6, -515],
      [531.4, 6, -507.7], [536.1, 6, -500.1], [540.4, 6, -492.4], [544.4, 6, -484.5], [548.1, 6, -476.5], [551.4, 6, -468.3],
      [554.4, 6, -460], [557, 6, -451.5], [559.2, 6, -443], [561.1, 6, -434.3], [562.7, 6, -425.6], [563.9, 6, -416.8],
      [564.7, 6.1, -408], [565.1, 6.1, -399.2], [565.1, 6.1, -390.3], [564.8, 6.2, -381.5], [564.1, 6.2, -372.7], [563.1, 6.3, -363.9],
      [561.6, 6.3, -355.2], [559.8, 6.3, -346.5], [557.7, 6.4, -337.9], [555.1, 6.5, -329.4], [552.3, 6.5, -321.1], [549, 6.6, -312.8],
      [545.5, 6.6, -304.7], [529.8, 6.9, -271.1], [514.1, 7, -237.4], [498.4, 7.2, -203.8], [482.7, 7.2, -170.1], [467, 7.1, -136.4],
      [451.3, 6.9, -102.8], [435.6, 6.6, -69.1], [431.6, 6.5, -61.2], [427, 6.4, -53.5], [421.9, 6.4, -46.2], [416.3, 6.3, -39.3],
      [410.3, 6.2, -32.7], [403.8, 6.1, -26.6], [396.9, 6.1, -20.9], [389.7, 6, -15.7], [382.1, 5.9, -11.1], [374.2, 5.9, -6.9],
      [366, 5.8, -3.3], [357.6, 5.8, -0.3], [349.1, 5.7, 2.1], [340.4, 5.7, 4], [308.3, 5.5, 9.6], [276.3, 5.5, 15.3],
      [244.3, 5.5, 20.9], [212.3, 5.5, 26.6], [204, 5.5, 29.4], [197, 5.5, 34.7], [192, 5.6, 41.9], [189.5, 5.6, 50.2],
      [189.6, 5.6, 59], [196, 5.6, 95.1], [202.3, 5.7, 131.2], [208.7, 5.6, 167.3], [208.9, 5.6, 175.4], [206.5, 5.6, 183.2],
      [201.8, 5.5, 189.9], [195.3, 5.5, 194.8], [187.6, 5.5, 197.4], [150.7, 5.4, 203.9], [113.8, 5.2, 210.5], [76.8, 5.1, 217],
      [39.9, 5.1, 223.5], [31.5, 5.1, 223.9], [23.2, 5.1, 222.2], [15.6, 5.1, 218.6], [9.1, 5.1, 213.1], [4.1, 5.1, 206.3],
      [1.1, 5.2, 198.4], [0, 5.2, 190], [0, 5.4, 152], [0, 5.7, 114], [0, 6, 76], [0, 6.4, 38],
    ],
  },
  hallstatt: {
    id: 'hallstatt',
    name: 'Hallstatt Shore',
    tag: 'Lakeside village circuit · 2 laps · hairpins',
    blurb: 'The storybook village on its mountain lake in the evening light: a long run along the shore past the boathouses and the church spire, a hairpin pair up the slope behind the houses, and a fast drop back down to the water.',
    theme: 'alpine',
    seed: 5107,
    width: 11,
    relief: 260,
    tilt: [0.3, 0],
    water: 58,
    laps: 2,
    points: [
      [0, 68.5, 0], [0, 68.7, -37.5], [0, 68.7, -75], [0, 68.6, -112.5], [0, 68.3, -150], [0, 68, -187.5],
      [0, 67.6, -225], [0, 67.4, -262.5], [0, 67.3, -300], [0.4, 67.2, -309], [1.8, 67.3, -317.8], [4, 67.3, -326.5],
      [7.1, 67.3, -335], [11, 67.3, -343], [15.6, 67.4, -350.7], [21.1, 67.4, -357.9], [45.2, 67.8, -386.6], [69.3, 68.4, -415.3],
      [93.4, 69.1, -444], [117.5, 69.9, -472.8], [123.5, 70.1, -479.1], [130.2, 70.3, -484.6], [137.6, 70.5, -489.2], [145.5, 70.7, -492.9],
      [153.8, 70.9, -495.6], [162.4, 71.1, -497.2], [171.1, 71.3, -497.8], [211.1, 72.1, -497.8], [251.1, 72.9, -497.8], [291.1, 73.6, -497.8],
      [299.8, 73.7, -498.7], [308, 73.9, -501.5], [315.4, 74, -506], [321.7, 74.1, -512.1], [326.6, 74.2, -519.3], [329.7, 74.4, -527.4],
      [331.1, 74.5, -536], [330.5, 74.6, -544.7], [328.1, 74.8, -553.1], [323.9, 74.9, -560.7], [318.1, 75, -567.3], [311.1, 75.2, -572.4],
      [279.3, 75.8, -590.7], [247.6, 76.6, -609.1], [215.8, 77.5, -627.4], [209, 77.8, -632.3], [203.3, 78.1, -638.5], [198.9, 78.3, -645.8],
      [196.1, 78.6, -653.7], [194.9, 78.9, -662.1], [195.4, 79.3, -670.5], [197.6, 79.6, -678.7], [201.3, 79.9, -686.2], [206.5, 80.3, -692.9],
      [213, 80.7, -698.3], [220.4, 81.1, -702.4], [228.4, 81.5, -704.9], [236.8, 81.9, -705.8], [271.8, 83.7, -705.8], [306.8, 85.6, -705.8],
      [341.8, 87.5, -705.8], [376.8, 89.5, -705.8], [385.4, 90, -705.2], [393.7, 90.4, -703.3], [401.8, 90.9, -700.4], [409.3, 91.3, -696.3],
      [416.1, 91.7, -691.1], [422.2, 92.1, -685.1], [427.3, 92.5, -678.2], [431.4, 92.9, -670.7], [434.4, 93.3, -662.7], [436.2, 93.6, -654.3],
      [436.8, 93.9, -645.8], [436.8, 95.2, -606.2], [436.8, 96.1, -566.6], [436.8, 96.5, -527], [436.8, 96.5, -487.4], [436.8, 96.1, -447.8],
      [436.8, 95.4, -408.2], [436.8, 94.4, -368.6], [436.8, 93.4, -329], [436.8, 92.3, -289.4], [436.8, 91.1, -249.8], [436.8, 90, -210.2],
      [436.8, 88.8, -170.6], [436.8, 87.6, -131], [436.8, 86.4, -91.4], [436.8, 85, -51.8], [436.4, 84.7, -43.4], [435.1, 84.4, -35.2],
      [432.9, 84, -27.1], [429.9, 83.7, -19.3], [426.1, 83.3, -11.8], [421.6, 83, -4.8], [416.3, 82.6, 1.7], [410.4, 82.3, 7.7],
      [403.9, 81.9, 12.9], [396.8, 81.5, 17.5], [364.7, 79.7, 36.1], [332.5, 77.8, 54.7], [300.3, 75.8, 73.2], [268.1, 73.8, 91.8],
      [235.9, 71.9, 110.4], [203.7, 70.1, 129], [171.6, 68.7, 147.6], [139.4, 67.5, 166.1], [107.2, 66.7, 184.7], [75, 66.2, 203.3],
      [67.1, 66.2, 207], [58.7, 66.1, 209.2], [50, 66.1, 210], [41.3, 66.1, 209.2], [32.9, 66.1, 207], [25, 66.1, 203.3],
      [17.9, 66.1, 198.3], [11.7, 66.2, 192.1], [6.7, 66.3, 185], [3, 66.3, 177.1], [0.8, 66.4, 168.7], [0, 66.5, 160],
      [0, 67, 120], [0, 67.6, 80], [0, 68.1, 40],
    ],
  },
  goreme: {
    id: 'goreme',
    name: 'Göreme Valley',
    tag: 'Balloon valley circuit · 2 laps · fast and flowing',
    blurb: 'Sunrise over Cappadocia with a sky full of hot-air balloons: flowing bends through the fairy chimneys and cave houses, rollercoaster dips down the valley, one hairpin under the rock castle, then flat out home.',
    theme: 'desert',
    seed: 5113,
    width: 12.5,
    relief: 90,
    laps: 2,
    points: [
      [0, 70.5, 0], [0, 70.9, -37.1], [0, 70.8, -74.3], [0, 70, -111.4], [0, 68.7, -148.6], [0, 67, -185.7],
      [0, 65.2, -222.9], [0, 63.3, -260], [0.2, 62.9, -268.8], [1, 62.5, -277.6], [2.2, 62.1, -286.3], [3.9, 61.7, -295],
      [6, 61.3, -303.5], [8.7, 61, -312], [11.8, 60.7, -320.2], [15.3, 60.4, -328.3], [19.3, 60.2, -336.2], [23.7, 60, -343.8],
      [28.5, 59.8, -351.2], [33.7, 59.6, -358.3], [39.3, 59.5, -365.1], [45.3, 59.4, -371.6], [51.6, 59.4, -377.7], [58.3, 59.4, -383.5],
      [65.2, 59.4, -388.9], [72.5, 59.4, -393.9], [80, 59.5, -398.6], [108.9, 60.2, -415.2], [137.7, 61.2, -431.9], [166.6, 62.7, -448.6],
      [173.9, 63.1, -453.3], [180.8, 63.5, -458.7], [187.1, 64, -464.7], [192.7, 64.4, -471.4], [197.7, 64.9, -478.5], [202, 65.3, -486.1],
      [205.6, 65.8, -494.1], [208.3, 66.3, -502.4], [210.2, 66.7, -510.9], [217.2, 68.8, -550.3], [224.1, 70.5, -589.7], [226.1, 70.9, -598],
      [228.9, 71.2, -606.1], [232.6, 71.4, -613.9], [237.1, 71.7, -621.2], [242.3, 71.9, -628], [248.3, 72.1, -634.2], [254.9, 72.3, -639.7],
      [262, 72.5, -644.5], [269.6, 72.6, -648.5], [277.6, 72.8, -651.7], [285.9, 72.8, -653.9], [294.3, 72.9, -655.3], [302.9, 73, -655.8],
      [338.9, 72.9, -655.8], [374.9, 72.6, -655.8], [410.9, 72, -655.8], [446.9, 71.2, -655.8], [482.9, 70.5, -655.8], [491.9, 70.3, -655.4],
      [500.8, 70.1, -654.4], [509.6, 69.9, -652.8], [518.3, 69.7, -650.4], [526.8, 69.5, -647.5], [535, 69.4, -643.9], [542.9, 69.2, -639.7],
      [550.5, 69, -634.9], [557.7, 68.9, -629.6], [564.5, 68.7, -623.7], [570.9, 68.6, -617.4], [576.7, 68.4, -610.6], [582.1, 68.3, -603.4],
      [586.8, 68.2, -595.8], [603.5, 67.6, -566.9], [620.2, 67.1, -538], [636.8, 66.5, -509.2], [641.1, 66.3, -501.4], [645.1, 66.1, -493.5],
      [648.7, 65.9, -485.4], [652, 65.7, -477.2], [655, 65.5, -468.8], [657.6, 65.2, -460.4], [659.9, 64.9, -451.8], [661.9, 64.6, -443.2],
      [663.5, 64.3, -434.5], [664.7, 64, -425.7], [665.6, 63.7, -416.9], [666.1, 63.3, -408], [666.3, 63, -399.2], [666.3, 61.1, -360.1],
      [666.3, 59, -321], [666.3, 56.8, -281.9], [666.3, 54.5, -242.8], [666.3, 52.5, -203.7], [666.3, 50.8, -164.6], [666.3, 49.6, -125.5],
      [666.3, 49.1, -86.3], [666.3, 49.2, -47.2], [666.3, 50.1, -8.1], [666.3, 51.5, 31], [666.3, 53.3, 70.1], [666.3, 55.3, 109.2],
      [666.3, 57.2, 148.3], [666.3, 58.9, 187.4], [666.3, 60, 226.5], [666.3, 60.6, 265.6], [666.3, 60.5, 304.7], [666.3, 59.7, 343.8],
      [666.3, 58.3, 382.9], [666.3, 56.5, 422], [666.3, 54.5, 461.1], [666.3, 52.4, 500.2], [665.4, 52, 508.3], [662.6, 51.6, 515.9],
      [658.1, 51.2, 522.7], [652.2, 50.8, 528.3], [645.2, 50.4, 532.3], [637.4, 50.1, 534.7], [629.3, 49.7, 535.1], [621.3, 49.4, 533.7],
      [613.8, 49.1, 530.5], [581.9, 48, 512], [549.9, 47.3, 493.6], [517.9, 47, 475.1], [486, 47.2, 456.7], [454, 47.6, 438.2],
      [422.1, 48.3, 419.8], [390.1, 49, 401.3], [358.1, 49.8, 382.9], [326.2, 50.6, 364.4], [294.2, 51.2, 346], [262.3, 51.8, 327.5],
      [254.5, 51.9, 323.5], [246.5, 52.1, 320.2], [238.1, 52.2, 317.5], [229.6, 52.3, 315.7], [221, 52.5, 314.5], [212.3, 52.6, 314.1],
      [203.5, 52.8, 314.5], [194.9, 52.9, 315.7], [186.2, 53, 316.8], [177.5, 53.2, 317.2], [168.8, 53.4, 316.8], [160.2, 53.5, 315.7],
      [151.6, 53.7, 313.8], [143.3, 53.9, 311.1], [135.3, 54.1, 307.8], [127.5, 54.4, 303.8], [120.2, 54.6, 299.1], [113.3, 54.9, 293.8],
      [106.8, 55.1, 287.9], [78.5, 56.6, 259.6], [50.3, 58.3, 231.3], [22, 60.4, 203], [16.4, 60.9, 196.8], [11.5, 61.4, 189.9],
      [7.4, 61.8, 182.5], [4.2, 62.3, 174.8], [1.9, 62.8, 166.7], [0.5, 63.3, 158.4], [0, 63.8, 150], [0, 65.9, 112.5],
      [0, 67.8, 75], [0, 69.4, 37.5],
    ],
  },
  oia: {
    id: 'oia',
    name: 'Oia Caldera',
    tag: 'Clifftop circuit · 2 laps · sunset',
    blurb: 'Along the rim of the caldera at sunset, the white houses and blue domes stacked down the cliff: esses along the top, a switchback down towards the sea and back, then the long run past the windmills.',
    theme: 'coast',
    seed: 5119,
    width: 11,
    relief: 60,
    tilt: [0.55, 0],
    water: 0,
    laps: 2,
    points: [
      [0, 162, 0], [0, 162.8, -36.7], [0, 163.4, -73.3], [0, 163.7, -110], [0, 163.7, -146.7], [0, 163.4, -183.3],
      [0, 162.8, -220], [-0.5, 162.6, -228.5], [-2.1, 162.4, -236.9], [-4.6, 162.2, -245.1], [-8.2, 162, -252.9], [-12.7, 161.8, -260.2],
      [-18, 161.6, -266.8], [-24.1, 161.4, -272.8], [-30.9, 161.1, -278], [-38.2, 160.9, -282.4], [-46.1, 160.6, -285.8], [-53.5, 160.4, -289],
      [-60.6, 160.1, -293.1], [-67.1, 159.9, -297.9], [-73, 159.6, -303.5], [-78.3, 159.4, -309.8], [-82.7, 159.1, -316.6], [-86.4, 158.9, -323.8],
      [-89.2, 158.6, -331.5], [-91.1, 158.4, -339.4], [-98, 157.2, -378.8], [-104.9, 156.3, -418.2], [-111.9, 155.7, -457.6], [-114, 155.6, -465.8],
      [-117.4, 155.5, -473.7], [-121.9, 155.4, -480.9], [-127.5, 155.4, -487.3], [-134.1, 155.3, -492.8], [-141.4, 155.3, -497.2], [-149.3, 155.3, -500.4],
      [-157.6, 155.3, -502.4], [-166.1, 155.3, -503], [-203.7, 155.7, -503], [-241.4, 156.2, -503], [-279, 157, -503], [-316.7, 157.9, -503],
      [-354.3, 158.8, -503], [-392, 159.6, -503], [-429.6, 160.3, -503], [-467.3, 160.8, -503], [-505, 161, -503], [-542.6, 160.9, -503],
      [-580.3, 160.5, -503], [-617.9, 159.8, -503], [-655.6, 158.8, -503], [-664.4, 158.6, -502.2], [-672.8, 158.3, -499.6], [-680.6, 158, -495.4],
      [-687.4, 157.8, -489.8], [-693, 157.5, -483], [-697.2, 157.2, -475.2], [-699.7, 156.9, -466.8], [-700.6, 156.6, -458], [-700.6, 155.2, -419.2],
      [-700.6, 153.8, -380.4], [-700.6, 152.5, -341.5], [-700.6, 151.3, -302.7], [-700.6, 150.2, -263.9], [-700.6, 149.2, -225.1], [-700.6, 148.3, -186.2],
      [-700.6, 147.4, -147.4], [-700.6, 146.6, -108.6], [-700.6, 145.6, -69.8], [-700.6, 144.6, -30.9], [-700.6, 143.4, 7.9], [-700.6, 141.9, 46.7],
      [-700.6, 140.3, 85.6], [-700.6, 138.5, 124.4], [-700.6, 136.6, 163.2], [-699.7, 136.2, 171.7], [-696.9, 135.8, 179.9], [-692.6, 135.4, 187.2],
      [-686.7, 134.9, 193.5], [-679.6, 134.5, 198.4], [-671.7, 134.1, 201.6], [-663.3, 133.7, 203.1], [-654.7, 133.2, 202.8], [-646.4, 132.8, 200.6],
      [-638.8, 132.4, 196.7], [-632.1, 132, 191.3], [-626.8, 131.7, 184.6], [-623, 131.3, 176.9], [-610.5, 129.9, 142.4], [-597.9, 128.7, 108],
      [-585.4, 128, 73.5], [-581.6, 127.9, 65.8], [-576.3, 127.8, 59.1], [-569.6, 127.7, 53.7], [-562, 127.7, 49.8], [-553.7, 127.6, 47.6],
      [-545.1, 127.6, 47.3], [-536.7, 127.7, 48.8], [-528.7, 127.7, 52], [-521.7, 127.8, 56.9], [-515.8, 127.9, 63.2], [-511.4, 128, 70.5],
      [-508.7, 128.2, 78.7], [-507.8, 128.4, 87.2], [-507.8, 129.3, 122.2], [-507.8, 130.7, 157.2], [-507.8, 132.3, 192.2], [-507.8, 134.1, 227.2],
      [-507.3, 134.6, 236.2], [-505.8, 135.1, 245], [-503.3, 135.6, 253.6], [-499.9, 136.1, 261.9], [-495.5, 136.7, 269.8], [-490.3, 137.2, 277.1],
      [-484.4, 137.7, 283.8], [-477.7, 138.2, 289.8], [-470.3, 138.8, 294.9], [-462.5, 139.3, 299.3], [-454.2, 139.8, 302.7], [-445.6, 140.3, 305.2],
      [-436.7, 140.8, 306.7], [-427.8, 141.4, 307.2], [-387.8, 143.5, 307.2], [-347.8, 145.5, 307.2], [-307.8, 147.2, 307.2], [-267.8, 148.6, 307.2],
      [-227.8, 149.9, 307.2], [-218.8, 150.1, 306.5], [-210.1, 150.4, 304.5], [-201.8, 150.6, 301.3], [-194, 150.9, 296.8], [-187, 151.1, 291.2],
      [-180.9, 151.3, 284.6], [-175.8, 151.5, 277.2], [-171.3, 151.7, 270.8], [-165.8, 151.9, 265.2], [-159.4, 152.1, 260.7], [-152.2, 152.2, 257.4],
      [-114.7, 153.1, 243.7], [-77.1, 154.1, 230.1], [-39.5, 155.1, 216.4], [-32, 155.3, 213.1], [-25.1, 155.5, 208.8], [-18.8, 155.8, 203.6],
      [-13.3, 156, 197.7], [-8.6, 156.2, 191], [-4.9, 156.5, 183.8], [-2.2, 156.7, 176.1], [-0.6, 157, 168.1], [-0, 157.2, 160],
      [-0, 158.4, 120], [-0, 159.7, 80], [-0, 160.9, 40],
    ],
  },
  chefchaouen: {
    id: 'chefchaouen',
    name: 'Chefchaouen Medina',
    tag: 'Blue city circuit · 2 laps · steep hairpins',
    blurb: 'The blue city on the mountainside, and the hardest round: up a stack of hairpins between the blue-washed walls, a narrow esse past the square, then the steep, fast drop out of the old town back to the line.',
    theme: 'coast',
    seed: 5123,
    width: 10,
    relief: 220,
    tilt: [0, -0.25],
    laps: 2,
    points: [
      [0, 321, 0], [0, 321, -36.7], [0, 320.6, -73.3], [0, 319.9, -110], [0, 318.9, -146.7], [0, 317.7, -183.3],
      [0, 316.2, -220], [1, 315.8, -228.9], [4, 315.4, -237.4], [8.7, 315, -244.9], [15.1, 314.5, -251.3], [22.6, 314.1, -256],
      [31.1, 313.6, -259], [40, 313.2, -260], [76.7, 311.2, -260], [113.3, 309.2, -260], [150, 307.1, -260], [158.8, 306.6, -261],
      [167.2, 306, -264.1], [174.6, 305.5, -269.1], [180.7, 305, -275.6], [185.1, 304.5, -283.3], [187.5, 303.9, -291.9], [187.9, 303.4, -300.8],
      [186.2, 302.9, -309.5], [182.5, 302.3, -317.7], [177, 301.8, -324.7], [170.1, 301.3, -330.3], [162, 300.7, -334], [153.3, 300.2, -335.9],
      [120.9, 298.3, -338.7], [88.6, 296.3, -341.5], [56.2, 294.4, -344.4], [23.8, 292.5, -347.2], [15.1, 292, -349], [7, 291.5, -352.8],
      [0.1, 291, -358.4], [-5.4, 290.5, -365.4], [-9.1, 290, -373.5], [-10.8, 289.5, -382.2], [-10.4, 289, -391.1], [-7.9, 288.5, -399.7],
      [-3.6, 288, -407.5], [2.5, 287.5, -414], [9.9, 287.1, -418.9], [18.3, 286.6, -422], [27.1, 286.1, -423], [62.8, 284.4, -423],
      [98.5, 282.7, -423], [134.3, 281.2, -423], [170, 280, -423], [205.7, 278.9, -423], [241.4, 278.1, -423], [277.1, 277.7, -423],
      [285.7, 277.6, -422], [293.7, 277.6, -418.8], [300.8, 277.5, -413.8], [306.4, 277.5, -407.3], [310.2, 277.5, -399.5], [312, 277.6, -391.1],
      [315.4, 278, -351.7], [318.9, 278.8, -312.2], [322.3, 280, -272.8], [325.8, 281.5, -233.4], [329.2, 283.4, -193.9], [332.7, 285.5, -154.5],
      [336.1, 287.7, -115.1], [339.6, 290, -75.6], [343, 292.2, -36.2], [346.5, 294.4, 3.2], [349.9, 296.3, 42.6], [353.4, 298, 82.1],
      [356.8, 299.4, 121.5], [360.3, 300.5, 160.9], [361.9, 300.7, 169.1], [365.1, 300.9, 176.8], [369.9, 301.1, 183.7], [376.1, 301.2, 189.4],
      [383.2, 301.4, 193.7], [390.4, 301.5, 198], [396.5, 301.6, 203.7], [401.3, 301.7, 210.6], [404.6, 301.8, 218.3], [406.2, 301.9, 226.5],
      [409.7, 302.2, 266.3], [413.1, 302.3, 306.2], [416.6, 302.3, 346], [416.2, 302.3, 354.3], [413.5, 302.3, 362.1], [408.9, 302.3, 368.9],
      [402.5, 302.3, 374.2], [394.9, 302.3, 377.5], [386.7, 302.3, 378.6], [346.7, 302.4, 378.6], [306.7, 302.6, 378.6], [266.7, 303.1, 378.6],
      [226.7, 303.8, 378.6], [218.2, 304, 378.3], [209.7, 304.2, 377.3], [201.4, 304.4, 375.7], [193.2, 304.7, 373.4], [185.1, 304.9, 370.5],
      [177.4, 305.2, 366.9], [169.9, 305.4, 362.8], [162.8, 305.7, 358.1], [156, 306, 352.9], [131.3, 307.2, 332.1], [106.5, 308.5, 311.3],
      [81.7, 310, 290.5], [56.9, 311.5, 269.7], [32.1, 313, 248.9], [25.7, 313.4, 243], [19.9, 313.8, 236.5], [14.8, 314.2, 229.5],
      [10.4, 314.6, 221.9], [6.7, 315, 214], [3.8, 315.4, 205.8], [1.7, 315.8, 197.3], [0.4, 316.2, 188.7], [0, 316.5, 180],
      [0, 317.9, 144], [0, 319.1, 108], [0, 320, 72], [0, 320.7, 36],
    ],
  },
  // A road in the sky (2026-11-10: "a new map that doesn't have walls ... just like a floating road, and if you fall off
  // the side, you lose all your speed and respawn in the middle of the road"). `sky`: no barriers, nothing under it.
  // Laid out as straights and arcs closed exactly (like the sprint rings): the line 120 m up a 410 m straight into a 35 m hairpin, back
  // down beside it with 70 m of air between, a left away east, two rights onto the back straight, a flick, and a
  // right onto the line. 1.94 km a lap, 600 m up, rising and falling ~20 m round the lap.
  kumo: {
    id: 'kumo',
    name: 'Kumo Skyway',
    tag: 'Sky road · 3 laps · no walls',
    blurb: 'A ribbon of road floating above the clouds, with no barriers and nothing underneath: a long straight into a hairpin, a fast flick on the back straight and sweepers that open onto the void. Run wide and you fall, losing all your speed before you are put back on the road.',
    theme: 'alpine',
    seed: 3331,
    width: 14,
    relief: 0,
    laps: 3,
    sky: true,
    points: [
      [0, 622.4, -121], [0, 622.9, -133], [0, 623.3, -145], [0, 623.7, -158], [0, 624.1, -170], [0, 624.4, -182],
      [0, 624.7, -194], [0, 625, -206], [0, 625.2, -218], [0, 625.5, -230], [0, 625.7, -242], [0, 625.9, -255],
      [0, 626, -267], [0, 626.2, -279], [0, 626.3, -291], [0, 626.4, -303], [0, 626.5, -315], [0, 626.6, -327],
      [0, 626.7, -339], [0, 626.8, -352], [0, 626.9, -364], [0, 627, -376], [0, 627, -388], [0, 627.1, -400],
      [0, 627.2, -412], [2, 627.3, -424], [8, 627.4, -435], [18, 627.5, -442], [29, 627.6, -447], [41, 627.7, -447],
      [53, 627.9, -442], [62, 628, -435], [68, 628.2, -424], [70, 628.4, -412], [70, 628.5, -401], [70, 628.7, -389],
      [70, 628.9, -377], [70, 629.1, -366], [70, 629.4, -354], [70, 629.6, -343], [70, 629.9, -331], [70, 630.1, -320],
      [70, 630.4, -308], [70, 630.7, -297], [70, 631, -285], [70, 631.3, -274], [70, 631.6, -262], [71, 631.9, -250],
      [74, 632.2, -238], [79, 632.5, -227], [86, 632.8, -217], [95, 633.2, -208], [105, 633.4, -201], [116, 633.7, -196],
      [128, 634, -193], [140, 634.3, -192], [152, 634.5, -192], [164, 634.7, -192], [175, 634.9, -192], [187, 635.1, -192],
      [199, 635.2, -192], [211, 635.3, -192], [222, 635.4, -192], [234, 635.4, -192], [246, 635.4, -192], [258, 635.4, -192],
      [270, 635.3, -192], [281, 635.2, -192], [293, 635.1, -192], [305, 634.9, -192], [317, 634.6, -192], [329, 634.4, -192],
      [340, 634, -192], [352, 633.7, -192], [364, 633.3, -192], [376, 632.8, -192], [387, 632.3, -192], [399, 631.7, -192],
      [411, 631.2, -192], [423, 630.5, -192], [435, 629.9, -192], [446, 629.1, -192], [458, 628.4, -192], [470, 627.6, -192],
      [483, 626.7, -191], [495, 625.8, -188], [506, 624.9, -183], [517, 623.9, -177], [527, 622.9, -169], [535, 621.8, -159],
      [541, 620.8, -148], [546, 619.7, -137], [549, 618.6, -125], [550, 617.5, -112], [550, 616.5, -100], [550, 615.4, -87],
      [550, 614.3, -75], [550, 613.2, -62], [549, 612.2, -50], [547, 611.2, -39], [543, 610.2, -28], [538, 609.3, -17],
      [531, 608.3, -7], [524, 607.4, 2], [515, 606.6, 9], [505, 605.7, 16], [494, 604.9, 21], [483, 604.1, 25],
      [472, 603.4, 27], [460, 602.7, 28], [448, 602.1, 28], [436, 601.5, 28], [424, 601, 28], [413, 600.5, 28],
      [401, 600.1, 28], [389, 599.7, 28], [377, 599.4, 28], [365, 599.1, 28], [353, 598.9, 28], [341, 598.8, 28],
      [329, 598.7, 28], [318, 598.6, 28], [306, 598.7, 28], [293, 598.7, 29], [281, 598.9, 31], [269, 599.1, 36],
      [258, 599.4, 42], [248, 599.7, 49], [238, 600.1, 56], [227, 600.5, 62], [215, 601, 67], [203, 601.5, 69],
      [190, 602.1, 70], [178, 602.7, 70], [166, 603.3, 70], [154, 604, 70], [142, 604.7, 70], [130, 605.4, 70],
      [118, 606.1, 70], [106, 606.9, 70], [94, 607.6, 70], [82, 608.4, 70], [70, 609.2, 70], [58, 610, 69],
      [46, 610.8, 66], [35, 611.6, 61], [25, 612.4, 54], [16, 613.2, 45], [9, 614, 35], [4, 614.8, 24],
      [1, 615.6, 12], [0, 616.3, 0], [0, 617, -12], [0, 617.7, -24], [0, 618.4, -36], [0, 619.1, -48],
      [0, 619.7, -61], [0, 620.3, -73], [0, 620.9, -85], [0, 621.4, -97], [0, 621.9, -109],
    ],
  },
  // The battle royale's arena (2026-11-12, Michael: "a battle royale type in Toge where each lap the last person gets
  // killed. Do laps til one left. Make a cool custom map for it"). A short sky road at night under a red moon, so a lap
  // is ~35 s and every mistake is a fall: the line 110 m up the main straight into a 44 m hairpin, a left-right onto
  // the far side, a flick, two fast rights round the back and the long run to the line (185 m, so the boost pad off
  // the last corner comes after the grid; see boost.ts). `royale`: only the Battle
  // royale mode runs it (protocol.ts modeTracks), 7 laps so a full grid of 8 has a lap for every elimination.
  // Laid out as straights and arcs closed exactly (like Kumo), hills as two sine waves round the lap.
  shura: {
    id: 'shura',
    name: 'Shura Sky Arena',
    tag: 'Battle royale · sky road · last place out every lap',
    blurb: 'A neon ring of road hung in the night sky under a red moon. No walls, no mercy: every lap the car in last place is destroyed, until one is left. Fall off and you lose everything you had on the pack.',
    theme: 'night',
    seed: 6661,
    width: 14,
    relief: 0,
    laps: 7,
    sky: true,
    royale: true,
    points: [
      [0, 642.1, 0], [0, 643, -12.2], [0, 643.8, -24.4], [0, 644.6, -36.7], [0, 645.3, -48.9], [0, 645.9, -61.1],
      [0, 646.4, -73.3], [0, 646.9, -85.6], [0, 647.2, -97.8], [0, 647.4, -110], [1.1, 647.4, -119.8], [4.4, 647.4, -129.1],
      [9.6, 647.3, -137.4], [16.6, 647.1, -144.4], [24.9, 646.9, -149.6], [34.2, 646.5, -152.9], [44, 646.1, -154], [53.8, 645.6, -152.9],
      [63.1, 645, -149.6], [71.4, 644.4, -144.4], [78.4, 643.8, -137.4], [83.6, 643.1, -129.1], [86.9, 642.4, -119.8], [88, 641.6, -110],
      [88, 640.7, -97.5], [88, 639.8, -85], [88, 638.9, -72.5], [88, 638, -60], [88, 637.2, -47.5], [88, 636.4, -35],
      [89.1, 635.9, -25.2], [92.4, 635.5, -15.9], [97.6, 635.1, -7.6], [104.6, 634.8, -0.6], [112.9, 634.6, 4.6], [122.2, 634.4, 7.9],
      [132, 634.3, 9], [141.8, 634.3, 10.3], [151, 634.4, 14.1], [158.9, 634.6, 20.1], [164.9, 634.8, 28], [168.7, 635.1, 37.2],
      [170, 635.4, 47], [170, 635.8, 57], [170, 636.3, 67], [170, 636.7, 77], [170.8, 637.2, 86.7], [173.2, 637.8, 96.2],
      [177, 638.3, 105.2], [180.9, 638.8, 114.1], [183.3, 639.3, 123.6], [184, 639.8, 133.3], [184, 640.5, 147.2], [184, 641.1, 161.1],
      [184, 641.6, 175], [183.2, 641.9, 184.6], [180.7, 642.2, 193.8], [176.7, 642.4, 202.5], [171.2, 642.5, 210.4], [164.4, 642.6, 217.1],
      [156.5, 642.6, 222.6], [147.9, 642.5, 226.7], [138.6, 642.4, 229.2], [129, 642.2, 230], [117, 641.9, 230], [105, 641.5, 230],
      [93, 641.1, 230], [81, 640.5, 230], [69, 640, 230], [57, 639.4, 230], [45, 638.8, 230], [35, 638.3, 228.9],
      [25.5, 637.8, 225.5], [16.9, 637.4, 220.2], [9.8, 636.9, 213.1], [4.5, 636.6, 204.5], [1.1, 636.2, 195], [0, 635.9, 185],
      [0, 635.6, 172.7], [0, 635.5, 160.3], [0, 635.4, 148], [0, 635.4, 135.7], [0, 635.6, 123.3], [0, 635.8, 111],
      [0, 636.2, 98.7], [0, 636.7, 86.3], [0, 637.3, 74], [0, 638, 61.7], [0, 638.7, 49.3], [0, 639.5, 37],
      [0, 640.4, 24.7], [0, 641.2, 12.3],
    ],
  },
  toge: {
    id: 'toge',
    name: 'Toge',
    tag: 'Open world: a mountain, a harbour city and an expressway round the island',
    blurb: 'No start, no finish. Cruise the Ring Expressway, carve the hairpins up Tōge Pass, fly the crests of the Kita Descent and the old airfield, and meet up at the harbour.',
    theme: 'coast',
    seed: 4127,
    world: true,
    // The menu map's outline: the expressway ring.
    points: [
      [2330, 9, 520],
      [2340, 9, -900],
      [2330, 12, -1500],
      [1600, 0, -2120],
      [200, 0, -2280],
      [-1150, 0, -2120],
      [-2250, 0, -1350],
      [-2700, 0, 0],
      [-2050, 0, 1300],
      [-650, 0, 1480],
      [180, 22, 980],
      [520, 22, 640],
      [1250, 12, 540],
      [2150, 9, 620],
    ],
    width: 24.8,
    relief: 0,
    water: 0,
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

/** Centripetal Catmull-Rom through the points, densely sampled (`closed`: round and back to the first). */
export function spline(pts: P3[], closed = false): P3[] {
  const out: P3[] = [];
  const knot = (a: P3, b: P3) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) || 1e-4;
  const N = pts.length;
  const at = (i: number) => (closed ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
  for (let i = 0; i < (closed ? N : N - 1); i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
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
  out.push(closed ? pts[0] : pts[N - 1]);
  return out;
}

/** `m` points evenly spaced round a closed polyline (its last point is its first). */
function ring(dense: P3[]): P3[] {
  let len = 0;
  for (let i = 0; i < dense.length - 1; i++) len += Math.hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][2] - dense[i][2]);
  const m = Math.round(len / SAMPLE);
  const out: P3[] = [];
  let acc = 0;
  for (let i = 0; i < dense.length - 1 && out.length < m; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    while (out.length < m && (out.length * len) / m <= acc + l) {
      const f = l > 0 ? ((out.length * len) / m - acc) / l : 0;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
    acc += l;
  }
  return out;
}

/** On a circuit, makes `a` repeat every lap exactly: each sample takes its value from the second lap, which is
 * far enough from both ends of the unrolled road that end effects (smoothing, the speed profile) never reach it. */
function retile(a: Float64Array, lap: number, pre: number) {
  for (let i = 0; i < a.length; i++) a[i] = a[pre + lap + ((((i - pre) % lap) + lap) % lap)];
}

export function smooth(a: Float64Array, radius: number, passes: number) {
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
  if (!t) cache.set(id, (t = TRACK_DEFS[id].world ? worldTrack(TRACK_DEFS[id]) : buildTrack(TRACK_DEFS[id])));
  return t;
}

/** Every race track: all but the open world (free roam's island, which has no start or finish). */
export const RACE_TRACKS = (Object.keys(TRACK_DEFS) as TrackId[]).filter((id) => !TRACK_DEFS[id].world);

export function buildTrack(def: TrackDef): Track {
  const pts = def.points;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  // A circuit: one lap of samples from the start line, unrolled (the run-up is the end of the lap before).
  const laps = def.laps ?? 0;
  let lap = 0;
  const pre = Math.ceil(LAP_PRE / SAMPLE);
  if (laps) {
    if (laps < 2 || def.features?.length) throw new Error(`${def.id}: a circuit needs 2+ laps and no features`);
    const one = ring(spline(pts, true));
    lap = one.length;
    const total = pre + laps * lap + Math.ceil(RUNOFF / SAMPLE) + 1;
    for (let i = 0; i < total; i++) {
      const p = one[(((i - pre) % lap) + lap) % lap];
      xs.push(p[0]);
      ys.push(p[1]);
      zs.push(p[2]);
    }
  } else roadSamples(pts, xs, ys, zs);
  const n = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const z = Float64Array.from(zs);
  smooth(y, 18, 3); // no steps in the grade, even through hairpins
  if (lap) retile(y, lap, pre);
  const cross = def.overpass ? crossing(def, x, y, z, lap, pre) : null;
  const first = pts[0];
  const last = pts[pts.length - 1];
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
  const bumps: { s0: number; s1: number }[] = [];
  for (const f of def.features ?? []) {
    if (f.kind === 'crest') {
      const at = nearestS(pts[f.at]);
      crests.push({ s: at, len: f.len });
      for (let i = 0; i < n; i++) {
        const u = (i * SAMPLE - at) / (f.len / 2);
        if (Math.abs(u) < 1) y[i] += (f.size * (1 + Math.cos(Math.PI * u))) / 2;
      }
    } else if (f.kind === 'bumps') {
      const a = nearestS(pts[f.from]);
      const b = nearestS(pts[f.to]);
      const s0 = Math.min(a, b);
      const s1 = Math.max(a, b);
      bumps.push({ s0, s1 });
      // Two out-of-step waves (14 m and 23 m) and a slow swell of their size: heaves that never repeat evenly,
      // easing in and out over the first and last 30 m.
      for (let i = Math.floor(s0 / SAMPLE); i <= Math.min(n - 1, Math.ceil(s1 / SAMPLE)); i++) {
        const u = i * SAMPLE;
        const w = smoothstep(s0, s0 + 30, u) * (1 - smoothstep(s1 - 30, s1, u));
        const swell = 0.6 + 0.4 * Math.sin(u / 37 + def.seed);
        y[i] += f.size * w * swell * (0.62 * Math.sin((u * 2 * Math.PI) / 14) + 0.38 * Math.sin((u * 2 * Math.PI) / 23 + 1.3));
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
  if (lap) for (const a of [tx, tz, curv]) retile(a, lap, pre);
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = Math.max(-0.07, Math.min(0.07, curv[i] * 3));

  const half = def.width / 2;
  const shoulder = def.sky ? SKY.lip : def.walled ? 0 : SHOULDER;
  // A sky road ends at its lip: no verge, no barrier, no plane past it.
  const rail = def.sky ? half + SKY.lip : def.walled ? half + WALL_GAP : half + SHOULDER + VERGE;
  // (A sky road's plane runs a hair past the lip, so a wheel on the lip's very edge never finds the abyss in a bend.)
  const edge = rail + (def.sky ? 0.25 : EDGE_PAD);
  const startS = lap ? pre * SAMPLE : nearestS(first);
  const finishS = lap ? startS + laps * lap * SAMPLE : nearestS(last);
  const [runL, runR] = runoff(def, n, x, z, curv, spans, crests, edge, startS, finishS, lap, pre);
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
  // every stretch of road that can shape the ground at a point. A circuit lists one lap (samples 1..lap, so
  // every listed sample has a segment either side).
  const reach = edgeMax + BLEND + SAMPLE + SOFTMIN * 4; // the smooth minimum reads a little short of the true one
  const lists = new Map<number, number[]>();
  const h0 = lap ? 1 : 0;
  const h1 = lap ? lap + 1 : n;
  for (let i = h0; i < h1; i++) {
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
      for (let i = h0; i < h1; i += 4) {
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
    lap,
    half,
    shoulder,
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
    bumps,
    gravel,
    props: [],
    boosts: [],
    cuts: [],
    cross,
  };
  if (def.sky) t.abyss = Math.min(...y) - SKY.abyss;
  for (const f of def.features ?? []) if (f.kind === 'cut') t.cuts.push(makeCut(t, f.s0, f.s1));
  // Boost pads keep off jumps, tunnels and the mouths of shortcuts (props then keep off the pads).
  t.boosts = placeBoosts(t, (s0, s1) =>
    t.crests.some((c) => s1 > c.s - c.len - 20 && s0 < c.s + c.len + 30) ||
    t.spans.some((sp) => sp.kind === 'tunnel' && s1 > sp.s0 - 20 && s0 < sp.s1 + 20) ||
    t.cuts.some((c) => [c.s0, c.s1].some((e) => s1 > e - 30 && s0 < e + 30)),
  );
  if (lap || def.clean) return t; // circuits and clean passes: no obstacles
  t.props = placeProps(t);
  return t;
}
/**
 * Finds where a figure 8's lap crosses itself, raises the first pass over it (a raised cosine, so the grade
 * stays gentle) and dips the second under it, and flags the samples of each stretch. Every lap alike.
 */
function crossing(def: TrackDef, x: Float64Array, y: Float64Array, z: Float64Array, lap: number, pre: number): Crossing {
  if (!lap) throw new Error(`${def.id}: only a circuit can cross itself`);
  // The closest two samples of one lap that aren't neighbours along it.
  const L = pre + lap; // the second lap (clear of the ends)
  let bd = Infinity;
  let pa = 0;
  let pb = 0;
  for (let i = 0; i < lap; i++)
    for (let j = i + 60; j < lap - 60 + i && j < lap; j++) {
      const d = (x[L + i] - x[L + j]) ** 2 + (z[L + i] - z[L + j]) ** 2;
      if (d < bd) {
        bd = d;
        pa = i;
        pb = j;
      }
    }
  if (bd > 4 * SAMPLE * SAMPLE) throw new Error(`${def.id}: a figure 8 has to cross itself`);
  const n = x.length;
  // Lap distance (m) between sample i and lap position p.
  const gap = (i: number, p: number) => {
    const k = Math.abs((((i - pre) % lap) + lap) % lap - p);
    return Math.min(k, lap - k) * SAMPLE;
  };
  const deck = new Uint8Array(n);
  const up = new Uint8Array(n);
  const low = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = gap(i, pa);
    const b = gap(i, pb);
    if (a < OVERPASS.ramp) y[i] += (def.overpass! * (1 + Math.cos((Math.PI * a) / OVERPASS.ramp))) / 2;
    if (b < OVERPASS.rampUnder) y[i] -= (OVERPASS.dip * (1 + Math.cos((Math.PI * b) / OVERPASS.rampUnder))) / 2;
    deck[i] = a < OVERPASS.deck ? 1 : 0;
    up[i] = a < OVERPASS.over ? 1 : 0;
    low[i] = b < OVERPASS.under ? 1 : 0;
  }
  const i0 = pre + pa - OVERPASS.deck / SAMPLE;
  const i1 = pre + pa + OVERPASS.deck / SAMPLE;
  if (i0 < 1 || i1 > lap) throw new Error(`${def.id}: put the start line farther from the bridge`);
  return { x: (x[L + pa] + x[L + pb]) / 2, z: (z[L + pa] + z[L + pb]) / 2, deck, up, low, i0, i1, over: pre + pa };
}

/** A point-to-point road's centreline: a straight run-up to the start, the points, a straight runoff past the finish. */
function roadSamples(pts: P3[], xs: number[], ys: number[], zs: number[]) {
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
  edge: number, startS: number, finishS: number, lap: number, pre: number,
): [Float64Array, Float64Array] {
  // A walled road has no runoff: the wall is the price of a missed braking point. A sky road has nothing to run off onto.
  if (def.walled || def.sky) return [new Float64Array(n), new Float64Array(n)];
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
  if (lap) for (let s = startS; s <= finishS; s += lap * SAMPLE) clear(s - 20, s + 30); // the line, every lap
  else {
    clear(0, startS + 30);
    clear(finishS - 20, n * SAMPLE);
  }
  smooth(keep, 10, 3);
  // Never so wide that the road's planes of two legs come within 40 m (tests/racephysics checks it). On a
  // circuit, the same place a lap later is the same leg.
  const apart = (i: number, j: number) => {
    const k = Math.abs(i - j);
    return (lap ? Math.min(k % lap, lap - (k % lap)) : k) > 50;
  };
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = Infinity;
    for (let j = 0; j < n; j++) if (apart(i, j)) c = Math.min(c, (x[i] - x[j]) ** 2 + (z[i] - z[j]) ** 2);
    cap[i] = Math.max(0, (Math.sqrt(c) - 40) / 2 - edge - 1);
  }
  for (const a of [L, R]) {
    for (let i = 0; i < n; i++) a[i] = Math.min(a[i], cap[i]);
    // Ease in and out over ~60 m, so the barrier never kinks toward a car.
    smooth(a, 10, 3);
    for (let i = 0; i < n; i++) a[i] = keep[i] < 1e-3 || a[i] < 0.01 ? 0 : Math.min(a[i] * keep[i], cap[i]); // (the running sum leaves crumbs)
    if (lap) retile(a, lap, pre); // the same barrier every lap
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
export const dirtFrom = (t: Track, r: number) => (r < 0.05 ? Infinity : Math.max(t.half + t.shoulder, t.rail - r));

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
  if (t.world) return t.world.locate(x, z, hint, out);
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
    // At a figure 8's crossing, keep to the road the car is on.
    const c = t.cross;
    const skip = c && hint >= 0 ? (c.up[hint] ? c.low : c.low[hint] ? c.up : null) : null;
    if (list)
      for (const i of list) {
        if (skip && skip[i]) continue;
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
    // The hash holds one lap: keep to the lap the car is on.
    if (t.lap && hint >= 0) bi = Math.max(0, Math.min(t.n - 1, bi + t.lap * Math.round((hint - bi) / t.lap)));
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
export function heightAt(t: Track, x: number, z: number, onRoad?: Loc, hint = -1): number {
  if (t.world) return t.world.height(x, z, hint, onRoad);
  roadHit = false;
  const h = roadHeight(t, x, z, onRoad, hint);
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

function roadHeight(t: Track, x: number, z: number, onRoad: Loc | undefined, hint: number): number {
  const list = t.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  roadDist = Infinity;
  if (!list) return t.abyss ?? terrainAt(t, x, z);
  const L = list.length;
  if (d2s.length < L) d2s = new Float64Array(L * 2);
  // A figure 8's crossing: the layer the hint is on leaves the other one out (see Crossing).
  const skip = t.cross ? (hint >= 0 && t.cross.up[hint] ? t.cross.low : t.cross.deck) : null;
  let dmin2 = Infinity;
  let imin = -1;
  for (let k = 0; k < L; k++) {
    const i = list[k];
    if (skip && skip[i]) {
      d2s[k] = Infinity;
      continue;
    }
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
      return roadY(t, pieceLoc);
    }
  }
  // A sky road: off its edge there's no ground at all.
  if (t.abyss !== undefined) return t.abyss;
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
    let along = rx * t.tx[i] + rz * t.tz[i];
    // Never carry a stretch's plane on past where the road leaves this layer (a bridge's ends), or the ground
    // would ramp on up to nothing.
    if (skip) {
      const dir = along > 0 ? 1 : -1;
      for (let k = 1; k * SAMPLE < Math.abs(along) + SAMPLE && k < 24; k++)
        if (skip[Math.max(0, Math.min(t.n - 1, i + dir * k))]) {
          along = dir * Math.min(Math.abs(along), k * SAMPLE);
          break;
        }
    }
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
export function groundAt(t: Track, x: number, z: number, out: Ground, hint = -1): Ground {
  if (t.world) return t.world.ground(x, z, out, hint);
  tmpLoc.i = -1;
  const h = heightAt(t, x, z, tmpLoc, hint);
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
    out.surf =
      ad > t.half + t.shoulder ? (ad >= dirtFrom(t, runoffAt(t, tmpLoc.s, tmpLoc.d)) ? 'dirt' : 'grass') : t.gravel[tmpLoc.i] ? 'gravel' : ad <= t.half ? 'asphalt' : 'shoulder';
    return out;
  }
  const e = 0.6;
  const hx = heightAt(t, x + e, z, undefined, hint);
  const hz = heightAt(t, x, z + e, undefined, hint);
  const nx = -(hx - h) / e;
  const nz = -(hz - h) / e;
  const l = Math.hypot(nx, 1, nz);
  out.nx = nx / l;
  out.ny = 1 / l;
  out.nz = nz / l;
  out.surf = onCut(t, x, z) ? 'gravel' : 'grass';
  return out;
}

const deckLoc = newLoc();

/**
 * The ground under something at height `y` that has no hint (debris, a dropped wreck): on a figure 8's
 * bridge deck when it's over the deck and above it, otherwise the ground heightAt gives.
 */
export function groundBelow(t: Track, x: number, z: number, y: number): number {
  const h = heightAt(t, x, z);
  const c = t.cross;
  if (!c || (x - c.x) ** 2 + (z - c.z) ** 2 > (OVERPASS.deck + t.edge) ** 2) return h;
  deckLoc.i = -1;
  const top = heightAt(t, x, z, deckLoc, c.over);
  return deckLoc.i >= 0 && c.deck[deckLoc.i] && top > h && y > top - 1 ? top : h;
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

/** The lap a car at distance `s` is on (1..laps), or 0 on a point-to-point road. */
export const lapOf = (t: Track, s: number) => (t.lap ? Math.max(1, Math.min(t.def.laps!, Math.floor((s - t.startS) / (t.lap * SAMPLE)) + 1)) : 0);

/** A circuit as one lap, for drawing it (sample `lap` closes the loop onto sample 0); a road as it is. */
export const lapView = (t: Track): Track => (t.lap ? { ...t, n: t.lap + 1, length: t.lap * SAMPLE, finishS: t.startS } : t);

/** Where grid slot `k` sits: two columns, staggered back from the start line. */
export function gridSlot(t: Track, k: number): { x: number; y: number; z: number; yaw: number; s: number } {
  if (t.world) return worldSlot(t.world.world, k);
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
