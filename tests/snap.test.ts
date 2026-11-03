import assert from 'node:assert/strict';
import test from 'node:test';
import { DUCK_FLASH, DUCK_WAIT, KINDS, ODD_PAIRS, POINTS, ROUNDS, cleanResult, describe, goAt, judge, judgeSimon, makeMatch, pourLevel, pourLine, rightPick, scoreRound, standings, timeLimit } from '../src/games/snap/rules.ts';

test('snap: the same seed builds the same match; every kind comes up, never twice in a row', () => {
  for (let seed = 1; seed < 200; seed++) {
    const a = makeMatch(seed);
    assert.deepEqual(a, makeMatch(seed));
    assert.equal(a.length, ROUNDS);
    for (const k of KINDS) assert.ok(a.some((r) => r.kind === k), `seed ${seed}: no ${k}`);
    for (let i = 1; i < a.length; i++) assert.notEqual(a[i].kind, a[i - 1].kind, `seed ${seed}: ${a[i].kind} twice`);
  }
});

test('snap: rounds are fair: decoys come well before SNAP!, ink never matches its word, duck options are distinct', () => {
  for (let seed = 1; seed < 300; seed++)
    for (const r of makeMatch(seed)) {
      if (r.kind === 'draw') {
        assert.ok(r.delay >= 1500 && r.delay <= 5000);
        for (const d of r.decoys) assert.ok(d.at > 300 && r.delay - d.at > 700, `decoy at ${d.at} of ${r.delay}`);
      } else if (r.kind === 'ink') assert.notEqual(r.ink, r.word);
      else if (r.kind === 'ducks') {
        assert.equal(new Set(r.options).size, 4);
        assert.equal(r.options[r.answer], r.ducks.length);
        assert.ok(r.ducks.length >= 5, `only ${r.ducks.length} ducks`);
        assert.ok(r.options.every((o) => o > 0));
      } else if (r.kind === 'clock') assert.ok(r.target >= 5000 && r.target <= 9000);
      assert.ok(timeLimit(r) > goAt(r));
    }
});

test('snap: judging: too soon and wrong picks miss, reactions are timed from what was on screen', () => {
  const draw = { kind: 'draw' as const, delay: 2000, decoys: [{ at: 900, word: 'SNACK!' }] };
  assert.equal(judge(draw, 950), null, 'pressed on the decoy');
  assert.equal(judge(draw, 1999), null, 'a hair early');
  assert.equal(judge(draw, 2250), 250);
  assert.equal(judge(draw, 2250, -1, 2016), 234, 'timed from the frame SNAP! appeared');
  assert.equal(judge(draw, null), null);
  assert.equal(judge(draw, timeLimit(draw) + 1), null, 'too late');

  const clock = { kind: 'clock' as const, target: 7000 };
  assert.equal(judge(clock, 6800), 200);
  assert.equal(judge(clock, 7350), 350);
  assert.equal(judge(clock, 100), 6900, 'stopping early is just a long way off');

  const ink = { kind: 'ink' as const, delay: 1000, word: 0, ink: 2 };
  assert.equal(judge(ink, 1400, 0), null, 'picked the word, not the ink');
  assert.equal(judge(ink, 1400, 2), 400);

  const ducks = { kind: 'ducks' as const, ducks: [], options: [6, 7, 8, 9], answer: 1 };
  const go = DUCK_WAIT + DUCK_FLASH;
  assert.equal(judge(ducks, go + 900, 1), 900);
  assert.equal(judge(ducks, go + 900, 2), null);
  assert.equal(judge(ducks, go - 10, 1), null, 'answered while the ducks were still up');
});

test('snap: scoring: points by place, ties share, misses get nothing', () => {
  const pts = scoreRound(
    new Map([
      [1, 300],
      [2, 210],
      [3, null],
      [4, 300],
      [5, 500],
      [6, 900],
    ]),
  );
  assert.equal(pts.get(2), POINTS[0]);
  assert.equal(pts.get(1), POINTS[1], 'tied for second');
  assert.equal(pts.get(4), POINTS[1], 'tied for second');
  assert.equal(pts.get(5), POINTS[3], 'fourth');
  assert.equal(pts.get(6), POINTS[3], 'anyone else who answered');
  assert.equal(pts.get(3), 0);
  assert.equal(scoreRound(new Map()).size, 0);
});

test('snap: standings sort by points then name; results from the wire are checked', () => {
  const s = standings(new Map([[1, 4], [2, 9], [3, 4]]), new Map([[1, 'zed'], [2, 'amy'], [3, 'bo']]));
  assert.deepEqual(s.map((e) => e.id), [2, 3, 1]);
  assert.equal(cleanResult(212.4), 212);
  for (const bad of [-1, NaN, Infinity, '200', null, undefined, {}, 1e9]) assert.equal(cleanResult(bad), null);
});

test('snap: the newer rounds are fair: one odd one out, maths options distinct with the sum among them, Simon never repeats a colour back to back', () => {
  for (let seed = 1; seed < 300; seed++)
    for (const r of makeMatch(seed)) {
      if (r.kind === 'odd') {
        assert.ok(r.odd >= 0 && r.odd < 4 && r.pair < ODD_PAIRS.length);
        assert.notEqual(ODD_PAIRS[r.pair][0], ODD_PAIRS[r.pair][1]);
      } else if (r.kind === 'maths') {
        const real = r.op === '+' ? r.a + r.b : r.op === '−' ? r.a - r.b : r.a * r.b;
        assert.equal(r.options[r.answer], real);
        assert.equal(new Set(r.options).size, 4);
        assert.ok(r.options.every((o) => o >= 0));
      } else if (r.kind === 'arrow') assert.equal(rightPick(r), r.flip ? 3 - r.dir : r.dir);
      else if (r.kind === 'pour') {
        assert.ok(r.line >= 0.55 && r.line <= 0.85);
        assert.ok(Math.abs(pourLevel(r, pourLine(r)) - r.line) < 1e-9, 'the line is where the level reaches it');
        assert.ok(pourLine(r) < timeLimit(r));
      } else if (r.kind === 'simon') {
        assert.ok(r.seq.length >= 4 && r.seq.length <= 5);
        for (let i = 1; i < r.seq.length; i++) assert.notEqual(r.seq[i], r.seq[i - 1]);
      }
    }
});

test('snap: judging the newer rounds: wrong picks miss, OPPOSITE! flips the arrow, a pour over the line spills', () => {
  const odd = { kind: 'odd' as const, delay: 1000, pair: 0, odd: 2 };
  assert.equal(judge(odd, 1300, 2), 300);
  assert.equal(judge(odd, 1300, 1), null);
  assert.equal(judge(odd, 990, 2), null, 'before they showed');

  const maths = { kind: 'maths' as const, delay: 800, a: 7, b: 8, op: '×' as const, options: [54, 56, 66, 57], answer: 1 };
  assert.equal(judge(maths, 2000, 1), 1200);
  assert.equal(judge(maths, 2000, 0), null);

  const up = { kind: 'arrow' as const, delay: 900, dir: 3, flip: false };
  assert.equal(judge(up, 1200, 3), 300);
  assert.equal(judge({ ...up, flip: true }, 1200, 3), null, 'OPPOSITE! means down');
  assert.equal(judge({ ...up, flip: true }, 1200, 0), 300);

  const pour = { kind: 'pour' as const, line: 0.7, brim: 4000 };
  const line = pourLine(pour);
  assert.equal(judge(pour, line - 120), 120, 'a touch short');
  assert.equal(judge(pour, line + 5), null, 'spilled');
  assert.equal(describe(pour, 20), 'right on the line!');
  assert.ok(pourLevel(pour, 1000) < pourLevel(pour, 2000) / 2, 'it speeds up');

  const simon = { kind: 'simon' as const, seq: [0, 2, 1, 3] };
  const go = goAt(simon);
  assert.equal(judgeSimon(simon, [{ at: go + 200, pick: 0 }]), 'more');
  assert.equal(judgeSimon(simon, [{ at: go + 200, pick: 1 }]), null, 'wrong colour');
  assert.equal(judgeSimon(simon, [{ at: go - 50, pick: 0 }]), null, 'pressed while it was still showing');
  const all = simon.seq.map((pick, i) => ({ at: go + 300 * (i + 1), pick }));
  assert.equal(judgeSimon(simon, all), 1200);
  assert.equal(judgeSimon(simon, [...all.slice(0, 3), { at: timeLimit(simon) + 1, pick: 3 }]), null, 'too slow');
});
