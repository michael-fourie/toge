import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box, Trigger } from '../src/shared/collision.ts';
import { MOVE, TICK_DT } from '../src/shared/constants.ts';
import { hlen } from '../src/shared/math.ts';
import { Ev, type MoveInput, createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';

const floor: Box = { min: { x: -500, y: -1, z: -500 }, max: { x: 500, y: 0, z: 500 }, kind: 'floor' };

function run(
  s: ReturnType<typeof createPlayerState>,
  input: MoveInput,
  seconds: number,
  boxes: Box[],
  onTick?: (i: number) => void,
  triggers: Trigger[] = [],
) {
  const ticks = Math.round(seconds / TICK_DT);
  let events = 0;
  for (let i = 0; i < ticks; i++) {
    onTick?.(i);
    stepPlayer(s, input, TICK_DT, boxes, triggers);
    events |= s.events;
    input.jumpPressed = false;
  }
  return events;
}

test('standing still on a floor stays put', () => {
  const s = createPlayerState({ x: 0, y: 0.5, z: 0 });
  run(s, emptyInput(), 2, [floor]);
  assert.ok(s.onGround);
  assert.ok(Math.abs(s.pos.y) < 0.01, `y=${s.pos.y}`);
  assert.equal(hlen(s.vel), 0);
});

test('running forward reaches max ground speed, not more', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  run(s, { ...emptyInput(), forward: 1 }, 2, [floor]);
  assert.ok(Math.abs(hlen(s.vel) - MOVE.maxGroundSpeed) < 0.1, `speed=${hlen(s.vel)}`);
  assert.ok(s.pos.z < -10, 'yaw 0 should move toward -Z');
});

test('bhopping with air-strafing builds speed beyond ground max', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  run(s, input, 1, [floor]); // get up to run speed
  // Classic strafe: hold jump + one strafe key, turn the mouse the same way. Alternate each hop.
  input.forward = 0;
  input.jump = true;
  let dir = 1;
  let wasGround = true;
  run(s, input, 6, [floor], () => {
    if (s.onGround && !wasGround) dir = -dir;
    wasGround = s.onGround;
    input.right = dir;
    input.yaw -= dir * 2.4 * TICK_DT; // ~140°/s turn, toward the strafe side
  });
  console.log(`  bhop speed after 6s strafing: ${hlen(s.vel).toFixed(1)} m/s`);
  assert.ok(hlen(s.vel) > MOVE.maxGroundSpeed * 1.5, `speed after strafing=${hlen(s.vel).toFixed(2)}`);
});

test('holding jump with no strafing does not gain speed (friction skipped, but no free accel)', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input: MoveInput = { ...emptyInput(), forward: 1, jump: true };
  run(s, input, 5, [floor]);
  assert.ok(hlen(s.vel) <= MOVE.maxGroundSpeed + 0.85, `speed=${hlen(s.vel)}`);
});

test('jumping alongside a wall starts a wallrun that slows the fall, and wall-jump pushes off', () => {
  // Wall along Z whose east face is at x = -1.
  const wall: Box = { min: { x: -2, y: -1, z: -100 }, max: { x: -1, y: 20, z: 100 }, kind: 'wall' };
  // Airborne, drifting into the wall while moving fast along it (no floor, so nothing else interferes).
  const s2 = createPlayerState({ x: -0.6, y: 10, z: 0 });
  s2.vel = { x: -1, y: 4, z: -9 };
  const in2: MoveInput = { ...emptyInput(), forward: 1 };
  let runTicks = 0;
  let ev = run(s2, in2, 1.0, [wall], () => {
    if (s2.wallrunning) runTicks++;
  });
  assert.ok(ev & Ev.WallrunStart, 'wallrun should start');
  assert.ok(runTicks > 0.8 / TICK_DT, `wallrun lasted ${runTicks} ticks`);
  assert.ok(s2.pos.y > 10 - 1, `barely lost height while wallrunning: y=${s2.pos.y.toFixed(2)}`);

  const xBefore = s2.pos.x;
  in2.jumpPressed = true;
  ev = run(s2, in2, 0.3, [wall]);
  assert.ok(ev & Ev.WallJump, 'wall jump should fire');
  assert.ok(!s2.wallrunning);
  assert.ok(s2.pos.x > xBefore + 1, 'wall jump should push away from the wall');
});

test('jump pad launches', () => {
  const pad: Box = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 0.2, z: 1 }, kind: 'pad', launch: { x: 0, y: 15, z: -5 } };
  const s = createPlayerState({ x: 0, y: 0.5, z: 0 });
  const ev = run(s, emptyInput(), 0.4, [floor, pad]);
  assert.ok(ev & Ev.JumpPad);
  assert.ok(s.pos.y > 1, `should be airborne, y=${s.pos.y}`);
});

// --- Momentum (CS:GO bhop behaviour) ------------------------------------------------------

/** Run up to full speed on the floor, then start holding jump (autohop). */
function runUp() {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  run(s, input, 1.5, [floor]);
  input.jump = true;
  return { s, input };
}

test('letting go of W keeps you flying forward: autohop with no keys loses zero speed', () => {
  const { s, input } = runUp();
  run(s, input, 0.2, [floor]); // first hop is in the air
  const v0 = hlen(s.vel);
  const z0 = s.pos.z;
  input.forward = 0; // release W, keep holding jump
  let hops = 0;
  run(s, input, 5, [floor], () => {
    if (s.events & Ev.Jump) hops++;
  });
  assert.ok(hops >= 5, `hops=${hops}`);
  assert.ok(Math.abs(hlen(s.vel) - v0) < 1e-6, `speed ${v0.toFixed(3)} -> ${hlen(s.vel).toFixed(3)}`);
  assert.ok(z0 - s.pos.z > v0 * 4.9, 'still travelling forward');
});

test('speed built by strafing is kept when you stop strafing and just hold jump', () => {
  const { s, input } = runUp();
  input.forward = 0;
  let dir = 1;
  let wasGround = false;
  run(s, input, 5, [floor], () => {
    if (s.onGround && !wasGround) dir = -dir;
    wasGround = s.onGround;
    input.right = dir;
    input.yaw -= dir * 2.4 * TICK_DT;
  });
  input.right = 0;
  const v0 = hlen(s.vel);
  assert.ok(v0 > MOVE.maxGroundSpeed * 1.5, `got up to ${v0.toFixed(1)}`);
  run(s, input, 3, [floor]);
  assert.ok(Math.abs(hlen(s.vel) - v0) < 1e-6, `speed ${v0.toFixed(3)} -> ${hlen(s.vel).toFixed(3)}`);
});

test('a jump pressed slightly before landing is buffered and hops on the landing tick (no friction)', () => {
  MOVE.autoHop = false;
  try {
    const s = createPlayerState({ x: 0, y: 0, z: 0 });
    const input: MoveInput = { ...emptyInput(), forward: 1 };
    run(s, input, 1.5, [floor]);
    input.forward = 0;
    input.jumpPressed = true;
    run(s, input, 0.1, [floor]); // jump, now airborne
    const v0 = hlen(s.vel);
    // Press again ~50ms before touching down.
    while (!(s.vel.y < 0 && s.pos.y < 0.4)) run(s, input, TICK_DT, [floor]);
    input.jumpPressed = true;
    let landedAndHopped = false;
    run(s, input, 0.2, [floor], () => {
      if (s.events & Ev.Jump) landedAndHopped = true;
    });
    assert.ok(landedAndHopped, 'buffered press should hop');
    assert.ok(Math.abs(hlen(s.vel) - v0) < 1e-6, `speed ${v0.toFixed(3)} -> ${hlen(s.vel).toFixed(3)}`);
  } finally {
    MOVE.autoHop = true;
  }
});

test('mistimed hops cost speed, like CS (friction on every grounded tick)', () => {
  const { s, input } = runUp();
  input.forward = 0;
  input.jump = false;
  run(s, input, 0.2, [floor]);
  const v0 = hlen(s.vel);
  run(s, input, 1.2, [floor]); // land and stand there
  assert.ok(hlen(s.vel) < v0 * 0.2, `should bleed speed on the ground: ${hlen(s.vel).toFixed(2)}`);
});

test('pressing jump in the air never redirects or eats horizontal momentum', () => {
  const { s, input } = runUp();
  run(s, input, 0.2, [floor]);
  const before = { ...s.vel };
  input.forward = 0;
  input.right = 1; // holding D while spamming jump (scroll wheel) mid-air
  input.jumpPressed = true;
  stepPlayer(s, input, TICK_DT, [floor]);
  const cos = (before.x * s.vel.x + before.z * s.vel.z) / (hlen(before) * hlen(s.vel));
  assert.ok(cos > 0.99, `direction changed: cos=${cos.toFixed(3)}`);
  assert.ok(hlen(s.vel) >= hlen(before) - 1e-6);
});

// --- Boosters (wind gates + puffballs) -------------------------------------------------------

const gate: Trigger = { kind: 'boost', min: { x: -5, y: 0, z: -12 }, max: { x: 5, y: 4, z: -10 }, dir: { x: 0, y: 0, z: -1 }, speed: 16 };
const puffball: Trigger = { kind: 'bounce', min: { x: -1.5, y: 0, z: -11.5 }, max: { x: 1.5, y: 0.6, z: -8.5 }, up: 15 };

test('a wind gate raises speed along its direction', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  let boosted = 0;
  run(s, { ...emptyInput(), forward: 1 }, 3, [floor], () => {
    if (s.events & Ev.Boost) boosted = hlen(s.vel);
  }, [gate]);
  assert.ok(boosted >= 15.9, `speed leaving the gate: ${boosted.toFixed(2)}`);
});

test('a wind gate never slows you or eats sideways speed', () => {
  const s = createPlayerState({ x: 0, y: 0.5, z: -11 });
  s.vel = { x: 3, y: 0, z: -25 }; // already faster than the gate, and drifting sideways
  stepPlayer(s, emptyInput(), TICK_DT, [], [gate]);
  assert.ok(s.vel.z <= -25 + 1e-9 && Math.abs(s.vel.x - 3) < 1e-9, JSON.stringify(s.vel));
});

test('a puffball throws you up and keeps every bit of horizontal speed', () => {
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  let before = 0;
  let kept = -1;
  let peak = 0;
  run(s, { ...emptyInput(), forward: 1 }, 2.5, [floor], () => {
    if (kept < 0 && s.events & Ev.Bounce) kept = hlen(s.vel) - before;
    before = hlen(s.vel);
    peak = Math.max(peak, s.pos.y);
  }, [puffball]);
  assert.ok(kept >= -1e-6, `horizontal speed change on the bounce: ${kept}`);
  assert.ok(peak > 5, `peak ${peak.toFixed(2)}`);
});
