// Full-length pictures of drivers for the menus (the race lobby's crew). One small offscreen WebGL renderer draws
// each driver once into a PNG, cached by rider, so a lobby of eight costs at most four renders and no live canvases.
// Every portrait uses the same camera, so a tall driver stands taller than a short one.

import * as THREE from 'three';
import { decodeRider, defaultRider, type Rider } from '../shared/rider.ts';
import { loadDriver } from './driver.ts';

export const PORTRAIT = { w: 160, h: 320 };

const cache = new Map<Rider, string>();
const pending = new Map<Rider, Promise<void>>();
let kit: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function setup() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(PORTRAIT.w, PORTRAIT.h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // The showroom's light, roughly: a warm key from the front, cyan and magenta neon rims behind.
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x20232c, 1.1));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.6);
  key.position.set(1.5, 3, 4);
  const rimC = new THREE.DirectionalLight(0x38c9ff, 2.4);
  rimC.position.set(-4, 2.5, -3);
  const rimM = new THREE.DirectionalLight(0xff3d9a, 2);
  rimM.position.set(4, 2.5, -3);
  scene.add(key, rimC, rimM);
  const camera = new THREE.PerspectiveCamera(19, PORTRAIT.w / PORTRAIT.h, 0.1, 30);
  camera.position.set(0.8, 1.1, 5.7);
  camera.lookAt(0, 0.96, 0);
  return { renderer, scene, camera };
}

/**
 * A PNG data URL of the driver standing three-quarters to camera, or '' until it's drawn: the model loads first,
 * and `ready` runs once the picture is in the cache (redraw then). Bad codes draw the default driver.
 */
export function riderPortrait(code: string, ready?: () => void): string {
  const r = decodeRider(code) ?? defaultRider();
  if (cache.has(r)) return cache.get(r)!;
  let p = pending.get(r);
  if (!p) {
    p = loadDriver(r).then((rig) => {
      try {
        kit ??= setup();
        rig.stand();
        // The rig faces -Z; turn it to the camera, a little off square.
        rig.root.rotation.y = Math.PI + 0.28;
        kit.scene.add(rig.root);
        kit.renderer.render(kit.scene, kit.camera);
        cache.set(r, kit.renderer.domElement.toDataURL('image/png'));
      } catch {
        cache.set(r, ''); // no WebGL: the lobby still lists names and cars
      } finally {
        rig.dispose();
      }
    });
    p.catch(() => {}).finally(() => pending.delete(r));
    pending.set(r, p);
  }
  if (ready) p.then(ready, () => {});
  return '';
}

/** Frees the renderer (the race needs the WebGL context more than the lobby does). Pictures stay cached. */
export function releasePortraits() {
  kit?.renderer.dispose();
  kit?.renderer.forceContextLoss();
  kit = null;
}
