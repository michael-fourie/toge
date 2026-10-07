// Bits shared by the Store and Inventory screens.

import { COIN, type Item, RARITY, hexOf } from '../../shared/items.ts';
import { esc } from './ui.ts';
import { itemIcon } from './itemIcon.ts';

export const coinText = (n: number) => `${COIN.icon} ${n.toLocaleString()}`;

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
