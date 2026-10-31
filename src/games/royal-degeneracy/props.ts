// Procedural furniture and clutter, from the photos: dark upholstered beds, the navy couch and the black leather one,
// the wooden hutch with bottles along its top, the PA speaker on its nightstand in the brick corner, the record
// player, cans and pizza boxes everywhere, the traffic cone. Furniture is drawn over the house's collision boxes (same
// footprint); everything is merged per material, so the whole lot is a handful of draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAST, type CharId } from './cast.ts';
import { BOXES, DEPTH, DOORS, DOOR_H, FIREPIT, FLOOR_Y, SPOTS, WIDTH, WINDOWS, WINDOW_SPAN, roomAt, type HBox, type Mat, type Window } from './house.ts';
import { ramp } from './people.ts';
import { buildArt } from './wallart.ts';

/** The furniture kinds props.ts draws (world.ts skips their plain boxes). */
export const DRAWN: ReadonlySet<Mat> = new Set<Mat>([
  'bed', 'desk', 'couch', 'leather', 'table', 'counter', 'fridge', 'toilet', 'tub', 'sink', 'radiator', 'hutch', 'shelf', 'records', 'bin', 'junk', 'beanbag',
  'wardrobe', 'nightstand', 'dresser', 'chair', 'firepit', 'cooler', 'stool',
]);

const COLOURS: Record<string, string> = {
  frame: '#3a3a40',
  sheet: '#e9e4da',
  duvet: '#5f7a9a',
  pillow: '#f4f1ea',
  wood: '#8a5f3a',
  darkwood: '#5a3a22',
  metal: '#9a9aa2',
  black: '#1a1a1e',
  navy: '#2d3a5e',
  navyLight: '#3a4a74',
  leather: '#1c1a1c',
  counter: '#d8d0c0',
  cabinet: '#c9b48e',
  cabinetDoor: '#d6c29c',
  splash: '#e6e0d2',
  steel: '#b4b8bf',
  white: '#f4f2ec',
  porcelain: '#fbfbf8',
  water: '#7aa8c8',
  bluebin: '#2f5a8a',
  cardboard: '#b08858',
  can: '#c8ccd4',
  canRed: '#c03a3a',
  pizza: '#d8b070',
  cone: '#f26a1a',
  green: '#4a8a3a',
  pot: '#a86a3a',
  rug: '#9a948c',
  laundry: '#7a6a9a',
  speaker: '#202024',
  bottleGreen: '#2f7a4a',
  bottleClear: '#cfe4ea',
  bottleBrown: '#7a4a1a',
  vinyl: '#111111',
  label: '#d94b4b',
  screen: '#20304a',
  beanbag: '#8a3a6a',
  casing: '#f6f2e8',
  shade: '#f6e6bc',
  stone: '#6e6a64',
  ember: '#ff7a2a',
  plastic: '#ecebe6',
  insulation: '#e8a2b4',
  rafter: '#7a5a38',
  frost: '#e8eef0',
};

/** Collects geometry per colour, merged at the end. */
class Kit {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  box(c: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const g = new THREE.BoxGeometry(Math.max(0.005, x1 - x0), Math.max(0.005, y1 - y0), Math.max(0.005, z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(c, g);
  }

  cyl(c: string, x: number, y: number, z: number, r: number, h: number, seg = 10, rTop = r) {
    const g = new THREE.CylinderGeometry(rTop, r, h, seg);
    g.translate(x, y + h / 2, z);
    this.add(c, g);
  }

  cone(c: string, x: number, y: number, z: number, r: number, h: number) {
    const g = new THREE.ConeGeometry(r, h, 12);
    g.translate(x, y + h / 2, z);
    this.add(c, g);
  }

  /** A flat board tilted in the x–y plane, from (x0, y0) to (x1, y1), running z0..z1 (a roof slope). */
  slope(c: string, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.BoxGeometry(len, 0.04, z1 - z0);
    g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(c, g);
  }

  private add(c: string, g: THREE.BufferGeometry) {
    const list = this.parts.get(c) ?? [];
    list.push(g);
    this.parts.set(c, list);
  }

  build(group: THREE.Group, owned: { dispose(): void }[]) {
    for (const [c, list] of this.parts) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      const mat = new THREE.MeshToonMaterial({ color: COLOURS[c] ?? c, gradientMap: ramp() });
      if (c === 'leather') {
        mat.emissive.set('#0c0c10');
      }
      // Things that give off light: the fire pit's embers, the bedside lampshades.
      if (c === 'ember') mat.emissive.set('#ff4a10');
      if (c === 'shade') mat.emissive.set('#8a6a30');
      group.add(new THREE.Mesh(merged, mat));
      owned.push(merged, mat);
    }
  }
}

/** A seeded wobble so clutter lands in the same places every load. */
function dice(seed: number) {
  let a = seed;
  return () => (a = (a * 16807) % 2147483647) / 2147483647;
}

/** Which end of a long box is against a wall (for headboards and couch backs): -1 low end, +1 high end. */
function wallEnd(b: HBox, axis: 'x' | 'z'): -1 | 1 {
  const r = roomAt({ x: (b.min.x + b.max.x) / 2, y: b.min.y + 0.1, z: (b.min.z + b.max.z) / 2 });
  if (!r) return -1;
  return b.min[axis] - r.min[axis] < r.max[axis] - b.max[axis] ? -1 : 1;
}

function furniture(k: Kit, b: HBox) {
  const { min: lo, max: hi } = b;
  const y = lo.y;
  const h = hi.y - lo.y;
  const longX = hi.x - lo.x > hi.z - lo.z;
  switch (b.mat) {
    case 'bed': {
      // A dark upholstered frame, a mattress with a duvet, a pillow and a headboard at the wall end.
      k.box('frame', lo.x, y, lo.z, hi.x, y + 0.28, hi.z);
      k.box('sheet', lo.x + 0.04, y + 0.28, lo.z + 0.04, hi.x - 0.04, y + 0.46, hi.z - 0.04);
      const axis = longX ? 'x' : 'z';
      const end = wallEnd(b, axis);
      const head = end < 0 ? lo[axis] : hi[axis];
      const len = hi[axis] - lo[axis];
      const duvetFrom = end < 0 ? lo[axis] + len * 0.32 : lo[axis];
      const duvetTo = end < 0 ? hi[axis] : hi[axis] - len * 0.32;
      const pillowA = end < 0 ? head + 0.08 : head - 0.42;
      if (axis === 'x') {
        k.box('duvet', duvetFrom, y + 0.46, lo.z + 0.02, duvetTo, y + 0.52, hi.z - 0.02);
        k.box('pillow', pillowA, y + 0.46, lo.z + 0.12, pillowA + 0.34, y + 0.58, hi.z - 0.12);
        k.box('frame', head - 0.05, y, lo.z, head + 0.05, y + 1.05, hi.z);
      } else {
        k.box('duvet', lo.x + 0.02, y + 0.46, duvetFrom, hi.x - 0.02, y + 0.52, duvetTo);
        k.box('pillow', lo.x + 0.12, y + 0.46, pillowA, hi.x - 0.12, y + 0.58, pillowA + 0.34);
        k.box('frame', lo.x, y, head - 0.05, hi.x, y + 1.05, head + 0.05);
      }
      break;
    }
    case 'desk': {
      k.box('wood', lo.x, y + h - 0.04, lo.z, hi.x, y + h, hi.z);
      for (const [x, z] of [[lo.x + 0.04, lo.z + 0.04], [hi.x - 0.08, lo.z + 0.04], [lo.x + 0.04, hi.z - 0.08], [hi.x - 0.08, hi.z - 0.08]]) k.box('darkwood', x, y, z, x + 0.04, y + h - 0.04, z + 0.04);
      // A laptop and a mug.
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      k.box('black', cx - 0.16, y + h, cz - 0.11, cx + 0.16, y + h + 0.02, cz + 0.11);
      k.cyl('white', cx + 0.24 * (longX ? 1 : 0), y + h, cz + 0.24 * (longX ? 0 : 1), 0.04, 0.09);
      break;
    }
    case 'couch':
    case 'leather': {
      // Base, seat cushions, a back along the wall side, arms at the ends.
      const c = b.mat === 'couch' ? 'navy' : 'leather';
      const axis = longX ? 'z' : 'x';
      const back = wallEnd(b, axis);
      k.box(c, lo.x, y, lo.z, hi.x, y + 0.42, hi.z);
      if (axis === 'z') {
        const bz = back < 0 ? lo.z : hi.z - 0.22;
        k.box(c, lo.x, y, bz, hi.x, y + 0.85, bz + 0.22);
        for (const x of [lo.x, hi.x - 0.18]) k.box(c, x, y, lo.z, x + 0.18, y + 0.62, hi.z);
        for (let i = 0; i < 3; i++) k.box(b.mat === 'couch' ? 'navyLight' : c, lo.x + 0.2 + i * ((hi.x - lo.x - 0.4) / 3) + 0.02, y + 0.42, lo.z + 0.05, lo.x + 0.2 + (i + 1) * ((hi.x - lo.x - 0.4) / 3) - 0.02, y + 0.52, hi.z - 0.05);
      } else {
        const bx = back < 0 ? lo.x : hi.x - 0.22;
        k.box(c, bx, y, lo.z, bx + 0.22, y + 0.85, hi.z);
        for (const z of [lo.z, hi.z - 0.18]) k.box(c, lo.x, y, z, hi.x, y + 0.62, z + 0.18);
        for (let i = 0; i < 3; i++) k.box(b.mat === 'couch' ? 'navyLight' : c, lo.x + 0.05, y + 0.42, lo.z + 0.2 + i * ((hi.z - lo.z - 0.4) / 3) + 0.02, hi.x - 0.05, y + 0.52, lo.z + 0.2 + (i + 1) * ((hi.z - lo.z - 0.4) / 3) - 0.02);
        // The black-and-white throw pillow on the navy couch.
        if (b.mat === 'couch') k.box('white', bx - 0.12 * back, y + 0.5, (lo.z + hi.z) / 2 - 0.2, bx + 0.1, y + 0.82, (lo.z + hi.z) / 2 + 0.15);
      }
      break;
    }
    case 'table': {
      const low = h < 0.5;
      k.box(low ? 'black' : 'wood', lo.x, y + h - 0.05, lo.z, hi.x, y + h, hi.z);
      for (const [x, z] of [[lo.x + 0.03, lo.z + 0.03], [hi.x - 0.08, lo.z + 0.03], [lo.x + 0.03, hi.z - 0.08], [hi.x - 0.08, hi.z - 0.08]]) k.box(low ? 'black' : 'darkwood', x, y, z, x + 0.05, y + h - 0.05, z + 0.05);
      break;
    }
    case 'wardrobe':
    case 'dresser':
    case 'nightstand': {
      // Facing out from the wall it stands against: two doors (wardrobe) or drawers, small handles; a lamp on the
      // bedside table, odds and ends on the chest of drawers.
      const depth = longX ? 'z' : 'x';
      const along = longX ? 'x' : 'z';
      const out = wallEnd(b, depth) < 0 ? 1 : -1;
      const f = out > 0 ? hi[depth] : lo[depth];
      const face = (c: string, s0: number, s1: number, y0: number, y1: number, d: number) => {
        const p0 = Math.min(f, f + out * d);
        const p1 = Math.max(f, f + out * d);
        if (longX) k.box(c, s0, y0, p0, s1, y1, p1);
        else k.box(c, p0, y0, s0, p1, y1, s1);
      };
      k.box(b.mat === 'dresser' ? 'darkwood' : 'wood', lo.x, y + 0.06, lo.z, hi.x, y + h, hi.z);
      k.box('darkwood', lo.x + 0.03, y, lo.z + 0.03, hi.x - 0.03, y + 0.06, hi.z - 0.03);
      const a0 = lo[along];
      const a1 = hi[along];
      const m = (a0 + a1) / 2;
      if (b.mat === 'wardrobe') {
        face('cabinet', a0 + 0.03, m - 0.01, y + 0.1, y + h - 0.06, 0.015);
        face('cabinet', m + 0.01, a1 - 0.03, y + 0.1, y + h - 0.06, 0.015);
        face('metal', m - 0.06, m - 0.04, y + 1, y + 1.2, 0.035);
        face('metal', m + 0.04, m + 0.06, y + 1, y + 1.2, 0.035);
      } else {
        const rows = b.mat === 'dresser' ? 3 : 2;
        const top = y + h - 0.04;
        for (let i = 0; i < rows; i++) {
          const y0 = y + 0.09 + (i * (top - y - 0.09)) / rows;
          const y1 = y + 0.09 + ((i + 1) * (top - y - 0.09)) / rows - 0.02;
          face('cabinet', a0 + 0.03, a1 - 0.03, y0, y1, 0.015);
          face('metal', m - 0.05, m + 0.05, (y0 + y1) / 2 - 0.01, (y0 + y1) / 2 + 0.01, 0.035);
        }
      }
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      if (b.mat === 'nightstand') {
        k.cyl('black', cx, y + h, cz, 0.06, 0.03, 12);
        k.cyl('metal', cx, y + h + 0.03, cz, 0.012, 0.22, 6);
        k.cyl('shade', cx, y + h + 0.2, cz, 0.12, 0.17, 14, 0.08);
      } else if (b.mat === 'dresser') {
        k.box('laundry', cx - 0.15, y + h, cz - 0.2, cx + 0.12, y + h + 0.08, cz + 0.15);
        k.cyl('canRed', cx + (longX ? 0.25 : 0), y + h, cz + (longX ? 0 : 0.25), 0.033, 0.12, 8);
      }
      break;
    }
    case 'chair': {
      // A white plastic lawn chair, facing the fire pit.
      const dx = FIREPIT.x - (lo.x + hi.x) / 2;
      const dz = FIREPIT.z - (lo.z + hi.z) / 2;
      k.box('plastic', lo.x, y + 0.4, lo.z, hi.x, y + 0.45, hi.z);
      for (const [x, z] of [[lo.x, lo.z], [hi.x - 0.04, lo.z], [lo.x, hi.z - 0.04], [hi.x - 0.04, hi.z - 0.04]]) k.box('plastic', x, y, z, x + 0.04, y + 0.4, z + 0.04);
      if (Math.abs(dx) > Math.abs(dz)) {
        const bx = dx > 0 ? lo.x : hi.x - 0.05;
        k.box('plastic', bx, y + 0.45, lo.z, bx + 0.05, hi.y, hi.z);
      } else {
        const bz = dz > 0 ? lo.z : hi.z - 0.05;
        k.box('plastic', lo.x, y + 0.45, bz, hi.x, hi.y, bz + 0.05);
      }
      break;
    }
    case 'firepit': {
      // A ring of stones, two logs across, embers glowing in the middle.
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const sx = cx + Math.cos(a) * 0.42;
        const sz = cz + Math.sin(a) * 0.42;
        k.box('stone', sx - 0.09, y, sz - 0.09, sx + 0.09, y + 0.22 + (i % 3) * 0.04, sz + 0.09);
      }
      k.box('ember', cx - 0.25, y, cz - 0.25, cx + 0.25, y + 0.06, cz + 0.25);
      k.box('darkwood', cx - 0.3, y + 0.06, cz - 0.05, cx + 0.3, y + 0.14, cz + 0.05);
      k.box('darkwood', cx - 0.05, y + 0.12, cz - 0.3, cx + 0.05, y + 0.2, cz + 0.3);
      break;
    }
    case 'stool': {
      // A bar stool: a round black seat on a chrome post and a foot ring.
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      k.cyl('metal', cx, y, cz, 0.15, 0.03, 12);
      k.cyl('metal', cx, y + 0.03, cz, 0.025, h - 0.08, 8);
      k.cyl('metal', cx, y + 0.28, cz, 0.13, 0.02, 12);
      k.cyl('black', cx, y + h - 0.06, cz, 0.18, 0.06, 14);
      break;
    }
    case 'cooler':
      k.box('bluebin', lo.x, y, lo.z, hi.x, hi.y - 0.08, hi.z);
      k.box('white', lo.x - 0.01, hi.y - 0.08, lo.z - 0.01, hi.x + 0.01, hi.y, hi.z + 0.01);
      break;
    case 'counter': {
      // Base cabinets: a dark toe kick, a door and a drawer every 60 cm with handles, an overhanging worktop. The
      // kitchen sink (with its tap) or the hob sits in the run that has one; a long run gets wall cabinets too.
      const depth = longX ? 'z' : 'x';
      const along = longX ? 'x' : 'z';
      const back = wallEnd(b, depth);
      const f = back < 0 ? hi[depth] : lo[depth];
      const wallSide = back < 0 ? lo[depth] : hi[depth];
      const out = back < 0 ? 1 : -1;
      /** A box on the front face: from s0 to s1 along the run, ya to yb up, sticking out d (from `from`). */
      const face = (c: string, s0: number, s1: number, ya: number, yb: number, d: number, from = f) => {
        const p0 = Math.min(from, from + out * d);
        const p1 = Math.max(from, from + out * d);
        if (longX) k.box(c, s0, ya, p0, s1, yb, p1);
        else k.box(c, p0, ya, s0, p1, yb, s1);
      };
      const a0 = lo[along];
      const a1 = hi[along];
      face('darkwood', a0, a1, y, y + 0.1, -0.06);
      face('cabinet', a0, a1, y + 0.1, y + h - 0.04, -(hi[depth] - lo[depth]) + 0.0, f);
      const n = Math.max(1, Math.round((a1 - a0) / 0.6));
      const wd = (a1 - a0) / n;
      for (let i = 0; i < n; i++) {
        const s0 = a0 + i * wd + 0.015;
        const s1 = a0 + (i + 1) * wd - 0.015;
        face('cabinetDoor', s0, s1, y + 0.12, y + h - 0.24, 0.02);
        face('cabinetDoor', s0, s1, y + h - 0.21, y + h - 0.07, 0.02);
        const mid = (s0 + s1) / 2;
        face('steel', mid - 0.07, mid + 0.07, y + h - 0.15, y + h - 0.13, 0.04);
        const knob = i % 2 ? s0 + 0.05 : s1 - 0.07;
        face('steel', knob, knob + 0.02, y + h - 0.42, y + h - 0.3, 0.04);
      }
      face('counter', a0 - 0.01, a1 + 0.01, y + h - 0.04, y + h, -(hi[depth] - lo[depth]) - 0.03, f + out * 0.03);
      // On an outside wall the windows come down to the worktop: no splashback or wall cabinets there.
      const outer = wallSide < 0.3 || wallSide > WIDTH - 0.3;
      if (!outer) face('splash', a0, a1, y + h, y + h + 0.45, 0.015, wallSide);
      const sink = SPOTS.find((s) => s.id === 'pan-kitchen')!.pos;
      const inside = (p: { x: number; z: number }) => p.x > lo.x && p.x < hi.x && p.z > lo.z && p.z < hi.z;
      const cAt = (s: number, d: number): [number, number] => (longX ? [s, d] : [d, s]);
      const mid = (lo[depth] + hi[depth]) / 2;
      if (inside(sink)) {
        const s = longX ? sink.x : sink.z;
        const [x0, z0] = cAt(s - 0.32, mid - 0.2);
        const [x1, z1] = cAt(s + 0.32, mid + 0.2);
        k.box('steel', Math.min(x0, x1), y + h - 0.005, Math.min(z0, z1), Math.max(x0, x1), y + h + 0.004, Math.max(z0, z1));
        const [tx, tz] = cAt(s, wallSide + out * 0.08);
        k.cyl('steel', tx, y + h, tz, 0.018, 0.3);
        const [sx, sz] = cAt(s, wallSide + out * 0.17);
        k.box('steel', sx - 0.02, y + h + 0.26, sz - 0.02, sx + 0.02, y + h + 0.3, sz + 0.02);
      } else if (!longX && hi.x > WIDTH - 0.5) {
        // The hob: four rings on a black glass top.
        const s = (a0 + a1) / 2;
        const [x0, z0] = cAt(s - 0.3, mid - 0.26);
        const [x1, z1] = cAt(s + 0.3, mid + 0.26);
        k.box('black', Math.min(x0, x1), y + h, Math.min(z0, z1), Math.max(x0, x1), y + h + 0.012, Math.max(z0, z1));
        for (const [ds, dd] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) {
          const [rx, rz] = cAt(s + ds, mid + dd);
          k.cyl('#5a2a22', rx, y + h + 0.012, rz, 0.08, 0.004, 16);
        }
      }
      if (longX && a1 - a0 > 2 && !outer) {
        // Wall cabinets over the run.
        face('cabinet', a0, a1, y + 1.45, y + 2.15, 0.34, wallSide);
        for (let i = 0; i < n; i++) {
          const s0 = a0 + i * wd + 0.015;
          const s1 = a0 + (i + 1) * wd - 0.015;
          face('cabinetDoor', s0, s1, y + 1.47, y + 2.13, 0.36, wallSide);
          const knob = i % 2 ? s0 + 0.05 : s1 - 0.07;
          face('steel', knob, knob + 0.02, y + 1.5, y + 1.62, 0.39, wallSide);
        }
      }
      break;
    }
    case 'fridge':
      k.box('white', lo.x, y, lo.z, hi.x, hi.y, hi.z);
      k.box('metal', hi.x, y + 1.1, lo.z + 0.08, hi.x + 0.03, y + 1.6, lo.z + 0.12);
      k.box('black', hi.x, y + 1.18, lo.z + 0.02, hi.x + 0.005, y + 1.2, hi.z - 0.02);
      break;
    case 'toilet': {
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      k.cyl('porcelain', cx, y, cz - 0.08, 0.2, 0.4, 14, 0.24);
      k.box('porcelain', hi.x - 0.18, y + 0.35, lo.z + 0.1, hi.x, y + 0.75, hi.z - 0.1);
      break;
    }
    case 'tub': {
      // A hollow tub against the outside wall: rim, an empty basin with a scum line, the tap, and a shower curtain
      // bunched at one end of its rail.
      const t = 0.07;
      k.box('porcelain', lo.x, y, lo.z, hi.x, y + 0.12, hi.z);
      k.box('porcelain', lo.x, y, lo.z, lo.x + t, hi.y, hi.z);
      k.box('porcelain', hi.x - t, y, lo.z, hi.x, hi.y, hi.z);
      k.box('porcelain', lo.x, y, lo.z, hi.x, hi.y, lo.z + t);
      k.box('porcelain', lo.x, y, hi.z - t, hi.x, hi.y, hi.z);
      k.box('#b8a888', lo.x + t, y + 0.3, lo.z + t, lo.x + t + 0.004, y + 0.33, hi.z - t);
      k.box('#b8a888', lo.x + t, y + 0.3, hi.z - t - 0.004, hi.x - t, y + 0.33, hi.z - t);
      k.box('steel', hi.x - 0.2, hi.y + 0.12, (lo.z + hi.z) / 2 - 0.02, hi.x - t, hi.y + 0.16, (lo.z + hi.z) / 2 + 0.02);
      k.box('steel', lo.x + 0.02, y + 2.0, lo.z, lo.x + 0.04, y + 2.02, hi.z);
      for (let i = 0; i < 4; i++) k.box(i % 2 ? '#7ac0c8' : '#5aa0b0', lo.x - 0.03 + (i % 2) * 0.04, y + 0.5, lo.z + 0.05 + i * 0.09, lo.x + 0.03 + (i % 2) * 0.04, y + 2.0, lo.z + 0.14 + i * 0.09);
      break;
    }
    case 'sink':
      k.box('porcelain', lo.x + 0.1, y, lo.z + 0.2, hi.x - 0.05, y + 0.75, hi.z - 0.2);
      k.box('porcelain', lo.x, y + 0.75, lo.z, hi.x, hi.y, hi.z);
      break;
    case 'radiator':
      for (let x = lo.x; x < hi.x - 0.02; x += 0.07) for (let z = lo.z; z < hi.z - 0.02; z += 0.07) k.box('white', x, y + 0.08, z, x + 0.05, hi.y, z + 0.05);
      break;
    case 'hutch': {
      // A wooden hutch: cupboard below, glass shelves above, bottles lined along the top.
      k.box('wood', lo.x, y, lo.z, hi.x, y + 0.9, hi.z);
      // The glass-fronted top sits back against the wall it stands on.
      const back = wallEnd(b, 'x');
      k.box('darkwood', back < 0 ? lo.x : lo.x + 0.15, y + 0.9, lo.z, back < 0 ? hi.x - 0.15 : hi.x, hi.y, hi.z);
      const r = dice(5);
      const cols = ['bottleGreen', 'bottleClear', 'bottleBrown'];
      for (let z = lo.z + 0.08; z < hi.z - 0.05; z += 0.12) {
        const tall = 0.22 + r() * 0.14;
        const bx = (lo.x + hi.x) / 2 + (back < 0 ? -0.05 : 0.05);
        k.cyl(cols[Math.floor(r() * 3)], bx, hi.y, z, 0.035, tall);
        k.cyl(cols[Math.floor(r() * 3)], bx, hi.y + tall, z, 0.012, 0.08);
      }
      break;
    }
    case 'shelf':
      k.box('white', lo.x, y, lo.z, hi.x, hi.y, lo.z + 0.03);
      k.box('white', lo.x, y, hi.z - 0.03, hi.x, hi.y, hi.z);
      for (let s = 0; s <= 5; s++) k.box('white', lo.x, y + s * (h / 5) - 0.02, lo.z, hi.x, y + s * (h / 5), hi.z);
      for (let s = 0; s < 4; s++) for (let i = 0; i < 5; i++) k.box(['label', 'navy', 'green', 'cardboard', 'leather'][(s + i) % 5], lo.x + 0.05, y + s * (h / 5) + 0.02, lo.z + 0.08 + i * 0.22, hi.x - 0.08, y + s * (h / 5) + 0.27, lo.z + 0.24 + i * 0.22);
      break;
    case 'records': {
      // Wags's record player: a low cabinet, the turntable, a record spinning, crates of sleeves beside it.
      k.box('darkwood', lo.x, y, lo.z, hi.x, hi.y, hi.z);
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      k.box('black', cx - 0.25, hi.y, cz - 0.18, cx + 0.25, hi.y + 0.08, cz + 0.18);
      k.cyl('vinyl', cx - 0.03, hi.y + 0.08, cz, 0.15, 0.01, 24);
      k.cyl('label', cx - 0.03, hi.y + 0.09, cz, 0.05, 0.005, 16);
      for (const dx of [-0.85, 0.75]) for (let i = 0; i < 8; i++) k.box(['label', 'navy', 'green', 'cardboard'][i % 4], cx + dx + i * 0.03, hi.y, cz - 0.15, cx + dx + i * 0.03 + 0.012, hi.y + 0.31, cz + 0.15);
      break;
    }
    case 'bin':
      k.box('bluebin', lo.x, y, lo.z, hi.x, hi.y - 0.04, hi.z);
      k.box('black', lo.x - 0.02, hi.y - 0.04, lo.z - 0.02, hi.x + 0.02, hi.y, hi.z + 0.02);
      break;
    case 'junk':
      k.box('cardboard', lo.x, y, lo.z, hi.x, hi.y, hi.z);
      k.box('cardboard', lo.x + 0.1, hi.y, lo.z + 0.15, hi.x - 0.15, hi.y + 0.3, hi.z - 0.1);
      break;
    case 'beanbag': {
      const cx = (lo.x + hi.x) / 2;
      const cz = (lo.z + hi.z) / 2;
      k.cyl('beanbag', cx, y, cz, (hi.x - lo.x) / 2, 0.38, 14, (hi.x - lo.x) / 3);
      break;
    }
  }
}

/** Clutter: cans, pizza boxes, laundry, the traffic cone, a plant and a shag rug in Dev's room. */
function clutter(k: Kit) {
  const r = dice(11);
  const f = (i: number) => FLOOR_Y[i];
  // Cans on the coffee table, the dining table and the floor by the couches.
  const cans: [number, number, number][] = [
    [6, 0.42, 9.2], [6.3, 0.42, 9.5], [6.7, 0.42, 9.1], [0.5, 0.76, 7.6], [0.9, 0.76, 8.4], [7.3, 0, 11.3], [4.6, 0, 11.1], [2.5, 0, 11.6], [7.5, f(1) + 0.75, 6.1],
    [5.2, f(1) + 0.75, 18.2], [8.1, f(2) + 0.5, 4.2], [4.2, 0.92, 4.95], [5.7, 0.92, 4.9],
  ];
  for (const [x, y, z] of cans) {
    k.cyl(r() < 0.5 ? 'can' : 'canRed', x, y, z, 0.033, 0.12, 8);
  }
  // Pizza boxes.
  for (const [x, y, z, n] of [[6.5, 0.42, 9.6, 2], [4.2, 0, 2.8, 3], [6.2, f(1), 17.6, 1], [1.6, 0.92, 2.2, 1]] as [number, number, number, number][])
    for (let i = 0; i < n; i++) k.box('pizza', x - 0.2, y + i * 0.045, z - 0.2, x + 0.2, y + i * 0.045 + 0.04, z + 0.2);
  // Laundry piles in Xang's and Selby's rooms (chaos).
  for (const [x, y, z] of [[6.4, f(1), 15.6], [7.2, f(1), 18.8], [1.8, f(1), 2.2], [2.3, f(1), 5.3], [5.9, f(1), 14.2]] as [number, number, number][]) {
    k.box('laundry', x - 0.3, y, z - 0.25, x + 0.3, y + 0.12, z + 0.25);
    k.box(r() < 0.5 ? 'navy' : 'label', x - 0.15, y + 0.12, z - 0.12, x + 0.18, y + 0.2, z + 0.1);
  }
  // The traffic cone (nobody remembers where it came from).
  k.cone('cone', 3.45, 0, 13.25, 0.17, 0.7);
  k.box('cone', 3.25, 0, 13.05, 3.65, 0.04, 13.45);
  // Dev's room: a shag runner, a plant in a pot.
  k.box('rug', 5.5, f(1) + 0.002, 2.6, 6.2, f(1) + 0.02, 5.6);
  // Rugs, each with a border: the hall runner, under the coffee table, and one in most bedrooms.
  const rug = (floor: number, x0: number, z0: number, x1: number, z1: number, c1: string, c2: string) => {
    const y = f(floor);
    k.box(c1, x0, y + 0.002, z0, x1, y + 0.012, z1);
    k.box(c2, x0 + 0.08, y + 0.012, z0 + 0.08, x1 - 0.08, y + 0.014, z1 - 0.08);
    k.box(c1, x0 + 0.16, y + 0.014, z0 + 0.16, x1 - 0.16, y + 0.016, z1 - 0.16);
  };
  rug(0, 1.2, 14.2, 2.6, 19.2, '#6a2f2a', '#c8a060');
  rug(0, 5, 8.3, 7.3, 10.6, '#7a2e3a', '#d8b878');
  rug(0, 5, 15.5, 6.8, 18, '#3e5a6a', '#8aa4b0');
  rug(1, 1.6, 1.8, 3, 4.4, '#4a3a6a', '#a08ac8');
  rug(1, 1, 15, 2.8, 18.5, '#5a4a3a', '#b89a70');
  rug(1, 5.9, 15.5, 7.9, 18.8, '#5f6a3c', '#c0c890');
  rug(2, 4.5, 15.6, 7.2, 18.6, '#7a4a2a', '#e0b070');
  rug(2, 3.4, 2, 5.8, 5, '#2f4f4a', '#90b8a8');
  // Coats on hooks by the front door.
  k.box('darkwood', 0.12, f(0) + 1.62, 14.2, 0.16, f(0) + 1.72, 15.7);
  ['#2a3a5a', '#7a2a2a', '#3a3a3a', '#8a7a4a'].forEach((c, i) => {
    const z = 14.4 + i * 0.36;
    k.box('metal', 0.16, f(0) + 1.6, z - 0.01, 0.2, f(0) + 1.66, z + 0.01);
    k.box(c, 0.14, f(0) + 0.85 + (i % 2) * 0.1, z - 0.15, 0.3, f(0) + 1.62, z + 0.15);
  });
  k.cyl('pot', 4.5, f(1), 5.6, 0.16, 0.3, 10, 0.2);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.box('green', 4.5 + Math.cos(a) * 0.15 - 0.02, f(1) + 0.3, 5.6 + Math.sin(a) * 0.15 - 0.02, 4.5 + Math.cos(a) * 0.3 + 0.02, f(1) + 0.75 + r() * 0.3, 5.6 + Math.sin(a) * 0.3 + 0.02);
  }
  // The PA speaker on its nightstand, in the brick corner where the couches meet.
  k.box('wood', 7.6, 0, 12, 8.2, 0.55, 12.45);
  k.box('speaker', 7.65, 0.55, 12.05, 8.15, 1.2, 12.42);
  k.cyl('black', 7.9, 0.82, 12.03, 0.16, 0.01, 16);
  // The bathrooms, lived in: a mat by the tub, a towel over its side, half-empty bottles on the rim, a tower of
  // toilet rolls (and the empty tube nobody binned) and the plunger, on call.
  for (const [fl, tub0, tub1, tubX, loo] of [[1, 6.6, 8.3, 7.5, 12.45], [2, 10.85, 12.08, 7.65, 9.45]] as [number, number, number, number, number][]) {
    const y = f(fl);
    k.box('#4f8f86', tubX - 0.6, y + 0.002, tub0 + 0.3, tubX - 0.05, y + 0.02, tub1 - 0.3);
    k.box('#d85a6a', tubX - 0.04, y + 0.22, tub0 + 0.35, tubX + 0.07, y + 0.58, tub0 + 0.9);
    ['#2f7ab0', '#f2c53d', '#e8e8e8', '#c84a8a'].forEach((c, i) => k.cyl(c, WIDTH - 0.2, y + 0.55, tub0 + 0.18 + i * 0.13, 0.035, 0.14 + (i % 2) * 0.06, 8));
    const lz = fl === 1 ? loo - 0.25 : loo + 0.2;
    for (let i = 0; i < 4; i++) k.cyl('white', WIDTH - 0.75, y + i * 0.1, lz, 0.055, 0.1, 10);
    k.cyl('cardboard', WIDTH - 0.95, y + 0.02, lz + 0.15, 0.022, 0.1, 8);
    k.cyl('darkwood', WIDTH - 0.35, y + 0.08, lz, 0.015, 0.7, 6);
    k.cyl('#b82a2a', WIDTH - 0.35, y, lz, 0.075, 0.08, 10, 0.05);
  }
  // The wheelie bin's lid and the porch mailbox.
  k.box('black', WIDTH - 0.02, 1.3, DEPTH + 0.12, WIDTH - 0.01, 1.31, DEPTH + 0.13);
  k.box('black', 2.6, 1.15, DEPTH + 0.12, 2.9, 1.4, DEPTH + 0.2);
}

/** Curtains by room: everyone picked their own (bathrooms get a frosted blind instead). */
const CURTAINS: Record<string, [string, string]> = {
  dev: ['#3e4f6e', '#4c5f80'],
  selby: ['#5e4280', '#6e5292'],
  will: ['#7e3434', '#924040'],
  xang: ['#56653a', '#667846'],
  jung: ['#2f5f5a', '#3a706a'],
  wags: ['#8a5a2a', '#9c6a36'],
  mikol: ['#45454e', '#55555f'],
  kitchen: ['#e2c86a', '#ecd682'],
  dining: ['#6e2a2a', '#7e3434'],
  living: ['#26263a', '#32324a'],
};

/**
 * Windows and doors, finished: white casings round every opening, a cross of mullions in the glass, a sill inside,
 * and on the room side a rod with pleated curtains (or a frosted blind). Doors get thick casings on both faces.
 */
function dressing(k: Kit) {
  const { sill, head } = WINDOW_SPAN;
  /** A box on one face of a window's wall: `a` along the wall from the middle, `d` out from the face. */
  const onWall = (w: Window, side: number, c: string, a0: number, a1: number, y0: number, y1: number, d0: number, d1: number) => {
    const p0 = side * (w.t / 2 + d0);
    const p1 = side * (w.t / 2 + d1);
    if (w.axis === 'x') k.box(c, w.x + a0, y0, w.z + Math.min(p0, p1), w.x + a1, y1, w.z + Math.max(p0, p1));
    else k.box(c, w.x + Math.min(p0, p1), y0, w.z + a0, w.x + Math.max(p0, p1), y1, w.z + a1);
  };
  for (const w of WINDOWS) {
    const fy = FLOOR_Y[w.floor];
    const hw = w.w / 2;
    for (const side of [-1, 1]) {
      const probe = w.axis === 'x' ? { x: w.x, y: fy + 1, z: w.z + side * (w.t / 2 + 0.4) } : { x: w.x + side * (w.t / 2 + 0.4), y: fy + 1, z: w.z };
      const room = roomAt(probe);
      const inside = !!room && !room.outside && probe.x > 0 && probe.x < WIDTH && probe.z > 0 && probe.z < DEPTH;
      // Casing and mullions (both faces).
      onWall(w, side, 'casing', -hw - 0.07, -hw, fy + sill - 0.02, fy + head + 0.07, 0, 0.02);
      onWall(w, side, 'casing', hw, hw + 0.07, fy + sill - 0.02, fy + head + 0.07, 0, 0.02);
      onWall(w, side, 'casing', -hw - 0.07, hw + 0.07, fy + head, fy + head + 0.07, 0, 0.02);
      onWall(w, side, 'casing', -0.018, 0.018, fy + sill, fy + head, -0.01, 0.005);
      onWall(w, side, 'casing', -hw, hw, fy + (sill + head) / 2 - 0.018, fy + (sill + head) / 2 + 0.018, -0.01, 0.005);
      onWall(w, side, 'casing', -hw - 0.1, hw + 0.1, fy + sill - 0.04, fy + sill, 0, inside ? 0.08 : 0.05);
      if (!inside || !room) continue;
      if (room.id.startsWith('bath')) {
        onWall(w, side, 'frost', -hw, hw, fy + head - 0.45, fy + head, 0.03, 0.045);
        continue;
      }
      const [c1, c2] = CURTAINS[room.id] ?? ['#9a8a74', '#ab9b84'];
      onWall(w, side, 'metal', -hw - 0.36, hw + 0.36, fy + head + 0.16, fy + head + 0.185, 0.07, 0.095);
      // Two curtains drawn back to the sides, in pleats (alternating depth and tone).
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const a0 = dir < 0 ? -hw - 0.3 + i * 0.09 : hw + 0.3 - (i + 1) * 0.09;
          onWall(w, side, i % 2 ? c2 : c1, a0, a0 + 0.09, fy + sill - 0.28, fy + head + 0.16, i % 2 ? 0.06 : 0.085, i % 2 ? 0.09 : 0.11);
        }
      }
    }
  }
  // The eaves: under the roof slope, with rafters overhead, the slope coming down to a knee wall on the outside,
  // and pink insulation stuffed between the joists.
  const ey = FLOOR_Y[2];
  const top = ey + 2.4;
  for (const [z0, z1] of [[0.12, 8.4], [12.2, DEPTH - 0.12]]) {
    for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.6) k.box('rafter', 0.12, top - 0.14, z, 2.04, top, z + 0.07);
    k.slope('cardboard', 0.12, top - 1.35, 1.6, top - 0.02, z0, z1);
    for (let z = z0 + 0.4; z < z1 - 0.6; z += 2.3) k.box('insulation', 0.14, ey + 0.002, z, 0.5, ey + 0.16, z + 0.9);
  }
  // A frame and a little shelf round the bathroom mirror (world.ts's Reflector sits inside it).
  const mx = WIDTH - 0.12;
  const my = FLOOR_Y[1] + 1.55;
  const mz = 10.75;
  k.box('casing', mx - 0.04, my - 0.44, mz - 0.34, mx, my + 0.44, mz - 0.3);
  k.box('casing', mx - 0.04, my - 0.44, mz + 0.3, mx, my + 0.44, mz + 0.34);
  k.box('casing', mx - 0.04, my + 0.4, mz - 0.34, mx, my + 0.44, mz + 0.34);
  k.box('casing', mx - 0.1, my - 0.46, mz - 0.34, mx, my - 0.4, mz + 0.34);
  // Doors: a casing round both faces (exterior doors sit in thicker walls).
  const thick = new Set(['front', 'back', 'balcony', 'frontbalcony']);
  for (const d of DOORS) {
    if (d.hatch) continue;
    const fy = FLOOR_Y[d.floor];
    const t = thick.has(d.id) ? 0.24 : 0.12;
    const w: Window = { floor: d.floor, x: d.x, z: d.z, axis: d.axis, w: d.w, t };
    const hw = d.w / 2;
    for (const side of [-1, 1]) {
      onWall(w, side, 'casing', -hw - 0.08, -hw, fy, fy + DOOR_H + 0.08, 0, 0.022);
      onWall(w, side, 'casing', hw, hw + 0.08, fy, fy + DOOR_H + 0.08, 0, 0.022);
      onWall(w, side, 'casing', -hw - 0.1, hw + 0.1, fy + DOOR_H + 0.03, fy + DOOR_H + 0.12, 0, 0.03);
    }
  }
}

/** The vices, where their spots are: bongs, rolling trays, the plate, the pill. */
function vices(k: Kit) {
  for (const s of SPOTS) {
    if (s.kind === 'laptop') {
      // The Ring cam laptop, open on the coffee table.
      const { x, z } = s.pos;
      const y = s.pos.y - 0.08;
      k.box('black', x - 0.17, y, z - 0.12, x + 0.17, y + 0.02, z + 0.12);
      k.box('black', x - 0.17, y + 0.02, z - 0.13, x + 0.17, y + 0.24, z - 0.11);
      k.box('screen', x - 0.15, y + 0.04, z - 0.11, x + 0.15, y + 0.22, z - 0.105);
    }
    if (s.kind !== 'vice') continue;
    const { x, z } = s.pos;
    const y = s.pos.y - 0.04;
    // (The bongs are world.ts's own models: people pick them up.)
    if (s.vice === 'bong') continue;
    if (s.vice === 'roll') {
      k.box('black', x - 0.15, y, z - 0.1, x + 0.15, y + 0.015, z + 0.1);
      k.box('white', x - 0.06, y + 0.015, z - 0.04, x + 0.06, y + 0.018, z + 0.04);
      k.cyl('metal', x + 0.1, y + 0.015, z + 0.05, 0.03, 0.03, 10);
    } else if (s.vice === 'coke') {
      k.cyl('white', x, y, z, 0.14, 0.012, 18);
      for (const dz of [-0.04, 0, 0.04]) k.box('porcelain', x - 0.07, y + 0.012, z + dz - 0.006, x + 0.07, y + 0.016, z + dz + 0.006);
      k.box('green', x + 0.08, y + 0.012, z - 0.1, x + 0.16, y + 0.022, z + 0.02);
    } else {
      k.box('white', x - 0.04, y, z - 0.03, x + 0.04, y + 0.008, z + 0.03);
      k.cyl('cone', x + 0.07, y, z, 0.012, 0.01, 8);
    }
  }
}

/** A wall sign or flag: a plane with a canvas texture, facing along `n`. */
function sign(group: THREE.Group, owned: { dispose(): void }[], draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, at: [number, number, number], yaw: number, glow = false) {
  const c = document.createElement('canvas');
  c.width = Math.round(256 * Math.max(1, w / h));
  c.height = Math.round(256 * Math.max(1, h / w));
  draw(c.getContext('2d')!, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = glow ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp() });
  const geo = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...at);
  m.rotation.y = yaw;
  group.add(m);
  owned.push(tex, mat, geo);
}

const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, weight = 900, font = 'system-ui') => {
  g.font = `${weight} ${size}px ${font}, sans-serif`;
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
};

/** A printed photo of a housemate for the wall over the bar: a cartoon of them and a caption. */
function poster(char: CharId, caption: string) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const look = CAST[char].look;
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fb3d8';
    g.fillRect(10, 10, w - 20, h * 0.68);
    g.fillStyle = look.shirt;
    g.fillRect(w * 0.3, h * 0.48, w * 0.4, h * 0.25);
    g.fillStyle = look.skin;
    g.beginPath();
    g.arc(w / 2, h * 0.34, w * 0.17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = look.hair;
    g.beginPath();
    g.arc(w / 2, h * 0.28, w * 0.18, Math.PI, 0);
    g.fill();
    g.fillStyle = '#222';
    g.fillRect(w * 0.43, h * 0.33, 6, 6);
    g.fillRect(w * 0.55, h * 0.33, 6, 6);
    text(g, caption, w / 2, h * 0.86, Math.min(34, (w * 1.5) / caption.length), '#c0202a');
  };
}

/** Builds every prop. Returns the group and what to dispose. */
export function buildProps(): { group: THREE.Group; owned: { dispose(): void }[] } {
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const k = new Kit();
  for (const b of BOXES) if (DRAWN.has(b.mat)) furniture(k, b);
  clutter(k);
  vices(k);
  dressing(k);
  k.build(group, owned);

  const brick = (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = '#e8dccb';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 18)
      for (let x = (y / 18) % 2 ? -20 : 0; x < w; x += 40) {
        g.fillStyle = `hsl(${12 + ((x * 7 + y) % 9)}, 45%, ${44 + ((x + y * 3) % 7)}%)`;
        g.fillRect(x + 2, y + 2, 36, 14);
      }
  };
  // The faux-brick corner where the couches meet.
  sign(group, owned, brick, 0.85, 2.55, [7.85, 1.3, 12.53], Math.PI);
  sign(group, owned, brick, 1.6, 2.55, [WIDTH - 0.13, 1.3, 11.7], -Math.PI / 2);
  // The Coors flag over the leather couch, the Queen's sign above it, the Martin Garrix flag on the navy couch's wall.
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, w, h);
    text(g, 'Coors', w * 0.4, h * 0.55, h * 0.4, '#111', 900, 'Georgia');
    g.strokeStyle = '#c0202a';
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
  }, 1.4, 0.85, [5.4, 1.75, 12.53], Math.PI);
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#f7f5f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a1c2a';
    g.fillRect(0, h - 14, w, 14);
    text(g, 'Welcome to', w / 2, h * 0.28, h * 0.17, '#333', 600);
    text(g, 'GORDON BROCKINGTON HALL', w / 2, h * 0.6, h * 0.2, '#222', 800);
  }, 1.6, 0.32, [6.1, 2.38, 12.53], Math.PI);
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    text(g, 'MARTIN', w / 2, h * 0.35, w * 0.22, '#111');
    text(g, 'GARRIX', w / 2, h * 0.68, w * 0.22, '#111');
  }, 0.8, 1.3, [WIDTH - 0.13, 1.6, 8.6], -Math.PI / 2);
  // The DRINK BEER LED sign over the bar, glowing.
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    text(g, 'DRINK', w / 2, h * 0.3, h * 0.32, '#ff4040');
    text(g, 'BEER', w / 2, h * 0.72, h * 0.32, '#40ff70');
  }, 0.75, 0.4, [0.13, 2.25, 9.2], Math.PI / 2, true);
  // Printed photos of the housemates along the top of the wall over the dining room's opening.
  const posters: [CharId, string][] = [['jung', 'Andrew 3-0'], ['dev', 'We’d go to bat for you DEVLIN'], ['xang', 'XANGUS!!!'], ['selby', 'Selby? Our Jayvon?'], ['wags', 'Records after?'], ['will', 'Campus Legend'], ['jj', 'CHORE CHART'], ['mikol', 'What bro.']];
  posters.forEach(([c, cap], i) => sign(group, owned, poster(c, cap), 0.42, 0.34, [3.48, 2.3, 6.05 + i * 0.4], -Math.PI / 2));
  // Dev's blacklight Jimi Hendrix poster.
  sign(group, owned, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2a0a4a');
    grad.addColorStop(0.5, '#0a6a4a');
    grad.addColorStop(1, '#6a0a3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = ['#ff3df0', '#ffe14d', '#3dffd6'][i % 3];
      g.lineWidth = 10;
      g.beginPath();
      g.arc(w * 0.7, h * 0.2, 60 + i * 26, 0, Math.PI);
      g.stroke();
    }
    g.fillStyle = '#111';
    g.beginPath();
    g.ellipse(w * 0.45, h * 0.6, w * 0.18, h * 0.3, -0.3, 0, Math.PI * 2);
    g.fill();
    text(g, 'Jimi Hendrix', w / 2, h * 0.1, h * 0.08, '#ffe14d');
  }, 0.6, 0.9, [7.3, FLOOR_Y[1] + 1.6, 0.13], 0, true);
  // The purple flag on the front balcony railing, and the house number by the door.
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#5a3a9a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8e0ff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(w / 2, h / 2, h * 0.32, 0, Math.PI * 2);
    g.stroke();
  }, 1.1, 0.7, [2.2, FLOOR_Y[1] + 0.55, 22.23], 0);
  sign(group, owned, (g, w, h) => {
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, w, h);
    text(g, '282', w / 2, h / 2, h * 0.7, '#222', 700, 'Georgia');
  }, 0.36, 0.16, [0.6, 1.8, DEPTH + 0.13], 0);
  // The red LED strip round the top of the living room, and the drop ceiling with tiles missing.
  const led = new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false });
  const ledGeo = mergeGeometries(
    [
      [4.3, 2.5, 12.48, 8.2, 2.53, 12.5],
      [WIDTH - 0.14, 2.5, 6.2, WIDTH - 0.12, 2.53, 12.4],
    ].map(([x0, y0, z0, x1, y1, z1]) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)),
  );
  group.add(new THREE.Mesh(ledGeo, led));
  owned.push(led, ledGeo);
  const tiles = document.createElement('canvas');
  tiles.width = tiles.height = 512;
  const tg = tiles.getContext('2d')!;
  const tr = dice(17);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const missing = tr() < 0.07;
      tg.fillStyle = missing ? '#16121a' : `hsl(40, 12%, ${86 + tr() * 6}%)`;
      tg.fillRect(i * 64, j * 64, 64, 64);
      tg.strokeStyle = '#b8b2a6';
      tg.lineWidth = 3;
      tg.strokeRect(i * 64, j * 64, 64, 64);
    }
  const tileTex = new THREE.CanvasTexture(tiles);
  tileTex.colorSpace = THREE.SRGBColorSpace;
  const ceilMat = new THREE.MeshToonMaterial({ map: tileTex, gradientMap: ramp(), side: THREE.DoubleSide });
  const ceilGeo = new THREE.PlaneGeometry(WIDTH - 3.6, 7);
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(3.6 + (WIDTH - 3.6) / 2, 2.55, 9.05);
  group.add(ceil);
  owned.push(tileTex, ceilMat, ceilGeo);
  const art = buildArt();
  group.add(art.mesh);
  owned.push(...art.owned);
  return { group, owned };
}
