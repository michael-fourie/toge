import * as THREE from 'three';
import type { Box } from '../shared/collision.ts';
import type { MapData } from '../shared/map.ts';
import { CABLEWAYS } from '../shared/summit.ts';
import { cliffTexture, graniteTexture, iceTexture, iceWallTexture, logTexture, pisteTexture, snowTexture } from './summittextures.ts';
import { barkTexture, cloudSeaTexture, cloudTexture, padTexture, rng, softDot, toonRamp, woodTexture } from './textures.ts';
import { type World, boxGeometry, hookRing, makeSky, puffball, rampGeometry, windGate, windSpirit } from './world.ts';

// Summit on a clear cold morning: pale blue sky, a low bright sun, snow everywhere, a sea of cloud below
// and other peaks poking through it. Gameplay surfaces stay distinct: snow-topped rock floors, groomed
// piste slide ramps with orange markers, glassy cyan surf ice, deep-blue ice walls, dark log lodge walls,
// granite boulders, mint-glowing pads and gates.

const SKY = { zenith: 0x4a86d0, sky: 0x9cc8ee, horizon: 0xf3f6fb, below: 0xe9eff7, deep: 0xb9cbe2 };
const SUN_DIR = new THREE.Vector3(60, 45, -40).normalize();
const CLOUD_Y = -42; // the cloud sea, well below killY (-14): fallers vanish long before they reach it
const CLIFF_BOTTOM = -24; // cliffs run down to here, inside the mountainside
const SHOULDER_TOP = -15; // the snowy mountainside flares out from here, just below killY

export function buildSummit(map: MapData, renderer: THREE.WebGLRenderer): World {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdfe9f4, 140, 760);
  scene.add(makeSky(SKY, SUN_DIR));
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x8a98b0, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0da, 2.3);
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

  const ramp = toonRamp();
  const toon = (p: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...p });
  // Shadowed snow would go grey; a cool emissive keeps it bright and blue in the shade.
  const snow = toon({ map: snowTexture(renderer), emissive: new THREE.Color(0x56627a), emissiveIntensity: 0.5 });
  const cliff = toon({ map: cliffTexture(renderer), emissive: new THREE.Color(0x3a4458), emissiveIntensity: 0.4 });
  const granite = toon({ map: graniteTexture(renderer), emissive: new THREE.Color(0x2e3646), emissiveIntensity: 0.4 });
  const iceWall = toon({ map: iceWallTexture(renderer), emissive: new THREE.Color(0x2a6a96), emissiveIntensity: 0.35 });
  const surf = toon({ map: iceTexture(renderer), emissive: new THREE.Color(0x3a8ab8), emissiveIntensity: 0.35 });
  const iceDeep = toon({ color: 0x5f9cc4, emissive: new THREE.Color(0x24506e), emissiveIntensity: 0.4 });
  const piste = toon({ map: pisteTexture(renderer), emissive: new THREE.Color(0x5a5248), emissiveIntensity: 0.35 });
  const logs = toon({ map: logTexture(renderer) });
  const wood = toon({ map: woodTexture(renderer) });
  const bark = toon({ map: barkTexture(renderer) });
  const padMat = toon({ map: padTexture(renderer), emissive: new THREE.Color(0x58e0b8), emissiveIntensity: 0.5 });

  const pads: THREE.Object3D[] = [];
  const hooks: ReturnType<typeof hookRing>[] = [];
  const trunks: Box[] = [];
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  for (const b of map.boxes) {
    if (b.ramp) {
      add(new THREE.Mesh(rampGeometry(b, b.kind === 'surf' ? 3 : 1.5), b.kind === 'surf' ? [surf, iceDeep] : [piste, cliff]));
      continue;
    }
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const sy = b.max.y - b.min.y;
    const thin = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
    let mesh: THREE.Mesh;
    // Face order: [+x, -x, top, bottom, +z, -z].
    switch (b.kind) {
      case 'floor':
        // Rock shelves capped with snow; the lodge roof is a thin slab, so it gets log sides.
        mesh = new THREE.Mesh(boxGeometry(b, 3, true), sy < 0.6 ? [wood, wood, snow, wood, wood, wood] : [cliff, cliff, snow, granite, cliff, cliff]);
        // The ground's cliffs keep going down into the mountainside.
        if (b.min.y <= -7.9) add(cliffSkirt(b, cliff));
        break;
      case 'wall':
        // Lodge walls are logs (0.5 m), wallrun walls are ice (1 m), the rest is granite.
        mesh = new THREE.Mesh(boxGeometry(b, 3), thin < 0.6 ? [logs, logs, snow, logs, logs, logs] : thin < 1.5 ? [iceWall, iceWall, snow, iceWall, iceWall, iceWall] : [granite, granite, snow, granite, granite, granite]);
        break;
      case 'cover': {
        // Boulders, drifts and the summit rim are snow-capped granite; thin or long slabs (lodge floors, parapets, rails) are timber.
        const slab = sy < 0.7 || Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > 4;
        mesh = new THREE.Mesh(boxGeometry(b, slab ? 1.2 : 2), slab ? wood : [granite, granite, snow, granite, granite, granite]);
        break;
      }
      case 'branch': // the cable station deck
        mesh = new THREE.Mesh(boxGeometry(b, 1.2), wood);
        break;
      case 'trunk':
        mesh = new THREE.Mesh(boxGeometry(b, 2), [bark, bark, snow, bark, bark, bark]);
        trunks.push(b);
        break;
      case 'pad':
        mesh = new THREE.Mesh(boxGeometry(b, b.max.x - b.min.x), padMat);
        pads.push(mesh, ...windSpirit(scene, b));
        break;
      case 'hook':
        hooks.push(hookRing(cx, cy, cz, granite));
        continue;
      default:
        mesh = new THREE.Mesh(boxGeometry(b, 3), granite);
    }
    mesh.position.set(cx, cy, cz);
    add(mesh);
  }

  const boosters = [...map.triggers.map((t) => (t.kind === 'boost' ? windGate(t) : puffball(t))), ...hooks];
  boosters.forEach((b) => scene.add(b.obj));

  const r = rng(23);
  const flag = summitFlag(map.boxes);
  const cables = cableways(granite);
  scene.add(pines(trunks, r), flag.group, cables.group, mountainside(renderer, r), cloudSea(renderer), distantPeaks(r), horizonClouds(r));
  const snowfall = fallingSnow();
  scene.add(snowfall.points);

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
      flag.update(time);
      cables.update(time);
      snowfall.update(time);
      for (const b of boosters) b.update(time);
    },
  };
}

/** Rock straight down from a ground box's underside into the mountainside, so the plateau stands on a mountain. */
function cliffSkirt(b: Box, mat: THREE.Material): THREE.Mesh {
  const skirt: Box = { min: { x: b.min.x, y: CLIFF_BOTTOM, z: b.min.z }, max: { x: b.max.x, y: b.min.y, z: b.max.z }, kind: 'wall' };
  const m = new THREE.Mesh(boxGeometry(skirt, 6), mat);
  m.position.set((b.min.x + b.max.x) / 2, (CLIFF_BOTTOM + b.min.y) / 2, (b.min.z + b.max.z) / 2);
  return m;
}

/**
 * The mountain under the plateau: a craggy snow cone flaring out from just below the cliffs (and below killY)
 * down through the cloud sea. Its top hides inside the cliffs.
 */
function mountainside(renderer: THREE.WebGLRenderer, r: () => number): THREE.Group {
  const g = new THREE.Group();
  // Snow-capped rock bands, repeating down the slope.
  const tex = cliffTexture(renderer);
  tex.repeat.set(14, 4);
  const slope = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonRamp(), emissive: new THREE.Color(0x3a4458), emissiveIntensity: 0.4 });
  const h = 90;
  const geo = new THREE.CylinderGeometry(46, 190, h, 28, 6, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > h / 2 - 1e-3) continue; // keep the top ring tucked inside the cliffs
    const k = 1 + (r() - 0.5) * 0.18;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, y + (r() - 0.5) * 6);
  }
  geo.computeVertexNormals();
  const cone = new THREE.Mesh(geo, slope);
  cone.scale.set(1.05, 1, 0.72);
  cone.position.y = SHOULDER_TOP - h / 2;
  cone.receiveShadow = true;
  g.add(cone);
  return g;
}

/** Snow-laden pine boughs on each trunk, starting above head height so they never hide a player. */
function pines(trunks: Box[], r: () => number): THREE.Group {
  const g = new THREE.Group();
  const needles = [new THREE.MeshToonMaterial({ color: 0x2f5a46, gradientMap: toonRamp() }), new THREE.MeshToonMaterial({ color: 0x3a6b52, gradientMap: toonRamp() })];
  const snowCap = new THREE.MeshToonMaterial({ color: 0xf4f8fd, emissive: 0x56627a, emissiveIntensity: 0.4, gradientMap: toonRamp() });
  for (const t of trunks) {
    const x = (t.min.x + t.max.x) / 2;
    const z = (t.min.z + t.max.z) / 2;
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const rad = 2.4 - k * 0.5;
      const h = 2.2;
      const y = t.min.y + 2.9 + k * 1.35;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 9), needles[k % 2]);
      cone.position.set(x, y + h / 2, z);
      cone.rotation.y = r() * 3;
      cone.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.72, h * 0.5, 9), snowCap);
      cap.position.set(x, y + h * 0.78, z);
      cap.rotation.y = cone.rotation.y;
      g.add(cone, cap);
    }
  }
  return g;
}

/** A little red flag and a cairn on the highest box (the peak). */
function summitFlag(boxes: readonly Box[]) {
  const peak = boxes.filter((b) => b.kind === 'floor').reduce((a, b) => (b.max.y > a.max.y ? b : a));
  const g = new THREE.Group();
  g.position.set((peak.min.x + peak.max.x) / 2, peak.max.y, (peak.min.z + peak.max.z) / 2);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.4, 8), new THREE.MeshToonMaterial({ color: 0x5a4030 }));
  pole.position.y = 1.7;
  const geo = new THREE.PlaneGeometry(1.4, 0.8, 8, 2);
  geo.translate(0.7, 0, 0);
  const flag = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: 0xe0524a, side: THREE.DoubleSide, gradientMap: toonRamp() }));
  flag.position.y = 3;
  const cairn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), new THREE.MeshToonMaterial({ color: 0x8a93a3 }));
  cairn.position.y = 0.2;
  cairn.scale.y = 0.6;
  g.add(pole, flag, cairn);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rest = Float32Array.from(pos.array as Float32Array);
  return {
    group: g,
    update(time: number) {
      // Ripples run away from the pole, growing toward the free end.
      for (let i = 0; i < pos.count; i++) pos.setZ(i, rest[i * 3 + 2] + Math.sin(time * 6 - rest[i * 3] * 3) * 0.12 * rest[i * 3]);
      pos.needsUpdate = true;
    },
  };
}

/** The haul rope off each cable station, sagging down the mountain into the clouds, with gondolas riding it. */
function cableways(rockMat: THREE.Material) {
  const group = new THREE.Group();
  const steel = new THREE.MeshToonMaterial({ color: 0x3b4250 });
  const cabinMat = new THREE.MeshToonMaterial({ color: 0xd8483e, gradientMap: toonRamp() });
  const glass = new THREE.MeshToonMaterial({ color: 0xbfe3f5, emissive: 0x4a7a96, emissiveIntensity: 0.4 });
  const LEN = 320;
  const DROP = 90;
  const lines: THREE.CatmullRomCurve3[] = [];
  const cabins: THREE.Group[] = [];
  for (const c of CABLEWAYS) {
    const side = new THREE.Vector3(c.dir.z, 0, -c.dir.x); // the two ropes, up and down, sit side by side
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 8, 24), steel);
    wheel.position.set(c.from.x, c.from.y + 0.6, c.from.z);
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);
    // A pylon off the edge, well out of play.
    const pylonAt = new THREE.Vector3(c.from.x + c.dir.x * 70, 0, c.from.z + c.dir.z * 70);
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 60, 6), steel);
    pylon.position.set(pylonAt.x, -16, pylonAt.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.4), steel);
    arm.position.set(pylonAt.x, 14, pylonAt.z);
    arm.rotation.y = Math.atan2(c.dir.x, c.dir.z) + Math.PI / 2;
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(3, 0), rockMat);
    base.position.set(pylonAt.x, -44, pylonAt.z);
    group.add(pylon, arm, base);
    for (const s of [-1, 1]) {
      const at = (d: number, y: number) => new THREE.Vector3(c.from.x + c.dir.x * d + side.x * s * 1.3, y, c.from.z + c.dir.z * d + side.z * s * 1.3);
      const curve = new THREE.CatmullRomCurve3([at(0, c.from.y + 0.6), at(70, 14), at(LEN * 0.6, -30), at(LEN, -DROP)]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.06, 5), steel));
      lines.push(curve);
    }
  }
  for (let i = 0; i < lines.length * 2; i++) {
    const cab = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 2.2), cabinMat);
    body.position.y = -2.2;
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.6, 1.9), glass);
    win.position.y = -1.9;
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5), steel);
    hanger.position.y = -0.7;
    cab.add(body, win, hanger);
    cabins.push(cab);
    group.add(cab);
  }
  return {
    group,
    update(time: number) {
      cabins.forEach((cab, i) => {
        const line = lines[i % lines.length];
        const up = i % 2 === 0; // alternate ropes go up and down
        let k = (time * 0.012 + i * 0.37) % 1;
        if (!up) k = 1 - k;
        cab.position.copy(line.getPointAt(0.04 + k * 0.94));
      });
    },
  };
}

/** The sea of cloud the summit stands in. */
function cloudSea(renderer: THREE.WebGLRenderer): THREE.Mesh {
  const tex = cloudSeaTexture(renderer);
  tex.repeat.set(10, 10);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.97, depthWrite: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = CLOUD_Y;
  sea.renderOrder = -1;
  return sea;
}

/** A ring of far-off snowy peaks rising out of the clouds. */
function distantPeaks(r: () => number): THREE.Group {
  const g = new THREE.Group();
  const rock = [0x8592a8, 0x75839b, 0x96a2b6].map((c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp() }));
  const cap = new THREE.MeshToonMaterial({ color: 0xf6f9fd, emissive: 0x6a7890, emissiveIntensity: 0.35, gradientMap: toonRamp() });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.15;
    const dist = 320 + r() * 320;
    const h = 60 + r() * 150;
    const rad = h * (0.45 + r() * 0.3);
    const sides = 5 + Math.floor(r() * 3);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(rad, h, sides, 1), rock[i % 3]);
    const base = CLOUD_Y - 10;
    peak.position.set(Math.cos(a) * dist, base + h / 2, Math.sin(a) * dist);
    peak.rotation.y = r() * 6;
    const capH = h * 0.35;
    const snowTop = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.36, capH, sides, 1), cap);
    snowTop.position.set(peak.position.x, base + h - capH / 2 + 0.3, peak.position.z);
    snowTop.rotation.y = peak.rotation.y;
    snowTop.scale.setScalar(1.02);
    g.add(peak, snowTop);
  }
  return g;
}

/** Puffy clouds drifting at the horizon and a few low ones over the cloud sea. */
function horizonClouds(r: () => number): THREE.Group {
  const g = new THREE.Group();
  const textures = [1, 2, 3].map((s) => cloudTexture(s * 131));
  const add = (dist: number, y: number, w: number) => {
    const a = r() * Math.PI * 2;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[Math.floor(r() * textures.length)], color: 0xe6efff, fog: false, depthWrite: false, transparent: true }));
    sp.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
    sp.scale.set(w, w * 0.5, 1);
    g.add(sp);
  };
  for (let i = 0; i < 18; i++) add(480 + r() * 250, 30 + r() * 110, 180 + r() * 200);
  for (let i = 0; i < 16; i++) add(200 + r() * 250, CLOUD_Y + 2 + r() * 6, 50 + r() * 50);
  return g;
}

/** Gentle snowfall over the play space: flakes drift down and sideways and wrap round. */
function fallingSnow() {
  const N = 1400;
  const X = 70;
  const Z = 50;
  const TOP = 40;
  const BOTTOM = -10;
  const pos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  const r = rng(91);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (r() * 2 - 1) * X;
    pos[i * 3 + 1] = BOTTOM + r() * (TOP - BOTTOM);
    pos[i * 3 + 2] = (r() * 2 - 1) * Z;
    seeds[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: softDot(), color: 0xffffff, size: 0.2, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false;
  let last = 0;
  return {
    points,
    update(time: number) {
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        pos[i * 3] += (0.8 + Math.sin(time * 0.5 + s) * 0.6) * dt;
        pos[i * 3 + 1] -= (1.1 + (s % 1) * 0.6) * dt;
        pos[i * 3 + 2] += Math.cos(time * 0.7 + s * 1.3) * 0.4 * dt;
        if (pos[i * 3] > X) pos[i * 3] -= 2 * X;
        if (pos[i * 3 + 1] < BOTTOM) pos[i * 3 + 1] = TOP;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
