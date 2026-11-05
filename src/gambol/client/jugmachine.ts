import * as THREE from 'three';
import type { Vec3 } from '../../shared/math.ts';
import { softDot, toonRamp } from './textures.ts';

export const CRIMSON = 0xff6a4a;

type Emblem = 'apple' | 'cross' | 'bolt' | 'wings';

/**
 * The Juggernog station: a crimson cask with brass bands and a little tap on a stone plinth, with a glowing red
 * apple floating over it (a mirror of the Pack-a-Punch kettle's mint crystal, in warm colours so they read apart from afar).
 */
export const buildJugMachine = (pos: Vec3) => buildPerkMachine(pos, CRIMSON, 0xb8452f, 0xd9694b, 'apple');

/**
 * A perk station: the same cask on a plinth, in the perk's colours, with its emblem floating over it
 * (Juggernog's apple, Swift Mend's cross, Zephyr Fizz's lightning bolt, Second Wind's wings).
 */
export function buildPerkMachine(pos: Vec3, glowColor: number, caskColor: number, lidColor: number, emblem: Emblem): { obj: THREE.Group; update(time: number): void } {
  const g = new THREE.Group();
  g.position.set(pos.x, pos.y, pos.z);
  const gradientMap = toonRamp();
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap });
  const stone = toon(0xbfb59f);
  const wood = toon(caskColor);
  const woodLight = toon(lidColor);
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

  // The floating emblem, a soft halo and two slow rings.
  const glow = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.95, depthWrite: false });
  const apple = new THREE.Group();
  const part = (geo: THREE.BufferGeometry, x = 0, y = 0, rz = 0, mat: THREE.Material = glow) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.rotation.z = rz;
    apple.add(m);
    return m;
  };
  if (emblem === 'apple') {
    part(new THREE.SphereGeometry(0.28, 14, 10));
    const leaf = part(new THREE.SphereGeometry(0.1, 8, 6), 0.1, 0.3, 0.5, new THREE.MeshBasicMaterial({ color: 0x7fd36a }));
    leaf.scale.set(1.6, 0.35, 0.8);
  } else if (emblem === 'cross') {
    part(new THREE.BoxGeometry(0.18, 0.56, 0.14));
    part(new THREE.BoxGeometry(0.56, 0.18, 0.14));
  } else if (emblem === 'bolt') {
    part(new THREE.BoxGeometry(0.12, 0.34, 0.12), 0.06, 0.16, -0.5);
    part(new THREE.BoxGeometry(0.3, 0.1, 0.12), 0, 0, 0.3);
    part(new THREE.BoxGeometry(0.12, 0.34, 0.12), -0.06, -0.16, -0.5);
  } else {
    part(new THREE.SphereGeometry(0.12, 10, 8));
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.22, 10, 8), s * 0.24, 0.05, s * 0.5).scale.set(1.4, 0.45, 0.4);
  }
  g.add(apple);
  const rings = [0, 1].map((i) => {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.5 + i * 0.12, 0.018, 6, 36),
      new THREE.MeshBasicMaterial({ color: i ? 0xffd98a : glowColor, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    g.add(r);
    return r;
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: glowColor, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
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
