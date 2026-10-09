// The Skyline's roof rule, shared so the tests can ride it: the roof (and the yard, if a fast surf flings you off the
// building) is no place to stay. Time on your feet up there adds up; surfing and flying never count. Once it reaches
// SKYLINE.grace the steam vents blow you back down into the Hall (the client moves itself to `lay.vent`). Never lethal.
import { SKYLINE } from './constants.ts';
import type { SurvivalLayout } from './layout.ts';
import type { Vec3 } from './math.ts';

/** Out of the building: up on the roof, or out in the yard. */
export function stranded(p: Vec3, lay: SurvivalLayout): boolean {
  if (p.y >= SKYLINE.roofY) return true;
  const m = 0.5; // the walls between rooms are thinner than this
  return !lay.rooms.some((r) => p.x >= r.x0 - m && p.x <= r.x1 + m && p.z >= r.z0 - m && p.z <= r.z1 + m);
}

/** The roof clock after one tick: it runs while you stand about stranded, holds while you're in the air, and resets indoors. */
export function roofClock(t: number, p: Vec3, onGround: boolean, dt: number, lay: SurvivalLayout): number {
  if (!stranded(p, lay)) return 0;
  return onGround ? t + dt : t;
}
