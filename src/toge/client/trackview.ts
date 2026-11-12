// Draws a race track from its shared definition: physical sky (and the environment map it bakes), terrain
// with height/slope colouring, the road ribbon (lines, shoulders, verges), Armco, chevrons at the tight
// bends, snow poles or stone walls, start and finish gantries, instanced forests and rocks, villages and the sea.
// Static geometry is chunked so the frustum culls what's behind you.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CUT_HALF, type Crossing, SAMPLE, type Theme, type Track, type TrackId, dirtFrom, fbm, heightAt, lapView, locate, newLoc, onCut, pointAt, roadDistance, terrainAt } from '../shared/track.ts';
import type { Grade } from './post.ts';
import { envLevel } from './envlevel.ts';
import { decor, type Site } from './scenery.ts';
import { TOWNS } from './towns.ts';
import { BUSH_COLOURS, WIND, bushGeometry, farTree, farTwin, speciesFor, sway } from './trees.ts';
import { LOD, LodTiles, ShadowOnly, shadowCasters } from './lod.ts';
import { NEON_SIGNS, ROAD_TILE, asphalt, banner, gravel, ground, mulberry, neonSigns, roofTiles, stone, vendingFront } from './tracktextures.ts';
import { FACADE_H, FACADE_W, FAC_STYLES, NO_SHOPS, TOWER_H, TOWER_W, facade, facadeMaterial, pushFac, roofDeck, roofUv, towerFacade } from './facades.ts';

/** The barrier's distance from the centreline at sample i on one side (-1 left, +1 right), runoff included. */
const railOf = (t: Track, i: number, side: number) => t.rail + (side < 0 ? t.runL[i] : t.runR[i]);

export interface Look {
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
  /** The moon's colour and how much bigger than usual it hangs (Shura's blood moon). */
  moonColor?: number;
  moonSize?: number;
  /** A sky road's glowing edge strips (cyan unless a track says otherwise). */
  edge?: number;
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
  /** The asphalt's own colour (CSS hex), over the theme's: Taketomi's pale coral-sand lanes. */
  tar?: string;
  grade: Grade;
}

/** The film look: a hard, slightly cool image with warm highlights, lights that bloom. */
export const grade = (g: Partial<Grade> = {}): Grade => ({
  // The day sky alone reaches ~10 after exposure near the sun: only lamps and glints may bloom.
  bloom: 0.3,
  threshold: 12,
  contrast: 1.2,
  saturation: 0.92,
  shadows: [0.9, 0.97, 1.1],
  highlights: [1.07, 1.0, 0.91],
  vignette: 0.42,
  flare: 1,
  ...g,
});

export const LOOKS: Record<Theme, Look> = {
  alpine: { skyGain: 0.5, clouds: [0.45, 0.45], backdrop: 'alpine', sun: [22, 215], turbidity: 4, rayleigh: 1.4, fog: 0xa9bfd6, fogDensity: 0.00038, exposure: 0.42, grass: [0.16, 0.28, 0.09], grassDry: [0.34, 0.36, 0.16], rock: [0.36, 0.35, 0.34], verge: [0.28, 0.31, 0.17], snowline: 470, treeline: 440, grade: grade() },
  coast: { skyGain: 0.5, clouds: [0.35, 0.4], backdrop: 'coast', sun: [14, 250], turbidity: 6, rayleigh: 2.2, fog: 0xd8c8b4, fogDensity: 0.00034, exposure: 0.42, grass: [0.42, 0.45, 0.2], grassDry: [0.62, 0.55, 0.32], rock: [0.72, 0.66, 0.55], verge: [0.55, 0.5, 0.3], snowline: 1e9, treeline: 1e9, grade: grade({ highlights: [1.1, 1.0, 0.86] }) },
  desert: { skyGain: 0.48, clouds: [0.15, 0.3], backdrop: 'desert', sun: [30, 140], turbidity: 8, rayleigh: 1.2, fog: 0xe0b48a, fogDensity: 0.0003, exposure: 0.4, grass: [0.66, 0.42, 0.24], grassDry: [0.78, 0.55, 0.32], rock: [0.62, 0.3, 0.18], verge: [0.7, 0.5, 0.32], snowline: 1e9, treeline: 1e9, forest: -0.35, grade: grade({ contrast: 1.16, shadows: [0.86, 0.98, 1.14], highlights: [1.08, 0.99, 0.88] }) },
  night: { backdrop: 'night', sun: [-5, 230], moon: [38, 120], turbidity: 2, rayleigh: 3, fog: 0x0b1120, fogDensity: 0.0006, exposure: 1.0, grass: [0.12, 0.2, 0.08], grassDry: [0.22, 0.25, 0.12], rock: [0.3, 0.3, 0.32], verge: [0.22, 0.24, 0.16], snowline: 520, treeline: 500, light: 0x9db5ff, lightPower: 0.8, hemi: 0.35, forest: 0.2, whiteRail: true, grade: grade({ bloom: 0.45, threshold: 4.5, contrast: 1.12, saturation: 1.08, shadows: [0.82, 0.94, 1.22], highlights: [1.1, 0.98, 0.92], vignette: 0.55, flare: 0 }) },
  autumn: { skyGain: 0.5, clouds: [0.4, 0.4], backdrop: 'autumn', sun: [18, 200], turbidity: 5, rayleigh: 1.6, fog: 0xd9c7a8, fogDensity: 0.00036, exposure: 0.42, grass: [0.42, 0.4, 0.14], grassDry: [0.58, 0.46, 0.18], rock: [0.45, 0.42, 0.38], verge: [0.42, 0.36, 0.2], snowline: 1e9, treeline: 1e9, forest: 0.2, whiteRail: true, grade: grade({ highlights: [1.1, 1.0, 0.85] }) },
  city: { backdrop: 'city', sun: [-6, 200], moon: [30, 150], turbidity: 2, rayleigh: 3, fog: 0x1b1730, fogDensity: 0.0009, exposure: 1.0, grass: [0.1, 0.1, 0.11], grassDry: [0.16, 0.15, 0.15], rock: [0.2, 0.2, 0.21], verge: [0.18, 0.18, 0.19], snowline: 1e9, treeline: 1e9, light: 0xb4c2ff, lightPower: 0.7, hemi: 0.5, grade: grade({ bloom: 0.6, threshold: 4, contrast: 1.12, saturation: 1.15, shadows: [0.84, 0.9, 1.2], highlights: [1.1, 0.98, 0.95], vignette: 0.5, flare: 0 }) },
  spring: { skyGain: 0.5, clouds: [0.35, 0.35], backdrop: 'spring', sun: [28, 160], turbidity: 3, rayleigh: 1.8, fog: 0xdcdfec, fogDensity: 0.00034, exposure: 0.44, grass: [0.22, 0.38, 0.12], grassDry: [0.38, 0.44, 0.2], rock: [0.5, 0.48, 0.46], verge: [0.32, 0.4, 0.2], snowline: 1e9, treeline: 1e9, forest: 0.1, whiteRail: true, grade: grade({ saturation: 0.98, shadows: [0.93, 0.95, 1.08], highlights: [1.05, 1.0, 0.97] }) },
};

/**
 * A track's own look, over its theme's. Keep fog as the theme's, since the painted backdrop's haze is the theme's
 * fog colour.
 */
export const TRACK_LOOKS: Partial<Record<TrackId, Partial<Look>>> = {
  // Minato Street is floodlit: a brighter, whiter fill than Neon Bay's streets.
  minato: { light: 0xe4ebff, lightPower: 0.85, hemi: 0.6, exposure: 1.0 },
  // Kazeoka Dunes: sand-coloured dune grass and a thin scatter of pines.
  kazeoka: { grass: [0.7, 0.6, 0.32], grassDry: [0.9, 0.76, 0.5], verge: [0.66, 0.58, 0.36], forest: -0.32 },
  // Akane Sands races in the late sun: low in the west, its light gone gold.
  akane: { sun: [11, 250], turbidity: 12, rayleigh: 1.3, light: 0xffb26a, lightPower: 2.3, hemi: 0.5, skyGain: 0.6, clouds: [0.3, 0.35], exposure: 0.5, grade: grade({ contrast: 1.16, saturation: 1.05, shadows: [0.86, 0.92, 1.12], highlights: [1.14, 0.99, 0.84] }) },
  // Kumo Skyway: high noon over the cloud sea, a clear sky above and a thin haze so the far road still shows.
  kumo: { sun: [36, 200], clouds: [0.2, 0.3], fogDensity: 0.00022, exposure: 0.44 },
  // Shura Sky Arena (the battle royale): night over the cloud sea under a huge blood moon, the road's edges and its
  // torii glowing red, a warmer, harder grade. The moon sits low ahead down the main straight.
  shura: { moon: [16, 175], moonColor: 0xff5238, moonSize: 3.2, light: 0xff9a8a, lightPower: 0.7, hemi: 0.2, edge: 0xff1e44, fogDensity: 0.00035, grade: grade({ bloom: 0.55, threshold: 4, contrast: 1.18, saturation: 1.15, shadows: [0.92, 0.84, 1.12], highlights: [1.16, 0.95, 0.9], vignette: 0.6, flare: 0 }) },
  // Toge (the open world) in the late afternoon: the sun warm but well up in the west-south-west, so every way you
  // drive is lit (a golden-hour sun left half the island in shade), and greener grass for the long views.
  // The sprint rings race at midday (Andrew: "day-time maps"): the sun high, so nothing reads as evening. The coast
  // theme's own sun sits at 14°, which looks like late afternoon.
  mizuumi: { sun: [38, 195] },
  hibari: { sun: [44, 205], light: 0xfff2dc },
  kamome: { sun: [46, 170], light: 0xfff4e4 },
  shiokaze: { sun: [40, 230], light: 0xfff0d8 },
  // The Postcard Cup, each town at its best hour. Taketomi at tropical midday: a high sun, white coral sand on the
  // verges and pale lanes; Hallstatt in the gold of the evening; Göreme at sunrise, bare pale tuff and no trees;
  // Oia at sunset over the caldera, dark volcanic rock; Chefchaouen in the clear morning, pines and cypress.
  taketomi: { sun: [52, 190], light: 0xfff6e6, turbidity: 4, rayleigh: 2.6, grass: [0.24, 0.42, 0.14], grassDry: [0.5, 0.52, 0.28], verge: [0.84, 0.8, 0.7], rock: [0.82, 0.78, 0.7], forest: 0.05, tar: '#8d887c', grade: grade({ saturation: 1.06, highlights: [1.06, 1.0, 0.94] }) },
  hallstatt: { sun: [19, 250], light: 0xffd0a0, lightPower: 2.1, hemi: 0.6, turbidity: 5, clouds: [0.4, 0.4], exposure: 0.5, grade: grade({ saturation: 1.02, highlights: [1.12, 1.0, 0.86] }) },
  goreme: { sun: [17, 100], light: 0xffc090, lightPower: 2.4, hemi: 0.7, turbidity: 8, rayleigh: 1.4, skyGain: 0.6, exposure: 0.55, grass: [0.62, 0.54, 0.4], grassDry: [0.78, 0.68, 0.5], rock: [0.82, 0.7, 0.52], verge: [0.72, 0.62, 0.46], forest: -1, grade: grade({ contrast: 1.14, saturation: 1.04, shadows: [0.88, 0.9, 1.12], highlights: [1.14, 1.0, 0.9] }) },
  oia: { sun: [12, 262], light: 0xffb070, lightPower: 2.4, hemi: 0.7, turbidity: 9, rayleigh: 1.8, skyGain: 0.62, exposure: 0.56, grass: [0.48, 0.44, 0.26], grassDry: [0.6, 0.52, 0.34], rock: [0.48, 0.36, 0.3], verge: [0.55, 0.47, 0.36], forest: -0.5, grade: grade({ contrast: 1.15, saturation: 1.06, shadows: [0.86, 0.9, 1.14], highlights: [1.15, 0.99, 0.84] }) },
  chefchaouen: { sun: [26, 120], light: 0xfff0d8, turbidity: 4, grass: [0.34, 0.4, 0.18], grassDry: [0.52, 0.5, 0.3], rock: [0.6, 0.55, 0.48], verge: [0.5, 0.47, 0.34], forest: 0 },
  toge: { sun: [24, 235], turbidity: 6, rayleigh: 1.8, light: 0xffd6a8, lightPower: 2.4, hemi: 0.85, skyGain: 0.58, clouds: [0.32, 0.38], exposure: 0.48, fogDensity: 0.00018, grass: [0.25, 0.42, 0.14], grassDry: [0.46, 0.5, 0.22], rock: [0.52, 0.48, 0.42], verge: [0.44, 0.42, 0.27], grade: grade({ contrast: 1.12, saturation: 1.06, shadows: [0.9, 0.95, 1.08], highlights: [1.1, 1.0, 0.88] }) },
};

export interface TrackView {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  exposure: number;
  grade: Grade;
  /** Towards the sun (for the lens flare), or null when it's down. */
  sunDir: THREE.Vector3 | null;
  /** Keeps the shadow box and the sea under the camera. */
  follow(x: number, y: number, z: number, t: number): void;
  dispose(): void;
}

/**
 * Grass, earth and rock barely shine. With the full dielectric sheen three.js gives every rough material, any slope seen
 * at a glancing angle toward the sun (or under a bright sky) washed out to a flat pale grey: the desert went the colour
 * of concrete and the far mountains looked like plastic. Cutting the terrain's specular to a third keeps its own
 * colours. Free: two multiplies in the shader. (On Low the Lambert stand-in has no such chunk, so it's a no-op there.)
 */
export function matteGround(sh: { fragmentShader: string }) {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <lights_physical_fragment>',
    `#include <lights_physical_fragment>
    material.specularColor *= 0.3;
    material.specularF90 *= 0.3;`,
  );
}

/** `low`: Low graphics (src/client/graphics.ts): no shadow casting, no clouds, half the forest, brighter fill light. */
/** How much brighter the fill light is on Low, standing in for the environment light Lambert doesn't get. */
export const LOW_FILL = 2.4;
/** How strongly the guardrails glow at night (emissive), so the road's edge shows in the dark. */
const NIGHT_RAIL = 0.22;
/** The terrain fades fully into the fog between these view depths (m), well before the far ring's edge (4.2 km past the track). */
export const HORIZON_FADE = [3200, 5200];

export function buildTrackView(road: Track, renderer: THREE.WebGLRenderer, low = false): TrackView {
  const t = lapView(road); // a circuit is drawn once round
  const look: Look = { ...LOOKS[t.def.theme], ...TRACK_LOOKS[t.def.id] };
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  /** Terrain and forest tiles that swap to a cheaper version (or none) far from the camera. */
  const lods = new LodTiles();

  // --- Sky, sun, environment
  const { sky, envSky, sun, sunDir, lightDir } = atmosphere(scene, look, renderer, low, keep);

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
    matteGround(sh);
    // The far ring ends in a square edge ~4 km out: fade it fully into the fog before then, so the land melts into the
    // painted backdrop's haze (whose foot is the fog colour) instead of stopping on a hard straight line.
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <fog_fragment>',
      `#include <fog_fragment>
      #ifdef USE_FOG
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( ${(HORIZON_FADE[0]).toFixed(1)}, ${(HORIZON_FADE[1]).toFixed(1)}, vFogDepth ) );
      #endif`,
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
    if (!far && (nx - 1) % 2 === 0 && (nz - 1) % 2 === 0) lods.add(mesh, coarse(geo, nx, nz), cx0, cz0, cx1, cz1, LOD.terrain);
  };
  /**
   * A fine chunk's stand-in past LOD.terrain: every other vertex (a quarter of the triangles), each at the lowest of the
   * fine vertices round it so it never rises through a road the fine grid dipped under, and a skirt hanging from its
   * edges so the seam against a fine neighbour shows no gap.
   */
  const coarse = (fine: THREE.BufferGeometry, nx: number, nz: number) => {
    const fp = fine.getAttribute('position');
    const fc = fine.getAttribute('color');
    const fu = fine.getAttribute('uv');
    const fn = fine.getAttribute('normal');
    const cx = (nx - 1) / 2 + 1;
    const cz = (nz - 1) / 2 + 1;
    const ring = 2 * (cx - 1) + 2 * (cz - 1);
    const count = cx * cz + ring;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const nor = new Float32Array(count * 3);
    const copy = (to: number, from: number, y: number) => {
      pos.set([fp.getX(from), y, fp.getZ(from)], to * 3);
      col.set([fc.getX(from), fc.getY(from), fc.getZ(from)], to * 3);
      uv.set([fu.getX(from), fu.getY(from)], to * 2);
      nor.set([fn.getX(from), fn.getY(from), fn.getZ(from)], to * 3);
    };
    for (let r = 0; r < cz; r++)
      for (let c = 0; c < cx; c++) {
        const fr = r * 2;
        const fcI = c * 2;
        let y = Infinity;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = fr + dr;
            const cc = fcI + dc;
            if (rr >= 0 && rr < nz && cc >= 0 && cc < nx) y = Math.min(y, fp.getY(rr * nx + cc));
          }
        copy(r * cx + c, fr * nx + fcI, y);
      }
    const idx: number[] = [];
    for (let r = 0; r < cz - 1; r++)
      for (let c = 0; c < cx - 1; c++) {
        const a = r * cx + c;
        idx.push(a, a + cx, a + 1, a + 1, a + cx, a + cx + 1);
      }
    // The skirt: the border's vertices again, 4 m lower, walled to the border round the whole chunk.
    const border: number[] = [];
    for (let c = 0; c < cx - 1; c++) border.push(c);
    for (let r = 0; r < cz - 1; r++) border.push(r * cx + cx - 1);
    for (let c = cx - 1; c > 0; c--) border.push((cz - 1) * cx + c);
    for (let r = cz - 1; r > 0; r--) border.push(r * cx);
    border.forEach((b, k) => {
      const to = cx * cz + k;
      pos.set([pos[b * 3], pos[b * 3 + 1] - 4, pos[b * 3 + 2]], to * 3);
      col.set(col.subarray(b * 3, b * 3 + 3), to * 3);
      uv.set(uv.subarray(b * 2, b * 2 + 2), to * 2);
      nor.set(nor.subarray(b * 3, b * 3 + 3), to * 3);
    });
    for (let k = 0; k < ring; k++) {
      const a = border[k];
      const b = border[(k + 1) % ring];
      const a2 = cx * cz + k;
      const b2 = cx * cz + ((k + 1) % ring);
      // Both windings: the skirt is seen from whichever side the gap is on.
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(keep(geo), terrainMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
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
  // A sky road has no ground: only the road, its deck and the clouds far below (skyDeck).
  const skyRoad = !!t.def.sky;
  if (!skyRoad)
    for (let cx = inner.x0; cx < inner.x1; cx += CH)
      for (let cz = inner.z0; cz < inner.z1; cz += CH) terrainChunk(cx, cz, Math.min(inner.x1, cx + CH), Math.min(inner.z1, cz + CH), 6, underRoad, false);
  const FAR = 4200;
  const insideInner = (x: number, z: number) => (x > inner.x0 + 1 && x < inner.x1 - 1 && z > inner.z0 + 1 && z < inner.z1 - 1 ? 40 : 0);
  // Over its last ~2 km the far ring sinks to well below the lowest point of the road, so its square edge always lies
  // under the horizon, where the backdrop's foot is solid fog: a ridge left standing at the edge cut the painted
  // mountains off on a hard straight line.
  let lowest = Infinity;
  for (let i = 0; i < t.n; i++) lowest = Math.min(lowest, t.y[i]);
  const edgeDrop = (x: number, z: number) => {
    const d = Math.min(x - (inner.x0 - FAR), inner.x1 + FAR - x, z - (inner.z0 - FAR), inner.z1 + FAR - z);
    const k = 1 - THREE.MathUtils.smoothstep(d, 0, 2000);
    return k ? k * Math.max(0, terrainAt(t, x, z) - (lowest - 300)) : 0;
  };
  if (!skyRoad) terrainChunk(inner.x0 - FAR, inner.z0 - FAR, inner.x1 + FAR, inner.z1 + FAR, 70, (x, z) => insideInner(x, z) + edgeDrop(x, z), true);

  // --- Road ribbon (chunks of ~200 m)
  // At night the road is damp: the same textures, glossier, so the lamps and headlights streak on it.
  const roadTex = asphalt(t.def.theme, t.def.seed, aniso, !!t.lap, t.def.lanes ?? (t.def.traffic === 'highway' ? 4 : 0), look.tar);
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
      // A sky road is only the road and its lip, out to the deck's edge.
      const cross = skyRoad ? SKY_CROSS.map((k) => k * t.rail) : [-(railOf(t, i, -1) + 1.2), -(t.rail + 1.2), -(t.half + t.shoulder), -t.half, t.half, t.half + t.shoulder, t.rail + 1.2, railOf(t, i, 1) + 1.2];
      const us = skyRoad ? SKY_CROSS_U : crossU;
      for (let k = 0; k < cross.length; k++) {
        const d = skyRoad ? cross[k] * (k === 1 || k === 2 ? t.half / t.rail : 1) : cross[k];
        const x = t.x[i] - t.tz[i] * d;
        const z = t.z[i] + t.tx[i] * d;
        const y = skyRoad || Math.abs(d) <= railOf(t, i, d) + t.edge - t.rail ? t.y[i] - t.bank[i] * d : heightAt(t, x, z);
        pos.push(x, y + 0.03, z);
        uvs.push(us[k], (i * SAMPLE) / ROAD_TILE);
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

  // --- Kerbs on a circuit's bends
  if (t.lap) kerbs(scene, t, keep);

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

  // --- A sky road: the deck under the road, its glowing edges, and the clouds. No rails, chevrons or poles.
  let clouds: THREE.Mesh[] = [];
  if (skyRoad) clouds = skyDeck(scene, t, look, keep);
  else {
    // --- Armco both sides: a galvanised beam on posts.
    const railMat = keep(
      look.whiteRail
        ? new THREE.MeshStandardMaterial({ color: 0xe9ecee, metalness: 0.05, roughness: 0.42, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    );
    // At night the rails glow faintly (as if caught by the headlights), so the edge of the road reads from far off
    // without real lights. Well under the bloom threshold.
    if (look.moon) {
      railMat.emissive.setHex(0x9aa6bc);
      railMat.emissiveIntensity = NIGHT_RAIL;
    }
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
    const postMat = look.whiteRail ? railMat : keep(new THREE.MeshStandardMaterial({ color: 0x8e9399, metalness: 0.7, roughness: 0.5, emissive: 0x9aa6bc, emissiveIntensity: look.moon ? NIGHT_RAIL : 0 }));
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
  }

  // --- Start and finish gantries, with a chequered line across the road at the finish (one line on a circuit).
  if (!t.lap) gantry(scene, t, t.startS, 'START', false, keep);
  gantry(scene, t, t.finishS, 'FINISH', true, keep);
  if (t.def.royale) arena(scene, t, keep);

  // --- Forests and rocks, villages, and the houses, poles, shrines, signs and landmarks outside the barriers
  const forestAt = (x: number, z: number) => fbm(x / 140, z / 140, t.def.seed + 11, 3) + (look.forest ?? (t.def.theme === 'alpine' ? 0.15 : -0.05)) + (t.def.climb ? 0.2 : 0);
  if (!skyRoad) {
    const props = decor(scene, t, keep, { night: !!look.moon, low, forestAt, area: inner });
    if (t.def.theme === 'city') city(scene, t, rng, inner, keep, props.sites);
    else {
      scatter(scene, t, look, rng, inner, keep, low, forestAt, props.sites, lods);
      // The Postcard Cup's towns line their own roads (towns.ts, through decor).
      if (!TOWNS[t.def.id]) village(scene, t, rng, keep, !!look.moon);
    }
    props.build();
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
    sunDir: look.moon ? null : sunDir,
    follow(x, y, z, time) {
      WIND.value = time / 1000;
      lods.update(x, z);
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
      // The cloud sea drifts, its two layers at different speeds.
      clouds.forEach((c, k) => (c.material as THREE.MeshBasicMaterial).map!.offset.set(time * (k ? 1.1e-6 : 0.6e-6), time * (k ? 0.4e-6 : 0.9e-6)));
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

/** A sky road's ribbon across, as shares of `rail`: lip | road | lip (the inner two are scaled to the white lines). */
const SKY_CROSS = [-1, -1, 1, 1];
const SKY_CROSS_U = [0.12, 0.2, 0.8, 0.88];
/**
 * A sky road's dressing: the deck the road is the top of (a slab `depth` deep, tapering underneath), a glowing strip
 * along each edge so you can see where the road ends at speed, and two layers of cloud far below.
 */
export const SKY_DECK = { depth: 1.6, taper: 0.5, glow: 0.22, clouds: [150, 210] };

function skyDeck(scene: THREE.Scene, t: Track, look: Look, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Mesh[] {
  const night = !!look.moon;
  const deckMat = keep(new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide }));
  const glowMat = keep(new THREE.MeshStandardMaterial({ color: 0x0b2a33, emissive: look.edge ?? 0x38e8ff, emissiveIntensity: night ? 6 : 3.2, roughness: 0.4, side: THREE.DoubleSide }));
  const { depth, taper, glow } = SKY_DECK;
  const CHUNK = 100;
  for (let i0 = 0; i0 < t.n - 1; i0 += CHUNK) {
    const i1 = Math.min(t.n - 1, i0 + CHUNK);
    // Across the deck, from the left edge round underneath to the right: the glow strip, the side, the underside.
    const deck: number[] = [];
    const lit: number[] = [];
    const dIdx: number[] = [];
    const gIdx: number[] = [];
    const ring = (i: number) => {
      const w = t.rail;
      const y = (d: number) => t.y[i] - t.bank[i] * d;
      // [offset, drop below the road surface] for each corner of the section, left to right.
      return [
        [-w, 0.03],
        [-w, glow],
        [-(w - taper), depth],
        [w - taper, depth],
        [w, glow],
        [w, 0.03],
      ].map(([d, drop]) => [t.x[i] - t.tz[i] * d, y(d) - drop, t.z[i] + t.tx[i] * d]);
    };
    for (let i = i0; i <= i1; i++) {
      const r = ring(i);
      // The glow strips: corners 0-1 and 4-5. The deck: 1-2, 2-3, 3-4.
      for (const k of [0, 1, 4, 5]) lit.push(...r[k]);
      for (const k of [1, 2, 3, 4]) deck.push(...r[k]);
      if (i < i1) {
        const a = (i - i0) * 4;
        gIdx.push(a, a + 1, a + 4, a + 4, a + 1, a + 5, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
        for (let c = 0; c < 3; c++) dIdx.push(a + c, a + c + 1, a + c + 4, a + c + 4, a + c + 1, a + c + 5);
      }
    }
    for (const [pos, idx, mat] of [[deck, dIdx, deckMat], [lit, gIdx, glowMat]] as const) {
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = mat === deckMat;
      scene.add(m);
    }
  }
  // The cloud sea: a soft tiling noise in two layers, far enough down that it reads as a floor of cloud.
  let low = Infinity;
  for (let i = 0; i < t.n; i++) low = Math.min(low, t.y[i]);
  const tex = keep(cloudTexture(t.def.seed));
  const { x0, x1, z0, z1 } = t.bounds;
  const out: THREE.Mesh[] = [];
  SKY_DECK.clouds.forEach((below, k) => {
    const map = k ? keep(tex.clone()) : tex;
    map.repeat.set(k ? 9 : 6, k ? 9 : 6);
    // Brighter than white: the sky above is ~10 before exposure, and white cloud under it should read as lit.
    const mat = keep(new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: k ? 1 : 0.85 }));
    mat.color.setScalar(night ? 0.35 : k ? 2.3 : 2.7);
    // (Under a coloured moon the cloud sea takes its light: Shura's goes a dark blood red.)
    if (night && look.moonColor !== undefined) mat.color.lerp(new THREE.Color(look.moonColor).multiplyScalar(0.35), 0.45);
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(16000, 16000)), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, low - below, (z0 + z1) / 2);
    m.renderOrder = -1 - k;
    scene.add(m);
    out.push(m);
  });
  return out;
}

/** Soft, tiling cloud tufts: white with the noise as alpha. */
function cloudTexture(seed: number): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  // Periodic noise: sample fbm on a torus so the tile wraps without a seam.
  const R = 1.6;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = (x / N) * Math.PI * 2;
      const b = (y / N) * Math.PI * 2;
      const n = fbm(Math.cos(a) * R + Math.cos(b) * R * 0.6, Math.sin(a) * R + Math.sin(b) * R * 0.6, seed + 17, 5);
      const v = THREE.MathUtils.smoothstep(n, -0.15, 0.45);
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 235 + v * 20;
      img.data[o + 3] = Math.round(v * 255);
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * A battle royale arena's dressing: red torii gates over the road round the lap (their pillars hang down into the
 * void), the beam under each one's top glowing, and a ring of floating lanterns round the whole arena. Every gate
 * goes into one merged mesh per material, so it's three draw calls.
 */
export const ARENA = { gates: 9, lanterns: 64, ring: 140, hang: 26 };

function arena(scene: THREE.Scene, t: Track, keep: <T extends { dispose(): void }>(x: T) => T) {
  const lap = lapView(t);
  const lacquer: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const span = t.rail - 0.2;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, into: THREE.BufferGeometry[], m: THREE.Matrix4) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    g.applyMatrix4(m);
    into.push(g);
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // Evenly round the lap, but not on the start line's gantry or in the tightest bends (the gate would lean off them).
  const len = lap.lap * SAMPLE;
  for (let k = 0; k < ARENA.gates; k++) {
    let s = t.startS + ((k + 0.5) / ARENA.gates) * len;
    for (let tries = 0; tries < 12 && Math.abs(t.curv[Math.round(s / SAMPLE)]) > 1 / 60; tries++) s += 8;
    const c = pointAt(t, s, 0);
    q.setFromAxisAngle(up, Math.atan2(-c.tx, -c.tz));
    m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(1, 1, 1));
    for (const side of [-1, 1]) {
      // Pillars from 7 m up down past the deck into the void, with a black foot ring where they pass the road.
      box(0.7, 7 + ARENA.hang, 0.7, side * span, (7 - ARENA.hang) / 2, 0, lacquer, m);
      box(0.95, 0.5, 0.95, side * span, 0.25, 0, glow, m);
    }
    box(span * 2 + 3.4, 0.55, 0.9, 0, 7.2, 0, lacquer, m); // kasagi (the top beam)
    box(span * 2 + 2.4, 0.18, 0.6, 0, 6.85, 0, glow, m); // its glowing underside
    box(span * 2 + 1, 0.4, 0.5, 0, 5.6, 0, lacquer, m); // nuki (the tie beam)
    box(0.5, 1.2, 0.3, 0, 6.3, 0, lacquer, m); // gakuzuka (the strut between)
  }
  // Lanterns: a slow ring of paper lights hanging round the arena, a little below the road.
  let lo = Infinity;
  for (let i = 0; i < lap.n; i++) lo = Math.min(lo, t.y[i]);
  const { x0, x1, z0, z1 } = t.bounds;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const rx = (x1 - x0) / 2 + ARENA.ring;
  const rz = (z1 - z0) / 2 + ARENA.ring;
  const rng = mulberry(t.def.seed + 5);
  for (let k = 0; k < ARENA.lanterns; k++) {
    const a = (k / ARENA.lanterns) * Math.PI * 2 + rng() * 0.05;
    const r = 0.85 + rng() * 0.3;
    m.makeTranslation(cx + Math.cos(a) * rx * r, lo - 20 + rng() * 40, cz + Math.sin(a) * rz * r);
    box(1.6, 2.2, 1.6, 0, 0, 0, glow, m);
  }
  const lacquerMat = keep(new THREE.MeshStandardMaterial({ color: 0x9c1018, emissive: 0x400408, roughness: 0.45, metalness: 0.1 }));
  const glowMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a0408, emissive: 0xff2a3c, emissiveIntensity: 6, roughness: 0.5 }));
  for (const [parts, mat] of [[lacquer, lacquerMat], [glow, glowMat]] as const) {
    const geo = keep(mergeGeometries(parts)!);
    for (const g of parts) g.dispose();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mat === lacquerMat;
    scene.add(mesh);
  }
}

function gantry(scene: THREE.Scene, t: Track, s: number, text: string, chequer: boolean, keep: <T extends { dispose(): void }>(x: T) => T) {
  const c = pointAt(t, s, 0);
  const yaw = Math.atan2(-c.tx, -c.tz);
  const g = new THREE.Group();
  g.position.set(c.x, c.y, c.z);
  g.rotation.y = yaw;
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.75, roughness: 0.38 }));
  // (On a sky road the posts stand on the lip: past it there's nothing to stand on.)
  const span = t.def.sky ? t.rail - 0.2 : t.rail + 0.8;
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

/**
 * Trees (two species per theme, trees.ts), undergrowth and boulders, instanced per 400 m tile. A hill climb's forest is
 * thicker and closer. Nothing grows on the props' footprints (`sites`, scenery.ts).
 */
function scatter(
  scene: THREE.Scene, t: Track, look: Look, rng: () => number, area: { x0: number; x1: number; z0: number; z1: number }, keep: <T extends { dispose(): void }>(x: T) => T, low: boolean,
  forestAt: (x: number, z: number) => number, sites: Site[], lods: LodTiles,
) {
  const theme = t.def.theme;
  const species = speciesFor(theme);
  // Low draws no shadows; on High each tree's shadow comes from small shadow-only tiles (lod.ts shadowCasters).
  const shadowOnly = low ? null : new ShadowOnly(scene);
  keep(species.a.geo);
  keep(species.b.geo);
  // Past LOD.trees the forest is drawn with stand-ins a third to a fifth the triangles (lod.ts, trees.ts farTree).
  const farA = species.a.noFar ? null : keep(farTree(species.a.geo));
  const farB = species.b.noFar ? null : keep(farTree(species.b.geo));
  const paletteA = species.a.palette?.map((c) => new THREE.Color(c)) ?? null;
  const paletteB = species.b.palette?.map((c) => new THREE.Color(c)) ?? null;
  const rolls = paletteA || paletteB ? 3 : 2;
  const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
  sway(treeMat, theme === 'desert' ? 0.0012 : 0.0026, 1.5);
  const bush = keep(bushGeometry());
  const bushMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  sway(bushMat, 0.03, 0.2);
  const bushCols = BUSH_COLOURS[theme].map((c) => new THREE.Color(c));
  const brng = mulberry(t.def.seed * 131 + 3);
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
  const onSite = (x: number, z: number) => sites.some((p) => Math.abs(p.x - x) < p.r && Math.abs(p.z - z) < p.r && Math.hypot(p.x - x, p.z - z) < p.r);
  /** Which species stands at (x, z): a hash of the spot, so it costs no random rolls. */
  const isB = (x: number, z: number) => {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    // Species grow in groves, not salt-and-pepper.
    return h - Math.floor(h) < species.share * (1 + fbm(x / 60, z / 60, t.def.seed + 29, 2) * 1.6);
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.castShadow = shadow;
    im.receiveShadow = true;
    return im;
  };
  /** A tile's trees go far with a stand-in sharing their instances (`far` null: they stay as they are). */
  const tile = (im: THREE.InstancedMesh, far: THREE.BufferGeometry | null, key: string) => {
    shadowCasters(scene, im, shadowOnly); // before the twin, which copies castShadow
    if (!far) return;
    const [tx, tz] = key.split(':').map(Number);
    const lo = farTwin(im, far);
    scene.add(lo);
    lods.add(im, lo, tx, tz, tx + TILE, tz + TILE, LOD.trees);
  };
  type Bin = Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>;
  const seconds: Bin = new Map();
  const bushBins: Bin = new Map();
  // Per tile, so the frustum culls them like the rest (bigger bins saved a few draw calls but drew far more triangles).
  let tileKey = '';
  const binOf = (bins: Bin, _m: THREE.Matrix4) => {
    const key = tileKey;
    let l = bins.get(key);
    if (!l) bins.set(key, (l = []));
    return l;
  };
  // Low: trees out to 400 m instead of 700, and every other one past the first 60 (the same rolls either way,
  // so the trees that stay are where they'd be on High); no undergrowth.
  let nth = 0;
  for (let tx = area.x0; tx < area.x1; tx += TILE)
    for (let tz = area.z0; tz < area.z1; tz += TILE) {
      tileKey = `${tx}:${tz}`;
      const trees: { m: THREE.Matrix4; b: boolean }[] = [];
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
          if (onSite(px, pz)) continue;
          const forest = forestAt(px, pz);
          const h = heightAt(t, px, pz);
          if (t.def.water !== undefined && h < t.def.water + 2.5) continue;
          const slope = Math.abs(heightAt(t, px + 2, pz) - h) + Math.abs(heightAt(t, px, pz + 2) - h);
          // Thick by the road, thinning with distance (fog hides the rest).
          if (forest > 0.08 && rng() < 0.7 - Math.min(0.45, rd / 1400) && slope < 3.2 && h < look.treeline + rng() * 30 && rd < 700) {
            const sc = 0.75 + rng() * 0.7;
            q.setFromAxisAngle(up, rng() * Math.PI * 2);
            trees.push({ m: new THREE.Matrix4().compose(v.set(px, h - 0.2, pz), q, s.set(sc, sc * (0.85 + rng() * 0.4), sc)), b: isB(px, pz) });
            if (low && !(rd < 400 && (rd < 60 || ++nth % 2 === 0))) cut.add(trees.length - 1);
          } else if (rng() < 0.02 + (slope > 2.5 ? 0.06 : 0) + (climb && rd < 60 ? 0.12 : 0)) {
            const sc = 0.5 + rng() * 2.2;
            q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
            rocks.push(new THREE.Matrix4().compose(v.set(px, h - sc * 0.3, pz), q, s.set(sc, sc * 0.7, sc)));
          }
        }
      // Trees: one instanced mesh per species and tile (the second species and the bushes are built after the loop).
      const mains: { m: THREE.Matrix4; c: THREE.Color }[] = [];
      trees.forEach((tr, i) => {
        // Keep the rolls in step: each tree's colour takes two (three where a species has a palette).
        const pal = tr.b ? paletteB : paletteA;
        const pick = rolls === 3 ? rng() : 0;
        const base = pal ? pal[Math.floor(pick * pal.length)] : jitter.setRGB(1, 1, 1);
        jitter.copy(base).offsetHSL((rng() - 0.5) * 0.04, 0, 0).multiplyScalar(0.8 + rng() * 0.35);
        if (cut.has(i)) return;
        (tr.b ? binOf(seconds, tr.m) : mains).push({ m: tr.m, c: jitter.clone() });
      });
      if (mains.length) {
        const im = instanced(species.a.geo, treeMat, mains.length, true);
        mains.forEach((e, i) => (im.setMatrixAt(i, e.m), im.setColorAt(i, e.c)));
        im.computeBoundingSphere();
        scene.add(im);
        tile(im, farA, tileKey);
      }
      if (rocks.length) {
        const im = instanced(rock, rockMat, rocks.length, true);
        rocks.forEach((m, i) => im.setMatrixAt(i, m));
        im.computeBoundingSphere();
        scene.add(im);
        shadowCasters(scene, im, shadowOnly);
      }
      // Undergrowth along the road: bushes thick by the barrier and at the forest's edge, thinning away from it.
      // Low: no undergrowth (a draw call per tile it can do without).
      if (low) continue;
      const reach = 110;
      const cx = tx + TILE / 2;
      const cz = tz + TILE / 2;
      if (roadDistance(t, cx, cz) > TILE * 0.72 + reach) continue;
      for (let x = tx; x < tx + TILE; x += 7)
        for (let z = tz; z < tz + TILE; z += 7) {
          const px = x + brng() * 7;
          const pz = z + brng() * 7;
          const roll = brng();
          const rd = roadDistance(t, px, pz);
          if (rd > reach || rd < t.edge + 2) continue;
          const dens = (0.3 * (1 - rd / reach) ** 1.5 + (forestAt(px, pz) > 0.02 ? 0.08 : 0.02)) * (theme === 'desert' ? 0.6 : 1);
          if (roll > dens) continue;
          if (rd < t.edgeMax + 3 && Math.abs(locate(t, px, pz, -1, here).d) < railOf(t, here.i, here.d) + 1.8) continue;
          if (onSite(px, pz)) continue;
          const h = heightAt(t, px, pz);
          if (t.def.water !== undefined && h < t.def.water + 1.5) continue;
          if (h > look.treeline + 40) continue;
          const sc = 0.55 + brng() * 0.9;
          q.setFromAxisAngle(up, brng() * Math.PI * 2);
          const m = new THREE.Matrix4().compose(v.set(px, h - 0.15, pz), q, s.set(sc * (0.9 + brng() * 0.5), sc * (0.7 + brng() * 0.5), sc));
          const accent = brng() < 0.15;
          const base = bushCols[accent ? Math.floor(brng() * bushCols.length) : Math.floor(brng() * Math.min(3, bushCols.length))];
          binOf(bushBins, m).push({ m, c: base.clone().multiplyScalar(0.85 + brng() * 0.3) });
        }
    }
  for (const [bins, geo, mat, shadow] of [
    [seconds, species.b.geo, treeMat, true],
    [bushBins, bush, bushMat, false],
  ] as const)
    for (const [key, list] of bins) {
      const im = instanced(geo, mat, list.length, shadow);
      list.forEach((e, i) => (im.setMatrixAt(i, e.m), im.setColorAt(i, e.c)));
      im.computeBoundingSphere();
      scene.add(im);
      if (bins === seconds) tile(im, farB, key);
      else {
        // Undergrowth is a metre high: past LOD.bushes it's a pixel or two, so it isn't drawn at all.
        const [tx, tz] = key.split(':').map(Number);
        lods.add(im, null, tx, tz, tx + TILE, tz + TILE, LOD.bushes);
      }
    }
}

/** Downtown: a tower on every block (tallest near the start), lit offices, neon signs over the street, street lamps, red beacons on top. */
function city(scene: THREE.Scene, t: Track, rng: () => number, area: { x0: number; x1: number; z0: number; z1: number }, keep: <T extends { dispose(): void }>(x: T) => T, sites: Site[] = []) {
  const fac = towerFacade(t.def.seed);
  keep(fac.map);
  keep(fac.glow);
  const wallMat = keep(facadeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.45, envMapIntensity: 1.3 }), fac));
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: 0x4a4b50, map: keep(roofDeck(t.def.seed)), roughness: 0.9 }));
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
      const wall = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[], fac: [] as number[] };
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
          // Keep off what scenery.ts put there (a circuit's pits, its big wheel).
          if (sites.some((o) => Math.hypot(o.x - cx, o.z - cz) < o.r + Math.max(w, d) / 2)) continue;
          let floor = Infinity;
          for (const [px, pz] of pts) floor = Math.min(floor, heightAt(t, px, pz));
          // (A street circuit keeps its waterfront open: no towers on the low ground by the sea.)
          if (t.def.water !== undefined && floor < t.def.water + (t.lap ? 6 : 1)) continue;
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
          // Its wall style from where it stands (not the rng: everything placed after it stays put).
          const style = Math.abs(Math.floor(cx * 7.13 + cz * 3.71)) % FAC_STYLES;
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
            pushFac(wall.fac, 6, style, floor, y1);
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
        g.setAttribute('fac', new THREE.Float32BufferAttribute(wall.fac, 3));
        const m = new THREE.Mesh(g, wallMat);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
        const rg = keep(new THREE.BufferGeometry());
        rg.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
        rg.setAttribute('uv', new THREE.BufferAttribute(roofUv(roof), 2));
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
    // Houses take the first wall style (plaster, shoji on the passes) or the third (timber, or tiles and shutters), no shops.
    const fac: number[] = [];
    pushFac(fac, uv.count, Math.round(w * 13) % 2 ? 0 : 2, NO_SHOPS, h / 2 + 100);
    geo.setAttribute('fac', new THREE.Float32BufferAttribute(fac, 3));
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
      const wallMat = keep(facadeMaterial(new THREE.MeshStandardMaterial({ color: walls[Math.floor(rng() * walls.length)], emissive: 0xffffff, emissiveIntensity: night ? 2.2 : 0, roughness: 0.3 }), fac));
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
/**
 * The sky (and the environment map baked from it), the sun (or moon) light with its shadow, the fill light, fog, stars
 * at night and the painted backdrop: everything round a scene that comes from its Look. Shared by the race tracks and
 * the open world (worldview.ts).
 */
export function atmosphere(scene: THREE.Scene, look: Look, renderer: THREE.WebGLRenderer, low: boolean, keep: <T extends { dispose(): void }>(x: T) => T) {
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
      // 3.5, not brighter: with the clear coat's own reflection strength honoured (envlevel.ts), brighter lamps here
      // put bloom-hot glare on every roof and truck box at night.
      envMesh(new THREE.PlaneGeometry(120, 18), new THREE.Color(3.5, 2.45, 1.4), new THREE.Vector3(Math.cos(a) * 300, 300, Math.sin(a) * 300));
    }
  }
  const env = keep(pmrem.fromScene(envScene, 0.02)).texture;
  for (const d of envKeep) d.dispose();
  scene.environment = env;
  envLevel(scene, 0.55);
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
  if (look.moon) scene.add(stars(lightDir, keep, look));
  scene.add(backdrop(look.backdrop, keep));
  return { sky, envSky, sun, sunDir, lightDir };
}

const BACKDROP = { top: 0.26, bottom: -0.06, r: 6000 };

/**
 * Distant scenery: a painted 360° strip on an open cylinder that rides with the camera, so it sits at the
 * horizon like the sky does. It's one draw call, drawn after the terrain (transparent, no depth write), so
 * every real hill in front hides it and only the gaps between show it; it costs no more than the sky
 * behind it. The image (~100-200 kB WebP) loads after the race starts; until then the map is a clear
 * placeholder, so the shader is compiled with the track and nothing recompiles when the picture arrives.
 */
export function backdrop(image: string, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Mesh {
  const { top, bottom, r } = BACKDROP;
  const blank = keep(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  blank.colorSpace = THREE.SRGBColorSpace;
  blank.needsUpdate = true;
  const mat = keep(new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
  // Drawn at the far plane: the cylinder is 6 km out, but the far terrain reaches further than that in places, and a
  // ridge behind the cylinder was painted over by the strip's haze band, leaving a hard straight line across it.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n  gl_Position.z = gl_Position.w;');
  };
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
function stars(moonDir: THREE.Vector3, keep: <T extends { dispose(): void }>(x: T) => T, look: Look): THREE.Group {
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
  const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(220 * (look.moonSize ?? 1), 24, 16)), keep(new THREE.MeshBasicMaterial({ color: look.moonColor ?? 0xf4f1e2, fog: false })));
  moon.position.copy(moonDir).multiplyScalar(8500);
  g.add(moon);
  return g;
}

// --- Procedural geometry and textures --------------------------------------------------------

export function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const s = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export function noiseNormal(size: number) {
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

/**
 * Red-and-white kerbs over the shoulder on a circuit's bends, both sides, a little proud of the road (drawn only:
 * the physics' road is the plane under them). One mesh for the lap.
 */
function kerbs(scene: THREE.Scene, t: Track, keep: <T extends { dispose(): void }>(x: T) => T) {
  const on = new Uint8Array(t.n);
  for (let i = 0; i < t.n; i++) if (Math.abs(t.curv[i]) > 1 / 230) for (let j = Math.max(0, i - 7); j <= Math.min(t.n - 1, i + 7); j++) on[j] = 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Across: from just inside the white line out over the shoulder; the middle stands proud.
  const across = [[t.half - 0.15, 0.02, 0], [t.half + 0.5, 0.075, 0.5], [t.half + 1.15, 0.04, 1]];
  for (const side of [-1, 1])
    for (let i = 0; i < t.n; i++) {
      if (!on[i] || (i > 0 && on[i - 1])) continue;
      let i1 = i;
      while (i1 + 1 < t.n && on[i1 + 1]) i1++;
      if (i1 - i < 3) continue;
      const base = pos.length / 3;
      for (let k = i; k <= i1; k++) {
        // Ends taper into the road over a few metres.
        const fade = Math.min(1, (k - i) / 3, (i1 - k) / 3);
        for (const [d0, lift] of across) {
          const d = side * d0;
          pos.push(t.x[k] - t.tz[k] * d, t.y[k] - t.bank[k] * d + 0.03 + lift * fade, t.z[k] + t.tx[k] * d);
        }
        for (const [, , u] of across) uv.push(u, (k * SAMPLE) / 2);
        if (k < i1) {
          const a = base + (k - i) * 3;
          for (let c = 0; c < 2; c++) {
            if (side > 0) idx.push(a + c, a + c + 1, a + c + 3, a + c + 1, a + c + 4, a + c + 3);
            else idx.push(a + c, a + c + 3, a + c + 1, a + c + 1, a + c + 3, a + c + 4);
          }
        }
      }
    }
  if (!idx.length) return;
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8231c';
  g.fillRect(0, 0, 8, 32);
  g.fillStyle = '#ece9e2';
  g.fillRect(0, 32, 8, 32);
  const tex = keep(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  m.receiveShadow = true;
  scene.add(m);
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
