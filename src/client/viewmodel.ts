import * as THREE from 'three';
import { WEAPON } from '../shared/constants.ts';
import { sfx } from './sfx.ts';
import { type WeaponModel, buildProceduralAwp, loadAwpGlb } from './weapon/awp.ts';
import { Arm } from './weapon/hands.ts';

// Easing helpers for keyframed motion. seg(u, a, b) eases 0->1 as u goes a->b.
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (u: number, a: number, b: number) => ease((u - a) / (b - a));
/** 0 -> 1 over [a, b], hold, 1 -> 0 over [c, d]. */
const hold = (u: number, a: number, b: number, c: number, d: number) => seg(u, a, b) - seg(u, c, d);

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
// Hand orientations in gun space. The palm's normal is -Y and fingers point -Z in the hand's own frame.
const POSE = {
  grip: q(0.45, 0, -Math.PI / 2), // palm against the right of the pistol grip, fingers wrapping forward
  handguard: q(0.1, 0, Math.PI), // palm up, cradling the forend
  knob: q(-0.5, 0.3, -Math.PI / 2 - 0.3), // pinching the bolt knob from the right
  magGrab: q(0.2, 0, Math.PI),
};

// Everything below lives in `view` space, which is scaled down as a whole (gun + arms together).
const VIEW_SCALE = 0.85;
/** @public Exported so the dev lab (dev/viewmodel.html) can tune the pose live. */
export const GUN_POS = new THREE.Vector3(0.27, -0.2, -0.64);
/** @public */
export const GUN_ROT = new THREE.Euler(-0.05, -0.02, 0); // muzzle dipped a touch so the rifle lies flatter on screen
const UNDER_MAG = new THREE.Vector3(0, -0.12, 0);
const LEFT_OFFSCREEN = new THREE.Vector3(-0.3, -0.85, -0.5);

type LeftTarget = 'handguard' | 'mag' | 'down';
type Action = { kind: 'bolt' | 'reload' | 'draw'; t: number; dur: number; withBolt: boolean; cues: Set<string> };

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/**
 * First-person AWP + hands, drawn in its own scene/camera after the world so it never clips into walls.
 * All the motion (recoil, bolt cycle, reload, draw, sway, bob) is procedural keyframing, so it works
 * the same on the built-in rifle and on a downloaded GLB with separate bolt/mag parts.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  /** Set when a downloaded model is in use (CC BY needs attribution). */
  credit: string | null = null;

  private readonly view = new THREE.Group();
  private readonly rig = new THREE.Group(); // sway/bob/action offsets live here
  private gun!: WeaponModel;
  private readonly right: Arm;
  private readonly left: Arm;
  private readonly muzzleFlash: THREE.Mesh;
  private readonly handMag = new THREE.Group();
  private debris: Debris[] = [];

  private action: Action | null = null;
  private pendingBolt = -1; // seconds until a queued bolt cycle starts
  private bobT = 0;
  private sway = new THREE.Vector2();
  private recoil = 0;
  private dip = 0;
  private flash = 0;

  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(color: number) {
    this.scene.add(new THREE.HemisphereLight(0xcde8ff, 0x7c9a58, 1.6));
    const key = new THREE.DirectionalLight(0xffe3b3, 2.4);
    key.position.set(1, 2, 1);
    this.scene.add(key);
    this.view.scale.setScalar(VIEW_SCALE);
    this.scene.add(this.view);
    this.view.add(this.rig);

    this.setModel(buildProceduralAwp(color));
    // Swap in the real AWP if one has been dropped into public/models/.
    void loadAwpGlb()
      .then((m) => {
        if (!m) return;
        this.setModel(m);
        this.credit = m.credit ?? null;
      })
      .catch((e) => console.warn('[awp] GLB failed to load, keeping the built-in rifle', e));

    this.right = new Arm(this.view, color, new THREE.Vector3(0.62, -0.7, 0.02), 1);
    this.left = new Arm(this.view, color, new THREE.Vector3(-0.3, -0.85, -0.3), -1);
    this.view.add(this.handMag);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.rig.add(this.muzzleFlash);
    this.draw();
  }

  private setModel(m: WeaponModel) {
    if (this.gun) this.rig.remove(this.gun.root);
    this.gun = m;
    this.rig.add(m.root);
    this.handMag.clear();
    if (m.hasMag) this.handMag.add(m.magPivot.clone(true));
    this.handMag.visible = false;
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  // Triggers from the game

  /** cycle: there's another round in the mag, so work the bolt right after the recoil. */
  fire(cycle: boolean) {
    this.recoil = 1;
    this.flash = 1;
    this.action = null;
    this.pendingBolt = cycle ? WEAPON.boltDelay : -1;
  }

  /** Mag swap; withBolt when the chamber is empty (last round fired), adding a bolt cycle at the end. */
  reload(withBolt: boolean) {
    this.pendingBolt = -1;
    this.start('reload', WEAPON.reloadTime + (withBolt ? WEAPON.boltTime : 0), withBolt);
  }

  draw() {
    this.pendingBolt = -1;
    this.start('draw', 0.4);
  }

  land(impact: number) {
    this.dip = Math.min(1, this.dip + impact);
  }

  private start(kind: Action['kind'], dur: number, withBolt = false) {
    this.action = { kind, t: 0, dur, withBolt, cues: new Set() };
    this.gun.magPivot.visible = true;
    this.handMag.visible = false;
  }

  /** Runs fn once when an action's timeline passes `at` (sounds, debris). */
  private cue(a: Action, u: number, at: number, name: string, fn: () => void) {
    if (u >= at && !a.cues.has(name)) {
      a.cues.add(name);
      fn();
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame

  /** speed: horizontal m/s, grounded: for walk bob, look: mouse delta this frame (radians). */
  update(dt: number, speed: number, grounded: boolean, lookX: number, lookY: number, roll: number) {
    if (this.pendingBolt >= 0) {
      this.pendingBolt -= dt;
      if (this.pendingBolt < 0) this.start('bolt', WEAPON.boltTime);
    }
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.t >= a.dur) {
        this.action = null;
        this.gun.magPivot.visible = true;
        this.handMag.visible = false;
      }
    }

    if (grounded) this.bobT += dt * Math.min(speed, 12) * 1.1;
    const bobAmt = grounded ? Math.min(speed / 7, 1) : 0;
    this.sway.x += (-lookX * 0.6 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookY * 0.6 - this.sway.y) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.dip = Math.max(0, this.dip - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 16);

    // Base pose + idle breathing + bob + sway + recoil.
    const t = performance.now() / 1000;
    const kick = this.recoil * this.recoil;
    this.rig.position.set(
      GUN_POS.x + Math.sin(this.bobT) * 0.01 * bobAmt + this.sway.x * 0.04,
      GUN_POS.y - Math.abs(Math.cos(this.bobT)) * 0.01 * bobAmt + this.sway.y * 0.04 - this.dip * 0.05 + Math.sin(t * 1.6) * 0.002,
      GUN_POS.z + kick * 0.07,
    );
    this.rig.rotation.set(
      GUN_ROT.x + kick * 0.16 + this.sway.y * 0.25,
      GUN_ROT.y + this.sway.x * 0.35,
      GUN_ROT.z + roll * 1.5 + this.sway.x * 0.15,
    );

    // Bolt + mag at rest, then the active action overrides.
    const g = this.gun;
    g.boltPivot.rotation.z = 0;
    g.boltPivot.position.z = 0.03;
    g.magPivot.position.copy(g.anchors.magWell);

    let rightW = 0; // 0 = on the grip, 1 = on the bolt knob
    let left: [LeftTarget, number] = ['handguard', 0];
    if (a?.kind === 'bolt') rightW = this.animateBolt(a, a.t / a.dur);
    else if (a?.kind === 'reload') {
      const magDur = a.dur - (a.withBolt ? WEAPON.boltTime : 0);
      if (a.t < magDur) left = this.animateReload(a, a.t / magDur);
      else rightW = this.animateBolt(a, (a.t - magDur) / WEAPON.boltTime);
    } else if (a?.kind === 'draw') {
      const k = 1 - seg(a.t / a.dur, 0, 1);
      this.rig.position.y -= k * 0.28;
      this.rig.rotation.x -= k * 0.7;
      this.rig.rotation.z += k * 0.3;
    }

    this.rig.updateMatrixWorld(true);
    this.poseRightHand(rightW);
    this.poseLeftHand(left[0], left[1]);

    this.muzzleFlash.position.copy(g.anchors.muzzle);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flash;
    this.muzzleFlash.scale.setScalar(0.5 + this.flash * 1.8);

    this.updateDebris(dt);
  }

  /**
   * The bolt cycle, kinda fast: hand to knob, lift, rip back (casing flies), slam forward, lock down, hand home.
   * Returns how much the right hand is on the knob (0..1).
   */
  private animateBolt(a: Action, u: number): number {
    const g = this.gun;
    const lift = hold(u, 0.14, 0.26, 0.7, 0.8);
    const back = hold(u, 0.28, 0.42, 0.52, 0.66);
    g.boltPivot.rotation.z = lift * 1.05; // handle swings up (knob on +X rises)
    g.boltPivot.position.z = 0.03 + back * 0.09;
    const tilt = hold(u, 0, 0.14, 0.82, 1);
    this.rig.rotation.z += tilt * 0.2;
    this.rig.rotation.x -= tilt * 0.05;
    this.rig.position.x -= tilt * 0.015;
    this.rig.position.z += back * 0.012; // the pull tugs the rifle back a touch
    this.cue(a, u, 0.18, 'up', () => sfx.boltUp());
    this.cue(a, u, 0.36, 'back', () => {
      sfx.boltBack();
      this.ejectCasing();
    });
    this.cue(a, u, 0.6, 'fwd', () => sfx.boltForward());
    return hold(u, 0, 0.13, 0.84, 1);
  }

  /** Mag out, hand down for a fresh one, seat it, slap. Returns the left hand's target and blend. */
  private animateReload(a: Action, u: number): [LeftTarget, number] {
    const g = this.gun;
    const tilt = hold(u, 0, 0.12, 0.8, 0.95);
    this.rig.rotation.z -= tilt * 0.38;
    this.rig.rotation.x += tilt * 0.2;
    this.rig.position.y += tilt * 0.035;
    this.rig.position.x -= tilt * 0.035;

    if (g.hasMag) {
      g.magPivot.visible = u < 0.16 || u >= 0.5;
      // The new mag sits 10 cm below the well while the hand brings it up, then slides in; the hand follows it.
      if (u >= 0.32) g.magPivot.position.y -= (1 - seg(u, 0.5, 0.64)) * 0.1;
      this.cue(a, u, 0.16, 'drop', () => {
        sfx.magOut();
        this.dropMag();
      });
      this.handMag.visible = u >= 0.32 && u < 0.5;
    }
    this.cue(a, u, 0.64, 'in', () => sfx.magIn());
    this.rig.position.y += hold(u, 0.64, 0.67, 0.67, 0.74) * 0.012; // slap

    // Left hand route: forend -> mag -> down out of view -> back up with the new mag -> push it in -> forend.
    // Every hand-off is continuous ('down' at w=0 is the same spot as 'mag' at w=1), so the hand never snaps or stalls.
    if (u < 0.16) return ['mag', seg(u, 0.02, 0.14)];
    if (u < 0.32) return ['down', seg(u, 0.16, 0.28)];
    if (u < 0.5) return ['down', 1 - seg(u, 0.32, 0.5)];
    if (u < 0.72) return ['mag', 1];
    return ['mag', 1 - seg(u, 0.72, 0.88)];
  }

  private poseRightHand(w: number) {
    const g = this.gun;
    const grip = this.gunToView(this.v.copy(g.anchors.grip));
    g.boltKnob.updateWorldMatrix(true, false);
    const knob = this.view.worldToLocal(g.boltKnob.getWorldPosition(this.v2)).add(this.v3.set(0.012, 0.004, 0.012).applyQuaternion(this.rig.quaternion));
    this.right.hand.position.copy(grip).lerp(knob, w);
    this.qa.copy(this.rig.quaternion).multiply(POSE.grip);
    this.qb.copy(this.rig.quaternion).multiply(POSE.knob);
    this.right.hand.quaternion.copy(this.qa).slerp(this.qb, w);
    this.right.curl(0.95 - w * 0.25);
    this.right.updateForearm();
  }

  private poseLeftHand(target: LeftTarget, w: number) {
    const g = this.gun;
    const underMag = this.gunToView(this.v2.copy(g.magPivot.position).add(UNDER_MAG));
    if (target === 'down') {
      this.left.hand.position.copy(underMag).lerp(LEFT_OFFSCREEN, w);
    } else {
      const forend = this.gunToView(this.v.copy(g.anchors.handguard));
      this.left.hand.position.copy(forend).lerp(underMag, w);
    }
    this.qa.copy(this.rig.quaternion).multiply(POSE.handguard);
    this.qb.copy(this.rig.quaternion).multiply(POSE.magGrab);
    this.left.hand.quaternion.copy(this.qa).slerp(this.qb, target === 'down' ? 1 : w);
    this.left.curl(target === 'down' ? 0.75 : 0.55 + Math.min(1, w) * 0.2); // gripping the mag from the moment it's grabbed
    this.left.updateForearm();

    // The fresh mag rides in the left hand until it's seated.
    if (this.handMag.visible) {
      this.handMag.position.copy(this.left.hand.position).add(this.v3.set(0, 0.07, 0).applyQuaternion(this.rig.quaternion));
      this.handMag.quaternion.copy(this.rig.quaternion);
    }
  }

  /** Gun-space point -> view space (where the hands and debris live). */
  private gunToView(p: THREE.Vector3) {
    return this.view.worldToLocal(this.gun.root.localToWorld(p));
  }

  // ---------------------------------------------------------------------------
  // Debris: spent casings and dropped mags (viewmodel space, purely cosmetic)

  private ejectCasing() {
    const g = this.gun;
    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8).rotateX(Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0xd9a84e }),
    );
    this.gunToView(casing.position.copy(g.anchors.ejectPort));
    this.spawnDebris(casing, new THREE.Vector3(0.9 + Math.random() * 0.3, 0.9, 0.15));
  }

  private dropMag() {
    const g = this.gun;
    const mag = g.magPivot.clone(true);
    this.view.worldToLocal(g.magPivot.getWorldPosition(mag.position));
    mag.quaternion.copy(this.rig.quaternion);
    this.spawnDebris(mag, new THREE.Vector3(-0.05, -0.5, 0.05), 0.4);
  }

  private spawnDebris(obj: THREE.Object3D, vel: THREE.Vector3, spinScale = 1) {
    this.view.add(obj);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(20 * spinScale);
    this.debris.push({ obj, vel, spin, life: 0.9 });
  }

  private updateDebris(dt: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 4 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.life <= 0) {
        d.obj.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
  }
}
