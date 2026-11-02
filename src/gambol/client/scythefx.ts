import * as THREE from 'three';
import { JOBS, SCYTHE } from '../shared/constants.ts';

// Survival effects that are just for show: the Gale Scythe's sweep (a ring of wind out to its reach, with leaves riding
// it) and a Stoker's ember burst. Each one fades by itself.

interface Fx {
  objs: THREE.Object3D[];
  t: number;
  life: number;
  step(k: number, dt: number): void;
}

const add = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

export class ScytheFx {
  private fx: Fx[] = [];
  private leafGeo = new THREE.PlaneGeometry(0.16, 0.08);
  private emberGeo = new THREE.SphereGeometry(0.07, 6, 4);

  constructor(private scene: THREE.Scene) {}

  /** A sweep from `p` (feet), swinging round from where we look. */
  swing(p: THREE.Vector3, yaw: number) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), add(0x8ff5e0, 0.7));
    ring.position.set(p.x, p.y + 1, p.z);
    const leaves = Array.from({ length: 14 }, (_, i) => {
      const m = new THREE.Mesh(this.leafGeo, add(i % 2 ? 0xbff7a0 : 0x8ff5e0, 0.9));
      m.userData.a = yaw + (i / 14) * Math.PI * 2;
      m.userData.h = 0.5 + Math.random();
      return m;
    });
    const objs = [ring, ...leaves];
    for (const o of objs) this.scene.add(o);
    this.fx.push({
      objs,
      t: 0,
      life: 0.45,
      step: (k) => {
        ring.scale.setScalar(0.3 + k * SCYTHE.range);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
        for (const m of leaves) {
          const a = m.userData.a + k * 4; // the leaves swirl round as they fly out
          const r = 0.5 + k * SCYTHE.range;
          m.position.set(p.x + Math.sin(a) * r, p.y + m.userData.h + k * 0.5, p.z + Math.cos(a) * r);
          m.rotation.set(k * 9, a, k * 5);
          (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        }
      },
    });
  }

  /** A Stoker bursting into embers at `p`. */
  embers(p: THREE.Vector3) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), add(0xff8a3a, 0.7));
    flash.position.set(p.x, p.y + 1, p.z);
    const sparks = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(this.emberGeo, add(Math.random() < 0.5 ? 0xffc04a : 0xff5a1a, 1));
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 5;
      m.userData.v = new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s);
      m.position.copy(flash.position);
      return m;
    });
    const objs = [flash, ...sparks];
    for (const o of objs) this.scene.add(o);
    this.fx.push({
      objs,
      t: 0,
      life: 0.9,
      step: (k, dt) => {
        flash.scale.setScalar(0.4 + Math.sqrt(k) * JOBS.stoker.burst);
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.max(0, 1 - k * 2.5);
        for (const m of sparks) {
          const v = m.userData.v as THREE.Vector3;
          v.y -= 14 * dt;
          m.position.addScaledVector(v, dt);
          (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        }
      },
    });
  }

  update(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.step(k, dt);
      if (k < 1) continue;
      for (const o of f.objs) {
        o.removeFromParent();
        if (o instanceof THREE.Mesh) {
          if (o.geometry !== this.leafGeo && o.geometry !== this.emberGeo) o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      }
      this.fx.splice(i, 1);
    }
  }
}
