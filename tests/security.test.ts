// Hardening: the server-side stash (cases, the Casino, match pay, Workbench builds), message validation, names and
// rate limits. Coins of a signed-in player must only change through the server's own rules and dice.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Bank, Lobby } from '../src/server/lobby.ts';
import { Limiter } from '../src/server/limiter.ts';
import type { KV } from '../src/server/accountStore.ts';
import { STASH_IMPORT_COINS, StashStore } from '../src/server/stashStore.ts';
import { cleanName } from '../src/shared/account.ts';
import { CRASH, crashMult, crashTime } from '../src/shared/casino.ts';
import { CONTRAPTIONS } from '../src/shared/contraptions.ts';
import { newInv } from '../src/shared/inventory.ts';
import { COIN } from '../src/shared/items.ts';
import { XP } from '../src/shared/levels.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';
import { type Table, applyStash } from '../src/shared/stash.ts';
import { KILL_LIMIT } from '../src/shared/teams.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function kv() {
  const data = new Map<string, unknown>();
  const store: KV = {
    get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
  };
  return { data, store };
}

// --- The stash rules (shared/stash.ts) ----------------------------------------------------------------------

test('stash: cases cost their price and drop an owned item; selling and equipping only work on your own items', () => {
  const inv = newInv();
  inv.coins = 10_000;
  const r = applyStash(inv, {}, { a: 'case', id: 'sky' }, seeded(1), 0);
  assert.ok(r.ok && r.got);
  assert.ok(inv.coins < 10_000);
  assert.ok(!applyStash(inv, {}, { a: 'case', id: 'nope' as 'sky' }, seeded(1), 0).ok);
  assert.ok(!applyStash(inv, {}, { a: 'sell', u: 999 }, seeded(1), 0).ok);
  assert.ok(!applyStash(inv, {}, { a: 'equip', u: 999 }, seeded(1), 0).ok);
  const before = inv.coins;
  const s = applyStash(inv, {}, { a: 'sell', u: r.got!.u }, seeded(1), 0);
  assert.ok(s.ok && s.paid! > 0 && inv.coins === before + s.paid!);
});

test('stash: bets must be whole coins you have', () => {
  const inv = newInv();
  for (const bet of [0, -5, 1.5, Number.NaN, inv.coins + 1, '10' as unknown as number]) {
    const r = applyStash(inv, {}, { a: 'plinko', bet }, seeded(2), 0);
    assert.ok(!r.ok, String(bet));
  }
  assert.equal(inv.coins, COIN.start);
});

test('stash: Plinko takes the bet and pays the drop it rolled', () => {
  const inv = newInv();
  const r = applyStash(inv, {}, { a: 'plinko', bet: 100 }, seeded(3), 0);
  assert.ok(r.ok && r.drop);
  assert.equal(inv.coins, COIN.start - 100 + r.paid!);
});

test('stash: Blackjack hides the hole card while you play, pays a hand once, and stands an abandoned one', () => {
  const rnd = seeded(4);
  for (let i = 0; i < 40; i++) {
    const inv = newInv();
    const table: Table = {};
    const r = applyStash(inv, table, { a: 'bj', op: 'deal', bet: 10 }, rnd, 0);
    assert.ok(r.ok && r.round);
    if (!r.round.done) {
      assert.equal(r.round.dealer.length, 1, 'no hole card while the hand is live');
      assert.ok(!('shoe' in r));
      // Walk away, then deal again: the old hand is stood (and paid) first.
      const coins = inv.coins;
      const old = structuredClone(table.bj!);
      const again = applyStash(inv, table, { a: 'bj', op: 'deal', bet: 10 }, rnd, 0);
      assert.ok(again.ok);
      assert.ok(old && inv.coins >= coins - 10);
    } else {
      assert.equal(inv.coins, COIN.start - 10 + r.round.payout);
      assert.equal(table.bj, undefined, 'a finished hand is gone, so it cannot be paid twice');
      assert.ok(!applyStash(inv, table, { a: 'bj', op: 'stand' }, rnd, 0).ok);
    }
  }
});

test('stash: a Crash kite keeps its snap point secret, and you can only cash out at what it has really reached', () => {
  // Find dice that make a kite fly past 2×.
  let rnd = seeded(5);
  let inv = newInv();
  let table: Table = {};
  let launch;
  for (let i = 0; ; i++) {
    inv = newInv();
    table = {};
    rnd = seeded(100 + i);
    launch = applyStash(inv, table, { a: 'crash', op: 'launch', bet: 100 }, rnd, 0);
    if (table.crash && table.crash.at > 2.5) break;
  }
  assert.ok(launch.ok && launch.crash && launch.crash.at === undefined, 'the snap point is not sent');
  const at = table.crash!.at;
  const t1 = crashTime(1.5) * 1000 + 1;
  // Peeking before it snaps says nothing about where it will.
  const peek = applyStash(inv, table, { a: 'crash', op: 'peek' }, rnd, t1);
  assert.ok(peek.ok && peek.crash?.at === undefined);
  // Asking for more than the kite has reached gets what it has reached.
  const cash = applyStash(inv, table, { a: 'crash', op: 'cash', m: 50 }, rnd, t1);
  assert.ok(cash.ok && cash.crash?.cashed !== undefined);
  assert.ok(cash.crash!.cashed! <= crashMult(t1 / 1000));
  assert.equal(inv.coins, COIN.start - 100 + cash.paid!);
  assert.ok(!applyStash(inv, table, { a: 'crash', op: 'cash', m: 1.2 }, rnd, t1).ok, 'only once');
  // After it snaps a peek reveals where.
  const late = applyStash(inv, table, { a: 'crash', op: 'peek' }, rnd, crashTime(at) * 1000 + 10);
  assert.ok(late.ok && late.crash?.at === at);
  assert.ok(at <= CRASH.max);
});

test('stash: cashing out after the string snapped pays nothing', () => {
  for (let i = 0; i < 50; i++) {
    const inv = newInv();
    const table: Table = {};
    const rnd = seeded(300 + i);
    applyStash(inv, table, { a: 'crash', op: 'launch', bet: 50 }, rnd, 0);
    if (!table.crash) continue;
    const after = crashTime(table.crash.at) * 1000 + 5;
    const coins = inv.coins;
    const r = applyStash(inv, table, { a: 'crash', op: 'cash', m: 1.01 }, rnd, after);
    assert.ok(r.ok && r.crash?.cashed === undefined && r.crash?.at !== undefined);
    assert.equal(inv.coins, coins);
  }
});

// --- The account's stash on the server (server/stashStore.ts) --------------------------------------------------

test('stash store: the server pays and charges, never below zero, and a browser stash is adopted once, coins capped', async () => {
  const { store } = kv();
  const s = new StashStore(store, seeded(6), () => 0);
  assert.equal(await s.has('Mike'), false);
  const adopted = await s.adopt('Mike', { coins: 1e12, xp: 500, items: [{ u: 1, id: 'nope' }] });
  assert.equal(adopted.coins, STASH_IMPORT_COINS);
  assert.equal(adopted.xp, 500);
  assert.equal(adopted.items.length, 0, 'unknown items are dropped');
  const again = await s.adopt('mike', { coins: 1e12 });
  assert.equal(again.coins, STASH_IMPORT_COINS, 'only once');
  await s.reward('Mike', 10, 20);
  await s.reward('Mike', -1000, Number.NaN);
  assert.deepEqual([(await s.get('Mike')).coins, (await s.get('Mike')).xp], [STASH_IMPORT_COINS + 10, 520]);
  assert.equal(await s.spend('Mike', 1e9), false);
  assert.equal(await s.spend('Mike', 10), true);
  assert.equal((await s.get('Mike')).coins, STASH_IMPORT_COINS);
  const r = await s.act('Mike', { a: 'plinko', bet: 10 });
  assert.ok(r.ok);
  assert.equal((await s.get('Mike')).coins, r.inv.coins, 'saved');
});

// --- Match pay (server/lobby.ts) ---------------------------------------------------------------------------------

function battle(users: boolean[]) {
  const paid: { name: string; coins: number; xp: number }[] = [];
  const bank: Bank = { pay: (name, coins, xp) => void paid.push({ name, coins, xp }), spend: async () => true };
  const inbox = new Map<number, ServerMsg[]>();
  const lobby = new Lobby('PAY', 'battle', false, 'windward', () => {}, () => {});
  lobby.bank = bank;
  const clients = users.map((user, i) => {
    const id = i + 1;
    inbox.set(id, []);
    const c = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: user ? 'Mike' : `p${id}`, user, lobby: null };
    lobby.add(c);
    return c;
  });
  return { lobby, clients, inbox, paid, stop: () => clients.forEach((c) => lobby.remove(c)) };
}

test('match pay: the server pays a signed-in killer and the winner; guests and your own second tab get nothing', () => {
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  const a = battle([true, false, true]);
  try {
    const [m1, m2, m3] = [1, 2, 3].map((id) => a.lobby.members.get(id)!);
    m2.state.p = [0, 0, -10];
    a.lobby.handle(a.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1, -10], victim: 2 });
    assert.deepEqual(a.paid, [{ name: 'Mike', coins: COIN.kill, xp: XP.battleKill }]);
    // A guest's kill: nothing to pay into.
    now += 5000;
    m3.state.p = [0, 0, -10];
    a.lobby.handle(a.clients[1], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1, -10], victim: 3 });
    assert.equal(a.paid.length, 1);
    // Mike's two tabs farming each other.
    a.lobby.kill(m3, m1, 'snipe', [0, 0, 1]);
    assert.equal(a.paid.length, 1);
    // The match ends: everyone signed in is paid for playing, the winner for winning.
    a.paid.length = 0;
    m1.info.kills = KILL_LIMIT - 1;
    m2.info.alive = true;
    a.lobby.kill(m2, m1, 'snipe', [0, 0, 1]);
    const total = a.paid.reduce((n, p) => n + p.coins, 0);
    assert.equal(total, COIN.kill + COIN.win);
    assert.ok(a.paid.some((p) => p.xp === XP.battleMatch + XP.battleWin));
    assert.ok(a.paid.some((p) => p.xp === XP.battleMatch && !p.coins), 'the other tab played the match too');
  } finally {
    Date.now = realNow;
    a.stop();
  }
});

test('messages: malformed state and shots are dropped, not relayed or trusted', () => {
  const realNow = Date.now;
  let now = 6_000_000;
  Date.now = () => now;
  const a = battle([false, false]);
  try {
    const m2 = a.lobby.members.get(2)!;
    const p = [...a.lobby.members.get(1)!.state.p];
    a.lobby.handle(a.clients[0], { t: 'state', p: ['x', 0, 0] as never, v: [0, 0, 0], yaw: 0, pitch: 0, f: 0 });
    a.lobby.handle(a.clients[0], { t: 'state', p: [0, 0, 0], v: [0, 0, 0], yaw: 'a' as never, pitch: 0, f: 0 });
    a.lobby.handle(a.clients[0], { t: 'state', p: { 0: 1 } as never, v: [0, 0, 0], yaw: 0, pitch: 0, f: 0 });
    assert.deepEqual(a.lobby.members.get(1)!.state.p, p);
    a.lobby.handle(a.clients[0], { t: 'state', p: [1, 2, 3], v: [0, 0, 0], yaw: 0, pitch: 0, f: 0 });
    assert.deepEqual(a.lobby.members.get(1)!.state.p, [1, 2, 3]);
    // A shot whose numbers aren't numbers would pass the "near the victim" check (NaN compares false): dropped.
    m2.state.p = [0, 0, -500];
    a.lobby.handle(a.clients[0], { t: 'shoot', from: ['a', 'b', 'c'] as never, to: ['a', 'b', 'c'] as never, victim: 2 });
    assert.ok(m2.info.alive);
    assert.ok(!a.inbox.get(2)!.some((m) => m.t === 'shot'), 'not relayed');
    now += 5000;
    a.lobby.handle(a.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1, -10], victim: 2.5 });
    assert.ok(m2.info.alive);
  } finally {
    Date.now = realNow;
    a.stop();
  }
});

// --- Workbench builds (server/workshop.ts) -----------------------------------------------------------------------

test('workbench: a signed-in builder is charged by the server; no coins, no contraption', async () => {
  let coins = CONTRAPTIONS.tacks.price;
  const paidBack: number[] = [];
  const bank: Bank = {
    pay: (_n, c) => void paidBack.push(c),
    spend: async (_n, c) => (coins >= c ? ((coins -= c), true) : false),
  };
  const sent: ServerMsg[] = [];
  const lobby = new Lobby('TINK', 'survival', false, 'windward', () => {}, () => {});
  lobby.bank = bank;
  const c = { id: 1, ws: { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)) }, name: 'Mike', user: true, lobby: null };
  lobby.add(c);
  const s = (lobby as unknown as { survival: { phase: string; timer: number; toSpawn: number; workshop: { list: unknown[]; builtAt: Map<number, number> } } }).survival;
  s.phase = 'intermission';
  s.timer = 1e9;
  s.toSpawn = 0;
  try {
    const build = async (x = 0, z = 18) => {
      lobby.members.get(1)!.state.p = [x + 1, 0.01, z];
      s.workshop.builtAt.delete(1);
      lobby.handle(c, { t: 'build', k: 'tacks', p: [x, 0, z], yaw: 0 });
      await new Promise((r) => setTimeout(r, 0));
    };
    await build();
    assert.equal(s.workshop.list.length, 1);
    assert.equal(coins, 0);
    await build(-3, 20);
    assert.equal(s.workshop.list.length, 1, 'could not afford the second');
    assert.equal((sent.filter((m) => m.t === 'refund').at(-1) as { why: string }).why, 'Not enough coins');
    // Scrapping pays part of the price back into the account.
    const id = (s.workshop.list[0] as { id: number }).id;
    lobby.members.get(1)!.state.p = [1, 0.01, 18];
    (s.workshop as unknown as { scrap(m: unknown, id: number): void }).scrap(lobby.members.get(1)!, id);
    assert.ok(paidBack[0] > 0 && paidBack[0] < CONTRAPTIONS.tacks.price);
  } finally {
    lobby.remove(c);
  }
});

// --- Names and rate limits -------------------------------------------------------------------------------------

test('names: markup, control and invisible characters are stripped from typed names', () => {
  assert.equal(cleanName('<img src=x onerror=alert(1)>'), 'img src=x onerro');
  assert.equal(cleanName('  Mi​ke‮  '), 'Mike');
  assert.equal(cleanName('a&b"c\'d`e\\f'), 'abcdef');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('Zoë 🌸'), 'Zoë 🌸');
});

test('limiter: a burst, then a steady rate, per key', () => {
  let t = 0;
  const l = new Limiter(3, 1, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => l.take('a')), [true, true, true, false]);
  assert.ok(l.take('b'), 'keys are separate');
  t += 1000;
  assert.ok(l.take('a'));
  assert.ok(!l.take('a'));
  const small = new Limiter(1, 1, () => t, 4);
  for (let i = 0; i < 100; i++) small.take(`k${i}`);
  assert.ok((small as unknown as { buckets: Map<string, unknown> }).buckets.size <= 4, 'random keys cannot grow it forever');
});
