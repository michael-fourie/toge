import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROPS } from '../shared/foundry.ts';
import { canvas, rng, softDot, toTexture } from './textures.ts';

// The Foundry's odd corners, all for looks (the colliders are in shared/foundry.ts): chibi mannequins in the Showroom
// (one of them watches you), a ghost haunting the Break Room's vending machine, desks and a giant paper plane in the
// Drafting Loft, the broken gear and a clock that runs backwards, frozen fish and daikon in Cold Storage, a flooded
// corner with rubber ducks, the Duck Shrine, glowing mushrooms in the Old Drain, rails and a mine cart, soot sprites
// hopping about in the dark, and graffiti. Built for speed: every static prop is one vertex-coloured mesh, every glowing
// bit another; only a handful of small things move.

type Toon = (p: THREE.MeshToonMaterialParameters) => THREE.MeshToonMaterial;
export interface Decor {
  update(time: number, viewer: THREE.Vector3): void;
}

const CELLAR = -6;
const LOFT = 5;

/** A coloured, positioned copy of a geometry, ready to merge with the rest (no UVs, flat colour in vertex colours). */
function piece(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.deleteAttribute('uv');
  out.rotateY(ry);
  out.translate(x, y, z);
  const c = new THREE.Color(color);
  const col = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg);
const ball = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz);

/** Graffiti and painted notes: one texture holding every message, one cell each. */
const NOTES = [
  { lines: ["THEY CAN'T CLIMB", '(they can)'], color: '#f4e9c8' },
  { lines: ['←  DUCKS'], color: '#ffd84a' },
  { lines: ['SPRING COLLECTION', "'87"], color: '#ffb8d0' },
  { lines: ["BARRY'S LUNCH", 'DO NOT EAT'], color: '#20242a' },
  { lines: ['THE DUCK', 'PROVIDES'], color: '#ffd84a' },
  { lines: ['FLOOR IS LAVA?'], color: '#ff9a6a' },
  { lines: ['MIND THE GAP'], color: '#e6f0ff' },
  { lines: ["IT'S ALWAYS", '3 AM HERE'], color: '#b8f0ff' },
];
function notesTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  g.clearRect(0, 0, 1024, 1024);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  NOTES.forEach((n, i) => {
    const cx = (i % 2) * 512 + 256;
    const cy = Math.floor(i / 2) * 256 + 128;
    if (i === 3) {
      g.fillStyle = '#fff6a8'; // a sticky note
      g.fillRect(cx - 200, cy - 100, 400, 200);
    }
    g.fillStyle = n.color;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 6;
    n.lines.forEach((line, k) => {
      const size = k === 0 ? 64 : 46;
      g.font = `italic 900 ${size}px 'Comic Sans MS', 'Marker Felt', 'Arial Black', sans-serif`;
      const y = cy + (k - (n.lines.length - 1) / 2) * 70;
      if (i !== 3) g.strokeText(line, cx, y);
      g.fillText(line, cx, y);
    });
  });
  return toTexture(c, renderer, false);
}

/** A soot sprite: a black fuzzball with two white eyes. */
function sootTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const r = rng(5);
  g.fillStyle = '#0b0b10';
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2;
    const d = 16 + r() * 12;
    g.beginPath();
    g.arc(32 + Math.cos(a) * d * 0.6, 34 + Math.sin(a) * d * 0.6, 4 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(32, 34, 18, 0, Math.PI * 2);
  g.fill();
  for (const x of [25, 39]) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x, 31, 5.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(x + 1, 32, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, renderer, false);
}

/** The Break Room's ghost: a friendly white blob with a little wail. */
function ghostTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const [c, g] = canvas(128);
  const grad = g.createRadialGradient(64, 56, 10, 64, 64, 60);
  grad.addColorStop(0, 'rgba(240,250,255,0.95)');
  grad.addColorStop(1, 'rgba(200,230,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 54, 40, Math.PI, 0);
  g.lineTo(104, 100);
  for (let x = 104; x >= 24; x -= 16) g.quadraticCurveTo(x - 4, 116, x - 8, 100);
  g.closePath();
  g.fill();
  g.fillStyle = '#1b2440';
  for (const x of [50, 78]) {
    g.beginPath();
    g.ellipse(x, 52, 6, 9, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.ellipse(64, 74, 7, 9, 0, 0, Math.PI * 2);
  g.fill();
  return toTexture(c, renderer, false);
}

export function buildDecor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, toon: Toon): Decor {
  const r = rng(13);
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const S = (g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, ry = 0) => solid.push(piece(g, c, x, y, z, ry));
  const G = (g: THREE.BufferGeometry, c: number, x: number, y: number, z: number, ry = 0) => glow.push(piece(g, c, x, y, z, ry));
  const duck = (x: number, y: number, z: number, k = 1, ry = 0) => {
    S(ball(0.16 * k, 1.25, 0.8, 1), 0xffd23a, x, y + 0.12 * k, z, ry);
    S(ball(0.1 * k), 0xffd23a, x + Math.sin(ry) * 0.12 * k, y + 0.3 * k, z + Math.cos(ry) * 0.12 * k);
    S(new THREE.ConeGeometry(0.04 * k, 0.1 * k, 6).rotateX(Math.PI / 2), 0xff8a22, x + Math.sin(ry) * 0.22 * k, y + 0.29 * k, z + Math.cos(ry) * 0.22 * k, ry);
  };

  // --- The Showroom: chibi mannequins in their spring best, racks of clothes along the wall ---
  const pastel = [0xf2a7b8, 0x9fd3c7, 0xf7d58c, 0xb6a7e8, 0xf0b38c];
  PROPS.mannequins.forEach(([x, z], i) => {
    const ry = r() * Math.PI * 2;
    S(cyl(0.42, 0.48, 0.22, 16), 0x6d5a4a, x, 0.11, z);
    for (const s of [-0.1, 0.1]) S(cyl(0.065, 0.06, 0.75), 0xe8d8c0, x + Math.cos(ry) * s, 0.6, z - Math.sin(ry) * s);
    S(cyl(0.21, 0.16, 0.62, 12), i % 2 ? pastel[i % pastel.length] : 0xe8d8c0, x, 1.28, z);
    for (const s of [-0.27, 0.27]) S(cyl(0.05, 0.045, 0.58), 0xe8d8c0, x + Math.cos(ry) * s, 1.28, z - Math.sin(ry) * s);
    if (i === PROPS.mannequins.length - 1) return; // the one by the door has a head of its own (below)
    S(ball(0.27), 0xefe2cc, x, 1.86, z);
    if (i % 3 === 0) S(new THREE.ConeGeometry(0.2, 0.42, 10), pastel[(i + 2) % pastel.length], x, 2.28, z); // a party hat
    if (i % 3 === 1) S(new THREE.TorusGeometry(0.17, 0.06, 6, 14).rotateX(Math.PI / 2), 0xd23c33, x, 1.6, z); // a scarf
    if (i % 3 === 2) S(new THREE.ConeGeometry(0.42, 0.7, 14, 1, true), pastel[(i + 1) % pastel.length], x, 0.95, z); // a skirt
  });
  for (const [z0, z1] of [[-61, -56], [-49.5, -46]]) {
    S(box(0.08, 1.7, 0.08), 0x3a3f47, -29.3, 0.85, z0);
    S(box(0.08, 1.7, 0.08), 0x3a3f47, -29.3, 0.85, z1);
    S(box(0.05, 0.05, z1 - z0), 0x8a8f99, -29.3, 1.68, (z0 + z1) / 2);
    for (let z = z0 + 0.3; z < z1 - 0.2; z += 0.38) S(box(0.5, 0.75, 0.12), pastel[Math.floor(r() * pastel.length)], -29.3, 1.22, z);
  }
  S(box(0.45, 0.3, 0.35), 0x3a3f47, -28.6, 1.25, -45.5); // a cash register on the counter
  S(box(0.4, 0.06, 0.25), 0xc9a02f, -28.6, 1.43, -45.5);

  // --- The Break Room: a sagging couch, tables and chairs, the fridge, the haunted vending machine, a dumbwaiter ---
  const cb = PROPS.couch;
  const cmid = (cb.min.x + cb.max.x) / 2;
  S(box(cb.max.x - cb.min.x, 0.45, cb.max.z - cb.min.z), 0x7a4a6a, cmid, 0.22, (cb.min.z + cb.max.z) / 2);
  S(box(cb.max.x - cb.min.x, 0.9, 0.3), 0x6a3a5a, cmid, 0.7, cb.max.z - 0.15);
  for (const x of [cb.min.x + 0.15, cb.max.x - 0.15]) S(box(0.3, 0.7, cb.max.z - cb.min.z), 0x6a3a5a, x, 0.35, (cb.min.z + cb.max.z) / 2);
  for (let k = 0; k < 3; k++) S(box(1.5, 0.18, 0.9), 0x8a5a7a, cb.min.x + 0.9 + k * 1.6, 0.52, (cb.min.z + cb.max.z) / 2 - 0.1);
  PROPS.tables.forEach(([x, z], i) => {
    S(box(2, 0.08, 1.2), 0xb08a5a, x, 0.76, z);
    for (const [dx, dz] of [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]]) S(box(0.07, 0.72, 0.07), 0x3a3f47, x + dx, 0.36, z + dz);
    for (const s of [-1, 1]) {
      S(box(0.45, 0.06, 0.45), 0xc9563c, x + s * 0.5, 0.46, z + s * 1.0);
      S(box(0.45, 0.5, 0.06), 0xc9563c, x + s * 0.5, 0.72, z + s * 1.22);
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) S(box(0.04, 0.44, 0.04), 0x3a3f47, x + s * 0.5 + dx, 0.22, z + s * 1.0 + dz);
    }
    if (i === 0) {
      S(cyl(0.11, 0.13, 0.26), 0x2b2f36, x - 0.4, 0.93, z); // the coffee pot
      S(cyl(0.12, 0.12, 0.03), 0xe85a3c, x - 0.4, 0.82, z);
      for (let k = 0; k < 4; k++) S(cyl(0.05, 0.045, 0.1), 0xf4ecd8, x + 0.2 + k * 0.18, 0.85, z + (k % 2) * 0.2 - 0.1); // mugs
    }
  });
  const fr = PROPS.fridge;
  S(box(fr.max.x - fr.min.x, 2.2, fr.max.z - fr.min.z), 0xe4ecee, (fr.min.x + fr.max.x) / 2, 1.1, (fr.min.z + fr.max.z) / 2);
  S(box(0.06, 0.6, 0.06), 0x8a8f99, fr.max.x - 0.15, 1.3, fr.max.z + 0.04);
  S(box(fr.max.x - fr.min.x - 0.05, 0.03, 0.02), 0x9aa4a8, (fr.min.x + fr.max.x) / 2, 1.55, fr.max.z + 0.01);
  const vm = PROPS.vending;
  const vx = (vm.min.x + vm.max.x) / 2;
  S(box(vm.max.x - vm.min.x, 2.2, vm.max.z - vm.min.z), 0x234a5a, vx, 1.1, (vm.min.z + vm.max.z) / 2);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), new THREE.MeshBasicMaterial({ color: 0x9ff5ff }));
  panel.position.set(vx - 0.1, 1.3, vm.max.z + 0.02);
  scene.add(panel);
  for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) S(box(0.16, 0.22, 0.05), pastel[(row + k) % pastel.length], vx - 0.45 + k * 0.23, 0.82 + row * 0.33, vm.max.z + 0.05);
  S(box(0.2, 0.5, 0.05), 0xd9d2b8, vm.max.x - 0.15, 1.35, vm.max.z + 0.03); // the coin slot plate
  S(box(1.4, 1.1, 0.1), 0x3a3f47, 10.36, 1.4, -60, Math.PI / 2); // the dumbwaiter's hatch in the west wall
  S(box(1.1, 0.8, 0.05), 0x0b0d12, 10.42, 1.4, -60, Math.PI / 2);
  S(cyl(0.02, 0.02, 1.3), 0xb8a070, 10.5, 1.2, -60.3);
  const ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: ghostTexture(renderer), transparent: true, depthWrite: false, opacity: 0.8 }));
  ghost.scale.set(1.1, 1.1, 1);
  scene.add(ghost);

  // --- The Drafting Loft: desks with blueprints and lamps, stools, a giant paper plane overhead ---
  PROPS.desks.forEach(([x, z], i) => {
    S(box(2.2, 0.06, 1.1), 0x8a6a48, x, LOFT + 0.77, z);
    for (const [dx, dz] of [[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]]) S(box(0.06, 0.74, 0.06), 0x4a3a2a, x + dx, LOFT + 0.37, z + dz);
    S(box(1.3, 0.01, 0.8), i % 2 ? 0x5f8fd0 : 0xe8e0c8, x - 0.2, LOFT + 0.81, z, (r() - 0.5) * 0.3);
    S(cyl(0.02, 0.02, 0.5), 0x3a3f47, x + 0.85, LOFT + 1.05, z - 0.35);
    S(new THREE.ConeGeometry(0.14, 0.16, 10, 1, true), 0x2f6f5a, x + 0.75, LOFT + 1.3, z - 0.35);
    G(ball(0.06), 0xffe2a8, x + 0.75, LOFT + 1.24, z - 0.35);
    S(cyl(0.2, 0.2, 0.05, 10), 0x3a3f47, x, LOFT + 0.55, z + 0.9);
    S(cyl(0.03, 0.03, 0.55), 0x3a3f47, x, LOFT + 0.27, z + 0.9);
  });
  const plane = new THREE.BufferGeometry();
  plane.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -1.8, -1.3, 0.05, 1.2, 0, -0.35, 1.2, 0, 0, -1.8, 0, -0.35, 1.2, 1.3, 0.05, 1.2]), 3));
  plane.computeVertexNormals();
  plane.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
  S(plane, 0xf4f0e6, -16, 8.3, -60, 0.6);
  S(cyl(0.01, 0.01, 1.6, 4), 0x8a8f99, -16, 9.1, -60);
  for (let k = 0; k < 4; k++) S(box(1.2, 0.8, 0.03), k % 2 ? 0x5f8fd0 : 0xe8e0c8, -24 + k * 1.5, LOFT + 2.2, -69.68); // blueprints pinned up

  // --- The Clock Room: the broken gear you walk through, a clock face that runs backwards, a pendulum ---
  const gear = PROPS.gear;
  const ringR = (gear.inner + gear.outer) / 2;
  S(new THREE.TorusGeometry(ringR, (gear.outer - gear.inner) / 2, 10, 48, Math.PI * 2 * 0.86).rotateZ(-0.35).rotateY(Math.PI / 2), 0xb88a3a, gear.x, gear.y, gear.z);
  for (let k = 0; k < 22; k++) {
    const a = -0.35 + (k / 22) * Math.PI * 2 * 0.86;
    const t = box(0.45, 0.55, 0.5).rotateX(-a);
    S(t, 0xa07a30, gear.x, gear.y + Math.sin(a) * (gear.outer + 0.2), gear.z + Math.cos(a) * (gear.outer + 0.2));
  }
  S(box(0.5, 0.5, 1.4).rotateX(0.4), 0xb88a3a, gear.x + 2.5, LOFT + 0.3, gear.z + 3.8); // the bit that broke off
  const clockY = 7.6;
  const clockZ = -57;
  G(new THREE.CircleGeometry(2, 32).rotateY(-Math.PI / 2), 0xf3ead2, 29.66, clockY, clockZ);
  S(new THREE.TorusGeometry(2, 0.14, 8, 32).rotateY(Math.PI / 2), 0xb88a3a, 29.64, clockY, clockZ);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    S(box(0.04, k % 3 ? 0.18 : 0.35, 0.08), 0x2b2f36, 29.6, clockY + Math.cos(a) * 1.7, clockZ + Math.sin(a) * 1.7);
  }
  const hands = new THREE.Group();
  hands.position.set(29.58, clockY, clockZ);
  const handMat = toon({ color: 0x2b2f36 });
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.1).translate(0, 0.45, 0), handMat);
  const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.55, 0.07).translate(0, 0.7, 0), handMat);
  minHand.position.x = -0.03;
  hands.add(hourHand, minHand);
  scene.add(hands);
  const pendulum = new THREE.Group();
  pendulum.position.set(25, 10, -57);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6).translate(0, -1.3, 0), toon({ color: 0xb88a3a }));
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20).rotateZ(Math.PI / 2).translate(0, -2.8, 0), toon({ color: 0xd4a84a }));
  pendulum.add(rod, bob);
  scene.add(pendulum);

  // --- Cold Storage: ice blocks, frozen fish and daikon hanging in rows ---
  const ice = new THREE.Mesh(
    mergeGeometries(PROPS.ice.map((b) => new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z).translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2).toNonIndexed()), false),
    toon({ color: 0xbfe8ff, transparent: true, opacity: 0.72 }),
  );
  scene.add(ice);
  for (let x = -24; x <= -1; x += 2.6) {
    for (const z of [-27.5, -21.5]) {
      const fish = r() < 0.6;
      S(cyl(0.012, 0.012, 1.2, 4), 0x8a8f99, x, -1.6, z);
      if (fish) S(ball(0.13, 0.7, 3.2, 1), 0x9fb8c8, x, -2.6, z);
      else {
        S(ball(0.12, 1, 3.4, 1), 0xf4f0e6, x, -2.75, z); // a daikon
        S(new THREE.ConeGeometry(0.16, 0.35, 6), 0x5aa04a, x, -2.0, z);
      }
    }
  }

  // --- The Pump Room: pipes along the walls, ducks bobbing in the flooded corner ---
  for (const z of [-29.5, -18.5]) S(cyl(0.18, 0.18, 19.6, 10).rotateZ(Math.PI / 2), 0x5a6a6a, 12, -2.2, z);
  S(cyl(0.25, 0.25, 11.6, 10).rotateX(Math.PI / 2), 0x6a5a4a, 21.5, -1.8, -24);
  for (let k = 0; k < 5; k++) duck(18 + r() * 3.4, CELLAR + 0.05, -29 + r() * 4, 0.9, r() * 6);

  // --- The Duck Shrine: a giant duck on the altar, ducks along the walls, candles ---
  const al = PROPS.altar;
  const ax = (al.min.x + al.max.x) / 2;
  const az = (al.min.z + al.max.z) / 2;
  S(box(al.max.x - al.min.x + 0.1, 0.06, al.max.z - al.min.z + 0.1), 0xb23a2f, ax, al.max.y + 0.03, az);
  S(box(0.04, 0.9, al.max.z - al.min.z + 0.1), 0xb23a2f, al.min.x - 0.03, al.max.y - 0.45, az);
  duck(ax, al.max.y + 0.06, az, 3.2, -Math.PI / 2);
  for (let k = 0; k < 14; k++) duck(22.6 + k * 0.38, CELLAR, -28.4, 0.8, 0);
  for (let k = 0; k < 10; k++) duck(22.6 + k * 0.38, CELLAR, -23.6, 0.8, Math.PI);
  for (let k = 0; k < 8; k++) {
    const x = ax - 0.2 + (k % 2) * 0.4;
    const z = al.min.z - 0.3 + (k >> 1) * 0.9;
    S(cyl(0.04, 0.04, 0.3 + (k % 3) * 0.1), 0xf4ecd8, x - 0.6, CELLAR + 0.15, z);
    G(ball(0.05, 1, 1.6, 1), 0xffc060, x - 0.6, CELLAR + 0.38 + (k % 3) * 0.1, z);
  }

  // --- The Old Drain: glowing mushrooms along its walls ---
  for (let k = 0; k < 18; k++) {
    const x = k % 2 ? -15.6 : -10.4;
    const z = -48 + r() * 17;
    const h = 0.15 + r() * 0.25;
    S(cyl(0.03, 0.04, h, 5), 0xe8e0c8, x, CELLAR + h / 2, z);
    G(ball(0.1 + r() * 0.08, 1, 0.5, 1), r() < 0.5 ? 0x7af0c8 : 0x9fd0ff, x, CELLAR + h, z);
  }

  // --- The Rail Tunnel: rails and sleepers, the mine cart, lanterns ---
  for (const x of [6.2, 7.8]) S(box(0.08, 0.08, 19.4), 0x7a7f88, x, CELLAR + 0.12, -40);
  for (let z = -49.6; z < -30.4; z += 0.8) S(box(2.2, 0.06, 0.25), 0x5a4030, 7, CELLAR + 0.04, z);
  const cart = PROPS.cart;
  const cx = (cart.min.x + cart.max.x) / 2;
  const cz = (cart.min.z + cart.max.z) / 2;
  S(box(cart.max.x - cart.min.x, 0.75, cart.max.z - cart.min.z), 0x8a5a3a, cx, CELLAR + 0.65, cz);
  S(box(cart.max.x - cart.min.x - 0.2, 0.2, cart.max.z - cart.min.z - 0.2), 0x1b1b20, cx, CELLAR + 1.0, cz); // coal
  for (const [dx, dz] of [[-0.6, -0.9], [0.6, -0.9], [-0.6, 0.9], [0.6, 0.9]]) S(cyl(0.22, 0.22, 0.1, 12).rotateZ(Math.PI / 2), 0x2b2f36, cx + dx, CELLAR + 0.22, cz + dz);
  for (const z of [-34, -42, -48]) {
    for (const x of [4.32, 9.68]) {
      S(box(0.16, 0.3, 0.16), 0x3a3f47, x, -3.4, z);
      G(box(0.1, 0.18, 0.1), 0xffc070, x, -3.42, z);
    }
  }

  // --- The Sorting Floor: parcels riding the belts ---
  for (let k = 0; k < 10; k++) S(box(0.4 + r() * 0.3, 0.3 + r() * 0.2, 0.4 + r() * 0.3), 0xb08a5a, -6 + r() * 7.5, 1.1, -54);
  for (let k = 0; k < 6; k++) S(box(0.45, 0.35, 0.45), 0xc09a6a, -7.9, 1.12, -61.5 + k * 1.0);

  // --- Graffiti and notes (one texture) ---
  const notes = notesTexture(renderer);
  const quads: THREE.BufferGeometry[] = [];
  const note = (i: number, x: number, y: number, z: number, ry: number, w: number) => {
    const g = new THREE.PlaneGeometry(w, w / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const u0 = (i % 2) * 0.5;
    const v0 = 1 - (Math.floor(i / 2) + 1) * 0.25;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.5, v0 + uv.getY(k) * 0.25);
    g.rotateY(ry);
    g.translate(x, y, z);
    quads.push(g.toNonIndexed());
  };
  note(0, -20, LOFT + 2, -44.32, Math.PI, 3.6); // THEY CAN'T CLIMB, on the Loft's south wall
  note(1, 21.66, CELLAR + 1.7, -22.2, -Math.PI / 2, 1.8); // <- DUCKS, pointing along the wall at the squeeze
  note(2, -17.6, 3.1, -44.32, Math.PI, 3.0); // the Showroom
  note(3, (fr.min.x + fr.max.x) / 2, 1.7, fr.max.z + 0.03, 0, 0.6); // Barry's lunch
  note(4, 27.68, CELLAR + 2.2, az, -Math.PI / 2, 2.6); // over the altar
  note(5, -9.68, 2.2, -58, Math.PI / 2, 2.4); // the Sorting Floor's west wall
  note(6, 4.07, 6.6, -38, Math.PI / 2, 2.4); // the Skybridge
  note(7, 10.32, LOFT + 2.6, -51, Math.PI / 2, 2.6); // the Clock Room
  const noteMesh = new THREE.Mesh(mergeGeometries(quads, false), new THREE.MeshBasicMaterial({ map: notes, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  scene.add(noteMesh);

  // --- Merge ---
  const solids = new THREE.Mesh(mergeGeometries(solid, false), toon({ color: 0xffffff, vertexColors: true }));
  solids.castShadow = true;
  solids.receiveShadow = true;
  scene.add(solids);
  scene.add(new THREE.Mesh(mergeGeometries(glow, false), new THREE.MeshBasicMaterial({ vertexColors: true })));

  // Water: the flooded corner and the drain's channel, a gentle shimmer.
  const waterMat = new THREE.MeshBasicMaterial({ color: 0x2f8f96, transparent: true, opacity: 0.55, depthWrite: false });
  const water = new THREE.Mesh(mergeGeometries(PROPS.water.map((w) => new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0).rotateX(-Math.PI / 2).translate((w.x0 + w.x1) / 2, CELLAR + 0.04, (w.z0 + w.z1) / 2).toNonIndexed()), false), waterMat);
  water.renderOrder = 1;
  scene.add(water);

  // The mannequin by the shop door that turns its head to watch you.
  const [wx, wz] = PROPS.mannequins[PROPS.mannequins.length - 1];
  const watcher = new THREE.Group();
  watcher.position.set(wx, 1.86, wz);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), toon({ color: 0xefe2cc }));
  watcher.add(face);
  for (const s of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eye.position.set(s, 0.03, -0.25);
    watcher.add(eye);
  }
  scene.add(watcher);

  // Soot sprites in the dark corners: they hop on the spot and scatter a little.
  const SOOT: [number, number, number][] = [
    [-34, 0, -13], [-35, 0, 7], [-19, 0, -31], [-35, 0, -31.2], [16.5, 0, -31], [-16.5, 0, -19],
    [3, CELLAR, -29.2], [21.2, CELLAR, -18.7], [-25.2, CELLAR, -29.3], [1.3, CELLAR, -19.6], [-15.5, CELLAR, -31], [9.3, CELLAR, -49],
    [-29.3, 0, -69.3], [9.3, 0, -69.2], [29.2, LOFT, -69.2], [-29.2, LOFT, -44.8], [3.2, CELLAR, -31], [-10.5, CELLAR, -49.4],
  ];
  const sootPos = new Float32Array(SOOT.length * 3);
  const sootGeo = new THREE.BufferGeometry();
  sootGeo.setAttribute('position', new THREE.BufferAttribute(sootPos, 3));
  scene.add(new THREE.Points(sootGeo, new THREE.PointsMaterial({ map: sootTexture(renderer), size: 0.55, transparent: true, alphaTest: 0.3, depthWrite: true })));
  const dot = softDot();
  const vendGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x7ff0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
  vendGlow.scale.set(4, 4, 1);
  vendGlow.position.set(vx, 1.4, vm.max.z + 0.6);
  scene.add(vendGlow);

  const look = new THREE.Vector3();
  return {
    update(time, viewer) {
      // The vending machine buzzes and stutters; its ghost bobs beside it, fading in and out.
      const buzz = Math.sin(time * 37) > 0.93 || (Math.sin(time * 1.3) > 0.97 && Math.sin(time * 60) > 0) ? 0.25 : 1;
      (panel.material as THREE.MeshBasicMaterial).color.setRGB(0.62 * buzz, 0.96 * buzz, buzz);
      vendGlow.material.opacity = 0.45 * buzz;
      ghost.position.set(vx + 1.6 + Math.sin(time * 0.6) * 0.5, 1.7 + Math.sin(time * 1.7) * 0.18, vm.max.z + 1.2 + Math.cos(time * 0.6) * 0.4);
      ghost.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(time * 0.9));
      // The clock runs backwards; the pendulum swings anyway.
      minHand.rotation.x = time * 0.8;
      hourHand.rotation.x = time * 0.8 / 12;
      pendulum.rotation.x = Math.sin(time * 1.6) * 0.38;
      waterMat.opacity = 0.5 + 0.08 * Math.sin(time * 1.1);
      // The watcher turns its head toward you when you are near, slowly.
      if (Math.hypot(viewer.x - wx, viewer.z - wz) < 18 && Math.abs(viewer.y - 1) < 3) {
        look.set(viewer.x - wx, 0, viewer.z - wz);
        const want = Math.atan2(-look.x, -look.z);
        let d = want - watcher.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        watcher.rotation.y += d * 0.04;
      }
      SOOT.forEach(([x, y, z], i) => {
        const ph = i * 1.7;
        const hop = Math.abs(Math.sin(time * 4 + ph)) * 0.22;
        const wander = Math.sin(time * 0.4 + ph) * 0.35;
        sootPos.set([x + wander, y + 0.28 + hop, z + Math.cos(time * 0.33 + ph) * 0.25], i * 3);
      });
      sootGeo.attributes.position.needsUpdate = true;
    },
  };
}
