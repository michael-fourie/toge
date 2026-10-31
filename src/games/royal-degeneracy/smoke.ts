// Smoking, made physical: the bong and the joint as little models (on the tables, in people's hands, and in your
// own hands in first person), the lighter, and the smoke itself, soft puffs that drift, swell and fade. HeldView
// draws your hands over the world (its own scene, after a depth clear, so a bong never clips into a wall): pick up
// a bong and you see the bud go into the bowl, the lighter's flame on it, the water bubbling and the chamber going
// milky, then the cloud you blow out.

import * as THREE from 'three';
import type { Vec3 } from '../../shared/math.ts';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ramp } from './people.ts';

const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp(), ...extra });

/** Every material and geometry a model made, so it can all be disposed with it. */
type Owned = { dispose(): void }[];

function mesh(owned: Owned, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  owned.push(geo);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A bong: a glass beaker with water in it, a downstem and a bowl, bud when packed, smoke when it's being ripped. */
export class BongModel {
  readonly root = new THREE.Group();
  private owned: Owned = [];
  private bud = new THREE.Group();
  private chamber: THREE.Mesh;
  private chamberBase: THREE.Mesh;
  private smokeMat = new THREE.MeshBasicMaterial({ color: 0xeeeeea, transparent: true, opacity: 0, depthWrite: false });
  private ember: THREE.Mesh;
  private emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false });
  private bubbles: THREE.Mesh[] = [];
  /** Where the bowl is, in the model's own space (the lighter goes here). */
  static readonly BOWL = new THREE.Vector3(0.105, 0.15, 0);
  static readonly TOP = 0.5;
  private t = 0;

  constructor() {
    const o = this.owned;
    const glass = toon('#a8dbe6', { transparent: true, opacity: 0.55, depthWrite: false });
    const water = toon('#4fa7c8', { transparent: true, opacity: 0.7 });
    const metal = toon('#a8acb4');
    const green = toon('#4f8a2a');
    o.push(glass, water, metal, green, this.smokeMat, this.emberMat);
    const r = this.root;
    r.add(mesh(o, new THREE.CylinderGeometry(0.068, 0.085, 0.14, 16), glass, 0, 0.07, 0));
    r.add(mesh(o, new THREE.CylinderGeometry(0.03, 0.034, 0.36, 12), glass, 0, 0.31, 0));
    r.add(mesh(o, new THREE.TorusGeometry(0.031, 0.006, 6, 14), glass, 0, BongModel.TOP - 0.01, 0)).rotation.x = Math.PI / 2;
    r.add(mesh(o, new THREE.CylinderGeometry(0.075, 0.082, 0.07, 16), water, 0, 0.04, 0));
    const stem = mesh(o, new THREE.CylinderGeometry(0.009, 0.009, 0.13, 8), metal, 0.06, 0.09, 0);
    stem.rotation.z = -0.9;
    r.add(stem);
    const bowl = mesh(o, new THREE.CylinderGeometry(0.026, 0.012, 0.035, 12), metal, BongModel.BOWL.x, BongModel.BOWL.y - 0.01, 0);
    r.add(bowl);
    for (const [x, z, s] of [[0, 0, 1], [0.008, 0.006, 0.8], [-0.008, -0.005, 0.85]]) this.bud.add(mesh(o, new THREE.IcosahedronGeometry(0.011 * s, 0), green, x, 0, z));
    this.bud.position.copy(BongModel.BOWL);
    this.bud.position.y += 0.012;
    this.bud.scale.setScalar(0.001);
    r.add(this.bud);
    this.ember = mesh(o, new THREE.SphereGeometry(0.014, 8, 6), this.emberMat, BongModel.BOWL.x, BongModel.BOWL.y + 0.016, 0);
    this.ember.visible = false;
    r.add(this.ember);
    this.chamber = mesh(o, new THREE.CylinderGeometry(0.026, 0.026, 1, 10), this.smokeMat, 0, 0.14, 0);
    this.chamberBase = mesh(o, new THREE.SphereGeometry(0.06, 12, 8), this.smokeMat, 0, 0.1, 0);
    this.chamberBase.scale.y = 0.5;
    r.add(this.chamber, this.chamberBase);
    for (let i = 0; i < 6; i++) {
      const b = mesh(o, new THREE.SphereGeometry(0.006 + (i % 3) * 0.003, 6, 4), glass, 0, 0.02, 0);
      b.visible = false;
      this.bubbles.push(b);
      r.add(b);
    }
  }

  /** How packed (0..1, the bud growing in as you pack), how full the chamber is, and whether it's lit and bubbling. */
  set(packed: number, fill: number, lit: boolean, dt: number) {
    this.t += dt;
    this.bud.scale.setScalar(Math.max(0.001, packed));
    const f = Math.min(1, fill);
    this.chamber.scale.y = Math.max(0.001, 0.34 * f);
    this.chamber.position.y = 0.14 + 0.17 * f;
    this.chamberBase.visible = f > 0.02;
    this.smokeMat.opacity = f > 0.01 ? 0.35 + 0.4 * f + (fill > 1 ? 0.2 : 0) : 0;
    this.ember.visible = lit && packed > 0.5;
    this.ember.scale.setScalar(0.8 + Math.sin(this.t * 30) * 0.15 + 0.3 * f);
    this.bubbles.forEach((b, i) => {
      b.visible = lit && packed > 0.5;
      const k = (this.t * 2.5 + i / this.bubbles.length) % 1;
      b.position.set(Math.sin(i * 2.1) * 0.035, 0.01 + k * 0.065, Math.cos(i * 2.1) * 0.035);
    });
  }

  /** The bowl, in world (or view) space. */
  bowl(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(out.copy(BongModel.BOWL));
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose();
  }
}

/** A joint: a paper cone (the mouth end at the origin, the tip along -Z), burning down from the tip, a glowing cherry. */
export class JointModel {
  readonly root = new THREE.Group();
  private owned: Owned = [];
  private paper: THREE.Mesh;
  private ash: THREE.Mesh;
  private cherry: THREE.Mesh;
  private cherryMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, toneMapped: false });
  static readonly LEN = 0.085;

  constructor() {
    const o = this.owned;
    const paper = toon('#f4efe2');
    const card = toon('#c8a874');
    const ash = toon('#8a8a86');
    o.push(paper, card, ash, this.cherryMat);
    const along = new THREE.Group();
    along.rotation.x = -Math.PI / 2;
    this.root.add(along);
    along.add(mesh(o, new THREE.CylinderGeometry(0.0062, 0.0062, 0.014, 8), card, 0, 0.007, 0));
    this.paper = mesh(o, new THREE.CylinderGeometry(0.0105, 0.0065, 1, 10), paper);
    this.ash = mesh(o, new THREE.CylinderGeometry(0.0095, 0.0105, 0.006, 10), ash);
    this.cherry = mesh(o, new THREE.SphereGeometry(0.0095, 8, 6), this.cherryMat);
    along.add(this.paper, this.ash, this.cherry);
    this.set(1, false, 0);
  }

  /** How much is left (1..0), whether it's lit, and how hard the cherry's glowing (0 idle, 1 mid-drag). */
  set(burn: number, lit: boolean, glow: number) {
    const len = 0.02 + (JointModel.LEN - 0.02) * Math.max(0, burn);
    this.paper.scale.y = len;
    this.paper.position.y = 0.014 + len / 2;
    this.ash.visible = lit;
    this.ash.position.y = 0.014 + len + 0.003;
    this.cherry.visible = lit;
    this.cherry.position.y = 0.014 + len + 0.004;
    this.cherry.scale.setScalar(0.9 + glow * 0.5);
    this.cherryMat.color.setRGB(1, 0.32 + glow * 0.35, 0.08 + glow * 0.1);
  }

  /** The tip, in world (or view) space. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, true);
    return this.cherry.getWorldPosition(out);
  }

  dispose() {
    this.root.removeFromParent();
    for (const x of this.owned) x.dispose();
  }
}

/** Soft round smoke sprites: drift, swell, fade. One pool per scene. */
export class SmokeFx {
  private pool: { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; grow: number; alpha: number }[] = [];
  private tex: THREE.CanvasTexture;
  private next = 0;

  constructor(
    private scene: THREE.Scene,
    size = 140,
  ) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(240,240,236,0.45)');
    grad.addColorStop(1, 'rgba(230,230,226,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xe8e6e0, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, v: new THREE.Vector3(), age: 0, life: 1, grow: 1, alpha: 0.5 });
    }
  }

  /** One puff at `at`, moving at `v` (m/s), starting `size` across, swelling by `grow`× over its `life`. */
  puff(at: Vec3, v: Vec3, size: number, life: number, grow = 3, alpha = 0.5) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.s.position.set(at.x, at.y, at.z);
    p.s.scale.setScalar(size);
    p.s.userData.size = size;
    p.s.visible = true;
    p.s.material.rotation = Math.random() * Math.PI * 2;
    p.v.set(v.x, v.y, v.z);
    p.age = 0;
    p.life = life;
    p.grow = grow;
    p.alpha = alpha;
  }

  /** A breath of smoke out of a mouth: a cloud pushed forward along `dir`, drifting up. `size` 0..1. */
  exhale(at: Vec3, dir: Vec3, size: number, n = 3) {
    for (let i = 0; i < n; i++) {
      const sp = 0.6 + size * 1.2 + Math.random() * 0.4;
      const j = () => (Math.random() - 0.5) * 0.6;
      this.puff(at, { x: dir.x * sp + j(), y: dir.y * sp + 0.15 + j() * 0.5, z: dir.z * sp + j() }, 0.05 + size * 0.04, 2.5 + size * 2.5 + Math.random(), 8 + size * 6, 0.16 + size * 0.14);
    }
  }

  /** A thin wisp curling up off a cherry or a bowl. */
  wisp(at: Vec3, scale = 1) {
    this.puff(at, { x: (Math.random() - 0.5) * 0.04, y: 0.18 + Math.random() * 0.1, z: (Math.random() - 0.5) * 0.04 }, 0.02 * scale, 1.6, 4, 0.3);
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.s.visible = false;
        continue;
      }
      // Slows down, keeps rising a little, swells, fades.
      p.v.multiplyScalar(Math.exp(-dt * 1.6));
      p.v.y += dt * 0.05;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.s.userData.size * (1 + (p.grow - 1) * Math.sqrt(k)));
      p.s.material.opacity = p.alpha * Math.min(1, k * 8) * (1 - k) * (1 - k);
      p.s.material.rotation += dt * 0.3;
    }
  }

  dispose() {
    for (const p of this.pool) {
      p.s.material.dispose();
      this.scene.remove(p.s);
    }
    this.tex.dispose();
  }
}

/** A lighter: a little plastic body and a flame that flickers when it's lit. */
class Lighter {
  readonly root = new THREE.Group();
  private flame: THREE.Mesh;
  private owned: Owned = [];

  constructor() {
    const o = this.owned;
    const body = toon('#d23a3a');
    const metal = toon('#b8bcc4');
    const flame = new THREE.MeshBasicMaterial({ color: 0xffc040, toneMapped: false, transparent: true, opacity: 0.9 });
    o.push(body, metal, flame);
    this.root.add(mesh(o, new THREE.BoxGeometry(0.024, 0.06, 0.012), body, 0, -0.03, 0));
    this.root.add(mesh(o, new THREE.BoxGeometry(0.024, 0.012, 0.012), metal, 0, 0.006, 0));
    this.flame = mesh(o, new THREE.ConeGeometry(0.006, 0.028, 8), flame, 0, 0.026, 0);
    this.root.add(this.flame);
  }

  set(lit: boolean) {
    this.flame.visible = lit;
    const f = 0.85 + Math.random() * 0.3;
    this.flame.scale.set(f, 0.8 + Math.random() * 0.5, f);
  }

  dispose() {
    for (const x of this.owned) x.dispose();
  }
}

/** What your hands are doing, for HeldView. */
export interface HeldState {
  item: 'none' | 'joint' | 'bong';
  /** Joint: how much is left, lit, the lighter's going (lighting it), mid-drag. */
  burn: number;
  lit: boolean;
  lighting: boolean;
  /** Bong: how packed (0..1: packing shows it filling), the chamber's fill, being lit and pulled on. */
  packed: number;
  packing: boolean;
  fill: number;
  ripping: boolean;
  /** At your mouth (a drag, or a rip). */
  toMouth: boolean;
  /** Walking: the hands bob. */
  walk: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Grip = 'grip' | 'pinch' | 'rest';

/**
 * A first-person hand (a right one; the left is a mirror): a rounded palm, four fingers of three joints each and a
 * two-jointed thumb, posed by curling the joints. Its own space: the palm faces -x, the fingers point -z from the
 * knuckles (stacked index on top), the wrist is at +z: as if gripping a glass that's to its left.
 */
class Hand {
  readonly root = new THREE.Group();
  /** Where the forearm meets the hand, in the hand's space. */
  static readonly WRIST = new THREE.Vector3(0.004, -0.012, 0.058);
  private fingers: THREE.Group[][] = [];
  private thumb: THREE.Group[] = [];

  constructor(owned: Owned, skin: THREE.Material, nails: THREE.Material) {
    const palm = mesh(owned, new RoundedBoxGeometry(0.032, 0.082, 0.09, 4, 0.0148), skin);
    // The heel of the hand, rounder than the knuckles.
    this.root.add(palm);
    const heel = mesh(owned, new THREE.SphereGeometry(0.03, 12, 8), skin, 0.002, -0.012, 0.03);
    heel.scale.set(0.55, 0.9, 0.9);
    this.root.add(heel);
    // Fingers: index, middle, ring, pinky (lengths and thickness taper; the pinky's shortest).
    const spec: [number, number, number][] = [
      [0.03, 0.95, 0.0088],
      [0.01, 1.05, 0.009],
      [-0.01, 0.98, 0.0086],
      [-0.029, 0.78, 0.0076],
    ];
    for (const [y, k, r] of spec) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = this.root;
      let z = -0.044;
      [0.034, 0.024, 0.019].forEach((len, i) => {
        const joint = new THREE.Group();
        joint.position.set(0, i === 0 ? y : 0, z);
        const seg = mesh(owned, new THREE.CapsuleGeometry(r * (1 - i * 0.08), len * k - r, 3, 8), skin);
        seg.rotation.x = Math.PI / 2;
        seg.position.z = (-len * k) / 2;
        joint.add(seg);
        if (i === 2) {
          const nail = mesh(owned, new THREE.BoxGeometry(r * 1.3, 0.002, r * 1.4), nails);
          nail.position.set(0, r * 0.85, -len * k + r);
          joint.add(nail);
        }
        parent.add(joint);
        chain.push(joint);
        parent = joint;
        z = -len * k;
      });
      this.fingers.push(chain);
    }
    // The thumb: from the palm's index side near the wrist, two joints.
    let parent: THREE.Object3D = this.root;
    [
      [0.034, 0.0105],
      [0.026, 0.0095],
    ].forEach(([len, r], i) => {
      const joint = new THREE.Group();
      if (i === 0) joint.position.set(-0.012, 0.03, 0.012);
      else joint.position.set(-len, 0, 0);
      const seg = mesh(owned, new THREE.CapsuleGeometry(r, len - r, 3, 8), skin);
      seg.rotation.z = Math.PI / 2;
      seg.position.x = -len / 2;
      joint.add(seg);
      parent.add(joint);
      this.thumb.push(joint);
      parent = joint;
    });
    this.pose('rest');
  }

  /** Curls the fingers and thumb into a grip (round something), a pinch (thumb to index tip) or a loose rest. */
  pose(g: Grip) {
    const curls: Record<Grip, number[][]> = {
      grip: [[0.95, 0.9, 0.7], [0.95, 0.95, 0.7], [1.0, 0.95, 0.7], [1.05, 1.0, 0.7]],
      pinch: [[0.55, 0.6, 0.35], [1.35, 1.4, 0.9], [1.45, 1.4, 0.9], [1.5, 1.4, 0.9]],
      rest: [[0.3, 0.35, 0.2], [0.35, 0.4, 0.25], [0.45, 0.45, 0.25], [0.55, 0.5, 0.3]],
    };
    this.fingers.forEach((chain, f) => chain.forEach((j, i) => (j.rotation.y = curls[g][f][i])));
    // The thumb swings across toward the fingers (about y) and bends at its knuckle.
    const [swing, drop, bend] = g === 'grip' ? [-0.75, -0.25, 0.5] : g === 'pinch' ? [-1.05, -0.45, 0.35] : [-0.4, -0.2, 0.2];
    this.thumb[0].rotation.set(0, swing, drop);
    this.thumb[1].rotation.set(0, bend, 0);
  }
}

/** Your own hands, in first person, drawn over the world. */
export class HeldView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  private bong = new BongModel();
  private joint = new JointModel();
  private lighter = new Lighter();
  private hands: [Hand, Hand];
  private handL: THREE.Group;
  private handR: THREE.Group;
  /** Forearms: bare skin at the wrist, then the sleeve, down to just off the bottom corner of the screen. */
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private wristL: THREE.Mesh;
  private wristR: THREE.Mesh;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private smoke: SmokeFx;
  private owned: Owned = [];
  /** Smoothed poses (position x/y/z, rotation x/y/z) for the bong and the joint. */
  private bongPose = [0.2, -0.7, -0.5, 0, 0, 0];
  private jointPose = [0.25, -0.5, -0.45, 0, 0, 0];
  private t = 0;
  private wispIn = 0;
  private tmp = new THREE.Vector3();

  constructor(skin: string, sleeve: string) {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#fff4e0', '#3a2a40', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(0.4, 1, 0.6);
    s.add(sun);
    // Double-sided: the left hand is the right one mirrored, which turns its faces inside out.
    const skinMat = toon(skin, { side: THREE.DoubleSide });
    const nailMat = toon('#f3d6c8', { side: THREE.DoubleSide });
    const sleeveMat = toon(sleeve, { side: THREE.DoubleSide });
    this.owned.push(skinMat, nailMat, sleeveMat);
    this.hands = [new Hand(this.owned, skinMat, nailMat), new Hand(this.owned, skinMat, nailMat)];
    this.handL = this.hands[0].root;
    this.handR = this.hands[1].root;
    this.handL.scale.set(-0.85, 0.85, 0.85);
    this.handR.scale.setScalar(0.85);
    s.add(this.handL, this.handR);
    const limb = (m: THREE.Material, r0: number, r1: number) => {
      const geo = new THREE.CylinderGeometry(r0, r1, 1, 12);
      geo.translate(0, 0.5, 0);
      const out = mesh(this.owned, geo, m);
      s.add(out);
      return out;
    };
    this.wristL = limb(skinMat, 0.021, 0.026);
    this.wristR = limb(skinMat, 0.021, 0.026);
    this.armL = limb(sleeveMat, 0.036, 0.046);
    this.armR = limb(sleeveMat, 0.036, 0.046);
    this.bong.root.scale.setScalar(0.8);
    s.add(this.bong.root, this.joint.root, this.lighter.root);
    this.smoke = new SmokeFx(s, 40);
  }

  update(dt: number, h: HeldState) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 9);
    const bob = Math.sin(this.t * 9) * 0.008 * h.walk;
    const show = (o: THREE.Object3D, on: boolean) => (o.visible = on);
    show(this.bong.root, h.item === 'bong');
    show(this.joint.root, h.item === 'joint');
    show(this.handL, h.item !== 'none');
    show(this.handR, h.item !== 'none');
    let lighterOn = false;
    let lighterAt: THREE.Vector3 | null = null;
    if (h.item === 'bong') {
      // Idle low on the right; packing tipped toward you; ripping up at your face, the lighter at the bowl.
      const want = h.toMouth || h.ripping ? [0.04, -0.37, -0.58, 0.3, -0.5, 0] : h.packing ? [0.06, -0.36, -0.62, 0.35, -0.5, 0] : [0.22, -0.42, -0.7, 0.05, -0.5, 0.05];
      this.bongPose = this.bongPose.map((v, i) => lerp(v, want[i], k));
      const [x, y, z, rx, ry, rz] = this.bongPose;
      this.bong.root.position.set(x, y + bob, z);
      this.bong.root.rotation.set(rx, ry, rz);
      this.bong.root.updateMatrixWorld(true);
      this.bong.set(h.packed, h.fill, h.ripping, dt);
      // The left hand grips the beaker; the right rests on the tube, pinches bud into the bowl, or works the lighter.
      const [hl, hr] = this.hands;
      hl.pose('grip');
      this.handL.quaternion.copy(this.bong.root.quaternion);
      this.handL.position.copy(this.bong.root.localToWorld(this.tmp.set(-0.105, 0.075, 0.01)));
      const bowl = this.bong.bowl(new THREE.Vector3());
      if (h.packing) {
        hr.pose('pinch');
        this.handR.rotation.set(0.25, 0, Math.PI / 2);
        this.handR.position.set(bowl.x + 0.005, bowl.y + 0.07 + Math.abs(Math.sin(this.t * 10)) * 0.02, bowl.z + 0.1);
      } else if (h.ripping) {
        hr.pose('grip');
        lighterOn = true;
        lighterAt = new THREE.Vector3(bowl.x + 0.012, bowl.y - 0.05, bowl.z + 0.012);
        this.handR.rotation.set(0, -0.25, 0);
        this.handR.position.set(lighterAt.x + 0.028, lighterAt.y - 0.03, lighterAt.z + 0.006);
        this.wispIn -= dt;
        if (this.wispIn < 0) {
          this.wispIn = 0.12;
          this.smoke.wisp({ x: bowl.x, y: bowl.y + 0.02, z: bowl.z }, 0.6);
        }
      } else {
        hr.pose('grip');
        this.handR.quaternion.copy(this.bong.root.quaternion);
        this.handR.position.copy(this.bong.root.localToWorld(this.tmp.set(0.07, 0.24, 0.01)));
      }
    } else if (h.item === 'joint') {
      // Idle low in the right hand; lighting it, the tip to the lighter in your left; a drag, at your lips.
      const want = h.toMouth ? [0.03, -0.06, -0.21, -0.45, -0.5, 0] : h.lighting ? [0.07, -0.12, -0.27, 0, 0.9, 0] : [0.16, -0.15, -0.38, 0.1, -0.6, 0];
      this.jointPose = this.jointPose.map((v, i) => lerp(v, want[i], k));
      const [x, y, z, rx, ry, rz] = this.jointPose;
      this.joint.root.position.set(x, y + bob, z);
      this.joint.root.rotation.set(rx, ry, rz);
      this.joint.root.updateMatrixWorld(true);
      this.joint.set(h.burn, h.lit, h.toMouth ? 0.6 + Math.sin(this.t * 20) * 0.15 : 0.1);
      // Pinched between thumb and finger near the roach end, the hand turned half on its side so you see the pinch.
      const [hl, hr] = this.hands;
      hr.pose('pinch');
      this.handR.quaternion.copy(this.joint.root.quaternion).multiply(this.q.setFromEuler(this.e.set(0.2, 0, 0.85)));
      this.handR.position.copy(this.joint.root.localToWorld(this.tmp.set(0.006, 0.022, 0.085)));
      const tip = this.joint.tip(new THREE.Vector3());
      this.handL.visible = h.lighting;
      if (h.lighting) {
        hl.pose('grip');
        lighterOn = true;
        lighterAt = new THREE.Vector3(tip.x, tip.y - 0.035, tip.z);
        this.handL.rotation.set(0, 0.25, 0);
        this.handL.position.set(lighterAt.x - 0.028, lighterAt.y - 0.03, lighterAt.z + 0.006);
      }
      if (h.lit) {
        this.wispIn -= dt;
        if (this.wispIn < 0) {
          this.wispIn = h.toMouth ? 0.08 : 0.25;
          this.smoke.wisp(tip, 0.5);
        }
      }
    }
    this.reach(this.wristL, this.armL, this.handL, -1);
    this.reach(this.wristR, this.armR, this.handR, 1);
    this.lighter.root.visible = lighterOn;
    if (lighterAt) this.lighter.root.position.copy(lighterAt);
    this.lighter.set(lighterOn);
    this.smoke.update(dt);
  }

  /** The forearm from the wrist back to its shoulder, off the bottom corner of the screen: bare skin, then the sleeve. */
  private reach(wrist: THREE.Mesh, arm: THREE.Mesh, hand: THREE.Group, side: 1 | -1) {
    wrist.visible = arm.visible = hand.visible;
    if (!hand.visible) return;
    hand.updateMatrixWorld(true);
    const from = hand.localToWorld(Hand.WRIST.clone());
    const d = this.tmp.set(side * 0.34, -0.62, 0.06).sub(from);
    const len = d.length();
    d.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    wrist.position.copy(from);
    wrist.quaternion.copy(q);
    wrist.scale.set(1, 0.09, 1);
    arm.position.copy(from).addScaledVector(d, 0.075);
    arm.quaternion.copy(q);
    arm.scale.set(1, Math.max(0.01, len - 0.075), 1);
  }

  render(r: THREE.WebGLRenderer, aspect: number) {
    if (!this.bong.root.visible && !this.joint.root.visible) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  dispose() {
    this.bong.dispose();
    this.joint.dispose();
    this.lighter.dispose();
    this.smoke.dispose();
    for (const x of this.owned) x.dispose();
  }
}
