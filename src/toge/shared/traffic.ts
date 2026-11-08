// Traffic: cars on all four lanes that you have to dodge, two each way in town, or all four going your way on a
// highway (the slow lane on the left, the fast one by the median). Every car's place is a pure
// function of the race clock (seconds since GO), laid out from the track's seed, so every racer online sees
// the same traffic at the same moment without a byte on the wire, and the AI and the tests see it too.
//
// Each lane keeps one speed, so the cars in it never run into each other. They loop: a car leaving one end
// of the traffic stretch comes back in at the other.

import { carSpec, newOwnedCar } from './cars.ts';
import { type Track, pointAt } from './track.ts';
import { type Car, collideCars, newCar } from './vehicle.ts';

export type TrafficKind = 'sedan' | 'kei' | 'truck';

/** Size of each kind (m) and how heavy it is to hit (kg). */
export const TRAFFIC_KINDS: Record<TrafficKind, { len: number; width: number; height: number; mass: number }> = {
  sedan: { len: 4.6, width: 1.76, height: 1.45, mass: 1500 },
  kei: { len: 3.4, width: 1.48, height: 1.85, mass: 900 },
  truck: { len: 6.8, width: 2.1, height: 2.9, mass: 5000 },
};

/** A lane: offset across the road (+ = right), which way it drives (1 = with the race) and how fast (m/s). */
export interface Lane {
  d: number;
  dir: 1 | -1;
  v: number;
}

/** A town's four lanes, two each way. */
export const LANES: Lane[] = [
  { d: -5.6, dir: 1, v: 12 },
  { d: -1.9, dir: 1, v: 17 },
  { d: 1.9, dir: -1, v: 16 },
  { d: 5.6, dir: -1, v: 12 },
];

/**
 * A highway's four lanes, all with the race: trucks and dawdlers on the left, quicker by the median (61-101 km/h).
 * Laid out for a 16 m road (Ryūsei); a wider one spreads them across its width (lanesOf).
 */
export const HIGHWAY_LANES: Lane[] = [
  { d: -5.8, dir: 1, v: 17 },
  { d: -1.95, dir: 1, v: 21 },
  { d: 1.95, dir: 1, v: 24.5 },
  { d: 5.8, dir: 1, v: 28 },
];

const HIGHWAY_HALF = 8;
const wideLanes = new WeakMap<Track, Lane[]>();

/** The lanes a track's traffic drives in (a highway's spread over its width: Hayate Flats is 22 m). */
export function lanesOf(t: Track): Lane[] {
  if (t.def.traffic !== 'highway') return LANES;
  if (t.half === HIGHWAY_HALF) return HIGHWAY_LANES;
  let lanes = wideLanes.get(t);
  if (!lanes) wideLanes.set(t, (lanes = HIGHWAY_LANES.map((l) => ({ ...l, d: (l.d * t.half) / HIGHWAY_HALF }))));
  return lanes;
}

export interface TrafficCar {
  kind: TrafficKind;
  lane: number;
  /** Where it is along the road at time 0. */
  s0: number;
  /** Index into the paint list the renderer uses. */
  paint: number;
}

export interface Traffic {
  cars: TrafficCar[];
  lanes: Lane[];
  /** The stretch of road the traffic loops over. */
  lo: number;
  hi: number;
}

/** Where a traffic car is at a moment: along and across the road, in the world, which way it faces, and its velocity. */
export interface TrafficPose {
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
}

export const newPose = (): TrafficPose => ({ s: 0, d: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 });

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new WeakMap<Track, Traffic | null>();

/** The track's traffic (null on tracks without). Clear of the grid, so nobody starts in a car's way. */
export function getTraffic(t: Track): Traffic | null {
  if (cache.has(t)) return cache.get(t)!;
  let tr: Traffic | null = null;
  if (t.def.traffic) {
    const rng = mulberry(t.def.seed * 97 + 5);
    const lo = t.startS + 140;
    const hi = t.finishS - 30;
    const cars: TrafficCar[] = [];
    const lanes = lanesOf(t);
    const highway = t.def.traffic === 'highway';
    lanes.forEach((_, lane) => {
      // Gaps always longer than the longest car (and its wrap round the loop too); wider at highway speeds, and
      // the trucks keep to the slow lanes there.
      const [gap, spread] = highway ? [80, 150] : [55, 105];
      for (let s = lo + rng() * 60; s < hi - 50; s += gap + rng() * spread) {
        const r = rng();
        const truck = highway ? (lane < 2 ? 0.3 : 0.04) : 0.14;
        const sedan = 0.76 - truck;
        const kind: TrafficKind = r < sedan ? 'sedan' : r < sedan + 0.24 ? 'kei' : 'truck';
        cars.push({ kind, lane, s0: s, paint: Math.floor(rng() * 1000) });
      }
    });
    tr = { cars, lanes, lo, hi };
  }
  cache.set(t, tr);
  return tr;
}

/** How far along the road a traffic car is at `time` (seconds since GO; negative during the countdown). */
export function trafficS(tr: Traffic, car: TrafficCar, time: number): number {
  const span = tr.hi - tr.lo;
  const lane = tr.lanes[car.lane];
  const u = (car.s0 - tr.lo + lane.dir * lane.v * time) % span;
  return tr.lo + (u < 0 ? u + span : u);
}

export function trafficPose(t: Track, tr: Traffic, car: TrafficCar, time: number, out: TrafficPose): TrafficPose {
  const lane = tr.lanes[car.lane];
  const s = trafficS(tr, car, time);
  const p = pointAt(t, s, lane.d);
  out.s = s;
  out.d = lane.d;
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.yaw = Math.atan2(-p.tx, -p.tz) + (lane.dir < 0 ? Math.PI : 0);
  out.vx = p.tx * lane.v * lane.dir;
  out.vz = p.tz * lane.v * lane.dir;
  return out;
}

/** What the AI needs to know about the traffic near it: where each car is and how fast it's going along the road. */
export interface Obstacle {
  s: number;
  d: number;
  /** Speed along the road (negative: coming the other way). */
  v: number;
  len: number;
}

/** Traffic between `s0` and `s1` along the road at `time`, into `out` (cleared first). */
export function trafficBetween(tr: Traffic, time: number, s0: number, s1: number, out: Obstacle[]): Obstacle[] {
  out.length = 0;
  for (const c of tr.cars) {
    const s = trafficS(tr, c, time);
    if (s < s0 || s > s1) continue;
    const lane = tr.lanes[c.lane];
    out.push({ s, d: lane.d, v: lane.dir * lane.v, len: TRAFFIC_KINDS[c.kind].len });
  }
  return out;
}

// --- Bumping into it ------------------------------------------------------------------------

/**
 * Stand-in cars to collide with: a car's collision shape is two circles, so a truck is two stand-ins nose to
 * tail (one pair of circles that long would leave a hole in the middle to drive through).
 */
const ghosts = new Map<TrafficKind, { car: Car; along: number }[]>();
function ghostsOf(kind: TrafficKind) {
  let g = ghosts.get(kind);
  if (g) return g;
  const k = TRAFFIC_KINDS[kind];
  const base = carSpec(newOwnedCar('pebble'));
  const parts = k.len > 5 ? 2 : 1;
  const len = k.len / parts;
  const mass = k.mass / parts;
  const spec = {
    ...base,
    mass,
    inertia: [(mass / 12) * (k.height ** 2 + len ** 2), (mass / 12) * (k.width ** 2 + len ** 2), (mass / 12) * (k.width ** 2 + k.height ** 2)] as [number, number, number],
    body: { hw: k.width / 2, hl: len / 2, y0: -base.cg, y1: k.height - base.cg },
  };
  g = Array.from({ length: parts }, (_, i) => ({ car: newCar(spec, 0, 0, 0, 0), along: parts === 1 ? 0 : (i - 0.5) * len }));
  ghosts.set(kind, g);
  return g;
}

const pose = newPose();

/** Knocks `car` off any traffic it's touching at `time` (the traffic doesn't budge). */
export function collideTraffic(t: Track, tr: Traffic, car: Car, time: number) {
  for (const c of tr.cars) {
    const s = trafficS(tr, c, time);
    if (Math.abs(s - car.s) > 12) continue;
    trafficPose(t, tr, c, time, pose);
    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    for (const g of ghostsOf(c.kind)) {
      const gc = g.car;
      gc.p.x = pose.x + fx * g.along;
      gc.p.z = pose.z + fz * g.along;
      gc.p.y = pose.y + gc.spec.cg;
      gc.q.x = 0;
      gc.q.y = Math.sin(pose.yaw / 2);
      gc.q.z = 0;
      gc.q.w = Math.cos(pose.yaw / 2);
      gc.v.x = pose.vx;
      gc.v.y = 0;
      gc.v.z = pose.vz;
      gc.w.x = gc.w.y = gc.w.z = 0;
      collideCars(car, gc, false);
    }
  }
}
