import { type Prop, type Ramp, placeProps, rampLift } from './props.ts';

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
export type TrackId = 'koripass' | 'saltwind' | 'redmesa' | 'tsukiyo' | 'momiji' | 'sakura' | 'monza' | 'spa' | 'monaco' | 'neonbay' | 'kodama' | 'karasu' | 'hachi' | 'nagare';
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
  /** Four lanes of two-way traffic to dodge (traffic.ts). */
  traffic?: boolean;
  /**
   * A hill climb (the lobby's Hill climb mode): an uphill run with no item boxes, ramps or cones; boulders and
   * rocks lie on the road's edges instead (props.ts), and the forest crowds right up to the barrier.
   */
  climb?: boolean;
  /**
   * Clean road for time trials: no item boxes, obstacles or ramps (like a circuit), so a run is only you, the
   * line and the clock.
   */
  clean?: boolean;
  /**
   * A figure 8 (circuits only): the lap crosses itself once, and the first pass through the crossing goes over
   * the second on a bridge this many metres up (the leg underneath dips OVERPASS.dip into a cutting). The ground
   * then has two layers there, so ask heightAt / groundAt with the car's `hint` (see Crossing).
   */
  overpass?: number;
  features?: Feature[];
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
  /** Mystery boxes and obstacles (sorted by s), and launch ramps (part of the ground). */
  props: Prop[];
  ramps: Ramp[];
  /** A figure 8's crossing, or null. */
  cross: Crossing | null;
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
function spline(pts: P3[], closed = false): P3[] {
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
  const rail = half + SHOULDER + VERGE;
  const edge = rail + EDGE_PAD;
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
    ramps: [],
    cuts: [],
    cross,
  };
  for (const f of def.features ?? []) if (f.kind === 'cut') t.cuts.push(makeCut(t, f.s0, f.s1));
  if (lap || def.clean) return t; // circuits and clean passes: no item boxes, obstacles or ramps
  const placed = placeProps(t);
  t.props = placed.props;
  t.ramps = placed.ramps;
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
  if (!list) return terrainAt(t, x, z);
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
  tmpLoc.i = -1;
  const h = heightAt(t, x, z, tmpLoc, hint);
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
  const hx = heightAt(t, x + e, z, undefined, hint);
  const hz = heightAt(t, x, z + e, undefined, hint);
  const nx = -(hx - h) / e;
  const nz = -(hz - h) / e;
  const l = Math.hypot(nx, 1, nz);
  out.nx = nx / l;
  out.ny = 1 / l;
  out.nz = nz / l;
  out.surf = onRamp ? 'asphalt' : onCut(t, x, z) ? 'gravel' : 'grass';
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
