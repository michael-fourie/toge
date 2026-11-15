// Body kits from the Vanta Case: whole new shells for the Vanta V10. Each is a full Design (carkits.ts) built on
// the Vanta's: its own curves (silhouette, arches, nose and tail), lamps, intakes and aero, drawn in the car's own
// paint so every paint job, decal and bolt-on still works. The greenhouse, the cabin and its trim, where the driver
// sits and the chassis underneath stay the Vanta's, so the cockpit view, the driver and the numbers are unchanged:
// a kit is looks only (physics never reads a design). Bolt-ons from the Aero Case are built from the same helpers,
// so they follow a kit's shape, and a cosmetic wing replaces a kit's own (`k.wing`).

import * as THREE from 'three';
import type { OwnedCar } from '../shared/cars.ts';
import { type ShellStyle, equipped } from '../shared/cosmetics.ts';
import { glowMat, lit, tube } from './bodykits.ts';
import {
  DESIGNS,
  type Design,
  type Kit,
  exhaust,
  grille,
  louvres,
  projector,
  rearBand,
  rearCurve,
  roundLamp,
  slitLamp,
  tailLamp,
  vantaEngine,
  vantaRoofScoop,
} from './carkits.ts';
import { MAT, rbox, share } from './carparts.ts';

/** The design a car is built from: its body kit's, when it wears one made for it, else its own. */
export function designFor(owned: OwnedCar): Design {
  const shell = equipped(owned.cos, 'shell');
  if (shell && shell.fx.car === owned.model) return SHELLS[shell.fx.style];
  return DESIGNS[owned.model as keyof typeof DESIGNS];
}

const V = DESIGNS.vanta;
/** The Kage's edge light, the Oni's eyes and veins. */
const KAGE = 0x22e6ff;
const ONI = 0xff2a3a;

/** A kit's own finishes (primer, tape, ivory), made once and shared so a car's dispose leaves them. */
const mats = new Map<string, THREE.Material>();
const own = (key: string, make: () => THREE.Material) => {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = share(make())));
  return m;
};
const primer = () => own('primer', () => new THREE.MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.9, metalness: 0 }));
const whitePrimer = () => own('white', () => new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.85, metalness: 0 }));
const tape = () => own('tape', () => new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.45, metalness: 0.6 }));
const ivory = () => own('ivory', () => new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.4 }));
const wood = () => own('wood', () => new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.8 }));

// ---------------------------------------------------------------------------------------------
// Shared pieces

/** A row of slats across a fender or panel at x (mirrored), from t0 to t1, lying on the top surface. */
function slats(k: Kit, x: number, t0: number, t1: number, n: number, width: number, mat: THREE.Material) {
  const pitch = (t: number) => -Math.atan2(k.height(t + 0.005, x) - k.height(t - 0.005, x), 0.01 * k.L);
  for (let i = 0; i < n; i++) {
    const t = t0 + ((i + 0.5) / n) * (t1 - t0);
    k.put(rbox(width, 0.016, ((t1 - t0) * k.L) / n * 0.5, 0.005), mat, [x, k.height(t, x) + 0.01, k.z(t)], [pitch(t) - 0.4, 0, 0], x !== 0);
  }
  k.put(rbox(width + 0.03, 0.01, (t1 - t0) * k.L + 0.03, 0.005), MAT.hole, [x, k.height((t0 + t1) / 2, x) + 0.002, k.z((t0 + t1) / 2)], [pitch((t0 + t1) / 2), 0, 0], x !== 0);
}

/** A strip of thin boxes through the points (a lamp line, a glowing edge), each piece mirrored when `mirror`. */
function strip(k: Kit, pts: THREE.Vector3[], w: number, h: number, mat: THREE.Material, mirror = true) {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = b.clone().sub(a);
    const len = d.length();
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
    const e = new THREE.Euler().setFromRotationMatrix(m);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    out.push(k.put(rbox(w, h, len + Math.min(w, h), Math.min(w, h) * 0.4), mat, [mid.x, mid.y, mid.z], [e.x, e.y, e.z], mirror));
  }
  return out;
}

/** A wing on two uprights over the deck, with end plates; skipped when a cosmetic wing replaces it. */
function wing(k: Kit, o: { t: number; up: number; back: number; span: number; chord: number; pitch: number; mat: THREE.Material; plate?: THREE.Material; posts?: 'straight' | 'swan'; postX?: number; edge?: THREE.Material }) {
  if (k.wing) return;
  const by = k.top(o.t);
  const bz = k.z(o.t);
  const y = by + o.up;
  const z = bz + o.back;
  k.put(rbox(o.span, 0.035, o.chord, 0.015), o.mat, [0, y, z], [o.pitch, 0, 0]);
  k.put(rbox(o.span, 0.035, 0.012, 0.004), o.mat, [0, y + 0.028, z + o.chord / 2 - 0.006]);
  if (o.edge) lit(k.put(rbox(o.span * 0.98, 0.012, 0.012, 0.004), o.edge, [0, y + 0.004, z + o.chord / 2 + 0.004], [o.pitch, 0, 0]));
  k.put(rbox(0.02, 0.22, o.chord * 1.35, 0.01), o.plate ?? o.mat, [o.span / 2, y - 0.04, z + 0.02], [0, 0, 0], true);
  const px = o.postX ?? o.span * 0.24;
  if (o.posts === 'swan') {
    for (const x of [-px, px])
      k.put(tube([[x, by - 0.01, bz - 0.06], [x, by + o.up * 0.6, bz + 0.04], [x, y + 0.13, z - 0.05], [x, y + 0.01, z + 0.02]], 0.017), MAT.alloy, [0, 0, 0]);
  } else {
    for (const x of [-px, px]) k.put(rbox(0.022, o.up + 0.04, 0.14, 0.006), o.plate ?? o.mat, [x, by + o.up / 2 - 0.01, (bz + z) / 2], [0, 0, 0]);
  }
}

/** A diffuser under the tail: a raked floor with fences. */
function diffuser(k: Kit, n: number, h: number, mat: THREE.Material = MAT.carbon) {
  const gw = k.body.half(0.99, 0.3) * 0.9;
  const dz = k.rear(0, 0.2);
  k.put(rbox(gw * 1.9, 0.02, 0.5, 0.006), mat, [0, 0.14, dz - 0.18], [-0.22, 0, 0]);
  for (let i = -n; i <= n; i++) k.put(rbox(0.012, h, 0.44, 0.004), mat, [(i / n) * gw * 0.85, 0.12 + h / 2, dz - 0.16], [-0.22, 0, 0]);
}

/** The Vanta's lamp band across the tail, on the tail's curve: a dark housing, the red lens, a lit bar. */
function lampBand(k: Kit, ty: number, tw: number, h: number) {
  const tc = rearCurve(k, ty, tw * 1.03);
  rearBand(k, tc, ty, tw * 1.03, h + 0.016, MAT.gloss, 0.006, 0.06);
  rearBand(k, tc, ty, tw, h, MAT.redLens, 0.011, 0.04);
  rearBand(k, tc, ty + h * 0.12, tw * 0.97, Math.max(0.014, h * 0.3), k.tail, 0.019, 0.04);
  return tc;
}

/** Red tow straps through the nose and the tail, off to one side. */
function towStraps(k: Kit) {
  const x = k.W * 0.5;
  for (const [y, z, s] of [[0.24, k.front(x, 0.24), 1], [0.3, k.rear(x, 0.3), -1]] as const) {
    k.put(rbox(0.05, 0.13, 0.012, 0.004), MAT.red, [x, y, z - s * 0.01], [s * 0.12, 0, 0]);
  }
}

/** Rivets round the outside of an arch at axle t (a bolted-on over-fender's edge). */
function rivets(k: Kit, t: number, n: number) {
  const ar = k.b.radius + 0.1;
  for (let i = -n; i <= n; i++) {
    const a = (i / n) * 1.25;
    const tt = t + (Math.sin(a) * ar) / k.L;
    const y = k.b.radius + Math.cos(a) * ar;
    const v = Math.min(1, (y - k.body.bottom(tt)) / Math.max(0.01, k.body.top(tt) - k.body.bottom(tt)));
    const p = k.side(tt, Math.max(0, v));
    k.put(new THREE.SphereGeometry(0.013, 8, 6), MAT.chrome, [p.x + 0.004, y, p.z], [0, 0, 0], true);
  }
}

/**
 * A panel lying on both flanks from t0 to t1, between heights lo(t) and hi(t) (shares of the section, 0 at the
 * bottom), `out` off the paint: it follows the body's curves, where a flat plate would float off them.
 */
function sidePanel(k: Kit, t0: number, t1: number, lo: (t: number) => number, hi: (t: number) => number, mat: THREE.Material, out = 0.006, sides: readonly number[] = [-1, 1]) {
  const N = 24;
  const M = 6;
  for (const side of sides) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = t0 + ((t1 - t0) * i) / N;
      for (let j = 0; j <= M; j++) {
        const v = lo(t) + ((hi(t) - lo(t)) * j) / M;
        const p = k.side(t, v, side);
        pos.push(p.x + side * out, p.y, p.z);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j;
        const b = a + M + 1;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    k.put(g, mat, [0, 0, 0]);
  }
}

/** A panel lying on the top (hood, deck) from t0 to t1, out to ±half(t) either side of the middle, `up` off the paint. */
function topPanel(k: Kit, t0: number, t1: number, half: (t: number) => number, mat: THREE.Material, up = 0.005) {
  const N = 20;
  const M = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    for (let j = 0; j <= M; j++) {
      const x = -half(t) + (2 * half(t) * j) / M;
      pos.push(x, k.height(t, x) + up, k.z(t));
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  k.put(g, mat, [0, 0, 0]);
}

/** A flat fin standing in a plane x = const: its outline is (z, y) pairs in body space, `w` thick. */
function fin(k: Kit, outline: [number, number][], x: number, w: number, mat: THREE.Material, mirror = false) {
  const shape = new THREE.Shape();
  outline.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-w / 2, 0, 0);
  return k.put(g, mat, [x, 0, 0], [0, 0, 0], mirror);
}

/** A horn (or spike): a tapered cone from `base` bending through `mid` to `tip`, built in short pieces. */
function horn(k: Kit, base: THREE.Vector3, mid: THREE.Vector3, tip: THREE.Vector3, r: number, mat: THREE.Material, mirror = true) {
  const c = new THREE.QuadraticBezierCurve3(base, mid, tip);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = c.getPoint(i / n);
    const b = c.getPoint((i + 1) / n);
    const r0 = r * (1 - i / n);
    const r1 = Math.max(0.002, r * (1 - (i + 1) / n));
    const g = new THREE.CylinderGeometry(r1, r0, a.distanceTo(b) * 1.04, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    const m = a.clone().add(b).multiplyScalar(0.5);
    k.put(g, mat, [m.x, m.y, m.z], [e.x, e.y, e.z], mirror);
  }
}

/** A thin panel filling an arch from the outside (a wheel spat), in the paint. */
function spat(k: Kit, t: number) {
  const ar = k.b.radius + 0.06;
  const y0 = k.body.floor(t) + 0.02;
  const shape = new THREE.Shape();
  const top = Math.asin(Math.max(-1, Math.min(1, (y0 - k.b.radius) / ar)));
  shape.moveTo(-Math.cos(top) * ar, y0 - k.b.radius);
  shape.absarc(0, 0, ar + 0.01, Math.PI - top, top, true);
  shape.lineTo(-Math.cos(top) * ar, y0 - k.b.radius);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 24 });
  g.rotateY(Math.PI / 2);
  const x = k.side(t, 0.25).x - 0.03;
  k.put(g, k.paint, [x, k.b.radius, k.z(t)], [0, 0, 0], true);
}

// ---------------------------------------------------------------------------------------------
// The kits

export const SHELLS: Record<ShellStyle, Design> = {
  // Kaidō racer: bolted-on over-fenders, a chin spoiler out to here, an oil cooler in the mouth, a towering wing
  // and the bamboo-spear pipes, sticking up out of the tail.
  kaido: {
    ...V,
    top: [[0, 0.4], [0.03, 0.52], [0.1, 0.6], [0.209, 0.66], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.72], [0.92, 0.71], [0.98, 0.69], [1, 0.62]],
    dip: [[0, 0], [0.06, 0.03], [0.15, 0.05], [0.24, 0.05], [0.32, 0.02], [0.38, 0], [0.6, 0], [0.72, 0.04], [0.9, 0.05], [1, 0.02]],
    floor: [[0, 0.18], [0.04, 0.13], [0.1, 0.12], [0.92, 0.12], [0.97, 0.17], [1, 0.26]],
    waist: 0.1, flareF: 0.17, flareR: 0.22, nose: [0.08, 0.78], tail: [0.04, 0.94], rb: 0.03, rt: 0.08, crease: 0.02,
    ownWing: true, plate: 'KAIDO', plateY: 0.46,
    kit(k) {
      slitLamp(k, k.W * 0.4, 0.045, k.W * 0.8, 0.095, 0.1);
      // A wide mouth with an alloy oil cooler in it, and the long chin spoiler under it.
      grille(k, k.W * 1.25, 0.15, 0.27, 0.04);
      const cz = k.front(0, 0.27);
      k.put(rbox(k.W * 0.8, 0.1, 0.06, 0.01), MAT.alloy, [0, 0.27, cz - 0.02]);
      for (let i = 0; i < 9; i++) k.put(rbox(k.W * 0.8, 0.006, 0.07, 0.002), MAT.trim, [0, 0.235 + i * 0.009, cz - 0.022]);
      const ly = k.body.floor(0.03) + 0.005;
      const lz = k.front(0, ly + 0.03);
      k.put(rbox(k.W * 1.5, 0.03, 0.28, 0.01), k.paint, [0, ly, lz - 0.03], [0.05, 0, 0]);
      k.put(rbox(k.W * 1.5, 0.012, 0.28, 0.004), MAT.gloss, [0, ly - 0.02, lz - 0.03], [0.05, 0, 0]);
      for (const y of [0.32, 0.25]) {
        const x = k.W * 0.78;
        k.put(rbox(0.14, 0.012, 0.1, 0.004), MAT.carbon, [x + 0.04, y, k.front(x, y) + 0.03], [0, 0.45, 0.15], true);
      }
      // Rivets round the over-fenders.
      rivets(k, k.tF, 6);
      rivets(k, k.tR, 6);
      // Side intakes ahead of the rear wheels, like the stock car's.
      const it = k.tR - 0.16;
      const p = k.side(it, 0.5);
      k.put(rbox(0.1, 0.2, 0.32, 0.05), MAT.grille, [p.x - 0.03, p.y, p.z], [0, 0.12, 0], true);
      vantaRoofScoop(k);
      vantaEngine(k);
      louvres(k, 0.74, 0.92, 7, () => k.W * 1.0, (t) => k.top(t), MAT.carbon);
      // Four round tail lamps in a black panel, and a towering wing.
      const ty = k.top(0.99) - 0.1;
      k.put(rbox(k.W * 1.7, 0.16, 0.04, 0.02), MAT.gloss, [0, ty, k.rear(0, ty) - 0.012]);
      for (const x of [0.5, 0.78]) roundLamp(k, x * k.W, ty, 0.06, k.tail, -1, MAT.trim);
      wing(k, { t: 0.955, up: 0.62, back: 0.18, span: k.W * 2.1, chord: 0.4, pitch: -0.16, mat: k.paint, plate: MAT.gloss, posts: 'straight', postX: k.W * 0.42 });
      // Takeyari: two chrome pipes out of the tail, raked up and back.
      for (const x of [-0.56, 0.56]) {
        const z = k.rear(x, 0.24);
        const o = Math.sign(x) * 0.06;
        k.put(tube([[x, 0.2, z - 0.15], [x, 0.22, z + 0.06], [x + o / 2, 0.5, z + 0.2], [x + o, 0.98, z + 0.36]], 0.04), MAT.chrome, [0, 0, 0]);
        k.put(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 16), MAT.hole, [x + o, 0.985, z + 0.362], [-0.33, 0, o]);
      }
      k.put(rbox(k.W * 1.84, 0.12, 0.14, 0.05), MAT.trim, [0, 0.24, k.rear(0, 0.24) - 0.05]);
      diffuser(k, 3, 0.1);
    },
  },

  // Rally raid: black cladding round every arch, round lamps and a roof pod, a snorkel up the pillar, a skid
  // plate, big flaps and a spare wheel strapped over the engine.
  safari: {
    ...V,
    top: [[0, 0.36], [0.05, 0.52], [0.12, 0.62], [0.209, 0.68], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.71], [0.92, 0.7], [0.98, 0.68], [1, 0.62]],
    dip: [[0, 0], [0.06, 0.05], [0.15, 0.1], [0.24, 0.09], [0.32, 0.03], [0.38, 0], [0.6, 0], [0.72, 0.05], [0.9, 0.06], [1, 0.02]],
    floor: [[0, 0.26], [0.05, 0.16], [0.1, 0.13], [0.92, 0.13], [0.96, 0.2], [1, 0.32]],
    waist: 0.06, flareF: 0.1, flareR: 0.13, nose: [0.13, 0.66], tail: [0.06, 0.9], rb: 0.07, rt: 0.13, crease: 0.008,
    plate: 'RAID 10', plateY: 0.48,
    kit(k) {
      // Twin round lamps a side in a black nose panel, a light pod on the roof's front edge.
      const ly = k.top(0.03) - 0.07;
      for (const x of [0.38, 0.66]) roundLamp(k, x * k.W, ly, 0.07, MAT.head, 1, MAT.gloss);
      grille(k, k.W * 0.42, 0.1, ly - 0.02, 0.03);
      const rt = V.roofF + 0.02;
      const ry = k.cabin.top(rt) + 0.08;
      const rz = k.z(rt);
      const rw = k.cabin.half(rt, 1) * 0.85;
      k.put(rbox(rw * 2, 0.1, 0.1, 0.03), MAT.gloss, [0, ry, rz]);
      for (const x of [-0.75, -0.25, 0.25, 0.75]) {
        k.put(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), MAT.chrome, [x * rw, ry, rz - 0.06], [Math.PI / 2, 0, 0]);
        lit(k.put(new THREE.CircleGeometry(0.04, 20), MAT.head, [x * rw, ry, rz - 0.087], [Math.PI, 0, 0]));
      }
      for (const x of [-1, 1]) k.put(rbox(0.03, 0.09, 0.05, 0.01), MAT.gloss, [x * rw * 0.9, ry - 0.07, rz]);
      // Skid plate under the nose and a bumper bar.
      const sy = k.body.floor(0.03);
      k.put(rbox(k.W * 1.3, 0.016, 0.5, 0.006), MAT.alloy, [0, sy - 0.01, k.front(0, sy + 0.04) + 0.22], [0.2, 0, 0]);
      k.put(rbox(k.W * 1.86, 0.12, 0.16, 0.05), MAT.trim, [0, 0.26, k.front(0, 0.26) + 0.05]);
      for (const x of [-0.42, 0.42]) k.put(new THREE.TorusGeometry(0.035, 0.01, 6, 16), MAT.red, [x * k.W, 0.2, k.front(x * k.W, 0.22) - 0.02], [0, Math.PI / 2, 0]);
      // Cladding: a thick black lip round every arch and along the sills.
      for (const t of [k.tF, k.tR]) {
        const x = k.side(t, 0.06).x + 0.015;
        k.put(new THREE.TorusGeometry(k.b.radius + 0.1, 0.05, 6, 28, Math.PI), MAT.trim, [x, k.b.radius, k.z(t)], [0, Math.PI / 2, 0], true);
      }
      const zF = k.z(k.tF) + k.b.radius + 0.16;
      const zR = k.z(k.tR) - k.b.radius - 0.16;
      k.put(rbox(0.06, 0.14, zR - zF, 0.03), MAT.trim, [k.side(0.5, 0.05).x + 0.02, k.body.floor(0.5) + 0.07, (zF + zR) / 2], [0, 0, 0], true);
      // The snorkel: up the right-hand A pillar from the front fender, its hood facing forward over the roof.
      const ft = V.roof[0][0] + 0.01;
      const sx = k.cabin.half(ft, 0) + 0.05;
      const fy = k.height(ft, sx);
      const st = V.roofF + 0.03;
      const top = k.cabin.top(st);
      k.put(tube([[sx + 0.05, fy - 0.02, k.z(ft) - 0.05], [sx + 0.02, fy + 0.2, k.z(ft) + 0.05], [k.cabin.half(st, 1) + 0.02, top - 0.02, k.z(st)], [k.cabin.half(st, 1) - 0.02, top + 0.1, k.z(st) + 0.02]], 0.04), MAT.trim, [0, 0, 0]);
      k.put(rbox(0.12, 0.1, 0.16, 0.04), MAT.trim, [k.cabin.half(st, 1) - 0.02, top + 0.13, k.z(st) - 0.03]);
      k.put(rbox(0.09, 0.07, 0.02, 0.01), MAT.hole, [k.cabin.half(st, 1) - 0.02, top + 0.13, k.z(st) - 0.115]);
      vantaEngine(k);
      // The spare wheel, strapped flat on the engine cover.
      const wt = 0.84;
      const wy = k.top(wt) + 0.1;
      const tyre = new THREE.TorusGeometry(0.25, 0.085, 12, 32);
      tyre.rotateX(Math.PI / 2);
      k.put(tyre, MAT.tyre, [0, wy, k.z(wt)]);
      k.put(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 24), MAT.alloy, [0, wy, k.z(wt)]);
      for (const a of [0, Math.PI / 2]) k.put(rbox(0.03, 0.012, 0.7, 0.004), MAT.gloss, [0, wy + 0.09, k.z(wt)], [0, a + 0.4, 0]);
      for (const x of [-0.3, 0.3]) k.put(rbox(0.06, 0.06, 0.06, 0.01), MAT.gloss, [x, k.top(wt) + 0.02, k.z(wt)]);
      // Mud flaps behind every wheel.
      for (const t of [k.tF, k.tR]) {
        const z = k.z(t) + k.b.radius + 0.14;
        const x = k.side(t, 0.06).x - 0.12;
        k.put(rbox(0.26, 0.26, 0.012, 0.006), MAT.rubber, [x, 0.16, z], [0.06, 0, 0], true);
        k.put(rbox(0.262, 0.05, 0.013, 0.004), MAT.red, [x, 0.25, z - 0.006], [0.06, 0, 0], true);
      }
      // Tail: square lamps, a bumper bar with a tow hook, twin pipes.
      const ty = k.top(0.99) - 0.12;
      tailLamp(k, 0.66 * k.W, ty, 0.28, 0.12);
      k.put(rbox(k.W * 1.86, 0.14, 0.16, 0.06), MAT.trim, [0, 0.28, k.rear(0, 0.28) - 0.06]);
      k.put(new THREE.TorusGeometry(0.04, 0.012, 6, 16), MAT.red, [0, 0.2, k.rear(0, 0.24) - 0.1], [0, Math.PI / 2, 0]);
      exhaust(k, k.W * 0.55, 0.22, 0.06, true);
    },
  },

  // Wedge '74: one straight line from the nose to the tail, pop-up lamps, NACA ducts, a louvred rear screen and
  // a wing on stilts. All edges, no curves.
  wedge: {
    ...V,
    top: [[0, 0.2], [0.03, 0.28], [0.12, 0.4], [0.209, 0.48], [0.3, 0.56], [0.45, 0.6], [0.62, 0.64], [0.791, 0.68], [0.95, 0.7], [0.99, 0.7], [1, 0.62]],
    dip: [[0, 0], [0.3, 0.01], [0.38, 0], [1, 0]],
    floor: [[0, 0.17], [0.04, 0.13], [0.1, 0.12], [0.94, 0.12], [0.98, 0.16], [1, 0.26]],
    waist: 0.05, flareF: 0.04, flareR: 0.07, nose: [0.26, 0.32], tail: [0.025, 0.96], tumble: 0.2, rb: 0.03, rt: 0.05, crease: 0,
    ownWing: true, plate: 'CUNEO 74', plateY: 0.48,
    kit(k) {
      // Pop-up lamps, up: a painted box each side with a lens across its face.
      const pt = 0.13;
      const px = k.W * 0.55;
      const py = k.height(pt, px);
      const pz = k.z(pt);
      k.put(rbox(0.34, 0.11, 0.1, 0.012), k.paint, [px, py + 0.05, pz], [-0.04, 0, 0], true);
      k.put(rbox(0.3, 0.075, 0.012, 0.006), MAT.gloss, [px, py + 0.055, pz - 0.052], [-0.04, 0, 0], true);
      for (const dx of [-0.075, 0.075]) k.put(rbox(0.12, 0.05, 0.01, 0.004), MAT.head, [px + dx, py + 0.055, pz - 0.058], [-0.04, 0, 0], true);
      // A slot grille and a black rubber bumper blade, amber corners.
      grille(k, k.W * 1.1, 0.05, 0.25, 0.012);
      strip(k, Array.from({ length: 9 }, (_, i) => { const x = (-0.8 + (1.6 * i) / 8) * k.W; return new THREE.Vector3(x, 0.18, k.front(x, 0.18) - 0.012); }), 0.06, 0.05, MAT.rubber, false);
      k.put(rbox(0.14, 0.035, 0.03, 0.008), MAT.amber, [k.W * 0.55, 0.25, k.front(k.W * 0.55, 0.25) + 0.012], [0, 0.6, 0], true);
      // A NACA duct in each door and air boxes standing up on the rear haunches.
      const nt = 0.5;
      const n = k.side(nt, 0.55);
      k.put(rbox(0.04, 0.12, 0.42, 0.04), MAT.hole, [n.x - 0.012, n.y, n.z], [0, 0.03, 0], true);
      const ht = 0.66;
      const hx = k.W * 0.74;
      const hy = k.height(ht, hx);
      k.put(rbox(0.22, 0.14, 0.42, 0.03), k.paint, [hx, hy + 0.05, k.z(ht)], [0, 0, 0], true);
      k.put(rbox(0.18, 0.1, 0.02, 0.01), MAT.hole, [hx, hy + 0.06, k.z(ht) - 0.212], [0, 0, 0], true);
      // A periscope channel on the roof and louvres over the rear screen.
      const rt = V.roofR - 0.02;
      k.put(rbox(0.3, 0.05, 0.3, 0.02), k.paint, [0, k.cabin.top(rt) + 0.015, k.z(rt)]);
      k.put(rbox(0.24, 0.035, 0.02, 0.008), MAT.hole, [0, k.cabin.top(rt) + 0.02, k.z(rt) - 0.15]);
      vantaEngine(k);
      louvres(k, V.roofR + 0.04, 0.76, 8, (t) => k.cabin.half(t, 1) * 1.8, (t) => k.cabin.top(t), MAT.gloss);
      louvres(k, 0.8, 0.95, 6, () => k.W * 1.2, (t) => k.top(t), MAT.gloss);
      // Tail: a black panel the width of the car with three square lamps a side.
      const ty = k.top(0.99) - 0.11;
      const zt = k.rear(0, ty);
      k.put(rbox(k.W * 1.86, 0.16, 0.04, 0.008), MAT.gloss, [0, ty, zt - 0.012]);
      for (const x of [0.4, 0.6, 0.8]) {
        const lx = x * k.W;
        k.put(rbox(0.16, 0.12, 0.03, 0.006), x === 0.4 ? MAT.amber : MAT.redLens, [lx, ty, k.rear(lx, ty) + 0.004], [0, 0, 0], true);
        if (x !== 0.4) k.put(rbox(0.13, 0.03, 0.03, 0.004), k.tail, [lx, ty + 0.02, k.rear(lx, ty) + 0.01], [0, 0, 0], true);
      }
      k.put(rbox(k.W * 1.8, 0.06, 0.1, 0.02), MAT.rubber, [0, 0.3, k.rear(0, 0.3) - 0.03]);
      for (const x of [0.18, 0.3]) exhaust(k, x, 0.22, 0.045, true, 18);
      // A wing on stilts, its two halves meeting in a shallow V.
      if (!k.wing) {
        const by = k.top(0.93);
        const y = by + 0.34;
        const z = k.z(0.93) + 0.12;
        const half = k.W * 1.02;
        k.put(rbox(half, 0.03, 0.34, 0.01), k.paint, [half / 2, y + 0.02, z], [-0.08, 0, 0.07], true);
        k.put(rbox(0.02, 0.2, 0.4, 0.008), k.paint, [half, y + 0.02, z], [0, 0, 0], true);
        for (const x of [k.W * 0.4]) k.put(rbox(0.03, 0.36, 0.08, 0.008), MAT.gloss, [x, by + 0.17, z], [0, 0, 0], true);
      }
    },
  },

  // GT Works: a customer race car. Louvred fenders, a splitter with dive planes, hood pins, a swan-neck wing,
  // a diffuser like a church organ and a number on the doors' worth of attitude.
  gt: {
    ...V,
    top: [[0, 0.25], [0.05, 0.44], [0.12, 0.62], [0.209, 0.74], [0.3, 0.63], [0.45, 0.6], [0.62, 0.68], [0.791, 0.77], [0.92, 0.73], [0.98, 0.68], [1, 0.6]],
    dip: [[0, 0], [0.06, 0.1], [0.15, 0.2], [0.24, 0.17], [0.32, 0.05], [0.38, 0], [0.6, 0], [0.72, 0.1], [0.9, 0.12], [1, 0.04]],
    floor: [[0, 0.16], [0.04, 0.12], [0.1, 0.11], [0.92, 0.11], [0.97, 0.16], [1, 0.28]],
    waist: 0.1, flareF: 0.12, flareR: 0.17, nose: [0.16, 0.5], tail: [0.04, 0.92], rb: 0.04, rt: 0.12, crease: 0.016,
    ownWing: true, plate: 'WORKS', plateY: 0.46,
    kit(k) {
      slitLamp(k, k.W * 0.42, 0.05, k.W * 0.82, 0.1, 0.09);
      // A gaping centre intake and two corner ones, the splitter with end plates and dive planes.
      grille(k, k.W * 0.9, 0.14, 0.26, 0.04);
      for (const x of [0.62]) k.put(rbox(0.28, 0.12, 0.14, 0.04), MAT.grille, [x * k.W, 0.25, k.front(x * k.W, 0.25) + 0.1], [0, 0.4, 0], true);
      const sy = k.body.floor(0.03) - 0.02;
      const sz = k.front(0, sy + 0.05);
      const sw = k.body.half(0.07, 0.1) * 2;
      k.put(rbox(sw, 0.022, 0.36, 0.008), MAT.carbon, [0, sy, sz + 0.1]);
      k.put(rbox(0.015, 0.1, 0.32, 0.005), MAT.carbon, [sw / 2, sy + 0.045, sz + 0.11], [0, 0, 0], true);
      for (const [v, len, a] of [[0.35, 0.16, 0.15], [0.6, 0.12, 0.25]] as const) {
        const p = k.side(0.06, v);
        k.put(rbox(len, 0.012, 0.12, 0.004), MAT.carbon, [p.x + len / 2 - 0.03, p.y, p.z], [0, 0.3, a], true);
      }
      // Louvres over the front wheels, an extractor in the hood, hood pins.
      slats(k, k.W * 0.72, k.tF - 0.05, k.tF + 0.04, 7, 0.22, MAT.carbon);
      slats(k, 0, 0.14, 0.23, 6, k.W * 0.7, MAT.carbon);
      for (const x of [-0.6, 0.6]) k.put(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 12), MAT.chrome, [x * k.W, k.height(0.06, x * k.W) + 0.004, k.z(0.06)]);
      towStraps(k);
      // Side exits behind the front wheels and the big intake ahead of the rear ones.
      const g = k.side(k.tF + 0.1, 0.5);
      for (let i = 0; i < 3; i++) k.put(rbox(0.02, 0.15, 0.03, 0.008), MAT.grille, [g.x + 0.004, g.y, g.z + i * 0.06 - 0.06], [0, 0, 0], true);
      const it = k.tR - 0.15;
      const p = k.side(it, 0.5);
      k.put(rbox(0.1, 0.24, 0.38, 0.05), MAT.grille, [p.x - 0.035, p.y, p.z], [0, 0.1, 0], true);
      vantaRoofScoop(k);
      vantaEngine(k);
      louvres(k, 0.74, 0.92, 8, () => k.W * 1.05, (t) => k.top(t), MAT.carbon);
      // Tail: the lamp band, a tall diffuser, one big pipe in the middle.
      lampBand(k, k.top(0.99) - 0.07, k.body.half(0.99, 0.8) * 0.92, 0.07);
      k.put(rbox(k.body.half(0.99, 0.3) * 1.8, 0.12, 0.12, 0.03), MAT.grille, [0, 0.26, k.rear(0, 0.26) - 0.04]);
      diffuser(k, 4, 0.2);
      exhaust(k, 0, 0.3, 0.07, false, 20);
      wing(k, { t: 0.95, up: 0.36, back: 0.1, span: k.W * 1.95, chord: 0.36, pitch: -0.12, mat: MAT.carbon, posts: 'swan', postX: k.W * 0.36 });
    },
  },

  // Longtail LM: an endurance racer. Stretched, tapering tail, a shark fin down the spine, spats over the rear
  // wheels, a wing between two tall fins and a lamp band from one to the other. Four little LED eyes a side.
  longtail: {
    ...V,
    top: [[0, 0.24], [0.05, 0.42], [0.12, 0.58], [0.209, 0.68], [0.3, 0.6], [0.45, 0.6], [0.62, 0.66], [0.791, 0.72], [0.88, 0.7], [0.96, 0.64], [1, 0.58]],
    dip: [[0, 0], [0.06, 0.1], [0.15, 0.17], [0.24, 0.14], [0.32, 0.04], [0.38, 0], [0.6, 0], [0.72, 0.1], [0.9, 0.1], [1, 0.02]],
    floor: [[0, 0.17], [0.04, 0.12], [0.1, 0.11], [0.92, 0.11], [0.97, 0.16], [1, 0.3]],
    waist: 0.08, flareF: 0.09, flareR: 0.14, nose: [0.2, 0.42], tail: [0.2, 0.6], tumble: 0.14, rb: 0.04, rt: 0.13,
    ownWing: true, plate: 'LM 24', plateY: 0.42,
    kit(k) {
      // Four LED projectors a side under a clear cover, stepped back along the nose's top edge.
      for (let i = 0; i < 4; i++) {
        const t = 0.05 + i * 0.016;
        const x = k.W * (0.5 + i * 0.08);
        const y = k.height(t, x) - 0.015;
        projector(k, [x, y, k.z(t) - 0.02], [Math.PI / 2 + 0.3, 0, 0], 0.03);
      }
      for (const [t0, t1] of [[0.045, 0.11]]) {
        const pts = [new THREE.Vector3(k.W * 0.46, k.height(t0, k.W * 0.46) + 0.006, k.z(t0)), new THREE.Vector3(k.W * 0.82, k.height(t1, k.W * 0.82) + 0.006, k.z(t1))];
        strip(k, pts, 0.012, 0.012, MAT.drl);
      }
      // A low wide intake, the splitter and canards.
      k.put(rbox(k.W * 1.2, 0.1, 0.12, 0.04), MAT.grille, [0, 0.22, k.front(0, 0.22) + 0.05]);
      k.put(rbox(k.body.half(0.07, 0.1) * 1.95, 0.02, 0.3, 0.008), MAT.carbon, [0, 0.12, k.front(0, k.body.floor(0.05) + 0.03) + 0.12]);
      for (const [v, len] of [[0.4, 0.12]] as const) {
        const p = k.side(0.07, v);
        k.put(rbox(len, 0.012, 0.1, 0.004), MAT.carbon, [p.x + len / 2 - 0.03, p.y, p.z], [0, 0.3, 0.15], true);
      }
      slats(k, k.W * 0.7, k.tF - 0.04, k.tF + 0.04, 6, 0.2, MAT.carbon);
      vantaRoofScoop(k);
      vantaEngine(k);
      // Spats over the rear wheels.
      spat(k, k.tR);
      // The shark fin: from the roof down the spine to the tail.
      const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) {
        const t = 0.6 + (i / 16) * 0.39;
        const base = t < V.roofR + 0.12 ? k.cabin.top(Math.min(t, 0.77)) : k.top(t);
        pts.push([k.z(t), Math.max(base, k.top(t)) + 0.02 + 0.2 * smoothstep(0.6, 0.92, t)]);
      }
      const shape = new THREE.Shape();
      shape.moveTo(-pts[0][0], k.cabin.top(0.6) - 0.02);
      for (const [z, y] of pts) shape.lineTo(-z, y);
      shape.lineTo(-pts[pts.length - 1][0], k.top(0.99) - 0.02);
      for (let i = 16; i >= 0; i--) {
        const t = 0.6 + (i / 16) * 0.39;
        shape.lineTo(-k.z(t), (t < 0.78 ? k.cabin.top(t) : k.top(t)) - 0.03);
      }
      const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
      fin.rotateY(Math.PI / 2);
      fin.translate(-0.01, 0, 0);
      k.put(fin, k.paint, [0, 0, 0]);
      // Tail: two tall fins carrying the wing between them, the lamp band under it, a diffuser.
      const ty = k.top(0.99) - 0.06;
      const tw = k.body.half(0.99, 0.8) * 0.9;
      lampBand(k, ty, tw, 0.05);
      if (!k.wing) {
        const wt = 0.965;
        const wy = k.top(wt) + 0.2;
        const wz = k.z(wt);
        const span = k.body.half(wt, 0.9) * 2;
        k.put(rbox(span, 0.035, 0.32, 0.015), MAT.carbon, [0, wy, wz], [-0.08, 0, 0]);
        k.put(rbox(span, 0.04, 0.012, 0.004), MAT.carbon, [0, wy + 0.03, wz + 0.16]);
        k.put(rbox(0.03, 0.34, 0.7, 0.012), k.paint, [span / 2, wy - 0.12, wz - 0.12], [0, 0, 0], true);
      }
      diffuser(k, 3, 0.16);
      exhaust(k, 0.24, 0.3, 0.05, true, 16);
    },
  },

  // Kage: a shadow with a cyan edge. Hard creases, a pointed nose, light lines along every edge, a floating
  // blade wing and the V10's cam covers glowing under the glass.
  kage: {
    ...V,
    top: [[0, 0.22], [0.06, 0.42], [0.209, 0.7], [0.3, 0.6], [0.45, 0.6], [0.62, 0.68], [0.791, 0.76], [0.95, 0.72], [1, 0.64]],
    dip: [[0, 0], [0.06, -0.02], [0.15, 0.02], [0.24, 0.06], [0.32, 0.03], [0.38, 0], [0.6, 0], [0.72, 0.1], [0.9, 0.12], [1, 0.04]],
    floor: [[0, 0.16], [0.04, 0.12], [0.1, 0.11], [0.92, 0.11], [0.97, 0.17], [1, 0.28]],
    waist: 0.12, flareF: 0.1, flareR: 0.16, nose: [0.3, 0.22], tail: [0.04, 0.86], tumble: 0.2, rb: 0.02, rt: 0.035, crease: 0.03,
    ownWing: true, plate: 'KAGE', plateY: 0.44,
    kit(k) {
      const edge = glowMat(KAGE);
      // Blade headlamps: a lit line along each side of the nose, a slim housing under it.
      const line = (t0: number, t1: number, x0: number, x1: number, n = 6) =>
        Array.from({ length: n + 1 }, (_, i) => {
          const t = t0 + ((t1 - t0) * i) / n;
          const x = x0 + ((x1 - x0) * i) / n;
          return new THREE.Vector3(x, k.height(t, x) + 0.008, k.z(t));
        });
      slitLamp(k, k.W * 0.42, 0.06, k.W * 0.78, 0.11, 0.07);
      for (const m of strip(k, line(0.03, 0.15, k.W * 0.18, k.W * 0.86), 0.014, 0.012, edge)) lit(m);
      // Hex intakes in the nose, a splitter with a lit edge.
      for (const [x, y, r] of [[0.48, 0.26, 0.09], [0.2, 0.22, 0.07]] as const) {
        const hex = new THREE.CylinderGeometry(r, r, 0.08, 6);
        hex.rotateX(Math.PI / 2);
        k.put(hex, MAT.grille, [x * k.W, y, k.front(x * k.W, y) + 0.04], [0, 0, Math.PI / 6], true);
      }
      const sy = k.body.floor(0.03) - 0.01;
      const sz = k.front(0, sy + 0.04);
      const sw = k.body.half(0.07, 0.1) * 1.95;
      k.put(rbox(sw, 0.02, 0.28, 0.006), MAT.carbon, [0, sy, sz + 0.1]);
      lit(k.put(rbox(sw * 0.96, 0.01, 0.01, 0.003), edge, [0, sy - 0.006, sz - 0.03]));
      // Light lines down each flank's shoulder and sill, and round the arches.
      const shoulder: THREE.Vector3[] = [];
      for (let t = 0.12; t <= 0.96; t += 0.06) shoulder.push(k.side(t, 0.82).add(new THREE.Vector3(0.01, 0, 0)));
      for (const m of strip(k, shoulder, 0.01, 0.01, edge)) lit(m);
      const zF = k.z(k.tF) + k.b.radius + 0.14;
      const zR = k.z(k.tR) - k.b.radius - 0.14;
      const sx = k.side(0.5, 0.04).x + 0.01;
      lit(k.put(rbox(0.012, 0.012, zR - zF, 0.004), edge, [sx, k.body.floor(0.5) + 0.02, (zF + zR) / 2], [0, 0, 0], true));
      for (const t of [k.tF, k.tR]) {
        const x = k.side(t, 0.06).x + 0.01;
        lit(k.put(new THREE.TorusGeometry(k.b.radius + 0.08, 0.008, 4, 28, Math.PI), edge, [x, k.b.radius, k.z(t)], [0, Math.PI / 2, 0], true));
      }
      // A dark blade down each flank, from behind the front wheel to the rear intake, its top edge lit.
      const b0 = k.tF + 0.1;
      const b1 = k.tR - 0.1;
      const bHi = (t: number) => 0.62 - 0.3 * smoothstep(b0, b1, t);
      const bLo = (t: number) => 0.12 + 0.12 * smoothstep(b0, b1, t);
      sidePanel(k, b0, b1, bLo, bHi, MAT.carbon);
      const bladeEdge: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = b0 + ((b1 - b0) * i) / 10;
        bladeEdge.push(k.side(t, bHi(t)).add(new THREE.Vector3(0.012, 0, 0)));
      }
      for (const m of strip(k, bladeEdge, 0.01, 0.01, edge)) lit(m);
      // Faceted side intake ahead of the rear wheel.
      const it = k.tR - 0.15;
      const p = k.side(it, 0.5);
      k.put(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 3), MAT.grille, [p.x - 0.03, p.y, p.z], [0, 0, Math.PI / 2], true);
      // Roof scoop, the V10 with lit cam covers, hex louvres on the engine cover.
      vantaRoofScoop(k);
      vantaEngine(k, edge);
      louvres(k, 0.75, 0.93, 9, () => k.W * 0.9, (t) => k.top(t), MAT.gloss);
      // Tail: one thin lamp line on the tail's curve with a lit edge under it.
      const ty = k.top(0.99) - 0.05;
      const tw = k.body.half(0.99, 0.8) * 0.95;
      const tc = rearCurve(k, ty, tw);
      rearBand(k, tc, ty, tw * 1.02, 0.04, MAT.gloss, 0.006, 0.05);
      rearBand(k, tc, ty, tw, 0.018, k.tail, 0.014, 0.04);
      for (const m of strip(k, Array.from({ length: 9 }, (_, i) => { const x = -tw + (2 * tw * i) / 8; return new THREE.Vector3(x, ty - 0.035, tc.z(x) + 0.012); }), 0.008, 0.008, edge, false)) lit(m);
      k.put(rbox(k.body.half(0.99, 0.3) * 1.8, 0.12, 0.12, 0.02), MAT.grille, [0, 0.26, k.rear(0, 0.26) - 0.04]);
      diffuser(k, 3, 0.16, MAT.gloss);
      exhaust(k, 0.32, 0.28, 0.05, true, 6);
      // The floating blade: a single thin plane on two slim posts, its trailing edge lit.
      wing(k, { t: 0.95, up: 0.26, back: 0.08, span: k.W * 1.9, chord: 0.26, pitch: -0.06, mat: MAT.gloss, posts: 'straight', postX: k.W * 0.2, edge });
    },
  },
  // Wangan: a highway runner built for 300 km/h at night. Smooth and long, lamps under glass, a ducktail, no wing.
  wangan: {
    ...V,
    top: [[0, 0.26], [0.05, 0.42], [0.12, 0.54], [0.209, 0.62], [0.3, 0.6], [0.45, 0.6], [0.62, 0.64], [0.791, 0.68], [0.92, 0.7], [0.985, 0.74], [1, 0.68]],
    dip: [[0, 0], [0.1, 0.04], [0.24, 0.05], [0.34, 0], [0.7, 0], [0.85, 0.02], [1, 0]],
    floor: [[0, 0.17], [0.04, 0.12], [0.1, 0.11], [0.93, 0.11], [0.97, 0.16], [1, 0.28]],
    waist: 0.05, flareF: 0.06, flareR: 0.09, nose: [0.22, 0.42], tail: [0.06, 0.9], rb: 0.06, rt: 0.17, crease: 0.006,
    plate: 'WANGAN', plateY: 0.46,
    kit(k) {
      // Long lamps under a clear cover, faired into the nose.
      slitLamp(k, k.W * 0.34, 0.04, k.W * 0.84, 0.12, 0.09);
      k.put(rbox(k.W * 1.1, 0.06, 0.1, 0.03), MAT.grille, [0, 0.22, k.front(0, 0.22) + 0.04]);
      k.put(rbox(k.body.half(0.07, 0.1) * 1.9, 0.016, 0.24, 0.006), MAT.gloss, [0, 0.12, k.front(0, k.body.floor(0.05) + 0.03) + 0.1]);
      // Twin NACA ducts in the hood, a smooth side scoop ahead of the rear wheel.
      for (const x of [k.W * 0.26]) {
        const t = 0.18;
        k.put(rbox(0.1, 0.012, 0.3, 0.02), MAT.hole, [x, k.height(t, x) + 0.002, k.z(t)], [0.05, 0, 0], true);
      }
      const it = k.tR - 0.17;
      const p = k.side(it, 0.55);
      k.put(rbox(0.06, 0.14, 0.3, 0.05), MAT.hole, [p.x - 0.02, p.y, p.z], [0, 0.12, 0], true);
      vantaEngine(k);
      louvres(k, 0.75, 0.9, 6, () => k.W * 0.9, (t) => k.top(t), MAT.gloss);
      // A gurney strip along the ducktail, a slim lamp band, a clean diffuser and two big round pipes.
      const dt = 0.975;
      k.put(rbox(k.body.half(dt, 1) * 1.8, 0.02, 0.03, 0.006), MAT.gloss, [0, k.top(dt) + 0.012, k.z(dt)]);
      lampBand(k, k.top(0.99) - 0.07, k.body.half(0.99, 0.8) * 0.94, 0.05);
      k.put(rbox(k.body.half(0.99, 0.3) * 1.8, 0.1, 0.12, 0.03), MAT.grille, [0, 0.26, k.rear(0, 0.26) - 0.04]);
      diffuser(k, 2, 0.1, MAT.gloss);
      exhaust(k, 0.32, 0.26, 0.06, true, 22);
    },
  },

  // Drift Missile: a car that has been sideways into every wall on the mountain. No front bumper, a crash bar
  // and the intercooler out in the open, a primer hood, one door from another car, tape, zip ties, a plank wing.
  missile: {
    ...V,
    top: [[0, 0.34], [0.05, 0.48], [0.12, 0.6], [0.209, 0.69], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.72], [0.92, 0.7], [0.98, 0.67], [1, 0.6]],
    floor: [[0, 0.3], [0.05, 0.16], [0.1, 0.12], [0.92, 0.12], [0.97, 0.18], [1, 0.3]],
    nose: [0.1, 0.66], flareF: 0.11, flareR: 0.16, rb: 0.04,
    plate: 'SIDEWAYS', plateY: 0.46,
    kit(k) {
      slitLamp(k, k.W * 0.4, 0.045, k.W * 0.8, 0.095, 0.1);
      // Where the bumper was: the intercooler, the crash bar in front of it, a tow strap and zip ties.
      const cy = 0.24;
      const cz = k.front(0, cy);
      k.put(rbox(k.W * 1.3, 0.16, 0.06, 0.01), MAT.alloy, [0, cy, cz - 0.03]);
      for (let i = 0; i < 12; i++) k.put(rbox(k.W * 1.28, 0.006, 0.064, 0.002), MAT.trim, [0, cy - 0.07 + i * 0.0125, cz - 0.03]);
      k.put(tube([[-k.W * 0.8, 0.22, cz + 0.05], [-k.W * 0.6, 0.2, cz - 0.11], [k.W * 0.6, 0.2, cz - 0.11], [k.W * 0.8, 0.22, cz + 0.05]], 0.022), MAT.gloss, [0, 0, 0]);
      for (const x of [-0.5, 0.5]) k.put(rbox(0.012, 0.03, 0.03, 0.003), ivory(), [x * k.W, 0.2, cz - 0.11]);
      towStraps(k);
      // A primer hood and a white door on the left side, swapped in from another car.
      const tw = V.roof[0][0] - 0.01;
      topPanel(k, 0.07, tw, (t) => k.body.half(t, 1) * 0.62, primer(), 0.004);
      sidePanel(k, 0.33, 0.6, () => 0.2, () => 0.86, whitePrimer(), 0.004, [-1]);
      // Gaffer tape over the corners and one tail lamp.
      for (const [t, v] of [[0.08, 0.5], [0.12, 0.7]] as const) {
        const p = k.side(t, v);
        k.put(rbox(0.012, 0.05, 0.22, 0.004), tape(), [p.x + 0.004, p.y, p.z], [0.3, 0.2, 0], true);
      }
      vantaRoofScoop(k);
      vantaEngine(k);
      louvres(k, 0.74, 0.92, 7, () => k.W * 1.0, (t) => k.top(t), MAT.carbon);
      const ty = k.top(0.99) - 0.11;
      tailLamp(k, 0.62 * k.W, ty, 0.3, 0.1);
      const lz = k.rear(-0.62 * k.W, ty);
      k.put(rbox(0.34, 0.035, 0.012, 0.004), tape(), [-0.62 * k.W, ty + 0.02, lz + 0.016], [0, 0, 0.12]);
      k.put(rbox(0.34, 0.035, 0.012, 0.004), tape(), [-0.62 * k.W, ty - 0.02, lz + 0.016], [0, 0, -0.1]);
      k.put(rbox(k.W * 1.84, 0.12, 0.14, 0.05), MAT.trim, [0, 0.26, k.rear(0, 0.26) - 0.05]);
      // One fat pipe out the side of the tail, and the plank wing on alloy stays.
      exhaust(k, k.W * 0.6, 0.2, 0.075, false, 20);
      if (!k.wing) {
        const t = 0.95;
        const by = k.top(t);
        const z = k.z(t) + 0.08;
        k.put(rbox(k.W * 1.9, 0.035, 0.26, 0.004), wood(), [0, by + 0.3, z], [-0.14, 0, 0]);
        for (const x of [-0.45, 0.45]) k.put(rbox(0.04, 0.32, 0.06, 0.004), MAT.alloy, [x * k.W, by + 0.15, z], [0.15, 0, 0]);
      }
    },
  },

  // Kustom: a hot rod. A blower through the hood, lamps on chrome stalks, chrome bumpers, fat rear arches and side
  // pipes down both sills.
  kustom: {
    ...V,
    top: [[0, 0.4], [0.04, 0.54], [0.12, 0.62], [0.209, 0.68], [0.3, 0.62], [0.45, 0.6], [0.62, 0.66], [0.791, 0.75], [0.92, 0.72], [0.98, 0.68], [1, 0.62]],
    dip: [[0, 0], [0.06, 0.02], [0.15, 0.03], [0.24, 0.03], [0.32, 0.02], [0.38, 0], [0.6, 0], [0.72, 0.06], [0.9, 0.06], [1, 0.02]],
    floor: [[0, 0.22], [0.05, 0.15], [0.1, 0.13], [0.92, 0.13], [0.97, 0.19], [1, 0.3]],
    waist: 0.08, flareF: 0.07, flareR: 0.22, nose: [0.1, 0.72], tail: [0.05, 0.88], rb: 0.06, rt: 0.14, crease: 0.01,
    ownWing: true, plate: 'HOT ROD', plateY: 0.44,
    kit(k) {
      // Big round lamps on chrome stalks off the fenders, a chrome-ringed mouth and a chrome bumper.
      for (const x of [0.66]) {
        const lx = x * k.W;
        const t = 0.06;
        const y = k.height(t, lx);
        const z = k.z(t) - 0.04;
        k.put(new THREE.CylinderGeometry(0.012, 0.016, 0.1, 8), MAT.chrome, [lx, y + 0.04, z], [0, 0, 0], true);
        k.put(new THREE.SphereGeometry(0.1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), MAT.chrome, [lx, y + 0.13, z + 0.03], [-Math.PI / 2, 0, 0], true);
        k.put(new THREE.CircleGeometry(0.075, 24), MAT.head, [lx, y + 0.13, z - 0.031], [Math.PI, 0, 0], true);
        k.put(new THREE.TorusGeometry(0.08, 0.01, 8, 28), MAT.chrome, [lx, y + 0.13, z - 0.03], [0, 0, 0], true);
      }
      const my = 0.3;
      const mz = k.front(0, my);
      const ring = new THREE.TorusGeometry(0.2, 0.025, 10, 36);
      ring.scale(1.6, 0.6, 1);
      k.put(ring, MAT.chrome, [0, my, mz - 0.01]);
      const mouth = new THREE.CircleGeometry(0.2, 36);
      mouth.scale(1.6, 0.6, 1);
      k.put(mouth, MAT.grille, [0, my, mz + 0.005], [Math.PI, 0, 0]);
      for (let i = -3; i <= 3; i++) k.put(rbox(0.012, 0.2, 0.02, 0.004), MAT.chrome, [i * 0.07, my, mz - 0.005]);
      k.put(tube([[-k.W * 0.86, 0.2, mz + 0.18], [-k.W * 0.7, 0.19, mz - 0.03], [k.W * 0.7, 0.19, mz - 0.03], [k.W * 0.86, 0.2, mz + 0.18]], 0.04), MAT.chrome, [0, 0, 0]);
      // The blower: case, belt, a scoop with three butterflies on top.
      const bt = 0.17;
      const by = k.top(bt);
      const bz = k.z(bt);
      k.put(rbox(0.44, 0.2, 0.52, 0.04), MAT.chrome, [0, by + 0.07, bz]);
      for (let i = 0; i < 6; i++) k.put(rbox(0.46, 0.012, 0.03, 0.005), MAT.alloy, [0, by + 0.04 + i * 0.024, bz]);
      k.put(new THREE.TorusGeometry(0.075, 0.014, 6, 24), MAT.rubber, [0, by + 0.07, bz - 0.27]);
      k.put(rbox(0.38, 0.16, 0.38, 0.05), MAT.gloss, [0, by + 0.25, bz - 0.02], [0.12, 0, 0]);
      for (const x of [-0.12, 0, 0.12]) k.put(rbox(0.1, 0.1, 0.02, 0.01), MAT.chrome, [x, by + 0.26, bz - 0.21], [0.12, 0, 0]);
      // Side pipes down both sills, with heat shields.
      const pz0 = k.z(k.tF) + k.b.radius + 0.16;
      const pz1 = k.z(k.tR) - k.b.radius - 0.08;
      const px = k.side(0.5, 0.06).x + 0.04;
      k.put(new THREE.CylinderGeometry(0.055, 0.055, pz1 - pz0, 16), k.pipe, [px, 0.2, (pz0 + pz1) / 2], [Math.PI / 2, 0, 0], true);
      k.put(rbox(0.03, 0.08, (pz1 - pz0) * 0.6, 0.02), MAT.chrome, [px + 0.05, 0.21, (pz0 + pz1) / 2], [0, 0, 0], true);
      k.put(new THREE.CircleGeometry(0.045, 16), k.pipeHole, [px, 0.2, pz1 + 0.001], [0, 0, 0], true);
      vantaEngine(k);
      // Round tail lamps, a chrome bumper and a little ducktail lip.
      const ty = k.top(0.99) - 0.11;
      for (const x of [0.48, 0.74]) roundLamp(k, x * k.W, ty, 0.065, k.tail, -1, MAT.chrome);
      const rz = k.rear(0, 0.26);
      k.put(tube([[-k.W * 0.86, 0.27, rz - 0.16], [-k.W * 0.7, 0.26, rz + 0.04], [k.W * 0.7, 0.26, rz + 0.04], [k.W * 0.86, 0.27, rz - 0.16]], 0.04), MAT.chrome, [0, 0, 0]);
      if (!k.wing) k.put(rbox(k.W * 1.6, 0.06, 0.22, 0.03), k.paint, [0, k.top(0.955) + 0.02, k.z(0.955) + 0.05], [-0.4, 0, 0]);
    },
  },

  // Classic: a 60s grand tourer. Covered round lamps, an oval mouth in chrome, chrome bumperettes and side trim, a
  // power bulge down the hood and a Kamm tail with round lamps.
  classic: {
    ...V,
    top: [[0, 0.36], [0.04, 0.48], [0.12, 0.58], [0.209, 0.64], [0.3, 0.6], [0.45, 0.6], [0.62, 0.64], [0.791, 0.69], [0.92, 0.68], [0.985, 0.66], [1, 0.58]],
    dip: [[0, 0], [0.08, 0.03], [0.2, 0.04], [0.32, 0.01], [0.38, 0], [0.6, 0], [0.72, 0.02], [0.9, 0.03], [1, 0]],
    floor: [[0, 0.22], [0.05, 0.15], [0.1, 0.13], [0.92, 0.13], [0.97, 0.19], [1, 0.3]],
    waist: 0.04, flareF: 0.07, flareR: 0.1, nose: [0.14, 0.62], tail: [0.04, 0.92], tumble: 0.1, rb: 0.08, rt: 0.2, crease: 0,
    plate: 'GT 1964', plateY: 0.46,
    kit(k) {
      // Round lamps sunk in the fenders under clear perspex covers.
      const ly = k.top(0.05) - 0.03;
      for (const x of [0.62]) {
        const lx = x * k.W;
        roundLamp(k, lx, ly, 0.075, MAT.head, 1);
        const cov = new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        cov.scale(0.9, 0.7, 1.6);
        k.put(cov, MAT.lampGlass, [lx, ly + 0.01, k.front(lx, ly) + 0.08], [-Math.PI / 2 + 0.25, 0, 0], true);
      }
      // The oval mouth with a chrome surround and an egg-crate grille, chrome bumperettes either side.
      const my = 0.27;
      const mz = k.front(0, my);
      const ring = new THREE.TorusGeometry(0.16, 0.018, 10, 36);
      ring.scale(1.5, 0.62, 1);
      k.put(ring, MAT.chrome, [0, my, mz + 0.005]);
      const mouth = new THREE.CircleGeometry(0.16, 36);
      mouth.scale(1.5, 0.62, 1);
      k.put(mouth, MAT.grille, [0, my, mz + 0.02], [Math.PI, 0, 0]);
      for (const x of [-0.08, 0.08]) k.put(rbox(0.006, 0.17, 0.01, 0.002), MAT.chrome, [x, my, mz + 0.012]);
      k.put(rbox(0.4, 0.006, 0.01, 0.002), MAT.chrome, [0, my, mz + 0.012]);
      for (const x of [0.62]) {
        const bx = x * k.W;
        k.put(rbox(0.32, 0.04, 0.06, 0.02), MAT.chrome, [bx, 0.22, k.front(bx, 0.22) + 0.01], [0, 0.35, 0], true);
      }
      // A power bulge down the hood (a long rounded hump), a chrome strip along each flank.
      const hb = (0.08 + V.roof[0][0]) / 2;
      const hl = (V.roof[0][0] - 0.12) * k.L;
      k.put(rbox(0.36, 0.06, hl, 0.03), k.paint, [0, k.top(hb) + 0.005, k.z(hb)], [-Math.atan2(k.top(hb + 0.02) - k.top(hb - 0.02), 0.04 * k.L), 0, 0]);
      const trim: THREE.Vector3[] = [];
      for (let t = 0.16; t <= 0.86; t += 0.035) trim.push(k.side(t, 0.42).add(new THREE.Vector3(0.006, 0, 0)));
      strip(k, trim, 0.01, 0.014, MAT.chrome);
      vantaEngine(k);
      louvres(k, 0.76, 0.9, 5, () => k.W * 0.7, (t) => k.top(t), MAT.chrome);
      // Kamm tail: four round lamps, chrome bumperettes, twin pipes.
      const ty = k.top(0.99) - 0.1;
      for (const x of [0.5, 0.74]) roundLamp(k, x * k.W, ty, 0.055, k.tail, -1, MAT.chrome);
      for (const x of [0.62]) {
        const bx = x * k.W;
        k.put(rbox(0.34, 0.04, 0.06, 0.02), MAT.chrome, [bx, 0.28, k.rear(bx, 0.28) - 0.01], [0, -0.3, 0], true);
      }
      exhaust(k, 0.28, 0.22, 0.04, true, 18);
    },
  },

  // Hyper: a modern hypercar. Flying buttresses from the roof to the tail, C-shaped lamps, vents in the front
  // fenders, side pods, a venturi tail with three pipes high in it and a slim active wing.
  hyper: {
    ...V,
    top: [[0, 0.22], [0.05, 0.4], [0.12, 0.56], [0.209, 0.68], [0.3, 0.6], [0.45, 0.6], [0.62, 0.64], [0.791, 0.74], [0.92, 0.72], [0.98, 0.7], [1, 0.62]],
    dip: [[0, 0], [0.06, 0.1], [0.15, 0.18], [0.24, 0.15], [0.32, 0.04], [0.38, 0], [0.6, 0], [0.7, 0.16], [0.9, 0.18], [1, 0.06]],
    floor: [[0, 0.15], [0.04, 0.11], [0.1, 0.1], [0.92, 0.1], [0.97, 0.16], [1, 0.3]],
    waist: 0.13, flareF: 0.1, flareR: 0.17, nose: [0.2, 0.4], tail: [0.04, 0.9], tumble: 0.16, rb: 0.035, rt: 0.12, crease: 0.02,
    ownWing: true, plate: 'AEON', plateY: 0.44,
    kit(k) {
      // C-shaped lamp lines round a slim projector housing.
      slitLamp(k, k.W * 0.46, 0.05, k.W * 0.8, 0.09, 0.07);
      const c: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI;
        const x = k.W * (0.62 - 0.17 * Math.cos(a));
        const t = 0.07 + 0.035 * Math.sin(a);
        c.push(new THREE.Vector3(x, k.height(t, x) + 0.01, k.z(t)));
      }
      strip(k, c, 0.014, 0.012, MAT.drl);
      // A front splitter, twin centre intakes and vents through the tops of the front fenders.
      k.put(rbox(k.body.half(0.07, 0.1) * 1.96, 0.02, 0.32, 0.006), MAT.carbon, [0, 0.11, k.front(0, k.body.floor(0.05) + 0.03) + 0.13]);
      for (const x of [0.26]) k.put(rbox(0.36, 0.12, 0.14, 0.04), MAT.grille, [x * k.W, 0.23, k.front(x * k.W, 0.23) + 0.06], [0, 0.2, 0], true);
      slats(k, k.W * 0.72, k.tF + 0.02, k.tF + 0.08, 5, 0.24, MAT.carbon);
      // Side pods: a dark sculpted panel down each flank feeding a big intake ahead of the rear wheel.
      const b0 = k.tF + 0.12;
      const b1 = k.tR - 0.13;
      sidePanel(k, b0, b1, (t) => 0.18 + 0.1 * smoothstep(b0, b1, t), (t) => 0.4 + 0.2 * smoothstep(b0, b1, t), MAT.carbon);
      const it = k.tR - 0.13;
      const p = k.side(it, 0.55);
      k.put(rbox(0.12, 0.3, 0.26, 0.05), MAT.hole, [p.x - 0.04, p.y, p.z], [0, 0.18, 0], true);
      vantaRoofScoop(k);
      vantaEngine(k);
      // Flying buttresses: painted fins from the back of the roof down to the tail's corners, the engine between.
      const outline: [number, number][] = [];
      const under: [number, number][] = [];
      const bx = k.cabin.half(V.roofR, 1) * 0.9;
      for (let i = 0; i <= 12; i++) {
        const t = V.roofR + (i / 12) * (0.985 - V.roofR);
        const base = k.height(t, bx);
        outline.push([k.z(t), Math.max(base + 0.04, k.cabin.top(V.roofR) - 0.02 - (k.cabin.top(V.roofR) - base - 0.04) * smoothstep(V.roofR, 0.985, t) ** 0.7)]);
        under.push([k.z(t), base - 0.04]);
      }
      fin(k, [...outline, ...under.reverse()], bx, 0.05, MAT.gloss, true);
      // Tail: a lamp line across the top, a venturi tail with tall fences, three pipes high in the middle, the wing.
      lampBand(k, k.top(0.99) - 0.05, k.body.half(0.99, 0.8) * 0.94, 0.03);
      k.put(rbox(k.body.half(0.99, 0.3) * 1.8, 0.16, 0.14, 0.03), MAT.grille, [0, 0.3, k.rear(0, 0.3) - 0.05]);
      diffuser(k, 4, 0.28);
      for (const x of [-0.11, 0, 0.11]) exhaust(k, x, 0.3, 0.042, false, 6);
      wing(k, { t: 0.965, up: 0.12, back: 0.06, span: k.W * 1.6, chord: 0.28, pitch: -0.08, mat: MAT.carbon, posts: 'straight', postX: k.W * 0.3 });
    },
  },

  // Oni: a demon in armour. Plated flanks, two horns off the front fenders, angry red eyes, fangs in the mouth,
  // dragon spines down the back and red veins that glow.
  oni: {
    ...V,
    top: [[0, 0.24], [0.06, 0.46], [0.15, 0.62], [0.209, 0.72], [0.3, 0.62], [0.45, 0.6], [0.62, 0.68], [0.791, 0.77], [0.95, 0.74], [1, 0.66]],
    dip: [[0, 0], [0.06, 0.12], [0.15, 0.22], [0.24, 0.18], [0.32, 0.05], [0.38, 0], [0.6, 0], [0.72, 0.12], [0.9, 0.14], [1, 0.04]],
    floor: [[0, 0.16], [0.04, 0.12], [0.1, 0.11], [0.92, 0.11], [0.97, 0.17], [1, 0.28]],
    waist: 0.11, flareF: 0.14, flareR: 0.19, nose: [0.24, 0.3], tail: [0.05, 0.86], tumble: 0.18, rb: 0.025, rt: 0.06, crease: 0.028,
    ownWing: true, plate: 'ONI', plateY: 0.44,
    kit(k) {
      const vein = glowMat(ONI);
      // Angry eyes: red slits slanting down towards the middle, under black brows.
      for (const [x0, t0, x1, t1] of [[0.34, 0.07, 0.78, 0.1]] as const) {
        const pts = Array.from({ length: 5 }, (_, i) => {
          const x = k.W * (x0 + ((x1 - x0) * i) / 4);
          const t = t0 + ((t1 - t0) * i) / 4;
          return new THREE.Vector3(x, k.height(t, x) + 0.012, k.z(t));
        });
        strip(k, pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.02, 0.03))), 0.05, 0.02, MAT.gloss);
        for (const m of strip(k, pts, 0.03, 0.016, vein)) lit(m);
      }
      // The mouth: a wide dark intake with white fangs hanging into it.
      const my = 0.25;
      const mz = k.front(0, my);
      k.put(rbox(k.W * 1.2, 0.14, 0.14, 0.04), MAT.grille, [0, my, mz + 0.06]);
      for (const x of [-0.42, -0.18, 0.18, 0.42]) {
        const fang = new THREE.ConeGeometry(0.026, Math.abs(x) > 0.3 ? 0.11 : 0.08, 10);
        fang.rotateX(Math.PI);
        k.put(fang, ivory(), [x * k.W, my + 0.03, k.front(x * k.W, my + 0.07) - 0.005]);
      }
      // Horns off the front fenders, swept back and up.
      const ht = k.tF - 0.02;
      const hx = k.W * 0.74;
      const hy = k.height(ht, hx);
      horn(k, new THREE.Vector3(hx, hy - 0.02, k.z(ht)), new THREE.Vector3(hx + 0.12, hy + 0.22, k.z(ht) - 0.02), new THREE.Vector3(hx + 0.06, hy + 0.4, k.z(ht) + 0.2), 0.055, ivory());
      // Armour plates down the flanks, each with a lit seam above it, and red rings in the arches.
      for (const [a, b] of [[k.tF + 0.1, 0.38], [0.4, 0.52], [0.54, k.tR - 0.1]] as const) {
        sidePanel(k, a, b, () => 0.18, () => 0.6, MAT.gloss, 0.008);
        const seam: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const t = a + ((b - a) * i) / 4;
          seam.push(k.side(t, 0.63).add(new THREE.Vector3(0.012, 0, 0)));
        }
        for (const m of strip(k, seam, 0.008, 0.008, vein)) lit(m);
      }
      for (const t of [k.tF, k.tR]) {
        const x = k.side(t, 0.06).x + 0.01;
        lit(k.put(new THREE.TorusGeometry(k.b.radius + 0.08, 0.008, 4, 28, Math.PI), vein, [x, k.b.radius, k.z(t)], [0, Math.PI / 2, 0], true));
      }
      // Dragon spines down the roof and the engine cover.
      vantaEngine(k, vein);
      for (let i = 0; i < 9; i++) {
        const t = V.roofF + 0.02 + i * 0.055;
        const y = t < V.roofR + 0.12 ? Math.max(k.cabin.top(Math.min(t, 0.77)), k.top(t)) : k.top(t);
        const h = 0.13 - Math.abs(i - 3) * 0.015;
        const spike = new THREE.ConeGeometry(0.035, h, 4);
        spike.scale(0.5, 1, 1.8);
        k.put(spike, MAT.gloss, [0, y + h / 2 - 0.01, k.z(t)], [0.5, 0, 0]);
      }
      // Tail: red lamp slits on the curve over a lit vein, a black blade wing with a red edge.
      const ty = k.top(0.99) - 0.06;
      const tw = k.body.half(0.99, 0.8) * 0.94;
      const tc = rearCurve(k, ty, tw);
      rearBand(k, tc, ty, tw * 1.02, 0.05, MAT.gloss, 0.006, 0.05);
      rearBand(k, tc, ty, tw, 0.022, k.tail, 0.014, 0.04);
      k.put(rbox(k.body.half(0.99, 0.3) * 1.8, 0.12, 0.12, 0.02), MAT.grille, [0, 0.26, k.rear(0, 0.26) - 0.04]);
      diffuser(k, 3, 0.16, MAT.gloss);
      exhaust(k, 0.3, 0.28, 0.05, true, 6);
      wing(k, { t: 0.95, up: 0.3, back: 0.1, span: k.W * 2.0, chord: 0.3, pitch: -0.1, mat: MAT.gloss, posts: 'swan', postX: k.W * 0.3, edge: vein });
    },
  },
};

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
