// Heads-up poker at the bus's card table: five-card draw between two of the crew, for their own scrap. The host
// referees (it holds the deck and both hands; each player is only ever sent their own), so this is pure: every move
// returns what to send to whom. One draw, then one round of betting: the first seat checks or raises (the ante
// again); a raise is called or folded; a check can be raised back. Then the showdown.

import { DUEL, pokerCompare, shuffled } from './rules.ts';

export type DuelPhase = 'wait' | 'draw' | 'bet' | 'show';
export type DuelMove = 'sit' | 'draw' | 'check' | 'raise' | 'call' | 'fold' | 'leave';
export const DUEL_MOVES: readonly DuelMove[] = ['sit', 'draw', 'check', 'raise', 'call', 'fold', 'leave'];

/** What everyone can see of the table. */
export interface DuelView {
  phase: DuelPhase;
  /** Who's sat down (crew places; -1: an empty chair). */
  seats: [number, number];
  ante: number;
  pot: number;
  /** Whose move (a seat, 0 or 1), in the betting. */
  turn: number;
  /** Who's drawn their cards; whether there's a raise to answer. */
  drew: [boolean, boolean];
  raised: boolean;
  /** The showdown: both hands (empty after a fold), and the winning seat (-1: split). */
  shown: number[][];
  winner: number;
}

export interface DuelOut {
  /** Tell everyone the table's state. */
  view: DuelView;
  /** Each seat's own hand, to send to them alone (crew place → cards). */
  hands: Map<number, number[]>;
}

export class Duel {
  private v: DuelView = empty();
  private deck: number[] = [];
  private hand: [number[], number[]] = [[], []];
  /** Who checked first (so a raise after a check goes back to them). */
  private checked = false;

  constructor(
    private rand: () => number,
    /** Each crew member's scrap, and how to move it. */
    private cash: (who: number) => number,
    private pay: (who: number, n: number) => void,
  ) {}

  get view() {
    return this.v;
  }

  private out(): DuelOut {
    const hands = new Map<number, number[]>();
    if (this.v.phase === 'draw' || this.v.phase === 'bet') this.v.seats.forEach((who, s) => who >= 0 && hands.set(who, this.hand[s]));
    return { view: { ...this.v, seats: [...this.v.seats], drew: [...this.v.drew], shown: this.v.shown.map((h) => [...h]) }, hands };
  }

  private seatOf(who: number) {
    return this.v.seats.indexOf(who);
  }

  /** A move by crew member `who`. `n`: the ante (index into DUEL.antes) to sit down with, or the cards to keep (a bit each). */
  move(who: number, m: DuelMove, n = 0): DuelOut | null {
    const v = this.v;
    const seat = this.seatOf(who);
    if (m === 'sit') {
      if (v.phase === 'show') this.v = empty();
      const t = this.v;
      if (t.phase !== 'wait' || this.seatOf(who) >= 0) return null;
      const free = t.seats.indexOf(-1);
      if (free < 0) return null;
      if (free === 0) t.ante = DUEL.antes[Math.max(0, Math.min(DUEL.antes.length - 1, n | 0))];
      // You need the ante and a raise's worth.
      if (this.cash(who) < t.ante * 2) return null;
      t.seats[free] = who;
      if (t.seats[1] >= 0) this.deal();
      return this.out();
    }
    if (seat < 0) return null;
    if (m === 'leave') {
      // Walking away mid-hand forfeits the pot.
      if (v.phase === 'draw' || v.phase === 'bet') return this.finish(1 - seat, false);
      this.v = empty();
      return this.out();
    }
    if (m === 'draw') {
      if (v.phase !== 'draw' || v.drew[seat]) return null;
      this.hand[seat] = this.hand[seat].map((c, i) => ((n >> i) & 1 ? c : this.deck.pop()!));
      v.drew[seat] = true;
      if (v.drew[0] && v.drew[1]) {
        v.phase = 'bet';
        v.turn = 0;
      }
      return this.out();
    }
    if (v.phase !== 'bet' || v.turn !== seat) return null;
    if (m === 'check' && !v.raised) {
      if (this.checked) return this.finish(this.best(), true);
      this.checked = true;
      v.turn = 1 - seat;
      return this.out();
    }
    if (m === 'raise' && !v.raised) {
      this.pay(who, -v.ante);
      v.pot += v.ante;
      v.raised = true;
      v.turn = 1 - seat;
      return this.out();
    }
    if (m === 'call' && v.raised) {
      this.pay(who, -v.ante);
      v.pot += v.ante;
      return this.finish(this.best(), true);
    }
    if (m === 'fold' && v.raised) return this.finish(1 - seat, false);
    return null;
  }

  /** Somebody left the run: their chair empties (mid-hand, the other seat takes the pot). */
  drop(who: number): DuelOut | null {
    return this.seatOf(who) >= 0 ? this.move(who, 'leave') : null;
  }

  private deal() {
    const v = this.v;
    this.deck = shuffled(this.rand);
    this.hand = [this.deck.splice(0, 5), this.deck.splice(0, 5)];
    for (const who of v.seats) this.pay(who, -v.ante);
    v.pot = v.ante * 2;
    v.phase = 'draw';
    v.drew = [false, false];
    v.raised = false;
    this.checked = false;
  }

  /** The better hand's seat (-1: a split). */
  private best() {
    const c = pokerCompare(this.hand[0], this.hand[1]);
    return c > 0 ? 0 : c < 0 ? 1 : -1;
  }

  private finish(winner: number, show: boolean) {
    const v = this.v;
    if (winner < 0) for (const who of v.seats) this.pay(who, v.pot / 2);
    else this.pay(v.seats[winner], v.pot);
    v.phase = 'show';
    v.winner = winner;
    v.shown = show ? [this.hand[0], this.hand[1]] : [[], []];
    return this.out();
  }
}

function empty(): DuelView {
  return { phase: 'wait', seats: [-1, -1], ante: DUEL.antes[0], pot: 0, turn: 0, drew: [false, false], raised: false, shown: [[], []], winner: -1 };
}

const PHASES: readonly DuelPhase[] = ['wait', 'draw', 'bet', 'show'];
const card = (c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < 52;
export const readHand = (h: unknown): number[] | null => (Array.isArray(h) && (h.length === 0 || h.length === 5) && h.every(card) ? (h as number[]) : null);

/** Checks a table state off the wire. */
export function readDuel(d: unknown): DuelView | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const pair = (v: unknown, ok: (x: unknown) => boolean) => Array.isArray(v) && v.length === 2 && v.every(ok);
  const seat = (x: unknown) => Number.isInteger(x) && (x as number) >= -1 && (x as number) < 8;
  if (!PHASES.includes(o.phase as DuelPhase) || !pair(o.seats, seat) || !pair(o.drew, (x) => typeof x === 'boolean')) return null;
  if (!DUEL.antes.includes(o.ante as 10) || !Number.isInteger(o.pot) || (o.pot as number) < 0 || (o.pot as number) > 400) return null;
  if (!(o.turn === 0 || o.turn === 1) || typeof o.raised !== 'boolean' || !(o.winner === -1 || o.winner === 0 || o.winner === 1)) return null;
  if (!Array.isArray(o.shown) || o.shown.length !== 2) return null;
  const shown = o.shown.map(readHand);
  if (!shown[0] || !shown[1]) return null;
  return { phase: o.phase as DuelPhase, seats: o.seats as [number, number], ante: o.ante as number, pot: o.pot as number, turn: o.turn, drew: o.drew as [boolean, boolean], raised: o.raised, shown: shown as number[][], winner: o.winner };
}
