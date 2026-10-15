// Tileable noise for baking surface textures: periodic gradient noise, fBm and cellular (Worley) noise.
// Everything takes coordinates in [0, 1) and a whole-number cell count, so the result wraps seamlessly.

/** Integer hash → [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient (Perlin-style) noise in about [-1, 1], with `cells` cells across the tile (`cy` down it, if different). */
export function noise(u: number, v: number, cells: number, seed = 0, cy = cells): number {
  const x = u * cells;
  const y = v * cy;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash(mod(ix, cells), mod(iy, cy), seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  const sx = fade(xf);
  const sy = fade(yf);
  return 1.414 * ((n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy);
}

/** Fractal sum of `octaves` noise layers, each twice the frequency and `gain` the amplitude. About [-1, 1]. */
export function fbm(u: number, v: number, cells: number, octaves: number, seed = 0, cy = cells, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u, v, cells << o, seed + o * 17, cy << o) * amp;
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged fBm in [0, 1]: sharp crests, for cracks, veins and bark ridges. */
export function ridged(u: number, v: number, cells: number, octaves: number, seed = 0, cy = cells): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(u, v, cells << o, seed + o * 31, cy << o));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

export interface Cell {
  /** Distance to the nearest feature point, in cells. */
  f1: number;
  /** Distance to the second nearest. f2 - f1 is ~0 along the borders between cells. */
  f2: number;
  /** A stable random value per cell, for tinting each stone differently. */
  id: number;
}

/** Cellular noise with `cells` cells across; `jitter` 0 is a regular grid, 1 fully random. */
export function worley(u: number, v: number, cells: number, seed = 0, out: Cell = { f1: 0, f2: 0, id: 0 }, jitter = 0.9): Cell {
  const x = u * cells;
  const y = v * cells;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = mod(xi + i, cells);
      const cy = mod(yi + j, cells);
      const px = xi + i + 0.5 + (hash(cx, cy, seed) - 0.5) * jitter;
      const py = yi + j + 0.5 + (hash(cx, cy, seed + 7) - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(cx, cy, seed + 13);
      } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  return out;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
