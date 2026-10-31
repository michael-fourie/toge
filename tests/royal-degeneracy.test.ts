import assert from 'node:assert/strict';
import test from 'node:test';
import { CAST, CHAR_IDS, type CharId } from '../src/games/royal-degeneracy/cast.ts';
import { DUO_PAIRS, SPOTS } from '../src/games/royal-degeneracy/house.ts';
import { readMsg } from '../src/games/royal-degeneracy/net.ts';
import {
  DEFAULT_SETTINGS,
  TIMES,
  castVote,
  cleanSettings,
  degeneratesFor,
  doChore,
  killProblem,
  leave,
  meetingProblem,
  newNight,
  pickCharacter,
  privateView,
  publicView,
  rattle,
  settlePicks,
  startMeeting,
  step,
  takeOut,
  tally,
  type Night,
} from '../src/games/royal-degeneracy/rules.ts';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, char: CHAR_IDS[i % 10] as CharId }));
const run = (n: Night, secs: number) => {
  for (let i = 0; i < secs * 20; i++) step(n, 0.05);
};
const degs = (n: Night) => n.players.filter((p) => p.role === 'degenerate');
const mates = (n: Night) => n.players.filter((p) => p.role === 'housemate');
/** A night past its cold open and the no-takeout grace. */
function rolling(count: number, seed = 1) {
  const n = newNight(people(count), DEFAULT_SETTINGS, seed);
  run(n, TIMES.intro + TIMES.firstKill + 0.5);
  assert.equal(n.phase, 'night');
  return n;
}

test('royal: Degenerates per night follow the player count, and never start a night already won', () => {
  const want: [number, number][] = [[1, 0], [2, 0], [3, 1], [4, 1], [6, 1], [7, 2], [10, 2], [11, 3], [12, 3]];
  for (const [players, d] of want) assert.equal(degeneratesFor(players, 0), d, `${players} players`);
  assert.equal(degeneratesFor(8, 3), 3, 'the host can ask for more');
  assert.equal(degeneratesFor(4, 3), 1, 'but never so many they start even');
});

test('royal: the cast are one each, guests are unlimited, and stragglers get filled in', () => {
  const picks = new Map<number, CharId>();
  assert.ok(pickCharacter(picks, 1, 'dev'));
  assert.ok(!pickCharacter(picks, 2, 'dev'), 'Dev is taken');
  assert.ok(pickCharacter(picks, 1, 'dev'), 'picking yourself again is fine');
  assert.ok(pickCharacter(picks, 2, 'guest'));
  assert.ok(pickCharacter(picks, 3, 'guest'));
  const settled = settlePicks(picks, [1, 2, 4, 5]);
  assert.equal(settled.get(1), 'dev');
  assert.equal(settled.get(2), 'guest');
  assert.ok(!settled.has(3), 'people who left are dropped');
  assert.equal(settled.get(4), 'mikol', 'the first free housemate');
  assert.equal(settled.get(5), 'jung');
  const all = settlePicks(new Map(), Array.from({ length: 12 }, (_, i) => i));
  const named = [...all.values()].filter((c) => c !== 'guest');
  assert.equal(new Set(named).size, named.length, 'no housemate twice');
});

test('royal: settings are checked before anyone trusts them', () => {
  assert.deepEqual(cleanSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, nightMin: 9999 }), null);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, caseId: '<script>' }), null);
  assert.equal(cleanSettings({ ...DEFAULT_SETTINGS, reveal: 'yes' }), null);
  assert.equal(cleanSettings(null), null);
});

test('royal: a night deals the right roles and one chore of each kind, the same for the same seed', () => {
  for (let seed = 1; seed < 40; seed++) {
    const n = newNight(people(9), DEFAULT_SETTINGS, seed);
    assert.equal(degs(n).length, 2);
    for (const p of n.players) {
      const kinds = p.tasks.map((t) => SPOTS.find((s) => s.id === t.spot)!.chore);
      assert.equal(new Set(kinds).size, 4, 'four different kinds of chore');
    }
    assert.deepEqual(newNight(people(9), DEFAULT_SETTINGS, seed), n);
  }
});

test('royal: the phases run cold open → night → Last Meeting → vote → result → over', () => {
  const n = newNight(people(5), { ...DEFAULT_SETTINGS, nightMin: 6 }, 3);
  assert.equal(n.phase, 'intro');
  run(n, TIMES.intro + 0.1);
  assert.equal(n.phase, 'night');
  run(n, 6 * 60);
  assert.equal(n.phase, 'meeting');
  assert.equal(n.meet?.kind, 'last');
  assert.equal(n.seats.length, 5);
  run(n, DEFAULT_SETTINGS.discuss + 0.1);
  assert.equal(n.phase, 'vote');
  run(n, DEFAULT_SETTINGS.vote + 0.1);
  assert.equal(n.phase, 'result');
  assert.equal(n.result?.out, null, 'nobody voted, nobody goes');
  run(n, TIMES.result + 0.1);
  assert.equal(n.phase, 'over');
  assert.equal(n.win?.side, 'degenerates', 'a Degenerate survived the Last Meeting');
});

test('royal: takeouts need a Degenerate, a living housemate, reach, and no cooldown', () => {
  const n = newNight(people(6), DEFAULT_SETTINGS, 5);
  const [d] = degs(n);
  const [a, b] = mates(n);
  assert.equal(killProblem(n, d.id, a.id, 1), 'not now', 'not during the cold open');
  run(n, TIMES.intro + 1);
  assert.equal(killProblem(n, d.id, a.id, 1), 'cooling down', 'not in the first seconds');
  run(n, TIMES.firstKill);
  assert.equal(killProblem(n, a.id, b.id, 1), 'not a Degenerate');
  assert.equal(killProblem(n, d.id, a.id, 9), 'too far');
  assert.equal(killProblem(n, d.id, a.id, 1), null);
  takeOut(n, d.id, a.id, { x: 1, y: 0, z: 2 });
  assert.equal(a.alive, false);
  assert.deepEqual(n.bodies, [{ id: a.id, pos: { x: 1, y: 0, z: 2 } }]);
  assert.equal(killProblem(n, d.id, b.id, 1), 'cooling down');
  run(n, DEFAULT_SETTINGS.killCd);
  assert.equal(killProblem(n, d.id, a.id, 1), 'not a target', 'the dead stay dead');
});

test('royal: the Degenerates win once they equal the housemates', () => {
  const n = rolling(4);
  const [d] = degs(n);
  const [a, b] = mates(n);
  takeOut(n, d.id, a.id, { x: 0, y: 0, z: 0 });
  assert.equal(n.phase, 'night', '1 vs 2 plays on');
  n.players.find((p) => p.id === d.id)!.killAt = 0;
  takeOut(n, d.id, b.id, { x: 0, y: 0, z: 0 });
  assert.equal(n.phase, 'over');
  assert.equal(n.win?.side, 'degenerates');
});

test('royal: reports, the bell (once each), and ghosts can’t call meetings', () => {
  const n = rolling(6);
  const [d] = degs(n);
  const [a, b, c] = mates(n);
  assert.equal(meetingProblem(n, b.id, a.id), 'no body');
  takeOut(n, d.id, a.id, { x: 0, y: 0, z: 0 });
  assert.equal(meetingProblem(n, a.id, -1), 'ghosts can’t call meetings');
  assert.equal(meetingProblem(n, b.id, a.id), null);
  startMeeting(n, 'body', b.id, a.id);
  assert.equal(n.phase, 'meeting');
  assert.ok(!n.seats.includes(a.id), 'the dead don’t get a seat');
  run(n, DEFAULT_SETTINGS.discuss + DEFAULT_SETTINGS.vote + TIMES.result + 0.5);
  assert.equal(n.phase, 'night');
  assert.deepEqual(n.bodies, [], 'bodies are cleared after a meeting');
  assert.equal(meetingProblem(n, c.id, -1), null);
  startMeeting(n, 'bell', c.id);
  run(n, DEFAULT_SETTINGS.discuss + DEFAULT_SETTINGS.vote + TIMES.result + 0.5);
  assert.equal(meetingProblem(n, c.id, -1), 'you’ve rung the bell tonight');
  assert.ok(killProblem(n, d.id, b.id, 1) === 'cooling down', 'no takeouts right after a meeting');
});

test('royal: votes: one each, living only; ties and skips evict nobody', () => {
  assert.deepEqual(tally(new Map([[1, 2], [2, 3], [3, 2]])).out, 2);
  assert.equal(tally(new Map([[1, 2], [2, 3]])).out, null, 'a tie');
  assert.equal(tally(new Map([[1, -1], [2, -1], [3, 2]])).out, null, 'skip wins');
  assert.equal(tally(new Map()).out, null);

  const n = rolling(5);
  const [d] = degs(n);
  const [a, b, c] = mates(n);
  takeOut(n, d.id, a.id, { x: 0, y: 0, z: 0 });
  startMeeting(n, 'body', b.id, a.id);
  assert.ok(!castVote(n, b.id, d.id), 'no voting during discussion');
  run(n, DEFAULT_SETTINGS.discuss + 0.1);
  assert.ok(!castVote(n, a.id, d.id), 'ghosts don’t vote');
  assert.ok(!castVote(n, b.id, a.id), 'nor get voted for');
  assert.ok(castVote(n, b.id, d.id));
  assert.ok(!castVote(n, b.id, c.id), 'one vote each');
  for (const p of n.players) if (p.alive && p.id !== b.id) castVote(n, p.id, d.id === p.id ? c.id : d.id);
  step(n, 0.05);
  assert.equal(n.phase, 'result', 'everyone voted: straight to the result');
  assert.equal(n.result?.out, d.id);
  assert.equal(n.result?.deg, true);
  run(n, TIMES.result + 0.1);
  assert.equal(n.win?.side, 'housemates');
});

test('royal: chores win it for the housemates; Degenerates’ chores are for show; ghosts still count', () => {
  const n = rolling(5);
  const [d] = degs(n);
  const [ghost] = mates(n);
  takeOut(n, d.id, ghost.id, { x: 0, y: 0, z: 0 });
  for (const t of d.tasks) assert.ok(doChore(n, d.id, t.spot));
  assert.equal(publicView(n).prog, 0, 'fake chores fill nothing');
  assert.ok(!doChore(n, ghost.id, 'bell'), 'not one of theirs');
  n.duoDone.push(...DUO_PAIRS.map((p) => p[0]));
  for (const p of mates(n)) for (const t of p.tasks) doChore(n, p.id, t.spot);
  assert.equal(n.phase, 'over');
  assert.equal(n.win?.side, 'housemates');
});

test('royal: ghosts rattle every 30 s; the living can’t', () => {
  const n = rolling(5);
  const [d] = degs(n);
  const [a, b] = mates(n);
  takeOut(n, d.id, a.id, { x: 0, y: 0, z: 0 });
  assert.ok(!rattle(n, b.id));
  assert.ok(rattle(n, a.id));
  assert.ok(!rattle(n, a.id));
  run(n, TIMES.rattle + 0.1);
  assert.ok(rattle(n, a.id));
});

test('royal: leaving counts as taken out, and the last Degenerate leaving ends it', () => {
  const n = rolling(6);
  const [d] = degs(n);
  leave(n, mates(n)[0].id);
  assert.equal(n.phase, 'night');
  leave(n, d.id);
  assert.equal(n.win?.side, 'housemates');
});

test('royal: the public view never says who’s a Degenerate until the end; the private one only tells you', () => {
  const n = rolling(9);
  const json = JSON.stringify(publicView(n));
  assert.ok(!json.includes('degenerate'), 'roles leaked in the public view');
  const [d1, d2] = degs(n);
  assert.deepEqual(privateView(n, d1.id)!.mates, [d2.id]);
  assert.deepEqual(privateView(n, mates(n)[0].id)!.mates, []);
  for (const p of mates(n)) takeOut(n, d1.id, p.id, { x: 0, y: 0, z: 0 });
  assert.ok(JSON.stringify(publicView(n)).includes('degenerate'), 'the reveal shows roles');
});

test('royal: messages are shape-checked: the host’s own views pass, junk doesn’t', () => {
  const n = rolling(7);
  startMeeting(n, 'bell', mates(n)[0].id);
  const st = readMsg(JSON.parse(JSON.stringify({ t: 'st', v: publicView(n) })));
  assert.equal(st?.t, 'st');
  const me = readMsg(JSON.parse(JSON.stringify({ t: 'me', v: privateView(n, 1) })));
  assert.equal(me?.t, 'me');
  assert.deepEqual(readMsg({ t: 'p', x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0.1, f: 3 }), { t: 'p', x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0.1, f: 3, e: 0, h: 0 });
  for (const bad of [
    null,
    'hi',
    { t: 'p', x: NaN, y: 0, z: 0, yaw: 0, pitch: 0, f: 0 },
    { t: 'p', x: 1e9, y: 0, z: 0, yaw: 0, pitch: 0, f: 0 },
    { t: 'door', id: 'narnia' },
    { t: 'chore', spot: '__proto__' },
    { t: 'pick', c: 'donal' },
    { t: 'chat', text: 'x'.repeat(500) },
    { t: 'chat', text: '   ' },
    { t: 'st', v: { ...publicView(n), people: 'everyone' } },
    { t: 'lobby', picks: [], s: { caseId: 'random' }, live: false },
    { t: 'nope' },
  ])
    assert.equal(readMsg(bad), null, JSON.stringify(bad)?.slice(0, 60));
});

test('royal: every character has a full card, and every main card’s traits are unique', () => {
  for (const id of CHAR_IDS) {
    const c = CAST[id];
    assert.ok(c.tag && c.ability.name && c.quirk.name && c.lines.meeting.length && c.lines.evicted, id);
    assert.ok(c.height >= 150 && c.height <= 200, id);
  }
  const cards = CHAR_IDS.filter((id) => id !== 'guest').map((id) => JSON.stringify(CAST[id].traits));
  assert.equal(new Set(cards).size, cards.length);
});
