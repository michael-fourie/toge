import * as THREE from 'three';
import { toonRamp } from './textures.ts';

/**
 * First-person sniper, drawn in its own scene/camera after the world so it never clips into walls.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly gun = new THREE.Group();
  private readonly muzzleFlash: THREE.Mesh;
  private bobT = 0;
  private sway = new THREE.Vector2();
  private recoil = 0;
  private dip = 0;
  private flash = 0;

  constructor(color: number) {
    // Warm sun + cool sky fill, matching the world lighting.
    this.scene.add(new THREE.HemisphereLight(0xcde8ff, 0x7c9a58, 1.5));
    const key = new THREE.DirectionalLight(0xffe3b3, 2.4);
    key.position.set(1, 2, 1);
    this.scene.add(key);

    // A hand-made, slightly storybook rifle: walnut wood, dark iron, brass scope, a cloth wrap in your colour.
    const gradientMap = toonRamp();
    const dark = new THREE.MeshToonMaterial({ color: 0x4a4a52, gradientMap });
    const wood = new THREE.MeshToonMaterial({ color: 0xa8683a, gradientMap });
    const brass = new THREE.MeshToonMaterial({ color: 0xd9a84e, gradientMap });
    const cloth = new THREE.MeshToonMaterial({ color, gradientMap });
    const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.gun.add(mesh);
      return mesh;
    };
    part(0.07, 0.11, 0.5, wood, 0, 0, 0.05); // body
    part(0.065, 0.16, 0.24, wood, 0, -0.03, 0.38); // stock
    part(0.078, 0.118, 0.09, cloth, 0, 0, -0.12); // cloth wrap
    part(0.07, 0.165, 0.035, cloth, 0, -0.03, 0.3); // stock band
    part(0.03, 0.03, 0.75, dark, 0, 0.02, -0.55); // barrel
    part(0.045, 0.045, 0.08, dark, 0, 0.02, -0.92); // muzzle brake
    part(0.04, 0.1, 0.05, dark, 0, -0.09, 0.08); // grip
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 14), brass);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.02);
    this.gun.add(scope);
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark);
    bolt.position.set(0.06, 0.03, 0.12);
    this.gun.add(bolt);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0 }),
    );
    this.muzzleFlash.position.set(0, 0.02, -1.0);
    this.gun.add(this.muzzleFlash);

    this.gun.scale.setScalar(0.42);
    this.scene.add(this.gun);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  fire() {
    this.recoil = 1;
    this.flash = 1;
  }

  land(impact: number) {
    this.dip = Math.min(1, this.dip + impact);
  }

  /** speed: horizontal m/s, grounded: for walk bob, look: mouse delta this frame (radians). */
  update(dt: number, speed: number, grounded: boolean, lookX: number, lookY: number, roll: number) {
    if (grounded) this.bobT += dt * Math.min(speed, 12) * 1.1;
    const bobAmt = grounded ? Math.min(speed / 8, 1) : 0;
    this.sway.x += (-lookX * 0.6 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookY * 0.6 - this.sway.y) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 3.2);
    this.dip = Math.max(0, this.dip - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 14);

    const r = this.recoil * this.recoil;
    this.gun.position.set(
      0.15 + Math.sin(this.bobT) * 0.012 * bobAmt + this.sway.x * 0.05,
      -0.15 - Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt + this.sway.y * 0.05 - this.dip * 0.06,
      -0.58 + r * 0.08,
    );
    this.gun.rotation.set(r * 0.35 + this.sway.y * 0.3, this.sway.x * 0.4, roll * 1.5 + this.sway.x * 0.2);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flash;
    this.muzzleFlash.scale.setScalar(0.6 + this.flash * 1.4);
  }
}
