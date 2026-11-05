// The driver creator: the Driver tab's "Your own" editor (docs/DRIVER_CREATOR.md). Pure markup plus one
// change handler; hub.ts owns the look, saves it and shows it in the showroom.

import {
  BASES,
  type BaseId,
  BROWS,
  EYES,
  HAIRS,
  KIT,
  type KitId,
  LEATHERS,
  type Look,
  METALS,
  OUTFITS,
  type OutfitId,
  randomLook,
  SKINS,
  type SkinId,
  WHEELS,
  withBase,
  withKit,
  withOutfit,
} from '../shared/look.ts';
import { esc } from '../../client/menu/ui.ts';

const FRAMES = { m: 'Masculine', f: 'Feminine' } as const;
const BUILDS = { slim: 'Slim', avg: 'Average', heavy: 'Heavy' } as const;
/** Tone and age of each skin, by its place in the frame's list (both frames share the order). */
const SKIN_LOOK: [tone: string, age: string][] = [
  ['#e8c3a4', '20s'],
  ['#f3d6c0', '20s'],
  ['#6b4430', '20s'],
  ['#dcb48e', '20s'],
  ['#dcb294', '40s'],
  ['#5c3a28', '40s'],
  ['#cfa682', '40s'],
  ['#d8b29c', '70s'],
  ['#5a3b2c', '70s'],
  ['#c9a284', '70s'],
];
const EYE: Record<(typeof EYES)[number], string> = {
  brown: '#5a3a22',
  brownlight: '#8a5a30',
  blue: '#3a6ea8',
  bluegreen: '#3f8a86',
  deepblue: '#24407a',
  lightblue: '#8ab4dc',
  green: '#4f7a3a',
  grey: '#8a949c',
  ice: '#a9d8ea',
};
const HAIR: Record<(typeof HAIRS)[number], string> = {
  none: 'Bald',
  short01: 'Short',
  short02: 'Swept',
  short03: 'Fringe',
  short04: 'Crop',
  bob01: 'Blunt bob',
  bob02: 'Bob',
  ponytail01: 'Ponytail',
  braid01: 'Braid',
  long01: 'Long',
  afro01: 'Curls',
};
const OUTFIT: Record<OutfitId, string> = {
  male_elegantsuit01: 'Three-piece',
  male_worksuit01: 'Overalls',
  male_casualsuit05: 'Field jacket',
  male_casualsuit02: 'Tee & jeans',
  male_casualsuit03: 'Pinstripe shirt',
  male_casualsuit04: 'Trimmed tee',
  male_casualsuit06: 'White tee',
  male_casualsuit01: 'Denim',
  female_casualsuit01: 'Fitted tee',
  female_casualsuit02: 'Tee & shorts',
  female_elegantsuit01: 'Shirt & skirt',
  female_sportsuit01: 'Racing suit',
};
const KIT_NAME: Record<KitId, string> = {
  goggles_up: 'Goggles up',
  goggles: 'Goggles on',
  monocle: 'Monocle',
  respirator: 'Respirator',
  implants: 'Implants',
  collar: 'Collar',
  bracer_l: 'Left bracer',
  bracer_r: 'Gauge bracer',
  mech_arm_l: 'Left mech arm',
  mech_arm_r: 'Right mech arm',
  pauldron_l: 'Pauldron',
  gloves: 'Gloves',
  gloves_fingerless: 'Fingerless gloves',
  belt: 'Belt',
  chest_strap: 'Harness',
};
const METAL: Record<(typeof METALS)[number], [string, string]> = {
  brass: ['Brass', '#c8963e'],
  copper: ['Copper', '#b8643a'],
  gunmetal: ['Gunmetal', '#3a3e45'],
  chrome: ['Chrome', '#e8ecf0'],
  steel: ['Steel', '#9aa0a8'],
  carbon: ['Carbon', '#1c1d21'],
};
const LEATHER: Record<(typeof LEATHERS)[number], [string, string]> = { leather: ['Brown', '#3b2316'], leather_black: ['Black', '#151313'], leather_tan: ['Tan', '#7a4a28'] };
const WHEEL: Record<(typeof WHEELS)[number], string> = { wood: 'Wood rim', yoke: 'Yoke', iron: 'Riveted iron', deep: 'Deep dish' };

/** House palettes; the last swatch of each row is a free colour picker. */
const CLOTH = [0x1f3a2c, 0x25252a, 0x17130f, 0x2f4a5c, 0x5a3420, 0x6e0d16, 0xb3121e, 0xb8862b, 0xe9dcc0, 0xd8d2c4, 0x2b2b2e, 0x4b2e5c];
const HAIR_COLORS = [0x141110, 0x3a2a20, 0x6b4a2b, 0xc9a26b, 0x8d8a85, 0xe6e9f2, 0x6e0d16, 0x2f6fb0];
const GLOWS = [0xffae3c, 0xff2fd2, 0x3dff8e, 0xff3b30, 0x38c8ff, 0xb46bff, 0xfff04a];
const SHOE_COLORS = [0x2a1a10, 0x121010, 0x5a3420, 0x7a4a28, 0xe9dcc0, 0x2f4a5c];

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const frameOf = (b: BaseId) => BASES[b];
const buildOf = (b: BaseId) => b.split('_')[1] as keyof typeof BUILDS;

/** What a control changes: a field of the look, an outfit zone ('zone:i'), or a kit piece. */
type Field = 'frame' | 'build' | 'skin' | 'eyes' | 'brows' | 'hair' | 'hairColor' | 'outfit' | 'shoes' | 'shoeColor' | 'kit' | 'metal' | 'leather' | 'glow' | 'wheel' | `zone:${number}`;

const pill = (f: Field, v: string, label: string, on: boolean, extra = '') =>
  `<button class="tg-pill" data-dl="${f}" data-v="${v}" aria-pressed="${on}" ${extra}>${label}</button>`;

/** A row of colour swatches plus a free picker. */
function colours(f: Field, list: number[], value: number) {
  const known = list.includes(value);
  return `<div class="tg-swatches">${list
    .map((c) => `<button class="tg-sw" data-dl="${f}" data-v="${c}" aria-pressed="${c === value}" aria-label="${hex(c)}" style="--sw:${hex(c)}"></button>`)
    .join('')}<label class="tg-sw tg-sw-pick" aria-pressed="${!known}" title="Any colour" style="--sw:${hex(value)}"><input type="color" data-dl="${f}" data-pick value="${hex(value)}" aria-label="Any colour" /></label></div>`;
}

export function creatorHtml(l: Look): string {
  const frame = frameOf(l.base);
  const skins = SKINS[frame] as readonly SkinId[];
  return `
    <div class="tg-creator">
      <div class="tg-row"><button class="tg-go small alt" data-dl-random>Surprise me</button></div>
      <h3 class="tg-h">Body</h3>
      <div class="tg-row"><span class="tg-label">Frame</span>${Object.entries(FRAMES).map(([f, name]) => pill('frame', f, name, frame === f)).join('')}</div>
      <div class="tg-row"><span class="tg-label">Build</span>${Object.entries(BUILDS).map(([b, name]) => pill('build', b, name, buildOf(l.base) === b)).join('')}</div>
      <h3 class="tg-h">Face</h3>
      <div class="tg-row"><span class="tg-label">Skin</span>${skins.map((s, i) => pill('skin', s, `<i class="tg-dot" style="--sw:${SKIN_LOOK[i][0]}"></i>${SKIN_LOOK[i][1]}`, l.skin === s)).join('')}</div>
      <div class="tg-row"><span class="tg-label">Eyes</span>${EYES.map((e) => pill('eyes', e, `<i class="tg-dot" style="--sw:${EYE[e]}"></i>`, l.eyes === e, `aria-label="${e} eyes"`)).join('')}</div>
      <div class="tg-row"><span class="tg-label">Brows</span>${BROWS.map((b, i) => pill('brows', b, String(i + 1), l.brows === b)).join('')}</div>
      <h3 class="tg-h">Hair <small>colours the brows too</small></h3>
      <div class="tg-row">${HAIRS.map((h) => pill('hair', h, HAIR[h], l.hair === h)).join('')}</div>
      ${colours('hairColor', HAIR_COLORS, l.hairColor)}
      <h3 class="tg-h">Outfit</h3>
      <div class="tg-row">${(Object.keys(OUTFITS) as OutfitId[]).map((o) => pill('outfit', o, OUTFIT[o], l.outfit === o)).join('')}</div>
      ${OUTFITS[l.outfit].zones.map((z, i) => `<div class="tg-label">${esc(cap(z))}</div>${colours(`zone:${i}`, CLOTH, l.colors[i])}`).join('')}
      <div class="tg-row"><span class="tg-label">Shoes</span>${['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06'].map((s, i) => pill('shoes', s, String(i + 1), l.shoes === s)).join('')}</div>
      ${colours('shoeColor', SHOE_COLORS, l.shoeColor)}
      <h3 class="tg-h">Kit <small>one per spot, up to five</small></h3>
      <div class="tg-row">${(Object.keys(KIT) as KitId[]).map((k) => pill('kit', k, KIT_NAME[k], l.kit.includes(k))).join('')}</div>
      <div class="tg-row"><span class="tg-label">Metal</span>${METALS.map((m) => pill('metal', m, `<i class="tg-dot" style="--sw:${METAL[m][1]}"></i>${METAL[m][0]}`, l.metal === m)).join('')}</div>
      <div class="tg-row"><span class="tg-label">Leather</span>${LEATHERS.map((m) => pill('leather', m, `<i class="tg-dot" style="--sw:${LEATHER[m][1]}"></i>${LEATHER[m][0]}`, l.leather === m)).join('')}</div>
      <div class="tg-label">Glow</div>${colours('glow', GLOWS, l.glow)}
      <h3 class="tg-h">Wheel</h3>
      <div class="tg-row">${WHEELS.map((w) => pill('wheel', w, WHEEL[w], l.wheel === w)).join('')}</div>
    </div>`;
}

/** The look after the control `el` was used, or null if `el` isn't one of ours. */
export function lookAfter(l: Look, el: HTMLElement): Look | null {
  if (el.hasAttribute('data-dl-random')) return randomLook();
  const f = el.dataset.dl as Field | undefined;
  if (!f) return null;
  const raw = el instanceof HTMLInputElement ? el.value : el.dataset.v!;
  const num = raw.startsWith('#') ? parseInt(raw.slice(1), 16) : Number(raw);
  if (f.startsWith('zone:')) {
    const colors = l.colors.slice();
    colors[Number(f.slice(5))] = num;
    return { ...l, colors };
  }
  switch (f) {
    case 'frame':
      return withBase(l, `${raw}_${buildOf(l.base)}` as BaseId);
    case 'build':
      return withBase(l, `${frameOf(l.base)}_${raw}` as BaseId);
    case 'outfit':
      return withOutfit(l, raw as OutfitId);
    case 'kit':
      return withKit(l, raw as KitId, !l.kit.includes(raw as KitId));
    case 'hairColor':
    case 'shoeColor':
    case 'glow':
      return { ...l, [f]: num };
    default:
      return { ...l, [f]: raw };
  }
}
