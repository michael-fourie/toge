import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import { RACE, type RaceServerMsg, type ResultRow } from '../../src/toge/shared/protocol.ts';
import { payout } from '../../src/toge/shared/garage.ts';
import { MAX_LEVEL, PARTS, decodeCar, defaultTune, myRaceCar, newOwnedCar, raceCars } from '../../src/toge/shared/cars.ts';

/** A race room with fake sockets and a hand-wound clock. */
function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const paid: { rows: ResultRow[]; users: Set<number> }[] = [];
  let empty = false;
  const race = new Race('ABCD', () => {}, () => (empty = true), (rows, users) => paid.push({ rows, users }), () => now, false);
  const join = (id: number, user = false): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  const last = (id: number, t: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === t).at(-1);
  /** The host (first) starts and every racer listed finishes loading straight away. */
  const start = (...cs: RaceClient[]) => {
    race.handle(cs[0], { t: 'start' });
    for (const c of cs) race.handle(c, { t: 'ready' });
  };
  return { race, join, advance, last, start, inbox, paid, isEmpty: () => empty };
}

const pose = (s: number) => ({ t: 'state' as const, p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, -30] as [number, number, number], w: 0, s, st: 0, ws: 80, rpm: 5000, f: 0 });

test('the first player hosts; only the host picks the track and starts', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  assert.equal(r.race.hostId, 1);
  r.race.handle(b, { t: 'track', track: 'saltwind' });
  assert.equal(r.race.track, 'koripass');
  r.race.handle(a, { t: 'track', track: 'saltwind' });
  assert.equal(r.race.track, 'saltwind');
  r.race.handle(b, { t: 'start' });
  assert.equal(r.race.phase, 'lobby');
  r.race.handle(a, { t: 'start' });
  assert.equal(r.race.phase, 'loading');
  const ld = r.last(2, 'load');
  assert.ok(ld && ld.t === 'load' && ld.track === 'saltwind' && ld.grid[1] === 0 && ld.grid[2] === 1);
});

test('countdown, go, relayed poses, finishes ranked by time, prizes, then back to the lobby', () => {
  const r = room();
  const a = r.join(1, true);
  const b = r.join(2);
  const c = r.join(3);
  r.start(a, b, c);
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
  assert.ok(r.last(1, 'go'));
  // Poses are relayed the moment they arrive, to everyone but the sender.
  const before = r.inbox.get(3)!.length;
  r.race.handle(a, pose(100));
  r.race.handle(b, pose(90));
  const relayed = r.inbox.get(3)!.slice(before).filter((m) => m.t === 'snap');
  assert.deepEqual(relayed.map((m) => m.t === 'snap' && m.cars[0].id), [1, 2]);
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'snap' && m.cars.some((x) => x.id === 1)), 'nobody hears their own car');
  // Junk poses are dropped.
  r.race.handle(c, { ...pose(1), p: [NaN, 0, 0] });
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'snap' && m.cars.some((x) => x.id === 3)));
  // Attack items are relayed to the others, not back to the user.
  r.race.handle(a, { t: 'item', kind: 'oil', p: [1, 2, 3] });
  assert.deepEqual(r.last(2, 'item'), { t: 'item', by: 1, kind: 'oil', p: [1, 2, 3] });
  assert.ok(!r.last(1, 'item'));
  r.race.handle(b, { t: 'item', kind: 'oil', p: [NaN, 0, 0] });
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'item'), 'junk is dropped');
  // Ping is answered.
  r.race.handle(a, { t: 'ping', n: 7 });
  assert.deepEqual(r.last(1, 'pong'), { t: 'pong', n: 7 });

  r.advance(90_000);
  r.race.handle(b, { t: 'finish', time: 90.1 });
  r.race.handle(a, { t: 'finish', time: 90.3 });
  assert.equal(r.race.phase, 'racing', 'still waiting on the third');
  r.advance(RACE.dnfSeconds * 1000 + 100);
  assert.equal(r.race.phase, 'results');
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results');
  assert.deepEqual(
    res.rows.map((x) => [x.id, x.place]),
    [
      [2, 1],
      [1, 2],
      [3, 0],
    ],
  );
  assert.equal(res.rows[0].prize, payout(1, 3, 'koripass', false));
  assert.equal(res.rows[2].prize, payout(0, 3, 'koripass', false));
  assert.deepEqual([...r.paid[0].users], [1], 'only signed-in racers are paid by the server');
  r.advance(RACE.resultsSeconds * 1000 + 100);
  assert.equal(r.race.phase, 'lobby');
});

test("finish times must fit the server's clock; a too-quick finish is ignored", () => {
  const r = room();
  const a = r.join(1);
  r.start(a);
  r.advance(RACE.countdownMs + 50);
  r.advance(10_000);
  r.race.handle(a, { t: 'finish', time: 9 });
  assert.equal(r.race.phase, 'racing', 'nobody descends a mountain in 10 s');
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 12 });
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results');
  assert.ok(Math.abs(res.rows[0].time! - 70) < 0.2, 'an implausible time is replaced by the server clock');
});

test('the race ends when everyone still out leaves; host moves on; empty room closes', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.start(a, b);
  r.advance(RACE.countdownMs + 50 + 50_000);
  r.race.handle(a, { t: 'finish', time: 50 });
  r.race.remove(b);
  assert.equal(r.race.phase, 'results');
  r.race.remove(a);
  assert.ok(r.isEmpty());
});

test('late joiners wait for the next race', () => {
  const r = room();
  const a = r.join(1);
  r.start(a);
  r.advance(RACE.countdownMs + 50);
  const late = r.join(2);
  r.race.handle(late, pose(5));
  r.advance(100);
  const snap = r.last(1, 'snap');
  assert.ok(!snap || (snap.t === 'snap' && snap.cars.every((x) => x.id !== 2)));
  const roomMsg = r.last(2, 'room');
  assert.ok(roomMsg && roomMsg.t === 'room' && roomMsg.phase === 'racing');
});

test('time trial: only the host switches to it, it brings up the ring, has no items, and ranks every time with best laps', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  const c = r.join(3);
  r.race.handle(b, { t: 'mode', mode: 'trial' });
  assert.equal(r.race.mode, 'race');
  r.race.handle(a, { t: 'mode', mode: 'toString' as 'trial' });
  assert.equal(r.race.mode, 'race', 'junk modes are ignored');
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  assert.equal(r.race.mode, 'trial');
  assert.equal(r.race.track, 'kodama');
  const room1 = r.last(2, 'room');
  assert.ok(room1 && room1.t === 'room' && room1.mode === 'trial');
  r.start(a, b, c);
  const ld = r.last(3, 'load');
  assert.ok(ld && ld.t === 'load' && ld.mode === 'trial' && ld.track === 'kodama');
  assert.equal(r.race.phase, 'countdown', 'a time trial waits for everyone to load too');
  r.advance(RACE.countdownMs + 100);
  // Ghosts don't throw things.
  r.race.handle(a, { t: 'item', kind: 'shock' });
  assert.ok(!r.last(2, 'item'));
  r.advance(100_000);
  r.race.handle(c, { t: 'finish', time: 100.2, best: 32.5 });
  r.race.handle(a, { t: 'finish', time: 99.8, best: 31.9 });
  r.race.handle(b, { t: 'finish', time: 100.05, best: 500 });
  const res = r.last(2, 'results');
  assert.ok(res && res.t === 'results' && res.mode === 'trial');
  assert.deepEqual(
    res.rows.map((x) => [x.id, x.place, x.time, x.best]),
    [
      [1, 1, 99.8, 31.9],
      [2, 2, 100.05, null],
      [3, 3, 100.2, 32.5],
    ],
    'a best lap longer than the whole race is dropped',
  );
});

/** A room whose spec-car dice land on `pick`, with three racers in three different cars. */
function trialRoom(pick: number) {
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('TRIA', () => {}, () => {}, () => {}, () => 1_000_000, false, () => pick);
  const cars = { 1: 'pebble.3.0.0.0.0.0.1.10000000', 2: 'kitsune.5.1.2.0.0.0.1.32104050', 3: 'vanta.7.2.1.0.1.0.1.55555555' } as Record<number, string>;
  const clients = [1, 2, 3].map((id) => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: cars[id], rider: '', user: false };
    race.add(c);
    return c;
  });
  const countdown = (id: number) => inbox.get(id)!.filter((m) => m.t === 'load').at(-1) as Extract<RaceServerMsg, { t: 'load' }>;
  return { race, clients, cars, countdown, inbox };
}

test('car rules: only the host sets them, only in the lobby, and the room shows the choice', () => {
  const r = trialRoom(0);
  const [a, b] = r.clients;
  r.race.handle(b, { t: 'cars', cars: 'maxed' });
  assert.equal(r.race.cars, 'own');
  r.race.handle(a, { t: 'cars', cars: 'nonsense' as never });
  assert.equal(r.race.cars, 'own');
  r.race.handle(a, { t: 'cars', cars: 'spec' });
  assert.equal(r.race.cars, 'spec');
  const room = r.inbox.get(2)!.filter((m) => m.t === 'room').at(-1);
  assert.ok(room && room.t === 'room' && room.cars === 'spec');
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'cars', cars: 'own' });
  assert.equal(r.race.cars, 'spec', 'locked once the countdown starts');
});

test('spec car: one racer\'s car for everyone (same model and upgrades, own paint), the same for every client', () => {
  const r = trialRoom(0.5); // the middle racer's kitsune
  const [a] = r.clients;
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'cars', cars: 'spec' });
  r.race.handle(a, { t: 'start' });
  const cd = r.countdown(1);
  assert.equal(cd.rule, 'spec');
  assert.deepEqual(r.countdown(3).cars, cd.cars, 'every client hears the same cars');
  const spec = decodeCar(r.cars[2])!;
  for (const id of [1, 2, 3]) {
    const car = decodeCar(cd.cars[id])!;
    assert.equal(car.model, 'kitsune');
    assert.deepEqual(car.up, spec.up);
    assert.equal(car.look.paint, decodeCar(r.cars[id])!.look.paint, 'keeps their own paint');
  }
});

test('maxed: everyone keeps their own car with every part at the top level; races ignore the rule', () => {
  const r = trialRoom(0);
  const [a] = r.clients;
  r.race.handle(a, { t: 'cars', cars: 'maxed' });
  r.race.handle(a, { t: 'start' }); // still a race: own cars
  assert.equal(r.countdown(1).rule, 'own');
  assert.deepEqual(r.countdown(1).cars, r.cars);

  const t = trialRoom(0);
  t.race.handle(t.clients[0], { t: 'mode', mode: 'trial' });
  t.race.handle(t.clients[0], { t: 'cars', cars: 'maxed' });
  t.race.handle(t.clients[0], { t: 'start' });
  for (const id of [1, 2, 3]) {
    const car = decodeCar(t.countdown(1).cars[id])!;
    assert.equal(car.model, decodeCar(t.cars[id])!.model);
    for (const p of PARTS) assert.equal(car.up[p], MAX_LEVEL);
  }
});

test('race cars: results show the car raced; tuning only carries over to your own model outside spec', () => {
  const r = trialRoom(0.99); // the vanta
  const [a] = r.clients;
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'cars', cars: 'spec' });
  r.race.handle(a, { t: 'start' });
  r.race.tick();
  for (const c of r.clients) r.race.remove(c); // everyone leaves: no results, but no crash either

  assert.deepEqual(raceCars('spec', [], 0.5), {});
  assert.equal(decodeCar(raceCars('own', [{ id: 1, car: 'junk' }], 0)[1])!.model, 'pebble', 'a bad code becomes the starter car');
  const mine = newOwnedCar('vanta');
  mine.tune.ride = 0.5;
  const code = raceCars('spec', [{ id: 1, car: 'vanta.0.1.0.0.0.0.1.00000000' }], 0)[1];
  assert.deepEqual(myRaceCar('spec', code, mine).tune, defaultTune('vanta'), 'spec: default tuning even on your own model');
  assert.equal(myRaceCar('maxed', raceCars('maxed', [{ id: 1, car: code }], 0)[1], mine).tune.ride, 0.5, 'maxed: your tuning');
  assert.equal(myRaceCar('own', undefined, mine), mine, 'no code: your garage car');
});

test('the countdown waits until every racer has loaded the track', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  const ld = r.last(2, 'loading');
  assert.ok(ld && ld.t === 'loading');
  assert.deepEqual(ld.ready, [1]);
  assert.deepEqual(ld.field, [1, 2]);
  r.advance(RACE.loadTimeoutMs - 1000);
  assert.equal(r.race.phase, 'loading', 'still waiting on the slow loader');
  assert.ok(!r.last(1, 'countdown') && !r.last(1, 'go'));
  r.race.handle(a, pose(3)); // cars on the grid are relayed while we wait
  assert.ok(r.last(2, 'snap'));
  r.race.handle(b, { t: 'ready' });
  assert.equal(r.race.phase, 'countdown');
  for (const id of [1, 2]) {
    const cd = r.last(id, 'countdown');
    assert.ok(cd && cd.t === 'countdown' && cd.ms === RACE.countdownMs, 'everyone hears the same countdown at once');
  }
  r.advance(RACE.countdownMs - 100);
  assert.ok(!r.last(1, 'go'));
  r.advance(200);
  assert.equal(r.race.phase, 'racing');
  assert.ok(r.last(1, 'go') && r.last(2, 'go'));
});

test('a stuck loader is left behind after the timeout and starts when it finally loads', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  const c = r.join(3);
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  r.advance(RACE.loadTimeoutMs + 50);
  assert.equal(r.race.phase, 'countdown');
  r.advance(1000);
  // Loads mid-countdown: told how long is left.
  r.race.handle(b, { t: 'ready' });
  const cd = r.inbox.get(2)!.filter((m) => m.t === 'countdown');
  assert.equal(cd.length, 2);
  const left = cd[1];
  assert.ok(left.t === 'countdown' && left.ms <= RACE.countdownMs - 1000 && left.ms > RACE.countdownMs - 1200);
  r.advance(RACE.countdownMs);
  assert.equal(r.race.phase, 'racing');
  // Loads after GO: started on the spot.
  const before = r.inbox.get(3)!.filter((m) => m.t === 'go').length;
  r.race.handle(c, { t: 'ready' });
  assert.equal(r.inbox.get(3)!.filter((m) => m.t === 'go').length, before + 1);
  r.race.handle(c, { t: 'ready' });
  assert.equal(r.inbox.get(3)!.filter((m) => m.t === 'go').length, before + 1, 'ready only counts once');
});

test('a racer who leaves while loading is not waited for; an empty field goes back to the lobby', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  r.race.remove(b);
  assert.equal(r.race.phase, 'countdown');

  const r2 = room();
  const x = r2.join(1);
  r2.race.handle(x, { t: 'start' });
  const late = r2.join(2);
  r2.race.handle(late, { t: 'ready' });
  assert.equal(r2.race.phase, 'loading', "someone who wasn't on the grid can't start it");
  r2.race.remove(x);
  assert.equal(r2.race.phase, 'lobby');
});
