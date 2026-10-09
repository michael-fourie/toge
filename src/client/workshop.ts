import * as THREE from 'three';
import { type Colliders } from '../shared/colliders.ts';
import { rayWorld } from '../shared/collision.ts';
import { CONTRAPTIONS, CONTRAPTION_KINDS, type ContraptionKind, WORKSHOP, floorUnder, placeProblem } from '../shared/contraptions.ts';
import type { MapData } from '../shared/map.ts';
import type { Vec3 } from '../shared/math.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { ContraptionView, buildContraption, buildTinkerBench } from './contraptions.ts';
import { stash } from './inventoryStore.ts';
import { COIN_SVG } from './menu/lootui.ts';
import { sfx } from './sfx.ts';
import { IS_TOUCH } from './touch.ts';
import './workshop.css';

/** What the workshop needs from the game. */
export interface WorkshopHost {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  hudRoot: HTMLElement;
  map: MapData;
  selfId: number;
  cols(): Colliders;
  doors(): readonly boolean[];
  /** Where we look from and which way, and where our feet are. */
  eye(): Vec3;
  look(): Vec3;
  feet(): Vec3;
  /** Up and about (not dead or down). */
  able(): boolean;
  send(msg: ClientMsg): void;
  /** A banner, and the coin counter (with what was just gained). */
  toast(text: string, color: string): void;
  coins(total: number, gained?: number): void;
  /** Free the mouse for the menu / take it back to place. */
  unlock(): void;
  lock(): void;
  /** The menu closed without a pick: show the pause screen if the mouse is still free. */
  closed(): void;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/**
 * The Tinker's Workbench on the client: the bench model, the build menu (F at the bench), placement mode (a ghost that
 * follows your crosshair: click to build, right-click or Esc to cancel), coins (spent on placing, refunded if the server
 * says no), and the contraptions themselves (ContraptionView).
 */
export class Workshop {
  readonly view: ContraptionView;
  /** The kind being placed, if any. */
  placing: ContraptionKind | null = null;
  private menu: HTMLDivElement | null = null;
  private hint: HTMLDivElement;
  /** What we paid for and are waiting to see built. */
  private pending: ContraptionKind | null = null;
  private spot: Vec3 | null = null;
  private why: string | null = null;
  private yaw = 0;
  private bench: THREE.Group;
  private keyHandler = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && this.menu) this.closeMenu(false);
  };

  constructor(private host: WorkshopHost) {
    this.view = new ContraptionView(host.scene);
    const t = host.map.survival!.tinker;
    this.bench = buildTinkerBench(host.renderer);
    this.bench.position.set(t.pos.x, t.pos.y, t.pos.z);
    this.bench.rotation.y = t.yaw;
    host.scene.add(this.bench);
    this.hint = document.createElement('div');
    this.hint.className = 'place-hint';
    this.hint.hidden = true;
    host.hudRoot.append(this.hint);
    this.view.onFx = (fx, at) => {
      const p = host.feet();
      const v = Math.max(0, 1 - Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) / 40);
      if (v <= 0) return;
      if (fx === 'tacks') sfx.tacks(v);
      else if (fx === 'goo') sfx.goo(v);
      else if (fx === 'bomb') sfx.lob(v);
      else if (fx === 'zap') sfx.zap(v);
      else if (fx === 'owl') sfx.hoot(v);
      else if (fx === 'boom') sfx.boom(40 * (1 - v));
    };
    addEventListener('keydown', this.keyHandler);
  }

  get menuOpen() {
    return !!this.menu;
  }

  /** For findUse: F on your own contraption scraps it. */
  forUse() {
    return this.view.list.map((c) => ({ id: c.id, k: c.k, pos: { x: c.p[0], y: c.p[1], z: c.p[2] }, owner: c.owner }));
  }

  onNet(msg: ServerMsg) {
    if (msg.t === 'contraptions') {
      const had = new Set(this.view.list.map((c) => c.id));
      this.view.sync(msg.list, msg.piles);
      const mine = msg.list.find((c) => !had.has(c.id) && c.owner === this.host.selfId && c.k === this.pending);
      if (mine) {
        this.pending = null;
        this.host.toast(`${CONTRAPTIONS[mine.k].name.toUpperCase()} BUILT!`, hex(CONTRAPTIONS[mine.k].color));
        sfx.build();
      }
    } else if (msg.t === 'cfx') this.view.fx(msg.id, msg.fx, msg.p, msg.n);
    else if (msg.t === 'refund') {
      const n = Math.floor(CONTRAPTIONS[msg.k].price * msg.share);
      if (msg.k === this.pending) this.pending = null;
      stash.earn(n);
      this.host.coins(stash.inv.coins, n);
      this.host.toast(msg.share < 1 ? `${msg.why}: +${n} coins` : `${msg.why} · ${n} coins back`, msg.share < 1 ? '#ffd98a' : '#ff9a7a');
      if (msg.share >= 1) sfx.denied();
    }
  }

  // --- The menu --------------------------------------------------------------------------------------------

  openMenu() {
    if (this.menu || !this.host.able()) return;
    this.cancel();
    this.menu = document.createElement('div');
    this.menu.className = 'workshop';
    this.host.hudRoot.append(this.menu);
    this.renderMenu();
    this.host.unlock();
    sfx.part();
  }

  private renderMenu() {
    const m = this.menu!;
    const coins = stash.inv.coins;
    const mine = this.view.list.filter((c) => c.owner === this.host.selfId).length;
    const cards = CONTRAPTION_KINDS.map((k) => {
      const d = CONTRAPTIONS[k];
      const poor = coins < d.price;
      return `<button class="wb-card${poor ? ' poor' : ''}" data-k="${k}" style="--accent:${hex(d.color)}">
        <img alt="" src="${this.icon(k)}">
        <b>${d.name}</b>
        <span>${d.blurb}</span>
        <em>${COIN_SVG}${d.price}</em>
      </button>`;
    }).join('');
    m.innerHTML = `<div class="wb-panel">
      <header><h2>Tinker's Workbench</h2><p>Build a contraption, then place it anywhere in the rooms you've opened. They fight zombies for you.</p>
      <div class="wb-coins">${COIN_SVG}<b>${coins}</b><small>${mine}/${WORKSHOP.perPlayer} built</small></div>
      <button class="wb-close" aria-label="Close">✕</button></header>
      <div class="wb-grid">${cards}</div>
      <footer>Coins, not points. Press F on one of yours to scrap it for half. Esc closes.</footer>
    </div>`;
    m.querySelector('.wb-close')!.addEventListener('click', () => this.closeMenu(false));
    m.addEventListener('click', (e) => {
      if (e.target === m) this.closeMenu(false);
    });
    for (const b of m.querySelectorAll<HTMLButtonElement>('.wb-card')) {
      b.addEventListener('click', () => {
        const k = b.dataset.k as ContraptionKind;
        if (stash.inv.coins < CONTRAPTIONS[k].price) {
          sfx.denied();
          b.classList.remove('shake');
          void b.offsetWidth;
          b.classList.add('shake');
          return;
        }
        this.closeMenu(true);
        this.placing = k;
        this.host.lock();
      });
    }
  }

  closeMenu(chose: boolean) {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    if (!chose) this.host.closed();
  }

  /** Each contraption rendered once to a picture for its card (one small offscreen renderer, like the item icons). */
  private icon(k: ContraptionKind): string {
    const hit = icons.get(k);
    if (hit) return hit;
    const r = (iconRenderer ??= new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true }));
    r.setSize(192, 192, false);
    r.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sun.position.set(2, 4, 3);
    scene.add(new THREE.HemisphereLight(0xfff4dc, 0x9fb7d8, 2), sun, buildContraption(k));
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    cam.position.set(1.7, 1.75, 2.4);
    cam.lookAt(0, 0.62, 0);
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    icons.set(k, url);
    return url;
  }

  // --- Placing ---------------------------------------------------------------------------------------------

  /** Called with this frame's fire press and right button while placing: click builds, right-click cancels. */
  steer(fire: boolean, cancel: boolean) {
    if (!this.placing) return;
    if (cancel) return this.cancel();
    if (!fire) return;
    if (!this.spot || this.why) {
      sfx.denied();
      return;
    }
    const k = this.placing;
    if (!stash.wager(CONTRAPTIONS[k].price)) {
      this.host.toast('Not enough coins', '#ff9a7a');
      sfx.denied();
      return this.cancel();
    }
    this.host.coins(stash.inv.coins);
    const p = this.spot;
    this.host.send({ t: 'build', k, p: [round(p.x), round(p.y), round(p.z)], yaw: Math.round(this.yaw * 100) / 100 });
    this.pending = k;
    this.cancel();
  }

  cancel() {
    this.placing = null;
    this.spot = null;
    this.view.setGhost(null);
    this.hint.hidden = true;
  }

  update(time: number, dt: number) {
    this.view.update(time, dt);
    this.bench.traverse((o) => o.name === 'cog' && (o.rotation.z += dt * 0.8));
    if (!this.placing) return;
    if (!this.host.able()) return this.cancel();
    this.aim();
    const d = CONTRAPTIONS[this.placing];
    this.hint.hidden = false;
    const [build, cancel] = IS_TOUCH ? ['FIRE', 'SCOPE'] : ['Click', 'Right-click'];
    this.hint.innerHTML = `<b style="color:${hex(d.color)}">${d.name}</b> ${this.why ? `<i>${this.why}</i>` : `<span><kbd>${build}</kbd> build ${COIN_SVG}${d.price}</span>`} <span><kbd>${cancel}</kbd> cancel</span>`;
  }

  /** Where the crosshair lands: the flat top it's on, in reach, and whether a contraption may stand there. */
  private aim() {
    const o = this.host.eye();
    const d = this.host.look();
    const cols = this.host.cols();
    const max = WORKSHOP.reach + 3;
    const t = rayWorld(o, d, cols.move, max);
    const hit = { x: o.x + d.x * (t - 0.04), y: o.y + d.y * (t - 0.04), z: o.z + d.z * (t - 0.04) };
    const feet = this.host.feet();
    const spot = t < max ? floorUnder(hit, cols.move) : null;
    this.spot = spot;
    if (!spot) this.why = 'Aim at the floor';
    else if (Math.hypot(spot.x - feet.x, spot.y - feet.y, spot.z - feet.z) > WORKSHOP.reach) this.why = 'Too far away';
    else this.why = placeProblem(spot, { map: this.host.map, boxes: cols.move, doorsOpen: this.host.doors(), others: this.forUse() });
    // Face us, so you see its front as you put it down.
    const at = spot ?? hit;
    this.yaw = Math.atan2(feet.x - at.x, feet.z - at.z);
    this.view.setGhost(this.placing, new THREE.Vector3(at.x, at.y, at.z), this.yaw, !this.why);
  }

  dispose() {
    removeEventListener('keydown', this.keyHandler);
    this.closeMenu(true);
    this.hint.remove();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
let iconRenderer: THREE.WebGLRenderer | undefined;
const icons = new Map<ContraptionKind, string>();
