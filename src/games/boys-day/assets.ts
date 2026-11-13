// The models built in Blender (art/build.py → art/boys-day.glb): one file of named meshes with vertex colours and no
// textures. The game takes their geometry and keeps its own toon materials, instancing and per-instance tints.
// Everything that uses one falls back to the old shapes built in code if the file didn't load.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toon } from './models.ts';

const geos = new Map<string, THREE.BufferGeometry>();
let loading: Promise<void> | null = null;
let done = false;

/** Loads the models once (the first call starts it; a failure just leaves the old shapes in use). */
export function loadArt(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(new URL('./art/boys-day.glb', import.meta.url).href)
    .then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) geos.set(o.name, m.geometry);
      });
    })
    .catch(() => {})
    .then(() => {
      done = true;
    });
  return loading;
}

export const artReady = () => done;

/** A model's geometry by its Blender name (shared: don't change it), or null without the file. */
export const art = (name: string) => geos.get(name) ?? null;

/** Toon shading that keeps a model's own vertex colours (times `color`, and any per-instance tint). */
export const toonArt = (color: THREE.ColorRepresentation = '#ffffff', extra: THREE.MeshToonMaterialParameters = {}) => toon(color, { vertexColors: true, ...extra });
