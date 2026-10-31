import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POWERS,
  hiddenNear,
  plantedIn,
  powerOf,
  powerProblem,
  proof,
  recordRooms,
  routerLog,
  spend,
  teaFact,
} from '../src/games/royal-degeneracy/abilities.ts';
import { CHAR_IDS, type CharId } from '../src/games/royal-degeneracy/cast.ts';
import { inspect, plant, post, unlock, unlockTime, valueOf, VALUES } from '../src/games/royal-degeneracy/clues.ts';
import { DUO_PAIRS } from '../src/games/royal-degeneracy/house.ts';
import { readMsg } from '../src/games/royal-degeneracy/net.ts';
import {
  DEFAULT_SETTINGS,
  TIMES,
  castVote,
  killProblem,
  legend,
  newNight,
  objection,
  publicView,
  startMeeting,
  step,
  tally,
  type Night,
} from '../src/games/royal-degeneracy/rules.ts';

const cast = (chars: CharId[]) => chars.map((char, i) => ({ id: i + 1, name: `P${i + 1}`, char }));
const run = (n: Night, secs: number) => {
  for (let i = 0; i < secs * 20; i++) step(n, 0.05);
};
/** A night with these characters, past its cold open and the no-takeout grace. */
function night(chars: CharId[], seed = 3) {
  const n = newNight(cast(chars), DEFAULT_SETTINGS, seed);
  run(n, TIMES.intro + TIMES.firstKill + 0.5);
  return n;
}
const byChar = (n: Night, c: CharId) => n.players.find((p) => p.char === c)!;
const degOf = (n: Night) => n.players.find((p) => p.role === 'degenerate')!;

test('royal cast: everyone has an ability; guests draw one from the pool by name', () => {
  for (const c of CHAR_IDS) {
    const p = powerOf(c, 'Sam');
    assert.ok(POWERS[p], c);
    assert.ok(POWERS[p].uses !== undefined || POWERS[p].cd !== undefined, `${p} has neither uses nor a cooldown`);
  }
  assert.equal(powerOf('guest', 'Sam'), powerOf('guest', 'Sam'));
  const pool = new Set(['A', 'B', 'C', 'Dee', 'Eli', 'Fox', 'Gus', 'Hal'].map((n) => powerOf('guest', n)));
  assert.ok(pool.size > 1, 'guests all got the same ability');
});

test('royal cast: uses run out and cooldowns tick', () => {
  const n = night(['jung', 'dev', 'mikol', 'xang']);
  const jung = byChar(n, 'jung');
  const dev = byChar(n, 'dev');
  assert.equal(powerProblem(n, jung.id), null);
  spend(n, jung.id);
  spend(n, jung.id);
  assert.equal(powerProblem(n, jung.id), 'used up', 'Proof is twice a night');
  spend(n, dev.id);
  assert.equal(powerProblem(n, dev.id), 'cooling down');
  run(n, 45.5);
  assert.equal(powerProblem(n, dev.id), null);
});

test('royal cast: Look Out stops a takeout, for 30 s', () => {
  const n = night(['wags', 'dev', 'mikol', 'xang', 'jung']);
  const d = degOf(n);
  const friend = n.players.find((p) => p.role === 'housemate' && p.char !== 'wags')!;
  n.powers.guard.set(friend.id, { by: byChar(n, 'wags').id, until: n.roam + 30 });
  assert.equal(killProblem(n, d.id, friend.id, 1), 'guarded');
  run(n, 31);
  assert.equal(killProblem(n, d.id, friend.id, 1), null);
});

test('royal cast: Campus Legend doubles Will’s vote once; Objection! voids the vote once', () => {
  assert.equal(tally(new Map([[1, 5], [2, 6]]), 1).out, 5, 'Will’s double vote breaks the tie');
  const n = night(['will', 'dev', 'mikol', 'xang', 'guest']);
  const will = byChar(n, 'will');
  assert.ok(!legend(n, will.id), 'only at a vote');
  startMeeting(n, 'bell', byChar(n, 'dev').id);
  run(n, DEFAULT_SETTINGS.discuss + 0.1);
  assert.ok(!legend(n, byChar(n, 'dev').id), 'only Will');
  assert.ok(legend(n, will.id));
  assert.equal(publicView(n).doubled, will.id);
  assert.ok(!legend(n, will.id), 'once a night');
  const guest = byChar(n, 'guest');
  castVote(n, will.id, byChar(n, 'dev').id);
  if (powerOf('guest', guest.name) === 'objection') {
    assert.ok(objection(n, guest.id));
    assert.equal(n.votes.size, 0);
    assert.equal(n.powers.doubled, null, 'the double vote goes with it');
  }
});

test('royal cast: Proof checks a player against a crime’s real photos (plants can’t fool it)', () => {
  const n = night(['jung', 'dev', 'mikol', 'xang', 'wags', 'selby'], 5);
  const d = degOf(n);
  const jung = byChar(n, 'jung');
  assert.equal(proof(n, d.id, 0), null, 'nothing posted yet');
  const real = n.mystery.clues.find((c) => c.crime === 0 && c.state === 'view' && !c.lock);
  if (!real) return;
  inspect(n, jung.id, real.id, real.pos);
  post(n, jung.id, real.id);
  assert.equal(proof(n, d.id, 0), 'consistent');
  const innocent = n.players.find((p) => valueOf(p, real.cat) !== real.value);
  if (innocent) assert.equal(proof(n, innocent.id, 0), 'contradiction');
  // A plant that contradicts the real clue doesn't change the answer.
  const other = (VALUES as Record<string, string[]>)[real.cat]?.find((v) => v !== real.value && v !== 'none' && v !== 'calm');
  const fake = other && plant(n, d.id, real.cat, other, real.pos);
  if (fake) {
    inspect(n, jung.id, fake.id, fake.pos);
    post(n, jung.id, fake.id);
    assert.equal(proof(n, d.id, 0), 'consistent');
  }
});

test('royal cast: Bongus Mode finds the hidden clue; Inspection finds plants; Router Logs and the tea', () => {
  const n = night(['xang', 'jj', 'mikol', 'dev', 'wags', 'selby'], 2);
  const hidden = n.mystery.clues.find((c) => c.state === 'hidden')!;
  assert.equal(hiddenNear(n, { ...hidden.pos, x: hidden.pos.x + 4 }).length, 1);
  assert.equal(hiddenNear(n, { ...hidden.pos, x: hidden.pos.x + 9 }).length, 0);
  const d = degOf(n);
  const at = { x: 6.2, y: 0, z: 10.4 };
  const p = plant(n, d.id, 'smoke', 'cigarettes', at)!;
  assert.deepEqual(plantedIn(n, 'living'), [p.id]);
  assert.deepEqual(plantedIn(n, 'kitchen'), []);
  recordRooms(n, new Map([[byChar(n, 'dev').id, { x: 6.2, y: 0, z: 10.4 }]]));
  run(n, 5);
  recordRooms(n, new Map([[byChar(n, 'dev').id, { x: 2, y: 0, z: 2 }]]));
  const logs = routerLog(n);
  assert.ok(logs.some((l) => l.startsWith('Dev:') && l.includes('the living room') && l.includes('the kitchen')), logs.join(' | '));
  assert.ok(teaFact(n, byChar(n, 'xang').id, () => 0)?.includes('Dev'));
});

test('royal cast: locked clues need opening first (JJ’s keys open bags, Mikol cracks phones)', () => {
  assert.equal(unlockTime('jj', 'bag'), 2);
  assert.equal(unlockTime('mikol', 'phone'), 2);
  assert.equal(unlockTime('jj', 'phone'), 30);
  assert.equal(unlockTime('dev', 'bag'), 30);
  for (let seed = 1; seed < 60; seed++) {
    const n = night(['jj', 'dev', 'mikol', 'xang', 'wags', 'selby'], seed);
    const c = n.mystery.clues.find((x) => x.lock);
    if (!c) continue;
    const who = n.players[0].id;
    assert.equal(inspect(n, who, c.id, c.pos), null, 'can’t read a locked clue');
    assert.equal(publicView(n).clues.find((x) => x[0] === c.id)![6], c.lock === 'phone' ? 1 : 2);
    assert.ok(unlock(n, who, c.id, c.pos), 'opening it reads it');
    assert.equal(c.lock, null);
    return;
  }
  assert.fail('no locked clue in 60 nights');
});

test('royal cast: two-person chores count on the bar; Shota overheats once a night', () => {
  const n = night(['shota', 'dev', 'mikol', 'xang']);
  const before = publicView(n).prog;
  n.duoDone.push(DUO_PAIRS[0][0]);
  assert.ok(publicView(n).prog > before);
  assert.ok(n.shirt.at > 0 && n.shirt.at < n.length);
  assert.equal(night(['dev', 'mikol', 'xang', 'jung']).shirt.at, Infinity, 'no Shota, no shirt');
});

test('royal cast: the new messages are shape-checked', () => {
  assert.deepEqual(readMsg({ t: 'power', target: 3, crime: -1 }), { t: 'power', target: 3, crime: -1 });
  assert.deepEqual(readMsg({ t: 'greet', to: 2, k: 'hug' }), { t: 'greet', to: 2, k: 'hug' });
  assert.equal(readMsg({ t: 'greet', to: 2, k: 'kiss' }), null);
  assert.deepEqual(readMsg({ t: 'duo', spot: DUO_PAIRS[0][0], on: true }), { t: 'duo', spot: DUO_PAIRS[0][0], on: true });
  assert.equal(readMsg({ t: 'p', x: 1, y: 0, z: 1, yaw: 0, pitch: 0, f: 0, e: 99 })?.t, 'p');
  assert.equal((readMsg({ t: 'p', x: 1, y: 0, z: 1, yaw: 0, pitch: 0, f: 0, e: 99 }) as { e: number }).e, 0, 'a bad emote is dropped');
  assert.equal(readMsg({ t: 'pw', text: 'x', pos: [[1, 2]], ids: [], until: 0 }), null);
  assert.equal(readMsg({ t: 'npcs', p: [[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]] }), null);
});
