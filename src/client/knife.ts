import * as THREE from 'three';
import type { KnifePaint, KnifeStyle } from '../shared/items.ts';
import { pbr } from './render/surface.ts';

/** What you hold when no knife skin is equipped. */
export const DEFAULT_KNIFE: KnifePaint = { style: 'combat', blade: 0xc9d1d6, handle: 0x3b3b40 };

/** Blade outlines as (forward, up) points in metres, tip at the far end. Karambit is a curve, the rest are polygons. */
const POLYGONS: Partial<Record<KnifeStyle, [number, number][]>> = {
  combat: [[0, 0.014], [0.17, 0.014], [0.25, -0.002], [0.2, -0.02], [0.06, -0.022], [0, -0.014]],
  machete: [[0, 0.016], [0.3, 0.016], [0.37, 0.032], [0.37, -0.034], [0, -0.024]],
  kunai: [[0, 0.012], [0.05, 0.03], [0.15, 0.032], [0.27, 0], [0.15, -0.032], [0.05, -0.03], [0, -0.012]],
};

function bladeShape(style: KnifeStyle) {
  const s = new THREE.Shape();
  const poly = POLYGONS[style];
  if (poly) {
    s.moveTo(...poly[0]);
    for (const p of poly.slice(1)) s.lineTo(...p);
  } else {
    // Karambit: a crescent that hooks down from the spine.
    s.moveTo(0, 0.012);
    s.quadraticCurveTo(0.15, 0.03, 0.2, -0.08);
    s.quadraticCurveTo(0.12, -0.01, 0, -0.012);
  }
  s.closePath();
  return s;
}

/** Forward x -> -Z, thickness z -> X, so the blade points down the barrel axis like the rifle does. */
function bladeGeo(style: KnifeStyle) {
  const geo = new THREE.ExtrudeGeometry(bladeShape(style), { depth: 0.006, bevelEnabled: false });
  geo.translate(0, 0, -0.003).rotateY(Math.PI / 2);
  return geo.translate(0, 0, -0.02);
}

/**
 * A knife in hand space: the grip is at the origin, the blade points -Z, the edge faces down.
 * Rendered by the viewmodel (first person) and the avatar (third person).
 */
export function buildKnife(paint: KnifePaint): THREE.Group {
  const blade = pbr({ color: paint.blade, emissive: paint.glow ? paint.blade : 0, emissiveIntensity: paint.glow ? 0.45 : 0 });
  const handle = pbr({ color: paint.handle });
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  add(bladeGeo(paint.style), blade);
  add(new THREE.CylinderGeometry(0.016, 0.014, 0.12, 10).rotateX(Math.PI / 2), handle, 0, 0, 0.05); // grip
  add(new THREE.BoxGeometry(0.014, 0.05, 0.012), handle, 0, 0, -0.015); // guard
  if (paint.style === 'karambit' || paint.style === 'kunai') {
    const ring = add(new THREE.TorusGeometry(0.026, 0.005, 6, 16), handle, 0, -0.012, 0.115);
    ring.rotation.y = Math.PI / 2; // a finger ring at the pommel
  } else {
    add(new THREE.SphereGeometry(0.017, 8, 6), handle, 0, 0, 0.115); // pommel
  }
  return root;
}
