import { type Box, rayWorld } from './collision.ts';
import { PLAYER } from './constants.ts';
import type { Vec3 } from './math.ts';
import type { SpawnPoint } from './map.ts';

/** Spawns closer than this to a living player are only used when nothing else is available. */
export const SAFE_DISTANCE = 30;
/** Beyond this a clear line of sight no longer counts as "being watched". */
export const WATCH_RANGE = 90;
/** How many recent spawns are remembered, so the same spot isn't reused back to back. */
export const RECENT_SPAWNS = 8;

const eye = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + PLAYER.eyeHeight, z: p.z });

/** True if a living enemy within WATCH_RANGE has a clear line to this spawn (they would see you appear). */
function watched(spot: Vec3, enemies: readonly Vec3[], boxes: readonly Box[]): boolean {
  const from = eye(spot);
  for (const e of enemies) {
    const to = eye(e);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > WATCH_RANGE) continue;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    if (rayWorld(from, dir, boxes, dist) >= dist - 0.5) return true;
  }
  return false;
}

/**
 * Picks a spawn for a player entering the match. Spawns are spread over the whole map, and the choice is
 * random among the *good* ones so it can't be predicted or camped: far from every living enemy, not in
 * anyone's line of sight, and not used a moment ago. If nothing qualifies, the requirements relax in order
 * (keeping distance and cover over freshness) and finally fall back to the spot farthest from everyone.
 * Returns an index into `spawns`.
 */
export function pickSpawn(
  spawns: readonly SpawnPoint[],
  enemies: readonly Vec3[],
  recent: readonly number[],
  boxes: readonly Box[],
  rand: () => number = Math.random,
): number {
  const info = spawns.map((s, i) => {
    let nearest = Infinity;
    for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.x - s.pos.x, e.y - s.pos.y, e.z - s.pos.z));
    return { i, nearest, far: nearest >= SAFE_DISTANCE, hidden: !watched(s.pos, enemies, boxes), fresh: !recent.includes(i) };
  });
  const tiers: ((c: (typeof info)[number]) => boolean)[] = [
    (c) => c.far && c.hidden && c.fresh,
    (c) => c.far && c.hidden,
    (c) => c.hidden && c.fresh,
    (c) => c.far && c.fresh,
    (c) => c.hidden,
    (c) => c.far,
  ];
  for (const ok of tiers) {
    const pool = info.filter(ok);
    if (pool.length) return pool[Math.floor(rand() * pool.length)].i;
  }
  return info.reduce((a, c) => (c.nearest > a.nearest ? c : a)).i;
}
