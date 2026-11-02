import type { Box, Trigger } from './collision.ts';
import { touches } from './collision.ts';
import { PLAYER } from './constants.ts';
import type { Vec3 } from '../../shared/math.ts';
import { type Decor, type MapData, type SpawnPoint, box, gate, hook, house, padTo, puff, shrine, span, surfFrame, wedge } from './map.ts';

/**
 * "Wildmere": the Battle Royale island, about 500 m across (Windward is ~200). One big meadow floating over the cloud
 * sea, with a place to drop into in every direction. Map plan: docs/MAP_PLAN.md.
 *
 *   Old Town       the middle: six houses (two or three storeys) round a plaza with a shrine. The most loot, the most fights
 *   Windmill Hill  NE: a two-tier hill with a tower on top; its ramps are long slides
 *   Lookout Hill   SE: a tall mesa with ramps on every side and a shrine on top: sees half the island
 *   Sky Rail       E: a pad onto a stone pillar, a gate off its edge onto a 70 m surf rail toward the farm
 *   Farmstead      E: a barn, a farmhouse, hay bales and fences
 *   Sky Garden     N: a four-storey tower and floating platforms chained by pads, hooks overhead
 *   Old Forest     S: dense trees and a cabin
 *   Gorge Run      W: a chasm through the island (fall in and you're out). Drop in from the north edge onto three
 *                  descending surf A-frames, then a ramp climbs out through a cutting. Two log bridges cross it
 *   Westcliff      beyond the gorge: a house, a shrine and a hill
 *   Hills          a dozen more knolls and mesas everywhere, wind gates along the roads, hooks over the open fields
 */

/** The island's edge: rows of ground, each [z0, z1, half-width in x]. Roughly a 250 m circle. */
const ROWS: [number, number, number][] = [
  [-250, -200, 109],
  [-200, -150, 178],
  [-150, -100, 216],
  [-100, -50, 238],
  [-50, 0, 249],
  [0, 50, 249],
  [50, 100, 238],
  [100, 150, 216],
  [150, 200, 178],
  [200, 250, 109],
];

/** The gorge: open to the void between these x, for |z| < GORGE_Z. */
const GORGE_X: [number, number] = [-168, -142];
const GORGE_Z = 100;
/** Holes in the ground (x0, z0, x1, z1): the gorge, and the cutting its exit ramp climbs out through. */
const HOLES: [number, number, number, number][] = [
  [GORGE_X[0], -GORGE_Z, GORGE_X[1], GORGE_Z],
  [-162, -130, -148, -GORGE_Z],
];
/** The ground is a thick slab, so the gorge has real walls. */
const GROUND_BOTTOM = -24;

type Side = '+x' | '-x' | '+z' | '-z';
const ALL: Side[] = ['+x', '-x', '+z', '-z'];

/**
 * A hill: a grassy plateau of height `h` standing on `y0`, with a walkable ramp (about 22°, or `slope` rise per metre)
 * up each listed side. Ramps are as wide as the side, up to 14 m.
 */
function hill(cx: number, cz: number, w: number, d: number, h: number, sides: Side[] = ALL, y0 = 0, slope = 0.4): Box[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const L = h / slope;
  const out = [span(x0, y0, z0, x1, y0 + h, z1, 'floor')];
  const rx = Math.min(w, 14) / 2;
  const rz = Math.min(d, 14) / 2;
  for (const s of sides) {
    if (s === '+x') out.push(wedge('ramp', x1, y0, cz - rz, x1 + L, y0 + h, cz + rz, { axis: 'x', rise: -1 }));
    if (s === '-x') out.push(wedge('ramp', x0 - L, y0, cz - rz, x0, y0 + h, cz + rz, { axis: 'x', rise: 1 }));
    if (s === '+z') out.push(wedge('ramp', cx - rx, y0, z1, cx + rx, y0 + h, z1 + L, { axis: 'z', rise: -1 }));
    if (s === '-z') out.push(wedge('ramp', cx - rx, y0, z0 - L, cx + rx, y0 + h, z0, { axis: 'z', rise: 1 }));
  }
  return out;
}

/** A house plus a loot spot on every storey (in the room past the stairs) and on its roof. */
function home(x0: number, z0: number, x1: number, z1: number, floorY: number, floors: number, doors: Side[], balcony: Side | undefined, loot: Vec3[]): Box[] {
  const cx = (x0 + x1) / 2;
  const zB = z0 + 0.5 + 1.2 + 6.5; // where the stair ramps end (see house())
  const room = (zB + z1 - 0.5) / 2;
  for (let k = 0; k < floors; k++) loot.push({ x: cx, y: floorY + 4 * k, z: room });
  loot.push({ x: cx, y: floorY + 4 * floors, z: (z0 + z1) / 2 });
  return house(x0, z0, x1, z1, floorY, floors, doors, balcony);
}

/** Seeded random numbers, so the client and the server build the same island. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** On solid ground, at least `margin` from the island's edge and the gorge. */
function onIsland(x: number, z: number, margin = 3): boolean {
  const row = ROWS.find(([z0, z1]) => z >= z0 && z < z1);
  if (!row || Math.abs(x) > row[2] - margin || z < ROWS[0][0] + margin || z > ROWS[ROWS.length - 1][1] - margin) return false;
  return !HOLES.some(([x0, z0, x1, z1]) => x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin);
}

/** A ground box with the holes cut out (each hole splits it into up to four pieces around it). */
function cut(b: Box): Box[] {
  let out = [b];
  for (const [x0, z0, x1, z1] of HOLES) {
    out = out.flatMap((g) => {
      if (g.min.x >= x1 || g.max.x <= x0 || g.min.z >= z1 || g.max.z <= z0) return [g];
      const y0 = g.min.y;
      const y1 = g.max.y;
      const parts = [
        span(g.min.x, y0, g.min.z, x0, y1, g.max.z, 'floor'), // west of the hole
        span(x1, y0, g.min.z, g.max.x, y1, g.max.z, 'floor'), // east
        span(Math.max(x0, g.min.x), y0, g.min.z, Math.min(x1, g.max.x), y1, z0, 'floor'), // south
        span(Math.max(x0, g.min.x), y0, z1, Math.min(x1, g.max.x), y1, g.max.z, 'floor'), // north
      ];
      return parts.filter((p) => p.max.x - p.min.x > 0.01 && p.max.z - p.min.z > 0.01);
    });
  }
  return out;
}

/** Does a footprint (with `pad` metres around it) touch any box above the ground? */
const crowded = (boxes: readonly Box[], x0: number, z0: number, x1: number, z1: number, pad: number) =>
  boxes.some((b) => b.max.y > 0.05 && b.min.x < x1 + pad && b.max.x > x0 - pad && b.min.z < z1 + pad && b.max.z > z0 - pad);

function buildWildmere(): MapData {
  const loot: Vec3[] = [];
  const decor: Decor[] = [];

  // ---- The ground: rows of thick grass slab, split around the gorge. ----
  const ground: Box[] = [];
  for (const [z0, z1, hw] of ROWS) {
    ground.push(...cut(span(-hw, GROUND_BOTTOM, z0, hw, 0, z1, 'floor')));
  }

  const boxes: Box[] = [
    ...ground,

    // ---- Old Town: six houses round a plaza, a shrine in the middle. ----
    ...home(-30, -28, -18, -16, 0, 3, ['+x', '+z'], '+z', loot),
    ...home(18, -28, 30, -16, 0, 2, ['-x', '+z'], undefined, loot),
    ...home(-30, 16, -18, 28, 0, 2, ['+x', '-z'], '+x', loot),
    ...home(18, 16, 30, 28, 0, 3, ['-x', '-z'], '-z', loot),
    ...home(-6, -52, 6, -40, 0, 2, ['+z', '-z'], undefined, loot),
    ...home(-6, 40, 6, 52, 0, 2, ['-z', '+z'], '-x', loot),
    ...shrine(0, 0, 0, 7, 4),
    box(9, 0.6, 7, 1.2, 1.2, 1.2, 'cover'),
    box(-9, 0.75, -8, 1.5, 1.5, 1.5, 'cover'),
    box(-10.4, 0.6, -6.6, 1.2, 1.2, 1.2, 'cover'),
    box(8, 0.6, -10, 1.2, 1.2, 1.2, 'cover'),
    span(-14, 0, 9, -8, 1.1, 9.5, 'cover'), // a low garden wall
    span(10, 0, -14, 10.5, 1.1, -9, 'cover'),

    // ---- Windmill Hill (NE): two tiers, a tower on top. ----
    ...hill(110, -110, 60, 60, 8, ['-x', '+z']),
    ...hill(110, -110, 24, 24, 8, ['+z'], 8, 0.5),
    ...home(105, -115, 115, -105, 16, 2, ['+z'], '-x', loot),
    box(130, 8.75, -130, 1.5, 1.5, 1.5, 'cover'),
    box(88, 8.6, -88, 1.2, 1.2, 1.2, 'cover'),

    // ---- Lookout Hill (SE): a tall mesa, ramps on every side, a shrine on top. ----
    ...hill(120, 120, 40, 40, 12),
    ...shrine(120, 12, 120, 7, 4),
    box(106, 12.75, 106, 1.5, 1.5, 1.5, 'cover'),
    box(134, 12.6, 134, 1.2, 1.2, 1.2, 'cover'),

    // ---- Sky Rail (E): a pad up onto a pillar, a gate off its north edge onto the rail. ----
    span(179, 0, -111, 191, 12, -99, 'floor'),
    padTo(185, 0, -124, { x: 185, y: 12, z: -106 }, 3),
    ...surfFrame('z', 185, 10, -96, -30, 4),

    // ---- Farmstead (E): barn, farmhouse, hay bales, fences. ----
    ...home(150, -8, 168, 8, 0, 2, ['-x', '+z'], undefined, loot),
    ...home(178, 18, 190, 30, 0, 2, ['-x'], '-z', loot),
    box(160, 0.7, 18, 1.6, 1.4, 1.6, 'cover'),
    box(162, 0.7, 22, 1.6, 1.4, 1.6, 'cover'),
    box(172, 0.7, 4, 1.6, 1.4, 1.6, 'cover'),
    box(172, 2.1, 4, 1.6, 1.4, 1.6, 'cover'),
    box(140, 0.7, 26, 1.6, 1.4, 1.6, 'cover'),
    span(140, 0, -20, 200, 1, -19.6, 'cover'), // fences: low enough to hop
    span(200, 0, -19.6, 200.4, 1, 40, 'cover'),

    // ---- Sky Garden (N): a four-storey tower and floating platforms chained by pads. ----
    ...home(-5, 165, 5, 175, 0, 4, ['-z', '+z'], undefined, loot),
    span(16, 7, 160, 28, 8, 172, 'branch'),
    padTo(22, 0, 145, { x: 21, y: 8, z: 164 }, 3),
    span(34, 13, 176, 44, 14, 186, 'branch'),
    padTo(26, 8, 169, { x: 39, y: 14, z: 181 }, 3),
    span(14, 19, 190, 24, 20, 200, 'branch'),
    padTo(41, 14, 184, { x: 19, y: 20, z: 194 }, 3),
    span(-30, 9, 180, -20, 10, 190, 'branch'),
    padTo(-25, 0, 162, { x: -25, y: 10, z: 184 }, 3),
    hook(0, 32, 186),
    hook(30, 27, 204),

    // ---- Old Forest (S): a cabin among the trees (the trees themselves are added below), a fallen log. ----
    ...home(-16, -200, -4, -188, 0, 1, ['+z', '-x'], undefined, loot),
    span(20, 0, -180, 34, 1.2, -178.8, 'trunk'),

    // ---- Gorge Run (W): three descending surf A-frames down the chasm, a landing and a ramp out at the bottom. ----
    ...surfFrame('z', -155, -3, 40, 96, 7),
    ...surfFrame('z', -155, -7, -18, 36, 7),
    ...surfFrame('z', -155, -11, -78, -22, 7),
    span(GORGE_X[0], -13, -100, GORGE_X[1], -12, -80, 'floor'), // the landing at the bottom...
    wedge('ramp', -162, -12, -130, -148, 0, -100, { axis: 'z', rise: -1 }), // ...and the ramp up the cutting, out onto the meadow
    span(GORGE_X[0], -0.8, -2, GORGE_X[1], 0, 2, 'branch'), // log bridges
    span(GORGE_X[0], -0.8, -62, GORGE_X[1], 0, -58, 'branch'),
    hook(-155, 12, -95),

    // ---- Westcliff: beyond the gorge. ----
    ...home(-222, -30, -210, -18, 0, 2, ['+x', '-z'], '+x', loot),
    ...shrine(-200, 0, 20, 7, 4),
    ...hill(-205, 64, 34, 26, 7, ['-z', '+z']),

    // ---- Hills everywhere else. ----
    ...hill(-90, 120, 50, 40, 6, ['+x', '-z']), // Sleepy Hill, and its top tier
    ...hill(-95, 125, 18, 18, 6, ['+x'], 6),
    ...hill(60, 70, 30, 30, 6), // Picnic Knoll
    ...hill(-65, 60, 26, 26, 5),
    ...hill(65, -60, 28, 24, 7),
    ...hill(-110, -60, 40, 30, 9, ['+x', '-z', '+z']),
    ...hill(-130, -170, 30, 24, 8, ['+x', '+z']),
    ...hill(190, 100, 26, 30, 8, ['-x', '-z']),
    ...hill(-150, 170, 28, 24, 7, ['+x', '-z']),
    ...hill(60, 205, 26, 20, 6, ['-x', '-z']),

    // Grapple hooks high over the open fields: a way across without a road.
    hook(0, 30, -110),
    hook(100, 28, 0),
    hook(-100, 28, 0),
    hook(80, 30, 160),
    hook(-60, 30, -180),
    hook(-200, 26, -80),
  ];

  const triggers: Trigger[] = [
    gate(180, 12, -99.5, 190, 16, -98, '+z', 16), // off the pillar onto the Sky Rail
    gate(-162, 0, 100, -148, 5, 101.5, '-z', 16), // over the gorge's north edge onto the first A-frame
    gate(-162, -8, 37, -148, 0, 38.5, '-z', 18), // between the A-frames: keep your speed up
    gate(-162, -12, -21, -148, -4, -19.5, '-z', 18),
    gate(-162, -12, -99, -148, -8, -97.5, '-z', 16), // the foot of the exit ramp: a push up it
    // Wind lanes along the roads out of town (they push either way).
    gate(80, 0, -4, 81.5, 4, 4, '+x', 16),
    gate(-4, 0, -90, 4, 4, -88.5, '-z', 16),
    gate(-4, 0, 100, 4, 4, 101.5, '+z', 16),
    gate(-120, 0, -4, -118.5, 4, 4, '-x', 16),
    // Puffballs in the fields.
    puff(30, 0, -100, 9),
    puff(100, 0, 40, 8),
    puff(-30, 0, 120, 8),
    puff(-40, 0, -110, 8),
  ];

  // Loot on the hilltops, platforms and other places worth climbing to.
  loot.push(
    { x: 0, y: 0, z: 0 }, // in the plaza shrine
    { x: 0, y: 4.6, z: 0 }, // on its roof
    { x: 126, y: 12, z: 112 }, // Lookout Hill, by its shrine and inside it
    { x: 120, y: 12, z: 120 },
    { x: 125, y: 8, z: -132 }, // Windmill Hill, lower tier
    { x: 95, y: 8, z: -90 },
    { x: 185, y: 12, z: -106 }, // the pillar
    { x: 21, y: 8, z: 164 }, // Sky Garden platforms
    { x: 39, y: 14, z: 181 },
    { x: 19, y: 20, z: 196 },
    { x: -25, y: 10, z: 186 },
    { x: -150, y: -12, z: -86 }, // the bottom of the gorge
    { x: -200, y: 0, z: 20 }, // Westcliff shrine
    { x: -205, y: 7, z: 64 },
    { x: -80, y: 6, z: 110 }, // Sleepy Hill
    { x: -95, y: 12, z: 125 },
    { x: 60, y: 6, z: 70 },
    { x: -65, y: 5, z: 60 },
    { x: 65, y: 7, z: -60 },
    { x: -110, y: 9, z: -60 },
    { x: -130, y: 8, z: -170 },
    { x: 190, y: 8, z: 100 },
    { x: -150, y: 7, z: 170 },
    { x: 60, y: 6, z: 205 },
  );

  // ---- Trees: a dense forest in the south, groves everywhere else. A bark trunk you can wallrun, a canopy you can see through. ----
  const r = seeded(7);
  const trees: Box[] = [];
  const plant = (x: number, z: number) => {
    const t = 0.6 + r() * 0.3;
    if (!onIsland(x, z, 6) || crowded([...boxes, ...trees], x - t, z - t, x + t, z + t, 4)) return;
    const h = 5 + r() * 4;
    trees.push(span(x - t, 0, z - t, x + t, h, z + t, 'trunk'));
    decor.push({ kind: 'canopy', pos: { x, y: h, z }, radius: 3 + r() * 2 });
  };
  for (let i = 0; i < 70; i++) plant(-90 + r() * 160, -240 + r() * 90); // the Old Forest
  const groves: [number, number][] = [[-60, -30], [40, -110], [150, 60], [-40, 90], [-200, -60], [-220, 30], [130, -40], [-100, 190], [100, 200], [-80, -110], [30, 130], [210, -60], [-40, 220], [150, 160]];
  for (const [gx, gz] of groves) for (let i = 0; i < 7; i++) plant(gx + (r() - 0.5) * 34, gz + (r() - 0.5) * 34);
  boxes.push(...trees);

  // ---- Boulders: cover in the open. ----
  for (let i = 0; i < 70; i++) {
    const x = -240 + r() * 480;
    const z = -240 + r() * 480;
    const s = 1.6 + r() * 2;
    if (!onIsland(x, z, 6) || crowded(boxes, x - s, z - s, x + s, z + s, 5)) continue;
    boxes.push(box(x, (s * 0.8) / 2, z, s, s * 0.8, s * (0.8 + r() * 0.5), 'wall'));
  }

  // ---- Field loot: scattered over the meadows (and the forest floor). ----
  const solid = boxes.filter((b) => b.kind !== 'hook');
  for (let n = 0; n < 60; ) {
    const x = -240 + r() * 480;
    const z = -240 + r() * 480;
    if (!onIsland(x, z, 8) || crowded(solid, x - 1, z - 1, x + 1, z + 1, 1.5)) continue;
    loot.push({ x: Math.round(x * 10) / 10, y: 0, z: Math.round(z * 10) / 10 });
    n++;
  }

  return {
    name: 'Wildmere',
    boxes,
    triggers,
    decor,
    spawns: royaleSpawns(solid, triggers, 48),
    royale: { loot, zone: { x: 0, z: 0, r: 280 } },
    killY: -40,
  };
}

/**
 * Where a match drops everyone: spots on open ground across the whole island (with headroom, clear of triggers),
 * farthest-point sampled so they are evenly spread. Each faces the middle. Deterministic.
 */
function royaleSpawns(solid: readonly Box[], triggers: readonly Trigger[], count: number): SpawnPoint[] {
  const R = PLAYER.halfWidth + 0.3;
  const spots: Vec3[] = [];
  for (let x = -240; x <= 240; x += 8)
    for (let z = -240; z <= 240; z += 8) {
      if (!onIsland(x, z, 10)) continue;
      const p = { x, y: 0.01, z };
      if (solid.some((o) => o.max.y > 0.05 && o.min.x < x + R && o.max.x > x - R && o.min.z < z + R && o.max.z > z - R && o.min.y < PLAYER.height + 0.3)) continue;
      if (triggers.some((t) => touches(p, t))) continue;
      spots.push(p);
    }
  const near = spots.map(() => Infinity);
  const picked: Vec3[] = [];
  let next = 0;
  while (picked.length < Math.min(count, spots.length)) {
    const p = spots[next];
    picked.push(p);
    let best = -1;
    for (let i = 0; i < spots.length; i++) {
      near[i] = Math.min(near[i], Math.hypot(spots[i].x - p.x, spots[i].z - p.z));
      if (best < 0 || near[i] > near[best]) best = i;
    }
    next = best;
  }
  return picked.map((pos) => ({ pos, yaw: Math.atan2(pos.x, pos.z) }));
}

export const WILDMERE = buildWildmere();
