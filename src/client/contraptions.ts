import * as THREE from 'three';
import { CONTRAPTIONS, type ContraptionKind, WORKSHOP } from '../shared/contraptions.ts';
import type { ContraptionFx, NetContraption, V3 } from '../shared/protocol.ts';
import { GrenadeFx } from './grenadefx.ts';
import { signTexture } from './foundrytextures.ts';
import { softDot } from './textures.ts';
import { pbr, type SurfaceParams } from './render/surface.ts';

// Contraptions on the client: a silly hand-made model for each (all procedural), the Tinker's Workbench, the placement
// ghost, and what they do (spike piles, tacks, goo, bombs, lightning, owl shots). The server decides; we animate.

const solid = (color: number, extra: SurfaceParams = {}) => pbr({ color, ...extra });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
const C = {
  wood: solid(0x9a6b42),
  darkWood: solid(0x6e4a2e),
  brass: solid(0xd8a84a),
  copper: solid(0xc8743e),
  iron: solid(0x5d636e),
  steel: solid(0xb8c0c8),
  red: solid(0xd9584a),
  cream: solid(0xf3e6c8),
  ink: solid(0x2a2430),
  bomb: solid(0x30303a),
  green: solid(0x6fbf5a),
  owl: solid(0xb08a64),
  belly: solid(0xf0dcb6),
  ceramic: solid(0xe8e2d6),
};

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

/** Four stubby legs under a square base of half width h, top at y. */
function legs(h: number, y: number, mat: THREE.Material): THREE.Mesh[] {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => mesh(new THREE.CylinderGeometry(0.05, 0.07, y, 6), mat, sx * h, y / 2, sz * h));
}

/**
 * A contraption's model, base on the floor at the origin, its front toward +z. Its moving part (if any) is named 'spin'
 * (tacks, the zapper's ball), 'arm' (the lobber), 'head' (the owl) or 'tank' (goo), for the animations.
 */
export function buildContraption(kind: ContraptionKind): THREE.Group {
  const g = new THREE.Group();
  const accent = solid(CONTRAPTIONS[kind].color);
  switch (kind) {
    case 'spikes': {
      // A barrel on legs with a hopper on top and a spout at the front: spike piles come out of it.
      g.add(...legs(0.3, 0.25, C.darkWood));
      g.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.7, 14), C.wood, 0, 0.6, 0));
      for (const y of [0.35, 0.85]) g.add(mesh(new THREE.TorusGeometry(0.365, 0.03, 6, 18).rotateX(Math.PI / 2), C.iron, 0, y, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.18, 0.32, 14, 1, true), accent, 0, 1.11, 0));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const s = mesh(new THREE.ConeGeometry(0.05, 0.22, 5), C.steel, Math.cos(a) * 0.22, 1.25, Math.sin(a) * 0.22);
        s.rotation.z = Math.cos(a) * 0.4;
        s.rotation.x = -Math.sin(a) * 0.4;
        g.add(s);
      }
      const spout = mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.35, 8), C.brass, 0, 0.45, 0.42);
      spout.rotation.x = 1.1;
      g.add(spout);
      const crank = mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), C.red, 0.4, 0.8, 0);
      crank.name = 'spin';
      g.add(crank);
      break;
    }
    case 'tacks': {
      // A brass drum on a tripod, with a pinwheel crown of tacks that spins up when it fires.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.6, 6), C.iron, Math.cos(a) * 0.28, 0.28, Math.sin(a) * 0.28);
        leg.rotation.z = Math.cos(a) * 0.35;
        leg.rotation.x = -Math.sin(a) * 0.35;
        g.add(leg);
      }
      g.add(mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.4, 16), C.brass, 0, 0.75, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.06, 16), accent, 0, 0.58, 0));
      const crown = new THREE.Group();
      crown.name = 'spin';
      crown.position.y = 1.0;
      crown.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), accent));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const t = mesh(new THREE.ConeGeometry(0.04, 0.2, 5), C.steel, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
        t.rotation.z = -Math.PI / 2;
        t.rotation.y = -a;
        crown.add(t);
      }
      crown.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), C.red, 0, 0.1, 0));
      g.add(crown);
      break;
    }
    case 'goo': {
      // A glass tank of glowing green goo on a crate, with a copper nozzle at the front.
      g.add(mesh(new THREE.BoxGeometry(0.8, 0.45, 0.8), C.wood, 0, 0.225, 0));
      g.add(mesh(new THREE.BoxGeometry(0.84, 0.06, 0.84), C.darkWood, 0, 0.45, 0));
      const tank = mesh(new THREE.SphereGeometry(0.34, 16, 12), pbr({ color: 0x9ff07a, transparent: true, opacity: 0.75, emissive: 0x2f7a1c }), 0, 0.85, 0);
      tank.name = 'tank';
      g.add(tank);
      g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), glow(0x7dff4a), 0, 0.8, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.12, 12), C.copper, 0, 1.2, 0));
      const nozzle = mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.45, 8), C.copper, 0, 0.75, 0.42);
      nozzle.rotation.x = 1.3;
      g.add(nozzle);
      g.add(mesh(new THREE.TorusGeometry(0.34, 0.03, 6, 18).rotateX(Math.PI / 2), C.copper, 0, 0.85, 0));
      break;
    }
    case 'lobber': {
      // A little red catapult: a base, two uprights, and an arm with a bucket holding a bomb (fuse lit).
      g.add(mesh(new THREE.BoxGeometry(0.8, 0.18, 1), accent, 0, 0.12, 0));
      for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.6, 0.12), C.darkWood, x, 0.5, -0.05));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8).rotateZ(Math.PI / 2), C.iron, 0, 0.75, -0.05));
      const arm = new THREE.Group();
      arm.name = 'arm';
      arm.position.set(0, 0.75, -0.05);
      arm.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.95), C.wood, 0, 0, -0.35));
      arm.add(mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.14, 12), C.iron, 0, 0.07, -0.78));
      const bomb = mesh(new THREE.SphereGeometry(0.15, 12, 10), C.bomb, 0, 0.2, -0.78);
      bomb.name = 'bomb';
      bomb.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 5), C.cream, 0, 0.17, 0), mesh(new THREE.SphereGeometry(0.03, 6, 5), glow(0xffc04a), 0, 0.23, 0));
      arm.add(bomb);
      arm.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), C.iron, 0, -0.02, 0.25)); // the counterweight
      arm.rotation.x = -0.35; // cocked, bucket down at the back
      g.add(arm);
      break;
    }
    case 'zapper': {
      // A Tesla coil: a ceramic pillar wound with copper, rings, and a crackling ball on top.
      g.add(mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.18, 16), C.iron, 0, 0.09, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.85, 12), C.ceramic, 0, 0.6, 0));
      for (let i = 0; i < 6; i++) g.add(mesh(new THREE.TorusGeometry(0.17 - i * 0.004, 0.025, 6, 16).rotateX(Math.PI / 2), C.copper, 0, 0.3 + i * 0.12, 0));
      g.add(mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 20).rotateX(Math.PI / 2), accent, 0, 1.06, 0));
      const ball = mesh(new THREE.SphereGeometry(0.17, 14, 10), glow(0xbfeaff), 0, 1.24, 0);
      ball.name = 'spin';
      g.add(ball);
      break;
    }
    case 'owl': {
      // A round sleepy owl on a post, with a rifle far too long for it.
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 8), C.darkWood, 0, 0.27, 0));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), C.wood, 0, 0.03, 0));
      g.add(mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), C.darkWood, 0, 0.56, 0));
      const body = mesh(new THREE.SphereGeometry(0.3, 16, 12), C.owl, 0, 0.82, 0);
      body.scale.set(1, 1.1, 0.9);
      g.add(body, mesh(new THREE.SphereGeometry(0.2, 12, 10), C.belly, 0, 0.78, 0.13));
      const head = new THREE.Group();
      head.name = 'head';
      head.position.y = 1.12;
      head.add(mesh(new THREE.SphereGeometry(0.24, 16, 12), C.owl));
      for (const s of [-1, 1]) {
        head.add(mesh(new THREE.CircleGeometry(0.09, 16), C.cream, s * 0.1, 0.02, 0.215));
        const eye = mesh(new THREE.CircleGeometry(0.045, 12), C.ink, s * 0.1, 0.0, 0.222);
        eye.scale.y = 0.45; // sleepy
        head.add(eye);
        const tuft = mesh(new THREE.ConeGeometry(0.06, 0.16, 5), C.owl, s * 0.15, 0.22, 0);
        tuft.rotation.z = -s * 0.4;
        head.add(tuft);
      }
      head.add(mesh(new THREE.ConeGeometry(0.035, 0.08, 4).rotateX(Math.PI / 2), C.brass, 0, -0.05, 0.25));
      // The rifle: held under the wing, pointing where the owl looks.
      const rifle = new THREE.Group();
      rifle.position.set(0.18, -0.25, 0.1);
      rifle.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.4), C.darkWood, 0, 0, -0.05));
      rifle.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 6).rotateX(Math.PI / 2), C.iron, 0, 0.03, 0.45));
      rifle.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8).rotateX(Math.PI / 2), C.ink, 0, 0.1, 0.05));
      head.add(rifle);
      g.add(head);
      break;
    }
  }
  return g;
}

/** The Tinker's Workbench: a warm wooden bench with a pegboard of tools, a vice, cogs and a toy windmill. Front toward +z. */
export function buildTinkerBench(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2, 0.12, 1), C.wood, 0, 0.89, 0));
  for (const [x, z] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.84, 0.1), C.darkWood, x, 0.42, z));
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.06, 0.8), C.darkWood, 0, 0.25, 0)); // the shelf
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), solid(0xc9a46a), -0.5, 0.43, 0)); // a crate of bits
  // Pegboard with tools.
  g.add(mesh(new THREE.BoxGeometry(2, 1.3, 0.06), solid(0x8a6646), 0, 1.65, -0.45));
  const tools: [number, number, number, number, THREE.Material][] = [[-0.7, 1.75, 0.08, 0.5, C.iron], [-0.45, 1.7, 0.06, 0.4, C.red], [0.4, 1.8, 0.07, 0.45, C.brass], [0.65, 1.65, 0.05, 0.35, C.steel]];
  for (const [x, y, w, h, m] of tools) g.add(mesh(new THREE.BoxGeometry(w, h, 0.04), m, x, y, -0.4));
  const cog = (r: number, x: number, y: number, m: THREE.Material) => {
    const c = mesh(new THREE.TorusGeometry(r, r * 0.3, 6, 10), m, x, y, -0.38);
    c.name = 'cog';
    return c;
  };
  g.add(cog(0.16, -0.05, 1.95, C.brass), cog(0.1, 0.15, 1.72, C.copper));
  // A vice, and a half-built contraption on the bench.
  g.add(mesh(new THREE.BoxGeometry(0.25, 0.18, 0.2), C.iron, 0.7, 1.04, 0.25));
  const toy = buildContraption('tacks');
  toy.scale.setScalar(0.35);
  toy.position.set(0.1, 0.95, 0.1);
  g.add(toy);
  // A toy windmill on the corner, for the Ghibli of it.
  const mill = new THREE.Group();
  mill.position.set(-0.75, 0.95, 0.2);
  mill.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.4, 6), C.cream, 0, 0.2, 0));
  const blades = new THREE.Group();
  blades.name = 'cog';
  blades.position.set(0, 0.4, 0.08);
  for (let i = 0; i < 4; i++) {
    const b = mesh(new THREE.BoxGeometry(0.05, 0.22, 0.01), C.red, 0, 0.11, 0);
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(b);
    blades.add(arm);
  }
  mill.add(blades);
  g.add(mill);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), new THREE.MeshBasicMaterial({ map: signTexture(["TINKER'S WORKBENCH"], { w: 640, h: 160, bg: '#3a2416', fg: '#ffcf7a', border: '#d98a3a' }), color: 0xe8e2d0 }));
  sign.position.set(0, 2.55, -0.43);
  g.add(sign);
  // A little work lamp clamped to the board, glowing warm.
  g.add(mesh(new THREE.ConeGeometry(0.14, 0.18, 10, 1, true), C.iron, 0.75, 2.2, -0.3));
  const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffb35a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamp.scale.set(0.9, 0.9, 1);
  lamp.position.set(0.75, 2.1, -0.25);
  g.add(lamp);
  return g;
}

/** Green or red see-through stand-in for a contraption being placed. */
function ghostOf(kind: ContraptionKind, mat: THREE.Material): THREE.Group {
  const g = buildContraption(kind);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = mat;
      o.castShadow = false;
    }
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(WORKSHOP.radius + 0.1, WORKSHOP.radius + 0.22, 32).rotateX(-Math.PI / 2), mat);
  ring.position.y = 0.03;
  g.add(ring);
  return g;
}

interface Placed {
  net: NetContraption;
  obj: THREE.Group;
  /** Seconds since it last fired (drives each one's little animation). */
  since: number;
  face: number;
}

interface Flying {
  obj: THREE.Object3D;
  t: number;
  life: number;
  step(k: number, dt: number): void;
}

const tackGeo = new THREE.ConeGeometry(0.03, 0.14, 4).rotateX(Math.PI / 2);
const pileGeo = new THREE.ConeGeometry(0.05, 0.2, 4);
const gooGeo = new THREE.SphereGeometry(0.12, 8, 6);

/**
 * Every contraption in the scene, kept in step with the server's list; their animations and effects; the placement
 * ghost. `onFx` hears what happened (for the sounds), with where.
 */
export class ContraptionView {
  private placed = new Map<number, Placed>();
  private piles = new Map<number, THREE.Group>();
  private flying: Flying[] = [];
  private booms: GrenadeFx;
  private ghost: { kind: ContraptionKind; obj: THREE.Group } | null = null;
  private ghostOk = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.45, depthWrite: false });
  private ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.45, depthWrite: false });
  onFx?: (fx: ContraptionFx | 'boom', at: THREE.Vector3) => void;

  constructor(private scene: THREE.Scene) {
    this.booms = new GrenadeFx(scene);
  }

  /** The server's full list: add the new ones, drop the gone ones, and the spike piles likewise. */
  sync(list: NetContraption[], piles: { n: number; p: V3 }[]) {
    const ids = new Set(list.map((c) => c.id));
    for (const [id, p] of this.placed) {
      if (ids.has(id)) continue;
      this.puff(p.obj.position, 0xd9c9a8);
      p.obj.removeFromParent();
      this.placed.delete(id);
    }
    for (const c of list) {
      if (this.placed.has(c.id)) continue;
      const obj = buildContraption(c.k);
      obj.position.set(...c.p);
      obj.rotation.y = c.yaw;
      obj.scale.setScalar(0.01); // pops up (update grows it)
      this.scene.add(obj);
      this.placed.set(c.id, { net: c, obj, since: 9, face: c.yaw });
    }
    const ns = new Set(piles.map((p) => p.n));
    for (const [n, obj] of this.piles) if (!ns.has(n)) this.dropPile(n, obj);
    for (const p of piles) if (!this.piles.has(p.n)) this.addPile(p.n, p.p);
  }

  get list(): NetContraption[] {
    return [...this.placed.values()].map((p) => p.net);
  }

  /** Something one of them did. */
  fx(id: number, fx: ContraptionFx, pts: V3[] = [], n?: number) {
    const c = this.placed.get(id);
    if (!c) return;
    const top = c.obj.position.clone().add(new THREE.Vector3(0, 1.05, 0));
    const at = pts.map((p) => new THREE.Vector3(...p));
    c.since = 0;
    if (at[0]) c.face = Math.atan2(at[0].x - c.obj.position.x, at[0].z - c.obj.position.z);
    switch (fx) {
      case 'pile':
        if (n !== undefined && at[0]) this.addPile(n, pts[0], top);
        break;
      case 'pileGone': {
        const obj = n === undefined ? undefined : this.piles.get(n);
        if (obj) this.dropPile(n!, obj);
        break;
      }
      case 'tacks':
        this.tacks(top);
        break;
      case 'goo':
        if (at[0]) this.lob(top, at[0], 0.45, new THREE.Mesh(gooGeo, glow(0x8dff5a)), 1.2, () => this.puff(at[0], 0x8dff5a));
        break;
      case 'bomb':
        if (at[0]) {
          const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), C.bomb);
          this.lob(top, at[0].clone().setY(at[0].y + 0.2), WORKSHOP.bombFlight, bomb, 4, () => {
            this.booms.explode({ x: at[0].x, y: at[0].y + 0.4, z: at[0].z });
            this.onFx?.('boom', at[0]);
          });
        }
        break;
      case 'zap':
        this.zap([c.obj.position.clone().setY(c.obj.position.y + 1.24), ...at]);
        break;
      case 'owl':
        if (at[0]) this.beam(top.clone().setY(top.y + 0.1), at[0], 0xffe9a8, 0.18);
        break;
    }
    this.onFx?.(fx, c.obj.position);
  }

  /** The placement ghost: a kind to show at `p` (red when `ok` is false), or null to hide it. */
  setGhost(kind: ContraptionKind | null, p?: THREE.Vector3, yaw = 0, ok = true) {
    if (!kind) {
      this.ghost?.obj.removeFromParent();
      this.ghost = null;
      return;
    }
    if (this.ghost?.kind !== kind) {
      this.ghost?.obj.removeFromParent();
      this.ghost = { kind, obj: ghostOf(kind, this.ghostOk) };
      this.scene.add(this.ghost.obj);
    }
    const mat = ok ? this.ghostOk : this.ghostBad;
    this.ghost.obj.traverse((o) => o instanceof THREE.Mesh && (o.material = mat));
    if (p) this.ghost.obj.position.copy(p);
    this.ghost.obj.rotation.y = yaw;
  }

  update(time: number, dt: number) {
    for (const c of this.placed.values()) {
      c.since += dt;
      const s = c.obj.scale.x;
      if (s < 1) c.obj.scale.setScalar(Math.min(1, s + dt * 4 * (1.2 - s) + dt));
      const o = c.obj;
      switch (c.net.k) {
        case 'tacks': {
          const spin = o.getObjectByName('spin')!;
          spin.rotation.y += dt * (c.since < 0.6 ? 22 : 1.5);
          break;
        }
        case 'spikes':
          o.getObjectByName('spin')!.rotation.x = time * 3;
          break;
        case 'goo':
          o.getObjectByName('tank')!.scale.setScalar(1 + Math.sin(time * 5 + c.net.id) * 0.04);
          break;
        case 'zapper': {
          const ball = o.getObjectByName('spin')! as THREE.Mesh;
          ball.scale.setScalar(1 + (c.since < 0.25 ? 0.5 : 0.06 * Math.sin(time * 23)));
          break;
        }
        case 'lobber': {
          const arm = o.getObjectByName('arm')!;
          // Fling: the arm whips over, then winds slowly back down.
          arm.rotation.x = c.since < 0.15 ? -0.35 + (c.since / 0.15) * 1.9 : c.since < 1.5 ? 1.55 - ((c.since - 0.15) / 1.35) * 1.9 : -0.35;
          o.getObjectByName('bomb')!.visible = c.since > 1.2;
          o.rotation.y = turn(o.rotation.y, c.face, dt * 6);
          break;
        }
        case 'owl': {
          const head = o.getObjectByName('head')!;
          head.rotation.y = turn(head.rotation.y + o.rotation.y, c.face, dt * 8) - o.rotation.y;
          head.position.y = 1.12 + (c.since < 0.15 ? -0.05 : Math.sin(time * 1.3 + c.net.id) * 0.015); // recoil, then dozing
          head.rotation.z = c.since > 3 ? Math.sin(time * 0.8 + c.net.id) * 0.15 : 0;
          break;
        }
      }
    }
    for (const g of this.piles.values()) g.scale.setScalar(Math.min(1, g.scale.x + dt * 5));
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      f.step(Math.min(1, f.t / f.life), dt);
      if (f.t >= f.life) {
        f.obj.removeFromParent();
        this.flying.splice(i, 1);
      }
    }
    this.booms.update(dt);
  }

  /** A run reset or leaving the game: everything goes. */
  clear() {
    this.sync([], []);
    this.setGhost(null);
  }

  // --- Effects ---------------------------------------------------------------------------------------------

  private addPile(n: number, p: V3, from?: THREE.Vector3) {
    if (this.piles.has(n)) return;
    const g = new THREE.Group();
    g.position.set(...p);
    g.add(mesh(new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2), solid(0x8a6a4a), 0, 0.02, 0));
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = 0.08 + (i % 3) * 0.12;
      const s = mesh(pileGeo, C.steel, Math.cos(a) * r, 0.1, Math.sin(a) * r);
      s.rotation.set(Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4);
      g.add(s);
    }
    g.scale.setScalar(0.01);
    this.scene.add(g);
    this.piles.set(n, g);
    if (from) this.lob(from, g.position, 0.4, new THREE.Mesh(pileGeo, C.steel), 0.8, () => {});
  }

  private dropPile(n: number, obj: THREE.Group) {
    this.puff(obj.position, 0xb8c0c8);
    obj.removeFromParent();
    this.piles.delete(n);
  }

  private tacks(from: THREE.Vector3) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const m = new THREE.Mesh(tackGeo, C.steel);
      m.position.copy(from);
      m.rotation.y = a + Math.PI / 2;
      const v = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(CONTRAPTIONS.tacks.range / 0.3);
      this.scene.add(m);
      this.flying.push({ obj: m, t: 0, life: 0.3, step: (_k, dt) => m.position.addScaledVector(v, dt) });
    }
  }

  /** Something flying in an arc from a to b over `life` seconds, peaking `apex` above the higher end; `land` when it gets there. */
  private lob(a: THREE.Vector3, b: THREE.Vector3, life: number, obj: THREE.Object3D, apex: number, land: () => void) {
    const from = a.clone();
    const to = b.clone();
    obj.position.copy(from);
    this.scene.add(obj);
    let landed = false;
    this.flying.push({
      obj,
      t: 0,
      life,
      step: (k) => {
        obj.position.lerpVectors(from, to, k);
        obj.position.y += Math.sin(k * Math.PI) * apex;
        if (k >= 1 && !landed) {
          landed = true;
          land();
        }
      },
    });
  }

  /** A jagged bolt through the points, flickering out. */
  private zap(points: THREE.Vector3[]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      for (let j = 0; j < 6; j++) pts.push(a.clone().lerp(b, j / 6).add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35)));
    }
    pts.push(points[points.length - 1]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcff4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const halo = new THREE.Group();
    halo.add(line);
    for (const p of points.slice(1)) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0x8fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(p);
      s.scale.set(1.4, 1.4, 1);
      halo.add(s);
    }
    this.scene.add(halo);
    this.flying.push({
      obj: halo,
      t: 0,
      life: 0.3,
      step: (k) => {
        const o = (1 - k) * (Math.random() > 0.3 ? 1 : 0.3);
        (line.material as THREE.LineBasicMaterial).opacity = o;
        for (const c of halo.children) if (c instanceof THREE.Sprite) c.material.opacity = o;
      },
    });
  }

  /** A shot's streak, fading. */
  private beam(a: THREE.Vector3, b: THREE.Vector3, color: number, life: number) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(a);
    m.lookAt(b);
    this.scene.add(m);
    this.flying.push({ obj: m, t: 0, life, step: (k) => ((m.material as THREE.MeshBasicMaterial).opacity = 1 - k) });
    this.puff(b, color);
  }

  private puff(p: THREE.Vector3, color: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color, transparent: true, depthWrite: false }));
    s.position.copy(p).setY(p.y + 0.3);
    this.scene.add(s);
    this.flying.push({
      obj: s,
      t: 0,
      life: 0.45,
      step: (k) => {
        s.scale.setScalar(0.4 + k * 1.4);
        s.material.opacity = 0.8 * (1 - k);
      },
    });
  }
}

/** Turn angle `a` toward `b` by at most `step`, the short way round. */
function turn(a: number, b: number, step: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-step, Math.min(step, d));
}
