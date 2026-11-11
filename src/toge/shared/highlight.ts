// The winner's Best Moment: after a race, a 5 second replay of the most exciting stretch of the winner's run (flat out,
// a long drift, or a jump), with an overlay. Every client records every car it draws (yours and the CPUs from the
// physics, online racers from their poses) on the race clock, so the replay needs nothing on the wire, and the other
// cars around the winner replay with it. racegame.ts records and plays it; this file is the pure part: the tape,
// scoring a stretch and posing a car at any moment of it.

export const HIGHLIGHT = {
  /** Seconds the replay runs (Michael 2026-11-11: 5 was "too short to see the moment"). */
  seconds: 10,
  /** A window that keeps this share of the best one's score may slide to put the action in the middle of the replay. */
  centre: 0.9,
  /** Samples a second (poses in between are interpolated). */
  hz: 20,
  /** A tape never grows past this (RACE.maxSeconds at `hz`). */
  maxSamples: 600 * 20,
  /** The launch off the grid is never the best moment: windows start at least this long after GO. */
  skip: 2,
  /** Below this a car isn't doing anything worth a replay (m/s). */
  minSpeed: 12,
  /** Speed that scores 1 a sample (m/s, ~180 km/h); score grows with its square. */
  fast: 50,
  /** A slide counts as a drift past this slip angle (rad, ~10°). */
  slip: 0.17,
  /**
   * A drift's score: sin(slip) × speed / driftRef. Flat out is common (every straight) and a drift takes skill, so a
   * real one wins: 35° at 110 km/h scores like 240 km/h flat out, 40° at 130 km/h like 270.
   */
  driftRef: 10,
  /** A sample in the air at speed scores this. */
  air: 1.6,
} as const;

/** Values per sample: t, x y z, qx qy qz qw, speed (m/s), slip (rad, signed), steer (-1..1), flags. */
const STRIDE = 12;

/** Bits of a sample's flags. The drift's spark level (0-3) rides from bit LevelShift. */
export const MomentFlag = { Brake: 1, Drift: 2, Boost: 4, Air: 8, LevelShift: 5 } as const;

export type MomentKind = 'speed' | 'drift' | 'air';

/** What a car did at one moment, as a recorder takes it. */
export interface MomentPose {
  p: { x: number; y: number; z: number };
  q: { x: number; y: number; z: number; w: number };
  /** Velocity (m/s), for speed and slip. */
  v: { x: number; y: number; z: number };
  steer: number;
  flags: number;
}

/** A car's run on the race clock (seconds since GO), sampled HIGHLIGHT.hz times a second. */
export class MomentTape {
  readonly d: number[] = [];
  private next = 0;
  /** When the car crossed the line (race clock), once it has. */
  end: number | null = null;

  /** Takes a sample if one is due at race time `t`. */
  add(t: number, pose: MomentPose) {
    if (!(t >= this.next) || this.d.length >= HIGHLIGHT.maxSamples * STRIDE) return;
    this.next = t + 1 / HIGHLIGHT.hz - 1e-6;
    const { p, q, v } = pose;
    const speed = Math.hypot(v.x, v.y, v.z);
    this.d.push(t, p.x, p.y, p.z, q.x, q.y, q.z, q.w, speed, slipOf(q, v), pose.steer, pose.flags);
  }

  get length() {
    return this.d.length / STRIDE;
  }

  time(i: number) {
    return this.d[i * STRIDE];
  }
  speed(i: number) {
    return this.d[i * STRIDE + 8];
  }
  slip(i: number) {
    return this.d[i * STRIDE + 9];
  }
  flags(i: number) {
    return this.d[i * STRIDE + 11];
  }

  /**
   * The car at race time `t`: position and orientation interpolated between samples (held at the ends), plus the
   * nearer sample's speed, steer and flags. `out` is filled and returned.
   */
  at(t: number, out: PlayPose = newPlayPose()): PlayPose {
    const n = this.length;
    if (!n) return out;
    let i = Math.max(0, Math.min(n - 2, lowerIndex(this.d, n, t)));
    if (n === 1) i = 0;
    const j = Math.min(n - 1, i + 1);
    const t0 = this.time(i);
    const t1 = this.time(j);
    const a = j === i || t1 <= t0 ? 0 : Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const o = i * STRIDE;
    const o2 = j * STRIDE;
    const d = this.d;
    out.x = d[o + 1] + (d[o2 + 1] - d[o + 1]) * a;
    out.y = d[o + 2] + (d[o2 + 2] - d[o + 2]) * a;
    out.z = d[o + 3] + (d[o2 + 3] - d[o + 3]) * a;
    slerp(d, o + 4, o2 + 4, a, out.q);
    const k = a < 0.5 ? o : o2;
    out.speed = d[o + 8] + (d[o2 + 8] - d[o + 8]) * a;
    out.slip = d[k + 9];
    out.steer = d[o + 10] + (d[o2 + 10] - d[o + 10]) * a;
    out.flags = d[k + 11];
    return out;
  }
}

export interface PlayPose {
  x: number;
  y: number;
  z: number;
  /** x, y, z, w */
  q: [number, number, number, number];
  speed: number;
  slip: number;
  steer: number;
  flags: number;
}

export const newPlayPose = (): PlayPose => ({ x: 0, y: 0, z: 0, q: [0, 0, 0, 1], speed: 0, slip: 0, steer: 0, flags: 0 });

/** The first sample at or after `t` (n when there is none). */
function lowerIndex(d: number[], n: number, t: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid * STRIDE] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function slerp(d: number[], a: number, b: number, s: number, out: [number, number, number, number]) {
  let [bx, by, bz, bw] = [d[b], d[b + 1], d[b + 2], d[b + 3]];
  const [ax, ay, az, aw] = [d[a], d[a + 1], d[a + 2], d[a + 3]];
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    dot = -dot;
  }
  // Samples are 50 ms apart, so the angle between them is small: a normalised lerp is as good as a slerp.
  const x = ax + (bx - ax) * s;
  const y = ay + (by - ay) * s;
  const z = az + (bz - az) * s;
  const w = aw + (bw - aw) * s;
  const l = Math.hypot(x, y, z, w) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  out[3] = w / l;
}

/** The angle (rad, + = sliding to the left of the nose) between where the car points and where it's going, on the ground. */
export function slipOf(q: { x: number; y: number; z: number; w: number }, v: { x: number; z: number }): number {
  const sp = Math.hypot(v.x, v.z);
  if (sp < 3) return 0;
  // The nose: (0, 0, -1) rotated by q, flattened.
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const fl = Math.hypot(fx, fz) || 1;
  const dot = (fx * v.x + fz * v.z) / (fl * sp);
  if (dot < 0) return 0; // going backwards: a spin, not a drift
  const cross = (fz * v.x - fx * v.z) / (fl * sp);
  return Math.atan2(cross, dot);
}

/** How exciting one sample is, split by what made it so. */
export function sampleScore(speed: number, slip: number, flags: number): { speed: number; drift: number; air: number } {
  if (speed < HIGHLIGHT.minSpeed) return { speed: 0, drift: 0, air: 0 };
  const s = speed / HIGHLIGHT.fast;
  const a = Math.min(Math.abs(slip), 1.1);
  return {
    speed: s * s,
    drift: a > HIGHLIGHT.slip ? (Math.sin(a) * speed) / HIGHLIGHT.driftRef : 0,
    air: flags & MomentFlag.Air ? HIGHLIGHT.air : 0,
  };
}

export interface Moment {
  /** Race clock at the start of the replay. */
  start: number;
  kind: MomentKind;
  /** The stretch's best: top speed (km/h), and for a drift the widest angle held (degrees). */
  kmh: number;
  angle: number;
}

/**
 * The tape's best HIGHLIGHT.seconds: the window (after HIGHLIGHT.skip, before the finish) with the most excitement
 * summed over its samples, each sample worth its best of speed, drift or air, slid to centre the action. Its kind is
 * whichever of those stands out most in the window. Null for an empty tape.
 */
export function bestMoment(tape: MomentTape): Moment | null {
  const n = tape.length;
  if (n < 2) return null;
  const end = tape.end ?? tape.time(n - 1);
  const first = tape.time(0);
  const span = HIGHLIGHT.seconds;
  // Every sample's score, and running sums for windows.
  const sc: number[] = [];
  const parts: { speed: number; drift: number; air: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = sampleScore(tape.speed(i), tape.slip(i), tape.flags(i));
    parts.push(p);
    sc.push(Math.max(p.speed, p.drift, p.air));
  }
  const lo = Math.min(first + HIGHLIGHT.skip, Math.max(first, end - span));
  const hi = Math.max(lo, end - span);
  let best = -1;
  let bestI = 0;
  let sum = 0;
  let j = 0; // first sample past the window
  for (let i = 0; i < n; i++) {
    const t0 = tape.time(i);
    if (t0 > hi + 1e-6) break;
    if (i > 0) sum -= sc[i - 1];
    while (j < n && tape.time(j) < t0 + span) sum += sc[j++];
    if (t0 >= lo - 1e-6 && sum > best) {
      best = sum;
      bestI = i;
    }
  }
  // Many windows can hold the same action (a 4 s drift fits a 10 s window six ways), and the first of them would open
  // on six seconds of cruising: slide the window so the action, weighted by its score², sits in the middle, as long
  // as that keeps nearly all of the best score.
  const win = (t0: number) => {
    let a = 0;
    for (let i = lowerIndex(tape.d, n, t0) + 1; i < n && tape.time(i) < t0 + span; i++) a += sc[i];
    return a;
  };
  let w = 0;
  let wt = 0;
  for (let i = bestI; i < n && tape.time(i) < tape.time(bestI) + span; i++) {
    w += sc[i] * sc[i];
    wt += sc[i] * sc[i] * tape.time(i);
  }
  if (w > 0) {
    const t0 = Math.max(lo, Math.min(hi, wt / w - span / 2));
    let k = Math.max(0, lowerIndex(tape.d, n, t0) + 1);
    if (k > 0 && (k >= n || tape.time(k) > hi + 1e-6)) k--;
    if (k < n && win(tape.time(k)) >= best * HIGHLIGHT.centre) bestI = k;
  }
  const start = tape.time(bestI);
  // What makes the stretch special: each sample counts for whatever scored it, by how far it stands above the
  // stretch's typical (median) sample, so ten seconds of cruising round a one second jump still reads as the jump.
  const inWin: number[] = [];
  for (let i = bestI; i < n && tape.time(i) < start + span; i++) inWin.push(i);
  const med = inWin.map((i) => sc[i]).sort((x, y) => x - y)[inWin.length >> 1] ?? 0;
  const tot = { speed: 0, drift: 0, air: 0 };
  let kmh = 0;
  let angle = 0;
  for (const i of inWin) {
    const p = parts[i];
    const top: MomentKind = p.drift >= p.speed && p.drift >= p.air ? 'drift' : p.air > p.speed ? 'air' : 'speed';
    tot[top] += Math.max(0, sc[i] - med);
    kmh = Math.max(kmh, tape.speed(i) * 3.6);
    if (tape.speed(i) >= HIGHLIGHT.minSpeed) angle = Math.max(angle, Math.min(Math.abs(tape.slip(i)), 1.1) * (180 / Math.PI));
  }
  const kind: MomentKind = tot.drift > tot.speed && tot.drift >= tot.air ? 'drift' : tot.air > tot.speed ? 'air' : 'speed';
  return { start, kind, kmh: Math.round(kmh), angle: Math.round(angle) };
}

/** The overlay's line for a moment: "Drift · 38° at 132 km/h". */
export function momentLine(m: Moment): string {
  if (m.kind === 'drift') return `Drift · ${m.angle}° at ${m.kmh} km/h`;
  if (m.kind === 'air') return `Airborne · ${m.kmh} km/h`;
  return `Flat out · ${m.kmh} km/h`;
}
