import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORDS, cleanBests, minTime, profileOf, recordTime } from '../../src/toge/shared/records.ts';
import { RecordStore } from '../../src/toge/server/recordStore.ts';
import { TRACK_LENGTH_KM, applyAction, newGarage } from '../../src/toge/shared/garage.ts';
import { decodeCar, encodeCar } from '../../src/toge/shared/cars.ts';
import { decodeRider } from '../../src/toge/shared/rider.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import type { TrackId } from '../../src/toge/shared/track.ts';
import type { KV } from '../../src/server/accountStore.ts';

const CAR = 'shiro.0.1.0.0.0.0.1.00000000';

function kv() {
  const data = new Map<string, unknown>();
  const store: KV = {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  return { data, store };
}

test('a best time is kept only when it beats the old one; the old one comes back as prev', () => {
  const first = recordTime({}, 'koripass', 200.12345, CAR, 1);
  assert.ok(first);
  assert.deepEqual(first.best, { track: 'koripass', time: 200.123, prev: null });
  assert.equal(first.bests.koripass?.car, CAR);
  assert.equal(recordTime(first.bests, 'koripass', 201, CAR, 2), null, 'slower');
  assert.equal(recordTime(first.bests, 'koripass', 200.123, CAR, 2), null, 'a tie is not a new best');
  const second = recordTime(first.bests, 'koripass', 190, CAR, 3);
  assert.deepEqual(second?.best, { track: 'koripass', time: 190, prev: 200.123 });
  assert.equal(second?.bests.koripass?.at, 3);
  // Other tracks are their own.
  assert.deepEqual(recordTime(second!.bests, 'monza', 300, CAR, 4)?.best.prev, null);
});

test('impossible times and unknown tracks are refused', () => {
  for (const id of Object.keys(TRACK_LENGTH_KM) as TrackId[]) {
    assert.ok(minTime(id) >= 30, `${id} floor is a real race`);
    assert.equal(recordTime({}, id, minTime(id) - 0.01, CAR, 0), null, `${id}: quicker than ${RECORDS.maxAvgSpeed} m/s average`);
    assert.ok(recordTime({}, id, minTime(id) + 0.01, CAR, 0));
  }
  for (const t of [NaN, Infinity, -5, 0, '200', null, undefined, RECORDS.maxTime + 1]) assert.equal(recordTime({}, 'koripass', t, CAR, 0), null, String(t));
  for (const track of ['nowhere', '__proto__', 'constructor', 7, null]) assert.equal(recordTime({}, track, 200, CAR, 0), null, String(track));
  // A junk car code is kept as unknown rather than stored.
  assert.equal(recordTime({}, 'koripass', 200, 'x'.repeat(500), 0)?.bests.koripass?.car, '');
});

test('stored bests are cleaned: bad tracks, times and cars drop out', () => {
  const b = cleanBests({ koripass: { time: 200, car: CAR, at: 5 }, monza: { time: 1, car: CAR, at: 5 }, nowhere: { time: 200 }, spa: 'fast', saltwind: { time: 150, car: 'nope', at: 'x' } });
  assert.deepEqual(Object.keys(b).sort(), ['koripass', 'saltwind']);
  assert.equal(b.saltwind?.car, '');
  assert.equal(b.saltwind?.at, 0);
  assert.deepEqual(cleanBests(null), {});
  assert.deepEqual(cleanBests([1, 2]), {});
});

test('RecordStore keeps one set of bests per account, case-insensitively', async () => {
  const { store, data } = kv();
  const r = new RecordStore(store, () => 42);
  assert.deepEqual(await r.record('Mike', 'koripass', 210, CAR), { track: 'koripass', time: 210, prev: null });
  assert.equal(await r.record('mike', 'koripass', 215, CAR), null);
  assert.deepEqual(await r.record('MIKE', 'koripass', 205, CAR), { track: 'koripass', time: 205, prev: 210 });
  assert.equal(await r.record('mike', 'koripass', 5, CAR), null, 'impossible');
  assert.deepEqual(await r.get('Mike'), { koripass: { time: 205, car: CAR, at: 42 } });
  assert.deepEqual([...data.keys()], ['b:mike']);
  assert.deepEqual(await r.get('nobody'), {});
});

test('a solo action carries its time but applyAction ignores it (the best is kept beside the garage)', () => {
  const g = newGarage();
  const r = applyAction(g, { a: 'solo', track: 'koripass', place: 1, field: 4, time: 200 }, Math.random, 1e9);
  assert.ok(r.ok);
  assert.equal(r.best, undefined);
});

test("a friend's profile shows cars, driver, record and bests, but not money", () => {
  const g = newGarage();
  const p = profileOf('Mike', { ...g, races: 7, wins: 3 }, { koripass: { time: 200, car: CAR, at: 1 } });
  assert.equal(p.name, 'Mike');
  assert.equal(p.races, 7);
  assert.equal(p.wins, 3);
  assert.deepEqual(p.cars, g.cars.map(encodeCar));
  assert.ok(decodeCar(p.cars[p.sel]));
  assert.ok(decodeRider(p.rider));
  assert.ok(!('money' in p));
  assert.equal(p.bests.koripass?.time, 200);
});

test('the race room tells the platform which track its results are for', () => {
  let now = 1_000_000;
  const got: { track: TrackId; times: (number | null)[] }[] = [];
  const race = new Race('BEST', () => {}, () => {}, (rows, _users, track) => got.push({ track, times: rows.map((r) => r.time) }), () => now, false);
  const join = (id: number): RaceClient => {
    const c: RaceClient = { id, ws: { readyState: 1, send: () => {} }, name: `p${id}`, car: CAR, rider: '', user: true };
    race.add(c);
    return c;
  };
  const a = join(1);
  race.handle(a, { t: 'track', track: 'saltwind' });
  race.handle(a, { t: 'start' });
  race.handle(a, { t: 'ready' });
  while (race.phase !== 'racing') (now += 50), race.tick();
  race.handle(a, { t: 'finish', time: 20 });
  assert.equal(got.length, 0, 'quicker than any real run: ignored');
  now += 160_000;
  race.handle(a, { t: 'finish', time: 160 });
  assert.equal(got.length, 1);
  assert.equal(got[0].track, 'saltwind');
  assert.equal(got[0].times[0], 160);
});

test('the room relays `records` to everyone', () => {
  const sent: string[] = [];
  const race = new Race('BEST', () => {}, () => {}, () => {}, () => 0, false);
  race.add({ id: 1, ws: { readyState: 1, send: (d: string) => sent.push(d) }, name: 'a', car: CAR, rider: '', user: true });
  race.announce({ t: 'records', rows: [{ id: 1, time: 200, prev: null }] });
  assert.deepEqual(JSON.parse(sent.at(-1)!), { t: 'records', rows: [{ id: 1, time: 200, prev: null }] });
});
