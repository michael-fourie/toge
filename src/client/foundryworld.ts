import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box } from '../shared/collision.ts';
import { SURVIVAL } from '../shared/constants.ts';
import type { Barricade, SurvivalLayout } from '../shared/layout.ts';
import type { MapData } from '../shared/map.ts';
import type { Vec3 } from '../shared/math.ts';
import type { BoxState, WorldState } from '../shared/protocol.ts';
import { openRooms } from '../shared/colliders.ts';
import { buildScythe } from './scythe.ts';
import { boilerTexture, brickTexture, concreteTexture, conveyorTexture, crateTexture, floorboardTexture, gravelTexture, hazardTexture, machineTexture, paneTexture, plankTexture, signTexture, steelTexture, tileTexture } from './foundrytextures.ts';
import { buildDecor } from './foundrydecor.ts';
import { buildMysteryBox, buildWallBuy } from './foundrybox.ts';
import { buildJugMachine, buildPerkMachine } from './jugmachine.ts';
import { PERKS } from '../shared/perks.ts';
import { MOON_DIR, NIGHT, makeMoon, makeStars } from './night.ts';
import { buildPunchMachine } from './punchmachine.ts';
import { rng, softDot, toonRamp } from './textures.ts';
import { type World, makeSky, rampGeometry } from './world.ts';

// The Foundry at night. Built for speed: every static box is baked into a handful of merged meshes (one per material),
// light is faked with glow sprites and floor pools (the only real light besides the moon is a lamp that follows you),
// and the only things that move are the doors, the window planks and the Mystery Box.

type FoundryEvent = 'plank' | 'nail' | 'door' | 'tick' | 'plush';

export interface FoundryWorld extends World {
  /** The building as the server sent it. The first call sets the scene up without any show. */
  sync(st: WorldState): void;
  /** Our lamp follows the viewer. */
  setViewer(p: THREE.Vector3): void;
  /** Sounds and such, with where they happened. */
  onEvent?: (e: FoundryEvent, at: Vec3) => void;
}

const MAX_BOARDS = SURVIVAL.boards;
const LABEL_RANGE = 34; // metres within which door and room signs are drawn
const COMPOUND_MID = new THREE.Vector3(0, 0, -25); // the yard reaches from z 38 to the North Wing at -88
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));

/** The storey a piece of geometry stands in: its floor and ceiling heights (for the baked shading). */
interface Level {
  floor: number;
  ceil: number;
}
const GROUND: Level = { floor: 0, ceil: 9 };

/** Bake a box into world-space geometry: UVs in metres over `tile`, with darkening near its storey's floor and ceiling baked into vertex colours. */
function bake(geo: THREE.BufferGeometry, shade: boolean, lv: Level = GROUND): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = shade ? 0.46 + 0.54 * smooth(lv.floor, lv.floor + 3, y) - 0.35 * smooth(lv.ceil - 2, lv.ceil + 0.4, y) : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function boxGeo(b: Box, tile: number, shade = true, lv: Level = GROUND): THREE.BufferGeometry {
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
  return bake(geo, shade, lv);
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
  moon.position.copy(MOON_DIR).multiplyScalar(120).add(COMPOUND_MID);
  moon.target.position.copy(COMPOUND_MID);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1536, 1536);
  const sc = moon.shadow.camera;
  sc.left = sc.bottom = -84;
  sc.right = sc.top = 84;
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
    boards: toon({ map: floorboardTexture(renderer), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tiles: toon({ map: tileTexture(renderer), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const buckets = new Map<keyof typeof M, THREE.BufferGeometry[]>();
  const put = (k: keyof typeof M, g: THREE.BufferGeometry) => {
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(g);
  };

  // --- Geometry -----------------------------------------------------------
  // Which storey a box stands in: the room whose footprint holds it with the highest floor at or under its bottom.
  const levelOf = (b: Box): Level => {
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    let best: Level | null = null;
    for (const rm of lay.rooms) {
      if (rm.shape === 'ramp' || cx < rm.x0 - 0.6 || cx > rm.x1 + 0.6 || cz < rm.z0 - 0.6 || cz > rm.z1 + 0.6 || rm.floor > b.min.y + 0.05) continue;
      if (!best || rm.floor > best.floor) best = rm;
    }
    return best ?? (b.min.y < -0.5 ? { floor: b.min.y, ceil: 0 } : GROUND);
  };
  for (const b of map.boxes) {
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    const lv = levelOf(b);
    if (b.ramp) {
      put('plate', bake(rampGeometry(b, 2), true, lv));
      continue;
    }
    switch (b.kind) {
      case 'brick':
        put('brick', boxGeo(b, 3, true, lv));
        break;
      case 'gravel':
        put('gravel', boxGeo(b, 6, false));
        break;
      case 'crate':
        put('crate', boxGeo(b, 1.5, true, lv));
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
        } else put('machine', boxGeo(b, 2, true, lv));
        break;
      case 'steel':
        if (b.min.y >= 8.9) put('plate', boxGeo(b, 3, true, lv));
        else if (sy >= 0.8 && sy < 1.2 && Math.min(sx, sz) >= 1 && Math.max(sx, sz) > 6) put('conveyor', boxGeo(b, 1.6, true, lv));
        else if (sy >= 0.9 && sy <= 1.6 && Math.min(sx, sz) <= 0.25) put('hazard', boxGeo(b, 1, true, lv)); // rails and fences
        else put('plate', boxGeo(b, 2.4, true, lv));
        break;
      default:
        break;
    }
  }

  // Hazard-striped door frames, and the dark steel of each window frame.
  for (const d of lay.doors) {
    if (d.id === lay.hatch) continue; // the roof hatch has no frame
    const { min, max } = d.box;
    const alongX = max.x - min.x > max.z - min.z;
    const f = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => put('hazard', boxGeo({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, kind: 'steel' }, 0.8, false));
    const t = 0.35;
    if (alongX) {
      f(min.x - 0.2, min.y, min.z - t, min.x, max.y + 0.2, max.z + t);
      f(max.x, min.y, min.z - t, max.x + 0.2, max.y + 0.2, max.z + t);
      f(min.x - 0.2, max.y, min.z - t, max.x + 0.2, max.y + 0.2, max.z + t);
    } else {
      f(min.x - t, min.y, min.z - 0.2, max.x + t, max.y + 0.2, min.z);
      f(min.x - t, min.y, max.z, max.x + t, max.y + 0.2, max.z + 0.2);
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
    f(-half - 0.18, b.pos.y, -half, top + 0.18);
    f(half, b.pos.y, half + 0.18, top + 0.18);
    f(-half - 0.18, top, half + 0.18, top + 0.18);
  }

  // Overhead: beams and pipes under each room's ceiling; the cellars get a plated ceiling under the yard. Nothing here is solid.
  const roomy = lay.rooms.filter((rm) => !rm.shape && (rm.x1 - rm.x0) * (rm.z1 - rm.z0) > 30);
  for (const room of roomy) {
    const w = room.x1 - room.x0;
    const d = room.z1 - room.z0;
    const c = room.ceil;
    for (let x = room.x0 + 4; x < room.x1 - 1; x += 6) put('plate', boxGeo({ min: { x: x - 0.25, y: c - 0.7, z: room.z0 }, max: { x: x + 0.25, y: c - 0.15, z: room.z1 }, kind: 'steel' }, 1.2, true, room));
    const pipes = Math.max(1, Math.floor(d / 9));
    for (let i = 0; i < pipes; i++) put('plate', pipe('x', 0.16 + (i % 2) * 0.06, room.x0, room.x1, c - 1.25 - (i % 2) * 0.35, room.z0 + (d * (i + 0.5)) / pipes));
    if (w > 20) put('plate', pipe('z', 0.2, room.z0, room.z1, c - 1.6, room.x0 + w * 0.3));
  }
  for (const rm of lay.rooms) {
    if (rm.floor < -1 && rm.shape !== 'ramp') put('plate', boxGeo({ min: { x: rm.x0, y: rm.ceil - 0.06, z: rm.z0 }, max: { x: rm.x1, y: rm.ceil - 0.01, z: rm.z1 }, kind: 'steel' }, 2.4, true, rm));
  }

  // The interior floors: a plane per room over the slab it stands on (clipped round the holes for stairs and pits). Poured
  // concrete, but floorboards upstairs in the North Wing and chipped tiles where shop, staff and cold rooms were.
  const FLOOR_LOOK: Record<string, 'boards' | 'tiles'> = {
    'Drafting Loft': 'boards', 'Clock Room': 'boards', Showroom: 'tiles', 'Front of Shop': 'tiles', 'Fitting Rooms': 'tiles', 'Break Room': 'tiles', 'Cold Storage': 'tiles', 'Duck Shrine': 'boards',
  };
  const floors = { concrete: [] as THREE.BufferGeometry[], boards: [] as THREE.BufferGeometry[], tiles: [] as THREE.BufferGeometry[] };
  const slabs = map.boxes.filter((b) => !b.ramp && (b.kind === 'gravel' || b.kind === 'steel') && (b.max.x - b.min.x) * (b.max.z - b.min.z) > 4 && b.max.y - b.min.y <= 1.1);
  for (const rm of lay.rooms) {
    if (rm.shape) continue;
    for (const b of slabs) {
      if (Math.abs(b.max.y - rm.floor) > 0.01) continue;
      const x0 = Math.max(rm.x0, b.min.x);
      const x1 = Math.min(rm.x1, b.max.x);
      const z0 = Math.max(rm.z0, b.min.z);
      const z1 = Math.min(rm.z1, b.max.z);
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
      const g = floorQuad((x0 + x1) / 2, rm.floor + 0.012, (z0 + z1) / 2, x1 - x0, z1 - z0);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / 4, (z0 + uv.getY(i) * (z1 - z0)) / 4);
      floors[FLOOR_LOOK[rm.name] ?? 'concrete'].push(g.toNonIndexed());
    }
  }
  for (const [k, list] of Object.entries(floors)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list, false), M[k as keyof typeof floors]);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const [k, list] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), M[k]);
    mesh.castShadow = k !== 'concrete' && k !== 'gravel';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Lamps, pools of light and moonbeams -----------------------------------
  interface Lamp { x: number; y: number; z: number; floor: number; ceil: number; color: THREE.Color; flicker: number }
  const lamps: Lamp[] = [];
  // Each room's lamp colour, and the share of its lamps that flicker. The cellars run cold and nervy; the Duck Shrine is lit by candles (foundrydecor.ts).
  const tint: Record<string, [number, number]> = {
    'Assembly Hall': [0xffe2a8, 0],
    Office: [0xffd9a0, 0],
    'Boiler Room': [0x9ff0c0, 1],
    Storage: [0xffe0a0, 0.4],
    'Locker Room': [0xcfe6ff, 1],
    'Loading Dock': [0xffd090, 0.5],
    Furnace: [0xff8a4a, 0.3],
    Mezzanine: [0xffe2a8, 0],
    'Undercroft Stairs': [0x8fe8d0, 0.5],
    'Pump Room': [0x8fe8d0, 0.6],
    'Stair Foot': [0x8fe8d0, 1],
    'Cold Storage': [0xa8d8ff, 0.3],
    'Rail Tunnel': [0xffc070, 0.5],
    'Old Drain': [0x9fe08a, 0.7],
    Showroom: [0xffd0e0, 0.2],
    'Fitting Rooms': [0xffd0e0, 0.6],
    'Front of Shop': [0xffd0e0, 0],
    'Sorting Floor': [0xffe2a8, 0.2],
    'Parcel Bay': [0xffe2a8, 0.5],
    Dispatch: [0xffe2a8, 0],
    'Break Room': [0xfff0c0, 0.5],
    'Drafting Loft': [0xffd9a0, 0.1],
    'Clock Room': [0xb8f0ff, 0.4],
    Skybridge: [0xcfdcff, 0.3],
  };
  for (const rm of lay.rooms) {
    const t = tint[rm.name];
    if (!t) continue;
    const y = rm.ceil - (rm.ceil - rm.floor > 6 ? 1.4 : 0.8);
    const w = rm.x1 - rm.x0;
    const d = rm.z1 - rm.z0;
    const gap = rm.ceil - rm.floor > 6 ? 14 : 8; // low rooms need more, smaller lamps
    const nx = Math.max(1, Math.round(w / gap));
    const nz = Math.max(1, Math.round(d / gap));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = rm.x0 + (w * (i + 0.5)) / nx;
        const z = rm.z0 + (d * (j + 0.5)) / nz;
        if (rm.name === 'Assembly Hall' && z < -11) continue; // the mezzanine's own lamps cover that strip
        lamps.push({ x, y, z, floor: rm.floor, ceil: rm.ceil, color: new THREE.Color(t[0]), flicker: t[1] > 0 && r() < t[1] ? 1 : 0 });
      }
    }
  }
  const shadeGeo: THREE.BufferGeometry[] = [];
  for (const l of lamps) {
    const cone = new THREE.ConeGeometry(0.7, 0.5, 12, 1, true);
    cone.translate(l.x, l.y, l.z);
    shadeGeo.push(bake(cone, false));
    const cord = l.ceil - l.y - 0.2;
    shadeGeo.push(bake(cylGeo(0.03, cord, 1, l.x, l.y + 0.2 + cord / 2, l.z, 4, false), false));
  }
  const shades = new THREE.Mesh(mergeGeometries(shadeGeo, false), toon({ color: 0x2b2f36, side: THREE.DoubleSide }));
  scene.add(shades);

  // Glow sprites for the lamps (one draw call) and soft pools of light on the floor (another).
  const dot = softDot();
  const glowPos = new Float32Array(lamps.length * 3);
  const glowCol = new Float32Array(lamps.length * 3);
  lamps.forEach((l, i) => glowPos.set([l.x, l.y - 0.25, l.z], i * 3));
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
  scene.add(new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: dot, size: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  const yardLights: [number, number][] = [[-44, -40], [44, -40], [-44, 32], [44, 32], [0, 33], [-44, -66], [44, -66], [-28, -84], [28, -84], [-20, -42], [24, -42]];
  const poolGeos: THREE.BufferGeometry[] = [];
  const poolRanges: { start: number; lamp: number }[] = [];
  let vertCount = 0;
  const addPool = (x: number, y: number, z: number, size: number, lampIdx: number) => {
    const g = floorQuad(x, y + 0.05, z, size, size).toNonIndexed();
    poolGeos.push(g);
    poolRanges.push({ start: vertCount, lamp: lampIdx });
    vertCount += g.attributes.position.count;
  };
  lamps.forEach((l, i) => addPool(l.x, l.floor, l.z, l.ceil - l.floor > 6 ? 15 : 10, i));
  yardLights.forEach(([x, z]) => addPool(x, 0, z, 26, -1));
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
  const holes = [...lay.chutes.map((c) => c.lid), lay.doors[lay.hatch].box];
  const overHole = (x: number, z: number) => holes.some((h) => x > h.min.x - 2 && x < h.max.x + 2 && z > h.min.z - 2 && z < h.max.z + 2);
  const skylights: [number, number, number, number][] = [
    ...[[-10, -4], [10, -4], [-10, 6], [10, 6], [-8, -26], [8, -26], [26, -22], [28, 0], [-28, -4], [-28, -24]].map(([x, z]): [number, number, number, number] => [x, z, 0, 9]),
    ...[[-22, -56], [-12, -50], [20, -62], [24, -50]].map(([x, z]): [number, number, number, number] => [x, z, 5, 10]), // the North Wing's roof
  ];
  for (const [x, z, floor, top] of skylights) {
    if (overHole(x, z)) continue;
    const h = top - floor;
    panes.push(new THREE.PlaneGeometry(3, 3).rotateX(Math.PI / 2).translate(x, top - 0.03, z));
    const s = new THREE.CylinderGeometry(1.45, 1.45 + h * 0.14, h, 4, 1, true).rotateY(Math.PI / 4);
    s.translate(0, h / 2, 0);
    s.applyMatrix4(shear.clone());
    s.translate(x - 0.32 * h * 0.5, floor, z);
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
  const pane = (x: number, y: number, z: number, out: { x: number; z: number }, side: number) => {
    const g = new THREE.PlaneGeometry(1.4, 2.4);
    g.rotateY((out.x !== 0 ? (Math.PI / 2) * out.x : out.z > 0 ? 0 : Math.PI) + (side < 0 ? Math.PI : 0));
    g.translate(x + out.x * 0.32 * side, y, z + out.z * 0.32 * side);
    glass.push(g.toNonIndexed());
  };
  for (let a = -27; a <= 27; a += 6) {
    for (const side of [-1, 1]) {
      if (a < 3 || a > 8.5) pane(a, 7.6, -44, { x: 0, z: 1 }, side);
      pane(a, 7.6, -70, { x: 0, z: -1 }, side);
      if (Math.abs(a) < 12) {
        pane(-30, 7.6, -57 + a, { x: -1, z: 0 }, side);
        pane(30, 7.6, -57 + a, { x: 1, z: 0 }, side);
      }
    }
  }
  for (const b of lay.barricades) {
    if (b.pos.y < -1) continue; // the cellar grates have no high windows
    const room = lay.rooms[b.room];
    const y = b.pos.y + Math.min(5.4, (room.ceil - room.floor) * 0.6);
    for (const lat of [-3.4, 3.4]) {
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(1.4, 2.4);
        const sx = -b.out.z * lat;
        const sz = b.out.x * lat;
        const out = b.out.x !== 0 ? Math.PI / 2 * b.out.x : b.out.z > 0 ? 0 : Math.PI;
        g.rotateY(out + (side < 0 ? Math.PI : 0));
        g.translate(b.pos.x + sx + b.out.x * 0.32 * side, y, b.pos.z + sz + b.out.z * 0.32 * side);
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
    [-47, -85], [-45.8, -84.4], [47, -85], [46, -84], [-47.4, -60], [47.4, -52], [29, -69], [-29, -45],
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
    const y = r() < 0.7 ? 0.5 + r() * 7 : r() < 0.5 ? -5.5 + r() * 4 : 5.5 + r() * 4; // most in the main building, some downstairs and upstairs
    dustPos.set([-34 + r() * 68, y, y > 5 ? -68 + r() * 22 : -30 + r() * 52], i * 3);
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
  // Door and room signs: each is a draw call, and past reading distance (or a storey away) nobody can read them anyway.
  const labels: { o: THREE.Object3D; x: number; y: number; z: number }[] = [];
  const doorMeshes = lay.doors.map((d) => {
    const g = new THREE.Group();
    const sx = d.box.max.x - d.box.min.x;
    const sy = d.box.max.y - d.box.min.y;
    const sz = d.box.max.z - d.box.min.z;
    g.position.set((d.box.min.x + d.box.max.x) / 2, d.box.min.y + sy / 2, (d.box.min.z + d.box.max.z) / 2);
    const slab = new THREE.Mesh(boxGeo({ min: { x: -sx / 2, y: -sy / 2, z: -sz / 2 }, max: { x: sx / 2, y: sy / 2, z: sz / 2 }, kind: 'steel' }, 1.6, false), M.plate);
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
    const alongX = sx > sz;
    const sign = new THREE.MeshBasicMaterial({ map: signTexture(renderer, [d.name.toUpperCase(), `${d.price}`], { w: 512, h: 256, bg: '#202429', fg: '#f5efd6' }), color: 0xd8dff0 });
    if (d.id === lay.hatch) {
      // The roof hatch: its sign faces down into the hall.
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), sign);
      p.rotation.x = Math.PI / 2;
      p.position.y = -sy / 2 - 0.02;
      g.add(p);
      scene.add(g);
      return { g, baseY: g.position.y, rise: 0, open: false, h: sy };
    }
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), sign);
      p.position.set(alongX ? 0 : side * (sx / 2 + 0.02), 0.2, alongX ? side * (sz / 2 + 0.02) : 0);
      p.rotation.y = alongX ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(p);
      labels.push({ o: p, x: g.position.x, y: g.position.y, z: g.position.z });
    }
    scene.add(g);
    return { g, baseY: d.box.min.y + sy / 2, rise: 0, open: false, h: sy };
  });

  // --- The Skyline: chute lids (shut until their room is open) and the hatch's launch pad ---
  const lids = lay.chutes.map((c) => {
    const b = c.lid;
    const m = new THREE.Mesh(boxGeo({ min: { x: 0, y: 0, z: 0 }, max: { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z }, kind: 'steel' }, 2.4, false), M.hazard);
    m.position.set(b.min.x, b.min.y, b.min.z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  });
  const hp = lay.hatchPad;
  const padMat = new THREE.MeshBasicMaterial({ color: 0x2c4a52 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry((hp.max.x - hp.min.x) / 2, (hp.max.x - hp.min.x) / 2 + 0.1, hp.max.y - hp.min.y, 24), padMat);
  pad.position.set((hp.min.x + hp.max.x) / 2, (hp.min.y + hp.max.y) / 2, (hp.min.z + hp.max.z) / 2);
  scene.add(pad);
  const padGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0x8ff5e0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  padGlow.scale.set(4, 4, 1);
  padGlow.position.copy(pad.position).setY(0.6);
  scene.add(padGlow);
  let hatchOpen = false;

  // --- The power switch: a lever on the generator, a bulb that goes red to green ---
  const powerOff = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  const powerOn = new THREE.MeshBasicMaterial({ color: 0x6aff7a });
  const lever = new THREE.Group();
  lever.position.set(lay.power.pos.x, lay.power.pos.y + 1.3, lay.power.pos.z + 0.6);
  lever.rotation.y = lay.power.yaw;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.12), toon({ color: 0x3a4048 }));
  lever.add(panel);
  const arm = new THREE.Group();
  arm.position.set(0, 0, 0.1);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), toon({ color: 0xb8bcc4 }));
  stick.position.y = 0.25;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), toon({ color: 0xd23c33 }));
  knob.position.y = 0.5;
  arm.add(stick, knob);
  lever.add(arm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), powerOff);
  bulb.position.set(0.3, 0.4, 0.08);
  lever.add(bulb);
  const powerSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), new THREE.MeshBasicMaterial({ map: signTexture(renderer, ['POWER'], { w: 512, h: 160, bg: '#2a2e35', fg: '#ffd45a', border: '#8a8f99' }), color: 0xd8dff0 }));
  powerSign.position.set(0, 0.95, 0.02);
  lever.add(powerSign);
  scene.add(lever);
  let power = false;
  let powerAt = -9;

  // --- The Gale Scythe: parts glowing where they lie, and the workbench on the mezzanine ---
  const partGlow = (color: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.set(1.6, 1.6, 1);
    return s;
  };
  const scytheModel = buildScythe();
  const partModels = [
    () => scytheModel.children.find((c) => (c as THREE.Mesh).geometry instanceof THREE.ExtrudeGeometry)!.clone(), // the blade
    () => scytheModel.children[0].clone(), // the staff
    () => new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x8ff5e0 })), // the gem
  ];
  const parts = lay.parts.map((p, i) => {
    const g = new THREE.Group();
    g.position.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
    const m = partModels[i % partModels.length]();
    m.position.set(0, 0, 0);
    if (i === 0) m.position.set(0.3, 0, 0.9); // the blade sits at the staff's tip: bring it back to the middle
    if (i === 1) m.position.set(0, 0, 0.33);
    g.add(m, partGlow(0x8ff5e0));
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 12), toon({ color: 0x3a3f47 }));
    plinth.position.set(p.pos.x, p.pos.y + 0.3, p.pos.z);
    scene.add(g, plinth);
    return g;
  });
  const bench = new THREE.Group();
  bench.position.set(lay.bench.pos.x, lay.bench.pos.y, lay.bench.pos.z - 0.9);
  const wood = toon({ color: 0x7a5a3c });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.8), wood);
  top.position.y = 0.89;
  bench.add(top);
  for (const [x, z] of [[-1.1, -0.32], [1.1, -0.32], [-1.1, 0.32], [1.1, 0.32]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), wood);
    leg.position.set(x, 0.42, z);
    bench.add(leg);
  }
  const benchSign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: signTexture(renderer, ['GALE SCYTHE'], { w: 512, h: 128, bg: '#1d3a38', fg: '#8ff5e0', border: '#5a9a92' }), color: 0xd8dff0 }));
  benchSign.position.set(0, 1.9, -0.38);
  bench.add(benchSign);
  const benchParts = lay.parts.map((_, i) => {
    const m = partModels[i % partModels.length]();
    m.position.set(-0.7 + i * 0.7, 1.05, 0.05);
    m.scale.setScalar(0.7);
    bench.add(m);
    return m;
  });
  const onBench = buildScythe();
  onBench.rotation.y = Math.PI / 2; // lying flat along the bench, blade toward the back wall
  onBench.position.set(0.35, 1.0, 0.15);
  bench.add(onBench, partGlow(0x8ff5e0));
  scene.add(bench);
  let scytheState = 0;

  // --- Window boards ------------------------------------------------------
  const plankGeo = new THREE.BoxGeometry(3.45, 0.27, 0.1);
  const planks = new THREE.InstancedMesh(plankGeo, toon({ map: plankTexture(renderer), color: 0xd8cbb0 }), lay.barricades.length * MAX_BOARDS);
  planks.castShadow = true;
  planks.frustumCulled = false;
  scene.add(planks);
  const plankSpots = lay.barricades.map((b) =>
    Array.from({ length: MAX_BOARDS }, (_, i) => {
      const alongX = Math.abs(b.out.z) > 0.5;
      const pos = new THREE.Vector3(b.pos.x, b.pos.y + 0.5 + i * 0.56, b.pos.z).addScaledVector(new THREE.Vector3(b.out.x, 0, b.out.z), i % 2 ? 0.14 : -0.14);
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
  // On the north wall, unless that side is open or busy (then where `SIGN` says). Stairs, walkways and nooks go unsigned
  // (the Duck Shrine has a hand-painted one of its own).
  const SIGN: Record<string, { x?: number; y?: number; south?: boolean }> = {
    'Assembly Hall': { south: true },
    'Cold Storage': { x: -20 },
    'Rail Tunnel': { y: -1.8, south: true },
    'Old Drain': { y: -1.8, south: true },
    Showroom: { south: true },
    'Sorting Floor': { south: true },
    'Fitting Rooms': { x: -26 },
    'Break Room': { x: 26 },
    'Drafting Loft': { x: -20 },
  };
  for (const rm of lay.rooms) {
    if (rm.shape || (rm.x1 - rm.x0) * (rm.z1 - rm.z0) < 50) continue;
    const o = SIGN[rm.name] ?? {};
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: signTexture(renderer, [rm.name.toUpperCase()], { w: 512, h: 136, bg: '#2a2e35', fg: '#d9d2b8', border: '#8a8f99' }), color: 0xbfc6d8 }));
    sign.position.set(o.x ?? (rm.x0 + rm.x1) / 2, o.y ?? rm.floor + Math.min(5.4, (rm.ceil - rm.floor) * 0.62), o.south ? rm.z1 - 0.32 : rm.z0 + 0.32);
    sign.rotation.y = o.south ? Math.PI : 0;
    scene.add(sign);
    labels.push({ o: sign, x: sign.position.x, y: sign.position.y, z: sign.position.z });
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
  const decor = buildDecor(scene, renderer, toon);
  // The other perks: a cask each, in its colour, with its emblem.
  const EMBLEM = { mend: 'cross', zephyr: 'bolt', wind: 'wings' } as const;
  const perkMachines = lay.perks.map((p) => {
    const c = new THREE.Color(PERKS[p.kind].color);
    const m = buildPerkMachine(p.pos, PERKS[p.kind].color, c.clone().multiplyScalar(0.62).getHex(), c.clone().multiplyScalar(0.85).getHex(), EMBLEM[p.kind]);
    m.obj.rotation.y = p.yaw; // the tap faces into the room
    scene.add(m.obj);
    return m;
  });
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
    sync(w) {
      const { doors, boards, box: st } = w;
      const first = boxSpot < 0;
      const open = openRooms(map, doors);
      lay.chutes.forEach((c, i) => (lids[i].visible = !open.has(c.room)));
      hatchOpen = !!doors[lay.hatch];
      if (w.power && !power) powerAt = first ? -9 : lastT;
      power = w.power;
      bulb.material = power ? powerOn : powerOff;
      arm.rotation.x = power ? 2.4 : 0.5;
      scytheState = w.scythe;
      parts.forEach((g, i) => (g.visible = !w.parts[i]));
      benchParts.forEach((m, i) => (m.visible = w.scythe === 0 && !!w.parts[i]));
      onBench.visible = w.scythe === -1;
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
      // No power: the lamps are all but dark. Thrown on, they stutter up over a second and a half.
      const since = time - powerAt;
      const pk = !power ? 0.08 : since > 1.5 ? 1 : Math.sin(since * 40) > 0 ? since / 1.5 : 0.08;
      const fl = (i: number, l: Lamp) => pk * (l.flicker ? (Math.sin(time * 31 + i * 7) > 0.6 && Math.sin(time * 3.1 + i) > 0.1 ? 0.25 : 0.9 + 0.1 * Math.sin(time * 50 + i)) : 0.95);
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
      for (const l of labels) l.o.visible = Math.hypot(l.x - viewer.x, (l.y - viewer.y) * 2, l.z - viewer.z) < LABEL_RANGE;
      furnaceGlow.scale.setScalar(1 + Math.sin(time * 7) * 0.02);
      (furnaceHalo.material as THREE.SpriteMaterial).opacity = (0.45 + 0.15 * Math.sin(time * 5.3) + 0.1 * Math.sin(time * 13)) * (power ? 1 : 0.25);
      // The Skyline pad hums once the hatch is open; scythe parts bob and spin.
      padMat.color.setHex(hatchOpen ? 0x5fe0c8 : 0x2c4a52);
      (padGlow.material as THREE.SpriteMaterial).opacity = hatchOpen ? 0.5 + 0.2 * Math.sin(time * 4) : 0;
      parts.forEach((g, i) => {
        g.rotation.y = time * 1.6 + i;
        g.position.y = lay.parts[i].pos.y + 1.1 + Math.sin(time * 2.2 + i) * 0.12;
      });
      onBench.position.y = scytheState === -1 ? 1.0 + Math.sin(time * 2) * 0.04 : 1.0;
      decor.update(time, viewer);
      punch.update(time);
      jug.update(time);
      for (const m of perkMachines) m.update(time);
      box.update(time, boxState, () => world.onEvent?.('tick', { x: box.obj.position.x, y: 1, z: box.obj.position.z }));
    },
  };
  return world;
}
