// Record ghosts: the run that set a track's all-time record, kept so a lobby can race it. A run is the car's pose
// sampled a few times a second from GO to the line; the race room records online runs itself from the poses racers
// send (raceroom.ts / race.ts), solo runs come with the finish (like solo times, client-reported). Only the record
// holder's run is kept (`gh:<track>`, kanjo/server/recordStore.ts). Played back by kanjo/client/ghostcar.ts.
//
// Encoding (`d`), GHOST.stride ints per sample:
//   dt   centiseconds since the previous sample (the first: since GO)
//   x y z  centimetres, as a change from the previous sample (the first: absolute)
//   qx qy qz qw  the car's orientation × 1000
// Small ints keep a 3-minute run around 25 KB of JSON.

import { decodeCar } from './cars.ts';
import { cleanRiderCode } from './rider.ts';

export const GHOST = {
  /** Seconds between samples (at least). */
  every: 0.25,
  /** Ints per sample. */
  stride: 8,
  /** The most samples a run keeps: RACE.maxSeconds at `every`. Worst case ~110 KB of JSON, under a stored value's 128 KiB. */
  maxSamples: 2400,
} as const;

/** A run as recorded: the car and driver it was set in, and its samples. */
export interface GhostTape {
  car: string;
  rider: string;
  d: number[];
}

/** A track's record ghost: whose run it is, its time, and the tape. */
export interface GhostRun extends GhostTape {
  name: string;
  time: number;
}

/** Records one car's run from poses (any rate); keeps one every GHOST.every seconds. */
export class GhostRecorder {
  readonly d: number[] = [];
  private lastT = -1;
  private last: [number, number, number] = [0, 0, 0];
  private lastCs = 0;

  /** `t`: seconds since GO. */
  add(t: number, p: readonly [number, number, number] | { x: number; y: number; z: number }, q: readonly [number, number, number, number] | { x: number; y: number; z: number; w: number }) {
    if (!(t >= 0) || (this.lastT >= 0 && t - this.lastT < GHOST.every - 1e-6) || this.d.length >= GHOST.maxSamples * GHOST.stride) return;
    const [px, py, pz] = Array.isArray(p) ? p : [(p as { x: number }).x, (p as { y: number }).y, (p as { z: number }).z];
    const [qx, qy, qz, qw] = Array.isArray(q) ? q : [(q as { x: number }).x, (q as { y: number }).y, (q as { z: number }).z, (q as { w: number }).w];
    const cs = Math.round(t * 100);
    const cm = [Math.round(px * 100), Math.round(py * 100), Math.round(pz * 100)] as [number, number, number];
    const first = this.lastT < 0;
    this.d.push(cs - (first ? 0 : this.lastCs), cm[0] - (first ? 0 : this.last[0]), cm[1] - (first ? 0 : this.last[1]), cm[2] - (first ? 0 : this.last[2]), Math.round(qx * 1000), Math.round(qy * 1000), Math.round(qz * 1000), Math.round(qw * 1000));
    this.lastT = t;
    this.lastCs = cs;
    this.last = cm;
  }

  get samples() {
    return this.d.length / GHOST.stride;
  }
}

const isInt = (x: unknown, lim: number): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= lim;

/**
 * A tape as sent or stored, or null if it isn't a plausible run of `time` seconds: whole samples of small ints,
 * time moving forward, no jump faster than any car, and its last sample near the finish time.
 */
export function cleanTape(x: unknown, time: number): GhostTape | null {
  if (!x || typeof x !== 'object') return null;
  const t = x as Partial<GhostTape>;
  const d = t.d;
  if (!Array.isArray(d) || d.length < GHOST.stride * 2 || d.length % GHOST.stride || d.length > GHOST.maxSamples * GHOST.stride) return null;
  if (typeof t.car !== 'string' || !decodeCar(t.car)) return null;
  let cs = 0;
  for (let i = 0; i < d.length; i += GHOST.stride) {
    const first = i === 0;
    if (!isInt(d[i], 60_000) || d[i] < (first ? 0 : 1)) return null;
    for (let k = 1; k <= 3; k++) if (!isInt(d[i + k], first ? 1e7 : 2e5)) return null;
    for (let k = 4; k < 8; k++) if (!isInt(d[i + k], 1001)) return null;
    // 200 m/s is quicker than anything on four wheels: a bigger step is a teleport.
    if (!first && Math.hypot(d[i + 1], d[i + 2], d[i + 3]) > 200 * d[i] + 500) return null;
    cs += d[i];
  }
  if (Math.abs(cs / 100 - time) > 5) return null;
  return { car: t.car, rider: cleanRiderCode(t.rider), d: d.slice() };
}

/** A stored record ghost, or null. */
export function cleanRun(x: unknown): GhostRun | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Partial<GhostRun>;
  if (typeof r.name !== 'string' || !r.name || typeof r.time !== 'number' || !Number.isFinite(r.time)) return null;
  const tape = cleanTape(r, r.time);
  return tape && { name: r.name, time: r.time, ...tape };
}

/** A tape unpacked for playback: sample times (s), positions (m) and orientations. */
export interface Track3 {
  t: Float64Array;
  p: Float64Array;
  q: Float64Array;
}

export function unpack(d: readonly number[]): Track3 {
  const n = d.length / GHOST.stride;
  const t = new Float64Array(n);
  const p = new Float64Array(n * 3);
  const q = new Float64Array(n * 4);
  let cs = 0;
  const cm = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * GHOST.stride;
    cs += d[o];
    t[i] = cs / 100;
    for (let k = 0; k < 3; k++) p[i * 3 + k] = (cm[k] += d[o + 1 + k]) / 100;
    const [x, y, z, w] = [d[o + 4], d[o + 5], d[o + 6], d[o + 7]];
    const len = Math.hypot(x, y, z, w) || 1;
    q[i * 4] = x / len;
    q[i * 4 + 1] = y / len;
    q[i * 4 + 2] = z / len;
    q[i * 4 + 3] = w / len;
  }
  return { t, p, q };
}

/**
 * The ghost's pose `t` seconds after GO: position on a Catmull-Rom curve through the samples, orientation slerped,
 * velocity (m/s) from the curve. Before the first sample it waits there; after the last it stays parked.
 */
export function poseAt(k: Track3, t: number, out: { p: number[]; q: number[]; v: number[] }, hint = 0): number {
  const n = k.t.length;
  let i = Math.max(0, Math.min(hint, n - 2));
  while (i > 0 && k.t[i] > t) i--;
  while (i < n - 2 && k.t[i + 1] <= t) i++;
  const t0 = k.t[i];
  const t1 = k.t[i + 1];
  const u = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-3, t1 - t0)));
  const a = Math.max(0, i - 1);
  const c = i + 1;
  const e = Math.min(n - 1, i + 2);
  const span = Math.max(1e-3, t1 - t0);
  for (let j = 0; j < 3; j++) {
    const p1 = k.p[i * 3 + j];
    const p2 = k.p[c * 3 + j];
    // At the ends, carry straight on rather than easing in and out.
    const p0 = a === i ? 2 * p1 - p2 : k.p[a * 3 + j];
    const p3 = e === c ? 2 * p2 - p1 : k.p[e * 3 + j];
    // Uniform Catmull-Rom and its derivative.
    const u2 = u * u;
    const u3 = u2 * u;
    out.p[j] = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
    const still = t <= t0 && i === 0 ? 0 : t >= t1 && i === n - 2 ? 0 : 1;
    out.v[j] = (still * 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (3 * p1 - p0 - 3 * p2 + p3) * u2)) / span;
  }
  // Slerp, the short way round.
  let [ax, ay, az, aw] = [k.q[i * 4], k.q[i * 4 + 1], k.q[i * 4 + 2], k.q[i * 4 + 3]];
  let [bx, by, bz, bw] = [k.q[c * 4], k.q[c * 4 + 1], k.q[c * 4 + 2], k.q[c * 4 + 3]];
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    dot = -dot;
  }
  let wa = 1 - u;
  let wb = u;
  if (dot < 0.9995) {
    const th = Math.acos(Math.min(1, dot));
    const s = Math.sin(th);
    wa = Math.sin((1 - u) * th) / s;
    wb = Math.sin(u * th) / s;
  }
  [ax, ay, az, aw] = [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
  const len = Math.hypot(ax, ay, az, aw) || 1;
  out.q[0] = ax / len;
  out.q[1] = ay / len;
  out.q[2] = az / len;
  out.q[3] = aw / len;
  return i;
}
