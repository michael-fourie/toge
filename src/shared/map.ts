import type { Box, BoxKind } from './collision.ts';
import type { Vec3 } from './math.ts';

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface MapData {
  name: string;
  boxes: Box[];
  spawns: SpawnPoint[];
  killY: number;
}

/** Box from centre + size. */
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, kind: BoxKind, launch?: Vec3): Box {
  return {
    min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
    max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 },
    kind,
    launch,
  };
}

/** A jump pad sitting on a floor whose top is at `floorY`. */
function pad(x: number, floorY: number, z: number, launch: Vec3, size = 2.5): Box {
  return box(x, floorY + 0.1, z, size, 0.2, size, 'pad', launch);
}

/** Rotate 180° about the Y axis so both halves of the map are identical for each side. */
function mirror(b: Box): Box {
  return {
    min: { x: -b.max.x, y: b.min.y, z: -b.max.z },
    max: { x: -b.min.x, y: b.max.y, z: -b.min.z },
    kind: b.kind,
    launch: b.launch && { x: -b.launch.x, y: b.launch.y, z: -b.launch.z },
  };
}

/**
 * "Skyhop": two spawn islands facing each other over a void, linked by a central arena.
 * Each half has a bhop stepping-stone route, a zig-zag wallrun lane over the void,
 * a cannon pad that fires you into the middle, and a sniper tower reached by pad.
 */
function buildSkyhop(): MapData {
  // One half (spawn on +Z). Floors have their top surface at y = 0 unless noted.
  const half: Box[] = [
    // Spawn island + back wall + some cover crates.
    box(0, -0.5, 62, 26, 1, 18, 'floor'),
    box(0, 5, 71.5, 26, 12, 1, 'wall'),
    box(5, 1, 58, 2, 2, 2, 'cover'),
    box(-6, 0.75, 57, 3, 1.5, 1.5, 'cover'),
    box(8, 1.5, 66, 2, 3, 2, 'cover'),

    // Bhop route: stepping stones straight down the middle to the arena.
    box(0, -0.5, 47, 4, 1, 4, 'floor'),
    box(3, -0.5, 40, 4, 1, 4, 'floor'),
    box(-2, -0.5, 33, 4, 1, 4, 'floor'),
    box(2, -0.5, 26, 4, 1, 4, 'floor'),
    box(0, -0.5, 19.5, 4, 1, 3, 'floor'),

    // Wallrun lane (spawn's left): ledge, then zig-zag walls floating over nothing.
    box(-20, -0.5, 58, 14, 1, 8, 'floor'), // west edge flush with the first wall's face
    box(-27.5, 1.5, 46, 1, 15, 16, 'wall'), // run its east face heading -Z...
    box(-20.5, 1.5, 31, 1, 15, 18, 'wall'), // ...wall-jump across to this one's west face...
    box(-27.5, 1.5, 16, 1, 15, 16, 'wall'), // ...and back again.
    box(-20.5, -1.5, 2, 11, 1, 18, 'floor'), // landing ledge, a jumpable 1m step below the arena

    // Floating islands on the right, a staggered bhop path.
    box(20, -0.5, 45, 4, 1, 4, 'floor'),
    box(22, 0, 37, 4, 1, 4, 'floor'),
    box(20, 0.5, 29, 4, 1, 4, 'floor'),
    box(17, 0, 21, 4, 1, 4, 'floor'),

    // Sniper tower: a perch on a thin stalk.
    box(28, 11.5, 20, 8, 1, 8, 'floor'),
    box(28, 4, 20, 2, 14, 2, 'wall'),
    box(28, 13, 23.5, 8, 2, 1, 'cover'),

    // Pads: spawn cannon into the arena, arena pad up to the tower.
    pad(10, 0, 56, { x: 0, y: 17, z: -27 }),
    pad(12, 0, 10, { x: 9.8, y: 24, z: 6.1 }),
  ];

  const centre: Box[] = [
    box(0, -0.5, 0, 30, 1, 30, 'floor'),
    box(7, 3, 7, 2, 6, 2, 'wall'),
    box(-7, 3, 7, 2, 6, 2, 'wall'),
    box(7, 3, -7, 2, 6, 2, 'wall'),
    box(-7, 3, -7, 2, 6, 2, 'wall'),
    box(0, 1, 0, 6, 2, 6, 'cover'),
    box(0, 1.25, 11, 8, 2.5, 1, 'cover'),
    box(0, 1.25, -11, 8, 2.5, 1, 'cover'),
    pad(0, 2, 0, { x: 0, y: 20, z: 0 }, 2), // straight-up "yeet" pad on the centre block
  ];

  const spawns: SpawnPoint[] = [
    { pos: { x: 0, y: 0.01, z: 64 }, yaw: 0 },
    { pos: { x: -7, y: 0.01, z: 66 }, yaw: 0 },
    { pos: { x: 7, y: 0.01, z: 62 }, yaw: 0 },
    { pos: { x: -10, y: 0.01, z: 60 }, yaw: 0.3 },
  ];

  return {
    name: 'Skyhop',
    boxes: [...centre, ...half, ...half.map(mirror)],
    spawns: [...spawns, ...spawns.map((s) => ({ pos: { x: -s.pos.x, y: s.pos.y, z: -s.pos.z }, yaw: s.yaw + Math.PI }))],
    killY: -25,
  };
}

export const MAP = buildSkyhop();
