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
  WIDTH,
  doorBox,
  roomAt,
  type Door,
  type HBox,
} from './house.ts';
import { ramp } from './people.ts';
import { disposeTextures, texture } from './textures.ts';
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
  { x: 11.4, y: 4.6, z: 29.4 },
];
const PARTY = new Set([0, 1]);

type V = [number, number, number];

/** Collects quads per material, with UVs in metres. */
class Builder {
  private parts = new Map<string, { pos: number[]; uv: number[]; nrm: number[] }>();

  quad(mat: string, a: V, b: V, c: V, d: V, n: V, uAxis: 0 | 1 | 2, vAxis: 0 | 1 | 2) {
    // Wind so the face's normal points out (n).
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const pts = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    let p = this.parts.get(mat);
    if (!p) this.parts.set(mat, (p = { pos: [], uv: [], nrm: [] }));
    const look = LOOKS[mat];
    const m = look?.tex ? texture(look.tex)!.metres : 1;
    for (const v of pts) {
      p.pos.push(v[0], v[1], v[2]);
      p.uv.push(v[uAxis] / m, v[vAxis] / m);
      p.nrm.push(n[0], n[1], n[2]);
    }
  }

  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, p] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      out.push(new THREE.Mesh(g, material(key)));
    }
    return out;
  }
}

const mats = new Map<string, THREE.Material>();
function material(key: string): THREE.Material {
  let m = mats.get(key);
  if (m) return m;
  if (key.startsWith('paint:')) m = new THREE.MeshToonMaterial({ color: key.slice(6), gradientMap: ramp() });
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
    });
  }
  mats.set(key, m);
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
    if (r?.id === 'living' && n[2] > 0 && Math.abs(b.min.z - 5.34) < 0.05) return 'feature';
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

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color('#120e24');
    s.fog = new THREE.Fog('#120e24', 30, 80);
    s.add(new THREE.HemisphereLight('#8f86c0', '#2a1a20', 0.9));
    s.add(new THREE.AmbientLight('#ffffff', 0.25));
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
      { pos: { x: 5, y: 2.3, z: 7 }, color: 0xff3366, power: 6 },
      { pos: { x: 8.4, y: 2.3, z: 11 }, color: 0x9b4dff, power: 6 },
      ...OUT_LAMPS.map((p) => ({ pos: p, color: 0xffc070, power: 9 })),
    ];

    const bld = new Builder();
    for (const b of BOXES) if (b.mat !== 'invisible') addBox(bld, b);
    this.addOutside(bld);
    for (const m of bld.build()) {
      s.add(m);
      this.disposables.push(m.geometry);
    }
    this.addLampFixtures();
    this.addDoors();
    this.addTree();
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
      [10.79, 1],
    ] as const)
      for (const [z, y] of [
        [3, 1],
        [12, 4],
        [17, 1.2],
      ])
        bld.quad('window', [x, y, z], [x, y, z + 1], [x, y + 1.2, z + 1], [x, y + 1.2, z], [n === -1 ? 1 : -1, 0, 0], 2, 1);
    // Power lines across the front.
    for (const y of [7.2, 7.5])
      bld.quad('wire', [-14, y, 29], [24, y, 29], [24, y + 0.03, 29], [-14, y + 0.03, 29], [0, 0, 1], 0, 1);
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
    const tx = 7.55;
    const tz = 24.55;
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
  update(dt: number, eye: Vec3, power = true) {
    this.t += dt;
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
    for (const d of this.disposables) d.dispose();
    for (const m of mats.values()) m.dispose();
    mats.clear();
    disposeTextures();
  }
}
