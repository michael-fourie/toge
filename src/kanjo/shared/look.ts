// A driver of your own: what the creator picks, as data both sides share. The parts are built by
// tools/drivers/wardrobe.py (docs/DRIVER_CREATOR.md); this catalogue mirrors its manifest so the server
// can check a look without loading files (tests/look.test.ts keeps the two in step).
//
// On the wire a look is a short code, `L3.` + dot-separated fields (catalogue indices in base 36,
// colours as 6 hex digits), carried in `driver=` where a legend's id would be. `L2.` codes, from when
// clothes were whole outfits, still decode: each outfit becomes its top and bottom (`L2_OUTFITS`).

/** Body bases: a MakeHuman frame ('m' or 'f') and build each, with their own skeleton and seated pose. */
export const BASES = { m_slim: 'm', m_avg: 'm', m_heavy: 'm', f_slim: 'f', f_avg: 'f', f_heavy: 'f' } as const;
/**
 * MakeHuman skins (tone and age) per frame, in the same order for both, so changing frame keeps the
 * tone and age: young (two lighter tones), African, Asian; then middle-aged and old in three tones.
 */
export const SKINS = {
  m: ['young_caucasian_male', 'young_caucasian_male2', 'young_african_male', 'young_asian_male', 'middleage_caucasian_male', 'middleage_african_male', 'middleage_asian_male', 'old_caucasian_male', 'old_african_male', 'old_asian_male'],
  f: ['young_caucasian_female', 'young_caucasian_female2', 'young_african_female', 'young_asian_female', 'middleage_caucasian_female', 'middleage_african_female', 'middleage_asian_female', 'old_caucasian_female', 'old_african_female', 'old_asian_female'],
} as const;
export const EYES = ['brown', 'brownlight', 'blue', 'bluegreen', 'deepblue', 'lightblue', 'green', 'grey', 'ice'] as const;
export const HAIRS = ['none', 'short01', 'short02', 'short03', 'short04', 'bob01', 'bob02', 'ponytail01', 'braid01', 'long01', 'afro01'] as const;
export const BROWS = ['eyebrow001', 'eyebrow002', 'eyebrow003', 'eyebrow004', 'eyebrow005', 'eyebrow006', 'eyebrow007', 'eyebrow008', 'eyebrow009', 'eyebrow010', 'eyebrow011', 'eyebrow012'] as const;
/**
 * Clothes are separates: a top and a bottom, each with its own colour zones (the manifest's `zones`, in order)
 * and the colours it comes in: the drivers' soft palette (dusty pastels, mid-light, never near black;
 * tools/drivers/cast.py). A `full` top is a one-piece (overalls, the denim suit): it takes both places, so it is
 * worn with no bottom (`NO_BOTTOM`). Wire order: append only.
 */
export const TOPS = {
  suit_jacket: { zones: ['tie', 'jacket', 'shirt'], colors: [0xe4c383, 0x75988a, 0xeee8da] },
  field_jacket: { zones: ['stripes', 'jacket'], colors: [0xe6918f, 0x5c637e] },
  long_tee: { zones: ['trim', 'tee'], colors: [0xf2c887, 0x95b2bf] },
  pinstripe_shirt: { zones: ['stripes', 'shirt'], colors: [0xdac4a4, 0x646781] },
  trim_tee: { zones: ['trim', 'tee'], colors: [0x91e4b6, 0x5b5e72] },
  plain_tee: { zones: ['tee'], colors: [0xeee8da] },
  fitted_tee: { zones: ['trim', 'tee'], colors: [0xf2a1de, 0x717496] },
  cap_tee: { zones: ['trim', 'tee'], colors: [0xf2c887, 0xeee8da] },
  blouse: { zones: ['stripes', 'shirt'], colors: [0xe4c383, 0x646781] },
  crop_top: { zones: ['trim', 'top'], colors: [0xf2a1de, 0x9397be] },
  overalls: { zones: ['overalls', 'tee'], colors: [0xc69376, 0x7f899b], full: true },
  denim_suit: { zones: ['patches', 'denim'], colors: [0xcea685, 0x89909e], full: true },
} as const satisfies Record<string, Garment>;
export const BOTTOMS = {
  suit_trousers: { zones: ['trousers'], colors: [0x75988a] },
  field_jeans: { zones: ['jeans'], colors: [0x9096ac] },
  washed_jeans: { zones: ['jeans'], colors: [0x7686a0] },
  dark_jeans: { zones: ['jeans'], colors: [0x7f869b] },
  grey_jeans: { zones: ['jeans'], colors: [0x757b8d] },
  blue_jeans: { zones: ['jeans'], colors: [0x8898b8] },
  slim_jeans: { zones: ['jeans'], colors: [0x7686a0] },
  shorts: { zones: ['shorts'], colors: [0x95b2bf] },
  skirt: { zones: ['skirt'], colors: [0x75988a] },
  leggings: { zones: ['stripe', 'leggings'], colors: [0xf2a1de, 0x717496] },
} as const satisfies Record<string, Garment>;
interface Garment {
  zones: readonly string[];
  colors: readonly number[];
  /** A one-piece: worn as the top, with no bottom. */
  full?: true;
}
/** What `bottom` is under a one-piece. */
export const NO_BOTTOM = 'none';
/** What goes on when a one-piece comes off and only the other half was picked. */
const SPARE_TOP = 'plain_tee';
const SPARE_BOTTOM = 'blue_jeans';
export const SHOES = ['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06'] as const;
/** Kit pieces and the slot each takes: one piece per slot. */
export const KIT = {
  goggles_up: 'brow',
  goggles: 'eyes',
  monocle: 'eyes',
  respirator: 'mouth',
  implants: 'temple',
  collar: 'neck',
  bracer_l: 'arm_l',
  bracer_r: 'arm_r',
  mech_arm_l: 'arm_l',
  mech_arm_r: 'arm_r',
  pauldron_l: 'shoulder',
  gloves: 'hands',
  gloves_fingerless: 'hands',
  belt: 'waist',
  chest_strap: 'chest',
} as const;
/** Wire order: append only. The first six are free; the rest are battle pass rewards (`PASS_METALS`). */
export const METALS = ['brass', 'copper', 'gunmetal', 'chrome', 'steel', 'carbon', 'gold', 'obsidian', 'ember', 'prism'] as const;
/** Metals only the battle pass unlocks (pass.ts says at which tier). */
export const PASS_METALS: readonly (typeof METALS)[number][] = ['gold', 'obsidian', 'ember', 'prism'];
export const FREE_METALS = METALS.filter((m) => !PASS_METALS.includes(m));
/**
 * Battle pass gear: drawn in code on the driver's head bone (kanjo/client/passgear.ts), not built in Blender, so it
 * fits every body. Wire order: append only. Gear has no slot rule; each piece is in its own spot.
 */
export const GEAR = ['horns', 'ears', 'visor', 'halo'] as const;
export const LEATHERS = ['leather', 'leather_black', 'leather_tan'] as const;
export const WHEELS = ['wood', 'yoke', 'iron', 'deep'] as const;
/** At most this many kit pieces at once. */
export const KIT_MAX = 5;

export type BaseId = keyof typeof BASES;
type Frame = (typeof BASES)[BaseId];
export type SkinId = (typeof SKINS)[Frame][number];
type EyeId = (typeof EYES)[number];
type HairId = (typeof HAIRS)[number];
type BrowId = (typeof BROWS)[number];
export type TopId = keyof typeof TOPS;
export type BottomId = keyof typeof BOTTOMS;
type ShoeId = (typeof SHOES)[number];
export type KitId = keyof typeof KIT;
export type MetalId = (typeof METALS)[number];
export type LeatherId = (typeof LEATHERS)[number];
type WheelId = (typeof WHEELS)[number];
export type GearId = (typeof GEAR)[number];

/** A look on the wire (`L2.`: one saved before clothes were separates). */
export type LookCode = `L3.${string}` | `L2.${string}`;

export interface Look {
  base: BaseId;
  /** One of the base's frame's skins. */
  skin: SkinId;
  eyes: EyeId;
  brows: BrowId;
  hair: HairId;
  /** Hair and brows. */
  hairColor: number;
  top: TopId;
  /** One colour per zone of the top. */
  topColors: number[];
  /** `NO_BOTTOM` exactly when the top is a one-piece. */
  bottom: BottomId | typeof NO_BOTTOM;
  /** One colour per zone of the bottom (none under a one-piece). */
  bottomColors: number[];
  shoes: ShoeId;
  shoeColor: number;
  kit: KitId[];
  metal: MetalId;
  leather: LeatherId;
  /** Lenses, seams, implants: their glow. */
  glow: number;
  wheel: WheelId;
  /** Battle pass gear (empty for most looks; the code only carries it when there is some). */
  gear: GearId[];
}

const BASE_IDS = Object.keys(BASES) as BaseId[];
const ALL_SKINS: readonly SkinId[] = [...SKINS.m, ...SKINS.f];
export const TOP_IDS = Object.keys(TOPS) as TopId[];
export const BOTTOM_IDS = Object.keys(BOTTOMS) as BottomId[];
/** Bottoms on the wire: no bottom first, so a one-piece's is index 0. */
const BOTTOM_WIRE: readonly (BottomId | typeof NO_BOTTOM)[] = [NO_BOTTOM, ...BOTTOM_IDS];
const KIT_IDS = Object.keys(KIT) as KitId[];

/** Is this top a one-piece (worn with no bottom)? */
export const isFull = (t: TopId): boolean => (TOPS[t] as Garment).full === true;
const topColors = (t: TopId) => [...TOPS[t].colors] as number[];
const bottomColors = (b: BottomId | typeof NO_BOTTOM) => (b === NO_BOTTOM ? [] : ([...BOTTOMS[b].colors] as number[]));

/**
 * The outfits of `L2.` codes, in their wire order, as separates: the top and bottom each became, how many zone
 * colours the outfit had, and which of them each garment takes (in the garment's zone order).
 */
const L2_OUTFITS: readonly { top: TopId; bottom: BottomId | typeof NO_BOTTOM; zones: number; topZones: number[]; bottomZones: number[] }[] = [
  { top: 'suit_jacket', bottom: 'suit_trousers', zones: 3, topZones: [0, 1, 2], bottomZones: [1] }, // tie, suit, shirt
  { top: 'overalls', bottom: NO_BOTTOM, zones: 2, topZones: [0, 1], bottomZones: [] }, // overalls, tee
  { top: 'field_jacket', bottom: 'field_jeans', zones: 3, topZones: [0, 2], bottomZones: [1] }, // stripes, jeans, jacket
  { top: 'long_tee', bottom: 'washed_jeans', zones: 3, topZones: [0, 2], bottomZones: [1] }, // trim, jeans, tee
  { top: 'pinstripe_shirt', bottom: 'dark_jeans', zones: 3, topZones: [0, 2], bottomZones: [1] }, // stripes, jeans, shirt
  { top: 'trim_tee', bottom: 'grey_jeans', zones: 3, topZones: [0, 2], bottomZones: [1] }, // trim, jeans, tee
  { top: 'plain_tee', bottom: 'blue_jeans', zones: 2, topZones: [1], bottomZones: [0] }, // jeans, tee
  { top: 'denim_suit', bottom: NO_BOTTOM, zones: 2, topZones: [0, 1], bottomZones: [] }, // patches, clothes
  { top: 'fitted_tee', bottom: 'slim_jeans', zones: 3, topZones: [0, 2], bottomZones: [1] }, // trim, jeans, top
  { top: 'cap_tee', bottom: 'shorts', zones: 3, topZones: [0, 2], bottomZones: [1] }, // trim, shorts, top
  { top: 'blouse', bottom: 'skirt', zones: 3, topZones: [0, 1], bottomZones: [2] }, // stripes, shirt, skirt
  { top: 'crop_top', bottom: 'leggings', zones: 4, topZones: [0, 3], bottomZones: [1, 2] }, // trim, stripe, leggings, top
];

export const DEFAULT_LOOK: Look = {
  base: 'm_avg',
  skin: 'young_caucasian_male',
  eyes: 'grey',
  brows: 'eyebrow007',
  hair: 'short02',
  hairColor: 0x745d51,
  top: 'suit_jacket',
  topColors: topColors('suit_jacket'),
  bottom: 'suit_trousers',
  bottomColors: bottomColors('suit_trousers'),
  shoes: 'shoes03',
  shoeColor: 0x836759,
  kit: ['goggles_up', 'collar'],
  metal: 'brass',
  leather: 'leather',
  glow: 0xffae3c,
  wheel: 'wood',
  gear: [],
};

/** Why a look can't be worn, or null. */
export function lookProblem(l: Look): string | null {
  if (!(l.base in BASES)) return 'base';
  if (!(SKINS[BASES[l.base]] as readonly string[]).includes(l.skin)) return 'skin';
  if (!EYES.includes(l.eyes)) return 'eyes';
  if (!BROWS.includes(l.brows)) return 'brows';
  if (!HAIRS.includes(l.hair)) return 'hair';
  if (!(l.top in TOPS)) return 'top';
  if (l.topColors.length !== TOPS[l.top].zones.length) return 'top colours';
  if (isFull(l.top) ? l.bottom !== NO_BOTTOM : !(l.bottom in BOTTOMS)) return 'bottom';
  if (l.bottomColors.length !== (l.bottom === NO_BOTTOM ? 0 : BOTTOMS[l.bottom].zones.length)) return 'bottom colours';
  if (!SHOES.includes(l.shoes)) return 'shoes';
  if (l.kit.length > KIT_MAX) return 'too much kit';
  const slots = new Set<string>();
  for (const k of l.kit) {
    if (!(k in KIT)) return 'kit';
    if (slots.has(KIT[k])) return 'two kit pieces in one slot';
    slots.add(KIT[k]);
  }
  if (!METALS.includes(l.metal)) return 'metal';
  if (!LEATHERS.includes(l.leather)) return 'leather';
  if (!WHEELS.includes(l.wheel)) return 'wheel';
  if (l.gear.length > GEAR.length || new Set(l.gear).size !== l.gear.length || l.gear.some((x) => !GEAR.includes(x))) return 'gear';
  for (const c of [l.hairColor, l.shoeColor, l.glow, ...l.topColors, ...l.bottomColors]) if (!Number.isInteger(c) || c < 0 || c > 0xffffff) return 'colour';
  return null;
}

/** Another body; across frames the skin keeps its tone and age. */
export function withBase(l: Look, base: BaseId): Look {
  const from = SKINS[BASES[l.base]] as readonly SkinId[];
  const to = SKINS[BASES[base]] as readonly SkinId[];
  return { ...l, base, skin: to[Math.max(0, from.indexOf(l.skin))] };
}

/**
 * Puts on another top in its own colours (zones differ in meaning: a tie's gold makes a poor tee); the bottom stays.
 * A one-piece takes the bottom's place too, and taking one off for a top puts the spare bottom on.
 */
export function withTop(l: Look, top: TopId): Look {
  if (top === l.top) return l;
  const bottom = isFull(top) ? NO_BOTTOM : l.bottom === NO_BOTTOM ? SPARE_BOTTOM : l.bottom;
  return { ...l, top, topColors: topColors(top), bottom, bottomColors: bottom === l.bottom ? l.bottomColors : bottomColors(bottom) };
}

/** Puts on another bottom in its own colours; the top stays, unless it was a one-piece (then the spare top goes on). */
export function withBottom(l: Look, bottom: BottomId): Look {
  if (bottom === l.bottom) return l;
  const top = isFull(l.top) ? SPARE_TOP : l.top;
  return { ...l, top, topColors: top === l.top ? l.topColors : topColors(top), bottom, bottomColors: bottomColors(bottom) };
}

/** Adds a kit piece, taking off whatever held its slot (and the oldest piece if over the limit). */
export function withKit(l: Look, k: KitId, on: boolean): Look {
  let kit = l.kit.filter((x) => x !== k && (!on || KIT[x] !== KIT[k]));
  if (on) kit = [...kit, k].slice(-KIT_MAX);
  return { ...l, kit };
}

const hex = (c: number) => c.toString(16).padStart(6, '0');
const idx = <T>(list: readonly T[], v: T) => list.indexOf(v).toString(36);

export function encodeLook(l: Look): LookCode {
  return [
    'L3',
    idx(BASE_IDS, l.base),
    idx(ALL_SKINS, l.skin),
    idx(EYES, l.eyes),
    idx(BROWS, l.brows),
    idx(HAIRS, l.hair),
    hex(l.hairColor),
    idx(TOP_IDS, l.top),
    l.topColors.map(hex).join('-'),
    idx(BOTTOM_WIRE, l.bottom),
    l.bottomColors.map(hex).join('-'),
    idx(SHOES, l.shoes),
    hex(l.shoeColor),
    l.kit.map((k) => idx(KIT_IDS, k)).join('-'),
    idx(METALS, l.metal),
    idx(LEATHERS, l.leather),
    hex(l.glow),
    idx(WHEELS, l.wheel),
    // A last field only when there's gear (as in `L2.` codes), so a look without any has one spelling.
    ...(l.gear.length ? [l.gear.map((x) => idx(GEAR, x)).join('-')] : []),
  ].join('.') as LookCode;
}

/** A look from its code (`L3.`, or an `L2.` from before separates), or null if the code is junk or the look can't be worn. */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== 'string' || code.length > 200) return null;
  const old = code.startsWith('L2.');
  if (!old && !code.startsWith('L3.')) return null;
  const f = code.split('.');
  // `L2.`: 16 fields, `L3.`: 18 (the outfit and its colours became top, bottom and theirs); one more with battle pass
  // gear (never an empty one: a code has one spelling).
  const n = old ? 16 : 18;
  if (f.length !== n && !(f.length === n + 1 && f[n])) return null;
  const pick = <T>(list: readonly T[], s: string): T | undefined => (/^[0-9a-z]{1,2}$/.test(s) ? list[parseInt(s, 36)] : undefined);
  const col = (s: string) => (/^[0-9a-f]{6}$/.test(s) ? parseInt(s, 16) : NaN);
  const cols = (s: string) => (s === '' ? [] : s.split('-').map(col));
  let clothes: Pick<Look, 'top' | 'topColors' | 'bottom' | 'bottomColors'> | undefined;
  if (old) {
    const o = pick(L2_OUTFITS, f[7]);
    const c = cols(f[8]);
    if (o && c.length === o.zones) clothes = { top: o.top, topColors: o.topZones.map((i) => c[i]), bottom: o.bottom, bottomColors: o.bottomZones.map((i) => c[i]) };
  } else {
    const top = pick(TOP_IDS, f[7]);
    const bottom = pick(BOTTOM_WIRE, f[9]);
    if (top && bottom) clothes = { top, topColors: cols(f[8]), bottom, bottomColors: cols(f[10]) };
  }
  if (!clothes) return null;
  // The fields after the clothes are the same in both versions, two places further on in `L3.`.
  const g = f.slice(old ? 9 : 11);
  const kit = g[2] === '' ? [] : g[2].split('-').map((s) => pick(KIT_IDS, s));
  const gear = g[7] ? g[7].split('-').map((s) => pick(GEAR, s)) : [];
  const l = {
    base: pick(BASE_IDS, f[1]),
    skin: pick(ALL_SKINS, f[2]),
    eyes: pick(EYES, f[3]),
    brows: pick(BROWS, f[4]),
    hair: pick(HAIRS, f[5]),
    hairColor: col(f[6]),
    ...clothes,
    shoes: pick(SHOES, g[0]),
    shoeColor: col(g[1]),
    kit,
    metal: pick(METALS, g[3]),
    leather: pick(LEATHERS, g[4]),
    glow: col(g[5]),
    wheel: pick(WHEELS, g[6]),
    gear,
  };
  if (Object.values(l).some((v) => v === undefined) || kit.some((k) => k === undefined) || gear.some((x) => x === undefined)) return null;
  return lookProblem(l as Look) ? null : (l as Look);
}

/** Soft hair colours (the creator's swatches; `randomLook` picks from them). */
export const HAIR_COLORS = [0x463e42, 0x745d51, 0xa08067, 0xdac4a4, 0xcbcbd1, 0xe8e6ed, 0xb86c7c, 0x8facd5];
/** Shoe leathers and canvas. */
export const SHOE_COLORS = [0x836759, 0x5b5866, 0x746059, 0xc7a789, 0xeee8da, 0x95b2bf];
/** Glow colours: the one bright note on a driver. */
export const GLOW_COLORS = [0xffae3c, 0xff2fd2, 0x3dff8e, 0xff3b30, 0x38c8ff, 0xb46bff, 0xfff04a];

/** A random but tasteful look (rivals, "Surprise me"). `rand` returns [0, 1). */
export function randomLook(rand: () => number = Math.random): Look {
  const any = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const base = any(BASE_IDS);
  const top = any(TOP_IDS);
  const bottom = isFull(top) ? NO_BOTTOM : any(BOTTOM_IDS);
  let l: Look = {
    base,
    skin: any(SKINS[BASES[base]] as readonly SkinId[]),
    eyes: any(EYES),
    brows: any(BROWS),
    hair: any(HAIRS),
    hairColor: any(HAIR_COLORS),
    top,
    topColors: topColors(top),
    bottom,
    bottomColors: bottomColors(bottom),
    shoes: any(SHOES),
    shoeColor: any(SHOE_COLORS),
    kit: [],
    metal: any(FREE_METALS),
    leather: any(LEATHERS),
    glow: any(GLOW_COLORS),
    wheel: any(WHEELS),
    gear: [],
  };
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) l = withKit(l, any(KIT_IDS), true);
  return l;
}
