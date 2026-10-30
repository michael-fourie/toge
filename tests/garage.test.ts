import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_LEVEL, PARTS, decodeCar, encodeCar, newOwnedCar } from '../src/shared/race/cars.ts';
import { MYSTERY_COST, SOLO_GAP_MS, START_MONEY, applyAction, cleanGarage, current, newGarage, payout, tunerCost } from '../src/shared/race/garage.ts';
import type { KV } from '../src/server/accountStore.ts';
import { GarageStore } from '../src/server/garageStore.ts';

/** Dice that return the given rolls in order (then repeat the last). */
const dice = (...rolls: number[]) => {
  let i = 0;
  return () => rolls[Math.min(i++, rolls.length - 1)];
};

test('a new garage has a starter car and some money', () => {
  const g = newGarage();
  assert.equal(g.money, START_MONEY);
  assert.equal(current(g).model, 'pebble');
});

test('cleanGarage turns junk into a valid garage and clamps forged values', () => {
  assert.deepEqual(cleanGarage(null), newGarage());
  const forged = cleanGarage({ money: -50, cars: [{ model: 'vanta', up: { engine: 99, tires: 3 }, look: { paint: 999 } }, { model: 'tank' }], sel: 7 });
  assert.equal(forged.money, 0);
  assert.equal(forged.cars.length, 1);
  assert.equal(forged.cars[0].up.engine, 0, 'out-of-range level resets');
  assert.equal(forged.cars[0].up.tires, 3);
  assert.equal(forged.cars[0].look.paint, 0);
  assert.equal(forged.sel, 0);
});

test('tuner crate: pay by level; a win raises the chosen part, a bust only costs money', () => {
  const g = { ...newGarage(), money: 10_000 };
  const win = applyAction(g, { a: 'crate', kind: 'tuner', part: 'engine' }, dice(0.5), 0);
  assert.ok(win.ok);
  if (!win.ok) return;
  assert.equal(win.g.money, 10_000 - tunerCost(0));
  assert.equal(current(win.g).up.engine, 1);
  assert.deepEqual(win.crate, { kind: 'up', part: 'engine', levels: 1 });
  const bust = applyAction(win.g, { a: 'crate', kind: 'tuner', part: 'engine' }, dice(0.9), 0);
  assert.ok(bust.ok && bust.crate?.kind === 'bust' && current(bust.g).up.engine === 1 && bust.g.money === win.g.money - tunerCost(1));
  assert.equal(g.money, 10_000, 'the input garage is never mutated');
});

test('mystery crate outcomes: jackpot, double, single, scrap, bust', () => {
  const g = { ...newGarage(), money: 100_000 };
  const r = (roll: number) => applyAction(g, { a: 'crate', kind: 'mystery' }, dice(roll, 0), 0);
  const jackpot = r(0.01);
  assert.ok(jackpot.ok && jackpot.crate?.kind === 'jackpot');
  if (jackpot.ok) for (const p of PARTS) assert.equal(current(jackpot.g).up[p], 1);
  const two = r(0.1);
  assert.ok(two.ok && two.crate?.kind === 'up' && two.crate.levels === 2);
  const one = r(0.5);
  assert.ok(one.ok && one.crate?.kind === 'up' && one.crate.levels === 1);
  const scrap = r(0.8);
  assert.ok(scrap.ok && scrap.crate?.kind === 'scrap' && scrap.g.money === g.money - MYSTERY_COST + scrap.crate.refund);
  const bust = r(0.95);
  assert.ok(bust.ok && bust.crate?.kind === 'bust');
});

test('crates refuse when broke or maxed', () => {
  assert.deepEqual(applyAction({ ...newGarage(), money: 10 }, { a: 'crate', kind: 'mystery' }, Math.random, 0), { ok: false, error: 'Not enough money.' });
  const g = { ...newGarage(), money: 1e6 };
  for (const p of PARTS) g.cars[0].up[p] = MAX_LEVEL;
  assert.equal(applyAction(g, { a: 'crate', kind: 'mystery' }, Math.random, 0).ok, false);
});

test('buying, selecting, styling and selling cars', () => {
  let g = { ...newGarage(), money: 20_000 };
  assert.equal(applyAction(g, { a: 'buy', model: 'vanta' }, Math.random, 0).ok, false, 'too expensive');
  const bought = applyAction(g, { a: 'buy', model: 'kitsune', paint: 3 }, Math.random, 0);
  assert.ok(bought.ok);
  if (!bought.ok) return;
  g = bought.g;
  assert.equal(g.cars.length, 2);
  assert.equal(current(g).model, 'kitsune', 'a new car is selected');
  assert.equal(current(g).look.paint, 3);
  const styled = applyAction(g, { a: 'style', i: 1, look: { ...current(g).look, rims: 2 }, tune: { ...current(g).tune, ride: -5 } }, Math.random, 0);
  assert.ok(styled.ok && current(styled.g).look.rims === 2 && current(styled.g).tune.ride === -0.04, 'tuning is clamped');
  const sold = applyAction(g, { a: 'sell', i: 1 }, Math.random, 0);
  assert.ok(sold.ok && sold.g.cars.length === 1 && sold.g.sel === 0 && sold.paid! > 0);
  assert.equal(applyAction(newGarage(), { a: 'sell', i: 0 }, Math.random, 0).ok, false, "can't sell your only car");
});

test('payouts: winning pays most, bigger fields and longer roads pay more, solo pays less and is rate limited', () => {
  assert.ok(payout(1, 4, 'koripass', false) > payout(2, 4, 'koripass', false));
  assert.ok(payout(2, 4, 'koripass', false) > payout(0, 4, 'koripass', false));
  assert.ok(payout(1, 8, 'koripass', false) > payout(1, 2, 'koripass', false));
  assert.ok(payout(1, 4, 'koripass', false) > payout(1, 4, 'saltwind', false));
  assert.ok(payout(1, 4, 'koripass', true) < payout(1, 4, 'koripass', false));
  assert.ok(payout(1, 1, 'koripass', true) < payout(3, 4, 'koripass', true), 'winning alone is only a time trial');
  const first = applyAction(newGarage(), { a: 'solo', track: 'saltwind', place: 1, field: 6 }, Math.random, 1_000_000);
  assert.ok(first.ok && first.g.wins === 1 && first.g.money > START_MONEY);
  if (!first.ok) return;
  assert.equal(applyAction(first.g, { a: 'solo', track: 'saltwind', place: 1, field: 6 }, Math.random, 1_000_000 + SOLO_GAP_MS - 1).ok, false);
});

test('car codes round-trip and reject junk', () => {
  const c = newOwnedCar('shiro', 4);
  c.look.spoiler = 2;
  c.up.turbo = 3;
  const back = decodeCar(encodeCar(c));
  assert.ok(back);
  assert.deepEqual(back!.look, c.look);
  assert.deepEqual(back!.up, c.up);
  for (const bad of ['', 'tank.0.0.0.0.0.0.0.00000000', 'shiro.99.0.0.0.0.0.0.00000000', 'shiro.0.0.0.0.0.0.0.0000000', 'shiro.0.0.0.0.0.0.0.99999999']) assert.equal(decodeCar(bad), null, bad);
});

test('the server store keeps a garage per user and applies awards', async () => {
  const data = new Map<string, unknown>();
  const kv: KV = { get: async <T>(k: string) => data.get(k) as T | undefined, put: async (k, v) => void data.set(k, structuredClone(v)), delete: async (k) => data.delete(k) };
  const store = new GarageStore(kv, dice(0.5, 0), () => 0);
  assert.equal((await store.get('Mike')).money, START_MONEY);
  const r = await store.act('Mike', { a: 'crate', kind: 'tuner', part: 'tires' });
  assert.ok(r.ok);
  assert.equal(current(await store.get('mike')).up.tires, 1, 'usernames are case-insensitive');
  await store.award('MIKE', 2500, true);
  const g = await store.get('mike');
  assert.equal(g.money, START_MONEY - tunerCost(0) + 2500);
  assert.equal(g.wins, 1);
  assert.equal((await store.act('mike', { a: 'buy', model: 'vanta' })).ok, false);
});
