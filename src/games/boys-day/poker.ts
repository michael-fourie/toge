// Texas Hold'em at the bus's card table, for the crew's own scrap. The host referees (it holds the deck and
// everyone's hole cards, and only ever sends you yours), so this is pure: every move returns the table for
// everyone plus the private cards for each player.
//
// Fixed limit, up to six seats: blinds, then four streets (preflop, flop, turn, river) with a bet and up to three
// raises each; the bet is the blind before and on the flop, twice that after. Short stacks go all in and the pot
// splits into side pots at the showdown, so nobody can win more than they could lose.

import { pokerScore, shuffled } from './rules.ts';

export const SEATS = 6;
/** The big blind you pick when you open the table; the small blind is half. */
export const STAKES = [10, 25, 50] as const;
/** A bet and three raises a street. */
export const RAISE_CAP = 4;

export type Phase = 'wait' | 'preflop' | 'flop' | 'turn' | 'river' | 'show';
export const PHASES: readonly Phase[] = ['wait', 'preflop', 'flop', 'turn', 'river', 'show'];
export type PokerMove = 'sit' | 'leave' | 'deal' | 'fold' | 'check' | 'call' | 'raise';
export const POKER_MOVES: readonly PokerMove[] = ['sit', 'leave', 'deal', 'fold', 'check', 'call', 'raise'];

/** What everyone at the table can see. Arrays are by seat (0…SEATS-1). */
export interface PokerView {
  phase: Phase;
  /** The big blind. */
  stake: number;
  /** Who's in each chair: a crew place, or -1 for an empty one. */
  seats: number[];
  /** Dealt into this hand (someone who sat down mid-hand waits for the next one). */
  live: boolean[];
  folded: boolean[];
  allIn: boolean[];
  /** Scrap pushed in on this street, and the scrap each player has left. */
  bet: number[];
  stack: number[];
  /** What the earlier streets collected (this street's `bet`s are on top of it). */
  pot: number;
  board: number[];
  button: number;
  /** Whose move (-1: nobody's). */
  turn: number;
  /** For the player to act: what a call costs, and what a raise costs (0 when raising is capped or impossible). */
  toCall: number;
  raise: number;
  /** The showdown: the hole cards shown, each one's best five, and what each seat won. */
  shown: number[][];
  best: number[][];
  won: number[];
}

export interface PokerOut {
  /** The table, for everyone. */
  view: PokerView;
  /** Each player's own two cards, for them alone (crew place → cards). */
  hands: Map<number, number[]>;
}

const fill = <T>(v: T) => new Array<T>(SEATS).fill(v);

export function emptyTable(stake: number = STAKES[0]): PokerView {
  return {
    phase: 'wait',
    stake,
    seats: fill(-1),
    live: fill(false),
    folded: fill(false),
    allIn: fill(false),
    bet: fill(0),
    stack: fill(0),
    pot: 0,
    board: [],
    button: 0,
    turn: -1,
    toCall: 0,
    raise: 0,
    shown: fill([]).map(() => [] as number[]),
    best: fill([]).map(() => [] as number[]),
    won: fill(0),
  };
}

/** The best five of up to seven cards: its score, and the five themselves. */
export function bestFive(cards: readonly number[]): { score: number[]; five: number[] } {
  if (cards.length < 5) return { score: [-1], five: [...cards] };
  let best: { score: number[]; five: number[] } | null = null;
  const pick: number[] = [];
  const walk = (start: number) => {
    if (pick.length === 5) {
      const score = pokerScore(pick);
      if (!best || cmp(score, best.score) > 0) best = { score, five: [...pick] };
      return;
    }
    for (let i = start; i < cards.length; i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best!;
}

/** > 0 if score `a` beats `b`. */
export function cmp(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

export class Poker {
  private v = emptyTable();
  private deck: number[] = [];
  private hole: number[][] = fill([]).map(() => [] as number[]);
  /** What each seat has put in across the whole hand (the side pots are built from it). */
  private total = fill(0);
  private acted = fill(false);
  private raises = 0;

  constructor(
    private rand: () => number,
    /** A crew member's scrap, and how to move it. */
    private cash: (who: number) => number,
    private pay: (who: number, n: number) => void,
  ) {}

  get view() {
    return this.v;
  }

  /** A player's move. Anything illegal is ignored (null): the table is the host's, not the client's. */
  move(who: number, m: PokerMove, n: number): PokerOut | null {
    if (who < 0) return null;
    const seat = this.seatOf(who);
    if (m === 'sit') return seat >= 0 ? null : this.sit(who, n);
    if (seat < 0) return null;
    if (m === 'leave') return this.leave(seat);
    if (m === 'deal') return this.deal();
    if (this.v.phase === 'wait' || this.v.phase === 'show' || this.v.turn !== seat) return null;
    return this.act(seat, m);
  }

  /** Someone left the party: out of their chair, and out of the hand. */
  drop(who: number): PokerOut | null {
    const seat = this.seatOf(who);
    return seat < 0 ? null : this.leave(seat);
  }

  private seatOf(who: number) {
    return this.v.seats.indexOf(who);
  }

  private out(): PokerOut {
    const v = this.v;
    v.stack = v.seats.map((who) => (who >= 0 ? this.cash(who) : 0));
    const hands = new Map<number, number[]>();
    if (v.phase !== 'wait') v.seats.forEach((who, s) => who >= 0 && v.live[s] && hands.set(who, [...this.hole[s]]));
    return {
      view: {
        ...v,
        seats: [...v.seats],
        live: [...v.live],
        folded: [...v.folded],
        allIn: [...v.allIn],
        bet: [...v.bet],
        stack: [...v.stack],
        board: [...v.board],
        shown: v.shown.map((h) => [...h]),
        best: v.best.map((h) => [...h]),
        won: [...v.won],
      },
      hands,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Chairs

  private sit(who: number, n: number) {
    // Prefer a chair with no scrap of this hand sitting in front of it (someone got up mid-hand).
    const chairs = this.v.seats.map((_, s) => s).filter((s) => this.v.seats[s] < 0);
    const free = chairs.find((s) => this.total[s] === 0) ?? chairs[0] ?? -1;
    if (free < 0) return null;
    const first = this.v.seats.every((s) => s < 0);
    const stake = first ? (STAKES[Math.max(0, Math.min(STAKES.length - 1, Math.round(n)))] ?? STAKES[0]) : this.v.stake;
    if (this.cash(who) < stake) return null;
    if (first) {
      this.v = emptyTable(stake);
      this.hole = fill([]).map(() => [] as number[]);
    }
    this.v.seats[free] = who;
    return this.out();
  }

  private leave(seat: number) {
    if (this.v.live[seat] && !this.v.folded[seat] && this.v.phase !== 'show') {
      // Their scrap stays in the pot: you can't walk out of a hand with it.
      this.v.folded[seat] = true;
      this.acted[seat] = true;
      this.clearSeat(seat);
      return this.after(seat);
    }
    this.clearSeat(seat);
    if (this.v.seats.every((s) => s < 0)) this.v = emptyTable(this.v.stake);
    return this.out();
  }

  private clearSeat(seat: number) {
    this.v.seats[seat] = -1;
    this.v.live[seat] = false;
    this.hole[seat] = [];
  }

  // -------------------------------------------------------------------------------------------
  // A hand

  private deal(): PokerOut | null {
    const v = this.v;
    if (v.phase !== 'wait' && v.phase !== 'show') return null;
    // Everyone who can cover the big blind is dealt in.
    const can = v.seats.map((who, s) => (who >= 0 && this.cash(who) >= v.stake ? s : -1)).filter((s) => s >= 0);
    if (can.length < 2) return null;
    const keep = v.stake;
    const button = this.next(v.button, can);
    Object.assign(v, {
      phase: 'preflop' as Phase,
      stake: keep,
      live: v.seats.map((_, s) => can.includes(s)),
      folded: fill(false),
      allIn: fill(false),
      bet: fill(0),
      pot: 0,
      board: [],
      button,
      shown: fill([]).map(() => [] as number[]),
      best: fill([]).map(() => [] as number[]),
      won: fill(0),
    });
    this.total = fill(0);
    this.acted = fill(false);
    this.raises = 1; // the big blind is the street's bet
    this.deck = shuffled(this.rand);
    this.hole = fill([]).map(() => [] as number[]);
    for (const s of can) this.hole[s] = [this.deck.pop()!, this.deck.pop()!];
    // Heads-up: the button is the small blind and acts first before the flop, last after it.
    const sb = can.length === 2 ? button : this.next(button, can);
    const bb = this.next(sb, can);
    this.put(sb, Math.max(1, Math.round(v.stake / 2)));
    this.put(bb, v.stake);
    v.turn = can.length === 2 ? sb : this.next(bb, can);
    this.ask();
    return this.out();
  }

  /** The next seat after `from` among `pool` (wrapping). */
  private next(from: number, pool: number[]) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (from + i) % SEATS;
      if (pool.includes(s)) return s;
    }
    return pool[0] ?? 0;
  }

  /** Seats still in the hand. */
  private inHand() {
    return this.v.seats.map((_, s) => s).filter((s) => this.v.live[s] && !this.v.folded[s]);
  }

  /** Seats that can still put scrap in. */
  private actors() {
    return this.inHand().filter((s) => !this.v.allIn[s]);
  }

  /** Pushes `n` in (or everything they have left), and marks them all in if that empties them. */
  private put(seat: number, n: number) {
    const who = this.v.seats[seat];
    const amount = Math.max(0, Math.min(n, this.cash(who)));
    if (amount > 0) this.pay(who, -amount);
    this.v.bet[seat] += amount;
    this.total[seat] += amount;
    if (this.cash(who) <= 0) this.v.allIn[seat] = true;
  }

  private maxBet() {
    return Math.max(0, ...this.v.bet);
  }

  /** What the street's bet is worth: the blind before and on the flop, twice that after. */
  private betSize() {
    return this.v.phase === 'turn' || this.v.phase === 'river' ? this.v.stake * 2 : this.v.stake;
  }

  /** Fills in what the player to act may do. */
  private ask() {
    const v = this.v;
    if (v.turn < 0) {
      v.toCall = 0;
      v.raise = 0;
      return;
    }
    const left = this.cash(v.seats[v.turn]);
    v.toCall = Math.min(this.maxBet() - v.bet[v.turn], left);
    v.raise = this.raises < RAISE_CAP && left > v.toCall ? Math.min(v.toCall + this.betSize(), left) : 0;
  }

  private act(seat: number, m: PokerMove): PokerOut | null {
    const v = this.v;
    const toCall = Math.min(this.maxBet() - v.bet[seat], this.cash(v.seats[seat]));
    if (m === 'check' && toCall > 0) return null;
    if (m === 'call' && toCall <= 0) return null;
    if (m === 'raise' && v.raise <= 0) return null;
    if (m === 'fold') v.folded[seat] = true;
    else if (m === 'call') this.put(seat, toCall);
    else if (m === 'raise') {
      this.put(seat, v.raise);
      this.raises++;
      // A raise puts the question back to everyone else.
      for (const s of this.actors()) if (s !== seat) this.acted[s] = false;
    } else if (m !== 'check') return null;
    this.acted[seat] = true;
    return this.after(seat);
  }

  /** After a move: the next player, the next street, or the end of the hand. */
  private after(from: number): PokerOut {
    const v = this.v;
    const live = this.inHand();
    if (live.length <= 1) return this.end(live);
    const actors = this.actors();
    const max = this.maxBet();
    const settled = actors.every((s) => this.acted[s] && v.bet[s] === max);
    if (!settled) {
      const pool = actors.filter((s) => !(this.acted[s] && v.bet[s] === max));
      v.turn = pool.includes(this.next(from, actors)) ? this.next(from, actors) : pool[0];
      this.ask();
      return this.out();
    }
    this.collect();
    if (v.phase === 'river') return this.end(live);
    // Nobody left who can bet (they're all in): run the rest of the board out and show them.
    if (actors.length <= 1) {
      while (v.board.length < 5) this.street();
      return this.end(live);
    }
    this.street();
    // After the flop the player left of the button goes first, so heads-up the button acts last.
    v.turn = this.next(v.button, this.actors());
    this.acted = fill(false);
    this.raises = 0;
    this.ask();
    return this.out();
  }

  /** Moves this street's bets into the pot. */
  private collect() {
    this.v.pot += this.v.bet.reduce((a, b) => a + b, 0);
    this.v.bet = fill(0);
  }

  /** Turns the next street's cards over. */
  private street() {
    const v = this.v;
    if (v.phase === 'preflop') {
      v.phase = 'flop';
      v.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
    } else if (v.phase === 'flop') {
      v.phase = 'turn';
      v.board.push(this.deck.pop()!);
    } else if (v.phase === 'turn') {
      v.phase = 'river';
      v.board.push(this.deck.pop()!);
    }
  }

  /** The end of the hand: everyone else folded, or a showdown with side pots. */
  private end(live: number[]): PokerOut {
    const v = this.v;
    this.collect();
    v.phase = 'show';
    v.turn = -1;
    v.toCall = 0;
    v.raise = 0;
    if (live.length <= 1) {
      // No showdown: the last one standing takes it, and keeps their cards to themselves.
      const s = live[0];
      if (s !== undefined) {
        this.pay(v.seats[s], v.pot);
        v.won[s] = v.pot;
      }
      return this.out();
    }
    // Everyone still in shows; the board may be short if they were all in early.
    while (v.board.length < 5 && this.deck.length) v.board.push(this.deck.pop()!);
    const score = new Map<number, number[]>();
    for (const s of live) {
      const b = bestFive([...this.hole[s], ...v.board]);
      score.set(s, b.score);
      v.shown[s] = [...this.hole[s]];
      v.best[s] = b.five;
    }
    // Side pots: one for each level of scrap anybody put in, contested by whoever paid that far. Scrap at a level
    // nobody left can win (someone got up and their chair was taken) rides along to the next pot.
    const levels = [...new Set(this.total.filter((t) => t > 0))].sort((a, b) => a - b);
    const take = (up: number[], pot: number) => {
      let best = up[0];
      for (const s of up) if (cmp(score.get(s)!, score.get(best)!) > 0) best = s;
      const winners = up.filter((s) => cmp(score.get(s)!, score.get(best)!) === 0);
      const each = Math.floor(pot / winners.length);
      // The odd scrap goes to the first winner after the button.
      let extra = pot - each * winners.length;
      for (const s of [...winners].sort((a, b) => ((a - v.button + SEATS) % SEATS) - ((b - v.button + SEATS) % SEATS))) {
        const give = each + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        this.pay(v.seats[s], give);
        v.won[s] += give;
      }
    };
    let prev = 0;
    let carry = 0;
    let last: number[] = live;
    for (const level of levels) {
      let pot = carry;
      for (let s = 0; s < SEATS; s++) pot += Math.max(0, Math.min(this.total[s], level) - Math.min(this.total[s], prev));
      prev = level;
      carry = 0;
      if (pot <= 0) continue;
      const up = live.filter((s) => this.total[s] >= level);
      if (!up.length) {
        carry = pot;
        continue;
      }
      last = up;
      take(up, pot);
    }
    if (carry > 0) take(last, carry);
    return this.out();
  }
}

// -------------------------------------------------------------------------------------------
// Off the wire (everything a client sends or relays is checked before it's used)

const isCard = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < 52;
const bools = (v: unknown) => Array.isArray(v) && v.length === SEATS && v.every((b) => typeof b === 'boolean');
const nums = (v: unknown, max: number) => Array.isArray(v) && v.length === SEATS && v.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max);

/** Up to `max` cards, all real and all different. */
export function readCards(v: unknown, max: number): number[] | null {
  if (!Array.isArray(v) || v.length > max || !v.every(isCard)) return null;
  return new Set(v).size === v.length ? (v as number[]) : null;
}

export function readPoker(d: unknown): PokerView | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const seat = (x: unknown) => Number.isInteger(x) && (x as number) >= -1 && (x as number) < 8;
  if (!PHASES.includes(o.phase as Phase) || !STAKES.includes(o.stake as 10)) return null;
  if (!Array.isArray(o.seats) || o.seats.length !== SEATS || !o.seats.every(seat)) return null;
  if (!bools(o.live) || !bools(o.folded) || !bools(o.allIn)) return null;
  if (!nums(o.bet, 1e7) || !nums(o.stack, 1e7) || !nums(o.won, 1e7)) return null;
  if (!Number.isInteger(o.pot) || (o.pot as number) < 0 || (o.pot as number) > 1e7) return null;
  if (!seat(o.button) || !seat(o.turn) || (o.button as number) < 0) return null;
  if (!Number.isInteger(o.toCall) || (o.toCall as number) < 0 || !Number.isInteger(o.raise) || (o.raise as number) < 0) return null;
  const board = readCards(o.board, 5);
  if (!board) return null;
  if (!Array.isArray(o.shown) || o.shown.length !== SEATS || !Array.isArray(o.best) || o.best.length !== SEATS) return null;
  const shown = o.shown.map((h) => readCards(h, 2));
  const best = o.best.map((h) => readCards(h, 5));
  if (shown.some((h) => !h) || best.some((h) => !h)) return null;
  return {
    phase: o.phase as Phase,
    stake: o.stake as number,
    seats: o.seats as number[],
    live: o.live as boolean[],
    folded: o.folded as boolean[],
    allIn: o.allIn as boolean[],
    bet: o.bet as number[],
    stack: o.stack as number[],
    pot: o.pot as number,
    board,
    button: o.button as number,
    turn: o.turn as number,
    toCall: o.toCall as number,
    raise: o.raise as number,
    shown: shown as number[][],
    best: best as number[][],
    won: o.won as number[],
  };
}
