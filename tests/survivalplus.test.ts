// Survival additions: the boss every few rounds, Max Ammo drops, the three new perks, going down and being revived, and Pack-a-Punch on every gun.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby, type Member } from '../src/server/lobby.ts';
import { BOSS, SURVIVAL } from '../src/shared/constants.ts';
import { FOUNDRY } from '../src/shared/foundry.ts';
import { findUse, maxHp } from '../src/shared/interact.ts';
import { PERKS, PERK_IDS, type PerkId } from '../src/shared/perks.ts';
import type { ServerMsg, V3 } from '../src/shared/protocol.ts';
import { WEAPON_IDS, gunStats } from '../src/shared/weapons.ts';
import { bossRound, bossStats, zombieStats } from '../src/shared/zombie.ts';

const lay = FOUNDRY.survival!;

interface Internals {
  wallet: Map<number, { points: number; jug: boolean; perks: PerkId[]; slots: ({ w: string; up: boolean } | null)[]; cur: number }>;
  doors: boolean[];
  zombies: { id: number; hp: number; maxHp?: number; boss?: number; pos: { x: number; y: number; z: number }; gate: number; damage: number }[];
  phase: string;
  round: number;
  toSpawn: number;
  bossDue: boolean;
  downs: Map<number, { bleed: number }>;
  clock: number;
  tick(dt: number): void;
  targets(): { id: number }[];
  startRound(): void;
  claw(z: unknown, id: number): void;
  hurt(m: Member, z: unknown, headshot: boolean, damage: number, dir: V3, scored: boolean): boolean;
  drops: { id: number; pos: { x: number; y: number; z: number } }[];
  power: boolean;
  rand: () => number;
  reset(): void;
}

function setup(players = 1) {
  const sent: ServerMsg[][] = [];
  const lobby = new Lobby('PLUS', 'survival', false, 'windward', () => {}, () => {});
  const clients = Array.from({ length: players }, (_, i) => {
    sent.push([]);
    return { id: i + 1, ws: { readyState: 1, send: (d: string) => sent[i].push(JSON.parse(d)) }, name: `p${i + 1}`, lobby: null };
  });
  for (const c of clients) lobby.add(c);
  const s = (lobby as unknown as { survival: Internals }).survival;
  const at = (id: number, p: V3) => (lobby.members.get(id)!.state.p = p);
  const member = (id = 1): Member => lobby.members.get(id)!;
  const wallet = (id = 1) => s.wallet.get(id)!;
  const done = () => clients.forEach((c) => lobby.remove(c));
  return { lobby, s, clients, sent, at, member, wallet, done };
}

/** Knock a player down the way a zombie would: claws until their health runs out. */
function knockDown(t: ReturnType<typeof setup>, id: number) {
  const m = t.member(id);
  t.s.claw({ pos: { x: m.state.p[0] + 1, y: m.state.p[1], z: m.state.p[2] }, damage: 9999 }, id);
}

// --- Pack-a-Punch -------------------------------------------------------------------------------------------

test('every gun can be Pack-a-Punched: each has a punched twin that hits harder, and the machine offers it for any gun', () => {
  for (const id of WEAPON_IDS) {
    const stock = gunStats(id, false);
    const up = gunStats(id, true);
    assert.ok(up.punched && up.damage > stock.damage && up.mag >= stock.mag, id);
    assert.notEqual(up.label, stock.label, `${id} has its own punched name`);
    const u = findUse(lay.punch, {
      lay, doorsOpen: [], boards: [], box: { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 },
      points: 99999, slots: [{ w: id, up: false }, null], cur: 0, jug: false, perks: [], downed: [], self: 1, power: true, parts: [], scythe: 0,
    });
    assert.equal(u?.kind, 'punch', id);
    assert.equal(u?.status, 'ready', id);
  }
});

// --- The boss ------------------------------------------------------------------------------------------------

test('a boss comes every 5th round, with far more health than the horde, more again with more players, and harder each time', () => {
  assert.deepEqual([1, 4, 5, 6, 10, 15].map(bossRound), [false, false, true, false, true, true]);
  const five = bossStats(5, 1);
  const ten = bossStats(10, 1);
  assert.equal(five.tier, 1);
  assert.equal(ten.tier, 2);
  assert.ok(five.hp >= 15 * zombieStats(5).hp, 'a real fight');
  assert.ok(ten.hp > five.hp && ten.damage > five.damage, 'harder every 5 rounds');
  assert.ok(bossStats(5, 4).hp > five.hp, 'more players, more health');
  assert.ok(five.damage > zombieStats(5).damage && five.speed < zombieStats(5).speed);
});

test('server: a boss round sends the boss in first; it shows in the snapshot with a health bar and counts toward the round', () => {
  const t = setup(2);
  try {
    t.s.round = BOSS.every - 1;
    t.s.startRound();
    assert.equal(t.s.round, BOSS.every);
    assert.ok(t.s.bossDue);
    const wave = t.sent[0].filter((m) => m.t === 'wave').at(-1) as Extract<ServerMsg, { t: 'wave' }>;
    assert.ok(wave.wave.boss);
    assert.equal(wave.wave.left, t.s.toSpawn + 1, 'the boss counts as one more');
    t.s.tick(0.05);
    const boss = t.s.zombies.find((z) => z.boss);
    assert.ok(boss, 'the boss broke in first');
    assert.equal(boss.hp, bossStats(BOSS.every, 2).hp);
    const snap = (lobbySnapshot(t) ?? []).find((z) => z.id === boss.id)!;
    assert.ok(snap.f & 4 && snap.hp === 1);
  } finally {
    t.done();
  }
});

function lobbySnapshot(t: ReturnType<typeof setup>) {
  t.lobby['tick']();
  return (t.sent[0].filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMsg, { t: 'snapshot' }>).zombies;
}

test('server: killing the boss pays the killer boss points and tells everyone (so everyone gets the coins)', () => {
  const t = setup(2);
  try {
    t.s.round = BOSS.every - 1;
    t.s.startRound();
    t.s.tick(0.05);
    const boss = t.s.zombies.find((z) => z.boss)!;
    const before = t.wallet(1).points;
    t.s.hurt(t.member(1), boss, false, boss.hp + 1, [0, 0, 1], false);
    assert.ok(!t.s.zombies.includes(boss));
    assert.equal(t.wallet(1).points, before + BOSS.points);
    for (const inbox of t.sent) assert.ok(inbox.some((m) => m.t === 'zombieDied' && m.boss), 'everyone hears it was the boss');
  } finally {
    t.done();
  }
});

// --- Perks ---------------------------------------------------------------------------------------------------

test('the three new perk machines stand in rooms you have to buy your way into, one per room, away from Juggernog and the Pack-a-Punch', () => {
  assert.deepEqual(lay.perks.map((p) => p.kind).sort(), [...PERK_IDS].sort());
  const rooms = lay.perks.map((p) => p.room);
  assert.equal(new Set(rooms).size, 3);
  for (const r of rooms) assert.notEqual(r, lay.startRoom, 'not in the starting Office');
  for (const p of lay.perks) {
    const room = lay.rooms[p.room];
    assert.ok(p.pos.x > room.x0 && p.pos.x < room.x1 && p.pos.z > room.z0 && p.pos.z < room.z1, `${p.kind} inside ${room.name}`);
  }
});

test('server: buying a perk at its machine takes the points once; you need to be there and afford it', () => {
  const t = setup();
  try {
    t.s.power = true;
    lay.perks.forEach((p, id) => {
      const w = t.wallet();
      t.at(1, [p.pos.x + 1, 0.01, p.pos.z]);
      w.points = PERKS[p.kind].price - 1;
      t.lobby.handle(t.clients[0], { t: 'use', kind: 'perk', id });
      assert.ok(!w.perks.includes(p.kind), 'too poor');
      w.points = PERKS[p.kind].price + 5;
      t.lobby.handle(t.clients[0], { t: 'use', kind: 'perk', id });
      assert.ok(w.perks.includes(p.kind));
      assert.equal(w.points, 5);
      t.lobby.handle(t.clients[0], { t: 'use', kind: 'perk', id });
      assert.equal(w.points, 5, 'no buying it twice');
      const me = t.sent[0].filter((m) => m.t === 'me').at(-1) as Extract<ServerMsg, { t: 'me' }>;
      assert.ok(me.perks?.includes(p.kind), 'the player is told');
    });
  } finally {
    t.done();
  }
});

// --- Going down and reviving ------------------------------------------------------------------------------

test('server: at 0 health you go down instead of dying; the horde ignores you and you cannot shoot, use or move', () => {
  const t = setup(2);
  try {
    t.s.phase = 'active';
    t.s.toSpawn = 5;
    knockDown(t, 1);
    const m = t.member(1);
    assert.ok(m.info.alive && m.info.down, 'down, not dead');
    assert.ok(t.s.downs.has(1));
    assert.ok(t.sent[1].some((x) => x.t === 'downed' && x.id === 1 && x.bleed === SURVIVAL.bleedOut));
    assert.ok(!t.sent[1].some((x) => x.t === 'kill'), 'no death');
    // Frozen in place.
    const was = [...m.state.p];
    t.lobby.handle(t.clients[0], { t: 'state', p: [9, 9, 9], v: [0, 0, 0], yaw: 0, pitch: 0, f: 0 });
    assert.deepEqual(m.state.p, was);
    // Zombies don't go for you.
    assert.ok(!t.s.targets().some((x) => x.id === 1));
    // Still a round going: player 2 is up.
    t.s.tick(0.05);
    assert.equal(t.s.phase, 'active');
  } finally {
    t.done();
  }
});

test('server: a teammate holding F beside you gets you up; letting go starts it over; Swift Mend halves the time', () => {
  for (const mend of [false, true]) {
    const t = setup(2);
    try {
      t.s.phase = 'active';
      t.s.toSpawn = 5;
      t.at(1, [0, 0.01, 18]);
      t.at(2, [1, 0.01, 18]);
      if (mend) t.wallet(2).perks.push('mend');
      knockDown(t, 1);
      const need = mend ? SURVIVAL.mendReviveTime : SURVIVAL.reviveTime;
      const hold = (secs: number) => {
        for (let i = 0; i < Math.round(secs / 0.2); i++) {
          t.s.clock += 0.2;
          t.lobby.handle(t.clients[1], { t: 'use', kind: 'revive', id: 1 });
        }
      };
      hold(need * 0.6);
      assert.ok(t.s.downs.has(1), 'not yet');
      t.s.clock += 1; // let go for a second
      hold(need * 0.6);
      assert.ok(t.s.downs.has(1), 'the gap started it over');
      hold(need * 0.6);
      assert.ok(!t.s.downs.has(1), `revived${mend ? ' with Swift Mend' : ''}`);
      const m = t.member(1);
      assert.ok(!m.info.down && m.info.alive);
      assert.equal(m.hp, Math.round(maxHp(false) * SURVIVAL.reviveHp));
      assert.ok(t.sent[0].some((x) => x.t === 'revived' && x.id === 1));
    } finally {
      t.done();
    }
  }
});

test('server: a revive needs you beside them; the downed cannot revive each other', () => {
  const t = setup(3);
  try {
    t.s.phase = 'active';
    t.s.toSpawn = 5;
    t.at(1, [0, 0.01, 18]);
    t.at(2, [5, 0.01, 18]);
    t.at(3, [0.8, 0.01, 18]);
    knockDown(t, 1);
    knockDown(t, 3);
    for (let i = 0; i < 40; i++) {
      t.s.clock += 0.2;
      t.lobby.handle(t.clients[1], { t: 'use', kind: 'revive', id: 1 }); // too far away
      t.lobby.handle(t.clients[2], { t: 'use', kind: 'revive', id: 1 }); // down themselves
    }
    assert.ok(t.s.downs.has(1));
  } finally {
    t.done();
  }
});

test('server: Second Wind gets you up by yourself once, and is used up', () => {
  const t = setup(2);
  try {
    t.s.phase = 'active';
    t.s.toSpawn = 5;
    t.wallet(1).perks.push('wind');
    knockDown(t, 1);
    assert.ok(t.s.downs.has(1));
    assert.ok(!t.wallet(1).perks.includes('wind'), 'spent');
    const msg = t.sent[0].find((x) => x.t === 'downed') as Extract<ServerMsg, { t: 'downed' }>;
    assert.equal(msg.self, SURVIVAL.selfRevive);
    for (let i = 0; i < Math.ceil((SURVIVAL.selfRevive + 0.2) / 0.05); i++) t.s.tick(0.05);
    assert.ok(!t.s.downs.has(1) && !t.member(1).info.down, 'back up on their own');
    // Down again: no Second Wind this time.
    knockDown(t, 1);
    for (let i = 0; i < Math.ceil((SURVIVAL.selfRevive + 1) / 0.05); i++) t.s.tick(0.05);
    assert.ok(t.s.downs.has(1));
  } finally {
    t.done();
  }
});

test('server: nobody reviving you, you bleed out and are dead until the round ends; everyone down is game over', () => {
  const t = setup(2);
  try {
    t.s.phase = 'active';
    t.s.toSpawn = 5;
    knockDown(t, 1);
    for (let i = 0; i < 20; i++) t.s.tick(0.05);
    assert.ok(t.s.downs.get(1)!.bleed < SURVIVAL.bleedOut, 'the clock runs');
    t.s.downs.get(1)!.bleed = 0.01; // skip ahead (ticking the whole half minute lets the horde get player 2 too)
    t.s.tick(0.05);
    const m = t.member(1);
    assert.ok(!m.info.alive && !t.s.downs.has(1), 'bled out');
    assert.ok(t.sent[1].some((x) => x.t === 'kill' && x.victim === 1));
    assert.equal(t.s.phase, 'active', 'player 2 still up');
    knockDown(t, 2);
    t.s.tick(0.05);
    assert.equal(t.s.phase, 'over', 'everyone down');
  } finally {
    t.done();
  }
});

test('server: when a round is cleared, everyone who is down gets up', () => {
  const t = setup(2);
  try {
    t.s.phase = 'active';
    t.s.toSpawn = 0;
    t.s.zombies.length = 0;
    knockDown(t, 1);
    t.s.tick(0.05);
    assert.equal(t.s.phase, 'intermission');
    assert.ok(!t.s.downs.has(1) && !t.member(1).info.down);
    assert.equal(t.member(1).hp, maxHp(false), 'and healed');
  } finally {
    t.done();
  }
});

// --- Max Ammo ------------------------------------------------------------------------------------------------

/** Start round `n` and let the horde break in until there's a zombie to kill. */
function zombieIn(t: ReturnType<typeof setup>, n: number, boss = true) {
  t.s.round = n - 1;
  t.s.startRound();
  if (!boss) t.s.bossDue = false;
  for (let i = 0; i < 400 && !t.s.zombies.length; i++) t.s.tick(0.05);
  const z = t.s.zombies[0];
  assert.ok(z, 'a zombie came');
  return z;
}

const kill = (t: ReturnType<typeof setup>, z: { hp: number }) => t.s.hurt(t.member(1), z, false, z.hp + 1, [0, 0, 1], false);
const dropsSent = (t: ReturnType<typeof setup>) => t.sent[0].filter((m) => m.t === 'drop').length;

test('server: a zombie drops a Max Ammo 1 time in 100, and the horde drops at most one every 4 rounds', () => {
  assert.equal(SURVIVAL.maxAmmoChance, 0.01);
  assert.equal(SURVIVAL.maxAmmoEveryRounds, 4);
  const t = setup(1);
  try {
    t.s.rand = () => 0.5; // a miss
    kill(t, zombieIn(t, 1));
    assert.equal(t.s.drops.length, 0, 'no luck, no drop');
    t.s.rand = () => 0.005; // a hit
    kill(t, zombieIn(t, 1));
    assert.equal(t.s.drops.length, 1, 'a lucky kill drops one');
    assert.equal(dropsSent(t), 1, 'and everyone hears where');
    for (const round of [1, 2, 3, 4]) kill(t, zombieIn(t, round));
    assert.equal(dropsSent(t), 1, 'not again until 4 rounds later');
    const z = zombieIn(t, 5, false); // just the horde, even on a boss round
    assert.ok(!z.boss);
    kill(t, z);
    assert.equal(dropsSent(t), 2, 'four rounds on, the horde can drop again');
  } finally {
    t.done();
  }
});

test('server: the boss always drops a Max Ammo, on top of the horde\'s', () => {
  const t = setup(1);
  try {
    t.s.rand = () => 0.005;
    kill(t, zombieIn(t, BOSS.every - 1)); // the horde's one for this stretch
    t.s.rand = () => 0.99; // the boss doesn't need luck
    const boss = zombieIn(t, BOSS.every);
    assert.ok(boss.boss);
    kill(t, boss);
    assert.equal(dropsSent(t), 2);
  } finally {
    t.done();
  }
});

test('server: walking into a Max Ammo fills everyone; one nobody grabs fades; a new run clears them', () => {
  const t = setup(2);
  try {
    t.s.rand = () => 0;
    kill(t, zombieIn(t, 1));
    const d = t.s.drops[0];
    t.at(2, [d.pos.x + 1, d.pos.y, d.pos.z]);
    t.s.tick(0.05);
    assert.equal(t.s.drops.length, 0);
    for (const inbox of t.sent) assert.ok(inbox.some((m) => m.t === 'maxAmmo' && m.id === d.id && m.by === 2), 'everyone refills');

    kill(t, zombieIn(t, 1 + SURVIVAL.maxAmmoEveryRounds, false));
    const e = t.s.drops[0];
    t.at(1, [e.pos.x + 50, e.pos.y, e.pos.z]);
    t.at(2, [e.pos.x + 50, e.pos.y, e.pos.z]);
    t.s.clock += SURVIVAL.dropLife + 1;
    t.s.tick(0.05);
    assert.equal(t.s.drops.length, 0);
    assert.ok(t.sent[0].some((m) => m.t === 'dropGone' && m.id === e.id), 'it faded');

    kill(t, zombieIn(t, 1 + 2 * SURVIVAL.maxAmmoEveryRounds, false));
    assert.equal(t.s.drops.length, 1);
    t.s.reset();
    assert.equal(t.s.drops.length, 0, 'a new run starts clean');
  } finally {
    t.done();
  }
});
