// The open world's traffic on screen (kanjo/shared/worldtraffic.ts): every car is a stock Pebble, the default car.
// Near the camera they're the real Pebble model, baked once into one instanced mesh per material and painted per
// car; further out a cheap painted box stands in, and past that they're not drawn at all. A Pebble is ~30k triangles,
// so the full models skip cars out of view, and only those close enough to throw a shadow the shadow map can hold
// cast one (SHADOW_NEAR): that took the traffic from ~1.5M triangles a frame to a few hundred thousand.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carSpec, newOwnedCar } from '../shared/cars.ts';
import { newPose } from '../shared/traffic.ts';
import type { World } from '../shared/world.ts';
import { routePose } from '../shared/worldtraffic.ts';
import { buildCar } from './carmodel.ts';
import { isShared } from './carparts.ts';

/** Everyday paint: mostly white, silver and black, the odd colour. */
const PAINT = [0xf2f2f0, 0xf2f2f0, 0xe8e8e4, 0xa9b0b8, 0x9aa3ad, 0x1a1c20, 0x23262b, 0x1e3a6e, 0x8a1c22, 0x2f4a3a, 0xc9b48a, 0x3b6fb6, 0xd8c23a];
/** Full Pebbles within this far of the camera, boxes out to the second (m); Low graphics draws less. */
const DRAW_HIGH: [number, number] = [260, 1100];
const DRAW_LOW: [number, number] = [140, 700];
/** At most this many full Pebbles at once (the nearest win: the list is filled in route order, so it's rough). */
const MAX_NEAR = 90;
/**
 * Full Pebbles this close cast shadows (the sun's shadow box reaches ~45 m round the camera; further out a car's
 * shadow falls outside it), and are drawn even when just out of view (the camera can swing onto them before the next
 * frame's cull, which reads last frame's camera). Past it, cars outside the view aren't drawn.
 */
const SHADOW_NEAR = 75;
/** A car's bounding sphere for the view test (m), with room for a frame of camera swing. */
const CULL_R = 5;

/** The Pebble's meshes in root space, merged by material (only position, normal and uv kept). */
function bakePebble(): { geo: THREE.BufferGeometry; mat: THREE.Material; paint: boolean; own: boolean }[] {
  const owned = newOwnedCar('pebble');
  const model = buildCar(owned, null);
  model.root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || Array.isArray(m.material)) return;
    // Hidden parts (the cabin interior is shown only from inside) and see-through shadow blobs stay out.
    let shown = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) shown = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!shown || (mat.transparent && mat.opacity < 0.9 && !('transmission' in mat))) return;
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.morphAttributes = {};
    g.applyMatrix4(m.matrixWorld);
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat)!.push(g);
  });
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material; paint: boolean; own: boolean }[] = [];
  // The paint by area: the material whose meshes hold the most triangles among the coloured ones.
  let best = 0;
  let paintMat: THREE.Material | null = null;
  for (const [mat, geos] of groups) {
    const tris = geos.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const c = (mat as THREE.MeshStandardMaterial).color;
    if (c && !(mat as THREE.MeshStandardMaterial).map && c.r + c.g + c.b > 0.6 && tris > best && !(mat as THREE.MeshPhysicalMaterial).transmission) {
      best = tris;
      paintMat = mat;
    }
  }
  for (const [mat, geos] of groups) {
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    if (mat === paintMat) {
      // Painted per car: a white copy of the paint, tinted by each instance's colour.
      const m = (mat as THREE.MeshStandardMaterial).clone();
      m.color.set(0xffffff);
      out.push({ geo, mat: m, paint: true, own: true });
    } else out.push({ geo, mat, paint: false, own: !isShared(mat) });
  }
  return out;
}

export class WorldTrafficView {
  /** The full Pebble, per material: `close` cars cast shadows, `near` ones don't. */
  private close: THREE.InstancedMesh[] = [];
  private near: THREE.InstancedMesh[] = [];
  private paint: THREE.InstancedMesh | null = null;
  private closePaint: THREE.InstancedMesh | null = null;
  private frustum = new THREE.Frustum();
  private viewProj = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), CULL_R);
  private far: THREE.InstancedMesh;
  private colors: THREE.Color[][] = [];
  private disposables: { dispose(): void }[] = [];
  private pose = newPose();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private draw: [number, number];
  private cg: number;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    low: boolean,
  ) {
    this.draw = low ? DRAW_LOW : DRAW_HIGH;
    this.cg = carSpec(newOwnedCar('pebble')).cg;
    let total = 0;
    for (const r of world.routes) {
      this.colors.push(r.cars.map((c) => new THREE.Color(PAINT[c.paint % PAINT.length])));
      total += r.cars.length;
    }
    // The model's own materials stay in use here (its geometry was copied, so the model itself is dropped).
    for (const { geo, mat, paint, own } of bakePebble()) {
      for (const shadow of [true, false]) {
        const mesh = new THREE.InstancedMesh(geo, mat, MAX_NEAR);
        mesh.castShadow = shadow && !low;
        mesh.receiveShadow = !low;
        mesh.frustumCulled = false;
        mesh.count = 0;
        if (paint) {
          mesh.setColorAt(0, new THREE.Color());
          if (shadow) this.closePaint = mesh;
          else this.paint = mesh;
        }
        scene.add(mesh);
        (shadow ? this.close : this.near).push(mesh);
      }
      if (own) this.disposables.push(mat);
      this.disposables.push(geo);
    }
    // The far stand-in: a rounded-off box the Pebble's size, with a darker glasshouse on top.
    const body = new THREE.BoxGeometry(1.7, 0.75, 3.9).toNonIndexed();
    body.translate(0, 0.62, 0);
    const cabin = new THREE.BoxGeometry(1.45, 0.5, 2.0).toNonIndexed();
    cabin.translate(0, 1.22, 0.25);
    const shade = (g: THREE.BufferGeometry, k: number) => {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(k), 3));
      g.deleteAttribute('uv');
      return g;
    };
    const boxGeo = mergeGeometries([shade(body, 1), shade(cabin, 0.18)], false)!;
    body.dispose();
    cabin.dispose();
    const boxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.far = new THREE.InstancedMesh(boxGeo, boxMat, total);
    this.far.setColorAt(0, new THREE.Color());
    this.far.frustumCulled = false;
    this.far.count = 0;
    this.disposables.push(boxGeo, boxMat);
    scene.add(this.far);
  }

  /** Poses the traffic at `time` on the roam clock around the camera (as of its last frame: its view culls the full models). */
  update(time: number, camera: THREE.Camera) {
    const { pose, m4, q, v, one, up, world } = this;
    const [nearD, farD] = this.draw;
    const near2 = nearD * nearD;
    const far2 = farD * farD;
    const shadow2 = SHADOW_NEAR * SHADOW_NEAR;
    const cx = camera.position.x;
    const cz = camera.position.z;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let nc = 0;
    let nn = 0;
    let nf = 0;
    for (let ri = 0; ri < world.routes.length; ri++) {
      const r = world.routes[ri];
      for (let k = 0; k < r.cars.length; k++) {
        routePose(r, k, time, pose);
        const d2 = (pose.x - cx) ** 2 + (pose.z - cz) ** 2;
        if (d2 > far2) continue;
        q.setFromAxisAngle(up, pose.yaw);
        const color = this.colors[ri][k];
        if (d2 < near2 && nc + nn < MAX_NEAR) {
          v.set(pose.x, pose.y + this.cg, pose.z);
          const close = d2 < shadow2;
          if (!close && !this.frustum.intersectsSphere(this.sphere.set(v, CULL_R))) continue;
          m4.compose(v, q, one);
          if (close) {
            for (const m of this.close) m.setMatrixAt(nc, m4);
            this.closePaint?.setColorAt(nc, color);
            nc++;
          } else {
            for (const m of this.near) m.setMatrixAt(nn, m4);
            this.paint?.setColorAt(nn, color);
            nn++;
          }
        } else {
          m4.compose(v.set(pose.x, pose.y, pose.z), q, one);
          this.far.setMatrixAt(nf, m4);
          this.far.setColorAt(nf, color);
          nf++;
        }
      }
    }
    for (const [set, n] of [[this.close, nc], [this.near, nn]] as const)
      for (const m of set) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    for (const m of [this.paint, this.closePaint]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    this.far.count = nf;
    this.far.instanceMatrix.needsUpdate = true;
    if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of [...this.close, ...this.near]) {
      this.scene.remove(m);
      m.dispose();
    }
    this.scene.remove(this.far);
    this.far.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
