// One leg's world, built from its Route in its biome's colours (sky.ts `Look`): the hilly ground (from `groundAt`, so
// it matches the bus's physics), the road ribbon on it, the checkpoint (its building and sign, the arena's edge, the
// job's things: crates, the pump, the beacon, the tee box, the slot machine), the gate to the next leg, the hazards on
// the road, and the scenery (instanced per kind, so a few hundred trees are a handful of draw calls).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signTexture, toon } from './models.ts';
import { BIOMES, checkpointOf } from './checkpoints.ts';
import { groundAt, ROAD, type Hazard, type Prop, type PropKind, type Route } from './route.ts';
import { FOOT, type Job } from './rules.ts';
import { lookFor, type Look } from './sky.ts';

/** The ground grid's spacing (m), how far the road ribbon sits above the ground, and how far buildings run on down
 *  into a slope. */
const GROUND_STEP = 5;
const ROAD_LIFT = 0.12;
const FOOTING = 6;

export class World {
  readonly group = new THREE.Group();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private siteMeshes = new Map<number, THREE.Object3D>();
  private ring!: THREE.Mesh;
  private beacon: { ring: THREE.Mesh; lamp: THREE.Mesh } | null = null;
  private portal!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private bars!: THREE.Group;
  readonly look: Look;
  private disposables: { dispose(): void }[] = [];
  /** Every jack-o'-lantern's transform (the stops' and the scenery's), built as one instanced set at the end. */
  private pumpkins: THREE.Matrix4[] = [];
  private y = (x: number, z: number) => groundAt(this.route, x, z);

  constructor(readonly route: Route) {
    this.look = lookFor(route.cp.biome, route.cp.twist);
    this.ground();
    this.road();
    this.stop();
    this.sites();
    this.gate();
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
    const low = new THREE.Color(this.look.ground[0]);
    const high = new THREE.Color(this.look.ground[1]);
    const dirt = new THREE.Color(this.look.ground[2]);
    const col = new THREE.Color();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = this.y(pos.getX(i), pos.getZ(i));
      pos.setY(i, y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    for (let i = 0; i < pos.count; i++) {
      col.copy(low).lerp(high, (pos.getY(i) - lo) / Math.max(8, hi - lo));
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

  /** The checkpoint: a building in its job's colours with the place's name up in lights, and the arena's edge. */
  private stop() {
    const s = this.route.stop;
    const cp = this.route.cp;
    const g = new THREE.Group();
    g.position.set(s.bx, s.y, s.bz);
    g.rotation.y = s.bh;
    const look: Record<Job, { wall: string; roof: string; sign: [string, string]; h: number }> = {
      golf: { wall: '#e8e0c8', roof: '#2e7d4a', sign: ['#1d5c33', '#ffffff'], h: 6 },
      slots: { wall: '#6b1d4f', roof: '#2a0c22', sign: ['#1a0610', '#ffd23f'], h: 9 },
      holdout: { wall: '#9a9ca3', roof: '#55575e', sign: ['#1c2a4a', '#ffffff'], h: 6 },
      scavenge: { wall: '#b8643a', roof: '#4a2a1a', sign: ['#2a1608', '#ffe14a'], h: 7 },
      fuel: { wall: '#e8e8ee', roof: '#c8261c', sign: ['#8a1410', '#ffffff'], h: 5 },
      beacon: { wall: '#4a5a6a', roof: '#26303a', sign: ['#101820', '#7cf7ff'], h: 6 },
    };
    const L = look[cp.job];
    const h = L.h;
    // The walls run on down into the hillside (the ground round a stop isn't quite flat).
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, h + FOOTING, s.d), toon(L.wall));
    body.position.y = (h - FOOTING) / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.6, 0.5, s.d + 0.6), toon(L.roof));
    roof.position.y = h + 0.25;
    g.add(roof);
    // The front faces the road (the group's -Z). The sign's brighter than white, so it glows.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.92, 2.4), new THREE.MeshBasicMaterial({ map: signTexture(cp.name.toUpperCase(), L.sign[0], L.sign[1], 1024, 128, 'bold 60px system-ui, sans-serif'), color: new THREE.Color(1.5, 1.5, 1.5) }));
    sign.position.set(0, h + 1.9, -s.d / 2);
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
    const lit = toon('#ffcf6a', { emissive: '#ffb340', emissiveIntensity: 1.3 });
    for (const x of [-s.w * 0.36, -s.w * 0.2, s.w * 0.2, s.w * 0.36]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), lit);
      w.position.set(x, h * 0.55, -s.d / 2 - 0.04);
      w.rotation.y = Math.PI;
      g.add(w);
    }
    g.updateMatrix();
    for (const x of [-2.4, 2.4]) this.pumpkins.push(new THREE.Matrix4().makeTranslation(x, 0, -s.d / 2 - 1.2).premultiply(g.matrix));
    this.dressStop(g, h);
    this.group.add(g);
    // The parking spot: a glowing ring on the road.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 6.6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.7, 0.5), transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(s.x, s.y + ROAD_LIFT + 0.05, s.z);
    this.group.add(this.ring);
    // The arena's edge: a ring of glowing stakes as far out as you can wander.
    const n = 44;
    const stakes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.9, 0.3) }), n);
    const d = new THREE.Object3D();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = s.x + Math.cos(a) * (FOOT.leash + 0.6);
      const z = s.z + Math.sin(a) * (FOOT.leash + 0.6);
      d.position.set(x, this.y(x, z) + 0.75, z);
      d.updateMatrix();
      stakes.setMatrixAt(k, d.matrix);
    }
    this.group.add(stakes);
  }

  private dressStop(g: THREE.Group, h: number) {
    const s = this.route.stop;
    const job = this.route.cp.job;
    const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, extra: THREE.MeshToonMaterialParameters = {}) => {
      const m = new THREE.Mesh(geo, toon(color, extra));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (job === 'golf') {
      // Tall net poles, a putting green and a flag.
      for (const x of [-s.w / 2, s.w / 2]) add(new THREE.CylinderGeometry(0.15, 0.15, 14, 6), '#ddd', x, 7, s.d / 2 + 4);
      add(new THREE.PlaneGeometry(s.w, 12), '#ffffff', 0, 7, s.d / 2 + 4, { transparent: true, opacity: 0.25, side: THREE.DoubleSide });
      const green = add(new THREE.CircleGeometry(4, 24), '#4fd16a', 8, 0.08, -s.d / 2 - 9);
      green.rotation.x = -Math.PI / 2;
      add(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), '#eee', 8, 1.2, -s.d / 2 - 9);
      add(new THREE.PlaneGeometry(0.9, 0.55), '#ff3030', 8.45, 2.1, -s.d / 2 - 9, { side: THREE.DoubleSide }).rotation.y = Math.PI / 2;
    } else if (job === 'slots') {
      // Marquee bulbs round the sign, and a giant die on the roof.
      for (let k = 0; k < 24; k++)
        add(new THREE.SphereGeometry(0.16, 8, 6), k % 2 ? '#fff5b0' : '#ff9df0', -s.w * 0.44 + (k * s.w * 0.88) / 23, h + 3.3, -s.d / 2 - 0.1, { emissive: k % 2 ? '#fff0a0' : '#ff60e0', emissiveIntensity: 1.6 });
      const die = add(new THREE.BoxGeometry(3, 3, 3), '#ffffff', s.w * 0.3, h + 2, 2);
      die.rotation.set(0.5, 0.6, 0.2);
    } else if (job === 'holdout') {
      // Barred windows and a cop car on its roof.
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        for (let b = 0; b < 4; b++) add(new THREE.BoxGeometry(0.07, 1.5, 0.07), '#222', k * 3.4 - 0.45 + b * 0.3, h * 0.55, -s.d / 2 - 0.1);
      }
      const car = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.4), toon('#f4f4f4'));
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), toon('#111a3a'));
      c2.position.y = -0.65;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.3), toon('#ff2020', { emissive: '#ff0000', emissiveIntensity: 1.5 }));
      bar.position.y = -1.05;
      car.add(c1, c2, bar);
      car.position.set(-8, 1.15, -s.d / 2 - 4);
      car.rotation.set(0, 0.6, Math.PI);
      g.add(car);
    } else if (job === 'scavenge') {
      // A roller shutter half up, pallets and a pile of boxes out front.
      add(new THREE.BoxGeometry(5, 2, 0.15), '#7a7a82', -5, 3, -s.d / 2 - 0.08);
      for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(1.1, 1, 1.1), k % 2 ? '#c9a26a' : '#a8824a', 6 + (k % 3) * 1.2, 0.5 + Math.floor(k / 3), -s.d / 2 - 2 - (k % 2) * 1.2).rotation.y = k * 0.4;
    } else if (job === 'fuel') {
      // A canopy on posts out front.
      add(new THREE.BoxGeometry(s.w * 0.8, 0.5, 7), '#c8261c', 0, 5, -s.d / 2 - 4.5);
      add(new THREE.BoxGeometry(s.w * 0.8 - 0.4, 0.1, 6.6), '#fff8e0', 0, 4.72, -s.d / 2 - 4.5, { emissive: '#fff0c0', emissiveIntensity: 1.2 });
      for (const x of [-s.w * 0.36, s.w * 0.36]) add(new THREE.CylinderGeometry(0.18, 0.18, 4.8, 8), '#e8e8ee', x, 2.4, -s.d / 2 - 7.2);
    } else {
      // A lattice mast on the roof with a red light on top.
      add(new THREE.CylinderGeometry(0.12, 0.5, 16, 4), '#8a94a0', 0, h + 8, 0);
      for (let k = 1; k < 5; k++) add(new THREE.BoxGeometry(1.6 - k * 0.25, 0.08, 0.08), '#8a94a0', 0, h + k * 3, 0);
      add(new THREE.SphereGeometry(0.35, 10, 8), '#ff3030', 0, h + 16.2, 0, { emissive: '#ff0000', emissiveIntensity: 2.5 });
    }
  }

  /** The job's things out in the arena, each under a beam of light so you can find it. */
  private sites() {
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 14, 6, 1, true).translate(0, 7, 0);
    const beam = (color: THREE.Color) => new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const wood = toon('#b88a4a');
    const strap = toon('#3a3a44');
    const metal = toon('#c9c9c9');
    for (const s of this.route.sites) {
      const g = new THREE.Group();
      g.position.set(s.x, this.y(s.x, s.z), s.z);
      g.rotation.y = s.id * 1.7;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
        return m;
      };
      if (s.kind === 'crate') {
        add(new THREE.BoxGeometry(1.1, 0.9, 1.1), wood, 0, 0.45, 0);
        add(new THREE.BoxGeometry(1.14, 0.12, 1.14), strap, 0, 0.3, 0);
        add(new THREE.BoxGeometry(1.14, 0.12, 1.14), strap, 0, 0.65, 0);
        g.add(beam(new THREE.Color(1.6, 1.2, 0.3)));
      } else if (s.kind === 'pump') {
        add(new THREE.BoxGeometry(1.2, 2, 0.8), toon('#d8261c'), 0, 1, 0);
        add(new THREE.BoxGeometry(0.9, 0.5, 0.82), toon('#fff8e0', { emissive: '#fff0c0', emissiveIntensity: 1.4 }), 0, 1.5, 0);
        add(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), strap, 0.7, 1, 0).rotation.z = 0.3;
        for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.5, 0.65, 0.3), toon('#d8261c'), -1.4 - (k % 2) * 0.6, 0.33, -0.4 + Math.floor(k / 2) * 0.8);
        g.add(beam(new THREE.Color(1.8, 0.5, 0.2)));
      } else if (s.kind === 'beacon') {
        g.rotation.y = 0;
        const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.8, 2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.4;
        g.add(ring);
        add(new THREE.CylinderGeometry(0.14, 0.2, 5, 8), metal, 0, 2.5, 0);
        add(new THREE.BoxGeometry(0.5, 0.2, 1.1), strap, 0.3, 1.2, 0);
        const lamp = add(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.8, 2) }), 0, 5.3, 0);
        lamp.castShadow = false;
        g.add(beam(new THREE.Color(0.3, 1.4, 1.6)));
        this.beacon = { ring, lamp };
      } else if (s.kind === 'tee') {
        g.rotation.y = this.route.stop.bh;
        const mat = add(new THREE.BoxGeometry(2.4, 0.08, 1.6), toon('#3fae4a'), 0, 0.04, 0);
        mat.castShadow = false;
        add(new THREE.SphereGeometry(0.09, 8, 6), toon('#ffffff'), 0.3, 0.2, 0);
        add(new THREE.BoxGeometry(0.5, 1.1, 0.5), toon('#8a5a2a'), -0.9, 0.55, 0.3);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('TEE OFF', 'rgba(0,0,0,0)', '#baffc0', 256, 64, 'bold 44px system-ui, sans-serif') }));
        tag.scale.set(2.4, 0.6, 1);
        tag.position.y = 2.4;
        g.add(tag, beam(new THREE.Color(0.5, 1.8, 0.6)));
      } else {
        g.rotation.y = this.route.stop.bh;
        add(new THREE.BoxGeometry(1.1, 2, 0.9), toon('#6b1d4f'), 0, 1, 0);
        add(new THREE.BoxGeometry(0.85, 0.6, 0.1), toon('#ffe14a', { emissive: '#ffd23f', emissiveIntensity: 1.6 }), 0, 1.45, -0.46);
        add(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), metal, 0.65, 1.3, 0);
        add(new THREE.SphereGeometry(0.11, 8, 6), toon('#ff3030'), 0.65, 1.75, 0);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('SLOTS', 'rgba(0,0,0,0)', '#ffe9a0', 256, 64, 'bold 44px system-ui, sans-serif') }));
        tag.scale.set(2.2, 0.55, 1);
        tag.position.y = 2.7;
        g.add(tag, beam(new THREE.Color(1.8, 1.3, 0.3)));
      }
      this.siteMeshes.set(s.id, g);
      this.group.add(g);
    }
  }

  /** The gate into the next leg (barred until the job's done), and the arch you came in under. */
  private gate() {
    const next = BIOMES[checkpointOf(this.route.seed, this.route.leg + 1).biome].name;
    const stone = toon('#4a4654');
    const arch = (p: { x: number; z: number; h: number; y: number }, text: string) => {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.h;
      for (const k of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9 + FOOTING, 1.6), stone);
        post.position.set(k * (ROAD.half + 1.6), (9 - FOOTING) / 2, 0);
        post.castShadow = true;
        g.add(post);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.4, 0.5) }));
        lamp.position.set(k * (ROAD.half + 1.6), 9.5, 0);
        g.add(lamp);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD.half * 2 + 4.8, 1.6, 1.2), stone);
      beam.position.y = 8.2;
      g.add(beam);
      // The sign faces the way you come from (the group's +Z).
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.half * 2 + 2, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(text, '#14101c', '#ffe9a0', 1024, 128, 'bold 56px system-ui, sans-serif'), color: new THREE.Color(1.4, 1.4, 1.4) }));
      sign.position.set(0, 8.2, 0.62);
      g.add(sign);
      this.group.add(g);
      return g;
    };
    const start = this.route.road[1];
    arch(start, `CHECKPOINT ${this.route.leg + 1}: ${this.route.cp.name.toUpperCase()}`);
    const g = arch(this.route.gate, `NEXT: ${next.toUpperCase()}`);
    // The way through: a sheet of light (red while it's shut, the next world's colour once it's open) and the bars.
    this.portal = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.half * 2 + 1.6, 7.4), new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.portal.position.y = 3.7;
    g.add(this.portal);
    this.bars = new THREE.Group();
    const iron = toon('#22222a');
    for (let k = -3; k <= 3; k++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 7.4, 6), iron);
      bar.position.set(k * 1.7, 3.7, 0);
      this.bars.add(bar);
    }
    g.add(this.bars);
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
    const parts = (list: Prop[], geo: THREE.BufferGeometry, color: string | ((p: Prop) => string), place: (p: Prop, o: THREE.Object3D) => void, glow = 0) => {
      if (!list.length) return;
      // `glow`: an unlit material brighter than white, so it blooms (mushroom caps, crystals).
      const im = new THREE.InstancedMesh(geo, glow ? new THREE.MeshBasicMaterial({ color: '#ffffff' }) : toon('#ffffff'), list.length);
      im.castShadow = !glow;
      list.forEach((p, i) => {
        d.position.set(p.x, 0, p.z);
        d.rotation.set(0, p.h, 0);
        d.scale.setScalar(1);
        place(p, d);
        d.position.y += at(p);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, col.set(typeof color === 'string' ? color : color(p)).multiplyScalar(glow || 1));
      });
      this.group.add(im);
    };
    const pick = <T>(a: readonly T[], k: number) => a[Math.floor(k * a.length) % a.length];
    const trees = by.get('tree') ?? [];
    parts(trees, new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), '#7a5233', (p, o) => {
      o.position.y = 1.2;
      o.scale.setScalar(0.8 + p.s * 0.6);
    });
    parts(trees, new THREE.IcosahedronGeometry(2, 1), (p) => pick(this.look.leaves, p.c), (p, o) => {
      // Maples in autumn: it's Ontario.
      o.position.y = 3.2 + p.s * 1.2;
      o.scale.setScalar(0.9 + p.s * 0.7);
    });
    const pines = by.get('pine') ?? [];
    parts(pines, new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6), '#6a4a2e', (_, o) => (o.position.y = 0.8));
    parts(pines, new THREE.ConeGeometry(1.7, 5, 7), (p) => pick(this.look.pines, p.c), (p, o) => {
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
    // Cacti: a trunk with two arms.
    const arm = (side: number, y: number) => mergeGeometries([new THREE.CylinderGeometry(0.16, 0.16, 0.9, 7).rotateZ(Math.PI / 2).translate(side * 0.55, y, 0), new THREE.CylinderGeometry(0.16, 0.16, 1.1, 7).translate(side * 0.95, y + 0.5, 0)]);
    parts(by.get('cactus') ?? [], mergeGeometries([new THREE.CylinderGeometry(0.28, 0.3, 3.2, 8).translate(0, 1.6, 0), new THREE.SphereGeometry(0.28, 8, 6).translate(0, 3.2, 0), arm(1, 1.4), arm(-1, 2)]), (p) => pick(['#3f8a4a', '#4f9a52', '#3a7a56'], p.c), (p, o) => o.scale.setScalar(0.8 + p.s * 0.8));
    // Giant mushrooms: a pale stem under a cap that glows.
    const shrooms = by.get('shroom') ?? [];
    parts(shrooms, new THREE.CylinderGeometry(0.22, 0.4, 3, 7).translate(0, 1.5, 0), '#d8d0e8', (p, o) => o.scale.setScalar(0.7 + p.s * 1.6));
    parts(shrooms, new THREE.SphereGeometry(1.5, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 2.9, 0), (p) => pick(['#ff4ad0', '#4ad8ff', '#a86bff', '#7cff9a'], p.c), (p, o) => o.scale.setScalar(0.7 + p.s * 1.6), 1.5);
    // Crystals: leaning shards that glow.
    parts(by.get('crystal') ?? [], mergeGeometries([new THREE.OctahedronGeometry(0.8).scale(0.6, 2.6, 0.6).translate(0, 1.6, 0), new THREE.OctahedronGeometry(0.6).scale(0.5, 2, 0.5).rotateZ(0.5).translate(0.7, 1, 0.2), new THREE.OctahedronGeometry(0.5).scale(0.5, 1.6, 0.5).rotateZ(-0.6).translate(-0.6, 0.8, -0.3)]), (p) => pick(['#4affea', '#6ab8ff', '#b88aff'], p.c), (p, o) => o.scale.setScalar(0.8 + p.s * 1.4), 1.25);
    parts(by.get('rock') ?? [], new THREE.DodecahedronGeometry(1.2, 0).scale(1, 0.7, 0.9).translate(0, 0.5, 0), (p) => pick(['#7a7a86', '#6a6a74', '#8a847a'], p.c), (p, o) => o.scale.setScalar(0.7 + p.s * 0.9));
    // Reeds: a clump of stalks with dark heads.
    const stalk = (x: number, z: number, hgt: number) => mergeGeometries([new THREE.CylinderGeometry(0.03, 0.04, hgt, 4).translate(x, hgt / 2, z), new THREE.CylinderGeometry(0.07, 0.07, 0.35, 5).translate(x, hgt, z)]);
    parts(by.get('reed') ?? [], mergeGeometries([stalk(0, 0, 2.2), stalk(0.3, 0.2, 1.8), stalk(-0.25, 0.3, 2), stalk(0.1, -0.3, 1.6), stalk(-0.3, -0.2, 1.9)]), (p) => pick(['#6a7a3a', '#5a6a34', '#7a7a40'], p.c), (p, o) => o.scale.setScalar(0.8 + p.s * 0.6));
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
    const cash = toon('#b8c0cc', { emissive: '#40505a', emissiveIntensity: 0.6 });
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
      } else if (p.kind === 'scrap') {
        // A heap of scrap: a gear on a couple of plates.
        const gear = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 6, 8), cash);
        gear.rotation.x = 0.4;
        g.add(gear);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), metal);
        plate.position.y = -0.3;
        plate.rotation.z = 0.2;
        g.add(plate);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture('SCRAP', 'rgba(0,0,0,0)', '#fff6a0', 128, 64, 'bold 36px system-ui, sans-serif') }));
        label.scale.set(0.9, 0.45, 1);
        label.position.set(0, 0.7, 0);
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

  /**
   * Per frame: pickups bob and spin (and vanish once taken, like the crates once got); the parking ring pulses until
   * you've parked; the beacon's ring fills as it's cranked; the gate's bars lift and its light turns once it's open.
   */
  update(t: number, taken: ReadonlySet<number>, got: ReadonlySet<number>, run: { phase: string; done: boolean; prog: number; need: number }) {
    for (const [id, g] of this.pickupMeshes) {
      g.visible = !taken.has(id);
      if (!g.visible) continue;
      g.rotation.y = t * 2 + g.userData.base;
      g.position.y = g.userData.y + Math.sin(t * 3 + g.userData.base) * 0.15;
    }
    for (const [id, g] of this.siteMeshes) g.visible = !(this.route.sites[id].kind === 'crate' && (got.has(id) || run.done));
    this.ring.visible = run.phase === 'drive' && !run.done;
    this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    if (this.beacon) {
      const k = run.done ? 1 : run.prog / Math.max(1, run.need);
      this.beacon.lamp.scale.setScalar(0.6 + k * 1.2 + Math.sin(t * 8) * 0.08);
      this.beacon.ring.material = this.beacon.ring.material as THREE.MeshBasicMaterial;
      (this.beacon.ring.material as THREE.MeshBasicMaterial).opacity = run.done ? 0.25 : 0.55 + Math.sin(t * 5) * 0.25;
    }
    this.bars.position.y += ((run.done ? 8 : 0) - this.bars.position.y) * 0.06;
    this.portal.material.color.set(run.done ? '#3aff8a' : '#ff2a2a');
    this.portal.material.opacity = 0.3 + Math.sin(t * 3) * 0.1;
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
