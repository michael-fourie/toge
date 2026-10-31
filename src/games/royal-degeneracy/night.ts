// One night in the house, on this screen: your walker and camera, everyone else (interpolated 100 ms behind),
// bodies, doors, the torch, footsteps, what's under your crosshair, chores, meetings, the eviction walk and the
// case-closed card. The referee (host) decides everything that matters; this only asks and shows.

import * as THREE from 'three';
import { rayBox, raySphere, rayWorld } from '../../shared/collision.ts';
import type { Vec3 } from '../../shared/math.ts';
import { lerp } from '../../shared/math.ts';
import type { GameApi } from '../types.ts';
import { Audio, type Muffle } from './audio.ts';
import { CAST, eyeHeight, lookFor, tagFor, type CharId } from './cast.ts';
import { caseById } from './cases.ts';
import { ChoreView } from './chores.ts';
import { ITEM, SEARCH_SECONDS, WIPE_SECONDS, fits, unlockTime, type Cat } from './clues.ts';
import { BINBAG_DROP, DOORS, DUO_PAIRS, FLOOR_Y, MEETING_CENTRE, PERCHES, REACH, ROOMS, SEATS, SPOTS, standFrom, doorBox, floorOf, roomAt, wakeSpot, type Door, type Spot } from './house.ts';
import { Hud, KEYS, chip, loadPrefs, type Prefs } from './hud.ts';
import { Input, type Frame } from './input.ts';
import { portrait } from './lobby.ts';
import { Meeting } from './meeting.ts';
import { Evidence, InspectView, Phone, PlantMenu, crimeName, type FeedItem, type Known, type PhoneTab } from './mystery.ts';
import { POWERS, powerOf, type Power } from './abilities.ts';
import { Glows, PowerUI } from './powers.ts';
import { IS_TOUCH, TouchControls } from './touch.ts';
import { Voice, voiceGain, type VoiceMsg } from './voice.ts';
import { SAB, SABOTAGES, type SabKind } from './sabotage.ts';
import { newWalker, nudgeApart, shove, stepWalker } from './move.ts';
import { EMOTES, PF, type Msg } from './net.ts';
import { Person } from './people.ts';
import { saveNight } from './stats.ts';
import { VIBES, clearRip, comingDown, drag, exhaleJoint, eyeShift, heldCode, high, light, line, newVibe, pack, packed, pickUp, pill, putDown, ripDraw, rolled, sober, speedOf, tripping, wired, type Exhale } from './vices.ts';
import { HeldView, SmokeFx } from './smoke.ts';
import { KILL_RANGE, TIMES, type Joiner, type PrivateView, type PublicView, type Status } from './rules.ts';
import { World } from './world.ts';

const POSE_HZ = 15;
/** The doorbell camera hangs just outside the front door. */
const DOOR_CAM_Z = 20.3;
const INTERP_MS = 100;
const STEP_EVERY = 0.75;
const SHOVE_RANGE = 1.5;
const TORCH_POWER = 26;

export interface SessionOpts {
  root: HTMLElement;
  renderer: THREE.WebGLRenderer;
  api: GameApi;
  me: number;
  people: Joiner[];
  /** Requests to the referee (the host handles its own locally). */
  toHost(m: Msg): void;
  /** To every other player (poses, chat). */
  toAll(m: Msg): void;
  /** Voice-chat signalling, to everyone or one player. */
  voiceOut(m: VoiceMsg, to?: number): void;
  /** True when this browser is the referee (so poses also go to it locally). */
  hosting: boolean;
  leave(): void;
}

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  e: number;
  h: number;
}

interface Remote {
  id: number;
  name: string;
  char: CharId;
  person: Person;
  cone: THREE.Mesh;
  buf: Snap[];
  pos: Vec3;
  yaw: number;
  pitch: number;
  f: number;
  speed: number;
  walked: number;
  /** Their emote (net.ts EMOTES index), so a new wave pops a speech bubble. */
  e: number;
  /** What's in their hands (vices.ts heldCode), and when their next wisp and puff of smoke are due. */
  h: number;
  wispIn: number;
  puffIn: number;
}

/** The house's bongs, in order (a pose's held code 3 + n is the n-th). */
const BONGS = SPOTS.filter((s) => s.vice === 'bong').map((s) => s.id);

type Target =
  | { kind: 'door'; door: Door; t: number }
  | { kind: 'spot'; spot: Spot; t: number }
  | { kind: 'body'; id: number; t: number }
  | { kind: 'player'; id: number; t: number }
  | { kind: 'clue'; id: number; t: number }
  | { kind: 'coon'; t: number }
  | { kind: 'perch'; i: number; t: number };

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The white chalk outline under a body. */
function chalk(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#f4f4f4';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 22, 13, 0, Math.PI * 2);
  g.moveTo(52, 36);
  g.lineTo(26, 58);
  g.lineTo(34, 64);
  g.lineTo(52, 50);
  g.lineTo(50, 92);
  g.lineTo(40, 122);
  g.lineTo(54, 122);
  g.lineTo(64, 96);
  g.lineTo(74, 122);
  g.lineTo(88, 122);
  g.lineTo(78, 92);
  g.lineTo(76, 50);
  g.lineTo(94, 64);
  g.lineTo(102, 58);
  g.lineTo(76, 36);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export class NightSession {
  private world = new World();
  private camera = new THREE.PerspectiveCamera(85, 1, 0.05, 140);
  private input: Input;
  private audio = new Audio();
  private wrap = document.createElement('div');
  private hud: Hud;
  private meeting: Meeting;
  private prefs: Prefs = loadPrefs();
  private walker;
  private char: CharId;
  private eye: number;
  private remotes = new Map<number, Remote>();
  private bodies = new Map<number, THREE.Object3D[]>();
  private names = new Map<number, string>();
  private chars = new Map<number, CharId>();
  private pub: PublicView | null = null;
  private priv: PrivateView | null = null;
  private status: Status = 'in';
  private left = 0;
  private roam = 0;
  private torch = false;
  private paused = true;
  private poseAcc = 0;
  private walked = 0;
  private bob = 0;
  private chore: { view: ChoreView; spot: Spot } | null = null;
  private myVote: number | null = null;
  private evidence: Evidence | null = null;
  private inspecting: InspectView | null = null;
  private phone: Phone;
  private plantMenu: PlantMenu | null = null;
  private feed: FeedItem[] = [];
  private seen = new Map<number, Known>();
  /** People you've crossed off your Suspect Board. */
  private crossed = new Set<number>();
  /** Holding E on a search spot or R on a clue: which and for how long (negative: done, waiting for release). */
  private hold: { key: string; t: number } | null = null;
  /** Open the next clue that arrives (we asked to pick one up, or a search found one). */
  private wantClue = false;
  private power: Power;
  private powerUI: PowerUI;
  private glows = new Glows();
  private sparkles = new Glows(0xffe14d);
  /** Abilities running on this screen, until these roam times. */
  private until = { sled: 0, bongus: 0, xray: 0, sparkle: 0 };
  private xrayRange = 8;
  private sledYaw = 0;
  /** Inspection: standing still since this roam time (0: not inspecting). */
  private inspectSince = 0;
  private emote = { id: 0, until: 0 };
  private npcs: Person[] = [];
  private npcAt: [number, number, number, number][] = [];
  private shirt: THREE.Mesh | null = null;
  /** The two-person chore end you're holding. */
  private duoHeld: string | null = null;
  /** Standing still (for sniffing Will's cologne), and the last room you sniffed. */
  private stillFor = 0;
  private sniffed = '';
  /** When Will Palmer was last in each room (performance ms). */
  private willRooms = new Map<string, number>();
  /** Contradictions Jung's phone has already buzzed about. */
  private illogical = new Set<string>();
  private lastTarget: Target | null = null;
  /** The bin bag you're carrying out (its chore spot), if any. */
  private carrying: string | null = null;
  /** Watching the Ring cam on the laptop. */
  private watching = false;
  private ringCam = new THREE.PerspectiveCamera(70, 16 / 10, 0.05, 60);
  private raccoon: THREE.Group | null = null;
  private coonAt: [number, number, number, number] | null = null;
  private alarmBeep = 0;
  /** The Unflushed: seconds in the top bathroom, and when you can go back in (roam). */
  private gag = 0;
  private gagUntil = 0;
  private replays: { k: number; v: number; f: [number, number, number, number][][] }[] = [];
  private statsSaved = false;
  private replayCanvases: HTMLCanvasElement[] = [];
  /** You, as only the bathroom mirror sees you. */
  private self: Person;
  /** What you've smoked, snorted or swallowed tonight (vices.ts). */
  private vibe = newVibe();
  private heartbeat = 0;
  private vibeChip: HTMLElement;
  /** Rolling a joint (a minigame, like a chore). */
  private rolling: ChoreView | null = null;
  /** Phones and tablets: the on-screen stick and buttons. */
  private touch: TouchControls | null = null;
  /** Your hands in first person (a joint, a bong), and the house's smoke. */
  private held: HeldView;
  private smokeFx: SmokeFx;
  /** Mid-drag on the joint or mid-rip on the bong (L held). */
  private smoking = false;
  /** Flicking the lighter at a rolled joint (seconds left), packing the bowl (seconds held). */
  private lighting = 0;
  private packing = 0;
  /** Breathing out: a beat's delay, then seconds of cloud, how big, and a cough after. */
  private exhale = { delay: 0, left: 0, size: 0, cough: false, every: 0 };
  private soundIn = 0;
  private tmpV = new THREE.Vector3();
  /** Proximity voice chat (off until you switch it on in the pause menu). */
  readonly voice: Voice;
  private voiceLine: HTMLElement;
  private replayT = 0;
  private eviction: { person: Person | null; rain: THREE.Points; t: number } | null = null;
  private shake = 0;
  private introStage = '';
  /** Where you sat at the last meeting (you stand up from it). */
  private seat = -1;
  /** Where you sat down by choice (PERCHES), or -1. */
  private perch = -1;
  private offs: (() => void)[] = [];

  constructor(private o: SessionOpts) {
    const me = o.people.find((p) => p.id === o.me)!;
    this.char = me.char;
    this.eye = eyeHeight(this.char);
    for (const p of o.people) {
      this.names.set(p.id, p.char === 'guest' ? p.name : `${CAST[p.char].tag}`);
      this.chars.set(p.id, p.char);
    }
    // Wake up in your own room; roommates spread out.
    const room = CAST[this.char].wake;
    const i = o.people.filter((p) => CAST[p.char].wake === room).findIndex((p) => p.id === o.me);
    this.walker = newWalker(wakeSpot(room, Math.max(0, i)), Math.PI);
    this.wrap.className = 'rd-night';
    this.wrap.append(o.renderer.domElement);
    o.root.append(this.wrap);
    this.hud = new Hud(this.wrap);
    this.meeting = new Meeting(this.wrap, {
      vote: (id) => {
        if (this.myVote !== null) return;
        this.myVote = id;
        o.toHost({ t: 'vote', v: id });
        this.audio.play('click');
      },
      chat: (text) => {
        o.toAll({ t: 'chat', text });
        this.showChat(o.me, text);
      },
    });
    this.phone = new Phone(this.wrap);
    this.power = powerOf(this.char, me.name);
    this.powerUI = new PowerUI(this.wrap);
    this.vibeChip = document.createElement('div');
    this.vibeChip.className = 'rd-vibe';
    this.hud.root.append(this.vibeChip);
    this.voice = new Voice(o.me, o.voiceOut);
    this.voiceLine = document.createElement('div');
    this.voiceLine.className = 'rd-voice';
    this.hud.root.append(this.voiceLine);
    this.input = new Input(o.renderer.domElement, o.api, IS_TOUCH);
    if (IS_TOUCH) {
      this.wrap.classList.add('rd-touch');
      this.touch = new TouchControls(this.wrap, this.input, () => (this.closeOverlays() ? undefined : this.setPaused(!this.paused)));
      const rotate = document.createElement('div');
      rotate.className = 'rd-rotate';
      rotate.textContent = '🔄 Turn your phone sideways to play';
      this.wrap.append(rotate);
    }
    this.self = new Person(lookFor(this.char, me.name), CAST[this.char].height);
    this.held = new HeldView(lookFor(this.char, me.name).skin, lookFor(this.char, me.name).shirt);
    this.smokeFx = new SmokeFx(this.world.scene, 220);
    this.self.setLayer(1);
    this.world.scene.add(this.self.root);
    this.world.mirror.getReflectionCamera(this.camera).layers.enable(1);
    this.camera.rotation.order = 'YXZ';
    this.world.scene.add(this.camera, this.glows.group, this.sparkles.group);
    for (const p of o.people) if (p.id !== o.me) this.addRemote(p);
    this.applyPrefs();

    const canvas = o.renderer.domElement;
    const onClick = () => {
      this.audio.wake();
      if (this.inMeeting()) return;
      this.resume();
    };
    canvas.addEventListener('click', onClick);
    this.offs.push(() => canvas.removeEventListener('click', onClick));
    const onLock = () => {
      if (!this.input.locked && !this.inMeeting() && !this.chore && !this.paused && !this.overlay()) this.setPaused(true);
    };
    document.addEventListener('pointerlockchange', onLock);
    this.offs.push(() => document.removeEventListener('pointerlockchange', onLock));
    // Esc never quits a night: it pauses, closes a chore, or leaves the chat box.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (this.closeOverlays()) return;
      if (this.rolling) return this.endRolling();
      if (this.chore) return this.endChore();
      if (this.meeting.typing) return (document.activeElement as HTMLElement).blur();
      if (!this.inMeeting()) this.setPaused(!this.paused);
    };
    addEventListener('keydown', onEsc, { capture: true });
    this.offs.push(() => removeEventListener('keydown', onEsc, { capture: true }));
    this.setPaused(true, 'Click to step into the house');
  }

  // -------------------------------------------------------------------------------------------
  // People

  private addRemote(p: Joiner) {
    const person = new Person(lookFor(p.char, p.name), CAST[p.char].height);
    person.setTag(tagFor(p.char, p.name));
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 5, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    cone.geometry.translate(0, -2.5, 0);
    cone.geometry.rotateX(-Math.PI / 2);
    cone.visible = false;
    this.world.scene.add(person.root, cone);
    const start = wakeSpot(CAST[p.char].wake, 0);
    this.remotes.set(p.id, { id: p.id, name: p.name, char: p.char, person, cone, buf: [], pos: { ...start }, yaw: 0, pitch: 0, f: 0, speed: 0, walked: 0, e: 0, h: 0, wispIn: 0, puffIn: 0 });
    person.root.visible = false;
  }

  private removeRemote(id: number) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.world.scene.remove(r.person.root, r.cone);
    r.person.dispose();
    r.cone.geometry.dispose();
    (r.cone.material as THREE.Material).dispose();
    this.remotes.delete(id);
  }

  membersChanged(members: { id: number }[]) {
    for (const id of [...this.remotes.keys()]) if (!members.some((m) => m.id === id)) this.removeRemote(id);
  }

  private statusOf(id: number): Status {
    return this.pub?.people.find((p) => p[0] === id)?.[2] ?? 'in';
  }

  private get ghost() {
    return this.status !== 'in';
  }

  private get evil() {
    return this.priv?.role === 'degenerate';
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  handle(from: number, m: Msg) {
    switch (m.t) {
      case 'p': {
        const r = this.remotes.get(from);
        if (!r) return;
        r.buf.push({ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, f: m.f, e: m.e, h: m.h });
        if (r.buf.length > 12) r.buf.shift();
        return;
      }
      case 'chat':
        return this.showChat(from, m.text);
      case 'st':
        return this.applyPublic(m.v);
      case 'me':
        return this.applyPrivate(m.v);
      case 'doors':
        for (const d of this.world.setDoors(m.open)) {
          const at = { x: d.x, y: FLOOR_Y[d.floor] + 1, z: d.z };
          this.audio.play('door', at, this.muffle(at));
        }
        return;
      case 'shoved':
        if (m.id === this.o.me) {
          shove(this.walker, { x: m.x, z: m.z });
          this.shake = 0.25;
          if (this.chore) this.endChore();
        }
        return;
      case 'clue': {
        const k: Known = { id: m.id, cat: m.cat, value: m.value, crime: m.crime };
        this.seen.set(k.id, k);
        if (this.wantClue && !this.ghost) this.openInspect(k);
        this.wantClue = false;
        this.renderPhone();
        return;
      }
      case 'found': {
        const name = SPOTS.find((s) => s.id === m.spot)?.name ?? 'there';
        this.hud.toast(m.id < 0 ? `Nothing in ${name}. Just crumbs.` : `Found something in ${name}!`);
        if (m.id < 0) this.wantClue = false;
        return;
      }
      case 'pw':
        return this.powerResult(m.text, m.pos, m.ids, m.until);
      case 'buzz':
        this.powerUI.pointTo(m.x, m.z, m.text.includes('pinged') ? 10 : 3);
        this.hud.toast(`📳 ${m.text}`, 3500);
        this.audio.play('buzz');
        return;
      case 'npcs':
        return this.syncNpcs(m.p);
      case 'warp':
        this.walker.pos = { x: m.x, y: m.y, z: m.z };
        this.walker.vel = { x: 0, y: 0, z: 0 };
        this.hud.toast('…and out the other side.', 1800);
        return;
      case 'coon':
        return this.syncCoon(m.p);
      case 'replay':
        this.replays.push({ k: m.k, v: m.v, f: m.f });
        if (this.pub?.ph === 'over') this.showOver();
        return;
      case 'greeted': {
        const kind = m.k === 'five' ? 'high-five' : 'hug';
        for (const id of [m.a, m.b]) {
          const r = this.remotes.get(id);
          if (r) r.person.say(CAST[r.char].catchphrase);
        }
        if (m.a === this.o.me || m.b === this.o.me) this.hud.toast(`${m.k === 'five' ? '✋' : '🤗'} ${this.names.get(m.a === this.o.me ? m.b : m.a) ?? 'Someone'}: ${kind}!`);
        const p = this.remotes.get(m.a)?.pos ?? this.walker.pos;
        this.audio.play('slap', { x: p.x, y: p.y + 1.4, z: p.z }, this.muffle({ x: p.x, y: p.y + 1.4, z: p.z }));
        return;
      }
      case 'feed':
        this.feed.push({ from: m.from, text: m.text });
        if (this.feed.length > 80) this.feed.shift();
        this.hud.toast(`📱 ${m.from}: ${m.text}`, 6000);
        this.audio.play('click');
        this.renderPhone();
        return;
      case 'fx': {
        const at = { x: m.x, y: m.y + 1, z: m.z };
        const sound = m.k === 'chore' ? 'ding' : m.k === 'evict' ? 'evict' : m.k;
        // Living players hear the bonk only near it; everyone hears the bell (it's a meeting).
        if (m.k === 'bell') this.audio.play('bell');
        else this.audio.play(sound, at, this.muffle(at));
        if (m.k === 'bonk' && Math.hypot(at.x - this.walker.pos.x, at.z - this.walker.pos.z) < 5) this.shake = 0.35;
        if (m.k === 'rattle' && !this.ghost) this.hud.toast('…something fell over somewhere.', 1800);
        return;
      }
    }
  }

  private showChat(from: number, text: string) {
    const ghostSaid = this.statusOf(from) !== 'in';
    if (ghostSaid && !this.ghost) return; // the honour rule, enforced
    this.meeting.addChat(this.names.get(from) ?? '?', text, ghostSaid);
  }

  private applyPrivate(v: PrivateView) {
    const was = this.priv;
    this.priv = v;
    if (!was) this.audio.play('horn');
    for (const [id, cat, value, crime] of v.seen) if (!this.seen.has(id)) this.seen.set(id, { id, cat: cat as Cat, value, crime });
    if (!was || was.mates.join() !== v.mates.join())
      for (const r of this.remotes.values()) r.person.setTag(tagFor(r.char, r.name), v.mates.includes(r.id) ? '#ff6b8a' : '#ffffff');
    this.refreshTasks();
  }

  private refreshTasks() {
    if (!this.priv) return;
    const tasks = this.priv.tasks.map(([id, done]) => ({ name: SPOTS.find((s) => s.id === id)?.name ?? id, done }));
    this.hud.setTasks(tasks, this.evil);
    const mates = this.priv.mates.map((id) => this.names.get(id) ?? '?');
    const roleText = this.evil ? `DEGENERATE${mates.length ? ` · with ${mates.join(', ')}` : ''}` : 'Housemate';
    this.hud.setRole(this.ghost ? `GHOST · ${roleText}` : roleText, this.evil, this.ghost);
  }

  private applyPublic(v: PublicView) {
    const prev = this.pub;
    this.pub = v;
    this.left = v.left;
    this.roam = v.roam;
    const was = this.status;
    this.status = v.people.find((p) => p[0] === this.o.me)?.[2] ?? 'in';
    if (was === 'in' && this.status !== 'in') this.becomeGhost(this.status);
    for (const [id, , st] of v.people) if (st === 'gone') this.removeRemote(id);
    this.syncBodies(v.bodies);
    if (!this.evidence) {
      this.evidence = new Evidence(v.caseId);
      this.world.scene.add(this.evidence.group);
    }
    this.evidence.sync(v);
    this.renderPhone();
    this.syncShirt(v.shirt);
    if (this.char === 'jung') this.checkLogic(v);
    if (!prev || prev.ph !== v.ph) this.enterPhase(v.ph, prev?.ph);
    if (v.ph === 'meeting' || v.ph === 'vote') this.drawMeeting();
    if (was !== this.status) this.refreshTasks();
  }

  private becomeGhost(st: Status) {
    sober(this.vibe);
    this.walker.ghost = true;
    this.walker.pos.y += 0.3;
    this.torch = false;
    if (this.chore) this.endChore();
    this.hud.toast(st === 'out' ? 'You’ve been evicted. Haunt the place: chores still count.' : 'You were taken out. X_X  You’re a ghost now: fly with Space / C, finish your chores, E to rattle things.', 6000);
  }

  private syncBodies(list: [number, number, number, number][]) {
    for (const [id, objs] of this.bodies)
      if (!list.some((b) => b[0] === id)) {
        for (const o of objs) {
          this.world.scene.remove(o);
          (o.userData.person as Person | undefined)?.dispose();
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const mat = o.material as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            mat.dispose();
          }
        }
        this.bodies.delete(id);
      }
    for (const [id, x, y, z] of list) {
      if (this.bodies.has(id)) continue;
      const char = this.chars.get(id) ?? 'guest';
      const p = new Person(lookFor(char, this.names.get(id) ?? ''), CAST[char].height);
      p.pose({ speed: 0, crouch: false, pitch: 0, dead: true }, 0);
      p.root.position.set(x, y, z);
      p.root.rotation.y = (id * 2.4) % (Math.PI * 2);
      const outline = chalk();
      outline.position.set(x, y + 0.012, z);
      outline.rotation.z = p.root.rotation.y + Math.PI;
      this.world.scene.add(p.root, outline);
      this.bodies.set(id, [p.root, outline]);
      // Keep the Person for disposal through its root's userData.
      p.root.userData.person = p;
    }
  }

  private inMeeting() {
    return this.pub?.ph === 'meeting' || this.pub?.ph === 'vote';
  }

  private enterPhase(ph: PublicView['ph'], from?: PublicView['ph']) {
    const c = caseById(this.pub!.caseId);
    this.hud.card(null);
    this.meeting.hide();
    this.endEviction();
    this.input.dragLook = false;
    if (ph === 'meeting') {
      if (this.chore) this.endChore();
      this.audio.play('horn');
      this.setPaused(false);
      this.input.unlock();
      this.input.dragLook = true;
      this.myVote = null;
      this.perch = -1;
      const seat = this.pub!.seats.indexOf(this.o.me);
      this.seat = this.ghost ? -1 : seat;
      if (seat >= 0 && !this.ghost) {
        const s = SEATS[seat];
        this.walker.pos = { ...s.pos };
        this.walker.vel = { x: 0, y: 0, z: 0 };
        this.walker.yaw = s.yaw;
        this.walker.pitch = -0.1;
      }
    } else if (ph === 'vote') {
      this.input.dragLook = true;
      if (from !== 'meeting') this.myVote = null;
    } else if (ph === 'result') this.startEviction();
    else if (ph === 'over') {
      this.input.unlock();
      this.showOver();
    } else if (ph === 'night' && (from === 'vote' || from === 'result' || from === 'meeting')) {
      this.standUp();
      this.setPaused(true, 'Click to look around again');
    }
    if (ph === 'night' && from === 'intro') this.hud.toast(c.title, 3000);
  }

  /** Sit down somewhere (a couch, a bed, a bean bag): placed on it, facing out. */
  private sitDown(i: number) {
    const p = PERCHES[i];
    this.perch = i;
    this.walker.pos = { ...p.pos };
    this.walker.vel = { x: 0, y: 0, z: 0 };
    this.walker.yaw = p.yaw;
    this.walker.pitch = -0.05;
  }

  /** Up off wherever you sat: a step out in front of it, clear of the cushions. */
  private getUp() {
    this.walker.pos = standFrom(PERCHES[this.perch]);
    this.walker.vel = { x: 0, y: 0, z: 0 };
    this.perch = -1;
  }

  /** Off the sofa and a step toward the coffee table, clear of the cushions. */
  private standUp() {
    if (this.seat < 0 || this.ghost) return;
    const s = SEATS[this.seat];
    const dx = MEETING_CENTRE.x - s.pos.x;
    const dz = MEETING_CENTRE.z - s.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    this.walker.pos = { x: s.pos.x + (dx / l) * 0.95, y: s.pos.y, z: s.pos.z + (dz / l) * 0.95 };
    this.walker.vel = { x: 0, y: 0, z: 0 };
    this.seat = -1;
  }

  // -------------------------------------------------------------------------------------------
  // Cards

  private drawIntro() {
    const c = caseById(this.pub!.caseId);
    const showRole = this.left < TIMES.intro / 2;
    const stage = showRole ? `role:${this.priv?.role}` : 'case';
    if (stage === this.introStage) return;
    this.introStage = stage;
    this.hud.card((box) => {
      if (!showRole) {
        box.append(Object.assign(document.createElement('p'), { className: 'rd-kicker', textContent: 'Tonight at 282' }));
        box.append(Object.assign(document.createElement('h1'), { textContent: c.title }));
        box.append(Object.assign(document.createElement('p'), { textContent: c.open }));
        return;
      }
      const evil = this.evil;
      box.append(Object.assign(document.createElement('p'), { className: 'rd-kicker', textContent: 'You are' }));
      box.append(Object.assign(document.createElement('h1'), { className: evil ? 'evil' : '', textContent: evil ? 'A DEGENERATE' : 'A HOUSEMATE' }));
      const text = evil
        ? `You did this. Take people out with ${c.weapon} (click, up close), fake your chores, and survive the Last Meeting.`
        : 'Do your chores, report bodies, ring the bell (the pot in the dining room) and vote the Degenerates out.';
      box.append(Object.assign(document.createElement('p'), { textContent: text }));
      if (evil && this.priv?.mates.length) {
        const row = document.createElement('div');
        row.className = 'rd-chips';
        for (const id of this.priv.mates) row.append(chip(portrait(this.o.renderer, this.chars.get(id)!, this.names.get(id)), this.names.get(id) ?? '?', 'also a Degenerate'));
        box.append(row);
      }
    }, showRole && this.evil ? 'evil' : '');
  }

  private drawMeeting() {
    const v = this.pub!;
    const c = caseById(v.caseId);
    const by = v.meet ? (this.names.get(v.meet.by) ?? 'Someone') : '';
    const sub =
      v.meet?.kind === 'last'
        ? c.last
        : v.meet?.kind === 'body'
          ? `${by} found ${this.names.get(v.meet.body ?? -1) ?? 'someone'}’s body. “${CAST[this.chars.get(v.meet.by) ?? 'guest'].lines.body}”${v.doubled >= 0 ? ' · Will’s vote counts double.' : ''}`
          : `${by} banged the pot.`;
    const living = v.people.filter((p) => p[2] === 'in');
    this.meeting.show({
      phase: v.ph === 'vote' ? 'vote' : 'meeting',
      title: v.meet?.kind === 'last' ? 'THE LAST MEETING' : 'HOUSE MEETING',
      sub,
      voters: living.map(([id, char]) => ({
        id,
        name: this.names.get(id) ?? '?',
        img: portrait(this.o.renderer, char, this.names.get(id)),
        in: true,
        voted: v.voted.includes(id),
        me: id === this.o.me,
      })),
      canVote: v.ph === 'vote' && !this.ghost,
      mine: this.myVote,
    });
    this.o.api.setMenuNav(true);
  }

  private startEviction() {
    const r = this.pub!.result;
    const out = r?.out ?? null;
    let person: Person | null = null;
    if (out !== null) {
      const char = this.chars.get(out) ?? 'guest';
      person = new Person(lookFor(char, this.names.get(out) ?? ''), CAST[char].height);
      person.setFace('worried');
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshToonMaterial({ color: 0x111114 }));
      bag.position.set(0.3, 0.55, 0);
      person.root.add(bag);
      this.world.scene.add(person.root);
    }
    // Rain over the front yard.
    const N = 1600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = -1 + Math.random() * 10;
      pos[i * 3 + 1] = Math.random() * 7 - 0.7;
      pos[i * 3 + 2] = 21 + Math.random() * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaab8ff, size: 0.05, transparent: true, opacity: 0.7 }));
    this.world.scene.add(rain);
    this.eviction = { person, rain, t: 0 };
    this.audio.play('evict');
    const name = out !== null ? (this.names.get(out) ?? 'Someone') : '';
    const counts = new Map(r?.counts ?? []);
    this.hud.card((box) => {
      if (out === null) {
        box.append(Object.assign(document.createElement('h1'), { textContent: 'Nobody was evicted.' }));
        box.append(Object.assign(document.createElement('p'), { textContent: (counts.get(-1) ?? 0) > 0 ? 'The house skipped, or couldn’t agree.' : 'A tie. Everyone stays. Awkward.' }));
        return;
      }
      box.append(Object.assign(document.createElement('h1'), { textContent: `${name} was evicted.` }));
      const deg = r!.deg;
      const line = deg === null ? 'Into the rain with a bin bag. Were they a Degenerate? Nobody’s saying.' : deg ? `${name} WAS a Degenerate.` : `${name} was not a Degenerate.`;
      box.append(Object.assign(document.createElement('p'), { className: deg ? 'evil' : '', textContent: line }));
      const char = this.chars.get(out)!;
      box.append(Object.assign(document.createElement('p'), { className: 'rd-quote', textContent: `“${CAST[char].lines.evicted}”` }));
    }, 'low');
  }

  private endEviction() {
    const e = this.eviction;
    if (!e) return;
    if (e.person) {
      this.world.scene.remove(e.person.root);
      e.person.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.geometry.parameters.radius === 0.28) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      e.person.dispose();
    }
    this.world.scene.remove(e.rain);
    e.rain.geometry.dispose();
    (e.rain.material as THREE.Material).dispose();
    this.eviction = null;
  }

  private showOver() {
    const v = this.pub!;
    const w = v.win!;
    const c = caseById(v.caseId);
    this.hud.card((box) => {
      box.append(Object.assign(document.createElement('p'), { className: 'rd-kicker', textContent: `Case closed · ${c.title}` }));
      box.append(Object.assign(document.createElement('h1'), { className: w.side === 'degenerates' ? 'evil' : '', textContent: w.side === 'degenerates' ? 'THE DEGENERATES WIN' : 'THE HOUSEMATES WIN' }));
      box.append(Object.assign(document.createElement('p'), { textContent: w.why }));
      const row = document.createElement('div');
      row.className = 'rd-chips';
      for (const [id, role] of w.roles) {
        const char = this.chars.get(id) ?? 'guest';
        const ch = chip(portrait(this.o.renderer, char, this.names.get(id)), this.names.get(id) ?? '?', role === 'degenerate' ? 'DEGENERATE' : 'housemate');
        if (role === 'degenerate') ch.classList.add('evil');
        row.append(ch);
      }
      box.append(row);
      // The night's awards.
      if (w.awards.length) {
        const aw = document.createElement('div');
        aw.className = 'rd-awards';
        for (const [title, id, why] of w.awards) {
          const a = document.createElement('p');
          a.append(Object.assign(document.createElement('b'), { textContent: `🏅 ${title}` }), document.createTextNode(` · ${this.names.get(id) ?? '?'}: ${why}`));
          aw.append(a);
        }
        box.append(aw);
      }
      // Each takeout from above: the last 10 seconds before it (the killer red, the victim yellow).
      if (this.replays.length) {
        const rp = document.createElement('div');
        rp.className = 'rd-replays';
        this.replayCanvases = this.replays.map((r) => {
          const fig = document.createElement('figure');
          const cv = document.createElement('canvas');
          cv.width = 200;
          cv.height = 300;
          fig.append(cv, Object.assign(document.createElement('figcaption'), { textContent: `${this.names.get(r.k) ?? '?'} → ${this.names.get(r.v) ?? '?'}` }));
          rp.append(fig);
          return cv;
        });
        box.append(rp);
      }
      // The timeline: everything the Degenerates did, and when.
      if (w.log.length) {
        const tl = document.createElement('ol');
        tl.className = 'rd-timeline';
        for (const [t, text] of w.log) {
          const li = document.createElement('li');
          li.append(Object.assign(document.createElement('b'), { textContent: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }), document.createTextNode(` ${text}`));
          tl.append(li);
        }
        box.append(tl);
      }
      box.append(Object.assign(document.createElement('p'), { className: 'rd-quote', textContent: c.ending[w.side === 'degenerates' ? 0 : 1] }));
      box.append(Object.assign(document.createElement('p'), { className: 'rd-dim', textContent: 'Back to the lobby in a moment…' }));
    }, w.side === 'degenerates' ? 'evil' : '');
  }

  // -------------------------------------------------------------------------------------------
  // Pause, prefs

  private setPaused(on: boolean, title = 'Paused') {
    this.paused = on;
    this.hud.pause(on, this.prefs, {
      resume: () => this.resume(),
      leave: () => this.o.leave(),
      prefs: () => this.applyPrefs(),
      voice: {
        label: () => `Voice chat: ${this.voice.on ? 'on' : 'off'}`,
        toggle: async () => {
          if (this.voice.on) return this.voice.stop();
          const err = await this.voice.start();
          this.hud.toast(err ?? 'Voice on. People hear you from where you stand. M mutes.', 3500);
        },
      },
    });
    if (on) {
      const h = this.hud.root.querySelector('.rd-pausecard h2');
      if (h) h.textContent = title;
    }
    this.o.api.setMenuNav(on || this.inMeeting());
  }

  private resume() {
    this.audio.wake();
    if (this.paused) this.setPaused(false);
    this.input.lock();
  }

  private applyPrefs() {
    this.input.sens = this.prefs.sens;
    this.camera.fov = this.prefs.fov;
    this.camera.updateProjectionMatrix();
    this.audio.volume = this.prefs.volume;
  }

  // -------------------------------------------------------------------------------------------
  // Sound helpers

  /** How muffled a sound at `at` is from here: another floor, or a wall in the way. */
  private muffle(at: Vec3): Muffle {
    const eye = this.camera.position;
    if (floorOf(at.y - 0.5) !== floorOf(this.walker.pos.y)) return 2;
    const d = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 0.6) return 0;
    d.x /= len;
    d.y /= len;
    d.z /= len;
    return rayWorld(eye, d, this.world.colliders, len) < len - 0.3 ? 1 : 0;
  }

  private surfaceAt(p: Vec3) {
    return roomAt({ x: p.x, y: p.y + 0.1, z: p.z })?.surface ?? 'wood';
  }

  // -------------------------------------------------------------------------------------------
  // The frame

  frame(dt: number) {
    const f = this.input.poll(dt);
    if (f.pause && !this.inMeeting()) this.setPaused(!this.paused);
    const ph = this.pub?.ph ?? 'intro';
    if (ph === 'intro' && this.pub) {
      this.left -= dt;
      this.drawIntro();
    } else if (ph === 'night') this.roam += dt;
    else this.left -= dt;

    const canMove = (ph === 'night' || (this.ghost && ph !== 'over')) && !this.paused && !this.chore && !this.rolling && !this.overlay() && !(this.inMeeting() && !this.ghost);
    const canLook = !this.chore && !this.overlay() && (!this.paused || this.inMeeting()) && ph !== 'result' && ph !== 'over';
    if (canLook) {
      this.walker.yaw += f.yaw;
      this.walker.pitch = Math.max(-1.45, Math.min(1.45, this.walker.pitch + f.pitch));
    }
    // Sat down by choice (a couch, a bed, a bean bag): moving or jumping gets you up.
    if (this.perch >= 0 && (this.ghost || ph !== 'night' || f.fwd || f.side || f.jump || f.crouch)) this.getUp();
    // Seated players sit inside the sofa's box: they're placed, not walked (collision would lift them out).
    const sitting = !this.ghost && ((this.seat >= 0 && (this.inMeeting() || ph === 'result')) || this.perch >= 0);
    if (!sitting) {
      // Dev's toboggan runs straight ahead at 3×; Bongus Mode is slower going.
      const sled = this.roam < this.until.sled && !this.ghost;
      const look = this.walker.yaw;
      if (sled) this.walker.yaw = this.sledYaw;
      const mult = (sled ? 3 : this.roam < this.until.bongus ? 0.7 : 1) * speedOf(this.vibe, this.roam);
      stepWalker(
        this.walker,
        { fwd: sled ? 1 : canMove ? f.fwd : 0, side: sled || !canMove ? 0 : f.side, jump: canMove && f.jump, crouch: canMove && f.crouch, up: canMove && f.jump, speedMult: mult },
        dt,
        this.world.colliders,
      );
      this.walker.yaw = look;
      nudgeApart(this.walker, this.livingRemotePositions(), dt, this.world.colliders);
    }
    this.ownSteps(dt);

    if (f.torch && !this.ghost && ph !== 'over') {
      this.torch = !this.torch;
      this.audio.play('click');
    }
    if (f.phone && !this.inMeeting() && ph !== 'over' && ph !== 'intro' && !this.chore && !this.inspecting && !this.plantMenu) this.togglePhone();
    this.abilityInput(f, ph);
    if (this.rolling) {
      if (f.pad[1] || this.pub?.ph !== 'night') this.endRolling();
      else if (this.rolling.frame(dt, f)) {
        this.endRolling();
        rolled(this.vibe);
        this.hud.toast('One joint, rolled. L to light it.', 3000);
      }
    } else if (this.chore) this.runChore(dt, f);
    else if (this.inspecting) this.inspecting.frame(f);
    else if (this.overlay()) this.hud.setPrompt('');
    else if (ph === 'night' && !this.paused) this.interact(f, dt);
    else this.hud.setPrompt('');
    this.updateSmoking(f, dt, ph);

    this.updateRemotes(dt);
    this.updateNpcs(dt);
    this.updateHouse(dt, ph);
    this.tells(dt);
    this.placeCamera(dt, sitting);
    this.updateHud(ph);
    this.updateVibe(dt);
    if (f.mute && this.voice.on) {
      this.voice.setMuted(!this.voice.muted);
      this.hud.toast(this.voice.muted ? '🔇 Mic muted' : '🎙 Mic on', 1200);
    }
    this.updateVoice(ph);
    if (this.touch) {
      this.touch.tapsClick = !!(this.chore || this.rolling);
      this.touch.setEvil(this.evil);
      this.touch.setVisible(!this.paused && !this.overlay() && !this.inMeeting() && (ph === 'night' || ph === 'intro'));
    }
    if (ph === 'over') {
      this.saveStats();
      this.drawReplays(dt);
    }
    this.sendPose(dt, sitting);
    this.world.update(dt, this.camera.position, this.pub?.sab?.[0] !== 'power');
    if (this.world.mirror.visible) {
      this.self.root.visible = !this.ghost;
      this.self.root.position.set(this.walker.pos.x, this.walker.pos.y, this.walker.pos.z);
      this.self.root.rotation.y = this.walker.yaw;
      this.self.pose({ speed: Math.hypot(this.walker.vel.x, this.walker.vel.z), crouch: this.walker.crouch, pitch: this.walker.pitch, phone: this.phone.open, emote: EMOTES[performance.now() < this.emote.until ? this.emote.id : 0] }, dt);
      this.self.hold(heldCode(this.vibe, BONGS), this.smoking, dt);
    } else this.self.root.visible = false;
    this.world.torch.intensity = this.torch ? TORCH_POWER : 0;
    this.updateEviction(dt);
    this.glows.group.visible = this.roam < this.until.bongus;
    this.sparkles.group.visible = this.roam < this.until.sparkle;
    this.glows.pulse(performance.now() / 1000);
    this.sparkles.pulse(performance.now() / 700);
    this.wrap.classList.toggle('bongus', this.roam < this.until.bongus && !this.ghost);
    this.powerUI.update(this.camera.position, this.walker.yaw);
    this.render();
  }

  private livingRemotePositions(): Vec3[] {
    const out: Vec3[] = [];
    for (const r of this.remotes.values()) if (this.statusOf(r.id) === 'in' && r.person.root.visible) out.push(r.pos);
    return out;
  }

  private ownSteps(dt: number) {
    const w = this.walker;
    const sp = Math.hypot(w.vel.x, w.vel.z);
    if (w.ghost || !w.onGround || w.crouch || sp < 0.5) return;
    this.walked += sp * dt;
    this.bob += sp * dt * 2.6;
    if (this.walked > STEP_EVERY) {
      this.walked = 0;
      this.audio.step(w.pos, this.surfaceAt(w.pos), 0, 0.28);
    }
  }

  private placeCamera(dt: number, sitting: boolean) {
    const w = this.walker;
    const ph = this.pub?.ph;
    if (ph === 'result') {
      this.camera.position.set(6.2, 1.1, 27.5);
      this.camera.lookAt(2.5, 0.6, 21);
      return;
    }
    if (ph === 'over') {
      // Case closed in Wags's room, by the record player.
      this.camera.position.set(7.4, FLOOR_Y[2] + 1.35, 15.6);
      this.camera.lookAt(5.4, FLOOR_Y[2] + 0.7, 19.6);
      return;
    }
    const k = this.eye / 1.8;
    const eyeY = (sitting ? 1.15 * k : w.ghost ? this.eye : w.crouch ? this.eye - 0.45 : this.eye) + (w.ghost ? 0 : eyeShift(this.vibe, this.roam));
    const sp = Math.hypot(w.vel.x, w.vel.z);
    const bob = this.prefs.bob && w.onGround && sp > 0.5 ? Math.sin(this.bob) * 0.035 : 0;
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * 0.08;
    this.camera.position.set(w.pos.x + (Math.random() - 0.5) * sh, w.pos.y + eyeY + bob + (Math.random() - 0.5) * sh, w.pos.z);
    // High: the room sways a little. The wobbly pill: a lot. Wired, or coughing: the shakes.
    const now = performance.now() / 1000;
    const trip = tripping(this.vibe, this.roam);
    const sway = (high(this.vibe, this.roam) ? 0.025 * this.vibe.level : 0) + (trip === 'wobbly' ? 0.12 : 0);
    const jitter = wired(this.vibe, this.roam) || this.roam < this.vibe.coughUntil ? 0.006 : 0;
    this.camera.rotation.set(w.pitch + (Math.random() - 0.5) * jitter, w.yaw + Math.sin(now * 0.7) * sway * 0.4, Math.sin(now * 0.9) * sway);
    const fov = this.prefs.fov + (wired(this.vibe, this.roam) ? 12 : 0) + (trip === 'tiny' ? 10 : 0);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.world.torch.position.copy(this.camera.position);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    this.world.torch.target.position.copy(this.camera.position).add(dir);
    this.audio.setListener(this.camera.position, w.yaw);
  }

  private sendPose(dt: number, sitting: boolean) {
    this.poseAcc += dt;
    if (this.poseAcc < 1 / POSE_HZ) return;
    this.poseAcc = 0;
    const w = this.walker;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const f =
      (w.crouch || (this.hold && this.hold.t > 0) ? PF.crouch : 0) |
      (this.phone.open ? PF.phone : 0) |
      (this.torch ? PF.torch : 0) |
      (w.ghost ? PF.ghost : 0) |
      (sitting ? PF.sit : 0) |
      (this.chore ? PF.busy : 0) |
      (this.roam < this.until.bongus ? PF.bongus : 0) |
      (this.roam < this.until.sled ? PF.sled : 0) |
      (this.watching ? PF.watch : 0) |
      (this.vibe.joint === 'lit' ? PF.smoke : 0) |
      (this.smoking ? PF.hit : 0) |
      (this.exhale.left > 0 && this.exhale.delay <= 0 ? PF.exhale : 0) |
      (high(this.vibe, this.roam) ? PF.high : 0) |
      (wired(this.vibe, this.roam) ? PF.wired : 0);
    const e = performance.now() < this.emote.until ? this.emote.id : 0;
    const m: Msg = { t: 'p', x: r2(w.pos.x), y: r2(w.pos.y), z: r2(w.pos.z), yaw: r2(wrapAngle(w.yaw)), pitch: r2(w.pitch), f, e, h: this.ghost ? 0 : heldCode(this.vibe, BONGS) };
    this.o.toAll(m);
    if (this.o.hosting) this.o.toHost(m);
  }

  private updateRemotes(dt: number) {
    const now = performance.now() - INTERP_MS;
    for (const r of this.remotes.values()) {
      const st = this.statusOf(r.id);
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0];
      let c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++)
        if (b[i].t <= now && b[i + 1].t >= now) {
          a = b[i];
          c = b[i + 1];
          break;
        }
      const k = c.t > a.t ? Math.max(0, Math.min(1, (now - a.t) / (c.t - a.t))) : 1;
      const nx = lerp(a.x, c.x, k);
      const ny = lerp(a.y, c.y, k);
      const nz = lerp(a.z, c.z, k);
      const moved = Math.hypot(nx - r.pos.x, nz - r.pos.z);
      r.speed = lerp(r.speed, dt > 0 ? moved / dt : 0, 0.3);
      r.pos = { x: nx, y: ny, z: nz };
      r.yaw = a.yaw + wrapAngle(c.yaw - a.yaw) * k;
      r.pitch = lerp(a.pitch, c.pitch, k);
      r.f = c.f;
      r.h = c.h;
      if (c.e !== r.e) {
        if (EMOTES[c.e] === 'wave' && st === 'in') r.person.say(CAST[r.char].catchphrase);
        r.e = c.e;
      }
      if (r.char === 'will' && st === 'in') {
        const room = roomAt({ x: nx, y: ny + 0.1, z: nz });
        if (room) this.willRooms.set(room.id, performance.now());
      }
      const ghost = st !== 'in';
      const visible = st !== 'gone' && (!ghost || this.ghost) && this.pub?.ph !== 'result';
      r.person.root.visible = visible;
      r.person.setOpacity(ghost ? 0.35 : 1);
      r.person.root.position.set(nx, ny + (ghost ? Math.sin(performance.now() / 400 + r.id) * 0.08 : 0), nz);
      r.person.root.rotation.y = r.yaw;
      r.person.pose({ speed: ghost ? 0 : r.speed, crouch: !!(r.f & PF.crouch), pitch: r.pitch, sit: !!(r.f & PF.sit), phone: !!(r.f & PF.phone), emote: EMOTES[r.e] }, dt);
      r.person.setSled(!!(r.f & PF.sled));
      r.person.setTag(r.f & PF.bongus ? 'BONGUS' : tagFor(r.char, r.name), this.priv?.mates.includes(r.id) ? '#ff6b8a' : r.f & PF.bongus ? '#9cff6a' : '#ffffff');
      // Wallhack / Eavesdrop: everyone close enough shows through walls.
      r.person.setXray(visible && this.roam < this.until.xray && Math.hypot(nx - this.walker.pos.x, ny - this.walker.pos.y, nz - this.walker.pos.z) < this.xrayRange);
      r.person.setFace(r.f & PF.high ? 'high' : r.f & PF.wired ? 'wired' : r.f & PF.busy ? 'worried' : 'smile');
      r.person.hold(visible && !ghost ? r.h : 0, !!(r.f & PF.hit), dt);
      if (visible && !ghost) this.remoteSmoke(r, dt);
      // Their torch: a soft cone, not a real light.
      r.cone.visible = visible && !!(r.f & PF.torch);
      if (r.cone.visible) {
        r.cone.position.set(nx, ny + CAST[r.char].height / 100 - 0.12, nz);
        r.cone.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
      }
      // Footsteps: walking players are heard; crouchers, ghosts and sitters aren't.
      if (!ghost && !(r.f & (PF.crouch | PF.sit)) && r.speed > 0.6) {
        r.walked += moved;
        if (r.walked > STEP_EVERY) {
          r.walked = 0;
          // Nash on the sofa hears every step in the house, walls or not; the fire alarm drowns them all (Mikol's unbothered).
          const couch = this.char === 'nash' && this.onCouch();
          if (this.pub?.sab?.[0] !== 'alarm' || this.char === 'mikol') this.audio.step(r.pos, this.surfaceAt(r.pos), couch ? 0 : this.muffle({ x: nx, y: ny + 0.2, z: nz }), couch ? 0.9 : 0.6);
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // What's under the crosshair

  private findTarget(): Target | null {
    const o = this.camera.position;
    const d = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const wall = rayWorld(o, d, this.world.colliders, REACH + 0.5);
    let best: Target | null = null;
    const consider = (t: Target) => {
      if (t.t < 0 || t.t > wall + 0.2) return;
      if (!best || t.t < best.t) best = t;
    };
    if (!this.ghost) {
      for (const r of this.remotes.values()) {
        if (!r.person.root.visible || this.statusOf(r.id) !== 'in') continue;
        // Their body and their head, so you can target someone much taller or shorter than you.
        const h = CAST[r.char].height / 100;
        const hits = [raySphere(o, d, { x: r.pos.x, y: r.pos.y + h * 0.55, z: r.pos.z }, 0.42, REACH), raySphere(o, d, { x: r.pos.x, y: r.pos.y + h - 0.15, z: r.pos.z }, 0.3, REACH)].filter((t) => t >= 0);
        consider({ kind: 'player', id: r.id, t: hits.length ? Math.min(...hits) : -1 });
      }
      for (const [id, objs] of this.bodies) {
        const p = objs[0].position;
        consider({ kind: 'body', id, t: raySphere(o, d, { x: p.x, y: p.y + 0.2, z: p.z }, 0.75, REACH) });
      }
      for (const door of DOORS) {
        const b = doorBox(door);
        const pad = 0.12;
        const t = rayBox(o, d, { x: b.min.x - pad, y: b.min.y, z: b.min.z - pad }, { x: b.max.x + pad, y: b.max.y, z: b.max.z + pad }, REACH);
        consider({ kind: 'door', door, t });
      }
    }
    if (!this.ghost && this.evidence) for (const [id, p] of this.evidence.spots) consider({ kind: 'clue', id, t: raySphere(o, d, p, 0.35, REACH) });
    if (!this.ghost && this.perch < 0)
      PERCHES.forEach((p, i) => {
        if (Math.abs(p.pos.y - this.walker.pos.y) < 1 && Math.hypot(p.pos.x - o.x, p.pos.z - o.z) < REACH + 1)
          consider({ kind: 'perch', i, t: raySphere(o, d, { x: p.pos.x, y: p.pos.y + 0.45, z: p.pos.z }, 0.36, REACH) });
      });
    if (!this.ghost && this.raccoon?.visible) consider({ kind: 'coon', t: raySphere(o, d, { x: this.raccoon.position.x, y: this.raccoon.position.y + 0.3, z: this.raccoon.position.z }, 0.45, REACH) });
    const sab = this.pub?.sab;
    for (const s of SPOTS) {
      if (s.kind !== 'chore' && this.ghost) continue;
      if (s.kind === 'fix' && (!sab || !SABOTAGES[sab[0] as SabKind].fix.includes(s.id) || sab[3].includes(s.id) || (sab[0] === 'wifi' && sab[1] >= 0))) continue;
      if (s.kind === 'sneak' && !this.evil) continue;
      if (s.kind === 'vice' && (this.ghost || s.id === this.vibe.bong)) continue;
      if (s.kind === 'duo' && this.pub?.duo.includes(DUO_PAIRS.find((p) => p[0] === s.id || p[1] === s.id)![0])) continue;
      if (s.kind === 'chore' && !this.priv?.tasks.some(([id, done]) => id === s.id && !done)) continue;
      consider({ kind: 'spot', spot: s, t: raySphere(o, d, s.pos, s.r ?? 0.5, REACH) });
    }
    return best;
  }

  private interact(f: Frame, dt: number) {
    const t = this.findTarget();
    this.lastTarget = t;
    this.evidence?.highlight(t?.kind === 'clue' ? t.id : null);
    let prompt = '';
    if (this.ghost) {
      if (f.alt && this.evil) this.openPlant();
      const ready = this.priv && this.roam - this.priv.rattleAt >= TIMES.rattle;
      if (t?.kind === 'spot') prompt = `E  ${t.spot.name}`;
      else prompt = ready ? 'E  Rattle something (the living will hear it)' : '';
      if (f.use) {
        if (t?.kind === 'spot') this.startChore(t.spot);
        else if (ready) this.o.toHost({ t: 'rattle' });
      }
      this.hud.setPrompt(prompt);
      return;
    }
    if (t?.kind === 'door') prompt = `E  ${this.world.isOpen(t.door.id) ? 'Close' : 'Open'} the ${t.door.hatch ? 'hatch' : 'door'}`;
    else if (t?.kind === 'body') prompt = `E  Report ${this.names.get(t.id) ?? 'the'}’s body`;
    else if (t?.kind === 'spot')
      prompt =
        t.spot.kind === 'search'
          ? `Hold E  Search ${t.spot.name}`
          : t.spot.kind === 'duo'
            ? `Hold E  ${t.spot.name} (someone needs the other end)`
            : t.spot.kind === 'fix'
              ? `Hold E  ${t.spot.name}`
              : t.spot.kind === 'sneak'
                ? `E  ${t.spot.name} (sneak route)`
                : t.spot.kind === 'vice'
                  ? this.vicePrompt(t.spot)
                  : t.spot.kind === 'laptop'
                  ? `E  ${this.watching ? 'Stop watching' : 'Watch'} the Ring cam`
                  : t.spot.kind === 'router'
              ? this.power === 'router'
                ? 'Q  Read the router logs'
                : 'The house router. Mikol set it up.'
              : `E  ${t.spot.name}`;
    else if (t?.kind === 'clue') {
      const c = this.pub?.clues.find((x) => x[0] === t.id);
      const cat = c?.[2] as Cat | undefined;
      const lock = c?.[6] === 1 ? 'phone' : c?.[6] === 2 ? 'bag' : null;
      prompt = lock
        ? `Hold E  Open the locked ${lock === 'phone' ? 'phone' : 'bin bag'} (${unlockTime(this.char, lock)} s)`
        : `E  Pick up: ${cat ? ITEM[cat].toLowerCase() : 'something'}${this.evil ? ' · hold R wipe it' : ''}`;
    } else if (t?.kind === 'coon') prompt = 'E  Shoo the raccoon! (herd it outside)';
    else if (t?.kind === 'perch') prompt = 'E  Sit down';
    else if (!t && this.perch >= 0) prompt = 'Move to get up';
    else if (t?.kind === 'player') {
      const near = t.t <= SHOVE_RANGE;
      const parts = [this.names.get(t.id) ?? ''];
      if (near) parts.push('V shove');
      if (this.evil && t.t <= KILL_RANGE && this.killReady() && !this.priv?.mates.includes(t.id)) parts.push('CLICK take out');
      prompt = parts.join(' · ');
    }
    // Holding: E digs through a search spot, R (Degenerates) wipes a clue away.
    const lockOf = (id: number) => this.pub?.clues.find((x) => x[0] === id)?.[6] ?? 0;
    const viceHold = t?.kind === 'spot' && t.spot.kind === 'vice' && t.spot.vice === 'coke';
    const holdKey =
      t?.kind === 'spot' && (t.spot.kind === 'search' || t.spot.kind === 'fix' || viceHold) && f.useHeld
        ? t.spot.id
        : t?.kind === 'clue' && lockOf(t.id) && f.useHeld
          ? `lock:${t.id}`
          : t?.kind === 'clue' && this.evil && f.altHeld
            ? `clue:${t.id}`
            : null;
    // Two-person chores: tell the referee while you're holding your end.
    const duo = t?.kind === 'spot' && t.spot.kind === 'duo' && f.useHeld ? t.spot.id : null;
    if (duo !== this.duoHeld) {
      if (duo) this.o.toHost({ t: 'duo', spot: duo, on: true });
      else if (this.duoHeld) this.o.toHost({ t: 'duo', spot: this.duoHeld, on: false });
      this.duoHeld = duo;
    }
    if (duo) prompt = 'Lifting… hold on (both ends for 4 s)';
    if (!holdKey) this.hold = null;
    else {
      if (this.hold?.key !== holdKey) this.hold = { key: holdKey, t: 0 };
      if (this.hold.t >= 0) {
        this.hold.t += dt;
        const lock = holdKey.startsWith('lock:') ? lockOf(Number(holdKey.slice(5))) : 0;
        const fix = holdKey.startsWith('fix-');
        if (holdKey === 'coke') {
          if (this.hold.t === dt) this.audio.play('sniff');
          prompt = `Doing a line… ${Math.min(100, Math.round((100 * this.hold.t) / VIBES.lineHold))}%`;
          if (this.hold.t >= VIBES.lineHold) {
            this.hold.t = -1e9;
            line(this.vibe, this.roam);
            this.hud.toast('WOO. Okay. Okay okay okay. Everything is so clear.', 3000);
          }
          this.hud.setPrompt(prompt);
          return;
        }
        const need = lock
          ? unlockTime(this.char, lock === 1 ? 'phone' : 'bag')
          : fix
            ? (SAB.hold[holdKey] ?? 3) / (this.char === 'dev' ? 2 : 1)
            : holdKey.startsWith('clue:')
              ? WIPE_SECONDS
              : (holdKey === 's-sink' ? 5 : SEARCH_SECONDS) / (this.char === 'xang' ? 2 : 1);
        prompt = `${lock ? 'Fiddling with it' : fix ? 'Fixing' : holdKey.startsWith('clue:') ? 'Wiping' : holdKey === 's-sink' ? 'Washing up' : 'Searching'}… ${Math.min(100, Math.round((100 * this.hold.t) / need))}%`;
        if (this.hold.t >= need) {
          if (holdKey.startsWith('clue:')) this.o.toHost({ t: 'wipe', id: Number(holdKey.slice(5)) });
          else if (fix) this.o.toHost({ t: 'fix', spot: holdKey });
          else if (lock) {
            this.o.toHost({ t: 'unlock', id: Number(holdKey.slice(5)) });
            this.wantClue = true;
          } else {
            this.o.toHost({ t: 'search', spot: holdKey });
            this.wantClue = true;
          }
          this.audio.play('click');
          this.hold.t = -1e9;
        }
      }
    }
    if (!prompt) prompt = this.smokePrompt();
    this.hud.setPrompt(prompt);
    if (f.alt && this.evil && t?.kind !== 'clue') this.openPlant();
    // The bin bag: once it's tied, carry it out to the wheelie bin.
    if (this.carrying) {
      const d = Math.hypot(this.walker.pos.x - BINBAG_DROP.x, this.walker.pos.z - BINBAG_DROP.z);
      if (d < 2 && this.walker.pos.y < 0) {
        prompt = 'E  Drop the bin bag in the wheelie bin';
        if (f.use) {
          this.o.toHost({ t: 'chore', spot: this.carrying });
          this.carrying = null;
          this.audio.play('ding');
          this.hud.toast('Bin bag: out. Chore done!');
          return this.hud.setPrompt('');
        }
      } else if (!prompt) prompt = 'Carrying the bin bag out to the wheelie bin (out the back door, round the side)';
      this.hud.setPrompt(prompt);
    }
    if (f.use && t) {
      if (t.kind === 'door') this.o.toHost({ t: 'door', id: t.door.id });
      else if (t.kind === 'clue') {
        if (!lockOf(t.id)) {
          this.wantClue = true;
          this.o.toHost({ t: 'inspect', id: t.id });
        }
      } else if (t.kind === 'coon') this.o.toHost({ t: 'shoo' });
      else if (t.kind === 'perch') this.sitDown(t.i);
      else if (t.kind === 'spot' && t.spot.kind === 'sneak') this.o.toHost({ t: 'sneak', spot: t.spot.id });
      else if (t.kind === 'spot' && t.spot.kind === 'laptop') this.watching = !this.watching;
      else if (t.kind === 'spot' && t.spot.vice === 'roll') this.startRolling();
      else if (t.kind === 'spot' && t.spot.vice === 'pill') this.takePill();
      else if (t.kind === 'spot' && t.spot.vice === 'bong') this.grabBong(t.spot);
      else if (t.kind === 'spot' && (t.spot.kind === 'search' || t.spot.kind === 'duo' || t.spot.kind === 'router' || t.spot.kind === 'fix')) return;
      else if (t.kind === 'spot' && t.spot.kind === 'fridge') this.togglePhone('board');
      else if (t.kind === 'body') this.o.toHost({ t: 'report', body: t.id });
      else if (t.kind === 'spot' && t.spot.kind === 'bell') {
        if (this.priv?.rang) this.hud.toast('You’ve already rung the bell tonight.');
        else this.o.toHost({ t: 'bell' });
      } else if (t.kind === 'spot') this.startChore(t.spot);
    }
    if (f.shove && t?.kind === 'player' && t.t <= SHOVE_RANGE) this.o.toHost({ t: 'shove', to: t.id });
    if (f.kill && this.evil && t?.kind === 'player' && t.t <= KILL_RANGE && this.killReady() && !this.priv?.mates.includes(t.id))
      this.o.toHost({ t: 'kill', v: t.id });
  }

  private killReady() {
    return !!this.priv && this.roam >= this.priv.killAt;
  }

  // -------------------------------------------------------------------------------------------
  // Clues, the phone, plants

  private overlay() {
    return !!(this.inspecting || this.plantMenu || this.phone.open || this.powerUI.menuOpen);
  }

  /** Esc closes whatever's open over the view; true if something was. */
  private closeOverlays(): boolean {
    if (this.inspecting) this.closeInspect();
    else if (this.powerUI.menuOpen) {
      this.powerUI.closeMenu();
      this.afterOverlay();
    } else if (this.plantMenu) this.closePlant();
    else if (this.phone.open) this.togglePhone();
    else return false;
    return true;
  }

  /** Back to looking around once an overlay closes. */
  private afterOverlay() {
    this.o.api.setMenuNav(this.paused || this.inMeeting());
    if (!this.inMeeting() && !this.paused) this.input.lock();
  }

  private openInspect(k: Known) {
    this.inspecting?.dispose();
    const posted = !!this.pub?.posted.some((p) => p[0] === k.id);
    this.inspecting = new InspectView(this.wrap, k, posted, this.pub ? crimeName(this.pub, this.names, k.crime) : '', {
      post: () => {
        if (!posted) {
          this.o.toHost({ t: 'post', id: k.id });
          this.hud.toast('📸 Posted to the group chat');
        }
        this.closeInspect();
      },
      close: () => this.closeInspect(),
    });
  }

  private closeInspect() {
    this.inspecting?.dispose();
    this.inspecting = null;
  }

  private togglePhone(tab?: PhoneTab) {
    const on = !this.phone.open;
    this.phone.show(on, tab);
    if (on) {
      this.input.unlock();
      this.o.api.setMenuNav(true);
      this.renderPhone();
    } else this.afterOverlay();
  }

  private renderPhone() {
    if (!this.pub || !this.phone.open) return;
    this.phone.render({
      feed: this.feed,
      seen: [...this.seen.values()],
      pub: this.pub,
      people: this.o.people.map((p) => ({ id: p.id, char: p.char, name: p.name, img: portrait(this.o.renderer, p.char, p.name) })),
      names: this.names,
      crossed: this.crossed,
      ping: this.char !== 'shota' && !this.ghost && this.o.people.some((p) => p.char === 'shota' && this.statusOf(p.id) === 'in') ? () => this.o.toHost({ t: 'ping' }) : null,
      post: (id) => this.o.toHost({ t: 'post', id }),
      cross: (id) => {
        if (!this.crossed.delete(id)) this.crossed.add(id);
        this.renderPhone();
      },
    });
  }

  /** The Degenerates' menu (R): sabotages, and plants while you're alive. */
  private openPlant() {
    if (!this.priv || !this.pub) return;
    this.input.unlock();
    this.o.api.setMenuNav(true);
    const belongings = [...new Set(this.o.people.map((p) => p.char).filter((c) => c !== 'guest'))];
    const canPlant = !this.ghost && this.pub.crimes.length > 0;
    const sabWait = this.pub.sab ? -1 : Math.max(0, this.priv.sabAt - this.roam);
    this.plantMenu = new PlantMenu(this.wrap, canPlant ? this.priv.plants : -1, belongings, sabWait, {
      plant: (cat, value) => {
        this.o.toHost({ t: 'plant', cat, value });
        this.hud.toast('Planted. Act natural.');
        this.closePlant();
      },
      sabotage: (kind) => {
        this.o.toHost({ t: 'sabotage', kind });
        this.closePlant();
      },
      close: () => this.closePlant(),
    });
  }

  private closePlant() {
    this.plantMenu?.dispose();
    this.plantMenu = null;
    this.afterOverlay();
  }

  // -------------------------------------------------------------------------------------------
  // Abilities, emotes and the cast's tells

  /** Q (your ability) and G (emotes), and the emote wheel's number keys. */
  private abilityInput(f: Frame, ph: PublicView['ph']) {
    if (this.powerUI.menuOpen && !this.phone.open) {
      for (let i = 1; i < EMOTES.length; i++) if (f.keys.has(`Digit${i}`)) this.pickEmote(i);
    }
    if (this.overlay() || this.chore || this.paused || this.ghost) return;
    if (f.emote && (ph === 'night' || this.inMeeting())) {
      this.o.api.setMenuNav(true);
      this.powerUI.emoteMenu((i) => this.pickEmote(i));
      return;
    }
    if (f.ability) this.usePower(ph);
    // Inspection: stand still for 3 s.
    if (this.inspectSince) {
      if (Math.hypot(this.walker.vel.x, this.walker.vel.z) > 0.3) {
        this.inspectSince = 0;
        this.hud.toast('You moved. Inspection’s off.');
      } else if (this.roam - this.inspectSince >= 3) {
        this.inspectSince = 0;
        this.o.toHost({ t: 'power', target: -1, crime: -1 });
      } else this.hud.setPrompt('Inspecting… stay still');
    }
  }

  private pickEmote(i: number) {
    this.powerUI.closeMenu();
    this.afterOverlay();
    const e = EMOTES[i];
    this.emote = { id: i, until: performance.now() + (e === 'dance' ? 6000 : 3000) };
    if (e !== 'five' && e !== 'hug') return;
    const t = this.findTarget();
    if (t?.kind === 'player' && t.t <= SHOVE_RANGE) this.o.toHost({ t: 'greet', to: t.id, k: e });
    else this.hud.toast(e === 'five' ? 'Nobody there. Your hand just hangs in the air.' : 'You hug the air. It doesn’t hug back.');
  }

  private usePower(ph: PublicView['ph']) {
    const p = this.priv?.power;
    if (!p || !this.pub) return;
    const def = POWERS[this.power];
    if (this.power === 'legend' || this.power === 'objection') {
      if (ph === 'vote' && p[0] !== 0) this.o.toHost({ t: 'power', target: -1, crime: -1 });
      else this.hud.toast(`${def.name}: use it during a vote.`);
      return;
    }
    if (ph !== 'night') return;
    if (p[0] === 0) return this.hud.toast(`${def.name}: used up tonight.`);
    if (this.roam < p[1]) return this.hud.toast(`${def.name}: ready in ${Math.ceil(p[1] - this.roam)} s.`);
    const t = this.lastTarget;
    switch (this.power) {
      case 'proof': {
        const people = this.o.people.map((x) => ({ id: x.id, name: this.names.get(x.id) ?? x.name }));
        const crimes = this.pub.crimes.map((_, i) => crimeName(this.pub!, this.names, i));
        this.input.unlock();
        this.o.api.setMenuNav(true);
        this.powerUI.proofMenu(people, crimes, (target, crime) => {
          this.o.toHost({ t: 'power', target, crime });
          this.afterOverlay();
        });
        return;
      }
      case 'lookout':
        if (t?.kind !== 'player') return this.hud.toast('Look right at a friend to look out for them.');
        return this.o.toHost({ t: 'power', target: t.id, crime: -1 });
      case 'swab':
        if (t?.kind !== 'clue') return this.hud.toast('Look right at a clue to swab it.');
        return this.o.toHost({ t: 'power', target: t.id, crime: -1 });
      case 'inspection':
        this.inspectSince = this.roam;
        return this.hud.toast('Inspecting: stand still for 3 s…');
      default:
        this.o.toHost({ t: 'power', target: -1, crime: -1 });
    }
  }

  /** What your ability turned up (and the effects that last). */
  private powerResult(text: string, pos: [number, number, number][], ids: number[], until: number) {
    if (text) this.powerUI.showCard(text, text.length > 140 ? 16 : 9);
    switch (this.power) {
      case 'toboggan':
        if (until) {
          this.until.sled = until;
          this.sledYaw = this.walker.yaw;
        }
        break;
      case 'bongus':
        this.until.bongus = until;
        this.glows.set(pos);
        this.hud.toast(pos.length ? `Yoooooooooo. ${pos.length} thing${pos.length > 1 ? 's' : ''} glowing nearby.` : 'Yoooooooooo. Nothing glowing round here.', 4000);
        break;
      case 'wallhack':
      case 'eavesdrop':
        this.until.xray = until;
        this.xrayRange = this.power === 'wallhack' ? 12 : 9;
        {
          const seen = [...this.remotes.values()].filter(
            (r) => this.statusOf(r.id) === 'in' && Math.hypot(r.pos.x - this.walker.pos.x, r.pos.y - this.walker.pos.y, r.pos.z - this.walker.pos.z) < this.xrayRange,
          ).length;
          this.hud.toast(seen ? `${POWERS[this.power].name}: ${seen} ${seen === 1 ? 'person' : 'people'} within ${this.xrayRange} m, glowing blue.` : `${POWERS[this.power].name}: nobody within ${this.xrayRange} m.`, 3500);
        }
        break;
      case 'inspection':
        this.until.sparkle = until;
        this.sparkles.set(ids.map((id) => this.evidence?.spots.get(id)).filter((v) => v).map((v) => [v!.x, v!.y + 0.15, v!.z]));
        break;
    }
  }

  /** Bike Stu's randoms: two strangers with "???" over their heads. */
  private syncNpcs(list: [number, number, number, number][]) {
    this.npcAt = list;
    while (this.npcs.length < list.length) {
      const i = this.npcs.length;
      const p = new Person(lookFor('guest', `stu${i}${this.o.me}`), 176 + i * 8);
      p.setTag('???', '#c9b8ff');
      p.root.position.set(list[i][0], list[i][1], list[i][2]);
      this.world.scene.add(p.root);
      this.npcs.push(p);
    }
    while (this.npcs.length > list.length) {
      const p = this.npcs.pop()!;
      this.world.scene.remove(p.root);
      p.dispose();
    }
  }

  private updateNpcs(dt: number) {
    this.npcs.forEach((p, i) => {
      const [x, y, z, yaw] = this.npcAt[i];
      const moved = Math.hypot(x - p.root.position.x, z - p.root.position.z);
      p.root.position.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * 8));
      p.root.rotation.y = yaw;
      p.pose({ speed: Math.min(3, moved / Math.max(dt, 1e-3)), crouch: false, pitch: 0 }, dt);
    });
  }

  /** Shota's shirt on the floor (and Shota without it). */
  private syncShirt(at: [number, number, number] | null) {
    if (!at || this.shirt) return;
    this.shirt = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.35), new THREE.MeshToonMaterial({ color: CAST.shota.look.shirt }));
    this.shirt.position.set(at[0], at[1] + 0.02, at[2]);
    this.shirt.rotation.y = 0.7;
    this.world.scene.add(this.shirt);
    for (const r of this.remotes.values()) if (r.char === 'shota') r.person.setShirtless(true);
  }

  // -------------------------------------------------------------------------------------------
  // Vices

  private vicePrompt(s: Spot): string {
    if (s.vice === 'roll') return this.vibe.joint === 'none' ? 'E  Roll a joint' : 'You’ve already got one rolled';
    if (s.vice === 'coke') return 'Hold E  Do a line off the plate';
    if (s.vice === 'pill') return 'E  Take the mystery pill (who knows)';
    if (this.vibe.bong) return 'Your hands are full (X puts yours down)';
    if (this.vibe.joint === 'lit') return 'Finish your joint first';
    return `E  Pick up ${s.name}`;
  }

  private startRolling() {
    if (this.vibe.joint !== 'none') return this.hud.toast('You’ve already got one. L to light it.');
    this.rolling = new ChoreView(this.wrap, 'roll', (what) => what === 'hit' && this.audio.play('click'));
  }

  private endRolling() {
    this.rolling?.dispose();
    this.rolling = null;
  }

  /** Picking up a bong off its table (if nobody else has it). */
  private grabBong(s: Spot) {
    if (this.vibe.joint === 'lit') return this.hud.toast('Finish your joint first: one hand for the bong, one for the lighter.');
    const i = BONGS.indexOf(s.id);
    if ([...this.remotes.values()].some((r) => r.h === 3 + i && this.statusOf(r.id) === 'in')) return this.hud.toast('Someone’s already got that one.');
    if (pickUp(this.vibe, s.id)) this.hud.toast(packed(this.vibe) ? 'Still packed. Hold L to light it and pull.' : 'Got it. Hold E to pack the bowl.', 2500);
  }

  /** What to do with what's in your hands, when nothing else wants the prompt. */
  private smokePrompt(): string {
    const v = this.vibe;
    if (v.bong) return packed(v) ? 'Hold L  Light it and pull · let go to clear it · X put it down' : 'Hold E  Pack the bowl · X put it down';
    if (v.joint === 'rolled') return 'L  Light the joint';
    if (v.joint === 'lit') return 'Hold L  Take a drag (let go to breathe out)';
    return '';
  }

  /**
   * Smoking, hands on. A joint: L flicks the lighter till it catches, then holding L is a drag (the cherry glows, it
   * burns down) and letting go breathes it out. A bong: E picks it up, hold E to pack the bowl, hold L to light it and
   * pull (bubbles, the chamber going milky), let go to clear it; X puts it back. The cloud comes out a beat after you
   * let go, as big as the hit; a big one ends in a cough.
   */
  private updateSmoking(f: Frame, dt: number, ph: PublicView['ph']) {
    const v = this.vibe;
    const can = ph === 'night' && !this.ghost && !this.paused && !this.chore && !this.rolling && !this.overlay();
    if ((ph !== 'night' || this.ghost) && v.bong) putDown(v);
    const was = this.smoking;
    this.smoking = false;
    if (can) {
      if (v.bong) {
        if (f.drop) {
          putDown(v);
          this.packing = 0;
          this.hud.toast('Put it back where it lives.', 1500);
        } else if (!packed(v) && f.useHeld && !this.lastTarget) {
          this.packing += dt;
          this.soundIn -= dt;
          if (this.soundIn < 0) {
            this.soundIn = 0.4;
            this.audio.play('click');
          }
          if (this.packing >= VIBES.packHold) {
            pack(v);
            this.packing = 0;
            this.hud.toast('Packed. Hold L to light it and pull; let go to clear it.', 3000);
          }
        } else if (!f.useHeld) this.packing = 0;
        if (packed(v) && f.lightHeld) {
          this.smoking = true;
          if (!was) {
            this.audio.play('lighter');
            this.soundIn = 0.3;
          }
          this.soundIn -= dt;
          if (this.soundIn < 0) {
            this.soundIn = 2;
            this.audio.play('bubble');
          }
          // Overfull: you can't hold any more, it comes out whether you like it or not.
          if (!ripDraw(v, dt)) this.smoking = false;
        }
        if (was && !this.smoking) this.breatheOut(clearRip(v, this.roam));
      } else if (v.joint === 'rolled') {
        if (this.lighting > 0) {
          this.lighting -= dt;
          if (this.lighting <= 0 && light(v)) this.hud.toast('It’s lit. Hold L to take a drag, let go to breathe out.', 3000);
        } else if (f.light) {
          this.lighting = VIBES.lightTime;
          this.audio.play('lighter');
        }
      } else if (v.joint === 'lit') {
        if (f.lightHeld && drag(v, dt)) {
          this.smoking = true;
          if (!was) this.audio.play('inhale');
        }
        if (was && !this.smoking) this.breatheOut(exhaleJoint(v, this.roam));
      }
    } else {
      this.packing = 0;
      this.lighting = 0;
      if (was) this.breatheOut(v.bong ? clearRip(v, this.roam) : exhaleJoint(v, this.roam));
    }
    // The cloud: a beat after you let go, pushed out ahead of you, then (maybe) the coughing.
    const e = this.exhale;
    if (e.delay > 0) e.delay -= dt;
    else if (e.left > 0) {
      e.left -= dt;
      e.every -= dt;
      if (e.every < 0) {
        e.every = 0.05;
        const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const c = this.camera.position;
        this.smokeFx.exhale({ x: c.x + fwd.x * 0.35, y: c.y - 0.1 + fwd.y * 0.35, z: c.z + fwd.z * 0.35 }, { x: fwd.x, y: fwd.y - 0.1, z: fwd.z }, e.size, 3);
      }
      if (e.left <= 0 && e.cough) {
        this.audio.play('cough');
        this.shake = 0.6;
        this.hud.toast(e.size > 0.8 ? '*HACK* *HACK* *wheeze*' : '*cough cough*', 1500);
      }
    }
    const inHand = !this.ghost && ph === 'night';
    this.held.update(dt, {
      item: v.bong ? 'bong' : v.joint !== 'none' && inHand ? 'joint' : 'none',
      burn: v.burn,
      lit: v.joint === 'lit',
      lighting: this.lighting > 0,
      packed: packed(v) ? 1 : Math.min(1, this.packing / VIBES.packHold),
      packing: this.packing > 0,
      fill: v.fill,
      ripping: this.smoking && !!v.bong,
      toMouth: this.smoking,
      walk: Math.min(1, Math.hypot(this.walker.vel.x, this.walker.vel.z) / 3),
    });
    this.smokeFx.update(dt);
    // A bong in someone's hands isn't on its table; yours show your packed bowls.
    const held = new Set([...this.remotes.values()].filter((r) => r.h >= 3 && this.statusOf(r.id) === 'in').map((r) => BONGS[r.h - 3]));
    if (v.bong) held.add(v.bong);
    for (const [id, b] of this.world.bongs) {
      b.root.visible = !held.has(id);
      b.set(v.packed.includes(id) ? 1 : 0, 0, false, dt);
    }
  }

  /** Breathing out what you just pulled: the cloud's queued up (after a beat), and a word on how it went. */
  private breatheOut(x: Exhale) {
    if (x.size <= 0) return;
    this.exhale = { delay: 0.35, left: 0.5 + x.size * 1.1, size: x.size, cough: x.cough, every: 0 };
    if (x.cashed && !this.vibe.bong) this.hud.toast('Cashed. Ohhh. Oh, that’s nice.', 2500);
    else if (this.vibe.bong) this.hud.toast(x.size > 0.8 ? 'Yoooooooooooo.' : x.size > 0.4 ? 'Nice rip.' : 'A little sip.', 2000);
  }

  /** Smoke off someone else: wisps off a lit joint or a bong mid-rip, and the clouds they blow out. */
  private remoteSmoke(r: Remote, dt: number) {
    r.wispIn -= dt;
    if (r.wispIn < 0) {
      r.wispIn = r.f & PF.hit ? 0.1 : 0.3;
      const at = r.person.smokeFrom(this.tmpV);
      if (at && (r.h === 2 || (r.h >= 3 && r.f & PF.hit))) this.smokeFx.wisp(at);
    }
    if (r.f & PF.exhale) {
      r.puffIn -= dt;
      if (r.puffIn < 0) {
        r.puffIn = 0.06;
        const m = r.person.mouth(this.tmpV);
        this.smokeFx.exhale(m, { x: -Math.sin(r.yaw), y: -0.1, z: -Math.cos(r.yaw) }, 0.7, 1);
      }
    }
  }

  private takePill() {
    const trip = pill(this.vibe, this.roam, Math.random());
    this.audio.play('gulp');
    const said = { rainbow: 'Colours. So many colours.', tiny: 'Why is everything so big?', giant: 'Why is everything so small?', wobbly: 'The floor is… doing a thing.' }[trip];
    this.hud.toast(`💊 ${said}`, 3500);
  }

  /** The screen effects, the heartbeat, and the chip saying how cooked you are. */
  private updateVibe(dt: number) {
    const v = this.vibe;
    const r = this.roam;
    const h = high(v, r);
    const wd = wired(v, r);
    const trip = tripping(v, r);
    this.wrap.classList.toggle('vibe-high', h && v.level === 1);
    this.wrap.classList.toggle('vibe-high2', h && v.level > 1);
    this.wrap.classList.toggle('vibe-wired', wd);
    this.wrap.classList.toggle('vibe-down', comingDown(v, r));
    this.wrap.classList.toggle('vibe-rainbow', trip === 'rainbow');
    if (wd) {
      this.heartbeat -= dt;
      if (this.heartbeat < 0) {
        this.heartbeat = 0.55;
        this.audio.play('heart');
      }
    }
    const left = (until: number) => `${Math.floor((until - r) / 60)}:${String(Math.ceil((until - r) % 60)).padStart(2, '0')}`;
    const bits: string[] = [];
    if (v.joint === 'rolled' && !v.bong) bits.push('🌿 Joint rolled · L to light');
    if (v.joint === 'lit') bits.push(`🔥 Joint lit · hold L for a drag (${Math.round(v.burn * 100)}% left)`);
    if (v.bong) bits.push(packed(v) ? '🫧 Packed · hold L to rip, let go to clear · X put down' : '🫧 Bong in hand · hold E to pack · X put down');
    if (h) bits.push(`${v.level > 1 ? '🌫️ Baked' : '🌿 High'} ${left(v.highUntil)}`);
    if (wd) bits.push(`⚡ Wired ${left(v.wiredUntil)}`);
    else if (comingDown(v, r)) bits.push(`😩 Coming down ${left(v.comedownUntil)}`);
    if (trip) bits.push(`💊 ${trip} ${left(v.tripUntil)}`);
    this.vibeChip.textContent = bits.join(' · ');
    this.vibeChip.style.display = bits.length ? '' : 'none';
  }

  /** The raccoon: a little grey bandit with a striped tail. */
  private syncCoon(p: [number, number, number, number] | null) {
    this.coonAt = p;
    if (!this.raccoon) {
      const g = new THREE.Group();
      const grey = new THREE.MeshToonMaterial({ color: 0x7a7672 });
      const dark = new THREE.MeshToonMaterial({ color: 0x2a2826 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), grey);
      body.scale.set(1, 0.8, 1.5);
      body.position.y = 0.22;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), grey);
      head.position.set(0, 0.3, -0.32);
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.04), dark);
      mask.position.set(0, 0.32, -0.44);
      g.add(body, head, mask);
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 8), i % 2 ? dark : grey);
        ring.rotation.x = 1.2;
        ring.position.set(0, 0.28 + i * 0.03, 0.34 + i * 0.08);
        g.add(ring);
      }
      this.raccoon = g;
      this.world.scene.add(g);
    }
    this.raccoon.visible = !!p;
  }

  /** The house's moving parts on this screen: sabotage effects, the raccoon, the Ring cam, the Unflushed's gag. */
  /**
   * Who you hear and how loud: by distance and walls at night, everyone at full volume at a meeting or the end.
   * The living never hear ghosts; ghosts hear everyone.
   */
  private updateVoice(ph: PublicView['ph']) {
    if (!this.voice.on) {
      this.voiceLine.textContent = '';
      return;
    }
    const open = ph === 'over' || this.inMeeting() || ph === 'result' || ph === 'intro';
    const peers = new Map<number, { at: Vec3; gain: number; muffle: 0 | 1 | 2 }>();
    for (const r of this.remotes.values()) {
      const st = this.statusOf(r.id);
      if (st === 'gone' || (st !== 'in' && !this.ghost && ph !== 'over')) continue;
      const at = { x: r.pos.x, y: r.pos.y + 1.5, z: r.pos.z };
      if (open) peers.set(r.id, { at: { ...this.walker.pos, y: this.walker.pos.y + 1.5 }, gain: 1, muffle: 0 });
      else {
        const muffle = this.muffle(at);
        const d = Math.hypot(at.x - this.walker.pos.x, at.y - this.walker.pos.y - 1.5, at.z - this.walker.pos.z);
        peers.set(r.id, { at, gain: voiceGain(d, muffle), muffle });
      }
    }
    const talking = this.voice.update({ ...this.walker.pos, y: this.walker.pos.y + 1.5 }, this.walker.yaw, peers);
    const names = [...talking].map((id) => this.names.get(id) ?? '?');
    this.voiceLine.textContent = `${this.voice.muted ? '🔇' : '🎙'}${names.length ? ' ' + names.join(', ') : ''}`;
  }

  private updateHouse(dt: number, ph: PublicView['ph']) {
    const sab = this.pub?.sab ?? null;
    const kind = sab?.[0] as SabKind | undefined;
    // The party in the living room and Wags's record upstairs: off in a power cut, down low for meetings.
    const music = kind === 'power' || ph === 'over' ? 0 : this.inMeeting() || ph === 'result' ? 0.06 : 0.22;
    const party = { x: 7.85, y: 1, z: 12.2 };
    const record = { x: 5, y: FLOOR_Y[2] + 1, z: 19.5 };
    this.audio.loop('party', party, music, this.muffle(party));
    this.audio.loop('record', record, ph === 'over' ? 0.5 : music * 0.8, ph === 'over' ? 0 : this.muffle(record));
    this.world.setPower(kind !== 'power');
    this.world.setFlood(kind === 'flood' && sab ? Math.min(1, (this.roam - (sab[1] - SAB.crisis)) / SAB.crisis) : 0);
    if (kind === 'alarm' && this.char !== 'mikol' && ph === 'night') {
      this.alarmBeep -= dt;
      if (this.alarmBeep < 0) {
        this.alarmBeep = 0.45;
        this.audio.play('alarm');
      }
    }
    if (this.raccoon && this.coonAt) {
      const [x, y, z, yaw] = this.coonAt;
      this.raccoon.position.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * 6));
      this.raccoon.rotation.y = yaw;
    }
    // The Ring cam: someone watching lights the doorbell red (for everyone).
    if (this.watching && Math.hypot(this.walker.pos.x - 6.25, this.walker.pos.z - 9.35) > 2.5) this.watching = false;
    const watched = this.watching || [...this.remotes.values()].some((r) => r.f & PF.watch && this.statusOf(r.id) === 'in');
    this.world.setDoorbell(watched);
    // The Unflushed: nobody can stand the top bathroom for more than 8 s (Mikol's unbothered).
    const inBath = this.pub?.caseId === 'unflushed' && !this.ghost && this.char !== 'mikol' && roomAt({ ...this.walker.pos, y: this.walker.pos.y + 0.1 })?.id === 'bath3';
    if (inBath && this.roam < this.gagUntil) this.pushOutOfBath();
    else if (inBath) {
      this.gag += dt;
      if (this.gag > 8) {
        this.pushOutOfBath();
        this.gagUntil = this.roam + 4;
        this.audio.play('gag');
        this.hud.toast('*gag* You can’t take any more. Out. (Back in 4 s.)', 2500);
      }
    } else this.gag = Math.max(0, this.gag - dt * 2);
    this.wrap.classList.toggle('gag', inBath && this.gag > 4);
  }

  private pushOutOfBath() {
    this.walker.pos = { x: 5.9, y: FLOOR_Y[2], z: 10.5 };
    this.walker.vel = { x: 0, y: 0, z: 0 };
    this.gag = 0;
  }

  /** Your night goes into this browser's stats, once. */
  private saveStats() {
    const w = this.pub?.win;
    if (this.statsSaved || !w) return;
    this.statsSaved = true;
    const degenerate = this.evil;
    saveNight({ char: this.char, won: (w.side === 'degenerates') === degenerate, degenerate, evicted: this.status === 'out', takenOut: this.status === 'dead' });
  }

  /** Plays the takeout replays on the case-closed card, looping. */
  private drawReplays(dt: number) {
    this.replayT = (this.replayT + dt * 2) % 24;
    this.replays.forEach((r, i) => {
      const cv = this.replayCanvases[i];
      if (!cv?.isConnected || !r.f.length) return;
      const g = cv.getContext('2d')!;
      const last = r.f[r.f.length - 1];
      const floor = last.find((e) => e[0] === r.v)?.[3] ?? 0;
      const sx = (x: number) => 10 + ((x + 1) / 10.6) * 180;
      const sz = (z: number) => 10 + ((z + 1.5) / 23) * 280;
      g.fillStyle = '#16102a';
      g.fillRect(0, 0, 200, 300);
      g.strokeStyle = '#5a4a8a';
      for (const room of ROOMS) if (room.floor === floor && !room.outside) g.strokeRect(sx(room.min.x), sz(room.min.z), sx(room.max.x) - sx(room.min.x), sz(room.max.z) - sz(room.min.z));
      const frame = r.f[Math.min(r.f.length - 1, Math.floor(this.replayT))];
      for (const [id, x, z, fl] of frame) {
        if (fl !== floor) continue;
        g.fillStyle = id === r.k ? '#ff3d5a' : id === r.v ? '#ffd21a' : '#e8e4ff';
        g.beginPath();
        g.arc(sx(x), sz(z), id === r.k || id === r.v ? 5 : 3.5, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  /** Nash's sofas: the navy couch and the leather one. */
  private onCouch() {
    const p = this.walker.pos;
    return p.y < 0.5 && ((p.x > 7.2 && p.z > 6.6 && p.z < 11.2) || (p.z > 11.2 && p.x > 4 && p.x < 7.7));
  }

  /** Will's cologne (stand still 2 s to sniff) and Jung's buzzing phone. */
  private tells(dt: number) {
    if (this.ghost || this.pub?.ph !== 'night') return;
    this.stillFor = Math.hypot(this.walker.vel.x, this.walker.vel.z) < 0.1 ? this.stillFor + dt : 0;
    if (this.stillFor < 2 || this.char === 'will') return;
    const room = roomAt({ ...this.walker.pos, y: this.walker.pos.y + 0.1 });
    const last = room && this.willRooms.get(room.id);
    if (!room || !last || this.sniffed === `${room.id}:${last}`) return;
    const willHere = [...this.remotes.values()].some((r) => r.char === 'will' && roomAt({ ...r.pos, y: r.pos.y + 0.1 })?.id === room.id);
    if (!willHere && performance.now() - last < 20000) {
      this.sniffed = `${room.id}:${last}`;
      this.hud.toast('*sniff* … Will Palmer’s cologne. He was just in here.', 3500);
    }
  }

  /** Illogical!: two posted photos from one crime that nobody in the house fits both of. */
  private checkLogic(v: PublicView) {
    for (const a of v.posted)
      for (const b of v.posted) {
        if (a[0] >= b[0] || a[3] !== b[3]) continue;
        const key = `${a[0]}:${b[0]}`;
        if (this.illogical.has(key)) continue;
        const someone = this.o.people.some((p) => fits(p, a[1] as Cat, a[2]) && fits(p, b[1] as Cat, b[2]));
        if (someone) continue;
        this.illogical.add(key);
        this.hud.toast(`📳 ILLOGICAL! Photos #${a[0] + 1} and #${b[0] + 1} from ${crimeName(v, this.names, a[3])} can’t both be true. One’s a plant.`, 7000);
        this.audio.play('buzz');
      }
  }

  // -------------------------------------------------------------------------------------------
  // Chores

  private startChore(spot: Spot) {
    if (!spot.chore) return;
    this.chore = {
      spot,
      view: new ChoreView(this.wrap, spot.chore, (what) => {
        if (what === 'hit') this.audio.play('click');
        else if (what === 'miss') this.audio.play('fail');
      }),
    };
  }

  private runChore(dt: number, f: Frame) {
    const c = this.chore!;
    this.hud.setPrompt('');
    if (f.pad[1] || this.pub?.ph !== 'night') return this.endChore();
    // Will Palmer supervises: anyone working near him is quicker, his own chores are slower.
    const will = [...this.remotes.values()].some((r) => r.char === 'will' && this.statusOf(r.id) === 'in' && Math.hypot(r.pos.x - this.walker.pos.x, r.pos.y - this.walker.pos.y, r.pos.z - this.walker.pos.z) < 3);
    const speed = this.char === 'will' ? 0.67 : will ? 1.5 : 1;
    if (c.view.frame(dt, f, speed)) {
      if (c.spot.chore === 'binbag') {
        this.carrying = c.spot.id;
        this.hud.toast('Tied off. Now carry it out to the wheelie bin.');
        return this.endChore();
      }
      this.o.toHost({ t: 'chore', spot: c.spot.id });
      this.audio.play('ding');
      this.hud.toast(this.evil ? 'Chore “done”. Very convincing.' : 'Chore done!');
      this.endChore();
    }
  }

  private endChore() {
    this.chore?.view.dispose();
    this.chore = null;
  }

  // -------------------------------------------------------------------------------------------
  // HUD, the eviction walk, rendering

  private updateHud(ph: PublicView['ph']) {
    const v = this.pub;
    if (!v) return;
    const c = caseById(v.caseId);
    const flood = ph === 'night' && v.sab?.[0] === 'flood';
    const label = flood ? '🚽 FLOOD! Stop it in' : ph === 'night' ? 'Last Meeting in' : ph === 'meeting' ? 'Discussion' : ph === 'vote' ? 'Vote' : '';
    const left = flood ? v.sab![1] - this.roam : ph === 'night' ? v.len - this.roam : this.left;
    this.hud.setClock(left, label, v.prog, c.title);
    if (this.inMeeting()) this.meeting.setTime(`${ph === 'vote' ? 'Vote' : 'Discuss'} · ${Math.max(0, Math.ceil(this.left))} s`);
    this.hud.showCross(ph === 'night' && !this.chore);
    if (this.evil && !this.ghost && ph === 'night' && this.priv) {
      const wait = this.priv.killAt - this.roam;
      this.hud.setKill(wait > 0 ? `Take out in ${Math.ceil(wait)} s` : `Take out ready (${c.weapon})`, wait <= 0);
    } else this.hud.setKill('', false);
    this.hud.setHint(ph === 'night' ? (this.ghost ? 'Ghost · Space up · C down · E chores / rattle' : KEYS) : '');
    const pw = this.priv?.power;
    if (pw) this.powerUI.setChip(this.power, pw[0], pw[1] - this.roam, !this.ghost && ph === 'night');
    if (this.inMeeting()) {
      const can = ph === 'vote' && !this.ghost && (this.power === 'legend' || this.power === 'objection') && pw?.[0] !== 0;
      this.meeting.setPower(can ? (this.power === 'legend' ? '😎 Campus Legend: double my vote (Q)' : '✋ OBJECTION! Void this vote (Q)') : null, () => this.usePower(ph));
    }
  }

  private updateEviction(dt: number) {
    const e = this.eviction;
    if (!e) return;
    e.t += dt;
    const pos = e.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * 9;
      if (y < -0.75) y += 7;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    if (!e.person) return;
    // Out the front door, across the porch, down the steps, off up the street.
    const path: [number, number, number][] = [
      [2.4, 0, 19.4],
      [2.5, 0, 21.9],
      [2.6, -0.75, 23.5],
      [2.6, -0.75, 26],
      [5, -0.75, 29.5],
    ];
    const s = Math.min(path.length - 1.001, Math.max(0, e.t - 0.6) * 0.75);
    const i = Math.floor(s);
    const k = s - i;
    const [ax, ay, az] = path[i];
    const [bx, by, bz] = path[i + 1];
    e.person.root.position.set(lerp(ax, bx, k), lerp(ay, by, k), lerp(az, bz, k));
    e.person.root.rotation.y = Math.atan2(-(bx - ax), -(bz - az));
    e.person.pose({ speed: 1.6, crouch: false, pitch: -0.3 }, dt);
  }

  private render() {
    const r = this.o.renderer;
    const c = r.domElement;
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (w < 2 || h < 2) return;
    if (c.width !== Math.round(w * r.getPixelRatio()) || c.height !== Math.round(h * r.getPixelRatio())) r.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.setClearColor(0x120e24, 1);
    r.render(this.world.scene, this.camera);
    this.held.render(r, w / h);
    // The Ring cam, picture in picture: the porch and the street, live (no WiFi, no picture).
    if (this.watching && this.pub?.sab?.[0] !== 'wifi') {
      const pw = Math.round(w * 0.36);
      const ph = Math.round((pw * 10) / 16);
      this.ringCam.position.set(2.35, 2.2, DOOR_CAM_Z);
      this.ringCam.lookAt(2.2, 0, 27);
      r.setScissorTest(true);
      r.setScissor(w - pw - 16, 16, pw, ph);
      r.setViewport(w - pw - 16, 16, pw, ph);
      r.render(this.world.scene, this.ringCam);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
    }
  }

  destroy() {
    this.held.dispose();
    this.smokeFx.dispose();
    this.touch?.dispose();
    this.voice.dispose();
    this.endRolling();
    if (this.duoHeld) this.o.toHost({ t: 'duo', spot: this.duoHeld, on: false });
    this.syncNpcs([]);
    this.self.dispose();
    this.powerUI.dispose();
    this.glows.dispose();
    this.sparkles.dispose();
    if (this.shirt) {
      this.shirt.geometry.dispose();
      (this.shirt.material as THREE.Material).dispose();
    }
    this.endChore();
    this.closeInspect();
    this.plantMenu?.dispose();
    this.phone.dispose();
    this.evidence?.dispose();
    this.endEviction();
    this.offs.forEach((f) => f());
    this.input.dispose();
    this.audio.dispose();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.syncBodies([]);
    this.world.dispose();
    this.hud.dispose();
    this.meeting.root.remove();
    this.wrap.remove();
    this.o.api.setMenuNav(true);
  }
}
