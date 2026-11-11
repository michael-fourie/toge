// Other climbers: a jointed figure (built facing +Z: a negative x rotation swings a limb forward) in outdoor gear (shell jacket in the player's colour, dark trousers, boots, a
// beanie), posed procedurally from what their browser says they're doing: running, in the air, wall running,
// sliding, mantling. Their state arrives ~15 times a second; we draw them a little in the past and blend between
// snapshots so they move smoothly.

import * as THREE from 'three';
import { type Anim, ANIM } from './net.ts';

/** Jacket colours, one per seat. */
export const JACKETS = ['#d9472b', '#2b7bd9', '#e8b323', '#3fa65a', '#9b4fd1', '#e0753a', '#2bb3b3', '#d1497f', '#7a8b2e', '#5163d6', '#c2c2c2', '#b2442f'];
export const jacketOf = (seat: number) => JACKETS[((seat % JACKETS.length) + JACKETS.length) % JACKETS.length];

/** How far behind the newest snapshot we draw (s): a little latency for smooth motion. */
const DELAY = 0.12;

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: Anim;
  speed: number;
  wallSide: number;
}

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
}

const shared: { geos: Map<string, THREE.BufferGeometry>; count: number } = { geos: new Map(), count: 0 };
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = shared.geos.get(key);
  if (!g) {
    g = make();
    shared.geos.set(key, g);
  }
  return g;
}

export class Climber {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private snaps: Snap[] = [];
  private phase = 0;
  private mats: THREE.Material[] = [];
  private tag: THREE.Sprite;
  private tagTex: THREE.CanvasTexture;
  /** Smoothed pose values. */
  private lean = 0;
  private roll = 0;
  private crouch = 0;
  private clock = 0;
  pos = new THREE.Vector3();
  name: string;

  constructor(name: string, seat: number, shadows: boolean) {
    this.name = name;
    shared.count++;
    const jacket = this.mat(new THREE.MeshStandardMaterial({ color: jacketOf(seat), roughness: 0.75 }));
    const trousers = this.mat(new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 }));
    const skin = this.mat(new THREE.MeshStandardMaterial({ color: 0xc89478, roughness: 0.7 }));
    const boots = this.mat(new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.8 }));
    const beanie = this.mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(jacketOf(seat + 5)).multiplyScalar(0.7), roughness: 0.95 }));
    const pack = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3f35, roughness: 0.85 }));
    const cap = (r: number, l: number) => geo(`c${r}-${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 10));
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, y = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.y = y;
      o.castShadow = shadows;
      return o;
    };

    // Hips at 0.95 m, the root at the feet.
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.root.add(this.body);
    this.hips.add(mesh(cap(0.16, 0.12), trousers, 0.02));
    this.chest.position.y = 0.1;
    this.hips.add(this.chest);
    const torso = mesh(cap(0.19, 0.32), jacket, 0.26);
    torso.scale.set(1.05, 1, 0.75);
    this.chest.add(torso);
    const bag = mesh(geo('pack', () => new THREE.BoxGeometry(0.3, 0.38, 0.16)), pack, 0.28);
    bag.position.z = -0.19;
    this.chest.add(bag);
    this.head.position.y = 0.58;
    this.chest.add(this.head);
    this.head.add(mesh(geo('neck', () => new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8)), skin, 0.02));
    const skull = mesh(geo('head', () => new THREE.SphereGeometry(0.115, 16, 12)), skin, 0.16);
    skull.scale.set(0.95, 1.08, 1);
    this.head.add(skull);
    const hat = mesh(geo('hat', () => new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), beanie, 0.19);
    this.head.add(hat);

    const limb = (parent: THREE.Object3D, x: number, y: number, r: number, l1: number, l2: number, m1: THREE.Material, m2: THREE.Material, end: THREE.Material | null): Limb => {
      const upper = new THREE.Group();
      upper.position.set(x, y, 0);
      parent.add(upper);
      const a = mesh(cap(r, l1), m1, -l1 / 2 - r * 0.3);
      upper.add(a);
      const lower = new THREE.Group();
      lower.position.y = -l1 - r * 0.4;
      upper.add(lower);
      lower.add(mesh(cap(r * 0.85, l2), m2, -l2 / 2 - r * 0.3));
      if (end) {
        const foot = mesh(geo('boot', () => new THREE.BoxGeometry(0.11, 0.09, 0.26)), end, -l2 - r * 0.9);
        foot.position.z = 0.05;
        lower.add(foot);
      }
      return { upper, lower };
    };
    this.arms.push(limb(this.chest, -0.25, 0.45, 0.055, 0.24, 0.22, jacket, jacket, skin));
    this.arms.push(limb(this.chest, 0.25, 0.45, 0.055, 0.24, 0.22, jacket, jacket, skin));
    this.legs.push(limb(this.hips, -0.1, -0.02, 0.075, 0.36, 0.36, trousers, trousers, boots));
    this.legs.push(limb(this.hips, 0.1, -0.02, 0.075, 0.36, 0.36, trousers, trousers, boots));
    // Hands: the arms' "boots" are skin blobs; shrink them.
    for (const a of this.arms) a.lower.children[1].scale.set(0.7, 0.9, 0.45);

    // Name tag.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '600 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,14,18,0.55)';
    const w = Math.min(250, g.measureText(name).width + 28);
    g.beginPath();
    g.roundRect(128 - w / 2, 10, w, 44, 22);
    g.fill();
    g.fillStyle = jacketOf(seat);
    g.fillRect(128 - w / 2 + 14, 29, 6, 6);
    g.fillStyle = '#fff';
    g.fillText(name.slice(0, 16), 132, 33);
    this.tagTex = new THREE.CanvasTexture(c);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true, fog: false }));
    this.tag.scale.set(1.6, 0.4, 1);
    this.tag.position.y = 2.25;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  /** A new state from the network (time `t` is our clock when it arrived). */
  push(t: number, x: number, y: number, z: number, yaw: number, anim: Anim, speed: number, wallSide: number) {
    const last = this.snaps[this.snaps.length - 1];
    // A jump of more than 12 m is a respawn: don't slide across the sky.
    if (last && Math.hypot(last.x - x, last.y - y, last.z - z) > 12) this.snaps.length = 0;
    this.snaps.push({ t, x, y, z, yaw, anim, speed, wallSide });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  get hasState() {
    return this.snaps.length > 0;
  }

  /** Poses and places the figure for time `now` (our clock). */
  update(now: number, dt: number, camera: THREE.Camera) {
    this.clock += dt;
    const s = this.snaps;
    if (!s.length) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const t = now - DELAY;
    let a = s[0];
    let b = s[0];
    for (let i = s.length - 1; i >= 0; i--)
      if (s[i].t <= t) {
        a = s[i];
        b = s[i + 1] ?? s[i];
        break;
      }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    this.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    // Past the newest snapshot (packet late): carry on a touch, don't freeze.
    this.root.position.copy(this.pos);
    let dyaw = b.yaw - a.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    // The figure is built facing +Z; yaw 0 looks down -Z.
    this.root.rotation.y = a.yaw + dyaw * k + Math.PI;
    const st = k < 0.5 ? a : b;
    this.pose(st.anim, a.speed + (b.speed - a.speed) * k, st.wallSide, dt);
    // Keep the tag a constant-ish size on screen.
    const d = camera.position.distanceTo(this.pos);
    const sc = Math.max(1, d / 12);
    this.tag.scale.set(1.6 * sc, 0.4 * sc, 1);
  }

  private pose(anim: Anim, speed: number, wallSide: number, dt: number) {
    const e = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dt * rate);
    const run = anim === ANIM.run || anim === ANIM.wall;
    if (run) this.phase += dt * (2.2 + speed * 0.95);
    const p = this.phase;
    const sw = Math.min(1, speed / 7);
    const slide = anim === ANIM.slide;
    const air = anim === ANIM.air;
    const mantle = anim === ANIM.mantle;
    const crouch = anim === ANIM.crouch;
    this.lean = e(this.lean, slide ? -0.75 : run ? 0.18 + sw * 0.18 : air ? 0.1 : mantle ? 0.45 : 0, 10);
    this.roll = e(this.roll, anim === ANIM.wall ? wallSide * 0.45 : 0, 8);
    this.crouch = e(this.crouch, slide ? 0.5 : crouch ? 0.35 : mantle ? 0.2 : 0, 10);
    this.body.rotation.set(this.lean * 0.5, 0, this.roll);
    this.hips.position.y = 0.95 - this.crouch;
    this.chest.rotation.x = this.lean * 0.3;
    const [la, ra] = this.arms;
    const [ll, rl] = this.legs;
    if (slide) {
      ll.upper.rotation.x = -1.35;
      ll.lower.rotation.x = 0.15;
      rl.upper.rotation.x = -1.0;
      rl.lower.rotation.x = 0.9;
      la.upper.rotation.set(-0.3, 0, -0.9);
      ra.upper.rotation.set(-0.6, 0, 0.5);
      la.lower.rotation.x = ra.lower.rotation.x = -0.3;
    } else if (mantle) {
      la.upper.rotation.set(-2.6, 0, -0.2);
      ra.upper.rotation.set(-2.6, 0, 0.2);
      la.lower.rotation.x = ra.lower.rotation.x = -0.6;
      ll.upper.rotation.x = -1.1;
      ll.lower.rotation.x = 1.4;
      rl.upper.rotation.x = -0.3;
      rl.lower.rotation.x = 0.8;
    } else if (air) {
      ll.upper.rotation.x = -0.7;
      ll.lower.rotation.x = 1.0;
      rl.upper.rotation.x = 0.3;
      rl.lower.rotation.x = 0.6;
      la.upper.rotation.set(-1.1 + Math.sin(this.clock * 3) * 0.1, 0, -0.5);
      ra.upper.rotation.set(-0.4, 0, 0.6);
      la.lower.rotation.x = ra.lower.rotation.x = -0.5;
    } else if (run) {
      const s = Math.sin(p);
      const c = Math.cos(p);
      ll.upper.rotation.x = -s * 0.9 * sw - 0.1;
      rl.upper.rotation.x = s * 0.9 * sw - 0.1;
      ll.lower.rotation.x = Math.max(0, c) * 1.4 * sw + 0.1;
      rl.lower.rotation.x = Math.max(0, -c) * 1.4 * sw + 0.1;
      la.upper.rotation.set(s * 0.9 * sw, 0, -0.12);
      ra.upper.rotation.set(-s * 0.9 * sw, 0, 0.12);
      la.lower.rotation.x = ra.lower.rotation.x = -1.2 * sw - 0.2;
      this.hips.position.y += Math.abs(Math.sin(p)) * 0.06 * sw;
      if (anim === ANIM.wall) {
        // The hand on the wall side reaches for it.
        const arm = wallSide > 0 ? ra : la;
        arm.upper.rotation.set(-1.2, 0, wallSide * 1.2);
      }
    } else {
      const br = Math.sin(this.clock * 1.6) * 0.03;
      ll.upper.rotation.x = rl.upper.rotation.x = -this.crouch * 1.4;
      ll.lower.rotation.x = rl.lower.rotation.x = this.crouch * 2.6;
      la.upper.rotation.set(br, 0, -0.1);
      ra.upper.rotation.set(br, 0, 0.1);
      la.lower.rotation.x = ra.lower.rotation.x = -0.25;
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.tag.material.dispose();
    this.tagTex.dispose();
    shared.count--;
    if (shared.count === 0) {
      for (const g of shared.geos.values()) g.dispose();
      shared.geos.clear();
    }
  }
}
