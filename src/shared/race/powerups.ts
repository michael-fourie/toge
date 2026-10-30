// Mystery box items. Drive through a box with your hands free and you get one, picked with kart-racer
// odds: the further back you are, the better your chances of something that helps you catch up.

export type Item = 'turbo' | 'triple' | 'oil' | 'shield' | 'shock';

export const ITEMS: Record<Item, { name: string; icon: string; uses: number }> = {
  turbo: { name: 'Turbo', icon: '🔥', uses: 1 },
  triple: { name: 'Triple Turbo', icon: '🔥🔥🔥', uses: 3 },
  oil: { name: 'Oil Slick', icon: '🛢', uses: 1 },
  shield: { name: 'Shield', icon: '🛡', uses: 1 },
  shock: { name: 'Shockwave', icon: '⚡', uses: 1 },
};

export const POWER = {
  turboSeconds: 1.3,
  turboAccel: 12,
  shieldSeconds: 6,
  oilSpin: 1.1,
  shockSpin: 0.9,
  oilRadius: 1.9,
  oilSeconds: 40,
  /** A box comes back this long after it's taken (s). */
  boxRespawn: 4,
  /** Spinning wheel before you see what you got (s). */
  roulette: 0.9,
};

/**
 * Picks an item. `place` is 1-based among `field` racers; the leader mostly gets defence (oil, shields),
 * the back of the pack turbos and the odd shockwave.
 */
export function rollItem(place: number, field: number, rnd: () => number): Item {
  const p = field > 1 ? (place - 1) / (field - 1) : 0.5;
  const weights: [Item, number][] = [
    ['turbo', 3],
    ['triple', 0.4 + 3 * p],
    ['oil', 3 - 2 * p],
    ['shield', 2 - p],
    ['shock', 0.1 + 1.4 * p * p],
  ];
  let r = rnd() * weights.reduce((a, [, w]) => a + w, 0);
  for (const [item, w] of weights) {
    r -= w;
    if (r <= 0) return item;
  }
  return 'turbo';
}
