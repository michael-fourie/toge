import type { Box, BoxKind, RampShape, Trigger } from './collision.ts';
import { MOVE } from './constants.ts';
import type { Vec3 } from './math.ts';

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

/** Purely visual set dressing (no collision). */
export interface Decor {
  kind: 'canopy';
  pos: Vec3;
  radius: number;
}

export interface MapData {
  name: string;
  boxes: Box[];
  triggers: Trigger[];
  decor: Decor[];
  spawns: SpawnPoint[];
  killY: number;
}

// ---------------------------------------------------------------------------
// Building blocks

/** Box from centre + size. */
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, kind: BoxKind): Box {
  return { min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 }, max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 }, kind };
}

/** Box from min/max corners. */
function span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: BoxKind): Box {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind };
}

/** A wedge from min/max corners whose top rises along `axis` toward `rise`. */
function wedge(kind: 'ramp' | 'surf', x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ramp: RampShape): Box {
  return { ...span(x0, y0, z0, x1, y1, z1, kind), ramp };
}

/**
 * A surf "A-frame" over the void, like CS surf: two steep faces meeting at a ridge.
 * The ridge runs along `along`; `slopeDeg` is each face's angle from horizontal.
 */
function surfFrame(along: 'x' | 'z', ridge: number, ridgeY: number, from: number, to: number, halfWidth: number, slopeDeg = 55): Box[] {
  const baseY = ridgeY - halfWidth * Math.tan((slopeDeg * Math.PI) / 180);
  const across: 'x' | 'z' = along === 'z' ? 'x' : 'z';
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const make = (a0: number, a1: number, rise: 1 | -1): Box => {
    const [x0, x1, z0, z1] = across === 'x' ? [a0, a1, lo, hi] : [lo, hi, a0, a1];
    return wedge('surf', x0, baseY, z0, x1, ridgeY, z1, { axis: across, rise });
  };
  return [make(ridge - halfWidth, ridge, 1), make(ridge, ridge + halfWidth, -1)];
}

/**
 * Launch velocity that throws a player from `from` to land at `to`, peaking `apex` metres above
 * the higher of the two. Uses the live gravity so retuning keeps pads accurate.
 */
function launchTo(from: Vec3, to: Vec3, apex: number): Vec3 {
  const g = MOVE.gravity;
  const top = Math.max(from.y, to.y) + apex;
  const vy = Math.sqrt(2 * g * (top - from.y));
  const t = vy / g + Math.sqrt((2 * (top - to.y)) / g);
  return { x: (to.x - from.x) / t, y: vy, z: (to.z - from.z) / t };
}

/** Launch pad on a floor at (x, floorY, z) that throws you onto `to`. */
function padTo(x: number, floorY: number, z: number, to: Vec3, apex: number, size = 2.5): Box {
  const pad = box(x, floorY + 0.1, z, size, 0.2, size, 'pad');
  return { ...pad, launch: launchTo({ x, y: floorY + 0.2, z }, to, apex) };
}

const DIRS = { '+x': { x: 1, y: 0, z: 0 }, '-x': { x: -1, y: 0, z: 0 }, '+z': { x: 0, y: 0, z: 1 }, '-z': { x: 0, y: 0, z: -1 } };

/** Wind gate (speed booster): a thin slab across your path, from min to max corners. */
function gate(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: keyof typeof DIRS, speed: number): Trigger {
  return { kind: 'boost', min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, dir: DIRS[dir], speed };
}

/** Puffball (jump booster) sitting on a floor; `height` is how high it throws you. */
function puff(x: number, floorY: number, z: number, height: number, size = 3): Trigger {
  const h = size / 2;
  const up = Math.sqrt(2 * MOVE.gravity * height);
  return { kind: 'bounce', min: { x: x - h, y: floorY, z: z - h }, max: { x: x + h, y: floorY + 0.6, z: z + h }, up };
}

// Rotate 180° about Y: the map is point-symmetric so both halves play identically.
const flip = (v: Vec3): Vec3 => ({ x: -v.x, y: v.y, z: -v.z });
function flipBounds<T extends { min: Vec3; max: Vec3 }>(b: T): T {
  return { ...b, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } };
}
function mirror(b: Box): Box {
  return { ...flipBounds(b), launch: b.launch && flip(b.launch), ramp: b.ramp && { axis: b.ramp.axis, rise: -b.ramp.rise as 1 | -1 } };
}
const mirrorTrigger = (t: Trigger): Trigger => (t.kind === 'boost' ? { ...flipBounds(t), dir: flip(t.dir) } : flipBounds(t));

/**
 * A little stone shrine: 4 walls with doorways on the ±Z sides, sniping windows on the ±X sides,
 * and a flat roof you can stand on.
 */
function shrine(cx: number, floorY: number, cz: number, size: number, height: number): Box[] {
  const h = size / 2;
  const t = 0.6; // wall thickness
  const y0 = floorY;
  const y1 = floorY + height;
  const door = 1.3; // half-width of doorway
  const doorTop = y0 + 2.6;
  const win = 1.6; // half-width of window
  const winLo = y0 + 1.2;
  const winHi = y0 + 2.3;
  const out: Box[] = [];
  for (const s of [-1, 1]) {
    const z0 = cz + s * h - t / 2;
    const z1 = cz + s * h + t / 2;
    out.push(span(cx - h, y0, z0, cx - door, y1, z1, 'wall'));
    out.push(span(cx + door, y0, z0, cx + h, y1, z1, 'wall'));
    out.push(span(cx - door, doorTop, z0, cx + door, y1, z1, 'wall'));
    const x0 = cx + s * h - t / 2;
    const x1 = cx + s * h + t / 2;
    out.push(span(x0, y0, cz - h + t / 2, x1, winLo, cz + h - t / 2, 'wall'));
    out.push(span(x0, winHi, cz - h + t / 2, x1, y1, cz + h - t / 2, 'wall'));
    out.push(span(x0, winLo, cz - h + t / 2, x1, winHi, cz - win, 'wall'));
    out.push(span(x0, winLo, cz + win, x1, winHi, cz + h - t / 2, 'wall'));
  }
  out.push(span(cx - h - 0.4, y1, cz - h - 0.4, cx + h + 0.4, y1 + 0.6, cz + h + 0.4, 'floor')); // standable roof
  return out;
}

// ---------------------------------------------------------------------------

/**
 * "Windward" (design notes: docs/MAP_PLAN.md). Two harbour islands face each other across a
 * great tree. Each half has three lanes from spawn to the middle:
 *   left   Surf Gorge  two descending surf A-frames with a gate between; exit terrace + ramp up
 *   centre Windway     slide ramp -> wind gate -> bhop stones (the undercliff below catches misses)
 *   right  Old Ruins   ramp down into a walled corridor: a tunnel to hide in, or its roof to run on
 * Centre: the Great Tree. A trunk to wallrun around, roots for cover, two shrines, branches at
 * y 8 (E/W) and y 14 (N/S) reached by launch pads, and a canopy crown at y 23 for sniping.
 */
function buildWindward(): MapData {
  // ---- One half (spawn on +Z); the other half is this rotated 180°. ----
  const half: Box[] = [
    // Sky Harbor: spawn island (top 12), back wall, and a harbour wall with a doorway per lane.
    span(-20, 11, 88, 20, 12, 108, 'floor'),
    span(-20, 12, 106, 20, 19, 107, 'wall'),
    span(-20, 12, 90.5, -16, 14.2, 91.3, 'wall'),
    span(-10, 12, 90.5, -5, 14.2, 91.3, 'wall'),
    span(5, 12, 90.5, 10, 14.2, 91.3, 'wall'),
    span(16, 12, 90.5, 20, 14.2, 91.3, 'wall'),
    box(-12, 12.6, 100, 1.2, 1.2, 1.2, 'cover'),
    box(11, 12.75, 98, 1.5, 1.5, 1.5, 'cover'),

    // Windway (centre lane): slide ramp -> runway -> bhop stones. The undercliff below catches misses.
    wedge('ramp', -5, 4, 66, 5, 12, 88, { axis: 'z', rise: 1 }), // ~20°
    span(-5, 3, 52, 5, 4, 66, 'floor'), // runway, top 4
    box(1, 2.5, 44, 4, 1, 4, 'floor'), // stone, top 3
    box(-2, 1.5, 38, 4, 1, 4, 'floor'), // stone, top 2
    span(-9, -6, 40, 9, -5, 64, 'floor'), // undercliff, top -5, roofed by the runway: a hiding spot
    wedge('ramp', -6, -5, 26, 6, 0, 40, { axis: 'z', rise: -1 }), // walk up from the undercliff into the centre
    box(-6, -4.25, 58, 1.5, 1.5, 1.5, 'cover'),
    box(5, -4.4, 55, 1.2, 1.2, 1.2, 'cover'),

    // Surf Gorge (left lane): drop-in ledge, two surf A-frames, exit terrace, ramp up to the centre.
    span(-32, 11, 82, -20, 12, 96, 'floor'), // top 12
    ...surfFrame('z', -36, 8, 56, 86, 6),
    ...surfFrame('z', -36, 4, 28, 54, 6),
    span(-42, -3, 14, -28, -2, 28, 'floor'), // exit terrace, top -2
    wedge('ramp', -28, -2, 14, -24, 0, 26, { axis: 'x', rise: 1 }),

    // Old Ruins (right lane): ledge, ramp down into a walled corridor with a roofed tunnel.
    span(20, 8, 84, 34, 9, 98, 'floor'), // ledge, top 9 (a 3m drop from the harbour)
    wedge('ramp', 22, 0, 70, 32, 9, 84, { axis: 'z', rise: 1 }),
    span(22, -1, 40, 32, 0, 70, 'floor'), // corridor floor, top 0
    span(20.8, 0, 40, 22, 13, 76, 'wall'), // corridor walls 10m apart: wallrun either side
    span(32, 0, 40, 33.2, 13, 76, 'wall'),
    span(22, 4.5, 52, 32, 5.2, 64, 'floor'), // tunnel roof: hide under it or run on top
    wedge('ramp', 22, 0, 64, 26, 5.2, 70, { axis: 'z', rise: -1 }), // up onto the roof
    box(25, 2, 46, 1.2, 4, 1.2, 'wall'), // broken colonnade
    box(29, 2, 48, 1.2, 4, 1.2, 'wall'),
    box(29, 2, 43, 1.2, 4, 1.2, 'wall'),
    box(29, 4.3, 45.5, 1.2, 0.6, 6.2, 'cover'), // lintel: an arch to duck under
    span(20, -1, 26, 34, 0, 40, 'floor'), // approach to the centre
    span(24, -1, 14, 34, 0, 26, 'floor'), // ruins terrace beside the island (the watchtower stands on it)
    box(31, 0.75, 31, 1.5, 1.5, 1.5, 'cover'),
    box(32.3, 0.6, 32.4, 1.2, 1.2, 1.2, 'cover'),
    // Ruins watchtower, reached by pad.
    span(26, 9, 22, 32, 10, 28, 'floor'), // top 10
    span(28.4, 0, 24.4, 29.6, 9, 25.6, 'wall'),
    span(26, 10, 22, 32, 11.2, 22.6, 'cover'),
    padTo(24, 0, 36, { x: 29, y: 10, z: 26 }, 2),
  ];

  const halfTriggers: Trigger[] = [
    // Harbour doorways blow you out toward each lane.
    gate(-16, 12, 89.5, -10, 15, 91.3, '-z', 10),
    gate(-5, 12, 89.5, 5, 15, 91.3, '-z', 10),
    gate(10, 12, 89.5, 16, 15, 91.3, '-z', 10),
    // Windway: speed gate at the foot of the slide ramp, and one hanging over the stones.
    gate(-5, 4, 62.5, 5, 8, 64, '-z', 16),
    gate(-5, 3, 41, 5, 9, 42.5, '-z', 18),
    // Undercliff puffball back up onto the first stone.
    puff(0, -5, 49.5, 8.5),
    // Surf Gorge: a gate between the A-frames, and one on the terrace into the ramp.
    gate(-42, -4, 53, -30, 10, 54.5, '-z', 18),
    gate(-32, -2, 15, -30.5, 2, 27, '+x', 12),
  ];

  // ---- Centre: the Great Tree island (point-symmetric: this list + its mirror). ----
  const centreHalf: Box[] = [
    span(3, 0, -0.6, 10, 1.1, 0.6, 'trunk'), // roots: low bark ridges for cover
    span(-0.6, 0, 3, 0.6, 1.1, 10, 'trunk'),
    span(3, 7, -3, 13, 8, 3, 'branch'), // east branch, top 8
    span(-3, 13, 3, 3, 14, 15, 'branch'), // north branch, top 14
    padTo(18, 0, 0, { x: 8, y: 8, z: 0 }, 2), // up to the east branch
    padTo(-5, 0, 20, { x: 0, y: 14, z: 9 }, 3), // up to the north branch
    padTo(0, 14, 13.5, { x: 0, y: 23, z: 3 }, 3), // north branch tip up into the crown
    ...shrine(14, 0, -14, 7, 4),
    ...surfFrame('z', 32, 2, -14, 14, 5), // side combat surf, a short hop off the island's edge
  ];
  const centreTriggers: Trigger[] = [
    puff(6, 0, 6, 6), // beside the trunk: bounce, catch the bark, wallrun around it
    gate(21, 0, -6, 22.5, 4, 6, '+x', 14), // fling off the edge onto the side surf
  ];
  const centre: Box[] = [
    span(-24, -1, -26, 24, 0, 26, 'floor'),
    span(-3, 0, -3, 3, 22, 3, 'trunk'),
    span(-9, 22, -9, 9, 23, 9, 'branch'), // the crown, top 23
    ...centreHalf,
    ...centreHalf.map(mirror),
  ];

  const spawns: SpawnPoint[] = [
    { pos: { x: -14, y: 12.01, z: 100 }, yaw: 0 },
    { pos: { x: -6, y: 12.01, z: 104 }, yaw: 0 },
    { pos: { x: 6, y: 12.01, z: 104 }, yaw: 0 },
    { pos: { x: 14, y: 12.01, z: 100 }, yaw: 0 },
    { pos: { x: -7, y: 12.01, z: 96 }, yaw: 0 },
    { pos: { x: 7, y: 12.01, z: 96 }, yaw: 0 },
  ];

  return {
    name: 'Windward',
    boxes: [...centre, ...half, ...half.map(mirror)],
    triggers: [...centreTriggers, ...centreTriggers.map(mirrorTrigger), ...halfTriggers, ...halfTriggers.map(mirrorTrigger)],
    decor: [{ kind: 'canopy', pos: { x: 0, y: 23, z: 0 }, radius: 13 }],
    spawns: [...spawns, ...spawns.map((s) => ({ pos: flip(s.pos), yaw: s.yaw + Math.PI }))],
    killY: -40,
  };
}

export const MAP = buildWindward();
