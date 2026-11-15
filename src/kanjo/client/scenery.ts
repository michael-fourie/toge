// What stands outside the barriers besides the forest (trackview.ts calls it): farmhouses and barns in the clearings,
// telegraph poles and their wires along the passes, wayside shrines (torii, stone lanterns), road signs, and a landmark
// or two per theme (a pagoda on the hill, a lighthouse and boats by the sea, a windmill and water tower in the desert,
// a radio mast up the mountain); round the circuits the pits and race control, grandstands, trackside boards and a big
// wheel by the harbour. The Postcard Cup's circuits are lined with their own towns instead (towns.ts).
//
// Cheap by construction: every prop is baked into merged meshes per 1.6 km chunk, one per material (vertex
// colours with glowing windows, and a sign atlas), so the whole lot is a handful of draw calls; the wires are one line mesh. Placement
// runs on its own random stream, so the forest, rocks and villages stay exactly where they were.

import * as THREE from 'three';
import { SAMPLE, type Track, heightAt, locate, newLoc, onCut, pointAt, roadDistance } from '../shared/track.ts';
import { TOWNS } from './towns.ts';
import { mulberry } from './tracktextures.ts';
import { merge, shade, tint } from './trees.ts';

type Keep = <T extends { dispose(): void }>(x: T) => T;
type Kind = 'body' | 'glow' | 'sign';
const railOf = (t: Track, i: number, side: number) => t.rail + (side < 0 ? t.runL[i] : t.runR[i]);

/** A ground footprint the forest keeps clear of (x, z, radius). */
export interface Site {
  x: number;
  z: number;
  r: number;
}

/**
 * Collects transformed copies of template geometries into merged meshes per material and 1.6 km chunk. Glowing parts
 * (windows, lantern fireboxes, beacons) go in with the solid ones, marked by a `glow` attribute the material reads.
 */
class Batch {
  private chunks = new Map<string, { sign: boolean; pos: number[]; nor: number[]; col: number[]; uv: number[]; glow: number[] }>();
  private nm = new THREE.Matrix3();
  private v = new THREE.Vector3();

  add(kind: Kind, geo: THREE.BufferGeometry, m: THREE.Matrix4, tintBy?: THREE.Color) {
    const e = m.elements;
    const sign = kind === 'sign';
    const key = `${sign}:${Math.floor(e[12] / 1600)}:${Math.floor(e[14] / 1600)}`;
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { sign, pos: [], nor: [], col: [], uv: [], glow: [] }));
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const col = geo.getAttribute('color');
    const uv = geo.getAttribute('uv');
    const lit = kind === 'glow' ? 1 : 0;
    this.nm.getNormalMatrix(m);
    const v = this.v;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      c.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      c.nor.push(v.x, v.y, v.z);
      const r = col ? col.getX(i) : 1;
      const g = col ? col.getY(i) : 1;
      const b = col ? col.getZ(i) : 1;
      c.col.push(r * (tintBy?.r ?? 1), g * (tintBy?.g ?? 1), b * (tintBy?.b ?? 1));
      if (sign) c.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      else c.glow.push(lit);
    }
  }

  build(scene: THREE.Scene, body: THREE.Material, sign: THREE.Material, keep: Keep, shadows: boolean) {
    for (const c of this.chunks.values()) {
      if (!c.pos.length) continue;
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
      if (c.sign) g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
      else g.setAttribute('glow', new THREE.Float32BufferAttribute(c.glow, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, c.sign ? sign : body);
      mesh.castShadow = shadows && !c.sign;
      mesh.receiveShadow = !c.sign;
      scene.add(mesh);
    }
  }
}

/**
 * The props' material: vertex colours, and where `glow` is 1 a window that's dark glass by day and lit at night
 * (`lit`, brighter than white so it blooms). Works on Low too: lowgfx.ts carries onBeforeCompile over to Lambert.
 */
function propMaterial(lit: number) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
  const uLit = { value: lit };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = uLit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vGlow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 glowCol = diffuseColor.rgb;\ndiffuseColor.rgb *= 1.0 - vGlow * 0.85;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glowCol * vGlow * uLit;');
  };
  return m;
}

// --- Templates ------------------------------------------------------------------------------------------------------

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cyl = (r0: number, r1: number, h: number, segs: number, x: number, y: number, z: number, color: number) => tint(new THREE.CylinderGeometry(r1, r0, h, segs).translate(x, y, z), color);
/** A hipped roof over a w x d footprint, eaves at y, ridge h above. */
const hip = (w: number, d: number, h: number, y: number, color: number) =>
  shade(tint(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(w, h, d).translate(0, y + h / 2, 0), color), y, y + h, 0.8, 1.1);
/** A gabled roof over a w x d footprint, the ridge along z, eaves at y, ridge h above. */
function gable(w: number, d: number, h: number, y: number, color: number) {
  const a = w / 2;
  const b = d / 2;
  const L = [-a, y];
  const R = [a, y];
  const T = [0, y + h];
  const v = (p: number[], z: number) => [p[0], p[1], z];
  const tri = (...ps: number[][]) => ps.flat();
  // Counter-clockwise seen from outside.
  const pos = [
    ...tri(v(L, -b), v(T, b), v(T, -b)), ...tri(v(L, -b), v(L, b), v(T, b)), // left slope
    ...tri(v(R, -b), v(T, b), v(R, b)), ...tri(v(R, -b), v(T, -b), v(T, b)), // right slope
    ...tri(v(L, -b), v(T, -b), v(R, -b)), // front gable
    ...tri(v(L, b), v(R, b), v(T, b)), // back gable
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return tint(g, color);
}

/** A Japanese farmhouse: white plaster over a dark timber base, a hipped tiled roof with wide eaves. */
function farmhouse(roof: number) {
  return merge([
    box(9, 7, 6.5, 0, 0.5, 0, 0xe6e0d2),
    box(9.06, 1.3, 6.56, 0, 0.55, 0, 0x4a3a2c),
    box(0.25, 3, 6.6, -2.2, 2.4, 0, 0x5a4532),
    box(0.25, 3, 6.6, 2.2, 2.4, 0, 0x5a4532),
    hip(11, 8.4, 2.9, 4, roof),
    box(1.6, 2.1, 0.12, 0, 1.05, -3.3, 0x3a2c22),
  ]);
}
function farmWindows() {
  return merge([box(1.6, 1.0, 0.1, -3.4, 2.5, -3.28, 0xffc98a), box(1.6, 1.0, 0.1, 3.4, 2.5, -3.28, 0xffc98a), box(1.6, 1.0, 0.1, 1.6, 2.5, 3.28, 0xffb070), box(0.1, 1.0, 1.4, 4.53, 2.5, 0, 0xffc98a)]);
}
/** A barn or shed: boarded walls, a corrugated gable roof. */
function barn(wall: number) {
  return merge([box(10, 8, 7, 0, 1, 0, wall), gable(8.2, 10.8, 2.6, 5, 0x8c949b).rotateY(Math.PI / 2), box(3.2, 3.4, 0.12, 0, 1.7, -3.52, 0x2e2722), box(10.06, 0.4, 7.06, 0, 4.9, 0, 0x3a2e26)]);
}
/** A Mediterranean house: whitewash, blue shutters, a low terracotta hipped roof. */
function villa() {
  return merge([
    box(8, 9, 7, 0, 1.5, 0, 0xf4efe6),
    hip(9, 8, 1.6, 6, 0xb4583b),
    box(0.4, 1.3, 0.12, -2.9, 3.6, -3.55, 0x2f5f8a),
    box(0.4, 1.3, 0.12, -1.1, 3.6, -3.55, 0x2f5f8a),
    box(0.4, 1.3, 0.12, 1.1, 3.6, -3.55, 0x2f5f8a),
    box(0.4, 1.3, 0.12, 2.9, 3.6, -3.55, 0x2f5f8a),
    box(1.4, 2.2, 0.12, 0, 1.1, -3.54, 0x6a4a30),
  ]);
}
function villaWindows() {
  return merge([box(1.2, 1.2, 0.1, -2, 3.6, -3.53, 0xffd29a), box(1.2, 1.2, 0.1, 2, 3.6, -3.53, 0xffd29a), box(1.2, 1.2, 0.1, 0, 3.6, 3.53, 0xffd29a)]);
}
/** An adobe house: a flat roof behind a parapet, the beam ends (vigas) poking out. */
function adobe() {
  const parts = [box(8, 7.4, 7, 0, 0.7, 0, 0xc98a5a), box(8.3, 0.5, 7.3, 0, 4.4, 0, 0xb9784c), box(1.3, 2.1, 0.12, -1.5, 1.05, -3.55, 0x4a3324)];
  for (let k = 0; k < 5; k++) parts.push(box(0.22, 0.22, 0.8, -3 + k * 1.5, 3.8, -3.7, 0x5a3e28));
  return merge(parts);
}
function adobeWindows() {
  return merge([box(1.0, 0.9, 0.1, 1.8, 2.2, -3.53, 0xffc070), box(0.1, 0.9, 1.0, 4.03, 2.2, 0.5, 0xffc070)]);
}
/** A tin-roofed shack. */
function shack() {
  return merge([box(6, 6.2, 5, 0, 0.1, 0, 0x7a6650), tint(new THREE.BoxGeometry(6.8, 0.15, 6).rotateX(-0.12).translate(0, 3.5, 0), 0x8a8f94), box(1.2, 2, 0.12, 1.4, 1, -2.53, 0x3a2e24)]);
}

/** A concrete telegraph pole with a crossarm and insulators (a transformer drum on some). */
function telegraphPole(transformer: boolean) {
  const parts = [cyl(0.17, 0.12, 10.4, 6, 0, 5.2, 0, 0x9c9a92), box(2.2, 0.14, 0.14, 0, 9.6, 0, 0x6e6c66)];
  for (const x of [-0.95, 0, 0.95]) parts.push(cyl(0.06, 0.06, 0.22, 5, x, 9.78, 0, 0xd8d6cc));
  if (transformer) parts.push(cyl(0.32, 0.32, 1.1, 8, 0, 7.6, 0.42, 0x8a9096), box(0.6, 0.12, 0.2, 0, 7.0, 0.25, 0x6e6c66));
  return merge(parts);
}
const WIRE_Y = 9.85;
const WIRE_X = [-0.95, 0, 0.95];

/** A torii gate, vermilion, its path along local z. */
function torii() {
  const red = 0xc8361f;
  return merge([
    cyl(0.24, 0.2, 5.2, 8, -1.9, 2.6, 0, red),
    cyl(0.24, 0.2, 5.2, 8, 1.9, 2.6, 0, red),
    box(0.62, 0.35, 0.62, -1.9, 0.18, 0, 0x2a2420),
    box(0.62, 0.35, 0.62, 1.9, 0.18, 0, 0x2a2420),
    box(4.6, 0.26, 0.26, 0, 4.25, 0, red),
    box(5.4, 0.32, 0.46, 0, 4.92, 0, red),
    box(6.0, 0.24, 0.56, 0, 5.2, 0, 0x1e1a18),
    box(0.3, 0.6, 0.16, 0, 4.6, 0, 0x1e1a18),
  ]);
}
/** A stone lantern (tōrō); its firebox is in the glow template. */
function lantern() {
  const stone = 0x97938a;
  return merge([
    box(0.7, 0.3, 0.7, 0, 0.15, 0, stone),
    cyl(0.16, 0.13, 1.0, 6, 0, 0.8, 0, stone),
    box(0.62, 0.14, 0.62, 0, 1.35, 0, stone),
    box(0.5, 0.06, 0.5, 0, 1.92, 0, stone),
    tint(new THREE.ConeGeometry(0.55, 0.42, 4).rotateY(Math.PI / 4).translate(0, 2.16, 0), stone),
    tint(new THREE.SphereGeometry(0.09, 5, 3).translate(0, 2.42, 0), stone),
    box(0.1, 0.44, 0.52, -0.22, 1.64, 0, stone),
    box(0.1, 0.44, 0.52, 0.22, 1.64, 0, stone),
  ]);
}
const lanternLight = () => merge([box(0.34, 0.34, 0.4, 0, 1.64, 0, 0xffb060)]);
/** A small wayside shrine (hokora) on a stone plinth. */
function hokora() {
  return merge([
    box(2.4, 0.9, 2, 0, 0, 0, 0x8d8a82),
    box(1.5, 1.3, 1.2, 0, 1.1, 0, 0x6b4a32),
    gable(2, 1.9, 0.8, 1.75, 0x30353b),
    box(0.9, 0.9, 0.06, 0, 1.15, -0.62, 0x2a1e16),
    box(1.9, 0.08, 0.08, 0, 1.68, -0.68, 0xe8dcc0),
  ]);
}

/** A five-storey pagoda: vermilion bays under deep dark roofs, a bronze spire. */
function pagoda() {
  const parts = [box(9, 3, 9, 0, -0.5, 0, 0x8d8a82)];
  let y = 1;
  for (let k = 0; k < 5; k++) {
    const w = 6.2 - k * 0.7;
    const h = k ? 2.4 : 3.2;
    parts.push(box(w, h, w, 0, y + h / 2, 0, 0xd8cdb8));
    parts.push(box(w + 0.06, h * 0.55, w + 0.06, 0, y + h * 0.35, 0, 0xb8401f));
    y += h;
    parts.push(hip(w + 3.6, w + 3.6, 1.1, y, 0x343a40));
    parts.push(box(w + 3.7, 0.18, w + 3.7, 0, y, 0, 0x2a2e33));
    y += 0.5;
  }
  parts.push(cyl(0.14, 0.1, 7, 6, 0, y + 3.2, 0, 0x9c7a3a));
  for (let k = 0; k < 5; k++) parts.push(cyl(0.36, 0.36, 0.14, 8, 0, y + 1.6 + k * 0.9, 0, 0x9c7a3a));
  return merge(parts);
}

/** A lighthouse: banded tower, gallery, lantern room (glow), red cap. */
function lighthouse() {
  const parts = [box(6, 4, 6, 0, -1, 0, 0xe8e2d6)];
  for (let k = 0; k < 5; k++) parts.push(cyl(2.2 - k * 0.15, 2.05 - k * 0.15, 4.4, 12, 0, 1 + k * 4.4 + 2.2, 0, k % 2 ? 0xc0392b : 0xf2efe8));
  parts.push(cyl(2.4, 2.4, 0.35, 12, 0, 23.2, 0, 0x2a2e33), cyl(0.9, 0.9, 0.3, 10, 0, 25.9, 0, 0x2a2e33));
  parts.push(tint(new THREE.ConeGeometry(1.3, 1.6, 10).translate(0, 26.8, 0), 0xc0392b));
  return merge(parts);
}
const lighthouseLamp = () => merge([cyl(1.0, 1.0, 2.4, 10, 0, 24.6, 0, 0xfff1c8)]);

/** A fishing boat or a small yacht. */
function boat(yacht: boolean) {
  const hull = yacht ? 0xf4f4f2 : 0x2f5f8a;
  const parts = [box(6, 1.1, 2.2, 0, 0.2, 0, hull), box(6.06, 0.25, 2.26, 0, -0.25, 0, 0x8a2a20)];
  parts.push(tint(new THREE.CylinderGeometry(1.1, 1.1, 1.1, 3).rotateY(Math.PI / 2).scale(1.1, 1, 1).translate(3.4, 0.2, 0), hull));
  if (yacht) parts.push(box(2.6, 0.9, 1.7, -0.6, 1.2, 0, 0xffffff), box(2.62, 0.3, 1.72, -0.6, 1.3, 0, 0x1d2630), cyl(0.06, 0.05, 9, 4, 0.8, 5.2, 0, 0xd8d8d8));
  else parts.push(box(1.6, 1.4, 1.6, -1.6, 1.4, 0, 0xf0ece4), cyl(0.06, 0.05, 3.5, 4, 0.8, 2.4, 0, 0x6a5a48));
  return merge(parts);
}

/** A water-pumping windmill: a tapering lattice tower, a fan, a tail vane. */
function windmill() {
  const g = new THREE.CylinderGeometry(0.25, 1.7, 11, 4, 1, true).rotateY(Math.PI / 4).translate(0, 5.5, 0);
  const parts = [tint(g, 0x55524c)];
  for (const y of [2.5, 5.5, 8.5]) parts.push(box(2.8 - y * 0.25, 0.08, 0.08, 0, y, 1.6 - y * 0.13, 0x55524c), box(0.08, 0.08, 2.8 - y * 0.25, 1.6 - y * 0.13, y, 0, 0x55524c));
  parts.push(box(0.5, 0.5, 1.2, 0, 11.2, 0, 0x45423c));
  for (let k = 0; k < 12; k++) {
    const blade = new THREE.BoxGeometry(0.36, 1.7, 0.04).translate(0, 1.35, 0).rotateY(0.35).rotateZ((k / 12) * Math.PI * 2).translate(0, 11.2, -0.75);
    parts.push(tint(blade, 0xc9c3b4));
  }
  parts.push(box(0.04, 1.2, 2, 0, 11.3, 1.6, 0xb0302a));
  return merge(parts);
}
function waterTower() {
  const wood = 0x7d5b3d;
  const parts = [cyl(2.6, 2.6, 3.4, 12, 0, 8.7, 0, wood), tint(new THREE.ConeGeometry(2.8, 1, 12).translate(0, 10.9, 0), 0x6a6e72)];
  for (const [x, z] of [
    [-1.8, -1.8],
    [1.8, -1.8],
    [1.8, 1.8],
    [-1.8, 1.8],
  ])
    parts.push(box(0.28, 7.5, 0.28, x, 3.5, z, 0x5a4232));
  parts.push(box(3.9, 0.15, 0.15, 0, 4, -1.8, 0x5a4232), box(3.9, 0.15, 0.15, 0, 4, 1.8, 0x5a4232));
  return merge(parts);
}

/** A desert hoodoo: a column of banded red rock, wider and narrower by turns, under a pale cap rock. */
function hoodoo(seed: number) {
  const rnd = mulberry(seed);
  const parts: THREE.BufferGeometry[] = [];
  let y = -2;
  const H = 7 + rnd() * 8;
  const n = 4;
  for (let k = 0; k < n; k++) {
    const h = (H + 2) / n;
    const r0 = 4.2 - k * 0.7 + rnd() * 0.8;
    const r1 = r0 * (0.6 + rnd() * 0.3);
    const g = new THREE.CylinderGeometry(r1, r0, h, 7, 2).translate(rnd() * 0.4, y + h / 2, rnd() * 0.4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const j = 0.85 + 0.3 * Math.abs(Math.sin(p.getY(i) * 1.7 + Math.atan2(p.getZ(i), p.getX(i)) * 3 + seed));
      p.setXYZ(i, p.getX(i) * j, p.getY(i), p.getZ(i) * j);
    }
    g.computeVertexNormals();
    parts.push(shade(tint(g, [0xa8502c, 0xc0683a, 0x9a4a2a, 0xb85e34][k]), y, y + h, 0.8, 1.05));
    y += h;
  }
  const cap = new THREE.CylinderGeometry(2.2, 2.5, 1.3, 7).translate(0, y + 0.5, 0);
  parts.push(tint(cap, 0xd9b48a));
  return merge(parts);
}

/** A red-and-white radio mast on a concrete hut, its beacon in the glow template. */
function radioMast() {
  const parts = [box(4, 5, 3, 3, 0.5, 0, 0xb8b6ae)];
  for (let k = 0; k < 6; k++) parts.push(tint(new THREE.CylinderGeometry(0.9 - (k + 1) * 0.12, 0.9 - k * 0.12, 5, 4, 1, true).translate(0, 2.5 + k * 5, 0), k % 2 ? 0xf2efe8 : 0xc8302a));
  return merge(parts);
}
const mastBeacon = () => merge([box(0.5, 0.5, 0.5, 0, 30.3, 0, 0xff2a1a), box(0.4, 0.4, 0.4, 0, 15.2, 0.5, 0xff2a1a)]);

/** A grandstand L long, seats stepping up away from the road (local +z), a crowd in them, a roof on posts. */
function grandstand(L: number, rnd: () => number) {
  const parts = [box(L, 3, 1.2, 0, -1.5, -0.6, 0x8d8f92)];
  const crowd = [0xd8d2c8, 0x2a3a5a, 0xc0392b, 0xf2c14e, 0x3a6a3a, 0x222222, 0xe8e8e8, 0x2f5f8a, 0xe07a2a];
  const seat = [0x2f6db3, 0xe6e6e6];
  for (let r = 0; r < 8; r++) {
    const y = 0.5 + r * 0.55;
    const z = 0.6 + r * 0.9;
    parts.push(box(L, 0.55 + 3 + r * 0.55, 0.9, 0, y - (3 + r * 0.55) / 2, z, 0x9a9c9f));
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.4; x += 1.2) {
      if (rnd() < 0.18) {
        parts.push(box(1.0, 0.35, 0.5, x, y + 0.17, z, seat[r % 2]));
        continue;
      }
      parts.push(box(0.9, 0.85, 0.45, x + (rnd() - 0.5) * 0.2, y + 0.42, z + 0.1, crowd[Math.floor(rnd() * crowd.length)]));
    }
  }
  const top = 0.5 + 8 * 0.55;
  parts.push(box(L, top + 6, 0.4, 0, (top + 6) / 2 - 3, 8 * 0.9 + 0.4, 0xb8bbbe));
  parts.push(box(L + 1, 0.3, 9.6, 0, top + 5, 3.6, 0xe4e4e2));
  for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 8) parts.push(box(0.25, top + 5, 0.25, x, (top + 5) / 2, -0.5, 0x6c6f73));
  return merge(parts);
}

/** Garage doors in team colours along the pits. */
const TEAMS = [0xc0392b, 0x2f5f8a, 0xf2c14e, 0x2a2c30, 0x3a8a5a, 0xe8e8e8, 0xe07a2a, 0x6a3a9a];

/**
 * A circuit's pit building, L long: a row of garages opening onto the pit lane (front, local -z), a set-back glass
 * hospitality floor above with a terrace, a flat roof. The garage lights and the glass are `pitGlow`.
 */
function pitBuilding(L: number) {
  const parts = [
    box(L, 4.6, 14, 0, 2.3, 0, 0xdadde0),
    box(L + 1, 0.4, 15, 0, 4.8, 0, 0x6d7278),
    box(L, 3.4, 11, 0, 6.7, 1.5, 0xc9cdd2),
    box(L + 1.6, 0.5, 13, 0, 8.65, 1.2, 0x4a5057),
    // Terrace railing in front of the glass.
    box(L, 0.9, 0.08, 0, 5.45, -7.3, 0xb8bcc0),
  ];
  const n = Math.floor((L - 2) / 6);
  for (let k = 0; k < n; k++) {
    const x = -((n - 1) * 6) / 2 + k * 6;
    parts.push(box(4.6, 3.7, 0.12, x, 1.85, -7.04, 0x2b2f35), box(4.8, 0.55, 0.14, x, 4.0, -7.06, TEAMS[k % TEAMS.length]));
  }
  for (let x = -L / 2; x <= L / 2 + 0.1; x += 6) parts.push(box(0.5, 4.6, 0.3, x, 2.3, -7.05, 0xe9ebed));
  return merge(parts);
}
function pitGlow(L: number) {
  const n = Math.floor((L - 2) / 6);
  const parts = [box(L - 0.6, 2.4, 0.1, 0, 6.6, -4.05, 0x6f8aa6)];
  for (let k = 0; k < n; k++) parts.push(box(4.2, 0.5, 0.1, -((n - 1) * 6) / 2 + k * 6, 3.4, -7.12, 0xfff1d8));
  return merge(parts);
}

/** Race control: a slim concrete tower with a glass cab (`towerCab`) and a mast on top. */
function controlTower() {
  return merge([
    box(4.4, 22, 4.4, 0, 11, 0, 0xd5d8db),
    box(9.4, 0.6, 9.4, 0, 22.3, 0, 0x5d646b),
    box(10.2, 0.6, 10.2, 0, 26.1, 0, 0x40464c),
    ...[-4.3, 4.3].flatMap((x) => [-4.3, 4.3].map((z) => box(0.3, 3.4, 0.3, x, 24.1, z, 0x40464c))),
    cyl(0.16, 0.08, 7, 5, 0, 29.9, 0, 0x8a8e92),
  ]);
}
const towerCab = () => merge([box(8.4, 3.2, 8.4, 0, 24.1, 0, 0x6f8aa6)]);

/** A big wheel, its rim facing the road (local -z): twin rims, spokes, gondolas, A-frame legs. Lights: `wheelLights`. */
const WHEEL_R = 21;
const WHEEL_HUB = WHEEL_R + 4;
function bigWheel() {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-1.3, 1.3]) parts.push(tint(new THREE.TorusGeometry(WHEEL_R, 0.32, 4, 48).translate(0, WHEEL_HUB, z), 0xeceef0));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (const z of [-1.3, 1.3]) parts.push(tint(new THREE.BoxGeometry(0.16, WHEEL_R, 0.16).translate(0, WHEEL_R / 2, 0).rotateZ(a).translate(0, WHEEL_HUB, z), 0xd0d4d8));
    // A gondola hanging under the rim.
    const gx = Math.sin(a) * WHEEL_R;
    const gy = WHEEL_HUB + Math.cos(a) * WHEEL_R;
    parts.push(box(1.8, 1.9, 1.8, gx, gy - 1.4, 0, TEAMS[k % 4]), box(2.0, 0.2, 2.0, gx, gy - 0.35, 0, 0xeceef0));
  }
  parts.push(tint(new THREE.CylinderGeometry(1.1, 1.1, 4.4, 10).rotateX(Math.PI / 2).translate(0, WHEEL_HUB, 0), 0x8a8e92));
  // Legs: two A-frames, from the ground out to the hub.
  for (const z of [-2.6, 2.6])
    for (const x of [-11, 11]) {
      const len = Math.hypot(x, WHEEL_HUB);
      parts.push(tint(new THREE.BoxGeometry(0.7, len, 0.7).translate(0, len / 2, 0).rotateZ(Math.atan2(x, WHEEL_HUB)).translate(x, 0, z), 0xb8bcc0));
    }
  parts.push(box(26, 1.2, 9, 0, 0.6, 0, 0x9a9da1), box(6, 3, 4, 0, 2.1, -3, 0xe8e2d6));
  return merge(parts);
}
function wheelLights() {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-1.55, 1.55]) parts.push(tint(new THREE.TorusGeometry(WHEEL_R, 0.12, 3, 64).translate(0, WHEEL_HUB, z), 0xffc8f0));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    parts.push(tint(new THREE.BoxGeometry(0.1, WHEEL_R - 1.5, 0.1).translate(0, (WHEEL_R - 1.5) / 2 + 1.2, -1.5).rotateZ(a).translate(0, WHEEL_HUB, 0), 0x9fe8ff));
  }
  return merge(parts);
}

// --- The sign atlas -------------------------------------------------------------------------------------------------

/** Atlas cells across the top row (128 px each of 1024): speed limit, curve left, curve right, round back, diamond back, plain grey. */
const CELL = { speed: 0, left: 1, right: 2, backRound: 3, backDiamond: 4, grey: 5 } as const;
const BANNERS = 4;
const BRANDS: [string, string, string][] = [
  ['KAZE OIL', '#c8102e', '#ffffff'],
  ['HAYATE TYRES', '#111111', '#ffcf1a'],
  ['KANJO', '#ffffff', '#d21f1f'],
  ['NAGARE FUEL', '#1e5bc6', '#ffffff'],
];

function signAtlas() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const cell = (k: number, draw: () => void) => {
    g.save();
    g.translate(k * 128 + 64, 64);
    draw();
    g.restore();
  };
  cell(CELL.speed, () => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d21f1f';
    g.lineWidth = 13;
    g.beginPath();
    g.arc(0, 0, 52, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#1e3f9e';
    g.font = 'bold 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('50', 0, 4);
  });
  for (const [k, dir] of [
    [CELL.left, -1],
    [CELL.right, 1],
  ] as const)
    cell(k, () => {
      g.fillStyle = '#111';
      g.beginPath();
      g.moveTo(0, -62);
      g.lineTo(62, 0);
      g.lineTo(0, 62);
      g.lineTo(-62, 0);
      g.fill();
      g.fillStyle = '#ffcf1a';
      g.beginPath();
      g.moveTo(0, -55);
      g.lineTo(55, 0);
      g.lineTo(0, 55);
      g.lineTo(-55, 0);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 9;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-6 * dir, 28);
      g.lineTo(-6 * dir, -2);
      g.quadraticCurveTo(-6 * dir, -16, 12 * dir, -16);
      g.stroke();
      g.fillStyle = '#111';
      g.beginPath();
      g.moveTo(26 * dir, -16);
      g.lineTo(10 * dir, -29);
      g.lineTo(10 * dir, -3);
      g.fill();
    });
  cell(CELL.backRound, () => {
    g.fillStyle = '#8c9096';
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fill();
  });
  cell(CELL.backDiamond, () => {
    g.fillStyle = '#8c9096';
    g.beginPath();
    g.moveTo(0, -62);
    g.lineTo(62, 0);
    g.lineTo(0, 62);
    g.lineTo(-62, 0);
    g.fill();
  });
  g.fillStyle = '#5c6066';
  g.fillRect(CELL.grey * 128, 0, 128, 128);
  // Trackside banners, 1024 x 96 each from y = 128.
  BRANDS.forEach(([text, bg, fg], k) => {
    const y = 128 + k * 96;
    g.fillStyle = bg;
    g.fillRect(0, y, 1024, 96);
    g.fillStyle = fg;
    g.font = 'italic 900 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const x of [256, 768]) g.fillText(text, x, y + 50);
    g.fillRect(0, y + 86, 1024, 4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A w x h quad facing -z (front) and its back facing +z, mapped to atlas rectangles [u0, v0, u1, v1] (v from the top). */
function card(w: number, h: number, y: number, front: number[], back: number[]) {
  const quad = (uv: number[], flip: boolean) => {
    const g = new THREE.PlaneGeometry(w, h);
    if (!flip) g.rotateY(Math.PI);
    g.translate(0, y, flip ? 0.02 : -0.02);
    const a = g.getAttribute('uv');
    const [u0, v0, u1, v1] = uv;
    for (let i = 0; i < a.count; i++) {
      const u = a.getX(i);
      const v = a.getY(i);
      a.setXY(i, u0 + (u1 - u0) * u, 1 - (v1 - (v1 - v0) * v));
    }
    return g;
  };
  const parts = [quad(front, false), quad(back, true)];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  for (const p of parts) {
    const ni = p.toNonIndexed();
    pos.push(...(ni.getAttribute('position').array as Float32Array));
    nor.push(...(ni.getAttribute('normal').array as Float32Array));
    uvs.push(...(ni.getAttribute('uv').array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}
const cellUv = (k: number) => [(k * 128 + 2) / 1024, 2 / 512, ((k + 1) * 128 - 2) / 1024, 126 / 512];
const bannerUv = (k: number) => [0, (128 + k * 96) / 512, 1, (128 + (k + 1) * 96) / 512];

// --- Placement ------------------------------------------------------------------------------------------------------

export interface Decor {
  /** Footprints the forest must keep clear of. */
  sites: Site[];
  /** Builds the meshes (call after the forest). */
  build(): void;
}

/**
 * Plans the props for a track (so the forest can keep clear of them), then builds them. `forestAt` is the forest's own
 * density, so houses go in the clearings.
 */
export function decor(
  scene: THREE.Scene, t: Track, keep: Keep, opts: { night: boolean; low: boolean; forestAt: (x: number, z: number) => number; area: { x0: number; x1: number; z0: number; z1: number } },
): Decor {
  const theme = t.def.theme;
  const sites: Site[] = [];
  const batch = new Batch();
  const wires: number[] = [];
  const rnd = mulberry(t.def.seed * 104729 + 17);
  const here = newLoc();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const water = t.def.water;
  const lap = !!t.lap;
  const city = theme === 'city';
  const japan = theme === 'alpine' || theme === 'night' || theme === 'autumn' || theme === 'spring';
  const town = TOWNS[t.def.id];

  /** Clear of every road (and its runoff) at (x, z) by `by` metres, and of the shortcuts. */
  const clear = (x: number, z: number, by: number) => {
    const rd = roadDistance(t, x, z);
    if (rd > t.edgeMax + by + 30) return !onCut(t, x, z, by);
    if (rd < t.edge + by * 0.5) return false;
    locate(t, x, z, -1, here);
    return Math.abs(here.d) > railOf(t, here.i, here.d) + by && !onCut(t, x, z, by);
  };
  const free = (x: number, z: number, r: number) => sites.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + r);
  /** The yaw that turns a prop's front (local -z) to face the road from `side`. */
  const facing = (tx: number, tz: number, side: number) => Math.atan2(side * -tz, side * tx);
  /**
   * Whether a w x d footprint centred at (x, z), turned by yaw, sits on fairly flat dry ground clear of the road;
   * returns its lowest corner's height (the building is sunk to it) or null.
   */
  const footprint = (x: number, z: number, yaw: number, w: number, d: number, flat: number, by = 3) => {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const fx of [-0.5, 0, 0.5])
      for (const fz of [-0.5, 0, 0.5]) {
        const px = x + fx * w * cs + fz * d * sn;
        const pz = z - fx * w * sn + fz * d * cs;
        if (!clear(px, pz, by)) return null;
        const h = heightAt(t, px, pz);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    if (hi - lo > flat) return null;
    if (water !== undefined && lo < water + 1.5) return null;
    return lo;
  };
  const place = (kind: Kind, geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, s = 1, tintBy?: THREE.Color) => {
    q.setFromAxisAngle(up, yaw);
    batch.add(kind, geo, m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)), tintBy);
  };
  const inSpan = (s: number, pad: number) => t.spans.some((sp) => (sp.kind === 'bridge' || sp.kind === 'tunnel') && s > sp.s0 - pad && s < sp.s1 + pad);
  const nearEnds = (s: number, pad: number) => Math.abs(s - t.finishS) < pad || (!lap && Math.abs(s - t.startS) < pad);

  // --- Houses in the clearings, in little hamlets
  const plans: { geo: THREE.BufferGeometry; win: THREE.BufferGeometry | null; w: number; d: number }[] = [];
  if (town) for (const h of town.houses) plans.push({ geo: keep(h.geo()), win: h.win ? keep(h.win()) : null, w: h.w, d: h.d });
  else if (!city) {
    if (theme === 'coast') plans.push({ geo: villa(), win: villaWindows(), w: 8, d: 7 }, { geo: villa(), win: villaWindows(), w: 8, d: 7 }, { geo: barn(0xe9e1d0), win: null, w: 10, d: 7 });
    else if (theme === 'desert') plans.push({ geo: adobe(), win: adobeWindows(), w: 8, d: 7 }, { geo: adobe(), win: adobeWindows(), w: 8, d: 7 }, { geo: shack(), win: null, w: 6, d: 5 });
    else plans.push({ geo: farmhouse(0x3b434d), win: farmWindows(), w: 9, d: 6.5 }, { geo: farmhouse(0x5a3a2c), win: farmWindows(), w: 9, d: 6.5 }, { geo: barn(0x8a6248), win: null, w: 10, d: 7 });
    for (const p of plans) keep(p.geo), p.win && keep(p.win);
  }
  const houses: { x: number; z: number; y: number; yaw: number; plan: number }[] = [];
  const tryHouse = (x: number, z: number, yaw: number, k = Math.floor(rnd() * plans.length)) => {
    const p = plans[k];
    // A town's houses stand shoulder to shoulder, close to the road, whatever the forest says.
    const r = Math.hypot(p.w, p.d) / 2 + (town ? 0.3 : 2);
    if (!free(x, z, r) || (!town && opts.forestAt(x, z) > 0.06)) return false;
    const y = town ? footprint(x, z, yaw, p.w, p.d, town.flat, 1.5) : footprint(x, z, yaw, p.w + 2, p.d + 2, 2.4, 6);
    if (y === null) return false;
    sites.push({ x, z, r: r + (town ? 0.5 : 2) });
    houses.push({ x, z, y, yaw, plan: k });
    return true;
  };
  if (town) {
    // Rows of houses facing the road all the way round the lap, but not by the line (the pits and stands go there).
    const lapLen = t.lap ? t.lap * SAMPLE : t.length;
    for (let s = t.startS; s < t.startS + lapLen; s += town.every * (0.85 + rnd() * 0.3)) {
      const off = s - t.startS;
      if (off < 160 || lapLen - off < 190) continue;
      const p0 = pointAt(t, s, 0);
      for (const side of [-1, 1])
        for (let row = 0; row < town.rows; row++) {
          if (rnd() > town.fill * (1 - row * 0.12)) continue;
          const k = Math.floor(rnd() * plans.length);
          const p = pointAt(t, s, side * (railOf(t, p0.i, side) + town.gap + plans[k].d / 2 + row * town.depth + rnd() * 2.5));
          tryHouse(p.x, p.z, facing(p.tx, p.tz, side) + (rnd() - 0.5) * 0.12, k);
        }
    }
  } else if (!city) {
    const want = Math.round((t.length / 1000) * (lap ? 3 : 5));
    for (let tries = 0; tries < 900 && houses.length < want; tries++) {
      const s = rnd() * t.length;
      if (nearEnds(s, 220)) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const p0 = pointAt(t, s, 0);
      const d = side * (railOf(t, p0.i, side) + 16 + rnd() ** 1.6 * 280);
      const p = pointAt(t, s, d);
      const yaw = facing(p.tx, p.tz, side) + (rnd() - 0.5) * 0.5;
      if (!tryHouse(p.x, p.z, yaw)) continue;
      // Neighbours: a hamlet of two to four.
      let more = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < 8 && more > 0; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 16 + rnd() * 14;
        if (tryHouse(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, yaw + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3)) more--;
      }
    }
  }

  // --- Wayside shrines on the Japanese passes: a torii off the road, two lanterns, a shrine behind.
  const shrines: { x: number; z: number; y: number; yaw: number; side: number; s: number }[] = [];
  if (japan && !lap) {
    const want = Math.max(2, Math.round(t.length / 2000));
    for (let tries = 0; tries < 300 && shrines.length < want; tries++) {
      const s = 200 + rnd() * (t.length - 400);
      if (nearEnds(s, 150) || inSpan(s, 60) || shrines.some((o) => Math.abs(o.s - s) < 600)) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const p0 = pointAt(t, s, 0);
      if (Math.abs(t.curv[p0.i]) > 1 / 120) continue;
      const d0 = railOf(t, p0.i, side) + 4;
      const mid = pointAt(t, s, side * (d0 + 7));
      const yaw = facing(p0.tx, p0.tz, side);
      if (!free(mid.x, mid.z, 10)) continue;
      const y = footprint(mid.x, mid.z, yaw, 7, 15, 1.6, 2.5);
      if (y === null) continue;
      sites.push({ x: mid.x, z: mid.z, r: 10 });
      shrines.push({ x: mid.x, z: mid.z, y, yaw, side, s });
    }
  }

  // --- A circuit's pits: on the inside of the lap, along the straight before the line, with race control at the end
  const pits: { geo: THREE.BufferGeometry; glow: THREE.BufferGeometry; x: number; y: number; z: number; yaw: number }[] = [];
  if (lap) {
    let turn = 0;
    for (let i = 0; i < t.n; i++) turn += t.curv[i];
    const side = turn > 0 ? 1 : -1; // a clockwise lap's inside is on the right
    const L = 96;
    const straight = (s: number, half: number) => {
      for (let u = s - half; u <= s + half; u += SAMPLE * 2) if (Math.abs(t.curv[Math.round((((u % t.length) + t.length) % t.length) / SAMPLE)]) > 1 / 450) return false;
      return true;
    };
    for (const off of [-60, -90, -30, -120, 0, 30]) {
      const s = t.startS + off;
      if (!straight(s, L / 2 + 14)) continue;
      const p0 = pointAt(t, s, 0);
      const p = pointAt(t, s, side * (railOf(t, p0.i, side) + 15));
      const yaw = facing(p0.tx, p0.tz, side);
      if (!free(p.x, p.z, L / 2)) continue;
      const y = footprint(p.x, p.z, yaw, L, 15, 2.5, 4);
      if (y === null) continue;
      sites.push({ x: p.x, z: p.z, r: L / 2 + 4 });
      pits.push({ geo: keep(pitBuilding(L)), glow: keep(pitGlow(L)), x: p.x, y: y - 0.1, z: p.z, yaw });
      // Race control just past the far end of the pits.
      const c = pointAt(t, s + L / 2 + 12, side * (railOf(t, p0.i, side) + 20));
      const cy = footprint(c.x, c.z, yaw, 11, 11, 2.5, 4);
      if (cy !== null && free(c.x, c.z, 7)) {
        sites.push({ x: c.x, z: c.z, r: 8 });
        pits.push({ geo: keep(controlTower()), glow: keep(towerCab()), x: c.x, y: cy - 0.1, z: c.z, yaw });
      }
      break;
    }
  }

  // --- A landmark or two
  const marks: { geo: THREE.BufferGeometry; glow?: THREE.BufferGeometry; x: number; y: number; z: number; yaw: number }[] = [];
  const landmark = (geo: () => THREE.BufferGeometry, glow: (() => THREE.BufferGeometry) | null, r: number, near: number, far: number, flat: number, score: (x: number, z: number, h: number) => number, n = 1) => {
    for (let k = 0; k < n; k++) {
      let best: { x: number; z: number; y: number; yaw: number; v: number } | null = null;
      for (let tries = 0; tries < 160; tries++) {
        const s = rnd() * t.length;
        if (nearEnds(s, 200)) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const p0 = pointAt(t, s, 0);
        const p = pointAt(t, s, side * (railOf(t, p0.i, side) + near + rnd() * (far - near)));
        if (!free(p.x, p.z, r + 4)) continue;
        const yaw = facing(p.tx, p.tz, side);
        const y = footprint(p.x, p.z, yaw, r * 2, r * 2, flat, 6);
        if (y === null) continue;
        const v = score(p.x, p.z, y);
        if (!best || v > best.v) best = { x: p.x, z: p.z, y, yaw, v };
      }
      if (!best) continue;
      sites.push({ x: best.x, z: best.z, r: r + 4 });
      marks.push({ geo: keep(geo()), glow: glow ? keep(glow()) : undefined, x: best.x, y: best.y, z: best.z, yaw: best.yaw });
    }
  };
  const high = (_x: number, _z: number, h: number) => h;
  if ((theme === 'autumn' || theme === 'spring') && !lap) landmark(pagoda, null, 6, 30, 160, 2.2, high, 1);
  if ((theme === 'alpine' || theme === 'night') && !lap && !t.def.climb) landmark(radioMast, mastBeacon, 4, 40, 260, 2.5, high, 1);
  if (t.def.climb) landmark(radioMast, mastBeacon, 4, 20, 120, 3, high, 1);
  if (town) for (const m of town.marks) landmark(m.geo, null, m.r, m.near, m.far, m.flat, m.at === 'high' ? high : m.at === 'low' ? (_x, _z, h) => -h : () => rnd(), m.n);
  if (theme === 'coast' && water !== undefined && !town) landmark(lighthouse, lighthouseLamp, 4, 20, 220, 3, (_x, _z, h) => -Math.abs(h - water - 8), 1);
  // A big wheel by the harbour on the seaside and street circuits.
  if (lap && water !== undefined && (city || theme === 'coast') && !town) landmark(bigWheel, wheelLights, 15, 25, 150, 3, (_x, _z, h) => -Math.abs(h - water - 6), 1);
  if (theme === 'desert' && !town) {
    // Hoodoos standing out on the plain.
    const any = () => rnd();
    landmark(() => hoodoo(t.def.seed * 3 + marks.length), null, 3, 30, 380, 6, any, Math.round(t.length / 350));
    // A windmill and a water tower beside the first hamlets.
    for (const [k, h] of houses.slice(0, 6).entries()) {
      const a = h.yaw + Math.PI / 2;
      const x = h.x + Math.cos(a) * 14;
      const z = h.z - Math.sin(a) * 14;
      if (!free(x, z, 4) || footprint(x, z, 0, 5, 5, 2, 4) === null) continue;
      sites.push({ x, z, r: 4 });
      marks.push({ geo: keep(k % 2 ? waterTower() : windmill()), x, y: heightAt(t, x, z) - 0.3, z, yaw: h.yaw });
    }
  }

  /** A town's walls along the road, its balloons in the sky and its boathouses in the shallows (towns.ts). */
  const townExtras = () => {
    if (!town) return;
    const lapN = t.lap || t.n;
    if (town.wall) {
      // Coral stone a step outside the barrier on both sides, in 4 m lengths that follow the road; gaps where
      // something else stands (the pits, the stands) or the ground falls away to the beach.
      const big = sites.filter((s) => s.r > 15);
      const seg = keep(merge([box(4.3, town.wall.h + 1, 0.6, 0, (town.wall.h - 1) / 2, 0, town.wall.color), box(4.3, 0.12, 0.7, 0, town.wall.h + 0.03, 0, 0xe6e0d2)]));
      for (let i = 0; i < lapN; i += 2)
        for (const side of [-1, 1]) {
          const d = side * (railOf(t, i, side) + 1.6);
          const x = t.x[i] - t.tz[i] * d;
          const z = t.z[i] + t.tx[i] * d;
          const gy = heightAt(t, x, z);
          const road = t.y[i] - t.bank[i] * d;
          if (Math.abs(gy - road) > 1.2 || (water !== undefined && gy < water + 1) || !clear(x, z, 0.3) || !big.every((s) => Math.hypot(s.x - x, s.z - z) > s.r)) continue;
          place('body', seg, x, gy, z, Math.atan2(-t.tz[i], t.tx[i]));
        }
    }
    const { x0, x1, z0, z1 } = opts.area;
    if (town.sky) {
      const kinds = town.sky.geo().map((g) => keep(g));
      let n = 0;
      for (let tries = 0; tries < 2000 && n < town.sky.n; tries++) {
        const x = x0 + rnd() * (x1 - x0);
        const z = z0 + rnd() * (z1 - z0);
        const rd = roadDistance(t, x, z);
        if (rd < town.sky.d[0] || rd > town.sky.d[1]) continue;
        const [h0, h1] = town.sky.h;
        place('body', kinds[n % kinds.length], x, heightAt(t, x, z) + h0 + rnd() * (h1 - h0), z, rnd() * Math.PI * 2, 0.85 + rnd() * 0.35);
        n++;
      }
    }
    if (town.shore && water !== undefined) {
      const hut = keep(town.shore.geo());
      let n = 0;
      for (let tries = 0; tries < 3000 && n < town.shore.n; tries++) {
        const x = x0 + rnd() * (x1 - x0);
        const z = z0 + rnd() * (z1 - z0);
        const rd = roadDistance(t, x, z);
        const h = heightAt(t, x, z);
        if (rd < 22 || rd > 240 || h > water - 0.5 || h < water - 6 || !free(x, z, 6)) continue;
        // Face the shore: the way the ground rises.
        const yaw = Math.atan2(heightAt(t, x + 4, z) - heightAt(t, x - 4, z), heightAt(t, x, z + 4) - heightAt(t, x, z - 4)) + Math.PI;
        sites.push({ x, z, r: 6 });
        place('body', hut, x, water - 0.2, z, yaw);
        n++;
      }
    }
  };

  return {
    sites,
    build() {
      // Houses (their windows glow at night)
      for (const h of houses) {
        const p = plans[h.plan];
        c.setScalar(0.88 + rnd() * 0.18);
        place('body', p.geo, h.x, h.y, h.z, h.yaw, 1, c);
        if (p.win) place('glow', p.win, h.x, h.y, h.z, h.yaw);
      }
      // Shrines
      if (shrines.length) {
        const gate = keep(torii());
        const lamp = keep(lantern());
        const light = keep(lanternLight());
        const shrine = keep(hokora());
        for (const s of shrines) {
          const fx = Math.sin(s.yaw);
          const fz = Math.cos(s.yaw);
          const at = (k: number, x = 0) => [s.x + fx * k + Math.cos(s.yaw) * x, s.z + fz * k - Math.sin(s.yaw) * x] as const;
          const [gx, gz] = at(-5);
          place('body', gate, gx, heightAt(t, gx, gz) - 0.1, gz, s.yaw);
          for (const x of [-2.3, 2.3]) {
            const [lx, lz] = at(-1.5, x);
            const ly = heightAt(t, lx, lz) - 0.05;
            place('body', lamp, lx, ly, lz, s.yaw);
            place('glow', light, lx, ly, lz, s.yaw);
          }
          const [hx, hz] = at(5);
          place('body', shrine, hx, heightAt(t, hx, hz), hz, s.yaw);
        }
      }
      for (const mk of marks) {
        place('body', mk.geo, mk.x, mk.y, mk.z, mk.yaw);
        if (mk.glow) place('glow', mk.glow, mk.x, mk.y, mk.z, mk.yaw);
      }
      if (town) townExtras();

      // --- Telegraph poles along the passes, wires sagging between them
      if (!lap && !city) {
        const plain = keep(telegraphPole(false));
        const trans = keep(telegraphPole(true));
        const side = t.def.seed % 2 ? 1 : -1;
        const every = 19; // samples (38 m)
        let prev: THREE.Vector3[] | null = null;
        let n = 0;
        for (let i = every; i < t.n - every; i += every) {
          const s = i * SAMPLE;
          const d = side * (railOf(t, i, side) + 2.6);
          const x = t.x[i] - t.tz[i] * d;
          const z = t.z[i] + t.tx[i] * d;
          const road = t.y[i] - t.bank[i] * d;
          const gy = heightAt(t, x, z);
          const ok = !inSpan(s, 30) && !nearEnds(s, 20) && !(t.cross && (t.cross.up[i] || t.cross.low[i])) && clear(x, z, 1.2) && Math.abs(gy - road) < 3.5 && (water === undefined || gy > water + 0.5);
          if (!ok) {
            prev = null;
            continue;
          }
          const yaw = Math.atan2(-t.tx[i], -t.tz[i]); // the crossarm (local x) across the road
          place('body', n++ % 5 === 2 ? trans : plain, x, gy - 0.3, z, yaw);
          const cs = Math.cos(yaw);
          const sn = Math.sin(yaw);
          const tops = WIRE_X.map((wx) => new THREE.Vector3(x + wx * cs, gy - 0.3 + WIRE_Y, z - wx * sn));
          if (prev && prev[0].distanceTo(tops[0]) < 60) {
            for (let k = 0; k < 3; k++) {
              const a = prev[k];
              const b = tops[k];
              const SEG = 8;
              for (let j = 0; j < SEG; j++) {
                for (const u of [j / SEG, (j + 1) / SEG]) {
                  const sag = 4 * u * (1 - u) * 0.9;
                  wires.push(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - sag, a.z + (b.z - a.z) * u);
                }
              }
            }
          }
          prev = tops;
        }
      }

      // --- Road signs: a curve warning before each tight bend, speed limits on the passes' straights (left side, as in Japan)
      const atlas = keep(signAtlas());
      if (!city && !lap) {
        const post = keep(merge([cyl(0.045, 0.045, 2.4, 5, 0, 1.2, 0, 0x9aa0a6)]));
        const curveL = keep(card(0.9, 0.9, 2.2, cellUv(CELL.left), cellUv(CELL.backDiamond)));
        const curveR = keep(card(0.9, 0.9, 2.2, cellUv(CELL.right), cellUv(CELL.backDiamond)));
        const speed = keep(card(0.75, 0.75, 2.15, cellUv(CELL.speed), cellUv(CELL.backRound)));
        const sign = (s: number, geo: THREE.BufferGeometry) => {
          const p0 = pointAt(t, s, 0);
          const d = -(railOf(t, p0.i, -1) + 1.1);
          const p = pointAt(t, s, d);
          if (!clear(p.x, p.z, 0.5) || inSpan(s, 10)) return;
          const y = p.y;
          // Face the oncoming traffic: front (local -z) back up the road.
          const yaw = Math.atan2(p0.tx, p0.tz);
          place('body', post, p.x, y, p.z, yaw);
          place('sign', geo, p.x, y, p.z, yaw);
        };
        let lastBend = -1e9;
        for (let i = 0; i < t.n; i += 3) {
          const k = t.curv[i];
          if (Math.abs(k) < 1 / 55 || i * SAMPLE - lastBend < 250) continue;
          lastBend = i * SAMPLE;
          const s = i * SAMPLE - 70;
          if (s > 30) sign(s, k > 0 ? curveL : curveR);
        }
        for (let s = 400; s < t.length - 300; s += 700) if (Math.abs(t.curv[Math.round(s / SAMPLE)]) < 1 / 250) sign(s, speed);
      }

      // --- Circuits: the pits and race control by the line, grandstands, sponsor boards along the straights
      for (const p of pits) {
        place('body', p.geo, p.x, p.y, p.z, p.yaw);
        place('glow', p.glow, p.x, p.y, p.z, p.yaw);
      }
      if (lap) {
        const stand = keep(grandstand(36, mulberry(t.def.seed + 5)));
        for (const off of [-150, -105, -60, 40, 85, 130]) {
          const s = (t.startS + off + t.length) % t.length;
          const p0 = pointAt(t, s, 0);
          if (Math.abs(t.curv[p0.i]) > 1 / 250) continue;
          for (const side of [1, -1]) {
            const p = pointAt(t, s, side * (railOf(t, p0.i, side) + 9));
            const yaw = facing(p0.tx, p0.tz, side);
            const fx = Math.sin(yaw);
            const fz = Math.cos(yaw);
            const cx = p.x + fx * 4;
            const cz = p.z + fz * 4;
            if (!free(cx, cz, 18)) continue;
            const y = footprint(cx, cz, yaw, 38, 10, 4, 4);
            if (y === null) continue;
            sites.push({ x: cx, z: cz, r: 20 });
            place('body', stand, p.x, y, p.z, yaw);
            break;
          }
        }
        const boards = Array.from({ length: BANNERS }, (_, k) => keep(card(6, 1.1, 0.95, bannerUv(k), cellUv(CELL.grey))));
        const legs = keep(merge([box(0.12, 0.5, 0.12, -2.6, 0.25, 0.05, 0x55585c), box(0.12, 0.5, 0.12, 2.6, 0.25, 0.05, 0x55585c)]));
        let k = 0;
        for (let i = 0; i < t.n - 1; i += 4) {
          if (Math.abs(t.curv[i]) > 1 / 160) continue;
          const side = (i >> 2) % 2 ? 1 : -1;
          if ((i >> 3) % 3 === 2) continue;
          const d = side * (railOf(t, i, side) + 1.4);
          const x = t.x[i] - t.tz[i] * d;
          const z = t.z[i] + t.tx[i] * d;
          if (!clear(x, z, 0.4) || !free(x, z, 1)) continue;
          const y = t.y[i] - t.bank[i] * d;
          const yaw = facing(t.tx[i], t.tz[i], side);
          place('sign', boards[k++ % BANNERS], x, y, z, yaw);
          place('body', legs, x, y, z, yaw);
        }
      }

      // --- Boats on the water
      if (water !== undefined && !city) {
        const fishing = keep(boat(false));
        const yacht = keep(boat(true));
        const want = lap ? 16 : 8;
        let placed = 0;
        const { x0, x1, z0, z1 } = opts.area;
        for (let tries = 0; tries < 600 && placed < want; tries++) {
          const x = x0 + rnd() * (x1 - x0);
          const z = z0 + rnd() * (z1 - z0);
          const rd = roadDistance(t, x, z);
          if (rd < 40 || rd > (lap ? 260 : 500) || heightAt(t, x, z) > water - 2.5) continue;
          if (!free(x, z, 8)) continue;
          sites.push({ x, z, r: 6 });
          place('body', lap || rnd() < 0.4 ? yacht : fishing, x, water + 0.2, z, rnd() * Math.PI * 2, 0.9 + rnd() * 0.5);
          placed++;
        }
      }

      // Where things went, for /dev/scenery.html (`scn.props()`).
      scene.userData.props = { houses: houses.map((h) => [h.x, h.y, h.z]), shrines: shrines.map((h) => [h.x, h.y, h.z]), marks: marks.map((h) => [h.x, h.y, h.z]), pits: pits.map((h) => [h.x, h.y, h.z]) };
      // Windows, lantern fireboxes, beacons: dark glass by day, lit (brighter than white, so they bloom) at night.
      const body = keep(propMaterial(opts.night ? 2.6 : 0));
      const signMat = keep(new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: opts.night ? 0.9 : 0.08, roughness: 0.5, side: THREE.FrontSide }));
      batch.build(scene, body, signMat, keep, !opts.low);
      if (wires.length) {
        const g = keep(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
        g.computeBoundingSphere();
        scene.add(new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color: opts.night ? 0x05070a : 0x1d1f22 }))));
      }
    },
  };
}
