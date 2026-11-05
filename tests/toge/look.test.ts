import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BASES, BROWS, DEFAULT_LOOK, decodeLook, encodeLook, EYES, HAIRS, KIT, type Look, lookProblem, OUTFITS, randomLook, SHOES, SKINS, WHEELS, withBase, withKit, withOutfit } from '../../src/toge/shared/look.ts';

const DIR = new URL('../../public/models/drivers/wardrobe/', import.meta.url);

interface Part {
  slot: string;
  file: string;
  hide?: number;
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
  for (const bad of [undefined, 42, '', 'marlowe', 'L2.', good + '.0', good.replace('L2.', 'L1.'), good.replace(/\.[0-9a-f]{6}\./, '.zzzzzz.'), 'L2.' + 'x'.repeat(300)]) {
    assert.equal(decodeLook(bad), null, String(bad));
  }
  const f = good.split('.');
  f[2] = 'z'; // a skin past the end
  assert.equal(decodeLook(f.join('.')), null);
  const g = good.split('.');
  g[8] = '000000'; // one colour for a three-zone outfit
  assert.equal(decodeLook(g.join('.')), null);
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

test('a new outfit comes in its own colours; the same one keeps yours', () => {
  const mine = { ...DEFAULT_LOOK, colors: [1, 2, 3] };
  assert.deepEqual(withOutfit(mine, 'male_elegantsuit01').colors, [1, 2, 3]);
  assert.deepEqual(withOutfit(mine, 'female_sportsuit01').colors, [...OUTFITS.female_sportsuit01.colors]);
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
    for (const [o, info] of Object.entries(OUTFITS)) {
      const p = has(o, 'outfit');
      assert.deepEqual(p.zones!.map((z) => z.name), [...info.zones], `${o} zones`);
      assert.deepEqual(p.zones!.map((z) => parseInt(z.color!.slice(1), 16)), [...info.colors], `${o} colours`);
      bits.add(p.hide!);
    }
    for (const s of SHOES) bits.add(has(s, 'shoes').hide!);
    assert.equal(bits.size, Object.keys(OUTFITS).length + SHOES.length, 'every outfit and shoe hides with its own bit');
    assert.ok(Math.max(...bits) < 31, 'hide bits fit an int');
    for (const h of HAIRS) if (h !== 'none') has(h, 'hair');
    for (const br of BROWS) has(br, 'brows');
    for (const [k, slot] of Object.entries(KIT)) {
      // Either one fit for every outfit, or one per outfit.
      const fits = m.parts['kit_' + k] ? [has('kit_' + k, slot)] : Object.keys(OUTFITS).map((o) => has(`kit_${k}@${o}`, slot));
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
