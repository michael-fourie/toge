import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KOTH, type KothState, inZone, newKoth, stepKoth } from '../src/shared/koth.ts';

const DT = 0.05;
/** Runs the hill for `secs` with these many players on it; returns the events that happened. */
function run(s: KothState, on: [number, number], secs: number) {
  const ev: { captured: number[]; won: number[] } = { captured: [], won: [] };
  for (let t = 0; t < secs - 1e-9; t += DT) {
    const e = stepKoth(s, on, DT);
    if (e.captured !== undefined) ev.captured.push(e.captured);
    if (e.won !== undefined) ev.won.push(e.won);
  }
  return ev;
}
const open = () => {
  const s = newKoth();
  s.lock = 0;
  return s;
};

test('zone: a cylinder on the plateau; standing, jumping and the edge count, flying overhead does not', () => {
  const z = { x: 0, y: 3, z: 0, r: 8, h: 6 };
  assert.ok(inZone(z, { x: 0, y: 3, z: 0 }));
  assert.ok(inZone(z, { x: 7.9, y: 3, z: 0 }));
  assert.ok(inZone(z, { x: 0, y: 8, z: 0 }), 'mid-jump');
  assert.ok(!inZone(z, { x: 8.2, y: 3, z: 0 }));
  assert.ok(!inZone(z, { x: 0, y: 12, z: 0 }), 'grappling over the top');
  assert.ok(!inZone(z, { x: 0, y: 0, z: 0 }), 'under the plateau');
});

test('the hill starts locked: nothing happens until it opens', () => {
  const s = newKoth();
  run(s, [3, 0], KOTH.unlockSeconds - 0.5);
  assert.equal(s.owner, null);
  assert.equal(s.prog, 0);
  assert.ok(s.lock > 0);
  run(s, [3, 0], 1);
  assert.equal(s.lock, 0);
  assert.ok(s.prog > 0, 'capturing once open');
});

test('one player captures a neutral hill in captureTime; more players are faster, capped at three', () => {
  const s = open();
  let ev = run(s, [1, 0], KOTH.captureTime - 0.3);
  assert.equal(s.owner, null);
  assert.equal(s.cap, 0);
  ev = run(s, [1, 0], 0.5);
  assert.deepEqual(ev.captured, [0]);
  assert.equal(s.owner, 0);
  assert.equal(s.prog, 0);

  const two = open();
  run(two, [2, 0], KOTH.captureTime / 1.5 + 0.1);
  assert.equal(two.owner, 0);
  const three = open();
  const many = open();
  run(three, [3, 0], 4.4);
  run(many, [6, 0], 4.4);
  assert.equal(three.prog, many.prog, 'more than three is no faster');
});

test('contested: nobody makes progress', () => {
  const s = open();
  run(s, [1, 0], 4);
  const p = s.prog;
  run(s, [2, 1], 10);
  assert.ok(s.contested);
  assert.equal(s.prog, p);
  assert.equal(s.owner, null);
});

test('an abandoned capture drains slowly, and fast when the owners stand on their hill', () => {
  const s = open();
  run(s, [1, 0], 4);
  const p = s.prog;
  run(s, [0, 0], 1);
  assert.ok(s.prog < p && s.prog > p - 0.1, `slow drain: ${p} -> ${s.prog}`);
  run(s, [0, 0], 60);
  assert.equal(s.prog, 0);
  assert.equal(s.cap, null);

  // Team 0 owns it; team 1 half-captures, leaves; team 0 steps on and wipes it quickly.
  const t = open();
  run(t, [1, 0], KOTH.captureTime + 0.1);
  run(t, [0, 1], 4);
  assert.equal(t.cap, 1);
  run(t, [1, 0], 4.5);
  assert.equal(t.prog, 0);
  assert.equal(t.owner, 0);
});

test('retaking: the enemy has to wipe your half-capture before building their own', () => {
  const s = open();
  run(s, [1, 0], 4.5); // team 0 halfway
  run(s, [0, 1], 4.5); // team 1 erases it
  assert.ok(s.prog < 0.02);
  run(s, [0, 1], KOTH.captureTime + 0.2);
  assert.equal(s.owner, 1);
  // ... and team 0 takes it back.
  const ev = run(s, [1, 0], KOTH.captureTime + 0.2);
  assert.deepEqual(ev.captured, [0]);
  assert.equal(s.owner, 0);
});

test('only the owners clock up time, contested or not, and the totals add up across retakes', () => {
  const s = open();
  run(s, [1, 0], KOTH.captureTime + 0.05);
  run(s, [0, 0], 20);
  assert.ok(Math.abs(s.held[0] - 20) < 0.2, `held ${s.held[0]}`);
  run(s, [1, 1], 10); // contested: the owner's clock still runs
  assert.ok(Math.abs(s.held[0] - 30) < 0.2);
  assert.equal(s.held[1], 0);
  run(s, [0, 2], KOTH.captureTime);
  assert.equal(s.owner, 1);
  const was = s.held[0];
  run(s, [0, 0], 15);
  assert.equal(s.held[0], was, 'lost the hill: our clock stops');
  assert.ok(s.held[1] > 14);
});

test('first to the hold time wins, but not while the enemy is on the hill or capturing: overtime', () => {
  const s = open();
  run(s, [1, 0], KOTH.captureTime + 0.05);
  s.held[0] = KOTH.holdToWin - 1;
  let ev = run(s, [1, 1], 5); // contested at the finish
  assert.deepEqual(ev.won, []);
  assert.ok(s.overtime);
  assert.ok(s.held[0] < KOTH.holdToWin);
  ev = run(s, [0, 1], 2); // the enemy alone, capturing: still overtime
  assert.deepEqual(ev.won, []);
  assert.ok(s.overtime);
  // The enemy is killed off the hill: their bar drains, then the owners win.
  ev = run(s, [0, 0], 10);
  assert.deepEqual(ev.won, [0]);
  assert.equal(s.held[0], KOTH.holdToWin);
});

test('without a fight at the end, the owners win right on time', () => {
  const s = open();
  run(s, [0, 1], KOTH.captureTime + 0.05);
  s.held[1] = KOTH.holdToWin - 0.5;
  const ev = run(s, [0, 0], 1);
  assert.deepEqual(ev.won, [1]);
  assert.ok(!s.overtime);
});

// --- The server running the hill -------------------------------------------------------------

import { Lobby } from '../src/server/lobby.ts';
import { CROWN_ZONE } from '../src/shared/crown.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';

function hillLobby(n = 4) {
  const inbox = new Map<number, ServerMsg[]>();
  const lobby = new Lobby('HILL', 'battle', true, 'windward', () => {}, () => {}, true);
  const clients = Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    inbox.set(id, []);
    const c = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, lobby: null };
    lobby.add(c);
    return c;
  });
  const at = (id: number, p: [number, number, number]) => (lobby.members.get(id)!.state.p = p);
  const tick = (secs: number) => {
    for (let i = 0; i < Math.round(secs * 20); i++) lobby['tick']();
  };
  const last = (id: number) => inbox.get(id)!.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMsg, { t: 'snapshot' }>;
  return { lobby, clients, inbox, at, tick, last, stop: () => clients.forEach((c) => lobby.remove(c)) };
}

test('server: a King of the Hill lobby is a team game on Crown; each team spawns in its own base', () => {
  const h = hillLobby();
  try {
    const joined = h.inbox.get(1)!.find((m) => m.t === 'joined') as Extract<ServerMsg, { t: 'joined' }>;
    assert.ok(joined.koth && joined.teams);
    assert.equal(joined.map, undefined, 'the arena is always Crown');
    for (const m of h.lobby.members.values()) {
      const z = m.state.p[2];
      assert.ok(m.info.team === 0 ? z > 40 : z < -40, `team ${m.info.team} spawned at z=${z}`);
    }
  } finally {
    h.stop();
  }
});

test('server: standing on the hill captures it, the snapshot tracks who is on it, and kills never end the match', () => {
  const h = hillLobby();
  try {
    h.lobby['hill']!.lock = 0;
    const on: [number, number, number] = [CROWN_ZONE.x, CROWN_ZONE.y + 0.01, CROWN_ZONE.z + 3];
    h.at(1, on); // Sunset
    h.at(3, [CROWN_ZONE.x + 2, CROWN_ZONE.y + 0.01, CROWN_ZONE.z - 3]); // Sunset too: captures faster
    h.tick(1);
    let k = h.last(2).koth!;
    assert.deepEqual(k.on, [2, 0]);
    assert.equal(k.cap, 0);
    h.tick(KOTH.captureTime / 1.5);
    k = h.last(2).koth!;
    assert.equal(k.owner, 0);
    assert.ok(k.held[0] > 0);

    // Tide steps on: contested.
    h.at(2, [CROWN_ZONE.x - 3, CROWN_ZONE.y + 0.01, CROWN_ZONE.z]);
    h.tick(0.5);
    assert.ok(h.last(1).koth!.contested);

    // A kill race doesn't decide it: way past the kill limit, still playing.
    h.lobby.members.get(1)!.info.kills = 99;
    h.lobby.kill(h.lobby.members.get(4)!, h.lobby.members.get(1)!, 'snipe', [0, 0, -1]);
    assert.ok(!h.inbox.get(1)!.some((m) => m.t === 'matchOver'));
  } finally {
    h.stop();
  }
});

test('server: dead players do not hold the hill, and a full clock wins the match for that team', () => {
  const h = hillLobby();
  try {
    const hill = h.lobby['hill']!;
    hill.lock = 0;
    hill.owner = 1;
    hill.held[1] = KOTH.holdToWin - 2;
    h.at(1, [CROWN_ZONE.x, CROWN_ZONE.y + 0.01, CROWN_ZONE.z]); // Sunset steps on at the last moment: overtime...
    h.tick(3);
    assert.ok(h.last(1).koth!.overtime);
    assert.ok(!h.inbox.get(1)!.some((m) => m.t === 'matchOver'));
    h.lobby.kill(h.lobby.members.get(1)!, h.lobby.members.get(2)!, 'snipe', [0, 0, 1]); // ...and is sniped off it
    h.at(3, [0, 0, 30]);
    h.tick(1);
    assert.deepEqual(h.last(2).koth!.on, [0, 0]);
    h.tick(12); // their unfinished capture drains away, then the clock runs out
    const over = h.inbox.get(1)!.find((m) => m.t === 'matchOver') as Extract<ServerMsg, { t: 'matchOver' }> | undefined;
    assert.ok(over, 'the match ends');
    assert.deepEqual(over.winner, { team: 1 });
  } finally {
    h.stop();
  }
});
