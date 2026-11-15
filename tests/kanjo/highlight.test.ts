import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIGHLIGHT, MomentFlag, MomentTape, bestMoment, momentLine, slipOf } from '../../src/kanjo/shared/highlight.ts';
import { RACE } from '../../src/kanjo/shared/protocol.ts';

const DT = 1 / 120;
/** A quaternion for yaw (three.js: 0 looks down -z). */
const yawQ = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/**
 * A run along -z at 120 Hz for `seconds`, its speed and slip from `at(t)`, ending (crossing the line) at the end.
 * Slip turns the velocity away from the nose, which stays pointing down -z.
 */
function run(seconds: number, at: (t: number) => { speed: number; slip?: number; air?: boolean }): MomentTape {
  const tape = new MomentTape();
  let z = 0;
  for (let t = 0; t <= seconds + 1e-9; t += DT) {
    const { speed, slip = 0, air = false } = at(t);
    // Velocity rotated by `slip` from the nose (+ = sliding to the nose's left, toward -x).
    const v = { x: -Math.sin(slip) * speed, y: 0, z: -Math.cos(slip) * speed };
    z += v.z * DT;
    tape.add(t, { p: { x: 0, y: 0, z }, q: yawQ(0), v, steer: 0, flags: air ? MomentFlag.Air : 0 });
  }
  tape.end = seconds;
  return tape;
}

test('highlight: a tape samples at HIGHLIGHT.hz and poses a car between samples', () => {
  const tape = run(10, () => ({ speed: 30 }));
  assert.ok(Math.abs(tape.length - 10 * HIGHLIGHT.hz) <= 2, `~${10 * HIGHLIGHT.hz} samples, got ${tape.length}`);
  const p = tape.at(4.025);
  assert.ok(Math.abs(p.z - -30 * 4.025) < 0.6, `halfway between samples: z ${p.z}`);
  assert.equal(p.speed.toFixed(1), '30.0');
  // Before the first sample and after the last it holds the ends.
  assert.ok(Math.abs(tape.at(-5).z - tape.at(0).z) < 1e-9);
  assert.ok(Math.abs(tape.at(99).z - tape.at(10).z) < 1e-9);
});

test('highlight: slip is the angle between the nose and the travel, signed, and 0 when slow or going backwards', () => {
  const q = yawQ(0);
  assert.ok(Math.abs(slipOf(q, { x: 0, z: -30 })) < 1e-12);
  assert.ok(Math.abs(slipOf(q, { x: -Math.sin(0.5) * 30, z: -Math.cos(0.5) * 30 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(slipOf(q, { x: Math.sin(0.5) * 30, z: -Math.cos(0.5) * 30 }) + 0.5) < 1e-9);
  assert.equal(slipOf(q, { x: 1, z: -1 }), 0, 'crawling');
  assert.equal(slipOf(q, { x: 0, z: 20 }), 0, 'reversing');
  // A turned car: the nose of yaw π/2 looks down -x.
  assert.ok(Math.abs(slipOf(yawQ(Math.PI / 2), { x: -30, z: 0 })) < 1e-9);
});

test('highlight: the best moment is the long drift, not the cruise around it', () => {
  // 60 s at 100 km/h, a 4 s drift at 40° from 30 s.
  const tape = run(60, (t) => (t >= 30 && t < 34 ? { speed: 28, slip: 0.7 } : { speed: 28 }));
  const m = bestMoment(tape)!;
  assert.equal(m.kind, 'drift');
  const mid = m.start + HIGHLIGHT.seconds / 2;
  assert.ok(m.start <= 30 && m.start + HIGHLIGHT.seconds >= 34, `the window covers the drift: starts ${m.start}`);
  assert.ok(Math.abs(mid - 32) < 0.6, `the drift is in the middle of the replay: ${mid}`);
  assert.equal(m.angle, 40);
  assert.equal(m.kmh, 101);
  assert.equal(momentLine(m), 'Drift · 40° at 101 km/h');
});

test('highlight: flat out beats a gentle slide, and a jump counts', () => {
  const fast = run(60, (t) => (t > 40 && t < 46 ? { speed: 80 } : t > 10 && t < 15 ? { speed: 20, slip: 0.2 } : { speed: 35 }));
  const m = bestMoment(fast)!;
  assert.equal(m.kind, 'speed');
  assert.ok(m.start <= 40.05 && m.start + HIGHLIGHT.seconds >= 46, `covers the run: starts ${m.start}`);
  assert.ok(Math.abs(m.start + HIGHLIGHT.seconds / 2 - 43) < 0.6, `centred on it: starts ${m.start}`);
  assert.equal(m.kmh, 288);
  assert.equal(momentLine(m), 'Flat out · 288 km/h');
  const jump = run(60, (t) => ({ speed: 33, air: t > 20 && t < 22.5 }));
  assert.equal(bestMoment(jump)!.kind, 'air');
  // A one second jump in ten seconds of cruising is still the jump.
  const hop = run(60, (t) => ({ speed: 33, air: t > 20 && t < 21 }));
  assert.equal(bestMoment(hop)!.kind, 'air');
});

test('highlight: never the launch, never past the line, and a short run is shown whole', () => {
  // Fastest right off the grid and after the finish (still on the tape): neither is picked.
  const tape = run(40, (t) => ({ speed: t < 1.5 ? 90 : 30 }));
  for (let t = 40; t < 50; t += DT) tape.add(t, { p: { x: 0, y: 0, z: 0 }, q: yawQ(0), v: { x: 0, y: 0, z: -95 }, steer: 0, flags: 0 });
  const m = bestMoment(tape)!;
  assert.ok(m.start >= HIGHLIGHT.skip - 1e-6, `after the launch: ${m.start}`);
  assert.ok(m.start + HIGHLIGHT.seconds <= 40 + 1e-6, `before the line: ${m.start}`);
  const short = bestMoment(run(3, () => ({ speed: 30 })))!;
  assert.equal(short.start, 0);
  assert.equal(bestMoment(new MomentTape()), null);
});

test('highlight: the room holds every results screen long enough for the replay', () => {
  assert.equal(RACE.resultsSeconds, 12 + HIGHLIGHT.seconds);
  assert.equal(RACE.gpResultsSeconds, 15 + HIGHLIGHT.seconds);
  assert.equal(RACE.cupResultsSeconds, 25 + HIGHLIGHT.seconds);
});
