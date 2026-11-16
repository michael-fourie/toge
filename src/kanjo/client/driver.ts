// Your driver as a 3D figure (kanjo/shared/rider.ts). Each driver's GLB (public/models/drivers, built by tools/drivers)
// loads once; every car, bike, showroom and portrait then gets its own skinned clone. A clone is in one of three poses:
// `sit()` (the 'drive' clip held at the steering angle: its 17 keys sweep the wheel from full left lock to full right,
// hands and head following, with the driver's own seat and wheel), `ride()` (tucked over a bike's tank) or `stand()`
// (the 'idle' loop).
//
// Rig space: the model faces -Z like the cars. Seated or riding, the origin is the hip point; standing, the floor.

import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { decodeLook } from '../shared/look.ts';
import { isLegend, type Legend, type Rider } from '../shared/rider.ts';
import { gripClips } from './hands.ts';
import { cloneToon, toonAll } from './toon.ts';
import { assemble } from './wardrobe.ts';

/** Measured once per driver. Seated: the eyes and the top of the head (hair and gear) from the hip point, +z behind
 * it. Standing: the height. */
interface Fit {
  eye: THREE.Vector3;
  headTop: number;
  height: number;
}

type Clip = 'drive' | 'ride' | 'idle';

const files = new Map<Legend, Promise<{ gltf: GLTF; fit: Fit }>>();

/** Parts that only exist in the car. */
const CAR_ONLY = /^(seat|wheel)_/;
/** Parts nobody sees once seated (the feet are under the dash). */
const LEGS_ONLY = /^shoes/;

function load(id: Legend) {
  let p = files.get(id);
  if (!p) {
    p = new GLTFLoader().loadAsync(`/models/drivers/${id}.glb`).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const s = mat as THREE.MeshStandardMaterial;
          // Hair cards, brows and lashes are alpha-clipped; with an MSAA target, coverage softens them.
          if (s.alphaTest > 0) {
            s.alphaTest = 0.3;
            s.alphaToCoverage = true;
            s.side = THREE.DoubleSide;
          }
        }
      });
      toonAll(gltf.scene);
      gltf.animations = gripClips(gltf.scene, gltf.animations);
      return { gltf, fit: measure(gltf.scene, gltf.animations) };
    });
    p.catch(() => files.delete(id));
    files.set(id, p);
  }
  return p;
}

function clip(animations: THREE.AnimationClip[], name: Clip): THREE.AnimationClip {
  const c = THREE.AnimationClip.findByName(animations, name);
  if (!c) throw new Error(`driver model has no '${name}' clip`);
  return c;
}

/** Bounds of the posed figure (skinned meshes, so in the pose's own shape). */
function posedBox(scene: THREE.Object3D, only?: RegExp): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || CAR_ONLY.test(m.name) || (only && !only.test(m.name))) return;
    m.computeBoundingBox();
    box.union(tmp.copy(m.boundingBox!).applyMatrix4(m.matrixWorld));
  });
  return box;
}

/** Poses a throwaway clone at the centre of the drive clip, then standing, and reads where things end up. */
function measure(model: THREE.Object3D, animations: THREE.AnimationClip[]): Fit {
  const scene = cloneSkinned(model);
  scene.rotation.y = Math.PI; // as the rigs turn it
  const mixer = new THREE.AnimationMixer(scene);
  const drive = mixer.clipAction(clip(animations, 'drive'));
  drive.play();
  drive.paused = true;
  drive.time = drive.getClip().duration / 2;
  mixer.update(0);
  const headTop = posedBox(scene).max.y;
  const eye = posedBox(scene, /^low-poly/).getCenter(new THREE.Vector3());
  drive.stop();
  mixer.clipAction(clip(animations, 'idle')).play();
  mixer.update(0);
  return { eye, headTop, height: posedBox(scene).max.y };
}

export class DriverRig {
  readonly root = new THREE.Group();
  readonly fit: Fit;
  private mixer: THREE.AnimationMixer;
  private actions: Record<Clip, THREE.AnimationAction>;
  private carOnly: THREE.Object3D[] = [];
  private legs: THREE.Object3D[] = [];
  private shown = 0;
  private mode: Clip = 'idle';

  /** `scene` becomes the rig's own; `owned`: materials made for this rig alone (a custom driver's), freed with it. */
  constructor(scene: THREE.Object3D, animations: THREE.AnimationClip[], fit: Fit, opts: { shadows?: boolean } = {}, private owned: THREE.Material[] = []) {
    scene.rotation.y = Math.PI; // the file faces +Z; cars face -Z
    this.root.add(scene);
    this.root.name = 'rider';
    this.fit = fit;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Skinned bounds are the bind pose; the seated pose sits well outside them.
      m.frustumCulled = false;
      m.castShadow = !!opts.shadows;
      // Never shadowed by themselves: the soft cel bands (toon.ts) are the figure's own shading, and a shadow map
      // across light that wraps round a form shows as stripes.
      m.receiveShadow = false;
      if (CAR_ONLY.test(m.name)) this.carOnly.push(m);
      if (LEGS_ONLY.test(m.name)) this.legs.push(m);
    });
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = { drive: this.mixer.clipAction(clip(animations, 'drive')), ride: this.mixer.clipAction(clip(animations, 'ride')), idle: this.mixer.clipAction(clip(animations, 'idle')) };
  }

  private use(mode: Clip, carParts: boolean, legs: boolean) {
    this.mode = mode;
    this.mixer.stopAllAction();
    const a = this.actions[mode].reset().play();
    if (mode === 'idle') a.time = Math.random() * a.getClip().duration;
    else a.paused = true;
    for (const o of this.carOnly) o.visible = carParts;
    for (const o of this.legs) o.visible = legs;
    this.mixer.update(0);
  }

  /** In a car: seat and wheel on, shoes off (`shoes`: on, for the showroom, where the feet show), hands on the wheel. */
  sit(shoes = false) {
    this.use('drive', true, shoes);
    this.steer(0, 1);
  }

  /** On a bike: tucked over the tank, hands on the bars, feet on the pegs. */
  ride() {
    this.use('ride', false, true);
  }

  /** In the showroom or a portrait: standing about, breathing. */
  stand() {
    this.use('idle', false, true);
  }

  /**
   * Seated: turns the wheel (and the hands and head with it). `s` is -1 full left to 1 full right; it's eased a
   * little, so a twitchy remote pose doesn't make the hands flicker.
   */
  steer(s: number, ease = 0.35) {
    if (this.mode !== 'drive') return;
    this.shown += (Math.max(-1, Math.min(1, s)) - this.shown) * ease;
    const a = this.actions.drive;
    a.time = ((this.shown + 1) / 2) * a.getClip().duration;
    this.mixer.update(0);
  }

  /** Standing: plays the idle loop on. */
  update(dt: number) {
    if (this.mode === 'idle') this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const m of this.owned) m.dispose();
  }
}

/**
 * A driver of your own: a legend's GLB, or your own assembled from the wardrobe (wardrobe.ts). Geometry and textures
 * are shared between rigs: never dispose them (a custom rig frees only its own materials, in `dispose()`).
 */
export async function loadDriver(id: Rider, opts?: { shadows?: boolean }): Promise<DriverRig> {
  if (isLegend(id)) {
    const { gltf, fit } = await load(id);
    return new DriverRig(cloneSkinned(gltf.scene), gltf.animations, fit, opts);
  }
  const look = decodeLook(id);
  if (!look) throw new Error(`not a driver: ${id}`);
  const a = await assemble(look);
  const clips = gripClips(a.scene, a.animations);
  return new DriverRig(a.scene, clips, measure(a.scene, clips), opts, a.owned);
}

/**
 * Loads `rider` and hands the rig to `seat` when it's ready (cars and bikes place it differently). A time-trial
 * ghost (ghostly() already ran) gets faded copies of the driver's materials. `leave()` on dispose: the rig's
 * geometry is every clone's, so it comes out before the car's own is freed.
 */
export function arrive(root: THREE.Object3D, rider: Rider | null, seat: (rig: DriverRig) => void) {
  const st = { rig: null as DriverRig | null, gone: false, faded: [] as THREE.Material[], leave() {} };
  st.leave = () => {
    st.gone = true;
    st.rig?.dispose();
    for (const m of st.faded) m.dispose();
  };
  if (rider)
    loadDriver(rider).then(
      (rig) => {
        if (st.gone) return rig.dispose();
        st.rig = rig;
        seat(rig);
        const ghost = root.userData.ghost as number | undefined;
        if (ghost !== undefined)
          rig.root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            // A custom driver's body has a material per group (skin, painted arm, gloves).
            const fade = (src: THREE.Material) => {
              const c = cloneToon(src);
              c.transparent = true;
              c.opacity *= ghost;
              c.depthWrite = false;
              st.faded.push(c);
              return c;
            };
            m.material = Array.isArray(m.material) ? m.material.map(fade) : fade(m.material);
          });
      },
      (e) => console.warn(`Driver ${rider} did not load`, e),
    );
  return st;
}
