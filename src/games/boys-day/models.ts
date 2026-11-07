// The cartoon models, all procedural: the bus, the boys (beans with paintball markers), the zombie horde (instanced,
// so 90 of them are a handful of draw calls), paintballs and splats, and your marker in first person.

import * as THREE from 'three';
import type { ZView } from './director.ts';
import { BUS, SEATS, ZOMBIE } from './rules.ts';

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
// The bus: a battered city bus with a roof deck. Its origin is on the ground under its middle; it faces -Z.

export function makeBus(): THREE.Group {
  const g = new THREE.Group();
  const paint = toon('#f2a516');
  const trim = toon('#2a2d3a');
  const glass = toon('#7fc8e8', { emissive: '#163444' });
  const rust = toon('#9b4a1c');
  const white = toon('#f4efe6');
  const L = BUS.length;
  const W = BUS.width;
  // Body, with a black skirt and a white stripe.
  g.add(box(W, 2.2, L, paint, 0, 1.75, 0));
  g.add(box(W + 0.04, 0.5, L + 0.04, trim, 0, 0.75, 0));
  g.add(box(W + 0.06, 0.18, L + 0.06, white, 0, 1.55, 0));
  // Windows down both sides and the windscreen.
  for (const side of [-1, 1])
    for (let k = 0; k < 5; k++) g.add(box(0.06, 0.8, 1.6, glass, (side * W) / 2, 2.25, -L / 2 + 2.6 + k * 1.85));
  g.add(box(W - 0.3, 1.0, 0.06, glass, 0, 2.2, -L / 2 - 0.02));
  g.add(box(W - 0.6, 0.7, 0.06, glass, 0, 2.3, L / 2 + 0.02));
  // The destination sign.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, 0.42), new THREE.MeshBasicMaterial({ map: signTexture('BOYS DAY ★ NOT IN SERVICE', '#111', '#ffb000', 512, 80) }));
  sign.position.set(0, 2.68, -L / 2 - 0.04);
  sign.rotation.y = Math.PI;
  g.add(sign);
  // Lights and a cow-catcher of plywood (the apocalypse upgrade).
  const lamp = toon('#fff6c0', { emissive: '#fff2a0', emissiveIntensity: 0.8 });
  for (const s of [-1, 1]) g.add(box(0.4, 0.25, 0.06, lamp, s * 0.85, 1.05, -L / 2 - 0.04));
  const ram = box(W + 0.3, 0.7, 0.25, toon('#b98a52'), 0, 0.6, -L / 2 - 0.35);
  ram.rotation.x = -0.35;
  g.add(ram);
  // Rust patches, for character.
  for (const [x, y, z] of [[W / 2 + 0.01, 1.2, 1.8], [-W / 2 - 0.01, 1.4, -2.6], [W / 2 + 0.01, 1.9, -4.1]]) g.add(box(0.03, 0.4, 0.7, rust, x, y, z));
  // Wheels.
  const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  wheel.rotateZ(Math.PI / 2);
  const tyre = toon('#1b1b1f');
  for (const z of [-L / 2 + 2, L / 2 - 2.2])
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wheel, tyre);
      w.position.set(s * (W / 2 - 0.05), 0.55, z);
      w.name = 'wheel';
      g.add(w);
    }
  // The roof deck: planks and a railing round it for the boys to hold.
  g.add(box(W - 0.1, 0.12, L - 0.4, toon('#8a6a45'), 0, BUS.roof - 0.42, 0));
  const rail = toon('#c9ccd6');
  for (const s of [-1, 1]) g.add(box(0.06, 0.06, L - 0.6, rail, (s * (W - 0.2)) / 2, BUS.roof + 0.45, 0));
  g.add(box(W - 0.2, 0.06, 0.06, rail, 0, BUS.roof + 0.45, L / 2 - 0.3));
  for (let z = -L / 2 + 0.4; z <= L / 2 - 0.3; z += 1.7)
    for (const s of [-1, 1]) g.add(box(0.06, 0.85, 0.06, rail, (s * (W - 0.2)) / 2, BUS.roof + 0.05, z));
  // A couch strapped on the back of the roof, because of course.
  const couch = toon('#3a4c8a');
  g.add(box(1.9, 0.35, 0.8, couch, 0, BUS.roof - 0.2, L / 2 - 0.9));
  g.add(box(1.9, 0.5, 0.2, couch, 0, BUS.roof + 0.1, L / 2 - 0.4));
  return g;
}

// ---------------------------------------------------------------------------------------------
// The boys: chibi beans with a face, a toque, and a paintball marker. Origin at their feet.

export interface Bean {
  root: THREE.Group;
  /** Turns with the aim (yaw); the gun tilts with pitch. */
  aim: THREE.Group;
  gun: THREE.Group;
  label: THREE.Sprite | null;
}

export function makeBean(color: string, name: string | null, driver = false): Bean {
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
  let label: THREE.Sprite | null = null;
  if (name) {
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(name, 'rgba(0,0,0,0.55)', '#ffffff', 256, 64, 'bold 40px system-ui, sans-serif'), depthTest: false }));
    label.scale.set(1.4, 0.35, 1);
    label.position.y = 2.1;
    label.renderOrder = 10;
    root.add(label);
  }
  return { root, aim, gun, label };
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

/** Where a seat is in the world: the bus pose plus the seat's spot (the driver sits inside). */
export function seatPos(busRoot: THREE.Object3D, seat: number, out = new THREE.Vector3()) {
  const s = SEATS[seat] ?? SEATS[1];
  out.set(s.side, seat === 0 ? 1.0 : BUS.roof - 0.36, -s.along);
  return busRoot.localToWorld(out);
}

// ---------------------------------------------------------------------------------------------
// The horde: one InstancedMesh per body part.

const SKIN = ['#7fb069', '#9cc47a', '#6a9a5a'];
const SHIRTS = ['#6d5f8a', '#8a5f5f', '#5f7a8a', '#8a805f', '#4f6a4f', '#a0663a'];

export class Horde {
  readonly group = new THREE.Group();
  private parts: Record<'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'eyes', THREE.InstancedMesh>;
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
    // X_X eyes: two little crosses, as one flat strip in front of the face.
    const eyes = new THREE.PlaneGeometry(0.34, 0.12);
    eyes.translate(0, 0.05, -0.29);
    this.parts = {
      body: mk(body, white),
      head: mk(head, white),
      armL: mk(limb, white),
      armR: mk(limb, white),
      legL: mk(limb, toon('#3b3b48')),
      legR: mk(limb, toon('#3b3b48')),
      eyes: mk(eyes, new THREE.MeshBasicMaterial({ map: eyesTexture(), transparent: true })),
    };
  }

  /** Lays out every zombie for this frame. `t` is the clock, for the shamble. */
  update(zs: readonly ZView[], dt: number, t: number) {
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
      this.pose(n++, z, s, t);
    }
    for (const id of this.shown.keys()) if (!keep.has(id)) this.shown.delete(id);
    for (const im of Object.values(this.parts)) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private pose(i: number, z: ZView, s: { x: number; y: number; z: number; yaw: number; spin: number }, t: number) {
    const spec = ZOMBIE[z.k];
    const scale = z.k === 2 ? 1.45 : z.k === 1 ? 0.92 : 1;
    const d = this.dummy;
    d.position.set(s.x, s.y, s.z);
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
    const part = (im: THREE.InstancedMesh, x: number, y: number, zz: number, rx: number, rz = 0) => {
      d.position.set(x, y, zz);
      d.rotation.set(rx, 0, rz);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.m.multiplyMatrices(this.base, d.matrix);
      im.setMatrixAt(i, this.m);
    };
    const climbing = z.st === 'climb';
    part(this.parts.body, 0, 0.95, 0, lurch);
    part(this.parts.head, 0, 1.6 + Math.sin(phase * 0.5) * 0.03, -0.08, 0, Math.sin(phase * 0.5) * 0.2);
    part(this.parts.eyes, 0, 1.6 + Math.sin(phase * 0.5) * 0.03, -0.08, 0, Math.sin(phase * 0.5) * 0.2);
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
    this.parts.eyes.setColorAt(i, this.c.set('#ffffff'));
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
}

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

  fire(p: THREE.Vector3, v: THREE.Vector3, c: number, mine: boolean, life: number) {
    if (this.balls.length > 380) this.balls.shift();
    this.balls.push({ p: p.clone(), v: v.clone(), life, c, mine });
  }

  /** A splat on the ground (`up`) or a burst in the air (a hit). */
  splat(x: number, y: number, z: number, c: number, up = true, r = 0.5) {
    if (this.splats.length >= 300) this.splats.shift();
    this.splats.push({ x, y, z, c, age: 0, r, nx: Math.random() * 6.28, nz: 0, up });
  }

  /** Moves the balls; `test` is asked about each of mine and returns true when it hit something. */
  update(dt: number, gravity: number, test: (b: Ball, from: THREE.Vector3) => boolean) {
    const from = new THREE.Vector3();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      from.copy(b.p);
      b.v.y -= gravity * dt;
      b.p.addScaledVector(b.v, dt);
      b.life -= dt;
      let gone = b.life <= 0;
      if (!gone && b.mine && test(b, from)) gone = true;
      if (!gone && b.p.y <= 0.02) {
        this.splat(b.p.x, 0.04, b.p.z, b.c, true, 0.45 + Math.random() * 0.3);
        gone = true;
      }
      if (gone) this.balls.splice(i, 1);
    }
    const d = this.d;
    this.ballMesh.count = this.balls.length;
    this.balls.forEach((b, i) => {
      d.position.copy(b.p);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
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
