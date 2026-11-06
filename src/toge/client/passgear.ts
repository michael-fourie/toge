// Battle pass gear for your own driver (look.ts `GEAR`): small pieces made in code and parented to the head bone,
// so they fit every body and follow the head through every clip (driving, riding, standing). Measured off the
// assembled figure in its bind pose: the eyes ('low-poly') and the top of the body give the head's size.
//
// The glowing parts take the look's glow colour, brighter than white so the bloom catches them (a flat
// MeshBasicMaterial costs nothing on Low graphics either).

import * as THREE from 'three';
import type { GearId, Look } from '../shared/look.ts';

/** Geometry is shared by every rig (never disposed, like the wardrobe's); materials are the look's own. */
const geo = new Map<string, THREE.BufferGeometry>();
const shared = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geo.get(key);
  if (!g) geo.set(key, (g = make()));
  return g;
};

/** How far into overbright the glow goes (bloom threshold in the race and showroom is well above 1). */
const GLOW = 3.2;

/**
 * Adds the look's gear to an assembled driver (`scene` in its bind pose, file facing +Z). Returns the materials it
 * made, for the rig to free.
 */
export function addGear(scene: THREE.Object3D, look: Look): THREE.Material[] {
  if (!look.gear.length) return [];
  scene.updateMatrixWorld(true);
  let head: THREE.Bone | null = null;
  let body: THREE.SkinnedMesh | null = null;
  let eyes: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone && o.name === 'head') head = o as THREE.Bone;
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && m.name === 'body') body = m;
    if (m.isSkinnedMesh && /^low-poly/.test(m.name)) eyes = m;
  });
  if (!head || !body || !eyes) return [];
  const box = (m: THREE.SkinnedMesh) => (m.computeBoundingBox(), m.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  const eyeBox = box(eyes);
  const eye = eyeBox.getCenter(new THREE.Vector3());
  const top = box(body).max.y;
  // Half the head's width, from the eyes' spread (they sit about two thirds of the way out).
  const half = Math.max(0.06, (eyeBox.max.x - eyeBox.min.x) * 0.85);
  // The skull's centre: a little behind the eyes, halfway between them and the crown.
  const c = new THREE.Vector3(eye.x, (eye.y + top) / 2, eye.z - half * 0.45);
  const h = top - eye.y;

  const own: THREE.Material[] = [];
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(GLOW), toneMapped: true });
  glow.userData.glow = true;
  own.push(glow);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, at: THREE.Vector3, rot = new THREE.Euler()) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'gear';
    mesh.position.copy(at);
    mesh.rotation.copy(rot);
    mesh.castShadow = true;
    if (m === glow) mesh.castShadow = false;
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    head!.attach(mesh); // keeps where it is now, and moves with the head from here on
    return mesh;
  };
  const pieces: Record<GearId, () => void> = {
    halo: () => {
      const g = shared('halo', () => new THREE.TorusGeometry(1, 0.075, 8, 48).rotateX(Math.PI / 2));
      const m = add(g, glow, new THREE.Vector3(c.x, top + h * 0.35, c.z - half * 0.1), new THREE.Euler(-0.18, 0, 0));
      m.scale.setScalar(half * 1.15);
    },
    horns: () => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a0c0c, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color(look.glow), emissiveIntensity: 0.25 });
      own.push(mat);
      // A curved horn: a cone bent back along its length.
      const g = shared('horn', () => {
        const cone = new THREE.ConeGeometry(0.22, 1, 10, 6, true).translate(0, 0.5, 0);
        const p = cone.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          p.setZ(i, p.getZ(i) - y * y * 0.35);
        }
        cone.computeVertexNormals();
        return cone;
      });
      for (const s of [-1, 1]) {
        const m = add(g, mat, new THREE.Vector3(c.x + s * half * 0.55, top - h * 0.12, c.z + half * 0.25), new THREE.Euler(-0.25, 0, -s * 0.38));
        m.scale.setScalar(h * 1.35);
      }
    },
    ears: () => {
      const fur = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.8 });
      own.push(fur);
      // A fox ear: a three-sided cone, flattened front to back, with a glowing lining.
      const g = shared('ear', () => new THREE.ConeGeometry(0.42, 1, 3, 1).rotateY(Math.PI / 6).scale(1, 1, 0.45).translate(0, 0.5, 0));
      const inner = shared('earIn', () => new THREE.ConeGeometry(0.26, 0.72, 3, 1).rotateY(Math.PI / 6).scale(1, 1, 0.2).translate(0, 0.4, 0.08));
      for (const s of [-1, 1]) {
        const at = new THREE.Vector3(c.x + s * half * 0.62, top - h * 0.18, c.z);
        const rot = new THREE.Euler(-0.12, 0, -s * 0.32);
        add(g, fur, at, rot).scale.setScalar(h * 1.15);
        add(inner, glow, at, rot).scale.setScalar(h * 1.15);
      }
    },
    visor: () => {
      const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(1.6), transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
      lens.userData.glow = true;
      own.push(lens);
      // A band round the front of the face at eye level, open at the back.
      const g = shared('visor', () => new THREE.CylinderGeometry(1, 1, 0.3, 32, 1, true, -Math.PI * 0.42, Math.PI * 0.84));
      const m = add(g, lens, new THREE.Vector3(c.x, eye.y, c.z), new THREE.Euler());
      m.scale.set(half * 1.12, half * 1.0, half * 1.12);
    },
  };
  for (const x of look.gear) pieces[x]();
  return own;
}
