// Each car's design: the curves its body is lofted from (see carloft.ts) and a kit of the parts that make
// it itself — lamps, scoops, vents, wings, pipes. Keys are [t, value] with t from 0 (nose) to 1 (tail);
// `top`, `dip` and `roof` are × the car's height, `floor` is metres above the ground.

import * as THREE from 'three';
import type { BaseCar, BikeId, CarId } from '../shared/cars.ts';
import { type Section, centreTop, curve, endZ, heightAt, smooth, surface, zAt } from './carloft.ts';
import { MAT, rbox } from './carparts.ts';

export interface Design {
  top: [number, number][];
  dip: [number, number][];
  floor: [number, number][];
  /** Cabin roof line, from the windscreen base (first key) to the rear glass base (last key). */
  roof: [number, number][];
  roofF: number;
  roofR: number;
  /** t of the B pillar (0: pillarless), and where the side glass ends. */
  bPillar: number;
  cPillar: number;
  /** Cabin half width at the beltline (× half width) and how much it narrows to the roof. */
  cabin: number;
  cabTumble: number;
  /** Plan view (m): pinch at the doors, and how far the arches flare out from there. */
  waist: number;
  flareF: number;
  flareR: number;
  /** Plan rounding at the nose and tail: [length in t, width left at the very end]. */
  nose: [number, number];
  tail: [number, number];
  tumble: number;
  rb: number;
  rt: number;
  /** How far the flank's character line stands proud (m); 0.009 if unset, 0 for none. */
  crease?: number;
  /** Spoilers sit on the roof (hatches) rather than the deck. */
  roofSpoiler?: boolean;
  plate: string;
  plateY: number;
  /** A raked windscreen whose side glass wraps forward under a slim A pillar (else the pillar is the whole
   * rounded corner of the greenhouse, which on a long, low screen paints over the front of the side window). */
  slimA?: boolean;
  /** How far the driver's eyes sit under the roof (m, default `EYE_DROP`), and their t along the car (default:
   * 0.7 m behind the windscreen header, but no further back than 0.2 m past the rear of the roof). */
  eyeDrop?: number;
  eyeT?: number;
  /** How far the driver's seat lies back (rad): a low car needs it, or their legs come out under the floor. */
  recline?: number;
  /** No fuel flap (something else sits on the rear quarter). */
  noFuelFlap?: boolean;
  /** The design carries its own rear wing, so the garage's spoiler option is left off (a cosmetic wing still replaces it). */
  ownWing?: boolean;
  /** The cabin's own trim, inside and as seen through the glass (unset: the stock dark grey). */
  interior?: Interior;
  kit(k: Kit): void;
}

/** Eyes this far under the roof, a fist and a half of headroom. */
export const EYE_DROP = 0.25;

/** The driver's eyes in body space (right-hand drive), shared by the cabin seen from outside and the cockpit camera. */
export function driverEye(d: Design, L: number, W: number, H: number): THREE.Vector3 {
  const roof = curve(d.roof.map(([t, v]) => [t, v * H]));
  const halfTop = W * d.cabin * (1 - d.cabTumble) * 0.9 - 0.04;
  const x = Math.min(0.4, halfTop * 0.5);
  const z = d.eyeT !== undefined ? (d.eyeT - 0.5) * L : Math.min((d.roofF - 0.5) * L + 0.7, (d.roofR - 0.5) * L + 0.2);
  return new THREE.Vector3(x, roof(Math.min(d.roofR, z / L + 0.5)) - (d.eyeDrop ?? EYE_DROP), z);
}

/**
 * A cabin's trim: seat leather and its bolsters, an accent (stitching, belts, the wheel's top marker, the start
 * button), the headliner, carbon on the dash, tunnel and door tops, and a sports wheel (flat bottomed, with
 * shift lights).
 */
export interface Interior {
  seat: number;
  bolster: number;
  accent: number;
  liner: number;
  carbon: boolean;
  sport: boolean;
}

/** What a kit builds with. Positions are body space: ground y = 0, the body's middle z = 0, front -Z. */
export interface Kit {
  b: BaseCar;
  L: number;
  W: number; // half width
  H: number;
  body: Section;
  cabin: Section;
  paint: THREE.Material;
  tail: THREE.Material;
  /** Exhaust pipe and the inside of its mouth (cosmetic exhaust tips swap these). */
  pipe: THREE.Material;
  pipeHole: THREE.Material;
  /** A cosmetic wing is fitted (bodykits.ts): a design's own wing stays off. */
  wing: boolean;
  /** t of the front and rear axles. */
  tF: number;
  tR: number;
  /** Adds a mesh; `mirror` adds its twin on the other side (x and the y/z rotations negated). */
  put(geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], r?: [number, number, number], mirror?: boolean): THREE.Mesh;
  z(t: number): number;
  /** Middle of the body's top (hood / deck) at t. */
  top(t: number): number;
  /** Height of the body's top at t, x from the centre line (fenders stand above the hood). */
  height(t: number, x: number): number;
  side(t: number, v: number, s?: number): THREE.Vector3;
  front(x: number, y: number): number;
  rear(x: number, y: number): number;
  /** `rear` found to a millimetre, for parts laid along the tail in pieces (`rear` steps about a centimetre). */
  rearFine(x: number, y: number): number;
}

export function makeKitHelpers(body: Section) {
  return {
    z: (t: number) => zAt(body, t),
    top: (t: number) => centreTop(body, t),
    height: (t: number, x: number) => heightAt(body, t, x),
    side: (t: number, v: number, s = 1) => surface(body, t, v, s),
    front: (x: number, y: number) => endZ(body, x, y, 1),
    rear: (x: number, y: number) => endZ(body, x, y, -1),
    rearFine: (x: number, y: number) => endZ(body, x, y, -1, true),
  };
}

// ---------------------------------------------------------------------------------------------
// Lamp and trim helpers

const hemi = (r: number) => new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);

/**
 * A round lamp on the nose (dir 1) or tail (dir -1) in a bezel. A headlamp is built like one: a polished
 * reflector bowl, a bulb, and a clear domed glass over them; a tail lamp is a lit red dome in a dark ring.
 */
export function roundLamp(k: Kit, x: number, y: number, r: number, lens: THREE.Material, dir: 1 | -1, bezel: THREE.Material = MAT.chrome) {
  const z = dir > 0 ? k.front(x, y) : k.rear(x, y);
  const out = -dir; // which way along z is out of the car (the nose faces -z)
  k.put(new THREE.TorusGeometry(r, r * 0.16, 8, 28), bezel, [x, y, z + dir * 0.012], [0, 0, 0], true);
  // The lamp's barrel: solid behind a tail lamp, an open tube round a headlamp's bowl.
  k.put(new THREE.CylinderGeometry(r, r, 0.08, 24, 1, lens === MAT.head), MAT.gloss, [x, y, z + dir * 0.03], [Math.PI / 2, 0, 0], true);
  if (lens !== MAT.head) {
    k.put(new THREE.TorusGeometry(r * 0.78, r * 0.08, 6, 24), MAT.redLens, [x, y, z + out * 0.004], [0, 0, 0], true);
    k.put(hemi(r * 0.72), lens, [x, y, z - dir * 0.005], [-dir * Math.PI / 2, 0, 0], true);
    return;
  }
  // A shallow bucket standing proud of the panel (a flush one would sit behind the paint): the polished
  // bowl opening forward from the panel, the bulb with its shield cap, a chrome rim, and the glass dome.
  const depth = r * 0.42;
  const rim = z - dir * (depth + 0.006);
  k.put(new THREE.CylinderGeometry(r * 1.02, r * 1.02, depth + 0.01, 24, 1, true), MAT.gloss, [x, y, z - dir * (depth / 2)], [Math.PI / 2, 0, 0], true);
  const bowl = k.put(hemi(r * 0.96), MAT.reflector, [x, y, rim], [dir * Math.PI / 2, 0, 0], true);
  bowl.scale.y = depth / (r * 0.96);
  k.put(new THREE.SphereGeometry(r * 0.16, 14, 10), MAT.head, [x, y, rim + dir * depth * 0.45], [0, 0, 0], true);
  k.put(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.006, 16), MAT.chrome, [x, y, rim + dir * depth * 0.45 - dir * r * 0.18], [Math.PI / 2, 0, 0], true);
  k.put(new THREE.TorusGeometry(r * 1.01, r * 0.07, 8, 32), MAT.chrome, [x, y, rim], [0, 0, 0], true);
  const glass = k.put(hemi(r * 0.98), MAT.lampGlass, [x, y, rim], [-dir * Math.PI / 2, 0, 0], true);
  glass.scale.y = 0.3;
}

/** A projector: a chrome cup with a lit lens in it, facing along `r`'s +y (out of a lamp housing). */
export function projector(k: Kit, p: [number, number, number], r: [number, number, number], size: number) {
  k.put(new THREE.CylinderGeometry(size, size * 0.8, size * 0.6, 18, 1, true), MAT.reflector, p, r, true);
  k.put(new THREE.CylinderGeometry(size * 0.62, size * 0.62, size * 0.5, 18), MAT.head, p, r, true);
}

/**
 * A slim headlight lying on the nose from (x0, t0) to (x1, t1): a dark gloss slab following the surface,
 * two projector lenses in it and a light strip along its front edge.
 */
export function slitLamp(k: Kit, x0: number, t0: number, x1: number, t1: number, depth: number) {
  const p = (x: number, t: number) => new THREE.Vector3(x, k.height(t, x), k.z(t));
  const p0 = p(x0, t0);
  const p1 = p(x1, t1);
  const xm = (x0 + x1) / 2;
  const tm = (t0 + t1) / 2;
  const back = p(xm, tm + 0.01).sub(p(xm, tm - 0.01)).normalize();
  const a = p1.clone().sub(p0);
  const len = a.length();
  a.normalize();
  const n = new THREE.Vector3().crossVectors(back, a).normalize();
  if (n.y + -n.z < 0) n.negate(); // out of the surface: up and forward
  const s = new THREE.Vector3().crossVectors(a, n).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, n, s), 'XYZ');
  const r: [number, number, number] = [e.x, e.y, e.z];
  const at = (u: number, up: number, along: number): [number, number, number] => {
    const v = p0.clone().addScaledVector(a, len * u).addScaledVector(n, up).addScaledVector(s, along);
    return [v.x, v.y, v.z];
  };
  // A dark housing set into the nose, two chrome projectors and a light strip, under a clear cover.
  k.put(rbox(len, 0.05, depth, 0.016), MAT.gloss, at(0.5, -0.016, 0), r, true);
  k.put(rbox(len * 0.96, 0.012, depth * 0.86, 0.006), MAT.trim, at(0.5, 0.004, 0), r, true);
  for (const f of [0.3, 0.68]) projector(k, at(f, 0.008, 0.006), r, depth * 0.24);
  k.put(rbox(len * 0.94, 0.012, 0.014, 0.006), MAT.drl, at(0.5, 0.014, -depth / 2 + 0.01), r, true);
  k.put(rbox(len * 1.02, 0.02, depth * 1.04, 0.012), MAT.lampGlass, at(0.5, 0.016, 0), r, true);
}

/**
 * A modern tail lamp on the rear face at (x, y): a dark red lens, a lit bar across it and a thinner one
 * under it, in a black surround.
 */
export function tailLamp(k: Kit, x: number, y: number, w: number, h: number) {
  const z = k.rear(x, y);
  k.put(rbox(w + 0.02, h + 0.02, 0.04, 0.012), MAT.gloss, [x, y, z - 0.012], [0, 0, 0], true);
  k.put(rbox(w, h, 0.04, 0.01), MAT.redLens, [x, y, z - 0.004], [0, 0, 0], true);
  k.put(rbox(w * 0.86, h * 0.26, 0.03, 0.006), k.tail, [x, y + h * 0.18, z + 0.008], [0, 0, 0], true);
  k.put(rbox(w * 0.86, h * 0.1, 0.03, 0.004), k.tail, [x, y - h * 0.22, z + 0.008], [0, 0, 0], true);
}

/** A run of slats (louvres) across the top between t0 and t1, following `height`. */
export function louvres(k: Kit, t0: number, t1: number, n: number, width: (t: number) => number, height: (t: number) => number, mat: THREE.Material) {
  for (let i = 0; i < n; i++) {
    const t = t0 + ((i + 0.5) / n) * (t1 - t0);
    const dz = 0.01 * k.L;
    const slope = Math.atan2(height(t + 0.005) - height(t - 0.005), dz);
    k.put(rbox(width(t), 0.018, ((t1 - t0) * k.L) / n * 0.55, 0.006), mat, [0, height(t) + 0.012, k.z(t)], [-slope - 0.35, 0, 0]);
  }
}

/**
 * A fin along the roof's spine from t0 to t1, `w` wide, standing h(t) proud of the roof: a rounded hump that
 * follows the greenhouse (a box laid on a curved roof floats off it at one end).
 */
export function spine(k: Kit, t0: number, t1: number, w: number, h: (t: number) => number, mat: THREE.Material) {
  const N = 20;
  const P = 11;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const y = k.cabin.top(t) - 0.012;
    const hh = Math.max(0.002, h(t)) + 0.012;
    for (let j = 0; j < P; j++) {
      const a = (Math.PI * j) / (P - 1);
      pos.push(Math.cos(a) * (w / 2) * Math.sqrt(Math.max(0.15, Math.sin(a) ** 0.3)), y + Math.sin(a) * hh, k.z(t));
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j;
      const b = a + P;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // Cap the open front (the mouth's back wall).
  const c = pos.length / 3;
  pos.push(0, pos[1], pos[2]);
  for (let j = 0; j < P - 1; j++) idx.push(c, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  k.put(g, mat, [0, 0, 0]);
}

/**
 * The tail's curve in plan at height y across ±w, as a smooth even polynomial fitted to the rear face (the face
 * found point by point steps where the loft's rings do), and its yaw. Parts laid along it sit flush, where one
 * straight box stood off the paint at the corners. They stay upright: tilted to the face, a lamp lens caught the
 * sky and went white.
 */
export function rearCurve(k: Kit, y: number, w: number) {
  // Least squares for z = a + b·x² + c·x⁴ on samples across the band.
  const n = 25;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const r = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = -w + (2 * w * i) / (n - 1);
    const f = [1, x * x, x ** 4];
    const z = k.rearFine(x, y);
    for (let p = 0; p < 3; p++) {
      r[p] += f[p] * z;
      for (let q = 0; q < 3; q++) A[p][q] += f[p] * f[q];
    }
  }
  const [a, b, c] = solve3(A, r);
  return {
    z: (x: number) => a + b * x * x + c * x ** 4,
    turn: (x: number, roll = 0): [number, number, number] => [0, -Math.atan(2 * b * x + 4 * c * x ** 3), roll],
  };
}

function solve3(A: number[][], r: number[]): [number, number, number] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  const col = (j: number) => det(A.map((row, i) => row.map((v, q) => (q === j ? r[i] : v))));
  return [col(0) / d, col(1) / d, col(2) / d];
}

/** A band across the tail on `curve`, out to ±w, h tall, its face `out` off the paint and its back `depth` behind that. */
export function rearBand(k: Kit, curve: ReturnType<typeof rearCurve>, y: number, w: number, h: number, mat: THREE.Material, out: number, depth: number) {
  const n = 16;
  const seg = (2 * w) / n;
  for (let i = 0; i < n; i++) {
    const x = -w + (i + 0.5) * seg;
    const t = curve.turn(x);
    k.put(rbox(seg / Math.cos(t[1]) + 0.012, h, depth, 0.003), mat, [x, y, curve.z(x) + out - depth / 2], t);
  }
}

/** A dark grille slab on the nose. */
export function grille(k: Kit, w: number, h: number, y: number, r = 0.03, mat: THREE.Material = MAT.grille) {
  k.put(rbox(w, h, 0.12, r), mat, [0, y, k.front(0, y) + 0.05]);
}

export function exhaust(k: Kit, x: number, y: number, r: number, mirror: boolean, sides = 20) {
  const z = k.rear(x, y);
  k.put(new THREE.CylinderGeometry(r, r * 0.92, 0.16, sides, 1, true), k.pipe, [x, y, z + 0.02], [Math.PI / 2, 0, 0], mirror);
  k.put(new THREE.CircleGeometry(r * 0.85, sides), k.pipeHole, [x, y, z + 0.06], [0, 0, 0], mirror);
}

/** The Vanta's roof airbox scoop: a carbon fin down the spine from just behind the header, fading into the rear glass. */
export function vantaRoofScoop(k: Kit, mat: THREE.Material = MAT.carbon) {
  const s0 = 0.45;
  const s1 = 0.62;
  spine(k, s0, s1, 0.26, (t) => 0.06 * (1 - smooth(0.57, s1, t)) * smooth(s0 - 0.01, s0 + 0.02, t), mat);
  k.put(rbox(0.22, 0.05, 0.02, 0.012), MAT.hole, [0, k.cabin.top(s0 + 0.008) + 0.035, k.z(s0 + 0.008)]);
}

/** The Vanta's V10 under the rear glass: two red cam covers either side of a carbon plenum and its intake trumpets. */
export function vantaEngine(k: Kit, cams: THREE.Material = MAT.red) {
  const et = 0.715;
  const ey = k.top(et);
  for (const s of [-1, 1]) k.put(rbox(0.16, 0.08, 0.58, 0.03), cams, [s * 0.2, ey + 0.05, k.z(et)], [0, 0, s * -0.35]);
  k.put(rbox(0.22, 0.1, 0.5, 0.04), MAT.carbon, [0, ey + 0.08, k.z(et)]);
  for (let i = 0; i < 5; i++) k.put(new THREE.CylinderGeometry(0.028, 0.034, 0.06, 12), MAT.chrome, [0, ey + 0.15, k.z(et) - 0.2 + i * 0.1]);
}

// ---------------------------------------------------------------------------------------------
// The cars

/** Every four-wheeled model's design. Bikes are built by bikemodel.ts instead. */
export const DESIGNS: Record<Exclude<CarId, BikeId>, Design> = {
  // A kei bean with big round eyes and a smile. Loves you back.
  pebble: {
    top: [[0, 0.36], [0.05, 0.46], [0.12, 0.5], [0.183, 0.52], [0.27, 0.56], [0.6, 0.58], [0.85, 0.6], [0.95, 0.6], [1, 0.5]],
    dip: [[0, 0], [0.1, 0.02], [0.25, 0.025], [0.3, 0], [1, 0]],
    floor: [[0, 0.34], [0.04, 0.22], [0.1, 0.17], [0.9, 0.17], [0.96, 0.24], [1, 0.38]],
    roof: [[0.27, 0.555], [0.33, 0.82], [0.42, 0.985], [0.6, 1], [0.86, 0.985], [0.92, 0.9], [0.955, 0.6]],
    roofF: 0.42, roofR: 0.86, bPillar: 0.56, cPillar: 0.83, cabin: 0.9, cabTumble: 0.14,
    waist: 0.02, flareF: 0.05, flareR: 0.05, nose: [0.12, 0.72], tail: [0.05, 0.86], tumble: 0.08, rb: 0.07, rt: 0.16,
    roofSpoiler: true, plate: 'MAME 01', plateY: 0.52,
    kit(k) {
      const y = k.top(0.05) - 0.08;
      roundLamp(k, k.W * 0.55, y, 0.105, MAT.head, 1);
      // The smile.
      const arc = Math.PI * 0.55;
      const sy = y - 0.1;
      k.put(new THREE.TorusGeometry(0.2, 0.03, 8, 24, arc), MAT.grille, [0, sy + 0.17, k.front(0, sy) + 0.01], [0, 0, -Math.PI / 2 - arc / 2]);
      k.put(rbox(0.09, 0.04, 0.05, 0.018), MAT.amber, [k.W * 0.62, sy - 0.04, k.front(k.W * 0.62, sy - 0.04) + 0.02], [0, 0, 0], true);
      // Bumpers.
      k.put(rbox(k.W * 1.86, 0.1, 0.16, 0.05), MAT.trim, [0, 0.25, k.front(0, 0.25) + 0.05]);
      k.put(rbox(k.W * 1.86, 0.1, 0.16, 0.05), MAT.trim, [0, 0.27, k.rear(0, 0.27) - 0.05]);
      // Stacked round tail lamps.
      for (const ty of [0.72, 0.6]) roundLamp(k, k.W * 0.7, ty, 0.055, k.tail, -1, MAT.trim);
      exhaust(k, k.W * 0.45, 0.22, 0.04, false);
      // A roof antenna with a pink bobble.
      const rz = k.z(0.8);
      k.put(new THREE.CylinderGeometry(0.006, 0.008, 0.5, 6), MAT.trim, [-k.W * 0.5, k.H + 0.24, rz], [0.25, 0, 0]);
      k.put(new THREE.SphereGeometry(0.045, 14, 10), MAT.pink, [-k.W * 0.5, k.H + 0.48, rz + 0.12]);
    },
  },

  // Rally homologation special: box flares, a light pod, scoops everywhere, mud flaps.
  kitsune: {
    top: [[0, 0.38], [0.05, 0.5], [0.12, 0.55], [0.194, 0.58], [0.3, 0.6], [0.6, 0.62], [0.806, 0.63], [0.95, 0.62], [1, 0.5]],
    dip: [[0, 0], [0.1, 0.02], [0.25, 0.03], [0.31, 0], [1, 0]],
    floor: [[0, 0.32], [0.05, 0.21], [0.1, 0.18], [0.9, 0.18], [0.96, 0.24], [1, 0.36]],
    roof: [[0.3, 0.595], [0.36, 0.82], [0.45, 0.985], [0.76, 1], [0.85, 0.975], [0.9, 0.86], [0.955, 0.62]],
    roofF: 0.45, roofR: 0.82, bPillar: 0.58, cPillar: 0.84, cabin: 0.86, cabTumble: 0.16,
    waist: 0.04, flareF: 0.11, flareR: 0.12, nose: [0.1, 0.74], tail: [0.05, 0.84], tumble: 0.1, rb: 0.06, rt: 0.12,
    roofSpoiler: true, plate: 'INARI', plateY: 0.5,
    kit(k) {
      const hy = k.top(0.05) - 0.06;
      slitLamp(k, k.W * 0.36, 0.035, k.W * 0.78, 0.055, 0.1);
      grille(k, k.W * 0.85, 0.16, hy - 0.12, 0.04);
      // The rally pod: four big lamps on a bar across the grille.
      const py = hy - 0.12;
      k.put(rbox(k.W * 1.5, 0.05, 0.06, 0.02), MAT.gloss, [0, py, k.front(0, py) - 0.06]);
      for (const x of [0.17, 0.5]) roundLamp(k, x * k.W, py, 0.085, MAT.head, 1, MAT.gloss);
      k.put(rbox(k.W * 1.8, 0.14, 0.16, 0.06), MAT.trim, [0, 0.27, k.front(0, 0.27) + 0.06]);
      k.put(rbox(0.04, 0.09, 0.05, 0.01), MAT.red, [-k.W * 0.55, 0.26, k.front(-k.W * 0.55, 0.26) - 0.02]); // tow strap
      // Hood scoop and vents, roof scoop.
      const ht = 0.16;
      k.put(rbox(0.5, 0.09, 0.42, 0.04), k.paint, [0, k.top(ht) + 0.02, k.z(ht)], [0.06, 0, 0]);
      k.put(rbox(0.42, 0.05, 0.03, 0.02), MAT.grille, [0, k.top(ht) + 0.035, k.z(ht) - 0.205], [0.06, 0, 0]);
      for (const x of [-0.5, 0.5]) k.put(rbox(0.18, 0.02, 0.24, 0.01), MAT.grille, [x * k.W, k.top(0.22) + 0.005, k.z(0.22)], [0.06, 0, 0]);
      k.put(rbox(0.3, 0.06, 0.24, 0.03), k.paint, [0, k.H + 0.02, k.z(0.5)]);
      k.put(rbox(0.24, 0.04, 0.02, 0.01), MAT.grille, [0, k.H + 0.025, k.z(0.5) - 0.12]);
      // Mud flaps behind every wheel.
      for (const t of [k.tF, k.tR]) {
        const z = k.z(t) + k.b.radius + 0.12;
        k.put(rbox(0.26, 0.24, 0.012, 0.006), MAT.rubber, [k.b.track / 2, 0.16, z], [0.08, 0, 0], true);
        k.put(rbox(0.262, 0.05, 0.013, 0.004), MAT.red, [k.b.track / 2, 0.24, z - 0.006], [0.08, 0, 0], true);
      }
      // Tail.
      tailLamp(k, 0.62 * k.W, 0.72, 0.32, 0.1);
      k.put(rbox(k.W * 1.8, 0.14, 0.16, 0.06), MAT.trim, [0, 0.28, k.rear(0, 0.28) - 0.06]);
      exhaust(k, k.W * 0.55, 0.22, 0.065, false);
    },
  },

  // Detroit iron: a supercharger through the hood, quad lamps, chrome, side pipes.
  bramble: {
    top: [[0, 0.44], [0.03, 0.54], [0.1, 0.58], [0.214, 0.6], [0.42, 0.62], [0.7, 0.64], [0.786, 0.66], [0.95, 0.65], [1, 0.56]],
    dip: [[0, 0], [0.06, -0.015], [0.3, -0.03], [0.42, 0], [1, 0]],
    floor: [[0, 0.3], [0.03, 0.2], [0.08, 0.17], [0.92, 0.17], [0.97, 0.22], [1, 0.32]],
    roof: [[0.42, 0.62], [0.48, 0.85], [0.55, 0.99], [0.67, 1], [0.76, 0.9], [0.87, 0.66]],
    roofF: 0.55, roofR: 0.67, bPillar: 0, cPillar: 0.69, cabin: 0.84, cabTumble: 0.2,
    waist: 0.03, flareF: 0.05, flareR: 0.1, nose: [0.05, 0.86], tail: [0.04, 0.9], tumble: 0.06, rb: 0.06, rt: 0.1,
    plate: 'BRMBL V8', plateY: 0.4,
    kit(k) {
      // Wide black grille with four round lamps and a chrome blade under it.
      const gy = k.top(0.02) - 0.13;
      grille(k, k.W * 1.6, 0.2, gy, 0.03);
      for (const x of [0.48, 0.74]) roundLamp(k, x * k.W, gy, 0.075, MAT.head, 1);
      k.put(rbox(k.W * 1.96, 0.06, 0.12, 0.03), MAT.chrome, [0, 0.33, k.front(0, 0.33) + 0.03]);
      k.put(rbox(k.W * 1.96, 0.06, 0.12, 0.03), MAT.chrome, [0, 0.36, k.rear(0, 0.36) - 0.03]);
      // The blower: ribbed case, pulleys, belt, and a scoop hat with two butterflies.
      const bt = 0.2;
      const by = k.top(bt);
      const bz = k.z(bt);
      k.put(rbox(0.46, 0.2, 0.5, 0.04), MAT.alloy, [0, by + 0.07, bz]);
      for (let i = 0; i < 6; i++) k.put(rbox(0.48, 0.012, 0.03, 0.005), MAT.chrome, [0, by + 0.05 + i * 0.022, bz]);
      k.put(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 20), MAT.chrome, [0, by + 0.07, bz - 0.27], [Math.PI / 2, 0, 0]);
      k.put(new THREE.TorusGeometry(0.075, 0.012, 6, 24), MAT.rubber, [0, by + 0.07, bz - 0.27]);
      k.put(rbox(0.4, 0.14, 0.42, 0.05), MAT.gloss, [0, by + 0.24, bz - 0.02], [0.12, 0, 0]);
      for (const x of [-0.1, 0.1]) k.put(rbox(0.15, 0.09, 0.02, 0.01), MAT.grille, [x, by + 0.25, bz - 0.24], [0.12, 0, 0]);
      // Hood pins.
      for (const x of [-0.35, 0.35]) k.put(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), MAT.chrome, [x * k.W * 1.6, k.top(0.05) + 0.006, k.z(0.05)]);
      // Side pipes along the sills.
      const pz0 = k.z(k.tF) + k.b.radius + 0.18;
      const pz1 = k.z(k.tR) - k.b.radius - 0.1;
      const px = k.W - 0.01;
      k.put(new THREE.CylinderGeometry(0.055, 0.055, pz1 - pz0, 16), k.pipe, [px, 0.24, (pz0 + pz1) / 2], [Math.PI / 2, 0, 0], true);
      k.put(rbox(0.04, 0.09, (pz1 - pz0) * 0.6, 0.02), MAT.alloy, [px + 0.05, 0.25, (pz0 + pz1) / 2], [0, 0, 0], true);
      k.put(new THREE.CircleGeometry(0.045, 16), k.pipeHole, [px, 0.24, pz1 + 0.001], [0, 0, 0], true);
      // A full-width tail panel of six lamps.
      const ty = k.top(0.99) - 0.11;
      k.put(rbox(k.W * 1.8, 0.13, 0.05, 0.02), MAT.gloss, [0, ty, k.rear(0, ty) - 0.012]);
      for (let i = 0; i < 3; i++) {
        const x = (0.25 + i * 0.25) * k.W;
        k.put(rbox(k.W * 0.22, 0.09, 0.03, 0.012), MAT.redLens, [x, ty, k.rear(x, ty) + 0.004], [0, 0, 0], true);
        k.put(rbox(k.W * 0.19, 0.03, 0.03, 0.008), k.tail, [x, ty, k.rear(x, ty) + 0.012], [0, 0, 0], true);
      }
    },
  },

  // Tuner coupe: riveted over-fenders, canards, rear louvres and the four round tail lamps.
  shiro: {
    top: [[0, 0.36], [0.05, 0.5], [0.12, 0.57], [0.208, 0.61], [0.3, 0.6], [0.4, 0.58], [0.6, 0.6], [0.792, 0.63], [0.95, 0.62], [1, 0.52]],
    dip: [[0, 0], [0.08, 0.04], [0.2, 0.07], [0.34, 0.03], [0.4, 0], [1, 0]],
    floor: [[0, 0.28], [0.05, 0.18], [0.1, 0.15], [0.9, 0.15], [0.96, 0.2], [1, 0.32]],
    roof: [[0.4, 0.58], [0.46, 0.83], [0.53, 0.99], [0.68, 1], [0.77, 0.88], [0.87, 0.62]],
    roofF: 0.53, roofR: 0.68, bPillar: 0.61, cPillar: 0.71, cabin: 0.82, cabTumble: 0.24,
    waist: 0.04, flareF: 0.1, flareR: 0.12, nose: [0.1, 0.66], tail: [0.05, 0.86], tumble: 0.1, rb: 0.06, rt: 0.12,
    plate: 'TSURUGI', plateY: 0.48,
    kit(k) {
      slitLamp(k, k.W * 0.3, 0.045, k.W * 0.8, 0.08, 0.085);
      grille(k, k.W * 0.9, 0.15, 0.4, 0.05);
      // Carbon lip and canards.
      k.put(rbox(k.body.half(0.05, 0.1) * 1.9, 0.02, 0.2, 0.008), MAT.carbon, [0, 0.165, k.front(0, k.body.floor(0.05) + 0.03) + 0.08]);
      for (const [y, a] of [[0.36, 0.18], [0.28, 0.12]]) {
        const x = k.W * 0.8;
        k.put(rbox(0.12, 0.012, 0.1, 0.004), MAT.carbon, [x + 0.02, y, k.front(x, y) + 0.02], [0, 0.5, a], true);
      }
      // Hood vents.
      for (const x of [-0.3, 0.3]) k.put(rbox(0.2, 0.02, 0.3, 0.01), MAT.grille, [x * k.W, k.top(0.2) + 0.004, k.z(0.2)], [0.08, 0, 0]);
      // Rivets round every over-fender.
      for (const t of [k.tF, k.tR]) {
        const ar = k.b.radius + 0.12;
        for (let i = -4; i <= 4; i++) {
          const a = (i / 4) * 1.15;
          const tt = t + (Math.sin(a) * ar) / k.L;
          const y = k.b.radius + Math.cos(a) * ar;
          const p = k.side(tt, Math.min(1, (y - k.body.bottom(tt)) / Math.max(0.01, k.body.top(tt) - k.body.bottom(tt))));
          k.put(new THREE.SphereGeometry(0.012, 6, 4), MAT.chrome, [p.x, y, p.z], [0, 0, 0], true);
        }
      }
      // Louvres over the rear glass.
      louvres(k, k.cabin.t0 + (0.69 - k.cabin.t0), 0.85, 7, (t) => k.cabin.half(t, 1) * 1.7, (t) => k.cabin.top(t), MAT.gloss);
      // Four round tail lamps.
      const ty = k.top(0.99) - 0.1;
      for (const x of [0.38, 0.7]) {
        const z = k.rear(x * k.W, ty);
        k.put(new THREE.TorusGeometry(0.09, 0.012, 8, 28), MAT.chrome, [x * k.W, ty, z + 0.006], [0, 0, 0], true);
        k.put(new THREE.TorusGeometry(0.07, 0.016, 8, 28), k.tail, [x * k.W, ty, z + 0.012], [0, 0, 0], true);
        k.put(new THREE.CircleGeometry(0.08, 24), MAT.redLens, [x * k.W, ty, z + 0.006], [0, 0, 0], true);
      }
      k.put(rbox(k.W * 1.86, 0.12, 0.14, 0.05), MAT.trim, [0, 0.26, k.rear(0, 0.26) - 0.05]);
      k.put(rbox(k.W * 1.2, 0.05, 0.08, 0.02), MAT.carbon, [0, 0.17, k.rear(0, 0.2) - 0.02]);
      exhaust(k, k.W * 0.42, 0.26, 0.055, true);
    },
  },

  // A twin-rotor lightweight: a long low nose with pop-up lamps standing up, a glass bubble canopy, a lip
  // and a wide grin of an intake, and a slim lamp band across the tail.
  tengu: {
    top: [[0, 0.3], [0.05, 0.44], [0.12, 0.51], [0.22, 0.55], [0.32, 0.56], [0.42, 0.57], [0.62, 0.6], [0.8, 0.64], [0.95, 0.63], [1, 0.54]],
    dip: [[0, 0], [0.08, 0.05], [0.18, 0.07], [0.32, 0.03], [0.4, 0], [0.7, 0], [0.82, 0.03], [1, 0]],
    floor: [[0, 0.26], [0.05, 0.17], [0.1, 0.14], [0.9, 0.14], [0.96, 0.19], [1, 0.3]],
    roof: [[0.38, 0.565], [0.45, 0.82], [0.52, 0.985], [0.64, 1], [0.74, 0.92], [0.86, 0.66]],
    roofF: 0.52, roofR: 0.64, bPillar: 0, cPillar: 0.7, cabin: 0.8, cabTumble: 0.26,
    waist: 0.05, flareF: 0.09, flareR: 0.11, nose: [0.13, 0.6], tail: [0.05, 0.88], tumble: 0.11, rb: 0.06, rt: 0.13,
    plate: 'KAZE 13B', plateY: 0.46,
    kit(k) {
      // Pop-up lamps, up: a painted pod on a dark hinge each side, a lens in its face.
      const pt = 0.085;
      for (const x of [0.58]) {
        const px = x * k.W;
        const py = k.height(pt, px);
        const pz = k.z(pt);
        k.put(rbox(0.3, 0.14, 0.09, 0.03), k.paint, [px, py + 0.07, pz], [-0.08, 0, 0], true);
        k.put(rbox(0.26, 0.02, 0.1, 0.008), MAT.trim, [px, py + 0.005, pz + 0.02], [0, 0, 0], true);
        k.put(rbox(0.25, 0.09, 0.01, 0.02), MAT.gloss, [px, py + 0.075, pz - 0.047], [-0.08, 0, 0], true);
        for (const dx of [-0.06, 0.06]) k.put(new THREE.CircleGeometry(0.04, 18), MAT.head, [px + dx, py + 0.075, pz - 0.054], [Math.PI, 0, 0], true);
      }
      // Turn signals in the bumper corners, a wide intake grin and a carbon lip.
      const iy = 0.27;
      k.put(rbox(k.W * 1.1, 0.12, 0.12, 0.05), MAT.grille, [0, iy, k.front(0, iy) + 0.05]);
      for (const x of [0.78]) k.put(rbox(0.16, 0.05, 0.05, 0.02), MAT.amber, [x * k.W, iy + 0.03, k.front(x * k.W, iy + 0.03) + 0.02], [0, 0.35, 0], true);
      k.put(rbox(k.W * 1.86, 0.02, 0.16, 0.008), MAT.carbon, [0, 0.15, k.front(0, 0.18) + 0.03]);
      // A NACA duct on the hood and a gill behind each front wheel.
      k.put(rbox(0.16, 0.012, 0.3, 0.02), MAT.grille, [0, k.top(0.24) + 0.003, k.z(0.24)], [0.05, 0, 0]);
      const gt = k.tF + 0.12;
      const g = k.side(gt, 0.55);
      for (let i = 0; i < 3; i++) k.put(rbox(0.02, 0.09, 0.03, 0.008), MAT.grille, [g.x + 0.004, g.y, g.z + i * 0.05 - 0.05], [0, 0, 0], true);
      // Tail: a thin lamp band in a dark panel, a round lamp at each end, the bumper and twin pipes.
      const ty = k.top(0.99) - 0.09;
      const tw = k.body.half(0.99, 0.8) * 0.94;
      k.put(rbox(tw * 2, 0.08, 0.04, 0.02), MAT.gloss, [0, ty, k.rear(0, ty) - 0.012]);
      k.put(rbox(tw * 1.9, 0.016, 0.03, 0.006), k.tail, [0, ty + 0.018, k.rear(0, ty) + 0.004]);
      for (const x of [0.78]) {
        const z = k.rear(x * k.W, ty);
        k.put(new THREE.TorusGeometry(0.045, 0.014, 8, 24), k.tail, [x * k.W, ty - 0.01, z + 0.012], [0, 0, 0], true);
      }
      k.put(rbox(k.W * 1.84, 0.12, 0.14, 0.05), MAT.trim, [0, 0.26, k.rear(0, 0.26) - 0.05]);
      exhaust(k, k.W * 0.3, 0.22, 0.05, true);
    },
  },

  // A carbon wedge: arrow lights, intakes everywhere, louvred engine cover, a diffuser like a cathedral.
  vanta: {
    top: [[0, 0.27], [0.05, 0.46], [0.12, 0.6], [0.209, 0.69], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.72], [0.92, 0.7], [0.98, 0.66], [1, 0.58]],
    dip: [[0, 0], [0.06, 0.08], [0.15, 0.15], [0.24, 0.13], [0.32, 0.04], [0.38, 0], [0.6, 0], [0.72, 0.08], [0.9, 0.1], [1, 0.04]],
    floor: [[0, 0.2], [0.04, 0.14], [0.1, 0.12], [0.92, 0.12], [0.97, 0.18], [1, 0.3]],
    roof: [[0.3, 0.56], [0.36, 0.78], [0.43, 0.955], [0.5, 1], [0.6, 0.975], [0.68, 0.86], [0.78, 0.64]],
    roofF: 0.43, roofR: 0.6, bPillar: 0, cPillar: 0.64, cabin: 0.78, cabTumble: 0.28,
    waist: 0.09, flareF: 0.08, flareR: 0.13, nose: [0.18, 0.5], tail: [0.05, 0.9], tumble: 0.12, rb: 0.05, rt: 0.14,
    plate: 'V10', plateY: 0.44, slimA: true, eyeT: 0.52, eyeDrop: 0.2, recline: 0.26, noFuelFlap: true,
    interior: { seat: 0x8a1216, bolster: 0x121215, accent: 0xe0281e, liner: 0x1d1e22, carbon: true, sport: true },
    kit(k) {
      // Slim headlamps lying along the top of the nose, ahead of the fenders.
      slitLamp(k, k.W * 0.4, 0.045, k.W * 0.8, 0.095, 0.1);
      // Big front intakes and a carbon splitter.
      // Corner intakes, set into the nose (it tapers hard here, so they follow it in).
      for (const x of [0.46]) k.put(rbox(0.3, 0.14, 0.14, 0.04), MAT.grille, [x * k.W, 0.27, k.front(x * k.W, 0.27) + 0.11], [0, 0.45, 0], true);
      k.put(rbox(0.5, 0.09, 0.12, 0.04), MAT.grille, [0, 0.24, k.front(0, 0.24) + 0.05]);
      k.put(rbox(k.body.half(0.07, 0.1) * 1.95, 0.02, 0.3, 0.008), MAT.carbon, [0, 0.13, k.front(0, k.body.floor(0.05) + 0.03) + 0.12]);
      // Side intakes ahead of the rear wheels.
      const it = k.tR - 0.15;
      const p = k.side(it, 0.5);
      const flank = Math.atan2(k.side(it + 0.02, 0.5).x - k.side(it - 0.02, 0.5).x, 0.04 * k.L);
      k.put(rbox(0.1, 0.22, 0.36, 0.05), MAT.grille, [p.x - 0.035, p.y, p.z], [0, flank, 0], true);
      k.put(rbox(0.03, 0.025, 0.42, 0.01), MAT.carbon, [p.x - 0.005, p.y + 0.13, p.z], [0, flank, 0], true);
      vantaRoofScoop(k);
      vantaEngine(k);
      // Louvred engine cover.
      louvres(k, 0.74, 0.92, 7, () => k.W * 1.0, (t) => k.top(t), MAT.carbon);
      // Light bar across the tail with arrow ends, in a dark red lens band that wraps the tail's curve (a straight
      // bar stood off the corners in mid-air); then a low grille with the two hex exhausts in it, under the plate.
      const ty = k.top(0.99) - 0.05;
      const tw = k.body.half(0.99, 0.8) * 0.92;
      const tc = rearCurve(k, ty - 0.022, tw * 1.03);
      rearBand(k, tc, ty - 0.022, tw * 1.03, 0.1, MAT.gloss, 0.006, 0.06);
      rearBand(k, tc, ty - 0.022, tw, 0.084, MAT.redLens, 0.011, 0.04);
      rearBand(k, tc, ty, tw * 0.97, 0.024, k.tail, 0.019, 0.04);
      // Chevrons at each end, pointing outward: two strokes meeting at the tip.
      for (const a of [0.55, -0.55]) {
        const half = 0.05;
        const x = tw * 0.92 - Math.cos(a) * half;
        const y = ty - 0.038 + Math.sin(a) * half;
        k.put(rbox(half * 2.1, 0.02, 0.03, 0.006), k.tail, [x, y, tc.z(x) + 0.004], tc.turn(x, -a), true);
      }
      const gw = k.body.half(0.99, 0.3) * 0.9;
      k.put(rbox(gw * 2, 0.14, 0.12, 0.03), MAT.grille, [0, 0.27, k.rear(0, 0.27) - 0.04]);
      const dz = k.rear(0, 0.2);
      k.put(rbox(gw * 1.9, 0.02, 0.5, 0.006), MAT.carbon, [0, 0.14, dz - 0.18], [-0.22, 0, 0]);
      for (let i = -3; i <= 3; i++) k.put(rbox(0.012, 0.16, 0.42, 0.004), MAT.carbon, [i * 0.22, 0.18, dz - 0.16], [-0.22, 0, 0]);
      exhaust(k, 0.34, 0.285, 0.055, true, 6);
    },
  },
};
