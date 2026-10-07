import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SURVIVAL, TICK_DT } from '../src/shared/constants.ts';
import { jugStatus, maxHp } from '../src/shared/jug.ts';
import { MAP } from '../src/shared/map.ts';
import { createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';
import { Lobby } from '../src/server/lobby.ts';

const J = MAP.juggernog;

test('Juggernog rules: range, points, one per run; it costs real points; max health goes 100 -> 250', () => {
  const at = { x: J.x + 1, y: J.y, z: J.z };
  assert.equal(jugStatus(SURVIVAL.jugPrice, false, { x: J.x + 20, y: J.y, z: J.z }, J), 'far');
  assert.equal(jugStatus(SURVIVAL.jugPrice - 1, false, at, J), 'poor');
  assert.equal(jugStatus(SURVIVAL.jugPrice, false, at, J), 'ready');
  assert.equal(jugStatus(SURVIVAL.jugPrice * 3, true, at, J), 'owned');
  assert.ok(SURVIVAL.jugPrice >= 20 * SURVIVAL.bodyPoints, 'a real commitment next to kill points');
  assert.ok(SURVIVAL.jugPrice < SURVIVAL.punchPrice, 'cheaper than Pack-a-Punch');
  assert.equal(maxHp(false), 100);
  assert.equal(maxHp(true), 250);
});

test('the Juggernog station stands on solid floor, clear of geometry, and is walkable from every survival spawn', () => {
  const hw = 1;
  const inside = MAP.boxes.filter((b) => b.min.x < J.x + hw && b.max.x > J.x - hw && b.min.z < J.z + hw && b.max.z > J.z - hw && b.max.y > J.y + 0.05 && b.min.y < J.y + 2.5);
  assert.deepEqual(inside, [], 'geometry in the way');
  assert.ok(MAP.boxes.find((b) => b.kind === 'floor' && b.min.x < J.x && b.max.x > J.x && b.min.z < J.z && b.max.z > J.z && Math.abs(b.max.y - J.y) < 0.01), 'no floor under it');
  assert.ok(!MAP.triggers.some((t) => J.x > t.min.x - 1 && J.x < t.max.x + 1 && J.z > t.min.z - 1 && J.z < t.max.z + 1 && J.y < t.max.y && J.y + 2 > t.min.y), 'in or beside a trigger');
  assert.ok(Math.hypot(J.x - MAP.punchMachine.x, J.z - MAP.punchMachine.z) > 10, 'apart from Pack-a-Punch so you choose');

  for (const sp of MAP.survivalSpawns) {
    const s = createPlayerState({ ...sp.pos });
    const input = emptyInput();
    input.forward = 1;
    // Spawns on the far side go around the trunk (and its roots) first.
    const route = sp.pos.x < 0 ? [{ x: sp.pos.x, z: sp.pos.z * 1.4 }, { x: -sp.pos.x, z: sp.pos.z * 1.4 }] : [];
    let ok = false;
    for (let i = 0; i < 20 / TICK_DT && !ok; i++) {
      if (route.length && Math.hypot(route[0].x - s.pos.x, route[0].z - s.pos.z) < 1) route.shift();
      const goal = route[0] ?? J;
      input.yaw = Math.atan2(-(goal.x - s.pos.x), -(goal.z - s.pos.z));
      stepPlayer(s, input, TICK_DT, MAP.boxes, MAP.triggers);
      ok = jugStatus(SURVIVAL.jugPrice, false, s.pos, J) === 'ready';
    }
    assert.ok(ok, `could not walk from ${JSON.stringify(sp.pos)} to the station, ended at ${JSON.stringify(s.pos)}`);
  }
});

test('server: Juggernog needs range and points, deducts them, heals to 250, sticks through the run and resets with it', () => {
  const sent: { t: string; hp?: number; pts?: number; jug?: boolean }[] = [];
  const ws = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)) };
  const lobby = new Lobby('JUGT', 'survival', false, () => {}, () => {});
  const client = { id: 1, ws, name: 'tester', lobby: null };
  lobby.add(client);
  try {
    const m = lobby.members.get(1)!;
    const survival = (lobby as unknown as { survival: { wallet: Map<number, { points: number; upgraded: boolean; jug: boolean }>; reset(): void } }).survival;
    const wallet = () => survival.wallet.get(1)!;
    const last = <K extends 'hp' | 'pts'>(t: K) => sent.filter((x) => x.t === t).at(-1)!;
    survival.wallet.set(1, { points: SURVIVAL.jugPrice + 90, upgraded: false, jug: false });

    lobby.handle(client, { t: 'jug' }); // spawned by the trunk: out of range
    assert.equal(wallet().jug, false);

    m.state.p = [J.x + 1, J.y, J.z];
    wallet().points = SURVIVAL.jugPrice - 1;
    lobby.handle(client, { t: 'jug' });
    assert.equal(wallet().jug, false, 'too poor');

    wallet().points = SURVIVAL.jugPrice + 90;
    m.hp = 30; // hurt
    lobby.handle(client, { t: 'jug' });
    assert.deepEqual({ ...wallet() }, { points: 90, upgraded: false, jug: true });
    assert.equal(m.hp, SURVIVAL.jugHp, 'healed to the new maximum');
    assert.equal(last('hp').hp, SURVIVAL.jugHp);
    assert.equal(last('pts').jug, true);

    wallet().points = SURVIVAL.jugPrice * 2;
    lobby.handle(client, { t: 'jug' });
    assert.equal(wallet().points, SURVIVAL.jugPrice * 2, 'no second purchase');

    survival.reset(); // a new run
    assert.deepEqual({ ...wallet() }, { points: 0, upgraded: false, jug: false });
    assert.equal(last('pts').jug, undefined);
  } finally {
    lobby.remove(client);
  }
});
