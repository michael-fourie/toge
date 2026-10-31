// The house's vices, pure: rolling, lighting and smoking a joint drag by drag, picking up a bong, packing its bowl
// and ripping it, a line off the plate in the living room, the mystery pill, and what each does to you and for how
// long. It all happens on your own screen (the referee doesn't care); others see what's in your hand, the smoke you
// blow out, and your face. Cartoon effects, cartoon timings.

export type Trip = 'rainbow' | 'tiny' | 'giant' | 'wobbly';
const TRIPS: Trip[] = ['rainbow', 'tiny', 'giant', 'wobbly'];

export const VIBES = {
  /** A joint burns down over this many seconds of drags. */
  jointBurn: 7,
  /** Seconds of high per second of drag; drags past `dragCough` end in a cough, and stop at `dragMax`. */
  dragHigh: 9,
  dragCough: 1.8,
  dragMax: 2.6,
  /** Flicking the lighter till the joint catches. */
  lightTime: 0.9,
  /** Packing the bowl (held). */
  packHold: 2,
  /** Seconds to fill the chamber; a full one is worth `ripHigh` seconds, and much past full you cough it all up. */
  ripFill: 2.4,
  ripHigh: 80,
  ripCough: 0.75,
  ripOver: 1.15,
  /** How long being high can stack to. */
  highCap: 150,
  /** A line: held, then wired, then a comedown. */
  lineHold: 1.5,
  wired: 45,
  comedown: 15,
  pill: 60,
  /** A coughing fit lasts this long (scaled by how big the hit was). */
  cough: 3,
};

type Joint = 'none' | 'rolled' | 'lit';

/** Your state, on your screen. Times are seconds of the night's clock (roam). */
export interface Vibe {
  joint: Joint;
  /** How much joint is left (1 a fresh one, 0 a roach). */
  burn: number;
  /** The drag you're taking right now (seconds), or the bong chamber's fill (0..ripOver). */
  drag: number;
  fill: number;
  /** The bong in your hands (its spot id), or null. */
  bong: string | null;
  /** Bowls you've packed (bong spot ids): each one's good for one rip. */
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

export const newVibe = (): Vibe => ({
  joint: 'none',
  burn: 0,
  drag: 0,
  fill: 0,
  bong: null,
  packed: [],
  highUntil: 0,
  level: 0,
  wiredUntil: 0,
  comedownUntil: 0,
  trip: null,
  tripUntil: 0,
  coughUntil: 0,
});

function getHigh(v: Vibe, now: number, secs: number, level: number) {
  v.level = now < v.highUntil ? Math.max(v.level, level) : level;
  v.highUntil = Math.min(Math.max(v.highUntil, now) + secs, now + VIBES.highCap);
}

/** What breathing out gave you: how big the cloud is (0..1), whether you cough, whether the joint's finished. */
export interface Exhale {
  size: number;
  cough: boolean;
  cashed: boolean;
}

/** Finished rolling: one joint in hand (only one at a time). */
export function rolled(v: Vibe): boolean {
  if (v.joint !== 'none') return false;
  v.joint = 'rolled';
  v.burn = 1;
  return true;
}

export function light(v: Vibe): boolean {
  if (v.joint !== 'rolled' || v.bong) return false;
  v.joint = 'lit';
  return true;
}

/**
 * A drag on the lit joint, held for `dt` more: it burns down while you pull. Returns false once you can't take any
 * more (out of joint, or out of breath): breathe out.
 */
export function drag(v: Vibe, dt: number): boolean {
  if (v.joint !== 'lit' || v.burn <= 0 || v.drag >= VIBES.dragMax) return false;
  v.drag = Math.min(VIBES.dragMax, v.drag + dt);
  v.burn = Math.max(0, v.burn - dt / VIBES.jointBurn);
  return true;
}

/** Breathing out a drag: high by how long you held it; the last of the joint cashes it. */
export function exhaleJoint(v: Vibe, now: number): Exhale {
  const d = v.drag;
  v.drag = 0;
  if (d > 0.15) getHigh(v, now, d * VIBES.dragHigh, 1);
  const cough = d > VIBES.dragCough;
  if (cough) v.coughUntil = now + VIBES.cough * 0.6;
  const cashed = v.joint === 'lit' && v.burn <= 0;
  if (cashed) v.joint = 'none';
  return { size: Math.min(1, d / VIBES.dragMax + 0.2), cough, cashed };
}

/** Picking a bong up (one at a time, and not with a lit joint in your other hand). */
export function pickUp(v: Vibe, bong: string): boolean {
  if (v.bong || v.joint === 'lit') return false;
  v.bong = bong;
  v.fill = 0;
  return true;
}

/** Putting it back down (packed bowls stay packed). */
export function putDown(v: Vibe) {
  v.bong = null;
  v.fill = 0;
}

export function pack(v: Vibe): boolean {
  if (!v.bong || v.packed.includes(v.bong)) return false;
  v.packed.push(v.bong);
  return true;
}

export const packed = (v: Vibe) => !!v.bong && v.packed.includes(v.bong);

/** Lit and pulling: the chamber fills. Returns false once it's overfull (you have to clear it, coughing). */
export function ripDraw(v: Vibe, dt: number): boolean {
  if (!packed(v)) return false;
  v.fill = Math.min(VIBES.ripOver, v.fill + dt / VIBES.ripFill);
  return v.fill < VIBES.ripOver;
}

/** Clearing the chamber: high by how full it was (a bong hits harder), the bowl's cashed, and a big one makes you cough. */
export function clearRip(v: Vibe, now: number): Exhale {
  const f = v.fill;
  v.fill = 0;
  if (!packed(v) || f < 0.08) return { size: 0, cough: false, cashed: false };
  v.packed = v.packed.filter((b) => b !== v.bong);
  getHigh(v, now, VIBES.ripHigh * Math.min(1, f), 2);
  const cough = f > VIBES.ripCough;
  if (cough) v.coughUntil = now + VIBES.cough * Math.min(1.3, f);
  return { size: Math.min(1, f), cough, cashed: true };
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

/** What's in your hand, for your pose: 0 nothing, 1 a joint, 2 a lit joint, 3 + n the n-th bong. */
export function heldCode(v: Vibe, bongs: readonly string[]): number {
  if (v.bong) return 3 + Math.max(0, bongs.indexOf(v.bong));
  return v.joint === 'lit' ? 2 : v.joint === 'rolled' ? 1 : 0;
}
