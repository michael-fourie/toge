import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, packZombies, unpackZombies } from '../src/games/boys-day/director.ts';
import { firstSeats, readMsg, takeSeat } from '../src/games/boys-day/net.ts';
import { ROAD, makeRoute, roadNear } from '../src/games/boys-day/route.ts';
import {
  BUS,
  GOLF,
  REEL_SPEED,
  SLOTS,
  HORDE,
  NO_DRIVE,
  RUN,
  SEED_MAX,
  STOP_ORDER,
  collideBus,
  fwdOf,
  newRun,
  newSeed,
  teesOff,
  reelAt,
  slotPay,
  stepBus,
  stopDone,
  sweep,
  type Bus,
  type Drive,
} from '../src/games/boys-day/rules.ts';

const DT = 1 / 60;
const bus = (x = 0, z = 0, h = 0, v = 0): Bus => ({ x, z, h, v, steer: 0 });
const run = (b: Bus, d: Drive, s: number, onRoad = true) => {
  for (let t = 0; t < s; t += DT) stepBus(b, d, DT, onRoad);
};

test('boys day route: the same seed builds the same map; stops in order, a leg apart', () => {
  for (const seed of [1, 2, 99, 12345, 777777]) {
    const a = makeRoute(seed);
    assert.deepEqual(a, makeRoute(seed));
    assert.deepEqual(a.stops.map((s) => s.kind), [...STOP_ORDER]);
    for (let n = 1; n < a.stops.length; n++) {
      const leg = a.road[a.stops[n].i].s - a.road[a.stops[n - 1].i].s;
      assert.ok(leg >= ROAD.legMin - ROAD.step && leg <= ROAD.legMax + ROAD.step, `seed ${seed} leg ${n}: ${leg}`);
    }
  }
  assert.notDeepEqual(makeRoute(1).road.at(-1), makeRoute(2).road.at(-1), 'different seeds, different maps');
});

test('boys day route: a bus can take every bend, the road never crosses itself, scenery stays off it', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = makeRoute(seed);
    for (let i = 1; i < r.road.length; i++) {
      assert.ok(Math.abs(r.road[i].h - r.road[i - 1].h) <= ROAD.step / ROAD.minRadius + 1e-9, `seed ${seed}: hairpin at ${i}`);
      assert.ok(r.road[i].z < r.road[i - 1].z, 'always heading on (so it never loops back over itself)');
    }
    for (const p of r.props) {
      if (p.kind === 'wreck') continue; // wrecks are meant to be in the way
      const d = roadNear(r.road, p.x, p.z).d;
      assert.ok(d >= ROAD.half, `seed ${seed}: a ${p.kind} on the road (${d.toFixed(1)} m)`);
    }
    for (const s of r.stops) assert.ok(roadNear(r.road, s.bx, s.bz).d > ROAD.half + 8, `seed ${seed}: ${s.kind} on the road`);
    for (const p of r.pickups) assert.ok(roadNear(r.road, p.x, p.z).d <= ROAD.half + 3.5, `seed ${seed}: pickup ${p.id} out in a field`);
  }
});

/** Pure pursuit down the road: aim at the road a little ahead and hold a speed. */
function autopilot(b: Bus, road: ReturnType<typeof makeRoute>['road'], hint: number, cruise: number): Drive {
  const near = roadNear(road, b.x, b.z, hint);
  const ahead = road[Math.min(road.length - 1, near.i + 4)];
  const f = fwdOf(b.h);
  const dx = ahead.x - b.x;
  const dz = ahead.z - b.z;
  const cross = f.x * dz - f.z * dx; // > 0: the target is to the right
  const steer = Math.max(-1, Math.min(1, (cross / Math.max(4, Math.hypot(dx, dz))) * 4));
  return { throttle: b.v < cruise ? 1 : 0, brake: b.v > cruise + 2 ? 0.5 : 0, steer, handbrake: false };
}

test('boys day: an autopilot bus drives every map end to end without leaving the road', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = makeRoute(seed);
    const b = bus(0, 0, 0, 0);
    let hint = 0;
    let worst = 0;
    for (let t = 0; t < 240 && hint < r.road.length - 14; t += DT) {
      const near = roadNear(r.road, b.x, b.z, hint);
      hint = near.i;
      worst = Math.max(worst, near.d);
      stepBus(b, autopilot(b, r.road, hint, 18), DT, near.d < ROAD.half + 1);
    }
    assert.ok(hint >= r.road.length - 14, `seed ${seed}: only got to ${hint}/${r.road.length}`);
    assert.ok(worst < ROAD.half, `seed ${seed}: strayed ${worst.toFixed(1)} m off the centre line`);
  }
});

test('boys day bus: throttle to top speed, slower on grass, brakes stop it (never reverse it), holding brake reverses', () => {
  const b = bus();
  run(b, { ...NO_DRIVE, throttle: 1 }, 12);
  assert.ok(b.v > BUS.maxSpeed * 0.9 && b.v <= BUS.maxSpeed + 1e-6, `top ${b.v}`);
  assert.ok(b.z < -100 && Math.abs(b.x) < 1e-6, 'straight down -Z');
  const g = bus();
  run(g, { ...NO_DRIVE, throttle: 1 }, 12, false);
  assert.ok(g.v <= BUS.maxSpeed * BUS.grass + 1e-6, `grass ${g.v}`);
  // From full speed onto the grass it slows to the grass's limit, not a dead stop.
  run(b, { ...NO_DRIVE, throttle: 1 }, 3, false);
  assert.ok(Math.abs(b.v - BUS.maxSpeed * BUS.grass) < 1);
  run(b, { ...NO_DRIVE, brake: 1 }, 0.2);
  const v0 = b.v;
  for (let t = 0; t < 3; t += DT) {
    const was = b.v;
    stepBus(b, { ...NO_DRIVE, brake: 1 }, DT, true);
    if (was > 0.3) assert.ok(b.v >= 0, 'braking never flips it into reverse');
    if (b.v === 0) break;
  }
  assert.ok(v0 > 0 && b.v === 0, 'stopped');
  run(b, { ...NO_DRIVE, brake: 1 }, 3);
  assert.ok(b.v < -BUS.reverseSpeed * 0.8, `reversing at ${b.v}`);
  // Coasting slows it without stopping it dead.
  const c = bus(0, 0, 0, 20);
  run(c, NO_DRIVE, 1);
  assert.ok(c.v < 20 && c.v > 15);
});

test('boys day bus: steering right turns right; it turns tighter slow than fast', () => {
  const slow = bus(0, 0, 0, 6);
  const fast = bus(0, 0, 0, BUS.maxSpeed);
  run(slow, { ...NO_DRIVE, throttle: 0.1, steer: 1 }, 1);
  run(fast, { ...NO_DRIVE, throttle: 1, steer: 1 }, 1);
  assert.ok(slow.h < 0 && slow.x > 0, 'right turn: heading down, drifting to +X');
  const radius = (b: Bus) => Math.abs(b.v / ((b.v / BUS.wheelbase) * Math.tan(b.steer)));
  assert.ok(radius(slow) < radius(fast), `${radius(slow)} vs ${radius(fast)}`);
  assert.ok(radius(fast) > 20, 'a bus at speed can’t hairpin');
});

test('boys day bus: hitting a tree stops it there, pushed clear; a glancing one keeps most of the speed', () => {
  const b = bus(0, 0, 0, 20);
  const tree = { x: 0, z: -5, r: 0.6 };
  const lost = collideBus(b, [tree]);
  assert.ok(lost > 10 && b.v < 8, `head on: lost ${lost}, at ${b.v}`);
  assert.ok(Math.hypot(b.x - tree.x, b.z + 3.8 - tree.z) >= BUS.hullR + tree.r - 1e-6, 'pushed out');
  const g = bus(0, 0, 0, 20);
  collideBus(g, [{ x: 1.9, z: -3.8, r: 0.6 }]);
  assert.ok(g.v > 14, `glancing: ${g.v}`);
});

/** A director with its bus parked at stop `n`. */
function parkedAt(seed: number, n: number) {
  const d = new Director(makeRoute(seed));
  const s = d.route.stops[n];
  d.run.stage = n;
  return { d, b: bus(s.x, s.z, d.route.road[s.i].h, 0) };
}

test('boys day run: park at the range, tee off 4 zombies, win the club; nothing counts while driving or elsewhere', () => {
  const { d, b } = parkedAt(5, 1);
  d.mini('golf', 1);
  assert.equal(d.run.teed, 0, 'not parked yet');
  d.step(DT, b);
  assert.equal(d.run.phase, 'stop');
  d.mini('casino', 400);
  assert.equal(d.run.money, RUN.startMoney, 'no slots at the range');
  for (let k = 0; k < RUN.golfTees; k++) d.mini('golf', 1);
  d.step(DT, b);
  assert.equal(d.run.club, true);
  assert.equal(d.run.stage, 2);
  assert.equal(d.run.phase, 'drive');
});

test('boys day run: casino winnings to bail, the jail takes it and holds, Gordie joins, home wins', () => {
  const { d, b } = parkedAt(6, 2);
  d.step(DT, b);
  while (d.run.stage === 2) {
    d.mini('casino', 999); // clamped to the best line
    d.step(DT, b);
  }
  assert.ok(d.run.money >= RUN.bail);
  const money = d.run.money;
  const s = d.route.stops[3];
  Object.assign(b, { x: s.x, z: s.z, v: 0 });
  d.run.busHp = 1e9; // the horde doesn't matter here
  for (let t = 0; t < RUN.jailHold + 1 && d.run.stage === 3; t += 0.1) d.step(0.1, b);
  assert.equal(d.run.money, money - RUN.bail);
  assert.equal(d.run.gordie, true);
  assert.equal(d.run.stage, 4);
  const home = d.route.stops[4];
  Object.assign(b, { x: home.x, z: home.z, v: 0 });
  d.step(DT, b);
  assert.equal(d.run.phase, 'won');
  assert.ok(stopDone(d.run));
});

test('boys day run: leaving a stop early keeps the progress; driving off puts you back on the road', () => {
  const { d, b } = parkedAt(7, 1);
  d.step(DT, b);
  d.mini('golf', 1);
  b.x += 60;
  d.step(DT, b);
  assert.equal(d.run.phase, 'drive');
  assert.equal(d.run.teed, 1);
});

test('boys day zombies: the bus at speed yeets them; slow, they climb on and hurt it until shot off', () => {
  const d = new Director(makeRoute(3));
  const b = bus(0, -200, 0, 20);
  const z = d.add(0, -206, 0);
  d.step(DT, b);
  assert.equal(z.st, 'fly');
  assert.equal(d.run.yeets, 1);
  assert.ok(d.fx.some((f) => f.k === 'yeet'));
  const slow = bus(0, -200, 0, 0);
  const c = d.add(BUS.width / 2 + 0.3, -200, 0);
  const hp = d.run.busHp;
  for (let t = 0; t < 2; t += DT) d.step(DT, slow);
  assert.equal(c.st, 'climb');
  assert.ok(d.run.busHp < hp, 'climbers chew the bus');
  d.hit(c.id, 2);
  assert.notEqual(c.st, 'climb', 'a hit knocks it off');
  assert.equal(c.paint, 2);
});

test('boys day zombies: paintballs kill; the club only works once you have it and only in reach', () => {
  const d = new Director(makeRoute(4));
  const b = bus(0, -300, 0, 0);
  d.lastBus = b;
  const z = d.add(30, -300, 0);
  for (let k = 0; k < 3; k++) d.hit(z.id, 1);
  assert.equal(z.hp, 0);
  assert.equal(d.run.kills, 1);
  const near = d.add(BUS.width / 2 + 2, -300, 0);
  const far = d.add(40, -300, 0);
  assert.equal(d.swing([near.id], 1, b), 0, 'no club yet');
  d.run.club = true;
  assert.equal(d.swing([near.id, far.id], 1, b), 1, 'only the one in reach');
  assert.equal(near.st, 'fly');
  assert.ok(d.fx.some((f) => f.k === 'fore'));
});

test('boys day: the bus dies at 0 hp; pickups pay once', () => {
  const d = new Director(makeRoute(8));
  const p = d.route.pickups.find((q) => q.kind === 'cash')!;
  d.grab(p.id);
  d.grab(p.id);
  assert.equal(d.run.money, RUN.startMoney + RUN.cash);
  d.run.busHp = 1;
  const b = bus(0, -100, 0, 0);
  for (let k = 0; k < 4; k++) d.add(BUS.width / 2 + 0.2, -100 + k, 2);
  for (let t = 0; t < 3 && d.run.phase !== 'lost'; t += DT) d.step(DT, b);
  assert.equal(d.run.phase, 'lost');
});

test('boys day: the horde spawns round the bus, mostly ahead, and stays under the cap', () => {
  const d = new Director(makeRoute(9));
  const b = bus(0, -50, 0, 0);
  for (let t = 0; t < 20; t += 0.1) d.step(0.1, b);
  assert.ok(d.zs.length > 10 && d.zs.length <= 90);
});

test('boys day: zombies round-trip through the wire format', () => {
  const d = new Director(makeRoute(10));
  d.add(12.34, -56.78, 1).y = 1.5;
  const back = unpackZombies(packZombies(d.zs));
  assert.equal(back.length, 1);
  assert.equal(back[0].k, 1);
  assert.ok(Math.abs(back[0].x - 12.3) < 0.06 && Math.abs(back[0].z + 56.8) < 0.06 && back[0].y === 1.5);
});

test('boys day minigames: a ball tees off the zombie it lands on; reels stop where they are; slots pay the table', () => {
  const z = { x: 0.3, d: 0.6 };
  assert.ok(teesOff(0.3, 0.6, z));
  assert.ok(teesOff(0.3 + GOLF.hitX * 0.9, 0.6 - GOLF.hitD * 0.9, z));
  assert.ok(!teesOff(0.3 + GOLF.hitX + 0.01, 0.6, z), 'wide');
  assert.ok(!teesOff(0.3, 0.6 + GOLF.hitD + 0.01, z), 'long');
  assert.equal(sweep(0, 1), 0);
  assert.equal(sweep(0.5, 1), 1);
  // Each reel cycles every symbol, at its own pace (the third is the hardest to stop on time).
  for (let reel = 0; reel < 3; reel++) {
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.01) seen.add(reelAt(t, reel));
    assert.equal(seen.size, SLOTS.length);
  }
  assert.ok(REEL_SPEED[2] > REEL_SPEED[0]);
  assert.equal(slotPay([5, 5, 5]), 400);
  assert.equal(slotPay([4, 4, 4]), 250);
  assert.equal(slotPay([0, 0, 0]), 120);
  assert.equal(slotPay([0, 1, 0]), 50);
  assert.equal(slotPay([0, 1, 2]), 0);
  // On average a pull pays: bail is reachable.
  let total = 0;
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) total += slotPay([a, b, c]);
  assert.ok(total / 216 > 24, `average pull $${(total / 216).toFixed(0)}`);
});

test('boys day net: every seed the host can roll gets through to the joiners (start and run state)', () => {
  // A seed over a billion used to fail the check, so half the time the joiners never left the lobby.
  for (const s of [0, 1, 999_999_999, 1_000_000_001, SEED_MAX - 1]) {
    assert.deepEqual(readMsg({ t: 'start', seed: s, seats: [1, 2] }), { t: 'start', seed: s, seats: [1, 2] }, `start, seed ${s}`);
    const r = newRun(s);
    assert.deepEqual(readMsg({ t: 'run', run: r, taken: [] }), { t: 'run', run: r, taken: [] }, `run, seed ${s}`);
  }
  for (let k = 0; k < 2000; k++) {
    const s = newSeed();
    assert.ok(readMsg({ t: 'start', seed: s, seats: [0] }), `rolled ${s}`);
  }
  assert.equal(readMsg({ t: 'start', seed: SEED_MAX, seats: [0] }), null);
  assert.equal(readMsg({ t: 'start', seed: -1, seats: [0] }), null);
  assert.equal(readMsg({ t: 'start', seed: 1.5, seats: [0] }), null);
});

test('boys day net: junk is dropped; seats swap only into free spots', () => {
  assert.equal(readMsg({ t: 'bus', x: 1, z: 2, h: 0, v: 999, s: 0 }), null);
  assert.equal(readMsg({ t: 'mini', k: 'casino', v: 1e9 }), null);
  assert.equal(readMsg({ t: 'z', z: [1, 2, 3], fx: [], said: [] }), null);
  assert.equal(readMsg({ t: 'nope' }), null);
  const act = { t: 'act', c: 2, shots: [10, 20, 30, 0, 0, -1000], hits: [4], grabs: [], swing: [] };
  assert.deepEqual(readMsg(act), act);
  assert.equal(readMsg({ ...act, shots: [1, 2, 3] }), null, 'half a shot');
  assert.equal(readMsg({ t: 'z', z: [], fx: [{ k: 'boom', x: 0, y: 0, z: 0, n: 0 }], said: [] }), null);
  const r = newRun(3);
  assert.deepEqual(readMsg({ t: 'run', run: r, taken: [1] }), { t: 'run', run: r, taken: [1] });
  const seats = firstSeats([1, 2, 3], 1);
  assert.deepEqual(seats.slice(0, 4), [1, 2, 3, -1]);
  assert.deepEqual(takeSeat(seats, 2, 0), seats, 'the driver’s seat is taken');
  const s2 = takeSeat(seats, 1, -1);
  assert.equal(s2[0], -1, 'the driver hops on the roof');
  assert.equal(takeSeat(s2, 3, 0)[0], 3, 'and someone else takes the wheel');
});

test('boys day: the horde grows with the crew: half for solo, the lot for four, more for a full bus', () => {
  assert.equal(HORDE.crewScale(1), 0.5);
  assert.ok(Math.abs(HORDE.crewScale(4) - 0.95) < 1e-9);
  assert.ok(HORDE.crewScale(8) > 1.5);
  for (let n = 2; n <= 8; n++) assert.ok(HORDE.crewScale(n) > HORDE.crewScale(n - 1));
  const count = (crew: number) => {
    const d = new Director(makeRoute(11), 11, crew);
    const b = bus(0, -60, 0, 0);
    for (let t = 0; t < 25; t += 0.1) d.step(0.1, b);
    return d.zs.filter((z) => z.st === 'run' || z.st === 'climb').length;
  };
  const solo = count(1);
  const eight = count(8);
  assert.ok(eight > solo * 2, `solo ${solo}, eight ${eight}`);
});

test('boys day: driving over a pickup collects it; a repair kit says what it fixed', () => {
  const d = new Director(makeRoute(12));
  const kit = d.route.pickups.find((p) => p.kind === 'repair')!;
  d.run.busHp = 600;
  d.step(DT, bus(kit.x, kit.z, 0, 10));
  assert.ok(d.taken.has(kit.id), 'collected by driving over it');
  assert.equal(d.run.busHp, 600 + RUN.repair);
  assert.ok(d.fx.some((f) => f.k === 'heal' && f.n === RUN.repair));
  const cash = d.route.pickups.find((p) => p.kind === 'cash')!;
  const money = d.run.money;
  d.step(DT, bus(cash.x + BUS.width / 2 + 1.5, cash.z, 0, 10));
  assert.ok(!d.taken.has(cash.id), 'a couple of metres off to the side misses it');
  d.step(DT, bus(cash.x, cash.z, 0, 10));
  assert.equal(d.run.money, money + RUN.cash);
  // A kit picked up on a full bus fixes nothing, and the popup says so.
  const d2 = new Director(makeRoute(12));
  d2.grab(kit.id);
  assert.ok(d2.fx.some((f) => f.k === 'heal' && f.n === 0));
});
