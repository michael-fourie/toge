// TŌGE cosmetics: paint jobs, decals, window tints, lamp tints, rims, calipers, underglow, plates, plate
// frames and exhaust tips, won from cases bought with garage money. Pure data + the dice, shared so the
// garage screen, the car renderer, the race server (checking what others see) and the account server
// (rolling cases, checking what you own) all agree. No three.js, no DOM.
//
// Wire format: a car's equipped cosmetics travel as each slot's index into its CATALOG list, so only ever
// APPEND to a slot's list (and append new slots to COS_SLOTS): reordering changes what other racers see.

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

/** `refund`: garage money paid back when a case drops something you already own. */
export const RARITY: Record<Rarity, { name: string; color: number; refund: number }> = {
  common: { name: 'Common', color: 0xaab4c3, refund: 300 },
  rare: { name: 'Rare', color: 0x4b8bff, refund: 700 },
  epic: { name: 'Epic', color: 0xb05cff, refund: 1600 },
  legendary: { name: 'Legendary', color: 0xffb020, refund: 4000 },
  mythic: { name: 'Mythic', color: 0xff3d6e, refund: 10000 },
};

export type CosSlot = 'paint' | 'decal' | 'window' | 'head' | 'tail' | 'rims' | 'caliper' | 'glow' | 'plate' | 'frame' | 'exhaust';
/** Wire order: append only. */
export const COS_SLOTS: readonly CosSlot[] = ['paint', 'decal', 'window', 'head', 'tail', 'rims', 'caliper', 'glow', 'plate', 'frame', 'exhaust'];

export const SLOT_INFO: Record<CosSlot, { name: string; icon: string }> = {
  paint: { name: 'Paint job', icon: '🎨' },
  decal: { name: 'Decal', icon: '✶' },
  window: { name: 'Window tint', icon: '▦' },
  head: { name: 'Headlights', icon: '◐' },
  tail: { name: 'Tail lights', icon: '◑' },
  rims: { name: 'Rim finish', icon: '◎' },
  caliper: { name: 'Calipers', icon: '◖' },
  glow: { name: 'Underglow', icon: '✺' },
  plate: { name: 'Plate', icon: '▭' },
  frame: { name: 'Plate frame', icon: '⬚' },
  exhaust: { name: 'Exhaust tips', icon: '◉' },
};

// ---------------------------------------------------------------------------------------------
// What each slot's items carry: the render parameters (toge/client/cosmeticsview.ts draws them)

export type Finish = 'gloss' | 'metallic' | 'matte' | 'satin' | 'pearl' | 'chrome' | 'candy' | 'flip';
export type Pattern =
  | 'solid' | 'fade' | 'twotone' | 'racing' | 'pinstripe' | 'flames' | 'camo' | 'pixel' | 'carbon' | 'checker'
  | 'tiger' | 'sakura' | 'circuit' | 'wave' | 'galaxy' | 'hex' | 'splatter' | 'dazzle';
export type DecalKind = 'wakaba' | 'momiji' | 'number' | 'roundel' | 'sponsor' | 'kanji' | 'bolt' | 'stars' | 'rising' | 'sakura' | 'shark' | 'kitsune' | 'banner';

/** `accent` / `accent2` are the pattern's inks; `glow` makes the accent ink glow (an emissive map). */
export interface PaintFx { finish: Finish; pattern: Pattern; base: number; accent: number; accent2: number; glow?: boolean }
export interface DecalFx { kind: DecalKind; ink: number; ink2: number; text?: string; glow?: boolean }
/** `dark` 0..1: how much the glass swallows reflections; `mirror` a metal film; `iri` an iridescent one. */
export interface WindowFx { color: number; dark: number; mirror?: boolean; iri?: boolean }
export interface HeadFx { color: number; power: number }
export interface TailFx { lens: number; light: number }
export interface RimFx { color: number; metal: number; rough: number; glow?: boolean }
export interface CaliperFx { color: number; glow?: boolean }
export interface GlowFx { color: number; power: number }
/** `band`: a Euro-style strip down the left; `text` replaces the car's default plate text. */
export interface PlateFx { bg: number; ink: number; band?: number; text?: string; glow?: boolean; carbon?: boolean }
/** `cover`: opacity of a smoked plate cover (0 = none). */
export interface FrameFx { color: number; metal: number; rough: number; glow?: boolean; cover: number }
/** `heat`: the glow inside the pipe (0 = a dark hole). */
export interface ExhaustFx { color: number; metal: number; rough: number; heat: number }

export interface FxBySlot {
  paint: PaintFx;
  decal: DecalFx;
  window: WindowFx;
  head: HeadFx;
  tail: TailFx;
  rims: RimFx;
  caliper: CaliperFx;
  glow: GlowFx;
  plate: PlateFx;
  frame: FrameFx;
  exhaust: ExhaustFx;
}

export type CaseId = 'street' | 'night' | 'chrome' | 'livery' | 'legend';

export type CosItem = { [S in CosSlot]: { id: string; name: string; slot: S; rarity: Rarity; cases: readonly CaseId[]; fx: FxBySlot[S] } }[CosSlot];
export type ItemOf<S extends CosSlot> = Extract<CosItem, { slot: S }>;

const make =
  <S extends CosSlot>(slot: S) =>
  (id: string, name: string, rarity: Rarity, cases: readonly CaseId[], fx: FxBySlot[S]) =>
    ({ id, name, slot, rarity, cases, fx }) as ItemOf<S>;

const S: CaseId[] = ['street'];
const N: CaseId[] = ['night'];
const C: CaseId[] = ['chrome'];
const V: CaseId[] = ['livery'];
const SN: CaseId[] = ['street', 'night'];
const SV: CaseId[] = ['street', 'livery'];
const SC: CaseId[] = ['street', 'chrome'];
const NC: CaseId[] = ['night', 'chrome'];
const NV: CaseId[] = ['night', 'livery'];
const CV: CaseId[] = ['chrome', 'livery'];

const p = make('paint');
const paint = (finish: Finish, pattern: Pattern, base: number, accent = 0xffffff, accent2 = 0x111317, glow = false): PaintFx => ({ finish, pattern, base, accent, accent2, ...(glow ? { glow } : {}) });
const d = make('decal');
const w = make('window');
const h = make('head');
const t = make('tail');
const r = make('rims');
const c = make('caliper');
const g = make('glow');
const pl = make('plate');
const f = make('frame');
const e = make('exhaust');

/** Every item, by slot, in wire order. APPEND ONLY within each list. */
export const CATALOG: { [K in CosSlot]: readonly ItemOf<K>[] } = {
  paint: [
    p('p_midnight', 'Midnight Metallic', 'common', S, paint('metallic', 'solid', 0x0b1f4a)),
    p('p_lime', 'Acid Lime', 'common', S, paint('gloss', 'solid', 0x9be22d)),
    p('p_stealth', 'Stealth Matte', 'common', SN, paint('matte', 'solid', 0x16181c)),
    p('p_olive', 'Field Olive', 'common', S, paint('matte', 'solid', 0x4b5a32)),
    p('p_sand', 'Desert Sand', 'common', S, paint('satin', 'solid', 0xc9ad7f)),
    p('p_coral', 'Coral Reef', 'common', S, paint('gloss', 'solid', 0xff6f61)),
    p('p_nardo', 'Nardo Grey', 'common', S, paint('satin', 'solid', 0x8d9093)),
    p('p_amethyst', 'Matte Amethyst', 'common', N, paint('matte', 'solid', 0x5b3a8f)),
    p('p_mint', 'Mint Satin', 'common', S, paint('satin', 'solid', 0x9be8c8)),
    p('p_glacier', 'Glacier Pearl', 'rare', SC, paint('pearl', 'solid', 0xeef4ff)),
    p('p_bronze', 'Burnt Bronze', 'rare', C, paint('metallic', 'solid', 0x8a5a2b)),
    p('p_lagoon', 'Lagoon Fade', 'rare', SV, paint('metallic', 'fade', 0x0bb4c9, 0x1d4ed8)),
    p('p_sunset', 'Sunset Fade', 'rare', NV, paint('pearl', 'fade', 0xff6a13, 0x7c3aed)),
    p('p_panda', 'Panda', 'rare', SV, paint('gloss', 'twotone', 0xf2f2f0, 0x111317)),
    p('p_cafe', 'Café Cream', 'rare', S, paint('gloss', 'twotone', 0xf3e6c8, 0x6b3e26)),
    p('p_lemans', 'Le Mans Stripes', 'rare', V, paint('gloss', 'racing', 0x1d4ed8, 0xf2f2f0)),
    p('p_heritage', 'Heritage Stripes', 'rare', V, paint('metallic', 'racing', 0x0f5132, 0xf5b301)),
    p('p_pinstripe', 'Pinstripe Classic', 'rare', V, paint('gloss', 'pinstripe', 0x111317, 0xd4a017)),
    p('p_woodland', 'Woodland Camo', 'rare', S, paint('matte', 'camo', 0x4b5a32, 0x2b3320, 0x8a7a52)),
    p('p_urban', 'Urban Camo', 'rare', S, paint('matte', 'camo', 0x8d9093, 0x4a4d52, 0xd4d6d8)),
    p('p_honeycomb', 'Honeycomb', 'rare', V, paint('satin', 'hex', 0x16181c, 0xf5b301)),
    p('p_paintball', 'Paintball', 'rare', S, paint('gloss', 'splatter', 0xf2f2f0, 0xff2bd6, 0x22e6ff)),
    p('p_hotrod', 'Hot Rod Flames', 'epic', SV, paint('gloss', 'flames', 0x111317, 0xff3b1a, 0xffc21a)),
    p('p_ghostflame', 'Ghost Flames', 'epic', N, paint('metallic', 'flames', 0x0d1b2a, 0x22e6ff, 0xe8f1ff, true)),
    p('p_arctic', 'Arctic Digital', 'epic', V, paint('matte', 'pixel', 0xe8eef4, 0x9fb3c8, 0x4a5a6e)),
    p('p_carbon', 'Full Carbon', 'epic', CV, paint('gloss', 'carbon', 0x1a1b1e, 0x34373f)),
    p('p_rosechrome', 'Rose Gold Chrome', 'epic', C, paint('chrome', 'solid', 0xf2b6a0)),
    p('p_cobaltchrome', 'Cobalt Chrome', 'epic', C, paint('chrome', 'solid', 0x4f7bff)),
    p('p_candyapple', 'Candy Apple', 'epic', SC, paint('candy', 'solid', 0xb3001b)),
    p('p_grape', 'Grape Candy', 'epic', N, paint('candy', 'solid', 0x5b1a8f)),
    p('p_chequered', 'Chequered Finish', 'epic', V, paint('gloss', 'checker', 0xf2f2f0, 0x111317)),
    p('p_tora', 'Tora', 'epic', V, paint('gloss', 'tiger', 0xff8a00, 0x111317)),
    p('p_hanami', 'Hanami', 'epic', V, paint('pearl', 'sakura', 0xffe4ee, 0xf472b6, 0xffffff)),
    p('p_dazzle', 'Dazzle', 'epic', V, paint('satin', 'dazzle', 0xf2f2f0, 0x111317)),
    p('p_redweave', 'Red Weave', 'legendary', C, paint('gloss', 'carbon', 0x3a0a0e, 0xc8102e)),
    p('p_chrome', 'Liquid Chrome', 'legendary', C, paint('chrome', 'solid', 0xe6e9ee)),
    p('p_goldrush', 'Gold Rush Chrome', 'legendary', C, paint('chrome', 'solid', 0xffcf5a)),
    p('p_aurora', 'Aurora Flip', 'legendary', NC, paint('flip', 'solid', 0x1a8f7a)),
    p('p_oilslick', 'Oil Slick', 'legendary', N, paint('flip', 'solid', 0x202030)),
    p('p_circuit', 'Neon Circuit', 'legendary', N, paint('satin', 'circuit', 0x0a0f1a, 0x22e6ff, 0xff2bd6, true)),
    p('p_greatwave', 'Great Wave', 'legendary', V, paint('gloss', 'wave', 0xf3ead0, 0x1d3a6e, 0xffffff)),
    p('p_nebula', 'Nebula', 'mythic', N, paint('pearl', 'galaxy', 0x0b0620, 0xff2bd6, 0x22e6ff, true)),
    p('p_solarcrown', 'Solar Crown', 'mythic', C, paint('chrome', 'fade', 0xffb020, 0xff3d6e)),
    p('p_ninetails', 'Nine Tails', 'mythic', V, paint('pearl', 'flames', 0xf6f0e0, 0xd9473d, 0xffd76a, true)),
  ],
  decal: [
    d('d_wakaba', 'Beginner Leaf', 'common', S, { kind: 'wakaba', ink: 0x2fae4a, ink2: 0xf5d23a }),
    d('d_momiji', 'Elder Leaf', 'common', S, { kind: 'momiji', ink: 0xff8a00, ink2: 0xf5d23a }),
    d('d_seven', 'Number 7', 'common', SV, { kind: 'number', ink: 0x111317, ink2: 0xf2f2f0, text: '7' }),
    d('d_togeworks', 'TŌGE Works', 'common', S, { kind: 'sponsor', ink: 0xf2f2f0, ink2: 0xc8102e, text: 'TOGE WORKS' }),
    d('d_mameko', 'Mameko Racing', 'common', S, { kind: 'sponsor', ink: 0xf5b301, ink2: 0x111317, text: 'MAMEKO RACING' }),
    d('d_eightsix', 'Eight-Six', 'rare', V, { kind: 'number', ink: 0xf2f2f0, ink2: 0x111317, text: '86' }),
    d('d_roundel', 'Roundel 27', 'rare', V, { kind: 'roundel', ink: 0x111317, ink2: 0xf2f2f0, text: '27' }),
    d('d_pass', 'Kanji: Pass', 'rare', V, { kind: 'kanji', ink: 0xf2f2f0, ink2: 0x111317, text: '峠' }),
    d('d_wind', 'Kanji: Wind', 'rare', V, { kind: 'kanji', ink: 0x22e6ff, ink2: 0x111317, text: '風' }),
    d('d_bolt', 'Lightning Bolt', 'rare', S, { kind: 'bolt', ink: 0xffd400, ink2: 0x111317 }),
    d('d_stars', 'Star Spangle', 'rare', N, { kind: 'stars', ink: 0xf2f2f0, ink2: 0xffd76a }),
    d('d_petals', 'Petal Drift', 'rare', V, { kind: 'sakura', ink: 0xf472b6, ink2: 0xffffff }),
    d('d_dragon', 'Kanji: Dragon', 'epic', NV, { kind: 'kanji', ink: 0xff3b1a, ink2: 0x111317, text: '龍' }),
    d('d_rising', 'Rising Sun Hood', 'epic', V, { kind: 'rising', ink: 0xc8102e, ink2: 0xf2f2f0 }),
    d('d_shark', 'Shark Teeth', 'epic', S, { kind: 'shark', ink: 0xf2f2f0, ink2: 0xc8102e }),
    d('d_nightrun', 'Neon Tag', 'epic', N, { kind: 'sponsor', ink: 0xff2bd6, ink2: 0x22e6ff, text: 'NIGHT RUN', glow: true }),
    d('d_kitsune', 'Fox Spirit', 'legendary', V, { kind: 'kitsune', ink: 0xf6f0e0, ink2: 0xd9473d }),
    d('d_driftking', 'Drift King', 'legendary', SV, { kind: 'banner', ink: 0xffd76a, ink2: 0x111317, text: 'DRIFT KING' }),
    d('d_goldragon', 'Gold Leaf Dragon', 'mythic', V, { kind: 'kanji', ink: 0xffd76a, ink2: 0x7a1a0a, text: '龍', glow: true }),
  ],
  window: [
    w('w_light', 'Light Smoke', 'common', S, { color: 0x2a323c, dark: 0.3 }),
    w('w_medium', 'Medium Smoke', 'common', S, { color: 0x161b22, dark: 0.6 }),
    w('w_ocean', 'Ocean Tint', 'common', S, { color: 0x0c2a4a, dark: 0.4 }),
    w('w_jade', 'Jade Tint', 'common', S, { color: 0x0c3a2a, dark: 0.4 }),
    w('w_limo', 'Limo Black', 'rare', SN, { color: 0x020304, dark: 1 }),
    w('w_amber', 'Amber Tint', 'rare', N, { color: 0x4a2a06, dark: 0.4 }),
    w('w_rose', 'Rose Tint', 'rare', N, { color: 0x4a0c2a, dark: 0.4 }),
    w('w_violet', 'Violet Tint', 'rare', N, { color: 0x2a0c4a, dark: 0.4 }),
    w('w_mirror', 'Mirror Film', 'epic', C, { color: 0xc9ccd1, dark: 0, mirror: true }),
    w('w_chameleon', 'Chameleon Film', 'epic', NC, { color: 0x1a2a3a, dark: 0.2, iri: true }),
    w('w_goldmirror', 'Gold Mirror', 'legendary', C, { color: 0xffcf5a, dark: 0, mirror: true }),
    w('w_neonfilm', 'Neon Film', 'legendary', N, { color: 0x3a0a3a, dark: 0.1, iri: true }),
    w('w_opal', 'Black Opal', 'mythic', N, { color: 0x05060a, dark: 0.5, mirror: true, iri: true }),
  ],
  head: [
    h('h_xenon', 'Xenon Blue', 'common', S, { color: 0xcfe4ff, power: 1 }),
    h('h_yellow', 'Selective Yellow', 'common', S, { color: 0xffd24a, power: 1 }),
    h('h_halogen', 'Halogen Warm', 'common', S, { color: 0xffd8a0, power: 0.9 }),
    h('h_ice', 'Ice Cube', 'rare', N, { color: 0xa8f0ff, power: 1.2 }),
    h('h_violet', 'Violet Beam', 'rare', N, { color: 0xb38cff, power: 1.2 }),
    h('h_bubblegum', 'Bubblegum', 'rare', N, { color: 0xff7ad0, power: 1.2 }),
    h('h_toxic', 'Toxic Green', 'epic', N, { color: 0x7dff3a, power: 1.4 }),
    h('h_demon', 'Demon Eyes', 'epic', NC, { color: 0xff2a2a, power: 1.4 }),
    h('h_laser', 'Laser White', 'legendary', C, { color: 0xffffff, power: 2.2 }),
    h('h_spirit', 'Spirit Fire', 'mythic', N, { color: 0x3affd2, power: 2.6 }),
  ],
  tail: [
    t('t_smoked', 'Smoked Lens', 'common', S, { lens: 0x1a0505, light: 0xff1a12 }),
    t('t_amber', 'Amber Glow', 'common', S, { lens: 0x4a2a06, light: 0xff8a1a }),
    t('t_altezza', 'Clear Altezza', 'rare', SC, { lens: 0xc9ccd1, light: 0xff2a1a }),
    t('t_blackout', 'Blackout', 'rare', N, { lens: 0x050505, light: 0xff0a0a }),
    t('t_plum', 'Plum', 'rare', N, { lens: 0x2a0a3a, light: 0xb02aff }),
    t('t_bluedot', 'Blue Dot', 'epic', N, { lens: 0x0a1a4a, light: 0x2a6aff }),
    t('t_neonpink', 'Neon Pink', 'epic', N, { lens: 0x3a0a2a, light: 0xff2bd6 }),
    t('t_lava', 'Lava Core', 'legendary', NC, { lens: 0x2a0a00, light: 0xff6a00 }),
  ],
  rims: [
    r('r_black', 'Gloss Black', 'common', S, { color: 0x111214, metal: 0.6, rough: 0.2 }),
    r('r_gunmetal', 'Gunmetal', 'common', S, { color: 0x4a4f57, metal: 0.9, rough: 0.3 }),
    r('r_white', 'Track White', 'common', S, { color: 0xf4f4f4, metal: 0.2, rough: 0.35 }),
    r('r_copper', 'Copper', 'common', C, { color: 0xb8733e, metal: 1, rough: 0.25 }),
    r('r_bronze', 'Rally Bronze', 'rare', SC, { color: 0xa0702a, metal: 0.9, rough: 0.3 }),
    r('r_gold', 'Gold Leaf', 'rare', C, { color: 0xffc94a, metal: 1, rough: 0.18 }),
    r('r_candyred', 'Candy Red', 'rare', S, { color: 0xc8102e, metal: 0.7, rough: 0.15 }),
    r('r_anoblue', 'Anodized Blue', 'rare', N, { color: 0x2a6aff, metal: 1, rough: 0.2 }),
    r('r_anoviolet', 'Anodized Violet', 'rare', N, { color: 0x8a3aff, metal: 1, rough: 0.2 }),
    r('r_chrome', 'Mirror Chrome', 'epic', C, { color: 0xf0f2f5, metal: 1, rough: 0.03 }),
    r('r_rosegold', 'Rose Gold', 'epic', C, { color: 0xf2a38a, metal: 1, rough: 0.12 }),
    r('r_neon', 'Neon Ring', 'epic', N, { color: 0x22e6ff, metal: 0.3, rough: 0.3, glow: true }),
    r('r_blackchrome', 'Black Chrome', 'legendary', C, { color: 0x2a2c31, metal: 1, rough: 0.04 }),
    r('r_plasma', 'Plasma', 'mythic', N, { color: 0xff2bd6, metal: 0.4, rough: 0.2, glow: true }),
  ],
  caliper: [
    c('c_yellow', 'Brembo Yellow', 'common', S, { color: 0xf5c400 }),
    c('c_blue', 'Track Blue', 'common', S, { color: 0x1d4ed8 }),
    c('c_black', 'Satin Black', 'common', S, { color: 0x15171b }),
    c('c_orange', 'Safety Orange', 'common', S, { color: 0xff6a13 }),
    c('c_green', 'Lime Green', 'rare', S, { color: 0x7dd321 }),
    c('c_gold', 'Gold', 'rare', C, { color: 0xd4a017 }),
    c('c_pink', 'Hot Pink', 'rare', N, { color: 0xff4fa8 }),
    c('c_cyanglow', 'Cyan Glow', 'epic', N, { color: 0x22e6ff, glow: true }),
    c('c_hotbrakes', 'Hot Brakes', 'legendary', NC, { color: 0xff4a00, glow: true }),
  ],
  glow: [
    g('g_blue', 'Electric Blue', 'common', S, { color: 0x2a6aff, power: 1 }),
    g('g_red', 'Crimson', 'common', S, { color: 0xff1a2a, power: 1 }),
    g('g_orange', 'Ember', 'common', S, { color: 0xff6a13, power: 1 }),
    g('g_purple', 'Purple Haze', 'rare', N, { color: 0x9a3aff, power: 1.3 }),
    g('g_teal', 'Teal Tide', 'rare', N, { color: 0x14e0c0, power: 1.3 }),
    g('g_pink', 'Hot Pink', 'rare', N, { color: 0xff3ab0, power: 1.3 }),
    g('g_radioactive', 'Radioactive', 'epic', N, { color: 0x7dff3a, power: 1.8 }),
    g('g_supernova', 'Supernova', 'epic', NC, { color: 0xe8f1ff, power: 2 }),
    g('g_ultraviolet', 'Ultraviolet', 'legendary', N, { color: 0x6a2aff, power: 2.6 }),
    g('g_solarflare', 'Solar Flare', 'mythic', S, { color: 0xffb020, power: 3.2 }),
  ],
  plate: [
    pl('pl_jdm', 'JDM Plate', 'common', S, { bg: 0xf4f1e8, ink: 0x0f5a2a }),
    pl('pl_kei', 'Kei Yellow', 'common', S, { bg: 0xf5d23a, ink: 0x111317 }),
    pl('pl_euro', 'Euro Plate', 'common', S, { bg: 0xf8f8f8, ink: 0x111317, band: 0x1d3fbf }),
    pl('pl_golden', 'Golden State', 'common', S, { bg: 0xf8f8f8, ink: 0x1d3fbf, band: 0xc8102e }),
    pl('pl_classic', 'Classic Black', 'rare', SC, { bg: 0x111317, ink: 0xf5d23a }),
    pl('pl_navy', 'Navy Silver', 'rare', C, { bg: 0x0b1f4a, ink: 0xe6e9ee }),
    pl('pl_drift', 'Vanity: DRIFT', 'rare', S, { bg: 0xf4f1e8, ink: 0xc8102e, text: 'DRIFT' }),
    pl('pl_carbon', 'Carbon Plate', 'epic', C, { bg: 0x1a1b1e, ink: 0xf2f2f0, carbon: true }),
    pl('pl_gold', 'Gold Plate', 'epic', C, { bg: 0xd4a017, ink: 0x111317 }),
    pl('pl_neon', 'Neon Plate', 'epic', N, { bg: 0x0a0f1a, ink: 0x22e6ff, glow: true }),
    pl('pl_ggez', 'Vanity: GG EZ', 'epic', SN, { bg: 0x111317, ink: 0xff2bd6, text: 'GG EZ', glow: true }),
    pl('pl_toge1', 'Vanity: TOGE 1', 'legendary', C, { bg: 0xd4a017, ink: 0x111317, text: 'TOGE 1' }),
    pl('pl_goat', 'Vanity: GOAT', 'mythic', N, { bg: 0x05060a, ink: 0xffd76a, text: 'GOAT', glow: true }),
  ],
  frame: [
    f('f_chrome', 'Chrome Frame', 'common', SC, { color: 0xe6e9ee, metal: 1, rough: 0.08, cover: 0 }),
    f('f_black', 'Black Frame', 'common', S, { color: 0x111214, metal: 0.2, rough: 0.5, cover: 0 }),
    f('f_red', 'Red Anodized', 'common', S, { color: 0xc8102e, metal: 0.8, rough: 0.25, cover: 0 }),
    f('f_carbon', 'Carbon Frame', 'rare', C, { color: 0x24262b, metal: 0.3, rough: 0.2, cover: 0 }),
    f('f_gold', 'Gold Frame', 'rare', C, { color: 0xffc94a, metal: 1, rough: 0.15, cover: 0 }),
    f('f_smoked', 'Smoked Cover', 'rare', SN, { color: 0x111214, metal: 0.2, rough: 0.4, cover: 0.55 }),
    f('f_blackout', 'Blackout Cover', 'epic', N, { color: 0x050505, metal: 0.2, rough: 0.4, cover: 0.82 }),
    f('f_neon', 'Neon Frame', 'epic', N, { color: 0x22e6ff, metal: 0, rough: 0.5, glow: true, cover: 0 }),
    f('f_pinkneon', 'Pink Neon Frame', 'epic', N, { color: 0xff2bd6, metal: 0, rough: 0.5, glow: true, cover: 0 }),
    f('f_diamond', 'Diamond Frame', 'legendary', C, { color: 0xf4f8ff, metal: 1, rough: 0.02, cover: 0 }),
    f('f_halo', 'Halo Frame', 'mythic', C, { color: 0xffd76a, metal: 0, rough: 0.4, glow: true, cover: 0.3 }),
  ],
  exhaust: [
    e('e_polished', 'Polished Tips', 'common', SC, { color: 0xe6e9ee, metal: 1, rough: 0.08, heat: 0 }),
    e('e_black', 'Black Tips', 'common', S, { color: 0x111214, metal: 0.5, rough: 0.4, heat: 0 }),
    e('e_copper', 'Copper Tips', 'common', C, { color: 0xb8733e, metal: 1, rough: 0.2, heat: 0 }),
    e('e_titanium', 'Burnt Titanium', 'rare', C, { color: 0x7a6ab0, metal: 1, rough: 0.15, heat: 0 }),
    e('e_carbon', 'Carbon Tips', 'rare', S, { color: 0x24262b, metal: 0.3, rough: 0.2, heat: 0 }),
    e('e_gold', 'Gold Tips', 'epic', C, { color: 0xffc94a, metal: 1, rough: 0.12, heat: 0 }),
    e('e_afterfire', 'Afterfire', 'epic', SN, { color: 0x5a5f68, metal: 1, rough: 0.3, heat: 0xff6a00 }),
    e('e_blueflame', 'Blue Flame', 'legendary', NC, { color: 0x7a6ab0, metal: 1, rough: 0.15, heat: 0x3a8aff }),
    e('e_dragon', 'Dragon Breath', 'mythic', C, { color: 0xffc94a, metal: 1, rough: 0.1, heat: 0xff2a00 }),
  ],
};

export const COS_ITEMS: readonly CosItem[] = COS_SLOTS.flatMap((s) => CATALOG[s] as readonly CosItem[]);
const BY_ID = new Map(COS_ITEMS.map((i) => [i.id, i]));
export const cosById = (id: unknown): CosItem | undefined => (typeof id === 'string' ? BY_ID.get(id) : undefined);

// ---------------------------------------------------------------------------------------------
// Cases

export interface CosCase {
  id: CaseId;
  name: string;
  blurb: string;
  price: number;
  color: number;
  /** Relative chance of each rarity (renormalised over the rarities the case holds). */
  weights: Partial<Record<Rarity, number>>;
}

export const COS_CASES: readonly CosCase[] = [
  { id: 'street', name: 'Street Case', blurb: 'Everyday mods: solid paints, smoke tints, plates, calipers and the odd surprise.', price: 1200, color: 0x38c9ff, weights: { common: 64, rare: 26, epic: 8, legendary: 1.7, mythic: 0.3 } },
  { id: 'night', name: 'Night Run Case', blurb: 'Glow after dark: underglow, neon rims, lamp tints, flip paints.', price: 2500, color: 0xff2bd6, weights: { common: 48, rare: 32, epic: 14, legendary: 5, mythic: 1 } },
  { id: 'livery', name: 'Livery Case', blurb: 'Paint jobs with a story: stripes, flames, camo, kanji and race numbers.', price: 2500, color: 0xff8a00, weights: { common: 48, rare: 32, epic: 14, legendary: 5, mythic: 1 } },
  { id: 'chrome', name: 'Chrome Case', blurb: 'Shiny things: chrome paint, mirror tints, gold rims, frames and tips.', price: 3000, color: 0xd9dde4, weights: { common: 40, rare: 34, epic: 18, legendary: 6.5, mythic: 1.5 } },
  { id: 'legend', name: 'Legend Case', blurb: 'Epic or better, from every case. The big one.', price: 8000, color: 0xffb020, weights: { epic: 72, legendary: 23, mythic: 5 } },
];

export const cosCaseById = (id: unknown): CosCase | undefined => COS_CASES.find((x) => x.id === id);

/** What a case can drop. The Legend Case holds every epic-or-better item. */
export function caseItems(id: CaseId): CosItem[] {
  if (id === 'legend') return COS_ITEMS.filter((i) => RARITIES.indexOf(i.rarity) >= RARITIES.indexOf('epic'));
  return COS_ITEMS.filter((i) => i.cases.includes(id));
}

/** Chance (0..1) of each rarity: the case's weights over the rarities it actually holds. */
export function caseOdds(id: CaseId): Partial<Record<Rarity, number>> {
  const box = cosCaseById(id);
  if (!box) return {};
  const items = caseItems(id);
  const have = RARITIES.filter((r) => (box.weights[r] ?? 0) > 0 && items.some((i) => i.rarity === r));
  const total = have.reduce((s, r) => s + box.weights[r]!, 0);
  return Object.fromEntries(have.map((r) => [r, box.weights[r]! / total]));
}

/** One drop: a rarity by the case's odds, then a uniformly random item of that rarity. `rnd` is [0, 1). */
export function rollCosCase(id: CaseId, rnd: () => number): CosItem {
  const odds = caseOdds(id);
  let x = rnd();
  let rarity: Rarity = 'common';
  for (const r of RARITIES) {
    const p = odds[r];
    if (!p) continue;
    rarity = r;
    if ((x -= p) < 0) break;
  }
  const pool = caseItems(id).filter((i) => i.rarity === rarity);
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

// ---------------------------------------------------------------------------------------------
// What a car wears: one item id per slot, plus its own plate text

export type CosKit = Partial<Record<CosSlot, string>>;

/** The equipped item in `slot`, typed by slot. */
export function equipped<K extends CosSlot>(kit: CosKit | undefined, slot: K): ItemOf<K> | undefined {
  const it = cosById(kit?.[slot]);
  return it && it.slot === slot ? (it as ItemOf<K>) : undefined;
}

/** Anything to a kit of existing items, each in its own slot. */
export function cleanKit(x: unknown): CosKit {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const kit: CosKit = {};
  for (const s of COS_SLOTS) if (cosById(o[s])?.slot === s) kit[s] = o[s] as string;
  return kit;
}

export const PLATE_MAX = 8;
/** Plate text: capitals, digits, single spaces, at most PLATE_MAX characters ('' = the car's stock plate). */
export function cleanPlate(x: unknown): string {
  if (typeof x !== 'string') return '';
  return x.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, PLATE_MAX).trim();
}

/** A kit and plate text as one wire segment: per-slot catalog indices (base 36), then `~` and the plate ('_' for spaces). */
export function encodeKit(kit: CosKit, plate: string): string {
  const idx = COS_SLOTS.map((s) => {
    const i = (CATALOG[s] as readonly CosItem[]).findIndex((it) => it.id === kit[s]);
    return i < 0 ? '' : i.toString(36);
  });
  while (idx.length && !idx[idx.length - 1]) idx.pop();
  const text = cleanPlate(plate);
  return idx.join('-') + (text ? '~' + text.replace(/ /g, '_') : '');
}

/** The inverse of encodeKit; null for anything malformed or naming an item that doesn't exist. */
export function decodeKit(code: string): { kit: CosKit; plate: string } | null {
  if (typeof code !== 'string' || code.length > 64) return null;
  const [idxPart, platePart, extra] = code.split('~');
  if (extra !== undefined) return null;
  const kit: CosKit = {};
  if (idxPart) {
    const parts = idxPart.split('-');
    if (parts.length > COS_SLOTS.length) return null;
    for (const [i, s] of parts.entries()) {
      if (!s) continue;
      if (!/^[0-9a-z]{1,2}$/.test(s)) return null;
      const it = (CATALOG[COS_SLOTS[i]] as readonly CosItem[])[parseInt(s, 36)];
      if (!it) return null;
      kit[COS_SLOTS[i]] = it.id;
    }
  }
  let plate = '';
  if (platePart !== undefined) {
    const raw = platePart.replace(/_/g, ' ');
    plate = cleanPlate(raw);
    if (!plate || plate !== raw) return null;
  }
  return { kit, plate };
}
