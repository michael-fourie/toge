// Procedural characters from cast.ts looks: stylised, real heights, slightly big heads, soft toon shading, ink
// outlines on the head and body, canvas faces (X_X when taken out). One Person per player; `pose()` every frame.

import * as THREE from 'three';
import type { Look } from './cast.ts';

/** Model space is built for a 1.80 m person and scaled to the real height. */
const BASE = 1.8;
const HIP = 0.86;
const SHOULDER = 1.36;
const HEAD_Y = 1.6;
const HEAD_R = 0.15;

let toonRamp: THREE.DataTexture | null = null;
/** The shared 3-step toon ramp (soft cel shading everywhere). */
export function ramp(): THREE.DataTexture {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([90, 175, 255]), 3, 1, THREE.RedFormat);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: ramp() });
const INK = new THREE.MeshBasicMaterial({ color: 0x1a1418, side: THREE.BackSide });

const geo = {
  limb: new THREE.CapsuleGeometry(1, 1, 3, 8),
  ball: new THREE.SphereGeometry(1, 20, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  disc: new THREE.CircleGeometry(1, 24),
  ring: new THREE.TorusGeometry(1, 0.12, 6, 18),
};

/** A part: a mesh of a shared geometry, scaled and placed, optionally with an ink hull behind it. */
function part(g: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, ink = false) {
  const m = new THREE.Mesh(g, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if (ink) {
    const hull = new THREE.Mesh(g, INK);
    hull.scale.setScalar(1.07);
    m.add(hull);
  }
  return m;
}

export type Face = 'smile' | 'talk' | 'dead' | 'worried';

function drawFace(c: HTMLCanvasElement, face: Face) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = g.fillStyle = '#2a1d1a';
  g.lineCap = 'round';
  g.lineWidth = 7;
  if (face === 'dead') {
    for (const x of [40, 88]) {
      g.beginPath();
      g.moveTo(x - 11, 46);
      g.lineTo(x + 11, 68);
      g.moveTo(x + 11, 46);
      g.lineTo(x - 11, 68);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(44, 96);
    for (let i = 1; i <= 4; i++) g.lineTo(44 + i * 10, 96 + (i % 2 ? -6 : 0));
    g.stroke();
    return;
  }
  // Eyes: dark ovals with a highlight, brows over them.
  for (const x of [40, 88]) {
    g.fillStyle = '#2a1d1a';
    g.beginPath();
    g.ellipse(x, 58, 8, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x + 3, 53, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 5;
  const lift = face === 'worried' ? 6 : 0;
  g.beginPath();
  g.moveTo(28, 38 + lift);
  g.lineTo(50, 36 - lift);
  g.moveTo(78, 36 - lift);
  g.lineTo(100, 38 + lift);
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  if (face === 'talk') {
    g.fillStyle = '#7a2a2a';
    g.ellipse(64, 94, 13, 10, 0, 0, Math.PI * 2);
    g.fill();
  } else if (face === 'worried') {
    g.moveTo(50, 98);
    g.quadraticCurveTo(64, 88, 78, 98);
    g.stroke();
  } else {
    g.moveTo(46, 88);
    g.quadraticCurveTo(64, 104, 82, 88);
    g.stroke();
  }
}

/** A floating name tag (depth-tested, so walls hide it like everything else). */
function nameTag(text: string, colour = '#fff'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(20,12,24,0.62)';
  g.beginPath();
  g.roundRect(128 - w / 2, 10, w, 44, 22);
  g.fill();
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(0.8, 0.2, 1);
  return s;
}

export interface PoseIn {
  /** Horizontal speed (m/s) drives the walk cycle. */
  speed: number;
  crouch: boolean;
  /** Where they're looking up/down (radians, + is up). */
  pitch: number;
  sit?: boolean;
  dead?: boolean;
  point?: boolean;
  /** Looking down at their phone (others can see it). */
  phone?: boolean;
}

export class Person {
  readonly root = new THREE.Group();
  /** Everything that tilts and bends; root stays at the feet. */
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private faceCanvas = document.createElement('canvas');
  private faceTex: THREE.CanvasTexture;
  private face: Face = 'smile';
  private mats: THREE.Material[] = [];
  private phase = 0;
  private tag: THREE.Sprite | null = null;
  readonly height: number;

  constructor(look: Look, heightCm: number) {
    this.height = heightCm / 100;
    const k = this.height / BASE;
    this.root.scale.setScalar(k);
    const m = (c: string) => {
      const mat = toon(c);
      this.mats.push(mat);
      return mat;
    };
    const skin = m(look.skin);
    const hair = m(look.hair);
    const shirt = m(look.shirt);
    const trim = m(look.trim);
    const pants = m(look.pants);
    const shoes = m(look.shoes);
    const w = look.build;

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = HIP;
    // Legs pivot at the hips and hang down; shoes at the bottom.
    for (const [leg, x] of [
      [this.legL, -0.1],
      [this.legR, 0.1],
    ] as const) {
      leg.position.x = x * w;
      leg.add(part(geo.limb, pants, 0.078, 0.36, 0.078, 0, -0.42, 0, true));
      leg.add(part(geo.box, shoes, 0.12, 0.09, 0.25, 0, -0.81, -0.04, true));
      this.hips.add(leg);
    }
    // Torso (from the hips), with a trim stripe across the chest.
    this.hips.add(this.chest);
    this.chest.add(part(geo.limb, shirt, 0.2 * w, 0.17, 0.13, 0, 0.27, 0, true));
    this.chest.add(part(geo.box, trim, 0.36 * w, 0.06, 0.2, 0, 0.36, -0.035));
    this.chest.add(part(geo.limb, pants, 0.19 * w, 0.03, 0.125, 0, 0.02, 0));
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * 0.235 * w, SHOULDER - HIP, 0);
      arm.add(part(geo.limb, shirt, 0.062, 0.12, 0.062, 0, -0.1, 0, true));
      arm.add(part(geo.limb, skin, 0.05, 0.17, 0.05, 0, -0.34, 0, true));
      this.chest.add(arm);
    }
    // Head: a big round head with a canvas face on the front, then hair, glasses and a hat.
    this.chest.add(this.head);
    this.head.position.y = HEAD_Y - HIP;
    this.head.add(part(geo.limb, skin, 0.05, 0.05, 0.05, 0, -0.13, 0));
    this.head.add(part(geo.ball, skin, HEAD_R, HEAD_R * 1.07, HEAD_R, 0, 0, 0, true));
    this.faceCanvas.width = this.faceCanvas.height = 128;
    drawFace(this.faceCanvas, 'smile');
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    const faceMat = new THREE.MeshBasicMaterial({ map: this.faceTex, transparent: true });
    this.mats.push(faceMat);
    const face = part(geo.disc, faceMat, 0.12, 0.12, 1, 0, -0.01, -HEAD_R - 0.004);
    face.rotation.y = Math.PI;
    this.head.add(face);
    this.addHair(look, hair);
    if (look.glasses) {
      const frame = m('#22201e');
      for (const x of [-0.055, 0.055]) {
        const r = part(geo.ring, frame, 0.042, 0.042, 0.042, x, 0.005, -HEAD_R - 0.012);
        this.head.add(r);
      }
      this.head.add(part(geo.box, frame, 0.03, 0.008, 0.008, 0, 0.01, -HEAD_R - 0.012));
    }
    if (look.hat) {
      const hat = m(look.hatColour ?? '#333');
      if (look.hat === 'toque') this.head.add(part(geo.ball, hat, HEAD_R * 1.06, HEAD_R * 0.9, HEAD_R * 1.06, 0, 0.05, 0.005, true));
      else {
        this.head.add(part(geo.ball, hat, HEAD_R * 1.05, HEAD_R * 0.62, HEAD_R * 1.05, 0, 0.065, 0, true));
        this.head.add(part(geo.box, hat, 0.2, 0.015, 0.14, 0, 0.06, -HEAD_R - 0.03));
      }
    }
  }

  private addHair(look: Look, hair: THREE.Material) {
    const R = HEAD_R;
    const cap = (sy: number, y: number) => this.head.add(part(geo.ball, hair, R * 1.06, R * sy, R * 1.06, 0, y, 0.012, true));
    switch (look.style) {
      case 'buzz':
        cap(0.72, 0.045);
        break;
      case 'short':
        cap(0.8, 0.05);
        this.head.add(part(geo.box, hair, 0.24, 0.05, 0.08, 0, 0.12, -0.08));
        break;
      case 'swept':
        cap(0.82, 0.05);
        this.head.add(part(geo.ball, hair, 0.12, 0.06, 0.1, 0.02, 0.14, -0.07, true));
        break;
      case 'medium':
        cap(0.9, 0.04);
        this.head.add(part(geo.box, hair, 0.28, 0.07, 0.07, 0, 0.09, -0.12));
        this.head.add(part(geo.box, hair, 0.3, 0.14, 0.2, 0, 0.0, 0.07));
        break;
      case 'shaggy':
        cap(0.95, 0.04);
        this.head.add(part(geo.box, hair, 0.29, 0.09, 0.08, 0, 0.07, -0.125));
        this.head.add(part(geo.box, hair, 0.32, 0.2, 0.22, 0, -0.03, 0.06));
        break;
      case 'long':
        cap(0.95, 0.04);
        this.head.add(part(geo.box, hair, 0.32, 0.32, 0.12, 0, -0.1, 0.1));
        break;
      case 'verylong':
        cap(0.95, 0.04);
        this.head.add(part(geo.box, hair, 0.33, 0.55, 0.12, 0, -0.2, 0.1));
        this.head.add(part(geo.box, hair, 0.06, 0.4, 0.12, -0.15, -0.14, -0.02));
        this.head.add(part(geo.box, hair, 0.06, 0.4, 0.12, 0.15, -0.14, -0.02));
        break;
    }
  }

  setFace(face: Face) {
    if (face === this.face) return;
    this.face = face;
    drawFace(this.faceCanvas, face);
    this.faceTex.needsUpdate = true;
  }

  /** A name tag floating over their head (null removes it). */
  setTag(text: string | null, colour?: string) {
    if (this.tag) {
      this.root.remove(this.tag);
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
      this.tag = null;
    }
    if (text === null) return;
    this.tag = nameTag(text, colour);
    this.tag.position.y = BASE + 0.28;
    this.tag.scale.multiplyScalar(BASE / this.height);
    this.root.add(this.tag);
  }

  /** Ghosts and the washed-out look: everything goes see-through. */
  setOpacity(a: number) {
    for (const mat of this.mats) {
      mat.transparent = a < 1 || mat instanceof THREE.MeshBasicMaterial;
      mat.opacity = a;
      mat.depthWrite = a >= 1;
    }
  }

  /** Poses the body for this frame. */
  pose(p: PoseIn, dt: number) {
    const walk = Math.min(1, p.speed / 3.2);
    this.phase += dt * (3 + 6 * walk) * (p.speed > 0.15 ? 1 : 0);
    const s = Math.sin(this.phase) * walk;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.chest.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.08);
    this.armR.rotation.set(0, 0, -0.08);
    if (p.dead) {
      // Slumped on the floor, face up, arms out.
      this.body.rotation.x = Math.PI / 2;
      this.body.position.set(0, 0.15, -0.85);
      this.legL.rotation.set(0, 0, 0.15);
      this.legR.rotation.set(0, 0, -0.15);
      this.armL.rotation.set(0, 0, 1.2);
      this.armR.rotation.set(0, 0, -1.2);
      this.head.rotation.set(0, 0, 0.3);
      this.setFace('dead');
      return;
    }
    if (p.sit) {
      this.hips.position.y = 0.5;
      this.legL.rotation.set(-1.5, 0, 0);
      this.legR.rotation.set(-1.5, 0, 0);
    } else {
      const crouch = p.crouch ? 0.32 : 0;
      this.hips.position.y = HIP - crouch + Math.abs(Math.cos(this.phase)) * 0.025 * walk;
      this.legL.rotation.set(s * 0.65 - crouch * 1.2, 0, 0);
      this.legR.rotation.set(-s * 0.65 - crouch * 1.2, 0, 0);
      this.chest.rotation.x = -crouch * 0.9;
      this.armL.rotation.x = -s * 0.55;
      this.armR.rotation.x = s * 0.55;
    }
    if (p.point) this.armR.rotation.set(-Math.PI / 2 - p.pitch, 0, 0.05);
    if (p.phone) {
      this.armR.rotation.set(-1.15, 0, 0.45);
      this.armL.rotation.set(-1.05, 0, -0.35);
    }
    this.head.rotation.set(Math.max(-0.6, Math.min(0.6, p.phone ? -0.5 : p.pitch)) - this.chest.rotation.x, 0, 0);
  }

  dispose() {
    this.setTag(null);
    for (const mat of this.mats) mat.dispose();
    this.faceTex.dispose();
  }
}
