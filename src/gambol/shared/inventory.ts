// The player's stash: coins, owned items and what's equipped. Pure rules over a plain object, so they're
// unit-tested; gambol/server/stashStore.ts keeps an account's, gambol/client/inventoryStore.ts a guest's. Items are owned individually (`u` is a unique number),
// so you can hold duplicates and sell the extras.

import { COIN, type CaseId, type Gear, type Item, RARITY, SLOTS, type Slot, caseById, itemById, rollCase } from './items.ts';

export interface Owned {
  u: number;
  id: string;
}

export interface Inv {
  coins: number;
  /** Account XP (levels.ts turns it into a level). */
  xp: number;
  items: Owned[];
  next: number;
  /** Slot -> the `u` of the owned item that's worn. */
  equipped: Partial<Record<Slot, number>>;
}

export const newInv = (): Inv => ({ coins: COIN.start, xp: 0, items: [], next: 1, equipped: {} });

const ownedItem = (inv: Inv, u: number): Item | undefined => {
  const o = inv.items.find((x) => x.u === u);
  return o && itemById(o.id);
};

export function earn(inv: Inv, n: number) {
  inv.coins += Math.max(0, Math.floor(n));
}

/** Stakes `n` whole coins at a table game. False (and nothing taken) if it isn't a positive whole number you can afford. */
export function wager(inv: Inv, n: number): boolean {
  if (!Number.isInteger(n) || n < 1 || n > inv.coins) return false;
  inv.coins -= n;
  return true;
}

/** Pays for a case and returns what dropped (now in the inventory), or null if you can't afford it. */
export function openCase(inv: Inv, id: CaseId, rng: () => number = Math.random): Owned | null {
  const def = caseById(id);
  if (!def || inv.coins < def.price) return null;
  inv.coins -= def.price;
  const owned = { u: inv.next++, id: rollCase(id, rng).id };
  inv.items.push(owned);
  return owned;
}

/** Wear an item (replacing whatever is in its slot). */
export function equip(inv: Inv, u: number): boolean {
  const item = ownedItem(inv, u);
  if (!item) return false;
  inv.equipped[item.slot] = u;
  return true;
}

export function unequip(inv: Inv, slot: Slot) {
  delete inv.equipped[slot];
}

/** Sells an item for its rarity's price and returns the coins, or 0 if it isn't yours. */
export function sell(inv: Inv, u: number): number {
  const i = inv.items.findIndex((x) => x.u === u);
  const item = i < 0 ? undefined : itemById(inv.items[i].id);
  if (!item) return 0;
  inv.items.splice(i, 1);
  for (const s of SLOTS) if (inv.equipped[s] === u) delete inv.equipped[s];
  inv.coins += RARITY[item.rarity].sell;
  return RARITY[item.rarity].sell;
}

/** The equipped item ids, ready to encode for the server. */
export function gearOf(inv: Inv): Gear {
  const g: Gear = {};
  for (const s of SLOTS) {
    const item = inv.equipped[s] === undefined ? undefined : ownedItem(inv, inv.equipped[s]!);
    if (item?.slot === s) g[s] = item.id;
  }
  return g;
}

/** Rebuilds an inventory from untrusted storage: unknown items are dropped and equips must point at real, matching items. */
export function sanitize(raw: unknown): Inv {
  const r = (raw ?? {}) as Partial<Inv>;
  const inv = newInv();
  if (typeof r.coins === 'number' && Number.isFinite(r.coins)) inv.coins = Math.max(0, Math.floor(r.coins));
  if (typeof r.xp === 'number' && Number.isFinite(r.xp)) inv.xp = Math.max(0, Math.floor(r.xp));
  const seen = new Set<number>();
  for (const o of Array.isArray(r.items) ? r.items : []) {
    if (!o || !Number.isInteger(o.u) || o.u < 1 || seen.has(o.u) || !itemById(o.id)) continue;
    seen.add(o.u);
    inv.items.push({ u: o.u, id: o.id });
  }
  inv.next = Math.max(typeof r.next === 'number' ? r.next : 1, ...inv.items.map((o) => o.u + 1));
  for (const s of SLOTS) {
    const u = r.equipped?.[s];
    if (u !== undefined && ownedItem(inv, u)?.slot === s) inv.equipped[s] = u;
  }
  return inv;
}
