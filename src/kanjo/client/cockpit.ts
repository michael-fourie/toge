// The inside of a car for the cockpit camera: dash, gauges, steering wheel, pillars, headliner, door cards
// and mirror, sized from each car's own greenhouse (its DESIGNS roof line), so the windscreen you look
// through is the shape of the one on the outside. The body itself is single sided, so from in here its
// shell vanishes and only the hood ahead (which faces up at you) still shows: exactly what a driver sees.
//
// Built in the car root's frame (the CG; front is -Z) and parented to the car's root, so it rides with it.

import * as THREE from 'three';
import { CARS, type CarId, type CarSpec, isBike } from '../shared/cars.ts';
import { DESIGNS, type Design, driverEye } from './carkits.ts';
import { MAT } from './carparts.ts';
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

/** The dials' faces; `accent` draws a sports cluster (a ring in that colour round the rev counter's red zone). */
function dialTexture(redline: number, accent?: number): THREE.CanvasTexture {
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
    if (accent !== undefined) {
      // A bright band round the red zone (or the whole sweep, faintly, on the speedo).
      g.strokeStyle = `#${accent.toString(16).padStart(6, '0')}`;
      g.lineWidth = 9;
      g.globalAlpha = red < steps ? 1 : 0.35;
      g.beginPath();
      g.arc(0, 0, 109, Math.PI * 0.75 + (Math.min(red, steps) / steps) * SWEEP * (red < steps ? 1 : 0), Math.PI * 0.75 + SWEEP);
      g.stroke();
      g.globalAlpha = 1;
    }
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

/** Two dials (tach left, speedo right) facing `eye`, with needles; returns the needle spinners. */
function gauges(parent: THREE.Object3D, face: THREE.Material, needleMat: THREE.Material, centre: THREE.Vector3, eye: THREE.Vector3, gap: number, r: number) {
  const needles: THREE.Object3D[] = [];
  for (const [i, side] of [-1, 1].entries()) {
    const geo = new THREE.CircleGeometry(r, 32);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + i * 0.5);
    const disc = new THREE.Mesh(geo, face);
    disc.position.copy(centre).add(new THREE.Vector3(side * gap, 0, 0));
    disc.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, disc.position, UP));
    parent.add(disc);
    const pivot = new THREE.Group();
    pivot.position.copy(disc.position);
    pivot.quaternion.copy(disc.quaternion);
    pivot.translateZ(0.002);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.86, 0.001), needleMat);
    n.position.y = r * 0.34;
    const spin = new THREE.Group();
    spin.add(n);
    pivot.add(spin);
    parent.add(pivot);
    needles.push(spin);
  }
  return needles;
}

function setNeedles(needles: THREE.Object3D[], spec: CarSpec, rpm: number, kmh: number) {
  const revFull = Math.ceil(spec.redline / 1000) + 1;
  needles[0].rotation.z = -(Math.PI * 0.25 + Math.min(1, rpm / 1000 / revFull) * SWEEP) + Math.PI;
  needles[1].rotation.z = -(Math.PI * 0.25 + Math.min(1, kmh / MAX_KMH) * SWEEP) + Math.PI;
}

/** Shift lights: green, then amber, then red as the revs climb past `SHIFT_FROM` of the redline. */
const SHIFT_FROM = 0.72;
const LED_COLOURS = [0x29ff6a, 0x29ff6a, 0xffc21a, 0xffc21a, 0xff2a1a, 0xff2a1a, 0xff2a1a];

/**
 * A sports wheel on `spin`: an Alcantara rim with a flat bottom, carbon spokes and hub, the accent at twelve
 * o'clock, and a row of shift lights across the hub. Carbon paddles go on `fixed` (the column). Returns the
 * lights' materials.
 */
function sportWheel(spin: THREE.Group, fixed: THREE.Group, r: number, rim: THREE.Material, carbon: THREE.Material, accent: THREE.Material, mat: <T extends THREE.Material>(m: T) => T): THREE.MeshBasicMaterial[] {
  const gap = 0.62; // half the angle the flat bottom cuts off
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 10, 44, Math.PI * 2 - gap * 2).rotateZ(-Math.PI / 2 + gap), rim));
  const lo = -Math.cos(gap) * r;
  const bx = Math.sin(gap) * r;
  spin.add(strut(new THREE.Vector3(-bx, lo, 0), new THREE.Vector3(bx, lo, 0), 0.04, 0.034, rim));
  const o = new THREE.Vector3();
  for (const s of [-1, 1]) spin.add(strut(o, new THREE.Vector3(s * r, -0.01, 0), 0.05, 0.014, carbon));
  spin.add(strut(o, new THREE.Vector3(0, lo, 0), 0.04, 0.014, carbon));
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.035), carbon);
  hub.position.set(0, 0.005, 0.004);
  spin.add(hub);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.042), accent);
  marker.position.y = r;
  spin.add(marker);
  const leds = LED_COLOURS.map((c) => mat(new THREE.MeshBasicMaterial({ color: c })));
  leds.forEach((m, i) => {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.008, 0.004), m);
    led.position.set((i - 3) * 0.017, 0.04, 0.023);
    spin.add(led);
  });
  shiftLights(leds, 0);
  for (const s of [-1, 1]) {
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.008), carbon);
    paddle.position.set(s * (r * 0.62), 0.02, -0.035);
    paddle.rotation.z = s * -0.25;
    fixed.add(paddle);
  }
  return leds;
}

/** Lights the shift lights for revs at `share` of the redline (all of them flash at the limiter). */
function shiftLights(leds: THREE.MeshBasicMaterial[], share: number) {
  const n = Math.round(((share - SHIFT_FROM) / (0.97 - SHIFT_FROM)) * leds.length);
  const flash = share > 0.985 && Math.floor(performance.now() / 70) % 2 === 0;
  leds.forEach((m, i) => {
    m.color.setHex(LED_COLOURS[i]).multiplyScalar(flash ? 0.08 : i < n ? 1 : 0.08);
  });
}

/** A rear-view mirror's glass: sky over a grey road, darkened toward the edges like a real one at a glance. */
function mirrorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 48);
  sky.addColorStop(0, '#7f97ab');
  sky.addColorStop(0.5, '#b9c6cf');
  sky.addColorStop(0.52, '#4d5258');
  sky.addColorStop(1, '#2b2e33');
  g.fillStyle = sky;
  g.fillRect(0, 0, 128, 48);
  const edge = g.createRadialGradient(64, 24, 10, 64, 24, 72);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = edge;
  g.fillRect(0, 0, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The centre screen: a dark page with the drive mode and a little rev graph in the accent colour. */
function screenTexture(accent: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07080a';
  g.fillRect(0, 0, 256, 128);
  const hex = `#${accent.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex;
  g.font = 'bold 30px sans-serif';
  g.fillText('CORSA', 16, 44);
  g.fillStyle = '#9aa3ad';
  g.font = '16px sans-serif';
  g.fillText('DRIVE MODE', 16, 70);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = i > 8 ? hex : '#3d4450';
    const h = 8 + i * 3.5;
    g.fillRect(150 + i * 8, 112 - h, 5, h);
  }
  g.strokeStyle = '#2a2f37';
  g.lineWidth = 2;
  g.strokeRect(4, 4, 248, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A bike's rider's eye: tucked in behind the screen, chin over the tank. The bike itself is the view (fairing,
 * screen, tank, the bars turning with the fork; the rider is hidden), so this adds only the clocks on the top
 * yoke. Built in the bike's leaning frame (bikemodel.ts), so the horizon tilts as it leans.
 */
function buildBikeCockpit(id: CarId, spec: CarSpec): Cockpit {
  const b = CARS[id];
  const zF = -b.wheelbase / 2;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(0, -spec.cg, (spec.axleR - spec.axleF) / 2);
  root.add(inner);
  const own: { dispose(): void }[] = [];
  const tex = dialTexture(spec.redline);
  const face = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.4 });
  const needleMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1f, emissiveIntensity: 1.6 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 });
  own.push(tex, face, needleMat, housing);
  const eye = new THREE.Vector3(0, 1.17, zF + 0.86);
  const centre = new THREE.Vector3(0, 1.0, zF + 0.53);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 0.06), housing);
  box.position.copy(centre).add(new THREE.Vector3(0, -0.01, -0.03));
  box.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, box.position, UP));
  inner.add(box);
  const needles = gauges(inner, face, needleMat, centre.clone().add(new THREE.Vector3(0, 0, 0.005)), eye, 0.06, 0.05);
  inner.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.castShadow = false;
      own.push(m.geometry);
    }
  });
  return {
    root,
    eye: eye.clone().add(inner.position),
    update(_steer, rpm, kmh) {
      setNeedles(needles, spec, rpm, kmh);
    },
    dispose() {
      root.removeFromParent();
      for (const x of own) x.dispose();
    },
  };
}

/** `design`: the car's own when it wears a body kit (the built model's `userData.design`), else the stock one. */
export function buildCockpit(id: CarId, spec: CarSpec, design?: Design): Cockpit {
  if (isBike(id)) return buildBikeCockpit(id, spec);
  const b = CARS[id];
  const d = design ?? DESIGNS[id];
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
  const { x: ex, y: ey, z: ez } = driverEye(d, L, W, H);
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
  // A car with its own trim (DESIGNS interior) gets Alcantara, carbon and its accent colour, and a sports wheel.
  const style = d.interior;
  const dash = mat(new THREE.MeshStandardMaterial({ color: style ? 0x111114 : 0x15161a, roughness: 0.9 }));
  const visor = mat(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9, side: THREE.DoubleSide }));
  const trim = style ? dash : mat(new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.8 }));
  const liner = mat(new THREE.MeshStandardMaterial({ color: style?.liner ?? 0x8a8781, roughness: 1 }));
  const leather = mat(new THREE.MeshStandardMaterial({ color: style ? 0x19191c : 0x0e0e10, roughness: style ? 0.9 : 0.55 }));
  const accent = style ? mat(new THREE.MeshStandardMaterial({ color: style.accent, emissive: style.accent, emissiveIntensity: 0.12, roughness: 0.45 })) : null;
  // The body's carbon with a satin finish: this close up, its clear coat mirrors the sky and glares white.
  const carbon = mat(MAT.carbon.clone());
  Object.assign(carbon, { clearcoat: 0.15, roughness: 0.55, envMapIntensity: 0.35 });
  const metal = mat(new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6, roughness: 0.45 }));
  // A sports cabin's mirror shows a hint of the view behind (a painted one: a second render would cost a frame).
  const mirrorTex = style ? mirrorTexture() : null;
  if (mirrorTex) own.push(mirrorTex);
  const mirror = mat(mirrorTex ? new THREE.MeshBasicMaterial({ map: mirrorTex }) : new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 1, roughness: 0.15 }));
  const glass = mat(new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.05, depthWrite: false }));
  const tex = dialTexture(spec.redline, style?.accent);
  own.push(tex);
  // A sports cluster is a screen: lit, with no sheen on it.
  const face = mat(style ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.4 }));
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
  const needles = gauges(inner, face, needleMat, new THREE.Vector3(ex, gaugeY, gaugeZ), eyeLocal, 0.075, 0.058);

  // Steering wheel: rim, three spokes and a hub on a column that rises toward the driver, its face tipped up.
  const wheel = new THREE.Group();
  const wheelZ = gz + 0.04;
  const wheelY = dashTop - 0.04;
  wheel.position.set(ex, wheelY, wheelZ);
  wheel.rotation.x = -0.42;
  const spin = new THREE.Group();
  wheel.add(spin);
  const rimR = 0.18;
  let leds: THREE.MeshBasicMaterial[] = [];
  if (style && accent) leds = sportWheel(spin, wheel, rimR, leather, carbon, accent, mat);
  else {
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
  }
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
    add(strut(a, t, style ? 0.04 : 0.075, style ? 0.03 : 0.05, trim));
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
  if (style) {
    // Down the screen to where the glass is a hand above your eyes, so it isn't in your face under a low header.
    let t = d.roofF;
    while (t > t0 + 0.02 && roof(t) > ey + 0.13) t -= 0.005;
    rvm.position.set(0, roof(t) - 0.06, zAt(t) + 0.03);
  }
  // A low car's header is close to your face: its mirror is smaller and tucked up against the glass.
  const mw = style ? 0.13 : 0.21;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(mw, style ? 0.05 : 0.06, 0.03), style ? carbon : dash);
  const glassFace = new THREE.Mesh(new THREE.PlaneGeometry(mw - 0.02, style ? 0.036 : 0.046), mirror);
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
    const sill = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, doorLen), style ? carbon : dash));
    sill.position.set(s * (halfBase - 0.05), lid + 0.02, zBase + doorLen / 2);
  }
  if (style && accent) {
    // Carbon fascia across the dash's face with a stitched lip and two round vents, a screen on the dash, and a
    // low tunnel between the seats with the start button under a red flap.
    const face = gz + 0.012;
    add(new THREE.Mesh(new THREE.BoxGeometry(halfBase * 2 - 0.04, 0.11, 0.02), carbon)).position.set(0, dashTop - 0.075, face - 0.01);
    add(new THREE.Mesh(new THREE.BoxGeometry(halfBase * 2 - 0.06, 0.006, 0.006), accent)).position.set(0, dashTop - 0.012, face);
    for (const x of [-halfBase + 0.16, -0.16]) {
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 8, 24), metal));
      ring.position.set(x, dashTop - 0.075, face + 0.004);
      const vent = add(new THREE.Mesh(new THREE.CircleGeometry(0.033, 20), MAT.hole));
      vent.position.set(x, dashTop - 0.075, face + 0.002);
    }
    const scr = screenTexture(style.accent);
    own.push(scr);
    const screen = new THREE.Group();
    screen.position.set(-0.06, dashTop + 0.035, gz - 0.1);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.075), mat(new THREE.MeshBasicMaterial({ map: scr })));
    panel.position.z = 0.007;
    screen.add(new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.09, 0.012), carbon), panel);
    faceEye(screen);
    inner.add(screen);
    const tEnd = gz + 0.22;
    const tunnel = add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, tEnd - gz), dash));
    tunnel.position.set(0, lid + 0.005, (gz + tEnd) / 2);
    const flap = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.04), accent));
    flap.position.set(0, lid + 0.03, gz + 0.07);
    flap.rotation.x = -0.4;
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
      setNeedles(needles, spec, rpm, kmh);
      if (leds.length) shiftLights(leds, rpm / spec.redline);
    },
    dispose() {
      root.removeFromParent();
      for (const x of own) x.dispose();
    },
  };
}
