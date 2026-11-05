// Contraptions: the Tinker's Workbench, placement (shared by the client's ghost and the server), the limits, and each
// contraption against zombies on the server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby, type Member } from '../../src/gambol/server/lobby.ts';
import { buildColliders } from '../../src/gambol/shared/colliders.ts';
import { SURVIVAL, TICK_DT } from '../../src/gambol/shared/constants.ts';
import { CONTRAPTIONS, CONTRAPTION_KINDS, type ContraptionKind, WORKSHOP, contraptionDamage, floorUnder, placeProblem } from '../../src/gambol/shared/contraptions.ts';
import { FOUNDRY } from '../../src/gambol/shared/foundry.ts';
import { type UseCtx, findUse, killPoints } from '../../src/gambol/shared/interact.ts';
import type { Vec3 } from '../../src/shared/math.ts';
import { createPlayerState, emptyInput, stepPlayer } from '../../src/gambol/shared/movement.ts';
import type { ServerMsg, V3 } from '../../src/gambol/shared/protocol.ts';
import { type Zombie, createZombie, stepHorde } from '../../src/gambol/shared/zombie.ts';

const lay = FOUNDRY.survival!;
const allOpen = lay.doors.map(() => true);

interface Internals {
  wallet: Map<number, { points: number }>;
  zombies: Zombie[];
  round: number;
  phase: string;
  timer: number;
  toSpawn: number;
  clock: number;
  rand: () => number;
  doors: boolean[];
  nav: { setDoors(d: boolean[]): void };
  workshop: { list: { id: number; kind: ContraptionKind; pos: Vec3; owner: number }[]; piles: { n: number; from: number; pos: Vec3; charges: number }[]; builtAt: Map<number, number> };
  rebuildColliders(): void;
  tick(dt: number): void;
  reset(): void;
  isDown(id: number): boolean;
  goDown(m: Member): void;
}

type Client = { id: number; ws: { readyState: number; send: (d: string) => void }; name: string; lobby: null };

function setup(players = 1) {
  const sent: ServerMsg[][] = [];
  const lobby = new Lobby('TINK', 'survival', false, 'windward', () => {}, () => {});
  const mk = (i: number): Client => {
    sent.push([]);
    return { id: i + 1, ws: { readyState: 1, send: (d: string) => sent[i].push(JSON.parse(d)) }, name: `p${i + 1}`, lobby: null };
  };
  const clients = Array.from({ length: players }, (_, i) => mk(i));
  for (const c of clients) lobby.add(c);
  const s = (lobby as unknown as { survival: Internals }).survival;
  // Round 1, but no round clock: the round would otherwise end (no zombies) and the next one bring a horde in.
  s.toSpawn = 0;
  s.phase = 'intermission';
  s.timer = 1e9;
  s.round = 1;
  let seed = 7;
  s.rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; // fixed dice: where spike piles land
  const member = (id = 1): Member => lobby.members.get(id)!;
  const at = (id: number, p: Vec3) => (member(id).state.p = [p.x, p.y + 0.01, p.z]);
  const open = (doors = allOpen) => {
    s.doors = [...doors];
    s.nav.setDoors(s.doors);
    s.rebuildColliders();
  };
  /** Build as player `id`, standing right beside the spot (and past the build cooldown). */
  const build = (id: number, k: ContraptionKind, p: Vec3) => {
    at(id, { x: p.x + 1, y: p.y, z: p.z });
    s.workshop.builtAt.delete(id);
    lobby.handle(clients[id - 1], { t: 'build', k, p: [p.x, p.y, p.z], yaw: 0 });
    return s.workshop.list.at(-1)!;
  };
  /** A zombie that stays put (so we test the contraption, not the chase). */
  const zombie = (p: Vec3, hp = 5000) => {
    const z = createZombie(9000 + s.zombies.length, p, 1, -1);
    z.hp = hp;
    z.speed = 0;
    z.leapCooldown = 1e9;
    s.zombies.push(z);
    return z;
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds / 0.05; i++) s.tick(0.05);
  };
  const add = () => {
    const c = mk(clients.length);
    clients.push(c);
    lobby.add(c);
    return c;
  };
  const done = () => clients.forEach((c) => lobby.remove(c));
  return { lobby, s, clients, sent, member, at, open, build, zombie, run, add, done };
}

const ctx = (over: Partial<UseCtx> = {}): UseCtx => ({
  lay, doorsOpen: [], boards: [], box: { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 },
  points: 0, slots: [{ w: 'sparrow', up: false }, null], cur: 0, jug: false, perks: [], downed: [], self: 1, power: false, parts: [], scythe: 0, ...over,
});

const place = (p: Vec3, doors: boolean[] = [], others: { pos: Vec3 }[] = []) => placeProblem(p, { map: FOUNDRY, boxes: buildColliders(FOUNDRY, doors).move, doorsOpen: doors, others });

// --- The bench ---------------------------------------------------------------------------------------------

test("the Tinker's Workbench stands in the Office (the start room); F beside it opens the menu", () => {
  const office = lay.rooms.find((r) => r.name === 'Office')!;
  assert.equal(lay.startRoom, office.id);
  const b = lay.tinker.pos;
  assert.ok(b.x > office.x0 && b.x < office.x1 && b.z > office.z0 && b.z < office.z1);
  const u = findUse({ x: b.x - 1.3, y: 0.01, z: b.z }, ctx());
  assert.equal(u?.kind, 'tinker');
  assert.equal(u?.status, 'ready');
  assert.notEqual(findUse({ x: 0, y: 0.01, z: 18 }, ctx())?.kind, 'tinker', 'not from across the room');
  // You can walk up to it: the spot in front is clear floor.
  const s = createPlayerState({ x: b.x - 1.3, y: 0.01, z: b.z });
  for (let i = 0; i < 64; i++) stepPlayer(s, emptyInput(), TICK_DT, buildColliders(FOUNDRY).move);
  assert.ok(s.onGround && Math.abs(s.pos.x - (b.x - 1.3)) < 0.01);
});

// --- Placement ---------------------------------------------------------------------------------------------

test('placement: open floor in an opened room, and nowhere silly', () => {
  assert.equal(place({ x: 0, y: 0, z: 18 }), null, 'the Office floor');
  assert.equal(place({ x: 0, y: 0, z: 0 }), 'Open that room first');
  assert.equal(place({ x: 0, y: 0, z: 0 }, [true]), null, 'the Hall, once its door is open');
  assert.equal(place({ x: 0, y: 4, z: -15 }, [true]), null, 'the mezzanine');
  assert.equal(place({ x: 10, y: 9.8, z: -20 }, allOpen), 'Not on the roof');
  assert.equal(place({ x: -44, y: 0, z: 0 }, allOpen), 'Only inside the building', 'the yard');
  assert.equal(place({ x: 5.9, y: 0, z: 15 }), 'Something is in the way', 'half in a wall');
  assert.equal(place({ x: 0, y: 0, z: 12.4 }), 'Something is in the way', 'in the shut doorway');
  const win = lay.barricades[0];
  assert.equal(place({ x: win.pos.x, y: 0, z: win.pos.z }), 'Something is in the way', 'in a window');
  assert.equal(place({ ...lay.tinker.pos, y: 0.95 }), 'Needs flat floor', 'not on a workbench');
  const pad = lay.hatchPad;
  assert.notEqual(place({ x: (pad.min.x + pad.max.x) / 2, y: 0, z: (pad.min.z + pad.max.z) / 2 }, allOpen), null, 'not on the Skyline pad');
  assert.equal(place({ x: -15.9, y: 2, z: -6 }, allOpen), 'Needs flat floor', 'not on the stairs');
  assert.equal(place({ x: 1, y: 0, z: 18 }, [], [{ pos: { x: 0, y: 0, z: 18 } }]), 'Too close to another contraption');
  assert.equal(place({ x: 2, y: 0, z: 18 }, [], [{ pos: { x: 0, y: 0, z: 18 } }]), null);
  // The ghost lands on whatever flat top the crosshair is on.
  const boxes = buildColliders(FOUNDRY).move;
  assert.deepEqual(floorUnder({ x: 0, y: 0.002, z: 18 }, boxes), { x: 0, y: 0, z: 18 });
  assert.equal(floorUnder({ x: -3.6, y: 0.9, z: 13.9 }, boxes)?.y, 0.9, 'a crate top');
});

// --- Building, limits, refunds -------------------------------------------------------------------------------

test('server: a build goes out to everyone; a bad one is refused and refunded', () => {
  const t = setup(2);
  try {
    const g = t.build(1, 'tacks', { x: 0, y: 0, z: 18 });
    assert.equal(g.kind, 'tacks');
    assert.equal(g.owner, 1);
    for (const inbox of t.sent) assert.ok(inbox.some((m) => m.t === 'contraptions' && m.list.some((c) => c.id === g.id && c.k === 'tacks')));
    const refund = () => t.sent[0].filter((m) => m.t === 'refund').at(-1);
    t.build(1, 'goo', { x: 0, y: 0, z: 0 }); // the Hall is still shut
    assert.equal(t.s.workshop.list.length, 1);
    assert.deepEqual(refund(), { t: 'refund', k: 'goo', share: 1, why: 'Open that room first' });
    // Too far from where you stand.
    t.s.workshop.builtAt.delete(1);
    t.at(1, { x: 0, y: 0, z: 23 });
    t.lobby.handle(t.clients[0], { t: 'build', k: 'goo', p: [-4, 0, 13 - WORKSHOP.reach], yaw: 0 });
    assert.equal(refund()?.t === 'refund' && refund()!.why, 'Too far away');
    // Rubbish in the message.
    t.s.workshop.builtAt.delete(1);
    t.lobby.handle(t.clients[0], { t: 'build', k: 'nope' as ContraptionKind, p: [0, 0, 20], yaw: 0 });
    t.lobby.handle(t.clients[0], { t: 'build', k: 'goo', p: [NaN, 0, 20] as V3, yaw: 0 });
    assert.equal(t.s.workshop.list.length, 1);
    // Down: no building.
    t.s.goDown(t.member(1));
    t.build(1, 'goo', { x: -3, y: 0, z: 20 });
    assert.equal(refund()?.t === 'refund' && refund()!.why, "Can't build right now");
  } finally {
    t.done();
  }
});

test('server: limits per player, per lobby, and a cooldown between builds', () => {
  const t = setup(4);
  try {
    t.open();
    t.build(1, 'spikes', { x: -12, y: 0, z: 0 });
    t.at(1, { x: -9, y: 0, z: 0 });
    t.lobby.handle(t.clients[0], { t: 'build', k: 'spikes', p: [-8, 0, 0], yaw: 0 });
    assert.equal(t.s.workshop.list.length, 1, 'cooldown');
    for (let i = 1; i < WORKSHOP.perPlayer + 2; i++) t.build(1, 'spikes', { x: -12 + i * 2, y: 0, z: 0 });
    assert.equal(t.s.workshop.list.filter((g) => g.owner === 1).length, WORKSHOP.perPlayer);
    for (const id of [2, 3, 4]) for (let i = 0; i < WORKSHOP.perPlayer; i++) t.build(id, 'spikes', { x: -12 + i * 2, y: 0, z: -2 * id });
    assert.equal(t.s.workshop.list.length, WORKSHOP.perLobby);
    const last = t.sent[3].filter((m) => m.t === 'refund').at(-1);
    assert.ok(last?.t === 'refund' && /full/.test(last.why));
  } finally {
    t.done();
  }
});

test('server: F on your own contraption scraps it for half its coins; nobody else can', () => {
  const t = setup(2);
  try {
    const g = t.build(1, 'owl', { x: 0, y: 0, z: 18 });
    const near = { x: 0.8, y: 0.01, z: 18 };
    assert.equal(findUse(near, ctx({ self: 2, contraptions: [{ id: g.id, k: 'owl', pos: g.pos, owner: 1 }] }))?.kind ?? null, null);
    assert.equal(findUse(near, ctx({ contraptions: [{ id: g.id, k: 'owl', pos: g.pos, owner: 1 }] }))?.kind, 'scrap');
    t.at(2, near);
    t.lobby.handle(t.clients[1], { t: 'use', kind: 'scrap', id: g.id });
    assert.equal(t.s.workshop.list.length, 1);
    t.at(1, near);
    t.lobby.handle(t.clients[0], { t: 'use', kind: 'scrap', id: g.id });
    assert.equal(t.s.workshop.list.length, 0);
    assert.deepEqual(t.sent[0].filter((m) => m.t === 'refund').at(-1), { t: 'refund', k: 'owl', share: WORKSHOP.scrapShare, why: 'Scrapped' });
  } finally {
    t.done();
  }
});

// --- Against zombies ---------------------------------------------------------------------------------------

test('each damaging contraption hurts zombies in range and leaves those out of range alone', () => {
  const cases: [ContraptionKind, Vec3, Vec3, Vec3][] = [
    // kind, where it stands, a zombie in range, one out of range
    ['tacks', { x: 0, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }, { x: 4.5, y: 0, z: 0 }],
    ['lobber', { x: -10, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }],
    ['zapper', { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 0, y: 0, z: 9 }],
    ['owl', { x: -17, y: 0, z: 3 }, { x: 10, y: 0, z: -1 }, { x: 17, y: 0, z: -2 }],
  ];
  for (const [kind, at, near, far] of cases) {
    const t = setup(1);
    try {
      t.open();
      t.at(1, { x: 0, y: 0, z: 20 });
      const g = t.build(1, kind, at);
      t.at(1, { x: 0, y: 0, z: 20 });
      const zn = t.zombie(near);
      const zf = t.zombie(far);
      t.run(6);
      assert.ok(zn.hp < 5000, `${kind}: the one in range was hit`);
      assert.equal(zf.hp, 5000, `${kind}: the one out of range wasn't`);
      assert.ok(t.sent[0].some((m) => m.t === 'cfx' && m.id === g.id), `${kind}: everyone sees it work`);
    } finally {
      t.done();
    }
  }
});

test('walls block them: no tacks or zaps through a wall', () => {
  const t = setup(1);
  try {
    t.open();
    t.build(1, 'zapper', { x: 0, y: 0, z: 14 }); // the Office, 2 m from the Hall's wall
    t.at(1, { x: 0, y: 0, z: 20 });
    const behind = t.zombie({ x: 4, y: 0, z: 10 }); // in the Hall, behind the wall
    t.run(4);
    assert.equal(behind.hp, 5000);
  } finally {
    t.done();
  }
});

test('a bomb hits where it lands, a moment later, and the whole bunch around it', () => {
  const t = setup(1);
  try {
    t.open();
    t.build(1, 'lobber', { x: -8, y: 0, z: 0 });
    t.at(1, { x: 0, y: 0, z: 20 });
    const target = t.zombie({ x: 0, y: 0, z: 0 });
    const beside = t.zombie({ x: 0, y: 0, z: 1.5 });
    const apart = t.zombie({ x: 0, y: 0, z: WORKSHOP.bombRadius + 2 });
    t.run(0.6); // lobbed, still in the air
    assert.ok(t.sent[0].some((m) => m.t === 'cfx' && m.fx === 'bomb'));
    assert.equal(target.hp, 5000);
    t.run(WORKSHOP.bombFlight);
    assert.ok(target.hp < 5000 && beside.hp < 5000);
    assert.ok(beside.hp > target.hp, 'less toward the edge');
    assert.ok(apart.hp === 5000 || apart.hp > beside.hp, 'beyond the blast');
  } finally {
    t.done();
  }
});

test('the zapper chains from zombie to zombie, weaker each jump, only to ones close enough', () => {
  const t = setup(1);
  try {
    t.open();
    t.build(1, 'zapper', { x: 0, y: 0, z: 0 });
    t.at(1, { x: 0, y: 0, z: 20 });
    const chain = [t.zombie({ x: 4, y: 0, z: -2 }), t.zombie({ x: 7, y: 0, z: -2 }), t.zombie({ x: 10, y: 0, z: -2 })];
    const lone = t.zombie({ x: 10 + WORKSHOP.zapHop + 1, y: 0, z: -2 });
    t.run(0.6);
    const lost = chain.map((z) => 5000 - z.hp);
    const d = contraptionDamage('zapper', 1);
    assert.deepEqual(lost, [d, Math.round(d * WORKSHOP.zapFalloff), Math.round(Math.round(d * WORKSHOP.zapFalloff) * WORKSHOP.zapFalloff)]);
    assert.equal(lone.hp, 5000);
    const zap = t.sent[0].find((m) => m.t === 'cfx' && m.fx === 'zap');
    assert.equal(zap?.t === 'cfx' && zap.p?.length, 3);
  } finally {
    t.done();
  }
});

test('the spike dispenser keeps a few piles out; zombies on one get poked and the pile wears out', () => {
  const t = setup(1);
  try {
    t.open();
    const g = t.build(1, 'spikes', { x: 0, y: 0, z: 0 });
    t.at(1, { x: 0, y: 0, z: 20 });
    t.run(CONTRAPTIONS.spikes.every * (WORKSHOP.spikePiles + 2));
    const piles = t.s.workshop.piles.filter((p) => p.from === g.id);
    assert.equal(piles.length, WORKSHOP.spikePiles, 'up to its limit');
    for (const p of piles) assert.ok(Math.hypot(p.pos.x, p.pos.z) <= CONTRAPTIONS.spikes.range + 0.01);
    // One pile on its own (no new ones dropping meanwhile), so we can count its pokes.
    const pile = piles[0];
    t.s.workshop.piles = [pile];
    (g as unknown as { cd: number }).cd = 1e9;
    const z = t.zombie({ ...pile.pos });
    t.run(WORKSHOP.spikePoke * 2);
    assert.ok(z.hp < 5000, 'poked');
    t.run(WORKSHOP.spikePoke * (WORKSHOP.spikeCharges + 2));
    assert.equal(5000 - z.hp, contraptionDamage('spikes', 1) * WORKSHOP.spikeCharges, 'as many pokes as it had');
    assert.ok(!t.s.workshop.piles.includes(pile), 'worn out');
    assert.ok(t.sent[0].some((m) => m.t === 'cfx' && m.fx === 'pileGone' && m.n === pile.n));
    const away = t.zombie({ x: 12, y: 0, z: 8 });
    t.run(2);
    assert.equal(away.hp, 5000, 'nothing off the piles');
  } finally {
    t.done();
  }
});

test('goo slows zombies in range (only zombies), and none out of range', () => {
  const t = setup(1);
  try {
    t.open();
    t.build(1, 'goo', { x: 0, y: 0, z: 0 });
    const me = t.member(1);
    t.at(1, { x: 1.5, y: 0, z: 0 }); // standing right in the spray
    me.state.v = [5, 0, 0];
    const before = JSON.stringify(me.state);
    const inside = t.zombie({ x: 3, y: 0, z: 0 });
    const outside = t.zombie({ x: 0, y: 0, z: 9 });
    t.run(1);
    assert.ok((inside.goo ?? 0) > 0);
    assert.ok(!outside.goo);
    assert.equal(inside.hp, 5000, 'goo does no damage');
    assert.equal(JSON.stringify(me.state), before, 'the player is untouched');
    assert.equal(me.hp, SURVIVAL.playerHp);
    // A gooed zombie covers much less ground.
    const walk = (goo: boolean) => {
      const z = createZombie(1, { x: 0, y: 0.01, z: 0 }, 1, -1);
      const boxes = buildColliders(FOUNDRY, allOpen).zombie;
      for (let i = 0; i < 60; i++) {
        if (goo) z.goo = WORKSHOP.gooFor;
        stepHorde([z], [{ id: 1, pos: { x: 12, y: 0, z: 0 } }], 1 / 60, boxes);
      }
      return z.pos.x;
    };
    assert.ok(walk(true) < walk(false) * (WORKSHOP.gooSlow + 0.1), `${walk(true)} vs ${walk(false)}`);
  } finally {
    t.done();
  }
});

test("kills by a contraption are its owner's: kill points, a kill on the board, and the killfeed knows who did it", () => {
  const t = setup(1);
  try {
    t.open();
    t.build(1, 'tacks', { x: 0, y: 0, z: 0 });
    t.at(1, { x: 0, y: 0, z: 20 });
    const pts = t.s.wallet.get(1)!.points;
    const z = t.zombie({ x: 1.5, y: 0, z: 0 }, 10);
    t.run(1);
    assert.ok(!t.s.zombies.includes(z));
    assert.equal(t.s.wallet.get(1)!.points, pts + killPoints(false));
    assert.equal(t.member(1).info.kills, 1);
    const died = t.sent[0].find((m) => m.t === 'zombieDied');
    assert.ok(died?.t === 'zombieDied' && died.by === 'tacks' && died.killer === 1);
  } finally {
    t.done();
  }
});

test('damage grows with the rounds, slower than the zombies do', () => {
  for (const k of CONTRAPTION_KINDS) assert.ok(contraptionDamage(k, 10) >= contraptionDamage(k, 1));
  assert.ok(contraptionDamage('owl', 10) / contraptionDamage('owl', 1) < (80 + 18 * 9) / 80);
});

test('late joiners get the list; a new run clears everything; leaving takes yours with you', () => {
  const t = setup(2);
  try {
    t.open();
    const g = t.build(1, 'spikes', { x: 0, y: 0, z: 0 });
    t.build(2, 'owl', { x: 4, y: 0, z: -3 });
    t.run(CONTRAPTIONS.spikes.every + 0.6);
    const c = t.add();
    const got = t.sent[2].filter((m) => m.t === 'contraptions').at(-1);
    assert.ok(got?.t === 'contraptions' && got.list.length === 2 && got.piles.length >= 1, 'the newcomer sees them all');
    t.lobby.remove(t.clients[0]);
    assert.deepEqual(t.s.workshop.list.map((x) => x.owner), [2]);
    assert.ok(!t.s.workshop.piles.some((p) => p.from === g.id), 'and their piles');
    t.s.reset();
    assert.equal(t.s.workshop.list.length, 0);
    const last = t.sent[2].filter((m) => m.t === 'contraptions').at(-1);
    assert.ok(last?.t === 'contraptions' && last.list.length === 0);
    void c;
  } finally {
    t.done();
  }
});
