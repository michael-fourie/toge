// Things on the road: mystery item boxes, launch ramps, hay bales and barrels to steer round, cone chicanes
// to smash through. Placed from the track's seed, so every racer gets the same layout.

import { type Track, SAMPLE, pointAt, roadY, newLoc, locate } from './track.ts';

export type PropKind = 'box' | 'ramp' | 'bale' | 'barrel' | 'cone';

export interface Prop {
  kind: PropKind;
  /** Distance along the road and offset across it (+ = right). */
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Collision radius (boxes, bales, barrels, cones). */
  r: number;
}

/** A launch ramp: a wedge `len` long rising to `h`, `w` wide, starting at `s`, centred at offset `d`. */
export interface Ramp {
  s: number;
  d: number;
  len: number;
  w: number;
  h: number;
}

export const PROP_RADIUS: Record<PropKind, number> = { box: 1.3, ramp: 0, bale: 0.8, barrel: 0.48, cone: 0.28 };
/** Bales and barrels stop you; cones and boxes don't. */
export const isSolid = (k: PropKind) => k === 'bale' || k === 'barrel';
export const RAMP = { len: 5.5, w: 3.2, h: 1.15 };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lays out a track's props (sorted by `s`) and its ramps. */
export function placeProps(t: Track): { props: Prop[]; ramps: Ramp[] } {
  const rng = mulberry(t.def.seed * 31 + 7);
  const props: Prop[] = [];
  const ramps: Ramp[] = [];
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
  // Keep clear of the grid, the finish, jumps, bridges and tunnels.
  const busy = (s0: number, s1: number) =>
    s0 < t.startS + 160 ||
    s1 > t.finishS - 160 ||
    t.crests.some((c) => s1 > c.s - c.len - 40 && s0 < c.s + c.len + 60) ||
    t.spans.some((sp) => sp.kind !== 'gravel' && s1 > sp.s0 - 30 && s0 < sp.s1 + 30) ||
    t.cuts.some((c) => [c.s0, c.s1].some((e) => s1 > e - 40 && s0 < e + 40));
  const lane = t.half - 1.3;
  let s = t.startS + 200;
  let k = 0;
  while (s < t.finishS - 200) {
    const slot = k % 4;
    if (slot === 0 || slot === 2) {
      // A row of mystery boxes right across the road.
      if (busy(s, s + 4)) {
        s += 30;
        continue;
      }
      const n = t.half >= 5 ? 4 : 3;
      for (let i = 0; i < n; i++) add('box', s, -lane + (2 * lane * i) / (n - 1));
      s += 230 + rng() * 90;
    } else if (slot === 3 && k % 8 === 3) {
      // A launch ramp on a straight, with room to land.
      if (busy(s, s + 180) || curvMax(s, s + 170) > 1 / 200) {
        s += 30;
        continue;
      }
      const d = (rng() < 0.5 ? -1 : 1) * (t.half - RAMP.w / 2 - 0.4);
      ramps.push({ s, d, len: RAMP.len, w: RAMP.w, h: RAMP.h });
      s += 220 + rng() * 80;
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
      s += 200 + rng() * 120;
    }
    k++;
  }
  props.sort((a, b) => a.s - b.s);
  return { props, ramps };
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

/** How high a ramp lifts the road at (along `s`, across `d`), or 0. */
export function rampLift(ramps: Ramp[], s: number, d: number): number {
  for (const r of ramps) {
    const u = s - r.s;
    if (u < 0 || u > r.len || Math.abs(d - r.d) > r.w / 2) continue;
    return (r.h * u) / r.len;
  }
  return 0;
}
