import * as THREE from 'three';
import type { Box } from '../shared/collision.ts';
import type { MapData } from '../shared/map.ts';
import { concreteTexture, conveyorTexture, crateTexture, hazardTexture, plankTexture, steelTexture, brickTexture } from './foundrytextures.ts';
import { padTexture, rng, softDot, surfTexture } from './textures.ts';
import { type World, boxGeometry, hookRing, puffball, rampGeometry, windGate, windSpirit } from './world.ts';
import { pbr, type SurfaceParams } from './render/surface.ts';
import { daySky } from './render/sky.ts';

// Rustworks by afternoon: a hazy, rust-orange sky over a roofless brick hall. Same PBR lighting as Windward,
// with the Foundry's grimy textures. Gameplay surfaces stay distinct: pale concrete floors, striped ramps,
// blue glazed surf ducts, mint-glowing pads and gates.

const SUN_DIR = new THREE.Vector3(-45, 38, 55).normalize();

export function buildRustworks(map: MapData): World {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd9b996, 90, 420);
  scene.add(daySky(SUN_DIR, { turbidity: 7, rayleigh: 2.2, clouds: 0.3 })); // smoky industrial haze
  scene.add(new THREE.HemisphereLight(0xe9d7bd, 0x6f5a48, 0.15));
  const sun = new THREE.DirectionalLight(0xffcf98, 3.4);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -80;
  sc.right = sc.top = 80;
  sc.near = 1;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // The Foundry's textures are painted for night, so they're lifted a little for an afternoon sun.
  const day = (map: THREE.Texture, extra: SurfaceParams = {}) => pbr({ map, color: new THREE.Color(1.3, 1.25, 1.2), ...extra });
  const concrete = day(concreteTexture());
  const brick = day(brickTexture());
  const steel = day(steelTexture(), { metalness: 0.75, roughness: 0.55 });
  const belt = day(conveyorTexture(), { roughness: 0.7 });
  const crate = day(crateTexture());
  const plank = day(plankTexture());
  const stripes = day(hazardTexture(), { roughness: 0.6 });
  const surf = pbr({ map: surfTexture() });
  const padMat = pbr({ map: padTexture(), emissive: new THREE.Color(0x58e0b8), emissiveIntensity: 0.5 });
  const rustDark = pbr({ color: 0x6b4a38 });

  const pads: THREE.Object3D[] = [];
  const hooks: ReturnType<typeof hookRing>[] = [];
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  for (const b of map.boxes) {
    if (b.ramp) {
      add(new THREE.Mesh(rampGeometry(b, b.kind === 'surf' ? 2 : 1.2), b.kind === 'surf' ? [surf, rustDark] : [stripes, steel]));
      continue;
    }
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const sy = b.max.y - b.min.y;
    let mesh: THREE.Mesh;
    switch (b.kind) {
      case 'floor':
        mesh = new THREE.Mesh(boxGeometry(b, 3), concrete);
        break;
      case 'wall':
        mesh = new THREE.Mesh(boxGeometry(b, 3), brick);
        break;
      case 'cover': // crates, but thin slabs (house floors, rails) are planks
        mesh = new THREE.Mesh(boxGeometry(b, sy < 0.7 || Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > 4 ? 1.2 : 1.8), sy < 0.7 || Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > 4 ? plank : crate);
        break;
      case 'branch': // conveyor belts are thick, catwalks thin
        mesh = new THREE.Mesh(boxGeometry(b, sy > 1 ? 1.6 : 2.4), sy > 1 ? belt : steel);
        break;
      case 'pad':
        mesh = new THREE.Mesh(boxGeometry(b, b.max.x - b.min.x), padMat);
        pads.push(mesh, ...windSpirit(scene, b));
        break;
      case 'hook':
        hooks.push(hookRing(cx, cy, cz, rustDark));
        continue;
      default:
        mesh = new THREE.Mesh(boxGeometry(b, 3), steel);
    }
    mesh.position.set(cx, cy, cz);
    add(mesh);
  }

  const boosters = [...map.triggers.map((t) => (t.kind === 'boost' ? windGate(t) : puffball(t))), ...hooks];
  boosters.forEach((b) => scene.add(b.obj));

  const r = rng(11);
  const smoke = smokestacks(map, brick, r);
  scene.add(smoke.group, skyline(brick, r), rubble(map.boxes, r));

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
      smoke.update(time);
      for (const b of boosters) b.update(time);
    },
  };
}

/** Tall brick chimneys outside the walls with slow plumes of smoke. */
function smokestacks(map: MapData, brick: THREE.Material, r: () => number) {
  const group = new THREE.Group();
  const puffs: { m: THREE.Sprite; x: number; z: number; seed: number }[] = [];
  const dot = new THREE.SpriteMaterial({ map: softDot(), color: 0x8c8379, transparent: true, opacity: 0.4, depthWrite: false });
  for (const d of map.decor.filter((d) => d.kind === 'stack')) {
    const h = 58 + r() * 14;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(d.radius * 0.7, d.radius, h, 18), brick);
    shaft.position.set(d.pos.x, d.pos.y + h / 2, d.pos.z);
    shaft.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(d.radius * 0.85, d.radius * 0.7, 1.6, 18), pbr({ color: 0x3a2e28 }));
    rim.position.set(d.pos.x, d.pos.y + h, d.pos.z);
    group.add(shaft, rim);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Sprite(dot.clone());
      group.add(m);
      puffs.push({ m, x: d.pos.x, z: d.pos.z, seed: i / 7 + h * 0.01 });
      m.userData.top = d.pos.y + h;
    }
  }
  return {
    group,
    update(time: number) {
      for (const p of puffs) {
        const k = (time * 0.05 + p.seed) % 1;
        p.m.position.set(p.x + k * 22 + Math.sin(p.seed * 40) * 2, (p.m.userData.top as number) + k * 34, p.z + k * 6);
        p.m.scale.setScalar(6 + k * 22);
        p.m.material.opacity = 0.42 * Math.sin(k * Math.PI);
      }
    },
  };
}

/** A hazy skyline of far-off sheds and cooling towers so the horizon isn't empty. */
function skyline(brick: THREE.Material, r: () => number) {
  const g = new THREE.Group();
  const dark = pbr({ color: 0x9c8b78, fog: true });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + r() * 0.1;
    const dist = 230 + r() * 140;
    const w = 14 + r() * 40;
    const h = 8 + r() * 34;
    const m = new THREE.Mesh(i % 5 === 0 ? new THREE.CylinderGeometry(w * 0.3, w * 0.45, h * 2, 14) : new THREE.BoxGeometry(w, h, 10 + r() * 30), i % 3 ? dark : brick);
    m.position.set(Math.cos(a) * dist, i % 5 === 0 ? h - 6 : h / 2 - 6, Math.sin(a) * dist);
    m.rotation.y = r() * Math.PI;
    g.add(m);
  }
  return g;
}

/** Scattered rubble and rusty barrels on the open floor; purely visual, kept away from where the boxes are. */
function rubble(boxes: readonly Box[], r: () => number) {
  const g = new THREE.Group();
  const bits = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.28, 0), pbr({ color: 0x8a7a6a }), 160);
  const m = new THREE.Matrix4();
  let n = 0;
  while (n < 160) {
    const x = (r() - 0.5) * 94;
    const z = (r() - 0.5) * 66;
    if (boxes.some((b) => b.kind !== 'hook' && b.max.y > 0.05 && x > b.min.x - 0.6 && x < b.max.x + 0.6 && z > b.min.z - 0.6 && z < b.max.z + 0.6)) continue;
    const s = 0.4 + r() * 1.1;
    m.compose(new THREE.Vector3(x, 0.08 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(s, s * 0.6, s));
    bits.setMatrixAt(n++, m);
  }
  bits.receiveShadow = true;
  g.add(bits);
  return g;
}
