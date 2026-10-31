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
import { DOORS, FLOOR_Y, MEETING_CENTRE, REACH, SEATS, SPOTS, doorBox, floorOf, roomAt, wakeSpot, type Door, type Spot } from './house.ts';
import { Hud, KEYS, chip, loadPrefs, type Prefs } from './hud.ts';
import { Input, type Frame } from './input.ts';
import { portrait } from './lobby.ts';
import { Meeting } from './meeting.ts';
import { newWalker, nudgeApart, shove, stepWalker } from './move.ts';
import { PF, type Msg } from './net.ts';
import { Person } from './people.ts';
import { KILL_RANGE, TIMES, type Joiner, type PrivateView, type PublicView, type Status } from './rules.ts';
import { World } from './world.ts';

const POSE_HZ = 15;
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
}

type Target =
  | { kind: 'door'; door: Door; t: number }
  | { kind: 'spot'; spot: Spot; t: number }
  | { kind: 'body'; id: number; t: number }
  | { kind: 'player'; id: number; t: number };

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
  private texts = new Set<number>();
  private eviction: { person: Person | null; rain: THREE.Points; t: number } | null = null;
  private shake = 0;
  private introStage = '';
  /** Where you sat at the last meeting (you stand up from it). */
  private seat = -1;
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
    this.input = new Input(o.renderer.domElement, o.api);
    this.camera.rotation.order = 'YXZ';
    this.world.scene.add(this.camera);
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
      if (!this.input.locked && !this.inMeeting() && !this.chore && !this.paused) this.setPaused(true);
    };
    document.addEventListener('pointerlockchange', onLock);
    this.offs.push(() => document.removeEventListener('pointerlockchange', onLock));
    // Esc never quits a night: it pauses, closes a chore, or leaves the chat box.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
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
    this.remotes.set(p.id, { id: p.id, name: p.name, char: p.char, person, cone, buf: [], pos: { ...start }, yaw: 0, pitch: 0, f: 0, speed: 0, walked: 0 });
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
        r.buf.push({ t: performance.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, f: m.f });
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
    if (!prev || prev.ph !== v.ph) this.enterPhase(v.ph, prev?.ph);
    if (v.ph === 'meeting' || v.ph === 'vote') this.drawMeeting();
    if (was !== this.status) this.refreshTasks();
  }

  private becomeGhost(st: Status) {
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
          ? `${by} found ${this.names.get(v.meet.body ?? -1) ?? 'someone'}’s body.`
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

    const canMove = (ph === 'night' || (this.ghost && ph !== 'over')) && !this.paused && !this.chore && !(this.inMeeting() && !this.ghost);
    const canLook = !this.chore && (!this.paused || this.inMeeting()) && ph !== 'result' && ph !== 'over';
    if (canLook) {
      this.walker.yaw += f.yaw;
      this.walker.pitch = Math.max(-1.45, Math.min(1.45, this.walker.pitch + f.pitch));
    }
    // Seated players sit inside the sofa's box: they're placed, not walked (collision would lift them out).
    const sitting = !this.ghost && this.seat >= 0 && (this.inMeeting() || ph === 'result');
    if (!sitting) {
      stepWalker(
        this.walker,
        { fwd: canMove ? f.fwd : 0, side: canMove ? f.side : 0, jump: canMove && f.jump, crouch: canMove && f.crouch, up: canMove && f.jump },
        dt,
        this.world.colliders,
      );
      nudgeApart(this.walker, this.livingRemotePositions(), dt, this.world.colliders);
    }
    this.ownSteps(dt);

    if (f.torch && !this.ghost && ph !== 'over') {
      this.torch = !this.torch;
      this.audio.play('click');
    }
    if (this.chore) this.runChore(dt, f);
    else if (ph === 'night' && !this.paused) this.interact(f);
    else this.hud.setPrompt('');

    this.updateRemotes(dt);
    this.placeCamera(dt, sitting);
    this.updateHud(ph);
    this.sendPose(dt, sitting);
    this.world.update(dt, this.camera.position);
    this.world.torch.intensity = this.torch ? TORCH_POWER : 0;
    this.updateEviction(dt);
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
    const eyeY = sitting ? 1.15 * k : w.ghost ? this.eye : w.crouch ? this.eye - 0.45 : this.eye;
    const sp = Math.hypot(w.vel.x, w.vel.z);
    const bob = this.prefs.bob && w.onGround && sp > 0.5 ? Math.sin(this.bob) * 0.035 : 0;
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * 0.08;
    this.camera.position.set(w.pos.x + (Math.random() - 0.5) * sh, w.pos.y + eyeY + bob + (Math.random() - 0.5) * sh, w.pos.z);
    this.camera.rotation.set(w.pitch, w.yaw, 0);
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
      (w.crouch ? PF.crouch : 0) |
      (this.torch ? PF.torch : 0) |
      (w.ghost ? PF.ghost : 0) |
      (sitting ? PF.sit : 0) |
      (this.chore ? PF.busy : 0);
    const m: Msg = { t: 'p', x: r2(w.pos.x), y: r2(w.pos.y), z: r2(w.pos.z), yaw: r2(wrapAngle(w.yaw)), pitch: r2(w.pitch), f };
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
      const ghost = st !== 'in';
      const visible = st !== 'gone' && (!ghost || this.ghost) && this.pub?.ph !== 'result';
      r.person.root.visible = visible;
      r.person.setOpacity(ghost ? 0.35 : 1);
      r.person.root.position.set(nx, ny + (ghost ? Math.sin(performance.now() / 400 + r.id) * 0.08 : 0), nz);
      r.person.root.rotation.y = r.yaw;
      r.person.pose({ speed: ghost ? 0 : r.speed, crouch: !!(r.f & PF.crouch), pitch: r.pitch, sit: !!(r.f & PF.sit) }, dt);
      r.person.setFace(r.f & PF.busy ? 'worried' : 'smile');
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
          this.audio.step(r.pos, this.surfaceAt(r.pos), this.muffle({ x: nx, y: ny + 0.2, z: nz }));
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
        const t = raySphere(o, d, { x: r.pos.x, y: r.pos.y + CAST[r.char].height / 100 - 0.6, z: r.pos.z }, 0.45, REACH);
        consider({ kind: 'player', id: r.id, t });
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
    for (const s of SPOTS) {
      if (s.kind === 'bell' && this.ghost) continue;
      if (s.kind === 'chore' && !this.priv?.tasks.some(([id, done]) => id === s.id && !done)) continue;
      consider({ kind: 'spot', spot: s, t: raySphere(o, d, s.pos, 0.5, REACH) });
    }
    return best;
  }

  private interact(f: Frame) {
    const t = this.findTarget();
    let prompt = '';
    if (this.ghost) {
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
    else if (t?.kind === 'spot') prompt = `E  ${t.spot.name}`;
    else if (t?.kind === 'player') {
      const near = t.t <= SHOVE_RANGE;
      const parts = [this.names.get(t.id) ?? ''];
      if (near) parts.push('V shove');
      if (this.evil && t.t <= KILL_RANGE && this.killReady() && !this.priv?.mates.includes(t.id)) parts.push('CLICK take out');
      prompt = parts.join(' · ');
    }
    this.hud.setPrompt(prompt);
    if (f.use && t) {
      if (t.kind === 'door') this.o.toHost({ t: 'door', id: t.door.id });
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
    if (c.view.frame(dt, f)) {
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
    const label = ph === 'night' ? 'Last Meeting in' : ph === 'meeting' ? 'Discussion' : ph === 'vote' ? 'Vote' : '';
    const left = ph === 'night' ? v.len - this.roam : this.left;
    this.hud.setClock(left, label, v.prog, c.title);
    if (this.inMeeting()) this.meeting.setTime(`${ph === 'vote' ? 'Vote' : 'Discuss'} · ${Math.max(0, Math.ceil(this.left))} s`);
    this.hud.showCross(ph === 'night' && !this.chore);
    if (this.evil && !this.ghost && ph === 'night' && this.priv) {
      const wait = this.priv.killAt - this.roam;
      this.hud.setKill(wait > 0 ? `Take out in ${Math.ceil(wait)} s` : `Take out ready (${c.weapon})`, wait <= 0);
    } else this.hud.setKill('', false);
    this.hud.setHint(ph === 'night' ? (this.ghost ? 'Ghost · Space up · C down · E chores / rattle' : KEYS) : '');
    // The case's texts come in through the night.
    if (ph === 'night')
      c.texts.forEach(([at, from, text], i) => {
        if (this.texts.has(i) || this.roam < at * v.len) return;
        this.texts.add(i);
        this.hud.toast(`📱 ${from}: ${text}`, 6000);
        this.audio.play('click');
      });
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
  }

  destroy() {
    this.endChore();
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
