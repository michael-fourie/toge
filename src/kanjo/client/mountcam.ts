import * as THREE from 'three';
import { INTERIOR } from './carmodel.ts';

// Mounted race cameras: the hood, the front bumper and a side mount on the flank. Each sits at a point found on
// the car's own model (its bounds, and the hood surface found by casting down onto it), so it suits every car and the
// bike without a number per design. (The old hood and bumper cameras used fixed offsets, and after placing the camera
// they read the world height back as if it were car-local, so they looked straight up at the sky; 2026-11-19, Andrew:
// "Replace hood and bumper camera, because it doesnt work. Make new good camera angles.")

export type MountCam = 'hood' | 'bumper' | 'side';

/** Where the mounted cameras sit, in the car's own frame (m; -z is forward, y up from the car's origin). */
export interface Mounts {
  /** The front and back of the body (z), half its width, and the ground under it at rest (y). */
  nose: number;
  tail: number;
  half: number;
  floor: number;
  /** The hood camera: just above the hood, this far along it. */
  hoodY: number;
  hoodZ: number;
}

export const MOUNT = {
  /** The hood camera sits this share of the way from the middle of the car to the nose, this far above the paint. */
  hoodAt: 0.32,
  hoodRise: 0.24,
  /** A bumper camera this far above the road and ahead of the nose; a side mount this far out from the body. */
  bumperY: 0.42,
  bumperAhead: 0.06,
  sideOut: 0.3,
  /** The side mount stands off at least this far from the middle (m) plus `sideOut`. */
  sideMin: 0.85,
  sideY: 0.78,
  /**
   * The side mount's place along the car, as a share of the nose's distance from the middle: negative is behind the
   * middle, by the rear door, so the flank runs up the side of the frame to the front wheel without filling it.
   */
  sideAt: -0.3,
  /** How much each looks down (rad): the hood camera a touch, so the hood sits along the bottom of the frame. */
  pitch: { hood: -0.035, bumper: 0.01, side: -0.02 } as Record<MountCam, number>,
  /** Field of view at rest and the most speed adds (degrees; full at 80 m/s). */
  fov: { hood: [66, 14], bumper: [74, 16], side: [70, 14] } as Record<MountCam, [number, number]>,
  /**
   * How fast the view follows the car's attitude (1/s). The mount moves with the body, but its aim is eased, so the
   * picture doesn't buzz on bumps or snap on a landing; quick enough that a turn reads at once.
   */
  steady: 22,
  /** Never closer to the ground under it than this (m): a hard landing would otherwise dip the bumper camera under the road. */
  clear: 0.12,
};

const cache = new WeakMap<THREE.Object3D, Mounts>();

/** Meshes that are the car's body and wheels: not its cabin, not the rider, not a hidden cockpit, not a skinned driver. */
function bodyMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const skip = root.userData.rider as THREE.Object3D | undefined;
  const walk = (o: THREE.Object3D) => {
    if (o === skip || o.name === INTERIOR || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) out.push(m);
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

/** The mount points of a car model (worked out once per model). `cg` is the height of its origin above the road at rest. */
export function mountsOf(root: THREE.Object3D, cg: number): Mounts {
  const had = cache.get(root);
  if (had) return had;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const meshes = bodyMeshes(root);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    part.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    box.union(part);
  }
  const floor = -cg;
  const nose = Number.isFinite(box.min.z) ? box.min.z : -2.1;
  const tail = Number.isFinite(box.max.z) ? box.max.z : 2.1;
  const half = Number.isFinite(box.max.x) ? Math.max(box.max.x, -box.min.x) : 0.9;
  const top = Number.isFinite(box.max.y) ? box.max.y : floor + 1.3;
  // The hood: cast straight down onto the body (the topmost hit) where the camera will sit.
  const hoodZ = nose * MOUNT.hoodAt;
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, top + 1, hoodZ).applyMatrix4(root.matrixWorld),
    new THREE.Vector3(0, -1, 0).transformDirection(root.matrixWorld),
  );
  const hit = ray.intersectObjects(meshes, false)[0];
  const surface = hit ? hit.point.clone().applyMatrix4(inv).y : floor + (top - floor) * 0.6;
  const mounts: Mounts = { nose, tail, half, floor, hoodY: surface + MOUNT.hoodRise, hoodZ };
  cache.set(root, mounts);
  return mounts;
}

/** Where a mounted camera sits on the car (car-local). */
export function mountPoint(cam: MountCam, mt: Mounts): THREE.Vector3 {
  if (cam === 'hood') return new THREE.Vector3(0, mt.hoodY, mt.hoodZ);
  if (cam === 'bumper') return new THREE.Vector3(0, mt.floor + MOUNT.bumperY, mt.nose - MOUNT.bumperAhead);
  // (A bike is narrow and its rider wide: stand the side mount off as if it were a car.)
  return new THREE.Vector3(-(Math.max(mt.half, MOUNT.sideMin) + MOUNT.sideOut), mt.floor + MOUNT.sideY, mt.nose * MOUNT.sideAt);
}
