// three.js for the house: the static boxes merged per material (UVs in metres so textures tile at real size),
// per-room wall paint, the doors (leaves that swing), lamps, the roof and the street outside. Lighting never adds
// or removes a light mid-night (that recompiles every shader): a fixed pool of four point lights follows the lamps
// nearest you, and the phone torch is a spotlight that's always there and just changes intensity.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rampHeightAt } from '../../gambol/shared/collision.ts';
import {
  BOXES,
  DEPTH,
  DOORS,
  DOOR_H,
  FIREPIT,
  FLOOR_Y,
  GROUND,
  LAMPS,
  SOLIDS,
  PRISMS,
  ROOMS,
  SPOTS,
  TREE,
  WIDTH,
  doorBox,
  floorOf,
  roomAt,
  type Door,
  type HBox,
} from './house.ts';
import { ramp } from './people.ts';
import { disposeTextures, texture } from './textures.ts';
import { DRAWN, buildProps } from './props.ts';
import { BongModel } from './smoke.ts';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Vec3 } from '../../shared/math.ts';

interface Look {
  color: string;
  tex?: string;
  glow?: string;
  clear?: boolean;
}

/** How each surface looks. Paint is per room (see PAINT). */
const LOOKS: Record<string, Look> = {
  wood: { color: '#ffffff', tex: 'wood' },
  tile: { color: '#ffffff', tex: 'tile' },
  lino: { color: '#ffffff', tex: 'lino' },
  grass: { color: '#ffffff', tex: 'grass' },
  path: { color: '#8a8478' },
  porch: { color: '#ffffff', tex: 'porch' },
  stair: { color: '#ffffff', tex: 'stair' },
  ply: { color: '#ffffff', tex: 'ply' },
  stone: { color: '#8d877c' },
  brick: { color: '#ffffff', tex: 'brick' },
  feature: { color: '#d8b8b0', tex: 'brick' },
  trim: { color: '#f4f0e6' },
  rail: { color: '#efe9dc' },
  banister: { color: '#7a4e2c' },
  glass: { color: '#3a4a78', glow: '#121a36', clear: true },
  skirting: { color: '#f3eee2' },
  ceiling: { color: '#f2ede2', tex: 'stipple' },
  fence: { color: '#6b5440' },
  neighbour: { color: '#6d4a3e', tex: 'brick' },
  neighbourRoof: { color: '#3a3a42' },
  darkWindow: { color: '#1c2238', glow: '#0a0e1c' },
  tv: { color: '#111216', glow: '#24304a' },
  bed: { color: '#5f7a9a' },
  desk: { color: '#9a7350' },
  couch: { color: '#2d3a5e' },
  leather: { color: '#1e1c1e' },
  table: { color: '#8a5f3a' },
  counter: { color: '#cfc6b6' },
  fridge: { color: '#e8e8e4' },
  toilet: { color: '#fbfbf8' },
  tub: { color: '#f4f4f0' },
  sink: { color: '#f0f0ea' },
  radiator: { color: '#e6e2d8' },
  hutch: { color: '#6b4426' },
  shelf: { color: '#f2f2f0' },
  records: { color: '#4a3020' },
  beanbag: { color: '#8a3a6a' },
  bin: { color: '#2f5a8a' },
  junk: { color: '#a8875e' },
  shingle: { color: '#ffffff', tex: 'shingle' },
  door: { color: '#f6f3ec' },
  doorPanel: { color: '#e6e0d2' },
  brass: { color: '#c9a24e' },
  hatch: { color: '#9a7a52' },
  lamp: { color: '#ffe2a8', glow: '#ffcf7a' },
  window: { color: '#ffd38a', glow: '#ff9f40' },
  asphalt: { color: '#2a2a30' },
  kerb: { color: '#7c7a74' },
  roadLine: { color: '#d8c060', glow: '#3a3010' },
  car: { color: '#7a2230' },
  tyre: { color: '#151518' },
  pole: { color: '#34343c' },
  bark: { color: '#4a3a30' },
  wire: { color: '#111111' },
};

/** Wall paint by room: Dev's grey-blue, Selby's purple studio, white bathrooms. */
const PAINT: Record<string, string> = {
  dev: '#8d9db4',
  selby: '#b9a6cf',
  kitchen: '#efe1b2',
  bath2: '#e3eef0',
  bath3: '#e3eef0',
  will: '#f5f2ea',
  xang: '#d6cba6',
  wags: '#d8c6a4',
  jung: '#e6ddc8',
  mikol: '#cfd6c2',
  eaves: '#a88d68',
  eaves2: '#a88d68',
};
const CREAM = '#eee4cf';

/** The lamps outside: the porch light, the backyard light, the streetlight. */
const OUT_LAMPS: Vec3[] = [
  { x: 2.4, y: 2.4, z: 21.4 },
  { x: 2.6, y: 2.1, z: -0.7 },
  { x: WIDTH + 1.8, y: 4.6, z: 29.4 },
];
const PARTY = new Set([0, 1]);

type V = [number, number, number];

/**
 * Lamp light baked into vertex colours when the house loads: pools of warm light under each lamp, darker corners and
 * far ends. It multiplies the surface colour, so a power cut (the real lights off) still goes dark.
 */
const BAKE_LAMPS = [...LAMPS, ...OUT_LAMPS];
function bake(v: V, n: V): number {
  const f = floorOf(v[1] + 0.05);
  let light = 0.62;
  for (const l of BAKE_LAMPS) {
    if (floorOf(l.y - 0.2) !== f && l.y > 0.5) continue;
    const dx = l.x - v[0];
    const dy = l.y - v[1];
    const dz = l.z - v[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const facing = Math.max(0, (dx * n[0] + dy * n[1] + dz * n[2]) / Math.sqrt(d2 + 1e-6));
    // Ceilings right over a lamp get less of it, or they'd glare.
    light += ((n[1] < -0.5 ? 0.45 : 0.75) * (0.35 + 0.65 * facing)) / (1 + d2 / 5);
  }
  // A touch of darkness right at the floor and in the top corners.
  const up = v[1] - [0, 2.8, 5.6][f];
  if (up < 0.25 && n[1] < 0.5) light *= 0.82 + up * 0.7;
  return Math.max(0.5, Math.min(1.35, light));
}

/** Collects quads per material, with UVs in metres; big faces are split into tiles so the baked light can vary. */
class Builder {
  private parts = new Map<string, { pos: number[]; uv: number[]; nrm: number[]; col: number[] }>();

  quad(mat: string, a: V, b: V, c: V, d: V, n: V, uAxis: 0 | 1 | 2, vAxis: 0 | 1 | 2) {
    const len = (p: V, q: V) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const nu = Math.min(12, Math.max(1, Math.ceil(Math.max(len(a, b), len(d, c)) / 1.2)));
    const nv = Math.min(12, Math.max(1, Math.ceil(Math.max(len(a, d), len(b, c)) / 1.2)));
    if (nu === 1 && nv === 1) return this.tile(mat, a, b, c, d, n, uAxis, vAxis);
    const at = (s: number, t: number): V => {
      const top: V = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      const bot: V = [d[0] + (c[0] - d[0]) * s, d[1] + (c[1] - d[1]) * s, d[2] + (c[2] - d[2]) * s];
      return [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t];
    };
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) this.tile(mat, at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv), n, uAxis, vAxis);
  }

  private tile(mat: string, a: V, b: V, c: V, d: V, n: V, uAxis: 0 | 1 | 2, vAxis: 0 | 1 | 2) {
    // Wind so the face's normal points out (n).
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const pts = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    let p = this.parts.get(mat);
    if (!p) this.parts.set(mat, (p = { pos: [], uv: [], nrm: [], col: [] }));
    const lit = !mat.startsWith('glass') && mat !== 'window' && mat !== 'wire';
    const look = LOOKS[mat];
    const m = mat.startsWith('paint:') ? texture('plaster')!.metres : look?.tex ? texture(look.tex)!.metres : 1;
    for (const v of pts) {
      p.pos.push(v[0], v[1], v[2]);
      p.uv.push(v[uAxis] / m, v[vAxis] / m);
      p.nrm.push(n[0], n[1], n[2]);
      const k = lit ? bake(v, n) : 1;
      p.col.push(k, k, k);
    }
  }

  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, p] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      out.push(new THREE.Mesh(g, material(key, true)));
    }
    return out;
  }
}

const mats = new Map<string, THREE.Material>();
/** A surface's material; `baked` ones read the house's vertex colours (the baked lamp light). */
function material(key: string, baked = false): THREE.Material {
  let m = mats.get(baked ? `b:${key}` : key);
  if (m) return m;
  if (key.startsWith('paint:')) m = new THREE.MeshToonMaterial({ color: key.slice(6), map: texture('plaster')!.tex, gradientMap: ramp(), vertexColors: baked });
  else {
    const l = LOOKS[key] ?? { color: '#ff00ff' };
    const t = l.tex ? texture(l.tex)!.tex : null;
    m = new THREE.MeshToonMaterial({
      color: l.color,
      map: t,
      gradientMap: ramp(),
      emissive: l.glow ?? '#000000',
      transparent: !!l.clear,
      opacity: l.clear ? 0.72 : 1,
      side: THREE.FrontSide,
      vertexColors: baked,
    });
  }
  mats.set(baked ? `b:${key}` : key, m);
  return m;
}

/** The boxes stairs are drawn as (treads, risers, sides). */
const STEPS = new WeakSet<HBox>();

/** Which material a box's face gets (paint follows the room the face looks into). */
function faceMat(b: HBox, n: V, c: V): string {
  // Drawn stairs: wooden treads; indoors their risers and sides take the wall paint (so a flight's end flush with a
  // wall matches it), outdoors (the porch steps) they're white trim.
  if (STEPS.has(b)) {
    if (n[1] > 0.5) return b.mat;
    if (b.mat !== 'stair') return 'trim';
  }
  const floors = new Set(['wood', 'tile', 'lino', 'grass', 'porch', 'path']);
  if (floors.has(b.mat)) {
    if (n[1] > 0.5) return b.mat;
    if (b.mat === 'grass' || b.floor === 0) return b.mat === 'grass' ? 'grass' : 'stone';
    if (n[1] < -0.5) return 'ceiling';
    // A slab's edge: brick on the outside of the house, trim round a stair well.
    const px = c[0] + n[0] * 0.3;
    const pz = c[2] + n[2] * 0.3;
    return px < 0 || px > WIDTH || pz < 0 || pz > DEPTH ? 'brick' : 'trim';
  }
  if (b.ramp) return n[1] > 0.3 ? b.mat : 'trim';
  // Windows: night glass from inside; from outside, a lit room's warm glow.
  if (b.mat === 'glass') {
    const p = { x: c[0] + n[0] * 0.3, y: FLOOR_Y[b.floor] + 1, z: c[2] + n[2] * 0.3 };
    const out = p.x < 0 || p.x > WIDTH || p.z < 0 || p.z > DEPTH || !!roomAt(p)?.outside;
    return out ? 'window' : 'glass';
  }
  // A solid stair base or landing: wooden on top, painted like a wall on its sides.
  if (b.mat === 'stair' && n[1] > 0.5) return 'stair';
  if (b.mat === 'wall' || b.mat === 'brick' || b.mat === 'stair') {
    if (n[1] !== 0) return 'trim';
    // The end of an outside wall (a window or door reveal) is painted like the room it opens from.
    const alongX = b.max.x - b.min.x >= b.max.z - b.min.z;
    if (b.mat === 'brick' && (alongX ? n[0] !== 0 : n[2] !== 0)) {
      for (const s of [1, -1]) {
        const p = alongX ? { x: c[0] + n[0] * 0.05, y: FLOOR_Y[b.floor] + 1.2, z: c[2] + s * 0.5 } : { x: c[0] + s * 0.5, y: FLOOR_Y[b.floor] + 1.2, z: c[2] + n[2] * 0.05 };
        const r = p.x > 0 && p.x < WIDTH && p.z > 0 && p.z < DEPTH ? roomAt(p) : null;
        if (r && !r.outside) return `paint:${PAINT[r.id] ?? CREAM}`;
      }
    }
    // Probe at the face's own floor (a strip above a window is still that room, not the floor above).
    const probe = { x: c[0] + n[0] * 0.3, y: FLOOR_Y[b.floor] + 1.2, z: c[2] + n[2] * 0.3 };
    const outside = probe.x < 0 || probe.x > WIDTH || probe.z < 0 || probe.z > DEPTH;
    if (outside) return b.mat === 'brick' ? 'brick' : 'trim';
    const r = roomAt(probe);
    if (r?.outside) return 'brick';
    return `paint:${(r && PAINT[r.id]) ?? CREAM}`;
  }
  return b.mat;
}

/** Adds a box (or a ramp wedge) to the builder, face by face. */
function addBox(bld: Builder, b: HBox) {
  const x0 = b.min.x;
  const x1 = b.max.x;
  const y0 = b.min.y;
  const z0 = b.min.z;
  const z1 = b.max.z;
  const top = (x: number, z: number) => (b.ramp ? rampHeightAt(b, b.ramp.axis === 'x' ? x : z) : b.max.y);
  const t00 = top(x0, z0);
  const t10 = top(x1, z0);
  const t11 = top(x1, z1);
  const t01 = top(x0, z1);
  const mid = (a: V, c: V): V => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  const fy = FLOOR_Y[b.floor];
  const face = (a: V, bb: V, c: V, d: V, n: V, u: 0 | 1 | 2, v: 0 | 1 | 2) => {
    const mat = faceMat(b, n, mid(a, c));
    bld.quad(mat, a, bb, c, d, n, u, v);
    // A skirting board along the foot of every painted wall that reaches the floor; in the bathrooms, tiles to 1.2 m
    // with a trim on top.
    if (mat.startsWith('paint:') && n[1] === 0 && b.min.y <= fy + 0.01) {
      const m = mid(a, c);
      const room = roomAt({ x: m[0] + n[0] * 0.3, y: fy + 1.2, z: m[2] + n[2] * 0.3 });
      const bath = !!room?.id.startsWith('bath');
      // No skirting where there's no floor in front (a stair well's walls, a flight's sides).
      if (!room || room.id.startsWith('stairs')) return;
      const o = bath ? 0.01 : 0.016;
      const h = bath ? 1.2 : 0.11;
      const p = (q: V, y: number, out: number): V => [q[0] + n[0] * out, y, q[2] + n[2] * out];
      bld.quad(bath ? 'tile' : 'skirting', p(a, fy, o), p(bb, fy, o), p(bb, fy + h, o), p(a, fy + h, o), n, u, 1);
      bld.quad(bath ? 'trim' : 'skirting', p(a, fy + h, 0), p(bb, fy + h, 0), p(bb, fy + h, o + 0.012), p(a, fy + h, o + 0.012), [0, 1, 0], u, 1);
      if (bath) bld.quad('trim', p(a, fy + h - 0.03, o + 0.012), p(bb, fy + h - 0.03, o + 0.012), p(bb, fy + h, o + 0.012), p(a, fy + h, o + 0.012), n, u, 1);
    }
  };
  // Stairs: drawn as real treads and risers (the collision stays a smooth slope; feet are never more than half a
  // step off it).
  if (b.ramp && (b.mat === 'stair' || b.mat === 'porch')) {
    const ax = b.ramp.axis;
    const a0 = b.min[ax];
    const a1 = b.max[ax];
    const n = Math.max(2, Math.round((b.max.y - b.min.y) / 0.18));
    const h = (b.max.y - b.min.y) / n;
    const run = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const s0 = b.ramp.rise > 0 ? a0 + i * run : a1 - (i + 1) * run;
      const top = b.min.y + (i + 0.5) * h;
      const min = { ...b.min, [ax]: s0 };
      const max = { ...b.max, [ax]: s0 + run, y: Math.min(b.max.y, top) };
      const step: HBox = { ...b, min, max, ramp: undefined };
      STEPS.add(step);
      addBox(bld, step);
    }
    return;
  }
  // Top (flat or sloped).
  let tn: V = [0, 1, 0];
  if (b.ramp) {
    const run = b.max[b.ramp.axis] - b.min[b.ramp.axis];
    const k = (b.max.y - b.min.y) / run;
    const l = Math.hypot(k, 1);
    tn = b.ramp.axis === 'x' ? [(-b.ramp.rise * k) / l, 1 / l, 0] : [0, 1 / l, (-b.ramp.rise * k) / l];
  }
  // A wall's top flush with the floor above is never seen (and would flicker through the boards): skip it.
  const flush = (b.mat === 'wall' || b.mat === 'brick') && FLOOR_Y.some((f) => Math.abs(b.max.y - f) < 0.01);
  if (!flush) face([x0, t00, z0], [x1, t10, z0], [x1, t11, z1], [x0, t01, z1], tn, 0, 2);
  face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 0, 2);
  if (b.ramp) {
    face([x0, y0, z0], [x1, y0, z0], [x1, t10, z0], [x0, t00, z0], [0, 0, -1], 0, 1);
    face([x0, y0, z1], [x1, y0, z1], [x1, t11, z1], [x0, t01, z1], [0, 0, 1], 0, 1);
    face([x0, y0, z0], [x0, y0, z1], [x0, t01, z1], [x0, t00, z0], [-1, 0, 0], 2, 1);
    face([x1, y0, z0], [x1, y0, z1], [x1, t11, z1], [x1, t10, z0], [1, 0, 0], 2, 1);
    return;
  }
  // Long wall faces are cut where rooms meet, so each stretch takes its own room's paint, tiles and skirting.
  const y1 = b.max.y;
  for (const [s0, s1] of spans(b.floor, 'x', x0, x1)) {
    face([s0, y0, z0], [s1, y0, z0], [s1, y1, z0], [s0, y1, z0], [0, 0, -1], 0, 1);
    face([s0, y0, z1], [s1, y0, z1], [s1, y1, z1], [s0, y1, z1], [0, 0, 1], 0, 1);
  }
  for (const [s0, s1] of spans(b.floor, 'z', z0, z1)) {
    face([x0, y0, s0], [x0, y0, s1], [x0, y1, s1], [x0, y1, s0], [-1, 0, 0], 2, 1);
    face([x1, y0, s0], [x1, y0, s1], [x1, y1, s1], [x1, y1, s0], [1, 0, 0], 2, 1);
  }
}

/** A run from a0 to a1 along x or z, cut at every room edge on this floor that falls inside it. */
function spans(floor: number, axis: 'x' | 'z', a0: number, a1: number): [number, number][] {
  const cuts = new Set([a0, a1]);
  if (a1 - a0 > 0.3) for (const r of ROOMS) if (r.floor === floor) for (const v of [r.min[axis], r.max[axis]]) if (v > a0 + 0.05 && v < a1 - 0.05) cuts.add(v);
  const list = [...cuts].sort((p, q) => p - q);
  return list.slice(1).map((v, i) => [list[i], v]);
}

/** A railing at hand height (porch, balconies, stair wells): drawn as a capped rail on spindles, not a slab. */
const isBalustrade = (b: HBox) => (b.mat === 'rail' || b.mat === 'banister') && b.max.y - b.min.y > 0.7 && b.max.y - b.min.y < 1.3;

function addBalustrade(bld: Builder, b: HBox) {
  const longX = b.max.x - b.min.x >= b.max.z - b.min.z;
  const ax = longX ? 'x' : 'z';
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const at = (a0: number, a1: number, y0: number, y1: number, half: number): HBox => ({
    ...b,
    min: longX ? { x: a0, y: y0, z: cz - half } : { x: cx - half, y: y0, z: a0 },
    max: longX ? { x: a1, y: y1, z: cz + half } : { x: cx + half, y: y1, z: a1 },
  });
  const top = b.max.y;
  addBox(bld, at(b.min[ax], b.max[ax], top - 0.06, top, 0.05));
  addBox(bld, at(b.min[ax], b.max[ax], b.min.y + 0.06, b.min.y + 0.11, 0.03));
  const len = b.max[ax] - b.min[ax];
  const n = Math.max(1, Math.round(len / 0.13));
  for (let i = 0; i <= n; i++) {
    const a = b.min[ax] + (len * i) / n;
    addBox(bld, at(Math.max(b.min[ax], a - 0.018), Math.min(b.max[ax], a + 0.018), b.min.y + 0.11, top - 0.06, 0.018));
  }
}

interface DoorView {
  door: Door;
  pivot: THREE.Group;
  open: number;
  target: number;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly torch = new THREE.SpotLight(0xfff1d6, 0, 16, 0.42, 0.55, 1.4);
  private pool: THREE.PointLight[] = [];
  private lamps: { pos: Vec3; color: number; power: number; fire?: boolean }[];
  private flames: THREE.Mesh[] = [];
  private doorViews = new Map<string, DoorView>();
  private shut = new Set<string>(DOORS.map((d) => d.id));
  private disposables: { dispose(): void }[] = [];
  /** What walkers bump into: the house plus every shut door. */
  colliders: HBox[] = [];
  /** Party lights in the living room cycle red and purple. */
  private t = 0;
  private hemi = new THREE.HemisphereLight('#8f86c0', '#2a1a20', 0.9);
  private ambient = new THREE.AmbientLight('#ffffff', 0.25);
  /** The Ring doorbell's light (red while someone's watching the laptop). */
  private doorbell = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0x3355ff }));
  /** The mirror over the floor-2 bathroom sink: the one place you see yourself (people.ts draws you on layer 1). */
  readonly mirror = new Reflector(new THREE.PlaneGeometry(0.6, 0.8), { textureWidth: 384, textureHeight: 512, color: 0xb8c4cc });
  /** The house's bongs, on their tables (hidden while someone's holding one). */
  readonly bongs = new Map<string, BongModel>();
  /** The living-room TV's screen (dark in a power cut). */
  private tvScreen = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  /** The flood: water spreading over the floor-2 landing and bathroom. */
  readonly water = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4f8fd0, transparent: true, opacity: 0.55, depthWrite: false }),
  );

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color('#120e24');
    s.fog = new THREE.Fog('#120e24', 30, 80);
    s.add(this.hemi, this.ambient);
    const moon = new THREE.DirectionalLight('#9fb0ff', 0.5);
    moon.position.set(-20, 30, 25);
    s.add(moon);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffd9a0', 0, 9, 1.6);
      this.pool.push(l);
      s.add(l);
    }
    this.torch.position.set(0, 1.6, 0);
    s.add(this.torch, this.torch.target);
    // Indoor lamps are warm; two in the living room are the party lights.
    this.lamps = [
      ...LAMPS.map((p) => ({ pos: p, color: 0xffd39a, power: 5 })),
      { pos: { x: 4.6, y: 2.3, z: 10.6 }, color: 0xff3366, power: 6 },
      { pos: { x: 7.4, y: 2.3, z: 7.2 }, color: 0x9b4dff, power: 6 },
      ...OUT_LAMPS.map((p) => ({ pos: p, color: 0xffc070, power: 9 })),
      { pos: { x: FIREPIT.x, y: GROUND + 0.7, z: FIREPIT.z }, color: 0xff7a30, power: 7, fire: true },
    ];
    // Flames in the fire pit: a few additive tongues that flicker (update), never dark in a power cut.
    const flameGeo = new THREE.ConeGeometry(0.09, 0.42, 7).translate(0, 0.21, 0);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb030 : 0xff5a10, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const f = new THREE.Mesh(flameGeo, m);
      const a = (i / 6) * Math.PI * 2;
      f.position.set(FIREPIT.x + Math.cos(a) * 0.13, GROUND + 0.3, FIREPIT.z + Math.sin(a) * 0.13);
      this.flames.push(f);
      s.add(f);
      this.disposables.push(m);
    }
    this.disposables.push(flameGeo);

    const bld = new Builder();
    for (const b of BOXES) if (b.mat !== 'invisible' && !DRAWN.has(b.mat)) (isBalustrade(b) ? addBalustrade : addBox)(bld, b);
    this.addOutside(bld);
    // Kitchen lino, bathroom tile and the eaves' rough plywood, laid over the floorboards.
    for (const r of ROOMS) {
      if (r.outside || (r.surface !== 'lino' && r.surface !== 'tile' && r.surface !== 'ply')) continue;
      const y = FLOOR_Y[r.floor] + 0.004;
      bld.quad(r.surface, [r.min.x, y, r.min.z], [r.max.x, y, r.min.z], [r.max.x, y, r.max.z], [r.min.x, y, r.max.z], [0, 1, 0], 0, 2);
    }
    for (const m of bld.build()) {
      s.add(m);
      this.disposables.push(m.geometry);
    }
    this.addLampFixtures();
    this.doorbell.position.set(2.35, 1.3, DEPTH + 0.14);
    this.water.rotation.x = -Math.PI / 2;
    this.water.visible = false;
    s.add(this.doorbell, this.water);
    this.disposables.push(this.doorbell.geometry, this.doorbell.material as THREE.Material, this.water.geometry, this.water.material as THREE.Material);
    this.addDoors();
    this.addTree();
    this.addPrisms();
    const props = buildProps();
    s.add(props.group);
    for (const sp of SPOTS) {
      if (sp.vice !== 'bong') continue;
      const b = new BongModel();
      b.root.position.set(sp.pos.x, sp.pos.y - 0.04, sp.pos.z);
      s.add(b.root);
      this.bongs.set(sp.id, b);
    }
    this.disposables.push(...props.owned);
    // The bathroom mirror (it only renders while you're close enough to see it).
    this.mirror.position.set(WIDTH - 0.135, FLOOR_Y[1] + 1.55, 10.75);
    this.mirror.rotation.y = -Math.PI / 2;
    this.mirror.visible = false;
    s.add(this.mirror);
    this.disposables.push(this.mirror.geometry, this.mirror);
    this.rebuildColliders();
  }

  private addOutside(bld: Builder) {
    // The street: the pavement, the kerb, the road with its centre line, a streetlight, a parked car, and the houses
    // across the road (a few windows still lit).
    const g = GROUND;
    const solid = (mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      addBox(bld, { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind: 'cover', mat: mat as HBox['mat'], floor: 0 });
    bld.quad('path', [-14, g + 0.012, 28.3], [24, g + 0.012, 28.3], [24, g + 0.012, 30.3], [-14, g + 0.012, 30.3], [0, 1, 0], 0, 2);
    solid('kerb', -14, g - 0.1, 30.25, 24, g + 0.1, 30.45);
    bld.quad('asphalt', [-14, g - 0.09, 30.45], [24, g - 0.09, 30.45], [24, g - 0.09, 44], [-14, g - 0.09, 44], [0, 1, 0], 0, 2);
    for (let x = -13; x < 24; x += 3) bld.quad('roadLine', [x, g - 0.085, 37.1], [x + 1.5, g - 0.085, 37.1], [x + 1.5, g - 0.085, 37.3], [x, g - 0.085, 37.3], [0, 1, 0], 0, 2);
    solid('kerb', -14, g - 0.1, 43.8, 24, g + 0.1, 44);
    bld.quad('path', [-14, g + 0.012, 44], [24, g + 0.012, 44], [24, g + 0.012, 46], [-14, g + 0.012, 46], [0, 1, 0], 0, 2);
    // The streetlight (its lamp is one of OUT_LAMPS).
    solid('pole', WIDTH + 1.74, g, 29.34, WIDTH + 1.86, 4.7, 29.46);
    solid('pole', WIDTH + 1.4, 4.6, 29.34, WIDTH + 1.86, 4.7, 29.46);
    solid('lamp', WIDTH + 1.3, 4.45, 29.28, WIDTH + 1.6, 4.6, 29.52);
    // A parked car, a little dented.
    solid('tyre', 2.9, g - 0.09, 31.1, 3.5, g + 0.5, 31.3);
    solid('tyre', 6.3, g - 0.09, 31.1, 6.9, g + 0.5, 31.3);
    solid('tyre', 2.9, g - 0.09, 32.9, 3.5, g + 0.5, 33.1);
    solid('tyre', 6.3, g - 0.09, 32.9, 6.9, g + 0.5, 33.1);
    solid('car', 2.5, g + 0.25, 31.2, 7.3, g + 1.05, 33);
    solid('car', 3.6, g + 1.05, 31.35, 6.2, g + 1.65, 32.85);
    bld.quad('darkWindow', [3.7, g + 1.1, 31.33], [6.1, g + 1.1, 31.33], [6.1, g + 1.6, 31.33], [3.7, g + 1.6, 31.33], [0, 0, -1], 0, 1);
    // The houses across the road: brick fronts, peaked roofs, windows (some lit).
    let k = 0;
    for (const [x0, x1, hgt] of [[-13, -4, 8], [-2.5, 7, 9.5], [8.5, 16, 7.5], [17.5, 26, 9]] as [number, number, number][]) {
      solid('neighbour', x0, g, 47, x1, g + hgt, 58);
      const mid = (x0 + x1) / 2;
      bld.quad('neighbourRoof', [x0 - 0.3, g + hgt, 46.7], [x1 + 0.3, g + hgt, 46.7], [mid + 0.3, g + hgt + 2.6, 52.5], [mid - 0.3, g + hgt + 2.6, 52.5], [0, 0.9, -0.4], 0, 2);
      for (const y of [g + 1, g + 4])
        for (let x = x0 + 1.2; x < x1 - 1.4; x += 2.4) {
          const m = Math.abs(Math.sin(k++ * 7.31) * 43758.5) % 1 > 0.55 ? 'window' : 'darkWindow';
          bld.quad(m, [x, y, 46.98], [x + 1.1, y, 46.98], [x + 1.1, y + 1.4, 46.98], [x, y + 1.4, 46.98], [0, 0, -1], 0, 1);
        }
      // A front door each.
      bld.quad('fence', [mid - 0.5, g, 46.98], [mid + 0.5, g, 46.98], [mid + 0.5, g + 2.1, 46.98], [mid - 0.5, g + 2.1, 46.98], [0, 0, -1], 0, 1);
    }
    // Over the back fence, the backs of the next street's houses: a lit kitchen or two, everyone else asleep.
    for (const [x0, x1, hgt] of [[-12, -3, 7.5], [-1.5, 9, 9], [10.5, 19, 8]] as [number, number, number][]) {
      solid('neighbour', x0, g, -26, x1, g + hgt, -15);
      const mid = (x0 + x1) / 2;
      bld.quad('neighbourRoof', [x1 + 0.3, g + hgt, -14.7], [x0 - 0.3, g + hgt, -14.7], [mid - 0.3, g + hgt + 2.6, -20.5], [mid + 0.3, g + hgt + 2.6, -20.5], [0, 0.9, 0.4], 0, 2);
      for (const y of [g + 1, g + 4])
        for (let x = x0 + 1.2; x < x1 - 1.4; x += 2.4) {
          const m = Math.abs(Math.sin(k++ * 7.31) * 43758.5) % 1 > 0.7 ? 'window' : 'darkWindow';
          bld.quad(m, [x + 1.1, y, -14.98], [x, y, -14.98], [x, y + 1.4, -14.98], [x + 1.1, y + 1.4, -14.98], [0, 0, 1], 0, 1);
        }
    }
    // The gable roof: two shingled slopes along the house, the green gable faces front and back.
    const eave = FLOOR_Y[2] + 2.6;
    const ridge = eave + 3.4;
    const cx = WIDTH / 2;
    const zf = DEPTH + 0.5;
    const zb = -0.5;
    bld.quad('shingle', [-0.5, eave, zb], [cx, ridge, zb], [cx, ridge, zf], [-0.5, eave, zf], [-0.6, 0.8, 0], 2, 1);
    bld.quad('shingle', [WIDTH + 0.5, eave, zb], [cx, ridge, zb], [cx, ridge, zf], [WIDTH + 0.5, eave, zf], [0.6, 0.8, 0], 2, 1);
    for (const [z, n] of [
      [DEPTH + 0.13, 1],
      [-0.13, -1],
    ] as const) {
      const p = new THREE.BufferGeometry();
      const y0 = eave - 0.4;
      p.setAttribute('position', new THREE.Float32BufferAttribute([-0.12, y0, z, WIDTH + 0.12, y0, z, cx, ridge, z], 3));
      p.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, n, 0, 0, n, 0, 0, n], 3));
      p.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 6, 0, 3, 2.5], 2));
      const tri = new THREE.Mesh(p, material('shingle'));
      (tri.material as THREE.Material).side = THREE.DoubleSide;
      this.scene.add(tri);
      this.disposables.push(p);
    }
    // The little attic window in the front gable, lit.
    bld.quad('window', [cx - 0.4, eave + 0.6, DEPTH + 0.15], [cx + 0.4, eave + 0.6, DEPTH + 0.15], [cx + 0.4, eave + 1.5, DEPTH + 0.15], [cx - 0.4, eave + 1.5, DEPTH + 0.15], [0, 0, 1], 0, 1);
    // Lit windows on next door's facing walls, and a roof on each.
    for (const [x, n] of [
      [-1.21, -1],
      [WIDTH + 1.19, 1],
    ] as const)
      for (const [z, y] of [
        [3, 1],
        [12, 4],
        [17, 1.2],
      ])
        bld.quad('window', [x, y, z], [x, y, z + 1], [x, y + 1.2, z + 1], [x, y + 1.2, z], [n === -1 ? 1 : -1, 0, 0], 2, 1);
    // The stone foundation round the house, white eave boards under the roof.
    const base = GROUND;
    const top = 0.25;
    const o = 0.13;
    bld.quad('stone', [-o, base, DEPTH + o], [WIDTH + o, base, DEPTH + o], [WIDTH + o, top, DEPTH + o], [-o, top, DEPTH + o], [0, 0, 1], 0, 1);
    bld.quad('stone', [-o, base, -o], [WIDTH + o, base, -o], [WIDTH + o, top, -o], [-o, top, -o], [0, 0, -1], 0, 1);
    bld.quad('stone', [-o, base, -o], [-o, base, DEPTH + o], [-o, top, DEPTH + o], [-o, top, -o], [-1, 0, 0], 2, 1);
    bld.quad('stone', [WIDTH + o, base, -o], [WIDTH + o, base, DEPTH + o], [WIDTH + o, top, DEPTH + o], [WIDTH + o, top, -o], [1, 0, 0], 2, 1);
    for (const z of [zf + 0.01, zb - 0.01]) {
      const n: V = [0, 0, z > 10 ? 1 : -1];
      bld.quad('trim', [-0.5, eave - 0.18, z], [cx, ridge - 0.12, z], [cx, ridge + 0.05, z], [-0.5, eave, z], n, 0, 1);
      bld.quad('trim', [WIDTH + 0.5, eave - 0.18, z], [cx, ridge - 0.12, z], [cx, ridge + 0.05, z], [WIDTH + 0.5, eave, z], n, 0, 1);
    }
    // Next door's houses get gable roofs too.
    for (const [x0, x1] of [
      [-9, -1.2],
      [WIDTH + 1.2, WIDTH + 9],
    ]) {
      const mid = (x0 + x1) / 2;
      // Their windows: on the street front and on the side facing us; some rooms are lit, some asleep.
      const r = (i: number) => (Math.sin(i * 12.9898 + x0) * 43758.5453) % 1;
      let k = 0;
      for (const y of [0.4, 3.3, 6.1])
        for (const x of [x0 + 1.6, mid, x1 - 1.6]) {
          const m = Math.abs(r(k++)) > 0.45 ? 'window' : 'darkWindow';
          bld.quad(m, [x - 0.5, y, 22.02], [x + 0.5, y, 22.02], [x + 0.5, y + 1.3, 22.02], [x - 0.5, y + 1.3, 22.02], [0, 0, 1], 0, 1);
        }
      const side = x0 < 0 ? x1 + 0.02 : x0 - 0.02;
      const n: V = [x0 < 0 ? 1 : -1, 0, 0];
      for (const y of [0.4, 3.3, 6.1])
        for (const z of [1.5, 6, 11, 16.5]) {
          const m = Math.abs(r(k++)) > 0.6 ? 'window' : 'darkWindow';
          bld.quad(m, [side, y, z - 0.45], [side, y, z + 0.45], [side, y + 1.2, z + 0.45], [side, y + 1.2, z - 0.45], n, 2, 1);
        }
      bld.quad('neighbourRoof', [x0 - 0.3, 9, -2.3], [mid, 12, -2.3], [mid, 12, 22.3], [x0 - 0.3, 9, 22.3], [-0.6, 0.8, 0], 2, 1);
      bld.quad('neighbourRoof', [x1 + 0.3, 9, -2.3], [mid, 12, -2.3], [mid, 12, 22.3], [x1 + 0.3, 9, 22.3], [0.6, 0.8, 0], 2, 1);
    }
    // Power lines across the front.
    for (const y of [7.2, 7.5])
      bld.quad('wire', [-14, y, 29], [24, y, 29], [24, y + 0.03, 29], [-14, y + 0.03, 29], [0, 0, 1], 0, 1);
  }

  /** The triangle wall: cream sides, a faux-brick face with the TV on it (and the PA speaker above). */
  private addPrisms() {
    for (const p of PRISMS) {
      const bld = new Builder();
      const y0 = FLOOR_Y[p.floor];
      const y1 = y0 + p.h;
      const n = p.pts.length;
      const cx = p.pts.reduce((a, q) => a + q[0], 0) / n;
      const cz = p.pts.reduce((a, q) => a + q[1], 0) / n;
      for (let k = 0; k < n; k++) {
        const [ax, az] = p.pts[k];
        const [bx, bz] = p.pts[(k + 1) % n];
        // Outward normal: perpendicular to the edge, away from the middle.
        let nx = bz - az;
        let nz = -(bx - ax);
        const l = Math.hypot(nx, nz);
        nx /= l;
        nz /= l;
        if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) {
          nx = -nx;
          nz = -nz;
        }
        const tvFace = p.tv && k === 1;
        bld.quad(`paint:${CREAM}`, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], Math.abs(nx) > Math.abs(nz) ? 2 : 0, 1);
        if (tvFace) {
          // The TV and the PA speaker, a hair proud of the bricks.
          const at = (t: number, up: number, out: number): V => [ax + (bx - ax) * t + nx * out, y0 + up, az + (bz - az) * t + nz * out];
          this.addTv(at(0.5, 1.4, 0), Math.atan2(nx, nz));
          bld.quad('records', at(0.44, 2, 0.05), at(0.56, 2, 0.05), at(0.56, 2.45, 0.05), at(0.44, 2.45, 0.05), [nx, 0, nz], 0, 1);
        }
      }
      for (const m of bld.build()) {
        this.scene.add(m);
        this.disposables.push(m.geometry);
      }
    }
  }

  /**
   * The TV, wall-mounted on the triangle's long face: a thin black panel with a bezel and a glowing screen (a paused
   * game: someone rage-quit mid-match), a soundbar under it, and a low media unit on the floor with the console.
   */
  private addTv(c: V, yaw: number) {
    const g = new THREE.Group();
    g.position.set(c[0], c[1], c[2]);
    g.rotation.y = yaw;
    const black = new THREE.MeshToonMaterial({ color: '#0d0d10', gradientMap: ramp() });
    const grey = new THREE.MeshToonMaterial({ color: '#2a2a30', gradientMap: ramp() });
    const white = new THREE.MeshToonMaterial({ color: '#e8e8ec', gradientMap: ramp() });
    const wood = new THREE.MeshToonMaterial({ color: '#4a3424', gradientMap: ramp() });
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      this.disposables.push(geo);
      return mesh;
    };
    part(new THREE.BoxGeometry(1.42, 0.82, 0.05), black, 0, 0, 0.045);
    part(new THREE.BoxGeometry(0.5, 0.3, 0.02), grey, 0, 0, 0.01);
    this.tvScreen.map = tvPicture();
    part(new THREE.PlaneGeometry(1.34, 0.75), this.tvScreen, 0, 0.01, 0.072);
    part(new THREE.BoxGeometry(0.012, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), 0.6, -0.39, 0.072);
    // Soundbar, then the media unit on the floor (its top at 0.45 m), the console and a controller on it.
    part(new THREE.BoxGeometry(0.9, 0.07, 0.08), grey, 0, -0.5, 0.06);
    part(new THREE.BoxGeometry(1.5, 0.42, 0.3), wood, 0, -1.19, 0.16);
    part(new THREE.BoxGeometry(1.44, 0.015, 0.005), black, 0, -1.19, 0.312);
    part(new THREE.BoxGeometry(0.34, 0.07, 0.24), white, -0.42, -0.94, 0.16);
    part(new THREE.BoxGeometry(0.16, 0.035, 0.1), black, 0.35, -0.96, 0.18).rotation.y = 0.4;
    this.disposables.push(black, grey, white, wood, this.tvScreen, this.tvScreen.map);
    this.scene.add(g);
  }

  private addLampFixtures() {
    const g = new THREE.SphereGeometry(0.12, 12, 8);
    const list = this.lamps.filter((l) => !l.fire).map((l) => {
      const m = new THREE.Matrix4().makeTranslation(l.pos.x, l.pos.y + 0.12, l.pos.z);
      return g.clone().applyMatrix4(m);
    });
    const merged = mergeGeometries(list);
    g.dispose();
    list.forEach((x) => x.dispose());
    this.scene.add(new THREE.Mesh(merged, material('lamp')));
    this.disposables.push(merged);
  }

  private addTree() {
    // A huge bare tree out front: a trunk and a few crooked limbs.
    const bark = material('bark');
    const parts: THREE.BufferGeometry[] = [];
    const limb = (x: number, y: number, z: number, len: number, rx: number, rz: number, r: number) => {
      const c = new THREE.CylinderGeometry(r * 0.6, r, len, 7);
      c.translate(0, len / 2, 0);
      c.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
      c.translate(x, y, z);
      parts.push(c);
    };
    const tx = TREE.x;
    const tz = TREE.z;
    limb(tx, GROUND, tz, 6.5, 0, 0, 0.4);
    const r = (i: number) => Math.sin(i * 12.9898) * 0.5 + 0.5;
    for (let i = 0; i < 9; i++) {
      const y = GROUND + 3 + r(i) * 3;
      limb(tx, y, tz, 2.5 + r(i + 3) * 2.5, (r(i + 1) - 0.5) * 1.6, (r(i + 2) - 0.5) * 1.8, 0.16);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    this.scene.add(new THREE.Mesh(merged, bark));
    this.disposables.push(merged);
  }

  private addDoors() {
    const leafGeo = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(leafGeo);
    for (const d of DOORS) {
      const pivot = new THREE.Group();
      const half = d.w / 2;
      // Hinge at the low end of the gap; the leaf extends along the wall from it.
      if (d.axis === 'x') pivot.position.set(d.x - half, FLOOR_Y[d.floor], d.z);
      else pivot.position.set(d.x, FLOOR_Y[d.floor], d.z - half);
      const leaf = new THREE.Mesh(leafGeo, material(d.hatch ? 'hatch' : 'door'));
      const h = d.hatch ? 1.75 : DOOR_H;
      if (d.axis === 'x') {
        leaf.scale.set(d.w - 0.02, h, 0.045);
        leaf.position.set(half, h / 2, 0);
      } else {
        leaf.scale.set(0.045, h, d.w - 0.02);
        leaf.position.set(0, h / 2, half);
      }
      pivot.add(leaf);
      // Four raised panels on each face of the white panel doors, and a brass knob both sides.
      const along = (a: number, y: number, out: number, sa: number, sy: number, so: number, m: THREE.Mesh) => {
        if (d.axis === 'x') {
          m.position.set(a, y, out);
          m.scale.set(sa, sy, so);
        } else {
          m.position.set(out, y, a);
          m.scale.set(so, sy, sa);
        }
        pivot.add(m);
      };
      if (!d.hatch)
        for (const side of [-1, 1])
          for (const col of [-1, 1])
            for (const [y, hgt] of [[0.62, 0.78], [1.5, 0.78]])
              along(half + col * d.w * 0.21, y, side * 0.027, d.w * 0.3, hgt, 0.012, new THREE.Mesh(leafGeo, material('doorPanel')));
      const knobGeo = new THREE.SphereGeometry(0.035, 10, 8);
      this.disposables.push(knobGeo);
      for (const side of [-1, 1]) along(d.w - 0.12, 1, side * 0.055, 1, 1, 1, new THREE.Mesh(knobGeo, material('brass')));
      this.scene.add(pivot);
      this.doorViews.set(d.id, { door: d, pivot, open: 0, target: 0 });
    }
  }

  /** Doors from the referee: these ids are open, the rest shut. Returns the doors that changed. */
  setDoors(open: Iterable<string>): Door[] {
    const o = new Set(open);
    const changed: Door[] = [];
    for (const v of this.doorViews.values()) {
      const target = o.has(v.door.id) ? 1 : 0;
      if (target !== v.target) changed.push(v.door);
      v.target = target;
      if (target) this.shut.delete(v.door.id);
      else this.shut.add(v.door.id);
    }
    this.rebuildColliders();
    return changed;
  }

  isOpen = (id: string) => !this.shut.has(id);

  private rebuildColliders() {
    this.colliders = [...SOLIDS, ...DOORS.filter((d) => this.shut.has(d.id)).map(doorBox)];
  }

  /** Swings doors, flickers the party lights and moves the light pool to the lamps nearest `eye`. */
  /** A power cut: the house lights go, and the night gets darker (the moon still shines). */
  setPower(on: boolean) {
    this.hemi.intensity = on ? 0.9 : 0.18;
    this.ambient.intensity = on ? 0.25 : 0.02;
    (material('lamp') as THREE.MeshToonMaterial).emissive.set(on ? (LOOKS.lamp.glow as string) : '#000000');
    this.tvScreen.color.set(on ? 0xffffff : 0x050507);
  }

  setDoorbell(watched: boolean) {
    (this.doorbell.material as THREE.MeshBasicMaterial).color.setHex(watched ? 0xff2020 : 0x3355ff);
  }

  /** The flood's water: 0 (none) to 1 (everywhere it'll go). */
  setFlood(k: number) {
    this.water.visible = k > 0;
    const w = 2 + 5 * k;
    this.water.scale.set(w, 3 + 6 * k, 1);
    this.water.position.set(8.4 - w / 2, FLOOR_Y[1] + 0.02 + k * 0.06, 11);
  }

  update(dt: number, eye: Vec3, power = true) {
    this.t += dt;
    this.mirror.visible = floorOf(eye.y - 1) === 1 && Math.hypot(eye.x - this.mirror.position.x, eye.z - this.mirror.position.z) < 3.2 && eye.x > 6.6;
    for (const v of this.doorViews.values()) {
      v.open += Math.sign(v.target - v.open) * Math.min(Math.abs(v.target - v.open), dt * 4);
      v.pivot.rotation.y = (v.door.axis === 'x' ? 1 : -1) * v.open * (Math.PI / 2) * 0.95;
    }
    const near = this.lamps
      .map((l, i) => ({ l, i, d: (l.pos.x - eye.x) ** 2 + ((l.pos.y - eye.y) * 2.2) ** 2 + (l.pos.z - eye.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pool.length);
    near.forEach(({ l, i }, k) => {
      const light = this.pool[k];
      light.position.set(l.pos.x, l.pos.y, l.pos.z);
      const party = PARTY.has(i - LAMPS.length);
      light.color.setHex(party ? (Math.sin(this.t * 1.7 + i) > 0 ? 0xff3366 : 0x9b4dff) : l.color);
      light.intensity = l.fire ? l.power * (0.75 + 0.25 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3)) : power ? l.power : 0;
    });
    this.flames.forEach((f, i) => {
      const k = Math.sin(this.t * (9 + i) + i * 2.1) * 0.5 + 0.5;
      f.scale.set(0.8 + 0.3 * k, 0.6 + 0.8 * k * (0.7 + 0.3 * Math.sin(this.t * 3 + i)), 0.8 + 0.3 * k);
      f.rotation.set(Math.sin(this.t * 5 + i) * 0.15, 0, Math.cos(this.t * 4 + i) * 0.15);
    });
  }

  dispose() {
    for (const b of this.bongs.values()) b.dispose();
    for (const d of this.disposables) d?.dispose();
    for (const m of mats.values()) m.dispose();
    mats.clear();
    disposeTextures();
  }
}

/** The TV's picture: a football game paused mid-match, the scoreline that caused it, and the dreaded pop-up. */
function tvPicture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 288);
  sky.addColorStop(0, '#2b4a7a');
  sky.addColorStop(0.35, '#3c8a4a');
  sky.addColorStop(1, '#2f7a3c');
  x.fillStyle = sky;
  x.fillRect(0, 0, 512, 288);
  // Mown stripes and the pitch lines in perspective.
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    x.beginPath();
    x.moveTo(140 + i * 29, 100);
    x.lineTo(169 + i * 29, 100);
    x.lineTo(i * 70 - 20 + 70, 288);
    x.lineTo(i * 70 - 20, 288);
    x.fill();
  }
  x.strokeStyle = 'rgba(255,255,255,0.7)';
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(110, 100);
  x.lineTo(402, 100);
  x.lineTo(500, 288);
  x.moveTo(110, 100);
  x.lineTo(12, 288);
  x.moveTo(256, 100);
  x.lineTo(256, 288);
  x.stroke();
  x.beginPath();
  x.ellipse(256, 190, 70, 26, 0, 0, Math.PI * 2);
  x.stroke();
  // The crowd stand along the top.
  x.fillStyle = '#1c2438';
  x.fillRect(0, 60, 512, 40);
  for (let i = 0; i < 140; i++) {
    x.fillStyle = ['#c84a4a', '#e8e0d0', '#4a6ac8', '#e8c84a'][i % 4];
    x.fillRect((i * 37) % 512, 64 + ((i * 13) % 30), 3, 3);
  }
  // The score bug, the pause card.
  x.fillStyle = 'rgba(10,10,20,0.85)';
  x.fillRect(16, 14, 210, 30);
  x.fillStyle = '#fff';
  x.font = 'bold 18px system-ui, sans-serif';
  x.fillText('NASH  0 - 7  JUNG', 26, 36);
  x.fillStyle = '#e8c84a';
  x.fillText('88:12', 232, 36);
  x.fillStyle = 'rgba(8,8,16,0.82)';
  x.fillRect(136, 112, 240, 108);
  x.strokeStyle = '#e8c84a';
  x.strokeRect(136, 112, 240, 108);
  x.fillStyle = '#fff';
  x.font = 'bold 30px system-ui, sans-serif';
  x.textAlign = 'center';
  x.fillText('PAUSED', 256, 150);
  x.font = '15px system-ui, sans-serif';
  x.fillStyle = '#ffb0b0';
  x.fillText('Controller 1 disconnected', 256, 178);
  x.fillStyle = '#c8c8d0';
  x.fillText('(it went through the window)', 256, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
