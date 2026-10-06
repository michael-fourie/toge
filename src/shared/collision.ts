import { type Vec3 } from './math.ts';
import { PLAYER } from './constants.ts';

export type BoxKind = 'floor' | 'wall' | 'pad' | 'cover';

export interface Box {
  min: Vec3;
  max: Vec3;
  kind: BoxKind;
  /** Jump pads: velocity applied when a player stands on the pad. */
  launch?: Vec3;
}

export interface Contacts {
  ground: Box | null;
  ceiling: boolean;
  /** Horizontal axes we collided on this move (velocity was clipped). */
  hitX: boolean;
  hitZ: boolean;
}

const SKIN = 0.001;

type Axis = 'x' | 'y' | 'z';

function overlapsPlayer(p: Vec3, b: Box, dx = 0, dy = 0, dz = 0): boolean {
  const hw = PLAYER.halfWidth;
  return (
    p.x - hw + dx < b.max.x &&
    p.x + hw + dx > b.min.x &&
    p.y + dy < b.max.y &&
    p.y + PLAYER.height + dy > b.min.y &&
    p.z - hw + dz < b.max.z &&
    p.z + hw + dz > b.min.z
  );
}

/** Moves along one axis and pushes the player back out of anything it entered. Returns the box hit, if any. */
function sweepAxis(pos: Vec3, axis: Axis, delta: number, boxes: readonly Box[]): Box | null {
  if (delta === 0) return null;
  pos[axis] += delta;
  let hit: Box | null = null;
  // Offsets from pos to the player's min/max on this axis.
  const lo = axis === 'y' ? 0 : -PLAYER.halfWidth;
  const hi = axis === 'y' ? PLAYER.height : PLAYER.halfWidth;
  for (const b of boxes) {
    if (!overlapsPlayer(pos, b)) continue;
    pos[axis] = delta > 0 ? b.min[axis] - hi - SKIN : b.max[axis] - lo + SKIN;
    hit = b;
  }
  return hit;
}

const MAX_STEP = 0.25; // metres per sub-move; smaller than the thinnest wall so we never tunnel

/**
 * Axis-separated move-and-slide against axis-aligned boxes. Mutates pos and vel
 * (velocity components into a surface are zeroed).
 */
export function moveAndCollide(pos: Vec3, vel: Vec3, dt: number, boxes: readonly Box[], out: Contacts): Contacts {
  out.ground = null;
  out.ceiling = false;
  out.hitX = false;
  out.hitZ = false;

  const dist = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    const by = sweepAxis(pos, 'y', vel.y * h, boxes);
    if (by) {
      if (vel.y < 0) out.ground = by;
      else out.ceiling = true;
      vel.y = 0;
    }
    if (sweepAxis(pos, 'x', vel.x * h, boxes)) {
      out.hitX = true;
      vel.x = 0;
    }
    if (sweepAxis(pos, 'z', vel.z * h, boxes)) {
      out.hitZ = true;
      vel.z = 0;
    }
  }
  return out;
}

/** The box directly beneath the player's feet, if standing on one. */
export function probeGround(pos: Vec3, boxes: readonly Box[]): Box | null {
  for (const b of boxes) if (overlapsPlayer(pos, b, 0, -0.03, 0)) return b;
  return null;
}

const WALL_PROBE = 0.08;
const WALL_NORMALS: readonly Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/**
 * Finds a wall adjacent to the player. Returns its outward normal (pointing toward the player).
 * Only boxes that cover the player's torso count, so ledges and floor lips don't.
 * When several walls touch, `prefer` (e.g. horizontal velocity) picks the one we're moving into.
 */
export function probeWall(pos: Vec3, boxes: readonly Box[], prefer?: Vec3, reach = WALL_PROBE): Vec3 | null {
  let best: Vec3 | null = null;
  let bestScore = Infinity;
  for (const n of WALL_NORMALS) {
    const dx = -n.x * reach;
    const dz = -n.z * reach;
    for (const b of boxes) {
      if (b.max.y < pos.y + 1.2 || b.min.y > pos.y + 0.6) continue;
      if (!overlapsPlayer(pos, b, dx, 0, dz)) continue;
      const score = prefer ? prefer.x * n.x + prefer.z * n.z : 0;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ray casts (hitscan)

/** Slab test. Returns distance along the (normalized) ray, or -1 on miss. */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxDist: number): number {
  let tmin = 0;
  let tmax = maxDist;
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return -1;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (min[a] - o[a]) * inv;
    let t2 = (max[a] - o[a]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number, maxDist: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxDist ? t : -1;
}

export function rayWorld(o: Vec3, d: Vec3, boxes: readonly Box[], maxDist: number): number {
  let best = maxDist;
  for (const b of boxes) {
    const t = rayBox(o, d, b.min, b.max, best);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}
