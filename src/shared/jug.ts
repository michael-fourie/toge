// Juggernog: a Survival perk station that raises your maximum health. Pure rules shared by server and client.
import { SURVIVAL } from './constants.ts';
import type { Vec3 } from './math.ts';
import type { PunchStatus } from './punch.ts';

/** Same four states as the Pack-a-Punch machine: far from it, can't afford it, already own it, or ready to buy. */
export type JugStatus = PunchStatus;

/** Whether a player at `pos` with `points` may buy Juggernog from the station at `station`. */
export function jugStatus(points: number, owned: boolean, pos: Vec3, station: Vec3): JugStatus {
  if (Math.hypot(pos.x - station.x, pos.z - station.z) > SURVIVAL.punchRange || Math.abs(pos.y - station.y) > 3) return 'far';
  if (owned) return 'owned';
  return points >= SURVIVAL.jugPrice ? 'ready' : 'poor';
}

/** A player's maximum health: with or without Juggernog. */
export const maxHp = (jug: boolean) => (jug ? SURVIVAL.jugHp : SURVIVAL.playerHp);
