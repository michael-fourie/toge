// The app: the menu (solo, host, join), the lobby and the runs. The host's browser starts each run (a fresh seed:
// a new map every time) and referees it; everyone's browser runs a Session.

import * as THREE from 'three';
import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import { artReady, loadArt } from './assets.ts';
import { paintBanner } from './banner.ts';
import { paintOf } from './models.ts';
import { readMsg } from './net.ts';
import { ANY_BOY, BOYS, castBoys, isPick } from './roster.ts';
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

const PICK_KEY = 'boys-day.boy';

function loadPick() {
  try {
    const v = Number(localStorage.getItem(PICK_KEY) ?? ANY_BOY);
    return isPick(v) ? v : ANY_BOY;
  } catch {
    return ANY_BOY;
  }
}

function savePick(b: number) {
  try {
    localStorage.setItem(PICK_KEY, String(b));
  } catch {
    /* private mode: just this visit */
  }
}

class App {
  private party: Party | null = null;
  private session: Session | null = null;
  private renderer: THREE.WebGLRenderer;
  private raf = 0;
  private last = performance.now();
  private offs: (() => void)[] = [];
  private note = '';
  private hostAtStart = -1;
  /** Who I'd like to be (kept per browser), and what the others in the room have said. */
  private myPick = loadPick();
  private picks = new Map<number, number>();
  /** Counts run starts still waiting on the models (a newer start, or leaving, cancels an older one). */
  private starting = 0;
  private gone = false;

  constructor(
    private root: HTMLElement,
    private api: GameApi,
  ) {
    root.classList.add('boys-day');
    void loadArt();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'bd-canvas';
    this.menu();
    // While a game is mounted the site leaves Escape to it, and the pad's Ⓑ sends Escape, so every screen of ours
    // has to take you back itself: a run handles its own (Session), the lobby drops back to the menu, the menu
    // leaves for the game chooser.
    addEventListener('keydown', this.onEsc, { capture: true });
    this.raf = requestAnimationFrame(this.tick);
    if (import.meta.env.DEV) (window as unknown as { __boys: App }).__boys = this;
  }

  private onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || this.session) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (this.party) this.leave('');
    else this.api.exit();
  };

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
    card.append(el('p', 'bd-blurb', 'You wake up in the paintball arena after the biggest night of your lives. The world ended while you were blacked out. Drive the bus from checkpoint to checkpoint, each one a new world: hop off, do the job, unlock guns, win scrap at the card table, fix up the bus. There’s no finish line. How far can the boys get?'));
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
    card.append(this.picker(() => this.menu()), solo, host, row, rooms, back);
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
    card.append(el('p', 'bd-blurb', p.isHost ? 'Get the boys on board, then start. You’ll drive first; anyone can walk up to the wheel when it’s free (F / Ⓨ).' : 'On board. Waiting for the host to start the bus…'));
    const list = el('div', 'bd-crewlist');
    p.members.slice(0, MAX_PLAYERS).forEach((m, i) => {
      const row = el('div', 'bd-crewrow');
      const dot = el('span', 'dot');
      dot.style.background = paintOf(i);
      const pick = m.id === p.id ? this.myPick : (this.picks.get(m.id) ?? ANY_BOY);
      row.append(dot, el('span', '', `${m.name}${m.id === p.hostId ? ' (host)' : ''}${m.id === p.id ? ' — you' : ''}`), el('span', 'cash', pick === ANY_BOY ? 'surprise me' : `as ${BOYS[pick].name}`));
      list.append(row);
    });
    if (p.members.length > MAX_PLAYERS) list.append(el('p', 'bd-note', `${p.members.length - MAX_PLAYERS} more watching (the bus seats 8).`));
    card.append(list, this.picker(() => this.lobby()));
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

  /** Who do you want to be? One button each, and "surprise me". `again` redraws the screen it's on. */
  private picker(again: () => void) {
    const box = el('div', 'bd-picker');
    box.append(el('p', 'bd-note', 'Who are you today?'));
    const row = el('div', 'bd-picker-row');
    const add = (b: number, label: string) => {
      const btn = el('button', `bd-btn pick${this.myPick === b ? ' on' : ''}`, label);
      if (b >= 0) btn.style.setProperty('--boy', BOYS[b].shirt);
      btn.onclick = () => {
        this.myPick = b;
        savePick(b);
        this.party?.send({ t: 'pick', b });
        again();
      };
      row.append(btn);
    };
    add(ANY_BOY, '🎲 Surprise me');
    BOYS.forEach((boy, i) => add(i, boy.name));
    box.append(row);
    return box;
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
      p.send({ t: 'pick', b: this.myPick });
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
    } else {
      // So whoever just got on knows who I am.
      p.send({ t: 'pick', b: this.myPick });
      this.lobby();
    }
  }

  private onMessage(from: number, data: unknown) {
    const m = readMsg(data);
    if (!m || !this.party) return;
    if (m.t === 'start') {
      if (from !== this.party.hostId) return;
      this.begin(m.seed, m.driver, m.boys);
      return;
    }
    if (m.t === 'pick') {
      this.picks.set(from, m.b);
      if (!this.session) this.lobby();
      return;
    }
    this.session?.onMsg(from, m);
  }

  /** Host: a fresh map for everyone. */
  private startRun() {
    const seed = newSeed();
    const p = this.party;
    if (!p) return this.begin(seed, 0, castBoys([this.myPick], Math.random));
    p.setOpen(false);
    const boys = castBoys(p.members.slice(0, MAX_PLAYERS).map((m) => (m.id === p.id ? this.myPick : this.picks.get(m.id))), Math.random);
    p.send({ t: 'start', seed, driver: p.id, boys });
    this.begin(seed, p.id, boys);
  }

  private solo() {
    this.party = null;
    this.startRun();
  }

  /** Starts a run once the models are in (they're asked for when the game opens, so usually at once). */
  private begin(seed: number, driver: number, boys: readonly number[]) {
    if (artReady()) return this.beginNow(seed, driver, boys);
    const token = ++this.starting;
    void loadArt().then(() => token === this.starting && !this.gone && this.beginNow(seed, driver, boys));
  }

  private beginNow(seed: number, driver: number, boys: readonly number[]) {
    this.session?.dispose();
    this.root.replaceChildren();
    const p = this.party;
    this.hostAtStart = p?.hostId ?? 0;
    const crew = p ? p.members.slice(0, MAX_PLAYERS).map((m, i) => ({ id: m.id, name: m.name, boy: boys[i] ?? 0 })) : [{ id: 0, name: this.api.name || 'You', boy: boys[0] ?? 0 }];
    this.session = new Session(
      this.root,
      this.renderer,
      {
        me: p?.id ?? 0,
        hostId: p?.hostId ?? 0,
        crew,
        solo: !p,
        send: (m, to) => p?.send(m, to),
      },
      seed,
      driver,
      this.api,
      () => this.leave(''),
      () => this.startRun(),
    );
  }

  private leave(why: string) {
    this.starting++;
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
    this.gone = true;
    removeEventListener('keydown', this.onEsc, { capture: true });
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
