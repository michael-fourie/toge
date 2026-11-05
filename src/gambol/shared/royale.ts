// Battle Royale: everyone drops in with a pistol, finds guns and kit on the ground, and the zone closes in until one
// player is left. Pure rules (the zone, the loot table, what F picks up), run by the server (gambol/server/royale.ts) and
// unit-tested; the client draws the state it is sent and uses findLoot for its prompt.

import type { Vec3 } from '../../shared/math.ts';
import type { V3 } from './protocol.ts';
import { WEAPONS, type WeaponId, gunStats } from './weapons.ts';

export const ROYALE = {
  hp: 100,
  maxShield: 100,
  /** Before the first match: everyone runs about (with respawns) while friends join. Solo, it waits this long... */
  warmupSolo: 40,
  /** ...with company this long, and never less than `joinGrace` after someone joins. */
  warmupCrowd: 20,
  joinGrace: 12,
  /** A gun found on the ground comes with a full mag plus this share of its normal spare ammo. */
  spare: 0.25,
  /** An ammo crate adds this many mags to each gun you carry. */
  ammoMags: 2,
  /** Grenades are found, not refilled: a bundle holds this many, and you carry at most `maxNades`. */
  nadeBundle: 2,
  maxNades: 3,
  /** Onigiri heals this much (up to `hp`); Cloud Tea adds this much shield (up to `maxShield`). */
  heal: 50,
  shield: 50,
  pickupRange: 2.4,
  /** A stab and a blast don't one-shot here: everyone has health. */
  knifeDamage: 55,
  nadeDamage: 80,
  /** How often the server tells a player in the zone their health. */
  zoneTick: 0.5,
} as const;

/**
 * The zone: from the first circle (the whole island) it waits, then shrinks to a smaller circle inside it, and so on.
 * `r` is the radius after that shrink; `dps` is the damage per second outside the circle during that phase.
 */
export const PHASES: readonly { wait: number; shrink: number; r: number; dps: number }[] = [
  { wait: 50, shrink: 35, r: 190, dps: 2 },
  { wait: 40, shrink: 30, r: 120, dps: 4 },
  { wait: 35, shrink: 25, r: 70, dps: 7 },
  { wait: 30, shrink: 20, r: 38, dps: 10 },
  { wait: 25, shrink: 20, r: 16, dps: 14 },
  { wait: 20, shrink: 25, r: 0, dps: 20 },
];

/** The zone as everyone sees it (sent with each snapshot). The plan for later circles stays on the server. */
export interface ZoneState {
  /** Index into PHASES of the shrink in progress or coming up (PHASES.length once it has closed). */
  ph: number;
  /** Seconds left in this wait or shrink. */
  left: number;
  shrinking: boolean;
  /** The circle now. */
  x: number;
  z: number;
  r: number;
  /** The circle it is shrinking (or will shrink) to. */
  nx: number;
  nz: number;
  nr: number;
  /** Damage per second outside it right now. */
  dps: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/**
 * Plans every circle: each one lies inside the one before, at a random spot. The last one closes on a standable spot
 * (one of `ends`, the map's loot spots) so the final fight is on solid ground, not over the void.
 */
export function planZone(start: Circle, ends: readonly Vec3[], rand: () => number = Math.random): Circle[] {
  const out: Circle[] = [];
  let c = start;
  for (const p of PHASES) {
    const room = c.r - p.r; // how far the new centre may sit from the old one and still be inside it
    let next: Circle;
    if (p.r === 0) {
      const ok = ends.filter((e) => Math.hypot(e.x - c.x, e.z - c.z) <= room);
      const e = ok.length ? ok[Math.floor(rand() * ok.length)] : c;
      next = { x: e.x, z: e.z, r: 0 };
    } else {
      // Lean toward the middle of the stuff worth fighting over: pick among end spots in range, then jitter.
      const ok = ends.filter((e) => Math.hypot(e.x - c.x, e.z - c.z) <= room * 0.8);
      const e = ok.length ? ok[Math.floor(rand() * ok.length)] : c;
      next = { x: e.x, z: e.z, r: p.r };
    }
    out.push(next);
    c = next;
  }
  return out;
}

export function newZone(start: Circle, plan: readonly Circle[]): ZoneState {
  return { ph: 0, left: PHASES[0].wait, shrinking: false, x: start.x, z: start.z, r: start.r, nx: plan[0].x, nz: plan[0].z, nr: plan[0].r, dps: PHASES[0].dps };
}

/** Advances the zone by `dt`. While shrinking, the circle slides from where it was to the next one. Mutates `z`. */
export function stepZone(z: ZoneState, plan: readonly Circle[], dt: number) {
  if (z.ph >= PHASES.length) return;
  z.left -= dt;
  const p = PHASES[z.ph];
  if (z.shrinking) {
    // Linear from the previous circle to the next: cover this step's share of what's left.
    const step = z.left <= 0 ? 1 : dt / (z.left + dt);
    z.x += (z.nx - z.x) * step;
    z.z += (z.nz - z.z) * step;
    z.r += (z.nr - z.r) * step;
    if (z.left > 0) return;
    z.x = z.nx;
    z.z = z.nz;
    z.r = z.nr;
    z.ph++;
    z.shrinking = false;
    if (z.ph >= PHASES.length) {
      z.left = 0;
      return;
    }
    const n = plan[z.ph];
    z.nx = n.x;
    z.nz = n.z;
    z.nr = n.r;
    z.left = PHASES[z.ph].wait;
    z.dps = PHASES[z.ph].dps;
  } else if (z.left <= 0) {
    z.shrinking = true;
    z.left += p.shrink;
  }
}

/** Outside the circle (horizontally: the zone is a column to the sky). */
export const outside = (z: ZoneState, p: Vec3) => Math.hypot(p.x - z.x, p.z - z.z) > z.r;

/** How far you are from safety (0 inside). */
export const toSafety = (z: ZoneState, p: Vec3) => Math.max(0, Math.hypot(p.x - z.x, p.z - z.z) - z.r);

// ---------------------------------------------------------------------------
// Loot

type LootKind = 'gun' | 'ammo' | 'nade' | 'heal' | 'shield';

/** One thing lying on the ground. A gun carries its rounds (mag + spare), so a dropped gun keeps what was left in it. */
export interface LootItem {
  id: number;
  k: LootKind;
  p: V3;
  w?: WeaponId;
  n?: number;
}

/** How often each gun turns up (the AWP and the Sunbeam are rare finds). */
const GUN_WEIGHTS: Record<WeaponId, number> = { sparrow: 4, marshal: 10, rattler: 12, warden: 10, bramble: 9, kestrel: 8, hammer: 4, awp: 3, sunbeam: 1.2 };

/** Loot colour by how rare it is: grey, blue, purple, gold. */
export function rarity(it: Pick<LootItem, 'k' | 'w'>): 0 | 1 | 2 | 3 {
  if (it.k !== 'gun') return it.k === 'shield' ? 1 : 0;
  const w = GUN_WEIGHTS[it.w!];
  return w >= 10 ? 0 : w >= 8 ? 1 : w >= 3 ? 2 : 3;
}

const pickWeighted = <T extends string>(weights: Record<T, number>, rand: () => number): T => {
  const keys = Object.keys(weights) as T[];
  let x = rand() * keys.reduce((a, k) => a + weights[k], 0);
  for (const k of keys) if ((x -= weights[k]) < 0) return k;
  return keys[keys.length - 1];
};

/** Rounds that come with a gun found on the ground. */
export const foundRounds = (w: WeaponId) => {
  const s = gunStats(w, false);
  return s.mag + Math.round(s.reserve * ROYALE.spare);
};

/** Rounds an ammo crate adds to a gun. */
export const crateRounds = (w: WeaponId) => WEAPONS[w].mag * ROYALE.ammoMags;

/** Fills every loot spot: one thing each (a gun half the time), and a gun often has an ammo crate beside it. */
export function rollLoot(spots: readonly Vec3[], rand: () => number = Math.random, firstId = 1): LootItem[] {
  const out: LootItem[] = [];
  let id = firstId;
  const at = (p: Vec3, dx = 0): V3 => [Math.round((p.x + dx) * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100];
  for (const s of spots) {
    const k = pickWeighted({ gun: 48, ammo: 18, nade: 12, heal: 13, shield: 9 } as Record<LootKind, number>, rand);
    if (k === 'gun') {
      const w = pickWeighted(GUN_WEIGHTS, rand);
      out.push({ id: id++, k, p: at(s), w, n: foundRounds(w) });
      if (rand() < 0.5) out.push({ id: id++, k: 'ammo', p: at(s, 0.9) });
    } else out.push({ id: id++, k, p: at(s) });
  }
  return out;
}

/** What a player carries, as far as picking things up goes. */
export interface Kit {
  hp: number;
  shield: number;
  nades: number;
  guns: readonly (WeaponId | null)[];
}

/** The loot F would take right now: the nearest in reach, and whether taking it would do anything. */
export interface LootUse {
  item: LootItem;
  ready: boolean;
  text: string;
}

const LOOT_NAME: Record<Exclude<LootKind, 'gun'>, string> = { ammo: 'Ammo crate', nade: 'Grenades', heal: 'Onigiri (+50 hp)', shield: 'Cloud Tea (+50 shield)' };

function lootName(it: Pick<LootItem, 'k' | 'w'>): string {
  return it.k === 'gun' ? WEAPONS[it.w!].name : LOOT_NAME[it.k];
}

export function findLoot(p: Vec3, items: Iterable<LootItem>, kit: Kit): LootUse | null {
  let best: LootItem | null = null;
  let bestD: number = ROYALE.pickupRange;
  for (const it of items) {
    if (Math.abs(it.p[1] - p.y) > 1.6) continue;
    const d = Math.hypot(it.p[0] - p.x, it.p[2] - p.z);
    if (d < bestD) {
      best = it;
      bestD = d;
    }
  }
  if (!best) return null;
  const name = lootName(best);
  const full = (why: string): LootUse => ({ item: best, ready: false, text: `${name}: ${why}` });
  switch (best.k) {
    case 'gun': {
      if (kit.guns.includes(best.w!)) return { item: best, ready: true, text: `take the ammo from the ${name}` };
      const swap = kit.guns.every((g) => g !== null);
      return { item: best, ready: true, text: swap ? `swap for the ${name}` : `pick up the ${name}` };
    }
    case 'ammo':
      return kit.guns.some((g) => g !== null) ? { item: best, ready: true, text: `take the ${name}` } : full('no gun to load');
    case 'nade':
      return kit.nades < ROYALE.maxNades ? { item: best, ready: true, text: `take the ${name}` } : full('your pockets are full');
    case 'heal':
      return kit.hp < ROYALE.hp ? { item: best, ready: true, text: `eat the ${name}` } : full('already full');
    case 'shield':
      return kit.shield < ROYALE.maxShield ? { item: best, ready: true, text: `drink the ${name}` } : full('shield already full');
  }
}
