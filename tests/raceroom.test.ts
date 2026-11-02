import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Race, type RaceClient } from '../src/server/race.ts';
import { RACE, type RaceServerMsg, type ResultRow } from '../src/shared/race/protocol.ts';
import { payout } from '../src/shared/race/garage.ts';

/** A race room with fake sockets and a hand-wound clock. */
function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const paid: { rows: ResultRow[]; users: Set<number> }[] = [];
  let empty = false;
  const race = new Race('ABCD', () => {}, () => (empty = true), (rows, users) => paid.push({ rows, users }), () => now, false);
  const join = (id: number, user = false): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', user };
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
  return { race, join, advance, last, inbox, paid, isEmpty: () => empty };
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
  assert.equal(r.race.phase, 'countdown');
  const cd = r.last(2, 'countdown');
  assert.ok(cd && cd.t === 'countdown' && cd.track === 'saltwind' && cd.grid[1] === 0 && cd.grid[2] === 1);
});

test('countdown, go, relayed poses, finishes ranked by time, prizes, then back to the lobby', () => {
  const r = room();
  const a = r.join(1, true);
  const b = r.join(2);
  const c = r.join(3);
  r.race.handle(a, { t: 'start' });
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
  r.race.handle(a, { t: 'start' });
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
  r.race.handle(a, { t: 'start' });
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
  r.race.handle(a, { t: 'start' });
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
  r.race.handle(a, { t: 'start' });
  const cd = r.last(3, 'countdown');
  assert.ok(cd && cd.t === 'countdown' && cd.mode === 'trial' && cd.track === 'kodama');
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
