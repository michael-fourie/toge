import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEAT, type ShotContext, SpinMeter, Streak, featsFor } from '../src/client/achievements.ts';

const plain: ShotContext = { headshot: false, scoped: true, spin: 0, airTime: 0, wallrunning: false, sliding: false, speed: 5, distance: 20 };
const labels = (s: Partial<ShotContext>) => featsFor({ ...plain, ...s }).map((f) => f.label);

test('a plain scoped body shot earns nothing', () => {
  assert.deepEqual(labels({}), []);
});

test('feats compound, in reading order: 360 NO-SCOPE ... HEADSHOT', () => {
  assert.deepEqual(labels({ spin: Math.PI * 2, scoped: false, headshot: true }), ['360', 'NO-SCOPE', 'HEADSHOT']);
  assert.deepEqual(labels({ wallrunning: true, airTime: 3, speed: 20, distance: 80, headshot: true }), ['WALLRUN', 'MACH', 'LONG SHOT', 'HEADSHOT']);
});

test('an ordinary bhop hop is not AIRBORNE; a big flight is', () => {
  assert.deepEqual(labels({ airTime: 0.7 }), []);
  assert.deepEqual(labels({ airTime: FEAT.airTime }), ['AIRBORNE']);
});

test('streaks: milestones at 3 and 5, multi-kills inside the window, reset on death', () => {
  const s = new Streak();
  const at = (t: number) => s.kill(t).map((f) => f.label);
  assert.deepEqual(at(0), []);
  assert.deepEqual(at(10), []);
  assert.deepEqual(at(20), ['KILLING SPREE']);
  assert.deepEqual(at(21), ['DOUBLE KILL']);
  assert.deepEqual(at(22), ['TRIPLE KILL', 'RAMPAGE']);
  s.reset();
  assert.deepEqual(at(23), []);
  assert.deepEqual(at(23 + FEAT.multiWindow + 0.1), []);
});

test('spin meter: a full turn within the window counts, an old one does not', () => {
  const m = new SpinMeter();
  for (let i = 0; i <= 60; i++) m.push(i / 60, (i / 60) * Math.PI * 2); // one turn in a second
  assert.ok(m.spin(Math.PI * 2) >= FEAT.spinTurn);
  for (let i = 1; i <= 120; i++) m.push(1 + i / 60, Math.PI * 2); // then stand still for two
  assert.ok(m.spin(Math.PI * 2) < 0.01);
});
