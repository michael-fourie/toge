import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/toge/shared/cars.ts';
import { DAMAGE, crashDamage, damagedInput, handling, newDamage, packZones, repair, takeHit, unpackZones, zoneAt } from '../../src/toge/shared/damage.ts';
import { Race, type RaceClient } from '../../src/toge/server/race.ts';
import type { RaceServerMsg } from '../../src/toge/shared/protocol.ts';
import { getTrack, gridSlot, pointAt } from '../../src/toge/shared/track.ts';
import { type Car, TICK_DT, collideCars, newCar, stepCar } from '../../src/toge/shared/vehicle.ts';

const kmh = (x: number) => x / 3.6;

test('knocks below ~20 km/h of delta-V do nothing; a 100 km/h wall nose first is nearly a write-off', () => {
  assert.equal(crashDamage(0), 0);
  assert.equal(crashDamage(DAMAGE.threshold), 0);
  assert.ok(crashDamage(8) < 0.03, 'trading paint costs a few percent');
  const wall = crashDamage(25);
  assert.ok(wall > 0.85 && wall < 1.05, `25 m/s delta-V: ${wall}`);
  for (let v = 6; v < 40; v++) assert.ok(crashDamage(v + 1) > crashDamage(v), 'harder always hurts more');
});

test('a hit lands on the side of the body it struck', () => {
  assert.equal(zoneAt({ x: 0.3, y: 0, z: -2 }, 2.2, 0.9), 'front');
  assert.equal(zoneAt({ x: -0.2, y: 0, z: 2.1 }, 2.2, 0.9), 'rear');
  assert.equal(zoneAt({ x: -0.9, y: 0, z: 0.4 }, 2.2, 0.9), 'left');
  assert.equal(zoneAt({ x: 0.9, y: 0, z: -0.5 }, 2.2, 0.9), 'right');
});

test('damage adds up to a wreck; a respawn repairs and gives a moment of grace', () => {
  const d = newDamage();
  const nose = { x: 0, y: 0, z: -2 };
  assert.equal(takeHit(d, 3, nose, 0, 2.2, 0.9, TICK_DT), null);
  const a = takeHit(d, 16, nose, 0, 2.2, 0.9, TICK_DT)!;
  assert.ok(a.amount > 0.2 && !a.wrecked && a.zone === 'front');
  let wrecked = false;
  for (let i = 0; i < 10 && !wrecked; i++) wrecked = takeHit(d, 16, nose, 0, 2.2, 0.9, TICK_DT)?.wrecked ?? false;
  assert.ok(wrecked && d.total === 1);
  repair(d);
  assert.equal(d.total, 0);
  assert.equal(takeHit(d, 30, nose, 0, 2.2, 0.9, TICK_DT), null, 'no damage during the grace');
  for (let t = 0; t < DAMAGE.grace + 0.1; t += TICK_DT) takeHit(d, 0, nose, 0, 2.2, 0.9, TICK_DT);
  assert.ok(takeHit(d, 30, nose, 0, 2.2, 0.9, TICK_DT)!.amount > 0, 'and then it counts again');
});

test('a hard landing hurts too, a normal one does not', () => {
  const d = newDamage();
  assert.equal(takeHit(d, 0, { x: 0, y: 0, z: 0 }, 6, 2.2, 0.9, TICK_DT), null);
  assert.ok(takeHit(d, 0, { x: 0, y: 0, z: 0 }, 20, 2.2, 0.9, TICK_DT)!.amount > 0);
});

test('a crushed nose costs power; a bent side pulls the steering that way', () => {
  const d = newDamage();
  d.total = 0.6;
  d.zones.front = 1;
  d.zones.left = 0.8;
  const h = handling(d);
  assert.ok(h.power < 0.6 && h.power >= DAMAGE.minPower);
  assert.ok(h.pull < -0.1, 'pulls left');
  const out = damagedInput(d, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  assert.equal(out.throttle, h.power);
  assert.equal(out.steer, h.pull);
  const fresh = damagedInput(newDamage(), { steer: 0.3, throttle: 1, brake: 0, handbrake: 0 }, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  assert.deepEqual([fresh.steer, fresh.throttle], [0.3, 1]);
});

test('zones pack into one number for the wire', () => {
  const d = newDamage();
  d.zones = { front: 1, rear: 0.2, left: 0, right: 0.6 };
  const z = unpackZones(packZones(d));
  for (const k of ['front', 'rear', 'left', 'right'] as const) assert.ok(Math.abs(z[k] - d.zones[k]) < 0.04, k);
  assert.ok(packZones(d) <= 0xffff);
});

// --- the physics records the knocks -----------------------------------------------------------------

/** A car on Kori Pass, moving at `speed` m/s with its nose pointing at the right-hand rail. */
function carAtRail(speed: number): Car {
  const t = getTrack('koripass');
  const s = 600;
  const l = pointAt(t, s, 0);
  const rx = -l.tz;
  const rz = l.tx;
  const car = newCar(carSpec(newOwnedCar('kitsune')), l.x, l.y, l.z, Math.atan2(-rx, -rz));
  car.hint = l.i;
  car.v = { x: rx * speed, y: 0, z: rz * speed };
  return car;
}

test('driving nose first into a rail at 100 km/h is a big delta-V on the front', () => {
  const t = getTrack('koripass');
  const car = carAtRail(kmh(100));
  let worst = 0;
  let zone = '';
  for (let i = 0; i < 240; i++) {
    stepCar(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }, t);
    if (car.crash > worst) {
      worst = car.crash;
      zone = zoneAt(car.crashP, car.spec.body.hl, car.spec.body.hw);
    }
  }
  assert.ok(worst > 18, `delta-V ${worst}`);
  assert.equal(zone, 'front');
  assert.ok(crashDamage(worst) > 0.4);
});

test('brushing the rail at low speed does no damage', () => {
  const t = getTrack('koripass');
  const car = carAtRail(kmh(15));
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }, t);
    worst = Math.max(worst, car.crash);
  }
  assert.equal(crashDamage(worst), 0, `delta-V ${worst}`);
});

test('a head-on between two cars hurts both, the lighter one more', () => {
  const t = getTrack('koripass');
  const g = gridSlot(t, 0);
  const light = newCar(carSpec(newOwnedCar('pebble')), g.x, g.y, g.z, g.yaw);
  const heavy = newCar(carSpec(newOwnedCar('vanta')), g.x, g.y, g.z, g.yaw + Math.PI);
  assert.ok(heavy.spec.mass > light.spec.mass);
  const fx = -Math.sin(g.yaw);
  const fz = -Math.cos(g.yaw);
  const gap = light.spec.body.hl + heavy.spec.body.hl - 0.05;
  heavy.p.x += fx * gap;
  heavy.p.z += fz * gap;
  light.v = { x: fx * 20, y: 0, z: fz * 20 };
  heavy.v = { x: -fx * 20, y: 0, z: -fz * 20 };
  collideCars(light, heavy, true);
  assert.ok(light.crash > DAMAGE.threshold && heavy.crash > DAMAGE.threshold);
  assert.ok(light.crash > heavy.crash);
  assert.equal(zoneAt(light.crashP, light.spec.body.hl, light.spec.body.hw), 'front');
  assert.equal(zoneAt(heavy.crashP, heavy.spec.body.hl, heavy.spec.body.hw), 'front');
});

// --- the room -------------------------------------------------------------------------------------

function room() {
  const inbox = new Map<number, RaceServerMsg[]>();
  let now = 1_000_000;
  const race = new Race('ABCD', () => {}, () => {}, () => {}, () => now, false);
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: false };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  return { race, join, inbox, advance, last: (id: number, t: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === t).at(-1) };
}

test('only the host flips Physics mode, and the race carries it', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(b, { t: 'physics', on: true });
  assert.equal(r.race.physics, false);
  r.race.handle(a, { t: 'physics', on: true });
  assert.equal(r.race.physics, true);
  const rm = r.last(2, 'room');
  assert.ok(rm?.t === 'room' && rm.physics);
  r.race.handle(a, { t: 'start' });
  const ld = r.last(2, 'load');
  assert.ok(ld?.t === 'load' && ld.physics);
});

test('wrecks and damage are relayed only with Physics on, and wrecks at most once a second', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'ready' });
  r.race.handle(b, { t: 'ready' });
  r.advance(4000);
  assert.equal(r.race.phase, 'racing');
  const pose = { t: 'state' as const, p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, -30] as [number, number, number], w: 0, s: 50, st: 0, ws: 80, rpm: 5000, f: 0, dm: 0x0f0f };
  r.race.handle(a, pose);
  const snap = r.last(2, 'snap');
  assert.ok(snap?.t === 'snap' && snap.cars[0].dm === undefined, 'no damage on the wire with Physics off');
  r.race.handle(a, { t: 'wreck', p: [1, 2, 3] });
  assert.equal(r.last(2, 'wreck'), undefined);

  r.race.physics = true;
  r.race.handle(a, pose);
  const snap2 = r.last(2, 'snap');
  assert.ok(snap2?.t === 'snap' && snap2.cars[0].dm === 0x0f0f);
  r.race.handle(a, { t: 'wreck', p: [1, 2, 3] });
  const w = r.last(2, 'wreck');
  assert.ok(w?.t === 'wreck' && w.id === 1 && w.p[2] === 3);
  assert.equal(r.last(1, 'wreck'), undefined, 'not echoed back');
  r.race.handle(a, { t: 'wreck', p: [4, 5, 6] });
  assert.equal(r.inbox.get(2)!.filter((m) => m.t === 'wreck').length, 1, 'rate limited');
  r.advance(1100);
  r.race.handle(a, { t: 'wreck', p: [4, 5, 6] });
  assert.equal(r.inbox.get(2)!.filter((m) => m.t === 'wreck').length, 2);
  r.race.handle(a, { t: 'wreck', p: [Number.NaN, 0, 0] as [number, number, number] });
  assert.equal(r.inbox.get(2)!.filter((m) => m.t === 'wreck').length, 2, 'bad positions dropped');
});
