// Physics mode, drawn: dents in the body where a car was hit, smoke from a broken engine, and the explosion
// when it's wrecked (fireball, black cloud, flying debris and a flash). The rules are in shared/damage.ts.
//
// Dents move the body's own vertices (every car's merged body geometry is its own, see mergeByMaterial), pushing
// them in round the impact with a little noise so the metal crumples, and give the moved triangles flat
// normals so the creases catch the light. Nothing is allocated per frame; a dent costs one pass over the body's
// vertices (~1 ms), only on a hit that did damage. `repair()` puts the body back when the car respawns.

import * as THREE from 'three';
import { type Track, heightAt } from '../shared/track.ts';
import type { V3 } from '../shared/vehicle.ts';
import type { Effects } from './effects.ts';

/** How far any point of the body can be pushed in (m), however many hits it takes. */
const MAX_PUSH = 0.42;

interface BodyMesh {
  pos: THREE.BufferAttribute;
  nrm: THREE.BufferAttribute;
  /** The undamaged positions and normals, kept from the first dent. */
  pos0: Float32Array | null;
  nrm0: Float32Array | null;
  /** How far each vertex has been pushed in so far. */
  pushed: Float32Array | null;
}

/** Repeatable noise from a position (rounded to 1 cm, so the copies of a vertex in a non-indexed mesh agree). */
function noise(x: number, y: number, z: number): number {
  const h = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

export class CarDents {
  private meshes: BodyMesh[] = [];
  private dirty = false;

  /** `body` is the model's body group (body space, offset from the CG by its position). */
  constructor(private body: THREE.Object3D) {
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.solo) return;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      const nrm = m.geometry.getAttribute('normal') as THREE.BufferAttribute;
      if (pos && nrm && !m.geometry.index) this.meshes.push({ pos, nrm, pos0: null, nrm0: null, pushed: null });
    });
  }

  /**
   * Pushes the body in round `p` (car space: from the CG, forward is -z) along `n` (unit, pointing into the
   * car) by up to `depth` metres, fading out over `radius`.
   */
  dent(p: V3, n: V3, depth: number, radius: number) {
    const o = this.body.position;
    const px = p.x - o.x;
    const py = p.y - o.y;
    const pz = p.z - o.z;
    const r2 = radius * radius;
    // Mostly horizontal: cars are hit from the side, not from above.
    const nl = Math.hypot(n.x, n.z) || 1;
    const nx = n.x / nl;
    const nz = n.z / nl;
    for (const m of this.meshes) {
      const a = m.pos.array as Float32Array;
      const count = m.pos.count;
      let moved = false;
      for (let i = 0; i < count; i++) {
        const x = a[i * 3];
        const y = a[i * 3 + 1];
        const z = a[i * 3 + 2];
        const dx = x - px;
        const dy = (y - py) * 0.7;
        const dz = z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        if (!m.pos0) {
          m.pos0 = a.slice();
          m.nrm0 = (m.nrm.array as Float32Array).slice();
          m.pushed = new Float32Array(count);
        }
        const f = (1 - d2 / r2) ** 2;
        const crumple = noise(m.pos0[i * 3], m.pos0[i * 3 + 1], m.pos0[i * 3 + 2]);
        let push = depth * f * (0.75 + 0.45 * crumple);
        push = Math.max(0, Math.min(push, MAX_PUSH - m.pushed![i]));
        if (push <= 1e-4) continue;
        m.pushed![i] += push;
        a[i * 3] = x + nx * push;
        a[i * 3 + 1] = y - push * 0.18 * (1 + crumple); // panels sag as they fold
        a[i * 3 + 2] = z + nz * push;
        moved = true;
      }
      if (!moved) continue;
      this.creases(m);
      m.pos.needsUpdate = true;
      m.nrm.needsUpdate = true;
      this.dirty = true;
    }
  }

  /** Flat normals on every triangle that has moved: folded metal shows its facets. */
  private creases(m: BodyMesh) {
    const a = m.pos.array as Float32Array;
    const nn = m.nrm.array as Float32Array;
    const pushed = m.pushed!;
    for (let t = 0; t < m.pos.count; t += 3) {
      if (pushed[t] < 0.004 && pushed[t + 1] < 0.004 && pushed[t + 2] < 0.004) continue;
      const i = t * 3;
      const ux = a[i + 3] - a[i];
      const uy = a[i + 4] - a[i + 1];
      const uz = a[i + 5] - a[i + 2];
      const vx = a[i + 6] - a[i];
      const vy = a[i + 7] - a[i + 1];
      const vz = a[i + 8] - a[i + 2];
      let cx = uy * vz - uz * vy;
      let cy = uz * vx - ux * vz;
      let cz = ux * vy - uy * vx;
      const l = Math.hypot(cx, cy, cz);
      if (l < 1e-9) continue;
      cx /= l;
      cy /= l;
      cz /= l;
      // Keep it facing the way the original surface did (winding isn't the same on every part).
      const o = m.nrm0!;
      if (cx * o[i] + cy * o[i + 1] + cz * o[i + 2] < 0) {
        cx = -cx;
        cy = -cy;
        cz = -cz;
      }
      for (let k = 0; k < 3; k++) {
        nn[i + k * 3] = cx;
        nn[i + k * 3 + 1] = cy;
        nn[i + k * 3 + 2] = cz;
      }
    }
  }

  /** Back to factory: the car respawned. */
  repair() {
    if (!this.dirty) return;
    for (const m of this.meshes) {
      if (!m.pos0) continue;
      (m.pos.array as Float32Array).set(m.pos0);
      (m.nrm.array as Float32Array).set(m.nrm0!);
      m.pushed!.fill(0);
      m.pos.needsUpdate = true;
      m.nrm.needsUpdate = true;
    }
    this.dirty = false;
  }
}

const DEBRIS = 48;
const GRAVITY = 9.8;
const FLASH = 9000;

/**
 * Explosions: a fireball and a black cloud (through Effects), chunks of the car flying off and bouncing down the
 * road (one instanced draw call), and an orange flash. The flash is a light that's always in the scene at zero
 * (adding one mid-race would recompile every shader), so only build this when Physics mode is on.
 */
export class Blasts {
  private debris: THREE.InstancedMesh;
  private dp = new Float32Array(DEBRIS * 3);
  private dv = new Float32Array(DEBRIS * 3);
  private spin = new Float32Array(DEBRIS * 3);
  private rot = new Float32Array(DEBRIS * 3);
  private size = new Float32Array(DEBRIS);
  private age = new Float32Array(DEBRIS).fill(99);
  private next = 0;
  private light = new THREE.PointLight(0xff7a2a, 0, 70, 1.6);
  private flash = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private track: Track,
    private fx: Effects,
  ) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.4 });
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 0.8), mat, DEBRIS);
    this.debris.frustumCulled = false;
    this.debris.castShadow = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < DEBRIS; i++) {
      this.debris.setMatrixAt(i, this.m);
      this.debris.setColorAt(i, this.c.set(0x222222));
    }
    scene.add(this.debris, this.light);
  }

  /** A car blew up at (x, y, z) moving at (vx, vz); `paint` colours some of the debris. */
  boom(x: number, y: number, z: number, vx: number, vz: number, paint: number) {
    const fx = this.fx;
    // Fireball: hot cores (brighter than white, so they bloom) thrown out in every direction.
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = 3 + Math.random() * 9;
      const hot = Math.random();
      fx.spark(x, y + 0.6, z, vx * 0.4 + Math.cos(a) * sp * (1 - up * 0.5), up * sp * 0.9, vz * 0.4 + Math.sin(a) * sp * (1 - up * 0.5), [6 + hot * 4, 2.2 + hot * 2.4, 0.4 + hot * 0.4], 0.45 + Math.random() * 0.5, 2.2 + Math.random() * 2.2);
    }
    // The cloud: black, rolling up and out.
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      const g = 0.03 + Math.random() * 0.05;
      fx.plume(x + Math.cos(a) * 0.8, y + 0.5 + Math.random(), z + Math.sin(a) * 0.8, vx * 0.25 + Math.cos(a) * sp, 2 + Math.random() * 3.5, vz * 0.25 + Math.sin(a) * sp, [g, g, g * 1.1], 2.2, 7 + Math.random() * 5, 2.5 + Math.random() * 2, 0.85);
    }
    // Chunks of the car.
    this.c.setHex(paint);
    for (let i = 0; i < 16; i++) {
      const k = this.next;
      this.next = (this.next + 1) % DEBRIS;
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 9;
      this.dp.set([x, y + 0.5, z], k * 3);
      this.dv.set([vx * 0.6 + Math.cos(a) * sp, 4 + Math.random() * 8, vz * 0.6 + Math.sin(a) * sp], k * 3);
      this.spin.set([(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18], k * 3);
      this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], k * 3);
      this.size[k] = 0.2 + Math.random() * 0.45;
      this.age[k] = 0;
      this.debris.setColorAt(k, i % 3 === 0 ? this.c : this.c.clone().setHex(i % 3 === 1 ? 0x1a1a1c : 0x55585c));
      this.c.setHex(paint);
    }
    this.debris.instanceColor!.needsUpdate = true;
    this.light.position.set(x, y + 1.5, z);
    this.flash = 1;
  }

  update(dt: number) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
      this.light.intensity = FLASH * this.flash * this.flash;
    }
    let any = false;
    for (let k = 0; k < DEBRIS; k++) {
      if (this.age[k] > 6) continue;
      const age = (this.age[k] += dt);
      any = true;
      const i = k * 3;
      this.dv[i + 1] -= GRAVITY * dt;
      this.dp[i] += this.dv[i] * dt;
      this.dp[i + 1] += this.dv[i + 1] * dt;
      this.dp[i + 2] += this.dv[i + 2] * dt;
      const ground = heightAt(this.track, this.dp[i], this.dp[i + 2]) + this.size[k] * 0.2;
      if (this.dp[i + 1] < ground) {
        // Bounce, scrape, settle.
        this.dp[i + 1] = ground;
        this.dv[i + 1] = Math.abs(this.dv[i + 1]) * 0.3;
        this.dv[i] *= 0.6;
        this.dv[i + 2] *= 0.6;
        for (let j = 0; j < 3; j++) this.spin[i + j] *= 0.5;
      }
      for (let j = 0; j < 3; j++) this.rot[i + j] += this.spin[i + j] * dt;
      // Shrink away at the end.
      const sc = age > 6 ? 0 : this.size[k] * Math.min(1, (6 - age) / 1.5);
      this.q.setFromEuler(this.e.set(this.rot[i], this.rot[i + 1], this.rot[i + 2]));
      this.m.compose(this.v.set(this.dp[i], this.dp[i + 1], this.dp[i + 2]), this.q, this.s.set(sc, sc, sc));
      this.debris.setMatrixAt(k, this.m);
    }
    if (any) this.debris.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.debris.geometry.dispose();
    (this.debris.material as THREE.Material).dispose();
    this.light.dispose();
  }
}

/**
 * A damaged engine smoking: grey wisps from the engine bay past half damage, thick black smoke and flames
 * near the end. `bay` is the engine bay in world space; `rate` scales with frame time.
 */
export function smokeFrom(fx: Effects, bay: THREE.Vector3, vx: number, vz: number, damage: number, dt: number) {
  if (damage < 0.45) return;
  const k = (damage - 0.45) / 0.55;
  if (Math.random() < dt * (8 + k * 30)) {
    const g = 0.55 - k * 0.5;
    fx.plume(bay.x, bay.y, bay.z, vx * 0.5 + (Math.random() - 0.5), 1.2 + Math.random() * 1.5 + k * 1.5, vz * 0.5 + (Math.random() - 0.5), [g, g, g], 0.5 + k * 0.6, 2.5 + k * 3, 1.6 + k * 1.4, 0.35 + k * 0.4);
  }
  if (k > 0.65 && Math.random() < dt * 22) fx.spark(bay.x + (Math.random() - 0.5) * 0.5, bay.y, bay.z + (Math.random() - 0.5) * 0.5, vx * 0.6, 1.5 + Math.random() * 1.5, vz * 0.6, [5, 1.8, 0.3], 0.3 + Math.random() * 0.25, 0.5 + Math.random() * 0.5);
}
