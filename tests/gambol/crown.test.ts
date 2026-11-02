import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WALKABLE_NORMAL_Y, rampNormal } from '../../src/gambol/shared/collision.ts';
import { TICK_DT } from '../../src/gambol/shared/constants.ts';
import { CROWN as M, CROWN_ZONE as Z } from '../../src/gambol/shared/crown.ts';
import { inZone } from '../../src/gambol/shared/koth.ts';
import { mapFor } from '../../src/gambol/shared/maps.ts';
import { SAFE_DISTANCE, pickSpawn } from '../../src/gambol/shared/spawn.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../../src/gambol/shared/movement.ts';

function play(s: PlayerState, input: MoveInput, seconds: number, onTick?: () => boolean | void) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.() === false) break;
    stepPlayer(s, input, TICK_DT, M.boxes, M.triggers);
    input.jumpPressed = false;
  }
}
/** yaw that looks from `a` toward `b` (yaw 0 looks -Z). */
const yawTo = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

test('King of the Hill always plays on Crown, and Crown carries its hill and team spawns', () => {
  assert.equal(mapFor('battle', 'windward', true), M);
  assert.notEqual(mapFor('battle', 'windward', false), M);
  assert.ok(M.koth);
  assert.deepEqual(M.koth.zone, Z);
  assert.equal(M.koth.teamSpawns[0].length, M.koth.teamSpawns[1].length);
});

test('Crown is point-symmetric, so neither team has the better approach', () => {
  const key = (b: { kind: string; min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) =>
    [b.kind, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(',');
  const flipped = M.boxes.map((b) => key({ kind: b.kind, min: { x: -b.max.x, y: b.min.y, z: -b.max.z }, max: { x: -b.min.x, y: b.max.y, z: -b.min.z } }));
  assert.deepEqual([...flipped].sort(), M.boxes.map(key).sort());
});

test('ramps: slide ramps are walkable, the surf is too steep to stand on', () => {
  for (const b of M.boxes.filter((b) => b.ramp)) {
    const ny = rampNormal(b).y;
    assert.ok(b.kind === 'surf' ? ny < WALKABLE_NORMAL_Y : ny >= WALKABLE_NORMAL_Y, `${b.kind} at ${JSON.stringify(b.min)}: ${ny.toFixed(2)}`);
  }
});

test('team spawns: spread over each team\'s whole half (not just the base), on solid ground, back from the hill, facing it', () => {
  const [sunset, tide] = M.koth!.teamSpawns;
  for (const [team, list] of [[0, sunset], [1, tide]] as const) {
    assert.ok(list.length >= 16, `${list.length} spawns`);
    const xs = list.map((s) => s.pos.x);
    const zs = list.map((s) => Math.abs(s.pos.z));
    assert.ok(Math.max(...xs) - Math.min(...xs) > 50 && Math.max(...zs) - Math.min(...zs) > 25, 'they cover the half, not one corner');
    assert.ok(list.some((s) => s.pos.y > 4) && list.some((s) => s.pos.y < 1), 'up on the base and ledges, and down on the field');
    for (const sp of list) {
      assert.ok(team === 0 ? sp.pos.z > 10 : sp.pos.z < -10, `team ${team} spawn on the wrong side: ${JSON.stringify(sp.pos)}`);
      assert.ok(Math.hypot(sp.pos.x, sp.pos.z) > 20, 'back from the hill');
      const s = createPlayerState(sp.pos);
      play(s, emptyInput(), 1);
      assert.ok(s.onGround && Math.abs(s.pos.y - sp.pos.y) < 0.05, `spawn ${JSON.stringify(sp.pos)} -> ${JSON.stringify(s.pos)}`);
      const want = yawTo(sp.pos, Z);
      const d = Math.atan2(Math.sin(sp.yaw - want), Math.cos(sp.yaw - want));
      assert.ok(Math.abs(d) < Math.PI / 4, `spawn faces away from the hill: ${sp.yaw} vs ${want}`);
    }
  }
});

test('spawn camping: with three enemies holding the base exit, you still spawn well away from them, and not always in one spot', () => {
  const [sunset] = M.koth!.teamSpawns;
  const campers = [{ x: 0, y: 0.01, z: 34 }, { x: -6, y: 0.01, z: 38 }, { x: 8, y: 0.01, z: 36 }]; // at the foot of the base ramp
  let s = 3;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const used = new Set<number>();
  for (let k = 0; k < 40; k++) {
    const i = pickSpawn(sunset, campers, [], M.boxes, rand);
    used.add(i);
    const p = sunset[i].pos;
    const near = Math.min(...campers.map((c) => Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)));
    assert.ok(near >= SAFE_DISTANCE, `spawned ${near.toFixed(0)} m from a camper at ${JSON.stringify(p)}`);
  }
  assert.ok(used.size >= 2, `and it isn't always the same spot (${used.size})`);
});

test('the plateau is the hill: standing anywhere in the circle on top counts, the field around it does not', () => {
  const top = createPlayerState({ x: 4, y: 3.01, z: -6 });
  play(top, emptyInput(), 0.5);
  assert.ok(top.onGround && inZone(Z, top.pos));
  const below = createPlayerState({ x: 0, y: 0.01, z: 14 });
  play(below, emptyInput(), 0.5);
  assert.ok(!inZone(Z, below.pos));
});

test('every jump pad lands its rider on solid ground', () => {
  const pads = M.boxes.filter((b) => b.kind === 'pad');
  assert.ok(pads.length >= 2);
  for (const b of pads) {
    const s = createPlayerState({ x: (b.min.x + b.max.x) / 2, y: b.max.y + 0.01, z: (b.min.z + b.max.z) / 2 });
    let launched = false;
    let landed = false;
    play(s, emptyInput(), 6, () => {
      if (s.events & Ev.JumpPad) launched = true;
      else if (launched && s.events & Ev.Land) landed = true;
      return !landed && s.pos.y > M.killY;
    });
    assert.ok(launched && landed && s.pos.y > 4.5, `pad at ${JSON.stringify(b.min)} -> ${JSON.stringify(s.pos)}`);
  }
});

test('main lane: from the Sunset base, run down the ramp through the gate and up onto the hill in a few seconds', () => {
  const s = createPlayerState({ x: 0, y: 5.01, z: 52 });
  let t = 0;
  let reached = -1;
  let gated = false;
  play(s, { ...emptyInput(), forward: 1, yaw: 0 }, 10, () => {
    t += TICK_DT;
    if (s.events & Ev.Boost) gated = true;
    if (inZone(Z, s.pos) && s.onGround) reached = t;
    return reached < 0 && s.pos.y > M.killY;
  });
  assert.ok(gated, 'the gate at the foot of the ramp should fire');
  assert.ok(reached > 0 && reached < 7.5, `reached the hill at t=${reached.toFixed(2)} (${JSON.stringify(s.pos)})`);
});

test('every side of the plateau has a ramp up onto the hill', () => {
  for (const [x, z] of [[0, 18], [0, -18], [18, 0], [-18, 0]]) {
    const s = createPlayerState({ x, y: 0.01, z });
    const input = { ...emptyInput(), forward: 1, yaw: yawTo({ x, z }, Z) };
    let on = false;
    play(s, input, 5, () => {
      if (inZone(Z, s.pos) && s.onGround) on = true;
      return !on;
    });
    assert.ok(on, `no way up from (${x}, ${z}): ended at ${JSON.stringify(s.pos)}`);
  }
});

test('bluff: from the base over the bridge onto the high ledge, then down its ramp toward the hill', () => {
  const s = createPlayerState({ x: -10, y: 5.01, z: 49.5 });
  play(s, { ...emptyInput(), forward: 1, yaw: Math.PI / 2 }, 4, () => s.pos.x > -29); // yaw π/2 looks -X
  assert.ok(s.pos.y > 4.9 && s.pos.x <= -29, `bridge: ${JSON.stringify(s.pos)}`);
  play(s, { ...emptyInput(), forward: 1, yaw: 0 }, 8, () => s.pos.z > 8); // south along the bluff and down its ramp
  assert.ok(s.pos.z <= 8 && s.pos.y < 0.5 && s.pos.y > -0.5, `ramp: ${JSON.stringify(s.pos)}`);
});

test('gorge surf: from the base over the east bridge, off the ledge onto the A-frame, delivered beside the hill', () => {
  const s = createPlayerState({ x: 10, y: 5.01, z: 49.5 });
  play(s, { ...emptyInput(), forward: 1, yaw: -Math.PI / 2 }, 4, () => s.pos.x < 28); // east over the bridge
  assert.ok(s.pos.y > 4.9, `bridge: ${JSON.stringify(s.pos)}`);
  let minZ = s.pos.z;
  play(s, { ...emptyInput(), forward: 1, yaw: 0 }, 8, () => {
    minZ = Math.min(minZ, s.pos.z);
    return s.pos.y > M.killY && !(s.onGround && s.pos.z < 16);
  });
  assert.ok(minZ < 18 && s.pos.y > M.killY, `surf ended at ${JSON.stringify(s.pos)}`);
});

test('ruin houses: both ground-floor doors let you in', () => {
  // West house x -32..-22, z -5..5: east door at the landing end (z≈3.35), south door at x=-27.
  const east = createPlayerState({ x: -19, y: 0.01, z: 3.35 });
  play(east, { ...emptyInput(), forward: 1, yaw: Math.PI / 2 }, 2, () => east.pos.x > -26);
  assert.ok(east.pos.x <= -26, `stuck at the east door: ${JSON.stringify(east.pos)}`);
  const south = createPlayerState({ x: -27, y: 0.01, z: -8 });
  play(south, { ...emptyInput(), forward: 1, yaw: Math.PI }, 2, () => south.pos.z < -2);
  assert.ok(south.pos.z >= -2, `stuck at the south door: ${JSON.stringify(south.pos)}`);
});
