// Procedural car models: each body style is a side profile (with real wheel arches) extruded across the
// car with rounded edges, a tinted glass cabin, lights, mirrors and the options you pick in the garage
// (paint and finish, rims, spoiler, stripes). The model's origin is the centre of gravity, like the physics.

import * as THREE from 'three';
import { type BaseCar, type Body, CARS, type CarSpec, type OwnedCar, PAINTS, RIM_COLORS, carSpec } from '../../shared/race/cars.ts';

interface Profile {
  belt: number; // beltline height (× height)
  hood: number; // hood front height
  tail: number; // tail/deck height
  ws: number; // windscreen base (× length, + = toward the front)
  roofF: number;
  roofR: number;
  back: number; // rear window base
}

const PROFILES: Record<Body, Profile> = {
  hatch: { belt: 0.6, hood: 0.52, tail: 0.66, ws: 0.17, roofF: 0.04, roofR: -0.36, back: -0.47 },
  coupe: { belt: 0.6, hood: 0.5, tail: 0.6, ws: 0.17, roofF: 0.0, roofR: -0.2, back: -0.4 },
  muscle: { belt: 0.64, hood: 0.6, tail: 0.66, ws: 0.08, roofF: -0.05, roofR: -0.24, back: -0.34 },
  super: { belt: 0.55, hood: 0.4, tail: 0.58, ws: 0.22, roofF: 0.04, roofR: -0.14, back: -0.42 },
};

const GROUND_CLEAR = 0.15;

function paintMaterial(owned: OwnedCar, color = PAINTS[owned.look.paint]): THREE.MeshPhysicalMaterial {
  const f = owned.look.finish;
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.05, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  if (f === 1) {
    m.metalness = 0.65;
    m.roughness = 0.33;
  } else if (f === 2) {
    m.metalness = 0.1;
    m.roughness = 0.72;
    m.clearcoat = 0;
  } else if (f === 3) {
    m.metalness = 0.35;
    m.roughness = 0.28;
    m.iridescence = 0.7;
    m.iridescenceIOR = 1.5;
    m.iridescenceThicknessRange = [200, 600];
  }
  return m;
}

const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1b2633, metalness: 0.9, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.6 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.12, metalness: 1 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.92 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x7a7d82, roughness: 0.35, metalness: 0.9 }),
  caliper: new THREE.MeshStandardMaterial({ color: 0xc0261d, roughness: 0.4, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.6, roughness: 0.1 }),
  grille: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.8 }),
};

/** Side outline of the lower body (up to the beltline) with arches over both wheels. */
function bodyShape(b: BaseCar, sp: CarSpec, p: Profile): THREE.Shape {
  const L = b.length;
  const H = b.height;
  const half = L / 2;
  // Axles relative to the body's centre (front is +x in the shape).
  const mid = (sp.axleR - sp.axleF) / 2;
  const fx = sp.axleF + mid;
  const rx = -(sp.axleR - mid);
  const ar = b.radius + 0.06;
  const wy = b.radius; // wheel centre height above the ground
  const s = new THREE.Shape();
  s.moveTo(-half + 0.08, GROUND_CLEAR + 0.12);
  s.lineTo(-half + 0.14, GROUND_CLEAR);
  s.lineTo(rx - ar, GROUND_CLEAR);
  s.absarc(rx, wy, ar, Math.PI - 0.05, 0.05, true);
  s.lineTo(fx - ar, GROUND_CLEAR);
  s.absarc(fx, wy, ar, Math.PI - 0.05, 0.05, true);
  s.lineTo(half - 0.16, GROUND_CLEAR);
  s.quadraticCurveTo(half + 0.02, GROUND_CLEAR + 0.02, half, H * p.hood * 0.62);
  s.quadraticCurveTo(half - 0.02, H * p.hood, half - 0.22, H * p.hood + 0.02);
  s.quadraticCurveTo(L * p.ws, H * p.belt + 0.02, L * p.ws, H * p.belt + 0.02);
  s.lineTo(L * p.back, H * p.belt);
  s.quadraticCurveTo(-half + 0.2, H * p.tail + 0.02, -half + 0.04, H * p.tail);
  s.quadraticCurveTo(-half - 0.02, H * p.tail * 0.6, -half + 0.08, GROUND_CLEAR + 0.12);
  return s;
}

function cabinShape(b: BaseCar, p: Profile): THREE.Shape {
  const L = b.length;
  const H = b.height;
  const s = new THREE.Shape();
  s.moveTo(L * p.ws + 0.02, H * p.belt);
  s.quadraticCurveTo(L * (p.ws + p.roofF) * 0.5 + 0.1, H * 0.95, L * p.roofF, H);
  s.lineTo(L * p.roofR, H);
  s.quadraticCurveTo(L * (p.roofR + p.back) * 0.5 - 0.05, H * 0.97, L * p.back - 0.02, H * p.belt);
  s.lineTo(L * p.ws + 0.02, H * p.belt);
  return s;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Real bodies aren't slab-sided: narrow the extrusion toward the roof (tumblehome) and round it off in plan
 * toward the nose and tail. `top` is how much narrower it gets from `y0` to `y1`.
 */
function sculpt(geo: THREE.BufferGeometry, b: BaseCar, y0: number, y1: number, top: number, ends: number) {
  const pos = geo.getAttribute('position');
  const half = b.length / 2;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = (1 - top * smooth(y0, y1, y)) * (1 - ends * smooth(0.5, 1.02, Math.abs(z) / half));
    pos.setX(i, pos.getX(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Extrudes a side outline across `width`, centred, with its front toward -Z. */
function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 16 });
  geo.translate(0, 0, -(width - 2 * bevel) / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function wheel(b: BaseCar, owned: OwnedCar): { spin: THREE.Group; fixed: THREE.Group } {
  const R = b.radius;
  const w = 0.2 + b.width * 0.03;
  const fixed = new THREE.Group();
  const spin = new THREE.Group();
  fixed.add(spin);
  // Tyre: a lathed profile with rounded shoulders.
  const pts: THREE.Vector2[] = [];
  const rimR = R * 0.68;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(R - 0.035 + Math.sin(a) * 0.035, -w / 2 + (1 - Math.cos(a)) * (w / 2)));
  }
  pts.unshift(new THREE.Vector2(rimR, -w / 2 + 0.01));
  pts.push(new THREE.Vector2(rimR, w / 2 - 0.01));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), shared.tyre);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  spin.add(tyre);
  const rimMat = new THREE.MeshStandardMaterial({ color: RIM_COLORS[owned.look.rimColor], metalness: 0.85, roughness: 0.25 });
  const face = w / 2 - 0.02;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, w - 0.04, 24, 1, true), rimMat);
  barrel.rotation.z = Math.PI / 2;
  spin.add(barrel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.24, 0.05, 12), rimMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = face;
  spin.add(hub);
  const style = owned.look.rims;
  const spokes = style === 0 ? 5 : style === 1 ? 14 : style === 2 ? 9 : 6;
  const spokeW = style === 1 ? 0.018 : style === 2 ? 0.06 : 0.045;
  for (let i = 0; i < spokes; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, rimR * 0.9, spokeW), rimMat);
    const a = (i / spokes) * Math.PI * 2;
    sp.position.set(face - (style === 3 ? 0.04 : 0), Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5);
    sp.rotation.x = -a;
    if (style === 2) sp.rotation.y = 0.5;
    spin.add(sp);
  }
  if (style === 3) {
    // Deep dish: a polished lip.
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.01, 0.018, 8, 28), shared.chrome);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = face;
    spin.add(lip);
  }
  // Brake disc spins; the caliper doesn't.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.025, 24), shared.disc);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = face - 0.07;
  spin.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, rimR * 0.5, 0.14), shared.caliper);
  caliper.position.set(face - 0.055, rimR * 0.55, 0);
  fixed.add(caliper);
  return { spin, fixed };
}

export interface CarModel {
  root: THREE.Group;
  /** Turns the wheels and suspension and the brake lights. Positions are body-space wheel centres. */
  pose(wheels: { y: number; angle: number }[], steer: number, braking: boolean): void;
  dispose(): void;
}

export function buildCar(owned: OwnedCar): CarModel {
  const b = CARS[owned.model];
  const sp = carSpec(owned);
  const p = PROFILES[b.body];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Shape space: ground at y=0, body centre at x=0; the root is the CG.
  const mid = (sp.axleR - sp.axleF) / 2;
  body.position.set(0, -sp.cg, mid);
  const paint = paintMaterial(owned);
  const H = b.height;
  const bodySculpt = (g: THREE.BufferGeometry) => sculpt(g, b, H * 0.3, H * p.belt + 0.05, 0.07, 0.12);
  const cabinSculpt = (g: THREE.BufferGeometry) => sculpt(g, b, H * p.belt, H + 0.02, 0.26, 0.1);
  const lower = new THREE.Mesh(bodySculpt(extrude(bodyShape(b, sp, p), b.width, 0.09)), paint);
  lower.castShadow = true;
  body.add(lower);
  const cabin = new THREE.Mesh(cabinSculpt(extrude(cabinShape(b, p), b.width * 0.86, 0.07)), shared.glass);
  cabin.castShadow = true;
  body.add(cabin);
  // Roof panel over the glass.
  const roof = new THREE.Shape();
  roof.moveTo(b.length * p.roofF + 0.12, b.height - 0.035);
  roof.lineTo(b.length * p.roofF - 0.02, b.height + 0.012);
  roof.lineTo(b.length * p.roofR + 0.02, b.height + 0.012);
  roof.lineTo(b.length * p.roofR - 0.12, b.height - 0.035);
  const roofMesh = new THREE.Mesh(cabinSculpt(extrude(roof, b.width * 0.88, 0.03)), paint);
  body.add(roofMesh);
  // Black sills between the wheels, and a diffuser under the tail.
  const sill = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.97, 0.08, b.wheelbase * 0.62), shared.trim);
  sill.position.y = GROUND_CLEAR + 0.03; // the body origin is mid-wheelbase
  body.add(sill);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.72, 0.17, 0.12), shared.trim);
  diffuser.position.set(0, GROUND_CLEAR + 0.1, b.length / 2 - 0.04);
  body.add(diffuser);
  // Lights.
  const half = b.length / 2;
  const hoodY = b.height * p.hood;
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.22, 0.07, 0.08), shared.head);
    head.position.set(side * b.width * 0.31, hoodY * 0.88, -half + 0.12);
    head.rotation.x = -0.3;
    body.add(head);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.11), paint);
    mirror.position.set(side * (b.width / 2 + 0.05), b.height * p.belt + 0.08, -b.length * p.ws - 0.08);
    body.add(mirror);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12), shared.chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * b.width * (b.body === 'super' ? 0.12 : 0.3), GROUND_CLEAR + 0.08, half - 0.02);
    body.add(exhaust);
  }
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1a12, emissiveIntensity: 0.6, roughness: 0.2 });
  const tailY = b.height * p.tail * 0.84;
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.26, 0.09, 0.05), tail);
    lamp.position.set(side * b.width * 0.3, tailY, half - 0.01);
    body.add(lamp);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.3, 0.025, 0.05), tail);
  bar.position.set(0, tailY, half - 0.01);
  body.add(bar);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.5, hoodY * 0.3, 0.04), shared.grille);
  grille.position.set(0, hoodY * 0.42, -half + 0.03);
  body.add(grille);
  // Spoilers.
  if (owned.look.spoiler === 1) {
    const duck = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.8, 0.05, 0.22), paint);
    duck.position.set(0, b.height * p.tail + 0.03, half - 0.18);
    duck.rotation.x = 0.25;
    body.add(duck);
  } else if (owned.look.spoiler === 2) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(b.width * 0.92, 0.035, 0.3), shared.trim);
    wing.position.set(0, b.height * p.tail + 0.3, half - 0.22);
    wing.rotation.x = 0.12;
    body.add(wing);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.1), shared.trim);
      post.position.set(side * b.width * 0.3, b.height * p.tail + 0.15, half - 0.2);
      body.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.34), paint);
      plate.position.set(side * b.width * 0.46, b.height * p.tail + 0.32, half - 0.22);
      body.add(plate);
    }
  }
  // Stripes: a slightly larger slice of the body outline down the middle, or a line along each flank.
  const stripeMat = paintMaterial(owned, PAINTS[owned.look.stripeColor]);
  if (owned.look.stripe === 1) {
    for (const side of [-1, 1]) {
      const st = new THREE.Mesh(bodySculpt(extrude(bodyShape(b, sp, p), 0.2, 0.02)), stripeMat);
      st.scale.set(1.004, 1.012, 1.004);
      st.position.x = side * 0.17;
      body.add(st);
      const rs = new THREE.Mesh(cabinSculpt(extrude(roof, 0.2, 0.01)), stripeMat);
      rs.position.set(side * 0.17, 0.006, 0);
      body.add(rs);
    }
  } else if (owned.look.stripe === 2) {
    for (const side of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.07, b.length * 0.62), stripeMat);
      st.position.set(side * (b.width / 2 + 0.002), b.height * p.belt * 0.72, 0);
      body.add(st);
    }
  }
  // Soft contact shadow so the car sits on the road even outside the shadow map.
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(b.width * 1.25, b.length * 1.12), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.75 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = -1;
  body.add(blob);

  const wheels = [0, 1, 2, 3].map((i) => {
    const w = wheel(b, owned);
    const outward = i % 2 === 0 ? -1 : 1;
    if (outward < 0) w.fixed.rotation.y = Math.PI; // the face of the rim points out on both sides
    const holder = new THREE.Group();
    holder.add(w.fixed);
    root.add(holder);
    return { holder, ...w, outward };
  });

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== blob) (o as THREE.Mesh).castShadow = true;
  });

  return {
    root,
    pose(ws, steer, braking) {
      wheels.forEach((w, i) => {
        const front = i < 2;
        w.holder.position.set((i % 2 === 0 ? -0.5 : 0.5) * sp.track, ws[i].y, front ? -sp.axleF : sp.axleR);
        w.holder.rotation.y = front ? -steer : 0;
        w.spin.rotation.x = -ws[i].angle * (w.outward < 0 ? -1 : 1);
      });
      tail.emissiveIntensity = braking ? 3.2 : 0.6;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) if (!Object.values(shared).includes(mat as never)) mat.dispose();
        }
      });
    },
  };
}

let blobTex: THREE.CanvasTexture | null = null;
function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}
