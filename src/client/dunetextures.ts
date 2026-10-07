import * as THREE from 'three';
import { blobs, canvas, rng, toTexture } from './textures.ts';

// Procedural textures for Dune Village: sun-warmed sand, sandstone blocks, ochre mud-brick plaster, packed-clay roofs,
// rippled dune sand for slide ramps, turquoise glazed tile for the aqueduct surf and striped awning cloth. No image assets.
// Everything tiles: shapes that cross an edge are drawn again on the other side.

type R = THREE.WebGLRenderer;
type Ctx = CanvasRenderingContext2D;

/** Runs `fn(dx, dy)` at the 9 wrapped offsets so whatever it draws tiles. */
const wrap = (S: number, fn: (dx: number, dy: number) => void) => {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
};

const speckle = (g: Ctx, S: number, r: () => number, n: number, colors: string[], alpha: number, size = 2) => {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(r() * S, r() * S, size * (0.5 + r()), size * (0.5 + r()));
  }
  g.globalAlpha = 1;
};

/** Soft wavy lines across the tile (wind ripples), `n` of them, each a full period wide so it wraps. */
function ripples(g: Ctx, S: number, r: () => number, n: number, color: string, width: number, alpha: number, amp: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const y0 = ((i + r() * 0.4) / n) * S;
    const ph = r() * Math.PI * 2;
    const k = 1 + Math.floor(r() * 2);
    g.globalAlpha = alpha * (0.6 + r() * 0.4);
    for (const dy of [-S, 0, S]) {
      g.beginPath();
      for (let x = 0; x <= S; x += 4) {
        const y = y0 + dy + Math.sin((x / S) * Math.PI * 2 * k + ph) * amp + Math.sin((x / S) * Math.PI * 6 + ph * 2) * amp * 0.25;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
}

/** The town's ground: warm sand with faint ripples, pebbles and footprint-soft shading. */
export function sandTexture(renderer: R): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(301);
  g.fillStyle = '#e9c792';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 90, ['#efd2a0', '#dfb87f', '#f3dcb0', '#d9ae74'], [20, 80], [0.18, 0.4]);
  ripples(g, S, r, 9, '#d4a96e', 3, 0.35, 10);
  ripples(g, S, r, 9, '#f8e4bd', 2, 0.35, 10);
  speckle(g, S, r, 900, ['#b88d5c', '#a27a4e', '#fff2d6'], 0.5, 2);
  return toTexture(c, renderer);
}

/** Dune sand on slide ramps: deeper apricot with bold ripple bands across the slope, so a slope reads as "slide". */
export function duneTexture(renderer: R): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(307);
  g.fillStyle = '#eba868';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 30, ['#f2b97c', '#e09a5b', '#f6c58e'], [14, 40], [0.25, 0.45]);
  ripples(g, S, r, 6, '#c97c43', 6, 0.55, 6);
  ripples(g, S, r, 6, '#fbd9a6', 4, 0.6, 6);
  speckle(g, S, r, 300, ['#b06d3a', '#ffe8c4'], 0.5, 2);
  return toTexture(c, renderer);
}

/** Big honey-coloured sandstone blocks in courses: the town wall, towers and aqueduct arches. */
export function sandstoneTexture(renderer: R): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(311);
  g.fillStyle = '#b98c5a';
  g.fillRect(0, 0, S, S);
  const rows = 5;
  const rh = S / rows;
  for (let row = 0; row < rows; row++) {
    let x = row % 2 ? -rh * 0.6 : 0;
    const end = x + S;
    while (x < end - 1) {
      const w = Math.min(rh * (1.1 + r() * 0.9), end - x);
      g.fillStyle = ['#e2b97f', '#d8ad72', '#e8c48d', '#d2a46b', '#ddb47a'][Math.floor(r() * 5)];
      for (const dx of [-S, 0, S]) g.fillRect(x + dx + 3, row * rh + 3, w - 6, rh - 6);
      // A highlight along each block's top edge, a shadow along the bottom: chunky, hand-cut stone.
      g.globalAlpha = 0.35;
      g.fillStyle = '#f7dcae';
      for (const dx of [-S, 0, S]) g.fillRect(x + dx + 3, row * rh + 3, w - 6, 5);
      g.fillStyle = '#a77a49';
      for (const dx of [-S, 0, S]) g.fillRect(x + dx + 3, row * rh + rh - 9, w - 6, 6);
      g.globalAlpha = 1;
      x += w;
    }
  }
  blobs(g, S, S, r, 70, ['#c99a62', '#f0d2a0', '#b7854f'], [10, 46], [0.1, 0.25]);
  speckle(g, S, r, 700, ['#9c6f40', '#fff0d0'], 0.35, 2);
  return toTexture(c, renderer);
}

/** Ochre lime plaster washed thin over mud-brick: the brick courses show faintly through. House walls and low walls. */
export function mudbrickTexture(renderer: R): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(317);
  g.fillStyle = '#e8c89a';
  g.fillRect(0, 0, S, S);
  // Bricks first, then the plaster wash over them, so they only ghost through.
  const bh = 32;
  const bw = 64;
  for (let row = 0; row < S / bh; row++)
    for (let col = -1; col < S / bw + 1; col++) {
      g.fillStyle = ['#d9ae7c', '#cf9f6c', '#e0b685'][Math.floor(r() * 3)];
      g.fillRect(col * bw + (row % 2 ? bw / 2 : 0) + 3, row * bh + 3, bw - 6, bh - 6);
    }
  blobs(g, S, S, r, 80, ['#efd3a8', '#ebcb9c', '#f4dfba', '#e6c191'], [30, 90], [0.45, 0.75]);
  speckle(g, S, r, 600, ['#c69a68', '#fff4dc'], 0.35, 2);
  return toTexture(c, renderer);
}

/** Packed-clay flat roofs, smoothed by hand: soft trowel swirls and a few hairline cracks. */
export function roofTexture(renderer: R): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(331);
  g.fillStyle = '#dca878';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 50, ['#e6b688', '#d09a69', '#ecc297'], [12, 40], [0.25, 0.45]);
  g.strokeStyle = '#b07a4c';
  g.lineWidth = 1.5;
  for (let i = 0; i < 10; i++) {
    let x = r() * S;
    let y = r() * S;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 26;
      y += (r() - 0.5) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  speckle(g, S, r, 250, ['#a87348', '#fff0d8'], 0.4, 2);
  return toTexture(c, renderer);
}

/** Turquoise glazed tile for the aqueduct surf: a tile grid with long pale glints along the ride (texture u). */
export function tileTexture(renderer: R): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(337);
  g.fillStyle = '#16707a';
  g.fillRect(0, 0, S, S);
  const n = 4;
  const t = S / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = ['#2fb3b0', '#27a2a6', '#38c0b8', '#2a9eaa'][Math.floor(r() * 4)];
      g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      g.globalAlpha = 0.35;
      g.fillStyle = '#9ff0e2';
      g.fillRect(i * t + 6, j * t + 6, t - 12, 6);
      g.globalAlpha = 1;
    }
  for (let i = 0; i < 18; i++) {
    const y = r() * S;
    const x = r() * S;
    const len = 80 + r() * 140;
    g.globalAlpha = 0.25 + r() * 0.35;
    g.strokeStyle = r() < 0.8 ? '#e9fffb' : '#0f5e66';
    g.lineWidth = 1 + r() * 2.5;
    g.lineCap = 'round';
    wrap(S, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.bezierCurveTo(x + dx + len * 0.3, y + dy - 2, x + dx + len * 0.7, y + dy + 2, x + dx + len, y + dy);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
  return toTexture(c, renderer);
}

/** Woven awning cloth: broad turquoise, cream and terracotta stripes with a fine weave. */
export function awningTexture(renderer: R): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(347);
  const bands = ['#2fa7a3', '#f6ead2', '#d9714a', '#f6ead2'];
  const w = S / 8;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = bands[i % bands.length];
    g.fillRect(i * w, 0, w, S);
  }
  g.globalAlpha = 0.12;
  g.fillStyle = '#5a3a24';
  for (let y = 0; y < S; y += 4) g.fillRect(0, y, S, 1);
  for (let x = 0; x < S; x += 4) g.fillRect(x, 0, 1, S);
  g.globalAlpha = 1;
  speckle(g, S, r, 200, ['#ffffff', '#7a4a2c'], 0.25, 2);
  return toTexture(c, renderer);
}

/** Palm bark: stacked crescent scales. Wraps horizontally round the trunk. */
export function palmBarkTexture(renderer: R): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S);
  const r = rng(353);
  g.fillStyle = '#8a6343';
  g.fillRect(0, 0, S, S);
  const rows = 6;
  const rh = S / rows;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < 4; col++) {
      const x = col * (S / 4) + (row % 2 ? S / 8 : 0);
      wrap(S, (dx, dy) => {
        g.fillStyle = ['#a07650', '#946b47', '#b1865c'][Math.floor(r() * 3)];
        g.beginPath();
        g.ellipse(x + dx, row * rh + rh * 0.7 + dy, S / 8, rh * 0.55, 0, 0, Math.PI);
        g.fill();
      });
    }
  return toTexture(c, renderer);
}
