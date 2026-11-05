import { type Vec3 } from '../../shared/math.ts';
import { PLAYER } from './constants.ts';

export type BoxKind = 'floor' | 'branch' | 'wall' | 'trunk' | 'pad' | 'cover' | 'ramp' | 'surf' | 'hook'
  // The Foundry (Survival): poured gravel yard, brick walls, steel beams and rails, crates, machinery.
  | 'gravel' | 'brick' | 'steel' | 'crate' | 'machine';

/**
 * A wedge: the solid part of its bounding box that lies below a sloped top face.
 * The top rises from min.y at one end of `axis` to max.y at the other (`rise` = +1: higher toward +axis).
 * The high end is a vertical face; the low end has zero height.
 */
export interface RampShape {
  axis: 'x' | 'z';
  rise: 1 | -1;
}

export interface Box {
  min: Vec3;
  max: Vec3;
  kind: BoxKind;
  /** Jump pads: velocity applied when a player stands on the pad. */
  launch?: Vec3;
  /** Present for sloped wedges (kind 'ramp' = walkable slope, 'surf' = steep surf ramp). */
  ramp?: RampShape;
}

/**
 * A non-solid volume that changes your velocity while you're inside it. Both kinds only ever
 * *raise* a velocity component ("set at least"), so they never cost momentum and need no cooldown.
 * - boost (wind gate): speed along the horizontal unit `dir` is raised to `speed`.
 * - bounce (puffball): upward speed is raised to `up`, and horizontal speed *along the way you're
 *   already moving* is raised to `push` (standing still, it throws you straight up).
 */
export type Trigger =
  | { kind: 'boost'; min: Vec3; max: Vec3; dir: Vec3; speed: number }
  | { kind: 'bounce'; min: Vec3; max: Vec3; up: number; push: number };

/** Does the player standing at `p` overlap the volume? */
export function touches(p: Vec3, v: { min: Vec3; max: Vec3 }): boolean {
  const hw = PLAYER.halfWidth;
  return (
    p.x - hw < v.max.x && p.x + hw > v.min.x && p.y < v.max.y && p.y + PLAYER.height > v.min.y && p.z - hw < v.max.z && p.z + hw > v.min.z
  );
}

interface Contacts {
  ground: Box | null;
  /** Normal of the ground contact (up for boxes, the slope normal for walkable ramps). */
  groundNormal: Vec3;
}

export const newContacts = (): Contacts => ({
  ground: null,
  groundNormal: { x: 0, y: 1, z: 0 },
});

/** Source's rule: surfaces with normal.y below this are too steep to stand on (≈45.6°). */
export const WALKABLE_NORMAL_Y = 0.7;

const SKIN = 0.001;

type Axis = 'x' | 'y' | 'z';

function overlapsPlayerAabb(p: Vec3, b: Box, dx = 0, dy = 0, dz = 0): boolean {
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

// ---------------------------------------------------------------------------
// Ramp geometry

/** Unit normal of a ramp's sloped face (points up and out of the slope). */
export function rampNormal(b: Box, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const r = b.ramp!;
  const run = b.max[r.axis] - b.min[r.axis];
  const k = (b.max.y - b.min.y) / run; // rise per metre
  const l = Math.hypot(k, 1);
  out.x = r.axis === 'x' ? (-r.rise * k) / l : 0;
  out.z = r.axis === 'z' ? (-r.rise * k) / l : 0;
  out.y = 1 / l;
  return out;
}

/** Height of the sloped face at coordinate `c` along the ramp axis (clamped to the ramp). */
export function rampHeightAt(b: Box, c: number): number {
  const r = b.ramp!;
  const lo = b.min[r.axis];
  const hi = b.max[r.axis];
  let t = (Math.min(hi, Math.max(lo, c)) - lo) / (hi - lo);
  if (r.rise < 0) t = 1 - t;
  return b.min.y + (b.max.y - b.min.y) * t;
}

/** Highest point of the ramp surface under the player's footprint. */
function rampTopUnder(p: Vec3, b: Box): number {
  const r = b.ramp!;
  const hw = PLAYER.halfWidth;
  return rampHeightAt(b, r.rise > 0 ? p[r.axis] + hw : p[r.axis] - hw);
}

function overlapsPlayer(p: Vec3, b: Box, dx = 0, dy = 0, dz = 0): boolean {
  if (!overlapsPlayerAabb(p, b, dx, dy, dz)) return false;
  if (!b.ramp) return true;
  const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
  return q.y < rampTopUnder(q, b);
}

const isWalkable = (b: Box) => b.kind !== 'surf';
const scratchN: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Push the player out of a ramp along the cheapest direction and clip velocity (Source ClipVelocity,
 * overbounce 1: v -= n * dot(v, n), so tangential speed is kept). Walkable slopes are resolved
 * vertically so standing on them never creeps downhill.
 */
function resolveRamp(pos: Vec3, vel: Vec3, b: Box, out: Contacts) {
  const r = b.ramp!;
  const hw = PLAYER.halfWidth;
  const n = rampNormal(b, scratchN);
  const top = rampTopUnder(pos, b);
  const gap = top - pos.y; // how far the feet are below the slope (vertical)
  if (gap <= 0) return;

  // Candidate pushes; pick the shallowest.
  const slopeDepth = isWalkable(b) ? gap : gap * n.y; // distance along the push direction
  const bottom = pos.y + PLAYER.height - b.min.y; // push down out of the base
  const backCoord = r.rise > 0 ? b.max[r.axis] : b.min[r.axis];
  const back = r.rise > 0 ? backCoord - (pos[r.axis] - hw) : pos[r.axis] + hw - backCoord; // out of the tall end
  const cross: Axis = r.axis === 'x' ? 'z' : 'x';
  const sideLo = pos[cross] + hw - b.min[cross];
  const sideHi = b.max[cross] - (pos[cross] - hw);

  const best = Math.min(slopeDepth, bottom, back, sideLo, sideHi);
  if (best === slopeDepth) {
    if (isWalkable(b)) {
      pos.y = top + SKIN;
    } else {
      pos.x += n.x * (slopeDepth + SKIN);
      pos.y += n.y * (slopeDepth + SKIN);
      pos.z += n.z * (slopeDepth + SKIN);
    }
    const into = vel.x * n.x + vel.y * n.y + vel.z * n.z;
    if (into < 0) {
      vel.x -= n.x * into;
      vel.y -= n.y * into;
      vel.z -= n.z * into;
    }
    if (n.y >= WALKABLE_NORMAL_Y) {
      out.ground = b;
      out.groundNormal.x = n.x;
      out.groundNormal.y = n.y;
      out.groundNormal.z = n.z;
    }
  } else if (best === bottom) {
    pos.y -= bottom + SKIN;
    if (vel.y > 0) vel.y = 0;
  } else if (best === back) {
    pos[r.axis] += r.rise * (back + SKIN);
    if (vel[r.axis] * r.rise < 0) vel[r.axis] = 0;
  } else {
    const dir = best === sideLo ? -1 : 1;
    pos[cross] += dir * (best + SKIN);
    if (vel[cross] * dir < 0) vel[cross] = 0;
  }
}

// ---------------------------------------------------------------------------
// Movement

/** Moves along one axis and pushes the player back out of any box it entered. Returns the box hit, if any. */
function sweepAxis(pos: Vec3, axis: Axis, delta: number, boxes: readonly Box[]): Box | null {
  if (delta === 0) return null;
  pos[axis] += delta;
  let hit: Box | null = null;
  // Offsets from pos to the player's min/max on this axis.
  const lo = axis === 'y' ? 0 : -PLAYER.halfWidth;
  const hi = axis === 'y' ? PLAYER.height : PLAYER.halfWidth;
  for (const b of boxes) {
    if (b.ramp || !overlapsPlayerAabb(pos, b)) continue;
    pos[axis] = delta > 0 ? b.min[axis] - hi - SKIN : b.max[axis] - lo + SKIN;
    hit = b;
  }
  return hit;
}

const MAX_STEP = 0.25; // metres per sub-move; smaller than the thinnest wall so we never tunnel

/**
 * Move-and-slide. Boxes use axis-separated sweeps; ramps are resolved by penetration along
 * their cheapest face after each sub-step. Mutates pos and vel.
 */
export function moveAndCollide(pos: Vec3, vel: Vec3, dt: number, boxes: readonly Box[], out: Contacts): Contacts {
  out.ground = null;
  out.groundNormal.x = 0;
  out.groundNormal.y = 1;
  out.groundNormal.z = 0;

  const dist = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
  const h = dt / steps;

  for (let i = 0; i < steps; i++) {
    const by = sweepAxis(pos, 'y', vel.y * h, boxes);
    if (by) {
      if (vel.y < 0) {
        out.ground = by;
        out.groundNormal.x = 0;
        out.groundNormal.y = 1;
        out.groundNormal.z = 0;
      }
      vel.y = 0;
    }
    if (sweepAxis(pos, 'x', vel.x * h, boxes)) vel.x = 0;
    if (sweepAxis(pos, 'z', vel.z * h, boxes)) vel.z = 0;
    for (const b of boxes) {
      if (b.ramp && overlapsPlayer(pos, b)) resolveRamp(pos, vel, b, out);
    }
  }
  return out;
}

/** The walkable surface directly beneath the player's feet, if standing on one. Writes its normal. */
export function probeGround(pos: Vec3, boxes: readonly Box[], normal?: Vec3): Box | null {
  for (const b of boxes) {
    if (b.ramp) {
      if (!isWalkable(b) || !overlapsPlayerAabb(pos, b, 0, -0.05, 0)) continue;
      const top = rampTopUnder(pos, b);
      if (pos.y - top > 0.04 || pos.y - top < -0.02) continue;
      if (normal) rampNormal(b, normal);
      return b;
    }
    if (overlapsPlayerAabb(pos, b, 0, -0.03, 0)) {
      if (normal) {
        normal.x = 0;
        normal.y = 1;
        normal.z = 0;
      }
      return b;
    }
  }
  return null;
}

/**
 * Source's StayOnGround: when walking off a slope or a small step, snap down onto walkable
 * ground within `maxDrop` so you stick to ramps instead of skipping down them.
 */
export function snapToGround(pos: Vec3, boxes: readonly Box[], maxDrop: number, normal?: Vec3): Box | null {
  let best: Box | null = null;
  let bestTop = -Infinity;
  const hw = PLAYER.halfWidth;
  for (const b of boxes) {
    if (b.ramp && !isWalkable(b)) continue;
    if (pos.x - hw >= b.max.x || pos.x + hw <= b.min.x || pos.z - hw >= b.max.z || pos.z + hw <= b.min.z) continue;
    const top = b.ramp ? rampTopUnder(pos, b) : b.max.y;
    if (top > pos.y + 0.01 || top < pos.y - maxDrop || top <= bestTop) continue;
    best = b;
    bestTop = top;
  }
  if (!best) return null;
  // Don't snap through something solid between here and there (e.g. a ceiling we'd clip into is fine; a box is not).
  const target = { x: pos.x, y: bestTop + SKIN, z: pos.z };
  for (const b of boxes) if (b !== best && overlapsPlayer(target, b)) return null;
  pos.y = target.y;
  if (normal) {
    if (best.ramp) rampNormal(best, normal);
    else {
      normal.x = 0;
      normal.y = 1;
      normal.z = 0;
    }
  }
  return best;
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
 * Only boxes that cover the player's torso count, so ledges and floor lips don't. Ramps never count.
 * When several walls touch, `prefer` (e.g. horizontal velocity) picks the one we're moving into.
 */
export function probeWall(pos: Vec3, boxes: readonly Box[], prefer?: Vec3, reach = WALL_PROBE): Vec3 | null {
  let best: Vec3 | null = null;
  let bestScore = Infinity;
  for (const n of WALL_NORMALS) {
    const dx = -n.x * reach;
    const dz = -n.z * reach;
    for (const b of boxes) {
      if (b.ramp) continue;
      if (b.max.y < pos.y + 1.2 || b.min.y > pos.y + 0.6) continue;
      if (!overlapsPlayerAabb(pos, b, dx, 0, dz)) continue;
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

/** Slab test returning [tEnter, tExit], or null on miss. */
function raySlab(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxDist: number): [number, number] | null {
  let tmin = 0;
  let tmax = maxDist;
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (min[a] - o[a]) * inv;
    let t2 = (max[a] - o[a]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return [tmin, tmax];
}

/** Slab test. Returns distance along the (normalized) ray, or -1 on miss. */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxDist: number): number {
  const s = raySlab(o, d, min, max, maxDist);
  return s ? s[0] : -1;
}

/** Ray vs wedge: its bounding box intersected with the half-space under the slope. */
function rayRamp(o: Vec3, d: Vec3, b: Box, maxDist: number): number {
  const s = raySlab(o, d, b.min, b.max, maxDist);
  if (!s) return -1;
  let [t0, t1] = s;
  const n = rampNormal(b, scratchN);
  // A point on the slope: the low edge.
  const r = b.ramp!;
  const p0 = { x: b.min.x, y: b.min.y, z: b.min.z };
  if (r.rise < 0) p0[r.axis] = b.max[r.axis];
  const dist0 = n.x * (o.x - p0.x) + n.y * (o.y - p0.y) + n.z * (o.z - p0.z); // >0 above the slope
  const denom = n.x * d.x + n.y * d.y + n.z * d.z;
  if (Math.abs(denom) < 1e-9) {
    if (dist0 > 0) return -1;
  } else {
    const tp = -dist0 / denom;
    if (denom < 0) t0 = Math.max(t0, tp);
    else t1 = Math.min(t1, tp);
  }
  return t0 <= t1 ? t0 : -1;
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
    const t = b.ramp ? rayRamp(o, d, b, best) : rayBox(o, d, b.min, b.max, best);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}
