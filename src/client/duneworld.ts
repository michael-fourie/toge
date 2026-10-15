import * as THREE from 'three';
import type { Box } from '../shared/collision.ts';
import { WELL } from '../shared/dunevillage.ts';
import type { MapData } from '../shared/map.ts';
import { awningTexture, duneTexture, mudbrickTexture, palmBarkTexture, roofTexture, sandTexture, sandstoneTexture, tileTexture } from './dunetextures.ts';
import { padTexture, rng, softDot, woodTexture } from './textures.ts';
import { type World, boxGeometry, hookRing, puffball, rampGeometry, windGate, windSpirit } from './world.ts';
import { pbr } from './render/surface.ts';
import { daySky } from './render/sky.ts';
import { pointSprites } from './render/points.ts';

// Dune Village in the late afternoon: a hot clear sky with a pale sun low in the west, long soft shadows, warm sand and
// ochre walls with turquoise accents (tile, awnings, doors), dust drifting in the light. Gameplay surfaces stay distinct:
// pale sand floors, block-stone walls, rippled apricot slide ramps, glazed turquoise surf, mint-glowing pads and gates.

const SUN_DIR = new THREE.Vector3(-58, 52, 34).normalize();
const TURQUOISE = 0x2fa7a3;

export function buildDuneVillage(map: MapData): World {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf3ddb4, 120, 560);
  scene.add(daySky(SUN_DIR, { turbidity: 6, rayleigh: 1.4, clouds: 0.06 })); // dusty, nearly cloudless
  scene.add(new THREE.HemisphereLight(0xfff3dc, 0xe6b27a, 0.2));
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.6);
  sun.position.copy(SUN_DIR).multiplyScalar(140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -75;
  sc.right = sc.top = 75;
  sc.near = 1;
  sc.far = 320;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const sand = pbr({ map: sandTexture() });
  const sandstone = pbr({ map: sandstoneTexture() });
  const plaster = pbr({ map: mudbrickTexture() });
  const roof = pbr({ map: roofTexture() });
  const wood = pbr({ map: woodTexture() });
  const dune = pbr({ map: duneTexture() });
  const tile = pbr({ map: tileTexture() });
  const awning = pbr({ map: awningTexture(), side: THREE.DoubleSide });
  const bark = pbr({ map: palmBarkTexture() });
  const clay = pbr({ color: 0xc8764a });
  const turquoise = pbr({ color: TURQUOISE });
  const padMat = pbr({ map: padTexture(), emissive: new THREE.Color(0x58e0b8), emissiveIntensity: 0.5 });

  const pads: THREE.Object3D[] = [];
  const hooks: ReturnType<typeof hookRing>[] = [];
  const add = (mesh: THREE.Object3D, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(mesh);
  };
  const walls = map.boxes.filter((b) => b.kind === 'wall');
  const onWall = (b: Box) => walls.some((w) => Math.abs(w.max.y - b.min.y) < 0.01 && w.min.x <= b.min.x && w.max.x >= b.max.x && w.min.z <= b.min.z && w.max.z >= b.max.z);

  for (const b of map.boxes) {
    if (b.ramp) {
      add(new THREE.Mesh(rampGeometry(b, b.kind === 'surf' ? 2.5 : 3), b.kind === 'surf' ? [tile, sandstone] : [dune, sandstone]));
      continue;
    }
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    switch (b.kind) {
      case 'floor': // the town's sand, or a packed-clay roof
        add(new THREE.Mesh(boxGeometry(b, b.max.y > 0.5 ? 2.5 : 7), b.max.y > 0.5 ? roof : sand), cx, cy, cz);
        break;
      case 'wall': // thick: the town wall's sandstone; thin: plastered house walls
        add(new THREE.Mesh(boxGeometry(b, 4, true), Math.min(sx, sz) >= 0.9 ? sandstone : plaster), cx, cy, cz);
        break;
      case 'cover':
        if (Math.abs(cx) < 0.01 && Math.abs(cz) < 0.01) add(well(sandstone, roof, wood), 0, 0, 0);
        else if (sy < 0.7) add(new THREE.Mesh(boxGeometry(b, 2), wood), cx, cy, cz); // timber floors and balconies
        else if (onWall(b)) add(new THREE.Mesh(boxGeometry(b, 2, true), sandstone), cx, cy, cz); // merlons
        else if (Math.max(sx, sz) > 2.5) add(new THREE.Mesh(boxGeometry(b, 4, true), plaster), cx, cy, cz); // parapets, low walls, counters
        else if (Math.max(sx, sz) <= 1.05) add(pot(sx / 2, sy, clay, turquoise), cx, b.min.y, cz); // clay jars
        else add(crate(b, wood, turquoise), cx, cy, cz);
        break;
      case 'branch': // thin cloth awnings, or timber
        if (sy <= 0.25) add(stallAwning(b, awning, wood), cx, cy, cz);
        else add(new THREE.Mesh(boxGeometry(b, 2), wood), cx, cy, cz);
        break;
      case 'trunk':
        add(palm(sy, bark, rng(Math.round(cx * 13 + cz * 7))), cx, b.min.y, cz);
        break;
      case 'pad': {
        const mesh = new THREE.Mesh(boxGeometry(b, sx), padMat);
        add(mesh, cx, cy, cz);
        pads.push(mesh, ...windSpirit(scene, b));
        break;
      }
      case 'hook':
        hooks.push(hookRing(cx, cy, cz, sandstone));
        break;
      default:
        add(new THREE.Mesh(boxGeometry(b, 3), sandstone), cx, cy, cz);
    }
  }

  const boosters = [...map.triggers.map((t) => (t.kind === 'boost' ? windGate(t) : puffball(t))), ...hooks];
  boosters.forEach((b) => scene.add(b.obj));

  const r = rng(23);
  for (const s of [1, -1]) {
    const door = townGate(turquoise, wood);
    door.rotation.y = s > 0 ? 0 : Math.PI;
    add(door, 0, 0, s * 31.5); // in the wall between the gatehouse towers, both ends of town
  }
  const dust = dustMotes();
  scene.add(paleSun(), desert(sand, r), skyline(r), farPalms(bark, r), dust.points);

  return {
    scene,
    update(time: number) {
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
      dust.update(time);
      for (const b of boosters) b.update(time);
    },
  };
}

/** The plaza well: a square stone curb with a rim (the collision box itself), dark water, posts and a little clay roof. */
function well(stone: THREE.Material, roof: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const s = WELL.half * 2;
  const curb = new THREE.Mesh(new THREE.BoxGeometry(s, WELL.h - 0.15, s), stone);
  curb.position.y = (WELL.h - 0.15) / 2;
  g.add(curb);
  for (const [x, z, w, d] of [[0, -1, s, 0.3], [0, 1, s, 0.3], [-1, 0, 0.3, s], [1, 0, 0.3, s]]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.15, d + 0.04), stone);
    rim.position.set(x * (WELL.half - 0.15), WELL.h - 0.075, z * (WELL.half - 0.15));
    g.add(rim);
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(s - 0.6, s - 0.6), new THREE.MeshBasicMaterial({ color: 0x1f5d66 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WELL.h - 0.14;
  g.add(water);
  for (const [x, z] of [[-1, -1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.18), wood);
    post.position.set(x * (WELL.half - 0.15), WELL.h + 1.15, z * (WELL.half - 0.15));
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.7, 8), wood);
  beam.rotation.z = Math.PI / 2;
  beam.rotation.y = Math.PI / 4;
  beam.position.y = 2.9;
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.35, 10), pbr({ color: TURQUOISE }));
  bucket.position.y = 2.3;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 0.9, 4), roof); // sits on the roof slab
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 3.6 + 0.45;
  g.add(beam, bucket, cap);
  return g;
}

/** A round-bellied clay jar with a turquoise glazed band. */
function pot(r: number, h: number, clay: THREE.Material, glaze: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    [0, 0],
    [r * 0.7, 0],
    [r * 1.05, h * 0.35],
    [r * 0.95, h * 0.7],
    [r * 0.55, h * 0.92],
    [r * 0.65, h],
    [r * 0.5, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 16), clay));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, h * 0.12, 16, 1, true), glaze);
  band.position.y = h * 0.45;
  g.add(band);
  return g;
}

/** A wooden crate with turquoise-painted corner straps. */
function crate(b: Box, wood: THREE.Material, paint: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  g.add(new THREE.Mesh(boxGeometry(b, 1.2), wood));
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, sy + 0.04, 0.12), paint);
    strap.position.z = s * sz * 0.3;
    g.add(strap);
  }
  return g;
}

/** A stall awning: a cloth that sags a touch between four timber poles down to the ground. */
function stallAwning(b: Box, cloth: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const sy = b.max.y - b.min.y;
  const geo = new THREE.BoxGeometry(sx, sy, sz, 8, 1, 8);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (sx / 2);
    const w = pos.getZ(i) / (sz / 2);
    pos.setY(i, pos.getY(i) - 0.12 * (1 - u * u) * (1 - w * w));
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, cloth));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, b.min.y, 6), wood);
    pole.position.set(x * (sx / 2 - 0.1), -b.min.y / 2 - sy / 2, z * (sz / 2 - 0.1));
    g.add(pole);
  }
  // A scalloped valance along the front edge.
  for (let i = 0; i < 6; i++) {
    const flap = new THREE.Mesh(new THREE.CircleGeometry(sx / 12, 8, Math.PI, Math.PI), cloth);
    flap.position.set(-sx / 2 + (i + 0.5) * (sx / 6), -sy / 2, -sz / 2 - 0.01);
    g.add(flap);
  }
  return g;
}

/** A date palm: a gently curved, tapering trunk of stacked scales and a crown of drooping fronds. */
function palm(h: number, bark: THREE.Material, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h, 10, 6), bark);
  trunk.position.y = h / 2;
  g.add(trunk);
  const leaf = pbr({ color: 0x5e9a3e, side: THREE.DoubleSide });
  const leafDark = pbr({ color: 0x467d33, side: THREE.DoubleSide });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const len = 3.2 + r() * 1.2;
    const geo = new THREE.PlaneGeometry(len, 0.9, 10, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + len / 2; // 0 at the crown, len at the tip
      const t = x / len;
      const half = pos.getY(k);
      pos.setXYZ(k, x, 0.9 * t - 2.2 * t * t, half * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1)) * 1.1); // arch out, then droop
    }
    geo.computeVertexNormals();
    const frond = new THREE.Mesh(geo, i % 2 ? leaf : leafDark);
    frond.position.y = h - 0.1;
    frond.rotation.y = (i / n) * Math.PI * 2 + r() * 0.3;
    frond.rotation.x = (r() - 0.5) * 0.4;
    g.add(frond);
  }
  const nut = pbr({ color: 0x7a5232 });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), nut);
    const a = (i / 4) * Math.PI * 2;
    c.position.set(Math.cos(a) * 0.3, h - 0.45, Math.sin(a) * 0.3);
    g.add(c);
  }
  return g;
}

/** The town gate set into the wall between the gatehouse towers: big turquoise doors with studs, shut for good. */
function townGate(paint: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const W = 5.6;
  const H = 7.4;
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(W / 2 - 0.05, H, 0.2), paint);
    leaf.position.set((s * W) / 4, H / 2, -0.1);
    g.add(leaf);
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 3; col++) {
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xe4b04a }));
        stud.position.set((s * W) / 4 + (col - 1) * 0.75, 0.8 + row * 1.15, -0.22);
        g.add(stud);
      }
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.35, 0.3), wood);
  bar.position.set(0, 3.4, -0.3);
  g.add(bar);
  return g;
}

/** A pale, hazy sun low over the dunes. */
function paleSun(): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xfffbea, transparent: true, depthWrite: false, fog: false }));
  s.position.copy(SUN_DIR).multiplyScalar(820);
  s.scale.setScalar(120);
  s.renderOrder = -1;
  return s;
}

/** Sand all the way to the horizon outside the wall, rolling away in big soft dunes. */
function desert(sand: THREE.Material, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48), sand);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);
  const tint = [0xe9c08a, 0xe2b27b, 0xf0cd99].map((c) => pbr({ color: c }));
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.12;
    const d = 110 + r() * 330;
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tint[i % 3]);
    const w = 40 + r() * 90;
    dune.scale.set(w, 8 + r() * (d / 12), w * (0.35 + r() * 0.3));
    dune.position.set(Math.cos(a) * d, -1, Math.sin(a) * d);
    dune.rotation.y = a + (r() - 0.5) * 0.8;
    g.add(dune);
  }
  return g;
}

/** Flat-roofed houses of the rest of the town peeking over the wall, and a far-off clay tower or two. */
function skyline(r: () => number): THREE.Group {
  const g = new THREE.Group();
  const walls = [0xe9cda2, 0xe2bf8e, 0xf0dab4].map((c) => pbr({ color: c }));
  const lip = pbr({ color: 0xc99868 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + r() * 0.1;
    const d = 66 + r() * 50;
    const w = 6 + r() * 10;
    const h = 6 + r() * 10;
    const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + r() * 8), walls[i % 3]);
    house.position.set(Math.cos(a) * d * 1.15, h / 2, Math.sin(a) * d * 0.85);
    house.rotation.y = r() < 0.5 ? 0 : Math.PI / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, 0.5), lip);
    top.position.y = h / 2 + 0.25;
    house.add(top);
    g.add(house);
  }
  for (const [x, z, h] of [[-95, 62, 26], [104, -48, 22], [20, 110, 18]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, h, 12), walls[0]);
    tower.position.set(x, h / 2, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 3.4, 2.4, 12), lip);
    cap.position.y = h / 2 + 1.2;
    tower.add(cap);
    g.add(tower);
  }
  return g;
}

/** Palm groves outside the walls (an oasis or two). */
function farPalms(bark: THREE.Material, r: () => number): THREE.Group {
  const g = new THREE.Group();
  for (const [cx, cz] of [[-80, -70], [90, 60], [-120, 20], [60, -110]]) {
    for (let i = 0; i < 6; i++) {
      const p = palm(7 + r() * 5, bark, r);
      p.position.set(cx + (r() - 0.5) * 22, 0, cz + (r() - 0.5) * 22);
      p.rotation.y = r() * Math.PI;
      g.add(p);
    }
  }
  return g;
}

/** Dust motes drifting slowly downwind through the town, catching the light. */
function dustMotes() {
  const N = 420;
  const r = rng(77);
  const base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    base[i * 3] = (r() - 0.5) * 110;
    base[i * 3 + 1] = r() * 18;
    base[i * 3 + 2] = (r() - 0.5) * 80;
  }
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(base);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = pointSprites(geo, { map: softDot(), color: 0xfff1d0, size: 0.22, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true });
  points.frustumCulled = false;
  return {
    points,
    update(time: number) {
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        pos[k] = ((base[k] + time * 1.6 + 55) % 110) - 55 + Math.sin(time * 0.5 + i) * 0.6;
        pos[k + 1] = base[k + 1] + Math.sin(time * 0.7 + i * 1.7) * 0.5;
        pos[k + 2] = base[k + 2] + Math.cos(time * 0.4 + i) * 0.6;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
