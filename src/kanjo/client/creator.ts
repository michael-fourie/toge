// The driver creator: the Driver tab's "Your driver" editor (docs/DRIVER_CREATOR.md). A toolbar (undo, surprise me,
// reset, stand or sit), a row of category tabs, and the open category's choices as tiles and swatches. Pure markup
// plus one change handler; hub.ts owns the look, the open tab and the undo history, saves the look and shows it in
// the showroom (which frames the part of the driver the open tab is about).

import {
  BASES,
  type BaseId,
  BOTTOM_IDS,
  BOTTOMS,
  type BottomId,
  BROWS,
  DEFAULT_LOOK,
  EYES,
  GEAR,
  type GearId,
  GLOW_COLORS,
  HAIR_COLORS,
  HAIRS,
  isFull,
  KIT_MAX,
  type KitId,
  LEATHERS,
  type Look,
  METALS,
  NO_BOTTOM,
  PASS_METALS,
  randomLook,
  SHOE_COLORS,
  SHOES,
  SKINS,
  type SkinId,
  TOP_IDS,
  TOPS,
  type TopId,
  WHEELS,
  withBase,
  withBottom,
  withKit,
  withTop,
} from '../shared/look.ts';
import { esc } from '../../client/menu/ui.ts';
import { GEAR_NAMES, type PassState, PASS_METAL_NAMES, owns, tierFor } from '../shared/pass.ts';

/** The creator's categories, in tab order. */
export const CREATOR_TABS = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'kit', 'wheel'] as const;
export type CreatorTab = (typeof CREATOR_TABS)[number];
const TAB_NAME: Record<CreatorTab, string> = { body: 'Body', face: 'Face', hair: 'Hair', top: 'Top', bottom: 'Bottom', shoes: 'Shoes', kit: 'Kit', wheel: 'Wheel' };
/** What the showroom frames while a tab is open (showroom.ts `frameRider`). */
export const TAB_FRAME: Record<CreatorTab, 'full' | 'head' | 'feet'> = { body: 'full', face: 'head', hair: 'head', top: 'full', bottom: 'full', shoes: 'feet', kit: 'full', wheel: 'full' };

/** What the creator shows besides the look itself. */
export interface CreatorView {
  tab: CreatorTab;
  /** Is there a change to take back? */
  undo: boolean;
  /** The showroom has the driver seated at their wheel (the Wheel tab seats them too). */
  seated: boolean;
}

const FRAMES = { m: 'Masculine', f: 'Feminine' } as const;
const BUILDS = { slim: 'Slim', avg: 'Average', heavy: 'Heavy' } as const;
/** The three ages of skin, by place in the frame's list (both frames share the order), and each skin's tone. */
const AGES: [label: string, skins: number[]][] = [
  ['20s', [0, 1, 3, 2]],
  ['40s', [4, 6, 5]],
  ['70s', [7, 9, 8]],
];
const SKIN_TONE = ['#d2b4a1', '#c9ad9b', '#71594e', '#caae9b', '#ceb3a1', '#775c51', '#d2b7a4', '#dbc1af', '#78584a', '#c5a18a'];
const EYE: Record<(typeof EYES)[number], [name: string, color: string]> = {
  brown: ['Brown', '#a98177'],
  brownlight: ['Hazel', '#b09c7f'],
  blue: ['Blue', '#85a4ad'],
  bluegreen: ['Teal', '#9cb8b0'],
  deepblue: ['Violet', '#9191ab'],
  lightblue: ['Sky', '#95b0b7'],
  green: ['Green', '#91ac8d'],
  grey: ['Grey', '#acb4af'],
  ice: ['Ice', '#a3b6a9'],
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
/** A garment's name and the silhouette on its tile (`ART`). */
const TOP: Record<TopId, [name: string, art: keyof typeof ART]> = {
  suit_jacket: ['Suit jacket', 'jacket'],
  field_jacket: ['Field jacket', 'jacket'],
  long_tee: ['Long tee', 'long'],
  pinstripe_shirt: ['Pinstripe shirt', 'shirt'],
  trim_tee: ['Trimmed tee', 'tee'],
  plain_tee: ['Plain tee', 'tee'],
  fitted_tee: ['Fitted tee', 'tee'],
  cap_tee: ['Cap-sleeve tee', 'tee'],
  blouse: ['Blouse', 'shirt'],
  crop_top: ['Racing crop', 'crop'],
  overalls: ['Overalls', 'overalls'],
  denim_suit: ['Denim suit', 'suit'],
};
const BOTTOM: Record<BottomId, [name: string, art: keyof typeof ART]> = {
  suit_trousers: ['Suit trousers', 'trousers'],
  field_jeans: ['Field jeans', 'trousers'],
  washed_jeans: ['Washed jeans', 'trousers'],
  dark_jeans: ['Dark jeans', 'trousers'],
  grey_jeans: ['Grey jeans', 'trousers'],
  blue_jeans: ['Blue jeans', 'trousers'],
  slim_jeans: ['Slim jeans', 'trousers'],
  shorts: ['Shorts', 'shorts'],
  skirt: ['Skirt', 'skirt'],
  leggings: ['Racing leggings', 'leggings'],
};
const SHOE: Record<(typeof SHOES)[number], string> = { shoes01: 'Trainers', shoes02: 'Low tops', shoes03: 'Boots', shoes04: 'Runners', shoes05: 'Slip-ons', shoes06: 'Plimsolls' };
/** Kit by where it's worn, so the page reads head to hands. */
const KIT_GROUPS: [label: string, pieces: KitId[]][] = [
  ['Head', ['goggles_up', 'goggles', 'monocle', 'respirator', 'implants']],
  ['Neck and body', ['collar', 'pauldron_l', 'chest_strap', 'belt']],
  ['Arms and hands', ['bracer_l', 'bracer_r', 'mech_arm_l', 'mech_arm_r', 'gloves', 'gloves_fingerless']],
];
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
  brass: ['Brass', '#e0c68c'],
  copper: ['Copper', '#daa993'],
  gunmetal: ['Gunmetal', '#737885'],
  chrome: ['Chrome', '#e7eaed'],
  steel: ['Steel', '#bfc3cb'],
  carbon: ['Carbon', '#555764'],
  gold: ['24k Gold', '#ffd76a'],
  obsidian: ['Obsidian', '#3a3350'],
  ember: ['Ember', '#ff7a3a'],
  prism: ['Prism', 'conic-gradient(#ff6ad5, #6ad5ff, #6aff9e, #ffe66a, #ff6ad5)'],
};
const LEATHER: Record<(typeof LEATHERS)[number], [string, string]> = { leather: ['Brown', '#8e7365'], leather_black: ['Dusk', '#54515a'], leather_tan: ['Tan', '#c7a789'] };
const WHEEL: Record<(typeof WHEELS)[number], [name: string, line: string]> = {
  wood: ['Wood rim', 'Brass spokes'],
  yoke: ['Yoke', 'Carbon, light strip'],
  iron: ['Riveted iron', 'Heavy and plain'],
  deep: ['Deep dish', 'Leather, top mark'],
};

/** The house cloth palette, dusty like the drivers (look.ts `TOPS`); the last swatch of each row is a free colour picker. */
const CLOTH = [0x75988a, 0x91ac8d, 0x95b2bf, 0x8898b8, 0x9096ac, 0x5c637e, 0x9397be, 0xa797c6, 0xe8bcc8, 0xe6918f, 0xb86c7c, 0xc69376, 0xe4c383, 0xeee8da, 0xbfc3cb, 0x7f899b, 0x5b5866, 0x463e42];

/**
 * Garment silhouettes for the tiles, on a 48 px square: drawn in the garment's own main colour (`--sw`). Inline
 * shapes rather than renders, so a tile recolours with the swatches and nothing is downloaded.
 */
const ART = {
  tee: 'M17 8 8 12 3 21l6 4 3-4v21h24V21l3 4 6-4-5-9-9-4q-7 5-14 0Z',
  long: 'M17 8 8 12 2 38l6 2 4-15v17h24V25l4 15 6-2-6-26-9-4q-7 5-14 0Z',
  jacket: 'M17 8 8 12 2 38l6 2 4-15v17h11V22L17 8Zm14 0-6 14v20h11V25l4 15 6-2-6-26-9-4Z',
  shirt: 'M18 7 8 12 2 38l6 2 4-15v17h24V25l4 15 6-2-6-26-10-5-6 6-6-6Zm5.2 9h1.6v24h-1.6Z',
  crop: 'M17 8 8 12 3 21l6 4 3-4v8h24v-8l3 4 6-4-5-9-9-4q-7 5-14 0Z',
  overalls: 'M16 5h3v9h10V5h3v13h4l1 26H26l-2-14-2 14H11l1-26h4Z',
  suit: 'M17 4 8 8 3 25l5 2 4-10-1 29h11l2-14 2 14h11l-1-29 4 10 5-2-5-17-9-4q-7 5-14 0Z',
  trousers: 'M12 6h24l3 38H28l-4-25-4 25H9Z',
  leggings: 'M14 6h20l2 38h-6l-6-27-6 27h-6Z',
  shorts: 'M12 12h24l4 20H27l-3-9-3 9H8Z',
  skirt: 'M15 10h18l7 26H8Z',
  shoe: 'M5 34V22q5-1 9 1l8 6q10 1 20 5v4H5Z',
  hair: 'M8 30Q6 8 24 8t16 22q-3-12-10-13-8 4-18 2-3 4-4 11Z',
  wheel: 'M24 5a19 19 0 1 0 0 38 19 19 0 0 0 0-38Zm0 5a14 14 0 0 1 13.6 11H29a5.2 5.2 0 0 0-10 0h-8.600000000000001A14 14 0 0 1 24 10ZM10.2 26H19a5.2 5.2 0 0 0 2.500000000000001 2.6v9.2A14 14 0 0 1 10.2 26Zm16.3 11.8v-9.2A5.2 5.2 0 0 0 29 26h8.8a14 14 0 0 1-11.3 11.8Z',
} as const;

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const frameOf = (b: BaseId) => BASES[b];
const buildOf = (b: BaseId) => b.split('_')[1] as keyof typeof BUILDS;

/** What a control changes: a field of the look, a garment's zone colour ('tz:i' top, 'bz:i' bottom), or a kit piece. */
type Field = 'frame' | 'build' | 'skin' | 'eyes' | 'brows' | 'hair' | 'hairColor' | 'top' | 'bottom' | 'shoes' | 'shoeColor' | 'kit' | 'gear' | 'metal' | 'leather' | 'glow' | 'wheel' | 'recolour' | `tz:${number}` | `bz:${number}`;

const pill = (f: Field, v: string, label: string, on: boolean, extra = '') =>
  `<button class="tg-pill" data-dl="${f}" data-v="${v}" aria-pressed="${on}" ${extra}>${label}</button>`;

/** A choice as a tile: an optional silhouette or swatch, a name and a small line. Picked = cyan frame. */
function tile(f: Field, v: string, on: boolean, name: string, line = '', art = '', extra = '') {
  return `<button class="tg-opt" data-dl="${f}" data-v="${v}" aria-pressed="${on}" ${extra}>${art}<b>${esc(name)}</b>${line ? `<small>${line}</small>` : ''}</button>`;
}
const art = (shape: keyof typeof ART, color: number | string) =>
  `<svg class="tg-opt-art" viewBox="0 0 48 48" aria-hidden="true" style="--sw:${typeof color === 'number' ? hex(color) : color}"><path d="${ART[shape]}"/></svg>`;
const chips = (colors: readonly number[]) => `<span class="tg-opt-chips">${colors.map((c) => `<i style="--sw:${hex(c)}"></i>`).join('')}</span>`;

/** A row of colour swatches plus a free picker. */
function colours(f: Field, list: readonly number[], value: number, label: string) {
  const known = list.includes(value);
  return `<div class="tg-swatches" role="group" aria-label="${esc(label)}">${list
    .map((c) => `<button class="tg-sw" data-dl="${f}" data-v="${c}" aria-pressed="${c === value}" aria-label="${esc(label)} ${hex(c)}" style="--sw:${hex(c)}"></button>`)
    .join('')}<label class="tg-sw tg-sw-pick" aria-pressed="${!known}" title="Any colour" style="--sw:${hex(value)}"><input type="color" data-dl="${f}" data-pick value="${hex(value)}" aria-label="${esc(label)}: any colour" /></label></div>`;
}

/** One colour zone of a garment: its name with the colour it has now, then the swatches. */
const zone = (f: Field, name: string, value: number) =>
  `<div class="tg-zone"><span class="tg-label"><i class="tg-dot" style="--sw:${hex(value)}"></i>${esc(cap(name))}</span>${colours(f, CLOTH, value, cap(name))}</div>`;

/** A swatch with a name under it (skin tones, eyes). */
const named = (f: Field, v: string, on: boolean, name: string, color: string) =>
  `<button class="tg-swname" data-dl="${f}" data-v="${v}" aria-pressed="${on}"><i class="tg-sw" style="--sw:${color}"></i>${esc(name)}</button>`;

/** A battle pass piece: usable once its tier is unlocked; before that a locked pill naming the tier. */
function passPill(p: PassState, f: 'metal' | 'gear', v: string, label: string, on: boolean): string {
  if (owns(p, f, v)) return pill(f, v, label, on, 'data-passitem');
  const tier = tierFor(f, v);
  return `<button class="tg-pill tg-locked" disabled title="Battle pass tier ${tier}">${label}<small>Tier ${tier}</small></button>`;
}

const sameColors = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((c, i) => c === b[i]);

function bodyPage(l: Look) {
  const frame = frameOf(l.base);
  const skins = SKINS[frame] as readonly SkinId[];
  return `
    <h3 class="tg-h">Frame</h3>
    <div class="tg-seg">${Object.entries(FRAMES).map(([f, name]) => pill('frame', f, name, frame === f)).join('')}</div>
    <h3 class="tg-h">Build</h3>
    <div class="tg-seg">${Object.entries(BUILDS).map(([b, name]) => pill('build', b, name, buildOf(l.base) === b)).join('')}</div>
    <h3 class="tg-h">Skin <small>tone and age</small></h3>
    ${AGES.map(([age, list]) => `<div class="tg-zone"><span class="tg-label">${age}</span><div class="tg-swatches">${list.map((i) => `<button class="tg-sw" data-dl="skin" data-v="${skins[i]}" aria-pressed="${l.skin === skins[i]}" aria-label="Skin, ${age}" style="--sw:${SKIN_TONE[i]}"></button>`).join('')}</div></div>`).join('')}`;
}

function facePage(l: Look) {
  return `
    <h3 class="tg-h">Eyes</h3>
    <div class="tg-opts tight">${EYES.map((e) => named('eyes', e, l.eyes === e, EYE[e][0], EYE[e][1])).join('')}</div>
    <h3 class="tg-h">Brows <small>coloured with the hair</small></h3>
    <div class="tg-seg">${BROWS.map((b, i) => pill('brows', b, String(i + 1), l.brows === b, `aria-label="Brows ${i + 1}"`)).join('')}</div>`;
}

function hairPage(l: Look) {
  return `
    <h3 class="tg-h">Style</h3>
    <div class="tg-opts">${HAIRS.map((h) => tile('hair', h, l.hair === h, HAIR[h], '', h === 'none' ? '' : art('hair', l.hairColor))).join('')}</div>
    <h3 class="tg-h">Colour <small>brows too</small></h3>
    ${colours('hairColor', HAIR_COLORS, l.hairColor, 'Hair')}`;
}

/** The colour rows of the worn top or bottom, with a way back to the colours it comes in. */
function garmentColours(which: 'top' | 'bottom', name: string, zones: readonly string[], colors: number[], stock: readonly number[]) {
  const reset = sameColors(colors, stock) ? '' : `<button class="tg-pill" data-dl="recolour" data-v="${which}">Stock colours</button>`;
  return `
    <h3 class="tg-h">Colours <small>${esc(name)}</small>${reset}</h3>
    ${zones.map((z, i) => zone(`${which === 'top' ? 'tz' : 'bz'}:${i}`, z, colors[i])).join('')}`;
}

function topPage(l: Look) {
  const card = (t: TopId) => {
    const on = l.top === t;
    const cs = on ? l.topColors : TOPS[t].colors;
    return tile('top', t, on, TOP[t][0], chips(cs), art(TOP[t][1], cs[cs.length - 1]));
  };
  return `
    <h3 class="tg-h">Tops</h3>
    <div class="tg-opts">${TOP_IDS.filter((t) => !isFull(t)).map(card).join('')}</div>
    <h3 class="tg-h">One-pieces <small>top and bottom in one: they replace your bottom</small></h3>
    <div class="tg-opts">${TOP_IDS.filter(isFull).map(card).join('')}</div>
    ${garmentColours('top', TOP[l.top][0], TOPS[l.top].zones, l.topColors, TOPS[l.top].colors)}`;
}

function bottomPage(l: Look) {
  const card = (b: BottomId) => {
    const on = l.bottom === b;
    const cs = on ? l.bottomColors : BOTTOMS[b].colors;
    return tile('bottom', b, on, BOTTOM[b][0], chips(cs), art(BOTTOM[b][1], cs[cs.length - 1]));
  };
  const one = l.bottom === NO_BOTTOM;
  return `
    ${one ? `<p class="tg-note"><b>${esc(TOP[l.top][0])}</b> is a one-piece: it covers top and bottom, and its colours are on the Top tab. Pick a bottom here to wear separates again (a ${esc(TOP.plain_tee[0].toLowerCase())} goes on with it).</p>` : ''}
    <h3 class="tg-h">Bottoms</h3>
    <div class="tg-opts">${BOTTOM_IDS.map(card).join('')}</div>
    ${l.bottom === NO_BOTTOM ? '' : garmentColours('bottom', BOTTOM[l.bottom][0], BOTTOMS[l.bottom].zones, l.bottomColors, BOTTOMS[l.bottom].colors)}`;
}

function shoesPage(l: Look) {
  return `
    <h3 class="tg-h">Shoes</h3>
    <div class="tg-opts">${SHOES.map((s) => tile('shoes', s, l.shoes === s, SHOE[s], '', art('shoe', l.shoeColor))).join('')}</div>
    <h3 class="tg-h">Colour</h3>
    ${colours('shoeColor', SHOE_COLORS, l.shoeColor, 'Shoes')}`;
}

function kitPage(l: Look, pass: PassState) {
  return `
    <h3 class="tg-h">Kit <small>${l.kit.length} of ${KIT_MAX} worn · one per spot</small></h3>
    ${KIT_GROUPS.map(([label, list]) => `<div class="tg-zone"><span class="tg-label">${label}</span><div class="tg-seg">${list.map((k) => pill('kit', k, KIT_NAME[k], l.kit.includes(k))).join('')}</div></div>`).join('')}
    <h3 class="tg-h">Metal</h3>
    <div class="tg-seg">${METALS.map((m) => {
      const label = `<i class="tg-dot" style="--sw:${METAL[m][1]}"></i>${esc(PASS_METAL_NAMES[m] ?? METAL[m][0])}`;
      return PASS_METALS.includes(m) ? passPill(pass, 'metal', m, label, l.metal === m) : pill('metal', m, label, l.metal === m);
    }).join('')}</div>
    <h3 class="tg-h">Leather <small>straps, gloves, the seat</small></h3>
    <div class="tg-seg">${LEATHERS.map((m) => pill('leather', m, `<i class="tg-dot" style="--sw:${LEATHER[m][1]}"></i>${LEATHER[m][0]}`, l.leather === m)).join('')}</div>
    <h3 class="tg-h">Glow <small>lenses, seams, implants</small></h3>
    ${colours('glow', GLOW_COLORS, l.glow, 'Glow')}
    <h3 class="tg-h">Battle pass gear <small>${pass.pass ? 'unlocked as you climb the tiers' : 'buy the pass to wear it'}</small></h3>
    <div class="tg-seg">${GEAR.map((g) => passPill(pass, 'gear', g, esc(GEAR_NAMES[g]), l.gear.includes(g))).join('')}</div>`;
}

function wheelPage(l: Look) {
  return `
    <h3 class="tg-h">Steering wheel <small>yours in every car</small></h3>
    <div class="tg-opts">${WHEELS.map((w) => tile('wheel', w, l.wheel === w, WHEEL[w][0], WHEEL[w][1], art('wheel', 'var(--tg-dim)'))).join('')}</div>`;
}

/** `pass`: what the battle pass has unlocked (its metals and gear show locked until then). */
export function creatorHtml(l: Look, pass: PassState, view: CreatorView): string {
  const pages: Record<CreatorTab, () => string> = {
    body: () => bodyPage(l),
    face: () => facePage(l),
    hair: () => hairPage(l),
    top: () => topPage(l),
    bottom: () => bottomPage(l),
    shoes: () => shoesPage(l),
    kit: () => kitPage(l, pass),
    wheel: () => wheelPage(l),
  };
  const seated = view.seated || view.tab === 'wheel';
  return `
    <div class="tg-creator">
      <div class="tg-cr-head">
      <div class="tg-cr-bar">
        <button class="tg-pill" data-cr-undo ${view.undo ? '' : 'disabled'}>Undo</button>
        <button class="tg-pill" data-dl-random>Surprise me</button>
        <button class="tg-pill" data-cr-reset ${sameLook(l, DEFAULT_LOOK) ? 'disabled' : ''}>Reset</button>
        <span class="tg-cr-gap"></span>
        <div class="tg-seg" role="group" aria-label="Pose">
          <button class="tg-pill" data-cr-pose="stand" aria-pressed="${!seated}">Standing</button>
          <button class="tg-pill" data-cr-pose="sit" aria-pressed="${seated}">Seated</button>
        </div>
      </div>
      <div class="tg-subtabs tg-cr-tabs" role="tablist" aria-label="Driver parts">
        ${CREATOR_TABS.map((t) => `<button role="tab" data-cr-tab="${t}" aria-selected="${t === view.tab}" class="${t === view.tab ? 'on' : ''}">${TAB_NAME[t]}</button>`).join('')}
      </div>
      </div>
      <div class="tg-cr-page" role="tabpanel" aria-label="${TAB_NAME[view.tab]}">${pages[view.tab]()}</div>
      <p class="tg-card-hint tg-cr-hint">Drag the driver to turn them, scroll or pinch to zoom.</p>
    </div>`;
}

const sameLook = (a: Look, b: Look) => JSON.stringify(a) === JSON.stringify(b);

/** The look after the control `el` was used, or null if `el` isn't one of the look's controls. */
export function lookAfter(l: Look, el: HTMLElement): Look | null {
  if (el.hasAttribute('data-dl-random')) return randomLook();
  if (el.hasAttribute('data-cr-reset')) return { ...DEFAULT_LOOK };
  const f = el.dataset.dl as Field | undefined;
  if (!f) return null;
  const raw = el instanceof HTMLInputElement ? el.value : el.dataset.v!;
  const num = raw.startsWith('#') ? parseInt(raw.slice(1), 16) : Number(raw);
  if (f.startsWith('tz:') || f.startsWith('bz:')) {
    const key = f.startsWith('tz:') ? 'topColors' : 'bottomColors';
    const colors = l[key].slice();
    colors[Number(f.slice(3))] = num;
    return { ...l, [key]: colors };
  }
  switch (f) {
    case 'frame':
      return withBase(l, `${raw}_${buildOf(l.base)}` as BaseId);
    case 'build':
      return withBase(l, `${frameOf(l.base)}_${raw}` as BaseId);
    case 'top':
      return withTop(l, raw as TopId);
    case 'bottom':
      return withBottom(l, raw as BottomId);
    case 'recolour':
      if (raw === 'top') return { ...l, topColors: [...TOPS[l.top].colors] };
      return l.bottom === NO_BOTTOM ? l : { ...l, bottomColors: [...BOTTOMS[l.bottom].colors] };
    case 'kit':
      return withKit(l, raw as KitId, !l.kit.includes(raw as KitId));
    case 'gear': {
      const g = raw as GearId;
      return { ...l, gear: l.gear.includes(g) ? l.gear.filter((x) => x !== g) : GEAR.filter((x) => x === g || l.gear.includes(x)) };
    }
    case 'hairColor':
    case 'shoeColor':
    case 'glow':
      return { ...l, [f]: num };
    default:
      return { ...l, [f]: raw };
  }
}
