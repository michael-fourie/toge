// Procedural textures for the tracks, drawn once per race on canvases. Surfaces come as a set: colour,
// roughness and a normal map derived from a height field, all drawn from the same features so the
// aggregate that's light is also raised, and the tar that's black is also glossy.

import * as THREE from 'three';
import type { Theme } from '../shared/track.ts';

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise that wraps every `p` cells, so a texture built from it tiles. */
function tileNoise(seed: number) {
  const rnd = mulberry(seed);
  const T = new Float32Array(1024).map(() => rnd());
  const at = (x: number, y: number) => T[((x & 31) + ((y & 31) << 5)) & 1023];
  return (x: number, y: number, p: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p;
    const y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const a = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * sx;
    return a + (b - a) * sy;
  };
}

type Ctx = CanvasRenderingContext2D;
interface Layers {
  w: number;
  h: number;
  /** Colour, roughness (grey), height (grey, 128 = flat). */
  c: Ctx;
  r: Ctx;
  h2: Ctx;
}

function canvas(w: number, h: number): Ctx {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

function layers(w: number, h: number): Layers {
  return { w, h, c: canvas(w, h), r: canvas(w, h), h2: canvas(w, h) };
}

/** Draws the same path into all three layers, each with its own paint. */
function paint3(L: Layers, path: (g: Ctx) => void, c: string, r: string, h: string, fill = true, width = 1) {
  for (const [g, s] of [
    [L.c, c],
    [L.r, r],
    [L.h2, h],
  ] as const) {
    g.save();
    g.beginPath(); // rect() and friends add to the current path; never refill the last shape
    path(g);
    if (fill) {
      g.fillStyle = s;
      g.fill();
    } else {
      g.strokeStyle = s;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
    }
    g.restore();
  }
}

/** A normal map from a height canvas (wraps in v, so it tiles down the road). */
function normalFrom(h: Ctx, w: number, hh: number, strength: number, wrapU = false): THREE.CanvasTexture {
  const src = h.getImageData(0, 0, w, hh).data;
  const out = canvas(w, hh);
  const img = out.createImageData(w, hh);
  const H = (x: number, y: number) => {
    x = wrapU ? (x + w) % w : Math.max(0, Math.min(w - 1, x));
    y = (y + hh) % hh;
    return src[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = 128 - (dx / l) * 127;
      img.data[i + 1] = 128 + (dy / l) * 127;
      img.data[i + 2] = 128 + (1 / l) * 127;
      img.data[i + 3] = 255;
    }
  out.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(out.canvas);
}

export interface Surface {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

function finish(L: Layers, strength: number, wrapU: boolean, aniso: number): Surface {
  const map = new THREE.CanvasTexture(L.c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(L.r.canvas);
  const normalMap = normalFrom(L.h2, L.w, L.h, strength, wrapU);
  for (const t of [map, roughnessMap, normalMap]) {
    t.wrapS = wrapU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
  }
  return { map, roughnessMap, normalMap };
}

/** What lies on the verge and the shoulder: needles, leaves, petals, sand. */
const LITTER: Record<Theme, { colors: string[]; n: number; sand?: string }> = {
  alpine: { colors: ['#5b4a32', '#6e6656', '#3d3a33'], n: 900 },
  night: { colors: ['#4d4232', '#5b5850', '#34322d'], n: 900 },
  coast: { colors: ['#b9a684', '#8f8670'], n: 500, sand: 'rgba(196,176,136,' },
  desert: { colors: ['#a0613a', '#b98a5e', '#7a4a2e'], n: 600, sand: 'rgba(190,128,82,' },
  autumn: { colors: ['#c4471e', '#e07a26', '#e8ad2e', '#9e2a1a', '#6b4a24'], n: 1700 },
  spring: { colors: ['#f6c3d3', '#fbdbe6', '#ee9fb8', '#ffffff'], n: 1500 },
  city: { colors: ['#3a3a3c', '#55524c', '#26272a'], n: 500 },
};

/**
 * The road ribbon, across: verge | shoulder (with a concrete gutter at its outer edge) | asphalt with
 * edge lines and the centre line | mirrored. Down the road it covers `ROAD_TILE` metres and repeats.
 * Japanese passes get a solid yellow centre line (no overtaking), the rest a dashed white one; a circuit (`circuit`)
 * has only its edge lines, like a race track.
 */
export const ROAD_TILE = 24;
export function asphalt(theme: Theme, seed: number, aniso: number, circuit = false, lanes = 0): Surface {
  // `lanes`: a one-way highway with this many lanes (0: not one).
  const highway = lanes > 0;
  const W = 1024;
  const H = 2048;
  const L = layers(W, H);
  const rnd = mulberry(seed);
  const pxPerM = H / ROAD_TILE;
  const R0 = 0.2 * W;
  const R1 = 0.8 * W;
  // Base fills: verge dirt, shoulder asphalt, road asphalt.
  const zone = (x0: number, x1: number, c: string, r: number, h: number) => {
    for (const x of [x0, W - x1]) {
      L.c.fillStyle = c;
      L.c.fillRect(x, 0, x1 - x0, H);
      L.r.fillStyle = `rgb(${r},${r},${r})`;
      L.r.fillRect(x, 0, x1 - x0, H);
      L.h2.fillStyle = `rgb(${h},${h},${h})`;
      L.h2.fillRect(x, 0, x1 - x0, H);
    }
  };
  const lit = LITTER[theme];
  const dirt = theme === 'desert' ? '#8a5a3c' : theme === 'coast' ? '#8d8068' : '#4a4436';
  zone(0, 0.12 * W, dirt, 240, 120);
  zone(0.12 * W, R0, '#323234', 225, 128);
  L.c.fillStyle = '#2a2b2d';
  L.c.fillRect(R0, 0, R1 - R0, H);
  L.r.fillStyle = 'rgb(228,228,228)';
  L.r.fillRect(R0, 0, R1 - R0, H);
  L.h2.fillStyle = 'rgb(128,128,128)';
  L.h2.fillRect(R0, 0, R1 - R0, H);

  // The concrete gutter at the outer edge of the shoulder, with joints every 2 m.
  const gw = 0.022 * W;
  for (const gx of [0.12 * W, W - 0.12 * W - gw]) {
    paint3(L, (g) => g.rect(gx, 0, gw, H), '#7b7870', 'rgb(235,235,235)', 'rgb(118,118,118)');
    for (let y = 0; y < H; y += pxPerM * 2) paint3(L, (g) => g.rect(gx, y, gw, 2), 'rgba(20,20,20,0.7)', 'rgb(250,250,250)', 'rgb(100,100,100)');
  }

  // Patches of newer, blacker asphalt with a sealed seam: ragged, cut across a lane.
  for (let i = 0; i < 4; i++) {
    const x = R0 + rnd() * (R1 - R0 - 200);
    const y = rnd() * H;
    const w = 90 + rnd() * 200;
    const h = 140 + rnd() * 420;
    const pts: [number, number][] = [];
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
      const [ex, ey] = t < 0.25 ? [x + w * t * 4, y] : t < 0.5 ? [x + w, y + h * (t - 0.25) * 4] : t < 0.75 ? [x + w * (1 - (t - 0.5) * 4), y + h] : [x, y + h * (1 - (t - 0.75) * 4)];
      pts.push([ex + (rnd() - 0.5) * 14, ey + (rnd() - 0.5) * 14]);
    }
    const fresh = rnd() < 0.6;
    for (const dy of [0, -H, H]) {
      const p = (g: Ctx) => {
        pts.forEach(([px, py], k) => (k ? g.lineTo(px, py + dy) : g.moveTo(px, py + dy)));
        g.closePath();
      };
      paint3(L, p, fresh ? 'rgba(14,14,16,0.42)' : 'rgba(70,70,72,0.22)', 'rgba(200,200,200,0.5)', 'rgba(132,132,132,1)');
      paint3(L, p, 'rgba(8,8,8,0.45)', 'rgb(120,120,120)', 'rgb(134,134,134)', false, 2);
    }
  }

  // Cracks, and the tar snakes that seal them (black, glossy, a little proud of the surface).
  const walk = (x: number, y: number, len: number, wob: number) => {
    const pts: [number, number][] = [[x, y]];
    let a = rnd() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * wob;
      x += Math.cos(a) * 9;
      y += Math.sin(a) * 9;
      // Cracks stay in the asphalt: turn back off the shoulder.
      if (x < R0 + 6 || x > R1 - 6) {
        a = Math.PI - a;
        x = Math.max(R0 + 6, Math.min(R1 - 6, x));
      }
      pts.push([x, y]);
    }
    return (g: Ctx) => {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    };
  };
  for (let i = 0; i < 26; i++) {
    const p = walk(R0 + rnd() * (R1 - R0), rnd() * H, 10 + rnd() * 40, 1.1);
    paint3(L, p, 'rgba(8,8,8,0.6)', 'rgb(245,245,245)', 'rgba(128,128,128,0)', false, 1.2);
  }
  for (let i = 0; i < 9; i++) {
    const x = R0 + rnd() * (R1 - R0);
    const y = rnd() * H;
    for (const dy of [0, -H, H]) {
      const p = walk(x, y + dy, 30 + rnd() * 60, 0.7);
      paint3(L, p, 'rgba(6,6,7,0.85)', 'rgb(196,196,196)', 'rgba(134,134,134,0.5)', false, 4 + rnd() * 4);
    }
  }

  // Rubber laid down in the wheel tracks, and the odd pair of drift marks sweeping across.
  for (const u of [0.31, 0.41, 0.59, 0.69]) {
    const grad = L.c.createLinearGradient(u * W - 30, 0, u * W + 30, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    L.c.fillStyle = grad;
    L.c.fillRect(u * W - 30, 0, 60, H);
    const rg = L.r.createLinearGradient(u * W - 30, 0, u * W + 30, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    L.r.fillStyle = rg;
    L.r.fillRect(u * W - 30, 0, 60, H);
  }
  for (let i = 0; i < 3; i++) {
    const y0 = rnd() * H;
    const x0 = R0 + 60 + rnd() * (R1 - R0 - 120);
    const bend = (rnd() - 0.5) * 300;
    const len = 500 + rnd() * 600;
    for (const off of [0, 70 + rnd() * 20])
      for (const dy of [0, -H, H]) {
        const p = (g: Ctx) => {
          g.beginPath();
          g.moveTo(x0 + off, y0 + dy);
          g.quadraticCurveTo(x0 + off + bend, y0 + dy + len / 2, x0 + off + bend * 0.3, y0 + dy + len);
        };
        for (let k = 0; k < 3; k++) paint3(L, p, `rgba(5,5,5,${0.07 + k * 0.03})`, 'rgba(0,0,0,0.08)', 'rgba(128,128,128,0)', false, 26 - k * 8);
      }
  }

  // Paint: edge lines and the centre line, worn by tyres (holes knocked out below).
  const line = (x: number, y: number, w: number, h: number, col: string) => paint3(L, (g) => g.rect(x, y, w, h), col, 'rgb(150,150,150)', 'rgb(140,140,140)');
  const lw = 0.15 * pxPerM;
  line(R0 + 10, 0, lw, H, '#e8e6dc');
  line(R1 - 10 - lw, 0, lw, H, '#e8e6dc');
  const yellow = theme !== 'coast' && theme !== 'desert';
  if (circuit) {
    // No centre line or lanes on a race track.
  } else if (highway) {
    // A one-way highway: dashed white lines between all its lanes (the middle one is just another of them).
    for (let k = 1; k < lanes; k++) for (let y = 0; y < H; y += pxPerM * 12) line(R0 + ((R1 - R0) * k) / lanes - lw / 2, y, lw, pxPerM * 5, '#e8e6dc');
  } else if (yellow) line(W / 2 - lw / 2, 0, lw, H, '#e8a321');
  else for (let y = 0; y < H; y += pxPerM * 8) line(W / 2 - lw / 2, y, lw, pxPerM * 3, '#e8e6dc');
  // City streets have four lanes: dashed white lines between each pair.
  if (theme === 'city' && !highway && !circuit) for (const lx of [R0 + (R1 - R0) / 4, R0 + ((R1 - R0) * 3) / 4]) for (let y = 0; y < H; y += pxPerM * 12) line(lx - lw / 2, y, lw, pxPerM * 5, '#e8e6dc');
  // Worn paint: chips of asphalt showing through every line.
  for (const lx of circuit ? [R0 + 10, R1 - 10 - lw] : [R0 + 10, R1 - 10 - lw, W / 2 - lw / 2])
    for (let i = 0; i < 260; i++) {
      const x = lx + rnd() * lw;
      const y = rnd() * H;
      const r = 0.8 + rnd() * 2.6;
      const ry = r * (1 + rnd());
      paint3(L, (g) => g.ellipse(x, y, r, ry, 0, 0, Math.PI * 2), 'rgba(42,43,45,0.85)', 'rgb(214,214,214)', 'rgb(126,126,126)');
    }

  // Litter on the verge and shoulder; drifted sand by the sea and in the desert.
  if (lit.sand)
    for (const x of [0, W]) {
      const grad = L.c.createLinearGradient(x, 0, x === 0 ? R0 : R1, 0);
      grad.addColorStop(0, lit.sand + '0.85)');
      grad.addColorStop(0.55, lit.sand + '0.35)');
      grad.addColorStop(1, lit.sand + '0)');
      L.c.fillStyle = grad;
      L.c.fillRect(Math.min(x, x === 0 ? R0 : R1), 0, Math.abs((x === 0 ? R0 : R1) - x) + 20, H);
    }
  for (let i = 0; i < lit.n; i++) {
    const side = rnd() < 0.5;
    const d = Math.pow(rnd(), 1.8) * (R0 + 40);
    const x = side ? d : W - d;
    const y = rnd() * H;
    const s = 2 + rnd() * 5;
    const col = lit.colors[Math.floor(rnd() * lit.colors.length)];
    const a = rnd() * Math.PI;
    paint3(L, (g) => (g.translate(x, y), g.rotate(a), g.beginPath(), g.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2)), col, 'rgb(230,230,230)', 'rgb(150,150,150)');
  }

  // Per pixel: aggregate (light stones that stand proud), and slow blotches of wear.
  const noise = tileNoise(seed + 1);
  const ci = L.c.getImageData(0, 0, W, H);
  const ri = L.r.getImageData(0, 0, W, H);
  const hi = L.h2.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = rnd();
      const blot = noise(x / 64, y / 64, 32) * 0.6 + noise(x / 16, y / 16, 128) * 0.4;
      const stone = n > 0.93 ? (n - 0.93) * 14 : 0;
      const pit = n < 0.04 ? 1 : 0;
      const k = 0.86 + blot * 0.26 + stone * 0.3 - pit * 0.35 + (rnd() - 0.5) * 0.12;
      ci.data[i] = Math.min(255, ci.data[i] * k + stone * 9);
      ci.data[i + 1] = Math.min(255, ci.data[i + 1] * k + stone * 9);
      ci.data[i + 2] = Math.min(255, ci.data[i + 2] * k + stone * 8);
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = Math.max(0, Math.min(255, hi.data[i] + stone * 70 - pit * 60 + (blot - 0.5) * 18));
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = Math.max(0, Math.min(255, ri.data[i] - stone * 50 + (blot - 0.5) * 30));
    }
  L.c.putImageData(ci, 0, 0);
  L.r.putImageData(ri, 0, 0);
  L.h2.putImageData(hi, 0, 0);
  return finish(L, 1.5, false, aniso);
}

/**
 * Plain paving that tiles both ways (the open world's roads: their lines are drawn separately, so any width works):
 * asphalt with patches, cracks and aggregate, or `concrete` slabs with joints (the runway). One tile is `TARMAC_TILE` m.
 */
export const TARMAC_TILE = 8;
export function tarmac(seed: number, aniso: number, concrete = false): Surface {
  const S = 512;
  const L = layers(S, S);
  const rnd = mulberry(seed + 51);
  const base = concrete ? '#8a877f' : '#45464a';
  L.c.fillStyle = base;
  L.c.fillRect(0, 0, S, S);
  L.r.fillStyle = concrete ? 'rgb(215,215,215)' : 'rgb(228,228,228)';
  L.r.fillRect(0, 0, S, S);
  L.h2.fillStyle = 'rgb(128,128,128)';
  L.h2.fillRect(0, 0, S, S);
  const wrap = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) draw(dx, dy);
  };
  if (concrete) {
    // Slab joints every half tile, and the odd stain.
    for (const k of [0, S / 2]) {
      paint3(L, (g) => g.rect(k - 1, 0, 3, S), 'rgba(30,30,28,0.7)', 'rgb(250,250,250)', 'rgb(90,90,90)');
      paint3(L, (g) => g.rect(0, k - 1, S, 3), 'rgba(30,30,28,0.7)', 'rgb(250,250,250)', 'rgb(90,90,90)');
    }
    for (let i = 0; i < 10; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 10 + rnd() * 50;
      wrap((dx, dy) => paint3(L, (g) => g.ellipse(x + dx, y + dy, r, r * (0.4 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2), `rgba(20,18,16,${0.05 + rnd() * 0.12})`, 'rgba(200,200,200,0.3)', 'rgba(128,128,128,0)'));
    }
  } else
    for (let i = 0; i < 3; i++) {
      // Patches of newer, blacker asphalt.
      const x = rnd() * S;
      const y = rnd() * S;
      const w = 60 + rnd() * 160;
      const h = 60 + rnd() * 200;
      wrap((dx, dy) => paint3(L, (g) => g.rect(x + dx, y + dy, w, h), rnd() < 0.6 ? 'rgba(12,12,14,0.2)' : 'rgba(90,90,92,0.14)', 'rgba(200,200,200,0.5)', 'rgba(132,132,132,1)'));
    }
  // Cracks.
  for (let i = 0; i < (concrete ? 8 : 14); i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let a = rnd() * Math.PI * 2;
    const pts: [number, number][] = [[x, y]];
    for (let k = 0; k < 10 + rnd() * 25; k++) {
      a += (rnd() - 0.5) * 1.1;
      pts.push([(x += Math.cos(a) * 8), (y += Math.sin(a) * 8)]);
    }
    wrap((dx, dy) =>
      paint3(
        L,
        (g) => {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        },
        'rgba(8,8,8,0.55)',
        'rgb(245,245,245)',
        'rgba(110,110,110,1)',
        false,
        1.2,
      ),
    );
  }
  const noise = tileNoise(seed + 2);
  const ci = L.c.getImageData(0, 0, S, S);
  const ri = L.r.getImageData(0, 0, S, S);
  const hi = L.h2.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const n = rnd();
      const blot = noise(x / 64, y / 64, 8) * 0.6 + noise(x / 16, y / 16, 32) * 0.4;
      const stone = n > 0.93 ? (n - 0.93) * 14 : 0;
      const k = 0.86 + blot * 0.26 + stone * (concrete ? 0.1 : 0.3) + (rnd() - 0.5) * 0.12;
      for (let j = 0; j < 3; j++) ci.data[i + j] = Math.min(255, ci.data[i + j] * k + stone * 9);
      hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = Math.max(0, Math.min(255, hi.data[i] + stone * 60 + (blot - 0.5) * 18));
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = Math.max(0, Math.min(255, ri.data[i] - stone * 40 + (blot - 0.5) * 30));
    }
  L.c.putImageData(ci, 0, 0);
  L.r.putImageData(ri, 0, 0);
  L.h2.putImageData(hi, 0, 0);
  return finish(L, 1.5, true, aniso);
}

/** Loose gravel: stones with shadows, packed ruts where the cars go. Same columns as the road. */
export function gravel(theme: Theme, seed: number, aniso: number): Surface {
  const W = 512;
  const H = 1024;
  const L = layers(W, H);
  const rnd = mulberry(seed + 7);
  const base = theme === 'desert' ? [150, 96, 62] : theme === 'coast' ? [150, 136, 110] : [120, 108, 92];
  const rgb = (k: number) => `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
  L.c.fillStyle = rgb(0.8);
  L.c.fillRect(0, 0, W, H);
  L.r.fillStyle = 'rgb(240,240,240)';
  L.r.fillRect(0, 0, W, H);
  L.h2.fillStyle = 'rgb(110,110,110)';
  L.h2.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const u = x / W;
    const rut = Math.exp(-(((u - 0.38) / 0.06) ** 2)) + Math.exp(-(((u - 0.62) / 0.06) ** 2));
    if (rnd() < rut * 0.6) continue; // the ruts are packed bare
    const s = 1.5 + rnd() * 4;
    const k = 0.7 + rnd() * 0.6;
    const a = rnd() * Math.PI;
    for (const dy of y < 8 ? [0, H] : y > H - 8 ? [0, -H] : [0]) {
      const p = (g: Ctx) => (g.translate(x, y + dy), g.rotate(a), g.beginPath(), g.ellipse(0, 0, s, s * 0.7, 0, 0, Math.PI * 2));
      paint3(L, (g) => (g.translate(1.5, 2), p(g)), 'rgba(0,0,0,0.35)', 'rgb(240,240,240)', 'rgb(90,90,90)');
      paint3(L, p, rgb(k), 'rgb(200,200,200)', `rgb(${150 + s * 15},${150 + s * 15},${150 + s * 15})`);
    }
  }
  return finish(L, 3, false, aniso);
}

/**
 * Ground detail, tiled over the terrain under its vertex colours: near-white, so it only shades. Grass
 * blades and clumps on green themes, ripples and pebbles in the desert.
 */
export function ground(theme: Theme, seed: number, aniso: number): Surface {
  const S = 512;
  const L = layers(S, S);
  const rnd = mulberry(seed + 13);
  const sandy = theme === 'desert' || theme === 'coast';
  L.c.fillStyle = '#d4d4d4';
  L.c.fillRect(0, 0, S, S);
  L.r.fillStyle = 'rgb(245,245,245)';
  L.r.fillRect(0, 0, S, S);
  L.h2.fillStyle = 'rgb(128,128,128)';
  L.h2.fillRect(0, 0, S, S);
  const noise = tileNoise(seed + 5);
  const wrap = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) draw(x + dx, y + dy);
  };
  if (sandy) {
    // Wind ripples: wavy bands, light crest and dark trough.
    for (let y = 0; y < S; y += 9) {
      for (const [off, c, h] of [
        [0, 'rgba(255,255,255,0.35)', 'rgb(160,160,160)'],
        [3, 'rgba(0,0,0,0.12)', 'rgb(100,100,100)'],
      ] as const) {
        const p = (g: Ctx) => {
          g.beginPath();
          for (let x = 0; x <= S; x += 8) g.lineTo(x, y + off + Math.sin((x / S) * Math.PI * 4 + y * 0.13) * 4 + noise(x / 32, y / 32, 16) * 6);
        };
        paint3(L, p, c, 'rgb(245,245,245)', h, false, 2.5);
      }
    }
  } else {
    // Grass: thousands of short blades, light and dark, leaning a little.
    for (let i = 0; i < 14000; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const len = 3 + rnd() * 7;
      const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
      const v = rnd() < 0.5 ? 255 : 120;
      const col = `rgba(${v},${v},${v},${0.18 + rnd() * 0.25})`;
      wrap(x, y, (px, py) => {
        const p = (g: Ctx) => (g.beginPath(), g.moveTo(px, py), g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len));
        paint3(L, p, col, 'rgb(240,240,240)', v > 200 ? 'rgb(170,170,170)' : 'rgb(95,95,95)', false, 1.2);
      });
    }
  }
  // Pebbles and dark clumps everywhere.
  for (let i = 0; i < 500; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const s = 1 + rnd() * 3;
    const v = 140 + rnd() * 110;
    wrap(x, y, (px, py) => paint3(L, (g) => (g.beginPath(), g.arc(px, py, s, 0, Math.PI * 2)), `rgb(${v},${v},${v * 0.96})`, 'rgb(200,200,200)', 'rgb(190,190,190)'));
  }
  const ci = L.c.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const k = 0.8 + noise(x / 32, y / 32, 16) * 0.25 + noise(x / 8, y / 8, 64) * 0.12 + (rnd() - 0.5) * 0.08;
      for (let j = 0; j < 3; j++) ci.data[i + j] = Math.min(255, ci.data[i + j] * k);
    }
  L.c.putImageData(ci, 0, 0);
  return finish(L, sandy ? 2 : 2.6, true, aniso);
}

/** Weathered stone: strata, cracks, lichen. Grey, tinted by the material colour. */
export function stone(seed: number): Surface {
  const S = 256;
  const L = layers(S, S);
  const rnd = mulberry(seed + 21);
  const noise = tileNoise(seed + 9);
  const ci = L.c.createImageData(S, S);
  const hi = L.h2.createImageData(S, S);
  const ri = L.r.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const strata = Math.sin((y / S) * Math.PI * 14 + noise(x / 32, y / 32, 8) * 5) * 0.5 + 0.5;
      const n = noise(x / 16, y / 16, 16) * 0.6 + noise(x / 4, y / 4, 64) * 0.4;
      const v = 150 + strata * 50 + n * 60 + (rnd() - 0.5) * 20;
      const lichen = noise(x / 24 + 7, y / 24, 11) > 0.72 ? 1 : 0;
      ci.data.set([v * (1 - lichen * 0.15), v * (1 + lichen * 0.05), v * (1 - lichen * 0.3), 255], i);
      const h = 90 + strata * 40 + n * 90;
      hi.data.set([h, h, h, 255], i);
      const r = 220 + n * 30;
      ri.data.set([r, r, r, 255], i);
    }
  L.c.putImageData(ci, 0, 0);
  L.h2.putImageData(hi, 0, 0);
  L.r.putImageData(ri, 0, 0);
  for (let i = 0; i < 14; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    const p = (g: Ctx) => {
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 12; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += rnd() * 14));
    };
    paint3(L, p, 'rgba(30,30,30,0.6)', 'rgb(255,255,255)', 'rgb(40,40,40)', false, 1.5);
  }
  return finish(L, 3, true, 4);
}

/**
 * House walls: 4 bays by 4 storeys (16 x 12 m) of plaster with windows. Returns the colour map (near
 * white plaster, so each house's colour tints it) and an emissive map with a random few windows lit.
 */
export const FACADE_W = 16;
export const FACADE_H = 12;
export function facade(seed: number, theme: Theme): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const W = 512;
  const H = 384;
  const rnd = mulberry(seed + 31);
  const c = canvas(W, H);
  const e = canvas(W, H);
  const img = c.createImageData(W, H);
  const noise = tileNoise(seed + 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Plaster, streaked by rain from the top of each storey down.
      const streak = noise(x / 3, (y % 96) / 48, 64) * ((y % 96) / 96) * 0.15;
      const v = 232 - streak * 255 + (noise(x / 16, y / 16, 32) - 0.5) * 18 + (rnd() - 0.5) * 10;
      img.data.set([v, v * 0.98, v * 0.95, 255], (y * W + x) * 4);
    }
  c.putImageData(img, 0, 0);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const bayW = W / 4;
  const stH = H / 4;
  const shoji = theme !== 'coast' && theme !== 'desert';
  for (let sy = 0; sy < 4; sy++) {
    // A band between storeys.
    c.fillStyle = 'rgba(60,50,40,0.25)';
    c.fillRect(0, sy * stH, W, 4);
    for (let bx = 0; bx < 4; bx++) {
      if (rnd() < 0.15) continue;
      const wx = bx * bayW + bayW * 0.22;
      const wy = sy * stH + stH * 0.25;
      const ww = bayW * 0.56;
      const wh = stH * 0.5;
      c.fillStyle = '#3a3229';
      c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const glass = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glass.addColorStop(0, '#2a3440');
      glass.addColorStop(0.5, '#46525e');
      glass.addColorStop(1, '#1b2128');
      c.fillStyle = glass;
      c.fillRect(wx, wy, ww, wh);
      c.fillStyle = '#3a3229';
      c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillRect(wx - 4, wy + wh + 3, ww + 8, 3); // sill
      if (rnd() < 0.45) {
        // Lit: warm lamplight, through shoji grids on the Japanese passes.
        const warm = rnd() < 0.7 ? '#ffb45a' : '#fff1c9';
        e.fillStyle = warm;
        e.fillRect(wx, wy, ww, wh);
        if (shoji) {
          e.fillStyle = 'rgba(40,20,0,0.85)';
          for (let k = 1; k < 4; k++) e.fillRect(wx + (ww * k) / 4 - 1, wy, 2, wh);
          for (let k = 1; k < 3; k++) e.fillRect(wx, wy + (wh * k) / 3 - 1, ww, 2);
        }
        e.fillStyle = 'rgba(0,0,0,0.5)';
        e.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.CanvasTexture(e.canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, glow]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, glow };
}

/** Roof tiles: rows of rounded tiles running along the ridge (u round the prism, v along it). */
export function roofTiles(): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const g = canvas(W, H);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 16) {
    const grad = g.createLinearGradient(0, y, 0, y + 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#b8b8b8');
    grad.addColorStop(1, '#4a4a4a');
    g.fillStyle = grad;
    g.fillRect(0, y, W, 16);
    for (let x = (y / 16) % 2 ? 0 : 12; x < W; x += 24) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y, 2, 16);
    }
  }
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A gantry banner: a dark panel, the word in neon with its Japanese below, chequers at the ends. */
export function banner(text: string, jp: string, neon: string, chequer: boolean): THREE.CanvasTexture {
  const W = 1024;
  const H = 128;
  const g = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#15171d');
  bg.addColorStop(1, '#07080b');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (chequer)
    for (const x0 of [0, W - 128])
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          g.fillStyle = (i + j) % 2 ? '#0b0b0b' : '#f2f2f2';
          g.fillRect(x0 + i * 16, j * 16, 16, 16);
        }
  g.strokeStyle = neon;
  g.lineWidth = 3;
  g.strokeRect(chequer ? 140 : 12, 10, chequer ? W - 280 : W - 24, H - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = neon;
  g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.font = 'italic 900 70px system-ui, sans-serif';
  g.fillText(text, W / 2 - 60, 66);
  g.shadowBlur = 10;
  g.fillStyle = neon;
  g.font = 'bold 34px system-ui, sans-serif';
  g.fillText(jp, W / 2 + (text.length * 24) + 10, 70);
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A vending machine's lit front: a brand panel, three shelves of drinks, buttons, the slot. */
export function vendingFront(seed: number, brand: string): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const rnd = mulberry(seed);
  const g = canvas(W, H);
  g.fillStyle = brand;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f8fbff';
  g.fillRect(8, 10, W - 16, 150);
  const cans = ['#d7263d', '#1b98e0', '#f4d35e', '#2e933c', '#ee964b', '#ffffff', '#3d348b', '#111111'];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 17;
      const y = 18 + row * 46;
      g.fillStyle = cans[Math.floor(rnd() * cans.length)];
      g.fillRect(x, y, 12, 30);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(x + 2, y + 2, 2, 26);
      g.fillStyle = '#2b9d4a';
      g.fillRect(x + 2, y + 34, 8, 4); // the little lit button
    }
  g.fillStyle = 'rgba(0,0,0,0.75)';
  g.fillRect(14, 172, 40, 26);
  g.fillStyle = '#f2f2f2';
  g.fillRect(70, 172, 44, 12);
  g.fillStyle = '#0d0d0d';
  g.fillRect(14, 214, W - 28, 28);
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * City towers: a curtain wall, 4 bays by 4 floors (TOWER_W x TOWER_H m) of glass between mullions and
 * spandrels. The colour map is near white (each tower's colour tints it); the emissive map lights about
 * half the offices, whole floors at a time now and then, in cool and warm whites.
 */
export const TOWER_W = 14;
export const TOWER_H = 14;
export function towerFacade(seed: number): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const W = 512;
  const H = 512;
  const rnd = mulberry(seed + 77);
  const c = canvas(W, H);
  const e = canvas(W, H);
  c.fillStyle = '#d8d8d8';
  c.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const bay = W / 8;
  const floor = H / 4;
  for (let f = 0; f < 4; f++) {
    const lit = rnd() < 0.25 ? 1 : rnd() < 0.3 ? 0 : 0.5;
    const tone = rnd() < 0.6 ? '#dfe9ff' : '#ffd9a0';
    for (let b = 0; b < 8; b++) {
      const x = b * bay + 3;
      const y = f * floor + floor * 0.2;
      const w = bay - 6;
      const h = floor * 0.72;
      const glass = c.createLinearGradient(x, y, x + w, y + h);
      glass.addColorStop(0, '#2c3846');
      glass.addColorStop(0.6, '#4a5a6c');
      glass.addColorStop(1, '#1c242e');
      c.fillStyle = glass;
      c.fillRect(x, y, w, h);
      if (rnd() < lit) {
        e.fillStyle = tone;
        e.globalAlpha = 0.55 + rnd() * 0.45;
        e.fillRect(x, y, w, h);
        // Blinds half down, a desk lamp in the corner.
        e.globalAlpha = 1;
        e.fillStyle = 'rgba(0,0,0,0.55)';
        e.fillRect(x, y, w, h * rnd() * 0.5);
      }
    }
  }
  const map = new THREE.CanvasTexture(c.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.CanvasTexture(e.canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, glow]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, glow };
}

/** Upright neon signs, NEON_SIGNS of them side by side: glowing letters stacked down a dark board with a coloured rim. */
export const NEON_SIGNS = 8;
export function neonSigns(): THREE.CanvasTexture {
  const CW = 128;
  const H = 512;
  const g = canvas(CW * NEON_SIGNS, H);
  const words = ['RAMEN', 'HOTEL', 'BAR', 'KARAOKE', 'SUSHI', 'ARCADE', '24H', 'GARAGE'];
  const colours = ['#ff2d7a', '#29e0ff', '#ffd23a', '#b04dff', '#ff5a1f', '#39ff8a', '#ff2d2d', '#4d7dff'];
  g.fillStyle = '#000';
  g.fillRect(0, 0, CW * NEON_SIGNS, H);
  words.forEach((word, i) => {
    const x = i * CW;
    const col = colours[i];
    g.fillStyle = '#07070a';
    g.fillRect(x + 8, 8, CW - 16, H - 16);
    g.strokeStyle = col;
    g.lineWidth = 6;
    g.shadowColor = col;
    g.shadowBlur = 14;
    g.strokeRect(x + 14, 14, CW - 28, H - 28);
    g.fillStyle = col;
    const step = (H - 60) / word.length;
    g.font = `bold ${Math.min(76, step * 0.9)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < word.length; k++) g.fillText(word[k], x + CW / 2, 30 + step * (k + 0.5));
    g.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
