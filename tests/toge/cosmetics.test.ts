import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_CODE_MAX, decodeCar, encodeCar, newOwnedCar } from '../../src/toge/shared/cars.ts';
import { CATALOG, COS_CASES, COS_ITEMS, COS_SLOTS, RARITIES, RARITY, caseItems, caseOdds, cleanKit, cleanPlate, cosById, decodeKit, encodeKit, passOnly, rollCosCase } from '../../src/toge/shared/cosmetics.ts';
import { applyAction, cleanGarage, current, newGarage, ownedCarCode } from '../../src/toge/shared/garage.ts';
import type { KV } from '../../src/server/accountStore.ts';
import { GarageStore, secureRandom } from '../../src/toge/server/garageStore.ts';

const dice = (...rolls: number[]) => {
  let i = 0;
  return () => rolls[Math.min(i++, rolls.length - 1)];
};
const memoryKv = (): KV => {
  const data = new Map<string, unknown>();
  return { get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, put: async (k, v) => void data.set(k, structuredClone(v)), delete: async (k) => data.delete(k) };
};
const rich = () => ({ ...newGarage(), money: 1_000_000 });

test('the catalog is big, ids are unique, every item sits in a case (or is a battle pass exclusive)', () => {
  assert.ok(COS_ITEMS.length >= 100, `${COS_ITEMS.length} items`);
  assert.equal(new Set(COS_ITEMS.map((i) => i.id)).size, COS_ITEMS.length);
  for (const s of COS_SLOTS) {
    assert.ok(CATALOG[s].length >= 5, `${s} has a few items`);
    assert.ok(CATALOG[s].length <= 36 * 36, 'indices fit two base-36 digits');
    for (const it of CATALOG[s]) assert.equal(it.slot, s, `${it.id} is in its own slot's list`);
  }
  for (const it of COS_ITEMS) {
    assert.ok(RARITIES.includes(it.rarity), it.id);
    if (!passOnly(it)) assert.ok(COS_CASES.some((c) => caseItems(c.id).includes(it)), `${it.id} can drop from some case`);
    for (const v of Object.values(it.fx)) if (typeof v === 'number') assert.ok(Number.isFinite(v) && v >= 0 && v <= 0xffffff, `${it.id} params`);
  }
});

test('every case: odds sum to 1, every weighted rarity has items, the Legend Case is epic or better', () => {
  for (const box of COS_CASES) {
    const o = caseOdds(box.id);
    const sum = Object.values(o).reduce((a, b) => a + b!, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${box.id} odds sum ${sum}`);
    for (const r of RARITIES) if (box.weights[r]) assert.ok(caseItems(box.id).some((i) => i.rarity === r), `${box.id} holds a ${r}`);
    assert.ok(box.price > 0);
    // Even if everything were a duplicate, refunds never beat the price on average.
    const refund = RARITIES.reduce((a, r) => a + (o[r] ?? 0) * RARITY[r].refund, 0);
    assert.ok(refund < box.price, `${box.id} refunds ${refund} < ${box.price}`);
  }
  assert.ok(caseItems('legend').every((i) => ['epic', 'legendary', 'mythic'].includes(i.rarity)));
});

test('rollCosCase follows the odds: low dice give the commonest tier, high dice the rarest', () => {
  assert.equal(rollCosCase('street', dice(0, 0)).rarity, 'common');
  assert.equal(rollCosCase('street', dice(0.99999, 0)).rarity, 'mythic');
  assert.equal(rollCosCase('legend', dice(0, 0)).rarity, 'epic');
  // Over many rolls the share of commons is near its odds.
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let commons = 0;
  for (let i = 0; i < 20000; i++) if (rollCosCase('street', rnd).rarity === 'common') commons++;
  assert.ok(Math.abs(commons / 20000 - caseOdds('street').common!) < 0.02);
});

test('opening a case: pays, grants the drop, refunds duplicates, refuses when broke', () => {
  const g = rich();
  const r1 = applyAction(g, { a: 'case', id: 'street' }, dice(0, 0), 0);
  assert.ok(r1.ok && r1.drop);
  if (!r1.ok || !r1.drop) return;
  const item = cosById(r1.drop.id)!;
  assert.equal(r1.drop.dup, false);
  assert.equal(r1.g.money, g.money - 1200);
  assert.deepEqual(r1.g.cos, [item.id]);
  const r2 = applyAction(r1.g, { a: 'case', id: 'street' }, dice(0, 0), 0);
  assert.ok(r2.ok && r2.drop?.dup);
  if (!r2.ok) return;
  assert.equal(r2.drop!.refund, RARITY[item.rarity].refund);
  assert.equal(r2.g.money, r1.g.money - 1200 + RARITY[item.rarity].refund);
  assert.deepEqual(r2.g.cos, [item.id], 'no second copy');
  assert.deepEqual(applyAction({ ...newGarage(), money: 100 }, { a: 'case', id: 'legend' }, Math.random, 0), { ok: false, error: 'Not enough money.' });
  assert.equal(applyAction(g, { a: 'case', id: 'nope' as never }, Math.random, 0).ok, false);
  assert.equal(g.cos.length, 0, 'input garage untouched');
});

test('equip: only items you own, only in their slot; unequip and plate text', () => {
  const g = { ...rich(), cos: ['p_chrome', 'w_limo'] };
  assert.deepEqual(applyAction(g, { a: 'equip', i: 0, slot: 'paint', id: 'p_nebula' }, Math.random, 0), { ok: false, error: "You don't own that yet." });
  assert.equal(applyAction(g, { a: 'equip', i: 0, slot: 'window', id: 'p_chrome' }, Math.random, 0).ok, false, 'wrong slot');
  assert.equal(applyAction(g, { a: 'equip', i: 3, slot: 'paint', id: 'p_chrome' }, Math.random, 0).ok, false, 'no such car');
  assert.equal(applyAction(g, { a: 'equip', i: 0, slot: 'bogus' as never, id: null }, Math.random, 0).ok, false);
  const on = applyAction(g, { a: 'equip', i: 0, slot: 'paint', id: 'p_chrome' }, Math.random, 0);
  assert.ok(on.ok && current(on.g).cos.paint === 'p_chrome');
  if (!on.ok) return;
  const off = applyAction(on.g, { a: 'equip', i: 0, slot: 'paint', id: null }, Math.random, 0);
  assert.ok(off.ok && current(off.g).cos.paint === undefined);
  const plate = applyAction(g, { a: 'plate', i: 0, text: ' gg <b>ez!! 1234567 ' }, Math.random, 0);
  assert.ok(plate.ok && current(plate.g).plate === 'GG BEZ 1');
  assert.equal(cleanPlate('<script>'), 'SCRIPT');
});

test('cleanGarage drops unknown ids and takes off anything worn but not owned', () => {
  const g = cleanGarage({ cos: ['p_chrome', 'p_chrome', 'fake', 7], cars: [{ model: 'pebble', cos: { paint: 'p_chrome', window: 'w_limo', rims: 'p_chrome', glow: 'nope' }, plate: 'abc$' }] });
  assert.deepEqual(g.cos, ['p_chrome']);
  assert.deepEqual(g.cars[0].cos, { paint: 'p_chrome' });
  assert.equal(g.cars[0].plate, 'ABC');
  assert.deepEqual(cleanKit({ paint: 'w_limo' }), {}, 'an item in the wrong slot is dropped');
});

test('car codes carry cosmetics and plate text; old codes still decode', () => {
  const car = newOwnedCar('kitsune', 3);
  car.cos = { paint: 'p_ninetails', decal: 'd_goldragon', window: 'w_opal', head: 'h_spirit', tail: 't_lava', rims: 'r_plasma', caliper: 'c_hotbrakes', glow: 'g_solarflare', plate: 'pl_goat', frame: 'f_halo', exhaust: 'e_dragon' };
  car.plate = 'TOGE 86';
  const code = encodeCar(car);
  assert.ok(code.length <= CAR_CODE_MAX, code);
  const back = decodeCar(code)!;
  assert.deepEqual(back.cos, car.cos);
  assert.equal(back.plate, 'TOGE 86');
  assert.equal(encodeCar(newOwnedCar('pebble')), 'pebble.0.1.0.0.0.0.1.0.00000000', 'a stock car keeps the old code');
  assert.ok(decodeCar('pebble.0.1.0.0.0.0.1.00000000'), 'pre-underglow code');
  assert.deepEqual(decodeCar('pebble.0.1.0.0.0.0.1.0.00000000')!.cos, {});
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.00000000.zz'), null, 'unknown item index');
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.00000000.0~<b>'), null, 'bad plate text');
  assert.deepEqual(decodeKit(encodeKit({ glow: 'g_red' }, '')), { kit: { glow: 'g_red' }, plate: '' });
});

test('car codes carry the body options (tint, roof, hood, trim, mirrors, lip) only when they are set', () => {
  const car = newOwnedCar('shiro', 15);
  Object.assign(car.look, { tint: 3, roof: 2, hood: 1, trim: 1, mirrors: 2, lip: 2, rims: 5, rimColor: 6 });
  car.cos = { glow: 'g_red', window: 'w_opal' };
  car.plate = 'TOGE 86';
  const code = encodeCar(car);
  assert.ok(code.length <= CAR_CODE_MAX, code);
  const back = decodeCar(code)!;
  assert.deepEqual(back.look, car.look);
  assert.deepEqual(back.cos, car.cos);
  assert.equal(back.plate, 'TOGE 86');
  // Only the tint set: the rest of the options stay off the end.
  const tinted = newOwnedCar('pebble');
  tinted.look.tint = 2;
  assert.equal(encodeCar(tinted), 'pebble.0.1.0.0.0.0.1.0.2.00000000');
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.2.00000000')!.look.tint, 2);
  // Old codes take the defaults; out-of-range or junk values are refused.
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.00000000.-------1')!.look.tint, 1);
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.9.00000000'), null);
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.1.0.1.0.0.0.0.0.0.00000000'), null, 'one look value too many');
  assert.equal(decodeCar('pebble.0.1.0.0.0.0.00000000'), null, 'too few look values');
});

test('race codes only show what the account owns', () => {
  const car = newOwnedCar('shiro');
  car.cos = { paint: 'p_chrome', glow: 'g_red' };
  const g = { ...newGarage(), cos: ['g_red'] };
  assert.deepEqual(decodeCar(ownedCarCode(encodeCar(car), g))!.cos, { glow: 'g_red' });
  assert.equal(ownedCarCode('garbage', g), 'garbage', 'undecodable codes are left for the room to replace');
});

test('GarageStore rolls cases with its own dice and persists unlocks; raceCar strips unowned', async () => {
  const kv = memoryKv();
  const store = new GarageStore(kv, dice(0, 0), () => 0);
  await kv.put('g:ann', { ...newGarage(), money: 5000 });
  const r = await store.act('Ann', { a: 'case', id: 'street' });
  assert.ok(r.ok && r.drop);
  const saved = await store.get('ann');
  assert.equal(saved.money, 3800);
  assert.equal(saved.cos.length, 1);
  const car = newOwnedCar('pebble');
  car.cos = { paint: 'p_nebula' };
  assert.deepEqual(decodeCar(await store.raceCar('ann', encodeCar(car)))!.cos, {});
  for (let i = 0; i < 100; i++) {
    const x = secureRandom();
    assert.ok(x >= 0 && x < 1);
  }
});

test('body parts: a car wearing every slot (last item each, longest plate) still fits a car code and round-trips', () => {
  const car = newOwnedCar('vanta');
  for (const s of COS_SLOTS) car.cos[s] = CATALOG[s][CATALOG[s].length - 1].id;
  car.plate = 'WWWWWWWW';
  const code = encodeCar(car);
  assert.ok(code.length <= CAR_CODE_MAX, `${code.length} chars`);
  assert.deepEqual(decodeCar(code)?.cos, car.cos);
  assert.equal(decodeCar(code)?.plate, car.plate);
  // The new slots came after the old ones, so a code from before them still decodes to the same kit.
  assert.deepEqual(decodeKit('3-1')?.kit, { paint: CATALOG.paint[3].id, decal: CATALOG.decal[1].id });
  // The Aero Case drops only body parts... and holds every rarity it weights.
  assert.ok(caseItems('aero').every((i) => ['wing', 'hood', 'roof', 'lip', 'skirts', 'flaps'].includes(i.slot)));
});
