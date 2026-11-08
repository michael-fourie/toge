// AI drivers for solo races (and the test that drives every car down every track). They use the same
// car physics as you: they only choose pedals and steering.
//
// Steering is pure pursuit toward a point ahead on a line that leans to the inside of the coming bend.
// Speed comes from looking down the road: the tightest bend in braking range sets the most the car can be
// doing now and still slow down in time (v² = v_corner² + 2·a·d).

import { ARCADE, type Car, DEFAULT_ASSISTS, type DriveInput, arcadeMaxYaw, forwardSpeed, resetCar, speedOf, steerLimit } from './vehicle.ts';
import { SAMPLE, type Track, pointAt } from './track.ts';
import { firstPropFrom, isSolid } from './props.ts';
import { type Obstacle, lanesOf } from './traffic.ts';

const G = 9.81;
/** Share of the tyres' peak grip that's usable mid-corner once load transfer is counted. */
const USABLE = 0.86;
const GRAVEL = 0.74;
/** How fast (m/s) the AI takes a crest. */
const CREST_SPEED = 26;

export interface Ai {
  /** 0.8 (gentle) .. 1 (on the limit): how much of the tyres' grip it dares to use. */
  skill: number;
  /** Preferred offset from the line (m), so a pack spreads across the road. */
  lane: number;
  stuck: number;
  wrongWay: number;
  /** The line it's taking round traffic, and for how much longer. */
  dodge: number;
  dodgeFor: number;
}

export const newAi = (skill: number, lane: number): Ai => ({ skill, lane, stuck: 0, wrongWay: 0, dodge: 0, dodgeFor: 0 });

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
  // Arcade brakes bite harder than the tyres alone (ARCADE.brakeGrip), and the AI brakes as late as you can.
  const decel = mu * G * 0.75 * (DEFAULT_ASSISTS.arcade ? ARCADE.brakeGrip : 1) - G * grade;
  const reach = (v * v) / (2 * decel) + 40;
  let best = Infinity;
  // Arcade handling corners at the grip it promises; the simulation at the tyres'.
  const corner = DEFAULT_ASSISTS.arcade ? ARCADE.grip * skill * USABLE : mu;
  for (let d = 0; d <= reach; d += 4) {
    const k = Math.abs(curvAt(t, car.s + d));
    if (k < 1e-4) continue;
    // Gravel has about three quarters of tarmac's grip.
    const j = Math.max(0, Math.min(t.n - 1, Math.round((car.s + d) / SAMPLE)));
    const vc = Math.sqrt(((t.gravel[j] ? corner * GRAVEL : corner) * G) / k);
    const allowed = Math.sqrt(vc * vc + 2 * decel * Math.max(0, d - 8));
    if (allowed < best) best = allowed;
  }
  // Lift for jumps: a crest taken flat out lands you in the next bend.
  for (const c of t.crests) {
    const d = c.s - c.len / 2 - car.s;
    if (d < -c.len / 2 || d > reach) continue;
    const allowed = Math.sqrt(CREST_SPEED ** 2 + 2 * decel * Math.max(0, d));
    if (allowed < best) best = allowed;
  }
  return best;
}

/** Two cars this far apart across the road (m) or less are in each other's way. */
const CLEAR = 2.9;
/**
 * Splitting two lanes of traffic going your way (a wide highway, lanes more than SPLIT_LANES apart): the line down
 * the middle is clear of a car either side when they're this far off it (m). Tighter than CLEAR: you thread the gap.
 */
const SPLIT_CLEAR = 2.55;
const SPLIT_LANES = 4.6;
/** A car this far across from your nose (m) or less is still in your way while you swerve out round it. */
const NOSE_CLEAR = 2;
/** How far ahead (s) the AI looks out for traffic. */
const TRAFFIC_LOOK = 4;
/** How quickly (m/s) the AI can move across the road. */
const SWERVE = 2.5;
/** Once it picks a line round traffic it holds it this long (s), so it doesn't weave. */
const DODGE_HOLD = 0.8;

/** Seconds until a car on line `d` reaches traffic in the way (Infinity if none), and the slowest car on that line it would be following. */
function wayAhead(car: Car, d: number, v: number, traffic: Obstacle[], clear = CLEAR): { at: number; follow: number } {
  let at = Infinity;
  let follow = Infinity;
  for (const o of traffic) {
    if (Math.abs(o.d - d) >= clear) continue;
    const gap = o.s - car.s;
    const reach = o.len / 2 + 2.5;
    if (gap < -reach) continue;
    // Alongside now blocks the line whatever the speeds; ahead, only if we're catching it.
    const closing = v - o.v;
    if (gap > reach && closing < 0.5) continue;
    const tc = gap > reach ? (gap - reach) / closing : 0;
    if (tc > TRAFFIC_LOOK) continue;
    at = Math.min(at, tc);
    if (o.v > 0) follow = Math.min(follow, o.v);
  }
  return { at, follow };
}

/**
 * Traffic in the way of a car aiming at offset `off`: the line it takes instead (the nearest one that's clear
 * for the next few seconds, or else the one with the most time to spare) and, if even that one is about to
 * be blocked by a slower car going its way, that car's speed to sit behind.
 */
function dodge(car: Car, t: Track, ai: Ai, off: number, v: number, dt: number, traffic: Obstacle[]): { off: number; follow: number } {
  ai.dodgeFor = Math.max(0, ai.dodgeFor - dt);
  const want = ai.dodgeFor > 0 ? ai.dodge : off;
  const lanes = lanesOf(t);
  // Between two lanes going the same way and far enough apart, the gap between them is a line of its own.
  const splits = lanes.slice(1).flatMap((l, i) => (l.dir === lanes[i].dir && l.d - lanes[i].d > SPLIT_LANES ? [(l.d + lanes[i].d) / 2] : []));
  const clearOf = (d: number) => (splits.includes(d) ? SPLIT_CLEAR : CLEAR);
  const here = wayAhead(car, want, v, traffic, clearOf(want));
  if (here.at === Infinity) return { off: want, follow: Infinity };
  const limit = t.half - 1.2;
  const lines = [off, ...lanes.map((l) => l.d), ...splits].filter((d) => Math.abs(d) <= limit);
  let best = want;
  let bestAt = here.at;
  let bestFollow = here.follow;
  // Clear beats nearly clear; between equals, the smaller swerve, and our own side of the road.
  const score = (d: number, at: number) => Math.min(at, TRAFFIC_LOOK + 1) - Math.abs(d - car.d) * 0.08 - (d > 0 ? 0.4 : 0);
  // A line past a car alongside (or about to be) can't be reached: you'd have to drive through it.
  const passable = (d: number) => wayAhead(car, d, v, traffic).at > Math.abs(d - car.d) / SWERVE + 0.8;
  for (const d of lines) {
    if (lanes.some((l) => (l.d - car.d) * (l.d - d) < 0 && !passable(l.d))) continue;
    const w = wayAhead(car, d, v, traffic, clearOf(d));
    if (score(d, w.at) > score(best, bestAt)) {
      best = d;
      bestAt = w.at;
      bestFollow = w.follow;
    }
  }
  ai.dodge = best;
  ai.dodgeFor = DODGE_HOLD;
  // Boxed in: sit behind a slower car going our way; with one coming at us, brake to drop back behind whatever's alongside.
  let follow = bestAt >= 1.6 ? Infinity : bestFollow < Infinity ? bestFollow : 0;
  // Still right behind a car while moving out round it: hold back to its speed until the swerve takes us clear.
  const behind = wayAhead(car, car.d, v, traffic, NOSE_CLEAR);
  if (behind.at < Math.min(Math.abs(best - car.d), NOSE_CLEAR) / SWERVE && behind.follow < follow) follow = behind.follow;
  return { off: best, follow };
}

/**
 * Fills `out` with the AI's controls for this tick (and resets the car if it's hopelessly stuck). `traffic`
 * is the city traffic near the car, if there is any.
 */
export function aiDrive(car: Car, t: Track, ai: Ai, dt: number, out: DriveInput, traffic?: Obstacle[]): DriveInput {
  const sp = car.spec;
  const v = forwardSpeed(car);
  const ld = Math.max(9, Math.min(42, 6 + v * 0.55));
  const ahead = car.s + ld;
  const lean = Math.max(-(t.half - 1.4), Math.min(t.half - 1.4, curvAt(t, ahead + 10) * 240));
  let off = Math.max(-(t.half - 1.2), Math.min(t.half - 1.2, ai.lane + lean));
  // Steer round bales, barrels, boulders and rocks coming up on our line (cones it just drives through).
  for (let i = firstPropFrom(t.props, car.s); i < t.props.length && t.props[i].s < car.s + ld + 25; i++) {
    const p = t.props[i];
    if (!isSolid(p.kind)) continue;
    // Room for half a car and a margin: in a fast bend the car runs a little wide of the line it aims at.
    const clear = Math.max(3.2, p.r + 2.5);
    if (Math.abs(p.d - off) < clear) off = p.d > 0 ? p.d - clear - 0.2 : p.d + clear + 0.2;
  }
  let follow = Infinity;
  if (traffic?.length) ({ off, follow } = dodge(car, t, ai, off, v, dt, traffic));
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
  // Pure pursuit: the curvature that reaches the target point.
  const kappa = (2 * Math.sin(alpha)) / ld;
  if (DEFAULT_ASSISTS.arcade) {
    // Arcade handling turns at a yaw rate set by the stick.
    out.steer = Math.max(-1, Math.min(1, (speedOf(car) * kappa) / arcadeMaxYaw(sp, speedOf(car))));
  } else {
    const delta = Math.atan((sp.axleF + sp.axleR) * kappa);
    out.steer = Math.max(-1, Math.min(1, delta / steerLimit(car, DEFAULT_ASSISTS)));
  }
  out.drift = 0;
  // Airborne: hold it straight and wait for the landing.
  if (!car.wheels.some((w) => w.contact)) out.steer = 0;

  const want = Math.min(targetSpeed(car, t, ai.skill), follow > 0 ? follow + 2 : 0);
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
    // Past the line: brake hard, then hold it on the handbrake (the brake at a standstill selects reverse).
    out.throttle = 0;
    out.brake = v > 1.5 ? 1 : 0;
    out.handbrake = v > 1.5 ? 0 : 1;
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
