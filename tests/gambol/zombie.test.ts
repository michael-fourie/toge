import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box } from '../../src/gambol/shared/collision.ts';
import { ZOMBIE } from '../../src/gambol/shared/constants.ts';
import type { Vec3 } from '../../src/shared/math.ts';
import { type Zombie, type ZombieTarget, createZombie, stepHorde, zombieStats } from '../../src/gambol/shared/zombie.ts';

const DT = 1 / 60;
const floor = (x0: number, z0: number, x1: number, z1: number, top = 0): Box => ({
  min: { x: x0, y: top - 1, z: z0 },
  max: { x: x1, y: top, z: z1 },
  kind: 'floor',
});

/** Runs the horde for up to `seconds`; returns how many swipes hit and when the first did. */
function run(zs: Zombie[], targets: ZombieTarget[], boxes: readonly Box[], seconds: number) {
  let hits = 0;
  let firstHit = -1;
  for (let i = 0; i < seconds / DT; i++) {
    const claws = stepHorde(zs, targets, DT, boxes);
    if (claws.length && firstHit < 0) firstHit = i * DT;
    hits += claws.length;
  }
  return { hits, firstHit };
}

const target = (pos: Vec3): ZombieTarget[] => [{ id: 7, pos }];

test('zombies get faster and stronger every round, up to the caps', () => {
  const r1 = zombieStats(1);
  const r5 = zombieStats(5);
  assert.equal(r1.hp, ZOMBIE.hpBase);
  assert.ok(r5.hp > r1.hp && r5.speed > r1.speed && r5.damage > r1.damage);
  assert.equal(zombieStats(200).speed, ZOMBIE.speedMax);
  assert.equal(zombieStats(200).damage, ZOMBIE.damageMax);
});

test('shambles straight at you and claws you, after a telegraphed windup', () => {
  const boxes = [floor(-30, -30, 30, 30)];
  const z = createZombie(1, { x: 0, y: 0.01, z: 0 }, 1);
  const { hits, firstHit } = run([z], target({ x: 0, y: 0, z: -12 }), boxes, 6);
  assert.ok(hits >= 1, 'never landed a swipe');
  // 12m at round-1 speed, minus reach, plus the windup.
  const walk = (12 - ZOMBIE.clawRange) / zombieStats(1).speed;
  assert.ok(firstHit >= walk + ZOMBIE.clawWindup - 0.3, `hit too early: ${firstHit.toFixed(2)}s`);
  assert.ok(z.onGround && Math.abs(z.pos.y) < 0.05);
});

test('stops at the edge rather than walking into the void when you are out of pounce range', () => {
  const boxes = [floor(-10, -10, 10, 10), floor(-10, -60, 10, -40)];
  const z = createZombie(1, { x: 0, y: 0.01, z: 0 }, 1);
  run([z], target({ x: 0, y: 0, z: -50 }), boxes, 8);
  assert.ok(z.onGround && z.pos.y > -0.1, `fell: ${JSON.stringify(z.pos)}`);
  assert.ok(z.pos.z < -8, `should wait at the near edge, is at z ${z.pos.z.toFixed(2)}`);
});

test('pounces across a gap onto your island', () => {
  const boxes = [floor(-10, -10, 10, 10), floor(-10, -40, 10, -18)];
  const z = createZombie(1, { x: 0, y: 0.01, z: 0 }, 1);
  run([z], target({ x: 0, y: 0, z: -24 }), boxes, 10);
  assert.ok(z.onGround && z.pos.z < -18 && z.pos.y > -0.1, `didn't make it: ${JSON.stringify(z.pos)}`);
});

test('leaps up onto a ledge you are standing on', () => {
  const boxes = [floor(-20, -20, 20, 20), floor(-4, -16, 4, -8, 6)];
  const z = createZombie(1, { x: 0, y: 0.01, z: 4 }, 1);
  const { hits } = run([z], target({ x: 0, y: 6, z: -12 }), boxes, 10);
  assert.ok(z.pos.y > 5.9, `still below: ${JSON.stringify(z.pos)}`);
  assert.ok(hits >= 1);
});

test('hops over a low root in the way', () => {
  const root: Box = { min: { x: -5, y: 0, z: -6 }, max: { x: 5, y: 1.1, z: -5 }, kind: 'trunk' };
  const boxes = [floor(-20, -20, 20, 20), root];
  const z = createZombie(1, { x: 0, y: 0.01, z: 0 }, 1);
  const { hits } = run([z], target({ x: 0, y: 0, z: -12 }), boxes, 10);
  assert.ok(z.pos.z < -6 && hits >= 1, `stuck at ${JSON.stringify(z.pos)}`);
});

test('a crowd spreads out instead of stacking into one body', () => {
  const boxes = [floor(-20, -20, 20, 20)];
  const zs = [0, 1, 2, 3].map((i) => createZombie(i, { x: 0, y: 0.01, z: 0 }, 1));
  run(zs, [], boxes, 2);
  for (const a of zs) for (const b of zs) if (a !== b) assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 0.5);
});

