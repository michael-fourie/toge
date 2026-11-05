// Survival's fun layer: the power switch, the Gale Scythe (parts, workbench, swing), zombies with jobs, round modifiers,
// and the Skyline roof (never lethal; zombies can't get up there).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby, type Member } from '../../src/gambol/server/lobby.ts';
import { JOBS, SCYTHE, SKYLINE, SURVIVAL } from '../../src/gambol/shared/constants.ts';
import { FOUNDRY } from '../../src/gambol/shared/foundry.ts';
import { type UseCtx, findUse, killPoints } from '../../src/gambol/shared/interact.ts';
import { MOD, MOD_IDS, type ModId, modFor } from '../../src/gambol/shared/modifiers.ts';
import type { ServerMsg, UseKind, V3 } from '../../src/gambol/shared/protocol.ts';
import { STARTER, bodyDamage, gunStats, headDamage } from '../../src/gambol/shared/weapons.ts';
import { type JobId, type Zombie, createZombie, pickJob, zombieStats } from '../../src/gambol/shared/zombie.ts';

const lay = FOUNDRY.survival!;

interface Internals {
  wallet: Map<number, { points: number; slots: ({ w: string; up: boolean } | null)[]; cur: number }>;
  zombies: Zombie[];
  round: number;
  phase: string;
  toSpawn: number;
  power: boolean;
  parts: boolean[];
  scythe: number;
  mod: ModId | null;
  clock: number;
  rand: () => number;
  tick(dt: number): void;
  startRound(): void;
  reset(): void;
  hurt(m: Member, z: unknown, headshot: boolean, damage: number, dir: V3, scored: boolean): boolean;
  info(): { mod?: ModId };
}

function setup(players = 1) {
  const sent: ServerMsg[][] = [];
  const lobby = new Lobby('FUN', 'survival', false, 'windward', () => {}, () => {});
  const clients = Array.from({ length: players }, (_, i) => {
    sent.push([]);
    return { id: i + 1, ws: { readyState: 1, send: (d: string) => sent[i].push(JSON.parse(d)) }, name: `p${i + 1}`, lobby: null };
  });
  for (const c of clients) lobby.add(c);
  const s = (lobby as unknown as { survival: Internals }).survival;
  const member = (id = 1): Member => lobby.members.get(id)!;
  const at = (id: number, p: { x: number; y: number; z: number }) => (member(id).state.p = [p.x, p.y + 0.01, p.z]);
  const use = (id: number, kind: UseKind, uid = 0) => lobby.handle(clients[id - 1], { t: 'use', kind, id: uid });
  const done = () => clients.forEach((c) => lobby.remove(c));
  return { lobby, s, clients, sent, member, at, use, done };
}

const ctx = (over: Partial<UseCtx> = {}): UseCtx => ({
  lay, doorsOpen: [], boards: [], box: { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 },
  points: 99999, slots: [{ w: 'marshal', up: false }, null], cur: 0, jug: false, perks: [], downed: [], self: 1, power: false, parts: [], scythe: 0, ...over,
});

/** A zombie standing at `p`, added to the horde. */
function zombieAt(t: ReturnType<typeof setup>, p: { x: number; y: number; z: number }, job?: JobId) {
  const z = createZombie(1000 + t.s.zombies.length, p, 1, -1, job);
  t.s.zombies.push(z);
  return z;
}

// --- The power ----------------------------------------------------------------------------------------------

test('without power the perk machines, Juggernog and the Pack-a-Punch say so; the switch turns them on', () => {
  for (const spot of [lay.punch, lay.jug, ...lay.perks.map((p) => p.pos)]) {
    const p = { x: spot.x + 1, y: spot.y, z: spot.z };
    assert.equal(findUse(p, ctx())?.status, 'off');
    assert.equal(findUse(p, ctx({ power: true }))?.status, 'ready');
  }
  assert.equal(findUse(lay.power.pos, ctx())?.kind, 'power');
});

test('server: throwing the switch turns the power on for everyone, and a new run turns it off', () => {
  const t = setup(2);
  try {
    assert.equal(t.s.power, false);
    t.at(1, lay.power.pos);
    t.use(1, 'power');
    assert.equal(t.s.power, true);
    t.s.tick(0.05);
    for (const inbox of t.sent) assert.ok(inbox.some((m) => m.t === 'world' && m.power));
    t.s.reset();
    assert.equal(t.s.power, false);
  } finally {
    t.done();
  }
});

// --- The Gale Scythe -----------------------------------------------------------------------------------------

test('the scythe parts lie at the far ends (cellar, North Wing, upstairs), and the workbench is on the mezzanine', () => {
  assert.deepEqual(lay.parts.map((p) => lay.rooms[p.room].name).sort(), ['Clock Room', 'Cold Storage', 'Showroom']);
  for (const p of lay.parts) {
    const r = lay.rooms[p.room];
    assert.ok(p.pos.x > r.x0 && p.pos.x < r.x1 && p.pos.z > r.z0 && p.pos.z < r.z1);
  }
  assert.ok(lay.bench.pos.y > 3.5, 'up on the mezzanine');
});

test('server: find every part, build the scythe, one player takes it; it cuts every zombie around them', () => {
  const t = setup(2);
  try {
    t.at(1, lay.bench.pos);
    t.use(1, 'bench');
    assert.equal(t.s.scythe, 0, 'no parts, no scythe');
    lay.parts.forEach((p, i) => {
      t.at(1, p.pos);
      t.use(1, 'part', i);
    });
    assert.deepEqual(t.s.parts, [true, true, true]);
    t.at(1, lay.bench.pos);
    t.use(1, 'bench');
    assert.equal(t.s.scythe, -1, 'built: it waits on the bench');
    t.at(2, lay.bench.pos);
    t.use(2, 'bench');
    assert.equal(t.s.scythe, 2, 'player 2 carries it');
    t.use(1, 'bench');
    assert.equal(t.s.scythe, 2, 'and nobody can take it off them');

    // A swing: everything within reach (all the way round) is hit, nothing beyond.
    const me = t.member(2);
    me.state.p = [0, 0.01, 0];
    t.s.zombies.length = 0;
    const near = [zombieAt(t, { x: 2, y: 0, z: 0 }), zombieAt(t, { x: -3, y: 0, z: 1 }), zombieAt(t, { x: 0, y: 0, z: SCYTHE.range - 0.2 })];
    const far = zombieAt(t, { x: SCYTHE.range + 1, y: 0, z: 0 });
    t.lobby.handle(t.clients[1], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1.6, -1], knife: true });
    for (const z of near) assert.ok(!t.s.zombies.includes(z), 'cut down');
    assert.ok(t.s.zombies.includes(far), 'out of reach');
    // A knife (not the scythe) does nothing of the sort.
    const z2 = zombieAt(t, { x: 1, y: 0, z: 0 });
    t.member(1).state.p = [0, 0.01, 0];
    t.lobby.handle(t.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1.6, -1], knife: true });
    assert.ok(t.s.zombies.includes(z2), 'player 1 has only a knife and named no one');

    // The carrier leaves: it goes back on the bench.
    t.lobby.remove(t.clients[1] as never);
    assert.equal(t.s.scythe, -1);
    t.s.reset();
    assert.equal(t.s.scythe, 0);
    assert.deepEqual(t.s.parts, [false, false, false]);
  } finally {
    t.done();
  }
});

// --- Zombies with jobs ---------------------------------------------------------------------------------------

test('jobs: none in round 1, then a growing share up to the cap, spread over all three', () => {
  assert.equal(pickJob(1, 0, 0), undefined);
  assert.equal(pickJob(JOBS.from, JOBS.chancePerRound - 0.001, 0), 'welder');
  assert.equal(pickJob(JOBS.from, JOBS.chancePerRound + 0.001, 0), undefined);
  assert.equal(pickJob(100, JOBS.chanceMax - 0.001, 0.99), 'stoker');
  assert.equal(pickJob(100, JOBS.chanceMax + 0.001, 0.5), undefined);
  const s = zombieStats(5);
  const courier = createZombie(1, { x: 0, y: 0, z: 0 }, 5, -1, 'courier');
  const welder = createZombie(2, { x: 0, y: 0, z: 0 }, 5, -1, 'welder');
  assert.ok(courier.speed > s.speed && courier.hp < s.hp, 'quick and flimsy');
  assert.ok(welder.hp > s.hp, 'tough');
});

test('server: a Welder\'s mask turns headshots into body shots; a Courier pays a tip', () => {
  const t = setup(1);
  try {
    t.s.phase = 'active';
    t.member(1).state.p = [0, 0.01, 0];
    const g = gunStats(STARTER, false);
    const w = zombieAt(t, { x: 0, y: 0, z: -5 }, 'welder');
    w.hp = 10000;
    t.lobby.handle(t.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1.6, -5], hits: [{ z: w.id, h: true }] });
    assert.equal(10000 - w.hp, bodyDamage(g));
    assert.ok(headDamage(g) > bodyDamage(g));
    const c = zombieAt(t, { x: 0, y: 0, z: -5 }, 'courier');
    const before = t.s.wallet.get(1)!.points;
    t.s.hurt(t.member(1), c, false, 9999, [0, 0, 1], false);
    assert.equal(t.s.wallet.get(1)!.points - before, killPoints(false) + JOBS.courier.points);
  } finally {
    t.done();
  }
});

test('server: a Stoker bursts when it dies, scorching players and zombies close by, not far ones', () => {
  const t = setup(2);
  try {
    t.s.phase = 'active';
    t.member(1).state.p = [1, 0.01, 0];
    t.member(2).state.p = [20, 0.01, 0];
    const hp2 = t.member(2).hp;
    const s = zombieAt(t, { x: 0, y: 0, z: 0 }, 'stoker');
    const near = zombieAt(t, { x: -1.5, y: 0, z: 0 });
    near.hp = JOBS.stoker.burstZombieDamage - 1;
    const far = zombieAt(t, { x: 10, y: 0, z: 0 });
    t.s.hurt(t.member(2), s, false, 9999, [0, 0, 1], false);
    assert.equal(t.member(1).hp, SURVIVAL.playerHp - JOBS.stoker.burstDamage);
    assert.equal(t.member(2).hp, hp2);
    assert.ok(!t.s.zombies.includes(near) && t.s.zombies.includes(far));
    assert.ok(t.sent[0].some((m) => m.t === 'zombieDied' && m.job === 'stoker'));
  } finally {
    t.done();
  }
});

// --- Round modifiers -----------------------------------------------------------------------------------------

test('modifiers: every 3rd round gets one, never the same twice in a row', () => {
  assert.equal(modFor(1, 0), null);
  assert.equal(modFor(2, 0.5), null);
  assert.ok(modFor(MOD.every, 0));
  for (const last of MOD_IDS) for (let r = 0; r < 1; r += 0.05) assert.notEqual(modFor(MOD.every * 2, r, last), last);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => modFor(3, i / 40)));
  assert.equal(seen.size, MOD_IDS.length, 'all of them come up');
});

test('server: a modifier round says so in the wave, changes the horde, and ends with its round', () => {
  const t = setup(1);
  try {
    const roll = (mod: ModId) => {
      t.s.rand = () => MOD_IDS.indexOf(mod) / MOD_IDS.length + 0.001;
      (t.s as unknown as { lastMod: null }).lastMod = null;
      t.s.round = MOD.every - 1;
      t.s.zombies.length = 0;
      t.s.startRound();
      assert.equal(t.s.mod, mod);
      assert.equal(t.s.info().mod, mod);
      t.s.rand = () => 0.99; // and no jobs
      for (let i = 0; i < 200 && !t.s.zombies.length; i++) t.s.tick(0.05);
      return t.s.zombies[0];
    };
    t.member(1).state.p = [0, 0.01, 18];
    const base = zombieStats(MOD.every);
    const rush = roll('rush');
    assert.ok(Math.abs(rush.speed - base.speed * MOD.rushSpeed) < 1e-9, 'faster');
    const tiny = roll('tiny');
    assert.equal(tiny.hp, Math.round(base.hp * MOD.tinyHp), 'weaker');
    roll('double');
    const z = t.s.zombies[0];
    const before = t.s.wallet.get(1)!.points;
    t.s.hurt(t.member(1), z, true, 99999, [0, 0, 1], false);
    assert.equal(t.s.wallet.get(1)!.points - before, 2 * killPoints(true));
    t.s.zombies.length = 0;
    t.s.toSpawn = 0;
    t.s.tick(0.05);
    assert.equal(t.s.phase, 'intermission');
    assert.equal(t.s.mod, null, 'it lasts the round');
  } finally {
    t.done();
  }
});

// --- The Skyline's roof: never a death trap ---------------------------------------------------------------------

test('server: the roof never hurts, however long you stay up there', () => {
  const t = setup(1);
  try {
    const m = t.member(1);
    m.state.p = [10, SKYLINE.roofY + 0.4, -20];
    for (let i = 0; i < 60 / 0.05; i++) t.s.tick(0.05);
    assert.equal(m.hp, SURVIVAL.playerHp);
    assert.ok(!(t.s as unknown as { isDown(id: number): boolean }).isDown(1));
  } finally {
    t.done();
  }
});

test('server: zombies never follow you onto the roof (they used to pounce up through the open hatch and maul you)', () => {
  const t = setup(1);
  try {
    const s = t.s as unknown as Internals & { doors: boolean[]; nav: { setDoors(d: boolean[]): void }; rebuildColliders(): void };
    s.doors = lay.doors.map(() => true);
    s.nav.setDoors(s.doors);
    s.rebuildColliders();
    s.toSpawn = 0;
    s.phase = 'active';
    const m = t.member(1);
    const hatch = lay.doors[lay.hatch].box;
    for (const spot of [[hatch.max.x + 1, 9.81, hatch.min.z + 1], [0, 16.01, -5.5], [-20, 9.81, -11]] as V3[]) {
      m.state.p = spot;
      s.zombies.length = 0;
      for (const [x, z] of [[0, 1], [-25, -5], [0, -25], [25, -5]]) zombieAt(t, { x, y: 0.01, z }).gate = -1;
      let top = 0;
      for (let i = 0; i < 30 / 0.05; i++) {
        s.tick(0.05);
        for (const z of s.zombies) top = Math.max(top, z.pos.y);
      }
      assert.equal(m.hp, SURVIVAL.playerHp, `at ${spot}`);
      assert.ok(top < 8.8, `at ${spot}: a zombie got up to ${top.toFixed(2)}`);
    }
  } finally {
    t.done();
  }
});
