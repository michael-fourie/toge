// The map builder's 3D view (mapbuilder.ts): the map's real world, built by the race's own renderer (trackview.ts
// `buildTrackView`, the props from propview.ts, the post chain), seen through a free editor camera.
//
// The camera: right-drag looks round (and with it held, WASD / QE fly, Shift faster), a left-drag on the ground grabs
// it and pans, a middle-drag orbits round the spot in the middle of the view, the wheel zooms toward the cursor. The
// builder draws its handles, gizmos and markers on a 2D canvas over this one, through `project`, and finds the ground
// under the cursor with `pickGround` (a ray marched over the track's own heightAt, so it's exact and needs no meshes).
//
// The world is rebuilt from scratch when the road changes (`setTrack`): the scenery is merged into big meshes for the
// race's sake, so there's nothing to patch. The builder calls it once an edit settles, not during a drag.

import * as THREE from 'three';
import { type Track, heightAt } from '../shared/track.ts';
import { lowGraphics, releaseRenderer } from '../../client/graphics.ts';
import { buildTrackView, type TrackView } from './trackview.ts';
import { Post } from './post.ts';
import { PropView } from './propview.ts';

/** Camera feel: look speed (rad/px), fly speed (m/s; Shift ×4), zoom per wheel notch, and the closest it gets. */
export const CAM = { look: 0.0042, fly: 60, fast: 4, zoom: 0.0012, near: 4, far: 9000, fov: 58, pitchMin: -1.5, pitchMax: 0.6 };

export class MapWorld {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.5, CAM.far);
  /** The camera's place and aim (yaw 0 looks down -z, pitch below 0 looks down). */
  pos = new THREE.Vector3(0, 220, 420);
  yaw = 0;
  pitch = -0.45;
  /** Called after each frame drawn, so the builder redraws its overlay to match. */
  onFrame: () => void = () => {};
  track: Track | null = null;
  /** A level to pick on when there's no road to read the ground from (a map that doesn't build, or a sky road). */
  level = 0;
  /** Right mouse held: WASD flies. */
  flying = false;
  private renderer: THREE.WebGLRenderer;
  private low = lowGraphics();
  private view: TrackView | null = null;
  private post: Post | null = null;
  private props: PropView | null = null;
  private empty = new THREE.Scene();
  private dirty = true;
  private raf = 0;
  private last = 0;
  private keys = new Set<string>();
  private w = 1;
  private h = 1;
  private v = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.low ? 1 : 1.5));
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'tg-mb-gl';
    host.prepend(this.canvas);
    this.empty.background = new THREE.Color(0x0a0f17);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.stopFlying);
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      this.last = now;
      if (this.flying && this.keys.size) this.fly(dt);
      if (!this.dirty) return;
      this.dirty = false;
      this.aim();
      if (this.view && this.post) {
        // Keep the shadow box and the sea round where the camera looks.
        const f = this.forward(this.v);
        this.view.follow(this.pos.x + f.x * 120, this.pos.y + f.y * 120, this.pos.z + f.z * 120, now / 1000);
        this.post.render(now / 1000);
      } else this.renderer.render(this.empty, this.camera);
      this.onFrame();
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Redraw on the next frame. */
  invalidate() {
    this.dirty = true;
  }

  setSize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(this.w, this.h);
    this.invalidate();
  }

  /** Builds the world for a road (null: no world, just the grid of handles). Takes 0.2-1.5 s for a big map. */
  setTrack(t: Track | null) {
    this.clear();
    this.track = t;
    if (t) {
      this.view = buildTrackView(t, this.renderer, this.low);
      this.renderer.toneMappingExposure = this.view.exposure;
      this.post = new Post(this.renderer, this.view.scene, this.camera, this.view.grade, this.low);
      this.post.sun = this.view.sunDir;
      this.post.setSize(this.w, this.h);
      this.props = new PropView(this.view.scene, t);
    }
    this.invalidate();
  }

  private clear() {
    this.props?.dispose();
    this.post?.dispose();
    this.view?.dispose();
    this.props = null;
    this.post = null;
    this.view = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.stopFlying);
    this.clear();
    releaseRenderer(this.renderer);
    this.canvas.remove();
  }

  // ---- the camera ------------------------------------------------------------------------------------------------
  private aim() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }
  forward(out: THREE.Vector3) {
    const c = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c);
  }

  /** Turns the view by a mouse movement (px). */
  look(dx: number, dy: number) {
    this.yaw -= dx * CAM.look;
    this.pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, this.pitch - dy * CAM.look));
    this.invalidate();
  }

  /** Swings the camera round a pivot (a mouse movement, px). */
  orbit(px: number, pz: number, dx: number, dy: number) {
    const ox = this.pos.x - px;
    const oz = this.pos.z - pz;
    const a = -dx * CAM.look;
    this.pos.x = px + ox * Math.cos(a) - oz * Math.sin(a);
    this.pos.z = pz + ox * Math.sin(a) + oz * Math.cos(a);
    this.yaw += a;
    // Tilt: raise or lower the camera round the pivot, keeping its distance.
    const d = Math.hypot(this.pos.x - px, this.pos.z - pz);
    const pitch = Math.max(CAM.pitchMin, Math.min(-0.08, this.pitch - dy * CAM.look));
    const k = Math.tan(-pitch) / Math.max(1e-3, Math.tan(-this.pitch));
    this.pos.y += d * Math.tan(-this.pitch) * (k - 1);
    this.pitch = pitch;
    this.invalidate();
  }

  /** Zooms toward a screen point by a wheel delta: a share of the way to the ground there. */
  zoom(sx: number, sy: number, delta: number) {
    const hit = this.pickGround(sx, sy);
    const { d } = this.ray(sx, sy);
    const dist = hit ? Math.hypot(hit[0] - this.pos.x, hit[1] - this.pos.y, hit[2] - this.pos.z) : 400;
    const step = Math.max(-dist * 2, Math.min(dist - CAM.near, dist * (1 - Math.exp(-delta * CAM.zoom))));
    this.pos.addScaledVector(d, step);
    this.keepAboveGround();
    this.invalidate();
  }

  /** Moves the camera by a world offset (a grab pan). */
  shift(dx: number, dz: number) {
    this.pos.x += dx;
    this.pos.z += dz;
    this.keepAboveGround();
    this.invalidate();
  }

  /** Looks at a spot from `dist` metres away, from the side the camera is on now. */
  focus(x: number, y: number, z: number, dist = 160) {
    const pitch = Math.min(this.pitch, -0.35);
    const back = Math.cos(pitch) * dist;
    this.pos.set(x + Math.sin(this.yaw) * back, y - Math.sin(pitch) * dist, z + Math.cos(this.yaw) * back);
    this.pitch = pitch;
    this.keepAboveGround();
    this.invalidate();
  }

  /** Frames a box of ground from the south-east, high enough to see all of it. */
  frameBox(x0: number, x1: number, z0: number, z1: number, y: number) {
    const span = Math.max(120, x1 - x0, z1 - z0);
    this.yaw = Math.PI * 0.12;
    this.pitch = -0.62;
    this.focus((x0 + x1) / 2, y, (z0 + z1) / 2, span * 0.95);
  }

  private keepAboveGround() {
    const t = this.track;
    const g = t && !t.def.sky ? heightAt(t, this.pos.x, this.pos.z) : this.level;
    this.pos.y = Math.max(this.pos.y, g + 3);
  }

  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!'wasdqe'.includes(k) && k !== 'shift') return;
    if (e.type === 'keydown') {
      if (!this.flying) return;
      this.keys.add(k);
      e.preventDefault();
    } else this.keys.delete(k);
  };
  private stopFlying = () => {
    this.flying = false;
    this.keys.clear();
  };
  setFlying(on: boolean) {
    this.flying = on;
    if (!on) this.keys.clear();
  }

  private fly(dt: number) {
    const k = this.keys;
    const speed = CAM.fly * (k.has('shift') ? CAM.fast : 1) * Math.max(1, (this.pos.y - (this.track && !this.track.def.sky ? heightAt(this.track, this.pos.x, this.pos.z) : this.level)) / 80);
    const f = this.forward(this.v);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const side = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const up = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    this.pos.x += (f.x * fwd + rx * side) * speed * dt;
    this.pos.y += (f.y * fwd + up) * speed * dt;
    this.pos.z += (f.z * fwd + rz * side) * speed * dt;
    this.keepAboveGround();
    this.invalidate();
  }

  // ---- screen and world ----------------------------------------------------------------------------------------
  /** A world point on the screen (CSS px), or null when it's behind the camera. */
  project(x: number, y: number, z: number): [number, number] | null {
    const p = this.v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (p.z > -0.5) return null;
    p.applyMatrix4(this.camera.projectionMatrix);
    return [(p.x * 0.5 + 0.5) * this.w, (-p.y * 0.5 + 0.5) * this.h];
  }

  /** The ray through a screen point: origin and unit direction. */
  ray(sx: number, sy: number): { o: THREE.Vector3; d: THREE.Vector3 } {
    this.aim();
    const d = new THREE.Vector3((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return { o: this.camera.position.clone(), d };
  }

  /** Where a screen ray meets the level y, or null. */
  pickPlane(sx: number, sy: number, y: number): [number, number] | null {
    const { o, d } = this.ray(sx, sy);
    if (Math.abs(d.y) < 1e-4) return null;
    const k = (y - o.y) / d.y;
    if (k <= 0 || k > CAM.far) return null;
    return [o.x + d.x * k, o.z + d.z * k];
  }

  /** The ground (road and hills) under a screen point: [x, y, z], or null when the ray misses it. */
  pickGround(sx: number, sy: number): [number, number, number] | null {
    const t = this.track;
    if (!t || t.def.sky) {
      const p = this.pickPlane(sx, sy, this.level);
      return p ? [p[0], this.level, p[1]] : null;
    }
    const { o, d } = this.ray(sx, sy);
    const above = (k: number) => o.y + d.y * k - heightAt(t, o.x + d.x * k, o.z + d.z * k);
    let k0 = 0;
    let k = 0;
    // March out with steps that grow with distance, then close in on the crossing.
    while (k < CAM.far * 0.7) {
      const step = Math.max(1.5, k * 0.012);
      k += step;
      if (above(k) <= 0) {
        let a = k0;
        let b = k;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          if (above(m) > 0) a = m;
          else b = m;
        }
        const x = o.x + d.x * b;
        const z = o.z + d.z * b;
        return [x, heightAt(t, x, z), z];
      }
      k0 = k;
    }
    return null;
  }

  /** The ground's height at a spot, for markers (the level on a sky road or with no road). */
  groundY(x: number, z: number): number {
    const t = this.track;
    return t && !t.def.sky ? heightAt(t, x, z) : this.level;
  }

  /** Metres per screen pixel at a world point (for dragging heights). */
  metresPerPx(x: number, y: number, z: number): number {
    const dist = Math.hypot(x - this.pos.x, y - this.pos.y, z - this.pos.z);
    return (2 * dist * Math.tan((CAM.fov * Math.PI) / 360)) / this.h;
  }
}
