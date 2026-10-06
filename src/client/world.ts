import * as THREE from 'three';
import type { Box } from '../shared/collision.ts';
import type { MapData } from '../shared/map.ts';
import {
  cloudSeaTexture,
  cloudTexture,
  earthSideTexture,
  grassTexture,
  padTexture,
  rng,
  rockTexture,
  softDot,
  toonRamp,
  wallTexture,
  woodTexture,
} from './textures.ts';

// Painterly sky-island look (think Castle in the Sky): warm sun, soft cel shading,
// cumulus clouds, a sea of clouds below, hazy distant islands.

export const PALETTE = {
  zenith: 0x3f8fd6,
  sky: 0x8cc6ee,
  horizon: 0xf6ecd4,
  below: 0xdde8f2,
  deep: 0xa7bfd9,
  fog: 0xcfe3ef,
  sun: 0xffe3b3,
  skyLight: 0xcde8ff,
  groundBounce: 0xa7b98a, // warm meadow bounce keeps shadows soft, never black
};

const SUN_DIR = new THREE.Vector3(55, 70, 30).normalize();

/** Box geometry with UVs in world metres ÷ tile. With anchorTop, side faces put v=1 at the top edge. */
function boxGeometry(b: Box, tile: number, anchorTop = false): THREE.BoxGeometry {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const faces: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    const side = f !== 2 && f !== 3;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = (uv.getX(k) * faces[f][0]) / tile;
      const v = anchorTop && side ? 1 - ((1 - uv.getY(k)) * faces[f][1]) / tile : (uv.getY(k) * faces[f][1]) / tile;
      uv.setXY(k, u, v);
    }
  }
  return geo;
}

function toon(params: THREE.MeshToonMaterialParameters) {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

export interface World {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  pads: THREE.Object3D[];
  update(time: number): void;
}

export function buildWorld(map: MapData, renderer: THREE.WebGLRenderer): World {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 110, 460);
  scene.add(makeSky());

  scene.add(new THREE.HemisphereLight(PALETTE.skyLight, PALETTE.groundBounce, 1.5));
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -90;
  sc.right = sc.top = 90;
  sc.near = 1;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // --- Materials -------------------------------------------------------------
  const grass = toon({ map: grassTexture(renderer) });
  const earth = toon({ map: earthSideTexture(renderer) });
  const rockTex = rockTexture(renderer);
  // Undersides face away from the sun; a little warm emissive keeps them painterly instead of black.
  const rock = toon({ map: rockTex, color: 0xd9c6ae, emissive: new THREE.Color(0x4a3a2c), emissiveIntensity: 0.6 });
  const underside = toon({ map: rockTex, color: 0xb8a48c, emissive: new THREE.Color(0x3a2d22), emissiveIntensity: 0.5 });
  const wall = toon({ map: wallTexture(renderer) });
  const wallTop = toon({ map: grass.map, color: 0xd6e8b0 }); // mossy cap
  const wood = toon({ map: woodTexture(renderer) });
  const padMat = toon({ map: padTexture(renderer), emissive: new THREE.Color(0x58e0b8), emissiveIntensity: 0.5 });

  const pads: THREE.Object3D[] = [];
  const floorTops: Box[] = [];
  const padBoxes: Box[] = [];
  const r = rng(5);

  for (const b of map.boxes) {
    let mesh: THREE.Mesh;
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    switch (b.kind) {
      case 'floor':
        // [+x, -x, top, bottom, +z, -z]
        mesh = new THREE.Mesh(boxGeometry(b, 2, true), [earth, earth, grass, underside, earth, earth]);
        floorTops.push(b);
        scene.add(islandUnderside(b, rock, r));
        break;
      case 'wall':
        mesh = new THREE.Mesh(boxGeometry(b, 3), [wall, wall, wallTop, underside, wall, wall]);
        break;
      case 'cover':
        mesh = new THREE.Mesh(boxGeometry(b, 2), wood);
        break;
      case 'pad':
        mesh = new THREE.Mesh(boxGeometry(b, b.max.x - b.min.x), padMat);
        padBoxes.push(b);
        pads.push(mesh, ...windSpirit(scene, b));
        break;
    }
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  scene.add(meadow(floorTops, padBoxes, map.boxes, r));
  scene.add(cloudSea(renderer));
  const clouds = cumulus();
  scene.add(clouds);
  scene.add(distantIslands(rock, grass, r));
  const motes = driftingSeeds();
  scene.add(motes.points);

  return {
    scene,
    sun,
    pads,
    update(time: number) {
      const pulse = 0.35 + 0.25 * Math.sin(time * 3);
      padMat.emissiveIntensity = pulse;
      for (const p of pads) {
        const d = p.userData as { baseY?: number; phase?: number };
        if (d.baseY === undefined) continue;
        const k = (time * 0.7 + d.phase!) % 1;
        p.position.y = d.baseY + k * 2.6;
        p.rotation.y = time * 2 + d.phase! * 6;
        p.scale.setScalar(1 - k * 0.5);
        (p as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = Math.sin(k * Math.PI) * 0.85;
      }
      clouds.children.forEach((c, i) => {
        c.position.x += Math.sin(i) * 0.002 + 0.01;
        if (c.position.x > 700) c.position.x = -700;
      });
      motes.update(time);
    },
  };
}

// ---------------------------------------------------------------------------

function makeSky(): THREE.Mesh {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(PALETTE.zenith) },
        sky: { value: new THREE.Color(PALETTE.sky) },
        horizon: { value: new THREE.Color(PALETTE.horizon) },
        below: { value: new THREE.Color(PALETTE.below) },
        deep: { value: new THREE.Color(PALETTE.deep) },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith; uniform vec3 sky; uniform vec3 horizon; uniform vec3 below; uniform vec3 deep; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c;
          if (h > 0.0) {
            c = mix(horizon, sky, smoothstep(0.0, 0.18, h));
            c = mix(c, zenith, smoothstep(0.18, 0.85, h));
          } else {
            c = mix(horizon, below, smoothstep(0.0, 0.06, -h));
            c = mix(c, deep, smoothstep(0.1, 0.9, -h));
          }
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.86, 0.6) * (pow(s, 8.0) * 0.25 + pow(s, 200.0) * 0.6);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

/** Craggy inverted cone of rock hanging below a floor box, like a Laputa island. Visual only. */
function islandUnderside(b: Box, mat: THREE.Material, r: () => number): THREE.Mesh {
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const h = THREE.MathUtils.clamp(Math.min(sx, sz) * 0.8, 2.5, 16);
  const geo = new THREE.ConeGeometry(1, h, 9, 4);
  geo.rotateX(Math.PI); // point down
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > h / 2 - 1e-3) continue; // keep the top rim flush with the box
    const k = 0.75 + r() * 0.5;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, y + (r() - 0.5) * h * 0.08);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(sx * 0.5, 1, sz * 0.5);
  mesh.position.set((b.min.x + b.max.x) / 2, b.min.y - h / 2 + 0.01, (b.min.z + b.max.z) / 2);
  mesh.rotation.y = r() * 0.3;
  mesh.receiveShadow = true;
  return mesh;
}

/** Rising translucent rings above a pad: the wind spirit that throws you. */
function windSpirit(scene: THREE.Scene, b: Box): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const size = b.max.x - b.min.x;
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.38, 0.05, 6, 28, Math.PI * 1.4),
      new THREE.MeshBasicMaterial({ color: 0xf2fff8, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
    ring.userData = { baseY: b.max.y + 0.05, phase: i / 3 };
    scene.add(ring);
    out.push(ring);
  }
  return out;
}

/** Instanced grass tufts and flowers on floor tops (tiny, so they never hide players). */
function meadow(floors: Box[], pads: Box[], all: Box[], r: () => number): THREE.Group {
  const group = new THREE.Group();
  const tuftGeo = grassClump();
  const flowerGeo = new THREE.IcosahedronGeometry(0.07, 0);
  flowerGeo.translate(0, 0.2, 0);
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 2500);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 700);
  const blocked = (x: number, y: number, z: number) =>
    pads.some((p) => x > p.min.x - 0.2 && x < p.max.x + 0.2 && z > p.min.z - 0.2 && z < p.max.z + 0.2) ||
    all.some((o) => o.kind !== 'floor' && x > o.min.x && x < o.max.x && z > o.min.z && z < o.max.z && o.min.y <= y + 0.3 && o.max.y > y);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const flowerColors = [0xfff6dc, 0xffd66e, 0xf6a9bd, 0xc9b6ff].map((c) => new THREE.Color(c));
  let nt = 0;
  let nf = 0;
  const totalArea = floors.reduce((a, b) => a + (b.max.x - b.min.x) * (b.max.z - b.min.z), 0);
  for (const b of floors) {
    const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
    const count = Math.round((area / totalArea) * tufts.count);
    for (let i = 0; i < count && nt < tufts.count; i++) {
      const x = b.min.x + 0.15 + r() * (b.max.x - b.min.x - 0.3);
      const z = b.min.z + 0.15 + r() * (b.max.z - b.min.z - 0.3);
      if (blocked(x, b.max.y, z)) continue;
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3));
      const k = 0.7 + r() * 0.7;
      m.compose(p.set(x, b.max.y, z), q, s.set(k, k, k));
      tufts.setMatrixAt(nt++, m);
      if (r() < 0.22 && nf < flowers.count) {
        m.compose(p.set(x + (r() - 0.5) * 0.3, b.max.y, z + (r() - 0.5) * 0.3), q, s.set(1, 1, 1));
        flowers.setMatrixAt(nf, m);
        flowers.setColorAt(nf++, flowerColors[Math.floor(r() * flowerColors.length)]);
      }
    }
  }
  tufts.count = nt;
  flowers.count = nf;
  tufts.receiveShadow = true;
  group.add(tufts, flowers);
  return group;
}

/** A clump of 5 thin curved blades: dark at the root, sunlit at the tips. */
function grassClump(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const root = new THREE.Color(0x5a8f3a);
  const tip = new THREE.Color(0xc6e38a);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + i;
    const h = 0.22 + (i % 3) * 0.07;
    const lean = 0.06 + (i % 2) * 0.05;
    const w = 0.035;
    const cx = Math.cos(a) * 0.04;
    const cz = Math.sin(a) * 0.04;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(root.r, root.g, root.b, root.r, root.g, root.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Sea of clouds far below: the void you fall into. */
function cloudSea(renderer: THREE.WebGLRenderer): THREE.Mesh {
  const tex = cloudSeaTexture(renderer);
  tex.repeat.set(8, 8);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -45;
  sea.renderOrder = -1;
  return sea;
}

/** Big sunlit cumulus billboards around the horizon, plus puffs rising out of the cloud sea. */
function cumulus(): THREE.Group {
  const g = new THREE.Group();
  const textures = [1, 2, 3, 4].map((s) => cloudTexture(s * 97));
  const r = rng(9);
  const add = (dist: number, y: number, w: number, opacity = 1) => {
    const a = r() * Math.PI * 2;
    const mat = new THREE.SpriteMaterial({ map: textures[Math.floor(r() * textures.length)], fog: false, depthWrite: false, transparent: true, opacity });
    const sp = new THREE.Sprite(mat);
    sp.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
    sp.scale.set(w, w * 0.5, 1);
    g.add(sp);
  };
  for (let i = 0; i < 26; i++) add(380 + r() * 300, 10 + r() * 130, 180 + r() * 220);
  for (let i = 0; i < 26; i++) add(120 + r() * 300, -50 + r() * 15, 70 + r() * 90, 0.9);
  return g;
}

/** Hazy floating islands in the distance, some with a tree or a ruined column. */
function distantIslands(rock: THREE.Material, grass: THREE.Material, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = toon({ color: 0x7a5236 });
  const leaves = [toon({ color: 0x4f8a3c }), toon({ color: 0x6aa548 }), toon({ color: 0x3f7434 })];
  const stone = toon({ color: 0xe8d8bb });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + r() * 0.4;
    const dist = 150 + r() * 220;
    const rad = 8 + r() * 22;
    const island = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.92, rad * 0.25, 14), [grass, grass, grass]);
    const under = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.92, rad * 1.8, 10), rock);
    under.rotation.x = Math.PI;
    under.position.y = -rad * 0.125 - rad * 0.9;
    island.add(top, under);
    if (r() < 0.7) {
      // A big round Ghibli tree.
      const t = new THREE.Group();
      const th = rad * (0.5 + r() * 0.5);
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.05, rad * 0.08, th, 6), trunk);
      tr.position.y = th / 2;
      t.add(tr);
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rad * (0.22 + r() * 0.15), 1), leaves[k % 3]);
        s.position.set((r() - 0.5) * rad * 0.5, th + (r() - 0.3) * rad * 0.25, (r() - 0.5) * rad * 0.5);
        t.add(s);
      }
      t.position.set((r() - 0.5) * rad * 0.6, rad * 0.125, (r() - 0.5) * rad * 0.6);
      island.add(t);
    } else {
      for (let k = 0; k < 3; k++) {
        const ch = rad * (0.3 + r() * 0.5);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.06, rad * 0.07, ch, 8), stone);
        col.position.set((r() - 0.5) * rad, rad * 0.125 + ch / 2, (r() - 0.5) * rad);
        island.add(col);
      }
    }
    island.position.set(Math.cos(a) * dist, -30 + r() * 80, Math.sin(a) * dist);
    island.rotation.y = r() * 6;
    g.add(island);
  }
  return g;
}

/** Dandelion seeds / dust motes drifting on the breeze through the play space. */
function driftingSeeds() {
  const N = 450;
  const pos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  const r = rng(77);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (r() - 0.5) * 140;
    pos[i * 3 + 1] = -8 + r() * 45;
    pos[i * 3 + 2] = (r() - 0.5) * 180;
    seeds[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ map: softDot(), color: 0xfff6e0, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  points.frustumCulled = false;
  let last = 0;
  return {
    points,
    update(time: number) {
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        pos[i * 3] += (1.2 + Math.sin(time * 0.3 + s) * 0.6) * dt;
        pos[i * 3 + 1] += Math.sin(time * 0.8 + s * 1.7) * 0.25 * dt;
        pos[i * 3 + 2] += Math.cos(time * 0.4 + s) * 0.4 * dt;
        if (pos[i * 3] > 70) pos[i * 3] = -70;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
