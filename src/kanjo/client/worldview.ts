// Draws Kanjo, the open world (kanjo/shared/world.ts): the island's terrain in chunks with distance levels of detail,
// every road with its own lines, rails, the expressway's median and its viaducts on piers, the city's blocks and
// street lamps, forests along the roads, the sea, and a few landmarks (the summit torii, the airfield's tower and
// hangars, a lighthouse, the speed-trap gantries). Same sky, light, fog and backdrop as the race tracks
// (trackview.ts `atmosphere`), at golden hour.
//
// Budget: one draw call per terrain chunk in view, one per road piece, merged lines/rails/buildings, instanced
// trees per 400 m tile that only draw near the camera (TREE_DRAW). Low graphics: coarser terrain, half the trees and
// a shorter tree distance, no tree shadows.

import * as THREE from 'three';
import { SAMPLE, SHOULDER, type Track, fbm } from '../shared/track.ts';
import { CITY, RAIL_H, type Road, type World, WORLD, cityAt, coveredBy, roadGap, worldHeight } from '../shared/world.ts';
import { HORIZON_FADE, LOOKS, type Look, TRACK_LOOKS, type TrackView, atmosphere, matteGround, noiseNormal, rockGeometry } from './trackview.ts';
import { TARMAC_TILE, ground, mulberry, tarmac } from './tracktextures.ts';
import { FACADE_H, FACADE_W, FAC_STYLES, TOWER_H, TOWER_W, facade, facadeMaterial, pushFac, roofDeck, roofUv, towerFacade } from './facades.ts';
import { WIND, farTree, farTwin, speciesFor, sway } from './trees.ts';
import { LOD, LodTiles, ShadowOnly, shadowCasters } from './lod.ts';

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Trees past this far from the camera aren't drawn (m): High, Low. */
const TREE_DRAW = [1300, 650];
/** Trees grow within this far of a road (further out, the terrain's forest colour stands in for them). */
const TREE_REACH = 280;
/** Terrain chunk size and its levels of detail: grid steps (m) and the distance each takes over at. */
const CHUNK = 800;
const LODS_HIGH: [number, number][] = [
  [8, 0],
  [16, 1100],
  [32, 2200],
];
const LODS_LOW: [number, number][] = [
  [16, 0],
  [32, 900],
  [64, 2000],
];
/** The terrain grid covers this (a little past the island's coast). */
const AREA = { x0: -3600, x1: 3600, z0: -3200, z1: 3200 };

export function buildWorldView(t: Track, renderer: THREE.WebGLRenderer, low = false): TrackView {
  const w = t.world!.world;
  const look: Look = { ...LOOKS[t.def.theme], ...TRACK_LOOKS[t.def.id] };
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const keep: Keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const { sky, envSky, sun, sunDir, lightDir } = atmosphere(scene, look, renderer, low, keep);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  terrain(scene, w, look, keep, aniso, low);
  roads(scene, w, keep, aniso);
  rails(scene, w, keep);
  bridges(scene, w, keep);
  city(scene, w, keep, low);
  lamps(scene, w, keep);
  landmarks(scene, w, keep);
  const lods = new LodTiles();
  const trees = forest(scene, w, look, keep, low, lods);

  // The sea.
  const normal = keep(noiseNormal(256));
  normal.repeat.set(400, 400);
  const seaMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a5670, roughness: 0.12, metalness: 0.1, normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.25 }));
  const sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(16000, 16000)), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = w.water;
  sea.receiveShadow = !low;
  scene.add(sea);

  const reach = TREE_DRAW[low ? 1 : 0];
  let lastTreeCheck = -1e9;
  return {
    scene,
    sun,
    exposure: look.exposure,
    grade: look.grade,
    sunDir: look.moon ? null : sunDir,
    follow(x, y, z, time) {
      WIND.value = time / 1000;
      const texel = 90 / 2048;
      const sx = Math.round(x / texel) * texel;
      const sz = Math.round(z / texel) * texel;
      sun.target.position.set(sx, y, sz);
      sun.position.set(sx + lightDir.x * 200, y + lightDir.y * 200, sz + lightDir.z * 200);
      normal.offset.set(time * 0.004, time * 0.0025);
      // Tree tiles near the camera only (checked a few times a second).
      if (time - lastTreeCheck > 250) {
        lastTreeCheck = time;
        for (const tile of trees) tile.group.visible = Math.hypot(tile.x - x, tile.z - z) < reach + 300;
        lods.update(x, z);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      sky.material.dispose();
      envSky.material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Terrain

/** A darker, bluer green where the forest stands (the trees themselves only grow near the roads). */
const forestNoise = (x: number, z: number) => fbm(x / 260, z / 260, WORLD.seed + 11, 3);

function terrain(scene: THREE.Scene, w: World, look: Look, keep: Keep, aniso: number, low: boolean) {
  const tex = ground('alpine', WORLD.seed, aniso);
  for (const x of Object.values(tex)) keep(x);
  const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, ...tex, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, metalness: 0 }));
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      vec3 macro = texture2D( map, vMapUv * 0.083 + 0.37 ).rgb;
      sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), macro * 1.25, 0.65 );
      diffuseColor *= sampledDiffuseColor;`,
    );
    matteGround(sh);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <fog_fragment>',
      `#include <fog_fragment>
      #ifdef USE_FOG
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( ${(HORIZON_FADE[0] * 1.6).toFixed(1)}, ${(HORIZON_FADE[1] * 1.6).toFixed(1)}, vFogDepth ) );
      #endif`,
    );
  };
  // One fine grid of heights and colours for the whole island; each chunk's levels sample it.
  const step = 8;
  const nx = Math.round((AREA.x1 - AREA.x0) / step) + 1;
  const nz = Math.round((AREA.z1 - AREA.z0) / step) + 1;
  const H = new Float32Array(nx * nz);
  const sink = new Float32Array(nx * nz);
  const C = new Float32Array(nx * nz * 3);
  const loc = { i: -1, s: 0, d: 0, cx: 0, cy: 0, cz: 0, tx: 0, tz: -1 };
  for (let r = 0; r < nz; r++)
    for (let c = 0; c < nx; c++) {
      const x = AREA.x0 + c * step;
      const z = AREA.z0 + r * step;
      const k = r * nx + c;
      H[k] = worldHeight(w, x, z, -1, loc);
      // Under the paving (not the verge, which is drawn by the terrain itself) the ground drops out of sight.
      if (loc.i >= 0) {
        const rd = w.roads[w.road[loc.i]];
        const paved = rd.def.kind === 'lot' || rd.def.kind === 'runway' ? rd.half + 1.5 : rd.half + SHOULDER + 0.6;
        if (Math.abs(loc.d) < paved) sink[k] = 0.4;
      }
    }
  const col = [0, 0, 0];
  for (let r = 0; r < nz; r++)
    for (let c = 0; c < nx; c++) {
      const k = r * nx + c;
      const x = AREA.x0 + c * step;
      const z = AREA.z0 + r * step;
      const hx = H[r * nx + Math.min(nx - 1, c + 1)] - H[r * nx + Math.max(0, c - 1)];
      const hz = H[Math.min(nz - 1, r + 1) * nx + c] - H[Math.max(0, r - 1) * nx + c];
      const ny = 1 / Math.hypot(hx / (2 * step), 1, hz / (2 * step));
      colorAt(w, look, x, z, H[k], ny, col);
      C.set(col, k * 3);
    }
  const lods = low ? LODS_LOW : LODS_HIGH;
  for (let cx = AREA.x0; cx < AREA.x1; cx += CHUNK)
    for (let cz = AREA.z0; cz < AREA.z1; cz += CHUNK) {
      // Skip chunks that are all deep sea.
      let top = -Infinity;
      for (let x = cx; x <= cx + CHUNK; x += 32) for (let z = cz; z <= cz + CHUNK; z += 32) top = Math.max(top, H[Math.round((z - AREA.z0) / step) * nx + Math.round((x - AREA.x0) / step)] ?? -1e9);
      if (top < w.water - 6) continue;
      const lod = new THREE.LOD();
      for (const [st, dist] of lods) {
        const mesh = new THREE.Mesh(keep(chunkGeometry(cx, cz, st, step, nx, nz, H, sink, C, dist > 0)), mat);
        mesh.receiveShadow = !low && dist === 0;
        lod.addLevel(mesh, dist);
      }
      lod.position.set(0, 0, 0);
      // LOD distances are measured from the object's position: put it at the chunk's centre (the geometry is in world
      // coordinates, so offset it back).
      lod.position.set(cx + CHUNK / 2, 0, cz + CHUNK / 2);
      for (const l of lod.levels) l.object.position.set(-(cx + CHUNK / 2), 0, -(cz + CHUNK / 2));
      scene.add(lod);
    }
}

function chunkGeometry(cx: number, cz: number, st: number, base: number, nx: number, nz: number, H: Float32Array, sink: Float32Array, C: Float32Array, far: boolean) {
  const n = CHUNK / st + 1;
  const k = st / base;
  const c0 = Math.round((cx - AREA.x0) / base);
  const r0 = Math.round((cz - AREA.z0) / base);
  // The grid plus a skirt round the edge (hides the cracks between levels of detail).
  const verts = n * n + 4 * n;
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const at = (i: number, j: number) => Math.min(nz - 1, r0 + j * k) * nx + Math.min(nx - 1, c0 + i * k);
  // Far levels sink further under the roads: their long triangles cut corners the near grid doesn't.
  const sinkK = far ? 1 + st / 6 : 1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const g = at(i, j);
      const v = j * n + i;
      const x = cx + i * st;
      const z = cz + j * st;
      pos.set([x, H[g] - sink[g] * sinkK, z], v * 3);
      col.set([C[g * 3], C[g * 3 + 1], C[g * 3 + 2]], v * 3);
      uv.set([x / 6, z / 6], v * 2);
    }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  // Skirts: each edge's vertices again, dropped 6 m, stitched to the edge.
  const edges: number[][] = [
    Array.from({ length: n }, (_, i) => i), // north (j = 0)
    Array.from({ length: n }, (_, i) => (n - 1) * n + i), // south
    Array.from({ length: n }, (_, j) => j * n), // west
    Array.from({ length: n }, (_, j) => j * n + n - 1), // east
  ];
  let o = n * n;
  edges.forEach((e, ei) => {
    for (let q = 0; q < n; q++) {
      const v = e[q];
      pos.set([pos[v * 3], pos[v * 3 + 1] - 6 - st * 0.2, pos[v * 3 + 2]], (o + q) * 3);
      col.set([col[v * 3], col[v * 3 + 1], col[v * 3 + 2]], (o + q) * 3);
      uv.set([uv[v * 2], uv[v * 2 + 1]], (o + q) * 2);
    }
    for (let q = 0; q < n - 1; q++) {
      const a = e[q];
      const b = e[q + 1];
      const sa = o + q;
      const sb = o + q + 1;
      // Both windings: the skirt shows from either side.
      if (ei === 0 || ei === 3) idx.push(a, sa, b, b, sa, sb);
      else idx.push(a, b, sa, b, sb, sa);
    }
    o += n;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function colorAt(w: World, look: Look, x: number, z: number, h: number, ny: number, out: number[]) {
  const n = fbm(x / 70, z / 70, WORLD.seed + 3, 3) * 0.5 + 0.5;
  const steep = THREE.MathUtils.smoothstep(ny, 0.72, 0.9);
  const g = look.grass.map((c, i) => c + (look.grassDry[i] - c) * n);
  // Forest floor: darker and cooler where the woods are thick (and higher up the mountain).
  const woods = THREE.MathUtils.smoothstep(forestNoise(x, z) + h / 900, 0.0, 0.25);
  const deep = [0.13, 0.22, 0.1];
  for (let i = 0; i < 3; i++) g[i] += (deep[i] - g[i]) * woods * 0.75;
  for (let i = 0; i < 3; i++) out[i] = look.rock[i] + (g[i] - look.rock[i]) * steep;
  // Beach by the sea, darker under water.
  const shore = 1 - THREE.MathUtils.smoothstep(h, w.water + 1.2, w.water + 5);
  const sand = [0.8, 0.72, 0.55];
  for (let i = 0; i < 3; i++) out[i] += (sand[i] - out[i]) * shore;
  if (h < w.water - 0.5) for (let i = 0; i < 3; i++) out[i] *= 0.55;
  // The city's pavements and plazas.
  const city = cityAt(x, z);
  if (city > 0.5) {
    const pave = 0.52 + fbm(x / 9, z / 9, 7, 2) * 0.05;
    const k = THREE.MathUtils.smoothstep(city, 0.5, 0.95);
    for (let i = 0; i < 3; i++) out[i] += (pave * [1, 0.98, 0.95][i] - out[i]) * k;
  }
  // Trodden verges by every road.
  const gap = roadGap(w, x, z);
  if (gap < 10) {
    const v = 1 - THREE.MathUtils.smoothstep(gap, -2, 10);
    for (let i = 0; i < 3; i++) out[i] += (look.verge[i] - out[i]) * v * 0.6;
  }
}

// ---------------------------------------------------------------------------------------------
// Roads and their lines

const PIECE = 60; // samples per road mesh

function roads(scene: THREE.Scene, w: World, keep: Keep, aniso: number) {
  const tar = tarmac(WORLD.seed, aniso);
  const con = tarmac(WORLD.seed + 1, aniso, true);
  for (const x of [...Object.values(tar), ...Object.values(con)]) keep(x);
  const lineW = keep(new THREE.MeshStandardMaterial({ color: 0xe9e6db, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
  const lineY = keep(new THREE.MeshStandardMaterial({ color: 0xe8a321, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
  const white: number[] = [];
  const yellow: number[] = [];
  w.roads.forEach((rd, ri) => {
    const concrete = rd.def.kind === 'runway';
    // Each road its own depth offset, so two roads overlapping at a junction never fight.
    const mat = keep(new THREE.MeshStandardMaterial({ ...(concrete ? con : tar), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 - (ri % 8) }));
    const n = rd.i1 - rd.i0;
    const reach = rd.def.kind === 'lot' || rd.def.kind === 'runway' ? rd.half + 1.5 : rd.half + SHOULDER + 0.6;
    const last = rd.closed ? n : n - 1;
    for (let k0 = 0; k0 < last; k0 += PIECE) {
      const k1 = Math.min(last, k0 + PIECE);
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const cross = [-reach, -rd.half, 0, rd.half, reach];
      for (let k = k0; k <= k1; k++) {
        const i = rd.i0 + (k % n);
        for (const d of cross) {
          pos.push(w.x[i] - w.tz[i] * d, w.y[i] - w.bank[i] * d + 0.03, w.z[i] + w.tx[i] * d);
          uv.push(d / TARMAC_TILE, (w.rs[i] + (k >= n ? rd.length : 0)) / TARMAC_TILE);
        }
        if (k < k1) {
          const a = (k - k0) * cross.length;
          const c = cross.length;
          // Wound to face up (d runs left to right across the road).
          for (let q = 0; q < c - 1; q++) idx.push(a + q, a + q + 1, a + q + c, a + q + 1, a + q + 1 + c, a + q + c);
        }
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      scene.add(m);
    }
    markings(w, rd, ri, white, yellow);
  });
  for (const [all, mat] of [
    [white, lineW],
    [yellow, lineY],
  ] as const)
    for (const arr of cells(all)) {
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      scene.add(m);
    }
}

/**
 * The island-wide line work, rails and walls are drawn in squares this big (m): as one mesh each they were drawn
 * whole every frame, and the rails into the shadow map too (~300k triangles), wherever the camera was.
 */
const CELL = 700;
const cellOf = (x: number, z: number) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;

/** Splits a triangle soup (x, y, z per corner) into one per CELL square, by each triangle's first corner. */
function cells(tris: number[]): number[][] {
  const out = new Map<string, number[]>();
  for (let i = 0; i < tris.length; i += 9) {
    const k = cellOf(tris[i], tris[i + 2]);
    let a = out.get(k);
    if (!a) out.set(k, (a = []));
    for (let j = 0; j < 9; j++) a.push(tris[i + j]);
  }
  return [...out.values()];
}

/** A road's painted lines, as triangles appended to `white` / `yellow`: solid or dashed, left out where another road crosses. */
function markings(w: World, rd: Road, ri: number, white: number[], yellow: number[]) {
  const n = rd.i1 - rd.i0;
  const last = rd.closed ? n : n - 1;
  /** A line at offset d, `width` wide; `on`/`off` dash lengths (m; off 0 = solid). */
  const line = (out: number[], d: number, width: number, on: number, off: number) => {
    let prev: number[] | null = null;
    for (let k = 0; k <= last; k++) {
      const i = rd.i0 + (k % n);
      const s = k * SAMPLE;
      const lit = off === 0 || s % (on + off) < on;
      const x = w.x[i] - w.tz[i] * d;
      const z = w.z[i] + w.tx[i] * d;
      const y = w.y[i] - w.bank[i] * d + 0.05;
      const ok = lit && !coveredBy(w, x, z, w.y[i], ri, 0.2);
      if (!ok) {
        prev = null;
        continue;
      }
      const hx = -w.tz[i] * (width / 2);
      const hz = w.tx[i] * (width / 2);
      const cur = [x - hx, y, z - hz, x + hx, y, z + hz];
      if (prev) out.push(prev[0], prev[1], prev[2], prev[3], prev[4], prev[5], cur[0], cur[1], cur[2], prev[3], prev[4], prev[5], cur[3], cur[4], cur[5], cur[0], cur[1], cur[2]);
      prev = cur;
    }
  };
  const h = rd.half;
  switch (rd.def.kind) {
    case 'highway':
      for (const s of [-1, 1]) {
        line(white, s * (h - 0.4), 0.2, 1, 0);
        line(white, s * 1.15, 0.15, 1, 0);
        line(white, s * (0.8 + 3.7), 0.15, 6, 10);
        line(white, s * (0.8 + 7.4), 0.15, 6, 10);
      }
      break;
    case 'avenue':
      for (const s of [-1, 1]) {
        line(white, s * (h - 0.3), 0.15, 1, 0);
        line(yellow, s * 0.14, 0.12, 1, 0);
        line(white, s * (h / 2), 0.13, 4, 8);
      }
      break;
    case 'street':
      for (const s of [-1, 1]) line(white, s * (h - 0.3), 0.13, 1, 0);
      line(white, 0, 0.13, 3, 6);
      break;
    case 'pass':
      for (const s of [-1, 1]) line(white, s * (h - 0.25), 0.15, 1, 0);
      line(yellow, 0, 0.15, 1, 0);
      break;
    case 'country':
      for (const s of [-1, 1]) line(white, s * (h - 0.25), 0.13, 1, 0);
      line(white, 0, 0.13, 4, 8);
      break;
    case 'ramp':
      for (const s of [-1, 1]) line(white, s * (h - 0.3), 0.15, 1, 0);
      break;
    case 'runway': {
      for (const s of [-1, 1]) line(white, s * (h - 1.5), 0.9, 1, 0);
      line(white, 0, 0.9, 30, 20);
      // Threshold bars at both ends: 8 a side, 30 m long.
      for (const end of [0, n - 1]) {
        const i = rd.i0 + end;
        const dir = end === 0 ? 1 : -1;
        for (const s of [-1, 1])
          for (let b = 0; b < 8; b++) {
            const d = s * (3 + b * 2.4);
            const x0 = w.x[i] + w.tx[i] * dir * 12 - w.tz[i] * d;
            const z0 = w.z[i] + w.tz[i] * dir * 12 + w.tx[i] * d;
            quad(white, x0, z0, w.tx[i] * dir, w.tz[i] * dir, 30, 1.6, w.y[i] + 0.05);
          }
      }
      break;
    }
    case 'lot': {
      // Parking bays along both long sides.
      for (let k = 6; k < n - 6; k += 2) {
        const i = rd.i0 + k;
        if ((k * SAMPLE) % 6 !== 0) continue;
        for (const s of [-1, 1]) {
          const d = s * (h - 3.6);
          const x0 = w.x[i] - w.tz[i] * d;
          const z0 = w.z[i] + w.tx[i] * d;
          quad(white, x0, z0, -w.tz[i] * s, w.tx[i] * s, 6, 0.14, w.y[i] + 0.05);
        }
      }
      break;
    }
  }
}

/** A flat rectangle centred at (x, z), `len` along (tx, tz) and `wid` across, at height y. */
function quad(out: number[], x: number, z: number, tx: number, tz: number, len: number, wid: number, y: number) {
  const ax = tx * len * 0.5;
  const az = tz * len * 0.5;
  const bx = -tz * wid * 0.5;
  const bz = tx * wid * 0.5;
  const p = [
    [x - ax - bx, z - az - bz],
    [x + ax - bx, z + az - bz],
    [x + ax + bx, z + az + bz],
    [x - ax + bx, z - az + bz],
  ];
  // Upward-facing triangles whichever way the axes turn.
  const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
  const order = cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const k of order) out.push(p[k][0], y, p[k][1]);
}

// ---------------------------------------------------------------------------------------------
// Rails, the median, parapets

function rails(scene: THREE.Scene, w: World, keep: Keep) {
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0xe9ecee, metalness: 0.05, roughness: 0.42, side: THREE.DoubleSide }));
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.85, side: THREE.DoubleSide }));
  const beam: number[] = [];
  const wall: number[] = [];
  const posts: [number, number, number, number][] = [];
  for (const r of w.railRuns) {
    const p = r.pts;
    const m = p.length / 3;
    // The outward normal (away from the road) at each point.
    const nrm = (k: number) => {
      const a = Math.max(0, k - 1);
      const b = Math.min(m - 1, k + 1);
      const dx = p[b * 3] - p[a * 3];
      const dz = p[b * 3 + 2] - p[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      // Right of travel is (-dz, dx); the rail on side +1 faces right, -1 left.
      return [(-dz / l) * (r.side || 1), (dx / l) * (r.side || 1)];
    };
    if (r.kind === 'rail') {
      for (let k = 0; k < m - 1; k++) {
        const [ax, ay, az] = [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]];
        const [bx, by, bz] = [p[k * 3 + 3], p[k * 3 + 4], p[k * 3 + 5]];
        const [na, nb] = [nrm(k), nrm(k + 1)];
        // A W-beam: low edge, bulge, high edge.
        const prof = (x: number, y: number, z: number, n: number[]) => [
          [x, y + 0.42, z],
          [x - n[0] * 0.07, y + 0.6, z - n[1] * 0.07],
          [x, y + 0.78, z],
        ];
        const A = prof(ax, ay, az, na);
        const B = prof(bx, by, bz, nb);
        for (let q = 0; q < 2; q++) beam.push(...A[q], ...B[q], ...A[q + 1], ...A[q + 1], ...B[q], ...B[q + 1]);
        posts.push([ax + na[0] * 0.15, ay, az + na[1] * 0.15, Math.atan2(bx - ax, bz - az)]);
      }
    } else {
      // A concrete wall: the median's jersey barrier (both faces sloped) or a parapet.
      const median = r.kind === 'median';
      const base = median ? 0.32 : 0.18;
      const topW = median ? 0.12 : 0.18;
      const hgt = median ? RAIL_H : RAIL_H + 0.25;
      for (let k = 0; k < m - 1; k++) {
        const P = [0, 1].map((o) => [p[(k + o) * 3], p[(k + o) * 3 + 1], p[(k + o) * 3 + 2]]);
        const N = [nrm(k), nrm(k + 1)];
        const sec = (q: number) => {
          const [x, y, z] = P[q];
          const [nx, nz] = N[q];
          return [
            [x - nx * base, y - 0.3, z - nz * base],
            [x - nx * topW, y + hgt, z - nz * topW],
            [x + nx * topW, y + hgt, z + nz * topW],
            [x + nx * base, y - 0.3, z + nz * base],
          ];
        };
        const A = sec(0);
        const B = sec(1);
        for (let q = 0; q < 3; q++) wall.push(...A[q], ...B[q], ...A[q + 1], ...A[q + 1], ...B[q], ...B[q + 1]);
      }
    }
  }
  for (const [all, mat] of [
    [beam, steel],
    [wall, concrete],
  ] as const)
    for (const arr of cells(all)) {
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  const postGeo = keep(new THREE.BoxGeometry(0.12, 0.85, 0.08));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const bins = new Map<string, typeof posts>();
  for (const p of posts) {
    const k = cellOf(p[0], p[2]);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k)!.push(p);
  }
  for (const list of bins.values()) {
    const im = new THREE.InstancedMesh(postGeo, steel, list.length);
    list.forEach(([x, y, z, yaw], i) => im.setMatrixAt(i, m4.compose(v.set(x, y + 0.42, z), q.setFromAxisAngle(up, yaw), one)));
    im.computeBoundingSphere();
    scene.add(im);
  }
}

// ---------------------------------------------------------------------------------------------
// Viaducts

function bridges(scene: THREE.Scene, w: World, keep: Keep) {
  const concrete = keep(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 }));
  const slab: number[] = [];
  const piers: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const [a, b] of w.deckSpans) {
    const rd = w.roads[w.road[a]];
    const half = rd.half + SHOULDER + 0.9;
    // The deck's underside and fascias, from a little before to a little after the span.
    const sec = (i: number) => {
      const x = w.x[i];
      const z = w.z[i];
      const y = w.y[i];
      const rx = -w.tz[i];
      const rz = w.tx[i];
      return [
        [x - rx * half, y - 0.1, z - rz * half],
        [x - rx * half, y - 1.8, z - rz * half],
        [x + rx * half, y - 1.8, z + rz * half],
        [x + rx * half, y - 0.1, z + rz * half],
      ];
    };
    for (let i = a - 4; i < b + 4; i++) {
      const A = sec(i);
      const B = sec(i + 1);
      for (let k = 0; k < 3; k++) slab.push(...A[k], ...B[k], ...A[k + 1], ...A[k + 1], ...B[k], ...B[k + 1]);
    }
    // Piers every 36 m, two columns under the expressway's carriageways.
    for (let i = a + 6; i < b - 3; i += 18) {
      const yaw = Math.atan2(w.tx[i], w.tz[i]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      for (const d of rd.def.kind === 'highway' ? [-rd.half * 0.5, rd.half * 0.5] : [0]) {
        const x = w.x[i] - w.tz[i] * d;
        const z = w.z[i] + w.tx[i] * d;
        const g = worldHeight(w, x, z, -1);
        // Not standing in the road underneath.
        if (coveredBy(w, x, z, g, w.road[a], 1.5)) continue;
        const top = w.y[i] - 1.8;
        const hgt = top - g + 1;
        if (hgt < 1) continue;
        piers.push(new THREE.Matrix4().compose(v.set(x, g - 1 + hgt / 2, z), q, s.set(2.2, hgt, 3.2)));
      }
    }
  }
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(slab, 3));
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9, side: THREE.DoubleSide })));
  deck.castShadow = deck.receiveShadow = true;
  scene.add(deck);
  if (piers.length) {
    const im = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), concrete, piers.length);
    piers.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  }
}

// ---------------------------------------------------------------------------------------------
// The city

/** Office glass, flats' plaster and the shops' colours. */
const GLASS = [0x8fa6bd, 0x9fb0c0, 0x7d93a8, 0xb7c3cc, 0x6f8799, 0xa6b8b0];
const PLASTER = [0xe8dccb, 0xd9c7b0, 0xc9d1d6, 0xe6d3c3, 0xb9a48e, 0xd8d0c4, 0xc4b6a4];

function city(scene: THREE.Scene, w: World, keep: Keep, low: boolean) {
  const tower = towerFacade(WORLD.seed);
  const flats = facade(WORLD.seed, 'coast');
  for (const x of [tower.map, tower.glow, flats.map, flats.glow]) keep(x);
  const glowK = 0.35;
  const towerMat = keep(facadeMaterial(new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: glowK, vertexColors: true, roughness: 0.35, metalness: 0.3, envMapIntensity: 1.3 }), tower));
  const flatsMat = keep(facadeMaterial(new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: glowK * 0.8, vertexColors: true, roughness: 0.3 }), flats));
  const roofMat = keep(new THREE.MeshStandardMaterial({ color: 0x9a978f, map: keep(roofDeck(WORLD.seed)), roughness: 0.95 }));
  const T: number[][] = [[], [], [], []]; // pos, uv, colour, fac for towers
  const F: number[][] = [[], [], [], []];
  const R: number[] = [];
  const beacons: THREE.Vector3[] = [];
  const rnd = mulberry(WORLD.seed + 77);
  const c = new THREE.Color();
  for (const b of w.buildings) {
    const glass = b.kind === 0 || b.kind === 3;
    const out = glass ? T : F;
    const tw = glass ? TOWER_W : FACADE_W;
    const th = glass ? TOWER_H : FACADE_H;
    c.setHex(glass ? GLASS[b.seed % GLASS.length] : PLASTER[b.seed % PLASTER.length]);
    if (b.kind === 2) c.offsetHSL(0, 0, -0.05);
    const x0 = b.x - b.hx;
    const x1 = b.x + b.hx;
    const z0 = b.z - b.hz;
    const z1 = b.z + b.hz;
    const y0 = b.y;
    const y1 = b.y + b.h;
    // Four walls, uv in facade tiles (offset per building so neighbours don't line up).
    const u0 = (b.seed % 7) * 0.25;
    const walls: [number, number, number, number][] = [
      [x0, z1, x1, z1],
      [x1, z1, x1, z0],
      [x1, z0, x0, z0],
      [x0, z0, x0, z1],
    ];
    for (const [ax, az, bx, bz] of walls) {
      const len = Math.hypot(bx - ax, bz - az);
      const U = len / tw;
      const V = (y1 - y0) / th;
      const p = [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ];
      const t = [
        [u0, 0],
        [u0 + U, 0],
        [u0 + U, V],
        [u0, V],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        out[0].push(...p[k]);
        out[1].push(...t[k]);
        out[2].push(c.r, c.g, c.b);
        pushFac(out[3], 1, (b.seed >> 3) % FAC_STYLES, y0, y1);
      }
    }
    // Flat roof, and a smaller box on top (plant room) for the taller ones.
    R.push(x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0);
    if (b.h > 30) {
      const px = b.hx * 0.35;
      const pz = b.hz * 0.35;
      box(R, b.x - px, y1, b.z - pz, b.x + px, y1 + 3.5, b.z + pz);
      beacons.push(new THREE.Vector3(b.x, y1 + 4 + (b.kind === 3 ? 14 : 0), b.z));
      if (b.kind === 3) box(R, b.x - 0.4, y1 + 3.5, b.z - 0.4, b.x + 0.4, y1 + 18, b.z + 0.4); // spire
    }
    void rnd;
  }
  for (const [arr, mat] of [
    [T, towerMat],
    [F, flatsMat],
  ] as const) {
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr[0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(arr[1], 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr[2], 3));
    geo.setAttribute('fac', new THREE.Float32BufferAttribute(arr[3], 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = !low;
    m.receiveShadow = true;
    scene.add(m);
  }
  const roof = keep(new THREE.BufferGeometry());
  roof.setAttribute('position', new THREE.Float32BufferAttribute(R, 3));
  roof.setAttribute('uv', new THREE.BufferAttribute(roofUv(R), 2));
  roof.computeVertexNormals();
  const rm = new THREE.Mesh(roof, roofMat);
  rm.castShadow = !low;
  rm.receiveShadow = true;
  scene.add(rm);
  // Red aircraft beacons on the tall ones.
  const bm = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.45, 8, 6)), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 1.2, 0.8) })), beacons.length);
  const m4 = new THREE.Matrix4();
  beacons.forEach((p, i) => bm.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  bm.computeBoundingSphere();
  scene.add(bm);
  void CITY;
}

/** An axis-aligned box's six faces as triangles (outward). */
function box(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const f = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [5, 1, 2, 6],
    [0, 4, 7, 3],
    [7, 6, 2, 3],
    [0, 1, 5, 4],
  ];
  for (const [a, b, c, d] of f) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
}

// ---------------------------------------------------------------------------------------------
// Street lamps

function lamps(scene: THREE.Scene, w: World, keep: Keep) {
  const pole = keep(new THREE.CylinderGeometry(0.09, 0.13, 1, 6));
  pole.translate(0, 0.5, 0);
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x6d7176, metalness: 0.6, roughness: 0.45 }));
  const head = keep(new THREE.BoxGeometry(0.5, 0.18, 1.1));
  // Pale lamp housings: it's afternoon, so they're off (just a little brighter than grey under the sky).
  const headMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.25, 1.12) }));
  const poles: THREE.Matrix4[] = [];
  const heads: THREE.Matrix4[] = [];
  const arms: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (const rd of w.roads) {
    const kind = rd.def.kind;
    if (kind !== 'highway' && kind !== 'avenue' && kind !== 'street' && kind !== 'ramp') continue;
    const n = rd.i1 - rd.i0;
    const every = kind === 'highway' ? 22 : 16; // samples
    for (let k = 0; k < n; k += every) {
      const i = rd.i0 + k;
      if (w.deck[i] && kind !== 'highway') continue;
      // The expressway's lamps stand on the median, an arm over each carriageway; the city's on both kerbs.
      const spots = kind === 'highway' ? [0] : [-(rd.half + 2.2), rd.half + 2.2];
      for (const d of spots) {
        const x = w.x[i] - w.tz[i] * d;
        const z = w.z[i] + w.tx[i] * d;
        const y = w.y[i] - w.bank[i] * d;
        if (kind !== 'highway' && coveredBy(w, x, z, y, w.road[i], 1)) continue;
        const hgt = kind === 'highway' ? 11 : 8;
        poles.push(new THREE.Matrix4().compose(v.set(x, y, z), q.identity(), s.set(1, hgt, 1)));
        const sides = kind === 'highway' ? [-1, 1] : [d < 0 ? 1 : -1];
        for (const side of sides) {
          const reach = kind === 'highway' ? 3.2 : 1.8;
          const ax = -w.tz[i] * side;
          const az = w.tx[i] * side;
          // The arm and the head run out over the road (their boxes' long side is z).
          q.setFromAxisAngle(up, Math.atan2(ax, az));
          arms.push(new THREE.Matrix4().compose(v.set(x + ax * reach * 0.5, y + hgt - 0.2, z + az * reach * 0.5), q, s.set(0.1, 0.1, reach)));
          heads.push(new THREE.Matrix4().compose(v.set(x + ax * reach, y + hgt - 0.3, z + az * reach), q, s.set(1, 1, 1)));
        }
      }
    }
  }
  const arm = keep(new THREE.BoxGeometry(1, 1, 1));
  for (const [list, geo, mat, shadow] of [
    [poles, pole, poleMat, true],
    [arms, arm, poleMat, false],
    [heads, head, headMat, false],
  ] as const) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow;
    im.computeBoundingSphere();
    scene.add(im);
  }
}

// ---------------------------------------------------------------------------------------------
// Landmarks

function landmarks(scene: THREE.Scene, w: World, keep: Keep) {
  const red = keep(new THREE.MeshStandardMaterial({ color: 0xc8321e, roughness: 0.6 }));
  const black = keep(new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.7 }));
  const white = keep(new THREE.MeshStandardMaterial({ color: 0xece8e0, roughness: 0.7 }));
  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.6, roughness: 0.45 }));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // A torii where the pass meets the summit loop, facing down the road.
  {
    const pass = w.byId.get('pass')!;
    const i = pass.i1 - 30;
    const yaw = Math.atan2(w.tx[i], w.tz[i]);
    const x = w.x[i];
    const z = w.z[i];
    const y = w.y[i];
    const span = pass.half + SHOULDER + 1.2;
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.32, 0.38, 7.2, 12)), red);
      p.position.set(s * span, 3.6, 0);
      g.add(p);
    }
    const kasagi = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 3.2, 0.55, 0.9)), black);
    kasagi.position.y = 7.4;
    const shimaki = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 2.4, 0.4, 0.6)), red);
    shimaki.position.y = 6.9;
    const nuki = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 1.2, 0.3, 0.4)), red);
    nuki.position.y = 5.6;
    g.add(kasagi, shimaki, nuki);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    scene.add(g);
  }
  // The airfield: a control tower and two hangars by the runway's east end.
  {
    const rw = w.byId.get('runway')!;
    const i = rw.i1 - 120;
    const y = w.y[i];
    const x = w.x[i];
    const z = w.z[i] - rw.half - 70;
    add(new THREE.CylinderGeometry(3, 3.6, 18, 12), white, x + 120, y + 9, z);
    add(new THREE.CylinderGeometry(5.5, 4.2, 4, 8), metal, x + 120, y + 20, z);
    for (const k of [0, 1]) {
      const hangar = new THREE.CylinderGeometry(16, 16, 46, 16, 1, false, 0, Math.PI);
      hangar.rotateZ(Math.PI / 2);
      hangar.rotateY(Math.PI / 2);
      add(hangar, metal, x - 40 - k * 60, y, z - 10);
      add(new THREE.BoxGeometry(32, 1, 46), black, x - 40 - k * 60, y + 0.5, z - 10);
    }
  }
  // A lighthouse on the east coast, past the Bayshore straight.
  {
    const x = 2620;
    const z = -420;
    const y = worldHeight(w, x, z, -1);
    if (y > w.water) {
      add(new THREE.CylinderGeometry(2.2, 3.4, 26, 16), white, x, y + 13, z);
      add(new THREE.CylinderGeometry(2.25, 2.6, 4, 16), red, x, y + 22, z);
      add(new THREE.CylinderGeometry(1.8, 1.8, 3, 12), keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 4.5) })), x, y + 27.5, z);
      add(new THREE.ConeGeometry(2.6, 2.4, 12), red, x, y + 30.2, z);
    }
  }
  // Speed-trap gantries over the fast roads, with their boards.
  const board = keep(trapBoard());
  const boardMat = keep(new THREE.MeshStandardMaterial({ map: board, emissive: 0xffffff, emissiveMap: board, emissiveIntensity: 1.2, roughness: 0.5 }));
  for (const tr of w.traps) {
    const y = worldHeight(w, tr.x, tr.z, -1);
    const yaw = Math.atan2(tr.tx, tr.tz);
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 7.5, 0.4)), metal);
      leg.position.set(s * (tr.half + 1.5), 3.75, 0);
      g.add(leg);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(tr.half * 2 + 3.4, 0.6, 0.6)), metal);
    beam.position.y = 7.2;
    const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 2.2)), boardMat);
    sign.position.set(0, 8.7, -0.05);
    sign.rotation.y = Math.PI;
    const back = new THREE.Mesh(keep(new THREE.BoxGeometry(9.2, 2.4, 0.2)), black);
    back.position.set(0, 8.7, 0.08);
    g.add(beam, sign, back);
    g.position.set(tr.x, y, tr.z);
    g.rotation.y = yaw;
    scene.add(g);
  }
}

function trapBoard(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0d10';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffb21e';
  g.font = '800 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SPEED TRAP', 256, 52);
  g.fillStyle = '#ff3b2f';
  g.font = '700 30px system-ui, sans-serif';
  g.fillText('▼  km/h  ▼', 256, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Forests

interface TreeTile {
  x: number;
  z: number;
  group: THREE.Group;
}

function forest(scene: THREE.Scene, w: World, look: Look, keep: Keep, low: boolean, lods: LodTiles): TreeTile[] {
  const lowland = speciesFor('coast');
  const upland = speciesFor('alpine');
  for (const s of [lowland, upland]) for (const sp of [s.a, s.b]) keep(sp.geo);
  // On High each tile's shadow comes from small shadow-only copies (lod.ts shadowCasters); Low draws no shadows.
  const shadowOnly = low ? null : new ShadowOnly(scene);
  // Past LOD.trees each tile's trees swap to stand-ins a third to a fifth the triangles (trees.ts farTree).
  const fars = [lowland.a, lowland.b, upland.a, upland.b].map((sp) => (sp.noFar ? null : keep(farTree(sp.geo))));
  const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }));
  sway(mat, 0.0026, 1.5);
  const rock = keep(rockGeometry());
  const rockMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(...look.rock).multiplyScalar(1.05), roughness: 1, flatShading: true }));
  const rng = mulberry(WORLD.seed * 7919);
  const tiles: TreeTile[] = [];
  const TILE = 400;
  const SP = low ? 14 : 10;
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const jitter = new THREE.Color();
  for (let tx = AREA.x0; tx < AREA.x1; tx += TILE)
    for (let tz = AREA.z0; tz < AREA.z1; tz += TILE) {
      const bins: THREE.Matrix4[][] = [[], [], [], []];
      const colours: THREE.Color[][] = [[], [], [], []];
      const rocks: THREE.Matrix4[] = [];
      for (let x = tx; x < tx + TILE; x += SP)
        for (let z = tz; z < tz + TILE; z += SP) {
          const px = x + rng() * SP;
          const pz = z + rng() * SP;
          const roll = rng();
          const gap = roadGap(w, px, pz);
          if (gap < 6) continue;
          if (cityAt(px, pz) > 0.2) continue;
          const h = worldHeight(w, px, pz, -1);
          if (h < w.water + 3) continue;
          const slope = Math.abs(worldHeight(w, px + 2, pz, -1) - h) + Math.abs(worldHeight(w, px, pz + 2, -1) - h);
          const woods = forestNoise(px, pz) + h / 900;
          // Near the roads, mostly where the woods are; thinning out with distance.
          const near = gap < 60 ? 1 : gap < TREE_REACH ? 1 - (gap - 60) / (TREE_REACH - 60) : 0;
          if (woods > 0.02 && roll < 0.75 * near && slope < 3.4) {
            const sc = 0.75 + rng() * 0.7;
            q.setFromAxisAngle(up, rng() * Math.PI * 2);
            const hi = h > 150 + fbm(px / 90, pz / 90, 5, 2) * 40;
            const sp = hi ? upland : lowland;
            const b = rng() < sp.share ? 1 : 0;
            const k = (hi ? 2 : 0) + b;
            bins[k].push(new THREE.Matrix4().compose(v.set(px, h - 0.2, pz), q, s.set(sc, sc * (0.85 + rng() * 0.4), sc)));
            colours[k].push(jitter.setRGB(1, 1, 1).offsetHSL((rng() - 0.5) * 0.04, 0, 0).multiplyScalar(0.8 + rng() * 0.35).clone());
          } else if (roll > 0.985 - (slope > 2.5 ? 0.05 : 0) && near > 0) {
            const sc = 0.5 + rng() * 2;
            q.setFromEuler(new THREE.Euler(rng(), rng() * 6, rng()));
            rocks.push(new THREE.Matrix4().compose(v.set(px, h - sc * 0.3, pz), q, s.set(sc, sc * 0.7, sc)));
          }
        }
      const group = new THREE.Group();
      const geos = [lowland.a.geo, lowland.b.geo, upland.a.geo, upland.b.geo];
      bins.forEach((list, k) => {
        // Low: every other tree.
        const keepList = low ? list.filter((_, i) => i % 2 === 0) : list;
        if (!keepList.length) return;
        const im = new THREE.InstancedMesh(geos[k], mat, keepList.length);
        keepList.forEach((m, i) => {
          im.setMatrixAt(i, m);
          im.setColorAt(i, colours[k][low ? i * 2 : i]);
        });
        im.castShadow = !low;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
        shadowCasters(group, im, shadowOnly); // before the twin, which copies castShadow
        const far = fars[k];
        if (!far) return;
        const lo = farTwin(im, far);
        group.add(lo);
        lods.add(im, lo, tx, tz, tx + TILE, tz + TILE, LOD.trees);
      });
      if (rocks.length) {
        const im = new THREE.InstancedMesh(rock, rockMat, rocks.length);
        rocks.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = !low;
        im.computeBoundingSphere();
        group.add(im);
        shadowCasters(group, im, shadowOnly);
      }
      if (!group.children.length) continue;
      scene.add(group);
      tiles.push({ x: tx + TILE / 2, z: tz + TILE / 2, group });
    }
  return tiles;
}
