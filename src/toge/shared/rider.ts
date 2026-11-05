// Your driver: the character who stands next to your car on the home screen and with your crew in a race lobby.
// Tokyo street-drift style (souvenir jackets, long coats, bleached pompadours, shades at night). Free to change,
// any time, like paint. Pure and shared: the garage stores it (garage.ts), the race room relays it as a code.
//
// A rider is one number per field, an index into that field's options. FIELDS IS APPEND ONLY (a new field goes on
// the end, with a default of 0, so old codes still decode) and so is every field's option list.

export interface RiderField {
  key: RiderKey;
  label: string;
  /** Which group of the Driver page it sits in. */
  group: RiderGroup;
  options: readonly string[];
  /** For colour fields: one sRGB colour per option (options are the names). */
  colors?: readonly number[];
  /** Shown only when this other field isn't at index 0 (e.g. the emblem colour needs an emblem). */
  needs?: RiderKey;
}

export type RiderGroup = 'Body' | 'Face' | 'Hair' | 'Top' | 'Bottoms' | 'Gear' | 'Pose';
export const RIDER_GROUPS: readonly RiderGroup[] = ['Body', 'Face', 'Hair', 'Top', 'Bottoms', 'Gear', 'Pose'];

const SKINS = [0xf6d7c0, 0xeec4a2, 0xe0ad84, 0xc98e63, 0xa86e48, 0x84532f, 0x5f3a22, 0x3e261a];
const SKIN_NAMES = ['Porcelain', 'Fair', 'Light', 'Warm', 'Tan', 'Brown', 'Deep', 'Ebony'];
const HAIRS = [0x141210, 0x3a2418, 0x6b4426, 0xb98a4e, 0xe9d7a4, 0xd9dde4, 0xa8202a, 0xe4532a, 0x2a56d8, 0xf06aa8, 0x45d3a8, 0x7a4fd8];
const HAIR_NAMES = ['Jet black', 'Dark brown', 'Chestnut', 'Bleached', 'Platinum', 'Silver', 'Crimson', 'Orange', 'Cobalt', 'Sakura pink', 'Mint', 'Violet'];
/** Clothes: street blacks and greys, night neons, the colours of the old souvenir jackets. */
const CLOTH = [0x15171c, 0x2c3038, 0x6d727c, 0xe8e6e0, 0x1d2a4a, 0x3a5a3a, 0x6a1b1f, 0xd0282c, 0xe06c1c, 0xe8c23a, 0x2bb0e8, 0xe23d8f, 0x7b3fd0, 0xc9a26a, 0x4a3426];
const CLOTH_NAMES = ['Black', 'Charcoal', 'Grey', 'Bone', 'Navy', 'Olive', 'Oxblood', 'Red', 'Orange', 'Gold', 'Cyan', 'Magenta', 'Purple', 'Tan', 'Brown'];

/** Every field, in code order. APPEND ONLY. */
export const RIDER_FIELDS: readonly RiderField[] = [
  { key: 'build', label: 'Build', group: 'Body', options: ['Slim', 'Regular', 'Broad'] },
  { key: 'height', label: 'Height', group: 'Body', options: ['Short', 'Average', 'Tall'] },
  { key: 'skin', label: 'Skin', group: 'Body', options: SKIN_NAMES, colors: SKINS },
  { key: 'eyes', label: 'Eyes', group: 'Face', options: ['Calm', 'Sharp', 'Sleepy', 'Wide'] },
  { key: 'brows', label: 'Brows', group: 'Face', options: ['Soft', 'Straight', 'Angry', 'Slit'] },
  { key: 'facial', label: 'Facial hair', group: 'Face', options: ['None', 'Stubble', 'Goatee', 'Moustache'] },
  { key: 'hair', label: 'Style', group: 'Hair', options: ['Buzz', 'Spiky', 'Undercut', 'Pompadour', 'Wolf cut', 'Ponytail', 'Bob', 'Twin tails', 'Mohawk', 'Slicked back', 'Top knot', 'Long'] },
  { key: 'hairColor', label: 'Colour', group: 'Hair', options: HAIR_NAMES, colors: HAIRS },
  { key: 'top', label: 'Style', group: 'Top', options: ['Tee', 'Hoodie', 'Souvenir jacket', 'Racing jacket', 'Bomber', 'Long coat', 'Coach jacket', 'Coveralls'] },
  { key: 'topColor', label: 'Main colour', group: 'Top', options: CLOTH_NAMES, colors: CLOTH },
  { key: 'accent', label: 'Trim colour', group: 'Top', options: CLOTH_NAMES, colors: CLOTH },
  { key: 'emblem', label: 'Back emblem', group: 'Top', options: ['None', '峠 Pass', '走 Run', '風 Wind', '夜 Night', '雷 Thunder', '龍 Dragon', '鬼 Oni'] },
  { key: 'emblemColor', label: 'Emblem colour', group: 'Top', options: CLOTH_NAMES, colors: CLOTH, needs: 'emblem' },
  { key: 'bottom', label: 'Style', group: 'Bottoms', options: ['Cargo', 'Slim jeans', 'Track pants', 'Wide pants', 'Shorts'] },
  { key: 'bottomColor', label: 'Colour', group: 'Bottoms', options: CLOTH_NAMES, colors: CLOTH },
  { key: 'shoes', label: 'Shoes', group: 'Bottoms', options: ['Sneakers', 'High-tops', 'Boots', 'Driving shoes'] },
  { key: 'shoeColor', label: 'Shoe colour', group: 'Bottoms', options: CLOTH_NAMES, colors: CLOTH },
  { key: 'headwear', label: 'Headwear', group: 'Gear', options: ['None', 'Headband', 'Bandana', 'Cap', 'Cap backwards', 'Beanie', 'Bucket hat'] },
  { key: 'eyewear', label: 'Eyewear', group: 'Gear', options: ['None', 'Shades', 'Visor shades', 'Round glasses', 'Goggles up'] },
  { key: 'mask', label: 'Mask', group: 'Gear', options: ['None', 'Face mask', 'Neck gaiter'] },
  { key: 'neck', label: 'Neck', group: 'Gear', options: ['None', 'Chain', 'Towel', 'Scarf'] },
  { key: 'gloves', label: 'Gloves', group: 'Gear', options: ['None', 'Driving gloves'] },
  { key: 'pose', label: 'Pose', group: 'Pose', options: ['Arms crossed', 'Hands in pockets', 'Hand on hip', 'Peace sign', 'Keys out'] },
];

export type RiderKey =
  | 'build' | 'height' | 'skin' | 'eyes' | 'brows' | 'facial' | 'hair' | 'hairColor' | 'top' | 'topColor' | 'accent' | 'emblem' | 'emblemColor'
  | 'bottom' | 'bottomColor' | 'shoes' | 'shoeColor' | 'headwear' | 'eyewear' | 'mask' | 'neck' | 'gloves' | 'pose';

export type Rider = Record<RiderKey, number>;

export const RIDER_KEYS: readonly RiderKey[] = RIDER_FIELDS.map((f) => f.key);
export const riderField = (k: RiderKey) => RIDER_FIELDS.find((f) => f.key === k)!;
export const riderColor = (r: Rider, k: RiderKey) => riderField(k).colors?.[r[k]] ?? 0xffffff;

/** The driver every new garage starts with: bleached pompadour, black souvenir jacket with a red 峠 on the back. */
export const defaultRider = (): Rider => ({
  build: 1, height: 1, skin: 2, eyes: 1, brows: 1, facial: 0, hair: 3, hairColor: 3, top: 2, topColor: 0, accent: 7, emblem: 1, emblemColor: 7,
  bottom: 0, bottomColor: 1, shoes: 0, shoeColor: 3, headwear: 0, eyewear: 0, mask: 0, neck: 1, gloves: 0, pose: 0,
});

const intIn = (v: unknown, n: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : null);

/** Anything (stored JSON, a request body) to a valid rider; unknown or out-of-range fields take the default. */
export function cleanRider(x: unknown): Rider {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const r = defaultRider();
  for (const f of RIDER_FIELDS) r[f.key] = intIn(o[f.key], f.options.length) ?? r[f.key];
  return r;
}

/** Longest rider code the server accepts. */
export const RIDER_CODE_MAX = 96;

/** `r1.` then each field's index in base 36, one character each (every field has under 36 options). */
export function encodeRider(r: Rider): string {
  return 'r1.' + RIDER_FIELDS.map((f) => r[f.key].toString(36)).join('');
}

export function decodeRider(code: string | null | undefined): Rider | null {
  if (typeof code !== 'string' || code.length > RIDER_CODE_MAX || !code.startsWith('r1.')) return null;
  const digits = code.slice(3);
  // Shorter codes are from before a field was appended: the missing ones take 0.
  if (!/^[0-9a-z]*$/.test(digits) || digits.length > RIDER_FIELDS.length) return null;
  const r = defaultRider();
  for (let i = 0; i < RIDER_FIELDS.length; i++) {
    const f = RIDER_FIELDS[i];
    const v = i < digits.length ? parseInt(digits[i], 36) : 0;
    if (v >= f.options.length) return null;
    r[f.key] = v;
  }
  return r;
}

/** A rider code made safe for the wire: valid codes pass, anything else becomes the default rider. */
export const cleanRiderCode = (code: unknown): string => {
  const r = typeof code === 'string' ? decodeRider(code.slice(0, RIDER_CODE_MAX)) : null;
  return encodeRider(r ?? defaultRider());
};

/** A random driver with some taste: plain clothes stay likelier than neon, and no headwear over a mohawk. */
export function randomRider(rnd: () => number = Math.random): Rider {
  const pick = (n: number) => Math.floor(rnd() * n) % n;
  const r = defaultRider();
  for (const f of RIDER_FIELDS) r[f.key] = pick(f.options.length);
  // Mostly street colours for the big pieces; the trim gets the loud ones.
  const street = [0, 1, 2, 3, 4, 5, 6, 13, 14];
  if (rnd() < 0.7) r.topColor = street[pick(street.length)];
  if (rnd() < 0.8) r.bottomColor = street[pick(street.length)];
  if (rnd() < 0.5) r.facial = 0;
  if (rnd() < 0.55) r.headwear = 0;
  if (rnd() < 0.6) r.mask = 0;
  if (rnd() < 0.6) r.eyewear = 0;
  if (r.hair === 8) r.headwear = 0;
  return r;
}
