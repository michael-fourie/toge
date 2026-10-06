import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box } from '../src/shared/collision.ts';
import { MOVE, TICK_DT } from '../src/shared/constants.ts';
import { hlen, type Vec3 } from '../src/shared/math.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';

const floor: Box = { min: { x: -500, y: -1, z: -500 }, max: { x: 500, y: 0, z: 500 }, kind: 'floor' };

function run(s: PlayerState, input: MoveInput, seconds: number, onTick?: () => void) {
  let events = 0;
  for (let i = 0, n = Math.round(seconds / TICK_DT); i < n; i++) {
    onTick?.();
    stepPlayer(s, input, TICK_DT, [floor]);
    events |= s.events;
    input.jumpPressed = false;
  }
  return events;
}

/** Standing on the floor, running forward (-Z) at full ground speed. */
function runner() {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  run(s, input, 1.5);
  return { s, input };
}

test('Shift at run speed starts a low-friction slide that keeps momentum with W released', () => {
  const { s, input } = runner();
  input.forward = 0;
  input.slide = true;
  const ev = run(s, input, 0.5);
  assert.ok(ev & Ev.SlideStart);
  assert.ok(s.sliding);
  // Plain ground friction would have stopped us dead in 0.5s; sliding keeps most of it (plus the entry boost).
  assert.ok(hlen(s.vel) > MOVE.maxGroundSpeed * 0.9, `speed=${hlen(s.vel).toFixed(2)}`);

  const { s: walker, input: wi } = runner();
  wi.forward = 0;
  run(walker, wi, 0.5);
  assert.ok(hlen(walker.vel) < 0.5, `non-sliding comparison should stop: ${hlen(walker.vel).toFixed(2)}`);
});

test('no slide when too slow', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const ev = run(s, { ...emptyInput(), slide: true }, 0.5);
  assert.ok(!(ev & Ev.SlideStart));
  assert.ok(!s.sliding);
});

test('slide ends below the end speed, and holding Shift does not re-trigger it', () => {
  const { s, input } = runner();
  input.slide = true;
  let starts = 0;
  run(s, input, 5, () => {
    if (s.events & Ev.SlideStart) starts++;
  });
  assert.ok(!s.sliding, 'slide should have ended');
  assert.equal(starts, 1, 'holding Shift + W must not chain new slides');
  // Releasing Shift re-arms it.
  input.slide = false;
  run(s, input, 0.1);
  input.slide = true;
  assert.ok(run(s, input, 0.05) & Ev.SlideStart);
});

test('releasing Shift ends the slide', () => {
  const { s, input } = runner();
  input.slide = true;
  run(s, input, 0.2);
  input.slide = false;
  const ev = run(s, input, TICK_DT);
  assert.ok(ev & Ev.SlideEnd);
  assert.ok(!s.sliding);
});

test('slide-jump keeps every bit of speed (no friction on the jump tick)', () => {
  const { s, input } = runner();
  input.forward = 0;
  input.slide = true;
  run(s, input, 0.3);
  const before = hlen(s.vel);
  input.jump = input.jumpPressed = true;
  const ev = run(s, input, TICK_DT);
  assert.ok(ev & Ev.Jump);
  assert.ok(!s.sliding);
  assert.ok(Math.abs(hlen(s.vel) - before) < 1e-9, `${before} -> ${hlen(s.vel)}`);
});

test('holding Shift in the air slides on landing and keeps the horizontal speed', () => {
  const s = createPlayerState({ x: 0, y: 1.5, z: 0 });
  s.vel = { x: 0, y: 0, z: -12 };
  s.slideBoostCooldown = 99; // isolate preservation from the boost
  const input: MoveInput = { ...emptyInput(), slide: true };
  let landedAt = -1;
  let i = 0;
  run(s, input, 1, () => {
    i++;
    if (s.onGround && landedAt < 0) landedAt = i;
  });
  assert.ok(landedAt > 0);
  // Re-run precisely: measure across the landing.
  const t = createPlayerState({ x: 0, y: 1.5, z: 0 });
  t.vel = { x: 0, y: 0, z: -12 };
  t.slideBoostCooldown = 99;
  while (!t.onGround) stepPlayer(t, input, TICK_DT, [floor]);
  const atLanding = hlen(t.vel);
  assert.ok(Math.abs(atLanding - 12) < 1e-9, 'air keeps speed until touchdown');
  stepPlayer(t, input, TICK_DT, [floor]);
  assert.ok(t.sliding, 'should be sliding the tick after landing');
  // One tick of slide friction only: ~0.5% loss, versus ~4% for plain ground friction.
  assert.ok(hlen(t.vel) > atLanding * (1 - (MOVE.slideFriction * 1.01) / 128), `${atLanding} -> ${hlen(t.vel)}`);
});

test('tapping Shift while running cannot farm speed past run speed + one boost', () => {
  const { s, input } = runner();
  let peak = 0;
  let tick = 0;
  run(s, input, 3, () => {
    input.slide = tick++ % 12 < 6; // ~10 taps per second
    peak = Math.max(peak, hlen(s.vel));
  });
  assert.ok(peak < MOVE.maxGroundSpeed + MOVE.slideBoost + 0.1, `peak ${peak.toFixed(2)}`);
});

test('bhopping with Shift held (slide-land every hop) does not farm boosts', () => {
  const { s, input } = runner();
  input.forward = 0;
  input.jump = true;
  input.slide = true;
  let peak = 0;
  run(s, input, 6, () => (peak = Math.max(peak, hlen(s.vel))));
  assert.ok(peak <= MOVE.maxGroundSpeed + MOVE.slideBoost + 1e-6, `peak ${peak.toFixed(2)}`);
});

test('the entry boost adds nothing when already faster than run speed + boost', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  s.vel = { x: 0, y: 0, z: -14 };
  s.onGround = true;
  stepPlayer(s, { ...emptyInput(), slide: true }, TICK_DT, [floor]);
  assert.ok(s.sliding);
  assert.ok(hlen(s.vel) <= 14, `speed ${hlen(s.vel)}`);
});

test('sliding downhill speeds you up; uphill slows you faster than flat', () => {
  // A slope descending toward +Z: its normal leans toward +Z.
  const th = 0.35; // ~20 degrees
  const down: Vec3 = { x: 0, y: Math.cos(th), z: Math.sin(th) };
  const flat: Vec3 = { x: 0, y: 1, z: 0 };
  const slide = (dir: number, normal: Vec3) => {
    const s = createPlayerState({ x: 0, y: 0, z: 0 });
    s.vel = { x: 0, y: 0, z: 8 * dir };
    s.onGround = true;
    s.slideBoostCooldown = 99;
    const input: MoveInput = { ...emptyInput(), slide: true };
    // Ground classification may reset the normal each tick (flat test floor), so pin it per tick.
    run(s, input, 0.8, () => (s.groundNormal = { ...normal }));
    return hlen(s.vel) * Math.sign(s.vel.z || 1) * dir;
  };
  const downhill = slide(1, down);
  const level = slide(1, flat);
  const uphill = slide(-1, down);
  assert.ok(downhill > 8, `downhill should gain: ${downhill.toFixed(2)}`);
  assert.ok(level < 8 && level > 4, `flat slows gently: ${level.toFixed(2)}`);
  assert.ok(uphill < level, `uphill slows more: ${uphill.toFixed(2)} vs ${level.toFixed(2)}`);
});
