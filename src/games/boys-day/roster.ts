// The boys: who you can play as. Pure data (no three.js): models.ts dresses the Blender body in each one's colours.
// The looks follow the same people's cards in Royal Degeneracy (its cast.ts), copied here so the two games stay
// separate; each of the boys gets his own details later.

export type HairStyle = 'buzz' | 'short' | 'medium' | 'swept' | 'shaggy' | 'verylong';

export interface Boy {
  name: string;
  /** Centimetres: the model is scaled by it. */
  height: number;
  skin: string;
  hair: string;
  style: HairStyle;
  shirt: string;
  /** A second colour on the shirt (the stripe and collar). */
  trim: string;
  pants: string;
  shoes: string;
  /** Shoulder width relative to normal. */
  build: number;
  hat?: 'toque' | 'cap';
  hatColour?: string;
}

const SKIN = { fair: '#f2d2bc', light: '#e8c3a4', tan: '#d6a77f', warm: '#c99572' };

export const BOYS: readonly Boy[] = [
  { name: 'Shota', height: 185, skin: SKIN.warm, hair: '#0f0d0b', style: 'verylong', shirt: '#b8452f', trim: '#2b2b2b', pants: '#30323a', shoes: '#22252b', build: 1.15 },
  { name: 'Garrett', height: 180, skin: SKIN.fair, hair: '#5a3a22', style: 'short', shirt: '#d9822b', trim: '#2b2b2b', pants: '#3c4a5e', shoes: '#2a2724', build: 1.08 },
  { name: 'Nash', height: 170, skin: SKIN.light, hair: '#4a3020', style: 'buzz', shirt: '#4b4f58', trim: '#9ad04a', pants: '#2d2f36', shoes: '#ffffff', build: 0.98, hat: 'cap', hatColour: '#1d2026' },
  { name: 'Jung', height: 175, skin: SKIN.light, hair: '#15130f', style: 'medium', shirt: '#e9e4d8', trim: '#b23a3a', pants: '#26282d', shoes: '#f3f3f3', build: 0.98 },
  { name: 'Dev', height: 185, skin: SKIN.tan, hair: '#4a2f1c', style: 'shaggy', shirt: '#3d5a80', trim: '#e0e6ee', pants: '#2f3440', shoes: '#ece6da', build: 1, hat: 'toque', hatColour: '#b23a3a' },
  { name: 'Angus', height: 175, skin: SKIN.fair, hair: '#6b4426', style: 'short', shirt: '#7a8b3f', trim: '#d8c89a', pants: '#5b4a3a', shoes: '#8a7a68', build: 1 },
  { name: 'Michael', height: 185, skin: SKIN.fair, hair: '#5a3a22', style: 'swept', shirt: '#2b2d31', trim: '#6b8f71', pants: '#40506a', shoes: '#1d1d1f', build: 1 },
];

/** Gordie, fresh out of the cells in his orange jumpsuit (not on the roster: you free him). */
export const GORDIE: Boy = { name: 'Gordie', height: 178, skin: SKIN.light, hair: '#2a1c12', style: 'buzz', shirt: '#ff7a1a', trim: '#ffffff', pants: '#ff7a1a', shoes: '#f3f3f3', build: 1.1 };

/** "Surprise me": a pick that isn't anyone yet. */
export const ANY_BOY = -1;

export const isPick = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= ANY_BOY && (v as number) < BOYS.length;

/**
 * Who everyone is this run, by place in the crew: their pick if they made one, otherwise somebody nobody picked
 * (two players may pick the same boy; with more players than boys the leftovers double up too).
 */
export function castBoys(picks: readonly (number | undefined)[], rand: () => number): number[] {
  const taken = new Set(picks.filter((p): p is number => p !== undefined && p >= 0 && p < BOYS.length));
  return picks.map((p) => {
    if (p !== undefined && p >= 0 && p < BOYS.length) return p;
    const free = BOYS.map((_, i) => i).filter((i) => !taken.has(i));
    const pool = free.length ? free : BOYS.map((_, i) => i);
    const b = pool[Math.floor(rand() * pool.length) % pool.length];
    taken.add(b);
    return b;
  });
}
