// Practice bots: they spot you, react, aim and fire like snipers whose skill depends on the level, never through walls,
// don't walk off ledges, and come looking for you when they can't see you.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT, type BotLevel, type BotTarget, createBot, flankSpot, shotHits, thinkBot, wantsRelocate } from '../../src/gambol/shared/bot.ts';
import type { Box } from '../../src/gambol/shared/collision.ts';
import { TICK_DT } from '../../src/gambol/shared/constants.ts';
import { stepPlayer } from '../../src/gambol/shared/movement.ts';

const floor: Box = { min: { x: -200, y: -1, z: -200 }, max: { x: 200, y: 0, z: 200 }, kind: 'floor' };

/** Seeded dice so every run of the tests is the same. */
function dice(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Runs a bot against a standing target for up to `seconds`; returns when its first hit landed (or null), and the bot. */
function duel(level: BotLevel, target: BotTarget, boxes: Box[], seconds: number, seed = 1, start = { x: 0, y: 0.01, z: 0 }) {
  const b = createBot(1, level, start, 0);
  const rand = dice(seed);
  let shots = 0;
  let first: number | null = null;
  for (let t = 0; t < seconds; t += TICK_DT) {
    const tick = thinkBot(b, target, boxes, [], TICK_DT, rand);
    stepPlayer(b.s, tick.input, TICK_DT, boxes, []);
    if (!tick.shot) continue;
    shots++;
    first ??= t;
    const eye = { x: b.s.pos.x, y: b.s.pos.y + 1.62, z: b.s.pos.z };
    if (shotHits(eye, tick.shot, target.pos, boxes)) return { at: t, first, shots, b };
  }
  return { at: null, first, shots, b };
}

test('a Hard bot that can see you at 40 m gets you within a few seconds if you stand still, but not instantly', () => {
  let kills = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = duel('hard', { pos: { x: 30, y: 0, z: -26 }, alive: true }, [floor], 8, seed);
    if (r.at !== null) {
      kills++;
      assert.ok(r.at + TICK_DT >= BOT.hard.reaction, 'never before it has reacted');
    }
  }
  assert.ok(kills >= 15, `${kills}/20`);
});

test('moving fast makes you harder to hit', () => {
  const rate = (speed: number) => {
    let hits = 0;
    let shots = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = duel('hard', { pos: { x: 0, y: 0, z: -50 }, vel: { x: speed, y: 0, z: 0 }, alive: true }, [floor], 6, seed);
      shots += r.shots;
      if (r.at !== null) hits++;
    }
    return hits / Math.max(1, shots);
  };
  const still = rate(0);
  const bhop = rate(12);
  assert.ok(bhop < still * 0.75, `still ${still.toFixed(2)}, bhopping ${bhop.toFixed(2)}`);
});

test('the levels really differ: Easy rarely hits at range, Normal sometimes, Hard often', () => {
  const rate = (level: BotLevel) => {
    let hits = 0;
    let shots = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = duel(level, { pos: { x: 0, y: 0, z: -60 }, alive: true }, [floor], 10, seed);
      shots += r.shots;
      if (r.at !== null) hits++;
    }
    return hits / Math.max(1, shots);
  };
  const easy = rate('easy');
  const normal = rate('normal');
  const hard = rate('hard');
  assert.ok(easy < 0.15 && normal > easy && hard > normal && hard > 0.2, `easy ${easy.toFixed(2)}, normal ${normal.toFixed(2)}, hard ${hard.toFixed(2)}`);
});

test('no bot fires before its reaction time, or during your spawn grace', () => {
  for (const level of ['easy', 'normal', 'hard'] as BotLevel[]) {
    const r = duel(level, { pos: { x: 0, y: 0, z: -20 }, alive: true }, [floor], 4, 3);
    assert.ok(r.first !== null && r.first + TICK_DT >= BOT[level].reaction - 1e-6, `${level} fired at ${r.first}`);
    const graced = duel(level, { pos: { x: 0, y: 0, z: -20 }, alive: true, grace: 99 }, [floor], 4, 3);
    assert.equal(graced.shots, 0, `${level} waits out the grace`);
  }
});

test('bots never shoot through walls, and hunt you down when they cannot see you', () => {
  const wall: Box = { min: { x: -6, y: 0, z: -12 }, max: { x: 6, y: 6, z: -11 }, kind: 'wall' };
  const target = { pos: { x: 0, y: 0, z: -20 }, alive: true };
  const r = duel('hard', target, [floor, wall], 0.8, 5);
  assert.equal(r.shots, 0, 'nothing to shoot at');
  // Given time it walks round the wall and gets you.
  const later = duel('hard', target, [floor, wall], 12, 5);
  assert.ok(later.at !== null, `it found you (bot at ${JSON.stringify(later.b.s.pos)})`);
});

test('a bot does not walk off the edge of its island to reach you across a gap', () => {
  const island: Box = { min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 0, z: 5 }, kind: 'floor' };
  const far: Box = { min: { x: -5, y: -1, z: -60 }, max: { x: 5, y: 0, z: -50 }, kind: 'floor' };
  const wall: Box = { min: { x: -5, y: 0, z: -50.5 }, max: { x: 5, y: 8, z: -50 }, kind: 'wall' }; // you're out of sight behind it
  const r = duel('hard', { pos: { x: 0, y: 0, z: -55 }, alive: true }, [island, far, wall], 6, 7);
  assert.ok(r.b.s.pos.y > -0.5, `still on the island: ${JSON.stringify(r.b.s.pos)}`);
});

test('dead players are not shot at', () => {
  assert.equal(duel('hard', { pos: { x: 0, y: 0, z: -20 }, alive: false }, [floor], 3).shots, 0);
});

test('a bot that lost you reappears where it can see you, at range, and never in front of your eyes', () => {
  const spots = [
    { x: 0, y: 0, z: -40 }, // straight ahead of you: never
    { x: 0, y: 0, z: 40 }, // behind you: fine
    { x: 0, y: 0, z: 5 }, // too close
    { x: 40, y: 0, z: 0 }, // to your side, but behind a wall
  ];
  const wall: Box = { min: { x: 10, y: 0, z: -5 }, max: { x: 11, y: 10, z: 5 }, kind: 'wall' };
  for (let i = 0; i < 20; i++) {
    const s = flankSpot(spots, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, [floor, wall], dice(i));
    assert.deepEqual(s, { x: 0, y: 0, z: 40 });
  }
  assert.equal(flankSpot([spots[0]], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, [floor]), null);
  const b = createBot(1, 'hard', { x: 0, y: 0.01, z: 0 });
  assert.equal(wantsRelocate(b), false);
  b.clock = BOT.hard.relocate + 1;
  assert.equal(wantsRelocate(b), true, 'unseen long enough');
});
