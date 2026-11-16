import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_IDS, carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { aiDrive, newAi, rivalAi } from '../../src/kanjo/shared/driver.ts';
import { TRACK_LENGTH_KM } from '../../src/kanjo/shared/garage.ts';
import { SAMPLE, TRACK_DEFS, forkView, getTrack, gridSlot, groundAt, heightAt, locate, mainSample, newGround, newLoc, onFork, pointAt } from '../../src/kanjo/shared/track.ts';
import { type Obstacle, TRAFFIC_KINDS, getTraffic, newPose, trafficBetween, trafficPose, trafficS } from '../../src/kanjo/shared/traffic.ts';
import { type DriveInput, TICK_DT, newCar, stepCar } from '../../src/kanjo/shared/vehicle.ts';

// Futamata Parkway, and the fork in a road (Track.fork) it was built for.
// Andrew, 2026-11-16: "traffic moving in the same direction as the race ... fast pace race with wider turns, start and
// finish in different places ... a section of the race where the road splits off in two directions, but the time between
// the two different directions are very very similar and negligible ... about 10km total".

const t = getTrack('futamata');
const f = t.fork!;
const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

/** Drives `model` down the whole road with the AI, taking the fork's main road or its second. */
function run(model: (typeof CAR_IDS)[number], alt: boolean) {
  const g = gridSlot(t, 0);
  const car = newCar(carSpec(newOwnedCar(model)), g.x, g.y, g.z, g.yaw);
  const ai = newAi(0.9, 0, alt);
  const inp = { ...idle };
  let time = 0;
  let enter = 0;
  let leave = 0;
  let second = 0;
  let inside = 0;
  let hits = 0;
  while (car.s < t.finishS && time < 400) {
    aiDrive(car, t, ai, TICK_DT, inp);
    stepCar(car, inp, t);
    if (car.hit > 3) hits++;
    if (!enter && car.s >= f.s0) enter = time;
    if (!leave && car.s >= f.s1) leave = time;
    if (car.s > f.s0 + 100 && car.s < f.s1 - 100) {
      inside++;
      if (onFork(t, car.hint)) second++;
    }
    time += TICK_DT;
  }
  return { time, fork: leave - enter, share: second / inside, hits, done: car.s >= t.finishS };
}

test('Futamata Parkway: a one-way road of about 10 km with traffic going your way, start and finish apart, fast with a few corners to brake for', () => {
  const d = TRACK_DEFS.futamata;
  assert.ok(!d.laps, 'a point-to-point road, not a circuit');
  assert.equal(d.traffic, 'highway');
  const km = (t.finishS - t.startS) / 1000;
  assert.ok(Math.abs(km - 10) < 0.3, `${km.toFixed(2)} km`);
  assert.ok(Math.abs(km - TRACK_LENGTH_KM.futamata) < 0.15);
  const a = pointAt(t, t.startS, 0);
  const b = pointAt(t, t.finishS, 0);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 5000, 'the finish is a long way from the start');
  // Every lane goes with the race.
  const tr = getTraffic(t)!;
  assert.ok(tr.lanes.every((l) => l.dir === 1));
  // Wide turns: most of the road is straight or a sweeper of 280 m or more, and nothing is tighter than 140 m.
  let tight = 0;
  let tightest = Infinity;
  for (let i = Math.round(t.startS / SAMPLE); i < t.finishS / SAMPLE; i++) {
    const r = 1 / Math.max(1e-6, Math.abs(t.curv[i]));
    tightest = Math.min(tightest, r);
    if (r < 280) tight++;
  }
  assert.ok(tightest > 140, `tightest corner ${tightest.toFixed(0)} m`);
  assert.ok((tight * SAMPLE) / (t.finishS - t.startS) < 0.12, `${tight * SAMPLE} m of corners under 280 m`);
});

test('fork: the second road is as long as the main one, leaves and rejoins it in line, and the two get well apart', () => {
  assert.equal(f.m, f.b - f.a + 1);
  assert.ok(f.s1 - f.s0 > 1000, 'a real stretch of road');
  const last = f.o + f.m - 1;
  let apart = 0;
  for (let k = 0; k < f.m; k++) {
    const i = f.o + k;
    assert.equal(t.s[i], t.s[f.a + k], 'as far along as the main road');
    apart = Math.max(apart, Math.hypot(t.x[i] - t.x[f.a + k], t.z[i] - t.z[f.a + k]));
    if (k === f.m - 1) continue;
    // Evenly sampled, like the main road: its length is the main road's.
    assert.ok(Math.abs(Math.hypot(t.x[i + 1] - t.x[i], t.z[i + 1] - t.z[i]) - SAMPLE) < 0.01);
    // Sweepers only, and gentle grades.
    assert.ok(Math.abs(t.curv[i]) < 1 / 300, `second road bends at ${(1 / Math.abs(t.curv[i])).toFixed(0)} m`);
    assert.ok(Math.abs(t.curv[f.a + k]) < 1 / 300, `main road bends at ${(1 / Math.abs(t.curv[f.a + k])).toFixed(0)} m in the fork`);
    assert.ok(Math.abs(t.y[i + 1] - t.y[i]) / SAMPLE < 0.06);
  }
  assert.ok(apart > 150, `the two roads get ${apart.toFixed(0)} m apart`);
  for (const [i, j] of [[f.o, f.a], [last, f.b]]) {
    assert.ok(Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < 1e-6, 'starts and ends on the main road');
    assert.ok(Math.abs(t.y[i] - t.y[j]) < 0.02, 'at its height');
  }
  // In line with it: under 2° between the two where they part and meet.
  assert.ok(t.tx[f.o] * t.tx[f.a] + t.tz[f.o] * t.tz[f.a] > Math.cos((2 * Math.PI) / 180));
  assert.ok(t.tx[last - 1] * t.tx[f.b] + t.tz[last - 1] * t.tz[f.b] > Math.cos((2 * Math.PI) / 180));
  // No runoff and no boost pads there: both are places on the main road only.
  for (let i = f.a; i <= f.b; i++) assert.ok(t.runL[i] === 0 && t.runR[i] === 0);
  assert.ok(t.boosts.every((p) => p.s + p.len < f.s0 || p.s > f.s1));
  assert.ok(t.boosts.length >= 2, 'pads on the rest of the road');
  // The view of it the renderer draws.
  const v = forkView(t)!;
  assert.equal(v.n, f.m);
  assert.equal(v.x[5], t.x[f.o + 5]);
  assert.equal(forkView(getTrack('ryusei')), null);
});

test('fork: the ground is each road under its own tarmac, with no step where they part and meet', () => {
  const g = newGround();
  const loc = newLoc();
  for (let k = 4; k < f.m - 4; k += 3) {
    for (const [i, alt] of [[f.a + k, false], [f.o + k, true]] as const) {
      const twin = alt ? f.a + k : f.o + k;
      const sep = Math.hypot(t.x[i] - t.x[twin], t.z[i] - t.z[twin]);
      for (const d of [-6, 0, 6]) {
        const p = pointAt(t, (f.a + k) * SAMPLE, d, alt);
        // Where the roads are still one, a point belongs to the nearer centreline; it's tarmac either way.
        groundAt(t, p.x, p.z, g);
        assert.equal(g.surf, 'asphalt', `k=${k} d=${d} alt=${alt}`);
        if (sep < 2 * t.half + 14) continue;
        assert.ok(Math.abs(g.h - p.y) < 0.02, `k=${k} d=${d} alt=${alt}: ground ${g.h.toFixed(2)}, road ${p.y.toFixed(2)}`);
        locate(t, p.x, p.z, -1, loc);
        assert.equal(onFork(t, loc.i), alt, 'located on its own road');
        assert.ok(Math.abs(loc.s - (f.a + k) * SAMPLE) < 0.05 && Math.abs(loc.d - d) < 0.05);
      }
    }
    // Across the line midway between the two, while they're close: the ground on either side of it agrees.
    const i = f.o + k;
    const j = f.a + k;
    const sep = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
    if (sep < 0.5 || sep > 2 * t.edge) continue;
    const ux = (t.x[i] - t.x[j]) / sep;
    const uz = (t.z[i] - t.z[j]) / sep;
    const mx = (t.x[i] + t.x[j]) / 2;
    const mz = (t.z[i] + t.z[j]) / 2;
    const step = Math.abs(heightAt(t, mx + ux * 0.05, mz + uz * 0.05) - heightAt(t, mx - ux * 0.05, mz - uz * 0.05));
    // On the tarmac and shoulder the two planes meet within a tyre's squash; on the grass wedge before the rails, a kerb's worth.
    assert.ok(step < (sep / 2 < t.half + t.shoulder ? 0.03 : 0.08), `k=${k}: a ${(step * 100).toFixed(1)} cm step between the roads (${sep.toFixed(1)} m apart)`);
  }
});

test('fork: a car takes whichever road it steers onto, its distance raced carries on, and it comes back onto the main road', () => {
  for (const alt of [false, true]) {
    const loc = newLoc();
    let hint = f.a - 40;
    let prev = (f.a - 40) * SAMPLE;
    // Along the road's own middle, from before the fork to after it.
    for (let s = (f.a - 40) * SAMPLE; s < (f.b + 40) * SAMPLE; s += 1.3) {
      const p = pointAt(t, s, alt ? 2 : -2, alt);
      locate(t, p.x, p.z, hint, loc);
      hint = loc.i;
      assert.ok(Math.abs(loc.s - s) < 0.6, `alt=${alt}: s=${s.toFixed(1)} located at ${loc.s.toFixed(1)}`);
      assert.ok(loc.s >= prev - 0.6, 'never jumps back');
      prev = loc.s;
      if (s > f.s0 + 200 && s < f.s1 - 200) assert.equal(onFork(t, hint), alt);
      assert.ok(Math.abs(mainSample(t, hint) * SAMPLE - s) < 2 * SAMPLE);
    }
    assert.ok(!onFork(t, hint), 'back on the main road after the fork');
  }
});

test('fork: the AI drives either road in every car, and the two take the same time', { timeout: 240_000 }, () => {
  for (const model of CAR_IDS) {
    const main = run(model, false);
    const second = run(model, true);
    for (const [r, alt] of [[main, false], [second, true]] as const) {
      assert.ok(r.done, `${model}: didn't finish (${alt ? 'second' : 'main'} road)`);
      assert.ok(alt ? r.share > 0.99 : r.share < 0.01, `${model}: took the ${alt ? 'second' : 'main'} road (${(r.share * 100).toFixed(0)}% on the second)`);
      assert.ok(r.hits < 30, `${model}: ${r.hits} ticks on the rails`);
    }
    // "Very very similar and negligible": within 0.4 s over the 1.5 km of fork, and over the whole race.
    assert.ok(Math.abs(main.fork - second.fork) < 0.4, `${model}: ${main.fork.toFixed(2)} s one way, ${second.fork.toFixed(2)} s the other`);
    assert.ok(Math.abs(main.time - second.time) < 0.4, `${model}: ${main.time.toFixed(2)} s and ${second.time.toFixed(2)} s`);
    console.log(`# futamata ${model}: ${main.time.toFixed(1)} s; the fork ${main.fork.toFixed(2)} s (main) / ${second.fork.toFixed(2)} s (second)`);
  }
});

test('fork: traffic takes both roads, stays on its own lane of each, and the AI only minds the cars on its own', () => {
  const tr = getTraffic(t)!;
  assert.ok(tr.cars.some((c) => c.alt) && tr.cars.some((c) => !c.alt));
  const pose = newPose();
  const loc = newLoc();
  const seen = [0, 0];
  for (let time = 0; time < 200; time += 7.3)
    for (const c of tr.cars) {
      const s = trafficS(tr, c, time);
      if (s < f.s0 + 150 || s > f.s1 - 150) continue;
      trafficPose(t, tr, c, time, pose);
      locate(t, pose.x, pose.z, -1, loc);
      assert.equal(onFork(t, loc.i), !!c.alt, 'on its own road');
      assert.ok(Math.abs(loc.d - tr.lanes[c.lane].d) < 0.05, 'in its lane');
      seen[c.alt ? 1 : 0]++;
    }
  assert.ok(seen[0] > 20 && seen[1] > 20, `traffic on both roads (${seen})`);
  // Lanes never pile up through the fork: cars of one lane on one road keep their gaps.
  for (const time of [0, 33, 91]) {
    const at = tr.cars.map((c) => ({ c, s: trafficS(tr, c, time) })).sort((a, b) => a.s - b.s);
    for (let lane = 0; lane < tr.lanes.length; lane++) {
      const row = at.filter((x) => x.c.lane === lane);
      for (let i = 1; i < row.length; i++) assert.ok(row[i].s - row[i - 1].s > TRAFFIC_KINDS.truck.len + 2);
    }
  }
  // What the AI is told: which road each car is on, except near the end, where the two run together.
  const out: Obstacle[] = [];
  let tagged = 0;
  for (let time = 0; time < 60; time += 5)
    for (const o of trafficBetween(tr, time, f.s0 - 200, f.s1 + 200, out)) {
      if (o.s < f.s0 || o.s > f.s1 - 220) assert.equal(o.alt, undefined);
      else tagged += o.alt === undefined ? 0 : 1;
    }
  assert.ok(tagged > 10);
  // Rivals split between the two roads.
  const takes = Array.from({ length: 7 }, (_, i) => rivalAi(i, 'hard').alt);
  assert.ok(takes.filter(Boolean).length >= 3 && takes.filter((x) => !x).length >= 3);
});
