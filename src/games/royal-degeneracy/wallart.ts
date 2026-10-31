// What's on the bedroom walls: each housemate's posters, pennants, corkboards, tapestries and records, hung by
// themselves on the bare stretches of wall (clear of windows, doors, wardrobes and shelves). Every piece is drawn
// into one canvas atlas, and the lot is a single merged mesh: one draw call for the whole house's wall art.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOXES, DOORS, FLOOR_Y, ROOMS, WINDOWS, type Room } from './house.ts';
import { ramp } from './people.ts';

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;
interface Piece {
  w: number;
  h: number;
  paint: Paint;
}

const text = (g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, weight = 900, font = 'system-ui') => {
  g.font = `${weight} ${size}px ${font}, sans-serif`;
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
};

/** A bold poster: a two-colour gradient, a few shapes, a title and a line under it. */
const poster = (title: string, sub: string, a: string, b: string, ink = '#fff'): Piece => ({
  w: 0.55,
  h: 0.78,
  paint(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.arc(w * 0.5, h * 0.42, w * 0.32, 0, Math.PI * 2);
    g.fill();
    text(g, title, w / 2, h * 0.42, Math.min(h * 0.14, (w * 1.6) / title.length), ink);
    text(g, sub, w / 2, h * 0.84, Math.min(h * 0.06, (w * 1.7) / sub.length), ink, 600);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  },
});

/** A felt pennant, its point to the right. */
const pennant = (word: string, bg: string, ink: string): Piece => ({
  w: 0.8,
  h: 0.3,
  paint(g, w, h) {
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, h / 2);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = ink;
    g.fillRect(0, 0, w * 0.06, h);
    text(g, word, w * 0.42, h / 2, h * 0.36, ink, 900, 'Georgia');
  },
});

/** A corkboard with polaroids, a ticket stub and sticky notes, pinned at angles. */
const cork = (seed: number, notes: string[]): Piece => ({
  w: 0.7,
  h: 0.5,
  paint(g, w, h) {
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#b98a58';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 30},30,0.4)`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    for (let i = 0; i < 5; i++) {
      g.save();
      g.translate(w * (0.15 + 0.18 * i), h * (0.3 + r() * 0.4));
      g.rotate((r() - 0.5) * 0.5);
      if (i % 2) {
        g.fillStyle = '#f4f1e8';
        g.fillRect(-28, -32, 56, 64);
        g.fillStyle = `hsl(${r() * 360},45%,55%)`;
        g.fillRect(-23, -27, 46, 42);
      } else {
        g.fillStyle = ['#fff27a', '#ff9ec7', '#9ee7ff'][i % 3];
        g.fillRect(-30, -30, 60, 60);
        text(g, notes[(i / 2) % notes.length], 0, 0, 13, '#333', 700);
      }
      g.fillStyle = '#d02a2a';
      g.beginPath();
      g.arc(0, -26, 5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.strokeStyle = '#6a4a2a';
    g.lineWidth = 12;
    g.strokeRect(0, 0, w, h);
  },
});

/** A mandala tapestry, the uniform of the stoner dorm room. */
const tapestry = (a: string, b: string): Piece => ({
  w: 1.3,
  h: 0.95,
  paint(g, w, h) {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    for (let ring = 6; ring > 0; ring--) {
      g.fillStyle = ring % 2 ? b : a;
      const R = (h * 0.46 * ring) / 6;
      g.beginPath();
      for (let k = 0; k <= 48; k++) {
        const t = (k / 48) * Math.PI * 2;
        const rr = R * (1 + 0.08 * Math.sin(t * 12));
        g.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
      }
      g.fill();
    }
    g.fillStyle = b;
    for (let x = 6; x < w; x += 18) g.fillRect(x, h - 10, 8, 10);
  },
});

/** A row of framed record sleeves: [sleeve, art, label] each. */
const records = (sleeves: [string, string, string][]): Piece => ({
  w: 0.36 * sleeves.length,
  h: 0.34,
  paint(g, w, h) {
    g.clearRect(0, 0, w, h);
    const s = w / sleeves.length;
    sleeves.forEach(([bg, art, label], i) => {
      const x = i * s;
      g.fillStyle = '#111';
      g.fillRect(x + 4, 0, s - 8, h);
      g.fillStyle = bg;
      g.fillRect(x + 10, 6, s - 20, h - 12);
      g.fillStyle = art;
      g.beginPath();
      g.arc(x + s * 0.62, h * 0.4, s * 0.24, 0, Math.PI * 2);
      g.fill();
      text(g, label, x + s / 2, h * 0.82, Math.min(h * 0.12, (s * 1.3) / label.length), '#fff');
    });
  },
});

/** A whiteboard of maths nobody wiped off. */
const whiteboard = (lines: string[]): Piece => ({
  w: 0.9,
  h: 0.6,
  paint(g, w, h) {
    g.fillStyle = '#f6f7f8';
    g.fillRect(0, 0, w, h);
    lines.forEach((l, i) => text(g, l, w / 2, h * (0.2 + i * 0.22), h * 0.11, ['#1a3a9a', '#b02020', '#1a7a3a'][i % 3], 600, 'Comic Sans MS'));
    g.strokeStyle = '#9aa0a8';
    g.lineWidth = 10;
    g.strokeRect(0, 0, w, h);
  },
});

/** A rising chart: mikol's crypto. */
const chart: Piece = {
  w: 0.7,
  h: 0.5,
  paint(g, w, h) {
    g.fillStyle = '#0e1420';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a3a52';
    g.lineWidth = 2;
    for (let y = 30; y < h; y += 30) g.strokeRect(0, y, w, 0);
    g.strokeStyle = '#3cff8a';
    g.lineWidth = 6;
    g.beginPath();
    const pts = [0.85, 0.8, 0.88, 0.7, 0.74, 0.55, 0.6, 0.4, 0.45, 0.18, 0.1];
    pts.forEach((p, i) => g.lineTo((i / (pts.length - 1)) * w, p * h));
    g.stroke();
    text(g, 'HODL', w * 0.25, h * 0.2, h * 0.16, '#ffd84a');
  },
};

/** A string of fairy lights, drawn as a soft glowing line of bulbs. */
const lights: Piece = {
  w: 1.4,
  h: 0.16,
  paint(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.3 + Math.sin((x / w) * Math.PI * 3) * h * 0.18);
    g.stroke();
    for (let i = 0; i < 14; i++) {
      const x = ((i + 0.5) / 14) * w;
      const y = h * 0.3 + Math.sin((x / w) * Math.PI * 3) * h * 0.18 + 12;
      g.fillStyle = ['#ffd24a', '#ff6a9a', '#7affc8', '#8ab4ff'][i % 4];
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
    }
  },
};

/** A printed list taped to the wall, edited in pen by everyone since. */
const list = (title: string, items: string[]): Piece => ({
  w: 0.5,
  h: 0.7,
  paint(g, w, h) {
    g.fillStyle = '#fbfaf4';
    g.fillRect(0, 0, w, h);
    text(g, title, w / 2, h * 0.08, h * 0.06, '#222');
    g.textAlign = 'left';
    items.forEach((s, i) => {
      g.font = `${i % 3 === 2 ? '600 ' : '500 '}${h * 0.034}px ${i % 3 === 2 ? 'Comic Sans MS' : 'system-ui'}, sans-serif`;
      g.fillStyle = i % 3 === 2 ? '#c02020' : '#333';
      g.fillText(`${i + 1}. ${s}`, w * 0.08, h * (0.18 + i * 0.075), w * 0.86);
    });
    g.fillStyle = 'rgba(230,220,160,0.7)';
    g.fillRect(w * 0.4, -4, w * 0.2, 18);
  },
});

/** A dartboard, darts nowhere near the middle. */
const dartboard: Piece = {
  w: 0.45,
  h: 0.45,
  paint(g, w, h) {
    g.clearRect(0, 0, w, h);
    const c = w / 2;
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 20; i++) {
      for (const [r0, r1, a, b] of [[0.9, 0.82, '#c02a2a', '#1a8a3a'], [0.82, 0.55, '#111', '#f0e6c8'], [0.55, 0.5, '#c02a2a', '#1a8a3a'], [0.5, 0.12, '#111', '#f0e6c8']] as const) {
        g.fillStyle = i % 2 ? a : b;
        g.beginPath();
        g.arc(c, c, c * r0, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
        g.arc(c, c, c * r1, ((i + 1) / 20) * Math.PI * 2, (i / 20) * Math.PI * 2, true);
        g.fill();
      }
    }
    g.fillStyle = '#c02a2a';
    g.beginPath();
    g.arc(c, c, c * 0.06, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd84a';
    for (const [x, y] of [[0.2, 0.3], [0.86, 0.66], [0.62, 0.14]]) g.fillRect(x * w - 3, y * h - 3, 7, 7);
  },
};

/** Who hangs what, room by room (in the order it goes up, biggest first). */
const ART: Record<string, Piece[]> = {
  dev: [cork(3, ['DEADLINE', 'tobog. wax', 'call mum']), poster('CONCRETE TOBOGGAN', 'Team 2019 · Sled Happens', '#3a5a8a', '#14243e')],
  mikol: [chart, poster('TO THE MOON', 'not financial advice', '#2a1a5a', '#0a0a1a', '#ffd84a'), pennant('282', '#8a1a2a', '#f2d24a')],
  xang: [tapestry('#3a1a5a', '#e2a23a'), poster('BONGUS', 'he is coming', '#1a6a3a', '#0a2a1a'), lights],
  selby: [tapestry('#1a4a5a', '#e86a8a'), poster('BIKE STU', 'open late · no one leaves', '#c2402a', '#4a1a12'), cork(9, ['who is Kev?', 'rent!!', 'studio 2am'])],
  will: [poster('CAMPUS LEGEND', 'est. frosh week', '#e8b02a', '#8a4a10', '#2a1a10'), pennant('DEAN’S LIST', '#1a2a5a', '#f4f0e4'), cork(5, ['interview', 'gym 6am', 'charity gala'])],
  jung: [whiteboard(['e^iπ + 1 = 0', '∫ beer dx = ?', 'STOP TOUCHING MY PAN']), poster('ANDREW 3–0', 'never forget', '#5a5a62', '#1a1a1e')],
  landing: [
    list('HOUSE RULES', ['Rinse your pan', 'Bins out Tuesday', 'the raccoon is NOT a pet', 'No bongs on the stairs', 'Quiet after 2am', 'who keeps doing this', 'Rent on the 1st', 'Lock the back door', 'WHO DRANK MY SPONSORSHIP']),
    dartboard,
  ],
  hall3: [list('CHORE CHART', ['Bins: Jung', 'Bathroom: Wags', 'Kitchen: Dev', 'nobody did these', 'Recycling: Xang', 'Floors: Will?', 'Will has never', 'Sink: everyone', 'Raccoon: Selby']), poster('282 FOREVER', 'the best worst house', '#5a3a9a', '#1a1030')],
  wags: [records([['#e2c23a', '#c0302a', 'SIDE A'], ['#2a7ab0', '#f4f0e4', 'DISCO'], ['#d85a8a', '#1a1a1e', 'B-SIDES'], ['#1a1a1e', '#e8e0c8', 'LIVE ’79']]), poster('DON’T PANIC', 'it’s only a deadline', '#4aa86a', '#1a4a2a'), lights],
};

/** Where a room's wall face is on one side: the inside face of the wall boxes along that edge. */
function face(room: Room, side: 'x0' | 'x1' | 'z0' | 'z1'): number | null {
  const fy = FLOOR_Y[room.floor] + 1.5;
  const axis = side[0] as 'x' | 'z';
  const at = side === 'x0' ? room.min.x : side === 'x1' ? room.max.x : side === 'z0' ? room.min.z : room.max.z;
  const other = axis === 'x' ? 'z' : 'x';
  const lo = room.min[other];
  const hi = room.max[other];
  let best: number | null = null;
  for (const b of BOXES) {
    // Only walls running along this edge (thin across it), not the ones meeting it end on.
    if (b.kind !== 'wall' || b.min.y > fy || b.max.y < fy || b.max[axis] - b.min[axis] > 0.4) continue;
    if (b.min[axis] > at + 0.2 || b.max[axis] < at - 0.2 || b.max[other] < lo || b.min[other] > hi) continue;
    const f = side.endsWith('0') ? b.max[axis] : b.min[axis];
    best = best === null ? f : side.endsWith('0') ? Math.max(best, f) : Math.min(best, f);
  }
  return best;
}

/** Is the stretch [a, b] of this wall bare at hanging height (no window, door, tall furniture or other art)? */
function bare(room: Room, side: 'x0' | 'x1' | 'z0' | 'z1', c: number, a: number, b: number, y0: number, y1: number, used: [string, number, number][]) {
  const axis = side[0] as 'x' | 'z';
  const along = axis === 'x' ? 'z' : 'x';
  if (a < room.min[along] + 0.25 || b > room.max[along] - 0.25) return false;
  for (const [s, u0, u1] of used) if (s === side && u1 > a - 0.15 && u0 < b + 0.15) return false;
  // Windows and doors sit on a wall line running along `along`.
  // (Curtains hang well past a window's sides; a door has its casing.)
  for (const [list, pad] of [[WINDOWS, 0.5], [DOORS, 0.2]] as const) {
    for (const o of list) {
      if (o.floor !== room.floor || o.axis !== along) continue;
      const line = axis === 'x' ? o.x : o.z;
      const mid = axis === 'x' ? o.z : o.x;
      if (Math.abs(line - c) < 0.35 && mid + o.w / 2 + pad > a && mid - o.w / 2 - pad < b) return false;
    }
  }
  for (const box of BOXES) {
    if (box.kind === 'wall' || box.max.y < y0 || box.min.y > y1) continue;
    const near = side.endsWith('0') ? box.min[axis] < c + 0.7 && box.max[axis] > c - 0.05 : box.max[axis] > c - 0.7 && box.min[axis] < c + 0.05;
    if (near && box.max[along] > a && box.min[along] < b) return false;
  }
  return true;
}

/** Hangs everyone's art. Returns the merged mesh and what to dispose. */
export function buildArt(): { mesh: THREE.Mesh; owned: { dispose(): void }[] } {
  const CELL = 256;
  const GRID = 8;
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = CELL * GRID;
  const g = atlas.getContext('2d')!;
  const geos: THREE.BufferGeometry[] = [];
  let n = 0;
  for (const room of ROOMS) {
    const pieces = ART[room.id];
    if (!pieces) continue;
    // Dev's Hendrix poster (props.ts) is already up on his back wall.
    const used: [string, number, number][] = room.id === 'dev' ? [['z0', 6.95, 7.65]] : [];
    const SIDES = ['x1', 'z0', 'x0', 'z1'] as const;
    for (const [pi, p] of pieces.entries()) {
      const y = FLOOR_Y[room.floor] + (p.h < 0.2 ? 2.1 : 1.55);
      const y0 = y - p.h / 2;
      const y1 = y + p.h / 2;
      let spot: { side: 'x0' | 'x1' | 'z0' | 'z1'; c: number; m: number } | null = null;
      // Each piece starts on the next wall round, so the room's art spreads out.
      for (const side of SIDES.map((_, k) => SIDES[(k + pi) % 4])) {
        const c = face(room, side);
        if (c === null) continue;
        const along = side[0] === 'x' ? 'z' : 'x';
        const mid = (room.min[along] + room.max[along]) / 2;
        // Try from the middle of the wall outwards.
        for (let k = 0; k < 40 && !spot; k++) {
          const m = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2;
          if (bare(room, side, c, m - p.w / 2, m + p.w / 2, y0, y1, used)) spot = { side, c, m };
        }
        if (spot) break;
      }
      if (!spot || n >= GRID * GRID) continue;
      used.push([spot.side, spot.m - p.w / 2, spot.m + p.w / 2]);
      // Paint it into its atlas cell, keeping its shape.
      const cw = p.w >= p.h ? CELL : Math.round((CELL * p.w) / p.h);
      const ch = p.w >= p.h ? Math.round((CELL * p.h) / p.w) : CELL;
      const cx = (n % GRID) * CELL;
      const cy = Math.floor(n / GRID) * CELL;
      g.save();
      g.translate(cx, cy);
      g.beginPath();
      g.rect(0, 0, cw, ch);
      g.clip();
      p.paint(g, cw, ch);
      g.restore();
      n++;
      const geo = new THREE.PlaneGeometry(p.w, p.h);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      const S = CELL * GRID;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i) * cw) / S, 1 - (cy + (1 - uv.getY(i)) * ch) / S);
      const out = spot.side.endsWith('0') ? 0.012 : -0.012;
      const yaw = spot.side === 'x0' ? Math.PI / 2 : spot.side === 'x1' ? -Math.PI / 2 : spot.side === 'z0' ? 0 : Math.PI;
      geo.rotateY(yaw);
      if (spot.side[0] === 'x') geo.translate(spot.c + out, y, spot.m);
      else geo.translate(spot.m, y, spot.c + out);
      geos.push(geo);
    }
  }
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp(), transparent: true, alphaTest: 0.1 });
  const geo = geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
  for (const g2 of geos) g2.dispose();
  return { mesh: new THREE.Mesh(geo, mat), owned: [tex, mat, geo] };
}
