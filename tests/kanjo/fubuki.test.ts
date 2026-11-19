import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_IDS, carSpec, newOwnedCar } from '../../src/kanjo/shared/cars.ts';
import { CUPS } from '../../src/kanjo/shared/cups.ts';
import { newDamage, takeHit } from '../../src/kanjo/shared/damage.ts';
import { aiDrive, newAi } from '../../src/kanjo/shared/driver.ts';
import { ROCKFALL_GAP } from '../../src/kanjo/shared/props.ts';
import { gapFall } from '../../src/kanjo/shared/skyfall.ts';
import { RIVER, SAMPLE, getTrack, gridSlot, heightAt, onFork, pointAt, riverCut } from '../../src/kanjo/shared/track.ts';
import { type DriveInput, TICK_DT, newCar, stepCar } from '../../src/kanjo/shared/vehicle.ts';

// Fubuki Pass, the snowy survival downhill, and what it added: rivers across the road (TrackDef.rivers), stones fallen
// onto a downhill (TrackDef.rockfall), and a fork on a survival road.
// Michael, 2026-11-19: "make another one like that but snowy mountain and add upward ramp jumps on the way down,
// alternate paths, shortcuts, rock falls, and river crossings".

const t = getTrack('fubuki');
const f = t.fork!;
const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

test('Fubuki Pass: a steep snowy survival downhill with ramps, gaps, a fork, shortcuts, rockfall and rivers', () => {
  const d = t.def;
  assert.ok(!d.laps && d.survival && d.rockfall);
  assert.equal(d.theme, 'alpine');
  const fall = t.y[Math.round(t.startS / SAMPLE)] - t.y[Math.round(t.finishS / SAMPLE)];
  const km = (t.finishS - t.startS) / 1000;
  assert.ok(fall / (km * 1000) > 0.09, `${fall.toFixed(0)} m down in ${km.toFixed(1)} km: steep`);
  // Upward ramps: kickers that throw you up before the road drops away (or the gap opens).
  const ramps = d.features!.filter((x) => (x.kind === 'jump' || x.kind === 'gap') && x.size >= 3);
  assert.ok(ramps.length >= 4, `${ramps.length} ramps`);
  assert.equal(t.gaps.length, 4);
  assert.equal(t.cuts.length, 3, 'a shortcut across each hairpin');
  for (const c of t.cuts) assert.ok(c.s1 - c.s0 > 150, 'a shortcut skips real road');
  assert.equal(t.rivers.length, 2);
  assert.equal(t.boosts.length, 0, 'nothing helps you down');
  assert.ok(d.survival!.land < 0.25 && d.survival!.hit < 1);
  assert.deepEqual(CUPS.gravity.tracks.slice(-2), ['fubuki', 'jigoku']);
});

test('rivers: each crosses the road under a gap or a bridge, in a channel cut into the hills, and meets no other road', () => {
  for (const r of t.rivers) {
    const under = t.gaps.some((g) => r.s > g.s0 && r.s < g.s1) || t.spans.some((sp) => sp.kind === 'bridge' && r.s > sp.s0 && r.s < sp.s1);
    assert.ok(under, `the river at ${r.s.toFixed(0)} is crossed by a gap or a bridge`);
    // The bed is RIVER.depth below the hills either side of it, out along its length.
    assert.ok(r.a0 <= -40 && r.a1 >= 40, `the river at ${r.s.toFixed(0)} runs out either side of the road (${r.a0.toFixed(0)} to ${r.a1.toFixed(0)} m)`);
    assert.ok(r.a1 - r.a0 > 200, 'a real river, not a puddle');
    for (const along of [r.a0 / 2, -10, 0, 10, r.a1 / 2]) {
      const x = r.x + r.ux * along;
      const z = r.z + r.uz * along;
      assert.ok(Math.abs(riverCut(t, x, z) - RIVER.depth) < 1e-9, `the bed at ${along} m`);
      const bank = RIVER.half + RIVER.bank + 1;
      assert.equal(riverCut(t, x + r.uz * bank, z - r.ux * bank), 0, 'nothing cut past the banks');
    }
    // No other stretch of road (the fork's or a shortcut's) runs through its channel.
    const reach = RIVER.half + RIVER.bank + t.edge;
    for (let i = 0; i < t.n + f.m; i++) {
      if (Math.abs(t.s[i] - r.s) < 80) continue;
      const dx = t.x[i] - r.x;
      const dz = t.z[i] - r.z;
      const along = dx * r.ux + dz * r.uz;
      const across = Math.abs(-dx * r.uz + dz * r.ux);
      assert.ok(along < r.a0 || along > r.a1 || across > reach, `the river at ${r.s.toFixed(0)} runs under the road at ${t.s[i].toFixed(0)}${onFork(t, i) ? ' (fork)' : ''}`);
    }
  }
});

test('rockfall: stones down the whole road, never closing it, off the tight bends, the gaps and where the fork splits and joins', () => {
  const stones = t.props.filter((p) => p.kind === 'boulder' || p.kind === 'rock');
  assert.equal(stones.length, t.props.length, 'only stones');
  assert.ok(stones.length > 40, `${stones.length} stones`);
  assert.ok(stones.some((p) => p.s < t.length / 3) && stones.some((p) => p.s > (t.length * 2) / 3), 'all the way down');
  for (const p of stones) {
    assert.ok(t.half - Math.abs(p.d) + p.r <= t.half * 2 - ROCKFALL_GAP + 1e-6, `the stone at ${p.s.toFixed(0)} leaves ${ROCKFALL_GAP} m clear`);
    assert.ok(Math.abs(t.curv[Math.round(p.s / SAMPLE)]) <= 1 / 80, `a stone on a tight bend at ${p.s.toFixed(0)}`);
    assert.ok(!t.gaps.some((g) => p.s > g.s0 - 150 && p.s < g.s1 + 30), `a stone by the gap near ${p.s.toFixed(0)}`);
    assert.ok(Math.abs(p.s - f.s0) > 150 && Math.abs(p.s - f.s1) > 150, `a stone where the fork's roads run side by side (${p.s.toFixed(0)})`);
  }
});

test('the fork: before any drop, its two roads meet the main one in line and at its height', () => {
  assert.ok(t.gaps.every((g) => g.s0 > f.s1) && f.s0 > t.startS, 'it comes before the gaps');
  const last = f.o + f.m - 1;
  for (const [i, j] of [[f.o, f.a], [last, f.b]]) {
    assert.ok(Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) < 1e-6, 'starts and ends on the main road');
    assert.ok(Math.abs(t.y[i] - t.y[j]) < 0.05, `at its height (${t.y[i].toFixed(2)} and ${t.y[j].toFixed(2)})`);
  }
  let apart = 0;
  for (let k = 0; k < f.m; k++) apart = Math.max(apart, Math.hypot(t.x[f.o + k] - t.x[f.a + k], t.z[f.o + k] - t.z[f.a + k]));
  assert.ok(apart > 150, `the two roads get ${apart.toFixed(0)} m apart`);
  // The second road is the clean one: the main road takes a ramp.
  const p = pointAt(t, (f.s0 + f.s1) / 2, 0, true);
  assert.ok(Math.abs(heightAt(t, p.x, p.z) - p.y) < 0.05);
});

test('the AI gets down either road in every car, never falls in a gap, and comes out dented, not wrecked', { timeout: 300_000 }, () => {
  for (const alt of [false, true])
    for (const skill of alt ? [0.9] : [0.55, 0.9])
      for (const model of CAR_IDS) {
        const g = gridSlot(t, 0);
        const car = newCar(carSpec(newOwnedCar(model)), g.x, g.y, g.z, g.yaw);
        const ai = newAi(skill, 0, alt);
        const inp = { ...idle };
        const dmg = newDamage();
        let wrecks = 0;
        let time = 0;
        let second = 0;
        while (car.s < t.finishS && time < 400) {
          aiDrive(car, t, ai, TICK_DT, inp);
          stepCar(car, inp, t);
          if (onFork(t, car.hint)) second++;
          assert.ok(!gapFall(car, t), `${model} (${skill}${alt ? ', fork' : ''}) fell into a gap at ${car.s.toFixed(0)}`);
          if (takeHit(dmg, car.crash, car.crashP, car.land, car.spec.body.hl, car.spec.body.hw, TICK_DT, t.def.survival!.hit, t.def.survival!.land)?.wrecked) wrecks++;
          time += TICK_DT;
        }
        const who = `${model} (${skill}${alt ? ', fork' : ''})`;
        assert.ok(car.s >= t.finishS, `${who} stuck at ${car.s.toFixed(0)}`);
        assert.equal(second > 0, alt, `${who} took the road it meant to`);
        assert.equal(wrecks, 0, `${who} was wrecked on a clean run`);
        if (skill > 0.8 && model !== 'raiden') assert.ok(dmg.total > 0.2, `${who}: the landings barely dented it (${dmg.total.toFixed(2)})`);
      }
});
