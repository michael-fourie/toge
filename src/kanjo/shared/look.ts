// A driver of your own: what the creator picks, as data both sides share. The parts are built by
// tools/drivers/wardrobe.py (docs/DRIVER_CREATOR.md); this catalogue mirrors its manifest so the server
// can check a look without loading files (tests/look.test.ts keeps the two in step).
//
// On the wire a look is a short code, `L2.` + dot-separated fields (catalogue indices in base 36,
// colours as 6 hex digits), carried in `driver=` where a legend's id would be.

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
 * Outfits: their colour zones (the manifest's `zones`, in order) and the colours they come in: the drivers' soft
 * palette (pastel-leaning, mid-light, never near black; tools/drivers/cast.py).
 */
export const OUTFITS = {
  male_elegantsuit01: { zones: ['tie', 'suit', 'shirt'], colors: [0xf0c26a, 0x6fa08c, 0xfbf2de] },
  male_worksuit01: { zones: ['overalls', 'tee'], colors: [0xd08a62, 0x7d8aa3] },
  male_casualsuit05: { zones: ['stripes', 'jeans', 'jacket'], colors: [0xf27d7a, 0x8e97b5, 0x565f85] },
  male_casualsuit02: { zones: ['trim', 'jeans', 'tee'], colors: [0xffc46b, 0x6f84a8, 0x8fb7c9] },
  male_casualsuit03: { zones: ['stripes', 'jeans', 'shirt'], colors: [0xe6c79a, 0x7c86a3, 0x5f6488] },
  male_casualsuit04: { zones: ['trim', 'jeans', 'tee'], colors: [0x7df0b0, 0x737c94, 0x585c78] },
  male_casualsuit06: { zones: ['jeans', 'tee'], colors: [0x7f95c2, 0xfbf2de] },
  male_casualsuit01: { zones: ['patches', 'clothes'], colors: [0xd9a274, 0x8a93a6] },
  female_casualsuit01: { zones: ['trim', 'jeans', 'top'], colors: [0xff8fe3, 0x6f84a8, 0x6a6f9e] },
  female_casualsuit02: { zones: ['trim', 'shorts', 'top'], colors: [0xffc46b, 0x8fb7c9, 0xfbf2de] },
  female_elegantsuit01: { zones: ['stripes', 'shirt', 'skirt'], colors: [0xf0c26a, 0x5f6488, 0x6fa08c] },
  female_sportsuit01: { zones: ['trim', 'stripe', 'leggings', 'top'], colors: [0xff8fe3, 0xff8fe3, 0x6a6f9e, 0x8d92c8] },
} as const satisfies Record<string, { zones: readonly string[]; colors: readonly number[] }>;
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
const KIT_MAX = 5;

export type BaseId = keyof typeof BASES;
type Frame = (typeof BASES)[BaseId];
export type SkinId = (typeof SKINS)[Frame][number];
type EyeId = (typeof EYES)[number];
type HairId = (typeof HAIRS)[number];
type BrowId = (typeof BROWS)[number];
export type OutfitId = keyof typeof OUTFITS;
type ShoeId = (typeof SHOES)[number];
export type KitId = keyof typeof KIT;
export type MetalId = (typeof METALS)[number];
export type LeatherId = (typeof LEATHERS)[number];
type WheelId = (typeof WHEELS)[number];
export type GearId = (typeof GEAR)[number];

/** A look on the wire. */
export type LookCode = `L2.${string}`;

export interface Look {
  base: BaseId;
  /** One of the base's frame's skins. */
  skin: SkinId;
  eyes: EyeId;
  brows: BrowId;
  hair: HairId;
  /** Hair and brows. */
  hairColor: number;
  outfit: OutfitId;
  /** One colour per zone of the outfit. */
  colors: number[];
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
const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[];
const KIT_IDS = Object.keys(KIT) as KitId[];

const outfitColors = (o: OutfitId) => [...OUTFITS[o].colors] as number[];

export const DEFAULT_LOOK: Look = {
  base: 'm_avg',
  skin: 'young_caucasian_male',
  eyes: 'grey',
  brows: 'eyebrow007',
  hair: 'short02',
  hairColor: 0x7a5a4a,
  outfit: 'male_elegantsuit01',
  colors: outfitColors('male_elegantsuit01'),
  shoes: 'shoes03',
  shoeColor: 0x8a6350,
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
  if (!(l.outfit in OUTFITS)) return 'outfit';
  if (l.colors.length !== OUTFITS[l.outfit].zones.length) return 'colors';
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
  for (const c of [l.hairColor, l.shoeColor, l.glow, ...l.colors]) if (!Number.isInteger(c) || c < 0 || c > 0xffffff) return 'colour';
  return null;
}

/** Another body; across frames the skin keeps its tone and age. */
export function withBase(l: Look, base: BaseId): Look {
  const from = SKINS[BASES[l.base]] as readonly SkinId[];
  const to = SKINS[BASES[base]] as readonly SkinId[];
  return { ...l, base, skin: to[Math.max(0, from.indexOf(l.skin))] };
}

/** Puts on another outfit in its own colours (zones differ in meaning: a tie's gold makes poor jeans). */
export function withOutfit(l: Look, outfit: OutfitId): Look {
  return outfit === l.outfit ? l : { ...l, outfit, colors: outfitColors(outfit) };
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
    'L2',
    idx(BASE_IDS, l.base),
    idx(ALL_SKINS, l.skin),
    idx(EYES, l.eyes),
    idx(BROWS, l.brows),
    idx(HAIRS, l.hair),
    hex(l.hairColor),
    idx(OUTFIT_IDS, l.outfit),
    l.colors.map(hex).join('-'),
    idx(SHOES, l.shoes),
    hex(l.shoeColor),
    l.kit.map((k) => idx(KIT_IDS, k)).join('-'),
    idx(METALS, l.metal),
    idx(LEATHERS, l.leather),
    hex(l.glow),
    idx(WHEELS, l.wheel),
    // A 17th field only when there's gear, so every look from before the pass keeps its code.
    ...(l.gear.length ? [l.gear.map((x) => idx(GEAR, x)).join('-')] : []),
  ].join('.') as LookCode;
}

/** A look from its code, or null if the code is junk (or an old version) or the look can't be worn. */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== 'string' || !code.startsWith('L2.') || code.length > 200) return null;
  const f = code.split('.');
  // 16 fields, or 17 with battle pass gear (never an empty 17th: a code has one spelling).
  if (f.length !== 16 && !(f.length === 17 && f[16])) return null;
  const pick = <T>(list: readonly T[], s: string): T | undefined => (/^[0-9a-z]{1,2}$/.test(s) ? list[parseInt(s, 36)] : undefined);
  const col = (s: string) => (/^[0-9a-f]{6}$/.test(s) ? parseInt(s, 16) : NaN);
  const kit = f[11] === '' ? [] : f[11].split('-').map((s) => pick(KIT_IDS, s));
  const gear = f[16] ? f[16].split('-').map((s) => pick(GEAR, s)) : [];
  const l = {
    base: pick(BASE_IDS, f[1]),
    skin: pick(ALL_SKINS, f[2]),
    eyes: pick(EYES, f[3]),
    brows: pick(BROWS, f[4]),
    hair: pick(HAIRS, f[5]),
    hairColor: col(f[6]),
    outfit: pick(OUTFIT_IDS, f[7]),
    colors: f[8].split('-').map(col),
    shoes: pick(SHOES, f[9]),
    shoeColor: col(f[10]),
    kit,
    metal: pick(METALS, f[12]),
    leather: pick(LEATHERS, f[13]),
    glow: col(f[14]),
    wheel: pick(WHEELS, f[15]),
    gear,
  };
  if (Object.values(l).some((v) => v === undefined) || kit.some((k) => k === undefined) || gear.some((x) => x === undefined)) return null;
  return lookProblem(l as Look) ? null : (l as Look);
}

/** A random but tasteful look (rivals, "Surprise me"). `rand` returns [0, 1). */
export function randomLook(rand: () => number = Math.random): Look {
  const any = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const base = any(BASE_IDS);
  const outfit = any(OUTFIT_IDS);
  const hairColors = [0x4a3f44, 0x7a5a4a, 0xa87c5a, 0xd4d3dc, 0xf3effa, 0xc2586e, 0xe6c79a];
  const glows = [0xffae3c, 0xff2fd2, 0x3dff8e, 0xff3b30, 0x38c8ff, 0xb46bff, 0xfff04a];
  let l: Look = {
    base,
    skin: any(SKINS[BASES[base]] as readonly SkinId[]),
    eyes: any(EYES),
    brows: any(BROWS),
    hair: any(HAIRS),
    hairColor: any(hairColors),
    outfit,
    colors: outfitColors(outfit),
    shoes: any(SHOES),
    shoeColor: any([0x7a5f55, 0x5c586b, 0x8a6350, 0xfbf2de]),
    kit: [],
    metal: any(FREE_METALS),
    leather: any(LEATHERS),
    glow: any(glows),
    wheel: any(WHEELS),
    gear: [],
  };
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) l = withKit(l, any(KIT_IDS), true);
  return l;
}
