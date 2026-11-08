// Draws the road's props: launch ramps, hay bales, barrels, cones that go flying when hit, a hill climb's
// boulders and rocks (instanced: a few draw calls for the whole mountain), and the rainbow boost pads.

import * as THREE from 'three';
import { type Track, heightAt, newLoc, pointAt, locate, roadY } from '../shared/track.ts';
import { mulberry, stone } from './tracktextures.ts';

export class PropView {
  private group = new THREE.Group();
  private cones = new Map<number, { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; flying: boolean }>();
  /** The boost pads' rainbow, scrolled along the road every frame. */
  private padTex: THREE.CanvasTexture | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(
    scene: THREE.Scene,
    private track: Track,
  ) {
    scene.add(this.group);
    const keep = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x);
    const bale = keep(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 16));
    bale.rotateZ(Math.PI / 2);
    const baleMat = keep(new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 1, map: keep(strawTexture()) }));
    const barrel = keep(new THREE.CylinderGeometry(0.46, 0.46, 1.1, 16));
    const barrelMat = keep(new THREE.MeshStandardMaterial({ map: keep(bandTexture('#c0262d', '#f3f3f3')), roughness: 0.45, metalness: 0.4 }));
    const cone = keep(new THREE.ConeGeometry(0.28, 0.75, 14));
    const coneMat = keep(new THREE.MeshStandardMaterial({ map: keep(bandTexture('#ff6a13', '#ffffff')), roughness: 0.5 }));
    track.props.forEach((p, i) => {
      if (p.kind === 'bale' || p.kind === 'barrel') {
        const m = new THREE.Mesh(p.kind === 'bale' ? bale : barrel, p.kind === 'bale' ? baleMat : barrelMat);
        m.position.set(p.x, p.y + (p.kind === 'bale' ? 0.8 : 0.55), p.z);
        m.rotation.y = p.yaw;
        m.castShadow = m.receiveShadow = true;
        this.group.add(m);
      } else if (p.kind === 'cone') {
        const m = new THREE.Mesh(cone, coneMat);
        m.position.set(p.x, p.y + 0.37, p.z);
        m.castShadow = true;
        this.cones.set(i, { mesh: m, v: new THREE.Vector3(), spin: new THREE.Vector3(), flying: false });
        this.group.add(m);
      }
    });
    this.rockfall(track, keep);
    const rampMat = keep(new THREE.MeshStandardMaterial({ map: keep(rampTexture()), roughness: 0.7, side: THREE.DoubleSide }));
    for (const r of track.ramps) this.group.add(rampMesh(track, r.s, r.d, r.len, r.w, keep, rampMat));
    if (track.boosts.length) {
      this.padTex = keep(rainbowTexture());
      this.padTex.wrapT = THREE.RepeatWrapping;
      // Brighter than white so the bloom catches it at night; unlit, so it reads the same in any light.
      const padMat = keep(new THREE.MeshBasicMaterial({ map: this.padTex, color: new THREE.Color(1.6, 1.6, 1.6), polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
      const geo = keep(padsGeometry(track));
      this.group.add(new THREE.Mesh(geo, padMat));
    }
  }

  /**
   * Boulders and rocks: three lumpy stone shapes, each an InstancedMesh over every stone that uses it. A stone's
   * collision circle is its radius at road height, so the mesh is that wide there and sunk a little into the road.
   */
  private rockfall(track: Track, keep: <T extends { dispose(): void }>(x: T) => T) {
    const stones = track.props.filter((p) => p.kind === 'boulder' || p.kind === 'rock');
    if (!stones.length) return;
    const tex = stone(track.def.seed + 3);
    for (const t of Object.values(tex)) keep(t);
    tex.map.colorSpace = THREE.SRGBColorSpace;
    const mat = keep(new THREE.MeshStandardMaterial({ color: 0x9a948c, ...tex, roughness: 1, flatShading: true }));
    const shapes = [0, 1, 2].map((k) => keep(boulderGeometry(track.def.seed * 7 + k)));
    const lists: THREE.Matrix4[][] = [[], [], []];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    stones.forEach((p, i) => {
      const r = p.r;
      const tall = p.kind === 'boulder' ? 0.95 : 0.65;
      q.setFromEuler(e.set(0, p.yaw, 0));
      lists[i % 3].push(new THREE.Matrix4().compose(v.set(p.x, p.y + r * tall * 0.55, p.z), q, sc.set(r * 1.05, r * tall, r * 1.05)));
    });
    lists.forEach((list, k) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(shapes[k], mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  /** Sends cone `i` flying off the car's nose. */
  knockCone(i: number, vx: number, vz: number) {
    const c = this.cones.get(i);
    if (!c || c.flying) return;
    c.flying = true;
    c.v.set(vx * 0.8 + (Math.random() - 0.5) * 3, 4 + Math.random() * 3, vz * 0.8 + (Math.random() - 0.5) * 3);
    c.spin.set(Math.random() * 12 - 6, Math.random() * 8, Math.random() * 12 - 6);
  }

  update(now: number, dt: number) {
    // The chevrons run forward along the pad.
    if (this.padTex) this.padTex.offset.y = 1 - ((now * 1.6) % 1);
    for (const c of this.cones.values()) {
      if (!c.flying) continue;
      c.v.y -= 9.81 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const g = heightAt(this.track, c.mesh.position.x, c.mesh.position.z) + 0.2;
      if (c.mesh.position.y < g) {
        c.mesh.position.y = g;
        c.v.multiplyScalar(0.4);
        c.v.y = Math.abs(c.v.y) * 0.3;
        c.spin.multiplyScalar(0.5);
        if (c.v.lengthSq() < 0.2) c.v.set(0, 0, 0);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}

/** Every boost pad as one flat mesh just above the road, following its bends and banking. */
function padsGeometry(t: Track): THREE.BufferGeometry {
  const loc = newLoc();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const STEPS = 7;
  for (const pad of t.boosts) {
    const base = pos.length / 3;
    for (let k = 0; k <= STEPS; k++) {
      const u = k / STEPS;
      for (const side of [-1, 1]) {
        const p = pointAt(t, pad.s + u * pad.len, pad.d + (side * pad.w) / 2);
        locate(t, p.x, p.z, p.i, loc);
        pos.push(p.x, roadY(t, loc) + 0.03, p.z);
        uv.push(side < 0 ? 0 : 1, u * 2);
      }
    }
    for (let k = 0; k < STEPS; k++) {
      const a = base + k * 2;
      // Wound to face up (left to right across the road, then forward).
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The wedge of a launch ramp, following the road (its top is the ground the wheels see). */
function rampMesh(t: Track, s: number, d: number, len: number, w: number, keep: <T extends { dispose(): void }>(x: T) => T, mat: THREE.Material): THREE.Mesh {
  const loc = newLoc();
  const pt = (u: number, side: number, top: boolean) => {
    const p = pointAt(t, s + u, d + side * (w / 2));
    locate(t, p.x, p.z, p.i, loc);
    const base = roadY(t, loc);
    return [p.x, top ? heightAt(t, p.x, p.z) : base, p.z];
  };
  const eps = 0.01;
  const a0 = pt(eps, -1, false);
  const b0 = pt(eps, 1, false);
  const a1 = pt(len - eps, -1, true);
  const b1 = pt(len - eps, 1, true);
  const a1b = pt(len - eps, -1, false);
  const b1b = pt(len - eps, 1, false);
  const pos = [...a0, ...b0, ...a1, ...b1, ...a1b, ...b1b];
  const uv = [0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1];
  // top, back face, two sides
  const idx = [0, 1, 2, 2, 1, 3, 4, 2, 5, 5, 2, 3, 0, 2, 4, 1, 5, 3];
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.02;
  m.castShadow = m.receiveShadow = true;
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A boost pad: rainbow bands across it under white chevrons pointing up the road (v runs forward). */
function rainbowTexture() {
  return canvasTex(64, 128, (g) => {
    for (let i = 0; i < 128; i++) {
      g.fillStyle = `hsl(${(i / 128) * 360}, 95%, 58%)`;
      g.fillRect(0, i, 64, 1);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 9;
    g.lineJoin = 'miter';
    for (const y of [40, 104]) {
      g.beginPath();
      g.moveTo(8, y);
      g.lineTo(32, y - 22);
      g.lineTo(56, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, 4, 128);
    g.fillRect(60, 0, 4, 128);
  });
}

function bandTexture(main: string, band: string) {
  return canvasTex(8, 64, (g) => {
    g.fillStyle = main;
    g.fillRect(0, 0, 8, 64);
    g.fillStyle = band;
    g.fillRect(0, 22, 8, 10);
    g.fillRect(0, 42, 8, 6);
  });
}

function strawTexture() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#d9b45a';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(120,90,30,0.4)' : 'rgba(255,240,170,0.4)';
      g.beginPath();
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      g.moveTo(x, y);
      g.lineTo(x + Math.random() * 10 - 5, y + Math.random() * 3);
      g.stroke();
    }
  });
}

function rampTexture() {
  return canvasTex(64, 64, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#1b1b1b' : '#ffc21a';
      g.fillRect(0, i * 8, 64, 8);
    }
  });
}

/** A lumpy stone about 1 m in radius, flat underneath: a subdivided icosahedron pushed about by seeded noise. */
function boulderGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute('position');
  // A few random bulges and flat faces, shared by every vertex that sits at the same point.
  const lumps = Array.from({ length: 7 }, () => {
    const d = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    return { d, k: (rnd() - 0.4) * 0.45 };
  });
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let r = 1;
    for (const l of lumps) r += l.k * Math.max(0, n.dot(l.d)) ** 3;
    const y = Math.max(-0.75, n.y * r);
    p.setXYZ(i, n.x * r, y, n.z * r);
  }
  g.computeVertexNormals();
  return g;
}
