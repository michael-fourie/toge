// The run's world, built from the Route: sky, ground, the road ribbon, each stop's building with its sign, and the
// scenery (instanced per kind, so a few hundred trees are a handful of draw calls). Pickups bob and spin.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signTexture, toon } from './models.ts';
import { ROAD, type Prop, type PropKind, type Route, type Stop } from './route.ts';
import { STOP_INFO } from './rules.ts';

export class World {
  readonly group = new THREE.Group();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private markers: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(readonly route: Route) {
    this.ground();
    this.road();
    for (const s of route.stops) this.stop(s);
    this.props();
    this.pickups();
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
    const moonLight = new THREE.DirectionalLight('#c4ccff', 1.5);
    moonLight.position.set(-60, 90, -40);
    scene.add(moonLight);
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
    return {
      update(camera: THREE.Camera, dt: number) {
        moon.position.set(camera.position.x - 260, 170, camera.position.z - 380);
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

  private ground() {
    const { min, max } = this.route;
    const w = max.x - min.x;
    const d = max.z - min.z;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#4f6a3e';
    g.fillRect(0, 0, 256, 256);
    // Cartoon grass by moonlight: soft blotches of lighter and darker green, a few dead patches.
    for (let i = 0; i < 260; i++) {
      g.fillStyle = i % 7 === 0 ? 'rgba(120,100,70,0.35)' : i % 3 ? 'rgba(110,150,90,0.3)' : 'rgba(40,70,40,0.4)';
      const r = 4 + ((i * 37) % 14);
      g.beginPath();
      g.arc((i * 97) % 256, (i * 61) % 256, r, 0, 7);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 24, d / 24);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), toon('#ffffff', { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((min.x + max.x) / 2, 0, (min.z + max.z) / 2);
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
      pos.push(p.x - r.x * ROAD.half, 0.03, p.z - r.z * ROAD.half, p.x + r.x * ROAD.half, 0.03, p.z + r.z * ROAD.half);
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
    this.group.add(new THREE.Mesh(geo, toon('#ffffff', { map: tex })));
    this.disposables.push(tex);
  }

  /** Each stop: a building in its own colours, a big sign, and a few props saying what it is. */
  private stop(s: Stop) {
    const g = new THREE.Group();
    g.position.set(s.bx, 0, s.bz);
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, s.d), toon(L.wall));
    body.position.y = h / 2;
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
    for (const x of [-2.4, 2.4]) {
      const pk = jackOLantern();
      pk.position.set(x, 0, -s.d / 2 - 1.2);
      g.add(pk);
    }
    this.dressStop(s, g, h);
    this.group.add(g);
    // The parking spot: a glowing ring on the road (shown for the stop you're heading to).
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 6.6, 40), new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.06, s.z);
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
      const tower = add(new THREE.BoxGeometry(8, 22, 8), '#d8cfb8', 0, 11, s.d / 2 + 30);
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
    /** One InstancedMesh per part of a kind: `place` sets the part's transform for prop p. */
    const parts = (list: Prop[], geo: THREE.BufferGeometry, color: string | ((p: Prop) => string), place: (p: Prop, o: THREE.Object3D) => void) => {
      const im = new THREE.InstancedMesh(geo, toon('#ffffff'), list.length);
      list.forEach((p, i) => {
        d.position.set(p.x, 0, p.z);
        d.rotation.set(0, p.h, 0);
        d.scale.setScalar(1);
        place(p, d);
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
    parts(houses, new THREE.BoxGeometry(9, 5, 7), (p) => pick(['#d8cfb8', '#b85c4a', '#e8dcc0', '#8fa6b5', '#c9a77a'], p.c), (_, o) => (o.position.y = 2.5));
    const roofGeo = new THREE.CylinderGeometry(0.01, 5.6, 3, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.1, 1, 0.85);
    parts(houses, roofGeo, (p) => pick(['#4a3a3a', '#3a4a5a', '#5a3a2a'], p.s), (_, o) => (o.position.y = 6.5));
    // Their windows on the road side: most dark, some still lit.
    const win = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#ffffff' }), houses.length * 2);
    houses.forEach((p, i) => {
      [-2.3, 2.3].forEach((lx, k) => {
        const lz = -3.52;
        d.position.set(p.x + lx * Math.cos(p.h) + lz * Math.sin(p.h), 2.8, p.z - lx * Math.sin(p.h) + lz * Math.cos(p.h));
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
      d.position.set(p.x, 1.55, p.z);
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
      d.position.set(p.x, 6, p.z);
      d.rotation.set(0, p.h, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      lampHead.setMatrixAt(i, d.matrix);
    });
    this.group.add(lampHead);
    // A pool of warm light under each lamp (painted on the ground, not a real light: cheap, and no recompiles).
    const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.16, depthWrite: false }), lamps.length);
    lamps.forEach((p, i) => {
      d.position.set(p.x, 0.05, p.z);
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
      const pk = jackOLantern();
      pk.position.set(p.x, 0, p.z);
      pk.rotation.y = p.h;
      pk.scale.setScalar(0.8 + p.s * 0.6);
      this.group.add(pk);
    }
    const hay = by.get('hay') ?? [];
    const hayGeo = new THREE.CylinderGeometry(1, 1, 1.4, 14);
    hayGeo.rotateZ(Math.PI / 2);
    parts(hay, hayGeo, '#e3c46a', (_, o) => (o.position.y = 1));
    const fences = by.get('fence') ?? [];
    parts(fences, new THREE.BoxGeometry(0.1, 0.12, 12), '#a07a50', (_, o) => (o.position.y = 0.9));
    parts(fences, new THREE.BoxGeometry(0.1, 0.12, 12), '#a07a50', (_, o) => (o.position.y = 0.45));
  }

  private pickups() {
    const cash = toon('#3fae4a');
    const cross = toon('#ffffff');
    const kit = toon('#e03a3a');
    for (const p of this.route.pickups) {
      const g = new THREE.Group();
      if (p.kind === 'cash') {
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
      g.position.set(p.x, 1.2, p.z);
      g.userData.base = p.id * 1.7;
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
      g.position.y = 1.2 + Math.sin(t * 3 + g.userData.base) * 0.15;
    }
    this.markers.forEach((m, i) => {
      m.visible = i === nextStop;
      if (m.visible) m.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    });
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    pumpkinFace?.dispose();
    pumpkinFace = null;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      const s = o as THREE.Sprite;
      if (s.isSprite) s.material.map?.dispose();
    });
  }
}

let pumpkinFace: THREE.CanvasTexture | null = null;

/** A jack-o'-lantern: an orange pumpkin with a glowing carved face (the face glows; no real light). */
function jackOLantern(): THREE.Group {
  if (!pumpkinFace) {
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
    pumpkinFace = new THREE.CanvasTexture(c);
    pumpkinFace.colorSpace = THREE.SRGBColorSpace;
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), toon('#e8761c', { emissive: '#a03a00', emissiveIntensity: 0.35 }));
  body.scale.set(1.15, 0.85, 1.1);
  body.position.y = 0.36;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.18, 5), toon('#3f6b2a'));
  stem.position.y = 0.76;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: pumpkinFace, transparent: true }));
  face.position.set(0, 0.38, -0.47);
  face.rotation.y = Math.PI;
  g.add(body, stem, face);
  return g;
}
