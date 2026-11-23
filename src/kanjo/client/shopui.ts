// The Shop tab (hub.ts hosts it): everything you can spend garage money on that isn't a car, on one full-width page of
// cards. The Battle pass is the hero, then the way into Fashion (fashionui.ts, the tab's second page); under them the
// cosmetic cases (each with its odds, price and a look inside) and the upgrade crate; the Dealer is a card that points
// at the cars. Pure markup: hub.ts wires the buttons (data-pass-buy, data-goto, data-case-open, data-case-inside,
// data-crate). Styled by shop.css.

import { CRATES, MYSTERY_COST, type Garage } from '../shared/garage.ts';
import { COS_CASES, COS_ITEMS, type CosCase, caseItems } from '../shared/cosmetics.ts';
import { PASS, TIERS, rewardName, tierProgress } from '../shared/pass.ts';
import { esc } from '../../client/menu/ui.ts';
import { contents, crateArt, oddsRow } from './cosmeticsui.ts';
import { rewardArt } from './passui.ts';
import { money } from './hud.ts';
import { FASHION, FASHION_IDS, FASHION_PRICES } from '../shared/fashion.ts';
import { fashionArt } from './fashionui.ts';
import './shop.css';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** How many of the pass's coming rewards the hero shows. */
const PASS_PREVIEW = 4;

/** The big Battle pass card across the top. */
function passHero(g: Garage): string {
  const p = tierProgress(g.xp);
  const done = p.tier >= PASS.tiers;
  const next = TIERS.slice(p.tier, p.tier + PASS_PREVIEW);
  const short = PASS.price - g.money;
  return `<section class="sh-hero" aria-label="Battle pass">
    <div class="sh-hero-copy">
      <small class="tg-eyebrow">${esc(PASS.season)} · Battle pass</small>
      <h2 class="sh-hero-title">${esc(PASS.name)}</h2>
      <p>${PASS.tiers} tiers of exclusive car parts, home backgrounds, driver gear, titles and cash. Every race earns XP; the pass hands over every tier you've reached.</p>
      <div class="sh-hero-bar"><span class="tg-pass-bar" style="--v:${p.into / p.need}"><i></i></span><small class="tg-num">Tier <b>${p.tier}</b> · ${done ? 'Season complete' : `${p.into} / ${p.need} XP`}</small></div>
      <div class="sh-hero-act">
        ${
          g.pass
            ? `<span class="tg-tag you">Pass owned</span>`
            : `<button class="tg-go" data-pass-buy ${short > 0 ? 'disabled' : ''}>Get the pass<span class="sh-price tg-num">${money(PASS.price)}</span></button>`
        }
        <button class="tg-pill" data-goto="pass">All rewards</button>
        ${!g.pass && short > 0 ? `<small class="sh-short">${money(short)} more to go. Race to earn it.</small>` : ''}
      </div>
    </div>
    <ol class="sh-hero-rewards" aria-label="Coming rewards">
      ${next.map((r, i) => `<li><span class="sh-reward-art">${rewardArt(r)}</span><b>${esc(rewardName(r))}</b><small>Tier ${p.tier + i + 1}</small></li>`).join('')}
    </ol>
  </section>`;
}

/** The way into Shop → Fashion: a strip of the grails and the price range. */
function fashionBanner(g: Garage): string {
  const show = (['emperor_fur', 'iced_pendant', 'chrome_bomber', 'gold_rounds', 'maison_bucket'] as const).map((id) => `<li>${fashionArt(FASHION[id])}</li>`).join('');
  return `<section class="sh-fash" aria-label="Fashion">
    <div class="sh-fash-copy">
      <small class="tg-eyebrow">New · Fashion</small>
      <h2 class="sh-fash-title">Dress to kill</h2>
      <p>Jackets, trousers, hats, shades and chains for your own driver, from ${money(FASHION_PRICES.min)} to ${money(FASHION_PRICES.max)}. Try them on first.</p>
      <div class="sh-hero-act">
        <button class="tg-go alt" data-goto="fashion">Shop fashion</button>
        <small class="tg-num sh-fash-own">${g.fash.length}/${FASHION_IDS.length} owned</small>
      </div>
    </div>
    <ul class="sh-fash-art" aria-hidden="true">${show}</ul>
  </section>`;
}

/** One case: its crate, the odds and the way in. */
function caseCard(box: CosCase, g: Garage, i: number): string {
  const have = caseItems(box.id).filter((it) => g.cos.includes(it.id)).length;
  const total = caseItems(box.id).length;
  const star = box.id === 'legend' || box.id === 'vanta';
  return `<article class="sh-card${star ? ' star' : ''}" style="--c:${hex(box.color)}; --i:${i}">
    ${star ? `<span class="sh-flag">${box.id === 'legend' ? 'Best odds' : 'Vanta only'}</span>` : ''}
    <div class="sh-card-art">${crateArt(box)}</div>
    <h3>${esc(box.name)}</h3>
    <p>${esc(box.blurb)}</p>
    ${oddsRow(box)}
    <div class="sh-card-foot">
      <small class="tg-num">${have}/${total} collected</small>
      <button class="tg-pill" data-case-inside="${box.id}">What's inside</button>
    </div>
    <button class="tg-go small" data-case-open="${box.id}" ${g.money < box.price ? 'disabled title="Not enough money"' : ''}>Open<span class="sh-price tg-num">${money(box.price)}</span></button>
  </article>`;
}

/** The Shop page body. */
export function shopTab(g: Garage, carName: string, status: string): string {
  return `<div class="sh">
    ${passHero(g)}
    ${fashionBanner(g)}
    <h2 class="tg-h">Cosmetic cases <small>${g.cos.length}/${COS_ITEMS.length} collected · duplicates pay money back</small></h2>
    <div class="sh-grid">${COS_CASES.map((b, i) => caseCard(b, g, i)).join('')}</div>
    <h2 class="tg-h">Upgrades &amp; cars</h2>
    <div class="sh-grid sh-wide">
      <article class="sh-card gamble" style="--c:#ffc940; --i:0">
        <div class="sh-card-art sh-mystery" aria-hidden="true">?</div>
        <h3>${esc(CRATES.mystery.name)}</h3>
        <p>${esc(CRATES.mystery.blurb)}</p>
        <small class="sh-for">Opens on your ${esc(carName)}</small>
        <button class="tg-go small" data-crate="mystery" ${g.money < MYSTERY_COST ? 'disabled title="Not enough money"' : ''}>Open<span class="sh-price tg-num">${money(MYSTERY_COST)}</span></button>
      </article>
      <article class="sh-card dealer" style="--c:#38c9ff; --i:1">
        <div class="sh-card-art sh-dealer" aria-hidden="true"><svg viewBox="0 0 96 48"><path d="M6 34c0-6 4-9 10-10l14-10c3-2 6-3 10-3h16c5 0 9 2 12 5l8 8c8 1 14 2 14 10v4H6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="38" r="7" fill="#0b0e14" stroke="currentColor" stroke-width="3"/><circle cx="72" cy="38" r="7" fill="#0b0e14" stroke="currentColor" stroke-width="3"/></svg></div>
        <h3>The Dealer</h3>
        <p>New cars come stock: a starter hatch up to the Vanta V10 supercar and the Raiden bike.</p>
        <small class="sh-for">Your garage money buys them</small>
        <button class="tg-go small alt" data-goto="dealer">Browse cars</button>
      </article>
    </div>
    <p class="tg-status" role="status" data-status>${esc(status)}</p>
  </div>`;
}

/** A case's whole contents, for the "What's inside" window. */
export function caseInside(box: CosCase, g: Garage): string {
  return `<div class="sh-inside" role="dialog" aria-modal="true" aria-label="${esc(box.name)}: what's inside" data-nav-scope style="--c:${hex(box.color)}">
    <header><h2>${esc(box.name)}</h2><button class="tg-pill" data-inside-close data-autofocus>Close</button></header>
    <div class="sh-inside-body cz-inside">${contents(box, new Set(g.cos))}</div>
  </div>`;
}
