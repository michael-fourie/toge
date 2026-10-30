import * as THREE from 'three';
import type { Item } from '../../shared/items.ts';
import { buildKnife } from '../knife.ts';
import { buildWear } from '../wear.ts';
import { buildProceduralAwp } from '../weapon/awp.ts';

// Item pictures for the store and inventory: each item is rendered once with the real 3D model onto
// one shared offscreen canvas and cached as a data URL, so the screens stay light.

const SIZE = { w: 280, h: 170 };
const cache = new Map<string, string>();
let gl: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function setup() {
  if (gl) return gl;
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true });
  renderer.setSize(SIZE.w, SIZE.h, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0x9fb7d8, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  sun.position.set(-2, 4, -3);
  scene.add(sun);
  return (gl = { renderer, scene, camera: new THREE.PerspectiveCamera(28, SIZE.w / SIZE.h, 0.05, 50) });
}

/** The model plus the direction to look at it from (towards the model). */
function model(item: Item): { obj: THREE.Object3D; from: THREE.Vector3 } {
  if (item.slot === 'rifle') return { obj: buildProceduralAwp(0xe0614f, item.paint).root, from: new THREE.Vector3(1, 0.25, -0.5) };
  if (item.slot === 'knife') return { obj: buildKnife(item.paint), from: new THREE.Vector3(1, 0.35, -0.35) };
  return { obj: buildWear(item.wear), from: item.slot === 'back' ? new THREE.Vector3(0.6, 0.35, 1) : new THREE.Vector3(-0.6, 0.35, -1) };
}

/** A transparent PNG data URL of the item. */
export function itemIcon(item: Item): string {
  const hit = cache.get(item.id);
  if (hit) return hit;
  const { renderer, scene, camera } = setup();
  const { obj, from } = model(item);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  // Long things (rifle, machete) are framed by their width, since the card is wider than tall.
  const dist = (radius * (item.slot === 'rifle' ? 0.82 : 1.05)) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(center).addScaledVector(from.clone().normalize(), dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  obj.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  cache.set(item.id, url);
  return url;
}
