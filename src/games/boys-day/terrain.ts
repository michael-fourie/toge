// The land under the road: rolling hills from a seed (smooth value noise), the road's own heights (the hills,
// smoothed, never steeper than a bus can climb, and flat where you park), and the ground anywhere, which blends from
// the road's height at its edge to the wild hills beyond. Pure: no three.js. Same seed, same hills, every screen.

export const TERRAIN = {
  /** Big hills: height (m) and size (m across); small lumps on top. */
  hill: 26,
  hillSize: 170,
  lump: 5,
  lumpSize: 38,
  /** The road's steepest grade (rise over run), how far its heights are smoothed (road points each side), and how
   *  flat the stops are (road points each side, then a blend over `stopBlend` more). */
  maxGrade: 0.16,
  smooth: 7,
  stopFlat: 5,
  stopBlend: 4,
  /** The ground meets the road's height at its edge and is the wild hills this far out (m from the centre line). */
  edge: 6.5,
  wild: 26,
} as const;

/** Smooth 2D value noise in [0, 1], seeded. */
export function noise2(seed: number) {
  const hash = (x: number, z: number) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const fx = fade(x - xi);
    const fz = fade(z - zi);
    const a = hash(xi, zi) + (hash(xi + 1, zi) - hash(xi, zi)) * fx;
    const b = hash(xi, zi + 1) + (hash(xi + 1, zi + 1) - hash(xi, zi + 1)) * fx;
    return a + (b - a) * fz;
  };
}

/** The wild hills at (x, z), for a seed. */
export function hillsFor(seed: number) {
  const big = noise2(seed ^ 0x51a7);
  const small = noise2(seed ^ 0x2b0b);
  return (x: number, z: number) =>
    (big(x / TERRAIN.hillSize, z / TERRAIN.hillSize) - 0.5) * 2 * TERRAIN.hill + (small(x / TERRAIN.lumpSize, z / TERRAIN.lumpSize) - 0.5) * 2 * TERRAIN.lump;
}

/**
 * The road's heights, one per road point (spaced `step` apart): the hills under it, smoothed, held to the steepest
 * grade a bus can manage, and flat round each stop (`stops`: road indices).
 */
export function roadHeights(raw: number[], step: number, stops: readonly number[]): number[] {
  const n = raw.length;
  const k = TERRAIN.smooth;
  let y = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      s += raw[j];
      c++;
    }
    return s / c;
  });
  // Flat where you park (and those points stay put while the grade is clamped round them).
  const pinned = new Uint8Array(n);
  for (const at of stops) {
    for (let j = Math.max(0, at - TERRAIN.stopFlat); j <= Math.min(n - 1, at + TERRAIN.stopFlat); j++) pinned[j] = 1;
    const h = y[at];
    for (let j = Math.max(0, at - TERRAIN.stopFlat - TERRAIN.stopBlend); j <= Math.min(n - 1, at + TERRAIN.stopFlat + TERRAIN.stopBlend); j++) {
      const d = Math.abs(j - at);
      const t = d <= TERRAIN.stopFlat ? 0 : (d - TERRAIN.stopFlat) / TERRAIN.stopBlend;
      y[j] = h + (y[j] - h) * t * t;
    }
  }
  // No steeper than a bus can climb: pull each point toward its neighbour until every step is in grade.
  const max = TERRAIN.maxGrade * step;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < n; i++) if (!pinned[i]) y[i] = Math.max(y[i - 1] - max, Math.min(y[i - 1] + max, y[i]));
    for (let i = n - 2; i >= 0; i--) if (!pinned[i]) y[i] = Math.max(y[i + 1] - max, Math.min(y[i + 1] + max, y[i]));
  }
  y = y.map((v) => Math.round(v * 1000) / 1000);
  return y;
}

/** 0 at the road's edge, 1 out in the wild hills (smooth). */
export function wildness(d: number) {
  const t = Math.max(0, Math.min(1, (d - TERRAIN.edge) / (TERRAIN.wild - TERRAIN.edge)));
  return t * t * (3 - 2 * t);
}
