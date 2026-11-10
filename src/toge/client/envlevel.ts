// How strongly each material reflects the sky environment in a race.
//
// three.js gives every material without an envMap of its own the scene's `environmentIntensity` and ignores the
// material's `envMapIntensity` (WebGLRenderer, "envMapIntensity.value = scene.environmentIntensity"). So the clear
// coat's 1.6, the glass's 1.8-3, the wet night road's 2.5 and chrome's 3.2 all came out as the scene's flat 0.55, and
// every car looked like matte plastic. A scene marked with `envLevel()` gives each material its own share again
// (scene level × the material's envMapIntensity) by setting the scene's value just before that material draws: one
// number per draw call, nothing per pixel. Scenes that aren't marked (the showroom, the player card) are untouched.

import * as THREE from 'three';

type Lit = THREE.Material & { envMapIntensity: number };

function beforeDraw(this: Lit, _r: THREE.WebGLRenderer, scene: THREE.Scene) {
  const level = scene.userData.envLevel as number | undefined;
  if (level !== undefined) scene.environmentIntensity = level * this.envMapIntensity;
}

// Every material three.js applies the scene environment to (Low graphics' Lambert/Phong stand-ins included).
for (const Kind of [THREE.MeshStandardMaterial, THREE.MeshLambertMaterial, THREE.MeshPhongMaterial]) {
  Kind.prototype.onBeforeRender = beforeDraw as THREE.Material['onBeforeRender'];
}

/** Marks `scene` so each material reflects its environment at `level` × its own envMapIntensity. */
export function envLevel(scene: THREE.Scene, level: number) {
  scene.userData.envLevel = level;
  scene.environmentIntensity = level;
}
