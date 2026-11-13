import test from 'node:test';
import assert from 'node:assert/strict';
import { BIOME_IDS, CHECKPOINT_COUNT, JOB_IDS, PLACES, TWISTS, checkpointOf } from '../src/games/boys-day/checkpoints.ts';
import { BEACON_R, Director, packZombies, unpackZombies } from '../src/games/boys-day/director.ts';
import { readMsg, takeWheel } from '../src/games/boys-day/net.ts';
import { ANY_BOY, BOYS, castBoys } from '../src/games/boys-day/roster.ts';
import { ARENA, HAZARD, ROAD, groundAt, hazardAt, makeRoute, roadNear, solids } from '../src/games/boys-day/route.ts';
import { TERRAIN, roadHeights } from '../src/games/boys-day/terrain.ts';
import {
  BLACKJACK,
  BUS,
  BUY,
  DRIVER,
  FLAT,
  FOOT,
  GOLF,
  GUNS,
  HANG,
  HORDE,
  JOBS,
  MAX_PLAYERS,
  NO_DRIVE,
  OFF_CAB,
  REEL_SPEED,
  REPAIR,
  ROUNDS,
  RUN,
  SEED_MAX,
  SLOTS,
  STORE,
  UP,
  UPGRADES,
  WALK,
  ZOMBIE,
  atCab,
  atHatch,
  bjPay,
  bjTotal,
  buy,
  yeetSpeedOf,
  chewOf,
  canBoard,
  collideBus,
  fwdOf,
  gunsUnlocked,
  handName,
  hangAt,
  hopOff,
  hopOn,
  maxFuel,
  maxHp,
  newRun,
  newSeed,
  onBus,
  pokerCompare,
  powerOf,
  priceOf,
  reelAt,
  slotPay,
  startSpot,
  stepBus,
  stepFoot,
  sweep,
  teesOff,
  upCost,
  walk,
  walkBounds,
  wallHit,
  zSpeed,
  type Bus,
  type Drive,
  type Ground,
  type Spot,
} from '../src/games/boys-day/rules.ts';

const DT = 1 / 60;
const bus = (x = 0, z = 0, h = 0, v = 0): Bus => ({ x, z, h, v, steer: 0 });
const run = (b: Bus, d: Drive, s: number, g: Partial<Ground> = {}) => {
  for (let t = 0; t < s; t += DT) stepBus(b, d, DT, { ...FLAT, ...g });
};
const GRASS: Partial<Ground> = { onRoad: false };
/** A bus parked at a director's checkpoint. */
const parked = (d: Director) => bus(d.route.stop.x, d.route.stop.z, d.route.road[d.route.stop.i].h, 0);
/** Parks, so the checkpoint's job is on. */
const park = (d: Director) => {
  const b = parked(d);
  d.run.busHp = 1e9;
  d.step(DT, b);
  assert.equal(d.run.phase, 'stop');
  return b;
};
/** A director whose current leg has this job (drives on through gates until it does). */
function directorWith(job: string, seed = 5, crew = 1) {
  const d = new Director(seed, crew);
  for (let n = 0; n < 60 && d.route.cp.job !== job; n++) skipLeg(d);
  assert.equal(d.route.cp.job, job);
  return d;
}
function skipLeg(d: Director) {
  d.run.done = true;
  const g = d.route.road[d.route.gate.i + 1];
  d.step(DT, bus(g.x, g.z, g.h, 10));
}

test('boys day checkpoints: thousands to find, the same for every screen, never the same job or world twice running', () => {
  assert.ok(CHECKPOINT_COUNT > 1000, `${CHECKPOINT_COUNT} checkpoints`);
  const names = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (let leg = 0; leg < 80; leg++) {
      const c = checkpointOf(seed, leg);
      assert.deepEqual(c, checkpointOf(seed, leg));
      assert.ok(PLACES[c.job].includes(c.place) && BIOME_IDS.includes(c.biome) && c.twist in TWISTS);
      names.add(`${c.name} / ${c.biome}`);
      if (leg > 0) {
        const p = checkpointOf(seed, leg - 1);
        assert.notEqual(c.job, p.job, `seed ${seed} leg ${leg}: ${c.job} twice`);
        if (leg > 2) assert.notEqual(c.biome, p.biome, `seed ${seed} leg ${leg}: ${c.biome} twice`);
      }
    }
    // The story opens every run: the club, a scavenge, the casino, Gordie.
    assert.deepEqual([0, 1, 2, 3].map((l) => checkpointOf(seed, l).job), ['golf', 'scavenge', 'slots', 'holdout']);
    assert.equal(checkpointOf(seed, 3).place, 'Kingston Holding Cells');
  }
  assert.ok(names.size > 300, `${names.size} different checkpoints in 480 legs`);
  const jobs = new Set(Array.from({ length: 80 }, (_, l) => checkpointOf(9, l).job));
  assert.equal(jobs.size, JOB_IDS.length, 'every job turns up');
  assert.notDeepEqual(checkpointOf(1, 30), checkpointOf(2, 30));
});

test('boys day route: every leg is its own map, the same on every screen, longer as you go, with a checkpoint and a gate', () => {
  for (const seed of [1, 99, 12345]) {
    for (const leg of [0, 1, 2, 7, 30]) {
      const a = makeRoute(seed, leg);
      assert.deepEqual(a, makeRoute(seed, leg));
      assert.equal(a.cp.leg, leg);
      const s = a.road[a.stop.i].s;
      const min = ROAD.legMin + Math.min(leg, ROAD.legGrow) * ROAD.legPer;
      assert.ok(s >= min - ROAD.step && s <= min + ROAD.legVar + ROAD.step, `seed ${seed} leg ${leg}: ${s} m`);
      assert.ok(a.gate.i > a.stop.i && a.gate.i < a.road.length - 3, 'the gate is past the checkpoint, the road runs on through it');
      assert.ok(Math.abs(a.road[a.gate.i].s - s - ROAD.gate) < ROAD.step);
    }
    assert.notDeepEqual(makeRoute(seed, 4).road.at(-1), makeRoute(seed, 5).road.at(-1), 'each leg is a new road');
  }
});

test('boys day route: a bus can take every bend, the road never crosses itself, scenery stays off it', () => {
  for (let seed = 1; seed <= 12; seed++)
    for (const leg of [0, 3, 11]) {
      const r = makeRoute(seed, leg);
      for (let i = 1; i < r.road.length; i++) {
        assert.ok(Math.abs(r.road[i].h - r.road[i - 1].h) <= ROAD.step / ROAD.minRadius + 1e-9, `seed ${seed}: hairpin at ${i}`);
        assert.ok(r.road[i].z < r.road[i - 1].z, 'always heading on (so it never loops back over itself)');
      }
      for (const p of r.props) {
        if (p.kind === 'wreck') continue; // wrecks are meant to be in the way
        const d = roadNear(r.road, p.x, p.z).d;
        assert.ok(d >= ROAD.half, `seed ${seed}: a ${p.kind} on the road (${d.toFixed(1)} m)`);
      }
      // The parking spot is clear to park in, and to step off the bus into.
      for (const o of r.obstacles) assert.ok(Math.hypot(o.x - r.stop.x, o.z - r.stop.z) > o.r + 4, `seed ${seed} leg ${leg}: something in the parking spot`);
    }
});

test('boys day route: each job puts its things in the arena, in reach on foot, off the road', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 6; seed++)
    for (let leg = 0; leg < 14; leg++) {
      const r = makeRoute(seed, leg);
      seen.add(r.cp.job);
      const kinds = r.sites.map((s) => s.kind);
      const want = { golf: 'tee', slots: 'slot', fuel: 'pump', beacon: 'beacon', scavenge: 'crate', holdout: '' }[r.cp.job];
      if (want) assert.ok(kinds.every((k) => k === want) && kinds.length >= 1, `${r.cp.job}: ${kinds}`);
      else assert.equal(kinds.length, 0);
      if (r.cp.job === 'scavenge') {
        assert.equal(kinds.length, ARENA.crates);
        assert.ok(ARENA.crates >= JOBS.scavenge.need(MAX_PLAYERS, 99), 'enough crates for a full bus, however far in');
      }
      r.sites.forEach((s, i) => {
        assert.equal(s.id, i);
        assert.ok(Math.hypot(s.x - r.stop.x, s.z - r.stop.z) < FOOT.leash - 2, `${s.kind} out of reach`);
        assert.ok(roadNear(r.road, s.x, s.z).d > ROAD.half, `${s.kind} on the road`);
      });
    }
  assert.equal(seen.size, JOB_IDS.length);
});

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

test('boys day: an autopilot bus drives every kind of leg to its gate without leaving the road', () => {
  for (let n = 0; n < 14; n++) {
    const seed = 1 + (n % 4);
    const r = makeRoute(seed, n * 2);
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
    assert.ok(hint >= r.road.length - 14, `seed ${seed} leg ${n * 2} (${r.cp.biome}): only got to ${hint}/${r.road.length}`);
    assert.ok(worst < ROAD.half, `seed ${seed} leg ${n * 2} (${r.cp.biome}): strayed ${worst.toFixed(1)} m off the centre line`);
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

test('boys day bus: the engine upgrade pulls harder and tops out higher; upgrades change the numbers they say', () => {
  const stock = bus();
  const swapped = bus();
  const r = newRun(1);
  r.up[UP.engine] = 3;
  run(stock, { ...NO_DRIVE, throttle: 1 }, 3);
  run(swapped, { ...NO_DRIVE, throttle: 1 }, 3, { power: powerOf(r) });
  assert.ok(swapped.v > stock.v * 1.1, `${swapped.v} vs ${stock.v}`);
  run(swapped, { ...NO_DRIVE, throttle: 1 }, 30, { power: powerOf(r) });
  assert.ok(Math.abs(swapped.v - BUS.maxSpeed * powerOf(r)) < 0.5);
  r.up[UP.armor] = 2;
  r.up[UP.tank] = 1;
  assert.equal(maxHp(r), BUS.hp + 500);
  assert.equal(maxFuel(r), RUN.fuel + 25);
});

test('boys day store: your own scrap buys bus upgrades (dearer each level, up to a cap), repairs, grenades and bandages', () => {
  const r = newRun(1, 2);
  assert.deepEqual(r.cash.slice(0, 3), [RUN.startScrap, RUN.startScrap, 0]);
  assert.equal(buy(r, UP.armor, 0), false, 'can’t afford it yet');
  r.cash[0] = 1000;
  r.busHp = 400;
  assert.equal(buy(r, UP.armor, 0), true);
  assert.equal(r.cash[0], 1000 - UPGRADES[UP.armor].cost);
  assert.equal(r.cash[1], RUN.startScrap, 'out of the buyer’s pocket only');
  assert.equal(r.busHp, maxHp(r), 'new armour fills the bus');
  assert.equal(priceOf(r, UP.armor), upCost(UP.armor, 1));
  assert.ok(upCost(UP.armor, 1) > upCost(UP.armor, 0));
  assert.equal(priceOf(r, BUY.repair), Infinity, 'nothing to repair');
  assert.equal(buy(r, BUY.repair, 0), false);
  r.busHp = 100;
  assert.equal(buy(r, BUY.repair, 0), true);
  assert.equal(r.busHp, 100 + REPAIR.hp);
  r.cash[1] = STORE.nade + STORE.bandage;
  assert.equal(buy(r, BUY.nade, 1) && buy(r, BUY.bandage, 1), true);
  assert.equal(r.cash[1], 0);
  assert.equal(buy(r, BUY.nade, 1), false);
  r.cash[0] = 1e6;
  for (let k = 0; k < 20; k++) buy(r, UP.plow, 0);
  assert.equal(r.up[UP.plow], UPGRADES[UP.plow].max, 'capped');
  assert.equal(buy(r, 99, 0), false);
  assert.equal(buy(r, UP.engine, 7), false, 'nobody in that seat has scrap');
});

test('boys day guns: the crew unlocks them by clearing checkpoints; the host only credits a gun you have', () => {
  assert.equal(gunsUnlocked(0), 1);
  assert.equal(GUNS[0].unlock, 0);
  for (let i = 1; i < GUNS.length; i++) {
    assert.ok(GUNS[i].unlock > GUNS[i - 1].unlock);
    assert.equal(gunsUnlocked(GUNS[i].unlock), i + 1);
    assert.equal(gunsUnlocked(GUNS[i].unlock - 1), i);
  }
  assert.ok(GUNS.some((g) => g.pellets > 4), 'a shotgun');
  assert.ok(GUNS.some((g) => g.splash > 0), 'something that bursts');
  const d = new Director(3);
  const tom = GUNS.findIndex((g) => g.damage > 4);
  assert.equal(d.damageOf(tom), 1, 'not unlocked: a plain hit');
  d.run.stage = GUNS[tom].unlock;
  assert.equal(d.damageOf(tom), GUNS[tom].damage);
  assert.ok(d.damageOf(-1) > 1, 'a grenade');
  // Clearing the checkpoint that unlocks a gun says so.
  const e = new Director(3);
  e.run.stage = GUNS[1].unlock - 1;
  park(e);
  e.said = [];
  e.run.prog = e.run.need;
  e.step(DT, parked(e));
  assert.ok(e.said.some((s) => s.includes(GUNS[1].name.toUpperCase())), e.said.join(' | '));
});

test('boys day on foot: you walk the ground, round obstacles and the bus, on a leash from the checkpoint; hop off and back on', () => {
  const b = bus(0, 0, 0, 0);
  const centre = { x: 0, z: 0 };
  const p = { x: 10, z: 0 };
  stepFoot(p, 1, 0, 0, 1, [], b, centre);
  assert.ok(Math.abs(p.z + FOOT.speed) < 1e-9 && p.x === 10, 'W walks the way you look (yaw 0: −Z)');
  const q = { x: 10, z: 0 };
  stepFoot(q, 0, 1, 0, 1, [], b, centre);
  assert.ok(Math.abs(q.x - 10 - FOOT.speed) < 1e-9, 'D strafes right');
  const dg = { x: 10, z: 0 };
  stepFoot(dg, 1, 1, 0, 1, [], b, centre);
  assert.ok(Math.hypot(dg.x - 10, dg.z) <= FOOT.speed + 1e-9, 'no faster on the diagonal');
  const slow = { x: 10, z: 0 };
  stepFoot(slow, 1, 0, 0, 1, [], b, centre, FOOT.carry);
  assert.ok(Math.abs(slow.z + FOOT.speed * FOOT.carry) < 1e-9, 'lugging a can is slower');
  // Into a tree: stopped at its edge. Into the bus: out through its side.
  const tree = { x: 10, z: -3, r: 1 };
  const w = { x: 10, z: 0 };
  for (let k = 0; k < 60; k++) stepFoot(w, 1, 0, 0, DT, [tree], b, centre);
  assert.ok(Math.hypot(w.x - tree.x, w.z - tree.z) >= tree.r + FOOT.r - 1e-6);
  const in1 = { x: 3, z: 0 };
  for (let k = 0; k < 120; k++) stepFoot(in1, 1, 0, Math.PI / 2, DT, [], b, centre);
  assert.ok(!onBus(b, in1.x, in1.z, FOOT.r - 0.01), 'never inside the bus');
  assert.ok(in1.x > 0, 'stopped at the side you came from');
  const far = { x: 0, z: 30 };
  for (let k = 0; k < 600; k++) stepFoot(far, -1, 0, 0, DT, [], b, centre);
  assert.ok(Math.abs(Math.hypot(far.x, far.z) - FOOT.leash) < 1e-6, 'the leash');
  // Off the bus you land just outside it, on your side; back aboard from anywhere along its side.
  const off = hopOff(b, { side: 0.5, along: 2, level: 0 });
  assert.ok(!onBus(b, off.x, off.z, FOOT.r) && off.x > 0 && canBoard(b, off.x, off.z));
  assert.ok(hopOff(b, { side: -0.5, along: 2, level: 0 }).x < 0);
  assert.ok(!canBoard(b, 20, 0));
  const on: Spot = hopOn(b, off.x, off.z);
  const wb = walkBounds(0);
  assert.ok(on.level === 0 && Math.abs(on.side) <= wb.side && on.along >= wb.back && on.along <= wb.front);
});

test('boys day run: park at the checkpoint, do its job, the gate opens; through it is the next leg, a new map', () => {
  const d = new Director(7, 2);
  assert.equal(d.run.stage, 0);
  assert.equal(d.run.need, JOBS.golf.need(2, 0));
  const first = d.route;
  // The gate's shut until the job's done: driving at it does nothing but dent the bus.
  const g = d.route.road[d.route.gate.i + 1];
  d.step(DT, bus(g.x, g.z, g.h, 10));
  assert.equal(d.run.stage, 0);
  assert.ok(solids(d.route, false).length > solids(d.route, true).length, 'the bars are solid while it’s shut');
  const at = bus(d.route.gate.x, d.route.gate.z, d.route.gate.h, 8);
  assert.ok(collideBus(at, solids(d.route, false)) > 0);
  assert.equal(collideBus(bus(d.route.gate.x, d.route.gate.z, d.route.gate.h, 8), solids(d.route, true)), 0, 'and gone once it’s open');
  // Nothing counts while driving.
  d.mini('golf', 1, 0);
  assert.equal(d.run.prog, 0);
  const b = park(d);
  d.run.busHp = 500;
  d.mini('slots', 100, 0);
  assert.equal(d.run.prog, 0, 'wrong game for this checkpoint');
  const cash = d.run.cash[0];
  for (let k = 0; k < d.run.need; k++) d.mini('golf', 1, 0);
  assert.equal(d.run.busHp, 500 + d.run.need * RUN.teeHeal, 'every tee-off patches the bus');
  d.step(DT, b);
  assert.equal(d.run.done, true);
  assert.equal(d.run.club, true, 'the first golf checkpoint wins the club');
  assert.equal(d.run.cash[0], cash + RUN.clear);
  assert.equal(d.run.cash[1], cash + RUN.clear, 'everyone pockets the clear bonus');
  assert.equal(d.run.cash[2], 0, 'nobody in that seat');
  assert.ok(d.fx.some((f) => f.k === 'clear'));
  d.add(5, 5);
  d.step(DT, bus(g.x, g.z, g.h, 10));
  assert.equal(d.run.stage, 1);
  assert.notEqual(d.route, first);
  assert.equal(d.route.leg, 1);
  assert.deepEqual([d.run.done, d.run.prog, d.run.phase, d.zs.length], [false, 0, 'drive', 0]);
  assert.equal(d.run.need, JOBS[d.route.cp.job].need(2, 1));
  assert.ok(d.fx.some((f) => f.k === 'leg' && f.n === 1));
  assert.ok(d.run.calm >= RUN.legCalm, 'a breather at the start of a leg');
});

test('boys day jobs: crates once each, jerry cans fill the tank, the beacon needs someone in its ring, a hold-out counts kills', () => {
  const s = directorWith('scavenge', 5, 2);
  s.did('crate', 0, 1);
  assert.equal(s.run.prog, 0, 'not parked yet');
  park(s);
  const cash = [...s.run.cash];
  s.did('crate', 0, 1);
  s.did('crate', 0, 1);
  assert.equal(s.run.prog, 1, 'a crate only counts once');
  assert.ok(s.got.has(0));
  assert.equal(s.run.cash[0], cash[0] + Math.round(RUN.crate * TWISTS[s.route.cp.twist].pay));
  assert.equal(s.run.cash[1], s.run.cash[0]);
  s.did('crate', 999, 0);
  s.did('can', 0, 0);
  assert.equal(s.run.prog, 1, 'no such crate; wrong job');
  for (let k = 1; k < s.run.need; k++) s.did('crate', k, 0);
  s.step(DT, parked(s));
  assert.ok(s.run.done);

  const f = directorWith('fuel');
  const fb = park(f);
  f.run.fuel = 10;
  f.did('can', 0, 0);
  assert.equal(f.run.fuel, 10 + RUN.jerry);
  assert.equal(f.run.prog, 1);
  for (let k = 1; k < f.run.need; k++) f.did('can', 0, 0);
  f.step(DT, fb);
  assert.ok(f.run.done && f.run.fuel <= maxFuel(f.run));

  const bc = directorWith('beacon');
  const bb = park(bc);
  const site = bc.route.sites[0];
  for (let t = 0; t < 2; t += DT) bc.step(DT, bb, []);
  assert.equal(bc.run.prog, 0, 'nobody at the beacon');
  for (let t = 0; t < 2; t += DT) bc.step(DT, bb, [{ id: 4, x: site.x + BEACON_R + 3, z: site.z }]);
  assert.equal(bc.run.prog, 0, 'not close enough');
  for (let t = 0; t < 2; t += DT) bc.step(DT, bb, [{ id: 4, x: site.x + 1, z: site.z }]);
  assert.ok(Math.abs(bc.run.prog - 2) < 0.05, `${bc.run.prog}`);
  assert.ok(bc.run.round >= 1, 'a siege: no calm while the beacon’s being cranked');

  const h = directorWith('holdout');
  assert.equal(h.route.cp.place, 'Kingston Holding Cells');
  const z0 = h.add(40, 40, 0);
  for (let k = 0; k < 3; k++) h.hit(z0.id, 0);
  assert.equal(h.run.prog, 0, 'kills on the road don’t count');
  const hb = park(h);
  for (let k = 0; k < h.run.need; k++) {
    const z = h.add(hb.x + 30, hb.z, 0);
    for (let n = 0; n < 3; n++) h.hit(z.id, 0);
  }
  h.step(DT, hb);
  assert.ok(h.run.done && h.run.gordie, 'the hold-out at the cells springs Gordie');
});

test('boys day run: getting knocked out costs you (not the others) some scrap; leaving and coming back keeps the job’s progress', () => {
  const d = directorWith('scavenge', 5, 2);
  d.run.cash[0] = 200;
  d.run.cash[1] = 100;
  d.did('ko', 0, 0);
  assert.equal(d.run.cash[0], 200 - 200 * RUN.koLoss);
  assert.equal(d.run.cash[1], 100);
  const b = park(d);
  d.did('crate', 2, 0);
  d.step(DT, bus(b.x, b.z - 60, b.h, 0));
  assert.equal(d.run.phase, 'drive');
  assert.equal(d.run.prog, 1);
  d.step(DT, b);
  assert.equal(d.run.phase, 'stop');
});

test('boys day zombies: on foot they come for you (not the bus) and bite; the bus at speed yeets them; slow, they climb on', () => {
  const d = new Director(3);
  d.run.calm = 999;
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
  // Someone on foot 20 m from the bus: a zombie beside them goes for them and bites, again and again.
  const e = new Director(3);
  e.run.calm = 999;
  const me = { id: 42, x: 25, z: -200 };
  const hunter = e.add(33, -200, 0);
  const busHp = e.run.busHp;
  for (let t = 0; t < 4; t += DT) e.step(DT, slow, [me]);
  assert.ok(Math.hypot(hunter.x - me.x, hunter.z - me.z) < 1.5, 'it came for the walker');
  const bites = e.fx.filter((f) => f.k === 'bite');
  assert.ok(bites.length >= 2 && bites.length <= 4, `${bites.length} bites in ~3 s`);
  assert.deepEqual([bites[0].w, bites[0].n], [42, ZOMBIE[0].bite]);
  assert.equal(e.run.busHp, busHp, 'and left the bus alone');
  // With nobody near, it goes for the bus.
  const lone = e.add(60, -200, 0);
  for (let t = 0; t < 1; t += DT) e.step(DT, slow, [{ id: 42, x: -80, z: -200 }]);
  assert.ok(lone.x < 60 - 3, 'heading for the bus');
  assert.ok(zSpeed(20) > zSpeed(0) && zSpeed(999) < 1.5, 'they get faster the further you go, to a point');
});

test('boys day zombies: paintballs kill; bigger guns hit harder; the club works from the bus or on foot, in reach', () => {
  const d = new Director(4);
  const b = bus(0, -300, 0, 0);
  d.lastBus = b;
  const z = d.add(30, -300, 0);
  for (let k = 0; k < 3; k++) d.hit(z.id, 1);
  assert.equal(z.hp, 0);
  assert.equal(d.run.kills, 1);
  const chonk = d.add(30, -310, 2);
  d.hit(chonk.id, 1, 8);
  assert.equal(chonk.st, 'fly', 'a big hit pops a chonk in one');
  const near = d.add(BUS.width / 2 + 2, -300, 0);
  const far = d.add(40, -300, 0);
  assert.equal(d.swing([near.id], 1, b), 0, 'no club yet');
  d.run.club = true;
  assert.equal(d.swing([near.id, far.id], 1, b), 1, 'only the one in reach');
  assert.equal(near.st, 'fly');
  assert.ok(near.vx > 0, 'teed off away from the bus');
  assert.ok(d.fx.some((f) => f.k === 'fore'));
  const byMe = d.add(52, -300, 0);
  assert.equal(d.swing([byMe.id], 1, b, { x: 50, z: -300 }), 1, 'on foot: in reach of you');
  assert.equal(d.swing([far.id], 1, b, { x: 80, z: -300 }), 0);
});

test('boys day: the bus dies at 0 hp and that ends the run; pickups pay everyone once', () => {
  let d = new Director(8, 3);
  for (let seed = 9; !d.route.pickups.some((q) => q.kind === 'scrap'); seed++) d = new Director(seed, 3);
  const p = d.route.pickups.find((q) => q.kind === 'scrap')!;
  d.grab(p.id);
  d.grab(p.id);
  assert.deepEqual(d.run.cash.slice(0, 4), [RUN.startScrap + RUN.scrap, RUN.startScrap + RUN.scrap, RUN.startScrap + RUN.scrap, 0]);
  d.run.busHp = 1;
  d.run.calm = 999;
  const b = bus(0, -100, 0, 0);
  for (let k = 0; k < 4; k++) d.add(BUS.width / 2 + 0.2, -100 + k, 2);
  for (let t = 0; t < 3 && d.run.phase !== 'lost'; t += DT) d.step(DT, b);
  assert.equal(d.run.phase, 'lost');
  const time = d.run.time;
  d.step(1, b);
  assert.equal(d.run.time, time, 'the clock stops with the bus');
});

test('boys day rounds: a calm, then a round; kill them all for the next calm; they grow with the round, the leg and the crew, without end', () => {
  const d = new Director(9, 1);
  const b = bus(0, -50, 0, 0);
  d.run.busHp = 1e9;
  const live = () => d.zs.filter((z) => z.st === 'run' || z.st === 'climb');
  for (let t = 0; t < ROUNDS.first - 0.5; t += 0.1) d.step(0.1, b);
  assert.equal(live().length, 0, 'nothing before the first round');
  assert.equal(d.run.round, 0);
  for (let t = 0; t < 1; t += 0.1) d.step(0.1, b);
  assert.equal(d.run.round, 1);
  const size = Math.round(ROUNDS.size(1, 1) * TWISTS[d.route.cp.twist].horde);
  assert.equal(d.run.left, size, 'the HUD counts the whole round');
  let most = 0;
  const seen = new Set<number>();
  for (let t = 0, k = 0; t < 120 && d.run.calm === 0; t += 0.1, k++) {
    d.step(0.1, b);
    for (const z of d.zs) seen.add(z.id);
    most = Math.max(most, live().length);
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
  assert.ok(ROUNDS.size(60, 4) > ROUNDS.size(30, 4) * 1.5, 'no ceiling: eventually they are too many');
  assert.equal(HORDE.crewScale(1), 0.5);
  for (let n = 2; n <= 8; n++) assert.ok(HORDE.crewScale(n) > HORDE.crewScale(n - 1));
});

test('boys day: zombies round-trip through the wire format', () => {
  const d = new Director(10);
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

test('boys day cards: blackjack totals and pays; poker hands rank and break ties', () => {
  const c = (rank: number, suit = 0) => suit * 13 + rank; // rank 0 = a two … 8 = a ten, 9 J, 10 Q, 11 K, 12 A
  assert.equal(bjTotal([c(12), c(11)]), 21);
  assert.equal(bjTotal([c(12), c(12, 1), c(7)]), 21, 'aces drop to 1 as needed');
  assert.equal(bjTotal([c(8), c(9), c(3)]), 25);
  assert.equal(bjPay([c(12), c(11)], [c(8), c(7)], 10), 10 * BLACKJACK.natural);
  assert.equal(bjPay([c(12), c(11)], [c(12, 1), c(10)], 10), 0, 'two naturals push');
  assert.equal(bjPay([c(8), c(9), c(3)], [c(8), c(4), c(10)], 10), -10, 'a bust loses even if the dealer busts');
  assert.equal(bjPay([c(8), c(7)], [c(8), c(4), c(10)], 25), 25, 'dealer busts');
  assert.equal(bjPay([c(8), c(7)], [c(8), c(6)], 25), 25);
  assert.equal(bjPay([c(8), c(5)], [c(8), c(6)], 25), -25);
  assert.equal(bjPay([c(8), c(6)], [c(8, 1), c(6, 1)], 25), 0);
  assert.equal(bjPay([c(3), c(4), c(12), c(1)], [c(12), c(11)], 10), -10, 'a made 21 loses to a natural');
  const hands: [string, number[]][] = [
    ['High card', [c(0), c(2), c(4), c(6), c(9, 1)]],
    ['Pair', [c(3), c(3, 1), c(4), c(6), c(9)]],
    ['Two pair', [c(3), c(3, 1), c(4), c(4, 1), c(9)]],
    ['Three of a kind', [c(3), c(3, 1), c(3, 2), c(4, 1), c(9)]],
    ['Straight', [c(12), c(0, 1), c(1), c(2), c(3)]],
    ['Flush', [c(0), c(2), c(4), c(6), c(9)]],
    ['Full house', [c(3), c(3, 1), c(3, 2), c(9, 1), c(9)]],
    ['Four of a kind', [c(3), c(3, 1), c(3, 2), c(3, 3), c(9)]],
    ['Straight flush', [c(4), c(5), c(6), c(7), c(8)]],
  ];
  hands.forEach(([name, h], i) => {
    assert.equal(handName(h), name);
    if (i) assert.ok(pokerCompare(h, hands[i - 1][1]) > 0, `${name} beats ${hands[i - 1][0]}`);
  });
  assert.ok(pokerCompare([c(9), c(9, 1), c(2), c(3), c(5)], [c(8), c(8, 1), c(12), c(11), c(10)]) > 0, 'jacks beat tens');
  assert.ok(pokerCompare([c(9), c(9, 1), c(12), c(3), c(5)], [c(9, 2), c(9, 3), c(11), c(10), c(8)]) > 0, 'the kicker');
  assert.ok(pokerCompare([c(12), c(0, 1), c(1), c(2), c(3)], [c(0), c(1, 1), c(2), c(3), c(4)]) < 0, 'the wheel is the lowest straight');
  assert.equal(pokerCompare([c(9), c(9, 1), c(2), c(3), c(5)], [c(9, 2), c(9, 3), c(2, 1), c(3, 1), c(5, 1)]), 0);
});

test('boys day hanging out: the bong, the cooler and the card table are in reach inside the bus, not on the roof', () => {
  const wb = walkBounds(0);
  for (const k of ['bong', 'cooler', 'table'] as const) {
    const s = HANG[k];
    const near: Spot = { side: Math.max(-wb.side, Math.min(wb.side, s.side)), along: Math.max(wb.back, Math.min(wb.front, s.along)), level: 0 };
    assert.equal(hangAt(near), k, `you can stand at the ${k}`);
    assert.equal(hangAt({ ...near, level: 1 }), null);
  }
  assert.equal(hangAt(OFF_CAB), null);
  assert.equal(hangAt(startSpot(0)), null);
});

test('boys day net: every seed the host can roll gets through to the joiners (start and run state)', () => {
  const seeds = [0, 1, 999_999_999, 1_000_000_000, 1_000_000_001, 2 ** 30, SEED_MAX - 1];
  for (let k = 0; k < 200; k++) seeds.push(newSeed());
  for (const s of seeds) {
    assert.ok(Number.isInteger(s) && s >= 0 && s < SEED_MAX, `seed ${s} in range`);
    assert.deepEqual(readMsg({ t: 'start', seed: s, driver: 2, boys: [0, 3] }), { t: 'start', seed: s, driver: 2, boys: [0, 3] }, `start, seed ${s}`);
    const r = { ...newRun(s, 3), stage: 250, round: 400 };
    const m = readMsg(JSON.parse(JSON.stringify({ t: 'run', run: r, taken: [1, 2], got: [0] })));
    assert.deepEqual(m, { t: 'run', run: r, taken: [1, 2], got: [0] }, `run, seed ${s}`);
  }
  assert.equal(readMsg({ t: 'start', seed: SEED_MAX, driver: 0, boys: [] }), null);
  assert.equal(readMsg({ t: 'start', seed: -1, driver: 0, boys: [] }), null);
  assert.equal(readMsg({ t: 'start', seed: 1.5, driver: 0, boys: [] }), null);
});

test('boys day net: junk is dropped; the wheel is first come; spots are on the bus or out on the map', () => {
  assert.equal(readMsg(null), null);
  assert.equal(readMsg({ t: 'nope' }), null);
  assert.equal(readMsg({ t: 'bus', x: 'a', z: 0, h: 0, v: 0, s: 0, l: 0 }), null);
  assert.equal(readMsg({ t: 'bus', x: 0, z: 0, h: 0, v: 999, s: 0, l: 0 }), null);
  assert.equal(readMsg({ t: 'bus', x: 0, z: 0, h: 0, v: 9, s: 0 }), null, 'which leg?');
  const act = { t: 'act', c: 0, shots: [], hits: new Array(99).fill(1), grabs: [], swing: [], g: 0, boom: [] };
  assert.equal(readMsg(act), null);
  assert.ok(readMsg({ ...act, hits: [3], boom: [4, 5], g: 2 }));
  assert.equal(readMsg({ ...act, hits: [3], g: 0.5 }), null);
  const r = newRun(1);
  assert.equal(readMsg({ t: 'run', run: { ...r, phase: 'party' }, taken: [], got: [] }), null);
  assert.equal(readMsg({ t: 'run', run: { ...r, cash: [1, 2] }, taken: [], got: [] }), null);
  assert.equal(readMsg({ t: 'run', run: { ...r, up: r.up.map(() => 99) }, taken: [], got: [] }), null);
  assert.equal(readMsg({ t: 'z', z: [1, 2, 3], fx: [], said: [] }), null);
  assert.ok(readMsg({ t: 'z', z: [], fx: [{ k: 'bite', x: 1, y: 1, z: 1, n: 12, w: 3 }], said: ['hi'] }));
  assert.equal(readMsg({ t: 'z', z: [], fx: [{ k: 'bite', x: 1, y: 1, z: 1, n: 12, w: 'me' }], said: [] }), null);
  assert.equal(takeWheel(1, 2, true), 1, 'someone’s driving');
  assert.equal(takeWheel(1, 2, false), 1, 'only the driver can get up');
  assert.equal(takeWheel(1, 1, false), -1, 'the driver gets up');
  assert.equal(takeWheel(-1, 3, true), 3, 'and someone else takes the wheel');
  assert.deepEqual(readMsg({ t: 'driver', id: -1 }), { t: 'driver', id: -1 }, 'nobody driving');
  assert.deepEqual(readMsg({ t: 'drive', want: true }), { t: 'drive', want: true });
  assert.equal(readMsg({ t: 'drive', want: 1 }), null);
  const aim = { t: 'aim', yaw: 1, pitch: 0.2, s: 0.5, a: -3, l: 1 };
  assert.deepEqual(readMsg(aim), aim);
  assert.equal(readMsg({ ...aim, l: 3 }), null);
  assert.equal(readMsg({ ...aim, a: 99 }), null, 'off the end of the bus');
  assert.deepEqual(readMsg({ ...aim, l: 2, s: 420.5, a: -1300, c: true }), { ...aim, l: 2, s: 420.5, a: -1300, c: true }, 'on foot: anywhere on the map');
  assert.deepEqual(readMsg({ t: 'do', k: 'crate', id: 3 }), { t: 'do', k: 'crate', id: 3 });
  assert.equal(readMsg({ t: 'do', k: 'steal', id: 3 }), null);
  assert.deepEqual(readMsg({ t: 'buy', k: BUY.bandage }), { t: 'buy', k: BUY.bandage });
  assert.equal(readMsg({ t: 'buy', k: BUY.bandage + 1 }), null);
  assert.deepEqual(readMsg({ t: 'bj', v: -100 }), { t: 'bj', v: -100 });
  assert.equal(readMsg({ t: 'bj', v: 5000 }), null);
  assert.deepEqual(readMsg({ t: 'poker', m: 'raise', n: 0 }), { t: 'poker', m: 'raise', n: 0 });
  assert.equal(readMsg({ t: 'poker', m: 'cheat', n: 0 }), null);
  assert.deepEqual(readMsg({ t: 'hand', cards: [0, 51] }), { t: 'hand', cards: [0, 51] }, 'two hole cards');
  assert.equal(readMsg({ t: 'hand', cards: [0, 52] }), null);
  assert.equal(readMsg({ t: 'hand', cards: [0, 1, 2] }), null, 'nobody holds three');
  assert.deepEqual(readMsg({ t: 'mini', k: 'slots', v: 120 }), { t: 'mini', k: 'slots', v: 120 });
});

test('boys day: the host holds gambling to the table’s limits', () => {
  const d = new Director(1, 2);
  d.run.cash[0] = 30;
  d.blackjack(99999, 0);
  assert.equal(d.run.cash[0], 30 + BLACKJACK.bets.at(-1)! * 2);
  d.blackjack(-99999, 0);
  d.blackjack(-99999, 0);
  assert.equal(d.run.cash[0], 0, 'never below nothing');
  d.blackjack(50, 5);
  assert.equal(d.run.cash[5], 0, 'nobody in that seat');
});

test('boys day: driving over a pickup collects it; a repair kit says what it fixed', () => {
  const d = new Director(12);
  d.run.calm = 999;
  const kit = d.route.pickups.find((p) => p.kind === 'repair')!;
  d.run.busHp = 600;
  d.step(DT, bus(kit.x, kit.z, 0, 10));
  assert.ok(d.taken.has(kit.id), 'collected by driving over it');
  assert.equal(d.run.busHp, 600 + RUN.repair);
  assert.ok(d.fx.some((f) => f.k === 'heal' && f.n === RUN.repair));
  const pile = d.route.pickups.find((p) => p.kind === 'scrap')!;
  const had = d.run.cash[0];
  d.step(DT, bus(pile.x + BUS.width / 2 + 1.5, pile.z, 0, 10));
  assert.ok(!d.taken.has(pile.id), 'a couple of metres off to the side misses it');
  d.step(DT, bus(pile.x, pile.z, 0, 10));
  assert.equal(d.run.cash[0], had + RUN.scrap);
  // A kit picked up on a full bus fixes nothing, and the popup says so.
  const d2 = new Director(12);
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

test('boys day terrain: hills you can see, a road a bus can climb, flat where you park, a walkable arena, ground meeting the road', () => {
  let rolling = 0;
  for (const [seed, leg] of [[1, 0], [7, 1], [42, 5], [9001, 12], [3, 20]]) {
    const r = makeRoute(seed, leg);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < r.road.length; i++) {
      const a = r.road[i - 1];
      const b = r.road[i];
      assert.ok(Math.abs(b.y - a.y) <= TERRAIN.maxGrade * (b.s - a.s) + 0.01, `seed ${seed}: too steep at ${i}`);
      lo = Math.min(lo, b.y);
      hi = Math.max(hi, b.y);
    }
    if (hi - lo > 5) rolling++;
    for (let k = -TERRAIN.stopFlat; k <= TERRAIN.stopFlat; k++) assert.ok(Math.abs(r.road[r.stop.i + k].y - r.stop.y) < 0.05, `seed ${seed}: the checkpoint isn't flat`);
    for (const p of r.road.filter((_, i) => i % 15 === 0)) assert.ok(Math.abs(groundAt(r, p.x, p.z) - p.y) < 0.05, 'the ground meets the road');
    // The arena: no step you'd need to climb between any two points a couple of metres apart.
    for (let a = 0; a < 6.28; a += 0.4)
      for (let d = 4; d < ARENA.flat; d += 6) {
        const x = r.stop.x + Math.cos(a) * d;
        const z = r.stop.z + Math.sin(a) * d;
        assert.ok(Math.abs(groundAt(r, x + 2, z) - groundAt(r, x, z)) < 1.2, `seed ${seed} leg ${leg}: a cliff in the arena`);
      }
  }
  assert.ok(rolling >= 3, 'most legs go up and down');
  assert.deepEqual(roadHeights([0, 0, 50, 0, 0], 6, []).every((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) <= TERRAIN.maxGrade * 6 + 1e-9), true);
});

test('boys day fuel: the tank empties as you drive (not when teleported), gas cans fill it, potholes bite once; loot thins out down the road', () => {
  const d = new Director(13, 1);
  const r = d.route;
  d.run.busHp = 1e9;
  d.run.calm = 999;
  const b = bus(0, -40, 0, 0);
  d.step(DT, b);
  const full = d.run.fuel;
  assert.equal(full, RUN.fuel);
  for (let k = 0; k < 100; k++) {
    b.z -= 1;
    d.step(DT, b);
  }
  assert.ok(Math.abs(full - d.run.fuel - 100 * RUN.burn) < 1e-6, `burned ${full - d.run.fuel}`);
  assert.ok(Math.abs(d.run.dist - 100) < 1e-6);
  const left = d.run.fuel;
  b.z -= 300;
  d.step(DT, b);
  assert.equal(d.run.fuel, left, 'a jump is not driving');
  const gas = r.pickups.find((p) => p.kind === 'gas')!;
  d.run.fuel = 10;
  d.grab(gas.id);
  assert.equal(d.run.fuel, 10 + RUN.gas);
  const count = (leg: number) => [1, 2, 3, 4, 5, 6].reduce((n, s) => n + makeRoute(s, leg).pickups.length / (makeRoute(s, leg).road.length * ROAD.step), 0);
  assert.ok(count(20) < count(0) * 0.75, 'fewer pickups a kilometre, twenty legs in');
  for (let seed = 1; seed < 40; seed++) {
    const rr = new Director(seed);
    const h = rr.route.hazards.find((x) => x.kind === 'pothole');
    if (!h) continue;
    rr.run.calm = 999;
    const hp = rr.run.busHp;
    const over = bus(h.x, h.z, 0, 12);
    rr.step(DT, over);
    rr.step(DT, over);
    assert.equal(rr.run.busHp, hp - HAZARD.potholeDamage);
    assert.ok(rr.fx.some((f) => f.k === 'bump'));
    assert.equal(hazardAt(rr.route, h.x, h.z), h);
    return;
  }
  assert.fail('no potholes in 40 maps');
});

test('boys day route: hazards stay on the road, clear of the checkpoint, and leave a lane to get by', () => {
  for (let seed = 1; seed <= 12; seed++)
    for (const leg of [0, 6, 18]) {
      const r = makeRoute(seed, leg);
      for (const h of r.hazards) {
        assert.ok(roadNear(r.road, h.x, h.z).d < ROAD.half + 1, `seed ${seed}: a ${h.kind} off the road`);
        assert.ok(Math.hypot(r.stop.x - h.x, r.stop.z - h.z) > 30, `seed ${seed}: a ${h.kind} at the checkpoint`);
      }
    }
  const n = (leg: number) => [1, 2, 3, 4, 5, 6].reduce((k, s) => k + makeRoute(s, leg).hazards.length / makeRoute(s, leg).road.length, 0);
  assert.ok(n(15) > n(0), 'the road gets meaner');
});

test('everyone gets their pick, and the undecided get somebody nobody picked', () => {
  let k = 0;
  const rand = () => (k++ * 0.37) % 1;
  const cast = castBoys([2, undefined, ANY_BOY, 2, undefined], rand);
  assert.equal(cast.length, 5);
  assert.equal(cast[0], 2);
  assert.equal(cast[3], 2, 'two players may be the same boy');
  const others = [cast[1], cast[2], cast[4]];
  assert.equal(new Set(others).size, 3, 'no doubles among the random ones');
  for (const b of others) assert.ok(b >= 0 && b < BOYS.length && b !== 2);
  // More players than boys: everyone still gets someone.
  for (const b of castBoys(new Array(BOYS.length + 3).fill(undefined), Math.random)) assert.ok(b >= 0 && b < BOYS.length);
  assert.deepEqual(BOYS.map((b) => b.name), ['Shota', 'Garrett', 'Nash', 'Jung', 'Dev', 'Angus', 'Michael']);
});

test('the wire only takes real boys', () => {
  assert.deepEqual(readMsg({ t: 'pick', b: ANY_BOY }), { t: 'pick', b: ANY_BOY });
  assert.deepEqual(readMsg({ t: 'pick', b: BOYS.length - 1 }), { t: 'pick', b: BOYS.length - 1 });
  assert.equal(readMsg({ t: 'pick', b: BOYS.length }), null);
  assert.equal(readMsg({ t: 'start', seed: 1, driver: 0, boys: [ANY_BOY] }), null, 'a run starts with everyone cast');
  assert.equal(readMsg({ t: 'start', seed: 1, driver: 0 }), null);
});

test('pitchforks slow the chewing, the snow plow lowers the speed that yeets', () => {
  const r = newRun(1, 1);
  assert.equal(chewOf(r), 1);
  const yeet = yeetSpeedOf(r);
  r.cash[0] = 9999;
  assert.ok(buy(r, UP.forks, 0));
  assert.ok(chewOf(r) < 1);
  assert.equal(yeetSpeedOf(r), yeet, 'forks leave the plow alone');
  while (buy(r, UP.plow, 0));
  assert.ok(yeetSpeedOf(r) < yeet && yeetSpeedOf(r) > 0);
  while (buy(r, UP.forks, 0));
  assert.ok(chewOf(r) > 0, 'they always chew a bit');
  assert.equal(r.up[UP.forks], UPGRADES[UP.forks].max);
});
