import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BASES, BOTTOM_IDS, BOTTOMS, BROWS, DEFAULT_LOOK, decodeLook, encodeLook, EYES, HAIRS, isFull, KIT, type Look, lookProblem, NO_BOTTOM, randomLook, SHOES, SKINS, TOP_IDS, TOPS, WHEELS, withBase, withBottom, withKit, withTop } from '../../src/kanjo/shared/look.ts';

const DIR = new URL('../../public/models/drivers/wardrobe/', import.meta.url);

interface Part {
  slot: string;
  file: string;
  hide?: number;
  full?: boolean;
  zones?: { name: string; color?: string }[];
  mask?: string | null;
  paint?: { bones: string[]; min: number; role: string }[];
  sleeve?: string;
}
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as {
  bases: Record<string, { frame: string; base: { file: string }; parts: Record<string, Part> }>;
  skins: Record<string, string[]>;
  eyes: string[];
};

/** A tiny seeded random, so the random looks are the same every run. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

test('the default look is wearable and survives the wire', () => {
  assert.equal(lookProblem(DEFAULT_LOOK), null);
  assert.deepEqual(decodeLook(encodeLook(DEFAULT_LOOK)), DEFAULT_LOOK);
});

test('random looks round-trip', () => {
  const r = rng(7);
  for (let i = 0; i < 300; i++) {
    const l = randomLook(r);
    assert.equal(lookProblem(l), null, JSON.stringify(l));
    assert.deepEqual(decodeLook(encodeLook(l)), l);
  }
});

test('junk codes are refused', () => {
  const good = encodeLook(DEFAULT_LOOK);
  assert.ok(good.startsWith('L3.'));
  for (const bad of [undefined, 42, '', 'marlowe', 'L3.', 'L2.', good + '.', good + '.0.0', good.replace('L3.', 'L1.'), good.replace('L3.', 'L2.'), good.replace(/\.[0-9a-f]{6}\./, '.zzzzzz.'), 'L3.' + 'x'.repeat(300)]) {
    assert.equal(decodeLook(bad), null, String(bad));
  }
  const f = good.split('.');
  f[2] = 'z'; // a skin past the end
  assert.equal(decodeLook(f.join('.')), null);
  const g = good.split('.');
  g[8] = '000000'; // one colour for a three-zone top
  assert.equal(decodeLook(g.join('.')), null);
  const h = good.split('.');
  h[9] = '0'; // no bottom under a jacket
  h[10] = '';
  assert.equal(decodeLook(h.join('.')), null);
});

test('a skin belongs to its frame; changing frame keeps tone and age', () => {
  assert.equal(lookProblem({ ...DEFAULT_LOOK, skin: 'young_african_female' }), 'skin');
  const l = withBase({ ...DEFAULT_LOOK, skin: 'middleage_african_male' }, 'f_slim');
  assert.equal(l.skin, 'middleage_african_female');
  assert.equal(withBase(l, 'm_heavy').skin, 'middleage_african_male');
  assert.equal(SKINS.m.length, SKINS.f.length);
});

test('kit: one piece per slot, a cap on the total', () => {
  let l: Look = { ...DEFAULT_LOOK, kit: [] };
  l = withKit(l, 'goggles', true);
  l = withKit(l, 'monocle', true);
  assert.deepEqual(l.kit, ['monocle'], 'the monocle takes the goggles’ slot');
  l = withKit(l, 'bracer_r', true);
  l = withKit(l, 'mech_arm_r', true);
  assert.deepEqual(l.kit, ['monocle', 'mech_arm_r'], 'an arm takes a bracer or a mech arm');
  assert.equal(lookProblem({ ...l, kit: ['goggles', 'monocle'] }), 'two kit pieces in one slot');
  for (const k of Object.keys(KIT) as (keyof typeof KIT)[]) l = withKit(l, k, true);
  assert.equal(lookProblem(l), null);
});

test('a new top or bottom comes in its own colours; the other half and the same one keep yours', () => {
  const mine: Look = { ...DEFAULT_LOOK, topColors: [1, 2, 3], bottomColors: [4] };
  assert.equal(withTop(mine, 'suit_jacket'), mine);
  const tee = withTop(mine, 'trim_tee');
  assert.deepEqual(tee.topColors, [...TOPS.trim_tee.colors]);
  assert.deepEqual([tee.bottom, tee.bottomColors], ['suit_trousers', [4]]);
  const skirt = withBottom(tee, 'skirt');
  assert.deepEqual([skirt.top, skirt.topColors], ['trim_tee', tee.topColors]);
  assert.deepEqual(skirt.bottomColors, [...BOTTOMS.skirt.colors]);
  assert.equal(lookProblem(skirt), null);
});

test('a one-piece takes both places; taking it off gives the other half back', () => {
  assert.deepEqual(TOP_IDS.filter(isFull), ['overalls', 'denim_suit']);
  const one = withTop(DEFAULT_LOOK, 'overalls');
  assert.deepEqual([one.bottom, one.bottomColors], [NO_BOTTOM, []]);
  assert.equal(lookProblem(one), null);
  assert.deepEqual(decodeLook(encodeLook(one)), one);
  assert.equal(lookProblem({ ...one, bottom: 'skirt', bottomColors: [...BOTTOMS.skirt.colors] }), 'bottom', 'no bottom under a one-piece');
  assert.equal(lookProblem({ ...DEFAULT_LOOK, bottom: NO_BOTTOM, bottomColors: [] }), 'bottom', 'a top needs a bottom');
  // A top put on over a one-piece brings a bottom; a bottom brings a top.
  const top = withTop(one, 'blouse');
  assert.ok(top.bottom !== NO_BOTTOM && top.bottomColors.length === BOTTOMS[top.bottom].zones.length);
  assert.equal(lookProblem(top), null);
  const bottom = withBottom(one, 'shorts');
  assert.ok(!isFull(bottom.top));
  assert.equal(bottom.bottom, 'shorts');
  assert.equal(lookProblem(bottom), null);
});

test('every pairing of a top and a bottom can be worn and survives the wire', () => {
  for (const t of TOP_IDS) {
    for (const b of isFull(t) ? [] : BOTTOM_IDS) {
      const l = withBottom(withTop(DEFAULT_LOOK, t), b);
      assert.deepEqual([l.top, l.bottom], [t, b]);
      assert.equal(lookProblem(l), null);
      assert.deepEqual(decodeLook(encodeLook(l)), l);
    }
  }
});

test('looks saved as whole outfits (L2 codes) still load, as their top and bottom in the same colours', () => {
  // What encodeLook wrote before separates: base, skin, eyes, brows, hair, hair colour, outfit, its zone colours,
  // shoes, shoe colour, kit, metal, leather, glow, wheel (, gear).
  const old = (outfit: number, colors: string, gear = '') => `L2.1.0.7.6.2.7a5a4a.${outfit.toString(36)}.${colors}.2.8a6350.0-5.0.0.ffae3c.0${gear}`;
  const rest = { base: 'm_avg', skin: 'young_caucasian_male', eyes: 'grey', brows: 'eyebrow007', hair: 'short02', hairColor: 0x7a5a4a, shoes: 'shoes03', shoeColor: 0x8a6350, kit: ['goggles_up', 'collar'], metal: 'brass', leather: 'leather', glow: 0xffae3c, wheel: 'wood', gear: [] };
  // The default look of the day: a three-piece (tie, suit, shirt).
  assert.deepEqual(decodeLook(old(0, 'f0c26a-6fa08c-fbf2de')), { ...rest, top: 'suit_jacket', topColors: [0xf0c26a, 0x6fa08c, 0xfbf2de], bottom: 'suit_trousers', bottomColors: [0x6fa08c] });
  // Overalls (overalls, tee) and the denim suit (patches, clothes) stay whole.
  assert.deepEqual(decodeLook(old(1, '111111-222222')), { ...rest, top: 'overalls', topColors: [0x111111, 0x222222], bottom: NO_BOTTOM, bottomColors: [] });
  assert.deepEqual(decodeLook(old(7, '111111-222222'))!.top, 'denim_suit');
  // Zones were in the outfit's own order: (jeans, tee), (stripes, shirt, skirt), (trim, stripe, leggings, top).
  assert.deepEqual(decodeLook(old(6, '111111-222222')), { ...rest, top: 'plain_tee', topColors: [0x222222], bottom: 'blue_jeans', bottomColors: [0x111111] });
  assert.deepEqual(decodeLook(old(10, '111111-222222-333333')), { ...rest, top: 'blouse', topColors: [0x111111, 0x222222], bottom: 'skirt', bottomColors: [0x333333] });
  assert.deepEqual(decodeLook(old(11, '111111-222222-333333-444444')), { ...rest, top: 'crop_top', topColors: [0x111111, 0x444444], bottom: 'leggings', bottomColors: [0x222222, 0x333333] });
  // All twelve outfits load with a full set of colours, and re-encode as L3.
  const zones = [3, 2, 3, 3, 3, 3, 2, 2, 3, 3, 3, 4];
  zones.forEach((n, o) => {
    const l = decodeLook(old(o, Array.from({ length: n }, (_, i) => `${i + 1}0${i + 1}0${i + 1}0`).join('-')));
    assert.ok(l, `outfit ${o}`);
    assert.equal(lookProblem(l), null);
    assert.ok(encodeLook(l).startsWith('L3.'));
    assert.deepEqual(decodeLook(encodeLook(l)), l);
    assert.equal(decodeLook(old(o, '101010')), null, `outfit ${o} with one colour`);
  });
  assert.equal(decodeLook(old(12, '111111-222222')), null, 'an outfit past the end');
  // Battle pass gear rode on the end, as it does now.
  assert.deepEqual(decodeLook(old(0, 'f0c26a-6fa08c-fbf2de', '.3'))!.gear, ['halo']);
});

test('the catalogue matches what the wardrobe build made', () => {
  assert.deepEqual(manifest.skins, { m: [...SKINS.m], f: [...SKINS.f] });
  assert.deepEqual([...EYES], manifest.eyes);
  for (const s of [...SKINS.m, ...SKINS.f]) assert.ok(existsSync(new URL(`skins/${s}.webp`, DIR)), s);
  for (const e of EYES) assert.ok(existsSync(new URL(`eyes/${e}.webp`, DIR)), e);
  for (const [b, frame] of Object.entries(BASES)) {
    const m = manifest.bases[b];
    assert.ok(m, `no base ${b}`);
    assert.equal(m.frame, frame);
    assert.ok(existsSync(new URL(`${b}/${m.base.file}`, DIR)));
    const has = (id: string, slot: string) => {
      const p = m.parts[id];
      assert.ok(p, `${b} has no ${id}`);
      assert.equal(p.slot, slot, id);
      assert.ok(existsSync(new URL(`${b}/${p.file}`, DIR)), p.file);
      if (p.mask) assert.ok(existsSync(new URL(p.mask, DIR)), p.mask);
      return p;
    };
    const bits = new Set<number>();
    for (const [slot, list] of [['top', TOPS], ['bottom', BOTTOMS]] as const) {
      for (const [g, info] of Object.entries(list) as [string, { zones: readonly string[]; colors: readonly number[]; full?: true }][]) {
        const p = has(g, slot);
        assert.deepEqual(p.zones!.map((z) => z.name), [...info.zones], `${g} zones`);
        assert.deepEqual(p.zones!.map((z) => parseInt(z.color!.slice(1), 16)), [...info.colors], `${g} colours`);
        assert.equal(!!p.full, !!info.full, `${g} one-piece`);
        // One zone over a whole garment needs no mask; more are told apart by one.
        assert.equal(!!p.mask, info.zones.length > 1, `${g} mask`);
        bits.add(p.hide!);
      }
    }
    for (const s of SHOES) bits.add(has(s, 'shoes').hide!);
    assert.equal(bits.size, TOP_IDS.length + BOTTOM_IDS.length + SHOES.length, 'every garment and shoe hides with its own bit');
    // Sixteen bits to a `_hide` attribute (a float holds 24 exactly); the client reads `_hide` and `_hide2`.
    assert.ok(Math.max(...bits) < 32, 'hide bits fit two attributes');
    for (const h of HAIRS) if (h !== 'none') has(h, 'hair');
    for (const br of BROWS) has(br, 'brows');
    for (const [k, slot] of Object.entries(KIT)) {
      // One fit for everything, or one per top; where a top doesn't reach the piece (a belt under a crop top), one
      // per bottom instead.
      const fits = m.parts['kit_' + k] ? [has('kit_' + k, slot)] : TOP_IDS.flatMap((t) => (m.parts[`kit_${k}@${t}`] ? [has(`kit_${k}@${t}`, slot)] : BOTTOM_IDS.map((bt) => has(`kit_${k}@_${bt}`, slot))));
      for (const p of fits) {
        if (k.startsWith('mech_arm')) {
          assert.equal(p.sleeve, k.slice(-1), `${k} cuts its sleeve`);
          assert.ok(p.paint?.some((x) => x.bones.includes('lowerarm_' + k.slice(-1))), `${k} paints the arm`);
        }
        if (k.startsWith('gloves')) assert.ok(p.paint?.some((x) => x.bones.includes('hand_l') && x.role === 'strap'), `${k} paints the hands`);
      }
    }
    for (const w of WHEELS) has('wheel_' + w, 'wheel');
  }
});
