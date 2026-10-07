// Loot: rarities, cases and every item a case can drop. Pure data + the dice, so the client (store,
// inventory, avatar, viewmodel) and the server (validating what others wear) share one definition.
// No three.js, no DOM.

/** CSGO's ladder, name for name. Gold is the "exceedingly rare" tier: one in five hundred. */
export type Rarity = 'consumer' | 'industrial' | 'milspec' | 'restricted' | 'classified' | 'covert' | 'gold';

export const RARITIES: readonly Rarity[] = ['consumer', 'industrial', 'milspec', 'restricted', 'classified', 'covert', 'gold'];

export const RARITY: Record<Rarity, { name: string; color: number; weight: number; sell: number }> = {
  consumer: { name: 'Consumer Grade', color: 0xb0c3d9, weight: 32, sell: 5 },
  industrial: { name: 'Industrial Grade', color: 0x5e98d9, weight: 28, sell: 12 },
  milspec: { name: 'Mil-Spec', color: 0x4b69ff, weight: 22, sell: 30 },
  restricted: { name: 'Restricted', color: 0x8847ff, weight: 11, sell: 80 },
  classified: { name: 'Classified', color: 0xd32ce6, weight: 5, sell: 200 },
  covert: { name: 'Covert', color: 0xeb4b4b, weight: 1.8, sell: 600 },
  gold: { name: 'Exceedingly Rare', color: 0xe4ae39, weight: 0.2, sell: 2000 },
};

/** The currency: earned by kills, spent on cases, topped up by selling skins. */
export const COIN = { name: 'Acorns', icon: '🌰', start: 300, kill: 10, headshot: 5, zombie: 3 } as const;

export type Slot = 'rifle' | 'knife' | 'hat' | 'face' | 'back';
export const SLOTS: readonly Slot[] = ['rifle', 'knife', 'hat', 'face', 'back'];
export const SLOT_NAME: Record<Slot, string> = { rifle: 'Rifle', knife: 'Knife', hat: 'Hat', face: 'Face', back: 'Back' };

/** Rifle paint: stock/handguard, the darker grip, the metalwork, and whether it glows. */
export interface RiflePaint {
  body: number;
  dark: number;
  trim: number;
  glow?: boolean;
}
export type KnifeStyle = 'combat' | 'karambit' | 'machete' | 'kunai';
export interface KnifePaint {
  style: KnifeStyle;
  blade: number;
  handle: number;
  glow?: boolean;
}
type WearModel = 'straw' | 'beanie' | 'witch' | 'sprout' | 'crown' | 'halo' | 'shades' | 'goggles' | 'monocle' | 'mask' | 'backpack' | 'cape' | 'wings';
export interface Wear {
  model: WearModel;
  color: number;
  /** Trim: hat band, strap, lining. */
  color2: number;
  glow?: boolean;
}

export type CaseId = 'sky' | 'blade' | 'wardrobe';

interface Base {
  id: string;
  name: string;
  rarity: Rarity;
  case: CaseId;
}
export type Item = Base &
  ({ slot: 'rifle'; paint: RiflePaint } | { slot: 'knife'; paint: KnifePaint } | { slot: 'hat' | 'face' | 'back'; wear: Wear });

export interface CaseDef {
  id: CaseId;
  name: string;
  blurb: string;
  price: number;
  color: number;
}

export const CASES: readonly CaseDef[] = [
  { id: 'sky', name: 'Skyline Case', blurb: 'Paint jobs for your AWP', price: 100, color: 0x5fa3dc },
  { id: 'blade', name: 'Windblade Case', blurb: 'Knives, four shapes, many colours', price: 150, color: 0xd9584a },
  { id: 'wardrobe', name: 'Wardrobe Case', blurb: 'Hats, faces and backs', price: 80, color: 0x76ac5a },
];

const R = (id: string, name: string, rarity: Rarity, c: CaseId, body: number, dark: number, trim: number, glow = false): Item => ({
  id, name, rarity, case: c, slot: 'rifle', paint: { body, dark, trim, glow },
});
const K = (id: string, name: string, rarity: Rarity, style: KnifeStyle, blade: number, handle: number, glow = false): Item => ({
  id, name, rarity, case: 'blade', slot: 'knife', paint: { style, blade, handle, glow },
});
const W = (id: string, name: string, rarity: Rarity, slot: 'hat' | 'face' | 'back', model: WearModel, color: number, color2: number, glow = false): Item => ({
  id, name, rarity, case: 'wardrobe', slot, wear: { model, color, color2, glow },
});

export const ITEMS: readonly Item[] = [
  // Rifles
  R('awp_soot', 'AWP | Sootling', 'consumer', 'sky', 0x34343a, 0x1e1e22, 0x4b5058),
  R('awp_dune', 'AWP | Dune', 'consumer', 'sky', 0xc9b27c, 0x8f7a4a, 0x4b4034),
  R('awp_snow', 'AWP | Snowcap', 'industrial', 'sky', 0xeef2f6, 0xb6c3d0, 0x6e7a88),
  R('awp_pond', 'AWP | Pond', 'industrial', 'blade', 0x3f8f8a, 0x2a615e, 0x2e3136),
  R('awp_orchard', 'AWP | Sunset Orchard', 'milspec', 'sky', 0xe0663a, 0x9a3f22, 0x4a2a20),
  R('awp_blossom', 'AWP | Plum Blossom', 'milspec', 'sky', 0xf2a0b8, 0xb86a86, 0x5a3a48),
  R('awp_deepsky', 'AWP | Deep Sky', 'restricted', 'sky', 0x2f5fb0, 0x1b3a73, 0x9fc0e8),
  R('awp_kodama', 'AWP | Kodama', 'restricted', 'blade', 0x76ac5a, 0x3f6a2e, 0xe8e2c0),
  R('awp_lantern', 'AWP | Spirit Lantern', 'classified', 'sky', 0x2b2441, 0x171226, 0xf2c14e, true),
  R('awp_storm', 'AWP | Storm Chaser', 'classified', 'blade', 0x56627a, 0x2f3750, 0xcfe3ff, true),
  R('awp_wyrm', 'AWP | Wind Wyrm', 'covert', 'sky', 0x1f9a86, 0x0d5a52, 0x9ff5df, true),
  R('awp_solar', 'AWP | Solar Flare', 'gold', 'sky', 0xf2c14e, 0xc8902a, 0xfff1c4, true),

  // Knives: four shapes, several colourways each
  K('knf_combat_rust', 'Field Knife | Rust', 'consumer', 'combat', 0xb0b4b8, 0x8a5a3a),
  K('knf_combat_sage', 'Field Knife | Sage', 'industrial', 'combat', 0xc9d1d6, 0x6f8f5a),
  K('knf_combat_frost', 'Field Knife | Frost', 'milspec', 'combat', 0xcfeaff, 0x5f9fd6),
  K('knf_combat_cinder', 'Field Knife | Cinder', 'restricted', 'combat', 0xff8a4a, 0x2b2433, true),
  K('knf_mach_bamboo', 'Machete | Bamboo', 'industrial', 'machete', 0xc2c9b8, 0x9bb86a),
  K('knf_mach_brick', 'Machete | Brick', 'milspec', 'machete', 0xd5d8dc, 0xb5523a),
  K('knf_mach_moon', 'Machete | Moonlit', 'classified', 'machete', 0xdfe8ff, 0x3a3f6a, true),
  K('knf_kunai_slate', 'Kunai | Slate', 'milspec', 'kunai', 0x8d96a3, 0x2e3136),
  K('knf_kunai_sakura', 'Kunai | Sakura', 'restricted', 'kunai', 0xf6d3e0, 0xe58fa8),
  K('knf_kunai_aurora', 'Kunai | Aurora', 'classified', 'kunai', 0x9ff5df, 0x4a2f7a, true),
  K('knf_kunai_crimson', 'Kunai | Crimson', 'covert', 'kunai', 0xff4a4a, 0x2b1414, true),
  K('knf_kara_ember', 'Karambit | Ember', 'restricted', 'karambit', 0xe8a060, 0x7a2e1e),
  K('knf_kara_tide', 'Karambit | Tidepool', 'classified', 'karambit', 0x9fe0f0, 0x2f6a8a),
  K('knf_kara_void', 'Karambit | Void', 'covert', 'karambit', 0x6a4aa0, 0x120a24, true),
  K('knf_kara_gold', 'Karambit | Golden Hour', 'gold', 'karambit', 0xffd76a, 0xc8902a, true),

  // Wearables
  W('hat_straw_sun', 'Straw Hat | Sun', 'consumer', 'hat', 'straw', 0xe6c874, 0xd9473d),
  W('hat_straw_poppy', 'Straw Hat | Poppy', 'industrial', 'hat', 'straw', 0xf0d890, 0xe0663a),
  W('hat_beanie_indigo', 'Beanie | Indigo', 'consumer', 'hat', 'beanie', 0x4a6fa5, 0xf4ead2),
  W('hat_beanie_peach', 'Beanie | Peach', 'industrial', 'hat', 'beanie', 0xf2a35e, 0xfff1d6),
  W('hat_sprout_leaf', 'Sprout | Leaf', 'industrial', 'hat', 'sprout', 0x76ac5a, 0x4a7a3a),
  W('hat_sprout_autumn', 'Sprout | Autumn', 'milspec', 'hat', 'sprout', 0xe0663a, 0xb5782a),
  W('hat_witch_midnight', 'Witch Hat | Midnight', 'milspec', 'hat', 'witch', 0x2f2a45, 0xd9473d),
  W('hat_witch_berry', 'Witch Hat | Berry', 'restricted', 'hat', 'witch', 0x8a3a8a, 0xf2c14e),
  W('hat_crown_brass', 'Crown | Brass', 'classified', 'hat', 'crown', 0xe4ae39, 0xd9473d),
  W('hat_halo', 'Halo | Angel', 'covert', 'hat', 'halo', 0xfff1a0, 0xfff1a0, true),
  W('face_shades_black', 'Shades | Black', 'industrial', 'face', 'shades', 0x24232b, 0x24232b),
  W('face_shades_pink', 'Shades | Pink', 'milspec', 'face', 'shades', 0xf27aa8, 0xfff0f5),
  W('face_goggles_brass', 'Goggles | Brass', 'milspec', 'face', 'goggles', 0xc8902a, 0x9fd6e8),
  W('face_goggles_neon', 'Goggles | Neon', 'restricted', 'face', 'goggles', 0x2b2433, 0x7dffb0, true),
  W('face_monocle', 'Monocle | Gold', 'classified', 'face', 'monocle', 0xe4ae39, 0xcfe8f5),
  W('face_mask_fox', 'Fox Mask', 'covert', 'face', 'mask', 0xf6f0e0, 0xd9473d),
  W('back_pack_green', 'Backpack | Moss', 'consumer', 'back', 'backpack', 0x76ac5a, 0x4a3726),
  W('back_pack_mail', 'Backpack | Courier', 'industrial', 'back', 'backpack', 0xd9584a, 0xf2c14e),
  W('back_cape_crimson', 'Cape | Crimson', 'restricted', 'back', 'cape', 0xc23a3a, 0xf2c14e),
  W('back_cape_stars', 'Cape | Starry', 'classified', 'back', 'cape', 0x2a2a6a, 0xfff1a0, true),
  W('back_wings_dusk', 'Wings | Dusk', 'restricted', 'back', 'wings', 0x6a4aa0, 0xf2a0b8),
  W('back_wings_dawn', 'Wings | Dawn', 'covert', 'back', 'wings', 0xfff6f0, 0xf9c9d4, true),
  W('back_wings_gold', 'Wings | Golden Hour', 'gold', 'back', 'wings', 0xffd76a, 0xfff1c4, true),
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id: string): Item | undefined => BY_ID.get(id);
export const caseById = (id: string): CaseDef | undefined => CASES.find((c) => c.id === id);
export const itemsIn = (c: CaseId) => ITEMS.filter((i) => i.case === c);
export const hexOf = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Chance (0..1) of each rarity in a case: the global weights, renormalised over the rarities it actually holds. */
export function odds(c: CaseId): Partial<Record<Rarity, number>> {
  const have = RARITIES.filter((r) => itemsIn(c).some((i) => i.rarity === r));
  const total = have.reduce((s, r) => s + RARITY[r].weight, 0);
  return Object.fromEntries(have.map((r) => [r, RARITY[r].weight / total]));
}

/** One drop: a rarity by weight, then a uniformly random item of that rarity. `rng` is [0, 1). */
export function rollCase(c: CaseId, rng: () => number = Math.random): Item {
  const o = odds(c);
  let x = rng();
  let rarity: Rarity = 'consumer';
  for (const r of RARITIES) {
    const p = o[r];
    if (!p) continue;
    rarity = r;
    if ((x -= p) < 0) break;
  }
  const pool = itemsIn(c).filter((i) => i.rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

// ---------------------------------------------------------------------------
// Gear: what a player has equipped, as sent to the server and relayed to everyone else.

export type Gear = Partial<Record<Slot, string>>;

/** "rifleId,knifeId,hatId,faceId,backId": empty between commas for a bare slot. */
export const encodeGear = (g: Gear) => SLOTS.map((s) => g[s] ?? '').join(',');

const MAX_GEAR = 120;

/** Parses a gear code; every id must exist and sit in its own slot. Null for anything else. */
export function decodeGear(code: unknown): Gear | null {
  if (typeof code !== 'string' || code.length > MAX_GEAR) return null;
  const parts = code.split(',');
  if (parts.length !== SLOTS.length) return null;
  const gear: Gear = {};
  for (const [i, id] of parts.entries()) {
    if (!id) continue;
    if (itemById(id)?.slot !== SLOTS[i]) return null;
    gear[SLOTS[i]] = id;
  }
  return gear;
}
