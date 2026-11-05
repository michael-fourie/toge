// Dev-only lab for TŌGE drivers (src/toge/client/ridermodel.ts): a row of riders under studio light.
// window.lab: show(riders: Partial<Rider>[]), vary(key) (one rider per option of a field), random(n), view(yawDeg, pitchDeg, dist, y).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RIDER_FIELDS, type Rider, type RiderKey, defaultRider, randomRider } from '../src/toge/shared/rider.ts';
import { type RiderModel, buildRider } from '../src/toge/client/ridermodel.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e25);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.6 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 8, 7);
key.castShadow = true;
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 6, bottom: -2 });
scene.add(key, new THREE.HemisphereLight(0xbfd0ff, 0x202020, 0.6));
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

let models: RiderModel[] = [];
let yaw = 15;
let pitch = 4;
let dist = 0;
let aimY = 0.95;

function show(list: Partial<Rider>[]) {
  for (const m of models) m.dispose();
  models = list.map((p, i) => {
    const m = buildRider({ ...defaultRider(), ...p });
    m.root.position.x = (i - (list.length - 1) / 2) * 0.8;
    scene.add(m.root);
    return m;
  });
  frame();
}
const vary = (k: RiderKey, base: Partial<Rider> = {}) => show(RIDER_FIELDS.find((f) => f.key === k)!.options.map((_, i) => ({ ...base, [k]: i })));
const random = (n = 8) => show(Array.from({ length: n }, () => randomRider()));

function frame() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const span = Math.max(1, models.length) * 0.8;
  const d = dist || Math.max(4, span * 1.1 / camera.aspect + 2.5);
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  camera.position.set(Math.sin(y) * Math.cos(p) * d, aimY + Math.sin(p) * d, Math.cos(y) * Math.cos(p) * d);
  camera.lookAt(0, aimY, 0);
  camera.updateProjectionMatrix();
}
const view = (yawDeg = yaw, pitchDeg = pitch, d = dist, y = aimY) => {
  yaw = yawDeg;
  pitch = pitchDeg;
  dist = d;
  aimY = y;
  frame();
};
addEventListener('resize', frame);
renderer.setAnimationLoop((t) => {
  for (const m of models) m.update(t / 1000);
  renderer.render(scene, camera);
});
(window as unknown as { lab: unknown }).lab = { show, vary, random, view, renderer };
random();
