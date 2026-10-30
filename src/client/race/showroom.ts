// The garage's 3D showroom: your car on a slowly turning platform under studio lights. Drag (or the
// right stick) to spin it.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { type OwnedCar, carSpec } from '../../shared/race/cars.ts';
import { padAxis } from '../pad.ts';
import { type CarModel, buildCar } from './carmodel.ts';

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

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.turntable.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.32, 96), new THREE.MeshBasicMaterial({ color: 0x38c9ff }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.turntable.add(ring);
    this.scene.add(this.turntable);
    const key = new THREE.SpotLight(0xffffff, 28, 20, 0.7, 0.8, 1.2);
    key.position.set(3, 7, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 1.2);
    rim.position.set(-5, 3, -5);
    this.scene.add(rim);
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
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    removeEventListener('pointerup', this.up);
    removeEventListener('pointermove', this.move);
    this.model?.dispose();
    this.renderer.dispose();
  }
}
