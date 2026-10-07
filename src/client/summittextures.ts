import type * as THREE from 'three';
import { blobs, canvas, rng, toTexture } from './textures.ts';

// Procedural textures for Summit: snow, blue-grey rock, glassy ice, groomed piste and dark log walls.
// Same painterly approach as textures.ts (soft blobs and strokes on a canvas, wrap-around so they tile).

/** Fresh snow from above: near-white with soft blue hollows and a few sparkles. */
export function snowTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(101);
  g.fillStyle = '#eef3fa';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 60, ['#dfe8f4', '#f8fbff', '#d5e1f0'], [40, 120], [0.3, 0.6]);
  blobs(g, S, S, r, 220, ['#cddaec', '#ffffff', '#e4ecf7'], [6, 22], [0.25, 0.5]);
  blobs(g, S, S, r, 90, ['#ffffff'], [1, 2.2], [0.8, 1]); // sparkles
  return toTexture(c, renderer);
}

/**
 * Side of a rock shelf: a thick snow cap with drips at the top (v = 1), then blue-grey strata.
 * Tiles horizontally only (use with boxGeometry's anchorTop).
 */
export function cliffTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(103);
  g.fillStyle = '#7d8798';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 10; i++) {
    const y = 0.15 * S + (i / 10) * 0.85 * S + r() * 16;
    g.fillStyle = ['#6f7a8c', '#8e98a8', '#737e90', '#9aa3b2'][i % 4];
    g.globalAlpha = 0.45;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.0245 * 2 + i) * 5);
    for (let x = S; x >= 0; x -= 32) g.lineTo(x, y + 10 + r() * 16 + Math.sin(x * 0.0245 * 2 + i) * 5);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 140, ['#68738a', '#a4adbb', '#5d677b', '#8590a2'], [6, 26], [0.25, 0.5], false, [0.15, 1]);
  blobs(g, S, S, r, 40, ['#e8eef7'], [3, 9], [0.6, 0.9], false, [0.2, 1]); // snow caught in the cracks
  // Snow cap with a dripping lower edge.
  g.fillStyle = '#eef3fa';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(S, 0);
  const steps = 32;
  for (let i = steps; i >= 0; i--) g.lineTo((i / steps) * S, (i % 2 === 0 ? 0.11 + r() * 0.08 : 0.08) * S);
  g.closePath();
  g.fill();
  blobs(g, S, S, r, 50, ['#d6e1ef', '#ffffff'], [5, 14], [0.4, 0.7], false, [0, 0.08]);
  return toTexture(c, renderer);
}

/** Bare granite for boulders and the bullwheel house. */
export function graniteTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(107);
  g.fillStyle = '#8a93a3';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 120, ['#7a8496', '#9fa8b6', '#6c768a', '#b1b8c4'], [6, 30], [0.3, 0.6]);
  blobs(g, S, S, r, 60, ['#f2f5fa'], [2, 6], [0.5, 0.8]); // frost
  return toTexture(c, renderer);
}

/** Glassy surf ice: bright cyan-white with long streaks along u (the ramp's length) and fine cracks. */
export function iceTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(109);
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#8fd3ee');
  grad.addColorStop(0.5, '#c4ecfa');
  grad.addColorStop(1, '#8fd3ee');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 40, ['#a8e0f4', '#e3f7ff', '#7cc6e6'], [14, 44], [0.2, 0.4]);
  g.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    const y = r() * S;
    const x = r() * S;
    const len = 80 + r() * 160;
    g.globalAlpha = 0.35 + r() * 0.4;
    g.strokeStyle = r() < 0.8 ? '#ffffff' : '#5fb2d8';
    g.lineWidth = 1 + r() * 3;
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.bezierCurveTo(x + dx + len * 0.3, y + dy - 2, x + dx + len * 0.7, y + dy + 2, x + dx + len, y + dy);
        g.stroke();
      }
  }
  // Hairline cracks.
  g.strokeStyle = '#4f9fc6';
  g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    let x = r() * S;
    let y = r() * S;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, renderer);
}

/** Wallrun ice: deep blue frozen falls with vertical facets and frosty edges. */
export function iceWallTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(113);
  g.fillStyle = '#7ec1e2';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) {
    const x = r() * S;
    const w = 6 + r() * 22;
    g.fillStyle = ['#9fd7ef', '#62a8d0', '#b9e6f7', '#5598c4'][Math.floor(r() * 4)];
    g.globalAlpha = 0.35 + r() * 0.35;
    for (const dx of [-S, 0, S]) {
      g.beginPath();
      g.moveTo(x + dx, 0);
      for (let y = 0; y <= S; y += 16) g.lineTo(x + dx + Math.sin(y * 0.05 + i) * 3, y);
      g.lineTo(x + dx + w, S);
      for (let y = S; y >= 0; y -= 16) g.lineTo(x + dx + w + Math.sin(y * 0.05 + i) * 3, y);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 50, ['#ffffff', '#e6f6ff'], [3, 10], [0.4, 0.8]);
  return toTexture(c, renderer);
}

/** Groomed piste for slide ramps: corduroy ridges running up the slope (v) and orange marker dashes. */
export function pisteTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(127);
  g.fillStyle = '#f6efe4';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 8) {
    g.fillStyle = x % 16 ? '#e2dccf' : '#fffaf2';
    g.fillRect(x, 0, 4, S);
  }
  blobs(g, S, S, r, 30, ['#efe6d6', '#ffffff'], [10, 30], [0.2, 0.35]);
  // Orange piste-marker dashes down both edges of every tile.
  g.fillStyle = '#ef7d3c';
  for (const x of [6, S - 18])
    for (let y = 0; y < S; y += 64) {
      g.fillRect(x, y + 8, 12, 30);
    }
  return toTexture(c, renderer);
}

/** Stacked dark logs for the lodge, with snow resting on each one. */
export function logTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(131);
  const logs = 5;
  const lh = S / logs;
  for (let i = 0; i < logs; i++) {
    const y = i * lh;
    const grad = g.createLinearGradient(0, y, 0, y + lh);
    grad.addColorStop(0, '#8a5a3a');
    grad.addColorStop(0.5, '#6e4329');
    grad.addColorStop(1, '#4a2b1a');
    g.fillStyle = grad;
    g.fillRect(0, y, S, lh);
    g.strokeStyle = '#3c2416';
    g.globalAlpha = 0.35;
    for (let k = 0; k < 4; k++) {
      const yy = y + 6 + r() * (lh - 12);
      g.beginPath();
      g.moveTo(0, yy);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, yy + Math.sin(x * 0.04 + k) * 1.5);
      g.stroke();
    }
    g.globalAlpha = 0.9;
    g.fillStyle = '#f2f6fb'; // snow on the log below's top
    g.fillRect(0, y, S, 3);
    g.globalAlpha = 1;
  }
  return toTexture(c, renderer);
}
