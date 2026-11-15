import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Race, type RaceClient } from '../../src/kanjo/server/race.ts';
import { CUPS, addRound, teamTable } from '../../src/kanjo/shared/cups.ts';
import { MODE_TRACK, RACE, RACE_MODES, TEAMS, cleanMode, isGp, modeTracks, recordMode, teammates, type RaceServerMsg } from '../../src/kanjo/shared/protocol.ts';

// The Team Grand Prix (2026-11-10, Andrew: "a new team mode in Host a Race, where you can make contact with other
// cars except your teammates ... grandprix mode with points for each race and finish").

/** A race room with fake sockets and a hand-wound clock (like raceroom.test.ts). */
function room() {
  let now = 1_000_000;
  const inbox = new Map<number, RaceServerMsg[]>();
  const race = new Race('TEAM', () => {}, () => {}, () => {}, () => now, false);
  const join = (id: number): RaceClient => {
    inbox.set(id, []);
    const c: RaceClient = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, car: 'shiro.0.1.0.0.0.0.1.00000000', rider: '', user: false };
    race.add(c);
    return c;
  };
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      race.tick();
    }
  };
  const last = (id: number, t: RaceServerMsg['t']) => inbox.get(id)!.filter((m) => m.t === t).at(-1);
  const teamOf = (id: number) => race.members.get(id)!.team;
  return { race, join, advance, last, teamOf };
}

test('Team Grand Prix is a Grand Prix: a cup of four, race rules, no best times; teammates are only ever on one team', () => {
  assert.ok(isGp('team') && isGp('gp') && !isGp('race'));
  assert.ok(RACE_MODES.team.name.includes('Team'));
  assert.equal(cleanMode('team'), false);
  assert.equal(recordMode('team'), false);
  assert.equal(MODE_TRACK.team, CUPS.torii.tracks[0]);
  assert.ok(!modeTracks('team').some((t) => t === 'karasu'), 'never the hill climb');
  assert.equal(TEAMS.length, 2);
  assert.equal(teammates(0, 0), true);
  assert.equal(teammates(1, 1), true);
  assert.equal(teammates(0, 1), false);
  assert.equal(teammates(undefined, undefined), false, 'no team: nobody is your teammate (every other mode)');
  assert.equal(teammates(0, undefined), false);
});

test('the team table adds each racer\'s points to their team: most points, then round wins, both teams always listed', () => {
  let table = addRound([], 0, [
    { key: 'a', name: 'A', place: 1, team: 0 },
    { key: 'b', name: 'B', place: 2, team: 1 },
    { key: 'c', name: 'C', place: 3, team: 1 },
    { key: 'd', name: 'D', place: 4, team: 0 },
  ]);
  assert.deepEqual(table.map((r) => [r.key, r.team]), [['a', 0], ['b', 1], ['c', 1], ['d', 0]], 'rows keep their team');
  // Red 15 + 8 = 23; Blue 12 + 10 = 22.
  assert.deepEqual(teamTable(table).map((t) => [t.team, t.pts, t.last, t.wins]), [[0, 23, 23, 1], [1, 22, 22, 0]]);
  table = addRound(table, 1, [
    { key: 'b', name: 'B', place: 1, team: 1 },
    { key: 'c', name: 'C', place: 2, team: 1 },
    { key: 'a', name: 'A', place: 3, team: 0 },
    { key: 'd', name: 'D', place: 0, team: 0 },
  ]);
  // Red 23 + 10 = 33; Blue 22 + 27 = 49.
  assert.deepEqual(teamTable(table).map((t) => [t.team, t.pts, t.last, t.wins]), [[1, 49, 27, 1], [0, 33, 10, 1]], 'a DNF scores nothing for the team');
  // Level on points: the team with more round wins is ahead.
  const level = [
    { key: 'x', name: 'X', pts: 20, last: 0, places: [2, 2], team: 0 as const },
    { key: 'y', name: 'Y', pts: 20, last: 0, places: [1, 3], team: 1 as const },
  ];
  assert.equal(teamTable(level)[0].team, 1);
  assert.deepEqual(teamTable([]).map((t) => [t.team, t.pts]), [[0, 0], [1, 0]], 'both teams even with nobody on them');
});

test('teams in the lobby: switching to Team Grand Prix splits the grid, newcomers join the smaller side, racers swap themselves, the host moves CPUs', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  const c = r.join(3);
  r.race.handle(a, { t: 'cpu', op: 'add' });
  const cpu = [...r.race.members.values()].find((m) => m.cpu)!.client.id;
  let rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && rm.racers.every((x) => x.team === undefined), 'no teams outside the mode');
  r.race.handle(b, { t: 'mode', mode: 'team' });
  assert.equal(r.race.mode, 'race', 'only the host picks the mode');
  r.race.handle(a, { t: 'mode', mode: 'team' });
  assert.equal(r.race.mode, 'team');
  assert.equal(r.race.track, CUPS.torii.tracks[0], 'a cup, like a Grand Prix');
  assert.deepEqual([r.teamOf(1), r.teamOf(2), r.teamOf(3), r.teamOf(cpu)], [0, 1, 0, 1], 'split evenly in join order, the host on Red');
  rm = r.last(2, 'room');
  assert.ok(rm && rm.t === 'room' && rm.racers.map((x) => x.team).join() === '0,1,0,1', 'everyone sees the teams');
  // A newcomer joins the side with fewer racers.
  r.race.handle(c, { t: 'team', team: 1 });
  assert.equal(r.teamOf(3), 1, 'swapped themselves to Blue');
  r.join(4);
  assert.equal(r.teamOf(4), 0, 'Red had one racer, Blue three: the newcomer goes Red');
  // Only the host moves a CPU racer, and nobody moves another person.
  r.race.handle(b, { t: 'team', team: 0, id: cpu });
  assert.equal(r.teamOf(cpu), 1);
  r.race.handle(a, { t: 'team', team: 0, id: 2 });
  assert.equal(r.teamOf(2), 1, "the host can't move a person");
  r.race.handle(a, { t: 'team', team: 0, id: cpu });
  assert.equal(r.teamOf(cpu), 0);
  r.race.handle(a, { t: 'team', team: 7 as never });
  assert.equal(r.teamOf(1), 0, 'junk teams are ignored');
  // Once the cup is under way, the teams are fixed.
  r.race.handle(a, { t: 'start' });
  r.race.handle(a, { t: 'team', team: 1 });
  assert.equal(r.teamOf(1), 0, 'no switching mid-cup');
});

test('a whole Team Grand Prix: four rounds with points, every row on its team, the team table at the end', () => {
  const r = room();
  const a = r.join(1);
  const b = r.join(2);
  const c = r.join(3);
  const d = r.join(4);
  r.race.handle(a, { t: 'mode', mode: 'team' });
  // Red: 1 and 3; Blue: 2 and 4.
  r.race.handle(a, { t: 'start' });
  for (const x of [a, b, c, d]) r.race.handle(x, { t: 'ready' });
  for (let round = 0; round < 4; round++) {
    const ld = r.last(2, 'load');
    assert.ok(ld && ld.t === 'load' && ld.mode === 'team' && ld.gp?.round === round && ld.track === CUPS.torii.tracks[round]);
    if (round > 0) for (const x of [a, b, c, d]) r.race.handle(x, { t: 'ready' });
    r.advance(RACE.countdownMs + 100);
    assert.equal(r.race.phase, 'racing');
    r.advance(60_000);
    // Blue's 2 wins every round, but Red's pair fills 2nd and 3rd: 12 + 10 a round against 15 + 8.
    for (const [x, t] of [[b, 60], [a, 60.2], [c, 60.4], [d, 60.6]] as const) r.race.handle(x, { t: 'finish', time: t });
    const res = r.last(1, 'results');
    assert.ok(res && res.t === 'results' && res.gp && res.gp.round === round);
    assert.ok(res.gp.table.every((x) => x.team === (Number(x.key) % 2 === 1 ? 0 : 1)), 'every cup row carries its team');
    if (round < 3) r.advance(RACE.gpResultsSeconds * 1000 + 100);
    else {
      assert.equal(res.gp.final, true);
      assert.deepEqual(res.gp.table[0].key, '2', 'the best driver is Blue');
      // Red 4 × 22 = 88; Blue 4 × 23 = 92.
      assert.deepEqual(teamTable(res.gp.table).map((t) => [t.team, t.pts, t.wins]), [[1, 92, 4], [0, 88, 0]], 'and Blue takes the team cup');
    }
  }
});
