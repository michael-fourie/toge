// The mystery on screen: clue props lying around the house (each with a yellow evidence tent), the case's scene
// (Donal's smashed kit, the tower of dishes, the unflushed horror), photos on the fridge; picking a clue up and
// turning it over; the phone (group chat, Case File, Suspect Board); the Degenerates' plant menu.

import * as THREE from 'three';
import { tagFor, type CharId } from './cast.ts';
import { ITEM, VALUES, detail, fits, label, type Cat } from './clues.ts';
import { FLOOR_Y, SPOTS } from './house.ts';
import { SABOTAGES, SAB_KINDS, type SabKind } from './sabotage.ts';
import type { Frame } from './input.ts';
import { ramp } from './people.ts';
import type { PublicView } from './rules.ts';

const toon = (color: number | string) => new THREE.MeshToonMaterial({ color, gradientMap: ramp() });

/** What each kind of clue looks like on the floor: a size and a colour (a sheet, a butt, a can, a hair...). */
const SHAPES: Record<Cat, { size: [number, number, number]; color: string }> = {
  notes: { size: [0.21, 0.004, 0.29], color: '#f4f1e6' },
  smoke: { size: [0.05, 0.02, 0.05], color: '#e8dcc2' },
  temper: { size: [0.08, 0.004, 0.08], color: '#ffe14d' },
  room: { size: [0.3, 0.06, 0.2], color: '#8a7ab0' },
  drinking: { size: [0.07, 0.12, 0.07], color: '#c0c6d0' },
  footprint: { size: [0.12, 0.004, 0.3], color: '#6a4a2a' },
  hairColour: { size: [0.18, 0.004, 0.012], color: '#3a2a1a' },
  hairLength: { size: [0.06, 0.05, 0.22], color: '#d06aa0' },
  belonging: { size: [0.18, 0.08, 0.14], color: '#3a7a9a' },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A number tent like a forensics marker. */
function tentTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd21a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#111';
  g.font = '900 40px system-ui';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Prop {
  group: THREE.Group;
  item: THREE.Mesh;
  tex: THREE.CanvasTexture;
  mats: THREE.Material[];
}

/** Clue props, the case scene and the fridge's photos, kept in step with the referee's public view. */
export class Evidence {
  readonly group = new THREE.Group();
  private props = new Map<number, Prop>();
  private shared: THREE.BufferGeometry[] = [new THREE.BoxGeometry(1, 1, 1), new THREE.ConeGeometry(0.06, 0.12, 3)];
  private scene: THREE.Object3D[] = [];
  private fridge: THREE.Mesh[] = [];
  private postedKey = '';
  private lit = -1;

  constructor(caseId: string) {
    this.buildScene(caseId);
  }

  /** Where each clue on view is (for targeting). */
  readonly spots = new Map<number, THREE.Vector3>();

  sync(v: PublicView) {
    const live = new Set(v.clues.map((c) => c[0]));
    for (const [id, p] of this.props)
      if (!live.has(id)) {
        this.group.remove(p.group);
        p.tex.dispose();
        p.mats.forEach((m) => m.dispose());
        this.props.delete(id);
        this.spots.delete(id);
      }
    for (const [id, , cat, x, y, z] of v.clues) {
      if (this.props.has(id)) continue;
      const s = SHAPES[cat as Cat];
      const g = new THREE.Group();
      const mat = toon(s.color);
      const item = new THREE.Mesh(this.shared[0], mat);
      item.scale.set(...s.size);
      item.position.y = s.size[1] / 2 + 0.002;
      item.rotation.y = (id * 1.7) % Math.PI;
      const tex = tentTexture(id + 1);
      const tentMat = new THREE.MeshBasicMaterial({ map: tex });
      const tent = new THREE.Mesh(this.shared[1], tentMat);
      tent.position.set(0.22, 0.06, 0);
      g.add(item, tent);
      g.position.set(x, y + 0.005, z);
      this.group.add(g);
      this.props.set(id, { group: g, item, tex, mats: [mat, tentMat] });
      this.spots.set(id, new THREE.Vector3(x, y + 0.08, z));
    }
    this.syncFridge(v.posted);
  }

  /** The clue under your crosshair glows a little (null: none). */
  highlight(id: number | null) {
    if (id === this.lit) return;
    const old = this.props.get(this.lit);
    if (old) (old.mats[0] as THREE.MeshToonMaterial).emissive.setHex(0x000000);
    this.lit = id ?? -1;
    const p = this.props.get(this.lit);
    if (p) (p.mats[0] as THREE.MeshToonMaterial).emissive.setHex(0x554400);
  }

  /** Photos of posted clues stuck to the fridge door, as polaroids. */
  private syncFridge(posted: PublicView['posted']) {
    const key = posted.map((p) => p[0]).join();
    if (key === this.postedKey) return;
    this.postedKey = key;
    for (const m of this.fridge) {
      this.group.remove(m);
      (m.material as THREE.MeshBasicMaterial).map?.dispose();
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
    }
    this.fridge = [];
    const f = SPOTS.find((s) => s.kind === 'fridge')!;
    posted.slice(-12).forEach(([, cat, value], i) => {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 112;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fbfaf4';
      g.fillRect(0, 0, 96, 112);
      g.fillStyle = SHAPES[cat as Cat].color;
      g.fillRect(8, 8, 80, 66);
      g.fillStyle = '#222';
      g.font = '700 12px system-ui';
      g.textAlign = 'center';
      g.fillText(label(cat as Cat, value), 48, 92, 88);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.13), new THREE.MeshBasicMaterial({ map: tex }));
      m.rotation.y = Math.PI / 2;
      m.rotation.z = ((i * 37) % 11) / 60 - 0.08;
      m.position.set(f.pos.x + 0.005, 1.65 - Math.floor(i / 4) * 0.17, f.pos.z - 0.24 + (i % 4) * 0.13);
      this.group.add(m);
      this.fridge.push(m);
    });
  }

  /** The opening crime, as props: Donal's kit in pieces, the tower of dishes, the top-floor horror. */
  private buildScene(caseId: string) {
    const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, toon(color));
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      this.group.add(m);
      this.scene.push(m);
    };
    if (caseId === 'drumset') {
      const y = FLOOR_Y[1];
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 20), '#b0202a', 6.2, y + 0.28, 17, Math.PI / 2, 0.4);
      add(new THREE.CylinderGeometry(0.18, 0.18, 0.15, 18), '#b0202a', 7.1, y + 0.08, 17.9);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 18), '#e8e8e8', 6.6, y + 0.2, 18.3, 1.2, 0.2);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 24), '#d4a530', 7.3, y + 0.02, 16.8, 0.1, 0.05);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 24), '#d4a530', 5.9, y + 0.15, 18.2, 0.5, 0.2);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), '#e8c890', 6.8, y + 0.02, 17.2, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), '#e8c890', 6.95, y + 0.02, 17.35, 0, 1.2);
    } else if (caseId === 'sink') {
      for (let i = 0; i < 14; i++) add(new THREE.CylinderGeometry(0.13, 0.11, 0.025, 16), i % 3 ? '#f2f0ea' : '#7aa0c8', 5.6 + Math.sin(i) * 0.04, 0.95 + i * 0.03, 0.45);
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 16), '#2a2a2e', 5.62, 0.95 + 14 * 0.03, 0.45, 0.2);
    } else {
      const y = FLOOR_Y[2];
      add(new THREE.CylinderGeometry(0.45, 0.45, 0.005, 24), '#7a5a1a', 7.6, y + 0.003, 7.4);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.005, 24), '#8a6a2a', 7.0, y + 0.004, 8.1);
    }
  }

  dispose() {
    for (const p of this.props.values()) {
      p.tex.dispose();
      p.mats.forEach((m) => m.dispose());
    }
    for (const o of [...this.scene, ...this.fridge]) {
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.MeshBasicMaterial).map?.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.shared.forEach((g) => g.dispose());
  }
}

// ---------------------------------------------------------------------------------------------
// Turning a clue over in your hands

export interface Known {
  id: number;
  cat: Cat;
  value: string;
  crime: number;
}

/** The clue you're holding: front (what it is) and back (what it gives away); move the mouse or stick to turn it. */
export class InspectView {
  readonly root = el('div', 'rd-inspect');
  private card = el('div', 'rd-clue3d');
  private turn = 0;

  constructor(
    parent: HTMLElement,
    readonly clue: Known,
    posted: boolean,
    crimeName: string,
    private h: { post(): void; close(): void },
  ) {
    const front = el('div', 'rd-face front');
    const swatch = el('div', 'rd-swatch');
    swatch.style.background = SHAPES[clue.cat].color;
    front.append(el('small', '', `Evidence #${clue.id + 1} · ${crimeName}`), swatch, el('b', '', ITEM[clue.cat]), el('small', '', 'Turn it over →'));
    const back = el('div', 'rd-face back');
    back.append(el('small', '', 'On the back'), el('p', '', detail(clue.cat, clue.value)), el('b', '', label(clue.cat, clue.value)));
    this.card.append(front, back);
    const buttons = el('div', 'rd-row');
    const photo = el('button', 'rd-btn hot small', posted ? 'Already in the group chat' : '📸 Photo to the group chat (P)');
    photo.disabled = posted;
    photo.addEventListener('click', () => this.h.post());
    const close = el('button', 'rd-btn small', 'Put it down (E)');
    close.addEventListener('click', () => this.h.close());
    buttons.append(photo, close);
    this.root.append(this.card, el('p', 'rd-dim', 'Move the mouse (or stick) to turn it over. Only you see what it says, unless you post it.'), buttons);
    parent.append(this.root);
  }

  frame(f: Frame) {
    this.turn = Math.max(-200, Math.min(200, this.turn + f.mx + (f.pad[15] ? 40 : 0) - (f.pad[14] ? 40 : 0)));
    this.card.style.transform = `rotateY(${(this.turn / 200) * 180}deg)`;
    if (f.keys.has('KeyP') || f.pad[3]) this.h.post();
    else if (f.use || f.pad[1]) this.h.close();
  }

  dispose() {
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------------------------
// The phone: group chat, Case File, Suspect Board

export interface FeedItem {
  from: string;
  text: string;
}

export interface PhoneData {
  feed: FeedItem[];
  seen: Known[];
  pub: PublicView;
  people: { id: number; char: CharId; name: string; img: string }[];
  names: Map<number, string>;
  crossed: Set<number>;
  post(id: number): void;
  cross(id: number): void;
  /** Always Down: ping Shota (null when he isn't around, or you're him). */
  ping: (() => void) | null;
}

export type PhoneTab = 'chat' | 'file' | 'board';

/** "the case" or "Mikol's takeout" for a crime index. */
export function crimeName(pub: PublicView, names: Map<number, string>, crime: number): string {
  const c = pub.crimes[crime];
  if (!c) return 'a crime';
  return c[0] === 0 ? 'the case' : `${names.get(c[1]) ?? 'someone'}’s takeout`;
}

export class Phone {
  readonly root = el('div', 'rd-phone');
  tab: PhoneTab = 'chat';
  open = false;

  constructor(parent: HTMLElement) {
    this.root.dataset.navScope = '';
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  show(on: boolean, tab?: PhoneTab) {
    this.open = on;
    if (tab) this.tab = tab;
    this.root.style.display = on ? '' : 'none';
  }

  render(d: PhoneData) {
    if (!this.open) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.k;
    this.root.replaceChildren();
    const tabs = el('div', 'rd-tabs');
    for (const [k, name] of [
      ['chat', 'Group chat'],
      ['file', 'Case File'],
      ['board', 'Suspect Board'],
    ] as const) {
      const b = el('button', `rd-tab${this.tab === k ? ' on' : ''}`, name);
      b.dataset.k = `tab-${k}`;
      b.addEventListener('click', () => {
        this.tab = k;
        this.render(d);
      });
      tabs.append(b);
    }
    const body = el('div', 'rd-phonebody');
    if (this.tab === 'chat') this.chat(body, d);
    else if (this.tab === 'file') this.file(body, d);
    else this.board(body, d);
    this.root.append(el('div', 'rd-notch'), tabs, body, el('p', 'rd-dim', 'Tab / View to put the phone away'));
    (focused ? this.root.querySelector<HTMLElement>(`[data-k="${focused}"]`) : this.root.querySelector<HTMLElement>('.rd-tab.on'))?.focus({ preventScroll: true });
    if (this.tab === 'chat') body.scrollTop = body.scrollHeight;
  }

  private chat(body: HTMLElement, d: PhoneData) {
    if (d.ping) {
      const b = el('button', 'rd-btn small', '📣 Ping Shota (he’s always down)');
      b.dataset.k = 'ping';
      b.addEventListener('click', () => d.ping?.());
      body.append(b);
    }
    if (!d.feed.length) body.append(el('p', 'rd-dim', 'The house group chat. Photos of clues land here.'));
    for (const f of d.feed) {
      const m = el('div', 'rd-msg');
      m.append(el('b', '', f.from), el('span', '', f.text));
      body.append(m);
    }
  }

  private file(body: HTMLElement, d: PhoneData) {
    if (!d.seen.length) body.append(el('p', 'rd-dim', 'Clues you pick up go here. Only you know what they say until you post them.'));
    const posted = new Set(d.pub.posted.map((p) => p[0]));
    for (const c of d.seen) {
      const row = el('div', 'rd-filerow');
      row.append(el('b', '', `#${c.id + 1} ${label(c.cat, c.value)}`), el('small', '', crimeName(d.pub, d.names, c.crime)));
      const b = el('button', 'rd-btn small', posted.has(c.id) ? 'Posted' : 'Post photo');
      b.dataset.k = `post-${c.id}`;
      b.disabled = posted.has(c.id);
      b.addEventListener('click', () => d.post(c.id));
      row.append(b);
      body.append(row);
    }
  }

  /** Guess Who for the house: everyone × every clue you know, ✓ where it fits. You cross people out yourself. */
  private board(body: HTMLElement, d: PhoneData) {
    const cols: { cat: Cat; value: string; crime: number; mine: boolean }[] = d.pub.posted.map(([, cat, value, crime]) => ({ cat: cat as Cat, value, crime, mine: false }));
    const posted = new Set(d.pub.posted.map((p) => p[0]));
    for (const c of d.seen) if (!posted.has(c.id)) cols.push({ cat: c.cat, value: c.value, crime: c.crime, mine: true });
    cols.sort((a, b) => a.crime - b.crime);
    if (!cols.length) {
      body.append(el('p', 'rd-dim', 'No clues yet. Posted photos (and clues you’ve picked up) appear here as columns.'));
      return;
    }
    const table = el('table', 'rd-board');
    const head = el('tr', '');
    head.append(el('th', '', 'Who'));
    for (const c of cols) {
      const th = el('th', c.mine ? 'mine' : '');
      th.append(el('small', '', crimeName(d.pub, d.names, c.crime)), el('span', '', label(c.cat, c.value)));
      if (c.mine) th.title = 'Only you know this one';
      head.append(th);
    }
    table.append(head);
    for (const p of d.people) {
      const tr = el('tr', d.crossed.has(p.id) ? 'crossed' : '');
      const who = el('td', 'who');
      const b = el('button', 'rd-whobtn');
      b.dataset.k = `cross-${p.id}`;
      const img = document.createElement('img');
      img.src = p.img;
      img.alt = '';
      b.append(img, el('span', '', tagFor(p.char, p.name)));
      b.title = 'Cross out / back in';
      b.addEventListener('click', () => d.cross(p.id));
      who.append(b);
      tr.append(who);
      for (const c of cols) tr.append(el('td', '', fits(p, c.cat, c.value) ? '✓' : '·'));
      table.append(tr);
    }
    body.append(table, el('p', 'rd-dim', 'Plants look exactly like real clues. Two clues from one crime that can’t both be true means one is fake.'));
  }

  dispose() {
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------------------------
// The Degenerates' plant menu

const PLANT_CATS: Cat[] = ['notes', 'smoke', 'temper', 'room', 'drinking', 'footprint', 'hairColour', 'hairLength', 'belonging'];

export class PlantMenu {
  readonly root = el('div', 'rd-plant');

  /** `left`: plants left (-1: you can't plant, e.g. as a ghost); `sabWait`: seconds until a sabotage (0: ready, -1: one's on). */
  constructor(
    parent: HTMLElement,
    left: number,
    belongings: CharId[],
    sabWait: number,
    h: { plant(cat: Cat, value: string): void; sabotage(kind: SabKind): void; close(): void },
  ) {
    this.root.dataset.navScope = '';
    const box = el('div', 'rd-plantbox');
    box.append(el('h2', '', 'Sabotage'), el('p', 'rd-dim', sabWait < 0 ? 'One’s already going.' : sabWait > 0 ? `Ready in ${Math.ceil(sabWait)} s.` : 'One at a time. The flood wins the night if nobody stops it.'));
    const sabs = el('div', 'rd-plantgrid');
    let first = true;
    for (const k of SAB_KINDS) {
      const b = el('button', 'rd-btn small', SABOTAGES[k].name);
      b.title = SABOTAGES[k].text;
      b.disabled = sabWait !== 0;
      if (first && !b.disabled) b.dataset.autofocus = '';
      first &&= b.disabled;
      b.addEventListener('click', () => h.sabotage(k));
      sabs.append(b);
    }
    box.append(sabs);
    if (left >= 0) box.append(el('h2', '', 'Plant a fake clue'), el('p', 'rd-dim', `${left} left tonight. Pick what it says: frame someone.`));
    const grid = el('div', 'rd-plantgrid');
    for (const cat of left > 0 ? PLANT_CATS : []) {
      const values = cat === 'belonging' ? belongings : VALUES[cat].filter((v) => v !== 'none' && v !== 'calm');
      for (const v of values) {
        const b = el('button', 'rd-btn small', label(cat, v));
        if (first) b.dataset.autofocus = '';
        first = false;
        b.addEventListener('click', () => h.plant(cat, v));
        grid.append(b);
      }
    }
    const close = el('button', 'rd-btn ghost small', 'Never mind (Esc)');
    close.addEventListener('click', () => h.close());
    box.append(grid, close);
    this.root.append(box);
    parent.append(this.root);
    (box.querySelector<HTMLButtonElement>('button:not([disabled])') ?? close).focus();
  }

  dispose() {
    this.root.remove();
  }
}
