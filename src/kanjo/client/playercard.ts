// The player card: click your name top right on the home screens. A trading-card picture of you, your car and
// your driver under the showroom's neon, with your best numbers, drawn into one 1080×1350 canvas so what you see
// is exactly the PNG you download (or share, on a phone). The 3D shot is one offscreen render (car + driver, the
// showroom's lights), released straight after. Best times are records.ts's (the garage store has the account's or
// this browser's); the highs (drift, top speed) are this browser's (highs.ts).

import * as THREE from 'three';
import { CARS, CLASS_COLORS, PAINTS, type OwnedCar, carSpec, peakPower, rating, topSpeed } from '../shared/cars.ts';
import type { Garage } from '../shared/garage.ts';
import { current } from '../shared/garage.ts';
import { COS_ITEMS } from '../shared/cosmetics.ts';
import { TITLES, tierOf } from '../shared/pass.ts';
import { bestBuild, cardBests, winRate } from '../shared/cardstats.ts';
import type { Bests } from '../shared/records.ts';
import type { TrackId } from '../shared/track.ts';
import { TRACK_DEFS } from '../shared/track.ts';
import { esc } from '../../client/menu/ui.ts';
import { buildCar } from './carmodel.ts';
import type { Rider } from '../shared/rider.ts';
import { type DriverRig, loadDriver } from './driver.ts';
import { garageEnvironment } from './showroom.ts';
import { fmtTime, money } from './hud.ts';
import { loadHighs } from './highs.ts';
import { THEME_ART } from './trackart.ts';
import { GAME, ICON } from './brand.ts';

export const CARD = { w: 1080, h: 1350 };
/** The 3D shot's box on the card. */
const SHOT = { y: 118, w: 1080, h: 660 };

const C = {
  ink0: '#05070b',
  ink1: '#0b0f17',
  ink2: '#121926',
  line: 'rgba(255,255,255,0.08)',
  line2: 'rgba(255,255,255,0.16)',
  text: '#eef2f8',
  dim: '#8e9ab0',
  faint: '#5c6779',
  red: '#ff3b30',
  red2: '#ff7a2b',
  cyan: '#38c9ff',
  pink: '#ff3d9a',
  gold: '#ffc940',
};
const DISPLAY = '"Barlow Condensed", system-ui, sans-serif';
const BODY = 'Barlow, system-ui, sans-serif';

export interface CardData {
  name: string;
  guest: boolean;
  car: OwnedCar;
  rider: Rider;
  races: number;
  wins: number;
  money: number;
  cars: number;
  cosmetics: number;
  topKmh: number;
  drift: number;
  best: { name: string; cls: string; pi: number } | null;
  bests: { track: TrackId; name: string; time: number; car: string }[];
  /** Your battle pass title ('' none) and tier. */
  title: string;
  tier: number;
}

/** Everything the card shows, from your garage, your best times and your highs. */
export function cardData(g: Garage, bests: Bests, name: string, guest: boolean, rider: Rider): CardData {
  const rec = loadHighs();
  const top = bestBuild(g.cars);
  return {
    name,
    guest,
    title: g.title ? TITLES[g.title] : '',
    tier: tierOf(g.xp),
    car: current(g),
    rider,
    races: g.races,
    wins: g.wins,
    money: g.money,
    cars: g.cars.length,
    cosmetics: g.cos.length,
    topKmh: rec.topKmh,
    drift: rec.drift,
    best: top ? { name: CARS[top.car.model].name, cls: top.cls, pi: top.pi } : null,
    bests: cardBests(bests, 4),
  };
}

// --- the 3D shot ---------------------------------------------------------------------------------

/** Your car three-quarters from the front with your driver leaning by the door, on a transparent background. */
function renderShot(car: OwnedCar, rider: DriverRig | null, w: number, h: number): HTMLCanvasElement | null {
  let renderer: THREE.WebGLRenderer | null = null;
  const dispose: { dispose(): void }[] = [];
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    const env = garageEnvironment(renderer);
    dispose.push(env);
    scene.environment = env;
    scene.environmentIntensity = 0.75;

    const sp = carSpec(car);
    const model = buildCar(car, null);
    model.root.position.y = sp.cg;
    model.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), -0.32, false);
    model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(model.root);
    dispose.push(model);
    const b = CARS[car.model];
    if (rider) {
      rider.stand();
      rider.root.position.set(b.width / 2 + 0.7, 0, 0.35);
      rider.root.rotation.y = Math.PI * 0.62 - Math.PI; // the rig faces -Z
      rider.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      scene.add(rider.root);
      dispose.push(rider);
    }

    // A floor that only takes shadows, so the car sits on the card's own glow.
    const floorGeo = new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.7 });
    dispose.push(floorGeo, floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x20232c, 0.5));
    const key = new THREE.SpotLight(0xfff6ea, 60, 30, 0.6, 0.8, 1.2);
    key.position.set(3, 9, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rimC = new THREE.DirectionalLight(0x38c9ff, 2.4);
    rimC.position.set(-8, 4, 3);
    const rimM = new THREE.DirectionalLight(0xff3d9a, 2);
    rimM.position.set(8, 4, 4);
    scene.add(rimC, rimM);

    const camera = new THREE.PerspectiveCamera(24, w / h, 0.1, 100);
    const reach = Math.max(b.length, 3.6);
    camera.position.set(reach * 1.1, 1.32, -reach * 1.56);
    camera.lookAt(0.45, 0.82, 0.25);
    renderer.render(scene, camera);
    // Copy it out: losing the context below would blank the WebGL canvas.
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(canvas, 0, 0);
    return out;
  } catch (e) {
    console.warn('Player card: no 3D shot', e);
    return null; // no WebGL: the card still has your name and numbers
  } finally {
    for (const d of dispose) d.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

// --- drawing -------------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const font = (ctx: Ctx, f: string, spacing = 0) => {
  ctx.font = f;
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${spacing}px`;
};

/** A parallelogram leaning forward like the speed-cut buttons (`skew` px of lean over its height). */
function slant(ctx: Ctx, x: number, y: number, w: number, h: number, skew = h * 0.21) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - skew, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/** The card's outline: rounded, with the notched top-right corner (DESIGN.md §4). */
function cardShape(ctx: Ctx, w: number, h: number, r: number, notch: number) {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - notch, 0);
  ctx.lineTo(w, notch);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

/** Text shrunk until it fits `max` px wide. */
function fitText(ctx: Ctx, text: string, x: number, y: number, max: number, size: number, style: (px: number) => string, spacing = 0) {
  let px = size;
  font(ctx, style(px), spacing);
  while (px > 24 && ctx.measureText(text).width > max) {
    px -= 2;
    font(ctx, style(px), spacing);
  }
  ctx.fillText(text, x, y);
}

/** A seeded random from the name, so the same player always gets the same speed lines. */
function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>>= 0) % 10000) / 10000;
  };
}

function background(ctx: Ctx, d: CardData, paint: string) {
  const { w, h } = CARD;
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#0e1420');
  base.addColorStop(0.55, C.ink1);
  base.addColorStop(1, C.ink0);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const glow = (x: number, y: number, r: number, color: string, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  };
  glow(560, 520, 620, paint, 0.42);
  glow(80, 160, 520, C.cyan, 0.22);
  glow(1040, 760, 560, C.pink, 0.2);
  // A broad slash of your paint behind the car.
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = paint;
  slant(ctx, -200, 300, 1500, 300, 220);
  ctx.fill();
  ctx.globalAlpha = 0.06;
  slant(ctx, -200, 640, 1500, 60, 44);
  ctx.fill();
  ctx.restore();
  // The pass, huge and faint.
  font(ctx, `900 640px ${BODY}`);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.textAlign = 'right';
  ctx.fillText('峠', w + 40, 690);
  ctx.textAlign = 'left';
  // Speed lines.
  const rnd = seeded(d.name);
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const y = 140 + rnd() * 700;
    const x = rnd() * w;
    const len = 120 + rnd() * 340;
    ctx.strokeStyle = i % 3 === 0 ? C.cyan : i % 3 === 1 ? C.pink : '#fff';
    ctx.globalAlpha = 0.05 + rnd() * 0.08;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y - len * 0.21);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Scanlines.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

function header(ctx: Ctx, d: CardData) {
  // The hanko, tilted.
  ctx.save();
  ctx.translate(56 + 32, 54 + 32);
  ctx.rotate((-4 * Math.PI) / 180);
  ctx.fillStyle = C.red;
  ctx.shadowColor = 'rgba(255,59,48,0.55)';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.roundRect(-32, -32, 64, 64, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  font(ctx, `700 44px ${BODY}`);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(GAME.hanko, 0, 3);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  font(ctx, `italic 800 56px ${DISPLAY}`, 10);
  ctx.fillText(GAME.name, 140, 106);
  ctx.textAlign = 'right';
  font(ctx, `700 22px ${DISPLAY}`, 5);
  ctx.fillStyle = C.dim;
  ctx.fillText('PLAYER CARD', CARD.w - 92, 82);
  font(ctx, `600 18px ${DISPLAY}`, 3);
  ctx.fillStyle = C.faint;
  const when = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
  ctx.fillText(d.guest ? `GUEST · ${when}` : when, CARD.w - 92, 108);
  ctx.textAlign = 'left';
}

function shot(ctx: Ctx, img: CanvasImageSource | null, paint: string) {
  // The pool of light the car stands in.
  ctx.save();
  ctx.translate(560, SHOT.y + SHOT.h * 0.8);
  ctx.scale(1, 0.18);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 520);
  pool.addColorStop(0, 'rgba(255,255,255,0.22)');
  pool.addColorStop(0.35, paint + '55');
  pool.addColorStop(1, 'transparent');
  ctx.fillStyle = pool;
  ctx.fillRect(-560, -560, 1120, 1120);
  ctx.restore();
  // Neon rings on the floor, like the turntable's.
  ctx.save();
  ctx.translate(560, SHOT.y + SHOT.h * 0.8);
  ctx.scale(1, 0.16);
  for (const [r, c, a] of [
    [480, C.cyan, 0.75],
    [452, C.pink, 0.5],
  ] as const) {
    ctx.strokeStyle = c;
    ctx.globalAlpha = a;
    ctx.lineWidth = 7;
    ctx.shadowColor = c;
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  if (img) ctx.drawImage(img, 0, SHOT.y, SHOT.w, SHOT.h);
  // Fade the bottom of the shot into the card so the name reads over it.
  const fade = ctx.createLinearGradient(0, SHOT.y + SHOT.h - 170, 0, SHOT.y + SHOT.h + 30);
  fade.addColorStop(0, 'rgba(11,15,23,0)');
  fade.addColorStop(1, 'rgba(11,15,23,0.92)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, SHOT.y + SHOT.h - 170, CARD.w, 200);
}

function nameplate(ctx: Ctx, d: CardData) {
  const b = CARS[d.car.model];
  const sp = carSpec(d.car);
  const r = rating(sp);
  // You.
  font(ctx, `700 22px ${DISPLAY}`, 5);
  ctx.fillStyle = C.cyan;
  const label = d.title ? d.title.toUpperCase() : d.guest ? 'GUEST DRIVER' : 'DRIVER';
  ctx.fillText(d.tier ? `${label} · TIER ${d.tier}` : label, 58, 728);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 18;
  fitText(ctx, d.name.toUpperCase(), 52, 832, 600, 124, (px) => `italic 800 ${px}px ${DISPLAY}`, -1);
  ctx.shadowBlur = 0;
  const bar = ctx.createLinearGradient(56, 0, 260, 0);
  bar.addColorStop(0, C.red);
  bar.addColorStop(1, C.red2);
  ctx.fillStyle = bar;
  slant(ctx, 56, 852, 200, 10, 4);
  ctx.fill();
  // Your ride.
  const R = CARD.w - 56;
  ctx.textAlign = 'right';
  font(ctx, `700 20px ${DISPLAY}`, 4);
  ctx.fillStyle = C.dim;
  ctx.fillText(`${b.maker} · ${b.body === 'bike' ? 'BIKE' : b.drive}`.toUpperCase(), R, 728);
  ctx.fillStyle = '#fff';
  fitText(ctx, b.name, R, 780, 360, 50, (px) => `italic 800 ${px}px ${DISPLAY}`);
  // Class badge: the class letter on its colour, then the PI.
  const badgeW = 132;
  const bx = R - badgeW;
  const by = 798;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  slant(ctx, bx, by, badgeW, 44, 9);
  ctx.fill();
  ctx.fillStyle = CLASS_COLORS[r.cls];
  slant(ctx, bx, by, 48, 44, 9);
  ctx.fill();
  ctx.strokeStyle = CLASS_COLORS[r.cls];
  ctx.lineWidth = 2;
  slant(ctx, bx, by, badgeW, 44, 9);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0b0f17';
  font(ctx, `italic 800 32px ${DISPLAY}`);
  ctx.fillText(r.cls, bx + 24, by + 34);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(r.pi), bx + 48 + (badgeW - 48) / 2, by + 34);
  ctx.textAlign = 'right';
  font(ctx, `600 22px ${BODY}`);
  ctx.fillStyle = C.dim;
  ctx.fillText(`${Math.round(peakPower(sp).kw * 1.341)} hp · ${Math.round(topSpeed(sp) * 3.6)} km/h`, bx - 18, by + 31);
  ctx.textAlign = 'left';
}

/** The three big numbers. */
function heroStats(ctx: Ctx, d: CardData) {
  const y = 890;
  const h = 168;
  const gap = 22;
  const w = (CARD.w - 112 - gap * 2) / 3;
  const rate = winRate(d.races, d.wins);
  const tiles: { label: string; value: string; unit?: string; accent: string; bar?: number }[] = [
    { label: 'WINS', value: String(d.wins), accent: C.red },
    { label: 'WIN RATE', value: String(rate), unit: '%', accent: C.cyan, bar: rate / 100 },
    { label: 'RACES', value: String(d.races), accent: '#fff' },
  ];
  tiles.forEach((t, i) => {
    const x = 56 + i * (w + gap);
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, 'rgba(26,35,51,0.92)');
    fill.addColorStop(1, 'rgba(18,25,38,0.92)');
    ctx.fillStyle = fill;
    slant(ctx, x, y, w, h, 30);
    ctx.fill();
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 2;
    ctx.stroke();
    // The accent edge.
    ctx.fillStyle = t.accent;
    ctx.save();
    slant(ctx, x, y, w, h, 30);
    ctx.clip();
    ctx.fillRect(x, y, w, 6);
    ctx.restore();
    font(ctx, `700 22px ${DISPLAY}`, 5);
    ctx.fillStyle = C.dim;
    ctx.fillText(t.label, x + 44, y + 44);
    font(ctx, `italic 800 104px ${DISPLAY}`, -2);
    ctx.fillStyle = '#fff';
    const vx = x + 34;
    const vy = y + 142;
    ctx.fillText(t.value, vx, vy);
    if (t.unit) {
      const vw = ctx.measureText(t.value).width;
      font(ctx, `italic 800 48px ${DISPLAY}`);
      ctx.fillStyle = C.dim;
      ctx.fillText(t.unit, vx + vw + 6, vy);
    }
    if (t.bar !== undefined) {
      // A meter along the bottom edge.
      const bx = x + 24;
      const bw = w - 64;
      const by = y + h - 18;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      slant(ctx, bx, by, bw, 8, 2);
      ctx.fill();
      ctx.fillStyle = C.cyan;
      ctx.shadowColor = C.cyan;
      ctx.shadowBlur = 12;
      slant(ctx, bx, by, Math.max(6, bw * t.bar), 8, 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
}

/** The small numbers, two rows of three, and your personal bests beside them. */
function lowerStats(ctx: Ctx, d: CardData) {
  const y0 = 1092;
  const cells: { label: string; value: string; unit?: string; color?: string }[] = [
    { label: 'TOP SPEED', value: d.topKmh ? String(Math.round(d.topKmh)) : '—', unit: d.topKmh ? 'km/h' : '' },
    { label: 'BEST DRIFT', value: d.drift ? d.drift.toLocaleString('en-US') : '—', unit: d.drift ? 'pts' : '' },
    { label: 'BEST BUILD', value: d.best ? `${d.best.cls} ${d.best.pi}` : '—', color: d.best ? CLASS_COLORS[d.best.cls as keyof typeof CLASS_COLORS] : undefined },
    { label: 'BANK', value: money(d.money), color: C.gold },
    { label: 'GARAGE', value: String(d.cars), unit: d.cars === 1 ? 'car' : 'cars' },
    { label: 'LOCKER', value: String(d.cosmetics), unit: `/${COS_ITEMS.length}` },
  ];
  const cw = 160;
  cells.forEach((c, i) => {
    const x = 56 + (i % 3) * (cw + 8);
    const y = y0 + Math.floor(i / 3) * 92;
    font(ctx, `700 17px ${DISPLAY}`, 3.5);
    ctx.fillStyle = C.dim;
    ctx.fillText(c.label, x, y);
    ctx.fillStyle = c.color ?? '#fff';
    fitText(ctx, c.value, x, y + 46, cw - (c.unit ? 34 : 4), 44, (px) => `italic 800 ${px}px ${DISPLAY}`);
    if (c.unit) {
      const vw = ctx.measureText(c.value).width;
      font(ctx, `600 17px ${BODY}`);
      ctx.fillStyle = C.dim;
      ctx.fillText(c.unit, x + vw + 5, y + 46);
    }
  });
  // Divider.
  ctx.fillStyle = C.line2;
  ctx.fillRect(578, y0 - 26, 2, 196);
  // Personal bests.
  const X = 610;
  const R = CARD.w - 56;
  ctx.fillStyle = C.red;
  ctx.fillRect(X, y0 - 17, 14, 4);
  font(ctx, `700 20px ${DISPLAY}`, 4.5);
  ctx.fillStyle = C.text;
  ctx.fillText('PERSONAL BESTS', X + 24, y0 - 8);
  if (!d.bests.length) {
    font(ctx, `500 22px ${BODY}`);
    ctx.fillStyle = C.dim;
    ctx.fillText('No times yet.', X, y0 + 44);
    ctx.fillText('Finish a race to post one.', X, y0 + 76);
    return;
  }
  d.bests.forEach((b, i) => {
    const y = y0 + 34 + i * 42;
    const accent = THEME_ART[TRACK_DEFS[b.track].theme].accent;
    ctx.fillStyle = accent;
    slant(ctx, X, y - 20, 8, 24, 3);
    ctx.fill();
    font(ctx, `600 22px ${BODY}`);
    ctx.fillStyle = C.text;
    ctx.fillText(b.name, X + 20, y);
    const nw = ctx.measureText(b.name).width;
    font(ctx, `500 16px ${BODY}`);
    ctx.fillStyle = C.faint;
    const carW = R - 150 - (X + 20 + nw + 10);
    if (carW > 40) {
      let car = b.car;
      while (car.length > 3 && ctx.measureText(car).width > carW) car = car.slice(0, -2) + '…';
      ctx.fillText(car, X + 20 + nw + 10, y);
    }
    ctx.textAlign = 'right';
    font(ctx, `italic 800 30px ${DISPLAY}`);
    ctx.fillStyle = '#fff';
    ctx.fillText(fmtTime(b.time), R, y + 2);
    ctx.textAlign = 'left';
    if (i < d.bests.length - 1) {
      ctx.fillStyle = C.line;
      ctx.fillRect(X, y + 14, R - X, 1);
    }
  });
}

function footer(ctx: Ctx) {
  const { w, h } = CARD;
  // The kerb.
  const y = h - 66;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, w, 12);
  ctx.clip();
  for (let x = -40, i = 0; x < w + 40; x += 36, i++) {
    ctx.fillStyle = i % 2 ? '#f4f4f4' : C.red;
    slant(ctx, x, y, 38, 12, 6);
    ctx.fill();
  }
  ctx.restore();
  font(ctx, `700 20px ${DISPLAY}`, 4);
  ctx.fillStyle = C.dim;
  ctx.fillText(location.hostname.toUpperCase(), 56, h - 22); // the site it was made on
  ctx.textAlign = 'right';
  font(ctx, `italic 700 24px ${DISPLAY}`, 1);
  ctx.fillStyle = C.text;
  ctx.fillText('Own the pass.', w - 56, h - 22);
  ctx.textAlign = 'left';
}

/** Draws the whole card into `canvas` (sized to CARD). */
export async function drawPlayerCard(canvas: HTMLCanvasElement, d: CardData) {
  canvas.width = CARD.w;
  canvas.height = CARD.h;
  try {
    await Promise.all([`italic 800 100px ${DISPLAY}`, `700 20px ${DISPLAY}`, `600 20px ${DISPLAY}`, `italic 700 20px ${DISPLAY}`, `600 20px ${BODY}`, `500 20px ${BODY}`].map((f) => document.fonts.load(f)));
  } catch {
    /* system fonts will do */
  }
  const ctx = canvas.getContext('2d')!;
  const paint = hex(PAINTS[d.car.look.paint] ?? PAINTS[0]);
  // Supersampled: the shot is drawn at 1.5× and scaled down for smooth edges.
  // The driver's model loads first (a card without them still draws if it can't).
  const rig = await loadDriver(d.rider).catch(() => null);
  const img = renderShot(d.car, rig, Math.round(SHOT.w * 1.5), Math.round(SHOT.h * 1.5));
  ctx.save();
  cardShape(ctx, CARD.w, CARD.h, 28, 56);
  ctx.clip();
  background(ctx, d, paint);
  header(ctx, d);
  shot(ctx, img, paint);
  nameplate(ctx, d);
  heroStats(ctx, d);
  lowerStats(ctx, d);
  footer(ctx);
  ctx.restore();
  // The edge: a hairline with a neon catch on the notch.
  cardShape(ctx, CARD.w - 2, CARD.h - 2, 27, 55);
  ctx.save();
  ctx.translate(1, 1);
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  const edge = ctx.createLinearGradient(CARD.w - 260, 0, CARD.w, 260);
  edge.addColorStop(0, 'transparent');
  edge.addColorStop(0.5, C.cyan);
  edge.addColorStop(1, 'transparent');
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CARD.w - 300, 1.5);
  ctx.lineTo(CARD.w - 56, 1.5);
  ctx.lineTo(CARD.w - 1.5, 56);
  ctx.lineTo(CARD.w - 1.5, 300);
  ctx.stroke();
}

/** A file name for the PNG: kanjo-<name>.png. */
export const cardFileName = (name: string) => `kanjo-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'driver'}.png`;

const DOWNLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Opens the card in the hub's modal: the canvas (it tilts under the pointer, with a sheen), Download PNG, Share
 * where the browser can share files, and Account. `close` is the hub's (it puts the modal away).
 */
export function openPlayerCard(modal: HTMLElement, d: CardData, on: { close(): void; account(): void }) {
  modal.innerHTML = `<div class="tg-pcard" data-nav-scope data-pcard role="dialog" aria-modal="true" aria-label="Your player card">
    <div class="tg-pcard-tilt" data-tilt>
      <canvas class="tg-pcard-canvas" width="${CARD.w}" height="${CARD.h}" role="img" aria-label="${esc(`Player card for ${d.name}: ${d.wins} wins from ${d.races} races`)}"></canvas>
      <i class="tg-pcard-sheen" aria-hidden="true"></i>
      <p class="tg-pcard-loading" data-loading>Printing your card…</p>
    </div>
    <div class="tg-pcard-act">
      <button class="tg-go" data-pcard-save data-autofocus disabled>${DOWNLOAD}Download PNG</button>
      <button class="tg-pill" data-pcard-share hidden>${SHARE}Share</button>
      <button class="tg-pill" data-pcard-account>${ICON.user}${d.guest ? 'Sign in' : 'Account'}</button>
      <button class="tg-pill" data-pcard-close>Close</button>
    </div>
    <p class="tg-pcard-status" role="status" data-pcard-status></p>
  </div>`;
  modal.hidden = false;
  const q = <T extends HTMLElement>(s: string) => modal.querySelector<T>(s)!;
  const canvas = q<HTMLCanvasElement>('.tg-pcard-canvas');
  const save = q<HTMLButtonElement>('[data-pcard-save]');
  const share = q<HTMLButtonElement>('[data-pcard-share]');
  const status = q('[data-pcard-status]');
  q('[data-pcard-close]').addEventListener('click', on.close);
  q('[data-pcard-account]').addEventListener('click', on.account);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) on.close();
  });
  save.focus({ preventScroll: true });

  // Tilt toward the pointer, with the sheen following it.
  const tilt = q('[data-tilt]');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) {
    tilt.addEventListener('pointermove', (e) => {
      const r = tilt.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
      tilt.style.setProperty('--ry', `${(x * 12).toFixed(2)}deg`);
      tilt.style.setProperty('--sx', `${((x + 0.5) * 100).toFixed(1)}%`);
      tilt.style.setProperty('--sy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
    tilt.addEventListener('pointerleave', () => {
      for (const p of ['--rx', '--ry', '--sx', '--sy']) tilt.style.removeProperty(p);
    });
  }

  let blob: Promise<Blob | null> | null = null;
  const file = cardFileName(d.name);
  const png = () => (blob ??= new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png')));

  // Draw after the modal has painted, so "Printing" shows while the 3D shot renders.
  requestAnimationFrame(() =>
    setTimeout(async () => {
      await drawPlayerCard(canvas, d);
      if (!canvas.isConnected) return;
      q('[data-loading]').remove();
      tilt.classList.add('ready');
      save.disabled = false;
      const b = await png();
      if (b && navigator.canShare?.({ files: [new File([b], file, { type: 'image/png' })] })) share.hidden = false;
    }, 30),
  );

  save.addEventListener('click', async () => {
    const b = await png();
    if (!b) return void (status.textContent = "Couldn't make the picture.");
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status.textContent = `Saved ${file}`;
  });
  share.addEventListener('click', async () => {
    const b = await png();
    if (!b) return;
    try {
      await navigator.share({ files: [new File([b], file, { type: 'image/png' })], title: 'My KANJO card' });
    } catch {
      /* cancelled */
    }
  });
}
