// "The Foundry": the Survival map. A walled-in, derelict factory yard at night. You start in the little Office with a pistol,
// buy doors to open the rest of the building, buy guns off the walls, and gamble on the Mystery Box. The horde breaks in
// through boarded-up bays in the outside walls (nail the boards back up!). Three levels: the Undercroft (cellars, y -6),
// the ground floor, and the North Wing's upper storey (y 5) plus the mezzanine. Floor plan, x east, z south, y up, metres:
//
//   NORTH WING (across the yard)   Showroom ─D10─ Sorting Floor ─D11─ Break Room        ground floor
//                                     ║ drain       │ tunnel  │ stairs (D12 at the top)
//                                     ║ ramp        │ ramp    Drafting Loft ─D13─ Clock Room   upper floor (y 5)
//                                     ║             │           ║ Skybridge (D14, y 4-5) over the yard
//      Locker ─D6─ Furnace (Pack-a-Punch, gantry y 4) ═════════╝ ──── Dock
//        │D4          │D3   ║ gantry joins the mezzanine          │D5
//      Boiler ─D1─── HALL (stairs up to the mezzanine; D7 the Undercroft stair shaft down) ─D2─ Storage (Juggernog)
//                     │D0
//                   Office (start)
//
//   UNDERCROFT (y -6): Undercroft stairs ─ Pump Room ─D8─ Cold Storage ═(collapsed wall)═ Old Drain ─ ramp up into the Showroom
//                                                   └D9─ Rail Tunnel ─ ramp up into the Sorting Floor;  Duck Shrine (hidden, off the Pump Room)
//
// Perks: Swift Mend in the Boiler Room, Second Wind in the Locker Room, Zephyr Fizz on the Loading Dock. They (and the
// Pack-a-Punch) need the power on: the switch is in the Boiler Room. Scythe parts lie at the far ends: Cold Storage, the
// Showroom and the Clock Room; the workbench is on the mezzanine. The Tinker's Workbench in the Office builds contraptions.
//
// The Skyline: buy the hatch in the Hall roof and a pad throws you up onto a tower on the roof. Three surf lines run from
// it and dive through chutes into the Boiler Room, Storage and the Furnace (a chute stays shut until its room is open).
//
// Secrets: the Duck Shrine behind the crates in the Pump Room (a Hammer LMG on the wall, a Mystery Box spot), and the
// collapsed wall in Cold Storage: a free way through the Old Drain up into the Showroom.
//
// Windows are walled off from players by invisible bars (colliders.ts), so nobody wanders out into the yard. The cellar
// windows look onto two sunken drainage cuts in the yard, where their zombies climb down.
import type { Box } from './collision.ts';
import type { Barricade, Door, Link, Room, SurvivalLayout, WallBuy } from './layout.ts';
import { type MapData, type SpawnPoint, box, padTo, span, surfFrame, wedge } from './map.ts';

const T = 0.6; // wall thickness
const H = 9; // wall height of the main building: its ceiling
const DOOR_HALF = 1.6;
const DOOR_TOP = 3.4; // above the floor
const WIN_HALF = 1.5;
const WIN_TOP = 3;
const CELLAR = -6; // the Undercroft's floor; its ceiling is the underside of the ground slab (y -1)
const CELLAR_TOP = -1;
const WING_MID = 4.5; // the North Wing's ground storey ends here, under its upper floor (a 0.5 m slab)
const LOFT = 5; // the North Wing's upper floor
const WING_TOP = 10;
const NORTH = -88; // the compound's north wall (the yard reaches round the North Wing)

type Axis = 'x' | 'z';
/** A hole in a wall: centred on `c` along the wall, from y0 to y1. */
interface Gap {
  c: number;
  half: number;
  y0: number;
  y1: number;
}
interface Opening extends Gap {
  axis: Axis;
  plane: number;
}

/** A wall along `axis` at `plane` (the other coordinate), from a0 to a1 and y0 to y1, with holes. */
function run(axis: Axis, plane: number, a0: number, a1: number, gaps: Gap[], y0 = 0, y1 = H): Box[] {
  const out: Box[] = [];
  const piece = (a: number, b: number, lo: number, hi: number) => {
    if (b - a < 0.01 || hi - lo < 0.01) return;
    out.push(axis === 'x' ? span(a, lo, plane - T / 2, b, hi, plane + T / 2, 'brick') : span(plane - T / 2, lo, a, plane + T / 2, hi, b, 'brick'));
  };
  let cursor = a0 - T / 2;
  for (const g of [...gaps].sort((p, q) => p.c - q.c)) {
    piece(cursor, g.c - g.half, y0, y1);
    piece(g.c - g.half, g.c + g.half, y0, g.y0);
    piece(g.c - g.half, g.c + g.half, g.y1, y1);
    cursor = g.c + g.half;
  }
  piece(cursor, a1 + T / 2, y0, y1);
  return out;
}

/** A solid slab filling a gap, `thick` metres through the wall. */
function plug(axis: Axis, plane: number, g: Gap, thick: number): Box {
  return axis === 'x'
    ? span(g.c - g.half, g.y0, plane - thick / 2, g.c + g.half, g.y1, plane + thick / 2, 'steel')
    : span(plane - thick / 2, g.y0, g.c - g.half, plane + thick / 2, g.y1, g.c + g.half, 'steel');
}

/** A room: its nav bounds come from its floor and ceiling unless `extra` says otherwise. */
const room = (name: string, x0: number, x1: number, z0: number, z1: number, floor: number, ceil: number, extra: Partial<Room> = {}): Omit<Room, 'id'> => ({
  name,
  x0,
  x1,
  z0,
  z1,
  y0: floor - 0.5,
  y1: ceil - 0.2,
  floor,
  ceil,
  ...extra,
});

// Rooms. The first nine are the original Foundry (their ids are kept: the Office is 3).
const ROOMS: Omit<Room, 'id'>[] = [
  room('Stairs', -17.6, -14.2, -12, 0, 0, H, { y1: 4.8, base: 2, shape: 'ramp' }),
  room('Mezzanine', -18, 18, -18, -12, 4, H, { y0: 3.4, shape: 'walkway' }),
  room('Assembly Hall', -18, 18, -18, 12, 0, H),
  room('Office', -6, 6, 12, 24, 0, H),
  room('Boiler Room', -36, -18, -14, 8, 0, H),
  room('Storage', 18, 36, -14, 8, 0, H),
  room('Locker Room', -36, -18, -32, -14, 0, H),
  room('Loading Dock', 18, 36, -32, -14, 0, H),
  room('Furnace', -18, 18, -32, -18, 0, H),
  // The Undercroft, under the north half of the building and the yard.
  room('Undercroft Stairs', 4, 17.7, -18, -13.9, CELLAR, 0, { y1: 0.3, shape: 'ramp' }),
  room('Pump Room', 2, 22, -30, -18, CELLAR, CELLAR_TOP),
  room('Duck Shrine', 22, 28, -29, -23, CELLAR, CELLAR_TOP),
  room('Cold Storage', -26, 2, -30, -19, CELLAR, CELLAR_TOP),
  room('Rail Tunnel', 4, 10, -50, -30, CELLAR, CELLAR_TOP),
  room('Tunnel Ramp', 4, 10, -63, -50, CELLAR, 0, { y1: 0.3, shape: 'ramp' }),
  room('Old Drain', -16, -10, -50, -30, CELLAR, CELLAR_TOP),
  room('Drain Ramp', -16, -10, -63, -50, CELLAR, 0, { y1: 0.3, shape: 'ramp' }),
  // The North Wing: three rooms on the ground, two upstairs, the stairs between.
  room('Showroom', -30, -16, -63, -44, 0, WING_MID),
  room('Sorting Floor', -10, 4, -63, -44, 0, WING_MID),
  room('Break Room', 10, 30, -70, -44, 0, WING_MID),
  room('Wing Stairs', -6.4, 4.3, -69.7, -66.3, 0, LOFT, { y1: WING_MID - 0.1, base: 26, shape: 'ramp' }),
  room('Drafting Loft', -30, 10, -70, -44, LOFT, WING_TOP, { y0: LOFT - 0.2 }),
  room('Clock Room', 10, 30, -70, -44, LOFT, WING_TOP, { y0: LOFT - 0.2 }),
  // The way across at height: a gantry through the Furnace from the mezzanine, then the covered Skybridge over the yard.
  room('Gantry', 3.75, 7.75, -32, -18, 4, H, { shape: 'walkway' }),
  room('Skybridge', 3.75, 7.75, -44, -32, 4, 8.4, { shape: 'walkway' }),
  // The North Wing's ramp pits lie against its partition walls. Round each pit the floor is split into rectangles (the back
  // aisle the ramp comes up into, the strip by the door), so a zombie walking straight inside a room never crosses a pit.
  room('Fitting Rooms', -30, -10, -70, -63, 0, WING_MID),
  room('Parcel Bay', -10, 10, -70, -63, 0, WING_MID),
  room('Front of Shop', -16, -10, -50, -44, 0, WING_MID),
  room('Dispatch', 4, 10, -50, -44, 0, WING_MID),
  // The flat ends of two stairs: the Undercroft stairs' foot in the cellar, the Wing Stairs' landing inside its enclosure.
  room('Stair Foot', 17.7, 22, -18, -13.9, CELLAR, CELLAR_TOP),
  room('Stair Landing', -10, -0.9, -70, -66, LOFT, WING_TOP, { y0: WING_MID - 0.2, y1: LOFT + 0.8, shape: 'ramp' }),
];
const [STAIRS, MEZZ, HALL, OFFICE, BOILER, STORAGE, LOCKER, DOCK, FURNACE, USTAIRS, PUMP, SHRINE, COLD, TUNNEL, TRAMP, DRAIN, DRAMP, SHOWROOM, SORTING, BREAK, WSTAIRS, LOFT_ROOM, CLOCK, GANTRY, BRIDGE, FITTING, PARCEL, FRONT, DISPATCH, FOOT, LANDING] =
  ROOMS.map((_, i) => i);

interface DoorSpec {
  name: string;
  price: number;
  axis: Axis;
  plane: number;
  c: number;
  /** The rooms on either side, in link direction a -> b (`n` points from a to b). */
  a: number;
  b: number;
  n: { x: number; z: number };
  /** The floor it stands on (default 0). */
  y?: number;
}
// Prices climb the deeper you go. The Skybridge is the dear shortcut from the mezzanine straight into the North Wing.
const DOORS: DoorSpec[] = [
  { name: 'Office door', price: 750, axis: 'x', plane: 12, c: 0, a: OFFICE, b: HALL, n: { x: 0, z: -1 } },
  { name: 'Boiler Room', price: 1000, axis: 'z', plane: -18, c: 5, a: HALL, b: BOILER, n: { x: -1, z: 0 } },
  { name: 'Storage', price: 1000, axis: 'z', plane: 18, c: 5, a: HALL, b: STORAGE, n: { x: 1, z: 0 } },
  { name: 'Furnace', price: 1500, axis: 'x', plane: -18, c: 0, a: HALL, b: FURNACE, n: { x: 0, z: -1 } },
  { name: 'Locker Room', price: 1250, axis: 'x', plane: -14, c: -27, a: BOILER, b: LOCKER, n: { x: 0, z: -1 } },
  { name: 'Loading Dock', price: 1250, axis: 'x', plane: -14, c: 27, a: STORAGE, b: DOCK, n: { x: 0, z: -1 } },
  { name: 'Locker to Furnace', price: 1000, axis: 'z', plane: -18, c: -25, a: LOCKER, b: FURNACE, n: { x: 1, z: 0 } },
  { name: 'Undercroft', price: 1500, axis: 'x', plane: -13.9, c: 5.95, a: HALL, b: USTAIRS, n: { x: 0, z: -1 } },
  { name: 'Cold Storage', price: 1750, axis: 'z', plane: 2, c: -24.5, a: PUMP, b: COLD, n: { x: -1, z: 0 }, y: CELLAR },
  { name: 'Rail Tunnel', price: 2000, axis: 'x', plane: -30, c: 7, a: PUMP, b: TUNNEL, n: { x: 0, z: -1 }, y: CELLAR },
  { name: 'Showroom', price: 2250, axis: 'z', plane: -10, c: -47, a: SORTING, b: FRONT, n: { x: -1, z: 0 } },
  { name: 'Break Room', price: 2250, axis: 'z', plane: 10, c: -47, a: DISPATCH, b: BREAK, n: { x: 1, z: 0 } },
  { name: 'Drafting Loft', price: 2500, axis: 'x', plane: -66, c: -8.2, a: LANDING, b: LOFT_ROOM, n: { x: 0, z: 1 }, y: LOFT },
  { name: 'Clock Room', price: 2750, axis: 'z', plane: 10, c: -57, a: LOFT_ROOM, b: CLOCK, n: { x: 1, z: 0 }, y: LOFT },
  { name: 'Skybridge', price: 3000, axis: 'x', plane: -32, c: 5.75, a: GANTRY, b: BRIDGE, n: { x: 0, z: -1 }, y: 4 },
];

/** Open ways between rooms (nothing to buy): a hole in a wall (`wall`), or open floor such as a ramp's foot or top. */
interface ArchSpec {
  a: number;
  b: number;
  c: { x: number; y: number; z: number };
  n: { x: number; z: number };
  half: number;
  wall?: Opening;
}
const arch = (a: number, b: number, c: [number, number, number], n: [number, number], half: number, wall?: Omit<Opening, 'c' | 'half'>): ArchSpec => {
  const at = { x: c[0], y: c[1], z: c[2] };
  return { a, b, c: at, n: { x: n[0], z: n[1] }, half, wall: wall && { ...wall, c: wall.axis === 'x' ? at.x : at.z, half } };
};
const ARCHES: ArchSpec[] = [
  arch(HALL, STAIRS, [-15.9, 0, 0], [0, -1], 1.7),
  arch(STAIRS, MEZZ, [-15.9, 4, -12], [0, -1], 1.7),
  arch(MEZZ, GANTRY, [5.75, 4, -18], [0, -1], 1.6, { axis: 'x', plane: -18, y0: 4, y1: 4 + DOOR_TOP }),
  arch(BRIDGE, LOFT_ROOM, [5.75, LOFT, -44], [0, -1], 1.6, { axis: 'x', plane: -44, y0: LOFT, y1: LOFT + DOOR_TOP }),
  arch(USTAIRS, FOOT, [17.7, CELLAR, -15.95], [1, 0], 1.75),
  arch(FOOT, PUMP, [19.85, CELLAR, -18], [0, -1], 1.6, { axis: 'x', plane: -18, y0: CELLAR, y1: CELLAR + DOOR_TOP }),
  // The squeeze into the Duck Shrine, through the flooded corner; the collapsed wall from Cold Storage into the Old Drain.
  arch(PUMP, SHRINE, [22, CELLAR, -26], [1, 0], 0.9, { axis: 'z', plane: 22, y0: CELLAR, y1: CELLAR + 2.2 }),
  arch(COLD, DRAIN, [-13, CELLAR, -30], [0, -1], 1.6, { axis: 'x', plane: -30, y0: CELLAR, y1: CELLAR + 3.4 }),
  arch(TUNNEL, TRAMP, [7, CELLAR, -50], [0, -1], 2.7),
  arch(TRAMP, PARCEL, [7, 0, -63], [0, -1], 2.7),
  arch(PARCEL, SORTING, [-3, 0, -63], [0, 1], 6.5),
  arch(SORTING, DISPATCH, [4, 0, -47], [1, 0], 2.8),
  arch(DRAIN, DRAMP, [-13, CELLAR, -50], [0, -1], 2.7),
  arch(DRAMP, FITTING, [-13, 0, -63], [0, -1], 2.7),
  arch(FITTING, SHOWROOM, [-23, 0, -63], [0, 1], 6.5),
  arch(FRONT, SHOWROOM, [-16, 0, -47], [-1, 0], 2.8),
  arch(PARCEL, WSTAIRS, [4.3, 0, -68], [-1, 0], 1.7),
  arch(WSTAIRS, LANDING, [-6.4, LOFT, -68], [-1, 0], 1.7),
];

interface WindowSpec {
  room: number;
  axis: Axis;
  plane: number;
  c: number;
  out: { x: number; z: number };
  y: number;
}
const W = -1;
const E = 1;
const win = (room: number, axis: Axis, plane: number, c: number, out: { x: number; z: number }, y = 0): WindowSpec => ({ room, axis, plane, c, out, y });
const WINDOWS: WindowSpec[] = [
  win(OFFICE, 'z', -6, 18, { x: W, z: 0 }),
  win(OFFICE, 'z', 6, 18, { x: E, z: 0 }),
  win(HALL, 'x', 12, -12, { x: 0, z: 1 }),
  win(HALL, 'x', 12, 12, { x: 0, z: 1 }),
  win(BOILER, 'z', -36, -3, { x: W, z: 0 }),
  win(BOILER, 'x', 8, -27, { x: 0, z: 1 }),
  win(STORAGE, 'z', 36, -3, { x: E, z: 0 }),
  win(STORAGE, 'x', 8, 27, { x: 0, z: 1 }),
  win(LOCKER, 'z', -36, -23, { x: W, z: 0 }),
  win(LOCKER, 'x', -32, -27, { x: 0, z: -1 }),
  win(DOCK, 'z', 36, -23, { x: E, z: 0 }),
  win(DOCK, 'x', -32, 27, { x: 0, z: -1 }),
  win(FURNACE, 'x', -32, -9, { x: 0, z: -1 }),
  win(FURNACE, 'x', -32, 9, { x: 0, z: -1 }),
  // The North Wing's ground floor.
  win(SHOWROOM, 'z', -30, -52, { x: W, z: 0 }),
  win(SHOWROOM, 'z', -30, -63, { x: W, z: 0 }),
  win(FITTING, 'x', -70, -20, { x: 0, z: -1 }),
  win(PARCEL, 'x', -70, 7, { x: 0, z: -1 }),
  win(BREAK, 'z', 30, -52, { x: E, z: 0 }),
  win(BREAK, 'z', 30, -63, { x: E, z: 0 }),
  win(BREAK, 'x', -70, 20, { x: 0, z: -1 }),
  // Storm grates in the cellar tunnels, onto the sunken drainage cuts in the yard.
  win(TUNNEL, 'z', 4, -39, { x: W, z: 0 }, CELLAR),
  win(DRAIN, 'z', -16, -39, { x: W, z: 0 }, CELLAR),
];

/** Every wall: [axis, plane, from, to, bottom, top] (bottom and top default to the main building's 0..H). */
type WallSpec = [Axis, number, number, number, number?, number?];
const WALLS: WallSpec[] = [
  // The main building.
  ['x', -32, -36, 36],
  ['x', -18, -18, 18],
  ['x', -14, -36, -18],
  ['x', -14, 18, 36],
  ['x', 8, -36, -18],
  ['x', 8, 18, 36],
  ['x', 12, -18, 18],
  ['x', 24, -6, 6],
  ['z', -36, -32, 8],
  ['z', 36, -32, 8],
  ['z', -18, -32, 12],
  ['z', 18, -32, 12],
  ['z', -6, 12, 24],
  ['z', 6, 12, 24],
  // The Undercroft stairs: walled in under the mezzanine's east end; the door is at the west end of their south side.
  ['x', -13.9, 4, 17.7, 0, 3.6],
  ['z', 4, -18, -13.9, 0, 3.6],
  // The Undercroft.
  ['x', -13.9, 4, 22, CELLAR, 0], // the stairs' corridor, along the Pump Room's south side
  ['x', -18, 2, 22, CELLAR, 0],
  ['z', 22, -30, -13.9, CELLAR, 0],
  ['z', 2, -30, -18, CELLAR, 0],
  ['x', -30, -26, 22, CELLAR, 0],
  ['z', 28, -29, -23, CELLAR, 0], // the Duck Shrine
  ['x', -29, 22, 28, CELLAR, 0],
  ['x', -23, 22, 28, CELLAR, 0],
  ['z', -26, -30, -19, CELLAR, 0],
  ['x', -19, -26, 2, CELLAR, 0],
  ['z', 4, -63, -30, CELLAR, 0],
  ['z', 10, -63, -30, CELLAR, 0],
  ['z', -16, -63, -30, CELLAR, 0],
  ['z', -10, -63, -30, CELLAR, 0],
  // The two drainage cuts in the yard (open to the sky; zombies for the cellar windows climb down into them).
  ['z', -4, -42.5, -35.5, CELLAR, 0],
  ['x', -42.5, -4, 4, CELLAR, 0],
  ['x', -35.5, -4, 4, CELLAR, 0],
  ['z', -24, -42.5, -35.5, CELLAR, 0],
  ['x', -42.5, -24, -16, CELLAR, 0],
  ['x', -35.5, -24, -16, CELLAR, 0],
  // The North Wing: ground storey, then the upper one (with the stair enclosure round the hole in the floor).
  ['x', -44, -30, 30, 0, WING_MID],
  ['x', -70, -30, 30, 0, WING_MID],
  ['z', -30, -70, -44, 0, WING_MID],
  ['z', 30, -70, -44, 0, WING_MID],
  ['z', -10, -70, -44, 0, WING_MID],
  ['z', 10, -70, -44, 0, WING_MID],
  ['x', -44, -30, 30, LOFT, WING_TOP],
  ['x', -70, -30, 30, LOFT, WING_TOP],
  ['z', -30, -70, -44, LOFT, WING_TOP],
  ['z', 30, -70, -44, LOFT, WING_TOP],
  ['z', 10, -70, -44, LOFT, WING_TOP],
  ['x', -66, -10, -0.9, LOFT, WING_TOP],
  ['z', -0.9, -70, -66, LOFT, WING_TOP],
  ['z', -10, -70, -66, LOFT, WING_TOP],
  // The Skybridge's sides.
  ['z', 3.75, -43.7, -32.3, 3.6, 8.4],
  ['z', 7.75, -43.7, -32.3, 3.6, 8.4],
];

const v = (x: number, y: number, z: number) => ({ x, y, z });

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A flat slab from y0 to y1 over a rectangle, with rectangular holes cut out (split on a grid, merged along x). */
function slab(r: Rect, y0: number, y1: number, holes: Rect[], kind: Box['kind'] = 'steel'): Box[] {
  const xs = [...new Set([r.x0, r.x1, ...holes.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const zs = [...new Set([r.z0, r.z1, ...holes.flatMap((h) => [h.z0, h.z1])])].sort((a, b) => a - b);
  const out: Box[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    let start = -1;
    for (let i = 0; i <= xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const solid = i < xs.length - 1 && !holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1);
      if (solid && start < 0) start = i;
      if (!solid && start >= 0) {
        out.push(span(xs[start], y0, zs[j], xs[i], y1, zs[j + 1], kind));
        start = -1;
      }
    }
  }
  return out;
}

// The Skyline: the hatch in the Hall roof, the tower it throws you onto, and the chutes the surf lines dive through.
const HATCH: Rect = { x0: -2, z0: -1, x1: 2, z1: 3 };
const TOWER = { x: 0, z: -5.5, top: 16 };
const LINE_Y = 14.2; // the surf lines over the roof
const DIVE_Y = 6.5; // the lines inside the rooms
const CHUTES: { room: number; hole: Rect }[] = [
  { room: BOILER, hole: { x0: -33, z0: -9.5, x1: -19, z1: -1.5 } },
  { room: STORAGE, hole: { x0: 19, z0: -9.5, x1: 33, z1: -1.5 } },
  { room: FURNACE, hole: { x0: -4, z0: -31, x1: 4, z1: -19 } },
];
const TINKER = { x: 5.2, z: 21.6 }; // the Tinker's Workbench, against the Office's east wall
const lid = (h: Rect) => span(h.x0, H, h.z0, h.x1, H + 0.8, h.z1, 'steel');

// Holes in the ground: the Undercroft stairs (under the mezzanine), the two ramps up into the North Wing, the drainage cuts.
const SHAFT: Rect = { x0: 7.6, z0: -17.7, x1: 17.7, z1: -14.2 };
const TUNNEL_PIT: Rect = { x0: 4.3, z0: -63, x1: 9.7, z1: -50 };
const DRAIN_PIT: Rect = { x0: -15.7, z0: -63, x1: -10.3, z1: -50 };
const CUTS: Rect[] = [
  { x0: -4, z0: -42.5, x1: 4, z1: -35.5 },
  { x0: -24, z0: -42.5, x1: -16, z1: -35.5 },
];
const PIT_FENCE = 1.5;
const STAIR_HOLE: Rect = { x0: -6.4, z0: -69.7, x1: -1.2, z1: -66.3 }; // over the Wing Stairs' top half (a landing, then the door)

/**
 * Where the client dresses the new rooms' furniture. Each has a collider here ('cover' is drawn by the client only):
 * mannequins in the Showroom, tables in the Break Room, desks in the Drafting Loft, the walk-through gear in the Clock Room.
 */
export const PROPS = {
  mannequins: [[-26, -48], [-22, -48], [-26, -53.5], [-22, -53.5], [-26, -58.5], [-22, -58.5], [-24, -60.5], [-19, -46]] as [number, number][],
  tables: [[16, -58], [23, -58], [19, -50]] as [number, number][],
  desks: [[-26, -50], [-20, -50], [-14, -50], [-26, -57], [-20, -57], [-14, -57], [-6, -52]] as [number, number][],
  ice: [span(-22, CELLAR, -28, -20, CELLAR + 1, -26, 'cover'), span(-9, CELLAR, -24, -7.5, CELLAR + 1.1, -22.5, 'cover'), span(-3, CELLAR, -29.5, -1, CELLAR + 0.8, -27.5, 'cover')],
  /** The broken gear standing on edge across the Clock Room: you walk through its hub (the bottom of the rim is sunk in the floor). */
  gear: { x: 20, y: LOFT + 1.2, z: -57, inner: 2.6, outer: 3.6 },
  vending: span(11.2, 0, -69.7, 12.6, 2.2, -68.8, 'cover'),
  fridge: span(13.4, 0, -69.7, 14.6, 2.2, -68.8, 'cover'),
  couch: span(22, 0, -45.6, 27, 0.8, -44.3, 'cover'),
  cart: span(5.5, CELLAR, -47, 7, CELLAR + 1.1, -44.5, 'cover'),
  altar: span(26.9, CELLAR, -27.2, 27.7, CELLAR + 1, -24.8, 'cover'),
  /** The flooded corner of the Pump Room and the Old Drain's channel: just water to look at. */
  water: [{ x0: 17.5, z0: -29.7, x1: 21.7, z1: -24.5 }, { x0: -14.2, z0: -49, x1: -11.8, z1: -30.4 }] as Rect[],
};

/** Where a wall gun hangs: on the wall face at (x, z) over the floor `floor`, facing `yaw` (the way the display faces), with `at` the spot to stand. */
function wallBuy(id: number, weapon: WallBuy['weapon'], price: number, room: number, x: number, floor: number, z: number, yaw: number): WallBuy {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { id, weapon, price, room, pos: v(x + fx * 0.02, floor + 1.7, z + fz * 0.02), yaw, at: v(x + fx * 1.05, floor, z + fz * 1.05) };
}

function buildFoundry(): MapData {
  const boxes: Box[] = [
    // The yard and, under it, every ground floor: it is also the Undercroft's ceiling, with holes for the ways down.
    ...slab({ x0: -51, z0: NORTH - 1, x1: 51, z1: 39 }, -1, 0, [SHAFT, TUNNEL_PIT, DRAIN_PIT, ...CUTS], 'gravel'),
    span(-51, CELLAR - 1, NORTH - 1, 51, CELLAR, 39, 'gravel'), // the Undercroft's floor (and the drainage cuts')
    // Perimeter wall.
    span(-51, 0, NORTH - 1, 51, 14, NORTH, 'brick'),
    span(-51, 0, 38, 51, 14, 39, 'brick'),
    span(-51, 0, NORTH, -50, 14, 38, 'brick'),
    span(50, 0, NORTH, 51, 14, 38, 'brick'),
    // Roofs: they keep the grapple honest, too. The main one has the Skyline's hatch and chutes in it.
    ...slab({ x0: -36.4, z0: -32.4, x1: 36.4, z1: 8.4 }, H, H + 0.8, [HATCH, ...CHUTES.map((c) => c.hole)]),
    span(-18.4, H, 8.4, 18.4, H + 0.8, 12.4, 'steel'),
    span(-6.4, H, 12.4, 6.4, H + 0.8, 24.4, 'steel'),
    // The North Wing's upper floor (with a hole over the stairs) and its roof.
    ...slab({ x0: -30.3, z0: -70.3, x1: 30.3, z1: -43.7 }, WING_MID, LOFT, [STAIR_HOLE]),
    span(-30.4, WING_TOP, -70.4, 30.4, WING_TOP + 0.8, -43.6, 'steel'),
  ];

  const doorGap = (d: DoorSpec): Gap => ({ c: d.c, half: DOOR_HALF, y0: d.y ?? 0, y1: (d.y ?? 0) + DOOR_TOP });
  const winGap = (w: WindowSpec): Gap => ({ c: w.c, half: WIN_HALF, y0: w.y, y1: w.y + WIN_TOP });
  const openings: Opening[] = [
    ...DOORS.map((d) => ({ axis: d.axis, plane: d.plane, ...doorGap(d) })),
    ...WINDOWS.map((w) => ({ axis: w.axis, plane: w.plane, ...winGap(w) })),
    ...ARCHES.flatMap((a) => (a.wall ? [a.wall] : [])),
  ];
  const doors: Door[] = DOORS.map((d, id) => ({ id, name: d.name, price: d.price, box: plug(d.axis, d.plane, doorGap(d), 0.5), rooms: [d.a, d.b] }));
  for (const [axis, plane, a0, a1, y0 = 0, y1 = H] of WALLS) {
    const gaps = openings.filter((o) => o.axis === axis && o.plane === plane && o.c > a0 && o.c < a1 && o.y0 >= y0 - 0.01 && o.y0 < y1);
    boxes.push(...run(axis, plane, a0, a1, gaps, y0, y1));
  }

  const barricades: Barricade[] = WINDOWS.map((w, id) => {
    const g = winGap(w);
    const [px, pz] = w.axis === 'x' ? [w.c, w.plane] : [w.plane, w.c];
    const side = { x: -w.out.z, z: w.out.x }; // along the wall
    const at = (out: number, lat = 0) => v(px + w.out.x * out + side.x * lat, w.y + 0.01, pz + w.out.z * out + side.z * lat);
    return {
      id,
      room: w.room,
      pos: v(px, w.y, pz),
      out: w.out,
      width: WIN_HALF * 2,
      seal: plug(w.axis, w.plane, g, 0.5),
      blocker: plug(w.axis, w.plane, g, 0.3),
      outside: at(1.15),
      inside: at(-1.6),
      spawns: [at(4.2, -1.1), at(5.6, 1.1), at(7, -0.4)],
    };
  });

  // --- Assembly Hall: conveyors, pillars, a press, crates; the mezzanine above the north end ---
  boxes.push(
    ...[[-9, -6], [9, -6], [-9, 6], [9, 6]].map(([x, z]) => box(x, H / 2, z, 0.9, H, 0.9, 'steel')),
    span(-14, 0, -9, -3, 0.95, -7.6, 'steel'), // conveyor belts: low enough to hop
    span(3, 0, 3, 14, 0.95, 4.4, 'steel'),
    span(-12.5, 0, 6.2, -9.5, 1.3, 7.8, 'machine'),
    box(12, 0.8, -9, 1.6, 1.6, 1.6, 'crate'),
    box(13.7, 0.6, -9.3, 1.2, 1.2, 1.2, 'crate'),
    box(-4, 0.6, 9, 1.2, 1.2, 1.2, 'crate'),
    // Mezzanine: a walkway over the north end, reached by the stairs; the rail is jumpable.
    span(-18, 3.6, -18, 18, 4, -12, 'steel'),
    span(-14, 4, -12.1, 18, 5.1, -11.9, 'steel'),
    box(-8, 1.8, -12.2, 0.5, 3.6, 0.5, 'steel'),
    box(8, 1.8, -12.2, 0.5, 3.6, 0.5, 'steel'),
    wedge('ramp', -17.6, 0, -12, -14.2, 4, 0, { axis: 'z', rise: -1 }),
    // The Undercroft stairs: from a landing inside their door, down eastward through the floor into the Pump Room.
    wedge('ramp', SHAFT.x0, CELLAR, SHAFT.z0, SHAFT.x1, 0, SHAFT.z1, { axis: 'x', rise: -1 }),
  );
  // --- The Skyline: a tower over the hatch, surf lines out to three rooms, each diving through its chute ---
  boxes.push(
    span(TOWER.x - 1.5, H + 0.8, TOWER.z - 1.5, TOWER.x + 1.5, TOWER.top, TOWER.z + 1.5, 'steel'),
    ...surfFrame('x', TOWER.z, LINE_Y, TOWER.x - 1.5, -16, 3), // west, to the Boiler Room
    ...surfFrame('x', TOWER.z, DIVE_Y, -21, -34, 2),
    ...surfFrame('x', TOWER.z, LINE_Y, TOWER.x + 1.5, 16, 3), // east, to Storage
    ...surfFrame('x', TOWER.z, DIVE_Y, 21, 34, 2),
    ...surfFrame('z', TOWER.x, LINE_Y, TOWER.z - 1.5, -16, 3), // north, to the Furnace
    ...surfFrame('z', TOWER.x, DIVE_Y, -20.5, -30, 2),
  );
  // The power switch's generator (Boiler Room) and the scythe's workbench (mezzanine; drawn by the client, so 'cover').
  boxes.push(span(-23, 0, 6.8, -20, 2.4, 7.7, 'machine'));
  boxes.push(span(-7.2, 4, -17.7, -4.8, 4.95, -16.9, 'cover'));
  // --- Office ---
  // The Tinker's Workbench in the south-east corner (drawn by the client, so 'cover'): contraptions for coins.
  boxes.push(span(TINKER.x - 0.5, 0, TINKER.z - 1, TINKER.x + 0.5, 0.95, TINKER.z + 1, 'cover'));
  boxes.push(span(-5, 0, 13.2, -2.2, 0.9, 14.6, 'crate'), span(3, 0, 13, 5.5, 1.5, 14, 'steel'), span(-5.5, 0, 21.2, -3, 0.6, 23.6, 'crate'));
  // --- Boiler Room ---
  boxes.push(span(-32, 0, -12, -28, 4.5, -8, 'machine'), span(-26, 0, -3, -22, 4.5, 1, 'machine'), span(-26, 0, -6, -24.4, 1, -4.4, 'crate'));
  // --- Storage ---
  boxes.push(span(19, 0, -9.4, 22.5, 2.4, -8.6, 'steel'), span(19, 0, -5.4, 22.5, 2.4, -4.6, 'steel'), box(32, 0.6, 2, 1.2, 1.2, 1.2, 'crate'), box(30.6, 0.5, 3.4, 1, 1, 1, 'crate'), box(21.5, 0.8, 4, 1.6, 1.6, 1.6, 'crate'));
  boxes.push(span(35, 0, -10.5, 36, 2.6, -7.5, 'machine')); // Juggernog cooler
  // The other perk coolers, one in each of the rooms you have to buy your way into.
  boxes.push(span(-36, 0, 3, -35, 2.6, 6, 'machine')); // Swift Mend (Boiler Room)
  boxes.push(span(-19, 0, -31, -18, 2.6, -28, 'machine')); // Second Wind (Locker Room)
  boxes.push(span(18, 0, -30.5, 19, 2.6, -27.5, 'machine')); // Zephyr Fizz (Loading Dock)
  // --- Locker Room ---
  boxes.push(span(-35.8, 0, -31, -34.8, 2.2, -25.5, 'steel'), span(-30, 0, -22, -24, 0.5, -21, 'crate'));
  // --- Loading Dock ---
  boxes.push(span(28, 0, -24, 31, 2, -22, 'machine'), box(21.5, 0.6, -20, 1.2, 1.2, 1.2, 'crate'), box(23.5, 0.6, -18.5, 1.2, 1.2, 1.2, 'crate'));
  // --- Furnace: ovens and the Pack-a-Punch; the gantry from the mezzanine runs along its east side at y 4 ---
  boxes.push(span(12, 0, -31, 16, 2.8, -29, 'machine'), span(-16, 0, -31, -12, 2.8, -29, 'machine'), span(-1.8, 0, -31.6, 1.8, 2.6, -30, 'machine'));
  boxes.push(
    span(3.75, 3.6, -31.7, 7.75, 4, -18.3, 'steel'),
    span(3.75, 4, -31.7, 3.95, 5.1, -18.3, 'steel'), // rails
    span(7.55, 4, -31.7, 7.75, 5.1, -18.3, 'steel'),
    box(3.85, 1.8, -25, 0.25, 3.6, 0.25, 'steel'), // posts
    box(7.65, 1.8, -25, 0.25, 3.6, 0.25, 'steel'),
  );
  // --- The Skybridge: a covered walk over the yard, rising gently from the gantry (y 4) to the Drafting Loft (y 5) ---
  boxes.push(
    span(3.45, 3.6, -43.7, 8.05, 4, -32.3, 'steel'),
    wedge('ramp', 4.05, 4, -43.7, 7.45, LOFT, -32, { axis: 'z', rise: -1 }),
    span(3.45, 8.4, -44, 8.05, 8.8, -32, 'steel'),
    box(5.75, 1.8, -38, 0.6, 3.6, 0.6, 'steel'), // its leg in the yard
  );

  // --- The Undercroft ---
  // Pump Room (the stairs come down a corridor along its south side): pumps and a tank, the flooded corner (the water is
  // only drawn), and crates round the squeeze into the Duck Shrine behind it. Cold Storage has blocks of ice; the Rail
  // Tunnel an old mine cart.
  boxes.push(
    span(7, CELLAR, -24, 9, CELLAR + 1.2, -22, 'machine'),
    span(11, CELLAR, -24, 13, CELLAR + 1.2, -22, 'machine'),
    span(10, CELLAR, -29.7, 13.5, CELLAR + 3.4, -26.7, 'machine'),
    span(20.2, CELLAR, -24.4, 21.7, CELLAR + 1.8, -23, 'crate'),
    span(20.5, CELLAR, -29.7, 21.7, CELLAR + 1.4, -28.2, 'crate'),
    PROPS.altar,
    ...PROPS.ice,
    PROPS.cart,
  );
  // The ramps up out of the tunnels, each in a pit in the North Wing's floor against a partition wall, fenced round its deep
  // end (too tall for a zombie's hop: they walk round to the top rather than drop in).
  boxes.push(
    wedge('ramp', TUNNEL_PIT.x0, CELLAR, TUNNEL_PIT.z0, TUNNEL_PIT.x1, 0, TUNNEL_PIT.z1, { axis: 'z', rise: -1 }),
    wedge('ramp', DRAIN_PIT.x0, CELLAR, DRAIN_PIT.z0, DRAIN_PIT.x1, 0, DRAIN_PIT.z1, { axis: 'z', rise: -1 }),
    ...[TUNNEL_PIT, DRAIN_PIT].flatMap((p) => [
      span(p.x0 - 0.4, 0, p.z0, p.x0 - 0.2, PIT_FENCE, p.z1, 'steel'),
      span(p.x0 - 0.3, 0, p.z1 - 0.1, p.x1, PIT_FENCE, p.z1 + 0.1, 'steel'),
    ]),
  );

  // --- The North Wing ---
  // Showroom: rows of mannequins (narrow: zombies weave between them), and the old cash counter.
  boxes.push(...PROPS.mannequins.map(([x, z]) => box(x, 0.9, z, 0.6, 1.8, 0.6, 'cover')), span(-29.7, 0, -47.6, -27.4, 1.1, -44.3, 'crate'));
  // Sorting Floor: a maze of low conveyors and parcels; the stairs up along the north wall.
  boxes.push(
    span(-6.5, 0, -54.6, 2, 0.95, -53.4, 'steel'),
    span(-8.5, 0, -62, -7.3, 0.95, -56, 'steel'),
    span(-4.2, 0, -61, -3, 0.95, -56.5, 'steel'),
    box(0, 0.5, -60, 1, 1, 1, 'crate'),
    box(-1.2, 0.4, -58.8, 0.8, 0.8, 0.8, 'crate'),
    wedge('ramp', -6.4, 0, -69.7, 4.3, LOFT, -66.3, { axis: 'x', rise: -1 }),
    span(-9.7, 0, -69.7, -6.4, 1.3, -66.3, 'crate'), // parcels stacked under the stairs' landing
  );
  // Break Room: the vending machine and the fridge against the north wall, tables, a sagging couch.
  boxes.push(PROPS.vending, PROPS.fridge, PROPS.couch, ...PROPS.tables.map(([x, z]) => span(x - 1, 0, z - 0.6, x + 1, 0.8, z + 0.6, 'cover')));
  // Drafting Loft: desks and filing cabinets.
  boxes.push(
    ...PROPS.desks.map(([x, z]) => span(x - 1.1, LOFT, z - 0.55, x + 1.1, LOFT + 0.8, z + 0.55, 'cover')),
    span(-29.7, LOFT, -66, -28.9, LOFT + 1.3, -62, 'machine'),
    span(-29.7, LOFT, -50, -28.9, LOFT + 1.3, -46, 'machine'),
  );
  // Clock Room: the giant gear's two sides.
  const gr = PROPS.gear;
  boxes.push(
    span(gr.x - 0.25, LOFT, gr.z - gr.outer, gr.x + 0.25, WING_TOP - 0.2, gr.z - gr.inner, 'cover'),
    span(gr.x - 0.25, LOFT, gr.z + gr.inner, gr.x + 0.25, WING_TOP - 0.2, gr.z + gr.outer, 'cover'),
  );

  // --- The yard: clear of every window's approach ---
  boxes.push(
    span(-6, 0, 28, 6, 2.6, 31, 'machine'), // shipping containers
    span(-6, 0, -84, 6, 2.6, -81, 'machine'),
    box(-41, 0.6, 16, 1.2, 1.2, 1.2, 'crate'),
    box(-39.5, 0.5, 17.5, 1, 1, 1, 'crate'),
    box(41, 0.6, 16, 1.2, 1.2, 1.2, 'crate'),
    box(42.5, 0.8, 15, 1.6, 1.6, 1.6, 'crate'),
    box(-42, 0.6, -40, 1.2, 1.2, 1.2, 'crate'),
    box(42, 0.6, -40, 1.2, 1.2, 1.2, 'crate'),
    box(-30, 0.5, 30, 1, 1, 1, 'crate'),
    box(30, 0.5, 30, 1, 1, 1, 'crate'),
    box(-44, 0.6, -82, 1.2, 1.2, 1.2, 'crate'),
    box(44, 0.6, -82, 1.2, 1.2, 1.2, 'crate'),
  );

  const rooms: Room[] = ROOMS.map((r, id) => ({ id, ...r }));
  const links: Link[] = [
    ...DOORS.map((d, i): Link => ({ a: d.a, b: d.b, door: i, c: v(d.axis === 'x' ? d.c : d.plane, d.y ?? 0, d.axis === 'x' ? d.plane : d.c), n: d.n, half: DOOR_HALF })),
    ...ARCHES.map((a): Link => ({ a: a.a, b: a.b, door: -1, c: a.c, n: a.n, half: a.half })),
  ];

  const start: SpawnPoint[] = [v(-3, 0.01, 19), v(3, 0.01, 19), v(-3, 0.01, 16.5), v(3, 0.01, 16.5)].map((pos) => ({ pos, yaw: 0 }));
  const lay: SurvivalLayout = {
    rooms,
    links,
    doors,
    barricades,
    wallBuys: [
      wallBuy(0, 'marshal', 600, OFFICE, 0, 0, 23.7, Math.PI),
      wallBuy(1, 'rattler', 1000, HALL, -10, 0, -17.7, 0),
      wallBuy(2, 'warden', 1200, BOILER, -21, 0, -13.7, 0),
      wallBuy(3, 'bramble', 1500, STORAGE, 21, 0, -13.7, 0),
      wallBuy(4, 'kestrel', 1500, MEZZ, 10, 4, -17.7, 0),
      wallBuy(5, 'hammer', 3000, SHRINE, 24.6, CELLAR, -28.7, 0), // the Duck Shrine's reward
    ],
    boxSpots: [
      { pos: v(-34.9, 0, -9), yaw: Math.PI / 2, room: BOILER },
      { pos: v(34.9, 0, -28), yaw: -Math.PI / 2, room: DOCK },
      { pos: v(-31, 0, -30.9), yaw: 0, room: LOCKER },
      { pos: v(33, 0, 6.9), yaw: Math.PI, room: STORAGE },
      { pos: v(12, CELLAR, -19.1), yaw: Math.PI, room: PUMP },
      { pos: v(24.6, CELLAR, -24.1), yaw: Math.PI, room: SHRINE },
      { pos: v(25, 0, -68.9), yaw: 0, room: BREAK },
      { pos: v(16, LOFT, -68.9), yaw: 0, room: CLOCK },
    ],
    punch: v(0, 0, -28.4),
    jug: v(33.7, 0, -9),
    perks: [
      // yaw turns the cask so its tap (local +x) points into the room
      { kind: 'mend', pos: v(-33.7, 0, 4.5), yaw: 0, room: BOILER },
      { kind: 'wind', pos: v(-20.3, 0, -29.5), yaw: Math.PI, room: LOCKER },
      { kind: 'zephyr', pos: v(20.3, 0, -29), yaw: 0, room: DOCK },
    ],
    start,
    startRoom: OFFICE,
    power: { pos: v(-21.5, 0, 6.1), yaw: Math.PI },
    // The scythe's parts lie at the far ends: frozen in Cold Storage, held by a mannequin, wedged in the clockwork.
    parts: [
      { pos: v(-20, CELLAR, -22.5), room: COLD },
      { pos: v(-28.5, 0, -57.5), room: SHOWROOM },
      { pos: v(26, LOFT, -50), room: CLOCK },
    ],
    bench: { pos: v(-6, 4, -16.2), yaw: 0 },
    hatch: doors.length,
    hatchPad: padTo((HATCH.x0 + HATCH.x1) / 2, 0, HATCH.z1 + 0.6, v(TOWER.x, TOWER.top + 0.01, TOWER.z), 1.6),
    chutes: CHUTES.map((c) => ({ room: c.room, lid: lid(c.hole) })),
    vent: v(0, 7.5, 0.5), // under the hatch, clear of the pad (z 2.35..4.85): you drop back into the Hall
    tinker: { pos: v(TINKER.x, 0, TINKER.z), yaw: -Math.PI / 2 },
  };
  // The hatch is a door like the rest (bought the same way) but joins no rooms: it opens the way up.
  doors.push({ id: doors.length, name: 'Skyline', price: 2000, box: lid(HATCH), rooms: [HALL, HALL] });

  return { name: 'The Foundry', boxes, triggers: [], decor: [], spawns: start, survival: lay, killY: -40 };
}

export const FOUNDRY = buildFoundry();
