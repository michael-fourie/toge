import GUI from 'lil-gui';
import * as THREE from 'three';
import { PLAYER, MOVE, NET, RESPAWN_SECONDS, TICK_DT, WEAPON } from '../shared/constants.ts';
import { raySphere, rayBox, rayWorld } from '../shared/collision.ts';
import { MAP } from '../shared/map.ts';
import { type Vec3, copy, hlen, lookDir, v3, yawRight } from '../shared/math.ts';
import { Ev, type PlayerState, createPlayerState, emptyInput, stepPlayer } from '../shared/movement.ts';
import { type DeathCause, type NetPlayerState, type PlayerInfo, type ServerMsg, StateFlag, type V3, round3 } from '../shared/protocol.ts';
import { Avatar, Corpses } from './avatar.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import type { Net } from './net.ts';
import { sfx } from './sfx.ts';
import { ViewModel } from './viewmodel.ts';
import { type World, buildWorld } from './world.ts';

type Joined = Extract<ServerMsg, { t: 'joined' }>;

export interface GameOptions {
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
  /** Offline practice targets drive themselves. */
  dummy?: { base: Vec3; phase: number; respawnAt: number };
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

const BASE_FOV = 78; // vertical; ~106° horizontal at 16:9
const tracerGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

const verbFor: Record<DeathCause, string> = { snipe: 'sniped', headshot: '💥 HEADSHOT', void: 'fell into the void' };

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

  private scoped = false;
  private bolt = 0;
  private roll = 0;
  private landDip = 0;
  /** Smoothed camera height above the feet (drops while sliding). Shots should originate here too. */
  private eyeHeight = PLAYER.eyeHeight;
  private showScores = false;
  private tracers: Tracer[] = [];
  private unsubscribe?: () => void;

  constructor(private opts: GameOptions) {
    const { container, net, joined } = opts;
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

    this.hud = new Hud(container, joined ? `LOBBY ${joined.code}` : 'PRACTICE — shoot the dummies');
    this.input = new Input(this.renderer.domElement);
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

    this.updateWeapon(dt);
    if (this.alive) this.simulate(dt);
    else if (!this.opts.net && this.time >= this.respawnAt) this.respawn(this.randomSpawn());

    if (this.opts.net) this.sendState(dt);
    this.updateRemotes();
    this.corpses.update(dt);
    this.updateTracers(dt);
    this.world.update(this.time);
    this.updateCamera(dt);
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
      stepPlayer(this.me, this.input.sample(this.moveInput), TICK_DT, MAP.boxes);
      this.onMoveEvents(this.me.events, fallSpeed);
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
    if (ev & Ev.WallJump) sfx.wallJump();
    if (ev & Ev.AirJump) sfx.airJump();
    if (ev & Ev.JumpPad) sfx.pad();
  }

  // ---------------------------------------------------------------------------
  // Weapon

  private updateWeapon(dt: number) {
    this.bolt = Math.max(0, this.bolt - dt);
    // Hold RMB to scope. The bolt cycle after a shot knocks you out of scope (CS-style);
    // if RMB is still held when it finishes, you scope straight back in.
    const wantScope = this.alive && this.input.scopeHeld && this.bolt === 0;
    if (wantScope && !this.scoped) sfx.scope();
    this.scoped = wantScope;
    if (this.input.takeFire()) this.fire();
  }

  private fire() {
    if (!this.alive || this.bolt > 0) return;
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
    const o = { x: this.renderPos.x, y: this.renderPos.y + PLAYER.eyeHeight, z: this.renderPos.z };

    let best = rayWorld(o, d, MAP.boxes, WEAPON.range);
    let victim: Remote | null = null;
    let headshot = false;
    const hw = PLAYER.halfWidth;
    for (const r of this.remotes.values()) {
      if (!r.info.alive) continue;
      const p = r.pos;
      const th = raySphere(o, d, { x: p.x, y: p.y + PLAYER.headCenter, z: p.z }, PLAYER.headRadius + 0.04, best);
      if (th >= 0 && th < best) {
        best = th;
        victim = r;
        headshot = true;
      }
      const tb = rayBox(o, d, { x: p.x - hw, y: p.y, z: p.z - hw }, { x: p.x + hw, y: p.y + PLAYER.headCenter - PLAYER.headRadius, z: p.z + hw }, best);
      if (tb >= 0 && tb < best) {
        best = tb;
        victim = r;
        headshot = false;
      }
    }
    const end = new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    const muzzle = this.camera.localToWorld(new THREE.Vector3(0.22, -0.2, -1.1));
    this.addTracer(muzzle, end, this.players.get(this.selfId)!.color);

    this.vm.fire();
    sfx.shoot();
    this.bolt = WEAPON.fireCooldown;
    this.scoped = false; // updateWeapon re-scopes after the bolt if RMB is still held
    // Rocket-sniping: firing while airborne kicks you backwards.
    if (!this.me.onGround) {
      this.me.vel.x -= d.x * MOVE.shotRecoilPush;
      this.me.vel.y -= d.y * MOVE.shotRecoilPush;
      this.me.vel.z -= d.z * MOVE.shotRecoilPush;
    }

    if (victim) {
      this.hud.hitmarker();
      sfx.hit();
    }
    if (this.opts.net) {
      this.opts.net.send({
        t: 'shoot',
        from: [round3(o.x), round3(o.y), round3(o.z)],
        to: [round3(end.x), round3(end.y), round3(end.z)],
        victim: victim?.info.id,
        headshot,
      });
    } else if (victim) {
      this.onKill(this.selfId, victim.info.id, headshot ? 'headshot' : 'snipe', [d.x, d.y, d.z]);
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
    this.hud.killfeed(killer, victim, verbFor[cause]);
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
    if (killerId === this.selfId && victimId !== this.selfId) {
      sfx.kill();
      this.hud.center(cause === 'headshot' ? 'HEADSHOT!' : pick(['YEET', 'SNIPED', 'BONK', 'GOT EM', 'SENT FLYING']), cause === 'headshot' ? '#ffd43b' : '#fff');
    }
  }

  private die(cause: DeathCause, killerId: number, dir: THREE.Vector3) {
    if (!this.alive) return;
    this.alive = false;
    this.scoped = false;
    this.input.scopeHeld = false; // must re-press RMB after respawning
    this.respawnAt = this.time + RESPAWN_SECONDS;
    sfx.death();
    const killer = this.players.get(killerId);
    this.deathText = cause === 'void' ? 'You fell into the void' : `${cause === 'headshot' ? 'Headshot' : 'Sniped'} by ${killer?.name ?? '???'}`;
    const pos = new THREE.Vector3(this.me.pos.x, this.me.pos.y, this.me.pos.z);
    this.deathCam.copy(pos).add(new THREE.Vector3(0, PLAYER.eyeHeight, 0));
    this.deathCorpse =
      cause === 'void' ? null : this.corpses.spawn(this.selfAvatar.cloneBody(), pos, this.input.yaw, dir, cause === 'headshot' ? 38 : 26);
  }

  private respawn(spawn: { pos: Vec3; yaw: number }) {
    this.me = createPlayerState(spawn.pos);
    copy(this.prevPos, this.me.pos);
    this.acc = 0;
    this.input.yaw = spawn.yaw;
    this.input.pitch = 0;
    this.alive = true;
    this.deathCorpse = null;
    const self = this.players.get(this.selfId);
    if (self) self.alive = true;
  }

  private info(id: number): PlayerInfo | undefined {
    return this.players.get(id) ?? this.remotes.get(id)?.info;
  }

  private randomSpawn() {
    const s = MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)];
    return { pos: { ...s.pos }, yaw: s.yaw };
  }

  // ---------------------------------------------------------------------------
  // Remote players

  private addRemote(info: PlayerInfo, dummy?: Remote['dummy']) {
    const avatar = new Avatar(info.color, info.name);
    avatar.root.visible = info.alive && !!dummy;
    this.world.scene.add(avatar.root);
    this.remotes.set(info.id, { info, avatar, buffer: [], pos: new THREE.Vector3(), yaw: 0, dummy });
  }

  private removeRemote(id: number) {
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
      r.avatar.root.visible = true;
      r.avatar.pose(r.pos.x, r.pos.y, r.pos.z, r.yaw, pitch, side, this.time);
    }
  }

  private spawnDummies() {
    const spots: Vec3[] = [
      { x: 0, y: 0, z: -8 },
      { x: -10, y: 0, z: 0 },
      { x: 28, y: 12, z: 20 },
      { x: -28, y: 12, z: -20 },
      { x: 0, y: 0, z: -62 },
      { x: -20, y: 1, z: -29 },
      { x: -20, y: 0, z: -45 },
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
    this.opts.net!.send({
      t: 'state',
      p: [round3(m.pos.x), round3(m.pos.y), round3(m.pos.z)],
      v: [round3(m.vel.x), round3(m.vel.y), round3(m.vel.z)],
      yaw: round3(this.input.yaw),
      pitch: round3(this.input.pitch),
      f: (m.onGround ? StateFlag.Ground : 0) | (m.wallrunning ? StateFlag.Wallrun : 0) | (this.scoped ? StateFlag.Scoped : 0),
    });
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
        break;
      }
      case 'shot': {
        const from = new THREE.Vector3(...msg.from);
        this.addTracer(from, new THREE.Vector3(...msg.to), this.players.get(msg.id)?.color ?? 0xffffff);
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

  // ---------------------------------------------------------------------------
  // Camera, HUD, misc

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (!this.alive) {
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
    const targetFov = this.scoped ? WEAPON.scopedFov : BASE_FOV + slideKick + Math.min(14, Math.max(0, speed - MOVE.maxGroundSpeed) * 0.6);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * (this.scoped ? 25 : 6));
    cam.updateProjectionMatrix();
    this.input.sensitivityScale = this.scoped ? WEAPON.scopedFov / BASE_FOV : 1;

    const [lx, ly] = this.input.takeLook();
    this.vm.update(dt, speed, this.me.onGround, lx, ly, this.roll);
  }

  private updateHud(dt: number) {
    this.hud.setScoped(this.scoped && this.alive);
    this.hud.update(dt, hlen(this.me.vel), this.me.wallrunning, !this.me.onGround && this.me.airJumpsLeft > 0, this.bolt / WEAPON.fireCooldown);
    if (this.alive) this.hud.death('', null);
    else this.hud.death(this.deathText, Math.max(0, this.respawnAt - this.time));
    this.hud.scoreboard(this.showScores ? [...this.players.values(), ...[...this.remotes.values()].filter((r) => r.dummy).map((r) => r.info)] : null, this.selfId);
  }

  private onKey(code: string, down: boolean) {
    if (code === 'Tab') this.showScores = down;
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
    air.add(MOVE, 'airJumps', 0, 5, 1);
    air.add(MOVE, 'airJumpSpeed', 2, 15);
    air.add(MOVE, 'shotRecoilPush', 0, 30);
    const wall = f('Wallrun');
    wall.add(MOVE, 'wallrunMinSpeed', 0, 15);
    wall.add(MOVE, 'wallrunReach', 0.05, 2);
    wall.add(MOVE, 'wallrunSpeed', 2, 30);
    wall.add(MOVE, 'wallrunMaxTime', 0.2, 5);
    wall.add(MOVE, 'wallrunGravityStart', 0, 20);
    wall.add(MOVE, 'wallJumpUp', 0, 20);
    wall.add(MOVE, 'wallJumpOut', 0, 20);
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
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.unsubscribe?.();
    if (this.opts.net) {
      this.opts.net.onClose = undefined;
      this.opts.net.send({ t: 'leave' });
    }
    this.input.dispose();
    this.hud.dispose();
    this.gui.destroy();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.opts.onExit(reason);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const arr = (p: V3): Vec3 => ({ x: p[0], y: p[1], z: p[2] });
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
