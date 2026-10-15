import * as THREE from 'three';
import { clamp01, fbm, lerp, noise, ridged, smooth } from './render/noise.ts';
import { bake } from './render/surface.ts';
import { blobs, canvas, hex, paint, rng, shade, tint, toTexture } from './textures.ts';

// Procedural textures for the Foundry: grimy brick, rusted plate, poured concrete, hazard paint, crates. No image assets.
// Every tiling texture is drawn to wrap, with its sizes chosen so one tile = TILE metres on the box (see foundryworld.ts).

const speckle = (g: CanvasRenderingContext2D, S: number, r: () => number, n: number, colors: string[], alpha: number, size = 2) => {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(r() * S, r() * S, size * (0.5 + r()), size * (0.5 + r()));
  }
  g.globalAlpha = 1;
};

/** Soot-stained red brick in running bond: each brick its own fired colour, recessed mortar, soot rising from below. */
export function brickTexture(): THREE.Texture {
  const rows = 16;
  const reds = [hex(0x6a3b31), hex(0x7d4638), hex(0x8c5240), hex(0x5b342d)];
  const mortar = hex(0x5d554c);
  const soot = hex(0x1a1614);
  return bake(
    'brick',
    (u, v, t) => {
      const ry = v * rows;
      const row = Math.floor(ry);
      const fy = ry - row;
      const cols = 6; // bricks 2.4 rows long, near enough, in a whole number per tile
      const rx = (u * cols + (row % 2) * 0.5) % cols;
      const col = Math.floor(rx);
      const fx = rx - col;
      const id = (((row * 7 + col * 13) % 29) + 0.5) / 29;
      const joint = Math.min(Math.min(fx, 1 - fx) * (rows / cols), Math.min(fy, 1 - fy));
      const inMortar = smooth(0.09, 0.05, joint);
      const bevel = smooth(0.05, 0.16, joint);
      const base = reds[Math.floor(id * reds.length)];
      const n = fbm(u, v, 16, 4, 11) * 0.5 + 0.5;
      t.r = base[0];
      t.g = base[1];
      t.b = base[2];
      shade(t, 0.8 + n * 0.35);
      tint(t, mortar, inMortar);
      const grime = smooth(0.4, 1, 1 - v) * (fbm(u, v, 4, 3, 13) * 0.5 + 0.6); // soot creeps up from the bottom
      tint(t, soot, clamp01(grime * 0.45 + (fbm(u, v, 6, 3, 17) * 0.5 + 0.5) * 0.15));
      t.h = bevel * 0.7 + n * 0.25;
      t.rough = 0.88;
      t.ao = 0.5 + bevel * 0.5;
    },
    { size: 512, normal: 8 },
  );
}

/** Poured concrete floor: four slabs with saw-cut joints, aggregate, hairline cracks, scuffs and oil stains. */
export function concreteTexture(): THREE.Texture {
  const light = hex(0x8a8c8f);
  const dark = hex(0x5b5e62);
  const oil = hex(0x202124);
  return bake(
    'concrete',
    (u, v, t) => {
      const n = fbm(u, v, 6, 6, 23) * 0.5 + 0.5;
      const mottle = fbm(u, v, 2, 3, 29) * 0.5 + 0.5;
      paint(t, dark, light, n * 0.6 + mottle * 0.4);
      const agg = smooth(0.78, 0.86, noise(u, v, 180, 31) * 0.5 + 0.5);
      shade(t, 1 + agg * 0.12 - (1 - agg) * 0.02);
      const joint = smooth(0.006, 0.0, Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5), u, 1 - u, v, 1 - v));
      const crack = smooth(0.95, 0.995, ridged(u, v, 3, 4, 37));
      const stain = smooth(0.7, 0.8, fbm(u, v, 3, 4, 41) * 0.5 + 0.5);
      tint(t, oil, stain * 0.55);
      shade(t, 1 - joint * 0.6 - crack * 0.45);
      t.h = n * 0.3 - joint - crack * 0.6 + agg * 0.1;
      t.rough = lerp(0.82, 0.35, stain) + joint * 0.1; // oil is slick
      t.ao = 1 - joint * 0.6 - crack * 0.3;
    },
    { size: 1024, normal: 4 },
  );
}

/** Rusty riveted steel plate. */
export function steelTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(31);
  g.fillStyle = '#4b5057';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 40, ['#3b3f45', '#5a6068', '#6e4a33'], [10, 40], [0.1, 0.28]);
  g.strokeStyle = '#2a2d31';
  g.lineWidth = 3;
  g.strokeRect(2, 2, S - 4, S - 4);
  g.beginPath();
  g.moveTo(0, S / 2);
  g.lineTo(S, S / 2);
  g.stroke();
  g.fillStyle = '#7b8189';
  for (const x of [14, S / 2, S - 14]) for (const y of [14, S / 2 - 12, S / 2 + 12, S - 14]) {
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 6; i++) { // rust streaks running down
    const x = r() * S;
    g.fillStyle = '#7a4a2c';
    g.globalAlpha = 0.25;
    g.fillRect(x, r() * S * 0.5, 3 + r() * 5, 40 + r() * 90);
  }
  g.globalAlpha = 1;
  speckle(g, S, r, 300, ['#2a2d31', '#8b6a4f'], 0.45);
  return toTexture(c);
}

/** Yellow-and-black hazard stripes (door frames, thresholds, machine skirts). */
export function hazardTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(37);
  g.fillStyle = '#e1b52a';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#1e1e22';
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64 + 32, 0);
    g.lineTo(i * 64 + 32 + S, S);
    g.lineTo(i * 64 + S, S);
    g.fill();
  }
  blobs(g, S, S, r, 30, ['#3b3020', '#a88a30'], [8, 30], [0.12, 0.3]);
  speckle(g, S, r, 400, ['#1a1a1a', '#f0d070'], 0.5);
  return toTexture(c);
}

/** Yellow-painted machinery: panel lines, bolts, chipped paint over metal. */
export function machineTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(43);
  g.fillStyle = '#c99a2e';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 40, ['#b0841f', '#d8ab40', '#6e5a2a'], [10, 36], [0.1, 0.25]);
  g.strokeStyle = '#5a431a';
  g.lineWidth = 2.5;
  g.strokeRect(6, 6, S / 2 - 8, S - 12);
  g.strokeRect(S / 2 + 2, 6, S / 2 - 8, S - 12);
  g.fillStyle = '#3e3a34';
  for (const [x, y] of [[16, 16], [S / 2 - 12, 16], [16, S - 16], [S / 2 - 12, S - 16], [S / 2 + 12, 16], [S - 16, 16], [S / 2 + 12, S - 16], [S - 16, S - 16]]) {
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 25; i++) { // chipped paint shows steel
    g.fillStyle = '#5d6168';
    g.globalAlpha = 0.7;
    g.fillRect(r() * S, r() * S, 2 + r() * 7, 2 + r() * 4);
  }
  g.globalAlpha = 1;
  speckle(g, S, r, 300, ['#2c2418'], 0.4);
  return toTexture(c);
}

/** The boilers: green-grey riveted tank bands with rust. */
export function boilerTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(47);
  g.fillStyle = '#556257';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 40, ['#47524a', '#657366', '#6a4a35'], [12, 44], [0.1, 0.28]);
  g.fillStyle = '#3a423c';
  for (const y of [0, S / 2]) g.fillRect(0, y, S, 6);
  g.fillStyle = '#7d8b7f';
  for (let x = 8; x < S; x += 20) for (const y of [10, S / 2 + 10]) {
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, S, r, 400, ['#2a302b', '#8b6a4f'], 0.45);
  return toTexture(c);
}

/** Shipping-crate planks with a cross brace. */
export function crateTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(53);
  g.fillStyle = '#8a6a43';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = ['#94724a', '#7f6039', '#8a6a43'][i % 3];
    g.fillRect(0, (i * S) / 6 + 1, S, S / 6 - 2);
    g.strokeStyle = '#5e4527';
    g.globalAlpha = 0.4;
    g.beginPath();
    for (let x = 0; x <= S; x += 16) g.lineTo(x, (i * S) / 6 + 6 + Math.sin(x * 0.07 + i) * 2 + r() * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
  g.fillStyle = '#5a4126';
  g.fillRect(0, 0, 18, S);
  g.fillRect(S - 18, 0, 18, S);
  g.fillRect(0, 0, S, 18);
  g.fillRect(0, S - 18, S, 18);
  g.strokeStyle = '#5a4126';
  g.lineWidth = 16;
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(S - 10, S - 10);
  g.stroke();
  speckle(g, S, r, 300, ['#3a2a18', '#b99366'], 0.4);
  return toTexture(c);
}

/** Conveyor belt top: a dark rubber belt over rollers. */
export function conveyorTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#2a2b2f';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#3a3c42';
  for (let x = 0; x < S; x += 16) g.fillRect(x, 0, 6, S);
  g.fillStyle = '#c9a13a';
  g.fillRect(0, 0, S, 8);
  g.fillRect(0, S - 8, S, 8);
  return toTexture(c);
}

/** Dark gravel for the yard. */
export function gravelTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(59);
  g.fillStyle = '#3d3f43';
  g.fillRect(0, 0, S, S);
  blobs(g, S, S, r, 80, ['#34363a', '#47494e', '#2d2f33'], [20, 80], [0.15, 0.3]);
  speckle(g, S, r, 2400, ['#5a5c61', '#25272a', '#6b6a66'], 0.7, 4);
  blobs(g, S, S, r, 8, ['#22302a'], [18, 40], [0.18, 0.3]); // weeds
  return toTexture(c);
}

/** Splintered board for the window barricades. */
export function plankTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S);
  const r = rng(61);
  g.fillStyle = '#9c7a4f';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#6b4f2c';
  for (let i = 0; i < 12; i++) {
    g.globalAlpha = 0.3 + r() * 0.3;
    g.beginPath();
    const y = r() * S;
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.08 + i) * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  speckle(g, S, r, 120, ['#4a361d', '#c4a373'], 0.5);
  return toTexture(c);
}

/** Worn floorboards for the North Wing's upper storey: long boards in staggered rows, one tile = 2 m. */
export function floorboardTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(71);
  const rows = 8;
  const h = S / rows;
  const tones = ['#8a6640', '#7d5a36', '#93704a', '#73532f'];
  for (let j = 0; j < rows; j++) {
    const end = 40 + ((j * 97) % (S - 80)); // where this row's boards butt together
    g.fillStyle = tones[Math.floor(r() * tones.length)];
    g.fillRect(0, j * h, end, h);
    g.fillStyle = tones[Math.floor(r() * tones.length)];
    g.fillRect(end, j * h, S - end, h);
    g.fillStyle = '#4a321b';
    g.fillRect(0, j * h, S, 2);
    g.fillRect(end, j * h, 2, h);
  }
  g.strokeStyle = '#5a3e22';
  g.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    const y = r() * S;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.5);
    g.stroke();
  }
  g.globalAlpha = 1;
  speckle(g, S, r, 300, ['#3d2a17', '#b08c5e'], 0.4);
  return toTexture(c);
}

/** Chipped checkerboard tiles (the Showroom, the Break Room, Cold Storage), tinted per room. One tile = 2 m (4x4 tiles). */
export function tileTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(83);
  const n = 4;
  const t = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? '#d9d2c2' : '#6d7f86';
      g.fillRect(i * t, j * t, t, t);
    }
  }
  g.strokeStyle = '#3a3c3e';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * t, 0);
    g.lineTo(i * t, S);
    g.moveTo(0, i * t);
    g.lineTo(S, i * t);
    g.stroke();
  }
  blobs(g, S, S, r, 20, ['#4a4f52', '#9a958a'], [6, 22], [0.1, 0.25]); // grime and chips
  speckle(g, S, r, 400, ['#2f3133', '#efe9db'], 0.35);
  return toTexture(c);
}

/** Stencilled sign: a dark painted plate with chunky text, one or two lines. Not tiling. */
export function signTexture(lines: string[], opts: { bg?: string; fg?: string; w?: number; h?: number; border?: string } = {}): THREE.CanvasTexture {
  const W = opts.w ?? 512;
  const H = opts.h ?? 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = opts.bg ?? '#1d2024';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = opts.border ?? '#e1b52a';
  g.lineWidth = 10;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.fillStyle = opts.fg ?? '#f1ead2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    const size = Math.min(H / (n + 0.6), (W * 1.5) / Math.max(6, line.length));
    g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    g.fillText(line, W / 2, (H * (i + 1)) / (n + 1) + (i === 0 && n > 1 ? -2 : 0));
  });
  const t = toTexture(c, false);
  t.anisotropy = 4;
  return t;
}

/** A tall factory window at night: moonlit glass in a dark steel frame with mullions. Not tiling. */
export function paneTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 192);
  const grad = g.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, '#5d78c8');
  grad.addColorStop(1, '#2b3a7a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = 'rgba(190,210,255,0.35)'; // a streak of moon on the glass
  g.beginPath();
  g.moveTo(16, 0);
  g.lineTo(52, 0);
  g.lineTo(20, 192);
  g.lineTo(0, 192);
  g.fill();
  g.strokeStyle = '#14171d';
  g.lineWidth = 9;
  g.strokeRect(0, 0, 128, 192);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 192);
  g.moveTo(0, 64);
  g.lineTo(128, 64);
  g.moveTo(0, 128);
  g.lineTo(128, 128);
  g.stroke();
  return toTexture(c, false);
}
