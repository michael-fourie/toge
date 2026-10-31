// Canvas textures (no image files): honey hardwood, red brick, bathroom tile, kitchen lino, grass, green shingles,
// the porch boards, stair treads, and the soft grain under every painted wall and ceiling. Each is drawn once and
// repeats at a size in metres (world.ts lays UVs out in metres). Painted surfaces use the grey "plaster" and
// "stipple" maps as a multiplier, so one texture serves every wall colour.

import * as THREE from 'three';

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

/** A seeded wobble so textures are the same every load. */
function noise(seed: number) {
  let a = seed;
  return () => ((a = (a * 16807) % 2147483647) / 2147483647);
}

/** Speckle: n little dots of a colour range, for grain and grit. */
function speckle(g: CanvasRenderingContext2D, s: number, r: () => number, n: number, colour: (k: number) => string, size = 1.5) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colour(r());
    g.fillRect(r() * s, r() * s, size * (0.5 + r()), size * (0.5 + r()));
  }
}

const PAINTERS: Record<string, [Painter, number, number?]> = {
  // Worn honey hardwood: narrow boards of slightly different tones, staggered butt joints, grain lines, the odd knot,
  // and a dark gap between boards. 2 m square, 12 boards.
  wood: [
    (g, s) => {
      const r = noise(7);
      const rows = 12;
      const bh = s / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * bh;
        // Two or three pieces per row, each its own tone.
        let x = -r() * s * 0.5;
        while (x < s) {
          const len = s * (0.35 + r() * 0.45);
          const tone = 168 + r() * 42;
          const warm = 0.62 + r() * 0.06;
          g.fillStyle = `rgb(${tone}, ${tone * warm}, ${tone * 0.36})`;
          g.fillRect(x, y, len, bh);
          // Grain: long wavy streaks, light and dark.
          for (let k = 0; k < 7; k++) {
            g.strokeStyle = r() < 0.6 ? `rgba(110,60,25,${0.12 + r() * 0.15})` : `rgba(255,220,170,${0.08 + r() * 0.1})`;
            g.lineWidth = 0.6 + r() * 1.2;
            g.beginPath();
            const gy = y + 1 + r() * (bh - 2);
            g.moveTo(x, gy);
            g.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 3, x + len * 0.7, gy + (r() - 0.5) * 3, x + len, gy);
            g.stroke();
          }
          if (r() < 0.25) {
            const kx = x + r() * len;
            const ky = y + bh * (0.3 + r() * 0.4);
            g.fillStyle = 'rgba(90,45,15,0.45)';
            g.beginPath();
            g.ellipse(kx, ky, 3 + r() * 3, 1.5 + r(), 0, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = 'rgba(55,28,10,0.6)';
          g.fillRect(x, y, 1.5, bh);
          x += len;
        }
        g.fillStyle = 'rgba(50,25,8,0.7)';
        g.fillRect(0, y, s, 1.5);
        // A worn, lighter band down the middle of the board.
        g.fillStyle = 'rgba(255,235,200,0.06)';
        g.fillRect(0, y + bh * 0.35, s, bh * 0.3);
      }
    },
    2,
    512,
  ],
  // Red brick: running bond with irregular sizes and tones, a few darker over-fired bricks, grey mortar, grit.
  brick: [
    (g, s) => {
      const r = noise(11);
      g.fillStyle = '#b8ab98';
      g.fillRect(0, 0, s, s);
      speckle(g, s, r, 900, (k) => `rgba(${120 + k * 60},${110 + k * 50},${95 + k * 40},0.5)`);
      const rows = 12;
      const bh = s / rows;
      for (let i = 0; i < rows; i++) {
        const off = i % 2 ? s / 8 : 0;
        for (let j = -1; j < 4; j++) {
          const t = 0.78 + r() * 0.38;
          const dark = r() < 0.12 ? 0.7 : 1;
          const x0 = off + (j * s) / 4 + 2 + r();
          const y0 = i * bh + 2 + r() * 0.8;
          const w = s / 4 - 4 - r() * 1.5;
          const h = bh - 4 - r();
          g.fillStyle = `rgb(${150 * t * dark}, ${60 * t * dark}, ${44 * t * dark})`;
          g.fillRect(x0, y0, w, h);
          // A lighter top edge and a darker bottom: a little depth on each brick.
          g.fillStyle = 'rgba(255,200,170,0.12)';
          g.fillRect(x0, y0, w, 2);
          g.fillStyle = 'rgba(40,10,5,0.18)';
          g.fillRect(x0, y0 + h - 2, w, 2);
          for (let k = 0; k < 10; k++) {
            g.fillStyle = `rgba(${r() < 0.5 ? '60,20,10' : '230,170,140'},${0.15 + r() * 0.15})`;
            g.fillRect(x0 + r() * w, y0 + r() * h, 1.5, 1.5);
          }
        }
      }
    },
    0.9,
  ],
  // Bathroom tile: 15 cm squares, each a hair different, crisp grout, a little gloss highlight.
  tile: [
    (g, s) => {
      const r = noise(17);
      g.fillStyle = '#aab4b8';
      g.fillRect(0, 0, s, s);
      const n = 6;
      const ts = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const t = 0.95 + r() * 0.06;
          g.fillStyle = `rgb(${233 * t}, ${240 * t}, ${242 * t})`;
          g.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4);
          g.fillStyle = 'rgba(255,255,255,0.45)';
          g.fillRect(i * ts + 5, j * ts + 5, ts * 0.35, 2);
        }
    },
    0.9,
  ],
  // Kitchen lino: a scuffed check, with scratches and a yellowed cast.
  lino: [
    (g, s) => {
      const r = noise(19);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#d6cbb0' : '#9fae94';
          g.fillRect((i * s) / 4, (j * s) / 4, s / 4, s / 4);
        }
      speckle(g, s, r, 700, (k) => `rgba(${90 + k * 60},${80 + k * 50},${60 + k * 40},0.25)`);
      g.strokeStyle = 'rgba(80,70,50,0.18)';
      for (let i = 0; i < 25; i++) {
        g.beginPath();
        const x = r() * s;
        const y = r() * s;
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20);
        g.stroke();
      }
    },
    1.2,
  ],
  grass: [
    (g, s) => {
      const r = noise(3);
      g.fillStyle = '#3a4f30';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(${40 + r() * 30}, ${70 + r() * 30}, ${30 + r() * 15}, 0.35)`;
        g.beginPath();
        g.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = `rgba(${70 + r() * 40}, ${100 + r() * 50}, ${50 + r() * 20}, 0.7)`;
        g.fillRect(r() * s, r() * s, 1.5, 4 + r() * 3);
      }
    },
    3,
  ],
  shingle: [
    (g, s) => {
      const r = noise(5);
      g.fillStyle = '#1e3326';
      g.fillRect(0, 0, s, s);
      const rows = 8;
      for (let i = 0; i < rows; i++)
        for (let j = -1; j < 7; j++) {
          const t = 0.8 + r() * 0.35;
          const w = s / 6 - 3;
          const x = ((j + (i % 2) * 0.5) * s) / 6;
          const y = (i * s) / rows;
          g.fillStyle = `rgb(${52 * t}, ${94 * t}, ${66 * t})`;
          g.fillRect(x, y, w, s / rows - 2);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x, y + s / rows - 5, w, 3);
        }
    },
    1.5,
  ],
  porch: [
    (g, s) => {
      const r = noise(13);
      for (let i = 0; i < 6; i++) {
        const t = 0.88 + r() * 0.15;
        g.fillStyle = `rgb(${200 * t}, ${196 * t}, ${186 * t})`;
        g.fillRect((i * s) / 6, 0, s / 6 - 3, s);
        speckle(g, s / 6, r, 40, () => 'rgba(120,110,95,0.2)');
      }
      g.fillStyle = 'rgba(60,55,45,0.35)';
      for (let i = 0; i < 6; i++) g.fillRect(((i + 1) * s) / 6 - 3, 0, 3, s);
    },
    1.2,
  ],
  stair: [
    (g, s) => {
      // Honey treads, matching the floors, with a dark nosing every 25 cm.
      const r = noise(23);
      g.fillStyle = '#b8803f';
      g.fillRect(0, 0, s, s);
      for (let k = 0; k < 30; k++) {
        g.strokeStyle = `rgba(110,60,25,${0.1 + r() * 0.15})`;
        g.beginPath();
        const y = r() * s;
        g.moveTo(0, y);
        g.lineTo(s, y + (r() - 0.5) * 4);
        g.stroke();
      }
      g.fillStyle = '#6a3e1c';
      for (let i = 0; i < 4; i++) g.fillRect(0, (i * s) / 4, s, s / 26);
    },
    1,
  ],
  // The grain under every painted wall: soft blotches and a faint roller texture, mid-grey around white so it only
  // shifts the paint a little.
  plaster: [
    (g, s) => {
      const r = noise(29);
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '225,225,225' : '255,255,255'},${0.05 + r() * 0.07})`;
        g.beginPath();
        g.ellipse(r() * s, r() * s, 12 + r() * 40, 8 + r() * 30, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      speckle(g, s, r, 1600, (k) => `rgba(${205 + k * 45},${205 + k * 45},${205 + k * 45},0.3)`, 1.2);
      // Roller marks: faint vertical bands.
      for (let x = 0; x < s; x += 6 + r() * 10) {
        g.fillStyle = `rgba(220,220,220,${0.03 + r() * 0.05})`;
        g.fillRect(x, 0, 2 + r() * 4, s);
      }
    },
    1.6,
  ],
  // Ceilings: popcorn stipple.
  stipple: [
    (g, s) => {
      const r = noise(31);
      g.fillStyle = '#f0f0f0';
      g.fillRect(0, 0, s, s);
      speckle(g, s, r, 2600, (k) => `rgba(${215 + k * 40},${215 + k * 40},${215 + k * 40},0.35)`, 2);
    },
    1,
  ],
};

const cache = new Map<string, THREE.CanvasTexture>();

/** The texture for a surface, or null if it's a flat colour. `metres` is how big one repeat is. */
export function texture(name: string): { tex: THREE.CanvasTexture; metres: number } | null {
  const p = PAINTERS[name];
  if (!p) return null;
  let tex = cache.get(name);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = p[2] ?? 256;
    p[0](c.getContext('2d')!, c.width);
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    cache.set(name, tex);
  }
  return { tex, metres: p[1] };
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
