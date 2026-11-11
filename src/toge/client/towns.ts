// The Postcard Cup's towns (Michael, 2026-11-10: "based on unique cities like Taketomi Island in Okinawa"): each of
// the five circuits is lined with its own town instead of the theme's farmhouses. scenery.ts `decor` places them:
// rows of houses facing the road (`TOWNS[id].houses`, a few colour variants each), the town's landmarks, and its
// extras: Taketomi's coral-stone walls along the lanes and its water-buffalo carts, Hallstatt's boathouses on the
// lake, Göreme's fairy chimneys and its sky full of hot-air balloons, Oia's blue domes and windmills, Chefchaouen's
// minarets and kasbah. All of it goes into scenery.ts's merged batches, so a town costs a handful of draw calls.
//
// Every template stands on y = 0 with a plinth reaching `SINK` below it, so a house on a slope (sunk to its lowest
// corner) never shows daylight under its walls. Front is local -z (it faces the road).

import * as THREE from 'three';
import type { TrackId } from '../shared/track.ts';
import { merge, shade, tint } from './trees.ts';

/** How far every building's plinth reaches below its floor. */
const SINK = 4;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cyl = (r0: number, r1: number, h: number, segs: number, x: number, y: number, z: number, color: number) => tint(new THREE.CylinderGeometry(r1, r0, h, segs).translate(x, y, z), color);
/** A box standing on y0 (its plinth below it). */
const block = (w: number, h: number, d: number, color: number, y0 = 0) => box(w, h + SINK, d, 0, y0 + (h - SINK) / 2, 0, color);
/** A hipped roof over a w x d footprint, eaves at y, ridge h above. */
const hip = (w: number, d: number, h: number, y: number, color: number) =>
  shade(tint(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(w, h, d).translate(0, y + h / 2, 0), color), y, y + h, 0.8, 1.1);
/** A gabled roof over a w x d footprint, the ridge across the front (along x), eaves at y, ridge h above. */
function gable(w: number, d: number, h: number, y: number, color: number) {
  const a = w / 2;
  const b = d / 2;
  const v = (x: number, yy: number, z: number) => [x, yy, z];
  const pos = [
    ...v(-a, y, -b), ...v(a, y, -b), ...v(a, y + h, 0), ...v(-a, y, -b), ...v(a, y + h, 0), ...v(-a, y + h, 0), // front slope
    ...v(-a, y, b), ...v(a, y + h, 0), ...v(a, y, b), ...v(-a, y, b), ...v(-a, y + h, 0), ...v(a, y + h, 0), // back slope
    ...v(-a, y, -b), ...v(-a, y + h, 0), ...v(-a, y, b), // left gable end
    ...v(a, y, -b), ...v(a, y, b), ...v(a, y + h, 0), // right gable end
  ];
  // Wound counter-clockwise seen from outside: swap each triangle's last two corners.
  for (let k = 0; k < pos.length; k += 9) for (let j = 0; j < 3; j++) [pos[k + 3 + j], pos[k + 6 + j]] = [pos[k + 6 + j], pos[k + 3 + j]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return shade(tint(g, color), y, y + h, 0.85, 1.05);
}

export interface TownHouse {
  geo: () => THREE.BufferGeometry;
  /** Its windows (dark glass by day, lit at night). */
  win?: () => THREE.BufferGeometry;
  /** Footprint (m), for the clearance check. */
  w: number;
  d: number;
}

export interface TownMark {
  geo: () => THREE.BufferGeometry;
  /** Clearance radius (m), and how far out from the barrier it may stand. */
  r: number;
  near: number;
  far: number;
  /** How uneven its footprint may be (m). */
  flat: number;
  n: number;
  /** Which spot wins: the highest, the lowest (by the water), or any. */
  at: 'high' | 'low' | 'any';
}

export interface Town {
  houses: TownHouse[];
  /** Spacing of the houses along the road (m), how far past the barrier the first row stands, the rows' depth, how many rows, and how full each row is (0-1). */
  every: number;
  gap: number;
  depth: number;
  rows: number;
  fill: number;
  /** How uneven a house's footprint may be (m): hillside towns stack their houses up the slope. */
  flat: number;
  marks: TownMark[];
  /** A low wall along both sides of the road, just outside the barrier (Taketomi's coral stone). */
  wall?: { color: number; h: number };
  /** Things floating over the town (Göreme's balloons): how many, and their height over the ground and distance from the road (m). */
  sky?: { geo: () => THREE.BufferGeometry[]; n: number; h: [number, number]; d: [number, number] };
  /** Huts on stilts in the shallows (Hallstatt's boathouses). */
  shore?: { geo: () => THREE.BufferGeometry; n: number };
}

// --- Taketomi (Okinawa): low houses of white plaster under red Ryukyu tiles striped with white mortar, a shisa lion on
// the ridge, each in its coral-stone yard wall; water-buffalo carts; the Nagomi lookout.

function ryukyu(wall: number, roof: number) {
  const parts = [block(8, 2.8, 6.5, wall), box(8.06, 0.5, 6.56, 0, 0.25, 0, 0x8a7a66), hip(10, 8.4, 2.3, 2.8, roof)];
  // White mortar along the hips and ridge.
  parts.push(box(2.4, 0.18, 0.22, 0, 5.1, 0, 0xf2eee6));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(tint(new THREE.BoxGeometry(0.16, 0.16, 4.2).rotateY(Math.atan2(sx * 5, sz * 4.2)).rotateX(sz * 0.25).translate(sx * 2.6, 3.9, sz * 2.1), 0xf2eee6));
  // The shisa on the ridge, facing the road.
  parts.push(box(0.4, 0.45, 0.55, 0, 5.4, -0.1, 0xc8642e), box(0.36, 0.3, 0.3, 0, 5.75, -0.32, 0xd47234));
  parts.push(box(1.4, 2.0, 0.1, 0, 1.0, -3.28, 0x5a4030));
  // The yard's coral-stone wall, open at the front gate.
  const stone = 0xd6cfbf;
  parts.push(box(13, 1.3, 0.6, 0, 0.65, 5.6, stone), box(0.6, 1.3, 11.8, -6.2, 0.65, 0, stone), box(0.6, 1.3, 11.8, 6.2, 0.65, 0, stone));
  parts.push(box(5.4, 1.3, 0.6, -3.8, 0.65, -5.6, stone), box(5.4, 1.3, 0.6, 3.8, 0.65, -5.6, stone));
  // Hibiscus by the gate.
  for (const x of [-1.6, 1.6]) parts.push(tint(new THREE.IcosahedronGeometry(0.75, 0).translate(x, 0.8, -4.9), 0x2f6b2a), tint(new THREE.IcosahedronGeometry(0.25, 0).translate(x + 0.3, 1.25, -5.3), 0xe0283c));
  return merge(parts);
}
const ryukyuWindows = () => merge([box(1.6, 1.0, 0.1, -2.6, 1.6, -3.27, 0xffc98a), box(1.6, 1.0, 0.1, 2.6, 1.6, -3.27, 0xffc98a)]);

function buffaloCart() {
  const parts = [
    // The water buffalo: body, head, horns, legs.
    box(1.0, 1.0, 2.0, 0, 1.2, -2.6, 0x3b3631),
    box(0.6, 0.6, 0.7, 0, 1.3, -3.9, 0x45403a),
    tint(new THREE.TorusGeometry(0.42, 0.06, 4, 10, Math.PI).translate(0, 1.65, -3.9), 0xd8cdb8),
    ...[-0.35, 0.35].flatMap((x) => [box(0.22, 0.8, 0.22, x, 0.4, -1.9, 0x2e2a26), box(0.22, 0.8, 0.22, x, 0.4, -3.3, 0x2e2a26)]),
    // The cart: a bed with benches, wheels and a red-tiled canopy on posts.
    box(2.2, 0.25, 3.2, 0, 0.95, 0.4, 0x7a5a3c),
    box(2.2, 0.5, 0.15, 0, 1.3, 2.0, 0x6a4a30),
    ...[-0.95, 0.95].map((x) => tint(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 10).rotateZ(Math.PI / 2).translate(x * 1.25, 0.55, 0.4), 0x4a3424)),
    ...[-1, 1].flatMap((x) => [box(0.1, 1.6, 0.1, x * 1.0, 1.85, -1.0, 0x5a4030), box(0.1, 1.6, 0.1, x * 1.0, 1.85, 1.8, 0x5a4030)]),
    hip(2.6, 3.4, 0.6, 2.65, 0xc4462e),
  ];
  return merge(parts);
}

function nagomiTower() {
  return merge([block(5, 4.5, 5, 0xd6cfbf), box(5.4, 0.3, 5.4, 0, 4.6, 0, 0xc9c1af), ...[-1, 1].flatMap((x) => [box(0.3, 2.4, 0.3, x * 2, 5.9, -2, 0x8a3a24), box(0.3, 2.4, 0.3, x * 2, 5.9, 2, 0x8a3a24)]), hip(6, 6, 1.8, 7.1, 0xc4462e), box(0.5, 0.5, 0.6, 0, 9.0, 0, 0xc8642e)]);
}

// --- Hallstatt: tall pastel houses under steep dark gables, timber top floors and balconies; the white church with
// its needle spire by the water; boathouses on stilts.

function chalet(wall: number, floors: number) {
  const h = floors * 2.9;
  const parts = [block(7.5, h, 8, wall), box(7.6, 2.4, 8.1, 0, h - 1.2, 0, 0x7a5236), gable(9.4, 8.8, 4.6, h, 0x463833).rotateY(Math.PI / 2)];
  // A wooden balcony across the front of the first floor, and window shutters.
  parts.push(box(6.6, 0.18, 1.0, 0, 3.1, -4.5, 0x6a4630), box(6.6, 0.9, 0.08, 0, 3.6, -4.96, 0x6a4630));
  for (const x of [-2.2, 0, 2.2]) parts.push(box(0.3, 1.2, 0.08, x - 0.7, 4.6, -4.03, 0x2f4a3a), box(0.3, 1.2, 0.08, x + 0.7, 4.6, -4.03, 0x2f4a3a));
  parts.push(box(1.3, 2.2, 0.1, 0, 1.1, -4.03, 0x4a3324));
  return merge(parts);
}
const chaletWindows = () => merge([-2.2, 0, 2.2].map((x) => box(1.0, 1.2, 0.08, x, 4.6, -4.02, 0xffd29a)));

function spireChurch() {
  return merge([
    block(8, 9, 16, 0xf3efe6, 0),
    gable(16.6, 8.8, 4, 9, 0x3d4744).rotateY(Math.PI / 2),
    box(5, 22 + SINK, 5, 0, 11 - SINK / 2, -9.5, 0xf6f2ea),
    box(1.2, 1.6, 0.1, 0, 17, -12.06, 0x23272a),
    tint(new THREE.ConeGeometry(3.3, 16, 8).translate(0, 30, -9.5), 0x3d4a48),
    box(0.15, 1.6, 0.15, 0, 38.8, -9.5, 0xd8b04a),
  ]);
}

function boathouse() {
  return merge([
    ...[-2, 2].flatMap((x) => [-3, 0, 3].map((z) => box(0.25, 3, 0.25, x, -0.5, z, 0x4a3828))),
    box(5, 2.4, 8, 0, 2.2, 0, 0x6e4b30),
    gable(8.8, 5.8, 2.2, 3.4, 0x4a3a33).rotateY(Math.PI / 2),
    box(3, 1.8, 0.1, 0, 1.9, -4.02, 0x2a2018),
  ]);
}

// --- Göreme (Cappadocia): cave houses cut into the pale tuff, fairy chimneys with dark caps, the rock castle, and
// hot-air balloons at sunrise.

const TUFF = [0xdcc7a2, 0xd2b88e, 0xe3d1b0];

function caveHouse(stone: number, tall: boolean) {
  const parts = [block(7, 4.5, 6, stone)];
  if (tall) parts.push(box(4.6, 3.2, 4.2, 1, 6.1, 0.6, stone));
  parts.push(box(1.3, 2.1, 0.1, -1.2, 1.05, -3.02, 0x3a2a20), tint(new THREE.CylinderGeometry(0.65, 0.65, 0.1, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(-1.2, 2.1, -3.02), 0x3a2a20));
  parts.push(box(7.2, 0.25, 6.2, 0, 4.6, 0, 0xc4ad86));
  return merge(parts);
}
const caveWindows = () => merge([box(0.8, 0.8, 0.08, 1.6, 2.5, -3.02, 0xffc070), box(0.8, 0.8, 0.08, 1.4, 6.4, -1.5, 0xffc070)]);

function fairyChimneys() {
  // A cluster of three: tall cones of tuff, each under a dark basalt cap.
  const parts: THREE.BufferGeometry[] = [];
  const spots: [number, number, number, number][] = [[0, 0, 3.6, 22], [6, 3.5, 2.8, 16], [-5, 4, 2.4, 12]];
  for (const [x, z, r, h] of spots) {
    parts.push(shade(tint(new THREE.CylinderGeometry(r * 0.32, r, h + SINK, 9, 3).translate(x, (h - SINK) / 2, z), TUFF[(x > 0 ? 1 : 0) + (z > 2 ? 1 : 0)] ?? TUFF[0]), -SINK, h, 0.8, 1.08));
    parts.push(tint(new THREE.ConeGeometry(r * 0.62, r * 0.9, 9).translate(x, h + r * 0.38, z), 0x6b5848));
    parts.push(box(0.6, 0.9, 0.1, x, h * 0.35, z - r * 0.75, 0x3a2a20));
  }
  return merge(parts);
}

function rockCastle() {
  const parts = [shade(tint(new THREE.CylinderGeometry(9, 20, 34 + SINK, 10, 4).translate(0, 17 - SINK / 2, 0), 0xd8c39c), -SINK, 34, 0.75, 1.1), tint(new THREE.ConeGeometry(9.5, 8, 10).translate(0, 38, 0), 0xcdb48c)];
  // Windows and doors cut into it all the way round.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const y = 6 + (k % 5) * 5.5;
    const r = 20 - (y / 34) * 11 + 0.05;
    parts.push(box(1.1, 1.5, 0.2, 0, y, r, 0x3a2a20).rotateY(a));
  }
  return merge(parts);
}

const BALLOON_COLOURS: number[][] = [
  [0xe5484d, 0xffd84a],
  [0x2f7fd0, 0xf2f2f2],
  [0xff8a3d, 0x7a3cc8],
  [0x3ddc84, 0xffd84a],
  [0xe5484d, 0x2f4fb0],
  [0xff5ca8, 0xffffff],
];

/** Hot-air balloons: a striped envelope (each colour scheme its own template), a wicker basket and its ropes. */
function balloons(): THREE.BufferGeometry[] {
  return BALLOON_COLOURS.map(([a, b]) => {
    const env = new THREE.SphereGeometry(7, 12, 10).scale(1, 1.18, 1).translate(0, 16, 0);
    const p = env.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const ca = new THREE.Color(a);
    const cb = new THREE.Color(b);
    for (let i = 0; i < p.count; i++) {
      const band = Math.floor(((Math.atan2(p.getZ(i), p.getX(i)) + Math.PI) / (Math.PI * 2)) * 12 + 0.5) % 2;
      const c = band ? ca : cb;
      col.set([c.r, c.g, c.b], i * 3);
    }
    env.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const skirt = tint(new THREE.CylinderGeometry(2.6, 1.2, 3, 12, 1, true).translate(0, 6.8, 0), a);
    const basket = box(1.6, 1.1, 1.6, 0, 0.55, 0, 0x8a6236);
    const ropes = [-1, 1].flatMap((x) => [-1, 1].map((z) => tint(new THREE.CylinderGeometry(0.03, 0.03, 4.4, 3).rotateZ(-x * 0.06).rotateX(z * 0.06).translate(x * 0.9, 3.2, z * 0.9), 0x2a2420)));
    return merge([env, skirt, basket, ...ropes]);
  });
}

// --- Oia (Santorini): whitewashed cube houses stacked down the caldera, blue doors and shutters, blue-domed chapels and
// the windmills on the ridge.

function cube(wall: number, two: boolean) {
  const h = two ? 5.8 : 3.2;
  const parts = [block(6.5, h, 6, wall), box(6.8, 0.35, 6.3, 0, h + 0.15, 0, 0xffffff)];
  if (two) parts.push(box(3.4, 0.9, 0.1, -1.4, h - 1.6, -3.02, 0x2457a6));
  parts.push(box(1.1, 2.0, 0.1, 1.6, 1.0, -3.02, 0x2457a6), box(0.9, 0.9, 0.1, -1.6, 1.6, -3.02, 0x2457a6));
  // A rounded white chimney or a little vault on some.
  parts.push(tint(new THREE.CylinderGeometry(3, 3, 6.5, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 0.95).translate(0, h + 0.3, 0.2), 0xfbfbf8));
  return merge(parts);
}
const cubeWindows = () => merge([box(0.7, 0.7, 0.08, -1.6, 1.6, -3.01, 0xffd9a0)]);

function blueDome() {
  return merge([
    block(6.5, 6, 6.5, 0xfbfbf8),
    cyl(2.9, 2.9, 1.2, 14, 0, 6.6, 0, 0xfbfbf8),
    tint(new THREE.SphereGeometry(3, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 7.2, 0), 0x2457a6),
    box(0.15, 1.2, 0.15, 0, 10.8, 0, 0xf2f2f2),
    box(0.8, 0.15, 0.15, 0, 11.0, 0, 0xf2f2f2),
    // The bell gable over the door.
    box(3, 3, 0.6, 0, 7.5, -3.0, 0xfbfbf8),
    box(0.9, 1.2, 0.7, 0, 7.6, -3.0, 0x23272a),
    box(1.4, 2.4, 0.1, 0, 1.2, -3.27, 0x2457a6),
  ]);
}

function oiaWindmill() {
  const parts = [cyl(3, 2.6, 8 + SINK, 12, 0, (8 - SINK) / 2, 0, 0xfbfbf8), tint(new THREE.ConeGeometry(3.1, 3, 12).translate(0, 9.5, 0), 0xb8a070)];
  // Six sails on a hub on the front.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(tint(new THREE.BoxGeometry(0.18, 6.5, 0.12).translate(0, 3.6, 0).rotateZ(a).translate(0, 8.4, -3.2), 0x6e5a40));
    parts.push(tint(new THREE.BoxGeometry(1.4, 4.2, 0.05).translate(0.75, 4.4, 0).rotateZ(a).translate(0, 8.4, -3.3), 0xf2ece0));
  }
  return merge(parts);
}

// --- Chefchaouen: blue-washed houses up the mountainside (every shade of blue, a darker band at the foot, white
// parapets, pots of geraniums), the minarets, and the red-ochre kasbah.

function blueHouse(wall: number, floors: number) {
  const h = floors * 3;
  const foot = new THREE.Color(wall).multiplyScalar(0.72).getHex();
  const parts = [block(7, h, 6.5, wall), box(7.06, 1.0, 6.56, 0, 0.5, 0, foot), box(7.3, 0.45, 6.8, 0, h + 0.2, 0, 0xf4f4f0)];
  parts.push(box(1.3, 2.2, 0.1, -1.6, 1.1, -3.27, 0x1d4f8a), box(0.12, 2.5, 0.12, -1.6, 2.3, -3.3, 0xf4f4f0));
  for (let f = 1; f < floors; f++) parts.push(box(0.9, 1.1, 0.1, 1.6, f * 3 + 1.3, -3.27, 0x1d4f8a));
  // Potted geraniums on the step.
  parts.push(box(0.4, 0.4, 0.4, 0.6, 0.2, -3.6, 0xb4583b), tint(new THREE.IcosahedronGeometry(0.32, 0).translate(0.6, 0.6, -3.6), 0xd8283c));
  return merge(parts);
}
const blueWindows = () => merge([box(0.9, 1.1, 0.08, 1.6, 1.6, -3.26, 0xffd29a)]);

function minaret() {
  return merge([block(4.4, 20, 4.4, 0xe9dcc0), box(5.2, 0.6, 5.2, 0, 16.5, 0, 0x2f7a55), box(5.2, 0.6, 5.2, 0, 20.2, 0, 0x2f7a55), box(2.6, 3.2, 2.6, 0, 22.1, 0, 0xe9dcc0), hip(3.2, 3.2, 2.2, 23.7, 0x2f7a55), box(0.12, 1.4, 0.12, 0, 26.6, 0, 0xd8b04a), box(0.9, 1.6, 0.1, 0, 12, -2.22, 0x2a2420)]);
}

function kasbah() {
  const ochre = 0xb8653c;
  const parts = [block(22, 7, 22, ochre)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(block(5, 11, 5, 0xa85a34).translate(sx * 10.5, 0, sz * 10.5));
  parts.push(block(6, 16, 6, 0xa85a34).translate(0, 0, 6));
  // Crenellations along the front wall.
  for (let k = 0; k < 7; k++) parts.push(box(1, 0.8, 0.6, -7.5 + k * 2.5, 7.4, -10.8, ochre));
  parts.push(box(3, 4, 0.2, 0, 2, -11.05, 0x2a2018));
  return merge(parts);
}

// --- The towns

const variants = <T>(list: T[], make: (x: T) => TownHouse) => list.map(make);

export const TOWNS: Partial<Record<TrackId, Town>> = {
  taketomi: {
    houses: variants([0xf3ede0, 0xe9e2d2, 0xf6f1e8], (wall) => ({ geo: () => ryukyu(wall, wall === 0xe9e2d2 ? 0xb03e28 : 0xc4462e), win: ryukyuWindows, w: 13, d: 12 })),
    every: 13,
    gap: 2,
    depth: 13.5,
    rows: 3,
    fill: 0.9,
    flat: 1.8,
    wall: { color: 0xd6cfbf, h: 1.25 },
    marks: [
      { geo: nagomiTower, r: 5, near: 12, far: 60, flat: 2, n: 1, at: 'high' },
      { geo: buffaloCart, r: 4, near: 2.5, far: 8, flat: 1, n: 4, at: 'any' },
    ],
  },
  hallstatt: {
    houses: [0xf2e3c6, 0xe9c4a6, 0xd8e2d0, 0xf5f0e6, 0xe7d38f].map((wall, k) => ({ geo: () => chalet(wall, 3 + (k % 2)), win: chaletWindows, w: 9, d: 9.5 })),
    every: 13,
    gap: 5,
    depth: 13,
    rows: 3,
    fill: 0.7,
    flat: 3.5,
    marks: [{ geo: spireChurch, r: 11, near: 6, far: 60, flat: 3, n: 1, at: 'low' }],
    shore: { geo: boathouse, n: 9 },
  },
  goreme: {
    houses: [0, 1, 2].flatMap((k) => [{ geo: () => caveHouse(TUFF[k], false), win: caveWindows, w: 7.5, d: 6.5 }, { geo: () => caveHouse(TUFF[k], true), win: caveWindows, w: 7.5, d: 6.5 }]),
    every: 22,
    gap: 6,
    depth: 16,
    rows: 2,
    fill: 0.45,
    flat: 3,
    marks: [
      { geo: rockCastle, r: 22, near: 40, far: 220, flat: 9, n: 1, at: 'high' },
      { geo: fairyChimneys, r: 9, near: 6, far: 260, flat: 7, n: 40, at: 'any' },
    ],
    sky: { geo: balloons, n: 28, h: [35, 260], d: [40, 1100] },
  },
  oia: {
    houses: [0xfbfbf8, 0xf7f5ef, 0xfbfbf8, 0xf0dcb8, 0xeec0aa].flatMap((wall) => [{ geo: () => cube(wall, false), win: cubeWindows, w: 7, d: 6.5 }, { geo: () => cube(wall, true), win: cubeWindows, w: 7, d: 6.5 }]),
    every: 11,
    gap: 4,
    depth: 10,
    rows: 4,
    fill: 0.75,
    flat: 4.5,
    marks: [
      { geo: blueDome, r: 6, near: 4, far: 50, flat: 3, n: 4, at: 'any' },
      { geo: oiaWindmill, r: 5, near: 8, far: 90, flat: 3, n: 3, at: 'high' },
    ],
  },
  chefchaouen: {
    houses: [0x3f7fd0, 0x5b9be0, 0x2f6cb8, 0x8fc0ee, 0x4f8fda].map((wall, k) => ({ geo: () => blueHouse(wall, 2 + (k % 3 === 0 ? 1 : 0)), win: blueWindows, w: 7.5, d: 7 })),
    every: 10,
    gap: 3.5,
    depth: 10,
    rows: 4,
    fill: 0.85,
    flat: 4.5,
    marks: [
      { geo: minaret, r: 4, near: 10, far: 80, flat: 3, n: 2, at: 'high' },
      { geo: kasbah, r: 18, near: 10, far: 90, flat: 6, n: 1, at: 'any' },
    ],
  },
};
