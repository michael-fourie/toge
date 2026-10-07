// Bits shared by the Casino and Inventory screens.

import { type Item, RARITY, hexOf } from '../../shared/items.ts';
import { esc } from './ui.ts';
import { itemIcon } from './itemIcon.ts';

/** A little gold coin (inline SVG so it's the same gold everywhere, not a platform emoji). */
export const COIN_SVG = `<svg class="coin-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="#f2b632" stroke="#9a6410" stroke-width="1.5"/><circle cx="12" cy="12" r="7.4" fill="#ffd45e" stroke="#c98a1c" stroke-width="1.2"/><path d="M12 7.2v9.6M9.6 9.4c0-1 1-1.6 2.4-1.6s2.4.6 2.4 1.5c0 2.4-4.8 1.1-4.8 3.5 0 1 1 1.7 2.4 1.7s2.4-.7 2.4-1.7" fill="none" stroke="#a8700f" stroke-width="1.3" stroke-linecap="round"/><path d="M6.3 8.2A7 7 0 0 1 11 5" fill="none" stroke="#fff3b8" stroke-width="1.4" stroke-linecap="round"/></svg>`;
/** Coin icon + amount, as HTML (set it with innerHTML). */
export const coinText = (n: number) => `${COIN_SVG}<span>${n.toLocaleString()}</span>`;

/** A CSGO-style card: picture, name, and a bar in the rarity's colour. */
export function itemCard(item: Item, opts: { tag?: string; pressed?: boolean; button?: string } = {}) {
  const r = RARITY[item.rarity];
  const inner = `
    <img src="${itemIcon(item)}" alt="" width="140" height="85" draggable="false" />
    <b>${esc(item.name)}</b>
    <small>${r.name}</small>
    ${opts.tag ? `<em class="tag">${esc(opts.tag)}</em>` : ''}`;
  const style = `--r:${hexOf(r.color)}`;
  return opts.button
    ? `<button class="loot-card" style="${style}" data-item="${opts.button}" aria-pressed="${!!opts.pressed}">${inner}</button>`
    : `<div class="loot-card" style="${style}">${inner}</div>`;
}
