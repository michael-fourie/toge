import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRows, mvpIds, rankRows, shouldRestart, totalKills, waitingFor, type RunRecord } from '../src/shared/postgame.ts';

const recs = () =>
  new Map<number, RunRecord>([
    [1, { name: 'ann', color: 1, kills: 4 }],
    [2, { name: 'bo', color: 2, kills: 9 }],
    [3, { name: 'cy', color: 3, kills: 9 }],
    [4, { name: 'di', color: 4, kills: 0 }],
  ]);

test('rows rank by kills, flag who left and who is ready', () => {
  const rows = buildRows(recs(), new Set([1, 2, 4]), new Set([2, 3]));
  assert.deepEqual(rows.map((r) => r.id), [2, 3, 1, 4]);
  assert.equal(rows[0].ready, true);
  assert.equal(rows[1].gone, true);
  assert.equal(rows[1].ready, false, 'a player who left is never ready');
  assert.equal(totalKills(rows), 22);
});

test('MVP: top scorer, ties share it, nobody with zero kills', () => {
  assert.deepEqual([...mvpIds(rankRows(buildRows(recs(), new Set(), new Set())))].sort(), [2, 3]);
  assert.equal(mvpIds([{ id: 1, name: 'a', color: 0, kills: 0, ready: false, gone: false }]).size, 0);
});

test('restart when everyone present is ready, or on timeout', () => {
  const present = new Set([1, 2]);
  assert.equal(waitingFor(present, new Set([1])), 1);
  assert.equal(shouldRestart(present, new Set([1]), 30), false);
  assert.equal(shouldRestart(present, new Set([1, 2]), 30), true);
  assert.equal(shouldRestart(present, new Set(), 0), true);
  assert.equal(shouldRestart(new Set(), new Set(), 30), false, 'empty lobby never restarts early');
  assert.equal(shouldRestart(new Set([2]), new Set([1, 2]), 30), true, 'a ready player who left is ignored');
});
