// The Skyline: the Foundry's buyable roof surf. A hatch in the Hall roof (a door, bought like one) opens a launch pad up
// onto a tower; three surf lines run from it and dive through chutes into the Boiler Room, Storage and the Furnace.
// A chute stays lidded until its room is open, so the roof never skips a door.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildColliders, openRooms } from '../src/shared/colliders.ts';
import { TICK_DT } from '../src/shared/constants.ts';
import { FOUNDRY } from '../src/shared/foundry.ts';
import { type MoveInput, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../src/shared/movement.ts';

const lay = FOUNDRY.survival!;
const hatch = lay.doors[lay.hatch];
const allOpen = lay.doors.map(() => true);
const roomName = (i: number) => lay.rooms[i].name;

test('the hatch is a door that joins no rooms; the pad under it is live only once it is open', () => {
  assert.equal(hatch.name, 'Skyline');
  assert.ok(hatch.box.min.y >= 9, 'in the roof');
  assert.ok(!lay.links.some((l) => l.door === lay.hatch), 'no zombie route through the roof');
  const shut = buildColliders(FOUNDRY, allOpen.map((_, i) => i !== lay.hatch));
  assert.ok(!shut.move.includes(lay.hatchPad) && shut.move.includes(hatch.box));
  const open = buildColliders(FOUNDRY, allOpen);
  assert.ok(open.move.includes(lay.hatchPad) && !open.move.includes(hatch.box));
  assert.ok(!open.zombie.includes(lay.hatchPad), 'zombies never ride it');
});

test('a chute is lidded until its room is open', () => {
  assert.deepEqual(lay.chutes.map((c) => roomName(c.room)).sort(), ['Boiler Room', 'Furnace', 'Storage']);
  const none = buildColliders(FOUNDRY, []);
  for (const c of lay.chutes) assert.ok(none.move.includes(c.lid));
  const all = buildColliders(FOUNDRY, allOpen);
  for (const c of lay.chutes) assert.ok(!all.move.includes(c.lid));
  // Only the Office door and the Boiler Room's: the Boiler chute opens, the others stay shut.
  const doors = lay.doors.map((d) => d.name === 'Office door' || d.name === 'Boiler Room');
  const open = openRooms(FOUNDRY, doors);
  const some = buildColliders(FOUNDRY, doors);
  for (const c of lay.chutes) assert.equal(some.move.includes(c.lid), !open.has(c.room), roomName(c.room));
});

/** Steps a player until `done` says stop (or time runs out). */
function play(s: PlayerState, input: MoveInput, seconds: number, boxes: typeof FOUNDRY.boxes, each: () => boolean) {
  for (let i = 0; i < seconds / TICK_DT; i++) {
    if (!each()) return;
    stepPlayer(s, input, TICK_DT, boxes, []);
    input.jumpPressed = false;
  }
}

const tower = () => {
  const s = createPlayerState({ x: (hatch.box.min.x + hatch.box.max.x) / 2, y: 0.3, z: lay.hatchPad.min.z + 1.25 });
  const cols = buildColliders(FOUNDRY, allOpen);
  play(s, emptyInput(), 4, cols.move, () => !(s.onGround && s.pos.y > 10));
  return s;
};

test('the pad throws you up through the hatch onto the tower', () => {
  const s = tower();
  assert.ok(s.onGround && s.pos.y > 15, `ended at ${JSON.stringify(s.pos)}`);
});

/** Ride a line from the tower top: walk off along `dir`, then hold toward the ridge until you land somewhere. */
function ride(dir: 'w' | 'e' | 'n', doors: boolean[]) {
  const s = createPlayerState({ x: 0, y: 16.01, z: -5.5 });
  const cols = buildColliders(FOUNDRY, doors);
  const input: MoveInput = { ...emptyInput(), forward: 1, yaw: dir === 'w' ? Math.PI / 2 : dir === 'e' ? -Math.PI / 2 : 0 };
  let airborne = false;
  play(s, input, 8, cols.move, () => {
    const along = dir === 'w' ? -s.pos.x : dir === 'e' ? s.pos.x : -s.pos.z - 5.5; // from the tower's middle
    if (!s.onGround && along > 2) airborne = true; // off the tower
    if (airborne && s.onGround) return false;
    if (along > 2 && !s.onGround) {
      // Hold into whichever face we're on (toward the ridge), facing along the line.
      const lat = dir === 'n' ? s.pos.x : s.pos.z + 5.5;
      input.forward = 0;
      input.right = dir === 'w' ? (lat > 0 ? 1 : -1) : lat > 0 ? -1 : 1;
    }
    return true;
  });
  return s;
}

test('each line delivers you into its room once that room is open', () => {
  const room = { w: 'Boiler Room', e: 'Storage', n: 'Furnace' } as const;
  for (const dir of ['w', 'e', 'n'] as const) {
    const s = ride(dir, allOpen);
    const r = lay.rooms.find((x) => x.name === room[dir])!;
    assert.ok(s.pos.y < 9 && s.pos.x > r.x0 && s.pos.x < r.x1 && s.pos.z > r.z0 && s.pos.z < r.z1, `${dir}: ended at ${JSON.stringify(s.pos)}`);
  }
});

test('with its room still shut, a line drops you on the lid (on the roof), not into the room', () => {
  const doors = lay.doors.map((d) => d.id === lay.hatch || d.name === 'Office door');
  for (const dir of ['w', 'e', 'n'] as const) {
    const s = ride(dir, doors);
    assert.ok(s.pos.y > 9.5, `${dir}: ended at ${JSON.stringify(s.pos)}`);
  }
});
