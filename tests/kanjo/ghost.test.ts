import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GHOST, GhostRecorder, type GhostRun, type GhostTape, cleanRun, cleanTape, poseAt, unpack } from '../../src/kanjo/shared/ghost.ts';
import { RecordStore } from '../../src/kanjo/server/recordStore.ts';
import { Race, type RaceClient } from '../../src/kanjo/server/race.ts';
import type { RaceServerMsg } from '../../src/kanjo/shared/protocol.ts';
import type { TrackId } from '../../src/kanjo/shared/track.ts';
import type { KV } from '../../src/server/accountStore.ts';

const CAR = 'shiro.0.1.0.0.0.0.1.00000000';
const Q: [number, number, number, number] = [0, 0, 0, 1];

/** A car driving straight down -z at `v` m/s for `secs`, sampled at 20 Hz. */
function drive(secs: number, v = 30): GhostTape {
  const rec = new GhostRecorder();
  for (let t = 0; t <= secs + 1e-9; t += 0.05) rec.add(t, [10, 2, -v * t], Q);
  return { car: CAR, rider: '', d: rec.d };
}

function kv() {
  const data = new Map<string, unknown>();
  const store: KV = {
    get: async <T>(k: string) => data.get(k) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  return { data, store };
}

test('a recorded run keeps a sample every GHOST.every seconds and plays back where the car was', () => {
  const tape = drive(200);
  assert.equal(tape.d.length % GHOST.stride, 0);
  assert.ok(Math.abs(tape.d.length / GHOST.stride - 200 / GHOST.every) <= 2, 'one sample per GHOST.every');
  const k = unpack(tape.d);
  const out = { p: [0, 0, 0], q: [0, 0, 0, 0], v: [0, 0, 0] };
  let hint = 0;
  for (const t of [0, 0.1, 13.37, 99.9, 150.05, 199.8]) {
    hint = poseAt(k, t, out, hint);
    assert.ok(Math.abs(out.p[2] - -30 * t) < 0.05, `z at ${t}: ${out.p[2]}`);
    assert.ok(Math.abs(out.p[0] - 10) < 0.01 && Math.abs(out.p[1] - 2) < 0.01);
    assert.deepEqual(out.q.map((x) => Math.round(x * 1000) / 1000), [0, 0, 0, 1]);
  }
  poseAt(k, 50, out, 0);
  assert.ok(Math.abs(out.v[2] + 30) < 0.5, `velocity ${out.v[2]}`);
  // Past the end it parks at the line.
  poseAt(k, 500, out, hint);
  assert.ok(Math.abs(out.p[2] - -30 * k.t[k.t.length - 1]) < 0.05);
});

test('a long run is capped, so a stored ghost stays well under a stored value limit', () => {
  const rec = new GhostRecorder();
  for (let t = 0; t <= 900; t += 0.05) rec.add(t, [-4000 + t * 9, 300 - t, 5000 - t * 40], [0.123, -0.987, 0.031, 0.0999]);
  assert.equal(rec.samples, GHOST.maxSamples);
  assert.ok(JSON.stringify(rec.d).length < 120 * 1024, `${JSON.stringify(rec.d).length} bytes`);
});

test('tapes are checked: whole samples, time forward, no teleports, about the right length, a real car', () => {
  const ok = drive(100);
  assert.ok(cleanTape(ok, 100));
  assert.equal(cleanTape(ok, 120), null, 'its length says another time');
  assert.equal(cleanTape({ ...ok, car: 'nope' }, 100), null);
  assert.equal(cleanTape({ ...ok, d: ok.d.slice(0, -1) }, 100), null, 'a broken sample');
  assert.equal(cleanTape({ ...ok, d: [...ok.d.slice(0, 8)] }, 0), null, 'one sample is no run');
  const back = ok.d.slice();
  back[GHOST.stride * 3] = -5;
  assert.equal(cleanTape({ ...ok, d: back }, 100), null, 'time running backwards');
  const jump = ok.d.slice();
  jump[GHOST.stride * 3 + 1] = 9_000_00;
  assert.equal(cleanTape({ ...ok, d: jump }, 100), null, 'a teleport');
  const frac = ok.d.slice();
  frac[GHOST.stride * 2 + 4] = 0.5;
  assert.equal(cleanTape({ ...ok, d: frac }, 100), null);
  assert.equal(cleanTape(null, 100), null);
  assert.equal(cleanTape({ ...ok, d: 'x' }, 100), null);
  // A bad driver code becomes the default rather than failing the run.
  assert.ok(cleanTape({ ...ok, rider: 42 }, 100));
  assert.equal(cleanRun({ ...ok, name: '', time: 100 }), null);
  assert.equal(cleanRun({ ...ok, name: 'Ann', time: 100 })?.name, 'Ann');
});

test('the record holder\'s run is the track\'s ghost; a record without one clears it; slower runs never replace it', async () => {
  const { store, data } = kv();
  const r = new RecordStore(store, () => 1);
  await r.record('Ann', 'koripass', 200, CAR, drive(200));
  assert.equal((await r.ghost('koripass'))?.name, 'Ann');
  assert.equal((await r.ghost('koripass'))?.time, 200);
  // Second place keeps no ghost.
  await r.record('Bob', 'koripass', 210, CAR, drive(210));
  assert.equal((await r.ghost('koripass'))?.name, 'Ann');
  // A new record brings its own run.
  await r.record('Bob', 'koripass', 190, CAR, drive(190));
  assert.equal((await r.ghost('koripass'))?.name, 'Bob');
  // A record set without a usable run leaves no ghost (the old one isn't the record any more).
  await r.record('Cy', 'koripass', 185, CAR, { car: CAR, rider: '', d: [1, 2, 3] });
  assert.equal(await r.ghost('koripass'), null);
  assert.ok(!data.has('gh:koripass'));
  await r.record('Ann', 'koripass', 180, CAR);
  assert.equal(await r.ghost('koripass'), null);
  assert.equal(await r.ghost('saltwind'), null);
  assert.equal(await r.ghost('nowhere'), null);
  // A ghost that no longer matches the board's top (say, the boards were rebuilt) isn't served.
  await r.record('Dee', 'saltwind', 150, CAR, drive(150));
  data.set('lb:saltwind', [{ name: 'Eve', time: 140, car: CAR, at: 0 }]);
  assert.equal(await r.ghost('saltwind'), null);
});

/** A race room with fake sockets, a hand-wound clock and a record ghost source. */
function room(runs: Partial<Record<TrackId, GhostRun>>) {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const results: Map<number, GhostTape>[] = [];
  const race = new Race('GHST', () => {}, () => {}, (_rows, _users, _track, tapes) => results.push(tapes), () => now, false);
  race.ghostSource = async (t) => runs[t] ?? null;
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: CAR, rider: '', user: true };
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
  return { race, join, advance, last, results, flush: () => new Promise((r) => setTimeout(r, 0)) };
}

test('the host turns the record ghost on; the lobby says whose it is and the race loads with it', async () => {
  const run: GhostRun = { name: 'Ann', time: 200, ...drive(200) };
  const r = room({ koripass: run });
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(b, { t: 'ghost', on: true });
  assert.equal(r.race.ghost, false, 'only the host');
  r.race.handle(a, { t: 'ghost', on: true });
  await r.flush();
  const rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && rm.ghost && rm.record?.name === 'Ann' && rm.record.time === 200);
  // A track with no record: the lobby says so.
  r.race.handle(a, { t: 'track', track: 'saltwind' });
  await r.flush();
  const rm2 = r.last(2, 'room');
  assert.ok(rm2 && rm2.t === 'room' && rm2.ghost && rm2.record === null);
  r.race.handle(a, { t: 'track', track: 'koripass' });
  await r.flush();
  r.race.handle(a, { t: 'start' });
  const ld = r.last(2, 'load');
  assert.ok(ld && ld.t === 'load');
  assert.equal(ld.ghost?.name, 'Ann');
  assert.equal(ld.ghost?.d.length, run.d.length);
});

test('with the ghost off, the race loads without one', async () => {
  const r = room({ koripass: { name: 'Ann', time: 200, ...drive(200) } });
  const a = r.join(1);
  r.race.handle(a, { t: 'start' });
  const ld = r.last(1, 'load');
  assert.ok(ld && ld.t === 'load' && ld.ghost === null);
});

test("the room records each finisher's run from the poses they send", () => {
  const r = room({});
  const a = r.join(1);
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  while (r.race.phase !== 'racing') r.advance(50);
  const pose = (z: number) => ({ t: 'state' as const, p: [0, 1, z] as [number, number, number], q: Q, v: [0, 0, -30] as [number, number, number], w: 0, s: -z, st: 0, ws: 80, rpm: 5000, f: 0 });
  for (let i = 0; i < 20 * 60; i++) {
    r.advance(50);
    r.race.handle(a, pose(-1.5 * i));
  }
  r.race.handle(a, { t: 'finish', time: 60 });
  assert.equal(r.results.length, 1);
  const tape = r.results[0].get(1)!;
  assert.equal(tape.car, CAR);
  assert.ok(cleanTape(tape, 60), 'a valid run of the finish time');
  const k = unpack(tape.d);
  assert.ok(Math.abs(k.t.length - 60 / GHOST.every) <= 2);
});
