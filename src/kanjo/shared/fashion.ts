// Fashion: the Shop's luxury clothing for your own driver (Michael, 2026-11-23: "a fashion tab where really expensive
// clothing pieces are sold ... 50k - 1mil ... cool clothing pieces that render well on the body and don't merge with
// the skin weird"). Bought once with garage money (garage.ts `{a: 'fashion'}`, run by the server for accounts), kept
// in `Garage.fash`, worn by a look (`Look.fashion`, one piece per slot). Pure and shared.
//
// The pieces aren't Blender parts: kanjo/client/fashion.ts makes them at assembly, a jacket or trousers as a shell
// over the body's own surface (lifted clear of whatever is under it, the skin beneath dropped), a hat as a dome
// fitted over the head and hair, shades and chains measured off the face and chest. So every piece fits every body.

/** Where a piece is worn: one per slot. A jacket stands in for the look's top, trousers for its bottom. */
export const FASHION_SLOTS = ['jacket', 'pants', 'hat', 'shades', 'chain'] as const;
export type FashionSlot = (typeof FASHION_SLOTS)[number];

/** How a piece is drawn (kanjo/client/fashion.ts builds and paints each kind). */
export type FashionKind =
  | 'varsity'
  | 'puffer'
  | 'leather'
  | 'monogram'
  | 'chrome'
  | 'fur'
  | 'track'
  | 'cargo'
  | 'moto'
  | 'camo'
  | 'beanie'
  | 'bucket'
  | 'cap'
  | 'shield'
  | 'round'
  | 'cuban'
  | 'pendant';

export interface FashionItem {
  slot: FashionSlot;
  kind: FashionKind;
  name: string;
  /** The label it's from (ours, made up). */
  house: string;
  /** One line for its card. */
  line: string;
  /** Garage money. */
  price: number;
  /** Its colours: main, accent, detail. Dusty like the drivers' clothes, the metals and lenses brighter. */
  colors: readonly [number, number, number];
}

/** The catalogue. Wire order (a look code stores the index): APPEND ONLY. */
export const FASHION = {
  varsity: { slot: 'jacket', kind: 'varsity', name: 'Shibuya Varsity', house: 'Kanjo Athletic', line: 'Boiled wool, leather sleeves, striped rib', price: 95_000, colors: [0x4d5878, 0xeee8da, 0xe6918f] },
  kumo_puffer: { slot: 'jacket', kind: 'puffer', name: 'Kumo Puffer', house: 'Hakuba Down', line: 'Oversized down channels, glossy shell', price: 180_000, colors: [0xe8e4ee, 0xbfb8cf, 0x9397be] },
  apex_leather: { slot: 'jacket', kind: 'leather', name: 'Apex Racing Leather', house: 'Paddock Club', line: 'Hand-stitched calf leather, race stripes', price: 260_000, colors: [0x3b3a44, 0xff5a4e, 0xd6d8de] },
  maison_bomber: { slot: 'jacket', kind: 'monogram', name: 'Maison Monogram Bomber', house: 'Maison Tōge', line: 'Silk twill, all-over gold monogram', price: 480_000, colors: [0x5a3b52, 0xe4c383, 0x3a2737] },
  chrome_bomber: { slot: 'jacket', kind: 'chrome', name: 'Liquid Chrome Bomber', house: 'Atelier Mirage', line: 'Mirror-finish shell with an oil-slick sheen', price: 720_000, colors: [0xc9ced8, 0x2e3140, 0x9aa3b8] },
  emperor_fur: { slot: 'jacket', kind: 'fur', name: 'Emperor Fur Coat', house: 'Maison Tōge', line: 'Faux sable, shawl collar, one of one', price: 1_000_000, colors: [0x8a6a58, 0xb8957c, 0x5e463a] },
  paddock_track: { slot: 'pants', kind: 'track', name: 'Paddock Track Pants', house: 'Kanjo Athletic', line: 'Tricot with twin side stripes', price: 60_000, colors: [0x464b5e, 0xeee8da, 0xeee8da] },
  shinobi_camo: { slot: 'pants', kind: 'camo', name: 'Shinobi Camo Joggers', house: 'Night Market', line: 'Brushed fleece in dusk camo', price: 75_000, colors: [0x6e7a6a, 0x9aa08a, 0x4b5249] },
  tech_cargo: { slot: 'pants', kind: 'cargo', name: 'Techwear Cargos', house: 'Grid Division', line: 'Ripstop, bellowed thigh pockets', price: 140_000, colors: [0x585c66, 0x777c88, 0x38c9ff] },
  moto_leather: { slot: 'pants', kind: 'moto', name: 'Moto Leather Trousers', house: 'Paddock Club', line: 'Waxed leather, quilted knees', price: 230_000, colors: [0x3e3b42, 0x5a5560, 0xe0c68c] },
  rib_beanie: { slot: 'hat', kind: 'beanie', name: 'Cashmere Rib Beanie', house: 'Hakuba Down', line: 'Fine cashmere, turned-up cuff', price: 50_000, colors: [0xe6918f, 0xd77e7c, 0xeee8da] },
  pit_cap: { slot: 'hat', kind: 'cap', name: 'Pit Lane Cap', house: 'Paddock Club', line: 'Six panels, curved peak, gold eyelets', price: 85_000, colors: [0x2f3446, 0xff5a4e, 0xe0c68c] },
  maison_bucket: { slot: 'hat', kind: 'bucket', name: 'Maison Bucket Hat', house: 'Maison Tōge', line: 'Monogram jacquard, soft brim', price: 150_000, colors: [0xc7b08a, 0x7a5a3c, 0xa58d6a] },
  shield_shades: { slot: 'shades', kind: 'shield', name: 'Mirage Shield Shades', house: 'Atelier Mirage', line: 'One wraparound mirrored lens', price: 120_000, colors: [0x2b2f3d, 0xb46bff, 0x38c8ff] },
  gold_rounds: { slot: 'shades', kind: 'round', name: 'Round Gold Frames', house: 'Maison Tōge', line: 'Solid gold wire, smoke lenses', price: 300_000, colors: [0xffd76a, 0x3a3240, 0xffd76a] },
  cuban_link: { slot: 'chain', kind: 'cuban', name: 'Cuban Link', house: 'Ginza Vault', line: '24k gold, heavy links', price: 500_000, colors: [0xffd76a, 0xd9a94e, 0xffd76a] },
  iced_pendant: { slot: 'chain', kind: 'pendant', name: 'Iced Pendant', house: 'Ginza Vault', line: 'White gold rope, a flawless stone', price: 850_000, colors: [0xe7eaf2, 0xbfe9ff, 0xffffff] },
} as const satisfies Record<string, FashionItem>;

export type FashionId = keyof typeof FASHION;
export const FASHION_IDS = Object.keys(FASHION) as FashionId[];
export const isFashionId = (x: unknown): x is FashionId => typeof x === 'string' && Object.hasOwn(FASHION, x);
export const fashionItem = (id: FashionId): FashionItem => FASHION[id];

/** The cheapest and dearest piece: the range Michael asked for. */
export const FASHION_PRICES = { min: 50_000, max: 1_000_000 } as const;

/**
 * Kit slots (look.ts `KIT`) a worn piece covers, so that kit isn't drawn (it was fitted to the clothes underneath and
 * would poke through): a jacket covers the body and arms, a hat the forehead goggles, shades the eye pieces, a chain
 * the collar. The look keeps them; take the piece off and they're back.
 */
export const FASHION_COVERS: Record<FashionSlot, readonly string[]> = {
  jacket: ['chest', 'shoulder', 'arm_l', 'arm_r', 'waist'],
  pants: [],
  hat: ['brow'],
  shades: ['eyes'],
  chain: ['neck'],
};

/** Puts a piece on (taking off whatever held its slot) or takes it off. Wear order is the catalogue's. */
export function wearing(list: readonly FashionId[], id: FashionId, on: boolean): FashionId[] {
  const slot = FASHION[id].slot;
  return FASHION_IDS.filter((x) => (x === id ? on : list.includes(x) && FASHION[x].slot !== slot));
}
