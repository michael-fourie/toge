import * as THREE from 'three';

const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const hookGeo = new THREE.SphereGeometry(0.07, 8, 6);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0xf6ead2 });
const hookMat = new THREE.MeshBasicMaterial({ color: 0x4a3726 });

/** A grapple line (cream rope + a little hook where it bites), drawn between two world points. */
export class Rope {
  readonly group = new THREE.Group();
  private line = new THREE.Mesh(ropeGeo, ropeMat);
  private hook = new THREE.Mesh(hookGeo, hookMat);

  constructor(parent: THREE.Object3D) {
    this.group.add(this.line, this.hook);
    this.group.visible = false;
    parent.add(this.group);
  }

  /** `to` null hides it; `hook` false draws a bare line (a miss that's still flying). */
  set(from: THREE.Vector3, to: THREE.Vector3 | null, hook = true) {
    this.group.visible = !!to;
    if (!to) return;
    this.line.position.copy(from);
    this.line.lookAt(to);
    this.line.scale.set(1, 1, from.distanceTo(to));
    this.hook.position.copy(to);
    this.hook.visible = hook;
  }

  dispose() {
    this.group.removeFromParent();
  }
}
