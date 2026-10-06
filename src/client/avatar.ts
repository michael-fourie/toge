import * as THREE from 'three';
import { PLAYER } from '../shared/constants.ts';
import { toonRamp } from './textures.ts';

const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.95, 6, 12);
const headGeo = new THREE.SphereGeometry(PLAYER.headRadius, 16, 12);
const eyeGeo = new THREE.SphereGeometry(0.09, 12, 8);
const pupilGeo = new THREE.SphereGeometry(0.045, 8, 6);
const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 1.1);
const scopeGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.35, 10);
const cheekGeo = new THREE.CircleGeometry(0.05, 12);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfffdf6 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x2b2118 });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xf29a9a, transparent: true, opacity: 0.7 });
const gunMat = new THREE.MeshToonMaterial({ color: 0x8a5a34, gradientMap: toonRamp() });
const scopeMat = new THREE.MeshToonMaterial({ color: 0xd9a84e, gradientMap: toonRamp() });

/** A goofy bean with googly eyes and a sniper rifle. */
export class Avatar {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly pupils: THREE.Mesh[] = [];
  private slideAmt = 0;
  private nameTag?: THREE.Sprite;

  constructor(
    readonly color: number,
    name?: string,
  ) {
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 0.36 + 0.95 / 2;
    body.castShadow = true;

    const headMesh = new THREE.Mesh(headGeo, mat);
    headMesh.castShadow = true;
    this.head.position.y = PLAYER.headCenter;
    this.head.add(headMesh);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.11, 0.06, -0.23);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(0, 0, -0.06);
      eye.add(pupil);
      this.pupils.push(pupil);
      this.head.add(eye);
      const cheek = new THREE.Mesh(cheekGeo, cheekMat); // rosy cheeks, very important
      cheek.position.set(side * 0.17, -0.07, -0.215);
      cheek.rotation.y = Math.PI + side * 0.6;
      this.head.add(cheek);
    }

    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(gunGeo, gunMat);
    const scope = new THREE.Mesh(scopeGeo, scopeMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, 0.05);
    gun.add(barrel, scope);
    gun.position.set(0.22, -0.2, -0.35);
    this.head.add(gun); // gun follows aim pitch

    this.lean.add(body, this.head);
    this.root.add(this.lean);

    if (name) {
      this.nameTag = makeNameTag(name, color);
      this.nameTag.position.y = 2.25;
      this.root.add(this.nameTag);
    }
  }

  /**
   * Pose from network state. `wallSide` tilts the body into the wall: -1 left, 1 right, 0 none.
   * `sliding` leans the bean back on its heels, baseball-slide style.
   */
  pose(x: number, y: number, z: number, yaw: number, pitch: number, wallSide: number, time: number, sliding = false) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.lean.rotation.z += (wallSide * 0.35 - this.lean.rotation.z) * 0.2;
    this.slideAmt += ((sliding ? 1 : 0) - this.slideAmt) * 0.25;
    this.lean.rotation.x = this.slideAmt * 0.95; // positive X tips the top toward +Z, i.e. backwards
    this.lean.scale.set(1 + this.slideAmt * 0.08, 1 - this.slideAmt * 0.12, 1 + this.slideAmt * 0.08);
    this.head.rotation.x = pitch - this.slideAmt * 0.95; // keep looking where they aim
    // Googly eyes wobble around on their own. Very important feature.
    this.pupils.forEach((p, i) => {
      p.position.x = Math.sin(time * 9 + i * 2.1 + x) * 0.025;
      p.position.y = Math.cos(time * 7 + i * 1.3 + z) * 0.025;
    });
  }

  /** A copy without the name tag, for flinging across the map. */
  cloneBody(): THREE.Group {
    const g = new THREE.Group();
    const inner = this.lean.clone(true);
    g.add(inner);
    return g;
  }

  dispose() {
    this.root.removeFromParent();
    if (this.nameTag) {
      this.nameTag.material.map?.dispose();
      this.nameTag.material.dispose();
    }
  }
}

function makeNameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px "Zen Maru Gothic", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(52,38,26,0.8)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Depth-tested on purpose: tags showing through walls would be a free wallhack.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface Corpse {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Ragdoll-ish corpses: no physics, just yeeted along the shot direction, spinning, until they fall away. */
export class Corpses {
  readonly list: Corpse[] = [];
  constructor(private scene: THREE.Scene) {}

  spawn(body: THREE.Object3D, pos: THREE.Vector3, yaw: number, dir: THREE.Vector3, power: number): Corpse {
    body.position.copy(pos);
    body.rotation.y = yaw;
    this.scene.add(body);
    const vel = dir.clone().multiplyScalar(power).add(new THREE.Vector3(0, power * 0.35 + 4, 0));
    const spin = new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    const c = { obj: body, vel, spin, life: 4 };
    this.list.push(c);
    return c;
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.life -= dt;
      c.vel.y -= 14 * dt;
      c.obj.position.addScaledVector(c.vel, dt);
      c.obj.rotation.x += c.spin.x * dt;
      c.obj.rotation.y += c.spin.y * dt;
      c.obj.rotation.z += c.spin.z * dt;
      if (c.life < 0.5) c.obj.scale.setScalar(Math.max(0.001, c.life * 2));
      if (c.life <= 0) {
        c.obj.removeFromParent();
        this.list.splice(i, 1);
      }
    }
  }
}
