import * as THREE from 'three';

// Procedural "painted" textures: layered soft blobs and brush strokes on a canvas,
// drawn wrap-around so they tile seamlessly. No image assets.

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

export function toTexture(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer, wrap = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/** Soft three-band toon ramp: gentle cel shading rather than hard comic bands. */
let gradient: THREE.DataTexture | null = null;
export function toonRamp(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

/** Meadow grass seen from above, with flower specks. */
export function grassTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(11);
  g.fillStyle = '#8cbf5b';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 70, ['#7db150', '#9ccb64', '#6fa345', '#a9d36f'], [40, 110], [0.25, 0.5]);
  blobs(g, S, S, r, 260, ['#76aa4a', '#b4d97a', '#689c40', '#94c55e'], [8, 26], [0.3, 0.6]);
  // Short brush-stroke blades.
  g.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const l = 5 + r() * 9;
    g.strokeStyle = r() < 0.5 ? '#5f9139' : '#b8dc80';
    g.globalAlpha = 0.35 + r() * 0.4;
    g.lineWidth = 1.5 + r() * 1.5;
    wrapped(g, S, S, () => {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
  // Wildflowers.
  blobs(g, S, S, r, 40, ['#fff8e1', '#ffe08a', '#f7b6c2', '#ffffff'], [2, 4], [0.85, 1]);
  return toTexture(c, renderer);
}

/**
 * Side of a floating island: grass lip with drips at the top (v = 1), then layered
 * ochre earth and pebbles. Tiles horizontally only.
 */
export function earthSideTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(23);
  g.fillStyle = '#c99b62';
  g.fillRect(0, 0, S, S);
  // Strata.
  for (let i = 0; i < 9; i++) {
    const y = 0.2 * S + (i / 9) * 0.8 * S + r() * 20;
    g.fillStyle = ['#c39463', '#dab57f', '#b98d5c', '#cfa36d'][i % 4];
    g.globalAlpha = 0.35;
    // Wavy, soft-edged band rather than a hard plank line.
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.0245 + i) * 6);
    for (let x = S; x >= 0; x -= 32) g.lineTo(x, y + 14 + r() * 14 + Math.sin(x * 0.0245 + i) * 6);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 160, ['#b5885a', '#dcb985', '#a07246', '#8f6a45'], [6, 30], [0.25, 0.55], false, [0.18, 1]);
  blobs(g, S, S, r, 60, ['#9c8a78', '#b3a08a', '#857262'], [4, 10], [0.7, 0.95], false, [0.25, 1]); // pebbles
  // Grass lip with dripping edge.
  g.fillStyle = '#7fb24e';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(S, 0);
  const steps = 32;
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * S;
    const drip = i % 2 === 0 ? 0.13 + r() * 0.07 : 0.1;
    g.lineTo(x, drip * S);
  }
  g.closePath();
  g.fill();
  blobs(g, S, S, r, 60, ['#93c45d', '#6c9f42', '#a6d06c'], [6, 16], [0.4, 0.7], false, [0, 0.1]);
  return toTexture(c, renderer);
}

/** Craggy rock for island undersides and distant islands. */
export function rockTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(37);
  g.fillStyle = '#9a7f63';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 120, ['#86694f', '#b09274', '#7a5f47', '#a68a6d'], [8, 34], [0.3, 0.6]);
  blobs(g, S, S, r, 30, ['#6f8f4a', '#7ea356'], [4, 12], [0.4, 0.6]); // moss patches
  return toTexture(c, renderer);
}

/** Whitewashed stone wall with terracotta bricks peeking through and ivy. Reads as "runnable wall". */
export function wallTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(41);
  g.fillStyle = '#efdcbc';
  g.fillRect(0, 0, S, S);
  // Stone courses.
  const rows = 6;
  const rh = S / rows;
  for (let row = 0; row < rows; row++) {
    let x = row % 2 ? -rh * 0.7 : 0;
    while (x < S) {
      const w = rh * (1.2 + r() * 1.1);
      const tint = ['#f4e4c6', '#ead3ad', '#f0dbb6', '#e3c79c'][Math.floor(r() * 4)];
      g.fillStyle = tint;
      g.fillRect(x + 3, row * rh + 3, w - 6, rh - 6);
      if (r() < 0.12) {
        g.fillStyle = '#d98f62'; // terracotta brick showing through the plaster
        g.globalAlpha = 0.8;
        g.fillRect(x + 6, row * rh + 6, w - 12, rh - 12);
        g.globalAlpha = 1;
      }
      x += w;
    }
  }
  // Mortar shading.
  g.strokeStyle = '#c8a97e';
  g.globalAlpha = 0.6;
  g.lineWidth = 3;
  for (let row = 0; row <= rows; row++) {
    g.beginPath();
    g.moveTo(0, row * rh);
    g.lineTo(S, row * rh);
    g.stroke();
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 90, ['#e9cfa5', '#fff3dc', '#d9bb8f'], [10, 40], [0.12, 0.3]);
  // Ivy trails.
  for (let i = 0; i < 5; i++) {
    let x = r() * S;
    let y = r() * S * 0.3;
    const len = 30 + r() * 50;
    for (let k = 0; k < len; k++) {
      x += (r() - 0.5) * 8;
      y += 4 + r() * 4;
      const cx = x;
      const cy = y;
      const leaf = 3 + r() * 5;
      g.fillStyle = ['#6b9a3e', '#87b552', '#55803a'][Math.floor(r() * 3)];
      g.globalAlpha = 0.9;
      wrapped(g, S, S, () => {
        g.beginPath();
        g.ellipse(cx, cy, leaf, leaf * 0.6, r() * 3, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
  g.globalAlpha = 1;
  return toTexture(c, renderer);
}

/** Warm timber planks for crates/cover. */
export function woodTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(53);
  const planks = 4;
  const ph = S / planks;
  for (let i = 0; i < planks; i++) {
    g.fillStyle = ['#b07a49', '#a46f40', '#bb8654', '#9c683c'][i % 4];
    g.fillRect(0, i * ph, S, ph);
    // grain
    g.strokeStyle = '#7f5130';
    g.lineWidth = 1.2;
    for (let k = 0; k < 6; k++) {
      const y = i * ph + 5 + r() * (ph - 10);
      g.globalAlpha = 0.25 + r() * 0.25;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + k) * 2);
      g.stroke();
    }
    g.globalAlpha = 0.8;
    g.fillStyle = '#6e4529';
    g.fillRect(0, i * ph, S, 3);
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 30, ['#c99665', '#8c5a34'], [8, 24], [0.12, 0.25]);
  return toTexture(c, renderer);
}

/** Swirling wind-spirit glyph for jump pads. */
export function padTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
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
  return toTexture(c, renderer, false);
}

/** A sunlit cumulus: white tops, warm highlight, cool blue-grey underside. Transparent background. */
export function cloudTexture(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const puffs: [number, number, number][] = [];
  const n = 14 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = W * (0.14 + t * 0.72) + (r() - 0.5) * 40;
    const hump = Math.sin(t * Math.PI);
    const rad = 34 + hump * 60 * (0.6 + r() * 0.6);
    const y = H * 0.78 - rad * (0.55 + r() * 0.35);
    puffs.push([x, y, rad]);
  }
  // Shadow layer, then body, then highlight, each slightly offset: gives painted volume.
  const layer = (color: string, dx: number, dy: number, k: number, alpha: number) => {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (const [x, y, rad] of puffs) {
      g.beginPath();
      g.arc(x + dx, y + dy, rad * k, 0, Math.PI * 2);
      g.fill();
    }
  };
  layer('#aebdd6', 0, 10, 1.0, 1);
  layer('#f7f9fc', -4, -2, 0.92, 1);
  layer('#fff4dd', -12, -12, 0.62, 0.9);
  g.globalAlpha = 1;
  // Flat-ish base.
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, H * 0.86, W, H);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft tileable cloud-noise for the sea of clouds below the islands. */
export function cloudSeaTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(71);
  blobs(g, S, S, r, 160, ['#ffffff', '#f3f6fb', '#e3eaf4'], [20, 70], [0.25, 0.55]);
  blobs(g, S, S, r, 50, ['#cfd9ea'], [15, 40], [0.15, 0.3]);
  return toTexture(c, renderer);
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

/** Smooth sky-glazed stone for surf ramps: long pale streaks run along the ramp (texture u). */
export function surfTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(61);
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#9ccbe0');
  grad.addColorStop(0.5, '#b7dcea');
  grad.addColorStop(1, '#9ccbe0');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 50, ['#8fc0d8', '#c9e7f1', '#a8d3e6'], [12, 40], [0.15, 0.35]);
  // Wind streaks: long thin strokes along u, wrapped so they tile.
  for (let i = 0; i < 26; i++) {
    const y = r() * S;
    const x = r() * S;
    const len = 60 + r() * 140;
    const w = 1 + r() * 2.5;
    g.globalAlpha = 0.25 + r() * 0.35;
    g.strokeStyle = r() < 0.75 ? '#f4fbff' : '#7fb3cc';
    g.lineWidth = w;
    g.lineCap = 'round';
    wrapped(g, S, S, () => {
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y - 3, x + len * 0.7, y + 3, x + len, y);
      g.stroke();
    });
  }
  g.globalAlpha = 1;
  // Faint tile seams across the ramp every half-texture.
  g.strokeStyle = '#7aa9c0';
  g.globalAlpha = 0.3;
  g.lineWidth = 2;
  for (const x of [0, S / 2]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, renderer);
}

/** Ridged bark for the great tree's trunk and roots. */
export function barkTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(71);
  g.fillStyle = '#7a5236';
  g.fillRect(0, 0, S, S);
  // Vertical ridges with soft light/dark edges, wrapping horizontally.
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const w = 4 + r() * 10;
    g.fillStyle = r() > 0.5 ? '#8f6440' : '#5e3e28';
    g.globalAlpha = 0.5 + r() * 0.4;
    for (const dx of [-S, 0, S]) {
      g.beginPath();
      g.moveTo(x + dx, 0);
      for (let y = 0; y <= S; y += 16) g.lineTo(x + dx + Math.sin(y * 0.04 + i) * 4, y);
      g.lineTo(x + dx + w, S);
      for (let y = S; y >= 0; y -= 16) g.lineTo(x + dx + w + Math.sin(y * 0.04 + i) * 4, y);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  blobs(g, S, S, r, 18, ['#6f9a4a', '#88b05a'], [6, 18], [0.25, 0.4]); // moss
  return toTexture(c, renderer);
}
