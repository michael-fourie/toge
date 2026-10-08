// The Casino's table games, as pure rules so they can be tested: Plinko, Blackjack and Crash.
// Prototype shortcut (same as the rest of the loot): coins live in the browser, so these are as fair as the client.

// ---------------------------------------------------------------------------
// Plinko

export const PLINKO_ROWS = 12;
/** Payout multiplier per landing slot, left to right (symmetric). The centre is where most balls land. */
export const PLINKO_MULT: readonly number[] = [30, 10, 5, 2, 1, 0.5, 0.4, 0.5, 1, 2, 5, 10, 30];

export interface PlinkoDrop {
  /** One entry per peg row: 0 = bounced left, 1 = bounced right. */
  path: (0 | 1)[];
  /** Which slot it lands in (the number of right bounces). */
  slot: number;
}

/** Drops one ball through the pegs. */
export function plinkoDrop(rng: () => number = Math.random): PlinkoDrop {
  const path = Array.from({ length: PLINKO_ROWS }, () => (rng() < 0.5 ? 0 : 1) as 0 | 1);
  return { path, slot: path.reduce<number>((n, d) => n + d, 0) };
}

/** What a bet returns (stake included) from a slot. Rounded to whole coins. */
export const plinkoPayout = (bet: number, slot: number) => Math.round(bet * PLINKO_MULT[slot]);

/** Expected return per coin staked: the house edge is 1 minus this. */
export function plinkoRtp(): number {
  const n = PLINKO_ROWS;
  let c = 1;
  let sum = 0;
  for (let k = 0; k <= n; k++) {
    sum += c * PLINKO_MULT[k];
    c = (c * (n - k)) / (k + 1);
  }
  return sum / 2 ** n;
}

// ---------------------------------------------------------------------------
// Blackjack: six decks, dealer stands on every 17, blackjack pays 3:2, double on any first two cards. No split or insurance.

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export interface Card {
  rank: (typeof RANKS)[number];
  suit: (typeof SUITS)[number];
}

export function newShoe(rng: () => number = Math.random, decks = 6): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const pip = (c: Card) => (c.rank === 'A' ? 11 : 'JQK'.includes(c.rank) ? 10 : Number(c.rank));

/** Best total, counting aces as 11 while that doesn't bust. `soft` = an ace is still counted as 11. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = cards.reduce((n, c) => n + pip(c), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards: readonly Card[]) => cards.length === 2 && handValue(cards).total === 21;

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

export interface Round {
  player: Card[];
  dealer: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  outcome?: Outcome;
  /** Coins handed back when the round is over (stake included): 0 on a loss. */
  payout: number;
}

const take = (shoe: Card[]) => shoe.pop()!;

function finish(r: Round, outcome: Outcome) {
  r.done = true;
  r.outcome = outcome;
  r.payout = outcome === 'blackjack' ? r.bet + Math.round(r.bet * 1.5) : outcome === 'win' ? r.bet * 2 : outcome === 'push' ? r.bet : 0;
}

/** Deals a hand. A natural (either side) ends it at once. The shoe is refilled by the caller when it runs low. */
export function deal(shoe: Card[], bet: number): Round {
  const r: Round = { player: [take(shoe)], dealer: [take(shoe)], bet, doubled: false, done: false, payout: 0 };
  r.player.push(take(shoe));
  r.dealer.push(take(shoe));
  const pj = isBlackjack(r.player);
  const dj = isBlackjack(r.dealer);
  if (pj || dj) finish(r, pj && dj ? 'push' : pj ? 'blackjack' : 'lose');
  return r;
}

export function hit(r: Round, shoe: Card[]) {
  if (r.done) return;
  r.player.push(take(shoe));
  const v = handValue(r.player).total;
  if (v > 21) finish(r, 'bust');
  else if (v === 21) stand(r, shoe); // nothing better to do than stand on 21
}

/** The dealer draws to 17 and the hand is settled. */
export function stand(r: Round, shoe: Card[]) {
  if (r.done) return;
  while (handValue(r.dealer).total < 17) r.dealer.push(take(shoe));
  const p = handValue(r.player).total;
  const d = handValue(r.dealer).total;
  finish(r, d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose');
}

/** Only on the first two cards; the caller must have taken the extra stake. Doubles the bet, one card, then stand. */
export function canDouble(r: Round) {
  return !r.done && r.player.length === 2 && !r.doubled;
}
export function double(r: Round, shoe: Card[]) {
  if (!canDouble(r)) return;
  r.bet *= 2;
  r.doubled = true;
  r.player.push(take(shoe));
  if (handValue(r.player).total > 21) finish(r, 'bust');
  else stand(r, shoe);
}

/** The shoe is replaced when fewer than this many cards remain, before dealing. */
export const SHOE_MIN = 52;

// ---------------------------------------------------------------------------
// Crash: a kite climbs on the wind while the multiplier rises; at a random point its string snaps. Cash out before then.

export const CRASH = {
  edge: 0.03, // house edge: whatever you cash out at, you get back 97% on average (and 3% of rounds snap at once)
  growth: 0.12, // the multiplier is e^(growth·seconds): 2× at ~5.8 s, 10× at ~19 s
  max: 1000,
};

/**
 * Where a round's string snaps. P(snap ≥ m) = (1 - edge) / m for every m ≥ 1, so every cash-out target is worth the
 * same on average (a 1 - edge return) and no strategy beats another. Rounded down to 0.01.
 */
export function crashPoint(rng: () => number = Math.random): number {
  const m = (1 - CRASH.edge) / (1 - rng());
  return Math.max(1, Math.min(CRASH.max, Math.floor(m * 100) / 100));
}

/** The multiplier `t` seconds into a round (rounded down to 0.01, as shown), and when it reaches `m`. */
export const crashMult = (t: number) => Math.floor(Math.exp(CRASH.growth * Math.max(0, t)) * 100) / 100;
export const crashTime = (m: number) => Math.log(m) / CRASH.growth;

/** What a bet returns (stake included) when cashed out at `m`: whole coins, rounded down. */
export const crashPayout = (bet: number, m: number) => Math.floor(bet * m);
