// Full-length pictures of drivers for the menus (the race lobby's crew). One small offscreen WebGL renderer draws
// each driver once into a PNG, cached by rider, so a lobby of eight costs at most four renders and no live canvases.
// Every portrait uses the same camera, so a tall driver stands taller than a short one.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { carSpec, decodeCar } from '../shared/cars.ts';
import { decodeRider, defaultRider, type Rider } from '../shared/rider.ts';
import { buildCar } from './carmodel.ts';
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
  crewKit?.env.dispose();
  crewKit?.renderer.dispose();
  crewKit?.renderer.forceContextLoss();
  crewKit = null;
}

/** The crew's picture of a racer: their car with their driver standing in front of it. */
export const CREW_PORTRAIT = { w: 320, h: 270 };

/** The crew picture's usual camera distance, and the margin kept either side of the car and driver (m). */
const CREW_DIST = 7.6;
const CREW_FOV = 20;
const CREW_PAD = 0.25;

const crewCache = new Map<string, string>();
const crewPending = new Map<string, Promise<void>>();
let crewKit: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; env: THREE.Texture } | null = null;

function crewSetup() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  // Always drawn at 2x: the lobby shows these large (up to ~520 px wide), so a 1x picture would blur.
  renderer.setPixelRatio(2);
  renderer.setSize(CREW_PORTRAIT.w, CREW_PORTRAIT.h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // Paint and glass need something to reflect: a plain studio room, dimmed.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x20232c, 0.9));
  const key = new THREE.DirectionalLight(0xfff3e4, 2.4);
  key.position.set(2, 4, 6);
  const rimC = new THREE.DirectionalLight(0x38c9ff, 2.2);
  rimC.position.set(-5, 2.5, -3);
  const rimM = new THREE.DirectionalLight(0xff3d9a, 1.8);
  rimM.position.set(5, 2.5, -3);
  scene.add(key, rimC, rimM);
  // A tight lens from the same distance: at 30° the car and driver filled under half of the picture, and the lobby
  // shows these as the crew, so they should fill it. The width fit in `racerPortrait` reads `fov`, so long cars still fit.
  const camera = new THREE.PerspectiveCamera(CREW_FOV, CREW_PORTRAIT.w / CREW_PORTRAIT.h, 0.1, 40);
  camera.position.set(0, 1.4, CREW_DIST);
  camera.lookAt(0, 0.8, 0);
  return { renderer, scene, camera, env };
}

/**
 * A PNG data URL of the racer's car (nose swung toward the camera) with their driver standing in front of it, or ''
 * until it's drawn; `ready` runs once it's cached. Cached by car code + driver, like `riderPortrait`.
 */
export function racerPortrait(carCode: string, riderCode: string, ready?: () => void): string {
  const r = decodeRider(riderCode) ?? defaultRider();
  const owned = decodeCar(carCode);
  if (!owned) return riderPortrait(riderCode, ready);
  const key = `${carCode}|${r}`;
  if (crewCache.has(key)) return crewCache.get(key)!;
  let p = crewPending.get(key);
  if (!p) {
    p = loadDriver(r).then((rig) => {
      let car: ReturnType<typeof buildCar> | null = null;
      try {
        crewKit ??= crewSetup();
        const sp = carSpec(owned);
        car = buildCar(owned, null);
        car.root.position.y = sp.cg;
        car.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), 0.18, false);
        // The nose (-Z) turned to point right and toward the camera.
        car.root.rotation.y = -2.2;
        crewKit.scene.add(car.root);
        rig.stand();
        rig.root.rotation.y = Math.PI + 0.25;
        rig.root.position.set(-0.7, 0, 2.3);
        crewKit.scene.add(rig.root);
        // Long cars (the Vanta) ran off the sides of the fixed camera: centre on what's in the picture and back
        // off until its width fits. Shorter cars keep the usual framing.
        const { camera } = crewKit;
        const box = new THREE.Box3().setFromObject(car.root).union(new THREE.Box3().setFromObject(rig.root));
        const cx = (box.min.x + box.max.x) / 2;
        const halfW = (box.max.x - box.min.x) / 2 + CREW_PAD;
        const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
        const dist = Math.max(CREW_DIST, halfW / reach + Math.max(0, box.max.z));
        camera.position.set(cx, 1.4 + (dist - CREW_DIST) * 0.12, dist);
        camera.lookAt(cx, 0.8, 0);
        crewKit.renderer.render(crewKit.scene, camera);
        crewCache.set(key, crewKit.renderer.domElement.toDataURL('image/png'));
      } catch {
        crewCache.set(key, ''); // no WebGL: the lobby still lists names and cars
      } finally {
        car?.dispose();
        rig.dispose();
      }
    });
    p.catch(() => {}).finally(() => crewPending.delete(key));
    crewPending.set(key, p);
  }
  if (ready) p.then(ready, () => {});
  return '';
}
