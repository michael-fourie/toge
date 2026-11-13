import assert from 'node:assert/strict';
import test from 'node:test';
import { Poker, POKER_MOVES, RAISE_CAP, SEATS, STAKES, bestFive, cmp, readPoker, type PokerMove } from '../src/games/boys-day/poker.ts';
import { handName, rng } from '../src/games/boys-day/rules.ts';

/** A table with `n` players, each holding `start` scrap. */
function table(n: number, start = 500, seed = 1) {
  const cash = new Array(8).fill(start);
  const p = new Poker(rng(seed), (w) => cash[w], (w, v) => (cash[w] = Math.max(0, cash[w] + v)));
  for (let i = 0; i < n; i++) p.move(i, 'sit', 0);
  return { p, cash, total: () => cash.reduce((a: number, b: number) => a + b, 0) };
}

const seatOf = (p: Poker, who: number) => p.view.seats.indexOf(who);
const whoseTurn = (p: Poker) => (p.view.turn < 0 ? -1 : p.view.seats[p.view.turn]);

test('Hold’em: blinds, the button and who acts first', () => {
  const { p, cash } = table(2);
  assert.equal(p.view.phase, 'wait');
  p.move(0, 'deal', 0);
  const v = p.view;
  assert.equal(v.phase, 'preflop');
  assert.equal(v.board.length, 0);
  assert.deepEqual(
    v.seats.slice(0, 2).map((w) => 500 - cash[w]),
    [v.bet[0], v.bet[1]],
    'the blinds came out of their scrap',
  );
  assert.equal(Math.max(...v.bet), STAKES[0], 'a big blind');
  assert.equal(Math.min(v.bet[0], v.bet[1]), STAKES[0] / 2, 'and a small one');
  // Heads-up the button posts the small blind and acts first.
  assert.equal(v.turn, v.button);
  assert.equal(v.bet[v.button], STAKES[0] / 2);
  assert.equal(v.toCall, STAKES[0] / 2);
});

test('Hold’em: folding hands the blinds over, and the scrap all adds up', () => {
  const { p, cash, total } = table(2);
  const before = total();
  p.move(0, 'deal', 0);
  const folder = whoseTurn(p);
  const other = folder === 0 ? 1 : 0;
  p.move(folder, 'fold', 0);
  assert.equal(p.view.phase, 'show');
  assert.equal(total(), before, 'no scrap made or lost');
  assert.equal(cash[other], 500 + STAKES[0] / 2);
  assert.equal(cash[folder], 500 - STAKES[0] / 2);
  assert.deepEqual(p.view.shown, new Array(SEATS).fill([]), 'a fold shows nobody’s cards');
});

test('Hold’em: four streets, then the best hand takes the pot', () => {
  const { p, total } = table(3, 500, 7);
  const before = total();
  p.move(0, 'deal', 0);
  const seen: string[] = [];
  for (let guard = 0; guard < 200 && p.view.phase !== 'show'; guard++) {
    const w = whoseTurn(p);
    if (w < 0) break;
    if (!seen.includes(p.view.phase)) seen.push(p.view.phase);
    p.move(w, p.view.toCall > 0 ? 'call' : 'check', 0);
  }
  assert.deepEqual(seen, ['preflop', 'flop', 'turn', 'river']);
  const v = p.view;
  assert.equal(v.phase, 'show');
  assert.equal(v.board.length, 5);
  assert.equal(total(), before, 'the pot came back out');
  const live = [0, 1, 2].map((i) => seatOf(p, i)).filter((s) => !v.folded[s]);
  assert.equal(live.length, 3);
  for (const s of live) {
    assert.equal(v.shown[s].length, 2, 'everyone still in shows');
    assert.equal(v.best[s].length, 5);
    assert.ok(handName(v.best[s]).length > 0);
  }
  const won = v.won.reduce((a, b) => a + b, 0);
  assert.ok(won > 0 && won === v.pot, 'the whole pot went somewhere');
  // Whoever won had a hand at least as good as everybody else's.
  const best = live.filter((s) => v.won[s] > 0);
  for (const w of best) for (const s of live) assert.ok(cmp(bestFive([...v.shown[w], ...v.board]).score, bestFive([...v.shown[s], ...v.board]).score) >= 0);
});

test('Hold’em: a bet and three raises, then the street is capped', () => {
  const { p } = table(2, 5000);
  p.move(0, 'deal', 0);
  let raises = 0;
  for (let guard = 0; guard < 20; guard++) {
    const v = p.view;
    if (v.raise <= 0) break;
    const w = whoseTurn(p);
    assert.ok(p.move(w, 'raise', 0), 'a legal raise');
    raises++;
  }
  assert.equal(raises, RAISE_CAP - 1, 'the big blind counts as the first bet');
  assert.equal(p.view.raise, 0, 'no more raising');
  assert.ok(p.view.toCall > 0, 'but you can still call');
  assert.equal(p.move(whoseTurn(p), 'raise', 0), null, 'and a raise is refused');
});

test('Hold’em: a short stack can only win what it could lose (side pots)', () => {
  const cash = [40, 500, 500, 0, 0, 0, 0, 0];
  const p = new Poker(rng(3), (w) => cash[w], (w, v) => (cash[w] = Math.max(0, cash[w] + v)));
  for (let i = 0; i < 3; i++) p.move(i, 'sit', 0);
  const before = cash.reduce((a, b) => a + b, 0);
  p.move(0, 'deal', 0);
  for (let guard = 0; guard < 300 && p.view.phase !== 'show'; guard++) {
    const w = whoseTurn(p);
    if (w < 0) break;
    // The two deep players keep betting; the short one calls everything.
    const v = p.view;
    p.move(w, w !== 0 && v.raise > 0 ? 'raise' : v.toCall > 0 ? 'call' : 'check', 0);
  }
  const v = p.view;
  assert.equal(v.phase, 'show');
  assert.equal(cash.reduce((a, b) => a + b, 0), before, 'no scrap made or lost');
  assert.ok(v.allIn[seatOf(p, 0)], 'the short stack is all in');
  assert.ok(cash[0] <= 40 * 3, 'they can win at most everyone’s 40');
  assert.equal(v.won.reduce((a, b) => a + b, 0), v.pot);
});

test('Hold’em: the table ignores anything out of turn or out of order', () => {
  const { p } = table(2);
  assert.equal(p.move(0, 'fold', 0), null, 'no hand yet');
  p.move(0, 'deal', 0);
  const w = whoseTurn(p);
  const other = w === 0 ? 1 : 0;
  assert.equal(p.move(other, 'call', 0), null, 'not their turn');
  assert.equal(p.move(w, 'check', 0), null, 'there’s a blind to call');
  assert.equal(p.move(9, 'fold', 0), null, 'not even at the table');
  assert.ok(p.move(w, 'call', 0));
  assert.equal(p.move(0, 'deal', 0), null, 'a hand is already going');
});

test('Hold’em: getting up mid-hand leaves your scrap in the pot', () => {
  const { p, cash, total } = table(3, 500, 5);
  const before = total();
  p.move(0, 'deal', 0);
  const w = whoseTurn(p);
  p.move(w, 'call', 0);
  const paid = 500 - cash[w];
  assert.ok(paid > 0);
  p.move(w, 'leave', 0);
  assert.equal(seatOf(p, w), -1, 'the chair is free');
  assert.equal(cash[w], 500 - paid, 'their scrap stayed in');
  for (let guard = 0; guard < 200 && p.view.phase !== 'show'; guard++) {
    const t = whoseTurn(p);
    if (t < 0) break;
    p.move(t, p.view.toCall > 0 ? 'call' : 'check', 0);
  }
  assert.equal(total(), before);
});

test('Hold’em: 400 random hands never make or lose a scrap', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed * 7919);
    const n = 2 + Math.floor(r() * 5);
    const cash = new Array(8).fill(0).map((_, i) => (i < n ? 30 + Math.floor(r() * 400) : 0));
    const start = cash.reduce((a, b) => a + b, 0);
    const p = new Poker(rng(seed), (w) => cash[w], (w, v) => (cash[w] = Math.max(0, cash[w] + v)));
    for (let i = 0; i < n; i++) p.move(i, 'sit', Math.floor(r() * STAKES.length));
    for (let hand = 0; hand < 3; hand++) {
      p.move(0, 'deal', 0);
      for (let guard = 0; guard < 400 && p.view.phase !== 'show' && p.view.turn >= 0; guard++) {
        const w = whoseTurn(p);
        const v = p.view;
        // Any move at all, legal or not: the table must not care.
        const m = POKER_MOVES[Math.floor(r() * POKER_MOVES.length)] as PokerMove;
        if (!p.move(w, m, Math.floor(r() * 4))) p.move(w, v.toCall > 0 ? 'call' : 'check', 0);
      }
      const v = p.view;
      if (v.phase === 'show') {
        assert.equal(v.won.reduce((a, b) => a + b, 0), v.pot, `seed ${seed}: the pot went out`);
        assert.ok(v.bet.every((b) => b === 0), `seed ${seed}: nothing left on the felt`);
      }
      // Mid-hand the scrap is on the table, so count the pot and the bets with the wallets.
      const onFelt = v.pot + v.bet.reduce((a, b) => a + b, 0);
      assert.equal(cash.reduce((a, b) => a + b, 0) + (v.phase === 'show' ? 0 : onFelt), start, `seed ${seed}, hand ${hand}: scrap conserved`);
      assert.ok(
        cash.every((c) => c >= 0),
        `seed ${seed}: nobody owes scrap`,
      );
    }
  }
});

test('Hold’em: the best five of seven', () => {
  const C = (rank: number, suit: number) => suit * 13 + rank;
  // A flush on the board plus a higher one in hand.
  const hole = [C(12, 0), C(3, 0)];
  const board = [C(9, 0), C(7, 0), C(2, 0), C(5, 1), C(6, 2)];
  const b = bestFive([...hole, ...board]);
  assert.equal(handName(b.five), 'Flush');
  assert.ok(b.five.includes(C(12, 0)), 'the ace plays');
  assert.ok(!b.five.includes(C(5, 1)), 'the off-suit cards don’t');
  // Quads beat a full house made from the same seven cards.
  const quads = bestFive([C(5, 0), C(5, 1), C(5, 2), C(5, 3), C(8, 0), C(8, 1), C(2, 2)]);
  assert.equal(handName(quads.five), 'Four of a kind');
});

test('Hold’em: the table goes over the wire, and rubbish doesn’t', () => {
  const { p } = table(3, 500, 11);
  p.move(0, 'deal', 0);
  const v = JSON.parse(JSON.stringify(p.view));
  assert.deepEqual(readPoker(v), p.view);
  assert.equal(readPoker({ ...v, pot: -1 }), null);
  assert.equal(readPoker({ ...v, phase: 'cheat' }), null);
  assert.equal(readPoker({ ...v, stake: 11 }), null);
  assert.equal(readPoker({ ...v, board: [52] }), null);
  assert.equal(readPoker({ ...v, board: [3, 3] }), null, 'the same card twice');
  assert.equal(readPoker({ ...v, seats: [0, 1] }), null, 'the wrong number of chairs');
  assert.equal(readPoker({ ...v, live: 'yes' }), null);
  assert.equal(readPoker(null), null);
});
