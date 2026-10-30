// AI drivers for solo races (and the test that drives every car down every track). They use the same
// car physics as you: they only choose pedals and steering.
//
// Steering is pure pursuit toward a point ahead on a line that leans to the inside of the coming bend.
// Speed comes from looking down the road: the tightest bend in braking range sets the most the car can be
// doing now and still slow down in time (v² = v_corner² + 2·a·d).

import { type Car, type DriveInput, forwardSpeed, resetCar, speedOf } from './vehicle.ts';
import { SAMPLE, type Track, pointAt } from './track.ts';

const G = 9.81;
/** Share of the tyres' peak grip that's usable mid-corner once load transfer is counted. */
const USABLE = 0.86;

export interface Ai {
  /** 0.8 (gentle) .. 1 (on the limit): how much of the tyres' grip it dares to use. */
  skill: number;
  /** Preferred offset from the line (m), so a pack spreads across the road. */
  lane: number;
  stuck: number;
  wrongWay: number;
}

export const newAi = (skill: number, lane: number): Ai => ({ skill, lane, stuck: 0, wrongWay: 0 });

function curvAt(t: Track, s: number): number {
  const i = Math.max(0, Math.min(t.n - 1, Math.round(s / SAMPLE)));
  return t.curv[i];
}

/** The fastest the car can be going right now and still make every bend in braking range. */
export function targetSpeed(car: Car, t: Track, skill: number): number {
  const sp = car.spec;
  const v = Math.max(5, forwardSpeed(car));
  // Load transfer costs some of the tyres' grip (USABLE); downforce adds some back at speed, roughly.
  const mu = sp.grip * skill * USABLE * (1 + Math.min(0.25, (sp.clA * 0.5 * 1.2 * 900) / (sp.mass * G)));
  // Braking downhill: gravity pushes along the road, so the brakes have less to give.
  const i = Math.max(0, Math.min(t.n - 30, car.hint));
  const grade = Math.max(0, (t.y[i] - t.y[i + 25]) / (25 * SAMPLE));
  const decel = mu * G * 0.75 - G * grade;
  const reach = (v * v) / (2 * decel) + 40;
  let best = Infinity;
  for (let d = 0; d <= reach; d += 4) {
    const k = Math.abs(curvAt(t, car.s + d));
    if (k < 1e-4) continue;
    const vc = Math.sqrt((mu * G) / k);
    const allowed = Math.sqrt(vc * vc + 2 * decel * Math.max(0, d - 8));
    if (allowed < best) best = allowed;
  }
  return best;
}

/** Fills `out` with the AI's controls for this tick (and resets the car if it's hopelessly stuck). */
export function aiDrive(car: Car, t: Track, ai: Ai, dt: number, out: DriveInput): DriveInput {
  const sp = car.spec;
  const v = forwardSpeed(car);
  const ld = Math.max(9, Math.min(42, 6 + v * 0.55));
  const ahead = car.s + ld;
  const lean = Math.max(-(t.half - 1.4), Math.min(t.half - 1.4, curvAt(t, ahead + 10) * 240));
  const off = Math.max(-(t.half - 1.2), Math.min(t.half - 1.2, ai.lane + lean));
  const target = pointAt(t, ahead, off);

  // Car frame from its quaternion: forward = q·(0,0,-1), right = q·(1,0,0) (xz only).
  const q = car.q;
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const rz = 2 * (q.x * q.z - q.w * q.y);
  const dx = target.x - car.p.x;
  const dz = target.z - car.p.z;
  const alpha = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  const wheelbase = sp.axleF + sp.axleR;
  const delta = Math.atan((2 * wheelbase * Math.sin(alpha)) / ld);
  const speed = speedOf(car);
  const lim = sp.steer / (1 + (speed / 24) ** 2);
  out.steer = Math.max(-1, Math.min(1, delta / lim));

  const want = targetSpeed(car, t, ai.skill);
  const err = want - v;
  out.handbrake = 0;
  if (err > 0) {
    out.throttle = Math.min(1, 0.35 + err * 0.4);
    out.brake = 0;
  } else if (err < -1.5) {
    out.throttle = 0;
    out.brake = Math.min(1, -err * 0.22);
  } else {
    out.throttle = 0.25;
    out.brake = 0;
  }
  if (car.s > t.finishS) {
    out.throttle = 0;
    out.brake = 0.4;
  }

  // Recover: stuck against something, or facing back up the road.
  const tangentDot = fx * t.tx[car.hint] + fz * t.tz[car.hint];
  ai.stuck = v < 1.5 && out.throttle > 0.3 && car.s < t.finishS ? ai.stuck + dt : 0;
  ai.wrongWay = tangentDot < -0.2 ? ai.wrongWay + dt : 0;
  if (ai.stuck > 3 || ai.wrongWay > 2.5) {
    resetCar(car, t, car.s - 10, ai.lane);
    ai.stuck = 0;
    ai.wrongWay = 0;
  }
  return out;
}
