// Full-length pictures of drivers for the menus (the race lobby's crew). One small offscreen WebGL renderer draws
// each rider once into a PNG, cached by rider code, so a lobby of eight costs eight renders and no live canvases.
// Every portrait uses the same camera, so a tall driver stands taller than a short one.

import * as THREE from 'three';
import { decodeRider, defaultRider } from '../shared/rider.ts';
import { buildRider } from './ridermodel.ts';

export const PORTRAIT = { w: 160, h: 320 };

const cache = new Map<string, string>();
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

/** A PNG data URL of the rider standing three-quarters to camera. Bad codes draw the default driver. */
export function riderPortrait(code: string): string {
  const hit = cache.get(code);
  if (hit) return hit;
  try {
    kit ??= setup();
    const m = buildRider(decodeRider(code) ?? defaultRider());
    m.root.rotation.y = 0.28;
    m.update(0);
    kit.scene.add(m.root);
    kit.renderer.render(kit.scene, kit.camera);
    const url = kit.renderer.domElement.toDataURL('image/png');
    m.dispose();
    cache.set(code, url);
    return url;
  } catch {
    return ''; // no WebGL: the lobby still lists names and cars
  }
}

/** Frees the renderer (the race needs the WebGL context more than the lobby does). Pictures stay cached. */
export function releasePortraits() {
  kit?.renderer.dispose();
  kit?.renderer.forceContextLoss();
  kit = null;
}
