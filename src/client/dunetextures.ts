import type * as THREE from 'three';
import { type Cell, clamp01, fbm, lerp, noise, ridged, smooth, worley } from './render/noise.ts';
import { type Texel, bake } from './render/surface.ts';
import { type RGB, hex, paint, shade, tint } from './textures.ts';

// Dune Village's surfaces: sun-warmed sand, sandstone blocks, lime plaster over mud-brick, packed-clay roofs, rippled
// dune sand for slide ramps, turquoise glazed tile for the aqueduct surf, awning cloth and palm bark. Baked per texel
// with height, roughness and occlusion like the sky islands' (textures.ts); everything tiles.

/** Wind ripples: crests across the tile (`n` of them), wandering a little. 1 on a crest, 0 in a trough. */
function ripple(u: number, v: number, n: number, seed: number): number {
  const warp = fbm(u, v, 2, 3, seed) * 0.6 + noise(u, v, 6, seed + 3) * 0.12;
  const x = (v * n + warp) % 1;
  const p = x < 0 ? x + 1 : x;
  // Asymmetric, like real ripples: a long gentle windward slope and a short steep lee face.
  return p < 0.75 ? p / 0.75 : (1 - p) / 0.25;
}

/** Sand grains and the odd pebble, shared by the ground and the dunes. */
function sandTexel(u: number, v: number, t: Texel, base: RGB, crest: RGB, ripples: number, depth: number, seed: number) {
  const r = ripple(u, v, ripples, seed);
  const n = fbm(u, v, 4, 4, seed + 5) * 0.5 + 0.5;
  const grain = noise(u, v, 256, seed + 7) * 0.5 + 0.5;
  paint(t, base, crest, r * 0.45 + n * 0.35 + grain * 0.2);
  t.h = r * depth + n * 0.3 + grain * 0.08;
  t.rough = 0.92;
  t.ao = 0.8 + r * 0.2;
}

/** The town's ground: warm sand with soft wind ripples, a scatter of pebbles and darker trodden patches. */
export function sandTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  const sand = hex(0xd9b582);
  const light = hex(0xf0d6a8);
  const pebble = hex(0xa88d6c);
  return bake(
    'sand',
    (u, v, t) => {
      sandTexel(u, v, t, sand, light, 14, 0.25, 301);
      const trod = smooth(0.55, 0.8, fbm(u, v, 3, 3, 303) * 0.5 + 0.5);
      shade(t, 1 - trod * 0.12);
      worley(u, v, 40, 305, c, 1);
      const stone = smooth(0.25, 0.15, c.f1) * (c.id > 0.94 ? 1 : 0);
      if (stone > 0) {
        tint(t, pebble, stone * 0.7);
        t.h += stone * 0.35;
        t.rough = lerp(t.rough, 0.7, stone);
      }
    },
    { size: 512, normal: 4 },
  );
}

/** Dune sand on slide ramps: deeper apricot with bold ripple bands across the slope, so a slope reads as "slide". */
export function duneTexture(): THREE.Texture {
  const sand = hex(0xd88f52);
  const crest = hex(0xf3c189);
  return bake('dune', (u, v, t) => sandTexel(u, v, t, sand, crest, 8, 0.8, 307), { size: 512, normal: 6 });
}

/**
 * Coursed masonry: `rows` courses of blocks about `aspect` rows long, staggered. Returns the distance to the nearest
 * joint (in rows) and a per-block random value.
 */
function courses(u: number, v: number, rows: number, aspect: number, out: { joint: number; id: number }) {
  const ry = v * rows;
  const row = Math.floor(ry);
  const fy = ry - row;
  const cols = Math.max(1, Math.round(rows / aspect));
  const rx = (u * cols + ((row * 0.53) % 1)) % cols;
  const col = Math.floor(rx);
  const fx = rx - col;
  out.joint = Math.min(Math.min(fx, 1 - fx) * (rows / cols), Math.min(fy, 1 - fy));
  out.id = (((row * 7 + col * 13) % 23) + 0.5) / 23;
}

/** Big honey-coloured sandstone blocks in courses: the town wall, towers and aqueduct arches. */
export function sandstoneTexture(): THREE.Texture {
  const b = { joint: 0, id: 0 };
  const light = hex(0xe0b57b);
  const dark = hex(0xae8152);
  const mortar = hex(0x9d7d5a);
  return bake(
    'sandstone',
    (u, v, t) => {
      courses(u, v, 5, 1.7, b);
      const inMortar = smooth(0.05, 0.025, b.joint);
      const bevel = smooth(0.025, 0.15, b.joint);
      const bed = Math.sin((v * 5 * 6 + fbm(u, v, 4, 2, 311) * 2) * Math.PI * 2) * 0.5 + 0.5; // bedding lines in the stone
      const n = fbm(u, v, 8, 5, 313) * 0.5 + 0.5;
      paint(t, dark, light, n * 0.45 + b.id * 0.4 + bed * 0.15);
      const erosion = smooth(0.6, 0.8, fbm(u, v, 12, 3, 317) * 0.5 + 0.5);
      shade(t, 1 - erosion * 0.15);
      tint(t, mortar, inMortar);
      t.h = bevel * 0.7 + n * 0.2 - erosion * 0.2 + bed * 0.05;
      t.rough = 0.88;
      t.ao = 0.45 + bevel * 0.55;
    },
    { size: 1024, normal: 9 },
  );
}

/** Ochre lime plaster over mud-brick: the courses ghost through, and where the plaster has flaked the bricks show. */
export function mudbrickTexture(): THREE.Texture {
  const b = { joint: 0, id: 0 };
  const plaster = hex(0xddb27c);
  const plasterLight = hex(0xecd0a2);
  const brick = hex(0xc29368);
  const brickDark = hex(0xa87b51);
  return bake(
    'mudbrick',
    (u, v, t) => {
      courses(u, v, 16, 2, b);
      const n = fbm(u, v, 6, 5, 321) * 0.5 + 0.5;
      const flake = smooth(0.7, 0.74, fbm(u, v, 3, 5, 323) * 0.5 + 0.5); // bare patches, here and there
      const brushed = noise(u, v, 8, 325, 64) * 0.5 + 0.5; // brush strokes in the wash
      paint(t, plaster, plasterLight, n * 0.6 + brushed * 0.4);
      const ghost = smooth(0.06, 0.02, b.joint) * 0.12;
      shade(t, 1 - ghost);
      if (flake > 0) {
        const joint = smooth(0.08, 0.03, b.joint);
        const bc: RGB = [lerp(brickDark[0], brick[0], b.id), lerp(brickDark[1], brick[1], b.id), lerp(brickDark[2], brick[2], b.id)];
        tint(t, bc, flake);
        shade(t, 1 - joint * flake * 0.35);
      }
      t.h = (1 - flake) * 0.5 + n * 0.2 - flake * smooth(0.08, 0.03, b.joint) * 0.3;
      t.rough = 0.9;
      t.ao = 0.75 + (1 - flake) * 0.25;
    },
    { size: 1024, normal: 6 },
  );
}

/** Packed-clay flat roofs, smoothed by hand: trowel sweeps and hairline cracks. */
export function roofTexture(): THREE.Texture {
  const clay = hex(0xcf9b6b);
  const light = hex(0xe3b98b);
  const crackCol = hex(0x8d5f3b);
  return bake(
    'roof',
    (u, v, t) => {
      const n = fbm(u, v, 4, 5, 331) * 0.5 + 0.5;
      const trowel = Math.sin((u * 3 + fbm(u, v, 3, 3, 333) * 1.5) * Math.PI * 2 * 4) * 0.5 + 0.5;
      paint(t, clay, light, n * 0.7 + trowel * 0.3);
      const crack = smooth(0.92, 0.985, ridged(u, v, 3, 3, 337));
      tint(t, crackCol, crack * 0.8);
      t.h = n * 0.4 + trowel * 0.15 - crack * 0.6;
      t.rough = 0.85 - trowel * 0.1;
      t.ao = 1 - crack * 0.5;
    },
    { size: 512, normal: 5 },
  );
}

/** Turquoise glazed tile for the aqueduct surf: 4×4 tiles in grout, each glazed a little differently, glossy. */
export function tileTexture(): THREE.Texture {
  const glaze = hex(0x2aa8ab);
  const glazeDeep = hex(0x13757f);
  const grout = hex(0xd9cdb6);
  return bake(
    'duneTile',
    (u, v, t) => {
      const n = 4;
      const fx = (u * n) % 1;
      const fy = (v * n) % 1;
      const id = ((Math.floor(u * n) * 5 + Math.floor(v * n) * 11) % 13) / 13;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const inGrout = smooth(0.04, 0.025, edge);
      const pool = fbm(u, v, 4, 3, 341) * 0.5 + 0.5; // glaze pools darker toward each tile's middle
      const crackle = smooth(0.93, 0.99, ridged(u, v, 12, 2, 343));
      paint(t, glazeDeep, glaze, 0.45 + id * 0.35 + pool * 0.2 - smooth(0.1, 0.4, edge) * 0.2);
      shade(t, 1 - crackle * 0.15);
      tint(t, grout, inGrout);
      const bevel = smooth(0.025, 0.08, edge);
      t.h = bevel * 0.8 + pool * 0.05;
      t.rough = lerp(0.06 + crackle * 0.1, 0.85, inGrout);
      t.ao = 0.6 + bevel * 0.4;
    },
    { size: 512, normal: 5 },
  );
}

/** Woven awning cloth: broad turquoise, cream and terracotta stripes with a visible weave. */
export function awningTexture(): THREE.Texture {
  const bands = [hex(0x2fa7a3), hex(0xf2e6cc), hex(0xc8643f), hex(0xf2e6cc)];
  return bake(
    'awning',
    (u, v, t) => {
      const band = bands[Math.floor(u * 8) % bands.length];
      const warp = Math.sin(u * 256 * Math.PI) * 0.5 + 0.5;
      const weft = Math.sin(v * 256 * Math.PI) * 0.5 + 0.5;
      const weave = (Math.floor(u * 128) + Math.floor(v * 128)) % 2 ? warp : weft;
      const fade = fbm(u, v, 3, 3, 351) * 0.5 + 0.5; // sun-bleached unevenly
      t.r = band[0];
      t.g = band[1];
      t.b = band[2];
      tint(t, [0.95, 0.92, 0.85], fade * 0.18);
      shade(t, 0.82 + weave * 0.18);
      t.h = weave * 0.5;
      t.rough = 0.92;
      t.ao = 0.8 + weave * 0.2;
    },
    { size: 512, normal: 2 },
  );
}

/** Palm bark: stacked crescent scales left by old fronds. Wraps horizontally round the trunk. */
export function palmBarkTexture(): THREE.Texture {
  const light = hex(0xa47a52);
  const dark = hex(0x5a3f28);
  const fibre = hex(0x7d6040);
  return bake(
    'palmBark',
    (u, v, t) => {
      const rows = 6;
      const ry = v * rows;
      const row = Math.floor(ry);
      const fy = ry - row;
      const fx = (u * 4 + (row % 2) * 0.5) % 1;
      // Each scale is a crescent hanging from its row: thick in the middle, curling up at the sides.
      const curve = (fx - 0.5) * (fx - 0.5) * 1.6;
      const s = clamp01((fy - curve) / 0.85);
      const lip = smooth(0.0, 0.15, s) * smooth(1.0, 0.7, s);
      const hair = noise(u, v, 64, 353, 8) * 0.5 + 0.5;
      paint(t, dark, light, s * 0.7 + hair * 0.3);
      tint(t, fibre, smooth(0.15, 0.0, s) * 0.6);
      t.h = s * 0.8 + hair * 0.1;
      t.rough = 0.9;
      t.ao = 0.4 + lip * 0.6;
    },
    { size: 256, normal: 8 },
  );
}
