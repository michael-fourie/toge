import * as THREE from 'three';
import { pbr } from './render/surface.ts';

// The Gale Scythe (Survival's wonder weapon): a weathered wooden staff wrapped in cloth, a pale crescent blade that glows
// teal, and a wind gem where they meet. Hand space like the knife: the grip at the origin, the staff along -Z, the blade
// at the far end hooking out to the left (-X).

const STAFF = 1.15;

export function buildScythe(): THREE.Group {
  const wood = pbr({ color: 0x8a5d3b });
  const cloth = pbr({ color: 0xe8dcc0 });
  const blade = pbr({ color: 0xdff8f2, emissive: 0x5fe0c8, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  const gem = new THREE.MeshBasicMaterial({ color: 0x8ff5e0 });
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.022, 0.026, STAFF, 10).rotateX(Math.PI / 2), wood, 0, 0, 0.25 - STAFF / 2);
  for (const z of [0.05, -0.02, -0.09]) add(new THREE.TorusGeometry(0.027, 0.008, 6, 12), cloth, 0, 0, z); // cloth wraps at the grip
  const tip = 0.25 - STAFF;
  add(new THREE.SphereGeometry(0.045, 12, 8), wood, 0, 0, tip); // the knot the blade is lashed to
  add(new THREE.OctahedronGeometry(0.04), gem, 0, 0.05, tip + 0.02);
  // The crescent: a curved blade sweeping out to the left and back toward the grip.
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.quadraticCurveTo(-0.32, 0.12, -0.62, -0.22);
  s.quadraticCurveTo(-0.3, -0.02, 0, -0.04);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2).translate(0, 0, tip);
  add(geo, blade);
  // Two cloth streamers trailing off the knot.
  for (const [x, len] of [[0.02, 0.32], [-0.02, 0.24]]) add(new THREE.PlaneGeometry(0.035, len), cloth, x, -len / 2, tip + 0.03).rotation.set(0, 0, x * 6);
  return root;
}
