// A race: the fixed-tick car simulation (yours, plus AI rivals in a solo race), remote cars interpolated
// from snapshots online, chase/hood/bumper cameras, the HUD, sound, tyre smoke and skids, rumble, and the
// finish (results and prize money).

import * as THREE from 'three';
import { CARS, type CarSpec, type OwnedCar, PAINTS, carSpec, decodeCar, encodeCar, newOwnedCar, CAR_IDS, rating } from '../../shared/race/cars.ts';
import { type Ai, aiDrive, newAi } from '../../shared/race/driver.ts';
import { CarFlag, type NetCar, type RaceServerMsg, type Racer } from '../../shared/race/protocol.ts';
import { type Track, type TrackId, getTrack, gridSlot } from '../../shared/race/track.ts';
import { type Assists, type Car, DEFAULT_ASSISTS, type DriveInput, TICK_DT, collideCars, forwardSpeed, newCar, resetCar, speedOf, stepCar, wheelLocal, yawOf } from '../../shared/race/vehicle.ts';
import { rumble, setMenuNav } from '../pad.ts';
import { esc } from '../menu/ui.ts';
import { Engine, RaceAudio, VOLUMES, loadVolume } from './audio.ts';
import { type CarModel, buildCar } from './carmodel.ts';
import { Effects } from './effects.ts';
import { garage } from './garageStore.ts';
import { type Dot, type ResultLine, RaceHud, fmtTime, money, ordinal } from './hud.ts';
import { DriveControls } from './input.ts';
import type { RaceNet } from './racenet.ts';
import { buildTrackView, type TrackView } from './trackview.ts';

export interface RaceSetup {
  container: HTMLElement;
  track: TrackId;
  name: string;
  car: OwnedCar;
  /** Online: the lobby socket and the countdown it just sent. */
  online?: { net: RaceNet; grid: Record<number, number>; countdownMs: number; racers: Racer[] };
  /** Solo: how many AI rivals. */
  rivals?: number;
  onExit(to: 'garage' | 'lobby', notice?: string): void;
}

type Phase = 'countdown' | 'racing' | 'finished' | 'done';
type Cam = 'chase' | 'near' | 'hood' | 'bumper';
const CAMS: Cam[] = ['chase', 'near', 'hood', 'bumper'];
const SEND_HZ = 20;
const INTERP_DELAY = 0.12;
const SOLO_COUNTDOWN = 3.5;
const SOLO_WAIT_AFTER = 15;

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
}

interface Remote {
  id: number;
  name: string;
  code: string;
  color: string;
  model: CarModel;
  spec: CarSpec;
  engine: Engine | null;
  buf: { t: number; c: NetCar }[];
  /** A stand-in Car (pose only) for bumping into. */
  ghost: Car;
  s: number;
  finished: number | null;
  spin: number;
  rpm: number;
}

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

export class RaceGame {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(62, 1, 0.2, 9000);
  private view: TrackView;
  private track: Track;
  private hud: RaceHud;
  private audio: RaceAudio;
  private fx: Effects;
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
  private phase: Phase = 'countdown';
  private countdown: number;
  private lastBeep = 99;
  private time = 0;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private paused = false;
  private sendAcc = 0;
  private offNet: (() => void) | null = null;
  private resetAt = 0;
  private finishedAt = 0;
  private myPrize: number | null = null;
  private puffTick = 0;
  private rumbleAt = 0;
  private lastGear = 1;
  private wallClock = 0;
  private exited = false;

  constructor(private setup: RaceSetup) {
    this.track = getTrack(setup.track);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'race-canvas';
    setup.container.appendChild(this.renderer.domElement);
    this.view = buildTrackView(this.track, this.renderer);
    this.renderer.toneMappingExposure = this.view.exposure;
    this.fx = new Effects(this.view.scene);
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
    };
  }

  private addRemote(r: Racer) {
    const owned = decodeCar(r.car) ?? newOwnedCar('pebble');
    const model = buildCar(owned);
    this.view.scene.add(model.root);
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
      buf: [],
      ghost,
      s: g.s,
      finished: null,
      spin: 0,
      rpm: spec.idle,
    });
  }

  // --- network ---------------------------------------------------------------------------------

  private onNet(m: RaceServerMsg) {
    const now = performance.now() / 1000;
    if (m.t === 'go') this.go();
    else if (m.t === 'snap') {
      for (const c of m.cars) {
        const r = this.remotes.get(c.id);
        if (!r) continue;
        r.buf.push({ t: now, c });
        if (r.buf.length > 30) r.buf.shift();
        r.s = c.s;
      }
    } else if (m.t === 'finished') {
      const r = this.remotes.get(m.id);
      if (r) {
        r.finished = m.time;
        if (this.phase !== 'done') this.hud.banner(`${r.name} finished`, fmtTime(m.time), 2000);
      }
    } else if (m.t === 'results') this.onlineResults(m.rows.map((r) => ({ place: r.place, name: r.name, car: r.car, time: r.time, prize: r.prize, me: r.id === this.setup.online!.net.id })));
    else if (m.t === 'room') {
      // Someone left mid-race: drop their car.
      for (const id of [...this.remotes.keys()])
        if (!m.racers.some((r) => r.id === id)) {
          const r = this.remotes.get(id)!;
          this.view.scene.remove(r.model.root);
          r.model.dispose();
          r.engine?.stop();
          this.remotes.delete(id);
        }
      if (m.phase === 'lobby' && this.phase === 'done') this.exit('lobby');
    } else if (m.t === 'error') this.exit('garage', m.message);
  }

  private send() {
    const net = this.setup.online?.net;
    if (!net) return;
    const c = this.me.car;
    const f = (this.me.input.brake > 0.1 ? CarFlag.Brake : 0) | (c.gear < 0 ? CarFlag.Reverse : 0) | (c.wheels.some((w) => w.slip > 1.1) ? CarFlag.Skid : 0) | (c.wheels.some((w) => w.surf === 'grass') ? CarFlag.Offroad : 0);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    net.send({
      t: 'state',
      p: [r(c.p.x), r(c.p.y), r(c.p.z)],
      q: [r(c.q.x), r(c.q.y), r(c.q.z), r(c.q.w)],
      v: [r(c.v.x), r(c.v.y), r(c.v.z)],
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
    const dt = Math.min(0.1, (now - this.last) / 1000);
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
      Object.assign(myInput, { steer: 0, throttle: this.paused ? 0 : this.controls.input.throttle, brake: 1, handbrake: 1 });
    } else if (me.finished !== null || this.phase === 'done') {
      aiDrive(me.car, t, me.ai ?? (me.ai = newAi(0.8, 0)), TICK_DT, myInput);
      myInput.throttle = 0;
      myInput.brake = Math.max(myInput.brake, 0.5);
    } else if (this.paused) Object.assign(myInput, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
    else {
      const c = this.controls.input;
      myInput.steer = c.steer;
      myInput.throttle = c.throttle;
      myInput.brake = c.brake;
      myInput.handbrake = c.handbrake;
    }
    for (const r of this.rivals) {
      if (this.phase === 'countdown') Object.assign(r.input, { steer: 0, throttle: Math.random() < 0.02 ? 1 : r.input.throttle * 0.95, brake: 1, handbrake: 1 });
      else aiDrive(r.car, t, r.ai!, TICK_DT, r.input);
    }
    // Step
    for (const r of [me, ...this.rivals]) {
      r.prevP.set(r.car.p.x, r.car.p.y, r.car.p.z);
      r.prevQ.set(r.car.q.x, r.car.q.y, r.car.q.z, r.car.q.w);
      const assists = r === me ? this.assists : DEFAULT_ASSISTS;
      stepCar(r.car, r.input, t, assists);
      r.input.shiftUp = r.input.shiftDown = false;
    }
    // Bumps
    const all = [me, ...this.rivals];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) collideCars(all[i].car, all[j].car, true);
    for (const r of this.remotes.values()) collideCars(me.car, r.ghost, false);
    if (me.car.hit > 2.5) {
      this.audio.impact(me.car.hit);
      rumble(Math.min(1, me.car.hit / 10), 0.5, 180);
    }
    if (me.car.gear !== this.lastGear) {
      if (live) this.audio.shift();
      this.lastGear = me.car.gear;
    }
    // Clock and finishing
    if (live && me.finished === null) this.time += TICK_DT;
    if (live && me.finished === null && me.car.s >= t.finishS) this.finish();
    for (const r of this.rivals) if (r.finished === null && (this.phase === 'racing' || this.phase === 'finished') && r.car.s >= t.finishS) r.finished = this.time + (me.finished === null ? 0 : this.wallClock - this.finishedAt);
    if (!this.setup.online && this.phase === 'finished') {
      const waiting = this.rivals.some((r) => r.finished === null);
      if (!waiting || this.wallClock - this.finishedAt > SOLO_WAIT_AFTER) void this.soloResults();
    }
    // Network
    if (this.setup.online && (live || this.phase === 'countdown' || this.phase === 'finished')) {
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
    this.audio.beep(true);
    this.hud.countdown('GO!');
    setTimeout(() => this.hud.countdown(null), 900);
    for (const r of [this.me, ...this.rivals]) r.car.gear = 1;
  }

  private finish() {
    const me = this.me;
    me.finished = this.time;
    this.finishedAt = this.wallClock;
    this.phase = 'finished';
    const ahead = [...this.rivals.filter((r) => r.finished !== null), ...[...this.remotes.values()].filter((r) => r.finished !== null)].length;
    this.hud.banner(`${ordinal(ahead + 1)} place`, fmtTime(this.time), 0);
    rumble(0.6, 0.9, 400);
    this.setup.online?.net.send({ t: 'finish', time: this.time });
  }

  private async soloResults() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const field = [this.me, ...this.rivals];
    const done = field.filter((r) => r.finished !== null).sort((a, b) => a.finished! - b.finished!);
    const dnf = field.filter((r) => r.finished === null).sort((a, b) => b.car.s - a.car.s);
    const myPlace = done.indexOf(this.me) + 1;
    const res = await garage.act({ a: 'solo', track: this.setup.track, place: myPlace, field: field.length });
    this.myPrize = res.ok ? (res.paid ?? 0) : 0;
    const lines: ResultLine[] = [...done, ...dnf].map((r, i) => ({ place: r.finished !== null ? i + 1 : 0, name: r.name, car: r.code, time: r.finished, prize: r === this.me ? this.myPrize! : 0, me: r === this.me }));
    const note = res.ok ? `You won ${money(this.myPrize)}` : `No prize: ${res.error === 'Too soon.' ? 'solo races pay at most once every 45 s' : res.error}`;
    const p = this.hud.panel(`${this.hud.resultsHtml(this.setup.track === 'koripass' ? 'Kōri Pass' : 'Saltwind Cliffs', lines)}
      <p class="rh-note">${esc(note)}</p>
      <div class="rh-buttons"><button data-act="again" data-autofocus>Race again</button><button data-act="garage">Garage</button></div>`);
    setMenuNav(true);
    p.querySelector('[data-act="again"]')!.addEventListener('click', () => this.restart());
    p.querySelector('[data-act="garage"]')!.addEventListener('click', () => this.exit('garage'));
  }

  private onlineResults(lines: ResultLine[]) {
    this.phase = 'done';
    const mine = lines.find((l) => l.me);
    if (mine) garage.credit(mine.prize, mine.place === 1 && lines.length > 1);
    const p = this.hud.panel(`${this.hud.resultsHtml('Results', lines)}
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
          case 'abs':
          case 'tcs':
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

  private poseRemote(r: Remote, now: number, dt: number) {
    const t = now - INTERP_DELAY;
    const b = r.buf;
    if (!b.length) return;
    let a = b[0];
    let c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++)
      if (b[i].t <= t && b[i + 1].t >= t) {
        a = b[i];
        c = b[i + 1];
        break;
      }
    const k = c.t > a.t ? Math.min(1.5, Math.max(0, (t - a.t) / (c.t - a.t))) : 1;
    const p = new THREE.Vector3(...a.c.p).lerp(new THREE.Vector3(...c.c.p), k);
    const q = new THREE.Quaternion(...a.c.q).slerp(new THREE.Quaternion(...c.c.q), Math.min(1, k));
    r.model.root.position.copy(p);
    r.model.root.quaternion.copy(q);
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
    this.updateCamera(dt);
    this.view.follow(this.camera.position.x, me.car.p.y, this.camera.position.z, now);
    this.sound();
    this.updateHud();
    this.renderer.render(this.view.scene, this.camera);
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
      const marking = w.contact && w.slip > 1.35 && sp > 2 && w.surf !== 'grass';
      const smoking = w.contact && w.slip > 1.8 && sp > 2 && w.surf !== 'grass';
      const dirt = w.contact && w.surf === 'grass' && sp > 4;
      this.fx.mark(idx * 4 + i, wp.x, wp.y, wp.z, rx, rz, 0.22, marking ? Math.min(1, (w.slip - 1.2) * 1.2) : 0);
      if ((smoking && this.puffTick % 3 === 0) || (dirt && this.puffTick % 4 === 0)) this.fx.puff(wp.x, wp.y, wp.z, c.v.x, c.v.z, Math.min(1.5, w.slip - 1.5), dirt);
    });
  }

  private updateCamera(dt: number) {
    const c = this.me.car;
    const root = this.me.model.root;
    const speed = speedOf(c);
    const b = CARS[c.spec.id];
    const back = this.controls.lookBack;
    if (this.cam === 'hood' || this.cam === 'bumper') {
      const local = this.cam === 'hood' ? new THREE.Vector3(0, b.height - c.spec.cg + 0.05, -0.15) : new THREE.Vector3(0, 0.7 - c.spec.cg, -b.length / 2 + 0.1);
      this.camera.position.copy(local.applyMatrix4(root.matrixWorld));
      const ahead = new THREE.Vector3(0, local.y - 0.4, back ? 50 : -50).applyMatrix4(root.matrixWorld);
      this.camera.lookAt(ahead);
      this.camera.fov = 70 + Math.min(14, speed * 0.18);
    } else {
      const near = this.cam === 'near';
      const dist = (near ? 4.8 : 6.8) + b.length * 0.35;
      const height = (near ? 1.7 : 2.4) + b.height * 0.25;
      // Trail along the direction of travel (blending toward the nose at low speed), so slides show.
      const yaw = yawOf(c);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const vs = Math.hypot(c.v.x, c.v.z);
      const blend = Math.min(1, vs / 15) * 0.55;
      let dx = fx * (1 - blend) + (vs > 0.5 ? (c.v.x / vs) * blend : 0);
      let dz = fz * (1 - blend) + (vs > 0.5 ? (c.v.z / vs) * blend : 0);
      if (forwardSpeed(c) < -1) {
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
      pos.y = Math.max(pos.y, root.position.y - c.spec.cg + 0.8);
      const look = new THREE.Vector3(root.position.x + cdx * 4, root.position.y + 0.9, root.position.z + cdz * 4);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 14));
      this.camera.position.copy(pos);
      // A little shake at speed and on impacts.
      const shake = Math.min(0.04, speed * 0.0004) + Math.min(0.2, c.hit * 0.02);
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.camera.lookAt(this.camLook);
      this.camera.fov = 60 + Math.min(18, speed * 0.22);
    }
    this.camera.updateProjectionMatrix();
  }

  private snapCamera() {
    const c = this.me.car;
    const yaw = yawOf(c);
    this.camDir.set(-Math.sin(yaw), -Math.cos(yaw));
    this.camLook.set(c.p.x, c.p.y + 0.9, c.p.z);
    this.me.model.root.updateMatrixWorld();
  }

  private sound() {
    this.audio.resume();
    const me = this.me.car;
    this.me.engine?.update(me.rpm, me.load, me.spec.redline, 1);
    const cam = this.camera.position;
    const near = (x: number, y: number, z: number) => Math.max(0, 1 - Math.hypot(x - cam.x, y - cam.y, z - cam.z) / 90) ** 2;
    for (const r of this.rivals) r.engine?.update(r.car.rpm, r.car.load, r.car.spec.redline, near(r.car.p.x, r.car.p.y, r.car.p.z));
    for (const r of this.remotes.values()) {
      const p = r.model.root.position;
      r.engine?.update(r.rpm, 0.6, r.spec.redline, near(p.x, p.y, p.z));
    }
    const slip = Math.max(...me.wheels.map((w) => (w.contact && w.surf !== 'grass' ? w.slip : 0)));
    const off = me.wheels.filter((w) => w.contact && w.surf === 'grass').length / 4;
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
    // Place: finishers by time, then everyone else by distance down the road.
    const entries = [
      { me: true, f: me.finished, s: c.s },
      ...this.rivals.map((r) => ({ me: false, f: r.finished, s: r.car.s })),
      ...[...this.remotes.values()].map((r) => ({ me: false, f: r.finished, s: r.s })),
    ].sort((a, b) => (a.f !== null && b.f !== null ? a.f - b.f : a.f !== null ? -1 : b.f !== null ? 1 : b.s - a.s));
    this.hud.update({
      speed: speedOf(c),
      rpm: c.rpm,
      redline: c.spec.redline,
      gear: c.gear,
      shifting: c.shift > 0,
      place: entries.findIndex((e) => e.me) + 1,
      field: entries.length,
      time: me.finished ?? this.time,
      abs: c.absOn,
      tcs: c.tcsOn,
      wrongWay: this.phase === 'racing' && tangentDot < -0.3 && speedOf(c) > 3,
      manual: !this.assists.auto,
      heading: yaw,
      dots,
    });
  }

  private resize = () => {
    const w = this.setup.container.clientWidth || innerWidth;
    const h = this.setup.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
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
    this.view.dispose();
    this.audio.close();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    setMenuNav(true);
  }
}
