import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonRamp } from '../textures.ts';

// What every gun model and animation shares. A gun lives in "gun space": metres, barrel along -Z, +X to the shooter's right,
// origin at the trigger. Models are built from named parts; each gun's animation moves those parts, and writes a Plan that
// tells the viewmodel where the hands go.

/** Easing helpers for keyframed motion: seg(u, a, b) eases 0 -> 1 as u goes a -> b; hold goes up, stays, then down. */
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const seg = (u: number, a: number, b: number) => ease((u - a) / (b - a));
export const hold = (u: number, a: number, b: number, c: number, d: number) => seg(u, a, b) - seg(u, c, d);
/** 0 -> 1 -> 0 over [a, b], peaking at the midpoint. */
export const pulse = (u: number, a: number, b: number) => hold(u, a, (a + b) / 2, (a + b) / 2, b);

export interface GunRig {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  anchors: {
    /** Where the right hand holds the grip, and where the left rests (the forend, or wrapped round a handgun's grip). */
    grip: THREE.Vector3;
    fore: THREE.Vector3;
    muzzle: THREE.Vector3;
    eject: THREE.Vector3;
    /** Where the magazine (or cylinder, or cell) sits. */
    mag: THREE.Vector3;
  };
  /** Set when a downloaded model is in use (CC BY needs attribution). */
  credit?: string;
}

export type HandPose = 'grip' | 'fore' | 'knob' | 'mag' | 'pinch' | 'wrap';

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
/** Hand orientations in gun space. The palm's normal is -Y and the fingers point -Z in the hand's own frame. */
export const POSES: Record<HandPose, THREE.Quaternion> = {
  grip: q(0.45, 0, -Math.PI / 2), // palm against the right of the grip, fingers wrapping forward
  fore: q(0.1, 0, Math.PI), // palm up, cradling the forend
  knob: q(-0.5, 0.3, -Math.PI / 2 - 0.3), // pinching a knob or lever from the right
  mag: q(0.2, 0, Math.PI),
  pinch: q(0.35, 0, Math.PI),
  wrap: q(0.45, 0, Math.PI / 2), // the left hand on a handgun: palm against the left of the grip, fingers over the right hand's
};

/** One frame's wishes from a gun's animation: where each hand goes (gun space), and how the whole gun is nudged. */
export class Plan {
  readonly l = new THREE.Vector3();
  readonly r = new THREE.Vector3();
  useL = false;
  useR = false;
  lPose: HandPose = 'fore';
  rPose: HandPose = 'grip';
  lCurl = 0.55;
  rCurl = 0.95;
  /** 0..1 blend toward each hand's off-screen spot (reaching for ammo). */
  lOff = 0;
  rOff = 0;
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Euler();
  /** A part that rides in the left hand this frame (a fresh magazine, a shell), at `carryOff` from it in gun space. */
  carry: THREE.Object3D | null = null;
  readonly carryOff = new THREE.Vector3();

  reset() {
    this.carry = null;
    this.useL = this.useR = false;
    this.lPose = 'fore';
    this.rPose = 'grip';
    this.lCurl = 0.55;
    this.rCurl = 0.95;
    this.lOff = this.rOff = 0;
    this.pos.set(0, 0, 0);
    this.rot.set(0, 0, 0);
  }

  left(v: THREE.Vector3, pose: HandPose, curl = 0.6, dx = 0, dy = 0, dz = 0) {
    this.l.set(v.x + dx, v.y + dy, v.z + dz);
    this.useL = true;
    this.lPose = pose;
    this.lCurl = curl;
  }

  right(v: THREE.Vector3, pose: HandPose, curl = 0.7, dx = 0, dy = 0, dz = 0) {
    this.r.set(v.x + dx, v.y + dy, v.z + dz);
    this.useR = true;
    this.rPose = pose;
    this.rCurl = curl;
  }
}

/** What an animation can do beyond moving parts: one-shot cues (sound, debris) and spent casings. */
export interface Kit {
  /** Runs fn once when the timeline `u` first passes `at` during this action. */
  cue(u: number, at: number, name: string, fn: () => void): void;
  casing(): void;
  dropPart(part: THREE.Object3D, vel: THREE.Vector3): void;
  /** True when the gun was empty (a fresh reload also chambers a round). */
  empty: boolean;
}

export interface GunAnim {
  /** Puts every animated part back where it rests; called before each frame's animation. */
  rest(rig: GunRig): void;
  /** How hard a shot kicks the gun: back (metres) and muzzle flip (radians). */
  kick: { back: number; flip: number };
  /** Muzzle flash colour. */
  flash: number;
  /** Seconds a shot's mechanical cycle takes after it starts, and how long after the shot it begins (manual actions). */
  cycle: { delay: number; dur: number } | null;
  /** The shot's own motion: blowback for most guns, the pump/lever/bolt cycle for manual ones. t = seconds since the shot. */
  fire(rig: GunRig, t: number, p: Plan, k: Kit): void;
  /** The reload, u = 0..1 over its whole duration. */
  reload(rig: GunRig, u: number, p: Plan, k: Kit): void;
  /** How the left hand rests on the gun when no animation moves it (default: 'fore', cradling the forend). */
  support?: HandPose;
  /** Camera position and rotation of the gun at rest. Aiming down the sights is worked out from the sights (sights.ts). */
  hip: { pos: THREE.Vector3; rot: THREE.Euler };
}

// ---------------------------------------------------------------------------
// Building blocks

export function palette(accent: number, colors: Record<string, number>) {
  const gradientMap = toonRamp();
  const out: Record<string, THREE.Material> = { accent: new THREE.MeshToonMaterial({ color: accent, gradientMap }) };
  for (const [k, c] of Object.entries(colors)) out[k] = new THREE.MeshToonMaterial({ color: c, gradientMap });
  return out;
}

export const glow = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
export const rbox = (w: number, h: number, d: number, r = 0.006) => new RoundedBoxGeometry(w, h, d, 2, r);
/** A cylinder along Z. */
export const cyl = (r0: number, r1: number, len: number, seg = 14) => new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2);

/** Mesh-adding helper bound to a root. */
export function builder(root: THREE.Object3D) {
  return (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
}

/** An empty pivot group at a position, for parts that slide or swing. */
export function pivot(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const e = (x: number, y: number, z: number) => new THREE.Euler(x, y, z);
