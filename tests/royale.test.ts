import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRENADE } from '../src/shared/constants.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';
import { type LootItem, PHASES, ROYALE, crateRounds, findLoot, foundRounds, newZone, outside, planZone, rollLoot, stepZone, toSafety } from '../src/shared/royale.ts';
import { WEAPONS } from '../src/shared/weapons.ts';
import { WILDMERE } from '../src/shared/wildmere.ts';
import { Lobby } from '../src/server/lobby.ts';

const seq = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
};
const START = WILDMERE.royale!.zone;
const SPOTS = WILDMERE.royale!.loot;

test('zone plan: every circle lies inside the one before, and the last closes on a loot spot on the island', () => {
  for (let seed = 1; seed < 40; seed++) {
    const plan = planZone(START, SPOTS, seq(seed));
    assert.equal(plan.length, PHASES.length);
    let prev = START;
    for (const [i, c] of plan.entries()) {
      assert.equal(c.r, PHASES[i].r);
      assert.ok(Math.hypot(c.x - prev.x, c.z - prev.z) + c.r <= prev.r + 1e-6, `seed ${seed}: circle ${i} pokes out of the one before`);
      prev = c;
    }
    const end = plan[plan.length - 1];
    assert.ok(SPOTS.some((s) => s.x === end.x && s.z === end.z), 'the final circle is somewhere worth standing');
  }
});

test('zone timing: wait, shrink smoothly to the next circle, wait..., closed; outside is a column, measured to its edge', () => {
  const plan = planZone(START, SPOTS, seq(3));
  const z = newZone(START, plan);
  const dt = 0.05;
  const run = (secs: number) => {
    for (let t = 0; t < secs - 1e-9; t += dt) stepZone(z, plan, dt);
  };
  run(PHASES[0].wait - 1);
  assert.equal(z.r, START.r, 'still waiting');
  assert.ok(!z.shrinking);
  run(1 + PHASES[0].shrink / 2);
  assert.ok(z.shrinking);
  assert.ok(Math.abs(z.r - (START.r + plan[0].r) / 2) < 2, `halfway through the shrink: r=${z.r}`);
  run(PHASES[0].shrink / 2 + 0.1);
  assert.equal(z.ph, 1);
  assert.equal(z.r, plan[0].r);
  assert.equal(z.nr, plan[1].r);
  assert.equal(z.dps, PHASES[1].dps);
  const total = PHASES.reduce((a, p) => a + p.wait + p.shrink, 0);
  run(total);
  assert.equal(z.ph, PHASES.length);
  assert.equal(z.r, 0);
  const c = { x: plan[2].x, y: 0, z: plan[2].z };
  const z2 = { ...newZone(START, plan), x: c.x, z: c.z, r: 10 };
  assert.ok(!outside(z2, { x: c.x + 9, y: 50, z: c.z }));
  assert.ok(outside(z2, { x: c.x + 11, y: 0, z: c.z }));
  assert.equal(Math.round(toSafety(z2, { x: c.x, y: 0, z: c.z + 25 })), 15);
  assert.ok(PHASES.every((p, i) => i === 0 || p.dps > PHASES[i - 1].dps), 'later phases hurt more');
});

test('loot: every spot gets something, guns come with limited ammo, and F says what it would do', () => {
  const items = rollLoot(SPOTS, seq(5));
  assert.ok(items.length >= SPOTS.length);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  const guns = items.filter((i) => i.k === 'gun');
  assert.ok(guns.length > SPOTS.length * 0.3 && items.some((i) => i.k === 'heal') && items.some((i) => i.k === 'shield') && items.some((i) => i.k === 'nade'));
  for (const g of guns) assert.ok(g.n! > WEAPONS[g.w!].mag && g.n! < WEAPONS[g.w!].mag + WEAPONS[g.w!].reserve, 'a mag and a little spare');

  const gun: LootItem = { id: 1, k: 'gun', w: 'warden', p: [0, 0, 0], n: foundRounds('warden') };
  const kit = { hp: 100, shield: 0, nades: 0, guns: ['sparrow', null] as ('sparrow' | null)[] };
  assert.equal(findLoot({ x: 3, y: 0, z: 0 }, [gun], kit), null, 'out of reach');
  assert.match(findLoot({ x: 1, y: 0, z: 0 }, [gun], kit)!.text, /pick up the Warden/);
  assert.match(findLoot({ x: 1, y: 0, z: 0 }, [gun], { ...kit, guns: ['sparrow', 'bramble'] })!.text, /swap/);
  const heal: LootItem = { id: 2, k: 'heal', p: [0, 0, 0] };
  assert.equal(findLoot({ x: 0, y: 0, z: 0 }, [heal], kit)!.ready, false, 'full health: nothing to heal');
  assert.equal(findLoot({ x: 0, y: 0, z: 0 }, [heal], { ...kit, hp: 40 })!.ready, true);
  assert.equal(findLoot({ x: 0, y: 4, z: 0 }, [heal], { ...kit, hp: 40 }), null, 'a floor above does not count');
});

// ---------------------------------------------------------------------------
// The server

type Msg = ServerMsg;
function royaleLobby(n = 3) {
  const inbox = new Map<number, Msg[]>();
  const lobby = new Lobby('ROYL', 'battle', false, 'windward', () => {}, () => {}, false, true);
  const add = (id: number) => {
    inbox.set(id, []);
    const c = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, lobby: null };
    lobby.add(c);
    return c;
  };
  const clients = Array.from({ length: n }, (_, i) => add(i + 1));
  const m = (id: number) => lobby.members.get(id)!;
  const tick = (secs: number) => {
    for (let i = 0; i < Math.round(secs * 20); i++) lobby['tick']();
  };
  const of = <T extends Msg['t']>(id: number, t: T) => inbox.get(id)!.filter((x) => x.t === t) as Extract<Msg, { t: T }>[];
  const royale = lobby['royale']!;
  /** A shot from `a` at `b`'s chest (the rate limit is skipped: tests fire faster than people). */
  const shoot = (a: number, b: number | undefined, head = false) => {
    m(a).lastShot = 0;
    const from = m(a).state.p;
    const to = b === undefined ? ([from[0], from[1], from[2] - 20] as [number, number, number]) : ([m(b).state.p[0], m(b).state.p[1] + 1, m(b).state.p[2]] as [number, number, number]);
    lobby.handle(clients[a - 1], { t: 'shoot', from: [from[0], from[1] + 1.6, from[2]], to, victim: b, headshot: head || undefined });
  };
  const stop = () => [...lobby.members.values()].forEach((x) => lobby.remove(x.client));
  return { lobby, royale, clients, inbox, m, tick, of, shoot, add, stop };
}

test('server: a Royale lobby warms up on Wildmere, then drops everyone at spread-out spawns with a pistol, loot and a zone', () => {
  const h = royaleLobby(3);
  try {
    const joined = h.of(1, 'joined')[0];
    assert.equal(joined.br?.phase, 'warmup');
    assert.equal(joined.map, undefined, 'Royale is always on Wildmere');
    assert.ok(!joined.teams);
    assert.ok(h.of(1, 'loot')[0].items.length > 100, 'loot to play with in the warmup');
    assert.equal(joined.br!.left, ROYALE.warmupSolo, 'alone, the warmup is long...');
    assert.ok(h.of(1, 'royale').at(-1)!.info.left <= ROYALE.warmupCrowd, '...company shortens it');
    h.tick(ROYALE.warmupCrowd + 1);
    assert.equal(h.royale.phase, 'live');
    const snap = h.of(1, 'snapshot').at(-1)!;
    assert.ok(snap.zone && snap.zone.r === START.r);
    assert.ok(h.of(2, 'loot').some((l) => l.reset), 'fresh loot for the match');
    const ps = [1, 2, 3].map((id) => h.m(id).state.p);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(ps[i][0] - ps[j][0], ps[i][2] - ps[j][2]) > 60, 'spread out across the island');
    const me = h.of(1, 'me').at(-1)!;
    assert.deepEqual(me.slots, [{ w: 'sparrow', up: false }, null]);
    assert.equal(me.rounds?.[0], foundRounds('sparrow'));
  } finally {
    h.stop();
  }
});

test('server: health, damage from the gun you hold, headshots, limited ammo, no respawns, last one standing wins', () => {
  const h = royaleLobby(3);
  try {
    h.lobby.startMatch();
    const [a, b, c] = [1, 2, 3];
    h.shoot(a, b);
    assert.equal(h.m(b).hp, ROYALE.hp - WEAPONS.sparrow.damage);
    const hp = h.of(b, 'hp').at(-1)!;
    assert.equal(hp.hp, h.m(b).hp);
    assert.ok(hp.from, 'the victim learns where it came from');
    h.shoot(a, b, true);
    assert.equal(h.m(b).hp, ROYALE.hp - WEAPONS.sparrow.damage * (1 + WEAPONS.sparrow.headMult));
    while (h.m(b).info.alive) h.shoot(a, b);
    const kill = h.of(c, 'kill').at(-1)!;
    assert.equal(kill.victim, b);
    assert.equal(kill.cause, 'shot');
    h.tick(10);
    assert.ok(!h.m(b).info.alive, 'no respawn in a live Royale');
    assert.ok(h.of(c, 'loot').some((l) => l.items.some((i) => i.k === 'gun' && i.w === 'sparrow')), "the fallen player's pistol drops");

    // Ammo runs out: a shot from an empty gun isn't relayed and does nothing.
    const left = h.royale['kits'].get(a)!.rounds[0];
    for (let i = 0; i < left; i++) h.shoot(a, undefined);
    const shots = h.of(c, 'shot').length;
    const hpC = h.m(c).hp;
    h.shoot(a, c);
    assert.equal(h.of(c, 'shot').length, shots, 'empty: no shot');
    assert.equal(h.m(c).hp, hpC);

    // c knifes a to death; c is the last one standing.
    h.m(c).state.p = [h.m(a).state.p[0] + 1, h.m(a).state.p[1], h.m(a).state.p[2]];
    while (h.m(a).info.alive) {
      h.m(c).lastShot = 0;
      const to = h.m(a).state.p;
      h.lobby.handle(h.clients[c - 1], { t: 'shoot', from: [to[0] + 1, to[1] + 1.6, to[2]], to: [to[0], to[1] + 1, to[2]], victim: a, knife: true });
    }
    const over = h.of(b, 'matchOver').at(-1)!;
    assert.deepEqual(over.winner, { id: c });
    assert.equal(h.royale.phase, 'over');
    h.lobby['overAt'] = Date.now() - 1; // the scores have been up long enough
    h.tick(0.05);
    assert.equal(h.royale.phase, 'live', 'a fresh match after the scores');
    assert.ok([a, b, c].every((id) => h.m(id).info.alive && h.m(id).hp === ROYALE.hp), 'everyone back in');
  } finally {
    h.stop();
  }
});

test('server: the zone hurts outside it (shields do not help), more as it closes', () => {
  const h = royaleLobby(2);
  try {
    h.lobby.startMatch();
    const z = h.royale.zone!;
    h.royale['kits'].get(1)!.shield = 100;
    h.m(1).state.p = [z.x + z.r + 30, 0, z.z]; // outside
    h.m(2).state.p = [z.x, 0, z.z]; // the middle
    h.tick(2);
    assert.ok(Math.abs(h.m(1).hp - (ROYALE.hp - PHASES[0].dps * 2)) < 0.01, `hp ${h.m(1).hp}`);
    assert.equal(h.m(2).hp, ROYALE.hp);
    assert.equal(h.royale['kits'].get(1)!.shield, 100);
    z.dps = 60;
    h.tick(3);
    assert.ok(!h.m(1).info.alive, 'the zone got them');
    assert.equal(h.of(2, 'kill').at(-1)!.cause, 'zone');
    assert.deepEqual(h.of(2, 'matchOver').at(-1)!.winner, { id: 2 });
  } finally {
    h.stop();
  }
});

test('server: F picks loot up for one player only; a third gun swaps the one in your hands onto the floor', () => {
  const h = royaleLobby(2);
  try {
    h.lobby.startMatch();
    const items = (): LootItem[] => [...h.royale.loot.values()];
    const place = (it: LootItem) => (h.m(1).state.p = [it.p[0] + 0.5, it.p[1], it.p[2]]);
    const gun = items().find((i) => i.k === 'gun' && i.w !== 'sparrow')!;
    place(gun);
    h.lobby.handle(h.clients[0], { t: 'use', kind: 'loot', id: gun.id });
    assert.ok(!h.royale.loot.has(gun.id));
    assert.deepEqual(h.of(2, 'looted').at(-1), { t: 'looted', id: gun.id, by: 1 }, 'everyone sees it gone');
    const me = h.of(1, 'me').at(-1)!;
    assert.equal(me.slots[1]?.w, gun.w);
    assert.equal(me.cur, 1);
    assert.equal(me.rounds?.[1], gun.n);

    // Player 2 can't take it any more, even standing right there.
    h.m(2).state.p = [...h.m(1).state.p];
    const before = h.of(2, 'me').length;
    h.lobby.handle(h.clients[1], { t: 'use', kind: 'loot', id: gun.id });
    assert.equal(h.of(2, 'me').length, before);

    // A third gun: swap the one in hand (it drops, keeping its rounds).
    const third = items().find((i) => i.k === 'gun' && i.w !== 'sparrow' && i.w !== gun.w)!;
    place(third);
    h.lobby.handle(h.clients[0], { t: 'use', kind: 'loot', id: third.id });
    assert.equal(h.of(1, 'me').at(-1)!.slots[1]?.w, third.w);
    const dropped = h.of(2, 'loot').at(-1)!.items[0];
    assert.equal(dropped.w, gun.w);
    assert.equal(dropped.n, gun.n);

    // Ammo crate: a couple of mags for each gun.
    const crate = items().find((i) => i.k === 'ammo')!;
    place(crate);
    h.lobby.handle(h.clients[0], { t: 'use', kind: 'loot', id: crate.id });
    assert.deepEqual(h.of(1, 'ammo').at(-1)!.add, [crateRounds('sparrow'), crateRounds(third.w!)]);

    // Shield and grenades.
    const tea = items().find((i) => i.k === 'shield')!;
    place(tea);
    h.lobby.handle(h.clients[0], { t: 'use', kind: 'loot', id: tea.id });
    assert.equal(h.of(1, 'hp').at(-1)!.sh, ROYALE.shield);
    const nade = items().find((i) => i.k === 'nade')!;
    place(nade);
    h.lobby.handle(h.clients[0], { t: 'use', kind: 'loot', id: nade.id });
    assert.equal(h.of(1, 'me').at(-1)!.nades, ROYALE.nadeBundle);
    // Grenades are counted: two throws, then no more.
    for (let i = 0; i < 3; i++) {
      h.m(1).nadeAt = 0;
      h.lobby.handle(h.clients[0], { t: 'nade', p: h.m(1).state.p, v: [0, 5, -5] });
    }
    assert.equal(h.of(2, 'nade').length, ROYALE.nadeBundle);
    assert.ok(GRENADE.cooldown > 0);

    // A shield soaks a shot before health does.
    h.shoot(2, 1);
    assert.equal(h.m(1).hp, ROYALE.hp);
    assert.equal(h.of(1, 'hp').at(-1)!.sh, ROYALE.shield - WEAPONS.sparrow.damage);
  } finally {
    h.stop();
  }
});

test('server: joining mid-match you watch until the next one; a solo run ends when you go down', () => {
  const h = royaleLobby(1);
  try {
    h.lobby.startMatch();
    h.add(9);
    const joined = h.of(9, 'joined')[0];
    assert.equal(joined.br?.phase, 'live');
    assert.ok(!h.m(9).info.alive && !joined.players.find((p) => p.id === 9)!.alive);
    h.tick(5);
    assert.ok(!h.m(9).info.alive, 'still watching');
    h.lobby.handle(h.clients[0], { t: 'fell' });
    assert.deepEqual(h.of(9, 'matchOver').at(-1)!.winner, { id: -1 }, 'nobody wins a solo run');
    h.lobby['overAt'] = Date.now() - 1;
    h.tick(0.05);
    assert.ok(h.m(1).info.alive && h.m(9).info.alive, 'both drop into the next one');
  } finally {
    h.stop();
  }
});
