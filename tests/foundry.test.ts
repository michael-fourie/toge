import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildColliders } from '../src/shared/colliders.ts';
import { TICK_DT } from '../src/shared/constants.ts';
import { FOUNDRY } from '../src/shared/foundry.ts';
import type { Vec3 } from '../src/shared/math.ts';
import { createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';
import { Nav } from '../src/shared/nav.ts';
import { isThrough, makeBrain } from '../src/shared/siege.ts';
import { createZombie, stepHorde } from '../src/shared/zombie.ts';

const lay = FOUNDRY.survival!;
const allOpen = lay.doors.map(() => true);
const none = lay.barricades.map(() => 0);
const open = buildColliders(FOUNDRY, allOpen, none);
const centre = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

/** Is a player-sized column at p overlapping any solid? */
const clear = (p: Vec3, boxes = open.move) =>
  !boxes.some((b) => !b.ramp && p.x + 0.4 > b.min.x && p.x - 0.4 < b.max.x && p.z + 0.4 > b.min.z && p.z - 0.4 < b.max.z && p.y + 1.8 > b.min.y && p.y + 0.1 < b.max.y);

test('everything you stand on or spawn at is clear and on the floor', () => {
  const spots: [string, Vec3][] = [
    ...lay.start.map((s, i): [string, Vec3] => [`start ${i}`, s.pos]),
    ...lay.wallBuys.map((w): [string, Vec3] => [`wall ${w.weapon}`, w.at]),
    ...lay.boxSpots.map((b, i): [string, Vec3] => [`box spot ${i}`, { ...b.pos }]),
    ['punch', lay.punch],
    ['jug', lay.jug],
    ...lay.barricades.flatMap((b): [string, Vec3][] => [[`outside ${b.id}`, b.outside], [`inside ${b.id}`, b.inside], ...b.spawns.map((s, i): [string, Vec3] => [`spawn ${b.id}.${i}`, s])]),
  ];
  for (const [name, p] of spots) assert.ok(clear({ ...p, y: p.y + 0.01 }, open.zombie), `${name} is inside something: ${JSON.stringify(p)}`);
});

test('every room is reachable once every door is open, and only the start before that', () => {
  const nav = new Nav(lay);
  nav.setDoors(allOpen);
  for (const r of lay.rooms) assert.ok(nav.isOpen(r.id), `${r.name} unreachable`);
  nav.setDoors([]);
  assert.deepEqual(lay.rooms.filter((r) => nav.isOpen(r.id)).map((r) => r.name), ['Office']);
  nav.setDoors([true]);
  assert.ok(nav.isOpen(2) && nav.isOpen(1) && !nav.isOpen(4), 'the first door opens the hall, the stairs and the mezzanine only');
});

test('a player walks up the stairs onto the mezzanine', () => {
  const s = createPlayerState({ x: -15.9, y: 0.01, z: 4 });
  const input = { ...emptyInput(), forward: 1, yaw: 0 };
  for (let i = 0; i < 128 * 6; i++) stepPlayer(s, input, TICK_DT, open.move, FOUNDRY.triggers);
  assert.ok(s.pos.y > 3.9 && s.onGround, `ended at ${JSON.stringify(s.pos)}`);
});

test('players cannot climb out of a window, boarded or not', () => {
  for (const b of lay.barricades) {
    const s = createPlayerState({ x: b.inside.x, y: 0.01, z: b.inside.z });
    const input = { ...emptyInput(), forward: 1, jump: true, yaw: Math.atan2(-b.out.x, -b.out.z) };
    for (let i = 0; i < 128 * 3; i++) stepPlayer(s, input, TICK_DT, open.move, FOUNDRY.triggers);
    assert.ok((s.pos.x - b.pos.x) * b.out.x + (s.pos.z - b.pos.z) * b.out.z < 0.5, `window ${b.id}: got out to ${JSON.stringify(s.pos)}`);
  }
});

function siege(boards: number[], gate: number, target: Vec3, seconds: number, doors = allOpen) {
  const nav = new Nav(lay);
  nav.setDoors(doors);
  const brain = makeBrain(nav, lay, boards);
  const cols = buildColliders(FOUNDRY, doors, boards);
  const z = createZombie(1, lay.barricades[gate].spawns[0], 1, gate);
  let clawed = -1;
  let through = -1;
  for (let i = 0; i < seconds * 60; i++) {
    const hits = stepHorde([z], [{ id: 7, pos: target }], 1 / 60, cols.zombie, brain);
    if (z.gate >= 0 && isThrough(z, lay)) {
      z.gate = -1;
      through = i / 60;
    }
    if (hits.length && clawed < 0) clawed = i / 60;
  }
  return { z, clawed, through };
}

test('a zombie stays out of a boarded window', () => {
  const b = lay.barricades[0];
  const { z, through } = siege(lay.barricades.map(() => 5), 0, { x: b.inside.x, y: 0, z: b.inside.z }, 20);
  assert.equal(through, -1);
  assert.ok((z.pos.x - b.pos.x) * b.out.x + (z.pos.z - b.pos.z) * b.out.z > 0.3, 'it should still be outside');
});

test('from every window, the horde climbs in and reaches a player in every room', () => {
  for (const b of lay.barricades) {
    for (const room of lay.rooms) {
      if (room.name === 'Stairs') continue; // a ramp, not somewhere to stand
      const c = centre(room);
      const target = { x: c.x, y: room.name === 'Mezzanine' ? 4.01 : 0.01, z: c.z };
      const { clawed, z } = siege(none, b.id, target, 60);
      assert.ok(clawed >= 0, `window ${b.id} -> ${room.name}: never reached them, ended at ${JSON.stringify(z.pos)}`);
    }
  }
});

test('and wherever in a room you stand, not just in its middle', () => {
  for (const gate of [0, 8, 12]) {
    for (const room of lay.rooms) {
      if (room.name === 'Stairs') continue;
      const y = room.name === 'Mezzanine' ? 4.01 : 0.01;
      for (let i = 1; i <= 4; i++) {
        for (let j = 1; j <= 4; j++) {
          const p = { x: room.x0 + ((room.x1 - room.x0) * i) / 5, y, z: room.z0 + ((room.z1 - room.z0) * j) / 5 };
          if (!clear(p, open.zombie)) continue;
          const { clawed, z } = siege(none, gate, p, 60);
          assert.ok(clawed >= 0, `window ${gate} -> ${room.name} ${JSON.stringify(p)}: ended at ${JSON.stringify(z.pos)}`);
        }
      }
    }
  }
});
