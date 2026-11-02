import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOUNDRY } from '../../src/gambol/shared/foundry.ts';
import { SURVIVAL } from '../../src/gambol/shared/constants.ts';
import { zombieStats } from '../../src/gambol/shared/zombie.ts';
import { PUNCH, STARTER, WEAPONS, WEAPON_IDS, ammoPrice, boxPool, gunStats } from '../../src/gambol/shared/weapons.ts';

test('nine guns, each with its own look, and a distinct feel', () => {
  assert.equal(WEAPON_IDS.length, 9);
  assert.equal(new Set(WEAPON_IDS.map((id) => WEAPONS[id].style)).size, 9, 'every gun has its own animation set');
  assert.equal(new Set(WEAPON_IDS.map((id) => WEAPONS[id].name)).size, 9);
});

test('the Pack-a-Punch makes every gun stronger, bigger and quicker, and renames it', () => {
  for (const id of WEAPON_IDS) {
    const a = gunStats(id, false);
    const b = gunStats(id, true);
    assert.ok(b.damage > a.damage * 2 && b.mag > a.mag && b.reserve > a.reserve, id);
    assert.ok(b.fireCooldown < a.fireCooldown && b.reloadTime < a.reloadTime, id);
    assert.notEqual(b.label, a.label);
    assert.equal(b.pellets, a.pellets);
  }
  assert.equal(gunStats('sunbeam', true).splash, WEAPONS.sunbeam.splash * PUNCH.splash);
});

test('a gun can always fire again by the time its animation would finish: the cooldown is the shot cycle', () => {
  for (const id of WEAPON_IDS) assert.ok(gunStats(id, false).fireCooldown >= 0.07 && gunStats(id, false).fireCooldown <= 0.8, id);
});

test('round 1 zombies fall to a few pistol shots, and the late game needs a punched gun', () => {
  const pistol = gunStats(STARTER, false);
  assert.ok(Math.ceil(zombieStats(1).hp / pistol.damage) <= 4);
  const r15 = zombieStats(15).hp;
  assert.ok(gunStats('warden', true).damage * 6 >= r15, 'a punched rifle still handles round 15 in a couple of bursts');
  assert.ok(gunStats('sparrow', false).damage * 8 < r15, 'a stock pistol is hopeless by then');
});

test('prices: wall guns match the table; ammo is half; the box never hands out the pistol or what you hold', () => {
  for (const w of FOUNDRY.survival!.wallBuys) assert.equal(w.price, WEAPONS[w.weapon].price, w.weapon);
  assert.ok(WEAPON_IDS.filter((id) => WEAPONS[id].price > 0).length === FOUNDRY.survival!.wallBuys.length, 'every priced gun hangs on a wall');
  assert.equal(ammoPrice('rattler', false), 500);
  assert.equal(ammoPrice('rattler', true), SURVIVAL.punchAmmoPrice);
  assert.ok(!boxPool(['rattler', 'awp']).includes('rattler') && !boxPool([]).includes(STARTER));
  assert.equal(boxPool([]).length, 8);
});
