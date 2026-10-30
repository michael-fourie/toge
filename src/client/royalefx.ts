import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type LootItem, type ZoneState, rarity } from '../shared/royale.ts';
import { WEAPONS, type WeaponId } from '../shared/weapons.ts';
import { softDot, toonRamp } from './textures.ts';
import { buildGunDisplay } from './weapon/guns.ts';

// Battle Royale in the world: the zone (a wall of lavender storm light that closes in, and a faint ring where it's
// going next) and the loot lying about (spinning, bobbing, in a little beam coloured by how rare it is).

const ZONE_COLOR = 0xb48cff;
const NEXT_COLOR = 0xfff6e0;
const ZONE_BOTTOM = -40;
const ZONE_HEIGHT = 220;
/** By rarity: common grey-white, blue, purple, gold. */
const RARITY_COLORS = [0xeeeeee, 0x6aa8ff, 0xc77dff, 0xffc94a];
/** Loot models only draw this close (beyond it, just the beam): a field of guns is a lot of meshes. */
const MODEL_RANGE = 70;
const BEAM_RANGE = 260;
const BEAM_HIDE = 5;

/** Soft vertical bands drifting up the zone's wall. */
function stormTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, '#ffffffee');
  grad.addColorStop(0.25, '#ffffff99');
  grad.addColorStop(1, '#ffffff22');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) {
    g.globalAlpha = 0.15 + ((i * 37) % 10) / 30;
    g.fillRect((i * 23) % 64, 0, 3 + (i % 4) * 2, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class ZoneFx {
  private readonly wall: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly next: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly tex = stormTexture();

  constructor(scene: THREE.Scene) {
    this.tex.repeat.set(60, 1);
    // Unit cylinders, scaled to the circle each frame. Not fogged: you should see the storm from anywhere.
    const geo = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0);
    this.wall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ZONE_COLOR, alphaMap: this.tex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.next = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: NEXT_COLOR, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.wall.renderOrder = this.next.renderOrder = 4;
    this.wall.visible = this.next.visible = false;
    scene.add(this.wall, this.next);
  }

  update(z: ZoneState | null, time: number) {
    this.wall.visible = !!z && z.r > 0.5;
    this.next.visible = !!z && z.nr > 0.5 && z.nr < z.r - 0.5;
    if (!z) return;
    this.wall.position.set(z.x, ZONE_BOTTOM, z.z);
    this.wall.scale.set(z.r, ZONE_HEIGHT, z.r);
    this.tex.offset.set(time * 0.02, -time * 0.05);
    this.wall.material.opacity = z.shrinking ? 0.62 + 0.1 * Math.sin(time * 6) : 0.5;
    this.tex.repeat.x = Math.max(8, Math.round(z.r / 4));
    this.next.position.set(z.nx, ZONE_BOTTOM, z.nz);
    this.next.scale.set(z.nr, ZONE_HEIGHT * 0.4, z.nr);
  }
}

// ---------------------------------------------------------------------------
// Loot

const toon = (color: number, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra });
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => (o.position.set(x, y, z), o);

/** A display model with all its parts baked into one mesh per material (so a gun is a handful of draw calls, not dozens). */
function bake(src: THREE.Object3D): THREE.Group {
  src.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    (byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)!).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  return out;
}

const models = new Map<string, THREE.Group>();
/** The model for one kind of loot (built once, then shared). Sized to read from a few metres away. */
function lootModel(it: LootItem): THREE.Group {
  const key = it.k === 'gun' ? it.w! : it.k;
  let m = models.get(key);
  if (m) return m;
  const g = new THREE.Group();
  if (it.k === 'gun') {
    const gun = buildGunDisplay(WEAPONS[it.w as WeaponId].style, RARITY_COLORS[rarity(it)]);
    const len = (gun.userData.length as number) || 0.6;
    gun.scale.setScalar(Math.min(2.2, 1.1 / len)); // every gun about a metre long, the pistol a bit bigger than life
    g.add(gun);
  } else if (it.k === 'ammo') {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.36, 0.38), toon(0x5e7d3a));
    const band = toon(0xffd45a);
    g.add(crate);
    for (const x of [-0.24, 0.24]) g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.4), band), x, 0, 0));
    for (const x of [-0.1, 0, 0.1]) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), band), x, 0.28, 0));
  } else if (it.k === 'nade') {
    const body = toon(0x6f8f4a);
    const cap = toon(0xd9a84e);
    for (const x of [-0.16, 0.16]) {
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), body), x, 0, 0));
      g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), cap), x, 0.17, 0));
    }
  } else if (it.k === 'heal') {
    // An onigiri: a white rice triangle with a nori band.
    const rice = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 3), toon(0xfffbf0));
    rice.rotation.x = Math.PI / 2;
    rice.rotation.y = Math.PI / 2;
    const nori = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.22), toon(0x23352a));
    nori.position.y = -0.1;
    g.add(rice, nori);
  } else {
    // Cloud Tea: a little glass bottle of sky-blue tea with a cork and a cloud on the label.
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.42, 14), toon(0x7fd0ff, { emissive: new THREE.Color(0x2a6fa8), emissiveIntensity: 0.5 }));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 10), toon(0x9fdcff));
    neck.position.y = 0.27;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), toon(0xb78a5a));
    cork.position.y = 0.36;
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toon(0xffffff));
    cloud.scale.set(1.4, 0.8, 0.5);
    cloud.position.set(0, 0, 0.15);
    g.add(glass, neck, cork, cloud);
  }
  m = bake(g);
  models.set(key, m);
  return m;
}

interface Shown {
  item: LootItem;
  root: THREE.Group;
  model: THREE.Object3D | null;
  beam: THREE.Mesh;
  phase: number;
}

const beamGeo = new THREE.CylinderGeometry(0.28, 0.45, 1, 12, 1, true).translate(0, 0.5, 0);
const beamMats = RARITY_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
const glowMats = RARITY_COLORS.map((c) => new THREE.SpriteMaterial({ map: softDot(), color: c, transparent: true, opacity: 0.8, depthWrite: false }));

/** Everything lying on the ground. Up close you see the item itself; from afar, a beam of light where it is. */
export class LootFx {
  private shown = new Map<number, Shown>();
  private tick = 0;

  constructor(private scene: THREE.Scene) {}

  add(it: LootItem) {
    this.remove(it.id);
    const root = new THREE.Group();
    root.position.set(it.p[0], it.p[1], it.p[2]);
    const tier = rarity(it);
    const beam = new THREE.Mesh(beamGeo, beamMats[tier]);
    beam.scale.y = tier >= 2 ? 7 : 2.4; // the good stuff shows from further away
    const glow = new THREE.Sprite(glowMats[tier]);
    glow.scale.setScalar(0.9);
    glow.position.y = 0.75;
    root.add(beam, glow);
    this.scene.add(root);
    this.shown.set(it.id, { item: it, root, model: null, beam, phase: (it.id * 0.618) % 1 });
  }

  remove(id: number) {
    const s = this.shown.get(id);
    if (!s) return;
    s.root.removeFromParent();
    this.shown.delete(id);
  }

  clear() {
    for (const id of [...this.shown.keys()]) this.remove(id);
  }

  update(time: number, viewer: THREE.Vector3) {
    // Which models to show is decided a few times a second; the spin and bob every frame for the ones shown.
    const recheck = this.tick++ % 10 === 0;
    for (const s of this.shown.values()) {
      if (recheck) {
        const d = s.root.position.distanceTo(viewer);
        s.root.visible = d < BEAM_RANGE;
        s.beam.visible = d > BEAM_HIDE; // standing in it would wash out the view; up close you see the item anyway
        const near = d < MODEL_RANGE;
        if (near && !s.model) {
          s.model = lootModel(s.item).clone();
          s.root.add(s.model);
        } else if (!near && s.model) {
          s.model.removeFromParent();
          s.model = null;
        }
      }
      if (s.model) {
        s.model.position.y = 0.8 + Math.sin(time * 2 + s.phase * 6) * 0.08;
        s.model.rotation.y = time * 1.2 + s.phase * 6;
      }
    }
  }
}
