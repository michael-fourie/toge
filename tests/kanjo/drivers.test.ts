import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RIDERS, RIDER_IDS } from '../../src/kanjo/shared/rider.ts';

/** The JSON chunk of a .glb (the binary chunk isn't needed to check its structure). */
function gltf(id: string) {
  const b = readFileSync(new URL(`../../public/models/drivers/${id}.glb`, import.meta.url));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len)) as {
    animations: { name: string }[];
    nodes: { name: string; mesh?: number }[];
    skins: { joints: number[] }[];
    materials: { name: string; alphaMode?: string }[];
  };
}

test('every driver in the catalogue has a model the game can drive', () => {
  for (const id of RIDER_IDS) {
    assert.equal(RIDERS[id].id, id);
    const g = gltf(id);
    // driver.ts plays these clips, reads the head bone, and toggles parts by name.
    assert.deepEqual(g.animations.map((a) => a.name).sort(), ['drive', 'idle', 'ride'], id);
    const names = new Set(g.nodes.map((n) => n.name));
    for (const bone of ['head', 'pelvis', 'hand_l', 'hand_r', 'wheel', 'seat']) assert.ok(names.has(bone), `${id} has no ${bone} bone`);
    const meshes = g.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name);
    assert.ok(meshes.includes('body'), `${id} has no body`);
    assert.ok(meshes.some((m) => m.startsWith('seat_')) && meshes.some((m) => m.startsWith('wheel_')), `${id} has no seat or wheel`);
    assert.equal(g.skins.length, 1, `${id}: one skeleton`);
    // Hair and lashes are alpha cards: clipped, never blended (blending sorts badly through car glass).
    for (const m of g.materials) assert.ok(!(m.alphaMode === 'BLEND' && /brow|lash|bob|short|ponytail|afro|long|braid/.test(m.name)), `${id}: ${m.name} blends`);
  }
});
