// Product-shot lighting for the small WebGL previews in the menus (item icons, the character preview, contraption
// cards): a soft studio environment so metals, enamel and cloth read as what they are, plus a warm key light.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const envs = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function studio(renderer: THREE.WebGLRenderer, scene: THREE.Scene, keyFrom = new THREE.Vector3(-2, 4, -3)) {
  renderer.toneMapping = THREE.AgXToneMapping;
  let env = envs.get(renderer);
  if (!env) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    envs.set(renderer, env);
  }
  scene.environment = env;
  scene.environmentIntensity = 0.85;
  const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
  key.position.copy(keyFrom);
  scene.add(key, new THREE.HemisphereLight(0xfff4dc, 0x9fb7d8, 0.4));
}
