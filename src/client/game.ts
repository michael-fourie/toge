import GUI from 'lil-gui';
import * as THREE from 'three';
import { PLAYER, MOVE, NET, RESPAWN_SECONDS, SURVIVAL, TICK_DT, WEAPON } from '../shared/constants.ts';
import { raySphere, rayBox, rayWorld } from '../shared/collision.ts';
import { MAP } from '../shared/map.ts';
import { type Vec3, copy, hlen, lerp, lookDir, v3, yawRight } from '../shared/math.ts';
import { Ev, type GrappleTarget, type PlayerState, createPlayerState, emptyInput, findGrapple, stepPlayer } from '../shared/movement.ts';
import { RECENT_SPAWNS, pickSpawn } from '../shared/spawn.ts';
import {
  type ClientMsg,
  type DeathCause,
  type GameMode,
  type NetPlayerState,
  type PlayerInfo,
  type ServerMsg,
  StateFlag,
  type V3,
  type WaveInfo,
  round3,
} from '../shared/protocol.ts';
import { type ShotContext, SpinMeter, Streak, featsFor } from './achievements.ts';
import { Avatar, Corpses } from './avatar.ts';
import { PostGame } from './postgame.ts';
import { Horde } from './horde.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { KILLCAM, Trail, replayTime, replaying } from './killcam.ts';
import { Rope } from './rope.ts';
import { SpeedFx } from './speedfx.ts';
import type { Net } from './net.ts';
import { sfx } from './sfx.ts';
import { ViewModel } from './viewmodel.ts';
import { type World, buildWorld } from './world.ts';

type Joined = Extract<ServerMsg, { t: 'joined' }>;

interface GameOptions {
  container: HTMLElement;
  name: string;
  /** Omit for offline practice (with target dummies). */
  net?: Net;
  joined?: Joined;
  onExit: (reason?: string) => void;
}

interface Remote {
  info: PlayerInfo;
  avatar: Avatar;
  buffer: { t: number; s: NetPlayerState }[];
  pos: THREE.Vector3; // as rendered this frame (what the local player sees and shoots at)
  yaw: number;
  /** Recent poses, for the kill-cam. */
  trail: Trail;
  /** Offline practice targets drive themselves. */
  dummy?: { base: Vec3; phase: number; respawnAt: number };
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

const BASE_FOV = 78; // vertical; ~106° horizontal at 16:9
const tracerGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

const verbFor: Record<DeathCause, string> = { snipe: 'sniped', headshot: '💥 HEADSHOT', void: 'fell into the void', zombie: 'got munched 🧟' };
/** Stand-in for the killfeed when a zombie goes down. */
const ZOMBIE_INFO: PlayerInfo = { id: -1, name: 'zombie', color: 0x7fae6a, kills: 0, deaths: 0, alive: false };
const YEETS = ['YEET', 'SNIPED', 'BONK', 'GOT EM', 'SENT FLYING'];

/** The last shot of ours that hit someone, so its feats can be scored when the kill is confirmed. */
interface LastHit {
  id: number;
  zombie: boolean;
  ctx: ShotContext;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 1500);
  private world: World;
  private vm: ViewModel;
  private hud: Hud;
  private input: Input;
  private corpses: Corpses;
  private gui: GUI;

  private me: PlayerState;
  private selfId: number;
  private players = new Map<number, PlayerInfo>();
  private remotes = new Map<number, Remote>();
  private selfAvatar: Avatar;

  private alive = true;
  private respawnAt = 0; // offline only
  private deathText = '';
  private deathCorpse: { obj: THREE.Object3D } | null = null;
  private deathCam = new THREE.Vector3();

  private moveInput = emptyInput();
  private prevPos = v3();
  private renderPos = new THREE.Vector3();
  private acc = 0;
  private time = 0;
  private last = performance.now();
  private raf = 0;
  private sendAcc = 0;
  private lastSent = '';
  private recentSpawns: number[] = [];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  // Grapple ropes: ours, a brief flash for a miss, and one per remote player.
  private ropeSelf: Rope;
  private ropeMiss = { t: 0, end: new THREE.Vector3() };
  private remoteRopes = new Map<number, Rope>();

  // Kill-cam: trails of everyone, recent shots, and the replay in progress (if any).
  private selfTrail = new Trail();
  private shotLog: { t: number; id: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  private killcam: { deathTime: number; start: number; killerId: number; shot: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null; shotShown: boolean } | null = null;

  private scoped = false;
  private bolt = 0; // seconds until the next shot is chambered
  private ammo = WEAPON.magSize;
  private reloading = 0; // seconds left on a reload
  private autoReloadAt = -1;
  private roll = 0;
  private landDip = 0;
  private fovKick = 0; // brief FOV punch when a wind gate hits
  /** Smoothed camera height above the feet (drops while sliding). Shots should originate here too. */
  private eyeHeight = PLAYER.eyeHeight;
  private showScores = false;
  private tracers: Tracer[] = [];
  private unsubscribe?: () => void;

  // Feats and streaks
  private streak = new Streak();
  private spin = new SpinMeter();
  private airTime = 0;
  private lastHit: LastHit | null = null;

  // Survival
  private readonly mode: GameMode;
  private horde: Horde | null = null;
  private hp: number = SURVIVAL.playerHp;
  private wave: WaveInfo | null = null;
  private postgame: PostGame | null = null;
  private waveAt = 0; // this.time when `wave` arrived (its timer counts down from then)
  private nextGroan = 3;

  constructor(private opts: GameOptions) {
    const { container, net, joined } = opts;
    this.mode = joined?.mode ?? 'battle';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Neutral keeps the soft painted palette saturated; ACES washes it toward grey-orange.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';

    this.world = buildWorld(MAP, this.renderer);
    this.corpses = new Corpses(this.world.scene);
    this.ropeSelf = new Rope(this.world.scene);
    if (this.mode === 'survival') {
      this.horde = new Horde(this.world.scene);
      this.wave = joined?.wave ?? null;
    }

    // Players.
    this.selfId = net?.id ?? 0;
    if (joined) {
      for (const p of joined.players) this.players.set(p.id, p);
    } else {
      this.players.set(0, { id: 0, name: opts.name, color: 0xe0614f, kills: 0, deaths: 0, alive: true });
    }
    const self = this.players.get(this.selfId)!;
    this.selfAvatar = new Avatar(self.color);
    this.vm = new ViewModel(self.color);

    const spawn = joined ? { pos: arr(joined.spawn.p), yaw: joined.spawn.yaw } : this.randomSpawn();
    this.me = createPlayerState(spawn.pos);
    copy(this.prevPos, this.me.pos);

    this.hud = new Hud(container, joined ? `${this.mode === 'survival' ? 'SURVIVAL' : 'LOBBY'} ${joined.code}` : 'PRACTICE — shoot the dummies');
    this.input = new Input(this.renderer.domElement);
    if (net && this.mode === 'survival') this.postgame = new PostGame(container, this.selfId, { onAgain: () => { net.send({ t: 'again' }); void this.input.lock(); }, onHome: () => this.exit() });
    this.input.yaw = spawn.yaw;
    this.input.onLockChange = (locked) => this.hud.setPaused(!locked);
    this.input.onKey = (code, down) => this.onKey(code, down);
    this.hud.setPaused(true);
    this.hud.onResume = () => this.input.lock();
    this.hud.onLeave = () => this.exit();
    this.renderer.domElement.addEventListener('click', () => this.input.lock());

    for (const p of this.players.values()) if (p.id !== this.selfId) this.addRemote(p);
    if (net) {
      this.unsubscribe = net.on((m) => this.onNet(m));
      net.onClose = () => this.exit('Disconnected from server');
    } else {
      this.spawnDummies();
    }

    this.gui = this.buildGui();
    addEventListener('resize', this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // console poking
  }

  // ---------------------------------------------------------------------------
  // Main loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    this.spin.push(this.time, this.input.yaw);
    this.updateWeapon(dt);
    if (this.alive) this.simulate(dt);
    else if (!this.opts.net && this.time >= this.respawnAt) this.respawn(this.randomSpawn());

    if (this.opts.net) this.sendState(dt);
    if (this.killcam) this.updateKillcam();
    else this.updateRemotes();
    this.updateHorde();
    this.corpses.update(dt);
    this.updateTracers(dt);
    this.world.update(this.time);
    this.updateCamera(dt);
    this.recordSelf();
    this.updateRopes(dt);
    this.updateHud(dt);

    this.renderer.clear();
    this.renderer.render(this.world.scene, this.camera);
    if (this.alive && !this.scoped) {
      this.renderer.clearDepth();
      this.renderer.render(this.vm.scene, this.vm.camera);
    }
  };

  private simulate(dt: number) {
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= TICK_DT && ticks++ < 20) {
      copy(this.prevPos, this.me.pos);
      const fallSpeed = -this.me.vel.y;
      this.moveInput.grappleTargets = this.grappleTargets();
      stepPlayer(this.me, this.input.sample(this.moveInput), TICK_DT, MAP.boxes, MAP.triggers);
      this.onMoveEvents(this.me.events, fallSpeed);
      this.airTime = this.me.onGround ? 0 : this.airTime + TICK_DT;
      this.acc -= TICK_DT;
    }
    if (this.me.pos.y < MAP.killY) {
      if (this.opts.net) {
        // Die immediately; the server's kill message only updates the scores.
        this.opts.net.send({ t: 'fell' });
        this.die('void', this.selfId, new THREE.Vector3(0, 1, 0));
      } else {
        this.onKill(this.selfId, this.selfId, 'void', [0, 1, 0]);
      }
    }
  }

  private onMoveEvents(ev: number, fallSpeed: number) {
    if (!ev) return;
    if (ev & Ev.Jump) sfx.jump();
    if (ev & Ev.Land) {
      const hard = Math.min(1, Math.max(0, (fallSpeed - 6) / 20));
      sfx.land(hard);
      this.vm.land(0.3 + hard);
      this.landDip = Math.min(0.25, this.landDip + 0.04 + hard * 0.2);
    }
    if (ev & Ev.WallrunStart) sfx.wallrun();
    if (ev & Ev.SlideStart) sfx.slide();
    if (ev & Ev.WallJump) {
      sfx.wallJump();
      this.fovKick = Math.max(this.fovKick, 6);
      this.hud.punch(0.5);
    }
    if (ev & Ev.AirJump) {
      sfx.airJump();
      this.fovKick = Math.max(this.fovKick, 3);
    }
    if (ev & Ev.GrappleHit) {
      sfx.grappleHit();
      this.fovKick = Math.max(this.fovKick, 7);
      this.hud.punch(0.7);
    }
    if (ev & Ev.GrappleEnd) sfx.grappleRelease();
    if (ev & Ev.GrappleMiss) {
      sfx.grappleMiss();
      const d = lookDir(this.input.yaw, this.input.pitch);
      const o = this.me.pos;
      this.ropeMiss.end.set(o.x + d.x * MOVE.grappleRange, o.y + this.eyeHeight + d.y * MOVE.grappleRange, o.z + d.z * MOVE.grappleRange);
      this.ropeMiss.t = 0.18;
    }
    if (ev & Ev.JumpPad) sfx.pad();
    if (ev & Ev.Bounce) sfx.bounce();
    if (ev & Ev.Boost) {
      this.hud.punch(0.6);
      sfx.boost();
      this.fovKick = 10;
    }
  }

  // ---------------------------------------------------------------------------
  // Weapon

  private updateWeapon(dt: number) {
    this.bolt = Math.max(0, this.bolt - dt);
    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) this.ammo = WEAPON.magSize;
    }
    if (this.autoReloadAt >= 0 && this.time >= this.autoReloadAt) {
      this.autoReloadAt = -1;
      this.startReload();
    }
    // Hold RMB to scope. The bolt cycle (and reloads) knock you out of scope, CS-style;
    // if RMB is still held when it finishes, you scope straight back in.
    const wantScope = this.alive && this.input.scopeHeld && this.bolt === 0 && this.reloading === 0;
    if (wantScope && !this.scoped) sfx.scope();
    this.scoped = wantScope;
    if (this.input.takeFire()) this.fire();
  }

  private startReload() {
    if (!this.alive || this.reloading > 0 || this.ammo >= WEAPON.magSize) return;
    const fromEmpty = this.ammo === 0; // chamber's empty too: finish with a bolt cycle
    this.reloading = WEAPON.reloadTime + (fromEmpty ? WEAPON.boltTime : 0);
    this.bolt = 0;
    this.autoReloadAt = -1;
    this.vm.reload(fromEmpty);
  }

  private fire() {
    if (!this.alive || this.bolt > 0 || this.reloading > 0) return;
    if (this.ammo === 0) {
      sfx.dryFire();
      this.startReload();
      return;
    }
    const pitch = this.input.pitch;
    const yaw = this.input.yaw;
    const d = lookDir(yaw, pitch);
    if (!this.scoped) {
      // No-scope spread, uniform-ish in a cone.
      d.x += (Math.random() - 0.5) * 2 * WEAPON.hipSpread;
      d.y += (Math.random() - 0.5) * 2 * WEAPON.hipSpread;
      d.z += (Math.random() - 0.5) * 2 * WEAPON.hipSpread;
      const l = Math.hypot(d.x, d.y, d.z);
      d.x /= l;
      d.y /= l;
      d.z /= l;
    }
    // Shoot from where the camera actually is (lower while sliding).
    const o = { x: this.renderPos.x, y: this.renderPos.y + this.eyeHeight, z: this.renderPos.z };

    let best = rayWorld(o, d, MAP.boxes, WEAPON.range);
    let hit: { id: number; zombie: boolean } | null = null;
    let headshot = false;
    const hw = PLAYER.halfWidth;
    const targets: { id: number; pos: THREE.Vector3; zombie: boolean }[] = this.horde
      ? [...this.horde.zombies.values()].map((z) => ({ id: z.id, pos: z.pos, zombie: true })) // co-op: shots pass through friends
      : [...this.remotes.values()].filter((r) => r.info.alive).map((r) => ({ id: r.info.id, pos: r.pos, zombie: false }));
    for (const { id, pos: p, zombie } of targets) {
      const th = raySphere(o, d, { x: p.x, y: p.y + PLAYER.headCenter, z: p.z }, PLAYER.headRadius + 0.04, best);
      if (th >= 0 && th < best) {
        best = th;
        hit = { id, zombie };
        headshot = true;
      }
      const tb = rayBox(o, d, { x: p.x - hw, y: p.y, z: p.z - hw }, { x: p.x + hw, y: p.y + PLAYER.headCenter - PLAYER.headRadius, z: p.z + hw }, best);
      if (tb >= 0 && tb < best) {
        best = tb;
        hit = { id, zombie };
        headshot = false;
      }
    }
    const end = new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    const muzzle = this.camera.localToWorld(new THREE.Vector3(0.22, -0.2, -1.1));
    this.addTracer(muzzle, end, this.players.get(this.selfId)!.color);

    if (hit) {
      this.hud.hitmarker();
      sfx.hit();
      const ctx: ShotContext = {
        headshot,
        scoped: this.scoped,
        spin: this.spin.spin(yaw),
        airTime: this.airTime,
        wallrunning: this.me.wallrunning,
        sliding: this.me.sliding,
        speed: hlen(this.me.vel),
        distance: best,
        rope: this.me.grapple ? (this.me.grappleTarget === hit.id && !hit.zombie ? 'target' : 'surface') : 'none',
      };
      this.lastHit = { ...hit, ctx };
    }

    this.ammo--;
    this.vm.fire(this.ammo > 0);
    sfx.shoot();
    if (this.ammo > 0) this.bolt = WEAPON.fireCooldown;
    else this.autoReloadAt = this.time + 0.25; // last round: drop straight into a reload
    this.scoped = false; // updateWeapon re-scopes after the bolt if RMB is still held

    if (this.opts.net) {
      this.opts.net.send({
        t: 'shoot',
        from: [round3(o.x), round3(o.y), round3(o.z)],
        to: [round3(end.x), round3(end.y), round3(end.z)],
        victim: hit && !hit.zombie ? hit.id : undefined,
        zombie: hit?.zombie ? hit.id : undefined,
        headshot,
      });
    } else if (hit) {
      this.onKill(this.selfId, hit.id, headshot ? 'headshot' : 'snipe', [d.x, d.y, d.z]);
    }
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.copy(from);
    mesh.lookAt(to);
    mesh.scale.set(1, 1, from.distanceTo(to));
    this.world.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.6 });
  }

  private updateTracers(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      const m = t.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, t.life / 0.6) * 0.9;
      t.mesh.scale.x = t.mesh.scale.y = 1 + (0.6 - t.life) * 4;
      if (t.life <= 0) {
        t.mesh.removeFromParent();
        m.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Death & respawn

  private onKill(killerId: number, victimId: number, cause: DeathCause, dir: V3) {
    const killer = this.info(killerId);
    const victim = this.info(victimId);
    if (victim) {
      victim.alive = false;
      victim.deaths++;
    }
    if (killer && killerId !== victimId) killer.kills++;
    const mine = killerId === this.selfId && victimId !== this.selfId;
    const feats = mine ? this.celebrate(victimId, false, cause === 'headshot') : null;
    this.hud.killfeed(killer, victim, feats ?? verbFor[cause]);
    const d = new THREE.Vector3(...dir);

    if (victimId === this.selfId) {
      this.die(cause, killerId, d);
    } else {
      const r = this.remotes.get(victimId);
      if (r) {
        r.avatar.root.visible = false;
        r.buffer.length = 0;
        if (cause !== 'void') this.corpses.spawn(r.avatar.cloneBody(), r.pos, r.yaw, d, cause === 'headshot' ? 38 : 26);
        if (r.dummy) r.dummy.respawnAt = this.time + RESPAWN_SECONDS;
      }
    }
  }

  /**
   * Our kill: score its feats (from the shot that hit, if that's the kill being confirmed) plus streak and
   * multi-kill, then pop them on screen with a jingle. Returns the stacked title for the killfeed, if any.
   */
  private celebrate(id: number, zombie: boolean, headshot: boolean): string | null {
    const h = this.lastHit;
    const style = h && h.id === id && h.zombie === zombie ? featsFor(h.ctx) : headshot ? featsFor({ ...PLAIN_SHOT, headshot }) : [];
    const extra = this.streak.kill(this.time);
    sfx.kill();
    const all = [...style, ...extra];
    if (all.length === 0) this.hud.center(pick(YEETS));
    else if (all.length === 1 && style[0]?.label === 'HEADSHOT') this.hud.center('HEADSHOT!', '#ffd43b'); // the classic
    else {
      this.hud.feats(style, extra);
      sfx.feats(all.length, Math.max(...all.map((f) => f.tier)));
    }
    return style.length ? style.map((f) => f.label).join(' ') : null;
  }

  private die(cause: DeathCause, killerId: number, dir: THREE.Vector3) {
    if (!this.alive) return;
    this.alive = false;
    this.scoped = false;
    this.input.scopeHeld = false; // must re-press RMB after respawning
    this.respawnAt = this.time + RESPAWN_SECONDS;
    this.streak.reset();
    sfx.death();
    const killer = this.players.get(killerId);
    this.deathText =
      cause === 'void'
        ? 'You fell into the void'
        : cause === 'zombie'
          ? 'Munched by a zombie'
          : `${cause === 'headshot' ? 'Headshot' : 'Sniped'} by ${killer?.name ?? '???'}`;
    const pos = new THREE.Vector3(this.me.pos.x, this.me.pos.y, this.me.pos.z);
    this.deathCam.copy(pos).add(new THREE.Vector3(0, PLAYER.eyeHeight, 0));
    this.deathCorpse =
      cause === 'void' ? null : this.corpses.spawn(this.selfAvatar.cloneBody(), pos, this.input.yaw, dir, cause === 'headshot' ? 38 : 26);
    if ((cause === 'snipe' || cause === 'headshot') && killerId !== this.selfId) this.startKillcam(killerId);
  }

  /** Records where we were this frame, so a replay can show us too. */
  private recordSelf() {
    if (!this.alive) return;
    const right = yawRight(this.input.yaw);
    const side = this.me.wallrunning ? Math.sign(right.x * this.me.vel.x + right.z * this.me.vel.z) || 0 : 0;
    this.selfTrail.push(this.time, { x: this.renderPos.x, y: this.renderPos.y, z: this.renderPos.z, yaw: this.input.yaw, pitch: this.input.pitch, side, sliding: this.me.sliding });
  }

  // ---------------------------------------------------------------------------
  // Kill-cam: replay the last couple of seconds from the killer's eyes

  private startKillcam(killerId: number) {
    const killer = this.remotes.get(killerId);
    if (!killer || killer.dummy || killer.trail.length < 2 || this.selfTrail.length < 2) return;
    const shot = [...this.shotLog].reverse().find((s) => s.id === killerId && this.time - s.t < 1.2) ?? null;
    this.killcam = { deathTime: this.time, start: this.time, killerId, shot, shotShown: false };
    this.world.scene.add(this.selfAvatar.root);
    if (this.deathCorpse) this.deathCorpse.obj.visible = false; // it flies at the end of the replay, not the start
  }

  private endKillcam() {
    this.killcam = null;
    this.selfAvatar.root.removeFromParent();
    if (this.deathCorpse) this.deathCorpse.obj.visible = true;
  }

  private updateKillcam() {
    const kc = this.killcam!;
    const elapsed = this.time - kc.start;
    if (this.alive || !replaying(elapsed)) {
      this.endKillcam();
      this.updateRemotes();
      return;
    }
    const T = replayTime(elapsed, kc.deathTime);
    for (const r of this.remotes.values()) {
      if (r.dummy) continue;
      const p = r.trail.at(T);
      if (!p || r.info.id === kc.killerId) {
        r.avatar.root.visible = false; // the killer's head is the camera
        continue;
      }
      r.avatar.root.visible = true;
      r.avatar.pose(p.x, p.y, p.z, p.yaw, p.pitch, p.side, this.time, p.sliding);
    }
    const me = this.selfTrail.at(T);
    if (me) this.selfAvatar.pose(me.x, me.y, me.z, me.yaw, me.pitch, me.side, this.time, me.sliding);
    this.selfAvatar.root.visible = !!me;
    if (kc.shot && !kc.shotShown && T >= kc.shot.t) {
      kc.shotShown = true;
      this.addTracer(kc.shot.from, kc.shot.to, this.players.get(kc.killerId)?.color ?? 0xffffff);
      sfx.distantShot(8);
    }
    const k = this.remotes.get(kc.killerId)?.trail.at(T);
    if (k) {
      this.camera.position.set(k.x, k.y + (k.sliding ? KILLCAM.killerEyeSliding : KILLCAM.killerEye), k.z);
      this.camera.rotation.set(k.pitch, k.yaw, 0);
    }
    this.camera.fov += (55 - this.camera.fov) * 0.2;
    this.camera.updateProjectionMatrix();
  }

  private respawn(spawn: { pos: Vec3; yaw: number }) {
    this.me = createPlayerState(spawn.pos);
    copy(this.prevPos, this.me.pos);
    this.acc = 0;
    this.input.yaw = spawn.yaw;
    this.input.pitch = 0;
    if (this.killcam) this.endKillcam();
    this.selfTrail.clear();
    this.alive = true;
    this.deathCorpse = null;
    this.ammo = WEAPON.magSize;
    this.bolt = this.reloading = 0;
    this.autoReloadAt = -1;
    this.vm.draw();
    const self = this.players.get(this.selfId);
    if (self) self.alive = true;
  }

  private info(id: number): PlayerInfo | undefined {
    return this.players.get(id) ?? this.remotes.get(id)?.info;
  }

  /** Practice respawn: a random good spot away from the dummies (same chooser the server uses). */
  private randomSpawn() {
    const dummies = [...this.remotes.values()].filter((r) => r.dummy && r.info.alive).map((r) => ({ x: r.dummy!.base.x, y: r.dummy!.base.y, z: r.dummy!.base.z }));
    const i = pickSpawn(MAP.spawns, dummies, this.recentSpawns, MAP.boxes);
    this.recentSpawns.push(i);
    if (this.recentSpawns.length > RECENT_SPAWNS) this.recentSpawns.shift();
    const s = MAP.spawns[i];
    return { pos: { ...s.pos }, yaw: s.yaw };
  }

  // ---------------------------------------------------------------------------
  // Remote players

  private addRemote(info: PlayerInfo, dummy?: Remote['dummy']) {
    const avatar = new Avatar(info.color, info.name);
    avatar.root.visible = info.alive && !!dummy;
    this.world.scene.add(avatar.root);
    this.remotes.set(info.id, { info, avatar, buffer: [], pos: new THREE.Vector3(), yaw: 0, trail: new Trail(), dummy });
  }

  private removeRemote(id: number) {
    this.remoteRopes.get(id)?.dispose();
    this.remoteRopes.delete(id);
    this.remotes.get(id)?.avatar.dispose();
    this.remotes.delete(id);
  }

  private updateRemotes() {
    const renderT = performance.now() - NET.interpDelayMs;
    for (const r of this.remotes.values()) {
      if (r.dummy) {
        this.updateDummy(r);
        continue;
      }
      const buf = r.buffer;
      while (buf.length > 2 && buf[1].t <= renderT) buf.shift();
      if (!r.info.alive) this.remoteRopes.get(r.info.id)?.set(this.tmpA, null);
      if (!buf.length || !r.info.alive) continue;
      let a = buf[0];
      let b = buf[buf.length > 1 ? 1 : 0];
      if (renderT >= b.t) a = b; // starved: hold latest
      const k = b.t > a.t ? Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t))) : 1;
      const s = a.s;
      const e = b.s;
      r.pos.set(lerp(s.p[0], e.p[0], k), lerp(s.p[1], e.p[1], k), lerp(s.p[2], e.p[2], k));
      r.yaw = lerpAngle(s.yaw, e.yaw, k);
      const pitch = lerp(s.pitch, e.pitch, k);
      // Lean into the wall when wallrunning: figure out which side it's on from velocity vs facing.
      let side = 0;
      if (e.f & StateFlag.Wallrun) {
        const rgt = yawRight(r.yaw);
        side = Math.sign(rgt.x * e.v[0] + rgt.z * e.v[2]) || 0;
      }
      const rope = this.remoteRopes.get(r.info.id) ?? new Rope(this.world.scene);
      this.remoteRopes.set(r.info.id, rope);
      rope.set(this.tmpA.set(r.pos.x, r.pos.y + 1.2, r.pos.z), e.g ? this.tmpB.set(e.g[0], e.g[1], e.g[2]) : null);
      r.avatar.root.visible = true;
      const sliding = (e.f & StateFlag.Sliding) !== 0;
      r.avatar.pose(r.pos.x, r.pos.y, r.pos.z, r.yaw, pitch, side, this.time, sliding);
      r.trail.push(this.time, { x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw, pitch, side, sliding });
    }
  }

  private updateHorde() {
    if (!this.horde) return;
    this.horde.update(this.time);
    if (this.time >= this.nextGroan) {
      this.nextGroan = this.time + 2 + Math.random() * 3;
      sfx.groan(this.horde.nearest(this.camera.position));
    }
  }

  private spawnDummies() {
    const spots: Vec3[] = [
      { x: -12, y: 0, z: -8 }, // centre island, beside the tree
      { x: 8, y: 8, z: 0 }, // east branch
      { x: 0, y: 23, z: -5 }, // the crown
      { x: -29, y: 10, z: -25 }, // far ruins watchtower
      { x: -27, y: 0, z: -33 }, // far ruins approach
      { x: 0, y: 4, z: -58 }, // far Windway runway
      { x: 35, y: -2, z: -21 }, // far gorge exit terrace
      { x: 0, y: 12, z: -98 }, // far harbour
      { x: -14, y: 15, z: -55 }, // far Mill House roof
      { x: 20, y: 10, z: -51 }, // far Cliff House roof
    ];
    const colors = [0xc9a27e, 0x9bb7d4, 0xd9a3a0, 0xa9c48f]; // soft scarecrow tones
    spots.forEach((base, i) =>
      this.addRemote(
        { id: 1000 + i, name: `dummy ${i + 1}`, color: colors[i % colors.length], kills: 0, deaths: 0, alive: true },
        { base, phase: i * 1.7, respawnAt: 0 },
      ),
    );
  }

  private updateDummy(r: Remote) {
    const d = r.dummy!;
    if (!r.info.alive) {
      if (this.time < d.respawnAt) return;
      r.info.alive = true;
      r.avatar.root.visible = true;
    }
    // Strafe side to side and hop occasionally so they're not completely free.
    const t = this.time * 0.9 + d.phase;
    const hop = Math.max(0, Math.sin(t * 2.3)) * 1.1;
    r.pos.set(d.base.x + Math.sin(t) * 2.5, d.base.y + hop, d.base.z + Math.cos(t * 0.7) * 1.2);
    r.yaw = Math.atan2(r.pos.x - this.me.pos.x, r.pos.z - this.me.pos.z); // stare at the player, menacingly
    r.avatar.pose(r.pos.x, r.pos.y, r.pos.z, r.yaw, 0, 0, this.time);
  }

  // ---------------------------------------------------------------------------
  // Network

  private sendState(dt: number) {
    this.sendAcc += dt;
    if (this.sendAcc < 1 / NET.clientSendRate) return;
    this.sendAcc %= 1 / NET.clientSendRate;
    if (!this.alive) return;
    const m = this.me;
    const msg: ClientMsg = {
      t: 'state',
      p: [round3(m.pos.x), round3(m.pos.y), round3(m.pos.z)],
      v: [round3(m.vel.x), round3(m.vel.y), round3(m.vel.z)],
      yaw: round3(this.input.yaw),
      pitch: round3(this.input.pitch),
      f: (m.wallrunning ? StateFlag.Wallrun : 0) | (m.sliding ? StateFlag.Sliding : 0),
    };
    if (m.grapple) msg.g = [round3(m.grapple.x), round3(m.grapple.y), round3(m.grapple.z)];
    // The server keeps our last state, so standing still costs nothing (every message is a billed request on Cloudflare).
    const key = JSON.stringify(msg);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.opts.net!.send(msg);
  }

  private onNet(msg: ServerMsg) {
    switch (msg.t) {
      case 'playerJoined':
        this.players.set(msg.player.id, msg.player);
        this.addRemote(msg.player);
        this.hud.killfeed(undefined, msg.player, 'joined');
        break;
      case 'playerLeft':
        this.hud.killfeed(undefined, this.players.get(msg.id), 'left');
        this.players.delete(msg.id);
        this.removeRemote(msg.id);
        break;
      case 'snapshot': {
        const now = performance.now();
        for (const s of msg.players) this.remotes.get(s.id)?.buffer.push({ t: now, s });
        if (msg.zombies) this.horde?.onSnapshot(msg.zombies, now);
        break;
      }
      case 'zombieDied': {
        const killer = this.players.get(msg.killer);
        if (killer) killer.kills++;
        const feats = msg.killer === this.selfId ? this.celebrate(msg.id, true, msg.headshot) : null;
        this.hud.killfeed(killer, ZOMBIE_INFO, feats ?? (msg.headshot ? verbFor.headshot : verbFor.snipe));
        this.horde?.kill(msg.id, new THREE.Vector3(...msg.dir), msg.headshot, this.corpses);
        sfx.zombieDown();
        break;
      }
      case 'postgame':
        this.postgame?.update(msg.rounds, msg.rows, msg.waiting, (this.wave?.timer ?? 0) - (this.time - this.waveAt), this.time);
        break;
      case 'wave':
        this.onWave(msg.wave);
        break;
      case 'hp':
        if (msg.from && msg.hp < this.hp) {
          this.hud.hurt();
          sfx.hurt();
          this.landDip = Math.min(0.25, this.landDip + 0.08);
        }
        this.hp = msg.hp;
        break;
      case 'shot': {
        const from = new THREE.Vector3(...msg.from);
        this.addTracer(from, new THREE.Vector3(...msg.to), this.players.get(msg.id)?.color ?? 0xffffff);
        this.shotLog.push({ t: this.time, id: msg.id, from, to: new THREE.Vector3(...msg.to) });
        if (this.shotLog.length > 12) this.shotLog.shift();
        sfx.distantShot(from.distanceTo(this.renderPos));
        break;
      }
      case 'kill':
        this.onKill(msg.killer, msg.victim, msg.cause, msg.dir);
        break;
      case 'respawn': {
        const p = this.players.get(msg.id);
        if (p) p.alive = true;
        if (msg.id === this.selfId) this.respawn({ pos: arr(msg.p), yaw: msg.yaw });
        else {
          const r = this.remotes.get(msg.id);
          if (r) r.buffer.length = 0;
        }
        break;
      }
    }
  }

  private onWave(w: WaveInfo) {
    const was = this.wave?.phase;
    this.wave = w;
    this.waveAt = this.time;
    if (w.phase !== 'over') this.postgame?.hide();
    if (w.phase === was) return;
    if (w.phase === 'active') {
      sfx.roundStart();
      this.hud.center(`ROUND ${w.round}`, '#ff9ec4', 2.2);
    } else if (w.phase === 'over') {
      sfx.gameOver();
      if (!this.postgame) this.hud.center('GAME OVER', '#f08a6b', 3);
    } else if (w.round > 0) {
      sfx.roundClear();
      this.hud.center('ROUND CLEARED!', '#ffd98a', 2.2);
    }
  }

  /** The Survival banner: which round and how many zombies are left, or how long until the next one. */
  private waveText(): string | null {
    const w = this.wave;
    if (!w) return null;
    const secs = Math.max(0, Math.ceil(w.timer - (this.time - this.waveAt)));
    if (w.phase === 'active') return `<b>ROUND ${w.round}</b>${w.left} zombie${w.left === 1 ? '' : 's'} left`;
    const survived = Math.max(0, w.round - 1);
    if (w.phase === 'over') return `<b>GAME OVER</b>survived ${survived} round${survived === 1 ? '' : 's'}`;
    if (w.round === 0) return `<b>SURVIVAL</b>the horde rises in ${secs}s`;
    return `<b>ROUND ${w.round} CLEARED</b>next round in ${secs}s`;
  }

  private deathSubtitle(): string | null {
    if (this.alive) return null;
    if (this.mode === 'survival') return this.wave?.phase === 'over' ? 'The horde won this time' : 'You are down. Back when the round ends';
    const left = Math.max(0, this.respawnAt - this.time);
    return left > 0 ? `respawning in ${left.toFixed(1)}s` : 'respawning…';
  }

  // ---------------------------------------------------------------------------
  // Camera, HUD, misc

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (!this.alive) {
      if (this.killcam) return; // updateKillcam owns the camera
      // Spectate our own flying corpse.
      if (this.deathCorpse?.obj.parent) {
        const target = this.deathCorpse.obj.position;
        this.deathCam.lerp(target.clone().add(new THREE.Vector3(0, 3, 0)), Math.min(1, dt * 2));
        cam.position.copy(this.deathCam);
        cam.lookAt(target);
      }
      cam.fov += (BASE_FOV - cam.fov) * Math.min(1, dt * 8);
      cam.updateProjectionMatrix();
      return;
    }
    const alpha = this.acc / TICK_DT;
    this.renderPos.set(
      lerp(this.prevPos.x, this.me.pos.x, alpha),
      lerp(this.prevPos.y, this.me.pos.y, alpha),
      lerp(this.prevPos.z, this.me.pos.z, alpha),
    );
    this.landDip = Math.max(0, this.landDip - dt * 0.8);
    // Drop the camera toward the floor while sliding (fast down, a little slower back up).
    const targetEye = this.me.sliding ? MOVE.slideEyeHeight : PLAYER.eyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * (this.me.sliding ? 14 : 9));
    cam.position.set(this.renderPos.x, this.renderPos.y + this.eyeHeight - this.landDip, this.renderPos.z);

    // Lean away from the wall while wallrunning, a little tilt while sliding, a touch of strafe tilt otherwise.
    const right = yawRight(this.input.yaw);
    const n = this.me.wallNormal;
    const targetRoll = this.me.wallrunning
      ? -(n.x * right.x + n.z * right.z) * 0.13
      : this.me.sliding
        ? 0.05 - this.moveInput.right * 0.03
        : -this.moveInput.right * 0.012;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    cam.rotation.set(this.input.pitch, this.input.yaw, this.roll);

    // FOV widens with speed: the "going fast" feeling.
    const speed = hlen(this.me.vel);
    const slideKick = this.me.sliding ? 5 : 0;
    this.fovKick = Math.max(0, this.fovKick - dt * 20);
    const targetFov = this.scoped ? WEAPON.scopedFov : BASE_FOV + slideKick + this.fovKick + Math.min(24, Math.max(0, speed - MOVE.maxGroundSpeed) * 0.5);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * (this.scoped ? 25 : 6));
    cam.updateProjectionMatrix();
    this.input.sensitivityScale = this.scoped ? WEAPON.scopedFov / BASE_FOV : 1;

    const [lx, ly] = this.input.takeLook();
    this.vm.update(dt, speed, this.me.onGround, lx, ly, this.roll);
  }

  /** Our rope runs from just below the camera (where the hand holds the reel) to the anchor. */
  private updateRopes(dt: number) {
    if (!this.alive) {
      this.ropeSelf.set(this.tmpA, null);
      return;
    }
    this.camera.updateMatrixWorld();
    const start = this.tmpA.set(0.2, -0.28, -0.45).applyMatrix4(this.camera.matrixWorld);
    const g = this.me.grapple;
    if (g) this.ropeSelf.set(start, this.tmpB.set(g.x, g.y, g.z));
    else if (this.ropeMiss.t > 0) {
      this.ropeMiss.t -= dt;
      // A short line shooting out and fading, so a whiff is visible.
      const k = Math.min(1, 1 - this.ropeMiss.t / 0.18);
      this.ropeSelf.set(start, this.tmpB.copy(start).lerp(this.ropeMiss.end, k), false);
    } else this.ropeSelf.set(start, null);
  }

  private updateHud(dt: number) {
    this.hud.setScoped(this.scoped && this.alive);
    this.hud.update(dt, hlen(this.me.vel), this.me.wallrunning, this.bolt / WEAPON.fireCooldown);
    this.hud.ammo(this.ammo, WEAPON.magSize, this.reloading > 0);
    this.hud.grapple(this.grappleState());
    sfx.setWind(this.alive && !this.hud.root.classList.contains('paused') ? SpeedFx.strength(hlen(this.me.vel)) : 0);
    this.hud.setCredit(this.vm.credit);
    this.hud.death(this.deathText, this.killcam ? null : this.deathSubtitle());
    this.hud.killcam(this.killcam ? this.deathText : null);
    this.hud.health(this.horde ? this.hp : null, SURVIVAL.playerHp);
    this.hud.wave(this.waveText());
    this.postgame?.tick(this.time);
    this.hud.liveScores(this.opts.net ? [...this.players.values()] : null, this.selfId);
    this.hud.scoreboard(this.showScores ? [...this.players.values(), ...[...this.remotes.values()].filter((r) => r.dummy).map((r) => r.info)] : null, this.selfId);
  }

  /** 'ready' lights up when pressing E right now would catch something. */
  private grappleState(): 'off' | 'ready' | 'attached' {
    if (!this.alive) return 'off';
    if (this.me.grapple) return 'attached';
    if (this.me.grappleCooldown > 0) return 'off';
    const c = this.camera.position;
    const d = lookDir(this.input.yaw, this.input.pitch);
    return findGrapple({ x: c.x, y: c.y, z: c.z }, d, MAP.boxes, this.grappleTargets()) ? 'ready' : 'off';
  }

  /** Players the rope can hook (chest height): hit one and you zip to them. */
  private grappleTargets(): GrappleTarget[] {
    const out: GrappleTarget[] = [];
    for (const r of this.remotes.values()) {
      if (r.info.alive && r.avatar.root.visible) out.push({ id: r.info.id, pos: { x: r.pos.x, y: r.pos.y + 1.0, z: r.pos.z } });
    }
    return out;
  }

  private onKey(code: string, down: boolean) {
    if (code === 'Tab') this.showScores = down;
    if (code === 'KeyR' && down) this.startReload();
    if (code === 'Backquote' && down) {
      const show = this.gui._hidden;
      this.gui.show(show);
      if (show) this.input.unlock();
    }
  }

  private buildGui(): GUI {
    const gui = new GUI({ title: 'Movement tuning (`)' });
    const f = (name: string) => gui.addFolder(name);
    const ground = f('Ground');
    ground.add(MOVE, 'maxGroundSpeed', 2, 20);
    ground.add(MOVE, 'groundAccel', 1, 30);
    ground.add(MOVE, 'friction', 0, 15);
    ground.add(MOVE, 'jumpSpeed', 3, 15);
    ground.add(MOVE, 'gravity', 5, 40);
    ground.add(MOVE, 'autoHop');
    ground.add(MOVE, 'jumpBuffer', 0, 0.3, 0.01);
    const air = f('Air');
    air.add(MOVE, 'airAccel', 0, 200);
    air.add(MOVE, 'airSpeedCap', 0.1, 5);
    const wall = f('Wallrun');
    wall.add(MOVE, 'wallrunMinSpeed', 0, 15);
    wall.add(MOVE, 'wallrunReach', 0.05, 2);
    wall.add(MOVE, 'wallrunSpeed', 2, 30);
    wall.add(MOVE, 'wallrunMaxTime', 0.2, 5);
    wall.add(MOVE, 'wallrunGravityStart', 0, 20);
    wall.add(MOVE, 'wallJumpUp', 0, 20);
    wall.add(MOVE, 'wallJumpOut', 0, 20);
    const slide = f('Slide');
    slide.add(MOVE, 'slideMinSpeed', 0, 15);
    slide.add(MOVE, 'slideEndSpeed', 0, 10);
    slide.add(MOVE, 'slideFriction', 0, 6);
    slide.add(MOVE, 'slideBoost', 0, 10);
    slide.add(MOVE, 'slideBoostCooldown', 0, 5);
    slide.add(MOVE, 'slideSteer', 0, 100);
    slide.add(MOVE, 'slideSlopeGravity', 0, 3);
    slide.add(MOVE, 'slideEyeHeight', 0.4, 1.62);
    const misc = f('Mouse');
    misc.add(this.input, 'sensitivity', 0.0005, 0.008, 0.0001);
    gui.close();
    gui.hide();
    return gui;
  }

  private resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
  };

  exit(reason?: string) {
    sfx.setWind(0);
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.unsubscribe?.();
    if (this.opts.net) {
      this.opts.net.onClose = undefined;
      this.opts.net.leave();
    }
    this.input.dispose();
    this.hud.dispose();
    this.postgame?.dispose();
    this.gui.destroy();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.horde?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.opts.onExit(reason);
  }
}

const arr = (p: V3): Vec3 => ({ x: p[0], y: p[1], z: p[2] });
/** A shot with nothing special about it, for kills we can't match to a shot of ours. */
const PLAIN_SHOT: ShotContext = { headshot: false, scoped: true, spin: 0, airTime: 0, wallrunning: false, sliding: false, speed: 0, distance: 10, rope: 'none' };
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
