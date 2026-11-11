// One climb on this screen: the fixed-step movement sim for my climber, the first-person camera (bob, landing dip,
// wall-run roll, speed FOV), checkpoints, falls into the sea, the clock, sending my state and drawing everyone
// else's, the HUD, the pause menu, and the frame itself (bloom on High, straight to the screen on Low).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { frameGate, graphics, LOW_PIXEL_RATIO, setGraphics } from '../../client/graphics.ts';
import type { GameApi } from '../types.ts';
import { Audio } from './audio.ts';
import { Climber, jacketOf } from './avatar.ts';
import { type Course, heightShare, progress, spawnFor } from './course.ts';
import { Hud } from './hud.ts';
import { Input, saveSens } from './input.ts';
import { type Body, eyeHeight, hspeed, type Input as MoveInput, MOVE, newBody, step } from './move.ts';
import { ANIM, type Anim, clock, type Msg, r2 } from './net.ts';
import { LOOK, Scenery } from './world.ts';

export interface Member {
  id: number;
  name: string;
  seat: number;
}

export interface Link {
  me: number;
  solo: boolean;
  isHost(): boolean;
  send(m: Msg, to?: number): void;
  /** Host: start a new climb for everyone. */
  restart(): void;
  leave(): void;
}

/** Feel of the first-person camera. */
export const CAM = {
  fov: 80,
  fovFast: 12,
  bob: 0.045,
  sway: 0.025,
  dipPerImpact: 0.018,
  dipMax: 0.32,
  wallRoll: 0.16,
  slideRoll: 0.05,
  sendHz: 15,
  countdown: 3,
} as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class Session {
  private scenery: Scenery;
  private camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.05, 12000);
  private composer: EffectComposer | null = null;
  private input: Input;
  private hud: Hud;
  private audio = new Audio();
  private body: Body;
  private prev = new THREE.Vector3();
  private acc = 0;
  private yaw = 0;
  private pitch = 0;
  private cp = -1;
  private run = 0;
  /** ms climbed (null before the start), and when this climb started (performance.now). */
  private t0: number | null = null;
  private countdown = 0;
  private finishedMs: number | null = null;
  private results = new Map<number, number>();
  private others = new Map<number, Climber>();
  private crew: Member[] = [];
  private sendT = 0;
  private bobPhase = 0;
  private stepPhase = 0;
  private dip = 0;
  private dipV = 0;
  private roll = 0;
  private fovK = 0;
  private respawnT = 0;
  private lastFloor: Body['floor'] = null;
  private paused = false;
  private pauseEl: HTMLElement | null = null;
  private gate: (now: number) => boolean;
  private offs: (() => void)[] = [];
  private now = 0;
  private hintT = 25;
  private gullT = 6;
  private jumpTapPending = false;
  private high: boolean;

  constructor(
    private root: HTMLElement,
    private renderer: THREE.WebGLRenderer,
    private course: Course,
    private link: Link,
    private api: GameApi,
    crew: Member[],
  ) {
    this.high = graphics() === 'high';
    this.now = performance.now();
    this.gate = frameGate(60);
    this.setupRenderer();
    this.scenery = new Scenery(renderer, course, { high: this.high });
    this.setupPost();
    root.append(renderer.domElement);
    this.input = new Input(renderer.domElement, api);
    const shares = course.checkpoints.map((c) => heightShare(course, c.spawn[1]));
    this.hud = new Hud(root, shares);
    this.body = newBody(...course.start.spawn);
    this.yaw = course.start.yaw;
    this.prev.set(this.body.x, this.body.y, this.body.z);
    this.setCrew(crew);
    api.setMenuNav(false);

    const click = () => {
      this.audio.start();
      if (!this.paused) this.input.lock();
    };
    renderer.domElement.addEventListener('click', click);
    this.offs.push(() => renderer.domElement.removeEventListener('click', click));
    // Esc: the pause menu (in the capture phase, so the site doesn't treat it as Back).
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.setPaused(!this.paused);
    };
    addEventListener('keydown', onEsc, { capture: true });
    this.offs.push(() => removeEventListener('keydown', onEsc, { capture: true }));
    // Leaving pointer lock (the browser eats that Esc) opens the menu too.
    const onLock = () => {
      if (!this.input.locked && !this.paused && document.hasFocus()) this.setPaused(true);
    };
    document.addEventListener('pointerlockchange', onLock);
    this.offs.push(() => document.removeEventListener('pointerlockchange', onLock));
    const onResize = () => this.resize();
    addEventListener('resize', onResize);
    this.offs.push(() => removeEventListener('resize', onResize));
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __beacon: Session }).__beacon = this;
  }

  // ------------------------------------------------------------------------------------- setup

  private setupRenderer() {
    const r = this.renderer;
    r.setPixelRatio(this.high ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, LOW_PIXEL_RATIO));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = LOOK.exposure;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.high;
    r.shadowMap.type = THREE.PCFShadowMap;
  }

  private setupPost() {
    this.composer?.dispose();
    this.composer = null;
    if (!this.high) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scenery.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92));
    this.composer.addPass(new OutputPass());
  }

  private resize() {
    const w = this.root.clientWidth || innerWidth;
    const h = this.root.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Switches High/Low now: rebuilds the scenery with the new materials and shadows. */
  private applyGraphics(high: boolean) {
    setGraphics(high ? 'high' : 'low');
    this.high = high;
    this.gate = frameGate(60);
    this.setupRenderer();
    this.scenery.dispose();
    this.scenery = new Scenery(this.renderer, this.course, { high });
    for (const c of this.others.values()) this.scenery.scene.add(c.root);
    for (let i = 0; i <= this.cp; i++) this.scenery.setBrazier(i, true);
    this.scenery.setBeacon(this.finishedMs !== null);
    this.setupPost();
    this.resize();
  }

  // ------------------------------------------------------------------------------------- the crew

  setCrew(crew: Member[]) {
    this.crew = crew;
    const ids = new Set(crew.map((m) => m.id));
    for (const [id, c] of this.others)
      if (!ids.has(id)) {
        c.dispose();
        this.others.delete(id);
      }
    for (const m of crew) {
      if (m.id === this.link.me || this.others.has(m.id)) continue;
      const c = new Climber(m.name, m.seat, this.high);
      this.others.set(m.id, c);
      this.scenery.scene.add(c.root);
    }
  }

  private member(id: number) {
    return this.crew.find((m) => m.id === id);
  }

  // ------------------------------------------------------------------------------------- climbs

  /** A climb starts (number n): everyone back to the bottom, a countdown in company. */
  start(n: number) {
    this.run = n;
    this.cp = -1;
    this.finishedMs = null;
    this.results.clear();
    this.t0 = null;
    this.countdown = this.link.solo ? 0 : CAM.countdown;
    this.respawn(-1);
    for (let i = 0; i < this.course.checkpoints.length; i++) this.scenery.setBrazier(i, false);
    this.scenery.setBeacon(false);
    this.hud.showResults(null);
    if (this.countdown === 0) this.go();
    else this.hud.announce('3', 'Skerry Light', 1);
  }

  private go() {
    this.t0 = this.now;
    this.hud.announce('Climb', 'Light the beacon at the top', 1.6);
    this.audio.countdown(true);
  }

  private respawn(cp: number) {
    const s = spawnFor(this.course, cp);
    const b = newBody(...s.spawn);
    this.body = b;
    this.prev.set(b.x, b.y, b.z);
    this.yaw = s.yaw;
    this.pitch = 0;
    this.dip = this.dipV = 0;
  }

  // ------------------------------------------------------------------------------------- network

  onMsg(from: number, m: Msg) {
    if (m.t === 'st') {
      if (m.n !== this.run) return;
      this.others.get(from)?.push(this.now / 1000, m.p[0], m.p[1], m.p[2], m.yaw, m.a, m.s, m.w);
      return;
    }
    const who = this.member(from);
    if (!who) return;
    const tag = { name: who.name, color: jacketOf(who.seat) };
    if (m.t === 'cp' && m.n === this.run) {
      const c = this.course.checkpoints[m.i];
      if (c) this.hud.toast([tag, ' reached ', c.name]);
    } else if (m.t === 'fin' && m.n === this.run) {
      if (this.results.has(from)) return;
      this.results.set(from, m.ms);
      this.hud.toast([tag, ` lit the beacon in ${clock(m.ms)}`]);
      if (this.finishedMs !== null) this.showResults();
    }
  }

  private send() {
    const b = this.body;
    const a: Anim = b.mantle ? ANIM.mantle : b.wall ? ANIM.wall : b.sliding ? ANIM.slide : !b.ground ? ANIM.air : b.crouched ? ANIM.crouch : hspeed(b) > 0.6 ? ANIM.run : ANIM.idle;
    // Which side the wall is on, in the climber's own frame (+1: their +X before the figure turns round).
    let w = 0;
    if (b.wall) {
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      w = -(b.wall.nx * rx + b.wall.nz * rz) > 0 ? -1 : 1;
    }
    const yaw = b.mantle ? b.mantle.yaw : hspeed(b) > 1 ? Math.atan2(-b.vx, -b.vz) : this.yaw;
    this.link.send({ t: 'st', n: this.run, p: [r2(b.x), r2(b.y), r2(b.z)], yaw: r2(yaw), a, s: r2(Math.min(59, hspeed(b))), w, cp: this.cp });
  }

  // ------------------------------------------------------------------------------------- the frame

  frame(dt: number, nowMs: number) {
    this.now = nowMs;
    this.hud.tick(dt);
    const f = this.input.poll(dt);
    if (f.pause) this.setPaused(!this.paused);
    if (f.jumpTap) this.jumpTapPending = true;
    if (!this.paused) {
      this.yaw += f.yaw;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + f.pitch));
    }

    // Countdown (in company): frozen at the start until it reaches zero.
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.go();
      } else if (after !== before) {
        this.hud.announce(String(after), 'Skerry Light', 1);
        this.audio.countdown(false);
      }
    }

    if (f.respawn && !this.paused && this.respawnT <= 0) this.respawn(this.cp);

    // ----- Simulate at a fixed tick.
    const frozen = this.countdown > 0 || this.respawnT > 0 || (this.paused && this.link.solo);
    const mi: MoveInput = frozen
      ? { fwd: 0, side: 0, yaw: this.yaw, jump: false, crouch: false, walk: false }
      : { fwd: f.fwd, side: f.side, yaw: this.yaw, jump: f.jump || this.jumpTapPending, crouch: f.crouch, walk: f.walk };
    this.acc = Math.min(this.acc + dt, 0.25);
    let ticks = 0;
    while (this.acc >= MOVE.tick) {
      this.acc -= MOVE.tick;
      this.prev.set(this.body.x, this.body.y, this.body.z);
      if (!(this.paused && this.link.solo)) {
        step(this.course.world, this.body, mi);
        this.onEvents();
      }
      if (ticks++ === 0) this.jumpTapPending = false;
      mi.jump = f.jump;
    }
    if (ticks > 0) this.jumpTapPending = false;
    this.checkProgress(dt);

    // ----- Camera
    const b = this.body;
    const k = this.acc / MOVE.tick;
    const px = this.prev.x + (b.x - this.prev.x) * k;
    const py = this.prev.y + (b.y - this.prev.y) * k;
    const pz = this.prev.z + (b.z - this.prev.z) * k;
    const sp = hspeed(b);
    // Landing dip: a damped spring.
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    // Head bob from the stride while running on the ground; footsteps on the beat.
    const running = b.ground && sp > 0.8 && !b.sliding;
    if (running) {
      this.bobPhase += dt * (4.2 + sp * 0.75);
      const stepNow = Math.floor(this.bobPhase / Math.PI);
      if (stepNow !== this.stepPhase) {
        this.stepPhase = stepNow;
        this.audio.footstep(b.floor?.mat ?? null, sp);
      }
    } else if (b.wall) {
      this.bobPhase += dt * 14;
      const stepNow = Math.floor(this.bobPhase / Math.PI);
      if (stepNow !== this.stepPhase) {
        this.stepPhase = stepNow;
        this.audio.wallrun();
      }
    }
    const bobAmt = running ? Math.min(1, sp / MOVE.sprint) : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * CAM.bob * bobAmt - CAM.bob * bobAmt * 0.5;
    const bobX = Math.sin(this.bobPhase) * CAM.sway * bobAmt;
    // Roll: off the wall on a wall run, a little into a slide, a touch into strafes.
    let rollTo = 0;
    if (b.wall) {
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      rollTo = (b.wall.nx * rx + b.wall.nz * rz) * CAM.wallRoll;
    } else if (b.sliding) rollTo = CAM.slideRoll;
    else rollTo = -f.side * 0.015;
    this.roll += (rollTo - this.roll) * Math.min(1, dt * 8);
    // Speed FOV.
    this.fovK += (Math.max(0, Math.min(1, (sp - MOVE.run) / (MOVE.maxSpeed - MOVE.run))) - this.fovK) * Math.min(1, dt * 4);
    const fov = CAM.fov + CAM.fovFast * this.fovK + (b.mantle ? -3 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const eye = eyeHeight(b);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.camera.position.set(px + rx * bobX, py + eye + bobY - this.dip, pz + rz * bobX);
    // Mantling: look down at the ledge a touch as you pull up.
    const mantleTilt = b.mantle ? Math.sin(Math.min(1, b.mantle.t / b.mantle.dur) * Math.PI) * -0.18 : 0;
    this.camera.rotation.set(this.pitch + mantleTilt, this.yaw, this.roll, 'YXZ');

    // ----- Others, scenery, sound, HUD
    for (const c of this.others.values()) c.update(this.now / 1000, dt, this.camera);
    this.scenery.update(dt, this.camera.position);
    this.audio.ambience(Math.hypot(sp, b.vy * 0.5), b.y, this.now / 1000);
    this.gullT -= dt;
    if (this.gullT <= 0) {
      this.gullT = 6 + Math.random() * 14;
      this.audio.gull();
    }
    this.updateHud(dt);

    // ----- Send my state
    this.sendT -= dt;
    if (this.sendT <= 0 && !this.link.solo) {
      this.sendT = 1 / CAM.sendHz;
      this.send();
    }

    if (!this.gate(nowMs)) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scenery.scene, this.camera);
  }

  private onEvents() {
    const b = this.body;
    for (const e of b.events) {
      if (e === 'jump') this.audio.jump();
      else if (e === 'land') {
        this.dipV -= Math.min(CAM.dipMax * 12, b.impact * CAM.dipPerImpact * 12);
        this.audio.land(b.impact, b.floor?.mat ?? this.lastFloor?.mat ?? null);
        if (b.impact > 9) this.api.rumble(0.5, 0.3, 120);
      } else if (e === 'slide') this.audio.slide();
      else if (e === 'wallrun') {
        this.audio.wallrun();
        this.api.rumble(0.1, 0.25, 80);
      } else if (e === 'walljump') this.audio.walljump();
      else if (e === 'mantle') {
        this.audio.mantle();
        this.api.rumble(0.2, 0.2, 90);
      } else if (e === 'climb') this.audio.wallrun();
    }
    if (b.floor) this.lastFloor = b.floor;
  }

  private checkProgress(dt: number) {
    const b = this.body;
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      this.hud.fade(Math.min(1, 1 - Math.abs(this.respawnT - 0.45) / 0.45));
      if (this.respawnT <= 0.45 && this.respawnT + dt > 0.45) this.respawn(this.cp);
      if (this.respawnT <= 0) this.hud.fade(0);
      return;
    }
    const pr = progress(this.course, b, this.cp);
    if (pr.drowned) {
      this.audio.splash();
      this.respawnT = 0.9;
      return;
    }
    if (pr.cp > this.cp) {
      for (let i = this.cp + 1; i <= pr.cp; i++) this.scenery.setBrazier(i, true);
      this.cp = pr.cp;
      const c = this.course.checkpoints[this.cp];
      this.hud.announce(c.name, `Checkpoint ${this.cp + 1} of ${this.course.checkpoints.length}`);
      this.audio.checkpoint();
      if (!this.link.solo) this.link.send({ t: 'cp', n: this.run, i: this.cp });
    }
    if (pr.finished && this.finishedMs === null && this.t0 !== null) {
      const ms = Math.round(this.now - this.t0);
      this.finishedMs = ms;
      this.results.set(this.link.me, ms);
      this.scenery.setBeacon(true);
      this.audio.finish();
      this.api.rumble(0.6, 0.6, 400);
      saveBest(ms);
      if (!this.link.solo) this.link.send({ t: 'fin', n: this.run, ms });
      this.showResults();
    }
  }

  private showResults() {
    const rows = [{ id: this.link.me, name: this.member(this.link.me)?.name ?? 'You', seat: this.member(this.link.me)?.seat ?? 0 }, ...this.crew.filter((m) => m.id !== this.link.me)].map((m) => ({
      name: m.name,
      color: jacketOf(m.seat),
      ms: this.results.get(m.id) ?? null,
      me: m.id === this.link.me,
    }));
    rows.sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
    const best = loadBest();
    this.hud.showResults(rows, best !== null && best === this.finishedMs ? 'The light is lit · new best' : 'The light is lit');
  }

  private updateHud(dt: number) {
    const b = this.body;
    this.hud.setTime(this.t0 === null ? 0 : this.finishedMs ?? this.now - this.t0);
    const c = this.course.checkpoints[this.cp];
    const next = this.course.checkpoints[this.cp + 1];
    this.hud.setWhere(this.finishedMs !== null ? 'Skerry Light · lit' : `${c ? c.name : 'The tide line'}${next ? `  ·  next: ${next.name}` : '  ·  next: the lantern'}`);
    this.hud.setSpeed(hspeed(b));
    this.hintT -= dt;
    this.hud.setHints(this.hintT > 0 || this.paused);
    const marks = [{ id: this.link.me, share: heightShare(this.course, b.y), color: jacketOf(this.member(this.link.me)?.seat ?? 0), me: true, name: 'You' }];
    for (const [id, o] of this.others) {
      if (!o.hasState) continue;
      const m = this.member(id);
      marks.push({ id, share: heightShare(this.course, o.pos.y), color: jacketOf(m?.seat ?? 0), me: false, name: m?.name ?? '' });
    }
    this.hud.setBar(marks);
  }

  // ------------------------------------------------------------------------------------- pause

  setPaused(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    this.input.enabled = !on;
    this.api.setMenuNav(on);
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (!on) {
      this.input.lock();
      return;
    }
    this.input.unlock();
    const wrap = el('div', 'bc-pause');
    const card = el('div', 'bc-card');
    card.append(el('h2', 'bc-title small', 'Paused'));
    const btn = (text: string, fn: () => void, auto = false) => {
      const b = el('button', 'bc-btn', text);
      if (auto) b.dataset.autofocus = '';
      b.onclick = fn;
      card.append(b);
      return b;
    };
    btn('Resume', () => this.setPaused(false), true);
    btn('Back to my checkpoint', () => {
      this.respawn(this.cp);
      this.setPaused(false);
    });
    if (this.link.solo || this.link.isHost())
      btn(this.link.solo ? 'Restart the climb' : 'Restart the climb for everyone', () => {
        this.setPaused(false);
        this.link.restart();
      });
    const gfx = btn(`Graphics: ${this.high ? 'High' : 'Low'}`, () => {
      this.applyGraphics(!this.high);
      gfx.textContent = `Graphics: ${this.high ? 'High' : 'Low'}`;
    });
    const sens = el('label', 'bc-slider');
    const range = el('input') as HTMLInputElement;
    range.type = 'range';
    range.min = '0.2';
    range.max = '3';
    range.step = '0.05';
    range.value = String(this.input.sens);
    const val = el('span', '', this.input.sens.toFixed(2));
    range.oninput = () => {
      this.input.sens = Number(range.value);
      val.textContent = this.input.sens.toFixed(2);
      saveSens(this.input.sens);
    };
    sens.append('Look sensitivity ', range, val);
    card.append(sens);
    const best = loadBest();
    if (best !== null) card.append(el('p', 'bc-note', `Your best: ${clock(best)}`));
    btn(this.link.solo ? 'Leave the climb' : 'Leave the party', () => this.link.leave());
    btn('Back to the games', () => this.api.exit());
    wrap.append(card);
    this.root.append(wrap);
    this.pauseEl = wrap;
    (card.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.pauseEl?.remove();
    for (const c of this.others.values()) c.dispose();
    this.others.clear();
    this.composer?.dispose();
    this.scenery.dispose();
    this.renderer.domElement.remove();
  }
}

const BEST = 'beacon.best';
function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveBest(ms: number) {
  const b = loadBest();
  if (b !== null && b <= ms) return;
  try {
    localStorage.setItem(BEST, String(ms));
  } catch {
    /* blocked storage */
  }
}
