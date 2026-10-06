import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOVE } from '../src/shared/constants.ts';
import { SpeedFx } from '../src/client/speedfx.ts';

test('speed feedback is off at running pace, rises smoothly, and is full well before the speed cap', () => {
  assert.equal(SpeedFx.strength(0), 0);
  assert.equal(SpeedFx.strength(MOVE.maxGroundSpeed), 0);
  assert.equal(SpeedFx.strength(MOVE.maxSpeed), 1);
  let prev = 0;
  for (let v = 0; v <= MOVE.maxSpeed; v += 1) {
    const k = SpeedFx.strength(v);
    assert.ok(k >= prev, `not monotonic at ${v}`);
    prev = k;
  }
});
