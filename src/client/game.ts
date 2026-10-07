import GUI from 'lil-gui';
import * as THREE from 'three';
import { GRENADE, KNIFE, PLAYER, MOVE, NET, RESPAWN_SECONDS, SURVIVAL, TICK_DT, WEAPON } from '../shared/constants.ts';
import { type Colliders, buildColliders } from '../shared/colliders.ts';
import { raySphere, rayBox, rayWorld } from '../shared/collision.ts';
import { type Use, findUse, maxHp } from '../shared/interact.ts';
import type { MapData } from '../shared/map.ts';
import { mapFor } from '../shared/maps.ts';
import { type Vec3, copy, hlen, lerp, lookDir, v3, yawRight } from '../shared/math.ts';
import { Ev, type GrappleTarget, type PlayerState, createPlayerState, emptyInput, findGrapple, stepPlayer } from '../shared/movement.ts';
import { WEAPONS, gunStats } from '../shared/weapons.ts';
import { PERKS, type PerkId, ZEPHYR_SPEED } from '../shared/perks.ts';
import { type Grenade, applyKnock, blastKnock, blastTargets, stepGrenade, throwVelocity } from '../shared/grenade.ts';
import { RECENT_SPAWNS, pickSpawn } from '../shared/spawn.ts';
import { TEAMS, sameTeam } from '../shared/teams.ts';
import { type KothState, KOTH, inZone } from '../shared/koth.ts';
import {
  type ClientMsg,
  type DeathCause,
  type GameMode,
  type NetPlayerState,
  type PlayerInfo,
  type BoxState,
  type ServerMsg,
  StateFlag,
  type ZombieHit,
  type V3,
  type WaveInfo,
  round3,
} from '../shared/protocol.ts';
import { type ShotContext, SpinMeter, Streak, featsFor } from './achievements.ts';
import { JACKETS, decodeSkin, encodeSkin } from '../shared/skin.ts';
import { COIN, decodeGear } from '../shared/items.ts';
import { stash } from './inventoryStore.ts';
import { storedSkin } from './skinStore.ts';
import { Avatar, Corpses } from './avatar.ts';
import { PostGame } from './postgame.ts';
import { Horde } from './horde.ts';
import { HillFx, HillHud } from './hill.ts';
import { IS_TOUCH, goFullscreen } from './touch.ts';
import { TouchControls } from './touchcontrols.ts';
import { Hud } from './hud.ts';
import { GrenadeFx } from './grenadefx.ts';
import { Input } from './input.ts';
import { KILLCAM, Trail, killcamText, replayTime, replaying } from './killcam.ts';
import { MINT } from './punchmachine.ts';
import { type FoundryWorld, buildFoundry } from './foundryworld.ts';
import { Loadout } from './loadout.ts';
import { NadeHud } from './nadehud.ts';
import { UseHud } from './usehud.ts';
import { Rope } from './rope.ts';
import { SpeedFx } from './speedfx.ts';
import type { Net } from './net.ts';
import { sfx } from './sfx.ts';
import { ViewModel } from './viewmodel.ts';
import { buildRustworks } from './rustworld.ts';
import { buildSummit } from './summitworld.ts';
import { buildDuneVillage } from './duneworld.ts';
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

const verbFor: Record<DeathCause, string> = { snipe: 'sniped', headshot: '💥 HEADSHOT', void: 'fell into the void', zombie: 'got munched 🧟', grenade: 'blew up 💣', knife: 'stabbed 🔪' };
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
  private foundry: FoundryWorld | null = null;
  private map: MapData;
  private cols: Colliders;
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

  // Grenades (Q): everyone's in flight, the fx, our cooldown (game time of our last throw) and its HUD.
  private grenades: { owner: number; g: Grenade; obj: THREE.Group; fuse: number }[] = [];
  private grenadeFx: GrenadeFx;
  private nadeAt = -Infinity;
  private nadeHud: NadeHud;

  // Kill-cam: trails of everyone, recent shots, and the replay in progress (if any).
  private selfTrail = new Trail();
  private shotLog: { t: number; id: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  private killcam: { deathTime: number; start: number; killerId: number; text: string; shot: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null; shotShown: boolean } | null = null;

  private knifeOut = false; // the knife is out instead of a gun
  private scoped = false; // looking through a scope (AWP): the overlay is up and the viewmodel hidden
  private aiming = false; // looking down the sights of any other gun
  private bolt = 0; // seconds until the next shot is chambered
  private loadout: Loadout;
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
  /** Battle with two sides (no friendly fire), and whether the current match has been won (scores frozen). */
  private readonly teams: boolean;
  private matchOver = false;
  /** King of the Hill: the latest hill state from the server, and its world and HUD drawings. */
  private hill: KothState | null = null;
  private hillFx: HillFx | null = null;
  private hillHud: HillHud | null = null;
  /** Phones only: the on-screen joystick and buttons. */
  private touch: TouchControls | null = null;
  private horde: Horde | null = null;
  private hp: number = SURVIVAL.playerHp;
  private wave: WaveInfo | null = null;
  private postgame: PostGame | null = null;
  private waveAt = 0; // this.time when `wave` arrived (its timer counts down from then)
  private nextGroan = 3;
  // Points, perks, the building (server-authoritative; we mirror what it tells us)
  private points = 0;
  private jug = false;
  /** Survival perks beyond Juggernog. */
  private perks: PerkId[] = [];
  /**
   * Survival: who is down (us included), when they bleed out (our clock), when Second Wind gets them up, and how far
   * a teammate's revive has got. While we're down we can't move, shoot or use anything.
   */
  private downed = new Map<number, { bleedAt: number; selfAt: number; prog: number; by: number; pausedAt: number }>();
  private reviveAt = 0;
  /** Floating "revive me" markers over downed teammates. */
  private reviveMarks = new Map<number, THREE.Sprite>();
  private doors: boolean[] = [];
  private boards: number[] = [];
  private box: BoxState = { spot: 0, phase: 'closed', gun: null, owner: 0, left: 0 };
  private use: Use | null = null;
  private repairAt = 0;
  private shadowTick = 0;
  private boxTick = 0;
  private useHud!: UseHud;

  constructor(private opts: GameOptions) {
    const { container, net, joined } = opts;
    this.mode = joined?.mode ?? 'battle';
    this.teams = !!joined?.teams;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2)); // phones: fewer pixels, steadier frame rate
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.map = mapFor(this.mode, joined?.map, joined?.koth);
    this.cols = buildColliders(this.map);
    // Neutral keeps the soft painted palette saturated; ACES washes it toward grey-orange.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';

    const color0 = joined?.players.find((p) => p.id === net?.id)?.color ?? 0xe0614f;
    if (this.mode === 'survival') {
      this.foundry = buildFoundry(this.map, this.renderer, color0); // Survival is the Foundry, at night
      this.world = this.foundry;
      this.renderer.shadowMap.autoUpdate = false; // the moon's shadows are redrawn every few frames, not every frame
    } else this.world = (joined?.map === 'rustworks' ? buildRustworks : joined?.map === 'summit' ? buildSummit : joined?.map === 'dunevillage' ? buildDuneVillage : buildWorld)(this.map, this.renderer);
    this.corpses = new Corpses(this.world.scene);
    this.ropeSelf = new Rope(this.world.scene);
    this.grenadeFx = new GrenadeFx(this.world.scene);
    if (this.map.koth) this.hillFx = new HillFx(this.world.scene, this.map.koth.zone);
    if (this.mode === 'survival') {
      this.horde = new Horde(this.world.scene);
      this.horde.onBoss = () => {
        this.hud.center('THE FOREMAN HAS ARRIVED', '#ff6b5a', 3);
        sfx.roundStart();
      };
      this.wave = joined?.wave ?? null;
      this.foundry!.onEvent = (e, at) => this.onFoundryEvent(e, at);
      this.foundry!.sync([], [], this.box);
    }

    // Players.
    this.selfId = net?.id ?? 0;
    if (joined) {
      for (const p of joined.players) this.players.set(p.id, p);
    } else {
      const skin = storedSkin(); // practice honours your skin, jacket colour included
      const color = skin?.jacket === undefined ? 0xe0614f : JACKETS[skin.jacket];
      this.players.set(0, { id: 0, name: opts.name, color, kills: 0, deaths: 0, alive: true, skin: skin ? encodeSkin(skin) : undefined });
    }
    const self = this.players.get(this.selfId)!;
    this.selfAvatar = new Avatar(self.color, self.name, false, decodeSkin(self.skin), stash.gear);
    this.vm = new ViewModel(self.color, stash.gear);
    this.loadout = new Loadout(this.mode !== 'survival', this.mode === 'survival' ? 'sparrow' : 'awp');
    this.vm.equip(this.loadout.gun!.w, false);

    const spawn = joined ? { pos: arr(joined.spawn.p), yaw: joined.spawn.yaw } : this.randomSpawn();
    this.me = createPlayerState(spawn.pos);
    copy(this.prevPos, this.me.pos);

    this.hud = new Hud(container, joined ? `${this.mode === 'survival' ? 'SURVIVAL' : 'LOBBY'} ${joined.code}` : 'PRACTICE — shoot the dummies');
    this.hud.coins(stash.inv.coins);
    this.useHud = new UseHud(this.hud.root);
    if (this.map.koth) this.hillHud = new HillHud(this.hud.root);
    this.nadeHud = new NadeHud(this.hud.root);
    this.input = new Input(this.renderer.domElement);
    if (net && this.mode === 'survival') this.postgame = new PostGame(container, this.selfId, { onAgain: () => { net.send({ t: 'again' }); void this.input.lock(); }, onHome: () => this.exit() });
    this.input.yaw = spawn.yaw;
    this.input.onLockChange = (locked) => {
      this.hud.setPaused(!locked);
      if (!locked) this.touch?.reset();
    };
    if (IS_TOUCH) {
      this.input.touchMode = true;
      this.touch = new TouchControls(this.hud.root, this.input, { onSwap: () => this.nextWeapon() });
      this.hud.root.querySelector('.resume')!.textContent = 'Tap to play';
      this.hud.root.querySelector('.resume')!.addEventListener('click', goFullscreen);
    }
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
    this.updateDowned();
    this.corpses.update(dt);
    this.updateTracers(dt);
    this.world.update(this.time);
    this.updateGrenades(dt);
    this.updateCamera(dt);
    this.recordSelf();
    this.updateRopes(dt);
    this.foundry?.setViewer(this.renderPos);
    this.updateHud(dt);

    if (this.foundry && this.shadowTick++ % 3 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.clear();
    this.renderer.render(this.world.scene, this.camera);
    if (this.alive && !this.scoped && !this.isDown) {
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
      const input = this.input.sample(this.moveInput);
      input.speedMult = this.perks.includes('zephyr') ? ZEPHYR_SPEED : 1;
      if (this.isDown) {
        // Down: you stay where you fell (gravity still settles you onto the floor).
        input.forward = input.right = 0;
        input.jump = input.jumpPressed = input.slide = input.grapplePressed = false;
      }
      stepPlayer(this.me, input, TICK_DT, this.cols.move, this.map.triggers);
      this.onMoveEvents(this.me.events, fallSpeed);
      this.airTime = this.me.onGround ? 0 : this.airTime + TICK_DT;
      this.acc -= TICK_DT;
    }
    if (this.me.pos.y < this.map.killY) {
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

  private get stats() {
    return this.loadout.stats;
  }

  private updateWeapon(dt: number) {
    this.bolt = Math.max(0, this.bolt - dt);
    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) this.loadout.finishReload();
    }
    if (this.autoReloadAt >= 0 && this.time >= this.autoReloadAt) {
      this.autoReloadAt = -1;
      this.startReload();
    }
    // Hold RMB to aim. Scoped guns (the AWP) drop you out of the scope during their bolt cycle and while reloading, CS-style;
    // if RMB is still held when it finishes you scope straight back in. Other guns just look down the sights.
    const st = this.stats;
    const want = this.alive && !this.knifeOut && this.input.scopeHeld && this.reloading === 0;
    const wantScope = want && st.scoped && this.bolt === 0;
    if (wantScope && !this.scoped) sfx.scope();
    this.scoped = wantScope;
    this.aiming = want && !st.scoped;
    this.vm.setAim(this.aiming);
    const auto = st.auto && this.input.fireHeld;
    const fire = this.input.takeFire() || auto;
    const nade = this.input.takeGrenade();
    if (this.isDown) {
      this.scoped = this.aiming = false;
      this.use = null;
      return;
    }
    if (fire) this.fire();
    if (nade) this.throwGrenade();
    if (this.horde && this.alive) this.useKeys();
  }

  /** Reload the gun in hand: not if the mag is full or there is nothing to put in it. */
  private startReload() {
    if (!this.alive || this.knifeOut || this.reloading > 0 || !this.loadout.canReload()) return;
    const empty = this.loadout.gun!.mag === 0; // the chamber's empty too: finish with a bolt cycle
    const st = this.stats;
    // The AWP also works its bolt after an empty reload (the animation does it inside the same time).
    this.reloading = st.reloadTime + (empty && st.style === 'bolt' ? WEAPON.boltTime * (st.punched ? 0.44 : 1) : 0);
    this.bolt = 0;
    this.autoReloadAt = -1;
    this.vm.reload(this.reloading, empty);
  }

  /** Switch guns (Survival: two slots). */
  private equip(slot: number) {
    if (!this.alive || this.loadout.cur === slot || !this.loadout.equip(slot)) return;
    this.reloading = 0;
    this.bolt = 0.25;
    this.autoReloadAt = -1;
    this.vm.equip(this.loadout.gun!.w, this.loadout.gun!.up);
    this.opts.net?.send({ t: 'equip', slot });
  }

  /** One ray's worth of aim: spread (tighter when aiming), then the nearest thing it hits. */
  private cast(o: Vec3, base: Vec3, spread: number, range: number) {
    const d = { ...base };
    if (spread > 0) {
      d.x += (Math.random() - 0.5) * 2 * spread;
      d.y += (Math.random() - 0.5) * 2 * spread;
      d.z += (Math.random() - 0.5) * 2 * spread;
      const l = Math.hypot(d.x, d.y, d.z);
      d.x /= l;
      d.y /= l;
      d.z /= l;
    }
    let best = rayWorld(o, d, this.cols.shot, range);
    let hit: { id: number; zombie: boolean } | null = null;
    let headshot = false;
    const targets: { id: number; pos: THREE.Vector3; zombie: boolean; s: number }[] = this.horde
      ? [...this.horde.zombies.values()].map((z) => ({ id: z.id, pos: z.pos, zombie: true, s: z.scale })) // co-op: shots pass through friends
      : [...this.remotes.values()].filter((r) => r.info.alive && !(this.teams && sameTeam(r.info, this.players.get(this.selfId)!))).map((r) => ({ id: r.info.id, pos: r.pos, zombie: false, s: 1 }));
    for (const { id, pos: p, zombie, s } of targets) {
      const hw = PLAYER.halfWidth * s; // a boss is bigger all over
      const th = raySphere(o, d, { x: p.x, y: p.y + PLAYER.headCenter * s, z: p.z }, (PLAYER.headRadius + 0.04) * s, best);
      if (th >= 0 && th < best) {
        best = th;
        hit = { id, zombie };
        headshot = true;
      }
      const tb = rayBox(o, d, { x: p.x - hw, y: p.y, z: p.z - hw }, { x: p.x + hw, y: p.y + (PLAYER.headCenter - PLAYER.headRadius) * s, z: p.z + hw }, best);
      if (tb >= 0 && tb < best) {
        best = tb;
        hit = { id, zombie };
        headshot = false;
      }
    }
    return { d, best, hit, headshot };
  }

  /** Knife on or off. Switching keeps any gun cooldown running, so it can't be used to skip it. */
  private setKnife(on: boolean) {
    if (on === this.knifeOut || !this.alive) return;
    this.knifeOut = on;
    this.scoped = false;
    this.aiming = false;
    this.vm.setAim(false);
    this.autoReloadAt = -1;
    this.vm.holdKnife(on);
    this.selfAvatar.holdKnife(on);
  }

  /** Touch swap button: gun 1 -> gun 2 (if carried) -> knife -> gun 1. */
  private nextWeapon() {
    if (this.knifeOut) this.pickGun(0);
    else if (this.loadout.cur === 0 && this.loadout.slots[1]) this.pickGun(1);
    else this.setKnife(true);
  }

  /** A gun key (1, 2): back to the guns if the knife was out. */
  private pickGun(slot: number) {
    const wasKnife = this.knifeOut;
    this.setKnife(false);
    if (!wasKnife || this.loadout.cur !== slot) this.equip(slot);
  }

  /** A knife stab: a short ray along the look direction; any hit on a player or zombie is a kill. Never costs momentum. */
  private stab() {
    const look = lookDir(this.input.yaw, this.input.pitch);
    const o = { x: this.renderPos.x, y: this.renderPos.y + this.eyeHeight, z: this.renderPos.z };
    const { best, hit } = this.cast(o, look, 0, KNIFE.range);
    this.vm.stab();
    this.bolt = KNIFE.cooldown;
    if (!hit) return;
    this.hud.hitmarker();
    sfx.hit();
    this.lastHit = { ...hit, ctx: { ...PLAIN_SHOT, scoped: true /* a stab isn't a no-scope */, distance: best, speed: hlen(this.me.vel) } };
    const end = { x: o.x + look.x * best, y: o.y + look.y * best, z: o.z + look.z * best };
    if (this.opts.net) {
      this.opts.net.send({
        t: 'shoot',
        from: [round3(o.x), round3(o.y), round3(o.z)],
        to: [round3(end.x), round3(end.y), round3(end.z)],
        victim: hit.zombie ? undefined : hit.id,
        hits: hit.zombie ? [{ z: hit.id }] : undefined,
        knife: true,
      });
    } else this.onKill(this.selfId, hit.id, 'knife', [look.x, look.y, look.z]);
  }

  private fire() {
    if (!this.alive || this.bolt > 0 || this.reloading > 0) return;
    if (this.knifeOut) return this.stab();
    const g = this.loadout.gun!;
    if (g.mag === 0) {
      sfx.dryFire();
      this.input.fireHeld = false; // an empty auto gun clicks once, not a hundred times
      this.startReload();
      return;
    }
    const st = this.stats;
    const look = lookDir(this.input.yaw, this.input.pitch);
    const spread = this.scoped || this.aiming ? st.adsSpread : st.spread;
    // Shoot from where the camera actually is (lower while sliding).
    const o = { x: this.renderPos.x, y: this.renderPos.y + this.eyeHeight, z: this.renderPos.z };
    const muzzle = this.camera.localToWorld(new THREE.Vector3(0.22, -0.2, -1.1));
    const color = st.punched ? MINT : st.style === 'ray' ? 0xaaffee : this.players.get(this.selfId)!.color;

    const hits: ZombieHit[] = [];
    let first: { id: number; zombie: boolean; headshot: boolean; best: number } | null = null;
    let end = new THREE.Vector3();
    let victim: { id: number; headshot: boolean } | null = null;
    for (let i = 0; i < st.pellets; i++) {
      const r = this.cast(o, look, spread, WEAPON.range);
      end = new THREE.Vector3(o.x + r.d.x * r.best, o.y + r.d.y * r.best, o.z + r.d.z * r.best);
      if (i < 4 || st.pellets === 1) this.addTracer(muzzle, end, color);
      if (!r.hit) continue;
      if (!first) first = { ...r.hit, headshot: r.headshot, best: r.best };
      if (r.hit.zombie) hits.push({ z: r.hit.id, h: r.headshot || undefined });
      else victim = { id: r.hit.id, headshot: r.headshot };
    }
    if (first) {
      this.hud.hitmarker();
      sfx.hit();
      const ctx: ShotContext = {
        headshot: first.headshot,
        scoped: this.scoped,
        spin: this.spin.spin(this.input.yaw),
        airTime: this.airTime,
        wallrunning: this.me.wallrunning,
        sliding: this.me.sliding,
        speed: hlen(this.me.vel),
        distance: first.best,
        rope: this.me.grapple ? (this.me.grappleTarget === first.id && !first.zombie ? 'target' : 'surface') : 'none',
      };
      this.lastHit = { id: first.id, zombie: first.zombie, ctx };
    }

    this.loadout.fire();
    this.vm.fire(g.mag === 0);
    sfx.gun(st.style, st.punched);
    this.fovKick = Math.max(this.fovKick, st.style === 'pump' || st.style === 'revolver' ? 2.5 : 0.6);
    if (g.mag > 0) this.bolt = st.fireCooldown;
    else this.autoReloadAt = this.time + 0.25; // last round: drop straight into a reload
    this.scoped = false; // updateWeapon re-scopes after the bolt if RMB is still held

    if (this.opts.net) {
      this.opts.net.send({
        t: 'shoot',
        from: [round3(o.x), round3(o.y), round3(o.z)],
        to: [round3(end.x), round3(end.y), round3(end.z)],
        victim: victim?.id,
        headshot: victim?.headshot,
        hits: hits.length ? hits : undefined,
      });
    } else if (victim) {
      this.onKill(this.selfId, victim.id, victim.headshot ? 'headshot' : 'snipe', [look.x, look.y, look.z]);
    }
  }

  // ---------------------------------------------------------------------------
  // Survival: doors, wall guns, the box and the windows (F)

  private useCtx() {
    const downed = [...this.downed.keys()]
      .filter((id) => id !== this.selfId && this.remotes.has(id))
      .map((id) => ({ id, pos: this.remotes.get(id)!.pos, name: this.players.get(id)?.name ?? '???' }));
    return { lay: this.map.survival!, doorsOpen: this.doors, boards: this.boards, box: this.box, points: this.points, slots: this.loadout.slots.map((s) => (s ? { w: s.w, up: s.up } : null)), cur: this.loadout.cur, jug: this.jug, perks: this.perks, downed, self: this.selfId };
  }

  /** Works out what F would do here (for the prompt) and, while F is held at a window, nails boards back up. */
  private useKeys() {
    if (!this.map.survival) return;
    const p = this.me.pos;
    this.use = findUse(p, this.useCtx());
    const u = this.use;
    if (u?.kind === 'board' && this.input.down(this.input.keymap.use) && this.time >= this.repairAt) {
      this.repairAt = this.time + SURVIVAL.repairTime;
      this.opts.net?.send({ t: 'use', kind: 'board', id: u.id });
    }
    // Reviving is a hold too: keep telling the server we're still at it.
    if (u?.kind === 'revive' && this.input.down(this.input.keymap.use) && this.time >= this.reviveAt) {
      this.reviveAt = this.time + 0.2;
      this.opts.net?.send({ t: 'use', kind: 'revive', id: u.id });
    }
  }

  private get isDown() {
    return this.downed.has(this.selfId);
  }

  /** Someone went down (maybe us): they lie where they fell with a bleed-out timer. */
  private onDowned(m: Extract<ServerMsg, { t: 'downed' }>) {
    this.downed.set(m.id, { bleedAt: this.time + m.bleed, selfAt: m.self === undefined ? Infinity : this.time + m.self, prog: 0, by: 0, pausedAt: 0 });
    const p = this.players.get(m.id);
    if (p) p.down = true;
    if (m.id === this.selfId) {
      sfx.death();
      this.scoped = false;
      this.input.scopeHeld = false;
      this.hud.center(m.self === undefined ? 'YOU ARE DOWN!' : 'SECOND WIND!', '#ff6b5a', 2);
    } else this.hud.killfeed(undefined, p, 'is down! Revive them');
  }

  private onRevived(id: number) {
    this.downed.delete(id);
    const p = this.players.get(id);
    if (p) p.down = false;
    this.reviveMarks.get(id)?.removeFromParent();
    this.reviveMarks.delete(id);
    if (id === this.selfId) {
      sfx.roundClear();
      this.hud.center('BACK ON YOUR FEET', '#9fe08a', 1.6);
    }
  }

  /** Downed teammates lie on their side with a pulsing revive marker over them (filling as someone revives them). */
  private updateDowned() {
    for (const [id, d] of this.downed) {
      if (id === this.selfId) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      let mark = this.reviveMarks.get(id);
      if (!mark) {
        mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: reviveIcon(), transparent: true, depthTest: false }));
        mark.renderOrder = 5;
        this.reviveMarks.set(id, mark);
        this.world.scene.add(mark);
      }
      mark.position.set(r.pos.x, r.pos.y + 1.4 + Math.sin(this.time * 3) * 0.08, r.pos.z);
      const s = 0.7 + d.prog * 0.5;
      mark.scale.set(s, s, 1);
      mark.material.opacity = 0.65 + 0.35 * Math.abs(Math.sin(this.time * 4));
    }
  }

  private pressUse() {
    const u = this.use;
    if (!u || u.kind === 'board' || u.kind === 'revive') return; // both are holds (useKeys)
    if (u.status !== 'ready') return sfx.denied();
    this.opts.net?.send({ t: 'use', kind: u.kind, id: u.id });
  }

  /** The building made a sound (planks, doors, the box): play it. */
  private onFoundryEvent(e: 'plank' | 'nail' | 'door' | 'tick' | 'plush', at: Vec3) {
    const d = Math.hypot(at.x - this.renderPos.x, at.z - this.renderPos.z);
    if (d > 60) return;
    if (e === 'plank') sfx.plank();
    else if (e === 'nail') sfx.nail();
    else if (e === 'door') sfx.door();
    else if (e === 'plush') sfx.plush();
    else sfx.boxTick(this.boxTick++);
  }

  // ---------------------------------------------------------------------------
  // Grenades

  /** Progress 0..1 to our next grenade; 1 = one in hand. */
  private nadeProgress() {
    return Math.min(1, (this.time - this.nadeAt) / GRENADE.cooldown);
  }

  private throwGrenade() {
    if (!this.alive || this.nadeProgress() < 1) return;
    const look = lookDir(this.input.yaw, this.input.pitch);
    const o = { x: this.renderPos.x + look.x * 0.5, y: this.renderPos.y + this.eyeHeight - 0.15 + look.y * 0.5, z: this.renderPos.z + look.z * 0.5 };
    const v = throwVelocity(this.input.yaw, this.input.pitch, this.me.vel); // your own velocity rides along: throws keep your momentum
    this.nadeAt = this.time;
    this.spawnGrenade(this.selfId, o, v);
    sfx.throwNade();
    this.opts.net?.send({ t: 'nade', p: [round3(o.x), round3(o.y), round3(o.z)], v: [round3(v.x), round3(v.y), round3(v.z)] });
  }

  private spawnGrenade(owner: number, pos: Vec3, vel: Vec3) {
    this.grenades.push({ owner, g: { pos: { ...pos }, vel: { ...vel }, age: 0 }, obj: this.grenadeFx.makeGrenade(), fuse: GRENADE.fuse });
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const n = this.grenades[i];
      const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
      for (let s = 0; s < steps; s++) stepGrenade(n.g, dt / steps, this.cols.move);
      n.obj.position.set(n.g.pos.x, n.g.pos.y, n.g.pos.z);
      n.obj.rotation.x += dt * 9;
      n.obj.rotation.z += dt * 6;
      this.grenadeFx.tick(n.obj, n.g.age);
      if (n.owner === this.selfId && n.g.age >= n.fuse) {
        // Ours: it goes off here and now; the server just validates the blast and does the damage.
        const p = { ...n.g.pos };
        this.removeGrenade(i);
        this.opts.net?.send({ t: 'boom', p: [round3(p.x), round3(p.y), round3(p.z)] });
        this.blast(p, this.selfId);
        if (!this.opts.net) this.practiceBlast(p);
      } else if (n.owner !== this.selfId && n.g.age >= n.fuse + 1.5) {
        this.removeGrenade(i); // the thrower's blast never arrived (they left?): don't hang around
      }
    }
    this.grenadeFx.update(dt);
    this.nadeHud.update(this.nadeProgress(), GRENADE.cooldown - (this.time - this.nadeAt));
  }

  private removeGrenade(i: number) {
    this.grenades[i].obj.removeFromParent();
    this.grenades.splice(i, 1);
  }

  /** Everyone sees and hears the blast, and anyone close gets shoved (thrower included) without losing speed. */
  private blast(p: Vec3, owner: number) {
    this.grenadeFx.explode(p);
    // The thrower's matching grenade (if we were still simulating it) is replaced by the reported blast.
    if (owner !== this.selfId) {
      const j = this.grenades.findIndex((n) => n.owner === owner);
      if (j >= 0) this.removeGrenade(j);
    }
    const dist = Math.hypot(p.x - this.renderPos.x, p.y - this.renderPos.y, p.z - this.renderPos.z);
    sfx.boom(dist);
    if (!this.alive) return;
    const k = blastKnock(p, this.me.pos, this.cols.move);
    if (k) {
      applyKnock(this.me.vel, k);
      this.me.onGround = false;
      this.fovKick = Math.max(this.fovKick, 6 * (k.speed / GRENADE.knock));
      this.landDip = Math.min(0.25, this.landDip + 0.12 * (k.speed / GRENADE.knock));
    }
  }

  /** Offline practice: the dummies inside the blast go down. */
  private practiceBlast(p: Vec3) {
    const targets = [...this.remotes.values()].filter((r) => r.dummy && r.info.alive).map((r) => ({ id: r.info.id, pos: { x: r.pos.x, y: r.pos.y, z: r.pos.z } }));
    for (const id of blastTargets(p, targets, this.cols.shot)) {
      const r = this.remotes.get(id)!;
      this.onKill(this.selfId, id, 'grenade', [r.pos.x - p.x, r.pos.y + 1.8 - p.y, r.pos.z - p.z]);
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

    if (this.downed.has(victimId)) this.onRevived(victimId); // bled out: no longer "down", just dead (quietly)
    if (victimId === this.selfId) {
      this.die(cause, killerId, d);
    } else {
      const r = this.remotes.get(victimId);
      if (r) {
        r.avatar.root.visible = false;
        r.buffer.length = 0;
        if (cause !== 'void') this.corpses.spawn(r.avatar.cloneBody(), r.pos, r.yaw, d, this.horde ? 0 : cause === 'headshot' ? 38 : 26); // Survival: no flinging, they just lie there
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
    if (!zombie && this.opts.net && this.mode === 'battle') this.award(COIN.kill); // practice dummies pay nothing
    const all = [...style, ...extra];
    if (all.length === 0) this.hud.center(pick(YEETS));
    else if (all.length === 1 && style[0]?.label === 'HEADSHOT') this.hud.center('HEADSHOT!', '#ffd43b'); // the classic
    else {
      this.hud.feats(style, extra);
      sfx.feats(all.length, Math.max(...all.map((f) => f.tier)));
    }
    return style.length ? style.map((f) => f.label).join(' ') : null;
  }

  /** Coins for something we did (client-side, like the rest of the stash): saved, and floated up on the HUD. */
  private award(n: number) {
    stash.earn(n);
    this.hud.coins(stash.inv.coins, n);
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
          : cause === 'grenade'
            ? `Blown up by ${killer?.name ?? '???'}`
            : `${cause === 'headshot' ? 'Headshot' : cause === 'knife' ? 'Stabbed' : 'Sniped'} by ${killer?.name ?? '???'}`;
    const pos = new THREE.Vector3(this.me.pos.x, this.me.pos.y, this.me.pos.z);
    this.deathCam.copy(pos).add(new THREE.Vector3(0, PLAYER.eyeHeight, 0));
    // Survival: you bled out where you lay, so the body just slumps there instead of being flung.
    const power = this.horde ? 0 : cause === 'headshot' ? 38 : 26;
    this.deathCorpse = cause === 'void' ? null : this.corpses.spawn(this.selfAvatar.cloneBody(), pos, this.input.yaw, dir, power);
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
    const at = killer.trail.at(Infinity)!;
    const metres = Math.hypot(at.x - this.me.pos.x, at.y - this.me.pos.y, at.z - this.me.pos.z);
    this.killcam = { deathTime: this.time, start: this.time, killerId, text: killcamText(this.deathText, metres), shot, shotShown: false };
    this.world.scene.add(this.selfAvatar.root);
    if (this.deathCorpse) this.deathCorpse.obj.visible = false; // it flies at the end of the replay, not the start
  }

  private endKillcam() {
    this.killcam = null;
    this.selfAvatar.root.removeFromParent();
    if (this.deathCorpse) this.deathCorpse.obj.visible = true;
    // Replay poses ignore who is alive now: hide the dead again (updateRemotes skips them).
    for (const r of this.remotes.values()) if (!r.dummy) r.avatar.root.visible = r.info.alive;
  }

  private updateKillcam() {
    const kc = this.killcam!;
    const elapsed = this.time - kc.start;
    if (this.alive || !replaying(elapsed) || !this.remotes.has(kc.killerId)) {
      this.endKillcam();
      this.updateRemotes();
      return;
    }
    const T = replayTime(elapsed, kc.deathTime);
    const Tr = T + KILLCAM.remoteLag;
    for (const r of this.remotes.values()) {
      if (r.dummy) continue;
      const p = r.trail.at(Tr);
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
    const kt = this.remotes.get(kc.killerId)!.trail;
    const k = kt.at(Tr) ?? kt.at(Infinity); // joined mid-window: start from their earliest pose
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
    this.loadout.refill();
    this.bolt = this.reloading = 0;
    this.autoReloadAt = -1;
    this.setKnife(false); // back to the guns
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
    const i = pickSpawn(this.map.spawns, dummies, this.recentSpawns, this.map.boxes);
    this.recentSpawns.push(i);
    if (this.recentSpawns.length > RECENT_SPAWNS) this.recentSpawns.shift();
    const s = this.map.spawns[i];
    return { pos: { ...s.pos }, yaw: s.yaw };
  }

  // ---------------------------------------------------------------------------
  // Remote players

  private addRemote(info: PlayerInfo, dummy?: Remote['dummy']) {
    const avatar = new Avatar(info.color, info.name, false, decodeSkin(info.skin), decodeGear(info.gear));
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
      r.avatar.holdKnife((e.f & StateFlag.Knife) !== 0);
      const sliding = (e.f & StateFlag.Sliding) !== 0;
      r.avatar.pose(r.pos.x, r.pos.y, r.pos.z, r.yaw, pitch, side, this.time, sliding);
      r.avatar.root.rotation.z = r.info.down ? Math.PI / 2 : 0; // down: lying on their side
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
      f: (m.wallrunning ? StateFlag.Wallrun : 0) | (m.sliding ? StateFlag.Sliding : 0) | (this.knifeOut ? StateFlag.Knife : 0),
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
        if (msg.koth) this.onHill(msg.koth);
        break;
      }
      case 'zombieDied': {
        const killer = this.players.get(msg.killer);
        if (killer) killer.kills++;
        const feats = msg.killer === this.selfId ? this.celebrate(msg.id, true, msg.headshot) : null;
        this.hud.killfeed(killer, ZOMBIE_INFO, feats ?? (msg.headshot ? verbFor.headshot : verbFor.snipe));
        this.horde?.kill(msg.id, new THREE.Vector3(...msg.dir), msg.headshot, this.corpses);
        sfx.zombieDown();
        if (msg.boss) {
          this.award(COIN.boss); // everyone, not just whoever landed the kill
          this.hud.center(`THE FOREMAN IS DOWN! +${COIN.boss} COINS`, '#ffd98a', 3);
          sfx.roundClear();
        }
        break;
      }
      case 'teams':
        for (const t of msg.players) {
          const p = this.players.get(t.id);
          if (!p) continue;
          p.team = t.team;
          p.color = t.color;
          if (t.id === this.selfId || !this.remotes.has(t.id)) continue;
          this.removeRemote(t.id); // the avatar's colours are baked in: rebuild it in the new team's
          this.addRemote(p);
        }
        break;
      case 'matchOver':
        this.onMatchOver(msg);
        break;
      case 'matchStart':
        this.matchOver = false;
        this.streak.reset();
        for (const n of msg.players) {
          const p = this.players.get(n.id);
          if (p) p.kills = p.deaths = 0;
        }
        this.hud.center('GO!', '#9fe08a', 1.4);
        sfx.roundStart();
        break;
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
      case 'me':
        this.onMe(msg);
        break;
      case 'downed':
        this.onDowned(msg);
        break;
      case 'reviving': {
        const d = this.downed.get(msg.id);
        if (d) {
          // The bleed-out clock stops while someone is reviving (the server pauses it too): push it back by the pause.
          if (msg.by && !d.by) d.pausedAt = this.time;
          if (!msg.by && d.by) d.bleedAt += this.time - d.pausedAt;
          d.prog = msg.prog;
          d.by = msg.by;
        }
        break;
      }
      case 'revived':
        this.onRevived(msg.id);
        break;
      case 'world':
        this.onWorld(msg);
        break;
      case 'nade': {
        const o = { x: msg.p[0], y: msg.p[1], z: msg.p[2] };
        this.spawnGrenade(msg.id, o, { x: msg.v[0], y: msg.v[1], z: msg.v[2] });
        break;
      }
      case 'blast':
        if (msg.id !== this.selfId) this.blast({ x: msg.p[0], y: msg.p[1], z: msg.p[2] }, msg.id); // ours already went off locally
        break;
      case 'shot': {
        const from = new THREE.Vector3(...msg.from);
        this.addTracer(from, new THREE.Vector3(...msg.to), msg.up ? MINT : msg.w === 'sunbeam' ? 0xaaffee : (this.players.get(msg.id)?.color ?? 0xffffff));
        this.shotLog.push({ t: this.time, id: msg.id, from, to: new THREE.Vector3(...msg.to) });
        if (this.shotLog.length > 12) this.shotLog.shift();
        if (msg.w) sfx.distantGun(WEAPONS[msg.w].style, from.distanceTo(this.renderPos));
        else sfx.distantShot(from.distanceTo(this.renderPos));
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

  /** Our points, perks and guns, as the server sees them. A different gun in our hands (bought, taken from the box, punched) gets drawn. */
  private onMe(m: Extract<ServerMsg, { t: 'me' }>) {
    this.points = m.pts;
    const perks = m.perks ?? [];
    const fresh = perks.filter((p) => !this.perks.includes(p));
    this.perks = perks;
    for (const p of fresh) {
      sfx.jug();
      this.hud.center(`${PERKS[p].name.toUpperCase()}!`, '#' + PERKS[p].color.toString(16).padStart(6, '0'), 2.2);
    }
    if (!!m.jug !== this.jug) {
      this.jug = !!m.jug;
      if (this.jug) {
        sfx.jug();
        this.hud.center(`JUGGERNOG! ${maxHp(true)} HP`, '#ff8a6a', 2.2);
      }
    }
    const was = this.loadout.gun;
    const changed = this.loadout.sync(m.slots, m.cur, m.fill);
    const now = this.loadout.gun!;
    if (changed || m.fill?.includes(this.loadout.cur)) {
      this.bolt = this.reloading = 0;
      this.autoReloadAt = -1;
      this.knifeOut = false; // vm.equip puts the gun back in hand
      this.selfAvatar.holdKnife(false);
      this.vm.equip(now.w, now.up, changed);
    }
    if (changed && was) {
      if (now.up && was.w === now.w) {
        sfx.punch();
        this.hud.center('PACK-A-PUNCHED!', '#8ff5d0', 2.2);
        this.hud.punch(0.8);
      } else sfx.cash();
    }
  }

  /** The building changed: a door opened, a board came off or went up, the box moved or did something. */
  private onWorld(m: Extract<ServerMsg, { t: 'world' }>) {
    const colliders = m.doors.some((d, i) => d !== !!this.doors[i]) || m.boards.some((b, i) => b > 0 !== (this.boards[i] > 0));
    this.doors = m.doors;
    this.boards = m.boards;
    this.box = m.box;
    if (colliders || !this.foundry) this.cols = buildColliders(this.map, this.doors, this.boards);
    this.foundry?.sync(m.doors, m.boards, m.box);
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
      if (was === 'active') this.award(COIN.round); // everyone in the lobby, up or down
    }
  }

  /** A new hill state from the server: announce a change of hands. */
  private onHill(s: KothState) {
    const was = this.hill;
    this.hill = s;
    if (!was || s.owner === was.owner || s.owner === null) return;
    const mine = this.players.get(this.selfId)?.team === s.owner;
    this.hud.center(mine ? 'HILL CAPTURED!' : `${TEAMS[s.owner].name.toUpperCase()} TOOK THE HILL`, '#' + TEAMS[s.owner].color.toString(16).padStart(6, '0'), 2);
    if (mine) sfx.roundClear();
    else sfx.roundStart();
  }

  /** A side or a player hit the kill limit: freeze the scores, show the board and name the winner. */
  private onMatchOver(msg: Extract<ServerMsg, { t: 'matchOver' }>) {
    this.matchOver = true;
    for (const n of msg.players) {
      const p = this.players.get(n.id);
      if (p) {
        p.kills = n.kills;
        p.deaths = n.deaths;
      }
    }
    const me = this.players.get(this.selfId);
    const w = msg.winner;
    const won = 'team' in w ? me?.team === w.team : w.id === this.selfId;
    const color = 'team' in w ? TEAMS[w.team].color : (this.players.get(w.id)?.color ?? 0xffffff);
    const who = 'team' in w ? `${TEAMS[w.team].name.toUpperCase()} WINS!` : `${(this.players.get(w.id)?.name ?? '???').toUpperCase()} WINS!`;
    this.hud.center(who, '#' + color.toString(16).padStart(6, '0'), msg.restartIn);
    if (won) this.award(COIN.win);
    if (won) sfx.roundClear();
    else sfx.gameOver();
  }

  /** The Survival banner: which round and how many zombies are left, or how long until the next one. */
  private waveText(): string | null {
    const w = this.wave;
    if (!w) return null;
    const secs = Math.max(0, Math.ceil(w.timer - (this.time - this.waveAt)));
    if (w.phase === 'active') return `<b>ROUND ${w.round}${w.boss ? ' · BOSS' : ''}</b>${w.left} zombie${w.left === 1 ? '' : 's'} left`;
    const survived = Math.max(0, w.round - 1);
    if (w.phase === 'over') return `<b>GAME OVER</b>survived ${survived} round${survived === 1 ? '' : 's'}`;
    if (w.round === 0) return `<b>SURVIVAL</b>the horde rises in ${secs}s`;
    return `<b>ROUND ${w.round} CLEARED</b>next round in ${secs}s`;
  }

  /** Under "You are down!": who is getting you up, Second Wind's countdown, or how long until you bleed out. */
  private downText(d: { bleedAt: number; selfAt: number; prog: number; by: number; pausedAt: number }): string {
    if (d.by) return `${this.players.get(d.by)?.name ?? 'A teammate'} is reviving you… ${Math.round(d.prog * 100)}%`;
    if (Number.isFinite(d.selfAt)) return `Second Wind gets you up in ${Math.max(0, d.selfAt - this.time).toFixed(1)}s`;
    return `Bleeding out in ${Math.ceil(Math.max(0, d.bleedAt - this.time))}s · a teammate can hold F beside you to revive you`;
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
    const targetEye = this.isDown ? 0.45 : this.me.sliding ? MOVE.slideEyeHeight : PLAYER.eyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * (this.me.sliding ? 14 : 9));
    cam.position.set(this.renderPos.x, this.renderPos.y + this.eyeHeight - this.landDip, this.renderPos.z);

    // Lean away from the wall while wallrunning, a little tilt while sliding, a touch of strafe tilt otherwise.
    const right = yawRight(this.input.yaw);
    const n = this.me.wallNormal;
    const targetRoll = this.isDown
      ? 0.35 // slumped over
      : this.me.wallrunning
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
    const zoom = this.scoped ? this.stats.zoomFov : this.aiming ? this.stats.zoomFov : 0;
    const targetFov = zoom ? zoom : BASE_FOV + slideKick + this.fovKick + Math.min(24, Math.max(0, speed - MOVE.maxGroundSpeed) * 0.5);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * (this.scoped ? 25 : this.aiming ? 14 : 6));
    cam.updateProjectionMatrix();
    this.input.sensitivityScale = zoom ? zoom / BASE_FOV : 1;

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
    this.hud.update(dt, hlen(this.me.vel), this.me.wallrunning, this.bolt / this.stats.fireCooldown);
    const gun = this.loadout.gun!;
    this.hud.ammo(gun.mag, this.stats.mag, this.horde || gun.reserve !== Infinity ? gun.reserve : null, this.reloading > 0, this.stats.label, this.horde ? this.loadout.slots.map((s) => (s ? gunStats(s.w, s.up).label : null)) : [], this.loadout.cur);
    this.useHud.update(this.horde ? this.points : null, this.alive ? this.use : null);
    this.touch?.update(this.alive && !!this.use);
    this.hud.grapple(this.grappleState());
    sfx.setWind(this.alive && !this.hud.root.classList.contains('paused') ? SpeedFx.strength(hlen(this.me.vel)) : 0);
    this.hud.setCredit(this.vm.credit);
    const down = this.downed.get(this.selfId);
    if (down) this.hud.death('You are down!', this.downText(down));
    else this.hud.death(this.deathText, this.killcam ? null : this.deathSubtitle());
    this.hud.killcam(this.killcam ? this.killcam.text : null);
    this.hud.health(this.horde ? this.hp : null, maxHp(this.jug));
    this.hud.wave(this.waveText());
    this.hud.boss(this.horde?.bossHp() ?? null);
    this.postgame?.tick(this.time);
    this.hud.liveScores(this.opts.net ? [...this.players.values()] : null, this.selfId, this.teams, this.hill ? `Hold the hill for ${KOTH.holdToWin / 60} minutes` : undefined);
    this.hillFx?.update(this.hill, this.time);
    this.hillHud?.update(this.hill, this.players.get(this.selfId)?.team, this.alive && !!this.map.koth && inZone(this.map.koth.zone, this.me.pos));
    this.hud.scoreboard(this.showScores || this.matchOver ? [...this.players.values(), ...[...this.remotes.values()].filter((r) => r.dummy).map((r) => r.info)] : null, this.selfId, this.teams);
  }

  /** 'ready' lights up when pressing E right now would catch something. */
  private grappleState(): 'off' | 'ready' | 'attached' {
    if (!this.alive) return 'off';
    if (this.me.grapple) return 'attached';
    if (this.me.grappleCooldown > 0) return 'off';
    const c = this.camera.position;
    const d = lookDir(this.input.yaw, this.input.pitch);
    return findGrapple({ x: c.x, y: c.y, z: c.z }, d, this.cols.shot, this.grappleTargets()) ? 'ready' : 'off';
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
    const k = this.input.keymap;
    if (code === k.scores) this.showScores = down;
    if (code === k.reload && down && !this.knifeOut) this.startReload();
    if ((code === 'Space' || code === 'Enter') && down && this.killcam) this.killcam.start = -Infinity; // skip the replay
    if (code === k.use && down && this.alive) this.pressUse();
    if (code === 'Digit1' && down) this.pickGun(0);
    // The knife is 2 when you carry one gun, 3 when you carry two (2 is then your second gun).
    if (code === 'Digit2' && down) this.loadout.slots[1] ? this.pickGun(1) : this.setKnife(true);
    if (code === 'Digit3' && down) this.setKnife(true);
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
    disposeScene(this.world.scene); // frees the map's GPU memory: the Foundry is a lot of canvas textures
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.opts.onExit(reason);
  }
}

/** Frees every geometry, material and texture under a scene. */
function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
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

let reviveTex: THREE.CanvasTexture | null = null;
/** The marker over a downed teammate: a white disc with a red cross. */
function reviveIcon(): THREE.CanvasTexture {
  if (reviveTex) return reviveTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fffdf3';
  g.strokeStyle = '#4a3726';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#d9584a';
  g.fillRect(26, 14, 12, 36);
  g.fillRect(14, 26, 36, 12);
  reviveTex = new THREE.CanvasTexture(c);
  reviveTex.colorSpace = THREE.SRGBColorSpace;
  return reviveTex;
}
