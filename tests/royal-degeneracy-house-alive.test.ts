import assert from 'node:assert/strict';
import test from 'node:test';
import { type CharId } from '../src/games/royal-degeneracy/cast.ts';
import { DOORS, SPOTS } from '../src/games/royal-degeneracy/house.ts';
import { readMsg } from '../src/games/royal-degeneracy/net.ts';
import { DEFAULT_SETTINGS, TIMES, killProblem, meetingProblem, newNight, publicView, step, takeOut, type Night } from '../src/games/royal-degeneracy/rules.ts';
import { SAB, fixSabotage, lockedDoors, sabotageProblem, startSabotage } from '../src/games/royal-degeneracy/sabotage.ts';
import { addNight, statsLine } from '../src/games/royal-degeneracy/stats.ts';

const cast = (chars: CharId[]) => chars.map((char, i) => ({ id: i + 1, name: `P${i + 1}`, char }));
const run = (n: Night, secs: number) => {
  for (let i = 0; i < secs * 20; i++) step(n, 0.05);
};
function night(chars: CharId[] = ['dev', 'mikol', 'jung', 'xang', 'selby', 'wags'], settings = DEFAULT_SETTINGS, seed = 3) {
  const n = newNight(cast(chars), settings, seed);
  run(n, TIMES.intro + 0.1);
  return n;
}
const deg = (n: Night) => n.players.find((p) => p.role === 'degenerate')!;
const mate = (n: Night, not: CharId[] = []) => n.players.find((p) => p.role === 'housemate' && !not.includes(p.char))!;

test('royal house: sabotages: Degenerates only, one at a time, not in the first minute, a shared cooldown', () => {
  const n = night();
  const d = deg(n);
  assert.equal(sabotageProblem(n, d.id), 'cooling down', 'not in the first minute');
  run(n, SAB.first);
  assert.equal(sabotageProblem(n, mate(n).id), 'not a Degenerate');
  assert.ok(startSabotage(n, d.id, 'power', 0));
  assert.equal(sabotageProblem(n, d.id), 'one at a time');
  assert.equal(fixSabotage(n, mate(n).id, 'fix-router'), null, 'the wrong fix');
  assert.equal(fixSabotage(n, mate(n).id, 'fix-fuse'), 'fixed');
  assert.equal(sabotageProblem(n, d.id), 'cooling down');
  run(n, SAB.cooldown + 0.5);
  assert.equal(sabotageProblem(n, d.id), null);
});

test('royal house: an unstopped flood wins it for the Degenerates; stopping it takes two people (or Selby)', () => {
  const n = night();
  run(n, SAB.first);
  startSabotage(n, deg(n).id, 'flood', 1);
  run(n, SAB.crisis + 0.5);
  assert.equal(n.phase, 'over');
  assert.equal(n.win?.side, 'degenerates');

  const m = night();
  run(m, SAB.first);
  startSabotage(m, deg(m).id, 'flood', 1);
  const [a, b] = m.players.filter((p) => p.role === 'housemate' && p.char !== 'selby');
  assert.equal(fixSabotage(m, a.id, 'fix-plunge'), 'half');
  assert.equal(fixSabotage(m, b.id, 'fix-stopcock'), 'fixed');
  assert.equal(m.sab.now, null);

  const s = night(['selby', 'dev', 'mikol', 'xang', 'jung', 'wags'], DEFAULT_SETTINGS, 9);
  if (s.players.find((p) => p.char === 'selby')!.role === 'housemate') {
    run(s, SAB.first);
    startSabotage(s, deg(s).id, 'flood', 1);
    assert.equal(fixSabotage(s, s.players.find((p) => p.char === 'selby')!.id, 'fix-plunge'), 'fixed', 'Selby decides it’s dire');
  }
});

test('royal house: the fire alarm stops meetings; WiFi comes back 10 s after a reboot; locks lift after 12 s', () => {
  const n = night();
  run(n, SAB.first);
  const d = deg(n);
  startSabotage(n, d.id, 'alarm', 0);
  assert.equal(meetingProblem(n, mate(n).id, -1), 'the fire alarm is going off');
  fixSabotage(n, mate(n).id, 'fix-alarm');
  assert.equal(meetingProblem(n, mate(n).id, -1), null);
  run(n, SAB.cooldown + 0.5);
  startSabotage(n, d.id, 'wifi', 0);
  assert.equal(fixSabotage(n, mate(n).id, 'fix-router'), 'rebooting');
  assert.equal(publicView(n).sab?.[0], 'wifi', 'still down while it reboots');
  run(n, SAB.reboot + 0.5);
  assert.equal(n.sab.now, null);
  run(n, SAB.cooldown + 0.5);
  startSabotage(n, d.id, 'lock', 1);
  const locked = lockedDoors(n);
  assert.ok(locked.includes('dev') && locked.includes('selby') && !locked.includes('bath2') && !locked.includes('jung'), locked.join());
  assert.ok(locked.every((id) => DOORS.find((x) => x.id === id)!.floor === 1));
  run(n, SAB.locked + 0.5);
  assert.deepEqual(lockedDoors(n), []);
});

test('royal house: every fix spot and sneak route exists, and sneak routes come in pairs', () => {
  for (const id of ['fix-fuse', 'fix-stopcock', 'fix-plunge', 'fix-alarm', 'fix-router']) assert.ok(SPOTS.some((s) => s.id === id), id);
  for (const s of SPOTS.filter((x) => x.kind === 'sneak')) {
    const other = SPOTS.find((x) => x.id === s.pair);
    assert.ok(other && other.pair === s.id, `${s.id} ↔ ${s.pair}`);
  }
});

test('royal house: Cosy mode means no takeouts', () => {
  const n = night(['dev', 'mikol', 'jung', 'xang'], { ...DEFAULT_SETTINGS, cosy: true });
  run(n, TIMES.firstKill + 1);
  assert.equal(killProblem(n, deg(n).id, mate(n).id, 1), 'cosy mode');
});

test('royal house: the Sink of Shame hides its clues in the tower of dishes', () => {
  const n = night(['dev', 'mikol', 'jung', 'xang', 'selby', 'wags'], { ...DEFAULT_SETTINGS, caseId: 'sink' });
  const hidden = n.mystery.clues.filter((c) => c.crime === 0 && c.state === 'hidden');
  assert.equal(hidden.length, 2);
  assert.ok(hidden.every((c) => c.spot === 's-sink'));
});

test('royal house: the night ends with awards', () => {
  const n = night(['dev', 'mikol', 'jung', 'xang']);
  run(n, TIMES.firstKill + 1);
  const d = deg(n);
  for (const p of n.players.filter((x) => x.role === 'housemate')) {
    if (n.phase !== 'night') break;
    takeOut(n, d.id, p.id, { x: 6.2, y: 0, z: 10.4 });
    d.killAt = 0;
  }
  const titles = n.win!.awards.map((a) => a[0]);
  assert.ok(titles.includes('First Blood') && titles.includes('Untouchable'), titles.join());
  assert.equal(readMsg(JSON.parse(JSON.stringify({ t: 'st', v: publicView(n) })))?.t, 'st');
});

test('royal house: stats add up', () => {
  let s = addNight({ nights: 0, housemateWins: 0, degenerateWins: 0, evicted: 0, takenOut: 0, chars: {} }, { char: 'dev', won: true, degenerate: false, evicted: false, takenOut: true });
  s = addNight(s, { char: 'dev', won: true, degenerate: true, evicted: true, takenOut: false });
  assert.deepEqual([s.nights, s.housemateWins, s.degenerateWins, s.evicted, s.takenOut, s.chars.dev], [2, 1, 1, 1, 1, 2]);
  assert.ok(statsLine(s).includes('usually Dev'));

});
