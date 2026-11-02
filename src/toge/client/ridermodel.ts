// Your driver as a 3D figure: a stylised street racer built from a few dozen primitives (no assets, no licences),
// posed and dressed from a Rider (toge/shared/rider.ts). Faces +Z with the feet at y = 0.
//
// Cheap on purpose: geometries and materials are cached per shape and colour for the whole page (a rider only picks
// from fixed lists, so the caches stay small and nothing needs disposing), and a rider is ~70 small meshes with a
// breathing idle in update(). The showroom shows one; lobby portraits (riderportrait.ts) render them one at a time.

import * as THREE from 'three';
import { type Rider, riderColor } from '../shared/rider.ts';

export interface RiderModel {
  root: THREE.Group;
  /** Standing height (m), for framing. */
  height: number;
  /** Height of the hip joint above the feet (m), where a seated rider sits on the saddle. */
  hipY: number;
  /** Idle motion: breathing, a little sway, a look around. `t` in seconds. */
  update(t: number): void;
  dispose(): void;
}

// --- shared caches ---------------------------------------------------------------------------------

const geos = new Map<string, THREE.BufferGeometry>();
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g;
};
const r3 = (x: number) => Math.round(x * 1000);
const SPHERE = () => geo('sphere', () => new THREE.SphereGeometry(1, 18, 12));
const LOWSPHERE = () => geo('lowsphere', () => new THREE.SphereGeometry(1, 10, 7));
/** A capsule of radius r whose straight part is len long, along Y and centred. */
const CAPSULE = (r: number, len: number) => geo(`cap${r3(r)}:${r3(len)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 12));
const CYL = (rt: number, rb: number, h: number, open = false) => geo(`cyl${r3(rt)}:${r3(rb)}:${r3(h)}:${open}`, () => new THREE.CylinderGeometry(rt, rb, h, 18, 1, open));
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CONE = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 10));
const TORUS = (tube: number) => geo(`torus${r3(tube)}`, () => new THREE.TorusGeometry(1, tube, 8, 28));
/** Part of a unit sphere (three's phi/theta ranges), for hair caps, hats and masks. */
const SHELL = (name: string, phiStart: number, phiLength: number, thetaStart: number, thetaLength: number) =>
  geo(`shell:${name}`, () => new THREE.SphereGeometry(1, 20, 12, phiStart, phiLength, thetaStart, thetaLength));
/** A half disc pointing +Z (a cap's brim). */
const BRIM = () => geo('brim', () => new THREE.CylinderGeometry(1, 1, 1, 20, 1, false, -Math.PI / 2, Math.PI));

/** The riding pose's joint angles (rad): torso lean, thighs forward, shins back to the pegs, arms to the bars. */
const RIDE = { lean: 0.95, thigh: -1.45, knees: 0.32, shin: 2.05, arm: -1.95, elbow: -0.2 };

const mats = new Map<string, THREE.Material>();
function mat(color: number, rough = 0.85, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, tag = ''): THREE.MeshStandardMaterial {
  const key = `${color}:${rough}:${metal}:${tag}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    mats.set(key, m);
  }
  return m;
}

const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** The back print: a kanji in a ring, drawn once per emblem and colour. */
const EMBLEM_GLYPHS = ['', '峠', '走', '風', '夜', '雷', '龍', '鬼'];
function emblemMat(emblem: number, color: number, ring: number): THREE.Material {
  const key = `emblem:${emblem}:${color}:${ring}`;
  let m = mats.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const css = (n: number) => '#' + n.toString(16).padStart(6, '0');
  g.strokeStyle = css(ring);
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 98, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = css(color);
  g.font = `900 150px 'Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif JP', 'Noto Serif CJK JP', 'Noto Sans JP', 'Noto Sans CJK JP', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(EMBLEM_GLYPHS[emblem] ?? '', 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  mats.set(key, m);
  return m;
}

// --- the figure --------------------------------------------------------------------------------------

const BUILD = [0.88, 1, 1.16];
const HEIGHT = [0.94, 1, 1.06];

/**
 * `ride`: on a motorbike instead of standing: tucked forward over the tank, knees out, feet back on the pegs and
 * hands forward on the clip-ons (bikemodel.ts places it on the saddle). The chosen stance pose is ignored.
 */
export function buildRider(r: Rider, opts: { ride?: boolean } = {}): RiderModel {
  const root = new THREE.Group();
  root.name = 'rider';
  const k = HEIGHT[r.height] ?? 1;
  const b = BUILD[r.build] ?? 1;
  const body = new THREE.Group(); // everything, scaled to the height
  body.scale.setScalar(k);
  root.add(body);

  const skinC = riderColor(r, 'skin');
  const hairC = riderColor(r, 'hairColor');
  const topC = riderColor(r, 'topColor');
  const accC = riderColor(r, 'accent');
  const botC = r.top === 7 ? topC : riderColor(r, 'bottomColor'); // coveralls are one piece
  const shoeC = riderColor(r, 'shoeColor');
  const skin = mat(skinC, 0.62, 0, {}, 'skin');
  const hair = mat(hairC, 0.55, 0.05, {}, 'hair');
  const top = mat(topC, r.top === 2 ? 0.45 : 0.85, 0, {}, r.top === 2 ? 'satin' : ''); // the souvenir jacket is satin
  const acc = mat(accC, 0.75);
  const bot = mat(botC, 0.9);
  const shoe = mat(shoeC, 0.6);
  const sole = mat(0xeeeeea, 0.8);
  const dark = mat(0x16110f, 0.45);
  const gold = mat(0xe9c46a, 0.25, 1);
  const glove = r.gloves ? mat(0x1b1b1f, 0.5, 0, {}, 'leather') : skin;

  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number] = [0, 0, 0], s: [number, number, number] | number = 1, rot?: [number, number, number]) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...p);
    if (typeof s === 'number') mesh.scale.setScalar(s);
    else mesh.scale.set(...s);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const group = (parent: THREE.Object3D, p: [number, number, number]) => {
    const gr = new THREE.Group();
    gr.position.set(...p);
    parent.add(gr);
    return gr;
  };

  // Proportions (m, for a 1.75 m driver before the height scale).
  const HIP_Y = 0.92;
  const KNEE_Y = 0.5;
  const SHOULDER_Y = 1.4;
  const HEAD_Y = 1.64;
  const sx = 0.2 * b;

  const hips = group(body, [0, HIP_Y, 0]);
  const torso = group(hips, [0, 0, 0]);

  // --- legs ----------------------------------------------------------------------------------------
  const legW = [1.18, 0.95, 1.05, 1.42, 1.15][r.bottom] ?? 1;
  const shorts = r.bottom === 4 && r.top !== 7;
  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const thigh = group(hips, [s * 0.095 * b, 0, 0]);
    const tl = HIP_Y - KNEE_Y;
    const tr = 0.075 * Math.sqrt(b) * legW;
    if (shorts) {
      add(thigh, CAPSULE(tr, tl * 0.45), bot, [0, -tl * 0.3, 0]);
      add(thigh, CAPSULE(0.062 * Math.sqrt(b), tl * 0.7), skin, [0, -tl * 0.6, 0]);
    } else add(thigh, CAPSULE(tr, tl - tr), bot, [0, -tl / 2, 0]);
    const shin = group(thigh, [0, -tl, 0]);
    const sl = KNEE_Y - 0.08;
    const srad = (shorts ? 0.055 : 0.064 * legW) * Math.sqrt(b);
    add(shin, CAPSULE(srad, sl - srad), shorts ? skin : bot, [0, -sl / 2, 0]);
    if (r.bottom === 0 && !shorts) add(thigh, BOX(), bot, [s * tr * 0.95, -tl * 0.55, 0.01], [0.03, 0.1, 0.09]); // cargo pockets
    if (r.bottom === 2) {
      // Track pants: a white stripe down the outside.
      add(thigh, BOX(), sole, [s * tr * 0.97, -tl / 2, 0], [0.012, tl, 0.025]);
      add(shin, BOX(), sole, [s * srad * 0.97, -sl / 2, 0], [0.012, sl, 0.025]);
    }
    // Shoes
    const foot = group(shin, [0, -sl, 0]);
    const shoeStyle = r.shoes;
    const low = shoeStyle === 3;
    add(foot, CAPSULE(low ? 0.045 : 0.055, 0.17), shoe, [0, -0.03, 0.06], [1.05, low ? 0.85 : 1, 1], [Math.PI / 2, 0, 0]);
    add(foot, BOX(), shoeStyle === 2 ? dark : sole, [0, -0.072, 0.06], [0.1, low ? 0.015 : 0.028, 0.27]);
    if (shoeStyle === 1) add(foot, CYL(0.062, 0.066, 0.12), shoe, [0, 0.04, 0]);
    if (shoeStyle === 2) add(foot, CYL(0.07, 0.072, 0.2), shoe, [0, 0.07, -0.005]);
    if (shoeStyle === 0 || shoeStyle === 1) add(foot, BOX(), sole, [s * 0.052, -0.02, 0.06], [0.006, 0.02, 0.12]); // a side swoosh-free stripe
    if (r.bottom === 3 && !shorts) add(shin, CYL(srad * 1.15, srad * 1.25, 0.09, true), bot, [0, -sl + 0.06, 0]); // wide pants pool at the ankle
    legs.push(thigh);
    shins.push(shin);
  }

  // --- torso ---------------------------------------------------------------------------------------
  const puff = r.top === 4 ? 1.08 : r.top === 1 ? 1.05 : 1;
  add(hips, SPHERE(), bot, [0, 0.04, 0], [0.17 * b, 0.11, 0.115]);
  const chestZ = 0.118 * puff * Math.sqrt(b);
  const chest = add(torso, SPHERE(), top, [0, 0.34, 0], [0.185 * b * puff, 0.2, chestZ]);
  // The shoulder line: a bar between the shoulders gives the V.
  add(torso, CAPSULE(0.075 * puff * Math.sqrt(b), sx * 1.5), top, [0, 0.47, -0.01], [1, 1, 0.95], [0, 0, Math.PI / 2]);
  add(torso, SPHERE(), top, [0, 0.13, 0], [0.155 * b * puff, 0.17, 0.105 * puff * Math.sqrt(b)]);
  const jacket = r.top >= 2 && r.top !== 7;
  if (r.top === 7) add(torso, TORUS(0.18), acc, [0, 0.05, 0], [0.175 * b, 0.115 * Math.sqrt(b), 0.12], [Math.PI / 2, 0, 0]); // coveralls belt
  if (jacket) {
    // Hem band, zip or snaps, collar.
    const hemC = r.top === 2 || r.top === 4 ? acc : top;
    add(torso, CYL(0.18 * b * puff, 0.178 * b * puff, 0.05), hemC, [0, 0.0, 0], [1, 1, (0.125 * puff * Math.sqrt(b)) / (0.18 * b * puff)]);
    add(torso, BOX(), r.top === 6 ? top : acc, [0, 0.27, chestZ * 0.97], [0.012, 0.42, 0.01]);
    if (r.top === 6) for (let i = 0; i < 4; i++) add(torso, LOWSPHERE(), acc, [0, 0.12 + i * 0.1, chestZ * 0.99], 0.009);
  }
  if (r.top === 3) {
    // Racing jacket: shoulder panels and two chest stripes.
    for (const s of [1, -1]) add(torso, SPHERE(), acc, [s * sx * 0.82, 0.46, 0], [0.075 * b, 0.06, 0.1]);
    add(torso, BOX(), acc, [0, 0.36, chestZ * 0.93], [0.36 * b, 0.025, 0.02]);
    add(torso, BOX(), acc, [0, 0.31, chestZ * 0.95], [0.34 * b, 0.012, 0.02]);
  }
  if (r.top === 5) {
    // The long coat: a skirt to the knee, a tall stand collar, a sash.
    add(torso, CYL(0.19 * b, 0.25 * b, 0.55, true), mat(topC, 0.85, 0, { side: THREE.DoubleSide }, 'twosided'), [0, -0.25, 0], [1, 1, 0.7]);
    add(torso, TORUS(0.22), acc, [0, 0.03, 0], [0.185 * b, 0.125 * Math.sqrt(b), 0.12], [Math.PI / 2, 0, 0]);
  }
  if (r.top === 1) {
    // Hoodie: the hood behind the neck, drawstrings, a front pocket.
    add(torso, SPHERE(), top, [0, 0.5, -0.08], [0.13 * b, 0.08, 0.09]);
    for (const s of [1, -1]) add(torso, CYL(0.005, 0.005, 0.13), sole, [s * 0.035, 0.42, chestZ * 0.92]);
    add(torso, BOX(), top, [0, 0.14, 0.105 * puff], [0.2 * b, 0.1, 0.03]);
  }
  if (r.top === 7) add(torso, BOX(), sole, [0.08 * b, 0.4, chestZ * 0.92], [0.07, 0.035, 0.01]); // name patch
  // Collar
  const collarH = r.top === 5 ? 0.11 : r.top === 3 ? 0.07 : jacket ? 0.05 : 0.025;
  add(torso, CYL(0.062, 0.075, collarH, true), r.top === 2 || r.top === 4 || r.top === 5 ? acc : top, [0, 0.555 + collarH / 2 - 0.02, -0.005]);
  // The back print, and a small one on the chest of a jacket.
  if (r.emblem) {
    const em = emblemMat(r.emblem, riderColor(r, 'emblemColor'), accC === riderColor(r, 'emblemColor') ? 0xe8e6e0 : accC);
    const plane = geo('plane', () => new THREE.PlaneGeometry(1, 1));
    add(torso, plane, em, [0, 0.32, -chestZ * 0.97 - 0.004], [0.27 * b, 0.27 * b, 1], [0, Math.PI, 0]).castShadow = false;
    if (jacket) add(torso, plane, em, [-0.085 * b, 0.4, chestZ * 0.93], [0.07, 0.07, 1], [-0.25, -0.35, 0]).castShadow = false;
  }

  // --- neck and head ---------------------------------------------------------------------------------
  add(torso, CYL(0.043, 0.048, 0.14), skin, [0, 0.6, 0]);
  const head = group(torso, [0, HEAD_Y - HIP_Y, 0.008]);
  const HX = 0.108;
  const HY = 0.128;
  const HZ = 0.116;
  add(head, SPHERE(), skin, [0, 0, 0], [HX, HY, HZ]);
  head.scale.setScalar(1.08); // a touch big, for the look
  for (const s of [1, -1]) add(head, LOWSPHERE(), skin, [s * HX * 0.98, -0.005, -0.005], [0.016, 0.03, 0.022]);
  add(head, LOWSPHERE(), mat(mix(skinC, 0x000000, 0.08), 0.6), [0, -0.022, HZ * 0.98], [0.014, 0.02, 0.016]);
  add(head, BOX(), mat(mix(skinC, 0x5a1a14, 0.55), 0.6), [0, -0.066, HZ * 0.84], [0.034, 0.006, 0.006]);
  // Eyes and brows
  const eyeShape: [number, number, number][] = [
    [0.013, 0.016, 0],
    [0.018, 0.008, 0.2],
    [0.016, 0.006, -0.05],
    [0.015, 0.02, 0],
  ];
  const [ew, eh, etilt] = eyeShape[r.eyes] ?? eyeShape[0];
  const browC = mat(mix(hairC, 0x000000, 0.35), 0.7);
  for (const s of [1, -1]) {
    add(head, LOWSPHERE(), dark, [s * 0.038, 0.008 - (r.eyes === 2 ? 0.004 : 0), HZ * 0.9], [ew, eh, 0.006], [0, 0, s * etilt]);
    if (r.eyes === 3 || r.eyes === 0) add(head, LOWSPHERE(), sole, [s * 0.038 + 0.004, 0.014, HZ * 0.94], 0.0035);
    const tilt = [s * 0.12, 0, -s * 0.35, -s * 0.15][r.brows] ?? 0;
    add(head, BOX(), browC, [s * 0.039, 0.04 - (r.brows === 3 ? 0.006 : 0), HZ * 0.9], [r.brows === 3 ? 0.026 : 0.034, r.brows === 3 ? 0.009 : 0.007, 0.01], [0, 0, tilt]);
  }
  // Facial hair
  const fur = mat(mix(hairC, skinC, 0.15), 0.8);
  if (r.facial === 1) add(head, SHELL('stubble', Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.58, Math.PI * 0.3), mat(mix(skinC, hairC, 0.35), 0.9), [0, -0.01, 0.006], [HX * 1.012, HY * 1.012, HZ * 1.012]);
  if (r.facial === 2) add(head, SPHERE(), fur, [0, -0.1, 0.08], [0.022, 0.026, 0.018]);
  if (r.facial === 3) add(head, BOX(), fur, [0, -0.048, HZ * 0.92], [0.05, 0.01, 0.012], [0, 0, 0]);

  // Hair
  const covered = r.headwear >= 3; // caps, beanie, bucket hat sit over the top of the head
  const capTop = SHELL('capTop', 0, Math.PI * 2, 0, Math.PI * 0.42);
  const capBack = SHELL('capBack', Math.PI, Math.PI, 0, Math.PI * 0.68);
  const shell = SHELL('shell', Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.8);
  const hairCap = (s = 1.04, keep = false) => {
    if (covered && !keep) return;
    add(head, capTop, hair, [0, 0.004, 0], [HX * s, HY * s, HZ * s]);
    add(head, capBack, hair, [0, 0.004, -0.002], [HX * s, HY * s, HZ * s]);
  };
  const H = hairC;
  switch (r.hair) {
    case 0: // buzz
      add(head, capTop, mat(mix(H, skinC, 0.3), 0.9), [0, 0, 0], [HX * 1.01, HY * 1.01, HZ * 1.01]);
      add(head, capBack, mat(mix(H, skinC, 0.3), 0.9), [0, 0, 0], [HX * 1.01, HY * 1.01, HZ * 1.01]);
      break;
    case 1: // spiky
      hairCap(1.05);
      if (!covered)
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2;
          const ring = i % 2 ? 0.55 : 0.85;
          const d = new THREE.Vector3(Math.sin(a) * ring, 1.1, Math.cos(a) * ring * 0.9 - 0.15).normalize();
          const sp = add(head, CONE(), hair, [d.x * HX * 0.9, d.y * HY * 0.82, d.z * HZ * 0.9], [0.032, 0.11, 0.032]);
          sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        }
      break;
    case 2: // undercut: short sides, a long top swept over
      add(head, capBack, mat(mix(H, skinC, 0.35), 0.9), [0, 0, 0], [HX * 1.01, HY * 1.01, HZ * 1.01]);
      if (!covered) {
        add(head, SPHERE(), hair, [0.012, 0.085, 0.012], [0.098, 0.055, 0.118], [0, 0, -0.18]);
        add(head, SPHERE(), hair, [0.045, 0.065, 0.08], [0.06, 0.03, 0.05], [0.3, 0, -0.5]);
      }
      break;
    case 3: // pompadour: tall and forward, the yankī classic
      hairCap(1.04);
      if (!covered) {
        add(head, SPHERE(), hair, [0, 0.105, 0.03], [0.096, 0.07, 0.11], [-0.35, 0, 0]);
        add(head, SPHERE(), hair, [0, 0.11, 0.1], [0.08, 0.055, 0.06], [-0.6, 0, 0]);
      }
      break;
    case 4: // wolf cut
      hairCap(1.07, true);
      add(head, SPHERE(), hair, [0, -0.06, -0.075], [0.11, 0.1, 0.07]);
      for (const s of [1, -1]) add(head, SPHERE(), hair, [s * 0.09, -0.04, -0.01], [0.035, 0.08, 0.06]);
      if (!covered) add(head, SPHERE(), hair, [0, 0.075, 0.085], [0.095, 0.04, 0.045], [0.4, 0, 0]);
      break;
    case 5: // ponytail
      hairCap(1.04, true);
      add(head, LOWSPHERE(), acc, [0, 0.0, -0.12], 0.018);
      add(head, CONE(), hair, [0, -0.11, -0.15], [0.04, 0.22, 0.035], [Math.PI + 0.25, 0, 0]);
      break;
    case 6: // bob
      hairCap(1.06, true);
      add(head, shell, hair, [0, 0.006, -0.002], [HX * 1.14, HY * 1.04, HZ * 1.1]);
      if (!covered) add(head, SPHERE(), hair, [0, 0.07, 0.085], [0.092, 0.035, 0.04], [0.35, 0, 0]);
      break;
    case 7: // twin tails
      hairCap(1.05, true);
      for (const s of [1, -1]) {
        add(head, LOWSPHERE(), acc, [s * 0.1, 0.04, -0.04], 0.017);
        add(head, CONE(), hair, [s * 0.13, -0.08, -0.05], [0.04, 0.24, 0.035], [0, 0, Math.PI - s * 0.18]);
      }
      if (!covered) add(head, SPHERE(), hair, [0, 0.07, 0.085], [0.092, 0.035, 0.04], [0.35, 0, 0]);
      break;
    case 8: // mohawk
      add(head, capTop, mat(mix(H, skinC, 0.55), 0.9), [0, 0, 0], [HX * 1.005, HY * 1.005, HZ * 1.005]);
      if (!covered)
        for (let i = 0; i < 6; i++) {
          const a = -0.9 + i * 0.36;
          add(head, CONE(), hair, [0, Math.cos(a) * HY * 0.95, Math.sin(a) * HZ * 0.95], [0.022, 0.13, 0.05], [a, 0, 0]);
        }
      break;
    case 9: // slicked back
      hairCap(1.035);
      if (!covered) add(head, SPHERE(), hair, [0, 0.05, -0.04], [0.1, 0.085, 0.11]);
      add(head, SPHERE(), hair, [0, -0.02, -0.095], [0.07, 0.05, 0.04]);
      break;
    case 10: // top knot
      hairCap(1.03, true);
      add(head, SPHERE(), hair, [0, 0.13, -0.05], [0.042, 0.04, 0.042]);
      add(head, CYL(0.022, 0.022, 0.02), acc, [0, 0.1, -0.045], 1, [-0.4, 0, 0]);
      break;
    case 11: // long
      hairCap(1.06, true);
      add(head, shell, hair, [0, 0.006, -0.002], [HX * 1.14, HY * 1.04, HZ * 1.1]);
      add(head, SPHERE(), hair, [0, -0.17, -0.09], [0.12, 0.2, 0.055]);
      if (!covered) add(head, SPHERE(), hair, [0.02, 0.07, 0.085], [0.09, 0.035, 0.04], [0.35, 0, -0.15]);
      break;
  }

  // Headwear (accent colour)
  const hw = r.headwear;
  if (hw === 1) {
    // Headband: the hachimaki, knotted behind
    const band = mat(r.accent === r.topColor ? 0xe8e6e0 : accC, 0.8);
    add(head, TORUS(0.12), band, [0, 0.035, 0], [HX * 1.08, HZ * 1.08, 0.13], [Math.PI / 2 - 0.12, 0, 0]);
    add(head, LOWSPHERE(), band, [0, 0.05, -HZ * 1.08], 0.018);
    for (const s of [1, -1]) add(head, BOX(), band, [s * 0.02, 0.0, -HZ * 1.1], [0.02, 0.08, 0.006], [0.3, 0, s * 0.3]);
  }
  if (hw === 2) {
    add(head, capTop, acc, [0, 0.008, 0], [HX * 1.1, HY * 1.1, HZ * 1.1]);
    add(head, SHELL('bandanaBack', Math.PI, Math.PI, 0, Math.PI * 0.55), acc, [0, 0.008, 0], [HX * 1.1, HY * 1.1, HZ * 1.1]);
    add(head, LOWSPHERE(), acc, [0, -0.01, -HZ * 1.08], 0.02);
  }
  if (hw === 3 || hw === 4) {
    const back = hw === 4;
    add(head, SHELL('crown', 0, Math.PI * 2, 0, Math.PI * 0.46), acc, [0, 0.012, 0], [HX * 1.12, HY * 1.14, HZ * 1.12]);
    add(head, LOWSPHERE(), acc, [0, HY * 1.13, 0], 0.012);
    add(head, BRIM(), mat(mix(accC, 0x000000, 0.25), 0.8), [0, 0.03, (back ? -1 : 1) * HZ * 0.95], [0.1, 0.01, 0.1], [back ? 0.12 : -0.12, back ? Math.PI : 0, 0]);
  }
  if (hw === 5) {
    add(head, SHELL('beanie', 0, Math.PI * 2, 0, Math.PI * 0.42), acc, [0, 0.03, 0], [HX * 1.12, HY * 1.25, HZ * 1.12]);
    add(head, TORUS(0.2), acc, [0, 0.06, 0], [HX * 1.1, HZ * 1.1, 0.12], [Math.PI / 2 - 0.1, 0, 0]);
  }
  if (hw === 6) {
    add(head, CYL(0.105, 0.118, 0.1), acc, [0, 0.085, -0.003], [1, 1, 1.08]);
    add(head, CYL(0.17, 0.17, 0.008), acc, [0, 0.04, -0.003], [1, 1, 1.05], [0.05, 0, 0]);
  }

  // Eyewear
  const lens = mat(0x0a0b10, 0.08, 0.6, {}, 'lens');
  const ew_ = r.eyewear;
  if (ew_ === 1) {
    for (const s of [1, -1]) add(head, BOX(), lens, [s * 0.038, 0.008, HZ * 0.97], [0.042, 0.026, 0.008], [0, s * 0.12, 0]);
    add(head, BOX(), lens, [0, 0.016, HZ * 1.0], [0.03, 0.006, 0.006]);
    for (const s of [1, -1]) add(head, BOX(), lens, [s * HX * 0.95, 0.015, 0.03], [0.006, 0.006, 0.12]);
  }
  if (ew_ === 2) {
    const visor = mat(0x6a54ff, 0.1, 1, { emissive: 0x220a40 }, 'visor');
    add(head, geo('visor', () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, -1.15, 2.3)), visor, [0, 0.01, 0.0], [HX * 1.12, 0.032, HZ * 1.08]);
  }
  if (ew_ === 3) {
    for (const s of [1, -1]) add(head, TORUS(0.09), gold, [s * 0.04, 0.006, HZ * 0.98], 0.022);
    add(head, BOX(), gold, [0, 0.012, HZ * 1.02], [0.02, 0.003, 0.003]);
  }
  if (ew_ === 4) {
    add(head, TORUS(0.1), dark, [0, 0.065, 0], [HX * 1.1, HZ * 1.1, 0.12], [Math.PI / 2 + 0.25, 0, 0]);
    for (const s of [1, -1]) add(head, CYL(0.026, 0.026, 0.025), mat(0xffb030, 0.1, 0.5, {}, 'goggle'), [s * 0.033, 0.085, HZ * 0.97], 1, [Math.PI / 2 - 0.5, 0, 0]);
  }

  // Mask
  if (r.mask === 1) add(head, SHELL('mask', Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.52, Math.PI * 0.32), mat(r.topColor === 0 ? 0x1a1b20 : 0xf2f2ee, 0.9), [0, -0.012, 0.01], [HX * 1.06, HY * 1.04, HZ * 1.06]);
  if (r.mask === 2) add(torso, CYL(0.075, 0.08, 0.13), acc, [0, 0.66, 0.008]);

  // Neck pieces
  if (r.neck === 1) add(torso, TORUS(0.07), gold, [0, 0.555, 0.015], [0.08, 0.08, 0.08], [Math.PI / 2 - 0.55, 0, 0]);
  if (r.neck === 2) {
    const towel = mat(0xf0efe8, 0.95);
    add(torso, TORUS(0.28), towel, [0, 0.555, -0.005], [0.085 * b, 0.085, 0.085], [Math.PI / 2 - 0.2, 0, 0]);
    for (const s of [1, -1]) add(torso, BOX(), towel, [s * 0.06, 0.4, chestZ * 0.95], [0.05, 0.25, 0.018], [0.08, 0, s * 0.05]);
  }
  if (r.neck === 3) {
    add(torso, TORUS(0.35), acc, [0, 0.56, -0.005], [0.075 * b, 0.075, 0.08], [Math.PI / 2 - 0.1, 0, 0]);
    add(torso, BOX(), acc, [-0.05, 0.42, chestZ * 1.0], [0.06, 0.22, 0.02], [0.05, 0, -0.08]);
  }

  // --- arms ------------------------------------------------------------------------------------------
  const longSleeve = r.top !== 0;
  const arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[] = [];
  const armR = 0.044 * Math.sqrt(b) * (r.top === 4 || r.top === 1 ? 1.12 : 1);
  for (const s of [1, -1]) {
    const shoulder = group(torso, [s * sx * 0.92, SHOULDER_Y - HIP_Y, -0.01]);
    add(shoulder, SPHERE(), top, [0, 0, 0], [armR * 1.15, armR * 1.1, armR * 1.15]);
    const ul = 0.29;
    if (longSleeve) add(shoulder, CAPSULE(armR, ul - armR), top, [0, -ul / 2, 0]);
    else {
      add(shoulder, CAPSULE(armR * 1.12, ul * 0.3), top, [0, -ul * 0.25, 0]);
      add(shoulder, CAPSULE(armR * 0.88, ul * 0.8), skin, [0, -ul / 2, 0]);
    }
    if (r.top === 3) add(shoulder, CAPSULE(armR * 1.03, ul * 0.55), acc, [0, -ul * 0.45, 0], [1, 1, 0.35]);
    const elbow = group(shoulder, [0, -ul, 0]);
    elbow.rotation.order = 'YXZ';
    const fl = 0.25;
    add(elbow, CAPSULE(armR * 0.86, fl - armR), longSleeve ? top : skin, [0, -fl / 2, 0]);
    if (jacket && (r.top === 2 || r.top === 4)) add(elbow, CYL(armR * 0.92, armR * 0.92, 0.04), acc, [0, -fl + 0.03, 0]); // ribbed cuffs
    const hand = group(elbow, [0, -fl, 0]);
    add(hand, SPHERE(), glove, [0, -0.04, 0], [0.034, 0.05, 0.022]);
    add(hand, SPHERE(), glove, [-s * 0.025, -0.03, 0.012], [0.012, 0.03, 0.012], [0.3, 0, s * 0.5]); // thumb
    arms.push({ shoulder, elbow, hand });
  }
  const [L, R] = arms; // L = the figure's left (+X)

  // --- pose ------------------------------------------------------------------------------------------
  const set = (g: THREE.Object3D, x: number, y: number, z: number) => g.rotation.set(x, y, z);
  let headYaw = 0;
  switch (r.pose) {
    case 0: // arms crossed
      for (const [a, s] of [[L, 1], [R, -1]] as const) {
        set(a.shoulder, -0.3, 0, s * 0.14);
        set(a.elbow, -1.62, -s * 1.15, 0);
        a.hand.visible = s === 1;
      }
      L.shoulder.rotation.x -= 0.1;
      headYaw = 0.15;
      break;
    case 1: // hands in pockets
      for (const [a, s] of [[L, 1], [R, -1]] as const) {
        set(a.shoulder, 0.1, 0, s * 0.2);
        set(a.elbow, -0.5, -s * 0.5, 0);
        a.hand.visible = false;
      }
      headYaw = -0.2;
      break;
    case 2: // hand on hip
      set(L.shoulder, 0.1, 0, 0.75);
      set(L.elbow, 0, 0, -1.9);
      set(R.shoulder, 0, 0, -0.08);
      set(R.elbow, -0.15, 0, 0);
      headYaw = 0.25;
      break;
    case 3: {
      // peace sign by the face
      set(R.shoulder, -0.75, 0, -0.5);
      set(R.elbow, -2.5, 0.6, 0);
      set(L.shoulder, 0.1, 0, 0.75);
      set(L.elbow, 0, 0, -1.9);
      const finger = CAPSULE(0.009, 0.05);
      add(R.hand, finger, glove, [0.008, -0.1, 0], 1, [0, 0, 0.2]);
      add(R.hand, finger, glove, [-0.01, -0.1, 0], 1, [0, 0, -0.2]);
      headYaw = -0.12;
      break;
    }
    case 4: {
      // keys out: a ring and a fob dangling from the hand
      set(R.shoulder, -0.35, 0, -0.1);
      set(R.elbow, -1.2, 0.35, 0);
      add(R.hand, TORUS(0.12), gold, [0, -0.085, 0.01], 0.016, [0, Math.PI / 2, 0]);
      add(R.hand, BOX(), dark, [0, -0.125, 0.01], [0.028, 0.045, 0.012]);
      add(R.hand, BOX(), gold, [0, -0.15, 0.01], [0.006, 0.03, 0.004]);
      set(L.shoulder, 0.1, 0, 0.2);
      set(L.elbow, -0.5, -0.5, 0);
      L.hand.visible = false;
      headYaw = 0.1;
      break;
    }
  }
  head.rotation.y = headYaw;
  // A street stance: weight on one leg, feet apart.
  legs[0].rotation.set(0, 0.15, 0.05);
  legs[1].rotation.set(0, -0.2, -0.07);
  hips.rotation.z = 0.025;
  if (opts.ride) {
    // Tucked in on a sports bike: chest down toward the tank, chin up to see the road.
    torso.rotation.set(RIDE.lean, 0, 0);
    head.rotation.set(-RIDE.lean * 0.8, 0, 0);
    for (const [i, s] of [1, -1].entries()) {
      legs[i].rotation.set(RIDE.thigh, 0, s * RIDE.knees);
      shins[i].rotation.set(RIDE.shin, 0, -s * RIDE.knees * 0.6);
      const a = arms[i];
      a.shoulder.rotation.set(RIDE.arm, 0, s * 0.22);
      a.elbow.rotation.set(RIDE.elbow, 0, 0);
      a.hand.visible = true;
    }
  }

  const hipY = HIP_Y * k;
  const height = 1.75 * k + (r.hair === 3 || r.hair === 1 || r.hair === 8 ? 0.06 : 0) * k;
  const seed = (r.skin * 7 + r.hair * 13 + r.top * 3) % 10;
  return {
    root,
    height,
    hipY,
    update(t: number) {
      if (opts.ride) return;
      const tt = t + seed;
      const breath = Math.sin(tt * 1.6);
      chest.scale.y = 0.27 * (1 + breath * 0.012);
      torso.rotation.x = breath * 0.008;
      torso.position.y = breath * 0.002;
      hips.rotation.z = 0.025 + Math.sin(tt * 0.35) * 0.012;
      head.rotation.y = headYaw + Math.sin(tt * 0.23) * 0.22 + Math.sin(tt * 0.61) * 0.05;
      head.rotation.x = Math.sin(tt * 0.31) * 0.04;
    },
    dispose() {
      root.removeFromParent();
    },
  };
}
