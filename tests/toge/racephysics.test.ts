import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_IDS, carSpec, newOwnedCar, rating, topSpeed } from '../../src/toge/shared/cars.ts';
import { CPU_LEVEL_IDS, aiDrive, newAi, rivalAi } from '../../src/toge/shared/driver.ts';
import { padKick } from '../../src/toge/shared/boost.ts';
import { TRACK_LENGTH_KM } from '../../src/toge/shared/garage.ts';
import { RACE_TRACKS, SAMPLE, SKY, TRACK_DEFS, type TrackId, buildTrack, getTrack, groundAt, gridSlot, heightAt, lapOf, locate, newGround, newLoc, pointAt, railAt, roadDistance, roadY } from '../../src/toge/shared/track.ts';
import { LANES, type Obstacle, TRAFFIC_KINDS, collideTraffic, getTraffic, newPose, trafficBetween, trafficPose, trafficS } from '../../src/toge/shared/traffic.ts';
import { ARCADE, type Car, arcadeMaxYaw, DEFAULT_ASSISTS, type DriveInput, TICK_DT, TICK_HZ, catchFall, collideCars, forwardSpeed, newCar, speedOf, spinOut, stepCar, yawOf } from '../../src/toge/shared/vehicle.ts';

// Race tracks only: the open world (world.ts) has its own tests in world.test.ts.
const TRACKS = RACE_TRACKS;

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
    // A circuit repeats every lap: check one lap, where the same place a lap on is the same leg.
    const n = t.lap || t.n;
    for (let i = 0; i < n; i += 3)
      for (let j = i + 100; j < n; j += 3) {
        if (t.lap && j - i > t.lap - 100) continue;
        // (A figure 8 crosses itself on purpose: its own test checks the bridge.)
        if (t.cross && [i, j].every((k) => Math.hypot(t.x[k] - t.cross!.x, t.z[k] - t.cross!.z) < 90)) continue;
        const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
        const wide = (k: number) => t.edge + Math.max(t.runL[k], t.runR[k]);
        assert.ok(d > wide(i) + wide(j) + 40, `${id}: s=${i * SAMPLE} and s=${j * SAMPLE} are only ${d.toFixed(1)} m apart`);
      }
    // Jump ramps and bumpy stretches are steep on purpose; everywhere else the grade stays sane.
    const onCrest = (s: number) => t.crests.some((c) => Math.abs(s - c.s) < c.len / 2 + 2 * SAMPLE) || t.bumps.some((b) => s > b.s0 - 5 * SAMPLE && s < b.s1);
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
        // (Asked from the road's own sample: at a figure 8's bridge the ground has two layers.)
        assert.ok(Math.abs(heightAt(t, x, z, undefined, i) - roadY(t, loc)) < 1e-6, `${id}: off the road plane at s=${s}, d=${d}`);
      }
    }
    // A sky road has no hills to blend into: off its edge is the abyss (its own test checks).
    if (t.abyss !== undefined) continue;
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

test('circuits: every lap is the same road, the race is every lap, and a car keeps to its lap', () => {
  const loc = newLoc();
  for (const id of TRACKS) {
    const t = getTrack(id);
    const laps = t.def.laps;
    if (!laps) continue;
    assert.ok(t.lap > 0 && laps >= 2);
    assert.equal(t.finishS - t.startS, laps * t.lap * SAMPLE);
    // The road, its banking and its barriers repeat exactly a lap on (so the one lap drawn is the road driven).
    for (let i = 0; i + t.lap < t.n; i += 7)
      for (const a of [t.x, t.y, t.z, t.bank, t.curv, t.runL, t.runR]) assert.equal(a[i], a[i + t.lap], `${id}: lap ${i}`);
    // The loop closes smoothly: no kink where the lap's last sample meets its first.
    const i0 = Math.round(t.startS / SAMPLE);
    assert.ok(Math.hypot(t.x[i0] - t.x[i0 - 1], t.z[i0] - t.z[i0 - 1]) < SAMPLE * 1.05);
    assert.ok(t.tx[i0] * t.tx[i0 - 1] + t.tz[i0] * t.tz[i0 - 1] > 0.99);
    // Located from anywhere on the lap the car is on, even when the search falls back to the (one-lap) hash.
    for (let lap = 1; lap <= laps; lap++) {
      const s = t.startS + (lap - 1) * t.lap * SAMPLE + 500;
      const p = pointAt(t, s, 2);
      locate(t, p.x, p.z, Math.round(s / SAMPLE) + 30, loc);
      assert.ok(Math.abs(loc.s - s) < 1, `${id}: located lap ${lap} at s=${loc.s.toFixed(0)}, not ${s}`);
      assert.equal(lapOf(t, s), lap);
    }
    // The grid is on the road behind the line.
    const g = gridSlot(t, 7);
    assert.ok(g.s > 0 && g.s < t.startS);
  }
});

test('figure 8: the first pass crosses the second on a bridge, and cars on each level stay on it', () => {
  const t = getTrack('hachi');
  const c = t.cross!;
  assert.ok(c, 'hachi crosses itself');
  // The lower road's sample under the bridge, and the angle the legs cross at.
  let low = -1;
  for (let i = 0; i < t.lap + 200; i++) if (c.low[i] && (low < 0 || Math.hypot(t.x[i] - c.x, t.z[i] - c.z) < Math.hypot(t.x[low] - c.x, t.z[low] - c.z))) low = i;
  assert.ok(t.y[c.over] - t.y[low] > 7.5, `clearance ${(t.y[c.over] - t.y[low]).toFixed(1)} m`);
  assert.ok(Math.abs(t.tx[c.over] * t.tx[low] + t.tz[c.over] * t.tz[low]) < 0.5, 'the legs cross nearly square');
  // The same spot answers per layer: the deck from the upper road, the road below from the lower one and without a hint.
  const p = pointAt(t, c.over * SAMPLE, 0);
  assert.ok(Math.abs(heightAt(t, p.x, p.z, undefined, c.over) - t.y[c.over]) < 0.01);
  assert.ok(Math.abs(heightAt(t, p.x, p.z) - roadY(t, locate(t, p.x, p.z, low, newLoc()))) < 0.01);
  assert.ok(Math.abs(heightAt(t, p.x, p.z, undefined, low) - heightAt(t, p.x, p.z)) < 1e-9);
  // The AI drives a whole race: over the bridge on the first pass, under it on the second, every lap.
  const car = carOn(t, 'kitsune');
  const ai = newAi(0.9, 0);
  const inp = { ...idle };
  let over = 0;
  let under = 0;
  for (let time = 0; car.s < t.finishS && time < 300; time += TICK_DT) {
    aiDrive(car, t, ai, TICK_DT, inp);
    stepCar(car, inp, t);
    if (Math.hypot(car.p.x - c.x, car.p.z - c.z) < 4) {
      const onDeck = c.deck[car.hint] === 1;
      const y = car.p.y - (onDeck ? t.y[c.over] : t.y[low]);
      assert.ok(y > -0.5 && y < 2, `${onDeck ? 'on' : 'under'} the bridge at ${y.toFixed(2)} m from its road`);
      if (onDeck) over++;
      else under++;
    }
  }
  assert.ok(car.s >= t.finishS, `stuck at s=${car.s.toFixed(0)}`);
  assert.ok(over > 0 && under > 0, `over ${over}, under ${under}`);
});

test('runoff: dirt before the barrier on the outside of fast bends and after every jump, never on structures', () => {
  const g = newGround();
  for (const id of TRACKS) {
    const t = getTrack(id);
    // Some, but not so much that the rail stops mattering (a figure 8 is nearly all fast loop, built to slide wide).
    const covered = Array.from(t.runL, (l, i) => Math.max(l, t.runR[i]) > 1).filter(Boolean).length / t.n;
    // An expressway runs between its walls: its sweepers are too gentle to need any. A `walled` road has none at all
    // (its own test checks).
    if (t.def.traffic === 'highway' || t.def.walled || t.def.sky) continue;
    // A road as wide as a runway (Hayate Flats) is its own runoff: only its quickest kinks get more. A sprint ring
    // (a lap under 1.5 km, all fast corners: Mizuumi, Hibari) is nearly all bend taken quick, so most of it has some.
    const sprint = !!t.lap && t.lap * SAMPLE < 1500;
    const most = t.cross ? 0.5 : sprint ? 0.7 : 0.4;
    assert.ok(covered > (t.def.width >= 20 ? 0.05 : 0.12) && covered < most, `${id}: runoff on ${(covered * 100).toFixed(0)}% of the road`);
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

test('the barrier: grinding along it costs real speed, more the faster you go, and steering away gets you off it', () => {
  // Pressed into the left rail on full throttle: it should bleed speed hard, not carry it, so braking for a bend
  // beats riding the wall round it.
  const along = (input: DriveInput, seconds: number, kmh = 150) => {
    const car = carOn();
    const s = flat.startS + 150;
    const p = pointAt(flat, s, -(flat.rail - 1.2));
    Object.assign(car.p, { x: p.x, y: p.y + 0.4, z: p.z });
    car.hint = Math.floor(s / SAMPLE);
    const yaw = Math.atan2(-p.tx, -p.tz) + 0.06; // nosing a little into the rail
    car.q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const v = kmh / 3.6;
    car.v.x = -Math.sin(yaw) * v;
    car.v.z = -Math.cos(yaw) * v;
    run(car, { ...gas, steer: -0.15 }, 0.6); // leaning on it
    const v0 = speedOf(car);
    run(car, input, seconds);
    return { car, lost: (v0 - speedOf(car)) * 3.6 };
  };
  const ride = along({ ...gas, steer: -0.15 }, 1);
  assert.ok(ride.lost > 45, `riding the rail only cost ${ride.lost.toFixed(1)} km/h a second`);
  const slow = along({ ...gas, steer: -0.15 }, 1, 100);
  const fast = along({ ...gas, steer: -0.15 }, 1, 200);
  assert.ok(slow.lost > 35 && fast.lost > slow.lost + 20, `rail cost ${slow.lost.toFixed(1)} km/h a second at 100, ${fast.lost.toFixed(1)} at 200`);
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
    // Arcade brakes bite harder than the tyres alone (ARCADE.brakeGrip), to match the cornering it promises.
    assert.ok(g > 1.05 && g < 1.6, `${id} brakes at ${g.toFixed(2)} g`);
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

test('simulation handling brakes at what the tyres give', () => {
  const sim = { ...DEFAULT_ASSISTS, arcade: false };
  for (const id of CAR_IDS) {
    const car = carOn(flat, id);
    while (forwardSpeed(car) < 100 / 3.6) stepCar(car, gas, flat, sim);
    const v0 = forwardSpeed(car);
    let bt = 0;
    while (forwardSpeed(car) > 1) {
      stepCar(car, { ...idle, brake: 1 }, flat, sim);
      bt += TICK_DT;
    }
    const g = (v0 - forwardSpeed(car)) / bt / 9.81;
    assert.ok(g > 0.8 && g < 1.35, `${id} brakes at ${g.toFixed(2)} g`);
  }
});

/** Wide open tarmac, so a car can turn without meeting a rail. */
const open = buildTrack({ ...flat.def, width: 400 });

test('braking in a turn still stops the car, and turning in on the brakes rotates it more (trail braking)', () => {
  for (const id of CAR_IDS) {
    const lost = (steer: number) => {
      const car = carOn(open, id);
      while (speedOf(car) < 100 / 3.6) stepCar(car, gas, open);
      const v0 = speedOf(car);
      run(car, { ...idle, brake: 1, steer }, 1, open);
      return v0 - speedOf(car);
    };
    assert.ok(lost(1) > lost(0) * 0.85, `${id}: braking on full lock loses ${lost(1).toFixed(1)} m/s against ${lost(0).toFixed(1)} straight`);
    const turned = (brake: number) => {
      const car = carOn(open, id);
      while (speedOf(car) < 22) stepCar(car, gas, open);
      const y0 = yawOf(car);
      run(car, { ...idle, brake, steer: 0.8 }, 0.5, open);
      return Math.abs(yawOf(car) - y0);
    };
    assert.ok(turned(0.7) > turned(0) * 1.1, `${id}: turned ${turned(0.7).toFixed(3)} on the brakes, ${turned(0).toFixed(3)} coasting`);
  }
});

test('traction: full throttle out of a bend gains speed, and traction control never chokes the engine for it', () => {
  for (const id of CAR_IDS) {
    const car = carOn(open, id);
    while (speedOf(car) < 50 / 3.6) stepCar(car, gas, open);
    const v0 = speedOf(car);
    let cut = 0;
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      stepCar(car, { ...gas, steer: 0.7 }, open);
      cut += car.tcsCut / (2 * TICK_HZ);
    }
    // The unloaded inside wheel is braked rather than the engine cut, so the outside wheel keeps driving.
    assert.ok(speedOf(car) - v0 > 1, `${id} gained only ${((speedOf(car) - v0) * 3.6).toFixed(1)} km/h`);
    assert.ok(cut < 0.45, `${id}: traction control cut ${(cut * 100).toFixed(0)}% of the throttle`);
  }
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
  const pad = open;
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
      let lastHit = -9;
      let falls = 0;
      while (car.s < t.finishS && time < 400 * Math.max(1, TRACK_LENGTH_KM[id] / 5)) {
        aiDrive(car, t, ai, TICK_DT, inp);
        stepCar(car, inp, t);
        if (catchFall(car, t)) falls++;
        assert.ok(Number.isFinite(car.p.x + car.p.y + car.p.z), `${model} on ${id}: NaN at ${time}`);
        // One crash can land a few hard hits in a row (nose, then the side swinging in): count it once.
        if (car.hit > 12) {
          if (time - lastHit > 1) crashes++;
          lastHit = time;
        }
        time += TICK_DT;
      }
      assert.ok(car.s >= t.finishS, `${model} didn't finish ${id} (stuck at s=${car.s.toFixed(0)})`);
      assert.ok(crashes <= 2, `${model} on ${id}: ${crashes} big crashes`);
      assert.equal(falls, 0, `${model} fell off ${id}`);
    }
  }
});

test('the barrier: hitting it costs more speed than brushing it, so the wall is never a better brake than the brakes', () => {
  // Into the left rail at 150 km/h at an angle, from the middle of the road, on full throttle.
  const hit = (deg: number) => {
    const car = carOn();
    const s = flat.startS + 150;
    const p = pointAt(flat, s, -(flat.rail - 2.5));
    Object.assign(car.p, { x: p.x, y: p.y + 0.4, z: p.z });
    car.hint = Math.floor(s / SAMPLE);
    const yaw = Math.atan2(-p.tx, -p.tz) + (deg * Math.PI) / 180;
    car.q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    car.v.x = -Math.sin(yaw) * (150 / 3.6);
    car.v.z = -Math.cos(yaw) * (150 / 3.6);
    run(car, gas, 0.5);
    return speedOf(car) * 3.6;
  };
  const brush = hit(2);
  const knock = hit(12);
  const slam = hit(30);
  assert.ok(brush > 140, `a brush cost too much: ${brush.toFixed(0)} km/h left`);
  assert.ok(knock < brush - 25, `a 12° hit at 150 km/h left ${knock.toFixed(0)} km/h (a brush ${brush.toFixed(0)})`);
  assert.ok(slam < knock - 15, `a 30° hit left ${slam.toFixed(0)} km/h (12°: ${knock.toFixed(0)})`);
});

/** Seconds for a car down a track: the AI driving, or the AI's steering with the throttle pinned and no brakes. */
function lapTime(id: TrackId, model: (typeof CAR_IDS)[number], ai: ReturnType<typeof newAi>, flatOut = false) {
  const t = getTrack(id);
  const car = carOn(t, model);
  const inp = { ...idle };
  let time = 0;
  while (car.s < t.finishS && time < 400) {
    aiDrive(car, t, ai, TICK_DT, inp);
    if (flatOut) Object.assign(inp, { throttle: 1, brake: 0 });
    stepCar(car, inp, t);
    catchFall(car, t);
    padKick(car, t.boosts);
    time += TICK_DT;
  }
  return time;
}

test('CPUs: a Hard CPU beats holding full throttle into the walls, and each level is quicker than the last', () => {
  // These used to go the other way: full throttle and no brakes beat every CPU on 20 of 22 tracks (Monaco by 21 s),
  // because the rails stopped the car for each bend sooner than its brakes, and the AI braked early and gently.
  for (const id of ['koripass', 'redmesa', 'momiji', 'spa', 'minato'] as const) {
    const flatOut = lapTime(id, 'kitsune', newAi(0.84, 0), true);
    const hard = lapTime(id, 'kitsune', rivalAi(1, 'hard'));
    assert.ok(hard < flatOut - 1, `${id}: Hard CPU ${hard.toFixed(1)} s, full throttle ${flatOut.toFixed(1)} s`);
  }
  const times = CPU_LEVEL_IDS.map((l) => lapTime('sakura', 'kitsune', rivalAi(1, l)));
  assert.ok(times[0] > times[1] + 2 && times[1] > times[2] + 2, `Sakura: easy/normal/hard ${times.map((x) => x.toFixed(1)).join(' / ')} s`);
});

test('CPUs go for the boost pads on their way', () => {
  let pads = 0;
  let kicks = 0;
  for (const id of ['monza', 'spa', 'kodama', 'kazeoka'] as const) {
    const t = getTrack(id);
    const car = carOn(t, 'kitsune');
    const ai = rivalAi(0, 'hard');
    const inp = { ...idle };
    for (let time = 0; car.s < t.finishS && time < 400; time += TICK_DT) {
      aiDrive(car, t, ai, TICK_DT, inp);
      stepCar(car, inp, t);
      if (padKick(car, t.boosts)) kicks++;
    }
    pads += t.boosts.filter((p) => p.s < t.finishS).length;
  }
  assert.ok(kicks >= pads * 0.75, `the AI took ${kicks} of ${pads} pads`);
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
  // PI is not capped at 999: a maxed car keeps climbing so better cars show better numbers.
  const maxed = newOwnedCar('vanta');
  maxed.up = { ...tuned.up };
  assert.ok(rating(carSpec(maxed)).pi > 999, String(rating(carSpec(maxed)).pi));
  assert.ok(rating(carSpec(maxed)).pi > rating(carSpec(newOwnedCar('vanta'))).pi);
  const classes = new Set(CAR_IDS.map((id) => rating(carSpec(newOwnedCar(id))).cls));
  assert.ok(classes.size >= 4, [...classes].join());
});

test('bikes: the engine pulls on part throttle and a spoiler in the car code changes nothing', () => {
  // Car-sized engine braking and inertia held the bike at 50 km/h on half throttle and slowed it after every hop.
  const bike = carOn(flat, 'raiden');
  assert.ok(bike.spec.bike && !carOn().spec.bike);
  run(bike, { ...gas, throttle: 0.5 }, 12);
  assert.ok(forwardSpeed(bike) > 25, `half throttle: ${(forwardSpeed(bike) * 3.6).toFixed(0)} km/h after 12 s`);
  const winged = newOwnedCar('raiden');
  winged.look.spoiler = 2;
  assert.deepEqual(carSpec(winged), carSpec(newOwnedCar('raiden')));
});

test('after the finish line the car rolls to a stop and stays there, never backing up the road', () => {
  // The driver used to hold the foot brake past the line; at a standstill the automatic box took that as
  // "select reverse" and the car reversed back over the line. Every car, both as an AI rival and as you.
  for (const id of CAR_IDS) {
    const t = flat;
    const car = carOn(t, id);
    const ai = newAi(0.8, 0);
    const inp: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    // Drive at the line at speed, so the car crosses it moving. The AI steers the run-up: flat out with the wheel
    // dead straight, the grid line clips the edge of the strip's ramp at 230 km/h and any car can land in the rail.
    for (let time = 0; car.s < t.finishS + 1; time += TICK_DT) {
      aiDrive(car, t, ai, TICK_DT, inp);
      inp.throttle = 1;
      inp.brake = 0;
      stepCar(car, inp, t);
      assert.ok(time < 120, `${id}: never reached the line (s ${car.s.toFixed(0)})`);
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

test('traffic: the same for everyone at the same moment, lanes never pile up, and clear of the grid', () => {
  const t = getTrack('neonbay');
  const tr = getTraffic(t)!;
  assert.ok(tr.cars.length > 60, 'a city full of traffic');
  // Another racer's copy of the track puts every car in the same place.
  const other = getTraffic(buildTrack(TRACK_DEFS.neonbay))!;
  const a = newPose();
  const b = newPose();
  for (const time of [-3, 0, 17.25, 140]) {
    tr.cars.forEach((c, i) => {
      trafficPose(t, tr, c, time, a);
      trafficPose(t, other, other.cars[i], time, b);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-9);
    });
    // Within a lane, never closer than nose to tail (with the loop's wrap).
    for (let lane = 0; lane < 4; lane++) {
      const ss = tr.cars.filter((c) => c.lane === lane).map((c) => trafficS(tr, c, time)).sort((x, y) => x - y);
      for (let i = 0; i < ss.length; i++) {
        const gap = i + 1 < ss.length ? ss[i + 1] - ss[i] : ss[0] + (tr.hi - tr.lo) - ss[i];
        assert.ok(gap > TRAFFIC_KINDS.truck.len + 2, `lane ${lane} at ${time}: cars ${gap.toFixed(1)} m apart`);
      }
    }
  }
  for (const c of tr.cars) assert.ok(trafficS(tr, c, 0) > gridSlot(t, 7).s + 100);
});

test('traffic: hitting a car knocks you off it, and the AI gets every car through the city', () => {
  const t = getTrack('neonbay');
  const tr = getTraffic(t)!;
  // Parked across a lane in front of an oncoming car: it shoves you back down the road.
  const c = tr.cars.find((x) => LANES[x.lane].dir < 0)!;
  const p = trafficPose(t, tr, c, 1, newPose());
  const car = newCar(carSpec(newOwnedCar('pebble')), p.x + p.vx * 0.3, p.y, p.z + p.vz * 0.3, p.yaw + Math.PI / 2);
  car.s = p.s;
  for (let time = 1; time < 1.6; time += TICK_DT) collideTraffic(t, tr, car, time);
  assert.ok(car.hit > 5, 'a real knock');
  assert.ok(car.v.x * p.vx + car.v.z * p.vz > 0, 'pushed the way the traffic is going');
  // The city, and the two highways (all four lanes going your way, at 250+ km/h on Hayate Flats).
  for (const id of ['neonbay', 'ryusei', 'hayate'] as const) {
    const t = getTrack(id);
    const tr = getTraffic(t)!;
    for (const model of CAR_IDS) {
      const car = carOn(t, model);
      const ai = newAi(0.9, 0);
      const inp = { ...idle };
      const near: Obstacle[] = [];
      let time = 0;
      let crashes = 0;
      while (car.s < t.finishS && time < 400) {
        aiDrive(car, t, ai, TICK_DT, inp, trafficBetween(tr, time, car.s - 10, car.s + 300, near));
        stepCar(car, inp, t);
        collideTraffic(t, tr, car, time);
        if (car.hit > 12) crashes++;
        time += TICK_DT;
      }
      assert.ok(car.s >= t.finishS, `${id}: ${model} didn't get through the traffic (stuck at s=${car.s.toFixed(0)})`);
      assert.ok(crashes <= 6, `${id}: ${model}: ${crashes} big crashes in traffic`);
      if (id !== 'neonbay') console.log(`# ${id} ${model} ${time.toFixed(1)} s, ${crashes} crashes`);
    }
  }
});

test('arcade: holding drift and brake together keeps the car on the road (no repeated drift hops)', () => {
  const both: DriveInput = { steer: 0.6, throttle: 0, brake: 1, handbrake: 0, drift: 1 };
  // Pressed together, and the brake pressed in the middle of a drift.
  for (const lead of [0, 0.5]) {
    const car = carOn();
    run(car, gas, 4);
    run(car, { steer: 0.6, throttle: 1, brake: 0, handbrake: 0, drift: 1 }, lead);
    const y0 = car.p.y;
    let starts = 0;
    let top = 0;
    let was = car.drift;
    for (let i = 0; i < 1.5 * TICK_HZ; i++) {
      stepCar(car, both, flat);
      if (car.drift !== 0 && was === 0) starts++;
      was = car.drift;
      top = Math.max(top, car.p.y - y0);
    }
    assert.equal(starts, 0, `lead ${lead}s: a drift (and its hop) started on the brakes`);
    assert.equal(car.drift, 0);
    assert.ok(top < 0.15, `lead ${lead}s: the car rose ${top.toFixed(2)} m`);
  }
});

/** Body slip (rad): how far the direction of travel is off the nose. */
const slipOf = (car: Car) => {
  const d = Math.atan2(-car.v.x, -car.v.z) - yawOf(car);
  return Math.atan2(Math.sin(d), Math.cos(d));
};

test('arcade drift: the E-brake kicks the tail out on the ground (no hop), it eases in and holds its angle, and letting go still boosts', () => {
  for (const id of CAR_IDS) {
    const car = carOn(open, id);
    while (speedOf(car) < 20) stepCar(car, gas, open);
    const y0 = car.p.y;
    let rise = 0;
    let rear = 1;
    let slip = 0;
    for (let i = 0; i < 1.2 * TICK_HZ; i++) {
      stepCar(car, { steer: 0.7, throttle: 1, brake: 0, handbrake: 0, drift: 1 }, open);
      rise = Math.max(rise, car.p.y - y0);
      rear = Math.min(rear, ((Math.abs(car.wheels[2].w) + Math.abs(car.wheels[3].w)) * car.spec.radius) / 2 / speedOf(car));
      if (i === Math.round(0.3 * TICK_HZ)) slip = Math.abs(slipOf(car));
    }
    assert.ok(rise < 0.05, `${id} rose ${rise.toFixed(2)} m starting a drift`);
    assert.ok(rear < 0.5, `${id}: the E-brake only slowed the rear wheels to ${(rear * 100).toFixed(0)}% of road speed`);
    // Into the slide, but not snapped sideways at once.
    assert.ok(slip > 0.1 && slip < 0.35, `${id}: ${((slip * 180) / Math.PI).toFixed(0)}° of slide after 0.3 s`);
    assert.ok(car.driftLevel >= 1, `${id}: no sparks`);
    stepCar(car, { steer: 0.7, throttle: 1, brake: 0, handbrake: 0, drift: 0 }, open);
    assert.ok(car.boost > 0, `${id}: letting go of the drift paid no boost`);
    // Held on full lock in a slow bend (it used to spin right round): the slide settles, the car keeps going.
    const slow = carOn(open, id);
    while (speedOf(slow) < 15) stepCar(slow, gas, open);
    let most = 0;
    for (let i = 0; i < 2.5 * TICK_HZ; i++) {
      stepCar(slow, { steer: 1, throttle: 0.6, brake: 0, handbrake: 0, drift: 1 }, open);
      most = Math.max(most, Math.abs(slipOf(slow)));
    }
    assert.ok(most < 0.9, `${id}: a drift held on full lock swung ${((most * 180) / Math.PI).toFixed(0)}° sideways`);
    assert.ok(slow.drift !== 0 && speedOf(slow) > 6, `${id}: the drift fell apart`);
  }
});

test('arcade drift: holding the wheel into a drift tightens it, bit by bit, round a hairpin; easing off opens it again', () => {
  for (const id of CAR_IDS) {
    // 80 km/h into a hairpin, full lock into the drift: a neutral-stick drift needed 21 m across to come round.
    const car = carOn(open, id);
    while (speedOf(car) < 22) stepCar(car, gas, open);
    const ux = car.v.x / speedOf(car);
    const uz = car.v.z / speedOf(car);
    const x0 = car.p.x;
    const z0 = car.p.z;
    let turned = 0;
    let most = 0;
    let early = 0;
    let t = 0;
    while (Math.abs(turned) < Math.PI && t < 4) {
      const h = Math.atan2(car.v.x, car.v.z);
      stepCar(car, { steer: 1, throttle: 1, brake: 0, handbrake: 0, drift: 1 }, open);
      const nh = Math.atan2(car.v.x, car.v.z);
      turned += Math.atan2(Math.sin(nh - h), Math.cos(nh - h));
      most = Math.max(most, Math.abs(slipOf(car)));
      t += TICK_DT;
      if (Math.abs(t - 0.3) < TICK_DT / 2) early = Math.abs(slipOf(car));
    }
    const across = Math.abs((car.p.x - x0) * uz - (car.p.z - z0) * ux);
    assert.ok(Math.abs(turned) >= Math.PI && across < 17, `${id}: ${((Math.abs(turned) * 180) / Math.PI).toFixed(0)}° of hairpin took ${across.toFixed(0)} m across`);
    assert.ok(early < 0.35, `${id}: tightening snapped the car ${((early * 180) / Math.PI).toFixed(0)}° sideways in 0.3 s`);
    assert.ok(most < 0.9 && car.drift !== 0, `${id}: the tightened drift swung ${((most * 180) / Math.PI).toFixed(0)}° sideways or fell apart`);
    // Steering out of it opens the slide back up to an ordinary drift.
    run(car, { steer: -0.5, throttle: 1, brake: 0, handbrake: 0, drift: 1 }, 0.6, open);
    assert.ok(car.tight === 0 && Math.abs(slipOf(car)) < 0.6, `${id}: still ${((Math.abs(slipOf(car)) * 180) / Math.PI).toFixed(0)}° sideways after steering out`);
  }
});

test('arcade drift at speed: the path turns with the nose from the start (it used to slide nearly straight), and fast grip turns are a touch tighter', () => {
  for (const id of CAR_IDS) {
    // How far the direction of travel has come round after 0.5 s and 1 s on full lock from `v` m/s.
    const turn = (v: number, drift: number) => {
      const car = carOn(open, id);
      while (speedOf(car) < v) stepCar(car, gas, open);
      let turned = 0;
      const out: number[] = [];
      for (let i = 1; i <= TICK_HZ; i++) {
        const h = Math.atan2(car.v.x, car.v.z);
        stepCar(car, { steer: 1, throttle: 1, brake: 0, handbrake: 0, drift }, open);
        const nh = Math.atan2(car.v.x, car.v.z);
        turned += Math.atan2(Math.sin(nh - h), Math.cos(nh - h));
        if (i === TICK_HZ / 2 || i === TICK_HZ) out.push(Math.abs(turned));
      }
      return { out, slip: Math.abs(slipOf(car)), drifting: car.drift !== 0 };
    };
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
    for (const v of [40, 50]) {
      const grip = turn(v, 0);
      const drift = turn(v, 1);
      // At 180 km/h it turned 6° in half a second and 23° in one, against 19° and 50° just steering.
      assert.ok(drift.out[0] > 0.5 * grip.out[0] && drift.out[1] > 0.65 * grip.out[1], `${id} @${v}: drift turned ${drift.out.map(deg)}°, grip ${grip.out.map(deg)}°`);
      // Still a slide, not a grip turn with sparks.
      assert.ok(drift.drifting && drift.slip > 0.3, `${id} @${v}: only ${deg(drift.slip)}° of slide`);
    }
    // A little more grip promised at speed than the base ARCADE.grip (12% at 50 m/s), none at medium speed.
    const sp = carSpec(newOwnedCar(id));
    assert.ok(Math.abs(arcadeMaxYaw(sp, 50) - (ARCADE.grip * 9.81 * 1.12) / 50) < 0.01);
    assert.ok(Math.abs(arcadeMaxYaw(sp, 20) - Math.min(ARCADE.maxYaw, (ARCADE.grip * 9.81) / 20, arcadeMaxYaw(sp, 20))) < 1e-9);
  }
});

test("arcade turning circle: full lock at walking pace is a car's turning circle, and holding it keeps the speed", () => {
  for (const id of CAR_IDS) {
    // It used to pivot on a 1 m circle and scrub down to a crawl.
    const circle = (v: number) => {
      const car = carOn(open, id);
      while (speedOf(car) < v) stepCar(car, gas, open);
      const cruise = () => Math.max(0, Math.min(1, 0.3 + (v - forwardSpeed(car)) * 0.5));
      run(car, { steer: 1, throttle: cruise(), brake: 0, handbrake: 0 }, 1.5, open);
      let turned = 0;
      let dist = 0;
      for (let i = 0; i < TICK_HZ; i++) {
        const h = Math.atan2(car.v.x, car.v.z);
        stepCar(car, { steer: 1, throttle: cruise(), brake: 0, handbrake: 0 }, open);
        const nh = Math.atan2(car.v.x, car.v.z);
        turned += Math.atan2(Math.sin(nh - h), Math.cos(nh - h));
        dist += speedOf(car) * TICK_DT;
      }
      return { radius: dist / Math.abs(turned), kept: speedOf(car) };
    };
    const walk = circle(4);
    assert.ok(walk.radius > 2.5 && walk.radius < 6.5, `${id}: turning radius ${walk.radius.toFixed(1)} m at walking pace`);
    const slow = circle(8);
    assert.ok(slow.kept > 4.8, `${id}: full lock at 8 m/s scrubbed down to ${slow.kept.toFixed(1)} m/s`);
  }
});

test('arcade: yanking the wheel at speed breaks the tail loose for a moment; smooth steering never does', () => {
  // Keyboard-speed steering (it ramps at 10/s): a flick from lock to lock, and a smooth analog turn-in.
  const ramp = (from: number, to: number, t0: number, t1: number, t: number) => (t <= t0 ? from : t >= t1 ? to : from + ((to - from) * (t - t0)) / (t1 - t0));
  const flick = (t: number) => (t < 0.5 ? ramp(0, -1, 0, 0.1, t) : t < 1.2 ? ramp(-1, 1, 0.5, 0.7, t) : ramp(1, 0, 1.2, 1.3, t));
  const smooth = (t: number) => (t < 1.2 ? ramp(0, 0.8, 0, 0.6, t) : ramp(0.8, 0, 1.2, 1.8, t));
  const drive = (id: (typeof CAR_IDS)[number], v: number, steerAt: (t: number) => number) => {
    const car = carOn(open, id);
    while (speedOf(car) < v) stepCar(car, gas, open);
    let slip = 0;
    let loose = 0;
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      stepCar(car, { steer: steerAt(i / TICK_HZ), throttle: Math.max(0, Math.min(1, 0.3 + (v - forwardSpeed(car)) * 0.5)), brake: 0, handbrake: 0 }, open);
      slip = Math.max(slip, Math.abs(slipOf(car)));
      loose = Math.max(loose, car.loose);
    }
    return { slip, loose, end: Math.abs(slipOf(car)) };
  };
  for (const id of CAR_IDS) {
    const fast = drive(id, 35, flick);
    assert.ok(fast.slip > 0.25 && fast.slip < 1, `${id}: a flick at 126 km/h slid ${((fast.slip * 180) / Math.PI).toFixed(0)}°`);
    assert.ok(fast.end < 0.05, `${id}: still sliding after the flick`);
    const calm = drive(id, 35, smooth);
    assert.ok(calm.loose === 0 && calm.slip < 0.08, `${id}: a smooth turn-in at speed slid`);
    assert.equal(drive(id, 15, flick).loose, 0, `${id}: a flick at town speed loosened the tail`);
  }
});

// --- the gearbox -------------------------------------------------------------------------------

/** Full throttle down the flat strip until the car is in a tall gear, then a wall stops the body dead. */
function crashAtSpeed(model: (typeof CAR_IDS)[number]): Car {
  const car = carOn(flat, model);
  run(car, gas, 12);
  assert.ok(car.gear >= 3, `${model} should be in a tall gear at speed, is in ${car.gear}`);
  car.v.x *= 0.05;
  car.v.z *= 0.05; // the wheels are still turning at the old speed
  return car;
}

test('gearbox: after a crash at full throttle the auto box drops straight to a low gear and pulls away', () => {
  for (const model of CAR_IDS) {
    const car = crashAtSpeed(model);
    run(car, gas, 0.5);
    assert.ok(car.gear <= 2, `${model} still in gear ${car.gear} half a second after the crash`);
    run(car, gas, 3.5);
    // Stuck in 4th with the clutch slipping, these crawled to ~30-50 km/h; in the right gear they all clear 45.
    assert.ok(forwardSpeed(car) * 3.6 > 45, `${model} only got back to ${(forwardSpeed(car) * 3.6).toFixed(0)} km/h in 4 s`);
  }
});

test('gearbox: wheelspin does not make the auto box upshift', () => {
  const car = carOn(flat, 'shiro');
  run(car, gas, 1);
  assert.equal(car.gear, 1);
  // Driven wheels spinning way past the road speed (a burnout, a drift, wheels in the air): still 1st.
  for (let i = 0; i < 10; i++) {
    for (const w of car.wheels.slice(2)) w.w = 400;
    stepCar(car, gas, flat);
  }
  assert.equal(car.gear, 1);
});

test('gearbox: the AI never hunts between gears (up and straight back down)', () => {
  for (const arcade of [true, false]) {
    const assists = { ...DEFAULT_ASSISTS, arcade };
    for (const id of ['koripass', 'momiji'] as TrackId[]) {
      const t = getTrack(id);
      for (const model of CAR_IDS) {
        const car = carOn(t, model);
        const ai = newAi(0.9, 0);
        const inp = { ...idle };
        let last = car.gear;
        let lastDir = 0;
        let lastT = -9;
        let hunts = 0;
        for (let time = 0; car.s < t.finishS && time < 300; time += TICK_DT) {
          aiDrive(car, t, ai, TICK_DT, inp);
          stepCar(car, inp, t, assists);
          if (car.gear !== last && car.gear >= 1 && last >= 1) {
            const dir = Math.sign(car.gear - last);
            if (dir !== lastDir && time - lastT < 1) hunts++;
            [lastDir, lastT] = [dir, time];
          }
          last = car.gear;
        }
        assert.ok(hunts <= 2, `${model} on ${id} (${arcade ? 'arcade' : 'simulation'}): hunted ${hunts} times`);
      }
    }
  }
});

test('gearbox: coming out of a spin never drops a moving car into first', () => {
  const car = carOn(flat, 'shiro');
  run(car, gas, 8);
  const gear = car.gear;
  assert.ok(gear >= 3);
  spinOut(car, 0.3);
  const manual = { ...DEFAULT_ASSISTS, auto: false };
  for (let i = 0; i < TICK_HZ; i++) stepCar(car, idle, flat, manual);
  assert.equal(car.spin, 0);
  assert.equal(car.gear, gear, 'a manual car keeps the gear it was in');
});

test('gearbox: crash damage costs engine power, not pedal, so a damaged car shifts like it is flat out', () => {
  const speedAfter = (input: DriveInput) => {
    const car = carOn(flat, 'kitsune');
    run(car, input, 8);
    return forwardSpeed(car);
  };
  const fresh = speedAfter(gas);
  const damaged = speedAfter({ ...gas, power: 0.5 });
  const halfPedal = speedAfter({ ...gas, throttle: 0.5 });
  assert.ok(damaged < fresh, 'damage costs speed');
  // Half the pedal also lugs in tall gears and gets engine braking for the lifted half; half the power doesn't.
  assert.ok(damaged > halfPedal, `damaged ${damaged.toFixed(1)} vs half pedal ${halfPedal.toFixed(1)}`);
});

test('no launch ramps (Andrew, 2026-11-10): across the asphalt the ground is the road itself, its own crests included', () => {
  const loc = newLoc();
  for (const id of TRACKS) {
    const t = getTrack(id);
    for (const p of t.props) assert.ok(['bale', 'barrel', 'cone', 'boulder', 'rock'].includes(p.kind), `${id}: a ${p.kind} on the road`);
    for (let i = 0; i < (t.lap || t.n) - 1; i += 5)
      for (const d of [-(t.half - 0.3), -(t.half - 2), 0, t.half - 2, t.half - 0.3]) {
        const p = pointAt(t, i * SAMPLE, d);
        const h = heightAt(t, p.x, p.z, loc, i);
        assert.ok(Math.abs(h - roadY(t, loc)) < 1e-9, `${id}: something on the road at s=${i * SAMPLE}, d=${d}`);
      }
  }
});

test('clean passes (time trial roads): no item boxes or obstacles, and an easy grade', () => {
  const clean = TRACKS.filter((id) => TRACK_DEFS[id].clean);
  assert.ok(clean.includes('nagare'));
  for (const id of clean) {
    const t = getTrack(id);
    assert.equal(t.props.length, 0, `${id}: props on a clean road`);
    for (let i = 0; i + 5 < t.n; i++) assert.ok(Math.abs(t.y[i + 5] - t.y[i]) / (5 * SAMPLE) < 0.07, `${id}: grade at s=${i * SAMPLE}`);
  }
});

test('sky road (Kumo Skyway): no barriers, nothing under the edge, and a car that falls off is put back on the road, stopped', () => {
  const t = getTrack('kumo');
  assert.ok(t.def.sky && t.def.laps && t.abyss !== undefined);
  const loc = newLoc();
  for (let i = 0; i < t.lap; i += 13) {
    // The road, its lip and nothing else: the ground drops away right at the edge.
    for (const side of [-1, 1]) {
      const on = pointAt(t, i * SAMPLE, side * (t.half + SKY.lip - 0.05));
      assert.ok(Math.abs(heightAt(t, on.x, on.z, loc, i) - roadY(t, loc)) < 1e-9, `the lip is road at s=${i * SAMPLE}`);
      const off = pointAt(t, i * SAMPLE, side * (t.half + SKY.lip + 0.6));
      assert.equal(heightAt(t, off.x, off.z, undefined, i), t.abyss, `nothing past the edge at s=${i * SAMPLE}`);
    }
    assert.ok(t.y[i] - t.abyss! > 500, 'high above the abyss');
  }
  assert.ok(t.runL.every((r) => r === 0) && t.runR.every((r) => r === 0), 'no runoff');
  // Straight off the side at 120 km/h: no rail stops it, it falls, and it's back in the middle of the road where it
  // went off, standing still, facing along the road.
  const s = t.startS + 120;
  const p = pointAt(t, s, 4);
  const car = carOn(t, 'kitsune');
  const yaw = Math.atan2(-p.tx, -p.tz) - 0.5; // nose 29° toward the right-hand edge
  Object.assign(car.p, { x: p.x, y: p.y + car.spec.cg + 0.05, z: p.z });
  car.q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  car.hint = Math.round(s / SAMPLE);
  car.v.x = -Math.sin(yaw) * (120 / 3.6);
  car.v.z = -Math.cos(yaw) * (120 / 3.6);
  let caught = -1;
  let wentOff = 0;
  for (let k = 0; k < 4 * TICK_HZ && caught < 0; k++) {
    stepCar(car, gas, t);
    if (!wentOff && Math.abs(car.d) > t.half + SKY.lip + 2) wentOff = car.s;
    if (catchFall(car, t)) caught = k / TICK_HZ;
  }
  assert.ok(wentOff > 0, 'drove off the edge');
  assert.ok(caught > 0.8 && caught < 2.5, `caught after ${caught.toFixed(2)} s`);
  assert.equal(speedOf(car), 0, 'all its speed lost');
  locate(t, car.p.x, car.p.z, car.hint, loc);
  assert.ok(Math.abs(loc.d) < 0.01, `back in the middle (d=${loc.d.toFixed(2)})`);
  assert.ok(Math.abs(loc.s - wentOff) < 60, `back where it went off (s=${loc.s.toFixed(0)}, off at ${wentOff.toFixed(0)})`);
  const back = Math.abs(car.p.y - car.spec.cg - roadY(t, loc));
  assert.ok(back < 0.1, `on the road surface (${back.toFixed(2)} m)`);
  // And it drives on from there.
  run(car, gas, 3, t);
  assert.ok(forwardSpeed(car) > 15 && Math.abs(car.d) < t.half, 'drives away');
  // On every other track the catch does nothing.
  const other = carOn(getTrack('monza'));
  other.p.y -= 50;
  assert.ok(!catchFall(other, getTrack('monza')));
});
