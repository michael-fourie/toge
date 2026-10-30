import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Box, pickNext } from '../src/client/pad.ts';

// A 4x3 grid of channel tiles, like the game chooser.
const grid: Box[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push({ x: c * 110, y: r * 80, w: 100, h: 70 });
const at = (r: number, c: number) => grid[r * 4 + c];
const without = (b: Box) => grid.filter((g) => g !== b);

test('the D-pad moves along rows and columns of a grid', () => {
  const from = at(1, 1);
  const cands = without(from);
  assert.equal(cands[pickNext(from, cands, 'right')], at(1, 2));
  assert.equal(cands[pickNext(from, cands, 'left')], at(1, 0));
  assert.equal(cands[pickNext(from, cands, 'up')], at(0, 1));
  assert.equal(cands[pickNext(from, cands, 'down')], at(2, 1));
});

test('nothing that way means no move', () => {
  const from = at(0, 0);
  assert.equal(pickNext(from, without(from), 'left'), -1);
  assert.equal(pickNext(from, without(from), 'up'), -1);
});

test('a wide button below a row is reachable from any tile above it', () => {
  const wide: Box = { x: 0, y: 300, w: 430, h: 40 };
  for (let c = 0; c < 4; c++) {
    const from = at(2, c);
    const cands = [...without(from), wide];
    assert.equal(cands[pickNext(from, cands, 'down')], wide);
  }
});

test('prefers the control straight ahead over a nearer one off to the side', () => {
  const from: Box = { x: 0, y: 0, w: 100, h: 40 };
  const ahead: Box = { x: 0, y: 200, w: 100, h: 40 };
  const diagonal: Box = { x: 160, y: 60, w: 100, h: 40 };
  assert.equal(pickNext(from, [diagonal, ahead], 'down'), 1);
});
