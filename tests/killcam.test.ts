import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESPAWN_SECONDS } from '../src/shared/constants.ts';
import { KILLCAM, Trail, type TrailPose, replayTime, replaying } from '../src/client/killcam.ts';

const pose = (x: number, yaw = 0): TrailPose => ({ x, y: 0, z: 0, yaw, pitch: 0, side: 0, sliding: false });

test('a trail interpolates between samples and clamps at the ends', () => {
  const t = new Trail();
  t.push(0, pose(0));
  t.push(1, pose(10));
  assert.equal(t.at(0.5)?.x, 5);
  assert.equal(t.at(5)?.x, 10, 'after the last sample: holds the latest');
  assert.equal(t.at(-0.1)?.x, 0, 'a hair before the first: holds the first');
  assert.equal(t.at(-5), null, 'long before anything was recorded');
  assert.equal(new Trail().at(0), null);
});

test('yaw interpolates the short way round', () => {
  const t = new Trail();
  t.push(0, pose(0, Math.PI - 0.1));
  t.push(1, pose(0, -Math.PI + 0.1));
  const mid = t.at(0.5)!.yaw;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.01, `mid yaw ${mid}`);
});

test('samples are rate-limited and old ones are dropped', () => {
  const t = new Trail();
  for (let i = 0; i < 1000; i++) t.push(i / 1000, pose(i));
  assert.ok(t.length <= 40, `${t.length} samples in one second at ${1 / KILLCAM.recordInterval} Hz`);
  for (let s = 1; s < 10; s += 0.1) t.push(s, pose(s));
  assert.equal(t.at(0.5), null, 'anything older than keep is gone');
  assert.ok(t.at(9)?.x);
});

test('the replay maps real time onto the last seconds before the death and fits inside the respawn delay', () => {
  assert.ok(KILLCAM.real < RESPAWN_SECONDS, 'killcam must end before you respawn');
  assert.ok(Math.abs(replayTime(0, 100) - (100 - KILLCAM.window)) < 1e-9);
  assert.ok(Math.abs(replayTime(KILLCAM.real, 100) - (100 + KILLCAM.tail)) < 1e-9);
  assert.ok(replayTime(0.5, 100) < replayTime(1.5, 100));
  assert.equal(replaying(KILLCAM.real - 0.01), true);
  assert.equal(replaying(KILLCAM.real), false);
});
