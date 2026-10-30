// The player's stash: coins, XP, owned items and what's equipped. The rules live in shared/inventory.ts and
// shared/stash.ts. Signed in: the server's copy (every change is a POST the server re-runs with the shared rules and
// its own dice, and the server pays match coins and XP itself; we only show them early). Guest: the same rules run
// here against localStorage, so a guest's coins are as trustworthy as their browser (and only ever theirs).

import { type Inv, earn as earnCoins, equip as equipItem, gearOf, newInv, sanitize, sell as sellItem, wager as stakeCoins, unequip as unequipSlot } from '../shared/inventory.ts';
import { type Gear, type Slot, encodeGear } from '../shared/items.ts';
import { type StashAction, type StashResult, type Table, applyStash } from '../shared/stash.ts';
import { account } from './account.ts';

const KEY = 'atrous.inventory';

function loadLocal(): Inv {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return newInv();
  }
}

function saveLocal(inv: Inv) {
  try {
    localStorage.setItem(KEY, JSON.stringify(inv));
  } catch {
    /* private mode: it just won't persist */
  }
}

/** Guest: the stash. Signed in: the server's copy as last heard. */
let base = loadLocal();
/** The stash belongs to the signed-in account (it lives on the server). */
let onServer = false;
/** Signed in: coins and XP we've shown being earned (or spent) in a match that the server pays itself; cleared on refresh. */
let extraCoins = 0;
let extraXp = 0;
/** Winnings already paid that the screen hasn't revealed yet (a Plinko ball still bouncing). */
let held = 0;
/** A guest's Casino tables (the server keeps an account's). */
const table: Table = {};
let view: Inv = base;
const listeners = new Set<() => void>();

function changed() {
  view = extraCoins || extraXp || held ? { ...base, coins: Math.max(0, base.coins + extraCoins - held), xp: base.xp + extraXp } : base;
  listeners.forEach((f) => f());
}

/** A guest's change: saved here. */
function local() {
  if (!onServer) saveLocal(base);
  changed();
}

async function post(body: object): Promise<StashResult> {
  try {
    const res = await fetch('/api/stash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as StashResult;
  } catch {
    return { ok: false, error: 'Could not reach the game server.' };
  }
}

export const stash = {
  /** Read-only view: change it through the methods below so it's saved and the screens refresh. */
  get inv(): Readonly<Inv> {
    return view;
  },
  /** The stash shown belongs to the signed-in account (the server keeps it). */
  get onServer() {
    return onServer;
  },
  get gear(): Gear {
    return gearOf(view);
  },
  /** Sent to the server when joining a lobby. */
  get gearCode(): string {
    const g = gearOf(view);
    return Object.keys(g).length ? encodeGear(g) : '';
  },
  /** Coins from a match (the server pays an account itself: this just shows it). */
  earn(n: number) {
    if (onServer) extraCoins += Math.max(0, Math.floor(n));
    else earnCoins(base, n);
    local();
  },
  /** Account XP (the server pays an account itself, as with coins). */
  gainXp(n: number) {
    if (onServer) extraXp += Math.max(0, Math.floor(n));
    else base.xp += Math.max(0, Math.floor(n));
    local();
  },
  /** Takes coins for a Workbench build (false if you can't cover it). The server charges an account itself. */
  wager(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > view.coins) return false;
    if (onServer) extraCoins -= n;
    else stakeCoins(base, n);
    local();
    return true;
  },
  /**
   * One stash action (a case, a bet, a sale...), run by the server for an account and here for a guest. `hold`: keep
   * the winnings off the counter until `reveal` (they land with an animation).
   */
  async act(action: StashAction, opts: { hold?: boolean } = {}): Promise<StashResult> {
    const r = onServer ? await post(action) : applyStash(base, table, action, Math.random, Date.now());
    if (r.ok) {
      base = onServer ? sanitize(r.inv) : r.inv;
      if (opts.hold && r.paid) held += r.paid;
    }
    if (!onServer) saveLocal(base);
    changed();
    return r;
  },
  /** Winnings held by `act` reach the counter. */
  reveal(n: number) {
    held = Math.max(0, held - n);
    changed();
  },
  equip(u: number) {
    stash.change({ a: 'equip', u }, () => equipItem(base, u));
  },
  unequip(slot: Slot) {
    stash.change({ a: 'unequip', slot }, () => unequipSlot(base, slot));
  },
  sell(u: number) {
    stash.change({ a: 'sell', u }, () => sellItem(base, u));
  },
  /** Equip, unequip, sell: shown at once, then the account's real copy replaces it when the server answers. */
  change(action: StashAction, here: () => unknown) {
    here();
    local();
    if (onServer) void post(action).then((r) => (r.ok ? ((base = sanitize(r.inv)), changed()) : stash.refresh()));
  },
  /** Loads the account's stash (bringing this browser's over the first time), or falls back to this browser's. */
  async refresh() {
    if (account.user) {
      try {
        let r = (await (await fetch('/api/stash')).json()) as { stash: { inv: Inv; fresh: boolean } | null };
        if (r.stash?.fresh) r = (await (await fetch('/api/stash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adopt: loadLocal() }) })).json()) as typeof r;
        if (r.stash) {
          onServer = true;
          base = sanitize(r.stash.inv);
          extraCoins = extraXp = 0;
          changed();
          return;
        }
      } catch {
        /* offline: show the local one */
      }
    }
    onServer = false;
    base = loadLocal();
    extraCoins = extraXp = 0;
    changed();
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

account.onChange(() => void stash.refresh());
