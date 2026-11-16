// Things on the road: hay bales and barrels to steer round, cone chicanes to smash through; on a hill climb,
// boulders and rocks fallen onto the road's edges. Placed from the track's seed, so every racer gets the same
// layout. (Launch ramps sat on the straights too until 2026-11-10, when Andrew asked to "remove all ramps/jumps
// that are not part of the map": the road's own crests stay, track.ts `crest`.)

import { type Track, SAMPLE, pointAt, roadY, newLoc, locate } from './track.ts';

export type PropKind = 'bale' | 'barrel' | 'cone' | 'boulder' | 'rock';

export interface Prop {
  kind: PropKind;
  /** Distance along the road and offset across it (+ = right). */
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Collision radius (bales, barrels, cones; each boulder and rock its own size). */
  r: number;
}

export const PROP_RADIUS: Record<PropKind, number> = { bale: 0.8, barrel: 0.48, cone: 0.28, boulder: 1.8, rock: 0.6 };
/** Bales, barrels, boulders and rocks stop you; cones don't. */
export const isSolid = (k: PropKind) => k === 'bale' || k === 'barrel' || k === 'boulder' || k === 'rock';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lays out a track's props, sorted by `s`. */
export function placeProps(t: Track): Prop[] {
  if (t.def.climb) return placeRockfall(t);
  const rng = mulberry(t.def.seed * 31 + 7);
  const props: Prop[] = [];
  const loc = newLoc();
  const add = (kind: PropKind, s: number, d: number) => {
    const p = pointAt(t, s, d);
    locate(t, p.x, p.z, p.i, loc);
    props.push({ kind, s, d, x: p.x, y: roadY(t, loc), z: p.z, yaw: Math.atan2(-p.tx, -p.tz), r: PROP_RADIUS[kind] });
  };
  const curvMax = (s0: number, s1: number) => {
    let k = 0;
    for (let s = s0; s <= s1; s += SAMPLE) k = Math.max(k, Math.abs(t.curv[Math.min(t.n - 1, Math.round(s / SAMPLE))]));
    return k;
  };
  // Keep clear of the grid, the finish, jumps, bridges, tunnels and boost pads.
  const busy = (s0: number, s1: number) =>
    s0 < t.startS + 160 ||
    s1 > t.finishS - 160 ||
    t.crests.some((c) => s1 > c.s - c.len - 40 && s0 < c.s + c.len + 60) ||
    t.spans.some((sp) => sp.kind !== 'gravel' && s1 > sp.s0 - 30 && s0 < sp.s1 + 30) ||
    t.cuts.some((c) => [c.s0, c.s1].some((e) => s1 > e - 40 && s0 < e + 40)) ||
    t.boosts.some((b) => s1 > b.s - 40 && s0 < b.s + b.len + 40);
  // With traffic on the road there's enough to dodge.
  if (t.def.traffic) return props;
  if (t.def.obstacles) {
    obstacleCourse(t, rng, add, busy, curvMax);
    return props.sort((a, b) => a.s - b.s);
  }
  let s = t.startS + 400;
  let k = 0;
  while (s < t.finishS - 200) {
    if (k % 4 === 1) {
      // An open straight: a launch ramp stood here until 2026-11-10. The stretch (and the two random draws the ramp
      // took) is kept, so every bale, barrel and cone stays exactly where it was.
      if (busy(s, s + 180) || curvMax(s, s + 170) > 1 / 200) {
        s += 30;
        continue;
      }
      rng();
      s += 420 + rng() * 160;
    } else {
      // Something to drive round (or through), never blocking the whole road.
      if (busy(s, s + 40) || curvMax(s, s + 40) > 1 / 90) {
        s += 30;
        continue;
      }
      const side = rng() < 0.5 ? -1 : 1;
      const pick = rng();
      if (pick < 0.35) for (let i = 0; i < 3; i++) add('bale', s + i * 1.7, side * (t.half - 1));
      else if (pick < 0.65) {
        add('barrel', s, side * (t.half - 0.8));
        add('barrel', s + 1.2, side * (t.half - 1.9));
        add('barrel', s + 2.2, side * (t.half - 0.9));
      } else for (let i = 0; i < 5; i++) add('cone', s + i * 7, (i % 2 ? 1 : -1) * 1.6);
      s += 420 + rng() * 240;
    }
    k++;
  }
  props.sort((a, b) => a.s - b.s);
  return props;
}

/** An obstacle course's spacing: something on the road every `gap` to `gap + spread` metres (m). */
export const COURSE = { gap: 110, spread: 90, slalom: 26 };

/**
 * An obstacle course (TrackDef.obstacles): the same bales, barrels and cones, but every 110-200 m instead of every
 * 400-700, and two more layouts to weave through: a slalom (bales on alternate edges, COURSE.slalom m apart) and a
 * gate (barrels on both edges, the middle open). Like every other layout, never across the whole road: there's
 * always at least the middle 4 m, or the far side of the road, clear.
 */
function obstacleCourse(
  t: Track, rng: () => number, add: (kind: PropKind, s: number, d: number) => void,
  busy: (s0: number, s1: number) => boolean, curvMax: (s0: number, s1: number) => number,
): void {
  let s = t.startS + 260;
  while (s < t.finishS - 200) {
    if (busy(s, s + 80) || curvMax(s, s + 80) > 1 / 90) {
      s += 20;
      continue;
    }
    const side = rng() < 0.5 ? -1 : 1;
    const pick = rng();
    if (pick < 0.22) for (let i = 0; i < 3; i++) add('bale', s + i * 1.7, side * (t.half - 1));
    else if (pick < 0.42) {
      add('barrel', s, side * (t.half - 0.8));
      add('barrel', s + 1.2, side * (t.half - 1.9));
      add('barrel', s + 2.2, side * (t.half - 0.9));
    } else if (pick < 0.62) for (let i = 0; i < 5; i++) add('cone', s + i * 7, (i % 2 ? 1 : -1) * 1.6);
    else if (pick < 0.84)
      // A slalom: bales on one edge, then the other, then back.
      for (let i = 0; i < 3; i++) {
        const e = (i % 2 ? -side : side) * (t.half - 1.2);
        add('bale', s + i * COURSE.slalom, e);
        add('bale', s + i * COURSE.slalom + 1.7, e);
      }
    else
      // A gate: barrels in from both edges, the middle open.
      for (const e of [-1, 1]) {
        add('barrel', s, e * (t.half - 0.7));
        add('barrel', s + 0.4, e * (t.half - 1.7));
      }
    s += COURSE.gap + rng() * COURSE.spread;
  }
}

/** The narrowest the road gets between a fallen boulder or rock and the far edge of the asphalt (m). */
export const ROCKFALL_GAP = 5.2;

/**
 * A hill climb's rockfall: every 60-130 m a boulder (1.4-2.1 m) bitten into one edge of the road, or a scatter
 * of two or three rocks, always leaving ROCKFALL_GAP of clear tarmac. Kept off the grid, the finish, jumps and
 * the tightest hairpins (a boulder on the apex of a 20 m hairpin is a wall, not a challenge).
 */
function placeRockfall(t: Track): Prop[] {
  const rng = mulberry(t.def.seed * 53 + 11);
  const props: Prop[] = [];
  const loc = newLoc();
  const add = (kind: PropKind, s: number, d: number, r: number) => {
    const p = pointAt(t, s, d);
    locate(t, p.x, p.z, p.i, loc);
    props.push({ kind, s, d, x: p.x, y: roadY(t, loc), z: p.z, yaw: rng() * Math.PI * 2, r });
  };
  const tight = (s0: number, s1: number) => {
    for (let s = s0; s <= s1; s += SAMPLE) if (Math.abs(t.curv[Math.min(t.n - 1, Math.round(s / SAMPLE))]) > 1 / 32) return true;
    return false;
  };
  const busy = (s0: number, s1: number) =>
    s0 < t.startS + 140 || s1 > t.finishS - 120 || tight(s0 - 20, s1 + 20) || t.crests.some((c) => s1 > c.s - c.len - 30 && s0 < c.s + c.len + 50);
  let s = t.startS + 160;
  let side = rng() < 0.5 ? -1 : 1;
  while (s < t.finishS - 120) {
    if (busy(s, s + 6)) {
      s += 20;
      continue;
    }
    // Mostly alternate sides, so you weave up the hill.
    if (rng() < 0.75) side = -side;
    // Never nearer the far edge than this: ROCKFALL_GAP of clear tarmac between a stone of radius r and it.
    const most = (r: number) => r - t.half + ROCKFALL_GAP;
    if (rng() < 0.6) {
      const r = 1.4 + rng() * 0.7;
      // Its centre near the edge, some pushed further out into the lane.
      add('boulder', s, side * Math.max(most(r), t.half - r * (0.3 + rng() * 0.7)), r);
      // Often a stone broken off it, on the verge side.
      if (rng() < 0.5) {
        const rr = 0.45 + rng() * 0.2;
        add('rock', s + r + 1 + rng() * 2, side * Math.max(most(rr), t.half - 0.3), rr);
      }
    } else {
      const n = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const r = 0.45 + rng() * 0.35;
        add('rock', s + i * (2.2 + rng() * 2.5), side * Math.max(most(r), t.half - r * 0.3 - rng() * 1.8), r);
      }
    }
    s += 60 + rng() * 70;
  }
  props.sort((a, b) => a.s - b.s);
  return props;
}

/** Index of the first prop at or past distance `s` (props are sorted). */
export function firstPropFrom(props: Prop[], s: number): number {
  let lo = 0;
  let hi = props.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (props[m].s < s) lo = m + 1;
    else hi = m;
  }
  return lo;
}
