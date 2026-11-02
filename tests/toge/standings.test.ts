import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standings } from '../../src/toge/shared/standings.ts';

test('finishers lead by time, the rest by progress', () => {
  const order = standings([
    { who: 'a', finished: null, progress: 900 },
    { who: 'b', finished: 81.2, progress: 1000 },
    { who: 'c', finished: null, progress: 1200 },
    { who: 'd', finished: 79.5, progress: 1000 },
  ]).map((e) => e.who);
  assert.deepEqual(order, ['d', 'b', 'c', 'a']);
});

test('a lap ahead beats a car further into the lap', () => {
  const len = 3000;
  const order = standings([
    { who: 'lapped', finished: null, progress: 0 * len + 2900 },
    { who: 'leader', finished: null, progress: 1 * len + 100 },
  ]).map((e) => e.who);
  assert.deepEqual(order, ['leader', 'lapped']);
});
