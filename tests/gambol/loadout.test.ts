import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Loadout } from '../../src/gambol/client/loadout.ts';
import { gunStats } from '../../src/gambol/shared/weapons.ts';

test('a fresh loadout is the pistol, full', () => {
  const l = new Loadout(false, 'sparrow');
  assert.equal(l.gun!.mag, 8);
  assert.equal(l.gun!.reserve, 64);
  assert.equal(l.slots[1], null);
});

test('firing and reloading move rounds from the reserve; a short reserve gives a short mag', () => {
  const l = new Loadout(false, 'sparrow');
  for (let i = 0; i < 5; i++) l.fire();
  assert.ok(l.canReload());
  l.finishReload();
  assert.deepEqual([l.gun!.mag, l.gun!.reserve], [8, 59]);
  l.gun!.reserve = 2;
  for (let i = 0; i < 8; i++) l.fire();
  l.finishReload();
  assert.deepEqual([l.gun!.mag, l.gun!.reserve], [2, 0]);
  assert.equal(l.canReload(), false, 'nothing left to put in');
});

test('endless reserve (battle) never runs dry', () => {
  const l = new Loadout(true, 'awp');
  for (let i = 0; i < 10; i++) l.fire();
  l.finishReload();
  assert.equal(l.gun!.mag, 10);
  assert.equal(l.gun!.reserve, Infinity);
});

test('syncing with the server: unchanged guns keep their ammo, new and punched ones come full, bought ammo refills', () => {
  const l = new Loadout(false, 'sparrow');
  l.fire();
  l.fire();
  assert.equal(l.sync([{ w: 'sparrow', up: false }, null], 0), false);
  assert.equal(l.gun!.mag, 6, 'untouched');
  assert.equal(l.sync([{ w: 'sparrow', up: false }, { w: 'rattler', up: false }], 1, [1]), true);
  assert.equal(l.gun!.w, 'rattler');
  assert.equal(l.gun!.mag, 32);
  assert.equal(l.slots[0]!.mag, 6, 'the pistol kept its ammo');
  l.sync([{ w: 'sparrow', up: true }, { w: 'rattler', up: false }], 0);
  assert.equal(l.gun!.mag, gunStats('sparrow', true).mag, 'punched: a new, bigger mag');
  l.fire();
  l.sync([{ w: 'sparrow', up: true }, { w: 'rattler', up: false }], 0, [0]);
  assert.equal(l.gun!.mag, gunStats('sparrow', true).mag, 'ammo bought');
});

test('equip switches between the guns you have, and only those', () => {
  const l = new Loadout(false, 'sparrow');
  assert.equal(l.equip(1), false);
  l.sync([{ w: 'sparrow', up: false }, { w: 'warden', up: false }], 0);
  assert.equal(l.equip(1), true);
  assert.equal(l.gun!.w, 'warden');
  assert.equal(l.equip(1), false, 'already there');
});
