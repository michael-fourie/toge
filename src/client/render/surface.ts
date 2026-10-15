// Physically based surfaces. `pbr()` is the one material factory for lit things in the world, on players and on guns:
// a MeshStandardMaterial whose base-colour map brings its own normal, roughness and ambient-occlusion maps.
// Those come from `bake()` (realistic textures generated per pixel from a height field) or, for the older canvas-painted
// textures, are derived from the painting's luminance the first time a material uses it.

import * as THREE from 'three';

/** One texel of a baked surface. Colour is sRGB 0..1; height, roughness, ao and metal are 0..1. */
export interface Texel {
  r: number;
  g: number;
  b: number;
  h: number;
  rough: number;
  ao: number;
  metal: number;
}

interface Companions {
  normalMap: THREE.Texture;
  /** R = ambient occlusion, G = roughness, B = metalness (glTF's packing). */
  orm: THREE.Texture;
  metal: boolean;
}

const ANISOTROPY = 8;

function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean, wrap: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISOTROPY;
  t.needsUpdate = true;
  return t;
}

/** Tangent-space normals from a height grid (row 0 = v 0). `strength` is how many texels one unit of height rises. */
function normalsFrom(height: Float32Array, w: number, h: number, strength: number, wrap: boolean): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => {
    if (wrap) return height[((y + h) % h) * w + ((x + w) % w)];
    return height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel: smoother than a plain central difference, so baked noise doesn't sparkle.
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = (-dx / 8) * strength;
      let ny = (-dy / 8) * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

export interface BakeOptions {
  /** Normal strength: texels of rise per unit of height. */
  normal?: number;
  /** Tile seamlessly (default) or clamp at the edges. */
  wrap?: boolean;
  /** Pixels across; textures are square. */
  size?: number;
}

const bakedCache = new Map<string, THREE.Texture>();

/**
 * Bakes a surface: `fn(u, v, out)` fills in one texel (u, v in [0, 1), v up). Returns the base-colour texture with its
 * normal and ORM maps attached; `pbr({ map })` picks them up. Cached by `key`, so a map's textures are built once
 * per session even if you play it again.
 */
export function bake(key: string, fn: (u: number, v: number, t: Texel) => void, opts: BakeOptions = {}): THREE.Texture {
  const hit = bakedCache.get(key);
  if (hit) return hit;
  const S = opts.size ?? 512;
  const wrap = opts.wrap ?? true;
  const col = new Uint8Array(S * S * 4);
  const orm = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  const t: Texel = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, ao: 1, metal: 0 };
  let metal = false;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      t.h = 0;
      t.rough = 0.8;
      t.ao = 1;
      t.metal = 0;
      fn((x + 0.5) / S, (y + 0.5) / S, t);
      const p = y * S + x;
      const i = p * 4;
      col[i] = Math.max(0, Math.min(255, t.r * 255));
      col[i + 1] = Math.max(0, Math.min(255, t.g * 255));
      col[i + 2] = Math.max(0, Math.min(255, t.b * 255));
      col[i + 3] = 255;
      height[p] = t.h;
      orm[i] = t.ao * 255;
      orm[i + 1] = t.rough * 255;
      orm[i + 2] = t.metal * 255;
      orm[i + 3] = 255;
      if (t.metal > 0) metal = true;
    }
  }
  const map = dataTexture(col, S, S, true, wrap);
  const companions: Companions = {
    normalMap: dataTexture(normalsFrom(height, S, S, opts.normal ?? 6, wrap), S, S, false, wrap),
    orm: dataTexture(orm, S, S, false, wrap),
    metal,
  };
  map.userData.pbr = companions;
  bakedCache.set(key, map);
  return map;
}

/** Derives normal + roughness + cavity maps from a painted canvas texture (luminance read as height). */
function derive(tex: THREE.Texture): Companions | null {
  const img = tex.image as HTMLCanvasElement | undefined;
  if (!(img instanceof HTMLCanvasElement)) return null;
  const w = img.width;
  const h = img.height;
  const px = img.getContext('2d')!.getImageData(0, 0, w, h).data;
  const wrap = tex.wrapS === THREE.RepeatWrapping;
  const height = new Float32Array(w * h);
  // Canvas row 0 is the top (v = 1) and CanvasTexture flips it; our data textures don't flip, so read rows bottom-up.
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const i = (src + x) * 4;
      height[y * w + x] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    }
  }
  // Cavity: how far each texel sits below its neighbourhood (a cheap blur). Darker, rougher crevices.
  const orm = new Uint8Array(w * h * 4);
  const R = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) {
        const xx = wrap ? (x + k + w) % w : Math.min(w - 1, Math.max(0, x + k));
        const yy = wrap ? (y + k + h) % h : Math.min(h - 1, Math.max(0, y + k));
        sum += height[y * w + xx] + height[yy * w + x];
      }
      const local = sum / (4 * R + 2);
      const hv = height[y * w + x];
      const cavity = Math.max(0, local - hv);
      const i = (y * w + x) * 4;
      orm[i] = (1 - Math.min(0.6, cavity * 4)) * 255;
      orm[i + 1] = Math.min(1, 0.72 + cavity * 2 + (1 - hv) * 0.18) * 255;
      orm[i + 2] = 0;
      orm[i + 3] = 255;
    }
  }
  return {
    normalMap: dataTexture(normalsFrom(height, w, h, 2.5, wrap), w, h, false, wrap),
    orm: dataTexture(orm, w, h, false, wrap),
    metal: false,
  };
}

function companionsOf(map: THREE.Texture): Companions | null {
  const ud = map.userData as { pbr?: Companions | null };
  if (ud.pbr === undefined) ud.pbr = derive(map);
  if (ud.pbr) {
    // Follow the base map's tiling, even when it is changed later.
    for (const t of [ud.pbr.normalMap, ud.pbr.orm]) {
      t.repeat = map.repeat;
      t.offset = map.offset;
      t.wrapS = map.wrapS;
      t.wrapT = map.wrapT;
    }
  }
  return ud.pbr;
}

/** A differently tiled copy of a surface (a baked map is shared and cached, so never set `repeat` on it directly). */
export function tiled(map: THREE.Texture, x: number, y: number): THREE.Texture {
  const c = companionsOf(map);
  const t = map.clone();
  t.repeat.set(x, y);
  t.userData.pbr = c ? { normalMap: c.normalMap.clone(), orm: c.orm.clone(), metal: c.metal } : null;
  return t;
}

export type SurfaceParams = THREE.MeshStandardMaterialParameters;

/** A physically based material. Defaults to a rough dielectric (most of the world: stone, earth, wood, cloth). */
export function pbr(params: SurfaceParams = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
  const c = params.map ? companionsOf(params.map) : null;
  if (c) {
    if (!params.normalMap) m.normalMap = c.normalMap;
    if (!params.roughnessMap) {
      m.roughnessMap = c.orm;
      if (params.roughness === undefined) m.roughness = 1; // the map carries the roughness
    }
    if (!params.aoMap) {
      m.aoMap = c.orm;
      m.aoMapIntensity = 0.8;
    }
    if (c.metal && !params.metalnessMap) {
      m.metalnessMap = c.orm;
      if (params.metalness === undefined) m.metalness = 1;
    }
  }
  return m;
}
