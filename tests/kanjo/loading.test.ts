import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOADING_TIPS, runLabel } from '../../src/kanjo/client/loadingcopy.ts';

test('the loading screen says what kind of run is loading', () => {
  assert.equal(runLabel({ track: 'koripass', rivals: 5 }), 'Solo · 5 rivals');
  assert.equal(runLabel({ track: 'koripass', rivals: 1, physics: true }), 'Solo · 1 rival · Physics');
  assert.equal(runLabel({ track: 'koripass', rivals: 0 }), 'Solo run');
  assert.equal(runLabel({ track: 'monza', online: { mode: 'race', racers: 4 } }), 'Online race · 4 racers');
  assert.equal(runLabel({ track: 'karasu', online: { mode: 'climb', racers: 1 } }), 'Online hill climb');
  assert.equal(runLabel({ track: 'spa', online: { mode: 'trial', racers: 3 }, physics: true }), 'Online time trial · 3 racers · Physics');
});

test('loading tips keep the house voice: short, no exclamation marks', () => {
  for (const tip of LOADING_TIPS) {
    assert.ok(!tip.includes('!'), tip);
    assert.ok(tip.length <= 80, tip);
  }
});
