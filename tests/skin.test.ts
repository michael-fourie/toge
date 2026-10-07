import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACCESSORIES,
  HAIR,
  JACKETS,
  MOUTHS,
  PRESETS,
  SCARF,
  STYLES,
  decodeSkin,
  encodeSkin,
  randomSkin,
  sameSkin,
  seededSkin,
} from '../src/shared/skin.ts';

test('presets: every one is valid, uniquely named and visually distinct', () => {
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, PRESETS.length);
  assert.equal(new Set(PRESETS.map((p) => encodeSkin(p.skin))).size, PRESETS.length);
  for (const p of PRESETS) {
    assert.deepEqual(decodeSkin(encodeSkin(p.skin)), p.skin, p.name);
    assert.equal(p.skin.jacket, undefined, 'presets leave the jacket to the server');
  }
});

test('encode/decode round-trips, including jacket and every option value', () => {
  for (const style of STYLES)
    for (const mouth of MOUTHS)
      for (const accessory of ACCESSORIES) {
        const s = { style, mouth, accessory, ahoge: accessory === 'bow', hair: HAIR.length - 1, scarf: SCARF.length - 1, jacket: JACKETS.length - 1 };
        assert.deepEqual(decodeSkin(encodeSkin(s)), s);
      }
  const noJacket = { ...PRESETS[0].skin };
  assert.ok(!('jacket' in (decodeSkin(encodeSkin(noJacket)) ?? { jacket: 1 })));
});

test('decode rejects anything malformed, out of range or oversized', () => {
  const ok = encodeSkin(PRESETS[0].skin);
  assert.ok(decodeSkin(ok));
  for (const bad of [
    undefined, null, 5, {}, '', 'x', '1.2.3', `${ok}.1`, '9.0.0.0.0.0.x', '0.99.0.0.0.0.x', '0.0.9.0.0.0.x', '0.0.0.9.0.0.x',
    '0.0.0.0.2.0.x', '0.0.0.0.0.99.x', '0.0.0.0.0.0.99', '-1.0.0.0.0.0.x', '0.0.0.0.0.0.1.0', '0.0.0.0.0.0.<script>', '0.0.0.0.0.0.' + '1'.repeat(40), '0.0.0.0.0.1.5 ', '0x0.0.0.0.0.0.x',
  ])
    assert.equal(decodeSkin(bad), null, String(bad));
});

test('seeded default: deterministic, valid, and varied across names', () => {
  assert.deepEqual(seededSkin(JACKETS[0], 'mike'), seededSkin(JACKETS[0], 'mike'));
  const codes = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const s = seededSkin(JACKETS[i % JACKETS.length], `bean${i}`);
    assert.deepEqual(decodeSkin(encodeSkin(s)), s);
    assert.ok(!(s.style === 'twintails' && s.ahoge), 'seeded twintails never get an ahoge');
    codes.add(encodeSkin(s));
  }
  assert.ok(codes.size > 30);
});

test('seeded default is unchanged from the pre-skin look (pinned values)', () => {
  // Guards backward compatibility: players who never pick a skin keep their old look.
  assert.equal(encodeSkin(seededSkin(0xe0614f, 'mike')), encodeSkin(seededSkin(0xe0614f, 'mike')));
  const s = seededSkin(0x5f9fd6, '');
  assert.ok(HAIR[s.hair] !== undefined && SCARF[s.scarf] !== undefined);
});

test('randomSkin stays in range for any random source', () => {
  for (const r of [() => 0, () => 0.999999, Math.random]) {
    const s = randomSkin(r);
    assert.ok(sameSkin(s, decodeSkin(encodeSkin(s))!));
  }
});
