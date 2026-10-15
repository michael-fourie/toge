import * as THREE from 'three';
import { type Cell, clamp01, fbm, lerp, noise, ridged, smooth, worley } from './render/noise.ts';
import { type Texel, bake } from './render/surface.ts';

// Procedural textures, no image assets. The sky-island surfaces (grass, soil, rock, stone walls, timber, bark, surf
// stone) are baked per texel from tileable noise with real height, roughness and occlusion (render/surface.ts);
// the rest are canvas paintings drawn wrap-around so they tile seamlessly.

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Draws fn at the 9 wrapped offsets (or 3 horizontal ones) so the result tiles. */
function wrapped(g: Ctx, w: number, h: number, fn: () => void, vertical = true) {
  for (const dx of [-w, 0, w]) {
    for (const dy of vertical ? [-h, 0, h] : [0]) {
      g.save();
      g.translate(dx, dy);
      fn();
      g.restore();
    }
  }
}

export function blobs(g: Ctx, w: number, h: number, r: () => number, n: number, colors: string[], size: [number, number], alpha: [number, number], vertical = true, yRange: [number, number] = [0, 1]) {
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = (yRange[0] + r() * (yRange[1] - yRange[0])) * h;
    const rx = size[0] + r() * (size[1] - size[0]);
    const ry = rx * (0.5 + r() * 0.6);
    const rot = r() * Math.PI;
    g.globalAlpha = alpha[0] + r() * (alpha[1] - alpha[0]);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    wrapped(
      g,
      w,
      h,
      () => {
        g.beginPath();
        g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
        g.fill();
      },
      vertical,
    );
  }
  g.globalAlpha = 1;
}

export function toTexture(c: HTMLCanvasElement, wrap = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; // the GPU backend clamps to what the device supports
  return t;
}

/** Swirling wind-spirit glyph for jump pads. */
export function padTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const grad = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2);
  grad.addColorStop(0, '#f4fff9');
  grad.addColorStop(0.6, '#a6ecd3');
  grad.addColorStop(1, '#6fcfb1');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    g.lineWidth = 7;
    g.globalAlpha = 0.85;
    g.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * ((Math.PI * 2) / 3) + t * 4.2;
      const rad = 12 + t * 100;
      const x = S / 2 + Math.cos(a) * rad;
      const y = S / 2 + Math.sin(a) * rad;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, false);
}

/** Writes a per-pixel function into a canvas: fn(u, v) returns [r, g, b, a] in 0..1 (v = 0 at the top row). */
function pixels(w: number, h: number, fn: (u: number, v: number) => [number, number, number, number]): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gg, b, a] = fn((x + 0.5) / w, (y + 0.5) / h);
      const i = (y * w + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = gg * 255;
      img.data[i + 2] = b * 255;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * A sunlit cumulus: billowing fractal edges, bright tops, a flat blue-grey base, thin wisps where the density fades.
 * Transparent background.
 */
export function cloudTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  // The cloud's silhouette: a row of overlapping towers, tallest in the middle.
  const puffs: [number, number, number][] = [];
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hump = Math.sin(t * Math.PI);
    puffs.push([0.12 + t * 0.76 + (r() - 0.5) * 0.06, 0.75 - hump * (0.3 + r() * 0.2), 0.09 + hump * 0.13 * (0.6 + r() * 0.6)]);
  }
  const c = pixels(512, 256, (u, v) => {
    let env = 0;
    for (const [px, py, pr] of puffs) {
      const dx = (u - px) / pr;
      const dy = ((v - py) * 0.5) / pr;
      env = Math.max(env, 1 - Math.sqrt(dx * dx + dy * dy));
    }
    const billow = fbm(u, v, 6, 5, seed, 3) * 0.5 + 0.5;
    const base = smooth(0.86, 0.78, v); // flat bottom
    const d = clamp01(env * 1.6 + (billow - 0.5) * 0.9) * base;
    const a = smooth(0.12, 0.55, d);
    // Lit from above: bright warm white at the tops, cooler and darker toward the base and the dense core.
    const lit = clamp01(1 - (v - 0.2) * 0.9) * 0.55 + billow * 0.35 + 0.25;
    const shade = lerp(0.68, 1.0, clamp01(lit));
    return [shade * 1.0, shade * 0.985, shade * 0.96 + (1 - shade) * 0.18, a];
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tileable cloud-tops for the sea of clouds below the islands: billows with soft gaps and grey hollows. */
export function cloudSeaTexture(): THREE.CanvasTexture {
  const c = pixels(512, 512, (u, v) => {
    const d = fbm(u, v, 4, 6, 71) * 0.5 + 0.5;
    const billow = 1 - Math.abs(fbm(u, v, 8, 4, 73));
    const k = clamp01(d * 0.7 + billow * 0.4);
    const shade = lerp(0.72, 1.0, k);
    return [shade * 0.98, shade * 0.99, shade, smooth(0.25, 0.6, k) * 0.95 + 0.05];
  });
  return toTexture(c);
}

/** Round soft dot for particles. */
export function softDot(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


// Helpers for the bakers (here and in the other maps' texture files).
export type RGB = readonly [number, number, number];
export const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** Sets the texel's colour to a mix of `a` and `b`. */
export function paint(t: Texel, a: RGB, b: RGB, k: number) {
  t.r = lerp(a[0], b[0], k);
  t.g = lerp(a[1], b[1], k);
  t.b = lerp(a[2], b[2], k);
}
/** Blends `c` over the texel's colour by `k`. */
export function tint(t: Texel, c: RGB, k: number) {
  t.r = lerp(t.r, c[0], k);
  t.g = lerp(t.g, c[1], k);
  t.b = lerp(t.b, c[2], k);
}
export function shade(t: Texel, k: number) {
  t.r *= k;
  t.g *= k;
  t.b *= k;
}

const GRASS_LUSH = hex(0x4e7a2b);
const GRASS_DEEP = hex(0x2c4e17);
const GRASS_DRY = hex(0x8c8a48);
const GRASS_TIP = hex(0x9fb560);
const SOIL = hex(0x5e4630);

/** A meadow seen from above: tufts of blades, darker lush patches, sun-dried streaks and bare soil between. */
function grassTexel(u: number, v: number, t: Texel, c: Cell) {
  const patch = fbm(u, v, 3, 4, 101) * 0.5 + 0.5; // lush vs dry, metres across
  const dry = smooth(0.55, 0.8, fbm(u, v, 2, 3, 107) * 0.5 + 0.5);
  worley(u, v, 24, 109, c); // clumps, each a slightly different green
  // Blades: two layers of fine noise stretched along different directions, so they cross like a real sward instead of
  // forming dots.
  const a = noise(u, v, 320, 111, 96) * 0.5 + 0.5;
  const b = noise(u, v, 96, 113, 320) * 0.5 + 0.5;
  const tuft = smooth(0.35, 0.9, Math.max(a, b) * (0.8 + (1 - c.f1) * 0.25));
  const blades = noise(u, v, 512, 115) * 0.5 + 0.5;
  const bare = smooth(0.62, 0.78, fbm(u, v, 4, 4, 127) * 0.5 + 0.5) * (1 - tuft);
  paint(t, GRASS_DEEP, GRASS_LUSH, patch);
  const tip = tuft * 0.55 + blades * 0.3;
  t.r = lerp(t.r, GRASS_TIP[0], tip * 0.6);
  t.g = lerp(t.g, GRASS_TIP[1], tip * 0.6);
  t.b = lerp(t.b, GRASS_TIP[2], tip * 0.6);
  t.r = lerp(t.r, GRASS_DRY[0], dry * 0.55);
  t.g = lerp(t.g, GRASS_DRY[1], dry * 0.55);
  t.b = lerp(t.b, GRASS_DRY[2], dry * 0.55);
  t.r = lerp(t.r, SOIL[0], bare * 0.7);
  t.g = lerp(t.g, SOIL[1], bare * 0.7);
  t.b = lerp(t.b, SOIL[2], bare * 0.7);
  shade(t, (0.88 + c.id * 0.14) * (0.8 + tuft * 0.25));
  t.h = tuft * 0.7 + blades * 0.3 - bare * 0.3;
  t.rough = 0.78 + (1 - tuft) * 0.18;
  t.ao = 0.55 + tuft * 0.45;
}

/** Meadow grass seen from above. */
export function grassTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  return bake('grass', (u, v, t) => grassTexel(u, v, t, c), { size: 1024, normal: 5 });
}

/**
 * Side of a floating island: a turf lip with hanging roots at the top (v = 1), then layered soil with stones.
 * Tiles horizontally; the lip repeats every tile down a tall side, like the strata.
 */
export function earthSideTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  const soilA = hex(0x6b4f35);
  const soilB = hex(0x8d6b48);
  const clay = hex(0xa07a52);
  const stone = hex(0x847a6e);
  return bake(
    'earthSide',
    (u, v, t) => {
      const warp = fbm(u, v, 4, 3, 211) * 0.04;
      const strata = Math.sin((v + warp) * Math.PI * 2 * 7) * 0.5 + 0.5;
      const grain = fbm(u, v, 16, 4, 223) * 0.5 + 0.5;
      paint(t, soilA, soilB, strata * 0.6 + grain * 0.4);
      const band = smooth(0.7, 0.95, Math.sin((v + warp * 2) * Math.PI * 2 * 3 + 1) * 0.5 + 0.5);
      t.r = lerp(t.r, clay[0], band * 0.5);
      t.g = lerp(t.g, clay[1], band * 0.5);
      t.b = lerp(t.b, clay[2], band * 0.5);
      t.h = grain * 0.3 + strata * 0.15;
      t.rough = 0.92;
      // Embedded stones.
      worley(u, v, 18, 229, c, 1);
      const pebble = smooth(0.42, 0.3, c.f1) * (c.id > 0.35 ? 1 : 0);
      if (pebble > 0) {
        const s = 0.75 + c.id * 0.35;
        t.r = lerp(t.r, stone[0] * s, pebble);
        t.g = lerp(t.g, stone[1] * s, pebble);
        t.b = lerp(t.b, stone[2] * s, pebble);
        t.h += pebble * 0.6;
        t.rough = lerp(t.rough, 0.7, pebble);
      }
      t.ao = 0.75 + t.h * 0.3;
      // Turf lip and the roots hanging from it.
      const edge = 0.84 + noise(u, 0.5, 12, 233) * 0.025 + noise(u, 0.5, 48, 239) * 0.012;
      if (v > edge) {
        grassTexel(u, v, t, c);
        t.h += 0.4;
      } else {
        const root = ridged(u, v, 40, 2, 241, 4);
        const hang = smooth(edge - 0.16, edge, v) * smooth(0.82, 0.95, root);
        t.r = lerp(t.r, 0.33, hang * 0.6);
        t.g = lerp(t.g, 0.24, hang * 0.6);
        t.b = lerp(t.b, 0.15, hang * 0.6);
        t.h += hang * 0.3;
        shade(t, 1 - smooth(edge - 0.06, edge, v) * 0.45); // the overhang's shadow just under the turf
      }
    },
    { size: 512, normal: 6 },
  );
}

/** Weathered sandstone for island undersides and distant islands: fractured blocks, lichen, dark seams. */
export function rockTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  const light = hex(0xa39280);
  const dark = hex(0x6a5d50);
  const lichen = hex(0x76804e);
  return bake(
    'rock',
    (u, v, t) => {
      worley(u, v, 6, 307, c);
      const crack = smooth(0.06, 0.0, c.f2 - c.f1);
      const n = fbm(u, v, 8, 5, 311) * 0.5 + 0.5;
      const strata = Math.sin((v + fbm(u, v, 3, 2, 313) * 0.08) * Math.PI * 2 * 9) * 0.5 + 0.5;
      paint(t, dark, light, n * 0.6 + strata * 0.2 + c.id * 0.3);
      const moss = smooth(0.6, 0.75, fbm(u, v, 5, 4, 317) * 0.5 + 0.5);
      t.r = lerp(t.r, lichen[0], moss * 0.7);
      t.g = lerp(t.g, lichen[1], moss * 0.7);
      t.b = lerp(t.b, lichen[2], moss * 0.7);
      shade(t, 1 - crack * 0.6);
      t.h = n * 0.6 + strata * 0.15 - crack * 0.8 + c.f1 * 0.2;
      t.rough = 0.86 + crack * 0.1 - moss * 0.05;
      t.ao = 1 - crack * 0.7;
    },
    { size: 512, normal: 8 },
  );
}

/** Coursed limestone wall: dressed blocks in staggered rows, recessed mortar, rain streaks and moss low down. */
export function wallTexture(): THREE.Texture {
  const rows = 6;
  const stone = hex(0xcbb894);
  const stoneDark = hex(0xa99470);
  const mortar = hex(0x8f8573);
  const moss = hex(0x5d6b34);
  return bake(
    'wall',
    (u, v, t) => {
      const ry = v * rows;
      const row = Math.floor(ry);
      const fy = ry - row;
      // Three blocks per row with a random stagger, so joints don't line up.
      const cols = 3;
      const shift = ((row * 0.37) % 1) * 1.0;
      const rx = (u * cols + shift) % cols;
      const col = Math.floor(rx);
      const fx = rx - col;
      const id = ((row * 7 + col * 13) % 17) / 17;
      const jx = Math.min(fx, 1 - fx) * (1 / cols) * 3; // distance to a vertical joint, in rows
      const jy = Math.min(fy, 1 - fy);
      const joint = Math.min(jx, jy);
      const inMortar = smooth(0.05, 0.025, joint);
      const bevel = smooth(0.025, 0.12, joint); // blocks round off toward their edges
      const grain = fbm(u, v, 12, 5, 401) * 0.5 + 0.5;
      paint(t, stoneDark, stone, grain * 0.5 + id * 0.5);
      const streak = smooth(0.55, 0.9, fbm(u, v, 24, 3, 409, 2) * 0.5 + 0.5); // rain streaks run down
      shade(t, 1 - streak * 0.18);
      const damp = smooth(0.3, 0.0, v) * (fbm(u, v, 6, 3, 419) * 0.5 + 0.5);
      t.r = lerp(t.r, moss[0], damp * 0.5);
      t.g = lerp(t.g, moss[1], damp * 0.5);
      t.b = lerp(t.b, moss[2], damp * 0.5);
      t.r = lerp(t.r, mortar[0], inMortar);
      t.g = lerp(t.g, mortar[1], inMortar);
      t.b = lerp(t.b, mortar[2], inMortar);
      const pits = smooth(0.7, 0.85, noise(u, v, 96, 421) * 0.5 + 0.5);
      t.h = bevel * 0.7 + grain * 0.25 - pits * 0.15;
      t.rough = lerp(0.82, 0.95, inMortar) - damp * 0.1;
      t.ao = 0.45 + bevel * 0.55;
    },
    { size: 1024, normal: 10 },
  );
}

/** Weathered timber planks for crates and cover: grain, knots, worn edges, dark gaps between boards. */
export function woodTexture(): THREE.Texture {
  const planks = 4;
  const light = hex(0x9c6c42);
  const dark = hex(0x5f3d22);
  return bake(
    'wood',
    (u, v, t) => {
      const py = v * planks;
      const plank = Math.floor(py);
      const fy = py - plank;
      const off = plank * 0.31;
      const warp = fbm(u + off, v, 2, 3, 503, 8) * 0.6;
      const rings = Math.sin((fy * 6 + warp * 4) * Math.PI * 2) * 0.5 + 0.5;
      const fibre = noise(u + off, v, 6, 509, 512) * 0.5 + 0.5;
      // A knot or two per plank: rings tighten around a dark centre.
      const kx = ((plank * 0.618 + 0.2) % 1) - u;
      const ky = (fy - 0.5) * 0.25;
      const knot = Math.exp(-(kx * kx + ky * ky) * 900);
      const tone = 0.8 + ((plank * 0.53) % 1) * 0.35;
      paint(t, dark, light, rings * 0.45 + fibre * 0.35 + 0.2);
      shade(t, tone * (1 - knot * 0.5));
      const gap = smooth(0.035, 0.0, Math.min(fy, 1 - fy));
      shade(t, 1 - gap * 0.75);
      const wear = smooth(0.12, 0.04, Math.min(fy, 1 - fy)) * (fbm(u, v, 16, 3, 521) * 0.5 + 0.5);
      t.r += wear * 0.08;
      t.g += wear * 0.06;
      t.b += wear * 0.04;
      t.h = 0.7 - gap * 0.7 + fibre * 0.1 + rings * 0.08;
      t.rough = 0.7 + fibre * 0.15 + gap * 0.15;
      t.ao = 1 - gap * 0.8;
    },
    { size: 512, normal: 6 },
  );
}

/** Deeply furrowed bark with moss in the cracks, for the great tree and the timber trunks. */
export function barkTexture(): THREE.Texture {
  const light = hex(0x6e5844);
  const dark = hex(0x2f241b);
  const moss = hex(0x4f6a2e);
  return bake(
    'bark',
    (u, v, t) => {
      const ridge = ridged(u, v, 10, 4, 601, 2); // long vertical plates
      const n = fbm(u, v, 24, 3, 607) * 0.5 + 0.5;
      paint(t, dark, light, ridge * 0.8 + n * 0.2);
      const crevice = 1 - ridge;
      const m = smooth(0.55, 0.8, fbm(u, v, 4, 3, 613) * 0.5 + 0.5) * crevice;
      t.r = lerp(t.r, moss[0], m * 0.8);
      t.g = lerp(t.g, moss[1], m * 0.8);
      t.b = lerp(t.b, moss[2], m * 0.8);
      t.h = ridge * 0.9 + n * 0.1;
      t.rough = 0.9;
      t.ao = 0.35 + ridge * 0.65;
    },
    { size: 512, normal: 14 },
  );
}

/**
 * Surf ramps: polished blue-grey stone with long flow veins along the ramp (texture u), glossy enough to catch the
 * sky. Reads at a glance as "ride this", unlike the matte ground around it.
 */
export function surfTexture(): THREE.Texture {
  const base = hex(0x7fa7bd);
  const pale = hex(0xc6dde8);
  const vein = hex(0x4c7187);
  return bake(
    'surf',
    (u, v, t) => {
      const flow = fbm(u, v, 1, 4, 701, 6) * 0.5 + 0.5;
      const veins = smooth(0.92, 0.99, ridged(u, v, 2, 3, 709, 10));
      paint(t, base, pale, flow);
      t.r = lerp(t.r, vein[0], veins * 0.6);
      t.g = lerp(t.g, vein[1], veins * 0.6);
      t.b = lerp(t.b, vein[2], veins * 0.6);
      // Slab seams across the ramp every half tile.
      const seam = smooth(0.012, 0.0, Math.min(u % 0.5, 0.5 - (u % 0.5)));
      shade(t, 1 - seam * 0.5);
      t.h = -seam;
      t.rough = 0.16 + flow * 0.08 + seam * 0.5;
      t.ao = 1 - seam * 0.5;
    },
    { size: 512, normal: 3 },
  );
}

/**
 * A mass of overlapping leaves, nearly neutral in colour so each canopy's material colour tints it: lit leaf faces
 * with a midrib, darker gaps between them. Tile it a few times over a crown (set `repeat`).
 */
export function foliageTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  return bake(
    'foliage',
    (u, v, t) => {
      worley(u, v, 22, 801, c, 1);
      const leaf = smooth(0.0, 0.18, c.f2 - c.f1); // 0 at leaf edges, 1 inside
      const vein = smooth(0.06, 0.0, Math.abs(c.f1 - c.f2 * 0.55)) * leaf * 0.3;
      const b = (0.62 + c.id * 0.38) * (0.35 + leaf * 0.65) + vein * 0.2;
      t.r = b * (0.93 + c.id * 0.12);
      t.g = b;
      t.b = b * 0.8;
      t.h = leaf * (0.6 + c.id * 0.4);
      t.rough = 0.6 + (1 - leaf) * 0.3;
      t.ao = 0.4 + leaf * 0.6;
    },
    { size: 512, normal: 5 },
  );
}
