// The app: screens (menu, lobby, night), the party room and who's the referee. The host's browser keeps the lobby
// (picks, settings) and, during a night, runs the Referee; every browser runs a NightSession (its own player, the
// house, everyone else). Solo ("walk the house alone") is the same night with nobody else in it.

import * as THREE from 'three';
import type { Party } from '../party.ts';
import type { GameApi } from '../types.ts';
import { CAST, type CharId } from './cast.ts';
import { Stand, nextSetting, renderLobby, renderMenu } from './lobby.ts';
import { readMsg, type Msg } from './net.ts';
import { NightSession } from './night.ts';
import { Referee } from './referee.ts';
import { DEFAULT_SETTINGS, MIN_PLAYERS, pickCharacter, settlePicks, type Settings } from './rules.ts';
import './royal.css';

const PICK_KEY = 'royal-degeneracy.pick';

export function mount(root: HTMLElement, api: GameApi): () => void {
  const app = new App(root, api);
  return () => app.destroy();
}

class App {
  private screen: 'menu' | 'lobby' | 'night' = 'menu';
  private party: Party | null = null;
  private offs: (() => void)[] = [];
  private note = '';
  private picks = new Map<number, CharId>();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private live = false;
  private preview: CharId = 'guest';
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private stand = new Stand();
  private session: NightSession | null = null;
  private referee: Referee | null = null;
  private raf = 0;
  private last = performance.now();
  private hostId = -1;

  constructor(
    private root: HTMLElement,
    private api: GameApi,
  ) {
    root.classList.add('royal-degeneracy');
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.className = 'rd-canvas';
    try {
      const saved = localStorage.getItem(PICK_KEY);
      if (saved && saved in CAST) this.preview = saved as CharId;
    } catch {
      /* private mode: no saved pick */
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __royal: App }).__royal = this; // console poking
  }

  private get me() {
    return this.party?.id ?? 0;
  }
  private get isHost() {
    return !this.party || this.party.isHost;
  }

  // -------------------------------------------------------------------------------------------
  // Screens

  private render() {
    this.api.setMenuNav(this.screen !== 'night');
    if (this.screen === 'menu')
      renderMenu(this.root, this.note, {
        host: () => void this.connect(null),
        join: (code) => void this.connect(code),
        solo: () => this.startSolo(),
        exit: () => this.api.exit(),
        list: () => this.api.party.list(),
      });
    else if (this.screen === 'lobby' && this.party) {
      const p = this.party;
      renderLobby(
        this.root,
        {
          code: p.code,
          members: p.members.map((m) => ({ id: m.id, name: m.name })),
          hostId: p.hostId,
          me: p.id,
          picks: this.picks,
          settings: this.settings,
          live: this.live,
          note: this.note,
          preview: this.preview,
        },
        this.renderer.domElement,
        this.renderer,
        {
          preview: (c) => {
            if (c === this.preview) return;
            this.preview = c;
            this.render();
          },
          pick: (c) => this.pick(c),
          setting: (k) => {
            this.settings = nextSetting(this.settings, k);
            this.broadcastLobby();
            this.render();
          },
          start: () => this.startNight(),
          leave: () => this.leaveRoom(''),
        },
      );
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    if (this.screen === 'lobby') {
      const holder = this.renderer.domElement.parentElement;
      if (!holder) return;
      const w = holder.clientWidth;
      const h = holder.clientHeight;
      if (w < 2 || h < 2) return;
      const c = this.renderer.domElement;
      if (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio())) this.renderer.setSize(w, h);
      this.stand.show(this.preview, this.myName());
      this.stand.render(this.renderer, dt, w, h);
    } else if (this.screen === 'night') {
      this.referee?.tick(dt);
      if (this.referee?.done) this.endNight('');
      this.session?.frame(dt);
    }
  };

  private myName() {
    return this.party?.members.find((m) => m.id === this.party!.id)?.name ?? this.api.name;
  }

  // -------------------------------------------------------------------------------------------
  // Rooms

  private async connect(code: string | null) {
    this.note = code ? `Knocking on ${code.trim().toUpperCase()}…` : 'Unlocking the front door…';
    this.render();
    let p: Party;
    try {
      p = code ? await this.api.party.join(code) : await this.api.party.host();
    } catch (e) {
      this.note = (e as Error).message || 'Could not connect';
      return this.render();
    }
    if (this.screen !== 'menu') return p.leave();
    this.party = p;
    this.hostId = p.hostId;
    this.picks = new Map();
    this.offs.push(
      p.onMembers(() => this.membersChanged()),
      p.onMessage((from, data) => {
        const m = readMsg(data);
        if (m) this.onMsg(from, m);
      }),
      p.onClose((why) => this.leaveRoom(why || 'Disconnected')),
    );
    this.screen = 'lobby';
    this.note = '';
    if (p.isHost) {
      this.pick(this.preview);
      this.broadcastLobby();
    } else p.send({ t: 'hi' } satisfies Msg, p.hostId);
    this.render();
  }

  private leaveRoom(why: string) {
    this.stopNight();
    this.offs.forEach((f) => f());
    this.offs = [];
    this.party?.leave();
    this.party = null;
    this.live = false;
    this.note = why;
    this.screen = 'menu';
    this.render();
  }

  private membersChanged() {
    const p = this.party!;
    const hostMoved = p.hostId !== this.hostId;
    this.hostId = p.hostId;
    const ids = p.members.map((m) => m.id);
    if (this.screen === 'night') {
      // The secrets left with the old host, so the night can't go on.
      if (hostMoved) return this.endNight('The host left, so the night’s off.');
      for (const id of [...this.picks.keys()]) if (!ids.includes(id)) this.referee?.left(id);
      this.session?.membersChanged(p.members);
    }
    if (p.isHost) {
      this.picks = settlePicks(this.picks, ids);
      for (const id of [...this.picks.keys()]) if (!ids.includes(id)) this.picks.delete(id);
      if (hostMoved && this.screen === 'lobby') p.setOpen(true);
      this.broadcastLobby();
    }
    if (this.screen === 'lobby') this.render();
  }

  // -------------------------------------------------------------------------------------------
  // The lobby (the host's copy is the real one)

  private pick(c: CharId) {
    try {
      localStorage.setItem(PICK_KEY, c);
    } catch {
      /* fine */
    }
    this.preview = c;
    if (!this.party) return;
    if (this.isHost) {
      if (pickCharacter(this.picks, this.me, c)) this.broadcastLobby();
      else this.note = `${CAST[c].tag} is taken.`;
      this.render();
    } else this.party.send({ t: 'pick', c } satisfies Msg, this.party.hostId);
  }

  private broadcastLobby() {
    if (!this.party?.isHost) return;
    this.party.send({ t: 'lobby', picks: [...this.picks], s: this.settings, live: this.live } satisfies Msg);
  }

  private onMsg(from: number, m: Msg) {
    const p = this.party!;
    const fromHost = from === p.hostId;
    // Requests to the referee.
    if (p.isHost) {
      if (m.t === 'hi') return p.send({ t: 'lobby', picks: [...this.picks], s: this.settings, live: this.live } satisfies Msg, from);
      if (m.t === 'pick') {
        if (this.screen === 'lobby' && pickCharacter(this.picks, from, m.c)) {
          this.broadcastLobby();
          this.render();
        }
        return;
      }
      if (this.referee) this.referee.handle(from, m);
    }
    if (m.t === 'lobby' && fromHost) {
      this.picks = new Map(m.picks);
      this.settings = m.s;
      const wasLive = this.live;
      this.live = m.live;
      if (this.screen === 'night' && wasLive && !m.live) {
        this.stopNight();
        return this.toLobby('');
      }
      if (this.screen === 'lobby') this.render();
      return;
    }
    if (m.t === 'go' && fromHost && this.screen === 'lobby') return this.openNight();
    if (m.t === 'end' && fromHost) return this.endNight(m.why);
    this.session?.handle(from, m);
  }

  // -------------------------------------------------------------------------------------------
  // Nights

  private startNight() {
    const p = this.party;
    if (!p?.isHost || this.live) return;
    if (p.members.length < MIN_PLAYERS && !import.meta.env.DEV) return;
    this.picks = settlePicks(this.picks, p.members.map((m) => m.id));
    this.live = true;
    p.setOpen(false);
    this.broadcastLobby();
    p.send({ t: 'go' } satisfies Msg);
    this.openNight();
  }

  private startSolo() {
    this.picks = new Map([[0, this.preview]]);
    this.openNight();
  }

  /** Everyone: build the house and step in. The host also starts the referee. */
  private openNight() {
    const members = this.party ? this.party.members : [{ id: 0, name: this.api.name, user: null }];
    const people = members.filter((m) => this.picks.has(m.id)).map((m) => ({ id: m.id, name: m.name, char: this.picks.get(m.id)! }));
    this.screen = 'night';
    this.root.innerHTML = '';
    this.render();
    const send = (m: Msg) => {
      if (this.isHost) this.referee?.handle(this.me, m);
      else this.party?.send(m, this.party.hostId);
    };
    this.session = new NightSession({
      root: this.root,
      renderer: this.renderer,
      api: this.api,
      me: this.me,
      people,
      toHost: send,
      toAll: (m) => this.party?.send(m),
      hosting: this.isHost,
      leave: () => (this.party ? this.leaveRoom('') : this.endNight('')),
    });
    if (this.isHost) {
      const out = (m: Msg, to?: number) => {
        if (to === undefined || to !== this.me) this.party?.send(m, to);
        if (to === undefined || to === this.me) this.session?.handle(this.me, m);
      };
      this.referee = new Referee(people, this.settings, (Math.random() * 2 ** 31) | 0, out);
      this.referee.begin();
    }
  }

  private stopNight() {
    this.session?.destroy();
    this.session = null;
    this.referee = null;
  }

  /** Back to the lobby after a night (or when it's called off). */
  private endNight(why: string) {
    const wasHost = !!this.referee;
    this.stopNight();
    if (!this.party) {
      this.screen = 'menu';
      this.note = why;
      return this.render();
    }
    if (wasHost || this.party.isHost) {
      this.live = false;
      this.party.setOpen(true);
      this.picks = settlePicks(this.picks, this.party.members.map((m) => m.id));
      this.broadcastLobby();
    }
    this.toLobby(why);
  }

  private toLobby(why: string) {
    this.screen = 'lobby';
    this.note = why;
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.stopNight();
    this.offs.forEach((f) => f());
    this.party?.leave();
    this.stand.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.classList.remove('royal-degeneracy');
    this.root.innerHTML = '';
  }
}
