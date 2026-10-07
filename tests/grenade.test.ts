import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Box } from '../src/shared/collision.ts';
import { GRENADE } from '../src/shared/constants.ts';
import { type Grenade, applyKnock, blastKnock, blastTargets, stepGrenade, throwVelocity } from '../src/shared/grenade.ts';

const floor: Box = { min: { x: -200, y: -1, z: -200 }, max: { x: 200, y: 0, z: 200 }, kind: 'floor' };
const wall = (z: number): Box => ({ min: { x: -50, y: -1, z }, max: { x: 50, y: 30, z: z + 1 }, kind: 'wall' });
const DT = 1 / 120;

function fly(g: Grenade, seconds: number, boxes: Box[]) {
  for (let i = 0; i < seconds / DT; i++) stepGrenade(g, DT, boxes);
}

test('a thrown grenade arcs, lands on the floor, bounces and settles, and never falls through', () => {
  const g: Grenade = { pos: { x: 0, y: 1.6, z: 0 }, vel: throwVelocity(0, 0, { x: 0, y: 0, z: 0 }), age: 0 };
  let peak = 0;
  for (let i = 0; i < GRENADE.fuse / DT; i++) {
    stepGrenade(g, DT, [floor]);
    peak = Math.max(peak, g.pos.y);
    assert.ok(g.pos.y > -0.01, `fell through the floor at ${g.pos.y}`);
  }
  assert.ok(peak > 1.7, 'it arcs up first');
  assert.ok(g.pos.z < -10, `it travelled forward: z=${g.pos.z.toFixed(1)}`);
  assert.ok(Math.hypot(g.vel.x, g.vel.z) < 17, 'friction took some speed');
});

test('it bounces off a wall instead of passing through', () => {
  const g: Grenade = { pos: { x: 0, y: 1.5, z: 0 }, vel: { x: 0, y: 0, z: -20 }, age: 0 };
  fly(g, 1.5, [floor, wall(-6)]);
  assert.ok(g.pos.z > -5.9, `stayed on this side of the wall: z=${g.pos.z.toFixed(2)}`);
  assert.ok(g.vel.z > -1 || g.pos.z > -5.5, 'bounced back');
});

test('throws keep your momentum: running forward makes it fly farther than standing', () => {
  const stand = throwVelocity(0, 0, { x: 0, y: 0, z: 0 });
  const run = throwVelocity(0, 0, { x: 0, y: 0, z: -25 });
  assert.ok(run.z < stand.z - 20);
  // Looking sideways keeps your forward run too.
  const side = throwVelocity(Math.PI / 2, 0, { x: 0, y: 0, z: -25 });
  assert.ok(Math.abs(side.z - -25) < 1e-6);
});

test('the blast kills what is in range and in sight; walls shield; range is respected', () => {
  const boom = { x: 0, y: 1, z: 0 };
  const targets = [
    { id: 1, pos: { x: 2, y: 0, z: 0 } }, // close
    { id: 2, pos: { x: GRENADE.radius + 1, y: 0, z: 0 } }, // just outside
    { id: 3, pos: { x: 0, y: 0, z: -3 } }, // close but behind a wall
  ];
  const boxes = [floor, { min: { x: -5, y: 0, z: -2 }, max: { x: 5, y: 5, z: -1.5 }, kind: 'wall' } as Box];
  assert.deepEqual(blastTargets(boom, targets, boxes), [1]);
});

test('a blast shoves away from the center (more when closer, none behind walls) and never costs speed', () => {
  const boom = { x: 0, y: 0.5, z: 0 };
  const near = blastKnock(boom, { x: 1.5, y: 0, z: 0 }, [floor])!;
  const far = blastKnock(boom, { x: 8, y: 0, z: 0 }, [floor])!;
  assert.ok(near.speed > far.speed && near.dir.x > 0 && near.dir.y > 0, 'away and up');
  assert.equal(blastKnock(boom, { x: GRENADE.knockRadius + 2, y: 0, z: 0 }, [floor]), null);
  assert.equal(blastKnock(boom, { x: 3, y: 0, z: 0 }, [floor, { min: { x: 1, y: 0, z: -9 }, max: { x: 2, y: 9, z: 9 }, kind: 'wall' }]), null, 'shielded');

  // Standing still: launched. Running into the blast: speed is kept (it only turns you), never reduced.
  const still = { x: 0, y: 0, z: 0 };
  applyKnock(still, near);
  assert.ok(Math.hypot(still.x, still.y, still.z) >= near.speed - 1e-9);
  for (const v0 of [{ x: -30, y: 0, z: 0 }, { x: 0, y: 0, z: -25 }, { x: 20, y: 5, z: 3 }]) {
    const v = { ...v0 };
    const before = Math.hypot(v.x, v.y, v.z);
    applyKnock(v, near);
    assert.ok(Math.hypot(v.x, v.y, v.z) >= before - 1e-9, `lost speed from ${JSON.stringify(v0)}`);
  }
});

test('the cooldown is the 8 seconds asked for', () => {
  assert.equal(GRENADE.cooldown, 8);
});

// --- Server: throwing, blasting and killing -----------------------------------------------------------

import { Lobby } from '../src/server/lobby.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';

function arena() {
  const inbox = new Map<number, ServerMsg[]>();
  const lobby = new Lobby('NADE', 'battle', false, 'windward', () => {}, () => {});
  const clients = [1, 2, 3].map((id) => {
    inbox.set(id, []);
    const c = { id, ws: { readyState: 1, send: (d: string) => inbox.get(id)!.push(JSON.parse(d)) }, name: `p${id}`, lobby: null };
    lobby.add(c);
    return c;
  });
  const at = (id: number, p: [number, number, number]) => (lobby.members.get(id)!.state.p = p);
  return { lobby, clients, inbox, at, stop: () => clients.forEach((c) => lobby.remove(c)) };
}

test('server: a grenade is rate limited, relayed to others, and its blast kills players in range and in sight', () => {
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  const a = arena();
  try {
    a.at(1, [-20, 0.01, 15]); // open floor on the centre island (the trunk would block the blast)
    a.at(2, [-18, 0.01, 15]); // in the blast
    a.at(3, [-20, 0.01, -15]); // far away
    const [c1] = a.clients;
    a.lobby.handle(c1, { t: 'nade', p: [0, 1.6, 0], v: [0, 5, -15] });
    assert.ok(a.inbox.get(2)!.some((m) => m.t === 'nade' && m.id === 1), 'relayed to the others');
    assert.ok(!a.inbox.get(1)!.some((m) => m.t === 'nade'), 'not echoed to the thrower');

    a.lobby.handle(c1, { t: 'nade', p: [0, 1.6, 0], v: [0, 5, -15] }); // too soon: dropped
    assert.equal(a.inbox.get(2)!.filter((m) => m.t === 'nade').length, 1);

    a.lobby.handle(c1, { t: 'boom', p: [-19, 1, 15] }); // instantly: not plausible yet
    assert.ok(a.lobby.members.get(2)!.info.alive);

    now += 2300;
    a.lobby.handle(c1, { t: 'boom', p: [-19, 1, 15] });
    assert.equal(a.lobby.members.get(2)!.info.alive, false, 'in range: dead');
    assert.equal(a.lobby.members.get(3)!.info.alive, true, 'out of range: fine');
    assert.equal(a.lobby.members.get(1)!.info.alive, true, 'no self damage');
    assert.equal(a.lobby.members.get(1)!.info.kills, 1);
    assert.ok(a.inbox.get(3)!.some((m) => m.t === 'blast'), 'everyone sees the blast');
    const kill = a.inbox.get(3)!.find((m) => m.t === 'kill');
    assert.ok(kill && kill.t === 'kill' && kill.cause === 'grenade');

    // A second boom without a new throw does nothing.
    a.lobby.members.get(2)!.info.alive = true;
    a.lobby.handle(c1, { t: 'boom', p: [-19, 1, 15] });
    assert.equal(a.lobby.members.get(2)!.info.alive, true);

    // After the cooldown you can throw again.
    now += GRENADE.cooldown * 1000;
    a.lobby.handle(c1, { t: 'nade', p: [0, 1.6, 0], v: [0, 5, -15] });
    assert.equal(a.inbox.get(2)!.filter((m) => m.t === 'nade').length, 2);
  } finally {
    Date.now = realNow;
    a.stop();
  }
});

test('server: a boom with no grenade thrown, or from far away, is ignored', () => {
  const realNow = Date.now;
  let now = 9_000_000;
  Date.now = () => now;
  const a = arena();
  try {
    a.at(1, [-20, 0.01, 15]);
    a.at(2, [-19, 0.01, 15]);
    const [c1] = a.clients;
    a.lobby.handle(c1, { t: 'boom', p: [-19, 1, 15] });
    assert.equal(a.lobby.members.get(2)!.info.alive, true, 'never threw one');
    a.lobby.handle(c1, { t: 'nade', p: [0, 1.6, 0], v: [0, 5, -15] });
    now += 2300;
    a.lobby.handle(c1, { t: 'boom', p: [-19, 1, 500] });
    assert.equal(a.lobby.members.get(2)!.info.alive, true, 'blast reported nowhere near the throw');
  } finally {
    Date.now = realNow;
    a.stop();
  }
});
