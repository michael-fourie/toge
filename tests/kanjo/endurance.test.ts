import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Race, type RaceClient } from '../../src/kanjo/server/race.ts';
import { ENDURANCE, MODE_TRACK, RACE, RACE_MODES, cleanLaps, cleanMode, isGp, modeTracks, recordMode, type RaceServerMsg } from '../../src/kanjo/shared/protocol.ts';
import { SAMPLE, TRACK_DEFS, getTrack, lapOf } from '../../src/kanjo/shared/track.ts';
import { TRACK_LENGTH_KM } from '../../src/kanjo/shared/garage.ts';
import { lapsLabel, raceKm, runLabel } from '../../src/kanjo/client/loadingcopy.ts';

// Endurance (2026-11-12, Andrew: "a new game mode in Host a Race, where you can race a map that is a complete lap, and
// you can increase the number of laps ... between 1 to 100 laps").

function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('ENDR', () => {}, () => {}, () => {}, () => now, false);
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: false };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      race.tick();
    }
  };
  const last = (id: number, t: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === t).at(-1);
  return { race, join, advance, last };
}

test('Endurance runs every circuit (never a pass, the open world or a royale arena), race rules, no best times', () => {
  assert.equal(RACE_MODES.endurance.name, 'Endurance');
  const pool = modeTracks('endurance');
  assert.ok(pool.length >= 10);
  for (const id of pool) assert.ok(TRACK_DEFS[id].laps && !TRACK_DEFS[id].royale && !TRACK_DEFS[id].world, id);
  for (const id of ['monza', 'spa', 'kodama', 'hachi', 'hibari', 'kumo', 'taketomi'] as const) assert.ok(pool.includes(id), id);
  assert.ok(!pool.includes('koripass') && !pool.includes('shura') && !pool.includes('karasu'));
  assert.ok(pool.includes(MODE_TRACK.endurance));
  assert.equal(isGp('endurance'), false);
  assert.equal(cleanMode('endurance'), false, 'everyone drives their own car, like a race');
  assert.equal(recordMode('endurance'), false, 'a 50-lap Monza is no Monza record');
});

test('the host picks 1 to 100 whole laps', () => {
  assert.deepEqual([ENDURANCE.min, ENDURANCE.max], [1, 100]);
  assert.deepEqual([cleanLaps(0), cleanLaps(1), cleanLaps(37.4), cleanLaps(100), cleanLaps(1e9), cleanLaps(-5)], [1, 1, 37, 100, 100, 1]);
  assert.equal(cleanLaps('10'), null);
  assert.equal(cleanLaps(NaN), null);
  assert.equal(cleanLaps(Infinity), null);
  assert.equal(lapsLabel(1), '1 lap');
  assert.equal(lapsLabel(42), '42 laps');
});

test('a circuit unrolls to any lap count: the same road every lap, the finish after the last one', () => {
  for (const id of ['kodama', 'monza', 'hibari'] as const) {
    const own = getTrack(id);
    for (const laps of [1, 7, 100]) {
      const t = getTrack(id, laps);
      assert.equal(t.def.laps, laps);
      assert.equal(t.lap, own.lap, 'a lap is a lap');
      assert.equal(t.finishS - t.startS, laps * t.lap * SAMPLE, `${id} ×${laps}: the finish is ${laps} laps on`);
      assert.equal(lapOf(t, t.finishS - 1), laps);
      // Every lap is the same road (positions repeat a lap apart).
      const s = Math.round(t.startS / SAMPLE) + Math.floor(t.lap / 3);
      const k = s + (laps - 1) * t.lap;
      assert.ok(Math.hypot(t.x[s] - t.x[k], t.z[s] - t.z[k]) < 1e-6, `${id} ×${laps}`);
    }
    assert.equal(getTrack(id, TRACK_DEFS[id].laps), own, 'its own lap count is the cached track');
    assert.equal(getTrack(id, 7), getTrack(id, 7), 'built once');
  }
  assert.equal(raceKm('monza', TRACK_DEFS.monza.laps), TRACK_LENGTH_KM.monza, 'its own lap count is its own distance');
  assert.ok(Math.abs(raceKm('monza', 30) - raceKm('monza', 3) * 10) < 0.11, 'the distance scales with the laps');
  assert.equal(runLabel({ track: 'monza', online: { mode: 'endurance', racers: 3, laps: 25 } }), 'Endurance · 25 laps · 3 racers');
});

test('an Endurance lobby: the host sets the laps, everyone sees them, the race loads that many', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'track', track: 'spa' });
  r.race.handle(a, { t: 'laps', laps: 40 });
  assert.equal(r.race.laps, ENDURANCE.start, 'laps only in an Endurance lobby');
  r.race.handle(a, { t: 'mode', mode: 'endurance' });
  assert.equal(r.race.mode, 'endurance');
  assert.equal(r.race.track, 'spa', 'a circuit that was already up stays');
  r.race.handle(b, { t: 'laps', laps: 40 });
  assert.equal(r.race.laps, ENDURANCE.start, 'only the host');
  r.race.handle(a, { t: 'laps', laps: 40 });
  assert.equal(r.race.laps, 40);
  r.race.handle(a, { t: 'laps', laps: 500 });
  assert.equal(r.race.laps, 100, 'clamped');
  r.race.handle(a, { t: 'laps', laps: 'lots' as never });
  assert.equal(r.race.laps, 100, 'junk is ignored');
  r.race.handle(a, { t: 'laps', laps: 3 });
  const rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && rm.laps === 3 && rm.mode === 'endurance');
  r.race.handle(a, { t: 'track', track: 'koripass' });
  assert.equal(r.race.track, 'spa', 'no passes');
  r.race.handle(a, { t: 'start' });
  const ld = r.last(2, 'load');
  assert.ok(ld && ld.t === 'load' && ld.laps === 3 && ld.track === 'spa' && ld.ghost === null);
  // Switching from a pass puts up the mode's circuit.
  const s = room();
  const h = s.join(1);
  s.race.handle(h, { t: 'mode', mode: 'endurance' });
  assert.equal(s.race.track, MODE_TRACK.endurance);
});

test('a 1-lap sprint finishes in well under the usual 40 s minimum, and a long race outlasts the 10 minute cap', () => {
  // One lap of Hachi-no-ji (1.2 km) takes about half a minute.
  const r = room();
  const a = r.join(1);
  r.race.handle(a, { t: 'mode', mode: 'endurance' });
  r.race.handle(a, { t: 'track', track: 'hachi' });
  r.race.handle(a, { t: 'laps', laps: 1 });
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  r.advance(RACE.countdownMs + 250);
  assert.equal(r.race.phase, 'racing');
  r.advance(20_000);
  r.race.handle(a, { t: 'finish', time: 20 });
  const res = r.last(1, 'results');
  assert.ok(res && res.t === 'results' && res.rows[0].time !== null && res.rows[0].place === 1, 'counted');

  // 100 laps of Spa: still racing at 10 minutes, and the room takes poses from far down the road.
  const s = room();
  const h = s.join(1);
  s.join(2);
  s.race.handle(h, { t: 'mode', mode: 'endurance' });
  s.race.handle(h, { t: 'track', track: 'spa' });
  s.race.handle(h, { t: 'laps', laps: 100 });
  s.race.handle(h, { t: 'start' });
  s.advance(RACE.loadTimeoutMs + RACE.countdownMs + 500);
  assert.equal(s.race.phase, 'racing');
  s.advance(RACE.maxSeconds * 1000 + 60_000);
  assert.equal(s.race.phase, 'racing', 'no cap at 10 minutes');
  const far = getTrack('spa', 100).lap * SAMPLE * 60;
  s.race.handle(h, { t: 'state', p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: 0, s: far, st: 0, ws: 0, rpm: 1000, f: 0 });
  assert.equal(s.race.members.get(1)!.state?.s, far, 'a pose 60 laps in is taken');
  // The cap is the distance at ENDURANCE.slowest m/s.
  const cap = (getTrack('spa', 100).lap * SAMPLE * 100) / ENDURANCE.slowest + ENDURANCE.spare;
  s.advance(cap * 1000);
  const end = s.last(1, 'results');
  assert.ok(end && end.t === 'results' && end.rows.every((x) => x.time === null), 'called off in the end, everyone DNF');
});
