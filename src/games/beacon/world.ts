// The scenery: a cold sea at golden hour, the sea stack (displaced rock round the course's rock bands), every piece
// of the route in triplanar PBR materials, the props that make it a place (struts into the rock, braziers, lamps,
// ropes), the lighthouse with its lantern room, far islands and gulls. Everything static is merged per material, so
// the whole course is a few dozen draw calls.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Course, Decor, V3 } from './course.ts';
import { type Mat, type Solid, topAt } from './move.ts';
import { disposeTextures, fbm, material } from './textures.ts';

/** The light of the scene: tuned together (see the screenshots in the PR). */
export const LOOK = {
  /** Sun elevation and azimuth in degrees: low golden hour, from the west-south-west so the start is in the light. */
  sunElevation: 9,
  sunAzimuth: 300,
  exposure: 0.62,
  sunColor: 0xffd2a0,
  sunIntensity: 3.0,
  hemiSky: 0x9fb8d8,
  hemiGround: 0x3a3028,
  hemiIntensity: 0.55,
  envIntensity: 0.7,
  fog: 0xa7b3bd,
  fogDensity: 0.0011,
  sea: 0x0b2229,
  shadowSize: 34,
} as const;

/** Smooth 3D value noise in -1..1 (for the rock's shape: not tiled). */
function noise3(x: number, y: number, z: number) {
  const h = (i: number, j: number, k: number) => {
    let n = (i * 374761393 + j * 668265263 + k * 1440662683) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const ux = s(fx);
  const uy = s(fy);
  const uz = s(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), ux), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux), uy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux), uy),
    uz,
  );
}

/** How far the drawn rock may stand proud of its collision box (the route keeps ROCK.margin clear). */
const ROCK_OUT = 1.3;

const rockNoise = (x: number, y: number, z: number) =>
  noise3(x * 0.07, y * 0.05, z * 0.07) * 0.55 + noise3(x * 0.2, y * 0.3, z * 0.2) * 0.3 + noise3(x * 0.7, y * 0.7, z * 0.7) * 0.15;

/** A small seeded random for placing things (same scene for everyone). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SceneryOpts {
  high: boolean;
}

export class Scenery {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  private sky: Sky;
  private env: THREE.Texture | null = null;
  private sea: THREE.Mesh;
  private seaTime = { value: 0 };
  private disposables: { dispose(): void }[] = [];
  private flames: { at: THREE.Object3D; lit: boolean; group: THREE.Group }[] = [];
  private beam: THREE.Mesh;
  private lamp: THREE.Mesh;
  private gulls: THREE.InstancedMesh;
  private gullPaths: { cx: number; cy: number; cz: number; r: number; speed: number; phase: number }[] = [];
  private clock = 0;
  readonly sunDir = new THREE.Vector3();

  constructor(
    renderer: THREE.WebGLRenderer,
    private course: Course,
    private opts: SceneryOpts,
  ) {
    const res = opts.high ? 512 : 256;
    const scene = this.scene;

    // ---- Sky, sun, fog, environment
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 2.4;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    u.cloudCoverage.value = 0.22;
    u.cloudDensity.value = 0.3;
    u.cloudElevation.value = 0.55;
    const phi = THREE.MathUtils.degToRad(90 - LOOK.sunElevation);
    const theta = THREE.MathUtils.degToRad(LOOK.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    scene.add(this.sky);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(9000);
    for (const k of Object.keys(u)) skyCopy.material.uniforms[k].value = u[k].value;
    skyCopy.material.uniforms.showSunDisc.value = 0;
    skyScene.add(skyCopy);
    this.env = pmrem.fromScene(skyScene, 0, 1, 20000).texture;
    pmrem.dispose();
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();
    scene.environment = this.env;
    scene.environmentIntensity = LOOK.envIntensity;
    scene.fog = new THREE.FogExp2(LOOK.fog, LOOK.fogDensity);

    this.sun = new THREE.DirectionalLight(LOOK.sunColor, LOOK.sunIntensity);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    if (opts.high) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -LOOK.shadowSize;
      c.right = c.top = LOOK.shadowSize;
      c.near = 1;
      c.far = 400;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun, this.sun.target);
    scene.add(new THREE.HemisphereLight(LOOK.hemiSky, LOOK.hemiGround, LOOK.hemiIntensity));

    // ---- The sea
    this.sea = this.makeSea();
    scene.add(this.sea);

    // ---- The stack and the route
    this.addRock(res);
    this.addPieces(res);
    this.addDecor(res);
    this.addIslands(res);
    const top = this.addLighthouse(res);
    this.beam = top.beam;
    this.lamp = top.lamp;
    this.gulls = this.makeGulls();
    scene.add(this.gulls);
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) {
    const m = new THREE.Mesh(this.keep(geo), mat);
    m.castShadow = cast && this.opts.high;
    m.receiveShadow = this.opts.high;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.scene.add(m);
    return m;
  }

  private mat(mat: Mat, res: number, vc = true, macro = 0) {
    return this.keep(material(mat, res, { vertexColors: vc, macro }));
  }

  // ------------------------------------------------------------------------------------- sea

  private makeSea() {
    const n = 256;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const h = (xx: number, yy: number) => fbm(xx / n, yy / n, 6, 5, 91, 0.55);
        const dx = (h(x + 1, y) - h(x - 1, y)) * 6;
        const dy = (h(x, y + 1) - h(x, y - 1)) * 6;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * n + x) * 4;
        data[i] = (-dx / l) * 127.5 + 127.5;
        data[i + 1] = (dy / l) * 127.5 + 127.5;
        data[i + 2] = (1 / l) * 127.5 + 127.5;
        data[i + 3] = 255;
      }
    const nt = this.keep(new THREE.DataTexture(data, n, n, THREE.RGBAFormat));
    nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
    nt.minFilter = THREE.LinearMipmapLinearFilter;
    nt.generateMipmaps = true;
    nt.needsUpdate = true;
    const m = this.keep(
      new THREE.MeshStandardMaterial({ color: LOOK.sea, roughness: 0.12, metalness: 0.0, normalMap: nt, normalScale: new THREE.Vector2(0.55, 0.55) }),
    );
    const time = this.seaTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.seaTime = time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;\nuniform float seaTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `{
  vec2 p = vSeaPos.xz;
  vec3 a = texture2D(normalMap, p * 0.021 + vec2(0.011, 0.007) * seaTime).xyz * 2.0 - 1.0;
  vec3 b = texture2D(normalMap, p * 0.057 - vec2(0.006, 0.013) * seaTime).xyz * 2.0 - 1.0;
  vec3 c = texture2D(normalMap, p * 0.0037 + vec2(0.002, -0.001) * seaTime).xyz * 2.0 - 1.0;
  vec3 tn = normalize(vec3((a.xy + b.xy * 0.7 + c.xy * 1.4) * normalScale, 1.0));
  vec3 w = normalize(vec3(tn.x, tn.z, -tn.y));
  normal = normalize((viewMatrix * vec4(w, 0.0)).xyz);
}`,
        );
    };
    const geo = new THREE.PlaneGeometry(12000, 12000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(this.keep(geo), m);
    sea.receiveShadow = false;
    return sea;
  }

  // ------------------------------------------------------------------------------------- rock

  private addRock(res: number) {
    const geos: THREE.BufferGeometry[] = [this.stackGeo(this.course.rock.filter((r) => r.mat === 'rock'))];
    // Boulders at the waterline round the foot.
    const lowest = this.course.rock[0];
    const r = rng(7);
    if (lowest)
      for (let i = 0; i < 30; i++) {
        const a = r() * Math.PI * 2;
        const rad = Math.max(lowest.max[0] - lowest.min[0], lowest.max[2] - lowest.min[2]) * 0.55 + 2 + r() * 26;
        const cx = (lowest.min[0] + lowest.max[0]) / 2 + Math.cos(a) * rad;
        const cz = (lowest.min[2] + lowest.max[2]) / 2 + Math.sin(a) * rad;
        const s = 0.8 + r() * 3.2;
        // Keep the start of the climb clear.
        const st = this.course.start.spawn;
        if (Math.hypot(cx - st[0], cz - st[2]) < 14) continue;
        geos.push(this.rockBlock({ min: [cx - s, -2.5, cz - s], max: [cx + s, s * 0.5 + r() * 1.2, cz + s], mat: 'rock' }, s * 0.45).toNonIndexed());
      }
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    geos.forEach((x) => x.dispose());
    const m = this.mat('rock', res, true, 0.6);
    m.envMapIntensity = 0.5;
    this.mesh(g, m);
  }

  /**
   * The sea stack as one lofted surface: a rounded rectangle at each band (squarish superellipse), with a short
   * sloped shoulder where a band steps in, displaced by noise and ribbed like basalt columns. It stays inside the
   * band boxes except for at most ROCK.margin outward, so it never reaches the route.
   */
  private stackGeo(bands: Solid[]): THREE.BufferGeometry {
    type Ring = { y: number; x0: number; x1: number; z0: number; z1: number };
    const rings: Ring[] = [];
    const ring = (b: Solid, y: number): Ring => ({ y, x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] });
    bands.forEach((b, i) => {
      if (i === 0) rings.push(ring(b, b.min[1]));
      const next = bands[i + 1];
      if (next) {
        // Shoulder: hold this band's size until 1.5 m under the step, then slope in to the next one.
        rings.push(ring(b, b.max[1] - 1.5));
        rings.push(ring(next, b.max[1]));
      } else rings.push(ring(b, b.max[1]));
    });
    // Resample to rows about 1.2 m apart, easing between rings.
    const rows: Ring[] = [];
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      const n = Math.max(1, Math.round((b.y - a.y) / 1.2));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const e = t * t * (3 - 2 * t);
        rows.push({ y: a.y + (b.y - a.y) * t, x0: a.x0 + (b.x0 - a.x0) * e, x1: a.x1 + (b.x1 - a.x1) * e, z0: a.z0 + (b.z0 - a.z0) * e, z1: a.z1 + (b.z1 - a.z1) * e });
      }
    }
    rows.push(rings[rings.length - 1]);
    const cols = 320;
    const P = 7; // superellipse exponent: squarish, rounded corners
    const verts: number[] = [];
    const colors: number[] = [];
    const topY = rows[rows.length - 1].y;
    for (const [ri, rw] of rows.entries()) {
      const cx = (rw.x0 + rw.x1) / 2;
      const cz = (rw.z0 + rw.z1) / 2;
      const ax = (rw.x1 - rw.x0) / 2;
      const az = (rw.z1 - rw.z0) / 2;
      for (let c = 0; c < cols; c++) {
        const th = (c / cols) * Math.PI * 2;
        const co = Math.cos(th);
        const si = Math.sin(th);
        const ex = Math.sign(co) * Math.abs(co) ** (2 / P);
        const ez = Math.sign(si) * Math.abs(si) ** (2 / P);
        let x = cx + ax * ex;
        let z = cz + az * ez;
        // Outward normal of the superellipse.
        let nx = Math.sign(ex) * Math.abs(ex) ** (P - 1) / ax;
        let nz = Math.sign(ez) * Math.abs(ez) ** (P - 1) / az;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        let y = rw.y;
        const n = rockNoise(x, y, z);
        // Blocky fracture: noise stepped into slabs, so faces break into ledges and facets rather than cloth folds.
        const slab = Math.round(noise3(x * 0.09 + 3, y * 0.16, z * 0.09) * 2.5) / 2.5;
        const ledge = Math.max(0, Math.sin(y * 0.45 + n * 2.5)) ** 8 * 0.6;
        const top = ri === rows.length - 1;
        const off = top ? -0.3 : Math.min(ROCK_OUT, -0.5 + (n * 0.5 + 0.5) * 1.2 + slab * 0.7 + ledge);
        x += nx * off;
        z += nz * off;
        if (!top && ri > 0) y += noise3(x * 0.2, y * 0.2, z * 0.2) * 0.35;
        verts.push(x, y, z);
        const wet = Math.max(0, Math.min(1, (2.5 - y) / 3));
        const dip = Math.max(0, Math.min(1, 0.55 + n * 0.9));
        const salt = Math.max(0, Math.min(1, (noise3(x * 0.25, y * 0.05, z * 0.25) - 0.3) * 2)) * Math.min(1, Math.max(0, y) / 25);
        const k = (0.62 + dip * 0.5) * (1 - wet * 0.55);
        colors.push(k * (1 + salt * 0.55), k * (1 + salt * 0.5), k * (1 + salt * 0.4));
      }
    }
    // The plateau: a flat cap just under its walking height.
    const capBase = verts.length / 3;
    const tr = rows[rows.length - 1];
    verts.push((tr.x0 + tr.x1) / 2, topY - 0.3, (tr.z0 + tr.z1) / 2);
    colors.push(0.9, 0.88, 0.8);
    const idx: number[] = [];
    for (let r = 0; r < rows.length - 1; r++)
      for (let c = 0; c < cols; c++) {
        const a = r * cols + c;
        const b = r * cols + ((c + 1) % cols);
        const d = (r + 1) * cols + c;
        const e = (r + 1) * cols + ((c + 1) % cols);
        idx.push(a, d, b, b, d, e);
      }
    const last = (rows.length - 1) * cols;
    for (let c = 0; c < cols; c++) idx.push(last + c, capBase, last + ((c + 1) % cols));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** A displaced, smooth-shaded lump of rock around box `s`, pushed out by up to `amp` metres. */
  private rockBlock(s: Solid, amp: number, flatTop = false): THREE.BufferGeometry {
    const sx = s.max[0] - s.min[0];
    // Each band reaches down into the one below, so the steps between them read as ledges, not seams.
    const sy = s.max[1] - s.min[1] + 2.5;
    const sz = s.max[2] - s.min[2];
    const seg = (v: number) => Math.max(2, Math.min(48, Math.round(v / 1.6)));
    let g: THREE.BufferGeometry = new THREE.BoxGeometry(sx, sy, sz, seg(sx), seg(sy), seg(sz));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const cx = (s.min[0] + s.max[0]) / 2;
    const cy = s.max[1] - sy / 2;
    const cz = (s.min[2] + s.max[2]) / 2;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Direction out of the box (rounded corners), the same for coincident vertices so there are no cracks.
      d.set(v.x / (sx / 2), (v.y / (sy / 2)) * 0.35, v.z / (sz / 2));
      d.set(Math.sign(d.x) * Math.abs(d.x) ** 4, Math.sign(d.y) * Math.abs(d.y) ** 4, Math.sign(d.z) * Math.abs(d.z) ** 4).normalize();
      const wx = v.x + cx;
      const wy = v.y + cy;
      const wz = v.z + cz;
      const n = rockNoise(wx, wy, wz);
      const push = amp * (0.25 + 0.75 * (n * 0.5 + 0.5));
      // Columnar jointing: vertical ribs, like basalt.
      const rib = Math.abs(Math.sin((wx + wz) * 0.9 + n * 3)) * 0.35 * amp;
      v.addScaledVector(d, push + rib);
      v.y += noise3(wx * 0.15, wy * 0.15, wz * 0.15) * 0.6;
      // The plateau you walk on stays at (or a touch under) its collision top.
      if (flatTop && v.y + cy > s.max[1] - 0.05) v.y = s.max[1] - cy - 0.05 - Math.abs(noise3(wx * 0.4, 0, wz * 0.4)) * 0.25;
      pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
      // Colour: wet and dark at the waterline, pale lichen and salt higher up, darker in the dips.
      const wet = Math.max(0, Math.min(1, (2.5 - wy) / 3));
      const dip = Math.max(0, Math.min(1, 0.6 + n * 0.8));
      const salt = Math.max(0, Math.min(1, (noise3(wx * 0.3, wy * 0.08, wz * 0.3) - 0.35) * 2)) * Math.min(1, wy / 20);
      const k = (0.6 + dip * 0.5) * (1 - wet * 0.55);
      col[i * 3] = k * (1 + salt * 0.5);
      col[i * 3 + 1] = k * (1 + salt * 0.45);
      col[i * 3 + 2] = k * (1 + salt * 0.35) * (1 - wet * 0.1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------------------------------------------- the route

  private addPieces(res: number) {
    const rockSet = new Set(this.course.rock);
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    const r = rng(11);
    for (const s of this.course.solids) {
      if (rockSet.has(s)) continue;
      const g = this.boxGeo(s, 0.82 + r() * 0.3);
      const list = byMat.get(s.mat);
      if (list) list.push(g);
      else byMat.set(s.mat, [g]);
    }
    for (const [mat, geos] of byMat) {
      const g = mergeGeometries(geos);
      geos.forEach((x) => x.dispose());
      this.mesh(g, this.mat(mat, res));
    }
  }

  /** A box (or ramp wedge) with a per-piece tint, darker underneath and toward the bottom (cheap ambient occlusion). */
  private boxGeo(s: Solid, tint: number): THREE.BufferGeometry {
    const sx = s.max[0] - s.min[0];
    const sy = s.max[1] - s.min[1];
    const sz = s.max[2] - s.min[2];
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (s.ramp)
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > s.max[1] - 1e-3) pos.setY(i, topAt(s, pos.getX(i), pos.getZ(i)));
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - s.min[1]) / Math.max(0.01, sy);
      const k = tint * (0.55 + 0.45 * Math.min(1, t * 1.6 + (sy < 1 ? 0.5 : 0)));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    return g;
  }

  // ------------------------------------------------------------------------------------- props

  private addDecor(res: number) {
    const iron = this.keep(new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.6, metalness: 0.8 }));
    const beamGeos: Record<'wood' | 'steel', THREE.BufferGeometry[]> = { wood: [], steel: [] };
    const ironGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];
    const ropeGeos: THREE.BufferGeometry[] = [];
    const lampGlass = this.keep(new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffb15c, emissiveIntensity: 2.2, roughness: 0.3 }));
    const rope = this.keep(new THREE.MeshStandardMaterial({ color: 0x5a4a35, roughness: 0.95 }));
    const between = (a: V3, b: V3, w: number) => {
      const va = new THREE.Vector3(...a);
      const vb = new THREE.Vector3(...b);
      const len = va.distanceTo(vb);
      const g = new THREE.BoxGeometry(w, w, len);
      const m = new THREE.Matrix4().lookAt(va, vb, new THREE.Vector3(0, 1, 0));
      m.setPosition(va.clone().add(vb).multiplyScalar(0.5));
      g.applyMatrix4(m);
      g.deleteAttribute('uv');
      return g;
    };
    const solidAt = (p: V3) => this.course.solids.find((s) => p[0] >= s.min[0] - 0.1 && p[0] <= s.max[0] + 0.1 && p[2] >= s.min[2] - 0.1 && p[2] <= s.max[2] + 0.1 && Math.abs(s.max[1] - p[1]) < 0.2);
    for (const d of this.course.decor) {
      if (d.kind === 'support' && d.to) {
        const kind = (solidAt(d.at)?.mat ?? 'wood') === 'steel' ? 'steel' : 'wood';
        // A diagonal strut from under the piece into the rock, and a horizontal joist.
        beamGeos[kind].push(this.tinted(between([d.at[0], d.at[1] - 0.1, d.at[2]], d.to, kind === 'steel' ? 0.16 : 0.22)));
        beamGeos[kind].push(this.tinted(between([d.at[0], d.at[1] + 0.1, d.at[2]], [d.to[0], d.at[1] + 0.1, d.to[2]], kind === 'steel' ? 0.14 : 0.2)));
      } else if (d.kind === 'lamp') {
        const [x, y, z] = d.at;
        const post = new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6);
        post.translate(x, y + 1.2, z);
        const cap = new THREE.ConeGeometry(0.22, 0.2, 6);
        cap.translate(x, y + 2.75, z);
        ironGeos.push(post.deleteAttribute('uv'), cap.deleteAttribute('uv'));
        const glass = new THREE.CylinderGeometry(0.14, 0.12, 0.32, 6);
        glass.translate(x, y + 2.5, z);
        glassGeos.push(glass.deleteAttribute('uv'));
      } else if (d.kind === 'rope' && d.to) {
        const a = new THREE.Vector3(...d.at);
        const b = new THREE.Vector3(...d.to);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * 0.9, 0)));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.035, 5);
        ropeGeos.push(tube.deleteAttribute('uv'));
      } else if (d.kind === 'brazier') this.addBrazier(d, ironGeos);
    }
    for (const k of ['wood', 'steel'] as const) if (beamGeos[k].length) this.mesh(mergeGeometries(beamGeos[k]), this.mat(k, res));
    if (ironGeos.length) this.mesh(mergeGeometries(ironGeos.map((g) => (g.index ? g.toNonIndexed() : g))), iron);
    if (glassGeos.length) this.mesh(mergeGeometries(glassGeos), lampGlass, false);
    if (ropeGeos.length) this.mesh(mergeGeometries(ropeGeos), rope);
  }

  private tinted(g: THREE.BufferGeometry) {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3).fill(0.8);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }

  /** An iron fire basket on a post; lit when you reach its checkpoint. */
  private addBrazier(d: Decor, iron: THREE.BufferGeometry[]) {
    const [x, y, z] = d.at;
    const post = new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6);
    post.translate(x, y + 0.55, z);
    const bowl = new THREE.CylinderGeometry(0.42, 0.22, 0.4, 10, 1, true);
    bowl.translate(x, y + 1.25, z);
    iron.push(post.deleteAttribute('uv'), bowl.deleteAttribute('uv'));
    const group = new THREE.Group();
    group.position.set(x, y + 1.3, z);
    const coals = new THREE.Mesh(
      this.keep(new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
      this.keep(new THREE.MeshStandardMaterial({ color: 0x110805, emissive: 0xff5a1a, emissiveIntensity: 3, roughness: 1 })),
    );
    coals.scale.y = 0.5;
    group.add(coals);
    const flameMat = this.keep(
      new THREE.MeshBasicMaterial({ color: 0xffa04a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }),
    );
    const flameGeo = this.keep(new THREE.ConeGeometry(0.28, 1, 8, 1, true));
    flameGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set((i - 1) * 0.12, 0.05, ((i * 7) % 3) * 0.08 - 0.08);
      group.add(f);
    }
    const glow = new THREE.Sprite(this.keep(new THREE.SpriteMaterial({ map: this.glowTex(), color: 0xff8a3a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 })));
    glow.scale.setScalar(3.2);
    glow.position.y = 0.5;
    group.add(glow);
    group.visible = false;
    this.scene.add(group);
    this.flames.push({ at: group, lit: false, group });
  }

  private glow: THREE.Texture | null = null;
  private glowTex() {
    if (this.glow) return this.glow;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.glow = this.keep(new THREE.CanvasTexture(c));
    return this.glow;
  }

  /** Lights brazier `i` (checkpoint order) or puts it out. */
  setBrazier(i: number, lit: boolean) {
    const f = this.flames[i];
    if (!f) return;
    f.lit = lit;
    f.group.visible = lit;
  }

  // ------------------------------------------------------------------------------------- far away

  private addIslands(res: number) {
    const r = rng(23);
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.5;
      const dist = 900 + r() * 1400;
      const w = 150 + r() * 400;
      const h = 25 + r() * 120;
      // A low dome, roughened: headlands and skerries on the horizon.
      const g = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const sx = w / 2;
      const sz = w / (2.5 + r() * 2);
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const z = pos.getZ(k);
        const n = noise3(x * 3 + i * 10, y * 3, z * 3) * 0.35 + noise3(x * 9, y * 9, z * 9 + i) * 0.12;
        const cliff = Math.min(1, y * 3.5);
        pos.setXYZ(k, x * sx * (1 + n * 0.3), (y ** 0.8 * cliff + n * 0.4 * y) * h - 2, z * sz * (1 + n * 0.3));
      }
      g.deleteAttribute('uv');
      g.computeVertexNormals();
      const c = new Float32Array(pos.count * 3).fill(0.75);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.rotateY(r() * Math.PI);
      g.translate(Math.cos(a) * dist, 0, Math.sin(a) * dist);
      geos.push(g.toNonIndexed());
      g.dispose();
    }
    const m = this.mat('rock', res);
    m.envMapIntensity = 0.4;
    this.mesh(mergeGeometries(geos), m, false);
  }

  // ------------------------------------------------------------------------------------- the lighthouse

  private addLighthouse(res: number) {
    const tower = this.course.rock.find((r) => r.mat === 'plaster')!;
    const [lx, ly, lz] = this.course.lantern;
    // The red band and the corbelled gallery.
    const red = this.keep(material('plaster', res, { vertexColors: true }));
    red.color.set(0xa0281c);
    const bandY = tower.min[1] + (tower.max[1] - tower.min[1]) * 0.62;
    const band = this.boxGeo({ min: [tower.min[0] - 0.03, bandY, tower.min[2] - 0.03], max: [tower.max[0] + 0.03, bandY + 3, tower.max[2] + 0.03], mat: 'plaster' }, 1);
    this.mesh(band, red, false);
    // Tower windows: dark, slightly recessed slits on each face.
    const winMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.3 }));
    const wins: THREE.BufferGeometry[] = [];
    for (let y = tower.min[1] + 6; y < tower.max[1] - 4; y += 7) {
      const cx = (tower.min[0] + tower.max[0]) / 2;
      const cz = (tower.min[2] + tower.max[2]) / 2;
      for (const [x, z, rx] of [
        [cx, tower.max[2] + 0.02, 0],
        [cx, tower.min[2] - 0.02, 0],
        [tower.max[0] + 0.02, cz, 1],
        [tower.min[0] - 0.02, cz, 1],
      ] as const) {
        const g = new THREE.BoxGeometry(rx ? 0.05 : 0.8, 1.6, rx ? 0.8 : 0.05);
        g.translate(x, y, z);
        wins.push(g.deleteAttribute('uv'));
      }
    }
    this.mesh(mergeGeometries(wins), winMat, false);
    // Gallery railing round the top.
    const iron = this.keep(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.85 }));
    const rail: THREE.BufferGeometry[] = [];
    const y = tower.max[1];
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const top = new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.06, 0.06, Math.abs(z1 - z0) + 0.06);
      top.translate((x0 + x1) / 2, y + 1.05, (z0 + z1) / 2);
      rail.push(top.deleteAttribute('uv'));
      for (let t = 0; t <= len; t += 1.2) {
        const p = new THREE.CylinderGeometry(0.025, 0.025, 1.05, 4);
        p.translate(x0 + ((x1 - x0) * t) / len, y + 0.52, z0 + ((z1 - z0) * t) / len);
        rail.push(p.deleteAttribute('uv').toNonIndexed());
      }
    };
    const [x0, z0, x1, z1] = [tower.min[0] + 0.1, tower.min[2] + 0.1, tower.max[0] - 0.1, tower.max[2] - 0.1];
    edge(x0, z0, x1, z0);
    edge(x1, z0, x1, z1);
    edge(x1, z1, x0, z1);
    // The side you climb onto is left open... any one: the route arrives from the gangway, which faces the last edge.
    this.mesh(mergeGeometries(rail.map((g) => (g.index ? g.toNonIndexed() : g))), iron);

    // The lantern room.
    const room = this.course.solids[this.course.solids.length - 1];
    const half = (room.max[0] - room.min[0]) / 2;
    const glass = this.keep(
      new THREE.MeshPhysicalMaterial({ color: 0xbfd6e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 1.6, depthWrite: false }),
    );
    const roomGeo = new THREE.CylinderGeometry(half * 1.05, half * 1.05, 2.4, 8, 1, true);
    roomGeo.translate(lx, ly + 1.0 + 1.2, lz);
    this.mesh(roomGeo, glass, false);
    const plinth = new THREE.CylinderGeometry(half * 1.1, half * 1.15, 1.0, 8);
    plinth.translate(lx, ly + 0.5, lz);
    const dome = new THREE.ConeGeometry(half * 1.2, 1.6, 8);
    dome.translate(lx, ly + 3.4 + 0.8, lz);
    const frames: THREE.BufferGeometry[] = [plinth.deleteAttribute('uv'), dome.deleteAttribute('uv')];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const g = new THREE.BoxGeometry(0.08, 2.4, 0.08);
      g.translate(lx + Math.cos(a) * half * 1.05, ly + 2.2, lz + Math.sin(a) * half * 1.05);
      frames.push(g.deleteAttribute('uv'));
    }
    this.mesh(mergeGeometries(frames.map((g) => (g.index ? g.toNonIndexed() : g))), iron);
    const lamp = new THREE.Mesh(
      this.keep(new THREE.SphereGeometry(half * 0.45, 16, 12)),
      this.keep(new THREE.MeshStandardMaterial({ color: 0x302a20, emissive: 0xfff1c8, emissiveIntensity: 0, roughness: 0.2, metalness: 0.4 })),
    );
    lamp.position.set(lx, ly + 2.2, lz);
    this.scene.add(lamp);
    // The beam: a long soft cone that sweeps once the light is lit.
    const beamGeo = this.keep(new THREE.CylinderGeometry(9, 0.4, 260, 24, 1, true));
    beamGeo.translate(0, 130, 0);
    beamGeo.rotateZ(-Math.PI / 2);
    const beamMat = this.keep(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { k: { value: 0 } },
        vertexShader: 'varying float vX; varying vec3 vN; varying vec3 vV; void main(){ vX = position.x; vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }',
        fragmentShader:
          'uniform float k; varying float vX; varying vec3 vN; varying vec3 vV; void main(){ float along = clamp(vX/260.0, 0.0, 1.0); float rim = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(vec3(1.0,0.93,0.75) * k * rim * (1.0-along) * 0.35, 1.0); }',
      }),
    );
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(lx, ly + 2.2, lz);
    beam.visible = false;
    this.scene.add(beam);
    return { beam, lamp };
  }

  /** The light at the top: dark until you've finished, then it burns and sweeps. */
  setBeacon(lit: boolean) {
    this.beam.visible = lit;
    ((this.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 6 : 0);
    ((this.beam.material as THREE.ShaderMaterial).uniforms.k.value = lit ? 1 : 0);
  }

  // ------------------------------------------------------------------------------------- gulls

  private makeGulls() {
    // A gull: two swept wings (flapped in the vertex shader by instance phase).
    const g = new THREE.BufferGeometry();
    const v = [0, 0, -0.25, 0, 0.02, 0.3, -0.95, 0.05, -0.05, 0, 0, -0.25, 0.95, 0.05, -0.05, 0, 0.02, 0.3];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const m = this.keep(new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.9, side: THREE.DoubleSide }));
    const time = this.seaTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.gt = time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float gt;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nfloat ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;\ntransformed.y += abs(transformed.x) * sin(gt * 7.0 + ph) * 0.5;',
        );
    };
    const n = 14;
    const mesh = new THREE.InstancedMesh(this.keep(g), m, n);
    const r = rng(31);
    for (let i = 0; i < n; i++)
      this.gullPaths.push({ cx: (r() - 0.5) * 60, cy: 20 + r() * 110, cz: (r() - 0.5) * 60, r: 40 + r() * 50, speed: 0.12 + r() * 0.1, phase: r() * 10 });
    mesh.frustumCulled = false;
    return mesh;
  }

  // ------------------------------------------------------------------------------------- per frame

  private tmp = new THREE.Object3D();

  /** Moves the shadow camera with the player, flickers fires, sweeps the beam, flies the gulls. */
  update(dt: number, focus: THREE.Vector3) {
    this.clock += dt;
    this.seaTime.value = this.clock;
    this.sky.material.uniforms.time.value = this.clock;
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fy = Math.round(focus.y / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx, fy, fz).addScaledVector(this.sunDir, 150);
    this.sun.target.updateMatrixWorld();
    for (const [i, f] of this.flames.entries()) {
      if (!f.lit) continue;
      f.group.children.forEach((c, j) => {
        if (j === 0) return;
        const t = this.clock * (5 + j) + i;
        c.scale.set(1, 0.7 + Math.sin(t) * 0.18 + Math.sin(t * 2.3) * 0.1, 1);
      });
    }
    if (this.beam.visible) this.beam.rotation.y = this.clock * 0.9;
    this.gullPaths.forEach((p, i) => {
      const a = this.clock * p.speed + p.phase;
      this.tmp.position.set(p.cx + Math.cos(a) * p.r, p.cy + Math.sin(a * 2.3) * 3, p.cz + Math.sin(a) * p.r);
      this.tmp.rotation.set(0, -a, Math.sin(a * 1.7) * 0.2);
      this.tmp.scale.setScalar(1.1);
      this.tmp.updateMatrix();
      this.gulls.setMatrixAt(i, this.tmp.matrix);
    });
    this.gulls.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.env?.dispose();
    disposeTextures();
    this.scene.clear();
  }
}
