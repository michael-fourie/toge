import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROYALE, Royale } from '../../src/toge/shared/royale.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import { MODE_TRACK, RACE, modeTracks, type RaceServerMsg, type ResultRow } from '../../src/toge/shared/protocol.ts';
import { RACE_TRACKS, SAMPLE, TRACK_DEFS, getTrack } from '../../src/toge/shared/track.ts';
import { CUPS } from '../../src/toge/shared/cups.ts';

const LAP = 1000;
const START = 300;
/** Distance raced for `laps` laps plus `m` metres. */
const at = (laps: number, m = 0) => START + laps * LAP + m;

test('battle royale: the last car over the line each lap is out, until one is left', () => {
  const r = new Royale(START, LAP);
  const p = new Map([[1, at(0, 900)], [2, at(0, 950)], [3, at(0, 980)]]);
  assert.deepEqual(r.step(p, 20), [], 'nobody has finished a lap yet');
  p.set(3, at(1, 5));
  assert.deepEqual(r.step(p, 21), [], 'one across: two still to come');
  p.set(2, at(1, 1));
  const out = r.step(p, 22);
  assert.deepEqual(out, [{ id: 1, lap: 1, place: 3, at: 22 }], 'all but one across: the last is out, third');
  assert.equal(r.lap, 2);
  // The eliminated car is ignored from now on, whatever it reports.
  p.set(1, at(5));
  p.set(3, at(2, 3));
  const out2 = r.step(p, 50);
  assert.equal(out2.length, 1);
  assert.equal(out2[0].id, 2);
  assert.equal(out2[0].place, 2);
  assert.equal(r.winner, 3);
  assert.deepEqual(r.step(p, 60), [], 'it is over');
});

test('battle royale: a car that stops (or a stuck pack) is out once the grace runs out, slowest first', () => {
  const r = new Royale(START, LAP);
  const p = new Map([[1, at(1, 2)], [2, at(0, 400)], [3, at(0, 600)], [4, at(0, 800)]]);
  assert.deepEqual(r.step(p, 30), []);
  assert.deepEqual(r.step(p, 30 + ROYALE.grace - 1), [], 'still inside the grace');
  const out = r.step(p, 30 + ROYALE.grace);
  assert.deepEqual(out.map((k) => [k.id, k.place]), [[2, 4], [3, 3], [4, 2]]);
  assert.equal(r.winner, 1);
});

test('battle royale: everyone over the line in one step still loses the one furthest back; leavers just drop out', () => {
  const r = new Royale(START, LAP);
  const p = new Map([[1, at(1, 9)], [2, at(1, 3)], [3, at(1, 6)]]);
  assert.deepEqual(r.step(p, 25).map((k) => k.id), [2]);
  // Racer 3 leaves: two left becomes one, and that one has won without another lap.
  p.delete(3);
  r.step(p, 26);
  assert.equal(r.winner, 1);
  // A lone racer never wins by default: there was nobody to outlast.
  const solo = new Royale(START, LAP);
  solo.step(new Map([[7, at(3)]]), 90);
  assert.equal(solo.winner, null);
});

test('battle royale arena: only the royale mode runs it, with a lap for every elimination a full grid needs', () => {
  const id = MODE_TRACK.royale;
  const def = TRACK_DEFS[id];
  assert.ok(def.royale && def.laps && def.sky);
  assert.equal(def.laps, RACE.maxPlayers - 1);
  assert.deepEqual(modeTracks('royale'), RACE_TRACKS.filter((t) => TRACK_DEFS[t].royale));
  for (const m of ['race', 'trial', 'climb'] as const) assert.ok(!modeTracks(m).includes(id), `${m} doesn't run the arena`);
  for (const cup of Object.values(CUPS)) assert.ok(!cup.tracks.includes(id));
  // A short lap: elimination comes round quickly.
  assert.ok(getTrack(id).lap * SAMPLE < 1100);
});

/** A race room with fake sockets and a hand-wound clock (as in raceroom.test.ts). */
function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const paid: ResultRow[][] = [];
  const race = new Race('ROYL', () => {}, () => {}, (rows) => paid.push(rows), () => now, false);
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: true };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  const all = (id: number, t: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === t);
  return { race, join, advance, all, paid };
}

const pose = (s: number) => ({ t: 'state' as const, p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, -30] as [number, number, number], w: 0, s, st: 0, ws: 80, rpm: 5000, f: 0 });
const cpuPose = (id: number, s: number) => ({ id, ...pose(s), t: undefined });

test('online battle royale: the room knocks out the last car each lap from the poses, CPU racers too, and ranks the field', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'mode', mode: 'royale' });
  assert.equal(r.race.track, 'shura');
  r.race.handle(a, { t: 'cpu', op: 'add' });
  const bot = [...r.race.members.keys()].find((id) => id < 0)!;
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  assert.equal(r.race.phase, 'racing');
  const t = getTrack('shura');
  const line = (k: number) => t.startS + k * t.lap * SAMPLE;
  const cpus = (s: number) => r.race.handle(a, { t: 'cpus', cars: [cpuPose(bot, s)] as never });
  // Lap 1: the CPU and racer 1 cross, racer 2 is last.
  r.race.handle(a, pose(line(1) + 4));
  cpus(line(1) + 2);
  r.race.handle(b, pose(line(1) - 30));
  r.advance(100);
  const out1 = r.all(1, 'out');
  assert.deepEqual(out1, [{ t: 'out', id: 2, lap: 1, place: 3, left: 2 }]);
  assert.equal(r.race.phase, 'racing');
  // A car that's out is no longer relayed or counted.
  const snaps = r.all(1, 'snap').length;
  r.race.handle(b, pose(line(3)));
  assert.equal(r.all(1, 'snap').length, snaps);
  // Lap 2: racer 1 wins it, the CPU is out.
  r.race.handle(a, pose(line(2) + 1));
  cpus(line(2) - 10);
  r.advance(100);
  assert.equal(r.race.phase, 'results');
  const res = r.all(2, 'results').at(-1);
  assert.ok(res && res.t === 'results' && res.mode === 'royale');
  assert.deepEqual(res.rows.map((x) => [x.id, x.place, x.out ?? 0]), [[1, 1, 0], [bot, 2, 2], [2, 3, 1]]);
  assert.ok(res.rows[0].time !== null && res.rows[0].prize > res.rows[2].prize, 'the winner is timed and paid most');
  assert.equal(r.paid.length, 1);
});
