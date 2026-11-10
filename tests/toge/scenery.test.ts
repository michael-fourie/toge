import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RACE_TRACKS, getTrack, lapView, roadDistance } from '../../src/toge/shared/track.ts';
import { decor } from '../../src/toge/client/scenery.ts';
import { bushGeometry, farTree, speciesFor } from '../../src/toge/client/trees.ts';
import { LOD, LodTiles } from '../../src/toge/client/lod.ts';

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

test("far trees are a fraction of the near ones, as tall and as wide, and face outward", () => {
  for (const theme of ['alpine', 'coast', 'desert', 'night', 'autumn', 'spring', 'city'] as const) {
    for (const sp of Object.values(speciesFor(theme)).filter((x) => typeof x === 'object')) {
      if (sp.noFar) continue;
      const far = farTree(sp.geo);
      assert.ok(tris(far) <= 30 && tris(far) < tris(sp.geo) * 0.6, `${theme}: ${tris(far)} vs ${tris(sp.geo)}`);
      sp.geo.computeBoundingBox();
      far.computeBoundingBox();
      const [a, b] = [sp.geo.boundingBox!, far.boundingBox!];
      assert.ok(Math.abs(b.max.y - a.max.y) < 0.5, `${theme}: height ${b.max.y} vs ${a.max.y}`);
      const reach = (g: THREE.BufferGeometry) => {
        const q = g.getAttribute('position');
        let r = 0;
        for (let i = 0; i < q.count; i++) r = Math.max(r, Math.hypot(q.getX(i), q.getZ(i)));
        return r;
      };
      assert.ok(reach(far) > reach(sp.geo) * 0.6 && reach(far) <= reach(sp.geo), `${theme}: width ${reach(far)} vs ${reach(sp.geo)}`);
      // Every side face's normal points away from the trunk (three.js culls the back of a front-facing triangle).
      const p = far.getAttribute('position');
      const idx = far.index!;
      const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let i = 0; i < idx.count; i += 3) {
        v.forEach((x, k) => x.fromBufferAttribute(p, idx.getX(i + k)));
        const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
        const mid = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
        if (Math.abs(n.y) > n.length() * 0.95) continue; // the cap underneath
        assert.ok(n.x * mid.x + n.z * mid.z > 0, `${theme}: an inward face`);
      }
    }
  }
});

test('level-of-detail tiles swap by distance, with a band so they never flicker', () => {
  const near = new THREE.Object3D();
  const far = new THREE.Object3D();
  const lods = new LodTiles();
  lods.add(near, far, 0, 0, 400, 400, LOD.trees);
  lods.update(200, 200);
  assert.ok(near.visible && !far.visible);
  lods.update(400 + LOD.trees + LOD.band + 1, 200);
  assert.ok(!near.visible && far.visible);
  lods.update(400 + LOD.trees, 200); // inside the band: stays far
  assert.ok(!near.visible && far.visible);
  lods.update(400 + LOD.trees - LOD.band - 1, 200);
  assert.ok(near.visible && !far.visible);
});

test('houses, shrines, landmarks and stands are planned off the road', () => {
  const keep = <T>(x: T) => x;
  for (const id of RACE_TRACKS) {
    const t = lapView(getTrack(id));
    const area = { x0: t.bounds.x0 - 420, x1: t.bounds.x1 + 420, z0: t.bounds.z0 - 420, z1: t.bounds.z1 + 420 };
    const plan = decor(new THREE.Scene(), t, keep, { night: false, low: false, forestAt: () => 0, area });
    if (t.def.theme !== 'city') assert.ok(plan.sites.length > 0, `${id} has no props`);
    for (const s of plan.sites) assert.ok(roadDistance(t, s.x, s.z) > t.edge + 2, `${id}: a prop at ${s.x.toFixed(0)}, ${s.z.toFixed(0)} is on the road`);
  }
});
