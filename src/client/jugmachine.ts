import * as THREE from 'three';
import type { Vec3 } from '../shared/math.ts';
import { softDot, toonRamp } from './textures.ts';

export const CRIMSON = 0xff6a4a;

/**
 * The Juggernog station: a crimson cask with brass bands and a little tap on a stone plinth, with a glowing red
 * apple floating over it (a mirror of the Pack-a-Punch kettle's mint crystal, in warm colours so they read apart from afar).
 */
export function buildJugMachine(pos: Vec3): { obj: THREE.Group; update(time: number): void } {
  const g = new THREE.Group();
  g.position.set(pos.x, pos.y, pos.z);
  const gradientMap = toonRamp();
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap });
  const stone = toon(0xbfb59f);
  const wood = toon(0xb8452f);
  const woodLight = toon(0xd9694b);
  const brass = toon(0xd9a441);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  add(new THREE.CylinderGeometry(0.95, 1.1, 0.35, 10), stone, 0, 0.175, 0);
  // The cask: a barrel profile (wider in the middle) built as a lathe.
  const profile = [0.5, 0.62, 0.7, 0.73, 0.7, 0.62, 0.5].map((r, i) => new THREE.Vector2(r, i * 0.22));
  const cask = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), wood);
  cask.position.y = 0.35;
  cask.castShadow = cask.receiveShadow = true;
  g.add(cask);
  for (const y of [0.55, 1.0, 1.45]) {
    const band = add(new THREE.TorusGeometry(0.6 + 0.12 * Math.sin(((y - 0.35) / 1.32) * Math.PI), 0.04, 6, 24), brass, 0, y, 0);
    band.rotation.x = Math.PI / 2;
  }
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16), woodLight, 0, 1.69, 0); // lid
  const tap = add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), brass, 0.68, 0.85, 0);
  tap.rotation.z = Math.PI / 2;
  add(new THREE.SphereGeometry(0.07, 8, 6), brass, 0.85, 0.85, 0);

  // Floating apple with a leaf, a soft crimson halo and two slow rings.
  const glow = new THREE.MeshBasicMaterial({ color: CRIMSON, transparent: true, opacity: 0.95, depthWrite: false });
  const apple = new THREE.Group();
  apple.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), glow));
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7fd36a }));
  leaf.scale.set(1.6, 0.35, 0.8);
  leaf.position.set(0.1, 0.3, 0);
  leaf.rotation.z = 0.5;
  apple.add(leaf);
  g.add(apple);
  const rings = [0, 1].map((i) => {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.5 + i * 0.12, 0.018, 6, 36),
      new THREE.MeshBasicMaterial({ color: i ? 0xffd98a : CRIMSON, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    g.add(r);
    return r;
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: CRIMSON, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.scale.setScalar(3.2);
  g.add(halo);

  return {
    obj: g,
    update(time) {
      const y = 2.5 + Math.sin(time * 1.6 + 1) * 0.09;
      apple.position.y = y;
      apple.rotation.y = time * 1.4;
      rings[0].position.y = rings[1].position.y = y;
      rings[0].rotation.set(time * 1.1, time * 0.6, 0);
      rings[1].rotation.set(Math.PI / 2 - time * 0.8, time * 1.0, 0);
      halo.position.y = y;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.7);
      halo.material.opacity = 0.32 + 0.3 * pulse;
      glow.opacity = 0.8 + 0.2 * pulse;
    },
  };
}
