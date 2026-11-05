// Dev-only lab for the TŌGE car models: every car in a row (or one up close) under studio lights.
// window.lab: show(id | 'all'), view(yawDeg, pitchDeg, dist), look({...}), cos({slot: itemId}), spin(on), rider(random), pose(steer, lat) (a bike leans
// with lat, m/s²), cockpit() (the driver's / rider's eye of the one car shown).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_IDS, type CarId, type Look, carSpec, newOwnedCar } from '../src/toge/shared/cars.ts';
import { type CarModel, buildCar } from '../src/toge/client/carmodel.ts';
import type { CosKit } from '../src/toge/shared/cosmetics.ts';
import { buildCockpit } from '../src/toge/client/cockpit.ts';
import { type Rider, RIDER_IDS, defaultRider } from '../src/toge/shared/rider.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e25);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.6, metalness: 0.2 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(6, 10, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 10, bottom: -10 });
scene.add(key);
const rimLight = new THREE.DirectionalLight(0x9fd8ff, 1.2);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);

let models: CarModel[] = [];
let current: CarId | 'all' = 'all';
let look: Partial<Look> = {};
let cos: CosKit = {};
let yaw = 35;
let pitch = 12;
let dist = 0;
let spinning = false;
let rider: Rider = defaultRider();

function show(id: CarId | 'all' = current) {
  current = id;
  for (const m of models) {
    scene.remove(m.root);
    m.dispose();
  }
  const ids = id === 'all' ? CAR_IDS : [id];
  models = ids.map((cid, i) => {
    const owned = newOwnedCar(cid, i);
    owned.look = { ...owned.look, ...look };
    owned.cos = { ...cos };
    const sp = carSpec(owned);
    const m = buildCar(owned, rider);
    m.root.position.set((i - (ids.length - 1) / 2) * 2.6, sp.cg, 0);
    m.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), 0.2, false);
    scene.add(m.root);
    return m;
  });
  place();
}

function place() {
  const d = dist || (current === 'all' ? 17 : 8);
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  camera.position.set(Math.sin(y) * Math.cos(p) * d, 0.6 + Math.sin(p) * d, Math.cos(y) * Math.cos(p) * d);
  camera.lookAt(0, 0.6, 0);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const ui = document.getElementById('ui')!;
for (const id of ['all', ...CAR_IDS] as const) {
  const b = document.createElement('button');
  b.textContent = id;
  b.onclick = () => show(id);
  ui.append(b);
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  if (spinning) {
    yaw += ((now - last) / 1000) * 20;
    place();
  }
  last = now;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

(window as unknown as { lab: unknown }).lab = {
  show,
  view(yawDeg: number, pitchDeg = pitch, d = 0) {
    yaw = yawDeg;
    pitch = pitchDeg;
    dist = d;
    place();
    renderer.render(scene, camera);
  },
  look(l: Partial<Look>) {
    look = l;
    show();
  },
  /** Dresses every car in cosmetics, e.g. cos({ wing: 'wg_boso', roof: 'rf_duck' }). */
  cos(kit: CosKit) {
    cos = kit;
    show();
  },
  /** Who rides the bikes: a random driver (or the default with no argument). */
  rider(random = false) {
    rider = random ? RIDER_IDS[Math.floor(Math.random() * RIDER_IDS.length)] : defaultRider();
    show();
  },
  spin(on: boolean) {
    spinning = on;
  },
  render: () => renderer.render(scene, camera),
  /** Draw calls and triangles of the last frame, to keep an eye on what a car costs. */
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  /** Steers every model shown and leans the bikes (lat: cornering force, m/s², + left); pose() repeats until settled. */
  pose(steer = 0.2, lat = 0) {
    for (const [i, m] of models.entries()) {
      const sp = carSpec(newOwnedCar(current === 'all' ? CAR_IDS[i] : current));
      for (let k = 0; k < 40; k++) m.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), steer, false, lat);
    }
    renderer.render(scene, camera);
  },
  /** Looks out from the driver's seat of the one model shown (a bike's rider is hidden, as in the race). */
  cockpit() {
    if (current === 'all') return;
    const m = models[0];
    const seat = (m.root.userData.lean as THREE.Object3D | undefined) ?? m.root;
    const pit = buildCockpit(current, carSpec(newOwnedCar(current)));
    seat.add(pit.root);
    const rider = m.root.userData.rider as THREE.Object3D | undefined;
    if (rider) rider.visible = false;
    scene.updateMatrixWorld(true);
    camera.position.copy(pit.eye.clone().applyMatrix4(seat.matrixWorld));
    camera.quaternion.copy(seat.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0)));
    camera.fov = 60;
    camera.near = 0.06;
    camera.updateProjectionMatrix();
    pit.update(0, 6000, 120);
    renderer.render(scene, camera);
  },
};
show('all');
