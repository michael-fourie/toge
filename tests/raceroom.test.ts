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

const pose = (s: number) => ({ t: 'state' as const, p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, -30] as [number, number, number], s, st: 0, ws: 80, rpm: 5000, f: 0 });

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
  r.race.handle(a, pose(100));
  r.race.handle(b, pose(90));
  r.advance(100);
  const snap = r.last(3, 'snap');
  assert.ok(snap && snap.t === 'snap' && snap.cars.length === 2);
  // Junk poses are dropped.
  r.race.handle(c, { ...pose(1), p: [NaN, 0, 0] });
  r.advance(100);
  const snap2 = r.last(3, 'snap');
  assert.ok(snap2 && snap2.t === 'snap' && snap2.cars.every((x) => x.id !== 3));

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
