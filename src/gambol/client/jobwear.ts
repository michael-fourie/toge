import * as THREE from 'three';
import type { JobId } from '../shared/zombie.ts';
import type { Avatar } from './avatar.ts';
import { toonRamp } from './textures.ts';

// Work clothes for zombies with jobs (gambol/shared/zombie.ts JOBS): each reads at a glance, even in the dark.
// Welder: a welding mask with a dark visor and a leather apron. Courier: a red cap and a satchel. Stoker: soot, a knit cap
// and embers glowing through the coat (it bursts when it dies).

/** The coat each job wears (the avatar's jacket colour). */
export const JOB_COAT: Record<JobId, number> = { welder: 0x6b5238, courier: 0x3f6fb5, stoker: 0x2e2826 };

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** Dress a zombie avatar for its job. */
export function dressJob(a: Avatar, job: JobId) {
  const head = new THREE.Group();
  const body = new THREE.Group();
  if (job === 'welder') {
    const mask = toon(0x4a4e55);
    add(head, new THREE.BoxGeometry(0.44, 0.4, 0.08), mask, 0, -0.02, -0.25); // the shield over the face
    add(head, new THREE.BoxGeometry(0.3, 0.09, 0.02), glow(0x1c2a1e), 0, 0.04, -0.3); // dark visor
    add(head, new THREE.BoxGeometry(0.28, 0.025, 0.02), glow(0x7dff8a), 0, 0.04, -0.312).scale.set(1, 0.4, 1); // a green glint
    add(head, new THREE.TorusGeometry(0.255, 0.03, 6, 20, Math.PI), mask, 0, 0.02, 0, 0, Math.PI / 2, 0); // headband
    const leather = toon(0x8a5a32);
    add(body, new THREE.BoxGeometry(0.36, 0.5, 0.04), leather, 0, 0.18, -0.17); // apron
    add(body, new THREE.BoxGeometry(0.42, 0.04, 0.32), leather, 0, 0.1, 0); // apron string
  } else if (job === 'courier') {
    const red = toon(0xd23c33);
    add(head, new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 0.05, 0); // cap crown
    add(head, new THREE.CylinderGeometry(0.2, 0.2, 0.025, 16, 1, false, 0, Math.PI), red, 0, 0.06, -0.15, 0, Math.PI / 2, 0); // brim
    add(head, new THREE.SphereGeometry(0.035, 8, 6), toon(0xffffff), 0, 0.32, 0); // button
    const bag = toon(0xc9a36a);
    add(body, new THREE.BoxGeometry(0.1, 0.24, 0.3), bag, 0.25, 0.02, 0.02); // satchel on the hip
    add(body, new THREE.BoxGeometry(0.03, 0.75, 0.04), toon(0x7a5a32), 0, 0.3, -0.16, 0, 0, 0.75); // strap across the chest
    add(body, new THREE.BoxGeometry(0.03, 0.75, 0.04), toon(0x7a5a32), 0, 0.3, 0.16, 0, 0, 0.75);
  } else {
    add(head, new THREE.SphereGeometry(0.275, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), toon(0x3a3433), 0, 0.03, 0); // knit cap
    add(head, new THREE.TorusGeometry(0.255, 0.04, 6, 20), toon(0x5a4f4c), 0, 0.06, 0, Math.PI / 2, 0, 0);
    const ember = glow(0xff7a2a);
    const hot = glow(0xffc04a);
    for (const [x, y, s] of [[-0.08, 0.32, 0.05], [0.07, 0.2, 0.045], [-0.02, 0.08, 0.04], [0.1, 0.38, 0.03]]) {
      add(body, new THREE.SphereGeometry(s, 8, 6), ember, x, y, -0.16);
      add(body, new THREE.SphereGeometry(s * 0.5, 6, 4), hot, x, y, -0.18);
    }
    add(head, new THREE.SphereGeometry(0.035, 6, 4), hot, -0.08, 0, -0.245); // glowing eyes under the soot
    add(head, new THREE.SphereGeometry(0.035, 6, 4), hot, 0.08, 0, -0.245);
  }
  a.wear(head, 'head');
  a.wear(body, 'upper');
}
