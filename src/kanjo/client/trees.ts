// Tree and bush geometry for the track scenery (trackview.ts `scatter`): two species per theme, built from a few
// low-poly parts with vertex colours and soft "foliage" normals (pointing out of the crown, so the light falls across a
// tree like a mass of leaves instead of picking out facets), plus a wind sway done in the vertex shader. Every tree is
// one instanced mesh per species per tile, so the shapes cost triangles, never draw calls; keep them about as light
// as they are (a forest is tens of thousands of trees).

import * as THREE from 'three';
import type { Theme } from '../shared/track.ts';
import { mulberry } from './tracktextures.ts';

export function tint(geo: THREE.BufferGeometry, color: number | THREE.Color) {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Merges tinted parts into one non-indexed geometry, keeping each part's own normals (and UVs, when every part has them). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    return p.index ? p.toNonIndexed() : p;
  });
  const total = ni.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of ni) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Shades a tinted part from dark at its bottom to light at its top (y0..y1): the cheap stand-in for a crown's self-shadowing. */
export function shade(geo: THREE.BufferGeometry, y0: number, y1: number, dark: number, light: number) {
  const p = geo.getAttribute('position');
  const c = geo.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const k = dark + (light - dark) * THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

/**
 * A lump of foliage: a sphere pushed in and out by noise, normals pointing out from the crown's centre, each vertex a
 * shade lighter or darker for leaf clusters, darker underneath.
 */
export function foliage(r: number, cx: number, cy: number, cz: number, color: number, seed: number, crown = new THREE.Vector3(cx, cy, cz), ws = 8, hs = 6) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.getAttribute('position');
  const rnd = mulberry(seed);
  const bumps = [0, 1, 2, 3].map(() => new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    let k = 1;
    for (const b of bumps) k += Math.max(0, d.dot(b)) ** 3 * 0.22;
    // Seams of the sphere share positions: the noise must depend on position only.
    k += Math.sin(d.x * 7.1 + d.y * 3.3) * Math.cos(d.z * 6.7 - d.y * 2.1) * 0.08;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 0.85, 1).translate(cx, cy, cz);
  tint(g, color);
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(crown).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const leaf = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * Math.cos(p.getY(i) * 2.7));
    const under = 0.55 + 0.45 * THREE.MathUtils.smoothstep(v.y, -0.8, 0.6);
    c.setXYZ(i, c.getX(i) * leaf * under, c.getY(i) * leaf * under, c.getZ(i) * leaf * under);
  }
  return g;
}

/** A bark-coloured trunk, slightly darker at the foot. */
function trunk(r0: number, r1: number, h: number, color: number, segs = 4, lean = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 1, true).translate(0, h / 2, 0);
  if (lean) g.rotateZ(lean);
  return shade(tint(g, color), 0, h, 0.7, 1.05);
}

/**
 * One tier of conifer boughs: an open cone with a ragged, drooping hem (every other rim vertex pulled in and up), its
 * normals tipped outward and up so it lights softly, dark at the apex (hidden under the tier above) and bright at the
 * bough tips.
 */
function bough(r: number, h: number, y: number, segs: number, color: number, rnd: () => number, tipLight = 1.25) {
  const cone = new THREE.ConeGeometry(r, h, segs, 1, true);
  cone.rotateY(rnd() * Math.PI);
  const p = cone.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) < 0) {
      const k = i % 2 ? 0.7 : 0.95 + rnd() * 0.12;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) + (i % 2 ? 0.4 : -0.1), p.getZ(i) * k);
    }
  cone.translate(0, y, 0);
  tint(cone, color);
  const n = cone.getAttribute('normal');
  const c = cone.getAttribute('color');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const rim = p.getY(i) < y;
    v.set(p.getX(i), 0, p.getZ(i));
    if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
    else v.normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.62, 0)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const k = rim ? tipLight * (0.92 + rnd() * 0.16) : 0.45;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return cone;
}

/** A spruce: a narrow spire of seven ragged tiers. */
function spruce(seed: number, color = 0x2c5634) {
  const rnd = mulberry(seed);
  const parts = [trunk(0.3, 0.12, 3.4, 0x3d2c20)];
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = 3.1 - f * 2.4;
    parts.push(bough(r, 2.7 - f * 0.8, 2.6 + f * 6.6, 7, color, rnd, 1.15 + f * 0.25));
  }
  return merge(parts);
}

/** A Scots pine: a tall bare orange-brown trunk, limbs reaching out to ragged pads of needles. */
function scotsPine() {
  const bark = 0x6a4228;
  const parts = [trunk(0.3, 0.15, 9.4, bark)];
  const pads: [number, number, number, number, number][] = [
    [1.9, 0.2, 9.6, 0.1, 11],
    [1.5, 1.7, 8.3, 0.8, 12],
    [1.5, -1.6, 7.6, -0.8, 13],
  ];
  for (const [r, x, y, z, s] of pads) {
    if (Math.hypot(x, z) > 0.5) {
      const len = Math.hypot(x, z) + 0.3;
      const limb = new THREE.CylinderGeometry(0.05, 0.09, len, 3).translate(0, len / 2, 0).rotateZ(-Math.atan2(Math.hypot(x, z), 1.2)).rotateY(Math.atan2(-z, x) * 1);
      parts.push(tint(limb.translate(0, y - 1.1, 0), bark));
    }
    const f = foliage(r, 0, 0, 0, 0x31573a, s, new THREE.Vector3(0, -0.5, 0), 6, 3);
    f.scale(1.15, 0.55, 1.15).translate(x, y, z);
    parts.push(f);
  }
  return merge(parts);
}

/** A Japanese cedar (sugi): a tall, dense, dark spire, lumpy with clumps of foliage. */
function cedar(seed: number) {
  const rnd = mulberry(seed);
  const parts = [trunk(0.32, 0.14, 4, 0x4a3022)];
  const g = new THREE.CylinderGeometry(0, 1, 1, 8, 4, true);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = v.y + 0.5; // 0 at the foot, 1 at the tip
    const a = Math.atan2(v.z, v.x);
    const prof = (1 - f) ** 0.85 * 2.1 * (1 + 0.16 * Math.sin(a * 3 + f * 17) + 0.1 * Math.sin(f * 31));
    p.setXYZ(i, Math.cos(a) * prof, 2.4 + f * 9.6, Math.sin(a) * prof);
  }
  // The seam's two columns must stay together.
  g.computeVertexNormals();
  tint(g, 0x2b4a2a);
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), 0, p.getZ(i));
    if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
    else v.normalize().multiplyScalar(0.85).add(new THREE.Vector3(0, 0.5, 0)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const f = (p.getY(i) - 2.4) / 9.6;
    const k = (0.6 + f * 0.55) * (0.9 + rnd() * 0.2) * (0.9 + 0.2 * Math.abs(Math.sin(p.getY(i) * 2.3)));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  parts.push(g);
  return merge(parts);
}

/** A broadleaf crown (maples in autumn, cherries in spring): white, so each tree's instance colour paints it. */
function broadleaf(spread: number) {
  const parts = [trunk(0.3, 0.14, 4.2, 0x3a2a20, 5)];
  // Two limbs reaching into the crown.
  parts.push(tint(new THREE.CylinderGeometry(0.07, 0.13, 2.6, 3).translate(0, 1.3, 0).rotateZ(-0.7).translate(0, 3.2, 0), 0x3a2a20));
  parts.push(tint(new THREE.CylinderGeometry(0.07, 0.12, 2.4, 3).translate(0, 1.2, 0).rotateZ(0.75).rotateY(2).translate(0, 3.4, 0), 0x3a2a20));
  const centre = new THREE.Vector3(0, 5.8, 0);
  const s = spread;
  parts.push(foliage(2.5, 0, 6.1, 0, 0xffffff, 1, centre, 6, 4));
  parts.push(foliage(1.9 * s, 1.7 * s, 5.4, 0.6, 0xf4f4f4, 2, centre, 6, 4));
  parts.push(foliage(1.8 * s, -1.4 * s, 5.6, -0.9, 0xeeeeee, 3, centre, 6, 4));
  parts.push(foliage(1.5, 0.3, 7.6, -0.4, 0xfafafa, 4, centre, 5, 3));
  return merge(parts);
}

/** A stone pine: tall bare trunk, a wide flat umbrella crown. */
function stonePine() {
  const parts = [trunk(0.34, 0.2, 7.2, 0x5b4433, 5, 0.05)];
  parts.push(tint(new THREE.CylinderGeometry(0.08, 0.14, 2.6, 4).translate(0, 1.3, 0).rotateZ(-0.8).translate(0.3, 6.2, 0), 0x5b4433));
  for (const [r, x, y, z, s] of [
    [3.6, 0.3, 8.1, 0, 4],
    [2.4, 2.2, 7.6, 0.8, 5],
    [2.2, -1.6, 8.0, -1.2, 6],
  ]) {
    const f = foliage(r, 0, 0, 0, 0x3e5a2c, s, new THREE.Vector3(0, -0.2, 0), 7, 4);
    f.scale(1, 0.42, 1).translate(x, y, z);
    parts.push(f);
  }
  return merge(parts);
}

/** An Italian cypress: a tall, narrow dark-green flame. */
function cypress(seed: number) {
  const rnd = mulberry(seed);
  const g = new THREE.CylinderGeometry(1, 1, 1, 7, 5, true);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = v.y + 0.5;
    const a = Math.atan2(v.z, v.x);
    const prof = Math.sin(Math.min(1, f * 1.15 + 0.08) * Math.PI) ** 0.7 * 1.05 * (1 + 0.1 * Math.sin(a * 3 + f * 13));
    p.setXYZ(i, Math.cos(a) * prof, 0.6 + f * 10.5, Math.sin(a) * prof);
  }
  tint(g, 0x2b4426);
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), 0.4, p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const k = (0.6 + ((p.getY(i) - 0.6) / 10.5) * 0.6) * (0.9 + rnd() * 0.2);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return merge([trunk(0.2, 0.15, 1.2, 0x4a3828), g]);
}

function saguaro() {
  const green = 0x55703c;
  const col = (r0: number, r1: number, h: number, segs: number) => new THREE.CylinderGeometry(r1, r0, h, segs, 1, true);
  const cap = (r: number, segs: number) => new THREE.SphereGeometry(r, segs, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  const parts = [shade(tint(col(0.42, 0.36, 6, 7).translate(0, 3, 0), green), 0, 6, 0.8, 1.1), tint(cap(0.36, 7).translate(0, 6, 0), green)];
  parts.push(tint(col(0.25, 0.25, 1.4, 5).rotateZ(Math.PI / 2).translate(0.7, 2.6, 0), green));
  parts.push(shade(tint(col(0.25, 0.25, 2, 5).translate(1.4, 3.4, 0), green), 2.4, 4.4, 0.8, 1.1), tint(cap(0.25, 5).translate(1.4, 4.4, 0), green));
  parts.push(tint(col(0.22, 0.22, 1.2, 5).rotateZ(Math.PI / 2).translate(-0.6, 3.6, 0), green));
  parts.push(shade(tint(col(0.22, 0.22, 1.6, 5).translate(-1.2, 4.2, 0), green), 3.4, 5, 0.8, 1.1), tint(cap(0.22, 5).translate(-1.2, 5, 0), green));
  return merge(parts);
}

/** A desert scrub tree (mesquite / ironwood): a gnarled trunk splitting into limbs under a thin olive crown. */
function scrubTree() {
  const bark = 0x5a4232;
  const parts = [trunk(0.24, 0.16, 1.6, bark, 5, 0.12)];
  for (const [rz, ry, l] of [
    [-0.7, 0, 2.6],
    [0.6, 1.9, 2.4],
    [0.55, 4.2, 2.2],
  ])
    parts.push(tint(new THREE.CylinderGeometry(0.06, 0.13, l, 4).translate(0, l / 2, 0).rotateZ(rz).rotateY(ry).translate(0.15, 1.5, 0), bark));
  for (const [r, x, y, z, s] of [
    [1.9, 1.3, 3.1, 0.2, 21],
    [1.7, -1.3, 3.0, 0.9, 22],
    [1.6, -0.2, 3.4, -1.4, 23],
  ]) {
    const f = foliage(r, 0, 0, 0, 0x6f7446, s, new THREE.Vector3(0, -0.3, 0), 6, 3);
    f.scale(1, 0.5, 1).translate(x, y, z);
    parts.push(f);
  }
  return merge(parts);
}

export interface Species {
  geo: THREE.BufferGeometry;
  /** Instance colours to choose from (white crowns painted per tree); none = the tree's own colours, slightly varied. */
  palette: number[] | null;
  /** No far stand-in (trees.ts farTree): a shape a lathe can't stand in for, like a saguaro's arms. */
  noFar?: true;
}

/** The theme's two trees and the share of the second. */
export function speciesFor(theme: Theme): { a: Species; b: Species; share: number } {
  const own = (geo: THREE.BufferGeometry): Species => ({ geo, palette: null });
  switch (theme) {
    case 'alpine':
      return { a: own(spruce(3)), b: own(scotsPine()), share: 0.16 };
    case 'night':
      return { a: own(spruce(5, 0x2a4f33)), b: own(cedar(9)), share: 0.35 };
    case 'coast':
      return { a: own(stonePine()), b: own(cypress(4)), share: 0.42 };
    case 'desert':
      return { a: { ...own(saguaro()), noFar: true }, b: own(scrubTree()), share: 0.45 };
    case 'autumn':
      // Maples each in their own autumn colour, among dark cedars.
      return { a: { geo: broadleaf(1), palette: [0xd8431f, 0xe8742a, 0xf2b233, 0xb8261e, 0xc9a23a, 0x6f8a32] }, b: own(cedar(7)), share: 0.28 };
    case 'spring':
      // Cherries in blossom (a few in fresh leaf), wide and low, among cedars.
      return { a: { geo: broadleaf(1.2), palette: [0xf6b8cc, 0xf9cfdc, 0xee9fb8, 0xfde6ee, 0xf3a9c2, 0x86b04a] }, b: own(cedar(8)), share: 0.25 };
    default:
      return { a: own(spruce(3)), b: own(cedar(9)), share: 0.3 };
  }
}

/** Undergrowth: a low lump of leaves and a smaller one beside it (white, painted per bush). */
export function bushGeometry() {
  const centre = new THREE.Vector3(0, 0.2, 0);
  const a = foliage(1, 0, 0.55, 0, 0xffffff, 31, centre, 6, 4);
  const b = foliage(0.65, 0.85, 0.35, 0.35, 0xf0f0f0, 32, centre, 5, 3);
  return merge([a, b]);
}

/** The theme's bush colours (the last few are rarer accents: flowers, berries, autumn red). */
export const BUSH_COLOURS: Record<Theme, number[]> = {
  alpine: [0x3d6233, 0x4a6e36, 0x36582e, 0x6b7a3a],
  night: [0x2f4c2a, 0x37572f, 0x2a4224],
  coast: [0x5c6b38, 0x6b7642, 0x4e5e32, 0x7d7a4a],
  desert: [0x7a7a50, 0x8a8456, 0x6d6c48, 0x9a8a5c],
  autumn: [0x6a6a2a, 0x8a5a22, 0xa8461e, 0x56622c, 0xc06a24],
  spring: [0x3f6a2c, 0x4b7832, 0x365c27, 0xe58fb4, 0xf2c2d4],
  city: [0x24301f],
};

/** The wind's clock (seconds), shared by every swaying material: trackview's follow() moves it. */
export const WIND = { value: 0 };

/**
 * Makes an instanced material sway in the wind: each instance bends from its foot (the higher, the further), with its
 * own phase from where it stands. A few ALU in the vertex shader; the shadow doesn't sway (too small to see).
 */
export function sway(mat: THREE.Material, amount: number, from = 1.2) {
  // The amounts are uniforms, so every swaying material (and its Low stand-in, lowgfx.ts) shares one program.
  const uSway = { value: amount };
  const uFrom = { value: from };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.uniforms.uSway = uSway;
    sh.uniforms.uFrom = uFrom;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;\nuniform float uSway;\nuniform float uFrom;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 swayAt = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
      #else
        vec2 swayAt = vec2( 0.0 );
      #endif
      float swayH = max( 0.0, transformed.y - uFrom );
      float swayW = sin( uWind * 1.1 + swayAt.x * 0.031 + swayAt.y * 0.047 ) + 0.45 * sin( uWind * 2.7 + swayAt.x * 0.11 - swayAt.y * 0.07 );
      transformed.xz += vec2( 0.8, 0.55 ) * swayW * swayH * swayH * uSway;`,
    );
  };
}

/**
 * A far-off stand-in for a tree, for the forest past `LOD.trees` (lod.ts): the crown's outline as one lathe of `sides`
 * faces (the widest the crown reaches at its foot, at half height and a point at the top), its colours averaged from
 * the tree's own at those heights, normals tipped out and up like the boughs', a three-sided trunk under a crown that
 * stands high, and a cap underneath. ~20 triangles instead of 50-100; at 300 m a tree is a few dozen pixels tall.
 */
export function farTree(geo: THREE.BufferGeometry, sides = 5): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  const c = geo.getAttribute('color');
  // The crown: everything standing out from the trunk.
  const crown: number[] = [];
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    // The top is the tree's highest point (a spire's tip is on the axis); the crown's foot, its lowest leafy one.
    y1 = Math.max(y1, p.getY(i));
    if (Math.hypot(p.getX(i), p.getZ(i)) < 0.45) continue;
    crown.push(i);
    y0 = Math.min(y0, p.getY(i));
  }
  const h = y1 - y0;
  /** The crown's widest reach and average colour within a band around height y. */
  const ring = (y: number, w: number) => {
    let r = 0;
    const col = [0, 0, 0];
    let n = 0;
    for (const i of crown) {
      if (Math.abs(p.getY(i) - y) > w) continue;
      r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
      col[0] += c.getX(i);
      col[1] += c.getY(i);
      col[2] += c.getZ(i);
      n++;
    }
    return { r: r * 0.92, col: n ? col.map((v) => v / n) : [0.2, 0.3, 0.2] };
  };
  const rings = [ring(y0 + h * 0.08, h * 0.18), ring(y0 + h * 0.5, h * 0.2)];
  const tip = ring(y1 - h * 0.05, h * 0.12);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const vert = (x: number, y: number, z: number, n: [number, number, number], k: number[]) => {
    pos.push(x, y, z);
    nor.push(...n);
    col.push(k[0], k[1], k[2]);
    return pos.length / 3 - 1;
  };
  const out = (a: number): [number, number, number] => {
    const v = new THREE.Vector3(Math.cos(a) * 0.8, 0.62, Math.sin(a) * 0.8).normalize();
    return [v.x, v.y, v.z];
  };
  const heights = [y0, y0 + h * 0.5];
  const firsts = rings.map((rg, j) => {
    const first = pos.length / 3;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      vert(Math.cos(a) * rg.r, heights[j], Math.sin(a) * rg.r, out(a), rg.col);
    }
    return first;
  });
  const top = vert(0, y1, 0, [0, 1, 0], tip.col);
  // Wound like three.js's own cones, so the faces point out.
  for (let s = 0; s < sides; s++) {
    const s1 = (s + 1) % sides;
    const [a, b] = [firsts[0] + s, firsts[0] + s1];
    const [d, e] = [firsts[1] + s, firsts[1] + s1];
    idx.push(a, d, b, b, d, e);
    idx.push(d, top, e);
  }
  const under = vert(0, y0, 0, [0, -1, 0], rings[0].col.map((v) => v * 0.55));
  for (let s = 0; s < sides; s++) idx.push(firsts[0] + s, firsts[0] + ((s + 1) % sides), under);
  // A trunk only where the crown stands well clear of the ground (pines): three faces, its colour the tree's lowest.
  if (y0 > 2) {
    let low = 0;
    for (let i = 1; i < p.count; i++) if (p.getY(i) < p.getY(low)) low = i;
    const bark = [c.getX(low), c.getY(low), c.getZ(low)];
    const base: number[] = [];
    const head: number[] = [];
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      const n: [number, number, number] = [Math.cos(a), 0, Math.sin(a)];
      base.push(vert(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28, n, bark));
      head.push(vert(Math.cos(a) * 0.18, y0 + 0.3, Math.sin(a) * 0.18, n, bark));
    }
    for (let s = 0; s < 3; s++) idx.push(base[s], head[s], base[(s + 1) % 3], base[(s + 1) % 3], head[s], head[(s + 1) % 3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A tile's far stand-in: `geo` (farTree) drawn at the same instances as `im`, sharing its matrices and colours. */
export function farTwin(im: THREE.InstancedMesh, geo: THREE.BufferGeometry): THREE.InstancedMesh {
  const lo = new THREE.InstancedMesh(geo, im.material, 0);
  lo.instanceMatrix = im.instanceMatrix;
  lo.instanceColor = im.instanceColor;
  lo.count = im.count;
  lo.castShadow = im.castShadow;
  lo.receiveShadow = im.receiveShadow;
  lo.computeBoundingSphere();
  return lo;
}
