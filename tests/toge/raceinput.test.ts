import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BTN } from '../../src/client/pad.ts';
import { padPedals, trigger } from '../../src/toge/client/input.ts';

const pad = (lt: number, rt: number, held: number[] = []) => ({ lt, rt, down: Array.from({ length: 16 }, (_, i) => held.includes(i)) });

test('a controller drives like every other racing game: RT throttle, LT brake, Ⓐ drift', () => {
  assert.deepEqual(padPedals(pad(0, 1)), { throttle: 1, brake: 0, drift: 0 });
  assert.deepEqual(padPedals(pad(1, 0)), { throttle: 0, brake: 1, drift: 0 });
  assert.equal(padPedals(pad(0, 0, [BTN.A])).drift, 1);
  assert.equal(padPedals(pad(0, 0, [BTN.B])).brake, 1, 'Ⓑ brakes too');
  assert.equal(padPedals(pad(0, 0, [BTN.X])).brake, 0, 'the spectate button never brakes');
});

test('triggers are analog pedals with a dead zone at rest and full travel before the stop', () => {
  assert.equal(trigger(0), 0);
  assert.equal(trigger(0.03), 0, 'a resting trigger never drags the brakes');
  assert.ok(trigger(0.3) > 0 && trigger(0.3) < trigger(0.6) && trigger(0.6) < 1, 'partial pedal for trail braking');
  assert.equal(trigger(0.95), 1);
  assert.equal(trigger(1), 1);
});
