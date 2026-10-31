// Abilities and emotes on screen: the ability chip (Q), result cards (Router Logs, Proof, texts from Bike Stu), Jung's
// Proof menu, the emote wheel (G), the buzz arrow (Worrier, Always Down) and Bongus Mode's glowing markers.

import * as THREE from 'three';
import { POWERS, type Power } from './abilities.ts';
import { EMOTES, type Emote } from './net.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const EMOTE_NAMES: Record<Exclude<Emote, ''>, string> = {
  wave: '👋 Wave',
  point: '👉 Point',
  shrug: '🤷 Shrug',
  facepalm: '🤦 Facepalm',
  dance: '🕺 Dance',
  five: '✋ High-five',
  hug: '🤗 Hug',
};

export class PowerUI {
  readonly chip = el('div', 'rd-power-chip');
  private card = el('div', 'rd-pwcard');
  private arrow = el('div', 'rd-arrow', '▲');
  private menu: HTMLElement | null = null;
  private cardUntil = 0;
  /** Where the buzz arrow points, and until when (performance.now ms). */
  private buzz: { x: number; z: number; until: number } | null = null;

  constructor(private parent: HTMLElement) {
    this.card.style.display = 'none';
    this.arrow.style.display = 'none';
    parent.append(this.chip, this.card, this.arrow);
  }

  /** The ability chip: name, and ready / cooling down / uses left. */
  setChip(power: Power, uses: number, wait: number, usable: boolean) {
    const def = POWERS[power];
    const state = !usable ? '' : uses === 0 ? 'used up' : wait > 0 ? `${Math.ceil(wait)} s` : uses > 0 ? `ready · ${uses} left` : 'ready';
    this.chip.textContent = `Q  ${def.name}${state ? ` · ${state}` : ''}`;
    this.chip.classList.toggle('ready', usable && uses !== 0 && wait <= 0);
    this.chip.title = def.text;
  }

  /** A result card (multi-line), up for a while or until dismissed. */
  showCard(text: string, secs = 10) {
    this.card.replaceChildren();
    for (const line of text.split('\n')) this.card.append(el('p', '', line));
    this.card.style.display = '';
    this.cardUntil = performance.now() + secs * 1000;
  }

  pointTo(x: number, z: number, secs: number) {
    this.buzz = { x, z, until: performance.now() + secs * 1000 };
  }

  /** Per frame: hide what's timed out, aim the arrow (relative to where you're facing). */
  update(eye: { x: number; z: number }, yaw: number) {
    const now = performance.now();
    if (this.cardUntil && now > this.cardUntil) {
      this.card.style.display = 'none';
      this.cardUntil = 0;
    }
    if (this.buzz && now < this.buzz.until) {
      const bearing = Math.atan2(-(this.buzz.x - eye.x), -(this.buzz.z - eye.z));
      this.arrow.style.display = '';
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${-(bearing - yaw)}rad)`;
    } else this.arrow.style.display = 'none';
  }

  get menuOpen() {
    return !!this.menu;
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  /** Jung's Proof: pick a player, then a crime. */
  proofMenu(people: { id: number; name: string }[], crimes: string[], pick: (target: number, crime: number) => void) {
    this.closeMenu();
    const box = el('div', 'rd-plantbox calm');
    box.dataset.navScope = '';
    box.append(el('h2', '', 'Proof'), el('p', 'rd-dim', 'Who, and against which crime’s real photos?'));
    let who = -1;
    const grid = el('div', 'rd-plantgrid');
    const crimeRow = el('div', 'rd-plantgrid');
    for (const p of people) {
      const b = el('button', 'rd-btn small', p.name);
      b.addEventListener('click', () => {
        who = p.id;
        grid.querySelectorAll('button').forEach((x) => x.classList.toggle('hot', x === b));
        crimeRow.querySelector<HTMLButtonElement>('button')?.focus();
      });
      grid.append(b);
    }
    crimes.forEach((c, i) => {
      const b = el('button', 'rd-btn small', c);
      b.addEventListener('click', () => {
        if (who < 0) return;
        pick(who, i);
        this.closeMenu();
      });
      crimeRow.append(b);
    });
    const close = el('button', 'rd-btn ghost small', 'Never mind (Esc)');
    close.addEventListener('click', () => this.closeMenu());
    box.append(grid, crimeRow, close);
    this.menu = el('div', 'rd-plant');
    this.menu.append(box);
    this.parent.append(this.menu);
    grid.querySelector<HTMLButtonElement>('button')?.focus();
  }

  /**
   * The emote wheel: held open (G), aimed by moving the mouse (or the stick) away from its middle, picked by letting
   * go (or a click). `wheelPick` is the EMOTES index under the aim, or -1 while you're still in the middle.
   */
  wheelPick = -1;
  private wheelItems: HTMLElement[] = [];
  private wheelLabel: HTMLElement | null = null;
  private wheelAim = { x: 0, y: 0 };

  get wheelOpen() {
    return !!this.menu?.classList.contains('rd-wheel');
  }

  openWheel() {
    this.closeMenu();
    const box = el('div', 'rd-wheel');
    const ids = EMOTES.map((e, i) => (e ? i : -1)).filter((i) => i > 0);
    this.wheelItems = ids.map((i, k) => {
      const e = EMOTES[i] as Exclude<Emote, ''>;
      const [icon, ...name] = EMOTE_NAMES[e].split(' ');
      const item = el('div', 'rd-wheel-item');
      item.append(el('b', '', icon), el('span', '', name.join(' ')));
      const a = (k / ids.length) * Math.PI * 2;
      item.style.left = `${50 + Math.sin(a) * 36}%`;
      item.style.top = `${50 - Math.cos(a) * 36}%`;
      item.dataset.emote = String(i);
      box.append(item);
      return item;
    });
    this.wheelLabel = el('div', 'rd-wheel-mid', 'Move to pick · let go of G');
    box.append(this.wheelLabel);
    this.wheelAim = { x: 0, y: 0 };
    this.wheelPick = -1;
    this.menu = box;
    this.parent.append(box);
  }

  /** Mouse (or stick) movement since last frame, in pixels: steers the pick. */
  aimWheel(dx: number, dy: number) {
    if (!this.wheelOpen) return;
    const a = this.wheelAim;
    a.x += dx;
    a.y += dy;
    const len = Math.hypot(a.x, a.y);
    // Kept within a short reach, so changing your mind is a small flick.
    if (len > 120) {
      a.x *= 120 / len;
      a.y *= 120 / len;
    }
    const n = this.wheelItems.length;
    let k = -1;
    if (len > 26) {
      const ang = (Math.atan2(a.x, -a.y) + Math.PI * 2) % (Math.PI * 2);
      k = Math.round(ang / ((Math.PI * 2) / n)) % n;
    }
    this.wheelItems.forEach((item, j) => item.classList.toggle('on', j === k));
    this.wheelPick = k < 0 ? -1 : Number(this.wheelItems[k].dataset.emote);
    if (this.wheelLabel) {
      const e = this.wheelPick > 0 ? (EMOTES[this.wheelPick] as Exclude<Emote, ''>) : null;
      this.wheelLabel.textContent = e ? EMOTE_NAMES[e] : 'Move to pick · let go of G';
    }
  }

  dispose() {
    this.closeMenu();
    this.chip.remove();
    this.card.remove();
    this.arrow.remove();
  }
}

/** Bongus Mode: soft glowing orbs where hidden clues are, seen through walls. */
export class Glows {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;

  constructor(color = 0x9cff6a) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false });
  }
  private geo = new THREE.SphereGeometry(0.22, 12, 8);

  set(points: [number, number, number][]) {
    this.group.clear();
    for (const [x, y, z] of points) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.position.set(x, y, z);
      m.renderOrder = 999;
      this.group.add(m);
    }
  }

  pulse(t: number) {
    this.mat.opacity = 0.35 + Math.sin(t * 5) * 0.25;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
