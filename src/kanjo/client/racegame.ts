// A race: the fixed-tick car simulation (yours, plus AI rivals in a solo race), remote cars interpolated
// from snapshots online, chase/cockpit/hood/bumper cameras, the HUD, sound, tyre smoke and skids, rumble, and the
// finish (results and prize money).

import * as THREE from 'three';
import { CARS, type CarId, type CarSpec, type OwnedCar, PAINTS, carSpec, decodeCar, encodeCar, myRaceCar, newOwnedCar, rivalCar } from '../shared/cars.ts';
import { type Ai, type CpuLevel, aiDrive, isCpuLevel, newAi, resetOnRoad, rivalAi } from '../shared/driver.ts';
import { DRAFT, type Body, stepDraft, strongestWake } from '../shared/draft.ts';
import { DAMAGE, type Damage, ZONES, damagedInput, newDamage, packZones, repair, takeHit, unpackZones } from '../shared/damage.ts';
import { Blasts, CarDents } from './damageview.ts';
import { bankCombo, comboPoints, dropCombo, newDriftMeter, stepDrift } from '../shared/drift.ts';
import { tierOf } from '../shared/pass.ts';
import { CUPS, addRound, roundLabel, roundsOf } from '../shared/cups.ts';
import { CAR_RULES, CPU, CarFlag, RACE, RACE_MODES, TEAMS, cleanMode, ghostMode, recordMode, teammates, type CarRule, type GpState, type NetCar, type RaceMode, type RaceServerMsg, type Racer, type RecordRow, type Team } from '../shared/protocol.ts';
import type { NewBest } from '../shared/records.ts';
import { ROYALE, Royale } from '../shared/royale.ts';
import { standings } from '../shared/standings.ts';
import { SAMPLE, type Surface, type Track, type TrackId, getTrack, gridSlot, heightAt, lapOf, locate, newLoc, onFork } from '../shared/track.ts';
import { skyFall } from '../shared/skyfall.ts';
import { type Assists, type Car, DEFAULT_ASSISTS, type DriveInput, TICK_DT, collideCars, forwardSpeed, newCar, placeCar, speedOf, stepCar, wheelLocal, yawOf } from '../shared/vehicle.ts';
import { WORLD, respawnAt, trapCrossed } from '../shared/world.ts';
import { collideWorldTraffic, newNearMisses, roamClock, stepNearMisses } from '../shared/worldtraffic.ts';
import { WorldTrafficView } from './worldtrafficview.ts';
import { buildWorldView } from './worldview.ts';
import { PropView } from './propview.ts';
import { padKick } from '../shared/boost.ts';
import { type Obstacle, type Traffic, collideTraffic, getTraffic, trafficBetween } from '../shared/traffic.ts';
import { TrafficView } from './trafficview.ts';
import { rumble, setMenuNav } from '../../client/pad.ts';
import { esc } from '../../client/menu/ui.ts';
import { Engine, RaceAudio, VOLUMES, loadVolume } from './audio.ts';
import { type CarModel, INTERIOR, buildCar, ghostly } from './carmodel.ts';
import { LAMP_DAY, LAMP_NIGHT, setLampLevel } from './carparts.ts';
import { type Rider, decodeRider, defaultRider, rivalRider } from '../shared/rider.ts';
import type { GhostRun } from '../shared/ghost.ts';
import { GhostCar } from './ghostcar.ts';
import { HIGHLIGHT, type Moment, MomentFlag, MomentTape, type PlayPose, bestMoment, momentLine, newPlayPose } from '../shared/highlight.ts';
import { type Cockpit, buildCockpit } from './cockpit.ts';
import { Head, ROUGH } from './headcam.ts';
import { Effects } from './effects.ts';
import { garage } from './garageStore.ts';
import { type Dot, type ResultLine, RaceHud, type Tag, cupHtml, fmtTime, money, ordinal } from './hud.ts';
import { saveHighs } from './highs.ts';
import { DriveControls } from './input.ts';
import { type RaceNet, roomRace } from './racenet.ts';
import type { DriveOpts } from '../../client/menu/router.ts';
import { Post } from './post.ts';
import { drawLow } from './lowgfx.ts';
import { ContactShadows } from './contactshadow.ts';
import { frameGate, lowGraphics, LOW_PIXEL_RATIO, releaseRenderer } from '../../client/graphics.ts';
import { buildTrackView, type TrackView } from './trackview.ts';

export interface RaceSetup {
  container: HTMLElement;
  track: TrackId;
  name: string;
  car: OwnedCar;
  /** Your driver (rider.ts): on a bike, they're the one riding it. */
  rider: Rider;
  /**
   * Online: the lobby socket, the grid the server just sent, and whether it's a race or a ghost time trial, with the car rule and every racer's car code for this race (which can differ
   * from their garage car). The car
   * waits on the line until every racer has loaded and the server sends the countdown.
   */
  /** `solo`: a solo time trial (a private room of one, hub.ts `soloTrial`): no lobby to go back to. */
  online?: { net: RaceNet; mode: RaceMode; grid: Record<number, number>; racers: Racer[]; rule: CarRule; cars: Record<number, string>; physics: boolean; ghost?: GhostRun | null; solo?: boolean; laps?: number };
  /** Solo: how many AI rivals. */
  rivals?: number;
  /** Solo: Physics mode (crash damage, damage.ts). Online it comes with the race (`online.physics`). */
  physics?: boolean;
  /**
   * A Grand Prix round (cups.ts): the cup, the round and the table before it. Solo, the results add this race to the
   * table and Next race hands `onNext` the next round; online the room keeps the table and sends it with `results`.
   */
  gp?: GpState;
  onExit(to: 'garage' | 'lobby', notice?: string): void;
  /** Online: the host raced again while we sat on the results; this race hands over to the next one. */
  onNext?(next: DriveOpts): void;
}

type Phase = 'countdown' | 'racing' | 'finished' | 'done';
type Cam = 'chase' | 'near' | 'cockpit' | 'hood' | 'bumper';
const CAMS: Cam[] = ['chase', 'near', 'cockpit', 'hood', 'bumper'];
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
/**
 * The exhaust flame while boosting (2026-11-08, Andrew: the boosting cars' "really bright rear lights"). It used to be
 * 3 full-glow sparks a frame (~100 alive at once at 144 fps), which bloomed into one white blob behind every car.
 * Now a steady trickle per second whatever the frame rate, small, short and mostly its own colour: a blue jet at
 * the pipe with an orange lick, which still glows a little at night.
 */
const FLAME = {
  /** Particles per second per car. */
  rate: 70,
  life: 0.12,
  size: 0.3,
  /** Share of the car's velocity the flame keeps, so it trails close behind the pipe as one jet. */
  carry: 0.88,
  /** Share of the white-hot spark core (effects.ts `spark`). */
  glow: 0.22,
  colors: [
    [0.3, 0.5, 1],
    [0.45, 0.62, 1],
    [0.95, 0.45, 0.12],
  ],
};
const SOLO_COUNTDOWN = 3.5;
/** Past this (m) a driver isn't drawn: they're ~30k triangles, and through tinted glass gone after a few car lengths. */
const DRIVER_RANGE = 70;
/** Name tags: fully shown up to TAG_NEAR (m), faded out by TAG_FAR; hills between are checked every TAG_CHECK frames. */
const TAG_NEAR = 120;
const TAG_FAR = 280;
const TAG_CHECK = 6;
/**
 * Name tags stay faint so they don't hide the road from the cars behind: never more than TAG_ALPHA, and a car close
 * ahead (where its tag sits right over the racing line) fades its tag to TAG_CLOSE_ALPHA inside TAG_CLOSE_IN m, back
 * up by TAG_CLOSE_OUT m.
 */
const TAG_ALPHA = 0.6;
const TAG_CLOSE_ALPHA = 0.25;
const TAG_CLOSE_IN = 15;
const TAG_CLOSE_OUT = 45;
/** Adaptive resolution (racegame.adaptResolution): frame-time thresholds (ms), how long they must hold (s), the step and floor. */
/**
 * Speed blur at the edges of the frame (post.ts `rush`): from `from` m/s (~150 km/h), full at `full` (~290 km/h), `boost`
 * more on a boost, and a share of it from the cockpit, where the A pillars and dash already sell the speed.
 */
const RUSH = { from: 42, full: 80, boost: 0.35, cockpit: 0.5 };
const RES = { slowMs: 22, slowFor: 1.5, fastMs: 15, fastFor: 6, step: 0.15, min: 0.55, settle: 4 };
/**
 * The Best Moment replay's camera (racegame.ts `replayCamera`): angles round the car from its direction of travel
 * (0 ahead, π behind) at the start and end of the shot, distance (plus 0.4 of the car's length) and height over it.
 * `orbit` (drifts, jumps) swings from behind to the side; `flyby` (flat out) starts ahead, low, and lets it go by.
 */
const REPLAY_CAM = {
  orbit: { from: 2.65, to: 1.55, dist: 6, lowY: 1.2, highY: 2.2 },
  flyby: { from: 0.75, to: 2.5, dist: 6.5, lowY: 0.8, highY: 1.5 },
  fov: 52,
  /** How fast it turns with the car (1/s). */
  follow: 3,
};
/** Yaw (three.js convention) of a replay pose's nose. */
const yawOfPose = (p: PlayPose) => {
  const [x, y, z, w] = p.q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
};
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const RIVAL_NAMES = CPU.names;

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
  /** Online, a CPU racer this (host's) client drives: its racer id in the room. */
  netId?: number;
  input: DriveInput;
  /** Physics mode: how damaged the car is, and its body's dents. */
  dmg: Damage;
  dents: CarDents;
  /** A battle royale: knocked out on `lap`, finishing `place` (its car is destroyed and off the road). */
  out?: { place: number; lap: number };
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
  s: number;
  finished: number | null;
  spin: number;
  rpm: number;
  /** Physics mode: the damage it last reported (packed zones) and its body's dents. */
  dm: number;
  dents: CarDents;
  /** A battle royale: knocked out on `lap`, finishing `place`. */
  out?: { place: number; lap: number };
}

const UP = new THREE.Vector3(0, 1, 0);

/** The winner's Best Moment on screen: the race clock it's at, the car it's about and how the camera moves. */
interface Replay {
  t: number;
  end: number;
  star: Racing | Remote;
  moment: Moment;
  /** Which way the camera swings round the car (+1 / -1), and the direction of travel it frames against (smoothed). */
  side: number;
  dir: THREE.Vector2;
  fresh: boolean;
  el: HTMLElement;
  done: () => void;
}

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
/** CPU difficulty (driver.ts CPU_LEVELS), picked on the Race page; it also sets an online lobby's CPUs when you host. */
const CPU_KEY = 'atrous.cpu';
export function cpuLevel(): CpuLevel {
  try {
    const v = localStorage.getItem(CPU_KEY);
    return isCpuLevel(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}
export function setCpuLevel(level: CpuLevel) {
  try {
    localStorage.setItem(CPU_KEY, level);
  } catch {
    /* private mode */
  }
}

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
  /** For the cockpit camera: the car's numbers, wheel angle, revs, hardest landing and how rough the ground is (0: airborne). */
  spec: CarSpec;
  steer: number;
  rpm: number;
  land: number;
  rough: number;
}

/** ", incl. $X drifting" for a results note (nothing when there's no bonus). */
function bonusNote(b: { drift: number } | undefined): string {
  return b && b.drift > 0 ? ` (incl. ${money(b.drift)} drifting)` : '';
}

/**
 * " · +350 XP" for a results note, with the battle pass tier it reached when it reached one. `before`: your XP before
 * the race (an account's new total lands from the server a moment later).
 */
function xpNote(xp: number, before: number): string {
  if (xp <= 0) return '';
  const tier = tierOf(before + xp);
  return ` · +${xp} XP${tier > tierOf(before) ? ` · Battle pass tier ${tier}${garage.g.pass ? ' unlocked' : ' reached'}` : ''}`;
}

/** " · New best on Kōri Pass (−1.234 s), 4th all-time" (or a new track record) for a results note. */
function bestNote(b: NewBest | null | undefined, track: string): string {
  if (!b) return '';
  if (b.rank === 1) return ` · New track record on ${track}${b.beat ? ` (−${(b.beat.time - b.time).toFixed(3)} s)` : ''}`;
  return ` · New best on ${track}${b.prev === null ? '' : ` (−${(b.prev - b.time).toFixed(3)} s)`}${b.rank ? `, ${ordinal(b.rank)} all-time` : ''}`;
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
  private contact: ContactShadows;
  private propView: PropView;
  /** City traffic, and the race clock it runs on (seconds since GO; counts up to 0 during the countdown). */
  private traffic: Traffic | null;
  private trafficView: TrafficView | null = null;
  /** Free roam (a world track, world.ts): no finish, no rivals, open-world traffic on the wall clock, speed traps. */
  private roam: boolean;
  private worldTraffic: WorldTrafficView | null = null;
  private nearMisses = newNearMisses();
  /** Free roam: your best speed through each trap this session (km/h), by trap name. */
  private trapBest = new Map<string, number>();
  private trafficTime = 0;
  private obstacles: Obstacle[] = [];
  private controls = new DriveControls();
  private me: Racing;
  private rivals: Racing[] = [];
  private remotes = new Map<number, Remote>();
  /** Online, with the host's Record ghost on: the track record's run riding along, and its clock (s since GO). */
  private recordGhost: GhostCar | null = null;
  private ghostT = 0;
  /** Where the record ghost is on the road (a circuit's samples run on lap after lap, so this counts laps too). */
  private ghostLoc = newLoc();
  private assists = loadAssists();
  private cam: Cam = (localStorage.getItem(CAM_KEY) as Cam) || 'chase';
  /** Chase camera: the (smoothed) direction it trails along, and its smoothed height above the car. */
  private camDir = new THREE.Vector2(0, -1);
  private camY = 2.4;
  private camLook = new THREE.Vector3();
  /** Cockpit camera: the driver's head, each car's interior (built the first time you sit in it), and what the head last saw. */
  private head = new Head();
  private cockpits = new Map<THREE.Object3D, Cockpit>();
  /** The cabin of the car the cockpit camera is in (hidden). */
  private hiddenCabin: THREE.Object3D | null = null;
  private headRoot: THREE.Object3D | null = null;
  private headV = new THREE.Vector3();
  private headA = new THREE.Vector3();
  private headYaw = 0;
  private headHit = 0;
  private headLand = 0;
  /** Online, after you finish: the remote racer the camera follows (null: your own car). */
  private watching: number | null = null;
  private phase: Phase = 'countdown';
  private countdown: number;
  /** Online: on the grid, waiting for the others to load (the countdown doesn't run until the server says so). */
  private held = false;
  /** Online: frames drawn so far; once the first few (which compile the shaders) are out, we tell the server we're ready. */
  private frames = 0;
  private lastBeep = 99;
  private time = 0;
  /** Online: seconds since GO, still running after you finish (it times the host's CPU racers). */
  private clock = 0;
  /** The lap you're on (circuits) and when you started it. */
  private lap = 1;
  private lapStart = 0;
  /** Your quickest lap so far (circuits), sent with your finish time. */
  private bestLap = Infinity;
  /** The fastest you've gone this race (m/s), for your highs on the player card (highs.ts). */
  private topSpeed = 0;
  /** A time trial: the other racers are ghosts (no contact, no slipstream). */
  private readonly trial: boolean;
  /** A Team Grand Prix: each racer's team by their id in the room (empty in every other mode). */
  private readonly teams = new Map<number, Team>();
  /** A time trial or hill climb: the host's car rule, and the results show gaps. */
  private readonly clean: boolean;
  /** A hill climb (one run up the mountain). */
  private readonly climb: boolean;
  private acc = 0;
  private last = performance.now();
  /** Full-quality pixel ratio, and the adaptive share of it in use (see adaptResolution). */
  private basePixelRatio = 1;
  resScale = 1;
  private frameMs = 16;
  private slowSince = 0;
  private fastSince = 0;
  private raf = 0;
  private paused = false;
  private sendAcc = 0;
  private pingAcc = 0;
  /** Round trip to the server (s), smoothed. Roughly how old another car's pose is when it lands. */
  private rtt = 0;
  private offNet: (() => void) | null = null;
  private resetAt = 0;
  private myPrize: number | null = null;
  /** The online results on screen, kept so `records` (new best times) can mark them. */
  private shownResults: { lines: (ResultLine & { id: number })[]; title: string } | null = null;
  /** The online Grand Prix round whose results are on screen (null: not a Grand Prix). */
  private gpShown: (GpState & { final: boolean }) | null = null;
  private puffTick = 0;
  private rumbleAt = 0;
  private lastGear = 1;
  private lastLevel = 0;
  private boosting = false;
  /** Slipstream: the wall-clock time the slingshot label shows until, and whether the charge was ready last tick. */
  private slingUntil = 0;
  private draftReady = false;
  private wallClock = 0;
  private exited = false;
  /** Every car's run on the race clock (seconds since GO), for the winner's Best Moment replay (highlight.ts). */
  private tapes = new Map<Racing | Remote, MomentTape>();
  /** The Best Moment playing after the finish, before the results. */
  private replay: Replay | null = null;
  /** Name tags hidden behind a hill, by tag id, and the frame each was last checked. */
  private tagHidden = new Map<Tag['id'], { hidden: boolean; at: number }>();

  /** Your drift score this race (pays a bonus at the end). */
  private driftMeter = newDriftMeter();

  /** Low graphics (src/client/graphics.ts), and its frame cap. */
  private readonly low = lowGraphics();
  private gate = frameGate(60);

  /** A time trial's car rule, for the banner at GO ('' for own cars). */
  private carNote = '';
  /** Physics mode: crash damage, wrecks and respawns (damage.ts). Explosions only exist when it's on. */
  private readonly physics: boolean;
  private blasts: Blasts | null = null;
  /**
   * A battle royale (royale.ts; any race on a `royale` arena, which only that mode runs): the last car over the line
   * each lap is destroyed. Solo this client judges it (`royale`); online the room does and says `out`.
   */
  private readonly royaleOn: boolean;
  private royale: Royale | null = null;
  /** Solo battle royale: each car's key in `royale`. */
  private royaleKeys = new Map<number, Racing>();
  /** Solo rivals knocked out (taken off the road, kept for the results). */
  private fallen: Racing[] = [];
  /** Spectating one of the cars this client drives (a solo rival, or the host's CPU racer) instead of a remote. */
  private watchCar: Racing | null = null;
  /** The input a damaged car actually gets (reused every tick). */
  private driven: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

  constructor(private setup: RaceSetup) {
    // An Endurance race runs the circuit the host's number of laps (the same road, unrolled that many times).
    this.track = getTrack(setup.track, setup.online?.mode === 'endurance' ? setup.online.laps : undefined);
    // Headlamps blaze at night (the bloom catches them) and only glow by day.
    setLampLevel(this.track.def.theme === 'night' || this.track.def.theme === 'city' ? LAMP_NIGHT : LAMP_DAY);
    this.trial = !!setup.online && ghostMode(setup.online.mode);
    this.clean = !!setup.online && cleanMode(setup.online.mode);
    this.climb = setup.online?.mode === 'climb';
    this.physics = setup.online ? !!setup.online.physics : !!setup.physics;
    this.royaleOn = !!this.track.def.royale;
    // Low graphics (the Settings tab): no MSAA, native pixels at most, no shadow map, no post chain, simple
    // materials, a thinner forest and a 60 fps cap. Read once here, so a change applies from the next race.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: this.low ? 'default' : 'high-performance' });
    this.basePixelRatio = Math.min(devicePixelRatio, this.low ? LOW_PIXEL_RATIO : 1.75);
    this.renderer.setPixelRatio(this.basePixelRatio * this.resScale);
    this.renderer.shadowMap.enabled = !this.low;
    // PCF: three.js removed PCFSoftShadowMap and swaps it for PCF at the first shadow draw, after the shaders were
    // compiled for the old type (so every lit shader compiled twice).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'race-canvas';
    setup.container.appendChild(this.renderer.domElement);
    this.roam = !!this.track.world;
    this.view = this.roam ? buildWorldView(this.track, this.renderer, this.low) : buildTrackView(this.track, this.renderer, this.low);
    this.renderer.toneMappingExposure = this.view.exposure;
    this.post = new Post(this.renderer, this.view.scene, this.camera, this.view.grade, this.low);
    this.post.sun = this.view.sunDir;
    this.fx = new Effects(this.view.scene);
    this.contact = new ContactShadows(this.view.scene);
    this.propView = new PropView(this.view.scene, this.track);
    // (A battle royale's knockouts blow up too: built now, so its flash light is in the scene from the start.)
    if (this.physics || this.royaleOn) this.blasts = new Blasts(this.view.scene, this.track, this.fx);
    this.traffic = getTraffic(this.track);
    if (this.traffic) this.trafficView = new TrafficView(this.view.scene, this.track, this.traffic);
    if (this.track.world) {
      this.worldTraffic = new WorldTrafficView(this.view.scene, this.track.world.world, this.low);
      this.trafficTime = roamClock();
    }
    this.hud = new RaceHud(setup.container, this.track);
    this.audio = new RaceAudio();

    const online = setup.online;
    // (A solo battle royale needs someone to outlast.)
    const rivals = online || this.roam ? 0 : Math.max(this.royaleOn ? ROYALE.minRivals : 0, Math.min(7, setup.rivals ?? 5));
    // Solo, you start mid-pack.
    const mySlot = online ? (online.grid[online.net.id] ?? 0) : Math.floor(rivals / 2);
    // Online, the server says what you drive (a maxed Vanta, or your car maxed out, in a time trial).
    const myCar = online ? myRaceCar(online.rule, online.cars[online.net.id], setup.car) : setup.car;
    this.me = this.spawn(myCar, mySlot, setup.name, true, setup.rider);
    if (online) {
      // Say what everyone's driving now, and again with the time trial's banner at GO.
      this.carNote = online.rule === 'vanta' ? `${CAR_RULES.vanta.name}: the same ${CARS.vanta.name} for everyone` : online.rule === 'maxed' ? `${CAR_RULES.maxed.name}: every part at level 5` : '';
      if (this.carNote) this.hud.banner(CAR_RULES[online.rule].name, online.rule === 'vanta' ? `Everyone drives a maxed ${CARS.vanta.name}` : 'Every part at level 5', 3500);
      else this.hud.banner('Waiting for racers', 'Loading the track…', 0);
      // The host drives the lobby's CPU racers here, with the solo race's AI; everyone else sees them as racers.
      const host = online.net.room?.hostId === online.net.id;
      let k = 0;
      for (const r of online.racers) {
        if (r.id === online.net.id || !(r.id in online.grid)) continue;
        const car = online.cars[r.id] ?? r.car;
        if (!(r.cpu && host)) {
          this.addRemote({ ...r, car });
          continue;
        }
        const bot = this.spawn(decodeCar(car) ?? newOwnedCar('pebble'), online.grid[r.id], r.name, false, decodeRider(r.rider) ?? defaultRider());
        bot.ai = rivalAi(k, cpuLevel());
        bot.netId = r.id;
        this.rivals.push(bot);
        k++;
      }
      // A Team Grand Prix: everyone's team, for contact (teammates drive through each other) and the name tags,
      // map dots and board, which take the team's colour instead of the car's paint.
      if (online.mode === 'team') {
        for (const r of online.racers) if (r.team !== undefined) this.teams.set(r.id, r.team);
        const tint = (id: number | undefined, x: { color: string }) => {
          const t = id === undefined ? undefined : this.teams.get(id);
          if (t !== undefined) x.color = TEAMS[t].color;
        };
        tint(online.net.id, this.me);
        for (const r of this.rivals) tint(r.netId, r);
        for (const r of this.remotes.values()) tint(r.id, r);
      }
      if (online.ghost) this.recordGhost = new GhostCar(online.ghost, this.view.scene);
      this.countdown = RACE.countdownMs / 1000;
      this.held = true;
      this.offNet = online.net.on((m) => this.onNet(m));
    } else {
      for (let i = 0; i < rivals; i++) {
        // Rivals in cars near your class, a touch slower or faster, spread over the grid ahead of you.
        const car = rivalCar(setup.car, i);
        const slot = i < mySlot ? i : i + 1;
        // Each rival gets a driver of their own (seen on a bike), the same one every race.
        const r = this.spawn(car, slot, RIVAL_NAMES[i], false, rivalRider(setup.rider, i));
        r.ai = rivalAi(i, cpuLevel());
        this.rivals.push(r);
      }
      // Free roam has nothing to count down to: you're away on the first tick.
      this.countdown = this.roam ? 0 : SOLO_COUNTDOWN;
      if (setup.gp) this.hud.banner(CUPS[setup.gp.cup].name, roundLabel(setup.gp.cup, setup.gp.round), 3200);
    }
    for (const r of [this.me, ...this.rivals]) r.car.gear = 0; // revving on the line
    this.snapCamera();
    this.warmShaders();
    addEventListener('resize', this.resize);
    this.resize();
    setMenuNav(false);
    this.hud.showHelp(false);
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __race: RaceGame }).__race = this;
  }

  // --- setup ---------------------------------------------------------------------------------

  /**
   * Compiles every material in the scene now, behind the loading screen, hidden things included (far scenery, the
   * other cars' parts, effects): otherwise each one compiled the first time it came into view mid-race, a stall of
   * 50-300 ms each on Windows (ANGLE), six of them in Kōri Pass's first 12 seconds. Low compiles its stand-ins.
   */
  private warmShaders() {
    const scene = this.view.scene;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.visible) return;
      hidden.push(o);
      o.visible = true;
    });
    // Into the target the scene is really drawn to: a program compiled for the screen (tone mapped, sRGB) isn't the
    // one the post chain's HDR target uses, and was compiled again mid-race.
    const compile = () => {
      this.renderer.setRenderTarget(this.post.sceneTarget);
      this.renderer.compile(scene, this.camera);
      this.renderer.setRenderTarget(null);
    };
    if (this.low) drawLow(scene, compile);
    else compile();
    for (const o of hidden) o.visible = false;
  }

  private spawn(owned: OwnedCar, slot: number, name: string, mine: boolean, rider: Rider): Racing {
    const g = gridSlot(this.track, slot);
    const car = newCar(carSpec(owned), g.x, g.y, g.z, g.yaw);
    car.hint = Math.round(g.s / 2);
    car.s = g.s;
    const model = buildCar(owned, rider);
    this.view.scene.add(model.root);
    this.headlights(model.root, owned);
    const b = CARS[owned.model];
    // Darkest with all four wheels down, gone by the time it's a metre or so in the air.
    this.contact.add(model.root, b.length, b.width, car.spec.cg, () => car.wheels.reduce((n, w) => n + (w.contact ? 1 : 0), 0) / car.wheels.length);
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
      dmg: newDamage(),
      dents: new CarDents(model.body),
    };
  }

  private addRemote(r: Racer) {
    const owned = decodeCar(r.car) ?? newOwnedCar('pebble');
    const model = buildCar(owned, decodeRider(r.rider) ?? defaultRider());
    if (this.trial) ghostly(model);
    this.view.scene.add(model.root);
    this.headlights(model.root, owned);
    const spec = carSpec(owned);
    // A time trial's ghosts float through everything: no shadow under them.
    if (!this.trial) this.contact.add(model.root, CARS[owned.model].length, CARS[owned.model].width, spec.cg);
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
      dm: 0,
      dents: new CarDents(model.body),
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

  // --- boost pads and cones ----------------------------------------------------------------------

  /** Cones knocked flying, and the rainbow boost pads, for the cars we simulate. */
  private pickups() {
    for (const r of [this.me, ...this.rivals]) {
      for (const i of r.car.touched) if (this.track.props[i].kind === 'cone') this.propView.knockCone(i, r.car.v.x, r.car.v.z);
      if (padKick(r.car, this.track.boosts) && r === this.me) {
        this.audio.burst(0.35, 0.08, 2400, 'highpass');
        rumble(0.4, 0.7, 180);
      }
    }
  }

  /** One tick of your drift meter: combos bank (and online, the new total goes to the server) or are lost. */
  private scoreDrift() {
    const ev = stepDrift(this.driftMeter, this.me.car, TICK_DT);
    if (!ev) return;
    if (ev.kind === 'bank') {
      this.hud.driftBanked(ev.points, this.driftMeter.total);
      this.audio.tone(880, 0.1, 0.05, 'triangle');
      this.setup.online?.net.send({ t: 'drift', pts: this.driftMeter.total });
    } else if (ev.points > 0) this.hud.driftLost(ev.points);
  }

  // --- network ---------------------------------------------------------------------------------

  private onNet(m: RaceServerMsg) {
    const now = performance.now() / 1000;
    if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.7 + (now - m.n / 1000) * 0.3 : now - m.n / 1000;
    else if (m.t === 'go') this.go();
    else if (m.t === 'loading') this.waitingFor(m.ready, m.field);
    else if (m.t === 'countdown') {
      if (this.phase !== 'countdown') return;
      // Everyone's loaded (or the rest timed out): the same 3-2-1 on every screen, then the server's `go`.
      if (this.held) this.hud.banner('Get ready', '', 1000);
      this.held = false;
      this.countdown = m.ms / 1000;
    }
    else if (m.t === 'snap') {
      for (const c of m.cars) {
        const r = this.remotes.get(c.id);
        if (!r) continue;
        // Keep what's on screen where it is: the jump to the new prediction becomes an error that decays.
        r.last = { c, at: now };
        r.err.copy(r.shownP).sub(this.predict(r, now, new THREE.Vector3(), null));
        if (r.err.lengthSq() > 64) r.err.set(0, 0, 0); // a reset or a long gap: just jump
        r.s = c.s;
        if (this.physics && c.dm !== undefined && c.dm !== r.dm) this.remoteDamage(r, c.dm);
      }
    } else if (m.t === 'wreck') {
      const r = this.remotes.get(m.id);
      if (r && this.blasts) {
        this.blasts.boom(m.p[0], m.p[1], m.p[2], r.last?.c.v[0] ?? 0, r.last?.c.v[2] ?? 0, PAINTS[decodeCar(r.code)?.look.paint ?? 0]);
        this.boomSound(Math.hypot(m.p[0] - this.me.car.p.x, m.p[2] - this.me.car.p.z));
        r.dents.repair();
        r.dm = 0;
        r.err.set(0, 0, 0);
      }
    } else if (m.t === 'finished') {
      const r = this.remotes.get(m.id);
      if (r) {
        r.finished = m.time;
        if (this.phase !== 'done') this.hud.banner(`${r.name} finished`, fmtTime(m.time), 2000);
        if (this.watching === m.id) this.spectateNext();
      }
    } else if (m.t === 'retired') this.dropRemote(m.id);
    else if (m.t === 'out') {
      const net = this.setup.online!.net;
      const who = m.id === net.id ? this.me : (this.rivals.find((r) => r.netId === m.id) ?? this.remotes.get(m.id));
      if (who) this.knockOut(who, m.lap, m.place, m.left);
    } else if (m.t === 'load') {
      // The host raced again from the results, or restarted from the pause menu mid-race: straight to the next start.
      this.dispose();
      this.setup.onNext?.(roomRace(m));
    } else if (m.t === 'results') this.onlineResults(m.rows.map((r) => ({ id: r.id, place: r.place, name: r.name, car: r.car, time: r.time, best: r.best, prize: r.prize, drift: r.drift, bonus: r.bonus, me: r.id === this.setup.online!.net.id, cpu: r.cpu, xp: r.xp, out: r.out })), m.gp);
    else if (m.t === 'records') this.records(m.rows);
    else if (m.t === 'room') {
      // Someone left mid-race: drop their car.
      for (const id of [...this.remotes.keys()]) if (!m.racers.some((r) => r.id === id)) this.dropRemote(id);
      // Free roam: whoever drove in since is put on the road.
      if (this.roam) for (const r of m.racers) if (r.roaming && r.id !== this.setup.online!.net.id && !this.remotes.has(r.id)) this.addRemote(r);
      // The room is back in its lobby: the results timed out, or the host ended free roam or went back to the lobby
      // mid-race (which ends it for everyone). A solo time trial has no lobby to go back to: it ends on the Race page.
      if (m.phase === 'lobby') this.exit(this.setup.online!.solo ? 'garage' : 'lobby');
      else if (this.phase === 'done') this.resultActs(); // the host may have changed
        } else if (m.t === 'error') this.exit('garage', m.message);
  }

  /** A remote racer left the room or went back to the lobby: their car comes off the road. */
  private dropRemote(id: number) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.stowCar(r.model.root);
    this.contact.remove(r.model.root);
    this.cockpits.get(r.model.root)?.dispose();
    this.cockpits.delete(r.model.root);
    r.model.dispose();
    r.engine?.stop();
    this.remotes.delete(id);
    if (this.watching === id) this.spectateNext();
  }

  private send() {
    this.setup.online?.net.send({ t: 'state', ...this.pose(this.me) });
  }

  /** The host's CPU racers still out, all in one message. */
  private sendCpus() {
    const net = this.setup.online?.net;
    const cars = this.rivals.filter((r) => r.netId !== undefined && r.finished === null).map((r) => ({ id: r.netId!, ...this.pose(r) }));
    if (net && cars.length) net.send({ t: 'cpus', cars });
  }

  /** A car we drive, as the others see it. */
  private pose(x: Racing): Omit<NetCar, 'id'> {
    const c = x.car;
    const f =
      (x.input.brake > 0.1 ? CarFlag.Brake : 0) |
      (c.gear < 0 ? CarFlag.Reverse : 0) |
      (c.wheels.some((w) => w.slip > 1.1) ? CarFlag.Skid : 0) |
      (c.wheels.some((w) => w.surf === 'grass' || w.surf === 'gravel' || w.surf === 'dirt') ? CarFlag.Offroad : 0) |
      (c.drift ? CarFlag.Drift : 0) |
      (c.boost > 0 ? CarFlag.Boost : 0) |
      (c.driftLevel << CarFlag.LevelShift);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      p: [r(c.p.x), r(c.p.y), r(c.p.z)],
      q: [r(c.q.x), r(c.q.y), r(c.q.z), r(c.q.w)],
      v: [r(c.v.x), r(c.v.y), r(c.v.z)],
      w: r(yawRate(c)),
      s: r(c.s),
      st: r(c.steer),
      ws: r((c.wheels[2].w + c.wheels[3].w) / 2),
      rpm: Math.round(c.rpm),
      f,
      dm: this.physics ? packZones(x.dmg) : undefined,
    };
  }

  // --- the loop --------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.gate(now)) return; // Low: at most 60 frames a second (the skipped time is simulated next frame)
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
      this.blasts?.update(dt);
      this.propView.update(this.wallClock, dt);
    }
    this.render(dt, Math.min(1, this.acc / TICK_DT));
    this.adaptResolution(dt);
    // The first frames compile every shader (a hitch of a second or more on slow machines): ready after those.
    if (this.setup.online && ++this.frames === 3) this.setup.online.net.send({ t: 'ready' });
  };

  /**
   * Adaptive resolution: the post chain (multisampled HDR, bloom, grade) costs per pixel, so a laptop that can't
   * keep up renders fewer of them. After RES.slowFor seconds averaging slower than RES.slowMs a frame, drop the
   * render scale a step (never under RES.min); after RES.fastFor seconds faster than RES.fastMs, raise it back.
   * A machine that keeps up never leaves full resolution.
   */
  private adaptResolution(dt: number) {
    if (dt <= 0 || this.paused) return;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    const now = this.wallClock;
    // The first seconds compile shaders and stutter: that's no reason to drop the resolution.
    if (now < RES.settle) {
      this.slowSince = this.fastSince = now;
      return;
    }
    const slow = this.frameMs > RES.slowMs;
    const fast = this.frameMs < RES.fastMs;
    if (!slow) this.slowSince = now;
    if (!fast) this.fastSince = now;
    let next = this.resScale;
    if (now - this.slowSince > RES.slowFor && this.resScale > RES.min) next = Math.max(RES.min, this.resScale - RES.step);
    else if (now - this.fastSince > RES.fastFor && this.resScale < 1) next = Math.min(1, this.resScale + RES.step / 2);
    next = Math.round(next * 100) / 100; // steps of 0.15 / 0.075 must land back on exactly 1
    if (next === this.resScale) return;
    this.resScale = next;
    this.slowSince = this.fastSince = now;
    this.renderer.setPixelRatio(this.basePixelRatio * next);
    this.resize();
  }

  /** Online, before the countdown: who we're still waiting on. */
  private waitingFor(ready: number[], field: number[]) {
    if (this.phase !== 'countdown' || !this.held) return;
    const names = new Map(this.setup.online!.racers.map((r) => [r.id, r.name]));
    const late = field.filter((id) => !ready.includes(id) && id !== this.setup.online!.net.id).map((id) => names.get(id) ?? 'a racer');
    const shown = late.length > 3 ? `${late.slice(0, 3).join(', ')} +${late.length - 3}` : late.join(', ');
    this.hud.banner('Waiting for racers', `${ready.length} / ${field.length} loaded${shown ? ` · waiting on ${shown}` : ''}`, 0);
  }
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
      this.respawn(this.me.car);
      this.resetAt = this.wallClock + 2;
      this.hud.banner('Back on the road', '', 1200);
    } else if (a === 'spectate') {
      // (Solo too once you're out of a battle royale: watch the rivals still in.)
      if (this.phase === 'finished' && (this.setup.online || this.me.out)) this.spectateNext();
    } else if (a === 'shiftUp' || a === 'shiftDown') {
      if (!this.assists.auto && this.phase !== 'countdown') this.me.input[a] = true;
    }
  }

  /**
   * Slipstreaming (draft.ts): every car we drive (you and the AI) feels the wake of every other car on the
   * road, including online racers' poses. Not in a time trial, where the others are ghosts.
   */
  private slipstream(live: boolean) {
    const drivers = [this.me, ...this.rivals];
    const bodies: Body[] = drivers.filter((r) => !r.out).map((r) => r.car);
    for (const r of this.remotes.values()) if (r.last && r.finished === null && !r.out) bodies.push(r.ghost);
    for (const r of drivers) {
      const wake = live && !this.trial && r.finished === null ? strongestWake(r.car, bodies) : 0;
      const slung = stepDraft(r.car, wake, r.input.throttle, TICK_DT);
      if (r !== this.me) continue;
      if (slung) {
        this.slingUntil = this.wallClock + DRAFT.slingSeconds + 0.3;
        this.audio.burst(0.5, 0.1, 1400, 'highpass');
      }
      const ready = r.car.draftArmed > 0;
      if (ready && !this.draftReady) {
        this.audio.tone(1180, 0.14, 0.05, 'triangle');
        rumble(0.1, 0.3, 80);
      }
      this.draftReady = ready;
    }
  }

  private tick() {
    const me = this.me;
    const t = this.track;
    // Inputs
    if (this.phase === 'countdown' && !this.held) {
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
    if (live && me.finished === null) this.topSpeed = Math.max(this.topSpeed, speedOf(me.car));
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
    // Traffic runs on the race clock, the same for everyone online (free roam's on the wall clock: there's no GO).
    if (this.roam) this.trafficTime = roamClock();
    else this.trafficTime = this.phase === 'countdown' ? -Math.max(0, this.countdown) : this.trafficTime + TICK_DT;
    const traffic = this.traffic;
    for (const r of this.rivals) {
      if (this.phase === 'countdown') Object.assign(r.input, { steer: 0, throttle: Math.random() < 0.02 ? 1 : r.input.throttle * 0.95, brake: 1, handbrake: 1 });
      else aiDrive(r.car, t, r.ai!, TICK_DT, r.input, traffic ? trafficBetween(traffic, this.trafficTime, r.car.s - 10, r.car.s + 300, this.obstacles) : undefined);
    }
    this.slipstream(live);
    // Step
    for (const r of [me, ...this.rivals]) {
      r.prevP.set(r.car.p.x, r.car.p.y, r.car.p.z);
      r.prevQ.set(r.car.q.x, r.car.q.y, r.car.q.z, r.car.q.w);
      const assists = r === me ? this.assists : DEFAULT_ASSISTS;
      stepCar(r.car, this.physics ? damagedInput(r.dmg, r.input, this.driven) : r.input, t, assists);
      r.input.shiftUp = r.input.shiftDown = false;
    }
    this.pickups();
    if (t.abyss !== undefined) this.falls();
    // Bumps
    const all = [me, ...this.rivals];
    // In a time trial the others are ghosts: you (and the host's CPU racers) drive straight through them. In a Team
    // Grand Prix only teammates are: rivals bump.
    if (!this.trial) {
      const team = (x: Racing) => this.teams.get(x === me ? this.setup.online?.net.id ?? 0 : (x.netId ?? 0));
      // (A car knocked out of a battle royale is gone: nothing touches it.)
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (!all[i].out && !all[j].out && !teammates(team(all[i]), team(all[j]))) collideCars(all[i].car, all[j].car, true);
      for (const r of this.remotes.values()) for (const x of all) if (!r.out && !x.out && (x === me || x.finished === null) && !teammates(team(x), this.teams.get(r.id))) collideCars(x.car, r.ghost, false);
    }
    if (traffic) for (const r of all) collideTraffic(t, traffic, r.car, this.trafficTime);
    if (t.world) {
      for (const r of all) collideWorldTraffic(t.world.world, r.car, this.trafficTime);
      if (live) this.roamTick(t.world.world);
    }
    if (live && me.finished === null) this.scoreDrift();
    if (live && this.physics) this.crashes();
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
    if (this.phase !== 'countdown') this.ghostT += TICK_DT;
    if (live && me.finished === null && me.car.s >= t.finishS) this.finish();
    if (live && me.finished === null && t.lap && lapOf(t, me.car.s) > this.lap) {
      this.lap = lapOf(t, me.car.s);
      const lapTime = this.time - this.lapStart;
      const best = lapTime < this.bestLap;
      this.bestLap = Math.min(this.bestLap, lapTime);
      if (this.royaleOn) this.hud.banner(`Lap ${this.lap}`, `${this.alive()} left · last place is out`, 2200);
      else this.hud.banner(this.lap === t.def.laps ? 'Final lap' : `Lap ${this.lap}/${t.def.laps}`, `${best && this.lap > 2 ? 'Best lap' : 'Last lap'} ${fmtTime(lapTime)}`, 2200);
      this.lapStart = this.time;
    }
    if (live || this.phase === 'finished') this.clock += TICK_DT;
    if (this.royale && (live || this.phase === 'finished')) this.judgeRoyale(this.royale);
    for (const r of this.rivals) {
      if (r.finished !== null || r.car.s < t.finishS) continue;
      // Solo the race ends when you cross the line; online the host's CPU racers race on after you.
      if (this.phase === 'racing' && r.netId === undefined) r.finished = this.time;
      else if (r.netId !== undefined && (live || this.phase === 'finished')) {
        r.finished = this.clock;
        this.setup.online?.net.send({ t: 'cpufinish', id: r.netId, time: this.clock });
      }
    }
    if (!this.roam && (live || this.phase === 'finished')) this.recordMoments();
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
        this.sendCpus();
      }
    }
  }

  /**
   * Samples every car on the race clock for the Best Moment: ours from the physics, online racers from the pose on
   * screen. A car's tape ends where it crossed the line.
   */
  private recordMoments() {
    const t = this.ghostT;
    const tape = (r: Racing | Remote) => {
      let k = this.tapes.get(r);
      if (!k) this.tapes.set(r, (k = new MomentTape()));
      if (r.finished !== null && k.end === null) k.end = t;
      return k;
    };
    for (const r of [this.me, ...this.rivals]) {
      const c = r.car;
      const flags =
        (r.input.brake > 0.1 ? MomentFlag.Brake : 0) |
        (c.drift !== 0 ? MomentFlag.Drift : 0) |
        (c.boost > 0 ? MomentFlag.Boost : 0) |
        (c.wheels.every((w) => !w.contact) ? MomentFlag.Air : 0) |
        (c.driftLevel << MomentFlag.LevelShift);
      tape(r).add(t, { p: c.p, q: c.q, v: c.v, steer: c.steer, flags });
    }
    for (const r of this.remotes.values()) {
      if (!r.last || r.out) continue;
      const f = r.last.c.f;
      const flags = (f & CarFlag.Brake ? MomentFlag.Brake : 0) | (f & CarFlag.Drift ? MomentFlag.Drift : 0) | (f & CarFlag.Boost ? MomentFlag.Boost : 0) | (((f >> CarFlag.LevelShift) & 3) << MomentFlag.LevelShift);
      const v = r.last.c.v;
      tape(r).add(t, { p: r.shownP, q: r.shownQ, v: { x: v[0], y: v[1], z: v[2] }, steer: r.last.c.st, flags });
    }
  }

  /**
   * A sky road: every car we drive that's going over the edge is put back on the middle of the road where it went
   * off, stopped (skyfall.ts `skyFall`). Online, the others just see it jump back (racenet snaps a big gap).
   */
  private falls() {
    for (const r of [this.me, ...this.rivals]) {
      if (!skyFall(r.car, this.track)) continue;
      if (r.ai) r.ai = newAi(r.ai.skill, r.ai.lane);
      r.prevP.set(r.car.p.x, r.car.p.y, r.car.p.z);
      r.prevQ.set(r.car.q.x, r.car.q.y, r.car.q.z, r.car.q.w);
      if (r !== this.me) continue;
      const lost = dropCombo(this.driftMeter);
      if (lost > 0) this.hud.driftLost(lost);
      if (this.phase === 'racing' && r.finished === null) this.hud.banner('Fell off!', 'Back on the road', 1400);
      rumble(0.8, 0.4, 300);
      if (this.watching === null) this.snapCamera();
    }
  }

  // --- Physics mode: crash damage ------------------------------------------------------------------

  /**
   * Every car we drive (you and the AI) takes its knocks for this tick: dents where it was hit, and a wreck when
   * it's had too much. Finished cars are left alone.
   */
  private crashes() {
    for (const r of [this.me, ...this.rivals]) {
      if (r.finished !== null) continue;
      const c = r.car;
      const hit = takeHit(r.dmg, c.crash, c.crashP, c.land, c.spec.body.hl, c.spec.body.hw, TICK_DT);
      if (!hit) continue;
      // The harder the hit, the deeper and wider the dent.
      r.dents.dent(c.crashP, c.crashN, Math.min(0.32, 0.04 + hit.amount * 0.9), Math.min(1.5, 0.55 + hit.amount * 3));
      if (r === this.me && hit.amount > 0.02) {
        this.audio.burst(0.35, Math.min(0.35, 0.1 + hit.amount), 260, 'lowpass');
        rumble(1, 0.6, 220 + hit.amount * 600);
      }
      if (hit.wrecked) this.wreck(r);
    }
  }

  /** A car's had too much: it blows up, and comes back repaired a few metres back down the road. */
  private wreck(r: Racing) {
    const c = r.car;
    const t = this.track;
    this.blasts?.boom(c.p.x, c.p.y, c.p.z, c.v.x, c.v.z, PAINTS[decodeCar(r.code)?.look.paint ?? 0]);
    const mine = r === this.me;
    this.boomSound(mine ? 0 : Math.hypot(c.p.x - this.me.car.p.x, c.p.z - this.me.car.p.z));
    const at = [c.p.x, c.p.y, c.p.z].map((x) => Math.round(x * 100) / 100) as [number, number, number];
    if (r.netId !== undefined) this.setup.online?.net.send({ t: 'cpuwreck', id: r.netId, p: at });
    if (mine) {
      this.setup.online?.net.send({ t: 'wreck', p: at });
      rumble(1, 1, 900);
      this.hud.banner('Wrecked!', 'Back on the road', 1600);
    }
    if (this.roam) this.respawn(c);
    else {
      const back = Math.max(4, c.s - DAMAGE.respawnBack);
      const d = Math.max(-t.half + 1.5, Math.min(t.half - 1.5, c.d));
      resetOnRoad(c, t, back, d, onFork(t, c.hint));
    }
    if (r.ai) r.ai = newAi(r.ai.skill, r.ai.lane, r.ai.alt);
    r.prevP.set(c.p.x, c.p.y, c.p.z);
    r.prevQ.set(c.q.x, c.q.y, c.q.z, c.q.w);
    repair(r.dmg);
    r.dents.repair();
    if (mine && this.watching === null) this.snapCamera();
  }

  /** An explosion's bang: a deep thump and a crackle, quieter with distance. */
  private boomSound(dist: number) {
    const near = Math.max(0, 1 - dist / 250);
    if (near <= 0) return;
    this.audio.burst(1.6, 0.5 * near, 140, 'lowpass');
    this.audio.burst(0.6, 0.25 * near, 1800, 'bandpass');
    this.audio.impact(30 * near);
  }

  /** A remote racer's damage changed: dent the sides that got worse; all zero means they respawned. */
  private remoteDamage(r: Remote, dm: number) {
    const was = unpackZones(r.dm);
    const now = unpackZones(dm);
    r.dm = dm;
    if (dm === 0) return r.dents.repair();
    const b = CARS[r.spec.id];
    const hl = b.length / 2;
    const hw = b.width / 2;
    const at = { front: { x: 0, z: -hl }, rear: { x: 0, z: hl }, left: { x: -hw, z: 0 }, right: { x: hw, z: 0 } };
    for (const z of ZONES) {
      const more = now[z] - was[z];
      if (more <= 0.03) continue;
      const p = at[z];
      // Somewhere along that side, not always the middle.
      const jitter = (Math.random() - 0.5) * (z === 'left' || z === 'right' ? hl : hw);
      const pt = { x: p.x + (z === 'front' || z === 'rear' ? jitter : 0), y: 0, z: p.z + (z === 'left' || z === 'right' ? jitter : 0) };
      const len = Math.hypot(p.x, p.z) || 1;
      r.dents.dent(pt, { x: -p.x / len, y: 0, z: -p.z / len }, Math.min(0.32, 0.04 + (more / 1.4) * 0.9), Math.min(1.5, 0.55 + (more / 1.4) * 3));
    }
  }

  /** Back on the road: on a race track where the car is along it, in free roam on the nearest road, facing the way it was. */
  private respawn(c: Car) {
    const w = this.track.world?.world;
    // (At a fork, on whichever of the two roads it was on.)
    if (!w) return resetOnRoad(c, this.track, c.s, 0, onFork(this.track, c.hint));
    const at = respawnAt(w, c.p.x, c.p.z, yawOf(c));
    placeCar(c, at.x, at.y, at.z, at.yaw, at.i);
  }

  /** Free roam: the places the pause menu can take you (the first of each named spawn). */
  private spots() {
    const w = this.track.world?.world;
    if (!w) return [];
    return w.spawns.filter((sp, k) => w.spawns.findIndex((o) => o.name === sp.name) === k);
  }

  /** Free roam: straight to a spot from the pause menu, a little to one side so friends going there don't stack. */
  private teleport(sp: { x: number; z: number; yaw: number }) {
    const c = this.me.car;
    const side = (Math.random() - 0.5) * 8;
    const x = sp.x + Math.cos(sp.yaw) * side;
    const z = sp.z - Math.sin(sp.yaw) * side;
    const loc = newLoc();
    locate(this.track, x, z, -1, loc);
    placeCar(c, x, heightAt(this.track, x, z, undefined, loc.i), z, sp.yaw, loc.i);
    this.me.prevP.set(c.p.x, c.p.y, c.p.z);
    this.me.prevQ.set(c.q.x, c.q.y, c.q.z, c.q.w);
    this.nearMisses = newNearMisses();
    this.snapCamera();
  }

  /** Free roam, each tick: near misses through traffic, the speed traps, and fishing you out of the sea. */
  private roamTick(w: NonNullable<Track['world']>['world']) {
    const me = this.me;
    const c = me.car;
    const chain = stepNearMisses(this.nearMisses, w, c, this.trafficTime, this.wallClock);
    if (chain) {
      this.hud.nearMiss(chain);
      this.audio.tone(880 + Math.min(chain, 8) * 90, 0.09, 0.05, 'triangle');
      rumble(0.2, 0.3, 70);
    }
    const trap = trapCrossed(w, me.prevP.x, me.prevP.z, c.p.x, c.p.z);
    if (trap) {
      const kmh = Math.round(speedOf(c) * 3.6);
      const best = this.trapBest.get(trap.name) ?? 0;
      if (kmh > best) this.trapBest.set(trap.name, kmh);
      this.hud.banner(`${kmh} km/h`, `${trap.name} speed trap${kmh > best && best ? ' · new best' : best ? ` · best ${best}` : ''}`, 2200);
      this.audio.tone(1320, 0.12, 0.05, 'square');
    }
    // In the sea: back to the nearest road (the car's no boat).
    if (c.p.y - c.spec.cg < w.water - WORLD.drown && this.wallClock > this.resetAt) {
      this.respawn(c);
      this.resetAt = this.wallClock + 1;
      this.hud.banner('Splash!', 'Back on the road', 1400);
      if (this.watching === null) this.snapCamera();
    }
  }

  private go() {
    if (this.phase !== 'countdown') return;
    this.phase = 'racing';
    if (this.roam) {
      this.held = false;
      this.hud.banner(this.track.def.name, 'Free roam · drive anywhere · R: back on the road', 3200);
      for (const r of [this.me, ...this.rivals]) r.car.gear = 1;
      return;
    }
    // Loaded after the room gave up waiting: the others are already away.
    if (this.held && !this.trial) this.hud.banner('Late start', 'The race began while you were loading', 2600);
    this.held = false;
    this.trafficTime = 0;
    this.audio.beep(true);
    this.hud.countdown('GO!');
    setTimeout(() => this.hud.countdown(null), 900);
    if (this.royaleOn) {
      this.hud.banner('Battle royale', 'Last car over the line each lap is destroyed', 3000);
      if (!this.setup.online) this.royale = new Royale(this.track.startS, this.track.lap * SAMPLE);
    } else if (this.climb) this.hud.banner('Hill climb', this.carNote ? `${this.carNote} · first to the summit` : 'Watch for rockfall · first to the summit', 2600);
    else if (this.trial) this.hud.banner('Time trial', this.carNote ? `${this.carNote} · ghosts: drive straight through` : 'Ghost cars: drive straight through them', 2600);
    else if (this.recordGhost) this.hud.banner('Record ghost', `${this.recordGhost.run.name} · ${fmtTime(this.recordGhost.run.time)}`, 2600);
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
    // The combo you cross the line in still counts.
    if (comboPoints(this.driftMeter) > 0) this.hud.driftBanked(bankCombo(this.driftMeter), this.driftMeter.total);
    saveHighs({ drift: this.driftMeter.total, topKmh: this.topSpeed * 3.6 });
    if (!this.setup.online) return void this.soloResults();
    this.setup.online.net.send({ t: 'drift', pts: this.driftMeter.total });
    this.setup.online.net.send({ t: 'finish', time: this.time, best: Number.isFinite(this.bestLap) ? this.bestLap : undefined });
    if (this.stillRacing().length) this.hud.watching('', `${this.spectateKey()}: spectate`);
  }

  private spectateKey() {
    return this.controls.padSeen ? 'Ⓧ' : 'E';
  }

  /** Remote racers still on the road. */
  private stillRacing() {
    return [...this.remotes.values()].filter((r) => r.finished === null && r.last);
  }

  /**
   * Follow the next racer still out (after the last, back to your own car). In a battle royale that includes the cars
   * this client drives (solo rivals, the host's CPU racers), and once you're knocked out there's no car to come back to.
   */
  private spectateNext() {
    const list: { id: number | null; car: Racing | null; name: string }[] = [
      ...this.stillRacing().map((r) => ({ id: r.id, car: null, name: r.name })),
      ...(this.royaleOn ? this.rivals.filter((r) => !r.out && r.finished === null).map((r) => ({ id: null, car: r, name: r.name })) : []),
    ];
    const at = list.findIndex((w) => (w.id !== null && w.id === this.watching) || (w.car !== null && w.car === this.watchCar));
    const next = list[at + 1] ?? (this.me.out ? list[0] : null) ?? null;
    this.watching = next?.id ?? null;
    this.watchCar = next?.car ?? null;
    if (next) this.hud.watching(`Spectating ${next.name}`, list.length > 1 ? `${this.spectateKey()}: next` : '');
    else this.hud.watching('', list.length ? `${this.spectateKey()}: spectate` : '');
    this.snapCamera();
  }

  // --- battle royale -----------------------------------------------------------------------------

  /** Cars still in the race (a battle royale's knocked-out ones aren't). */
  private alive() {
    return [this.me, ...this.rivals].filter((r) => !r.out).length + [...this.remotes.values()].filter((r) => !r.out).length;
  }

  /**
   * Solo battle royale: you (key 0) and the rivals (1..., their places in the field at GO: knocked-out rivals leave
   * `rivals`, so keys can't be array indexes) through the elimination rules each tick.
   */
  private judgeRoyale(r: Royale) {
    if (!this.royaleKeys.size) [this.me, ...this.rivals].forEach((x, k) => this.royaleKeys.set(k, x));
    const progress = new Map<number, number>();
    for (const [k, x] of this.royaleKeys) if (!x.out && (x !== this.me || x.finished === null)) progress.set(k, x.car.s);
    for (const k of r.step(progress, this.clock)) this.knockOut(this.royaleKeys.get(k.id)!, k.lap, k.place, k.place - 1);
    if (r.winner === 0 && this.me.finished === null) {
      this.finish();
      this.hud.banner('Last one standing', 'You win the battle royale', 0);
    }
  }

  /**
   * A car is knocked out of the battle royale: it blows up and is taken off the road. Yours: you watch the rest (solo,
   * the results come a few seconds later, with the rivals still in placed by how far they've got).
   */
  private knockOut(r: Racing | Remote, lap: number, place: number, left: number) {
    if (r.out) return;
    r.out = { place, lap };
    const root = r.model.root;
    const p = 'car' in r ? r.car.p : root.position;
    const v = 'car' in r ? r.car.v : r.last ? { x: r.last.c.v[0], z: r.last.c.v[2] } : { x: 0, z: 0 };
    this.blasts?.boom(p.x, p.y, p.z, v.x, v.z, PAINTS[decodeCar(r.code)?.look.paint ?? 0]);
    const mine = r === this.me;
    this.boomSound(mine ? 0 : Math.hypot(p.x - this.me.car.p.x, p.z - this.me.car.p.z));
    this.stowCar(root);
    this.contact.remove(root);
    r.engine?.stop();
    r.engine = null;
    if (mine) {
      const me = this.me;
      rumble(1, 1, 900);
      this.hud.banner('Eliminated', `${ordinal(place)} · last over the line on lap ${lap}`, 0);
      if (me.finished === null) me.finished = this.time;
      if (comboPoints(this.driftMeter) > 0) this.hud.driftBanked(bankCombo(this.driftMeter), this.driftMeter.total);
      saveHighs({ drift: this.driftMeter.total, topKmh: this.topSpeed * 3.6 });
      this.phase = 'finished';
      this.setup.online?.net.send({ t: 'drift', pts: this.driftMeter.total });
      this.spectateNext();
      // Solo: a few seconds of the carnage you left behind, then the results.
      if (!this.setup.online) setTimeout(() => void this.soloResults(), 4000);
      return;
    }
    this.hud.banner(`${r.name} eliminated`, left > 1 ? `${left} left` : 'One left standing', 2200);
    if ('car' in r) {
      // A car this client drove (a solo rival, the host's CPU racer): off the road for good.
      this.rivals = this.rivals.filter((x) => x !== r);
      this.fallen.push(r);
      if (this.watchCar === r) this.spectateNext();
    } else {
      r.finished = this.clock;
      if (this.watching === r.id) this.spectateNext();
    }
  }

  /**
   * Takes a car off the road mid-race without a freeze: at night its headlight and tail glow are lights, and a light
   * leaving the scene (hiding or removing the whole car) recompiles every lit shader, a stall of seconds (2026-11-12,
   * Michael: "When player elims It freezes the match"). So the car's meshes go and its lights stay, turned off. (Each
   * mesh is hidden, not its groups: the driver and rider groups are shown and hidden every frame.)
   */
  private stowCar(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o instanceof THREE.Light) o.intensity = 0;
      else if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) o.visible = false;
    });
  }

  private async soloResults() {
    if (this.phase === 'done' || this.exited) return;
    this.phase = 'done';
    const field = [this.me, ...this.rivals, ...this.fallen];
    const done = field.filter((r) => r.finished !== null && !r.out).sort((a, b) => a.finished! - b.finished!);
    const behind = field.filter((r) => r.finished === null && !r.out).sort((a, b) => b.car.s - a.car.s);
    // A battle royale: the cars still in (by how far they've got), then the knocked out, last out first.
    const gone = field.filter((r) => r.out).sort((a, b) => a.out!.place - b.out!.place);
    const order = [...done, ...behind, ...gone];
    const myPlace = order.indexOf(this.me) + 1;
    const drift = this.driftMeter.total;
    const xpBefore = garage.g.xp;
    const paid = garage.act({ a: 'solo', track: this.setup.track, place: myPlace, field: field.length, drift });
    // The winner's Best Moment first, then the results (the prize is settled meanwhile).
    await this.bestMoment(order[0], order[0]?.name ?? '');
    const res = await paid;
    if (this.exited) return;
    this.myPrize = res.ok ? (res.paid ?? 0) : 0;
    const bonus = res.ok ? res.bonus : undefined;
    const lines: ResultLine[] = order.map((r, i) => ({ place: i + 1, name: r.name, car: r.code, time: r.out ? null : r.finished, out: r.out?.lap, prize: r === this.me ? this.myPrize! : 0, me: r === this.me, drift: r === this.me ? drift : undefined, bonus: r === this.me ? bonus : undefined }));
    const note = (res.ok ? `You won ${money(this.myPrize)}${bonusNote(bonus)}${xpNote(res.xp ?? 0, xpBefore)}` : `No prize: ${res.error === 'Too soon.' ? 'solo races pay at most once every 45 s' : res.error}`);
    const gp = this.setup.gp;
    if (gp) return this.soloCup(gp, lines, note);
    const p = this.hud.panel(`${this.hud.resultsHtml(this.royaleOn ? `Battle royale · ${this.track.def.name}` : this.track.def.name, lines)}
      <p class="rh-note">${esc(note)}</p>
      <div class="rh-buttons"><button data-act="again" data-autofocus>Rerace</button><button data-act="garage">Garage</button></div>`);
    setMenuNav(true);
    p.querySelector('[data-act="again"]')!.addEventListener('click', () => this.restart());
    p.querySelector('[data-act="garage"]')!.addEventListener('click', () => this.exit('garage'));
  }

  /**
   * A solo Grand Prix round is over: this race's places go on the cup table (you are `me`, rivals by name, the same
   * every round), then Next race, or after the last round the final standings and Race the cup again.
   */
  private soloCup(gp: GpState, lines: ResultLine[], note: string) {
    const table = addRound(gp.table, gp.round, lines.map((l) => ({ key: l.me ? 'me' : l.name, name: l.name, place: l.place, me: l.me })));
    const final = gp.round >= roundsOf(gp.cup) - 1;
    const cup = CUPS[gp.cup];
    const title = `${cup.name} · ${this.track.def.name}`;
    const p = this.hud.panel(`${this.hud.resultsHtml(title, lines)}
      <p class="rh-note">${esc(note)}</p>
      ${cupHtml(gp.cup, gp.round, table, final, 'me')}
      <div class="rh-buttons">${
        final
          ? '<button data-act="cup" data-autofocus>Race the cup again</button><button data-act="garage">Garage</button>'
          : `<button data-act="next" data-autofocus>Next race: ${esc(this.nextTrackName(gp))}</button><button data-act="garage">Quit cup</button>`
      }</div>`);
    setMenuNav(true);
    const go = (next: GpState) => {
      this.dispose();
      this.setup.onNext?.({ track: cup.tracks[next.round], rivals: this.setup.rivals, physics: this.setup.physics, gp: next });
    };
    p.querySelector('[data-act="next"]')?.addEventListener('click', () => go({ cup: gp.cup, round: gp.round + 1, table }));
    p.querySelector('[data-act="cup"]')?.addEventListener('click', () => go({ cup: gp.cup, round: 0, table: [] }));
    p.querySelector('[data-act="garage"]')!.addEventListener('click', () => this.exit('garage'));
  }

  private nextTrackName(gp: GpState) {
    const next = CUPS[gp.cup].tracks[gp.round + 1];
    return next ? getTrack(next).def.name : '';
  }

  private async onlineResults(lines: (ResultLine & { id: number; xp?: number })[], gp?: Extract<RaceServerMsg, { t: 'results' }>['gp']) {
    this.phase = 'done';
    this.watching = null;
    this.hud.watching('', '');
    const arrived = performance.now();
    const title = gp ? `${CUPS[gp.cup].name} · ${this.track.def.name}` : this.clean || this.royaleOn ? `${RACE_MODES[this.setup.online!.mode].name} · ${this.track.def.name}` : this.setup.online?.mode === 'endurance' ? `Endurance · ${this.track.def.name} · ${this.track.def.laps} ${this.track.def.laps === 1 ? 'lap' : 'laps'}` : 'Results';
    const mine = lines.find((l) => l.me);
    const xpBefore = garage.g.xp;
    if (mine) garage.credit(mine.prize, mine.place === 1 && lines.filter((l) => !l.cpu).length > 1, mine.xp ?? 0);
    // A guest's best is kept here; an account's comes from the server a moment later (`records`). Only record modes
    // keep best times (recordMode): a race's drafting and bumping would make them unfair in a time trial.
    if (mine && mine.time !== null && !garage.onServer && recordMode(this.setup.online!.mode)) mine.newBest = garage.noteTime(this.setup.track, mine.time, mine.car);
    // Kept now, so new best times (`records`) that land during the replay still mark them.
    this.shownResults = { lines, title };
    this.gpShown = gp ?? null;
    // The winner's Best Moment first (the room holds the results HIGHLIGHT.seconds longer for it).
    const win = lines.find((l) => l.place === 1);
    if (win && !this.replay) {
      const id = win.id;
      const star = id === this.setup.online!.net.id ? this.me : (this.rivals.find((r) => r.netId === id) ?? this.remotes.get(id));
      await this.bestMoment(star, win.name);
      if (this.exited) return;
    }
    this.hud.panel(`${this.hud.resultsHtml(title, lines, this.clean)}
      <p class="rh-note">${mine ? `You earned ${money(mine.prize)}${bonusNote(mine.bonus)}${esc(xpNote(mine.xp ?? 0, xpBefore))}` : ''}${garage.onServer ? '' : ' · Sign in to keep your winnings'}<span data-best-note>${esc(bestNote(mine?.newBest, this.track.def.name))}</span></p>
      ${gp ? cupHtml(gp.cup, gp.round, gp.table, gp.final, String(this.setup.online!.net.id)) : ''}
      ${gp && !gp.final ? `<p class="rh-cup-next" data-cup-next></p>` : ''}
      <div class="rh-buttons" data-result-acts></div>`);
    setMenuNav(true);
    if (gp && !gp.final) this.cupClock(gp, arrived + gp.next);
    this.resultActs();
  }

  /** Online Grand Prix: "Round 3 of 4 · Neon Bay starts in 12 s" under the cup table, counting down. */
  private cupClock(gp: GpState, at: number) {
    const el = this.hud.root.querySelector<HTMLElement>('[data-cup-next]');
    const next = CUPS[gp.cup].tracks[gp.round + 1];
    if (!el || !next || this.exited) return;
    const s = Math.max(0, Math.ceil((at - performance.now()) / 1000));
    el.textContent = `Round ${gp.round + 2} of ${roundsOf(gp.cup)} · ${getTrack(next).def.name} starts in ${s} s`;
    if (s > 0) setTimeout(() => this.cupClock(gp, at), 250);
  }

  /**
   * The results' buttons. The host can race again (same track and settings, everyone straight to the start);
   * everyone else is told they'll be pulled in if that happens. Redrawn when the host changes.
   */
  private resultActs() {
    const box = this.hud.root.querySelector<HTMLElement>('[data-result-acts]');
    const net = this.setup.online?.net;
    if (!box || !net) return;
    const host = net.room?.hostId === net.id;
    if (box.dataset.host === String(host)) return;
    box.dataset.host = String(host);
    // A Grand Prix: the host's Rerace is Next race (or the cup again after the last round); the next round also
    // starts on its own, and everyone still here goes straight to it.
    const gp = this.gpShown;
    const again = !gp ? 'Rerace' : gp.final ? 'Race the cup again' : 'Next race';
    const wait = !gp ? 'If the host races again, you go straight to the start.' : gp.final ? 'If the host races the cup again, you go straight to the start.' : 'You go straight on to the next round.';
    // A solo time trial: run it again, or done (back to the Race page; there's no lobby).
    const solo = !!this.setup.online?.solo;
    box.innerHTML = solo
      ? `<button data-act="again" data-autofocus>Run again</button><button data-act="leave">Done</button>`
      : host
        ? `<button data-act="again" data-autofocus>${again}</button><button data-act="lobby">Back to lobby</button><button data-act="leave">Leave race</button>`
        : `<button data-act="lobby" data-autofocus>Back to lobby</button><button data-act="leave">Leave race</button><p class="rh-note">${wait}</p>`;
    const againBtn = box.querySelector<HTMLButtonElement>('[data-act="again"]');
    againBtn?.addEventListener('click', () => {
      againBtn.disabled = true;
      againBtn.textContent = 'Starting…';
      net.send({ t: 'start' });
    });
    box.querySelector('[data-act="lobby"]')?.addEventListener('click', () => this.exit('lobby'));
    box.querySelector('[data-act="leave"]')!.addEventListener('click', () => {
      net.leave();
      this.exit('garage');
    });
    box.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }

  /** The server kept new best times for some of the field: mark them on the results. */
  private records(rows: RecordRow[]) {
    const shown = this.shownResults;
    if (!shown || !Array.isArray(rows)) return;
    for (const r of rows) {
      const line = shown.lines.find((l) => l.id === r.id);
      if (!line) continue;
      line.newBest = { track: this.setup.track, time: r.time, prev: r.prev, rank: r.rank ?? null, beat: r.beat ?? null };
      if (line.me) garage.noteBest(line.newBest, line.car);
    }
    const el = this.hud.root.querySelector('[data-results]');
    if (el) el.outerHTML = this.hud.resultsHtml(shown.title, shown.lines, this.clean);
    const mine = shown.lines.find((l) => l.me);
    const note = this.hud.root.querySelector('[data-best-note]');
    if (note) note.textContent = bestNote(mine?.newBest, this.track.def.name);
  }

  private restart() {
    const s = this.setup;
    this.dispose();
    const next = new RaceGame(s);
    (window as unknown as { __race: RaceGame }).__race = next;
  }

  /**
   * Restart from the pause menu. Solo: a fresh race with the same setup. Online only the host can, and it restarts
   * everyone: the server sends the whole room back to the start with the same track and settings (no prizes paid).
   */
  private get canRestart() {
    const net = this.setup.online?.net;
    return !net || net.room?.hostId === net.id;
  }

  private restartFromPause(b: HTMLButtonElement) {
    const net = this.setup.online?.net;
    if (!net) return this.restart();
    b.disabled = true;
    b.textContent = 'Restarting…';
    net.send({ t: 'start' });
  }

  /**
   * Back to lobby (online races, not a solo time trial or free roam, which has End and drive-in): you leave this race
   * but stay in the room, and line up for the next one. The host going back ends the race for everyone (the room waits
   * on its host), so with other people still out it asks first.
   */
  private get canLobby() {
    const o = this.setup.online;
    return !!o && !o.solo && !this.roam;
  }

  /** Other people still racing (the host's CPU racers are its rivals, not remotes): its Back to lobby would cut their race short. */
  private get othersOut() {
    return [...this.remotes.values()].some((r) => r.finished === null && !r.out);
  }

  private toLobby() {
    this.setup.online?.net.send({ t: 'retire' });
    this.exit('lobby');
  }

  /** The pause menu: Restart first, then Resume, Settings (camera, volume, assists), Back to lobby and Quit. */
  private pause(view: 'main' | 'settings' | 'lobby' = 'main', focus = '') {
    this.paused = true;
    const a = this.assists;
    const onOff = (b: boolean) => (b ? 'On' : 'Off');
    const p =
      view === 'lobby'
        ? this.hud.panel(`
      <h2>End the race?</h2>
      <p class="rh-note">You're the host: going back to the lobby ends this race for everyone, with no prizes.</p>
      <div class="rh-buttons col">
        <button data-act="lobbyyes">End race, back to lobby</button>
        <button data-act="lobbyno" data-autofocus>Keep racing</button>
      </div>`)
        : view === 'main'
        ? this.hud.panel(`
      <h2>Paused</h2>
      <div class="rh-buttons col">
        ${this.roam ? '' : this.canRestart ? '<button data-act="restart">Restart</button>' : ''}
        <button data-act="resume" data-autofocus>Resume</button>
        ${this.roam ? this.spots().map((sp, k) => `<button data-act="spot" data-spot="${k}">Go to ${esc(sp.name)}</button>`).join('') : ''}
        ${this.roam && this.setup.online && this.canRestart ? '<button data-act="end">End free roam</button>' : ''}
        <button data-act="settings">Settings</button>
        ${this.canLobby ? '<button data-act="lobby">Back to lobby</button>' : ''}
        <button data-act="leave">${this.setup.online && !this.setup.online.solo ? 'Leave race' : 'Quit to garage'}</button>
      </div>${this.setup.online && !this.canRestart && !this.roam ? '<p class="rh-note">Only the host can restart an online race.</p>' : ''}`)
        : this.hud.panel(`
      <h2>Settings</h2>
      <div class="rh-buttons col">
        <button data-act="cam">Camera: ${this.cam}</button>
        <button data-act="volume">Volume: ${Math.round(loadVolume() * 100)}%</button>
        <button data-act="abs">ABS: ${onOff(a.abs)}</button>
        <button data-act="tcs">Traction control: ${onOff(a.tcs)}</button>
        <button data-act="steer">Steering assist: ${onOff(a.steer)}</button>
        <button data-act="arcade">Handling: ${a.arcade ? 'Arcade (drift on Ⓐ / Space)' : 'Simulation'}</button>
        <button data-act="auto">Gearbox: ${a.auto ? 'Automatic' : 'Manual'}</button>
        <button data-act="back" data-autofocus>Back</button>
      </div>`);
    setMenuNav(true);
    if (focus) p.querySelector<HTMLElement>(`[data-act="${focus}"]`)?.focus();
    const redo = (act: string) => {
      localStorage.setItem(ASSIST_KEY, JSON.stringify(this.assists));
      this.pause('settings', act);
    };
    p.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const act = b.dataset.act!;
        switch (act) {
          case 'resume':
            return this.resume();
          case 'restart':
            return this.restartFromPause(b);
          case 'spot': {
            const sp = this.spots()[Number(b.dataset.spot)];
            if (sp && this.phase === 'racing') this.teleport(sp);
            return this.resume();
          }
          case 'end':
            b.disabled = true;
            b.textContent = 'Ending…';
            return void this.setup.online?.net.send({ t: 'end' });
          case 'settings':
            return this.pause('settings');
          case 'back':
            return this.pause('main', 'settings');
          case 'lobby':
            return this.canRestart && this.othersOut ? this.pause('lobby') : this.toLobby();
          case 'lobbyyes':
            return this.toLobby();
          case 'lobbyno':
            return this.pause('main', 'lobby');
          case 'leave':
            this.setup.online?.net.leave();
            return this.exit('garage');
          case 'volume': {
            const i = VOLUMES.indexOf(loadVolume());
            this.audio.setVolume(VOLUMES[(i + 1) % VOLUMES.length]);
            return redo(act);
          }
          case 'cam':
            this.cam = CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length];
            localStorage.setItem(CAM_KEY, this.cam);
            return redo(act);
          case 'arcade':
          case 'tcs':
          case 'abs':
          case 'steer':
          case 'auto':
            this.assists[act] = !this.assists[act];
            if (act === 'auto' && this.me.car.gear === 0 && this.phase !== 'countdown') this.me.car.gear = 1;
            return redo(act);
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
      c.w.y * forwardSpeed(c),
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
      c.c.w * Math.hypot(g.v.x, g.v.z),
    );
    this.driftFx(r.model.root, sp.axleR, sp.bike ? 0 : sp.track, sp.cg, (c.c.f & CarFlag.Drift) !== 0, (c.c.f >> CarFlag.LevelShift) & 3, (c.c.f & CarFlag.Boost) !== 0, g.v.x, g.v.z, dt);
    if (c.c.f & CarFlag.Skid && this.puffTick % 3 === 0) this.fx.puff(p.x, p.y - sp.cg, p.z, g.v.x, g.v.z, 0.6, (c.c.f & CarFlag.Offroad) !== 0);
  }

  private render(dt: number, alpha: number) {
    const now = performance.now() / 1000;
    const me = this.me;
    this.puffTick++;
    for (const r of [me, ...this.rivals]) {
      this.poseLocal(r, alpha);
      this.tyreEffects(r, r === me ? 0 : 1 + this.rivals.indexOf(r), dt);
    }
    if (this.watching === null) this.windFx(me.car, me.model.root);
    for (const r of this.remotes.values()) {
      this.poseRemote(r, now, dt);
    }
    // The Best Moment replay puts every car (and the traffic, which runs on the race clock) back where it was then.
    const rp = this.replay;
    if (rp) this.poseReplay(rp, dt);
    const rg = this.recordGhost;
    if (rg) {
      rg.update(rp ? rp.t : this.ghostT - (1 - alpha) * TICK_DT, dt);
      if (!this.ghostLoc.s) this.ghostLoc.i = Math.round(this.track.startS / SAMPLE);
      rg.s = locate(this.track, rg.position.x, rg.position.z, this.ghostLoc.i, this.ghostLoc).s;
    }
    const clock = rp ? rp.t : this.trafficTime - (1 - alpha) * TICK_DT;
    this.trafficView?.update(clock, this.camera.position.x, this.camera.position.z);
    this.worldTraffic?.update(clock, this.camera);
    let focusY: number;
    if (rp) {
      this.replayCamera(rp, dt);
      focusY = rp.star.model.root.position.y;
    } else {
      const view = this.camTarget();
      this.updateCamera(dt, view);
      focusY = view.root.position.y;
    }
    this.driversVisible();
    this.view.follow(this.camera.position.x, focusY, this.camera.position.z, now);
    this.sound();
    if (!rp) this.updateHud();
    this.contact.update();
    this.post.render(now);
  }

  private tyreEffects(r: Racing, idx: number, dt: number) {
    const c = r.car;
    const sp = speedOf(c);
    const root = r.model.root;
    const rx = Math.cos(yawOf(c));
    const rz = -Math.sin(yawOf(c));
    const bike = c.spec.bike;
    c.wheels.forEach((w, i) => {
      // A bike's two tyres each stand for a hidden pair: one mark down the middle, from the left of each pair.
      if (bike && i % 2) return;
      const local = wheelLocal(c, i);
      const wp = new THREE.Vector3(bike ? 0 : local.x, local.y - c.spec.radius, local.z).applyMatrix4(root.matrixWorld);
      // Marks once a tyre is well past its peak; smoke only in a real slide or burnout.
      const marking = w.contact && w.slip > 1.35 && sp > 2 && !soft(w.surf);
      const smoking = w.contact && w.slip > 1.8 && sp > 2 && !soft(w.surf);
      const dirt = w.contact && soft(w.surf) && sp > 4;
      this.fx.mark(idx * 4 + i, wp.x, wp.y, wp.z, rx, rz, 0.22, marking ? Math.min(1, (w.slip - 1.2) * 1.2) : 0);
      if ((smoking && this.puffTick % 3 === 0) || (dirt && this.puffTick % 4 === 0)) this.fx.puff(wp.x, wp.y, wp.z, c.v.x, c.v.z, Math.min(1.5, w.slip - 1.5), dirt);
    });
    this.driftFx(root, c.spec.axleR, bike ? 0 : c.spec.track, c.spec.cg, c.drift !== 0, c.driftLevel, c.boost > 0, c.v.x, c.v.z, dt);
  }

  /** In a slipstream: faint air streaming past your car, thicker the deeper you're tucked in. */
  private windFx(c: Car, root: THREE.Object3D) {
    if (c.draft < 0.15) return;
    const n = Math.random() < c.draft ? 2 : 1;
    const sp = Math.hypot(c.v.x, c.v.z);
    if (sp < 1) return;
    // Streaks of air along the car's travel, a little longer the faster it goes.
    const len = Math.min(6, 1.5 + sp * 0.06) / sp;
    for (let k = 0; k < n; k++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 1.2);
      const p = new THREE.Vector3(side, 0.2 + Math.random() * 1.3, -4 - Math.random() * 6).applyMatrix4(root.matrixWorld);
      // Barely moving in the world: at speed they rush past the car like wind.
      this.fx.streak(p.x, p.y, p.z, c.v.x * len, 0, c.v.z * len, c.v.x * 0.15, 0, c.v.z * 0.15, 0.4, 0.35 + c.draft * 0.4);
    }
  }

  /** Sparks off the rear wheels while drifting (coloured by the level earned), flames from the exhaust while boosting. */
  private driftFx(root: THREE.Object3D, axleR: number, track: number, cg: number, drifting: boolean, level: number, boosting: boolean, vx: number, vz: number, dt: number) {
    if (drifting && this.puffTick % 2 === 0) {
      const color = SPARK_COLORS[level];
      for (const side of [-0.5, 0.5]) {
        const p = new THREE.Vector3(side * track, 0.05 - cg, axleR + 0.1).applyMatrix4(root.matrixWorld);
        for (let k = 0; k < 2; k++) this.fx.spark(p.x, p.y, p.z, vx * 0.7 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2, vz * 0.7 + (Math.random() - 0.5) * 3, color, 0.3, level ? 0.5 : 0.3);
      }
    }
    if (boosting) {
      const p = new THREE.Vector3(0, 0.35 - cg, axleR + 1.2).applyMatrix4(root.matrixWorld);
      const n = Math.floor(dt * FLAME.rate + Math.random());
      for (let k = 0; k < n; k++) {
        const color = FLAME.colors[Math.floor(Math.random() * FLAME.colors.length)];
        this.fx.spark(p.x, p.y, p.z, vx * FLAME.carry + (Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.5, vz * FLAME.carry + (Math.random() - 0.5) * 0.6, color, FLAME.life, FLAME.size, FLAME.glow);
      }
    }
  }

  // --- the Best Moment ---------------------------------------------------------------------------

  /**
   * Plays the winner's Best Moment (highlight.ts: the most exciting HIGHLIGHT.seconds of their run, from this client's
   * own recording) under its overlay, and resolves when it's over or skipped. Resolves at once if there's nothing to
   * show (a winner we never drew, a run too short). Never resolves if the race is torn down meanwhile.
   */
  private bestMoment(star: Racing | Remote | undefined, name: string): Promise<void> {
    const tape = star && this.tapes.get(star);
    const moment = tape && bestMoment(tape);
    if (!star || !tape || !moment || this.exited) return Promise.resolve();
    // Frame the side the car slides toward (its nose swings that way), or a fixed side for a straight run.
    let slip = 0;
    for (let i = 0; i < tape.length; i++) if (tape.time(i) >= moment.start && tape.time(i) < moment.start + HIGHLIGHT.seconds) slip += tape.slip(i);
    const el = document.createElement('div');
    el.className = 'rh-replay';
    el.innerHTML = `<i class="rh-lb top"></i><i class="rh-lb bottom"></i>
      <div class="rh-rp-tag"><i></i>Replay</div>
      <div class="rh-rp-card">
        <small class="rh-rp-who"><span>Winner</span><b data-who></b></small>
        <b class="rh-rp-title">Best Moment</b>
        <span class="rh-rp-line ${moment.kind}"></span>
        <div class="rh-rp-bar" style="animation-duration:${HIGHLIGHT.seconds}s"><i></i></div>
      </div>
      <button class="rh-rp-skip" data-act="skip">Skip</button>`;
    el.querySelector('[data-who]')!.textContent = name;
    el.querySelector('.rh-rp-line')!.textContent = momentLine(moment);
    this.hud.root.appendChild(el);
    this.hud.root.classList.add('replay');
    this.hud.watching('', '');
    return new Promise((done) => {
      this.replay = { t: moment.start, end: moment.start + HIGHLIGHT.seconds, star, moment, side: slip < 0 ? -1 : 1, dir: new THREE.Vector2(), fresh: true, el, done };
      const skip = el.querySelector<HTMLButtonElement>('[data-act="skip"]')!;
      skip.addEventListener('click', () => this.endReplay());
      setMenuNav(true);
      skip.focus({ preventScroll: true });
    });
  }

  private endReplay() {
    const rp = this.replay;
    if (!rp) return;
    this.replay = null;
    rp.el.remove();
    this.hud.root.classList.remove('replay');
    this.post.rush = 0;
    this.snapCamera();
    rp.done();
  }

  /** Every recorded car as it was at the replay's moment, the winner with its sparks and smoke. */
  private poseReplay(rp: Replay, dt: number) {
    rp.t += dt;
    if (rp.t >= rp.end) return this.endReplay();
    const now = newPlayPose();
    const then = newPlayPose();
    for (const [r, tape] of this.tapes) {
      if ('id' in r && this.remotes.get(r.id) !== r) continue; // left the race
      tape.at(rp.t, now);
      tape.at(rp.t - 0.05, then);
      const root = r.model.root;
      root.position.set(now.x, now.y, now.z);
      root.quaternion.set(...now.q);
      root.updateMatrixWorld();
      const sp = 'car' in r ? r.car.spec : r.spec;
      const spin = (root.userData.replaySpin = ((root.userData.replaySpin as number | undefined) ?? 0) + (now.speed / sp.radius) * dt);
      const restY = (a: number) => sp.mountY[a] - (sp.rest - (sp.rest + sp.radius - sp.cg - sp.mountY[a]));
      const yawRate = angleDiff(yawOfPose(now), yawOfPose(then)) / 0.05;
      r.model.pose(
        [0, 1, 2, 3].map((i) => ({ y: restY(i < 2 ? 0 : 1), angle: spin })),
        now.steer,
        (now.flags & MomentFlag.Brake) !== 0,
        yawRate * now.speed,
      );
      if (r !== rp.star) continue;
      const vx = (now.x - then.x) / 0.05;
      const vz = (now.z - then.z) / 0.05;
      this.driftFx(root, sp.axleR, sp.bike ? 0 : sp.track, sp.cg, (now.flags & MomentFlag.Drift) !== 0, (now.flags >> MomentFlag.LevelShift) & 3, (now.flags & MomentFlag.Boost) !== 0, vx, vz, dt);
      if (Math.abs(now.slip) > 0.2 && now.speed > 8 && !(now.flags & MomentFlag.Air) && this.puffTick % 3 === 0) this.fx.puff(now.x, now.y - sp.cg, now.z, vx, vz, 0.6, false);
    }
  }

  /**
   * The replay's camera: it rides with the winner and swings slowly round them. A drift or a jump goes from behind
   * the car round to its side; a flat-out run starts ahead of the car and lets it go by.
   */
  private replayCamera(rp: Replay, dt: number) {
    // Whatever camera you raced in, the replay is filmed from outside.
    for (const [r, c] of this.cockpits) {
      c.root.visible = false;
      const rider = r.userData.rider as THREE.Object3D | undefined;
      if (rider) rider.visible = true;
    }
    if (this.hiddenCabin) {
      this.hiddenCabin.visible = true;
      this.hiddenCabin = null;
    }
    if (this.camera.near !== 0.2) this.camera.near = 0.2;
    const root = rp.star.model.root;
    const p = root.position;
    const tape = this.tapes.get(rp.star)!;
    const a = tape.at(rp.t - 0.1);
    const b = tape.at(rp.t + 0.1);
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let l = Math.hypot(dx, dz);
    if (l < 0.3) {
      // Slow: frame against the nose instead.
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
      dx = f.x;
      dz = f.z;
      l = Math.hypot(dx, dz) || 1;
    }
    const want = new THREE.Vector2(dx / l, dz / l);
    if (rp.fresh) rp.dir.copy(want);
    else rp.dir.lerp(want, 1 - Math.exp(-dt * REPLAY_CAM.follow)).normalize();
    const k = Math.min(1, Math.max(0, 1 - (rp.end - rp.t) / HIGHLIGHT.seconds));
    const ease = k * k * (3 - 2 * k);
    const shot = rp.moment.kind === 'speed' ? REPLAY_CAM.flyby : REPLAY_CAM.orbit;
    const ang = (shot.from + (shot.to - shot.from) * ease) * rp.side;
    const spec = 'car' in rp.star ? rp.star.car.spec : rp.star.spec;
    const len = CARS[spec.id].length;
    const dist = shot.dist + len * 0.4;
    // Rotate the direction of travel by `ang` (0: ahead of the car, π: behind it).
    const cx = rp.dir.x * Math.cos(ang) - rp.dir.y * Math.sin(ang);
    const cz = rp.dir.x * Math.sin(ang) + rp.dir.y * Math.cos(ang);
    const pos = new THREE.Vector3(p.x + cx * dist, p.y + shot.lowY + (shot.highY - shot.lowY) * ease, p.z + cz * dist);
    pos.y = Math.max(pos.y, heightAt(this.track, pos.x, pos.z) + 0.6, p.y - spec.cg + 0.5);
    // Look at the car itself (a smoothed look point lags metres behind at 250 km/h); the travel direction is smoothed.
    rp.fresh = false;
    this.camera.position.copy(pos);
    this.camera.lookAt(p.x + rp.dir.x * 1.5, p.y + 0.5, p.z + rp.dir.y * 1.5);
    this.camera.fov = REPLAY_CAM.fov;
    this.camera.updateProjectionMatrix();
    const speed = tape.at(rp.t).speed;
    this.post.rush = Math.min(1, Math.max(0, (speed - RUSH.from) / (RUSH.full - RUSH.from))) * 0.5;
  }

  /** What the camera follows: your car, or the racer you're spectating (posed from its last update). */
  private camTarget(): CamTarget {
    const r = this.watching !== null ? this.remotes.get(this.watching) : undefined;
    if (!r?.last) {
      const self = this.watchCar && !this.watchCar.out ? this.watchCar : this.me;
      const c = self.car;
      const on = c.wheels.filter((w) => w.contact);
      const rough = on.reduce((a, w) => a + (ROUGH[w.surf] ?? 1), 0) / 4;
      return { root: self.model.root, id: c.spec.id, cg: c.spec.cg, v: c.v, yaw: yawOf(c), fwd: forwardSpeed(c), hit: c.hit, boost: c.boost > 0, spec: c.spec, steer: c.steer, rpm: c.rpm, land: c.land, rough };
    }
    const root = r.model.root;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion);
    const v = { x: r.last.c.v[0], y: r.last.c.v[1], z: r.last.c.v[2] };
    const f2 = r.last.c.f;
    return {
      root, id: r.spec.id, cg: r.spec.cg, v, yaw: Math.atan2(-f.x, -f.z), fwd: v.x * f.x + v.y * f.y + v.z * f.z, hit: 0, boost: (f2 & CarFlag.Boost) !== 0,
      spec: r.spec, steer: r.last.c.st, rpm: r.rpm, land: 0, rough: f2 & CarFlag.Offroad ? ROUGH.gravel : 1,
    };
  }

  private driversVisible() {
    const cam = this.camera.position;
    for (const m of [this.me.model, ...this.rivals.map((r) => r.model), ...[...this.remotes.values()].map((r) => r.model)])
      if (m.driver) m.driver.root.visible = m.root.position.distanceToSquared(cam) < DRIVER_RANGE ** 2;
  }

  private updateCamera(dt: number, t: CamTarget) {
    const root = t.root;
    const v = t.v;
    const speed = Math.hypot(v.x, v.y, v.z);
    const b = CARS[t.id];
    const back = this.controls.lookBack;
    const inside = this.cam === 'cockpit';
    for (const [r, c] of this.cockpits) {
      c.root.visible = inside && r === root;
      // From a bike's saddle you are the rider: hide them (bikemodel.ts).
      const rider = r.userData.rider as THREE.Object3D | undefined;
      if (rider) rider.visible = !c.root.visible;
    }
    // The outside model's cabin would wall you in: the cockpit draws its own.
    const hide = inside ? root.getObjectByName(INTERIOR) ?? null : null;
    if (hide !== this.hiddenCabin) {
      if (this.hiddenCabin) this.hiddenCabin.visible = true;
      if (hide) hide.visible = false;
      this.hiddenCabin = hide;
    }
    const nearPlane = inside ? 0.06 : 0.2;
    if (this.camera.near !== nearPlane) this.camera.near = nearPlane;
    if (inside) {
      this.cockpitCamera(dt, t, speed, back);
    } else if (this.cam === 'hood' || this.cam === 'bumper') {
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
      const shake = Math.min(0.028, speed * 0.00028) + Math.min(0.2, t.hit * 0.02);
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.camera.lookAt(this.camLook);
      this.camera.fov = 60 + Math.min(18, speed * 0.22) + (t.boost ? 8 : 0);
    }
    this.camera.updateProjectionMatrix();
    // Speed blur at the edges of the frame (post.ts): none below RUSH.from, full at RUSH.full, more on a boost.
    const want = Math.min(1, Math.max(0, (speed - RUSH.from) / (RUSH.full - RUSH.from)) + (t.boost ? RUSH.boost : 0)) * (inside ? RUSH.cockpit : 1);
    this.post.rush += (want - this.post.rush) * (1 - Math.exp(-dt * 4));
  }

  /**
   * Driver's eye: sat in the seat, the head on its neck thrown about by the car's acceleration (felt from how
   * its velocity changes, so it works for spectated cars too), looking into corners, and shaken by the road,
   * the engine, impacts and landings (headcam.ts).
   */
  private cockpitCamera(dt: number, t: CamTarget, speed: number, back: boolean) {
    const root = t.root;
    // A bike's rider sits in its leaning frame (bikemodel.ts), so the view tilts with it; a car's is the root.
    const seat = (root.userData.lean as THREE.Object3D | undefined) ?? root;
    let pit = this.cockpits.get(root);
    if (!pit) {
      pit = buildCockpit(t.id, t.spec, root.userData.design);
      seat.add(pit.root);
      this.cockpits.set(root, pit);
    }
    root.updateMatrixWorld();
    const q = root.quaternion;
    const seatQ = seat.getWorldQuaternion(new THREE.Quaternion());
    const v = new THREE.Vector3(t.v.x, t.v.y, t.v.z);
    if (this.headRoot !== root) {
      this.headRoot = root;
      this.head.reset();
      this.headV.copy(v);
      this.headA.set(0, 0, 0);
      this.headYaw = t.yaw;
    }
    const h = Math.max(dt, 1e-3);
    const a = v.clone().sub(this.headV).divideScalar(h);
    this.headV.copy(v);
    // A reset or a respawn teleports the car: that's not a force anyone feels.
    if (a.length() > 120) a.set(0, 0, 0);
    this.headA.lerp(a, 1 - Math.exp(-dt * 30));
    const inv = q.clone().invert();
    const aL = this.headA.clone().applyQuaternion(inv);
    const vL = v.clone().applyQuaternion(inv);
    let dYaw = t.yaw - this.headYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.headYaw = t.yaw;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    // Knocks arrive once per physics tick; only feel each one once, however many frames it's showing for.
    const hit = t.hit !== this.headHit ? t.hit : 0;
    const land = t.land !== this.headLand ? t.land : 0;
    this.headHit = t.hit;
    this.headLand = t.land;
    const pose = this.head.update(dt, {
      aLat: aL.x,
      aUp: aL.y,
      aFwd: -aL.z,
      speed,
      yawRate: dYaw / h,
      slip: speed > 3 ? Math.atan2(vL.x, Math.max(2, Math.abs(vL.z))) : 0,
      bodyRoll: Math.asin(Math.max(-1, Math.min(1, right.y))),
      rough: t.rough,
      hit,
      land,
      rev: Math.min(1.1, t.rpm / t.spec.redline),
      boost: t.boost,
    });
    const eye = pit.eye.clone().add(new THREE.Vector3(pose.lat, pose.up, -pose.fwd));
    this.camera.position.copy(eye.applyMatrix4(seat.matrixWorld));
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.pitch - 0.05, pose.yaw + (back ? Math.PI : 0), pose.roll, 'YXZ'));
    this.camera.quaternion.copy(seatQ).multiply(look);
    this.camera.fov = 60 + pose.fov;
    pit.update(t.steer, t.rpm, speed * 3.6);
  }

  private snapCamera() {
    this.headRoot = null;
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
    // Rumble: road texture off the tarmac, the tyres at the limit, ABS chattering under a stamped brake.
    if (this.wallClock > this.rumbleAt && !this.paused) {
      const strong = off * Math.min(1, speed / 20) * 0.5 + (me.absOn ? 0.3 : 0);
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
    const dots: Dot[] = me.out ? [] : [{ s: c.s, me: true, color: me.color, x: c.p.x, z: c.p.z }];
    for (const r of this.rivals) dots.push({ s: r.car.s, me: false, color: r.color, x: r.car.p.x, z: r.car.p.z });
    for (const r of this.remotes.values()) if (!r.out) dots.push({ s: r.s, me: false, color: r.color, x: r.model.root.position.x, z: r.model.root.position.z });
    const rg = this.recordGhost;
    if (rg) dots.push({ s: rg.s, me: false, color: rg.color, x: rg.position.x, z: rg.position.z });
    // Everyone in race order (finishers by time, then by distance down the road): your place, the board, the tags.
    type Who = { name: string; color: string; me: boolean; tag: Tag['id']; root: THREE.Object3D; height: number };
    // (A battle royale's knocked-out cars are off the board: the place is among the cars still in.)
    const order = standings<Who>([
      ...(me.out ? [] : [{ who: { name: me.name, color: me.color, me: true, tag: 'me', root: me.model.root, height: CARS[c.spec.id].height - c.spec.cg }, finished: me.finished, progress: c.s }]),
      ...this.rivals.map((r) => ({ who: { name: r.name, color: r.color, me: false, tag: 'ai' + r.name, root: r.model.root, height: CARS[r.car.spec.id].height - r.car.spec.cg }, finished: r.finished, progress: r.car.s })),
      ...[...this.remotes.values()].filter((r) => !r.out).map((r) => ({ who: { name: r.name, color: r.color, me: false, tag: r.id, root: r.model.root, height: CARS[r.spec.id].height - r.spec.cg }, finished: r.finished, progress: r.s })),
    ]);
    const followed = this.watching !== null && this.remotes.get(this.watching)?.last ? this.watching : this.watchCar && !this.watchCar.out ? 'ai' + this.watchCar.name : 'me';
    const myPlace = order.findIndex((e) => e.who.me) + 1;
    const tags: Tag[] = order.filter((e) => e.who.tag !== followed).map((e) => ({ id: e.who.tag, name: e.who.name, color: e.who.color, place: this.roam ? '' : order.indexOf(e) + 1, at: this.tagAt(e.who.tag, e.who.root, e.who.height) }));
    if (rg) tags.push({ id: 'record', name: rg.run.name, color: rg.color, place: 'TR', at: this.tagAt('record', rg.model.root, rg.height) });
    this.hud.tags(tags);
    this.hud.update({
      speed: speedOf(c),
      rpm: c.rpm,
      redline: c.spec.redline,
      gear: c.gear,
      shifting: c.shift > 0,
      place: myPlace,
      field: order.length,
      // A battle royale: how many are left, and whether you're the one who'd go out at the line.
      royale: this.royaleOn && !this.roam ? { left: order.length, danger: this.phase === 'racing' && myPlace > 0 && myPlace === order.length && order.length > 1 && me.finished === null } : undefined,
      time: me.finished ?? this.time,
      // (Knocked out of a battle royale: the lap the leader is on.)
      lap: me.out ? lapOf(this.track, order[0]?.progress ?? c.s) : me.finished !== null ? this.track.def.laps ?? 0 : lapOf(this.track, c.s),
      laps: this.track.def.laps ?? 0,
      abs: c.absOn,
      tcs: c.tcsOn,
      wrongWay: !this.roam && this.phase === 'racing' && tangentDot < -0.3 && speedOf(c) > 3,
      manual: !this.assists.auto,
      drift: c.drift !== 0 ? c.driftLevel : -1,
      combo: this.driftMeter.combo > 0 ? { points: comboPoints(this.driftMeter), mult: this.driftMeter.mult } : null,
      driftTotal: this.driftMeter.total,
      boost: c.boost > 0,
      draft: me.finished === null ? c.draft : 0,
      charge: c.draftArmed > 0 ? 1 : c.draftCharge / DRAFT.charge,
      sling: this.wallClock < this.slingUntil && c.boost > 0,
      heading: yaw,
      damage: this.physics ? me.dmg : null,
      dots,
      board: order.map((e) => ({ name: e.who.name, color: e.who.color, me: e.who.me, finished: e.finished })),
      where: this.track.world ? this.track.world.world.roads[this.track.world.world.road[c.hint]]?.def.name : undefined,
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
    const far = 1 - Math.min(1, Math.max(0, (dist - TAG_NEAR) / (TAG_FAR - TAG_NEAR)));
    const close = TAG_CLOSE_ALPHA + (1 - TAG_CLOSE_ALPHA) * Math.min(1, Math.max(0, (dist - TAG_CLOSE_IN) / (TAG_CLOSE_OUT - TAG_CLOSE_IN)));
    const alpha = TAG_ALPHA * far * close;
    return { x: (ndc.x * 0.5 + 0.5) * this.viewW, y: (-ndc.y * 0.5 + 0.5) * this.viewH, alpha };
  }

  /** The view's size, kept from the last resize: reading it per name tag after the HUD's DOM writes forced a layout every frame. */
  private viewW = innerWidth;
  private viewH = innerHeight;

  private resize = () => {
    const w = this.setup.container.clientWidth || innerWidth;
    const h = this.setup.container.clientHeight || innerHeight;
    this.viewW = w;
    this.viewH = h;
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
    setLampLevel(LAMP_DAY);
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.offNet?.();
    this.controls.dispose();
    this.hud.dispose();
    for (const r of [this.me, ...this.rivals, ...this.fallen]) r.model.dispose();
    for (const r of this.remotes.values()) r.model.dispose();
    this.recordGhost?.dispose();
    for (const c of this.cockpits.values()) c.dispose();
    this.fx.dispose();
    this.blasts?.dispose();
    this.trafficView?.dispose();
    this.worldTraffic?.dispose();
    this.view.dispose();
    this.post.dispose();
    this.contact.dispose();
    this.audio.close();
    releaseRenderer(this.renderer); // dispose() alone leaks the whole context (see releaseRenderer)
    setMenuNav(true);
  }
}
