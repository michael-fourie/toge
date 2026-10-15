import * as THREE from 'three';
import type { Vec3 } from '../shared/math.ts';
import { softDot } from './textures.ts';
import { pbr } from './render/surface.ts';

export const MINT = 0x8ff5d0;
export const GOLD = 0xffd98a;

/**
 * The Pack-a-Punch machine: a brass magic kettle on a mossy stone plinth, with a floating mint crystal
 * and two orbiting rings. Procedural, cel-shaded; only the crystal, rings and halo glow (and pulse).
 */
export function buildPunchMachine(pos: Vec3): { obj: THREE.Group; update(time: number): void } {
  const g = new THREE.Group();
  g.position.set(pos.x, pos.y, pos.z);
  const solid = (color: number) => pbr({ color });
  const stone = solid(0xbfb59f);
  const brass = solid(0xd9a441);
  const brassDark = solid(0xa87a2c);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  add(new THREE.CylinderGeometry(0.95, 1.1, 0.35, 10), stone, 0, 0.175, 0);
  add(new THREE.CylinderGeometry(0.62, 0.74, 0.25, 10), solid(0xa89f8a), 0, 0.475, 0);
  const body = add(new THREE.SphereGeometry(0.58, 18, 14), brass, 0, 1.15, 0);
  body.scale.y = 0.85;
  add(new THREE.TorusGeometry(0.5, 0.05, 6, 20), brassDark, 0, 1.0, 0).rotation.x = Math.PI / 2; // belly band
  add(new THREE.CylinderGeometry(0.3, 0.42, 0.14, 14), brassDark, 0, 1.6, 0); // lid
  const knob = add(new THREE.SphereGeometry(0.1, 10, 8), solid(MINT), 0, 1.74, 0);
  const spout = add(new THREE.CylinderGeometry(0.07, 0.15, 0.55, 8), brass, 0.6, 1.3, 0);
  spout.rotation.z = -Math.PI / 3;
  const handle = add(new THREE.TorusGeometry(0.3, 0.05, 6, 14, Math.PI), brassDark, -0.55, 1.2, 0);
  handle.rotation.z = Math.PI / 2;

  const glow = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.9, depthWrite: false });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), glow);
  g.add(crystal);
  const rings = [0, 1].map((i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.46 + i * 0.12, 0.018, 6, 36), new THREE.MeshBasicMaterial({ color: i ? GOLD : MINT, transparent: true, opacity: 0.75, depthWrite: false }));
    g.add(r);
    return r;
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: MINT, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.scale.setScalar(3.4);
  g.add(halo);

  return {
    obj: g,
    update(time) {
      const bob = Math.sin(time * 1.8) * 0.09;
      const y = 2.45 + bob;
      crystal.position.y = y;
      crystal.rotation.set(time * 0.9, time * 1.7, 0);
      rings[0].position.y = rings[1].position.y = y;
      rings[0].rotation.set(time * 1.3, time * 0.7, 0);
      rings[1].rotation.set(Math.PI / 2 - time * 0.9, time * 1.1, 0);
      halo.position.y = y;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
      halo.material.opacity = 0.35 + 0.3 * pulse;
      glow.opacity = 0.75 + 0.25 * pulse;
      knob.scale.setScalar(1 + 0.15 * pulse);
    },
  };
}
