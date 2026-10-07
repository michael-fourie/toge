import * as THREE from 'three';
import { GOLD, MINT } from './punchmachine.ts';
import { buildProceduralAwp, loadAwpGlb } from './weapon/awp.ts';
import { GUN_ANIMS, GUN_BUILDERS } from './weapon/guns.ts';
import { Arm } from './weapon/hands.ts';
import { type GunAnim, type GunRig, type Kit, POSES, Plan, seg } from './weapon/rig.ts';
import { WEAPONS, type WeaponId } from '../shared/weapons.ts';

// Everything below lives in `view` space, which is scaled down as a whole (gun + arms together).
const VIEW_SCALE = 0.85;
const LEFT_OFFSCREEN = new THREE.Vector3(-0.3, -0.85, -0.5);
const RIGHT_OFFSCREEN = new THREE.Vector3(0.7, -0.85, -0.3);

type Action = { kind: 'reload' | 'draw'; t: number; dur: number; empty: boolean; cues: Set<string> };

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Loaded {
  rig: GunRig;
  anim: GunAnim;
}

/**
 * First-person gun + hands, drawn in its own scene/camera after the world so it never clips into walls.
 * All the motion (recoil, each gun's own action, reload, draw, sway, bob, aiming) is procedural keyframing:
 * the gun model is a few named pivots (weapon/guns.ts) and its animation also says where each hand goes.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  /** Set when a downloaded model is in use (CC BY needs attribution). */
  credit: string | null = null;

  private readonly view = new THREE.Group();
  private readonly rig = new THREE.Group(); // sway/bob/action offsets live here
  private readonly guns = new Map<WeaponId, Loaded>();
  private gun!: Loaded;
  private id: WeaponId = 'awp';
  private readonly right: Arm;
  private readonly left: Arm;
  private readonly muzzleFlash: THREE.Mesh;
  private debris: Debris[] = [];
  private readonly glow = new THREE.Group();
  private readonly glowMats = [MINT, GOLD, MINT].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));

  private readonly plan = new Plan();
  private action: Action | null = null;
  private shotT = -1; // seconds since the last shot's own animation began; -1 when idle
  private shotEmpty = false;
  private shotCues = new Set<string>();
  private readonly kit: Kit & { set: Set<string>; u: number };
  private aim = 0;
  private aimTarget = 0;
  private bobT = 0;
  private sway = new THREE.Vector2();
  private recoil = 0;
  private dip = 0;
  private flash = 0;

  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();

  constructor(private color: number) {
    this.scene.add(new THREE.HemisphereLight(0xcde8ff, 0x7c9a58, 1.6));
    const key = new THREE.DirectionalLight(0xffe3b3, 2.4);
    key.position.set(1, 2, 1);
    this.scene.add(key);
    this.view.scale.setScalar(VIEW_SCALE);
    this.scene.add(this.view);
    this.view.add(this.rig);

    this.right = new Arm(this.view, color, new THREE.Vector3(0.62, -0.7, 0.02), 1);
    this.left = new Arm(this.view, color, new THREE.Vector3(-0.3, -0.85, -0.3), -1);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.rig.add(this.muzzleFlash);

    this.kit = {
      set: new Set<string>(),
      u: 0,
      empty: false,
      cue(u, at, name, fn) {
        if (u >= at && !this.set.has(name)) {
          this.set.add(name);
          fn();
        }
      },
      casing: () => this.ejectCasing(),
      dropPart: (part, vel) => this.dropPart(part, vel),
    };

    // The AWP is the one gun with an optional downloaded model: swap it in when it arrives.
    void loadAwpGlb()
      .then((m) => {
        if (!m) return;
        this.guns.set('awp', { rig: m, anim: GUN_ANIMS.bolt });
        this.credit = m.credit ?? null;
        if (this.id === 'awp') this.equip('awp', this.up, false);
      })
      .catch((e) => console.warn('[awp] GLB failed to load, keeping the built-in rifle', e));
    this.equip('awp', false, false);
  }

  private up = false;

  private load(id: WeaponId): Loaded {
    let g = this.guns.get(id);
    if (!g) {
      const style = WEAPONS[id].style;
      const rig = style === 'bolt' ? buildProceduralAwp(this.color) : GUN_BUILDERS[style]!(this.color);
      rig.root.traverse((o) => (o.castShadow = false));
      g = { rig, anim: GUN_ANIMS[style] };
      this.guns.set(id, g);
    }
    return g;
  }

  /** Put this gun in the hands (with a draw animation unless `draw` is false). A punched gun glows along the barrel. */
  equip(id: WeaponId, punched: boolean, draw = true) {
    if (this.gun) this.rig.remove(this.gun.rig.root);
    this.id = id;
    this.up = punched;
    this.gun = this.load(id);
    this.rig.add(this.gun.rig.root);
    this.gun.rig.root.add(this.glow);
    this.glow.visible = punched;
    this.glow.clear();
    if (punched) {
      const m = this.gun.rig.anchors.muzzle;
      [0.14, 0.2, 0.26].forEach((d, i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034 - i * 0.003, 0.005, 6, 20), this.glowMats[i]);
        ring.position.set(0, m.y, m.z + d);
        this.glow.add(ring);
      });
    }
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).color.set(punched ? MINT : this.gun.anim.flash);
    this.action = null;
    this.shotT = -1;
    if (draw) this.draw();
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  // Triggers from the game

  /** A shot went off. `empty`: it was the last round (a pistol's slide stays back). */
  fire(empty: boolean) {
    this.recoil = 1;
    this.flash = 1;
    this.shotT = 0;
    this.shotEmpty = empty;
    this.shotCues.clear();
    if (this.action?.kind === 'draw') this.action = null;
  }

  /** `dur` seconds of reload; `empty` when the chamber was empty too. */
  reload(dur: number, empty: boolean) {
    this.shotT = -1;
    this.start('reload', dur, empty);
  }

  draw() {
    this.shotT = -1;
    this.start('draw', 0.4, false);
  }

  /** Hold to aim down the sights. */
  setAim(on: boolean) {
    this.aimTarget = on ? 1 : 0;
  }

  land(impact: number) {
    this.dip = Math.min(1, this.dip + impact);
  }

  private start(kind: Action['kind'], dur: number, empty: boolean) {
    this.action = { kind, t: 0, dur, empty, cues: new Set() };
  }

  // ---------------------------------------------------------------------------
  // Per frame

  /** speed: horizontal m/s, grounded: for walk bob, look: mouse delta this frame (radians). */
  update(dt: number, speed: number, grounded: boolean, lookX: number, lookY: number, roll: number) {
    const { rig: g, anim } = this.gun;
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.t >= a.dur) this.action = null;
    }
    if (this.shotT >= 0) {
      this.shotT += dt;
      const end = anim.cycle ? anim.cycle.delay + anim.cycle.dur : 0.25;
      if (this.shotT > end) this.shotT = -1;
    }
    this.aim += (this.aimTarget - this.aim) * Math.min(1, dt * 14);

    if (grounded) this.bobT += dt * Math.min(speed, 12) * 1.1;
    const calm = 1 - this.aim * 0.85; // aiming steadies the gun
    const bobAmt = grounded ? Math.min(speed / 7, 1) * calm : 0;
    this.sway.x += (-lookX * 0.6 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookY * 0.6 - this.sway.y) * Math.min(1, dt * 10);
    if (this.glow.visible) for (const [i, m] of this.glowMats.entries()) m.opacity = 0.55 + 0.4 * Math.sin(performance.now() / 180 - i * 1.2);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.dip = Math.max(0, this.dip - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 16);

    // Base pose (hip or sights) + idle breathing + bob + sway + recoil.
    const t = performance.now() / 1000;
    const kick = this.recoil * this.recoil;
    const hipP = anim.hip.pos;
    const adsP = anim.ads.pos;
    const k = anim.kick;
    this.rig.position.set(
      hipP.x + (adsP.x - hipP.x) * this.aim + Math.sin(this.bobT) * 0.01 * bobAmt + this.sway.x * 0.04 * calm,
      hipP.y + (adsP.y - hipP.y) * this.aim - Math.abs(Math.cos(this.bobT)) * 0.01 * bobAmt + this.sway.y * 0.04 * calm - this.dip * 0.05 + Math.sin(t * 1.6) * 0.002 * calm,
      hipP.z + (adsP.z - hipP.z) * this.aim + kick * k.back,
    );
    this.rig.rotation.set(
      anim.hip.rot.x + (anim.ads.rot.x - anim.hip.rot.x) * this.aim + kick * k.flip * (1 - this.aim * 0.4) + this.sway.y * 0.25 * calm,
      anim.hip.rot.y + (anim.ads.rot.y - anim.hip.rot.y) * this.aim + this.sway.x * 0.35 * calm,
      anim.hip.rot.z + roll * 1.5 * calm + this.sway.x * 0.15 * calm,
    );

    // The gun's own motion.
    const p = this.plan;
    p.reset();
    anim.rest(g);
    const kit = this.kit;
    if (a?.kind === 'reload') {
      kit.set = a.cues;
      kit.empty = a.empty;
      anim.reload(g, a.t / a.dur, p, kit);
    } else if (a?.kind === 'draw') {
      const d = 1 - seg(a.t / a.dur, 0, 1);
      this.rig.position.y -= d * 0.28;
      this.rig.rotation.x -= d * 0.7;
      this.rig.rotation.z += d * 0.3;
    } else if (this.shotT >= 0) {
      kit.set = this.shotCues;
      kit.empty = this.shotEmpty;
      anim.fire(g, this.shotT, p, kit);
    }
    this.rig.position.add(p.pos);
    this.rig.rotation.x += p.rot.x;
    this.rig.rotation.y += p.rot.y;
    this.rig.rotation.z += p.rot.z;

    this.rig.updateMatrixWorld(true);
    this.poseHands(g, p);

    this.muzzleFlash.position.copy(g.anchors.muzzle);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flash;
    this.muzzleFlash.scale.setScalar(0.5 + this.flash * (WEAPONS[this.id].pellets > 1 ? 2.8 : 1.8));

    this.updateDebris(dt);
  }

  private poseHands(g: GunRig, p: Plan) {
    const place = (arm: Arm, useP: boolean, pos: THREE.Vector3, rest: THREE.Vector3, pose: keyof typeof POSES, curl: number, off: number, away: THREE.Vector3) => {
      this.gunToView(this.v.copy(useP ? pos : rest));
      if (off > 0) this.v.lerp(away, off);
      arm.hand.position.copy(this.v);
      this.qa.copy(this.rig.quaternion).multiply(POSES[pose]);
      arm.hand.quaternion.copy(this.qa);
      arm.curl(curl);
      arm.updateForearm();
    };
    place(this.right, p.useR, p.r, g.anchors.grip, p.rPose, p.rCurl, p.rOff, RIGHT_OFFSCREEN);
    place(this.left, p.useL, p.l, g.anchors.fore, p.lPose, p.lCurl, p.lOff, LEFT_OFFSCREEN);
    // A fresh magazine or shell rides in the left hand.
    if (p.carry) {
      this.rig.updateMatrixWorld(true);
      g.root.worldToLocal(this.left.hand.getWorldPosition(this.v2));
      p.carry.position.copy(this.v2).add(p.carryOff);
    }
  }

  /** Gun-space point -> view space (where the hands and debris live). */
  private gunToView(p: THREE.Vector3) {
    return this.view.worldToLocal(this.gun.rig.root.localToWorld(p));
  }

  // ---------------------------------------------------------------------------
  // Debris: spent casings and dropped mags (viewmodel space, purely cosmetic)

  private ejectCasing() {
    const g = this.gun.rig;
    const big = WEAPONS[this.id].pellets > 1;
    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(big ? 0.01 : 0.006, big ? 0.01 : 0.006, big ? 0.045 : 0.05, 8).rotateX(Math.PI / 2),
      new THREE.MeshToonMaterial({ color: big ? 0xc23b32 : 0xd9a84e }),
    );
    this.gunToView(casing.position.copy(g.anchors.eject));
    this.spawnDebris(casing, new THREE.Vector3(0.9 + Math.random() * 0.3, 0.9, 0.15));
  }

  private dropPart(part: THREE.Object3D, vel: THREE.Vector3) {
    const clone = part.clone(true);
    clone.visible = true;
    this.view.worldToLocal(part.getWorldPosition(clone.position));
    clone.quaternion.copy(this.rig.quaternion);
    this.spawnDebris(clone, vel.clone(), 0.4);
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
