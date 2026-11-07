// One run on this screen: the bus, the road, the horde, your seat (driving it from the cab, or shooting out of a window, all
// in first person), the stops'
// minigames, the HUD and the end screen. Every browser runs a Session; the host's also runs the Director (the
// zombies, the stops, the money) and sends what it decides. Solo is the same with nobody else.
//
// Who moves the bus: the driver's browser (seat 0) simulates it and sends its pose; everyone else smooths toward that.
// With nobody driving, the host lets it coast to a stop.

import * as THREE from 'three';
import { Audio } from './audio.ts';
import { Director, GORDIE_PAINT, packZombies, unpackZombies, type Fx, type ZView } from './director.ts';
import { Hud } from './hud.ts';
import { Input, type Frame } from './input.ts';
import { Golf, Slots, type Minigame } from './minigames.ts';
import { Horde, Paint, makeBean, makeBus, makeClub, makeMarker, paintOf, type Bean } from './models.ts';
import { ACT_MAX, takeSeat, type Act, type Msg } from './net.ts';
import { ROAD, makeRoute, roadNear, toGo, type Route } from './route.ts';
import {
  BUS,
  CLUB,
  GUN,
  LOOK,
  NO_DRIVE,
  RUN,
  SEATS,
  ZOMBIE,
  collideBus,
  fwdOf,
  objective,
  onBus,
  stepBus,
  stopOf,
  type Bus,
  type RunState,
} from './rules.ts';
import { World } from './world.ts';
import type { GameApi } from '../types.ts';

/** How this screen talks to the others (a party, or nobody in solo). */
export interface Link {
  me: number;
  hostId: number;
  /** Everyone in the run, in join order (their paint colours follow it). */
  crew: { id: number; name: string }[];
  /** To everyone else. */
  send(m: Msg): void;
  solo: boolean;
}

const SEND = { bus: 1 / 15, aim: 1 / 6, act: 1 / 10, z: 1 / 10, run: 1 / 3 };
const CHASE = { back: 15, up: 7.5, ahead: 9 };

export class Session {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
  private route: Route;
  private world: World;
  private busModel = makeBus();
  private horde = new Horde();
  private paint = new Paint();
  private audio = new Audio();
  private input: Input;
  private hud: Hud;
  private director: Director | null = null;
  private sky: ReturnType<typeof World.dress>;
  /** Seconds to the next lightning strike, and to its thunder. */
  private boltT = 9;
  private thunderT = -1;

  private bus: Bus = { x: 0, z: 0, h: 0, v: 0, steer: 0 };
  /** The driver's last pose (for smoothing on everyone else's screen). */
  private busTarget: Bus | null = null;
  private run: RunState;
  private taken = new Set<number>();
  private zs: ZView[] = [];
  private seats: number[];
  private aims = new Map<number, { yaw: number; pitch: number }>();
  private beans = new Map<number, { bean: Bean; seat: number }>();
  private gordie: Bean | null = null;

  private yaw = 0;
  /** The seat the look was last set up for (a new seat looks its own way). */
  private lookSeat = -2;
  /** The driver's camera: false in the cab (first person), true chasing the bus. */
  private chase = false;
  private steer: THREE.Object3D | null = null;
  private pitch = -0.1;
  private ammo: number = GUN.hopper;
  private reloadT = 0;
  private fireT = 0;
  private clubT = 0;
  private swingT = 0;
  private viewGun: THREE.Group;
  private viewClub = makeClub();

  private mini: Minigame | null = null;
  private miniKind: 'golf' | 'casino' | null = null;
  private paused = false;
  private pauseEl: HTMLElement | null = null;
  private endEl: HTMLElement | null = null;
  private act: Act = { t: 'act', c: 0, shots: [], hits: [], grabs: [], swing: [] };
  private timers = { bus: 0, aim: 0, act: 0, z: 0, run: 0 };
  private fxOut: Fx[] = [];
  private saidOut: string[] = [];
  private honking = false;
  private clock = 0;
  private roadHint = 0;
  private lastPhase = '';
  private lastStage = 0;
  private bumpT = 0;
  private groanT = 2;
  private offs: (() => void)[] = [];
  private stage: HTMLElement;

  constructor(
    root: HTMLElement,
    private renderer: THREE.WebGLRenderer,
    private link: Link,
    seed: number,
    seats: number[],
    private api: GameApi,
    private onLeave: () => void,
    private onAgain: () => void,
  ) {
    this.route = makeRoute(seed);
    this.world = new World(this.route);
    this.seats = seats;
    if (this.isHost) this.director = new Director(this.route, seed, link.crew.length);
    this.run = this.director?.run ?? { ...new Director(this.route, seed).run };
    const start = this.route.road[2];
    Object.assign(this.bus, { x: start.x, z: start.z, h: start.h });

    this.sky = World.dress(this.scene);
    this.scene.add(this.world.group, this.busModel, this.horde.group, this.paint.group, this.camera);
    this.viewGun = makeMarker(paintOf(this.myColor));
    this.viewGun.scale.setScalar(0.5);
    this.viewGun.position.set(0.24, -0.24, -0.5);
    this.viewClub.position.set(0.35, -0.2, -0.6);
    this.viewClub.visible = false;
    this.camera.add(this.viewGun, this.viewClub);
    this.steer = this.busModel.getObjectByName('steer') ?? null;

    this.stage = document.createElement('div');
    this.stage.className = 'bd-stage';
    root.append(this.stage);
    this.stage.append(renderer.domElement);
    this.hud = new Hud(this.stage);
    this.input = new Input(renderer.domElement, api);
    this.syncBeans();

    const onClick = () => {
      this.audio.wake();
      if (!this.paused && !this.endEl) this.input.lock();
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
    this.hud.say('You wake up at the paintball arena. Everything is… zombies?');
    api.setMenuNav(false);
  }

  private get isHost() {
    return this.link.me === this.link.hostId;
  }
  private get mySeat() {
    return this.seats.indexOf(this.link.me);
  }
  private get driving() {
    return this.mySeat === 0;
  }
  private get myColor() {
    return Math.max(0, this.link.crew.findIndex((c) => c.id === this.link.me));
  }
  private colorOf(id: number) {
    return Math.max(0, this.link.crew.findIndex((c) => c.id === id));
  }

  private resize() {
    const w = this.stage.clientWidth || innerWidth;
    const h = this.stage.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  /** A message from another screen. */
  onMsg(from: number, m: Msg) {
    const fromHost = from === this.link.hostId;
    switch (m.t) {
      case 'bus':
        if (from === this.seats[0]) this.busTarget = { x: m.x, z: m.z, h: m.h, v: m.v, steer: m.s };
        break;
      case 'aim':
        this.aims.set(from, { yaw: m.yaw, pitch: m.pitch });
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
        break;
      case 'seats':
        if (!fromHost) return;
        this.seats = m.seats;
        this.syncBeans();
        break;
      case 'seat':
        if (this.isHost) this.setSeats(takeSeat(this.seats, from, m.want));
        break;
      case 'mini':
        this.director?.mini(m.k, m.v);
        break;
      case 'honk':
        this.audio.play('horn', 0.7);
        break;
    }
  }

  private onAct(from: number, a: Act) {
    // Their paintballs, for show (the hits come in the same message).
    for (let i = 0; i + 5 < a.shots.length; i += 6) {
      const p = new THREE.Vector3(a.shots[i] / 10, a.shots[i + 1] / 10, a.shots[i + 2] / 10);
      const d = new THREE.Vector3(a.shots[i + 3], a.shots[i + 4], a.shots[i + 5]).divideScalar(1000);
      const v = d.multiplyScalar(GUN.speed);
      const f = fwdOf(this.bus.h);
      v.x += f.x * this.bus.v;
      v.z += f.z * this.bus.v;
      this.paint.fire(p, v, a.c, false, GUN.life);
    }
    if (a.shots.length) this.audio.play('pop', 0.25);
    const d = this.director;
    if (!d) return;
    const c = this.colorOf(from);
    for (const id of a.hits) d.hit(id, c);
    for (const id of a.grabs) d.grab(id);
    if (a.swing.length) d.swing(a.swing, c, this.bus);
  }

  /** Players who left the party lose their seat (the host's call). */
  dropMissing(ids: ReadonlySet<number>) {
    if (!this.isHost) return;
    const seats = this.seats.map((id) => (id >= 0 && !ids.has(id) ? -1 : id));
    if (seats.some((id, i) => id !== this.seats[i])) this.setSeats(seats);
  }

  private setSeats(seats: number[]) {
    this.seats = seats;
    this.link.send({ t: 'seats', seats });
    this.syncBeans();
  }

  /** The beans on the bus match the seats (and Gordie, once he's free). */
  private syncBeans() {
    const want = new Map<number, number>();
    this.seats.forEach((id, seat) => id >= 0 && want.set(id, seat));
    for (const [id, b] of this.beans)
      if (want.get(id) !== b.seat) {
        this.busModel.remove(b.bean.root);
        this.beans.delete(id);
      }
    for (const [id, seat] of want) {
      if (this.beans.has(id)) continue;
      const bean = makeBean(paintOf(this.colorOf(id)), seat === 0);
      const s = SEATS[seat];
      // Standing at their window (the driver sits, a little lower).
      bean.root.position.set(s.side, seat === 0 ? BUS.floor - 0.25 : BUS.floor, -s.along);
      bean.aim.rotation.y = s.face;
      this.busModel.add(bean.root);
      this.beans.set(id, { bean, seat });
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
    if (!(this.paused && this.link.solo)) {
      this.moveBus(dt, idle || this.mini ? null : f);
      if (this.director) this.host(dt);
      if (!idle) this.act_(dt, f);
    }
    this.place(dt);
    this.sendAll(dt);
    this.checkEnd();
    this.renderer.render(this.scene, this.camera);
  }

  private moveBus(dt: number, f: Frame | null) {
    const b = this.bus;
    const driver = this.seats[0];
    if (driver === this.link.me || (driver === -1 && this.isHost)) {
      // Nobody at the wheel (or the driver's in a minigame or the menu): it rolls to a stop.
      const mine = driver === this.link.me && f && this.run.phase !== 'won' && this.run.phase !== 'lost';
      const drive = mine ? { throttle: f.throttle, brake: f.brake, steer: f.steer, handbrake: f.handbrake } : b.v > 0.3 ? { ...NO_DRIVE, brake: 0.4 } : NO_DRIVE;
      const near = roadNear(this.route.road, b.x, b.z, this.roadHint);
      this.roadHint = near.i;
      stepBus(b, drive, dt, near.d < ROAD.half + 1);
      const lost = collideBus(b, this.route.obstacles);
      if (lost > 3 && this.bumpT <= 0) {
        this.audio.play('bump', Math.min(1, lost / 12));
        this.api.rumble(0.6, 0.3, 150);
        this.bumpT = 0.4;
      }
      this.bumpT -= dt;
      if (this.timers.bus <= 0) {
        this.timers.bus = SEND.bus;
        this.link.send({ t: 'bus', x: round(b.x, 100), z: round(b.z, 100), h: round(b.h, 1000), v: round(b.v, 100), s: round(b.steer, 100) });
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
    d.step(dt, this.bus);
    this.run = d.run;
    this.taken = d.taken;
    this.zs = d.zs.map((z) => ({ id: z.id, k: z.k, x: z.x, y: z.y, z: z.z, st: z.st, paint: z.paint }));
    for (const f of d.fx) this.showFx(f);
    for (const s of d.said) this.hud.say(s);
    this.fxOut.push(...d.fx);
    this.saidOut.push(...d.said);
    d.fx = [];
    d.said = [];
    const changed = this.run.phase + this.run.stage !== this.lastPhase + this.lastStage;
    if (this.timers.z <= 0) {
      this.timers.z = SEND.z;
      this.link.send({ t: 'z', z: packZombies(d.zs), fx: this.fxOut.slice(-50), said: this.saidOut.slice(-5) });
      this.fxOut = [];
      this.saidOut = [];
    }
    if (this.timers.run <= 0 || changed) {
      this.timers.run = SEND.run;
      this.link.send({ t: 'run', run: { ...this.run, busHp: Math.round(this.run.busHp), hold: round(this.run.hold, 10), time: round(this.run.time, 10) }, taken: [...this.taken] });
    }
  }

  /** Your own doings: aim, shoot, swing, seats, honks, the stop's minigame. */
  private act_(dt: number, f: Frame) {
    const gunner = this.mySeat > 0;
    if (this.mySeat !== this.lookSeat) {
      // A new seat: look the way it faces.
      this.lookSeat = this.mySeat;
      this.yaw = 0;
      this.pitch = this.mySeat === 0 ? -0.08 : -0.12;
    }
    if (f.view && this.driving) this.chase = !this.chase;
    if (this.mini) {
      if (f.use || f.back || !this.miniOpen()) this.closeMini();
      else this.mini.update(dt, f);
    } else {
      if (f.use && this.miniOpen()) this.openMini();
      if (f.seat) this.wantSeat(this.driving ? -1 : 0);
    }
    if (f.honk !== this.honking) {
      this.honking = f.honk;
      this.audio.horn(f.honk);
      if (f.honk) this.link.send({ t: 'honk' });
    }
    this.fireT -= dt;
    this.clubT -= dt;
    this.swingT -= dt;
    if (this.reloadT > 0 && (this.reloadT -= dt) <= 0) this.ammo = GUN.hopper;
    if (this.mini || this.mySeat < 0) return;
    // Look round: the driver round the cab, everyone else out of their window.
    const reach = this.driving ? LOOK.driver : LOOK.window;
    this.yaw = Math.max(-reach, Math.min(reach, this.yaw + f.yaw));
    this.pitch = Math.max(-1.0, Math.min(0.8, this.pitch + f.pitch));
    if (!gunner) return;
    if ((f.reload && this.ammo < GUN.hopper) || this.ammo <= 0) this.reload();
    if (f.fire && this.fireT <= 0 && this.ammo > 0 && this.reloadT <= 0) this.fire();
    if (f.swing && this.run.club && this.clubT <= 0) this.swing();
  }

  private reload() {
    if (this.reloadT > 0) return;
    this.reloadT = GUN.reload;
    this.audio.play('reload');
  }

  private aimDir(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  private fire() {
    this.fireT = 1 / GUN.rate;
    this.ammo--;
    const dir = this.aimDir();
    // A little spread: paintball markers aren't rifles.
    dir.x += (Math.random() - 0.5) * 0.025;
    dir.y += (Math.random() - 0.5) * 0.025;
    dir.normalize();
    const from = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.7);
    from.y -= 0.15;
    const v = dir.clone().multiplyScalar(GUN.speed);
    const f = fwdOf(this.bus.h);
    v.x += f.x * this.bus.v;
    v.z += f.z * this.bus.v;
    this.paint.fire(from, v, this.myColor, true, GUN.life);
    this.audio.play('pop', 0.6);
    this.viewGun.position.z = -0.44;
    if (this.act.shots.length < ACT_MAX.shots * 6)
      this.act.shots.push(Math.round(from.x * 10), Math.round(from.y * 10), Math.round(from.z * 10), Math.round(dir.x * 1000), Math.round(dir.y * 1000), Math.round(dir.z * 1000));
  }

  /** A paintball of mine: did it hit a zombie or a pickup on the way from `from` to `b.p`? */
  private testBall(b: { p: THREE.Vector3; c: number }, from: THREE.Vector3) {
    for (const z of this.zs) {
      if (z.st === 'dead' || z.st === 'fly') continue;
      const s = this.horde.at(z.id) ?? z;
      const r = ZOMBIE[z.k].r + 0.3;
      const scale = z.k === 2 ? 1.45 : 1;
      // The zombie as a vertical capsule: test the ball's step against its axis.
      if (segToSeg(from, b.p, s.x, s.y + 0.4 * scale, s.y + 1.85 * scale, s.z) < r) {
        this.paint.splat(b.p.x, b.p.y, b.p.z, b.c, false, 0.5);
        this.audio.play('splat', 0.5);
        if (this.director) this.director.hit(z.id, this.myColor);
        else if (this.act.hits.length < ACT_MAX.hits) this.act.hits.push(z.id);
        return true;
      }
    }
    for (const p of this.route.pickups) {
      if (this.taken.has(p.id) || Math.abs(p.x - b.p.x) > 3 || Math.abs(p.z - b.p.z) > 3) continue;
      if (segToSeg(from, b.p, p.x, 0.8, 1.6, p.z) < 0.75) {
        if (this.director) this.director.grab(p.id);
        else if (this.act.grabs.length < ACT_MAX.grabs) this.act.grabs.push(p.id);
        this.taken.add(p.id);
        this.audio.play(p.kind === 'cash' ? 'cash' : 'fix');
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
      if (!onBus(this.bus, z.x, z.z, CLUB.reach)) continue;
      const a = Math.atan2(z.x - me.x, z.z - me.z);
      if (Math.abs(angleDiff(a, look)) < CLUB.cone && ids.length < ACT_MAX.swing) ids.push(z.id);
    }
    if (!ids.length) return;
    this.audio.play('thunk');
    this.api.rumble(0.8, 0.4, 120);
    if (this.director) this.director.swing(ids, this.myColor, this.bus);
    else this.act.swing.push(...ids);
  }

  private wantSeat(want: number) {
    if (this.isHost) this.setSeats(takeSeat(this.seats, this.link.me, want));
    else this.link.send({ t: 'seat', want });
  }

  /** Is there a minigame to play right here, right now? */
  private miniOpen() {
    const k = stopOf(this.run);
    return this.run.phase === 'stop' && (k === 'golf' || k === 'casino');
  }

  private openMini() {
    const k = stopOf(this.run) as 'golf' | 'casino';
    const report = (v: number) => {
      if (this.director) this.director.mini(k, v);
      else this.link.send({ t: 'mini', k, v });
    };
    this.mini = k === 'golf' ? new Golf(() => report(1), this.audio, () => this.run.teed, RUN.golfTees) : new Slots((v) => report(v), this.audio, () => this.run.money, RUN.bail);
    this.miniKind = k;
    this.stage.append(this.mini.el);
  }

  private closeMini() {
    this.mini?.el.remove();
    this.mini = null;
    this.miniKind = null;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing

  private place(dt: number) {
    const b = this.bus;
    this.busModel.position.set(b.x, 0, b.z);
    this.busModel.rotation.set(0, b.h, -b.steer * Math.min(1, Math.abs(b.v) / 20) * 0.08);
    this.busModel.children.forEach((c) => c.name === 'wheel' && (c.rotation.x -= (b.v * dt) / 0.55));
    if (this.steer) this.steer.rotation.z = -b.steer * 3;
    // Everyone else at their windows, turning as they aim (yaw relative to their seat's direction).
    for (const [id, { bean, seat }] of this.beans) {
      bean.root.visible = id !== this.link.me || (this.driving && this.chase);
      const a = this.aims.get(id);
      if (a && seat > 0) {
        bean.aim.rotation.y = SEATS[seat].face + a.yaw;
        bean.gun.rotation.x = a.pitch;
      }
    }
    if (this.run.gordie && !this.gordie) {
      // Gordie, fresh out of the cells, stands in the aisle in his orange jumpsuit and fires out of both sides.
      this.gordie = makeBean('#ff7a1a');
      this.gordie.root.position.set(0, BUS.floor, 0.6);
      this.busModel.add(this.gordie.root);
    }
    if (this.gordie) this.gordie.aim.rotation.y = Math.sin(this.clock * 0.8) * 1.6;
    this.world.update(this.clock, this.taken, this.run.phase === 'won' ? -1 : this.run.stage);
    this.sky.update(this.camera, dt);
    // Lightning now and then, thunder a beat later.
    if ((this.boltT -= dt) <= 0) {
      this.boltT = 16 + Math.random() * 26;
      this.sky.flash();
      this.thunderT = 0.4 + Math.random() * 0.9;
    }
    if (this.thunderT > 0 && (this.thunderT -= dt) <= 0) this.audio.play('thunder');
    this.horde.update(this.zs, dt, this.clock);
    this.paint.update(dt, GUN.gravity, (ball, from) => this.testBall(ball, from));

    const gunner = this.mySeat > 0;
    if (this.mySeat >= 0 && !(this.driving && this.chase)) {
      // First person: at the wheel, or at your window.
      this.busModel.updateMatrixWorld();
      const s = SEATS[this.mySeat];
      const p = new THREE.Vector3(s.side, BUS.floor + (this.driving ? BUS.driverEye : BUS.eye), -s.along);
      this.busModel.localToWorld(p);
      this.camera.position.copy(p);
      this.camera.rotation.set(this.pitch, b.h + s.face + this.yaw, 0, 'YXZ');
    } else {
      // The chase camera, swinging round behind the bus.
      const f = fwdOf(b.h);
      const want = new THREE.Vector3(b.x - f.x * CHASE.back, CHASE.up, b.z - f.z * CHASE.back);
      const k = Math.min(1, dt * 4);
      if (this.camera.position.distanceTo(want) > 60) this.camera.position.copy(want);
      else this.camera.position.lerp(want, k);
      this.camera.lookAt(b.x + f.x * CHASE.ahead, 2, b.z + f.z * CHASE.ahead);
    }
    this.viewGun.visible = gunner && this.swingT <= 0 && !this.mini;
    this.viewClub.visible = gunner && this.swingT > 0;
    if (this.swingT > 0) this.viewClub.rotation.set(0, 0, -2.4 + (1 - this.swingT / 0.35) * 3.6);
    this.viewGun.position.z += (-0.5 - this.viewGun.position.z) * Math.min(1, dt * 12);
    this.viewGun.position.y = -0.24 - (this.reloadT > 0 ? 0.2 : 0);

    // Zombies groan now and then, louder when close.
    if ((this.groanT -= dt) <= 0) {
      this.groanT = 1.2 + Math.random() * 2;
      let near = Infinity;
      for (const z of this.zs) if (z.st === 'run' || z.st === 'climb') near = Math.min(near, Math.hypot(z.x - b.x, z.z - b.z));
      if (near < 40) this.audio.play('groan', 1 - near / 40);
    }

    // The HUD.
    const stop = this.route.stops[this.run.stage];
    const s = roadNear(this.route.road, b.x, b.z, this.roadHint).s;
    let arrow = 0;
    if (stop) {
      const look = this.mySeat >= 0 && !(this.driving && this.chase) ? b.h + SEATS[this.mySeat].face + this.yaw : b.h;
      arrow = -angleDiff(Math.atan2(-(stop.x - b.x), -(stop.z - b.z)), look);
    }
    this.hud.update(dt, {
      run: this.run,
      objective: objective(this.run),
      toStop: stop ? Math.max(toGo(this.route, this.run.stage, s), Math.hypot(stop.x - b.x, stop.z - b.z) - RUN.parkRadius) : 0,
      arrow,
      gunner,
      driver: this.driving,
      chase: this.chase,
      ammo: this.ammo,
      reloading: this.reloadT > 0,
      club: this.clubT,
      bus: b,
      crew: this.link.crew.map((c) => ({ name: c.name, seat: this.seats.indexOf(c.id), me: c.id === this.link.me, color: paintOf(this.colorOf(c.id)) })),
      locked: this.input.locked,
      busy: !!this.mini || this.paused || !!this.endEl,
    });
    this.hud.drawMap(this.route, b, this.zs, this.run.stage);
    if (this.miniKind && !this.miniOpen()) this.closeMini();
    if (this.run.phase !== this.lastPhase || this.run.stage !== this.lastStage) {
      if (this.run.stage > this.lastStage && this.lastStage > 0) this.audio.play('win');
      this.lastPhase = this.run.phase;
      this.lastStage = this.run.stage;
    }
  }

  /** A popup or a splat from the director. */
  private showFx(f: Fx) {
    const at = new THREE.Vector3(f.x, f.y, f.z).project(this.camera);
    const onScreen = at.z < 1 && Math.abs(at.x) < 1.1 && Math.abs(at.y) < 1.1;
    const sx = ((at.x + 1) / 2) * this.stage.clientWidth;
    const sy = ((1 - at.y) / 2) * this.stage.clientHeight;
    const dist = Math.hypot(f.x - this.bus.x, f.z - this.bus.z);
    const vol = Math.max(0, 1 - dist / 80);
    if (f.k === 'yeet') {
      if (onScreen) this.hud.pop(pick(['YEET!', 'YOINK!', 'BYE!', 'SPLAT!', 'BONK!']), sx, sy, '#ffe14a', true);
      this.audio.play('yeet', vol);
      this.paint.splat(f.x, 0.04, f.z, 3, true, 1.2);
    } else if (f.k === 'fore') {
      if (onScreen) this.hud.pop('FORE!', sx, sy, '#7cff5b', true);
      this.audio.play('fore', vol);
    } else if (f.k === 'splat') {
      if (f.n !== this.myColor) this.paint.splat(f.x, f.y, f.z, f.n, false, 0.5);
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
      if (p?.kind === 'cash' && onScreen) this.hud.pop(`+$${RUN.cash}`, sx, sy, '#7cff5b');
      if (p) this.audio.play(p.kind === 'cash' ? 'cash' : 'fix', Math.max(0.3, vol));
      this.taken.add(f.n);
    } else if (f.k === 'heal') {
      this.hud.pop(f.n > 0 ? `+${f.n} BUS 🔧` : 'BUS ALREADY FULL', onScreen ? sx : this.stage.clientWidth / 2, onScreen ? sy : this.stage.clientHeight * 0.4, f.n > 0 ? '#5ee06a' : '#c8c8d8', f.n > 0);
      if (f.n > 0) this.hud.flashHp();
    } else if (f.k === 'shake') {
      if (onScreen) this.hud.pop('SHAKEN OFF!', sx, sy, '#2fd3ff');
    }
  }

  private sendAll(dt: number) {
    for (const k of Object.keys(this.timers) as (keyof typeof this.timers)[]) this.timers[k] -= dt;
    if (this.mySeat > 0 && this.timers.aim <= 0) {
      this.timers.aim = SEND.aim;
      this.link.send({ t: 'aim', yaw: round(this.yaw % (Math.PI * 2), 100), pitch: round(this.pitch, 100) });
    }
    const a = this.act;
    if (this.timers.act <= 0 && (a.shots.length || a.hits.length || a.grabs.length || a.swing.length)) {
      this.timers.act = SEND.act;
      a.c = this.myColor;
      this.link.send(a);
      this.act = { t: 'act', c: 0, shots: [], hits: [], grabs: [], swing: [] };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pause and the end

  private setPaused(on: boolean) {
    this.paused = on;
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.api.setMenuNav(on);
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
    const leave = document.createElement('button');
    leave.textContent = 'Leave the run';
    leave.onclick = () => this.onLeave();
    const how = document.createElement('p');
    how.textContent = 'Driver: W/S or RT/LT, A/D or the stick, Space/Ⓧ handbrake, H/LB horn. Roof: mouse or right stick to aim, click/RT to shoot, R/Ⓧ reload, V/RB club. F/Ⓨ swaps seats; E/Ⓐ plays a stop’s game.';
    el.append(h, resume, leave, how);
    this.stage.append(el);
    resume.focus();
  }

  private checkEnd() {
    if (this.endEl || (this.run.phase !== 'won' && this.run.phase !== 'lost')) return;
    const won = this.run.phase === 'won';
    this.input.unlock();
    this.closeMini();
    this.audio.horn(false);
    this.audio.play(won ? 'jingle' : 'lose');
    this.api.setMenuNav(true);
    const el = document.createElement('div');
    el.className = `bd-end ${won ? 'won' : 'lost'}`;
    const h = document.createElement('h1');
    h.textContent = won ? 'BONG TOKES WITH THE BOYS' : 'THE BUS IS TOAST';
    const sub = document.createElement('p');
    sub.className = 'bd-end-sub';
    sub.textContent = won ? 'You made it home. The apocalypse can wait. 💨💨💨' : 'So close to the bong. So far from home.';
    const stats = document.createElement('p');
    stats.className = 'bd-end-stats';
    const m = Math.floor(this.run.time / 60);
    const s = Math.floor(this.run.time % 60);
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    stats.textContent = `${m}:${String(s).padStart(2, '0')} · ${n(this.run.kills, 'zombie', 'zombies')} · ${n(this.run.yeets, 'yeet', 'yeets')} · $${this.run.money} left${this.run.gordie ? ' · Gordie freed' : ''}`;
    el.append(h, sub, stats);
    if (this.isHost) {
      const again = document.createElement('button');
      again.textContent = 'Go again (new map)';
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
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(o as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose();
    });
    this.stage.remove();
  }
}

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
