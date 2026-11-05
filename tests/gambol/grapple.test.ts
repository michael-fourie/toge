import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box } from '../../src/gambol/shared/collision.ts';
import { MOVE, TICK_DT } from '../../src/gambol/shared/constants.ts';
import { hlen } from '../../src/shared/math.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, findGrapple, stepPlayer } from '../../src/gambol/shared/movement.ts';

const floor: Box = { min: { x: -500, y: -1, z: -500 }, max: { x: 500, y: 0, z: 500 }, kind: 'floor' };
/** A tall wall facing +Z at the given distance in front of the origin (the player looks down -Z at yaw 0). */
const wallAt = (dist: number): Box => ({ min: { x: -50, y: -1, z: -dist - 2 }, max: { x: 50, y: 60, z: -dist }, kind: 'wall' });

function tick(s: PlayerState, input: MoveInput, boxes: Box[], n = 1) {
  let ev = 0;
  for (let i = 0; i < n; i++) {
    stepPlayer(s, input, TICK_DT, boxes);
    ev |= s.events;
    input.grapplePressed = false;
    input.jumpPressed = false;
  }
  return ev;
}

const shoot = (): MoveInput => ({ ...emptyInput(), grapplePressed: true });

test('the rope catches a surface inside its range and reels you in until you arrive, then lets go', () => {
  const boxes = [floor, wallAt(30)];
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input = shoot();
  let ev = tick(s, input, boxes);
  assert.ok(ev & Ev.GrappleHit, 'hit');
  assert.ok(s.grapple);
  let peak = 0;
  let ended = false;
  for (let i = 0; i < 3 / TICK_DT && !ended; i++) {
    ev = tick(s, input, boxes);
    peak = Math.max(peak, hlen(s.vel));
    if (ev & Ev.GrappleEnd) ended = true;
  }
  assert.ok(ended, 'rope lets go on arrival');
  assert.equal(s.grapple, null);
  assert.ok(peak >= MOVE.grappleSpeed - 1, `reeled in to speed: peak ${peak.toFixed(1)}`);
  assert.ok(s.pos.z < -25, `got there: z=${s.pos.z.toFixed(1)}`);
});

test('the rope has a limited reach', () => {
  const near = createPlayerState({ x: 0, y: 0, z: 0 });
  assert.ok(tick(near, shoot(), [floor, wallAt(MOVE.grappleRange - 1)]) & Ev.GrappleHit, 'just inside range');
  const far = createPlayerState({ x: 0, y: 0, z: 0 });
  const ev = tick(far, shoot(), [floor, wallAt(MOVE.grappleRange + 2)]);
  assert.ok(ev & Ev.GrappleMiss, 'just outside range misses');
  assert.equal(far.grapple, null);
  const sky = createPlayerState({ x: 0, y: 0, z: 0 });
  const up: MoveInput = { ...shoot(), pitch: 1 };
  assert.ok(tick(sky, up, [floor]) & Ev.GrappleMiss, 'open sky: nothing to grab');
});

test('a rope toward where you are heading never slows you: total speed is never below an unroped run', () => {
  const boxes = [floor, wallAt(35)];
  const make = () => {
    const s = createPlayerState({ x: 0, y: 5, z: 0 });
    s.vel = { x: 12, y: 0, z: -4 }; // fast sideways, slowly forward
    return s;
  };
  const roped = make();
  const control = make();
  const input = shoot();
  const idle = emptyInput();
  for (let i = 0; i < 1.2 / TICK_DT; i++) {
    stepPlayer(roped, input, TICK_DT, boxes);
    stepPlayer(control, idle, TICK_DT, boxes);
    input.grapplePressed = false;
    const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
    // It bends your sideways speed toward the anchor (that's the steering), but the speed it adds more than covers that.
    assert.ok(speed(roped.vel) >= speed(control.vel) - 1e-9, `slower than control at tick ${i}`);
  }
});

test('while the rope is taut there is no ground friction, so a ground pull builds speed', () => {
  const boxes = [floor, wallAt(38)];
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input = shoot();
  tick(s, input, boxes);
  let peak = 0;
  for (let i = 0; i < 1.2 / TICK_DT; i++) {
    tick(s, input, boxes);
    peak = Math.max(peak, hlen(s.vel));
  }
  assert.ok(peak > 20, `peak ${peak.toFixed(1)}`);
});

test('jumping lets go of the rope and keeps all your speed, with no double jump spent', () => {
  const boxes = [floor, wallAt(35)];
  const s = createPlayerState({ x: 0, y: 20, z: 0 }); // airborne
  s.airTime = 1;
  const input = shoot();
  tick(s, input, boxes, 40);
  assert.ok(s.grapple);
  const before = { ...s.vel };
  const jump: MoveInput = { ...emptyInput(), jumpPressed: true, jump: true };
  const ev = tick(s, jump, boxes);
  assert.ok(ev & Ev.GrappleEnd);
  assert.ok(!(ev & Ev.AirJump), 'that press was the release');
  assert.equal(s.airJumps, MOVE.airJumps);
  assert.ok(hlen(s.vel) >= hlen(before) - 1.5, 'speed kept (only a tick of gravity)');
  assert.ok(s.grappleCooldown > 0);
});

test('after letting go you wait out the cooldown before the next shot; a whiff is cheaper', () => {
  const boxes = [floor, wallAt(20)];
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const input = shoot();
  tick(s, input, boxes);
  tick(s, { ...emptyInput(), grapplePressed: true }, boxes); // press again: release
  assert.equal(s.grapple, null);
  let ev = tick(s, shoot(), boxes);
  assert.ok(!(ev & (Ev.GrappleHit | Ev.GrappleMiss)), 'still cooling down');
  ev = tick(s, emptyInput(), boxes, Math.ceil((MOVE.grappleCooldown + 0.05) / TICK_DT));
  ev = tick(s, shoot(), boxes);
  assert.ok(ev & Ev.GrappleHit, 'ready again');
  const w = createPlayerState({ x: 0, y: 0, z: 0 });
  tick(w, { ...shoot(), pitch: 1 }, [floor]);
  assert.equal(w.grappleCooldown > 0 && w.grappleCooldown <= MOVE.grappleMissCooldown, true);
});

test('the rope lets go if something gets in the way', () => {
  const s = createPlayerState({ x: 0, y: 20, z: 0 });
  const boxes = [floor, wallAt(35)];
  const input = shoot();
  tick(s, input, boxes, 10);
  assert.ok(s.grapple);
  const blocker: Box = { min: { x: -50, y: -1, z: s.pos.z - 8 }, max: { x: 50, y: 60, z: s.pos.z - 6 }, kind: 'wall' };
  const ev = tick(s, input, [...boxes, blocker]);
  assert.ok(ev & Ev.GrappleEnd, 'rope cut by the wall in between');
});

test('the rope can hook a player in front of a wall and follows them as they move', () => {
  const boxes = [floor, wallAt(38)];
  const s = createPlayerState({ x: 0, y: 0, z: 0 });
  const target = { id: 7, pos: { x: 0, y: 1.6 - 0.62, z: -20 } }; // chest height at eye level of a look straight ahead
  const input: MoveInput = { ...shoot(), grappleTargets: [target] };
  tick(s, input, boxes);
  assert.equal(s.grappleTarget, 7, 'hooked the player, not the wall behind them');
  // They run sideways; the anchor tracks them.
  for (let i = 0; i < 30; i++) {
    target.pos.x += 0.05;
    tick(s, input, boxes);
  }
  assert.ok(s.grapple && Math.abs(s.grapple.x - target.pos.x) < 1e-9, 'anchor follows the target');
  assert.ok(s.vel.x > 0, 'pulled toward where they went');
  // They vanish (die / leave): the rope lets go.
  input.grappleTargets = [];
  const ev = tick(s, input, boxes);
  assert.ok(ev & Ev.GrappleEnd);
  assert.equal(s.grappleTarget, null);
});

test('hooks in the sky catch the rope from a cone around your aim, not from anywhere', () => {
  const hook: Box = { min: { x: -0.45, y: 19.55, z: -30.45 }, max: { x: 0.45, y: 20.45, z: -29.55 }, kind: 'hook' };
  const eye = { x: 0, y: 1.62, z: 0 };
  const toward = (dx: number, dy: number) => {
    const l = Math.hypot(dx, dy, 30);
    return { x: dx / l, y: dy / l, z: -30 / l };
  };
  const aimed = toward(0, 18.4);
  assert.ok(findGrapple(eye, aimed, [floor, hook]), 'dead on');
  // ~5 degrees off is still caught; ~25 degrees off is not.
  const near = { x: Math.sin(0.09), y: aimed.y, z: aimed.z };
  const nl = Math.hypot(near.x, near.y, near.z);
  assert.ok(findGrapple(eye, { x: near.x / nl, y: near.y / nl, z: near.z / nl }, [floor, hook]), 'close to the aim');
  assert.equal(findGrapple(eye, { x: Math.sin(0.45), y: 0.2, z: -0.9 }, [floor, hook]), null, 'far from the aim: open sky, nothing caught');
  // Out of rope range.
  const far: Box = { min: { x: -0.45, y: 19.55, z: -60.45 }, max: { x: 0.45, y: 20.45, z: -59.55 }, kind: 'hook' };
  assert.equal(findGrapple(eye, toward(0, 18.4), [floor, far]), null);
  // Blocked by a wall in between.
  const blocked = findGrapple(eye, aimed, [floor, hook, { min: { x: -50, y: -1, z: -20 }, max: { x: 50, y: 60, z: -19 }, kind: 'wall' }]);
  assert.ok(blocked && blocked.point.z >= -20, 'a wall in between catches the rope instead of the hook behind it');
});
