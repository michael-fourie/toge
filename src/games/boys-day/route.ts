// The run's map, generated from a seed: one long road that snakes over the hills from the paintball arena past the
// driving range, the casino and the jail to the boys' house, with farmland, woods and town strips beside it, and the
// apocalypse's mess on it (fallen trees, boulders, potholes, mud). The same seed builds the same map on every screen,
// so only the seed goes over the wire. Pure: no three.js.

import { RUN, STOP_ORDER, rng, type Obstacle, type StopKind } from './rules.ts';
import { hillsFor, roadHeights, wildness } from './terrain.ts';

export interface RoadPoint {
  x: number;
  z: number;
  /** Heading of the road here (yaw, 0 faces -Z). */
  h: number;
  /** Distance along the road from the start (m). */
  s: number;
  /** The road's height here (m). */
  y: number;
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
  /** The ground's height at the stop (it's flat there). */
  y: number;
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
  kind: 'cash' | 'repair' | 'gas';
  x: number;
  z: number;
}

/**
 * The road's hazards: a fallen tree across a lane (solid), a pile of boulders (solid), a pothole (a jolt that
 * hurts the bus and kills speed), a mud patch (drags and steals the steering's grip).
 */
export interface Hazard {
  kind: 'log' | 'rocks' | 'pothole' | 'mud';
  x: number;
  z: number;
  /** Which way it lies (yaw), and its size (m: the log's length, the rocks' spread, the hole's or mud's radius). */
  h: number;
  r: number;
}

export const HAZARD = {
  /** Chance per road point (past the start, clear of the stops). */
  chance: 0.07,
  /** Bus over a pothole: the speed it keeps, and the damage. */
  potholeKeep: 0.7,
  potholeDamage: 14,
} as const;

export interface Route {
  seed: number;
  road: RoadPoint[];
  stops: Stop[];
  props: Prop[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  hazards: Hazard[];
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
  const road: RoadPoint[] = [{ x: 0, z: 0, h: 0, s: 0, y: 0, town: true }];
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
      road.push({ x: p.x - Math.sin(h) * ROAD.step, z: p.z - Math.cos(h) * ROAD.step, h, s: start + s, y: 0, town });
    }
    stopAt.push(road.length - 1);
  }
  // A short run past the house, so it isn't at the end of the world.
  for (let k = 0; k < 12; k++) {
    const p = road[road.length - 1];
    road.push({ x: p.x - Math.sin(h) * ROAD.step, z: p.z - Math.cos(h) * ROAD.step, h, s: p.s + ROAD.step, y: 0, town: true });
  }
  // Over the hills: the road follows them, smoothed and climbable, flat at every stop.
  const hills = hillsFor(seed);
  const heights = roadHeights(road.map((p) => hills(p.x, p.z)), ROAD.step, stopAt);
  road.forEach((p, i) => (p.y = heights[i]));

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
      y: p.y,
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
  const hazards: Hazard[] = [];
  for (let i = 12; i < road.length - 6; i++) {
    const p = road[i];
    if (stops.some((s) => Math.abs(road[s.i].s - p.s) < 30)) continue;
    const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
    if (i % 9 === 0 && r() < 0.6) {
      const off = (r() - 0.5) * 2 * (ROAD.half - 0.5);
      const roll = r();
      // Gas matters most: the tank won't last the whole way home without it.
      const kind = roll < 0.4 ? 'gas' : roll < 0.75 ? 'cash' : 'repair';
      pickups.push({ id: pickups.length, kind, x: p.x + right.x * off, z: p.z + right.z * off });
    }
    // The mess on the road: never two in a row, never by a stop or the start.
    if (p.s < 90 || i % 3 !== 0 || hazards.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 40) || stops.some((s) => Math.abs(road[s.i].s - p.s) < 50)) continue;
    if (r() > HAZARD.chance * 3) continue;
    const roll = r();
    const lane = r() < 0.5 ? -1 : 1;
    if (roll < 0.25) {
      // A fallen tree across one lane, root end off the shoulder: go round it on the other side.
      const len = 5.5;
      const cx = p.x + right.x * lane * (ROAD.half - len / 2 + 1.2);
      const cz = p.z + right.z * lane * (ROAD.half - len / 2 + 1.2);
      hazards.push({ kind: 'log', x: cx, z: cz, h: p.h + Math.PI / 2 + (r() - 0.5) * 0.3, r: len });
      for (let k = -2; k <= 2; k++) obstacles.push({ x: cx + right.x * k * 1.1, z: cz + right.z * k * 1.1, r: 0.55 });
    } else if (roll < 0.45) {
      const cx = p.x + right.x * lane * 2.6;
      const cz = p.z + right.z * lane * 2.6;
      hazards.push({ kind: 'rocks', x: cx, z: cz, h: r() * 6.28, r: 1.6 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        obstacles.push({ x: cx + Math.cos(a) * 1.1, z: cz + Math.sin(a) * 1.1, r: 0.9 });
      }
    } else if (roll < 0.75) {
      const off = (r() - 0.5) * 2 * (ROAD.half - 1.5);
      hazards.push({ kind: 'pothole', x: p.x + right.x * off, z: p.z + right.z * off, h: r() * 6.28, r: 1.1 + r() * 0.5 });
    } else hazards.push({ kind: 'mud', x: p.x, z: p.z, h: p.h, r: 6 + r() * 4 });
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
    hazards,
    min: { x: Math.min(...xs) - pad, z: Math.min(...zs) - pad },
    max: { x: Math.max(...xs) + pad, z: Math.max(...zs) + pad },
  };
}

/**
 * The nearest point on the road to (x, z): the segment index, the distance, how far along the road it is, and the
 * road's height there. Without a hint it starts from the road point level with z (the road always heads on down -Z).
 */
export function roadNear(road: readonly RoadPoint[], x: number, z: number, hint = -1) {
  if (hint < 0) {
    let a = 0;
    let b = road.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (road[m].z > z) a = m;
      else b = m;
    }
    hint = a;
  }
  const lo = Math.max(0, hint - 40);
  const hi = Math.min(road.length - 1, hint + 40);
  let best = { i: 0, d: Infinity, s: 0, y: 0 };
  for (let i = lo; i < hi; i++) {
    const a = road[i];
    const b = road[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best.d) best = { i, d, s: a.s + (b.s - a.s) * t, y: a.y + (b.y - a.y) * t };
  }
  return best;
}

const hillCache = new WeakMap<Route, (x: number, z: number) => number>();

/** The ground's height at (x, z): the road's height on and by the road, the wild hills further out. */
export function groundAt(route: Route, x: number, z: number, hint = -1) {
  let hills = hillCache.get(route);
  if (!hills) {
    hills = hillsFor(route.seed);
    hillCache.set(route, hills);
  }
  const near = roadNear(route.road, x, z, hint);
  return near.y + (hills(x, z) - near.y) * wildness(near.d);
}

/** Which hazard (if any) a point is in: potholes and mud only (logs and rocks are solid obstacles). */
export function hazardAt(route: Route, x: number, z: number) {
  for (const h of route.hazards) {
    if (h.kind !== 'pothole' && h.kind !== 'mud') continue;
    if (Math.abs(h.x - x) < h.r && Math.abs(h.z - z) < h.r && Math.hypot(h.x - x, h.z - z) < h.r) return h;
  }
  return null;
}

/** How far the road runs from the start to stop `n`. */
export const stopS = (route: Route, n: number) => route.road[route.stops[n].i].s;

/** Rough metres left to stop `n` from road distance `s`. */
export const toGo = (route: Route, n: number, s: number) => Math.max(0, stopS(route, n) - s);

/** Is a point close enough to the stop to count as parked there? */
export const atStop = (stop: Stop, x: number, z: number) => Math.hypot(x - stop.x, z - stop.z) < RUN.parkRadius;
