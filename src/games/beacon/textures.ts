// Procedural PBR textures (no image files): for each material a height field from tileable noise, turned into an
// albedo, a normal map and a roughness map. They are sampled triplanar in world space (see `triplanar`), so boxes and
// the displaced rock need no UVs and every texel is the same size in metres.

import * as THREE from 'three';
import type { Mat } from './move.ts';

// ---------------------------------------------------------------------------------------------
// Tileable noise

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that wraps every `period` cells (so the texture tiles). */
function vnoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal noise in 0..1 over a unit square tile; `base` lattice cells across at the first octave. */
export function fbm(u: number, v: number, base: number, octaves: number, seed: number, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = base;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u * f, v * f, f, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Tileable cellular (Worley) noise: distances to the nearest two feature points and the nearest one's id. */
export function worley(u: number, v: number, cells: number, seed: number) {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  let cx = 0;
  let cy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = (((xi + i) % cells) + cells) % cells;
      const gy = (((yi + j) % cells) + cells) % cells;
      const px = xi + i + hash(gx, gy, seed);
      const py = yi + j + hash(gx, gy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(gx, gy, seed + 2);
        cx = px - x;
        cy = py - y;
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id, cx, cy };
}

// ---------------------------------------------------------------------------------------------
// Material recipes

interface Recipe {
  /** Metres one tile covers. */
  size: number;
  /** Height (0..1), albedo (linear-ish sRGB 0..1), roughness (0..1) for texel (u, v). */
  texel(u: number, v: number): { h: number; c: [number, number, number]; r: number };
  normal: number;
  metal: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Bricks/blocks: returns mortar mask (1 in the joint), the block's id noise, and the distance to its edge. */
function blocks(u: number, v: number, cols: number, rows: number, joint: number) {
  const y = v * rows;
  const row = Math.floor(y);
  const x = u * cols + (row % 2) * 0.5;
  const col = Math.floor(x);
  const fx = x - col;
  const fy = y - row;
  const e = Math.min(fx, 1 - fx, (fy * cols) / rows, ((1 - fy) * cols) / rows);
  return { mortar: 1 - smooth(joint * 0.5, joint, e), id: hash(((col % cols) + cols) % cols, row, 9), edge: e };
}

const RECIPES: Record<Mat, Recipe> = {
  rock: {
    size: 6,
    normal: 2.0,
    metal: 0,
    texel(u, v) {
      // Weathered rock: broad tonal patches and bedding, a sparse network of angular joints (Worley edges, only
      // where a mask lets them through), fine grain, pale lichen crusts.
      const big = worley(u, v, 4, 1);
      const small = worley(u, v, 13, 7);
      const mask = smooth(0.42, 0.58, fbm(u, v, 3, 3, 21));
      const crack = (1 - smooth(0.0, 0.035, big.f2 - big.f1)) * mask;
      const crack2 = (1 - smooth(0.0, 0.03, small.f2 - small.f1)) * smooth(0.55, 0.7, fbm(u, v, 4, 3, 22));
      const facet = (big.cx * (big.id - 0.5) + big.cy * (0.5 - big.id)) * 0.25;
      const grain = fbm(u, v, 40, 3, 3);
      const patches = fbm(u, v, 6, 4, 23);
      const strata = Math.sin((v * 9 + fbm(u, v, 3, 3, 8) * 3) * Math.PI * 2) * 0.5 + 0.5;
      const h = clamp01(0.45 + patches * 0.3 + facet + grain * 0.2 + strata * 0.08 - crack * 0.4 - crack2 * 0.18);
      let c: [number, number, number] = mixc([0.22, 0.21, 0.2], [0.47, 0.44, 0.4], patches * 0.7 + grain * 0.3);
      c = mixc(c, [0.4, 0.34, 0.27], strata * smooth(0.4, 0.7, fbm(u, v, 2, 2, 24)) * 0.35);
      const lichen = smooth(0.74, 0.8, fbm(u, v, 34, 3, 4)) * smooth(0.5, 0.62, fbm(u, v, 3, 3, 6));
      c = mixc(c, mixc([0.56, 0.54, 0.45], [0.68, 0.64, 0.52], grain), lichen * 0.55);
      c = mixc(c, [0.08, 0.075, 0.07], Math.max(crack, crack2 * 0.6) * 0.7);
      return { h, c, r: mix(0.97, 0.82, grain * (1 - lichen)) };
    },
  },
  stone: {
    size: 3,
    normal: 1.6,
    metal: 0,
    texel(u, v) {
      const b = blocks(u, v, 4, 6, 0.05);
      const n = fbm(u, v, 20, 4, 11);
      const w = worley(u, v, 22, 12);
      // Chipped arrises: near a block's edge, cells bite out of the face.
      const chip = (1 - smooth(0.02, 0.09, b.edge)) * smooth(0.25, 0.45, w.f1);
      const dimple = (w.f1 - 0.35) * 0.12;
      const h = clamp01((1 - b.mortar) * (0.72 + n * 0.2 + dimple) - chip * 0.35);
      let c: [number, number, number] = mixc([0.33, 0.31, 0.28], [0.5, 0.47, 0.42], b.id * 0.55 + n * 0.45);
      c = mixc(c, [0.2, 0.19, 0.17], Math.max(b.mortar, chip * 0.6));
      // Damp and grime collecting low on each block, a little moss in the joints.
      c = mixc(c, [0.24, 0.24, 0.2], smooth(0.55, 0.8, fbm(u, v, 5, 4, 13)) * 0.45);
      c = mixc(c, [0.22, 0.25, 0.16], b.mortar * smooth(0.5, 0.7, fbm(u, v, 9, 3, 14)) * 0.5);
      return { h, c, r: mix(0.88, 0.97, b.mortar) };
    },
  },
  brick: {
    size: 2,
    normal: 1.5,
    metal: 0,
    texel(u, v) {
      const b = blocks(u, v, 6, 16, 0.08);
      const n = fbm(u, v, 24, 3, 21);
      const h = clamp01((1 - b.mortar) * (0.75 + n * 0.25));
      let c: [number, number, number] = mixc([0.38, 0.16, 0.11], [0.56, 0.27, 0.18], b.id * 0.7 + n * 0.3);
      c = mixc(c, [0.55, 0.52, 0.47], b.mortar);
      c = mixc(c, [0.2, 0.18, 0.16], smooth(0.62, 0.8, fbm(u, v, 4, 4, 22)) * 0.5);
      return { h, c, r: 0.92 };
    },
  },
  wood: {
    size: 2.4,
    normal: 0.8,
    metal: 0,
    texel(u, v) {
      const planks = 8;
      const p = v * planks;
      const row = Math.floor(p);
      const fy = p - row;
      const seam = 1 - smooth(0.02, 0.07, Math.min(fy, 1 - fy));
      const fu = (u * 2 + hash(row, 0, 31)) % 1;
      const endSeam = 1 - smooth(0.004, 0.014, Math.min(fu, 1 - fu));
      const grain = fbm(u * 0.25, v * 3, 8, 4, 32 + row);
      const streak = Math.sin((v * planks * 6 + grain * 6) * Math.PI) * 0.5 + 0.5;
      const h = clamp01(0.75 - seam * 0.7 - endSeam * 0.4 + streak * 0.12 + grain * 0.1);
      const tone = hash(row, 1, 33);
      let c: [number, number, number] = mixc([0.3, 0.27, 0.23], [0.5, 0.46, 0.4], tone * 0.6 + streak * 0.25 + grain * 0.15);
      c = mixc(c, [0.12, 0.11, 0.1], Math.max(seam, endSeam));
      return { h, c, r: mix(0.75, 0.92, grain) };
    },
  },
  steel: {
    size: 3,
    normal: 1.0,
    metal: 0.45,
    texel(u, v) {
      // Rust runs down from seams and rivets in streaks rather than sitting in blobs.
      const rust = smooth(0.45, 0.68, fbm(u, v * 0.35, 9, 5, 41) * 0.75 + fbm(u, v, 24, 3, 43) * 0.25);
      const pit = fbm(u, v, 48, 2, 42);
      const plate = blocks(u, v, 2, 2, 0.012);
      const rivet = (() => {
        const ru = (u * 16) % 1;
        const rv = (v * 2) % 1;
        const d = Math.hypot(ru - 0.5, Math.min(rv, 1 - rv) * 8 - 0.12);
        return 1 - smooth(0.08, 0.16, d);
      })();
      const h = clamp01(0.6 - plate.mortar * 0.4 + rivet * 0.3 - rust * pit * 0.25);
      let c: [number, number, number] = mixc([0.12, 0.17, 0.16], [0.18, 0.23, 0.21], pit);
      c = mixc(c, mixc([0.2, 0.1, 0.05], [0.38, 0.2, 0.1], pit), rust * 0.85);
      return { h, c, r: mix(0.45, 0.9, rust) };
    },
  },
  concrete: {
    size: 4,
    normal: 0.9,
    metal: 0,
    texel(u, v) {
      const n = fbm(u, v, 8, 5, 51);
      // Small air holes, sparse and shallow (bigger ones read as leopard spots).
      const pores = smooth(0.74, 0.8, fbm(u, v, 128, 2, 52));
      const form = 1 - smooth(0.004, 0.01, Math.min((v * 3) % 1, 1 - ((v * 3) % 1)));
      const stain = smooth(0.4, 0.9, fbm(u * 0.5, v * 2, 6, 4, 53)) * smooth(0.2, 1, 1 - v);
      const h = clamp01(0.7 + n * 0.2 - pores * 0.15 - form * 0.3);
      let c: [number, number, number] = mixc([0.42, 0.42, 0.4], [0.58, 0.57, 0.54], n);
      c = mixc(c, [0.27, 0.26, 0.22], stain * 0.6);
      c = mixc(c, [0.26, 0.26, 0.25], pores * 0.35);
      return { h, c, r: 0.93 };
    },
  },
  plaster: {
    size: 3,
    normal: 1.1,
    metal: 0,
    texel(u, v) {
      const n = fbm(u, v, 8, 5, 61);
      const chip = smooth(0.66, 0.69, fbm(u, v, 5, 5, 62));
      const b = blocks(u, v, 6, 16, 0.08);
      const streak = smooth(0.5, 0.95, fbm(u * 3, v * 0.3, 6, 3, 63));
      const h = chip > 0.5 ? (1 - b.mortar) * 0.4 : 0.8 + n * 0.15;
      let c: [number, number, number] = mixc([0.78, 0.76, 0.71], [0.9, 0.89, 0.85], n);
      c = mixc(c, [0.55, 0.5, 0.42], streak * 0.35);
      c = mixc(c, mixc([0.45, 0.22, 0.15], [0.5, 0.48, 0.44], b.mortar), chip);
      return { h, c, r: 0.9 };
    },
  },
  moss: {
    size: 3,
    normal: 1.2,
    metal: 0,
    texel(u, v) {
      const n = fbm(u, v, 12, 5, 71);
      return { h: n, c: mixc([0.12, 0.16, 0.06], [0.3, 0.36, 0.14], n), r: 0.98 };
    },
  },
};

export interface MatTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  size: number;
  normal: number;
  metal: number;
}

const cache = new Map<string, MatTextures>();

/** The three maps for a material at `res` pixels square (cached; shared by every mesh). */
export function textures(mat: Mat, res: number): MatTextures {
  const k = `${mat}@${res}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const rec = RECIPES[mat];
  const n = res;
  const hgt = new Float32Array(n * n);
  const alb = new Uint8ClampedArray(n * n * 4);
  const rgh = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const t = rec.texel(x / n, y / n);
      const i = y * n + x;
      hgt[i] = t.h;
      alb[i * 4] = t.c[0] * 255;
      alb[i * 4 + 1] = t.c[1] * 255;
      alb[i * 4 + 2] = t.c[2] * 255;
      alb[i * 4 + 3] = 255;
      rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = t.r * 255;
      rgh[i * 4 + 3] = 255;
    }
  const nrm = new Uint8ClampedArray(n * n * 4);
  const s = (rec.normal * n) / 256;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const at = (xx: number, yy: number) => hgt[((yy + n) % n) * n + ((xx + n) % n)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * s;
      const dy = (at(x, y + 1) - at(x, y - 1)) * s;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      nrm[i] = (-dx / l) * 127.5 + 127.5;
      nrm[i + 1] = (dy / l) * 127.5 + 127.5;
      nrm[i + 2] = (1 / l) * 127.5 + 127.5;
      nrm[i + 3] = 255;
    }
  const tex = (data: Uint8ClampedArray, srgb: boolean) => {
    const t = new THREE.DataTexture(new Uint8Array(data.buffer), n, n, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const out: MatTextures = { map: tex(alb, true), normalMap: tex(nrm, false), roughnessMap: tex(rgh, false), size: rec.size, normal: rec.normal, metal: rec.metal };
  cache.set(k, out);
  return out;
}

export function disposeTextures() {
  for (const t of cache.values()) {
    t.map.dispose();
    t.normalMap.dispose();
    t.roughnessMap.dispose();
  }
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Triplanar mapping for MeshStandardMaterial

/**
 * Makes a standard material sample its map, normal map and roughness map in world space from the three axis
 * planes, blended by the surface normal. Every mesh using it needs no UVs; texels are `size` metres per tile.
 */
export function triplanar(m: THREE.MeshStandardMaterial, size: number, macro = 0) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tpScale = { value: 1 / size };
    sh.uniforms.tpMacro = { value: macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTpNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTpPos;
varying vec3 vTpNrm;
uniform float tpScale;
uniform float tpMacro;
vec3 tpW() { vec3 b = pow(abs(normalize(vTpNrm)), vec3(6.0)); return b / (b.x + b.y + b.z); }
vec4 tpAt(sampler2D t, float s) {
  vec3 b = tpW();
  vec3 p = vTpPos * s;
  return texture2D(t, p.zy) * b.x + texture2D(t, p.xz) * b.y + texture2D(t, p.xy) * b.z;
}
vec4 tp(sampler2D t) { return tpAt(t, tpScale); }`,
      )
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 tpc = tp(map);\n if (tpMacro > 0.0) tpc.rgb *= mix(vec3(1.0), tpAt(map, tpScale * 0.137).rgb * 2.2, tpMacro);\n diffuseColor *= tpc;\n#endif')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n roughnessFactor *= tp(roughnessMap).g;\n#endif')
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
{
  vec3 wn = normalize(vTpNrm);
  vec3 b = tpW();
  vec3 p = vTpPos * tpScale;
  vec3 tx = texture2D(normalMap, p.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(normalMap, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(normalMap, p.xy).xyz * 2.0 - 1.0;
  tx.xy *= normalScale; ty.xy *= normalScale; tz.xy *= normalScale;
  tx = vec3(tx.xy + wn.zy, abs(tx.z) * wn.x);
  ty = vec3(ty.xy + wn.xz, abs(ty.z) * wn.y);
  tz = vec3(tz.xy + wn.xy, abs(tz.z) * wn.z);
  vec3 w = normalize(tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z);
  normal = normalize((viewMatrix * vec4(w, 0.0)).xyz);
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => `tp${size}-${macro}`;
}

/** A triplanar standard material for `mat`. `res` 512 on High, 256 on Low. */
export function material(mat: Mat, res: number, opts: { vertexColors?: boolean; macro?: number } = {}): THREE.MeshStandardMaterial {
  const t = textures(mat, res);
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    roughness: 1,
    metalness: t.metal,
    normalScale: new THREE.Vector2(t.normal * 0.5, t.normal * 0.5),
    vertexColors: !!opts.vertexColors,
  });
  triplanar(m, t.size, opts.macro ?? 0);
  return m;
}
