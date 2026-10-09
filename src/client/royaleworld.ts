import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box } from '../shared/collision.ts';
import type { MapData } from '../shared/map.ts';
import { barkTexture, earthSideTexture, grassTexture, padTexture, rng, rockTexture, surfTexture, wallTexture, woodTexture } from './textures.ts';
import { type Animated, CLOUD_DRIFT, type World, boxGeometry, cloudSea, cumulus, distantIslands, hookRing, makeSky, meadow, puffball, rampGeometry, toon, windGate, windSpirit } from './world.ts';

// Wildmere, the Battle Royale island: Windward's painted sky-island look, in a golden late afternoon, at five times the
// size. Built for that size: every static box is baked into one merged mesh per material (a dozen draw calls for ~850
// boxes), tree canopies are instanced, and the sun's shadow follows the player instead of covering the whole island.

const PALETTE = {
  zenith: 0x4a8fd0,
  sky: 0x9ccbec,
  horizon: 0xfbe6c4,
  below: 0xe6e3ec,
  deep: 0xb1bfd8,
  fog: 0xe3e6e2,
  sun: 0xffdcae,
  skyLight: 0xd4e8ff,
  groundBounce: 0xb0b98a,
};
const SUN_DIR = new THREE.Vector3(-45, 62, 38).normalize();
/** Half the width of the patch around the player that gets sun shadows. */
const SHADOW_SPAN = 75;

export interface WildWorld extends World {
  /** Where the camera is: the sun's shadow follows it. */
  setViewer(p: THREE.Vector3): void;
}

/** One piece of `geo` per material group (by materialIndex), moved to `at`, ready to merge with others of that material. */
function pieces(geo: THREE.BufferGeometry, at: THREE.Vector3): (THREE.BufferGeometry | undefined)[] {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const out: (THREE.BufferGeometry | undefined)[] = [];
  for (const g of flat.groups) {
    const part = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = flat.getAttribute(name) as THREE.BufferAttribute;
      part.setAttribute(name, new THREE.BufferAttribute(a.array.slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
    }
    part.translate(at.x, at.y, at.z);
    out[g.materialIndex ?? 0] = part;
  }
  return out;
}

export function buildWildmere(map: MapData, renderer: THREE.WebGLRenderer): WildWorld {
  const scene = new THREE.Scene();
  const P = PALETTE;
  scene.fog = new THREE.Fog(P.fog, 170, 680);
  scene.add(makeSky(P, SUN_DIR));
  scene.add(new THREE.HemisphereLight(P.skyLight, P.groundBounce, 1.5));
  const sun = new THREE.DirectionalLight(P.sun, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -SHADOW_SPAN;
  sc.right = sc.top = SHADOW_SPAN;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  // --- Materials (Windward's) ----------------------------------------------
  const grass = toon({ map: grassTexture(renderer) });
  const earth = toon({ map: earthSideTexture(renderer) });
  const rockTex = rockTexture(renderer);
  const rock = toon({ map: rockTex, color: 0xd9c6ae, emissive: new THREE.Color(0x4a3a2c), emissiveIntensity: 0.6 });
  const underside = toon({ map: rockTex, color: 0xb8a48c, emissive: new THREE.Color(0x3a2d22), emissiveIntensity: 0.5 });
  const wall = toon({ map: wallTexture(renderer) });
  const wallTop = toon({ map: grass.map, color: 0xd6e8b0 });
  const wood = toon({ map: woodTexture(renderer) });
  const bark = toon({ map: barkTexture(renderer) });
  const surf = toon({ map: surfTexture(renderer), emissive: new THREE.Color(0x2c5a78), emissiveIntensity: 0.25 });
  const padMat = toon({ map: padTexture(renderer), emissive: new THREE.Color(0x58e0b8), emissiveIntensity: 0.5 });
  const FACES: Partial<Record<Box['kind'], THREE.Material[]>> = {
    floor: [earth, earth, grass, underside, earth, earth],
    wall: [wall, wall, wallTop, underside, wall, wall],
    cover: [wood, wood, wood, wood, wood, wood],
    trunk: [bark, bark, wallTop, underside, bark, bark],
    branch: [bark, bark, wallTop, bark, bark, bark],
  };

  // --- Static boxes, baked per material ---------------------------------------
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (mats: THREE.Material[], geo: THREE.BufferGeometry, at: THREE.Vector3) =>
    pieces(geo, at).forEach((g, i) => g && (buckets.get(mats[i]) ?? buckets.set(mats[i], []).get(mats[i])!).push(g));
  const centre = (b: Box) => new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  const animated: Animated[] = [];
  const floorTops: Box[] = [];
  const padBoxes: Box[] = [];
  const pads: THREE.Object3D[] = [];
  const r = rng(11);
  for (const b of map.boxes) {
    if (b.ramp) {
      put(b.kind === 'surf' ? [surf, underside] : [grass, earth], rampGeometry(b, 2), new THREE.Vector3());
      continue;
    }
    if (b.kind === 'hook') {
      animated.push(hookRing(...centre(b).toArray(), rock));
      continue;
    }
    if (b.kind === 'pad') {
      const mesh = new THREE.Mesh(boxGeometry(b, b.max.x - b.min.x), padMat);
      mesh.position.copy(centre(b));
      scene.add(mesh);
      padBoxes.push(b);
      pads.push(mesh, ...windSpirit(scene, b));
      continue;
    }
    const mats = FACES[b.kind];
    if (!mats) continue;
    if (b.kind === 'floor' && b.min.y < -10) {
      // The island's ground: a grassy skin over earth, then bare cliff rock down to its underside.
      const skin = { ...b, min: { ...b.min, y: b.max.y - 2 } };
      const cliff = { ...b, max: { ...b.max, y: b.max.y - 2 } };
      put(mats, boxGeometry(skin, 2, true), centre(skin));
      put([rock, rock, rock, underside, rock, rock], boxGeometry(cliff, 6), centre(cliff));
      scene.add(hangingRock(b, underside, r));
      floorTops.push(b);
      continue;
    }
    if (b.kind === 'floor') floorTops.push(b);
    put(mats, boxGeometry(b, b.kind === 'wall' ? 3 : 2, b.kind === 'floor'), centre(b));
  }
  for (const [mat, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const t of map.triggers) animated.push(t.kind === 'boost' ? windGate(t) : puffball(t));
  for (const a of animated) scene.add(a.obj);
  scene.add(canopies(map, r));
  scene.add(meadow(floorTops, padBoxes, map.boxes, r, 9000));
  scene.add(cloudSea(renderer));
  const clouds = cumulus(1.8);
  scene.add(clouds);
  scene.add(distantIslands(rock, grass, r, 420, 380));

  const snap = SHADOW_SPAN * 2 / 2048; // move the shadow in whole texels, so it doesn't shimmer
  return {
    scene,
    setViewer(p) {
      const x = Math.round(p.x / snap) * snap;
      const z = Math.round(p.z / snap) * snap;
      sun.target.position.set(x, p.y, z);
      sun.position.set(x + SUN_DIR.x * 200, p.y + SUN_DIR.y * 200, z + SUN_DIR.z * 200);
    },
    update(time) {
      padMat.emissiveIntensity = 0.35 + 0.25 * Math.sin(time * 3);
      for (const p of pads) {
        const d = p.userData as { baseY?: number; phase?: number };
        if (d.baseY === undefined) continue;
        const k = (time * 0.7 + d.phase!) % 1;
        p.position.y = d.baseY + k * 2.6;
        p.rotation.y = time * 2 + d.phase! * 6;
        p.scale.setScalar(1 - k * 0.5);
        (p as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = Math.sin(k * Math.PI) * 0.85;
      }
      for (const c of clouds.children) {
        const { a, dist } = c.userData as { a: number; dist: number };
        const ang = a + time * CLOUD_DRIFT * (300 / dist);
        c.position.x = Math.cos(ang) * dist;
        c.position.z = Math.sin(ang) * dist;
      }
      for (const a of animated) a.update(time);
    },
  };
}

/** The craggy rock hanging under one stretch of ground, so the island floats like Laputa (and the gorge stays open). */
function hangingRock(b: Box, mat: THREE.Material, r: () => number): THREE.Mesh {
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const h = THREE.MathUtils.clamp(Math.min(sx, sz) * 0.9, 8, 70);
  const geo = new THREE.ConeGeometry(1, h, 12, 5);
  geo.rotateX(Math.PI);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > h / 2 - 1e-3) continue;
    const k = 0.75 + r() * 0.5;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, y + (r() - 0.5) * h * 0.08);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(sx * 0.5, 1, sz * 0.5);
  mesh.position.set((b.min.x + b.max.x) / 2, b.min.y - h / 2 + 0.01, (b.min.z + b.max.z) / 2);
  return mesh;
}

/** Every tree's crown: a cluster of soft leaf blobs over its trunk, all one instanced mesh. You can see (and shoot) through gaps. */
function canopies(map: MapData, r: () => number): THREE.InstancedMesh {
  const crowns = map.decor.filter((d) => d.kind === 'canopy');
  const PER = 6;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon({ color: 0xffffff }), crowns.length * PER);
  const greens = [0x4f8a3c, 0x6aa548, 0x3f7434, 0x7cb356].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (const d of crowns) {
    for (let i = 0; i < PER; i++) {
      const a = (i / PER) * Math.PI * 2 + r();
      const out = i === 0 ? 0 : d.radius * (0.35 + r() * 0.3);
      const s = d.radius * (i === 0 ? 0.85 : 0.5 + r() * 0.25);
      m.compose(new THREE.Vector3(d.pos.x + Math.cos(a) * out, d.pos.y + (i === 0 ? d.radius * 0.45 : r() * d.radius * 0.5), d.pos.z + Math.sin(a) * out), q, new THREE.Vector3(s, s * 0.8, s));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n++, greens[Math.floor(r() * greens.length)]);
    }
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
