// 282 as data, traced from floorplans/: three floors of rooms, walls with door and window gaps, doors, the spiral
// stairs, furniture and spots (search spots, the fridge, the bell, chores). Metres, Y up. Pure: no three.js.
//
// x runs left to right as you face the house from the street (0..WIDTH), z runs from the back wall (0) to the front
// wall (DEPTH). The street is at +z. The stairs spiral up the left side with 90° turns, as the sketches show: from
// the hall a few steps go left to a corner landing, the long flight climbs toward the back along the left wall, a
// second corner, and a few steps right bring you up facing the bathroom door. The way on up starts right beside
// them (a short wall between): a flight climbs left to a half landing and doubles back, climbing right into the top hall. Doors are 1 m (a touch wider than
// the real 0.85 m: Gambol's collider is 0.8 m wide with no step-up, and a real doorway would snag it).

import type { Box } from '../../shared/collision.ts';
import { PLAYER } from '../../shared/constants.ts';
import type { Vec3 } from '../../shared/math.ts';

export const WIDTH = 8.4;
export const DEPTH = 20;
/** Top of each floor's slab. */
export const FLOOR_Y = [0, 2.8, 5.6];
/** Ceiling height per floor (floor 3 sits under the roof). */
const CEILING = [2.6, 2.6, 2.4];
const SLAB = 0.2;
/** The yards, a few steps down from the house. */
export const GROUND = -0.75;
const EXT = 0.24;
const INT = 0.12;
const DOOR_W = 1;
export const DOOR_H = 2.05;
const SILL = 0.9;
const HEAD = 2.05;
const W = WIDTH;
/** Where the kitchen's left wall stands (in from the dining room's outside wall). */
const KITCHEN_X = 1.2;

/** What a surface is made of (rendering and footstep sounds). */
export type Mat =
  | 'wood' | 'tile' | 'lino' | 'grass' | 'path' | 'porch' | 'stair' | 'stone'
  | 'wall' | 'brick' | 'trim' | 'glass' | 'ceiling' | 'rail' | 'fence' | 'neighbour' | 'tv'
  | 'bed' | 'desk' | 'couch' | 'leather' | 'table' | 'counter' | 'fridge' | 'toilet' | 'tub' | 'sink'
  | 'radiator' | 'hutch' | 'shelf' | 'records' | 'beanbag' | 'bin' | 'junk' | 'invisible' | 'banister' | 'wardrobe' | 'nightstand' | 'dresser' | 'chair' | 'firepit' | 'cooler' | 'stool' | 'ply';

export interface HBox extends Box {
  mat: Mat;
  floor: number;
  /** Rendered but not collided with (bean bags, the TV, painted paths). */
  ghost?: boolean;
}

export interface Room {
  id: string;
  name: string;
  floor: number;
  min: { x: number; z: number };
  max: { x: number; z: number };
  surface: Mat;
  outside?: boolean;
}

export interface Door {
  id: string;
  floor: number;
  /** Centre of the gap. */
  x: number;
  z: number;
  /** The wall the door sits in runs along this axis. */
  axis: 'x' | 'z';
  w: number;
  /** Hatches into the eaves are doors too, just squatter-looking. */
  hatch?: boolean;
}

/** A solid upright prism with a footprint that isn't a rectangle (the living room's triangle wall). Rendered as
 * drawn; collides as a stack of thin boxes along z. */
export interface Prism {
  floor: number;
  pts: [number, number][];
  h: number;
  /** The TV hangs on the face from pts[1] to pts[2]. */
  tv?: boolean;
}

export type ChoreKind = 'pan' | 'plunge' | 'socks' | 'recycling' | 'remote' | 'mould' | 'binbag';
type SpotKind = 'bell' | 'chore' | 'search' | 'fridge' | 'router' | 'duo' | 'fix' | 'sneak' | 'laptop' | 'vice';

export interface Spot {
  id: string;
  kind: SpotKind;
  chore?: ChoreKind;
  name: string;
  /** Where the thing is (use it from within REACH). */
  pos: Vec3;
  /** A sneak route's other end. */
  pair?: string;
  /** A vice: roll a joint here, rip a bong, a line, the pill (vices.ts). */
  vice?: 'roll' | 'bong' | 'coke' | 'pill' | 'snack' | 'water';
  /** How big it is to look at (small things on a crowded table), default 0.5 m. */
  r?: number;
}

export interface Seat {
  pos: Vec3;
  yaw: number;
}

const rooms: Room[] = [];
const boxes: HBox[] = [];
const doors: Door[] = [];
const spots: Spot[] = [];
const prisms: Prism[] = [];
/** Every window: where its middle is, which way its wall runs, how wide, how thick the wall (for frames, curtains). */
export interface Window {
  floor: number;
  x: number;
  z: number;
  axis: 'x' | 'z';
  w: number;
  t: number;
}
const windows: Window[] = [];

const box = (floor: number, mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<HBox> = {}) => {
  const kind = mat === 'wall' || mat === 'brick' ? 'wall' : mat === 'wood' || mat === 'tile' || mat === 'lino' || mat === 'grass' ? 'floor' : 'cover';
  const b: HBox = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind, mat, floor, ...extra };
  boxes.push(b);
  return b;
};

const room = (id: string, name: string, floor: number, x0: number, z0: number, x1: number, z1: number, surface: Mat = 'wood', outside = false) =>
  rooms.push({ id, name, floor, min: { x: x0, z: z0 }, max: { x: x1, z: z1 }, surface, outside });

interface Gap {
  /** Distance of the gap's centre from the wall's start. */
  at: number;
  kind: 'door' | 'window' | 'hatch';
  w?: number;
  id?: string;
}

/**
 * An axis-aligned wall from (x0,z0) to (x1,z1) on `floor`, centred on that line, split around its gaps. A door gap
 * is open to HEAD with a lintel over it (and a Door record); a window keeps a sill, a glass pane and a head.
 */
function wall(floor: number, x0: number, z0: number, x1: number, z1: number, gaps: Gap[] = [], t = INT, mat: Mat = 'wall') {
  const y0 = floor === 0 ? -0.8 : FLOOR_Y[floor];
  const y1 = floor === 2 ? FLOOR_Y[2] + CEILING[2] : FLOOR_Y[floor + 1];
  const axis: 'x' | 'z' = z0 === z1 ? 'x' : 'z';
  const a = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = axis === 'x' ? Math.max(x0, x1) : Math.max(z0, z1);
  const c = axis === 'x' ? z0 : x0;
  const seg = (s0: number, s1: number, ya: number, yb: number, m: Mat = mat) => {
    if (s1 - s0 < 1e-6 || yb - ya < 1e-6) return;
    if (axis === 'x') box(floor, m, s0, ya, c - t / 2, s1, yb, c + t / 2);
    else box(floor, m, c - t / 2, ya, s0, c + t / 2, yb, s1);
  };
  let cur = a;
  const fy = FLOOR_Y[floor];
  for (const g of [...gaps].sort((p, q) => p.at - q.at)) {
    const w = g.w ?? (g.kind === 'window' ? 1.1 : DOOR_W);
    const g0 = a + g.at - w / 2;
    const g1 = a + g.at + w / 2;
    seg(cur, g0, y0, y1);
    if (g.kind === 'window') {
      const mid = a + g.at;
      windows.push({ floor, x: axis === 'x' ? mid : c, z: axis === 'x' ? c : mid, axis, w, t });
      seg(g0, g1, y0, fy + SILL);
      seg(g0, g1, fy + SILL, fy + HEAD, 'glass');
      seg(g0, g1, fy + HEAD, y1);
    } else {
      seg(g0, g1, fy + DOOR_H + 0.05, y1);
      if (g.id) {
        const mid = a + g.at;
        doors.push({ id: g.id, floor, x: axis === 'x' ? mid : c, z: axis === 'x' ? c : mid, axis, w, hatch: g.kind === 'hatch' });
      }
    }
    cur = g1;
  }
  seg(cur, b, y0, y1);
}

/** A slab of floor (its top at the floor's height), with the matching ceiling under it. */
const slab = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number) =>
  box(floor, mat, x0, FLOOR_Y[floor] - SLAB, z0, x1, FLOOR_Y[floor], z1);

/** A walkable stair wedge (kind 'ramp'): rises from y0 to y1 along `axis` toward `rise`. */
const flight = (floor: number, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 'x' | 'z', rise: 1 | -1, mat: Mat = 'stair') =>
  boxes.push({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind: 'ramp', ramp: { axis, rise }, mat, floor });

/** Solid furniture (blocks walking, never a doorway). */
const furn = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number) =>
  box(floor, mat, x0, FLOOR_Y[floor], z0, x1, FLOOR_Y[floor] + h, z1);
const decor = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number, y = 0) =>
  box(floor, mat, x0, FLOOR_Y[floor] + y, z0, x1, FLOOR_Y[floor] + y + h, z1, { ghost: true });

const spot = (id: string, kind: SpotKind, name: string, x: number, y: number, z: number, chore?: ChoreKind, pair?: string) =>
  spots.push({ id, kind, name, pos: { x, y, z }, chore, pair });

/** A triangle (or any convex footprint) wall: drawn as a prism, collided as thin slices along z. */
function prism(p: Prism) {
  prisms.push(p);
  const zs = p.pts.map((q) => q[1]);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = z0 + ((z1 - z0) * i) / N;
    const b = z0 + ((z1 - z0) * (i + 1)) / N;
    const mid = (a + b) / 2;
    // The footprint's x extent at the slice's middle (convex: intersect each edge with z = mid).
    const xs: number[] = [];
    for (let k = 0; k < p.pts.length; k++) {
      const [ax, az] = p.pts[k];
      const [bx, bz] = p.pts[(k + 1) % p.pts.length];
      if ((mid - az) * (mid - bz) > 0 || az === bz) continue;
      xs.push(ax + ((mid - az) / (bz - az)) * (bx - ax));
    }
    if (xs.length < 2) continue;
    box(p.floor, 'invisible', Math.min(...xs), FLOOR_Y[p.floor], a, Math.max(...xs), FLOOR_Y[p.floor] + p.h, b);
  }
}

// ---------------------------------------------------------------------------------------------
// Outside: the yards, the side passages, the neighbours, the fences

box(0, 'grass', -14, GROUND - 0.5, -12, W + 14, GROUND, 34);
room('frontyard', 'the front yard', 0, -1.2, 22.2, W + 1.2, 30, 'grass', true);
room('backyard', 'the backyard', 0, -1.2, -10, W + 1.2, 0, 'grass', true);
room('sideway', 'the side passage', 0, W, 0, W + 1.2, DEPTH, 'path', true);
room('leftway', 'the gap by next door', 0, -1.2, 0, 0, DEPTH, 'path', true);
// The paths are paint on the grass (a 2 cm lip would trip the walker, which has no step-up).
box(0, 'path', W + 0.12, GROUND, -0.5, W + 1.2, GROUND + 0.01, 22.2, { ghost: true });
box(0, 'path', 1.1, GROUND, 23.4, 2.3, GROUND + 0.01, 30, { ghost: true });
// The houses next door, close on each side, and the fences that close the yards.
box(0, 'neighbour', -9, GROUND, -2, -1.2, 9, 22);
box(0, 'neighbour', W + 1.2, GROUND, -2, W + 9, 9, 22);
box(0, 'fence', -1.2, GROUND, -10.1, W + 1.2, GROUND + 1.8, -10);
box(0, 'fence', -1.3, GROUND, -10, -1.2, GROUND + 1.8, -2);
box(0, 'fence', W + 1.2, GROUND, -10, W + 1.3, GROUND + 1.8, -2);
box(0, 'fence', -1.2, GROUND, 27, 1.1, GROUND + 0.9, 27.08);
box(0, 'fence', 2.3, GROUND, 27, W + 1.2, GROUND + 0.9, 27.08);
box(0, 'fence', -1.3, GROUND, 22, -1.2, GROUND + 0.9, 27);
box(0, 'fence', W + 1.2, GROUND, 22, W + 1.3, GROUND + 0.9, 27);
// The street is out of bounds.
box(0, 'invisible', -2, GROUND, 30, W + 2, 12, 30.3);
box(0, 'invisible', -1.4, GROUND, 22, -1.2, 12, 30);
box(0, 'invisible', W + 1.2, GROUND, 22, W + 1.4, 12, 30);
box(0, 'invisible', -1.4, GROUND, -10, W + 1.4, 12, -9.8);
/** The huge bare tree out front (solid: a trunk you can hide behind). */
export const TREE = { x: 6.4, z: 24.6 };
box(0, 'invisible', TREE.x - 0.35, GROUND, TREE.z - 0.35, TREE.x + 0.35, 6, TREE.z + 0.35);

// ---------------------------------------------------------------------------------------------
// Floor 1: kitchen at the back; the dining room down the left and the living room on the right, split by the
// triangle wall with the TV; the entrance hall (with the stairs) and Mikol's room at the front; the porch.

room('stairs1', 'the stairs', 0, 0, 9.65, 1.2, 13.65, 'stair');
room('stairs1', 'the stairs', 0, 1.1, 12.65, 2.1, 13.65, 'stair');
room('kitchen', 'the kitchen', 0, KITCHEN_X, 0, W, 5.6, 'lino');
room('dining', 'the dining room', 0, 0, 5.6, 3.5, 12);
room('living', 'the living room', 0, 3.5, 5.6, W, 12.6);
room('mikol', 'Mikol’s room', 0, 3.9, 12.6, W, DEPTH);
room('hall', 'the entrance hall', 0, 0, 12, 3.9, DEPTH);
room('porch', 'the front porch', 0, 0, DEPTH, 4.4, 22.2, 'porch', true);

box(0, 'wood', -0.12, -0.8, -0.12, W + 0.12, 0, DEPTH + 0.12);
box(0, 'porch', 0, -0.8, DEPTH, 4.4, 0, 22.2);
flight(0, 1.1, 22.2, 2.3, 23.4, GROUND, 0, 'z', -1, 'porch');
flight(0, 2.1, -1.32, 3.1, -0.12, GROUND, 0, 'z', 1, 'porch');
// Porch columns and railings (a gap for the steps).
for (const x of [0.05, 4.2]) box(0, 'trim', x, 0, 21.95, x + 0.15, 2.6, 22.15);
box(0, 'rail', 0, 0, 22.1, 1.1, 0.9, 22.2);
box(0, 'rail', 2.3, 0, 22.1, 4.4, 0.9, 22.2);
box(0, 'rail', -0.05, 0, DEPTH, 0.05, 0.9, 22.2);
box(0, 'rail', 4.35, 0, DEPTH, 4.45, 0.9, 22.2);

wall(0, 0, 0, W, 0, [{ at: 2.6, kind: 'door', id: 'back' }, { at: 4.9, kind: 'window' }, { at: 6.9, kind: 'window' }], EXT, 'brick');
wall(0, 0, DEPTH, W, DEPTH, [{ at: 1.7, kind: 'door', id: 'front' }, { at: 6.1, kind: 'window' }], EXT, 'brick');
wall(0, 0, 0, 0, DEPTH, [{ at: 7, kind: 'window' }, { at: 16.5, kind: 'window', w: 0.8 }], EXT, 'brick');
wall(0, W, 0, W, DEPTH, [{ at: 4.1, kind: 'window' }, { at: 16.3, kind: 'window' }], EXT, 'brick');
// The kitchen's left wall stands in from the dining room's (the space behind it is shut off).
wall(0, KITCHEN_X, 0, KITCHEN_X, 5.6);
// The kitchen opens to the dining and living rooms around the TV block.
wall(0, 0, 5.6, 1.2, 5.6);
box(0, 'wall', 3.5, -0.8, 5.3, 6.1, FLOOR_Y[1], 5.9);
wall(0, 7.3, 5.6, W, 5.6);
// The triangle wall off the TV block; the TV on its long face looks at the corner where the couches meet.
const TRIANGLE: Prism = { floor: 0, pts: [[3.5, 5.9], [6.1, 5.9], [3.5, 9.3]], h: CEILING[0], tv: true };
prism(TRIANGLE);
// The stairs: a few steps left from the hall (A1), a corner landing, the long flight toward the back (A2), a second
// corner landing, and a few steps right (A3) up onto floor 2, facing the bathroom door. A3 runs right up to the
// landing's wall, over the dining room's way through to the hall (2.1 m under it). Beside A2 it's filled in. A wooden banister runs along A1
// and the first landing.
flight(0, 1.1, 12.65, 2.1, 13.65, 0, 0.7, 'x', -1);
box(0, 'stair', 0.12, 0, 12.65, 1.1, 0.7, 13.65);
box(0, 'stair', 0.12, 0, 10.65, 1.1, 0.7, 12.65);
flight(0, 0.12, 10.65, 1.1, 12.65, 0.7, 2.1, 'z', -1);
box(0, 'stair', 0.12, 0, 9.65, 1.3, 2.1, 10.65);
box(0, 'stair', 1.3, 0, 9.65, 2.1, 2.1, 10.65);
flight(0, 1.3, 9.65, 3.2, 10.65, 2.1, FLOOR_Y[1], 'x', 1);
box(0, 'wall', 1.1, -0.8, 10.65, 2.1, FLOOR_Y[1] - SLAB, 12.65);
// The stairs' back wall above the second landing and alongside A3, up to the ceiling (else a slot shows the dining room).
box(0, 'wall', 0.12, 2.1, 9.6, 3.2, FLOOR_Y[1] - SLAB, 9.65);
box(0, 'banister', 1.1, 0, 13.65, 2.1, 1.25, 13.73);
box(0, 'banister', 0.12, 0.7, 13.65, 1.1, 1.65, 13.73);
wall(0, 3.9, 12.6, 3.9, DEPTH, [{ at: 5, kind: 'door', id: 'mikol' }]);
wall(0, 3.9, 12.6, W, 12.6);

// Kitchen (traced from the kitchen sketch): the fridge, a short counter and the tall pantry along the left wall; the
// back door beside the fridge; an L of counters along the back and right walls with the stove on the right; in the
// middle an L of counter: the sink run on the TV block's kitchen side, and a peninsula back from its left end with
// three stools along its outside. The bins by the back door.
furn(0, 'fridge', KITCHEN_X + 0.06, 0.15, KITCHEN_X + 0.8, 1.05, 1.85);
furn(0, 'counter', KITCHEN_X + 0.06, 1.05, KITCHEN_X + 0.72, 2.85, 0.92);
furn(0, 'wardrobe', KITCHEN_X + 0.06, 2.95, KITCHEN_X + 0.72, 5.45, 2.1);
furn(0, 'counter', 4.6, 0.12, W - 0.12, 0.76, 0.92);
furn(0, 'counter', W - 0.76, 0.76, W - 0.12, 5.1, 0.92);
furn(0, 'counter', 3.3, 4.62, 6.1, 5.3, 0.92);
furn(0, 'counter', 3.3, 2.1, 3.96, 4.62, 0.92);
for (const z of [2.6, 3.3, 4.0]) furn(0, 'stool', 2.88, z - 0.18, 3.24, z + 0.18, 0.7);
furn(0, 'bin', 3.35, 0.15, 3.78, 0.65, 0.7);
// Dining: the long table against the outside wall, the hutch with the bottles (and the bell) on the triangle wall
// across from it, the empties by the kitchen opening.
furn(0, 'table', 0.12, 6.6, 1.22, 9.2, 0.76);
furn(0, 'hutch', 3.02, 6.9, 3.48, 8.7, 1.9);
furn(0, 'bin', 2.9, 6.02, 3.45, 6.58, 0.5);
// Living: the navy couch along the right, the black leather couch along Mikol's wall, the coffee table.
furn(0, 'couch', 7.5, 6.9, W - 0.12, 10.9, 0.85);
furn(0, 'leather', 4.3, 11.55, 7.4, 12.5, 0.85);
furn(0, 'table', 5.6, 8.9, 6.9, 9.8, 0.42);
// Mikol's room: bed in the back corner, the desk by the front window, a radiator under the other window.
furn(0, 'bed', 6.9, 12.72, W - 0.12, 14.9, 0.55);
furn(0, 'desk', 7.5, 17.9, W - 0.12, 19.4, 0.75);
furn(0, 'radiator', 5.6, 19.66, 6.6, 19.86, 0.6);
furn(0, 'wardrobe', 4.0, 12.72, 4.62, 14.2, 2);
furn(0, 'nightstand', 6.4, 12.72, 6.85, 13.15, 0.55);
furn(0, 'dresser', 4.0, 15, 4.48, 16.4, 0.85);
// The porch recycling, and the router on a little shelf by the front door.
furn(0, 'bin', 3.5, 21.3, 4.2, 22, 0.7);
furn(0, 'shelf', 3.4, 19.4, 3.84, 19.86, 0.9);

// ---------------------------------------------------------------------------------------------
// Floor 2 (traced from floor2.jpg): the landing is a plain rectangle. Its stair wall has the way down and the way up;
// Selby's and Dev's doors are on its back wall, Will Palmer's and Xang's on its front wall, each facing the other;
// the bathroom door is at the far end. The covered balcony is behind Selby, the front balcony in front of Will. The long flight from the hall arrives at the back of its well (L2). The way up doubles back: flight C
// climbs left from the landing to a half landing by the well, then flight D climbs right into the top hall. The
// whole stair block is solid underneath, and railed where it meets the landing.

/**
 * The way up to floor 3, right beside the top of A3 (a short wall between them): flight C climbs left to a half
 * landing over the first flight's well, then flight D doubles back and climbs right into the top hall. Under D and
 * the back of the half landing it's solid; over the well the landing is a slab, with headroom for A2 below.
 */
const SB = { x0: 0.12, x1: 1.1, x2: 3.2, z0: 8.55, zD: 9.55, zA: 9.65, zA1: 10.65, zC: 10.75, z1: 11.75 };
const HALF = 4.5;
/** The floor-2 landing (a rectangle), where the rooms either side divide, and the doors' places along it. */
const L2 = { x0: SB.x2, x1: 6.6, z0: 6.5, z1: 13.4 };
const MID = 4.9;
const DOOR_A = 3.95;
const DOOR_B = 5.85;

room('stairs2', 'the stairs', 1, SB.x0, SB.z0, SB.x1, SB.z1, 'stair');
room('stairs2', 'the stairs', 1, SB.x1, SB.z0, SB.x2, SB.zA, 'stair');
room('stairs2', 'the stairs', 1, SB.x1, SB.zA, SB.x2, SB.zA1, 'stair');
room('stairs2', 'the stairs', 1, SB.x1, SB.zA1, SB.x2, SB.z1, 'stair');
room('selby', 'Selby’s room', 1, 0, 0, MID, L2.z0);
room('dev', 'Dev’s room', 1, MID, 0, W, L2.z0);
room('bath2', 'the bathroom', 1, L2.x1, L2.z0, W, L2.z1, 'tile');
room('xang', 'Xang’s room', 1, MID, L2.z1, W, DEPTH);
room('will', 'Will Palmer’s room', 1, 0, L2.z1, MID, DEPTH);
room('landing', 'the landing', 1, L2.x0, L2.z0, L2.x1, L2.z1);
room('balcony', 'the covered balcony', 1, 0, -3.2, 4.05, 0, 'porch', true);
room('frontbalcony', 'the front balcony', 1, 0, DEPTH, 4.4, 22.2, 'porch', true);

// The slab, with the well over A2 and A3 cut out of it.
slab(1, 'wood', -0.12, -0.12, W + 0.12, SB.zA);
slab(1, 'wood', SB.x2, SB.zA, W + 0.12, SB.zA1);
slab(1, 'wood', SB.x1, SB.zA1, W + 0.12, 13.34);
slab(1, 'wood', -0.12, 13.34, W + 0.12, DEPTH + 0.12);
slab(1, 'porch', 0, -3.2, 4.05, -0.12);
slab(1, 'porch', 0, DEPTH + 0.12, 4.4, 22.2);
// Flight C, the half landing, flight D (each solid underneath where there's floor below).
flight(1, SB.x1, SB.zC, SB.x2, SB.z1, FLOOR_Y[1], HALF, 'x', -1);
box(1, 'stair', SB.x0, FLOOR_Y[1], SB.z0, SB.x1, HALF, SB.zA);
box(1, 'stair', SB.x0, HALF - 0.12, SB.zA, SB.x1, HALF, SB.z1);
box(1, 'wall', SB.x1, FLOOR_Y[1], SB.z0, SB.x2, HALF, SB.zD);
flight(1, SB.x1, SB.z0, SB.x2, SB.zD, HALF, FLOOR_Y[2], 'x', 1);
// The short wall between A3 and C, the wall between A3 and D, the back wall, C's side wall, the banisters.
box(1, 'wall', SB.x1, 2.1, SB.zA1, SB.x2, HALF + 1, SB.zC);
box(1, 'wall', SB.x1, FLOOR_Y[1], SB.zD, SB.x2, FLOOR_Y[2] + 1, SB.zA);
box(1, 'wall', SB.x0, FLOOR_Y[1], SB.z0 - 0.08, SB.x2, FLOOR_Y[2] + 1, SB.z0);
box(1, 'wall', SB.x1, FLOOR_Y[1], SB.z1, SB.x2, HALF + 1, SB.z1 + 0.08);
box(1, 'banister', SB.x0, HALF, SB.z1, SB.x1, HALF + 1, SB.z1 + 0.08);
// Balcony railings and posts.
box(1, 'rail', 0, FLOOR_Y[1], -3.2, 4.05, FLOOR_Y[1] + 1, -3.12);
box(1, 'rail', -0.05, FLOOR_Y[1], -3.2, 0.05, FLOOR_Y[1] + 1, -0.12);
box(1, 'rail', 4, FLOOR_Y[1], -3.2, 4.1, FLOOR_Y[1] + 1, -0.12);
for (const x of [0, 3.9]) box(1, 'trim', x, GROUND, -3.2, x + 0.15, FLOOR_Y[2] - 0.4, -3.05);
box(1, 'trim', -0.1, FLOOR_Y[2] - 0.4, -3.3, 4.15, FLOOR_Y[2] - 0.3, -0.12);
box(1, 'rail', 0, FLOOR_Y[1], 22.1, 4.4, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', -0.05, FLOOR_Y[1], DEPTH + 0.12, 0.05, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', 4.35, FLOOR_Y[1], DEPTH + 0.12, 4.45, FLOOR_Y[1] + 1, 22.2);

wall(1, 0, 0, W, 0, [{ at: 2, kind: 'door', id: 'balcony' }, { at: 6.2, kind: 'window' }], EXT, 'brick');
wall(1, 0, DEPTH, W, DEPTH, [{ at: 1.7, kind: 'door', id: 'frontbalcony' }, { at: 6.5, kind: 'window' }], EXT, 'brick');
wall(1, 0, 0, 0, DEPTH, [{ at: 3, kind: 'window' }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, W, 0, W, DEPTH, [{ at: 3, kind: 'window' }, { at: 9.6, kind: 'window', w: 0.7 }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, 0, L2.z0, W, L2.z0, [{ at: DOOR_A, kind: 'door', id: 'selby' }, { at: DOOR_B, kind: 'door', id: 'dev' }]);
wall(1, 0, L2.z1, W, L2.z1, [{ at: DOOR_A, kind: 'door', id: 'will' }, { at: DOOR_B, kind: 'door', id: 'xang' }]);
wall(1, MID, 0, MID, L2.z0);
wall(1, MID, L2.z1, MID, DEPTH);
wall(1, L2.x1, L2.z0, L2.x1, L2.z1, [{ at: 10.15 - L2.z0, kind: 'door', id: 'bath2' }]);
// The landing's stair wall: the way down (A3 arriving) and the way up (the foot of C), walls either side.
wall(1, L2.x0, L2.z0, L2.x0, SB.z0);
wall(1, L2.x0, SB.z1, L2.x0, L2.z1);

// Selby: bed in the front-left corner, the Bike Stu desk on the right wall. Dev: bed in the back-right corner, the
// desk by the door, the bookshelf. The bathroom: tub at the back, sink, toilet at the front. Xang: bed in the
// back-right corner, desk down the left wall. Will: desk in the back-left corner, bed along the right wall.
furn(1, 'bed', 0.12, 4.3, 1.2, 6.44, 0.5);
furn(1, 'desk', 4.25, 2, 4.84, 4.6, 0.75);
furn(1, 'radiator', 0.12, 1.6, 0.3, 2.8, 0.6);
furn(1, 'wardrobe', 3.2, 0.12, 4.84, 0.72, 2);
furn(1, 'nightstand', 0.12, 3.8, 0.55, 4.25, 0.55);
furn(1, 'bed', 6.3, 0.12, W - 0.12, 2.1, 0.55);
furn(1, 'nightstand', 5.8, 0.12, 6.25, 0.55, 0.55);
furn(1, 'dresser', 4.96, 3.3, 5.45, 4.8, 0.85);
furn(1, 'desk', 6.9, 5.8, 8.1, 6.44, 0.75);
furn(1, 'shelf', 4.96, 0.8, 5.3, 2.2, 1.8);
furn(1, 'radiator', W - 0.3, 3.2, W - 0.12, 4.4, 0.6);
furn(1, 'tub', 7.5, 6.6, W - 0.12, 8.3, 0.55);
furn(1, 'sink', 7.8, 10.4, W - 0.12, 11.1, 0.85);
furn(1, 'toilet', 7.75, 12.45, W - 0.12, 13.32, 0.45);
furn(1, 'bed', 6.6, 13.5, W - 0.12, 15.6, 0.5);
furn(1, 'desk', 4.96, 16.8, 5.55, 19.86, 0.75);
furn(1, 'bed', 3.2, 15.4, 4.88, 19.86, 0.5);
furn(1, 'desk', 0.12, 13.5, 2.4, 14.1, 0.75);
furn(1, 'radiator', 0.12, 15.8, 0.3, 17, 0.6);
furn(1, 'wardrobe', 0.12, 18.2, 0.72, 19.86, 2);
furn(1, 'nightstand', 2.7, 19.4, 3.15, 19.86, 0.55);
furn(1, 'wardrobe', 7.7, 17.4, W - 0.12, 19.0, 2);
furn(1, 'nightstand', 6.6, 15.65, 7.05, 16.1, 0.55);
furn(1, 'bin', 3, -3.05, 3.8, -2.4, 0.7);

// ---------------------------------------------------------------------------------------------
// Floor 3: the top hall is a rectangle: the stairs on one side (flight D arrives from the left), Jung's door on its
// back wall and Wags's facing it on the front wall, the top bathroom's door at the far end. The eaves storage down
// the left is only reached through hatches in Jung's and Wags's rooms, never from the hall.

room('stairs3', 'the stairs', 2, SB.x0, SB.z0, SB.x2, SB.z1, 'stair');
room('jung', 'Jung’s room', 2, 2.1, 0, W, 8.45);
room('bath3', 'the top bathroom', 2, 6.4, 8.45, W, 12.15, 'tile');
room('hall3', 'the top hall', 2, SB.x2, 8.45, 6.4, 12.15);
room('wags', 'Wags’s room', 2, 2.1, 12.15, W, DEPTH);
room('eaves', 'the back eaves', 2, 0, 0, 2.1, 8.45, 'ply');
room('eaves2', 'the front eaves', 2, 0, 12.15, 2.1, DEPTH, 'ply');

slab(2, 'wood', -0.12, -0.12, W + 0.12, SB.z0);
slab(2, 'wood', SB.x2, SB.z0, W + 0.12, SB.z1);
slab(2, 'wood', -0.12, SB.z1, W + 0.12, DEPTH + 0.12);
// Banisters round the stair well on the top floor, past the top of flight D.
box(2, 'banister', SB.x2 - 0.04, FLOOR_Y[2], SB.zD, SB.x2 + 0.04, FLOOR_Y[2] + 1, SB.z1);
box(2, 'banister', SB.x0, FLOOR_Y[2], SB.z1, SB.x2, FLOOR_Y[2] + 1, SB.z1 + 0.08);
// The roof's underside (the ceiling).
box(2, 'ceiling', -0.12, FLOOR_Y[2] + CEILING[2], -0.12, W + 0.12, FLOOR_Y[2] + CEILING[2] + 0.2, DEPTH + 0.12);

wall(2, 0, 0, W, 0, [{ at: 5.4, kind: 'window' }], EXT, 'brick');
wall(2, 0, DEPTH, W, DEPTH, [{ at: 5, kind: 'window', w: 1.4 }], EXT, 'brick');
wall(2, 0, 0, 0, DEPTH, [], EXT, 'brick');
wall(2, W, 0, W, DEPTH, [{ at: 3.4, kind: 'window' }, { at: 9.4, kind: 'window', w: 0.7 }, { at: 16.4, kind: 'window' }], EXT, 'brick');
wall(2, 2.1, 0, 2.1, 8.45, [{ at: 5.5, kind: 'hatch', id: 'hatch-back', w: 0.9 }]);
wall(2, 0, 8.45, W, 8.45, [{ at: 4.8, kind: 'door', id: 'jung' }]);
wall(2, 0, 12.15, W, 12.15, [{ at: 4.8, kind: 'door', id: 'wags' }]);
wall(2, 6.4, 8.45, 6.4, 12.15, [{ at: 1.85, kind: 'door', id: 'bath3' }]);
wall(2, 2.1, 12.15, 2.1, DEPTH, [{ at: 3.8, kind: 'hatch', id: 'hatch-front', w: 0.9 }]);

furn(2, 'desk', 2.2, 0.8, 2.8, 3.8, 0.75);
furn(2, 'bed', 6.7, 3.4, W - 0.12, 6.4, 0.5);
furn(2, 'wardrobe', 2.2, 6.2, 2.78, 7.8, 2);
furn(2, 'nightstand', 6.25, 6.0, 6.65, 6.4, 0.55);
furn(2, 'toilet', 7.75, 8.57, W - 0.12, 9.45, 0.45);
furn(2, 'sink', 7.8, 10, W - 0.12, 10.7, 0.85);
furn(2, 'tub', 7.65, 10.85, W - 0.12, 12.08, 0.55);
furn(2, 'bed', 6.9, 12.3, W - 0.12, 15, 0.5);
furn(2, 'records', 3.8, 19.4, 5.9, 19.88, 0.8);
furn(2, 'radiator', W - 0.3, 17.5, W - 0.12, 18.7, 0.6);
furn(2, 'nightstand', 6.45, 12.3, 6.85, 12.7, 0.55);
furn(2, 'wardrobe', 6.6, 19.3, 8.2, 19.88, 2);
decor(2, 'beanbag', 4.2, 16.4, 5, 17.2, 0.45);
// Eaves junk: boxes against the outer wall, a path left along the inside.
for (const z of [0.6, 2.4, 4.3, 6.4, 13.2, 15.6, 17.8]) furn(2, 'junk', 0.12, z, 0.9, z + 0.9, 0.7 + (z % 1) * 0.4);

// ---------------------------------------------------------------------------------------------
// Spots

spot('bell', 'bell', 'Bang the pot (call a house meeting)', 3.25, 1.3, 7.2);
spot('fridge', 'fridge', 'Look at the fridge (the case board)', KITCHEN_X + 0.82, 1.2, 0.6);
spot('router', 'router', 'the router', 3.62, 1.05, 19.63);
// Two-person chores: one person at each end, holding E together (or Shota alone).
spot('duo-sofa-a', 'duo', 'Lift one end of the sofa', 7.9, 0.6, 7.2);
spot('duo-sofa-b', 'duo', 'Lift the other end of the sofa', 7.9, 0.6, 10.6);
spot('duo-mattress-a', 'duo', 'Grab one side of Mikol’s mattress', 7.6, 0.6, 15.2);
spot('duo-mattress-b', 'duo', 'Grab the other side of Mikol’s mattress', 6.6, 0.6, 13.8);
spot('pan-kitchen', 'chore', 'Scrub the pan in the sink', 4.8, 0.95, 4.85, 'pan');
spot('pan-xang', 'chore', 'Scrub the pan on Xang’s desk', 5.3, 3.55, 18.4, 'pan');
spot('pan-jung', 'chore', 'Scrub the pan under Jung’s desk', 2.5, 6.35, 2.3, 'pan');
spot('plunge-2', 'chore', 'Plunge the toilet', 8, 3.25, 12.85, 'plunge');
spot('plunge-3', 'chore', 'Plunge the top toilet', 8, 6.05, 9.0, 'plunge');
spot('socks-mikol', 'chore', 'Pair the socks on Mikol’s radiator', 6.1, 0.6, 19.76, 'socks');
spot('socks-dev', 'chore', 'Pair the socks on Dev’s radiator', W - 0.21, 3.4, 3.8, 'socks');
spot('socks-will', 'chore', 'Pair the socks on Will’s radiator', 0.21, 3.4, 16.4, 'socks');
spot('socks-wags', 'chore', 'Pair the socks on Wags’s radiator', W - 0.21, 6.2, 18.1, 'socks');
spot('recycle-kitchen', 'chore', 'Sort the kitchen recycling', 3.56, 0.7, 0.4, 'recycling');
spot('recycle-dining', 'chore', 'Sort the empties in the dining room', 3.17, 0.5, 6.3, 'recycling');
spot('recycle-porch', 'chore', 'Sort the porch recycling', 3.85, 0.7, 21.65, 'recycling');
spot('recycle-balcony', 'chore', 'Sort the balcony recycling', 3.4, 3.5, -2.7, 'recycling');
spot('remote-sofa', 'chore', 'Find the remote in the sofa', 7.9, 0.5, 9.4, 'remote');
spot('remote-leather', 'chore', 'Find the remote in the leather couch', 6.6, 0.5, 12, 'remote');
spot('mould-2', 'chore', 'Wipe the mould off the bathroom ceiling', 7.6, 5.1, 7.4, 'mould');
spot('mould-3', 'chore', 'Wipe the mould off the top bathroom ceiling', 7.2, 7.7, 11.4, 'mould');
// The walking chore: pick the bag up here, drop it in the wheelie bin out back.
spot('binbag', 'chore', 'Take the kitchen bin bag out to the wheelie bin', 3.56, 0.7, 0.4, 'binbag');
// Sabotage fixes.
spot('fix-fuse', 'fix', 'Flip the trip switch at the fuse box', 4.2, 1.5, 0.15);
spot('fix-stopcock', 'fix', 'Shut the stopcock under the sink', 5.5, 0.3, 4.55);
spot('fix-plunge', 'fix', 'Plunge the overflowing toilet', 8, 3.25, 12.85);
spot('fix-alarm', 'fix', 'Wave a tea towel under the smoke alarm', 2.2, 2.3, 15.5);
spot('fix-router', 'fix', 'Reboot the router', 3.62, 1.05, 19.63);
// Sneak routes (Degenerates only): out a window, along a roof, in somewhere else.
spot('sneak-bath3', 'sneak', 'Climb out the top bathroom window', 8, 6.4, 9.4, undefined, 'sneak-yard');
spot('sneak-yard', 'sneak', 'Shin up the drainpipe to the top bathroom', 8.9, -0.2, -2.8, undefined, 'sneak-bath3');
spot('sneak-eaves', 'sneak', 'Squeeze out the eaves vent', 0.6, 6.2, 19.2, undefined, 'sneak-balcony');
spot('sneak-balcony', 'sneak', 'Climb up into the eaves vent', 0.8, 3.4, 21.6, undefined, 'sneak-eaves');
spot('sneak-kitchen', 'sneak', 'Slip out the kitchen window', W - 0.45, 1.3, 4.1, undefined, 'sneak-gap');
spot('sneak-gap', 'sneak', 'Climb in the kitchen window', W + 0.6, -0.2, 4.1, undefined, 'sneak-kitchen');
// The Ring cam laptop on the coffee table.
spot('laptop', 'laptop', 'Watch the Ring cam', 6.25, 0.5, 9.35);
// The house's vices: rolling trays, bongs, the plate, the pill.
const vice = (id: string, v: NonNullable<Spot['vice']>, name: string, x: number, y: number, z: number) => spots.push({ id, kind: 'vice', vice: v, name, pos: { x, y, z }, r: 0.28 });
vice('roll-dining', 'roll', 'Roll a joint', 0.7, 0.82, 7.2);
vice('roll-jung', 'roll', 'Roll a joint', 2.5, 6.4, 3.3);
vice('bong-living', 'bong', 'the coffee-table bong', 6.8, 0.6, 9.05);
vice('bong-xang', 'bong', 'Xang’s bong', 5.3, 3.75, 17.7);
vice('bong-selby', 'bong', 'the Bike Stu bong', 4.55, 3.75, 4.1);
vice('bong-mikol', 'bong', 'Mikol’s bong', 8.05, 0.95, 18.4);
vice('coke', 'coke', 'Do a line off the plate', 5.75, 0.46, 9.6);
vice('pill', 'pill', 'Take the mystery pill', 0.8, 0.8, 8.8);
// Ways to come down a bit: the pantry (the munchies) and cold water at the bathroom sinks.
vice('snack', 'snack', 'Raid the pantry', KITCHEN_X + 0.8, 1.2, 4.2);
vice('water-2', 'water', 'Splash cold water on your face', 7.85, FLOOR_Y[1] + 0.95, 10.75);
vice('water-3', 'water', 'Splash cold water on your face', 7.85, FLOOR_Y[2] + 0.95, 10.35);
// Search spots: where hidden clues land (hold E to dig through them).
spot('s-kitchen-bin', 'search', 'the kitchen bin', 3.56, 0.7, 0.4);
spot('s-kitchen-drawer', 'search', 'the junk drawer', KITCHEN_X + 0.7, 0.9, 2.2);
spot('s-hutch', 'search', 'the hutch cupboard', 3.1, 0.8, 7.9);
spot('s-sofa', 'search', 'the sofa cushions', 7.9, 0.5, 8.8);
spot('s-leather', 'search', 'the leather couch cushions', 5.8, 0.5, 12);
spot('s-mikol-bed', 'search', 'under Mikol’s bed', 7.6, 0.3, 14);
spot('s-hall-shoes', 'search', 'the shoe pile by the door', 0.5, 0.2, 18.5);
spot('s-selby-bed', 'search', 'under Selby’s bed', 0.7, 3.1, 5.4);
spot('s-selby-desk', 'search', 'the Bike Stu desk', 4.55, 3.6, 2.8);
spot('s-dev-shelf', 'search', 'Dev’s bookshelf', 5.15, 3.9, 1.5);
spot('s-dev-bed', 'search', 'under Dev’s bed', 7.2, 3.1, 1.2);
spot('s-bath2-cabinet', 'search', 'the bathroom cabinet', 8.05, 4.4, 10.75);
spot('s-xang-bed', 'search', 'under Xang’s bed', 7.5, 3.1, 14.5);
spot('s-xang-floor', 'search', 'Xang’s floordrobe', 6, 3, 18.4);
spot('s-will-bed', 'search', 'under Will’s bed', 4, 3.1, 17.5);
spot('s-will-desk', 'search', 'Will’s desk drawer', 0.9, 3.6, 13.8);
spot('s-balcony', 'search', 'the balcony junk', 1, 3.1, -2.6);
spot('s-jung-desk', 'search', 'Jung’s desk', 2.5, 6.4, 1.5);
spot('s-jung-bed', 'search', 'under Jung’s bed', 7.5, 5.9, 5);
spot('s-bath3-cabinet', 'search', 'the top bathroom cabinet', 8.05, 7.2, 10.35);
spot('s-wags-records', 'search', 'the record crates', 4.8, 6.4, 19.6);
spot('s-wags-bed', 'search', 'under Wags’s bed', 7.6, 5.9, 13.6);
spot('s-eaves', 'search', 'the eaves boxes', 0.5, 6.2, 4.7);
spot('s-eaves2', 'search', 'the front eaves boxes', 0.5, 6.2, 16);
box(0, 'bin', 8.6, GROUND, -2, 9.3, GROUND + 1.1, -1.2);
/** The backyard: a fire pit ringed with lawn chairs, and a cooler. */
export const FIREPIT = { x: 4.5, z: -6 };
box(0, 'firepit', FIREPIT.x - 0.5, GROUND, FIREPIT.z - 0.5, FIREPIT.x + 0.5, GROUND + 0.35, FIREPIT.z + 0.5);
for (const [x, z] of [[3.1, -6.6], [5.9, -5.4], [4.2, -7.5], [5.2, -7.3]]) box(0, 'chair', x - 0.28, GROUND, z - 0.28, x + 0.28, GROUND + 0.85, z + 0.28);
box(0, 'cooler', 6.3, GROUND, -7.4, 6.9, GROUND + 0.45, -7.0);
spot('s-wheelie', 'search', 'the wheelie bin', 8.95, -0.1, -1.6);
spot('s-sink', 'search', 'the tower of dishes (wash up)', 4.8, 1.1, 4.85);
/** Where the walking chore's bin bag goes. */
export const BINBAG_DROP = { x: 8.95, y: -0.1, z: -1.6 };

/** Where everyone sits for a house meeting: the two couches, then bean bags around the coffee table. */
const TABLE = { x: 6.25, z: 9.35 };
const seatAt = (x: number, z: number): Seat => ({ pos: { x, y: 0, z }, yaw: Math.atan2(x - TABLE.x, z - TABLE.z) });
export const SEATS: Seat[] = [
  seatAt(4.9, 12), seatAt(5.9, 12), seatAt(6.9, 12),
  seatAt(7.9, 7.6), seatAt(7.9, 8.8), seatAt(7.9, 10),
  seatAt(6.6, 7.4), seatAt(5.6, 7.9), seatAt(4.9, 8.9), seatAt(4.6, 10.1), seatAt(5.1, 11), seatAt(7.1, 10.9),
];
// Bean bags under the seats that aren't on a couch.
for (const s of SEATS.slice(6)) decor(0, 'beanbag', s.pos.x - 0.35, s.pos.z - 0.35, s.pos.x + 0.35, s.pos.z + 0.35, 0.4);
export const MEETING_CENTRE = { x: TABLE.x, y: 0.45, z: TABLE.z };

/**
 * Everywhere you can sit down whenever you like: every couch cushion, the edge of every bed, the bean bags and the
 * toilets, facing away from the wall they're against (bean bags face the middle of the room).
 */
export const PERCHES: Seat[] = [];
for (const b of boxes) {
  if (b.mat === 'chair') {
    const c = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 };
    PERCHES.push({ pos: { x: c.x, y: b.min.y, z: c.z }, yaw: Math.atan2(-(FIREPIT.x - c.x), -(FIREPIT.z - c.z)) });
    continue;
  }
  if (b.mat === 'stool') {
    PERCHES.push({ pos: { x: (b.min.x + b.max.x) / 2, y: FLOOR_Y[b.floor], z: (b.min.z + b.max.z) / 2 }, yaw: -Math.PI / 2 });
    continue;
  }
  if (!['couch', 'leather', 'bed', 'beanbag', 'toilet'].includes(b.mat)) continue;
  const c = { x: (b.min.x + b.max.x) / 2, y: FLOOR_Y[b.floor], z: (b.min.z + b.max.z) / 2 };
  const r = rooms.find((q) => q.floor === b.floor && c.x >= q.min.x && c.x <= q.max.x && c.z >= q.min.z && c.z <= q.max.z);
  if (!r) continue;
  const longX = b.max.x - b.min.x > b.max.z - b.min.z;
  const depth = longX ? 'z' : 'x';
  const along = longX ? 'x' : 'z';
  // Face away from the nearer wall (bean bags: toward the middle of the room).
  const mid = (r.min[depth] + r.max[depth]) / 2;
  const out = b.mat === 'beanbag' ? (c[depth] < mid ? 1 : -1) : b.min[depth] - r.min[depth] < r.max[depth] - b.max[depth] ? 1 : -1;
  const len = b.max[along] - b.min[along];
  const n = b.mat === 'beanbag' || b.mat === 'toilet' ? 1 : Math.max(1, Math.floor(len / 0.8));
  // On a bed you sit on its edge; on anything else, in the middle of the cushion.
  const d = b.mat === 'bed' ? (out > 0 ? b.max[depth] - 0.3 : b.min[depth] + 0.3) : c[depth];
  for (let i = 0; i < n; i++) {
    const a = b.min[along] + ((i + 0.5) * len) / n;
    const pos = longX ? { x: a, y: c.y, z: d } : { x: d, y: c.y, z: a };
    const fx = depth === 'x' ? out : 0;
    const fz = depth === 'z' ? out : 0;
    PERCHES.push({ pos, yaw: Math.atan2(-fx, -fz) });
  }
}

export const ROOMS: readonly Room[] = rooms;
export const BOXES: readonly HBox[] = boxes;
/** Everything walkers collide with (doors come and go on top of this). */
export const SOLIDS: readonly HBox[] = boxes.filter((b) => !b.ghost);
export const DOORS: readonly Door[] = doors;
export const SPOTS: readonly Spot[] = spots;
export const PRISMS: readonly Prism[] = prisms;
export const WINDOWS: readonly Window[] = windows;
/** A window's sill and head heights above its floor. */
export const WINDOW_SPAN = { sill: SILL, head: HEAD };
export const CHORE_KINDS: ChoreKind[] = ['pan', 'plunge', 'socks', 'recycling', 'remote', 'mould', 'binbag'];
/** How many chores each player gets (different kinds). */
export const TASKS_EACH = 4;
/** The two-person chores: [end A, end B, what it is]. Each counts as two chores on the bar. */
export const DUO_PAIRS: [string, string, string][] = [
  ['duo-sofa-a', 'duo-sofa-b', 'carried the sofa'],
  ['duo-mattress-a', 'duo-mattress-b', 'flipped Mikol’s mattress'],
];
/** Use things (doors, chores, bodies, the bell) from this far. */
export const REACH = 2;

/** Which floor a height belongs to (feet on it, or mid-flight up to it). */
export const floorOf = (y: number) => (y >= FLOOR_Y[2] - 0.6 ? 2 : y >= FLOOR_Y[1] - 0.6 ? 1 : 0);

/** The room at a position (the most specific one: stairs and inner rooms are listed before what they sit in). */
export function roomAt(p: Vec3): Room | null {
  const f = floorOf(p.y);
  for (const r of rooms) if (r.floor === f && p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z) return r;
  return null;
}

const roomById = (id: string) => rooms.find((r) => r.id === id);

/** The collision box of a shut door (a thin leaf in the gap). */
export function doorBox(d: Door): HBox {
  const y0 = FLOOR_Y[d.floor];
  const half = d.w / 2;
  const t = 0.05;
  return d.axis === 'x'
    ? { min: { x: d.x - half, y: y0, z: d.z - t }, max: { x: d.x + half, y: y0 + DOOR_H, z: d.z + t }, kind: 'wall', mat: 'trim', floor: d.floor }
    : { min: { x: d.x - t, y: y0, z: d.z - half }, max: { x: d.x + t, y: y0 + DOOR_H, z: d.z + half }, kind: 'wall', mat: 'trim', floor: d.floor };
}

/** Is a standing player at `p` clear of every solid? */
export function clearAt(p: Vec3): boolean {
  const hw = PLAYER.halfWidth;
  return !SOLIDS.some(
    (b) =>
      !b.ramp &&
      p.x - hw < b.max.x && p.x + hw > b.min.x && p.y + 0.05 < b.max.y && p.y + PLAYER.height > b.min.y && p.z - hw < b.max.z && p.z + hw > b.min.z,
  );
}

/** Where you end up getting off a seat: a step out in front of it, else beside it, else back off it (a bar stool). */
export function standFrom(p: Seat): Vec3 {
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  for (const [f, s] of [[0.75, 0], [0.95, 0], [1.2, 0], [0.5, 0.9], [0.5, -0.9], [0.95, 0.9], [0.95, -0.9], [0.95, 1.4], [0.95, -1.4], [0.2, 1.1], [0.2, -1.1], [-0.6, 0], [-0.75, 0]]) {
    const at = { x: p.pos.x + fx * f - fz * s, y: p.pos.y, z: p.pos.z + fz * f + fx * s };
    if (clearAt(at)) return at;
  }
  return { x: p.pos.x + fx * 0.95, y: p.pos.y + 0.6, z: p.pos.z + fz * 0.95 };
}

/** Where to wake up in a room: spread around so roommates don't stack. */
export function wakeSpot(roomId: string, i: number): Vec3 {
  const r = roomById(roomId) ?? roomById('living')!;
  const lists: Record<string, [number, number][]> = {
    living: [[6.2, 10.7], [5, 10.6], [7, 10.5], [5.8, 7.2], [6.9, 7.3], [4.3, 9.8]],
    mikol: [[5.6, 15.5], [6.4, 17], [4.9, 17.4], [5.6, 18.6]],
    will: [[1.6, 15.4], [2.3, 15], [1.4, 16.6], [2.2, 17.6]],
    selby: [[2.2, 3.4], [1.5, 1], [2.4, 5.6], [1.4, 3.4]],
  };
  const list = lists[roomId];
  if (list) {
    const [x, z] = list[i % list.length];
    return { x, y: FLOOR_Y[r.floor], z };
  }
  const cx = (r.min.x + r.max.x) / 2;
  const cz = (r.min.z + r.max.z) / 2;
  return { x: cx + (i % 2) * 0.9 - 0.45, y: FLOOR_Y[r.floor], z: cz + Math.floor(i / 2) * 0.9 };
}

/**
 * A clear spot on the floor of a room for a clue to lie on, picked with `rand` (0..1). Tries a few places and
 * falls back to the room's middle. Clues lie a little apart from each other (`taken`).
 */
export function floorSpot(roomId: string, rand: () => number, taken: readonly Vec3[] = []): Vec3 {
  const rs = rooms.filter((r) => r.id === roomId);
  const r = rs[Math.floor(rand() * rs.length)] ?? roomById('living')!;
  for (let k = 0; k < 40; k++) {
    const p = { x: r.min.x + 0.5 + rand() * (r.max.x - r.min.x - 1), y: FLOOR_Y[r.floor], z: r.min.z + 0.5 + rand() * (r.max.z - r.min.z - 1) };
    if (clearAt(p) && taken.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.7)) return p;
  }
  return { x: (r.min.x + r.max.x) / 2, y: FLOOR_Y[r.floor], z: (r.min.z + r.max.z) / 2 };
}

/** Search spots in (or by) a room. */
export const searchesIn = (roomId: string) => spots.filter((s) => s.kind === 'search' && roomAt(s.pos)?.id === roomId);

/** Lamp positions: one under the ceiling of each indoor room. */
export const LAMPS: Vec3[] = rooms
  .filter((r) => !r.outside && !r.id.startsWith('stairs') && r.max.x - r.min.x > 1.5)
  .map((r) => ({ x: (r.min.x + r.max.x) / 2, y: FLOOR_Y[r.floor] + CEILING[r.floor] - 0.35, z: (r.min.z + r.max.z) / 2 }));
