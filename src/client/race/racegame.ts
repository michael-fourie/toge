// A race: the fixed-tick car simulation (yours, plus AI rivals in a solo race), remote cars interpolated
// from snapshots online, chase/hood/bumper cameras, the HUD, sound, tyre smoke and skids, rumble, and the
// finish (results and prize money).

import * as THREE from 'three';
import { CARS, type CarId, type CarSpec, type OwnedCar, PAINTS, carSpec, decodeCar, encodeCar, newOwnedCar, CAR_IDS, rating } from '../../shared/race/cars.ts';
import { type Ai, aiDrive, newAi } from '../../shared/race/driver.ts';
import { ITEMS, type Item, POWER, rollItem } from '../../shared/race/powerups.ts';
import { CarFlag, type NetCar, type RaceMode, type RaceServerMsg, type Racer } from '../../shared/race/protocol.ts';
import { standings } from '../../shared/race/standings.ts';
import { type Surface, type Track, type TrackId, getTrack, gridSlot, heightAt, lapOf, pointAt } from '../../shared/race/track.ts';
import { type Assists, type Car, DEFAULT_ASSISTS, type DriveInput, TICK_DT, collideCars, forwardSpeed, newCar, resetCar, speedOf, spinOut, stepCar, wheelLocal, yawOf } from '../../shared/race/vehicle.ts';
import { PropView, shieldBubble } from './propview.ts';
import { type Obstacle, type Traffic, collideTraffic, getTraffic, trafficBetween } from '../../shared/race/traffic.ts';
import { TrafficView } from './trafficview.ts';
import { rumble, setMenuNav } from '../pad.ts';
import { esc } from '../menu/ui.ts';
import { Engine, RaceAudio, VOLUMES, loadVolume } from './audio.ts';
import { type CarModel, buildCar, ghostly } from './carmodel.ts';
import { Effects } from './effects.ts';
import { garage } from './garageStore.ts';
import { type Dot, type ResultLine, RaceHud, type Tag, fmtTime, money, ordinal } from './hud.ts';
import { DriveControls } from './input.ts';
import type { RaceNet } from './racenet.ts';
import { Post } from './post.ts';
import { buildTrackView, type TrackView } from './trackview.ts';

export interface RaceSetup {
  container: HTMLElement;
  track: TrackId;
  name: string;
  car: OwnedCar;
  /** Online: the lobby socket and the countdown it just sent (and whether it's a race or a ghost time trial). */
  online?: { net: RaceNet; mode: RaceMode; grid: Record<number, number>; countdownMs: number; racers: Racer[] };
  /** Solo: how many AI rivals. */
  rivals?: number;
  onExit(to: 'garage' | 'lobby', notice?: string): void;
}

type Phase = 'countdown' | 'racing' | 'finished' | 'done';
type Cam = 'chase' | 'near' | 'hood' | 'bumper';
const CAMS: Cam[] = ['chase', 'near', 'hood', 'bumper'];
/** Grass and runoff dirt: they throw up dust rather than smoke, and leave no rubber. */
const soft = (s: Surface) => s === 'grass' || s === 'dirt';
const SEND_HZ = 20;
/** Remote cars are predicted forward from their last pose at most this far (s); past that they hold. */
const MAX_PREDICT = 0.35;
/** How fast the gap between a car's shown pose and a fresh update closes (1/s). */
const CORRECT_RATE = 7;
const PING_EVERY = 2;
/** Drift sparks by level: plain, blue, orange, purple (kart-racer style). */
const SPARK_COLORS = [
  [1, 0.9, 0.6],
  [0.35, 0.7, 1],
  [1, 0.55, 0.15],
  [0.8, 0.4, 1],
];
const SOLO_COUNTDOWN = 3.5;
/** Name tags: fully shown up to TAG_NEAR (m), faded out by TAG_FAR; hills between are checked every TAG_CHECK frames. */
const TAG_NEAR = 120;
const TAG_FAR = 280;
const TAG_CHECK = 6;

const RIVAL_NAMES = ['Haruki', 'Mika', 'Bunta', 'Rin', 'Kenji', 'Sora', 'Aiko', 'Daichi'];

interface Racing {
  car: Car;
  model: CarModel;
  engine: Engine | null;
  prevP: THREE.Vector3;
  prevQ: THREE.Quaternion;
  name: string;
  code: string;
  color: string;
  finished: number | null;
  ai?: Ai;
  input: DriveInput;
  /** The item held (and uses left), when an AI uses it, and how long its shield lasts (wall clock). */
  item: { kind: Item; uses: number } | null;
  itemAt: number;
  shieldUntil: number;
  bubble: THREE.Mesh;
}

interface Remote {
  id: number;
  name: string;
  code: string;
  color: string;
  model: CarModel;
  spec: CarSpec;
  engine: Engine | null;
  /** The latest pose received, and when (local seconds). */
  last: { c: NetCar; at: number } | null;
  /** What's on screen (predicted pose + a decaying correction), so updates never snap. */
  shownP: THREE.Vector3;
  shownQ: THREE.Quaternion;
  err: THREE.Vector3;
  /** A stand-in Car (pose only) for bumping into. */
  ghost: Car;
  bubble: THREE.Mesh;
  s: number;
  finished: number | null;
  spin: number;
  rpm: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Yaw rate (rad/s, + = turning left): angular velocity about the world's up. */
const yawRate = (c: Car) => c.w.y;

const ASSIST_KEY = 'atrous.assists';
function loadAssists(): Assists {
  try {
    return { ...DEFAULT_ASSISTS, ...JSON.parse(localStorage.getItem(ASSIST_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_ASSISTS };
  }
}
const CAM_KEY = 'atrous.raceCam';

const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface CamTarget {
  root: THREE.Object3D;
  id: CarId;
  cg: number;
  v: { x: number; y: number; z: number };
  yaw: number;
  /** Speed along the nose (negative: reversing). */
  fwd: number;
  hit: number;
  boost: boolean;
}

export class RaceGame {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(62, 1, 0.2, 9000);
  private view: TrackView;
  private post: Post;
  private track: Track;
  private hud: RaceHud;
  private audio: RaceAudio;
  private fx: Effects;
  private propView: PropView;
  /** City traffic, and the race clock it runs on (seconds since GO; counts up to 0 during the countdown). */
  private traffic: Traffic | null;
  private trafficView: TrafficView | null = null;
  private trafficTime = 0;
  private obstacles: Obstacle[] = [];
  /** Your item slot: the roulette spinning until `rouletteUntil`, then the item and its uses. */
  private rouletteUntil = 0;
  private pending: Item | null = null;
  private controls = new DriveControls();
  private me: Racing;
  private rivals: Racing[] = [];
  private remotes = new Map<number, Remote>();
  private assists = loadAssists();
  private cam: Cam = (localStorage.getItem(CAM_KEY) as Cam) || 'chase';
  /** Chase camera: the (smoothed) direction it trails along, and its smoothed height above the car. */
  private camDir = new THREE.Vector2(0, -1);
  private camY = 2.4;
  private camLook = new THREE.Vector3();
  /** Online, after you finish: the remote racer the camera follows (null: your own car). */
  private watching: number | null = null;
  private phase: Phase = 'countdown';
  private countdown: number;
  private lastBeep = 99;
  private time = 0;
  /** The lap you're on (circuits) and when you started it. */
  private lap = 1;
  private lapStart = 0;
  /** Your quickest lap so far (circuits), sent with your finish time. */
  private bestLap = Infinity;
  /** A time trial: the other racers are ghosts (no contact) and there are no items. */
  private readonly trial: boolean;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private paused = false;
  private sendAcc = 0;
  private pingAcc = 0;
  /** Round trip to the server (s), smoothed. Roughly how old another car's pose is when it lands. */
  private rtt = 0;
  private offNet: (() => void) | null = null;
  private resetAt = 0;
  private myPrize: number | null = null;
  private puffTick = 0;
  private rumbleAt = 0;
  private lastGear = 1;
  private lastLevel = 0;
  private boosting = false;
  private wallClock = 0;
  private exited = false;
  /** Name tags hidden behind a hill, by tag id, and the frame each was last checked. */
  private tagHidden = new Map<Tag['id'], { hidden: boolean; at: number }>();

  constructor(private setup: RaceSetup) {
    this.track = getTrack(setup.track);
    this.trial = setup.online?.mode === 'trial';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'race-canvas';
    setup.container.appendChild(this.renderer.domElement);
    this.view = buildTrackView(this.track, this.renderer);
    this.view.scene.add(this.cometLight);
    this.renderer.toneMappingExposure = this.view.exposure;
    this.post = new Post(this.renderer, this.view.scene, this.camera, this.view.grade);
    this.fx = new Effects(this.view.scene);
    this.propView = new PropView(this.view.scene, this.track);
    if (this.trial) this.propView.clearBoxes();
    this.traffic = getTraffic(this.track);
    if (this.traffic) this.trafficView = new TrafficView(this.view.scene, this.track, this.traffic);
    this.hud = new RaceHud(setup.container, this.track);
    this.audio = new RaceAudio();

    const online = setup.online;
    const rivals = online ? 0 : Math.max(0, Math.min(7, setup.rivals ?? 5));
    // Solo, you start mid-pack.
    const mySlot = online ? (online.grid[online.net.id] ?? 0) : Math.floor(rivals / 2);
    this.me = this.spawn(setup.car, mySlot, setup.name, true);
    if (online) {
      for (const r of online.racers) if (r.id !== online.net.id && r.id in online.grid) this.addRemote(r);
      this.countdown = online.countdownMs / 1000;
      this.offNet = online.net.on((m) => this.onNet(m));
    } else {
      const n = rivals;
      const myPi = rating(carSpec(setup.car)).pi;
      // Rivals in cars near your class, a touch slower or faster, spread over the grid ahead of you.
      const pool = CAR_IDS.slice().sort((a, b) => Math.abs(rating(carSpec(newOwnedCar(a))).pi - myPi) - Math.abs(rating(carSpec(newOwnedCar(b))).pi - myPi));
      for (let i = 0; i < n; i++) {
        const model = pool[i % 2 === 0 ? 0 : Math.min(pool.length - 1, 1 + (i % 3))];
        const car = newOwnedCar(model, (i * 5 + 3) % PAINTS.length);
        car.look.rims = i % 4;
        car.look.stripe = i % 3;
        car.look.stripeColor = (i * 7 + 1) % PAINTS.length;
        // Match your upgrades so the field stays close.
        car.up = { ...setup.car.up };
        const slot = i < mySlot ? i : i + 1;
        const r = this.spawn(car, slot, RIVAL_NAMES[i], false);
        r.ai = newAi(0.84 + ((i * 37) % 11) / 100, ((i % 3) - 1) * 1.6);
        this.rivals.push(r);
      }
      this.countdown = SOLO_COUNTDOWN;
    }
    for (const r of [this.me, ...this.rivals]) r.car.gear = 0; // revving on the line
    this.snapCamera();
    addEventListener('resize', this.resize);
    this.resize();
    setMenuNav(false);
    this.hud.showHelp(false);
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __race: RaceGame }).__race = this;
  }

  // --- setup ---------------------------------------------------------------------------------

  private spawn(owned: OwnedCar, slot: number, name: string, mine: boolean): Racing {
    const g = gridSlot(this.track, slot);
    const car = newCar(carSpec(owned), g.x, g.y, g.z, g.yaw);
    car.hint = Math.round(g.s / 2);
    car.s = g.s;
    const model = buildCar(owned);
    this.view.scene.add(model.root);
    this.headlights(model.root, owned);
    const b = CARS[owned.model];
    return {
      car,
      model,
      engine: new Engine(this.audio, b.cyl, owned.up.turbo > 0, mine ? 1 : 0.4),
      prevP: new THREE.Vector3(car.p.x, car.p.y, car.p.z),
      prevQ: new THREE.Quaternion(car.q.x, car.q.y, car.q.z, car.q.w),
      name,
      code: encodeCar(owned),
      color: hexColor(PAINTS[owned.look.paint]),
      finished: null,
      input: { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
      item: null,
      itemAt: 0,
      shieldUntil: 0,
      bubble: this.bubbleFor(model.root, b.length),
    };
  }

  private addRemote(r: Racer) {
    const owned = decodeCar(r.car) ?? newOwnedCar('pebble');
    const model = buildCar(owned);
    if (this.trial) ghostly(model);
    this.view.scene.add(model.root);
    this.headlights(model.root, owned);
    const spec = carSpec(owned);
    const slot = this.setup.online!.grid[r.id] ?? 0;
    const g = gridSlot(this.track, slot);
    const ghost = newCar(spec, g.x, g.y, g.z, g.yaw);
    this.remotes.set(r.id, {
      id: r.id,
      name: r.name,
      code: r.car,
      color: hexColor(PAINTS[owned.look.paint]),
      model,
      spec,
      engine: new Engine(this.audio, CARS[owned.model].cyl, owned.up.turbo > 0, 0.4),
      last: null,
      shownP: new THREE.Vector3(g.x, g.y + spec.cg, g.z),
      shownQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.yaw, 0)),
      err: new THREE.Vector3(),
      ghost,
      s: g.s,
      finished: null,
      spin: 0,
      rpm: spec.idle,
      bubble: this.bubbleFor(model.root, CARS[owned.model].length),
    });
  }

  /** Night: every car lights the road ahead. */
  private headlights(root: THREE.Object3D, owned: OwnedCar) {
    if (this.track.def.theme !== 'night' && this.track.def.theme !== 'city') return;
    const b = CARS[owned.model];
    const cg = carSpec(owned).cg;
    const beam = new THREE.SpotLight(0xfff1d6, 650, 150, 0.55, 0.6, 2);
    beam.position.set(0, 0.7 - cg, -b.length / 2);
    beam.target.position.set(0, -cg - 1, -40);
    root.add(beam, beam.target);
    // A little red glow behind, so you can see who's on your tail.
    const glow = new THREE.PointLight(0xff2a1a, 4, 8, 2);
    glow.position.set(0, 0.6 - cg, b.length / 2 + 0.5);
    root.add(glow);
  }

  // --- items ---------------------------------------------------------------------------------

  private bubbleFor(root: THREE.Object3D, length: number): THREE.Mesh {
    const b = shieldBubble(length);
    root.add(b);
    return b;
  }

  /** Mystery boxes within reach of distance `s` along the road. */
  private *boxesNear(s: number): Generator<[number, (typeof this.track.props)[number]]> {
    const props = this.track.props;
    for (let i = 0; i < props.length; i++) if (props[i].kind === 'box' && Math.abs(props[i].s - s) < 12) yield [i, props[i]];
  }

  /** Where `r` is in the race (1-based) and how many are racing, for item odds. */
  private placeOf(r: Racing): [number, number] {
    const all = [...[this.me, ...this.rivals].map((x) => ({ x, s: x.car.s })), ...[...this.remotes.values()].map((x) => ({ x: null, s: x.s }))];
    all.sort((a, b) => b.s - a.s);
    return [all.findIndex((e) => e.x === r) + 1, all.length];
  }

  /** Boxes, cones and oil for the cars we simulate; AI rivals use what they're holding. */
  private pickups() {
    const now = this.wallClock;
    for (const r of [this.me, ...this.rivals]) {
      for (const i of r.car.touched) {
        const p = this.track.props[i];
        if (p.kind === 'cone') this.propView.knockCone(i, r.car.v.x, r.car.v.z);
        else if (p.kind === 'box' && this.propView.takeBox(i, now)) {
          if (r === this.me) {
            if (!r.item && now >= this.rouletteUntil) {
              this.rouletteUntil = now + POWER.roulette;
              this.pending = rollItem(...this.placeOf(r), Math.random);
              this.audio.tone(990, 0.08, 0.05, 'square');
            }
          } else if (!r.item) {
            const kind = rollItem(...this.placeOf(r), Math.random);
            r.item = { kind, uses: ITEMS[kind].uses };
            r.itemAt = now + 1 + Math.random() * 4;
          }
        }
      }
      for (const sl of this.propView.slicks)
        if (!sl.hit.has(r) && Math.hypot(sl.x - r.car.p.x, sl.z - r.car.p.z) < POWER.oilRadius + 0.6 && Math.abs(sl.y - r.car.p.y) < 3) {
          sl.hit.add(r);
          if (now < r.shieldUntil) continue;
          spinOut(r.car, POWER.oilSpin);
          if (r === this.me) {
            this.hud.banner('Oil!', '', 1200);
            rumble(0.8, 0.6, 500);
          }
        }
      if (r !== this.me && r.item && now >= r.itemAt && this.phase !== 'countdown') {
        this.useItem(r);
        if (r.item) r.itemAt = now + 0.8;
      }
      r.bubble.visible = now < r.shieldUntil;
    }
    if (this.pending && now >= this.rouletteUntil) {
      this.me.item = { kind: this.pending, uses: ITEMS[this.pending].uses };
      this.hud.banner(ITEMS[this.pending].name, this.controls.padSeen ? 'Ⓐ to use' : 'E to use', 1400);
      this.audio.tone(1320, 0.15, 0.05, 'triangle');
      this.pending = null;
    }
  }

  private useItem(r: Racing) {
    const it = r.item;
    if (!it) return;
    const c = r.car;
    const now = this.wallClock;
    switch (it.kind) {
      case 'turbo':
      case 'triple':
        c.boost = Math.max(c.boost, POWER.turboSeconds);
        c.boostPower = POWER.turboAccel;
        break;
      case 'shield':
        r.shieldUntil = now + POWER.shieldSeconds;
        break;
      case 'oil': {
        const yaw = yawOf(c);
        const back = c.spec.axleR + 2.6;
        const x = c.p.x + Math.sin(yaw) * back;
        const z = c.p.z + Math.cos(yaw) * back;
        const y = c.p.y - c.spec.cg;
        this.propView.addSlick(x, y, z, now);
        if (r === this.me) this.setup.online?.net.send({ t: 'item', kind: 'oil', p: [x, y, z] });
        break;
      }
      case 'shock':
        this.shockwave(r, r.name);
        if (r === this.me) this.setup.online?.net.send({ t: 'item', kind: 'shock' });
        break;
      case 'comet': {
        const target = this.leaderFor(r);
        if (!target) break;
        this.launchComet(c.s, target, r.name);
        if (r === this.me && typeof target === 'number') this.setup.online?.net.send({ t: 'item', kind: 'comet', target, s: c.s });
        break;
      }
    }
    if (r === this.me) this.audio.burst(0.3, 0.06, 1800, 'highpass');
    it.uses--;
    if (it.uses <= 0) r.item = null;
  }

  /**
   * Who a comet fired by `r` goes for: whoever's in front (the next one if `r` leads). A car we simulate,
   * or a remote racer's id.
   */
  private leaderFor(r: Racing): Racing | number | null {
    const all: { who: Racing | number; s: number; done: boolean }[] = [
      ...[this.me, ...this.rivals].map((x) => ({ who: x as Racing | number, s: x.car.s, done: x.finished !== null })),
      ...[...this.remotes.values()].map((x) => ({ who: x.id as Racing | number, s: x.s, done: x.finished !== null })),
    ].filter((e) => !e.done && e.who !== r);
    all.sort((a, b) => b.s - a.s);
    return all[0]?.who ?? null;
  }

  private comets: { mesh: THREE.Mesh; lit: boolean; from: number; target: Racing | number; at: number; dur: number }[] = [];
  // Comets share one look, and one light that lives in the scene all race, dark until a comet carries
  // it: adding or removing a light mid-race makes three.js recompile every lit shader, a long freeze.
  private cometGeo = new THREE.SphereGeometry(0.7, 16, 12);
  private cometMat = new THREE.MeshBasicMaterial({ color: 0x8fd8ff });
  private cometLight = new THREE.PointLight(0x6fc8ff, 0, 30, 2);

  /** A comet leaves distance `from` along the road and homes in on `target`. */
  private launchComet(from: number, target: Racing | number, by: string) {
    const ts = typeof target === 'number' ? (this.remotes.get(target)?.s ?? from) : target.car.s;
    const mesh = new THREE.Mesh(this.cometGeo, this.cometMat);
    this.view.scene.add(mesh);
    const lit = !this.comets.some((c) => c.lit);
    if (lit) this.cometLight.intensity = 40;
    this.comets.push({ mesh, lit, from, target, at: this.wallClock, dur: Math.max(1.2, (ts - from) / POWER.cometSpeed) });
    if (target === this.me) {
      this.hud.banner(`☄️ Comet from ${by}!`, 'Shield up or brace yourself', 1800);
      this.audio.tone(520, 0.6, 0.05, 'sawtooth');
    }
  }

  /** Flies comets down the road (high above it), dives onto the target, and blows it up. */
  private updateComets() {
    const now = this.wallClock;
    for (let k = this.comets.length - 1; k >= 0; k--) {
      const cm = this.comets[k];
      const local = typeof cm.target === 'number' ? null : cm.target;
      const tp = local ? local.model.root.position : this.remotes.get(cm.target as number)?.model.root.position;
      if (!tp) {
        this.dropComet(k);
        continue;
      }
      const ts = local ? local.car.s : (this.remotes.get(cm.target as number)?.s ?? cm.from);
      const u = Math.min(1, (now - cm.at) / cm.dur);
      const road = pointAt(this.track, cm.from + (ts - cm.from) * u, 0);
      const dive = Math.max(0, (u - 0.8) / 0.2);
      cm.mesh.position.set(road.x + (tp.x - road.x) * dive, road.y + 9 * (1 - dive) + (tp.y - road.y) * dive, road.z + (tp.z - road.z) * dive);
      if (cm.lit) this.cometLight.position.copy(cm.mesh.position);
      if (this.puffTick % 2 === 0) this.fx.spark(cm.mesh.position.x, cm.mesh.position.y, cm.mesh.position.z, 0, 0.5, 0, [0.5, 0.85, 1], 0.6, 1.6);
      if (u < 1) continue;
      this.dropComet(k);
      for (let i = 0; i < 40; i++) this.fx.spark(tp.x, tp.y + 0.5, tp.z, (Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16, Math.random() < 0.5 ? [0.5, 0.85, 1] : [1, 1, 1], 0.9, 2.2);
      this.audio.burst(0.9, 0.15, 400, 'lowpass');
      if (!local || now < local.shieldUntil) continue;
      spinOut(local.car, POWER.cometSpin);
      local.car.v.x *= 0.35;
      local.car.v.z *= 0.35;
      local.car.v.y += POWER.cometLift;
      if (local === this.me) rumble(1, 1, 900);
    }
  }

  private dropComet(k: number) {
    const cm = this.comets[k];
    cm.mesh.removeFromParent();
    if (cm.lit) this.cometLight.intensity = 0;
    this.comets.splice(k, 1);
  }

  /** A shockwave from `by` (null: a remote racer) spins out everyone else who isn't shielded. */
  private shockwave(by: Racing | null, name: string) {
    const now = this.wallClock;
    for (const r of [this.me, ...this.rivals]) {
      if (r === by || now < r.shieldUntil) continue;
      spinOut(r.car, POWER.shockSpin);
    }
    if (by !== this.me) {
      this.hud.banner(`⚡ Shockwave from ${name}!`, '', 1600);
      if (now >= this.me.shieldUntil) rumble(1, 1, 600);
    }
    this.audio.burst(0.8, 0.1, 300, 'lowpass');
  }

  // --- network ---------------------------------------------------------------------------------

  private onNet(m: RaceServerMsg) {
    const now = performance.now() / 1000;
    if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.7 + (now - m.n / 1000) * 0.3 : now - m.n / 1000;
    else if (m.t === 'go') this.go();
    else if (m.t === 'snap') {
      for (const c of m.cars) {
        const r = this.remotes.get(c.id);
        if (!r) continue;
        // Keep what's on screen where it is: the jump to the new prediction becomes an error that decays.
        r.last = { c, at: now };
        r.err.copy(r.shownP).sub(this.predict(r, now, new THREE.Vector3(), null));
        if (r.err.lengthSq() > 64) r.err.set(0, 0, 0); // a reset or a long gap: just jump
        r.s = c.s;
      }
    } else if (m.t === 'finished') {
      const r = this.remotes.get(m.id);
      if (r) {
        r.finished = m.time;
        if (this.phase !== 'done') this.hud.banner(`${r.name} finished`, fmtTime(m.time), 2000);
        if (this.watching === m.id) this.spectateNext();
      }
    } else if (m.t === 'results') this.onlineResults(m.rows.map((r) => ({ place: r.place, name: r.name, car: r.car, time: r.time, best: r.best, prize: r.prize, me: r.id === this.setup.online!.net.id })));
    else if (m.t === 'room') {
      // Someone left mid-race: drop their car.
      for (const id of [...this.remotes.keys()])
        if (!m.racers.some((r) => r.id === id)) {
          const r = this.remotes.get(id)!;
          this.view.scene.remove(r.model.root);
          r.model.dispose();
          r.engine?.stop();
          this.remotes.delete(id);
          if (this.watching === id) this.spectateNext();
        }
      if (m.phase === 'lobby' && this.phase === 'done') this.exit('lobby');
    } else if (m.t === 'item') {
      const from = this.remotes.get(m.by)?.name ?? 'Someone';
      if (m.kind === 'oil' && m.p) this.propView.addSlick(m.p[0], m.p[1], m.p[2], this.wallClock);
      else if (m.kind === 'shock') this.shockwave(null, from);
      else if (m.kind === 'comet' && m.target !== undefined && m.s !== undefined) {
        const target = m.target === this.setup.online!.net.id ? this.me : this.remotes.has(m.target) ? m.target : null;
        if (target !== null) this.launchComet(m.s, target, from);
      }
    } else if (m.t === 'error') this.exit('garage', m.message);
  }

  private send() {
    const net = this.setup.online?.net;
    if (!net) return;
    const c = this.me.car;
    const f =
      (this.me.input.brake > 0.1 ? CarFlag.Brake : 0) |
      (c.gear < 0 ? CarFlag.Reverse : 0) |
      (c.wheels.some((w) => w.slip > 1.1) ? CarFlag.Skid : 0) |
      (c.wheels.some((w) => w.surf === 'grass' || w.surf === 'gravel' || w.surf === 'dirt') ? CarFlag.Offroad : 0) |
      (c.drift ? CarFlag.Drift : 0) |
      (c.boost > 0 ? CarFlag.Boost : 0) |
      (c.driftLevel << CarFlag.LevelShift) |
      (this.wallClock < this.me.shieldUntil ? CarFlag.Shield : 0);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    net.send({
      t: 'state',
      p: [r(c.p.x), r(c.p.y), r(c.p.z)],
      q: [r(c.q.x), r(c.q.y), r(c.q.z), r(c.q.w)],
      v: [r(c.v.x), r(c.v.y), r(c.v.z)],
      w: r(yawRate(c)),
      s: r(c.s),
      st: r(c.steer),
      ws: r((c.wheels[2].w + c.wheels[3].w) / 2),
      rpm: Math.round(c.rpm),
      f,
    });
  }

  // --- the loop --------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); // never negative: a first frame can predate `last`
    this.last = now;
    this.wallClock += dt;
    this.controls.poll(dt);
    if (this.controls.padSeen && !this.padHelpShown) {
      this.padHelpShown = true;
      this.hud.showHelp(true);
    }
    for (const a of this.controls.actions()) this.action(a);
    if (!this.paused || this.setup.online) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_DT && steps++ < 20) {
        this.tick();
        this.acc -= TICK_DT;
      }
      if (this.acc > TICK_DT) this.acc = 0;
      this.fx.update(dt);
      this.propView.update(this.wallClock, dt);
      this.updateComets();
    }
    this.render(dt, Math.min(1, this.acc / TICK_DT));
  };
  private padHelpShown = false;

  private action(a: string) {
    if (a === 'pause') {
      if (this.phase === 'done') return;
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (this.paused) return;
    if (a === 'camera') {
      this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length];
      localStorage.setItem(CAM_KEY, this.cam);
      this.snapCamera();
    } else if (a === 'reset' && this.phase === 'racing' && this.wallClock > this.resetAt) {
      resetCar(this.me.car, this.track);
      this.resetAt = this.wallClock + 2;
      this.hud.banner('Back on the road', '', 1200);
    } else if (a === 'item') {
      if (this.phase === 'racing') this.useItem(this.me);
      else if (this.phase === 'finished' && this.setup.online) this.spectateNext();
    } else if (a === 'shiftUp' || a === 'shiftDown') {
      if (!this.assists.auto && this.phase !== 'countdown') this.me.input[a] = true;
    }
  }

  private tick() {
    const me = this.me;
    const t = this.track;
    // Inputs
    if (this.phase === 'countdown') {
      this.countdown -= TICK_DT;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastBeep && n <= 3 && n >= 1) {
        this.lastBeep = n;
        this.audio.beep(false);
        this.hud.countdown(String(n));
      }
      if (!this.setup.online && this.countdown <= 0) this.go();
    }
    const live = this.phase === 'racing';
    const myInput = me.input;
    if (this.phase === 'countdown') {
      Object.assign(myInput, { steer: 0, throttle: this.paused ? 0 : this.controls.input.throttle, brake: 1, handbrake: 1, drift: 0 });
    } else if (me.finished !== null || this.phase === 'done') {
      aiDrive(me.car, t, me.ai ?? (me.ai = newAi(0.8, 0)), TICK_DT, myInput);
      // Finished: brake to a stop, then hold it on the handbrake (the brake at a standstill selects reverse).
      const moving = forwardSpeed(me.car) > 1.5;
      myInput.throttle = 0;
      myInput.brake = moving ? 1 : 0;
      myInput.handbrake = moving ? 0 : 1;
      myInput.drift = 0;
    } else if (this.paused) Object.assign(myInput, { steer: 0, throttle: 0, brake: 0, handbrake: 0, drift: 0 });
    else {
      const c = this.controls.input;
      myInput.steer = c.steer;
      myInput.throttle = c.throttle;
      myInput.brake = c.brake;
      myInput.handbrake = c.handbrake;
      myInput.drift = c.drift;
    }
    // Traffic runs on the race clock, the same for everyone online.
    this.trafficTime = this.phase === 'countdown' ? -Math.max(0, this.countdown) : this.trafficTime + TICK_DT;
    const traffic = this.traffic;
    for (const r of this.rivals) {
      if (this.phase === 'countdown') Object.assign(r.input, { steer: 0, throttle: Math.random() < 0.02 ? 1 : r.input.throttle * 0.95, brake: 1, handbrake: 1 });
      else aiDrive(r.car, t, r.ai!, TICK_DT, r.input, traffic ? trafficBetween(traffic, this.trafficTime, r.car.s - 10, r.car.s + 300, this.obstacles) : undefined);
    }
    // Step
    for (const r of [me, ...this.rivals]) {
      r.prevP.set(r.car.p.x, r.car.p.y, r.car.p.z);
      r.prevQ.set(r.car.q.x, r.car.q.y, r.car.q.z, r.car.q.w);
      const assists = r === me ? this.assists : DEFAULT_ASSISTS;
      stepCar(r.car, r.input, t, assists);
      r.input.shiftUp = r.input.shiftDown = false;
    }
    this.pickups();
    // Bumps
    const all = [me, ...this.rivals];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) collideCars(all[i].car, all[j].car, true);
    // In a time trial the others are ghosts: you drive straight through them.
    if (!this.trial) for (const r of this.remotes.values()) collideCars(me.car, r.ghost, false);
    if (traffic) for (const r of all) collideTraffic(t, traffic, r.car, this.trafficTime);
    if (me.car.hit > 2.5) {
      this.audio.impact(me.car.hit);
      rumble(Math.min(1, me.car.hit / 10), 0.5, 180);
    } else if (me.car.land > 4) {
      this.audio.impact(me.car.land * 0.4);
      rumble(Math.min(1, me.car.land / 14), 0.3, 140);
    }
    // Drift sparks levelling up, and the mini-turbo going off.
    if (me.car.driftLevel > this.lastLevel) {
      this.audio.tone(700 + me.car.driftLevel * 260, 0.12, 0.05, 'triangle');
      rumble(0.15, 0.4, 90);
    }
    this.lastLevel = me.car.driftLevel;
    if (me.car.boost > 0 && !this.boosting) {
      this.audio.burst(0.6, 0.12, 900, 'bandpass');
      rumble(0.5, 0.8, 300);
    }
    this.boosting = me.car.boost > 0;
    if (me.car.gear !== this.lastGear) {
      if (live) this.audio.shift();
      this.lastGear = me.car.gear;
    }
    // Clock and finishing
    if (live && me.finished === null) this.time += TICK_DT;
    if (live && me.finished === null && me.car.s >= t.finishS) this.finish();
    if (live && me.finished === null && t.lap && lapOf(t, me.car.s) > this.lap) {
      this.lap = lapOf(t, me.car.s);
      const lapTime = this.time - this.lapStart;
      const best = lapTime < this.bestLap;
      this.bestLap = Math.min(this.bestLap, lapTime);
      this.hud.banner(this.lap === t.def.laps ? 'Final lap' : `Lap ${this.lap}/${t.def.laps}`, `${best && this.lap > 2 ? 'Best lap' : 'Last lap'} ${fmtTime(lapTime)}`, 2200);
      this.lapStart = this.time;
    }
    for (const r of this.rivals) if (r.finished === null && this.phase === 'racing' && r.car.s >= t.finishS) r.finished = this.time;
    // Network
    if (this.setup.online && (live || this.phase === 'countdown' || this.phase === 'finished')) {
      this.pingAcc += TICK_DT;
      if (this.pingAcc >= PING_EVERY) {
        this.pingAcc = 0;
        this.setup.online.net.send({ t: 'ping', n: Math.round(performance.now()) });
      }
      this.sendAcc += TICK_DT;
      if (this.sendAcc >= 1 / SEND_HZ) {
        this.sendAcc = 0;
        if (me.finished === null) this.send();
      }
    }
  }

  private go() {
    if (this.phase !== 'countdown') return;
    this.phase = 'racing';
    this.trafficTime = 0;
    this.audio.beep(true);
    this.hud.countdown('GO!');
    setTimeout(() => this.hud.countdown(null), 900);
    if (this.trial) this.hud.banner('Time trial', 'Ghost cars: drive straight through them', 2600);
    for (const r of [this.me, ...this.rivals]) r.car.gear = 1;
  }

  private finish() {
    const me = this.me;
    me.finished = this.time;
    if (this.track.lap) this.bestLap = Math.min(this.bestLap, this.time - this.lapStart);
    this.phase = 'finished';
    const ahead = [...this.rivals.filter((r) => r.finished !== null), ...[...this.remotes.values()].filter((r) => r.finished !== null)].length;
    this.hud.banner(`${ordinal(ahead + 1)} place`, fmtTime(this.time), 0);
    rumble(0.6, 0.9, 400);
    // Solo: the race is over when you cross the line; the AI still out are placed by how far they got.
    if (!this.setup.online) return void this.soloResults();
    this.setup.online.net.send({ t: 'finish', time: this.time, best: Number.isFinite(this.bestLap) ? this.bestLap : undefined });
    if (this.stillRacing().length) this.hud.watching('', `${this.spectateKey()}: spectate`);
  }

  private spectateKey() {
    return this.controls.padSeen ? 'Ⓐ' : 'E';
  }

  /** Remote racers still on the road. */
  private stillRacing() {
    return [...this.remotes.values()].filter((r) => r.finished === null && r.last);
  }

  /** Follow the next racer still out (after the last, back to your own car). */
  private spectateNext() {
    const out = this.stillRacing();
    const next = out[out.findIndex((r) => r.id === this.watching) + 1] ?? null;
    this.watching = next?.id ?? null;
    if (next) this.hud.watching(`Spectating ${next.name}`, `${this.spectateKey()}: next`);
    else this.hud.watching('', out.length ? `${this.spectateKey()}: spectate` : '');
    this.snapCamera();
  }

  private async soloResults() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const field = [this.me, ...this.rivals];
    const done = field.filter((r) => r.finished !== null).sort((a, b) => a.finished! - b.finished!);
    const behind = field.filter((r) => r.finished === null).sort((a, b) => b.car.s - a.car.s);
    const myPlace = done.indexOf(this.me) + 1;
    const res = await garage.act({ a: 'solo', track: this.setup.track, place: myPlace, field: field.length });
    this.myPrize = res.ok ? (res.paid ?? 0) : 0;
    const lines: ResultLine[] = [...done, ...behind].map((r, i) => ({ place: i + 1, name: r.name, car: r.code, time: r.finished, prize: r === this.me ? this.myPrize! : 0, me: r === this.me }));
    const note = res.ok ? `You won ${money(this.myPrize)}` : `No prize: ${res.error === 'Too soon.' ? 'solo races pay at most once every 45 s' : res.error}`;
    const p = this.hud.panel(`${this.hud.resultsHtml(this.track.def.name, lines)}
      <p class="rh-note">${esc(note)}</p>
      <div class="rh-buttons"><button data-act="again" data-autofocus>Race again</button><button data-act="garage">Garage</button></div>`);
    setMenuNav(true);
    p.querySelector('[data-act="again"]')!.addEventListener('click', () => this.restart());
    p.querySelector('[data-act="garage"]')!.addEventListener('click', () => this.exit('garage'));
  }

  private onlineResults(lines: ResultLine[]) {
    this.phase = 'done';
    this.watching = null;
    this.hud.watching('', '');
    const mine = lines.find((l) => l.me);
    if (mine) garage.credit(mine.prize, mine.place === 1 && lines.length > 1);
    const p = this.hud.panel(`${this.hud.resultsHtml(this.trial ? `Time trial · ${this.track.def.name}` : 'Results', lines, this.trial)}
      <p class="rh-note">${mine ? `You earned ${money(mine.prize)}` : ''}${garage.onServer ? '' : ' · Sign in to keep your winnings'}</p>
      <div class="rh-buttons"><button data-act="lobby" data-autofocus>Back to lobby</button><button data-act="leave">Leave race</button></div>`);
    setMenuNav(true);
    p.querySelector('[data-act="lobby"]')!.addEventListener('click', () => this.exit('lobby'));
    p.querySelector('[data-act="leave"]')!.addEventListener('click', () => {
      this.setup.online!.net.leave();
      this.exit('garage');
    });
  }

  private restart() {
    const s = this.setup;
    this.dispose();
    const next = new RaceGame(s);
    (window as unknown as { __race: RaceGame }).__race = next;
  }

  private pause() {
    this.paused = true;
    const a = this.assists;
    const onOff = (b: boolean) => (b ? 'On' : 'Off');
    const p = this.hud.panel(`
      <h2>Paused</h2>
      <div class="rh-buttons col">
        <button data-act="resume" data-autofocus>Resume</button>
        ${this.setup.online ? '' : '<button data-act="restart">Restart</button>'}
        <button data-act="cam">Camera: ${this.cam}</button>
        <button data-act="volume">Volume: ${Math.round(loadVolume() * 100)}%</button>
        <button data-act="abs">ABS: ${onOff(a.abs)}</button>
        <button data-act="tcs">Traction control: ${onOff(a.tcs)}</button>
        <button data-act="steer">Steering assist: ${onOff(a.steer)}</button>
        <button data-act="arcade">Handling: ${a.arcade ? 'Arcade (drift on LT / Space)' : 'Simulation'}</button>
        <button data-act="auto">Gearbox: ${a.auto ? 'Automatic' : 'Manual'}</button>
        <button data-act="leave">${this.setup.online ? 'Leave race' : 'Quit to garage'}</button>
      </div>`);
    setMenuNav(true);
    const save = () => localStorage.setItem(ASSIST_KEY, JSON.stringify(this.assists));
    const redo = () => {
      save();
      this.pause();
      p.querySelector<HTMLElement>(`[data-act="${last}"]`)?.focus();
    };
    let last = '';
    p.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        last = b.dataset.act!;
        switch (last) {
          case 'resume':
            return this.resume();
          case 'restart':
            return this.restart();
          case 'leave':
            this.setup.online?.net.leave();
            return this.exit('garage');
          case 'volume': {
            const i = VOLUMES.indexOf(loadVolume());
            this.audio.setVolume(VOLUMES[(i + 1) % VOLUMES.length]);
            return redo();
          }
          case 'cam':
            this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length];
            localStorage.setItem(CAM_KEY, this.cam);
            return redo();
          case 'arcade':
          case 'tcs':
          case 'abs':
          case 'steer':
          case 'auto':
            this.assists[last] = !this.assists[last];
            if (last === 'auto' && this.me.car.gear === 0 && this.phase !== 'countdown') this.me.car.gear = 1;
            return redo();
        }
      }),
    );
  }

  private resume() {
    this.paused = false;
    this.hud.closePanel();
    setMenuNav(false);
    this.last = performance.now();
  }

  // --- rendering ---------------------------------------------------------------------------------

  private poseLocal(r: Racing, alpha: number) {
    const c = r.car;
    r.model.root.position.lerpVectors(r.prevP, new THREE.Vector3(c.p.x, c.p.y, c.p.z), alpha);
    r.model.root.quaternion.slerpQuaternions(r.prevQ, new THREE.Quaternion(c.q.x, c.q.y, c.q.z, c.q.w), alpha);
    r.model.pose(
      c.wheels.map((w, i) => ({ y: wheelLocal(c, i).y, angle: w.angle })),
      c.steer,
      r.input.brake > 0.1 && c.gear >= 0,
    );
  }

  /**
   * Where a remote car is now, by its last pose carried forward: position along its velocity, heading
   * along its yaw rate, for as long as the pose has been travelling (time since it landed + our round trip,
   * which stands in for its trip from the sender). Capped, so a dropped connection doesn't fly off.
   */
  private predict(r: Remote, now: number, p: THREE.Vector3, q: THREE.Quaternion | null): THREE.Vector3 {
    const l = r.last!;
    const age = Math.min(MAX_PREDICT, now - l.at + this.rtt);
    p.set(l.c.p[0] + l.c.v[0] * age, l.c.p[1] + l.c.v[1] * age, l.c.p[2] + l.c.v[2] * age);
    if (q) q.setFromAxisAngle(UP, l.c.w * age).multiply(new THREE.Quaternion(...l.c.q));
    return p;
  }

  private poseRemote(r: Remote, now: number, dt: number) {
    if (!r.last) return;
    const c = r.last;
    const target = new THREE.Quaternion();
    const p = this.predict(r, now, new THREE.Vector3(), target);
    r.err.multiplyScalar(Math.exp(-dt * CORRECT_RATE));
    r.shownP.copy(p).add(r.err);
    r.shownQ.slerp(target, 1 - Math.exp(-dt * 16));
    const q = r.shownQ;
    r.model.root.position.copy(r.shownP);
    r.model.root.quaternion.copy(q);
    p.copy(r.shownP);
    const g = r.ghost;
    g.p = { x: p.x, y: p.y, z: p.z };
    g.q = { x: q.x, y: q.y, z: q.z, w: q.w };
    g.v = { x: c.c.v[0], y: c.c.v[1], z: c.c.v[2] };
    r.spin += c.c.ws * dt;
    r.rpm += (c.c.rpm - r.rpm) * Math.min(1, dt * 10);
    const sp = r.spec;
    const restY = (a2: number) => sp.mountY[a2] - (sp.rest - (sp.rest + sp.radius - sp.cg - sp.mountY[a2]));
    r.model.pose(
      [0, 1, 2, 3].map((i) => ({ y: restY(i < 2 ? 0 : 1), angle: r.spin })),
      c.c.st,
      (c.c.f & CarFlag.Brake) !== 0,
    );
    r.bubble.visible = (c.c.f & CarFlag.Shield) !== 0;
    // Remote cars grab boxes on their own screens; take them here too so they vanish for us.
    for (const [i, box] of this.boxesNear(c.c.s)) if (Math.hypot(box.x - p.x, box.z - p.z) < box.r + 1) this.propView.takeBox(i, this.wallClock);
    this.driftFx(r.model.root, sp.axleR, sp.track, sp.cg, (c.c.f & CarFlag.Drift) !== 0, (c.c.f >> CarFlag.LevelShift) & 3, (c.c.f & CarFlag.Boost) !== 0, g.v.x, g.v.z);
    if (c.c.f & CarFlag.Skid && this.puffTick % 3 === 0) this.fx.puff(p.x, p.y - sp.cg, p.z, g.v.x, g.v.z, 0.6, (c.c.f & CarFlag.Offroad) !== 0);
  }

  private render(dt: number, alpha: number) {
    const now = performance.now() / 1000;
    const me = this.me;
    this.puffTick++;
    for (const r of [me, ...this.rivals]) {
      this.poseLocal(r, alpha);
      this.tyreEffects(r, r === me ? 0 : 1 + this.rivals.indexOf(r));
    }
    for (const r of this.remotes.values()) this.poseRemote(r, now, dt);
    this.trafficView?.update(this.trafficTime - (1 - alpha) * TICK_DT);
    const view = this.camTarget();
    this.updateCamera(dt, view);
    this.view.follow(this.camera.position.x, view.root.position.y, this.camera.position.z, now);
    this.sound();
    this.updateHud();
    this.post.render(now);
  }

  private tyreEffects(r: Racing, idx: number) {
    const c = r.car;
    const sp = speedOf(c);
    const root = r.model.root;
    const rx = Math.cos(yawOf(c));
    const rz = -Math.sin(yawOf(c));
    c.wheels.forEach((w, i) => {
      const local = wheelLocal(c, i);
      const wp = new THREE.Vector3(local.x, local.y - c.spec.radius, local.z).applyMatrix4(root.matrixWorld);
      // Marks once a tyre is well past its peak; smoke only in a real slide or burnout.
      const marking = w.contact && w.slip > 1.35 && sp > 2 && !soft(w.surf);
      const smoking = w.contact && w.slip > 1.8 && sp > 2 && !soft(w.surf);
      const dirt = w.contact && soft(w.surf) && sp > 4;
      this.fx.mark(idx * 4 + i, wp.x, wp.y, wp.z, rx, rz, 0.22, marking ? Math.min(1, (w.slip - 1.2) * 1.2) : 0);
      if ((smoking && this.puffTick % 3 === 0) || (dirt && this.puffTick % 4 === 0)) this.fx.puff(wp.x, wp.y, wp.z, c.v.x, c.v.z, Math.min(1.5, w.slip - 1.5), dirt);
    });
    this.driftFx(root, c.spec.axleR, c.spec.track, c.spec.cg, c.drift !== 0, c.driftLevel, c.boost > 0, c.v.x, c.v.z);
  }

  /** Sparks off the rear wheels while drifting (coloured by the level earned), flames from the exhaust while boosting. */
  private driftFx(root: THREE.Object3D, axleR: number, track: number, cg: number, drifting: boolean, level: number, boosting: boolean, vx: number, vz: number) {
    if (drifting && this.puffTick % 2 === 0) {
      const color = SPARK_COLORS[level];
      for (const side of [-0.5, 0.5]) {
        const p = new THREE.Vector3(side * track, 0.05 - cg, axleR + 0.1).applyMatrix4(root.matrixWorld);
        for (let k = 0; k < 2; k++) this.fx.spark(p.x, p.y, p.z, vx * 0.7 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, vz * 0.7 + (Math.random() - 0.5) * 3, color, 0.3, level ? 0.5 : 0.3);
      }
    }
    if (boosting) {
      const p = new THREE.Vector3(0, 0.35 - cg, axleR + 1.2).applyMatrix4(root.matrixWorld);
      for (let k = 0; k < 3; k++) this.fx.spark(p.x, p.y, p.z, vx * 0.6 + (Math.random() - 0.5), (Math.random() - 0.3) * 1.2, vz * 0.6 + (Math.random() - 0.5), Math.random() < 0.5 ? [1, 0.55, 0.15] : [0.4, 0.75, 1], 0.25, 0.9);
    }
  }

  /** What the camera follows: your car, or the racer you're spectating (posed from its last update). */
  private camTarget(): CamTarget {
    const r = this.watching !== null ? this.remotes.get(this.watching) : undefined;
    if (!r?.last) {
      const c = this.me.car;
      return { root: this.me.model.root, id: c.spec.id, cg: c.spec.cg, v: c.v, yaw: yawOf(c), fwd: forwardSpeed(c), hit: c.hit, boost: c.boost > 0 };
    }
    const root = r.model.root;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
    const v = { x: r.last.c.v[0], y: r.last.c.v[1], z: r.last.c.v[2] };
    return { root, id: r.spec.id, cg: r.spec.cg, v, yaw: Math.atan2(-f.x, -f.z), fwd: v.x * f.x + v.y * f.y + v.z * f.z, hit: 0, boost: (r.last.c.f & CarFlag.Boost) !== 0 };
  }

  private updateCamera(dt: number, t: CamTarget) {
    const root = t.root;
    const v = t.v;
    const speed = Math.hypot(v.x, v.y, v.z);
    const b = CARS[t.id];
    const back = this.controls.lookBack;
    if (this.cam === 'hood' || this.cam === 'bumper') {
      const local = this.cam === 'hood' ? new THREE.Vector3(0, b.height - t.cg + 0.05, -0.15) : new THREE.Vector3(0, 0.7 - t.cg, -b.length / 2 + 0.1);
      this.camera.position.copy(local.applyMatrix4(root.matrixWorld));
      const ahead = new THREE.Vector3(0, local.y - 0.4, back ? 50 : -50).applyMatrix4(root.matrixWorld);
      this.camera.lookAt(ahead);
      this.camera.fov = 70 + Math.min(14, speed * 0.18);
    } else {
      const near = this.cam === 'near';
      const dist = (near ? 4.8 : 6.8) + b.length * 0.35;
      const height = (near ? 1.7 : 2.4) + b.height * 0.25;
      // Trail along the direction of travel (blending toward the nose at low speed), so slides show.
      const fx = -Math.sin(t.yaw);
      const fz = -Math.cos(t.yaw);
      const vs = Math.hypot(v.x, v.z);
      const blend = Math.min(1, vs / 15) * 0.55;
      let dx = fx * (1 - blend) + (vs > 0.5 ? (v.x / vs) * blend : 0);
      let dz = fz * (1 - blend) + (vs > 0.5 ? (v.z / vs) * blend : 0);
      if (t.fwd < -1) {
        dx = fx;
        dz = fz;
      }
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const sgn = back ? -1 : 1;
      // Smooth the direction we trail along (not the position), so the distance stays fixed at any speed.
      this.camDir.lerp(new THREE.Vector2(dx, dz), 1 - Math.exp(-dt * (back ? 30 : 5))).normalize();
      this.camY += (height - this.camY) * (1 - Math.exp(-dt * 6));
      const cdx = this.camDir.x * sgn;
      const cdz = this.camDir.y * sgn;
      const pos = new THREE.Vector3(root.position.x - cdx * dist, root.position.y + this.camY, root.position.z - cdz * dist);
      // Stay above the ground.
      pos.y = Math.max(pos.y, root.position.y - t.cg + 0.8);
      const look = new THREE.Vector3(root.position.x + cdx * 4, root.position.y + 0.9, root.position.z + cdz * 4);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 14));
      this.camera.position.copy(pos);
      // A little shake at speed and on impacts.
      const shake = Math.min(0.04, speed * 0.0004) + Math.min(0.2, t.hit * 0.02);
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.camera.lookAt(this.camLook);
      this.camera.fov = 60 + Math.min(18, speed * 0.22) + (t.boost ? 8 : 0);
    }
    this.camera.updateProjectionMatrix();
  }

  private snapCamera() {
    const t = this.camTarget();
    const p = t.root.position;
    this.camDir.set(-Math.sin(t.yaw), -Math.cos(t.yaw));
    this.camLook.set(p.x, p.y + 0.9, p.z);
    t.root.updateMatrixWorld();
  }

  private sound() {
    this.audio.resume();
    const me = this.me.car;
    const cam = this.camera.position;
    const near = (x: number, y: number, z: number) => Math.max(0, 1 - Math.hypot(x - cam.x, y - cam.y, z - cam.z) / 90) ** 2;
    this.me.engine?.update(me.rpm, me.load, me.spec.redline, this.watching === null ? 1 : near(me.p.x, me.p.y, me.p.z));
    for (const r of this.rivals) r.engine?.update(r.car.rpm, r.car.load, r.car.spec.redline, near(r.car.p.x, r.car.p.y, r.car.p.z));
    for (const r of this.remotes.values()) {
      const p = r.model.root.position;
      r.engine?.update(r.rpm, 0.6, r.spec.redline, near(p.x, p.y, p.z));
    }
    const slip = Math.max(...me.wheels.map((w) => (w.contact && !soft(w.surf) ? w.slip : 0)));
    const off = me.wheels.filter((w) => w.contact && soft(w.surf)).length / 4;
    const speed = speedOf(me);
    this.audio.surroundings(slip, off, speed);
    // Rumble: road texture off the tarmac, the tyres at the limit.
    if (this.wallClock > this.rumbleAt && !this.paused) {
      const strong = off * Math.min(1, speed / 20) * 0.5;
      const weak = Math.max(0, Math.min(1, slip - 0.95)) * 0.6;
      if (strong + weak > 0.05) rumble(strong, weak, 120);
      this.rumbleAt = this.wallClock + 0.1;
    }
  }

  private updateHud() {
    const me = this.me;
    const c = me.car;
    const yaw = yawOf(c);
    const tangentDot = -Math.sin(yaw) * this.track.tx[c.hint] + -Math.cos(yaw) * this.track.tz[c.hint];
    const dots: Dot[] = [{ s: c.s, me: true, color: me.color, x: c.p.x, z: c.p.z }];
    for (const r of this.rivals) dots.push({ s: r.car.s, me: false, color: r.color, x: r.car.p.x, z: r.car.p.z });
    for (const r of this.remotes.values()) dots.push({ s: r.s, me: false, color: r.color, x: r.model.root.position.x, z: r.model.root.position.z });
    // Everyone in race order (finishers by time, then by distance down the road): your place, the board, the tags.
    type Who = { name: string; color: string; me: boolean; tag: Tag['id']; root: THREE.Object3D; height: number };
    const order = standings<Who>([
      { who: { name: me.name, color: me.color, me: true, tag: 'me', root: me.model.root, height: CARS[c.spec.id].height - c.spec.cg }, finished: me.finished, progress: c.s },
      ...this.rivals.map((r, i) => ({ who: { name: r.name, color: r.color, me: false, tag: 'ai' + i, root: r.model.root, height: CARS[r.car.spec.id].height - r.car.spec.cg }, finished: r.finished, progress: r.car.s })),
      ...[...this.remotes.values()].map((r) => ({ who: { name: r.name, color: r.color, me: false, tag: r.id, root: r.model.root, height: CARS[r.spec.id].height - r.spec.cg }, finished: r.finished, progress: r.s })),
    ]);
    const followed = this.watching !== null && this.remotes.get(this.watching)?.last ? this.watching : 'me';
    this.hud.tags(order.filter((e) => e.who.tag !== followed).map((e) => ({ id: e.who.tag, name: e.who.name, color: e.who.color, place: order.indexOf(e) + 1, at: this.tagAt(e.who.tag, e.who.root, e.who.height) })));
    this.hud.update({
      speed: speedOf(c),
      rpm: c.rpm,
      redline: c.spec.redline,
      gear: c.gear,
      shifting: c.shift > 0,
      place: order.findIndex((e) => e.who.me) + 1,
      field: order.length,
      time: me.finished ?? this.time,
      lap: me.finished !== null ? this.track.def.laps ?? 0 : lapOf(this.track, c.s),
      laps: this.track.def.laps ?? 0,
      abs: c.absOn,
      tcs: c.tcsOn,
      wrongWay: this.phase === 'racing' && tangentDot < -0.3 && speedOf(c) > 3,
      manual: !this.assists.auto,
      drift: c.drift !== 0 ? c.driftLevel : -1,
      item: this.wallClock < this.rouletteUntil ? { icon: ITEMS[(['turbo', 'oil', 'shield', 'triple', 'shock', 'comet'] as Item[])[Math.floor(this.wallClock * 12) % 6]].icon, name: '', spinning: true } : me.item ? { icon: ITEMS[me.item.kind].icon, name: ITEMS[me.item.kind].name + (me.item.uses > 1 ? ` ×${me.item.uses}` : ''), spinning: false } : null,
      boost: c.boost > 0,
      heading: yaw,
      dots,
      board: order.map((e) => ({ name: e.who.name, color: e.who.color, me: e.who.me, finished: e.finished })),
    });
  }

  /** Where a name tag goes on screen: just over the car's roof, faded with distance, hidden off screen or behind a hill. */
  private tagAt(id: Tag['id'], root: THREE.Object3D, height: number): Tag['at'] {
    const cam = this.camera;
    const p = new THREE.Vector3(root.position.x, root.position.y + height + 0.6, root.position.z);
    const dist = p.distanceTo(cam.position);
    if (dist > TAG_FAR) return null;
    cam.updateMatrixWorld();
    const ndc = p.clone().project(cam);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) return null;
    let seen = this.tagHidden.get(id);
    if (!seen || this.puffTick - seen.at >= TAG_CHECK) {
      let hidden = false;
      for (let k = 1; k < 8 && !hidden; k++) {
        const f = k / 8;
        const x = cam.position.x + (p.x - cam.position.x) * f;
        const y = cam.position.y + (p.y - cam.position.y) * f;
        const z = cam.position.z + (p.z - cam.position.z) * f;
        hidden = heightAt(this.track, x, z) > y + 0.5;
      }
      seen = { hidden, at: this.puffTick };
      this.tagHidden.set(id, seen);
    }
    if (seen.hidden) return null;
    const w = this.setup.container.clientWidth || innerWidth;
    const h = this.setup.container.clientHeight || innerHeight;
    const alpha = 1 - Math.min(1, Math.max(0, (dist - TAG_NEAR) / (TAG_FAR - TAG_NEAR)));
    return { x: (ndc.x * 0.5 + 0.5) * w, y: (-ndc.y * 0.5 + 0.5) * h, alpha };
  }

  private resize = () => {
    const w = this.setup.container.clientWidth || innerWidth;
    const h = this.setup.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // --- leaving ---------------------------------------------------------------------------------

  /** Leaves the race (browser Back does this too). */
  exit(to: 'garage' | 'lobby' = 'garage', notice?: string) {
    if (this.exited) return;
    if (to === 'garage' && this.setup.online) this.setup.online.net.leave();
    this.dispose();
    this.setup.onExit(to, notice);
  }

  private dispose() {
    this.exited = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.offNet?.();
    this.controls.dispose();
    this.hud.dispose();
    for (const r of [this.me, ...this.rivals]) r.model.dispose();
    for (const r of this.remotes.values()) r.model.dispose();
    this.fx.dispose();
    this.trafficView?.dispose();
    this.cometGeo.dispose();
    this.cometMat.dispose();
    this.view.dispose();
    this.post.dispose();
    this.audio.close();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    setMenuNav(true);
  }
}
