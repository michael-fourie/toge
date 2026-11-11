// Building walls: city towers, flats and village houses. Each kind is drawn on canvases as four cells, three wall
// styles and a street-level strip of shopfronts, and packed into two array textures (a layer per cell: colour with the
// glass in its alpha, and the glow). A building picks its style per vertex (the `fac` attribute: style, the street's
// height, the roof's height) and `facadeMaterial` patches the material's shader to read the right layer: walls in
// their style, the bottom FAC_SHOP metres from the shops, a dark parapet band under the roof. That's no extra draw
// calls and the same two texture reads a pixel the walls always made (array layers wrap on their own, so there's no
// atlas seam to work round). Glass keeps the material's roughness and metalness, walls are matte, so offices shine
// and concrete doesn't.

import * as THREE from 'three';
import type { Theme } from '../shared/track.ts';
import { mulberry, tileNoise } from './tracktextures.ts';

/** One facade tile in metres: towers are 4 bays (8 windows) by 4 floors, flats and houses 4 bays by 4 storeys. */
export const TOWER_W = 14;
export const TOWER_H = 14;
export const FACADE_W = 16;
export const FACADE_H = 12;
/** The shop strip's height (m) above the street. */
export const FAC_SHOP = 4.5;
/** Wall styles per atlas (cell 3 is the shops). */
export const FAC_STYLES = 3;
/** A `fac` base far below anything: no shop strip (village houses). */
export const NO_SHOPS = -1e4;

const A = 1024;
const C = 512;
type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): Ctx {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

/** The canvas corner of atlas cell k (cells 0, 1 along the bottom of the texture, 2, 3 along the top: uv y is up). */
const cellXY = (k: number) => [(k % 2) * C, k < 2 ? C : 0] as const;

/** Colour, glow and glass mask, painted cell by cell, then packed into two textures. */
interface Atlas {
  c: Ctx;
  e: Ctx;
  m: Ctx;
}

function atlas(): Atlas {
  const a = { c: canvas(A, A), e: canvas(A, A), m: canvas(A, A) };
  a.e.fillStyle = '#000';
  a.e.fillRect(0, 0, A, A);
  a.m.fillStyle = '#000';
  a.m.fillRect(0, 0, A, A);
  return a;
}

/** Runs `paint` with every layer's origin at cell k's corner and clipped to it. */
function inCell(a: Atlas, k: number, paint: () => void) {
  const [x, y] = cellXY(k);
  for (const g of [a.c, a.e, a.m]) {
    g.save();
    g.beginPath();
    g.rect(x, y, C, C);
    g.clip();
    g.translate(x, y);
  }
  paint();
  for (const g of [a.c, a.e, a.m]) g.restore();
}

/** A surface of noise into cell k: base grey `v`, blotches `blot`, grain `grain`, warm/cool cast. */
function surface(a: Atlas, k: number, seed: number, v: number, blot: number, grain: number, cast: [number, number, number]) {
  const [ox, oy] = cellXY(k);
  const img = a.c.getImageData(ox, oy, C, C);
  const noise = tileNoise(seed);
  const rnd = mulberry(seed + 5);
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const n = v + (noise(x / 24, y / 24, 21.333) - 0.5) * blot + (noise(x / 5, y / 5, 102.4) - 0.5) * blot * 0.4 + (rnd() - 0.5) * grain;
      img.data.set([n * cast[0], n * cast[1], n * cast[2], 255], (y * C + x) * 4);
    }
  a.c.putImageData(img, ox, oy);
}

/** Rain streaks: dark runs down from y0 (cell coordinates), fading out, wrapping across the cell's width. */
function streaks(g: Ctx, rnd: () => number, n: number, y0: () => number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * C;
    const y = y0();
    const len = 20 + rnd() * 90;
    const w = 2 + rnd() * 6;
    const grad = g.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(30,28,25,${alpha * (0.5 + rnd() * 0.5)})`);
    grad.addColorStop(1, 'rgba(30,28,25,0)');
    g.fillStyle = grad;
    for (const dx of [0, -C, C]) g.fillRect(x + dx, y, w, len);
  }
}

/** A pane of glass at (x, y, w, h): sky reflection, a glint, marked in the mask; lit (glow colour) or not. */
function pane(a: Atlas, rnd: () => number, x: number, y: number, w: number, h: number, tone: [string, string, string], glow: string | null, glowAlpha = 1) {
  const g = a.c;
  const grad = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  grad.addColorStop(0, tone[0]);
  grad.addColorStop(0.55, tone[1]);
  grad.addColorStop(1, tone[2]);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  // A diagonal glint across some panes: the sky caught at an angle.
  if (rnd() < 0.35) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    const s = x + rnd() * w;
    g.beginPath();
    g.moveTo(s, y);
    g.lineTo(s + w * 0.25, y);
    g.lineTo(s - w * 0.35, y + h);
    g.lineTo(s - w * 0.6, y + h);
    g.fill();
    g.restore();
  }
  a.m.fillStyle = '#fff';
  a.m.fillRect(x, y, w, h);
  if (glow) {
    const fall = a.e.createLinearGradient(x, y, x, y + h);
    fall.addColorStop(0, glow);
    fall.addColorStop(0.2, glow);
    fall.addColorStop(1, 'rgba(40,40,48,0.6)');
    a.e.globalAlpha = glowAlpha;
    a.e.fillStyle = fall;
    a.e.fillRect(x, y, w, h);
    a.e.globalAlpha = 1;
    // Blinds part way down, now and then a figure or a plant against the light.
    a.e.fillStyle = 'rgba(0,0,0,0.6)';
    a.e.fillRect(x, y, w, h * rnd() * 0.4);
    if (rnd() < 0.18) a.e.fillRect(x + w * (0.2 + rnd() * 0.5), y + h * 0.45, w * 0.16, h * 0.55);
  }
}

/** Packs the layers: colour + glass mask in alpha, and the glow map. */
export interface Facade {
  /** Colour (alpha: 1 glass, 0 wall), one layer per cell. */
  map: THREE.DataArrayTexture;
  glow: THREE.DataArrayTexture;
}

/** Packs the cells into layers of two array textures: colour + glass mask in alpha, and the glow. Rows go bottom
 * up (array textures aren't flipped on upload), so v runs up the wall as on the canvas. */
function pack(a: Atlas): Facade {
  const layers = (g: Ctx, mask: Ctx | null) => {
    const data = new Uint8Array(C * C * 4 * 4);
    for (let k = 0; k < 4; k++) {
      const [x, y] = cellXY(k);
      const px = g.getImageData(x, y, C, C).data;
      const m = mask?.getImageData(x, y, C, C).data;
      for (let row = 0; row < C; row++) {
        const src = (C - 1 - row) * C * 4;
        const dst = (k * C * C + row * C) * 4;
        data.set(px.subarray(src, src + C * 4), dst);
        if (m) for (let i = 0; i < C; i++) data[dst + i * 4 + 3] = m[src + i * 4];
      }
    }
    const t = new THREE.DataArrayTexture(data, C, C, 4);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: layers(a.c, a.m), glow: layers(a.e, null) };
}

// ---------------------------------------------------------------------------------------------
// Prints: shop signs, posters, graffiti

const SHOP_NAMES = [
  ['RAMEN', 'ラーメン'],
  ['CAFE', 'カフェ'],
  ['SUSHI', '寿司'],
  ['BOOKS', '本屋'],
  ['TUNE', 'チューン'],
  ['PHARMACY', '薬局'],
  ['ARCADE', 'ゲーム'],
  ['MART', 'マート'],
  ['IZAKAYA', '居酒屋'],
  ['PARTS', '部品'],
  ['BAKERY', 'パン'],
  ['KARAOKE', 'カラオケ'],
];
const SIGN_COLOURS = ['#d7263d', '#1b6fd6', '#f4c430', '#2e933c', '#f26b1d', '#7a3fd1', '#111318', '#e9e4d8', '#0f8b8d', '#c2185b'];
const POSTER_COLOURS = ['#ff2d7a', '#29b6f6', '#ffd23a', '#9c4dff', '#ff5a1f', '#39d98a', '#f2f2f2', '#222'];

/** A poster: a coloured sheet with a band of type, a block of picture, a strip of small print. */
function poster(g: Ctx, rnd: () => number, x: number, y: number, w: number, h: number) {
  const bg = POSTER_COLOURS[Math.floor(rnd() * POSTER_COLOURS.length)];
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  g.fillStyle = POSTER_COLOURS[Math.floor(rnd() * POSTER_COLOURS.length)];
  g.fillRect(x + w * 0.1, y + h * 0.28, w * 0.8, h * 0.42);
  g.fillStyle = bg === '#f2f2f2' || bg === '#ffd23a' ? '#111' : '#fff';
  g.font = `900 ${Math.max(6, Math.round(h * 0.16))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(['LIVE', 'SALE', 'DRIFT', 'TOUR', 'NEW', 'MIDNIGHT', 'GP', 'TOGE'][Math.floor(rnd() * 8)], x + w / 2, y + h * 0.15);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 0; k < 3; k++) g.fillRect(x + w * 0.15, y + h * (0.76 + k * 0.07), w * (0.4 + rnd() * 0.4), Math.max(1, h * 0.025));
  // Weathered: a torn corner and a fade.
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(x, y, w, h);
}

/** Spray-paint tags: loopy strokes in a couple of colours with a dark outline. */
function graffiti(g: Ctx, rnd: () => number, x: number, y: number, w: number, h: number) {
  const cols = ['#ff3d81', '#35d0ff', '#ffe14a', '#7cff6b', '#ff7b2b', '#c27bff', '#ffffff'];
  for (let pass = 0; pass < 2; pass++) {
    const r2 = mulberry(Math.floor(x * 7 + y * 13));
    g.strokeStyle = pass ? cols[Math.floor(rnd() * cols.length)] : 'rgba(10,10,12,0.9)';
    g.lineWidth = pass ? h * 0.09 : h * 0.15;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    let px = x + w * 0.05;
    let py = y + h * (0.3 + r2() * 0.4);
    g.moveTo(px, py);
    while (px < x + w * 0.95) {
      const nx = px + w * (0.06 + r2() * 0.1);
      const ny = y + h * (0.15 + r2() * 0.7);
      g.quadraticCurveTo(px + (r2() - 0.5) * w * 0.2, y + h * r2(), nx, ny);
      px = nx;
      py = ny;
    }
    g.stroke();
  }
}

/** A fascia sign over a shopfront: a coloured board with the name in Latin and kana. Glows (dimmer by day). */
function fascia(a: Atlas, rnd: () => number, x: number, y: number, w: number, h: number) {
  const [en, jp] = SHOP_NAMES[Math.floor(rnd() * SHOP_NAMES.length)];
  const bg = SIGN_COLOURS[Math.floor(rnd() * SIGN_COLOURS.length)];
  const light = bg === '#f4c430' || bg === '#e9e4d8';
  const g = a.c;
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x, y + h - 2, w, 2);
  const ink = light ? '#15171c' : '#ffffff';
  g.fillStyle = ink;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
  const tw = Math.min(g.measureText(en).width, w * 0.55);
  g.fillText(en, x + w * 0.06, y + h * 0.52, w * 0.55);
  g.font = `700 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
  g.fillText(jp, x + w * 0.1 + tw, y + h * 0.54, w * 0.32);
  // The glow: the letters and a soft wash of the board.
  a.e.fillStyle = bg;
  a.e.globalAlpha = 0.18;
  a.e.fillRect(x, y, w, h);
  a.e.globalAlpha = 1;
  a.e.fillStyle = light ? bg : '#ffffff';
  a.e.textAlign = 'left';
  a.e.textBaseline = 'middle';
  a.e.font = `900 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
  a.e.fillText(en, x + w * 0.06, y + h * 0.52, w * 0.55);
}

/** Street level, C x C for `metresW` x FAC_SHOP m: shopfronts with signs and awnings, a shuttered one, a lobby door,
 * posters and tags between them. Painted at true proportions on a strip, then stretched up to the square cell. */
function shops(a: Atlas, seed: number, metresW: number, warm: boolean) {
  const rnd = mulberry(seed + 401);
  const H = Math.round((C * FAC_SHOP) / metresW);
  const s = { c: canvas(C, H), e: canvas(C, H), m: canvas(C, H) };
  s.e.fillStyle = '#000';
  s.e.fillRect(0, 0, C, H);
  s.m.fillStyle = '#000';
  s.m.fillRect(0, 0, C, H);
  const px = C / metresW; // pixels per metre
  // Stone cladding with a dark plinth.
  const noise = tileNoise(seed + 9);
  const img = s.c.createImageData(C, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < C; x++) {
      const v = 150 + (noise(x / 10, y / 10, 51.2) - 0.5) * 30 + (rnd() - 0.5) * 14;
      img.data.set([v * 1.02, v, v * 0.96, 255], (y * C + x) * 4);
    }
  s.c.putImageData(img, 0, 0);
  s.c.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < C; x += px * 1.2) s.c.fillRect(x, 0, 1, H);
  s.c.fillStyle = '#2b2d31';
  s.c.fillRect(0, H - px * 0.35, C, px * 0.35);
  // Units along the strip: shops 3-5.5 m wide with a pier between, wrapping exactly at the cell's width.
  const units: [number, number, number][] = [];
  let x = 0;
  while (x < C - 2.5 * px) {
    const w = Math.min((3 + rnd() * 2.5) * px, C - x - 0.6 * px);
    units.push([x + 0.3 * px, w, Math.floor(rnd() * 10)]);
    x += w + 0.6 * px;
  }
  const a2 = s as unknown as Atlas;
  const signY = H - px * 4.3;
  const signH = px * 0.75;
  const doorTop = H - px * 3.1;
  for (const [ux, uw, kind] of units) {
    if (kind < 2) {
      // Shuttered: a corrugated roller shutter, tagged.
      s.c.fillStyle = '#8d9096';
      s.c.fillRect(ux, doorTop - px * 0.3, uw, H - doorTop + px * 0.3 - px * 0.35);
      for (let y = doorTop; y < H - px * 0.35; y += 3) {
        s.c.fillStyle = 'rgba(0,0,0,0.18)';
        s.c.fillRect(ux, y, uw, 1);
      }
      graffiti(s.c, rnd, ux + uw * 0.08, doorTop + px * 0.6, uw * 0.84, px * 1.3);
      s.c.fillStyle = '#2f3237';
      s.c.fillRect(ux - 2, doorTop - px * 0.6, uw + 4, px * 0.3);
    } else if (kind === 2) {
      // A building's lobby: tall glass doors, a steel canopy, the address plate.
      pane(a2, rnd, ux + uw * 0.15, doorTop - px * 0.4, uw * 0.7, H - doorTop - px * 0.05, ['#2e3a46', '#56687a', '#1d242c'], warm ? '#ffe2b0' : '#e8f0ff', 0.45);
      s.c.fillStyle = '#c9cdd2';
      for (const f of [0.15, 0.5, 0.85]) s.c.fillRect(ux + uw * f - 1.5, doorTop - px * 0.4, 3, H - doorTop);
      s.c.fillStyle = '#34373c';
      s.c.fillRect(ux, doorTop - px * 0.75, uw, px * 0.3);
      s.e.fillStyle = '#fff6dc';
      s.e.fillRect(ux + uw * 0.1, doorTop - px * 0.48, uw * 0.8, 2);
    } else {
      // A shop: fascia, shop window with stuff on display, a door, maybe an awning, posters in the glass.
      fascia(a2, rnd, ux, signY, uw, signH);
      const wy = signY + signH + px * 0.25;
      const lit = rnd() < 0.85;
      pane(a2, rnd, ux + px * 0.1, wy, uw - px * 0.2, H - wy - px * 0.45, ['#33404c', '#5b6c7c', '#20272f'], null);
      if (lit) {
        const fall = s.e.createLinearGradient(0, wy, 0, H);
        const tone = warm || rnd() < 0.5 ? '#ffd9a0' : '#e6f1ff';
        fall.addColorStop(0, tone);
        fall.addColorStop(1, 'rgba(90,70,50,0.7)');
        s.e.fillStyle = fall;
        s.e.globalAlpha = 0.3;
        s.e.fillRect(ux + px * 0.1, wy, uw - px * 0.2, H - wy - px * 0.45);
        s.e.globalAlpha = 1;
      }
      // Inside: shelves of goods as blocks of colour (glowing in their own colours when the shop's lit).
      for (let k = 0; k < 3; k++) {
        const sy = wy + (H - wy - px * 0.45) * (0.35 + k * 0.22);
        for (let gx = ux + px * 0.3; gx < ux + uw - px * 0.4; gx += 4 + rnd() * 6) {
          const gh = 3 + rnd() * px * 0.35;
          const gw = 3 + rnd() * 3;
          const col = POSTER_COLOURS[Math.floor(rnd() * POSTER_COLOURS.length)];
          s.c.fillStyle = col;
          s.c.globalAlpha = 0.55;
          s.c.fillRect(gx, sy - gh, gw, gh);
          s.c.globalAlpha = 1;
          if (lit) {
            s.e.fillStyle = col;
            s.e.globalAlpha = 0.6;
            s.e.fillRect(gx, sy - gh, gw, gh);
            s.e.globalAlpha = 1;
          }
        }
        if (lit) {
          s.e.fillStyle = 'rgba(0,0,0,0.7)';
          s.e.fillRect(ux + px * 0.1, sy, uw - px * 0.2, 2);
        }
      }
      // Mullions and the door (a darker leaf to one side).
      s.c.fillStyle = '#2a2c30';
      s.c.fillRect(ux + px * 0.1, wy, uw - px * 0.2, 2);
      const dx = rnd() < 0.5 ? ux + px * 0.2 : ux + uw - px * 1.2;
      s.c.fillRect(dx - 1, wy, 2, H - wy - px * 0.45);
      s.c.fillRect(dx + px * 1.0 - 1, wy, 2, H - wy - px * 0.45);
      s.e.fillStyle = '#000';
      for (const mx of [ux + px * 0.1, dx - 1, dx + px * 1.0 - 1]) s.e.fillRect(mx, wy, 2, H - wy - px * 0.45);
      // Posters and a menu stuck in the window.
      if (rnd() < 0.7) poster(s.c, rnd, ux + uw * (0.45 + rnd() * 0.3), wy + px * 0.4, px * 0.5, px * 0.7);
      if (kind > 6) {
        // A striped awning over the window (painted: a band and its shadow).
        const ac = SIGN_COLOURS[Math.floor(rnd() * 6)];
        for (let k = 0; k < uw; k += px * 0.4) {
          s.c.fillStyle = (k / (px * 0.4)) % 2 < 1 ? ac : '#f1ece2';
          s.c.fillRect(ux + k, wy - px * 0.05, Math.min(px * 0.4, uw - k), px * 0.45);
        }
        s.c.fillStyle = 'rgba(0,0,0,0.3)';
        s.c.fillRect(ux, wy + px * 0.4, uw, px * 0.25);
        s.e.fillStyle = '#000';
        s.e.fillRect(ux, wy - px * 0.05, uw, px * 0.45);
      }
    }
  }
  // Posters pasted on the piers and a tag low on the wall here and there, then grime splashed up from the street.
  for (let k = 0; k < units.length; k++) {
    const [ux] = units[k];
    if (rnd() < 0.5) poster(s.c, rnd, ux - px * 0.28, H - px * 2.4, px * 0.5, px * 0.75);
  }
  const grime = s.c.createLinearGradient(0, H - px * 1.2, 0, H);
  grime.addColorStop(0, 'rgba(25,22,18,0)');
  grime.addColorStop(1, 'rgba(25,22,18,0.35)');
  s.c.fillStyle = grime;
  s.c.fillRect(0, H - px * 1.2, C, px * 1.2);
  // A cornice between the shops and the floors above.
  s.c.fillStyle = '#5d6066';
  s.c.fillRect(0, 0, C, px * 0.18);
  s.c.fillStyle = 'rgba(255,255,255,0.25)';
  s.c.fillRect(0, px * 0.18, C, 2);
  inCell(a, 3, () => {
    for (const [dst, src] of [
      [a.c, s.c],
      [a.e, s.e],
      [a.m, s.m],
    ] as const) {
      dst.imageSmoothingEnabled = true;
      dst.drawImage(src.canvas, 0, 0, C, H, 0, 0, C, C);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// City towers

const OFFICE_TONES = ['#dfe9ff', '#dfe9ff', '#ffd9a0', '#ffe6c2', '#bfefff'];
const GLASS_TONE: [string, string, string] = ['#2c3846', '#4a5a6c', '#1c242e'];

/**
 * City towers (TOWER_W x TOWER_H m per cell). Styles: 0 a glass curtain wall between mullions and spandrels,
 * 1 a concrete frame with punched windows, 2 ribbon windows between bands of stone. The colour map is near white (each
 * tower's colour tints it); the glow lights about half the offices, a floor at a time, in a few light colours.
 */
export function towerFacade(seed: number): Facade {
  const a = atlas();
  const rnd = mulberry(seed + 77);
  const floor = C / 4;
  const floorLight = () => {
    const lit = rnd() < 0.25 ? 0.95 : rnd() < 0.3 ? 0.08 : 0.55;
    return { lit, tone: OFFICE_TONES[Math.floor(rnd() * OFFICE_TONES.length)] };
  };
  // 0: curtain wall.
  inCell(a, 0, () => {
    a.c.fillStyle = '#d4d6d8';
    a.c.fillRect(0, 0, C, C);
    const bay = C / 8;
    for (let f = 0; f < 4; f++) {
      const { lit, tone } = floorLight();
      // The spandrel: a fritted panel with a fine pattern.
      const sy = f * floor;
      a.c.fillStyle = '#b9bdc2';
      a.c.fillRect(0, sy, C, floor * 0.2);
      a.c.fillStyle = 'rgba(0,0,0,0.08)';
      for (let x = 0; x < C; x += 4) a.c.fillRect(x, sy + 2, 1, floor * 0.2 - 4);
      for (let b = 0; b < 8; b++) {
        const x = b * bay + 3;
        pane(a, rnd, x, sy + floor * 0.2, bay - 6, floor * 0.76, GLASS_TONE, rnd() < lit ? tone : null, 0.5 + rnd() * 0.5);
      }
      a.c.fillStyle = 'rgba(255,255,255,0.35)';
      a.c.fillRect(0, sy + floor * 0.2 - 2, C, 2);
    }
    // Mullions with a lit edge.
    for (let b = 0; b <= 8; b++) {
      a.c.fillStyle = '#9aa0a6';
      a.c.fillRect(b * bay - 3, 0, 6, C);
      a.c.fillStyle = 'rgba(255,255,255,0.4)';
      a.c.fillRect(b * bay - 3, 0, 1, C);
    }
    streaks(a.c, rnd, 26, () => Math.floor(rnd() * 4) * floor + floor * 0.18, 0.18);
  });
  // 1: concrete frame, punched windows, a few air-con units and vents.
  surface(a, 1, seed + 11, 196, 34, 16, [1, 0.985, 0.96]);
  inCell(a, 1, () => {
    const bay = C / 4;
    for (let f = 0; f < 4; f++) {
      const { lit, tone } = floorLight();
      const sy = f * floor;
      // Formwork joints and tie holes.
      a.c.fillStyle = 'rgba(0,0,0,0.12)';
      a.c.fillRect(0, sy, C, 2);
      for (let b = 0; b < 4; b++) {
        for (const k of [0, 1]) {
          const x = b * bay + 10 + k * (bay / 2 - 4);
          const w = bay / 2 - 16;
          const y = sy + floor * 0.22;
          const h = floor * 0.6;
          a.c.fillStyle = '#5e6166';
          a.c.fillRect(x - 3, y - 3, w + 6, h + 6);
          pane(a, rnd, x, y, w, h, ['#29323c', '#46525f', '#1a2027'], rnd() < lit ? tone : null, 0.5 + rnd() * 0.5);
          a.c.fillStyle = '#3d4045';
          a.c.fillRect(x + w / 2 - 1, y, 2, h);
          a.c.fillStyle = 'rgba(255,255,255,0.45)';
          a.c.fillRect(x - 5, y + h + 3, w + 10, 3); // sill
        }
        if (rnd() < 0.3) {
          // An air-con unit under a window.
          const x = b * bay + 14 + rnd() * (bay - 40);
          a.c.fillStyle = '#e7e7e2';
          a.c.fillRect(x, sy + floor * 0.86, 22, 14);
          a.c.fillStyle = 'rgba(0,0,0,0.35)';
          a.c.beginPath();
          a.c.arc(x + 14, sy + floor * 0.86 + 7, 5, 0, Math.PI * 2);
          a.c.fill();
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 6; k++) {
        a.c.fillStyle = 'rgba(0,0,0,0.18)';
        a.c.fillRect(((i * 4 + k) * 37) % C, (i * 131 + k * 59) % C, 2, 2);
      }
    }
    streaks(a.c, rnd, 40, () => Math.floor(rnd() * 4) * floor + floor * 0.86, 0.3);
  });
  // 2: ribbon windows between stone bands, with vertical fins.
  surface(a, 2, seed + 21, 210, 24, 12, [1.02, 1, 0.95]);
  inCell(a, 2, () => {
    for (let f = 0; f < 4; f++) {
      const { lit, tone } = floorLight();
      const sy = f * floor;
      const y = sy + floor * 0.3;
      const h = floor * 0.5;
      // Stone joints in the band.
      a.c.fillStyle = 'rgba(0,0,0,0.1)';
      for (let x = 0; x < C; x += 64) a.c.fillRect(x + ((f * 32) % 64), sy, 1, floor * 0.3);
      a.c.fillRect(0, sy + floor * 0.15, C, 1);
      for (let k = 0; k < 8; k++) pane(a, rnd, k * 64, y, 64, h, ['#2d3a44', '#51626f', '#1d252d'], rnd() < lit ? tone : null, 0.5 + rnd() * 0.5);
      a.c.fillStyle = '#2b2e33';
      a.c.fillRect(0, y - 3, C, 3);
      a.c.fillRect(0, y + h, C, 3);
      a.c.fillStyle = 'rgba(255,255,255,0.4)';
      a.c.fillRect(0, y + h + 3, C, 2);
    }
    // Fins every two panes, standing proud (a lit side and a shadow side).
    for (let x = 0; x < C; x += 128) {
      a.c.fillStyle = '#e6e3dc';
      a.c.fillRect(x, 0, 8, C);
      a.c.fillStyle = 'rgba(0,0,0,0.22)';
      a.c.fillRect(x + 8, 0, 6, C);
      a.e.fillStyle = '#000';
      a.e.fillRect(x, 0, 14, C);
      a.m.fillStyle = '#000';
      a.m.fillRect(x, 0, 14, C);
    }
    streaks(a.c, rnd, 24, () => Math.floor(rnd() * 4) * floor + floor * 0.82, 0.2);
  });
  shops(a, seed, TOWER_W, false);
  return pack(a);
}

// ---------------------------------------------------------------------------------------------
// Flats and houses

/**
 * Flats and houses (FACADE_W x FACADE_H m per cell, 4 bays by 4 storeys). Styles: 0 plaster with windows (shoji on
 * the Japanese passes), 1 an apartment block with balconies, 2 tiled walls with shutters (the coast and desert) or
 * board-and-batten timber (the passes). Colour near white, tinted per building; glow lights a few windows.
 */
export function facade(seed: number, theme: Theme): Facade {
  const a = atlas();
  const rnd = mulberry(seed + 31);
  const shoji = theme !== 'coast' && theme !== 'desert';
  const bayW = C / 4;
  const stH = C / 4;
  const warm = () => (rnd() < 0.7 ? '#ffb45a' : '#fff1c9');
  /** A window at bay bx, storey sy: frame, glass, sill; lit now and then (shoji grids on the passes). */
  const win = (bx: number, sy: number, wf: number, hf: number, frame: string) => {
    const ww = bayW * wf;
    const wh = stH * hf;
    const wx = bx * bayW + (bayW - ww) / 2;
    const wy = sy * stH + stH * 0.22;
    a.c.fillStyle = frame;
    a.c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    const lit = rnd() < 0.45;
    pane(a, rnd, wx, wy, ww, wh, ['#2a3440', '#46525e', '#1b2128'], null);
    a.c.fillStyle = frame;
    a.c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    a.c.fillStyle = 'rgba(255,255,255,0.5)';
    a.c.fillRect(wx - 4, wy + wh + 3, ww + 8, 3);
    if (lit) {
      a.e.fillStyle = warm();
      a.e.fillRect(wx, wy, ww, wh);
      if (shoji) {
        a.e.fillStyle = 'rgba(40,20,0,0.85)';
        for (let k = 1; k < 4; k++) a.e.fillRect(wx + (ww * k) / 4 - 1, wy, 2, wh);
        for (let k = 1; k < 3; k++) a.e.fillRect(wx, wy + (wh * k) / 3 - 1, ww, 2);
      }
      a.e.fillStyle = 'rgba(0,0,0,0.5)';
      a.e.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      // Curtains half drawn.
      a.e.fillStyle = 'rgba(60,30,10,0.6)';
      a.e.fillRect(wx, wy, ww * 0.18, wh);
    }
    return [wx, wy, ww, wh] as const;
  };
  // 0: plaster, rain streaked, windows, the odd air-con unit and a drainpipe.
  surface(a, 0, seed + 3, 228, 22, 12, [1, 0.98, 0.95]);
  inCell(a, 0, () => {
    for (let sy = 0; sy < 4; sy++) {
      a.c.fillStyle = 'rgba(60,50,40,0.25)';
      a.c.fillRect(0, sy * stH, C, 4);
      for (let bx = 0; bx < 4; bx++) {
        if (rnd() < 0.15) continue;
        const [wx, wy, ww, wh] = win(bx, sy, 0.56, 0.5, '#3a3229');
        if (rnd() < 0.25) {
          a.c.fillStyle = '#ecebe6';
          a.c.fillRect(wx + ww + 6, wy + wh - 16, 20, 14);
          a.c.fillStyle = 'rgba(0,0,0,0.3)';
          a.c.fillRect(wx + ww + 9, wy + wh - 13, 10, 8);
        }
      }
    }
    a.c.fillStyle = '#6b6f73';
    a.c.fillRect(bayW * 2 - 2, 0, 5, C);
    a.c.fillStyle = 'rgba(255,255,255,0.3)';
    a.c.fillRect(bayW * 2 - 2, 0, 1, C);
    streaks(a.c, rnd, 30, () => Math.floor(rnd() * 4) * stH + stH * 0.8, 0.22);
  });
  // 1: an apartment block: balconies along each storey (railings, washing, plants), sliding doors behind.
  surface(a, 1, seed + 13, 222, 18, 10, [0.99, 0.98, 0.97]);
  inCell(a, 1, () => {
    for (let sy = 0; sy < 4; sy++) {
      const y0 = sy * stH;
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * bayW + 8;
        const w = bayW - 16;
        pane(a, rnd, x, y0 + stH * 0.12, w, stH * 0.72, ['#2b3540', '#4b5865', '#1b2229'], rnd() < 0.4 ? warm() : null, 0.8);
        a.c.fillStyle = '#d9d6cf';
        a.c.fillRect(x + w / 2 - 2, y0 + stH * 0.12, 4, stH * 0.72);
      }
      // The balcony: a slab and a railing over the lower half of the doors.
      a.c.fillStyle = '#c9c6bf';
      a.c.fillRect(0, y0 + stH * 0.84, C, stH * 0.16);
      a.c.fillStyle = 'rgba(0,0,0,0.25)';
      a.c.fillRect(0, y0 + stH * 0.84, C, 3);
      a.e.fillStyle = '#000';
      a.e.fillRect(0, y0 + stH * 0.5, C, stH * 0.5);
      a.m.fillStyle = '#000';
      a.m.fillRect(0, y0 + stH * 0.5, C, stH * 0.5);
      a.c.fillStyle = 'rgba(220,224,228,0.85)';
      a.c.fillRect(0, y0 + stH * 0.5, C, 3);
      for (let x = 0; x < C; x += 6) {
        a.c.fillStyle = 'rgba(70,74,80,0.85)';
        a.c.fillRect(x, y0 + stH * 0.5, 2, stH * 0.34);
      }
      // Dividers between flats, washing on a line, potted plants.
      for (let bx = 0; bx <= 4; bx++) {
        a.c.fillStyle = '#bdb9b1';
        a.c.fillRect(bx * bayW - 3, y0 + stH * 0.1, 6, stH * 0.9);
      }
      for (let bx = 0; bx < 4; bx++) {
        if (rnd() < 0.45) {
          for (let k = 0; k < 4; k++) {
            a.c.fillStyle = POSTER_COLOURS[Math.floor(rnd() * POSTER_COLOURS.length)];
            a.c.fillRect(bx * bayW + 14 + k * 22 + rnd() * 6, y0 + stH * 0.3, 12, 14 + rnd() * 12);
          }
        }
        if (rnd() < 0.5) {
          a.c.fillStyle = '#3d6b35';
          a.c.beginPath();
          a.c.arc(bx * bayW + 20 + rnd() * (bayW - 40), y0 + stH * 0.48, 9, 0, Math.PI * 2);
          a.c.fill();
        }
      }
    }
    streaks(a.c, rnd, 26, () => Math.floor(rnd() * 4) * stH + stH, 0.2);
  });
  // 2: tiles and shutters by the sea and in the desert; dark timber boards on the passes.
  if (shoji) surface(a, 2, seed + 23, 150, 30, 18, [0.86, 0.74, 0.62]);
  else surface(a, 2, seed + 23, 232, 14, 10, [1, 0.97, 0.92]);
  inCell(a, 2, () => {
    if (shoji) {
      // Board and batten: vertical boards, a lighter plaster band under the eaves of each storey.
      for (let x = 0; x < C; x += 16) {
        a.c.fillStyle = 'rgba(0,0,0,0.22)';
        a.c.fillRect(x, 0, 3, C);
        a.c.fillStyle = 'rgba(255,255,255,0.06)';
        a.c.fillRect(x + 3, 0, 2, C);
      }
      for (let sy = 0; sy < 4; sy++) {
        a.c.fillStyle = '#e8e1d2';
        a.c.fillRect(0, sy * stH, C, stH * 0.12);
        for (let bx = 0; bx < 4; bx++) if (rnd() > 0.2) win(bx, sy, 0.6, 0.48, '#2a2119');
      }
    } else {
      // Square tiles, then windows with louvred shutters either side.
      for (let y = 0; y < C; y += 16) {
        a.c.fillStyle = 'rgba(0,0,0,0.07)';
        a.c.fillRect(0, y, C, 1);
      }
      for (let x = 0; x < C; x += 16) a.c.fillRect(x, 0, 1, C);
      const shut = ['#2f6b9a', '#3c7a4f', '#a2452f', '#6b4a8a'][Math.floor(rnd() * 4)];
      for (let sy = 0; sy < 4; sy++)
        for (let bx = 0; bx < 4; bx++) {
          if (rnd() < 0.15) continue;
          const [wx, wy, ww, wh] = win(bx, sy, 0.4, 0.52, '#e9e4da');
          for (const sx of [wx - ww * 0.5 - 4, wx + ww + 4]) {
            a.c.fillStyle = shut;
            a.c.fillRect(sx, wy - 2, ww * 0.5, wh + 4);
            a.c.fillStyle = 'rgba(0,0,0,0.25)';
            for (let k = 2; k < wh; k += 5) a.c.fillRect(sx + 2, wy + k, ww * 0.5 - 4, 1);
          }
          if (rnd() < 0.3) {
            // A flower box.
            a.c.fillStyle = '#7a4a2a';
            a.c.fillRect(wx - 2, wy + wh + 6, ww + 4, 7);
            for (let k = 0; k < 5; k++) {
              a.c.fillStyle = ['#e04b6b', '#f2c94c', '#ffffff', '#c25cd6'][Math.floor(rnd() * 4)];
              a.c.fillRect(wx + k * (ww / 5) + 2, wy + wh + 1, 5, 5);
            }
          }
        }
    }
    streaks(a.c, rnd, 22, () => Math.floor(rnd() * 4) * stH + stH * 0.78, 0.18);
  });
  shops(a, seed + 1, FACADE_W, true);
  return pack(a);
}

// ---------------------------------------------------------------------------------------------
// Roofs

/** Roofs seen from above, ROOF_TILE m square: a membrane in sheets, gravel, vents, plant, a skylight, a hatch. */
export const ROOF_TILE = 24;
export function roofDeck(seed: number): THREE.CanvasTexture {
  const S = 512;
  const g = canvas(S, S);
  const rnd = mulberry(seed + 909);
  const noise = tileNoise(seed + 15);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const v = 120 + (noise(x / 20, y / 20, 25.6) - 0.5) * 40 + (rnd() - 0.5) * 30;
      img.data.set([v, v * 0.99, v * 0.97, 255], (y * S + x) * 4);
    }
  g.putImageData(img, 0, 0);
  // Sheet seams.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < S; x += 64) g.fillRect(x, 0, 2, S);
  // Plant: boxes with shadows (the shadow falls the same way on every roof).
  for (let k = 0; k < 7; k++) {
    const x = rnd() * (S - 60);
    const y = rnd() * (S - 60);
    const w = 18 + rnd() * 40;
    const h = 14 + rnd() * 30;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 5, y + 5, w, h);
    g.fillStyle = ['#c9cbcc', '#a7abb0', '#8e9399', '#d8d2c4'][k % 4];
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    if (k % 2) {
      // A fan grille.
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2);
      g.fill();
    } else for (let l = 3; l < h; l += 4) g.fillRect(x + 2, y + l, w - 4, 1);
  }
  // A skylight and vents.
  g.fillStyle = '#2d3a46';
  g.fillRect(S * 0.62, S * 0.7, 70, 40);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(S * 0.62, S * 0.7, 70, 4);
  for (let k = 0; k < 10; k++) {
    g.fillStyle = '#5b5f64';
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 3 + rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Planar roof uv from positions (x, z in ROOF_TILE m; y leans them so a box's sides aren't a smear). */
export function roofUv(pos: ArrayLike<number>): Float32Array {
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    uv[j] = (pos[i] + pos[i + 1] * 0.7) / ROOF_TILE;
    uv[j + 1] = (pos[i + 2] + pos[i + 1] * 0.7) / ROOF_TILE;
  }
  return uv;
}

// ---------------------------------------------------------------------------------------------
// The shader

/** Pushes one wall vertex's `fac` (style, street height, roof height) n times. */
export function pushFac(out: number[], n: number, style: number, base: number, top: number) {
  for (let k = 0; k < n; k++) out.push(style, base, top);
}

/** The wall matte (walls; glass keeps the material's own roughness and metalness). */
const WALL_ROUGH = 0.88;

const VERT_HEAD = 'attribute vec3 fac;\nvarying vec3 vFac;\nvarying float vFacY;\nvarying vec2 vFacUv;';
const FRAG_HEAD = `uniform highp sampler2DArray facMap;
uniform highp sampler2DArray facGlow;
varying vec3 vFac;
varying float vFacY;
varying vec2 vFacUv;
vec3 facAt;
float facGlass = 1.0;
float facLip = 0.0;`;
const FRAG_MAP = `{
  // Which layer: the shops for the bottom FAC_SHOP m, else the building's style (rounded: the interpolated value
  // wobbles round its whole number).
  float above = vFacY - vFac.y;
  facAt = vec3(vFacUv, floor(vFac.x + 0.5));
  if (above < ${FAC_SHOP.toFixed(2)}) {
    facAt = vec3(vFacUv.x, above / ${FAC_SHOP.toFixed(2)}, 3.0);
    // Shopfronts keep their own colours, not the tower's tint.
    #ifdef USE_COLOR
      diffuseColor.rgb /= max(vColor.rgb, vec3(0.2));
    #endif
  }
  vec4 tex = texture(facMap, facAt);
  facGlass = tex.a;
  facLip = step(vFac.z - vFacY, 0.9);
  diffuseColor.rgb *= tex.rgb * (1.0 - 0.5 * facLip);
}`;

/**
 * Makes `m` draw buildings whose geometry carries `uv` (facade tiles) and `fac` (pushFac), with facade `f`.
 * `m` takes no map of its own: its emissive colour and intensity scale the glow layers, and its roughness and
 * metalness are the glass's. Low graphics' Lambert copy takes the same patch (lowgfx.ts copies onBeforeCompile).
 */
export function facadeMaterial<T extends THREE.MeshStandardMaterial>(m: T, f: Facade): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.facMap = { value: f.map };
    shader.uniforms.facGlow = { value: f.glow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = fac;\nvFacY = position.y;\nvFacUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture(facGlow, facAt).rgb * (1.0 - facLip);')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(${WALL_ROUGH.toFixed(2)}, roughnessFactor, facGlass);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= facGlass;');
  };
  // One program for every facade material (each keeps its own textures in its own uniforms).
  m.customProgramCacheKey = () => 'facade';
  return m;
}
