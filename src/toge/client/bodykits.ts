// Bolt-on body parts from the Aero Case (and friends): rear wings, hood scoops and vents, roof gear, front lips and
// splitters, side skirts and arch flares, mudflaps. Built in body space from the car's own shape (the Kit helpers:
// k.top / k.height / k.z / k.front / k.cabin), so one part fits every car. Pure looks: nothing here touches physics.

import * as THREE from 'three';
import type { OwnedCar } from '../shared/cars.ts';
import { type ItemOf, type PartLook, equipped } from '../shared/cosmetics.ts';
import { MAT, rbox, share } from './carparts.ts';
import type { Design, Kit } from './carkits.ts';

const cache = new Map<string, THREE.Material>();
const cached = <T extends THREE.Material>(key: string, make: () => T): T => {
  let m = cache.get(key) as T | undefined;
  if (!m) cache.set(key, (m = share(make())));
  return m;
};

/** What a part is made of: the car's paint, carbon, chrome or a coloured clear-coated plastic. */
function partMat(look: PartLook, k: Kit): THREE.Material {
  if (look.mat === 'paint') return k.paint;
  if (look.mat === 'carbon') return MAT.carbon;
  if (look.mat === 'chrome') return MAT.chrome;
  const c = look.color ?? 0x888888;
  return cached(`part:${c}`, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
}

/** An edge light: brighter than white so the race's bloom catches it. */
const glowMat = (c: number) => cached(`glow:${c}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(6) }));

/** Marks a mesh as a light (no shadow), like the car's own lamps. */
function lit(m: THREE.Mesh): THREE.Mesh {
  m.userData.glow = true;
  return m;
}

const tube = (pts: [number, number, number][], r: number) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 20, r, 8);

/** Where the deck (or a hatch's roof edge) carries a wing: the same spot the stock spoilers use. */
function wingBase(k: Kit, d: Design) {
  const onRoof = !!d.roofSpoiler;
  const t = onRoof ? d.roofR + 0.02 : 0.955;
  return { onRoof, y: onRoof ? k.H : k.top(t), z: k.z(t) };
}

/** True when a cosmetic wing replaces the stock spoiler. */
export const hasWing = (owned: OwnedCar) => !!equipped(owned.cos, 'wing');

/** Adds every equipped body part to the car. */
export function bodyKit(k: Kit, d: Design, owned: OwnedCar) {
  const wing = equipped(owned.cos, 'wing');
  if (wing) buildWing(k, d, wing);
  const hood = equipped(owned.cos, 'hood');
  if (hood) buildHood(k, d, hood);
  const roof = equipped(owned.cos, 'roof');
  if (roof) buildRoof(k, d, roof);
  const lip = equipped(owned.cos, 'lip');
  if (lip) buildLip(k, lip);
  const skirts = equipped(owned.cos, 'skirts');
  if (skirts) buildSides(k, skirts);
  const flaps = equipped(owned.cos, 'flaps');
  if (flaps) buildFlaps(k, flaps);
}

function buildWing(k: Kit, d: Design, it: ItemOf<'wing'>) {
  const { W } = k;
  const fx = it.fx;
  const m = partMat(fx, k);
  const b = wingBase(k, d);
  const plane = (y: number, z: number, span: number, chord: number, pitch: number) => {
    k.put(rbox(span, 0.035, chord, 0.015), m, [0, y, z], [pitch, 0, 0]);
    if (fx.glow !== undefined) lit(k.put(rbox(span * 0.98, 0.012, 0.012, 0.004), glowMat(fx.glow), [0, y + 0.004, z + chord / 2], [pitch, 0, 0]));
  };
  const plates = (y: number, z: number, h: number, depth: number) => k.put(rbox(0.02, h, depth, 0.01), m, [W * 0.9, y, z], [0, 0, 0], true);
  switch (fx.style) {
    case 'ducktail':
      // A kicked-up tail moulded into the deck.
      k.put(rbox(W * 1.62, 0.07, 0.26, 0.03), m, [0, b.y + 0.025, b.z + 0.05], [-0.42, 0, 0]);
      break;
    case 'trunklip':
      k.put(rbox(W * 1.76, 0.022, 0.11, 0.008), m, [0, b.y + 0.012, b.z + 0.07], [-0.2, 0, 0]);
      break;
    case 'gt': {
      const y = b.y + (b.onRoof ? 0.13 : 0.32);
      const z = b.z + (b.onRoof ? 0.16 : 0.06);
      plane(y, z, W * 1.82, 0.32, -0.1);
      plates(y - 0.03, z + 0.01, 0.22, 0.42);
      // Straight uprights.
      for (const x of [-0.45, 0.45]) k.put(rbox(0.02, y - b.y, 0.16, 0.006), m, [x * W, (y + b.y) / 2, z], [0, 0, 0]);
      break;
    }
    case 'swan': {
      const y = b.y + (b.onRoof ? 0.15 : 0.38);
      const z = b.z + (b.onRoof ? 0.18 : 0.05);
      plane(y, z, W * 1.8, 0.34, -0.1);
      plates(y - 0.02, z + 0.01, 0.24, 0.46);
      // Necks that hang the wing from above, like a GT car's.
      for (const x of [-0.42, 0.42])
        k.put(tube([[x * W, b.y - 0.01, b.z - 0.06], [x * W, b.y + (y - b.y) * 0.6, b.z + 0.06], [x * W, y + 0.14, z - 0.05], [x * W, y + 0.01, z + 0.02]], 0.016), MAT.alloy, [0, 0, 0]);
      break;
    }
    case 'dual': {
      const y = b.y + (b.onRoof ? 0.12 : 0.28);
      const z = b.z + (b.onRoof ? 0.14 : 0.05);
      plane(y, z, W * 1.78, 0.26, -0.08);
      plane(y + 0.12, z + 0.08, W * 1.78, 0.18, -0.3);
      plates(y + 0.04, z + 0.05, 0.3, 0.4);
      for (const x of [-0.4, 0.4]) k.put(rbox(0.02, y - b.y, 0.12, 0.006), m, [x * W, (y + b.y) / 2, z], [0, 0, 0]);
      break;
    }
    case 'bosozoku': {
      // Absurdly tall, swept back, with huge end plates: the point is to be seen.
      const y = b.y + 0.95;
      const z = b.z + 0.42;
      plane(y, z, W * 2.05, 0.42, -0.22);
      plates(y - 0.04, z + 0.02, 0.26, 0.46);
      for (const x of [-0.5, 0.5]) k.put(tube([[x * W, b.y, b.z - 0.05], [x * W, b.y + 0.5, b.z + 0.18], [x * W, y - 0.02, z]], 0.025), m, [0, 0, 0]);
      break;
    }
  }
}

function buildHood(k: Kit, d: Design, it: ItemOf<'hood'>) {
  const fx = it.fx;
  const m = partMat(fx, k);
  const tw = d.roof[0][0]; // windscreen base
  const tc = tw * 0.6; // middle of the hood
  const at = (t: number, x = 0) => k.height(t, x);
  const pitch = (t: number) => -Math.atan2(k.top(t + 0.01) - k.top(t - 0.01), 0.02 * k.L);
  const r: [number, number, number] = [pitch(tc), 0, 0];
  const W = k.W;
  const slats = (x: number, t0: number, t1: number, n: number, width: number, mat: THREE.Material) => {
    for (let i = 0; i < n; i++) {
      const t = t0 + ((i + 0.5) / n) * (t1 - t0);
      k.put(rbox(width, 0.016, ((t1 - t0) * k.L) / n * 0.55, 0.005), mat, [x, at(t, x) + 0.012, k.z(t)], [pitch(t) - 0.35, 0, 0], x !== 0);
    }
  };
  switch (fx.style) {
    case 'vents':
      for (const x of [W * 0.42]) {
        k.put(rbox(0.26, 0.012, (tw * 0.3) * k.L, 0.01), m, [x, at(tc, x) + 0.004, k.z(tc)], r, true);
        slats(x, tc - tw * 0.13, tc + tw * 0.13, 5, 0.22, MAT.grille);
      }
      break;
    case 'naca':
      for (const x of [W * 0.28]) {
        k.put(rbox(0.12, 0.012, 0.32, 0.01), MAT.grille, [x, at(tc, x) + 0.004, k.z(tc)], r, true);
        k.put(rbox(0.16, 0.02, 0.04, 0.008), m, [x, at(tc + 0.04, x) + 0.012, k.z(tc + 0.04)], r, true);
      }
      break;
    case 'scoop': {
      const t = tc + tw * 0.08;
      k.put(rbox(0.5, 0.11, 0.62, 0.05), m, [0, at(t) + 0.04, k.z(t)], r);
      k.put(rbox(0.4, 0.07, 0.02, 0.01), MAT.grille, [0, at(t) + 0.06, k.z(t) - 0.31], r);
      break;
    }
    case 'louvres':
      slats(0, tc - tw * 0.15, tc + tw * 0.25, 9, W * 0.9, m);
      break;
    case 'snorkels':
      for (const x of [W * 0.22]) {
        const y = at(tc, x);
        k.put(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 16), m, [x, y + 0.11, k.z(tc)], [0, 0, 0], true);
        k.put(new THREE.CylinderGeometry(0.08, 0.05, 0.06, 16), m, [x, y + 0.24, k.z(tc)], [0, 0, 0], true);
        k.put(new THREE.CylinderGeometry(0.065, 0.065, 0.01, 16), MAT.grille, [x, y + 0.272, k.z(tc)], [0, 0, 0], true);
      }
      break;
    case 'shaker': {
      const y = at(tc);
      k.put(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 24), m, [0, y + 0.04, k.z(tc)], [0, 0, 0]);
      k.put(rbox(0.32, 0.1, 0.26, 0.04), m, [0, y + 0.13, k.z(tc) - 0.04], r);
      k.put(rbox(0.26, 0.06, 0.02, 0.01), MAT.grille, [0, y + 0.14, k.z(tc) - 0.17], r);
      break;
    }
    case 'blower': {
      // A supercharger standing out of the hood: chrome casing, a drive belt, a scoop with butterflies on top.
      const y = at(tc);
      const z = k.z(tc);
      k.put(rbox(0.34, 0.18, 0.5, 0.04), m, [0, y + 0.08, z], [0, 0, 0]);
      for (let i = -2; i <= 2; i++) k.put(rbox(0.36, 0.012, 0.02, 0.004), MAT.trim, [0, y + 0.1, z + i * 0.09]);
      k.put(new THREE.TorusGeometry(0.07, 0.012, 8, 20), MAT.rubber, [0, y + 0.08, z - 0.27]);
      k.put(rbox(0.28, 0.14, 0.24, 0.03), MAT.alloy, [0, y + 0.24, z - 0.02], [0, 0, 0]);
      k.put(rbox(0.24, 0.02, 0.2, 0.01), MAT.grille, [0, y + 0.315, z - 0.02]);
      break;
    }
  }
}

function buildRoof(k: Kit, d: Design, it: ItemOf<'roof'>) {
  const fx = it.fx;
  const m = partMat(fx, k);
  const tm = (d.roofF + d.roofR) / 2;
  const top = (t: number) => k.cabin.top(t);
  const half = (t: number) => k.cabin.half(t, 1);
  const y = top(tm);
  const z = k.z(tm);
  const span = (d.roofR - d.roofF) * k.L;
  const bars = (mat: THREE.Material) => {
    for (const t of [d.roofF + 0.02, d.roofR - 0.02]) k.put(rbox(half(t) * 2.1, 0.03, 0.05, 0.01), mat, [0, top(t) + 0.06, k.z(t)]);
    for (const x of [-1, 1]) k.put(rbox(0.035, 0.05, span * 0.95, 0.012), mat, [x * half(tm) * 0.92, y + 0.03, z]);
  };
  switch (fx.style) {
    case 'fin': {
      const t = d.roofR - 0.03;
      const fin = new THREE.ConeGeometry(0.05, 0.09, 12);
      fin.scale(0.6, 1, 2.2);
      k.put(fin, m, [0, top(t) + 0.04, k.z(t)], [-0.35, 0, 0]);
      break;
    }
    case 'rack':
      bars(m);
      break;
    case 'lightbar': {
      const t = d.roofF + 0.02;
      const yy = top(t) + 0.08;
      k.put(rbox(half(t) * 1.9, 0.09, 0.1, 0.02), m, [0, yy, k.z(t)]);
      for (const x of [-0.6, -0.2, 0.2, 0.6]) lit(k.put(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16), glowMat(fx.glow ?? 0xfff1c9), [x * half(t), yy, k.z(t) - 0.052], [Math.PI / 2, 0, 0]));
      for (const x of [-1, 1]) k.put(rbox(0.03, 0.08, 0.04, 0.01), m, [x * half(t) * 0.85, yy - 0.06, k.z(t)]);
      break;
    }
    case 'box':
      bars(MAT.trim);
      k.put(rbox(half(tm) * 1.25, 0.2, span * 0.85, 0.08), m, [0, y + 0.17, z + 0.02]);
      break;
    case 'scoop': {
      const t = d.roofF + 0.05;
      k.put(rbox(0.36, 0.08, 0.34, 0.04), m, [0, top(t) + 0.03, k.z(t)]);
      k.put(rbox(0.28, 0.05, 0.02, 0.01), MAT.grille, [0, top(t) + 0.045, k.z(t) - 0.17]);
      break;
    }
    case 'surf': {
      bars(MAT.trim);
      const board = new THREE.CapsuleGeometry(0.2, span * 1.3, 6, 16);
      board.rotateX(Math.PI / 2);
      board.scale(1, 0.12, 1);
      k.put(board, m, [0, y + 0.1, z + 0.05]);
      k.put(rbox(0.04, 0.005, span * 1.5, 0.002), MAT.chrome, [0, y + 0.126, z + 0.05]);
      break;
    }
    case 'duck': {
      // A big rubber duck riding on the roof, facing forward.
      const yy = y + 0.13;
      const body = new THREE.SphereGeometry(0.16, 20, 14);
      body.scale(1, 0.75, 1.2);
      k.put(body, m, [0, yy, z]);
      k.put(new THREE.SphereGeometry(0.1, 18, 12), m, [0, yy + 0.16, z - 0.12]);
      const beak = new THREE.ConeGeometry(0.045, 0.1, 12);
      beak.rotateX(-Math.PI / 2);
      beak.scale(1.3, 0.6, 1);
      k.put(beak, cached('part:beak', () => new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.4 })), [0, yy + 0.14, z - 0.24]);
      for (const x of [-0.045, 0.045]) k.put(new THREE.SphereGeometry(0.014, 8, 6), MAT.gloss, [x, yy + 0.19, z - 0.205]);
      break;
    }
    case 'halo':
      lit(k.put(new THREE.TorusGeometry(0.3, 0.025, 10, 40), glowMat(fx.glow ?? 0xffc94a), [0, y + 0.35, z], [Math.PI / 2, 0, 0]));
      break;
  }
}

function buildLip(k: Kit, it: ItemOf<'lip'>) {
  const fx = it.fx;
  const m = partMat(fx, k);
  const W = k.W;
  const y = k.body.floor(0.03) + 0.01;
  const z = k.front(0, y + 0.04);
  switch (fx.style) {
    case 'lip':
      k.put(rbox(W * 1.8, 0.025, 0.12, 0.01), m, [0, y, z + 0.03]);
      if (fx.glow !== undefined) lit(k.put(rbox(W * 1.76, 0.01, 0.01, 0.003), glowMat(fx.glow), [0, y - 0.01, z - 0.03]));
      break;
    case 'splitter':
      k.put(rbox(W * 1.9, 0.02, 0.18, 0.006), m, [0, y - 0.01, z + 0.05]);
      for (const x of [-0.6, 0.6]) k.put(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), MAT.alloy, [x * W, y + 0.04, z + 0.08], [0.3, 0, 0]);
      break;
    case 'canards':
      // Dive planes sticking out sideways from the bumper's corners, two a side, the upper one shorter.
      for (const [v, len] of [[0.3, 0.13], [0.55, 0.1]] as const) {
        const p = k.side(0.07, v);
        k.put(rbox(len, 0.012, 0.11, 0.004), m, [p.x + len / 2 - 0.02, p.y, p.z], [0, 0.25, 0.12], true);
      }
      break;
    case 'tow': {
      // A bright tow strap looped through the bumper, off-centre like a rally car's.
      const x = W * 0.45;
      const yy = y + 0.1;
      const zz = k.front(x, yy);
      k.put(rbox(0.05, 0.14, 0.012, 0.004), m, [x, yy, zz - 0.01], [0.15, 0, 0]);
      k.put(new THREE.TorusGeometry(0.035, 0.008, 6, 16), m, [x, yy - 0.08, zz - 0.02], [0, Math.PI / 2, 0]);
      break;
    }
    case 'bullbar': {
      const yy = y + 0.12;
      const zz = z - 0.12;
      const w = W * 0.75;
      k.put(tube([[-w, yy, zz + 0.1], [-w, yy + 0.32, zz], [0, yy + 0.38, zz - 0.03], [w, yy + 0.32, zz], [w, yy, zz + 0.1]], 0.025), m, [0, 0, 0]);
      k.put(tube([[-w * 0.95, yy + 0.12, zz + 0.02], [w * 0.95, yy + 0.12, zz + 0.02]], 0.02), m, [0, 0, 0]);
      break;
    }
  }
}

function buildSides(k: Kit, it: ItemOf<'skirts'>) {
  const fx = it.fx;
  const m = partMat(fx, k);
  const R = k.b.radius;
  const zF = k.z(k.tF);
  const zR = k.z(k.tR);
  const gap = R * 1.15;
  const len = zR - zF - gap * 2;
  const zm = (zF + zR) / 2;
  const sideX = (t: number) => k.side(t, 0.06).x;
  const xm = sideX(0.5);
  const yb = k.body.floor(0.5) + 0.02;
  switch (fx.style) {
    case 'skirts':
      k.put(rbox(0.06, 0.09, len, 0.025), m, [xm + 0.01, yb + 0.03, zm], [0, 0, 0], true);
      if (fx.glow !== undefined) lit(k.put(rbox(0.012, 0.012, len * 0.96, 0.004), glowMat(fx.glow), [xm + 0.04, yb, zm], [0, 0, 0], true));
      break;
    case 'flares':
    case 'rivets':
      for (const t of [k.tF, k.tR]) {
        const x = sideX(t) + 0.03;
        k.put(new THREE.TorusGeometry(R * 1.12, 0.045, 8, 24, Math.PI), m, [x, R, k.z(t)], [0, Math.PI / 2, 0], true);
        if (fx.style === 'rivets')
          for (let i = 1; i < 8; i++) {
            const a = (i / 8) * Math.PI;
            k.put(new THREE.SphereGeometry(0.012, 8, 6), MAT.chrome, [x + 0.04, R + Math.sin(a) * R * 1.12, k.z(t) + Math.cos(a) * R * 1.12], [0, 0, 0], true);
          }
      }
      break;
    case 'sidepipes':
      k.put(new THREE.CylinderGeometry(0.045, 0.045, len, 16), m, [xm + 0.05, yb + 0.06, zm], [Math.PI / 2, 0, 0], true);
      k.put(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16), MAT.grille, [xm + 0.05, yb + 0.06, zm + len / 2 + 0.005], [Math.PI / 2, 0, 0], true);
      break;
  }
}

function buildFlaps(k: Kit, it: ItemOf<'flaps'>) {
  const fx = it.fx;
  const m = partMat(fx, k);
  const R = k.b.radius;
  const mark = cached('part:mark', () => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 }));
  for (const t of [k.tF, k.tR]) {
    const x = k.side(t, 0.06).x - 0.13;
    const z = k.z(t) + R * 1.08;
    k.put(rbox(0.2, 0.2, 0.012, 0.004), m, [x, 0.17, z], [0, 0, 0], true);
    if (fx.mark === 'stripe') k.put(rbox(0.2, 0.035, 0.004), mark, [x, 0.12, z + 0.008], [0, 0, 0], true);
    if (fx.mark === 'chevron') k.put(rbox(0.07, 0.07, 0.004), mark, [x, 0.17, z + 0.008], [0, 0, Math.PI / 4], true);
    if (fx.glow !== undefined) lit(k.put(rbox(0.2, 0.012, 0.004, 0.002), glowMat(fx.glow), [x, 0.075, z + 0.008], [0, 0, 0], true));
  }
}
