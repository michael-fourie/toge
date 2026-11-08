// Rainbow boost pads: short strips painted on the road that kick you forward when you drive over them. Each pad
// covers only part of the road, and there are only a few per track, on the exits of corners that open onto a
// straight: take the corner on a line that runs out over the pad and you leave it faster; miss it and you don't.
// Placed from the track's shape alone, so every racer gets the same pads with nothing on the wire.

import { SAMPLE, type Track } from './track.ts';
import type { Car } from './vehicle.ts';

export interface BoostPad {
  /** Where the pad starts along the road (m, the distance raced: a circuit's pads repeat every lap). */
  s: number;
  /** Its centre's offset across the road (+ = right) and its size (m). */
  d: number;
  len: number;
  w: number;
}

export const BOOST = {
  /** A pad's length along the road and width across it (m): a lane's worth, never the whole road. */
  len: 7,
  w: 2.6,
  /** The kick: this long (s) at this much push (m/s^2). A purple drift's mini-turbo is 1.6 s at 9. */
  seconds: 1.1,
  accel: 11,
  /**
   * What counts as a corner opening onto a straight, strictest first: a corner is curvature past `corner` (1/m) for
   * at least `cornerLen` m, and its straight at least `straight` m with no bend tighter than `straightCurv`. Twisty
   * passes and gentle highways only find their pads in the looser tiers.
   */
  tiers: [
    { corner: 1 / 160, straight: 140, straightCurv: 1 / 450 },
    { corner: 1 / 300, straight: 100, straightCurv: 1 / 250 },
    { corner: 1 / 900, straight: 70, straightCurv: 1 / 160 },
    { corner: 1 / 900, straight: 45, straightCurv: 1 / 90 },
  ],
  cornerLen: 16,
  /** Pads per lap (or per pass): the fewest worth looking for and the most, and the least road between two. */
  fewest: 2,
  /** The pad starts this far past the end of the corner, on its outside where the line runs out. */
  after: 14,
  most: 3,
  gap: 420,
};

/** Every pad for a track, sorted by `s`. `busy(s0, s1)`: stretches to keep clear (the grid, jumps, tunnels...). */
export function placeBoosts(t: Track, busy: (s0: number, s1: number) => boolean): BoostPad[] {
  const lapN = t.lap || t.n;
  const lapLen = t.lap ? t.lap * SAMPLE : 0;
  const k = (i: number) => t.curv[Math.min(t.n - 1, i)];
  const first = t.lap ? 0 : t.startS;
  const last = t.lap ? lapLen : t.finishS;
  const minLen = Math.round(BOOST.cornerLen / SAMPLE);
  const picked: { s: number; d: number }[] = [];
  for (const tier of BOOST.tiers) {
    if (picked.length >= BOOST.fewest) break;
    // Candidates: the end of every corner that opens onto a straight, scored by how long the straight is.
    const found: { s: number; d: number; score: number }[] = [];
    let run = 0;
    let sign = 0;
    for (let i = 0; i < lapN; i++) {
      const c = k(i);
      const turning = Math.abs(c) > tier.corner;
      if (turning && (run === 0 || Math.sign(c) === sign)) {
        run++;
        sign = Math.sign(c);
        continue;
      }
      if (run >= minLen) {
        const s = t.s[i] + BOOST.after;
        let j = i + Math.round(BOOST.after / SAMPLE);
        while (j < t.n - 1 && Math.abs(k(j)) < tier.straightCurv && t.s[j] - s < 600) j++;
        const straight = t.s[Math.min(t.n - 1, j)] - s;
        // The outside of the corner, where the line runs out: a right-hander's is on the left.
        if (straight >= tier.straight) found.push({ s, d: -sign * (t.half - BOOST.w / 2 - 0.6), score: straight + run * SAMPLE * 0.5 });
      }
      run = turning ? 1 : 0;
      sign = turning ? Math.sign(c) : 0;
    }
    // The best few, spread out.
    found.sort((a, b) => b.score - a.score);
    for (const f of found) {
      if (picked.length >= BOOST.most) break;
      if (f.s < first || f.s + BOOST.len > last) continue;
      const far = picked.every((p) => {
        const ds = Math.abs(p.s - f.s);
        return Math.min(ds, lapLen ? lapLen - ds : Infinity) >= BOOST.gap;
      });
      if (far) picked.push(f);
    }
  }
  // A circuit's lap repeats: so do its pads, every lap the race runs.
  const pads: BoostPad[] = [];
  const laps = t.lap ? Math.ceil(t.finishS / lapLen) + 1 : 1;
  for (let l = 0; l < laps; l++)
    for (const p of picked) {
      const s = p.s + l * lapLen;
      if (s + BOOST.len > t.finishS + 20 || s < t.startS + 60 || busy(s - 10, s + BOOST.len + 10)) continue;
      pads.push({ s, d: p.d, len: BOOST.len, w: BOOST.w });
    }
  return pads.sort((a, b) => a.s - b.s);
}

/** Whether a car at (along `s`, across `d`) is on a pad. */
export function onBoostPad(pads: BoostPad[], s: number, d: number): boolean {
  for (const p of pads) if (s >= p.s && s <= p.s + p.len && Math.abs(d - p.d) <= p.w / 2) return true;
  return false;
}

/**
 * Kicks `car` if it's on a pad with a wheel on the road: at least BOOST.seconds of boost at BOOST.accel (a
 * stronger boost already running keeps its push). True when the kick is fresh (for the sound and rumble).
 */
export function padKick(car: Car, pads: BoostPad[]): boolean {
  if (!pads.length || !car.wheels.some((w) => w.contact) || !onBoostPad(pads, car.s, car.d)) return false;
  const fresh = car.boost < BOOST.seconds - 0.25;
  car.boostPower = car.boost > 0 ? Math.max(car.boostPower, BOOST.accel) : BOOST.accel;
  car.boost = Math.max(car.boost, BOOST.seconds);
  return fresh;
}
