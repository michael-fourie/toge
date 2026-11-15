import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { DRIFT, DRIFT_MAX_RATE, bankCombo, clampDrift, comboPoints, driftPay, newDriftMeter, slideOf, stepDrift } from '../../src/kanjo/shared/drift.ts';
import { SOLO_SHARE, TRACK_LENGTH_KM, applyAction, newGarage, payout, raceBonus } from '../../src/kanjo/shared/garage.ts';
import { Race, type RaceClient } from '../../src/kanjo/server/race.ts';
import { RACE, type RaceServerMsg, type ResultRow } from '../../src/kanjo/shared/protocol.ts';
import { type Car, TICK_DT, newCar } from '../../src/kanjo/shared/vehicle.ts';

/** A car pointing down -z (yaw 0), on its wheels, moving at `speed` m/s with the given slip angle (rad). */
function sliding(speed: number, angle: number, drift = 0): Car {
  const car = newCar(carSpec(newOwnedCar('pebble')), 0, 0, 0, 0);
  for (const w of car.wheels) w.contact = true;
  car.v = { x: speed * Math.sin(angle), y: 0, z: -speed * Math.cos(angle) };
  car.drift = drift;
  return car;
}

const run = (m: ReturnType<typeof newDriftMeter>, car: Car, seconds: number) => {
  const evs = [];
  for (let t = 0; t < seconds; t += TICK_DT) {
    const e = stepDrift(m, car, TICK_DT);
    if (e) evs.push(e);
  }
  return evs;
};

test('slip angle: straight is 0, sideways reads the angle', () => {
  assert.ok(slideOf(sliding(30, 0)).angle < 1e-6);
  assert.ok(Math.abs(slideOf(sliding(30, 0.4)).angle - 0.4) < 1e-6);
  assert.ok(Math.abs(slideOf(sliding(30, -0.4)).angle - 0.4) < 1e-6, 'either way round');
});

test('driving straight scores nothing; a slide scores by speed and angle, then banks after the gap', () => {
  const m = newDriftMeter();
  assert.deepEqual(run(m, sliding(40, 0.05), 3), []);
  assert.equal(m.combo, 0);
  run(m, sliding(30, 0.5), 2);
  const expect = DRIFT.perMetre * 30 * (0.5 + 0.5) * 2;
  assert.ok(Math.abs(m.combo - expect) < DRIFT.perMetre, `${m.combo} ≈ ${expect}`);
  const evs = run(m, sliding(30, 0), DRIFT.chainGap + 0.1);
  assert.equal(evs.length, 1);
  assert.equal(evs[0]!.kind, 'bank');
  assert.equal(m.total, evs[0]!.points);
  assert.equal(m.combo, 0);
});

test('the drift button counts as a slide even at a small angle; too slow never counts', () => {
  const m = newDriftMeter();
  run(m, sliding(30, 0.1, 1), 1);
  assert.ok(m.combo > 0);
  const slow = newDriftMeter();
  run(slow, sliding(DRIFT.minSpeed - 1, 0.6, 1), 1);
  assert.equal(slow.combo, 0);
});

test('linked slides raise the multiplier (capped); a crash or a spin loses the combo', () => {
  const m = newDriftMeter();
  for (let i = 0; i < 12; i++) {
    run(m, sliding(30, 0.5), 0.5);
    run(m, sliding(30, 0), DRIFT.chainGap / 2);
  }
  assert.equal(m.mult, DRIFT.maxMult);
  assert.equal(comboPoints(m), Math.round(m.combo * DRIFT.maxMult));
  const crash = sliding(30, 0.5);
  crash.hit = DRIFT.crash + 1;
  const e = stepDrift(m, crash, TICK_DT);
  assert.equal(e?.kind, 'drop');
  assert.equal(m.total, 0, 'nothing banked');
  assert.equal(m.combo, 0);
  run(m, sliding(30, 0.5), 1);
  const spun = sliding(30, 0.5);
  spun.spin = 0.5;
  assert.equal(stepDrift(m, spun, TICK_DT)?.kind, 'drop');
});

test('bankCombo (crossing the line mid-combo) keeps the points', () => {
  const m = newDriftMeter();
  run(m, sliding(30, 0.5), 1);
  const pts = comboPoints(m);
  assert.equal(bankCombo(m), pts);
  assert.equal(m.total, pts);
  assert.equal(m.best, pts);
});

test('nobody can out-score the rate cap', () => {
  const m = newDriftMeter();
  for (let i = 0; i < 20; i++) {
    run(m, sliding(200, 1.4, 1), 1);
    run(m, sliding(200, 0), 0.1);
  }
  bankCombo(m);
  assert.ok(m.total <= DRIFT_MAX_RATE * 22, `${m.total} within ${DRIFT_MAX_RATE * 22}`);
});

test('clampDrift: junk is 0, reports are capped by the race clock', () => {
  assert.equal(clampDrift('lots', 60), 0);
  assert.equal(clampDrift(-5, 60), 0);
  assert.equal(clampDrift(NaN, 60), 0);
  assert.equal(clampDrift(1e12, 10), Math.floor(10 * DRIFT_MAX_RATE));
  assert.equal(clampDrift(1234.7, 60), 1234);
});

test('drift pay: per point, capped per km', () => {
  assert.equal(driftPay(20_000, 5), 1000);
  assert.equal(driftPay(1e9, 5), DRIFT.payPerKm * 5);
  // Bonus money stays well under a win: drifting can't out-earn racing.
  const maxBonus = raceBonus(1e9, 'koripass', false);
  assert.ok(maxBonus.drift < payout(1, 8, 'koripass', false) / 2);
});

test('solo: drifting adds a (solo-share) bonus to the prize, clamped', () => {
  const plain = applyAction(newGarage(), { a: 'solo', track: 'saltwind', place: 1, field: 4 }, Math.random, 1_000_000);
  const bonus = applyAction(newGarage(), { a: 'solo', track: 'saltwind', place: 1, field: 4, drift: 20_000 }, Math.random, 1_000_000);
  assert.ok(plain.ok && bonus.ok);
  const want = raceBonus(20_000, 'saltwind', true);
  assert.equal(want.drift, Math.round((driftPay(20_000, TRACK_LENGTH_KM.saltwind) * SOLO_SHARE) / 10) * 10);
  assert.deepEqual(bonus.bonus, want);
  assert.equal(bonus.paid, plain.paid! + want.drift);
  assert.equal(bonus.g.money, plain.g.money + want.drift);
  const cheat = applyAction(newGarage(), { a: 'solo', track: 'saltwind', place: 1, field: 4, drift: 1e12 }, Math.random, 1_000_000);
  assert.ok(cheat.ok);
  assert.deepEqual(cheat.bonus, raceBonus(1e12, 'saltwind', true));
  assert.ok(cheat.bonus!.drift <= DRIFT.payPerKm * TRACK_LENGTH_KM.saltwind * SOLO_SHARE + 10);
});

/** A race room with fake sockets and a hand-wound clock (as in raceroom.test.ts). */
function room(mode: 'race' | 'trial' = 'race') {
  let now = 1_000_000;
  const paid: ResultRow[][] = [];
  const race = new Race('DRFT', () => {}, () => {}, (rows) => paid.push(rows), () => now, false);
  const inbox = new Map<number, RaceServerMsg[]>();
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: true };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  const a = join(1);
  const b = join(2);
  race.handle(a, { t: 'mode', mode });
  race.handle(a, { t: 'start' });
  race.handle(a, { t: 'ready' });
  race.handle(b, { t: 'ready' });
  advance(RACE.countdownMs + 100);
  assert.equal(race.phase, 'racing');
  return { race, a, b, advance, paid, inbox };
}

test('online: the server caps drift by the clock and pays the bonus in the prize', () => {
  const r = room();
  r.advance(60_000);
  r.race.handle(r.a, { t: 'drift', pts: 30_000 });
  r.race.handle(r.a, { t: 'drift', pts: 10_000 }); // a lower total never takes points away
  r.race.handle(r.b, { t: 'drift', pts: 1e9 }); // way past what 60 s allows
  r.advance(300);
  r.race.handle(r.a, { t: 'finish', time: 60.4 });
  r.race.handle(r.a, { t: 'drift', pts: 9000 }); // after finishing: ignored
  r.race.handle(r.b, { t: 'finish', time: 61 });
  assert.equal(r.paid.length, 1);
  const [ra, rb] = r.paid[0]!;
  assert.equal(ra!.drift, 30_000);
  assert.deepEqual(ra!.bonus, raceBonus(30_000, 'koripass', false));
  assert.equal(ra!.prize, payout(1, 2, 'koripass', false) + ra!.bonus.drift);
  assert.ok(rb!.drift <= Math.ceil(61 * DRIFT_MAX_RATE) && rb!.drift > 0);
  assert.equal(rb!.bonus.drift, DRIFT.payPerKm * TRACK_LENGTH_KM.koripass, 'capped per km');
  // A new race starts from zero.
  r.advance(RACE.resultsSeconds * 1000 + 100);
  r.race.handle(r.a, { t: 'start' });
  r.race.handle(r.a, { t: 'ready' });
  r.race.handle(r.b, { t: 'ready' });
  r.advance(RACE.countdownMs + 100);
  r.advance(45_000);
  r.race.handle(r.a, { t: 'finish', time: 45 });
  r.race.handle(r.b, { t: 'finish', time: 46 });
  assert.deepEqual(r.paid[1]![0]!.bonus, { drift: 0 });
});

test('online: a DNF still gets its drift bonus; a time trial pays drift too', () => {
  const r = room();
  r.advance(50_000);
  r.race.handle(r.b, { t: 'drift', pts: 20_000 });
  r.race.handle(r.a, { t: 'finish', time: 50 });
  r.advance(RACE.dnfSeconds * 1000 + 100);
  const rb = r.paid[0]!.find((x) => x.id === 2)!;
  assert.equal(rb.place, 0);
  assert.equal(rb.prize, payout(0, 2, 'koripass', false) + rb.bonus.drift);
  assert.ok(rb.bonus.drift > 0);

  const t = room('trial');
  t.advance(50_000);
  t.race.handle(t.a, { t: 'drift', pts: 20_000 });
  t.race.handle(t.a, { t: 'finish', time: 50 });
  t.race.handle(t.b, { t: 'finish', time: 51 });
  const ta = t.paid[0]!.find((x) => x.id === 1)!;
  assert.ok(ta.bonus.drift > 0);
});
