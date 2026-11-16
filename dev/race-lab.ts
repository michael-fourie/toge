// Dev-only lab for the KANJO race renderer: a solo race on any track, driven by the AI and stepped by hand, so the
// same shot can be taken before and after a visual change and its frame cost measured.
// /dev/race.html?track=koripass&car=vanta&rivals=5 (track=kanjo: the open world; place() and look() frame shots of it) (Low graphics follows the Settings tab: localStorage atrous.graphics).
// window.rl: drive(seconds) (the AI drives your car; the sim is stepped, nothing waits on frames), cam(name), place(x, z, yaw), look(...),
// draw() (one frame), cost(frames) ({ ms per frame with the GPU drained, draw calls, triangles }).

import { CAR_IDS, type CarId, newOwnedCar } from '../src/kanjo/shared/cars.ts';
import { defaultRider } from '../src/kanjo/shared/rider.ts';
import { type TrackId, heightAt, locate, newLoc } from '../src/kanjo/shared/track.ts';
import { TICK_DT, placeCar } from '../src/kanjo/shared/vehicle.ts';
import { aiDrive, newAi } from '../src/kanjo/shared/driver.ts';
import { DataUtils } from 'three';
import { RaceGame } from '../src/kanjo/client/racegame.ts';

const q = new URLSearchParams(location.search);
const car = (q.get('car') ?? 'kitsune') as CarId;
const race = new RaceGame({
  container: document.getElementById('c')!,
  track: (q.get('track') ?? 'koripass') as TrackId,
  name: 'Lab',
  car: newOwnedCar(CAR_IDS.includes(car) ? car : 'kitsune', Number(q.get('paint') ?? 0)),
  rider: defaultRider(),
  rivals: Number(q.get('rivals') ?? 5),
  onExit() {},
});

// The lab steps the race itself: no animation frames.
type Inner = {
  raf: number;
  tick(): void;
  render(dt: number, alpha: number): void;
  fx: { update(dt: number): void };
  me: { car: import('../src/kanjo/shared/vehicle.ts').Car };
  track: import('../src/kanjo/shared/track.ts').Track;
  controls: { input: { steer: number; throttle: number; brake: number; handbrake: number; drift: number } };
  cam: string;
  renderer: import('three').WebGLRenderer;
  camera: import('three').PerspectiveCamera;
  view: { sunDir: import('three').Vector3 | null };
  updateCamera(dt: number, view: unknown): void;
  snapCamera(): void;
};
const r = race as unknown as Inner;
cancelAnimationFrame(r.raf);
const ai = newAi(0.9, 0);
let sunAt: number | null = null;
/** A fixed camera (position, then the point it looks at) for overview shots, or null for the game's own. */
let fixed: number[] | null = null;
const updateCamera = r.updateCamera.bind(r);
r.updateCamera = (dt, view) => {
  updateCamera(dt, view);
  if (fixed) {
    r.camera.position.set(fixed[0], fixed[1], fixed[2]);
    r.camera.lookAt(fixed[3], fixed[4], fixed[5]);
    return;
  }
  const d = r.view.sunDir;
  if (sunAt === null || !d) return;
  const c = r.camera.position;
  r.camera.lookAt(c.x + d.x * 100, c.y + d.y * 100 * sunAt, c.z + d.z * 100);
};
const loc = newLoc();
const out = { steer: 0, throttle: 0, brake: 0, handbrake: 0, drift: 0 };

(window as unknown as { rl: unknown }).rl = {
  race,
  drive(seconds: number) {
    for (let t = 0; t < seconds; t += TICK_DT) {
      aiDrive(r.me.car, r.track, ai, TICK_DT, out);
      Object.assign(r.controls.input, out, { drift: 0 });
      r.tick();
      r.fx.update(TICK_DT);
      // The chase camera eases after the car: settle it over the last second (a few frames are enough).
      if (seconds - t < 1 && Math.round(t / TICK_DT) % 6 === 0) r.render(TICK_DT * 6, 1);
    }
  },
  /** Which road the AI takes where the track forks (Track.fork): the second one, or the main one. */
  fork(second: boolean) {
    ai.alt = second;
  },
  cam(name: string) {
    r.cam = name;
  },
  /** Puts your car down at (x, z) facing `yaw`, on whatever's there (free roam: the open world's roads). */
  place(x: number, z: number, yaw = 0) {
    const c = r.me.car;
    const y = heightAt(r.track, x, z, undefined, -1);
    placeCar(c, x, y, z, yaw, -1);
    locate(r.track, x, z, -1, loc);
    c.hint = loc.i;
    for (let i = 0; i < 64; i++) r.tick();
    r.snapCamera();
  },
  /** A fixed camera at (x, y, z) looking at (tx, ty, tz) for the next draws; no arguments: back to the game's. */
  look(...at: number[]) {
    fixed = at.length === 6 ? at : null;
  },
  /** Turns the camera towards the sun (`at` = 0: level with the horizon, 1: straight at it), or back (null). */
  sun(at: number | null) {
    sunAt = at;
  },
  /** The scene's brightness (after exposure) where the sun is on screen, as the flare sees it. */
  probe() {
    const post = (race as unknown as { post: { composer: { readBuffer: import('three').WebGLRenderTarget; writeBuffer: import('three').WebGLRenderTarget }; grade: { uniforms: Record<string, { value: unknown }> } } }).post;
    r.render(1 / 60, 1);
    const uv = post.grade.uniforms.sunUv.value as import('three').Vector2;
    const exposure = post.grade.uniforms.exposure.value as number;
    // The grade pass swaps the buffers after it draws: its input is whichever holds the image.
    const lum = [post.composer.readBuffer, post.composer.writeBuffer].map((rt) => {
      const half = new Uint16Array(4);
      const x = Math.round(uv.x * rt.width), y = Math.round(uv.y * rt.height);
      if (x >= 0 && y >= 0 && x < rt.width && y < rt.height) r.renderer.readRenderTargetPixels(rt, x, y, 1, 1, half);
      const px = [...half].map((h) => DataUtils.fromHalfFloat(h));
      return (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) * exposure;
    });
    return { uv: [uv.x, uv.y], flare: post.grade.uniforms.flare.value, lum };
  },
  draw() {
    r.render(1 / 60, 1);
  },
  cost(frames = 5) {
    const gl = r.renderer.getContext();
    const px = new Uint8Array(4);
    r.render(1 / 60, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) r.render(1 / 60, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / frames;
    // The post chain renders several times a frame: count the whole frame.
    r.renderer.info.autoReset = false;
    r.renderer.info.reset();
    r.render(1 / 60, 1);
    r.renderer.info.autoReset = true;
    const info = r.renderer.info.render;
    return { ms: Math.round(ms), calls: info.calls, triangles: info.triangles };
  },
};
