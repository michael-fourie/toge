import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby, type Member } from '../src/server/lobby.ts';
import { SURVIVAL } from '../src/shared/constants.ts';
import { FOUNDRY } from '../src/shared/foundry.ts';
import { findUse } from '../src/shared/interact.ts';
import type { BoxState, ServerMsg, V3 } from '../src/shared/protocol.ts';
import { gunStats } from '../src/shared/weapons.ts';

const lay = FOUNDRY.survival!;

interface Internals {
  wallet: Map<number, { points: number; jug: boolean; slots: ({ w: string; up: boolean } | null)[]; cur: number }>;
  doors: boolean[];
  boards: number[];
  box: BoxState;
  boxUses: number;
  zombies: { id: number; hp: number; pos: { x: number; y: number; z: number }; gate: number }[];
  phase: string;
  round: number;
  toSpawn: number;
  rand: () => number;
  tick(dt: number): void;
  reset(): void;
}

function setup(players = 1) {
  const sent: ServerMsg[][] = [];
  const lobby = new Lobby('TEST', 'survival', false, 'windward', () => {}, () => {});
  const clients = Array.from({ length: players }, (_, i) => {
    sent.push([]);
    return { id: i + 1, ws: { readyState: 1, send: (d: string) => sent[i].push(JSON.parse(d)) }, name: `p${i + 1}`, lobby: null };
  });
  for (const c of clients) lobby.add(c);
  const s = (lobby as unknown as { survival: Internals }).survival;
  const at = (id: number, p: V3) => (lobby.members.get(id)!.state.p = p);
  const done = () => clients.forEach((c) => lobby.remove(c));
  return { lobby, s, clients, sent, at, done, member: (id = 1): Member => lobby.members.get(id)! };
}

const stand = (p: { x: number; y: number; z: number }): V3 => [p.x, p.y, p.z];

test('doors: need points and to be at the door; opening one frees the room and tells everyone', () => {
  const t = setup();
  try {
    const d = lay.doors[0];
    const w = t.s.wallet.get(1) ?? (t.s.wallet.set(1, { points: 0, jug: false, slots: [{ w: 'sparrow', up: false }, null], cur: 0 }), t.s.wallet.get(1)!);
    w.points = d.price + 30;
    t.at(1, [0, 0.01, 19]); // the middle of the Office, far from the door
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'door', id: 0 });
    assert.equal(t.s.doors[0], false, 'out of reach');
    t.at(1, [0, 0.01, 13.5]);
    w.points = d.price - 1;
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'door', id: 0 });
    assert.equal(t.s.doors[0], false, 'too poor');
    w.points = d.price + 30;
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'door', id: 0 });
    assert.equal(t.s.doors[0], true);
    assert.equal(w.points, 30);
    t.s.tick(0.05);
    const world = t.sent[0].filter((m) => m.t === 'world').at(-1)!;
    assert.ok(world.t === 'world' && world.doors[0]);
  } finally {
    t.done();
  }
});

test('wall guns: buy one, buy its ammo for half, and a third gun swaps the one in your hands', () => {
  const t = setup();
  try {
    t.s.tick(0.05);
    const w = t.s.wallet.get(1)!;
    w.points = 5000;
    const buy = (id: number) => {
      t.at(1, stand(lay.wallBuys[id].at));
      t.lobby.handle(t.clients[0], { t: 'use', kind: 'wall', id });
    };
    buy(0); // Marshal, 600
    assert.deepEqual(w.slots.map((s) => s?.w), ['sparrow', 'marshal']);
    assert.equal(w.cur, 1);
    assert.equal(w.points, 5000 - 600);
    buy(0); // ammo
    assert.equal(w.points, 5000 - 600 - 300);
    const me = t.sent[0].filter((m) => m.t === 'me').at(-1)!;
    assert.ok(me.t === 'me' && me.fill?.includes(1));
    buy(1); // a third: swaps the Marshal
    assert.deepEqual(w.slots.map((s) => s?.w), ['sparrow', 'rattler']);
    t.lobby.handle(t.clients[0], { t: 'equip', slot: 0 });
    assert.equal(w.cur, 0);
    t.lobby.handle(t.clients[0], { t: 'equip', slot: 7 });
    assert.equal(w.cur, 0, 'no such slot');
  } finally {
    t.done();
  }
});

test('Mystery Box: pay, wait, only the payer takes the gun; the plush gives the points back and moves it', () => {
  const t = setup(2);
  try {
    const w = t.s.wallet.get(1)!;
    w.points = 3000;
    const spot = lay.boxSpots[t.s.box.spot];
    t.at(1, stand({ x: spot.pos.x + Math.sin(spot.yaw) * 1.5, y: 0, z: spot.pos.z + Math.cos(spot.yaw) * 1.5 }));
    t.at(2, t.member(1).state.p);
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'box', id: 0 });
    assert.equal(t.s.box.phase, 'rolling');
    assert.equal(w.points, 3000 - SURVIVAL.boxPrice);
    t.lobby.handle(t.clients[1], { t: 'use', kind: 'box', id: 0 });
    assert.equal(t.s.box.owner, 1, 'busy: a second payer is ignored');
    t.s.box.gun = 'hammer';
    t.s.tick(SURVIVAL.boxRoll + 0.1);
    assert.equal(t.s.box.phase, 'ready');
    t.lobby.handle(t.clients[1], { t: 'use', kind: 'take', id: 0 });
    assert.equal(t.s.box.phase, 'ready', 'not yours');
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'take', id: 0 });
    assert.equal(t.s.box.phase, 'closed');
    assert.deepEqual(w.slots.map((s) => s?.w), ['sparrow', 'hammer']);

    // The plush.
    const before = w.points;
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'box', id: 0 });
    t.s.box.gun = null;
    const oldSpot = t.s.box.spot;
    t.s.tick(SURVIVAL.boxRoll + 0.1);
    assert.equal(t.s.box.phase, 'leaving');
    assert.equal(w.points, before, 'refunded');
    t.s.tick(SURVIVAL.boxLeave + 0.1);
    assert.equal(t.s.box.phase, 'closed');
    assert.notEqual(t.s.box.spot, oldSpot);
  } finally {
    t.done();
  }
});

test('Pack-a-Punch upgrades the gun in your hands, once, and a new run takes it away', () => {
  const t = setup();
  try {
    t.s.tick(0.05);
    (t.s as unknown as { power: boolean }).power = true; // the Pack-a-Punch needs the power on
    const w = t.s.wallet.get(1)!;
    w.points = SURVIVAL.punchPrice + 10;
    t.at(1, stand(lay.start[0].pos));
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'punch', id: 0 });
    assert.equal(w.slots[0]!.up, false, 'not at the machine');
    t.at(1, [lay.punch.x, 0.01, lay.punch.z + 1]);
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'punch', id: 0 });
    assert.equal(w.slots[0]!.up, true);
    assert.equal(w.points, 10);
    w.points = 9999;
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'punch', id: 0 });
    assert.equal(w.points, 9999, 'one per gun');
    t.s.reset();
    assert.equal(t.s.wallet.get(1)!.slots[0]!.up, false);
    assert.equal(t.s.wallet.get(1)!.points, 0);
  } finally {
    t.done();
  }
});

test('windows: zombies tear boards off, players nail them back for points, but not under a zombie', () => {
  const t = setup();
  try {
    // Fixed dice and a fixed spot: the zombie must tear the boards off, not maul us first (it used to, now and then:
    // a random window and a random spawn spot sometimes put it through the wall and onto us within the time allowed).
    t.s.rand = () => 0;
    t.at(1, [0, 0.01, 22]);
    t.s.toSpawn = 1;
    t.s.phase = 'active';
    t.s.tick(0.05);
    assert.equal(t.s.zombies.length, 1, 'it appears');
    const z = t.s.zombies[0];
    assert.ok(lay.barricades[z.gate].room === 3, 'only Office windows are live before any door is bought');
    const gate = lay.barricades[z.gate];
    for (let i = 0; i < 20 * (SURVIVAL.tearTime * 5 + 12) && t.s.boards[gate.id] > 0; i++) t.s.tick(0.05);
    assert.equal(t.s.boards[gate.id], 0, 'all five boards torn off');
    assert.equal(t.member().hp, SURVIVAL.playerHp, 'it tore the boards; it did not get to us');
    // No nailing a board back under a zombie standing at the window.
    z.pos = { ...gate.outside };
    z.gate = gate.id;
    t.at(1, stand(gate.inside));
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'board', id: gate.id });
    assert.equal(t.s.boards[gate.id], 0, 'not under a zombie');
    t.s.zombies.length = 0;
    // Repair.
    const w = t.s.wallet.get(1)!;
    const pts = w.points;
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'board', id: gate.id });
    assert.equal(t.s.boards[gate.id], 1);
    assert.equal(w.points, pts + SURVIVAL.repairPoints);
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'board', id: gate.id });
    assert.equal(t.s.boards[gate.id], 1, 'rate limited: hold F, one board at a time');
    for (let i = 0; i < SURVIVAL.boards * 3; i++) {
      t.s.tick(SURVIVAL.repairTime + 0.05);
      t.lobby.handle(t.clients[0], { t: 'use', kind: 'board', id: gate.id });
    }
    assert.equal(t.s.boards[gate.id], SURVIVAL.boards, 'capped');
    assert.equal(findUse({ x: gate.inside.x, y: 0, z: gate.inside.z }, { lay, doorsOpen: t.s.doors, boards: t.s.boards, box: t.s.box, points: 0, slots: [], cur: 0, jug: false, perks: [], downed: [], self: 1, power: true, parts: [], scythe: 0 })?.kind === 'board', false, 'no repair prompt for a full window');
  } finally {
    t.done();
  }
});

test('shooting: damage comes from the gun the server knows you hold; kills pay; shotguns hit several; the pistol cannot one-shot', () => {
  const t = setup();
  try {
    t.s.tick(0.05);
    const w = t.s.wallet.get(1)!;
    const m = t.member();
    t.at(1, [0, 0.01, 19]);
    const mk = (id: number, hp = 80) => {
      t.s.zombies.push({ id, hp, pos: { x: 0, y: 0, z: 10 }, gate: -1, vel: { x: 0, y: 0, z: 0 } } as never);
      return t.s.zombies.at(-1)!;
    };
    const z1 = mk(101);
    const from: V3 = [0, 1.6, 19];
    const to: V3 = [0, 1, 10];
    t.lobby.handle(t.clients[0], { t: 'shoot', from, to, hits: [{ z: 101 }] });
    assert.equal(z1.hp, 80 - gunStats('sparrow', false).damage);
    assert.equal(w.points, SURVIVAL.hitPoints);
    // A headshot with the pistol kills nothing at 80 hp but hurts more.
    m.lastShot = 0;
    t.lobby.handle(t.clients[0], { t: 'shoot', from, to, hits: [{ z: 101, h: true }] });
    assert.ok(t.s.zombies.length === 0, 'the head shot finishes it');
    assert.equal(w.points, SURVIVAL.hitPoints + SURVIVAL.headPoints);
    // Shotgun: pellets on two zombies, no more than 8 counted.
    w.slots[1] = { w: 'bramble', up: false };
    w.cur = 1;
    const a = mk(201, 40);
    const b = mk(202, 40);
    m.lastShot = 0;
    t.lobby.handle(t.clients[0], { t: 'shoot', from, to, hits: [{ z: 201 }, { z: 201 }, { z: 201 }, { z: 202 }, { z: 202 }, { z: 202 }] });
    assert.ok(a.hp <= 0 || b.hp <= 0 || t.s.zombies.length === 0);
    assert.equal(t.s.zombies.length, 0, '3 x 15 at 40 hp is two kills');
  } finally {
    t.done();
  }
});

test('rate of fire is per gun: a Rattler can fire far faster than the pistol', () => {
  const t = setup();
  try {
    t.s.tick(0.05);
    const w = t.s.wallet.get(1)!;
    const shots = () => t.sent.flat().filter((m) => m.t === 'shot').length;
    void shots;
    assert.ok(gunStats('rattler', false).fireCooldown < gunStats('sparrow', false).fireCooldown / 1.5);
    w.slots[0] = { w: 'rattler', up: false };
    const m = t.member();
    m.lastShot = Date.now() - 70; // 70ms ago: fine for a 75ms gun (x0.9), far too soon for the 160ms pistol
    t.lobby.handle(t.clients[0], { t: 'shoot', from: [0, 1.6, 19], to: [0, 1, 10] });
    assert.ok(Date.now() - m.lastShot < 20, 'accepted');
    w.slots[0] = { w: 'sparrow', up: false };
    const stamp = (m.lastShot = Date.now() - 70);
    t.lobby.handle(t.clients[0], { t: 'shoot', from: [0, 1.6, 19], to: [0, 1, 10] });
    assert.equal(m.lastShot, stamp, 'rejected');
  } finally {
    t.done();
  }
});

test('a full round: zombies break in at the windows, the round ends when they are dead, everyone heals', () => {
  const t = setup();
  try {
    for (let i = 0; i < 20 * (SURVIVAL.firstRoundDelay + 1); i++) t.s.tick(0.05);
    assert.equal(t.s.phase, 'active');
    assert.equal(t.s.round, 1);
    for (let i = 0; i < 20 * 12; i++) {
      t.member().hp = 1e9; // an idle player would just get eaten
      t.s.tick(0.05);
    }
    assert.equal(t.s.toSpawn, 0);
    assert.ok(t.s.zombies.every((z) => z.gate === -1 || lay.barricades[z.gate].room === 3));
    t.s.zombies.length = 0;
    t.s.tick(0.05);
    assert.equal(t.s.phase, 'intermission');
  } finally {
    t.done();
  }
});
