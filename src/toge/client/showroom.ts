// The garage's 3D showroom: your car on a slowly turning platform in a dark garage bay, under softbox
// strips (they're what draws the long highlights down the paint) with cyan and magenta neon behind.
// Drag (or the right stick) to spin it. Your driver stands on the platform by the driver's door (right-hand drive,
// so the car's right, +X; the nose is -Z); focus('rider') turns them to the camera and walks in close.

import * as THREE from 'three';
import { CARS, type OwnedCar, carSpec } from '../shared/cars.ts';
import { type Rider, encodeRider } from '../shared/rider.ts';
import { padAxis } from '../../client/pad.ts';
import { type CarModel, buildCar } from './carmodel.ts';
import { type RiderModel, buildRider } from './ridermodel.ts';
import { Post } from './post.ts';
import { frameGate, lowGraphics, LOW_PIXEL_RATIO } from '../../client/graphics.ts';
import { stone } from './tracktextures.ts';

const CYAN = new THREE.Color(0x38c9ff);
const MAGENTA = new THREE.Color(0xff3d9a);

/** What the paint reflects: a dark bay, three softbox strips overhead, a neon panel each side. */
export function garageEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const own: { dispose(): void }[] = [];
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, at?: [number, number, number]) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    if (at) {
      m.position.set(...at);
      m.lookAt(0, 0, 0);
    }
    scene.add(m);
    own.push(geo, mat);
  };
  add(new THREE.SphereGeometry(40, 24, 12), new THREE.Color(0.012, 0.014, 0.02));
  add(new THREE.CircleGeometry(30, 24).rotateX(-Math.PI / 2).translate(0, -2, 0), new THREE.Color(0.02, 0.02, 0.025));
  for (const x of [-4, 0, 4]) add(new THREE.PlaneGeometry(1.2, 16), new THREE.Color(7, 7, 7.4), [x, 10, 0]);
  add(new THREE.PlaneGeometry(10, 2), CYAN.clone().multiplyScalar(3), [-14, 2, -6]);
  add(new THREE.PlaneGeometry(10, 2), MAGENTA.clone().multiplyScalar(3), [14, 2, -6]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  for (const d of own) d.dispose();
  return tex;
}

/** A radial fade, so the floor melts into the dark instead of ending at an edge. */
function fadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#bbb');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Showroom {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private turntable = new THREE.Group();
  private model: CarModel | null = null;
  private raf = 0;
  private spin = 0.6;
  private vel = 0.25;
  private dragging = false;
  private last = performance.now();
  private ro: ResizeObserver;
  private post: Post;
  private own: { dispose(): void }[] = [];
  /** Where on the canvas the car sits (fractions of its width and height); see place(). */
  private fx = 0.5;
  private fy = 0.5;
  private zoom = 1;
  private rider: RiderModel | null = null;
  private riderCode = '';
  /** Where the driver stands on the turntable (x follows the car's width). */
  private riderAt = new THREE.Vector3(1.5, 0, -0.25);
  /** 0 = the car view, 1 = close on the driver; eases toward `focusOn`. */
  private focusK = 0;
  private focusOn: 'car' | 'rider' = 'car';
  /** The driver's own turn (dragging while focused on them spins the driver, not the car). */
  private riderYaw = 0;
  private dist = 9;
  private readonly look = new THREE.Vector3();
  /** Low graphics (src/client/graphics.ts), read when the showroom opens, and its frame cap. */
  private readonly low = lowGraphics();
  private gate = frameGate(30);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.low ? LOW_PIXEL_RATIO : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const keep = <T extends { dispose(): void }>(x: T) => (this.own.push(x), x);
    this.scene.environment = keep(garageEnvironment(this.renderer));
    this.scene.environmentIntensity = 0.7;
    this.scene.background = new THREE.Color(0x05070b);
    this.scene.fog = new THREE.Fog(0x05070b, 12, 26);

    // Polished concrete, damp-looking, fading out into the dark.
    const tex = stone(5);
    for (const t of Object.values(tex)) {
      keep(t);
      t.repeat.set(5, 5);
    }
    tex.map.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      keep(new THREE.CircleGeometry(16, 64)),
      keep(new THREE.MeshStandardMaterial({ color: 0x1a1c21, ...tex, normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.6, envMapIntensity: 0.35, alphaMap: keep(fadeTexture()), transparent: true, depthWrite: false })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.004;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // The turntable: a dark steel plate ringed in neon.
    const plate = new THREE.Mesh(keep(new THREE.CylinderGeometry(4.2, 4.3, 0.06, 96)), keep(new THREE.MeshStandardMaterial({ color: 0x0c0d11, metalness: 0.3, roughness: 0.7, envMapIntensity: 0.4 })));
    plate.position.y = -0.03;
    plate.receiveShadow = true;
    this.turntable.add(plate);
    for (const [r0, r1, c, k] of [
      [4.2, 4.3, CYAN, 2.2],
      [3.9, 3.93, MAGENTA, 1.6],
    ] as const) {
      const ring = new THREE.Mesh(keep(new THREE.RingGeometry(r0, r1, 128)), keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k) })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      this.turntable.add(ring);
    }
    this.scene.add(this.turntable);
    const key = new THREE.SpotLight(0xfff6ea, 34, 22, 0.65, 0.85, 1.2);
    key.position.set(2, 8, 3);
    key.castShadow = !this.low;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    // Neon rims from behind, one each side.
    // High and wide, so they edge the car without glaring off the floor into the camera.
    const rimC = new THREE.DirectionalLight(CYAN, 1.6);
    rimC.position.set(-8, 6, -2);
    const rimM = new THREE.DirectionalLight(MAGENTA, 1.2);
    rimM.position.set(8, 6, -2);
    this.scene.add(rimC, rimM);
    // Low's simple materials don't see the garage environment: a soft fill stands in for it.
    if (this.low) this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20232a, 1.6));
    this.post = new Post(this.renderer, this.scene, this.camera, {
      bloom: 0.45,
      threshold: 5,
      contrast: 1.12,
      saturation: 1.02,
      shadows: [0.9, 0.96, 1.12],
      highlights: [1.04, 1.0, 0.96],
      vignette: 0.55,
    }, this.low);
    this.camera.position.set(6.4, 2.1, 6.4);
    this.camera.lookAt(0, 0.45, 0);
    canvas.addEventListener('pointerdown', this.down);
    addEventListener('pointerup', this.up);
    addEventListener('pointermove', this.move);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  show(owned: OwnedCar) {
    if (this.model) {
      this.turntable.remove(this.model.root);
      this.model.dispose();
    }
    const m = buildCar(owned, null); // your driver stands beside it (showRider)
    const sp = carSpec(owned);
    m.root.position.y = sp.cg;
    // Wheels at rest: centres one radius above the floor.
    m.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), 0.18, false);
    this.turntable.add(m.root);
    this.model = m;
    this.riderAt.x = CARS[owned.model].width / 2 + 0.62;
    this.rider?.root.position.copy(this.riderAt);
  }

  /** Puts your driver beside the car (rebuilt only when the look changes). */
  showRider(r: Rider) {
    const code = encodeRider(r);
    if (code === this.riderCode) return;
    this.riderCode = code;
    this.rider?.dispose();
    this.rider = buildRider(r);
    this.rider.root.position.copy(this.riderAt);
    this.turntable.add(this.rider.root);
  }

  /** Frame the car, or walk the camera in to the driver (the Driver page). */
  focus(on: 'car' | 'rider') {
    if (on === this.focusOn) return;
    this.focusOn = on;
    if (on === 'rider') {
      // Turn the platform the short way round to where the driver faces the camera.
      const want = Math.PI / 4 - Math.atan2(this.riderAt.x, this.riderAt.z);
      this.spin = want + Math.round((this.spin - want) / (Math.PI * 2)) * Math.PI * 2;
      this.riderYaw = 0;
    }
  }

  /**
   * Frame the car at (x, y), fractions of the canvas from its top left, so a canvas that fills the window can keep
   * the car in the space beside a panel. Shifts the view, not the camera, so the angle stays the same. `zoom` < 1
   * shrinks the car to fit a short strip (phones).
   */
  place(x: number, y: number, zoom = 1) {
    if (Math.abs(x - this.fx) < 1e-3 && Math.abs(y - this.fy) < 1e-3 && Math.abs(zoom - this.zoom) < 1e-3) return;
    this.fx = x;
    this.fy = y;
    this.zoom = zoom;
    this.resize();
  }

  private down = (e: PointerEvent) => {
    this.dragging = true;
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private up = () => (this.dragging = false);
  private move = (e: PointerEvent) => {
    if (!this.dragging) return;
    if (this.focusOn === 'rider') {
      this.riderYaw += e.movementX * 0.01;
      return;
    }
    this.vel = e.movementX * 0.5;
    this.spin += e.movementX * 0.008;
  };

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.post.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    // Pull back on narrow screens so the whole car fits (the free space beside a panel is narrower than the canvas).
    const free = this.camera.aspect * Math.min(this.fx, 1 - this.fx) * 2;
    this.dist = free < 1.2 ? 11 : 9;
    this.aim();
    this.camera.zoom = this.zoom;
    this.camera.setViewOffset(r.width, r.height, -(this.fx - 0.5) * r.width, -(this.fy - 0.5) * r.height, r.width, r.height);
    this.camera.updateProjectionMatrix();
  }

  /** Places the camera between the car view and the driver close-up (focusK). */
  private aim() {
    const d = this.dist;
    const f = this.focusK * this.focusK * (3 - 2 * this.focusK);
    // The close-up: where the driver ends up once the platform has turned (the camera's bearing, π/4).
    const r = Math.hypot(this.riderAt.x, this.riderAt.z);
    const h = this.rider?.height ?? 1.75;
    const tx = r * Math.SQRT1_2;
    const near = d * 0.56;
    this.look.set(tx * f, 0.5 + (h * 0.5 - 0.5) * f, tx * f);
    this.camera.position.set(d * 0.7 + (tx + near * 0.7 - d * 0.7) * f, 2.2 + (h * 0.6 - 2.2) * f, d * 0.7 + (tx + near * 0.7 - d * 0.7) * f);
    this.camera.lookAt(this.look);
  }

  private frame = (now: number) => {
    if (!this.canvas.isConnected) return this.dispose();
    this.raf = requestAnimationFrame(this.frame);
    if (!this.gate(now)) return; // Low: a turntable doesn't need more than 30 frames a second
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const stick = padAxis(2); // right stick
    const onRider = this.focusOn === 'rider';
    if (onRider) {
      // Hold the platform still with the driver to camera; the stick turns the driver.
      if (Math.abs(stick) > 0.1) this.riderYaw += stick * 2.5 * dt;
      else if (!this.dragging) this.riderYaw *= 1 - Math.min(1, dt * 0.6);
      this.vel = 0;
      this.turntable.rotation.y += (this.spin - this.turntable.rotation.y) * Math.min(1, dt * 4);
    } else {
      if (Math.abs(stick) > 0.1) this.vel = stick * 2.5;
      else if (!this.dragging) this.vel += (0.25 - this.vel) * Math.min(1, dt * 1.5);
      if (!this.dragging) this.spin += this.vel * dt;
      this.turntable.rotation.y = this.spin;
    }
    const k0 = this.focusK;
    this.focusK += ((onRider ? 1 : 0) - this.focusK) * Math.min(1, dt * 3.5);
    if (Math.abs(this.focusK - k0) > 1e-5) this.aim();
    if (this.rider) {
      this.rider.root.rotation.y = Math.PI / 2 + 0.35 + this.riderYaw;
      this.rider.update(now / 1000);
    }
    this.post.render(now / 1000);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    removeEventListener('pointerup', this.up);
    removeEventListener('pointermove', this.move);
    this.model?.dispose();
    this.rider?.dispose();
    this.post.dispose();
    for (const d of this.own) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // the canvas is never reused: give the GPU context back now
  }
}
