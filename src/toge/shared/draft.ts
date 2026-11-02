// Slipstreaming (drafting). Tuck in close behind another car at speed and its wake cuts your drag and
// pulls you along; stay in it long enough to charge a slingshot, then pull out and the stored speed fires
// as a short boost. Pure geometry on positions and velocities, so it works the same against AI rivals and
// the poses of online racers, and needs nothing on the wire: everyone drafts on their own screen.

import type { Car } from './vehicle.ts';

export const DRAFT = {
  /** The wake reaches this far behind a car (m); right up against its bumper (`near`) it's at full strength. */
  range: 30,
  near: 3,
  /** Half-width of the wake just behind the car (m), widening by `spread` per metre further back. */
  width: 1.5,
  spread: 0.025,
  /** Below this speed (m/s, ~65 km/h) there's no wake worth having, for you or the car ahead. */
  minSpeed: 18,
  /** At full strength: the share of your aero drag the wake takes away, and a pull toward the car ahead (m/s^2, on the throttle). */
  dragCut: 0.6,
  pull: 1.8,
  /** How fast the felt strength follows the wake (per second): it builds up, and lets go a little quicker. */
  rise: 2.5,
  fall: 4,
  /** Seconds tucked in (at strength > `tucked`) to charge the slingshot, and the boost it pays when you pull out. */
  tucked: 0.35,
  charge: 1.2,
  /** Once charged, how long after leaving the wake the slingshot still fires (s): pulling out takes a moment. */
  armed: 0.8,
  slingSeconds: 0.9,
  slingAccel: 7,
};

/** What drafting needs of a car: where it is and how it's moving. A Car, or the pose of an online racer. */
export interface Body {
  p: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
}

/**
 * How strongly `me` sits in `other`'s wake, 0-1: `other` has to be ahead along the way you're going,
 * moving the same way at speed, and within the wake's cone. Height is ignored (the road takes care of it).
 */
export function wakeOf(me: Body, other: Body): number {
  const speed = Math.hypot(me.v.x, me.v.z);
  if (speed < DRAFT.minSpeed) return 0;
  const dx = me.v.x / speed;
  const dz = me.v.z / speed;
  // The car ahead must be going our way, and fast enough to punch a hole in the air.
  if (other.v.x * dx + other.v.z * dz < DRAFT.minSpeed) return 0;
  const rx = other.p.x - me.p.x;
  const rz = other.p.z - me.p.z;
  if (Math.abs(other.p.y - me.p.y) > 4) return 0;
  const along = rx * dx + rz * dz;
  if (along <= 0 || along > DRAFT.range) return 0;
  const lat = Math.abs(rx * dz - rz * dx);
  const half = DRAFT.width + DRAFT.spread * along;
  if (lat >= half) return 0;
  const reach = along <= DRAFT.near ? 1 : 1 - (along - DRAFT.near) / (DRAFT.range - DRAFT.near);
  return Math.sqrt(reach) * (1 - (lat / half) ** 2);
}

/** The strongest wake among `others` (skipping `me` if it's in the list). */
export function strongestWake(me: Body, others: Iterable<Body>): number {
  let best = 0;
  for (const o of others) if (o !== me) best = Math.max(best, wakeOf(me, o));
  return best;
}

/**
 * One tick of drafting for `car`, given the raw wake it's in (`strongestWake`) and how much throttle it has
 * on. Eases `car.draft` toward the wake (the physics reads it), charges the slingshot while tucked in, and
 * fires it on the way out. Returns true on the tick the slingshot fires.
 */
export function stepDraft(car: Car, wake: number, throttle: number, dt: number): boolean {
  const rate = wake > car.draft ? DRAFT.rise : DRAFT.fall;
  car.draft += (wake - car.draft) * Math.min(1, rate * dt);
  if (car.draft < 0.01 && wake === 0) car.draft = 0;
  if (wake > DRAFT.tucked) {
    car.draftCharge = Math.min(DRAFT.charge, car.draftCharge + dt);
    if (car.draftCharge >= DRAFT.charge) car.draftArmed = DRAFT.armed;
    return false;
  }
  // Out of the wake (pulled out to pass, or the car ahead got away). Charged, and still on the gas: slingshot.
  car.draftCharge = Math.max(0, car.draftCharge - dt * 2);
  car.draftArmed = Math.max(0, car.draftArmed - dt);
  if (car.draftArmed > 0 && wake === 0 && throttle > 0.5 && car.spin <= 0) {
    car.draftArmed = 0;
    car.draftCharge = 0;
    car.boostPower = car.boost > 0 ? Math.max(car.boostPower, DRAFT.slingAccel) : DRAFT.slingAccel;
    car.boost = Math.max(car.boost, DRAFT.slingSeconds);
    return true;
  }
  return false;
}
