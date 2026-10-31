// The house's vices, pure: rolling, lighting and smoking a joint, packing a bowl and ripping a bong, a line off the
// plate in the living room, the mystery pill, and what each does to you and for how long. It all happens on your own
// screen (the referee doesn't care); others just see the smoke and your face. Cartoon effects, cartoon timings.

export type Trip = 'rainbow' | 'tiny' | 'giant' | 'wobbly';
const TRIPS: Trip[] = ['rainbow', 'tiny', 'giant', 'wobbly'];

export const VIBES = {
  /** A joint: three puffs, each held this long, then high for this long (stacks, up to a cap). */
  puffs: 3,
  puffHold: 1.2,
  jointHigh: 60,
  /** A bong rip: packing and ripping are held; it hits harder. */
  packHold: 2,
  ripHold: 2.5,
  bongHigh: 75,
  /** How long being high can stack to. */
  highCap: 150,
  /** A line: held, then wired, then a comedown. */
  lineHold: 1.5,
  wired: 45,
  comedown: 15,
  pill: 60,
  /** Ripping a bong sets off a coughing fit. */
  cough: 3,
};

type Joint = 'none' | 'rolled' | 'lit';

/** Your state, on your screen. Times are seconds of the night's clock (roam). */
export interface Vibe {
  joint: Joint;
  puffsLeft: number;
  /** Packed bongs (spot ids): each one's good for one rip. */
  packed: string[];
  highUntil: number;
  /** 1 a joint, 2 a bong: how hazy it gets. */
  level: number;
  wiredUntil: number;
  comedownUntil: number;
  trip: Trip | null;
  tripUntil: number;
  coughUntil: number;
}

export const newVibe = (): Vibe => ({ joint: 'none', puffsLeft: 0, packed: [], highUntil: 0, level: 0, wiredUntil: 0, comedownUntil: 0, trip: null, tripUntil: 0, coughUntil: 0 });

function getHigh(v: Vibe, now: number, secs: number, level: number) {
  v.level = now < v.highUntil ? Math.max(v.level, level) : level;
  v.highUntil = Math.min(Math.max(v.highUntil, now) + secs, now + VIBES.highCap);
}

/** Finished rolling: one joint in hand (only one at a time). */
export function rolled(v: Vibe): boolean {
  if (v.joint !== 'none') return false;
  v.joint = 'rolled';
  v.puffsLeft = VIBES.puffs;
  return true;
}

export function light(v: Vibe): boolean {
  if (v.joint !== 'rolled') return false;
  v.joint = 'lit';
  return true;
}

/** One puff off the lit joint; the last one finishes it, and you're high. */
export function puff(v: Vibe, now: number): boolean {
  if (v.joint !== 'lit' || v.puffsLeft <= 0) return false;
  v.puffsLeft--;
  if (v.puffsLeft === 0) {
    v.joint = 'none';
    getHigh(v, now, VIBES.jointHigh, 1);
  }
  return true;
}

export function pack(v: Vibe, bong: string): boolean {
  if (v.packed.includes(bong)) return false;
  v.packed.push(bong);
  return true;
}

/** A rip off a packed bong: high (harder), and a coughing fit. */
export function rip(v: Vibe, bong: string, now: number): boolean {
  if (!v.packed.includes(bong)) return false;
  v.packed = v.packed.filter((b) => b !== bong);
  getHigh(v, now, VIBES.bongHigh, 2);
  v.coughUntil = now + VIBES.cough;
  return true;
}

/** A line: wired now, a comedown after. Another line pushes both back. */
export function line(v: Vibe, now: number) {
  v.wiredUntil = Math.max(v.wiredUntil, now) + VIBES.wired;
  v.comedownUntil = v.wiredUntil + VIBES.comedown;
}

/** The mystery pill: one trip, picked with `rand` (0..1). */
export function pill(v: Vibe, now: number, rand: number): Trip {
  v.trip = TRIPS[Math.min(TRIPS.length - 1, Math.floor(rand * TRIPS.length))];
  v.tripUntil = now + VIBES.pill;
  return v.trip;
}

export const high = (v: Vibe, now: number) => now < v.highUntil;
export const wired = (v: Vibe, now: number) => now < v.wiredUntil;
export const comingDown = (v: Vibe, now: number) => !wired(v, now) && now < v.comedownUntil;
export const tripping = (v: Vibe, now: number): Trip | null => (v.trip && now < v.tripUntil ? v.trip : null);

/** How fast you walk with all of it going on. */
export function speedOf(v: Vibe, now: number): number {
  let k = 1;
  if (high(v, now)) k *= v.level > 1 ? 0.8 : 0.88;
  if (wired(v, now)) k *= 1.15;
  if (comingDown(v, now)) k *= 0.85;
  const t = tripping(v, now);
  if (t === 'giant') k *= 0.85;
  if (t === 'tiny') k *= 1.1;
  return k;
}

/** Eye height change (m) from a trip. */
export const eyeShift = (v: Vibe, now: number) => ({ tiny: -0.75, giant: 0.7, rainbow: 0, wobbly: 0 })[tripping(v, now) ?? 'rainbow'];

/** Clearing everything (taken out: ghosts don't get high). */
export function sober(v: Vibe) {
  Object.assign(v, newVibe());
}
