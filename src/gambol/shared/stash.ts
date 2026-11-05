// Everything you can do to a stash (cases, selling, equipping and the Casino), as one action type. Pure and shared,
// like the TŌGE garage: the server runs it for signed-in players (their stash lives in the Accounts Durable Object,
// with its own dice and clock), the client runs the same code against localStorage for guests.

import { type Card, CRASH, type Round, SHOE_MIN, canDouble, crashMult, crashPayout, crashPoint, crashTime, deal, double, hit, newShoe, plinkoDrop, plinkoPayout, stand, type PlinkoDrop } from './casino.ts';
import { type Inv, type Owned, equip, newInv, openCase, sanitize, sell, unequip, wager } from './inventory.ts';
import { type CaseId, type Slot, SLOTS, caseById } from './items.ts';

export type StashAction =
  | { a: 'case'; id: CaseId }
  | { a: 'sell'; u: number }
  | { a: 'equip'; u: number }
  | { a: 'unequip'; slot: Slot }
  | { a: 'plinko'; bet: number }
  | { a: 'bj'; op: 'deal' | 'hit' | 'stand' | 'double'; bet?: number }
  /** launch: pay and start a kite; cash: get out at `m` (if it hasn't snapped); peek: has it snapped yet? */
  | { a: 'crash'; op: 'launch' | 'cash' | 'peek'; bet?: number; m?: number };

/** The Casino's tables between requests: the Blackjack shoe and hand, the kite in the air. Never shown to the client as is. */
export interface Table {
  shoe?: Card[];
  bj?: Round;
  crash?: { bet: number; at: number; start: number; cashed: number | null };
}

/** A kite as the client may see it: where it snapped only once it has. */
export interface CrashView {
  /** Launched at this server time (ms). */
  start?: number;
  /** It snapped at this multiplier (the round is over). */
  at?: number;
  /** We got out at this multiplier. */
  cashed?: number;
}

export type StashResult =
  | {
      ok: true;
      inv: Inv;
      /** Coins this action paid in (winnings, a sale): already in `inv`. */
      paid?: number;
      got?: Owned;
      drop?: PlinkoDrop;
      /** The Blackjack hand, with the dealer's hole card left out while it's being played. */
      round?: Round;
      crash?: CrashView;
    }
  | { ok: false; error: string };

const MAX_BET = 1_000_000_000;
const isBet = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_BET;

/** The hand as the player may see it: no hole card (or shoe) while it's still being played. */
export const publicRound = (r: Round): Round => (r.done ? structuredClone(r) : { ...structuredClone(r), dealer: [r.dealer[0]] });

/**
 * Applies one action. `inv` and `table` are changed in place, and stay valid whatever the result (save them either
 * way: a refused deal may still have settled an abandoned hand). `rnd` is the dice and `now` the clock (ms), the
 * server's own for accounts.
 */
export function applyStash(inv: Inv, table: Table, act: StashAction, rnd: () => number, now: number): StashResult {
  if (!act || typeof act !== 'object') return { ok: false, error: 'Bad request.' };
  const done = (extra: Omit<Extract<StashResult, { ok: true }>, 'ok' | 'inv'> = {}): StashResult => ({ ok: true, inv, ...extra });
  switch (act.a) {
    case 'case': {
      if (!caseById(act.id)) return { ok: false, error: 'No such case.' };
      const got = openCase(inv, act.id, rnd);
      return got ? done({ got }) : { ok: false, error: 'Not enough coins.' };
    }
    case 'sell': {
      const paid = Number.isInteger(act.u) ? sell(inv, act.u) : 0;
      return paid ? done({ paid }) : { ok: false, error: "That isn't yours." };
    }
    case 'equip':
      return Number.isInteger(act.u) && equip(inv, act.u) ? done() : { ok: false, error: "That isn't yours." };
    case 'unequip':
      if (!SLOTS.includes(act.slot)) return { ok: false, error: 'Bad request.' };
      unequip(inv, act.slot);
      return done();
    case 'plinko': {
      if (!isBet(act.bet) || !wager(inv, act.bet)) return { ok: false, error: 'Not enough coins.' };
      const drop = plinkoDrop(rnd);
      const paid = plinkoPayout(act.bet, drop.slot);
      inv.coins += paid;
      return done({ drop, paid });
    }
    case 'bj':
      return blackjack(inv, table, act, rnd, done);
    case 'crash':
      return crash(inv, table, act, rnd, now, done);
  }
  return { ok: false, error: 'Bad request.' };
}

type Done = (extra?: Omit<Extract<StashResult, { ok: true }>, 'ok' | 'inv'>) => StashResult;

function blackjack(inv: Inv, table: Table, act: Extract<StashAction, { a: 'bj' }>, rnd: () => number, done: Done): StashResult {
  // Pays a finished hand and clears it (a hand is paid exactly once).
  const settle = (): StashResult => {
    const r = table.bj!;
    if (!r.done) return done({ round: publicRound(r) });
    inv.coins += r.payout;
    table.bj = undefined;
    return done({ round: publicRound(r), paid: r.payout });
  };
  if (act.op === 'deal') {
    if (!isBet(act.bet)) return { ok: false, error: 'Bad bet.' };
    // A hand left half-played (the tab closed) is stood for you, so its stake is never lost.
    if (table.bj) {
      stand(table.bj, (table.shoe ??= newShoe(rnd)));
      inv.coins += table.bj.payout;
      table.bj = undefined;
    }
    if (!wager(inv, act.bet)) return { ok: false, error: 'Not enough coins.' };
    if (!table.shoe || table.shoe.length < SHOE_MIN) table.shoe = newShoe(rnd);
    table.bj = deal(table.shoe, act.bet);
    return settle();
  }
  const r = table.bj;
  if (!r || r.done || !table.shoe) return { ok: false, error: 'No hand in play.' };
  if (act.op === 'hit') hit(r, table.shoe);
  else if (act.op === 'stand') stand(r, table.shoe);
  else if (act.op === 'double') {
    if (!canDouble(r)) return { ok: false, error: "You can't double now." };
    if (!wager(inv, r.bet)) return { ok: false, error: 'Not enough coins to double.' };
    double(r, table.shoe);
  } else return { ok: false, error: 'Bad request.' };
  return settle();
}

function crash(inv: Inv, table: Table, act: Extract<StashAction, { a: 'crash' }>, rnd: () => number, now: number, done: Done): StashResult {
  const k = table.crash;
  // Snapped: the server's clock says the kite reached its snap point (a cash-out after that is too late).
  const snapped = (c: NonNullable<Table['crash']>) => now - c.start >= crashTime(c.at) * 1000;
  if (act.op === 'launch') {
    if (!isBet(act.bet)) return { ok: false, error: 'Bad bet.' };
    // A kite left flying (the tab closed) is cashed out where it is, like leaving the table does.
    if (k && !snapped(k) && k.cashed === null) inv.coins += crashPayout(k.bet, crashMult((now - k.start) / 1000));
    table.crash = undefined;
    if (!wager(inv, act.bet)) return { ok: false, error: 'Not enough coins.' };
    table.crash = { bet: act.bet, at: crashPoint(rnd), start: now, cashed: null };
    // A string that snaps at 1× never gets off the ground: say so straight away.
    if (table.crash.at <= 1) {
      table.crash = undefined;
      return done({ crash: { start: now, at: 1 } });
    }
    return done({ crash: { start: now } });
  }
  if (!k) return done({ crash: {} });
  if (act.op === 'peek') {
    if (!snapped(k)) return done({ crash: { start: k.start, cashed: k.cashed ?? undefined } });
    table.crash = undefined;
    return done({ crash: { start: k.start, at: k.at, cashed: k.cashed ?? undefined } });
  }
  if (act.op !== 'cash' || k.cashed !== null) return { ok: false, error: 'Bad request.' };
  if (snapped(k)) {
    table.crash = undefined;
    return done({ crash: { start: k.start, at: k.at } });
  }
  // You get out where you clicked, as long as the kite really was that high by now (it can't be in the future).
  const high = crashMult((now - k.start) / 1000);
  const m = typeof act.m === 'number' && Number.isFinite(act.m) && act.m >= 1 && act.m <= high ? Math.floor(act.m * 100) / 100 : high;
  k.cashed = Math.min(m, CRASH.max);
  const paid = crashPayout(k.bet, k.cashed);
  inv.coins += paid;
  return done({ crash: { start: k.start, cashed: k.cashed }, paid });
}

/** A stash brought over from a browser once (see STASH_IMPORT_COINS): items and XP as they were, coins capped. */
export function importInv(raw: unknown, maxCoins: number): Inv {
  const inv = sanitize(raw);
  inv.coins = Math.min(inv.coins, Math.max(newInv().coins, maxCoins));
  return inv;
}
