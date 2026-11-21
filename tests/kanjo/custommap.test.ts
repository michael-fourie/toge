import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { aiDrive, newAi } from '../../src/kanjo/shared/driver.ts';
import { gapFall, skyFall } from '../../src/kanjo/shared/skyfall.ts';
import { TRACK_LENGTH_KM } from '../../src/kanjo/shared/garage.ts';
import { RACE, type RaceServerMsg, type ResultRow, modeTracks } from '../../src/kanjo/shared/protocol.ts';
import { RACE_TRACKS, TRACK_DEFS, getTrack, gridSlot } from '../../src/kanjo/shared/track.ts';
import { type DriveInput, TICK_DT, newCar, stepCar } from '../../src/kanjo/shared/vehicle.ts';
import { Race, type RaceClient } from '../../src/kanjo/server/race.ts';
import { MapStore } from '../../src/kanjo/server/mapStore.ts';
import {
  type CustomMap,
  MAP,
  MAP_TEMPLATES,
  applyMapAction,
  blankMap,
  checkMap,
  cleanMap,
  decodeMapCode,
  isCustomTrack,
  mapCode,
  mapFromTrack,
  mapTrackId,
  registerMap,
} from '../../src/kanjo/shared/custommap.ts';

// The map builder's maps (custommap.ts): players' own tracks, built by the game's own track builder, driven solo and
// raced online. Michael, 2026-11-21: "Build a fully interactive map builder".

const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

test('every template is a map you can race, and a built-in track remixes into one', () => {
  for (const t of MAP_TEMPLATES) {
    const c = checkMap(t.make());
    assert.ok(c.ok, `${t.id}: ${c.errors.map((e) => e.msg).join('; ')}`);
    assert.ok(c.km > 1, `${t.id}: ${c.km} km`);
  }
  // Remixes: most built-in tracks come over as maps that pass the same check.
  let remixed = 0;
  for (const id of RACE_TRACKS) {
    const m = mapFromTrack(id);
    if (!m) continue;
    remixed++;
    const c = checkMap(m);
    assert.ok(c.ok || c.errors.every((e) => /apart/.test(e.msg)), `${id}: ${c.errors.map((e) => e.msg).join('; ')}`);
  }
  assert.ok(remixed >= 15, `${remixed} remixable tracks`);
  assert.equal(mapFromTrack('kanjo'), null, 'not the open world');
  assert.equal(mapFromTrack('futamata'), null, 'not a fork');
});

test('cleanMap: junk in, a well-formed map or nothing out', () => {
  assert.equal(cleanMap(null), null);
  assert.equal(cleanMap({ name: 'x', points: [[0, 0, 0]] }), null, 'one point');
  assert.equal(cleanMap({ name: '', points: blankMap().points }), null, 'no name');
  assert.equal(cleanMap({ name: 'x', points: [[0, NaN, 0], [1, 1, 1]] }), null, 'NaN');
  const m = cleanMap({
    ...blankMap(),
    name: '  <b>Night\u0000 run</b>  ',
    width: 900,
    laps: -4,
    theme: 'moon',
    points: [...blankMap().points.slice(0, 6), [99999, 99999, -99999]],
    features: [
      { kind: 'jump', at: 0, size: 2, kick: 20, drop: 5, land: 100 }, // on the first point: dropped
      { kind: 'jump', at: 2, size: 50, kick: 20, drop: 500, land: 100 }, // clamped
      { kind: 'crest', at: 2, size: 1, len: 40 }, // a second on the same point: dropped
      { kind: 'gravel', from: 4, to: 2, size: 0 }, // backwards: dropped
      { kind: 'tunnel', from: 3, to: 5 },
      { kind: 'rocket', at: 3 },
    ],
  })!;
  assert.equal(m.name, 'bNight run/b');
  assert.equal(m.width, MAP.width.max);
  assert.equal(m.laps, MAP.laps.min);
  assert.equal(m.theme, 'alpine');
  assert.deepEqual(m.points.at(-1), [MAP.reach, MAP.heightMax, -MAP.reach]);
  assert.deepEqual(
    m.features.map((f) => f.kind),
    ['jump', 'tunnel'],
  );
  const jump = m.features[0] as Extract<CustomMap['features'][number], { kind: 'jump' }>;
  assert.equal(jump.size, 4);
  assert.equal(jump.drop, 20);
  // Circuits are clean: no features, props or traffic.
  const loop = cleanMap({ ...MAP_TEMPLATES[1].make(), features: [{ kind: 'crest', at: 2, size: 2, len: 40 }], props: 'course', traffic: 'town' })!;
  assert.deepEqual([loop.features.length, loop.props, loop.traffic], [0, 'clean', 'none']);
  // Cleaning is idempotent, so the room and every client agree on the id.
  assert.deepEqual(cleanMap(m), m);
  assert.equal(mapTrackId(cleanMap(m)!), mapTrackId(m));
});

test('checkMap: says what stops a race, and where', () => {
  const short = { ...blankMap(), points: [[0, 100, 0], [0, 100, -200]] as [number, number, number][] };
  assert.ok(checkMap(short).errors.some((e) => /at least 400 m/.test(e.msg)));
  const close = { ...blankMap(), points: [[0, 100, 0], [0, 100, -2], [0, 100, -600]] as [number, number, number][] };
  assert.ok(checkMap(close).errors.some((e) => e.point === 0 && /apart/.test(e.msg)));
  const steep = { ...blankMap(), points: [[0, 100, 0], [0, 100, -300], [0, 160, -500], [0, 160, -900]] as [number, number, number][] };
  assert.ok(checkMap(steep).errors.some((e) => /steep|climbs/.test(e.msg)), JSON.stringify(checkMap(steep).errors));
  // A road that doubles back over itself.
  const cross = { ...blankMap(), points: [[0, 100, 0], [0, 100, -500], [300, 100, -500], [300, 100, -250], [-300, 100, -250], [-300, 100, -600]] as [number, number, number][] };
  const c = checkMap(cross);
  assert.ok(!c.ok && c.errors.some((e) => e.at && /crosses|overlap/.test(e.msg)), JSON.stringify(c.errors));
  // Town traffic needs a wide enough road.
  assert.ok(checkMap({ ...blankMap(), traffic: 'town', width: 10 }).errors.some((e) => /traffic/.test(e.msg)));
  assert.ok(checkMap({ ...blankMap(), traffic: 'town', width: 15 }).ok);
});

test('a registered map is a track every screen can look up, but never a built-in one', () => {
  const m = MAP_TEMPLATES[1].make();
  const id = registerMap(m);
  assert.ok(isCustomTrack(id) && id === mapTrackId(m) && registerMap(cleanMap(m)!) === id);
  assert.equal(TRACK_DEFS[id].name, m.name);
  const t = getTrack(id);
  assert.equal(t.def.laps, m.laps);
  assert.ok(Math.abs(TRACK_LENGTH_KM[id] - (t.finishS - t.startS) / 1000) < 0.06);
  assert.ok(!RACE_TRACKS.includes(id) && !modeTracks('race').includes(id), 'not in the built-in lists');
  // An edit is another track.
  assert.notEqual(mapTrackId({ ...m, width: m.width + 1 }), id);
  // Codes round-trip.
  assert.deepEqual(decodeMapCode(mapCode(m)), cleanMap(m));
  assert.equal(decodeMapCode('nonsense'), null);
});

test('the AI drives every template to the finish without falling off', { timeout: 120_000 }, () => {
  for (const tp of MAP_TEMPLATES) {
    const t = getTrack(registerMap(tp.make()));
    for (const model of ['pebble', 'vanta'] as const) {
      const g = gridSlot(t, 0);
      const car = newCar(carSpec(newOwnedCar(model)), g.x, g.y, g.z, g.yaw);
      const ai = newAi(0.9, 0);
      const inp = { ...idle };
      let time = 0;
      while (car.s < t.finishS && time < 400) {
        aiDrive(car, t, ai, TICK_DT, inp);
        stepCar(car, inp, t);
        assert.ok(!gapFall(car, t) && !skyFall(car, t), `${tp.id}: ${model} fell at ${car.s.toFixed(0)}`);
        time += TICK_DT;
      }
      assert.ok(car.s >= t.finishS, `${tp.id}: ${model} stuck at ${car.s.toFixed(0)} of ${t.finishS.toFixed(0)}`);
    }
  }
});

test('saved maps: save, replace, cap, delete; the server store keeps them per account', async () => {
  const s = { id: 'abcd1234', at: 0, map: blankMap() };
  let r = applyMapAction([], { a: 'save', map: s }, 5);
  assert.ok(r.ok && r.list.length === 1 && r.list[0].at === 5);
  r = applyMapAction(r.ok ? r.list : [], { a: 'save', map: { ...s, map: { ...s.map, name: 'Renamed' } } }, 6);
  assert.ok(r.ok && r.list.length === 1 && r.list[0].map.name === 'Renamed');
  assert.ok(!applyMapAction([], { a: 'save', map: { ...s, id: 'bad id!' } }, 0).ok);
  const full = Array.from({ length: MAP.maxSaved }, (_, i) => ({ ...s, id: `map${String(i).padStart(4, '0')}` }));
  assert.ok(!applyMapAction(full, { a: 'save', map: { ...s, id: 'newone99' } }, 0).ok, 'over the cap');
  assert.ok(applyMapAction(full, { a: 'save', map: { ...s, id: 'map0003' } }, 0).ok, 'replacing one is fine');
  r = applyMapAction(full, { a: 'delete', id: 'map0003' }, 0);
  assert.ok(r.ok && r.list.length === MAP.maxSaved - 1);

  const kv = new Map<string, unknown>();
  const store = new MapStore({ get: async <T>(k: string) => kv.get(k) as T, put: async (k, v) => void kv.set(k, v), delete: async (k) => kv.delete(k) });
  assert.ok((await store.act('Alice', { a: 'save', map: s }, 1)).ok);
  assert.equal((await store.list('alice')).length, 1);
  assert.equal((await store.list('bob')).length, 0);
});

/** A race room with fake sockets and a hand-wound clock (as in raceroom.test.ts). */
function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const paid: ResultRow[][] = [];
  const race = new Race('MAPS', () => {}, () => {}, (rows) => void paid.push(rows), () => now, false);
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
  return { race, join, advance, last, paid };
}

test('online: the host races a custom map; everyone gets it, nobody gets paid for it', () => {
  const r = room();
  const a = r.join(1, true);
  const b = r.join(2, true);
  const m = MAP_TEMPLATES[0].make();
  // Only the host, only in a race or time trial, only a map that can be raced.
  r.race.handle(b, { t: 'map', map: m });
  assert.equal(r.race.map, null);
  r.race.handle(a, { t: 'map', map: { ...m, points: m.points.slice(0, 2) } });
  assert.equal(r.race.map, null, 'too short to race');
  r.advance(2000);
  r.race.handle(a, { t: 'map', map: m });
  assert.ok(r.race.map && isCustomTrack(r.race.track) && r.race.track === mapTrackId(cleanMap(m)!));
  const rm = r.last(2, 'room');
  assert.ok(rm?.t === 'room' && rm.map?.name === m.name && rm.track === r.race.track);
  // A time trial keeps it; a Grand Prix can't run it.
  r.race.handle(a, { t: 'mode', mode: 'trial' });
  assert.ok(r.race.map);
  r.race.handle(a, { t: 'mode', mode: 'race' });
  assert.ok(r.race.map);
  // The race: the map rides on `load`, the finish has no prize, no XP, and nothing is paid or recorded.
  r.race.handle(a, { t: 'start' });
  const ld = r.last(2, 'load');
  assert.ok(ld?.t === 'load' && ld.map?.name === m.name && ld.ghost === null);
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  r.advance(60_000);
  r.race.handle(a, { t: 'finish', time: 60 });
  r.race.handle(b, { t: 'finish', time: 60.1 });
  const res = r.last(1, 'results');
  assert.ok(res?.t === 'results' && res.rows.every((row) => row.prize === 0 && row.xp === 0), JSON.stringify(res));
  assert.equal(r.paid.length, 0, 'onResults never ran');
  // Back in the lobby, picking a built-in track drops the map; so does a mode that can't run one.
  r.advance(RACE.resultsSeconds * 1000 + 100);
  r.race.handle(a, { t: 'mode', mode: 'gp' });
  assert.equal(r.race.map, null);
  assert.ok(!isCustomTrack(r.race.track));
  r.advance(2000);
  r.race.handle(a, { t: 'mode', mode: 'race' });
  r.race.handle(a, { t: 'map', map: m });
  assert.ok(r.race.map);
  r.race.handle(a, { t: 'track', track: 'saltwind' });
  assert.equal(r.race.map, null);
  assert.equal(r.race.track, 'saltwind');
});
