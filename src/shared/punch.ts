// Survival points and the Pack-a-Punch machine: pure rules shared by server and client.
import { SURVIVAL, WEAPON, WEAPON_PUNCHED } from './constants.ts';
import type { Vec3 } from './math.ts';

/** Points for a zombie kill. */
export const killPoints = (headshot: boolean) => (headshot ? SURVIVAL.headPoints : SURVIVAL.bodyPoints);

export type PunchStatus = 'ready' | 'poor' | 'owned' | 'far';

/** Whether a player at `pos` with `points` may buy the upgrade from a machine at `machine`. */
export function punchStatus(points: number, upgraded: boolean, pos: Vec3, machine: Vec3): PunchStatus {
  if (Math.hypot(pos.x - machine.x, pos.z - machine.z) > SURVIVAL.punchRange || Math.abs(pos.y - machine.y) > 3) return 'far';
  if (upgraded) return 'owned';
  return points >= SURVIVAL.punchPrice ? 'ready' : 'poor';
}

/** The rifle's timings and mag for a player: the stock AWP or the punched one. */
export function weaponStats(upgraded: boolean) {
  return upgraded ? { ...WEAPON, ...WEAPON_PUNCHED } : WEAPON;
}

export const bodyDamage = (upgraded: boolean) => SURVIVAL.bodyDamage * (upgraded ? SURVIVAL.punchDamageMult : 1);
export const headDamage = (upgraded: boolean) => SURVIVAL.headDamage * (upgraded ? SURVIVAL.punchDamageMult : 1);

/**
 * Zombies a punched shot passes through: those within `punchPierceRadius` of the shot line, beyond the
 * point where it hit the first one (`to`) and within `punchPierceRange` of it. Aim point is chest height.
 */
export function pierced(from: Vec3, to: Vec3, zombies: readonly { id: number; pos: Vec3 }[], skip: number): number[] {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  if (l < 1e-6) return [];
  d.x /= l;
  d.y /= l;
  d.z /= l;
  const out: number[] = [];
  for (const z of zombies) {
    if (z.id === skip) continue;
    const v = { x: z.pos.x - to.x, y: z.pos.y + 1 - to.y, z: z.pos.z - to.z };
    const t = v.x * d.x + v.y * d.y + v.z * d.z; // distance along the line past the first hit
    if (t < 0 || t > SURVIVAL.punchPierceRange) continue;
    if (Math.hypot(v.x - d.x * t, v.y - d.y * t, v.z - d.z * t) <= SURVIVAL.punchPierceRadius) out.push(z.id);
  }
  return out;
}
