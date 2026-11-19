import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOST, type BoostPad, onBoostPad, padKick } from '../../src/kanjo/shared/boost.ts';
import { carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { RACE_TRACKS, SAMPLE, TRACK_DEFS, type TrackId, buildTrack, getTrack, gridSlot } from '../../src/kanjo/shared/track.ts';
import { HIGHWAY_LANES, getTraffic, lanesOf } from '../../src/kanjo/shared/traffic.ts';
import { type Car, type DriveInput, TICK_HZ, forwardSpeed, newCar, stepCar } from '../../src/kanjo/shared/vehicle.ts';

const flat = buildTrack({ id: 'koripass', name: 'flat', tag: '', blurb: '', theme: 'alpine', seed: 1, width: 12, relief: 0, points: Array.from({ length: 21 }, (_, i) => [0, 100, -i * 200] as [number, number, number]) });
const gas: DriveInput = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

function carOn(): Car {
  const g = gridSlot(flat, 0);
  return newCar(carSpec(newOwnedCar('shiro')), g.x, g.y, g.z, g.yaw);
}

test('every race track has a few boost pads, each covering only part of the road, clear of jumps and props', () => {
  for (const id of RACE_TRACKS) {
    const t = getTrack(id);
    const laps = t.def.laps ?? 1;
    // (A survival road has none: nothing to help you down.)
    if (t.def.survival) {
      assert.equal(t.boosts.length, 0, `${id}: a survival road has no pads`);
      continue;
    }
    assert.ok(t.boosts.length >= 2 * laps && t.boosts.length <= BOOST.most * laps, `${id}: ${t.boosts.length} pads`);
    for (const p of t.boosts) {
      assert.ok(p.w < t.half, `${id}: a pad never spans the road`);
      assert.ok(Math.abs(p.d) + p.w / 2 <= t.half, `${id}: a pad stays on the asphalt`);
      assert.ok(p.s > t.startS && p.s + p.len < t.finishS + 20, `${id}: a pad is on the race`);
      assert.ok(!t.crests.some((c) => p.s + p.len > c.s - c.len && p.s < c.s + c.len), `${id}: no pad on a jump`);
      assert.ok(!t.props.some((q) => q.s > p.s - 20 && q.s < p.s + p.len + 20), `${id}: no obstacle on a pad`);
      // On the way out of a bend: the road behind it turns more than the road after it.
      const i = Math.round(p.s / SAMPLE);
      const turn = (a: number, b: number) => {
        let k = 0;
        for (let j = Math.max(0, a); j < Math.min(t.n, b); j++) k += Math.abs(t.curv[j]);
        return k;
      };
      assert.ok(turn(i - 40, i - 5) > turn(i, i + 35), `${id}: the pad at s=${p.s.toFixed(0)} is on a corner's exit`);
    }
    // A circuit's pads are the same every lap.
    if (t.lap) {
      const lapLen = t.lap * SAMPLE;
      const per = t.boosts.filter((p) => p.s >= lapLen && p.s < 2 * lapLen).map((p) => (p.s - lapLen).toFixed(1));
      const next = t.boosts.filter((p) => p.s >= 2 * lapLen && p.s < 3 * lapLen).map((p) => (p.s - 2 * lapLen).toFixed(1));
      if (laps > 2) assert.deepEqual(next, per, `${id}: pads repeat every lap`);
    }
  }
});

test('onBoostPad: only inside the pad', () => {
  const pads: BoostPad[] = [{ s: 100, d: 3, len: BOOST.len, w: BOOST.w }];
  assert.ok(onBoostPad(pads, 102, 3));
  assert.ok(!onBoostPad(pads, 99, 3), 'before it');
  assert.ok(!onBoostPad(pads, 100 + BOOST.len + 0.5, 3), 'past it');
  assert.ok(!onBoostPad(pads, 102, 3 - BOOST.w), 'beside it');
  assert.ok(!onBoostPad(pads, 102, -3), 'the other side of the road');
});

test('a boost pad kicks you forward: faster down the straight than without it, and only once per pass', () => {
  const drive = (pads: BoostPad[]) => {
    const car = carOn();
    let kicks = 0;
    for (let i = 0; i < 6 * TICK_HZ; i++) {
      stepCar(car, gas, flat);
      if (padKick(car, pads)) kicks++;
    }
    return { v: forwardSpeed(car), kicks, boost: car.boost };
  };
  // Right where the car will be after a couple of seconds' acceleration, in its lane.
  const g = gridSlot(flat, 0);
  const pads: BoostPad[] = [{ s: g.s + 20, d: 0, len: BOOST.len, w: 12 }];
  const plain = drive([]);
  const kicked = drive(pads);
  assert.equal(plain.kicks, 0);
  assert.equal(kicked.kicks, 1, 'one kick per pass, however many ticks on the pad');
  assert.ok(kicked.v > plain.v + 3, `${kicked.v.toFixed(1)} m/s vs ${plain.v.toFixed(1)} m/s`);
  // In the air, nothing.
  const car = carOn();
  for (const w of car.wheels) w.contact = false;
  car.s = g.s + 22;
  assert.equal(padKick(car, pads), false);
  assert.equal(car.boost, 0);
});

test('a stronger boost already running keeps its push when you cross a pad', () => {
  const car = carOn();
  stepCar(car, gas, flat);
  car.boost = 3;
  car.boostPower = BOOST.accel + 5;
  car.s = 10;
  car.d = 0;
  for (const w of car.wheels) w.contact = true;
  padKick(car, [{ s: 8, d: 0, len: BOOST.len, w: BOOST.w }]);
  assert.equal(car.boost, 3);
  assert.equal(car.boostPower, BOOST.accel + 5);
});

test('Ryūsei Expressway: a highway, four lanes all going with the race, traffic on all of them', () => {
  const t = getTrack('ryusei');
  assert.equal(TRACK_DEFS.ryusei.traffic, 'highway');
  assert.equal(lanesOf(t), HIGHWAY_LANES);
  for (const c of getTraffic(t)!.cars) assert.ok(c.lane >= 0 && c.lane < 4);
  assert.ok(HIGHWAY_LANES.every((l) => l.dir === 1 && Math.abs(l.d) < t.half - 1));
  // The slow lane on the left, the fast one by the median.
  for (let i = 1; i < HIGHWAY_LANES.length; i++) assert.ok(HIGHWAY_LANES[i].v > HIGHWAY_LANES[i - 1].v);
  const tr = getTraffic(t)!;
  for (let lane = 0; lane < 4; lane++) assert.ok(tr.cars.filter((c) => c.lane === lane).length > 10, `lane ${lane} has traffic`);
  // Trucks keep to the slow lanes.
  const trucks = tr.cars.filter((c) => c.kind === 'truck');
  assert.ok(trucks.filter((c) => c.lane < 2).length > 3 * trucks.filter((c) => c.lane >= 2).length);
});

test('Hayate Flats: wide, and no corner turns more than 30°', () => {
  const t = getTrack('hayate');
  assert.ok(t.def.width >= 20);
  let run = 0;
  let sign = 0;
  let most = 0;
  for (let i = Math.floor(t.startS / SAMPLE); i < t.finishS / SAMPLE; i++) {
    const c = t.curv[i];
    if (Math.abs(c) > 1 / 1500 && (run === 0 || Math.sign(c) === sign)) {
      run += c * SAMPLE;
      sign = Math.sign(c);
    } else {
      most = Math.max(most, Math.abs(run));
      run = 0;
      sign = 0;
    }
  }
  assert.ok((most * 180) / Math.PI <= 30.5, `the sharpest corner turns ${((most * 180) / Math.PI).toFixed(1)}°`);
  assert.ok((most * 180) / Math.PI > 25, 'but there are real corners');
});

test('Hayate Flats has highway traffic too, its four lanes spread across the wide road', () => {
  const t = getTrack('hayate');
  assert.equal(TRACK_DEFS.hayate.traffic, 'highway');
  const lanes = lanesOf(t);
  assert.equal(lanes.length, 4);
  assert.ok(lanes.every((l, i) => l.dir === 1 && l.v === HIGHWAY_LANES[i].v), 'same speeds, all going with the race');
  assert.ok(lanes[3].d > HIGHWAY_LANES[3].d + 1 && lanes[3].d < t.half - 1.5, 'the outer lanes use the extra width, still on the asphalt');
  for (let i = 1; i < 4; i++) assert.ok(lanes[i].d - lanes[i - 1].d > 3.5, 'lanes wide enough to pass between');
  const tr = getTraffic(t)!;
  for (let lane = 0; lane < 4; lane++) assert.ok(tr.cars.filter((c) => c.lane === lane).length > 10, `lane ${lane} has traffic`);
  assert.equal(t.props.length, 0, 'still no obstacles');
});

test('six-lane grand prix roads: nothing on the road but the racers, walls at the white lines, and straights that end in hard braking', () => {
  for (const id of ['shiden', 'isonami'] as const) {
    const t = getTrack(id);
    // Andrew took the traffic off (2026-11-09), and `clean` keeps the bales, barrels and cones off too.
    assert.ok(!TRACK_DEFS[id].traffic && getTraffic(t) === null, `${id}: no traffic`);
    assert.ok(TRACK_DEFS[id].clean && t.props.length === 0, `${id}: no obstacles`);
    assert.equal(TRACK_DEFS[id].lanes, 6, `${id}: six lanes still painted`);
    assert.equal(t.shoulder, 0);
    assert.ok(t.rail - t.half < 0.5, `${id}: the wall stands at the white line`);
    assert.ok(t.runL.every((r) => r === 0) && t.runR.every((r) => r === 0), `${id}: no runoff`);
    // Braking zones: corners tighter than 70 m at the end of at least 300 m of near-straight road.
    let straight = 0;
    let zones = 0;
    let inCorner = false;
    for (let i = Math.floor(t.startS / SAMPLE); i < t.finishS / SAMPLE; i++) {
      const c = Math.abs(t.curv[i]);
      if (c > 1 / 70) {
        if (!inCorner && straight >= 300) zones++;
        inCorner = true;
        straight = 0;
      } else {
        inCorner = false;
        straight += c < 1 / 400 ? SAMPLE : 0;
      }
    }
    assert.ok(zones >= 4, `${id}: ${zones} braking zones off a long straight`);
  }
});

test('sprint rings: four short laps by day, no slow corners, and quick left-right flicks every lap', () => {
  for (const id of ['mizuumi', 'hibari'] as const) {
    const t = getTrack(id);
    assert.equal(t.def.laps, 4);
    assert.ok(['alpine', 'coast', 'desert', 'spring', 'autumn'].includes(t.def.theme), `${id}: a day theme`);
    const lap = t.lap * SAMPLE;
    assert.ok(lap > 1200 && lap < 1600, `${id}: a short lap (${lap} m)`);
    // Corners, one lap round: the tightest radius in each, and which way it goes.
    const turns: { sign: number; r: number; at: number }[] = [];
    let sign = 0;
    let peak = 0;
    const i0 = Math.floor(t.startS / SAMPLE);
    for (let i = i0; i < i0 + t.lap; i++) {
      const c = t.curv[i];
      const s = Math.abs(c) > 1 / 400 ? Math.sign(c) : 0;
      if (s !== sign && sign !== 0) turns.push({ sign, r: 1 / peak, at: i * SAMPLE }), (peak = 0);
      if (s) peak = Math.max(peak, Math.abs(c));
      sign = s;
    }
    assert.ok(turns.every((c) => c.r > 50), `${id}: nothing slower than a 50 m corner (${Math.min(...turns.map((c) => c.r)).toFixed(0)} m)`);
    // An esse: a corner one way flicking straight into one the other way within 30 m.
    const flicks = turns.filter((c, k) => k > 0 && c.sign !== turns[k - 1].sign && c.at - turns[k - 1].at < 30 + 2 * Math.PI * c.r * 0.25).length;
    assert.ok(flicks >= 2, `${id}: ${flicks} left-right flicks a lap`);
    assert.ok(t.props.length === 0, 'a circuit: no obstacles');
  }
});

test('the harder seaside rings: Hibari made tougher (narrower, tighter, more flicks, hills), still short 4-lap sprints', () => {
  const measure = (id: TrackId) => {
    const t = getTrack(id);
    const i0 = Math.floor(t.startS / SAMPLE);
    const turns: { sign: number; r: number; at: number }[] = [];
    let sign = 0;
    let peak = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let steep = 0;
    for (let i = i0; i < i0 + t.lap; i++) {
      const c = t.curv[i];
      const s = Math.abs(c) > 1 / 400 ? Math.sign(c) : 0;
      if (s !== sign && sign !== 0) turns.push({ sign, r: 1 / peak, at: i * SAMPLE }), (peak = 0);
      if (s) peak = Math.max(peak, Math.abs(c));
      sign = s;
      lo = Math.min(lo, t.y[i]);
      hi = Math.max(hi, t.y[i]);
      steep = Math.max(steep, Math.abs(t.y[i + 5] - t.y[i]) / (5 * SAMPLE));
    }
    const flicks = turns.filter((c, k) => k > 0 && c.sign !== turns[k - 1].sign && c.at - turns[k - 1].at < 30 + 2 * Math.PI * c.r * 0.25).length;
    return { t, lap: t.lap * SAMPLE, tightest: Math.min(...turns.map((c) => c.r)), flicks, rise: hi - lo, steep };
  };
  const base = measure('hibari');
  for (const id of ['kamome', 'shiokaze'] as const) {
    const m = measure(id);
    assert.equal(m.t.def.laps, 4);
    assert.equal(m.t.def.theme, 'coast', `${id}: by the sea, like Hibari`);
    assert.ok(m.lap > 1200 && m.lap < 1500, `${id}: a short lap (${m.lap} m)`);
    assert.ok(m.t.def.width < base.t.def.width, `${id}: narrower than Hibari`);
    assert.ok(m.tightest < base.tightest - 8 && m.tightest > 38, `${id}: tighter corners than Hibari, never a hairpin (${m.tightest.toFixed(0)} m)`);
    assert.ok(m.flicks > base.flicks, `${id}: more flicks a lap than Hibari (${m.flicks} vs ${base.flicks})`);
    assert.ok(m.rise > 12 && m.steep < 0.08, `${id}: hills (${m.rise.toFixed(1)} m), but no grade over 8% (${(m.steep * 100).toFixed(1)}%)`);
  }
});

test('Sea-to-Sky: wide sweepers, and only three corners tight enough to brake for', () => {
  const t = getTrack('seatosky');
  assert.ok(t.def.width >= 14 && t.def.clean);
  // Every corner: how far it turns and its tightest radius.
  const corners: { deg: number; r: number }[] = [];
  let run = 0;
  let sign = 0;
  let peak = 0;
  for (let i = Math.floor(t.startS / SAMPLE); i < t.finishS / SAMPLE; i++) {
    const c = t.curv[i];
    if (Math.abs(c) > 1 / 1500 && (run === 0 || Math.sign(c) === sign)) {
      run += c * SAMPLE;
      sign = Math.sign(c);
      peak = Math.max(peak, Math.abs(c));
    } else if (run) {
      corners.push({ deg: Math.abs((run * 180) / Math.PI), r: 1 / peak });
      run = 0;
      sign = 0;
      peak = 0;
    }
  }
  const real = corners.filter((c) => c.deg > 8);
  assert.ok(real.length >= 12, `a road of bends (${real.length})`);
  assert.ok(real.every((c) => c.r > 140), 'nothing tighter than 140 m');
  const tight = real.filter((c) => c.r < 200);
  assert.equal(tight.length, 3, 'Lions Bay and the two canyon corners');
  assert.ok(tight.every((c) => c.deg > 50), 'the tight ones are the big turns');
  assert.ok(real.filter((c) => c.r >= 200).every((c) => c.deg < 50), 'everything else is a sweeper');
});
