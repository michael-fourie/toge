import { type Box, rampHeightAt, rampNormal, rayWorld } from './collision.ts';
import { GRENADE, MOVE } from './constants.ts';
import type { Vec3 } from './math.ts';

export interface Grenade {
  pos: Vec3;
  vel: Vec3;
  /** Seconds since it left the hand. */
  age: number;
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};

/** Outward normal of whatever surface point `p` is touching (ramp slope if on one, else the nearest box face). */
export function surfaceNormal(p: Vec3, boxes: readonly Box[]): Vec3 {
  const eps = 0.12;
  let best: { d: number; n: Vec3 } | null = null;
  for (const b of boxes) {
    if (p.x < b.min.x - eps || p.x > b.max.x + eps || p.y < b.min.y - eps || p.y > b.max.y + eps || p.z < b.min.z - eps || p.z > b.max.z + eps) continue;
    if (b.ramp) {
      const d = Math.abs(p.y - rampHeightAt(b, b.ramp.axis === 'x' ? p.x : p.z));
      if (d < eps && (!best || d < best.d)) best = { d, n: rampNormal(b) };
    }
    const faces: [number, Vec3][] = [
      [Math.abs(p.x - b.min.x), { x: -1, y: 0, z: 0 }],
      [Math.abs(p.x - b.max.x), { x: 1, y: 0, z: 0 }],
      [Math.abs(p.y - b.min.y), { x: 0, y: -1, z: 0 }],
      [Math.abs(p.y - b.max.y), { x: 0, y: 1, z: 0 }],
      [Math.abs(p.z - b.min.z), { x: 0, y: 0, z: -1 }],
      [Math.abs(p.z - b.max.z), { x: 0, y: 0, z: 1 }],
    ];
    for (const [d, n] of faces) if (d < eps && (!best || d < best.d)) best = { d, n };
  }
  return best ? best.n : { x: 0, y: 1, z: 0 };
}

/** Advances a grenade one step: gravity, then a swept move that bounces off whatever it hits. */
export function stepGrenade(g: Grenade, dt: number, boxes: readonly Box[]) {
  g.age += dt;
  g.vel.y -= MOVE.gravity * dt;
  const dx = g.vel.x * dt;
  const dy = g.vel.y * dt;
  const dz = g.vel.z * dt;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-9) return;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const reach = dist + GRENADE.size;
  const t = rayWorld(g.pos, dir, boxes, reach);
  if (t >= reach) {
    g.pos.x += dx;
    g.pos.y += dy;
    g.pos.z += dz;
    return;
  }
  const hit = { x: g.pos.x + dir.x * t, y: g.pos.y + dir.y * t, z: g.pos.z + dir.z * t };
  const n = surfaceNormal(hit, boxes);
  // Rest just off the surface, then reflect with some energy loss.
  g.pos.x = hit.x + n.x * GRENADE.size * 1.05;
  g.pos.y = hit.y + n.y * GRENADE.size * 1.05;
  g.pos.z = hit.z + n.z * GRENADE.size * 1.05;
  const vn = g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z;
  if (vn < 0) {
    const restitution = -vn < 2 ? 0 : GRENADE.bounce; // too slow to bounce: it settles
    g.vel.x -= (1 + restitution) * vn * n.x;
    g.vel.y -= (1 + restitution) * vn * n.y;
    g.vel.z -= (1 + restitution) * vn * n.z;
  }
  const keep = 1 - GRENADE.friction;
  const tx = g.vel.x - n.x * (g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z);
  const ty = g.vel.y - n.y * (g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z);
  const tz = g.vel.z - n.z * (g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z);
  const vn2 = g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z;
  g.vel.x = n.x * vn2 + tx * keep;
  g.vel.y = n.y * vn2 + ty * keep;
  g.vel.z = n.z * vn2 + tz * keep;
}

/** Launch velocity for a throw: along the look direction (lifted a little), plus the thrower's own velocity. */
export function throwVelocity(yaw: number, pitch: number, thrower: Vec3): Vec3 {
  const p = pitch + GRENADE.throwLift;
  const cp = Math.cos(p);
  return {
    x: -Math.sin(yaw) * cp * GRENADE.throwSpeed + thrower.x * GRENADE.inherit,
    y: Math.sin(p) * GRENADE.throwSpeed + thrower.y * GRENADE.inherit,
    z: -Math.cos(yaw) * cp * GRENADE.throwSpeed + thrower.z * GRENADE.inherit,
  };
}

export interface BlastTarget {
  id: number;
  /** Feet position; the chest (1 m up) is what the blast has to reach. */
  pos: Vec3;
}

const chest = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + 1, z: p.z });

/** True if nothing solid is between the blast and the point. */
export function exposed(center: Vec3, to: Vec3, boxes: readonly Box[]): boolean {
  const dx = to.x - center.x;
  const dy = to.y - center.y;
  const dz = to.z - center.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.05) return true;
  return rayWorld(center, { x: dx / d, y: dy / d, z: dz / d }, boxes, d) >= d - 0.15;
}

/** Ids of the targets the blast kills: inside the lethal radius and in line of sight (walls shield you). */
export function blastTargets(center: Vec3, targets: readonly BlastTarget[], boxes: readonly Box[], radius: number = GRENADE.radius): number[] {
  const out: number[] = [];
  for (const t of targets) {
    const c = chest(t.pos);
    if (Math.hypot(c.x - center.x, c.y - center.y, c.z - center.z) <= radius && exposed(center, c, boxes)) out.push(t.id);
  }
  return out;
}

/**
 * The shove a blast gives someone standing at `pos`: away from the center, stronger when closer, shielded by walls.
 * Applied additively (see applyKnock), so a blast can throw you but never costs you speed.
 */
export function blastKnock(center: Vec3, pos: Vec3, boxes: readonly Box[]): { dir: Vec3; speed: number } | null {
  const c = chest(pos);
  const d = Math.hypot(c.x - center.x, c.y - center.y, c.z - center.z);
  if (d > GRENADE.knockRadius || !exposed(center, c, boxes)) return null;
  const dir = unit(c.x - center.x, c.y - center.y + GRENADE.knockLift * Math.max(d, 1), c.z - center.z);
  return { dir, speed: GRENADE.knock * (1 - d / GRENADE.knockRadius) };
}

/**
 * Adds the shove to `vel`. If that would leave you slower (you ran into the blast), your speed is kept and only
 * its direction changes: a blast throws you, it never eats momentum.
 */
export function applyKnock(vel: Vec3, k: { dir: Vec3; speed: number }) {
  const before = Math.hypot(vel.x, vel.y, vel.z);
  vel.x += k.dir.x * k.speed;
  vel.y += k.dir.y * k.speed;
  vel.z += k.dir.z * k.speed;
  const after = Math.hypot(vel.x, vel.y, vel.z);
  if (after < before && after > 1e-9) {
    const scale = before / after;
    vel.x *= scale;
    vel.y *= scale;
    vel.z *= scale;
  }
}
