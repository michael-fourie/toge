// Tyre smoke (and dust off the tarmac) as soft points, and skid marks as a ring buffer of quads on the
// ground. Both are single draw calls however many cars are sliding.

import * as THREE from 'three';

const SMOKE_MAX = 600;
const SKID_MAX = 3000;

export class Effects {
  private smoke: THREE.Points;
  private sp = new Float32Array(SMOKE_MAX * 3);
  private sv = new Float32Array(SMOKE_MAX * 3);
  private sAge = new Float32Array(SMOKE_MAX).fill(1e9);
  private sLife = new Float32Array(SMOKE_MAX).fill(1);
  private sCol = new Float32Array(SMOKE_MAX * 3);
  private sSize = new Float32Array(SMOKE_MAX);
  /** Size at birth and growth over life (smoke swells, sparks shrink), and fade rate. */
  private sBase = new Float32Array(SMOKE_MAX);
  private sGrow = new Float32Array(SMOKE_MAX);
  private sFade = new Float32Array(SMOKE_MAX);
  private sAlpha = new Float32Array(SMOKE_MAX);
  private next = 0;

  private skid: THREE.Mesh;
  private kPos = new Float32Array(SKID_MAX * 4 * 3);
  private kAlpha = new Float32Array(SKID_MAX * 4);
  private kNext = 0;
  /** Last skid point per wheel key (car id × 4 + wheel), so marks join up. */
  private lastMark = new Map<number, { x: number; y: number; z: number; rx: number; rz: number }>();

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float a = (1.0 - r * r) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.smoke = new THREE.Points(g, mat);
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);

    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.BufferAttribute(this.kPos, 3).setUsage(THREE.DynamicDrawUsage));
    kg.setAttribute('alpha', new THREE.BufferAttribute(this.kAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(SKID_MAX * 6);
    for (let i = 0; i < SKID_MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    kg.setIndex(new THREE.BufferAttribute(idx, 1));
    const km = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.04,0.04,0.045, vA); }`,
    });
    this.skid = new THREE.Mesh(kg, km);
    this.skid.frustumCulled = false;
    scene.add(this.skid);
  }

  /** A puff at a sliding wheel. `dust` is for off-road (brown, bigger, faster to settle). */
  puff(x: number, y: number, z: number, vx: number, vz: number, amount: number, dust: boolean) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_MAX;
    this.sp.set([x, y + 0.2, z], i * 3);
    this.sv.set([vx * 0.25 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, vz * 0.25 + (Math.random() - 0.5) * 1.5], i * 3);
    this.sAge[i] = 0;
    this.sLife[i] = dust ? 1.4 : 2.6 + amount;
    const c = dust ? [0.55, 0.47, 0.36] : [0.86, 0.86, 0.88];
    this.sCol.set(c, i * 3);
    this.sAlpha[i] = Math.min(0.35, 0.1 + amount * 0.18);
    this.sBase[i] = 1;
    this.sGrow[i] = 5;
    this.sFade[i] = 0.6;
  }

  /** A short-lived glowing particle: drift sparks, boost flames. */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number[], life: number, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_MAX;
    this.sp.set([x, y, z], i * 3);
    this.sv.set([vx, vy, vz], i * 3);
    this.sAge[i] = 0;
    this.sLife[i] = life;
    this.sCol.set(color, i * 3);
    this.sAlpha[i] = 1;
    this.sBase[i] = size;
    this.sGrow[i] = -size * 0.8;
    this.sFade[i] = 2;
  }

  /** Lays skid mark between this wheel's last point and here; `strength` 0 lifts the pen. */
  mark(key: number, x: number, y: number, z: number, rx: number, rz: number, width: number, strength: number) {
    const last = this.lastMark.get(key);
    if (strength <= 0.05) {
      this.lastMark.delete(key);
      return;
    }
    const here = { x, y: y + 0.02, z, rx, rz };
    if (last && (x - last.x) ** 2 + (z - last.z) ** 2 > 0.16) {
      const i = this.kNext;
      this.kNext = (this.kNext + 1) % SKID_MAX;
      const w = width / 2;
      this.kPos.set(
        [last.x - last.rx * w, last.y, last.z - last.rz * w, last.x + last.rx * w, last.y, last.z + last.rz * w, x - rx * w, here.y, z - rz * w, x + rx * w, here.y, z + rz * w],
        i * 12,
      );
      const a = Math.min(0.75, strength * 0.6);
      this.kAlpha.set([a, a, a, a], i * 4);
      this.lastMark.set(key, here);
      const g = this.skid.geometry;
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('alpha').needsUpdate = true;
    } else if (!last) this.lastMark.set(key, here);
  }

  update(dt: number) {
    for (let i = 0; i < SMOKE_MAX; i++) {
      const age = (this.sAge[i] += dt);
      const life = this.sLife[i];
      if (age > life) {
        this.sSize[i] = 0;
        continue;
      }
      const k = age / life;
      this.sp[i * 3] += this.sv[i * 3] * dt;
      this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt;
      this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt;
      this.sv[i * 3] *= 1 - dt * 0.8;
      this.sv[i * 3 + 2] *= 1 - dt * 0.8;
      this.sSize[i] = this.sBase[i] + k * this.sGrow[i];
      this.sAlpha[i] *= 1 - dt * this.sFade[i];
    }
    const g = this.smoke.geometry;
    for (const n of ['position', 'size', 'alpha', 'color']) g.getAttribute(n).needsUpdate = true;
  }

  dispose() {
    this.smoke.geometry.dispose();
    (this.smoke.material as THREE.Material).dispose();
    this.skid.geometry.dispose();
    (this.skid.material as THREE.Material).dispose();
  }
}
