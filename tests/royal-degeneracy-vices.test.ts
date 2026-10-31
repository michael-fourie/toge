import assert from 'node:assert/strict';
import test from 'node:test';
import { SPOTS } from '../src/games/royal-degeneracy/house.ts';
import { VIBES, comingDown, eyeShift, high, light, line, newVibe, pack, pill, puff, rip, rolled, sober, speedOf, tripping, wired } from '../src/games/royal-degeneracy/vices.ts';

test('royal vices: roll, light, three puffs, high for a minute', () => {
  const v = newVibe();
  assert.ok(!light(v), 'nothing to light');
  assert.ok(!puff(v, 0), 'nothing to puff');
  assert.ok(rolled(v));
  assert.ok(!rolled(v), 'one at a time');
  assert.ok(light(v));
  for (let i = 0; i < VIBES.puffs; i++) assert.ok(puff(v, 10));
  assert.equal(v.joint, 'none');
  assert.ok(high(v, 10 + VIBES.jointHigh - 1) && !high(v, 10 + VIBES.jointHigh + 1));
  assert.ok(speedOf(v, 11) < 1);
});

test('royal vices: bongs need packing, hit harder, and stack up to a cap', () => {
  const v = newVibe();
  assert.ok(!rip(v, 'bong-xang', 0), 'pack it first');
  assert.ok(pack(v, 'bong-xang'));
  assert.ok(!pack(v, 'bong-xang'), 'already packed');
  assert.ok(rip(v, 'bong-xang', 0));
  assert.equal(v.level, 2);
  assert.ok(v.coughUntil > 0);
  for (let i = 0; i < 5; i++) {
    pack(v, 'bong-xang');
    rip(v, 'bong-xang', 1);
  }
  assert.ok(v.highUntil <= 1 + VIBES.highCap);
});

test('royal vices: a line wires you, then you come down; the pill is one of four trips', () => {
  const v = newVibe();
  line(v, 0);
  assert.ok(wired(v, 10) && speedOf(v, 10) > 1);
  assert.ok(comingDown(v, VIBES.wired + 5) && speedOf(v, VIBES.wired + 5) < 1);
  assert.ok(!comingDown(v, VIBES.wired + VIBES.comedown + 1));
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const p = newVibe();
    const trip = pill(p, 0, r);
    assert.equal(tripping(p, 1), trip);
    assert.equal(tripping(p, VIBES.pill + 1), null);
  }
  const tiny = newVibe();
  pill(tiny, 0, 0.3);
  assert.ok(eyeShift(tiny, 1) < 0);
  sober(tiny);
  assert.equal(tripping(tiny, 1), null);
});

test('royal vices: the house has bongs, rolling trays, the plate and the pill', () => {
  const kinds = SPOTS.filter((s) => s.kind === 'vice').map((s) => s.vice);
  assert.equal(kinds.filter((k) => k === 'bong').length, 4);
  for (const k of ['roll', 'coke', 'pill']) assert.ok(kinds.includes(k as never), k);
});
