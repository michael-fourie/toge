// Draws a race track from its shared definition: physical sky (and the environment map it bakes), terrain
// with height/slope colouring, the road ribbon (lines, shoulders, verges), Armco, chevrons at the tight
// bends, snow poles or stone walls, start and finish gantries, instanced forests and rocks, villages and the sea.
// Static geometry is chunked so the frustum culls what's behind you.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CUT_HALF, type Crossing, SAMPLE, SHOULDER, type Theme, type Track, dirtFrom, fbm, heightAt, lapView, locate, newLoc, onCut, pointAt, roadDistance, terrainAt } from '../shared/track.ts';
import type { Grade } from './post.ts';
import { FACADE_H, FACADE_W, NEON_SIGNS, ROAD_TILE, TOWER_H, TOWER_W, asphalt, banner, facade, gravel, ground, mulberry, neonSigns, roofTiles, stone, towerFacade, vendingFront } from './tracktextures.ts';

/** The barrier's distance from the centreline at sample i on one side (-1 left, +1 right), runoff included. */
const railOf = (t: Track, i: number, side: number) => t.rail + (side < 0 ? t.runL[i] : t.runR[i]);

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
  /** The physical sky's brightness (1 = as three.js computes it). Day skies are toned down so the haze near the sun doesn't burn out to white. */
  skyGain?: number;
  /** The sky shader's clouds: coverage and density (0..1). */
  clouds?: [number, number];
  /** The painted distant scenery: public/race/backdrops/<backdrop>.webp, painted by dev/backdrops.py. */
  backdrop: string;
  forest?: number; // how wooded (added to the forest noise)
  /** White-painted guardrails, as on Japanese passes (otherwise galvanised). */
  whiteRail?: boolean;
  grade: Grade;
}

/** The film look: a hard, slightly cool image with warm highlights, lights that bloom. */
const grade = (g: Partial<Grade> = {}): Grade => ({
  // The day sky alone reaches ~10 after exposure near the sun: only lamps and glints may bloom.
  bloom: 0.3,
  threshold: 12,
  contrast: 1.2,
  saturation: 0.92,
  shadows: [0.9, 0.97, 1.1],
  highlights: [1.07, 1.0, 0.91],
  vignette: 0.42,
  ...g,
});

const LOOKS: Record<Theme, Look> = {
  alpine: { skyGain: 0.5, clouds: [0.45, 0.45], backdrop: 'alpine', sun: [22, 215], turbidity: 4, rayleigh: 1.4, fog: 0xa9bfd6, fogDensity: 0.00038, exposure: 0.42, grass: [0.16, 0.28, 0.09], grassDry: [0.34, 0.36, 0.16], rock: [0.36, 0.35, 0.34], verge: [0.28, 0.31, 0.17], snowline: 470, treeline: 440, grade: grade() },
  coast: { skyGain: 0.5, clouds: [0.35, 0.4], backdrop: 'coast', sun: [14, 250], turbidity: 6, rayleigh: 2.2, fog: 0xd8c8b4, fogDensity: 0.00034, exposure: 0.42, grass: [0.42, 0.45, 0.2], grassDry: [0.62, 0.55, 0.32], rock: [0.72, 0.66, 0.55], verge: [0.55, 0.5, 0.3], snowline: 1e9, treeline: 1e9, grade: grade({ highlights: [1.1, 1.0, 0.86] }) },
  desert: { skyGain: 0.48, clouds: [0.15, 0.3], backdrop: 'desert', sun: [30, 140], turbidity: 8, rayleigh: 1.2, fog: 0xe0b48a, fogDensity: 0.0003, exposure: 0.4, grass: [0.66, 0.42, 0.24], grassDry: [0.78, 0.55, 0.32], rock: [0.62, 0.3, 0.18], verge: [0.7, 0.5, 0.32], snowline: 1e9, treeline: 1e9, forest: -0.35, grade: grade({ contrast: 1.16, shadows: [0.86, 0.98, 1.14], highlights: [1.08, 0.99, 0.88] }) },
  night: { backdrop: 'night', sun: [-5, 230], moon: [38, 120], turbidity: 2, rayleigh: 3, fog: 0x0b1120, fogDensity: 0.0006, exposure: 0.9, grass: [0.12, 0.2, 0.08], grassDry: [0.22, 0.25, 0.12], rock: [0.3, 0.3, 0.32], verge: [0.22, 0.24, 0.16], snowline: 520, treeline: 500, light: 0x9db5ff, lightPower: 0.55, hemi: 0.12, forest: 0.2, whiteRail: true, grade: grade({ bloom: 0.45, threshold: 4.5, contrast: 1.12, saturation: 1.08, shadows: [0.82, 0.94, 1.22], highlights: [1.1, 0.98, 0.92], vignette: 0.55 }) },
  autumn: { skyGain: 0.5, clouds: [0.4, 0.4], backdrop: 'autumn', sun: [18, 200], turbidity: 5, rayleigh: 1.6, fog: 0xd9c7a8, fogDensity: 0.00036, exposure: 0.42, grass: [0.42, 0.4, 0.14], grassDry: [0.58, 0.46, 0.18], rock: [0.45, 0.42, 0.38], verge: [0.42, 0.36, 0.2], snowline: 1e9, treeline: 1e9, forest: 0.2, whiteRail: true, grade: grade({ highlights: [1.1, 1.0, 0.85] }) },
  city: { backdrop: 'city', sun: [-6, 200], moon: [30, 150], turbidity: 2, rayleigh: 3, fog: 0x1b1730, fogDensity: 0.0009, exposure: 0.9, grass: [0.1, 0.1, 0.11], grassDry: [0.16, 0.15, 0.15], rock: [0.2, 0.2, 0.21], verge: [0.18, 0.18, 0.19], snowline: 1e9, treeline: 1e9, light: 0xb4c2ff, lightPower: 0.5, hemi: 0.3, grade: grade({ bloom: 0.6, threshold: 4, contrast: 1.12, saturation: 1.15, shadows: [0.84, 0.9, 1.2], highlights: [1.1, 0.98, 0.95], vignette: 0.5 }) },
  spring: { skyGain: 0.5, clouds: [0.35, 0.35], backdrop: 'spring', sun: [28, 160], turbidity: 3, rayleigh: 1.8, fog: 0xdcdfec, fogDensity: 0.00034, exposure: 0.44, grass: [0.22, 0.38, 0.12], grassDry: [0.38, 0.44, 0.2], rock: [0.5, 0.48, 0.46], verge: [0.32, 0.4, 0.2], snowline: 1e9, treeline: 1e9, forest: 0.1, whiteRail: true, grade: grade({ saturation: 0.98, shadows: [0.93, 0.95, 1.08], highlights: [1.05, 1.0, 0.97] }) },
};

export interface TrackView {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  exposure: number;
  grade: Grade;
  /** Keeps the shadow box and the sea under the camera. */
  follow(x: number, y: number, z: number, t: number): void;
  dispose(): void;
}

/** `low`: Low graphics (src/client/graphics.ts): no shadow casting, no clouds, half the forest, brighter fill light. */
/** How much brighter the fill light is on Low, standing in for the environment light Lambert doesn't get. */
const LOW_FILL = 2.4;

export function buildTrackView(road: Track, renderer: THREE.WebGLRenderer, low = false): TrackView {
  const t = lapView(road); // a circuit is drawn once round
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
  u.mieCoefficient.value = look.moon ? 0.004 : 0.0025; // less glare round the sun
  if (look.clouds) [u.cloudCoverage.value, u.cloudDensity.value] = look.clouds;
  if (low) u.cloudCoverage.value = 0; // the clouds are a per-pixel noise loop over half the screen
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
  // The sun disc is brighter than a half float holds; unclamped it turns to Inf in the HDR targets and
  // the bloom (and the environment's blur) smear it over the whole screen.
  // skyGain tones the sky down (the sun disc included) without touching its colours. The sky the cars and
  // the ground see (the environment) is toned down less, so the shade under the trees doesn't go murky.
  const skyGain = look.skyGain ?? 1;
  for (const [s, gain] of [[sky, skyGain], [envSky, Math.max(skyGain, 0.8)]] as const) {
    s.material.fragmentShader = s.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', `gl_FragColor = vec4( min( texColor * ${gain.toFixed(3)}, vec3( 20.0 ) ), 1.0 );`);
  }
  // A ground below the horizon (the sky shader alone reflects as sky all round, which flattens paint),
  // and at night the glow of a distant town and a few lamps overhead, so the cars still catch light.
  const envKeep: { dispose(): void }[] = [];
  const envMesh = (geo: THREE.BufferGeometry, color: THREE.Color, at?: THREE.Vector3) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    if (at) {
      m.position.copy(at);
      m.lookAt(0, 0, 0);
    }
    envScene.add(m);
    envKeep.push(geo, mat);
  };
  envMesh(new THREE.SphereGeometry(500, 32, 8, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03), new THREE.Color(...look.grass).multiplyScalar(look.moon ? 0.03 : 1.4));
  if (look.moon) {
    envMesh(new THREE.CylinderGeometry(490, 490, 60, 48, 1, true), new THREE.Color(0.5, 0.22, 0.08));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      envMesh(new THREE.PlaneGeometry(120, 18), new THREE.Color(6, 4.2, 2.4), new THREE.Vector3(Math.cos(a) * 300, 300, Math.sin(a) * 300));
    }
  }
  const env = keep(pmrem.fromScene(envScene, 0.02)).texture;
  for (const d of envKeep) d.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.fog = new THREE.FogExp2(look.fog, look.fogDensity);

  const sun = new THREE.DirectionalLight(look.light ?? 0xffe6c4, look.lightPower ?? 1.75);
  // At night the light comes from the moon, not the sun the sky is shaded with.
  const lightDir = look.moon ? new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - look.moon[0]), THREE.MathUtils.degToRad(look.moon[1])) : sunDir;
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -45;
  sc.right = sc.top = 45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // Low's simple materials don't see the sky environment (scene.environment), so more fill light stands in for it.
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a4030, (look.hemi ?? 0.35) * (low ? LOW_FILL : 1)));
  if (look.moon) scene.add(stars(lightDir, keep));
  scene.add(backdrop(look.backdrop, keep));

  const rng = mulberry(t.def.seed * 7919);

  // --- Terrain: a fine grid around the road and a coarse ring out to the horizon
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const groundTex = ground(t.def.theme, t.def.seed, aniso);
  for (const tex of Object.values(groundTex)) keep(tex);
  const terrainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, ...groundTex, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, metalness: 0 }));
  // The same detail again at 12x the scale, so the tiling never shows as a grid from a distance.
  terrainMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      vec3 macro = texture2D( map, vMapUv * 0.083 + 0.37 ).rgb;
      sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), macro * 1.25, 0.65 );
      diffuseColor *= sampledDiffuseColor;`,
    );
  };
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
        uv.set([x / 6, z / 6], i * 2);
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
  const under = newLoc();
  const underRoad = (x: number, z: number) => {
    const rd = roadDistance(t, x, z);
    if (rd < t.edge + 6) return 0.45;
    if (rd > t.edgeMax + 8) return 0;
    locate(t, x, z, -1, under); // runoff widens what the ribbon covers
    return Math.abs(under.d) < railOf(t, under.i, under.d) + 7 ? 0.45 : 0;
  };
  const CH = 300;
  for (let cx = inner.x0; cx < inner.x1; cx += CH)
    for (let cz = inner.z0; cz < inner.z1; cz += CH) terrainChunk(cx, cz, Math.min(inner.x1, cx + CH), Math.min(inner.z1, cz + CH), 6, underRoad, false);
  const FAR = 4200;
  const insideInner = (x: number, z: number) => (x > inner.x0 + 1 && x < inner.x1 - 1 && z > inner.z0 + 1 && z < inner.z1 - 1 ? 40 : 0);
  terrainChunk(inner.x0 - FAR, inner.z0 - FAR, inner.x1 + FAR, inner.z1 + FAR, 70, insideInner, true);

  // --- Road ribbon (chunks of ~200 m)
  // At night the road is damp: the same textures, glossier, so the lamps and headlights streak on it.
  const roadTex = asphalt(t.def.theme, t.def.seed, aniso);
  for (const tex of Object.values(roadTex)) keep(tex);
  const roadMat = keep(new THREE.MeshStandardMaterial({ ...roadTex, normalScale: new THREE.Vector2(0.9, 0.9), roughness: look.moon ? 0.62 : 1, metalness: 0, envMapIntensity: look.moon ? 2.5 : 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const gravelTex = gravel(t.def.theme, t.def.seed, aniso);
  for (const tex of Object.values(gravelTex)) keep(tex);
  const gravelMat = keep(new THREE.MeshStandardMaterial({ ...gravelTex, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
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
  // Across: (runoff) | verge | shoulder | road | shoulder | verge | (runoff), matching the texture's columns.
  // The runoff columns have no width where there's none; where there is, the dirt below covers them.
  const crossU = [0, 0, 0.12, 0.2, 0.8, 0.88, 1, 1];
  const ROAD_CHUNK = 100;
  for (const [i0, i1] of pieces) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = i0; i <= i1; i++) {
      const cross = [-(railOf(t, i, -1) + 1.2), -(t.rail + 1.2), -(t.half + SHOULDER), -t.half, t.half, t.half + SHOULDER, t.rail + 1.2, railOf(t, i, 1) + 1.2];
      for (let k = 0; k < cross.length; k++) {
        const d = cross[k];
        const x = t.x[i] - t.tz[i] * d;
        const z = t.z[i] + t.tx[i] * d;
        const y = Math.abs(d) <= railOf(t, i, d) + t.edge - t.rail ? t.y[i] - t.bank[i] * d : heightAt(t, x, z);
        pos.push(x, y + 0.03, z);
        uvs.push(crossU[k], (i * SAMPLE) / ROAD_TILE);
      }
      if (i < i1) {
        const a = (i - i0) * cross.length;
        const c = cross.length;
        for (let k = 0; k < c - 1; k++) idx.push(a + k, a + k + 1, a + k + c, a + k + 1, a + k + 1 + c, a + k + c);
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

  // --- Runoff: dirt laid over the verge before the barrier, widening and narrowing with it.
  const dirtMat = keep(new THREE.MeshStandardMaterial({ ...gravelTex, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  for (const side of [-1, 1]) {
    const run = side < 0 ? t.runL : t.runR;
    for (let i = 0; i < t.n - 1; ) {
      while (i < t.n - 1 && run[i] < 0.02) i++;
      let j = i;
      while (j < t.n - 1 && j - i < ROAD_CHUNK && run[j + 1] >= 0.02) j++;
      if (j > i) {
        const pos: number[] = [];
        const uvs: number[] = [];
        const idx: number[] = [];
        for (let k = i; k <= j; k++) {
          const r = run[k];
          const to = t.rail + r + 1.2 * Math.min(1, r);
          // dirtFrom is Infinity under 5 cm of runoff (this strip starts at 2 cm): pinch it shut there, not off to infinity.
          const from = Math.min(dirtFrom(t, r), to);
          for (const d of [side * from, side * to]) {
            pos.push(t.x[k] - t.tz[k] * d, t.y[k] - t.bank[k] * d + 0.04, t.z[k] + t.tx[k] * d);
            uvs.push(d === side * from ? 0.03 : 0.03 + (to - from) / 14, (k * SAMPLE) / ROAD_TILE);
          }
          if (k < j) {
            const a = (k - i) * 2;
            if (side < 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
        const geo = keep(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, dirtMat);
        m.receiveShadow = true;
        scene.add(m);
      }
      i = j + 1;
    }
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
        uvs.push(side < 0 ? 0.15 : 0.85, (i * SAMPLE) / (ROAD_TILE / 2));
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
  const railMat = keep(
    look.whiteRail
      ? new THREE.MeshStandardMaterial({ color: 0xe9ecee, metalness: 0.05, roughness: 0.42, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.4, side: THREE.DoubleSide }),
  );
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
        const d = side * (railOf(t, i, side) + 0.15);
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
  const postMat = look.whiteRail ? railMat : keep(new THREE.MeshStandardMaterial({ color: 0x8e9399, metalness: 0.7, roughness: 0.5 }));
  const posts = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.12, 0.85, 0.08)), postMat, nPosts);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let pi = 0;
  for (let i = 0; i < t.n; i += postEvery)
    for (const side of [-1, 1]) {
      if (gap(i, side)) continue;
      const d = side * (railOf(t, i, side) + 0.3);
      v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 0.42, t.z[i] + t.tx[i] * d);
      q.setFromEuler(e.set(0, Math.atan2(-t.tx[i], -t.tz[i]), 0));
      posts.setMatrixAt(pi++, m4.compose(v, q, one));
    }
  posts.count = pi;
  posts.castShadow = true;
  scene.add(posts);
  // Round amber reflectors on every fifth post: they catch the headlights (and the bloom) at night.
  const reflGeo = keep(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12).rotateX(Math.PI / 2));
  const reflMat = keep(new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a10, emissiveIntensity: look.moon ? 14 : 0.5, roughness: 0.3 }));
  const refl = new THREE.InstancedMesh(reflGeo, reflMat, Math.ceil(t.n / (postEvery * 5)) * 2);
  let ri = 0;
  for (let i = 0; i < t.n; i += postEvery * 5)
    for (const side of [-1, 1]) {
      if (gap(i, side)) continue;
      const d = side * (railOf(t, i, side) + 0.3);
      v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 0.95, t.z[i] + t.tx[i] * d);
      q.setFromEuler(e.set(0, Math.atan2(-t.tx[i], -t.tz[i]), 0));
      refl.setMatrixAt(ri++, m4.compose(v, q, one));
    }
  refl.count = ri;
  scene.add(refl);

  // --- Chevrons on the outside of tight bends, and (alpine) red-and-white snow poles.
  const chevTex = keep(chevronTexture());
  const chev = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(0.9, 0.9)), keep(new THREE.MeshStandardMaterial({ map: chevTex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: chevTex, emissiveIntensity: look.moon ? 1.1 : 0.12, roughness: 0.5 })), 600);
  let ci = 0;
  for (let i = 0; i < t.n && ci < 600; i += 6) {
    const k = t.curv[i];
    if (Math.abs(k) < 1 / 75) continue;
    const side = -Math.sign(k); // outside of the bend
    const d = side * (railOf(t, i, side) + 0.9);
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
        const d = side * (railOf(t, i, side) + 1.6);
        v.set(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * d + 1, t.z[i] + t.tx[i] * d);
        poles.setMatrixAt(k++, m4.compose(v, q.identity(), one));
      }
    poles.count = k;
    scene.add(poles);
  }

  // --- Start and finish gantries, with a chequered line across the road at the finish (one line on a circuit).
  if (!t.lap) gantry(scene, t, t.startS, 'START', false, keep);
  gantry(scene, t, t.finishS, 'FINISH', true, keep);

  // --- Forests and rocks
  if (t.def.theme === 'city') city(scene, t, rng, inner, keep);
  else {
    scatter(scene, t, look, rng, inner, keep, low);
    village(scene, t, rng, keep, !!look.moon);
  }

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
    grade: look.grade,
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
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.75, roughness: 0.38 }));
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
  const tex = keep(banner(text, chequer ? 'ゴール' : 'スタート', chequer ? '#ff3b5c' : '#3ee8ff', chequer));
  const sign = keep(new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.6, roughness: 0.4 }));
  for (const z of [-0.19, 0.19]) {
    const panel = new THREE.Mesh(keep(new THREE.PlaneGeometry(span * 2, 1.1)), sign);
    panel.position.set(0, 6.2, z);
    if (z < 0) panel.rotation.y = Math.PI; // one face toward each direction
    g.add(panel);
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

/** Trees (pines up the mountain, cypress and round pines by the sea) and boulders, instanced per 400 m tile. A hill
 * climb's forest is thicker and closer. */
function scatter(scene: THREE.Scene, t: Track, look: Look, rng: () => number, area: { x0: number; x1: number; z0: number; z1: number }, keep: <T extends { dispose(): void }>(x: T) => T, low: boolean) {
  const theme = t.def.theme;
  const tree = keep(theme === 'alpine' || theme === 'night' ? pineGeometry() : theme === 'coast' ? coastTreeGeometry() : theme === 'desert' ? cactusGeometry() : mapleGeometry());
  // Maples each get their own autumn colour; in spring the same trees are cherries in blossom, with a few in fresh leaf.
  const palette = theme === 'autumn' ? [0xd8431f, 0xe8742a, 0xf2b233, 0xb8261e, 0xc9a23a, 0x6f8a32] : theme === 'spring' ? [0xf6b8cc, 0xf9cfdc, 0xee9fb8, 0xfde6ee, 0xf3a9c2, 0x86b04a] : null;
  const leaves = palette ? palette.map((c) => new THREE.Color(c)) : null;
  const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const rock = keep(rockGeometry());
  const rockTex = stone(t.def.seed);
  for (const tex of Object.values(rockTex)) keep(tex);
  rockTex.map.colorSpace = THREE.SRGBColorSpace;
  const rockMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(...look.rock).multiplyScalar(1.1), ...rockTex, roughness: 1, flatShading: true }));
  // Every tree a little different in shade and hue, even in a plain green forest.
  const jitter = new THREE.Color();
  const TILE = 400;
  // A hill climb's forest crowds right up to the barrier, with more boulders tumbled beside the road.
  const climb = !!t.def.climb;
  const near = climb ? 3.5 : 9;
  const here = newLoc();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // Low: trees out to 400 m instead of 700, and every other one past the first 60 (the same rolls either way,
  // so the trees that stay are where they'd be on High).
  let nth = 0;
  for (let tx = area.x0; tx < area.x1; tx += TILE)
    for (let tz = area.z0; tz < area.z1; tz += TILE) {
      const trees: THREE.Matrix4[] = [];
      const rocks: THREE.Matrix4[] = [];
      /** Low: the trees left out (still rolled and coloured, so everything after is placed as on High). */
      const cut = new Set<number>();
      for (let x = tx; x < tx + TILE; x += 10)
        for (let z = tz; z < tz + TILE; z += 10) {
          const px = x + rng() * 10;
          const pz = z + rng() * 10;
          const rd = roadDistance(t, px, pz);
          if (rd < t.edge + near) continue;
          if (rd < t.edgeMax + near && Math.abs(locate(t, px, pz, -1, here).d) < railOf(t, here.i, here.d) + near) continue; // not in the runoff
          const forest = fbm(px / 140, pz / 140, t.def.seed + 11, 3) + (look.forest ?? (theme === 'alpine' ? 0.15 : -0.05)) + (climb ? 0.2 : 0);
          const h = heightAt(t, px, pz);
          if (t.def.water !== undefined && h < t.def.water + 2.5) continue;
          const slope = Math.abs(heightAt(t, px + 2, pz) - h) + Math.abs(heightAt(t, px, pz + 2) - h);
          // Thick by the road, thinning with distance (fog hides the rest).
          if (forest > 0.08 && rng() < 0.7 - Math.min(0.45, rd / 1400) && slope < 3.2 && h < look.treeline + rng() * 30 && rd < 700) {
            const sc = 0.75 + rng() * 0.7;
            q.setFromAxisAngle(up, rng() * Math.PI * 2);
            trees.push(new THREE.Matrix4().compose(v.set(px, h - 0.2, pz), q, s.set(sc, sc * (0.85 + rng() * 0.4), sc)));
            if (low && !(rd < 400 && (rd < 60 || ++nth % 2 === 0))) cut.add(trees.length - 1);
          } else if (rng() < 0.02 + (slope > 2.5 ? 0.06 : 0) + (climb && rd < 60 ? 0.12 : 0)) {
            const sc = 0.5 + rng() * 2.2;
            q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
            rocks.push(new THREE.Matrix4().compose(v.set(px, h - sc * 0.3, pz), q, s.set(sc, sc * 0.7, sc)));
          }
        }
      for (const [list, geo, mat] of [
        [trees, tree, treeMat],
        [rocks, rock, rockMat],
      ] as const) {
        const n = list === trees ? list.length - cut.size : list.length;
        if (!n) {
          // Keep the rolls in step: each tree's colour takes two (three with a palette).
          if (list === trees) for (let i = 0; i < list.length * (leaves ? 3 : 2); i++) rng();
          continue;
        }
        const im = new THREE.InstancedMesh(geo, mat, n);
        let k = 0;
        list.forEach((mm, i) => {
          if (list !== trees) return im.setMatrixAt(i, mm);
          const base = leaves ? leaves[Math.floor(rng() * leaves.length)] : jitter.setRGB(1, 1, 1);
          jitter.copy(base).offsetHSL((rng() - 0.5) * 0.04, 0, 0).multiplyScalar(0.8 + rng() * 0.35);
          if (cut.has(i)) return;
          im.setMatrixAt(k, mm);
          im.setColorAt(k++, jitter);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        scene.add(im);
      }
    }
}

/** Downtown: a tower on every block (tallest near the start), lit offices, neon signs over the street, street lamps, red beacons on top. */
function city(scene: THREE.Scene, t: Track, rng: () => number, area: { x0: number; x1: number; z0: number; z1: number }, keep: <T extends { dispose(): void }>(x: T) => T) {
  const fac = towerFacade(t.def.seed);
  keep(fac.map);
  keep(fac.glow);
  const wallMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: fac.map, emissive: 0xffffff, emissiveMap: fac.glow, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.45, envMapIntensity: 1.3 }));
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: 0x26272b, roughness: 0.9 }));
  const signTex = keep(neonSigns());
  // Brighter than white: they bloom.
  const signMat = keep(new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(5, 5, 5), side: THREE.DoubleSide }));
  const beaconMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 0.6, 0.3) }));
  const tints = [0xc8d4e6, 0xaab8cc, 0xd9d2c4, 0x9fa6ad, 0xbfc7d2, 0x8f9aa8, 0xe2dccf];
  const here = newLoc();
  const sx = t.x[Math.round(t.startS / SAMPLE)];
  const sz = t.z[Math.round(t.startS / SAMPLE)];
  /** Clear of the road (and its lamps) at (x, z), by this much (m). */
  const clear = (x: number, z: number, by: number) => {
    const rd = roadDistance(t, x, z);
    if (rd > t.edgeMax + by + 30) return true;
    if (rd < t.edge) return false;
    locate(t, x, z, -1, here);
    return Math.abs(here.d) > railOf(t, here.i, here.d) + by;
  };
  const TILE = 400;
  const LOT = 34;
  const col = new THREE.Color();
  for (let tx = area.x0; tx < area.x1; tx += TILE)
    for (let tz = area.z0; tz < area.z1; tz += TILE) {
      const wall = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
      const roof: number[] = [];
      const signs = { pos: [] as number[], uv: [] as number[] };
      const beacons: THREE.Vector3[] = [];
      for (let x = tx; x < tx + TILE; x += LOT)
        for (let z = tz; z < tz + TILE; z += LOT) {
          const w = 14 + rng() * (LOT - 20);
          const d = 14 + rng() * (LOT - 20);
          const cx = x + LOT / 2 + (rng() - 0.5) * (LOT - 6 - w);
          const cz = z + LOT / 2 + (rng() - 0.5) * (LOT - 6 - d);
          if (roadDistance(t, cx, cz) > 900) continue;
          const pts: [number, number][] = [];
          for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0, 0.5]) pts.push([cx + fx * w, cz + fz * d]);
          if (!pts.every(([px, pz]) => clear(px, pz, 4))) continue;
          let floor = Infinity;
          for (const [px, pz] of pts) floor = Math.min(floor, heightAt(t, px, pz));
          if (t.def.water !== undefined && floor < t.def.water + 1) continue;
          const y0 = floor - 3;
          const downtown = 1 - THREE.MathUtils.smoothstep(Math.hypot(cx - sx, cz - sz), 300, 1500);
          const h = 12 + rng() ** 2 * (40 + 130 * downtown) + (roadDistance(t, cx, cz) < t.edgeMax + 40 ? 10 : 0);
          const y1 = floor + h;
          col.setHex(tints[Math.floor(rng() * tints.length)]);
          const u0 = Math.floor(rng() * 8) / 8;
          const v0 = Math.floor(rng() * 4) / 4;
          const x0 = cx - w / 2;
          const x1 = cx + w / 2;
          const z0 = cz - d / 2;
          const z1 = cz + d / 2;
          // Four walls, counter-clockwise from outside, the facade at its real size in metres.
          const faces: [number, number, number, number, number, number][] = [
            [x0, z1, x1, z1, 0, 1],
            [x1, z1, x1, z0, 1, 0],
            [x1, z0, x0, z0, 0, -1],
            [x0, z0, x0, z1, -1, 0],
          ];
          for (const [ax, az, bx, bz, nx, nz] of faces) {
            const len = Math.hypot(bx - ax, bz - az);
            const ua = u0;
            const ub = u0 + len / TOWER_W;
            const va = v0;
            const vb = v0 + (y1 - y0) / TOWER_H;
            wall.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
            wall.uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
            for (let k = 0; k < 6; k++) {
              wall.nor.push(nx, 0, nz);
              wall.col.push(col.r, col.g, col.b);
            }
          }
          roof.push(x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0);
          if (h > 70) beacons.push(new THREE.Vector3(cx, y1 + 0.6, cz));
          // A neon sign sticking out over the pavement, on the face nearest the road.
          if (roadDistance(t, cx, cz) < t.edgeMax + 45 && rng() < 0.55) {
            locate(t, cx, cz, -1, here);
            const toRoadX = here.cx - cx;
            const toRoadZ = here.cz - cz;
            const alongX = Math.abs(toRoadX) > Math.abs(toRoadZ);
            const fx = alongX ? cx + Math.sign(toRoadX) * (w / 2 + 1.4) : cx + (rng() - 0.5) * (w - 4);
            const fz = alongX ? cz + (rng() - 0.5) * (d - 4) : cz + Math.sign(toRoadZ) * (d / 2 + 1.4);
            // The board runs out from the wall (perpendicular to it), so you see it down the street.
            const ox = alongX ? 1.2 : 0;
            const oz = alongX ? 0 : 1.2;
            const sy0 = floor + 4 + rng() * 3;
            const sy1 = sy0 + 9;
            const k = Math.floor(rng() * NEON_SIGNS);
            const ua = k / NEON_SIGNS;
            const ub = (k + 1) / NEON_SIGNS;
            signs.pos.push(fx - ox, sy0, fz - oz, fx + ox, sy0, fz + oz, fx + ox, sy1, fz + oz, fx - ox, sy0, fz - oz, fx + ox, sy1, fz + oz, fx - ox, sy1, fz - oz);
            signs.uv.push(ua, 0, ub, 0, ub, 1, ua, 0, ub, 1, ua, 1);
          }
        }
      if (wall.pos.length) {
        const g = keep(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(wall.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(wall.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(wall.col, 3));
        const m = new THREE.Mesh(g, wallMat);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
        const rg = keep(new THREE.BufferGeometry());
        rg.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
        rg.computeVertexNormals();
        scene.add(new THREE.Mesh(rg, roofMat));
      }
      if (signs.pos.length) {
        const g = keep(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute(signs.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(signs.uv, 2));
        scene.add(new THREE.Mesh(g, signMat));
      }
      if (beacons.length) {
        const im = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.9, 0.9, 0.9)), beaconMat, beacons.length);
        beacons.forEach((b, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z)));
        scene.add(im);
      }
    }

  // Street lamps both sides, arms reaching over the road. Their heads glow; the light on the road comes from headlights.
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }));
  const headMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.6) }));
  const pole = keep(new THREE.CylinderGeometry(0.09, 0.13, 8, 6).translate(0, 4, 0));
  const arm = keep(new THREE.BoxGeometry(0.1, 0.1, 2.4).translate(0, 7.9, -1.1));
  const head = keep(new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, 7.8, -2.2));
  const every = 16; // samples (32 m)
  const n = Math.ceil(t.n / every) * 2;
  const poles = new THREE.InstancedMesh(pole, poleMat, n);
  const arms = new THREE.InstancedMesh(arm, poleMat, n);
  const heads = new THREE.InstancedMesh(head, headMat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let i = every; i < t.n - every; i += every)
    for (const side of [-1, 1]) {
      const dd = side * (railOf(t, i, side) + 0.8);
      v.set(t.x[i] - t.tz[i] * dd, t.y[i] - t.bank[i] * dd, t.z[i] + t.tx[i] * dd);
      // The arm (local -z) points across the road.
      q.setFromAxisAngle(up, Math.atan2(-t.tz[i] * side, t.tx[i] * side));
      m4.compose(v, q, one);
      poles.setMatrixAt(k, m4);
      arms.setMatrixAt(k, m4);
      heads.setMatrixAt(k, m4);
      k++;
    }
  for (const im of [poles, arms, heads]) {
    im.count = k;
    im.computeBoundingSphere();
    scene.add(im);
  }
  poles.castShadow = true;
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
  const fac = facade(t.def.seed, theme);
  keep(fac.map);
  keep(fac.glow);
  const roofGeo = keep(new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1));
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.rotateY(Math.PI / 2);
  const tiles = keep(roofTiles());
  tiles.rotation = Math.PI / 2;
  tiles.repeat.set(3, 3);
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: roofC, map: tiles, roughness: 0.7, metalness: 0.1 }));
  /** A wall block w x h x d (sunk 3 m into the ground) with the facade tiled at its real size in metres. */
  const wallGeo = (w: number, h: number, d: number) => {
    const geo = keep(new THREE.BoxGeometry(w, h, d));
    const uv = geo.getAttribute('uv');
    const size = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    const off = Math.floor(rng() * 4) / 4;
    for (let i = 0; i < uv.count; i++) {
      const [su, sv] = size[Math.floor(i / 4)];
      uv.setXY(i, off + (uv.getX(i) * su) / FACADE_W, (uv.getY(i) * sv) / FACADE_H);
    }
    return geo;
  };
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
      const wallMat = keep(new THREE.MeshStandardMaterial({ color: walls[Math.floor(rng() * walls.length)], map: fac.map, emissive: 0xffffff, emissiveMap: fac.glow, emissiveIntensity: night ? 2.2 : 0, roughness: 0.85 }));
      const wall = new THREE.Mesh(wallGeo(w, ht + 3, dpt), wallMat);
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
  // Vending machines by the road: a lit front of drinks, glowing in the dark (not in the desert).
  if (theme === 'desert') return;
  const vmGeo = keep(new THREE.BoxGeometry(1, 1.85, 0.75));
  const brands = [0xc8102e, 0x1e5bc6, 0xf0f0f0];
  for (const [k, s] of [t.finishS - 40, t.finishS + 25, t.startS + 12].entries()) {
    const side = k % 2 ? 1 : -1;
    const p = pointAt(t, s, side * (t.rail + 1.6));
    const brand = brands[k % brands.length];
    const front = keep(vendingFront(t.def.seed + k, '#' + brand.toString(16).padStart(6, '0')));
    const body = keep(new THREE.MeshStandardMaterial({ color: brand, roughness: 0.35, metalness: 0.2 }));
    const face = keep(new THREE.MeshStandardMaterial({ map: front, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: night ? 3.6 : 0.45, roughness: 0.15 }));
    for (let j = 0; j < 2; j++) {
      // Box faces: +x, -x, +y, -y, +z (the front), -z.
      const m = new THREE.Mesh(vmGeo, [body, body, body, body, face, body]);
      m.position.set(p.x - p.tx * j * 1.05, heightAt(t, p.x, p.z) + 0.92, p.z - p.tz * j * 1.05);
      m.rotation.y = Math.atan2(-p.tx, -p.tz) - side * (Math.PI / 2);
      m.castShadow = true;
      scene.add(m);
    }
  }
}

/** Concrete for bridges and tunnels: a deck on piers over each gorge, a lit gallery through each hill. */
function structures(scene: THREE.Scene, t: Track, keep: <T extends { dispose(): void }>(x: T) => T, night: boolean) {
  const tex = stone(t.def.seed + 1);
  for (const x of Object.values(tex)) keep(x);
  tex.map.colorSpace = THREE.SRGBColorSpace;
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0xa3a19b, ...tex, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1 }));
  const lampMat = keep(new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe2a8, emissiveIntensity: night ? 6 : 3 }));
  const w = t.rail + 1.2;
  const ribbon = (i0: number, i1: number, profile: [number, number][]) => {
    // A strip swept along the road through (d, height above the road) points.
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const m = profile.length;
    for (let i = i0; i <= i1; i++) {
      let along = 0;
      profile.forEach(([d, hy], k) => {
        if (k) along += Math.hypot(d - profile[k - 1][0], hy - profile[k - 1][1]);
        pos.push(t.x[i] - t.tz[i] * d, t.y[i] - t.bank[i] * Math.max(-w, Math.min(w, d)) + hy, t.z[i] + t.tx[i] * d);
        uvs.push(along / 4, (i * SAMPLE) / 4);
      });
      if (i < i1) {
        const a = (i - i0) * m;
        for (let k = 0; k < m - 1; k++) idx.push(a + k, a + k + m, a + k + 1, a + k + 1, a + k + m, a + k + m + 1);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, concrete);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const box = keep(new THREE.BoxGeometry(1, 1, 1));
  if (t.cross) overpass(t, t.cross, ribbon, box, concrete, w, scene);
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

/**
 * A figure 8's bridge: the deck under the upper road, and rows of piers with a crossbeam, the first pair of
 * rows just clear of the lower road's barriers either side, then every 14 m out to the embankments.
 */
function overpass(
  t: Track, c: Crossing, ribbon: (i0: number, i1: number, profile: [number, number][]) => void, box: THREE.BoxGeometry, concrete: THREE.Material, w: number, scene: THREE.Scene,
) {
  ribbon(c.i0, c.i1, [
    [-w, 0.02],
    [-w, -1.4],
    [-w + 1.2, -1.9],
    [w - 1.2, -1.9],
    [w, -1.4],
    [w, 0.02],
  ]);
  // How far a point is from the lower road's centreline.
  const lower: number[] = [];
  for (let i = 0; i < t.n; i++) if (c.low[i]) lower.push(i);
  const clear = (x: number, z: number) => Math.min(...lower.map((i) => Math.hypot(t.x[i] - x, t.z[i] - z)));
  const at = (i: number, d: number) => ({ x: t.x[i] - t.tz[i] * d, z: t.z[i] + t.tx[i] * d, top: t.y[i] - t.bank[i] * d - 1.8 });
  for (const dir of [-1, 1]) {
    let next = -1;
    for (let i = c.over; i > c.i0 + 2 && i < c.i1 - 2; i += dir) {
      // A row stands where both its piers (and a metre more) are clear of the lower road's barrier.
      const ok = [-0.62, 0.62].every((f) => {
        const p = at(i, f * w);
        return clear(p.x, p.z) > t.rail + 2.5;
      });
      if (!ok || (next >= 0 && (i - next) * dir < 0)) continue;
      next = i + dir * 7;
      const yaw = Math.atan2(-t.tx[i], -t.tz[i]);
      let low = Infinity;
      for (const f of [-0.62, 0.62]) {
        const p = at(i, f * w);
        const ground = heightAt(t, p.x, p.z) - 1;
        low = Math.min(low, ground);
        if (p.top - ground < 1) continue;
        const pier = new THREE.Mesh(box, concrete);
        pier.scale.set(1.8, p.top - ground, 1.8);
        pier.position.set(p.x, (p.top + ground) / 2, p.z);
        pier.rotation.y = yaw;
        pier.castShadow = true;
        pier.receiveShadow = true;
        scene.add(pier);
      }
      if (low === Infinity || at(i, 0).top - low < 1) continue;
      const beam = new THREE.Mesh(box, concrete);
      beam.scale.set(w * 2 - 1, 1.1, 2.2);
      beam.position.set(t.x[i], t.y[i] - 2.3, t.z[i]);
      beam.rotation.y = yaw;
      beam.castShadow = true;
      scene.add(beam);
    }
  }
}

/** The painted strip's shape: tan(elevation) at its top and bottom edges (as painted by dev/backdrops.py), and its radius. */
const BACKDROP = { top: 0.26, bottom: -0.06, r: 6000 };

/**
 * Distant scenery: a painted 360° strip on an open cylinder that rides with the camera, so it sits at the
 * horizon like the sky does. It's one draw call, drawn after the terrain (transparent, no depth write), so
 * every real hill in front hides it and only the gaps between show it; it costs no more than the sky
 * behind it. The image (~100-200 kB WebP) loads after the race starts; until then the map is a clear
 * placeholder, so the shader is compiled with the track and nothing recompiles when the picture arrives.
 */
function backdrop(image: string, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Mesh {
  const { top, bottom, r } = BACKDROP;
  const blank = keep(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  blank.colorSpace = THREE.SRGBColorSpace;
  blank.needsUpdate = true;
  const mat = keep(new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
  const geo = keep(new THREE.CylinderGeometry(r, r, r * (top - bottom), 128, 1, true));
  geo.translate(0, (r * (top + bottom)) / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // first of the transparent things: smoke and ghosts blend over it
  mesh.onBeforeRender = (_r, _s, cam) => {
    mesh.position.copy(cam.position);
    mesh.updateMatrixWorld();
  };
  let gone = false;
  new THREE.TextureLoader().load(`/race/backdrops/${image}.webp`, (tex) => {
    if (gone) return void tex.dispose();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat.map = keep(tex);
  });
  keep({ dispose: () => (gone = true) });
  return mesh;
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

/** Merges tinted parts into one geometry, keeping each part's own (smooth) normals. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    return p.index ? p.toNonIndexed() : p;
  });
  const total = ni.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of ni) {
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

/**
 * Shades a tinted part from dark at its bottom to light at its top (y0..y1), the cheap stand-in for the
 * self-shadowing inside a crown.
 */
function shade(geo: THREE.BufferGeometry, y0: number, y1: number, dark: number, light: number) {
  const p = geo.getAttribute('position');
  const c = geo.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const k = dark + (light - dark) * THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

function pineGeometry() {
  const parts = [tint(new THREE.CylinderGeometry(0.16, 0.28, 3, 5, 1, true).translate(0, 1.5, 0), 0x3a2a1e)];
  const tiers = [
    [3.3, 3.6, 2.6],
    [2.6, 3.4, 4.4],
    [1.9, 3.0, 6.2],
    [1.1, 2.6, 8.0],
  ];
  for (const [r, h, y] of tiers) {
    // A ragged hem: every other rim vertex pulled in and drooped, so the silhouette reads as boughs.
    const cone = new THREE.ConeGeometry(r, h, 10, 1, true);
    const p = cone.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) < 0 && i % 2) p.setXYZ(i, p.getX(i) * 0.72, p.getY(i) + 0.35, p.getZ(i) * 0.72);
    cone.translate(0, y, 0);
    parts.push(shade(tint(cone, 0x24452c), y - h / 2, y + h / 2, 0.45, 1.25));
  }
  return merge(parts);
}

function coastTreeGeometry() {
  // A stone pine: tall bare trunk, flat umbrella crown.
  const parts = [tint(new THREE.CylinderGeometry(0.2, 0.32, 7, 6).translate(0, 3.5, 0), 0x5b4433)];
  const centre = new THREE.Vector3(0, 7.8, 0);
  const crown = foliage(3.6, 0, 7.6, 0, 0x3e5a2c, 4, centre);
  crown.scale(1, 0.5, 1).translate(0, 3.8, 0);
  parts.push(crown);
  const c2 = foliage(2.4, 1.4, 8.4, 0.6, 0x4a6834, 5, centre);
  c2.scale(1, 0.5, 1).translate(0, 4.2, 0);
  parts.push(c2);
  return merge(parts);
}

/**
 * A lump of foliage: a sphere pushed in and out by noise, with normals pointing out from the crown's
 * centre (so the light falls across it softly, like a mass of leaves, not facets), and each vertex a
 * shade lighter or darker for leaf clusters. Darker underneath.
 */
function foliage(r: number, cx: number, cy: number, cz: number, color: number, seed: number, crown = new THREE.Vector3(cx, cy, cz)) {
  const g = new THREE.SphereGeometry(r, 8, 6);
  const p = g.getAttribute('position');
  const rnd = mulberry(seed);
  const bumps = [0, 1, 2, 3].map(() => new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    let k = 1;
    for (const b of bumps) k += Math.max(0, d.dot(b)) ** 3 * 0.22;
    // Seams of the sphere share positions: the noise must depend on position only.
    k += Math.sin(d.x * 7.1 + d.y * 3.3) * Math.cos(d.z * 6.7 - d.y * 2.1) * 0.08;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 0.85, 1).translate(cx, cy, cz);
  tint(g, color);
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(crown).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const leaf = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * Math.cos(p.getY(i) * 2.7));
    const under = 0.55 + 0.45 * THREE.MathUtils.smoothstep(v.y, -0.8, 0.6);
    c.setXYZ(i, c.getX(i) * leaf * under, c.getY(i) * leaf * under, c.getZ(i) * leaf * under);
  }
  return g;
}

function mapleGeometry() {
  // White canopy and dark trunk: each tree's instance colour tints it red, orange or gold.
  const parts = [tint(new THREE.CylinderGeometry(0.16, 0.3, 4.4, 6).translate(0, 2.2, 0), 0x3a2a20)];
  const centre = new THREE.Vector3(0, 6, 0);
  parts.push(foliage(3, 0, 5.8, 0, 0xffffff, 1, centre));
  parts.push(foliage(2, 1.3, 7, 0.5, 0xf2f2f2, 2, centre));
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
