/**
 * THE DRIVING LOCK. Michael, 2026-11-12: "The driving mechanics are perfect right now. Let's lock them so no other
 * devs change them."
 *
 * This test drives every car (stock, maxed and tuned) through a fixed set of moves on a flat test strip with the real
 * physics, and checks the result against tests/kanjo/drivinglock.json: launch, top end, braking, steering, drifting,
 * reversing, sim handling, wall scraping and hits, slipstream + slingshot, boost pads, crash damage, the car specs,
 * the pedals' curves and every tuning constant. If ANY of it moves, this fails.
 *
 * If it fails on your branch, your change altered how KANJO drives. Undo that part of the change. Do NOT regenerate
 * the snapshot to make it pass. The only time to regenerate it is when Michael himself has asked for that exact
 * driving change; then run
 *
 *     DRIVING_LOCK=update npx tsx --test tests/kanjo/drivinglock.test.ts
 *
 * and say in the PR that the driving lock was updated and which of Michael's messages asked for it.
 * See "Driving mechanics are locked" in the root CLAUDE.md and in src/kanjo/CLAUDE.md.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { padPedals, trigger } from '../../src/kanjo/client/input.ts';
import { BOOST, type BoostPad, padKick } from '../../src/kanjo/shared/boost.ts';
import { CAR_IDS, type CarId, type OwnedCar, carSpec, maxedUpgrades, newOwnedCar, peakPower, rating, topSpeed } from '../../src/kanjo/shared/cars.ts';
import { DAMAGE, damagedInput, handling, newDamage, takeHit } from '../../src/kanjo/shared/damage.ts';
import { DRAFT, stepDraft, wakeOf } from '../../src/kanjo/shared/draft.ts';
import { buildTrack, gridSlot } from '../../src/kanjo/shared/track.ts';
import { ARCADE, type Assists, type Car, DEFAULT_ASSISTS, type DriveInput, IMPACT, TICK_HZ, arcadeMaxYaw, forwardSpeed, newCar, speedOf, stepCar, yawOf } from '../../src/kanjo/shared/vehicle.ts';

const SNAPSHOT = new URL('./drivinglock.json', import.meta.url);
const UPDATE = process.env.DRIVING_LOCK === 'update';

/** A dead-straight, dead-flat strip, 4 km long and 12 m wide between the rails. */
const strip = buildTrack({ id: 'koripass', name: 'lock', tag: '', blurb: '', theme: 'alpine', seed: 1, width: 12, relief: 0, points: Array.from({ length: 21 }, (_, i) => [0, 100, -i * 200] as [number, number, number]) });

const SIM: Assists = { ...DEFAULT_ASSISTS, arcade: false };
const input = (o: Partial<DriveInput> = {}): DriveInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, ...o });

/** 6 significant figures: tight enough that any real change shows, loose enough for float noise between Node versions. */
const r = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(6)) : x);
const round = (x: unknown): unknown => {
  if (typeof x === 'number') return r(x);
  if (Array.isArray(x)) return x.map(round);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)]));
  return x;
};

function place(owned: OwnedCar, d = 0): Car {
  const g = gridSlot(strip, 0);
  return newCar(carSpec(owned), g.x + d, g.y, g.z, g.yaw);
}

const run = (car: Car, inp: DriveInput, seconds: number, assists: Assists = DEFAULT_ASSISTS, each?: (car: Car) => void) => {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
    each?.(car);
    stepCar(car, inp, strip, assists);
  }
};

/** Everything about a car's state that the driver feels. */
const state = (car: Car) => ({
  x: car.p.x,
  y: car.p.y,
  z: car.p.z,
  speed: speedOf(car),
  fwd: forwardSpeed(car),
  yaw: yawOf(car),
  yawRate: car.w.y,
  gear: car.gear,
  rpm: car.rpm,
  s: car.s,
  d: car.d,
  drift: car.drift,
  driftLevel: car.driftLevel,
  boost: car.boost,
  boostPower: car.boostPower,
});

/** Brought up to `v` m/s in a straight line on full throttle, then a moment off the gas so it's settled. */
function atSpeed(owned: OwnedCar, v: number, assists: Assists = DEFAULT_ASSISTS): Car {
  const car = place(owned);
  for (let i = 0; i < 40 * TICK_HZ && forwardSpeed(car) < v; i++) stepCar(car, input({ throttle: 1 }), strip, assists);
  run(car, input(), 0.25, assists);
  return car;
}

function drive(owned: OwnedCar) {
  const out: Record<string, unknown> = {};

  // Launch and top end: full throttle from the grid.
  const launch = place(owned);
  const marks: unknown[] = [];
  for (const t of [0.5, 1, 2, 4, 6, 10, 16]) {
    run(launch, input({ throttle: 1 }), t - (marks.length ? [0.5, 1, 2, 4, 6, 10, 16][marks.length - 1] : 0));
    marks.push(state(launch));
  }
  out.launch = marks;

  // Braking from 30 m/s, and from top speed.
  for (const v of [30, 55]) {
    const car = atSpeed(owned, v);
    const z0 = car.p.z;
    const brake: unknown[] = [];
    run(car, input({ brake: 1 }), 0.5);
    brake.push(state(car));
    run(car, input({ brake: 1 }), 1);
    brake.push(state(car));
    run(car, input({ brake: 1 }), 3);
    brake.push({ ...state(car), dist: Math.abs(car.p.z - z0) });
    out[`brake${v}`] = brake;
  }

  // Steering: full lock and half lock at a few speeds, on part throttle.
  for (const v of [8, 20, 35]) {
    for (const steer of [1, 0.5]) {
      const car = atSpeed(owned, v);
      const seq: unknown[] = [];
      run(car, input({ steer, throttle: 0.4 }), 0.3);
      seq.push(state(car));
      run(car, input({ steer, throttle: 0.4 }), 0.7);
      seq.push(state(car));
      out[`steer${v}x${steer}`] = seq;
    }
  }

  // A lock-to-lock flick at speed (ARCADE.loose).
  {
    const car = atSpeed(owned, 36);
    const seq: unknown[] = [];
    run(car, input({ steer: 1, throttle: 0.5 }), 0.25);
    run(car, input({ steer: -1, throttle: 0.5 }), 0.25);
    seq.push(state(car));
    run(car, input({ steer: 0, throttle: 0.5 }), 0.8);
    seq.push(state(car));
    out.flick = seq;
  }

  // Drifts: held into the corner, then held tighter, then let go (mini-turbo); at hairpin speed and at speed.
  for (const v of [18, 32, 48]) {
    const car = atSpeed(owned, v);
    const seq: unknown[] = [];
    run(car, input({ steer: 0.6, throttle: 1, drift: 1 }), 0.4);
    seq.push(state(car));
    run(car, input({ steer: 0.6, throttle: 1, drift: 1 }), 0.8);
    seq.push(state(car));
    run(car, input({ steer: 1, throttle: 1, drift: 1 }), 0.8);
    seq.push(state(car));
    run(car, input({ steer: -0.3, throttle: 1, drift: 1 }), 0.5);
    seq.push(state(car));
    run(car, input({ steer: 0, throttle: 1 }), 1);
    seq.push(state(car));
    out[`drift${v}`] = seq;
  }

  // Lift-off and coasting (engine braking, drag, rolling resistance).
  {
    const car = atSpeed(owned, 40);
    run(car, input(), 3);
    out.coast = state(car);
  }

  // Reverse: brake held at a standstill selects reverse, then wheel right.
  {
    const car = place(owned);
    const seq: unknown[] = [];
    run(car, input({ brake: 1 }), 2);
    seq.push(state(car));
    run(car, input({ brake: 1, steer: 1 }), 1.5);
    seq.push(state(car));
    run(car, input({ throttle: 1 }), 1.5);
    seq.push(state(car));
    out.reverse = seq;
  }

  // Simulation handling (arcade off): launch, corner, handbrake.
  {
    const car = atSpeed(owned, 25, SIM);
    const seq: unknown[] = [];
    run(car, input({ steer: 0.7, throttle: 0.5 }), 1, SIM);
    seq.push(state(car));
    run(car, input({ steer: 0.7, handbrake: 1 }), 0.5, SIM);
    seq.push(state(car));
    run(car, input({ steer: 0, throttle: 1 }), 1, SIM);
    seq.push(state(car));
    out.sim = seq;
  }

  // Walls: a brush along the rail and a hard hit into it.
  for (const [name, steer, v] of [['brush', 0.15, 40], ['hit', 0.6, 30]] as const) {
    const car = atSpeed(owned, v);
    const seq: unknown[] = [];
    let hit = 0;
    run(car, input({ steer, throttle: 1 }), 1.5, DEFAULT_ASSISTS, (c) => (hit = Math.max(hit, c.hit)));
    seq.push({ ...state(car), hit });
    run(car, input({ steer: 0, throttle: 1 }), 1);
    seq.push(state(car));
    out[`wall_${name}`] = seq;
  }

  // Slipstream: tucked in behind a car ahead at speed, then pulled out (slingshot).
  {
    const car = atSpeed(owned, 35);
    const ahead = atSpeed(owned, 35);
    ahead.p.z = car.p.z - 8;
    const seq: unknown[] = [];
    let wakes = 0;
    let slung = 0;
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      // A car ahead going exactly as fast, 8 m up the road.
      ahead.p.x = car.p.x;
      ahead.p.y = car.p.y;
      ahead.p.z = car.p.z - 8;
      ahead.v.x = 0;
      ahead.v.y = 0;
      ahead.v.z = car.v.z;
      const wake = wakeOf(car, ahead);
      wakes += wake;
      if (stepDraft(car, wake, 1, 1 / TICK_HZ)) slung++;
      stepCar(car, input({ throttle: 1 }), strip);
    }
    seq.push({ ...state(car), draft: car.draft, charge: car.draftCharge, armed: car.draftArmed, wakes });
    for (let i = 0; i < 1.5 * TICK_HZ; i++) {
      if (stepDraft(car, 0, 1, 1 / TICK_HZ)) slung++;
      stepCar(car, input({ throttle: 1 }), strip);
    }
    seq.push({ ...state(car), draft: car.draft, slung });
    out.draft = seq;
  }

  // A boost pad under the car.
  {
    const car = atSpeed(owned, 25);
    const pads: BoostPad[] = [{ s: car.s - 1, d: car.d, len: BOOST.len, w: BOOST.w }];
    const fresh = padKick(car, pads);
    run(car, input({ throttle: 1 }), 1.5);
    out.boostPad = { ...state(car), fresh };
  }

  // Crash damage: a crushed nose and a bent right side, then driving on.
  {
    const dmg = newDamage();
    takeHit(dmg, 14, { x: 0, y: 0, z: -2 }, 0, 2.2, 0.9, 1);
    takeHit(dmg, 10, { x: 0.9, y: 0, z: 0 }, 0, 2.2, 0.9, 1);
    const car = atSpeed(owned, 20);
    const out2 = input();
    run(car, damagedInput(dmg, input({ throttle: 1 }), out2), 2);
    out.damaged = { ...state(car), ...handling(dmg), total: dmg.total };
  }

  return out;
}

function snapshot() {
  const cars: Record<string, unknown> = {};
  const tuned = (id: CarId): OwnedCar => {
    const c = newOwnedCar(id);
    c.up = maxedUpgrades();
    c.tune = { ride: -0.5, bias: 0.4, diff: 0.8, final: 1.15 };
    return c;
  };
  for (const id of CAR_IDS) {
    const stock = newOwnedCar(id);
    const maxed = newOwnedCar(id);
    maxed.up = maxedUpgrades();
    for (const [name, owned] of [['stock', stock], ['maxed', maxed], ['tuned', tuned(id)]] as const) {
      const sp = carSpec(owned);
      cars[`${id}/${name}`] = {
        spec: sp,
        topSpeed: topSpeed(sp),
        peak: peakPower(sp),
        rating: rating(sp),
        maxYaw: [5, 15, 30, 50, 70].map((v) => arcadeMaxYaw(sp, v)),
        // The tuned car only gets its spec checked: the stock and maxed cars drive every move.
        ...(name === 'tuned' ? {} : { drive: drive(owned) }),
      };
    }
  }
  return round({
    constants: { ARCADE, IMPACT, DRAFT, BOOST, DAMAGE, TICK_HZ },
    pedals: {
      trigger: [0, 0.03, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 1].map(trigger),
      pad: [padPedals({ lt: 0.4, rt: 0.8, down: Array(16).fill(false) })],
    },
    cars,
  });
}

/** Lists every leaf that differs, as "path: was → now". */
function diff(a: unknown, b: unknown, path: string, out: string[]) {
  if (out.length > 40) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 2e-5 * Math.max(1, Math.abs(a), Math.abs(b))) return;
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

test('driving lock: KANJO drives exactly as it did when Michael locked it (2026-11-12)', () => {
  const now = snapshot();
  if (UPDATE) {
    writeFileSync(SNAPSHOT, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  const was = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const changes: string[] = [];
  diff(was, now, 'driving', changes);
  assert.equal(
    changes.length,
    0,
    `KANJO's driving mechanics are LOCKED (Michael, 2026-11-12) and this change alters them:\n  ${changes.join('\n  ')}\n\n` +
      'Undo the part of your change that touches driving (vehicle.ts, draft.ts, boost.ts, damage.ts, car specs in cars.ts, ' +
      'input.ts pedals). Do not regenerate tests/kanjo/drivinglock.json unless Michael himself asked for this exact change. ' +
      'See "Driving mechanics are locked" in CLAUDE.md.',
  );
});

test('driving lock: the moves are deterministic (same run twice, same numbers)', () => {
  const a = JSON.stringify(drive(newOwnedCar('kitsune')));
  const b = JSON.stringify(drive(newOwnedCar('kitsune')));
  assert.equal(a, b);
});
