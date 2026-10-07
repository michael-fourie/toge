import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box } from '../shared/collision.ts';
import { SURVIVAL } from '../shared/constants.ts';
import type { Barricade, Room, SurvivalLayout } from '../shared/layout.ts';
import type { MapData } from '../shared/map.ts';
import type { Vec3 } from '../shared/math.ts';
import type { BoxState } from '../shared/protocol.ts';
import { boilerTexture, brickTexture, concreteTexture, conveyorTexture, crateTexture, gravelTexture, hazardTexture, machineTexture, paneTexture, plankTexture, signTexture, steelTexture } from './foundrytextures.ts';
import { buildMysteryBox, buildWallBuy } from './foundrybox.ts';
import { buildJugMachine } from './jugmachine.ts';
import { MOON_DIR, NIGHT, makeMoon, makeStars } from './night.ts';
import { buildPunchMachine } from './punchmachine.ts';
import { rng, softDot, toonRamp } from './textures.ts';
import { type World, makeSky, rampGeometry } from './world.ts';

// The Foundry at night. Built for speed: every static box is baked into a handful of merged meshes (one per material),
// light is faked with glow sprites and floor pools (the only real light besides the moon is a lamp that follows you),
// and the only things that move are the doors, the window planks and the Mystery Box.

type FoundryEvent = 'plank' | 'nail' | 'door' | 'tick' | 'plush';

export interface FoundryWorld extends World {
  /** Doors, boards and box as the server sent them. The first call sets the scene up without any show. */
  sync(doors: readonly boolean[], boards: readonly number[], box: BoxState): void;
  /** Our lamp follows the viewer. */
  setViewer(p: THREE.Vector3): void;
  /** Sounds and such, with where they happened. */
  onEvent?: (e: FoundryEvent, at: Vec3) => void;
}

const MAX_BOARDS = SURVIVAL.boards;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));

/** Bake a box into world-space geometry: UVs in metres over `tile`, with darkening near the floor and ceiling baked into vertex colours. */
function bake(geo: THREE.BufferGeometry, shade: boolean): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = shade ? 0.46 + 0.54 * smooth(0, 3, y) - 0.35 * smooth(7, 9.4, y) : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function boxGeo(b: Box, tile: number, shade = true): THREE.BufferGeometry {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * faces[f][0]) / tile + (b.min.x + b.min.z) * 0.37, (uv.getY(k) * faces[f][1]) / tile + b.min.y / tile);
    }
  }
  geo.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  return bake(geo, shade);
}

/** A cylinder (boilers, pipes, barrels) with UVs in metres. */
function cylGeo(r: number, h: number, tile: number, x: number, y: number, z: number, seg = 20, shade = true): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r, r, h, seg, 1, false);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / tile, (uv.getY(i) * h) / tile);
  geo.translate(x, y, z);
  return bake(geo, shade);
}

/** A horizontal pipe along X or Z. */
function pipe(axis: 'x' | 'z', r: number, from: number, to: number, y: number, other: number): THREE.BufferGeometry {
  const g = cylGeo(r, to - from, 3, 0, 0, 0, 10, false);
  g.rotateZ(Math.PI / 2); // along X
  if (axis === 'z') g.rotateY(Math.PI / 2);
  const mid = (from + to) / 2;
  g.translate(axis === 'x' ? mid : other, y, axis === 'x' ? other : mid);
  return g;
}

/** A flat quad lying on the floor (light pools, decals, thresholds). */
function floorQuad(x: number, y: number, z: number, w: number, d: number, rot = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  g.rotateY(rot);
  g.translate(x, y, z);
  return g;
}

export function buildFoundry(map: MapData, renderer: THREE.WebGLRenderer, accent: number): FoundryWorld {
  const lay = map.survival as SurvivalLayout;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d1128, 14, 110);
  const r = rng(7);
  const ramp = toonRamp();
  const toon = (p: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...p });

  // --- Sky and light ------------------------------------------------------
  scene.add(makeSky(NIGHT, MOON_DIR, true));
  const stars = makeStars();
  scene.add(stars.obj, makeMoon());
  scene.add(new THREE.HemisphereLight(0x6b82d6, 0x2a2548, 1.3));
  const moon = new THREE.DirectionalLight(NIGHT.light, 0.85);
  moon.position.copy(MOON_DIR).multiplyScalar(120);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1536, 1536);
  const sc = moon.shadow.camera;
  sc.left = sc.bottom = -72;
  sc.right = sc.top = 72;
  sc.near = 1;
  sc.far = 320;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.06;
  scene.add(moon, moon.target);
  // The one real light that moves: a warm glow around you, so rooms read even away from a lamp.
  const lamp = new THREE.PointLight(0xffe2b8, 20, 20, 1.5);
  scene.add(lamp);

  // --- Materials ----------------------------------------------------------
  const M = {
    brick: toon({ map: brickTexture(renderer), vertexColors: true }),
    gravel: toon({ map: gravelTexture(renderer), vertexColors: true }),
    plate: toon({ map: steelTexture(renderer), vertexColors: true }),
    hazard: toon({ map: hazardTexture(renderer), vertexColors: true }),
    machine: toon({ map: machineTexture(renderer), vertexColors: true }),
    boiler: toon({ map: boilerTexture(renderer), vertexColors: true }),
    crate: toon({ map: crateTexture(renderer), vertexColors: true }),
    conveyor: toon({ map: conveyorTexture(renderer), vertexColors: true }),
    concrete: toon({ map: concreteTexture(renderer), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const buckets = new Map<keyof typeof M, THREE.BufferGeometry[]>();
  const put = (k: keyof typeof M, g: THREE.BufferGeometry) => {
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(g);
  };

  // --- Geometry -----------------------------------------------------------
  for (const b of map.boxes) {
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    if (b.ramp) {
      put('plate', bake(rampGeometry(b, 2), true));
      continue;
    }
    switch (b.kind) {
      case 'brick':
        put('brick', boxGeo(b, 3));
        break;
      case 'gravel':
        put('gravel', boxGeo(b, 6, false));
        break;
      case 'crate':
        put('crate', boxGeo(b, 1.5));
        break;
      case 'machine':
        if (sy > 4) {
          // A boiler: a tank (the box is its collision) with a domed top, a feed pipe to the ceiling and a gauge.
          const rad = Math.min(sx, sz) / 2;
          const cx = (b.min.x + b.max.x) / 2;
          const cz = (b.min.z + b.max.z) / 2;
          put('boiler', cylGeo(rad, sy, 2.5, cx, sy / 2, cz, 22));
          const dome = new THREE.SphereGeometry(rad, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2);
          dome.translate(cx, sy, cz);
          put('boiler', bake(dome, true));
          put('plate', cylGeo(0.22, 9 - sy, 2, cx, (9 + sy) / 2, cz, 10));
          put('hazard', cylGeo(rad + 0.04, 0.5, 1, cx, 0.25, cz, 22, false)); // hazard skirt
        } else put('machine', boxGeo(b, 2));
        break;
      case 'steel':
        if (b.min.y >= 8.9) put('plate', boxGeo(b, 3));
        else if (sy < 1.2 && Math.max(sx, sz) > 6) put('conveyor', boxGeo(b, 1.6));
        else if (sy >= 1 && sy < 1.5 && b.min.y >= 4) put('hazard', boxGeo(b, 1)); // the mezzanine rail
        else put('plate', boxGeo(b, 2.4));
        break;
      default:
        break;
    }
  }

  // Hazard-striped door frames, and the dark steel of each window frame.
  for (const d of lay.doors) {
    const { min, max } = d.box;
    const alongX = max.x - min.x > max.z - min.z;
    const f = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => put('hazard', boxGeo({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind: 'steel' }, 0.8, false));
    const t = 0.35;
    if (alongX) {
      f(min.x - 0.2, 0, min.z - t, min.x, max.y + 0.2, max.z + t);
      f(max.x, 0, min.z - t, max.x + 0.2, max.y + 0.2, max.z + t);
      f(min.x - 0.2, max.y, min.z - t, max.x + 0.2, max.y + 0.2, max.z + t);
    } else {
      f(min.x - t, 0, min.z - 0.2, max.x + t, max.y + 0.2, min.z);
      f(min.x - t, 0, max.z, max.x + t, max.y + 0.2, max.z + 0.2);
      f(min.x - t, max.y, min.z - 0.2, max.x + t, max.y + 0.2, max.z + 0.2);
    }
  }
  for (const b of lay.barricades) {
    const alongX = Math.abs(b.out.z) > 0.5;
    const half = b.width / 2;
    const top = b.seal.max.y;
    const f = (a0: number, y0: number, a1: number, y1: number) => {
      const t = 0.42;
      put('plate', boxGeo(alongX
        ? { min: { x: b.pos.x + a0, y: y0, z: b.pos.z - t }, max: { x: b.pos.x + a1, y: y1, z: b.pos.z + t }, kind: 'steel' }
        : { min: { x: b.pos.x - t, y: y0, z: b.pos.z + a0 }, max: { x: b.pos.x + t, y: y1, z: b.pos.z + a1 }, kind: 'steel' }, 1.2, false));
    };
    f(-half - 0.18, 0, -half, top + 0.18);
    f(half, 0, half + 0.18, top + 0.18);
    f(-half - 0.18, top, half + 0.18, top + 0.18);
  }

  // Overhead: beams, pipes and a catwalk-grey roof underside, per room. Nothing here is solid.
  for (const room of lay.rooms) {
    if (room.name === 'Stairs' || room.name === 'Mezzanine') continue;
    const w = room.x1 - room.x0;
    const d = room.z1 - room.z0;
    for (let x = room.x0 + 4; x < room.x1 - 1; x += 6) put('plate', boxGeo({ min: { x: x - 0.25, y: 8.3, z: room.z0 }, max: { x: x + 0.25, y: 8.85, z: room.z1 }, kind: 'steel' }, 1.2));
    const pipes = Math.max(1, Math.floor(d / 9));
    for (let i = 0; i < pipes; i++) put('plate', pipe('x', 0.16 + (i % 2) * 0.06, room.x0, room.x1, 7.75 - (i % 2) * 0.35, room.z0 + (d * (i + 0.5)) / pipes));
    if (w > 20) put('plate', pipe('z', 0.2, room.z0, room.z1, 7.4, room.x0 + w * 0.3));
  }

  // The interior floor: poured concrete over the gravel, one plane per room (the stairs and mezzanine have their own).
  const floors: THREE.BufferGeometry[] = [];
  const floorOf = (rm: Room) => {
    const g = floorQuad((rm.x0 + rm.x1) / 2, 0.012, (rm.z0 + rm.z1) / 2, rm.x1 - rm.x0, rm.z1 - rm.z0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (rm.x1 - rm.x0)) / 4, (uv.getY(i) * (rm.z1 - rm.z0)) / 4);
    return g;
  };
  for (const rm of lay.rooms) if (rm.name !== 'Stairs' && rm.name !== 'Mezzanine') floors.push(floorOf(rm));
  const floorMesh = new THREE.Mesh(mergeGeometries(floors.map((g) => g.toNonIndexed()), false), M.concrete);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  for (const [k, list] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), M[k]);
    mesh.castShadow = k !== 'concrete' && k !== 'gravel';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Lamps, pools of light and moonbeams -----------------------------------
  interface Lamp { x: number; z: number; color: THREE.Color; flicker: number }
  const lamps: Lamp[] = [];
  const tint: Record<string, [number, number]> = {
    'Assembly Hall': [0xffe2a8, 0],
    Office: [0xffd9a0, 0],
    'Boiler Room': [0x9ff0c0, 1],
    Storage: [0xffe0a0, 0.4],
    'Locker Room': [0xcfe6ff, 1],
    'Loading Dock': [0xffd090, 0.5],
    Furnace: [0xff8a4a, 0.3],
    Mezzanine: [0xffe2a8, 0],
  };
  for (const rm of lay.rooms) {
    const t = tint[rm.name];
    if (!t) continue;
    const w = rm.x1 - rm.x0;
    const d = rm.z1 - rm.z0;
    const nx = Math.max(1, Math.round(w / 14));
    const nz = Math.max(1, Math.round(d / 14));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = rm.x0 + (w * (i + 0.5)) / nx;
        const z = rm.z0 + (d * (j + 0.5)) / nz;
        if (rm.name === 'Assembly Hall' && z < -11) continue; // the mezzanine's own lamps cover that strip
        lamps.push({ x, z, color: new THREE.Color(t[0]), flicker: t[1] > 0 && r() < t[1] ? 1 : 0 });
      }
    }
  }
  const shadeGeo: THREE.BufferGeometry[] = [];
  for (const l of lamps) {
    const cone = new THREE.ConeGeometry(0.7, 0.5, 12, 1, true);
    cone.translate(l.x, 7.6, l.z);
    shadeGeo.push(bake(cone, false));
    shadeGeo.push(bake(cylGeo(0.03, 1.1, 1, l.x, 8.4, l.z, 4, false), false));
  }
  const shades = new THREE.Mesh(mergeGeometries(shadeGeo, false), toon({ color: 0x2b2f36, side: THREE.DoubleSide }));
  scene.add(shades);

  // Glow sprites for the lamps (one draw call) and soft pools of light on the floor (another).
  const dot = softDot();
  const glowPos = new Float32Array(lamps.length * 3);
  const glowCol = new Float32Array(lamps.length * 3);
  lamps.forEach((l, i) => glowPos.set([l.x, 7.35, l.z], i * 3));
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
  scene.add(new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: dot, size: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  const yardLights: [number, number][] = [[-44, -40], [44, -40], [-44, 32], [44, 32], [0, -41], [0, 33]];
  const poolGeos: THREE.BufferGeometry[] = [];
  const poolRanges: { start: number; lamp: number }[] = [];
  let vertCount = 0;
  const addPool = (x: number, z: number, size: number, lampIdx: number) => {
    const g = floorQuad(x, 0.05, z, size, size).toNonIndexed();
    poolGeos.push(g);
    poolRanges.push({ start: vertCount, lamp: lampIdx });
    vertCount += g.attributes.position.count;
  };
  lamps.forEach((l, i) => addPool(l.x, l.z, 15, i));
  yardLights.forEach(([x, z]) => addPool(x, z, 26, -1));
  const poolGeo = mergeGeometries(poolGeos, false);
  const poolCol = new Float32Array(vertCount * 3);
  poolGeo.setAttribute('color', new THREE.BufferAttribute(poolCol, 3));
  const pools = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  pools.renderOrder = 1;
  scene.add(pools);
  const yardCol = new THREE.Color(0x8fa8ff);

  // Moonlight through the skylights: glowing panes in the ceiling and a faint slanted shaft under each.
  const panes: THREE.BufferGeometry[] = [];
  const shafts: THREE.BufferGeometry[] = [];
  const shear = new THREE.Matrix4().set(1, 0.32, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  for (const [x, z] of [[-10, -4], [10, -4], [-10, 6], [10, 6], [-8, -26], [8, -26], [26, -22], [28, 0], [-28, -4], [-28, -24]]) {
    panes.push(new THREE.PlaneGeometry(3, 3).rotateX(Math.PI / 2).translate(x, 8.97, z));
    const s = new THREE.CylinderGeometry(1.45, 2.7, 9, 4, 1, true).rotateY(Math.PI / 4);
    s.translate(0, 4.5, 0);
    s.applyMatrix4(shear.clone());
    s.translate(x - 0.32 * 9 * 0.5, 0, z);
    shafts.push(s);
  }
  scene.add(new THREE.Mesh(mergeGeometries(panes.map((g) => g.toNonIndexed()), false), new THREE.MeshBasicMaterial({ color: 0x7f95d8 })));
  const shaftMesh = new THREE.Mesh(
    mergeGeometries(shafts.map((g) => g.toNonIndexed()), false),
    new THREE.MeshBasicMaterial({ color: 0x8fa8ff, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  shaftMesh.renderOrder = 2;
  scene.add(shaftMesh);

  // High windows in the outside walls glow with moonlight, on both faces.
  const glass: THREE.BufferGeometry[] = [];
  for (const b of lay.barricades) {
    for (const lat of [-3.4, 3.4]) {
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(1.4, 2.4);
        const sx = -b.out.z * lat;
        const sz = b.out.x * lat;
        const out = b.out.x !== 0 ? Math.PI / 2 * b.out.x : b.out.z > 0 ? 0 : Math.PI;
        g.rotateY(out + (side < 0 ? Math.PI : 0));
        g.translate(b.pos.x + sx + b.out.x * 0.32 * side, 5.4, b.pos.z + sz + b.out.z * 0.32 * side);
        glass.push(g.toNonIndexed());
      }
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(glass, false), new THREE.MeshBasicMaterial({ map: paneTexture(renderer), color: 0xb5c0ea })));

  // --- The yard: flood-light poles, barrels, a skyline, a water tower ---------
  const prop: THREE.BufferGeometry[] = [];
  for (const [x, z] of yardLights) {
    prop.push(cylGeo(0.18, 11, 2, x, 5.5, z, 8, false));
    prop.push(boxGeo({ min: { x: x - 0.9, y: 11, z: z - 0.4 }, max: { x: x + 0.9, y: 11.5, z: z + 0.4 }, kind: 'steel' }, 1, false));
  }
  scene.add(new THREE.Mesh(mergeGeometries(prop, false), toon({ color: 0x23262d })));
  const lensGeo = new THREE.BufferGeometry();
  lensGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(yardLights.flatMap(([x, z]) => [x, 10.9, z])), 3));
  scene.add(new THREE.Points(lensGeo, new THREE.PointsMaterial({ map: dot, size: 7, color: 0xcfdcff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  const barrels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), toon({ color: 0xffffff }), 40);
  const bm = new THREE.Matrix4();
  const barrelAt: [number, number][] = [
    [-47, -43], [-45.8, -43.6], [-46.4, -41.8], [47, -43], [45.6, -43.4], [-47, 35], [-45.6, 34.2], [47, 35], [46, 33.8], [47.2, 25],
    [-33, 5.9], [-34.2, 6.4], [33, -12], [34.4, -12.6], [-19.5, 6.4], [19.5, -0.6], [-34.8, -17], [-34.8, -18.2], [34.8, -17], [30, -31.2], [-6, 14.2],
  ];
  const cols = [0xb23a2f, 0x2f5f9a, 0xc9a02f, 0x4d6a3c];
  barrels.count = barrelAt.length;
  barrelAt.forEach(([x, z], i) => {
    barrels.setMatrixAt(i, bm.makeTranslation(x, 0.5, z));
    barrels.setColorAt(i, new THREE.Color(cols[i % cols.length]));
  });
  barrels.castShadow = true;
  scene.add(barrels);

  const sky = new THREE.MeshBasicMaterial({ color: 0x0b0e24, fog: false });
  const skyline: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.1;
    const dist = 130 + r() * 90;
    const h = 12 + r() * 40;
    const w = 8 + r() * 22;
    const g = new THREE.BoxGeometry(w, h, w * (0.6 + r() * 0.8));
    g.translate(Math.cos(a) * dist, h / 2 - 2, Math.sin(a) * dist);
    skyline.push(g.toNonIndexed());
  }
  skyline.push(new THREE.CylinderGeometry(3, 4.5, 80, 10).translate(-90, 38, -110).toNonIndexed()); // the smokestack
  skyline.push(new THREE.CylinderGeometry(9, 9, 6, 12).translate(95, 40, -90).toNonIndexed()); // water tower tank
  skyline.push(new THREE.CylinderGeometry(0.8, 0.8, 38, 6).translate(95, 19, -90).toNonIndexed());
  scene.add(new THREE.Mesh(mergeGeometries(skyline, false), sky));
  const far = new THREE.Mesh(new THREE.CircleGeometry(600, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0c1c, fog: false }));
  far.position.y = -1.5;
  scene.add(far);

  // Dust motes hanging in the hall, and steam venting off the boilers.
  const N = 220;
  const dustPos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dustPos.set([-34 + r() * 68, 0.5 + r() * 7, -30 + r() * 52], i * 3);
    seeds[i] = r() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dot, color: 0xc9d6ff, size: 0.12, transparent: true, opacity: 0.7, depthWrite: false })));
  const steam = [0, 1, 2, 3, 4, 5].map((i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xc8d6e8, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(s);
    return { s, ph: i / 6 };
  });
  const vents = lay.rooms.find((rm) => rm.name === 'Boiler Room')!;

  // --- Doors --------------------------------------------------------------
  const doorMeshes = lay.doors.map((d) => {
    const g = new THREE.Group();
    const sx = d.box.max.x - d.box.min.x;
    const sy = d.box.max.y - d.box.min.y;
    const sz = d.box.max.z - d.box.min.z;
    g.position.set((d.box.min.x + d.box.max.x) / 2, sy / 2, (d.box.min.z + d.box.max.z) / 2);
    const slab = new THREE.Mesh(boxGeo({ min: { x: -sx / 2, y: -sy / 2, z: -sz / 2 }, max: { x: sx / 2, y: sy / 2, z: sz / 2 }, kind: 'steel' }, 1.6, false), M.plate);
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
    const alongX = sx > sz;
    const sign = new THREE.MeshBasicMaterial({ map: signTexture(renderer, [d.name.toUpperCase(), `${d.price}`], { w: 512, h: 256, bg: '#202429', fg: '#f5efd6' }), color: 0xd8dff0 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), sign);
      p.position.set(alongX ? 0 : side * (sx / 2 + 0.02), 0.2, alongX ? side * (sz / 2 + 0.02) : 0);
      p.rotation.y = alongX ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(p);
    }
    scene.add(g);
    return { g, baseY: sy / 2, rise: 0, open: false, h: sy };
  });

  // --- Window boards ------------------------------------------------------
  const plankGeo = new THREE.BoxGeometry(3.45, 0.27, 0.1);
  const planks = new THREE.InstancedMesh(plankGeo, toon({ map: plankTexture(renderer), color: 0xd8cbb0 }), lay.barricades.length * MAX_BOARDS);
  planks.castShadow = true;
  planks.frustumCulled = false;
  scene.add(planks);
  const plankSpots = lay.barricades.map((b) =>
    Array.from({ length: MAX_BOARDS }, (_, i) => {
      const alongX = Math.abs(b.out.z) > 0.5;
      const pos = new THREE.Vector3(b.pos.x, 0.5 + i * 0.56, b.pos.z).addScaledVector(new THREE.Vector3(b.out.x, 0, b.out.z), i % 2 ? 0.14 : -0.14);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, alongX ? 0 : Math.PI / 2, (r() - 0.5) * 0.2));
      return { pos, q, shown: 1 };
    }),
  );
  const plankM = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const hide = new THREE.Vector3(0, 0, 0);
  const setPlank = (bi: number, i: number, scale: number) => {
    const p = plankSpots[bi][i];
    p.shown = scale;
    planks.setMatrixAt(bi * MAX_BOARDS + i, plankM.compose(p.pos, p.q, scale <= 0 ? hide : one.set(scale, scale, scale)));
    planks.instanceMatrix.needsUpdate = true;
  };
  const flying: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; life: number }[] = [];
  const flyGeo = new THREE.BoxGeometry(3.4, 0.27, 0.1);
  const flyMat = toon({ map: plankTexture(renderer), color: 0xd8cbb0 });
  const throwPlank = (b: Barricade, y: number) => {
    const m = new THREE.Mesh(flyGeo, flyMat);
    m.position.set(b.pos.x, y, b.pos.z);
    m.rotation.y = Math.abs(b.out.z) > 0.5 ? 0 : Math.PI / 2;
    scene.add(m);
    flying.push({ m, v: new THREE.Vector3(b.out.x * 3, 2.5, b.out.z * 3), w: new THREE.Vector3(r() * 6 - 3, r() * 6 - 3, r() * 6 - 3), life: 0.9 });
  };

  // --- Wall guns, the stations, the box -------------------------------------
  // Stencilled room names on the walls, above the doorways.
  for (const rm of lay.rooms) {
    if (rm.name === 'Stairs' || rm.name === 'Mezzanine') continue;
    const south = rm.name === 'Assembly Hall';
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: signTexture(renderer, [rm.name.toUpperCase()], { w: 512, h: 136, bg: '#2a2e35', fg: '#d9d2b8', border: '#8a8f99' }), color: 0xbfc6d8 }));
    sign.position.set((rm.x0 + rm.x1) / 2, 5.4, south ? rm.z1 - 0.32 : rm.z0 + 0.32);
    sign.rotation.y = south ? Math.PI : 0;
    scene.add(sign);
  }

  // Wall guns are small groups of meshes: only the ones within sight distance are drawn.
  const wallGuns = lay.wallBuys.map((w) => {
    const g = buildWallBuy(w, renderer, accent);
    scene.add(g);
    return g;
  });
  const viewer = new THREE.Vector3();
  const punch = buildPunchMachine(lay.punch);
  const jug = buildJugMachine(lay.jug);
  jug.obj.rotation.y = -Math.PI / 2; // the tap faces into the room
  scene.add(punch.obj, jug.obj);
  // The furnace behind the Pack-a-Punch: a glowing mouth in the machine's face.
  const furnaceGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
  furnaceGlow.position.set(lay.punch.x, 1.1, -29.98);
  scene.add(furnaceGlow);
  const furnaceHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xff6a22, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  furnaceHalo.scale.set(9, 6, 1);
  furnaceHalo.position.set(lay.punch.x, 1.4, -29.2);
  scene.add(furnaceHalo);
  const box = buildMysteryBox(renderer, accent);
  scene.add(box.obj);
  let lastT = 0;
  let boxSpot = -1;
  let boxState: BoxState = { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 };

  const world: FoundryWorld = {
    scene,
    setViewer(p) {
      lamp.position.set(p.x, p.y + 1.9, p.z);
      viewer.copy(p);
    },
    sync(doors, boards, st) {
      const first = boxSpot < 0;
      lay.doors.forEach((_, i) => {
        const dm = doorMeshes[i];
        if (!!doors[i] === dm.open) return;
        dm.open = !!doors[i];
        if (dm.open && !first) world.onEvent?.('door', { x: dm.g.position.x, y: 1, z: dm.g.position.z });
        if (first) {
          dm.rise = dm.open ? dm.h + 0.3 : 0;
          dm.g.visible = !dm.open;
        }
      });
      lay.barricades.forEach((b, bi) => {
        const n = boards[bi] ?? MAX_BOARDS;
        for (let i = 0; i < MAX_BOARDS; i++) {
          const on = i < n;
          const was = plankSpots[bi][i].shown > 0;
          if (first) setPlank(bi, i, on ? 1 : 0);
          else if (on && !was) {
            setPlank(bi, i, 0.01); // nailed back up: pops to full size in update()
            world.onEvent?.('nail', { x: b.pos.x, y: 1.5, z: b.pos.z });
          } else if (!on && was) {
            throwPlank(b, plankSpots[bi][i].pos.y);
            setPlank(bi, i, 0);
            world.onEvent?.('plank', { x: b.pos.x, y: 1.5, z: b.pos.z });
          }
        }
      });
      if (st.spot !== boxSpot) {
        const sp = lay.boxSpots[st.spot];
        box.moveTo(new THREE.Vector3(sp.pos.x, sp.pos.y, sp.pos.z), sp.yaw);
        if (first) box.obj.scale.setScalar(1);
        boxSpot = st.spot;
      }
      if (boxState.phase !== 'leaving' && st.phase === 'leaving') world.onEvent?.('plush', { x: lay.boxSpots[st.spot].pos.x, y: 1, z: lay.boxSpots[st.spot].pos.z });
      boxState = st;
    },
    update(time) {
      const dt = Math.min(0.1, Math.max(0, time - lastT));
      lastT = time;
      stars.update(time);
      // Lamps: steady, or a nervous flicker; their glow and pools follow.
      const fl = (i: number, l: Lamp) => (l.flicker ? (Math.sin(time * 31 + i * 7) > 0.6 && Math.sin(time * 3.1 + i) > 0.1 ? 0.25 : 0.9 + 0.1 * Math.sin(time * 50 + i)) : 0.95);
      lamps.forEach((l, i) => {
        const k = fl(i, l);
        glowCol.set([l.color.r * k, l.color.g * k, l.color.b * k], i * 3);
      });
      glowGeo.attributes.color.needsUpdate = true;
      poolRanges.forEach((p, i) => {
        const next = poolRanges[i + 1]?.start ?? vertCount;
        const c = p.lamp >= 0 ? lamps[p.lamp].color : yardCol;
        const k = p.lamp >= 0 ? fl(p.lamp, lamps[p.lamp]) * 0.34 : 0.22;
        for (let v = p.start; v < next; v++) poolCol.set([c.r * k, c.g * k, c.b * k], v * 3);
      });
      poolGeo.attributes.color.needsUpdate = true;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        dustPos[i * 3] += Math.sin(time * 0.2 + s) * 0.05 * dt * 10;
        dustPos[i * 3 + 1] += Math.sin(time * 0.5 + s * 1.7) * 0.03 * dt * 10;
        dustPos[i * 3 + 2] += Math.cos(time * 0.3 + s) * 0.05 * dt * 10;
      }
      dustGeo.attributes.position.needsUpdate = true;
      for (const { s, ph } of steam) {
        const k = (time * 0.35 + ph) % 1;
        s.position.set(vents.x0 + 3 + ph * 12, 4.4 + k * 3.2, vents.z0 + 6 + ((ph * 7) % 1) * 10);
        s.scale.setScalar(1.2 + k * 3);
        s.material.opacity = Math.sin(k * Math.PI) * 0.16;
      }
      // Doors slide up; planks that were just nailed back pop to full size.
      for (const d of doorMeshes) {
        const to = d.open ? d.h + 0.3 : 0;
        d.rise += Math.sign(to - d.rise) * Math.min(Math.abs(to - d.rise), dt * 4.5);
        d.g.position.y = d.baseY + d.rise;
        d.g.visible = d.rise < d.h + 0.2;
      }
      lay.barricades.forEach((_, bi) =>
        plankSpots[bi].forEach((p, i) => {
          if (p.shown > 0 && p.shown < 1) setPlank(bi, i, Math.min(1, p.shown + dt * 7));
        }),
      );
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        f.life -= dt;
        f.v.y -= 14 * dt;
        f.m.position.addScaledVector(f.v, dt);
        f.m.rotation.x += f.w.x * dt;
        f.m.rotation.z += f.w.z * dt;
        if (f.life <= 0) {
          f.m.removeFromParent();
          flying.splice(i, 1);
        }
      }
      for (const g of wallGuns) g.visible = Math.hypot(g.position.x - viewer.x, g.position.z - viewer.z) < 26;
      furnaceGlow.scale.setScalar(1 + Math.sin(time * 7) * 0.02);
      (furnaceHalo.material as THREE.SpriteMaterial).opacity = 0.45 + 0.15 * Math.sin(time * 5.3) + 0.1 * Math.sin(time * 13);
      punch.update(time);
      jug.update(time);
      box.update(time, boxState, () => world.onEvent?.('tick', { x: box.obj.position.x, y: 1, z: box.obj.position.z }));
    },
  };
  return world;
}
