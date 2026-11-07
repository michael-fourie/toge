import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, packZombies, unpackZombies } from '../src/games/boys-day/director.ts';
import { readMsg, takeWheel } from '../src/games/boys-day/net.ts';
import { HAZARD, ROAD, groundAt, hazardAt, makeRoute, roadNear } from '../src/games/boys-day/route.ts';
import { TERRAIN, roadHeights } from '../src/games/boys-day/terrain.ts';
import {
  BUS,
  DRIVER,
  FLAT,
  OFF_CAB,
  ROUNDS,
  WALK,
  atCab,
  atHatch,
  goals,
  startSpot,
  walk,
  walkBounds,
  wallHit,
  type Ground,
  type Spot,
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
const run = (b: Bus, d: Drive, s: number, g: Partial<Ground> = {}) => {
  for (let t = 0; t < s; t += DT) stepBus(b, d, DT, { ...FLAT, ...g });
};
const GRASS: Partial<Ground> = { onRoad: false };

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
    for (let t = 0; t < 300 && hint < r.road.length - 14; t += DT) {
      const near = roadNear(r.road, b.x, b.z, hint);
      hint = near.i;
      worst = Math.max(worst, near.d);
      // Over the real hills, through the mud.
      const f = fwdOf(b.h);
      const grade = (groundAt(r, b.x + f.x * 3.5, b.z + f.z * 3.5, hint) - groundAt(r, b.x - f.x * 3.5, b.z - f.z * 3.5, hint)) / 7;
      const mud = hazardAt(r, b.x, b.z)?.kind === 'mud';
      stepBus(b, autopilot(b, r.road, hint, 18), DT, { grade, onRoad: near.d < ROAD.half + 1, mud, fumes: false });
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
  run(g, { ...NO_DRIVE, throttle: 1 }, 12, GRASS);
  assert.ok(g.v <= BUS.maxSpeed * BUS.grass + 1e-6, `grass ${g.v}`);
  // From full speed onto the grass it slows to the grass's limit, not a dead stop.
  run(b, { ...NO_DRIVE, throttle: 1 }, 3, GRASS);
  assert.ok(Math.abs(b.v - BUS.maxSpeed * BUS.grass) < 1);
  run(b, { ...NO_DRIVE, brake: 1 }, 0.2);
  const v0 = b.v;
  for (let t = 0; t < 3; t += DT) {
    const was = b.v;
    stepBus(b, { ...NO_DRIVE, brake: 1 }, DT);
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

test('boys day run: park at the range, tee off enough zombies, win the club; nothing counts while driving or elsewhere', () => {
  const { d, b } = parkedAt(5, 1);
  d.mini('golf', 1);
  assert.equal(d.run.teed, 0, 'not parked yet');
  d.step(DT, b);
  assert.equal(d.run.phase, 'stop');
  d.mini('casino', 400);
  assert.equal(d.run.money, RUN.startMoney, 'no slots at the range');
  for (let k = 0; k < d.run.tees; k++) d.mini('golf', 1);
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
  assert.ok(d.run.money >= d.run.bail);
  const money = d.run.money;
  const s = d.route.stops[3];
  Object.assign(b, { x: s.x, z: s.z, v: 0 });
  d.run.busHp = 1e9; // the horde doesn't matter here
  for (let t = 0; t < RUN.jailHold + 1 && d.run.stage === 3; t += 0.1) d.step(0.1, b);
  assert.equal(d.run.money, money - d.run.bail);
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

test('boys day rounds: a calm, then ROUND 1 sends its zombies; kill them all and the next calm starts; rounds grow', () => {
  const d = new Director(makeRoute(9), 9, 1);
  const b = bus(0, -50, 0, 0);
  d.run.busHp = 1e9;
  const live = () => d.zs.filter((z) => z.st === 'run' || z.st === 'climb');
  for (let t = 0; t < ROUNDS.first - 0.5; t += 0.1) d.step(0.1, b);
  assert.equal(live().length, 0, 'nothing before the first round');
  assert.equal(d.run.round, 0);
  for (let t = 0; t < 1; t += 0.1) d.step(0.1, b);
  assert.equal(d.run.round, 1);
  assert.ok(d.said.includes('ROUND 1') || d.fx.some((f) => f.k === 'round'));
  const size = ROUNDS.size(1, 1) + d.run.stage * 2;
  assert.equal(d.run.left, size, 'the HUD counts the whole round');
  let most = 0;
  const seen = new Set<number>();
  for (let t = 0, k = 0; t < 120 && d.run.calm === 0; t += 0.1, k++) {
    d.step(0.1, b);
    for (const z of d.zs) seen.add(z.id);
    most = Math.max(most, live().length);
    // Every few seconds the crew paints everything in sight.
    if (k % 40 === 39) for (const z of live()) while (z.hp > 0) d.hit(z.id, 1);
  }
  assert.ok(most <= ROUNDS.alive(1, 1), `at most ${ROUNDS.alive(1, 1)} at once, saw ${most}`);
  assert.equal(seen.size, size, `round 1 sends ${size}, no more`);
  assert.equal(d.run.calm, ROUNDS.calm, 'all dead: a breather');
  assert.equal(d.run.left, 0);
  for (let t = 0; t < ROUNDS.calm + 0.5; t += 0.1) d.step(0.1, b);
  assert.equal(d.run.round, 2);
  assert.ok(ROUNDS.size(2, 1) > ROUNDS.size(1, 1) && ROUNDS.size(5, 8) > ROUNDS.size(5, 1));
  assert.ok(ROUNDS.size(1, 1) <= 6 && ROUNDS.alive(1, 1) <= 4, 'solo starts gentle');
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
    assert.deepEqual(readMsg({ t: 'start', seed: s, driver: 2 }), { t: 'start', seed: s, driver: 2 }, `start, seed ${s}`);
    const r = newRun(s);
    assert.deepEqual(readMsg({ t: 'run', run: r, taken: [] }), { t: 'run', run: r, taken: [] }, `run, seed ${s}`);
  }
  for (let k = 0; k < 2000; k++) {
    const s = newSeed();
    assert.ok(readMsg({ t: 'start', seed: s, driver: 0 }), `rolled ${s}`);
  }
  assert.equal(readMsg({ t: 'start', seed: SEED_MAX, driver: 0 }), null);
  assert.equal(readMsg({ t: 'start', seed: -1, driver: 0 }), null);
  assert.equal(readMsg({ t: 'start', seed: 1.5, driver: 0 }), null);
});

test('boys day net: junk is dropped; the wheel is first come; spots stay on the bus', () => {
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
  assert.equal(takeWheel(1, 2, true), 1, 'someone’s driving');
  assert.equal(takeWheel(1, 2, false), 1, 'only the driver can get up');
  assert.equal(takeWheel(1, 1, false), -1, 'the driver gets up');
  assert.equal(takeWheel(-1, 3, true), 3, 'and someone else takes the wheel');
  assert.deepEqual(readMsg({ t: 'driver', id: -1 }), { t: 'driver', id: -1 }, 'nobody driving');
  assert.deepEqual(readMsg({ t: 'drive', want: true }), { t: 'drive', want: true });
  assert.equal(readMsg({ t: 'drive', want: 1 }), null);
  const aim = { t: 'aim', yaw: 1, pitch: 0.2, s: 0.5, a: -3, l: 1 };
  assert.deepEqual(readMsg(aim), aim);
  assert.equal(readMsg({ ...aim, l: 2 }), null, 'only inside or the roof');
  assert.equal(readMsg({ ...aim, a: 99 }), null, 'off the end of the bus');
});

test('boys day: the horde and the stops’ goals grow with the crew', () => {
  assert.equal(HORDE.crewScale(1), 0.5);
  assert.ok(Math.abs(HORDE.crewScale(4) - 0.95) < 1e-9);
  assert.ok(HORDE.crewScale(8) > 1.5);
  for (let n = 2; n <= 8; n++) {
    assert.ok(HORDE.crewScale(n) > HORDE.crewScale(n - 1));
    assert.ok(goals(n).tees > goals(n - 1).tees && goals(n).bail > goals(n - 1).bail, 'everyone gets a go');
  }
  const count = (crew: number) => {
    const d = new Director(makeRoute(11), 11, crew);
    d.run.busHp = 1e9;
    const b = bus(0, -60, 0, 0);
    for (let t = 0; t < 25; t += 0.1) d.step(0.1, b);
    return d.zs.filter((z) => z.st === 'run' || z.st === 'climb').length;
  };
  const solo = count(1);
  const eight = count(8);
  assert.ok(eight > solo * 2, `solo ${solo}, eight ${eight}`);
  assert.deepEqual({ tees: newRun(1, 3).tees, bail: newRun(1, 3).bail }, goals(3));
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

test('boys day: on foot you walk the bus (clear of the walls), climb the hatch to the roof, and take the wheel at the front', () => {
  const p: Spot = startSpot(0);
  assert.equal(p.level, 0);
  // Looking forward (yaw 0), W walks toward the front; looking left (yaw π/2), W walks to the left (−side).
  const a = { ...p };
  walk(a, 1, 0, 0, 0.5);
  assert.ok(a.along > p.along && Math.abs(a.side - p.side) < 1e-9);
  const l = { ...p };
  walk(l, 1, 0, Math.PI / 2, 0.2);
  assert.ok(l.side < p.side);
  const r = { ...p };
  walk(r, 0, 1, 0, 0.2);
  assert.ok(r.side > p.side, 'D strafes right');
  // Never through a wall, never past the driver's seat inside; the roof runs the whole length.
  const w = { ...p };
  for (let k = 0; k < 100; k++) walk(w, 1, 1, 0, 0.1);
  const b0 = walkBounds(0);
  assert.ok(w.side <= b0.side && w.along <= b0.front);
  assert.ok(walkBounds(1).front > b0.front);
  // Walking diagonally is no faster than straight.
  const dgl = { side: 0, along: 0, level: 0 as const };
  walk(dgl, 1, 1, 0, 0.1);
  assert.ok(Math.hypot(dgl.side, dgl.along) <= WALK.speed * 0.1 + 1e-9);
  assert.ok(atHatch({ side: WALK.hatch.side, along: WALK.hatch.along, level: 0 }));
  assert.ok(atHatch({ side: WALK.hatch.side, along: WALK.hatch.along, level: 1 }), 'and back down from the roof');
  assert.ok(!atHatch(startSpot(0)));
  assert.ok(atCab({ side: DRIVER.side, along: DRIVER.along - 0.6, level: 0 }));
  assert.ok(!atCab({ side: DRIVER.side, along: DRIVER.along - 0.6, level: 1 }), 'not from the roof');
  assert.ok(atCab(OFF_CAB), 'getting up leaves you right by the wheel');
  for (let i = 0; i < 8; i++) {
    const s = startSpot(i);
    const b = walkBounds(0);
    assert.ok(Math.abs(s.side) <= b.side && s.along >= b.back && s.along <= b.front, `start spot ${i} on the bus`);
  }
});

test('boys day: paintballs fly out of the windows but splat on the walls, roof and floor', () => {
  const y = (BUS.sill + BUS.lintel) / 2;
  const at = (x: number, yy: number, z: number) => ({ x, y: yy, z });
  assert.equal(wallHit(at(0, y, 0), at(BUS.width, y, 0)), null, 'out of a side window');
  assert.equal(wallHit(at(0, y, 0), at(0, y, BUS.length)), null, 'out of the back window');
  assert.equal(wallHit(at(0, 2, 0), at(0, 2, -BUS.length)), null, 'out of the windscreen');
  const low = wallHit(at(0, 1.2, 0), at(BUS.width, 1.2, 0));
  assert.ok(low && Math.abs(low.x - BUS.width / 2) < 1e-9, 'under the sill: the wall');
  assert.ok(wallHit(at(0, y, 0), at(0, BUS.top + 1, 0)), 'the roof');
  assert.ok(wallHit(at(0, y, 0), at(0, 0, 0)), 'the floor');
  assert.equal(wallHit(at(0, BUS.top + 1, 0), at(9, BUS.top + 1, 0)), null, 'from the roof: nothing in the way');
});

test('boys day terrain: hills you can see, a road a bus can climb, flat where you park, ground meeting the road', () => {
  for (const seed of [1, 7, 42, 9001]) {
    const r = makeRoute(seed);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < r.road.length; i++) {
      const a = r.road[i - 1];
      const b = r.road[i];
      const run = b.s - a.s;
      assert.ok(Math.abs(b.y - a.y) <= TERRAIN.maxGrade * run + 0.01, `seed ${seed}: too steep at ${i}`);
      lo = Math.min(lo, b.y);
      hi = Math.max(hi, b.y);
    }
    assert.ok(hi - lo > 6, `seed ${seed}: the road goes up and down (${(hi - lo).toFixed(1)} m)`);
    for (const s of r.stops) {
      for (let k = -TERRAIN.stopFlat; k <= TERRAIN.stopFlat; k++) {
        const p = r.road[Math.max(0, Math.min(r.road.length - 1, s.i + k))];
        assert.ok(Math.abs(p.y - s.y) < 0.05, `seed ${seed}: ${s.kind} not flat`);
      }
    }
    for (const p of r.road.filter((_, i) => i % 15 === 0)) assert.ok(Math.abs(groundAt(r, p.x, p.z) - p.y) < 0.05, 'the ground meets the road');
  }
  assert.deepEqual(roadHeights([0, 0, 50, 0, 0], 6, []).every((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) <= TERRAIN.maxGrade * 6 + 1e-9), true);
});

test('boys day bus: uphill slows it (a steep climb from a crawl rolls back), downhill runs it on; mud is slow and slippery', () => {
  const flat = bus(0, 0, 0, 0);
  const up = bus(0, 0, 0, 0);
  const down = bus(0, 0, 0, 0);
  run(flat, { ...NO_DRIVE, throttle: 1 }, 4);
  run(up, { ...NO_DRIVE, throttle: 1 }, 4, { grade: TERRAIN.maxGrade });
  run(down, { ...NO_DRIVE, throttle: 1 }, 4, { grade: -TERRAIN.maxGrade });
  assert.ok(up.v < flat.v && flat.v < down.v, `${up.v} < ${flat.v} < ${down.v}`);
  const roll = bus(0, 0, 0, 0);
  run(roll, NO_DRIVE, 2, { grade: TERRAIN.maxGrade });
  assert.ok(roll.v < 0, 'no gas on a hill: it rolls back');
  const coast = bus(0, 0, 0, BUS.maxSpeed);
  run(coast, { ...NO_DRIVE, throttle: 1 }, 20, { grade: -TERRAIN.maxGrade });
  assert.ok(coast.v > BUS.maxSpeed && coast.v <= BUS.maxSpeed * BUS.runaway + 1e-6, `downhill runs you on a bit, never away (${coast.v})`);
  const mud = bus(0, 0, 0, 0);
  run(mud, { ...NO_DRIVE, throttle: 1 }, 4, { mud: true });
  assert.ok(mud.v < flat.v * 0.8, `mud ${mud.v}`);
  const tm = bus(0, 0, 0, 10);
  const tf = bus(0, 0, 0, 10);
  run(tm, { ...NO_DRIVE, throttle: 0.4, steer: 1 }, 0.5, { mud: true });
  run(tf, { ...NO_DRIVE, throttle: 0.4, steer: 1 }, 0.5);
  assert.ok(Math.abs(tm.h) < Math.abs(tf.h), 'mud: the wheel barely bites');
  const dry = bus(0, 0, 0, 0);
  run(dry, { ...NO_DRIVE, throttle: 1 }, 8, { fumes: true });
  assert.ok(dry.v <= BUS.fumes + 1e-6, 'an empty tank splutters along');
});

test('boys day fuel: the tank empties as you drive (not when teleported), gas cans fill it, potholes bite once', () => {
  const r = makeRoute(13);
  const d = new Director(r, 13, 1);
  d.run.busHp = 1e9;
  const b = bus(0, -40, 0, 0);
  d.step(DT, b);
  const full = d.run.fuel;
  assert.equal(full, RUN.fuel);
  for (let k = 0; k < 100; k++) {
    b.z -= 1;
    d.step(DT, b);
  }
  assert.ok(Math.abs(full - d.run.fuel - 100 * RUN.burn) < 1e-6, `burned ${full - d.run.fuel}`);
  const left = d.run.fuel;
  b.z -= 500;
  d.step(DT, b);
  assert.equal(d.run.fuel, left, 'a jump is not driving');
  const gas = r.pickups.find((p) => p.kind === 'gas')!;
  d.run.fuel = 10;
  d.grab(gas.id);
  assert.equal(d.run.fuel, 10 + RUN.gas);
  d.run.fuel = RUN.fuel - 1;
  const gas2 = r.pickups.filter((p) => p.kind === 'gas')[1];
  d.grab(gas2.id);
  assert.equal(d.run.fuel, RUN.fuel, 'never over full');
  // Enough gas on the road to get home (if you collect it).
  const length = r.road.at(-1)!.s;
  const cans = r.pickups.filter((p) => p.kind === 'gas').length;
  assert.ok(RUN.fuel + cans * RUN.gas > length * RUN.burn * 1.3, `${cans} cans for ${length.toFixed(0)} m`);
  // A pothole: the bus at speed over it takes a hit, once.
  for (let seed = 1; seed < 40; seed++) {
    const rr = makeRoute(seed);
    const h = rr.hazards.find((x) => x.kind === 'pothole');
    if (!h) continue;
    const dd = new Director(rr, seed, 1);
    const hp = dd.run.busHp;
    const over = bus(h.x, h.z, 0, 12);
    dd.step(DT, over);
    dd.step(DT, over);
    assert.equal(dd.run.busHp, hp - HAZARD.potholeDamage);
    assert.ok(dd.fx.some((f) => f.k === 'bump'));
    assert.equal(hazardAt(rr, h.x, h.z), h);
    return;
  }
  assert.fail('no potholes in 40 maps');
});

test('boys day route: hazards stay on the road, clear of the stops, and leave a lane to get by', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = makeRoute(seed);
    assert.ok(r.hazards.length > 3, `seed ${seed}: ${r.hazards.length} hazards`);
    for (const h of r.hazards) {
      const near = roadNear(r.road, h.x, h.z);
      assert.ok(near.d < ROAD.half + 1, `seed ${seed}: a ${h.kind} off the road`);
      for (const s of r.stops) assert.ok(Math.hypot(s.x - h.x, s.z - h.z) > 30, `seed ${seed}: a ${h.kind} at the ${s.kind}`);
    }
  }
});
