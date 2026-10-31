// three.js for the house: the static boxes merged per material (UVs in metres so textures tile at real size),
// per-room wall paint, the doors (leaves that swing), lamps, the roof and the street outside. Lighting never adds
// or removes a light mid-night (that recompiles every shader): a fixed pool of four point lights follows the lamps
// nearest you, and the phone torch is a spotlight that's always there and just changes intensity.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rampHeightAt } from '../../shared/collision.ts';
import {
  BOXES,
  DEPTH,
  DOORS,
  DOOR_H,
  FLOOR_Y,
  GROUND,
  LAMPS,
  SOLIDS,
  PRISMS,
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
  stone: { color: '#8d877c' },
  brick: { color: '#ffffff', tex: 'brick' },
  feature: { color: '#d8b8b0', tex: 'brick' },
  trim: { color: '#f4f0e6' },
  rail: { color: '#efe9dc' },
  glass: { color: '#4a5a8a', glow: '#1a2244', clear: true },
  ceiling: { color: '#f2ede2' },
  fence: { color: '#6b5440' },
  neighbour: { color: '#6d4a3e', tex: 'brick' },
  neighbourRoof: { color: '#3a3a42' },
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
  hatch: { color: '#9a7a52' },
  lamp: { color: '#ffe2a8', glow: '#ffcf7a' },
  window: { color: '#ffd38a', glow: '#ff9f40' },
  asphalt: { color: '#2a2a30' },
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
  { x: 2, y: 2.1, z: -0.7 },
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
    light += (0.75 * (0.35 + 0.65 * facing)) / (1 + d2 / 5);
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
    const m = look?.tex ? texture(look.tex)!.metres : 1;
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
  if (key.startsWith('paint:')) m = new THREE.MeshToonMaterial({ color: key.slice(6), gradientMap: ramp(), vertexColors: baked });
  else {
    const l = LOOKS[key] ?? { color: '#ff00ff' };
    const t = l.tex ? texture(l.tex)!.tex : null;
    m = new THREE.MeshToonMaterial({
      color: l.color,
      map: t,
      gradientMap: ramp(),
      emissive: l.glow ?? '#000000',
      transparent: !!l.clear,
      opacity: l.clear ? 0.45 : 1,
      side: l.clear ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: baked,
    });
  }
  mats.set(baked ? `b:${key}` : key, m);
  return m;
}

/** Which material a box's face gets (paint follows the room the face looks into). */
function faceMat(b: HBox, n: V, c: V): string {
  const floors = new Set(['wood', 'tile', 'lino', 'grass', 'porch', 'path']);
  if (floors.has(b.mat)) {
    if (n[1] > 0.5) return b.mat;
    if (b.mat === 'grass' || b.floor === 0) return b.mat === 'grass' ? 'grass' : 'stone';
    return 'ceiling';
  }
  if (b.ramp) return n[1] > 0.3 ? b.mat : 'trim';
  if (b.mat === 'wall' || b.mat === 'brick') {
    if (n[1] !== 0) return 'trim';
    const probe = { x: c[0] + n[0] * 0.3, y: c[1], z: c[2] + n[2] * 0.3 };
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
  const face = (a: V, bb: V, c: V, d: V, n: V, u: 0 | 1 | 2, v: 0 | 1 | 2) => bld.quad(faceMat(b, n, mid(a, c)), a, bb, c, d, n, u, v);
  // Top (flat or sloped).
  let tn: V = [0, 1, 0];
  if (b.ramp) {
    const run = b.max[b.ramp.axis] - b.min[b.ramp.axis];
    const k = (b.max.y - b.min.y) / run;
    const l = Math.hypot(k, 1);
    tn = b.ramp.axis === 'x' ? [(-b.ramp.rise * k) / l, 1 / l, 0] : [0, 1 / l, (-b.ramp.rise * k) / l];
  }
  face([x0, t00, z0], [x1, t10, z0], [x1, t11, z1], [x0, t01, z1], tn, 0, 2);
  face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 0, 2);
  face([x0, y0, z0], [x1, y0, z0], [x1, t10, z0], [x0, t00, z0], [0, 0, -1], 0, 1);
  face([x0, y0, z1], [x1, y0, z1], [x1, t11, z1], [x0, t01, z1], [0, 0, 1], 0, 1);
  face([x0, y0, z0], [x0, y0, z1], [x0, t01, z1], [x0, t00, z0], [-1, 0, 0], 2, 1);
  face([x1, y0, z0], [x1, y0, z1], [x1, t11, z1], [x1, t10, z0], [1, 0, 0], 2, 1);
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
  private lamps: { pos: Vec3; color: number; power: number }[];
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
    ];

    const bld = new Builder();
    for (const b of BOXES) if (b.mat !== 'invisible' && !DRAWN.has(b.mat)) addBox(bld, b);
    this.addOutside(bld);
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
    this.mirror.position.set(WIDTH - 0.135, FLOOR_Y[1] + 1.55, 10.25);
    this.mirror.rotation.y = -Math.PI / 2;
    this.mirror.visible = false;
    s.add(this.mirror);
    this.disposables.push(this.mirror.geometry, this.mirror);
    this.rebuildColliders();
  }

  private addOutside(bld: Builder) {
    // The street and the sidewalk.
    bld.quad('asphalt', [-14, GROUND + 0.01, 30.3], [24, GROUND + 0.01, 30.3], [24, GROUND + 0.01, 44], [-14, GROUND + 0.01, 44], [0, 1, 0], 0, 2);
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
    const list = this.lamps.map((l) => {
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
      // A knob, so it reads as a door.
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), material('records'));
      if (d.axis === 'x') knob.position.set(d.w - 0.12, 1, 0.05);
      else knob.position.set(0.05, 1, d.w - 0.12);
      this.disposables.push(knob.geometry);
      pivot.add(knob);
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
      light.intensity = power ? l.power : 0;
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
