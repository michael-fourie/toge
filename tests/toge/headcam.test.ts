import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Head, type HeadInput, ROUGH } from '../../src/toge/client/headcam.ts';

const still: HeadInput = { aLat: 0, aUp: 0, aFwd: 0, speed: 0, yawRate: 0, slip: 0, bodyRoll: 0, rough: 1, hit: 0, land: 0, rev: 0, boost: false };
const run = (h: Head, inp: Partial<HeadInput>, seconds: number, dt = 1 / 60) => {
  let p = h.update(0, { ...still, ...inp });
  for (let t = 0; t < seconds; t += dt) p = h.update(dt, { ...still, ...inp });
  return p;
};

test('sat still with the engine off, the view does not move', () => {
  const p = run(new Head(), {}, 2);
  for (const k of ['lat', 'up', 'fwd', 'pitch', 'yaw', 'roll', 'fov'] as const) assert.ok(Math.abs(p[k]) < 1e-9, `${k} = ${p[k]}`);
});

test('accelerating presses the head back and tips the view up; braking throws it forward and down', () => {
  const go = run(new Head(), { aFwd: 6, speed: 20, rough: 0 }, 2);
  assert.ok(go.fwd < -0.01 && go.fwd > -0.06, `head ${go.fwd} m`);
  assert.ok(go.pitch > 0);
  const stop = run(new Head(), { aFwd: -10, speed: 20, rough: 0 }, 2);
  assert.ok(stop.fwd > 0.02 && stop.pitch < 0);
});

test('in a right-hand corner the head swings left and tilts, but a 3 g arcade corner stays within the cabin', () => {
  const p = run(new Head(), { aLat: 9, speed: 25, yawRate: -0.6, rough: 0 }, 2);
  assert.ok(p.lat < -0.02 && p.roll > 0, 'pushed toward the outside of the turn');
  assert.ok(p.yaw < 0, 'eyes go right, into the corner');
  const hard = run(new Head(), { aLat: 30, speed: 25, rough: 0 }, 2);
  assert.ok(Math.abs(hard.lat) <= 0.06 && Math.abs(hard.roll) < 0.15);
});

test('road rumble grows with speed and on loose ground, and is gone when stopped', () => {
  const shake = (inp: Partial<HeadInput>) => {
    const h = new Head();
    run(h, inp, 0.5);
    let peak = 0;
    for (let i = 0; i < 240; i++) peak = Math.max(peak, Math.abs(h.update(1 / 60, { ...still, ...inp }).up));
    return peak;
  };
  assert.equal(shake({ speed: 0 }), 0);
  const slow = shake({ speed: 10 });
  const fast = shake({ speed: 40 });
  const gravel = shake({ speed: 40, rough: ROUGH.gravel });
  assert.ok(slow > 0 && fast > slow * 2 && gravel > fast * 2, `${slow} ${fast} ${gravel}`);
  assert.equal(shake({ speed: 40, rough: 0 }), 0, 'no road texture in the air');
  assert.ok(gravel < 0.02, 'rumble is felt, not a blur');
});

test('a crash shakes the view hard, then it settles within a couple of seconds', () => {
  const h = new Head();
  run(h, { speed: 20, rough: 0 }, 1);
  h.update(1 / 60, { ...still, speed: 20, rough: 0, hit: 15 });
  assert.ok(h.trauma > 0.5);
  let peak = 0;
  for (let i = 0; i < 30; i++) peak = Math.max(peak, Math.abs(h.update(1 / 60, { ...still, speed: 20, rough: 0 }).roll));
  assert.ok(peak > 0.01, `peak roll ${peak}`);
  const after = run(h, { speed: 20, rough: 0 }, 3);
  assert.equal(h.trauma, 0);
  assert.ok(Math.abs(after.fwd) < 0.005 && Math.abs(after.roll) < 0.005);
});

test('a frame-rate hitch or absurd input cannot blow the head up', () => {
  const h = new Head();
  const p = h.update(5, { ...still, aFwd: 1e6, aLat: -1e6, aUp: 1e6, speed: 500, hit: 1e4, land: 1e4, rev: 2, boost: true });
  for (const k of ['lat', 'up', 'fwd', 'pitch', 'yaw', 'roll'] as const) assert.ok(Number.isFinite(p[k]) && Math.abs(p[k]) < 0.3, `${k} = ${p[k]}`);
  assert.ok(p.fov >= 0 && p.fov <= 12);
});
