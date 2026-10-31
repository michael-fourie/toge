// The front door and the living room before a night: the menu (host / join / open houses / walk alone), and the
// lobby (the roster, character cards with the turning stand, the host's settings). Plain DOM, names only ever
// through textContent.

import * as THREE from 'three';
import { CAST, CHAR_IDS, STAT_NAMES, eyeHeight, lookFor, type CharId } from './cast.ts';
import { CASES } from './cases.ts';
import { POWERS, powerOf } from './abilities.ts';
import { CATS, label, valueOf } from './clues.ts';
import { Person } from './people.ts';
import { loadStats, statsLine } from './stats.ts';
import { paintHouse } from './housefront.ts';
import { CHOICES, MIN_PLAYERS, degeneratesFor, type Settings } from './rules.ts';

// ---------------------------------------------------------------------------------------------
// Portraits: each character's head, rendered once into a data URL (cards, roster, the vote grid)

const portraitCache = new Map<string, string>();

export function portrait(renderer: THREE.WebGLRenderer, id: CharId, name = ''): string {
  const key = id === 'guest' ? `guest:${name}` : id;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const S = 128;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x553355, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, -3);
  scene.add(sun);
  const p = new Person(lookFor(id, name), CAST[id].height);
  p.pose({ speed: 0, crouch: false, pitch: 0 }, 0);
  scene.add(p.root);
  const head = (CAST[id].height / 100) * (1.6 / 1.8);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  cam.position.set(0.25, head + 0.05, -1.05);
  cam.lookAt(0, head - 0.02, 0);
  const target = new THREE.WebGLRenderTarget(S, S, { colorSpace: THREE.SRGBColorSpace });
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(S * S * 4);
  renderer.readRenderTargetPixels(target, 0, 0, S, S, px);
  renderer.setRenderTarget(null);
  target.dispose();
  p.dispose();
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const img = c.getContext('2d')!.createImageData(S, S);
  for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
  c.getContext('2d')!.putImageData(img, 0, 0);
  const url = c.toDataURL();
  portraitCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------------------------
// The turning stand

export class Stand {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  private person: Person | null = null;
  private shown = '';
  private turn = 0;

  constructor() {
    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xffe7d1, 0x40204a, 1.6));
    const key = new THREE.SpotLight(0xffd8a8, 40, 12, 0.6, 0.5);
    key.position.set(1.5, 4, -2.5);
    this.scene.add(key, key.target);
    const party = new THREE.PointLight(0xff3d8a, 8, 6);
    party.position.set(-1.6, 1.4, 1.2);
    this.scene.add(party);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.14, 40),
      new THREE.MeshToonMaterial({ color: 0x3a2a4a }),
    );
    base.position.y = -0.07;
    this.scene.add(base);
  }

  show(id: CharId, name: string) {
    const key = `${id}:${name}`;
    if (key === this.shown) return;
    this.shown = key;
    if (this.person) {
      this.scene.remove(this.person.root);
      this.person.dispose();
    }
    this.person = new Person(lookFor(id, name), CAST[id].height);
    this.person.setFace('smile');
    this.scene.add(this.person.root);
  }

  render(renderer: THREE.WebGLRenderer, dt: number, w: number, h: number) {
    if (!this.person) return;
    this.turn += dt * 0.7;
    this.person.root.rotation.y = this.turn;
    this.person.pose({ speed: 0, crouch: false, pitch: Math.sin(this.turn * 0.8) * 0.15 }, dt);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Frame everyone the same, so height differences show: Wags towers, Will looks up.
    this.camera.position.set(0, 1.2, -4.6);
    this.camera.lookAt(0, 0.95, 0);
    renderer.setClearColor(0x000000, 0);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.person?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The menu

export interface MenuHandlers {
  host(): void;
  join(code: string): void;
  solo(): void;
  exit(): void;
  list(): Promise<{ code: string; host: string; players: number; max: number }[]>;
}

export function renderMenu(root: HTMLElement, note: string, h: MenuHandlers) {
  root.innerHTML = `
    <canvas class="rd-backdrop" aria-hidden="true"></canvas>
    <div class="rd-screen rd-menu">
      <p class="rd-kicker">282 · a whodunit in the old house</p>
      <h1 class="rd-logo">ROYAL<br><span>DEGENERACY</span></h1>
      <p class="rd-lede">Chores, house meetings and a bin bag in the rain. One of you did this.</p>
      <p class="rd-note" data-stats></p>
      <div class="rd-col">
        <button class="rd-btn hot" data-host data-autofocus>Host a night</button>
        <div class="rd-join">
          <input data-code maxlength="4" placeholder="CODE" aria-label="House code" autocomplete="off" spellcheck="false" />
          <button class="rd-btn" data-join>Join</button>
        </div>
        <button class="rd-btn" data-solo>Walk the house alone</button>
      </div>
      <ul class="rd-rooms" data-list></ul>
      <p class="rd-note" data-note></p>
      <button class="rd-btn ghost" data-exit>◀ Menu</button>
    </div>`;
  // The house at night behind it all, windows flicking on and off.
  paintHouse(root.querySelector<HTMLCanvasElement>('.rd-backdrop')!, false);
  root.querySelector('[data-note]')!.textContent = note;
  root.querySelector('[data-stats]')!.textContent = statsLine(loadStats());
  const code = root.querySelector<HTMLInputElement>('[data-code]')!;
  const join = () => code.value.trim() && h.join(code.value.trim());
  code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  root.querySelector('[data-join]')!.addEventListener('click', join);
  root.querySelector('[data-host]')!.addEventListener('click', () => h.host());
  root.querySelector('[data-solo]')!.addEventListener('click', () => h.solo());
  root.querySelector('[data-exit]')!.addEventListener('click', () => h.exit());
  void h.list().then(
    (rooms) => {
      const ul = root.querySelector('[data-list]');
      if (!ul) return;
      for (const r of rooms) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.className = 'rd-btn small';
        b.textContent = `Join ${r.host}’s house · ${r.players}/${r.max}`;
        b.addEventListener('click', () => h.join(r.code));
        li.append(b);
        ul.append(li);
      }
    },
    () => {},
  );
}

// ---------------------------------------------------------------------------------------------
// The lobby

export interface LobbyView {
  code: string;
  members: { id: number; name: string }[];
  hostId: number;
  me: number;
  picks: ReadonlyMap<number, CharId>;
  settings: Settings;
  /** A night is on (late joiners wait for the next one). */
  live: boolean;
  note: string;
  /** The card on show (your pick, or what you're looking at). */
  preview: CharId;
}

export interface LobbyHandlers {
  preview(c: CharId): void;
  pick(c: CharId): void;
  setting<K extends keyof Settings>(key: K): void;
  start(): void;
  leave(): void;
}

const SETTING_ROWS: [keyof Settings, string][] = [
  ['caseId', 'Case'],
  ['degenerates', 'Degenerates'],
  ['nightMin', 'Night length'],
  ['killCd', 'Takeout cooldown'],
  ['discuss', 'Discussion'],
  ['vote', 'Voting'],
  ['reveal', 'Reveal on eviction'],
  ['anon', 'Anonymous votes'],
  ['cosy', 'Cosy mode (no takeouts)'],
];

function settingText(s: Settings, k: keyof Settings, players: number): string {
  switch (k) {
    case 'caseId':
      return s.caseId === 'random' ? 'Random' : (CASES.find((c) => c.id === s.caseId)?.title ?? '?');
    case 'degenerates':
      return s.degenerates ? String(s.degenerates) : `Auto (${degeneratesFor(Math.max(players, MIN_PLAYERS), 0)})`;
    case 'nightMin':
      return `${s.nightMin} min`;
    case 'reveal':
    case 'anon':
    case 'cosy':
      return s[k] ? 'On' : 'Off';
    default:
      return `${s[k]} s`;
  }
}

/** The next value of a setting (the lobby's buttons cycle). */
export function nextSetting<K extends keyof Settings>(s: Settings, k: K): Settings {
  const out = { ...s };
  if (k === 'caseId') {
    const ids = ['random', ...CASES.map((c) => c.id)];
    out.caseId = ids[(ids.indexOf(s.caseId) + 1) % ids.length];
  } else if (k === 'reveal' || k === 'anon' || k === 'cosy') out[k as 'reveal' | 'anon' | 'cosy'] = !s[k as 'reveal' | 'anon' | 'cosy'];
  else {
    const list = CHOICES[k as keyof typeof CHOICES] as readonly number[];
    (out[k] as number) = list[(list.indexOf(s[k] as number) + 1) % list.length];
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 10)}%`;

/** Draws the lobby; the stand's canvas is moved into place (it outlives re-renders). */
export function renderLobby(root: HTMLElement, v: LobbyView, standCanvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, h: LobbyHandlers) {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
  const isHost = v.me === v.hostId;
  const mine = v.picks.get(v.me);
  const c = CAST[v.preview];
  const ownerOf = (id: CharId) => [...v.picks].find(([, x]) => x === id)?.[0];
  root.innerHTML = `
    <div class="rd-screen rd-lobby">
      <header class="rd-top">
        <h1 class="rd-logo small">ROYAL <span>DEGENERACY</span></h1>
        <p class="rd-codebox">House code <b data-code></b></p>
        <button class="rd-btn ghost small" data-k="leave">Leave</button>
      </header>
      <div class="rd-main">
        <section class="rd-panel rd-side">
          <h2>In the house <small data-count></small></h2>
          <ul class="rd-roster" data-roster></ul>
          <h2>Tonight</h2>
          <div class="rd-settings" data-settings></div>
        </section>
        <section class="rd-stand" data-stand>
          <div class="rd-standtag"><b data-tag></b><span data-height></span></div>
        </section>
        <section class="rd-panel rd-card">
          <p class="rd-kicker" data-studies></p>
          <h2 class="rd-cardname" data-name></h2>
          <p class="rd-blurb" data-blurb></p>
          <div class="rd-stats" data-stats></div>
          <div class="rd-traits" data-traits></div>
          <div class="rd-power"><b>Ability · <span data-ab></span></b><p data-abt></p></div>
          <div class="rd-power"><b>Quirk · <span data-q></span></b><p data-qt></p></div>
          <p class="rd-quote" data-quote></p>
          <button class="rd-btn hot" data-k="pickme"></button>
        </section>
      </div>
      <div class="rd-strip" data-strip></div>
      <footer class="rd-foot">
        <p class="rd-note" data-note></p>
        ${isHost ? '<button class="rd-btn hot big" data-k="start">Start the night</button>' : '<p class="rd-wait" data-wait></p>'}
      </footer>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  $('[data-code]').textContent = v.code;
  $('[data-count]').textContent = `${v.members.length}/12`;
  $('[data-stand]').prepend(standCanvas);
  $('[data-tag]').textContent = v.preview === 'guest' ? 'Guest' : c.tag;
  $('[data-height]').textContent = ` · ${c.height} cm · eyes at ${eyeHeight(v.preview).toFixed(2)} m`;
  $('[data-studies]').textContent = c.studies;
  $('[data-name]').textContent = c.tag;
  $('[data-blurb]').textContent = c.blurb;
  // Guests get an ability from the guest pool, by name.
  const myName = v.members.find((m) => m.id === v.me)?.name ?? '';
  const pw = v.preview === 'guest' ? POWERS[powerOf('guest', myName)] : null;
  $('[data-ab]').textContent = pw ? pw.name : c.ability.name;
  $('[data-abt]').textContent = pw ? pw.text.replace(/^Q( at a clue)?: /, '') : c.ability.text;
  // The trait card: what clues about this person look like.
  const traits = $('[data-traits]');
  for (const cat of CATS) {
    if (cat === 'belonging') continue;
    const chip = document.createElement('span');
    chip.textContent = label(cat, valueOf({ char: v.preview, name: myName }, cat));
    traits.append(chip);
  }
  $('[data-q]').textContent = c.quirk.name;
  $('[data-qt]').textContent = c.quirk.text;
  $('[data-quote]').textContent = `“${c.catchphrase}”`;
  const stats = $('[data-stats]');
  for (const k of STAT_NAMES) {
    const row = document.createElement('div');
    row.className = 'rd-stat';
    row.innerHTML = `<span></span><i><em style="width:${pct(c.stats[k])}"></em></i><b></b>`;
    row.querySelector('span')!.textContent = k;
    row.querySelector('b')!.textContent = String(c.stats[k]);
    stats.append(row);
  }
  // Pick button: yours, taken, or free.
  const pickBtn = $<HTMLButtonElement>('[data-k="pickme"]');
  const owner = ownerOf(v.preview);
  if (v.preview !== 'guest' && owner !== undefined && owner !== v.me) {
    pickBtn.disabled = true;
    pickBtn.textContent = `Taken by ${v.members.find((m) => m.id === owner)?.name ?? '?'}`;
  } else if (mine === v.preview) {
    pickBtn.disabled = true;
    pickBtn.textContent = 'You’re playing this one';
  } else pickBtn.textContent = v.preview === 'guest' ? 'Come as yourself (guest)' : `Play as ${c.tag}`;
  pickBtn.addEventListener('click', () => h.pick(v.preview));

  const roster = $('[data-roster]');
  for (const m of v.members) {
    const li = document.createElement('li');
    const pick = v.picks.get(m.id);
    if (pick) {
      const img = document.createElement('img');
      img.src = portrait(renderer, pick, m.name);
      img.alt = '';
      li.append(img);
    }
    const name = document.createElement('span');
    name.textContent = m.name + (m.id === v.hostId ? ' ★' : '') + (m.id === v.me ? ' (you)' : '');
    const as = document.createElement('small');
    as.textContent = pick ? (pick === 'guest' ? 'guest' : `as ${CAST[pick].tag}`) : 'choosing…';
    li.append(name, as);
    if (m.id === v.me) li.className = 'me';
    roster.append(li);
  }

  const settings = $('[data-settings]');
  for (const [k, label] of SETTING_ROWS) {
    const el = document.createElement(isHost ? 'button' : 'div');
    el.className = 'rd-setting';
    el.innerHTML = '<span></span><b></b>';
    el.querySelector('span')!.textContent = label;
    el.querySelector('b')!.textContent = settingText(v.settings, k, v.members.length);
    if (isHost) {
      el.dataset.k = `set-${k}`;
      el.addEventListener('click', () => h.setting(k));
    }
    settings.append(el);
  }

  const strip = $('[data-strip]');
  for (const id of CHAR_IDS) {
    const b = document.createElement('button');
    b.className = 'rd-pick';
    b.dataset.k = `pick-${id}`;
    const who = ownerOf(id);
    if (id === mine) b.classList.add('mine');
    else if (id !== 'guest' && who !== undefined) b.classList.add('taken');
    if (id === v.preview) b.classList.add('on');
    const img = document.createElement('img');
    img.src = portrait(renderer, id, id === 'guest' ? (v.members.find((m) => m.id === v.me)?.name ?? '') : '');
    img.alt = '';
    const tag = document.createElement('span');
    tag.textContent = id === 'guest' ? 'Guest' : CAST[id].tag;
    b.append(img, tag);
    if (id !== 'guest' && who !== undefined && who !== v.me) {
      const by = document.createElement('small');
      by.textContent = v.members.find((m) => m.id === who)?.name ?? '';
      b.append(by);
    }
    b.addEventListener('click', () => h.preview(id));
    b.addEventListener('focus', () => h.preview(id));
    strip.append(b);
  }

  $('[data-note]').textContent = v.note;
  if (isHost) {
    const start = $<HTMLButtonElement>('[data-k="start"]');
    const few = v.members.length < MIN_PLAYERS && !import.meta.env.DEV;
    start.disabled = few || v.live;
    if (few) start.textContent = `Need ${MIN_PLAYERS} to start (${v.members.length})`;
    start.addEventListener('click', () => h.start());
  } else $('[data-wait]').textContent = v.live ? 'A night is on. You’re in the next one.' : 'Waiting for the host to start the night…';
  $('[data-k="leave"]').addEventListener('click', () => h.leave());

  const again = focusKey ? root.querySelector<HTMLElement>(`[data-k="${focusKey}"]`) : null;
  (again ?? root.querySelector<HTMLElement>(`[data-k="pick-${v.preview}"]`))?.focus({ preventScroll: true });
}
