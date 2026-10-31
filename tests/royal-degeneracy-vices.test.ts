import assert from 'node:assert/strict';
import test from 'node:test';
import { SPOTS } from '../src/games/royal-degeneracy/house.ts';
import { VIBES, clearRip, comingDown, drag, exhaleJoint, eyeShift, heldCode, high, light, line, newVibe, pack, packed, pickUp, pill, putDown, ripDraw, rolled, sober, speedOf, tripping, wired } from '../src/games/royal-degeneracy/vices.ts';

const DT = 1 / 60;
const hold = (secs: number, f: (dt: number) => boolean) => {
  for (let t = 0; t < secs; t += DT) if (!f(DT)) return false;
  return true;
};

test('royal vices: roll, light, drag by drag: longer drags get you higher, and the joint burns down', () => {
  const v = newVibe();
  assert.ok(!light(v), 'nothing to light');
  assert.ok(!drag(v, DT), 'nothing to smoke');
  assert.ok(rolled(v));
  assert.ok(!rolled(v), 'one at a time');
  assert.ok(light(v));
  hold(0.5, (dt) => drag(v, dt));
  const small = exhaleJoint(v, 10);
  assert.ok(!small.cough && !small.cashed && high(v, 11));
  const after = v.highUntil;
  hold(2, (dt) => drag(v, dt));
  const big = exhaleJoint(v, 11);
  assert.ok(big.cough, 'a two-second drag makes you cough');
  assert.ok(big.size > small.size && v.highUntil > after);
  assert.ok(v.burn < 1 && v.burn > 0);
  // Smoke it to the roach.
  let cashed = false;
  for (let i = 0; i < 20 && !cashed; i++) {
    hold(1, (dt) => drag(v, dt));
    cashed = exhaleJoint(v, 12).cashed;
  }
  assert.ok(cashed && v.joint === 'none');
  assert.ok(speedOf(v, 13) < 1);
});

test('royal vices: pick up a bong, pack it, fill the chamber, clear it; overfill and you cough it up', () => {
  const v = newVibe();
  assert.ok(!pack(v), 'pick one up first');
  assert.ok(pickUp(v, 'bong-xang'));
  assert.ok(!pickUp(v, 'bong-selby'), 'one at a time');
  assert.ok(!ripDraw(v, DT), 'pack it first');
  assert.ok(pack(v) && packed(v));
  assert.ok(!pack(v), 'already packed');
  hold(VIBES.ripFill * 0.5, (dt) => ripDraw(v, dt));
  const half = clearRip(v, 0);
  assert.ok(half.size > 0.4 && half.size < 0.6 && !half.cough);
  assert.equal(v.level, 2);
  assert.ok(!packed(v), 'one rip per bowl');
  assert.equal(clearRip(v, 0).size, 0, 'an empty bowl gives nothing');
  pack(v);
  assert.ok(!hold(VIBES.ripFill * 2, (dt) => ripDraw(v, dt)), 'it stops at overfull');
  const full = clearRip(v, 1);
  assert.ok(full.cough && v.coughUntil > 1);
  for (let i = 0; i < 6; i++) {
    pack(v);
    hold(VIBES.ripFill, (dt) => ripDraw(v, dt));
    clearRip(v, 2);
  }
  assert.ok(v.highUntil <= 2 + VIBES.highCap);
  // A packed bowl stays packed when you put it down; you can't light a joint with a bong in your hands.
  pack(v);
  rolled(v);
  assert.ok(!light(v));
  putDown(v);
  assert.equal(v.bong, null);
  assert.ok(v.packed.includes('bong-xang'));
  assert.ok(light(v));
  assert.ok(!pickUp(v, 'bong-xang'), 'not with a lit joint in your hand');
  assert.equal(heldCode(v, ['bong-living', 'bong-xang']), 2);
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
