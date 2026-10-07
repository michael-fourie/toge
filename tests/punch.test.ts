import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby } from '../src/server/lobby.ts';
import { SURVIVAL, TICK_DT, WEAPON, ZOMBIE } from '../src/shared/constants.ts';
import { MAP } from '../src/shared/map.ts';
import { bodyDamage, headDamage, killPoints, pierced, punchStatus, weaponStats } from '../src/shared/punch.ts';
import { createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';
import { zombieStats } from '../src/shared/zombie.ts';

const M = MAP.punchMachine;
const at = (dx: number, dz = 0) => ({ x: M.x + dx, y: M.y, z: M.z + dz });

test('kills pay more for headshots, and the upgrade is steep next to them', () => {
  assert.ok(killPoints(true) > killPoints(false));
  assert.ok(SURVIVAL.punchPrice / killPoints(true) >= 40, 'at least ~40 kills to afford it');
});

test('purchase rules: range, points, and one per run', () => {
  const rich = SURVIVAL.punchPrice;
  assert.equal(punchStatus(rich, false, at(SURVIVAL.punchRange - 0.1), M), 'ready');
  assert.equal(punchStatus(rich, false, at(SURVIVAL.punchRange + 0.1), M), 'far');
  assert.equal(punchStatus(rich, false, { ...at(0), y: M.y + 10 }, M), 'far', 'not from the floor above');
  assert.equal(punchStatus(rich - 1, false, at(1), M), 'poor');
  assert.equal(punchStatus(rich * 2, true, at(1), M), 'owned');
  assert.equal(punchStatus(0, true, at(9), M), 'far');
});

test('the punched rifle cycles, reloads and holds more, and hits harder', () => {
  const stock = weaponStats(false);
  const up = weaponStats(true);
  assert.equal(stock, WEAPON);
  assert.ok(up.fireCooldown < stock.fireCooldown * 0.6);
  assert.ok(up.boltTime < stock.boltTime && up.reloadTime < stock.reloadTime && up.magSize > stock.magSize);
  assert.ok(up.fireCooldown >= up.boltDelay + up.boltTime - 1e-9, 'the cooldown covers the animation');
  assert.equal(up.range, WEAPON.range, 'unlisted stats carry over');
  assert.ok(bodyDamage(true) > bodyDamage(false) && headDamage(true) > headDamage(false));
  // Stock body shots stop one-shotting at round 2; punched ones keep going for many more rounds.
  const oneShotRound = (dmg: number) => {
    let r = 1;
    while (zombieStats(r + 1).hp <= dmg) r++;
    return r;
  };
  assert.ok(oneShotRound(bodyDamage(true)) >= oneShotRound(bodyDamage(false)) + 6);
  assert.ok(ZOMBIE.hpBase > 0);
});

test('punched shots pierce zombies behind the first, along the line only', () => {
  const from = { x: 0, y: 1.5, z: 0 };
  const to = { x: 0, y: 1, z: -10 }; // chest of the first zombie at z=-10
  const zs = [
    { id: 1, pos: { x: 0, y: 0, z: -10 } }, // the one already hit
    { id: 2, pos: { x: 0.3, y: 0, z: -15 } }, // behind, in line
    { id: 3, pos: { x: 3, y: 0, z: -15 } }, // behind, off to the side
    { id: 4, pos: { x: 0, y: 0, z: -5 } }, // in FRONT of the hit point: the shot never reached its line
    { id: 5, pos: { x: 0, y: 0, z: -10 - SURVIVAL.punchPierceRange - 5 } }, // too far
  ];
  assert.deepEqual(pierced(from, to, zs, 1), [2]);
  assert.deepEqual(pierced(from, from, zs, 1), []);
});

test('the Pack-a-Punch machine stands on solid floor, clear of geometry, and is walkable from the spawns', () => {
  // Nothing overlaps a player-sized column at the machine, and the island floor is under it.
  const hw = 1;
  const inside = MAP.boxes.filter(
    (b) => b.min.x < M.x + hw && b.max.x > M.x - hw && b.min.z < M.z + hw && b.max.z > M.z - hw && b.max.y > M.y + 0.05 && b.min.y < M.y + 2.5,
  );
  assert.deepEqual(inside, [], 'geometry in the way');
  const floor = MAP.boxes.find((b) => b.kind === 'floor' && b.min.x < M.x && b.max.x > M.x && b.min.z < M.z && b.max.z > M.z && Math.abs(b.max.y - M.y) < 0.01);
  assert.ok(floor, 'no floor under the machine');
  assert.ok(!MAP.triggers.some((t) => M.x > t.min.x && M.x < t.max.x && M.z > t.min.z && M.z < t.max.z && M.y < t.max.y && M.y + 2 > t.min.y), 'in a trigger');

  for (const sp of MAP.survivalSpawns) {
    const s = createPlayerState({ ...sp.pos });
    const input = emptyInput();
    input.forward = 1;
    // The far-side spawn walks around the trunk (and its roots) first.
    const route = sp.pos.x > 0 ? [{ x: sp.pos.x, z: sp.pos.z * 1.4 }, { x: -sp.pos.x, z: sp.pos.z * 1.4 }] : [];
    let ok = false;
    for (let i = 0; i < 20 / TICK_DT && !ok; i++) {
      if (route.length && Math.hypot(route[0].x - s.pos.x, route[0].z - s.pos.z) < 1) route.shift();
      const goal = route[0] ?? M;
      input.yaw = Math.atan2(-(goal.x - s.pos.x), -(goal.z - s.pos.z));
      stepPlayer(s, input, TICK_DT, MAP.boxes, MAP.triggers);
      ok = punchStatus(SURVIVAL.punchPrice, false, s.pos, M) === 'ready';
    }
    assert.ok(ok, `could not walk from ${JSON.stringify(sp.pos)} to the machine, ended at ${JSON.stringify(s.pos)}`);
  }
});

test('server: buying needs range and points, deducts them, and the upgrade sticks until the run restarts', () => {
  const sent: { t: string; pts?: number; up?: boolean }[] = [];
  const ws = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)) };
  const lobby = new Lobby('TEST', 'survival', () => {}, () => {});
  const client = { id: 1, ws, name: 'tester', lobby: null };
  lobby.add(client);
  try {
    const m = lobby.members.get(1)!;
    const survival = (lobby as unknown as { survival: { wallet: Map<number, { points: number; upgraded: boolean }>; reset(): void } }).survival;
    const lastPts = () => sent.filter((x) => x.t === 'pts').at(-1)!;
    const wallet = () => survival.wallet.get(1)!;
    survival.wallet.set(1, { points: SURVIVAL.punchPrice + 70, upgraded: false });

    lobby.handle(client, { t: 'punch' }); // spawned by the trunk: out of range
    assert.equal(wallet().upgraded, false);

    m.state.p = [M.x + 1, M.y, M.z];
    wallet().points = SURVIVAL.punchPrice - 1;
    lobby.handle(client, { t: 'punch' });
    assert.equal(wallet().upgraded, false, 'too poor');

    wallet().points = SURVIVAL.punchPrice + 70;
    lobby.handle(client, { t: 'punch' });
    assert.deepEqual({ ...wallet() }, { points: 70, upgraded: true });
    assert.deepEqual({ pts: lastPts().pts, up: lastPts().up }, { pts: 70, up: true });

    wallet().points = SURVIVAL.punchPrice * 2;
    lobby.handle(client, { t: 'punch' });
    assert.equal(wallet().points, SURVIVAL.punchPrice * 2, 'no second purchase');

    survival.reset(); // new run
    assert.deepEqual({ ...wallet() }, { points: 0, upgraded: false });
    assert.deepEqual({ pts: lastPts().pts, up: lastPts().up }, { pts: 0, up: undefined });
  } finally {
    lobby.remove(client);
  }
});

test('server: "play again" is its own message and never buys the upgrade', () => {
  const ws = { readyState: 1, send: () => {} };
  const lobby = new Lobby('TEST2', 'survival', () => {}, () => {});
  const client = { id: 1, ws, name: 'tester', lobby: null };
  lobby.add(client);
  try {
    const m = lobby.members.get(1)!;
    const survival = (lobby as unknown as { survival: { wallet: Map<number, { points: number; upgraded: boolean }> } }).survival;
    m.state.p = [M.x + 1, M.y, M.z]; // in range and rich: a punch message would succeed
    survival.wallet.set(1, { points: SURVIVAL.punchPrice * 2, upgraded: false });
    lobby.handle(client, { t: 'again' });
    assert.deepEqual({ ...survival.wallet.get(1)! }, { points: SURVIVAL.punchPrice * 2, upgraded: false });
  } finally {
    lobby.remove(client);
  }
});
