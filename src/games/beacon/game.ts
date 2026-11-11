// The app: the menu (climb solo, host, join), the party lobby, and the climbs. The host numbers each climb and
// tells everyone (and anyone who joins late) to start it; after that every browser runs its own climber and
// shares where it is.

import * as THREE from 'three';
import { releaseRenderer } from '../../client/graphics.ts';
import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import { jacketOf } from './avatar.ts';
import { paintBanner } from './banner.ts';
import { buildCourse, type Course } from './course.ts';
import { readMsg } from './net.ts';
import { type Member, Session } from './session.ts';
import './beacon.css';

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
  private course: Course;
  private raf = 0;
  private last = performance.now();
  private offs: (() => void)[] = [];
  private note = '';
  /** The climb number in play (0: none yet). */
  private run = 0;
  private loading = false;

  constructor(
    private root: HTMLElement,
    private api: GameApi,
  ) {
    root.classList.add('beacon');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.domElement.className = 'bc-canvas';
    this.course = buildCourse();
    this.menu();
    this.raf = requestAnimationFrame(this.tick);
    if (import.meta.env.DEV) (window as unknown as { __beaconApp: App }).__beaconApp = this;
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session?.frame(dt, now);
    this.raf = requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------------------------------- screens

  private screen(...kids: HTMLElement[]) {
    this.api.setMenuNav(true);
    this.root.replaceChildren();
    const wrap = el('div', 'bc-menu');
    const art = el('canvas', 'bc-menu-art') as HTMLCanvasElement;
    paintBanner(art);
    wrap.append(art, ...kids);
    this.root.append(wrap);
    (wrap.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
  }

  private menu() {
    const card = el('div', 'bc-card');
    card.append(el('h1', 'bc-title', 'BEACON'));
    card.append(
      el(
        'p',
        'bc-blurb',
        'The light on Skerry has been dark for forty years. Climb the sea stack from the tide line to the lantern: jetties, ruined stairs, a rusted quarry gantry and the keeper’s tower. Run, slide, wall-run and climb. Fall, and the rock keeps what you lost.',
      ),
    );
    if (this.note) card.append(el('p', 'bc-note', this.note));
    const solo = el('button', 'bc-btn big', 'Climb solo');
    solo.dataset.autofocus = '';
    solo.onclick = () => this.solo();
    const host = el('button', 'bc-btn big', 'Host a climb (up to 12)');
    host.onclick = () => void this.connect(null);
    const row = el('div', 'bc-join');
    const code = el('input', 'bc-code') as HTMLInputElement;
    code.placeholder = 'CODE';
    code.maxLength = 4;
    code.autocapitalize = 'characters';
    const join = el('button', 'bc-btn', 'Join');
    join.onclick = () => code.value.trim() && void this.connect(code.value.trim().toUpperCase());
    code.onkeydown = (e) => e.key === 'Enter' && join.click();
    row.append(code, join);
    const rooms = el('div', 'bc-rooms');
    const back = el('button', 'bc-btn ghost', '← Back to the games');
    back.onclick = () => this.api.exit();
    card.append(solo, host, row, rooms, back);
    this.screen(card);
    void this.api.party
      .list()
      .then((list) => {
        if (!rooms.isConnected) return;
        for (const p of list.slice(0, 6)) {
          const b = el('button', 'bc-btn room', `Join ${p.host}’s climb (${p.code}) · ${p.players} on the rock`);
          b.onclick = () => void this.connect(p.code);
          rooms.append(b);
        }
      })
      .catch(() => {});
  }

  private lobby() {
    const p = this.party;
    if (!p) return this.menu();
    const card = el('div', 'bc-card');
    card.append(el('h1', 'bc-title small', 'THE TIDE LINE'));
    const code = el('p', 'bc-roomcode');
    code.append('Room code: ', el('b', '', p.code));
    card.append(code);
    card.append(el('p', 'bc-blurb', p.isHost ? 'Wait for your crew, then start. Anyone can join later and start from the bottom.' : 'Roped in. Waiting for the host to start the climb…'));
    const list = el('div', 'bc-crewlist');
    this.members().forEach((m) => {
      const row = el('div', 'bc-crewrow');
      const dot = el('span', 'dot');
      dot.style.background = jacketOf(m.seat);
      row.append(dot, el('span', '', `${m.name}${m.id === p.hostId ? ' (host)' : ''}${m.id === p.id ? ' — you' : ''}`));
      list.append(row);
    });
    card.append(list);
    if (p.isHost) {
      const start = el('button', 'bc-btn big', 'Start the climb');
      start.dataset.autofocus = '';
      start.onclick = () => this.hostStart();
      card.append(start);
    }
    const leave = el('button', 'bc-btn ghost', 'Leave');
    leave.onclick = () => this.leave('');
    card.append(leave);
    this.screen(card);
  }

  private members(): Member[] {
    const p = this.party;
    if (!p) return [{ id: 0, name: this.api.name || 'You', seat: 0 }];
    return p.members.map((m, i) => ({ id: m.id, name: m.name, seat: i }));
  }

  // ------------------------------------------------------------------------------------- parties

  private async connect(code: string | null) {
    try {
      const p = code ? await this.api.party.join(code) : await this.api.party.host();
      this.party = p;
      this.note = '';
      this.offs.push(
        p.onMessage((from, data) => this.onMessage(from, data)),
        p.onMembers(() => this.onMembers()),
        p.onClose((why) => this.leave(why || 'Lost the connection to the climb.')),
      );
      this.lobby();
      // A climb may already be under way: ask the host.
      if (!p.isHost) p.send({ t: 'hi' }, p.hostId);
    } catch (e) {
      this.note = code ? `Couldn’t join ${code}: ${(e as Error).message || 'no such climb'}` : 'Couldn’t start a room. Try again?';
      this.menu();
    }
  }

  private onMembers() {
    if (this.session) this.session.setCrew(this.members());
    else this.lobby();
  }

  private onMessage(from: number, data: unknown) {
    const m = readMsg(data);
    const p = this.party;
    if (!m || !p) return;
    if (m.t === 'hi') {
      if (p.isHost && this.run > 0) p.send({ t: 'go', n: this.run }, from);
      return;
    }
    if (m.t === 'go') {
      if (from !== p.hostId) return;
      this.begin(m.n);
      return;
    }
    this.session?.onMsg(from, m);
  }

  private hostStart() {
    const n = this.run + 1;
    this.party?.send({ t: 'go', n });
    this.begin(n);
  }

  private solo() {
    this.party = null;
    this.begin(this.run + 1);
  }

  /** Starts climb n (building the session the first time, behind a loading card). */
  private begin(n: number) {
    this.run = n;
    if (this.session) {
      this.session.start(n);
      return;
    }
    if (this.loading) return;
    this.loading = true;
    this.root.replaceChildren();
    const wait = el('div', 'bc-loading');
    wait.append(el('div', 'bc-title small', 'BEACON'), el('p', '', 'Rowing out to Skerry…'));
    this.root.append(wait);
    // Let the card paint before the textures and the stack are built.
    setTimeout(() => {
      this.loading = false;
      if (!this.root.isConnected || this.run !== n) return;
      wait.remove();
      const p = this.party;
      this.session = new Session(
        this.root,
        this.renderer,
        this.course,
        {
          me: p?.id ?? 0,
          solo: !p,
          isHost: () => !!p?.isHost,
          send: (m, to) => p?.send(m, to),
          restart: () => (p ? this.hostStart() : this.begin(this.run + 1)),
          leave: () => this.leave(''),
        },
        this.api,
        this.members(),
      );
      this.session.start(n);
    }, 60);
  }

  private leave(why: string) {
    this.session?.dispose();
    this.session = null;
    for (const f of this.offs) f();
    this.offs = [];
    this.party?.leave();
    this.party = null;
    this.run = 0;
    this.note = why;
    this.menu();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.session?.dispose();
    this.session = null;
    for (const f of this.offs) f();
    this.party?.leave();
    releaseRenderer(this.renderer);
    this.root.replaceChildren();
    this.root.classList.remove('beacon');
  }
}
