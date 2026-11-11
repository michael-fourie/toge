import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUPS, CUP_IDS, GP_POINTS, addRound, pointsFor, roundLabel, roundsOf } from '../../src/toge/shared/cups.ts';
import { RACE_TRACKS, TRACK_DEFS, type TrackId } from '../../src/toge/shared/track.ts';
import { MODE_TRACK, cleanMode, recordMode } from '../../src/toge/shared/protocol.ts';

test('every race track is in a cup of four (the Postcard Cup has five), only the Velocity and Overdrive Cups borrow; the hill climb is in none', () => {
  const seen = new Map<TrackId, string>();
  for (const id of CUP_IDS) {
    const c = CUPS[id];
    assert.equal(c.id, id);
    assert.equal(c.tracks.length, id === 'postcard' ? 5 : 4);
    assert.equal(roundsOf(id), c.tracks.length);
    assert.equal(new Set(c.tracks).size, c.tracks.length, `${id} races different tracks`);
    for (const t of c.tracks) {
      assert.ok(Object.hasOwn(TRACK_DEFS, t), `${id}: ${t} is a track`);
      assert.ok(!TRACK_DEFS[t].climb, `${id}: ${t} is not a hill climb`);
      if (id !== 'velocity' && id !== 'rush') assert.ok(!seen.has(t), `${t} is in ${seen.get(t)} and ${id}`);
      if (!seen.has(t)) seen.set(t, id);
    }
  }
  assert.deepEqual(CUPS.velocity.tracks.filter((t) => seen.get(t) === 'velocity'), ['hayate', 'seatosky', 'ryusei'], 'the new fast roads live in Velocity');
  assert.deepEqual(CUPS.rush.tracks.filter((t) => seen.get(t) === 'rush'), ['isonami', 'shiden'], 'the six-lane grand prix roads live in Overdrive');
  assert.deepEqual(CUPS.sprint.tracks, ['mizuumi', 'hibari', 'kamome', 'shiokaze'], 'Sprint is the four sprint rings, easiest first, all its own');
  assert.ok(CUPS.sprint.tracks.every((t) => TRACK_DEFS[t].laps === 4), 'Sprint is all short 4-lap circuits');
  assert.deepEqual(CUPS.postcard.tracks, ['taketomi', 'hallstatt', 'goreme', 'oia', 'chefchaouen'], 'Postcard is the five town circuits, easiest first, all its own');
  assert.equal(roundLabel('postcard', 4), 'Round 5 of 5 · Chefchaouen Medina');
  // (Kumo Skyway, the sky road, isn't in a Grand Prix yet.)
  const races = RACE_TRACKS.filter((t) => !TRACK_DEFS[t].climb && t !== 'kumo');
  assert.deepEqual(races.filter((t) => !seen.has(t)), [], 'a new race track needs a cup');
});

test('Grand Prix plays race rules and keeps no best times; it opens on its first cup', () => {
  assert.equal(cleanMode('gp'), false);
  assert.equal(recordMode('gp'), false);
  assert.equal(MODE_TRACK.gp, CUPS.torii.tracks[0]);
});

test('points by place; DNF scores nothing', () => {
  assert.equal(pointsFor(1), GP_POINTS[0]);
  assert.equal(pointsFor(8), 1);
  assert.equal(pointsFor(0), 0);
  assert.equal(pointsFor(9), 0);
  for (let i = 1; i < GP_POINTS.length; i++) assert.ok(GP_POINTS[i] < GP_POINTS[i - 1]);
});

test('the cup table adds up rounds, ranks by points, then wins, then the last round', () => {
  let t = addRound([], 0, [
    { key: 'a', name: 'A', place: 1 },
    { key: 'b', name: 'B', place: 2 },
    { key: 'c', name: 'C', place: 0, cpu: true },
  ]);
  assert.deepEqual(t.map((r) => [r.key, r.pts, r.last]), [['a', 15, 15], ['b', 12, 12], ['c', 0, 0]]);
  assert.equal(t[2].cpu, true);
  t = addRound(t, 1, [
    { key: 'b', name: 'B', place: 1 },
    { key: 'a', name: 'A', place: 2 },
    { key: 'd', name: 'D', place: 3 },
  ]);
  // A and B tie on 27 and a win each; B was ahead in the latest round.
  assert.deepEqual(t.map((r) => [r.key, r.pts]), [['b', 27], ['a', 27], ['d', 10], ['c', 0]]);
  assert.deepEqual(t.find((r) => r.key === 'c')!.places, [0, 0], 'missed a round: 0 for it');
  assert.deepEqual(t.find((r) => r.key === 'd')!.places, [0, 3], 'a newcomer starts from nothing');
  // More wins beats more seconds on the same points.
  const u = addRound(
    addRound([], 0, [
      { key: 'x', name: 'X', place: 1 },
      { key: 'y', name: 'Y', place: 3 },
    ]),
    1,
    [
      { key: 'y', name: 'Y', place: 1 },
      { key: 'x', name: 'X', place: 4 },
    ],
  );
  assert.deepEqual(u.map((r) => [r.key, r.pts]), [['y', 25], ['x', 23]]);
});
