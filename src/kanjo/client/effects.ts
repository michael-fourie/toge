// Tyre smoke (and dust off the tarmac) as soft points, sparks as hot points with a core that blooms, skid
// marks as a ring buffer of quads on the ground, and slipstream air as thin streaks. Each is a single draw
// call however many cars are sliding.

import * as THREE from 'three';

const SMOKE_MAX = 900;
const SKID_MAX = 3000;
const STREAK_MAX = 160;
/**
 * Smoke look: `nearFade` (m) thins a puff out as it reaches the camera, `maxPx` caps a puff's size on screen,
 * `density` makes up for the softer falloff's lighter core (same smoke overall), and `night` is the `light` for
 * night and city tracks (racegame.ts).
 */
export const SMOKE = { nearFade: ['1.5', '5.0'], maxPx: '420.0', density: '1.25', night: 0.2 };

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
  /** 1 for a spark (a hot core, brighter than white so the bloom catches it), 0 for smoke. */
  private sGlow = new Float32Array(SMOKE_MAX);
  private next = 0;

  private skid: THREE.Mesh;
  private kPos = new Float32Array(SKID_MAX * 4 * 3);
  private kAlpha = new Float32Array(SKID_MAX * 4);
  private kNext = 0;
  /** Last skid point per wheel key (car id × 4 + wheel), so marks join up. */
  private lastMark = new Map<number, { x: number; y: number; z: number; rx: number; rz: number }>();

  private streaks: THREE.LineSegments;
  /** Per streak: its head, its drift (m/s) and its length along the air flow (m); the buffer holds both ends. */
  private tPos = new Float32Array(STREAK_MAX * 6);
  private tAlpha = new Float32Array(STREAK_MAX * 2);
  private tHead = new Float32Array(STREAK_MAX * 3);
  private tVel = new Float32Array(STREAK_MAX * 3);
  private tLen = new Float32Array(STREAK_MAX * 3);
  private tAge = new Float32Array(STREAK_MAX).fill(1e9);
  private tLife = new Float32Array(STREAK_MAX).fill(1);
  private tPeak = new Float32Array(STREAK_MAX);
  private tNext = 0;

  /**
   * `light` scales the smoke's colour for the scene's light (1 by day, `SMOKE.night` at night): smoke is drawn unlit,
   * so a day-grey puff glowed like a white ball on a dark road.
   */
  constructor(scene: THREE.Scene, light = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('glow', new THREE.BufferAttribute(this.sGlow, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 }, light: { value: light } }]),
      vertexShader: `
        attribute float size; attribute float alpha; attribute float glow;
        varying vec3 vColor; varying float vAlpha; varying float vGlow;
        uniform float scale;
        #include <fog_pars_vertex>
        void main() {
          vColor = color; vAlpha = alpha; vGlow = glow;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Smoke thins out as it reaches the camera instead of filling the screen with one flat disc.
          vAlpha *= mix(smoothstep(${SMOKE.nearFade[0]}, ${SMOKE.nearFade[1]}, -mvPosition.z), 1.0, glow);
          gl_PointSize = min(size * scale / -mvPosition.z, ${SMOKE.maxPx});
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying float vGlow;
        uniform float light;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          // Smoke: a soft falloff with no rim (the old 1 - r² read as a disc with an edge), lit for the scene.
          float s = 1.0 - r;
          float a = s * s * (3.0 - 2.0 * s) * vAlpha * ${SMOKE.density};
          // A spark: a white-hot core several times brighter than white (bloom) fading into its colour.
          float core = s * s;
          vec3 c = mix(vColor * light, mix(vColor, vec3(1.0), core * 0.7) * (1.0 + 5.0 * core), vGlow);
          a = mix(a, min(1.0, s * 1.6) * vAlpha, vGlow);
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
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

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('alpha', new THREE.BufferAttribute(this.tAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const tm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * vA, 1.0); }`,
    });
    this.streaks = new THREE.LineSegments(tg, tm);
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }

  /** A streak of moving air (slipstream): from (x, y, z) back along (lx, ly, lz), drifting at (vx, vy, vz). */
  streak(x: number, y: number, z: number, lx: number, ly: number, lz: number, vx: number, vy: number, vz: number, life: number, strength: number) {
    const i = this.tNext;
    this.tNext = (this.tNext + 1) % STREAK_MAX;
    this.tHead.set([x, y, z], i * 3);
    this.tLen.set([lx, ly, lz], i * 3);
    this.tVel.set([vx, vy, vz], i * 3);
    this.tAge[i] = 0;
    this.tLife[i] = life;
    this.tPeak[i] = strength;
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
    this.sGlow[i] = 0;
    this.sBase[i] = 1;
    this.sGrow[i] = 5;
    this.sFade[i] = 0.6;
  }

  /**
   * A short-lived glowing particle: drift sparks, boost flames. `glow` 1 is a white-hot core six times brighter
   * than white (it blooms hard); lower keeps more of the particle's own colour and less of the flare.
   */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number[], life: number, size: number, glow = 1) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_MAX;
    this.sp.set([x, y, z], i * 3);
    this.sv.set([vx, vy, vz], i * 3);
    this.sAge[i] = 0;
    this.sLife[i] = life;
    this.sCol.set(color, i * 3);
    this.sAlpha[i] = 1;
    this.sGlow[i] = glow;
    this.sBase[i] = size;
    this.sGrow[i] = -size * 0.8;
    this.sFade[i] = 2;
  }

  /**
   * Smoke that isn't from tyres: a damaged engine's plume (grey, then black) and an explosion's cloud.
   * `color` is linear RGB, `size` the puff at birth (it swells to `size + grow`), `rise` its upward speed.
   */
  plume(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number[], size: number, grow: number, life: number, alpha: number) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_MAX;
    this.sp.set([x, y, z], i * 3);
    this.sv.set([vx, vy, vz], i * 3);
    this.sAge[i] = 0;
    this.sLife[i] = life;
    this.sCol.set(color, i * 3);
    this.sAlpha[i] = alpha;
    this.sGlow[i] = 0;
    this.sBase[i] = size;
    this.sGrow[i] = grow;
    this.sFade[i] = 0.5;
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
    for (const n of ['position', 'size', 'alpha', 'color', 'glow']) g.getAttribute(n).needsUpdate = true;

    // Streaks: in fast, out slow, both ends drifting together.
    const { tPos, tHead, tVel, tLen, tAlpha } = this;
    for (let i = 0; i < STREAK_MAX; i++) {
      const age = (this.tAge[i] += dt);
      const k = age / this.tLife[i];
      if (k >= 1) {
        tAlpha[i * 2] = tAlpha[i * 2 + 1] = 0;
        continue;
      }
      const j = i * 3;
      tHead[j] += tVel[j] * dt;
      tHead[j + 1] += tVel[j + 1] * dt;
      tHead[j + 2] += tVel[j + 2] * dt;
      tPos.set([tHead[j], tHead[j + 1], tHead[j + 2], tHead[j] - tLen[j], tHead[j + 1] - tLen[j + 1], tHead[j + 2] - tLen[j + 2]], i * 6);
      const a = this.tPeak[i] * Math.min(1, k * 6) * (1 - k);
      tAlpha[i * 2] = a;
      tAlpha[i * 2 + 1] = 0; // the tail fades into the air
    }
    const sg = this.streaks.geometry;
    sg.getAttribute('position').needsUpdate = true;
    sg.getAttribute('alpha').needsUpdate = true;
  }

  dispose() {
    this.smoke.geometry.dispose();
    (this.smoke.material as THREE.Material).dispose();
    this.skid.geometry.dispose();
    (this.skid.material as THREE.Material).dispose();
    this.streaks.geometry.dispose();
    (this.streaks.material as THREE.Material).dispose();
  }
}
