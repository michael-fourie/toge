// Drift scoring and the in-race bonus money for drifting. Pure and shared: the client keeps the
// drift meter while you drive; the server clamps what a client reports with the same constants and pays it.
//
// A slide scores points every tick: faster and more sideways scores more. Slides strung together (the next one
// starting within `chainGap` of the last ending) form a combo whose multiplier climbs ×0.5 a link, up to ×4.
// A combo banks into your total once you straighten up for `chainGap`; hit a wall, a car or get spun out
// first and the whole combo is lost.

import { type Car, yawOf } from './vehicle.ts';

export const DRIFT = {
  /** Below this (m/s) nothing scores. */
  minSpeed: 10,
  /** Slip angle (rad) that counts as a slide without the drift button. */
  minAngle: 0.2,
  /** Speed (m/s) and slip angle (rad) past which a slide scores no more. */
  maxSpeed: 80,
  maxAngle: 0.7,
  /** Points per metre slid at the base angle factor (big numbers feel good). */
  perMetre: 10,
  /** Seconds after a slide ends that the next one still continues the combo. */
  chainGap: 1.2,
  multStep: 0.5,
  maxMult: 4,
  /** An impact harder than this (m/s) ends the combo with nothing (a light rail scrape doesn't). */
  crash: 5,
  /** Money per drift point (a minute of decent sliding is ~$1,000), and the most drifting can pay per km of race. */
  payPerPoint: 0.05,
  payPerKm: 400,
};

/** The fastest anyone could possibly score (points/s): the server caps a report at this × the race clock. */
export const DRIFT_MAX_RATE = DRIFT.perMetre * DRIFT.maxSpeed * (0.5 + DRIFT.maxAngle) * DRIFT.maxMult;

export interface DriftMeter {
  /** Banked points this race. */
  total: number;
  /** The live combo: raw points and the multiplier they'll bank at. */
  combo: number;
  mult: number;
  /** Seconds since the last slide ended (the combo banks after `chainGap`). */
  gap: number;
  sliding: boolean;
  /** Biggest single combo banked. */
  best: number;
}

export const newDriftMeter = (): DriftMeter => ({ total: 0, combo: 0, mult: 1, gap: 0, sliding: false, best: 0 });

/** The car's slip angle (rad, 0 = going where it points) and its speed over the ground (m/s). */
export function slideOf(car: Car): { angle: number; speed: number; forward: number } {
  const yaw = yawOf(car);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const forward = car.v.x * fx + car.v.z * fz;
  const side = car.v.x * -fz + car.v.z * fx;
  const speed = Math.hypot(car.v.x, car.v.z);
  return { angle: speed > 1 ? Math.atan2(Math.abs(side), Math.max(0.01, forward)) : 0, speed, forward };
}

/** The combo's points as they'd bank right now. */
export const comboPoints = (m: DriftMeter) => Math.round(m.combo * m.mult);

/** Banks the live combo (if any) into the total; returns what it was worth. */
export function bankCombo(m: DriftMeter): number {
  const pts = comboPoints(m);
  m.total += pts;
  m.best = Math.max(m.best, pts);
  m.combo = 0;
  m.mult = 1;
  m.gap = 0;
  m.sliding = false;
  return pts;
}

export type DriftEvent = { kind: 'bank'; points: number } | { kind: 'drop'; points: number } | null;

/** One tick of the meter for `car`. Returns an event when a combo banks or is lost. */
export function stepDrift(m: DriftMeter, car: Car, dt: number): DriftEvent {
  if (m.combo > 0 && (car.hit > DRIFT.crash || car.spin > 0)) {
    const lost = comboPoints(m);
    m.combo = 0;
    m.mult = 1;
    m.gap = 0;
    m.sliding = false;
    return { kind: 'drop', points: lost };
  }
  const grounded = car.wheels.filter((w) => w.contact).length >= 2;
  const { angle, speed, forward } = slideOf(car);
  const sliding = grounded && speed > DRIFT.minSpeed && forward > 0 && (car.drift !== 0 || angle > DRIFT.minAngle);
  if (sliding) {
    if (!m.sliding && m.combo > 0) m.mult = Math.min(DRIFT.maxMult, m.mult + DRIFT.multStep);
    m.sliding = true;
    m.gap = 0;
    m.combo += DRIFT.perMetre * Math.min(speed, DRIFT.maxSpeed) * (0.5 + Math.min(angle, DRIFT.maxAngle)) * dt;
    return null;
  }
  m.sliding = false;
  if (m.combo <= 0) return null;
  m.gap += dt;
  if (m.gap < DRIFT.chainGap) return null;
  return { kind: 'bank', points: bankCombo(m) };
}

/** Caps reported drift points at what the race clock allows. */
export const clampDrift = (points: unknown, seconds: number): number =>
  typeof points === 'number' && Number.isFinite(points) && points > 0 ? Math.floor(Math.min(points, Math.max(0, seconds) * DRIFT_MAX_RATE)) : 0;

/** What a race's drift points pay, for a race of `km`. */
export const driftPay = (points: number, km: number): number => Math.min(Math.round((Math.max(0, points) * DRIFT.payPerPoint) / 10) * 10, Math.round(DRIFT.payPerKm * km));
