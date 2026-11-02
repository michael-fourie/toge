import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stickBrake } from '../../src/toge/client/input.ts';

test('pulling the left stick back brakes, harder the further back', () => {
  assert.equal(stickBrake(0), 0);
  assert.equal(stickBrake(-1), 0, 'pushing forward never brakes');
  assert.equal(stickBrake(0.25), 0, 'a stick that is mostly steering, a little low, does not drag the brakes');
  assert.ok(stickBrake(0.5) > 0 && stickBrake(0.5) < stickBrake(0.7));
  assert.equal(stickBrake(0.85), 1);
  assert.equal(stickBrake(1), 1);
});
