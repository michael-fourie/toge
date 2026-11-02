// City traffic on screen: one instanced mesh per kind of vehicle (painted per car) and one for every car's
// lamps, posed each frame from the shared traffic clock (shared/race/traffic.ts).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '../../shared/race/track.ts';
import { TRAFFIC_KINDS, type Traffic, type TrafficKind, newPose, trafficPose } from '../../shared/race/traffic.ts';

/** Everyday paint: mostly white, silver and black, the odd colour. */
const PAINT = [0xf2f2f0, 0xf2f2f0, 0xe8e8e4, 0xa9b0b8, 0x9aa3ad, 0x1a1c20, 0x23262b, 0x1e3a6e, 0x8a1c22, 0x2f4a3a, 0xc9b48a, 0x3b6fb6];
/** Trucks: white or silver boxes. */
const TRUCK_PAINT = [0xf4f4f2, 0xe6e6e2, 0xb8bec4];

/** A box from (x0, y0, z0) to (x1, y1, z1), tinted; `taper` pulls its top in (a cabin). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: number, taper = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (taper && p.getY(i) > 0) {
      p.setX(i, p.getX(i) * (1 - taper));
      p.setZ(i, p.getZ(i) * (1 - taper * 1.6));
    }
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.computeVertexNormals();
  const c = new THREE.Color(rgb);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function wheels(len: number, width: number, r: number, axles: number[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const z of axles)
    for (const side of [-1, 1]) {
      const w = new THREE.CylinderGeometry(r, r, 0.24, 12).toNonIndexed();
      w.rotateZ(Math.PI / 2);
      w.translate(side * (width / 2 - 0.12), r, z * len);
      const col = new Float32Array(w.getAttribute('position').count * 3).fill(0.04);
      w.setAttribute('color', new THREE.BufferAttribute(col, 3));
      w.deleteAttribute('uv');
      out.push(w);
    }
  return out;
}

/** Body (white where it takes the paint, dark glass and trim) and lamps, nose toward -z, wheels on y = 0. */
function shape(kind: TrafficKind): { body: THREE.BufferGeometry; lamps: THREE.BufferGeometry } {
  const { len, width: w, height: h } = TRAFFIC_KINDS[kind];
  const L = len / 2;
  const hw = w / 2;
  const body: THREE.BufferGeometry[] = [];
  const glass = 0x101318;
  const trim = 0x2a2c30;
  // Lamps: [z of the face, y, width of each lamp, height, colour]
  let lamps: [number, number, number, number, number][];
  if (kind === 'sedan') {
    body.push(box(-hw, 0.3, -L, hw, 0.95, L, 0xffffff));
    body.push(box(-hw + 0.08, 0.95, -L * 0.42, hw - 0.08, h, L * 0.5, glass, 0.12));
    body.push(box(-hw + 0.14, h - 0.02, -L * 0.3, hw - 0.14, h + 0.01, L * 0.38, 0xffffff));
    body.push(box(-hw - 0.01, 0.3, -L - 0.04, hw + 0.01, 0.48, -L + 0.2, trim), box(-hw - 0.01, 0.3, L - 0.2, hw + 0.01, 0.48, L + 0.04, trim));
    body.push(...wheels(len, w, 0.32, [-0.31, 0.31]));
    lamps = [
      [-L - 0.05, 0.78, 0.42, 0.14, 0xfff1d0],
      [L + 0.05, 0.8, 0.4, 0.14, 0xff1a0a],
    ];
  } else if (kind === 'kei') {
    body.push(box(-hw, 0.28, -L, hw, 1.15, L, 0xffffff));
    body.push(box(-hw + 0.04, 1.15, -L + 0.35, hw - 0.04, h, L - 0.05, glass, 0.05));
    body.push(box(-hw + 0.06, h - 0.02, -L + 0.45, hw - 0.06, h + 0.02, L - 0.1, 0xffffff));
    body.push(box(-hw - 0.01, 0.28, -L - 0.04, hw + 0.01, 0.45, -L + 0.15, trim));
    body.push(...wheels(len, w, 0.28, [-0.32, 0.32]));
    lamps = [
      [-L - 0.05, 0.9, 0.3, 0.2, 0xfff1d0],
      [L + 0.05, 0.75, 0.16, 0.36, 0xff1a0a],
    ];
  } else {
    // A cab-over box truck: the cab takes the paint, the box is its own white.
    const cab = 1.9;
    body.push(box(-hw + 0.05, 0.45, -L, hw - 0.05, 1.5, -L + cab, 0xffffff));
    body.push(box(-hw + 0.05, 1.5, -L + 0.1, hw - 0.05, 2.35, -L + cab, glass, 0.04));
    body.push(box(-hw, 0.6, -L + cab + 0.1, hw, h, L, 0xffffff));
    body.push(box(-hw + 0.1, 0.35, -L, hw - 0.1, 0.6, L, trim));
    body.push(...wheels(len, w - 0.1, 0.42, [-0.36, 0.2, 0.36]));
    lamps = [
      [-L - 0.05, 0.75, 0.3, 0.16, 0xfff1d0],
      [L + 0.05, 0.75, 0.22, 0.22, 0xff1a0a],
    ];
  }
  const quads: THREE.BufferGeometry[] = [];
  for (const [z, y, lw, lh, rgb] of lamps)
    for (const side of [-1, 1]) {
      const q = new THREE.PlaneGeometry(lw, lh).toNonIndexed();
      if (z > 0) q.rotateY(Math.PI); // never mind the facing: the lamps' material is double-sided
      q.translate(side * (hw - 0.12 - lw / 2), y, z);
      const c = new THREE.Color(rgb);
      const col = new Float32Array(q.getAttribute('position').count * 3);
      for (let i = 0; i < q.getAttribute('position').count; i++) col.set([c.r, c.g, c.b], i * 3);
      q.setAttribute('color', new THREE.BufferAttribute(col, 3));
      q.deleteAttribute('uv');
      quads.push(q);
    }
  const merged = mergeGeometries(body, false)!;
  const lampGeo = mergeGeometries(quads, false)!;
  for (const g of [...body, ...quads]) g.dispose();
  return { body: merged, lamps: lampGeo };
}

export class TrafficView {
  private meshes: { kind: TrafficKind; body: THREE.InstancedMesh; lamps: THREE.InstancedMesh; cars: number[] }[] = [];
  private disposables: { dispose(): void }[] = [];
  private pose = newPose();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private scene: THREE.Scene,
    private track: Track,
    private traffic: Traffic,
  ) {
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, envMapIntensity: 1.4 });
    // Brighter than white, so they bloom at night.
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(9, 9, 9), side: THREE.DoubleSide });
    this.disposables.push(bodyMat, lampMat);
    const paint = new THREE.Color();
    for (const kind of Object.keys(TRAFFIC_KINDS) as TrafficKind[]) {
      const cars = traffic.cars.flatMap((c, i) => (c.kind === kind ? [i] : []));
      if (!cars.length) continue;
      const { body, lamps } = shape(kind);
      this.disposables.push(body, lamps);
      const bm = new THREE.InstancedMesh(body, bodyMat, cars.length);
      const lm = new THREE.InstancedMesh(lamps, lampMat, cars.length);
      cars.forEach((ci, k) => {
        const p = traffic.cars[ci].paint;
        bm.setColorAt(k, paint.setHex(kind === 'truck' ? TRUCK_PAINT[p % TRUCK_PAINT.length] : PAINT[p % PAINT.length]));
      });
      bm.castShadow = true;
      bm.receiveShadow = true;
      // They move all over the map: skip the per-mesh culling (bounding spheres would go stale).
      bm.frustumCulled = lm.frustumCulled = false;
      scene.add(bm, lm);
      this.meshes.push({ kind, body: bm, lamps: lm, cars });
    }
  }

  /** Poses every car at `time` on the race clock. */
  update(time: number) {
    const { pose, m4, q, v, one, up, track, traffic } = this;
    for (const m of this.meshes)
      m.cars.forEach((ci, k) => {
        trafficPose(track, traffic, traffic.cars[ci], time, pose);
        q.setFromAxisAngle(up, pose.yaw);
        m4.compose(v.set(pose.x, pose.y, pose.z), q, one);
        m.body.setMatrixAt(k, m4);
        m.lamps.setMatrixAt(k, m4);
      });
    for (const m of this.meshes) {
      m.body.instanceMatrix.needsUpdate = true;
      m.lamps.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m.body, m.lamps);
      m.body.dispose();
      m.lamps.dispose();
    }
    for (const d of this.disposables) d.dispose();
  }
}
