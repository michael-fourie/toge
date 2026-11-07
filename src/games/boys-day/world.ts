// The run's world, built from the Route: sky, the hilly ground (from `groundAt`, so it matches the bus's physics),
// the road ribbon on it, each stop's building with its sign, the hazards on the road, and the scenery (instanced per
// kind, so a few hundred trees are a handful of draw calls). Pickups bob and spin.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signTexture, toon } from './models.ts';
import { groundAt, ROAD, type Hazard, type Prop, type PropKind, type Route, type Stop } from './route.ts';
import { STOP_INFO } from './rules.ts';

/** The ground grid's spacing (m), how far the road ribbon sits above the ground, and how far buildings run on down
 *  into a slope. */
const GROUND_STEP = 5;
const ROAD_LIFT = 0.12;
const FOOTING = 6;

export class World {
  readonly group = new THREE.Group();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private markers: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  /** Every jack-o'-lantern's transform (the stops' and the scenery's), built as one instanced set at the end. */
  private pumpkins: THREE.Matrix4[] = [];
  private y = (x: number, z: number) => groundAt(this.route, x, z);

  constructor(readonly route: Route) {
    this.ground();
    this.road();
    for (const s of route.stops) this.stop(s);
    this.props();
    this.hazards();
    this.pickups();
    this.lanterns();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) this.disposables.push(m.geometry);
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) this.disposables.push(x);
    });
  }

  /**
   * The sky and lights: a moonlit apocalypse night, spooky but still cartoon. Returns the per-frame update (the moon
   * rides with the camera) and `flash`, the lightning.
   */
  static dress(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#07061a');
    grad.addColorStop(0.42, '#1d1440');
    grad.addColorStop(0.62, '#4b2f5e');
    grad.addColorStop(0.74, '#3a5440');
    grad.addColorStop(1, '#1a2418');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const sky = new THREE.CanvasTexture(c);
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
    scene.fog = new THREE.Fog('#241c3c', 45, 260);
    const hemi = new THREE.HemisphereLight('#8f8fd8', '#26301f', 1.15);
    scene.add(hemi);
    // The moonlight casts shadows in a box round the camera (it follows you down the road).
    const moonLight = new THREE.DirectionalLight('#c4ccff', 1.5);
    const MOON = { x: -60, y: 90, z: -40, box: 55 };
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    Object.assign(moonLight.shadow.camera, { left: -MOON.box, right: MOON.box, top: MOON.box, bottom: -MOON.box, near: 10, far: 260 });
    moonLight.shadow.bias = -0.0008;
    moonLight.shadow.normalBias = 0.04;
    scene.add(moonLight, moonLight.target);
    // The moon: a big glowing disc that stays in the same spot of sky wherever you drive.
    const mc = document.createElement('canvas');
    mc.width = mc.height = 256;
    const mg = mc.getContext('2d')!;
    const halo = mg.createRadialGradient(128, 128, 40, 128, 128, 128);
    halo.addColorStop(0, 'rgba(230,235,255,0.55)');
    halo.addColorStop(1, 'rgba(230,235,255,0)');
    mg.fillStyle = halo;
    mg.fillRect(0, 0, 256, 256);
    mg.fillStyle = '#eef0ff';
    mg.beginPath();
    mg.arc(128, 128, 52, 0, 7);
    mg.fill();
    mg.fillStyle = 'rgba(160,165,200,0.45)';
    for (const [x, y, r] of [[110, 112, 12], [146, 140, 9], [132, 100, 6], [120, 150, 7]]) {
      mg.beginPath();
      mg.arc(x, y, r, 0, 7);
      mg.fill();
    }
    const moonTex = new THREE.CanvasTexture(mc);
    moonTex.colorSpace = THREE.SRGBColorSpace;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false }));
    moon.scale.setScalar(120);
    scene.add(moon);
    let flashT = 0;
    const at = new THREE.Vector3();
    return {
      update(camera: THREE.Camera, dt: number) {
        moon.position.set(camera.position.x - 260, 170, camera.position.z - 380);
        const c = camera.getWorldPosition(at);
        moonLight.target.position.copy(c);
        moonLight.position.set(c.x + MOON.x, c.y + MOON.y, c.z + MOON.z);
        // Lightning: a double flicker that fades.
        if (flashT > 0) flashT = Math.max(0, flashT - dt);
        const k = flashT > 0.32 ? 1 : flashT > 0.22 ? 0.2 : flashT > 0.12 ? 0.8 : flashT / 0.12;
        hemi.intensity = 1.15 + k * 3.5;
      },
      flash() {
        flashT = 0.45;
      },
      dispose() {
        sky.dispose();
        moonTex.dispose();
        moon.material.dispose();
      },
    };
  }

  /** The ground: a grid over the map, each vertex lifted to `groundAt` and tinted by height (dark hollows, pale
   *  hilltops, worn dirt by the road). */
  private ground() {
    const { min, max } = this.route;
    const w = max.x - min.x;
    const d = max.z - min.z;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    // Cartoon grass blotches (the vertex colour gives the green; this just breaks it up).
    for (let i = 0; i < 260; i++) {
      g.fillStyle = i % 7 === 0 ? 'rgba(150,120,80,0.35)' : i % 3 ? 'rgba(255,255,230,0.18)' : 'rgba(0,30,0,0.22)';
      const r = 4 + ((i * 37) % 14);
      g.beginPath();
      g.arc((i * 97) % 256, (i * 61) % 256, r, 0, 7);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 24, d / 24);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / GROUND_STEP), Math.ceil(d / GROUND_STEP));
    geo.rotateX(-Math.PI / 2);
    geo.translate((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color('#2c4a2c');
    const high = new THREE.Color('#7d9a55');
    const dirt = new THREE.Color('#6b5a40');
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.y(x, z);
      pos.setY(i, y);
      col.copy(low).lerp(high, Math.max(0, Math.min(1, (y + 18) / 40)));
      colors.set([col.r, col.g, col.b], i * 3);
    }
    // Worn dirt shoulders: tint the vertices close to the road.
    const nx = Math.ceil(w / GROUND_STEP) + 1;
    const cw = w / (nx - 1);
    const cd = d / Math.ceil(d / GROUND_STEP);
    for (const p of this.route.road) {
      const i0 = Math.round((p.x - min.x) / cw);
      const j0 = Math.round((p.z - min.z) / cd);
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          if (i0 + di < 0 || i0 + di >= nx) continue;
          const k = (j0 + dj) * nx + (i0 + di);
          if (k < 0 || k >= pos.count) continue;
          const dist = Math.hypot(pos.getX(k) - p.x, pos.getZ(k) - p.z);
          if (dist > 11) continue;
          const t = 0.7 * (1 - dist / 11);
          col.setRGB(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]).lerp(dirt, t);
          colors.set([col.r, col.g, col.b], k * 3);
        }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon('#ffffff', { map: tex, vertexColors: true }));
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(tex);
  }

  private road() {
    const pts = this.route.road;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const r = { x: Math.cos(p.h), z: -Math.sin(p.h) };
      pos.push(p.x - r.x * ROAD.half, p.y + ROAD_LIFT, p.z - r.z * ROAD.half, p.x + r.x * ROAD.half, p.y + ROAD_LIFT, p.z + r.z * ROAD.half);
      uv.push(0, p.s / 12, 1, p.s / 12);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3a3a46';
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect((i * 53) % 128, (i * 89) % 256, 6, 4);
    }
    g.fillStyle = '#f2f2e8';
    g.fillRect(6, 0, 4, 256);
    g.fillRect(118, 0, 4, 256);
    g.fillStyle = '#ffcc33';
    g.fillRect(61, 0, 6, 150);
    // A crack or two.
    g.strokeStyle = 'rgba(20,20,25,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(30, 40);
    g.lineTo(44, 70);
    g.lineTo(38, 100);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const road = new THREE.Mesh(geo, toon('#ffffff', { map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    road.receiveShadow = true;
    this.group.add(road);
    this.disposables.push(tex);
  }

  /** Each stop: a building in its own colours, a big sign, and a few props saying what it is. */
  private stop(s: Stop) {
    const g = new THREE.Group();
    g.position.set(s.bx, s.y, s.bz);
    g.rotation.y = s.bh;
    const look: Record<Stop['kind'], { wall: string; roof: string; sign: [string, string] }> = {
      arena: { wall: '#3d5a3d', roof: '#26372a', sign: ['#111', '#7cff5b'] },
      golf: { wall: '#e8e0c8', roof: '#2e7d4a', sign: ['#1d5c33', '#ffffff'] },
      casino: { wall: '#6b1d4f', roof: '#2a0c22', sign: ['#1a0610', '#ffd23f'] },
      jail: { wall: '#9a9ca3', roof: '#55575e', sign: ['#1c2a4a', '#ffffff'] },
      home: { wall: '#c9b79a', roof: '#4a3a3a', sign: ['#3a2a1a', '#ffe6a0'] },
    };
    const L = look[s.kind];
    const h = s.kind === 'casino' ? 9 : s.kind === 'home' ? 7 : 6;
    // The walls run on down into the hillside (the ground round a stop isn't quite flat).
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, h + FOOTING, s.d), toon(L.wall));
    body.position.y = (h - FOOTING) / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.6, 0.5, s.d + 0.6), toon(L.roof));
    roof.position.y = h + 0.25;
    g.add(roof);
    // The front faces the road (the group's -Z).
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.8, 2.2), new THREE.MeshBasicMaterial({ map: signTexture(STOP_INFO[s.kind].sign, L.sign[0], L.sign[1]) }));
    sign.position.set(0, h + 1.8, -s.d / 2);
    sign.rotation.y = Math.PI;
    g.add(sign);
    const post = toon('#555');
    for (const x of [-s.w * 0.35, s.w * 0.35]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 0.25), post);
      p.position.set(x, h + 0.7, -s.d / 2 + 0.2);
      g.add(p);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 0.2), toon('#2b2118'));
    door.position.set(0, 1.6, -s.d / 2 - 0.05);
    g.add(door);
    // Lit windows (somebody left the lights on before it all went wrong), and a jack-o'-lantern each side of the door.
    const lit = toon('#ffcf6a', { emissive: '#ffb340', emissiveIntensity: 0.9 });
    for (const x of [-s.w * 0.32, -s.w * 0.16, s.w * 0.16, s.w * 0.32]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), lit);
      w.position.set(x, h * 0.55, -s.d / 2 - 0.04);
      w.rotation.y = Math.PI;
      g.add(w);
    }
    g.updateMatrix();
    for (const x of [-2.4, 2.4]) this.pumpkins.push(new THREE.Matrix4().makeTranslation(x, 0, -s.d / 2 - 1.2).premultiply(g.matrix));
    this.dressStop(s, g, h);
    this.group.add(g);
    // The parking spot: a glowing ring on the road (shown for the stop you're heading to).
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 6.6, 40), new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, s.y + ROAD_LIFT + 0.05, s.z);
    ring.visible = false;
    this.markers.push(ring);
    this.group.add(ring);
  }

  private dressStop(s: Stop, g: THREE.Group, h: number) {
    const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, extra: THREE.MeshToonMaterialParameters = {}) => {
      const m = new THREE.Mesh(geo, toon(color, extra));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (s.kind === 'arena') {
      // Inflatable bunkers out front, and paint everywhere.
      const colors = ['#ff3d7f', '#2fd3ff', '#ffd23f', '#7cff5b'];
      for (let k = 0; k < 6; k++)
        add(new THREE.CylinderGeometry(0.9, 0.9, 2, 12), colors[k % 4], -8 + k * 3.2, 1, -s.d / 2 - 6 - (k % 2) * 3);
      for (let k = 0; k < 14; k++)
        add(new THREE.CircleGeometry(0.6 + (k % 3) * 0.3, 10), colors[k % 4], -s.w / 2 + 1 + ((k * 3.7) % (s.w - 2)), 1 + ((k * 1.3) % (h - 2)), -s.d / 2 - 0.02).rotation.y = Math.PI;
    } else if (s.kind === 'golf') {
      // Tall net poles, a putting green and a flag.
      for (const x of [-s.w / 2, s.w / 2]) add(new THREE.CylinderGeometry(0.15, 0.15, 14, 6), '#ddd', x, 7, s.d / 2 + 4);
      const net = add(new THREE.PlaneGeometry(s.w, 12), '#ffffff', 0, 7, s.d / 2 + 4, { transparent: true, opacity: 0.25, side: THREE.DoubleSide });
      net.rotation.y = 0;
      const green = add(new THREE.CircleGeometry(5, 24), '#4fd16a', 10, 0.05, -s.d / 2 - 7);
      green.rotation.x = -Math.PI / 2;
      add(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), '#eee', 10, 1.2, -s.d / 2 - 7);
      const flag = add(new THREE.PlaneGeometry(0.9, 0.55), '#ff3030', 10.45, 2.1, -s.d / 2 - 7, { side: THREE.DoubleSide });
      flag.rotation.y = Math.PI / 2;
    } else if (s.kind === 'casino') {
      // Marquee bulbs round the sign, and a giant die on the roof.
      for (let k = 0; k < 24; k++)
        add(new THREE.SphereGeometry(0.16, 8, 6), k % 2 ? '#fff5b0' : '#ff9df0', -s.w * 0.42 + (k * s.w * 0.84) / 23, h + 3.1, -s.d / 2 - 0.1, { emissive: k % 2 ? '#fff0a0' : '#ff60e0', emissiveIntensity: 1 });
      const die = add(new THREE.BoxGeometry(3, 3, 3), '#ffffff', s.w * 0.3, h + 2, 0);
      die.rotation.set(0.5, 0.6, 0.2);
      for (const [x, y, z] of [[0, 0, -1.52], [1.52, 0.6, 0], [0.5, 1.52, 0.5]]) add(new THREE.SphereGeometry(0.28, 8, 6), '#111', s.w * 0.3 + x, h + 2 + y, z);
    } else if (s.kind === 'jail') {
      // Barred windows and a cop car on its roof.
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        for (let b = 0; b < 4; b++) add(new THREE.BoxGeometry(0.07, 1.5, 0.07), '#222', k * 3 - 0.45 + b * 0.3, 3.5, -s.d / 2 - 0.1);
      }
      const car = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.4), toon('#f4f4f4'));
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), toon('#111a3a'));
      c2.position.y = -0.65;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.3), toon('#ff2020', { emissive: '#ff0000', emissiveIntensity: 0.6 }));
      bar.position.y = -1.05;
      car.add(c1, c2, bar);
      car.position.set(-9, 1.15, -s.d / 2 - 6);
      car.rotation.set(0, 0.6, Math.PI);
      g.add(car);
    } else {
      // The boys' house: a porch, a couch on the lawn, a flag, and a limestone Queen's tower behind.
      add(new THREE.BoxGeometry(s.w, 0.4, 4), '#8a7a6a', 0, 0.2, -s.d / 2 - 2);
      for (const x of [-s.w / 2 + 0.5, s.w / 2 - 0.5]) add(new THREE.BoxGeometry(0.4, 3.2, 0.4), '#f2f2f2', x, 1.8, -s.d / 2 - 3.8);
      add(new THREE.BoxGeometry(s.w + 0.6, 0.3, 4.4), '#4a3a3a', 0, 3.5, -s.d / 2 - 2);
      add(new THREE.BoxGeometry(2.4, 0.6, 1), '#7a2a2a', -4, 0.3, -s.d / 2 - 8);
      add(new THREE.BoxGeometry(2.4, 0.9, 0.3), '#7a2a2a', -4, 0.75, -s.d / 2 - 7.6);
      const flag = add(new THREE.PlaneGeometry(2.6, 1.6), '#b40a2a', s.w / 2 - 1.5, h - 1, -s.d / 2 - 0.1, { side: THREE.DoubleSide });
      flag.rotation.y = Math.PI;
      const tower = add(new THREE.BoxGeometry(8, 22 + FOOTING * 2, 8), '#d8cfb8', 0, 11 - FOOTING, s.d / 2 + 30);
      tower.name = 'queens';
      add(new THREE.ConeGeometry(6, 6, 4), '#3f6b5a', 0, 25, s.d / 2 + 30).rotation.y = Math.PI / 4;
      // A big bong on the porch. It's the whole point.
      add(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 12), '#58d0ff', 3, 1.2, -s.d / 2 - 2, { transparent: true, opacity: 0.8 });
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), '#58d0ff', 3.45, 1.0, -s.d / 2 - 2).rotation.z = -0.7;
    }
  }

  private props() {
    const by = new Map<PropKind, Prop[]>();
    for (const p of this.route.props) {
      const list = by.get(p.kind) ?? [];
      list.push(p);
      by.set(p.kind, list);
    }
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    // Each prop stands on the ground (a little sunk in, so nothing floats on a slope).
    const base = new Map<Prop, number>();
    for (const p of this.route.props) base.set(p, this.y(p.x, p.z) - 0.15);
    const at = (p: Prop) => base.get(p)!;
    /** One InstancedMesh per part of a kind: `place` sets the part's transform for prop p (y up from its ground). */
    const parts = (list: Prop[], geo: THREE.BufferGeometry, color: string | ((p: Prop) => string), place: (p: Prop, o: THREE.Object3D) => void, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, toon('#ffffff'), list.length);
      im.castShadow = shadow;
      list.forEach((p, i) => {
        d.position.set(p.x, 0, p.z);
        d.rotation.set(0, p.h, 0);
        d.scale.setScalar(1);
        place(p, d);
        d.position.y += at(p);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, col.set(typeof color === 'string' ? color : color(p)));
      });
      this.group.add(im);
    };
    const pick = <T>(a: readonly T[], k: number) => a[Math.floor(k * a.length) % a.length];
    const trees = by.get('tree') ?? [];
    parts(trees, new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), '#7a5233', (p, o) => {
      o.position.y = 1.2;
      o.scale.setScalar(0.8 + p.s * 0.6);
    });
    parts(trees, new THREE.IcosahedronGeometry(2, 1), (p) => pick(['#5f9e3a', '#79b345', '#e0a13a', '#c7562d'], p.c), (p, o) => {
      // Maples in autumn: it's Ontario.
      o.position.y = 3.2 + p.s * 1.2;
      o.scale.setScalar(0.9 + p.s * 0.7);
    });
    const pines = by.get('pine') ?? [];
    parts(pines, new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6), '#6a4a2e', (_, o) => (o.position.y = 0.8));
    parts(pines, new THREE.ConeGeometry(1.7, 5, 7), (p) => pick(['#2f6b3f', '#3a7d4a', '#2a5e3a'], p.c), (p, o) => {
      o.position.y = 3.6 + p.s;
      o.scale.setScalar(0.9 + p.s * 0.5);
    });
    const houses = by.get('house') ?? [];
    parts(houses, new THREE.BoxGeometry(9, 5 + FOOTING, 7), (p) => pick(['#d8cfb8', '#b85c4a', '#e8dcc0', '#8fa6b5', '#c9a77a'], p.c), (_, o) => (o.position.y = (5 - FOOTING) / 2));
    const roofGeo = new THREE.CylinderGeometry(0.01, 5.6, 3, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.1, 1, 0.85);
    parts(houses, roofGeo, (p) => pick(['#4a3a3a', '#3a4a5a', '#5a3a2a'], p.s), (_, o) => (o.position.y = 6.5));
    // Their windows on the road side: most dark, some still lit.
    const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }), houses.length * 2);
    houses.forEach((p, i) => {
      [-2.3, 2.3].forEach((lx, k) => {
        const lz = -3.52;
        d.position.set(p.x + lx * Math.cos(p.h) + lz * Math.sin(p.h), at(p) + 2.8, p.z - lx * Math.sin(p.h) + lz * Math.cos(p.h));
        d.rotation.set(0, p.h + Math.PI, 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        win.setMatrixAt(i * 2 + k, d.matrix);
        win.setColorAt(i * 2 + k, col.set((p.c * 7 + k) % 1 < 0.4 ? '#ffcf6a' : '#1c2030'));
      });
    });
    this.group.add(win);
    const wrecks = by.get('wreck') ?? [];
    parts(wrecks, new THREE.BoxGeometry(2, 0.9, 4.4), (p) => pick(['#c0392b', '#2e86de', '#8e8e8e', '#27ae60', '#f1c40f', '#ecf0f1'], p.c), (p, o) => {
      o.position.y = 0.65;
      o.rotation.z = (p.s - 0.5) * 0.3;
    });
    parts(wrecks, new THREE.BoxGeometry(1.8, 0.7, 2.2), '#2b2f3a', (p, o) => {
      o.position.y = 1.4;
      o.rotation.z = (p.s - 0.5) * 0.3;
    });
    const barrels = by.get('barrel') ?? [];
    parts(barrels, new THREE.CylinderGeometry(0.4, 0.4, 1.1, 10), '#4a5a6a', (_, o) => (o.position.y = 0.55));
    const flame = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 1, 7), toon('#ff8a2a', { emissive: '#ff6a00', emissiveIntensity: 1.2 }), barrels.length);
    barrels.forEach((p, i) => {
      d.position.set(p.x, at(p) + 1.55, p.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      flame.setMatrixAt(i, d.matrix);
    });
    flame.name = 'flames';
    this.group.add(flame);
    const lamps = by.get('lamp') ?? [];
    parts(lamps, new THREE.CylinderGeometry(0.08, 0.1, 6, 6), '#3a3d44', (_, o) => (o.position.y = 3));
    const lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.2, 1.4), new THREE.MeshBasicMaterial({ color: '#ffe9a0' }), lamps.length);
    lamps.forEach((p, i) => {
      d.position.set(p.x, at(p) + 6, p.z);
      d.rotation.set(0, p.h, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      lampHead.setMatrixAt(i, d.matrix);
    });
    this.group.add(lampHead);
    // A pool of warm light under each lamp (painted on the ground, not a real light: cheap, and no recompiles).
    const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.16, depthWrite: false }), lamps.length);
    lamps.forEach((p, i) => {
      d.position.set(p.x, at(p) + 0.25, p.z);
      d.rotation.set(-Math.PI / 2, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      pool.setMatrixAt(i, d.matrix);
    });
    this.group.add(pool);
    // Dead trees: a bare trunk with crooked branches.
    const dead = by.get('dead') ?? [];
    const branch = (len: number, rx: number, rz: number, y: number) => {
      const c = new THREE.CylinderGeometry(0.06, 0.12, len, 5);
      c.translate(0, len / 2, 0);
      c.rotateX(rx);
      c.rotateZ(rz);
      c.translate(0, y, 0);
      return c;
    };
    const deadGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.16, 0.32, 4.4, 6).translate(0, 2.2, 0),
      branch(1.8, 0.2, 0.9, 2.6),
      branch(1.5, -0.3, -1.0, 3.1),
      branch(1.2, 0.9, 0.2, 3.6),
      branch(1.0, -0.8, 0.5, 3.9),
    ]);
    parts(dead, deadGeo, (p) => pick(['#3b3030', '#2e2a2a', '#45383a'], p.c), (p, o) => o.scale.setScalar(0.9 + p.s * 0.6));
    // Headstones: a slab with a rounded top, a little crooked.
    const graves = by.get('grave') ?? [];
    const stone = mergeGeometries([new THREE.BoxGeometry(0.8, 0.9, 0.22).translate(0, 0.45, 0), new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.9, 0)]);
    parts(graves, stone, (p) => pick(['#8a8a96', '#757582', '#9a9aa6'], p.c), (p, o) => (o.rotation.z = (p.s - 0.5) * 0.25));
    // Jack-o'-lanterns.
    for (const p of by.get('pumpkin') ?? []) {
      d.position.set(p.x, at(p) + 0.1, p.z);
      d.rotation.set(0, p.h, 0);
      d.scale.setScalar(0.8 + p.s * 0.6);
      d.updateMatrix();
      this.pumpkins.push(d.matrix.clone());
    }
    const hay = by.get('hay') ?? [];
    const hayGeo = new THREE.CylinderGeometry(1, 1, 1.4, 14);
    hayGeo.rotateZ(Math.PI / 2);
    parts(hay, hayGeo, '#e3c46a', (_, o) => (o.position.y = 1));
    const fences = by.get('fence') ?? [];
    parts(fences, new THREE.BoxGeometry(0.1, 0.12, 12), '#a07a50', (_, o) => (o.position.y = 0.9));
    parts(fences, new THREE.BoxGeometry(0.1, 0.12, 12), '#a07a50', (_, o) => (o.position.y = 0.45));
  }

  /** The mess on the road: fallen trees and boulders (solid: steer round), potholes (a jolt) and mud (slow, slippery). */
  private hazards() {
    const bark = toon('#5a3c26');
    const ringsMat = toon('#c9a26a');
    const rock = toon('#7a7a86');
    const hole = new THREE.MeshBasicMaterial({ color: '#141418', polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const rim = toon('#55555e', { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const mud = toon('#4a3522', { transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const wet = new THREE.MeshBasicMaterial({ color: '#8a7a9a', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    /** A decal on the road: a disc squashed to (sx, sz), turned to the hazard's heading, each vertex draped on the
     *  ground (the road can be on a slope). */
    const flat = (r: number, segs: number, mat: THREE.Material, h: Hazard, lift: number, sx = 1, sz = 1, dx = 0, dz = 0) => {
      const geo = new THREE.CircleGeometry(r, segs).rotateX(-Math.PI / 2).scale(sx, 1, sz).rotateY(h.h).translate(h.x + dx, 0, h.z + dz);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, this.y(pos.getX(i), pos.getZ(i)) + ROAD_LIFT + lift);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      this.group.add(m);
    };
    for (const h of this.route.hazards) {
      const y = this.y(h.x, h.z) + ROAD_LIFT;
      if (h.kind === 'log') {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h.r, 9).rotateX(Math.PI / 2), bark);
        trunk.castShadow = true;
        const end = new THREE.Mesh(new THREE.CircleGeometry(0.42, 9), ringsMat);
        end.position.z = h.r / 2 + 0.01;
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.3, 5), bark);
        stub.position.set(0.2, 0.7, -h.r * 0.2);
        stub.rotation.z = -0.5;
        const stub2 = stub.clone();
        stub2.position.set(-0.25, 0.6, h.r * 0.25);
        stub2.rotation.z = 0.6;
        g.add(trunk, end, stub, stub2);
        g.position.set(h.x, y + 0.4, h.z);
        g.rotation.y = h.h;
        this.group.add(g);
      } else if (h.kind === 'rocks') {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rock);
          b.scale.set(1 + (k % 2) * 0.2, 0.75, 0.95);
          b.rotation.set(k, a, k * 0.5);
          b.position.set(h.x + Math.cos(a) * 1.1, y + 0.45, h.z + Math.sin(a) * 1.1);
          b.castShadow = b.receiveShadow = true;
          this.group.add(b);
        }
      } else if (h.kind === 'pothole') {
        flat(h.r + 0.25, 12, rim, h, 0.02, 1, 0.8);
        flat(h.r, 12, hole, h, 0.04, 1, 0.8);
      } else {
        // Mud: a long brown wallow across the road, with a sheen of puddles.
        flat(h.r, 22, mud, h, 0.02, 0.75, 1.15);
        for (let k = 0; k < 3; k++) flat(h.r * 0.22, 12, wet, h, 0.05, 1, 1, Math.cos(k * 2.1 + h.h) * h.r * 0.35, Math.sin(k * 2.1 + h.h) * h.r * 0.35);
      }
    }
  }

  /** Every jack-o'-lantern at once: three instanced parts (body, stem, glowing face). */
  private lanterns() {
    const n = this.pumpkins.length;
    if (!n) return;
    const body = new THREE.SphereGeometry(0.42, 12, 8).scale(1.15, 0.85, 1.1).translate(0, 0.36, 0);
    const stem = new THREE.CylinderGeometry(0.05, 0.07, 0.18, 5).translate(0, 0.76, 0);
    const face = new THREE.PlaneGeometry(0.62, 0.62).rotateY(Math.PI).translate(0, 0.38, -0.47);
    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [body, toon('#e8761c', { emissive: '#a03a00', emissiveIntensity: 0.35 })],
      [stem, toon('#3f6b2a')],
      [face, new THREE.MeshBasicMaterial({ map: pumpkinFace(), transparent: true, color: new THREE.Color(1.6, 1.4, 1.1) })],
    ];
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      this.pumpkins.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = mat !== parts[2][1];
      this.group.add(im);
    }
  }

  private pickups() {
    const cash = toon('#3fae4a');
    const cross = toon('#ffffff');
    const kit = toon('#e03a3a');
    const can = toon('#d8261c', { emissive: '#601000', emissiveIntensity: 0.4 });
    const metal = toon('#c9c9c9');
    for (const p of this.route.pickups) {
      const g = new THREE.Group();
      if (p.kind === 'gas') {
        // A jerry can: a red block with a handle and a spout, and a ⛽ tag.
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), can));
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 6, 12, Math.PI), metal);
        handle.position.set(-0.08, 0.39, 0);
        g.add(handle);
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8), metal);
        spout.position.set(0.22, 0.5, 0);
        spout.rotation.z = -0.6;
        g.add(spout);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('GAS', 'rgba(0,0,0,0)', '#fff6a0', 128, 64, 'bold 44px system-ui, sans-serif') }));
        label.scale.set(0.9, 0.45, 1);
        label.position.set(0, 0.75, 0);
        g.add(label);
      } else if (p.kind === 'cash') {
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), cash);
        bag.scale.set(1, 1.1, 1);
        g.add(bag);
        const tie = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 8), cash);
        tie.position.y = 0.55;
        g.add(tie);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('$', 'rgba(0,0,0,0)', '#fff6a0', 64, 64, 'bold 56px system-ui, sans-serif') }));
        label.scale.setScalar(0.6);
        label.position.set(0, 0.05, 0);
        g.add(label);
      } else {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.5), kit));
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.52), cross);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.52), cross);
        g.add(a, b);
      }
      const y = this.y(p.x, p.z) + ROAD_LIFT + 1.2;
      g.position.set(p.x, y, p.z);
      g.userData.base = p.id * 1.7;
      g.userData.y = y;
      this.pickupMeshes.set(p.id, g);
      this.group.add(g);
    }
  }

  /** Per frame: pickups bob and spin (and vanish once taken); the flames flicker; the next stop's ring pulses. */
  update(t: number, taken: ReadonlySet<number>, nextStop: number) {
    for (const [id, g] of this.pickupMeshes) {
      g.visible = !taken.has(id);
      if (!g.visible) continue;
      g.rotation.y = t * 2 + g.userData.base;
      g.position.y = g.userData.y + Math.sin(t * 3 + g.userData.base) * 0.15;
    }
    this.markers.forEach((m, i) => {
      m.visible = i === nextStop;
      if (m.visible) m.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    });
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    faceTex?.dispose();
    faceTex = null;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      const s = o as THREE.Sprite;
      if (s.isSprite) s.material.map?.dispose();
    });
  }
}

let faceTex: THREE.CanvasTexture | null = null;

/** A jack-o'-lantern's carved face (painted once, shared). */
function pumpkinFace() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd24a';
  g.beginPath();
  g.moveTo(14, 26);
  g.lineTo(24, 14);
  g.lineTo(28, 28);
  g.moveTo(50, 26);
  g.lineTo(40, 14);
  g.lineTo(36, 28);
  g.fill();
  g.beginPath();
  g.moveTo(12, 38);
  for (let k = 0; k <= 6; k++) g.lineTo(12 + k * 6.7, k % 2 ? 46 : 38);
  g.lineTo(52, 50);
  g.quadraticCurveTo(32, 60, 12, 50);
  g.fill();
  faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  return faceTex;
}
