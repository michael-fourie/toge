import * as THREE from 'three';
import type { GunRig } from './rig.ts';

// Sights for every Survival gun, fitted to its model at load time. Stock guns get iron sights: a rear notch (two posts)
// over the receiver and a front post with a glowing fibre dot at the muzzle, tops level, so the post sits in the notch.
// Pack-a-Punched guns get a red-dot sight on top instead. Each kind comes with the aim-down-sights position that puts
// it exactly on the camera axis (the middle of the screen), so what you line up is what you hit.

/** Metres from the eye to the rear sight when aiming (gun space, before the viewmodel's scale). */
const EYE_RELIEF = 0.14;

export interface Sights {
  iron: THREE.Group;
  dot: THREE.Group;
  /** Where the gun sits when aiming through each (view space). */
  ironAds: THREE.Vector3;
  dotAds: THREE.Vector3;
}

/** The highest point of the model within a thin slice across the gun at `z` (gun space), so sights sit on top of it. */
function topAt(root: THREE.Object3D, z: number, half = 0.022): number {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let top = -Infinity;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    m.multiplyMatrices(toRoot, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (Math.abs(v.z - z) <= half && Math.abs(v.x) < 0.04) top = Math.max(top, v.y);
    }
  });
  return top;
}

export function buildSights(rig: GunRig): Sights {
  const { grip, muzzle } = rig.anchors;
  const rearZ = grip.z - 0.05;
  const frontZ = muzzle.z + 0.03;
  const rearTop = topAt(rig.root, rearZ);
  const frontTop = topAt(rig.root, frontZ);
  // The sight line has to clear the whole gun, or a tall receiver or stock behind the rear sight fills the view.
  let tallest = Math.max(rearTop, frontTop);
  for (let z = frontZ; z <= grip.z + 0.4; z += 0.02) tallest = Math.max(tallest, topAt(rig.root, z, 0.011));
  const steel = new THREE.MeshBasicMaterial({ color: 0x1b1d22 });

  // Iron sights: both tops on one line, a little above the taller of the two surfaces.
  const line = tallest + 0.01;
  const iron = new THREE.Group();
  const block = (w: number, y0: number, y1: number, x: number, z: number) => {
    const h = Math.max(0.002, y1 - y0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.007), steel);
    m.position.set(x, y0 + h / 2, z);
    iron.add(m);
  };
  const NOTCH = 0.0065; // how deep the rear notch is
  // Rear: two thin legs up from the receiver (you see between them), a bar, and two ears with the notch between.
  block(0.0035, rearTop - 0.002, line - NOTCH, -0.0105, rearZ);
  block(0.0035, rearTop - 0.002, line - NOTCH, 0.0105, rearZ);
  block(0.025, line - NOTCH - 0.003, line - NOTCH, 0, rearZ);
  block(0.0085, line - NOTCH, line, -0.0085, rearZ);
  block(0.0085, line - NOTCH, line, 0.0085, rearZ);
  // Front: a thin post all the way up from the barrel.
  block(0.0035, frontTop - 0.002, line, 0, frontZ);
  const fibre = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7dff6a }));
  fibre.position.set(0, line - 0.002, frontZ + 0.0036);
  iron.add(fibre);

  // Red dot: a little reflex sight over the receiver, its window centred on the dot.
  const dotY = tallest + 0.026;
  const dot = new THREE.Group();
  const frame = new THREE.MeshBasicMaterial({ color: 0x2a2d33 });
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame);
    m.position.set(x, y, z);
    dot.add(m);
  };
  const W = 0.034; // window size
  const zLens = rearZ - 0.03;
  bar(0.016, dotY - W / 2 - rearTop, 0.03, 0, (rearTop + dotY - W / 2) / 2, zLens); // mount
  bar(W + 0.008, 0.004, 0.012, 0, dotY + W / 2, zLens); // window frame: top, bottom, sides
  bar(W + 0.008, 0.004, 0.012, 0, dotY - W / 2, zLens);
  bar(0.004, W, 0.012, -W / 2, dotY, zLens);
  bar(0.004, W, 0.012, W / 2, dotY, zLens);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W, W),
    new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.position.set(0, dotY, zLens);
  const red = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 16), new THREE.MeshBasicMaterial({ color: 0xff2a2a, depthTest: false, transparent: true }));
  red.position.set(0, dotY, zLens + 0.001);
  red.renderOrder = 2;
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.0034, 16), new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.3, depthTest: false }));
  halo.position.copy(red.position);
  halo.renderOrder = 1;
  dot.add(glass, red, halo);

  rig.root.add(iron, dot);
  return {
    iron,
    dot,
    ironAds: new THREE.Vector3(0, -line + 0.0015, -EYE_RELIEF - rearZ),
    dotAds: new THREE.Vector3(0, -dotY, -EYE_RELIEF - 0.02 - zLens),
  };
}
