// Custom drivers: assembles a driver from the wardrobe (public/models/drivers/wardrobe, built by
// tools/drivers/wardrobe.py; docs/DRIVER_CREATOR.md). A base model holds the rig, both clips, the body,
// eyes, lashes and the seat; each chosen part (outfit, shoes, hair, brows, kit, wheel) is its own model
// skinned to the same bone names, rebound here to the base's skeleton. Models are Draco-compressed
// .gltf with textures shared between bases (`tex/`).
//
// The look is applied without rebuilding anything:
// - skin under the clothes is dropped by the body's `_hide` bits (one per outfit/shoes that covers it);
// - outfits, shoes, hair and brows are recoloured on the GPU from baked zone masks, the same maths as
//   tools/drivers/build.py's `recolor()` (shade = (lum / zone ref) ^ contrast, in sRGB);
// - kit materials are roles (metal, trim, strap, glow, glow_soft, lens) swapped for the look's;
// - what the legends bake into the body is done here from the bone weights: a kit piece's `paint`
//   (a mechanical arm's metal skin, gloves) and `sleeve` (cut that sleeve off, show the arm under it).

import * as THREE from 'three';
import { addGear } from './passgear.ts';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Look, MetalId, LeatherId } from '../shared/look.ts';

const ROOT = '/models/drivers/wardrobe/';

interface Zone {
  name: string;
  ref: number;
  color: string;
  contrast: number;
}
interface PartInfo {
  slot: string;
  file: string;
  tris: number;
  bytes: number;
  /** Outfits and shoes: their bit in the body's `_hide`. */
  hide?: number;
  zones?: Zone[];
  /** The zone mask, relative to the wardrobe root (shared by every base). */
  mask?: string | null;
  /** Body faces to repaint: their average weight on `bones` is at least `min`; `role` is the material. */
  paint?: Paint[];
  /** A mechanical arm: that side's sleeve comes off and the arm's skin shows. */
  sleeve?: 'l' | 'r';
}
interface Paint {
  bones: string[];
  min: number;
  role: string;
}
interface BaseInfo {
  frame: string;
  base: { file: string; tris: number; bytes: number };
  parts: Record<string, PartInfo>;
}
interface Manifest {
  bases: Record<string, BaseInfo>;
  skins: Record<string, string[]>;
  eyes: string[];
}

let manifest: Promise<Manifest> | null = null;
function wardrobe(): Promise<Manifest> {
  if (!manifest) {
    manifest = fetch(ROOT + 'manifest.json').then((r) => {
      if (!r.ok) throw new Error(`wardrobe manifest: ${r.status}`);
      return r.json() as Promise<Manifest>;
    });
    manifest.catch(() => (manifest = null));
  }
  return manifest;
}

let loader: GLTFLoader | null = null;
const gltfs = new Map<string, Promise<GLTF>>();
function gltf(url: string): Promise<GLTF> {
  let p = gltfs.get(url);
  if (!p) {
    // three's Draco decoder, copied into public/draco/.
    loader ??= new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/').setDecoderConfig({ type: 'wasm' }));
    p = loader.loadAsync(url);
    p.catch(() => gltfs.delete(url));
    gltfs.set(url, p);
  }
  return p;
}

const textures = new Map<string, Promise<THREE.Texture>>();
/** A texture for glTF UVs (no flip). `color`: albedo (sRGB) rather than data (a mask). */
function texture(url: string, color: boolean): Promise<THREE.Texture> {
  let p = textures.get(url);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.flipY = false;
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    });
    p.catch(() => textures.delete(url));
    textures.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Materials

const METAL: Record<MetalId, { color: number; rough: number; metal: number; coat?: number; trim: number; glow?: number; iri?: boolean }> = {
  brass: { color: 0xc8963e, rough: 0.32, metal: 1, trim: 0x7a5526 },
  copper: { color: 0xb8643a, rough: 0.35, metal: 1, trim: 0x6e3a20 },
  gunmetal: { color: 0x2b2e33, rough: 0.38, metal: 1, trim: 0x1a1c20 },
  chrome: { color: 0xe8ecf0, rough: 0.08, metal: 1, trim: 0x9aa0a8 },
  steel: { color: 0x9aa0a8, rough: 0.28, metal: 1, trim: 0x5c6168 },
  carbon: { color: 0x141518, rough: 0.3, metal: 0.2, coat: 1, trim: 0x2b2e33 },
  // Battle pass metals (pass.ts). Ember glows from within (`glow`, brighter than white so it blooms); prism is an
  // iridescent film over dark chrome.
  gold: { color: 0xffc94a, rough: 0.14, metal: 1, coat: 0.6, trim: 0xb8862b },
  obsidian: { color: 0x07070a, rough: 0.12, metal: 0.6, coat: 1, trim: 0x2a1a3a },
  ember: { color: 0x3a1a10, rough: 0.4, metal: 0.8, trim: 0x1a0c08, glow: 0xff5a1a },
  prism: { color: 0x4a5060, rough: 0.1, metal: 1, coat: 1, trim: 0x2b2e33, iri: true },
};
const LEATHER: Record<LeatherId, { color: number; rough: number }> = {
  leather: { color: 0x3b2316, rough: 0.55 },
  leather_black: { color: 0x151313, rough: 0.5 },
  leather_tan: { color: 0x7a4a28, rough: 0.6 },
};

/** The look's version of a role material (the GLB's copy carries the rest: emissive strength, etc.). */
function roleMaterial(src: THREE.MeshStandardMaterial | null, role: string, look: Look): THREE.Material | null {
  if (role === 'metal' || role === 'trim') {
    const m = METAL[look.metal];
    const out = new THREE.MeshPhysicalMaterial({ name: role, color: role === 'metal' ? m.color : m.trim, roughness: m.rough + (role === 'trim' ? 0.1 : 0), metalness: m.metal, clearcoat: m.coat ?? 0 });
    if (m.glow !== undefined && role === 'metal') {
      out.emissive.setHex(m.glow);
      out.emissiveIntensity = 1.6;
    }
    if (m.iri) {
      out.iridescence = 1;
      out.iridescenceIOR = 1.8;
      out.iridescenceThicknessRange = [200, 900];
    }
    return out;
  }
  if (role === 'strap') return new THREE.MeshStandardMaterial({ name: role, color: LEATHER[look.leather].color, roughness: LEATHER[look.leather].rough });
  if (src && (role === 'glow' || role === 'glow_soft' || role === 'lens')) {
    const m = src.clone();
    if (role !== 'lens') m.color.setHex(look.glow);
    m.emissive.setHex(look.glow);
    return m;
  }
  return null;
}

interface Recolour {
  mask: THREE.Texture | null;
  colors: number[];
  zones: Zone[];
}

/**
 * Patches a standard material so its albedo is repainted per zone, as build.py's recolor() does:
 * each zone's pixels become the zone colour times (lum / ref) ^ contrast, in sRGB. Without a mask the
 * one zone covers everything (hair).
 */
function recoloured(src: THREE.MeshStandardMaterial, r: Recolour): THREE.MeshStandardMaterial {
  const m = src.clone();
  const zc = [0, 1, 2, 3].map((i) => {
    const c = new THREE.Color();
    // sRGB values on purpose: the maths runs in sRGB like the build's.
    if (i < r.colors.length) c.setHex(r.colors[i], THREE.LinearSRGBColorSpace);
    return new THREE.Vector3(c.r, c.g, c.b);
  });
  const vec = (f: (z: Zone) => number, fill: number) => new THREE.Vector4(...[0, 1, 2, 3].map((i) => (r.zones[i] ? f(r.zones[i]) : fill)));
  const uniforms = {
    zMask: { value: r.mask },
    zAll: { value: r.mask ? 0 : 1 },
    zColor: { value: zc },
    zRef: { value: vec((z) => z.ref, 0.5) },
    zCon: { value: vec((z) => z.contrast, 1) },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D zMask;
uniform float zAll;
uniform vec3 zColor[4];
uniform vec4 zRef;
uniform vec4 zCon;
vec3 zToS(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 zToL(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
{
  vec3 s = zToS(max(diffuseColor.rgb, 0.0));
  float lum = dot(s, vec3(0.299, 0.587, 0.114));
  vec4 k = zAll > 0.5 ? vec4(1.0, 0.0, 0.0, 0.0) : texture2D(zMask, vMapUv);
  vec3 o = s;
  for (int i = 0; i < 4; i++) {
    float sh = pow(clamp(lum / max(zRef[i], 0.02), 0.25, 1.9), zCon[i]);
    o = mix(o, clamp(zColor[i] * sh, 0.0, 1.0), k[i]);
  }
  diffuseColor.rgb = zToL(o);
}
#endif`,
      );
  };
  // Different masks/colours share one program: the patch is the same text.
  m.customProgramCacheKey = () => 'zone-recolour';
  m.userData.recolour = uniforms;
  return m;
}

/** Hair cards, brows and lashes are alpha-clipped; with the MSAA target, coverage softens them. */
function cards(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  if (s.alphaTest > 0) {
    s.alphaTest = 0.3;
    s.alphaToCoverage = true;
    s.side = THREE.DoubleSide;
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry from bone weights: the body without the skin the clothes hide, repaints, sleeve cuts

/** An arm from the shoulder down, fingers and all (kit.arm_bones in the build). */
const ARM = (side: string) => new RegExp(`^(upperarm|lowerarm|hand)_${side}$|^(index|middle|ring|pinky|thumb)_0[1-3]_${side}$`);

/** Each vertex's total skin weight on the bones `match` picks. */
function weightOn(mesh: THREE.SkinnedMesh, match: (bone: string) => boolean): Float32Array {
  const g = mesh.geometry;
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const pick = mesh.skeleton.bones.map((b) => match(b.name));
  const out = new Float32Array(si.count);
  for (let v = 0; v < si.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (pick[si.getComponent(v, k)]) w += sw.getComponent(v, k);
    out[v] = w;
  }
  return out;
}

/** A geometry sharing `src`'s attributes with its own index, one material group per list. */
function reindexed(src: THREE.BufferGeometry, groups: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) if (name !== '_hide') g.setAttribute(name, attr);
  g.setIndex(groups.flat());
  let start = 0;
  groups.forEach((idx, i) => {
    g.addGroup(start, idx.length, i);
    start += idx.length;
  });
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

const cut = new Map<string, THREE.BufferGeometry>();

/**
 * The body for a look: triangles covered by what's `worn` dropped (except a cut-off sleeve's arm), the
 * rest split into material groups: 0 skin, then one per paint (later paints win).
 */
function bodyFor(body: THREE.SkinnedMesh, key: string, worn: number, sleeves: string[], paints: Paint[]): THREE.BufferGeometry {
  const k = `${key}:${worn}:${sleeves.join()}:${paints.map((p) => p.bones.join('+') + p.min).join('|')}`;
  let g = cut.get(k);
  if (g) return g;
  const src = body.geometry;
  const hide = src.getAttribute('_hide');
  const index = src.getIndex()!;
  const bare = sleeves.map((s) => weightOn(body, (b) => ARM(s).test(b)));
  const covered = (v: number) => (Math.round(hide.getX(v)) & worn) !== 0 && !bare.some((w) => w[v] > 0.35);
  const pw = paints.map((p) => weightOn(body, (b) => p.bones.includes(b)));
  const groups: number[][] = [[], ...paints.map(() => [])];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (covered(a) && covered(b) && covered(c)) continue;
    let gi = 0;
    pw.forEach((w, p) => {
      if ((w[a] + w[b] + w[c]) / 3 >= paints[p].min) gi = p + 1;
    });
    groups[gi].push(a, b, c);
  }
  g = reindexed(src, groups);
  cut.set(k, g);
  return g;
}

/** An outfit without the sleeves on `sides` (the build's sleeve_cut test: average arm weight > 0.5). */
function sleeveless(mesh: THREE.SkinnedMesh, key: string, sides: string[]): THREE.BufferGeometry {
  if (!sides.length) return mesh.geometry;
  const k = `${key}:${sides.join()}`;
  let g = cut.get(k);
  if (g) return g;
  const w = sides.map((s) => weightOn(mesh, (b) => ARM(s).test(b)));
  const index = mesh.geometry.getIndex()!;
  const keep: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (!w.some((x) => (x[a] + x[b] + x[c]) / 3 > 0.5)) keep.push(a, b, c);
  }
  g = reindexed(mesh.geometry, [keep]);
  cut.set(k, g);
  return g;
}

// ---------------------------------------------------------------------------------------------

export interface Assembled {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Materials made for this look (the caller disposes them with the rig). */
  owned: THREE.Material[];
}

/** Builds the scene for `look`: the base's rig and body with the look's parts bound to its skeleton. */
export async function assemble(look: Look): Promise<Assembled> {
  const man = await wardrobe();
  const info = man.bases[look.base];
  if (!info) throw new Error(`no wardrobe base ${look.base}`);
  const dir = `${ROOT}${look.base}/`;
  // Kit that hugs the clothes is fitted per outfit (`kit_<id>@<outfit>`); head kit is shared.
  const kitPart = (k: string) => (info.parts[`kit_${k}@${look.outfit}`] ? `kit_${k}@${look.outfit}` : `kit_${k}`);
  const ids = [look.outfit, look.shoes, look.brows, ...(look.hair === 'none' ? [] : [look.hair]), ...look.kit.map(kitPart), 'wheel_' + look.wheel];
  for (const id of ids) if (!info.parts[id]) throw new Error(`wardrobe base ${look.base} has no ${id}`);
  const masks = ids.map((id) => info.parts[id].mask).filter((m): m is string => !!m);
  const [base, parts, skin, iris, maskTex] = await Promise.all([
    gltf(dir + info.base.file),
    Promise.all(ids.map((id) => gltf(dir + info.parts[id].file))),
    texture(`${ROOT}skins/${look.skin}.webp`, true),
    texture(`${ROOT}eyes/${look.eyes}.webp`, true),
    Promise.all(masks.map((m) => texture(ROOT + m, false))),
  ]);
  const maskOf = new Map(masks.map((m, i) => [m, maskTex[i]]));
  const sleeves = ids.map((id) => info.parts[id].sleeve).filter((s): s is 'l' | 'r' => !!s);
  const paints = ids.flatMap((id) => info.parts[id].paint ?? []);

  const scene = cloneSkinned(base.scene) as THREE.Group;
  scene.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  let body: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === 'body') body = o as THREE.SkinnedMesh;
  });
  if (!body) throw new Error('wardrobe base has no body');
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T) => (owned.push(m), m);

  // Every part's meshes, rebound to the base's bones and parked beside the body.
  const holder = (body as THREE.SkinnedMesh).parent!;
  const inv = holder.matrixWorld.clone().invert();
  ids.forEach((id, i) => {
    const p = info.parts[id];
    const src = parts[i].scene;
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const skel = new THREE.Skeleton(
        sm.skeleton.bones.map((b) => bones.get(b.name) ?? b),
        sm.skeleton.boneInverses,
      );
      const mat = sm.material as THREE.MeshStandardMaterial;
      let m: THREE.Material = mat;
      if (p.zones) {
        const colors = p.slot === 'outfit' ? look.colors : p.slot === 'shoes' ? [look.shoeColor] : [look.hairColor];
        m = own(recoloured(mat, { mask: p.mask ? maskOf.get(p.mask)! : null, colors, zones: p.zones }));
      } else {
        m = roleMaterial(mat, mat.name, look) ?? mat;
        if (m !== mat) own(m);
      }
      cards(m);
      const geo = p.slot === 'outfit' ? sleeveless(sm, `${look.base}/${id}`, sleeves) : sm.geometry;
      const mesh = new THREE.SkinnedMesh(geo, m);
      mesh.name = sm.name;
      inv.clone().multiply(sm.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
      holder.add(mesh);
      mesh.bind(skel, sm.bindMatrix);
    });
  });

  // The base's own meshes: body (minus covered skin, plus repaints), eyes, lashes, seat.
  let worn = 0;
  for (const id of ids) if (info.parts[id].hide !== undefined) worn |= 1 << info.parts[id].hide!;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (o === body) {
      m.geometry = bodyFor(m, look.base, worn, sleeves, paints);
      const s = own(mat.clone());
      s.map = skin;
      m.material = [s, ...paints.map((p) => own(roleMaterial(null, p.role, look) ?? new THREE.MeshStandardMaterial()))];
      return;
    }
    if (mat.name === 'iris') {
      const c = own(mat.clone());
      c.map = iris;
      m.material = c;
    } else {
      const r = roleMaterial(mat, mat.name, look);
      if (r) m.material = own(r);
    }
    cards(m.material as THREE.Material);
  });
  // Battle pass gear (passgear.ts), on the head bone.
  owned.push(...addGear(scene, look));
  return { scene, animations: base.animations, owned };
}
