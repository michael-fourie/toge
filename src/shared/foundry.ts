// "The Foundry": the Survival map. A walled-in, derelict factory yard at night. You start in the little Office with a pistol,
// buy doors to open the rest of the building, buy guns off the walls, and gamble on the Mystery Box. The horde breaks in
// through boarded-up bays in the outside walls (nail the boards back up!). Floor plan, x east, z south, y up, metres:
//
//      Locker ─D6─ Furnace (Pack-a-Punch) ──── Dock
//        │D4          │D3                        │D5
//      Boiler ─D1─── HALL (stairs up to the mezzanine) ─D2─ Storage (Juggernog)
//                     │D0
//                   Office (start)
//
// Perks: Swift Mend in the Boiler Room, Second Wind in the Locker Room, Zephyr Fizz on the Loading Dock.
//
// Windows are walled off from players by invisible bars (colliders.ts), so nobody wanders out into the yard.
import type { Box } from './collision.ts';
import type { Barricade, Door, Link, Room, SurvivalLayout, WallBuy } from './layout.ts';
import { type MapData, type SpawnPoint, box, span, wedge } from './map.ts';

const T = 0.6; // wall thickness
const H = 9; // wall height: the ceiling
const DOOR_HALF = 1.6;
const DOOR_TOP = 3.4;
const WIN_HALF = 1.5;
const WIN_TOP = 3;

type Axis = 'x' | 'z';
interface Gap {
  c: number;
  half: number;
  top: number;
}

/** A wall along `axis` at `plane` (the other coordinate), from a0 to a1, with doorway-shaped holes. */
function run(axis: Axis, plane: number, a0: number, a1: number, gaps: Gap[]): Box[] {
  const out: Box[] = [];
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    out.push(axis === 'x' ? span(a, y0, plane - T / 2, b, y1, plane + T / 2, 'brick') : span(plane - T / 2, y0, a, plane + T / 2, y1, b, 'brick'));
  };
  let cursor = a0 - T / 2;
  for (const g of [...gaps].sort((p, q) => p.c - q.c)) {
    piece(cursor, g.c - g.half, 0, H);
    piece(g.c - g.half, g.c + g.half, g.top, H);
    cursor = g.c + g.half;
  }
  piece(cursor, a1 + T / 2, 0, H);
  return out;
}

/** A solid slab filling a gap, `thick` metres through the wall. */
function plug(axis: Axis, plane: number, g: Gap, thick: number): Box {
  return axis === 'x'
    ? span(g.c - g.half, 0, plane - thick / 2, g.c + g.half, g.top, plane + thick / 2, 'steel')
    : span(plane - thick / 2, 0, g.c - g.half, plane + thick / 2, g.top, g.c + g.half, 'steel');
}

// Rooms. Order matters (see Nav.roomAt): the stairs and the mezzanine sit inside the hall's footprint, so they come first.
const ROOMS: Omit<Room, 'id'>[] = [
  { name: 'Stairs', x0: -17.6, x1: -14.2, z0: -12, z1: 0, y0: -0.5, y1: 4.8, base: 2 },
  { name: 'Mezzanine', x0: -18, x1: 18, z0: -18, z1: -12, y0: 3.4, y1: 8.8 },
  { name: 'Assembly Hall', x0: -18, x1: 18, z0: -18, z1: 12, y0: -0.5, y1: 8.8 },
  { name: 'Office', x0: -6, x1: 6, z0: 12, z1: 24, y0: -0.5, y1: 8.8 },
  { name: 'Boiler Room', x0: -36, x1: -18, z0: -14, z1: 8, y0: -0.5, y1: 8.8 },
  { name: 'Storage', x0: 18, x1: 36, z0: -14, z1: 8, y0: -0.5, y1: 8.8 },
  { name: 'Locker Room', x0: -36, x1: -18, z0: -32, z1: -14, y0: -0.5, y1: 8.8 },
  { name: 'Loading Dock', x0: 18, x1: 36, z0: -32, z1: -14, y0: -0.5, y1: 8.8 },
  { name: 'Furnace', x0: -18, x1: 18, z0: -32, z1: -18, y0: -0.5, y1: 8.8 },
];
const [STAIRS, MEZZ, HALL, OFFICE, BOILER, STORAGE, LOCKER, DOCK, FURNACE] = ROOMS.map((_, i) => i);

interface DoorSpec {
  name: string;
  price: number;
  axis: Axis;
  plane: number;
  c: number;
  /** The room on the low side and the room on the high side of the wall's perpendicular axis, in link direction a -> b. */
  a: number;
  b: number;
  n: { x: number; z: number };
}
const DOORS: DoorSpec[] = [
  { name: 'Office door', price: 750, axis: 'x', plane: 12, c: 0, a: OFFICE, b: HALL, n: { x: 0, z: -1 } },
  { name: 'Boiler Room', price: 1000, axis: 'z', plane: -18, c: 5, a: HALL, b: BOILER, n: { x: -1, z: 0 } },
  { name: 'Storage', price: 1000, axis: 'z', plane: 18, c: 5, a: HALL, b: STORAGE, n: { x: 1, z: 0 } },
  { name: 'Furnace', price: 1500, axis: 'x', plane: -18, c: 0, a: HALL, b: FURNACE, n: { x: 0, z: -1 } },
  { name: 'Locker Room', price: 1250, axis: 'x', plane: -14, c: -27, a: BOILER, b: LOCKER, n: { x: 0, z: -1 } },
  { name: 'Loading Dock', price: 1250, axis: 'x', plane: -14, c: 27, a: STORAGE, b: DOCK, n: { x: 0, z: -1 } },
  { name: 'Locker to Furnace', price: 1000, axis: 'z', plane: -18, c: -25, a: LOCKER, b: FURNACE, n: { x: 1, z: 0 } },
];

interface WindowSpec {
  room: number;
  axis: Axis;
  plane: number;
  c: number;
  out: { x: number; z: number };
}
const W = -1;
const E = 1;
const win = (room: number, axis: Axis, plane: number, c: number, out: { x: number; z: number }): WindowSpec => ({ room, axis, plane, c, out });
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
];

/** Every outside and partition wall: [axis, plane, from, to]. */
const WALLS: [Axis, number, number, number][] = [
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
];

const v = (x: number, y: number, z: number) => ({ x, y, z });

/** Where a wall gun hangs: on the wall face at `wall`, facing `yaw` (the way the display faces), with `at` the spot to stand. */
function wallBuy(id: number, weapon: WallBuy['weapon'], price: number, room: number, x: number, y: number, z: number, yaw: number): WallBuy {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { id, weapon, price, room, pos: v(x + fx * 0.02, y, z + fz * 0.02), yaw, at: v(x + fx * 1.05, y > 3 ? 4 : 0, z + fz * 1.05) };
}

function buildFoundry(): MapData {
  const boxes: Box[] = [
    span(-51, -1, -47, 51, 0, 39, 'gravel'), // the yard and, under it, every floor
    // Perimeter wall.
    span(-51, 0, -47, 51, 14, -46, 'brick'),
    span(-51, 0, 38, 51, 14, 39, 'brick'),
    span(-51, 0, -46, -50, 14, 38, 'brick'),
    span(50, 0, -46, 51, 14, 38, 'brick'),
    // Roofs: they keep the grapple honest, too.
    span(-36.4, H, -32.4, 36.4, H + 0.8, 8.4, 'steel'),
    span(-18.4, H, 8.4, 18.4, H + 0.8, 12.4, 'steel'),
    span(-6.4, H, 12.4, 6.4, H + 0.8, 24.4, 'steel'),
  ];

  const doors: Door[] = DOORS.map((d, id) => {
    const g = { c: d.c, half: DOOR_HALF, top: DOOR_TOP };
    return { id, name: d.name, price: d.price, box: plug(d.axis, d.plane, g, 0.5), rooms: [d.a, d.b] };
  });
  for (const [axis, plane, a0, a1] of WALLS) {
    const gaps: Gap[] = [
      ...DOORS.filter((d) => d.axis === axis && d.plane === plane && d.c > a0 && d.c < a1).map((d) => ({ c: d.c, half: DOOR_HALF, top: DOOR_TOP })),
      ...WINDOWS.filter((w) => w.axis === axis && w.plane === plane && w.c > a0 && w.c < a1).map((w) => ({ c: w.c, half: WIN_HALF, top: WIN_TOP })),
    ];
    boxes.push(...run(axis, plane, a0, a1, gaps));
  }

  const barricades: Barricade[] = WINDOWS.map((w, id) => {
    const g = { c: w.c, half: WIN_HALF, top: WIN_TOP };
    const [px, pz] = w.axis === 'x' ? [w.c, w.plane] : [w.plane, w.c];
    const side = { x: -w.out.z, z: w.out.x }; // along the wall
    const at = (out: number, lat = 0) => v(px + w.out.x * out + side.x * lat, 0.01, pz + w.out.z * out + side.z * lat);
    return {
      id,
      room: w.room,
      pos: v(px, 0, pz),
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
  );
  // --- Office ---
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
  // --- Furnace ---
  boxes.push(span(12, 0, -31, 16, 2.8, -29, 'machine'), span(-16, 0, -31, -12, 2.8, -29, 'machine'), span(-1.8, 0, -31.6, 1.8, 2.6, -30, 'machine')); // ovens and the Pack-a-Punch
  // --- The yard: clear of every window's approach ---
  boxes.push(
    span(-6, 0, 28, 6, 2.6, 31, 'machine'), // shipping container
    box(-41, 0.6, 16, 1.2, 1.2, 1.2, 'crate'),
    box(-39.5, 0.5, 17.5, 1, 1, 1, 'crate'),
    box(41, 0.6, 16, 1.2, 1.2, 1.2, 'crate'),
    box(42.5, 0.8, 15, 1.6, 1.6, 1.6, 'crate'),
    box(-42, 0.6, -40, 1.2, 1.2, 1.2, 'crate'),
    box(42, 0.6, -40, 1.2, 1.2, 1.2, 'crate'),
    box(-30, 0.5, 30, 1, 1, 1, 'crate'),
    box(30, 0.5, 30, 1, 1, 1, 'crate'),
  );

  const rooms: Room[] = ROOMS.map((r, id) => ({ id, ...r }));
  const links: Link[] = [
    ...DOORS.map((d, i): Link => ({
      a: d.a,
      b: d.b,
      door: i,
      c: v(d.axis === 'x' ? d.c : d.plane, 0, d.axis === 'x' ? d.plane : d.c),
      n: d.n,
      half: DOOR_HALF,
    })),
    { a: HALL, b: STAIRS, door: -1, c: v(-15.9, 0, 0), n: { x: 0, z: -1 }, half: 1.7 },
    { a: STAIRS, b: MEZZ, door: -1, c: v(-15.9, 4, -12), n: { x: 0, z: -1 }, half: 1.7 },
  ];

  const start: SpawnPoint[] = [v(-3, 0.01, 19), v(3, 0.01, 19), v(-3, 0.01, 16.5), v(3, 0.01, 16.5)].map((pos) => ({ pos, yaw: 0 }));
  const lay: SurvivalLayout = {
    rooms,
    links,
    doors,
    barricades,
    wallBuys: [
      wallBuy(0, 'marshal', 600, OFFICE, 0, 1.7, 23.7, Math.PI),
      wallBuy(1, 'rattler', 1000, HALL, -10, 1.7, -17.7, 0),
      wallBuy(2, 'warden', 1200, BOILER, -21, 1.7, -13.7, 0),
      wallBuy(3, 'bramble', 1500, STORAGE, 21, 1.7, -13.7, 0),
      wallBuy(4, 'kestrel', 1500, MEZZ, 10, 5.7, -17.7, 0),
    ],
    boxSpots: [
      { pos: v(-34.9, 0, -9), yaw: Math.PI / 2, room: BOILER },
      { pos: v(34.9, 0, -28), yaw: -Math.PI / 2, room: DOCK },
      { pos: v(-31, 0, -30.9), yaw: 0, room: LOCKER },
      { pos: v(33, 0, 6.9), yaw: Math.PI, room: STORAGE },
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
  };

  return { name: 'The Foundry', boxes, triggers: [], decor: [], spawns: start, survival: lay, killY: -40 };
}

export const FOUNDRY = buildFoundry();
