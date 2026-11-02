// The garage's 3D showroom: your car on a slowly turning platform in a dark garage bay, under softbox
// strips (they're what draws the long highlights down the paint) with cyan and magenta neon behind.
// Drag (or the right stick) to spin it.

import * as THREE from 'three';
import { type OwnedCar, carSpec } from '../shared/cars.ts';
import { padAxis } from '../../client/pad.ts';
import { type CarModel, buildCar } from './carmodel.ts';
import { Post } from './post.ts';
import { stone } from './tracktextures.ts';

const CYAN = new THREE.Color(0x38c9ff);
const MAGENTA = new THREE.Color(0xff3d9a);

/** What the paint reflects: a dark bay, three softbox strips overhead, a neon panel each side. */
function garageEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
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
    key.castShadow = true;
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
    this.post = new Post(this.renderer, this.scene, this.camera, {
      bloom: 0.45,
      threshold: 5,
      contrast: 1.12,
      saturation: 1.02,
      shadows: [0.9, 0.96, 1.12],
      highlights: [1.04, 1.0, 0.96],
      vignette: 0.55,
    });
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
    const m = buildCar(owned);
    const sp = carSpec(owned);
    m.root.position.y = sp.cg;
    // Wheels at rest: centres one radius above the floor.
    m.pose([0, 1, 2, 3].map(() => ({ y: sp.radius - sp.cg, angle: 0 })), 0.18, false);
    this.turntable.add(m.root);
    this.model = m;
  }

  private down = (e: PointerEvent) => {
    this.dragging = true;
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private up = () => (this.dragging = false);
  private move = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.vel = e.movementX * 0.5;
    this.spin += e.movementX * 0.008;
  };

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.post.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    // Pull back on narrow screens so the whole car fits.
    const d = this.camera.aspect < 1.2 ? 11 : 9;
    this.camera.position.set(d * 0.7, 2.2, d * 0.7);
    this.camera.lookAt(0, 0.5, 0);
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    if (!this.canvas.isConnected) return this.dispose();
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const stick = padAxis(2); // right stick
    if (Math.abs(stick) > 0.1) this.vel = stick * 2.5;
    else if (!this.dragging) this.vel += (0.25 - this.vel) * Math.min(1, dt * 1.5);
    if (!this.dragging) this.spin += this.vel * dt;
    this.turntable.rotation.y = this.spin;
    this.post.render(now / 1000);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    removeEventListener('pointerup', this.up);
    removeEventListener('pointermove', this.move);
    this.model?.dispose();
    this.post.dispose();
    for (const d of this.own) d.dispose();
    this.renderer.dispose();
  }
}
