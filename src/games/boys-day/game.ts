// The app: the menu (solo, host, join), the lobby and the runs. The host's browser starts each run (a fresh seed:
// a new map every time) and referees it; everyone's browser runs a Session.

import * as THREE from 'three';
import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import { paintBanner } from './banner.ts';
import { paintOf } from './models.ts';
import { firstSeats, readMsg } from './net.ts';
import { MAX_PLAYERS, newSeed } from './rules.ts';
import { Session } from './session.ts';
import './boys.css';

export function mount(root: HTMLElement, api: GameApi): () => void {
  const app = new App(root, api);
  return () => app.destroy();
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

class App {
  private party: Party | null = null;
  private session: Session | null = null;
  private renderer: THREE.WebGLRenderer;
  private raf = 0;
  private last = performance.now();
  private offs: (() => void)[] = [];
  private note = '';
  private hostAtStart = -1;

  constructor(
    private root: HTMLElement,
    private api: GameApi,
  ) {
    root.classList.add('boys-day');
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'bd-canvas';
    this.menu();
    this.raf = requestAnimationFrame(this.tick);
    if (import.meta.env.DEV) (window as unknown as { __boys: App }).__boys = this;
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session?.frame(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  // -------------------------------------------------------------------------------------------
  // Screens

  private screen(...kids: HTMLElement[]) {
    this.api.setMenuNav(true);
    this.root.replaceChildren();
    const wrap = el('div', 'bd-menu');
    const art = el('canvas', 'bd-menu-art') as HTMLCanvasElement;
    art.width = 960;
    art.height = 400;
    paintBanner(art);
    wrap.append(art, ...kids);
    this.root.append(wrap);
    (wrap.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
  }

  private menu() {
    const card = el('div', 'bd-card');
    card.append(el('h1', 'bd-title', 'BOYS DAY'));
    card.append(el('p', 'bd-blurb', 'You wake up in the paintball arena after the biggest night of your lives. The world ended while you were blacked out. Drive the bus home, paint the zombies, win Gordie’s bail, and get back to the house for bong tokes with the boys.'));
    if (this.note) card.append(el('p', 'bd-note', this.note));
    const solo = el('button', 'bd-btn big', '🚌  Play solo');
    solo.dataset.autofocus = '';
    solo.onclick = () => this.solo();
    const host = el('button', 'bd-btn big', '🎉  Host a run (up to 8)');
    host.onclick = () => void this.connect(null);
    const row = el('div', 'bd-join');
    const code = el('input', 'bd-code') as HTMLInputElement;
    code.placeholder = 'CODE';
    code.maxLength = 4;
    code.autocapitalize = 'characters';
    const join = el('button', 'bd-btn', 'Join');
    join.onclick = () => code.value.trim() && void this.connect(code.value.trim().toUpperCase());
    code.onkeydown = (e) => e.key === 'Enter' && join.click();
    row.append(code, join);
    const rooms = el('div', 'bd-rooms');
    const back = el('button', 'bd-btn ghost', '← Back to the games');
    back.onclick = () => this.api.exit();
    card.append(solo, host, row, rooms, back);
    this.screen(card);
    void this.api.party
      .list()
      .then((list) => {
        if (!rooms.isConnected) return;
        for (const p of list.slice(0, 6)) {
          const b = el('button', 'bd-btn room', `Join ${p.host}’s bus (${p.code}) · ${p.players} aboard`);
          b.onclick = () => void this.connect(p.code);
          rooms.append(b);
        }
      })
      .catch(() => {});
  }

  private lobby() {
    const p = this.party;
    if (!p) return this.menu();
    const card = el('div', 'bd-card');
    card.append(el('h1', 'bd-title small', 'THE BUS'));
    const code = el('p', 'bd-roomcode');
    code.append('Room code: ', el('b', '', p.code));
    card.append(code);
    card.append(el('p', 'bd-blurb', p.isHost ? 'Get the boys on board, then start. You’ll drive first; anyone can swap seats with F / Ⓨ.' : 'On board. Waiting for the host to start the bus…'));
    const list = el('div', 'bd-crewlist');
    p.members.slice(0, MAX_PLAYERS).forEach((m, i) => {
      const row = el('div', 'bd-crewrow');
      const dot = el('span', 'dot');
      dot.style.background = paintOf(i);
      row.append(dot, el('span', '', `${m.name}${m.id === p.hostId ? ' (host)' : ''}${m.id === p.id ? ' — you' : ''}`));
      list.append(row);
    });
    if (p.members.length > MAX_PLAYERS) list.append(el('p', 'bd-note', `${p.members.length - MAX_PLAYERS} more watching (the bus seats 8).`));
    card.append(list);
    if (p.isHost) {
      const start = el('button', 'bd-btn big', '🚌  Start the bus');
      start.dataset.autofocus = '';
      start.onclick = () => this.startRun();
      card.append(start);
    }
    const leave = el('button', 'bd-btn ghost', 'Leave');
    leave.onclick = () => this.leave('');
    card.append(leave);
    this.screen(card);
  }

  // -------------------------------------------------------------------------------------------
  // Parties and runs

  private async connect(code: string | null) {
    try {
      const p = code ? await this.api.party.join(code) : await this.api.party.host();
      this.party = p;
      this.note = '';
      this.offs.push(
        p.onMessage((from, data) => this.onMessage(from, data)),
        p.onMembers(() => this.onMembers()),
        p.onClose((why) => this.leave(why || 'The bus left without you.')),
      );
      this.lobby();
    } catch (e) {
      this.note = code ? `Couldn’t join ${code}: ${(e as Error).message || 'no such bus'}` : 'Couldn’t start a room. Try again?';
      this.menu();
    }
  }

  private onMembers() {
    const p = this.party!;
    if (this.session) {
      if (p.hostId !== this.hostAtStart) return this.leave('The host left, so the bus is gone.');
      this.session.dropMissing(new Set(p.members.map((m) => m.id)));
    } else this.lobby();
  }

  private onMessage(from: number, data: unknown) {
    const m = readMsg(data);
    if (!m || !this.party) return;
    if (m.t === 'start') {
      if (from !== this.party.hostId) return;
      this.begin(m.seed, m.seats);
      return;
    }
    this.session?.onMsg(from, m);
  }

  /** Host: a fresh map for everyone. */
  private startRun() {
    const seed = newSeed();
    const p = this.party;
    if (!p) return this.begin(seed, firstSeats([0], 0));
    const crew = p.members.slice(0, MAX_PLAYERS).map((m) => m.id);
    const seats = firstSeats(crew, p.id);
    p.setOpen(false);
    p.send({ t: 'start', seed, seats });
    this.begin(seed, seats);
  }

  private solo() {
    this.party = null;
    this.startRun();
  }

  private begin(seed: number, seats: number[]) {
    this.session?.dispose();
    this.root.replaceChildren();
    const p = this.party;
    this.hostAtStart = p?.hostId ?? 0;
    const crew = p ? p.members.slice(0, MAX_PLAYERS).map((m) => ({ id: m.id, name: m.name })) : [{ id: 0, name: this.api.name || 'You' }];
    this.session = new Session(
      this.root,
      this.renderer,
      {
        me: p?.id ?? 0,
        hostId: p?.hostId ?? 0,
        crew,
        solo: !p,
        send: (m) => p?.send(m),
      },
      seed,
      seats,
      this.api,
      () => this.leave(''),
      () => this.startRun(),
    );
  }

  private leave(why: string) {
    this.session?.dispose();
    this.session = null;
    for (const f of this.offs) f();
    this.offs = [];
    this.party?.leave();
    this.party = null;
    this.note = why;
    this.menu();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.session?.dispose();
    this.session = null;
    for (const f of this.offs) f();
    this.party?.leave();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.replaceChildren();
    this.root.classList.remove('boys-day');
  }
}
