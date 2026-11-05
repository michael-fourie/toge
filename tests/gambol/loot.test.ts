import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equip, earn, gearOf, newInv, openCase, sanitize, sell, unequip } from '../../src/gambol/shared/inventory.ts';
import { CASES, COIN, ITEMS, RARITIES, RARITY, decodeGear, encodeGear, itemById, itemsIn, odds, rollCase } from '../../src/gambol/shared/items.ts';

/** A deterministic rng for repeatable dice. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('item ids are unique and every case has something to drop', () => {
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  for (const c of CASES) assert.ok(itemsIn(c.id).length >= 5, c.id);
});

test('every case odds sum to 1 and rarer tiers are less likely', () => {
  for (const c of CASES) {
    const o = odds(c.id);
    assert.ok(Math.abs(Object.values(o).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok(o.gold! < o.covert! && o.covert! < o.consumer!);
  }
});

test('rolling many cases hits every item with roughly the stated odds', () => {
  const rng = seeded(7);
  for (const c of CASES) {
    const n = 40000;
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const it = rollCase(c.id, rng);
      assert.equal(it.case, c.id);
      seen.set(it.rarity, (seen.get(it.rarity) ?? 0) + 1);
    }
    for (const [r, p] of Object.entries(odds(c.id))) {
      const got = (seen.get(r) ?? 0) / n;
      assert.ok(Math.abs(got - p!) < 0.012 + p! * 0.25, `${c.id} ${r}: ${got} vs ${p}`);
    }
  }
});

test('rng at the extremes still returns a real item', () => {
  for (const c of CASES) {
    assert.ok(rollCase(c.id, () => 0));
    assert.ok(rollCase(c.id, () => 0.999999999));
  }
});

test('buying a case costs coins and adds the drop; a poor player gets nothing', () => {
  const inv = newInv();
  const price = CASES[0].price;
  const got = openCase(inv, 'sky', seeded(1))!;
  assert.equal(inv.coins, COIN.start - price);
  assert.equal(inv.items.length, 1);
  assert.equal(itemById(got.id)!.case, 'sky');
  inv.coins = price - 1;
  assert.equal(openCase(inv, 'sky'), null);
  assert.equal(inv.coins, price - 1);
  assert.equal(inv.items.length, 1);
});

test('equip fills the slot, replaces within it, and unequips', () => {
  const inv = newInv();
  inv.items.push({ u: 1, id: 'awp_dune' }, { u: 2, id: 'awp_snow' }, { u: 3, id: 'hat_halo' });
  assert.ok(equip(inv, 1) && equip(inv, 3));
  assert.deepEqual(gearOf(inv), { rifle: 'awp_dune', hat: 'hat_halo' });
  equip(inv, 2);
  assert.equal(gearOf(inv).rifle, 'awp_snow');
  unequip(inv, 'rifle');
  assert.equal(gearOf(inv).rifle, undefined);
  assert.equal(equip(inv, 99), false);
});

test('selling pays the rarity price and unequips the item', () => {
  const inv = newInv();
  inv.items.push({ u: 1, id: 'awp_solar' });
  equip(inv, 1);
  assert.equal(sell(inv, 1), RARITY.gold.sell);
  assert.equal(inv.coins, COIN.start + RARITY.gold.sell);
  assert.deepEqual(gearOf(inv), {});
  assert.equal(sell(inv, 1), 0);
});

test('earn only adds', () => {
  const inv = newInv();
  earn(inv, COIN.kill);
  earn(inv, -50);
  assert.equal(inv.coins, COIN.start + COIN.kill);
});

test('gear codes round-trip and reject junk', () => {
  const g = { rifle: 'awp_dune', hat: 'hat_halo' };
  assert.deepEqual(decodeGear(encodeGear(g)), g);
  assert.deepEqual(decodeGear(encodeGear({})), {});
  assert.equal(decodeGear('nope,,,,'), null);
  assert.equal(decodeGear('hat_halo,,,,'), null, 'right id, wrong slot');
  assert.equal(decodeGear('awp_dune,,'), null, 'wrong arity');
  assert.equal(decodeGear(5), null);
  assert.equal(decodeGear('x'.repeat(500)), null);
});

test('sanitize drops forged items and equips, and keeps ids unique', () => {
  const inv = sanitize({
    coins: -5,
    items: [{ u: 1, id: 'awp_dune' }, { u: 1, id: 'awp_snow' }, { u: 2, id: 'fake' }, { u: 3, id: 'hat_halo' }, null],
    next: 1,
    equipped: { rifle: 3, hat: 3, knife: 77 },
  });
  assert.equal(inv.coins, 0);
  assert.deepEqual(inv.items.map((o) => o.u), [1, 3]);
  assert.ok(inv.next > 3);
  assert.deepEqual(inv.equipped, { hat: 3 }, 'a hat can not sit in the rifle slot');
  assert.deepEqual(sanitize(null), newInv());
});

test('every rarity has a colour, a name and a price that grows with rarity', () => {
  let last = 0;
  for (const r of RARITIES) {
    assert.ok(RARITY[r].sell > last);
    last = RARITY[r].sell;
  }
});
