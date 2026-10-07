import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALKABLE_NORMAL_Y, rampNormal } from '../src/shared/collision.ts';
import { TICK_DT } from '../src/shared/constants.ts';
import { BATTLE_MAPS, BATTLE_MAP_IDS, isBattleMap, mapFor } from '../src/shared/maps.ts';
import { SUMMIT as M } from '../src/shared/summit.ts';
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
// yaw 0 looks -Z, π looks +Z, π/2 looks -X, -π/2 looks +X.
const walk = (yaw: number): MoveInput => ({ ...emptyInput(), forward: 1, yaw });

test('Summit is a Battle map you can pick', () => {
  assert.ok(BATTLE_MAP_IDS.includes('summit') && isBattleMap('summit'));
  assert.equal(mapFor('battle', 'summit'), M);
  assert.equal(BATTLE_MAPS.summit.name, 'Summit');
  assert.notEqual(mapFor('survival', 'summit'), M);
});

test('Summit is point-symmetric, so both halves play the same', () => {
  const key = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; kind: string }) =>
    [b.kind, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(',');
  const flipped = M.boxes.map((b) => key({ kind: b.kind, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } }));
  assert.deepEqual([...flipped].sort(), M.boxes.map(key).sort());
  const tkey = (t: { min: { x: number; z: number }; max: { x: number; z: number } }) => [t.min.x, t.min.z, t.max.x, t.max.z].join(',');
  const tflip = M.triggers.map((t) => tkey({ min: { x: -t.max.x, z: -t.max.z }, max: { x: -t.min.x, z: -t.min.z } }));
  assert.deepEqual([...tflip].sort(), M.triggers.map(tkey).sort());
});

test('ramps: slide ramps are walkable, the ice chute is too steep to stand on', () => {
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

test('spawn chooser works on Summit: keeps away from enemies and avoids repeats', () => {
  const enemy = { x: 0, y: 10.01, z: 0 }; // on the peak
  for (let i = 0; i < 200; i++) assert.ok(dist(M.spawns[pickSpawn(M.spawns, [enemy], [], M.boxes)].pos, enemy) >= SAFE_DISTANCE);
  const recent: number[] = [];
  for (let i = 0; i < RECENT_SPAWNS; i++) {
    const pick = pickSpawn(M.spawns, [], recent, M.boxes);
    assert.ok(!recent.includes(pick));
    recent.push(pick);
  }
});

test('every jump pad lands its rider on solid ground: the ridge pads on the peak, the lodge pads on its roof', () => {
  const pads = M.boxes.filter((b) => b.kind === 'pad');
  assert.equal(pads.length, 4);
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
    heights.push(Math.round(s.pos.y));
  }
  assert.deepEqual(heights.sort((a, b) => a - b), [8, 8, 10, 10], `landing heights ${heights}`);
});

test('walk up: a ridge ramp, the cable station ramp, the Cornice ramp, out of the gully', () => {
  const ridge = createPlayerState({ x: 15, y: 0.01, z: 16 });
  play(ridge, walk(0), 4, () => ridge.pos.z > 2);
  assert.ok(ridge.pos.y > 4.9, `ridge ramp only reached y=${ridge.pos.y.toFixed(2)}`);
  const station = createPlayerState({ x: 11, y: 0.01, z: 30.5 });
  play(station, walk(Math.PI / 2), 6, () => station.pos.x > -6);
  assert.ok(station.pos.y > 5.9, `station ramp only reached y=${station.pos.y.toFixed(2)}`);
  const cornice = createPlayerState({ x: -19, y: 0.01, z: 32 });
  play(cornice, walk(Math.PI / 2), 6, () => cornice.pos.x > -34);
  assert.ok(cornice.pos.y > 5.9, `cornice ramp only reached y=${cornice.pos.y.toFixed(2)}`);
  const gully = createPlayerState({ x: -34, y: -5.99, z: 9.5 });
  play(gully, walk(0), 6, () => gully.pos.z > -1);
  assert.ok(gully.pos.y > -0.1, `gully exit only reached y=${gully.pos.y.toFixed(2)}`);
});

test('the Crag shelves can be hopped up', () => {
  const s = createPlayerState({ x: 34, y: 0.01, z: 32 });
  const input = walk(-Math.PI / 2);
  play(s, input, 4, (i) => {
    if (s.onGround && i % 20 === 0) input.jumpPressed = true;
    return s.pos.x < 46;
  });
  assert.ok(s.pos.y > 3.5, `only reached y=${s.pos.y.toFixed(2)}`);
});

test('Ice Chute: run off the Cornice through the gate, ride the ice down the gully, come out alive', () => {
  const s = createPlayerState({ x: -40, y: 6.01, z: 32.5 });
  let minZ = s.pos.z;
  let surfed = false;
  play(s, walk(0), 6, () => {
    minZ = Math.min(minZ, s.pos.z);
    if (s.pos.y > -4 && s.pos.z < 30 && s.pos.z > 10 && Math.abs(s.pos.x + 40) < 5.5 && !s.onGround) surfed = true;
    return s.pos.y > M.killY && s.pos.z > -2;
  });
  assert.ok(surfed, 'never got onto the ice');
  assert.ok(minZ < -2 && s.pos.y > -0.5, `only got to ${JSON.stringify(s.pos)}`); // out the far end and onto the snowfield
});

test('Cable Station run: the gates fling you off the deck onto the Cornice ramp, and on up to the Cornice', () => {
  const s = createPlayerState({ x: -5, y: 6.01, z: 30.5 });
  let fast = 0;
  play(s, walk(Math.PI / 2), 3, () => {
    fast = Math.max(fast, -s.vel.x);
    return !(s.onGround && s.pos.x < -21) && s.pos.y > M.killY;
  });
  assert.ok(fast >= 17.9, `the gates only got you to ${fast.toFixed(1)} m/s`);
  assert.ok(s.pos.x < -21 && s.pos.y > 1, `landed at ${JSON.stringify(s.pos)}`); // on the ramp, not in the dip before it
  play(s, walk(Math.PI / 2), 3, () => s.pos.x > -36);
  assert.ok(s.pos.y > 5.9, `never made the Cornice: ${JSON.stringify(s.pos)}`);
});

test('The Lodge: both ground-floor doors let you in', () => {
  const west = createPlayerState({ x: 19, y: 0.01, z: 26.85 });
  play(west, walk(-Math.PI / 2), 2, () => west.pos.x < 24);
  assert.ok(west.pos.x >= 24, `stuck outside the west door at x=${west.pos.x.toFixed(2)}`);
  const south = createPlayerState({ x: 26, y: 0.01, z: 14 });
  play(south, walk(Math.PI), 2, () => south.pos.z < 21);
  assert.ok(south.pos.z >= 21, `stuck outside the south door at z=${south.pos.z.toFixed(2)}`);
});

test('Icefall: the puffball throws you up between the ice walls', () => {
  const s = createPlayerState({ x: 40, y: 0.01, z: 12 });
  let top = 0;
  play(s, walk(0), 2, () => {
    top = Math.max(top, s.pos.y);
  });
  assert.ok(top > 4, `only bounced to y=${top.toFixed(2)}`);
});

test('the open edge never traps you: walking off it falls below killY', () => {
  const s = createPlayerState({ x: 24, y: 0.01, z: 30 });
  play(s, walk(Math.PI), 6, () => s.pos.y > M.killY - 1);
  assert.ok(s.pos.y < M.killY);
});
