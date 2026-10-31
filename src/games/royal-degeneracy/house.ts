// 282 as data, traced from floorplans/: three floors of rooms, walls with door and window gaps, doors, the spiral
// stairs, furniture and spots (search spots, the fridge, the bell, chores). Metres, Y up. Pure: no three.js.
//
// x runs left to right as you face the house from the street (0..WIDTH), z runs from the back wall (0) to the front
// wall (DEPTH). The street is at +z. The stairs spiral up the left side with 90° turns, as the sketches show: from
// the hall a few steps go left to a corner landing, the long flight climbs toward the back along the left wall,
// then on floor 2 it turns right and climbs toward the right into the top hall. Doors are 1 m (a touch wider than
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

/** What a surface is made of (rendering and footstep sounds). */
export type Mat =
  | 'wood' | 'tile' | 'lino' | 'grass' | 'path' | 'porch' | 'stair' | 'stone'
  | 'wall' | 'brick' | 'trim' | 'glass' | 'ceiling' | 'rail' | 'fence' | 'neighbour' | 'tv'
  | 'bed' | 'desk' | 'couch' | 'leather' | 'table' | 'counter' | 'fridge' | 'toilet' | 'tub' | 'sink'
  | 'radiator' | 'hutch' | 'shelf' | 'records' | 'beanbag' | 'bin' | 'junk' | 'invisible';

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
  vice?: 'roll' | 'bong' | 'coke' | 'pill';
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
  const y1 = FLOOR_Y[floor] + (floor === 2 ? CEILING[2] : FLOOR_Y[1]);
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
room('kitchen', 'the kitchen', 0, 0, 0, W, 5.6, 'lino');
room('dining', 'the dining room', 0, 0, 5.6, 3.5, 12);
room('living', 'the living room', 0, 3.5, 5.6, W, 12.6);
room('mikol', 'Mikol’s room', 0, 3.9, 12.6, W, DEPTH);
room('hall', 'the entrance hall', 0, 0, 12, 3.9, DEPTH);
room('porch', 'the front porch', 0, 0, DEPTH, 4.4, 22.2, 'porch', true);

box(0, 'wood', -0.12, -0.8, -0.12, W + 0.12, 0, DEPTH + 0.12);
box(0, 'porch', 0, -0.8, DEPTH, 4.4, 0, 22.2);
flight(0, 1.1, 22.2, 2.3, 23.4, GROUND, 0, 'z', -1, 'porch');
flight(0, 1.4, -1.32, 2.4, -0.12, GROUND, 0, 'z', 1, 'porch');
// Porch columns and railings (a gap for the steps).
for (const x of [0.05, 4.2]) box(0, 'trim', x, 0, 21.95, x + 0.15, 2.6, 22.15);
box(0, 'rail', 0, 0, 22.1, 1.1, 0.9, 22.2);
box(0, 'rail', 2.3, 0, 22.1, 4.4, 0.9, 22.2);
box(0, 'rail', -0.05, 0, DEPTH, 0.05, 0.9, 22.2);
box(0, 'rail', 4.35, 0, DEPTH, 4.45, 0.9, 22.2);

wall(0, 0, 0, W, 0, [{ at: 1.9, kind: 'door', id: 'back' }, { at: 4.6, kind: 'window' }, { at: 6.9, kind: 'window' }], EXT, 'brick');
wall(0, 0, DEPTH, W, DEPTH, [{ at: 1.7, kind: 'door', id: 'front' }, { at: 6.1, kind: 'window' }], EXT, 'brick');
wall(0, 0, 0, 0, DEPTH, [{ at: 2.6, kind: 'window' }, { at: 7, kind: 'window' }, { at: 16.5, kind: 'window', w: 0.8 }], EXT, 'brick');
wall(0, W, 0, W, DEPTH, [{ at: 2.6, kind: 'window' }, { at: 8.6, kind: 'window' }, { at: 16.3, kind: 'window' }], EXT, 'brick');
// The kitchen opens to the dining and living rooms around the TV block.
wall(0, 0, 5.6, 1.2, 5.6);
box(0, 'wall', 3.5, -0.8, 5.3, 6.1, FLOOR_Y[1], 5.9);
wall(0, 7.3, 5.6, W, 5.6);
// The triangle wall off the TV block; the TV on its long face looks at the corner where the couches meet.
const TRIANGLE: Prism = { floor: 0, pts: [[3.5, 5.9], [6.1, 5.9], [3.5, 9.3]], h: CEILING[0], tv: true };
prism(TRIANGLE);
// The stairs: a few steps left from the hall (A1), a corner landing, then the long flight toward the back (A2)
// boxed in on the dining side. A2 starts at the landing's height, so it sits on a solid base. The well above A2
// reaches 0.66 m past its foot, or your head would catch the floor above on the first steps.
flight(0, 1.1, 12.65, 2.1, 13.65, 0, 0.7, 'x', -1);
box(0, 'stair', 0.12, 0, 12.65, 1.1, 0.7, 13.65);
box(0, 'stair', 0.12, 0, 9.65, 1.1, 0.7, 12.65);
flight(0, 0.12, 9.65, 1.1, 12.65, 0.7, FLOOR_Y[1], 'z', -1);
box(0, 'rail', 0.12, 0, 13.65, 2.1, 1.6, 13.72);
wall(0, 1.25, 9.65, 1.25, 12.65, [], 0.1);
wall(0, 3.9, 12.6, 3.9, DEPTH, [{ at: 5, kind: 'door', id: 'mikol' }]);
wall(0, 3.9, 12.6, W, 12.6);

// Kitchen: counters along the back and right, the fridge and stove on the left, a little table, the bins.
furn(0, 'counter', 2.9, 0.12, W - 0.12, 0.75, 0.92);
furn(0, 'counter', W - 0.75, 0.75, W - 0.12, 4.2, 0.92);
furn(0, 'fridge', 0.12, 0.4, 0.95, 1.2, 1.85);
furn(0, 'counter', 0.12, 1.3, 0.75, 3.6, 0.92);
furn(0, 'table', 3.4, 2.3, 4.8, 3.3, 0.76);
furn(0, 'bin', 2.45, 0.15, 2.88, 0.65, 0.7);
// Dining: the hutch with the bottles (and the bell), the long table, the empties by the stairs.
furn(0, 'hutch', 0.12, 6, 0.6, 7.8, 1.9);
furn(0, 'table', 1.6, 6.6, 2.8, 9.2, 0.76);
furn(0, 'bin', 1.35, 11.2, 2, 11.85, 0.5);
// Living: the navy couch along the right, the black leather couch along Mikol's wall, the coffee table.
furn(0, 'couch', 7.5, 6.9, W - 0.12, 10.9, 0.85);
furn(0, 'leather', 4.3, 11.55, 7.4, 12.5, 0.85);
furn(0, 'table', 5.6, 8.9, 6.9, 9.8, 0.42);
// Mikol's room: bed in the back corner, the desk by the front window, a radiator under the other window.
furn(0, 'bed', 6.9, 12.72, W - 0.12, 14.9, 0.55);
furn(0, 'desk', 7.5, 17.9, W - 0.12, 19.4, 0.75);
furn(0, 'radiator', 5.6, 19.66, 6.6, 19.86, 0.6);
// The porch recycling, and the router on a little shelf by the front door.
furn(0, 'bin', 3.5, 21.3, 4.2, 22, 0.7);
furn(0, 'shelf', 3.4, 19.4, 3.84, 19.86, 0.9);

// ---------------------------------------------------------------------------------------------
// Floor 2: Selby (back left) with the covered balcony behind, Dev (back right), the bathroom (middle right),
// Xang (front right), Will Palmer (front left) with the front balcony, the landing in the middle. The stairs arrive
// at the back of the well (landing L2) and turn right up flight B along Selby's wall.

room('stairs2', 'the stairs', 1, 0, 8.81, 1.2, 13.34, 'stair');
room('stairs2', 'the stairs', 1, 2.3, 8.81, 5.5, 9.9, 'stair');
room('selby', 'Selby’s room', 1, 0, 0, 4, 8.75);
room('dev', 'Dev’s room', 1, 4, 0, W, 6.2);
room('bath2', 'the bathroom', 1, 6.6, 6.2, W, 13.4, 'tile');
room('xang', 'Xang’s room', 1, 4.7, 13.4, W, DEPTH);
room('will', 'Will Palmer’s room', 1, 0, 13.4, 4.7, DEPTH);
room('landing', 'the landing', 1, 0, 6.2, 6.6, 13.4);
room('balcony', 'the covered balcony', 1, 0, -3.2, 4, 0, 'porch', true);
room('frontbalcony', 'the front balcony', 1, 0, DEPTH, 4.4, 22.2, 'porch', true);

// The slab, with the well over A1 and A2 cut out of it.
slab(1, 'wood', -0.12, -0.12, W + 0.12, 9.65);
slab(1, 'wood', 1.2, 9.65, W + 0.12, 13.34);
slab(1, 'wood', -0.12, 13.34, W + 0.12, DEPTH + 0.12);
slab(1, 'porch', 0, -3.2, 4, -0.12);
slab(1, 'porch', 0, DEPTH + 0.12, 4.4, 22.2);
// Flight B: turn right at the top of A2, along a short walkway (which opens onto the landing), then climb toward
// the right, walled on both sides up to the top floor.
flight(1, 2.3, 8.81, 5.5, 9.9, FLOOR_Y[1], FLOOR_Y[2], 'x', 1);
box(1, 'wall', 2.3, FLOOR_Y[1], 9.9, 5.5, FLOOR_Y[2] - 0.2, 10);
box(1, 'rail', 1.2, FLOOR_Y[1], 10, 1.3, FLOOR_Y[1] + 1, 13.34);
// Balcony railings and posts.
box(1, 'rail', 0, FLOOR_Y[1], -3.2, 4, FLOOR_Y[1] + 1, -3.12);
box(1, 'rail', -0.05, FLOOR_Y[1], -3.2, 0.05, FLOOR_Y[1] + 1, -0.12);
box(1, 'rail', 3.95, FLOOR_Y[1], -3.2, 4.05, FLOOR_Y[1] + 1, -0.12);
for (const x of [0, 3.85]) box(1, 'trim', x, GROUND, -3.2, x + 0.15, FLOOR_Y[2] - 0.4, -3.05);
box(1, 'trim', -0.1, FLOOR_Y[2] - 0.4, -3.3, 4.1, FLOOR_Y[2] - 0.3, -0.12);
box(1, 'rail', 0, FLOOR_Y[1], 22.1, 4.4, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', -0.05, FLOOR_Y[1], DEPTH + 0.12, 0.05, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', 4.35, FLOOR_Y[1], DEPTH + 0.12, 4.45, FLOOR_Y[1] + 1, 22.2);

wall(1, 0, 0, W, 0, [{ at: 2, kind: 'door', id: 'balcony' }, { at: 6.2, kind: 'window' }], EXT, 'brick');
wall(1, 0, DEPTH, W, DEPTH, [{ at: 1.7, kind: 'door', id: 'frontbalcony' }, { at: 6.5, kind: 'window' }], EXT, 'brick');
wall(1, 0, 0, 0, DEPTH, [{ at: 4, kind: 'window' }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, W, 0, W, DEPTH, [{ at: 3, kind: 'window' }, { at: 10.4, kind: 'window', w: 0.7 }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, 0, 8.75, 5.5, 8.75);
wall(1, 4, 0, 4, 8.75, [{ at: 7.5, kind: 'door', id: 'selby' }]);
wall(1, 4, 6.2, W, 6.2, [{ at: 1, kind: 'door', id: 'dev' }]);
wall(1, 6.6, 6.2, 6.6, 13.4, [{ at: 4.4, kind: 'door', id: 'bath2' }]);
wall(1, 0, 13.4, W, 13.4, [{ at: 3.7, kind: 'door', id: 'will' }, { at: 5.5, kind: 'door', id: 'xang' }]);
wall(1, 4.7, 13.4, 4.7, DEPTH);

furn(1, 'bed', 0.12, 6.2, 1.3, 8.69, 0.5);
furn(1, 'desk', 3.4, 1.4, 3.94, 4, 0.75);
furn(1, 'radiator', 0.12, 3.4, 0.3, 4.6, 0.6);
furn(1, 'bed', 6.4, 0.12, W - 0.12, 2.2, 0.55);
furn(1, 'desk', 6.9, 5.5, 8.1, 6.14, 0.75);
furn(1, 'shelf', 4.06, 0.8, 4.4, 2.2, 1.8);
furn(1, 'radiator', W - 0.3, 3.2, W - 0.12, 4.4, 0.6);
furn(1, 'tub', 7.5, 6.3, W - 0.12, 8, 0.55);
furn(1, 'sink', 7.8, 10.8, W - 0.12, 11.5, 0.85);
furn(1, 'toilet', 7.75, 12.4, W - 0.12, 13.3, 0.45);
furn(1, 'bed', 6.9, 13.5, W - 0.12, 15.6, 0.5);
furn(1, 'desk', 4.8, 17.2, 5.4, 19.86, 0.75);
furn(1, 'bed', 2.9, 16.5, 4.62, 19.86, 0.5);
furn(1, 'desk', 0.12, 13.5, 1.8, 14.1, 0.75);
furn(1, 'radiator', 0.12, 15.8, 0.3, 17, 0.6);
furn(1, 'bin', 3, -3.05, 3.8, -2.4, 0.7);

// ---------------------------------------------------------------------------------------------
// Floor 3: Jung (back), the bathroom (middle right), Wags (front). The stairs arrive into the top hall; the eaves
// storage down the left is only reached through hatches in Jung's and Wags's rooms, never from the hall.

room('stairs3', 'the stairs', 2, 2.3, 8.81, 5.5, 9.9, 'stair');
room('jung', 'Jung’s room', 2, 2.1, 0, W, 6.5);
room('jung', 'Jung’s room', 2, 2.1, 6.5, 4.4, 8.75);
room('bath3', 'the top bathroom', 2, 6.4, 6.5, W, 12.2, 'tile');
room('hall3', 'the top hall', 2, 4.4, 6.5, 6.4, 12.2);
room('wags', 'Wags’s room', 2, 2.1, 12.2, W, DEPTH);
room('wags', 'Wags’s room', 2, 2.1, 9.95, 4.4, 12.2);
room('eaves', 'the back eaves', 2, 0, 0, 2.1, 8.75, 'stair');
room('eaves2', 'the front eaves', 2, 0, 9.95, 2.1, DEPTH, 'stair');

slab(2, 'wood', -0.12, -0.12, W + 0.12, 8.81);
slab(2, 'wood', -0.12, 8.81, 2.3, 9.9);
slab(2, 'wood', 5.5, 8.81, W + 0.12, 9.9);
// Rails where the well cuts through the top hall.
box(2, 'rail', 4.4, FLOOR_Y[2], 8.69, 5.5, FLOOR_Y[2] + 1, 8.81);
box(2, 'rail', 4.4, FLOOR_Y[2], 9.89, 5.5, FLOOR_Y[2] + 1, 10.01);
slab(2, 'wood', -0.12, 9.9, W + 0.12, DEPTH + 0.12);
// The roof's underside (the ceiling).
box(2, 'ceiling', -0.12, FLOOR_Y[2] + CEILING[2], -0.12, W + 0.12, FLOOR_Y[2] + CEILING[2] + 0.2, DEPTH + 0.12);

wall(2, 0, 0, W, 0, [{ at: 5.4, kind: 'window' }], EXT, 'brick');
wall(2, 0, DEPTH, W, DEPTH, [{ at: 5, kind: 'window', w: 1.4 }], EXT, 'brick');
wall(2, 0, 0, 0, DEPTH, [], EXT, 'brick');
wall(2, W, 0, W, DEPTH, [{ at: 3.4, kind: 'window' }, { at: 9.4, kind: 'window', w: 0.7 }, { at: 16.4, kind: 'window' }], EXT, 'brick');
wall(2, 2.1, 0, 2.1, 8.75, [{ at: 5.5, kind: 'hatch', id: 'hatch-back', w: 0.9 }]);
wall(2, 0, 8.75, 4.4, 8.75);
wall(2, 4.4, 6.5, 4.4, 8.75);
wall(2, 4.4, 6.5, W, 6.5, [{ at: 0.65, kind: 'door', id: 'jung' }]);
wall(2, 6.4, 6.5, 6.4, 12.2, [{ at: 4, kind: 'door', id: 'bath3' }]);
wall(2, 0, 9.95, 4.4, 9.95);
wall(2, 4.4, 9.95, 4.4, 12.2);
wall(2, 4.4, 12.2, W, 12.2, [{ at: 0.65, kind: 'door', id: 'wags' }]);
wall(2, 2.1, 9.95, 2.1, DEPTH, [{ at: 6, kind: 'hatch', id: 'hatch-front', w: 0.9 }]);

furn(2, 'desk', 2.2, 0.8, 2.8, 3.8, 0.75);
furn(2, 'bed', 6.7, 3.4, W - 0.12, 6.4, 0.5);
furn(2, 'toilet', 7.75, 6.62, W - 0.12, 7.5, 0.45);
furn(2, 'sink', 7.8, 8.2, W - 0.12, 8.9, 0.85);
furn(2, 'tub', 7.65, 10.4, W - 0.12, 12.1, 0.55);
furn(2, 'bed', 6.9, 12.3, W - 0.12, 15, 0.5);
furn(2, 'records', 3.8, 19.4, 5.9, 19.88, 0.8);
furn(2, 'radiator', W - 0.3, 17.5, W - 0.12, 18.7, 0.6);
decor(2, 'beanbag', 4.2, 16.4, 5, 17.2, 0.45);
// Eaves junk: boxes against the outer wall, a path left along the inside.
for (const z of [0.6, 2.4, 4.3, 6.4, 11, 13.2, 15.6, 17.8]) furn(2, 'junk', 0.12, z, 0.9, z + 0.9, 0.7 + (z % 1) * 0.4);

// ---------------------------------------------------------------------------------------------
// Spots

spot('bell', 'bell', 'Bang the pot (call a house meeting)', 0.75, 1.3, 6.9);
spot('fridge', 'fridge', 'Look at the fridge (the case board)', 0.95, 1.2, 0.8);
spot('router', 'router', 'the router', 3.62, 1.05, 19.63);
// Two-person chores: one person at each end, holding E together (or Shota alone).
spot('duo-sofa-a', 'duo', 'Lift one end of the sofa', 7.9, 0.6, 7.2);
spot('duo-sofa-b', 'duo', 'Lift the other end of the sofa', 7.9, 0.6, 10.6);
spot('duo-mattress-a', 'duo', 'Grab one side of Mikol’s mattress', 7.6, 0.6, 15.2);
spot('duo-mattress-b', 'duo', 'Grab the other side of Mikol’s mattress', 6.6, 0.6, 13.8);
spot('pan-kitchen', 'chore', 'Scrub the pan in the sink', 5.6, 0.95, 0.45, 'pan');
spot('pan-xang', 'chore', 'Scrub the pan on Xang’s desk', 5.1, 3.55, 18.4, 'pan');
spot('pan-jung', 'chore', 'Scrub the pan under Jung’s desk', 2.5, 6.35, 2.3, 'pan');
spot('plunge-2', 'chore', 'Plunge the toilet', 8, 3.25, 12.85, 'plunge');
spot('plunge-3', 'chore', 'Plunge the top toilet', 8, 6.05, 7.05, 'plunge');
spot('socks-mikol', 'chore', 'Pair the socks on Mikol’s radiator', 6.1, 0.6, 19.76, 'socks');
spot('socks-dev', 'chore', 'Pair the socks on Dev’s radiator', W - 0.21, 3.4, 3.8, 'socks');
spot('socks-will', 'chore', 'Pair the socks on Will’s radiator', 0.21, 3.4, 16.4, 'socks');
spot('socks-wags', 'chore', 'Pair the socks on Wags’s radiator', W - 0.21, 6.2, 18.1, 'socks');
spot('recycle-kitchen', 'chore', 'Sort the kitchen recycling', 2.66, 0.7, 0.4, 'recycling');
spot('recycle-dining', 'chore', 'Sort the empties by the stairs', 1.68, 0.5, 11.5, 'recycling');
spot('recycle-porch', 'chore', 'Sort the porch recycling', 3.85, 0.7, 21.65, 'recycling');
spot('recycle-balcony', 'chore', 'Sort the balcony recycling', 3.4, 3.5, -2.7, 'recycling');
spot('remote-sofa', 'chore', 'Find the remote in the sofa', 7.9, 0.5, 9.4, 'remote');
spot('remote-leather', 'chore', 'Find the remote in the leather couch', 6.6, 0.5, 12, 'remote');
spot('mould-2', 'chore', 'Wipe the mould off the bathroom ceiling', 7.6, 5.1, 7.4, 'mould');
spot('mould-3', 'chore', 'Wipe the mould off the top bathroom ceiling', 7.2, 7.7, 11.4, 'mould');
// The walking chore: pick the bag up here, drop it in the wheelie bin out back.
spot('binbag', 'chore', 'Take the kitchen bin bag out to the wheelie bin', 2.66, 0.7, 0.4, 'binbag');
// Sabotage fixes.
spot('fix-fuse', 'fix', 'Flip the trip switch at the fuse box', 0.2, 1.5, 4.4);
spot('fix-stopcock', 'fix', 'Shut the stopcock under the sink', 6.4, 0.3, 0.45);
spot('fix-plunge', 'fix', 'Plunge the overflowing toilet', 8, 3.25, 12.85);
spot('fix-alarm', 'fix', 'Wave a tea towel under the smoke alarm', 2.2, 2.3, 15.5);
spot('fix-router', 'fix', 'Reboot the router', 3.62, 1.05, 19.63);
// Sneak routes (Degenerates only): out a window, along a roof, in somewhere else.
spot('sneak-bath3', 'sneak', 'Climb out the top bathroom window', 8, 6.4, 9.4, undefined, 'sneak-yard');
spot('sneak-yard', 'sneak', 'Shin up the drainpipe to the top bathroom', 8.9, -0.2, -2.8, undefined, 'sneak-bath3');
spot('sneak-eaves', 'sneak', 'Squeeze out the eaves vent', 0.6, 6.2, 19.2, undefined, 'sneak-balcony');
spot('sneak-balcony', 'sneak', 'Climb up into the eaves vent', 0.8, 3.4, 21.6, undefined, 'sneak-eaves');
spot('sneak-kitchen', 'sneak', 'Slip out the kitchen window', 0.7, 1.2, 3.4, undefined, 'sneak-gap');
spot('sneak-gap', 'sneak', 'Climb in the kitchen window', -0.6, -0.2, 3.4, undefined, 'sneak-kitchen');
// The Ring cam laptop on the coffee table.
spot('laptop', 'laptop', 'Watch the Ring cam', 6.25, 0.5, 9.35);
// The house's vices: rolling trays, bongs, the plate, the pill.
const vice = (id: string, v: 'roll' | 'bong' | 'coke' | 'pill', name: string, x: number, y: number, z: number) => spots.push({ id, kind: 'vice', vice: v, name, pos: { x, y, z }, r: 0.28 });
vice('roll-dining', 'roll', 'Roll a joint', 2.2, 0.82, 7.1);
vice('roll-jung', 'roll', 'Roll a joint', 2.5, 6.4, 3.3);
vice('bong-living', 'bong', 'the coffee-table bong', 6.8, 0.6, 9.05);
vice('bong-xang', 'bong', 'Xang’s bong', 5.1, 3.75, 17.7);
vice('bong-selby', 'bong', 'the Bike Stu bong', 3.65, 3.75, 3.4);
vice('bong-mikol', 'bong', 'Mikol’s bong', 8.05, 0.95, 18.4);
vice('coke', 'coke', 'Do a line off the plate', 5.75, 0.46, 9.6);
vice('pill', 'pill', 'Take the mystery pill', 2.7, 0.8, 8.7);
// Search spots: where hidden clues land (hold E to dig through them).
spot('s-kitchen-bin', 'search', 'the kitchen bin', 2.66, 0.7, 0.4);
spot('s-kitchen-drawer', 'search', 'the junk drawer', 0.45, 0.9, 2.5);
spot('s-hutch', 'search', 'the hutch cupboard', 0.4, 0.8, 7.2);
spot('s-sofa', 'search', 'the sofa cushions', 7.9, 0.5, 8.8);
spot('s-leather', 'search', 'the leather couch cushions', 5.8, 0.5, 12);
spot('s-mikol-bed', 'search', 'under Mikol’s bed', 7.6, 0.3, 14);
spot('s-hall-shoes', 'search', 'the shoe pile by the door', 0.5, 0.2, 18.5);
spot('s-selby-bed', 'search', 'under Selby’s bed', 0.7, 3.1, 7.4);
spot('s-selby-desk', 'search', 'the Bike Stu desk', 3.65, 3.6, 2.6);
spot('s-dev-shelf', 'search', 'Dev’s bookshelf', 4.25, 3.9, 1.5);
spot('s-dev-bed', 'search', 'under Dev’s bed', 7.2, 3.1, 1.2);
spot('s-bath2-cabinet', 'search', 'the bathroom cabinet', 8.05, 4.4, 11.15);
spot('s-xang-bed', 'search', 'under Xang’s bed', 7.6, 3.1, 14.6);
spot('s-xang-floor', 'search', 'Xang’s floordrobe', 6, 3, 18.4);
spot('s-will-bed', 'search', 'under Will’s bed', 3.7, 3.1, 17.5);
spot('s-will-desk', 'search', 'Will’s desk drawer', 0.9, 3.6, 13.8);
spot('s-balcony', 'search', 'the balcony junk', 1, 3.1, -2.6);
spot('s-jung-desk', 'search', 'Jung’s desk', 2.5, 6.4, 1.5);
spot('s-jung-bed', 'search', 'under Jung’s bed', 7.5, 5.9, 5);
spot('s-bath3-cabinet', 'search', 'the top bathroom cabinet', 8.05, 7.2, 8.55);
spot('s-wags-records', 'search', 'the record crates', 4.8, 6.4, 19.6);
spot('s-wags-bed', 'search', 'under Wags’s bed', 7.6, 5.9, 13.6);
spot('s-eaves', 'search', 'the eaves boxes', 0.5, 6.2, 4.7);
spot('s-eaves2', 'search', 'the front eaves boxes', 0.5, 6.2, 16);
box(0, 'bin', 8.6, GROUND, -2, 9.3, GROUND + 1.1, -1.2);
spot('s-wheelie', 'search', 'the wheelie bin', 8.95, -0.1, -1.6);
spot('s-sink', 'search', 'the tower of dishes (wash up)', 5.6, 1.1, 0.45);
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

export const ROOMS: readonly Room[] = rooms;
export const BOXES: readonly HBox[] = boxes;
/** Everything walkers collide with (doors come and go on top of this). */
export const SOLIDS: readonly HBox[] = boxes.filter((b) => !b.ghost);
export const DOORS: readonly Door[] = doors;
export const SPOTS: readonly Spot[] = spots;
export const PRISMS: readonly Prism[] = prisms;
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

/** Where to wake up in a room: spread around so roommates don't stack. */
export function wakeSpot(roomId: string, i: number): Vec3 {
  const r = roomById(roomId) ?? roomById('living')!;
  const lists: Record<string, [number, number][]> = {
    living: [[6.2, 10.7], [5, 10.6], [7, 10.5], [5.8, 7.2], [6.9, 7.3], [4.3, 9.8]],
    mikol: [[5.6, 15.5], [6.4, 17], [4.9, 17.4], [5.6, 18.6]],
    will: [[1.6, 15.4], [2.3, 15], [1.4, 16.6], [2.2, 17.6]],
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
