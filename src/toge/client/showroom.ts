// The garage's 3D showroom: your car on a slowly turning platform in a dark garage bay, under softbox
// strips (they're what draws the long highlights down the paint) with cyan and magenta neon behind.
// Drag (or the right stick) to spin it. Your driver stands on the platform by the driver's door (right-hand drive,
// so the car's right, +X; the nose is -Z); focus('rider') turns them to the camera and walks in close.

import * as THREE from 'three';
import { CARS, type OwnedCar, carSpec } from '../shared/cars.ts';
import type { Rider } from '../shared/rider.ts';
import { padAxis } from '../../client/pad.ts';
import { type CarModel, buildCar } from './carmodel.ts';
import { type DriverRig, loadDriver } from './driver.ts';
import { Post } from './post.ts';
import { frameGate, lowGraphics, LOW_PIXEL_RATIO } from '../../client/graphics.ts';
import { stone } from './tracktextures.ts';
import { type BgId, STAGES, type Stage } from '../shared/pass.ts';

const CYAN = new THREE.Color(0x38c9ff);
const MAGENTA = new THREE.Color(0xff3d9a);

/** What the paint reflects: a dark bay, three softbox strips overhead, a neon panel each side (a stage's own neon). */
export function garageEnvironment(renderer: THREE.WebGLRenderer, left = CYAN, right = MAGENTA, glow = new THREE.Color(0.012, 0.014, 0.02)): THREE.Texture {
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
  add(new THREE.SphereGeometry(40, 24, 12), glow);
  add(new THREE.CircleGeometry(30, 24).rotateX(-Math.PI / 2).translate(0, -2, 0), new THREE.Color(0.02, 0.02, 0.025));
  for (const x of [-4, 0, 4]) add(new THREE.PlaneGeometry(1.2, 16), new THREE.Color(7, 7, 7.4), [x, 10, 0]);
  add(new THREE.PlaneGeometry(10, 2), left.clone().multiplyScalar(3), [-14, 2, -6]);
  add(new THREE.PlaneGeometry(10, 2), right.clone().multiplyScalar(3), [14, 2, -6]);
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

/** A soft round dot for the motes (petals, leaves, embers, sparks, stars). */
function moteTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** The synthwave sun: a hot gradient disc cut by bars toward its foot. */
function sunTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#fff27a');
  grad.addColorStop(0.55, '#ff7a2b');
  grad.addColorStop(1, '#ff2bd6');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) g.fillRect(0, 150 + i * 18, 256, 3 + i * 1.6);
  return new THREE.CanvasTexture(c);
}

/**
 * The panorama's radius and its top and bottom (fractions of the radius above and below the camera's eye). The
 * showroom camera looks down at the car, so the real horizon is at the very top of the window: the stage's horizon
 * dips below it (`STAGE_DIP`), as if the garage stood on a ridge, and the scenery sits behind the car.
 */
const STAGE_R = 40;
const STAGE_DIP = 0.16;
const BD_TOP = 0.075;
const BD_BOTTOM = -STAGE_DIP;
/** Where the horizon sits in the race's strips (their band below it is fog colour, which reads as a wall here). */
const BD_HORIZON = 0.06 / 0.32;

const MOTES = 420;
/** Where the motes live: a box round the turntable (they wrap round inside it). */
const MOTE_BOX = { x: 22, y: 9, z: 22 };
/** Per kind: colours, size (m), fall speed (m/s; negative rises), sideways drift. */
const MOTE_KIND: Record<NonNullable<Stage['motes']>, { colors: number[]; size: number; fall: number; sway: number }> = {
  petals: { colors: [0xffb7d5, 0xffd6e7, 0xff8fbf], size: 0.11, fall: 0.55, sway: 0.5 },
  leaves: { colors: [0xff8a00, 0xd9473d, 0xffc940], size: 0.14, fall: 0.7, sway: 0.7 },
  embers: { colors: [0xff6a1a, 0xffae3c], size: 0.06, fall: -0.45, sway: 0.25 },
  sparks: { colors: [0xffd76a, 0xfff1c9], size: 0.05, fall: -0.2, sway: 0.15 },
  stars: { colors: [0xffffff, 0xcfe4ff], size: 0.05, fall: 0, sway: 0 },
};

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
  private rider: DriverRig | null = null;
  private riderId: Rider | null = null;
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
  /** The stage (pass.ts `STAGES`; '' the garage bay) and what draws it. */
  private stageId: BgId | '' = '';
  private env: THREE.Texture;
  private floorMat!: THREE.MeshStandardMaterial;
  private rings: THREE.MeshBasicMaterial[] = [];
  private rims: THREE.DirectionalLight[] = [];
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private backdrop!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private backdrops = new Map<string, THREE.Texture>();
  private orb!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private grid!: THREE.GridHelper;
  private motes!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private moteKind: Stage['motes'] = null;
  private moteSeed = new Float32Array(MOTES);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.low ? LOW_PIXEL_RATIO : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const keep = <T extends { dispose(): void }>(x: T) => (this.own.push(x), x);
    this.env = garageEnvironment(this.renderer);
    this.scene.environment = this.env;
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
    this.floorMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1c21, ...tex, normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.6, envMapIntensity: 0.35, alphaMap: keep(fadeTexture()), transparent: true, depthWrite: false }));
    const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(16, 64)), this.floorMat);
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
      const mat = keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k) }));
      mat.userData.k = k;
      this.rings.push(mat);
      const ring = new THREE.Mesh(keep(new THREE.RingGeometry(r0, r1, 128)), mat);
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
    this.rims = [rimC, rimM];
    this.buildStage(keep);
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

  /**
   * Everything a stage can show, made once and hidden (the garage bay shows none of it): a gradient sky, a painted
   * panorama, a sun or moon, a neon grid and drifting motes. Switching stages only changes colours, maps and
   * visibility, so nothing recompiles (and no light is ever added or removed).
   */
  private buildStage(keep: <T extends { dispose(): void }>(x: T) => T) {
    const sky = new THREE.Mesh(
      keep(new THREE.SphereGeometry(60, 32, 16)),
      keep(
        new THREE.ShaderMaterial({
          uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
          vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader:
            'uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDir; void main() { float h = smoothstep(-0.16, 0.14, vDir.y); vec3 c = mix(horizon, zenith, pow(h, 0.7)); if (vDir.y < -0.16) c = horizon * 0.16; gl_FragColor = vec4(c, 1.0); }',
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
        }),
      ),
    );
    sky.renderOrder = -3;
    sky.frustumCulled = false;
    sky.onBeforeRender = (_r, _s, cam) => {
      sky.position.copy(cam.position);
      sky.updateMatrixWorld();
    };
    // The panorama: the race's backdrop strips, low on the horizon behind the car.
    const blank = keep(new THREE.DataTexture(new Uint8Array(4), 1, 1));
    blank.needsUpdate = true;
    const backdrop = new THREE.Mesh(
      // Like the race's (trackview.ts BACKDROP), squashed and dipped (STAGE_DIP).
      keep(new THREE.CylinderGeometry(STAGE_R, STAGE_R, STAGE_R * (BD_TOP - BD_BOTTOM), 96, 1, true).translate(0, (STAGE_R * (BD_TOP + BD_BOTTOM)) / 2, 0)),
      keep(new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide })),
    );
    backdrop.renderOrder = -2;
    backdrop.frustumCulled = false;
    backdrop.onBeforeRender = (_r, _s, cam) => {
      backdrop.position.copy(cam.position);
      backdrop.updateMatrixWorld();
    };
    const orb = new THREE.Mesh(keep(new THREE.CircleGeometry(1, 48)), keep(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false })));
    orb.renderOrder = -2;
    const grid = new THREE.GridHelper(48, 48);
    keep(grid.geometry);
    keep(grid.material as THREE.Material);
    grid.position.y = 0.003;
    const mg = keep(new THREE.BufferGeometry());
    const pos = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      pos.set([(Math.random() - 0.5) * MOTE_BOX.x, Math.random() * MOTE_BOX.y, (Math.random() - 0.5) * MOTE_BOX.z], i * 3);
      this.moteSeed[i] = Math.random() * Math.PI * 2;
    }
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    const motes = new THREE.Points(mg, keep(new THREE.PointsMaterial({ size: 0.1, map: keep(moteTexture()), vertexColors: true, transparent: true, depthWrite: false })));
    motes.frustumCulled = false;
    this.sky = sky;
    this.backdrop = backdrop;
    this.orb = orb;
    this.grid = grid;
    this.motes = motes;
    for (const o of [sky, backdrop, orb, grid, motes]) {
      o.visible = false;
      this.scene.add(o);
    }
  }

  /** Puts the car on a stage (a battle pass home background), or back in the garage bay (''). */
  stage(id: BgId | '') {
    if (id === this.stageId) return;
    this.stageId = id;
    const st = id ? STAGES[id] : null;
    const [a, b] = st ? st.neon.map((c) => new THREE.Color(c)) : [CYAN, MAGENTA];
    this.rings[0].color.copy(a).multiplyScalar(this.rings[0].userData.k as number);
    this.rings[1].color.copy(b).multiplyScalar(this.rings[1].userData.k as number);
    this.rims[0].color.copy(a);
    this.rims[1].color.copy(b);
    const horizon = new THREE.Color(st ? st.sky[1] : 0x05070b);
    const void_ = st ? horizon.clone().multiplyScalar(0.16) : new THREE.Color(0x05070b);
    // The panorama takes the stage's light: tinted toward the horizon and dimmed, so it sits in the dusk or the night.
    this.backdrop.material.color.copy(horizon).lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(0.72);
    this.scene.background = st ? null : void_;
    (this.scene.fog as THREE.Fog).color.copy(void_);
    (this.scene.fog as THREE.Fog).far = st ? 40 : 26;
    this.floorMat.color.setHex(st ? st.floor : 0x1a1c21);
    // The paint reflects the stage's neon too.
    this.env.dispose();
    this.env = garageEnvironment(this.renderer, a, b, st ? horizon.clone().multiplyScalar(0.25) : undefined);
    this.scene.environment = this.env;
    this.sky.visible = !!st;
    if (st) {
      this.sky.material.uniforms.zenith.value.setHex(st.sky[0]);
      this.sky.material.uniforms.horizon.value.setHex(st.sky[1]);
    }
    this.backdrop.visible = !!st?.backdrop;
    if (st?.backdrop) this.loadBackdrop(st.backdrop);
    this.orb.visible = st?.orb !== undefined;
    if (st?.orb !== undefined) {
      const synth = id === 'synth';
      this.orb.material.map?.dispose();
      this.orb.material.map = synth ? sunTexture() : null;
      // The sun's colours are in its texture; the moon is a plain disc. Both a touch brighter than white to bloom.
      if (synth) this.orb.material.color.setRGB(1.4, 1.4, 1.4);
      else this.orb.material.color.setHex(st.orb).multiplyScalar(1.6);
      this.orb.material.needsUpdate = true;
      this.orb.scale.setScalar(synth ? 9 : 1.5);
      if (synth) this.orb.position.set(-30, 3, -34);
      else this.orb.position.set(-34, 3.4, -30);
      this.orb.lookAt(0, this.orb.position.y, 0);
    }
    this.grid.visible = id === 'synth';
    if (id === 'synth') {
      const m = this.grid.material as THREE.LineBasicMaterial;
      m.vertexColors = false;
      m.color.setRGB(2.2, 0.3, 1.9);
      m.needsUpdate = true;
    }
    this.moteKind = st?.motes ?? null;
    this.motes.visible = !!this.moteKind;
    if (this.moteKind) {
      const k = MOTE_KIND[this.moteKind];
      const col = this.motes.geometry.attributes.color as THREE.BufferAttribute;
      const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const c = new THREE.Color();
      const glow = this.moteKind === 'embers' || this.moteKind === 'sparks' ? 2.4 : 1;
      for (let i = 0; i < MOTES; i++) {
        c.setHex(k.colors[i % k.colors.length]).multiplyScalar(glow);
        col.setXYZ(i, c.r, c.g, c.b);
        // Stars sit high and far, like a sky; the rest fill the air round the car.
        if (this.moteKind === 'stars') {
          const v = new THREE.Vector3().setFromSphericalCoords(34, Math.acos(0.15 + Math.random() * 0.85), Math.random() * Math.PI * 2);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
      }
      col.needsUpdate = true;
      pos.needsUpdate = true;
      this.motes.material.size = this.moteKind === 'stars' ? 0.16 : k.size;
      this.motes.material.fog = this.moteKind !== 'stars';
      this.motes.material.needsUpdate = true;
    }
  }

  private loadBackdrop(name: string) {
    const crop = (t: THREE.Texture) => {
      // Only the part above the strip's horizon (see BD_HORIZON).
      t.repeat.set(1, 1 - BD_HORIZON);
      t.offset.set(0, BD_HORIZON);
    };
    const have = this.backdrops.get(name);
    if (have) {
      this.backdrop.material.map = have;
      return;
    }
    new THREE.TextureLoader().load(`/race/backdrops/${name}.webp`, (tex) => {
      if (!this.canvas.isConnected) return void tex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      crop(tex);
      this.backdrops.set(name, tex);
      if (this.stageId && STAGES[this.stageId].backdrop === name) this.backdrop.material.map = tex;
    });
  }

  /** Motes drift: petals and leaves fall and sway, embers and sparks rise, stars stay put. */
  private drift(dt: number, t: number) {
    if (!this.moteKind || this.moteKind === 'stars') return;
    const k = MOTE_KIND[this.moteKind];
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const s = this.moteSeed[i];
      let y = pos.getY(i) - k.fall * dt * (0.6 + 0.4 * Math.sin(s * 3));
      if (y < 0) y += MOTE_BOX.y;
      else if (y > MOTE_BOX.y) y -= MOTE_BOX.y;
      pos.setXYZ(i, pos.getX(i) + Math.sin(t * 0.8 + s) * k.sway * dt, y, pos.getZ(i) + Math.cos(t * 0.6 + s) * k.sway * dt);
    }
    pos.needsUpdate = true;
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

  /** Puts your driver beside the car (loaded when the pick changes; the last one stays until the new one arrives). */
  showRider(r: Rider) {
    if (r === this.riderId) return;
    this.riderId = r;
    loadDriver(r, { shadows: !this.low }).then(
      (rig) => {
        if (this.riderId !== r || !this.canvas.isConnected) return rig.dispose();
        this.rider?.dispose();
        this.rider = rig;
        rig.stand();
        rig.root.position.copy(this.riderAt);
        this.turntable.add(rig.root);
        this.aim();
      },
      (e) => console.warn(`Driver ${r} did not load`, e),
    );
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
    const h = this.rider?.fit.height ?? 1.75;
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
      // The rig faces -Z (like the cars): half a turn more puts it facing out from the door.
      this.rider.root.rotation.y = -Math.PI / 2 + 0.35 + this.riderYaw;
      this.rider.update(dt);
    }
    this.drift(dt, now / 1000);
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
    this.env.dispose();
    this.orb.material.map?.dispose();
    for (const t of this.backdrops.values()) t.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // the canvas is never reused: give the GPU context back now
  }
}
