// The player's inventory, saved per browser (like skins). The rules live in shared/inventory.ts.
// Prototype shortcut: it's all client-side, so coins are as trustworthy as the client. See CLAUDE.md.

import { type Inv, earn as earnCoins, equip as equipItem, gearOf, newInv, openCase as buyCase, sanitize, sell as sellItem, unequip as unequipSlot } from '../shared/inventory.ts';
import { type CaseId, type Gear, type Slot, encodeGear } from '../shared/items.ts';

const KEY = 'atrous.inventory';

function load(): Inv {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return newInv();
  }
}

const inv = load();
const listeners = new Set<() => void>();

function changed() {
  try {
    localStorage.setItem(KEY, JSON.stringify(inv));
  } catch {
    /* private mode: it just won't persist */
  }
  listeners.forEach((f) => f());
}

export const stash = {
  /** Read-only view: change it through the methods below so it's saved and the screens refresh. */
  get inv(): Readonly<Inv> {
    return inv;
  },
  get gear(): Gear {
    return gearOf(inv);
  },
  /** Sent to the server when joining a lobby. */
  get gearCode(): string {
    const g = gearOf(inv);
    return Object.keys(g).length ? encodeGear(g) : '';
  },
  earn(n: number) {
    earnCoins(inv, n);
    changed();
  },
  openCase(id: CaseId) {
    const got = buyCase(inv, id);
    if (got) changed();
    return got;
  },
  equip(u: number) {
    equipItem(inv, u);
    changed();
  },
  unequip(slot: Slot) {
    unequipSlot(inv, slot);
    changed();
  },
  sell(u: number) {
    const n = sellItem(inv, u);
    if (n) changed();
    return n;
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};
