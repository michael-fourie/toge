import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIDER_CODE_MAX, RIDER_IDS, RIDERS, cleanRider, cleanRiderCode, decodeRider, defaultRider, encodeRider, rivalRider } from '../../src/toge/shared/rider.ts';
import { applyAction, cleanGarage, newGarage } from '../../src/toge/shared/garage.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import type { RaceServerMsg } from '../../src/toge/shared/protocol.ts';

test('every driver has a card, and codes round-trip', () => {
  for (const id of RIDER_IDS) {
    assert.equal(RIDERS[id].id, id);
    assert.ok(RIDERS[id].name && RIDERS[id].nick && RIDERS[id].bio, id);
    assert.ok(encodeRider(id).length <= RIDER_CODE_MAX);
    assert.equal(decodeRider(encodeRider(id)), id);
  }
});

test('bad codes are refused; anything else on the wire becomes the default driver', () => {
  for (const bad of ['', 'x', 'r1.000', 'MARLOWE', null, undefined]) assert.equal(decodeRider(bad as string), null, String(bad));
  assert.equal(cleanRiderCode('junk'), defaultRider());
  assert.equal(cleanRiderCode(42), defaultRider());
  assert.equal(cleanRiderCode('ines'), 'ines');
});

test('saves from the old customisable drivers get the default', () => {
  assert.equal(cleanRider({ hair: 5, top: 2 }), defaultRider());
  assert.equal(cleanRider('kirika'), 'kirika');
  assert.equal(cleanGarage({ rider: { hair: 3 } }).rider, defaultRider());
});

test('rivals get every driver but yours, in turn', () => {
  for (const mine of RIDER_IDS) {
    const picks = [0, 1, 2, 3, 4, 5, 6].map((i) => rivalRider(mine, i));
    assert.ok(!picks.includes(mine));
    assert.equal(new Set(picks.slice(0, 3)).size, 3);
  }
});

test('the garage keeps your driver; changing it is free', () => {
  const g = newGarage();
  assert.equal(g.rider, defaultRider());
  assert.equal(cleanGarage({}).rider, defaultRider(), 'old saves get the default driver');
  const res = applyAction(g, { a: 'rider', rider: 'okonkwo' }, Math.random, 0);
  assert.ok(res.ok);
  assert.equal(res.g.rider, 'okonkwo');
  assert.equal(res.g.money, g.money);
  assert.equal(cleanGarage(JSON.parse(JSON.stringify(res.g))).rider, 'okonkwo', 'survives a save');
  const junk = applyAction(g, { a: 'rider', rider: 'nobody' as never }, Math.random, 0);
  assert.ok(junk.ok && junk.g.rider === defaultRider());
});

test('the race room shows everyone their crew and relays changes in the lobby', () => {
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('ABCD', () => {}, () => {}, () => {}, () => 0, false);
  const join = (id: number, rider: string): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider, user: false };
    race.add(c);
    return c;
  };
  const room = (id: number) => inbox.get(id)!.filter((m) => m.t === 'room').at(-1) as Extract<RaceServerMsg, { t: 'room' }>;
  join(1, 'ines');
  const b = join(2, 'not a rider');
  assert.equal(room(1).racers.find((r) => r.id === 1)!.rider, 'ines');
  assert.equal(room(1).racers.find((r) => r.id === 2)!.rider, defaultRider(), 'a bad code becomes the default driver');
  race.handle(b, { t: 'rider', rider: 'kirika' });
  assert.equal(room(1).racers.find((r) => r.id === 2)!.rider, 'kirika');
  const before = inbox.get(1)!.length;
  race.handle(b, { t: 'rider', rider: 'kirika' });
  assert.equal(inbox.get(1)!.length, before, 'no broadcast when nothing changed');
});
