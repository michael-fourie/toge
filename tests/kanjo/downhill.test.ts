import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { CUPS } from '../../src/kanjo/shared/cups.ts';
import { aiDrive, newAi } from '../../src/kanjo/shared/driver.ts';
import { TRACK_LENGTH_KM } from '../../src/kanjo/shared/garage.ts';
import { COURSE, isSolid } from '../../src/kanjo/shared/props.ts';
import { SAMPLE, TRACK_DEFS, type TrackId, buildTrack, getTrack, gridSlot } from '../../src/kanjo/shared/track.ts';
import { type DriveInput, TICK_DT, newCar, stepCar } from '../../src/kanjo/shared/vehicle.ts';

// The downhill obstacle courses, Nadare Drop and Sakamichi Downhill, and the drop jump (track.ts `jump`) they're built on.
// Andrew, 2026-11-16: "obstacle course style race. Start from top of a mountain and the race finishes at the bottom.
// Include jumps where you land on a new street and make it a long race to the bottom to encourage overtaking".

const COURSES: TrackId[] = ['nadare', 'sakamichi'];
const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const yAt = (t: ReturnType<typeof getTrack>, s: number) => t.y[Math.round(s / SAMPLE)];

test('downhill courses: summit to the bottom, long, wide enough to pass, in the Gravity Cup', () => {
  for (const id of COURSES) {
    const d = TRACK_DEFS[id];
    const t = getTrack(id);
    assert.ok(!d.laps && !d.clean && d.obstacles, `${id}: a point-to-point obstacle course`);
    assert.ok(d.width >= 13, `${id}: ${d.width} m wide`);
    assert.ok(TRACK_LENGTH_KM[id] >= 7, `${id}: only ${TRACK_LENGTH_KM[id]} km`);
    const fall = yAt(t, t.startS) - yAt(t, t.finishS);
    assert.ok(fall > 400, `${id}: only ${fall.toFixed(0)} m from the start down to the finish`);
    assert.ok(t.crests.length >= 5, `${id}: ${t.crests.length} jumps`);
  }
  assert.deepEqual(CUPS.gravity.tracks.slice(2), ['sakamichi', 'nadare']);
});

test('a drop jump: a kicker up to the lip, then the road falls away onto the street below and runs on lower', () => {
  const pts = Array.from({ length: 16 }, (_, i) => [0, 300 - i * 4, -i * 100] as [number, number, number]);
  const base = { id: 'nadare' as const, name: 'jump', tag: '', blurb: '', theme: 'alpine' as const, seed: 1, width: 13, relief: 0, points: pts };
  const plain = buildTrack(base);
  const jump = { kind: 'jump' as const, at: 8, size: 2, kick: 28, drop: 12, land: 115 };
  const t = buildTrack({ ...base, features: [jump] });
  const lip = t.crests[0].s;
  const off = (s: number) => yAt(t, s) - yAt(plain, s);
  assert.ok(Math.abs(off(lip - jump.kick - 10)) < 1e-6, 'the road before the kicker is untouched');
  assert.ok(Math.abs(off(lip) - jump.size) < 0.1, `the lip stands ${off(lip).toFixed(2)} m proud`);
  // Up the kicker, then steeply down off the lip: the kink that throws the car.
  const up = (yAt(t, lip) - yAt(t, lip - 2 * SAMPLE)) / (2 * SAMPLE);
  const down = (yAt(t, lip + 2 * SAMPLE) - yAt(t, lip)) / (2 * SAMPLE);
  assert.ok(up > 0.05 && down < -0.15, `kicker ${(up * 100).toFixed(0)}%, landing ${(down * 100).toFixed(0)}%`);
  // The street below: `drop` m under where the road would have run, from the end of the landing on.
  for (const s of [lip + jump.land, lip + jump.land + 300]) assert.ok(Math.abs(off(s) + jump.drop) < 0.1, `at ${s - lip} m past the lip the road is ${off(s).toFixed(2)} m off`);
  assert.equal(t.crests[0].len, 2 * jump.land, 'the whole kicker and landing count as the jump');
});

test('obstacle courses: a jump or something on the road every few hundred metres, never across the whole road', () => {
  for (const id of COURSES) {
    const t = getTrack(id);
    const groups: (typeof t.props)[] = [];
    for (const p of t.props) {
      const g = groups[groups.length - 1];
      if (g && p.s - g[0].s < 3) g.push(p);
      else groups.push([p]);
    }
    // Obstacles: the jumps, and runs of props (a slalom is one, counted where the next is more than a slalom's length on).
    const spots = t.crests.length + t.props.filter((p, i) => i === 0 || p.s - t.props[i - 1].s > COURSE.slalom * 2 + 10).length;
    const km = (t.finishS - t.startS) / 1000;
    assert.ok(spots / km > 3, `${id}: only ${spots} obstacles in ${km.toFixed(1)} km`);
    for (const g of groups) {
      // The widest clear gap across the asphalt (props' own radius plus a little).
      const blocked = g.filter((p) => isSolid(p.kind)).map((p) => [p.d - p.r - 0.3, p.d + p.r + 0.3]).sort((a, b) => a[0] - b[0]);
      let gap = 0;
      let at = -t.half;
      for (const [a, b] of blocked) {
        gap = Math.max(gap, a - at);
        at = Math.max(at, b);
      }
      gap = Math.max(gap, t.half - at);
      assert.ok(gap > 3.5, `${id}: only ${gap.toFixed(1)} m clear at s=${g[0].s.toFixed(0)}`);
    }
    for (const c of t.crests) assert.ok(!t.props.some((p) => p.s > c.s - c.len / 2 && p.s < c.s + c.len / 2), `${id}: a prop on the jump at ${c.s}`);
  }
});

test('the AI flies every jump, lands on the road and gets to the bottom', () => {
  for (const id of COURSES) {
    const t = getTrack(id);
    const g = gridSlot(t, 0);
    const car = newCar(carSpec(newOwnedCar('kitsune')), g.x, g.y, g.z, g.yaw);
    const ai = newAi(0.9, 0);
    const inp = { ...idle };
    const flights: number[] = [];
    let air = 0;
    let time = 0;
    while (car.s < t.finishS && time < 400) {
      aiDrive(car, t, ai, TICK_DT, inp);
      stepCar(car, inp, t);
      if (car.wheels.every((w) => !w.contact)) air += TICK_DT;
      else {
        if (air > 1) flights.push(car.s);
        air = 0;
      }
      time += TICK_DT;
    }
    assert.ok(car.s >= t.finishS, `${id}: stuck at s=${car.s.toFixed(0)}`);
    // Each long flight comes down on its own jump's landing, on the road.
    for (const c of t.crests) assert.ok(flights.some((s) => s > c.s && s < c.s + c.len / 2 + 20), `${id}: no flight off the jump at s=${c.s}`);
    assert.equal(flights.length, t.crests.length, `${id}: flights at ${flights.map((s) => s.toFixed(0)).join(', ')}`);
  }
});
