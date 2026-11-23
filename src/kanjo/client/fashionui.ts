// The Shop's Fashion page (hub.ts hosts it as Shop → Fashion): luxury clothing for your own driver, $50k to $1M
// (shared/fashion.ts). Your driver stands in the showroom beside the rail; Try on puts a piece on them there, Buy pays
// for it (garage.ts `{a: 'fashion'}`) and puts it on, Wear / Take off switch an owned piece. Pure markup: hub.ts wires
// the buttons (data-fash-try, data-fash-buy, data-fash-wear). Styled by shop.css. `fashionArt` is also the creator's.

import { FASHION, FASHION_IDS, FASHION_SLOTS, type FashionId, type FashionItem, type FashionSlot } from '../shared/fashion.ts';
import type { Garage } from '../shared/garage.ts';
import type { Look } from '../shared/look.ts';
import { esc } from '../../client/menu/ui.ts';
import { money } from './hud.ts';
import './shop.css';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Each slot's heading and the line under it. */
export const SLOT_NAME: Record<FashionSlot, [name: string, line: string]> = {
  jacket: ['Jackets', 'worn over your top'],
  pants: ['Trousers', 'worn over your bottom'],
  hat: ['Hats', 'your hair tucks inside'],
  shades: ['Shades', 'measured to your face'],
  chain: ['Chains', 'over whatever you wear'],
};

/** A small flat drawing of the piece in its own colours (viewBox 64). */
export function fashionArt(it: FashionItem): string {
  const [m, a, d] = it.colors.map(hex);
  const s = `stroke="${a}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  let body: string;
  switch (it.slot) {
    case 'jacket': {
      const coat = it.kind === 'fur' ? 'M21 8 L32 13 L43 8 L55 16 L61 46 L52 48 L48 30 L49 60 L15 60 L16 30 L12 48 L3 46 L9 16 Z' : 'M21 8 L32 13 L43 8 L55 16 L61 42 L52 44 L48 28 L48 54 L16 54 L16 28 L12 44 L3 42 L9 16 Z';
      const trim =
        it.kind === 'varsity' ? `<path d="M9 16 L3 42 L12 44 L16 28" fill="${a}"/><path d="M55 16 L61 42 L52 44 L48 28" fill="${a}"/><path d="M16 50 H48" stroke="${d}" stroke-width="3"/>`
        : it.kind === 'leather' ? `<path d="M24 12 L22 54 M40 12 L42 54" ${s} stroke="${a}"/>`
        : it.kind === 'puffer' ? `<path d="M16 26 H48 M16 34 H48 M16 42 H48 M5 32 L13 30 M59 32 L51 30" stroke="${a}" stroke-width="2"/>`
        : it.kind === 'monogram' ? `<g fill="${a}"><circle cx="24" cy="24" r="1.6"/><circle cx="40" cy="24" r="1.6"/><circle cx="32" cy="34" r="1.6"/><circle cx="24" cy="44" r="1.6"/><circle cx="40" cy="44" r="1.6"/></g>`
        : it.kind === 'chrome' ? `<path d="M18 22 L30 50 M34 20 L44 44" stroke="#fff" stroke-opacity=".7" stroke-width="3"/>`
        : `<path d="M21 8 L32 30 L43 8 L46 12 L32 36 L18 12 Z" fill="${a}"/>`;
      body = `<path d="${coat}" fill="${m}"/>${trim}<path d="M32 13 V${it.kind === 'fur' ? 60 : 54}" stroke="${d}" stroke-width="1.6"/>`;
      break;
    }
    case 'pants': {
      const legs = 'M18 6 H46 L50 60 H36 L32 24 L28 60 H14 Z';
      const trim =
        it.kind === 'track' ? `<path d="M17 10 L14.5 58 M47 10 L49.5 58" stroke="${a}" stroke-width="2.4"/>`
        : it.kind === 'cargo' ? `<rect x="14" y="30" width="10" height="10" rx="1.5" fill="${a}"/><rect x="40" y="30" width="10" height="10" rx="1.5" fill="${a}"/>`
        : it.kind === 'moto' ? `<path d="M17 36 L28 36 M36 36 L48 36 M17 40 L28 40 M36 40 L48 40" stroke="${a}" stroke-width="1.6"/><path d="M16 12 L14 58 M48 12 L50 58" stroke="${d}" stroke-width="1.4"/>`
        : `<g fill="${a}"><circle cx="22" cy="18" r="4"/><circle cx="40" cy="30" r="5"/><circle cx="20" cy="44" r="4"/></g><g fill="${d}"><circle cx="38" cy="14" r="3"/><circle cx="24" cy="32" r="3"/><circle cx="44" cy="50" r="3"/></g>`;
      body = `<path d="${legs}" fill="${m}"/>${trim}<rect x="18" y="6" width="28" height="5" fill="${d}" fill-opacity=".7"/>`;
      break;
    }
    case 'hat': {
      if (it.kind === 'beanie') body = `<path d="M14 42 C14 14 50 14 50 42 Z" fill="${m}"/><rect x="12" y="38" width="40" height="10" rx="2" fill="${a}"/><path d="M20 39 V47 M26 39 V47 M32 39 V47 M38 39 V47 M44 39 V47" stroke="${m}" stroke-width="1.4"/>`;
      else if (it.kind === 'bucket') body = `<path d="M18 40 L21 18 H43 L46 40 Z" fill="${m}"/><path d="M6 46 L18 38 H46 L58 46 Z" fill="${a}"/><g fill="${d}"><circle cx="27" cy="26" r="1.6"/><circle cx="37" cy="26" r="1.6"/><circle cx="32" cy="33" r="1.6"/></g>`;
      else body = `<path d="M12 40 C12 16 48 14 50 40 Z" fill="${m}"/><path d="M44 36 C52 36 60 38 62 42 L44 42 Z" fill="${a}"/><path d="M31 17 V40" stroke="${a}" stroke-width="1.6"/><circle cx="31" cy="17" r="2" fill="${d}"/>`;
      break;
    }
    case 'shades':
      body =
        it.kind === 'shield'
          ? `<path d="M6 26 C18 22 46 22 58 26 L56 36 C46 42 18 42 8 36 Z" fill="url(#fa-lens-${it.kind})"/><path d="M6 26 C18 22 46 22 58 26" ${s} fill="none" stroke="${m}"/><defs><linearGradient id="fa-lens-${it.kind}" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${d}"/></linearGradient></defs>`
          : `<circle cx="19" cy="32" r="10" fill="${a}" stroke="${m}" stroke-width="2.4"/><circle cx="45" cy="32" r="10" fill="${a}" stroke="${m}" stroke-width="2.4"/><path d="M29 30 C31 27 33 27 35 30 M9 30 L3 27 M55 30 L61 27" stroke="${m}" stroke-width="2.4" fill="none"/>`;
      break;
    default: {
      const links = Array.from({ length: 11 }, (_, i) => {
        const t = (i / 10) * Math.PI;
        return `<ellipse cx="${(32 - Math.cos(t) * 22).toFixed(1)}" cy="${(12 + Math.sin(t) * 30).toFixed(1)}" rx="3.6" ry="2.6" fill="none" stroke="${i % 2 ? a : m}" stroke-width="2.2"/>`;
      }).join('');
      body = links + (it.kind === 'pendant' ? `<path d="M32 42 L39 50 L32 60 L25 50 Z" fill="${a}" stroke="${d}" stroke-width="1.4"/>` : '');
    }
  }
  return `<svg class="fa-svg" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
}

/** One piece's card. `look`: your driver as saved; `trying`: the piece being tried on, if any. */
function card(id: FashionId, g: Garage, look: Look, trying: FashionId | null, i: number): string {
  const it = FASHION[id];
  const owned = g.fash.includes(id);
  const worn = look.fashion.includes(id);
  const on = trying === id;
  const acts = owned
    ? `${worn ? '<span class="tg-tag">Wearing</span>' : '<span class="tg-tag you">Owned</span>'}
       <button class="tg-pill" data-fash-wear="${id}" aria-pressed="${worn}">${worn ? 'Take off' : 'Wear'}</button>`
    : `<button class="tg-pill" data-fash-try="${id}" aria-pressed="${on}">${on ? 'Take off' : 'Try on'}</button>
       <button class="tg-go small" data-fash-buy="${id}" ${g.money < it.price ? 'disabled title="Not enough money"' : ''}>Buy<span class="sh-price tg-num">${money(it.price)}</span></button>`;
  return `<article class="fa-card${owned ? ' own' : ''}${on || worn ? ' on' : ''}${it.price >= 700_000 ? ' grail' : ''}" style="--c:${hex(it.colors[0])}; --a:${hex(it.colors[1])}; --i:${i}">
    <div class="fa-art">${fashionArt(it)}</div>
    <div class="fa-copy">
      <small class="tg-eyebrow">${esc(it.house)}</small>
      <h3>${esc(it.name)}</h3>
      <p>${esc(it.line)}</p>
    </div>
    <div class="fa-act">${acts}</div>
  </article>`;
}

/** The Fashion page body. `custom`: your driver is your own (the legends don't wear fashion). */
export function fashionTab(g: Garage, look: Look, trying: FashionId | null, custom: boolean, status: string): string {
  const groups = FASHION_SLOTS.map((slot) => {
    const ids = FASHION_IDS.filter((id) => FASHION[id].slot === slot);
    const [name, line] = SLOT_NAME[slot];
    return `<h3 class="tg-h">${name} <small>${line}</small></h3>
      <div class="fa-list">${ids.map((id, i) => card(id, g, look, trying, i)).join('')}</div>`;
  }).join('');
  return `<div class="fa">
    <p class="tg-lede">Statement pieces for <b>your own driver</b>. Try anything on in the showroom; what you buy is yours for good, and you can wear it or take it off here or in the driver creator.</p>
    ${custom ? '' : `<p class="tg-note">You're driving as a legend. Wearing a piece switches you back to <b>your own driver</b>.</p>`}
    <small class="fa-count tg-num">${g.fash.length}/${FASHION_IDS.length} owned</small>
    ${groups}
    <p class="tg-status" role="status" data-status>${esc(status)}</p>
  </div>`;
}
