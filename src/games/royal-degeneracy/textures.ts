// Canvas textures (no image files): honey hardwood, red brick, bathroom tile, kitchen lino, grass, green shingles,
// the porch boards. Each is drawn once and repeats at a size in metres (world.ts lays UVs out in metres).

import * as THREE from 'three';

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

/** A seeded wobble so textures are the same every load. */
function noise(seed: number) {
  let a = seed;
  return () => ((a = (a * 16807) % 2147483647) / 2147483647);
}

const PAINTERS: Record<string, [Painter, number]> = {
  // Worn honey hardwood: long boards, staggered joints, grain streaks.
  wood: [
    (g, s) => {
      const r = noise(7);
      const rows = 8;
      for (let i = 0; i < rows; i++) {
        const y = (i * s) / rows;
        const tone = 180 + r() * 30;
        g.fillStyle = `rgb(${tone}, ${tone * 0.66}, ${tone * 0.36})`;
        g.fillRect(0, y, s, s / rows);
        g.strokeStyle = 'rgba(90,50,20,0.25)';
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          const gy = y + r() * (s / rows);
          g.moveTo(0, gy);
          g.bezierCurveTo(s * 0.3, gy + 2, s * 0.6, gy - 2, s, gy);
          g.stroke();
        }
        g.fillStyle = 'rgba(60,30,10,0.55)';
        g.fillRect(0, y, s, 1.5);
        const joint = (r() * s) | 0;
        g.fillRect(joint, y, 1.5, s / rows);
      }
    },
    2,
  ],
  brick: [
    (g, s) => {
      const r = noise(11);
      g.fillStyle = '#c8bba8';
      g.fillRect(0, 0, s, s);
      const rows = 12;
      const bh = s / rows;
      for (let i = 0; i < rows; i++) {
        const off = i % 2 ? s / 8 : 0;
        for (let j = -1; j < 4; j++) {
          const t = 0.8 + r() * 0.35;
          g.fillStyle = `rgb(${150 * t}, ${62 * t}, ${46 * t})`;
          g.fillRect(off + (j * s) / 4 + 2, i * bh + 2, s / 4 - 4, bh - 4);
        }
      }
    },
    0.9,
  ],
  tile: [
    (g, s) => {
      g.fillStyle = '#e9eef0';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#b8c2c6';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo((i * s) / 4, 0);
        g.lineTo((i * s) / 4, s);
        g.moveTo(0, (i * s) / 4);
        g.lineTo(s, (i * s) / 4);
        g.stroke();
      }
    },
    0.8,
  ],
  lino: [
    (g, s) => {
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? '#d8cfb8' : '#a8b49a';
          g.fillRect((i * s) / 4, (j * s) / 4, s / 4, s / 4);
        }
    },
    1.2,
  ],
  grass: [
    (g, s) => {
      const r = noise(3);
      g.fillStyle = '#3d5232';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${70 + r() * 40}, ${100 + r() * 50}, ${50 + r() * 20}, 0.7)`;
        g.fillRect(r() * s, r() * s, 2, 5);
      }
    },
    3,
  ],
  shingle: [
    (g, s) => {
      const r = noise(5);
      const rows = 8;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < 6; j++) {
          const t = 0.85 + r() * 0.3;
          g.fillStyle = `rgb(${52 * t}, ${92 * t}, ${66 * t})`;
          g.fillRect(((j + (i % 2) * 0.5) * s) / 6, (i * s) / rows, s / 6 - 2, s / rows - 2);
        }
    },
    1.5,
  ],
  porch: [
    (g, s) => {
      const r = noise(13);
      for (let i = 0; i < 6; i++) {
        const t = 0.9 + r() * 0.15;
        g.fillStyle = `rgb(${200 * t}, ${196 * t}, ${186 * t})`;
        g.fillRect((i * s) / 6, 0, s / 6 - 2, s);
      }
    },
    1.2,
  ],
  stair: [
    (g, s) => {
      // Treads: darker nosing every 25 cm so the ramp reads as steps.
      g.fillStyle = '#b47a44';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#6e4220';
      for (let i = 0; i < 4; i++) g.fillRect(0, (i * s) / 4, s, s / 22);
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
    c.width = c.height = 256;
    p[0](c.getContext('2d')!, 256);
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    cache.set(name, tex);
  }
  return { tex, metres: p[1] };
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
