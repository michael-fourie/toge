// Survival round modifiers: every few rounds the round comes with a twist, announced at its start and shown on the round
// banner. Pure data plus the pick, shared: the server applies the zombie side, each client its own (fog, gravity, heads).

export type ModId = 'rush' | 'double' | 'smog' | 'bighead' | 'moon' | 'tiny';

export interface ModDef {
  name: string;
  blurb: string;
  color: string;
}

export const MODS: Record<ModId, ModDef> = {
  rush: { name: 'Rush Hour', blurb: 'the horde is running late', color: '#ff8a5a' },
  double: { name: 'Double Shift', blurb: 'double points', color: '#ffd45a' },
  smog: { name: 'Smog', blurb: "can't see a thing", color: '#a9b4c2' },
  bighead: { name: 'Big Heads', blurb: 'easy headshots', color: '#ff9ad5' },
  moon: { name: 'Moon Shift', blurb: 'low gravity', color: '#b8c8ff' },
  tiny: { name: 'Shrink Ray', blurb: 'tiny zombies, small targets', color: '#8affc1' },
};

export const MOD_IDS = Object.keys(MODS) as ModId[];

/** Tuning for the modifiers. */
export const MOD = {
  every: 3, // rounds 3, 6, 9... get one
  rushSpeed: 1.35, // Rush Hour: zombie speed
  moonGravity: 0.45, // Moon Shift: players' gravity (movement.ts MoveInput.gravMult)
  bigHead: 2, // Big Heads: head size and hitbox
  tinyScale: 0.6, // Shrink Ray: zombie size and hitbox...
  tinyHp: 0.6, // ...and health
};

/** The modifier for a round, if it gets one (never the same twice in a row). `rand` is in [0, 1). */
export function modFor(round: number, rand: number, last?: ModId | null): ModId | null {
  if (round <= 0 || round % MOD.every !== 0) return null;
  const pool = MOD_IDS.filter((m) => m !== last);
  return pool[Math.min(pool.length - 1, Math.floor(rand * pool.length))];
}
