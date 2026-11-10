// Distance swaps for scenery that's built in tiles: a full-detail object near the camera and a cheaper one past
// `far` metres (or nothing at all, `null`), with a band of hysteresis so a tile on the line doesn't flicker.
// TrackView.follow() runs `update` once a frame; a few hundred tiles cost next to nothing.

import * as THREE from 'three';

/** Where the swap happens (m from the camera to the nearest point of the tile) and the band either side of it. */
export const LOD = { trees: 300, bushes: 420, terrain: 620, band: 40 };

interface Tile {
  near: THREE.Object3D;
  far: THREE.Object3D | null;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  dist: number;
  isFar: boolean;
}

export class LodTiles {
  private tiles: Tile[] = [];

  /** Every tile starts near; the first update sends the far ones far. */
  add(near: THREE.Object3D, far: THREE.Object3D | null, x0: number, z0: number, x1: number, z1: number, dist: number) {
    if (far) far.visible = false;
    this.tiles.push({ near, far, x0, z0, x1, z1, dist, isFar: false });
  }

  update(x: number, z: number) {
    for (const t of this.tiles) {
      const dx = Math.max(t.x0 - x, 0, x - t.x1);
      const dz = Math.max(t.z0 - z, 0, z - t.z1);
      const d = Math.hypot(dx, dz);
      const isFar = t.isFar ? d > t.dist - LOD.band : d > t.dist + LOD.band;
      if (isFar === t.isFar) continue;
      t.isFar = isFar;
      t.near.visible = !isFar;
      if (t.far) t.far.visible = isFar;
    }
  }
}

/** Shadow casters are cut into squares this big (m): the sun's shadow box is 90 m across, so only a few are drawn into it. */
const SHADOW_CELL = 100;

/**
 * Objects drawn only into the shadow map. three.js lists what the camera draws (checking `visible`) before it draws
 * the shadow map (checking `visible` again), so these are hidden while the camera's list is made (the scene's
 * onBeforeRender) and shown when the shadow map starts (the onBeforeShadow of an empty caster first in the scene).
 * If that order ever changed, these would only lose their shadows.
 */
export class ShadowOnly {
  private list: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    const before = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args) => {
      before(...args);
      for (const o of this.list) o.visible = false;
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geo.setDrawRange(0, 0);
    const start = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    start.castShadow = true;
    start.frustumCulled = false;
    start.onBeforeShadow = () => {
      for (const o of this.list) o.visible = true;
    };
    scene.add(start);
    scene.children.unshift(scene.children.pop()!);
  }

  add(o: THREE.Object3D) {
    o.visible = false;
    this.list.push(o);
  }
}

/**
 * Hands `im`'s shadow to copies of its instances cut into SHADOW_CELL squares (drawn only into the shadow map, `only`),
 * so the shadow map draws the trees near the camera instead of every tree of each 400 m tile it touches: on Monza that
 * was ~270k of its ~570k shadow triangles.
 */
export function shadowCasters(parent: THREE.Object3D, im: THREE.InstancedMesh, only: ShadowOnly | null) {
  if (!only || !im.castShadow) return;
  im.castShadow = false;
  const m = new THREE.Matrix4();
  const cells = new Map<string, number[]>();
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m);
    const key = `${Math.floor(m.elements[12] / SHADOW_CELL)}:${Math.floor(m.elements[14] / SHADOW_CELL)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(i);
  }
  for (const list of cells.values()) {
    const sh = new THREE.InstancedMesh(im.geometry, im.material, list.length);
    list.forEach((i, k) => (im.getMatrixAt(i, m), sh.setMatrixAt(k, m)));
    sh.castShadow = true;
    sh.computeBoundingSphere();
    parent.add(sh);
    only.add(sh);
  }
}
