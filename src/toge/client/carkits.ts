// Each car's design: the curves its body is lofted from (see carloft.ts) and a kit of the parts that make
// it itself — lamps, scoops, vents, wings, pipes. Keys are [t, value] with t from 0 (nose) to 1 (tail);
// `top`, `dip` and `roof` are × the car's height, `floor` is metres above the ground.

import * as THREE from 'three';
import type { BaseCar, CarId } from '../shared/cars.ts';
import { type Section, centreTop, endZ, heightAt, surface, zAt } from './carloft.ts';
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
  /** Spoilers sit on the roof (hatches) rather than the deck. */
  roofSpoiler?: boolean;
  plate: string;
  plateY: number;
  kit(k: Kit): void;
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
}

export function makeKitHelpers(body: Section) {
  return {
    z: (t: number) => zAt(body, t),
    top: (t: number) => centreTop(body, t),
    height: (t: number, x: number) => heightAt(body, t, x),
    side: (t: number, v: number, s = 1) => surface(body, t, v, s),
    front: (x: number, y: number) => endZ(body, x, y, 1),
    rear: (x: number, y: number) => endZ(body, x, y, -1),
  };
}

// ---------------------------------------------------------------------------------------------
// Lamp and trim helpers

const hemi = (r: number) => new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);

/** A round lamp on the nose (dir 1) or tail (dir -1): chrome bezel, domed lens. */
function roundLamp(k: Kit, x: number, y: number, r: number, lens: THREE.Material, dir: 1 | -1, bezel: THREE.Material = MAT.chrome) {
  const z = dir > 0 ? k.front(x, y) : k.rear(x, y);
  k.put(new THREE.TorusGeometry(r, r * 0.16, 8, 28), bezel, [x, y, z + dir * 0.012], [0, 0, 0], true);
  k.put(new THREE.CylinderGeometry(r, r, 0.08, 24), MAT.gloss, [x, y, z + dir * 0.03], [Math.PI / 2, 0, 0], true);
  k.put(hemi(r * 0.9), lens, [x, y, z - dir * 0.005], [-dir * Math.PI / 2, 0, 0], true);
}

/**
 * A slim headlight lying on the nose from (x0, t0) to (x1, t1): a dark gloss slab following the surface,
 * two projector lenses in it and a light strip along its front edge.
 */
function slitLamp(k: Kit, x0: number, t0: number, x1: number, t1: number, depth: number) {
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
  k.put(rbox(len, 0.05, depth, 0.016), MAT.gloss, at(0.5, -0.012, 0), r, true);
  for (const f of [0.3, 0.68]) k.put(hemi(depth * 0.3), MAT.head, at(f, 0.004, 0.004), r, true);
  k.put(rbox(len * 0.94, 0.014, 0.016, 0.006), MAT.drl, at(0.5, 0.012, -depth / 2 + 0.006), r, true);
}

/** A run of slats (louvres) across the top between t0 and t1, following `height`. */
function louvres(k: Kit, t0: number, t1: number, n: number, width: (t: number) => number, height: (t: number) => number, mat: THREE.Material) {
  for (let i = 0; i < n; i++) {
    const t = t0 + ((i + 0.5) / n) * (t1 - t0);
    const dz = 0.01 * k.L;
    const slope = Math.atan2(height(t + 0.005) - height(t - 0.005), dz);
    k.put(rbox(width(t), 0.018, ((t1 - t0) * k.L) / n * 0.55, 0.006), mat, [0, height(t) + 0.012, k.z(t)], [-slope - 0.35, 0, 0]);
  }
}

/** A dark grille slab on the nose. */
function grille(k: Kit, w: number, h: number, y: number, r = 0.03, mat: THREE.Material = MAT.grille) {
  k.put(rbox(w, h, 0.12, r), mat, [0, y, k.front(0, y) + 0.05]);
}

function exhaust(k: Kit, x: number, y: number, r: number, mirror: boolean, sides = 20) {
  const z = k.rear(x, y);
  k.put(new THREE.CylinderGeometry(r, r * 0.92, 0.16, sides, 1, true), k.pipe, [x, y, z + 0.02], [Math.PI / 2, 0, 0], mirror);
  k.put(new THREE.CircleGeometry(r * 0.85, sides), k.pipeHole, [x, y, z + 0.06], [0, 0, 0], mirror);
}

// ---------------------------------------------------------------------------------------------
// The cars

export const DESIGNS: Record<CarId, Design> = {
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
      for (const t of [k.tF, k.tR]) k.put(rbox(0.26, 0.24, 0.02, 0.01), MAT.red, [k.b.track / 2, 0.16, k.z(t) + k.b.radius + 0.12], [0, 0, 0], true);
      // Tail.
      for (const x of [0.62]) k.put(rbox(0.32, 0.09, 0.05, 0.02), k.tail, [x * k.W, 0.72, k.rear(x * k.W, 0.72) - 0.01], [0, 0, 0], true);
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
        k.put(rbox(k.W * 0.22, 0.08, 0.03, 0.015), k.tail, [x, ty, k.rear(x, ty) + 0.004], [0, 0, 0], true);
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
      k.put(rbox(k.W * 1.9, 0.02, 0.2, 0.008), MAT.carbon, [0, 0.16, k.front(0, 0.2) + 0.02]);
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
        k.put(new THREE.TorusGeometry(0.075, 0.022, 8, 28), k.tail, [x * k.W, ty, z + 0.01], [0, 0, 0], true);
        k.put(new THREE.CircleGeometry(0.05, 20), MAT.gloss, [x * k.W, ty, z + 0.004], [0, 0, 0], true);
      }
      k.put(rbox(k.W * 1.86, 0.12, 0.14, 0.05), MAT.trim, [0, 0.26, k.rear(0, 0.26) - 0.05]);
      k.put(rbox(k.W * 1.2, 0.05, 0.08, 0.02), MAT.carbon, [0, 0.17, k.rear(0, 0.2) - 0.02]);
      exhaust(k, k.W * 0.42, 0.26, 0.055, true);
    },
  },

  // A carbon wedge: arrow lights, intakes everywhere, louvred engine cover, a diffuser like a cathedral.
  vanta: {
    top: [[0, 0.27], [0.05, 0.46], [0.12, 0.6], [0.209, 0.69], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.72], [0.92, 0.7], [0.98, 0.66], [1, 0.58]],
    dip: [[0, 0], [0.06, 0.08], [0.15, 0.15], [0.24, 0.13], [0.32, 0.04], [0.38, 0], [0.6, 0], [0.72, 0.08], [0.9, 0.1], [1, 0.04]],
    floor: [[0, 0.2], [0.04, 0.14], [0.1, 0.12], [0.92, 0.12], [0.97, 0.18], [1, 0.3]],
    roof: [[0.3, 0.56], [0.38, 0.8], [0.46, 0.975], [0.56, 1], [0.66, 0.88], [0.78, 0.64]],
    roofF: 0.46, roofR: 0.56, bPillar: 0, cPillar: 0.62, cabin: 0.78, cabTumble: 0.28,
    waist: 0.09, flareF: 0.08, flareR: 0.13, nose: [0.18, 0.5], tail: [0.05, 0.9], tumble: 0.12, rb: 0.05, rt: 0.14,
    plate: 'V10', plateY: 0.36,
    kit(k) {
      // Arrow running lights in dark housings, set into the top of the nose ahead of the fenders.
      const lt = 0.07;
      const hx = k.W * 0.6;
      const hy = k.height(lt, hx);
      const slope = Math.atan2(k.height(lt + 0.02, hx) - k.height(lt - 0.02, hx), 0.04 * k.L);
      k.put(rbox(0.3, 0.035, 0.24, 0.015), MAT.gloss, [hx, hy - 0.01, k.z(lt)], [-slope, 0.2, 0], true);
      for (const [dx, yaw] of [[-0.06, 0.75], [0.06, -0.75]]) {
        k.put(rbox(0.17, 0.016, 0.018, 0.006), MAT.drl, [hx + dx, hy + 0.016, k.z(lt) - 0.03], [-slope, yaw, 0], true);
      }
      // Big front intakes and a carbon splitter.
      for (const x of [0.6]) k.put(rbox(0.42, 0.16, 0.12, 0.05), MAT.grille, [x * k.W, 0.27, k.front(x * k.W, 0.27) + 0.05], [0, 0.3, 0], true);
      k.put(rbox(0.5, 0.09, 0.12, 0.04), MAT.grille, [0, 0.24, k.front(0, 0.24) + 0.05]);
      k.put(rbox(k.W * 1.94, 0.02, 0.3, 0.008), MAT.carbon, [0, 0.13, k.front(0, 0.16) + 0.06]);
      // Side intakes ahead of the rear wheels.
      const it = k.tR - 0.15;
      const p = k.side(it, 0.5);
      const flank = Math.atan2(k.side(it + 0.02, 0.5).x - k.side(it - 0.02, 0.5).x, 0.04 * k.L);
      k.put(rbox(0.1, 0.22, 0.36, 0.05), MAT.grille, [p.x - 0.035, p.y, p.z], [0, flank, 0], true);
      k.put(rbox(0.03, 0.025, 0.42, 0.01), MAT.carbon, [p.x - 0.005, p.y + 0.13, p.z], [0, flank, 0], true);
      // Roof airbox scoop.
      k.put(rbox(0.3, 0.08, 0.62, 0.04), MAT.carbon, [0, k.H + 0.015, k.z(0.56)], [0.04, 0, 0]);
      k.put(rbox(0.22, 0.05, 0.02, 0.02), MAT.grille, [0, k.H + 0.03, k.z(0.56) - 0.31]);
      // The V10 under the rear glass: two red cam covers either side of a carbon plenum and its intake trumpets.
      const et = 0.715;
      const ey = k.top(et);
      for (const s of [-1, 1]) k.put(rbox(0.16, 0.08, 0.58, 0.03), MAT.red, [s * 0.2, ey + 0.05, k.z(et)], [0, 0, s * -0.35]);
      k.put(rbox(0.22, 0.1, 0.5, 0.04), MAT.carbon, [0, ey + 0.08, k.z(et)]);
      for (let i = 0; i < 5; i++) k.put(new THREE.CylinderGeometry(0.028, 0.034, 0.06, 12), MAT.chrome, [0, ey + 0.15, k.z(et) - 0.2 + i * 0.1]);
      // Louvred engine cover.
      louvres(k, 0.74, 0.92, 7, () => k.W * 1.0, (t) => k.top(t), MAT.carbon);
      // Light bar across the tail with arrow ends, a gaping grille, diffuser fins and two hex exhausts.
      const ty = k.top(0.99) - 0.05;
      const tw = k.body.half(0.99, 0.8) * 0.92;
      k.put(rbox(tw * 2, 0.022, 0.03, 0.008), k.tail, [0, ty, k.rear(0, ty) + 0.008]);
      for (const roll of [0.55, -0.55]) {
        const x = tw * 0.84;
        k.put(rbox(0.13, 0.02, 0.03, 0.008), k.tail, [x, ty - 0.04, k.rear(x, ty - 0.04) + 0.004], [0, 0, roll], true);
      }
      const gw = k.body.half(0.99, 0.3) * 0.9;
      k.put(rbox(gw * 2, 0.18, 0.12, 0.03), MAT.grille, [0, 0.33, k.rear(0, 0.33) - 0.04]);
      const dz = k.rear(0, 0.2);
      k.put(rbox(gw * 1.9, 0.02, 0.5, 0.006), MAT.carbon, [0, 0.14, dz - 0.18], [-0.22, 0, 0]);
      for (let i = -3; i <= 3; i++) k.put(rbox(0.012, 0.16, 0.42, 0.004), MAT.carbon, [i * 0.22, 0.18, dz - 0.16], [-0.22, 0, 0]);
      exhaust(k, 0.13, 0.36, 0.07, true, 6);
    },
  },
};
