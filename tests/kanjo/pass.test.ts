import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COS_CASES, COS_ITEMS, caseItems, cosById, passOnly } from '../../src/kanjo/shared/cosmetics.ts';
import { type Garage, applyAction, award, cleanGarage, newGarage, ownedRider } from '../../src/kanjo/shared/garage.ts';
import { DEFAULT_LOOK, GEAR, PASS_METALS, decodeLook, encodeLook } from '../../src/kanjo/shared/look.ts';
import { BG_IDS, PASS, TIERS, TITLES, XP, raceXp, tierFor, tierOf, tierProgress } from '../../src/kanjo/shared/pass.ts';
import type { KV } from '../../src/server/accountStore.ts';
import { GarageStore } from '../../src/kanjo/server/garageStore.ts';

const memoryKv = (): KV => {
  const data = new Map<string, unknown>();
  return { get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, put: async (k, v) => void data.set(k, structuredClone(v)), delete: async (k) => data.delete(k) };
};
const act = (g: Garage, a: Parameters<typeof applyAction>[1]) => applyAction(g, a, Math.random, 1e12);
const ok = (g: Garage, a: Parameters<typeof applyAction>[1]): Garage => {
  const r = act(g, a);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.g;
};
const xpFor = (tier: number) => tier * PASS.perTier;

test('50 tiers, one reward each, every one of them a pass exclusive', () => {
  assert.equal(TIERS.length, PASS.tiers);
  assert.equal(PASS.tiers, 50);
  assert.equal(PASS.price, 50_000);
  const keys = TIERS.map((r) => ('id' in r ? `${r.kind}:${r.id}` : null)).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, 'no reward twice');
  for (const r of TIERS) {
    if (r.kind === 'cos') {
      const it = cosById(r.id);
      assert.ok(it, r.id);
      assert.ok(passOnly(it!), `${r.id} drops from no case`);
      for (const c of COS_CASES) assert.ok(!caseItems(c.id).includes(it!), `${r.id} not in the ${c.id} case`);
    }
  }
  // Every exclusive is in the pass, and every background, title, pass metal and gear piece is too.
  for (const it of COS_ITEMS.filter(passOnly)) assert.ok(tierFor('cos', it.id) > 0, `${it.id} is a tier`);
  for (const id of BG_IDS) assert.ok(tierFor('bg', id) > 0, id);
  for (const id of Object.keys(TITLES)) assert.ok(tierFor('title', id) > 0, id);
  for (const id of PASS_METALS) assert.ok(tierFor('metal', id) > 0, id);
  for (const id of GEAR) assert.ok(tierFor('gear', id) > 0, id);
  const kinds = new Set(TIERS.map((r) => r.kind));
  for (const k of ['cos', 'bg', 'metal', 'gear', 'title', 'money']) assert.ok(kinds.has(k as never), k);
});

test('race XP: finishing, beating cars, winning, drifting; solo earns a share', () => {
  assert.equal(raceXp(1, 8, 0, false), XP.finish + 7 * XP.perBeaten + XP.win);
  assert.equal(raceXp(8, 8, 0, false), XP.finish);
  assert.equal(raceXp(0, 8, 0, false), XP.dnf);
  assert.equal(raceXp(1, 1, 0, false), XP.finish, 'alone: no win bonus');
  assert.equal(raceXp(3, 4, 1e9, false), XP.finish + XP.perBeaten + XP.driftMax, 'drift XP is capped');
  assert.equal(raceXp(1, 6, 0, true), Math.round((XP.finish + 5 * XP.perBeaten + XP.win) * XP.soloShare));
  assert.equal(raceXp(-3, NaN, -5, false), XP.dnf, 'junk is a DNF');
  assert.equal(tierOf(xpFor(3) - 1), 2);
  assert.equal(tierOf(xpFor(99)), PASS.tiers);
  assert.deepEqual(tierProgress(xpFor(4) + 120), { tier: 4, into: 120, need: PASS.perTier });
});

test('XP counts before the pass; buying it hands over every tier reached', () => {
  let g = { ...newGarage(), money: 60_000 };
  g = award(g, 0, false, xpFor(12));
  assert.equal(g.xp, xpFor(12));
  assert.equal(tierOf(g.xp), 12);
  assert.equal(g.given, 0, 'nothing handed over without the pass');
  assert.ok(!g.cos.includes('ds_season'));
  // Can't use a reached reward yet.
  assert.ok(!act(g, { a: 'bg', id: 'dusk' }).ok);
  assert.ok(!act(g, { a: 'equip', i: 0, slot: 'decal', id: 'ds_season' }).ok);
  const poor = act({ ...g, money: PASS.price - 1 }, { a: 'pass' });
  assert.ok(!poor.ok && /money/.test(poor.error));
  g = ok(g, { a: 'pass' });
  assert.ok(g.pass);
  assert.equal(g.given, 12);
  // Money tiers 2 and 9 paid back on top of the change.
  assert.equal(g.money, 60_000 - PASS.price + 2500 + 2500);
  for (const id of ['ds_season', 'cs_vermilion', 'gs_torii', 'fs_gold', 'ps_torii']) assert.ok(g.cos.includes(id), id);
  assert.ok(!g.cos.includes('rs_foxgold'), 'tier 13 not yet');
  assert.ok(!act(g, { a: 'pass' }).ok, 'only once');
  // Now usable.
  g = ok(g, { a: 'bg', id: 'dusk' });
  assert.equal(g.bg, 'dusk');
  assert.ok(!act(g, { a: 'bg', id: 'vault' }).ok, 'tier 48 still locked');
  g = ok(g, { a: 'title', id: 'runner' });
  g = ok(g, { a: 'equip', i: 0, slot: 'decal', id: 'ds_season' });
  // More races, more tiers, handed over as they come (each once).
  const before = g.money;
  g = award(g, 0, false, xpFor(2));
  assert.equal(g.given, 14);
  assert.ok(g.cos.includes('rs_foxgold'));
  assert.equal(g.money, before + 2500, 'tier 14 pays');
  g = award(g, 0, false, xpFor(500));
  assert.equal(tierOf(g.xp), 50);
  assert.equal(g.given, 50);
  assert.ok(g.cos.includes('ps_kitsunerun'));
});

test('driver pieces: locked until unlocked, stripped from what others see', () => {
  const halo = encodeLook({ ...DEFAULT_LOOK, gear: ['halo'], metal: 'gold' });
  let g = { ...newGarage(), money: PASS.price };
  const r = act(g, { a: 'rider', rider: halo, look: halo });
  assert.ok(!r.ok && /battle pass/.test(r.error));
  assert.equal(decodeLook(ownedRider(g, halo))!.gear.length, 0);
  assert.equal(decodeLook(ownedRider(g, halo))!.metal, 'brass');
  g = ok(award(g, 0, false, xpFor(45)), { a: 'pass' });
  g = ok(g, { a: 'rider', rider: halo, look: halo });
  assert.equal(g.rider, halo);
  assert.equal(ownedRider(g, halo), halo);
});

test('look codes: gear travels as an optional last field; codes without it still read', () => {
  const plain = encodeLook(DEFAULT_LOOK);
  assert.equal(plain.split('.').length, 18, 'no gear, no field for it');
  assert.deepEqual(decodeLook(plain), DEFAULT_LOOK);
  const geared = { ...DEFAULT_LOOK, gear: [...GEAR], metal: 'prism' as const };
  assert.deepEqual(decodeLook(encodeLook(geared)), geared);
  assert.equal(decodeLook(plain + '.z'), null, 'junk gear');
  assert.equal(decodeLook(plain + '.0-0'), null, 'gear twice');
});

test('a stored garage keeps only what its pass has unlocked', () => {
  const g = cleanGarage({ ...newGarage(), xp: xpFor(5), pass: false, given: 5, cos: ['ds_season', 'p_lime'], bg: 'dusk', title: 'runner' });
  assert.deepEqual(g.cos, ['p_lime']);
  assert.equal(g.given, 0);
  assert.equal(g.bg, '');
  assert.equal(g.title, '');
  const h = cleanGarage({ ...newGarage(), xp: xpFor(5), pass: true, given: 99, cos: ['ds_season', 'ps_kitsunerun'], bg: 'dusk', title: 'apex' });
  assert.deepEqual(h.cos, ['ds_season']);
  assert.equal(h.given, 5);
  assert.equal(h.bg, 'dusk');
  assert.equal(h.title, '', 'apex is tier 17');
  // Old saves (no pass fields) load as no XP, no pass.
  const old = cleanGarage({ money: 10, cars: [] });
  assert.equal(old.xp, 0);
  assert.equal(old.pass, false);
});

test('GarageStore: a race pays XP on the server; raceRider strips locked pieces', async () => {
  const kv = memoryKv();
  const store = new GarageStore(kv, Math.random, () => 1e12);
  await kv.put('g:ann', { ...newGarage(), money: PASS.price });
  await store.award('ann', 1000, true, raceXp(1, 8, 0, false));
  let g = await store.get('ann');
  assert.equal(g.xp, raceXp(1, 8, 0, false));
  assert.equal(g.races, 1);
  const r = await store.act('ann', { a: 'pass' });
  assert.ok(r.ok);
  g = await store.get('ann');
  assert.ok(g.pass);
  const visor = encodeLook({ ...DEFAULT_LOOK, gear: ['visor'] });
  assert.equal(decodeLook(await store.raceRider('ann', visor))!.gear.length, 0, 'tier 34 not reached');
  await store.award('ann', 0, false, xpFor(40));
  assert.equal(await store.raceRider('ann', visor), visor);
  // The solo action earns XP too (once per prize).
  const s = await store.act('ann', { a: 'solo', track: 'koripass', place: 1, field: 6 });
  assert.ok(s.ok && s.xp === raceXp(1, 6, 0, true));
});
