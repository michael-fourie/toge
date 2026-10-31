import assert from 'node:assert/strict';
import test from 'node:test';
import { type Box } from '../src/shared/collision.ts';
import { PLAYER } from '../src/shared/constants.ts';
import type { Vec3 } from '../src/shared/math.ts';
import { CAST, CHAR_IDS } from '../src/games/royal-degeneracy/cast.ts';
import { DOORS, FLOOR_Y, MEETING_CENTRE, REACH, ROOMS, SEATS, SOLIDS, SPOTS, doorBox, floorOf, roomAt, wakeSpot } from '../src/games/royal-degeneracy/house.ts';
import { WALK, newWalker, nudgeApart, shove, stepWalker, type Walker } from '../src/games/royal-degeneracy/move.ts';
import { doorBlocked } from '../src/games/royal-degeneracy/referee.ts';

const DT = 1 / 60;
const still = { fwd: 0, side: 0, jump: false, crouch: false, up: false };

const overlaps = (p: Vec3, b: Box) =>
  p.x - PLAYER.halfWidth < b.max.x &&
  p.x + PLAYER.halfWidth > b.min.x &&
  p.y + 0.05 < b.max.y &&
  p.y + PLAYER.height > b.min.y &&
  p.z - PLAYER.halfWidth < b.max.z &&
  p.z + PLAYER.halfWidth > b.min.z &&
  !b.ramp;

/** Boxes near a point, so the flood fill stays quick. */
const near = (p: Vec3, boxes: readonly Box[], r = 2.5) =>
  boxes.filter((b) => p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z && p.y + 3.5 > b.min.y && p.y - 3.5 < b.max.y);

function settle(w: Walker, boxes: readonly Box[], secs = 0.5) {
  for (let i = 0; i < secs / DT; i++) stepWalker(w, still, DT, boxes);
}

/** Walks from `from` along yaw for `secs`; returns the walker. */
function walk(from: Vec3, yaw: number, secs: number, boxes: readonly Box[] = SOLIDS, input = {}) {
  const w = newWalker(from, yaw);
  for (let i = 0; i < secs / DT; i++) stepWalker(w, { ...still, fwd: 1, ...input }, DT, boxes);
  return w;
}

test('house: every wake-up spot is clear standing room in its own room', () => {
  for (const id of CHAR_IDS) {
    for (let i = 0; i < 4; i++) {
      const p = wakeSpot(CAST[id].wake, i);
      assert.ok(!SOLIDS.some((b) => overlaps(p, b)), `${id} #${i} wakes inside something at ${JSON.stringify(p)}`);
      const w = newWalker(p);
      settle(w, SOLIDS);
      assert.ok(Math.abs(w.pos.y - p.y) < 0.05 && w.onGround, `${id} #${i} falls from ${JSON.stringify(p)}`);
      assert.equal(roomAt(w.pos)?.id, CAST[id].wake === 'living' ? 'living' : CAST[id].wake, `${id} wakes outside their room`);
    }
  }
});

test('house: no furniture blocks a doorway (a player fits either side of every door)', () => {
  for (const d of DOORS) {
    for (const side of [-0.7, 0.7]) {
      const p = { x: d.x + (d.axis === 'x' ? 0 : side), y: FLOOR_Y[d.floor] + 0.01, z: d.z + (d.axis === 'x' ? side : 0) };
      const hit = SOLIDS.find((b) => overlaps(p, b));
      assert.ok(!hit, `door ${d.id}: ${side > 0 ? '+' : '-'} side blocked by ${hit?.mat}`);
    }
  }
});

/** Walks a route of [yaw, seconds] legs (the stairs turn 90° at each landing). */
function route(from: Vec3, legs: [number, number][]) {
  const w = newWalker(from);
  for (const [yaw, secs] of legs) {
    w.yaw = yaw;
    for (let i = 0; i < secs / DT; i++) stepWalker(w, { ...still, fwd: 1 }, DT, SOLIDS);
  }
  return w;
}
const LEFT = Math.PI / 2;
const RIGHT = -Math.PI / 2;
const BACK = 0;
const FRONT = Math.PI;

test('house: the stairs spiral up with right-angle turns, and back down', () => {
  // From the hall: a few steps left to the corner landing, then the long flight toward the back to floor 2.
  const up1 = route({ x: 2.8, y: 0, z: 13.15 }, [[LEFT, 1], [BACK, 2.5]]);
  assert.equal(floorOf(up1.pos.y), 1, `floor 1 → 2 ends at ${JSON.stringify(up1.pos)}`);
  assert.equal(roomAt(up1.pos)?.id, 'stairs2', 'arrives on the landing at the back of the well');
  // Turn right: flight B climbs toward the right into the top hall.
  const up2 = route(up1.pos, [[RIGHT, 2.5]]);
  assert.equal(floorOf(up2.pos.y), 2, `floor 2 → 3 ends at ${JSON.stringify(up2.pos)}`);
  assert.equal(roomAt(up2.pos)?.id, 'hall3');
  // And all the way back down: left down flight B, then toward the front, then right into the hall.
  const down = route(up2.pos, [[LEFT, 3], [FRONT, 2.2], [RIGHT, 1.5]]);
  assert.equal(floorOf(down.pos.y), 0, `back down ends at ${JSON.stringify(down.pos)}`);
  assert.equal(roomAt(down.pos)?.id, 'hall');
});

test('house: the top-floor eaves are only reached through the bedrooms', () => {
  const hall3 = ROOMS.find((r) => r.id === 'hall3')!;
  for (const d of DOORS.filter((x) => x.hatch)) {
    const inHall = d.x >= hall3.min.x - 0.2 && d.x <= hall3.max.x + 0.2 && d.z >= hall3.min.z - 0.2 && d.z <= hall3.max.z + 0.2;
    assert.ok(!inHall, `hatch ${d.id} opens off the top hall`);
  }
});

/** Doorways (both sides and the middle) and the stair ends: where a person lines up to go through. */
const MAGNETS: Vec3[] = [
  ...DOORS.flatMap((d) =>
    [-0.7, 0, 0.7].map((o) => ({ x: d.x + (d.axis === 'x' ? 0 : o), y: FLOOR_Y[d.floor], z: d.z + (d.axis === 'x' ? o : 0) })),
  ),
  { x: 2.6, y: 0, z: 13.15 },
  { x: 0.62, y: 0.7, z: 13.15 },
  { x: 0.62, y: FLOOR_Y[1], z: 9.25 },
  { x: 1.6, y: FLOOR_Y[1], z: 9.35 },
  { x: 3, y: FLOOR_Y[1], z: 9.35 },
  { x: 1.8, y: FLOOR_Y[1], z: 10.6 },
  { x: 6, y: FLOOR_Y[2], z: 9.35 },
  { x: 1.7, y: 0, z: 23.9 },
  { x: 1.9, y: -0.75, z: -1.8 },
];

test('house: every room reaches every other on foot, and every chore and the bell can be reached', () => {
  const STEP = 0.25;
  const key = (p: Vec3) => `${Math.round(p.x / STEP)},${Math.round(p.y / 0.7)},${Math.round(p.z / STEP)}`;
  const start = wakeSpot('living', 0);
  const seen = new Map<string, Vec3>([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const p = queue.pop()!;
    const local = near(p, SOLIDS);
    // Eight ways: the diagonals slide along walls, which finds the doorways.
    for (let k = 0; k < 8; k++) {
      const w = newWalker(p, (k * Math.PI) / 4);
      for (let i = 0; i < 10; i++) stepWalker(w, { ...still, fwd: 1 }, DT, local);
      if (!w.onGround || Math.hypot(w.pos.x - p.x, w.pos.z - p.z) < 0.15) continue;
      const kk = key(w.pos);
      if (seen.has(kk)) continue;
      seen.set(kk, { ...w.pos });
      queue.push({ ...w.pos });
    }
    // People aim for doorways and stairs; a fixed lattice alone would rarely line up with a 1 m gap.
    for (const m of MAGNETS) {
      if (Math.abs(m.y - p.y) > 0.6 || Math.hypot(m.x - p.x, m.z - p.z) > 2.5) continue;
      const w = newWalker(p);
      for (let i = 0; i < 60 && Math.hypot(m.x - w.pos.x, m.z - w.pos.z) > 0.08; i++) {
        w.yaw = Math.atan2(-(m.x - w.pos.x), -(m.z - w.pos.z));
        stepWalker(w, { ...still, fwd: Math.min(1, Math.hypot(m.x - w.pos.x, m.z - w.pos.z) * 3) }, DT, local);
      }
      if (Math.hypot(m.x - w.pos.x, m.z - w.pos.z) > 0.15 || !w.onGround) continue;
      const kk = key(w.pos);
      if (seen.has(kk)) continue;
      seen.set(kk, { ...w.pos });
      queue.push({ ...w.pos });
    }
    assert.ok(seen.size < 80000, 'flood fill ran away');
  }
  const visited = [...seen.values()];
  for (const r of ROOMS) {
    const ok = visited.some((p) => floorOf(p.y) === r.floor && p.x > r.min.x && p.x < r.max.x && p.z > r.min.z && p.z < r.max.z);
    assert.ok(ok, `nobody can walk into ${r.name}`);
  }
  for (const s of SPOTS) {
    const ok = visited.some((p) => Math.hypot(p.x - s.pos.x, p.y + 1.5 - s.pos.y, p.z - s.pos.z) < REACH);
    assert.ok(ok, `can't reach ${s.name}`);
  }
});

test('house: a shut door is a wall, and a door never shuts on someone in the doorway', () => {
  const dev = DOORS.find((d) => d.id === 'dev')!;
  const shut = [...SOLIDS, doorBox(dev)];
  // From the landing, walk straight at Dev's shut door.
  const w = walk({ x: dev.x, y: FLOOR_Y[1], z: dev.z + 1.2 }, 0, 1.5, shut);
  assert.ok(w.pos.z > dev.z, `walked through a shut door to ${JSON.stringify(w.pos)}`);
  const open = walk({ x: dev.x, y: FLOOR_Y[1], z: dev.z + 1.2 }, 0, 1.5);
  assert.ok(open.pos.z < dev.z - 0.5, 'an open door lets you in');
  assert.ok(doorBlocked(dev, [{ x: dev.x, y: FLOOR_Y[1], z: dev.z + 0.1 }]));
  assert.ok(!doorBlocked(dev, [{ x: dev.x, y: FLOOR_Y[1], z: dev.z + 1.5 }]));
  assert.ok(!doorBlocked(dev, [{ x: dev.x, y: FLOOR_Y[0], z: dev.z }]), 'someone on the floor below doesn’t block it');
});

test('house: nobody walks through a wall, and a shove never pushes anyone through one', () => {
  // Hard against Mikol's wall from the hall, shoved into it.
  const w = newWalker({ x: 3.3, y: 0, z: 15 }, -Math.PI / 2);
  settle(w, SOLIDS, 0.1);
  for (let i = 0; i < 3; i++) {
    shove(w, { x: 1, z: 0 });
    settle(w, SOLIDS, 0.5);
  }
  assert.ok(w.pos.x < 3.9 - PLAYER.halfWidth + 0.01, `shoved through the wall to ${w.pos.x}`);
  // Walking straight at it for seconds doesn't get through either.
  const v = walk({ x: 2.7, y: 0, z: 15 }, -Math.PI / 2, 4);
  assert.ok(v.pos.x < 3.9, `walked through the wall to ${v.pos.x}`);
  // A shove in open floor staggers about half a metre.
  const s = newWalker({ x: 6.2, y: 0, z: 10.4 });
  settle(s, SOLIDS, 0.1);
  shove(s, { x: 0, z: 1 });
  settle(s, SOLIDS, 1);
  const moved = s.pos.z - 10.4;
  assert.ok(moved > 0.35 && moved < 0.8, `stagger was ${moved.toFixed(2)} m`);
});

test('house: two overlapping players drift apart (gently, each moving only themselves)', () => {
  const a = newWalker({ x: 6.2, y: 0, z: 10.4 });
  const b = newWalker({ x: 6.25, y: 0, z: 10.4 });
  for (let i = 0; i < 120; i++) {
    nudgeApart(a, [b.pos], DT, SOLIDS);
    nudgeApart(b, [a.pos], DT, SOLIDS);
  }
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  assert.ok(d >= WALK.personal - 0.05, `still ${d.toFixed(2)} m apart`);
  // Exactly on top of someone still splits.
  const c = newWalker({ x: 6.2, y: 0, z: 10.4 });
  for (let i = 0; i < 120; i++) nudgeApart(c, [{ x: 6.2, y: 0, z: 10.4 }], DT, SOLIDS);
  assert.ok(Math.hypot(c.pos.x - 6.2, c.pos.z - 10.4) > 0.5);
});

test('house: meeting seats sit around the coffee table, all facing it', () => {
  assert.ok(SEATS.length >= 12);
  for (const s of SEATS) {
    assert.equal(roomAt({ ...s.pos, y: 0.1 })?.id, 'living');
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const tx = MEETING_CENTRE.x - s.pos.x;
    const tz = MEETING_CENTRE.z - s.pos.z;
    assert.ok((fx * tx + fz * tz) / Math.hypot(tx, tz) > 0.99, 'a seat faces away from the table');
  }
});
