import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pbr } from '../render/surface.ts';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A soft storybook arm: sleeve in the player's colour, cuff, and a mitten-ish hand with curled fingers.
 * The hand is posed directly (position + rotation in viewmodel space); the forearm is stretched each
 * frame from a fixed off-screen elbow to the wrist, which reads as a convincing arm without real IK.
 */
export class Arm {
  readonly hand = new THREE.Group();
  readonly forearm: THREE.Mesh;
  private readonly cuff: THREE.Mesh;
  private readonly fingers: THREE.Group[] = [];
  private readonly wrist = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    scene: THREE.Object3D,
    sleeve: number,
    readonly elbow: THREE.Vector3,
    side: 1 | -1,
  ) {
    const skin = pbr({ color: 0xf3c9a5 });
    const cloth = pbr({ color: sleeve });
    const cuffMat = pbr({ color: 0xf4ead2 });

    // Palm: flat box, normal along -Y; fingers extend along -Z.
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.068, 0.03, 0.075, 2, 0.012), skin);
    this.hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group();
      f.position.set(-0.024 + i * 0.016, -0.002, -0.036);
      const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.022, 3, 8).rotateX(Math.PI / 2), skin);
      seg1.position.z = -0.016;
      const tip = new THREE.Group();
      tip.position.z = -0.03;
      const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.016, 3, 8).rotateX(Math.PI / 2), skin);
      seg2.position.z = -0.012;
      tip.add(seg2);
      f.add(seg1, tip);
      this.fingers.push(f);
      this.hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.03, 3, 8).rotateX(Math.PI / 2), skin);
    thumb.position.set(side * -0.036, -0.004, -0.02);
    thumb.rotation.y = side * 0.6;
    this.hand.add(thumb);

    this.forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 1, 14, 1, true), cloth);
    this.cuff = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.008, 8, 18), cuffMat);
    scene.add(this.hand, this.forearm, this.cuff);
  }

  /** 0 = open, 1 = fist. */
  curl(amount: number) {
    for (const f of this.fingers) {
      f.rotation.x = -amount * 1.1;
      (f.children[1] as THREE.Object3D).rotation.x = -amount * 1.2;
    }
  }

  /** Call after posing the hand: stretches the sleeve from the elbow to the wrist. */
  updateForearm() {
    this.hand.updateMatrixWorld();
    this.hand.localToWorld(this.wrist.set(0, 0.004, 0.05));
    this.dir.subVectors(this.wrist, this.elbow);
    const len = this.dir.length();
    this.forearm.position.copy(this.elbow).addScaledVector(this.dir, 0.5);
    this.forearm.scale.set(1, len, 1);
    this.forearm.quaternion.setFromUnitVectors(UP, this.dir.normalize());
    this.cuff.position.copy(this.wrist).addScaledVector(this.dir, -0.01);
    this.cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
  }
}
