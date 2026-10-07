// Account levels: XP adds up to levels that each need a little more; the stash keeps XP and cleans bad saves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newInv, sanitize } from '../src/shared/inventory.ts';
import { XP, levelOf, xpToNext } from '../src/shared/levels.ts';

test('levels: start at 1, each level needs more XP than the last, and the leftover carries into the next', () => {
  assert.deepEqual(levelOf(0), { level: 1, into: 0, need: xpToNext(1) });
  assert.equal(levelOf(xpToNext(1) - 1).level, 1);
  assert.deepEqual(levelOf(xpToNext(1)), { level: 2, into: 0, need: xpToNext(2) });
  assert.deepEqual(levelOf(xpToNext(1) + xpToNext(2) + 7), { level: 3, into: 7, need: xpToNext(3) });
  for (let l = 1; l < 50; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
  assert.equal(levelOf(-50).level, 1, 'never below 1');
});

test('a won Battle match with a handful of kills is worth most of a level early on', () => {
  const match = 8 * XP.battleKill + XP.battleMatch + XP.battleWin;
  assert.ok(match > xpToNext(1) * 0.75 && match < xpToNext(1) * 3);
  const run = 30 * XP.zombieKill + 6 * XP.round + XP.boss + XP.survivalGame;
  assert.ok(run > xpToNext(1), 'a decent Survival run levels you up');
});

test('the stash keeps XP and repairs it from a bad save', () => {
  assert.equal(newInv().xp, 0);
  assert.equal(sanitize({ coins: 5, xp: 1234.7 }).xp, 1234);
  assert.equal(sanitize({ coins: 5, xp: -3 }).xp, 0);
  assert.equal(sanitize({ coins: 5, xp: 'lots' }).xp, 0);
  assert.equal(sanitize({ coins: 5 }).xp, 0, 'old saves start at 0');
});
