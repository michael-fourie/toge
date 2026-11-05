// The garage's Cases and Locker tabs: buy and open cosmetic cases (the roll is the server's for accounts,
// so the reel only ever spins to a drop that's already decided), and browse what you own by slot, try
// things on in the showroom and equip them on the car you drive. hub.ts hosts both tabs.

import { type OwnedCar } from '../shared/cars.ts';
import { COS_CASES, COS_ITEMS, COS_SLOTS, CATALOG, type CosCase, type CosItem, type CosSlot, RARITIES, RARITY, SLOT_INFO, caseItems, caseOdds, cosById, PLATE_MAX, rollCosCase } from '../shared/cosmetics.ts';
import type { CaseDrop, Garage } from '../shared/garage.ts';
import { $, esc } from '../../client/menu/ui.ts';
import { money } from './hud.ts';
import './cosmetics.css';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rarityCss = (it: CosItem) => hex(RARITY[it.rarity].color);

/** A decal's word on its swatch: whole if it's short, else its first word (glyphPx shrinks it to fit). */
const shortText = (t: string) => (t.length <= 10 ? t : t.split(' ')[0].slice(0, 8));

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
      const glyph = { wakaba: '🔰', momiji: '🍂', sakura: '🌸', bolt: '⚡', stars: '★', rising: '☀', shark: '🦈', kitsune: '🦊' }[it.fx.kind as string] ?? shortText(it.fx.text ?? '');
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
  }
}

/** Text on a swatch shrinks to fit its ~50 px (long decal words were cut to "DRIF"). */
const glyphPx = (g: string) => Math.max(8, Math.min(16, Math.floor(92 / g.length)));

function art(it: CosItem): string {
  const s = swatch(it);
  const ink = it.slot === 'plate' || it.slot === 'decal' ? hex(it.fx.ink) : it.slot === 'frame' ? '#1b1d22' : '#fff';
  const frame = it.slot === 'frame' ? `--fc:${hex(it.fx.color)};` : '';
  return `<i class="cz-art ${it.slot}" style="${frame}background:${s.bg};${s.glow ? `--glow:${s.glow};` : ''}color:${ink}">${s.glyph ? `<b style="font-size:${glyphPx(s.glyph)}px">${esc(s.glyph)}</b>` : ''}</i>`;
}

/**
 * A card in the rarity's colour. `label` picks the caption: where a list already says the slot (the Locker's slot
 * tabs) or the rarity (a case's tiers), it says only the other one, so it fits on one line.
 */
export function itemCard(it: CosItem, extra = '', label: 'both' | 'slot' | 'rarity' = 'both'): string {
  const caption = label === 'slot' ? SLOT_INFO[it.slot].name : label === 'rarity' ? RARITY[it.rarity].name : `${SLOT_INFO[it.slot].name} · ${RARITY[it.rarity].name}`;
  return `<span class="cz-card ${it.rarity}" style="--r:${rarityCss(it)}">${art(it)}<b>${esc(it.name)}</b><small>${esc(caption)}</small>${extra}</span>`;
}

const pct = (p: number) => (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';

function oddsRow(box: CosCase): string {
  const o = caseOdds(box.id);
  return `<div class="cz-odds">${RARITIES.filter((r) => o[r])
    .map((r) => `<span style="--r:${hex(RARITY[r].color)}"><i></i>${RARITY[r].name} <b>${pct(o[r]!)}</b></span>`)
    .join('')}</div>`;
}

function contents(box: CosCase, owned: Set<string>): string {
  const items = caseItems(box.id);
  const o = caseOdds(box.id);
  return [...RARITIES]
    .reverse()
    .filter((r) => o[r])
    .map((r) => {
      const tier = items.filter((i) => i.rarity === r);
      return `<h4 style="--r:${hex(RARITY[r].color)}">${RARITY[r].name} <small>${pct(o[r]!)} · ${pct(o[r]! / tier.length)} each</small></h4>
        <div class="cz-grid">${tier.map((i) => itemCard(i, owned.has(i.id) ? '<em class="cz-owned">✓</em>' : '', 'slot')).join('')}</div>`;
    })
    .join('');
}

const crateArt = (box: CosCase) => `
  <svg viewBox="0 0 96 80" aria-hidden="true">
    <rect x="8" y="24" width="80" height="52" rx="7" fill="#1a2030" stroke="${hex(box.color)}" stroke-width="3"/>
    <rect x="4" y="12" width="88" height="20" rx="6" fill="${hex(box.color)}"/>
    <rect x="40" y="12" width="16" height="64" fill="#0b0e14" opacity=".55"/>
    <circle cx="48" cy="46" r="7" fill="${hex(box.color)}"/>
    <path d="M80 2 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fff"/>
  </svg>`;

/** The Cases tab: every case with its price, odds and contents. */
export function casesTab(g: Garage, status: string): string {
  const owned = new Set(g.cos);
  return `
    <h2 class="tg-h">Cosmetic cases <small>${owned.size}/${COS_ITEMS.length} collected · duplicates pay money back</small></h2>
    <div class="cz-cases">
      ${COS_CASES.map(
        (box) => `<article class="cz-case" style="--c:${hex(box.color)}">
          <div class="cz-case-art">${crateArt(box)}</div>
          <div class="cz-case-info">
            <h3>${esc(box.name)}</h3>
            <p>${esc(box.blurb)}</p>
            ${oddsRow(box)}
            <button class="tg-go small" data-case-open="${box.id}" ${g.money < box.price ? 'disabled title="Not enough money"' : ''}>Open · ${money(box.price)}</button>
          </div>
          <details class="cz-inside"><summary>What's inside (${caseItems(box.id).length} items, ${caseItems(box.id).filter((i) => owned.has(i.id)).length} owned)</summary><div data-inside="${box.id}"></div></details>
        </article>`,
      ).join('')}
    </div>
    <p class="tg-muted">Duplicate refunds: ${RARITIES.map((r) => `${RARITY[r].name} ${money(RARITY[r].refund)}`).join(' · ')}</p>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>`;
}

/** Fills a case's contents when its drawer is first opened (the lists are long). */
export function wireCases(panel: HTMLElement, g: Garage) {
  for (const d of panel.querySelectorAll<HTMLDetailsElement>('.cz-inside')) {
    d.addEventListener('toggle', () => {
      const box = $(d, '[data-inside]');
      if (d.open && !box.innerHTML) box.innerHTML = contents(COS_CASES.find((c) => c.id === box.dataset.inside)!, new Set(g.cos));
    });
  }
}

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
    ${tryItem ? `<p class="cz-trying" style="--r:${rarityCss(tryItem)}">Trying on <b>${esc(tryItem.name)}</b>. Not yours yet: find it in the ${esc(where(tryItem))}.</p>` : ''}
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
          return `<button class="cz-pick${mine ? '' : ' locked'}" data-cos="${it.id}" aria-pressed="${it.id === on || it.id === trying}" title="${mine ? 'Equip' : 'Try on'}">${itemCard(it, state, 'rarity')}</button>`;
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
      <div class="tg-reel cz-reel"><div class="tg-reel-strip">${tiles.map((t, i) => `<div class="cz-tile${i === WIN ? ' won' : ''}" style="--r:${rarityCss(t)}">${art(t)}<small>${esc(t.name)}</small></div>`).join('')}</div><i class="tg-reel-mark"></i></div>
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
