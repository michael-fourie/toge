import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_IDS, carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { CUPS } from '../../src/kanjo/shared/cups.ts';
import { newDamage, takeHit } from '../../src/kanjo/shared/damage.ts';
import { aiDrive, newAi } from '../../src/kanjo/shared/driver.ts';
import { GAPFALL, gapFall } from '../../src/kanjo/shared/skyfall.ts';
import { GAP, SAMPLE, clearOfGaps, getTrack, gridSlot, heightAt, inGap, pointAt } from '../../src/kanjo/shared/track.ts';
import { type DriveInput, TICK_DT, newCar, resetCar, speedOf, stepCar } from '../../src/kanjo/shared/vehicle.ts';

// Jigoku Drop, the survival downhill, and the gap in the road (track.ts `gap`) it's built on.
// Michael, 2026-11-19: "Make a new map. Make it a steep down hill with lots of big gaps and weird spots. It's like
// survival with crash damage but you can survive them."

const t = getTrack('jigoku');
const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

test('Jigoku Drop: steep, point to point, six big gaps, crash damage always on, last round of the Gravity Cup', () => {
  const d = t.def;
  assert.ok(!d.laps && d.survival && d.obstacles);
  const fall = t.y[Math.round(t.startS / SAMPLE)] - t.y[Math.round(t.finishS / SAMPLE)];
  const km = (t.finishS - t.startS) / 1000;
  assert.ok(fall / (km * 1000) > 0.1, `${fall.toFixed(0)} m down in ${km.toFixed(1)} km: steep`);
  assert.equal(t.gaps.length, 6);
  for (const g of t.gaps) assert.ok(g.s1 - g.s0 >= 25, `a ${g.s1 - g.s0} m gap is big`);
  // Big landings dent the car rather than wreck it: a landing does well under what it does elsewhere.
  assert.ok(d.survival!.land < 0.25 && d.survival!.hit < 1);
  assert.equal(t.boosts.length, 0, 'nothing helps you down');
  assert.equal(CUPS.gravity.tracks.at(-1), 'jigoku');
});

test('a gap: no road over the hole, a ravine under it, no props or runoff by it, the road again past it', () => {
  for (const g of t.gaps) {
    const mid = pointAt(t, (g.s0 + g.s1) / 2, 0);
    assert.ok(heightAt(t, mid.x, mid.z) < mid.y - GAP.depth + 1, 'the ravine is far below');
    for (const s of [g.s0 - 2, g.s1 + 2]) {
      const p = pointAt(t, s, 0);
      assert.ok(Math.abs(heightAt(t, p.x, p.z) - p.y) < 0.05, `road at ${s}`);
    }
    for (let i = Math.round(g.s0 / SAMPLE); i <= Math.round(g.s1 / SAMPLE); i++) {
      assert.equal(t.runL[i] + t.runR[i], 0, 'no runoff beside the hole');
      assert.equal(t.hole[i], i > g.s0 / SAMPLE && i < g.s1 / SAMPLE ? g.depth : 0);
    }
    assert.ok(!t.props.some((p) => p.s > g.s0 - 150 && p.s < g.s1 + 30), `a prop by the gap at ${g.s0}`);
    assert.equal(inGap(t, g.s0 + 1), g);
    // Never put back stopped on the run-up: there's no way to get the speed from there.
    for (const s of [g.s0 - 10, g.s0 + 5]) assert.equal(clearOfGaps(t, s), g.s0 - GAP.runup);
    assert.equal(clearOfGaps(t, g.s1 + 1), g.s1 + 1);
  }
});

/** Rolls a car at `v` m/s into gap `g` from 40 m back. */
function into(model: (typeof CAR_IDS)[number], g: { s0: number; s1: number }, v: number) {
  const car = newCar(carSpec(newOwnedCar(model)), 0, 0, 0, 0);
  resetCar(car, t, g.s0 - 40);
  const l = pointAt(t, g.s0 - 40, 0);
  car.v = { x: l.tx * v, y: 0, z: l.tz * v };
  let up = 0;
  for (let time = 0; time < 10 && car.s < g.s1 + 50; time += TICK_DT) {
    stepCar(car, { ...idle, throttle: 0.3 }, t);
    if (gapFall(car, t)) return { fell: true, car, up };
    up = Math.max(up, car.v.y);
  }
  return { fell: false, car, up };
}

test('too slow and you fall in, and come back past the gap, stopped; fast enough and you clear it', () => {
  for (const g of t.gaps) {
    const slow = into('kitsune', g, 12);
    assert.ok(slow.fell, `crawled over the ${g.s1 - g.s0} m gap`);
    const back = pointAt(t, g.s1 + GAPFALL.after, 0);
    assert.ok(Math.hypot(slow.car.p.x - back.x, slow.car.p.z - back.z) < 0.5 && speedOf(slow.car) < 0.1, 'back past it, stopped');
    const quick = into('kitsune', g, 34);
    assert.ok(!quick.fell && quick.car.s > g.s1 + 40, `fell into the ${g.s1 - g.s0} m gap at 122 km/h`);
  }
});

test('coming down short on the far edge never throws a car into the sky', () => {
  // Sweep the speeds where a car just makes it or just doesn't: the edge under the road's end must never kick it up.
  for (const model of ['pebble', 'kitsune', 'raiden', 'vanta'] as const)
    for (const g of t.gaps)
      for (let v = 16; v <= 32; v += 0.5) {
        const r = into(model, g, v);
        if (!r.fell) assert.ok(r.up < 6, `${model} at ${v} m/s over the gap at ${g.s0}: thrown up at ${r.up.toFixed(1)} m/s`);
      }
});

test('a car put back before a gap gets up the speed to clear it', () => {
  for (const g of t.gaps) {
    const car = newCar(carSpec(newOwnedCar('pebble')), 0, 0, 0, 0);
    resetCar(car, t, clearOfGaps(t, g.s0));
    const ai = newAi(0.9, 0);
    const inp = { ...idle };
    let fell = false;
    for (let time = 0; time < 30 && car.s < g.s1 + 30; time += TICK_DT) {
      aiDrive(car, t, ai, TICK_DT, inp);
      stepCar(car, inp, t);
      fell ||= gapFall(car, t);
    }
    assert.ok(!fell && car.s > g.s1 + 30, `the starter car fell into the gap at ${g.s0} from a standing start`);
  }
});

test('survival damage: a clean run down comes out dented, not wrecked; the soak scales knocks and landings', () => {
  for (const model of CAR_IDS) {
    for (const skill of [0.55, 0.9]) {
      const g = gridSlot(t, 0);
      const car = newCar(carSpec(newOwnedCar(model)), g.x, g.y, g.z, g.yaw);
      const ai = newAi(skill, 0);
      const inp = { ...idle };
      const dmg = newDamage();
      let wrecks = 0;
      let time = 0;
      while (car.s < t.finishS && time < 400) {
        aiDrive(car, t, ai, TICK_DT, inp);
        stepCar(car, inp, t);
        assert.ok(!gapFall(car, t), `${model} (${skill}) fell into a gap at ${car.s.toFixed(0)}`);
        if (takeHit(dmg, car.crash, car.crashP, car.land, car.spec.body.hl, car.spec.body.hw, TICK_DT, t.def.survival!.hit, t.def.survival!.land)?.wrecked) wrecks++;
        time += TICK_DT;
      }
      assert.ok(car.s >= t.finishS, `${model} (${skill}) stuck at ${car.s.toFixed(0)}`);
      assert.equal(wrecks, 0, `${model} (${skill}) was wrecked on a clean run`);
      if (skill > 0.8 && model !== 'raiden') assert.ok(dmg.total > 0.2, `${model}: the landings barely dented it (${dmg.total.toFixed(2)})`);
    }
  }
  const knock = (soak: number, landSoak: number, dv: number, land: number) => takeHit(newDamage(), dv, { x: 0, y: 0, z: -2 }, land, 2, 1, TICK_DT, soak, landSoak)?.amount ?? 0;
  assert.ok(Math.abs(knock(0.5, 1, 20, 0) - knock(1, 1, 20, 0) / 2) < 1e-9);
  assert.ok(Math.abs(knock(1, 0.15, 0, 30) - knock(1, 1, 0, 30) * 0.15) < 1e-9);
});
