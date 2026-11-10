import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import { RACE, cleanMode, ghostMode, type RaceServerMsg, type ResultRow } from '../../src/toge/shared/protocol.ts';
import { payout } from '../../src/toge/shared/garage.ts';
import { CUPS } from '../../src/toge/shared/cups.ts';
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

test('time trial: only the host switches to it, it brings up the ring, and ranks every time with best laps', () => {
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

test('solo time trial: a private room of one, always a time trial, timed by the room so the run counts as a best time', () => {
  let now = 1_000_000;
  const inbox: RaceServerMsg[] = [];
  const results: { rows: ResultRow[]; users: Set<number>; mode: string; track: string }[] = [];
  const race = new Race('SOLO', () => {}, () => {}, (rows, users, track, _tapes, mode) => results.push({ rows, users, mode, track }), () => now, false);
  race.makeSolo();
  assert.equal(race.mode, 'trial');
  const me: RaceClient = { id: 1, ws: { readyState: 1, send: (d: string) => inbox.push(JSON.parse(d)) }, name: 'andrew', car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: true };
  assert.equal(race.full, false);
  race.add(me);
  assert.equal(race.full, true, 'nobody else gets in');
  const last = (t: RaceServerMsg['t']) => inbox.filter((m) => m.t === t).at(-1);
  const r0 = last('room');
  assert.ok(r0 && r0.t === 'room' && r0.solo === true && r0.mode === 'trial');
  // It stays a solo time trial.
  race.handle(me, { t: 'mode', mode: 'race' });
  race.handle(me, { t: 'cpu', op: 'add' });
  race.handle(me, { t: 'cup', cup: 'apex' });
  assert.equal(race.mode, 'trial');
  assert.equal(race.humans, race.members.size, 'no CPU racers');
  // Any race track, never the hill climb.
  race.handle(me, { t: 'track', track: 'karasu' });
  assert.equal(race.track, 'kodama');
  race.handle(me, { t: 'track', track: 'shiden' });
  assert.equal(race.track, 'shiden');
  race.handle(me, { t: 'start' });
  race.handle(me, { t: 'ready' });
  const ld = last('load');
  assert.ok(ld && ld.t === 'load' && ld.mode === 'trial' && ld.track === 'shiden');
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  tick(RACE.countdownMs + 100);
  assert.equal(race.phase, 'racing');
  tick(110_000);
  race.handle(me, { t: 'finish', time: 110, best: 110 });
  assert.equal(results.length, 1);
  const res = results[0];
  assert.equal(res.mode, 'trial', 'a record mode, so the platform keeps the time');
  assert.equal(res.track, 'shiden');
  assert.ok(res.users.has(1) && res.rows[0].time !== null && Math.abs(res.rows[0].time - 110) < 0.6, 'timed by the room');
  // Run again straight from the results.
  race.handle(me, { t: 'start' });
  assert.equal(race.phase, 'loading');
});

test('hill climb: it runs only on the mountain, cars are solid but throw nothing, the car rule applies, and leaving it comes back down', () => {
  assert.equal(ghostMode('climb'), false, 'hill climb cars are solid: you bump and draft them');
  assert.equal(cleanMode('climb'), true);
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'track', track: 'karasu' });
  assert.equal(r.race.track, 'koripass', 'a race never runs on the hill climb');
  r.race.handle(a, { t: 'mode', mode: 'climb' });
  assert.equal(r.race.mode, 'climb');
  assert.equal(r.race.track, 'karasu', 'switching to a hill climb puts its mountain up');
  r.race.handle(a, { t: 'track', track: 'kodama' });
  assert.equal(r.race.track, 'karasu', 'a hill climb only runs up a hill-climb road');
  r.race.handle(a, { t: 'track', track: 'constructor' as 'karasu' });
  assert.equal(r.race.track, 'karasu', 'junk tracks are ignored');
  r.race.handle(a, { t: 'cars', cars: 'maxed' });
  r.start(a, b);
  const ld = r.last(2, 'load');
  assert.ok(ld && ld.t === 'load' && ld.mode === 'climb' && ld.track === 'karasu' && ld.rule === 'maxed');
  for (const p of PARTS) assert.equal(decodeCar(ld.cars[1])!.up[p], MAX_LEVEL, 'the car rule works like a time trial');
  r.advance(RACE.countdownMs + 100);
  r.advance(100_000);
  r.race.handle(b, { t: 'finish', time: 140.4 });
  r.race.handle(a, { t: 'finish', time: 139.9 });
  const res = r.last(2, 'results');
  assert.ok(res && res.t === 'results' && res.mode === 'climb');
  assert.deepEqual(res.rows.map((x) => [x.id, x.place]), [[1, 1], [2, 2]]);
  r.advance(RACE.resultsSeconds * 1000 + 100);
  r.race.handle(a, { t: 'mode', mode: 'race' });
  assert.equal(r.race.track, 'koripass', 'back to a race: back down to the passes');
});

/** A time trial room with three racers in three different cars. */
function trialRoom() {
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('TRIA', () => {}, () => {}, () => {}, () => 1_000_000, false);
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
  const r = trialRoom();
  const [a, b] = r.clients;
  r.race.handle(b, { t: 'cars', cars: 'maxed' });
  assert.equal(r.race.cars, 'own');
  r.race.handle(a, { t: 'cars', cars: 'nonsense' as never });
  assert.equal(r.race.cars, 'own');
  r.race.handle(a, { t: 'cars', cars: 'vanta' });
  assert.equal(r.race.cars, 'vanta');
  const room = r.inbox.get(2)!.filter((m) => m.t === 'room').at(-1);
  assert.ok(room && room.t === 'room' && room.cars === 'vanta');
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'cars', cars: 'own' });
  assert.equal(r.race.cars, 'vanta', 'locked once the countdown starts');
});

test('maxed Vanta: everyone drives a Vanta with every part at the top level, own paint, the same for every client', () => {
  const r = trialRoom();
  const [a] = r.clients;
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'cars', cars: 'vanta' });
  r.race.handle(a, { t: 'start' });
  const cd = r.countdown(1);
  assert.equal(cd.rule, 'vanta');
  assert.deepEqual(r.countdown(3).cars, cd.cars, 'every client hears the same cars');
  for (const id of [1, 2, 3]) {
    const car = decodeCar(cd.cars[id])!;
    assert.equal(car.model, 'vanta');
    for (const p of PARTS) assert.equal(car.up[p], MAX_LEVEL);
    assert.equal(car.look.paint, decodeCar(r.cars[id])!.look.paint, 'keeps their own paint');
  }
});

test('maxed: everyone keeps their own car with every part at the top level; races ignore the rule', () => {
  const r = trialRoom();
  const [a] = r.clients;
  r.race.handle(a, { t: 'cars', cars: 'maxed' });
  r.race.handle(a, { t: 'start' }); // still a race: own cars
  assert.equal(r.countdown(1).rule, 'own');
  assert.deepEqual(r.countdown(1).cars, r.cars);

  const t = trialRoom();
  t.race.handle(t.clients[0], { t: 'mode', mode: 'trial' });
  t.race.handle(t.clients[0], { t: 'cars', cars: 'maxed' });
  t.race.handle(t.clients[0], { t: 'start' });
  for (const id of [1, 2, 3]) {
    const car = decodeCar(t.countdown(1).cars[id])!;
    assert.equal(car.model, decodeCar(t.cars[id])!.model);
    for (const p of PARTS) assert.equal(car.up[p], MAX_LEVEL);
  }
});

test('race cars: results show the car raced; tuning only carries over to your own model outside the maxed Vanta', () => {
  const r = trialRoom();
  const [a] = r.clients;
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  r.race.handle(a, { t: 'cars', cars: 'vanta' });
  r.race.handle(a, { t: 'start' });
  r.race.tick();
  for (const c of r.clients) r.race.remove(c); // everyone leaves: no results, but no crash either

  assert.deepEqual(raceCars('vanta', []), {});
  assert.equal(decodeCar(raceCars('own', [{ id: 1, car: 'junk' }])[1])!.model, 'pebble', 'a bad code becomes the starter car');
  const mine = newOwnedCar('vanta');
  mine.tune.ride = 0.5;
  const code = raceCars('vanta', [{ id: 1, car: 'pebble.0.1.0.0.0.0.1.00000000' }])[1];
  assert.deepEqual(myRaceCar('vanta', code, mine).tune, defaultTune('vanta'), 'maxed Vanta: default tuning even on your own model');
  assert.equal(myRaceCar('maxed', raceCars('maxed', [{ id: 1, car: code }])[1], mine).tune.ride, 0.5, 'maxed: your tuning');
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

test('CPU racers: only the host adds and removes them, in the lobby; they start ready and fill the grid', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(b, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, 2, 'a guest cannot add one');
  r.race.handle(a, { t: 'cpu', op: 'add' });
  r.race.handle(a, { t: 'cpu', op: 'add' });
  const room1 = r.last(2, 'room');
  assert.ok(room1 && room1.t === 'room');
  const cpus = room1.racers.filter((x) => x.cpu);
  assert.equal(cpus.length, 2);
  assert.ok(cpus.every((x) => x.id < 0 && !x.user && decodeCar(x.car)), 'negative ids, never signed in, a real car');
  assert.notEqual(cpus[0].name, cpus[1].name);
  assert.equal(r.race.humans, 2);
  r.race.handle(b, { t: 'cpu', op: 'remove', id: cpus[0].id });
  assert.equal(r.race.members.size, 4, 'a guest cannot remove one');
  r.race.handle(a, { t: 'cpu', op: 'remove', id: 2 });
  assert.equal(r.race.members.size, 4, 'the host cannot kick a person this way');
  r.race.handle(a, { t: 'cpu', op: 'remove', id: cpus[0].id });
  assert.equal(r.race.members.size, 3);
  // Never more than the grid holds.
  for (let i = 0; i < 10; i++) r.race.handle(a, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, RACE.maxPlayers);
  // A person joining a grid full of CPUs takes a CPU's seat.
  assert.ok(!r.race.full);
  r.join(3);
  assert.equal(r.race.members.size, RACE.maxPlayers);
  assert.equal(r.race.humans, 3);
  // CPUs are on the grid and ready from the start: the countdown waits only for the people.
  r.race.handle(a, { t: 'start' });
  const ld = r.last(1, 'load');
  assert.ok(ld && ld.t === 'load' && Object.keys(ld.grid).length === RACE.maxPlayers);
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  assert.equal(r.race.phase, 'loading');
  r.race.handle(r.race.members.get(3)!.client, { t: 'ready' });
  assert.equal(r.race.phase, 'countdown');
  r.race.handle(a, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, RACE.maxPlayers, 'not mid-race');
});

test('CPU racers: the host drives them; poses and finishes are relayed and ranked, never paid', () => {
  const r = room();
  const a = r.join(1, true);
  const b = r.join(2, true);
  r.race.handle(a, { t: 'cpu', op: 'add' });
  const bot = [...r.race.members.values()].find((m) => m.cpu)!.client.id;
  r.start(a, b);
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
  // One message carries the CPUs' poses; the others hear it as a snap, the host doesn't hear it back.
  const { t: _t, ...p } = pose(50);
  r.race.handle(a, { t: 'cpus', cars: [{ id: bot, ...p }] });
  const snap = r.last(2, 'snap');
  assert.ok(snap && snap.t === 'snap' && snap.cars[0].id === bot && snap.cars[0].s === 50);
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'snap'));
  // Only the host speaks for them, and only for CPUs.
  r.race.handle(b, { t: 'cpus', cars: [{ id: bot, ...pose(70) }] });
  r.race.handle(a, { t: 'cpus', cars: [{ id: 2, ...pose(70) }] });
  assert.ok(!r.inbox.get(2)!.some((m) => m.t === 'snap' && m.cars.some((c) => c.s === 70)));
  assert.ok(!r.inbox.get(1)!.some((m) => m.t === 'snap' && m.cars.some((c) => c.s === 70)));
  r.advance(60_000);
  // The CPU wins, the people follow.
  r.race.handle(b, { t: 'cpufinish', id: bot, time: 60 });
  assert.equal(r.race.members.get(bot)!.time, null, "a guest can't finish a CPU");
  r.race.handle(a, { t: 'cpufinish', id: bot, time: 60 });
  r.race.handle(a, { t: 'finish', time: 61 });
  r.race.handle(b, { t: 'finish', time: 62 });
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results');
  assert.deepEqual(res.rows.map((x) => [x.id, x.place, !!x.cpu]), [[bot, 1, true], [1, 2, false], [2, 3, false]]);
  const cpuRow = res.rows[0];
  assert.equal(cpuRow.prize, 0);
  // Never less than the two people would have earned racing alone together.
  assert.ok(res.rows[1].prize >= payout(1, 2, 'koripass', false));
  assert.ok(res.rows[2].prize >= payout(2, 2, 'koripass', false));
  assert.ok(!r.paid[0].users.has(bot));
});

test('CPU racers: the race ends when the people are home, and they leave with a host who quits mid-race', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'cpu', op: 'add' });
  r.race.handle(a, { t: 'cpu', op: 'add' });
  r.start(a, b);
  r.advance(RACE.countdownMs + 100);
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 61 });
  r.race.handle(b, { t: 'finish', time: 62 });
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results' && res.rows.filter((x) => x.cpu).every((x) => x.place === 0), 'CPUs still out are a DNF');
  // Next race: the host leaves mid-race, and their CPUs go with them.
  r.advance(RACE.resultsSeconds * 1000 + 100);
  assert.equal(r.race.phase, 'lobby');
  r.start(a, b);
  r.advance(RACE.countdownMs + 100);
  r.race.remove(a);
  assert.equal(r.race.hostId, 2);
  assert.equal(r.race.members.size, 1);
  const rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && !rm.racers.some((x) => x.cpu));
  // In the lobby they stay with the new host; when the last person goes, the room closes.
  r.advance(60_000);
  r.race.handle(r.race.members.get(2)!.client, { t: 'finish', time: 63 });
  r.advance(RACE.resultsSeconds * 1000 + 100);
  assert.equal(r.race.phase, 'lobby');
  const c = r.join(3);
  r.race.handle(c, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, 2, 'only the host');
  r.race.remove(r.race.members.get(2)!.client);
  assert.equal(r.race.hostId, 3);
  r.race.handle(c, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, 2);
  r.race.remove(c);
  assert.ok(r.isEmpty());
});
test('the lobby garage: everyone sees who is editing their car, and their edits; a start clears it', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(b, { t: 'pit', on: true });
  let rm = r.last(1, 'room');
  assert.ok(rm && rm.t === 'room' && rm.racers.find((x) => x.id === 2)?.pit === true && !rm.racers.find((x) => x.id === 1)?.pit);
  r.race.handle(b, { t: 'car', car: 'kitsune.3.1.0.0.0.0.1.00000000' });
  rm = r.last(1, 'room');
  assert.ok(rm && rm.t === 'room' && rm.racers.find((x) => x.id === 2)?.car === 'kitsune.3.1.0.0.0.0.1.00000000');
  // A bad flag changes nothing.
  r.race.handle(b, { t: 'pit', on: 'yes' as unknown as boolean });
  assert.equal(r.race.room().racers.find((x) => x.id === 2)?.pit, true);
  r.start(a, b);
  rm = r.last(1, 'room');
  assert.ok(rm && rm.t === 'room' && rm.racers.every((x) => !x.pit));
  // Racing: the flag waits for the lobby.
  r.race.handle(b, { t: 'pit', on: true });
  assert.ok(!r.race.room().racers.find((x) => x.id === 2)?.pit);
});

test('race again: the host can start the next race straight from the results; nobody else can', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.start(a, b);
  r.advance(RACE.countdownMs + 100);
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 60.2 });
  r.race.handle(b, { t: 'finish', time: 60.4 });
  assert.equal(r.race.phase, 'results');
  const loads = () => r.inbox.get(2)!.filter((m) => m.t === 'load').length;
  const before = loads();
  r.race.handle(b, { t: 'start' });
  assert.equal(r.race.phase, 'results', 'only the host restarts');
  r.race.handle(a, { t: 'start' });
  assert.equal(r.race.phase, 'loading');
  assert.equal(loads(), before + 1, 'everyone is sent off to load the next race');
  const load = r.last(2, 'load');
  assert.ok(load && load.t === 'load' && load.track === 'koripass' && Object.keys(load.grid).length === 2, 'same track, same field');
  // It's a fresh race: nobody carries their finish over.
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
});

test('restart from the pause menu: the host can send everyone back to the start mid-race, unpaid; nobody else can', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.start(a, b);
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 60.2 });
  r.race.handle(b, { t: 'start' });
  assert.equal(r.race.phase, 'racing', 'only the host restarts');
  r.race.handle(a, { t: 'start' });
  assert.equal(r.race.phase, 'loading');
  assert.equal(r.paid.length, 0, 'the dropped race pays nothing');
  r.race.handle(a, { t: 'start' });
  assert.equal(r.inbox.get(2)!.filter((m) => m.t === 'load').length, 2, 'a second press while loading is ignored');
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
  // A fresh race: the earlier finish doesn't carry over, so one finish isn't the end of it.
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 60.5 });
  assert.equal(r.race.phase, 'racing');
});

test('Grand Prix: the host picks a cup, its four rounds run back to back with points, then the cup table and the lobby', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'cup', cup: 'mirage' });
  assert.equal(r.race.cup, 'torii', 'a cup is only picked in a Grand Prix lobby');
  r.race.handle(a, { t: 'mode', mode: 'gp' });
  assert.equal(r.race.track, CUPS.torii.tracks[0]);
  r.race.handle(b, { t: 'cup', cup: 'mirage' });
  assert.equal(r.race.cup, 'torii', 'only the host picks');
  r.race.handle(a, { t: 'cup', cup: 'mirage' });
  r.race.handle(a, { t: 'cup', cup: 'nope' as never });
  assert.equal(r.race.cup, 'mirage');
  assert.equal(r.race.track, CUPS.mirage.tracks[0]);
  r.race.handle(a, { t: 'track', track: 'monza' });
  assert.equal(r.race.track, CUPS.mirage.tracks[0], 'no single track in a Grand Prix');
  r.race.handle(a, { t: 'cpu', op: 'add' });
  const cpu = [...r.race.members.values()].find((m) => m.cpu)!.client.id;
  const rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && rm.mode === 'gp' && rm.cup === 'mirage' && rm.gp === null);

  r.start(a, b);
  for (let round = 0; round < 4; round++) {
    const ld = r.last(2, 'load');
    assert.ok(ld && ld.t === 'load' && ld.track === CUPS.mirage.tracks[round] && ld.gp?.round === round, `round ${round + 1} loads its track`);
    assert.equal(ld.mode, 'gp');
    if (round > 0) for (const c of [a, b]) r.race.handle(c, { t: 'ready' });
    r.advance(RACE.countdownMs + 100);
    assert.equal(r.race.phase, 'racing');
    r.advance(45_000);
    // b wins the first two, a the last two; the CPU always third.
    const [first, second] = round < 2 ? [b, a] : [a, b];
    r.race.handle(first, { t: 'finish', time: 45 });
    // Round 4: the CPU is still out when the people are home, so it's placed by how far it got.
    if (round < 3) r.race.handle(a, { t: 'cpufinish', id: cpu, time: 45.6 });
    r.race.handle(second, { t: 'finish', time: 45.3 });
    const res = r.last(1, 'results');
    assert.ok(res && res.t === 'results' && res.gp && res.gp.round === round);
    assert.equal(res.rows.find((x) => x.id === cpu)!.prize, 0, 'CPUs still earn no money');
    if (round === 3) {
      const row = res.rows.find((x) => x.id === cpu)!;
      assert.equal(row.time, null);
      assert.equal(row.place, 3, 'a CPU still out scores by where it got to');
    }
    if (round < 3) {
      assert.equal(res.gp.final, false);
      assert.equal(res.gp.next, RACE.gpResultsSeconds * 1000);
      // The next round loads on its own once the results have been up long enough.
      r.advance(RACE.gpResultsSeconds * 1000 + 100);
      assert.equal(r.race.phase, 'loading');
    } else {
      assert.equal(res.gp.final, true);
      // 12+12+15+15 = 54 each: tied on points and wins, a took the last round.
      assert.deepEqual(res.gp.table.map((x) => [x.key, x.pts]), [['1', 54], ['2', 54], [String(cpu), 40]]);
      assert.deepEqual(res.gp.table[0].places, [2, 2, 1, 1]);
    }
  }
  r.advance(RACE.cupResultsSeconds * 1000 + 100);
  assert.equal(r.race.phase, 'lobby');
  assert.equal(r.race.gp, null, 'back in the lobby the cup is over');
  assert.equal(r.paid.length, 4, 'every round pays like a race');
});

test('Grand Prix: the host can go to the next round early, and races the cup again from round 1 after the last', () => {
  const r = room();
  const a = r.join(1);
  r.race.handle(a, { t: 'mode', mode: 'gp' });
  r.start(a);
  const race = () => {
    r.race.handle(a, { t: 'ready' });
    r.advance(RACE.countdownMs + 100);
    r.advance(45_000);
    r.race.handle(a, { t: 'finish', time: 45 });
  };
  race();
  r.race.handle(a, { t: 'start' });
  let ld = r.last(1, 'load');
  assert.ok(ld && ld.t === 'load' && ld.gp?.round === 1 && ld.track === CUPS.torii.tracks[1]);
  // A restart from the pause menu reruns the same round.
  r.race.handle(a, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  r.race.handle(a, { t: 'start' });
  ld = r.last(1, 'load');
  assert.ok(ld && ld.t === 'load' && ld.gp?.round === 1 && ld.track === CUPS.torii.tracks[1], 'same round again');
  race();
  r.race.handle(a, { t: 'start' });
  race();
  r.race.handle(a, { t: 'start' });
  race();
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results' && res.gp?.final && res.gp.table[0].pts === 60);
  r.race.handle(a, { t: 'start' });
  ld = r.last(1, 'load');
  assert.ok(ld && ld.t === 'load' && ld.gp?.round === 0 && ld.gp.table.length === 0 && ld.track === CUPS.torii.tracks[0], 'a fresh cup');
});
