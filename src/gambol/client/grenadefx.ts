import * as THREE from 'three';
import { GRENADE } from '../shared/constants.ts';
import type { Vec3 } from '../../shared/math.ts';

const bodyGeo = new THREE.SphereGeometry(0.09, 12, 10);
const capGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8);
const leverGeo = new THREE.BoxGeometry(0.018, 0.012, 0.09);
const body = new THREE.MeshBasicMaterial({ color: 0x4f6a3a });
const brass = new THREE.MeshBasicMaterial({ color: 0xd9a84e });

const puffGeo = new THREE.SphereGeometry(1, 10, 8);

interface Blast {
  flash: THREE.Mesh;
  fire: THREE.Mesh;
  ring: THREE.Mesh;
  puffs: { mesh: THREE.Mesh; vel: THREE.Vector3 }[];
  t: number;
}

const BLAST_SECONDS = 0.7;

/** Grenade bodies and explosions: cheap procedural meshes, no assets. */
export class GrenadeFx {
  private blasts: Blast[] = [];

  constructor(private scene: THREE.Scene) {}

  /** A little olive pineapple with a brass cap and lever. */
  makeGrenade(): THREE.Group {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(capGeo, brass);
    cap.position.y = 0.1;
    const lever = new THREE.Mesh(leverGeo, brass);
    lever.position.set(0.03, 0.115, 0);
    g.add(new THREE.Mesh(bodyGeo, body), cap, lever);
    this.scene.add(g);
    return g;
  }

  /** Blinks faster as the fuse runs down. */
  tick(g: THREE.Group, age: number) {
    const left = Math.max(0, GRENADE.fuse - age);
    const rate = 6 + (1 - left / GRENADE.fuse) * 22;
    (g.children[0] as THREE.Mesh).material = Math.sin(age * rate) > 0.2 ? brass : body;
  }

  explode(p: Vec3) {
    const mat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Mesh(puffGeo, mat(0xfff4c4, 1));
    const fire = new THREE.Mesh(puffGeo, mat(0xff9a3a, 0.8));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 28).rotateX(Math.PI / 2), mat(0xffe1a0, 0.8));
    const puffs: Blast['puffs'] = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0x8a8378, transparent: true, opacity: 0.55, depthWrite: false }));
      const a = (i / 9) * Math.PI * 2 + Math.random();
      puffs.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 3), 1 + Math.random() * 3, Math.sin(a) * (2 + Math.random() * 3)) });
    }
    for (const m of [flash, fire, ring, ...puffs.map((x) => x.mesh)]) {
      m.position.set(p.x, p.y, p.z);
      this.scene.add(m);
    }
    this.blasts.push({ flash, fire, ring, puffs, t: 0 });
  }

  update(dt: number) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      const k = Math.min(1, b.t / BLAST_SECONDS);
      b.flash.scale.setScalar(0.3 + k * 1.6);
      (b.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k * 3);
      b.fire.scale.setScalar(0.5 + Math.sqrt(k) * GRENADE.radius * 0.85);
      (b.fire.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k) ** 2;
      b.ring.scale.setScalar(0.5 + Math.sqrt(k) * GRENADE.radius * 1.3);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      for (const p of b.puffs) {
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(1 - dt * 2.5);
        p.mesh.scale.setScalar(0.4 + k * 1.6);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
      }
      if (b.t >= BLAST_SECONDS) {
        for (const m of [b.flash, b.fire, b.ring, ...b.puffs.map((x) => x.mesh)]) {
          m.removeFromParent();
          (m.material as THREE.Material).dispose();
        }
        b.ring.geometry.dispose();
        this.blasts.splice(i, 1);
      }
    }
  }
}
