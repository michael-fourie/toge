// Dev-only lab for the KANJO drivers: legends and custom looks side by side, standing or seated.
// window.lab: show(ids[]) (legend ids or look codes), view(yawDeg, pitchDeg, dist, y, x?, z?), sit(on), ride(), steer(s),
// look (the current custom Look; edit it then call lab.custom()), random().

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DEFAULT_LOOK, encodeLook, type Look, randomLook } from '../src/kanjo/shared/look.ts';
import { type DriverRig, loadDriver } from '../src/kanjo/client/driver.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e25);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.7 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
key.position.set(3, 6, 5);
key.castShadow = true;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fd8ff, 1.4);
rim.position.set(-4, 3, -4);
scene.add(rim);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);

let rigs: DriverRig[] = [];
let ids: string[] = ['marlowe', encodeLook(DEFAULT_LOOK)];
let pose: 'stand' | 'sit' | 'ride' = 'stand';
let steer = 0;
let yaw = 0, pitch = 6, dist = 5.5, height = 0.95;
/** What the camera orbits: x and z (height is `height`). */
let aimX = 0, aimZ = 0;
let look: Look = DEFAULT_LOOK;

async function show(list: string[] = ids) {
  ids = list;
  for (const r of rigs) r.dispose();
  rigs = await Promise.all(list.map((id) => loadDriver(id, { shadows: true })));
  rigs.forEach((r, i) => {
    r.root.position.x = (i - (rigs.length - 1) / 2) * 0.9;
    r.root.rotation.y = Math.PI; // face the camera
    if (pose === 'sit') {
      r.sit();
      r.steer(steer, 1);
      r.root.position.y = 0.55;
    } else if (pose === 'ride') {
      r.ride();
      r.root.position.y = 0.8;
    } else r.stand();
    scene.add(r.root);
  });
}

function place() {
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  camera.position.set(aimX + Math.sin(y) * Math.cos(p) * dist, height + Math.sin(p) * dist, aimZ + Math.cos(y) * Math.cos(p) * dist);
  camera.lookAt(aimX, height, aimZ);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
place();

let last = performance.now();
function frame(t = performance.now()) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  for (const r of rigs) r.update(dt);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

const lab = {
  show,
  /** Orbit `d` m from (x, h, z) (x, z default to the middle): close-ups of the hands. */
  view(y = yaw, p = pitch, d = dist, h = height, x = 0, z = 0) {
    [yaw, pitch, dist, height, aimX, aimZ] = [y, p, d, h, x, z];
    place();
    frame();
  },
  sit(on = true) {
    pose = on ? 'sit' : 'stand';
    return show();
  },
  ride() {
    pose = 'ride';
    return show();
  },
  steer(s: number) {
    steer = s;
    for (const r of rigs) r.steer(s, 1);
    frame();
  },
  get look() {
    return look;
  },
  custom(l: Look = look) {
    look = l;
    return show(['marlowe', encodeLook(l)]);
  },
  random() {
    return lab.custom(randomLook());
  },
  frame,
};
(window as unknown as { lab: typeof lab }).lab = lab;
show();
