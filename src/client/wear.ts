import * as THREE from 'three';
import type { Wear } from '../shared/items.ts';
import { pbr } from './render/surface.ts';

// Wearable models, built from primitives. Hats and faces are in head space (origin at the head's centre,
// radius 0.25, the face looks down -Z); backs are in upper-body space (origin at the hips, the back is +Z).
// Wings carry userData.wing = ±1 so the avatar can flap them.

const sphere = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz);

export function buildWear(w: Wear): THREE.Group {
  const glowing = (color: number) => pbr({ color, emissive: w.glow ? color : 0, emissiveIntensity: w.glow ? 0.5 : 0 });
  const main = glowing(w.color);
  const trim = pbr({ color: w.color2, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const flat = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 24).rotateX(Math.PI / 2);

  switch (w.model) {
    case 'straw':
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24), main, 0, 0.19);
      add(sphere(0.23, 1, 0.8, 1), main, 0, 0.2);
      add(flat(0.225, 0.025), trim, 0, 0.22);
      break;
    case 'beanie':
      add(sphere(0.27, 1, 0.9, 1), main, 0, 0.04);
      add(flat(0.255, 0.04), trim, 0, 0.12);
      add(sphere(0.06), trim, 0, 0.3);
      break;
    case 'witch': {
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24), main, 0, 0.19);
      const cone = add(new THREE.ConeGeometry(0.2, 0.5, 14), main, 0, 0.45);
      cone.rotation.z = -0.15;
      add(new THREE.CylinderGeometry(0.205, 0.215, 0.07, 14), trim, 0, 0.25);
      break;
    }
    case 'sprout': {
      add(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 6), main, 0, 0.3);
      for (const s of [-1, 1]) {
        const leaf = add(sphere(0.1, 1.5, 0.35, 0.8), main, s * 0.1, 0.38);
        leaf.rotation.z = s * 0.45;
      }
      break;
    }
    case 'crown': {
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 16, 1, true), main, 0, 0.27).material = pbr({ color: w.color, side: THREE.DoubleSide });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.04, 0.12, 6), main, Math.sin(a) * 0.21, 0.37, Math.cos(a) * 0.21);
        add(sphere(0.025), trim, Math.sin(a) * 0.21, 0.44, Math.cos(a) * 0.21);
      }
      break;
    }
    case 'halo':
      add(new THREE.TorusGeometry(0.2, 0.025, 8, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: w.color }), 0, 0.5);
      break;
    case 'shades':
      for (const s of [-1, 1]) {
        add(sphere(0.075, 1.2, 0.8, 0.3), main, s * 0.1, 0.01, -0.235);
        add(new THREE.BoxGeometry(0.02, 0.012, 0.2), main, s * 0.19, 0.02, -0.14); // arms
      }
      add(new THREE.BoxGeometry(0.06, 0.014, 0.014), main, 0, 0.025, -0.245);
      break;
    case 'goggles': {
      const strap = add(new THREE.TorusGeometry(0.255, 0.022, 6, 28).rotateX(Math.PI / 2), trim, 0, 0.06);
      strap.scale.set(1, 1, 1);
      const lens = pbr({ color: w.color2, emissive: w.glow ? w.color2 : 0, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
      for (const s of [-1, 1]) {
        add(new THREE.TorusGeometry(0.075, 0.016, 8, 18), main, s * 0.11, 0.03, -0.245);
        add(new THREE.CircleGeometry(0.07, 16), lens, s * 0.11, 0.03, -0.248).rotation.y = Math.PI;
      }
      break;
    }
    case 'monocle':
      add(new THREE.TorusGeometry(0.07, 0.01, 6, 18), main, 0.1, 0.01, -0.25);
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), main, 0.17, -0.15, -0.23);
      break;
    case 'mask': {
      // A fox mask: a white plate over the face, pointy ears, red cheek stripes.
      const plate = new THREE.Mesh(new THREE.SphereGeometry(0.268, 24, 16, Math.PI * 1.5 - 0.85, 1.7, 0.95, 1.6), pbr({ color: w.color, side: THREE.DoubleSide }));
      root.add(plate);
      for (const s of [-1, 1]) {
        add(new THREE.ConeGeometry(0.07, 0.18, 4), main, s * 0.14, 0.27, -0.12).rotation.z = -s * 0.3;
        for (const k of [0, 1]) add(new THREE.BoxGeometry(0.1, 0.016, 0.01), trim, s * 0.13, -0.04 - k * 0.04, -0.255).rotation.z = s * -0.25;
        add(new THREE.BoxGeometry(0.05, 0.1, 0.01), trim, s * 0.07, 0.1, -0.262);
      }
      add(sphere(0.03), trim, 0, -0.03, -0.27); // nose
      break;
    }
    case 'backpack':
      add(new THREE.BoxGeometry(0.28, 0.34, 0.14), main, 0, 0.3, 0.22);
      add(new THREE.BoxGeometry(0.29, 0.12, 0.15), trim, 0, 0.4, 0.22);
      add(new THREE.BoxGeometry(0.16, 0.12, 0.05), trim, 0, 0.22, 0.31);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.3, 0.03), trim, s * 0.1, 0.3, 0.145);
      break;
    case 'cape': {
      const cape = add(new THREE.BoxGeometry(0.4, 0.62, 0.02), main, 0, 0.2, 0.2);
      cape.rotation.x = 0.1;
      add(new THREE.BoxGeometry(0.4, 0.05, 0.026), trim, 0, -0.1, 0.225).rotation.x = 0.1;
      add(new THREE.TorusGeometry(0.15, 0.025, 6, 16), trim, 0, 0.5, 0.05).rotation.x = Math.PI / 2; // collar
      break;
    }
    case 'wings':
      for (const s of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(s * 0.07, 0.4, 0.2);
        wing.userData.wing = s;
        root.add(wing);
        for (let i = 0; i < 4; i++) {
          const f = new THREE.Group();
          f.rotation.z = s * (0.35 + i * 0.28);
          f.rotation.y = s * 0.35;
          add(sphere(0.055, 1, 3.2 - i * 0.3, 0.3), i % 2 ? trim : main, s * 0.04, 0.2 - i * 0.02, 0, f);
          wing.add(f);
        }
      }
      break;
  }
  return root;
}
