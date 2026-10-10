import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CRASH,
  type Card,
  crashMult,
  crashPayout,
  crashPoint,
  crashTime,
  PLINKO_MULT,
  PLINKO_ROWS,
  canDouble,
  deal,
  double,
  handValue,
  hit,
  newShoe,
  plinkoDrop,
  plinkoPayout,
  plinkoRtp,
  stand,
} from '../src/shared/casino.ts';
import { newInv, wager } from '../src/shared/inventory.ts';

const c = (rank: Card['rank'], suit: Card['suit'] = '♠'): Card => ({ rank, suit });
/** A shoe that deals these cards in order (the engine pops from the end). */
const rigged = (...cards: Card['rank'][]) => cards.map((r) => c(r)).reverse();

test('plinko: the paytable is symmetric, has a 1x, 2x, 5x and a big jackpot, and is a fair-ish game with a small house edge', () => {
  assert.equal(PLINKO_MULT.length, PLINKO_ROWS + 1);
  PLINKO_MULT.forEach((m, i) => assert.equal(m, PLINKO_MULT[PLINKO_ROWS - i]));
  for (const m of [1, 2, 5, 10, 30]) assert.ok(PLINKO_MULT.includes(m), `${m}x`);
  const rtp = plinkoRtp();
  assert.ok(rtp > 0.93 && rtp < 1, `return to player ${rtp}`);
});

test('plinko: a drop is one bounce per row and lands in the slot of its right bounces; the rng decides', () => {
  const left = plinkoDrop(() => 0.1);
  assert.equal(left.slot, 0);
  assert.equal(left.path.length, PLINKO_ROWS);
  assert.equal(plinkoDrop(() => 0.9).slot, PLINKO_ROWS);
  assert.equal(plinkoDrop(() => 0.5).slot, PLINKO_ROWS); // ties go right
  const d = plinkoDrop();
  assert.equal(d.slot, d.path.reduce<number>((n, x) => n + x, 0));
});

test('plinko: many drops match the binomial odds and the stated return', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const N = 60000;
  let back = 0;
  const hits = new Array(PLINKO_ROWS + 1).fill(0);
  for (let i = 0; i < N; i++) {
    const { slot } = plinkoDrop(rng);
    hits[slot]++;
    back += PLINKO_MULT[slot];
  }
  assert.ok(hits[6] / N > 0.2 && hits[6] / N < 0.25, `centre ${hits[6] / N}`); // 924/4096 = 0.226
  assert.ok(Math.abs(back / N - plinkoRtp()) < 0.1, `simulated return ${back / N}`);
});

test('plinko: payouts include the stake, round down to whole coins, and never go negative', () => {
  assert.equal(plinkoPayout(100, 6), 50);
  assert.equal(plinkoPayout(100, 0), 3000);
  assert.equal(plinkoPayout(7, 5), 3); // 3.5 rounds down
  assert.equal(plinkoPayout(1, 6), 0); // 0.5 rounds down
});

test('wager: takes any whole amount you can afford, and nothing else', () => {
  const inv = newInv();
  const start = inv.coins;
  assert.ok(wager(inv, 1));
  assert.ok(wager(inv, start - 1));
  assert.equal(inv.coins, 0);
  assert.ok(!wager(inv, 1), 'broke');
  inv.coins = 50;
  for (const bad of [0, -5, 2.5, NaN, 51, Infinity]) assert.ok(!wager(inv, bad), String(bad));
  assert.equal(inv.coins, 50, 'a refused wager takes nothing');
});

test('blackjack: hand values, soft aces, and naturals', () => {
  assert.deepEqual(handValue([c('A'), c('K')]), { total: 21, soft: true });
  assert.deepEqual(handValue([c('A'), c('A'), c('9')]), { total: 21, soft: true });
  assert.deepEqual(handValue([c('A'), c('6'), c('K')]), { total: 17, soft: false });
  assert.deepEqual(handValue([c('K'), c('Q'), c('5')]), { total: 25, soft: false });
  assert.equal(handValue([c('A'), c('A')]).total, 12);
});

test('blackjack: a six-deck shoe with every card, shuffled by the rng', () => {
  const shoe = newShoe();
  assert.equal(shoe.length, 312);
  assert.equal(shoe.filter((x) => x.rank === 'A').length, 24);
  const again = newShoe(() => 0.3);
  assert.notDeepEqual(shoe.map((x) => x.rank + x.suit), again.map((x) => x.rank + x.suit));
});

test('blackjack: naturals pay 2:1, a dealer natural takes the bet, both is a push', () => {
  const bj = deal(rigged('A', '9', 'K', '8'), 100); // player A,K; dealer 9,8
  assert.ok(bj.done && bj.outcome === 'blackjack');
  assert.equal(bj.payout, 300);
  const lose = deal(rigged('9', 'A', '8', 'K'), 100);
  assert.ok(lose.done && lose.outcome === 'lose' && lose.payout === 0);
  const push = deal(rigged('A', 'A', 'K', 'K'), 100);
  assert.ok(push.done && push.outcome === 'push' && push.payout === 100);
});

test('blackjack: hitting past 21 busts; 21 stands by itself; the dealer draws to 17 and stands on every 17', () => {
  const shoe = rigged('10', '9', '6', '7', 'K'); // player 10,6; dealer 9,7; then K
  const r = deal(shoe, 50);
  assert.ok(!r.done);
  hit(r, shoe);
  assert.ok(r.done && r.outcome === 'bust' && r.payout === 0);

  const s2 = rigged('10', '10', '9', '7', '5'); // player 10,9 =19; dealer 10,7 = 17: stands
  const r2 = deal(s2, 50);
  stand(r2, s2);
  assert.equal(r2.dealer.length, 2, 'stands on 17');
  assert.ok(r2.outcome === 'win' && r2.payout === 100);

  const s3 = rigged('9', '10', '8', '6', '10'); // player 9,8 = 17; dealer 10,6 = 16 draws a 10 and busts
  const r3 = deal(s3, 40);
  stand(r3, s3);
  assert.ok(r3.dealer.length === 3 && r3.outcome === 'win');

  const s4 = rigged('10', '10', '8', '8'); // 18 vs 18
  const r4 = deal(s4, 40);
  stand(r4, s4);
  assert.ok(r4.outcome === 'push' && r4.payout === 40);

  const s5 = rigged('10', '10', '7', '8'); // 17 vs 18
  const r5 = deal(s5, 40);
  stand(r5, s5);
  assert.ok(r5.outcome === 'lose' && r5.payout === 0);
});

test('blackjack: double takes exactly one card, doubles the bet, and only on the first two cards', () => {
  const shoe = rigged('5', '10', '6', '8', '10'); // player 5,6 = 11; dealer 10,8 = 18; double draws 10 -> 21
  const r = deal(shoe, 100);
  assert.ok(canDouble(r));
  double(r, shoe);
  assert.equal(r.bet, 200);
  assert.equal(r.player.length, 3);
  assert.ok(r.done && r.outcome === 'win' && r.payout === 400);
  double(r, shoe);
  assert.equal(r.bet, 200, 'a finished round ignores further doubles');

  const s2 = rigged('5', '10', '3', '8', '2', '9');
  const r2 = deal(s2, 10);
  hit(r2, s2);
  assert.ok(!canDouble(r2), 'not after a hit');
});

test('blackjack: hitting to exactly 21 stands automatically and the dealer then plays', () => {
  const shoe = rigged('5', '10', '6', '7', '10', '9'); // player 5,6 + 10 = 21; dealer 10,7 = 17
  const r = deal(shoe, 20);
  hit(r, shoe);
  assert.ok(r.done && r.outcome === 'win');
});

test('crash: snaps at 1x or more, about 2% at 1.00x, and every cash-out target returns about 99% on average', () => {
  let s = 7;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const N = 200000;
  const points = Array.from({ length: N }, () => crashPoint(rng));
  assert.ok(points.every((p) => p >= 1 && p <= CRASH.max));
  const instant = points.filter((p) => p === 1).length / N;
  assert.ok(Math.abs(instant - (1 - (1 - CRASH.edge) / 1.01)) < 0.005, `instant ${instant}`); // everything under 1.01x shows as 1.00x
  for (const target of [1.5, 2, 5, 10]) {
    const rtp = points.filter((p) => p >= target).length * target / N;
    assert.ok(Math.abs(rtp - (1 - CRASH.edge)) < 0.03, `cash out at ${target}x returns ${rtp.toFixed(3)}`);
  }
});

test('crash: the multiplier starts at 1x, only climbs, and the time to reach a multiplier matches it', () => {
  assert.equal(crashMult(0), 1);
  let last = 1;
  for (let t = 0; t < 30; t += 0.1) {
    assert.ok(crashMult(t) >= last);
    last = crashMult(t);
  }
  for (const m of [1.5, 2, 7.25, 40]) assert.ok(Math.abs(crashMult(crashTime(m) + 1e-6) - m) < 0.011, `${m}`);
  assert.equal(crashPayout(10, 2.37), 23);
  assert.equal(crashPayout(3, 1), 3, 'cashing out at 1x gives the bet back');
});
