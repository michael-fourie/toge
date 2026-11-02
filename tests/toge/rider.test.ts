import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIDER_CODE_MAX, RIDER_FIELDS, cleanRider, cleanRiderCode, decodeRider, defaultRider, encodeRider, randomRider } from '../../src/toge/shared/rider.ts';
import { applyAction, cleanGarage, newGarage } from '../../src/toge/shared/garage.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import type { RaceServerMsg } from '../../src/toge/shared/protocol.ts';

test('every field fits one base-36 digit, and codes round-trip', () => {
  for (const f of RIDER_FIELDS) assert.ok(f.options.length >= 2 && f.options.length <= 36, f.key);
  for (const f of RIDER_FIELDS) if (f.colors) assert.equal(f.colors.length, f.options.length, `${f.key}: a colour per name`);
  for (const f of RIDER_FIELDS) if (f.needs) assert.ok(RIDER_FIELDS.some((g) => g.key === f.needs), f.key);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const r = randomRider(rnd);
    const code = encodeRider(r);
    assert.ok(code.length <= RIDER_CODE_MAX);
    assert.deepEqual(decodeRider(code), r);
  }
});

test('bad codes are refused; codes from before a field was added still decode', () => {
  for (const bad of ['', 'r2.000', 'x', 'r1.' + 'z'.repeat(RIDER_FIELDS.length), 'r1.' + '0'.repeat(RIDER_FIELDS.length + 1), 'r1.0-0', null, undefined]) assert.equal(decodeRider(bad as string), null, String(bad));
  const short = encodeRider(defaultRider()).slice(0, -2);
  const r = decodeRider(short);
  assert.ok(r);
  assert.equal(r[RIDER_FIELDS.at(-1)!.key], 0, 'a missing field takes 0');
  assert.equal(cleanRiderCode('junk'), encodeRider(defaultRider()));
  assert.equal(cleanRiderCode(42), encodeRider(defaultRider()));
});

test('cleanRider keeps good values and resets the rest', () => {
  const r = cleanRider({ hair: 5, top: 99, skin: -1, pose: 2.5, extra: 1 });
  assert.equal(r.hair, 5);
  assert.equal(r.top, defaultRider().top);
  assert.equal(r.skin, defaultRider().skin);
  assert.equal(r.pose, defaultRider().pose);
  assert.ok(!('extra' in r));
});

test('the garage keeps your driver; changing it is free', () => {
  const g = newGarage();
  assert.deepEqual(g.rider, defaultRider());
  assert.deepEqual(cleanGarage({}).rider, defaultRider(), 'old saves get the default driver');
  const want = { ...defaultRider(), hair: 8, top: 5, emblem: 6 };
  const res = applyAction(g, { a: 'rider', rider: want }, Math.random, 0);
  assert.ok(res.ok);
  assert.deepEqual(res.g.rider, want);
  assert.equal(res.g.money, g.money);
  assert.deepEqual(cleanGarage(JSON.parse(JSON.stringify(res.g))).rider, want, 'survives a save');
  const junk = applyAction(g, { a: 'rider', rider: { hair: 'x' } as never }, Math.random, 0);
  assert.ok(junk.ok && junk.g.rider.hair === defaultRider().hair);
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
  const mine = encodeRider({ ...defaultRider(), hair: 7 });
  join(1, mine);
  const b = join(2, 'not a rider');
  assert.equal(room(1).racers.find((r) => r.id === 1)!.rider, mine);
  assert.equal(room(1).racers.find((r) => r.id === 2)!.rider, encodeRider(defaultRider()), 'a bad code becomes the default driver');
  const next = encodeRider({ ...defaultRider(), top: 5 });
  race.handle(b, { t: 'rider', rider: next });
  assert.equal(room(1).racers.find((r) => r.id === 2)!.rider, next);
  const before = inbox.get(1)!.length;
  race.handle(b, { t: 'rider', rider: next });
  assert.equal(inbox.get(1)!.length, before, 'no broadcast when nothing changed');
});
