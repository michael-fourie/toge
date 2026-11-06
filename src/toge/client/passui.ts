// The Battle pass page (Race → Battle pass; hub.ts hosts it and owns the previews). The season's hero (tier, XP
// bar, the pass's price or that you own it), the reward picked from the track with its preview and what you can do
// with it, then all 50 tiers. Everyone sees every reward and earns XP from their first race; only the pass makes
// them usable. Pure markup: hub.ts wires the buttons.

import { RARITY, SLOT_INFO, cosById } from '../shared/cosmetics.ts';
import type { Garage } from '../shared/garage.ts';
import { BG_IDS, PASS, type PassReward, STAGES, TIERS, TITLES, rewardName, tierFor, tierOf, tierProgress, unlocked, XP } from '../shared/pass.ts';
import { decodeLook } from '../shared/look.ts';
import { esc } from '../../client/menu/ui.ts';
import { art as cosArt } from './cosmeticsui.ts';
import { money } from './hud.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Swatches for the pass metals (as the creator draws them). */
const METAL_ART: Record<string, string> = {
  gold: 'radial-gradient(circle at 35% 30%, #fff6c8, #ffc94a 35%, #8a5a10 80%)',
  obsidian: 'radial-gradient(circle at 35% 30%, #6a5a8a, #1a1024 40%, #050308 80%)',
  ember: 'radial-gradient(circle at 50% 50%, #ffd27a, #ff5a1a 35%, #3a1a10 75%)',
  prism: 'conic-gradient(#ff6ad5, #6ad5ff, #6aff9e, #ffe66a, #ff6ad5)',
};

/** Line drawings for the driver gear (stroked in currentColor, which is the glow). */
const GEAR_ART: Record<string, string> = {
  halo: '<ellipse cx="24" cy="14" rx="14" ry="5"/><circle cx="24" cy="32" r="9"/>',
  horns: '<path d="M14 26c-4-6-4-14 0-20 1 7 4 11 7 14M34 26c4-6 4-14 0-20-1 7-4 11-7 14"/><circle cx="24" cy="32" r="9"/>',
  ears: '<path d="M13 26 15 6l9 14M35 26 33 6l-9 14"/><circle cx="24" cy="32" r="9"/>',
  visor: '<circle cx="24" cy="26" r="11"/><path d="M11 25h26" stroke-width="5"/>',
};

/** The picture on a tier tile and in the detail card. */
function rewardArt(r: PassReward): string {
  switch (r.kind) {
    case 'cos': {
      const it = cosById(r.id);
      return it ? cosArt(it) : '';
    }
    case 'bg': {
      const s = STAGES[r.id];
      const orb = s.orb !== undefined ? `radial-gradient(circle at 30% 58%, ${hex(s.orb)} 0 9%, transparent 10%), ` : '';
      return `<i class="cz-art tg-pass-art" style="background:${orb}linear-gradient(to top, ${hex(s.floor)} 0 26%, ${hex(s.neon[0])} 26% 28%, ${hex(s.sky[1])} 28%, ${hex(s.sky[0])} 100%)"></i>`;
    }
    case 'metal':
      return `<i class="cz-art tg-pass-art" style="background:${METAL_ART[r.id] ?? '#888'}"></i>`;
    case 'gear':
      return `<i class="cz-art tg-pass-art tg-pass-gear"><svg viewBox="0 0 48 48" aria-hidden="true">${GEAR_ART[r.id]}</svg></i>`;
    case 'title':
      return `<i class="cz-art tg-pass-art tg-pass-title"><b>${esc(TITLES[r.id])}</b></i>`;
    case 'money':
      return `<i class="cz-art tg-pass-art tg-pass-money"><b>${r.amount >= 1000 ? `$${r.amount / 1000}k` : `$${r.amount}`}</b></i>`;
  }
}

/** What kind of reward it is, for the small line under its name. */
function rewardKind(r: PassReward): string {
  switch (r.kind) {
    case 'cos': {
      const it = cosById(r.id);
      return it ? `${SLOT_INFO[it.slot].name} · ${RARITY[it.rarity].name}` : 'Car cosmetic';
    }
    case 'bg':
      return 'Home background';
    case 'metal':
      return 'Driver metal';
    case 'gear':
      return 'Driver gear';
    case 'title':
      return 'Player card title';
    case 'money':
      return 'Garage money';
  }
}

/** The colour a tile is edged in: the item's rarity, gold for money, cyan for the rest. */
function rewardColor(r: PassReward): string {
  if (r.kind === 'cos') {
    const it = cosById(r.id);
    return it ? hex(RARITY[it.rarity].color) : '#38c9ff';
  }
  return r.kind === 'money' ? 'var(--tg-gold)' : r.kind === 'bg' ? hex(STAGES[r.id].neon[0]) : '#38c9ff';
}

export interface PassView {
  g: Garage;
  /** The tier whose reward is open in the detail card (and previewed in the showroom). */
  sel: number;
  /** The car you drive (a cosmetic equips on it). */
  car: string;
  status: string;
}

/** What the open reward lets you do now. */
function detailActions(v: PassView, r: PassReward, n: number): string {
  const { g } = v;
  if (!unlocked(g, n)) {
    if (!g.pass && tierOf(g.xp) >= n) return `<p class="tg-pass-why gold">Reached. Buy the pass and it's yours.</p>`;
    const left = n * PASS.perTier - g.xp;
    return `<p class="tg-pass-why">${left.toLocaleString('en-US')} XP to tier ${n}${g.pass ? '' : ' · it unlocks with the pass'}.</p>`;
  }
  switch (r.kind) {
    case 'cos':
      return `<button class="tg-go small" data-pass-equip="${r.id}">Equip on your ${esc(v.car)}</button>`;
    case 'bg':
      return g.bg === r.id
        ? `<span class="tg-tag">On your home screen</span><button class="tg-pill" data-pass-bg="">Back to the garage bay</button>`
        : `<button class="tg-go small" data-pass-bg="${r.id}">Use as home background</button>`;
    case 'title':
      return g.title === r.id ? `<span class="tg-tag">On your card</span><button class="tg-pill" data-pass-title="">Take it off</button>` : `<button class="tg-go small" data-pass-title="${r.id}">Use this title</button>`;
    case 'metal':
    case 'gear': {
      const l = decodeLook(g.rider);
      const on = l && (r.kind === 'metal' ? l.metal === r.id : l.gear.includes(r.id));
      return on ? `<span class="tg-tag">Wearing it</span><button class="tg-pill" data-goto="driver">Driver</button>` : `<button class="tg-go small" data-pass-wear="${r.kind}:${r.id}">Wear it</button><small class="tg-pass-note">On your own driver (Driver → Your driver).</small>`;
    }
    case 'money':
      return `<span class="tg-tag you">Paid</span>`;
  }
}

/** The page body. */
export function passTab(v: PassView): string {
  const { g } = v;
  const p = tierProgress(g.xp);
  const done = p.tier >= PASS.tiers;
  const sel = Math.max(1, Math.min(PASS.tiers, v.sel));
  const r = TIERS[sel - 1];
  const short = PASS.price - g.money;
  const buy = g.pass
    ? `<span class="tg-tag you">Pass owned</span>`
    : `<button class="tg-go" data-pass-buy ${short > 0 ? 'disabled' : ''} data-autofocus>Buy the pass · ${money(PASS.price)}</button>${short > 0 ? `<small class="tg-pass-note">${money(short)} more to go. Race to earn it.</small>` : ''}`;
  const bgs = BG_IDS.filter((id) => unlocked(g, tierFor('bg', id)));
  const titles = (Object.keys(TITLES) as (keyof typeof TITLES)[]).filter((id) => unlocked(g, tierFor('title', id)));
  return `
    <section class="tg-pass-hero tg-cardbox">
      <small class="tg-eyebrow">${esc(PASS.season)} · Battle pass</small>
      <h1 class="tg-display">${esc(PASS.name)}</h1>
      <div class="tg-pass-level">
        <div class="tg-pass-tier"><small>Tier</small><b class="tg-num">${p.tier}</b><small>/ ${PASS.tiers}</small></div>
        <div class="tg-pass-xp">
          <div class="tg-pass-bar" style="--v:${p.into / p.need}"><i></i></div>
          <small class="tg-num">${done ? `Season complete · ${g.xp.toLocaleString('en-US')} XP` : `${p.into} / ${p.need} XP to tier ${p.tier + 1}`}</small>
        </div>
      </div>
      <p class="tg-pass-blurb">${
        g.pass
          ? 'Every race earns XP. Each tier you reach hands over its reward: cosmetics go to your Locker, money to your wallet.'
          : 'Every race earns XP, pass or no pass. Buy the pass and every tier you’ve already reached unlocks at once.'
      }</p>
      <div class="tg-pass-buy">${buy}</div>
    </section>
    <section class="tg-pass-detail tg-cardbox" style="--r:${rewardColor(r)}">
      <div class="tg-pass-detail-art">${rewardArt(r)}</div>
      <div class="tg-pass-detail-copy">
        <small class="tg-eyebrow">Tier ${sel} · ${esc(rewardKind(r))}</small>
        <h2 class="tg-title">${esc(rewardName(r))}</h2>
        <small class="tg-pass-note">${r.kind === 'money' || r.kind === 'title' ? 'Battle pass exclusive' : 'Battle pass exclusive · previewing it now'}</small>
        <div class="tg-pass-act">${detailActions(v, r, sel)}</div>
      </div>
    </section>
    ${
      g.pass && (bgs.length || titles.length)
        ? `<div class="tg-pass-using">
        ${bgs.length ? `<div class="tg-field"><span class="tg-label">Home</span><div class="tg-seg">${['', ...bgs].map((id) => `<button class="tg-pill" data-pass-bg="${id}" aria-pressed="${g.bg === id}">${id ? esc(STAGES[id as keyof typeof STAGES].name) : 'Garage bay'}</button>`).join('')}</div></div>` : ''}
        ${titles.length ? `<div class="tg-field"><span class="tg-label">Title</span><div class="tg-seg">${['', ...titles].map((id) => `<button class="tg-pill" data-pass-title="${id}" aria-pressed="${g.title === id}">${id ? esc(TITLES[id as keyof typeof TITLES]) : 'None'}</button>`).join('')}</div></div>` : ''}
      </div>`
        : ''
    }
    <h2 class="tg-h">Rewards <small>${TIERS.length} tiers · ${PASS.perTier} XP each</small></h2>
    <ol class="tg-pass-track">
      ${TIERS.map((t, i) => {
        const n = i + 1;
        const state = unlocked(g, n) ? 'got' : p.tier >= n ? 'ready' : 'ahead';
        const label = state === 'got' ? 'unlocked' : state === 'ready' ? 'reached, needs the pass' : 'locked';
        return `<li><button class="tg-pass-tile ${state}" data-pass-tier="${n}" aria-pressed="${n === sel}" style="--r:${rewardColor(t)}" aria-label="Tier ${n}: ${esc(rewardName(t))}, ${label}">
          <span class="tg-pass-n tg-num">${n}</span>${rewardArt(t)}<b>${esc(rewardName(t))}</b><small>${esc(t.kind === 'cos' ? SLOT_INFO[cosById(t.id)!.slot].name : rewardKind(t))}</small>
          <em aria-hidden="true">${state === 'got' ? '✓' : state === 'ready' ? 'PASS' : `<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`}</em>
        </button></li>`;
      }).join('')}
    </ol>
    <p class="tg-muted">XP per race: ${XP.finish} for finishing, ${XP.perBeaten} for each car behind you, ${XP.win} for a win, up to ${XP.driftMax} for drifting. Solo races earn ${Math.round(XP.soloShare * 100)}%, and count at most once every 45 s like their prize.</p>
    <p class="tg-status" role="status" data-status>${esc(v.status)}</p>`;
}

/** The car card ribbon while a reward is previewed. */
export const passRibbon = (n: number) => `<p class="tg-card-ribbon cyan">Battle pass · Tier ${n} preview</p>`;

/** The top bar's tier chip. */
export function passChip(g: Garage): string {
  const p = tierProgress(g.xp);
  return `<b class="tg-num">${p.tier}</b><span><small>${g.pass ? 'Battle pass' : 'Pass tier'}</small><i style="--v:${p.into / p.need}"></i></span>`;
}
