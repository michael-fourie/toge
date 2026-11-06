import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TRACK_DEFS, type TrackId, getTrack, lapView, roadDistance } from '../../src/toge/shared/track.ts';
import { decor } from '../../src/toge/client/scenery.ts';
import { bushGeometry, speciesFor } from '../../src/toge/client/trees.ts';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

test('trees and bushes stay light: a forest is tens of thousands of them', () => {
  for (const theme of ['alpine', 'coast', 'desert', 'night', 'autumn', 'spring', 'city'] as const) {
    const { a, b } = speciesFor(theme);
    // The old single-species trees were 50-184 triangles; the broadleaf crowns are the heaviest.
    assert.ok(tris(a.geo) <= 170, `${theme} a: ${tris(a.geo)}`);
    assert.ok(tris(b.geo) <= 130, `${theme} b: ${tris(b.geo)}`);
  }
  assert.ok(tris(bushGeometry()) <= 60);
});

test('houses, shrines, landmarks and stands are planned off the road', () => {
  const keep = <T>(x: T) => x;
  for (const id of Object.keys(TRACK_DEFS) as TrackId[]) {
    const t = lapView(getTrack(id));
    const area = { x0: t.bounds.x0 - 420, x1: t.bounds.x1 + 420, z0: t.bounds.z0 - 420, z1: t.bounds.z1 + 420 };
    const plan = decor(new THREE.Scene(), t, keep, { night: false, low: false, forestAt: () => 0, area });
    if (t.def.theme !== 'city') assert.ok(plan.sites.length > 0, `${id} has no props`);
    for (const s of plan.sites) assert.ok(roadDistance(t, s.x, s.z) > t.edge + 2, `${id}: a prop at ${s.x.toFixed(0)}, ${s.z.toFixed(0)} is on the road`);
  }
});
