// The Style → Locker page and the case reel: browse what you own by slot, try things on in the showroom and equip them
// on the car you drive; and the reel that spins to a drop (the roll is the server's for accounts, so it only ever spins
// to a drop that's already decided). The cases are sold on the Shop (shopui.ts, which reuses `crateArt` and `contents`).

import { type OwnedCar } from '../shared/cars.ts';
import { COS_CASES, COS_ITEMS, COS_SLOTS, CATALOG, type CosCase, type CosItem, type CosSlot, RARITIES, type ShellStyle, RARITY, SLOT_INFO, caseItems, caseOdds, cosById, PLATE_MAX, passOnly, rollCosCase } from '../shared/cosmetics.ts';
import { tierFor } from '../shared/pass.ts';
import type { CaseDrop, Garage } from '../shared/garage.ts';
import { $, esc } from '../../client/menu/ui.ts';
import { money } from './hud.ts';
import './cosmetics.css';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rarityCss = (it: CosItem) => hex(RARITY[it.rarity].color);

/** A CSS picture of an item for cards and reel tiles: a background and an optional glyph. */
function swatch(it: CosItem): { bg: string; glyph?: string; glow?: string } {
  switch (it.slot) {
    case 'paint': {
      const { base, accent, accent2, finish, pattern } = it.fx;
      if (finish === 'chrome') return { bg: `linear-gradient(135deg, #fff 0%, ${hex(base)} 25%, #222 50%, ${hex(pattern === 'fade' ? accent : base)} 75%, #fff 100%)` };
      if (finish === 'flip') return { bg: `conic-gradient(from 30deg, ${hex(base)}, #6a2aff, #22e6ff, #ffd76a, ${hex(base)})` };
      if (pattern === 'solid') return { bg: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${finish === 'matte' ? 0.12 : 0.5}), transparent 50%), ${hex(base)}` };
      if (pattern === 'fade') return { bg: `linear-gradient(90deg, ${hex(base)}, ${hex(accent)})` };
      if (pattern === 'racing') return { bg: `linear-gradient(90deg, ${hex(base)} 0 38%, ${hex(accent)} 38% 46%, ${hex(base)} 46% 54%, ${hex(accent)} 54% 62%, ${hex(base)} 62%)` };
      if (pattern === 'checker') return { bg: `repeating-conic-gradient(${hex(base)} 0 25%, ${hex(accent)} 0 50%) 0 0 / 16px 16px` };
      return { bg: `linear-gradient(135deg, ${hex(base)} 0 45%, ${hex(accent)} 45% 70%, ${hex(accent2)} 70%)`, glow: it.fx.glow ? hex(accent) : undefined };
    }
    case 'decal': {
      // The whole word (the card's CSS wraps and shrinks long ones): cutting at four letters read "DRIF" for Drift King.
      const glyph = { wakaba: '🔰', momiji: '🍂', sakura: '🌸', bolt: '⚡', stars: '★', rising: '☀', shark: '🦈', kitsune: '🦊' }[it.fx.kind as string] ?? (it.fx.text ?? '');
      return { bg: hex(it.fx.ink2), glyph, glow: it.fx.glow ? hex(it.fx.ink) : undefined };
    }
    case 'window':
      return { bg: it.fx.iri ? `linear-gradient(135deg, ${hex(it.fx.color)}, #6a2aff 40%, #22e6ff 60%, ${hex(it.fx.color)})` : `linear-gradient(160deg, rgba(255,255,255,${it.fx.mirror ? 0.7 : 0.25}) 0 20%, transparent 21%), ${hex(it.fx.color)}` };
    case 'head':
      return { bg: `radial-gradient(circle, #fff 0 18%, ${hex(it.fx.color)} 40%, #0b0e14 72%)`, glow: hex(it.fx.color) };
    case 'tail':
      return { bg: `radial-gradient(circle, ${hex(it.fx.light)} 0 30%, ${hex(it.fx.lens)} 62%, #0b0e14 75%)`, glow: hex(it.fx.light) };
    case 'rims':
      return { bg: `radial-gradient(circle, #0b0e14 0 14%, ${hex(it.fx.color)} 16% 52%, #1a1b1e 54% 70%, #0b0e14 72%)`, glow: it.fx.glow ? hex(it.fx.color) : undefined };
    case 'caliper':
      return { bg: `radial-gradient(circle at 40% 40%, rgba(255,255,255,.5), transparent 40%), ${hex(it.fx.color)}`, glow: it.fx.glow ? hex(it.fx.color) : undefined };
    case 'glow':
      return { bg: `radial-gradient(ellipse at 50% 80%, ${hex(it.fx.color)} 0, transparent 70%), #0b0e14`, glow: hex(it.fx.color) };
    case 'plate':
      return { bg: `linear-gradient(90deg, ${it.fx.band !== undefined ? hex(it.fx.band) + ' 0 14%, ' : ''}${hex(it.fx.bg)} ${it.fx.band !== undefined ? '14%' : '0'})`, glyph: it.fx.text ?? 'ABC', glow: it.fx.glow ? hex(it.fx.ink) : undefined };
    case 'frame':
      return { bg: `linear-gradient(rgba(5,6,8,${it.fx.cover}), rgba(5,6,8,${it.fx.cover})), #f4f1e8`, glyph: 'ABC', glow: it.fx.glow ? hex(it.fx.color) : undefined };
    case 'exhaust':
      return { bg: `radial-gradient(circle, ${it.fx.heat ? hex(it.fx.heat) : '#050505'} 0 30%, ${hex(it.fx.color)} 34% 58%, #0b0e14 62%)`, glow: it.fx.heat ? hex(it.fx.heat) : undefined };
    case 'shell':
      return { bg: `url('${shellArt(it.fx.style)}') center / 92% no-repeat, radial-gradient(circle at 50% 70%, #3a1418, #0b0e14 70%)`, glow: it.fx.style === 'kage' ? '#22e6ff' : it.fx.style === 'oni' ? '#ff2a3a' : undefined };
    default: {
      // Body parts: the material as the background, a glyph for the part.
      const fx = it.fx;
      const bg =
        fx.mat === 'carbon'
          ? 'repeating-linear-gradient(45deg, #1b1d22 0 4px, #2c2f36 4px 8px)'
          : fx.mat === 'chrome'
            ? 'linear-gradient(135deg, #fff 0%, #9aa3ad 30%, #2a2d33 50%, #c9d0d8 75%, #fff 100%)'
            : fx.mat === 'paint'
              ? 'linear-gradient(135deg, #5a6170, #2a2f3a)'
              : `radial-gradient(circle at 35% 30%, rgba(255,255,255,.4), transparent 50%), ${hex(fx.color ?? 0x888888)}`;
      return { bg, glyph: PART_GLYPH[('style' in fx ? fx.style : it.slot) as string] ?? SLOT_INFO[it.slot].icon, glow: fx.glow !== undefined ? hex(fx.glow) : undefined };
    }
  }
}

/** Side views of the body kits (nose left) for cards: the shell in white, wheels, and each kit's tell. */
const SHELL_ART: Record<ShellStyle, string> = {
  kaido: '<path d="M4 29 L8 22 L30 19 L42 12 L58 11 L70 17 L94 19 L96 29 Z"/><path d="M80 18 L82 6 M88 18 L88 6" stroke="#f2f2f0" stroke-width="2"/><path d="M74 6 L98 5" stroke="#f2f2f0" stroke-width="3"/><path d="M90 26 L99 9" stroke="#d9dde4" stroke-width="2.5"/>',
  safari: '<path d="M5 28 L7 20 L30 17 L42 10 L60 10 L72 16 L93 18 L95 28 Z"/><rect x="44" y="6" width="14" height="3" rx="1"/><path d="M38 18 L40 8 L46 8" stroke="#2a2d33" stroke-width="2.5" fill="none"/><ellipse cx="82" cy="16" rx="9" ry="2.5" fill="#2a2d33"/>',
  wedge: '<path d="M3 27 L50 13 L64 12 L96 15 L96 28 Z"/><path d="M80 14 L82 8 M92 14 L92 8" stroke="#f2f2f0" stroke-width="1.5"/><path d="M74 7 L99 9" stroke="#f2f2f0" stroke-width="2.5"/>',
  gt: '<path d="M3 29 L8 23 L22 18 L42 12 L58 11 L72 17 L95 19 L96 29 Z"/><path d="M84 18 C 84 10, 88 8, 88 8" stroke="#9aa3ad" stroke-width="1.6" fill="none"/><path d="M78 8 L99 7" stroke="#2c2f36" stroke-width="3"/><path d="M2 30 L14 30" stroke="#2c2f36" stroke-width="1.5"/>',
  longtail: '<path d="M3 28 L10 22 L26 18 L42 12 L58 11 L72 17 L90 18 L99 24 L98 28 Z"/><path d="M60 11 L90 8 L94 18" fill="#f2f2f0"/><path d="M90 9 L99 9" stroke="#2c2f36" stroke-width="2.5"/>',
  kage: '<path d="M2 28 L18 21 L40 12 L58 11 L70 16 L96 18 L97 28 Z" fill="#14161b" stroke="#22e6ff" stroke-width="1"/><path d="M76 11 L98 11" stroke="#22e6ff" stroke-width="1.6"/><path d="M8 25 L30 18" stroke="#22e6ff" stroke-width="1"/>',
  wangan: '<path d="M2 28 L12 22 L34 17 L44 12 L58 11 L72 16 L94 17 L98 15 L98 28 Z"/><path d="M14 23 L30 19" stroke="#2a2d33" stroke-width="1.2"/>',
  missile: '<path d="M6 29 L8 21 L30 18 L42 12 L58 11 L70 17 L94 19 L96 29 Z"/><path d="M8 21 L30 18 L30 26 L8 27 Z" fill="#8b8f93"/><path d="M42 18 L56 18 L56 27 L42 27 Z" fill="#e8e6df" stroke="#2a2d33" stroke-width=".6"/><path d="M78 9 L98 8" stroke="#9a6a3a" stroke-width="3"/><path d="M2 26 C 3 22, 6 22, 7 24" stroke="#2a2d33" stroke-width="1.5" fill="none"/>',
  kustom: '<path d="M4 29 L6 19 L30 17 L42 12 L58 11 L72 17 L92 18 L96 29 Z"/><rect x="18" y="9" width="10" height="9" rx="1.5" fill="#d9dde4"/><rect x="17" y="6" width="12" height="4" rx="1" fill="#2a2d33"/><circle cx="7" cy="15" r="3" fill="#d9dde4"/><path d="M30 31 L70 31" stroke="#d9dde4" stroke-width="2.4"/>',
  classic: '<path d="M3 28 C 3 20, 10 18, 30 17 L42 12 C 50 9, 60 10, 70 16 L90 17 C 96 18, 97 22, 97 28 Z"/><path d="M14 22 L88 22" stroke="#d9dde4" stroke-width="1"/><path d="M14 18 C 22 16, 30 16, 36 16" stroke="#2a2d33" stroke-width="1" fill="none"/>',
  hyper: '<path d="M2 29 L14 21 L40 12 L58 11 L68 15 L96 18 L97 29 Z"/><path d="M58 11 L90 16 L66 16 Z" fill="#c9cdd3"/><path d="M40 22 L64 20 L64 26 L42 27 Z" fill="#2c2f36"/><path d="M84 15 L98 15" stroke="#2c2f36" stroke-width="2"/>',
  oni: '<path d="M2 28 L16 21 L40 12 L58 11 L70 16 L96 18 L97 28 Z" fill="#14161b" stroke="#ff2a3a" stroke-width="1"/><path d="M16 20 C 18 12, 22 8, 26 6" stroke="#f1ead8" stroke-width="2.4" fill="none"/><path d="M46 10 L48 6 L50 10 M54 10 L56 6 L58 10 M64 13 L66 9 L68 14 M74 16 L76 12 L78 17" fill="#14161b" stroke="#14161b"/><path d="M5 25 L14 22" stroke="#ff2a3a" stroke-width="1.6"/><path d="M76 11 L98 11" stroke="#ff2a3a" stroke-width="1.6"/>',
};
const shellArt = (style: ShellStyle) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><g fill="#f2f2f0">${SHELL_ART[style]}</g><circle cx="24" cy="29" r="6" fill="#0b0e14" stroke="#9aa3ad" stroke-width="1.5"/><circle cx="78" cy="29" r="6" fill="#0b0e14" stroke="#9aa3ad" stroke-width="1.5"/></svg>`,
  );

/** Glyphs for body parts on cards (by style; mudflaps by slot). */
const PART_GLYPH: Record<string, string> = {
  ducktail: '⌒', trunklip: '‿', gt: '⊤', swan: '⟙', dual: '⫪', bosozoku: '⥣',
  vents: '≋', naca: '⌄', scoop: '⏏', louvres: '☰', snorkels: '⫴', shaker: '⏏', blower: '⚙',
  fin: '🦈', rack: '⊞', lightbar: '💡', box: '🧳', surf: '🏄', duck: '🦆', halo: '😇',
  lip: '⌣', splitter: '▁', canards: '⋀', tow: '🪝', bullbar: '🐂',
  skirts: '▬', flares: '◖', rivets: '⁘', sidepipes: '🔥', flaps: '▮',
};

export function art(it: CosItem): string {
  const s = swatch(it);
  const ink = it.slot === 'plate' || it.slot === 'decal' ? hex(it.fx.ink) : it.slot === 'frame' ? '#1b1d22' : '#fff';
  const frame = it.slot === 'frame' ? `--fc:${hex(it.fx.color)};` : '';
  // Long words (sponsor names, banners) get a smaller, wrapping label so they fit inside the round swatch.
  const long = s.glyph && it.slot === 'decal' && [...s.glyph].length > 4 ? ' long' : '';
  return `<i class="cz-art ${it.slot}" style="${frame}background:${s.bg};${s.glow ? `--glow:${s.glow};` : ''}color:${ink}">${s.glyph ? `<b class="${long.trim()}">${esc(s.glyph)}</b>` : ''}</i>`;
}

/** A card in the rarity's colour. */
export function itemCard(it: CosItem, extra = ''): string {
  return `<span class="cz-card ${it.rarity}" style="--r:${rarityCss(it)}">${art(it)}<b>${esc(it.name)}</b><small>${esc(SLOT_INFO[it.slot].name)} · ${passOnly(it) ? 'Battle pass' : RARITY[it.rarity].name}</small>${extra}</span>`;
}

const pct = (p: number) => (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';

export function oddsRow(box: CosCase): string {
  const o = caseOdds(box.id);
  return `<div class="cz-odds">${RARITIES.filter((r) => o[r])
    .map((r) => `<span style="--r:${hex(RARITY[r].color)}"><i></i>${RARITY[r].name} <b>${pct(o[r]!)}</b></span>`)
    .join('')}</div>`;
}

export function contents(box: CosCase, owned: Set<string>): string {
  const items = caseItems(box.id);
  const o = caseOdds(box.id);
  return [...RARITIES]
    .reverse()
    .filter((r) => o[r])
    .map((r) => {
      const tier = items.filter((i) => i.rarity === r);
      return `<h4 style="--r:${hex(RARITY[r].color)}">${RARITY[r].name} <small>${pct(o[r]!)} · ${pct(o[r]! / tier.length)} each</small></h4>
        <div class="cz-grid">${tier.map((i) => itemCard(i, owned.has(i.id) ? '<em class="cz-owned">✓</em>' : '')).join('')}</div>`;
    })
    .join('');
}

export const crateArt = (box: CosCase) => `
  <svg viewBox="0 0 96 80" aria-hidden="true">
    <rect x="8" y="24" width="80" height="52" rx="7" fill="#1a2030" stroke="${hex(box.color)}" stroke-width="3"/>
    <rect x="4" y="12" width="88" height="20" rx="6" fill="${hex(box.color)}"/>
    <rect x="40" y="12" width="16" height="64" fill="#0b0e14" opacity=".55"/>
    <circle cx="48" cy="46" r="7" fill="${hex(box.color)}"/>
    <path d="M80 2 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fff"/>
  </svg>`;

/** The Locker tab: slots down the side, that slot's items (owned first), equip or try on. */
export function lockerTab(g: Garage, car: OwnedCar, carName: string, slot: CosSlot, trying: string | null, status: string): string {
  const owned = new Set(g.cos);
  const items = [...(CATALOG[slot] as readonly CosItem[])].sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)) || RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  const on = car.cos[slot];
  const tryItem = cosById(trying);
  const where = (it: CosItem) => COS_CASES.filter((c) => caseItems(c.id).includes(it)).map((c) => c.name).join(', ');
  return `
    <h2 class="tg-h">Locker <small>on your ${esc(carName)} · ${owned.size}/${COS_ITEMS.length} collected</small></h2>
    <div class="cz-slots" role="tablist" aria-label="Cosmetic slots">
      ${COS_SLOTS.map((s) => {
        const have = (CATALOG[s] as readonly CosItem[]).filter((i) => owned.has(i.id)).length;
        const worn = cosById(car.cos[s]);
        return `<button class="tg-pill${s === slot ? ' on' : ''}" role="tab" aria-selected="${s === slot}" data-slot="${s}" ${worn ? `style="--r:${rarityCss(worn)}"` : ''}>${SLOT_INFO[s].icon} ${esc(SLOT_INFO[s].name)} <small>${have}/${CATALOG[s].length}</small>${worn ? '<i class="cz-dot"></i>' : ''}</button>`;
      }).join('')}
    </div>
    <div class="tg-row">
      <span class="tg-label">${esc(SLOT_INFO[slot].name)}: ${on ? esc(cosById(on)!.name) : 'stock'}</span>
      ${on ? `<button class="tg-pill" data-unequip="${slot}">Back to stock</button>` : ''}
    </div>
    ${slot === 'shell' && car.model !== 'vanta' ? `<p class="tg-muted">Body kits are made for the Vanta V10: pick your Vanta in the garage to wear or try one on.</p>` : ''}
    ${tryItem ? `<p class="cz-trying" style="--r:${rarityCss(tryItem)}">Trying on <b>${esc(tryItem.name)}</b>. Not yours yet: ${passOnly(tryItem) ? `it's a battle pass reward (tier ${tierFor('cos', tryItem.id)})` : `find it in the ${esc(where(tryItem))}`}.</p>` : ''}
    ${
      slot === 'plate' || slot === 'frame'
        ? `<div class="tg-row cz-plate"><label><span class="tg-label">Plate text</span><input data-plate-text maxlength="${PLATE_MAX}" placeholder="stock" autocomplete="off" spellcheck="false" /></label><button class="tg-pill" data-plate-save>Save</button></div>`
        : ''
    }
    <div class="cz-grid locker">
      ${items
        .map((it) => {
          const mine = owned.has(it.id);
          const state = it.id === on ? '<em class="cz-on">Equipped</em>' : mine ? '' : '<em class="cz-lock">🔒</em>';
          return `<button class="cz-pick${mine ? '' : ' locked'}" data-cos="${it.id}" aria-pressed="${it.id === on || it.id === trying}" title="${mine ? 'Equip' : 'Try on'}">${itemCard(it, state)}</button>`;
        })
        .join('')}
    </div>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
}

// ---------------------------------------------------------------------------------------------
// The reel

const REEL_LEN = 48;
const WIN = 40;
const TILE = 132; // tile width + margins, px (matches cosmetics.css)
const SPIN_MS = 5200;

/**
 * Spins the reel in `modal` to `drop` (already decided and paid for) and shows what you got. `act` hears the
 * buttons: 'equip' (wear it on the current car), 'again' (open another of the same case), 'done' (close).
 */
export function showCaseReel(modal: HTMLElement, box: CosCase, drop: CaseDrop, canAgain: boolean, act: (what: 'equip' | 'again' | 'done') => void) {
  const won = cosById(drop.id)!;
  const tiles = Array.from({ length: REEL_LEN }, (_, i) => (i === WIN ? won : rollCosCase(box.id, Math.random)));
  modal.innerHTML = `<div class="tg-reel-card cz-reel-card" data-nav-scope style="--c:${hex(box.color)}">
      <h2>Opening ${esc(box.name)}…</h2>
      <div class="tg-reel cz-reel"><div class="tg-reel-strip">${tiles.map((t) => `<div class="cz-tile" style="--r:${rarityCss(t)}">${art(t)}<small>${esc(t.name)}</small></div>`).join('')}</div><i class="tg-reel-mark"></i></div>
      <div class="cz-result" aria-live="polite"></div>
      <div class="cz-actions" hidden>
        <button class="tg-go small" data-cz="equip">Equip it</button>
        <button class="tg-pill" data-cz="again" ${canAgain ? '' : 'disabled'}>Open another · ${money(box.price)}</button>
        <button class="tg-pill" data-ok data-cz="done">Done</button>
      </div></div>`;
  modal.hidden = false;
  const strip = $(modal, '.tg-reel-strip');
  const reel = $(modal, '.tg-reel');
  const reveal = () => {
    const card = $(modal, '.tg-reel-card');
    card.classList.add('revealed', won.rarity);
    card.style.setProperty('--r', rarityCss(won));
    $(modal, 'h2').textContent = drop.dup ? 'Duplicate' : won.rarity === 'mythic' ? 'MYTHIC!' : won.rarity === 'legendary' ? 'LEGENDARY!' : 'New unlock!';
    $(modal, '.cz-result').innerHTML = `${itemCard(won)}<p>${drop.dup ? `You already have this one: <b>+${money(drop.refund)}</b> back.` : `<b>${RARITY[won.rarity].name}</b> ${esc(SLOT_INFO[won.slot].name.toLowerCase())}, added to your locker.`}</p>`;
    const acts = $(modal, '.cz-actions');
    acts.hidden = false;
    acts.querySelectorAll<HTMLButtonElement>('[data-cz]').forEach((b) => b.addEventListener('click', () => act(b.dataset.cz as 'equip' | 'again' | 'done')));
    $<HTMLButtonElement>(modal, '[data-cz="equip"]').focus();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return reveal();
  const target = WIN * TILE + TILE / 2 - reel.clientWidth / 2 + (Math.random() - 0.5) * (TILE * 0.6);
  strip.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-target}px)` }], { duration: SPIN_MS, easing: 'cubic-bezier(0.1, 0.72, 0.12, 1)', fill: 'forwards' }).finished.then(reveal, reveal);
}
