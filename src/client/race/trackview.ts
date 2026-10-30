// Draws a race track from its shared definition: physical sky (and the environment map it bakes), terrain
// with height/slope colouring, the road ribbon (lines, shoulders, verges), Armco, chevrons at the tight
// bends, snow poles or stone walls, start and finish gantries, instanced forests and rocks, villages and the sea.
// Static geometry is chunked so the frustum culls what's behind you.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CUT_HALF, SAMPLE, SHOULDER, type Theme, type Track, fbm, heightAt, onCut, pointAt, roadDistance, terrainAt } from '../../shared/race/track.ts';

interface Look {
  sun: [number, number]; // elevation, azimuth (degrees)
  turbidity: number;
  rayleigh: number;
  fog: number;
  fogDensity: number;
  exposure: number;
  grass: number[];
  grassDry: number[];
  rock: number[];
  verge: number[];
  snowline: number;
  treeline: number;
  /** Night: the sky's sun sits below the horizon and the light comes from the moon instead. */
  moon?: [number, number];
  light?: number; // light colour
  lightPower?: number;
  hemi?: number;
  forest?: number; // how wooded (added to the forest noise)
}

const LOOKS: Record<Theme, Look> = {
  alpine: { sun: [22, 215], turbidity: 4, rayleigh: 1.4, fog: 0xa9bfd6, fogDensity: 0.00038, exposure: 0.42, grass: [0.16, 0.28, 0.09], grassDry: [0.34, 0.36, 0.16], rock: [0.36, 0.35, 0.34], verge: [0.28, 0.31, 0.17], snowline: 470, treeline: 440 },
  coast: { sun: [14, 250], turbidity: 6, rayleigh: 2.2, fog: 0xd8c8b4, fogDensity: 0.00034, exposure: 0.42, grass: [0.42, 0.45, 0.2], grassDry: [0.62, 0.55, 0.32], rock: [0.72, 0.66, 0.55], verge: [0.55, 0.5, 0.3], snowline: 1e9, treeline: 1e9 },
  desert: { sun: [30, 140], turbidity: 8, rayleigh: 1.2, fog: 0xe0b48a, fogDensity: 0.0003, exposure: 0.4, grass: [0.66, 0.42, 0.24], grassDry: [0.78, 0.55, 0.32], rock: [0.62, 0.3, 0.18], verge: [0.7, 0.5, 0.32], snowline: 1e9, treeline: 1e9, forest: -0.35 },
  night: { sun: [-5, 230], moon: [38, 120], turbidity: 2, rayleigh: 3, fog: 0x0b1120, fogDensity: 0.0006, exposure: 0.9, grass: [0.12, 0.2, 0.08], grassDry: [0.22, 0.25, 0.12], rock: [0.3, 0.3, 0.32], verge: [0.22, 0.24, 0.16], snowline: 520, treeline: 500, light: 0x9db5ff, lightPower: 0.55, hemi: 0.12, forest: 0.2 },
  autumn: { sun: [18, 200], turbidity: 5, rayleigh: 1.6, fog: 0xd9c7a8, fogDensity: 0.00036, exposure: 0.42, grass: [0.42, 0.4, 0.14], grassDry: [0.58, 0.46, 0.18], rock: [0.45, 0.42, 0.38], verge: [0.42, 0.36, 0.2], snowline: 1e9, treeline: 1e9, forest: 0.2 },
};

export interface TrackView {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  exposure: number;
  /** Keeps the shadow box and the sea under the camera. */
  follow(x: number, y: number, z: number, t: number): void;
  dispose(): void;
}

export function buildTrackView(t: Track, renderer: THREE.WebGLRenderer): TrackView {
  const look = LOOKS[t.def.theme];
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // --- Sky, sun, environment
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const u = sky.material.uniforms;
  u.turbidity.value = look.turbidity;
  u.rayleigh.value = look.rayleigh;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - look.sun[0]), THREE.MathUtils.degToRad(look.sun[1]));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(u));
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  const env = keep(pmrem.fromScene(envScene, 0.02)).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.fog = new THREE.FogExp2(look.fog, look.fogDensity);

  const sun = new THREE.DirectionalLight(look.light ?? 0xffe6c4, look.lightPower ?? 2.4);
  // At night the light comes from the moon, not the sun the sky is shaded with.
  const lightDir = look.moon ? new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - look.moon[0]), THREE.MathUtils.degToRad(look.moon[1])) : sunDir;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4030, look.hemi ?? 0.35));
  if (look.moon) scene.add(stars(lightDir, keep));

  const rng = mulberry(t.def.seed * 7919);

  // --- Terrain: a fine grid around the road and a coarse ring out to the horizon
  const detail = keep(noiseTexture(256, 0.5));
  const terrainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 }));
  const { x0, x1, z0, z1 } = t.bounds;
  const pad = 420;
  const inner = { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
  const colorAt = (x: number, z: number, h: number, ny: number, out: number[]) => {
    const n = fbm(x / 60, z / 60, t.def.seed + 3, 3) * 0.5 + 0.5;
    const steep = THREE.MathUtils.smoothstep(ny, 0.72, 0.9);
    const g = look.grass.map((c, i) => c + (look.grassDry[i] - c) * n);
    for (let i = 0; i < 3; i++) out[i] = look.rock[i] + (g[i] - look.rock[i]) * steep;
    // Snow on gentle slopes high up; sand by the sea.
    const snow = THREE.MathUtils.smoothstep(h + n * 30, look.snowline, look.snowline + 40) * THREE.MathUtils.smoothstep(ny, 0.6, 0.8);
    for (let i = 0; i < 3; i++) out[i] += (0.93 - out[i]) * snow;
    const water = t.def.water;
    if (water !== undefined) {
      // A beach by the sea, a muddy shore by a lake; darker under water.
      const shore = 1 - THREE.MathUtils.smoothstep(h, water + 1.5, water + 6);
      const sandC = t.def.theme === 'coast' ? [0.82, 0.74, 0.56] : [0.45, 0.4, 0.3];
      for (let i = 0; i < 3; i++) out[i] += (sandC[i] - out[i]) * shore;
      if (h < water - 1) for (let i = 0; i < 3; i++) out[i] *= 0.6;
    }
    if (t.def.theme === 'desert') {
      // Red-rock bands up the mesa faces.
      const band = 0.5 + 0.5 * Math.sin(h * 0.35 + n * 2);
      for (let i = 0; i < 3; i++) out[i] *= 0.85 + band * 0.25;
    }
    // Trodden verge by the road.
    const rd = roadDistance(t, x, z);
    const verge = 1 - THREE.MathUtils.smoothstep(rd, t.edge, t.edge + 10);
    for (let i = 0; i < 3; i++) out[i] += (look.verge[i] - out[i]) * verge * 0.7;
  };
  const terrainChunk = (cx0: number, cz0: number, cx1: number, cz1: number, step: number, sink: (x: number, z: number) => number, far: boolean) => {
    const nx = Math.round((cx1 - cx0) / step) + 1;
    const nz = Math.round((cz1 - cz0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const hs = new Float32Array(nx * nz);
    for (let r = 0; r < nz; r++)
      for (let c = 0; c < nx; c++) {
        const x = cx0 + c * step;
        const z = cz0 + r * step;
        hs[r * nx + c] = far ? terrainAt(t, x, z) : heightAt(t, x, z);
      }
    const tmp = [0, 0, 0];
    for (let r = 0; r < nz; r++)
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        const x = cx0 + c * step;
        const z = cz0 + r * step;
        const hx = hs[r * nx + Math.min(nx - 1, c + 1)] - hs[r * nx + Math.max(0, c - 1)];
        const hz = hs[Math.min(nz - 1, r + 1) * nx + c] - hs[Math.max(0, r - 1) * nx + c];
        const ny = 1 / Math.hypot(hx / (2 * step), 1, hz / (2 * step));
        const h = hs[i];
        pos.set([x, h - sink(x, z), z], i * 3);
        colorAt(x, z, h, ny, tmp);
        col.set(tmp, i * 3);
        uv.set([x / 7, z / 7], i * 2);
      }
    const idx: number[] = [];
    for (let r = 0; r < nz - 1; r++)
      for (let c = 0; c < nx - 1; c++) {
        const a = r * nx + c;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(keep(geo), terrainMat);
    mesh.receiveShadow = !far;
    scene.add(mesh);
  };
  // Under the road ribbon the terrain dips a little so it never pokes through.
  const underRoad = (x: number, z: number) => (roadDistance(t, x, z) < t.edge + 6 ? 0.45 : 0);
  const CH = 300;
  for (let cx = inner.x0; cx < inner.x1; cx += CH)
    for (let cz = inner.z0; cz < inner.z1; cz += CH) terrainChunk(cx, cz, Math.min(inner.x1, cx + CH), Math.min(inner.z1, cz + CH), 6, underRoad, false);
  const FAR = 4200;
  const insideInner = (x: number, z: number) => (x > inner.x0 + 1 && x < inner.x1 - 1 && z > inner.z0 + 1 && z < inner.z1 - 1 ? 40 : 0);
  terrainChunk(inner.x0 - FAR, inner.z0 - FAR, inner.x1 + FAR, inner.z1 + FAR, 70, insideInner, true);

  // --- Road ribbon (chunks of ~200 m)
  const roadTex = keep(roadTexture());
  roadTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const roadMat = keep(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const gravelTex = keep(gravelTexture());
  gravelTex.anisotropy = roadTex.anisotropy;
  const gravelMat = keep(new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // Ribbon pieces: at most ROAD_CHUNK samples, and a new piece wherever the surface changes.
  const pieces: [number, number][] = [];
  for (let i0 = 0; i0 < t.n - 1; ) {
    let i1 = Math.min(t.n - 1, i0 + 100);
    for (let i = i0 + 1; i < i1; i++)
      if (t.gravel[i] !== t.gravel[i0]) {
        i1 = i;
        break;
      }
    pieces.push([i0, i1]);
    i0 = i1;
  }
  // Across: verge | shoulder | road | shoulder | verge, matching the texture's columns.
  const cross = [-(t.rail + 1.2), -(t.half + SHOULDER), -t.half, t.half, t.half + SHOULDER, t.rail + 1.2];
  const crossU = [0, 0.12, 0.2, 0.8, 0.88, 1];
  const ROAD_CHUNK = 100;
  for (const [i0, i1] of pieces) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let k = 0; k < cross.length; k++) {
        const d = cross[k];
        const x = t.x[i] - t.tz[i] * d;
        const z = t.z[i] + t.tx[i] * d;
        const y = Math.abs(d) <= t.edge ? t.y[i] - t.bank[i] * d : heightAt(t, x, z);
        pos.push(x, y + 0.03, z);
        uvs.push(crossU[k], (i * SAMPLE) / 12);
      }
      if (i < i1) {
        const a = (i - i0) * cross.length;
        for (let k = 0; k < cross.length - 1; k++) idx.push(a + k, a + k + 1, a + k + cross.length, a + k + 1, a + k + 1 + cross.length, a + k + cross.length);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, t.gravel[i0] ? gravelMat : roadMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- Bridges and tunnels
  structures(scene, t, keep, !!look.moon);

  // --- Shortcuts: gravel tracks
  for (const c of t.cuts) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const n = c.x.length;
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1);
      const k = j === i ? i - 1 : i;
      const dx = c.x[j] - c.x[k];
      const dz = c.z[j] - c.z[k];
      const l = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const x = c.x[i] - (dz / l) * side * (CUT_HALF + 0.5);
        const z = c.z[i] + (dx / l) * side * (CUT_HALF + 0.5);
        pos.push(x, heightAt(t, x, z) + 0.05, z);
        uvs.push(side < 0 ? 0.15 : 0.85, (i * SAMPLE) / 12);
      }
      if (i < n - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, gravelMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- Armco both sides: a galvanised beam on posts.
  const railMat = keep(new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }));
  // Where a shortcut leaves the road the rail has a gap.
  const gap = (i: number, side: number) => t.cuts.length > 0 && onCut(t, t.x[i] - t.tz[i] * side * t.rail, t.z[i] + t.tx[i] * side * t.rail, 2.5);
  for (const side of [-1, 1]) {
    const runs: [number, number][] = [];
    for (let i = 0; i < t.n - 1; ) {
      while (i < t.n - 1 && gap(i, side)) i++;
      let j = i;
      while (j < t.n - 1 && j - i < ROAD_CHUNK && !gap(j + 1, side)) j++;
      if (j > i) runs.push([i, j]);
      i = j + 1;
    }
    for (const [i0, i1] of runs) {
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = i0; i <= i1; i++) {
        const d = side * (t.rail + 0.15);
        const x = t.x[i] - t.tz[i] * d;
        const z = t.z[i] + t.tx[i] * d;
        const y = t.y[i] - t.bank[i] * d;
        // A W-beam: three points in profile (low, bulge, high).
        pos.push(x, y + 0.42, z, x - t.tz[i] * side * 0.06, y + 0.6, z + t.tx[i] * side * 0.06, x, y + 0.78, z);
        if (i < i1) {
          const a = (i - i0) * 3;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
        }
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, railMat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  const postEvery = 2; // samples (4 m)
  const nPosts = Math.ceil(t.n / postEvery) * 2;
  const posts = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.12, 0.85, 0.08)), keep(new THREE.MeshStandardMaterial({ color: 0x8e9399, metalness: 0.7, roughness: 0.5 })), nPosts);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let pi = 0;
  for (let i = 0; i < t.n; i += postEvery)
    for (const side of [-1, 1]) {
      if (gap(i, side)) continue;
      const d = side * (t.rail + 0.3);
      v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 0.42, t.z[i] + t.tx[i] * d);
      q.setFromEuler(e.set(0, Math.atan2(-t.tx[i], -t.tz[i]), 0));
      posts.setMatrixAt(pi++, m4.compose(v, q, one));
    }
  posts.count = pi;
  posts.castShadow = true;
  scene.add(posts);

  // --- Chevrons on the outside of tight bends, and (alpine) red-and-white snow poles.
  const chevTex = keep(chevronTexture());
  const chev = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(0.9, 0.9)), keep(new THREE.MeshStandardMaterial({ map: chevTex, side: THREE.DoubleSide, emissive: 0x222200, roughness: 0.5 })), 600);
  let ci = 0;
  for (let i = 0; i < t.n && ci < 600; i += 6) {
    const k = t.curv[i];
    if (Math.abs(k) < 1 / 75) continue;
    const side = -Math.sign(k); // outside of the bend
    const d = side * (t.rail + 0.9);
    v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 1.5, t.z[i] + t.tx[i] * d);
    // Face back up the road; mirror for left-handers.
    q.setFromEuler(e.set(0, Math.atan2(-t.tx[i], -t.tz[i]) + Math.PI, 0));
    chev.setMatrixAt(ci++, m4.compose(v, q, new THREE.Vector3(k > 0 ? 1 : -1, 1, 1)));
  }
  chev.count = ci;
  scene.add(chev);
  if (t.def.theme === 'alpine' || t.def.theme === 'night') {
    const poleGeo = keep(new THREE.CylinderGeometry(0.04, 0.04, 2, 6));
    const poleMat = keep(new THREE.MeshStandardMaterial({ map: keep(stripeTexture()), roughness: 0.6 }));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.ceil(t.n / 12) * 2);
    let k = 0;
    for (let i = 0; i < t.n; i += 12)
      for (const side of [-1, 1]) {
        const d = side * (t.rail + 1.6);
        v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 1, t.z[i] + t.tx[i] * d);
        poles.setMatrixAt(k++, m4.compose(v, q.identity(), one));
      }
    poles.count = k;
    scene.add(poles);
  }

  // --- Start and finish gantries, with a chequered line across the road at the finish.
  gantry(scene, t, t.startS, 'START', false, keep);
  gantry(scene, t, t.finishS, 'FINISH', true, keep);

  // --- Forests and rocks
  scatter(scene, t, look, rng, inner, keep);
  village(scene, t, rng, keep, !!look.moon);

  // --- The sea (or a lake)
  let sea: THREE.Mesh | null = null;
  if (t.def.water !== undefined) {
    const normal = keep(noiseNormal(256));
    normal.repeat.set(400, 400);
    const mat = keep(new THREE.MeshStandardMaterial({ color: 0x0f4d68, roughness: 0.1, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 }));
    sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(16000, 16000)), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = t.def.water;
    sea.receiveShadow = true;
    scene.add(sea);
  }

  return {
    scene,
    sun,
    exposure: look.exposure,
    follow(x, y, z, time) {
      // Move the shadow box with the camera, in whole texels so the edges don't crawl.
      const texel = 90 / 2048;
      const sx = Math.round(x / texel) * texel;
      const sz = Math.round(z / texel) * texel;
      sun.target.position.set(sx, y, sz);
      sun.position.set(sx + lightDir.x * 200, y + lightDir.y * 200, sz + lightDir.z * 200);
      if (sea) {
        const n = (sea.material as THREE.MeshStandardMaterial).normalMap!;
        n.offset.set(time * 0.004, time * 0.0025);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      sky.material.dispose();
      envSky.material.dispose();
    },
  };
}

function gantry(scene: THREE.Scene, t: Track, s: number, text: string, chequer: boolean, keep: <T extends { dispose(): void }>(x: T) => T) {
  const c = pointAt(t, s, 0);
  const yaw = Math.atan2(-c.tx, -c.tz);
  const g = new THREE.Group();
  g.position.set(c.x, c.y, c.z);
  g.rotation.y = yaw;
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.45 }));
  const span = t.rail + 0.8;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 6.2, 0.4)), steel);
    post.position.set(side * span, 3.1, 0);
    post.castShadow = true;
    g.add(post);
  }
  const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 0.4, 1.3, 0.35)), steel);
  beam.position.y = 6.2;
  g.add(beam);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const x = canvas.getContext('2d')!;
  if (chequer) {
    for (let i = 0; i < 64; i++) for (let j = 0; j < 8; j++) {
      x.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
    x.fillStyle = 'rgba(0,0,0,0.6)';
    x.fillRect(300, 20, 424, 88);
  } else {
    x.fillStyle = '#c8102e';
    x.fillRect(0, 0, 1024, 128);
  }
  x.fillStyle = '#fff';
  x.font = 'bold 84px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 512, 68);
  const tex = keep(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const z of [-0.19, 0.19]) {
    const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(span * 2, 1.1)), keep(new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 })));
    banner.position.set(0, 6.2, z);
    if (z < 0) banner.rotation.y = Math.PI; // one face toward each direction
    g.add(banner);
  }
  if (chequer) {
    const lineTex = keep(new THREE.CanvasTexture(chequerCanvas()));
    lineTex.colorSpace = THREE.SRGBColorSpace;
    lineTex.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(t.half * 2, 1.2)), keep(new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.05;
    line.receiveShadow = true;
    g.add(line);
  } else {
    const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(t.half * 2, 0.4)), keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.05;
    g.add(line);
  }
  scene.add(g);
}

/** Trees (pines up the mountain, cypress and round pines by the sea) and boulders, instanced per 400 m tile. */
function scatter(scene: THREE.Scene, t: Track, look: Look, rng: () => number, area: { x0: number; x1: number; z0: number; z1: number }, keep: <T extends { dispose(): void }>(x: T) => T) {
  const theme = t.def.theme;
  const tree = keep(theme === 'alpine' || theme === 'night' ? pineGeometry() : theme === 'coast' ? coastTreeGeometry() : theme === 'desert' ? cactusGeometry() : mapleGeometry());
  // Maples each get their own autumn colour.
  const leaves = theme === 'autumn' ? [0xd8431f, 0xe8742a, 0xf2b233, 0xb8261e, 0xc9a23a, 0x6f8a32].map((c) => new THREE.Color(c)) : null;
  const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const rock = keep(rockGeometry());
  const rockMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(...look.rock).multiplyScalar(0.9), roughness: 0.95, flatShading: true }));
  const TILE = 400;
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let tx = area.x0; tx < area.x1; tx += TILE)
    for (let tz = area.z0; tz < area.z1; tz += TILE) {
      const trees: THREE.Matrix4[] = [];
      const rocks: THREE.Matrix4[] = [];
      for (let x = tx; x < tx + TILE; x += 10)
        for (let z = tz; z < tz + TILE; z += 10) {
          const px = x + rng() * 10;
          const pz = z + rng() * 10;
          const rd = roadDistance(t, px, pz);
          if (rd < t.edge + 9) continue;
          const forest = fbm(px / 140, pz / 140, t.def.seed + 11, 3) + (look.forest ?? (theme === 'alpine' ? 0.15 : -0.05));
          const h = heightAt(t, px, pz);
          if (t.def.water !== undefined && h < t.def.water + 2.5) continue;
          const slope = Math.abs(heightAt(t, px + 2, pz) - h) + Math.abs(heightAt(t, px, pz + 2) - h);
          // Thick by the road, thinning with distance (fog hides the rest).
          if (forest > 0.08 && rng() < 0.7 - Math.min(0.45, rd / 1400) && slope < 3.2 && h < look.treeline + rng() * 30 && rd < 700) {
            const sc = 0.75 + rng() * 0.7;
            q.setFromAxisAngle(up, rng() * Math.PI * 2);
            trees.push(new THREE.Matrix4().compose(v.set(px, h - 0.2, pz), q, s.set(sc, sc * (0.85 + rng() * 0.4), sc)));
          } else if (rng() < 0.02 + (slope > 2.5 ? 0.06 : 0)) {
            const sc = 0.5 + rng() * 2.2;
            q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
            rocks.push(new THREE.Matrix4().compose(v.set(px, h - sc * 0.3, pz), q, s.set(sc, sc * 0.7, sc)));
          }
        }
      for (const [list, geo, mat] of [
        [trees, tree, treeMat],
        [rocks, rock, rockMat],
      ] as const) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((mm, i) => {
          im.setMatrixAt(i, mm);
          if (leaves && list === trees) im.setColorAt(i, leaves[Math.floor(rng() * leaves.length)]);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        scene.add(im);
      }
    }
}

/** A cluster of houses beside the road near the finish (chalets or a harbour town). */
function village(scene: THREE.Scene, t: Track, rng: () => number, keep: <T extends { dispose(): void }>(x: T) => T, night: boolean) {
  const theme = t.def.theme;
  const walls = theme === 'coast' ? [0xf3ead9, 0xe9c9a0, 0xd9e6ee, 0xf1d3c2, 0xfff6e8] : theme === 'desert' ? [0xc98a5a, 0xd9a273, 0xb87650] : [0x8a5a3b, 0xe9e1d2, 0x9b6a45, 0xd8cbb4];
  const roofC = theme === 'coast' ? 0xb4583b : theme === 'desert' ? 0x9a5a38 : 0x3c3f45;
  // At night the village is lit: a few street lamps that really light the road.
  if (night) {
    const pole = keep(new THREE.CylinderGeometry(0.08, 0.1, 6, 6));
    const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.6 }));
    const bulbMat = keep(new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 4 }));
    for (const s of [t.finishS - 80, t.finishS - 10, t.finishS + 60, t.startS - 20]) {
      const p = pointAt(t, s, t.rail + 1.2);
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      const m = new THREE.Mesh(pole, poleMat);
      m.position.y = 3;
      const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.25, 10, 8)), bulbMat);
      bulb.position.y = 6.1;
      const light = new THREE.PointLight(0xffc98a, 60, 40, 1.6);
      light.position.y = 6;
      g.add(m, bulb, light);
      scene.add(g);
    }
  }
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  const roofGeo = keep(new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1));
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.rotateY(Math.PI / 2);
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.8 }));
  const spots = [t.finishS - 60, t.finishS - 20, t.finishS + 30, t.finishS + 80, t.finishS + 140, t.startS - 30, t.startS + 40];
  for (const s of spots)
    for (const side of [-1, 1]) {
      if (rng() < 0.25) continue;
      const d = side * (t.rail + 9 + rng() * 14);
      const p = pointAt(t, s + rng() * 10, d);
      const h = heightAt(t, p.x, p.z);
      const w = 6 + rng() * 4;
      const dpt = 7 + rng() * 4;
      const ht = 4 + rng() * 3;
      const g = new THREE.Group();
      g.position.set(p.x, h, p.z);
      g.rotation.y = Math.atan2(-p.tx, -p.tz) + (rng() < 0.5 ? 0 : Math.PI / 2);
      const wall = new THREE.Mesh(box, keep(new THREE.MeshStandardMaterial({ color: walls[Math.floor(rng() * walls.length)], roughness: 0.85 })));
      wall.scale.set(w, ht + 3, dpt);
      wall.position.y = (ht + 3) / 2 - 3;
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.scale.set(w * 1.15, ht * 0.45, dpt * 1.1);
      roof.position.y = ht + ht * 0.16;
      for (const m of [wall, roof]) {
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      scene.add(g);
    }
}

/** Concrete for bridges and tunnels: a deck on piers over each gorge, a lit gallery through each hill. */
function structures(scene: THREE.Scene, t: Track, keep: <T extends { dispose(): void }>(x: T) => T, night: boolean) {
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.85, map: keep(noiseTexture(128, 0.6)) }));
  const lampMat = keep(new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe2a8, emissiveIntensity: night ? 6 : 3 }));
  const w = t.rail + 1.2;
  const ribbon = (i0: number, i1: number, profile: [number, number][]) => {
    // A strip swept along the road through (d, height above the road) points.
    const pos: number[] = [];
    const idx: number[] = [];
    const m = profile.length;
    for (let i = i0; i <= i1; i++) {
      for (const [d, hy] of profile) pos.push(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * Math.max(-w, Math.min(w, d)) + hy, t.z[i] + t.tx[i] * d);
      if (i < i1) {
        const a = (i - i0) * m;
        for (let k = 0; k < m - 1; k++) idx.push(a + k, a + k + m, a + k + 1, a + k + 1, a + k + m, a + k + m + 1);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, concrete);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  for (const sp of t.spans) {
    const i0 = Math.max(0, Math.floor(sp.s0 / SAMPLE));
    const i1 = Math.min(t.n - 1, Math.ceil(sp.s1 / SAMPLE));
    if (sp.kind === 'bridge') {
      // The deck: under the road, from one side to the other, with a lip each side.
      ribbon(i0, i1, [
        [-w, 0.02],
        [-w, -1.6],
        [w, -1.6],
        [w, 0.02],
      ]);
      for (let i = i0 + 6; i < i1 - 3; i += 14) {
        for (const side of [-0.6, 0.6]) {
          const d = side * w;
          const x = t.x[i] - t.tz[i] * d;
          const z = t.z[i] + t.tx[i] * d;
          const top = t.y[i] - 1.5;
          const ground = terrainAt(t, x, z) - 3;
          if (top - ground < 2) continue;
          const pier = new THREE.Mesh(box, concrete);
          pier.scale.set(2.2, top - ground, 2.2);
          pier.position.set(x, (top + ground) / 2, z);
          pier.rotation.y = Math.atan2(-t.tx[i], -t.tz[i]);
          pier.castShadow = true;
          scene.add(pier);
        }
      }
    } else if (sp.kind === 'tunnel') {
      // Walls up to a roof, and a facade over each mouth.
      const H = 6.2;
      ribbon(i0, i1, [
        [w + 0.6, -0.5],
        [w, -0.5],
        [w, H],
        [-w, H],
        [-w, -0.5],
        [-w - 0.6, -0.5],
      ]);
      ribbon(i0, i1, [
        [-w - 0.6, H + 0.8],
        [w + 0.6, H + 0.8],
      ]);
      for (const i of [i0, i1]) {
        const face = new THREE.Mesh(box, concrete);
        face.scale.set(w * 2 + 14, 9, 1.2);
        face.position.set(t.x[i], t.y[i] + H + 4.4, t.z[i]);
        face.rotation.y = Math.atan2(-t.tx[i], -t.tz[i]);
        scene.add(face);
      }
      for (let i = i0 + 3; i < i1; i += 6) {
        const lamp = new THREE.Mesh(box, lampMat);
        lamp.scale.set(1.6, 0.1, 0.4);
        lamp.position.set(t.x[i], t.y[i] + H - 0.06, t.z[i]);
        lamp.rotation.y = Math.atan2(-t.tx[i], -t.tz[i]);
        scene.add(lamp);
      }
    }
  }
}

/** Stars and a moon for night tracks. */
function stars(moonDir: THREE.Vector3, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Group {
  const g = new THREE.Group();
  const n = 1800;
  const pos = new Float32Array(n * 3);
  const rng = mulberry(99);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().setFromSphericalCoords(9000, Math.acos(rng() * 0.95), rng() * Math.PI * 2);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.add(new THREE.Points(geo, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false }))));
  const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(220, 24, 16)), keep(new THREE.MeshBasicMaterial({ color: 0xf4f1e2, fog: false })));
  moon.position.copy(moonDir).multiplyScalar(8500);
  g.add(moon);
  return g;
}

// --- Procedural geometry and textures --------------------------------------------------------

function tint(geo: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => p.toNonIndexed());
  const total = ni.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of ni) {
    p.computeVertexNormals();
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function pineGeometry() {
  const parts = [tint(new THREE.CylinderGeometry(0.18, 0.28, 3, 5, 1, true).translate(0, 1.5, 0), 0x4a3424)];
  const tiers = [
    [3.2, 4.8, 2.9],
    [2.2, 4.0, 5.6],
    [1.2, 3.2, 8.0],
  ];
  for (const [r, h, y] of tiers) parts.push(tint(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y, 0), 0x1f3d26));
  return merge(parts);
}

function coastTreeGeometry() {
  // A stone pine: tall bare trunk, flat umbrella crown.
  const parts = [tint(new THREE.CylinderGeometry(0.2, 0.32, 7, 6).translate(0, 3.5, 0), 0x5b4433)];
  const crown = new THREE.SphereGeometry(3.6, 10, 6);
  crown.scale(1, 0.38, 1);
  crown.translate(0, 7.6, 0);
  parts.push(tint(crown, 0x3e5a2c));
  const c2 = new THREE.SphereGeometry(2.4, 8, 5);
  c2.scale(1, 0.4, 1);
  c2.translate(1.4, 8.4, 0.6);
  parts.push(tint(c2, 0x4a6834));
  return merge(parts);
}

function mapleGeometry() {
  // White canopy and dark trunk: each tree's instance colour tints it red, orange or gold.
  const parts = [tint(new THREE.CylinderGeometry(0.18, 0.3, 4, 6).translate(0, 2, 0), 0x3a2a20)];
  const crown = new THREE.IcosahedronGeometry(3.2, 1);
  crown.scale(1, 0.85, 1).translate(0, 5.6, 0);
  parts.push(tint(crown, 0xffffff));
  const c2 = new THREE.IcosahedronGeometry(2.2, 0);
  c2.translate(1.2, 7, 0.4);
  parts.push(tint(c2, 0xf0f0f0));
  return merge(parts);
}

function cactusGeometry() {
  // A saguaro: a column with two arms.
  const green = 0x4f6b3a;
  const parts = [tint(new THREE.CylinderGeometry(0.35, 0.42, 6, 8).translate(0, 3, 0), green)];
  parts.push(tint(new THREE.CylinderGeometry(0.25, 0.25, 1.4, 6).rotateZ(Math.PI / 2).translate(0.7, 2.6, 0), green));
  parts.push(tint(new THREE.CylinderGeometry(0.25, 0.25, 2, 6).translate(1.4, 3.4, 0), green));
  parts.push(tint(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6).rotateZ(Math.PI / 2).translate(-0.6, 3.6, 0), green));
  parts.push(tint(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6).translate(-1.2, 4.2, 0), green));
  return merge(parts);
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const s = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseTexture(size: number, contrast: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 8, (y / size) * 8, 5, 4) * 0.5 + Math.random() * 0.25;
      const v = Math.round(255 * Math.min(1, Math.max(0, 0.82 + n * contrast * 0.6)));
      img.data.set([v, v, v, 255], (y * size + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noiseNormal(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const h = (x: number, y: number) => fbm((x / size) * 6, (y / size) * 6, 9, 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = h((x + 1) % size, y) - h((x - 1 + size) % size, y);
      const dy = h(x, (y + 1) % size) - h(x, (y - 1 + size) % size);
      img.data.set([128 + dx * 400, 128 + dy * 400, 255, 255], (y * size + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Columns across the road: verge, shoulder, white edge line, asphalt with a dashed centre line, mirrored. */
function roadTexture() {
  const W = 512;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const n = Math.random();
      const grain = fbm((x / W) * 30, (y / H) * 30, 3, 3);
      let r: number, gg: number, b: number;
      if (u < 0.12 || u > 0.88) {
        // Gravel verge.
        const v = 110 + n * 70 + grain * 30;
        r = v * 0.95;
        gg = v * 0.9;
        b = v * 0.8;
      } else if (u < 0.2 || u > 0.8) {
        const v = 92 + n * 34 + grain * 16;
        r = gg = b = v;
      } else {
        const v = 64 + n * 30 + grain * 14;
        r = gg = b = v;
      }
      img.data.set([r, gg, b, 255], (y * W + x) * 4);
    }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(240,240,232,0.92)';
  g.fillRect(W * 0.2 + 4, 0, 9, H);
  g.fillRect(W * 0.8 - 13, 0, 9, H);
  g.fillStyle = 'rgba(245,240,225,0.9)';
  g.fillRect(W / 2 - 4, 0, 8, H * 0.35);
  // Tyre-darkened lines where cars actually drive.
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (const u of [0.32, 0.4, 0.6, 0.68]) g.fillRect(W * u, 0, W * 0.05, H);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Loose gravel: no lines, packed ruts where the cars go. */
function gravelTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const rut = Math.exp(-(((u - 0.38) / 0.06) ** 2)) + Math.exp(-(((u - 0.62) / 0.06) ** 2));
      const n = Math.random();
      const grain = fbm((x / S) * 24, (y / S) * 24, 8, 3);
      const v = 128 + n * 60 + grain * 30 - rut * 25;
      img.data.set([v * 1.05, v * 0.86, v * 0.66, 255], (y * S + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcf1a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(34, 18);
  g.lineTo(94, 64);
  g.lineTo(34, 110);
  g.lineTo(56, 110);
  g.lineTo(116, 64);
  g.lineTo(56, 18);
  g.fill();
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#fff' : '#d21f1f';
    g.fillRect(0, i * 8, 4, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chequerCanvas() {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(i * 8, j * 8, 8, 8);
    }
  return c;
}
