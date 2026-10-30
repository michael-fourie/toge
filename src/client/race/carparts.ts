// Car parts shared by every model: materials, the procedural textures (tyre lettering, drilled discs,
// carbon weave, plates, underglow), wheels, and merging a model's meshes by material so a car costs a
// couple of dozen draw calls instead of a hundred.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type BaseCar, type Look, PAINTS, RIM_COLORS } from '../../shared/race/cars.ts';

export const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true, height = size): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Twill carbon weave. */
const carbonTex = canvasTexture(64, (g, s) => {
  g.fillStyle = '#121316';
  g.fillRect(0, 0, s, s);
  const q = s / 8;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const along = (x + y) % 4 < 2;
      const grad = along ? g.createLinearGradient(x * q, 0, x * q + q, 0) : g.createLinearGradient(0, y * q, 0, y * q + q);
      grad.addColorStop(0, '#1b1d22');
      grad.addColorStop(0.5, '#34373f');
      grad.addColorStop(1, '#1b1d22');
      g.fillStyle = grad;
      g.fillRect(x * q + 0.5, y * q + 0.5, q - 1, q - 1);
    }
});
carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
carbonTex.repeat.set(6, 6);

/** White lettering round a tyre's sidewall (a RingGeometry's planar UVs map this square onto it). */
const sidewallTex = canvasTexture(512, (g, s) => {
  g.translate(s / 2, s / 2);
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [text, at] of [['TŌGE', -Math.PI / 2], ['TŌGE', Math.PI / 2], ['R-SPEC', 0], ['R-SPEC', Math.PI]] as const) {
    const step = 0.085;
    for (let i = 0; i < text.length; i++) {
      const a = at + (i - (text.length - 1) / 2) * step;
      g.save();
      g.rotate(a);
      g.translate(0, -s * 0.425);
      g.fillText(text[i], 0, 0);
      g.restore();
    }
  }
});

/** A cross-drilled, slotted brake disc face, with its dark centre hat. */
const discTex = canvasTexture(256, (g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, '#2a2b2e');
  grad.addColorStop(0.42, '#2a2b2e');
  grad.addColorStop(0.44, '#9a9da3');
  grad.addColorStop(1, '#7d8086');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#1a1b1d';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const r of [0.58, 0.72, 0.86]) {
      g.beginPath();
      g.arc(c + Math.cos(a + r) * c * r, c + Math.sin(a + r) * c * r, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }
});

/** Soft rounded-rectangle glow for the underglow, and the contact shadow. */
function softRect(inner: number): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = Math.max(0, Math.abs(x - s / 2 + 0.5) / (s / 2) - inner) / (1 - inner);
        const dy = Math.max(0, Math.abs(y - s / 2 + 0.5) / (s / 2) - inner) / (1 - inner);
        const a = Math.max(0, 1 - Math.hypot(dx, dy));
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * a * 255);
      }
    g.putImageData(img, 0, 0);
  }, false);
}
const glowTex = softRect(0.55);
const blobTex = softRect(0.35);

const plates = new Map<string, THREE.CanvasTexture>();
function plateTex(text: string): THREE.CanvasTexture {
  let t = plates.get(text);
  if (!t) {
    t = canvasTexture(
      256,
      (g, s) => {
        const h = 80;
        g.fillStyle = '#f4f1e8';
        g.fillRect(0, 0, s, h);
        g.strokeStyle = '#1b1d22';
        g.lineWidth = 6;
        g.strokeRect(4, 4, s - 8, h - 8);
        g.fillStyle = '#1b1d22';
        g.font = 'bold 50px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, s / 2, h / 2 + 2, s - 30);
      },
      true,
      80,
    );
    plates.set(text, t);
  }
  return t;
}

/** Materials every car shares (never disposed with a car). */
export const MAT = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0d1218, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6, metalness: 0.15 }),
  gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090b, roughness: 0.15, metalness: 0.3, clearcoat: 1 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.08, metalness: 1 }),
  alloy: new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.3, metalness: 1 }),
  carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: carbonTex, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
  grille: new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.85 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }),
  sidewall: new THREE.MeshStandardMaterial({ map: sidewallTex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  disc: new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.35, metalness: 0.85 }),
  caliper: new THREE.MeshStandardMaterial({ color: 0xd4211b, roughness: 0.35, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.2, roughness: 0.1 }),
  drl: new THREE.MeshBasicMaterial({ color: 0xe9f6ff }),
  amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.9, roughness: 0.2 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x9aa5b1, metalness: 1, roughness: 0.05, clearcoat: 1 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.95 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.5 }),
  pink: new THREE.MeshStandardMaterial({ color: 0xff7eb6, roughness: 0.35, emissive: 0xff3d8f, emissiveIntensity: 0.25 }),
  blob: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, depthWrite: false, opacity: 0.8 }),
};
const SHARED = new Set<THREE.Material>(Object.values(MAT));
export const isShared = (m: THREE.Material) => SHARED.has(m);

export function paintMaterial(look: Look, color = PAINTS[look.paint]): THREE.MeshPhysicalMaterial {
  const f = look.finish;
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
  if (f === 1) {
    m.metalness = 0.7;
    m.roughness = 0.32;
  } else if (f === 2) {
    m.metalness = 0.15;
    m.roughness = 0.7;
    m.clearcoat = 0;
  } else if (f === 3) {
    m.metalness = 0.4;
    m.roughness = 0.26;
    m.iridescence = 0.8;
    m.iridescenceIOR = 1.6;
    m.iridescenceThicknessRange = [250, 700];
    m.sheen = 0.6;
    m.sheenColor = new THREE.Color(0xffffff);
  }
  return m;
}

/**
 * Stripes as a paint texture: u runs nose to tail, v round the section (0.5 = the top centre), so the
 * twin stripes run over hood, roof and deck, and the side stripe down each flank.
 */
export function stripeTexture(look: Look): THREE.CanvasTexture {
  const base = '#' + PAINTS[look.paint].toString(16).padStart(6, '0');
  const ink = '#' + PAINTS[look.stripeColor].toString(16).padStart(6, '0');
  return canvasTexture(512, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    g.fillStyle = ink;
    if (look.stripe === 1) {
      for (const v of [0.5 - 0.046, 0.5 + 0.018]) g.fillRect(0, v * s, s, 0.028 * s);
    } else {
      for (const v of [0.215, 0.785 - 0.024]) {
        g.fillRect(0.1 * s, v * s, 0.8 * s, 0.024 * s);
        g.fillRect(0.1 * s, (v + 0.034) * s, 0.8 * s, 0.006 * s);
      }
    }
  });
}

export function plateMaterial(text: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: plateTex(text), roughness: 0.4, metalness: 0.1 });
}

export function glowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, alphaMap: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

/** A wheel: `spin` turns with the road, `fixed` (the caliper) steers but doesn't spin. The rim's face is +X. */
export function wheel(b: BaseCar, look: Look): { spin: THREE.Group; fixed: THREE.Group } {
  const R = b.radius;
  const w = 0.2 + b.width * 0.03;
  const fixed = new THREE.Group();
  const spin = new THREE.Group();
  fixed.add(spin);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = spin) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const rimR = R * 0.7;
  const face = w / 2 - 0.015;
  // Tyre: a lathed profile, square-shouldered with a little sidewall bulge.
  const pts: THREE.Vector2[] = [new THREE.Vector2(rimR - 0.005, -w / 2 + 0.012)];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI;
    const bulge = Math.sin(a) * 0.012;
    pts.push(new THREE.Vector2(R - 0.03 + Math.sin(a) * 0.03, -w / 2 - bulge + (1 - Math.cos(a)) * (w / 2 + bulge)));
  }
  pts.push(new THREE.Vector2(rimR - 0.005, w / 2 - 0.012));
  add(new THREE.LatheGeometry(pts, 36), MAT.tyre).rotation.z = Math.PI / 2;
  const wall = add(new THREE.RingGeometry(rimR + 0.012, R - 0.012, 48), MAT.sidewall);
  wall.rotation.y = Math.PI / 2;
  wall.position.x = w / 2 + 0.006;

  const rimMat = new THREE.MeshPhysicalMaterial({ color: RIM_COLORS[look.rimColor], metalness: 0.9, roughness: 0.22, clearcoat: 0.6 });
  const barrel = add(new THREE.CylinderGeometry(rimR, rimR, w - 0.03, 32, 1, true), MAT.alloy);
  barrel.rotation.z = Math.PI / 2;
  const style = look.rims;
  const lipMat = style === 1 || style === 3 ? MAT.chrome : rimMat;
  const lip = add(new THREE.TorusGeometry(rimR - 0.008, style === 3 ? 0.022 : 0.014, 6, 32), lipMat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = face;
  const sx = face - (style === 3 ? 0.075 : 0.02); // where the spokes sit; deep dish sets them well back
  if (style === 3) {
    // The dish: a polished cone from the lip in to the spokes.
    const dish = add(new THREE.CylinderGeometry(rimR - 0.01, rimR * 0.88, face - sx, 32, 1, true), MAT.chrome);
    dish.rotation.z = -Math.PI / 2;
    dish.position.x = (face + sx) / 2;
  }
  /** A spoke on the face from the hub (radius r0, angle a0) out to the rim (r1, a1). */
  const spoke = (a0: number, a1: number, wid: number, mat: THREE.Material = rimMat, depth = 0.03, twist = 0, r0 = rimR * 0.2, r1 = rimR * 0.97) => {
    const y0 = Math.cos(a0) * r0;
    const z0 = Math.sin(a0) * r0;
    const y1 = Math.cos(a1) * r1;
    const z1 = Math.sin(a1) * r1;
    const len = Math.hypot(y1 - y0, z1 - z0);
    const m = add(new THREE.BoxGeometry(depth, len, wid), mat);
    m.position.set(sx, (y0 + y1) / 2, (z0 + z1) / 2);
    m.rotation.set(Math.atan2(z1 - z0, y1 - y0), twist, 0, 'XYZ');
    return m;
  };
  if (style === 0) {
    // Five split spokes.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      for (const off of [-0.13, 0.13]) spoke(a + off * 0.3, a + off, 0.03);
    }
  } else if (style === 1) {
    // Mesh: two crossing sets of thin spokes and a ring of bolts round the lip.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spoke(a, a + 0.42, 0.014, rimMat, 0.02);
      spoke(a, a - 0.42, 0.014, rimMat, 0.02);
    }
    const bolt = new THREE.SphereGeometry(0.008, 4, 3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = add(bolt, MAT.chrome);
      m.position.set(face + 0.01, Math.cos(a) * (rimR - 0.03), Math.sin(a) * (rimR - 0.03));
    }
  } else if (style === 2) {
    // Turbofan: a dished plate with angled vanes.
    const plate = add(new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, 0.012, 36), MAT.trim);
    plate.rotation.z = Math.PI / 2;
    plate.position.x = sx - 0.015;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      spoke(a, a + 0.3, 0.05, rimMat, 0.02, 0.6, rimR * 0.3);
    }
  } else {
    // Deep dish: six fat spokes deep in the barrel.
    for (let i = 0; i < 6; i++) spoke((i / 6) * Math.PI * 2, (i / 6) * Math.PI * 2, 0.055);
  }
  // Centre lock: a hub cap and a hex nut.
  const hub = add(new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.26, 0.05, 20), rimMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = sx + 0.01;
  const nut = add(new THREE.CylinderGeometry(rimR * 0.1, rimR * 0.1, 0.04, 6), style === 2 ? MAT.red : MAT.chrome);
  nut.rotation.z = Math.PI / 2;
  nut.position.x = sx + 0.04;
  // Drilled disc spins; the caliper is fixed.
  const disc = add(new THREE.CylinderGeometry(rimR * 0.86, rimR * 0.86, 0.028, 32), MAT.disc);
  disc.rotation.z = -Math.PI / 2;
  disc.position.x = sx - 0.06;
  const caliper = add(rbox(0.07, rimR * 0.62, 0.17, 0.02), MAT.caliper, fixed);
  caliper.position.set(sx - 0.045, rimR * 0.5, -rimR * 0.22);
  caliper.rotation.x = -0.4;
  return { spin, fixed };
}

/**
 * Merges every mesh under `root` (baked into root space) into one mesh per material. Groups named
 * in `keep` are left alone, since they move on their own (the wheels).
 */
export function mergeByMaterial(root: THREE.Object3D, keep: Set<THREE.Object3D> = new Set()): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (keep.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && m.userData.solo !== true) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      g.clearGroups();
      const list = byMat.get(m.material) ?? [];
      list.push(g);
      byMat.set(m.material, list);
      victims.push(m);
    }
    for (const c of [...o.children]) walk(c);
  };
  walk(root);
  for (const m of victims) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  const out: THREE.Mesh[] = [];
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !(mat as THREE.MeshBasicMaterial).transparent;
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}
