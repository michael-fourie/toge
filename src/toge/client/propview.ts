// Draws the road's props: spinning mystery boxes (gone for a few seconds once taken), launch ramps, hay
// bales, barrels, cones that go flying when hit, oil slicks, and shield bubbles.

import * as THREE from 'three';
import { POWER } from '../shared/powerups.ts';
import { type Track, heightAt, newLoc, pointAt, locate, roadY } from '../shared/track.ts';

export interface Slick {
  x: number;
  y: number;
  z: number;
  born: number;
  /** Cars it has already spun (each car only once). */
  hit: Set<unknown>;
  mesh: THREE.Mesh;
}

export class PropView {
  readonly slicks: Slick[] = [];
  private group = new THREE.Group();
  private boxes = new Map<number, THREE.Mesh>();
  private boxBack = new Map<number, number>();
  private cones = new Map<number, { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; flying: boolean }>();
  private boxMat: THREE.MeshStandardMaterial;
  private slickGeo = new THREE.CircleGeometry(POWER.oilRadius + 0.3, 32);
  private slickTex = sheenTexture();
  private slickMat = new THREE.MeshStandardMaterial({ map: this.slickTex, emissive: 0xffffff, emissiveMap: this.slickTex, emissiveIntensity: 0.35, roughness: 0.04, metalness: 0.5, transparent: true, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  /** A glowing hazard ring round each slick, so you see it coming (at night too). */
  private ringGeo = new THREE.RingGeometry(POWER.oilRadius + 0.3, POWER.oilRadius + 0.7, 40);
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  private disposables: { dispose(): void }[] = [this.slickGeo, this.slickMat, this.slickTex, this.ringGeo, this.ringMat];

  constructor(
    scene: THREE.Scene,
    private track: Track,
  ) {
    scene.add(this.group);
    const keep = <T extends { dispose(): void }>(x: T) => (this.disposables.push(x), x);
    const qTex = keep(questionTexture());
    this.boxMat = keep(new THREE.MeshStandardMaterial({ map: qTex, emissive: 0xffffff, emissiveMap: qTex, emissiveIntensity: 0.6, transparent: true, opacity: 0.9, roughness: 0.2, metalness: 0.1 }));
    const boxGeo = keep(new THREE.BoxGeometry(1.1, 1.1, 1.1));
    const bale = keep(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 16));
    bale.rotateZ(Math.PI / 2);
    const baleMat = keep(new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 1, map: keep(strawTexture()) }));
    const barrel = keep(new THREE.CylinderGeometry(0.46, 0.46, 1.1, 16));
    const barrelMat = keep(new THREE.MeshStandardMaterial({ map: keep(bandTexture('#c0262d', '#f3f3f3')), roughness: 0.45, metalness: 0.4 }));
    const cone = keep(new THREE.ConeGeometry(0.28, 0.75, 14));
    const coneMat = keep(new THREE.MeshStandardMaterial({ map: keep(bandTexture('#ff6a13', '#ffffff')), roughness: 0.5 }));
    track.props.forEach((p, i) => {
      if (p.kind === 'box') {
        const m = new THREE.Mesh(boxGeo, this.boxMat);
        m.position.set(p.x, p.y + 1.1, p.z);
        m.castShadow = true;
        this.boxes.set(i, m);
        this.group.add(m);
      } else if (p.kind === 'bale' || p.kind === 'barrel') {
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
    const rampMat = keep(new THREE.MeshStandardMaterial({ map: keep(rampTexture()), roughness: 0.7, side: THREE.DoubleSide }));
    for (const r of track.ramps) this.group.add(rampMesh(track, r.s, r.d, r.len, r.w, keep, rampMat));
  }

  /** Time trial: no items, so no boxes. */
  clearBoxes() {
    for (const m of this.boxes.values()) m.removeFromParent();
    this.boxes.clear();
  }

  /** Takes box `i` if it's there (it comes back after a few seconds). */
  takeBox(i: number, now: number): boolean {
    const m = this.boxes.get(i);
    if (!m || !m.visible) return false;
    m.visible = false;
    this.boxBack.set(i, now + POWER.boxRespawn);
    return true;
  }

  /** Box i is (still) on the road? */
  hasBox(i: number): boolean {
    return !!this.boxes.get(i)?.visible;
  }

  /** Sends cone `i` flying off the car's nose. */
  knockCone(i: number, vx: number, vz: number) {
    const c = this.cones.get(i);
    if (!c || c.flying) return;
    c.flying = true;
    c.v.set(vx * 0.8 + (Math.random() - 0.5) * 3, 4 + Math.random() * 3, vz * 0.8 + (Math.random() - 0.5) * 3);
    c.spin.set(Math.random() * 12 - 6, Math.random() * 8, Math.random() * 12 - 6);
  }

  addSlick(x: number, y: number, z: number, now: number) {
    const mesh = new THREE.Mesh(this.slickGeo, this.slickMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.06, z);
    mesh.add(new THREE.Mesh(this.ringGeo, this.ringMat));
    this.group.add(mesh);
    this.slicks.push({ x, y, z, born: now, hit: new Set(), mesh });
  }

  update(now: number, dt: number) {
    for (const [i, m] of this.boxes) {
      const back = this.boxBack.get(i);
      if (back && now >= back) {
        m.visible = true;
        this.boxBack.delete(i);
      }
      m.rotation.set(now * 0.7 + i, now * 1.3 + i * 2, 0);
      m.position.y = this.track.props[i].y + 1.1 + Math.sin(now * 2 + i) * 0.12;
    }
    this.boxMat.emissive.setHSL((now * 0.15) % 1, 0.9, 0.55);
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
    for (let k = this.slicks.length - 1; k >= 0; k--) {
      const s = this.slicks[k];
      const age = now - s.born;
      if (age > POWER.oilSeconds) {
        this.group.remove(s.mesh);
        this.slicks.splice(k, 1);
      } else {
        s.mesh.scale.setScalar(Math.min(1, 0.3 + age * 3));
        s.mesh.rotation.z = age * 0.3;
      }
    }
    this.ringMat.opacity = 0.55 + 0.35 * Math.sin(now * 6);
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}

/** A translucent bubble that hugs a car while its shield is up. */
export function shieldBubble(length: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x59d8ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  m.scale.set(length * 0.42, length * 0.3, length * 0.62);
  m.visible = false;
  return m;
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

/** Oil: near-black with rainbow swirls (it's what catches the eye). */
function sheenTexture() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `hsla(${(i * 40) % 360}, 90%, 55%, 0.55)`;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(64 + Math.sin(i) * 14, 64 + Math.cos(i * 1.7) * 14, 12 + i * 6, i, i + 2.4);
      g.stroke();
    }
  });
}

function questionTexture() {
  return canvasTex(128, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#7fd6ff');
    grad.addColorStop(1, '#c58bff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#fff';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 116, 116);
    g.fillStyle = '#fff';
    g.font = 'bold 92px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', 64, 70);
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
