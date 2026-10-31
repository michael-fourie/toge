// 282 as data, traced from floorplans/: three floors of rooms, walls with door and window gaps, doors, the two
// stair flights, furniture and spots (wake-ups, meeting seats, the bell, chores). Metres, Y up. Pure: no three.js.
//
// x runs left to right as you face the house from the street (0..WIDTH), z runs from the back wall (0) to the front
// wall (DEPTH). The street is at +z. The stairs stack in a core on the left: flight A climbs floor 1 → 2 toward
// the back along the left wall, flight B climbs floor 2 → 3 toward the front beside it. Doors are 1 m (a touch
// wider than the real 0.85 m: Gambol's collider is 0.8 m wide and a real doorway would snag it).

import type { Box } from '../../shared/collision.ts';
import type { Vec3 } from '../../shared/math.ts';

export const WIDTH = 9.6;
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

/** What a surface is made of (rendering and footstep sounds). */
export type Mat =
  | 'wood' | 'tile' | 'lino' | 'grass' | 'path' | 'porch' | 'stair' | 'stone'
  | 'wall' | 'brick' | 'trim' | 'glass' | 'ceiling' | 'rail' | 'fence' | 'neighbour' | 'tv'
  | 'bed' | 'desk' | 'couch' | 'leather' | 'table' | 'counter' | 'fridge' | 'toilet' | 'tub' | 'sink'
  | 'radiator' | 'hutch' | 'shelf' | 'records' | 'beanbag' | 'bin' | 'junk' | 'invisible';

export interface HBox extends Box {
  mat: Mat;
  floor: number;
  /** Rendered but not collided with (bean bags, the TV, glass you can't reach). */
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

export type ChoreKind = 'pan' | 'plunge' | 'socks' | 'recycling';
type SpotKind = 'bell' | 'chore';

export interface Spot {
  id: string;
  kind: SpotKind;
  chore?: ChoreKind;
  name: string;
  /** Where the thing is (use it from within REACH). */
  pos: Vec3;
}

export interface Seat {
  pos: Vec3;
  yaw: number;
}

const rooms: Room[] = [];
const boxes: HBox[] = [];
const doors: Door[] = [];
const spots: Spot[] = [];

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
function wall(floor: number, x0: number, z0: number, x1: number, z1: number, gaps: Gap[] = [], t = INT, mat: Mat = 'wall', top?: number) {
  const y0 = floor === 0 ? -0.8 : FLOOR_Y[floor];
  const y1 = top ?? FLOOR_Y[floor] + (floor === 2 ? CEILING[2] : FLOOR_Y[1]);
  const axis: 'x' | 'z' = z0 === z1 ? 'x' : 'z';
  const a = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = axis === 'x' ? Math.max(x0, x1) : Math.max(z0, z1);
  const c = axis === 'x' ? z0 : x0;
  const seg = (s0: number, s1: number, ya: number, yb: number, m: Mat = mat, extra: Partial<HBox> = {}) => {
    if (s1 - s0 < 1e-6 || yb - ya < 1e-6) return;
    if (axis === 'x') box(floor, m, s0, ya, c - t / 2, s1, yb, c + t / 2, extra);
    else box(floor, m, c - t / 2, ya, s0, c + t / 2, yb, s1, extra);
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
const slab = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number, thick = SLAB) =>
  box(floor, mat, x0, FLOOR_Y[floor] - thick, z0, x1, FLOOR_Y[floor], z1);

/** A walkable stair wedge (kind 'ramp'): rises from y0 to y1 along `axis` toward `rise`. */
const flight = (floor: number, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 'x' | 'z', rise: 1 | -1, mat: Mat = 'stair') =>
  boxes.push({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind: 'ramp', ramp: { axis, rise }, mat, floor });

/** Solid furniture (blocks walking, never a doorway). */
const furn = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number, extra: Partial<HBox> = {}) =>
  box(floor, mat, x0, FLOOR_Y[floor], z0, x1, FLOOR_Y[floor] + h, z1, extra);
const decor = (floor: number, mat: Mat, x0: number, z0: number, x1: number, z1: number, h: number, y = 0) =>
  box(floor, mat, x0, FLOOR_Y[floor] + y, z0, x1, FLOOR_Y[floor] + y + h, z1, { ghost: true });

const spot = (id: string, kind: SpotKind, name: string, x: number, y: number, z: number, chore?: ChoreKind) =>
  spots.push({ id, kind, name, pos: { x, y, z }, chore });

// ---------------------------------------------------------------------------------------------
// Outside: the yards, the side passages, the neighbours, the fences

box(0, 'grass', -14, GROUND - 0.5, -12, 24, GROUND, 34);
room('frontyard', 'the front yard', 0, -1.2, 22.2, 10.8, 30, 'grass', true);
room('backyard', 'the backyard', 0, -1.2, -10, 10.8, 0, 'grass', true);
room('sideway', 'the side passage', 0, 9.6, 0, 10.8, 20, 'path', true);
room('leftway', 'the gap by next door', 0, -1.2, 0, 0, 20, 'path', true);
// The paths are paint on the grass (a 2 cm lip would trip the walker, which has no step-up).
box(0, 'path', 9.72, GROUND, -0.5, 10.8, GROUND + 0.01, 22.2, { ghost: true });
box(0, 'path', 2, GROUND, 23.4, 3.2, GROUND + 0.01, 30, { ghost: true });
// The houses next door, close on each side, and the fences that close the yards.
box(0, 'neighbour', -9, GROUND, -2, -1.2, 9, 22);
box(0, 'neighbour', 10.8, GROUND, -2, 18.6, 9, 22);
box(0, 'fence', -1.2, GROUND, -10.1, 10.8, GROUND + 1.8, -10);
box(0, 'fence', -1.3, GROUND, -10, -1.2, GROUND + 1.8, -2);
box(0, 'fence', 10.8, GROUND, -10, 10.9, GROUND + 1.8, -2);
box(0, 'fence', -1.2, GROUND, 27, 2, GROUND + 0.9, 27.08);
box(0, 'fence', 3.2, GROUND, 27, 10.8, GROUND + 0.9, 27.08);
box(0, 'fence', -1.3, GROUND, 22, -1.2, GROUND + 0.9, 27);
box(0, 'fence', 10.8, GROUND, 22, 10.9, GROUND + 0.9, 27);
// The street is out of bounds.
box(0, 'invisible', -2, GROUND, 30, 12, 12, 30.3);
box(0, 'invisible', -1.4, GROUND, 22, -1.2, 12, 30);
box(0, 'invisible', 10.8, GROUND, 22, 11, 12, 30);
box(0, 'invisible', -1.4, GROUND, -10, 11, 12, -9.8);
// The tree out front is solid: a trunk you can hide behind.
box(0, 'invisible', 7.2, GROUND, 24.2, 7.9, 6, 24.9);

// ---------------------------------------------------------------------------------------------
// Floor 1: kitchen at the back, dining (left) and living (right) in the middle, the hall and Mikol's room at
// the front, the porch outside the front door.

room('stairs1', 'the stairs', 0, 0, 9.4, 1.2, 13.2, 'stair');
room('kitchen', 'the kitchen', 0, 0, 0, WIDTH, 5.4, 'lino');
room('dining', 'the dining room', 0, 0, 5.4, 4.2, 12.6);
room('living', 'the living room', 0, 4.2, 5.4, WIDTH, 12.6);
room('mikol', 'Mikol’s room', 0, 4.2, 12.6, WIDTH, DEPTH);
room('hall', 'the entrance hall', 0, 0, 12.6, 4.2, DEPTH);
room('porch', 'the front porch', 0, 0, DEPTH, 5, 22.2, 'porch', true);

box(0, 'wood', -0.12, -0.8, -0.12, WIDTH + 0.12, 0, DEPTH + 0.12);
box(0, 'porch', 0, -0.8, DEPTH, 5, 0, 22.2);
flight(0, 2, 22.2, 3.2, 23.4, GROUND, 0, 'z', -1, 'porch');
flight(0, 1.5, -1.32, 2.5, -0.12, GROUND, 0, 'z', 1, 'porch');
// Porch columns and railings (a gap for the steps).
for (const [x, z] of [[0.05, 22.05], [4.85, 22.05]]) box(0, 'trim', x, 0, z - 0.1, x + 0.15, 2.6, z + 0.1);
box(0, 'rail', 0, 0, 22.1, 2, 0.9, 22.2);
box(0, 'rail', 3.2, 0, 22.1, 5, 0.9, 22.2);
box(0, 'rail', -0.05, 0, DEPTH, 0.05, 0.9, 22.2);
box(0, 'rail', 4.95, 0, DEPTH, 5.05, 0.9, 22.2);

wall(0, 0, 0, WIDTH, 0, [{ at: 2, kind: 'door', id: 'back' }, { at: 5.2, kind: 'window' }, { at: 7.9, kind: 'window' }], EXT, 'brick');
wall(0, 0, DEPTH, WIDTH, DEPTH, [{ at: 2.4, kind: 'door', id: 'front' }, { at: 7, kind: 'window' }], EXT, 'brick');
wall(0, 0, 0, 0, DEPTH, [{ at: 2.6, kind: 'window' }, { at: 7, kind: 'window' }, { at: 16.5, kind: 'window', w: 0.8 }], EXT, 'brick');
wall(0, WIDTH, 0, WIDTH, DEPTH, [{ at: 2.6, kind: 'window' }, { at: 8.2, kind: 'window' }, { at: 16.3, kind: 'window' }], EXT, 'brick');
// The kitchen opens to the dining and living rooms either side of the TV wall.
wall(0, 0, 5.4, 1.2, 5.4);
wall(0, 3.9, 5.4, 6.3, 5.4);
wall(0, 8.6, 5.4, WIDTH, 5.4);
// Flight A climbs toward the back along the left wall, boxed in on the dining side.
flight(0, 0.12, 9.4, 1.2, 13.2, 0, FLOOR_Y[1], 'z', -1);
wall(0, 1.25, 9.4, 1.25, 12.6, [], 0.1);
wall(0, 4.2, 12.6, 4.2, DEPTH, [{ at: 5, kind: 'door', id: 'mikol' }]);
wall(0, 4.2, 12.6, WIDTH, 12.6);

// Kitchen: counters along the back and right, the fridge and stove on the left, a little table, the bins.
furn(0, 'counter', 3.8, 0.12, 9.48, 0.75, 0.92);
furn(0, 'counter', 8.85, 0.75, 9.48, 4.2, 0.92);
furn(0, 'fridge', 0.12, 0.4, 0.95, 1.2, 1.85);
furn(0, 'counter', 0.12, 1.3, 0.75, 3.6, 0.92);
furn(0, 'table', 3.9, 2.3, 5.5, 3.3, 0.76);
furn(0, 'bin', 2.75, 0.15, 3.6, 0.65, 0.7);
// Dining: the hutch with the bottles (and the bell), the long table, the empties by the stairs.
furn(0, 'hutch', 0.12, 5.8, 0.6, 7.6, 1.9);
furn(0, 'table', 2, 6.4, 3.3, 9, 0.76);
furn(0, 'bin', 3.3, 11.6, 4, 12.3, 0.5);
// Living: the TV on its wall, the navy couch along the right, the black leather couch facing the telly.
decor(0, 'tv', 4.3, 5.46, 5.9, 5.54, 0.9, 1);
furn(0, 'table', 4.3, 5.48, 5.9, 5.9, 0.5);
furn(0, 'couch', 8.7, 6.6, 9.48, 10.4, 0.85);
furn(0, 'leather', 4.8, 11.65, 8.1, 12.5, 0.85);
furn(0, 'table', 5.9, 8.4, 7.4, 9.3, 0.42);
decor(0, 'beanbag', 5.2, 6.4, 6, 7.2, 0.45);
decor(0, 'beanbag', 7.1, 6.4, 7.9, 7.2, 0.45);
// Mikol's room: bed in the back corner, the desk by the front window, a radiator under it.
furn(0, 'bed', 7.9, 12.72, 9.48, 14.9, 0.55);
furn(0, 'desk', 8.6, 17.9, 9.48, 19.4, 0.75);
furn(0, 'radiator', 6.4, 19.66, 7.6, 19.86, 0.6);
// The porch recycling.
furn(0, 'bin', 4.1, 21.3, 4.8, 22, 0.7);

// ---------------------------------------------------------------------------------------------
// Floor 2: Selby (back left) with the covered balcony behind, Dev (back right), the bathroom (middle right),
// Xang (front right), Will Palmer (front left) with the front balcony, the landing in the middle.

room('stairs2', 'the stairs', 1, 1.2, 9.4, 2.4, 13.2, 'stair');
room('selby', 'Selby’s room', 1, 0, 0, 4.6, 8);
room('dev', 'Dev’s room', 1, 4.6, 0, WIDTH, 6.2);
room('bath2', 'the bathroom', 1, 7.6, 6.2, WIDTH, 13.4, 'tile');
room('xang', 'Xang’s room', 1, 5.4, 13.4, WIDTH, DEPTH);
room('will', 'Will Palmer’s room', 1, 0, 13.4, 5.4, DEPTH);
room('landing', 'the landing', 1, 0, 6.2, 7.6, 13.4);
room('balcony', 'the covered balcony', 1, 0, -3.2, 4.6, 0, 'porch', true);
room('frontbalcony', 'the front balcony', 1, 0, DEPTH, 5, 22.2, 'porch', true);

// The slab, with flight A's well cut out of it.
slab(1, 'wood', -0.12, -0.12, WIDTH + 0.12, 9.4);
slab(1, 'wood', 1.2, 9.4, WIDTH + 0.12, 13.2);
slab(1, 'wood', -0.12, 13.2, WIDTH + 0.12, DEPTH + 0.12);
slab(1, 'porch', 0, -3.2, 4.6, -0.12);
slab(1, 'porch', 0, DEPTH + 0.12, 5, 22.2);
// The stairwell: flight B climbs toward the front between two walls; a rail closes the front of flight A's well.
flight(1, 1.3, 9.4, 2.3, 13.2, FLOOR_Y[1], FLOOR_Y[2], 'z', 1);
box(1, 'wall', 1.2, FLOOR_Y[1] - 0.2, 9.4, 1.3, FLOOR_Y[2] + 1, 13.2);
box(1, 'wall', 2.3, FLOOR_Y[1], 9.4, 2.4, FLOOR_Y[2] + 1, 13.2);
box(1, 'rail', 0.12, FLOOR_Y[1], 13.2, 1.2, FLOOR_Y[1] + 1, 13.3);
// Balcony railings and posts.
box(1, 'rail', 0, FLOOR_Y[1], -3.2, 4.6, FLOOR_Y[1] + 1, -3.12);
box(1, 'rail', -0.05, FLOOR_Y[1], -3.2, 0.05, FLOOR_Y[1] + 1, -0.12);
box(1, 'rail', 4.55, FLOOR_Y[1], -3.2, 4.65, FLOOR_Y[1] + 1, -0.12);
for (const x of [0, 4.45]) box(1, 'trim', x, GROUND, -3.2, x + 0.15, FLOOR_Y[2] - 0.4, -3.05);
box(1, 'trim', -0.1, FLOOR_Y[2] - 0.4, -3.3, 4.7, FLOOR_Y[2] - 0.3, -0.12);
box(1, 'rail', 0, FLOOR_Y[1], 22.1, 5, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', -0.05, FLOOR_Y[1], DEPTH + 0.12, 0.05, FLOOR_Y[1] + 1, 22.2);
box(1, 'rail', 4.95, FLOOR_Y[1], DEPTH + 0.12, 5.05, FLOOR_Y[1] + 1, 22.2);

wall(1, 0, 0, WIDTH, 0, [{ at: 2.2, kind: 'door', id: 'balcony' }, { at: 7, kind: 'window' }], EXT, 'brick');
wall(1, 0, DEPTH, WIDTH, DEPTH, [{ at: 2.4, kind: 'door', id: 'frontbalcony' }, { at: 7.5, kind: 'window' }], EXT, 'brick');
wall(1, 0, 0, 0, DEPTH, [{ at: 4, kind: 'window' }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, WIDTH, 0, WIDTH, DEPTH, [{ at: 3, kind: 'window' }, { at: 10.4, kind: 'window', w: 0.7 }, { at: 16.6, kind: 'window' }], EXT, 'brick');
wall(1, 0, 8, 4.6, 8, [{ at: 3.6, kind: 'door', id: 'selby' }]);
wall(1, 4.6, 0, 4.6, 8);
wall(1, 4.6, 6.2, WIDTH, 6.2, [{ at: 1, kind: 'door', id: 'dev' }]);
wall(1, 7.6, 6.2, 7.6, 13.4, [{ at: 3.4, kind: 'door', id: 'bath2' }]);
wall(1, 0, 13.4, WIDTH, 13.4, [{ at: 4, kind: 'door', id: 'will' }, { at: 6.4, kind: 'door', id: 'xang' }]);
wall(1, 5.4, 13.4, 5.4, DEPTH);

furn(1, 'bed', 0.12, 5.4, 1.3, 7.92, 0.5);
furn(1, 'desk', 3.9, 1.4, 4.52, 4, 0.75);
furn(1, 'radiator', 0.12, 3.4, 0.3, 4.6, 0.6);
furn(1, 'bed', 7.3, 0.12, 9.48, 2.3, 0.55);
furn(1, 'desk', 7.8, 5.4, 9.2, 6.1, 0.75);
furn(1, 'shelf', 4.68, 0.8, 5.05, 2.2, 1.8);
furn(1, 'radiator', 9.3, 3.2, 9.48, 4.4, 0.6);
furn(1, 'tub', 8.7, 6.3, 9.48, 8, 0.55);
furn(1, 'sink', 9.0, 10.8, 9.48, 11.5, 0.85);
furn(1, 'toilet', 8.95, 12.4, 9.48, 13.3, 0.45);
furn(1, 'bed', 8, 13.5, 9.48, 15.6, 0.5);
furn(1, 'desk', 5.5, 17.2, 6.1, 19.86, 0.75);
furn(1, 'bed', 3.6, 16.5, 5.32, 19.86, 0.5);
furn(1, 'desk', 0.12, 13.5, 1.8, 14.1, 0.75);
furn(1, 'radiator', 0.12, 15.8, 0.3, 17, 0.6);
furn(1, 'bin', 3.6, -3.05, 4.4, -2.4, 0.7);

// ---------------------------------------------------------------------------------------------
// Floor 3: Jung (back), the bathroom (middle right), Wags (front), the eaves storage down the left with a hatch
// at each end of the hall.

room('stairs3', 'the stairs', 2, 1.2, 9.4, 2.4, 13.2, 'stair');
room('jung', 'Jung’s room', 2, 2.4, 0, WIDTH, 8.6);
room('bath3', 'the top bathroom', 2, 6.6, 8.6, WIDTH, 14.2, 'tile');
room('wags', 'Wags’s room', 2, 2.4, 14.2, WIDTH, DEPTH);
room('eaves', 'the back eaves', 2, 0, 0, 2.4, 8.6, 'stair');
room('eaves2', 'the front eaves', 2, 0, 14.2, 2.4, DEPTH, 'stair');
room('hall3', 'the top hall', 2, 0, 8.6, 6.6, 14.2);

slab(2, 'wood', -0.12, -0.12, WIDTH + 0.12, 9.4);
slab(2, 'wood', -0.12, 9.4, 1.2, 13.2);
slab(2, 'wood', 2.4, 9.4, WIDTH + 0.12, 13.2);
slab(2, 'wood', -0.12, 13.2, WIDTH + 0.12, DEPTH + 0.12);
box(2, 'rail', 1.2, FLOOR_Y[2], 9.3, 2.4, FLOOR_Y[2] + 1, 9.4);
// The roof's underside (the ceiling).
box(2, 'ceiling', -0.12, FLOOR_Y[2] + CEILING[2], -0.12, WIDTH + 0.12, FLOOR_Y[2] + CEILING[2] + 0.2, DEPTH + 0.12);

wall(2, 0, 0, WIDTH, 0, [{ at: 6, kind: 'window' }], EXT, 'brick');
wall(2, 0, DEPTH, WIDTH, DEPTH, [{ at: 6, kind: 'window', w: 1.4 }], EXT, 'brick');
wall(2, 0, 0, 0, DEPTH, [], EXT, 'brick');
wall(2, WIDTH, 0, WIDTH, DEPTH, [{ at: 4, kind: 'window' }, { at: 11.4, kind: 'window', w: 0.7 }, { at: 17, kind: 'window' }], EXT, 'brick');
wall(2, 2.4, 0, 2.4, 8.6);
wall(2, 0, 8.6, WIDTH, 8.6, [{ at: 0.65, kind: 'hatch', id: 'hatch-back', w: 0.9 }, { at: 4, kind: 'door', id: 'jung' }]);
wall(2, 6.6, 8.6, 6.6, 14.2, [{ at: 2.8, kind: 'door', id: 'bath3' }]);
wall(2, 0, 14.2, WIDTH, 14.2, [{ at: 0.65, kind: 'hatch', id: 'hatch-front', w: 0.9 }, { at: 4, kind: 'door', id: 'wags' }]);
wall(2, 2.4, 14.2, 2.4, DEPTH);

furn(2, 'desk', 2.5, 0.8, 3.1, 3.8, 0.75);
furn(2, 'bed', 7.8, 3.6, 9.48, 6.4, 0.5);
furn(2, 'toilet', 8.95, 8.7, 9.48, 9.6, 0.45);
furn(2, 'sink', 9, 10.2, 9.48, 10.9, 0.85);
furn(2, 'tub', 8.7, 12.4, 9.48, 14.1, 0.55);
furn(2, 'bed', 8, 14.3, 9.48, 17, 0.5);
furn(2, 'records', 4.3, 19.4, 6.6, 19.88, 0.8);
furn(2, 'radiator', 9.3, 18, 9.48, 19.2, 0.6);
decor(2, 'beanbag', 4.6, 16.4, 5.4, 17.2, 0.45);
// Eaves junk: boxes against the outer wall, a path left along the inside.
for (const z of [0.6, 2.4, 4.4, 6.2, 15.6, 17.6, 19]) furn(2, 'junk', 0.12, z, 1.05, z + 0.9, 0.7 + (z % 1) * 0.4);

// ---------------------------------------------------------------------------------------------
// Spots

spot('bell', 'bell', 'Ring the meeting bell (the pot and spoon)', 0.75, 1.3, 6.6);
spot('pan-kitchen', 'chore', 'Scrub the pan in the sink', 6.5, 0.95, 0.45, 'pan');
spot('pan-xang', 'chore', 'Scrub the pan on Xang’s desk', 5.8, 3.55, 18.4, 'pan');
spot('pan-jung', 'chore', 'Scrub the pan under Jung’s desk', 2.8, 6.35, 2.3, 'pan');
spot('plunge-2', 'chore', 'Plunge the toilet', 9.2, 3.25, 12.85, 'plunge');
spot('plunge-3', 'chore', 'Plunge the top toilet', 9.2, 6.05, 9.15, 'plunge');
spot('socks-mikol', 'chore', 'Pair the socks on Mikol’s radiator', 7, 0.6, 19.76, 'socks');
spot('socks-dev', 'chore', 'Pair the socks on Dev’s radiator', 9.39, 3.4, 3.8, 'socks');
spot('socks-will', 'chore', 'Pair the socks on Will’s radiator', 0.21, 3.4, 16.4, 'socks');
spot('socks-wags', 'chore', 'Pair the socks on Wags’s radiator', 9.39, 6.2, 18.6, 'socks');
spot('recycle-kitchen', 'chore', 'Sort the kitchen recycling', 3.2, 0.7, 0.4, 'recycling');
spot('recycle-dining', 'chore', 'Sort the empties by the stairs', 3.65, 0.5, 11.95, 'recycling');
spot('recycle-porch', 'chore', 'Sort the porch recycling', 4.45, 0.7, 21.65, 'recycling');
spot('recycle-balcony', 'chore', 'Sort the balcony recycling', 4, 3.5, -2.7, 'recycling');

/** Where everyone sits for a house meeting: the two couches, bean bags and chairs around the coffee table. */
const TABLE = { x: 6.65, z: 8.85 };
const seatAt = (x: number, z: number): Seat => ({ pos: { x, y: 0, z }, yaw: Math.atan2(x - TABLE.x, z - TABLE.z) });
export const SEATS: Seat[] = [
  seatAt(5.4, 12.05), seatAt(6.45, 12.05), seatAt(7.5, 12.05),
  seatAt(9.1, 7.2), seatAt(9.1, 8.5), seatAt(9.1, 9.8),
  seatAt(5.6, 6.8), seatAt(7.5, 6.8), seatAt(4.75, 8.3), seatAt(4.75, 9.6),
  seatAt(8.1, 10.9), seatAt(8.1, 6.4),
];
export const MEETING_CENTRE = { x: TABLE.x, y: 0.45, z: TABLE.z };

export const ROOMS: readonly Room[] = rooms;
export const BOXES: readonly HBox[] = boxes;
/** Everything walkers collide with (doors come and go on top of this). */
export const SOLIDS: readonly HBox[] = boxes.filter((b) => !b.ghost);
export const DOORS: readonly Door[] = doors;
export const SPOTS: readonly Spot[] = spots;
export const CHORE_KINDS: ChoreKind[] = ['pan', 'plunge', 'socks', 'recycling'];
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

/** Where to wake up in a room: spread around the middle so roommates don't stack. */
export function wakeSpot(roomId: string, i: number): Vec3 {
  const r = roomById(roomId) ?? roomById('living')!;
  const spots: Record<string, [number, number][]> = {
    living: [[6.6, 10.5], [5.3, 10.6], [7.9, 10.6], [6.6, 7.6], [5.1, 7.8], [8, 7.8]],
    mikol: [[6.4, 15.5], [7.2, 17], [5.6, 17.4], [6.4, 18.6]],
  };
  const list = spots[roomId];
  if (list) {
    const [x, z] = list[i % list.length];
    return { x, y: FLOOR_Y[r.floor], z };
  }
  const cx = (r.min.x + r.max.x) / 2;
  const cz = (r.min.z + r.max.z) / 2;
  return { x: cx + (i % 2) * 0.9 - 0.45, y: FLOOR_Y[r.floor], z: cz + Math.floor(i / 2) * 0.9 };
}

/** Lamp positions: one under the ceiling of each indoor room. */
export const LAMPS: Vec3[] = rooms
  .filter((r) => !r.outside && !r.id.startsWith('stairs'))
  .map((r) => ({ x: (r.min.x + r.max.x) / 2, y: FLOOR_Y[r.floor] + CEILING[r.floor] - 0.35, z: (r.min.z + r.max.z) / 2 }));
