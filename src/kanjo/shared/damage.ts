// Physics mode: crash damage. Off by default; the host turns it on for a lobby, or you do for a solo race.
//
// Every knock is measured the way crash investigators measure one: delta-V, how much the car's own velocity
// changed (vehicle.ts records the tick's hardest as `car.crash`, with where it landed and which way it pushed).
// Below DAMAGE.threshold nothing bends (rubbing, kerbs, a nudge at the start). Above it the damage grows faster
// than the knock (a power of the excess), so a 100 km/h nose-first hit on a wall is close to a write-off while
// trading paint at 40 km/h costs a few percent. Each hit dents one zone of the body (front, rear, left, right),
// and the zones change how the car drives: a crushed nose loses power (radiator, intake), a bent corner pulls
// the steering to that side. When the total reaches 1 the car is wrecked: it blows up and respawns a few metres
// back, repaired. Pure and deterministic, so the client runs it for you and the AI, and it's tested.

import type { DriveInput, V3 } from './vehicle.ts';

export const DAMAGE = {
  /** Delta-V (m/s) below which a knock leaves no mark. ~20 km/h. */
  threshold: 5.5,
  /** Damage = scale × (delta-V − threshold) ^ power. Tuned so a ~25 m/s delta-V (a 100 km/h wall, nose first) is ~0.95. */
  scale: 0.0062,
  power: 1.7,
  /** Landing a jump flat: body slam speed (m/s) that starts to hurt, and how much less than a crash it counts. */
  landThreshold: 11,
  landScale: 0.4,
  /** Power left with the nose fully crushed / the tail fully crushed (they combine), and never less than `minPower`. */
  frontPower: 0.45,
  rearPower: 0.15,
  minPower: 0.45,
  /** Steering pull (stick units) with one side fully bent and the other straight. */
  pull: 0.16,
  /** After respawning: seconds the car can't be damaged (so the car behind can't wreck it again on the spot). */
  grace: 2,
  /** How far back down the road a wrecked car comes back (m). */
  respawnBack: 8,
};

export type Zone = 'front' | 'rear' | 'left' | 'right';
export const ZONES: Zone[] = ['front', 'rear', 'left', 'right'];

export interface Damage {
  /** 0 = new, 1 = wrecked. */
  total: number;
  /** How bent each side is (0-1). They add up to more than `total` can: they're for looks and handling. */
  zones: Record<Zone, number>;
  /** Seconds of grace left after a respawn. */
  grace: number;
}

export const newDamage = (): Damage => ({ total: 0, zones: { front: 0, rear: 0, left: 0, right: 0 }, grace: 0 });

export function repair(d: Damage, grace = DAMAGE.grace) {
  d.total = 0;
  for (const z of ZONES) d.zones[z] = 0;
  d.grace = grace;
}

/** How much a knock of `dv` m/s delta-V does (0 below the threshold). */
export function crashDamage(dv: number): number {
  const over = dv - DAMAGE.threshold;
  return over > 0 ? DAMAGE.scale * over ** DAMAGE.power : 0;
}

/** Which side of the car a point in body space (forward is -z, right is +x) is on. */
export function zoneAt(p: V3, halfLength: number, halfWidth: number): Zone {
  // Compare against the body's proportions, so a hit on a front corner counts as the nose unless it's really the flank.
  const fz = p.z / Math.max(0.1, halfLength);
  const fx = p.x / Math.max(0.1, halfWidth);
  if (Math.abs(fz) >= Math.abs(fx) * 0.8) return fz < 0 ? 'front' : 'rear';
  return fx < 0 ? 'left' : 'right';
}

/** What one tick's knock did. */
export interface Hit {
  /** Damage added (0-1). */
  amount: number;
  zone: Zone;
  /** The car is wrecked (total reached 1 on this hit). */
  wrecked: boolean;
}

/**
 * Takes a tick's knock (`dv` delta-V at body-space point `p`) and landing (`land` m/s) into `d`. Returns what it
 * did, or null for nothing. `dt` counts down the grace after a respawn. `soak` scales what knocks do and `landSoak`
 * what landings do (a survival road's, track.ts `survival`; 1 everywhere else).
 */
export function takeHit(d: Damage, dv: number, p: V3, land: number, halfLength: number, halfWidth: number, dt: number, soak = 1, landSoak = 1): Hit | null {
  if (d.grace > 0) {
    d.grace = Math.max(0, d.grace - dt);
    return null;
  }
  if (d.total >= 1) return null;
  let amount = crashDamage(dv) * soak;
  let zone: Zone = amount > 0 ? zoneAt(p, halfLength, halfWidth) : 'front';
  const slam = land - DAMAGE.landThreshold;
  if (slam > 0) {
    const a = DAMAGE.landScale * DAMAGE.scale * slam ** DAMAGE.power * landSoak;
    if (a > amount) zone = p.z > 0 ? 'rear' : 'front';
    amount += a;
  }
  if (amount <= 0) return null;
  d.zones[zone] = Math.min(1, d.zones[zone] + amount * 1.4);
  d.total = Math.min(1, d.total + amount);
  return { amount, zone, wrecked: d.total >= 1 };
}

/** How the damage drives: engine power left (0-1) and steering pull (stick units, + = right). */
export function handling(d: Damage): { power: number; pull: number } {
  const z = d.zones;
  const power = Math.max(DAMAGE.minPower, (1 - (1 - DAMAGE.frontPower) * z.front) * (1 - DAMAGE.rearPower * z.rear));
  return { power, pull: DAMAGE.pull * (z.right - z.left) };
}

/**
 * The input the car actually gets: less engine power with a crushed nose, the wheel pulling to the bent side.
 * The pedal itself stays where the driver put it, so a damaged car at full throttle still shifts like it's
 * at full throttle and doesn't get engine braking for a pedal that's floored.
 */
export function damagedInput(d: Damage, input: DriveInput, out: DriveInput): DriveInput {
  Object.assign(out, input);
  out.power = undefined;
  if (d.total <= 0) return out;
  const h = handling(d);
  out.power = h.power;
  out.steer = Math.max(-1, Math.min(1, input.steer + h.pull));
  return out;
}

/** The zones packed into one number for the wire (4 bits each, front first), and back. */
export function packZones(d: Damage): number {
  return ZONES.reduce((n, z, i) => n | (Math.round(d.zones[z] * 15) << (i * 4)), 0);
}

export function unpackZones(n: number): Record<Zone, number> {
  const out = { front: 0, rear: 0, left: 0, right: 0 };
  ZONES.forEach((z, i) => (out[z] = ((n >> (i * 4)) & 15) / 15));
  return out;
}
