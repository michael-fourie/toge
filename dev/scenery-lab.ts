// Dev-only lab for KANJO track scenery: any track's view (trackview.ts) through the race's post chain, from any spot.
// window.scn: load(id, low?), at(s, d, height, ahead, turnDeg?) puts the camera at distance s along the road, d across
// it, looking `ahead` metres down the road, render() draws a frame, info() is the renderer's draw calls and triangles.

import * as THREE from 'three';
import { type TrackId, getTrack, pointAt } from '../src/kanjo/shared/track.ts';
import { type TrackView, buildTrackView } from '../src/kanjo/client/trackview.ts';
import { Post } from '../src/kanjo/client/post.ts';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 9000);
let view: TrackView | null = null;
let post: Post | null = null;
let id: TrackId = 'koripass';
let low = false;

function size() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post?.setSize(w, h);
}

const scn = {
  load(track: TrackId, lowGfx = false) {
    post?.dispose();
    view?.dispose();
    id = track;
    low = lowGfx;
    renderer.shadowMap.enabled = !low;
    view = buildTrackView(getTrack(id), renderer, low);
    renderer.toneMappingExposure = view.exposure;
    post = new Post(renderer, view.scene, camera, view.grade, low);
    size();
    return scn.info();
  },
  at(s: number, d = 0, height = 2.2, ahead = 40, turnDeg = 0) {
    const t = getTrack(id);
    const p = pointAt(t, s, d);
    const q = pointAt(t, s + ahead, d * 0.5);
    camera.position.set(p.x, p.y + height, p.z);
    const look = new THREE.Vector3(q.x - p.x, 0, q.z - p.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(turnDeg));
    camera.lookAt(p.x + look.x, q.y + height * 0.4, p.z + look.z);
    view!.follow(p.x, p.y, p.z, 0);
  },
  /** Where the houses, shrines and landmarks went: { houses, shrines, marks } as [x, y, z]. */
  props() {
    return view!.scene.userData.props;
  },
  /** Looks at the world point (x, y, z) from `dist` metres away, `up` metres higher, from compass angle `deg`. */
  look(x: number, y: number, z: number, dist = 40, up = 12, deg = 0) {
    const a = THREE.MathUtils.degToRad(deg);
    camera.position.set(x + Math.sin(a) * dist, y + up, z + Math.cos(a) * dist);
    camera.lookAt(x, y + 3, z);
    view!.follow(x, y, z, 0);
  },
  render() {
    renderer.info.reset();
    renderer.info.autoReset = false;
    post!.render(performance.now() / 1000);
    return scn.info();
  },
  info() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, length: getTrack(id).length };
  },
  /** Triangles in the whole scene per geometry (instances counted), biggest first. */
  budget() {
    const by = new Map<string, { tris: number; n: number; per: number; meshes: number }>();
    view!.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      const key = (m as THREE.InstancedMesh).isInstancedMesh ? `inst:${g.uuid.slice(0, 6)}:${per}` : `mesh:${(m.material as THREE.Material).type}`;
      const e = by.get(key) ?? { tris: 0, n: 0, per, meshes: 0 };
      e.tris += per * n;
      e.n += n;
      e.meshes++;
      by.set(key, e);
    });
    return [...by.entries()].sort((a, b) => b[1].tris - a[1].tris).slice(0, 12);
  },
  /** The track's scene, for poking at from the console. */
  scene() {
    return view!.scene;
  },
  shot() {
    return renderer.domElement.toDataURL('image/png');
  },
};
(window as unknown as { scn: typeof scn }).scn = scn;
addEventListener('resize', size);
