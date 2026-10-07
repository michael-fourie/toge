import { RARITIES, RARITY, SLOTS, SLOT_NAME, type Slot, itemById } from '../../shared/items.ts';
import { JACKETS } from '../../shared/skin.ts';
import { stash } from '../inventoryStore.ts';
import { sfx } from '../sfx.ts';
import { storedSkin } from '../skinStore.ts';
import { coinText, itemCard } from './lootui.ts';
import type { Render } from './router.ts';
import { $, esc, sheet, storedName } from './ui.ts';
import { DEFAULT_JACKET, mountSkinPreview } from './skinPreview.ts';
import './skin.css';

type Filter = Slot | 'all';

export const inventory: Render = (root) => {
  root.innerHTML = sheet(
    'Inventory',
    `<div class="loot-bar"><span class="coin-total" id="coins"></span><small id="count"></small></div>
    <div class="inv-layout">
      <div class="inv-side">
        <canvas class="skin-preview" aria-label="Preview of your character"></canvas>
        <div class="hand-toggle" role="group" aria-label="In hand">
          <button class="pick" data-hand="rifle" aria-pressed="true">Rifle out</button>
          <button class="pick" data-hand="knife" aria-pressed="false">Knife out</button>
        </div>
        <div class="slots" id="slots"></div>
      </div>
      <div class="inv-main">
        <div class="skin-row" id="filters"></div>
        <div class="loot-grid" id="grid"></div>
        <div class="inv-detail" id="detail"></div>
      </div>
    </div>`,
  );
  $(root, '.sheet').classList.add('wide');

  const skin = storedSkin();
  const color = skin?.jacket === undefined ? DEFAULT_JACKET : JACKETS[skin.jacket];
  const preview = mountSkinPreview($<HTMLCanvasElement>(root, '.skin-preview'), true);
  let filter: Filter = 'all';
  let selected: number | null = null;
  let knifeOut = false;
  let armed = false; // the Sell button asks twice
  let armTimer = 0;

  const draw = () => {
    const { inv } = stash;
    if (selected !== null && !inv.items.some((o) => o.u === selected)) selected = null;
    const worn = new Set(Object.values(inv.equipped));
    $(root, '#coins').textContent = coinText(inv.coins);
    $(root, '#count').textContent = `${inv.items.length} item${inv.items.length === 1 ? '' : 's'}`;

    $(root, '#filters').innerHTML = (['all', ...SLOTS] as Filter[])
      .map((f) => `<button class="pick" data-filter="${f}" aria-pressed="${f === filter}">${f === 'all' ? 'All' : SLOT_NAME[f]}</button>`)
      .join('');

    const shown = inv.items
      .map((o) => ({ o, item: itemById(o.id)! }))
      .filter((x) => filter === 'all' || x.item.slot === filter)
      .sort((a, b) => RARITIES.indexOf(b.item.rarity) - RARITIES.indexOf(a.item.rarity) || a.item.name.localeCompare(b.item.name));
    $(root, '#grid').innerHTML = shown.length
      ? shown.map(({ o, item }) => itemCard(item, { button: String(o.u), pressed: o.u === selected, tag: worn.has(o.u) ? 'Equipped' : undefined })).join('')
      : `<p class="empty">${inv.items.length ? 'Nothing in this tab.' : 'Nothing yet. Open a case in the Store!'}</p>`;

    $(root, '#slots').innerHTML = SLOTS.map((s) => {
      const u = inv.equipped[s];
      const item = u === undefined ? undefined : itemById(inv.items.find((o) => o.u === u)?.id ?? '');
      const style = item ? `style="--r:#${RARITY[item.rarity].color.toString(16).padStart(6, '0')}"` : '';
      return `<div class="slot" ${style}><span>${SLOT_NAME[s]}</span><b>${item ? esc(item.name) : 'Default'}</b>${item ? `<button class="link" data-unequip="${s}" aria-label="Unequip ${SLOT_NAME[s]}">✕</button>` : ''}</div>`;
    }).join('');

    const sel = selected === null ? undefined : inv.items.find((o) => o.u === selected);
    const item = sel && itemById(sel.id);
    $(root, '#detail').innerHTML = item
      ? `<div class="detail-row">${itemCard(item)}<div class="detail-actions">
          ${worn.has(sel!.u) ? `<button data-act="unequip">Unequip</button>` : `<button class="primary" data-act="equip">Equip</button>`}
          <button data-act="sell">${armed ? 'Sure? Sell it' : `Sell +${coinText(RARITY[item.rarity].sell)}`}</button>
        </div></div>`
      : '';
    preview.show(skin, color, storedName().trim(), stash.gear, knifeOut);
    root.querySelectorAll<HTMLElement>('[data-hand]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.hand === 'knife') === knifeOut)));
  };

  const disarm = () => {
    armed = false;
    clearTimeout(armTimer);
  };
  $(root, '.sheet').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const card = t.closest<HTMLElement>('[data-item]');
    const filterBtn = t.closest<HTMLElement>('[data-filter]');
    const hand = t.closest<HTMLElement>('[data-hand]');
    const unequip = t.closest<HTMLElement>('[data-unequip]');
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (card) {
      selected = Number(card.dataset.item);
      disarm();
    } else if (filterBtn) filter = filterBtn.dataset.filter as Filter;
    else if (hand) knifeOut = hand.dataset.hand === 'knife';
    else if (unequip) stash.unequip(unequip.dataset.unequip as Slot);
    else if (act === 'equip' && selected !== null) stash.equip(selected);
    else if (act === 'unequip' && selected !== null) {
      const slot = itemById(stash.inv.items.find((o) => o.u === selected)?.id ?? '')?.slot;
      if (slot) stash.unequip(slot);
    } else if (act === 'sell' && selected !== null) {
      if (!armed) {
        armed = true;
        armTimer = window.setTimeout(() => {
          armed = false;
          draw();
        }, 3000);
      } else {
        disarm();
        sfx.coin();
        stash.sell(selected);
        return; // onChange redraws
      }
    } else return;
    draw();
  });

  const off = stash.onChange(draw);
  draw();
  return () => {
    off();
    disarm();
    preview.dispose();
  };
};
