import { CASES, type CaseDef, RARITIES, RARITY, hexOf, itemById, itemsIn, odds, rollCase } from '../../shared/items.ts';
import { stash } from '../inventoryStore.ts';
import { sfx } from '../sfx.ts';
import { coinText, itemCard } from './lootui.ts';
import { $, esc, toast } from './ui.ts';

const CARD = 140; // reel card width + gap, px
const WINNER = 38; // which reel slot the drop lands on
const REEL_LEN = 48;
const SPIN_MS = 6000;

const crate = (c: CaseDef) => `
  <svg viewBox="0 0 96 80" aria-hidden="true">
    <rect x="8" y="26" width="80" height="50" rx="6" fill="#a98c6c" stroke="#4a3726" stroke-width="3"/>
    <rect x="4" y="14" width="88" height="20" rx="6" fill="${hexOf(c.color)}" stroke="#4a3726" stroke-width="3"/>
    <rect x="40" y="14" width="16" height="62" fill="#fbf4e2" stroke="#4a3726" stroke-width="3"/>
    <circle cx="48" cy="44" r="6" fill="#ffd98a" stroke="#4a3726" stroke-width="2.5"/>
    <path d="M78 4 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fff6c8"/>
  </svg>`;

/** The case's contents, rarest first, with each tier's chance. Items render lazily when the drawer is opened. */
function contents(c: CaseDef) {
  const o = odds(c.id);
  return [...RARITIES]
    .reverse()
    .filter((r) => o[r])
    .map(
      (r) => `<h4 style="--r:${hexOf(RARITY[r].color)}">${RARITY[r].name} <small>${((o[r] ?? 0) * 100).toFixed(o[r]! < 0.01 ? 2 : 1)}%</small></h4>
        <div class="loot-grid">${itemsIn(c.id).filter((i) => i.rarity === r).map((i) => itemCard(i)).join('')}</div>`,
    )
    .join('');
}

/** The case shop: the Casino's Cases tab. Draws into `root` and returns its cleanup. */
export function mountCases(root: HTMLElement): () => void {
  root.innerHTML = `<p class="pane-note">Earn coins by eliminating things. Sell spares from your Inventory.</p>
    <div class="case-list">${CASES.map(
      (c) => `
      <article class="case" style="--c:${hexOf(c.color)}" data-case="${c.id}">
        <div class="case-art">${crate(c)}</div>
        <div class="case-info">
          <h3>${esc(c.name)}</h3>
          <p>${esc(c.blurb)}</p>
          <button class="primary" data-open="${c.id}">Open · ${coinText(c.price)}</button>
        </div>
        <details class="case-inside"><summary>What's inside (${itemsIn(c.id).length} items)</summary><div class="inside" data-inside="${c.id}"></div></details>
      </article>`,
    ).join('')}</div>`;

  const refresh = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => {
      const price = CASES.find((c) => c.id === b.dataset.open)!.price;
      b.disabled = stash.inv.coins < price;
      b.title = b.disabled ? 'Not enough coins' : '';
    });
  };
  const off = stash.onChange(refresh);
  refresh();

  for (const d of root.querySelectorAll<HTMLDetailsElement>('.case-inside')) {
    d.addEventListener('toggle', () => {
      const box = $(d, '.inside');
      if (d.open && !box.innerHTML) box.innerHTML = contents(CASES.find((c) => c.id === box.dataset.inside)!);
    });
  }

  let overlay: HTMLElement | null = null;
  let raf = 0;
  let timer = 0;
  const close = () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    overlay?.remove();
    overlay = null;
  };

  /** Pay, then spin the reel to the (already decided) drop. */
  function open(c: CaseDef) {
    const got = stash.openCase(c.id);
    if (!got) return toast('Not enough coins');
    sfx.unlock();
    const won = itemById(got.id)!;
    const reel = Array.from({ length: REEL_LEN }, (_, i) => (i === WINNER ? won : rollCase(c.id)));
    close();
    overlay = document.createElement('div');
    overlay.className = 'reel-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `Opening ${c.name}`);
    overlay.innerHTML = `
      <div class="reel-box">
        <h3>${esc(c.name)}</h3>
        <div class="reel-window"><i class="reel-marker"></i><div class="reel-track">${reel.map((i) => itemCard(i)).join('')}</div></div>
        <div class="reveal" hidden></div>
      </div>`;
    root.appendChild(overlay);
    const win = $(overlay, '.reel-window');
    const track = $(overlay, '.reel-track');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop = -(WINNER * CARD + CARD / 2 - win.clientWidth / 2 + (Math.random() - 0.5) * (CARD - 40));

    let lastIdx = -1;
    const watch = () => {
      const x = new DOMMatrix(getComputedStyle(track).transform).m41;
      const idx = Math.floor((win.clientWidth / 2 - x) / CARD);
      if (idx !== lastIdx) {
        lastIdx = idx;
        sfx.caseTick();
      }
      raf = requestAnimationFrame(watch);
    };

    const reveal = () => {
      cancelAnimationFrame(raf);
      const tier = RARITIES.indexOf(won.rarity);
      sfx.caseReveal(tier);
      overlay!.classList.add('revealed');
      const r = $(overlay!, '.reveal');
      r.hidden = false;
      r.style.setProperty('--r', hexOf(RARITY[won.rarity].color));
      r.innerHTML = `
        <div class="drop">${itemCard(won)}</div>
        <div class="reveal-actions">
          <button class="primary" data-act="equip">Equip</button>
          <button data-act="again">Open another · ${coinText(c.price)}</button>
          <button data-act="sell">Sell +${coinText(RARITY[won.rarity].sell)}</button>
          <button data-act="done">Done</button>
        </div>`;
      const again = $<HTMLButtonElement>(r, '[data-act="again"]');
      again.disabled = stash.inv.coins < c.price;
      r.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (act === 'equip') {
          stash.equip(got.u);
          toast(`Equipped ${won.name}`);
        } else if (act === 'sell') {
          sfx.coin();
          stash.sell(got.u);
          close();
        } else if (act === 'again') open(c);
        else if (act === 'done') close();
      });
      $(r, '[data-act="done"]').focus();
    };

    if (still) return reveal();
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    void track.offsetWidth;
    track.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.1, 0.75, 0.12, 1)`;
    track.style.transform = `translateX(${stop}px)`;
    raf = requestAnimationFrame(watch);
    timer = window.setTimeout(reveal, SPIN_MS + 150);
  }

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-open]');
    if (b && !b.disabled) open(CASES.find((c) => c.id === b.dataset.open)!);
  });

  return () => {
    close();
    off();
  };
}
