import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP } from '../../src/gambol/shared/map.ts';
import { RECENT_SPAWNS, SAFE_DISTANCE, pickSpawn } from '../../src/gambol/shared/spawn.ts';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('spawns are spread over the whole map, not clustered in two camp-able zones', () => {
  assert.ok(MAP.spawns.length >= 24, `${MAP.spawns.length} spawns`);
  for (const a of MAP.spawns) for (const b of MAP.spawns) if (a !== b) assert.ok(dist(a.pos, b.pos) >= 12, 'spawns too close together');
  const inRegion = (f: (p: { x: number; y: number; z: number }) => boolean) => MAP.spawns.filter((s) => f(s.pos)).length;
  assert.ok(inRegion((p) => p.z > 85) >= 2 && inRegion((p) => p.z < -85) >= 2, 'both harbours');
  assert.ok(inRegion((p) => Math.abs(p.x) < 24 && Math.abs(p.z) < 26 && Math.abs(p.y) < 0.1) >= 3, 'centre island');
  assert.ok(inRegion((p) => Math.abs(p.z) > 26 && Math.abs(p.z) < 85) >= 12, 'the lanes and side islands in between');
  assert.ok(inRegion((p) => p.y < 0) >= 3, 'low spots too');
});

test('the chooser keeps away from living players', () => {
  const enemy = { x: 17, y: 0.01, z: 9 }; // on the centre island
  for (let i = 0; i < 300; i++) {
    const s = MAP.spawns[pickSpawn(MAP.spawns, [enemy], [], MAP.boxes)];
    assert.ok(dist(s.pos, enemy) >= SAFE_DISTANCE, `spawned ${dist(s.pos, enemy).toFixed(1)} m from an enemy`);
  }
});

test('the chooser is unpredictable: many different spots over repeated respawns', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 400; i++) seen.add(pickSpawn(MAP.spawns, [{ x: 0, y: 0, z: 0 }], [], MAP.boxes));
  assert.ok(seen.size >= 15, `only ${seen.size} distinct spawns`);
});

test('a spot used a moment ago is not reused while fresh ones exist', () => {
  const recent: number[] = [];
  for (let i = 0; i < RECENT_SPAWNS; i++) {
    const pick = pickSpawn(MAP.spawns, [], recent, MAP.boxes);
    assert.ok(!recent.includes(pick), `reused spawn ${pick}`);
    recent.push(pick);
  }
});

test('with everyone nearby it still returns a valid spawn (the farthest one)', () => {
  const everywhere = MAP.spawns.map((s) => s.pos);
  const i = pickSpawn(MAP.spawns, everywhere, [], MAP.boxes);
  assert.ok(i >= 0 && i < MAP.spawns.length);
});

test('spawns that can see an enemy are avoided when hidden ones exist', () => {
  // An enemy crouched in the middle of the Windway undercliff roof-shadow can't see most of the map.
  const enemy = { x: 0, y: -4.99, z: 52 };
  const picks = new Set<number>();
  for (let i = 0; i < 300; i++) picks.add(pickSpawn(MAP.spawns, [enemy], [], MAP.boxes));
  assert.ok(picks.size > 1);
  for (const i of picks) assert.ok(dist(MAP.spawns[i].pos, enemy) >= SAFE_DISTANCE);
});
