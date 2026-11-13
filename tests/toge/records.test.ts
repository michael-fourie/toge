import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARD, BOARD_TRACKS, NOTICES, RECORDS, cleanBests, cleanBoard, cleanNotices, medalTable, minTime, overtaken, placeOnBoard, profileOf, recordTime } from '../../src/toge/shared/records.ts';
import { RecordStore } from '../../src/toge/server/recordStore.ts';
import { TRACK_LENGTH_KM, applyAction, newGarage } from '../../src/toge/shared/garage.ts';
import { CAR_IDS, TUNE_RANGE, carSpec, decodeCar, encodeCar, maxedUpgrades, newOwnedCar, topSpeed } from '../../src/toge/shared/cars.ts';
import { aiDrive, newAi } from '../../src/toge/shared/driver.ts';
import { getTrack, gridSlot } from '../../src/toge/shared/track.ts';
import { type DriveInput, TICK_DT, newCar, stepCar } from '../../src/toge/shared/vehicle.ts';
import { decodeRider } from '../../src/toge/shared/rider.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import { type RaceMode, modeTracks, recordMode } from '../../src/toge/shared/protocol.ts';
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

test('the speed bound sits above every car flat out', () => {
  // No car can average more than its own top speed, so the bound has to clear the fastest one: every model, maxed, on
  // every final drive the tuner allows.
  for (const model of CAR_IDS) {
    const car = { ...newOwnedCar(model), up: maxedUpgrades() };
    for (let f = TUNE_RANGE.final.min; f <= TUNE_RANGE.final.max + 1e-9; f += TUNE_RANGE.final.step) {
      const v = topSpeed(carSpec({ ...car, tune: { ...car.tune, final: f } }));
      assert.ok(v < RECORDS.maxAvgSpeed * 0.95, `${model} at final ${f.toFixed(2)}: ${v.toFixed(1)} m/s`);
    }
  }
});

test('a maxed Vanta run flat out on the fast highways keeps its time', () => {
  // The 'Maxed Vanta' time trial on Sea-to-Sky ran 62.0 s flat out, under the old 63.6 s floor (90 m/s average), so
  // no best was ever saved there. Hayate and Ryusei were the same.
  for (const id of ['seatosky', 'hayate', 'ryusei'] as TrackId[]) {
    const t = getTrack(id);
    const g = gridSlot(t, 0);
    const sp = carSpec({ ...newOwnedCar('vanta'), up: maxedUpgrades() });
    const car = newCar(sp, g.x, g.y, g.z, g.yaw);
    const ai = newAi(1, 0);
    const inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    let time = 0;
    for (; car.s < t.finishS && time < 300; time += TICK_DT) {
      aiDrive(car, t, ai, TICK_DT, inp);
      inp.throttle = 1;
      inp.brake = 0;
      stepCar(car, inp, t);
    }
    assert.ok(car.s >= t.finishS, `${id}: didn't finish`);
    assert.ok(recordTime({}, id, time, CAR, 0), `${id}: ${time.toFixed(2)} s refused (floor ${minTime(id).toFixed(2)} s)`);
  }
});

test('impossible times and unknown tracks are refused', () => {
  for (const id of Object.keys(TRACK_LENGTH_KM) as TrackId[]) {
    assert.ok(minTime(id) >= 20, `${id} floor is a real race`);
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
  assert.deepEqual(await r.record('Mike', 'koripass', 210, CAR), { track: 'koripass', time: 210, prev: null, rank: 1, beat: null });
  assert.equal(await r.record('mike', 'koripass', 215, CAR), null);
  assert.deepEqual(await r.record('MIKE', 'koripass', 205, CAR), { track: 'koripass', time: 205, prev: 210, rank: 1, beat: { name: 'Mike', time: 210 } });
  assert.equal(await r.record('mike', 'koripass', 5, CAR), null, 'impossible');
  assert.deepEqual(await r.get('Mike'), { koripass: { time: 205, car: CAR, at: 42 } });
  assert.deepEqual([...data.keys()].sort(), ['b:mike', 'lb:koripass']);
  assert.deepEqual(await r.get('nobody'), {});
});

test('only item-free modes keep best times: a time trial and a hill climb, never a race (solo runs are races)', () => {
  assert.equal(recordMode('trial'), true);
  assert.equal(recordMode('climb'), true);
  assert.equal(recordMode('race'), false);
});

test('a solo finish pays but carries no time, so it never sets a best', () => {
  const r = applyAction(newGarage(), { a: 'solo', track: 'koripass', place: 1, field: 4 }, Math.random, 1e9);
  assert.ok(r.ok);
  assert.ok(!('best' in r));
});

test('clearing tracks previews first, then wipes bests, board rows and ghosts on those tracks only', async () => {
  const { store, data } = kv();
  const r = new RecordStore(store, () => 42);
  await r.record('Ann', 'koripass', 200, CAR, { car: CAR, rider: '', d: [] });
  await r.record('Ann', 'karasu', 300, CAR);
  await r.record('Bob', 'koripass', 210, CAR);
  await r.record('Bob', 'monza', 400, CAR);
  data.set('gh:koripass', { name: 'Ann', time: 200, car: CAR, rider: '', d: [] });
  const before = structuredClone([...data.entries()]);
  const preview = await r.clear(['koripass', 'monza'], ['ann', 'bob', 'cy'], false);
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.bests, [{ user: 'ann', tracks: ['koripass'] }, { user: 'bob', tracks: ['koripass', 'monza'] }]);
  assert.deepEqual(preview.boards.koripass, { rows: 2, record: { name: 'Ann', time: 200 } });
  assert.deepEqual(preview.ghosts, ['koripass']);
  assert.deepEqual([...data.entries()], before, 'a preview changes nothing');
  const done = await r.clear(['koripass', 'monza'], ['ann', 'bob'], true);
  assert.equal(done.applied, true);
  assert.deepEqual(await r.get('Ann'), { karasu: { time: 300, car: CAR, at: 42 } }, 'other tracks are kept');
  assert.equal(data.has('b:bob'), false, 'a racer with nothing left has no entry');
  assert.deepEqual(await r.board('koripass'), []);
  assert.deepEqual(await r.board('monza'), []);
  assert.equal((await r.board('karasu')).length, 1);
  assert.equal(data.has('gh:koripass'), false);
  // A fresh time trial best goes straight back on.
  assert.equal((await r.record('Bob', 'koripass', 230, CAR))?.rank, 1);
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
  const got: { track: TrackId; mode: RaceMode; times: (number | null)[] }[] = [];
  const race = new Race('BEST', () => {}, () => {}, (rows, _users, track, _tapes, mode) => got.push({ track, mode, times: rows.map((r) => r.time) }), () => now, false);
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
  assert.equal(got[0].mode, 'race', 'a race: the platform keeps no best from it');
  assert.equal(got[0].times[0], 160);
});

test('the room relays `records` to everyone', () => {
  const sent: string[] = [];
  const race = new Race('BEST', () => {}, () => {}, () => {}, () => 0, false);
  race.add({ id: 1, ws: { readyState: 1, send: (d: string) => sent.push(d) }, name: 'a', car: CAR, rider: '', user: true });
  const row = { id: 1, time: 200, prev: null, rank: 1, beat: { name: 'b', time: 201 } };
  race.announce({ t: 'records', rows: [row] });
  assert.deepEqual(JSON.parse(sent.at(-1)!), { t: 'records', rows: [row] });
});

const row = (name: string, time: number, at = 0) => ({ name, time, car: CAR, at });

test('a board keeps one row per racer, quickest first, and says where a new best landed', () => {
  let b = placeOnBoard([], row('Ann', 200, 1));
  assert.deepEqual([b.rank, b.beat], [1, null], 'first time on the board: the record, nothing beaten');
  b = placeOnBoard(b.board, row('Bob', 210, 2));
  assert.deepEqual([b.rank, b.beat], [2, null]);
  b = placeOnBoard(b.board, row('bob', 195, 3));
  assert.deepEqual([b.rank, b.beat], [1, { name: 'Ann', time: 200 }], 'Bob takes the record');
  assert.deepEqual(b.board.map((r) => [r.name, r.time]), [['bob', 195], ['Ann', 200]], 'his old row is replaced, not added');
  b = placeOnBoard(b.board, row('Cy', 200, 4));
  assert.equal(b.rank, 3, 'a tie goes to whoever set it first');
  b = placeOnBoard(b.board, row('ANN', 190, 5));
  assert.deepEqual([b.rank, b.beat], [1, { name: 'bob', time: 195 }]);
  b = placeOnBoard(b.board, row('ann', 189, 6));
  assert.deepEqual(b.beat, { name: 'ANN', time: 190 }, 'beating your own record is still a new record');
  // A slower time than the racer's row changes nothing.
  const same = placeOnBoard(b.board, row('Cy', 260, 7));
  assert.equal(same.board, b.board);
  assert.equal(same.rank, 3);
});

test('a full board drops its slowest; a finish too slow for it gets no rank', () => {
  let board = Array.from({ length: BOARD.size }, (_, i) => row(`r${i}`, 200 + i));
  const slow = placeOnBoard(board, row('late', 900));
  assert.equal(slow.rank, null);
  assert.equal(slow.board.length, BOARD.size);
  board = placeOnBoard(board, row('quick', 150)).board;
  assert.equal(board.length, BOARD.size);
  assert.equal(board[0].name, 'quick');
  assert.ok(!board.some((r) => r.name === `r${BOARD.size - 1}`));
});

test('the Leaderboard lists only playable tracks: every track you can time-trial from the Race page, no hill climb, arena or open world', () => {
  assert.ok(!BOARD_TRACKS.includes('karasu'), 'Karasu Peak (2026-11-13, Andrew: "isn\'t available")');
  assert.ok(!BOARD_TRACKS.includes('shura'), 'a battle royale keeps no times');
  assert.ok(!BOARD_TRACKS.includes('toge'));
  assert.deepEqual(BOARD_TRACKS, modeTracks('trial'), 'exactly the time trial\'s tracks');
});

test('stored boards are cleaned: bad rows, duplicates and impossible times drop out', () => {
  const b = cleanBoard('koripass', [row('Ann', 210), row('ann', 200), row('Bob', 5), { name: 7, time: 220 }, row('', 230), 'x', row('Cy', 205)]);
  assert.deepEqual(b.map((r) => [r.name, r.time]), [['ann', 200], ['Cy', 205]]);
  assert.deepEqual(cleanBoard('koripass', { not: 'a list' }), []);
});

test("RecordStore keeps each track's board beside the bests, and can rebuild them from bests", async () => {
  const { store } = kv();
  const r = new RecordStore(store, () => 9);
  await r.record('Ann', 'koripass', 200, CAR);
  assert.equal((await r.record('Bob', 'koripass', 190, CAR))?.rank, 1);
  assert.equal((await r.record('Cy', 'koripass', 195, CAR))?.rank, 2);
  assert.equal((await r.record('Cy', 'saltwind', 150, CAR))?.rank, 1);
  assert.deepEqual((await r.board('koripass')).map((x) => x.name), ['Bob', 'Cy', 'Ann']);
  const { leaders, medals } = await r.leaders();
  assert.deepEqual(Object.fromEntries(Object.entries(leaders).map(([t, x]) => [t, x!.name])), { koripass: 'Bob', saltwind: 'Cy' });
  // Cy: 1st on Saltwind and 2nd on Kōri; Bob 1st on Kōri; Ann 3rd on Kōri.
  assert.deepEqual(medals.map((m) => [m.name, m.gold, m.silver, m.bronze]), [['Cy', 1, 1, 0], ['Bob', 1, 0, 0], ['Ann', 0, 0, 1]]);
  assert.deepEqual(await r.board('nowhere'), []);
  // A board the Leaderboard doesn't list (the hill climb) is kept but neither listed nor counted for medals.
  await r.record('Dee', 'karasu', 300, CAR);
  assert.equal((await r.board('karasu'))[0]?.name, 'Dee', 'still stored');
  const after = await r.leaders();
  assert.equal(after.leaders.karasu, undefined);
  assert.ok(!after.medals.some((m) => m.name === 'Dee'));

  const fresh = new RecordStore(kv().store);
  await fresh.rebuild([
    { name: 'Ann', bests: { koripass: { time: 200, car: CAR, at: 1 } } },
    { name: 'Bob', bests: { koripass: { time: 190, car: CAR, at: 2 }, monza: { time: 300, car: CAR, at: 2 } } },
  ]);
  assert.deepEqual((await fresh.board('koripass')).map((x) => x.name), ['Bob', 'Ann']);
  assert.equal((await fresh.board('monza'))[0]?.time, 300);
  assert.equal((await fresh.record('Ann', 'koripass', 195, CAR))?.rank, 1 + 1, 'quicker than her old time, still behind Bob');
});

test('the medal table counts every board\'s top three and ranks golds, then silvers, then bronzes', () => {
  const boards = [
    [row('Demon', 100), row('Ann', 101), row('Bob', 102), row('Cy', 103)],
    [row('demon', 90), row('Bob', 91)],
    [row('Ann', 80), row('Demon', 81), row('Cy', 82)],
    [row('Cy', 70)],
    [],
  ];
  const m = medalTable(boards);
  assert.deepEqual(
    m.map((r) => [r.name, r.gold, r.silver, r.bronze]),
    [
      ['Demon', 2, 1, 0],
      ['Ann', 1, 1, 0],
      ['Cy', 1, 0, 1],
      ['Bob', 0, 1, 1],
    ],
    'one row per racer whatever the case of their name; 4th place earns nothing',
  );
  assert.deepEqual(medalTable([]), []);
});

test('a new best tells everyone it passed: their old and new places, or that they fell off the board', () => {
  const before = [row('Ann', 100), row('Bob', 101), row('Cy', 102), row('Dee', 103)];
  // Cy goes quickest: Ann and Bob each drop a place; Dee (behind Cy all along) doesn't move.
  const after = placeOnBoard(before, row('Cy', 99, 5)).board;
  assert.deepEqual(overtaken(before, after, 'cy'), [
    { name: 'Ann', yours: 100, was: 1, rank: 2 },
    { name: 'Bob', yours: 101, was: 2, rank: 3 },
  ]);
  // A slower improvement that passes nobody tells nobody.
  assert.deepEqual(overtaken(before, placeOnBoard(before, row('Dee', 102.5, 5)).board, 'Dee'), []);
  // A full board: the last row falls off.
  const full = Array.from({ length: BOARD.size }, (_, i) => row(`R${i}`, 100 + i));
  const pushed = overtaken(full, placeOnBoard(full, row('New', 50, 5)).board, 'New');
  assert.equal(pushed.length, BOARD.size);
  assert.deepEqual(pushed.at(-1), { name: `R${BOARD.size - 1}`, yours: 100 + BOARD.size - 1, was: BOARD.size, rank: null });
});

test('RecordStore keeps a notice for each racer a new best passes, newest first, until they have seen it', async () => {
  const { store } = kv();
  let now = 1000;
  const r = new RecordStore(store, () => now);
  await r.record('Andrew', 'shiden', 120, CAR);
  await r.record('Bob', 'shiden', 125, CAR);
  assert.deepEqual(await r.notices('andrew'), [], 'nobody passed yet');
  now = 2000;
  await r.record('Demon', 'shiden', 118, CAR);
  const a = await r.notices('Andrew');
  assert.deepEqual(a, [{ track: 'shiden', by: 'Demon', time: 118, yours: 120, was: 1, rank: 2, at: 2000 }], 'Andrew lost the record');
  assert.deepEqual((await r.notices('Bob')).map((n) => [n.was, n.rank]), [[2, 3]]);
  assert.deepEqual(await r.notices('Demon'), [], 'never about yourself');
  now = 3000;
  await r.record('Demon', 'isonami', 130, CAR);
  await r.record('Andrew', 'isonami', 129, CAR);
  assert.deepEqual((await r.notices('Demon')).map((n) => [n.track, n.by]), [['isonami', 'Andrew']]);
  // Seen up to a point: later notices stay.
  now = 4000;
  await r.record('Cy', 'shiden', 117, CAR);
  assert.deepEqual((await r.notices('Andrew')).map((n) => n.at), [4000, 2000], 'newest first');
  await r.seen('Andrew', 2000);
  assert.deepEqual((await r.notices('Andrew')).map((n) => n.at), [4000]);
  await r.seen('Andrew', 4000);
  assert.deepEqual(await r.notices('Andrew'), []);
  // Kept to NOTICES.keep.
  for (let i = 0; i < NOTICES.keep + 5; i++) {
    now = 10_000 + i;
    await r.record(`P${i}`, 'nagare', 200 - i, CAR);
  }
  assert.equal((await r.notices('P0')).length, NOTICES.keep);
  assert.equal((await r.notices('P0'))[0].at, 10_000 + NOTICES.keep + 4, 'the newest kept');
});

test('stored notices are cleaned: bad entries drop out', () => {
  const ok = { track: 'shiden', by: 'Demon', time: 118, yours: 120, was: 1, rank: 2, at: 5 };
  assert.deepEqual(cleanNotices([ok, { ...ok, track: 'nowhere' }, { ...ok, by: '' }, { ...ok, time: NaN }, { ...ok, rank: null, at: 6 }, 'x']).map((n) => n.at), [6, 5]);
  assert.deepEqual(cleanNotices({ not: 'a list' }), []);
});
