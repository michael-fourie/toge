// One leg of the endless road, generated from the run's seed and the leg's number: a road that snakes over the
// hills to the leg's checkpoint and on to the gate into the next leg, with the biome's scenery beside it, the
// apocalypse's mess on it (fallen trees, boulders, potholes, mud), and at the checkpoint an arena to get out and walk
// about in, with the job's things in it (crates, a pump, a beacon, a tee box, a slot machine). The same seed and leg
// build the same map on every screen, so only the seed goes over the wire. Pure: no three.js.

import { BIOMES, checkpointOf, type Biome, type Checkpoint } from './checkpoints.ts';
import { RUN, rng, type Obstacle } from './rules.ts';
import { roadHeights, shapedFor, wildness } from './terrain.ts';

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
  /** Road index the checkpoint sits at, and where to park (on the road). */
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

export type PropKind = 'tree' | 'pine' | 'dead' | 'house' | 'wreck' | 'barrel' | 'lamp' | 'hay' | 'fence' | 'grave' | 'pumpkin' | 'cactus' | 'shroom' | 'crystal' | 'rock' | 'reed';
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
  kind: 'scrap' | 'repair' | 'gas';
  x: number;
  z: number;
}

/** The checkpoint job's things, out in the arena: walk up to one and use it. */
export interface Site {
  id: number;
  kind: 'crate' | 'pump' | 'beacon' | 'tee' | 'slot' | 'rod' | 'keg';
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
  leg: number;
  cp: Checkpoint;
  road: RoadPoint[];
  /** The leg's one stop: its checkpoint. */
  stop: Stop;
  /** The gate into the next leg, past the checkpoint (shut until the job's done). */
  gate: { i: number; x: number; z: number; h: number; y: number };
  sites: Site[];
  /** A pit stop's pond, to fish in (null everywhere else). */
  pond: { x: number; z: number; r: number } | null;
  props: Prop[];
  obstacles: Obstacle[];
  /** What blocks the road at the gate while it's shut. */
  gateBars: Obstacle[];
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
  /** A leg's length to its checkpoint (m): `legMin` plus `legPer` a leg (up to `legGrow` legs) plus up to `legVar`. */
  legMin: 980,
  legPer: 46,
  legGrow: 16,
  legVar: 420,
  /** Tightest bend (m radius): a bus has to make it. */
  minRadius: 34,
  /** The road never turns further than this from straight down -Z, so it never crosses itself. */
  maxHeading: 1.2,
  /** Straight run-in before the checkpoint and after the start. */
  straight: 54,
  /** Keep scenery this far from the road's centre line. */
  clear: 9,
  /** The checkpoint's building: its distance from the road's centre, and the clear lot round it. */
  lot: 26,
  lotClear: 30,
  /** The gate is this far past the checkpoint, and the road runs on this far past the gate (m). */
  gate: 96,
  after: 48,
} as const;

/** The arena round the parking spot: flattened out to `flat` m (blending to the hills by `blend`), crates within `spread`. */
export const ARENA = { flat: 44, blend: 80, lumps: 0.22, spread: 50, crates: 16 } as const;

/** Each leg's own seed. */
export const legSeed = (seed: number, leg: number) => (seed ^ Math.imul(leg + 1, 0x85ebca6b)) >>> 0;

const hillsOf = (seed: number, biome: Biome) => {
  const hills = shapedFor(seed, BIOMES[biome].shape ?? 'rolling');
  const k = BIOMES[biome].hill;
  return (x: number, z: number) => hills(x, z) * k;
};

/** Builds leg `leg` of the run. */
export function makeRoute(seed: number, leg = 0): Route {
  const cp = checkpointOf(seed, leg);
  const ls = legSeed(seed, leg);
  const biome = BIOMES[cp.biome];
  const r = rng(ls);
  const road: RoadPoint[] = [{ x: 0, z: 0, h: 0, s: 0, y: 0, town: false }];
  let h = 0;
  let curve = 0;
  const maxTurn = ROAD.step / ROAD.minRadius;
  const len = ROAD.legMin + Math.min(leg, ROAD.legGrow) * ROAD.legPer + r() * ROAD.legVar;
  // The leg leans one way, then another.
  let lean = (r() - 0.5) * 1.5;
  const steps = Math.round(len / ROAD.step);
  const tail = Math.round((ROAD.gate + ROAD.after) / ROAD.step);
  for (let k = 1; k <= steps + tail; k++) {
    const s = k * ROAD.step;
    const straight = s < ROAD.straight || s > len - ROAD.straight;
    if (k % 40 === 0) lean = Math.max(-0.8, Math.min(0.8, lean + (r() - 0.5) * 1.3));
    if (straight) curve *= 0.5;
    else {
      curve += (r() - 0.5) * 0.05 + (lean - h) * 0.012;
      curve = Math.max(-maxTurn, Math.min(maxTurn, curve));
    }
    h = Math.max(-ROAD.maxHeading, Math.min(ROAD.maxHeading, h + curve));
    const p = road[road.length - 1];
    road.push({ x: p.x - Math.sin(h) * ROAD.step, z: p.z - Math.cos(h) * ROAD.step, h, s, y: 0, town: r() < 0 || len - s < 150 * biome.town || (biome.town > 1.5 && s > 60) });
  }
  const stopI = steps;
  const gateI = steps + Math.round(ROAD.gate / ROAD.step);
  // Over the hills: the road follows them, smoothed and climbable, flat where you park.
  const hills = hillsOf(ls, cp.biome);
  const heights = roadHeights(road.map((p) => hills(p.x, p.z)), ROAD.step, [stopI]);
  road.forEach((p, i) => (p.y = heights[i]));

  const sp = road[stopI];
  const side = r() < 0.5 ? -1 : 1;
  const sr = { x: Math.cos(sp.h), z: -Math.sin(sp.h) };
  const stop: Stop = {
    i: stopI,
    x: sp.x,
    z: sp.z,
    side,
    y: sp.y,
    bx: sp.x + sr.x * side * ROAD.lot,
    bz: sp.z + sr.z * side * ROAD.lot,
    // Facing the road: the building's front (its -Z) points back at the road.
    bh: sp.h + (side > 0 ? Math.PI / 2 : -Math.PI / 2),
    w: 20,
    d: 13,
  };
  const gp = road[gateI];
  const gate = { i: gateI, x: gp.x, z: gp.z, h: gp.h, y: gp.y };
  const gr = { x: Math.cos(gp.h), z: -Math.sin(gp.h) };
  const gateBars: Obstacle[] = [-2, -1, 0, 1, 2].map((k) => ({ x: gp.x + gr.x * k * 2.6, z: gp.z + gr.z * k * 2.6, r: 1.5 }));

  const nearRoad = (x: number, z: number, from: number) => roadNear(road, x, z, from).d;
  const nearLot = (x: number, z: number) => Math.hypot(x - stop.bx, z - stop.bz) < ROAD.lotClear || Math.hypot(x - stop.x, z - stop.z) < ROAD.lotClear * 0.7;

  const obstacles: Obstacle[] = [];
  // The checkpoint's building is solid: circles across its footprint.
  {
    const a = { x: Math.cos(stop.bh), z: -Math.sin(stop.bh) };
    const b = { x: -Math.sin(stop.bh), z: -Math.cos(stop.bh) };
    for (let u = -stop.w / 2 + 3; u <= stop.w / 2 - 3; u += 3.5)
      for (let v = -stop.d / 2 + 3; v <= stop.d / 2 - 3; v += 3.5) obstacles.push({ x: stop.bx + a.x * u + b.x * v, z: stop.bz + a.z * u + b.z * v, r: 3.2 });
    // The gate's posts.
    for (const k of [-1, 1]) obstacles.push({ x: gp.x + gr.x * k * (ROAD.half + 1.6), z: gp.z + gr.z * k * (ROAD.half + 1.6), r: 1.2 });
  }

  // The job's things. The tee box, the slot machine and the pump stand out front of the building; the beacon and
  // the crates are out across the arena (off the road, clear of the building).
  const sites: Site[] = [];
  const front = (out: number, across: number) => ({
    x: stop.bx - Math.sin(stop.bh) * (stop.d / 2 + out) + Math.cos(stop.bh) * across,
    z: stop.bz - Math.cos(stop.bh) * (stop.d / 2 + out) - Math.sin(stop.bh) * across,
  });
  const scatter = (min: number, max: number) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * Math.PI * 2;
      const d = min + r() * (max - min);
      const x = stop.x + Math.cos(a) * d;
      const z = stop.z + Math.sin(a) * d;
      if (nearRoad(x, z, stopI) < ROAD.half + 3 || Math.hypot(x - stop.bx, z - stop.bz) < stop.w * 0.8) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
      return { x, z };
    }
    return { x: stop.x - sr.x * side * (min + 6), z: stop.z - sr.z * side * (min + 6) };
  };
  const site = (kind: Site['kind'], p: { x: number; z: number }) => sites.push({ id: sites.length, kind, ...p });
  // A pit stop has the lot: a tee box, a machine inside, and a pond with a dock to fish off.
  let pond: Route['pond'] = null;
  if (cp.job === 'rest') {
    site('tee', front(4, -5));
    site('slot', front(1.2, 5));
    const p = scatter(30, 40);
    pond = { x: p.x, z: p.z, r: 13 + r() * 5 };
    // The dock runs out from the bank nearest the bus; if that would put it over the road, walk it round the pond.
    const toBus = Math.atan2(stop.x - pond.x, stop.z - pond.z);
    let rod = { x: 0, z: 0 };
    for (let k = 0; k < 12; k++) {
      const a = toBus + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.55;
      rod = { x: pond.x + Math.sin(a) * (pond.r - 1.5), z: pond.z + Math.cos(a) * (pond.r - 1.5) };
      if (nearRoad(rod.x, rod.z, stopI) > ROAD.half + 4) break;
    }
    site('rod', rod);
  }
  if (cp.job === 'boss') site('keg', front(0, 0));
  if (cp.job === 'fuel') site('pump', scatter(34, 46));
  if (cp.job === 'beacon') site('beacon', scatter(30, 42));
  if (cp.job === 'scavenge') for (let k = 0; k < ARENA.crates; k++) site('crate', scatter(14, ARENA.spread));
  for (const s of sites) if (s.kind !== 'beacon' && s.kind !== 'rod') obstacles.push({ x: s.x, z: s.z, r: s.kind === 'crate' ? 0.7 : 1 });
  const nearSite = (x: number, z: number) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < (s.kind === 'beacon' ? 9 : 3.5));

  const props: Prop[] = [];
  const place = (kind: PropKind, x: number, z: number, hh: number, i: number, clear: number) => {
    if (nearRoad(x, z, i) < clear || nearLot(x, z) || nearSite(x, z)) return false;
    props.push({ kind, x, z, h: hh, s: r(), c: r() });
    return true;
  };
  // What grows here.
  const flora: Record<Biome, readonly [PropKind, number][]> = {
    pines: [['pine', 0.35], ['dead', 0.35], ['tree', 0.3]],
    swamp: [['dead', 0.45], ['reed', 0.4], ['tree', 0.15]],
    desert: [['cactus', 0.55], ['rock', 0.35], ['dead', 0.1]],
    snow: [['pine', 0.75], ['rock', 0.15], ['dead', 0.1]],
    shroom: [['shroom', 0.6], ['tree', 0.2], ['dead', 0.2]],
    ember: [['dead', 0.8], ['rock', 0.2]],
    neon: [['dead', 0.5], ['tree', 0.5]],
    grave: [['dead', 0.55], ['pine', 0.25], ['rock', 0.2]],
    crystal: [['crystal', 0.5], ['rock', 0.4], ['dead', 0.1]],
    coast: [['reed', 0.4], ['dead', 0.25], ['rock', 0.2], ['tree', 0.15]],
    farm: [['hay', 0.4], ['fence', 0.3], ['tree', 0.2], ['dead', 0.1]],
    canyon: [['rock', 0.7], ['cactus', 0.2], ['dead', 0.1]],
    patch: [['pumpkin', 0.5], ['dead', 0.25], ['tree', 0.25]],
  };
  const grow = (): PropKind => {
    let roll = r();
    for (const [k, w] of flora[cp.biome]) if ((roll -= w) < 0) return k;
    return flora[cp.biome][0][0];
  };
  const solid: Partial<Record<PropKind, number>> = { tree: 0.55, pine: 0.55, dead: 0.5, cactus: 0.5, shroom: 0.6, crystal: 0.9, rock: 1.1, wreck: 1.2 };
  for (let i = 3; i < road.length; i += 2) {
    const p = road[i];
    const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
    const at = (sd: number, off: number, along = 0) => ({
      x: p.x + right.x * sd * off - Math.sin(p.h) * along,
      z: p.z + right.z * sd * off - Math.cos(p.h) * along,
    });
    for (const sd of [-1, 1]) {
      if (p.town) {
        if (r() < 0.22) {
          const q = at(sd, 17 + r() * 8);
          if (place('house', q.x, q.z, p.h + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), i, 13)) {
            const f = props[props.length - 1];
            // Houses are two circles along their width.
            const a = { x: Math.cos(f.h), z: -Math.sin(f.h) };
            obstacles.push({ x: f.x + a.x * 2.4, z: f.z + a.z * 2.4, r: 3.4 }, { x: f.x - a.x * 2.4, z: f.z - a.z * 2.4, r: 3.4 });
          }
        }
        if (i % 6 === 3 && r() < 0.7) {
          const q = at(sd, ROAD.half + 1.4);
          if (place('lamp', q.x, q.z, p.h, i, ROAD.half + 1)) obstacles.push({ x: q.x, z: q.z, r: 0.25 });
        }
        // Jack-o'-lanterns on the verges: it's homecoming, it's nearly Halloween, the world has ended.
        if (r() < 0.12) {
          const q = at(sd, ROAD.half + 2 + r() * 4, (r() - 0.5) * 6);
          place('pumpkin', q.x, q.z, r() * 6.28, i, ROAD.half + 1.5);
        }
      }
      if (!p.town || biome.town < 1.5) {
        // Country: the biome's woods in clumps, the odd hay bale, fence run and graveyard.
        const roll = r();
        const n = roll < 0.35 * biome.woods ? 3 : roll < 0.6 * biome.woods ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const q = at(sd, ROAD.clear + 2 + r() * 44, (r() - 0.5) * 10);
          const kind = grow();
          if (place(kind, q.x, q.z, r() * 6.28, i, ROAD.clear) && solid[kind]) obstacles.push({ x: q.x, z: q.z, r: solid[kind]! });
        }
        if (r() < (cp.biome === 'grave' ? 0.12 : 0.02)) {
          // A little graveyard: rows of headstones set back from the road.
          const base = ROAD.clear + 4 + r() * 10;
          for (let row = 0; row < 3; row++)
            for (let col = 0; col < 4; col++) {
              const q = at(sd, base + row * 2.6, (col - 1.5) * 2.2);
              if (place('grave', q.x, q.z, p.h + (r() - 0.5) * 0.3, i, ROAD.clear)) obstacles.push({ x: q.x, z: q.z, r: 0.45 });
            }
        }
        if (cp.biome === 'pines' && r() < 0.05) {
          const q = at(sd, ROAD.clear + 4 + r() * 20);
          if (place('hay', q.x, q.z, r() * 6.28, i, ROAD.clear)) obstacles.push({ x: q.x, z: q.z, r: 1 });
        }
        if (r() < 0.05) {
          const q = at(sd, ROAD.half + 3);
          place('fence', q.x, q.z, p.h, i, ROAD.half + 2);
        }
      }
    }
    // The apocalypse's litter: wrecked cars on the shoulder (or right in the lane), burning barrels.
    const clearOfStop = Math.abs(sp.s - p.s) > 40 && Math.abs(gp.s - p.s) > 14;
    if (p.s > 80 && clearOfStop && r() < (cp.biome === 'neon' ? 0.09 : 0.045)) {
      const sd = r() < 0.5 ? -1 : 1;
      const q = at(sd, 1.5 + r() * 4);
      if (!nearLot(q.x, q.z)) {
        props.push({ kind: 'wreck', x: q.x, z: q.z, h: p.h + (r() - 0.5) * 1.6, s: r(), c: r() });
        obstacles.push({ x: q.x, z: q.z, r: 1.7 });
      }
    }
    if (r() < 0.03) {
      const sd = r() < 0.5 ? -1 : 1;
      const q = at(sd, ROAD.half + 1.5 + r() * 3);
      if (place('barrel', q.x, q.z, 0, i, ROAD.half + 1)) obstacles.push({ x: q.x, z: q.z, r: 0.45 });
    }
  }
  // The arena's own scenery: a ring of the biome's growth round its edge, a few things to duck behind inside.
  for (let k = 0; k < 46; k++) {
    const a = r() * Math.PI * 2;
    const d = k < 12 ? 16 + r() * 30 : 50 + r() * 26;
    const x = stop.x + Math.cos(a) * d;
    const z = stop.z + Math.sin(a) * d;
    const kind = k < 12 && r() < 0.5 ? (r() < 0.5 ? 'barrel' : 'rock') : grow();
    if (place(kind, x, z, r() * 6.28, stopI, ROAD.clear) && (solid[kind] || kind === 'barrel')) obstacles.push({ x, z, r: solid[kind] ?? 0.45 });
  }

  const pickups: Pickup[] = [];
  const hazards: Hazard[] = [];
  // The road gets meaner and the pickings thinner the further you go.
  const loot = Math.max(0.25, 0.6 - leg * 0.025);
  const mess = HAZARD.chance * 3 * Math.min(1.8, 1 + leg * 0.06);
  for (let i = 12; i < road.length - 6; i++) {
    const p = road[i];
    if (Math.abs(sp.s - p.s) < 30 || Math.abs(gp.s - p.s) < 20) continue;
    const right = { x: Math.cos(p.h), z: -Math.sin(p.h) };
    if (i % 9 === 0 && r() < loot) {
      const off = (r() - 0.5) * 2 * (ROAD.half - 0.5);
      const roll = r();
      const kind = roll < 0.34 ? 'gas' : roll < 0.74 ? 'scrap' : 'repair';
      pickups.push({ id: pickups.length, kind, x: p.x + right.x * off, z: p.z + right.z * off });
    }
    // The mess on the road: never two in a row, never by the checkpoint or the start.
    if (p.s < 90 || i % 3 !== 0 || hazards.some((hz) => Math.hypot(hz.x - p.x, hz.z - p.z) < 40) || Math.abs(sp.s - p.s) < 50) continue;
    if (r() > mess) continue;
    const roll = r();
    const lane = r() < 0.5 ? -1 : 1;
    if (roll < 0.25) {
      // A fallen tree across one lane, root end off the shoulder: go round it on the other side.
      const l = 5.5;
      const cx = p.x + right.x * lane * (ROAD.half - l / 2 + 1.2);
      const cz = p.z + right.z * lane * (ROAD.half - l / 2 + 1.2);
      hazards.push({ kind: 'log', x: cx, z: cz, h: p.h + Math.PI / 2 + (r() - 0.5) * 0.3, r: l });
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
  const pad = 170;
  return {
    seed,
    leg,
    cp,
    road,
    stop,
    gate,
    pond,
    sites,
    props,
    obstacles,
    gateBars,
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

/**
 * The ground's height at (x, z): the road's height on and by the road, the wild hills further out, and round the
 * checkpoint an arena flattened most of the way to the parking spot's height (you walk about there).
 */
export function groundAt(route: Route, x: number, z: number, hint = -1) {
  let hills = hillCache.get(route);
  if (!hills) {
    hills = hillsOf(legSeed(route.seed, route.leg), route.cp.biome);
    hillCache.set(route, hills);
  }
  const near = roadNear(route.road, x, z, hint);
  const d = Math.hypot(x - route.stop.x, z - route.stop.z);
  const t = Math.max(0, Math.min(1, (d - ARENA.flat) / (ARENA.blend - ARENA.flat)));
  const lumps = ARENA.lumps + (1 - ARENA.lumps) * t * t * (3 - 2 * t);
  return near.y + (hills(x, z) - near.y) * wildness(near.d) * lumps;
}

/** Which hazard (if any) a point is in: potholes and mud only (logs and rocks are solid obstacles). */
export function hazardAt(route: Route, x: number, z: number) {
  for (const h of route.hazards) {
    if (h.kind !== 'pothole' && h.kind !== 'mud') continue;
    if (Math.abs(h.x - x) < h.r && Math.abs(h.z - z) < h.r && Math.hypot(h.x - x, h.z - z) < h.r) return h;
  }
  return null;
}

/** Rough metres left to the checkpoint from road distance `s`. */
export const toGo = (route: Route, s: number) => Math.max(0, route.road[route.stop.i].s - s);

/** Is a point close enough to the checkpoint to count as parked there? */
export const atStop = (stop: Stop, x: number, z: number) => Math.hypot(x - stop.x, z - stop.z) < RUN.parkRadius;

/** What the bus can run into right now: the scenery, and the gate's bars while it's shut. */
export const solids = (route: Route, open: boolean) => (open ? route.obstacles : [...route.obstacles, ...route.gateBars]);
