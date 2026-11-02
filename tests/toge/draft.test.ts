import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/toge/shared/cars.ts';
import { DRAFT, stepDraft, strongestWake, wakeOf } from '../../src/toge/shared/draft.ts';
import { buildTrack, pointAt } from '../../src/toge/shared/track.ts';
import { type Car, type DriveInput, TICK_DT, TICK_HZ, newCar, stepCar } from '../../src/toge/shared/vehicle.ts';

/** A dead-straight, dead-flat test strip (the road runs toward -z). */
const flat = buildTrack({ id: 'koripass', name: 'flat', tag: '', blurb: '', theme: 'alpine', seed: 1, width: 12, relief: 0, points: Array.from({ length: 21 }, (_, i) => [0, 100, -i * 200] as [number, number, number]) });
const gas: DriveInput = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

const body = (x: number, z: number, vx: number, vz: number) => ({ p: { x, y: 0, z }, v: { x: vx, y: 0, z: vz } });
const carAt = (s: number, d = 0): Car => {
  const l = pointAt(flat, s, d);
  return newCar(carSpec(newOwnedCar('shiro')), l.x, l.y, l.z, Math.atan2(-l.tx, -l.tz));
};

test('draft: the wake is a cone behind a car going your way at speed', () => {
  const me = body(0, 0, 0, -40);
  assert.ok(wakeOf(me, body(0, -4, 0, -40)) > 0.95, 'right behind its bumper: full strength');
  assert.ok(wakeOf(me, body(0, -15, 0, -40)) > wakeOf(me, body(0, -25, 0, -40)), 'fades with distance');
  assert.ok(wakeOf(me, body(0, -25, 0, -40)) > 0, 'still felt 25 m back');
  assert.equal(wakeOf(me, body(0, -DRAFT.range - 1, 0, -40)), 0, 'out of range');
  assert.equal(wakeOf(me, body(3, -8, 0, -40)), 0, 'a lane over: no wake');
  assert.ok(wakeOf(me, body(0.8, -8, 0, -40)) < wakeOf(me, body(0, -8, 0, -40)), 'weaker off the centre line');
  assert.equal(wakeOf(me, body(0, 8, 0, -40)), 0, 'a car behind you is no help');
  assert.equal(wakeOf(me, body(0, -8, 0, 40)), 0, 'nor one coming the other way');
  assert.equal(wakeOf(me, body(0, -8, 0, -5)), 0, 'nor a crawling one');
  assert.equal(wakeOf(body(0, 0, 0, -10), body(0, -8, 0, -40)), 0, 'too slow to draft');
  assert.equal(strongestWake(me, [me, body(0, -20, 0, -40), body(0, -6, 0, -40)]), wakeOf(me, body(0, -6, 0, -40)), 'the strongest wake wins, and you are not in your own');
});

test('draft: tucked in behind a car you close on it; on your own you do not', () => {
  // Two pairs of identical cars from a rolling start, each follower 12 m back. Only one follower drafts.
  const run = (draft: boolean) => {
    const lead = carAt(212);
    const follow = carAt(200);
    for (const c of [lead, follow]) c.v = { x: 0, y: 0, z: -40 };
    for (let i = 0; i < 6 * TICK_HZ; i++) {
      if (draft) stepDraft(follow, strongestWake(follow, [lead]), 1, TICK_DT);
      stepCar(lead, gas, flat);
      stepCar(follow, gas, flat);
    }
    return lead.s - follow.s;
  };
  const solo = run(false);
  const drafted = run(true);
  assert.ok(Math.abs(solo - 12) < 1.5, `without drafting the gap holds (${solo.toFixed(1)} m)`);
  assert.ok(drafted < solo - 3, `drafting closes the gap (${drafted.toFixed(1)} m vs ${solo.toFixed(1)} m)`);
});

test('draft: a charged slingshot fires when you pull out on the gas, and only then', () => {
  const tuck = (c: Car, seconds: number) => {
    for (let t = 0; t < seconds; t += TICK_DT) assert.equal(stepDraft(c, 0.9, 1, TICK_DT), false);
  };
  const a = carAt(200);
  tuck(a, DRAFT.charge + 0.1);
  assert.ok(a.draftArmed > 0, 'charged');
  // Pulling out goes through the edge of the wake first: still armed.
  for (let i = 0; i < 10; i++) assert.equal(stepDraft(a, 0.2, 1, TICK_DT), false);
  assert.equal(stepDraft(a, 0, 1, TICK_DT), true, 'out of the wake: slingshot');
  assert.ok(a.boost >= DRAFT.slingSeconds - 1e-9 && a.boostPower === DRAFT.slingAccel);
  assert.equal(a.draftArmed, 0);

  const b = carAt(200);
  tuck(b, DRAFT.charge * 0.5);
  assert.equal(stepDraft(b, 0, 1, TICK_DT), false, 'not tucked in long enough');
  assert.equal(b.boost, 0);

  const c = carAt(200);
  tuck(c, DRAFT.charge + 0.1);
  assert.equal(stepDraft(c, 0, 0, TICK_DT), false, 'off the gas: no slingshot');
  for (let t = 0; t < DRAFT.armed + 0.1; t += TICK_DT) stepDraft(c, 0, 0, TICK_DT);
  assert.equal(stepDraft(c, 0, 1, TICK_DT), false, 'and the charge does not keep forever');
});
