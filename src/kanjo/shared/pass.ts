// KANJO's battle pass: a season of 50 tiers, each with one reward nobody can get any other way (car cosmetics in
// no case, home backgrounds, gear and metals for your own driver, titles, and some money back). Pure and shared:
// the server runs it for accounts (XP is paid by the race room and the `solo` action, the pass is bought with
// garage money there), the client runs it for guests and draws the Battle pass page from it.
//
// XP counts from your first race whether or not you own the pass; buying it hands over every tier already reached.

import { type CosItem, cosById } from './cosmetics.ts';
import { type GearId, type Look, PASS_METALS, type MetalId } from './look.ts';
import { FASHION } from './fashion.ts';

export const PASS = {
  /** What the pass costs, in garage money. */
  price: 50_000,
  tiers: 50,
  /** XP per tier (flat, so the bar always means the same). */
  perTier: 500,
  season: 'Season 1',
  name: 'Kitsune Run',
};

/** What one race is worth in XP. Solo races pay the same share as their prize (garage.ts SOLO_SHARE). */
export const XP = {
  finish: 150,
  /** A DNF still counts for something: you raced. */
  dnf: 50,
  /** Per racer behind you at the line. */
  perBeaten: 25,
  /** First place against at least one other car. */
  win: 100,
  /** Drift points per XP, and the most drifting can add in one race. */
  driftPerXp: 200,
  driftMax: 100,
  soloShare: 0.6,
};

/** XP for a race: `place` is 1-based (0 = DNF), `field` counts every car incl. AI, `drift` is clamped points. */
export function raceXp(place: number, field: number, drift: number, solo: boolean): number {
  const f = Math.max(1, Math.min(8, Math.floor(field) || 1));
  const p = Math.max(0, Math.min(f, Math.floor(place) || 0));
  let xp = p ? XP.finish + XP.perBeaten * (f - p) + (p === 1 && f > 1 ? XP.win : 0) : XP.dnf;
  xp += Math.min(XP.driftMax, Math.floor(Math.max(0, Number(drift) || 0) / XP.driftPerXp));
  return Math.round(xp * (solo ? XP.soloShare : 1));
}

/** The tier `xp` has reached (0 before the first). */
export const tierOf = (xp: number): number => Math.min(PASS.tiers, Math.floor(Math.max(0, xp) / PASS.perTier));
/** XP into the next tier and what it needs (a full bar at the last tier). */
export function tierProgress(xp: number): { tier: number; into: number; need: number } {
  const tier = tierOf(xp);
  if (tier >= PASS.tiers) return { tier, into: PASS.perTier, need: PASS.perTier };
  return { tier, into: Math.max(0, xp) - tier * PASS.perTier, need: PASS.perTier };
}

// ---------------------------------------------------------------------------------------------
// Home backgrounds: the showroom's stage (kanjo/client/showroom.ts draws them). '' is the garage bay.

export type BgId = 'dusk' | 'sakura' | 'neon' | 'mesa' | 'moon' | 'synth' | 'momiji' | 'vault';
/**
 * `sky`: zenith and horizon colours; `backdrop`: a painted panorama from public/race/backdrops (or none); `neon`: the
 * turntable rings and rim lights; `motes`: what drifts through the air.
 */
export interface Stage {
  name: string;
  blurb: string;
  sky: [number, number];
  floor: number;
  backdrop: 'alpine' | 'autumn' | 'city' | 'coast' | 'desert' | 'night' | 'spring' | null;
  neon: [number, number];
  motes: 'petals' | 'leaves' | 'stars' | 'embers' | 'sparks' | null;
  /** A big sun or moon low on the horizon (the synthwave one, the night one). */
  orb?: number;
}
export const STAGES: Record<BgId, Stage> = {
  dusk: { name: 'Kōri Dusk', blurb: 'The alpine pass as the light goes.', sky: [0x2a1f4a, 0xff8a5c], floor: 0x1c1a24, backdrop: 'alpine', neon: [0xffae3c, 0xff3d9a], motes: null },
  sakura: { name: 'Sakura Night', blurb: 'Petals over the spring pass.', sky: [0x0d1030, 0xc85a8f], floor: 0x1e1522, backdrop: 'spring', neon: [0xff7ad0, 0xffffff], motes: 'petals' },
  neon: { name: 'Neon Bay Skyline', blurb: 'The city behind you, lit up.', sky: [0x07051a, 0x6a1a6e], floor: 0x120e1c, backdrop: 'city', neon: [0x38c9ff, 0xff3d9a], motes: null },
  mesa: { name: 'Red Mesa Sunset', blurb: 'Canyon walls on fire.', sky: [0x3a1a3a, 0xff6a2b], floor: 0x24160f, backdrop: 'desert', neon: [0xff7a2b, 0xffc940], motes: 'embers' },
  moon: { name: 'Tsukiyo Moon', blurb: 'A full moon and every star out.', sky: [0x02040c, 0x1a2a4a], floor: 0x0c0f16, backdrop: 'night', neon: [0x9ec8ff, 0x6a7bff], motes: 'stars', orb: 0xf4f1e2 },
  synth: { name: 'Outrun', blurb: 'A sun that never sets on the grid.', sky: [0x0a0220, 0xff2bd6], floor: 0x0c0418, backdrop: null, neon: [0xff2bd6, 0x22e6ff], motes: null, orb: 0xffb020 },
  momiji: { name: 'Momiji Gold', blurb: 'Maple leaves falling on the autumn pass.', sky: [0x2a1a10, 0xffb84a], floor: 0x1f170f, backdrop: 'autumn', neon: [0xff8a00, 0xffd76a], motes: 'leaves' },
  vault: { name: 'Gold Vault', blurb: 'For the ones who finished the season.', sky: [0x0a0806, 0x3a2a10], floor: 0x16120a, backdrop: null, neon: [0xffd76a, 0xffffff], motes: 'sparks' },
};
export const BG_IDS = Object.keys(STAGES) as BgId[];

// ---------------------------------------------------------------------------------------------
// Titles (on your player card)

export type TitleId = 'runner' | 'apex' | 'drift' | 'foxfire' | 'legend';
export const TITLES: Record<TitleId, string> = {
  runner: 'Night Runner',
  apex: 'Apex Hunter',
  drift: 'Drift Spirit',
  foxfire: 'Foxfire',
  legend: 'Legend of the Pass',
};

// ---------------------------------------------------------------------------------------------
// The tiers

export type PassReward =
  | { kind: 'cos'; id: string }
  | { kind: 'bg'; id: BgId }
  | { kind: 'metal'; id: MetalId }
  | { kind: 'gear'; id: GearId }
  | { kind: 'title'; id: TitleId }
  | { kind: 'money'; amount: number };

export const GEAR_NAMES: Record<GearId, string> = { horns: 'Oni Horns', ears: 'Kitsune Ears', visor: 'Spirit Visor', halo: 'Foxfire Halo' };
export const PASS_METAL_NAMES: Partial<Record<MetalId, string>> = { gold: '24k Gold', obsidian: 'Obsidian', ember: 'Ember', prism: 'Prism' };

const cos = (id: string): PassReward => ({ kind: 'cos', id });
const bg = (id: BgId): PassReward => ({ kind: 'bg', id });
const metal = (id: MetalId): PassReward => ({ kind: 'metal', id });
const gear = (id: GearId): PassReward => ({ kind: 'gear', id });
const title = (id: TitleId): PassReward => ({ kind: 'title', id });
const cash = (amount: number): PassReward => ({ kind: 'money', amount });

/** Tier n's reward is TIERS[n - 1]. */
export const TIERS: readonly PassReward[] = [
  cos('ds_season'), cash(2500), bg('dusk'), cos('cs_vermilion'), metal('gold'),
  title('runner'), cos('gs_torii'), cos('fs_gold'), cash(2500), bg('sakura'),
  cos('ps_torii'), gear('horns'), cos('rs_foxgold'), cash(2500), bg('neon'),
  cos('es_spirit'), title('apex'), metal('obsidian'), cos('pls_shrine'), cos('ps_foxfire'),
  cos('ts_spirit'), cash(2500), gear('ears'), bg('mesa'), cos('ds_spirit'),
  cos('hds_shrine'), title('drift'), cos('gs_foxfire'), metal('ember'), cos('ps_inari'),
  cash(5000), bg('moon'), cos('hs_foxeyes'), gear('visor'), cos('rs_spirit'),
  title('foxfire'), cos('ws_goldleaf'), bg('synth'), metal('prism'), cos('ps_spiritcircuit'),
  cash(5000), cos('wgs_ninetail'), bg('momiji'), cos('ds_foxmask'), gear('halo'),
  cos('rfs_halo'), cos('ps_shrine'), bg('vault'), title('legend'), cos('ps_kitsunerun'),
];

/** The tier that unlocks a reward (0: not in the pass). */
export function tierFor(kind: PassReward['kind'], id: string): number {
  return TIERS.findIndex((r) => r.kind === kind && 'id' in r && r.id === id) + 1;
}

/** A reward's name for the UI. */
export function rewardName(r: PassReward): string {
  switch (r.kind) {
    case 'cos':
      return cosById(r.id)?.name ?? r.id;
    case 'bg':
      return STAGES[r.id].name;
    case 'metal':
      return `${PASS_METAL_NAMES[r.id] ?? r.id} metal`;
    case 'gear':
      return GEAR_NAMES[r.id];
    case 'title':
      return `“${TITLES[r.id]}”`;
    case 'money':
      return `$${r.amount.toLocaleString('en-US')}`;
  }
}

/** The pass state a garage carries (garage.ts). */
export interface PassState {
  /** Season XP from every race, pass or no pass. */
  xp: number;
  /** Bought the pass. */
  pass: boolean;
  /** The highest tier whose rewards were handed over (money paid, cosmetics put in the locker). */
  given: number;
}

/** Whether the pass has unlocked tier `n` for this garage. */
export const unlocked = (p: PassState, n: number): boolean => p.pass && n >= 1 && n <= tierOf(p.xp);

/** Whether a reward is yours to use (bought the pass and reached its tier). */
export const owns = (p: PassState, kind: PassReward['kind'], id: string): boolean => unlocked(p, tierFor(kind, id));

/** What a garage has to dress a driver with beyond the free wardrobe: the pass's unlocks and the fashion it bought. */
export type Wardrobe = PassState & { fash: readonly string[] };

/** A driver look's pieces that this garage hasn't unlocked or bought (empty: it can wear it). */
export function lockedLookParts(p: Wardrobe, l: Look): string[] {
  const out: string[] = [];
  if (PASS_METALS.includes(l.metal) && !owns(p, 'metal', l.metal)) out.push(PASS_METAL_NAMES[l.metal] ?? l.metal);
  for (const x of l.gear) if (!owns(p, 'gear', x)) out.push(GEAR_NAMES[x]);
  for (const x of l.fashion) if (!p.fash.includes(x)) out.push(FASHION[x].name);
  return out;
}

/** A look with the pieces this garage hasn't unlocked or bought taken off (the race shows the rest). */
export function ownedLook(p: Wardrobe, l: Look): Look {
  return {
    ...l,
    metal: PASS_METALS.includes(l.metal) && !owns(p, 'metal', l.metal) ? 'brass' : l.metal,
    gear: l.gear.filter((x) => owns(p, 'gear', x)),
    fashion: l.fashion.filter((x) => p.fash.includes(x)),
  };
}

/** Pass cosmetics (cosmetics.ts) by id, for the locker's "Battle pass · tier n" tag. */
export const passTierOfCos = (item: CosItem): number => tierFor('cos', item.id);
