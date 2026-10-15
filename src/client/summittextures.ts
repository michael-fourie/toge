import type * as THREE from 'three';
import { type Cell, fbm, lerp, noise, ridged, smooth, worley } from './render/noise.ts';
import { type Texel, bake } from './render/surface.ts';
import { hex, paint, shade, tint } from './textures.ts';

// Summit's surfaces: wind-packed snow, blue-grey rock, glassy ice, groomed piste and snowed-on logs. Baked per texel
// with height, roughness and occlusion like the sky islands' (textures.ts); everything tiles.

const SNOW = hex(0xf1f5fb);
const SNOW_SHADE = hex(0xc9d6e8);

/** Snow detail shared by the snowfield and the caps: sastrugi (wind ridges), soft hollows and glinting crystals. */
function snowTexel(u: number, v: number, t: Texel, seed: number) {
  const drift = fbm(u, v, 3, 4, seed) * 0.5 + 0.5;
  const warp = fbm(u, v, 4, 2, seed + 7) * 0.08;
  const sastrugi = Math.sin((v * 9 + u * 2 + warp * 20) * Math.PI * 2) * 0.5 + 0.5;
  const grain = noise(u, v, 64, seed + 11) * 0.5 + 0.5;
  const h = drift * 0.6 + sastrugi * 0.25 * drift + grain * 0.04;
  paint(t, SNOW_SHADE, SNOW, 0.7 + h * 0.3);
  const glint = smooth(0.82, 0.9, noise(u, v, 300, seed + 13) * 0.5 + 0.5);
  t.h = h;
  t.rough = lerp(0.72, 0.25, glint); // crystals catch the sun as sparkles
  t.ao = 0.85 + h * 0.15;
}

/** Fresh snow from above: wind-sculpted and faintly blue in its hollows. */
export function snowTexture(): THREE.Texture {
  return bake('snow', (u, v, t) => snowTexel(u, v, t, 101), { size: 512, normal: 3 });
}

/**
 * Side of a rock shelf: a thick snow cap with an uneven lower edge at the top (v = 1), then layered blue-grey rock with
 * snow lodged on the ledges. Tiles horizontally (use with boxGeometry's anchorTop).
 */
export function cliffTexture(): THREE.Texture {
  const c: Cell = { f1: 0, f2: 0, id: 0 };
  const light = hex(0x8c96a6);
  const dark = hex(0x4f5868);
  return bake(
    'cliff',
    (u, v, t) => {
      const warp = fbm(u, v, 3, 3, 211) * 0.05;
      const layer = (v + warp) * 10;
      const strata = Math.sin(layer * Math.PI * 2) * 0.5 + 0.5;
      worley(u, v, 7, 213, c);
      const crack = smooth(0.05, 0.0, c.f2 - c.f1);
      const n = fbm(u, v, 10, 5, 217) * 0.5 + 0.5;
      paint(t, dark, light, n * 0.55 + strata * 0.2 + c.id * 0.25);
      shade(t, 1 - crack * 0.55);
      t.h = n * 0.5 + strata * 0.3 + c.f1 * 0.2 - crack * 0.7;
      t.rough = 0.85;
      t.ao = 1 - crack * 0.6;
      // Snow lodged on each ledge (the top of every stratum) and in the cracks.
      const ledge = smooth(0.75, 0.95, strata) * smooth(0.45, 0.65, fbm(u, v, 8, 3, 223) * 0.5 + 0.5);
      if (ledge > 0) {
        tint(t, SNOW, ledge * 0.9);
        t.h += ledge * 0.3;
        t.rough = lerp(t.rough, 0.7, ledge);
      }
      // The cap.
      const edge = 0.86 + noise(u, 0.5, 10, 227) * 0.03 + noise(u, 0.5, 40, 229) * 0.015;
      if (v > edge) {
        snowTexel(u, v, t, 231);
        t.h += 0.5;
      } else shade(t, 1 - smooth(edge - 0.05, edge, v) * 0.4); // the cap's overhang shades the rock below it
    },
    { size: 512, normal: 8 },
  );
}

/** Bare granite for boulders and the bullwheel house: speckled grains with frost in the hollows. */
export function graniteTexture(): THREE.Texture {
  const grey = hex(0x8a919c);
  const dark = hex(0x3c4048);
  const feldspar = hex(0xc9c3bc);
  return bake(
    'granite',
    (u, v, t) => {
      const n = fbm(u, v, 6, 5, 241) * 0.5 + 0.5;
      const grain = noise(u, v, 160, 243) * 0.5 + 0.5;
      const speck = noise(u, v, 220, 247) * 0.5 + 0.5;
      paint(t, grey, feldspar, smooth(0.6, 0.8, grain) * 0.8);
      tint(t, dark, smooth(0.7, 0.85, speck) * 0.85);
      shade(t, 0.85 + n * 0.25);
      const frost = smooth(0.62, 0.75, fbm(u, v, 5, 3, 251) * 0.5 + 0.5) * (1 - n);
      tint(t, SNOW, frost * 0.8);
      t.h = n * 0.8 + grain * 0.1;
      t.rough = 0.7 + n * 0.15 - frost * 0.1;
      t.ao = 0.7 + n * 0.3;
    },
    { size: 512, normal: 6 },
  );
}

/** Glassy surf ice: cyan-white, with long streaks along u (the ramp's length), trapped bubbles and fine cracks. */
export function iceTexture(): THREE.Texture {
  const deep = hex(0x6fb9dc);
  const pale = hex(0xd2f0fb);
  const crackCol = hex(0x3f8db8);
  return bake(
    'ice',
    (u, v, t) => {
      const flow = fbm(u, v, 1, 4, 261, 6) * 0.5 + 0.5;
      const streak = smooth(0.6, 0.95, ridged(u, v, 1, 3, 263, 24));
      paint(t, deep, pale, flow * 0.7 + streak * 0.3);
      const crack = smooth(0.9, 0.98, ridged(u, v, 4, 3, 269));
      tint(t, crackCol, crack * 0.5);
      const bubble = smooth(0.85, 0.95, noise(u, v, 90, 271) * 0.5 + 0.5);
      tint(t, pale, bubble * 0.5);
      t.h = -crack * 0.5 + flow * 0.1;
      t.rough = 0.04 + crack * 0.2 + (1 - flow) * 0.04;
    },
    { size: 512, normal: 2 },
  );
}

/** Wallrun ice: blue frozen falls with vertical facets and frost along their edges. */
export function iceWallTexture(): THREE.Texture {
  const blue = hex(0x4f97c4);
  const pale = hex(0xb4e2f6);
  return bake(
    'iceWall',
    (u, v, t) => {
      const warp = fbm(u, v, 2, 3, 281, 4) * 0.05;
      const facet = ridged(u + warp, v, 12, 2, 283, 1); // columns run down the wall
      const n = fbm(u, v, 4, 4, 287) * 0.5 + 0.5;
      paint(t, blue, pale, facet * 0.6 + n * 0.4);
      const frost = smooth(0.55, 0.8, noise(u, v, 48, 289, 16) * 0.5 + 0.5) * (1 - facet);
      tint(t, SNOW, frost * 0.6);
      t.h = facet * 0.8 + n * 0.2;
      t.rough = 0.08 + frost * 0.5;
      t.ao = 0.75 + facet * 0.25;
    },
    { size: 512, normal: 6 },
  );
}

/** Groomed piste for slide ramps: corduroy ridges running up the slope (v) and orange marker dashes at the edges. */
export function pisteTexture(): THREE.Texture {
  const cream = hex(0xf7f1e6);
  const groove = hex(0xd9d3c6);
  const marker = hex(0xef7d3c);
  return bake(
    'piste',
    (u, v, t) => {
      const ridge = Math.sin(u * 32 * Math.PI * 2) * 0.5 + 0.5; // 32 cords across a tile
      const n = fbm(u, v, 4, 4, 291) * 0.5 + 0.5;
      paint(t, groove, cream, ridge * 0.7 + n * 0.3);
      t.h = ridge * 0.7 + n * 0.2;
      t.rough = 0.65 + (1 - ridge) * 0.15;
      t.ao = 0.75 + ridge * 0.25;
      // Dashes down both edges, every quarter tile.
      const dash = (u > 0.025 && u < 0.07) || (u > 0.93 && u < 0.975) ? smooth(0.0, 0.01, Math.min((v * 4) % 1 - 0.15, 0.6 - ((v * 4) % 1))) : 0;
      if (dash > 0) {
        tint(t, marker, dash);
        t.rough = 0.5;
        t.h = 0.6;
      }
    },
    { size: 512, normal: 3 },
  );
}

/** Stacked dark logs for the lodge: round, grained, with snow resting on top of each. */
export function logTexture(): THREE.Texture {
  const logs = 5;
  const light = hex(0x8a5a3a);
  const dark = hex(0x3c2416);
  return bake(
    'logs',
    (u, v, t) => {
      const lv = v * logs;
      const i = Math.floor(lv);
      const f = lv - i; // 0 at the log's underside, 1 at its top
      const round = Math.sin(f * Math.PI); // the log's curve
      const grain = noise(u, v, 4, 301 + i, 160) * 0.5 + 0.5;
      const bark = ridged(u + i * 0.37, v, 24, 2, 303, 3);
      paint(t, dark, light, round * 0.6 + grain * 0.2 + bark * 0.2);
      shade(t, 0.55 + round * 0.45);
      t.h = round * 0.8 + bark * 0.15;
      t.rough = 0.8;
      t.ao = 0.35 + round * 0.65;
      // Snow on top of each log.
      const lip = 0.86 + noise(u, i * 0.2, 16, 307) * 0.05;
      const snow = smooth(lip, lip + 0.04, f);
      if (snow > 0) {
        tint(t, SNOW, snow);
        t.h += snow * 0.3;
        t.rough = lerp(t.rough, 0.7, snow);
        t.ao = lerp(t.ao, 1, snow);
      }
    },
    { size: 512, normal: 6 },
  );
}

