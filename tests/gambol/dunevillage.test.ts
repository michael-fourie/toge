import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALKABLE_NORMAL_Y, rampNormal } from '../../src/gambol/shared/collision.ts';
import { TICK_DT } from '../../src/gambol/shared/constants.ts';
import { DUNE_VILLAGE as M } from '../../src/gambol/shared/dunevillage.ts';
import { BATTLE_MAPS, BATTLE_MAP_IDS, isBattleMap, mapFor } from '../../src/gambol/shared/maps.ts';
import { RECENT_SPAWNS, SAFE_DISTANCE, pickSpawn } from '../../src/gambol/shared/spawn.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../../src/gambol/shared/movement.ts';

function play(s: PlayerState, input: MoveInput, seconds: number, onTick?: (i: number) => boolean | void) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.(i) === false) break;
    stepPlayer(s, input, TICK_DT, M.boxes, M.triggers);
    input.jumpPressed = false;
  }
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// yaw 0 looks -Z, π/2 looks -X, -π/2 looks +X, π looks +Z.
const walk = (yaw: number): MoveInput => ({ ...emptyInput(), forward: 1, yaw });

test('Dune Village is listed as a Battle map', () => {
  assert.ok(BATTLE_MAP_IDS.includes('dunevillage') && isBattleMap('dunevillage'));
  assert.equal(BATTLE_MAPS.dunevillage.name, 'Dune Village');
  assert.equal(mapFor('battle', 'dunevillage'), M);
  assert.notEqual(mapFor('survival', 'dunevillage'), M);
});

test('Dune Village is point-symmetric, so both halves play the same', () => {
  const key = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; kind: string }) =>
    [b.kind, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(',');
  const flipped = M.boxes.map((b) => key({ kind: b.kind, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } }));
  assert.deepEqual([...flipped].sort(), M.boxes.map(key).sort());
});

test('ramps: the stairs, rubble and dune are walkable, the aqueduct is too steep to stand on', () => {
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
    assert.ok(Math.abs(sp.pos.x) < 49 && Math.abs(sp.pos.z) < 34, `spawn outside the town wall: ${JSON.stringify(sp.pos)}`);
  }
  const high = M.spawns.filter((s) => s.pos.y > 2).length;
  assert.ok(high >= 3 && high < M.spawns.length - 6, `${high} elevated spawns`);
});

test('spawn chooser works on Dune Village: keeps away from enemies and avoids repeats', () => {
  const enemy = { x: 0, y: 1.01, z: 0 }; // on the well
  for (let i = 0; i < 200; i++) assert.ok(dist(M.spawns[pickSpawn(M.spawns, [enemy], [], M.boxes)].pos, enemy) >= SAFE_DISTANCE);
  const recent: number[] = [];
  for (let i = 0; i < RECENT_SPAWNS; i++) {
    const pick = pickSpawn(M.spawns, [], recent, M.boxes);
    assert.ok(!recent.includes(pick));
    recent.push(pick);
  }
});

test('every jump pad lands its rider on solid ground at the height it aims for', () => {
  const pads = M.boxes.filter((b) => b.kind === 'pad');
  assert.equal(pads.length, 10);
  const heights: number[] = [];
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
    // A rider must come to rest there, not land on another pad and get thrown again.
    const landY = s.pos.y;
    play(s, emptyInput(), 1.5);
    assert.ok(s.onGround && Math.abs(s.pos.y - landY) < 0.05, `pad at ${JSON.stringify(b.min)} doesn't leave its rider standing: ${JSON.stringify(s.pos)}`);
    heights.push(Math.round(s.pos.y));
  }
  // Ground -> gatehouse towers (10), towers -> house roofs (12 and 8), ground -> Cistern Tower (13); twice over.
  assert.deepEqual(heights.sort((a, b) => a - b), [8, 8, 10, 10, 10, 10, 12, 12, 13, 13], `landing heights ${heights}`);
});

test('the wall stairs, the rubble slope and the dune all lead up', () => {
  const stairs = createPlayerState({ x: -35, y: 0.01, z: 30.25 });
  play(stairs, walk(Math.PI / 2), 5, () => stairs.pos.x > -46.6);
  assert.ok(stairs.pos.y > 6.9, `stairs only reached y=${stairs.pos.y.toFixed(2)}`);
  // ...and on along the walkway, over to the gatehouse.
  play(stairs, walk(Math.PI), 2, () => stairs.pos.z < 32.6);
  play(stairs, walk(-Math.PI / 2), 6, () => stairs.pos.x < -24);
  assert.ok(stairs.pos.y > 6.9 && stairs.pos.z > 31.5, `fell off the walkway at ${JSON.stringify(stairs.pos)}`);

  const rubble = createPlayerState({ x: -21.5, y: 0.01, z: 25 });
  play(rubble, walk(Math.PI), 3, () => rubble.pos.z < 32);
  assert.ok(rubble.pos.y > 2.9, `the breach rubble only reached y=${rubble.pos.y.toFixed(2)}`);

  const dune = createPlayerState({ x: 43.5, y: 0.01, z: 11 });
  play(dune, walk(Math.PI), 6, () => dune.pos.z < 32.2);
  assert.ok(dune.pos.y > 6.9, `the dune only reached y=${dune.pos.y.toFixed(2)}`);
});

test('the Dune run: walk off the walkway, down the sand, through both gates and over into the far half', () => {
  const s = createPlayerState({ x: 43.5, y: 7.01, z: 32.5 });
  let top = 0;
  play(s, walk(0), 5, () => {
    top = Math.max(top, Math.hypot(s.vel.x, s.vel.z));
    return s.pos.z > 0;
  });
  assert.ok(top >= 18, `the gates only got us to ${top.toFixed(1)} m/s`);
  assert.ok(s.pos.z <= 0 && Math.abs(s.pos.x) < 49, `run ended at ${JSON.stringify(s.pos)}`);
});

test('Aqueduct surf: pad up the Cistern Tower, run off through the gate, ride the A-frame to its far end', () => {
  const s = createPlayerState({ x: -28, y: 0.21, z: 3 });
  let onTower = false;
  play(s, emptyInput(), 3, () => {
    if (s.onGround && s.pos.y > 12.9) onTower = true;
    return !onTower;
  });
  assert.ok(onTower, `never reached the tower: ${JSON.stringify(s.pos)}`);
  let maxX = s.pos.x;
  let surfed = 0;
  const input = walk(-Math.PI / 2);
  play(s, input, 6, () => {
    input.forward = s.pos.x < -22 ? 1 : 0;
    input.right = s.pos.x < -22 ? 0 : Math.max(-1, Math.min(1, (8 - s.pos.z) * 2)); // once off the tower, hold into the ramp (looking +X, right is +Z)
    maxX = Math.max(maxX, s.pos.x);
    if (s.pos.x > -22 && s.pos.y > 4 && !s.onGround) surfed++;
    return s.pos.y > M.killY && s.pos.x < 16;
  });
  assert.ok(maxX >= 14, `only got to x=${maxX.toFixed(1)}`);
  assert.ok(surfed * TICK_DT > 1, `rode the aqueduct for only ${(surfed * TICK_DT).toFixed(2)} s`);
});

test('houses: every ground-floor door lets you in', () => {
  const doors: [number, number, number, number, (s: PlayerState) => boolean][] = [
    [-37, 23.85, -Math.PI / 2, 2, (s) => s.pos.x > -32], // tall house, west door
    [-29, 11, Math.PI, 2, (s) => s.pos.z > 16], // tall house, south door
    [15, 24.35, -Math.PI / 2, 2, (s) => s.pos.x > 20], // small house, west door
    [23, 12, Math.PI, 2, (s) => s.pos.z > 17], // small house, south door
  ];
  for (const [x, z, yaw, t, inside] of doors) {
    const s = createPlayerState({ x, y: 0.01, z });
    play(s, walk(yaw), t, () => !inside(s));
    assert.ok(inside(s), `stuck outside the door near ${x},${z}: ${JSON.stringify(s.pos)}`);
  }
});

test('the town is sealed: running at the wall from anywhere keeps you inside', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
    const s = createPlayerState({ x: 0, y: 0.01, z: -16 });
    play(s, walk(yaw), 8);
    assert.ok(Math.abs(s.pos.x) < 49.5 && Math.abs(s.pos.z) < 34.5 && s.pos.y > M.killY, `escaped to ${JSON.stringify(s.pos)}`);
  }
});
