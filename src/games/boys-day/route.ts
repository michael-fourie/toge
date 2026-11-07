// The run's map, generated from a seed: one long road that snakes from the paintball arena past the driving range,
// the casino and the jail to the boys' house, with farmland, woods and town strips beside it. The same seed builds the
// same map on every screen, so only the seed goes over the wire. Pure: no three.js.

import { RUN, STOP_ORDER, rng, type Obstacle, type StopKind } from './rules.ts';

export interface RoadPoint {
  x: number;
  z: number;
  /** Heading of the road here (yaw, 0 faces -Z). */
  h: number;
  /** Distance along the road from the start (m). */
  s: number;
  /** Town stretch (lamp posts, houses) rather than country. */
  town: boolean;
}

export interface Stop {
  kind: StopKind;
  /** Road index the stop sits at, and where to park (on the road). */
  i: number;
  x: number;
  z: number;
  /** -1: the building's on the left of the road, 1: on the right. */
  side: number;
  /** The building: centre, facing the road (yaw), size. */
  bx: number;
  bz: number;
  bh: number;
  w: number;
  d: number;
}

export type PropKind = 'tree' | 'pine' | 'dead' | 'house' | 'wreck' | 'barrel' | 'lamp' | 'hay' | 'fence' | 'grave' | 'pumpkin';
export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  h: number;
  /** Size and colour variety, 0-1. */
  s: number;
  c: number;
}

export interface Pickup {
  id: number;
  kind: 'cash' | 'repair';
  x: number;
  z: number;
}

/** A crowd standing about that wakes up when the bus comes near. */
export interface Horde {
  id: number;
  x: number;
  z: number;
  n: number;
}

export interface Route {
  seed: number;
  road: RoadPoint[];
  stops: Stop[];
  props: Prop[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  hordes: Horde[];
  /** Box round everything (for the ground). */
  min: { x: number; z: number };
  max: { x: number; z: number };
}

export const ROAD = {
  /** Half the road's width (two lanes and a shoulder). */
  half: 5,
  step: 6,
  /** Each leg between stops (m). */
  legMin: 420,
  legMax: 560,
  /** Tightest bend (m radius): a bus has to make it. */
  minRadius: 34,
  /** The road never turns further than this from straight down -Z, so it never crosses itself. */
  maxHeading: 1.2,
  /** Straight run-in before each stop and after the start. */
  straight: 54,
  /** Keep scenery this far from the road's centre line. */
  clear: 9,
  /** Stops: the building's distance from the road's centre, and the clear lot round it. */
  lot: 24,
  lotClear: 34,
} as const;

/** Builds the whole map from a seed. */
export function makeRoute(seed: number): Route {
  const r = rng(seed);
  const road: RoadPoint[] = [{ x: 0, z: 0, h: 0, s: 0, town: true }];
  const stopAt: number[] = [0];
  let h = 0;
  let curve = 0;
  let legDir = 0;
  const maxTurn = ROAD.step / ROAD.minRadius;
  for (let leg = 1; leg < STOP_ORDER.length; leg++) {
    const len = ROAD.legMin + r() * (ROAD.legMax - ROAD.legMin);
    // Each leg leans a new way, but never far from the run's overall direction.
    legDir = Math.max(-0.8, Math.min(0.8, legDir + (r() - 0.5) * 1.3));
    const start = road[road.length - 1].s;
    const steps = Math.round(len / ROAD.step);
    for (let k = 1; k <= steps; k++) {
      const s = k * ROAD.step;
      const straight = s < ROAD.straight || len - s < ROAD.straight;
      if (straight) curve *= 0.5;
      else {
        curve += (r() - 0.5) * 0.05 + (legDir - h) * 0.012;
        curve = Math.max(-maxTurn, Math.min(maxTurn, curve));
      }
      h = Math.max(-ROAD.maxHeading, Math.min(ROAD.maxHeading, h + curve));
      const p = road[road.length - 1];
      const town = s < 120 || len - s < 140;
      road.push({ x: p.x - Math.sin(h) * ROAD.step, z: p.z - Math.cos(h) * ROAD.step, h, s: start + s, town });
    }
    stopAt.push(road.length - 1);
  }
  // A short run past the house, so it isn't at the end of the world.
  for (let k = 0; k < 12; k++) {
    const p = road[road.length - 1];
    road.push({ x: p.x - Math.sin(h) * ROAD.step, z: p.z - Math.cos(h) * ROAD.step, h, s: p.s + ROAD.step, town: true });
  }

  const stops: Stop[] = STOP_ORDER.map((kind, n) => {
    const i = stopAt[n];
    const p = road[i];
    const side = r() < 0.5 ? -1 : 1;
    const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
    const big = kind === 'casino' || kind === 'arena';
    return {
      kind,
      i,
      x: p.x,
      z: p.z,
      side,
      bx: p.x + right.x * side * ROAD.lot,
      bz: p.z + right.z * side * ROAD.lot,
      // Facing the road: the building's front (its -Z) points back at the road.
      bh: p.h + (side > 0 ? Math.PI / 2 : -Math.PI / 2),
      w: big ? 22 : 16,
      d: big ? 16 : 12,
    };
  });

  const nearRoad = (x: number, z: number, from: number) => roadNear(road, x, z, from).d;
  const nearStop = (x: number, z: number) => stops.some((s) => Math.hypot(x - s.bx, z - s.bz) < ROAD.lotClear || Math.hypot(x - s.x, z - s.z) < ROAD.lotClear * 0.7);

  const props: Prop[] = [];
  const obstacles: Obstacle[] = [];
  const place = (kind: PropKind, x: number, z: number, hh: number, i: number, clear: number) => {
    if (nearRoad(x, z, i) < clear || nearStop(x, z)) return false;
    props.push({ kind, x, z, h: hh, s: r(), c: r() });
    return true;
  };
  for (let i = 3; i < road.length; i += 2) {
    const p = road[i];
    const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
    const at = (side: number, off: number, along = 0) => ({
      x: p.x + right.x * side * off - Math.sin(p.h) * along,
      z: p.z + right.z * side * off - Math.cos(p.h) * along,
    });
    for (const side of [-1, 1]) {
      if (p.town) {
        if (r() < 0.22) {
          const q = at(side, 17 + r() * 8);
          if (place('house', q.x, q.z, p.h + (side > 0 ? Math.PI / 2 : -Math.PI / 2), i, 13)) {
            const f = props[props.length - 1];
            // Houses are two circles along their width.
            const a = { x: Math.cos(f.h), z: -Math.sin(f.h) };
            obstacles.push({ x: f.x + a.x * 2.4, z: f.z + a.z * 2.4, r: 3.4 }, { x: f.x - a.x * 2.4, z: f.z - a.z * 2.4, r: 3.4 });
          }
        }
        if (i % 6 === 3 && r() < 0.7) {
          const q = at(side, ROAD.half + 1.4);
          if (place('lamp', q.x, q.z, p.h, i, ROAD.half + 1)) obstacles.push({ x: q.x, z: q.z, r: 0.25 });
        }
        // Jack-o'-lanterns on the verges: it's homecoming, it's nearly Halloween, the world has ended.
        if (r() < 0.12) {
          const q = at(side, ROAD.half + 2 + r() * 4, (r() - 0.5) * 6);
          place('pumpkin', q.x, q.z, r() * 6.28, i, ROAD.half + 1.5);
        }
      } else {
        // Country: woods in clumps (plenty of them dead and bare), the odd hay bale, fence run and graveyard.
        const n = r() < 0.35 ? 3 : r() < 0.6 ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const q = at(side, ROAD.clear + 2 + r() * 40, (r() - 0.5) * 10);
          const roll = r();
          const kind: PropKind = roll < 0.35 ? 'pine' : roll < 0.7 ? 'dead' : 'tree';
          if (place(kind, q.x, q.z, r() * 6.28, i, ROAD.clear)) obstacles.push({ x: q.x, z: q.z, r: 0.55 });
        }
        if (r() < 0.025) {
          // A little graveyard: rows of headstones set back from the road.
          const base = ROAD.clear + 4 + r() * 10;
          for (let row = 0; row < 3; row++)
            for (let col = 0; col < 4; col++) {
              const q = at(side, base + row * 2.6, (col - 1.5) * 2.2);
              if (place('grave', q.x, q.z, p.h + (r() - 0.5) * 0.3, i, ROAD.clear)) obstacles.push({ x: q.x, z: q.z, r: 0.45 });
            }
        }
        if (r() < 0.05) {
          const q = at(side, ROAD.clear + 4 + r() * 20);
          if (place('hay', q.x, q.z, r() * 6.28, i, ROAD.clear)) obstacles.push({ x: q.x, z: q.z, r: 1 });
        }
        if (r() < 0.06) {
          const q = at(side, ROAD.half + 3);
          place('fence', q.x, q.z, p.h, i, ROAD.half + 2);
        }
      }
    }
    // The apocalypse's litter: wrecked cars on the shoulder (or right in the lane), burning barrels.
    if (p.s > 80 && r() < 0.045) {
      const side = r() < 0.5 ? -1 : 1;
      const q = at(side, 1.5 + r() * 4);
      if (!nearStop(q.x, q.z) && !stops.some((s) => Math.abs(road[s.i].s - p.s) < 40)) {
        props.push({ kind: 'wreck', x: q.x, z: q.z, h: p.h + (r() - 0.5) * 1.6, s: r(), c: r() });
        obstacles.push({ x: q.x, z: q.z, r: 1.7 });
      }
    }
    if (r() < 0.03) {
      const side = r() < 0.5 ? -1 : 1;
      const q = at(side, ROAD.half + 1.5 + r() * 3);
      if (place('barrel', q.x, q.z, 0, i, ROAD.half + 1)) obstacles.push({ x: q.x, z: q.z, r: 0.45 });
    }
  }
  // Each stop's building is solid: circles across its footprint.
  for (const s of stops) {
    const a = { x: Math.cos(s.bh), z: -Math.sin(s.bh) };
    const b = { x: -Math.sin(s.bh), z: -Math.cos(s.bh) };
    for (let u = -s.w / 2 + 3; u <= s.w / 2 - 3; u += 4)
      for (let v = -s.d / 2 + 3; v <= s.d / 2 - 3; v += 4) obstacles.push({ x: s.bx + a.x * u + b.x * v, z: s.bz + a.z * u + b.z * v, r: 3 });
  }

  const pickups: Pickup[] = [];
  const hordes: Horde[] = [];
  for (let i = 12; i < road.length - 6; i++) {
    const p = road[i];
    if (stops.some((s) => Math.abs(road[s.i].s - p.s) < 30)) continue;
    if (i % 9 === 0 && r() < 0.55) {
      const off = (r() - 0.5) * 2 * (ROAD.half + 3);
      const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
      pickups.push({ id: pickups.length, kind: r() < 0.62 ? 'cash' : 'repair', x: p.x + right.x * off, z: p.z + right.z * off });
    }
    if (i % 25 === 0 && r() < 0.6) {
      const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
      const off = (r() - 0.5) * 30;
      hordes.push({ id: hordes.length, x: p.x + right.x * off, z: p.z + right.z * off, n: 5 + Math.floor(r() * 7) });
    }
  }

  const xs = road.map((p) => p.x);
  const zs = road.map((p) => p.z);
  const pad = 160;
  return {
    seed,
    road,
    stops,
    props,
    obstacles,
    pickups,
    hordes,
    min: { x: Math.min(...xs) - pad, z: Math.min(...zs) - pad },
    max: { x: Math.max(...xs) + pad, z: Math.max(...zs) + pad },
  };
}

/** The nearest point on the road to (x, z): the segment index, the distance and how far along the road it is. */
export function roadNear(road: readonly RoadPoint[], x: number, z: number, hint = -1) {
  let lo = 0;
  let hi = road.length - 1;
  if (hint >= 0) {
    lo = Math.max(0, hint - 40);
    hi = Math.min(road.length - 1, hint + 40);
  }
  let best = { i: 0, d: Infinity, s: 0 };
  for (let i = lo; i < hi; i++) {
    const a = road[i];
    const b = road[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best.d) best = { i, d, s: a.s + (b.s - a.s) * t };
  }
  return best;
}

/** How far the road runs from the start to stop `n`. */
export const stopS = (route: Route, n: number) => route.road[route.stops[n].i].s;

/** Rough metres left to stop `n` from road distance `s`. */
export const toGo = (route: Route, n: number, s: number) => Math.max(0, stopS(route, n) - s);

/** Is a point close enough to the stop to count as parked there? */
export const atStop = (stop: Stop, x: number, z: number) => Math.hypot(x - stop.x, z - stop.z) < RUN.parkRadius;
