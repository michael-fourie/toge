// Traffic in the open world (world.ts routes): everyday cars, all the default Pebble, on every lane of the
// expressway, the boulevard round the city and up the pass. Like the race tracks' traffic (traffic.ts) each car's
// place is a pure function of a clock, so nobody sends a byte for it. Free roam has no GO to count from, so the
// clock is the wall clock (roamClock): everyone online sees the same cars within their clocks' drift, and each
// client bumps into its own copy.

import { carSpec, newOwnedCar } from './cars.ts';
import { type TrafficPose } from './traffic.ts';
import { type Car, collideCars, newCar } from './vehicle.ts';
import type { Route, World } from './world.ts';

/** Seconds on the shared free-roam clock: the wall clock, from a recent epoch so the numbers stay small. */
export const roamClock = (now = Date.now()) => (now - 1.7e12) / 1000;

/** How close (m) a traffic car has to be before it's checked properly. */
const NEAR = 9;

/** How far along route `r` its car `k` is at `time`. */
export function routeS(r: Route, k: number, time: number): number {
  const u = (r.cars[k].s0 + r.v * time) % r.length;
  return u < 0 ? u + r.length : u;
}

/** Car `k` of route `r` at `time`: where it is, which way it faces and how fast it's going. */
export function routePose(r: Route, k: number, time: number, out: TrafficPose): TrafficPose {
  const s = routeS(r, k, time);
  const n = r.x.length;
  const f = (s / r.length) * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const u = f - Math.floor(f);
  out.s = s;
  out.d = 0;
  out.x = r.x[i] + (r.x[j] - r.x[i]) * u;
  out.y = r.y[i] + (r.y[j] - r.y[i]) * u;
  out.z = r.z[i] + (r.z[j] - r.z[i]) * u;
  const tx = r.tx[i] + (r.tx[j] - r.tx[i]) * u;
  const tz = r.tz[i] + (r.tz[j] - r.tz[i]) * u;
  out.yaw = Math.atan2(-tx, -tz);
  out.vx = tx * r.v;
  out.vz = tz * r.v;
  return out;
}

/** Calls `fn` with every traffic car within `reach` of (x, z) at `time` (the pose is reused: copy what you keep). */
export function trafficNear(w: World, x: number, z: number, reach: number, time: number, fn: (p: TrafficPose, route: number, k: number) => void) {
  const r2 = reach * reach;
  for (let ri = 0; ri < w.routes.length; ri++) {
    const r = w.routes[ri];
    const n = r.x.length;
    for (let k = 0; k < r.cars.length; k++) {
      // The nearest sample first (cheap), the interpolated pose only for the few that are close.
      const i = Math.floor((routeS(r, k, time) / r.length) * n) % n;
      const dx = r.x[i] - x;
      const dz = r.z[i] - z;
      if (dx * dx + dz * dz > (reach + 3) ** 2) continue;
      routePose(r, k, time, pose);
      if ((pose.x - x) ** 2 + (pose.z - z) ** 2 <= r2) fn(pose, ri, k);
    }
  }
}

const pose: TrafficPose = { s: 0, d: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 };

/** The stand-in a traffic car is to bump into: a stock Pebble (it doesn't budge). */
let ghost: Car | null = null;
function ghostCar(): Car {
  return (ghost ??= newCar(carSpec(newOwnedCar('pebble')), 0, 0, 0, 0));
}

/** Knocks `car` off any traffic car it's touching at `time`. */
export function collideWorldTraffic(w: World, car: Car, time: number) {
  const g = ghostCar();
  trafficNear(w, car.p.x, car.p.z, NEAR, time, (p) => {
    if (Math.abs(p.y - (car.p.y - car.spec.cg)) > 3) return; // on the deck above, or the road below
    g.p.x = p.x;
    g.p.y = p.y + g.spec.cg;
    g.p.z = p.z;
    g.q.x = g.q.z = 0;
    g.q.y = Math.sin(p.yaw / 2);
    g.q.w = Math.cos(p.yaw / 2);
    g.v.x = p.vx;
    g.v.y = 0;
    g.v.z = p.vz;
    g.w.x = g.w.y = g.w.z = 0;
    collideCars(car, g, false);
  });
}

// --- Near misses -----------------------------------------------------------------------------

/** Threading through traffic: how close counts, how fast you have to be going, and how long a chain lasts. */
export const NEAR_MISS = {
  /** Centre to centre (m) at the closest point: about a hand's width of daylight between two Pebbles side by side. */
  close: 3.3,
  /** Only counted once the car is past this far again (m). */
  clear: 8,
  /** Your speed (m/s) and how much quicker than the traffic car you have to be. */
  minSpeed: 22,
  minRel: 12,
  /** A chain keeps going while each miss comes within this long of the last (s). */
  chain: 3,
};

export interface NearMisses {
  /** Each traffic car close by: its closest approach so far, and whether you touched it. */
  near: Map<number, { min: number; hit: boolean }>;
  chain: number;
  lastAt: number;
}

export const newNearMisses = (): NearMisses => ({ near: new Map(), chain: 0, lastAt: -1e9 });

/**
 * One tick of near-miss spotting for `car` at `time` (`now`: seconds on any steady clock, for the chain). Returns the
 * chain count when a near miss lands this tick (1 for the first), else 0. A car you touched never counts.
 */
export function stepNearMisses(nm: NearMisses, w: World, car: Car, time: number, now: number): number {
  const speed = Math.hypot(car.v.x, car.v.z);
  const seen = new Set<number>();
  trafficNear(w, car.p.x, car.p.z, NEAR_MISS.clear, time, (p, ri, k) => {
    if (Math.abs(p.y - (car.p.y - car.spec.cg)) > 3) return;
    const key = ri * 4096 + k;
    seen.add(key);
    const d = Math.hypot(p.x - car.p.x, p.z - car.p.z);
    const rel = Math.hypot(car.v.x - p.vx, car.v.z - p.vz);
    const e = nm.near.get(key);
    const hit = car.hit > 1 && d < 5;
    if (e) {
      e.min = Math.min(e.min, d);
      e.hit ||= hit;
    } else if (speed > NEAR_MISS.minSpeed && rel > NEAR_MISS.minRel) nm.near.set(key, { min: d, hit });
  });
  if (now - nm.lastAt > NEAR_MISS.chain) nm.chain = 0;
  let landed = 0;
  for (const [key, e] of nm.near) {
    if (seen.has(key)) continue;
    nm.near.delete(key);
    if (e.hit || e.min > NEAR_MISS.close) continue;
    nm.chain++;
    nm.lastAt = now;
    landed = nm.chain;
  }
  return landed;
}
