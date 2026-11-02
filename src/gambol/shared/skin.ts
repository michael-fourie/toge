// Skins: the pickable parts of a chibi sniper's look. Pure data + (de)serialisation, so the client
// (avatar, picker) and the server (validation, relaying) share one definition. No three.js, no DOM.

export type HairStyle = 'spiky' | 'twintails' | 'ponytail' | 'bob';
export type Mouth = 'cat' | 'smile' | 'fang';
export type Accessory = 'none' | 'catears' | 'headband' | 'bow';

export const STYLES: readonly HairStyle[] = ['spiky', 'twintails', 'ponytail', 'bob'];
export const MOUTHS: readonly Mouth[] = ['cat', 'smile', 'fang'];
export const ACCESSORIES: readonly Accessory[] = ['none', 'catears', 'headband', 'bow'];
export const HAIR = [0x2b2433, 0x6b4430, 0xf2d27a, 0xf59ac0, 0x7cb8f0, 0xdfe3ec, 0xe0663a, 0x92dbb8, 0xa983e6];
export const SCARF = [0xd9473d, 0xf4ead2, 0xf2c14e, 0x3f8f8a, 0x2f3a5c];
/** Jacket / sleeve / name colours. The server hands them out per lobby, preferring the one you ask for. */
export const JACKETS = [0xe0614f, 0x5f9fd6, 0xe8b84a, 0x76ac5a, 0xa98bd1, 0x8d96a3, 0xf2a35e, 0x4fae9f, 0xe58fa8, 0x4a6fa5, 0xb3a24f, 0xf08a6b];

/** Every field is an index into the lists above (hair, scarf, jacket) or a list member. */
export interface Skin {
  style: HairStyle;
  hair: number;
  mouth: Mouth;
  accessory: Accessory;
  ahoge: boolean;
  scarf: number;
  /** Preferred jacket colour; absent = let the server pick. */
  jacket?: number;
}

export interface Preset {
  name: string;
  skin: Skin;
}

const P = (name: string, style: HairStyle, hair: number, mouth: Mouth, accessory: Accessory, ahoge: boolean, scarf: number): Preset => ({
  name,
  skin: { style, hair, mouth, accessory, ahoge, scarf },
});

export const PRESETS: readonly Preset[] = [
  P('Kiki', 'bob', 0, 'smile', 'bow', false, 0),
  P('Sootling', 'spiky', 0, 'fang', 'none', true, 1),
  P('Peach', 'twintails', 3, 'cat', 'bow', false, 2),
  P('Mochi', 'ponytail', 5, 'smile', 'headband', true, 3),
  P('Neko', 'bob', 8, 'cat', 'catears', true, 4),
  P('Sunny', 'spiky', 6, 'fang', 'headband', false, 2),
  P('Mint', 'twintails', 7, 'smile', 'catears', false, 1),
  P('Cloud', 'ponytail', 4, 'cat', 'none', true, 0),
];

// ---------------------------------------------------------------------------
// Default: seeded from name + colour, exactly as looks were chosen before skins existed.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 'none' twice: half of everyone gets a bare head, as before.
const SEEDED_ACCESSORIES: readonly Accessory[] = ['none', 'none', 'catears', 'headband', 'bow'];

export function seededSkin(color: number, name = ''): Skin {
  let h = 2166136261 ^ color;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const r = rng(h);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const hair = Math.floor(r() * HAIR.length);
  const mouth = pick(MOUTHS);
  const style = pick(STYLES);
  const accessory = pick(SEEDED_ACCESSORIES);
  const ahoge = style !== 'twintails' && r() < 0.65;
  const scarf = Math.floor(r() * SCARF.length);
  return { style, hair, mouth, accessory, ahoge, scarf };
}

export function randomSkin(random: () => number = Math.random): Skin {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
  return {
    style: pick(STYLES),
    hair: Math.floor(random() * HAIR.length),
    mouth: pick(MOUTHS),
    accessory: pick(ACCESSORIES),
    ahoge: random() < 0.5,
    scarf: Math.floor(random() * SCARF.length),
  };
}

// ---------------------------------------------------------------------------
// Wire / storage format: "style.hair.mouth.accessory.ahoge.scarf.jacket", all small integers,
// jacket "x" for none. e.g. "3.0.1.3.0.0.x". Anything else is rejected.

const MAX_CODE = 24;

export function encodeSkin(s: Skin): string {
  return [STYLES.indexOf(s.style), s.hair, MOUTHS.indexOf(s.mouth), ACCESSORIES.indexOf(s.accessory), s.ahoge ? 1 : 0, s.scarf, s.jacket ?? 'x'].join('.');
}

const inRange = (n: number, len: number) => Number.isInteger(n) && n >= 0 && n < len;

/** Parses a skin code; null if it isn't a well-formed one (so callers fall back to the seeded default). */
export function decodeSkin(code: unknown): Skin | null {
  if (typeof code !== 'string' || code.length > MAX_CODE) return null;
  const parts = code.split('.');
  if (parts.length !== 7 || !parts.every((p) => /^(\d{1,2}|x)$/.test(p))) return null;
  const [st, hr, mo, ac, ah, sc, ja] = parts;
  const style = STYLES[Number(st)];
  const mouth = MOUTHS[Number(mo)];
  const accessory = ACCESSORIES[Number(ac)];
  const jacket = ja === 'x' ? undefined : Number(ja);
  if (!style || !mouth || !accessory || !inRange(Number(hr), HAIR.length) || !inRange(Number(sc), SCARF.length)) return null;
  if (ah !== '0' && ah !== '1') return null;
  if (jacket !== undefined && !inRange(jacket, JACKETS.length)) return null;
  const skin: Skin = { style, hair: Number(hr), mouth, accessory, ahoge: ah === '1', scarf: Number(sc) };
  if (jacket !== undefined) skin.jacket = jacket;
  return skin;
}

export const sameSkin = (a: Skin, b: Skin) => encodeSkin(a) === encodeSkin(b);
