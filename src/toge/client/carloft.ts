// Lofted car bodies: a body is a run of rounded cross-sections along its length, so its side outline
// (`top` / `bottom`) and its plan outline (`half`) are separate curves. That's what gives the cars waists,
// flared arches, rounded noses and a greenhouse with real pillars, which an extruded side profile can't.

import * as THREE from 'three';

/** A smooth curve through [t, value] keys (monotone cubic, so it never overshoots between keys). */
export function curve(keys: [number, number][]): (t: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const u = (t - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Which part of a cross-section a face is on, so each part can get its own material. */
export type Zone = 'bottom' | 'lower' | 'side' | 'shoulder' | 'top';

/**
 * One loft. `t` runs along the car from 0 (nose) to 1 (tail); z = -length/2 + t·length, so the front is -Z.
 * The underside is `floor` in the middle and `bottom` outboard of the wheel wells (`well`, metres from the
 * centre), so wheel arches cut only the outer skin. The top is the shoulder line `top`, with the middle
 * (hood, deck) sitting `dip` below it: that's how fenders rise above a low hood.
 */
export interface Section {
  length: number;
  t0: number;
  t1: number;
  floor(t: number): number;
  bottom(t: number): number;
  well(t: number): number;
  top(t: number): number;
  dip(t: number): number;
  /** Half width at `t`, `v` of the way from the bottom (0) to the top (1) of the section. */
  half(t: number, v: number): number;
  /** Corner radii (m) along the bottom and top edges of every section. */
  rb: number;
  rt: number;
  /** A character line down the flank: how far (m) the crease stands proud, a hand below the shoulder. */
  crease?: number;
}

/** Where the crease runs: this far below the start of the shoulder's rounding. */
const CREASE_DROP = 0.045;
/** Half the crease's width (m): it rises to its peak and falls away over this. */
const CREASE_HALF = 0.03;

/** How far the crease pushes the flank out at height y (from the section's bottom) in a section h tall. */
function creaseOut(s: Section, h: number, w: number, y: number): number {
  const c = s.crease ?? 0;
  if (!c) return 0;
  const rt = Math.min(s.rt, h * 0.5, w * 0.6);
  const rb = Math.min(s.rb, h * 0.45, w * 0.45);
  const yc = h - rt - CREASE_DROP;
  if (yc < rb + CREASE_HALF) return 0;
  return c * Math.max(0, 1 - Math.abs(y - yc) / CREASE_HALF);
}

export const zAt = (s: Section, t: number) => (t - 0.5) * s.length;

/** Height of the top at `u` (0 = centre line, 1 = the side). */
const topAt = (s: Section, t: number, u: number) => s.top(t) - s.dip(t) * (1 - smooth(0.4, 0.92, u));

/** Height of the top surface at `t`, `x` metres from the centre line. */
export const heightAt = (s: Section, t: number, x: number) => topAt(s, t, Math.abs(x) / s.half(t, 1));

/** The middle of the top (hood, roof, deck) at `t`. */
export const centreTop = (s: Section, t: number) => s.top(t) - s.dip(t);

/** A point on the side of the surface: `v` up the section, on the right (+1) or left (-1). */
export function surface(s: Section, t: number, v: number, side = 1): THREE.Vector3 {
  const b = s.bottom(t);
  const h = Math.max(0.004, s.top(t) - b);
  const w = Math.max(0.01, s.half(t, 0.5));
  const out = creaseOut(s, h, w, v * h) * (s.half(t, v) / w);
  return new THREE.Vector3(side * (s.half(t, v) + out), b + v * h, zAt(s, t));
}

/** Where the surface is at this x and height, coming in from the nose (`dir` 1) or the tail (-1). */
export function endZ(s: Section, x: number, y: number, dir: 1 | -1): number {
  for (let i = 0; i <= 400; i++) {
    const t = dir > 0 ? s.t0 + (i / 400) * (s.t1 - s.t0) : s.t1 - (i / 400) * (s.t1 - s.t0);
    const b = s.floor(t);
    const w = s.half(t, 0.5);
    const top = topAt(s, t, Math.abs(x) / w);
    if (y < b || y > top) continue;
    if (s.half(t, (y - b) / Math.max(1e-3, top - b)) >= Math.abs(x)) return zAt(s, t);
  }
  return zAt(s, dir > 0 ? s.t0 : s.t1);
}

interface RingPt {
  x: number;
  y: number;
  zone: Zone;
  /** On the underside inboard of the wheel well (sits on `floor`, not `bottom`). */
  inner?: boolean;
}

/**
 * Half a cross-section, from the bottom centre round the right side to the top centre, in a w × h box. The
 * flat of the side is sampled finely enough to carry the crease (`out(y)`, metres proud of the side).
 */
function halfRing(w: number, h: number, rb: number, rt: number, uWell: number, out: (y: number) => number = () => 0): RingPt[] {
  const p: RingPt[] = [];
  const uw = Math.min(uWell, (w - rb) / w - 0.06);
  for (const u of [0, uw * 0.5, uw - 0.02]) p.push({ x: u * w, y: 0, zone: 'bottom', inner: true });
  p.push({ x: (uw + 0.03) * w, y: 0, zone: 'bottom' });
  for (let i = 0; i <= 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2);
    p.push({ x: w - rb + Math.cos(a) * rb, y: rb + Math.sin(a) * rb, zone: 'lower' });
  }
  // Every ring must have the same number of points, so the crease's samples are always there (clamped onto
  // the flat, and simply flat where a section has no crease).
  const lo = rb;
  const hi = h - rt;
  const ys: number[] = [];
  for (let i = 1; i <= 5; i++) ys.push(lo + (i / 6) * (hi - lo));
  const yc = h - rt - CREASE_DROP;
  for (const f of [-1, -0.35, 0, 0.35, 1]) ys.push(Math.min(hi, Math.max(lo, yc + f * CREASE_HALF)));
  ys.sort((a, b) => a - b);
  for (const y of ys) p.push({ x: w + out(y), y, zone: 'side' });
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    p.push({ x: w - rt + Math.cos(a) * rt, y: h - rt + Math.sin(a) * rt, zone: i === 0 ? 'side' : 'shoulder' });
  }
  for (let i = 1; i <= 5; i++) p.push({ x: (w - rt) * (1 - i / 5), y: h, zone: 'top' });
  return p;
}

/**
 * Builds the loft's surface, split into one geometry per material: `pick(t, zone, v, u)` chooses a material
 * index for each face (u: how far out from the centre line, 0..1 of the half width; -1 skips the face). UVs run along the car (u = t) and round the section (v: 0 at the bottom centre,
 * 0.5 on the top centre), so stripes can be painted on as a texture. Ends are capped with `capMat`.
 */
export function loft(s: Section, slices: number, mats: number, pick: (t: number, zone: Zone, v: number, u: number) => number, capMat = -1): THREE.BufferGeometry[] {
  const pos: number[] = [];
  const uv: number[] = [];
  let ringN = 0;
  let zones: Zone[] = [];
  let vs: number[] = [];
  let us: number[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= slices; i++) {
    // Denser slices at the ends, where the nose and tail curl round.
    const k = i / slices;
    const t = s.t0 + (s.t1 - s.t0) * (0.65 * k + 0.35 * (0.5 - 0.5 * Math.cos(Math.PI * k)));
    ts.push(t);
    const b = s.bottom(t);
    const fl = s.floor(t);
    const h = Math.max(0.004, s.top(t) - b);
    const w = Math.max(0.01, s.half(t, 0.5));
    const half = halfRing(w, h, Math.min(s.rb, h * 0.45, w * 0.45), Math.min(s.rt, h * 0.5, w * 0.6), s.well(t) / w, (y) => creaseOut(s, h, w, y));
    const ring = [...half, ...half.slice(1, -1).reverse().map((p) => ({ ...p, x: -p.x }))];
    ringN = ring.length;
    // A segment takes the zone of its upper end (going up the right side, down the left).
    zones = ring.map((p, j) => (j < half.length - 1 ? ring[j + 1].zone : p.zone));
    vs = ring.map((p) => p.y / h);
    us = ring.map((p) => Math.abs(p.x) / w);
    let per = 0;
    const acc = [0];
    for (let j = 1; j <= ringN; j++) {
      const a = ring[j - 1];
      const c = ring[j % ringN];
      per += Math.hypot(c.x - a.x, c.y - a.y);
      acc.push(per);
    }
    for (let j = 0; j < ringN; j++) {
      const p = ring[j];
      const v = p.y / h;
      const u = Math.abs(p.x) / w;
      const lo = p.inner ? fl : b;
      const hi = Math.max(lo + 0.01, topAt(s, t, u));
      pos.push(u * Math.sign(p.x) * s.half(t, v), lo + v * (hi - lo), zAt(s, t));
      uv.push(t, acc[j] / per);
    }
  }
  const idx: number[][] = Array.from({ length: mats }, () => []);
  for (let i = 0; i < slices; i++) {
    const tm = (ts[i] + ts[i + 1]) / 2;
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN;
      const a = i * ringN + j;
      const b = i * ringN + j2;
      const c = (i + 1) * ringN + j;
      const d = (i + 1) * ringN + j2;
      const m = pick(tm, zones[j], (vs[j] + vs[j2]) / 2, (us[j] + us[j2]) / 2);
      if (m >= 0) idx[m].push(a, b, c, b, d, c);
    }
  }
  if (capMat >= 0) {
    for (const [slice, front] of [[0, true], [slices, false]] as const) {
      const centre = pos.length / 3;
      let cy = 0;
      for (let j = 0; j < ringN; j++) cy += pos[(slice * ringN + j) * 3 + 1];
      pos.push(0, cy / ringN, pos[slice * ringN * 3 + 2]);
      uv.push(ts[slice], 0.5);
      for (let j = 0; j < ringN; j++) {
        const a = slice * ringN + j;
        const b = slice * ringN + ((j + 1) % ringN);
        if (front) idx[capMat].push(centre, b, a);
        else idx[capMat].push(centre, a, b);
      }
    }
  }
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  all.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  all.setIndex(idx.flat());
  all.computeVertexNormals();
  return idx.map((list) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', all.getAttribute('position'));
    g.setAttribute('normal', all.getAttribute('normal'));
    g.setAttribute('uv', all.getAttribute('uv'));
    g.setIndex(list);
    return g;
  });
}
