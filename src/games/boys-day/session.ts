// One run on this screen, in first person: the bus over the hills, each leg's world, the horde, and you: at the
// wheel, on foot about the bus (inside, up on the roof, at the bong, the cooler or the card table), or off it at a
// checkpoint doing its job. Every browser runs a Session; the host's also runs the Director (zombies, rounds, the
// checkpoint, everyone's scrap, the fuel) and the card table's referee, and sends what they decide. Solo is the same
// with nobody else.
//
// Who moves the bus: the driver's browser simulates it and sends its pose; everyone else smooths toward that. With
// nobody driving, the host lets it roll to a stop. Everyone else's place (on the bus or off it) comes with their aim.
// A new leg is a new world: when the run's stage changes, every screen rebuilds the map for it from the seed.

import * as THREE from 'three';
import { Audio } from './audio.ts';
import { Blackjack, DuelTable } from './cards.ts';
import { BIOMES, TWISTS } from './checkpoints.ts';
import { BEACON_R, Director, GORDIE_PAINT, packZombies, unpackZombies, type Fx, type Walker, type ZView } from './director.ts';
import { Duel, type DuelMove, type DuelView } from './duel.ts';
import { Hud } from './hud.ts';
import { Input, type Frame } from './input.ts';
import { Golf, Slots, type Minigame } from './minigames.ts';
import { Horde, Paint, makeBean, makeBus, makeClub, makeGun, paintOf, type Ball, type Bean } from './models.ts';
import { ACT_MAX, takeWheel, type Act, type Msg } from './net.ts';
import { Post } from './post.ts';
import { HAZARD, ROAD, groundAt, hazardAt, makeRoute, roadNear, solids, toGo, type Route, type Site } from './route.ts';
import {
  BUS,
  BUY,
  CLUB,
  DRIVER,
  FOOT,
  GUN,
  GUNS,
  HANG,
  NADE,
  NO_DRIVE,
  OFF_CAB,
  REPAIR,
  RUN,
  UPGRADES,
  ZOMBIE,
  atCab,
  atHatch,
  canBoard,
  collideBus,
  fwdOf,
  gunsUnlocked,
  hangAt,
  hopOff,
  hopOn,
  hopperOf,
  objective,
  onBus,
  powerOf,
  priceOf,
  reloadOf,
  rightOf,
  rng,
  startSpot,
  stepBus,
  stepFoot,
  walk,
  wallHit,
  type Bus,
  type Obstacle,
  type RunState,
  type Spot,
} from './rules.ts';
import { Sky } from './sky.ts';
import { World } from './world.ts';
import type { GameApi } from '../types.ts';

/** How this screen talks to the others (a party, or nobody in solo). */
export interface Link {
  me: number;
  hostId: number;
  /** Everyone in the run, in join order (their paint colours and wallets follow it). */
  crew: { id: number; name: string }[];
  /** To everyone else, or to one player. */
  send(m: Msg, to?: number): void;
  solo: boolean;
}

const SEND = { bus: 1 / 15, aim: 1 / 8, act: 1 / 10, z: 1 / 10, run: 1 / 3 };
const CHASE = { back: 15, up: 7.5, ahead: 9 };
const BEST_KEY = 'boys-day.best';
const EMPTY_TABLE: DuelView = { phase: 'wait', seats: [-1, -1], ante: 10, pot: 0, turn: 0, drew: [false, false], raised: false, shown: [[], []], winner: -1 };

interface Other {
  spot: Spot;
  yaw: number;
  pitch: number;
  /** Off the bus: where (world), and whether they're lugging a can. */
  foot: { x: number; z: number } | null;
  carry: boolean;
}

export class Session {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700);
  private route: Route;
  private world: World;
  private legBuilt = 0;
  private busModel = makeBus();
  private horde = new Horde();
  private paint = new Paint();
  private audio = new Audio();
  private input: Input;
  private hud: Hud;
  private director: Director | null = null;
  private duel: Duel | null = null;
  private sky: Sky;
  private post: Post;
  /** Seconds to the next lightning strike, and to its thunder. */
  private boltT = 9;
  private thunderT = -1;

  private bus: Bus = { x: 0, z: 0, h: 0, v: 0, steer: 0 };
  /** The driver's last pose (for smoothing on everyone else's screen). */
  private busTarget: Bus | null = null;
  private run: RunState;
  private taken = new Set<number>();
  private got = new Set<number>();
  private zs: ZView[] = [];
  /** Who's at the wheel (-1: nobody, the bus rolls to a stop). */
  private driver: number;
  private others = new Map<number, Other>();
  private beans = new Map<number, Bean>();
  private gordie: Bean | null = null;
  /** You on the bus: where, and inside or up top. Off it: `foot` (world) and the way you face (`footYaw`). */
  private spot: Spot;
  private foot: { x: number; z: number } | null = null;
  private footYaw = 0;
  private hp: number = FOOT.hp;
  private koT = 0;
  private hurt = 0;
  private carrying = false;
  /** Seconds left of the bong and of the beers. */
  private high = 0;
  private tipsy = 0;
  private hangT = 0;
  /** The bus's height and tilt over the hills (for drawing), and the bumps. */
  private busY = 0;
  private tilt = { pitch: 0, roll: 0 };
  private shake = 0;
  private jolted = new Map<number, number>();
  private bars: Obstacle[] = [];

  /** Your look, relative to the bus (0 toward the front). */
  private yaw = 0;
  private wasDriving = false;
  /** The driver's camera: false in the cab (first person), true chasing the bus. */
  private chase = false;
  private steer: THREE.Object3D | null = null;
  private pitch = -0.1;
  private gun = 0;
  private ammo: number[] = GUNS.map(() => -1);
  private nades: number = NADE.start;
  private nadeT = 0;
  private reloadT = 0;
  private fireT = 0;
  private clubT = 0;
  private swingT = 0;
  private guns: THREE.Group[];
  private viewClub = makeClub();

  private mini: Minigame | null = null;
  private miniKind: 'golf' | 'slots' | 'bj' | 'duel' | 'table' | 'shop' | null = null;
  private table: DuelView = EMPTY_TABLE;
  private myHand: number[] = [];
  private shopKey = '';
  private paused = false;
  private pauseEl: HTMLElement | null = null;
  private endEl: HTMLElement | null = null;
  private act: Act = newAct();
  private timers = { bus: 0, aim: 0, act: 0, z: 0, run: 0 };
  private fxOut: Fx[] = [];
  private saidOut: string[] = [];
  private honking = false;
  private clock = 0;
  private roadHint = 0;
  private runKey = '';
  private bumpT = 0;
  private groanT = 2;
  private offs: (() => void)[] = [];
  private stage: HTMLElement;
  private viewH = 600;

  constructor(
    root: HTMLElement,
    private renderer: THREE.WebGLRenderer,
    private link: Link,
    private seed: number,
    driver: number,
    private api: GameApi,
    private onLeave: () => void,
    private onAgain: () => void,
  ) {
    this.driver = driver;
    this.spot = startSpot(this.myPlace);
    if (this.isHost) {
      const d = (this.director = new Director(seed, link.crew.length));
      this.duel = new Duel(rng(seed ^ 0xd0e1), (who) => d.run.cash[who] ?? 0, (who, n) => d.pay(who, n));
    }
    this.run = this.director?.run ?? { ...new Director(seed, link.crew.length).run };
    this.route = this.director?.route ?? makeRoute(seed, 0);
    this.world = new World(this.route);

    this.sky = new Sky(this.scene);
    this.scene.add(this.busModel, this.horde.group, this.paint.group, this.camera);
    // Shadows: the bus and the horde cast them (not the glass); the ground, road and scenery take them.
    this.busModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      m.castShadow = !mat.transparent;
      m.receiveShadow = true;
    });
    this.horde.group.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = true)));
    this.post = new Post(renderer, this.scene, this.camera);
    // Every gun, built once and shown in turn (nothing new to compile mid-run).
    this.guns = GUNS.map((_, k) => {
      const g = makeGun(k, paintOf(this.myPlace));
      g.scale.setScalar(0.5);
      g.position.set(0.24, -0.24, -0.5);
      g.visible = false;
      this.camera.add(g);
      return g;
    });
    this.viewClub.position.set(0.35, -0.2, -0.6);
    this.viewClub.visible = false;
    this.camera.add(this.viewClub);
    this.steer = this.busModel.getObjectByName('steer') ?? null;

    this.stage = document.createElement('div');
    this.stage.className = 'bd-stage';
    root.append(this.stage);
    this.stage.append(renderer.domElement);
    this.hud = new Hud(this.stage);
    this.input = new Input(renderer.domElement, api);

    const onClick = () => {
      this.audio.wake();
      if (!this.paused && !this.endEl && !this.mini?.menu) this.input.lock();
    };
    renderer.domElement.addEventListener('click', onClick);
    this.offs.push(() => renderer.domElement.removeEventListener('click', onClick));
    // Esc never quits mid-run: it closes a minigame or pauses.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (this.endEl) return;
      if (this.mini) return this.closeMini();
      this.setPaused(!this.paused);
    };
    addEventListener('keydown', onEsc, { capture: true });
    this.offs.push(() => removeEventListener('keydown', onEsc, { capture: true }));
    const onKey = () => this.audio.wake();
    addEventListener('keydown', onKey);
    this.offs.push(() => removeEventListener('keydown', onKey));
    this.resize();
    const onResize = () => this.resize();
    addEventListener('resize', onResize);
    this.offs.push(() => removeEventListener('resize', onResize));
    this.enterLeg(true);
    this.hud.say('You wake up at the paintball arena. Everything is… zombies?');
    api.setMenuNav(false);
  }

  private get isHost() {
    return this.link.me === this.link.hostId;
  }
  private get driving() {
    return this.driver === this.link.me;
  }
  /** The ground's height at (x, z). */
  private ground = (x: number, z: number) => groundAt(this.route, x, z);
  private get myPlace() {
    return this.placeOf(this.link.me);
  }
  /** A player's place in the crew: their paint colour and their wallet. */
  private placeOf(id: number) {
    return Math.max(0, this.link.crew.findIndex((c) => c.id === id));
  }
  private get cash() {
    return this.run.cash[this.myPlace] ?? 0;
  }
  private get unlocked() {
    return gunsUnlocked(this.run.stage + (this.run.done ? 1 : 0));
  }
  private hopper(k = this.gun) {
    return Math.max(1, Math.round(hopperOf(this.run) * GUNS[k].hopper));
  }

  private resize() {
    const w = this.stage.clientWidth || innerWidth;
    const h = this.stage.clientHeight || innerHeight;
    this.viewH = h;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------------------------
  // Legs: each one a new world

  /** Builds the world for the leg the run's on, and puts the bus (and everyone) at its start. */
  private enterLeg(first = false) {
    if (!first) {
      this.scene.remove(this.world.group);
      this.world.dispose();
      this.route = this.director?.route ?? makeRoute(this.seed, this.run.stage);
      this.world = new World(this.route);
      this.audio.play('whoosh');
      this.nades = Math.min(NADE.max, this.nades + NADE.perClear);
    }
    this.legBuilt = this.run.stage;
    this.scene.add(this.world.group);
    this.sky.apply(this.world.look);
    this.post.setGrade(this.world.look.grade);
    const start = this.route.road[2];
    Object.assign(this.bus, { x: start.x, z: start.z, h: start.h, steer: 0, v: first ? 0 : Math.min(this.bus.v, 14) });
    this.busTarget = null;
    this.busY = start.y;
    this.tilt = { pitch: 0, roll: 0 };
    this.roadHint = 0;
    this.jolted.clear();
    this.bars = solids(this.route, false);
    if (!this.director) {
      this.taken = new Set();
      this.got = new Set();
      this.zs = [];
    }
    // Anyone still on foot was hauled aboard as the bus went through the gate.
    if (this.foot) this.board(false);
    for (const o of this.others.values()) o.foot = null;
    this.carrying = false;
    this.closeMini();
    const cp = this.route.cp;
    this.hud.legCard(this.run.stage + 1, BIOMES[cp.biome].name, cp.name, TWISTS[cp.twist].note);
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  /** A message from another screen. */
  onMsg(from: number, m: Msg) {
    const fromHost = from === this.link.hostId;
    const who = this.placeOf(from);
    switch (m.t) {
      case 'bus':
        if (from === this.driver && m.l === this.legBuilt) this.busTarget = { x: m.x, z: m.z, h: m.h, v: m.v, steer: m.s };
        break;
      case 'aim':
        this.others.set(
          from,
          m.l === 2
            ? { spot: this.others.get(from)?.spot ?? startSpot(who), yaw: m.yaw, pitch: m.pitch, foot: { x: m.s, z: m.a }, carry: !!m.c }
            : { spot: { side: m.s, along: m.a, level: m.l }, yaw: m.yaw, pitch: m.pitch, foot: null, carry: false },
        );
        break;
      case 'act':
        this.onAct(from, m);
        break;
      case 'z':
        if (!fromHost) return;
        this.zs = unpackZombies(m.z);
        for (const f of m.fx) this.showFx(f);
        for (const s of m.said) this.hud.say(s);
        break;
      case 'run':
        if (!fromHost) return;
        this.run = m.run;
        this.taken = new Set(m.taken);
        this.got = new Set(m.got);
        break;
      case 'driver':
        if (fromHost) this.driver = m.id;
        break;
      case 'drive':
        if (this.isHost) this.setDriver(takeWheel(this.driver, from, m.want));
        break;
      case 'mini':
        this.director?.mini(m.k, m.v, who);
        break;
      case 'bj':
        this.director?.blackjack(m.v, who);
        break;
      case 'duel':
        this.duelMove(who, m.m, m.n);
        break;
      case 'table':
        if (fromHost) this.setTable(m.v);
        break;
      case 'hand':
        if (fromHost) this.setHand(m.cards);
        break;
      case 'do':
        if (m.k === 'toke' || m.k === 'drink') {
          const name = this.link.crew[who]?.name ?? 'Someone';
          this.hud.say(m.k === 'toke' ? `${name} rips the bong 💨` : `${name} cracks a cold one 🍺`);
          this.audio.play(m.k === 'toke' ? 'cough' : 'burp', 0.4);
        } else this.director?.did(m.k, m.id, who);
        break;
      case 'buy':
        this.director?.buy(m.k, who);
        break;
      case 'honk':
        this.audio.play('horn', 0.7);
        break;
    }
  }

  private onAct(from: number, a: Act) {
    // Their paintballs, for show (the hits come in the same message).
    const gun = GUNS[a.g] ?? GUNS[0];
    for (let i = 0; i + 5 < a.shots.length; i += 6) {
      const p = new THREE.Vector3(a.shots[i] / 10, a.shots[i + 1] / 10, a.shots[i + 2] / 10);
      const d = new THREE.Vector3(a.shots[i + 3], a.shots[i + 4], a.shots[i + 5]).divideScalar(1000);
      this.paint.fire(p, d.multiplyScalar(GUN.speed * gun.speed), a.c, false, GUN.life, gun.gravity, gun.splash ? 2 : 1);
    }
    if (a.shots.length) this.audio.play('pop', 0.25);
    const d = this.director;
    if (!d) return;
    const c = this.placeOf(from);
    const dmg = d.damageOf(a.g);
    for (const id of a.hits) d.hit(id, c, dmg);
    for (const id of a.boom) d.hit(id, c, d.damageOf(-1));
    for (const id of a.grabs) d.grab(id);
    if (a.swing.length) d.swing(a.swing, c, this.bus, this.others.get(from)?.foot ?? undefined);
  }

  /** A player who left the party leaves the wheel and the card table too (the host's call), and their bean goes. */
  dropMissing(ids: ReadonlySet<number>) {
    for (const id of [...this.others.keys()]) {
      if (ids.has(id)) continue;
      this.others.delete(id);
      const bean = this.beans.get(id);
      bean?.root.removeFromParent();
      this.beans.delete(id);
      if (this.duel) this.tableOut(this.duel.drop(this.placeOf(id)));
    }
    if (this.isHost && this.driver >= 0 && !ids.has(this.driver)) this.setDriver(-1);
  }

  private setDriver(id: number) {
    this.driver = id;
    this.link.send({ t: 'driver', id });
  }

  // The card table (the host referees: duel.ts).

  private duelMove(who: number, m: DuelMove, n: number) {
    if (this.duel) this.tableOut(this.duel.move(who, m, n));
    else this.link.send({ t: 'duel', m, n });
  }

  private tableOut(out: ReturnType<Duel['move']>) {
    if (!out) return;
    this.link.send({ t: 'table', v: out.view });
    for (const [who, cards] of out.hands) {
      const id = this.link.crew[who]?.id;
      if (id === this.link.me) this.setHand(cards);
      else if (id !== undefined) this.link.send({ t: 'hand', cards }, id);
    }
    this.setTable(out.view);
  }

  private setTable(v: DuelView) {
    this.table = v;
    if (this.mini instanceof DuelTable) this.mini.setView(v);
  }

  private setHand(cards: number[]) {
    this.myHand = cards;
    if (this.mini instanceof DuelTable) this.mini.setHand(cards);
  }

  /** Everyone's bean: the driver sat at the wheel, the rest on their feet, on the bus or out in the world. */
  private placeBeans(dt: number) {
    for (const c of this.link.crew) {
      let bean = this.beans.get(c.id);
      if (!bean) {
        bean = makeBean(paintOf(this.placeOf(c.id)));
        bean.root.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = true)));
        this.busModel.add(bean.root);
        this.beans.set(c.id, bean);
      }
      const me = c.id === this.link.me;
      const o: Other | undefined = me ? { spot: this.spot, yaw: this.foot ? this.footYaw : this.yaw, pitch: this.pitch, foot: this.foot, carry: this.carrying } : this.others.get(c.id);
      const driving = c.id === this.driver;
      bean.root.visible = (!me || (this.driving && this.chase)) && (!!o || driving);
      bean.gun.visible = !driving && !o?.carry;
      bean.can.visible = !!o?.carry;
      const home = o?.foot && !driving ? this.scene : this.busModel;
      if (bean.root.parent !== home) {
        home.add(bean.root);
        if (o?.foot) bean.root.position.set(o.foot.x, this.ground(o.foot.x, o.foot.z), o.foot.z);
        else if (o) bean.root.position.set(o.spot.side, BUS.floor, -o.spot.along);
      }
      if (driving) {
        bean.root.position.set(DRIVER.side, BUS.floor - 0.25, -DRIVER.along);
        bean.aim.rotation.y = 0;
        continue;
      }
      if (!o) continue;
      const k = me ? 1 : Math.min(1, dt * 10);
      if (o.foot) {
        bean.root.position.x += (o.foot.x - bean.root.position.x) * k;
        bean.root.position.z += (o.foot.z - bean.root.position.z) * k;
        bean.root.position.y = this.ground(bean.root.position.x, bean.root.position.z);
      } else {
        const y = o.spot.level ? BUS.deck : BUS.floor;
        bean.root.position.x += (o.spot.side - bean.root.position.x) * k;
        bean.root.position.z += (-o.spot.along - bean.root.position.z) * k;
        bean.root.position.y += (y - bean.root.position.y) * Math.min(1, dt * 6);
      }
      bean.aim.rotation.y = o.yaw;
      bean.gun.rotation.x = o.pitch;
    }
  }

  // -------------------------------------------------------------------------------------------
  // The frame

  frame(dt: number) {
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    const f = this.input.poll(dt);
    const idle = this.paused || !!this.endEl;
    if (f.pause && !this.endEl) this.setPaused(!this.paused);
    if (this.run.stage !== this.legBuilt) this.enterLeg();
    if (!(this.paused && this.link.solo)) {
      this.moveBus(dt, idle || this.mini ? null : f);
      if (this.director) this.host(dt);
      if (!idle) this.act_(dt, f);
    }
    this.place(dt);
    this.sendAll(dt);
    this.checkEnd();
    this.post.feel(this.clock, Math.min(1, this.high / 3), this.hurt);
    this.post.render();
  }

  private moveBus(dt: number, f: Frame | null) {
    const b = this.bus;
    const driver = this.driver;
    if (driver === this.link.me || (driver === -1 && this.isHost)) {
      // Nobody at the wheel (or the driver's in a minigame or the menu): it rolls to a stop.
      const mine = driver === this.link.me && f && this.run.phase !== 'lost';
      const drive = mine ? { throttle: f.throttle, brake: f.brake, steer: f.steer, handbrake: f.handbrake } : b.v > 0.3 ? { ...NO_DRIVE, brake: 0.4 } : NO_DRIVE;
      const near = roadNear(this.route.road, b.x, b.z, this.roadHint);
      this.roadHint = near.i;
      // The hills under it (front wheels against back), the mud, an empty tank, the engine it's got.
      const fw = fwdOf(b.h);
      const span = 7;
      const grade = (this.ground(b.x + (fw.x * span) / 2, b.z + (fw.z * span) / 2) - this.ground(b.x - (fw.x * span) / 2, b.z - (fw.z * span) / 2)) / span;
      const haz = hazardAt(this.route, b.x, b.z);
      stepBus(b, drive, dt, { grade, onRoad: near.d < ROAD.half + 1, mud: haz?.kind === 'mud', fumes: this.run.fuel <= 0, power: powerOf(this.run) });
      // Potholes: a jolt that kills speed (the host takes the damage).
      this.route.hazards.forEach((h, i) => {
        if (h.kind !== 'pothole' || Math.abs(h.x - b.x) > 9 || Math.abs(h.z - b.z) > 9 || Math.abs(b.v) < 4) return;
        if (!onBus(b, h.x, h.z, h.r * 0.5) || this.clock - (this.jolted.get(i) ?? -9) < 2) return;
        this.jolted.set(i, this.clock);
        b.v *= HAZARD.potholeKeep;
        this.shake = 1;
        this.audio.play('bump', 1);
        this.api.rumble(1, 0.6, 250);
      });
      // The scenery, and the gate's bars until the checkpoint's cleared.
      const lost = collideBus(b, this.run.done ? this.route.obstacles : this.bars);
      if (lost > 3 && this.bumpT <= 0) {
        this.audio.play('bump', Math.min(1, lost / 12));
        this.api.rumble(0.6, 0.3, 150);
        this.bumpT = 0.4;
      }
      this.bumpT -= dt;
      if (this.timers.bus <= 0) {
        this.timers.bus = SEND.bus;
        this.link.send({ t: 'bus', x: round(b.x, 100), z: round(b.z, 100), h: round(b.h, 1000), v: round(b.v, 100), s: round(b.steer, 100), l: this.legBuilt });
      }
    } else if (this.busTarget) {
      // Smooth toward the driver's bus, running it on by its speed between messages.
      const t = this.busTarget;
      const tf = fwdOf(t.h);
      t.x += tf.x * t.v * dt;
      t.z += tf.z * t.v * dt;
      const k = Math.min(1, dt * 8);
      if (Math.hypot(t.x - b.x, t.z - b.z) > 15) Object.assign(b, t);
      b.x += (t.x - b.x) * k;
      b.z += (t.z - b.z) * k;
      b.h += angleDiff(t.h, b.h) * k;
      b.v = t.v;
      b.steer = t.steer;
    }
    this.audio.engineAt(b.v);
  }

  /** The host's work: run the director, send what changed. */
  private host(dt: number) {
    const d = this.director!;
    const walkers: Walker[] = [];
    if (this.foot) walkers.push({ id: this.link.me, ...this.foot });
    for (const [id, o] of this.others) if (o.foot) walkers.push({ id, ...o.foot });
    d.step(dt, this.bus, walkers);
    this.run = d.run;
    this.taken = d.taken;
    this.got = d.got;
    this.zs = d.zs.map((z) => ({ id: z.id, k: z.k, x: z.x, y: z.y, z: z.z, st: z.st, paint: z.paint }));
    for (const f of d.fx) this.showFx(f);
    for (const s of d.said) this.hud.say(s);
    this.fxOut.push(...d.fx);
    this.saidOut.push(...d.said);
    d.fx = [];
    d.said = [];
    const r = this.run;
    const key = `${r.phase}${r.stage}${r.done}${Math.floor(r.prog)}${r.cash.join()}${r.up.join()}${this.got.size}`;
    const changed = key !== this.runKey;
    this.runKey = key;
    if (this.timers.z <= 0) {
      this.timers.z = SEND.z;
      this.link.send({ t: 'z', z: packZombies(d.zs), fx: this.fxOut.slice(-50), said: this.saidOut.slice(-5) });
      this.fxOut = [];
      this.saidOut = [];
    }
    if (this.timers.run <= 0 || changed) {
      this.timers.run = SEND.run;
      this.link.send({ t: 'run', run: { ...r, busHp: Math.round(r.busHp), prog: round(r.prog, 10), time: round(r.time, 10), dist: Math.round(r.dist), fuel: round(r.fuel, 10), calm: round(r.calm, 10) }, taken: [...this.taken], got: [...this.got] });
    }
  }

  /** Tells the host something I did (or does it, if that's me). */
  private did(k: 'crate' | 'can' | 'ko', id = 0) {
    if (this.director) this.director.did(k, id, this.myPlace);
    else this.link.send({ t: 'do', k, id });
  }

  /** Your own doings: walk, climb, hop off and on, the wheel, aim, shoot, throw, swing, honk, use what's in reach. */
  private act_(dt: number, f: Frame) {
    this.high = Math.max(0, this.high - dt);
    this.tipsy = Math.max(0, this.tipsy - dt);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.hangT -= dt;
    if (this.koT > 0) {
      // Out cold on the bus floor.
      if ((this.koT -= dt) <= 0) this.hp = FOOT.wake;
      return;
    }
    if (!this.foot) this.hp = Math.min(FOOT.hp, this.hp + FOOT.regen * dt);
    if (this.driving !== this.wasDriving) {
      // Sat down at the wheel (look ahead) or got up from it (stand beside it).
      if (!this.driving) this.spot = { ...OFF_CAB };
      this.yaw = 0;
      this.pitch = -0.08;
      this.wasDriving = this.driving;
    }
    if (f.view && this.driving) this.chase = !this.chase;
    if (this.mini) {
      const gone = this.miniKind === 'golf' || this.miniKind === 'slots' ? !this.jobOpen(this.miniKind) : !!this.foot || this.driving;
      if (f.back || gone || (f.use && !this.mini.menu)) this.closeMini();
      else {
        this.mini.update(dt, f);
        if (this.miniKind === 'shop') this.drawShop();
      }
    } else {
      if (f.use) this.use();
      if (f.shop && !this.foot && !this.driving) this.openShop();
      if (f.seat && !this.foot && (this.driving || atCab(this.spot))) this.wantWheel(!this.driving);
      if (f.climb && !this.foot && !this.driving && atHatch(this.spot)) {
        this.spot.level = this.spot.level ? 0 : 1;
        this.audio.play('reload', 0.5);
      }
    }
    if (f.honk !== this.honking) {
      this.honking = f.honk;
      this.audio.horn(f.honk);
      if (f.honk) this.link.send({ t: 'honk' });
    }
    this.fireT -= dt;
    this.clubT -= dt;
    this.swingT -= dt;
    this.nadeT -= dt;
    if (this.ammo[this.gun] < 0) this.ammo[this.gun] = this.hopper();
    if (this.reloadT > 0 && (this.reloadT -= dt) <= 0) this.ammo[this.gun] = this.hopper();
    if (this.mini) return;
    this.pitch = Math.max(-1.1, Math.min(0.9, this.pitch + f.pitch));
    if (this.driving) {
      // Look round the cab; the wheel's in your hands.
      this.yaw = Math.max(-DRIVER.look, Math.min(DRIVER.look, this.yaw + f.yaw));
      return;
    }
    if (this.foot) {
      this.footYaw = (this.footYaw + f.yaw) % (Math.PI * 2);
      stepFoot(this.foot, f.fwd, f.side, this.footYaw, dt, this.run.done ? this.route.obstacles : this.bars, this.bus, this.route.stop, this.carrying ? FOOT.carry : 1);
      // Left behind: leg it back to the bus.
      if (Math.hypot(this.foot.x - this.bus.x, this.foot.z - this.bus.z) > FOOT.left) {
        this.board(false);
        this.hud.say('The bus left without you! You sprinted and jumped aboard.');
      }
    } else {
      this.yaw = (this.yaw + f.yaw) % (Math.PI * 2);
      walk(this.spot, f.fwd, f.side, this.yaw, dt);
    }
    if (this.carrying) return;
    if (f.gun && this.unlocked > 1) {
      this.gun = (this.gun + 1) % this.unlocked;
      this.reloadT = 0;
      this.fireT = 0.25;
      this.audio.play('reload', 0.6);
      this.hud.say(GUNS[this.gun].name.toUpperCase());
    }
    const ammo = this.ammo[this.gun];
    if ((f.reload && ammo < this.hopper()) || ammo <= 0) this.reload();
    if (f.fire && this.fireT <= 0 && ammo > 0 && this.reloadT <= 0) this.fire();
    if (f.nade && this.nades > 0 && this.nadeT <= 0) this.throwNade();
    if (f.swing && this.run.club && this.clubT <= 0) this.swing();
  }

  // -------------------------------------------------------------------------------------------
  // Using things: off and on the bus, the job's things, the bong, the cooler, the card table, the store

  /** Is the checkpoint's minigame there to be played? */
  private jobOpen(kind: 'golf' | 'slots') {
    return this.run.phase === 'stop' && !this.run.done && this.route.cp.job === kind;
  }

  /** The job's thing within reach of you on foot, if any. */
  private siteNear(): Site | null {
    if (!this.foot) return null;
    let best: Site | null = null;
    let bd: number = FOOT.reach;
    for (const s of this.route.sites) {
      if (s.kind === 'beacon' || (s.kind === 'crate' && this.got.has(s.id))) continue;
      const d = Math.hypot(s.x - this.foot.x, s.z - this.foot.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private use() {
    if (this.driving) return;
    const active = this.run.phase === 'stop' && !this.run.done;
    if (this.foot) {
      const near = canBoard(this.bus, this.foot.x, this.foot.z);
      if (this.carrying && near) {
        this.carrying = false;
        this.did('can');
        this.audio.play('fix');
        return;
      }
      const s = this.siteNear();
      if (s && active) {
        if (s.kind === 'crate') {
          // The host's `got` is the director's own set: ask first, then mark it.
          this.did('crate', s.id);
          this.got.add(s.id);
          this.audio.play('cash');
          // Now and then there's a paint grenade in the crate.
          if (this.nades < NADE.max && Math.random() < 0.35) {
            this.nades++;
            this.hud.say('A paint grenade in the crate! 💣');
          }
          return;
        }
        if (s.kind === 'pump' && !this.carrying) {
          this.carrying = true;
          this.audio.play('reload');
          return;
        }
        if (s.kind === 'tee' && this.jobOpen('golf')) return this.openMini('golf');
        if (s.kind === 'slot' && this.jobOpen('slots')) return this.openMini('slots');
      }
      if (near) this.board(true);
      return;
    }
    const hang = hangAt(this.spot);
    if (hang === 'table') return this.openTable();
    if (hang && this.hangT <= 0) {
      this.hangT = 2.5;
      if (hang === 'bong') {
        this.hp = Math.min(FOOT.hp, this.hp + HANG.bong.heal);
        this.high = Math.min(40, this.high + HANG.bong.high);
        this.audio.play('cough');
        this.hud.say(pick(['💨 That’s the stuff.', '💨 Bong tokes with the boys.', '💨 Everything is fine. Everything is zombies.']));
        this.link.send({ t: 'do', k: 'toke', id: 0 });
      } else {
        this.hp = Math.min(FOOT.hp, this.hp + HANG.cooler.heal);
        this.tipsy = Math.min(60, this.tipsy + HANG.cooler.tipsy);
        this.audio.play('burp');
        this.hud.say(pick(['🍺 Crisp.', '🍺 One for the road.', '🍺 *burp*']));
        this.link.send({ t: 'do', k: 'drink', id: 0 });
      }
      return;
    }
    if (hang) return;
    // Parked at the checkpoint: out of the nearer side.
    if (this.run.phase === 'stop' && this.spot.level === 0 && Math.abs(this.bus.v) < 2) {
      this.foot = hopOff(this.bus, this.spot);
      this.footYaw = this.bus.h + (this.spot.side >= 0 ? -Math.PI / 2 : Math.PI / 2);
      this.pitch = 0;
      this.audio.play('thunk', 0.5);
    }
  }

  /** Back on the bus (`sound`: you climbed; otherwise you were hauled). */
  private board(sound: boolean) {
    if (!this.foot) return;
    this.spot = hopOn(this.bus, this.foot.x, this.foot.z);
    this.yaw = this.footYaw - this.bus.h;
    this.foot = null;
    if (this.carrying) this.carrying = false;
    if (sound) this.audio.play('thunk', 0.5);
  }

  private openMini(k: 'golf' | 'slots') {
    const report = (v: number) => {
      if (this.director) this.director.mini(k, v, this.myPlace);
      else this.link.send({ t: 'mini', k, v });
    };
    this.show(k === 'golf' ? new Golf(() => report(1), this.audio, () => Math.floor(this.run.prog), this.run.need) : new Slots((v) => report(v), this.audio, () => Math.floor(this.run.prog), this.run.need), k);
  }

  private show(mini: Minigame, kind: NonNullable<Session['miniKind']>) {
    this.closeMini();
    this.mini = mini;
    this.miniKind = kind;
    this.stage.append(mini.el);
    if (mini.menu) {
      this.input.unlock();
      this.api.setMenuNav(true);
      (mini.el.querySelector('[data-autofocus]:not(:disabled)') as HTMLElement | null)?.focus();
    }
  }

  private closeMini() {
    if (!this.mini) return;
    // Getting up from a hand of poker forfeits it.
    if (this.miniKind === 'duel' && this.table.seats.includes(this.myPlace) && this.table.phase !== 'show') this.duelMove(this.myPlace, 'leave', 0);
    if (this.mini.menu && !this.paused) this.api.setMenuNav(false);
    this.mini.el.remove();
    this.mini = null;
    this.miniKind = null;
  }

  private panel(title: string, how: string) {
    const el = document.createElement('div');
    el.className = 'bd-mini bd-cards';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'bd-mini-how';
    p.textContent = how;
    const body = document.createElement('div');
    body.className = 'bd-cards-body';
    const out = document.createElement('p');
    out.className = 'bd-mini-out';
    out.textContent = 'Esc / Ⓑ: close';
    el.append(h, p, body, out);
    return { el, body };
  }

  /** The card table: which game? */
  private openTable() {
    const { el, body } = this.panel('THE CARD TABLE', 'Your own scrap is on the line. Win it here, spend it at the store.');
    const row = document.createElement('div');
    row.className = 'bd-cards-row';
    const bj = document.createElement('button');
    bj.className = 'bd-btn';
    bj.textContent = '🃏 Blackjack (against the dealer)';
    bj.dataset.autofocus = '';
    bj.onclick = () =>
      this.show(
        new Blackjack(
          () => this.cash,
          (delta) => {
            if (this.director) this.director.blackjack(delta, this.myPlace);
            else {
              this.link.send({ t: 'bj', v: delta });
              // Until the host's next word, so the table shows what you've got.
              this.run.cash[this.myPlace] = Math.max(0, this.cash + delta);
            }
          },
          this.audio,
        ),
        'bj',
      );
    const hu = document.createElement('button');
    hu.className = 'bd-btn';
    hu.textContent = '🤝 Heads-up poker (against a friend)';
    hu.disabled = this.link.crew.length < 2;
    hu.onclick = () => {
      const t = new DuelTable(this.myPlace, (who) => this.link.crew[who]?.name ?? 'Someone', () => this.cash, (m, n) => this.duelMove(this.myPlace, m, n), this.audio);
      this.show(t, 'duel');
      t.setView(this.table);
      t.setHand(this.myHand);
    };
    row.append(bj, hu);
    body.append(row);
    if (this.link.crew.length < 2) {
      const p = document.createElement('p');
      p.className = 'bd-cards-line';
      p.textContent = 'Heads-up needs a friend on the bus.';
      body.append(p);
    }
    this.show({ el, menu: true, update() {} }, 'table');
  }

  /** The store: scrap for the bus (everyone's better off) or for yourself. */
  private openShop() {
    const { el } = this.panel('THE STORE', 'Spend your own scrap. Upgrades are for the whole bus; grenades and bandages are yours.');
    this.shopKey = '';
    this.show({ el, menu: true, update() {} }, 'shop');
    this.drawShop();
  }

  private drawShop() {
    const body = this.mini?.el.querySelector('.bd-cards-body');
    if (!body) return;
    const r = this.run;
    const key = `${this.cash}|${r.up.join()}|${Math.round(r.busHp)}|${this.nades}|${Math.round(this.hp)}`;
    if (key === this.shopKey) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.k;
    this.shopKey = key;
    body.replaceChildren();
    const head = document.createElement('p');
    head.className = 'bd-cards-line';
    head.textContent = `Your scrap: 🔩 ${this.cash}`;
    body.append(head);
    const list = document.createElement('div');
    list.className = 'bd-shop';
    const item = (k: number, name: string, what: string, ok = true) => {
      const price = priceOf(r, k);
      const b = document.createElement('button');
      b.className = 'bd-btn bd-shop-item';
      b.dataset.k = String(k);
      const n = document.createElement('b');
      n.textContent = name;
      const w = document.createElement('span');
      w.textContent = what;
      const p = document.createElement('i');
      p.textContent = Number.isFinite(price) ? `🔩 ${price}` : 'MAXED';
      b.append(n, w, p);
      b.disabled = !ok || !(this.cash >= price);
      b.onclick = () => {
        if (this.director) this.director.buy(k, this.myPlace);
        else this.link.send({ t: 'buy', k });
      };
      list.append(b);
    };
    UPGRADES.forEach((u, k) => item(k, `${u.name}  ${'●'.repeat(r.up[k])}${'○'.repeat(u.max - r.up[k])}`, u.what));
    item(BUY.repair, 'Patch the bus', `+${REPAIR.hp} bus health`);
    item(BUY.nade, `Paint grenade  (you have ${this.nades})`, 'G / D-pad down to throw', this.nades < NADE.max);
    item(BUY.bandage, 'Bandage', 'Back to full health', this.hp < FOOT.hp - 1);
    body.append(list);
    const again = (focused && (list.querySelector(`[data-k="${focused}"]:not(:disabled)`) as HTMLElement | null)) || (list.querySelector('button:not(:disabled)') as HTMLElement | null);
    again?.focus();
  }

  // -------------------------------------------------------------------------------------------
  // Guns, grenades, the club

  private reload() {
    if (this.reloadT > 0) return;
    this.reloadT = reloadOf(this.run);
    this.audio.play('reload');
  }

  private aimDir(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  /** A ball's start (just ahead of the camera) and its velocity along `dir`, carried by the bus if you're on it. */
  private launch(dir: THREE.Vector3, speed: number) {
    const from = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.7);
    from.y -= 0.15;
    const v = dir.clone().multiplyScalar(speed);
    if (!this.foot) {
      const f = fwdOf(this.bus.h);
      v.x += f.x * this.bus.v;
      v.z += f.z * this.bus.v;
    }
    return { from, v };
  }

  private noteShot(from: THREE.Vector3, dir: THREE.Vector3) {
    if (this.act.shots.length < ACT_MAX.shots * 6)
      this.act.shots.push(Math.round(from.x * 10), Math.round(from.y * 10), Math.round(from.z * 10), Math.round(dir.x * 1000), Math.round(dir.y * 1000), Math.round(dir.z * 1000));
  }

  private fire() {
    const gun = GUNS[this.gun];
    this.fireT = 1 / gun.rate;
    this.ammo[this.gun]--;
    this.act.g = this.gun;
    const aim = this.aimDir();
    for (let k = 0; k < gun.pellets; k++) {
      // A little spread: paintball markers aren't rifles (the Long Tom nearly is).
      const dir = aim.clone();
      dir.x += (Math.random() - 0.5) * gun.spread * 2;
      dir.y += (Math.random() - 0.5) * gun.spread * 2;
      dir.z += (Math.random() - 0.5) * gun.spread * 2;
      dir.normalize();
      const { from, v } = this.launch(dir, GUN.speed * gun.speed);
      this.paint.fire(from, v, this.myPlace, true, GUN.life * (gun.splash ? 2.5 : 1), gun.gravity, gun.splash ? 2 : 1, this.gun);
      this.noteShot(from, dir);
    }
    this.audio.play(gun.pellets > 1 || gun.damage > 3 ? 'bump' : 'pop', 0.6);
    if (gun.pellets > 1 || gun.damage > 3) this.api.rumble(0.5, 0.3, 90);
    this.guns[this.gun].position.z = gun.damage > 3 || gun.pellets > 1 ? -0.36 : -0.44;
  }

  private throwNade() {
    this.nades--;
    this.nadeT = NADE.cooldown;
    const dir = this.aimDir();
    dir.y += NADE.lob;
    dir.normalize();
    const { from, v } = this.launch(dir, NADE.speed);
    this.paint.fire(from, v, this.myPlace, true, 5, NADE.gravity / GUN.gravity, 2.6, -1);
    this.audio.play('swing');
  }

  /** A grenade or a balloon bursts at `p`: everything within its splash is painted. */
  private burst(p: THREE.Vector3, k: number) {
    const r = k === -1 ? NADE.splash : GUNS[k].splash;
    const gy = this.ground(p.x, p.z);
    this.paint.splat(p.x, gy + 0.06, p.z, this.myPlace, true, r * 0.75);
    for (let i = 0; i < 6; i++) this.paint.splat(p.x + (Math.random() - 0.5) * r, gy + 0.5 + Math.random() * 2, p.z + (Math.random() - 0.5) * r, this.myPlace, false, 0.9);
    this.audio.play('boom', k === -1 ? 1 : 0.6);
    this.shake = Math.max(this.shake, 0.35);
    this.api.rumble(0.9, 0.6, 200);
    for (const z of this.zs) {
      if (z.st === 'dead' || z.st === 'fly' || Math.hypot(z.x - p.x, z.z - p.z) > r) continue;
      if (this.director) this.director.hit(z.id, this.myPlace, this.director.damageOf(k));
      else if (k === -1) this.act.boom.length < ACT_MAX.boom && this.act.boom.push(z.id);
      else if (this.act.hits.length < ACT_MAX.hits) this.act.hits.push(z.id);
    }
  }

  /** A paintball of mine: did it hit the bus's wall, a zombie or a pickup on the way from `from` to `b.p`? */
  private testBall(b: Ball, from: THREE.Vector3) {
    // From inside the bus it only gets out through a window.
    const a = this.busModel.worldToLocal(from.clone());
    const c = this.busModel.worldToLocal(b.p.clone());
    const wall = wallHit(a, c);
    if (wall) {
      const at = this.busModel.localToWorld(new THREE.Vector3(wall.x, wall.y, wall.z));
      this.paint.splat(at.x, at.y, at.z, b.c, false, 0.35);
      return true;
    }
    const splash = b.k === -1 || GUNS[b.k].splash > 0;
    for (const z of this.zs) {
      if (z.st === 'dead' || z.st === 'fly') continue;
      const s = this.horde.at(z.id) ?? z;
      const r = ZOMBIE[z.k].r + 0.3;
      const scale = z.k === 2 ? 1.45 : 1;
      const gy = this.ground(s.x, s.z) + s.y;
      // The zombie as a vertical capsule: test the ball's step against its axis.
      if (segToSeg(from, b.p, s.x, gy + 0.4 * scale, gy + 1.85 * scale, s.z) < r) {
        if (splash) {
          this.burst(b.p, b.k);
          return true;
        }
        this.paint.splat(b.p.x, b.p.y, b.p.z, b.c, false, 0.5);
        this.audio.play('splat', 0.5);
        if (this.director) this.director.hit(z.id, this.myPlace, this.director.damageOf(b.k));
        else if (this.act.hits.length < ACT_MAX.hits) this.act.hits.push(z.id);
        return true;
      }
    }
    for (const p of this.route.pickups) {
      if (this.taken.has(p.id) || Math.abs(p.x - b.p.x) > 3 || Math.abs(p.z - b.p.z) > 3) continue;
      const gy = this.ground(p.x, p.z);
      if (segToSeg(from, b.p, p.x, gy + 0.8, gy + 1.6, p.z) < 0.75) {
        if (this.director) this.director.grab(p.id);
        else if (this.act.grabs.length < ACT_MAX.grabs) this.act.grabs.push(p.id);
        this.taken.add(p.id);
        this.audio.play(p.kind === 'repair' ? 'fix' : 'cash');
        return true;
      }
    }
    return false;
  }

  private swing() {
    this.clubT = CLUB.cooldown;
    this.swingT = 0.35;
    this.audio.play('swing');
    const me = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.aimDir();
    const look = Math.atan2(dir.x, dir.z);
    const ids: number[] = [];
    for (const z of this.zs) {
      if (z.st !== 'run' && z.st !== 'climb') continue;
      if (this.foot ? Math.hypot(z.x - this.foot.x, z.z - this.foot.z) > CLUB.reach : !onBus(this.bus, z.x, z.z, CLUB.reach)) continue;
      const a = Math.atan2(z.x - me.x, z.z - me.z);
      if (Math.abs(angleDiff(a, look)) < CLUB.cone && ids.length < ACT_MAX.swing) ids.push(z.id);
    }
    if (!ids.length) return;
    this.audio.play('thunk');
    this.api.rumble(0.8, 0.4, 120);
    if (this.director) this.director.swing(ids, this.myPlace, this.bus, this.foot ?? undefined);
    else this.act.swing.push(...ids);
  }

  private wantWheel(want: boolean) {
    if (this.isHost) this.setDriver(takeWheel(this.driver, this.link.me, want));
    else this.link.send({ t: 'drive', want });
  }

  // -------------------------------------------------------------------------------------------
  // Drawing

  private place(dt: number) {
    const b = this.bus;
    // Over the hills: sit on the ground under its wheels, nose up a climb, leaning on a slope; jolted by potholes.
    const fw = fwdOf(b.h);
    const rt = rightOf(b.h);
    const g = (al: number, sd: number) => this.ground(b.x + fw.x * al + rt.x * sd, b.z + fw.z * al + rt.z * sd);
    const front = g(3.5, 0);
    const back = g(-3.5, 0);
    const left = g(0, -1.3);
    const right = g(0, 1.3);
    const k = Math.min(1, dt * 8);
    this.busY += ((front + back + left + right) / 4 - this.busY) * k;
    this.tilt.pitch += (Math.atan2(front - back, 7) - this.tilt.pitch) * k;
    this.tilt.roll += (Math.atan2(right - left, 2.6) - this.tilt.roll) * k;
    this.shake = Math.max(0, this.shake - dt * 3);
    const jolt = this.shake * Math.sin(this.clock * 40) * 0.12;
    this.busModel.position.set(b.x, this.busY + jolt, b.z);
    this.busModel.rotation.set(this.tilt.pitch + jolt * 0.2, b.h, this.tilt.roll - b.steer * Math.min(1, Math.abs(b.v) / 20) * 0.08, 'YXZ');
    this.busModel.children.forEach((c) => c.name === 'wheel' && (c.rotation.x -= (b.v * dt) / 0.55));
    if (this.steer) this.steer.rotation.z = -b.steer * 3;
    this.placeBeans(dt);
    if (this.run.gordie && !this.gordie) {
      // Gordie, fresh out of the cells, stands in the aisle in his orange jumpsuit and fires out of both sides.
      this.gordie = makeBean('#ff7a1a');
      this.gordie.root.position.set(0, BUS.floor, 0.6);
      this.busModel.add(this.gordie.root);
    }
    if (this.gordie) this.gordie.aim.rotation.y = Math.sin(this.clock * 0.8) * 1.6;
    this.world.update(this.clock, this.taken, this.got, this.run);
    // Lightning now and then (all the time in a storm), thunder a beat later.
    if ((this.boltT -= dt) <= 0) {
      const storm = this.route.cp.twist === 'storm';
      this.boltT = storm ? 4 + Math.random() * 7 : 20 + Math.random() * 40;
      this.sky.flash();
      this.thunderT = 0.4 + Math.random() * 0.9;
    }
    if (this.thunderT > 0 && (this.thunderT -= dt) <= 0) this.audio.play('thunder');
    this.horde.update(this.zs, dt, this.clock, this.ground);
    this.busModel.updateMatrixWorld();
    this.paint.update(dt, GUN.gravity, (ball, from) => this.testBall(ball, from), this.ground, (ball) => (ball.k === -1 || GUNS[ball.k].splash > 0) && this.burst(ball.p, ball.k));

    const gunner = !this.driving && this.koT <= 0;
    // A few beers in, the world sways.
    const sway = Math.min(1, this.tipsy / 20);
    const swayRoll = Math.sin(this.clock * 1.3) * 0.05 * sway;
    const swayYaw = Math.sin(this.clock * 0.9 + 1) * 0.04 * sway;
    if (this.foot) {
      // Off the bus, on your own two feet.
      const y = this.ground(this.foot.x, this.foot.z) + FOOT.eye;
      this.camera.position.set(this.foot.x, y, this.foot.z);
      this.camera.rotation.set(this.pitch, this.footYaw + swayYaw, swayRoll, 'YXZ');
    } else if (!(this.driving && this.chase)) {
      // First person on the bus: at the wheel, on your feet (inside, or up on the roof deck), or flat out on the floor.
      const p = this.driving
        ? new THREE.Vector3(DRIVER.side, BUS.floor + BUS.driverEye, -DRIVER.along)
        : new THREE.Vector3(this.spot.side, (this.spot.level ? BUS.deck : BUS.floor) + (this.koT > 0 ? 0.35 : BUS.eye), -this.spot.along);
      this.busModel.localToWorld(p);
      this.camera.position.copy(p);
      this.camera.rotation.set(this.pitch + this.tilt.pitch * 0.5, b.h + this.yaw + swayYaw, this.tilt.roll * 0.5 + swayRoll + (this.koT > 0 ? 1.2 : 0), 'YXZ');
    } else {
      // The chase camera, swinging round behind the bus.
      const want = new THREE.Vector3(b.x - fw.x * CHASE.back, this.busY + CHASE.up, b.z - fw.z * CHASE.back);
      const kc = Math.min(1, dt * 4);
      if (this.camera.position.distanceTo(want) > 60) this.camera.position.copy(want);
      else this.camera.position.lerp(want, kc);
      this.camera.lookAt(b.x + fw.x * CHASE.ahead, this.busY + 2, b.z + fw.z * CHASE.ahead);
    }
    this.camera.fov += (72 + Math.min(1, this.high / 3) * 9 * (1 + Math.sin(this.clock * 0.7) * 0.4) - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
    this.sky.update(this.camera, dt, this.viewH);
    const armed = gunner && this.swingT <= 0 && !this.mini && !this.carrying;
    this.guns.forEach((gm, i) => {
      gm.visible = armed && i === this.gun;
      gm.position.z += (-0.5 - gm.position.z) * Math.min(1, dt * 12);
      gm.position.y = -0.24 - (this.reloadT > 0 ? 0.2 : 0);
    });
    this.viewClub.visible = gunner && this.swingT > 0;
    if (this.swingT > 0) this.viewClub.rotation.set(0, 0, -2.4 + (1 - this.swingT / 0.35) * 3.6);

    // Zombies groan now and then, louder when close.
    const ear = this.foot ?? b;
    if ((this.groanT -= dt) <= 0) {
      this.groanT = 1.2 + Math.random() * 2;
      let near = Infinity;
      for (const z of this.zs) if (z.st === 'run' || z.st === 'climb') near = Math.min(near, Math.hypot(z.x - ear.x, z.z - ear.z));
      if (near < 40) this.audio.play('groan', 1 - near / 40);
    }

    // The HUD.
    const { stop, gate, cp } = this.route;
    const s = roadNear(this.route.road, b.x, b.z, this.roadHint).s;
    const to = this.run.done ? gate : stop;
    const look = this.foot ? this.footYaw : this.driving && this.chase ? b.h : b.h + this.yaw;
    const arrow = -angleDiff(Math.atan2(-(to.x - ear.x), -(to.z - ear.z)), look);
    this.hud.update(dt, {
      run: this.run,
      objective: objective(this.run, cp.job, cp.name),
      toStop: this.run.done ? Math.hypot(gate.x - b.x, gate.z - b.z) : Math.max(toGo(this.route, s), Math.hypot(stop.x - b.x, stop.z - b.z) - RUN.parkRadius),
      arrow,
      gunner,
      driver: this.driving,
      chase: this.chase,
      ammo: Math.max(0, this.ammo[this.gun]),
      hopper: this.hopper(),
      gun: GUNS[this.gun].name,
      nades: this.nades,
      hp: this.koT > 0 ? 0 : this.hp / FOOT.hp,
      cash: this.cash,
      onFoot: !!this.foot,
      carrying: this.carrying,
      ko: this.koT,
      place: `CHECKPOINT ${this.run.stage + 1} · ${cp.name} · ${BIOMES[cp.biome].name}`,
      reloading: this.reloadT > 0,
      club: this.clubT,
      bus: b,
      crew: this.link.crew.map((c, i) => ({
        name: c.name,
        driver: c.id === this.driver,
        me: c.id === this.link.me,
        color: paintOf(i),
        cash: this.run.cash[i] ?? 0,
        off: c.id === this.link.me ? !!this.foot : !!this.others.get(c.id)?.foot,
      })),
      locked: this.input.locked,
      busy: !!this.mini || this.paused || !!this.endEl,
      prompt: this.prompt(),
    });
    this.hud.drawMap(this.route, b, this.zs, this.got, this.run.done, this.foot);
  }

  /** What you can do right where you are (the big prompt). */
  private prompt() {
    if (this.mini || this.endEl) return '';
    if (this.koT > 0) return 'KNOCKED OUT! The boys dragged you back aboard…';
    const run = this.run;
    const active = run.phase === 'stop' && !run.done;
    if (this.foot) {
      const near = canBoard(this.bus, this.foot.x, this.foot.z);
      if (this.carrying) return near ? 'E / Ⓐ  POUR IT IN THE TANK' : 'Lug the can back to the bus';
      const s = active ? this.siteNear() : null;
      if (s?.kind === 'crate') return 'E / Ⓐ  GRAB THE CRATE';
      if (s?.kind === 'pump') return 'E / Ⓐ  GRAB A JERRY CAN';
      if (s?.kind === 'tee') return 'E / Ⓐ  TEE OFF';
      if (s?.kind === 'slot') return 'E / Ⓐ  HIT THE SLOTS';
      if (near) return run.done ? 'E / Ⓐ  CLIMB ABOARD: time to go' : 'E / Ⓐ  CLIMB ABOARD';
      const beacon = this.route.sites.find((q) => q.kind === 'beacon');
      if (active && beacon && Math.hypot(beacon.x - this.foot.x, beacon.z - this.foot.z) < BEACON_R) return 'Cranking the beacon… hold the ring!';
      return run.done ? 'Cleared! Back to the bus' : '';
    }
    if (this.driving) return active ? 'Parked. F / Ⓨ to get up, then E / Ⓐ to hop off' : '';
    if (atCab(this.spot)) return this.driver === -1 ? 'F / Ⓨ  DRIVE' : 'Someone’s driving';
    if (atHatch(this.spot)) return this.spot.level ? 'SPACE / Ⓑ  CLIMB DOWN' : 'SPACE / Ⓑ  CLIMB UP TO THE ROOF';
    const hang = hangAt(this.spot);
    if (hang === 'bong') return 'E / Ⓐ  RIP THE BONG';
    if (hang === 'cooler') return 'E / Ⓐ  CRACK A COLD ONE';
    if (hang === 'table') return 'E / Ⓐ  SIT AT THE CARD TABLE';
    if (this.driver === -1 && run.phase === 'drive') return 'Nobody’s driving! Get to the front (F / Ⓨ)';
    if (run.phase === 'stop' && this.spot.level === 0) return active ? 'E / Ⓐ  HOP OFF THE BUS' : 'E / Ⓐ  HOP OFF  ·  B  STORE';
    return '';
  }

  /** A popup or a splat from the director. */
  private showFx(f: Fx) {
    const at = new THREE.Vector3(f.x, f.y, f.z).project(this.camera);
    const onScreen = at.z < 1 && Math.abs(at.x) < 1.1 && Math.abs(at.y) < 1.1;
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    const sx = onScreen ? ((at.x + 1) / 2) * W : W / 2;
    const sy = onScreen ? ((1 - at.y) / 2) * H : H * 0.4;
    const ear = this.foot ?? this.bus;
    const vol = Math.max(0, 1 - Math.hypot(f.x - ear.x, f.z - ear.z) / 80);
    const mine = f.w === this.myPlace;
    if (f.k === 'yeet') {
      if (onScreen) this.hud.pop(pick(['YEET!', 'YOINK!', 'BYE!', 'SPLAT!', 'BONK!']), sx, sy, '#ffe14a', true);
      this.audio.play('yeet', vol);
      this.paint.splat(f.x, this.ground(f.x, f.z) + 0.05, f.z, 3, true, 1.2);
    } else if (f.k === 'fore') {
      if (onScreen) this.hud.pop('FORE!', sx, sy, '#7cff5b', true);
      this.audio.play('fore', vol);
    } else if (f.k === 'splat') {
      if (f.n !== this.myPlace) this.paint.splat(f.x, f.y, f.z, f.n, false, 0.5);
    } else if (f.k === 'gordie') {
      const from = new THREE.Vector3(0, BUS.floor + BUS.eye, 0.6);
      this.busModel.localToWorld(from);
      const v = new THREE.Vector3(f.x, f.y, f.z).sub(from);
      const t = v.length() / GUN.speed;
      v.divideScalar(Math.max(t, 0.01));
      v.y += (GUN.gravity * t) / 2;
      this.paint.fire(from, v, GORDIE_PAINT, false, t + 0.05);
      this.audio.play('pop', vol * 0.5);
      if (Math.random() < 0.08) this.hud.say(pick(['GORDIE: “I’m never going back!”', 'GORDIE: “Who wants bong tokes?”', 'GORDIE: “Jail food was better than this.”']));
    } else if (f.k === 'grab') {
      const p = this.route.pickups[f.n];
      if (p?.kind === 'scrap' && onScreen) this.hud.pop(`+${RUN.scrap} 🔩 EACH`, sx, sy, '#7cff5b');
      if (p?.kind === 'gas') this.hud.pop('+GAS ⛽', sx, sy, '#ffb03a', true);
      if (p) this.audio.play(p.kind === 'repair' ? 'fix' : 'cash', Math.max(0.3, vol));
      this.taken.add(f.n);
    } else if (f.k === 'bump') {
      if (onScreen) this.hud.pop(`POTHOLE! −${f.n}`, sx, sy, '#ff8a8a');
      this.shake = Math.max(this.shake, 0.6);
    } else if (f.k === 'round') {
      this.audio.play('bell');
    } else if (f.k === 'heal') {
      this.hud.pop(f.n > 0 ? `+${f.n} BUS 🔧` : 'BUS ALREADY FULL', sx, sy, f.n > 0 ? '#5ee06a' : '#c8c8d8', f.n > 0);
      if (f.n > 0) this.hud.flashHp();
    } else if (f.k === 'shake') {
      if (onScreen) this.hud.pop('SHAKEN OFF!', sx, sy, '#2fd3ff');
    } else if (f.k === 'bite') {
      // `w` is the bitten player's id.
      if (f.w !== this.link.me) return void (onScreen && this.hud.pop('CHOMP!', sx, sy, '#ff5a5a'));
      if (!this.foot || this.koT > 0) return;
      this.hp -= f.n;
      this.hurt = 1;
      this.audio.play('bite');
      this.api.rumble(1, 0.5, 180);
      if (this.hp <= 0) this.knockedOut();
    } else if (f.k === 'crate') {
      if (mine || onScreen) this.hud.pop(`+${f.n} 🔩`, sx, sy, '#ffe14a', mine);
    } else if (f.k === 'can') {
      this.hud.pop(`+${f.n} FUEL ⛽`, sx, sy, '#ffb03a', true);
      this.audio.play('fix', 0.6);
    } else if (f.k === 'clear') {
      this.hud.pop(`CLEARED! +${f.n} 🔩 EACH`, W / 2, H * 0.3, '#3aff8a', true);
      this.audio.play('jingle');
      this.bars = this.route.obstacles;
    } else if (f.k === 'buy') {
      this.audio.play('cash', 0.6);
      if (f.n < UPGRADES.length) this.hud.say(`${UPGRADES[f.n].name.toUpperCase()} fitted to the bus!`);
      if (!mine) return;
      if (f.n === BUY.nade) this.nades = Math.min(NADE.max, this.nades + 1);
      if (f.n === BUY.bandage) this.hp = FOOT.hp;
    }
  }

  /** Bitten down to nothing: hauled back aboard, out cold for a bit, lighter of pocket. */
  private knockedOut() {
    this.koT = FOOT.ko;
    this.hp = 0;
    this.carrying = false;
    this.foot = null;
    this.spot = startSpot(this.myPlace);
    this.yaw = 0;
    this.closeMini();
    this.did('ko');
    this.audio.play('lose', 0.6);
  }

  private sendAll(dt: number) {
    for (const k of Object.keys(this.timers) as (keyof typeof this.timers)[]) this.timers[k] -= dt;
    if (!this.driving && this.timers.aim <= 0) {
      this.timers.aim = SEND.aim;
      const s = this.spot;
      if (this.foot) this.link.send({ t: 'aim', yaw: round(this.footYaw, 100), pitch: round(this.pitch, 100), s: round(this.foot.x, 10), a: round(this.foot.z, 10), l: 2, ...(this.carrying ? { c: true } : {}) });
      else this.link.send({ t: 'aim', yaw: round(this.yaw, 100), pitch: round(this.pitch, 100), s: round(s.side, 100), a: round(s.along, 100), l: s.level });
    }
    const a = this.act;
    if (this.timers.act <= 0 && (a.shots.length || a.hits.length || a.grabs.length || a.swing.length || a.boom.length)) {
      this.timers.act = SEND.act;
      a.c = this.myPlace;
      this.link.send(a);
      this.act = newAct();
      this.act.g = this.gun;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pause and the end

  private setPaused(on: boolean) {
    this.paused = on;
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.api.setMenuNav(on || !!this.mini?.menu);
    if (!on) return;
    this.input.unlock();
    const el = document.createElement('div');
    el.className = 'bd-pause';
    const h = document.createElement('h2');
    h.textContent = this.link.solo ? 'PAUSED' : 'MENU';
    const resume = document.createElement('button');
    resume.textContent = 'Back to the bus';
    resume.dataset.autofocus = '';
    resume.onclick = () => this.setPaused(false);
    const looks = document.createElement('button');
    const label = () => (looks.textContent = `Graphics: ${this.post.fancy ? 'Fancy (glow, shadows, colour)' : 'Fast'}`);
    label();
    looks.onclick = () => {
      this.post.setFancy(!this.post.fancy);
      label();
    };
    const leave = document.createElement('button');
    leave.textContent = 'Leave the run';
    leave.onclick = () => this.onLeave();
    const how = document.createElement('p');
    how.textContent =
      'Drive to each checkpoint and park in the ring. E/Ⓐ hops off the bus: do the job on foot (crates, jerry cans, the beacon, the tee box, the slots), climb back aboard (E/Ⓐ at the bus) and drive on through the gate into the next world. No finish line: how far can you get? On foot or on the bus: WASD or the left stick walks, mouse or right stick aims, click/RT shoots, R/Ⓧ reloads, Q/D-pad→ next gun, G/D-pad↓ grenade, V/RB club. On the bus: Space/Ⓑ at the hatch for the roof, B/D-pad↑ the store, E/Ⓐ at the bong, the cooler or the card table, F/Ⓨ at the front to drive. Driving: W/S or RT/LT, A/D or the stick, Space/Ⓧ handbrake, H/LB horn, C/View chase cam.';
    el.append(h, resume, looks, leave, how);
    this.stage.append(el);
    resume.focus();
  }

  private checkEnd() {
    if (this.endEl || this.run.phase !== 'lost') return;
    this.input.unlock();
    this.closeMini();
    this.audio.horn(false);
    this.audio.play('lose');
    this.api.setMenuNav(true);
    const run = this.run;
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_KEY)) || 0;
      if (run.stage > best) localStorage.setItem(BEST_KEY, String(run.stage));
    } catch {
      /* private mode: no best kept */
    }
    const el = document.createElement('div');
    el.className = 'bd-end lost';
    const h = document.createElement('h1');
    h.textContent = 'THE BUS IS TOAST';
    const sub = document.createElement('p');
    sub.className = 'bd-end-sub';
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    sub.textContent = `You cleared ${n(run.stage, 'checkpoint', 'checkpoints')}${run.stage > best ? (best ? ` (your best was ${best}!)` : '. A new best!') : best ? ` (best: ${best})` : ''}. Kingston is still 40 km away. It’s always 40 km away.`;
    const stats = document.createElement('p');
    stats.className = 'bd-end-stats';
    const m = Math.floor(run.time / 60);
    const s = Math.floor(run.time % 60);
    stats.textContent = `${m}:${String(s).padStart(2, '0')} survived · ${(run.dist / 1000).toFixed(1)} km · round ${run.round} · ${n(run.kills, 'zombie', 'zombies')} · ${n(run.yeets, 'yeet', 'yeets')}${run.gordie ? ' · Gordie freed' : ''}`;
    el.append(h, sub, stats);
    if (this.isHost) {
      const again = document.createElement('button');
      again.textContent = 'Go again (a new road)';
      again.dataset.autofocus = '';
      again.onclick = () => this.onAgain();
      el.append(again);
    } else {
      const wait = document.createElement('p');
      wait.textContent = 'Waiting for the host to go again…';
      el.append(wait);
    }
    const leave = document.createElement('button');
    leave.textContent = 'Leave';
    leave.onclick = () => this.onLeave();
    el.append(leave);
    this.endEl = el;
    this.stage.append(el);
    (el.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.input.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.horde.dispose();
    this.paint.dispose();
    this.sky.dispose();
    this.post.dispose();
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(o as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
    });
    this.stage.remove();
  }
}

const newAct = (): Act => ({ t: 'act', c: 0, shots: [], hits: [], grabs: [], swing: [], g: 0, boom: [] });
const round = (v: number, k: number) => Math.round(v * k) / k;
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** a − b, wrapped to (−π, π]. */
function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Closest distance between segment p→q and the vertical segment at (x, z) from y0 to y1. */
function segToSeg(p: THREE.Vector3, q: THREE.Vector3, x: number, y0: number, y1: number, z: number) {
  let best = Infinity;
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    const px = p.x + (q.x - p.x) * t;
    const py = p.y + (q.y - p.y) * t;
    const pz = p.z + (q.z - p.z) * t;
    const cy = Math.max(y0, Math.min(y1, py));
    best = Math.min(best, Math.hypot(px - x, py - cy, pz - z));
  }
  return best;
}
