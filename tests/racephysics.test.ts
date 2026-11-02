import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_IDS, carSpec, newOwnedCar, rating, topSpeed } from '../src/shared/race/cars.ts';
import { aiDrive, newAi } from '../src/shared/race/driver.ts';
import { TRACK_LENGTH_KM } from '../src/shared/race/garage.ts';
import { SAMPLE, TRACK_DEFS, type TrackId, buildTrack, getTrack, groundAt, gridSlot, heightAt, locate, newGround, newLoc, pointAt, railAt, roadDistance, roadY } from '../src/shared/race/track.ts';
import { ARCADE, type Car, DEFAULT_ASSISTS, type DriveInput, TICK_DT, TICK_HZ, collideCars, forwardSpeed, newCar, speedOf, stepCar } from '../src/shared/race/vehicle.ts';

const TRACKS = Object.keys(TRACK_DEFS) as TrackId[];

/** A dead-straight, dead-flat test strip. */
const flat = buildTrack({ id: 'koripass', name: 'flat', tag: '', blurb: '', theme: 'alpine', seed: 1, width: 12, relief: 0, points: Array.from({ length: 21 }, (_, i) => [0, 100, -i * 200] as [number, number, number]) });

const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const gas: DriveInput = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

function carOn(t = flat, id: (typeof CAR_IDS)[number] = 'shiro'): Car {
  const g = gridSlot(t, 0);
  return newCar(carSpec(newOwnedCar(id)), g.x, g.y, g.z, g.yaw);
}

const run = (car: Car, input: DriveInput, seconds: number, t = flat) => {
  for (let i = 0; i < seconds * TICK_HZ; i++) stepCar(car, input, t);
};

test('tracks: legs of the road never come close enough to overlap, and no grade is absurd', () => {
  for (const id of TRACKS) {
    const t = getTrack(id);
    for (let i = 0; i < t.n; i += 3)
      for (let j = i + 100; j < t.n; j += 3) {
        const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
        const wide = (k: number) => t.edge + Math.max(t.runL[k], t.runR[k]);
        assert.ok(d > wide(i) + wide(j) + 40, `${id}: s=${i * SAMPLE} and s=${j * SAMPLE} are only ${d.toFixed(1)} m apart`);
      }
    // Jump ramps are steep on purpose; everywhere else the grade stays sane.
    const onCrest = (s: number) => t.crests.some((c) => Math.abs(s - c.s) < c.len / 2 + 2 * SAMPLE);
    for (let i = 0; i + 5 < t.n; i++) if (!onCrest(i * SAMPLE)) assert.ok(Math.abs(t.y[i + 5] - t.y[i]) / (5 * SAMPLE) < 0.12, `${id}: grade at s=${i * SAMPLE}`);
    assert.ok(Math.abs((t.finishS - t.startS) / 1000 - TRACK_LENGTH_KM[id]) < 0.15, `${id}: TRACK_LENGTH_KM is out of date`);
  }
});

test('tracks: the ground under the road is the road, and it is continuous everywhere', () => {
  const loc = newLoc();
  for (const id of TRACKS) {
    const t = getTrack(id);
    for (let s = 10; s < t.length - 10; s += 37) {
      const i = Math.floor(s / SAMPLE);
      for (const d of [-t.rail - t.runL[i], -t.rail, -t.half, 0, t.half, t.rail, t.rail + t.runR[i]]) {
        const x = t.x[i] - t.tz[i] * d;
        const z = t.z[i] + t.tx[i] * d;
        locate(t, x, z, i, loc);
        assert.ok(Math.abs(heightAt(t, x, z) - roadY(t, loc)) < 1e-6, `${id}: off the road plane at s=${s}, d=${d}`);
      }
    }
    // A walk across the map near the road (where it blends into the hills): no seams. A seam shows as the
    // midpoint far off the line between its neighbours; a steep but smooth embankment doesn't.
    const { x0, x1, z0, z1 } = t.bounds;
    let worst = 0;
    let where = '';
    for (let z = z0 - 100; z < z1 + 100; z += 23)
      for (let x = x0 - 100; x < x1 + 100; x += 1.5) {
        if (roadDistance(t, x, z) > 150) continue;
        const bend = Math.abs(heightAt(t, x + 0.75, z) - (heightAt(t, x, z) + heightAt(t, x + 1.5, z)) / 2);
        if (bend > worst) {
          worst = bend;
          where = `${x.toFixed(1)}, ${z.toFixed(1)}`;
        }
      }
    assert.ok(worst < 0.5, `${id}: a seam in the ground at (${where}): ${worst.toFixed(2)} m`);
  }
});

test('runoff: dirt before the barrier on the outside of fast bends and after every jump, never on structures', () => {
  const g = newGround();
  for (const id of TRACKS) {
    const t = getTrack(id);
    // Some, but not so much that the rail stops mattering.
    const covered = Array.from(t.runL, (l, i) => Math.max(l, t.runR[i]) > 1).filter(Boolean).length / t.n;
    assert.ok(covered > 0.12 && covered < 0.4, `${id}: runoff on ${(covered * 100).toFixed(0)}% of the road`);
    // Where it's wide, it's dirt you can drive on: flat road plane out to a barrier that stands back.
    let wide = 0;
    for (let i = 0; i < t.n; i++)
      for (const [side, run] of [[-1, t.runL[i]], [1, t.runR[i]]] as const) {
        if (run < 4) continue;
        wide++;
        const s = i * SAMPLE;
        const p = pointAt(t, s, side * (t.rail + 1));
        groundAt(t, p.x, p.z, g);
        assert.equal(g.surf, 'dirt', `${id}: s=${s} side ${side} is ${g.surf}`);
        assert.ok(railAt(t, s, side * t.rail) > t.rail + 3.5);
      }
    assert.ok(wide > 0, `${id}: no wide runoff anywhere`);
    for (const c of t.crests) {
      const i = Math.round((c.s + 60) / SAMPLE);
      // (Not by a bridge or tunnel, or at a shortcut's turn-off, where the rail has to stay put.)
      const at = c.s + 60;
      const blocked = t.spans.some((sp) => sp.kind !== 'gravel' && at > sp.s0 - 100 && at < sp.s1 + 100) || t.cuts.some((k) => Math.min(Math.abs(at - k.s0), Math.abs(at - k.s1)) < 100);
      if (!blocked) assert.ok(Math.min(t.runL[i], t.runR[i]) > 3, `${id}: no room to land after the jump at s=${c.s}`);
    }
    for (const sp of t.spans)
      if (sp.kind !== 'gravel')
        for (let i = Math.floor(sp.s0 / SAMPLE); i <= Math.ceil(sp.s1 / SAMPLE); i++) assert.equal(t.runL[i] + t.runR[i], 0, `${id}: runoff on a ${sp.kind}`);
  }
});

test('the barrier: grinding along it costs real speed, and steering away gets you off it', () => {
  // Pressed into the left rail at 150 km/h on full throttle: it should bleed speed hard, not carry it.
  const along = (input: DriveInput, seconds: number) => {
    const car = carOn();
    const s = flat.startS + 150;
    const p = pointAt(flat, s, -(flat.rail - 1.2));
    Object.assign(car.p, { x: p.x, y: p.y + 0.4, z: p.z });
    car.hint = Math.floor(s / SAMPLE);
    const yaw = Math.atan2(-p.tx, -p.tz) + 0.06; // nosing a little into the rail
    car.q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const v = 150 / 3.6;
    car.v.x = -Math.sin(yaw) * v;
    car.v.z = -Math.cos(yaw) * v;
    run(car, { ...gas, steer: -0.15 }, 0.6); // leaning on it
    const v0 = speedOf(car);
    run(car, input, seconds);
    return { car, lost: (v0 - speedOf(car)) * 3.6 };
  };
  const ride = along({ ...gas, steer: -0.15 }, 1);
  assert.ok(ride.lost > 15, `riding the rail only cost ${ride.lost.toFixed(1)} km/h a second`);
  const off = along({ ...gas, steer: 0.5 }, 1.2);
  assert.ok(off.car.d > -(flat.rail - 3), `still on the rail at d=${off.car.d.toFixed(2)}`);
});

test('a parked car settles on its springs and stays put', () => {
  for (const id of CAR_IDS) {
    const car = carOn(flat, id);
    run(car, idle, 3);
    assert.ok(speedOf(car) < 0.02, `${id} creeps at ${speedOf(car)}`);
    for (const w of car.wheels) assert.ok(w.contact && w.comp > 0.02 && w.comp < 0.15, `${id}: spring at ${w.comp}`);
  }
});

test('a parked car on a steep stretch of mountain road holds with the handbrake', () => {
  const t = getTrack('koripass');
  // Find the steepest stretch and park there.
  let best = 0;
  let at = 0;
  for (let i = 200; i < t.n - 200; i++) {
    const g = t.y[i] - t.y[i + 5];
    if (g > best) {
      best = g;
      at = i;
    }
  }
  const car = newCar(carSpec(newOwnedCar('pebble')), t.x[at], t.y[at], t.z[at], Math.atan2(-t.tx[at], -t.tz[at]));
  car.hint = at;
  run(car, { ...idle, handbrake: 1 }, 1, t);
  const s0 = car.s;
  run(car, { ...idle, handbrake: 1 }, 4, t);
  assert.ok(Math.abs(car.s - s0) < 0.3, `rolled ${(car.s - s0).toFixed(2)} m on a ${((best / 10) * 100).toFixed(1)}% grade`);
});

test('acceleration and braking are in a believable range, and quicker cars are quicker', () => {
  const zeroTo100: Record<string, number> = {};
  for (const id of CAR_IDS) {
    const car = carOn(flat, id);
    let t = 0;
    while (forwardSpeed(car) < 100 / 3.6 && t < 30) {
      stepCar(car, gas, flat);
      t += TICK_DT;
    }
    zeroTo100[id] = t;
    while (forwardSpeed(car) < 130 / 3.6) stepCar(car, gas, flat);
    const v0 = forwardSpeed(car);
    let bt = 0;
    while (forwardSpeed(car) > 1) {
      stepCar(car, { ...idle, brake: 1 }, flat);
      bt += TICK_DT;
    }
    const g = (v0 - forwardSpeed(car)) / bt / 9.81;
    assert.ok(g > 0.85 && g < 1.4, `${id} brakes at ${g.toFixed(2)} g`);
    assert.ok(Math.abs(car.d + 2.4) < 0.3, `${id} pulled ${(car.d + 2.4).toFixed(2)} m off line`);
  }
  assert.ok(zeroTo100.pebble > 8 && zeroTo100.pebble < 13, `pebble 0-100 ${zeroTo100.pebble}`);
  assert.ok(zeroTo100.vanta < 5, `vanta 0-100 ${zeroTo100.vanta}`);
  assert.ok(zeroTo100.vanta < zeroTo100.shiro && zeroTo100.shiro < zeroTo100.pebble);
});

test('ABS stops shorter than locked wheels', () => {
  const stop = (abs: boolean) => {
    const car = carOn();
    while (forwardSpeed(car) < 100 / 3.6) stepCar(car, gas, flat);
    const s0 = car.s;
    while (forwardSpeed(car) > 1) stepCar(car, { ...idle, brake: 1 }, flat, { ...DEFAULT_ASSISTS, abs });
    return car.s - s0;
  };
  assert.ok(stop(true) < stop(false) * 0.95);
});

test('cornering: steady lateral grip is about what the tyres promise, and the body rolls the right way', () => {
  // A big open circle on the flat strip's run-off is too small, so check on the move: steer on full lock
  // at a modest speed and compare lateral acceleration with the grip.
  const car = carOn();
  while (forwardSpeed(car) < 15) stepCar(car, gas, flat);
  let latMax = 0;
  for (let i = 0; i < TICK_HZ * 0.8; i++) {
    const vx = car.v.x;
    const vz = car.v.z;
    stepCar(car, { steer: 0.6, throttle: 0.3, brake: 0, handbrake: 0 }, flat);
    const ax = (car.v.x - vx) / TICK_DT;
    const az = (car.v.z - vz) / TICK_DT;
    latMax = Math.max(latMax, Math.hypot(ax, az) / 9.81);
  }
  // Arcade handling promises more than the tyres do.
  const promised = DEFAULT_ASSISTS.arcade ? ARCADE.grip : car.spec.grip;
  assert.ok(latMax > 0.6 && latMax < promised * 1.15, `lateral ${latMax.toFixed(2)} g`);
  // Turning right rolls the body to the left (its up vector leans left, -x of the car).
  const q = car.q;
  const upRight = 2 * (q.x * q.y - q.w * q.z); // up · right
  assert.ok(upRight < 0, 'body rolls to the outside of the turn');
});

test('arcade cornering: full lock at 90 km/h turns tighter than a touge hairpin needs', () => {
  // Wide open tarmac, so the circle never meets a rail.
  const pad = buildTrack({ ...flat.def, width: 400 });
  const car = carOn(pad);
  while (speedOf(car) < 25) stepCar(car, gas, pad);
  for (let i = 0; i < TICK_HZ * 0.5; i++) stepCar(car, { steer: 1, throttle: 0.5, brake: 0, handbrake: 0 }, pad);
  let turned = 0;
  let dist = 0;
  let h = Math.atan2(car.v.x, car.v.z);
  for (let i = 0; i < TICK_HZ; i++) {
    stepCar(car, { steer: 1, throttle: speedOf(car) < 25 ? 1 : 0.3, brake: 0, handbrake: 0 }, pad);
    const nh = Math.atan2(car.v.x, car.v.z);
    turned += Math.atan2(Math.sin(nh - h), Math.cos(nh - h));
    dist += speedOf(car) * TICK_DT;
    h = nh;
  }
  const radius = dist / Math.abs(turned);
  assert.ok(radius < 26, `turning radius ${radius.toFixed(1)} m at ${speedOf(car).toFixed(1)} m/s`);
});

test('AI drivers get every car down every track, with no NaNs and few big crashes', () => {
  for (const id of TRACKS) {
    const t = getTrack(id);
    for (const model of CAR_IDS) {
      const car = carOn(t, model);
      const ai = newAi(0.9, 0);
      const inp = { ...idle };
      let time = 0;
      let crashes = 0;
      while (car.s < t.finishS && time < 400) {
        aiDrive(car, t, ai, TICK_DT, inp);
        stepCar(car, inp, t);
        assert.ok(Number.isFinite(car.p.x + car.p.y + car.p.z), `${model} on ${id}: NaN at ${time}`);
        if (car.hit > 12) crashes++;
        time += TICK_DT;
      }
      assert.ok(car.s >= t.finishS, `${model} didn't finish ${id} (stuck at s=${car.s.toFixed(0)})`);
      assert.ok(crashes <= 2, `${model} on ${id}: ${crashes} big crashes`);
    }
  }
});

test('cars bump each other apart and trade momentum', () => {
  const a = carOn();
  const b = carOn();
  b.p.x = a.p.x + a.spec.body.hw * 2 - 0.3; // overlapping side by side
  a.v.x = 3;
  collideCars(a, b, true);
  assert.ok(b.p.x - a.p.x > a.spec.body.hw * 2 - 0.3, 'pushed apart');
  assert.ok(a.v.x < 3 && b.v.x > 0, 'momentum traded');
});

test('specs: upgrades make a car faster and raise its rating; classes span the catalogue', () => {
  const stock = newOwnedCar('pebble');
  const tuned = newOwnedCar('pebble');
  tuned.up = { engine: 5, turbo: 5, tires: 5, brakes: 5, suspension: 5, weight: 5, gearbox: 5, aero: 5 };
  assert.ok(rating(carSpec(tuned)).pi > rating(carSpec(stock)).pi + 100);
  assert.ok(topSpeed(carSpec(tuned)) > topSpeed(carSpec(stock)));
  const classes = new Set(CAR_IDS.map((id) => rating(carSpec(newOwnedCar(id))).cls));
  assert.ok(classes.size >= 4, [...classes].join());
});

test('after the finish line the car rolls to a stop and stays there, never backing up the road', () => {
  // The driver used to hold the foot brake past the line; at a standstill the automatic box took that as
  // "select reverse" and the car reversed back over the line. Every car, both as an AI rival and as you.
  for (const id of CAR_IDS) {
    const t = flat;
    const car = carOn(t, id);
    const ai = newAi(0.8, 0);
    const inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    // Drive at the line at speed, so the car crosses it moving.
    while (car.s < t.finishS + 1) {
      inp.throttle = 1;
      stepCar(car, inp, t);
      assert.ok(car.s < t.length, `${id}: never reached the line`);
    }
    const crossed = car.s;
    for (let i = 0; i < 10 * TICK_HZ; i++) {
      aiDrive(car, t, ai, TICK_DT, inp);
      stepCar(car, inp, t);
    }
    assert.ok(car.gear >= 0, `${id}: ended in reverse (gear ${car.gear})`);
    assert.ok(speedOf(car) < 0.5, `${id}: still moving at ${speedOf(car).toFixed(1)} m/s`);
    assert.ok(car.s > crossed, `${id}: rolled back over the line (s ${car.s.toFixed(1)} < ${crossed.toFixed(1)})`);
  }
});
