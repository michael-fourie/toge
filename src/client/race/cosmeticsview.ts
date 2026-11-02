// Draws TŌGE cosmetics (shared/race/cosmetics.ts) onto a car: the paint job and decals as one canvas
// texture on the body (with an emissive twin for glowing inks), and cached materials for window tints,
// lamps, rims, calipers, plates, plate frames and exhaust tips. Materials that only depend on the item are
// built once and shared by every car wearing it (marked with share(), so disposing a car leaves them).
// Everything here runs when a car is built, never per frame.

import * as THREE from 'three';
import { type Look, PAINTS, type OwnedCar } from '../../shared/race/cars.ts';
import { type DecalFx, type Finish, type ItemOf, type PaintFx, type PlateFx, equipped } from '../../shared/race/cosmetics.ts';
import { flakeTex, paintMaterial, share } from './carparts.ts';

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Same dice on every client: patterns are seeded by the item id, so everyone sees the same camo. */
function seeded(key: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < key.length; i++) a = Math.imul(a ^ key.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// The livery texture. The body's UVs (carloft.ts): u = nose (0) to tail (1), v round the section from the
// bottom centre (0) up the right flank (~0.19-0.31), over the top (0.5) and down the left flank (~0.69-0.81).
// The canvas is flipped (canvas y = 1 - v), so each flank needs its own transform to read the right way.

const TW = 1024;
const TH = 1024;
const FLANK = [0.19, 0.31] as const;

/** Runs `draw` once per flank in a frame where x runs left to right as you look at that side and y runs down. `ux(u)` maps a body u to x. */
function onFlanks(g: CanvasRenderingContext2D, draw: (ux: (u: number) => number, band: number) => void) {
  const band = (FLANK[1] - FLANK[0]) * TH;
  // Right flank: the nose is on the viewer's right, and higher v is higher up.
  g.save();
  g.setTransform(1, 0, 0, 1, 0, (1 - FLANK[1]) * TH);
  draw((u) => (1 - u) * TW, band);
  g.restore();
  // Left flank: the nose is on the viewer's left; v grows downwards, so flip y.
  g.save();
  g.setTransform(1, 0, 0, -1, 0, FLANK[1] * TH);
  draw((u) => u * TW, band);
  g.restore();
}

/** Runs `draw` on the top (hood, roof, deck) in a frame centred on the car's centre line: x = u·TW, y across the car. */
function onTop(g: CanvasRenderingContext2D, draw: () => void) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, TH / 2);
  draw();
  g.restore();
}

type Inks = { base: string; a: string; b: string };

/** Pattern painters: everything after the base fill. Called a second time on black for the glow map. */
const PATTERNS: Record<PaintFx['pattern'], (g: CanvasRenderingContext2D, k: Inks, rnd: () => number) => void> = {
  solid: () => {},
  fade: (g, k) => {
    const grad = g.createLinearGradient(TW * 0.15, 0, TW * 0.85, 0);
    grad.addColorStop(0, k.base);
    grad.addColorStop(1, k.a);
    g.fillStyle = grad;
    g.fillRect(0, 0, TW, TH);
  },
  twotone: (g, k) => {
    // The lower flanks in the accent, split by a thin pinstripe.
    g.fillStyle = k.a;
    g.fillRect(0, 0, TW, TH * 0.25);
    g.fillRect(0, TH * 0.75, TW, TH * 0.25);
    g.fillStyle = k.b === k.a ? k.base : k.b;
    for (const y of [TH * 0.25, TH * 0.75 - 4]) g.fillRect(0, y, TW, 4);
  },
  racing: (g, k) => {
    g.fillStyle = k.a;
    for (const off of [-0.055, 0.02]) g.fillRect(0, TH * (0.5 + off), TW, TH * 0.035);
  },
  pinstripe: (g, k) => {
    g.fillStyle = k.a;
    for (const v of [0.285, 0.715]) {
      g.fillRect(TW * 0.06, TH * v, TW * 0.88, 3);
      g.fillRect(TW * 0.06, TH * v + 8, TW * 0.88, 2);
    }
    g.fillRect(TW * 0.05, TH * 0.5 - 1, TW * 0.22, 3);
  },
  flames: (g, k, rnd) => {
    const tongues = Array.from({ length: 7 }, (_, i) => ({ y: (i + 0.5) / 7, len: 0.28 + rnd() * 0.22, wob: rnd() * Math.PI * 2 }));
    const flame = (ux: (u: number) => number, band: number, ink: string, shrink: number) => {
      g.fillStyle = ink;
      for (const t of tongues) {
        const y0 = t.y * band;
        const len = t.len * shrink;
        g.beginPath();
        g.moveTo(ux(0), y0 - band * 0.09 * shrink);
        g.bezierCurveTo(ux(len * 0.4), y0 - band * 0.12, ux(len * 0.75), y0 + band * 0.08 * Math.sin(t.wob), ux(len), y0 + band * 0.02);
        g.bezierCurveTo(ux(len * 0.7), y0 + band * 0.05, ux(len * 0.35), y0 + band * 0.1, ux(0), y0 + band * 0.09 * shrink);
        g.closePath();
        g.fill();
      }
    };
    onFlanks(g, (ux, band) => {
      flame(ux, band, k.a, 1);
      flame(ux, band, k.b, 0.6);
    });
    // Licks over the hood from the nose.
    onTop(g, () => {
      g.fillStyle = k.a;
      for (let i = -3; i <= 3; i++) {
        const y = i * TH * 0.035;
        const len = (0.18 - Math.abs(i) * 0.02 + rnd() * 0.04) * TW;
        g.beginPath();
        g.moveTo(0, y - 14);
        g.quadraticCurveTo(len * 0.6, y - 18, len, y);
        g.quadraticCurveTo(len * 0.6, y + 18, 0, y + 14);
        g.fill();
      }
    });
  },
  camo: (g, k, rnd) => {
    for (const ink of [k.a, k.b, k.a]) {
      g.fillStyle = ink;
      for (let i = 0; i < 70; i++) {
        const x = rnd() * TW;
        const y = rnd() * TH;
        g.beginPath();
        for (let j = 0; j < 7; j++) {
          const a = (j / 7) * Math.PI * 2;
          const r = 18 + rnd() * 34;
          g.lineTo(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r);
        }
        g.fill();
      }
    }
  },
  pixel: (g, k, rnd) => {
    const q = 16;
    for (let y = 0; y < TH; y += q)
      for (let x = 0; x < TW; x += q) {
        const r = rnd();
        if (r < 0.32) continue;
        g.fillStyle = r < 0.7 ? k.a : k.b;
        g.fillRect(x, y, q * (1 + Math.floor(rnd() * 2)), q);
      }
  },
  carbon: (g, k) => {
    const q = 12;
    for (let y = 0; y < TH; y += q)
      for (let x = 0; x < TW; x += q) {
        const along = (x / q + y / q) % 4 < 2;
        const grad = along ? g.createLinearGradient(x, 0, x + q, 0) : g.createLinearGradient(0, y, 0, y + q);
        grad.addColorStop(0, k.base);
        grad.addColorStop(0.5, k.a);
        grad.addColorStop(1, k.base);
        g.fillStyle = grad;
        g.fillRect(x + 0.5, y + 0.5, q - 1, q - 1);
      }
  },
  checker: (g, k) => {
    // A chequered flag that breaks up toward the middle of the car.
    const q = 28;
    for (let x = TW * 0.5; x < TW; x += q)
      for (let y = 0; y < TH; y += q) {
        if (((x / q) | 0) % 2 !== ((y / q) | 0) % 2) continue;
        const keep = (x - TW * 0.5) / (TW * 0.35);
        if (keep < 1 && ((x * 7 + y * 13) % 97) / 97 > keep) continue;
        g.fillStyle = k.a;
        g.fillRect(x, y, q, q);
      }
  },
  tiger: (g, k, rnd) => {
    g.fillStyle = k.a;
    for (let i = 0; i < 26; i++) {
      const x = TW * (0.04 + i * 0.037 + rnd() * 0.01);
      const w = 6 + rnd() * 10;
      for (const side of [0, 1]) {
        g.beginPath();
        const y0 = side ? TH : 0;
        const dir = side ? -1 : 1;
        const len = TH * (0.18 + rnd() * 0.2);
        g.moveTo(x - w, y0);
        g.quadraticCurveTo(x + 22 * (rnd() - 0.5), y0 + dir * len * 0.5, x + 10, y0 + dir * len);
        g.quadraticCurveTo(x + w, y0 + dir * len * 0.5, x + w, y0);
        g.fill();
      }
    }
  },
  sakura: (g, k, rnd) => {
    for (let i = 0; i < 90; i++) {
      const x = rnd() * TW;
      const y = rnd() * TH;
      const r = 6 + rnd() * 12;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * Math.PI);
      g.fillStyle = k.a;
      for (let j = 0; j < 5; j++) {
        g.rotate((Math.PI * 2) / 5);
        g.beginPath();
        g.ellipse(0, -r * 0.6, r * 0.38, r * 0.6, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = k.b;
      g.beginPath();
      g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  },
  circuit: (g, k, rnd) => {
    g.lineWidth = 3;
    for (let i = 0; i < 80; i++) {
      g.strokeStyle = i % 5 === 0 ? k.b : k.a;
      g.fillStyle = g.strokeStyle;
      let x = Math.round((rnd() * TW) / 16) * 16;
      let y = Math.round((rnd() * TH) / 16) * 16;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        if (j % 2) y += (rnd() - 0.5) * 120;
        else x += (rnd() - 0.3) * 160;
        g.lineTo(x, y);
      }
      g.stroke();
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  },
  wave: (g, k) => {
    onFlanks(g, (ux, band) => {
      for (let i = 0; i < 9; i++) {
        const u0 = 0.06 + i * 0.1;
        const x0 = ux(u0);
        const x1 = ux(u0 + 0.1);
        const crest = band * 0.25;
        g.fillStyle = k.a;
        g.beginPath();
        g.moveTo(x0, band);
        g.bezierCurveTo(x0, crest, (x0 + x1) / 2, crest - band * 0.15, x1, band * 0.45);
        g.lineTo(x1, band);
        g.fill();
        g.fillStyle = k.b;
        g.beginPath();
        g.arc((x0 * 0.4 + x1 * 0.6), crest + band * 0.08, band * 0.06, 0, Math.PI * 2);
        g.fill();
      }
    });
  },
  galaxy: (g, k, rnd) => {
    for (let i = 0; i < 14; i++) {
      const x = rnd() * TW;
      const y = rnd() * TH;
      const r = 80 + rnd() * 160;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, (i % 2 ? k.a : k.b) + '99');
      grad.addColorStop(1, (i % 2 ? k.a : k.b) + '00');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 500; i++) g.fillRect(rnd() * TW, rnd() * TH, rnd() < 0.1 ? 3 : 1.5, rnd() < 0.1 ? 3 : 1.5);
  },
  hex: (g, k) => {
    g.strokeStyle = k.a;
    g.lineWidth = 2.5;
    const r = 18;
    const dx = r * Math.sqrt(3);
    for (let row = 0, y = 0; y < TH + r; row++, y += r * 1.5)
      for (let x = row % 2 ? dx / 2 : 0; x < TW + dx; x += dx) {
        g.beginPath();
        for (let j = 0; j < 6; j++) g.lineTo(x + Math.cos(Math.PI / 6 + (j * Math.PI) / 3) * r, y + Math.sin(Math.PI / 6 + (j * Math.PI) / 3) * r);
        g.closePath();
        g.stroke();
      }
  },
  splatter: (g, k, rnd) => {
    for (let i = 0; i < 26; i++) {
      g.fillStyle = i % 2 ? k.a : k.b;
      const x = rnd() * TW;
      const y = rnd() * TH;
      const r = 20 + rnd() * 40;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      for (let j = 0; j < 9; j++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (1.1 + rnd() * 1.4);
        g.beginPath();
        g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + rnd() * 8, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
  dazzle: (g, k, rnd) => {
    g.fillStyle = k.a;
    for (let cell = 0; cell < 8; cell++) {
      const x0 = (cell / 8) * TW;
      const ang = (rnd() - 0.5) * 1.6;
      g.save();
      g.beginPath();
      g.rect(x0, 0, TW / 8 + 1, TH);
      g.clip();
      g.translate(x0 + TW / 16, TH / 2);
      g.rotate(ang);
      for (let s = -TH; s < TH; s += 44) g.fillRect(-TW, s, TW * 2, 20);
      g.restore();
    }
  },
};

/** Decals over the paint: on both flanks unless noted. */
function drawDecal(g: CanvasRenderingContext2D, fx: DecalFx) {
  const ink = css(fx.ink);
  const ink2 = css(fx.ink2);
  const font = (px: number, weight = 800) => `${weight} ${px}px 'Barlow Condensed', system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  switch (fx.kind) {
    case 'wakaba':
    case 'momiji':
      // The Japanese driver marks: a two-colour chevron (beginner) or a four-colour teardrop (elder), on the tail.
      onFlanks(g, (ux, band) => {
        const x = ux(0.86);
        const y = band / 2;
        const s = band * 0.32;
        g.fillStyle = ink;
        g.beginPath();
        g.moveTo(x, y + s);
        g.lineTo(x - s * 0.8, y - s * 0.4);
        g.lineTo(x - s * 0.8, y - s);
        g.lineTo(x, y - s * 0.3);
        g.fill();
        g.fillStyle = ink2;
        g.beginPath();
        g.moveTo(x, y + s);
        g.lineTo(x + s * 0.8, y - s * 0.4);
        g.lineTo(x + s * 0.8, y - s);
        g.lineTo(x, y - s * 0.3);
        g.fill();
      });
      break;
    case 'number':
    case 'roundel':
      onFlanks(g, (ux, band) => {
        const x = ux(0.47);
        const y = band / 2;
        if (fx.kind === 'roundel') {
          g.fillStyle = ink2;
          g.beginPath();
          g.ellipse(x, y, band * 0.42, band * 0.42, 0, 0, Math.PI * 2);
          g.fill();
        } else {
          g.fillStyle = ink2;
          g.fillRect(x - band * 0.5, y - band * 0.42, band, band * 0.84);
        }
        g.fillStyle = ink;
        g.font = font(band * 0.62);
        g.fillText(fx.text ?? '', x, y + band * 0.03);
      });
      break;
    case 'sponsor':
      onFlanks(g, (ux, band) => {
        g.font = font(band * 0.24, 700);
        g.fillStyle = ink2;
        const x = ux(0.6);
        const wdt = g.measureText(fx.text ?? '').width + 24;
        g.fillRect(x - wdt / 2, band * 0.62, wdt, band * 0.3);
        g.fillStyle = ink;
        g.fillText(fx.text ?? '', x, band * 0.775);
      });
      break;
    case 'banner':
      onFlanks(g, (ux, band) => {
        g.fillStyle = ink2;
        g.fillRect(Math.min(ux(0.25), ux(0.75)), band * 0.04, TW * 0.5, band * 0.26);
        g.fillStyle = ink;
        g.font = font(band * 0.22);
        g.fillText(fx.text ?? '', ux(0.5), band * 0.18);
        g.font = font(band * 0.3);
        g.fillText('♛', ux(0.5) - TW * 0.17, band * 0.18);
      });
      break;
    case 'kanji':
      onFlanks(g, (ux, band) => {
        g.font = `900 ${band * 0.85}px 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif`;
        g.lineWidth = band * 0.06;
        g.strokeStyle = ink2;
        g.strokeText(fx.text ?? '', ux(0.68), band / 2);
        g.fillStyle = ink;
        g.fillText(fx.text ?? '', ux(0.68), band / 2);
      });
      break;
    case 'bolt':
      onFlanks(g, (ux, band) => {
        const pts: [number, number][] = [[0.18, 0.2], [0.5, 0.45], [0.46, 0.52], [0.84, 0.8], [0.52, 0.62], [0.56, 0.55], [0.18, 0.2]];
        g.fillStyle = ink;
        g.strokeStyle = ink2;
        g.lineWidth = 4;
        g.beginPath();
        for (const [u, v] of pts) g.lineTo(ux(u), v * band);
        g.fill();
        g.stroke();
      });
      break;
    case 'stars': {
      const star = (x: number, y: number, r: number) => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? r * 0.45 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
      };
      onFlanks(g, (ux, band) => {
        for (let i = 0; i < 6; i++) {
          g.fillStyle = i % 2 ? ink2 : ink;
          star(ux(0.7 + i * 0.04), band * (0.3 + (i % 3) * 0.2), band * (0.16 - i * 0.015));
        }
      });
      break;
    }
    case 'rising':
      onTop(g, () => {
        const cx = TW * 0.12;
        for (let i = 0; i < 16; i++) {
          if (i % 2) continue;
          const a0 = (i / 16) * Math.PI * 2;
          const a1 = ((i + 1) / 16) * Math.PI * 2;
          g.fillStyle = ink;
          g.beginPath();
          g.moveTo(cx, 0);
          g.lineTo(cx + Math.cos(a0) * TW * 0.12, Math.sin(a0) * TH * 0.16);
          g.lineTo(cx + Math.cos(a1) * TW * 0.12, Math.sin(a1) * TH * 0.16);
          g.fill();
        }
        g.fillStyle = ink;
        g.beginPath();
        g.ellipse(cx, 0, TW * 0.035, TH * 0.045, 0, 0, Math.PI * 2);
        g.fill();
      });
      break;
    case 'sakura':
      onFlanks(g, (ux, band) => {
        const rnd = seeded('petals');
        for (let i = 0; i < 14; i++) {
          const x = ux(0.7 + rnd() * 0.25);
          const y = rnd() * band;
          const r = band * (0.05 + rnd() * 0.07);
          g.fillStyle = i % 3 ? ink : ink2;
          g.beginPath();
          g.ellipse(x, y, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'shark':
      onFlanks(g, (ux, band) => {
        // A mouth along the nose: red gums, white teeth.
        g.fillStyle = ink2;
        g.beginPath();
        g.moveTo(ux(0.01), band * 0.35);
        g.quadraticCurveTo(ux(0.12), band * 0.95, ux(0.22), band * 0.5);
        g.quadraticCurveTo(ux(0.12), band * 0.6, ux(0.01), band * 0.35);
        g.fill();
        g.fillStyle = ink;
        for (let i = 0; i < 7; i++) {
          const u = 0.03 + i * 0.026;
          g.beginPath();
          g.moveTo(ux(u), band * 0.48);
          g.lineTo(ux(u + 0.013), band * 0.66);
          g.lineTo(ux(u + 0.026), band * 0.5);
          g.fill();
        }
      });
      break;
    case 'kitsune':
      onTop(g, () => {
        // A fox mask on the hood: face, ears, and red markings.
        const cx = TW * 0.16;
        const s = TH * 0.11;
        g.fillStyle = ink;
        g.beginPath();
        g.moveTo(cx + s * 1.1, 0);
        g.lineTo(cx - s * 0.4, -s);
        g.lineTo(cx - s * 1.1, -s * 0.9);
        g.lineTo(cx - s * 0.7, 0);
        g.lineTo(cx - s * 1.1, s * 0.9);
        g.lineTo(cx - s * 0.4, s);
        g.closePath();
        g.fill();
        g.fillStyle = ink2;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.ellipse(cx - s * 0.1, side * s * 0.35, s * 0.25, s * 0.08, side * 0.4, 0, Math.PI * 2);
          g.fill();
          g.beginPath();
          g.moveTo(cx - s * 0.9, side * s * 0.8);
          g.lineTo(cx - s * 0.5, side * s * 0.7);
          g.lineTo(cx - s * 0.6, side * s * 0.4);
          g.fill();
        }
      });
      break;
  }
}

/** Body paint for a car wearing a paint job or decal; null when it wears neither (the stock path draws it). */
export function cosPaint(owned: OwnedCar): { mat: THREE.MeshPhysicalMaterial; own: { dispose(): void }[] } | null {
  const job = equipped(owned.cos, 'paint');
  const decal = equipped(owned.cos, 'decal');
  if (!job && !decal) return null;
  const look = owned.look;
  const base = job ? job.fx.base : PAINTS[look.paint];
  const mat = job ? finishMaterial(job.fx.finish, base, look) : paintMaterial(look, base);
  const own: { dispose(): void }[] = [];
  const plain = job ? job.fx.pattern === 'solid' : true;
  if (plain && !decal && !look.stripe) return { mat, own };
  const glows = !!(job?.fx.glow || decal?.fx.glow);
  const draw = (g: CanvasRenderingContext2D, dark: boolean) => {
    const inks: Inks = { base: dark ? '#000000' : css(base), a: css(job?.fx.accent ?? 0xffffff), b: css(job?.fx.accent2 ?? 0x111317) };
    g.fillStyle = inks.base;
    g.fillRect(0, 0, TW, TH);
    if (job && (!dark || job.fx.glow)) PATTERNS[job.fx.pattern](g, inks, seeded(job.id));
    if (!dark && look.stripe) stripes(g, look);
    if (decal && (!dark || decal.fx.glow)) drawDecal(g, decal.fx);
  };
  const map = canvas(draw, false, true);
  own.push(map);
  mat.map = map;
  mat.color.set(0xffffff);
  if (glows) {
    const em = canvas(draw, true, true);
    own.push(em);
    mat.emissiveMap = em;
    mat.emissive.set(0xffffff);
    mat.emissiveIntensity = 2.2;
  }
  return { mat, own };
}

function canvas(draw: (g: CanvasRenderingContext2D, dark: boolean) => void, dark: boolean, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = TW;
  c.height = TH;
  draw(c.getContext('2d')!, dark);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The free stripes (Paint & Tune) on top of a paint job, same layout as carparts' stripeTexture. */
function stripes(g: CanvasRenderingContext2D, look: Look) {
  g.fillStyle = css(PAINTS[look.stripeColor]);
  if (look.stripe === 1) for (const v of [0.5 - 0.046, 0.5 + 0.018]) g.fillRect(0, v * TH, TW, 0.028 * TH);
  else
    for (const v of [0.215, 0.785 - 0.024]) {
      g.fillRect(0.1 * TW, v * TH, 0.8 * TW, 0.024 * TH);
      g.fillRect(0.1 * TW, (v + 0.034) * TH, 0.8 * TW, 0.006 * TH);
    }
}

const STOCK_FINISH: Partial<Record<Finish, number>> = { gloss: 0, metallic: 1, matte: 2, pearl: 3 };

function finishMaterial(finish: Finish, base: number, look: Look): THREE.MeshPhysicalMaterial {
  const stock = STOCK_FINISH[finish];
  if (stock !== undefined) return paintMaterial({ ...look, finish: stock }, base);
  const m = paintMaterial({ ...look, finish: 0 }, base);
  if (finish === 'satin') {
    m.metalness = 0.3;
    m.roughness = 0.5;
    m.clearcoat = 0.35;
    m.clearcoatRoughness = 0.3;
  } else if (finish === 'chrome') {
    m.metalness = 1;
    m.roughness = 0.04;
    m.envMapIntensity = 2.2;
  } else if (finish === 'candy') {
    // Deep tinted coat over bright flake.
    m.metalness = 0.6;
    m.roughness = 0.22;
    m.normalMap = flakeTex;
    m.normalScale.set(0.12, 0.12);
    m.sheen = 0.8;
    m.sheenColor = new THREE.Color(base).multiplyScalar(1.6);
  } else if (finish === 'flip') {
    m.metalness = 0.8;
    m.roughness = 0.25;
    m.iridescence = 1;
    m.iridescenceIOR = 2;
    m.iridescenceThicknessRange = [100, 900];
    m.normalMap = flakeTex;
    m.normalScale.set(0.2, 0.2);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Cached, shared materials (one per item)

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) cache.set(key, (m = share(make())));
  return m;
}
const bright = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

export const windowMaterial = (it: ItemOf<'window'>) =>
  cached(it.id, () => {
    const fx = it.fx;
    const m = new THREE.MeshPhysicalMaterial({ color: fx.color, metalness: fx.mirror ? 1 : 0.2, roughness: fx.mirror ? 0.03 : 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: fx.mirror ? 2.2 : 1.8 * (1 - fx.dark * 0.6) });
    if (fx.iri) {
      m.iridescence = 1;
      m.iridescenceIOR = 1.8;
      m.iridescenceThicknessRange = [200, 800];
    }
    return m;
  });

/** Headlamp lens and daytime running light, both brighter than white so the race's bloom catches them. */
export const headMaterials = (it: ItemOf<'head'>) => ({
  head: cached(it.id, () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: it.fx.color, emissiveIntensity: 9 * it.fx.power, roughness: 0.1 })),
  drl: cached(it.id + ':drl', () => new THREE.MeshBasicMaterial({ color: bright(it.fx.color, 8 * it.fx.power) })),
});

export const rimMaterial = (it: ItemOf<'rims'>) =>
  cached(it.id, () =>
    it.fx.glow
      ? new THREE.MeshStandardMaterial({ color: it.fx.color, emissive: it.fx.color, emissiveIntensity: 2.5, metalness: it.fx.metal, roughness: it.fx.rough })
      : new THREE.MeshPhysicalMaterial({ color: it.fx.color, metalness: it.fx.metal, roughness: it.fx.rough, clearcoat: 0.6 }),
  );

export const caliperMaterial = (it: ItemOf<'caliper'>) =>
  cached(it.id, () => new THREE.MeshStandardMaterial({ color: it.fx.color, roughness: 0.35, metalness: 0.3, ...(it.fx.glow ? { emissive: it.fx.color, emissiveIntensity: 2.5 } : {}) }));

export const exhaustMaterials = (it: ItemOf<'exhaust'>) => ({
  pipe: cached(it.id, () => new THREE.MeshStandardMaterial({ color: it.fx.color, metalness: it.fx.metal, roughness: it.fx.rough })),
  hole: it.fx.heat ? cached(it.id + ':heat', () => new THREE.MeshBasicMaterial({ color: bright(it.fx.heat, 5) })) : null,
});

export const frameMaterial = (it: ItemOf<'frame'>) =>
  cached(it.id, () => (it.fx.glow ? new THREE.MeshBasicMaterial({ color: bright(it.fx.color, 4) }) : new THREE.MeshStandardMaterial({ color: it.fx.color, metalness: it.fx.metal, roughness: it.fx.rough })));

export const coverMaterial = (it: ItemOf<'frame'>) =>
  cached(it.id + ':cover', () => new THREE.MeshPhysicalMaterial({ color: 0x050608, transparent: true, opacity: it.fx.cover, roughness: 0.05, clearcoat: 1, depthWrite: false }));

// ---------------------------------------------------------------------------------------------
// Plates

const plateTextures = new Map<string, THREE.CanvasTexture>();

/** A plate in a cosmetic style (cached by style and text; plates are small and few). `glow`: the ink only, on black. */
function plateTexture(text: string, fx: PlateFx, key: string, glow: boolean): THREE.CanvasTexture {
  const k = `${key}|${text}|${glow ? 1 : 0}`;
  let t = plateTextures.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = glow ? '#000' : css(fx.bg);
  g.fillRect(0, 0, 256, 80);
  if (fx.carbon && !glow) {
    for (let y = 0; y < 80; y += 8) for (let x = 0; x < 256; x += 8) if (((x + y) / 8) % 2) g.fillStyle = '#2a2c31', g.fillRect(x, y, 8, 8);
  }
  let left = 0;
  if (fx.band !== undefined) {
    g.fillStyle = glow ? '#000' : css(fx.band);
    g.fillRect(0, 0, 34, 80);
    left = 34;
  }
  g.strokeStyle = css(fx.ink);
  g.lineWidth = 5;
  g.strokeRect(4, 4, 248, 72);
  g.fillStyle = css(fx.ink);
  g.font = "bold 50px 'Barlow Condensed', system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, left + (256 - left) / 2, 42, 256 - left - 26);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  plateTextures.set(k, t);
  return t;
}

/** The rear plate's material for a car wearing a plate style; null for the stock plate. The car owns (disposes) it. */
export function cosPlateMaterial(owned: OwnedCar, stock: string): THREE.MeshStandardMaterial | null {
  const it = equipped(owned.cos, 'plate');
  if (!it) return null;
  const text = owned.plate || it.fx.text || stock;
  const m = new THREE.MeshStandardMaterial({ map: plateTexture(text, it.fx, it.id, false), roughness: 0.4, metalness: 0.1 });
  if (it.fx.glow) {
    m.emissiveMap = plateTexture(text, it.fx, it.id, true);
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 3;
  }
  return m;
}
