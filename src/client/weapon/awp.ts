import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonRamp } from '../textures.ts';
import type { GunRig } from './rig.ts';

/**
 * The AWP as a GunRig: bolt and magazine are pivots so the animation (guns.ts) drives them the same way
 * whether the rifle is our procedural one or a downloaded GLB with separate bolt/mag parts.
 */
export type WeaponModel = GunRig;

// Procedural layout (gun space). The GLB path fits downloaded models onto these same bounds.
const LENGTH_FRONT = -0.95; // muzzle tip
const LENGTH_BACK = 0.45; // butt pad
const BOLT_AXIS = new THREE.Vector3(0, 0.038, 0.03);
const MAG_WELL = new THREE.Vector3(0, 0, -0.12); // top of the magazine sits flush in the receiver's underside (y≈0.001)
const ANCHORS = {
  grip: new THREE.Vector3(0.03, -0.075, 0.085),
  fore: new THREE.Vector3(0, -0.05, -0.4),
  mag: MAG_WELL.clone(),
  muzzle: new THREE.Vector3(0, 0.035, LENGTH_FRONT),
  eject: new THREE.Vector3(0.03, 0.05, -0.04),
};

function mats(accent: number) {
  const gradientMap = toonRamp();
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap });
  return {
    // The classic AWP green, nudged toward the softer Ghibli palette.
    polymer: toon(0x5f7444),
    polymerDark: toon(0x4a5c35),
    metal: toon(0x2e3136),
    metalLight: toon(0x4b5058),
    rubber: toon(0x26272b),
    lens: new THREE.MeshBasicMaterial({ color: 0x9fd6e8 }),
    accent: toon(accent),
  };
}

const rbox = (w: number, h: number, d: number, r = 0.008) => new RoundedBoxGeometry(w, h, d, 2, r);
function cyl(r0: number, r1: number, len: number, seg = 16) {
  return new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2); // along Z
}

/** CS-style AWP: green thumbhole stock, black receiver, long barrel + brake, big scope, bolt with ball knob. */
export function buildProceduralAwp(accent: number): WeaponModel {
  const m = mats(accent);
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Receiver + barrel.
  add(rbox(0.048, 0.058, 0.3, 0.01), m.metal, 0, 0.03, -0.1);
  add(cyl(0.013, 0.012, 0.6), m.metal, 0, 0.036, -0.55);
  add(cyl(0.021, 0.021, 0.075, 8), m.metalLight, 0, 0.036, -0.9); // muzzle brake
  add(new THREE.BoxGeometry(0.044, 0.008, 0.02), m.metal, 0, 0.036, -0.9); // brake slot fins
  // Forend / handguard (green) with a cloth wrap in the player's colour.
  add(rbox(0.066, 0.068, 0.36, 0.014), m.polymer, 0, 0.002, -0.38);
  add(rbox(0.07, 0.072, 0.045, 0.012), m.accent, 0, 0.002, -0.47);
  // Stock: lower spine, front post and cheek rest leave the AWP's thumbhole.
  add(rbox(0.06, 0.05, 0.47, 0.014), m.polymer, 0, -0.06, 0.2);
  add(rbox(0.058, 0.11, 0.04, 0.012), m.polymer, 0, -0.01, 0.12);
  add(rbox(0.058, 0.05, 0.26, 0.016), m.polymer, 0, 0.045, 0.3);
  add(rbox(0.062, 0.16, 0.035, 0.01), m.rubber, 0, -0.02, 0.44); // butt pad
  const grip = add(rbox(0.04, 0.11, 0.045, 0.012), m.polymerDark, 0, -0.09, 0.075);
  grip.rotation.x = 0.35;
  const guard = add(new THREE.TorusGeometry(0.025, 0.004, 6, 16, Math.PI), m.metal, 0, -0.03, 0.0);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  add(new THREE.BoxGeometry(0.006, 0.02, 0.006), m.metal, 0, -0.03, 0.0); // trigger

  // Scope: rings, tube, objective bell, eyepiece, turrets.
  for (const z of [-0.17, -0.02]) add(rbox(0.03, 0.05, 0.022, 0.006), m.metal, 0, 0.075, z);
  add(cyl(0.021, 0.021, 0.26), m.metal, 0, 0.108, -0.1);
  add(cyl(0.034, 0.022, 0.085), m.metal, 0, 0.108, -0.27);
  add(cyl(0.028, 0.022, 0.06), m.metal, 0, 0.108, 0.06);
  add(new THREE.CircleGeometry(0.03, 16).rotateY(Math.PI), m.lens, 0, 0.108, -0.3135);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), m.metalLight, 0, 0.138, -0.1);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12).rotateZ(Math.PI / 2), m.metalLight, 0.034, 0.108, -0.1);

  // Bolt (animated): body, arm angled down-right, ball knob.
  const boltPivot = new THREE.Group();
  boltPivot.position.copy(BOLT_AXIS);
  root.add(boltPivot);
  add(cyl(0.011, 0.011, 0.07), m.metalLight, 0, 0, 0.045, boltPivot);
  const arm = add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.05, 8), m.metalLight, 0.028, -0.01, 0.06, boltPivot);
  arm.rotation.z = Math.PI / 2 + 0.35;
  const knob = add(new THREE.SphereGeometry(0.014, 12, 10), m.metal, 0.052, -0.02, 0.06, boltPivot);

  // Magwell housing (fixed) so the magazine visibly seats into the receiver instead of hanging below it.
  add(rbox(0.052, 0.022, 0.09, 0.006), m.metal, 0, -0.008, MAG_WELL.z);

  // Magazine (animated on reload).
  const magPivot = new THREE.Group();
  magPivot.position.copy(MAG_WELL);
  root.add(magPivot);
  add(rbox(0.04, 0.085, 0.07, 0.006), m.metal, 0, -0.04, 0, magPivot);
  add(rbox(0.044, 0.01, 0.074, 0.003), m.metalLight, 0, -0.085, 0, magPivot);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return { root, parts: { bolt: boltPivot, knob, mag: magPivot }, anchors: cloneAnchors() };
}

const cloneAnchors = () => ({
  grip: ANCHORS.grip.clone(),
  fore: ANCHORS.fore.clone(),
  mag: ANCHORS.mag.clone(),
  muzzle: ANCHORS.muzzle.clone(),
  eject: ANCHORS.eject.clone(),
});

// ---------------------------------------------------------------------------
// Optional GLB: drop a rifle at public/models/awp.glb and it replaces the procedural one.

const AWP_GLB_URL = '/models/awp.glb';
const AWP_GLB_CREDIT = 'AWP Sniper Rifle by BlenderGuy (sketchfab.com/blender_guy_), CC BY 4.0';

/** Loads and fits the GLB, or returns null if there isn't one (dev/prod servers fall back to index.html). */
export async function loadAwpGlb(): Promise<WeaponModel | null> {
  let buf: ArrayBuffer;
  try {
    const res = await fetch(AWP_GLB_URL);
    if (!res.ok) return null;
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }
  if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null;

  const gltf = await new GLTFLoader().parseAsync(buf, '/models/');
  const model = gltf.scene;
  const root = new THREE.Group();
  const fit = new THREE.Group();
  fit.add(model);
  root.add(fit);
  orientAndFit(fit, model);

  // Restyle to the toon look so it sits in the Ghibli world, keeping each part's base colour/texture.
  const gradientMap = toonRamp();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshToonMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, gradientMap });
    mesh.castShadow = false;
  });

  root.updateMatrixWorld(true);
  const boltPivot = new THREE.Group();
  boltPivot.position.copy(BOLT_AXIS);
  root.add(boltPivot);
  const magPivot = new THREE.Group();
  magPivot.position.copy(MAG_WELL);
  root.add(magPivot);

  // Find movable parts by name and re-parent them into our pivots (attach() keeps their world pose).
  const byName = (re: RegExp) => {
    let hit: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (!hit && re.test(o.name) && o !== model) hit = o;
    });
    return hit as THREE.Object3D | null;
  };
  const boltNode = byName(/bolt|reloader|charging|handle/i);
  const magNode = byName(/mag/i);
  const boltKnob = new THREE.Object3D();
  boltPivot.add(boltKnob);
  if (boltNode) {
    boltPivot.attach(boltNode);
    const box = new THREE.Box3().setFromObject(boltNode);
    boltKnob.position.copy(boltPivot.worldToLocal(new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)));
  } else {
    boltKnob.position.set(0.052, -0.02, 0.06);
  }
  if (magNode) magPivot.attach(magNode);

  console.info(`[awp] loaded GLB${boltNode ? `, bolt="${boltNode.name}"` : ', no bolt part found'}${magNode ? `, mag="${magNode.name}"` : ', no mag part found'}`);
  return { root, parts: { bolt: boltPivot, knob: boltKnob, mag: magPivot }, anchors: cloneAnchors(), credit: AWP_GLB_CREDIT };
}

/** Rotate so the longest axis runs along Z with the thin (barrel) end at -Z, then scale/translate onto our bounds. */
function orientAndFit(fit: THREE.Group, model: THREE.Object3D) {
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (size.x >= size.y && size.x >= size.z) fit.rotation.y = Math.PI / 2;
  else if (size.y > size.z) fit.rotation.x = Math.PI / 2;
  fit.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(fit);
  // The barrel end is the skinny one: compare vertical spread of vertices in each end's 15% slice.
  const spread = (lo: number, hi: number) => {
    let min = Infinity;
    let max = -Infinity;
    const v = new THREE.Vector3();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 3000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.z >= lo && v.z <= hi) {
          min = Math.min(min, v.y);
          max = Math.max(max, v.y);
        }
      }
    });
    return max - min;
  };
  const len = box.max.z - box.min.z;
  if (spread(box.max.z - len * 0.15, box.max.z) < spread(box.min.z, box.min.z + len * 0.15)) {
    fit.rotation.y += Math.PI; // barrel was at +Z
    fit.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(fit);
  }
  const s = (LENGTH_BACK - LENGTH_FRONT) / (box.max.z - box.min.z);
  fit.scale.setScalar(s);
  fit.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(fit);
  fit.position.set(-(box.min.x + box.max.x) / 2, 0.02 - (box.min.y + box.max.y) / 2, LENGTH_FRONT - box.min.z);
  fit.updateMatrixWorld(true);
}
