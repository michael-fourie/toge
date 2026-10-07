import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALKABLE_NORMAL_Y, rampNormal } from '../src/shared/collision.ts';
import { TICK_DT } from '../src/shared/constants.ts';
import { BATTLE_MAPS, BATTLE_MAP_IDS, isBattleMap, mapFor, randomBattleMap } from '../src/shared/maps.ts';
import { RUSTWORKS as M } from '../src/shared/rustworks.ts';
import { RECENT_SPAWNS, SAFE_DISTANCE, pickSpawn } from '../src/shared/spawn.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';

function play(s: PlayerState, input: MoveInput, seconds: number, onTick?: (i: number) => boolean | void) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.(i) === false) break;
    stepPlayer(s, input, TICK_DT, M.boxes, M.triggers);
    input.jumpPressed = false;
  }
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('map choice: Battle takes any listed arena, Random picks a real one, Survival ignores it', () => {
  for (const id of ['windward', 'rustworks'] as const) assert.ok(BATTLE_MAP_IDS.includes(id), id); // other arenas have their own test files
  assert.ok(isBattleMap('rustworks') && !isBattleMap('nope') && !isBattleMap(undefined));
  assert.equal(mapFor('battle', 'rustworks'), BATTLE_MAPS.rustworks.data);
  assert.equal(mapFor('battle'), BATTLE_MAPS.windward.data);
  assert.notEqual(mapFor('survival', 'rustworks'), BATTLE_MAPS.rustworks.data);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const m = randomBattleMap();
    assert.ok(isBattleMap(m));
    seen.add(m);
  }
  assert.equal(seen.size, BATTLE_MAP_IDS.length, 'random should reach every arena');
  assert.equal(randomBattleMap(() => 0), BATTLE_MAP_IDS[0]);
  assert.equal(randomBattleMap(() => 0.999), BATTLE_MAP_IDS[BATTLE_MAP_IDS.length - 1]);
});

test('Rustworks is point-symmetric, so both halves play the same', () => {
  const key = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; kind: string }) =>
    [b.kind, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(',');
  const flipped = M.boxes.map((b) => key({ kind: b.kind, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } }));
  assert.deepEqual([...flipped].sort(), M.boxes.map(key).sort());
});

test('ramps: slide ramps are walkable, surf ramps are too steep to stand on', () => {
  const ramps = M.boxes.filter((b) => b.ramp);
  assert.ok(ramps.some((b) => b.kind === 'ramp') && ramps.some((b) => b.kind === 'surf'));
  for (const b of ramps) {
    const ny = rampNormal(b).y;
    assert.ok(b.kind === 'surf' ? ny < WALKABLE_NORMAL_Y : ny >= WALKABLE_NORMAL_Y, `${b.kind} ramp at ${JSON.stringify(b.min)} has normal.y ${ny.toFixed(2)}`);
  }
});

test('spawns: plenty, spread out, each one clear and standing on solid ground', () => {
  assert.ok(M.spawns.length >= 20, `${M.spawns.length} spawns`);
  for (const a of M.spawns) for (const b of M.spawns) if (a !== b) assert.ok(dist(a.pos, b.pos) >= 6, 'spawns too close together');
  for (const sp of M.spawns) {
    const s = createPlayerState(sp.pos);
    play(s, emptyInput(), 1);
    assert.ok(s.onGround && Math.abs(s.pos.y - sp.pos.y) < 0.05, `spawn ${JSON.stringify(sp.pos)} -> ${JSON.stringify(s.pos)}`);
  }
  const high = M.spawns.filter((s) => s.pos.y > 2).length;
  assert.ok(high >= 3 && high < M.spawns.length - 6, `${high} elevated spawns`);
});

test('spawn chooser works on Rustworks: keeps away from enemies and avoids repeats', () => {
  const enemy = { x: 0, y: 7.01, z: 0 }; // on the furnace roof
  for (let i = 0; i < 200; i++) assert.ok(dist(M.spawns[pickSpawn(M.spawns, [enemy], [], M.boxes)].pos, enemy) >= SAFE_DISTANCE);
  const recent: number[] = [];
  for (let i = 0; i < RECENT_SPAWNS; i++) {
    const pick = pickSpawn(M.spawns, [], recent, M.boxes);
    assert.ok(!recent.includes(pick));
    recent.push(pick);
  }
});

test('every jump pad lands its rider on solid ground, and the furnace and tower pads reach their roofs', () => {
  const pads = M.boxes.filter((b) => b.kind === 'pad');
  assert.equal(pads.length, 6);
  const roofs: { x: number; z: number; y: number }[] = [];
  for (const b of pads) {
    const s = createPlayerState({ x: (b.min.x + b.max.x) / 2, y: b.max.y + 0.01, z: (b.min.z + b.max.z) / 2 });
    let launched = false;
    let landed = false;
    play(s, emptyInput(), 6, () => {
      if (s.events & Ev.JumpPad) launched = true;
      else if (launched && s.events & Ev.Land) landed = true;
      return !landed && s.pos.y > M.killY;
    });
    assert.ok(launched && landed, `pad at ${JSON.stringify(b.min)} -> ${JSON.stringify(s.pos)}`);
    roofs.push({ x: s.pos.x, z: s.pos.z, y: s.pos.y });
  }
  const heights = roofs.map((r) => Math.round(r.y)).sort((a, b) => a - b);
  assert.deepEqual(heights, [7, 7, 11, 11, 12, 12], `landing heights ${heights}`);
});

test('the press ramp and the long catwalk ramp can be walked up', () => {
  const press = createPlayerState({ x: 9, y: 0.01, z: 21 });
  play(press, { ...emptyInput(), forward: 1, yaw: Math.PI / 2 }, 6, () => press.pos.x > -5.5); // yaw π/2 looks -X
  assert.ok(press.pos.y > 4.9, `press ramp only reached y=${press.pos.y.toFixed(2)}`);
  const walk = createPlayerState({ x: 47, y: 0.01, z: 12.2 });
  play(walk, { ...emptyInput(), forward: 1, yaw: Math.PI / 2 }, 8, () => walk.pos.x > 33.5);
  assert.ok(walk.pos.y > 5.9, `catwalk ramp only reached y=${walk.pos.y.toFixed(2)}`);
});

test('Duct Surf: pad up to the gantry, run off its edge, ride the A-frame out the far end', () => {
  const s = createPlayerState({ x: -19, y: 0.31, z: 28.5 });
  let onGantry = false;
  play(s, emptyInput(), 3, () => {
    if (s.onGround && s.pos.y > 10.9) onGantry = true;
    return !onGantry;
  });
  assert.ok(onGantry, `never reached the gantry: ${JSON.stringify(s.pos)}`);
  let minZ = s.pos.z;
  play(s, { ...emptyInput(), forward: 1 }, 6, () => {
    minZ = Math.min(minZ, s.pos.z);
    return s.pos.y > M.killY && s.pos.z > 0;
  });
  assert.ok(minZ < 6, `only got to z=${minZ.toFixed(1)}`);
  assert.ok(s.pos.y > M.killY, 'fell out of the world');
});

test('Control Tower: both ground-floor doors let you in', () => {
  const west = createPlayerState({ x: 21, y: 0.01, z: 28.85 });
  play(west, { ...emptyInput(), forward: 1, yaw: -Math.PI / 2 }, 2, () => west.pos.x < 26); // yaw -π/2 looks +X
  assert.ok(west.pos.x >= 26, `stuck outside the west door at x=${west.pos.x.toFixed(2)}`);
  const south = createPlayerState({ x: 28, y: 0.01, z: 18 });
  play(south, { ...emptyInput(), forward: 1, yaw: Math.PI }, 2, () => south.pos.z < 23); // yaw π looks +Z
  assert.ok(south.pos.z >= 23, `stuck outside the south door at z=${south.pos.z.toFixed(2)}`);
});

test('the hall is sealed: nothing leads off the floor except by jumping up', () => {
  const s = createPlayerState({ x: 0, y: 0.01, z: 20 });
  play(s, { ...emptyInput(), forward: 1, yaw: 0 }, 6); // run -Z toward the far wall... and the middle
  assert.ok(Math.abs(s.pos.x) < 49 && Math.abs(s.pos.z) < 35 && s.pos.y > M.killY);
});
