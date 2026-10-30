import * as THREE from 'three';
import { softDot } from './textures.ts';

// The Survival look: the same sky islands under a moon. Deep indigo sky, a pale moon, stars, cool moonlight
// and dark blue clouds. Gameplay surfaces keep their own glow (pads, gates, hooks, stations) so they read like lanterns.

export const NIGHT = {
  zenith: 0x050824,
  sky: 0x151c4a,
  horizon: 0x4a3f78,
  below: 0x161d44,
  deep: 0x080b22,
  fog: 0x161c40,
  light: 0xaebfff, // moonlight
  skyLight: 0x6d84cc,
  groundBounce: 0x2f2c58,
  cloudTint: 0x39467a,
  cloudSprite: 0x5662a0,
};

/** Where the moon hangs (also the direction the moonlight comes from). */
export const MOON_DIR = new THREE.Vector3(-40, 62, -45).normalize();

/** A dome of twinkling stars (upper hemisphere only). Drawn behind everything, ignores fog. */
export function makeStars(): { obj: THREE.Points; update(time: number): void } {
  const N = 1300;
  const pos = new Float32Array(N * 3);
  let seed = 4242;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2;
    const y = 0.04 + r() * 0.96; // keep them above the horizon
    const s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * s * 850, y * 850, Math.sin(a) * s * 850], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xfff7e6, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
  const obj = new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  obj.renderOrder = -1;
  return { obj, update: (t) => (mat.opacity = 0.78 + 0.14 * Math.sin(t * 1.3)) };
}

/** A big pale moon with a soft halo, hung in the sky along MOON_DIR. */
export function makeMoon(): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(MOON_DIR).multiplyScalar(780);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(34, 40), new THREE.MeshBasicMaterial({ color: 0xf4f1e4, fog: false, depthWrite: false }));
  disc.lookAt(0, 0, 0);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softDot(), color: 0xaebfff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  halo.scale.setScalar(230);
  g.add(halo, disc);
  g.renderOrder = -1;
  return g;
}
