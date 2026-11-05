// The Foundry's other levels: the Undercroft (cellars at y -6), the North Wing's two storeys, the Skybridge and the gantry.
// Players walk every way between levels; rooms that stack are told apart; doors gate the new rooms; the secrets work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildColliders, openRooms } from '../../src/gambol/shared/colliders.ts';
import { TICK_DT } from '../../src/gambol/shared/constants.ts';
import { FOUNDRY } from '../../src/gambol/shared/foundry.ts';
import { findUse } from '../../src/gambol/shared/interact.ts';
import type { Vec3 } from '../../src/shared/math.ts';
import { createPlayerState, emptyInput, stepPlayer } from '../../src/gambol/shared/movement.ts';
import { Nav, roomAt } from '../../src/gambol/shared/nav.ts';

const lay = FOUNDRY.survival!;
const allOpen = lay.doors.map(() => true);
const room = (name: string) => {
  const r = lay.rooms.find((x) => x.name === name);
  assert.ok(r, name);
  return r;
};
const door = (name: string) => lay.doors.find((d) => d.name === name)!.id;
const nameAt = (p: Vec3) => roomAt(lay.rooms, p)?.name ?? 'yard';

/** Walk a player through waypoints (x, z), steering at each in turn. Returns where it got and the heights at each waypoint. */
function walk(from: Vec3, points: [number, number][], doors = allOpen) {
  const boxes = buildColliders(FOUNDRY, doors).move;
  const s = createPlayerState({ ...from });
  const heights: number[] = [];
  for (const [x, z] of points) {
    let t = 0;
    while (Math.hypot(s.pos.x - x, s.pos.z - z) > 0.6 && t < 8) {
      stepPlayer(s, { ...emptyInput(), forward: 1, yaw: Math.atan2(-(x - s.pos.x), -(z - s.pos.z)) }, TICK_DT, boxes, FOUNDRY.triggers);
      t += TICK_DT;
    }
    heights.push(s.pos.y);
    if (t >= 8) return { s, heights, stuck: [x, z] as [number, number] };
  }
  return { s, heights, stuck: null };
}

test('every new room has a floor, a ceiling over it and a name; level rooms lie on their floors', () => {
  for (const r of lay.rooms) {
    assert.ok(r.ceil > r.floor + 2, `${r.name}: room to stand`);
    assert.ok(r.y0 <= r.floor && r.y1 >= r.floor, `${r.name}: its nav bounds hold its floor`);
  }
  assert.equal(new Set(lay.rooms.map((r) => r.name)).size, lay.rooms.length, 'names are unique');
  const floors = new Set(lay.rooms.filter((r) => r.shape !== 'ramp').map((r) => r.floor));
  for (const y of [-6, 0, 4, 5]) assert.ok(floors.has(y), `a level at y ${y}`);
});

test('stacked rooms are told apart: gantry over the furnace, loft over the wing, cellars under the hall', () => {
  assert.equal(nameAt({ x: 5.75, y: 4, z: -25 }), 'Gantry');
  assert.equal(nameAt({ x: 5.75, y: 0, z: -25 }), 'Furnace');
  assert.equal(nameAt({ x: -20, y: 5, z: -55 }), 'Drafting Loft');
  assert.equal(nameAt({ x: -20, y: 0, z: -55 }), 'Showroom');
  assert.equal(nameAt({ x: 12, y: -6, z: -25 }), 'Pump Room');
  assert.equal(nameAt({ x: 12, y: 0, z: -25 }), 'Furnace');
  assert.equal(nameAt({ x: 21, y: 0, z: -17 }), 'Loading Dock', 'not the cellar stairs under it');
  assert.equal(nameAt({ x: 2, y: 5, z: -68 }), 'Drafting Loft', 'not the stairs under its floor');
  assert.equal(nameAt({ x: 12, y: -3, z: -16 }), 'Undercroft Stairs');
  assert.equal(nameAt({ x: -8, y: 5, z: -68 }), 'Stair Landing');
  assert.equal(nameAt({ x: 5.75, y: 4.5, z: -38 }), 'Skybridge');
  assert.equal(nameAt({ x: 5.75, y: 0, z: -38 }), 'yard', 'under the Skybridge is the yard');
});

test('a player walks the whole new loop: Hall, down to the Undercroft, the Rail Tunnel, up into the North Wing, upstairs, over the Skybridge and back onto the mezzanine', () => {
  const { s, heights, stuck } = walk({ x: 5.95, y: 0.01, z: -10 }, [
    [5.95, -15], // through the Undercroft door onto the landing
    [8.5, -15.95],
    [18.5, -15.95], // down the stairs
    [19.85, -17],
    [19.85, -20], // into the Pump Room
    [7, -27],
    [7, -32], // through the Rail Tunnel door
    [8.5, -43], // round the old mine cart
    [8.5, -48],
    [7, -64.5], // up the ramp into the Parcel Bay
    [6.5, -68],
    [-5.5, -68], // up the Wing Stairs
    [-8.2, -67.8],
    [-8.2, -63.5], // through the Drafting Loft door
    [5.75, -46],
    [5.75, -38], // the Skybridge
    [5.75, -25], // the gantry, through the Furnace
    [5.75, -16], // the mezzanine
  ]);
  assert.equal(stuck, null, `stuck heading for ${stuck} at ${JSON.stringify(s.pos)}`);
  const at = (i: number, y: number, what: string) => assert.ok(Math.abs(heights[i] - y) < 0.3, `${what}: y ${heights[i].toFixed(2)}, wanted ${y}`);
  at(1, 0, 'the stairs landing');
  at(2, -6, 'the foot of the Undercroft stairs');
  at(9, 0, 'out of the tunnel pit');
  at(11, 4.6, 'near the top of the Wing Stairs');
  at(13, 5, 'the Drafting Loft');
  at(15, 4.5, 'halfway over the Skybridge');
  at(16, 4, 'the gantry');
  at(17, 4, 'the mezzanine');
});

test('the collapsed wall: from Cold Storage through the Old Drain and up into the Showroom', () => {
  const { s, heights, stuck } = walk({ x: 4, y: -5.99, z: -24.5 }, [
    [-0.5, -24.5],
    [-13, -27],
    [-13, -33],
    [-13, -48],
    [-13, -64.5],
    [-23, -62],
    [-28.5, -61.5], // round the mannequins
    [-28.5, -55],
  ]);
  assert.equal(stuck, null, `stuck heading for ${stuck} at ${JSON.stringify(s.pos)}`);
  assert.ok(heights[2] < -5.8 && Math.abs(heights[4]) < 0.3, 'down in the drain, then up at the top');
  assert.equal(nameAt(s.pos), 'Showroom');
  // A free way in: buying Cold Storage opens the drain, the Fitting Rooms and the Showroom too.
  const doors = lay.doors.map((d) => ['Office door', 'Furnace', 'Undercroft', 'Cold Storage'].includes(d.name));
  const open = openRooms(FOUNDRY, doors);
  for (const n of ['Old Drain', 'Showroom', 'Fitting Rooms']) assert.ok(open.has(room(n).id), n);
  assert.ok(!open.has(room('Sorting Floor').id) && !open.has(room('Drafting Loft').id));
});

test('the Duck Shrine: squeeze in through the flooded corner of the Pump Room; a Hammer LMG on its wall and a Mystery Box spot', () => {
  const shrine = room('Duck Shrine');
  const { s, stuck } = walk({ x: 15, y: -5.99, z: -26 }, [
    [19.5, -26],
    [24, -26],
  ]);
  assert.equal(stuck, null, `stuck heading for ${stuck} at ${JSON.stringify(s.pos)}`);
  assert.equal(nameAt(s.pos), 'Duck Shrine');
  const gun = lay.wallBuys.find((w) => w.room === shrine.id);
  assert.equal(gun?.weapon, 'hammer');
  assert.ok(lay.boxSpots.some((b) => b.room === shrine.id));
  const ctx = { lay, doorsOpen: allOpen, boards: [], box: { spot: 0, phase: 'closed' as const, gun: null, owner: 0, left: 0 }, points: 5000, slots: [{ w: 'sparrow' as const, up: false }, null], cur: 0, jug: false, perks: [], downed: [], self: 1, power: true, parts: [], scythe: 0 };
  assert.equal(findUse(gun!.at, ctx)?.text, 'Buy Hammer LMG');
});

test('doors gate the new levels: with only the Hall open, no way down, up or across', () => {
  const doors = lay.doors.map((d) => d.name === 'Office door');
  const tries: [Vec3, [number, number][], string][] = [
    [{ x: 5.95, y: 0.01, z: -10 }, [[5.95, -16], [12, -16]], 'into the Undercroft'],
    [{ x: 0, y: 4.01, z: -15 }, [[5.75, -16], [5.75, -36]], 'over the Skybridge'],
  ];
  for (const [from, pts, what] of tries) {
    const { s } = walk(from, pts, doors);
    assert.ok(s.pos.y > -0.5 && s.pos.z > -33, `${what}: got to ${JSON.stringify(s.pos)}`);
  }
  const open = openRooms(FOUNDRY, doors);
  assert.ok(open.has(room('Gantry').id), 'the gantry is part of the mezzanine');
  for (const n of ['Pump Room', 'Skybridge', 'Drafting Loft', 'Sorting Floor']) assert.ok(!open.has(room(n).id), n);
});

test('a raised door is bought from its own floor, not from the storey under it', () => {
  const bridge = lay.doors[door('Skybridge')];
  const ctx = { lay, doorsOpen: [], boards: [], box: { spot: 0, phase: 'closed' as const, gun: null, owner: 0, left: 0 }, points: 9000, slots: [], cur: 0, jug: false, perks: [], downed: [], self: 1, power: true, parts: [], scythe: 0 };
  const below = { x: 5.75, y: 0, z: -31 };
  const onIt = { x: 5.75, y: 4, z: -31 };
  assert.notEqual(findUse(below, ctx)?.id, bridge.id, 'not from the Furnace floor');
  assert.equal(findUse(onIt, ctx)?.text, 'Open Skybridge');
  assert.equal(findUse({ x: 0, y: 0, z: 1 }, ctx)?.text, 'Open Skyline', 'the roof hatch is still bought from below');
});

test('prices climb the deeper you go, and every door is somewhere a player can stand by it', () => {
  const nav = new Nav(lay);
  const order = ['Undercroft', 'Cold Storage', 'Rail Tunnel', 'Showroom', 'Drafting Loft', 'Clock Room', 'Skybridge'];
  const prices = order.map((n) => lay.doors[door(n)].price);
  prices.slice(1).forEach((p, i) => assert.ok(p > prices[i], `${order[i + 1]} (${p}) costs more than ${order[i]} (${prices[i]})`));
  assert.ok(prices[0] >= 1500 && prices[prices.length - 1] >= 3000);
  for (const d of lay.doors) {
    if (d.id === lay.hatch) continue;
    for (const r of d.rooms) assert.ok(nav.roomAt({ x: (lay.rooms[r].x0 + lay.rooms[r].x1) / 2, y: lay.rooms[r].floor + 0.01, z: (lay.rooms[r].z0 + lay.rooms[r].z1) / 2 }) >= 0, `${d.name}: ${lay.rooms[r].name}`);
  }
});
