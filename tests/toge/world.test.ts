// The open world (Toge, free roam): its ground, bridges, walls, traffic and speed, and the free-roam room.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/toge/shared/cars.ts';
import { MODE_TRACK, RACE_MODES, modeTracks, type RaceServerMsg } from '../../src/toge/shared/protocol.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import { RACE_TRACKS, TRACK_DEFS, getTrack, gridSlot, heightAt, locate, newLoc } from '../../src/toge/shared/track.ts';
import { TICK_DT, newCar, speedOf, stepCar, yawOf } from '../../src/toge/shared/vehicle.ts';
import { WORLD, coveredBy, respawnAt, trapCrossed, wallsNear, worldHeight } from '../../src/toge/shared/world.ts';
import { NEAR_MISS, collideWorldTraffic, newNearMisses, routePose, stepNearMisses } from '../../src/toge/shared/worldtraffic.ts';
import { newPose } from '../../src/toge/shared/traffic.ts';

const t = getTrack('toge');
const w = t.world!.world;

test('world: the open world is only for free roam, and free roam only drives it', () => {
  assert.ok(TRACK_DEFS.toge.world);
  assert.ok(!RACE_TRACKS.includes('toge'));
  assert.deepEqual(modeTracks('roam'), ['toge']);
  for (const m of Object.keys(RACE_MODES) as (keyof typeof RACE_MODES)[]) if (m !== 'roam') assert.ok(!modeTracks(m).includes('toge'), m);
  assert.equal(MODE_TRACK.roam, 'toge');
});

test('world: every road stands on its own ground, and the fast roads stay gentle', () => {
  for (const rd of w.roads) {
    let worst = 0;
    for (let i = rd.i0; i < rd.i1; i += 3) {
      // Where another road overlaps it (a junction, a ramp merging, the lookout off the summit loop) the two blend.
      if (coveredBy(w, w.x[i], w.z[i], w.y[i], w.road[i], 6)) continue;
      const y = worldHeight(w, w.x[i], w.z[i], i);
      assert.ok(Math.abs(y - w.y[i]) < 0.1, `${rd.def.id}: ground ${y.toFixed(2)} under a road sample at ${w.y[i].toFixed(2)} (${w.x[i].toFixed(0)}, ${w.z[i].toFixed(0)})`);
      if (i + 1 < rd.i1 && !w.deck[i]) worst = Math.max(worst, Math.abs(w.y[i + 1] - w.y[i]) / 2);
    }
    const kind = rd.def.kind;
    if (kind === 'highway' || kind === 'avenue' || kind === 'street' || kind === 'runway' || kind === 'lot') assert.ok(worst < 0.07, `${rd.def.id}: a ${(worst * 100).toFixed(1)}% grade`);
  }
});

test('world: a viaduct is a second layer: a car on it stays on it, everything else sees the ground below', () => {
  assert.ok(w.deckSpans.length >= 2, 'the expressway has its viaducts');
  let checked = 0;
  for (const [a, b] of w.deckSpans) {
    const i = (a + b) >> 1;
    const below = worldHeight(w, w.x[i], w.z[i], -1);
    if (w.y[i] - below < 6) continue;
    assert.ok(Math.abs(worldHeight(w, w.x[i], w.z[i], i) - w.y[i]) < 0.1, 'on the deck with a hint on it');
    checked++;
  }
  assert.ok(checked > 0, 'some viaduct stands well clear of the ground');
});

test('world: the expressway has rails and a median a car runs into', () => {
  const hw = w.byId.get('hw')!;
  const i = hw.i0 + Math.floor((hw.i1 - hw.i0) * 0.1);
  assert.ok(wallsNear(w, w.x[i], w.z[i]), 'walls hashed by the median');
  // Drive across the carriageway at the median at 25 m/s: the barrier turns the car back.
  const d = -4;
  const x = w.x[i] - w.tz[i] * d;
  const z = w.z[i] + w.tx[i] * d;
  const yaw = Math.atan2(w.tz[i], -w.tx[i]); // facing +d (to the right of the road, toward the median)
  const car = newCar(carSpec(newOwnedCar('pebble')), x, heightAt(t, x, z, undefined, i) + 0.5, z, yaw);
  car.hint = i;
  car.v.x = -Math.sin(yaw) * 25;
  car.v.z = -Math.cos(yaw) * 25;
  const input = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  for (let k = 0; k < 120; k++) stepCar(car, input, t);
  const across = -(car.p.x - w.x[i]) * w.tz[i] + (car.p.z - w.z[i]) * w.tx[i];
  assert.ok(across < 0.5, `the car got through the median (${across.toFixed(1)} m across)`);
});

test('world: grid slots, respawns and the speed traps', () => {
  for (let k = 0; k < 8; k++) {
    const g = gridSlot(t, k);
    assert.ok(Math.abs(g.y - WORLD.cityY) < 0.6, `slot ${k} is on the meet`);
  }
  // Off in a field near the expressway: back on the road, facing along it the way you were going.
  const hw = w.byId.get('hw')!;
  const i = hw.i0 + 40;
  const at = respawnAt(w, w.x[i] + 60, w.z[i] + 60, 0);
  const loc = locate(t, at.x, at.z, at.i, newLoc());
  assert.ok(Math.abs(loc.d) < 12, 'on the road');
  assert.ok(Math.abs(at.y - heightAt(t, at.x, at.z, undefined, at.i)) < 0.1);
  for (const trap of w.traps) {
    assert.equal(trapCrossed(w, trap.x - trap.tx * 3, trap.z - trap.tz * 3, trap.x + trap.tx * 3, trap.z + trap.tz * 3), trap);
    assert.equal(trapCrossed(w, trap.x + trap.tx * 3, trap.z + trap.tz * 3, trap.x + trap.tx * 9, trap.z + trap.tz * 9), null);
  }
});

/** Drives a Vanta flat out along road `id` from `frac` of the way along, keeping to lane `lane`; its top speed (m/s). */
function flatOut(id: string, frac: number, secs: number, dir: 1 | -1, lane: number) {
  const rd = w.byId.get(id)!;
  const n = rd.i1 - rd.i0;
  const i = rd.i0 + Math.floor(n * frac);
  const px = w.x[i] - w.tz[i] * lane;
  const pz = w.z[i] + w.tx[i] * lane;
  const car = newCar(carSpec(newOwnedCar('vanta')), px, heightAt(t, px, pz, undefined, i) + 0.6, pz, Math.atan2(-w.tx[i] * dir, -w.tz[i] * dir));
  car.hint = i;
  const input = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
  let top = 0;
  for (let k = 0; k < secs / TICK_DT; k++) {
    const j = w.road[car.hint] === w.road[rd.i0] ? car.hint : i;
    let a = j - rd.i0 + dir * Math.round(Math.max(8, speedOf(car) * 0.6) / 2);
    a = rd.closed ? ((a % n) + n) % n : Math.max(0, Math.min(n - 1, a));
    const ti = rd.i0 + a;
    const want = Math.atan2(-(w.x[ti] - w.tz[ti] * lane - car.p.x), -(w.z[ti] + w.tx[ti] * lane - car.p.z));
    let d = want - yawOf(car);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    input.steer = Math.max(-1, Math.min(1, -d * 2.5));
    stepCar(car, input, t);
    top = Math.max(top, speedOf(car));
  }
  return top;
}

test('world: the Bayshore straight and the old runway are flat-out places (300 km/h in a Vanta)', () => {
  // The Bayshore runs north from its south end, on the northbound (left, keep-left) carriageway.
  assert.ok(flatOut('hw', 0, 40, -1, 6.35) * 3.6 > 290, 'Bayshore');
  assert.ok(flatOut('runway', 0, 25, 1, 0) * 3.6 > 250, 'runway');
});

test('world: traffic keeps to its lanes on the road, and never runs into itself', () => {
  const p = newPose();
  for (const r of w.routes) {
    assert.ok(r.cars.length > 0, r.name);
    // The roads the route runs on (the pass's loop goes round the summit too).
    const on = w.roads.filter((rd) => r.name.startsWith(rd.def.id) || (r.name === 'pass' && rd.def.id === 'summit'));
    for (let k = 0; k < r.cars.length; k += 3) {
      routePose(r, k, 1234.5, p);
      let best = Infinity;
      for (const rd of on) for (let i = rd.i0; i < rd.i1; i++) best = Math.min(best, Math.hypot(w.x[i] - p.x, w.z[i] - p.z) - rd.half);
      assert.ok(best < 0.5, `${r.name}: car ${k} is ${best.toFixed(1)} m off the road`);
    }
    // One speed per lane: the gaps never change, so they only have to start long enough.
    const s = r.cars.map((c) => c.s0).sort((a, b) => a - b);
    for (let k = 1; k < s.length; k++) assert.ok(s[k] - s[k - 1] > 8, `${r.name}: cars ${s[k] - s[k - 1]} m apart`);
    assert.ok(s[0] + r.length - s[s.length - 1] > 8, `${r.name}: the wrap gap`);
  }
});

/** A car `gap` m beside (to the right of) traffic car `k` of the first expressway lane, `back` m behind it, going `v` m/s. */
function besideTraffic(gap: number, back: number, v: number, time: number) {
  const r = w.routes[0];
  const p = routePose(r, 0, time, newPose());
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  // Right of travel is (-fz, fx).
  const x = p.x - fx * back - fz * gap;
  const z = p.z - fz * back + fx * gap;
  const car = newCar(carSpec(newOwnedCar('vanta')), x, p.y + 0.6, z, p.yaw);
  car.hint = locate(t, x, z, -1, newLoc()).i;
  car.v.x = fx * v;
  car.v.z = fz * v;
  return car;
}

test('world: threading past traffic quickly is a near miss; slow, wide or touching is not', () => {
  const count = (gap: number, v: number) => {
    const time = 100;
    const car = besideTraffic(gap, 12, v, time);
    const nm = newNearMisses();
    let total = 0;
    // Hold the car on its line past the traffic (the near-miss check only needs where it is).
    const route = w.routes[0];
    for (let k = 0; k < 120; k++) {
      const tt = time + k * TICK_DT;
      const p = routePose(route, 0, tt, newPose());
      const rel = (v - route.v) * k * TICK_DT;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      car.p.x = p.x + fx * (rel - 12) - fz * gap;
      car.p.z = p.z + fz * (rel - 12) + fx * gap;
      car.p.y = p.y + car.spec.cg;
      total += stepNearMisses(nm, w, car, tt, tt) ? 1 : 0;
    }
    return total;
  };
  assert.equal(count(2.6, 60), 1, 'close and quick');
  assert.equal(count(5, 60), 0, 'too wide');
  assert.equal(count(2.6, w.routes[0].v + 4), 0, 'barely passing');
  assert.ok(NEAR_MISS.close < 5);
});

test('world: driving into a traffic car bumps you off it', () => {
  const car = besideTraffic(0, 2.5, 40, 200);
  const before = speedOf(car);
  collideWorldTraffic(w, car, 200);
  // The traffic car's doing 31 m/s: running into its back at 40 takes most of the difference off.
  assert.ok(speedOf(car) < before - 3, 'it slowed you');
});

// --- The free-roam room ---------------------------------------------------------------------------

function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('ROAM', () => {}, () => {}, () => {}, () => now, false);
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: false };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let k = 0; k < ms; k += 50) {
      now += 50;
      race.tick();
    }
  };
  const last = (id: number, type: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === type).at(-1);
  return { race, join, advance, last };
}

test('free roam: no countdown, no finish, friends drive in, and it runs until the host ends it', () => {
  const r = room();
  const a = r.join(1);
  r.race.handle(a, { t: 'mode', mode: 'roam' });
  assert.equal(r.race.track, 'toge');
  r.race.handle(a, { t: 'cpu', op: 'add' });
  assert.equal(r.race.members.size, 1, 'no CPU racers in free roam');
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  const cd = r.last(1, 'countdown');
  assert.ok(cd && cd.t === 'countdown' && cd.ms === 0);
  r.advance(100);
  assert.equal(r.race.phase, 'racing');
  // An hour later it's still on (a race would have timed out long since).
  r.advance(3_600_000);
  assert.equal(r.race.phase, 'racing');
  // A friend joins: they're in the lobby until they ask to drive in, then they load and go.
  const b = r.join(2);
  const seen = r.last(2, 'room');
  assert.ok(seen && seen.t === 'room' && seen.phase === 'racing' && seen.racers.find((x) => x.id === 1)?.roaming && !seen.racers.find((x) => x.id === 2)?.roaming);
  r.race.handle(b, { t: 'joinin' });
  const ld = r.last(2, 'load');
  assert.ok(ld && ld.t === 'load' && ld.track === 'toge' && ld.grid[2] === 1 && ld.grid[1] === 0);
  r.race.handle(b, { t: 'ready' });
  assert.ok(r.last(2, 'go'), 'straight into it');
  const now = r.last(1, 'room');
  assert.ok(now && now.t === 'room' && now.racers.find((x) => x.id === 2)?.roaming, 'the host sees them out on the road');
  // Only the host ends it.
  r.race.handle(b, { t: 'end' });
  assert.equal(r.race.phase, 'racing');
  r.race.handle(a, { t: 'end' });
  assert.equal(r.race.phase, 'lobby');
  // Back to a race: back to a race track.
  r.race.handle(a, { t: 'mode', mode: 'race' });
  assert.ok(RACE_TRACKS.includes(r.race.track));
});
