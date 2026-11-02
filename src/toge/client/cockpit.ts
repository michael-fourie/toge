// The inside of a car for the cockpit camera: dash, gauges, steering wheel, pillars, headliner, door cards
// and mirror, sized from each car's own greenhouse (its DESIGNS roof line), so the windscreen you look
// through is the shape of the one on the outside. The body itself is single sided, so from in here its
// shell vanishes and only the hood ahead (which faces up at you) still shows: exactly what a driver sees.
//
// Built in the car root's frame (the CG; front is -Z) and parented to the car's root, so it rides with it.

import * as THREE from 'three';
import { CARS, type CarId, type CarSpec } from '../shared/cars.ts';
import { DESIGNS } from './carkits.ts';
import { curve } from './carloft.ts';

export interface Cockpit {
  root: THREE.Group;
  /** Where the driver's eyes rest, in the car root's frame. */
  eye: THREE.Vector3;
  /** Turns the wheel and the gauge needles. */
  update(steer: number, rpm: number, kmh: number): void;
  dispose(): void;
}

/** The wheel turns this much per radian at the front tyres, up to about a turn and a half each way. */
const STEER_RATIO = 13;
const WHEEL_LOCK = 4.6;
/** Gauge sweeps: needle angle from rest to full scale (rad). */
const SWEEP = Math.PI * 1.5;
const MAX_KMH = 320;
const UP = new THREE.Vector3(0, 1, 0);

function dialTexture(redline: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#050607';
  g.fillRect(0, 0, 512, 256);
  const dial = (cx: number, steps: number, red: number, label: (i: number) => string) => {
    g.save();
    g.translate(cx, 128);
    g.strokeStyle = '#2a2d33';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 118, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * 0.75 + (i / steps) * SWEEP;
      g.strokeStyle = i >= red ? '#ff3b2f' : '#e8ecef';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(Math.cos(a) * 100, Math.sin(a) * 100);
      g.lineTo(Math.cos(a) * 82, Math.sin(a) * 82);
      g.stroke();
      g.fillStyle = i >= red ? '#ff6a5a' : '#cfd6dc';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label(i), Math.cos(a) * 62, Math.sin(a) * 62);
    }
    g.restore();
  };
  const revSteps = Math.ceil(redline / 1000) + 1;
  dial(128, revSteps, Math.floor(redline / 1000), (i) => String(i));
  dial(384, 8, 99, (i) => String(i * 40));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A box stretched from a to b (thickness w × d), for pillars and spokes. */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return m;
}

export function buildCockpit(id: CarId, spec: CarSpec): Cockpit {
  const b = CARS[id];
  const d = DESIGNS[id];
  const L = b.length;
  const H = b.height;
  const W = b.width / 2;
  const roof = curve(d.roof.map(([t, v]) => [t, v * H] as [number, number]));
  const zAt = (t: number) => (t - 0.5) * L;
  const tAt = (z: number) => z / L + 0.5;
  // Body space -> the car root (the CG): ground was y = 0, mid-wheelbase z = 0.
  const dy = -spec.cg;
  const dz = (spec.axleR - spec.axleF) / 2;

  const t0 = d.roof[0][0];
  const zBase = zAt(t0);
  const yBase = roof(t0);
  const zTop = zAt(d.roofF);
  const yTop = roof(d.roofF);
  const zRear = zAt(d.roofR);
  const halfBase = W * d.cabin * 0.9 - 0.04;
  const halfTop = W * d.cabin * (1 - d.cabTumble) * 0.9 - 0.04;
  // Right-hand drive (touge country, and traffic keeps left). Eyes about 0.7 m behind the top of the
  // windscreen and a fist and a half under the headliner.
  const ex = Math.min(0.4, halfTop * 0.5);
  const ez = Math.min(zTop + 0.7, zRear + 0.2);
  const ey = roof(Math.min(d.roofR, tAt(ez))) - 0.25;
  // The lower body's top runs on through the cabin at the beltline, facing up, so from in here it's a lid
  // over the footwells. The dash and sills sit just above it to cover it.
  const top = curve(d.top.map(([t, v]) => [t, v * H] as [number, number]));
  let lid = 0;
  for (let t = t0 - 0.02; t <= tAt(ez) + 0.02; t += 0.01) lid = Math.max(lid, top(t));

  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(0, dy, dz);
  root.add(inner);
  const own: { dispose(): void }[] = [];
  const mat = <T extends THREE.Material>(m: T) => (own.push(m), m);
  const dash = mat(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 }));
  const visor = mat(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9, side: THREE.DoubleSide }));
  const trim = mat(new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.8 }));
  const liner = mat(new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 1 }));
  const leather = mat(new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.55 }));
  const metal = mat(new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6, roughness: 0.45 }));
  const mirror = mat(new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 1, roughness: 0.15 }));
  const glass = mat(new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.05, depthWrite: false }));
  const tex = dialTexture(spec.redline);
  own.push(tex);
  const face = mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.4 }));
  const needleMat = mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1f, emissiveIntensity: 1.6 }));
  const add = (m: THREE.Mesh) => {
    m.castShadow = false;
    m.receiveShadow = true;
    inner.add(m);
    return m;
  };

  // Dash: a slab from the windscreen base back toward the driver, its top just under the glass line.
  const dashDepth = Math.max(0.3, ez - 0.5 - zBase);
  const dashTop = Math.max(yBase - 0.02, lid + 0.03);
  const slab = add(new THREE.Mesh(new THREE.BoxGeometry(halfBase * 2, 0.4, dashDepth), dash));
  slab.position.set(0, dashTop - 0.2, zBase + dashDepth / 2);
  // Binnacle: a visor over the gauges in front of the driver, open toward them.
  const gz = zBase + dashDepth;
  const hood = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 20, 1, true, Math.PI * 0.4, Math.PI * 0.6), visor));
  hood.rotation.z = Math.PI / 2;
  hood.scale.set(0.6, 1, 1);
  hood.position.set(ex, dashTop, gz - 0.13);
  // Gauges: tach left, speedo right, facing the eyes.
  const gaugeY = dashTop + 0.045;
  const gaugeZ = gz - 0.16;
  const eyeLocal = new THREE.Vector3(ex, ey, ez);
  const faceEye = (o: THREE.Object3D) => o.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eyeLocal, o.position, UP));
  const needles: THREE.Object3D[] = [];
  for (const [i, side] of [-1, 1].entries()) {
    const gx = ex + side * 0.075;
    const geo = new THREE.CircleGeometry(0.058, 32);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + i * 0.5);
    const disc = add(new THREE.Mesh(geo, face));
    disc.position.set(gx, gaugeY, gaugeZ);
    faceEye(disc);
    const pivot = new THREE.Group();
    pivot.position.copy(disc.position);
    pivot.quaternion.copy(disc.quaternion);
    pivot.translateZ(0.002);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.001), needleMat);
    n.position.y = 0.02;
    const spin = new THREE.Group();
    spin.add(n);
    pivot.add(spin);
    inner.add(pivot);
    needles.push(spin);
  }

  // Steering wheel: rim, three spokes and a hub on a column that rises toward the driver, its face tipped up.
  const wheel = new THREE.Group();
  const wheelZ = gz + 0.04;
  const wheelY = dashTop - 0.04;
  wheel.position.set(ex, wheelY, wheelZ);
  wheel.rotation.x = -0.42;
  const spin = new THREE.Group();
  wheel.add(spin);
  const rimR = 0.18;
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.017, 10, 40), leather));
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 18).rotateX(Math.PI / 2), leather));
  const o = new THREE.Vector3();
  for (const a of [0, Math.PI * 0.62, -Math.PI * 0.62]) {
    const end = new THREE.Vector3(Math.sin(a) * rimR, -Math.cos(a) * rimR, 0);
    spin.add(strut(o, end, 0.03, 0.012, a === 0 ? leather : metal));
  }
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.026, 0.036), metal);
  marker.position.y = rimR;
  spin.add(marker);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 12), dash);
  column.rotation.x = Math.PI / 2;
  column.position.z = -0.2;
  wheel.add(column);
  wheel.traverse((m) => {
    if (m instanceof THREE.Mesh) m.receiveShadow = true;
  });
  inner.add(wheel);

  // A pillars, header rail and headliner: the frame round the windscreen.
  const inset = 0.035;
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * (halfBase - inset), yBase - 0.02, zBase + 0.04);
    const t = new THREE.Vector3(s * (halfTop - inset), yTop - 0.02, zTop + 0.05);
    add(strut(a, t, 0.075, 0.05, trim));
    if (d.bPillar) {
      const bz = zAt(d.bPillar);
      add(strut(new THREE.Vector3(s * (halfBase - inset), yBase - 0.05, bz), new THREE.Vector3(s * (halfTop - inset), roof(d.bPillar) - 0.02, bz), 0.04, 0.1, trim));
    }
  }
  const header = add(new THREE.Mesh(new THREE.BoxGeometry(halfTop * 2, 0.035, 0.1), trim));
  header.position.set(0, yTop - 0.035, zTop + 0.06);
  const linerLen = Math.max(0.3, zRear - zTop);
  const head = add(new THREE.Mesh(new THREE.PlaneGeometry(halfTop * 2, linerLen), liner));
  head.rotation.x = Math.PI / 2;
  head.position.set(0, Math.min(yTop, roof(tAt(ez))) - 0.03, zTop + linerLen / 2);
  // Rear-view mirror hanging off the header, angled at the driver.
  const rvm = new THREE.Group();
  rvm.position.set(0, yTop - 0.11, zTop + 0.1);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06, 0.03), dash);
  const glassFace = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.046), mirror);
  glassFace.position.z = 0.016;
  rvm.add(housing, glassFace);
  rvm.add(strut(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, 0.1, -0.04), 0.015, 0.015, dash));
  faceEye(rvm);
  inner.add(rvm);
  // Door cards and sills up to the beltline, and a floor, so nothing but road shows through the side glass.
  const doorLen = Math.max(0.8, ez + 0.5 - zBase);
  for (const s of [-1, 1]) {
    const door = add(new THREE.Mesh(new THREE.PlaneGeometry(doorLen, lid - 0.25), trim));
    door.rotation.y = s * -Math.PI / 2;
    door.position.set(s * halfBase, (lid + 0.25) / 2, zBase + doorLen / 2);
    const sill = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, doorLen), dash));
    sill.position.set(s * (halfBase - 0.05), lid + 0.02, zBase + doorLen / 2);
  }
  // The lap: covers the rest of the lid between the dash and the seat.
  const lap = add(new THREE.Mesh(new THREE.PlaneGeometry(halfBase * 2, ez + 0.2 - gz), dash));
  lap.rotation.x = -Math.PI / 2;
  lap.position.set(0, lid + 0.005, (gz + ez + 0.2) / 2);
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(halfBase * 2, doorLen), dash));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.3, zBase + doorLen / 2);
  // A faint film on the windscreen.
  const wsLen = Math.hypot(zTop - zBase, yTop - yBase);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry((halfBase + halfTop), wsLen), glass);
  ws.position.set(0, (yBase + yTop) / 2, (zBase + zTop) / 2 + 0.01);
  ws.rotation.x = Math.atan2(zTop - zBase, yTop - yBase);
  ws.renderOrder = 2;
  inner.add(ws);

  inner.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.castShadow = false;
      if (!own.includes(m.geometry)) own.push(m.geometry);
    }
  });

  return {
    root,
    eye: new THREE.Vector3(ex, ey + dy, ez + dz),
    update(steer, rpm, kmh) {
      spin.rotation.z = -Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, steer * STEER_RATIO));
      const revFull = Math.ceil(spec.redline / 1000) + 1;
      needles[0].rotation.z = -(Math.PI * 0.25 + Math.min(1, rpm / 1000 / revFull) * SWEEP) + Math.PI;
      needles[1].rotation.z = -(Math.PI * 0.25 + Math.min(1, kmh / MAX_KMH) * SWEEP) + Math.PI;
    },
    dispose() {
      root.removeFromParent();
      for (const x of own) x.dispose();
    },
  };
}
