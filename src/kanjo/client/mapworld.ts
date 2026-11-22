// The map builder's 3D view (mapbuilder.ts): the map's real world, built by the race's own renderer (trackview.ts
// `buildTrackView`, the props from propview.ts, the post chain), seen through an editor camera that orbits and pans.
//
// The camera (2026-11-21, Michael found the first one "really hard to use"): a left-drag on empty ground grabs it and
// pans, a right-drag (or Alt + left) orbits round the spot you pressed on, the wheel zooms toward the cursor, WASD pans
// over the ground and Q / E turn round the middle of the view (Shift: faster), T looks straight down. Wheel and key
// moves ease toward where they're going (`EASE`); drags follow the mouse exactly, so grabbed ground stays under it.
// The builder draws its handles, gizmos and markers on a 2D canvas over this one, through `project`, and finds the
// ground under the cursor with `pickGround` (a ray marched over the track's own heightAt, so it's exact and needs no
// meshes).
//
// The world is rebuilt from scratch when the road changes (`setTrack`): the scenery is merged into big meshes for the
// race's sake, so there's nothing to patch. To keep that quick the canvas-painted surfaces are kept across builds
// (`cache`: they only depend on the theme and seed) and the new world is built before the old one goes, so three.js
// reuses its compiled shaders instead of compiling them all again. Frames are only drawn when something moved.

import * as THREE from 'three';
import { type Track, heightAt } from '../shared/track.ts';
import { lowGraphics, releaseRenderer } from '../../client/graphics.ts';
import { buildTrackView, type TrackView } from './trackview.ts';
import { Post } from './post.ts';
import { PropView } from './propview.ts';

/**
 * Camera feel: turn per px dragged (rad), how fast keys pan (a share of the height over the ground per second) and
 * turn (rad/s), Shift's speed-up, zoom per wheel unit, the closest it gets to the ground, field of view, the pitch
 * range (rad; below 0 looks down), and how quickly eased moves arrive (1/s).
 */
export const CAM = { turn: 0.005, pan: 1.1, spin: 1.4, fast: 3, zoom: 0.0016, near: 4, far: 9000, fov: 55, pitchMin: -1.53, pitchMax: -0.06, ease: 12 };
/** Resolution steps the view drops through when frames come slowly while it moves (× the device pixel ratio, capped). */
const RES = { steps: [1.5, 1.25, 1, 0.8], slowMs: 34, fastMs: 20, judge: 24 };

export class MapWorld {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.5, CAM.far);
  /** Where the camera is going (moves ease there) and its aim (yaw 0 looks down -z, pitch below 0 looks down). */
  pos = new THREE.Vector3(0, 220, 420);
  yaw = 0;
  pitch = -0.6;
  /** Where it is now (what's drawn, and what `project` and the picks use). */
  private at = { pos: new THREE.Vector3(0, 220, 420), yaw: 0, pitch: -0.6 };
  /** Called after each frame drawn, so the builder redraws its overlay to match. */
  onFrame: () => void = () => {};
  /** Whether the camera keys may act (the builder says no while you type, or in the plan view). */
  keysOn: () => boolean = () => true;
  track: Track | null = null;
  /** A level to pick on when there's no road to read the ground from (a map that doesn't build, or a sky road). */
  level = 0;
  /** The canvas-painted surfaces, kept across builds (trackview.ts `ViewOpts.cache`). */
  private cache = new Map<string, object>();
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
  private res = 0;
  private slow: number[] = [];
  private drew = false;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
    this.res = this.low ? RES.steps.indexOf(1) : 0;
    this.renderer.setPixelRatio(this.ratio());
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
    addEventListener('blur', this.dropKeys);
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const ms = now - (this.last || now);
      const dt = Math.min(0.05, ms / 1000);
      this.last = now;
      if (this.keys.size && this.keysOn()) this.drive(dt);
      const moving = this.ease(dt);
      if (!this.dirty && !moving) {
        this.drew = false;
        this.slow.length = 0;
        return;
      }
      this.dirty = false;
      // Judge the frame rate only over frames drawn back to back (a drag, an orbit, a glide).
      if (this.drew) this.adapt(ms);
      this.drew = true;
      this.aim();
      if (this.view && this.post) {
        // Keep the shadow box and the sea round where the camera looks.
        const f = this.forward(this.v);
        const p = this.at.pos;
        this.view.follow(p.x + f.x * 120, p.y + f.y * 120, p.z + f.z * 120, now / 1000);
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

  /** Whether there's a world to show. */
  get built() {
    return !!this.view;
  }

  /**
   * Builds the world for a road. The old world stays up until the new one is ready (and its shaders are shared, not
   * compiled again). Null takes the world away (a map with no road at all).
   */
  setTrack(t: Track | null) {
    const old = { props: this.props, post: this.post, view: this.view };
    this.track = t;
    this.props = null;
    this.post = null;
    this.view = null;
    if (t) {
      this.view = buildTrackView(t, this.renderer, this.low, { cache: this.cache });
      this.renderer.toneMappingExposure = this.view.exposure;
      this.post = new Post(this.renderer, this.view.scene, this.camera, this.view.grade, this.low);
      this.post.sun = this.view.sunDir;
      this.post.setSize(this.w, this.h);
      this.props = new PropView(this.view.scene, t);
    }
    old.props?.dispose();
    old.post?.dispose();
    old.view?.dispose();
    this.invalidate();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.dropKeys);
    this.props?.dispose();
    this.post?.dispose();
    this.view?.dispose();
    for (const s of this.cache.values()) for (const tex of Object.values(s)) (tex as { dispose?(): void }).dispose?.();
    this.cache.clear();
    releaseRenderer(this.renderer);
    this.canvas.remove();
  }

  // ---- the camera ------------------------------------------------------------------------------------------------
  private ratio() {
    return Math.min(devicePixelRatio || 1, 1.5) * (RES.steps[this.res] / 1.5);
  }
  /** Drops the resolution a step when frames come slowly while the view moves, and climbs back when they're quick. */
  private adapt(ms: number) {
    if (ms <= 0 || ms > 250) return;
    this.slow.push(ms);
    if (this.slow.length < RES.judge) return;
    const avg = this.slow.reduce((a, b) => a + b, 0) / this.slow.length;
    this.slow.length = 0;
    const to = avg > RES.slowMs ? Math.min(RES.steps.length - 1, this.res + 1) : avg < RES.fastMs ? Math.max(0, this.res - 1) : this.res;
    if (to === this.res) return;
    this.res = to;
    this.renderer.setPixelRatio(this.ratio());
    this.setSize(this.w, this.h);
  }

  /** Eases the drawn camera toward where it's going; true while it's still on its way. */
  private ease(dt: number): boolean {
    const a = this.at;
    const gap = a.pos.distanceTo(this.pos) + Math.abs(a.yaw - this.yaw) * 50 + Math.abs(a.pitch - this.pitch) * 50;
    if (gap < 0.01) return false;
    const k = 1 - Math.exp(-CAM.ease * dt);
    if (gap < 0.05) this.snap();
    else {
      a.pos.lerp(this.pos, k);
      a.yaw += (this.yaw - a.yaw) * k;
      a.pitch += (this.pitch - a.pitch) * k;
    }
    return true;
  }
  /** Puts the drawn camera where it's going at once (drags, so the ground stays under the mouse). */
  snap() {
    this.at.pos.copy(this.pos);
    this.at.yaw = this.yaw;
    this.at.pitch = this.pitch;
    this.invalidate();
  }
  private aim() {
    this.camera.position.copy(this.at.pos);
    this.camera.rotation.set(this.at.pitch, this.at.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }
  forward(out: THREE.Vector3, yaw = this.at.yaw, pitch = this.at.pitch) {
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }

  /**
   * Swings the camera round a pivot by a mouse movement (px): sideways turns round it, up and down tilts over it, and
   * the pivot stays put on the screen.
   */
  orbit(p: THREE.Vector3, dx: number, dy: number, ease = false) {
    const off = this.pos.clone().sub(p);
    const a = -dx * CAM.turn;
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const yaw = this.yaw + a;
    const pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, this.pitch - dy * CAM.turn));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const tilted = off.clone().applyAxisAngle(right, pitch - this.pitch);
    // Never tilt under the ground: keep the turn and skip the tilt.
    const low = this.floor(p.x + tilted.x, p.z + tilted.z) + 3;
    const keepTilt = p.y + tilted.y > low;
    this.pos.copy(p).add(keepTilt ? tilted : off);
    this.yaw = yaw;
    if (keepTilt) this.pitch = pitch;
    this.keepAboveGround();
    if (!ease) this.snap();
    this.invalidate();
  }

  /** Zooms toward a screen point by a wheel delta (positive: in): a share of the way to the ground there. */
  zoom(sx: number, sy: number, delta: number) {
    // From where the camera is going, so quick wheel turns add up.
    const hit = this.pickGround(sx, sy);
    const { d } = this.ray(sx, sy);
    const dist = hit ? Math.hypot(hit[0] - this.at.pos.x, hit[1] - this.at.pos.y, hit[2] - this.at.pos.z) : 400;
    const want = Math.max(CAM.near, Math.min(CAM.far * 0.5, dist * Math.exp(-delta * CAM.zoom)));
    this.pos.addScaledVector(d, dist - want);
    this.keepAboveGround();
    this.invalidate();
  }

  /** Moves the camera by a world offset (a grab pan follows the mouse exactly). */
  shift(dx: number, dz: number) {
    this.pos.x += dx;
    this.pos.z += dz;
    this.keepAboveGround();
    this.snap();
  }

  /** Looks at a spot from `dist` metres away, from the side the camera is on now (eased). */
  focus(x: number, y: number, z: number, dist = 160, pitch = Math.min(this.pitch, -0.45)) {
    const back = Math.cos(pitch) * dist;
    this.pos.set(x + Math.sin(this.yaw) * back, y - Math.sin(pitch) * dist, z + Math.cos(this.yaw) * back);
    this.pitch = pitch;
    this.keepAboveGround();
    this.invalidate();
  }

  /** Frames a box of ground from the south-east, high enough to see all of it. */
  frameBox(x0: number, x1: number, z0: number, z1: number, y: number, now = false) {
    const span = Math.max(120, x1 - x0, z1 - z0);
    this.yaw = Math.PI * 0.12;
    this.focus((x0 + x1) / 2, y, (z0 + z1) / 2, span * 1.05, -0.7);
    if (now) this.snap();
  }

  /** Looks straight down on the middle of the view (again: back to a three-quarter view). */
  topDown() {
    const c = this.pickGround(this.w / 2, this.h / 2);
    const p = c ? new THREE.Vector3(...c) : new THREE.Vector3(this.pos.x, this.level, this.pos.z - 200);
    const dist = this.pos.distanceTo(p);
    const down = this.pitch < -1.35;
    this.focus(p.x, p.y, p.z, dist, down ? -0.7 : CAM.pitchMin);
  }

  private floor(x: number, z: number) {
    const t = this.track;
    return t && !t.def.sky ? heightAt(t, x, z) : this.level;
  }
  private keepAboveGround() {
    this.pos.y = Math.max(this.pos.y, this.floor(this.pos.x, this.pos.z) + 3);
  }

  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!'wasdqe'.includes(k) && k !== 'shift') return;
    if (e.type === 'keyup') return void this.keys.delete(k);
    if (e.ctrlKey || e.metaKey || e.altKey || !this.keysOn()) return;
    this.keys.add(k);
  };
  private dropKeys = () => this.keys.clear();

  /** WASD pans over the ground, Q / E turn round the middle of the view; quicker the higher you are. */
  private drive(dt: number) {
    const k = this.keys;
    const fast = k.has('shift') ? CAM.fast : 1;
    const above = Math.max(20, this.pos.y - this.floor(this.pos.x, this.pos.z));
    const speed = CAM.pan * above * fast;
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const side = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const spin = (k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0);
    if (fwd || side) {
      this.pos.x += (-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side) * speed * dt;
      this.pos.z += (-Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side) * speed * dt;
      this.keepAboveGround();
    }
    if (spin) {
      const c = this.pickGround(this.w / 2, this.h / 2);
      const p = c ? new THREE.Vector3(...c) : this.pos.clone().addScaledVector(this.forward(this.v, this.yaw, this.pitch), 200);
      this.orbit(p, -(spin * CAM.spin * fast * dt) / CAM.turn, 0, true);
    }
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

  /** The ray through a screen point, from the camera as drawn: origin and unit direction. */
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
    return this.floor(x, z);
  }

  /** Metres per screen pixel at a world point (for dragging heights). */
  metresPerPx(x: number, y: number, z: number): number {
    const p = this.at.pos;
    const dist = Math.hypot(x - p.x, y - p.y, z - p.z);
    return (2 * dist * Math.tan((CAM.fov * Math.PI) / 360)) / this.h;
  }
}
