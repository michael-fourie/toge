import * as THREE from 'three';
import type { Box, Trigger } from '../shared/collision.ts';
import type { Decor, MapData } from '../shared/map.ts';
import {
  barkTexture,
  cloudSeaTexture,
  cloudTexture,
  earthSideTexture,
  grassTexture,
  padTexture,
  rng,
  rockTexture,
  softDot,
  surfTexture,
  toonRamp,
  wallTexture,
  woodTexture,
} from './textures.ts';

// Painterly sky-island look (think Castle in the Sky): warm sun, soft cel shading,
// cumulus clouds, a sea of clouds below, hazy distant islands.

const PALETTE = {
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

/** True if another box sits within a few metres under `b`'s footprint (cave floor, stalk, room). */
function hasSolidBelow(b: Box, all: readonly Box[]): boolean {
  return all.some(
    (o) =>
      o !== b &&
      o.max.y <= b.min.y + 0.01 &&
      o.max.y > b.min.y - 8 &&
      o.min.x < b.max.x - 0.5 &&
      o.max.x > b.min.x + 0.5 &&
      o.min.z < b.max.z - 0.5 &&
      o.max.z > b.min.z + 0.5,
  );
}

/**
 * Wedge geometry for a ramp (see RampShape): group 0 is the sloped face, group 1 the sides/back/bottom.
 * UVs are world metres ÷ tile; on the slope, u runs across the ramp and v up it.
 */
function rampGeometry(b: Box, tile: number): THREE.BufferGeometry {
  const r = b.ramp!;
  const along = r.axis;
  const across = along === 'x' ? 'z' : 'x';
  const L = b.max[along] - b.min[along];
  const y0 = b.min.y;
  const y1 = b.max.y;
  // Canonical coords: u along the slope axis (0 = low end, L = tall end), w across it.
  const P = (u: number, y: number, w: number): THREE.Vector3 => {
    const p = new THREE.Vector3();
    p[along] = r.rise > 0 ? b.min[along] + u : b.max[along] - u;
    p.y = y;
    p[across] = w;
    return p;
  };
  const w0 = b.min[across];
  const w1 = b.max[across];
  const A = P(0, y0, w0);
  const B = P(0, y0, w1);
  const C = P(L, y1, w1);
  const D = P(L, y1, w0);
  const E = P(L, y0, w0);
  const F = P(L, y0, w1);
  // Centroid of the wedge's six corners: strictly inside the solid. (The bounding-box centre lies
  // exactly on the slope, which made the slope's winding a coin toss and culled the surf faces.)
  const centre = [A, B, C, D, E, F].reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(6);

  const pos: number[] = [];
  const uv: number[] = [];
  const slopeLen = Math.hypot(L, y1 - y0);
  const tri = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3, uvs: [number, number][]) => {
    // Wind each triangle outward (the wedge is convex, so "away from the centre" is outward).
    const n = new THREE.Vector3().subVectors(b2, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = new THREE.Vector3().add(a).add(b2).add(c).divideScalar(3).sub(centre);
    const pts = n.dot(mid) >= 0 ? [a, b2, c] : [a, c, b2];
    const tex = n.dot(mid) >= 0 ? uvs : [uvs[0], uvs[2], uvs[1]];
    for (let i = 0; i < 3; i++) {
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      uv.push(tex[i][0] / tile, tex[i][1] / tile);
    }
  };
  // Planar UVs for the side pieces, by dominant axis.
  const planar = (p: THREE.Vector3, drop: 'x' | 'y' | 'z'): [number, number] =>
    drop === 'x' ? [p.z, p.y] : drop === 'z' ? [p.x, p.y] : [p.x, p.z];

  // Sloped face (group 0).
  const sv = (u: number) => (u / L) * slopeLen;
  tri(A, B, C, [[w0, sv(0)], [w1, sv(0)], [w1, sv(L)]]);
  tri(A, C, D, [[w0, sv(0)], [w1, sv(L)], [w0, sv(L)]]);
  const slopeCount = pos.length / 3;
  // Bottom, tall back face, two triangular sides (group 1).
  const flat = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3, drop: 'x' | 'y' | 'z') =>
    tri(a, b2, c, [planar(a, drop), planar(b2, drop), planar(c, drop)]);
  flat(A, E, F, 'y');
  flat(A, F, B, 'y');
  flat(E, D, C, along);
  flat(E, C, F, along);
  flat(A, D, E, across);
  flat(B, F, C, across);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  geo.addGroup(0, slopeCount, 0);
  geo.addGroup(slopeCount, pos.length / 3 - slopeCount, 1);
  return geo;
}

function toon(params: THREE.MeshToonMaterialParameters) {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

export interface World {
  scene: THREE.Scene;
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
  // Surf ramps: smooth sky-glazed stone with wind streaks along their length, so they read as "ride this".
  const surf = toon({ map: surfTexture(renderer), emissive: new THREE.Color(0x2c5a78), emissiveIntensity: 0.25 });
  const bark = toon({ map: barkTexture(renderer) });

  const pads: THREE.Object3D[] = [];
  const floorTops: Box[] = [];
  const padBoxes: Box[] = [];
  const r = rng(5);

  for (const b of map.boxes) {
    if (b.ramp) {
      // Walkable slide ramps are grassy slopes over earth; surf ramps are glazed stone over rock.
      const mesh = new THREE.Mesh(rampGeometry(b, 2), b.kind === 'surf' ? [surf, underside] : [grass, earth]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      continue;
    }
    let mesh: THREE.Mesh;
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    switch (b.kind) {
      case 'floor':
        // [+x, -x, top, bottom, +z, -z]
        mesh = new THREE.Mesh(boxGeometry(b, 2, true), [earth, earth, grass, underside, earth, earth]);
        floorTops.push(b);
        // Hanging rock only where there's open sky below (not over caves, rooms or stalks).
        if (!hasSolidBelow(b, map.boxes)) scene.add(islandUnderside(b, rock, r));
        break;
      case 'wall':
        mesh = new THREE.Mesh(boxGeometry(b, 3), [wall, wall, wallTop, underside, wall, wall]);
        break;
      case 'cover':
        mesh = new THREE.Mesh(boxGeometry(b, 2), wood);
        break;
      case 'trunk':
        mesh = new THREE.Mesh(boxGeometry(b, 3), [bark, bark, wallTop, underside, bark, bark]);
        break;
      case 'branch': // tree limbs: walkable mossy top over bark, no hanging island rock
        mesh = new THREE.Mesh(boxGeometry(b, 3), [bark, bark, wallTop, bark, bark, bark]);
        break;
      case 'pad':
        mesh = new THREE.Mesh(boxGeometry(b, b.max.x - b.min.x), padMat);
        padBoxes.push(b);
        pads.push(mesh, ...windSpirit(scene, b));
        break;
      default:
        continue;
    }
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const boosters = map.triggers.map((t) => (t.kind === 'boost' ? windGate(t) : puffball(t)));
  boosters.forEach((b) => scene.add(b.obj));
  for (const d of map.decor) scene.add(canopy(d, r));

  scene.add(meadow(floorTops, padBoxes, map.boxes, r));
  scene.add(cloudSea(renderer));
  const clouds = cumulus();
  scene.add(clouds);
  scene.add(distantIslands(rock, grass, r));
  const motes = driftingSeeds();
  scene.add(motes.points);

  return {
    scene,
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
      for (const b of boosters) b.update(time);
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

interface Animated {
  obj: THREE.Object3D;
  update(time: number): void;
}

/** Wind gate: a mint ring across the slab with chevrons streaming through it along the boost direction. */
function windGate(t: Extract<Trigger, { kind: 'boost' }>): Animated {
  const g = new THREE.Group();
  g.position.set((t.min.x + t.max.x) / 2, (t.min.y + t.max.y) / 2, (t.min.z + t.max.z) / 2);
  g.rotation.y = Math.atan2(-t.dir.x, -t.dir.z); // local -Z faces along the boost
  const across = t.dir.x !== 0 ? t.max.z - t.min.z : t.max.x - t.min.x;
  const height = t.max.y - t.min.y;
  const r = Math.min(across, height) / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r, 0.12, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xc8fff0, transparent: true, opacity: 0.75, depthWrite: false }),
  );
  ring.scale.set(across / (2 * r), height / (2 * r), 1);
  g.add(ring);
  const chevronShape = new THREE.Shape();
  chevronShape.moveTo(-0.6, 0.35).lineTo(0, -0.25).lineTo(0.6, 0.35).lineTo(0.6, 0.05).lineTo(0, -0.55).lineTo(-0.6, 0.05).closePath();
  const chevronGeo = new THREE.ShapeGeometry(chevronShape).rotateX(-Math.PI / 2);
  const chevrons: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      chevronGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.scale.setScalar(Math.min(2, r));
    chevrons.push(m);
    g.add(m);
  }
  return {
    obj: g,
    update(time) {
      chevrons.forEach((m, i) => {
        const k = (time * 1.2 + i / 3) % 1;
        m.position.z = 3 - k * 6; // stream through the ring along the boost
        (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * 0.8;
      });
      ring.rotation.z = Math.sin(time * 2) * 0.05;
    },
  };
}

/** Puffball: a squishy spotted mushroom cap that wobbles, sitting on the trigger's floor. */
function puffball(t: Extract<Trigger, { kind: 'bounce' }>): Animated {
  const g = new THREE.Group();
  const size = t.max.x - t.min.x;
  g.position.set((t.min.x + t.max.x) / 2, t.min.y, (t.min.z + t.max.z) / 2);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.18, size * 0.24, 0.5, 14), toon({ color: 0xf6ead2 }));
  stem.position.y = 0.25;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon({ color: 0xf08a8a }));
  cap.position.y = 0.35;
  cap.scale.y = 0.45;
  const spot = toon({ color: 0xfff6e8 });
  const r = rng(Math.round(g.position.x * 7 + g.position.z * 13));
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const el = 0.25 + r() * 0.9;
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.12 + r() * 0.1, 8, 6), spot);
    d.position.set(Math.cos(a) * Math.cos(el) * (size / 2), Math.sin(el) * (size / 2), Math.sin(a) * Math.cos(el) * (size / 2));
    d.scale.y = 0.4;
    cap.add(d);
  }
  cap.castShadow = stem.castShadow = true;
  g.add(stem, cap);
  return {
    obj: g,
    update(time) {
      const w = Math.sin(time * 3 + g.position.x) * 0.04;
      cap.scale.set(1 + w, 0.45 - w, 1 + w);
    },
  };
}

/** Leafy canopy over the crown: an umbrella of toon blobs plus a few at the rim (cover you can be shot through). */
function canopy(d: Decor, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const leaves = [toon({ color: 0x4f8a3c }), toon({ color: 0x6aa548 }), toon({ color: 0x3f7434 })];
  const blob = new THREE.IcosahedronGeometry(1, 2);
  const add = (x: number, y: number, z: number, s: number) => {
    const m = new THREE.Mesh(blob, leaves[Math.floor(r() * leaves.length)]);
    m.position.set(d.pos.x + x, d.pos.y + y, d.pos.z + z);
    m.scale.set(s, s * 0.75, s);
    m.castShadow = true;
    g.add(m);
  };
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const rr = r() * d.radius * 0.9;
    add(Math.cos(a) * rr, 6 + r() * 4, Math.sin(a) * rr, 3 + r() * 2.5);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + r() * 0.3;
    add(Math.cos(a) * d.radius * 0.85, 2.5 + r() * 1.5, Math.sin(a) * d.radius * 0.85, 1.6 + r());
  }
  return g;
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
