import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Box, WALKABLE_NORMAL_Y, rampNormal } from '../../src/gambol/shared/collision.ts';
import { PLAYER, TICK_DT } from '../../src/gambol/shared/constants.ts';
import { mapFor } from '../../src/gambol/shared/maps.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../../src/gambol/shared/movement.ts';
import { WILDMERE as M } from '../../src/gambol/shared/wildmere.ts';

function play(s: PlayerState, input: MoveInput, seconds: number, onTick?: () => boolean | void) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.() === false) break;
    stepPlayer(s, input, TICK_DT, M.boxes, M.triggers);
    input.jumpPressed = false;
  }
}

/** Dropped here, do you settle onto solid ground right where you are (not inside anything, not falling through)? */
function standable(p: { x: number; y: number; z: number }) {
  const s = createPlayerState({ x: p.x, y: p.y + 0.01, z: p.z });
  play(s, emptyInput(), 0.6);
  return s.onGround && Math.abs(s.pos.y - p.y) < 0.06 && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 0.05;
}

test('Battle Royale always plays on Wildmere, a big island with a zone that starts over all of it', () => {
  assert.equal(mapFor('battle', 'windward', false, true), M);
  assert.notEqual(mapFor('battle', 'windward'), M);
  const floors = M.boxes.filter((b) => b.kind === 'floor');
  const w = Math.max(...floors.map((b) => b.max.x)) - Math.min(...floors.map((b) => b.min.x));
  const d = Math.max(...floors.map((b) => b.max.z)) - Math.min(...floors.map((b) => b.min.z));
  assert.ok(w > 450 && d > 450, `${w} x ${d} m`);
  const z = M.royale!.zone;
  for (const b of M.boxes) for (const x of [b.min.x, b.max.x]) for (const zz of [b.min.z, b.max.z]) assert.ok(Math.hypot(x - z.x, zz - z.z) < z.r, 'the first circle covers the whole island');
  assert.ok(M.boxes.filter((b) => b.kind === 'trunk').length > 80, 'lots of trees');
  assert.ok(M.boxes.filter((b) => b.ramp?.axis && b.kind === 'ramp').length > 30 && M.boxes.filter((b) => b.kind === 'surf').length >= 8, 'lots of hills, some surf');
});

test('ramps: slide ramps and hills are walkable, the surf is too steep to stand on', () => {
  for (const b of M.boxes.filter((b) => b.ramp)) {
    const ny = rampNormal(b).y;
    assert.ok(b.kind === 'surf' ? ny < WALKABLE_NORMAL_Y : ny >= WALKABLE_NORMAL_Y, `${b.kind} at ${JSON.stringify(b.min)}: ${ny.toFixed(2)}`);
  }
});

test('every walkable ramp (hills and house stairs) can be walked up from its foot', () => {
  for (const b of M.boxes.filter((b) => b.kind === 'ramp')) {
    const r = b.ramp!;
    const across = r.axis === 'x' ? 'z' : 'x';
    const foot = r.rise > 0 ? b.min[r.axis] - 0.6 : b.max[r.axis] + 0.6;
    const start = { x: 0, y: b.min.y + 0.01, z: 0 };
    start[r.axis] = foot;
    start[across] = (b.min[across] + b.max[across]) / 2;
    const s = createPlayerState(start);
    // yaw 0 looks -Z; facing +X is -PI/2.
    const yaw = r.axis === 'z' ? (r.rise > 0 ? Math.PI : 0) : r.rise > 0 ? -Math.PI / 2 : Math.PI / 2;
    let top = false;
    play(s, { ...emptyInput(), forward: 1, yaw }, (b.max[r.axis] - b.min[r.axis]) / 5 + 1.5, () => {
      if (s.onGround && s.pos.y >= b.max.y - 0.05) top = true;
      return !top;
    });
    assert.ok(top, `ramp at ${JSON.stringify(b.min)}..${JSON.stringify(b.max)}: stuck at ${JSON.stringify(s.pos)}`);
  }
});

test('spawns: spread over the whole island, on open ground', () => {
  assert.ok(M.spawns.length >= 40);
  const xs = M.spawns.map((s) => s.pos.x);
  const zs = M.spawns.map((s) => s.pos.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 350 && Math.max(...zs) - Math.min(...zs) > 350);
  for (const sp of M.spawns) assert.ok(standable(sp.pos), `spawn ${JSON.stringify(sp.pos)}`);
  let closest = Infinity;
  for (const a of M.spawns) for (const b of M.spawns) if (a !== b) closest = Math.min(closest, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
  assert.ok(closest > 40, `two spawns ${closest.toFixed(0)} m apart`);
});

test('loot spots: plenty, everywhere, each one standable (houses, roofs, hilltops, platforms, the gorge floor, the fields)', () => {
  const loot = M.royale!.loot;
  assert.ok(loot.length >= 100, `${loot.length} spots`);
  assert.ok(loot.some((p) => p.y >= 16) && loot.some((p) => p.y < -10), 'up high and down in the gorge');
  for (const p of loot) assert.ok(standable(p), `loot spot ${JSON.stringify(p)}`);
});

test('every jump pad lands its rider on solid ground well above where it started', () => {
  const pads = M.boxes.filter((b) => b.kind === 'pad');
  assert.ok(pads.length >= 5);
  for (const b of pads) {
    const s = createPlayerState({ x: (b.min.x + b.max.x) / 2, y: b.max.y + 0.01, z: (b.min.z + b.max.z) / 2 });
    let launched = false;
    let landed = false;
    play(s, emptyInput(), 6, () => {
      if (s.events & Ev.JumpPad) launched = true;
      else if (launched && s.events & Ev.Land) landed = true;
      return !landed && s.pos.y > M.killY;
    });
    assert.ok(launched && landed && s.pos.y > b.max.y + 5, `pad at ${JSON.stringify(b.min)} -> ${JSON.stringify(s.pos)}`);
  }
});

/** Hold forward along -Z, leaning into the A-frame's west face (a surfer holds the strafe key into the ramp). */
function surfRun(start: { x: number; y: number; z: number }, seconds: number, until: (s: PlayerState) => boolean) {
  const s = createPlayerState(start);
  const input: MoveInput = { ...emptyInput(), forward: 1, yaw: 0 };
  let done = false;
  let boosted = false;
  let surfed = false;
  play(s, input, seconds, () => {
    if (s.events & Ev.Boost) boosted = true;
    if (s.pos.y < -2 && s.pos.y > -16 && !s.onGround && Math.abs(s.pos.x + 155) < 7) surfed = true;
    // On the surf, let go of forward and strafe toward the ridge, like holding A/D on a surf ramp; at the bottom, run.
    if (surfed && !s.onGround) {
      input.forward = 0;
      input.right = s.pos.x < -155 ? 1 : -1; // facing -Z, +right is +X: push toward the ridge
    } else if (surfed) {
      input.forward = 1;
      input.right = 0;
    }
    done = until(s);
    return !done && s.pos.y > M.killY;
  });
  return { s, done, boosted, surfed };
}

test('Gorge Run: off the north edge through the gate, surf down the three A-frames, out up the ramp at the bottom', () => {
  const run = surfRun({ x: -155, y: 0.01, z: 112 }, 25, (s) => s.onGround && s.pos.y > -0.1 && s.pos.z < -100);
  assert.ok(run.boosted, 'the gate on the edge fires');
  assert.ok(run.surfed, 'rode the A-frames');
  assert.ok(run.done, `out of the gorge on the far side: ended at ${JSON.stringify(run.s.pos)}`);
});

test('Sky Rail: the pad onto the pillar, then the gate off its edge onto the rail toward the farm', () => {
  const pad = M.boxes.find((b) => b.kind === 'pad' && b.min.x > 180 && b.min.z < -120)!;
  const s = createPlayerState({ x: (pad.min.x + pad.max.x) / 2, y: pad.max.y + 0.01, z: (pad.min.z + pad.max.z) / 2 });
  play(s, emptyInput(), 4, () => !(s.onGround && s.pos.y > 11));
  assert.ok(s.onGround && s.pos.y > 11, `on the pillar: ${JSON.stringify(s.pos)}`);
  // Run north (+Z, yaw PI) off the edge through the gate; lean onto the rail.
  const input: MoveInput = { ...emptyInput(), forward: 1, yaw: Math.PI };
  let maxZ = -Infinity;
  let surfed = false;
  play(s, input, 8, () => {
    if (!s.onGround && s.pos.y > 4 && s.pos.y < 10.5 && Math.abs(s.pos.x - 185) < 4 && s.pos.z > -96) surfed = true;
    maxZ = Math.max(maxZ, s.pos.z);
    return s.pos.y > 0.5 || !surfed;
  });
  assert.ok(surfed, 'rode the rail');
  assert.ok(maxZ > -40, `got most of the way along it: z=${maxZ.toFixed(0)}`);
});

test('every house has a way to its roof: walk in, climb every stair ramp, stand on top', () => {
  // A house roof is a grassy 'floor' over walls; the loot spots include each roof, all checked standable above.
  // Here: the ground floor of each house connects to its roof by stair ramps (each walkable, tested above), with headroom.
  const stairs = M.boxes.filter((b) => b.kind === 'ramp' && b.ramp!.axis === 'z' && b.max.x - b.min.x < 2.5);
  assert.ok(stairs.length >= 20, `${stairs.length} stair ramps`);
  for (const b of stairs) {
    const mid = { x: (b.min.x + b.max.x) / 2, y: b.max.y - 0.5, z: b.max.z - 0.3 };
    const blocked = M.boxes.some((o: Box) => o !== b && !o.ramp && o.min.x < mid.x + 0.3 && o.max.x > mid.x - 0.3 && o.min.z < mid.z && o.max.z > mid.z - 0.6 && o.min.y > b.max.y - 0.3 && o.min.y < b.max.y + PLAYER.height - 0.4);
    assert.ok(!blocked, `stairs at ${JSON.stringify(b.min)} have no headroom at the top`);
  }
});
