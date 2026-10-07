import assert from 'node:assert/strict';
import test from 'node:test';
import { Lobby } from '../src/server/lobby.ts';
import type { PlayerInfo, ServerMsg } from '../src/shared/protocol.ts';
import { KILL_LIMIT, MATCH_OVER_SECONDS, TEAMS, shuffleTeams, smallerTeam, teamKills, winner } from '../src/shared/teams.ts';

const info = (id: number, kills: number, team?: 0 | 1): PlayerInfo => ({ id, name: `p${id}`, color: 0, kills, deaths: 0, alive: true, team });

test('newcomers fill the smaller team', () => {
  assert.equal(smallerTeam([]), 0);
  assert.equal(smallerTeam([info(1, 0, 0)]), 1);
  assert.equal(smallerTeam([info(1, 0, 0), info(2, 0, 1), info(3, 0, 1)]), 0);
});

test('shuffle splits as evenly as possible and keeps everyone', () => {
  for (const n of [1, 2, 5, 12]) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const sides = shuffleTeams(ids);
    assert.equal(sides.size, n);
    const a = [...sides.values()].filter((t) => t === 0).length;
    assert.ok(Math.abs(a - (n - a)) <= 1);
  }
});

test('first to the kill limit wins: a player in free-for-all, a team total in teams', () => {
  assert.equal(KILL_LIMIT, 30);
  assert.equal(winner([info(1, 29), info(2, 5)], false), null);
  assert.deepEqual(winner([info(1, 30), info(2, 5)], false), { id: 1 });
  const t = [info(1, 15, 0), info(2, 14, 0), info(3, 29, 1)];
  assert.deepEqual(teamKills(t), [29, 29]);
  assert.equal(winner(t, true), null);
  assert.deepEqual(winner([info(1, 15, 0), info(2, 15, 0), info(3, 3, 1)], true), { team: 0 });
});

function arena(teams: boolean, n = 4) {
  const inbox = new Map<number, ServerMsg[]>();
  const lobby = new Lobby('TEAM', 'battle', teams, () => {}, () => {});
  const clients = Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    inbox.set(id, []);
    const c = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, lobby: null };
    lobby.add(c);
    return c;
  });
  const at = (id: number, p: [number, number, number]) => (lobby.members.get(id)!.state.p = p);
  return { lobby, clients, inbox, at, stop: () => clients.forEach((c) => lobby.remove(c)) };
}

test('server: teams balance on join, take the team colour, and can be switched or shuffled (shuffle is host-only)', () => {
  const a = arena(true);
  try {
    const team = (id: number) => a.lobby.members.get(id)!.info.team;
    assert.deepEqual([1, 2, 3, 4].map(team), [0, 1, 0, 1]);
    assert.equal(a.lobby.members.get(2)!.info.color, TEAMS[1].color);
    a.lobby.handle(a.clients[1], { t: 'team', team: 0 });
    assert.equal(team(2), 0);
    assert.equal(a.lobby.members.get(2)!.info.color, TEAMS[0].color);
    assert.ok(a.inbox.get(1)!.some((m) => m.t === 'teams' && m.players[0].id === 2));
    a.lobby.handle(a.clients[1], { t: 'team', team: 9 as 0 }); // garbage is ignored
    assert.equal(team(2), 0);
    const before = a.inbox.get(1)!.length;
    a.lobby.handle(a.clients[1], { t: 'shuffle' }); // not the host
    assert.equal(a.inbox.get(1)!.length, before);
    a.lobby.handle(a.clients[0], { t: 'shuffle' });
    const sides = [1, 2, 3, 4].map(team);
    assert.equal(sides.filter((t) => t === 0).length, 2);
  } finally {
    a.stop();
  }
});

test('server: no friendly fire in teams, but enemies are fair game', () => {
  const realNow = Date.now;
  let now = 7_000_000;
  Date.now = () => now;
  const a = arena(true);
  try {
    a.at(1, [0, 0, 0]);
    a.at(2, [0, 0, -10]); // enemy (team 1)
    a.at(3, [0, 0, -20]); // teammate of 1 (team 0)
    a.lobby.handle(a.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1, -20], victim: 3 });
    assert.ok(a.lobby.members.get(3)!.info.alive, 'teammate untouched');
    now += 5000; // past the rifle's cooldown
    a.lobby.handle(a.clients[0], { t: 'shoot', from: [0, 1.6, 0], to: [0, 1, -10], victim: 2 });
    assert.ok(!a.lobby.members.get(2)!.info.alive, 'enemy dies');
  } finally {
    Date.now = realNow;
    a.stop();
  }
});

test('server: reaching the kill limit ends the match, freezes scores, then starts a fresh one', () => {
  const realNow = Date.now;
  let now = 9_000_000;
  Date.now = () => now;
  const a = arena(false, 2);
  try {
    const [killer, victim] = [a.lobby.members.get(1)!, a.lobby.members.get(2)!];
    for (let i = 0; i < KILL_LIMIT - 1; i++) {
      victim.info.alive = true;
      a.lobby.kill(victim, killer, 'snipe', [0, 0, -1]);
    }
    assert.ok(!a.inbox.get(1)!.some((m) => m.t === 'matchOver'), '29 kills is not enough');
    victim.info.alive = true;
    a.lobby.kill(victim, killer, 'snipe', [0, 0, -1]);
    const over = a.inbox.get(2)!.find((m) => m.t === 'matchOver');
    assert.ok(over && over.t === 'matchOver' && 'id' in over.winner && over.winner.id === 1);
    a.lobby.kill(killer, victim, 'snipe', [0, 0, -1]); // too late
    assert.equal(victim.info.kills, 0);
    assert.equal(killer.info.kills, KILL_LIMIT);
    now += (MATCH_OVER_SECONDS + 1) * 1000;
    (a.lobby as unknown as { tick(): void }).tick();
    assert.equal(killer.info.kills, 0);
    assert.ok(killer.info.alive && victim.info.alive);
    assert.ok(a.inbox.get(2)!.some((m) => m.t === 'matchStart'));
  } finally {
    Date.now = realNow;
    a.stop();
  }
});
