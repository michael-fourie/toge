// Survival perks beyond Juggernog (which lives in the wallet as `jug`): bought at their machines, kept until you go down
// for good or the run restarts. Second Wind is used up when it gets you back on your feet. Pure data, shared.

export type PerkId = 'mend' | 'zephyr' | 'wind';

export interface PerkDef {
  name: string;
  /** What it does, for the prompt and the banner. */
  blurb: string;
  price: number;
  /** The machine's colour and its floating emblem's. */
  color: number;
}

export const PERKS: Record<PerkId, PerkDef> = {
  mend: { name: 'Swift Mend', blurb: 'revive teammates twice as fast', price: 1500, color: 0x5fd18a },
  zephyr: { name: 'Zephyr Fizz', blurb: 'run 25% faster', price: 2000, color: 0x6fb8ff },
  wind: { name: 'Second Wind', blurb: 'get yourself back up once when you go down', price: 2500, color: 0xffc94a },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

/** Zephyr Fizz: ground run speed multiplier (movement.ts MoveInput.speedMult). Air strafing is untouched. */
export const ZEPHYR_SPEED = 1.25;
