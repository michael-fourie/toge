import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Box, WALKABLE_NORMAL_Y, rampHeightAt, rampNormal, rayWorld } from '../src/shared/collision.ts';
import { TICK_DT } from '../src/shared/constants.ts';
import { MAP } from '../src/shared/map.ts';
import { type Vec3, hlen } from '../src/shared/math.ts';
import { Ev, type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';

function run(s: PlayerState, input: MoveInput, seconds: number, boxes: readonly Box[], onTick?: (i: number) => boolean | void) {
  let events = 0;
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.(i) === false) break;
    stepPlayer(s, input, TICK_DT, boxes);
    events |= s.events;
    input.jumpPressed = false;
  }
  return events;
}

// A 20° walkable slope rising toward +Z, and a 55° surf face rising toward +X, both long and isolated.
const slope: Box = { min: { x: -5, y: 0, z: 0 }, max: { x: 5, y: 20 * Math.tan(0.349), z: 20 }, kind: 'ramp', ramp: { axis: 'z', rise: 1 } };
const surfFace: Box = { min: { x: 0, y: -20, z: -500 }, max: { x: 14, y: 0, z: 500 }, kind: 'surf', ramp: { axis: 'x', rise: 1 } };

test('ramp normals: slide ramps are walkable, surf ramps are too steep (Source 0.7 rule)', () => {
  assert.ok(rampNormal(slope).y >= WALKABLE_NORMAL_Y);
  assert.ok(rampNormal(surfFace).y < WALKABLE_NORMAL_Y);
  for (const b of MAP.boxes.filter((b) => b.ramp)) {
    const ny = rampNormal(b).y;
    assert.ok(b.kind === 'surf' ? ny < WALKABLE_NORMAL_Y : ny >= WALKABLE_NORMAL_Y, `${b.kind} ramp at ${JSON.stringify(b.min)} has normal.y ${ny.toFixed(2)}`);
  }
});

test('standing on a walkable ramp: grounded, and friction holds you still', () => {
  const s = createPlayerState({ x: 0, y: rampHeightAt(slope, 10.4) + 0.01, z: 10 });
  run(s, emptyInput(), 3, [slope]);
  assert.ok(s.onGround);
  assert.ok(Math.abs(s.pos.z - 10) < 0.01 && Math.abs(s.pos.x) < 0.01, `crept to ${JSON.stringify(s.pos)}`);
});

test('walking down a walkable ramp sticks to it (no airborne ticks), walking up climbs it', () => {
  const top = slope.max.y;
  const down = createPlayerState({ x: 0, y: rampHeightAt(slope, 19.9) + 0.01, z: 19.5 });
  let air = 0;
  run(down, { ...emptyInput(), forward: 1 }, 3, [slope], (i) => {
    if (i > 2 && !down.onGround) air++; // after the spawn tick settles us
    return down.pos.z > 0.5;
  });
  assert.equal(air, 0, 'airborne ticks walking downhill');

  const up = createPlayerState({ x: 0, y: 0.01, z: 0.2 });
  run(up, { ...emptyInput(), forward: 1, yaw: Math.PI }, 5, [slope], () => up.pos.z < 19); // stop at the top edge
  assert.ok(up.pos.y > top - 0.5, `only climbed to y=${up.pos.y.toFixed(2)}`);
});

test('a surf ramp never counts as ground: you slide down it', () => {
  const s = createPlayerState({ x: 10, y: rampHeightAt(surfFace, 10.4) + 0.01, z: 0 });
  let grounded = 0;
  run(s, emptyInput(), 1, [surfFace], () => {
    if (s.onGround) grounded++;
  });
  assert.equal(grounded, 0);
  assert.ok(s.pos.x < 9 && s.pos.y < -6, `should slide down and out: ${JSON.stringify(s.pos)}`);
});

test('surfing: holding into the ramp at 30 m/s rides it without losing speed or tunnelling through', () => {
  const s = createPlayerState({ x: 9, y: rampHeightAt(surfFace, 9.4) + 0.05, z: 0 });
  s.vel = { x: 0, y: 0, z: -30 };
  const input: MoveInput = { ...emptyInput(), right: 1 }; // looking -Z, D pushes +X into the face
  let inside = 0;
  run(s, input, 2, [surfFace], () => {
    // Never below the face under our footprint (allowing the skin).
    if (s.pos.y < rampHeightAt(surfFace, s.pos.x + 0.4) - 0.02 && s.pos.x < 14) inside++;
  });
  assert.equal(inside, 0, 'ended up inside the ramp');
  assert.ok(Math.abs(s.vel.z) >= 29.9, `speed along the ramp dropped to ${Math.abs(s.vel.z).toFixed(2)}`);
  assert.ok(s.pos.y > -20 && s.pos.x > 0, `fell off: ${JSON.stringify(s.pos)}`);
});

test('surfing converts falling into speed: dropping onto the face with a forward lean gains speed', () => {
  const s = createPlayerState({ x: 12, y: 2, z: 0 });
  s.vel = { x: 0, y: 0, z: -8 };
  const input: MoveInput = { ...emptyInput(), right: 1, yaw: 0.3 };
  run(s, input, 1.5, [surfFace]);
  assert.ok(hlen(s.vel) > 12, `speed ${hlen(s.vel).toFixed(1)}`);
});

test('rays hit ramp slopes where the surface is, and pass over the low end', () => {
  const h = rampHeightAt(slope, 10);
  const down = rayWorld({ x: 0, y: 30, z: 10 }, { x: 0, y: -1, z: 0 }, [slope], 100);
  assert.ok(Math.abs(down - (30 - h)) < 1e-6, `hit at ${down}, expected ${30 - h}`);
  // Horizontal ray at y=1 toward +Z enters the slope where its height reaches 1.
  const zHit = rayWorld({ x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, [slope], 100) - 5;
  assert.ok(Math.abs(rampHeightAt(slope, zHit) - 1) < 1e-6, `entered at z=${zHit}`);
  assert.equal(rayWorld({ x: 0, y: 20, z: -5 }, { x: 0, y: 0, z: 1 }, [slope], 100), 100, 'flies over the ramp');
});

// --- The actual map (Windward) ----------------------------------------------------------

/** Run on the real map (boxes + triggers). onTick returning false stops early. */
function play(s: PlayerState, input: MoveInput, seconds: number, onTick?: (i: number) => boolean | void) {
  let events = 0;
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    if (onTick?.(i) === false) break;
    stepPlayer(s, input, TICK_DT, MAP.boxes, MAP.triggers);
    events |= s.events;
    input.jumpPressed = false;
  }
  return events;
}

const onCentreIsland = (p: Vec3) => Math.abs(p.x) <= 24 && Math.abs(p.z) <= 26 && Math.abs(p.y) < 0.05;

test('every spawn is clear and stands on solid ground', () => {
  for (const sp of MAP.spawns) {
    const s = createPlayerState(sp.pos);
    play(s, emptyInput(), 1);
    assert.ok(s.onGround && Math.abs(s.pos.y - sp.pos.y) < 0.05, `spawn ${JSON.stringify(sp.pos)} -> ${JSON.stringify(s.pos)}`);
  }
});

test('every jump pad lands its rider on solid ground', () => {
  for (const b of MAP.boxes.filter((b) => b.kind === 'pad')) {
    const s = createPlayerState({ x: (b.min.x + b.max.x) / 2, y: b.max.y + 0.01, z: (b.min.z + b.max.z) / 2 });
    let launched = false;
    let landed = false;
    play(s, emptyInput(), 6, () => {
      if (s.events & Ev.JumpPad) launched = true;
      else if (launched && s.events & Ev.Land) landed = true;
      return !landed && s.pos.y > MAP.killY;
    });
    assert.ok(launched && landed, `pad at ${JSON.stringify(b.min)} -> ${JSON.stringify(s.pos)}`);
  }
});

test('Windway: out the harbour door, down the slide ramp, through the gates, bhop into the centre', () => {
  const s = createPlayerState({ x: 0, y: 12.01, z: 95 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  let peak = 0;
  play(s, input, 12, () => {
    input.jump = s.pos.z < 60; // hold jump (autohop) once on the runway
    peak = Math.max(peak, hlen(s.vel));
    return !(onCentreIsland(s.pos) && s.onGround) && s.pos.y > MAP.killY;
  });
  assert.ok(onCentreIsland(s.pos), `ended at ${JSON.stringify(s.pos)}`);
  assert.ok(peak >= 15.9, `the Windway gates should get you to speed: peak ${peak.toFixed(1)}`);
});

test('undercliff: missing the stones is safe, walk up the ramp into the centre', () => {
  const s = createPlayerState({ x: 0, y: -4.99, z: 60 });
  play(s, { ...emptyInput(), forward: 1 }, 10, () => !onCentreIsland(s.pos) && s.pos.y > MAP.killY);
  assert.ok(onCentreIsland(s.pos), `ended at ${JSON.stringify(s.pos)}`);
});

test('undercliff puffball bounces you back up onto the first stone', () => {
  const s = createPlayerState({ x: 0, y: -4.99, z: 54 });
  let bounced = false;
  let landed = false;
  play(s, { ...emptyInput(), forward: 1 }, 4, () => {
    if (s.events & Ev.Bounce) bounced = true;
    if (bounced && s.events & Ev.Land) landed = true;
    return !landed;
  });
  assert.ok(bounced && landed && s.pos.y > 2.9, `ended at ${JSON.stringify(s.pos)}`);
});

test('Surf Gorge: drop off the ledge, ride both A-frames, land on the exit terrace', () => {
  const s = createPlayerState({ x: -31, y: 12.01, z: 85 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  let peak = 0;
  let landed = false;
  play(s, input, 12, () => {
    if (s.pos.z < 82 && !s.onGround) {
      // Surf controller: A into the face (it rises toward -X); lean the view down-ramp (+X) while high on it.
      const depth = (s.pos.z > 55 ? 8 : 4) - s.pos.y;
      input.forward = 0;
      input.right = s.pos.z > 29 ? -1 : 0;
      input.yaw = -Math.max(0, Math.min(0.35, (5 - depth) * 0.08));
    }
    peak = Math.max(peak, hlen(s.vel));
    if (s.events & Ev.Land && s.pos.z < 30) landed = true;
    return !landed && s.pos.y > MAP.killY;
  });
  assert.ok(landed, `fell: ${JSON.stringify(s.pos)}`);
  assert.ok(s.pos.x > -42 && s.pos.x < -28 && s.pos.z > 14 && s.pos.z < 28, `landed off the terrace: ${JSON.stringify(s.pos)}`);
  assert.ok(peak > 14, `surfing should build speed, peak ${peak.toFixed(1)}`);
});

test('Old Ruins: walk down the ramp, through the tunnel and colonnade, onto the centre island', () => {
  const s = createPlayerState({ x: 27, y: 9.01, z: 90 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  play(s, input, 20, () => {
    if (s.pos.z < 22) input.yaw = Math.PI / 2; // on the ruins terrace: turn left onto the island
    return !onCentreIsland(s.pos) && s.pos.y > MAP.killY;
  });
  assert.ok(onCentreIsland(s.pos), `ended at ${JSON.stringify(s.pos)}`);
});

test('the ruins corridor walls are wallrunnable', () => {
  const s = createPlayerState({ x: 31.1, y: 1.5, z: 51 });
  s.vel = { x: 1, y: 3, z: -9 };
  let ran = 0;
  play(s, { ...emptyInput(), forward: 1 }, 1, () => {
    if (s.wallrunning) ran++;
  });
  assert.ok(ran > 0.5 / TICK_DT, `wallran ${ran} ticks`);
});

test('hiding spots: undercliff and tunnel are roofed, the shrines have windows', () => {
  const up = { x: 0, y: 1, z: 0 };
  assert.ok(rayWorld({ x: 0, y: -3, z: 58 }, up, MAP.boxes, 50) < 8, 'runway roofs the undercliff');
  assert.ok(rayWorld({ x: 28, y: 1.5, z: 58 }, up, MAP.boxes, 50) < 4, 'tunnel roof');
  // Through the shrine at (14, -14): in one ±X window and out the other.
  const eye = { x: 20, y: 1.7, z: -14 };
  assert.ok(rayWorld(eye, { x: -1, y: 0, z: 0 }, MAP.boxes, 12) === 12, 'window line of sight');
  assert.ok(rayWorld({ ...eye, z: -11.5 }, { x: -1, y: 0, z: 0 }, MAP.boxes, 12) < 5, 'wall blocks');
});

/** Walk through waypoints (x, z) in order, steering straight at each; returns the final state. */
function walk(start: Vec3, waypoints: [number, number][], seconds = 30) {
  const s = createPlayerState(start);
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  let i = 0;
  play(s, input, seconds, () => {
    const [x, z] = waypoints[i];
    if (Math.hypot(x - s.pos.x, z - s.pos.z) < 0.35) i++;
    if (i >= waypoints.length) return false;
    input.yaw = Math.atan2(-(waypoints[i][0] - s.pos.x), -(waypoints[i][1] - s.pos.z));
    return s.pos.y > MAP.killY;
  });
  return { s, reached: i };
}

test('Mill House: in the side door and up all three floors to the roof', () => {
  // Ramps alternate west (x 11.6) / east (x 16.4) walls, stepped onto from the south (z 51.1).
  const up = (x: number): [number, number][] => [[14, 59], [14, 51.1], [x, 51.1], [x, 59]];
  const { s, reached } = walk({ x: 9, y: 3.01, z: 58.85 }, [[11.6, 58.85], ...up(11.6), ...up(16.4), ...up(11.6)]);
  assert.equal(reached, 13, `stuck at ${JSON.stringify(s.pos)}`);
  assert.ok(Math.abs(s.pos.y - 15) < 0.05, `on the roof: ${JSON.stringify(s.pos)}`);
});

test('Cliff House: up to the gorge balcony, then on to the roof', () => {
  const start = { x: -15, y: 2.01, z: 54.85 };
  const toFirst: [number, number][] = [[-17.6, 54.85], [-20, 55], [-20, 47.1], [-22.4, 47.1], [-22.4, 55]];
  const balcony = walk(start, [...toFirst, [-25.3, 54.85]]);
  assert.ok(Math.abs(balcony.s.pos.y - 6) < 0.05 && balcony.s.pos.x < -24, `on the balcony: ${JSON.stringify(balcony.s.pos)}`);
  const roof = walk(start, [...toFirst, [-20, 55], [-20, 47.1], [-17.6, 47.1], [-17.6, 55]]);
  assert.ok(Math.abs(roof.s.pos.y - 10) < 0.05, `on the roof: ${JSON.stringify(roof.s.pos)}`);
});

test('house windows: you can see out of every floor', () => {
  // Mill House south wall windows (centred x 14) on floors at y 3, 7, 11, looking out toward the tree.
  for (const y of [3, 7, 11]) {
    const eye = { x: 14, y: y + 1.75, z: 55 };
    assert.ok(rayWorld(eye, { x: 0, y: 0, z: -1 }, MAP.boxes, 20) === 20, `window at y ${y}`);
  }
});

test('undercliff puffball by the Mill House: run +X and it throws you up onto the island', () => {
  const s = createPlayerState({ x: 2.2, y: -4.99, z: 49.5 });
  let bounced = false;
  play(s, { ...emptyInput(), forward: 1, yaw: -Math.PI / 2 }, 3, () => {
    if (s.events & Ev.Bounce) bounced = true;
    return !(bounced && s.onGround);
  });
  assert.ok(bounced && Math.abs(s.pos.y - 3) < 0.05 && s.pos.x > 8, `ended at ${JSON.stringify(s.pos)}`);
});

test('Mill Chute: gate off the island edge, surf the A-frame, land on the centre island', () => {
  const s = createPlayerState({ x: 11.5, y: 3.01, z: 49 });
  const input: MoveInput = { ...emptyInput(), forward: 1 };
  let peak = 0;
  play(s, input, 8, () => {
    if (s.pos.z < 45.5 && !s.onGround) {
      // Hold D into the west face (it rises toward +X); lean a little down-ramp (-X).
      input.forward = 0;
      input.right = s.pos.z > 29 ? 1 : 0;
      input.yaw = 0;
    }
    peak = Math.max(peak, hlen(s.vel));
    return !(onCentreIsland(s.pos) && s.onGround) && s.pos.y > MAP.killY;
  });
  assert.ok(onCentreIsland(s.pos), `ended at ${JSON.stringify(s.pos)}`);
  assert.ok(peak >= 14, `gate + chute speed ${peak.toFixed(1)}`);
});

test('Gorge Rail: the north-edge gate flings you onto the A-frame and you can ride it along X', () => {
  const s = createPlayerState({ x: -15, y: 0.01, z: 20 });
  const input: MoveInput = { ...emptyInput(), forward: 1, yaw: Math.PI }; // run +Z
  let riding = 0;
  play(s, input, 4, () => {
    const onRail = s.pos.z > 29 && s.pos.z < 37 && s.pos.x > -22 && s.pos.x < -8 && s.pos.y > -6 && !s.onGround;
    if (onRail) {
      riding++;
      // Turn to ride along -X and strafe toward the ridge (z 33), i.e. into whichever face we're on.
      input.forward = 0;
      input.yaw = Math.PI / 2;
      input.right = s.pos.z > 33 ? 1 : -1;
    }
    return s.pos.y > MAP.killY;
  });
  assert.ok(riding > 0.4 / TICK_DT, `rode the rail for ${(riding * TICK_DT).toFixed(2)}s`);
});

test('grapple hooks are free-floating, clear of other geometry, and within rope reach of somewhere you can stand', () => {
  const hooks = MAP.boxes.filter((b) => b.kind === 'hook');
  assert.ok(hooks.length >= 6, `${hooks.length} hooks`);
  const others = MAP.boxes.filter((b) => b.kind !== 'hook');
  for (const h of hooks) {
    const c = { x: (h.min.x + h.max.x) / 2, y: (h.min.y + h.max.y) / 2, z: (h.min.z + h.max.z) / 2 };
    const overlaps = (b: Box) =>
      h.min.x - 0.3 < b.max.x && h.max.x + 0.3 > b.min.x && h.min.y - 0.3 < b.max.y && h.max.y + 0.3 > b.min.y && h.min.z - 0.3 < b.max.z && h.max.z + 0.3 > b.min.z;
    assert.ok(!others.some(overlaps), `hook at ${JSON.stringify(c)} touches geometry`);
    const reach = others.some((b) => {
      if (!['floor', 'branch'].includes(b.kind) || b.ramp) return false;
      const px = Math.max(b.min.x, Math.min(c.x, b.max.x));
      const pz = Math.max(b.min.z, Math.min(c.z, b.max.z));
      return Math.hypot(px - c.x, b.max.y - c.y, pz - c.z) <= 36;
    });
    assert.ok(reach, `hook at ${JSON.stringify(c)} can't be reached from any floor`);
  }
});
