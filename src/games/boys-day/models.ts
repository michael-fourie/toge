// The cartoon models, all procedural: the bus, the boys (beans with paintball markers), the zombie horde (instanced,
// so 90 of them are a handful of draw calls), paintballs and splats, and your marker in first person.

import * as THREE from 'three';
import type { ZView } from './director.ts';
import { HANG, BUS, DRIVER, WALK, ZOMBIE } from './rules.ts';

/** Paint colours: one per seat-order player, then Gordie's. */
export const PAINT = ['#ff3d7f', '#2fd3ff', '#ffd23f', '#7cff5b', '#b06bff', '#ff8a2a', '#ffffff', '#00e0b0', '#ff2020'];
export const paintOf = (n: number) => PAINT[((n % PAINT.length) + PAINT.length) % PAINT.length];

let gradient: THREE.DataTexture | null = null;
/** Three-band toon shading: the cartoon look. */
export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
}

/** A canvas texture with words on it (signs). */
export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128, font = 'bold 64px system-ui, sans-serif') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  let size = parseInt(font.match(/(\d+)px/)?.[1] ?? '64');
  while (g.measureText(text).width > w - 40 && size > 12) g.font = font.replace(/\d+px/, `${(size -= 4)}px`);
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

// ---------------------------------------------------------------------------------------------
// The bus: a battered city bus you ride in and on. Walls are thin boxes round open windows, so it reads from inside and
// out: the driver sees through the windscreen, everyone else walks about inside or climbs the ladder through the
// roof hatch onto the railed deck up top. Its origin is
// on the ground under its middle; it faces -Z. The steering wheel is named 'steer' (it turns with the wheels).

export function makeBus(): THREE.Group {
  const g = new THREE.Group();
  const paint = toon('#f2a516');
  const trim = toon('#2a2d3a');
  const rust = toon('#9b4a1c');
  const white = toon('#f4efe6');
  const inside = toon('#c9cbd6');
  const L = BUS.length;
  const W = BUS.width;
  const { floor, sill, lintel, top } = BUS;
  const wall = 0.08;
  const half = W / 2 - wall / 2;
  // Floor and roof (in two halves round the hatch), the deck's planks and its railing.
  const hatch = WALK.hatch;
  const hz = -hatch.along;
  const hs = 0.55;
  g.add(box(W, 0.14, L, toon('#3a3a44'), 0, floor - 0.07, 0));
  const front0 = -L / 2;
  const back0 = L / 2;
  g.add(box(W, 0.14, hz - hs - front0, paint, 0, top + 0.07, (front0 + hz - hs) / 2));
  g.add(box(W, 0.14, back0 - (hz + hs), paint, 0, top + 0.07, (back0 + hz + hs) / 2));
  for (const s of [-1, 1]) g.add(box(W / 2 - hs, 0.14, hs * 2, paint, s * (hs + (W / 2 - hs) / 2), top + 0.07, hz));
  const plank = toon('#8a6a45');
  for (let z = -L / 2 + 0.6; z < L / 2 - 0.3; z += 0.9) if (Math.abs(z - hz) > hs + 0.3) g.add(box(W - 0.4, 0.02, 0.7, plank, 0, BUS.deck + 0.005, z));
  const rail = toon('#c9ccd6');
  for (const s of [-1, 1]) g.add(box(0.06, 0.06, L - 0.4, rail, s * (W / 2 - 0.12), BUS.deck + 0.95, 0));
  g.add(box(W - 0.24, 0.06, 0.06, rail, 0, BUS.deck + 0.95, L / 2 - 0.2));
  g.add(box(W - 0.24, 0.06, 0.06, rail, 0, BUS.deck + 0.95, -L / 2 + 0.2));
  for (let z = -L / 2 + 0.2; z <= L / 2 - 0.2; z += 1.75)
    for (const s of [-1, 1]) g.add(box(0.06, 0.95, 0.06, rail, s * (W / 2 - 0.12), BUS.deck + 0.47, z));
  // The hatch's rim, and the ladder up to it.
  const hatchRim = toon('#2a2d3a');
  for (const s of [-1, 1]) {
    g.add(box(hs * 2 + 0.1, 0.12, 0.08, hatchRim, 0, BUS.deck + 0.06, hz + s * hs));
    g.add(box(0.08, 0.12, hs * 2, hatchRim, s * hs, BUS.deck + 0.06, hz));
  }
  const rung = toon('#c9ccd6');
  for (const s of [-1, 1]) g.add(box(0.05, top - floor + 0.2, 0.05, rung, s * 0.25, (floor + top) / 2 + 0.1, hz + hs - 0.1));
  for (let y = floor + 0.3; y < top; y += 0.32) g.add(box(0.5, 0.04, 0.04, rung, 0, y, hz + hs - 0.1));
  g.add(box(W - 0.2, 0.02, L - 0.4, inside, 0, top - 0.01, 0)); // the ceiling
  // Below the windows: the body, the black skirt and the white stripe outside, panelling inside.
  g.add(box(W, floor - 0.35, L, trim, 0, 0.35 + (floor - 0.35) / 2, 0));
  for (const s of [-1, 1]) {
    g.add(box(wall, sill - floor, L, paint, s * half, (floor + sill) / 2, 0));
    g.add(box(0.02, 0.16, L + 0.02, white, s * (W / 2 + 0.01), sill - 0.25, 0));
    g.add(box(wall, top - lintel, L, paint, s * half, (lintel + top) / 2, 0)); // above the windows
  }
  // Window pillars down both sides (the gaps between are open: no glass left).
  const panes = 6;
  for (let k = 0; k <= panes; k++) {
    const z = -L / 2 + 0.2 + (k * (L - 0.4)) / panes;
    for (const s of [-1, 1]) g.add(box(wall + 0.02, lintel - sill, 0.16, paint, s * half, (sill + lintel) / 2, z));
  }
  // The front: a low dash wall, the windscreen (the only glass left), corner pillars and the destination sign.
  const front = -L / 2 + wall / 2;
  g.add(box(W, 1.5 - floor, wall, paint, 0, (floor + 1.5) / 2, front));
  g.add(box(W, top - lintel, wall, paint, 0, (lintel + top) / 2, front));
  for (const s of [-1, 1]) g.add(box(0.14, lintel - 1.5, wall, paint, s * (W / 2 - 0.07), (1.5 + lintel) / 2, front));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.28, lintel - 1.5), new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  glass.position.set(0, (1.5 + lintel) / 2, front - 0.01);
  g.add(glass);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, top - lintel - 0.04), new THREE.MeshBasicMaterial({ map: signTexture('BOYS DAY ★ NOT IN SERVICE', '#111', '#ffb000', 512, 64) }));
  sign.position.set(0, (lintel + top) / 2, front - wall / 2 - 0.01);
  sign.rotation.y = Math.PI;
  g.add(sign);
  // The back: a wall below the rear window, pillars, a band above.
  const back = L / 2 - wall / 2;
  g.add(box(W, sill - floor, wall, paint, 0, (floor + sill) / 2, back));
  g.add(box(W, top - lintel, wall, paint, 0, (lintel + top) / 2, back));
  for (const s of [-1, 1]) g.add(box(0.4, lintel - sill, wall, paint, s * (W / 2 - 0.2), (sill + lintel) / 2, back));
  // The cab: dashboard, gauges and the wheel.
  const cab = DRIVER;
  const dash = box(W - 0.2, 0.32, 0.6, toon('#2c2f3a'), 0, 1.36, -L / 2 + 0.4);
  g.add(dash);
  const wheel = new THREE.Group();
  wheel.name = 'steer';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 20), toon('#1b1b1f'));
  const spoke = box(0.34, 0.035, 0.025, toon('#1b1b1f'));
  wheel.add(rim, spoke);
  wheel.position.set(cab.side, floor + 0.6, -cab.along - 0.75);
  wheel.rotation.x = -0.9;
  g.add(wheel);
  const driverSeat = toon('#3a4c8a');
  g.add(box(0.55, 0.12, 0.5, driverSeat, cab.side, floor + 0.42, -cab.along + 0.1));
  g.add(box(0.55, 0.65, 0.1, driverSeat, cab.side, floor + 0.75, -cab.along + 0.38));
  // The cabin: bench seats along both sides (between the window spots, so nobody's view is a bench back), grab
  // poles, a ceiling light strip.
  const bench = toon('#3a5aa8');
  for (const along of [1.55, -0.55, -2.75])
    for (const s of [-1, 1]) {
      const z = -along;
      g.add(box(0.75, 0.14, 0.9, bench, s * (W / 2 - 0.5), floor + 0.42, z));
      g.add(box(0.12, 0.5, 0.9, bench, s * (W / 2 - 0.16), floor + 0.7, z));
    }
  const pole = toon('#ffd23f');
  for (const z of [-3.5, -1.0, 1.5, 3.4]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, top - floor, 6), pole);
    p.position.set(0.25, (floor + top) / 2, z);
    g.add(p);
  }
  g.add(box(0.12, 0.03, L - 1.5, new THREE.MeshBasicMaterial({ color: '#a8c0d0' }), 0, top - 0.03, 0));
  // Headlights (real ones: it's night out there) and a cow-catcher of plywood (the apocalypse upgrade). Added once
  // with the bus, never mid-run: adding a light recompiles every lit shader.
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff8d0' });
  for (const s of [-1, 1]) g.add(box(0.4, 0.25, 0.06, lamp, s * 0.85, 1.05, -L / 2 - 0.04));
  const beam = new THREE.SpotLight('#fff1c8', 160, 70, 0.5, 0.6, 1.2);
  // Just ahead of the cow-catcher, so it lights the road and not the plywood right under it.
  beam.position.set(0, 1.4, -L / 2 - 0.8);
  beam.target.position.set(0, 0, -L / 2 - 25);
  g.add(beam, beam.target);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#fff1c8', transparent: true, opacity: 0.07, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.scale.set(3.2, 9, 1);
  glow.position.set(0, 0.07, -L / 2 - 9);
  g.add(glow);
  // The cabin light, so you can see your friends.
  const cabin = new THREE.PointLight('#ffe2b0', 2.5, 8, 2);
  cabin.position.set(0, top - 0.4, 0);
  g.add(cabin);
  // Hanging out: the bong and the cooler on the back shelf, the card table by a bench.
  {
    const glass = toon('#58d0ff', { transparent: true, opacity: 0.75, emissive: '#1a6a8a', emissiveIntensity: 0.6 });
    const b = HANG.bong;
    g.add(box(0.5, 0.06, 0.5, toon('#5a4030'), b.side, floor + 0.6, -b.along - 0.5));
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glass);
    base.position.set(b.side, floor + 0.76, -b.along - 0.5);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 10), glass);
    neck.position.set(b.side, floor + 1.08, -b.along - 0.5);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), glass);
    stem.position.set(b.side - 0.12, floor + 0.88, -b.along - 0.5);
    stem.rotation.z = 0.9;
    g.add(base, neck, stem);
    const c = HANG.cooler;
    g.add(box(0.6, 0.4, 0.42, toon('#2e86de'), c.side, floor + 0.2, -c.along - 0.5));
    g.add(box(0.62, 0.08, 0.44, toon('#f4f4f4'), c.side, floor + 0.44, -c.along - 0.5));
    for (const k of [-1, 0, 1]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 8), toon('#e8c23a'));
      can.position.set(c.side + k * 0.12, floor + 0.55, -c.along - 0.5);
      g.add(can);
    }
    const t = HANG.table;
    g.add(box(0.62, 0.05, 0.9, toon('#1f6b3a'), t.side + 0.25, floor + 0.78, -t.along));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.78, 8), toon('#3a3a44'));
    leg.position.set(t.side + 0.25, floor + 0.39, -t.along);
    g.add(leg);
    for (const [dx, dz, col] of [[0.18, -0.2, '#ff3d3d'], [0.32, 0.1, '#ffffff'], [0.2, 0.25, '#2fd3ff']] as const) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), toon(col));
      chip.position.set(t.side + dx, floor + 0.83, -t.along + dz);
      g.add(chip);
    }
    g.add(box(0.1, 0.006, 0.14, toon('#ffffff'), t.side + 0.3, floor + 0.81, -t.along - 0.2));
  }
  const ram = box(W + 0.3, 0.7, 0.25, toon('#b98a52'), 0, 0.6, -L / 2 - 0.35);
  ram.rotation.x = -0.35;
  g.add(ram);
  // Rust patches, for character.
  for (const [x, y, z] of [[W / 2 + 0.01, 1.2, 1.8], [-W / 2 - 0.01, 1.4, -2.6], [W / 2 + 0.01, 1.3, -4.1]]) g.add(box(0.03, 0.4, 0.7, rust, x, y, z));
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyre = toon('#1b1b1f');
  for (const z of [-L / 2 + 2, L / 2 - 2.2])
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(s * (W / 2 - 0.05), 0.55, z);
      w.name = 'wheel';
      g.add(w);
    }
  return g;
}

// ---------------------------------------------------------------------------------------------
// The boys: chibi beans with a face, a toque, and a paintball marker. Origin at their feet.

export interface Bean {
  root: THREE.Group;
  /** Turns with the aim (yaw); the gun tilts with pitch. */
  aim: THREE.Group;
  gun: THREE.Group;
  /** The jerry can they're lugging (shown instead of the gun). */
  can: THREE.Mesh;
}

export function makeBean(color: string, driver = false): Bean {
  const root = new THREE.Group();
  const aim = new THREE.Group();
  root.add(aim);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 10), toon(color));
  body.position.y = 0.6;
  aim.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), toon('#ffd7b0'));
  head.position.y = 1.25;
  aim.add(head);
  const eye = toon('#151515');
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eye);
    e.position.set(s * 0.12, 1.3, -0.3);
    aim.add(e);
  }
  // A toque in their colour, with a pompom.
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(color));
  hat.position.y = 1.33;
  aim.add(hat);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), toon('#ffffff'));
  pom.position.y = 1.7;
  aim.add(pom);
  const gun = makeMarker(color);
  gun.position.set(0.28, 0.85, -0.3);
  gun.scale.setScalar(0.8);
  if (!driver) aim.add(gun);
  const can = box(0.4, 0.5, 0.24, toon('#d8261c'), 0, 0.75, -0.42);
  can.visible = false;
  aim.add(can);
  return { root, aim, gun, can };
}

/** A paintball marker: body, barrel, a hopper on top. Points down -Z. */
export function makeMarker(color: string): THREE.Group {
  const g = new THREE.Group();
  const dark = toon('#26272e');
  g.add(box(0.12, 0.16, 0.42, dark, 0, 0, 0));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.43);
  g.add(barrel);
  const hopper = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), toon(color, { transparent: true, opacity: 0.85 }));
  hopper.scale.set(1, 1.15, 1.3);
  hopper.position.set(0, 0.2, 0.02);
  g.add(hopper);
  const grip = box(0.08, 0.18, 0.08, dark, 0, -0.15, 0.1);
  grip.rotation.x = 0.3;
  g.add(grip);
  return g;
}

/** Each gun in your hands: the marker, rebuilt a little (GUNS' order). */
export function makeGun(k: number, color: string): THREE.Group {
  const g = makeMarker(color);
  const dark = toon('#26272e');
  if (k === 1) {
    // Shotty: two fat barrels and a pump.
    for (const x of [-0.045, 0.045]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8), dark);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, 0.03, -0.45);
      g.add(b);
    }
    g.add(box(0.16, 0.08, 0.2, toon('#8a5a2a'), 0, -0.05, -0.4));
  } else if (k === 2) {
    // Minigun: a ring of barrels and a drum.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), dark);
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * 0.07, 0.03 + Math.sin(a) * 0.07, -0.55);
      g.add(b);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 14), toon(color, { transparent: true, opacity: 0.85 }));
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.12, 0);
    g.add(drum);
  } else if (k === 3) {
    // Long Tom: a long barrel and a scope.
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), dark);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.03, -0.75);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 10), toon('#3a3d4a'));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.36, -0.05);
    g.add(b, scope);
  } else if (k === 4) {
    // Balloon launcher: a wide tube with a balloon in its mouth.
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.6, 12), toon('#3a5a8a'));
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.03, -0.45);
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), toon(color));
    balloon.position.set(0, 0.03, -0.78);
    g.add(tube, balloon);
  }
  return g;
}

/** A golf club (your prize from the range), held in first person when you swing. */
export function makeClub(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 6), toon('#c8ccd4'));
  shaft.position.y = -0.55;
  g.add(shaft);
  const headM = box(0.08, 0.1, 0.22, toon('#9aa3b3'), 0, -1.1, -0.06);
  g.add(headM);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), toon('#202020'));
  grip.position.y = -0.05;
  g.add(grip);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The horde: one InstancedMesh per body part.

const SKIN = ['#7fb069', '#9cc47a', '#6a9a5a'];
const SHIRTS = ['#6d5f8a', '#8a5f5f', '#5f7a8a', '#8a805f', '#4f6a4f', '#a0663a'];

export class Horde {
  readonly group = new THREE.Group();
  private parts: Record<'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'eyes' | 'xx', THREE.InstancedMesh>;
  private dummy = new THREE.Object3D();
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private base = new THREE.Matrix4();
  /** Smoothed positions per zombie id (snapshots arrive 10 times a second). */
  private shown = new Map<number, { x: number; y: number; z: number; yaw: number; spin: number }>();

  constructor(private cap = 120) {
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };
    const white = toon('#ffffff');
    const body = new THREE.CapsuleGeometry(0.3, 0.55, 3, 8);
    const head = new THREE.SphereGeometry(0.3, 10, 8);
    const limb = new THREE.BoxGeometry(0.14, 0.6, 0.14);
    limb.translate(0, -0.27, 0); // pivot at the shoulder / hip
    // Eyes, as one flat strip in front of the face: glowing while they're up, X_X once they're down.
    const eyes = new THREE.PlaneGeometry(0.34, 0.12);
    eyes.rotateY(Math.PI); // face out of the front (-Z)
    eyes.translate(0, 0.05, -0.29);
    this.parts = {
      body: mk(body, white),
      head: mk(head, white),
      armL: mk(limb, white),
      armR: mk(limb, white),
      legL: mk(limb, toon('#3b3b48')),
      legR: mk(limb, toon('#3b3b48')),
      eyes: mk(eyes, new THREE.MeshBasicMaterial({ map: glowEyesTexture(), transparent: true, fog: false })),
      xx: mk(eyes.clone(), new THREE.MeshBasicMaterial({ map: eyesTexture(), transparent: true })),
    };
  }

  /** Lays out every zombie for this frame, standing on the ground. `t` is the clock, for the shamble. */
  update(zs: readonly ZView[], dt: number, t: number, ground: (x: number, z: number) => number) {
    const keep = new Set<number>();
    let n = 0;
    for (const z of zs) {
      if (n >= this.cap) break;
      keep.add(z.id);
      let s = this.shown.get(z.id);
      if (!s) {
        s = { x: z.x, y: z.y, z: z.z, yaw: 0, spin: 0 };
        this.shown.set(z.id, s);
      }
      const k = Math.min(1, dt * (z.st === 'climb' ? 20 : 10));
      const dx = z.x - s.x;
      const dz = z.z - s.z;
      if (Math.hypot(dx, dz) > 12) Object.assign(s, { x: z.x, z: z.z });
      else {
        s.x += dx * k;
        s.z += dz * k;
      }
      s.y += (z.y - s.y) * k;
      if (Math.hypot(dx, dz) > 0.05 && z.st === 'run') s.yaw = Math.atan2(-dx, -dz);
      s.spin = z.st === 'fly' ? s.spin + dt * 14 : 0;
      this.pose(n++, z, s, t, ground(s.x, s.z));
    }
    for (const id of this.shown.keys()) if (!keep.has(id)) this.shown.delete(id);
    for (const im of Object.values(this.parts)) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private pose(i: number, z: ZView, s: { x: number; y: number; z: number; yaw: number; spin: number }, t: number, gy: number) {
    const spec = ZOMBIE[z.k];
    const scale = z.k === 2 ? 1.45 : z.k === 1 ? 0.92 : 1;
    const d = this.dummy;
    d.position.set(s.x, gy + s.y, s.z);
    d.rotation.set(0, s.yaw, 0);
    d.scale.setScalar(scale);
    if (z.st === 'fly') d.rotation.set(s.spin, s.yaw, s.spin * 0.6);
    if (z.st === 'dead') d.rotation.set(-Math.PI / 2, s.yaw, 0);
    d.updateMatrix();
    this.base.copy(d.matrix);
    const phase = t * (spec.speed * 1.6) + z.id;
    const walk = z.st === 'run' ? Math.sin(phase) : 0;
    const lurch = z.st === 'run' ? 0.12 : 0;
    // Each part: offset in the zombie's own frame, and a swing about X.
    const part = (im: THREE.InstancedMesh, x: number, y: number, zz: number, rx: number, rz = 0, s = 1) => {
      d.position.set(x, y, zz);
      d.rotation.set(rx, 0, rz);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.m.multiplyMatrices(this.base, d.matrix);
      im.setMatrixAt(i, this.m);
    };
    const climbing = z.st === 'climb';
    part(this.parts.body, 0, 0.95, 0, lurch);
    part(this.parts.head, 0, 1.6 + Math.sin(phase * 0.5) * 0.03, -0.08, 0, Math.sin(phase * 0.5) * 0.2);
    const down = z.st === 'dead' || z.st === 'fly';
    part(this.parts.eyes, 0, 1.6 + Math.sin(phase * 0.5) * 0.03, -0.08, 0, Math.sin(phase * 0.5) * 0.2, down ? 0 : 1);
    part(this.parts.xx, 0, 1.6, -0.08, 0, 0, down ? 1 : 0);
    // Arms out front (the classic), up when climbing.
    const arm = climbing ? -2.6 + Math.sin(t * 9 + z.id) * 0.3 : -1.45 + walk * 0.15;
    part(this.parts.armL, -0.36, 1.35, 0, arm);
    part(this.parts.armR, 0.36, 1.35, 0, arm + 0.1);
    part(this.parts.legL, -0.14, 0.62, 0, walk * 0.7);
    part(this.parts.legR, 0.14, 0.62, 0, -walk * 0.7);
    const skin = this.c.set(SKIN[z.id % SKIN.length]);
    this.parts.head.setColorAt(i, skin);
    this.parts.armL.setColorAt(i, skin);
    this.parts.armR.setColorAt(i, skin);
    this.c.set(SHIRTS[z.id % SHIRTS.length]);
    if (z.paint >= 0) this.c.lerp(new THREE.Color(paintOf(z.paint)), 0.75);
    if (z.k === 2) this.c.offsetHSL(0, 0, -0.05);
    this.parts.body.setColorAt(i, this.c);
    this.parts.legL.setColorAt(i, this.c.set('#3b3b48'));
    this.parts.legR.setColorAt(i, this.c);
    this.parts.eyes.setColorAt(i, this.c.set(z.k === 1 ? '#ff5050' : z.k === 2 ? '#ffb030' : '#c8ff5a'));
    this.parts.xx.setColorAt(i, this.c.set('#ffffff'));
  }

  /** Where zombie `id` is drawn right now (for hits, which use what you see). */
  at(id: number) {
    return this.shown.get(id);
  }

  dispose() {
    for (const im of Object.values(this.parts)) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}

/** Two glowing slits (tinted per kind: green shamblers, red sprinters, amber chonks). */
function glowEyesTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  for (const cx of [34, 94]) {
    const r = g.createRadialGradient(cx, 24, 2, cx, 24, 22);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.beginPath();
    g.ellipse(cx, 24, 22, 14, 0, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function eyesTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#111';
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (const cx of [34, 94]) {
    g.beginPath();
    g.moveTo(cx - 14, 10);
    g.lineTo(cx + 14, 38);
    g.moveTo(cx + 14, 10);
    g.lineTo(cx - 14, 38);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Paintballs in flight, and splats where they land.

interface Ball {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  c: number;
  /** Mine: tested against zombies and pickups. */
  mine: boolean;
  /** How hard gravity pulls it (1: a paintball), how big it's drawn, and what fired it (a GUNS index; -1: a grenade). */
  g: number;
  size: number;
  k: number;
}
export type { Ball };

export class Paint {
  readonly group = new THREE.Group();
  readonly balls: Ball[] = [];
  private ballMesh: THREE.InstancedMesh;
  private splatMesh: THREE.InstancedMesh;
  private splats: { x: number; y: number; z: number; c: number; age: number; r: number; nx: number; nz: number; up: boolean }[] = [];
  private d = new THREE.Object3D();
  private col = new THREE.Color();

  constructor() {
    this.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial(), 400);
    this.ballMesh.frustumCulled = false;
    this.ballMesh.count = 0;
    const splat = new THREE.CircleGeometry(1, 12);
    // A wobbly edge, so splats read as paint.
    const pos = splat.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const k = 0.75 + ((i * 7919) % 13) / 30;
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
    }
    this.splatMesh = new THREE.InstancedMesh(splat, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 300);
    this.splatMesh.frustumCulled = false;
    this.splatMesh.count = 0;
    this.group.add(this.ballMesh, this.splatMesh);
  }

  fire(p: THREE.Vector3, v: THREE.Vector3, c: number, mine: boolean, life: number, g = 1, size = 1, k = 0) {
    if (this.balls.length > 380) this.balls.shift();
    this.balls.push({ p: p.clone(), v: v.clone(), life, c, mine, g, size, k });
  }

  /** A splat on the ground (`up`) or a burst in the air (a hit). */
  splat(x: number, y: number, z: number, c: number, up = true, r = 0.5) {
    if (this.splats.length >= 300) this.splats.shift();
    this.splats.push({ x, y, z, c, age: 0, r, nx: Math.random() * 6.28, nz: 0, up });
  }

  /**
   * Moves the balls; `test` is asked about each of mine and returns true when it hit something; `land` is told when
   * one of mine comes down on the ground (a grenade or a balloon bursts there).
   */
  update(dt: number, gravity: number, test: (b: Ball, from: THREE.Vector3) => boolean, ground: (x: number, z: number) => number, land?: (b: Ball) => void) {
    const from = new THREE.Vector3();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      from.copy(b.p);
      b.v.y -= gravity * b.g * dt;
      b.p.addScaledVector(b.v, dt);
      b.life -= dt;
      let gone = b.life <= 0;
      if (!gone && b.mine && test(b, from)) gone = true;
      const gy = gone ? 0 : ground(b.p.x, b.p.z);
      if (!gone && b.p.y <= gy + 0.02) {
        this.splat(b.p.x, gy + 0.05, b.p.z, b.c, true, 0.45 + Math.random() * 0.3);
        if (b.mine) land?.(b);
        gone = true;
      }
      if (gone) this.balls.splice(i, 1);
    }
    const d = this.d;
    this.ballMesh.count = this.balls.length;
    this.balls.forEach((b, i) => {
      d.position.copy(b.p);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(b.size);
      d.updateMatrix();
      this.ballMesh.setMatrixAt(i, d.matrix);
      this.ballMesh.setColorAt(i, this.col.set(paintOf(b.c)));
    });
    this.ballMesh.instanceMatrix.needsUpdate = true;
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
    // Ground splats stay a while; bursts in the air pop and fade fast.
    this.splats = this.splats.filter((s) => (s.age += dt) < (s.up ? 40 : 0.35));
    this.splatMesh.count = this.splats.length;
    this.splats.forEach((s, i) => {
      d.position.set(s.x, s.y, s.z);
      if (s.up) {
        d.rotation.set(-Math.PI / 2, 0, s.nx);
        d.scale.setScalar(s.r * Math.min(1, s.age * 12));
      } else {
        d.rotation.set(0, s.nx, 0);
        d.lookAt(d.position.x + Math.sin(s.nx), d.position.y, d.position.z + Math.cos(s.nx));
        d.scale.setScalar(s.r * (0.4 + s.age * 3));
      }
      d.updateMatrix();
      this.splatMesh.setMatrixAt(i, d.matrix);
      this.splatMesh.setColorAt(i, this.col.set(paintOf(s.c)));
    });
    this.splatMesh.instanceMatrix.needsUpdate = true;
    if (this.splatMesh.instanceColor) this.splatMesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.ballMesh, this.splatMesh]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
