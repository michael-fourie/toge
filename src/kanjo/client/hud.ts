// The race HUD (DOM + two small canvases): position and timer, the live leaderboard (top left), name tags
// over the other cars, a vertical "descent" strip with every racer's progress, a heading-up minimap, the tachometer with gear and speed, assist lights, the countdown,
// the drift combo and score, banners, and the pause and results panels (gamepad-navigable: they're nav scopes).

import { PAINTS, decodeCar, CARS } from '../shared/cars.ts';
import { TRACK_DEFS, type Track } from '../shared/track.ts';
import { CUPS, roundsOf, teamTable, type CupId, type CupRow } from '../shared/cups.ts';
import { TEAMS } from '../shared/protocol.ts';
import type { Damage, Zone } from '../shared/damage.ts';
import type { NewBest } from '../shared/records.ts';
import { esc } from '../../client/menu/ui.ts';
import { KEY_HELP, PAD_HELP } from './input.ts';
import './race.css';

export interface Dot {
  s: number;
  me: boolean;
  color: string;
  x: number;
  z: number;
}

/** A row of the leaderboard, in race order. */
export interface BoardLine {
  name: string;
  color: string;
  me: boolean;
  /** Finish time (s), or null while still racing. */
  finished: number | null;
}

/** A name tag over a car: where it lands on screen (px), how opaque, or null when it's off screen or hidden. */
export interface Tag {
  id: number | string;
  name: string;
  color: string;
  /** The place shown before the name ('TR': the track record's ghost). */
  place: number | string;
  at: { x: number; y: number; alpha: number } | null;
}

export interface HudState {
  speed: number; // m/s
  rpm: number;
  redline: number;
  gear: number;
  shifting: boolean;
  place: number;
  field: number;
  time: number;
  /** The lap you're on, out of `laps` (0 on a point-to-point road). */
  lap: number;
  laps: number;
  abs: boolean;
  tcs: boolean;
  wrongWay: boolean;
  manual: boolean;
  /** Drift spark level (0-3), or -1 when not drifting. */
  drift: number;
  /** The live drift combo (points as they'd bank, and the multiplier), or null between combos. */
  combo: { points: number; mult: number } | null;
  /** Drift points banked this race. */
  driftTotal: number;
  boost: boolean;
  /** Slipstream: how deep in a wake you are (0-1), the slingshot's charge (0-1, 1 = ready) and whether it just fired. */
  draft: number;
  charge: number;
  sling: boolean;
  heading: number; // yaw
  /** Physics mode: your car's damage (null when the mode is off). */
  damage: Damage | null;
  dots: Dot[];
  board: BoardLine[];
  /** Free roam: the road you're on (the top bar shows it in place of the place and clock). */
  where?: string;
  /** A battle royale: cars left in, and whether you're last (out at the line if nothing changes). */
  royale?: { left: number; danger: boolean };
}

export interface ResultLine {
  place: number;
  name: string;
  car: string;
  time: number | null;
  /** Quickest lap (circuits), when known. */
  best?: number | null;
  /** A battle royale: the lap this racer was knocked out on. */
  out?: number;
  prize: number;
  me: boolean;
  /** A CPU racer in an online lobby. */
  cpu?: boolean;
  /** Drift points, and the money drifting added to `prize`, when known. */
  drift?: number;
  bonus?: { drift: number };
  /** This finish was the racer's new best on the track (known for you, and for signed-in rivals online). */
  newBest?: NewBest | null;
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
/** Drift points with thousands commas. */
const pts = (n: number) => Math.round(n).toLocaleString('en-US');

export class RaceHud {
  readonly root: HTMLElement;
  private tach: HTMLCanvasElement;
  private map: HTMLCanvasElement;
  private el: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
  private comboTimer = 0;
  /** The combo readout is showing a banked or lost combo (it holds a moment before the next live one). */
  private comboHold = false;
  private boardHtml = '';
  private tagEls = new Map<Tag['id'], HTMLElement>();

  constructor(
    container: HTMLElement,
    private track: Track,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'rh';
    this.root.innerHTML = `
      <div class="rh-top">
        <div class="rh-pos"><b data-el="place">–</b><small data-el="field"></small></div>
        <div class="rh-time" data-el="time">0:00.000</div>
        <div class="rh-lap" data-el="lap" hidden></div>
        <div class="rh-score" data-el="score" hidden><small>Drift</small><b data-el="scoreNum">0</b></div>
        <div class="rh-where" data-el="where"></div>
      </div>
      <ol class="rh-board" data-el="board" aria-label="Standings"></ol>
      <div class="rh-tags" data-el="tags" aria-hidden="true"></div>
      <div class="rh-strip" aria-hidden="true"><i class="flag top"></i><div class="rh-strip-track" data-el="strip"></div><i class="flag bottom"></i></div>
      <canvas class="rh-map" width="220" height="220" aria-hidden="true"></canvas>
      <div class="rh-dash">
        <canvas class="rh-tach" width="260" height="260" aria-hidden="true"></canvas>
        <div class="rh-readout"><b data-el="speed">0</b><small>km/h</small></div>
        <div class="rh-gear" data-el="gear">N</div>
        <div class="rh-assists"><span data-el="abs">ABS</span><span data-el="tcs">TCS</span><span data-el="mt">MT</span></div>
        <div class="rh-damage" data-el="damage" hidden aria-label="Car damage">
          <svg viewBox="0 0 40 70" aria-hidden="true">
            <rect class="shell" x="6" y="4" width="28" height="62" rx="9" />
            <rect data-zone="front" x="9" y="6" width="22" height="13" rx="6" />
            <rect data-zone="rear" x="9" y="51" width="22" height="13" rx="6" />
            <rect data-zone="left" x="8" y="21" width="5" height="28" rx="2.5" />
            <rect data-zone="right" x="27" y="21" width="5" height="28" rx="2.5" />
            <rect class="cabin" x="15" y="24" width="10" height="22" rx="3" />
          </svg>
          <b data-el="health">100%</b>
        </div>
      </div>
      <div class="rh-wind" data-el="wind" aria-hidden="true"></div>
      <div class="rh-near" data-el="near" aria-live="off"><span>Near miss</span><b data-el="nearNum"></b></div>
      <div class="rh-combo" data-el="combo" aria-live="off"><b data-el="comboNum"></b><span data-el="comboMult"></span></div>
      <div class="rh-drift" data-el="drift"></div>
      <div class="rh-center" data-el="center"></div>
      <div class="rh-banner" data-el="banner"></div>
      <div class="rh-watch" data-el="watch"></div>
      <div class="rh-help" data-el="help"></div>
      <div class="rh-panel" data-el="panel" hidden></div>`;
    container.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.el[e.dataset.el!] = e));
    this.tach = this.root.querySelector('.rh-tach')!;
    this.map = this.root.querySelector('.rh-map')!;
    // Free roam: no place, clock, board or progress strip; the road you're on instead, and the whole map.
    this.root.classList.toggle('roam', !!track.world);
  }

  private nearTimer = 0;

  /** Threading through traffic: "NEAR MISS", with the chain count from the second one on. */
  nearMiss(chain: number) {
    const e = this.el.near;
    this.el.nearNum.textContent = chain > 1 ? `×${chain}` : '';
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('pop', 'on');
    clearTimeout(this.nearTimer);
    this.nearTimer = window.setTimeout(() => e.classList.remove('on', 'pop'), 1100);
  }

  showHelp(pad: boolean) {
    const rows = (pad ? PAD_HELP : KEY_HELP).map(([k, v]) => `<li><kbd>${esc(k)}</kbd>${esc(v)}</li>`).join('');
    this.el.help.innerHTML = `<ul>${rows}</ul>`;
    this.el.help.classList.add('on');
    clearTimeout(this.helpTimer);
    this.helpTimer = window.setTimeout(() => this.el.help.classList.remove('on'), 7000);
  }
  private helpTimer = 0;

  countdown(text: string | null) {
    this.el.center.textContent = text ?? '';
    this.el.center.classList.toggle('go', text === 'GO!');
    if (text) {
      this.el.center.classList.remove('pop');
      void this.el.center.offsetWidth;
      this.el.center.classList.add('pop');
    }
  }

  banner(text: string, sub = '', ms = 2500) {
    this.el.banner.innerHTML = `<b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.el.banner.classList.add('on');
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => this.el.banner.classList.remove('on'), ms);
  }

  /** A drift combo banked: flash its points and bump the total. */
  driftBanked(points: number, total: number) {
    this.flashCombo(`+${pts(points)}`, 'banked', 'bank');
    this.el.scoreNum.textContent = pts(total);
  }

  /** A combo lost to a crash or a spin. */
  driftLost(points: number) {
    this.flashCombo(pts(points), 'lost', 'lost');
  }

  private flashCombo(num: string, label: string, state: string) {
    const c = this.el.combo;
    this.el.comboNum.textContent = num;
    this.el.comboMult.textContent = label;
    c.dataset.state = state;
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop', 'on');
    this.comboHold = true;
    clearTimeout(this.comboTimer);
    this.comboTimer = window.setTimeout(() => {
      this.comboHold = false;
      c.classList.remove('on', 'pop');
    }, 1300);
  }

  /** The spectating line after you finish online: who's being followed and the key for the next. Empty hides it. */
  watching(who: string, hint: string) {
    this.el.watch.innerHTML = `${who ? `<b>${esc(who)}</b>` : ''}${hint ? `<small>${esc(hint)}</small>` : ''}`;
    this.el.watch.classList.toggle('on', !!(who || hint));
  }

  update(h: HudState) {
    this.el.place.textContent = h.place ? ordinal(h.place) : '–';
    this.el.field.textContent = `/ ${h.field}`;
    this.el.time.textContent = fmtTime(Math.max(0, h.time));
    this.el.lap.hidden = !h.laps;
    if (h.laps) this.el.lap.textContent = h.royale ? `Lap ${h.lap} · ${h.royale.left} left` : `Lap ${h.lap}/${h.laps}`;
    this.root.classList.toggle('danger', !!h.royale?.danger);
    this.el.speed.textContent = String(Math.round(h.speed * 3.6));
    this.el.gear.textContent = h.gear < 0 ? 'R' : h.gear === 0 ? 'N' : String(h.gear);
    this.el.gear.classList.toggle('shift', h.rpm > h.redline * 0.93);
    this.el.abs.classList.toggle('on', h.abs);
    this.el.tcs.classList.toggle('on', h.tcs);
    this.el.mt.classList.toggle('on', h.manual);
    this.root.classList.toggle('wrong', h.wrongWay);
    const d = this.el.drift;
    const drafting = !h.boost && h.drift < 0 && h.draft > 0.15;
    const label = h.sling ? 'SLINGSHOT!' : h.boost ? 'BOOST!' : h.drift >= 0 ? ['DRIFT', 'DRIFT ●', 'DRIFT ●●', 'DRIFT ●●●'][h.drift] : drafting ? (h.charge >= 1 ? 'SLIPSTREAM ▸ PULL OUT' : 'SLIPSTREAM') : '';
    if (d.textContent !== label) d.textContent = label;
    d.dataset.level = h.boost ? 'boost' : drafting ? (h.charge >= 1 ? 'ready' : 'draft') : String(h.drift);
    d.style.setProperty('--charge', drafting ? h.charge.toFixed(2) : '0');
    this.el.wind.style.opacity = h.draft > 0.05 ? Math.min(1, h.draft * 1.2).toFixed(2) : '0';
    this.updateCombo(h);
    this.drawDamage(h.damage);
    this.drawTach(h);
    if (this.track.world) {
      const where = h.where ?? '';
      if (this.el.where.textContent !== where) this.el.where.textContent = where;
      this.drawWorldMap(h);
      return;
    }
    this.drawMap(h);
    this.drawStrip(h.dots);
    this.drawBoard(h.board);
  }

  private worldPaths: { path: Path2D; width: number; color: string }[] | null = null;

  /** Free roam's map: every road, heading up, around you (the expressway wide and gold, the rest by size). */
  private drawWorldMap(h: HudState) {
    const w = this.track.world!.world;
    const g = this.map.getContext('2d')!;
    const W = 220;
    const me = h.dots.find((d) => d.me);
    if (!this.worldPaths) {
      this.worldPaths = [];
      for (const rd of w.roads) {
        const path = new Path2D();
        for (let i = rd.i0; i < rd.i1; i += 3) (i === rd.i0 ? path.moveTo(w.x[i], w.z[i]) : path.lineTo(w.x[i], w.z[i]));
        if (rd.closed) path.closePath();
        else path.lineTo(w.x[rd.i1 - 1], w.z[rd.i1 - 1]);
        const kind = rd.def.kind;
        const color = kind === 'highway' ? 'rgba(255,201,64,0.9)' : kind === 'pass' || kind === 'country' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)';
        this.worldPaths.push({ path, width: Math.max(14, rd.half * 2.2), color });
      }
      // Wide roads on top, so the expressway reads over the streets it crosses.
      this.worldPaths.sort((a, b) => a.width - b.width);
    }
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,14,20,0.55)';
    g.fill();
    g.clip();
    if (me) {
      g.translate(W / 2, W / 2 + 24);
      g.rotate(h.heading);
      const scale = W / 2 / 650;
      g.scale(scale, scale);
      g.translate(-me.x, -me.z);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const p of this.worldPaths) {
        g.strokeStyle = p.color;
        g.lineWidth = p.width;
        g.stroke(p.path);
      }
      for (const d of h.dots) {
        g.fillStyle = d.me ? '#fff' : d.color;
        g.strokeStyle = '#000';
        g.lineWidth = 10;
        g.beginPath();
        g.arc(d.x, d.z, d.me ? 40 : 32, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  private updateCombo(h: HudState) {
    this.el.score.hidden = h.driftTotal <= 0 && !h.combo;
    const total = pts(h.driftTotal);
    if (this.el.scoreNum.textContent !== total) this.el.scoreNum.textContent = total;
    if (this.comboHold) return;
    const c = this.el.combo;
    c.classList.toggle('on', !!h.combo);
    if (!h.combo) return;
    c.dataset.state = 'live';
    const num = pts(h.combo.points);
    if (this.el.comboNum.textContent !== num) this.el.comboNum.textContent = num;
    const mult = h.combo.mult > 1 ? `×${h.combo.mult.toFixed(1)}` : '';
    if (this.el.comboMult.textContent !== mult) this.el.comboMult.textContent = mult;
  }

  private damageKey = '';
  /** The little top-down car by the tacho: each side shaded by how bent it is, and what's left of the car. */
  private drawDamage(d: Damage | null) {
    const el = this.el.damage;
    el.hidden = !d;
    if (!d) return;
    const key = `${d.total.toFixed(2)}|${d.zones.front.toFixed(2)}|${d.zones.rear.toFixed(2)}|${d.zones.left.toFixed(2)}|${d.zones.right.toFixed(2)}|${d.grace > 0}`;
    if (key === this.damageKey) return;
    this.damageKey = key;
    // Undamaged reads as plain white; then gold, then red (DESIGN.md: red acts, here it warns).
    const shade = (k: number) => (k < 0.02 ? 'rgba(255,255,255,0.18)' : k < 0.4 ? `rgba(255,201,64,${0.45 + k})` : `rgba(255,74,61,${Math.min(1, 0.5 + k * 0.6)})`);
    el.querySelectorAll<SVGRectElement>('[data-zone]').forEach((r) => r.setAttribute('fill', shade(d.zones[r.dataset.zone as Zone])));
    const left = Math.max(0, Math.round((1 - d.total) * 100));
    this.el.health.textContent = `${left}%`;
    el.dataset.state = d.grace > 0 ? 'fresh' : d.total > 0.75 ? 'critical' : d.total > 0.4 ? 'hurt' : 'ok';
  }

  private drawBoard(lines: BoardLine[]) {
    const html = lines
      .map(
        (l, i) =>
          `<li class="${l.me ? 'me' : ''}${l.finished !== null ? ' done' : ''}"><b>${i + 1}</b><i style="background:${l.color}"></i><span>${esc(l.name)}</span>${l.finished !== null ? `<small>${fmtTime(l.finished)}</small>` : ''}</li>`,
      )
      .join('');
    if (html !== this.boardHtml) this.el.board.innerHTML = this.boardHtml = html;
  }

  /** Places a name tag over each car in `tags`; tags for cars no longer listed are removed. */
  tags(tags: Tag[]) {
    const seen = new Set<Tag['id']>();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tagEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rh-tag';
        el.innerHTML = '<b></b><span></span>';
        this.el.tags.appendChild(el);
        this.tagEls.set(t.id, el);
      }
      const [place, name] = el.children as unknown as [HTMLElement, HTMLElement];
      const p = String(t.place);
      if (place.textContent !== p) place.textContent = p;
      if (name.textContent !== t.name) name.textContent = t.name;
      el.style.setProperty('--c', t.color);
      if (!t.at) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = t.at.alpha.toFixed(2);
      el.style.transform = `translate(${t.at.x.toFixed(1)}px, ${t.at.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.tagEls)
      if (!seen.has(id)) {
        el.remove();
        this.tagEls.delete(id);
      }
  }

  /** The dial's still parts (track, redline band, numbers) for one redline, drawn once: only the arc and needle move. */
  private tachFace: { redline: number; canvas: HTMLCanvasElement; grad: CanvasGradient } | null = null;

  private drawTach(h: HudState) {
    const g = this.tach.getContext('2d')!;
    const W = 260;
    const cx = W / 2;
    const cy = W / 2;
    const R = 112;
    const maxRpm = Math.ceil((h.redline + 500) / 1000) * 1000;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (rpm: number) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm / maxRpm));
    if (this.tachFace?.redline !== h.redline) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = W;
      const f = canvas.getContext('2d')!;
      f.lineCap = 'round';
      f.lineWidth = 10;
      f.strokeStyle = 'rgba(255,255,255,0.12)';
      f.beginPath();
      f.arc(cx, cy, R, a0, a1);
      f.stroke();
      f.strokeStyle = 'rgba(255,60,60,0.85)';
      f.beginPath();
      f.arc(cx, cy, R, ang(h.redline), a1);
      f.stroke();
      f.fillStyle = 'rgba(255,255,255,0.75)';
      f.font = '600 15px system-ui, sans-serif';
      f.textAlign = 'center';
      f.textBaseline = 'middle';
      for (let k = 0; k <= maxRpm / 1000; k++) {
        const a = ang(k * 1000);
        f.fillText(String(k), cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
      }
      const grad = g.createLinearGradient(0, W, W, 0);
      grad.addColorStop(0, '#38d1ff');
      grad.addColorStop(1, '#fff');
      this.tachFace = { redline: h.redline, canvas, grad };
    }
    g.clearRect(0, 0, W, W);
    g.drawImage(this.tachFace.canvas, 0, 0);
    g.lineCap = 'round';
    g.lineWidth = 10;
    g.strokeStyle = h.rpm > h.redline * 0.93 ? '#ff4a3d' : this.tachFace.grad;
    g.beginPath();
    g.arc(cx, cy, R, a0, ang(h.rpm));
    g.stroke();
    const a = ang(h.rpm);
    g.strokeStyle = '#ff5a3c';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
    g.stroke();
  }

  private roadPath: Path2D | null = null;

  private drawMap(h: HudState) {
    const g = this.map.getContext('2d')!;
    const W = 220;
    const t = this.track;
    const me = h.dots.find((d) => d.me);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,14,20,0.55)';
    g.fill();
    g.clip();
    if (me) {
      const scale = W / 2 / 420;
      g.translate(W / 2, W / 2 + 30);
      // Heading up: world -yaw rotation.
      g.rotate(h.heading);
      g.scale(scale, scale);
      g.translate(-me.x, -me.z);
      const i0 = Math.max(0, Math.floor((me.s - 700) / 2));
      const i1 = Math.min(t.n - 1, Math.floor((me.s + 900) / 2));
      const fork = t.fork;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 34;
      // The whole road, faint (built once: re-tracing every point each frame was most of the map's cost).
      if (!this.roadPath) {
        this.roadPath = new Path2D();
        for (let i = 0; i < t.n; i += 6) (i ? this.roadPath.lineTo(t.x[i], t.z[i]) : this.roadPath.moveTo(t.x[i], t.z[i]));
        // A fork's second road.
        if (fork) for (let k = 0; k < fork.m; k += 6) (k ? this.roadPath.lineTo(t.x[fork.o + k], t.z[fork.o + k]) : this.roadPath.moveTo(t.x[fork.o], t.z[fork.o]));
      }
      g.stroke(this.roadPath);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 18;
      g.beginPath();
      for (let i = i0; i <= i1; i += 2) (i === i0 ? g.moveTo(t.x[i], t.z[i]) : g.lineTo(t.x[i], t.z[i]));
      if (fork && i1 > fork.a && i0 < fork.b) {
        const k0 = Math.max(0, i0 - fork.a);
        const k1 = Math.min(fork.m - 1, i1 - fork.a);
        for (let k = k0; k <= k1; k += 2) (k === k0 ? g.moveTo(t.x[fork.o + k], t.z[fork.o + k]) : g.lineTo(t.x[fork.o + k], t.z[fork.o + k]));
      }
      g.stroke();
      const f = Math.floor(t.finishS / 2);
      g.fillStyle = '#ffd400';
      g.beginPath();
      g.arc(t.x[f], t.z[f], 26, 0, Math.PI * 2);
      g.fill();
      for (const d of h.dots) {
        g.fillStyle = d.me ? '#fff' : d.color;
        g.strokeStyle = '#000';
        g.lineWidth = 8;
        g.beginPath();
        g.arc(d.x, d.z, d.me ? 30 : 24, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  /** One dot per racer, kept between frames: rebuilding them every frame cost a style and layout pass each time. */
  private stripDots: HTMLElement[] = [];

  private drawStrip(dots: Dot[]) {
    const t = this.track;
    const span = t.finishS - t.startS;
    const box = this.el.strip;
    while (this.stripDots.length < dots.length) this.stripDots.push(box.appendChild(document.createElement('i')));
    while (this.stripDots.length > dots.length) this.stripDots.pop()!.remove();
    dots.forEach((d, i) => {
      const el = this.stripDots[i];
      const cls = d.me ? 'me' : '';
      if (el.className !== cls) el.className = cls;
      const bg = d.me ? '#fff' : d.color;
      if (el.dataset.bg !== bg) el.style.background = el.dataset.bg = bg;
      const top = `${Math.min(100, Math.max(0, ((d.s - t.startS) / span) * 100)).toFixed(1)}%`;
      if (el.style.top !== top) el.style.top = top;
    });
  }

  /** A panel of buttons (pause menu, results). Returns the panel element. */
  panel(html: string): HTMLElement {
    const p = this.el.panel;
    p.innerHTML = `<div class="rh-card" data-nav-scope>${html}</div>`;
    p.hidden = false;
    p.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return p;
  }

  closePanel() {
    this.el.panel.hidden = true;
    this.el.panel.innerHTML = '';
  }

  get panelOpen() {
    return !this.el.panel.hidden;
  }

  /** The results table. A time trial adds each racer's gap to the winner and their best lap. */
  resultsHtml(title: string, lines: ResultLine[], trial = false): string {
    const win = lines.find((l) => l.place === 1)?.time ?? null;
    const drifts = lines.some((l) => l.drift !== undefined);
    const rows = lines
      .map((l) => {
        const car = decodeCar(l.car);
        const color = car ? '#' + PAINTS[car.look.paint].toString(16).padStart(6, '0') : '#888';
        return `<tr class="${l.me ? 'me' : ''}">
          <td class="pl">${l.place ? ordinal(l.place) : 'DNF'}</td>
          <td><i class="swatch" style="background:${color}"></i>${esc(l.name)}${l.cpu ? ' <small class="rh-cpu">CPU</small>' : ''}</td>
          <td class="car">${car ? esc(CARS[car.model].name) : ''}</td>
          <td class="tm">${bestTag(l.newBest)}${l.out ? `<span class="rh-out">Out · lap ${l.out}</span>` : l.time !== null ? fmtTime(l.time) : '—'}</td>
          ${trial ? `<td class="gap">${l.time !== null && win !== null && l.place > 1 ? '+' + (l.time - win).toFixed(3) : ''}</td><td class="best">${l.best ? `<small>best lap</small> ${fmtTime(l.best)}` : ''}</td>` : ''}
          ${drifts ? `<td class="dr">${l.drift ? `${pts(l.drift)} <small>drift</small>` : ''}</td>` : ''}
          <td class="pz">+${money(l.prize)}</td></tr>`;
      })
      .join('');
    const rec = lines.find((l) => l.newBest?.rank === 1);
    return `<div data-results><h2>${esc(title)}</h2>${rec ? recordBanner(rec.name, rec.newBest!) : ''}<table class="rh-results"><tbody>${rows}</tbody></table></div>`;
  }

  dispose() {
    clearTimeout(this.bannerTimer);
    clearTimeout(this.comboTimer);
    clearTimeout(this.helpTimer);
    this.root.remove();
  }
}

/** A trophy (gold, silver or bronze by `place`) for the cup's podium. */
export function trophySvg(place: number): string {
  const c = ['#ffc940', '#d9e1ec', '#d08a4a'][place - 1] ?? '#ffc940';
  return `<svg class="rh-trophy" viewBox="0 0 48 48" aria-hidden="true"><path fill="${c}" d="M14 6h20v4h8v5c0 6-4 10-9.5 10.6A11 11 0 0 1 26 31v5h6v6H16v-6h6v-5a11 11 0 0 1-6.5-5.4C10 25 6 21 6 15v-5h8zm-4 8v1c0 3 1.6 5.5 4.4 6.4A16 16 0 0 1 14 18v-4zm28 0h-4v4c0 1.2-.1 2.3-.4 3.4C36.4 20.5 38 18 38 15z"/><path fill="rgba(255,255,255,0.35)" d="M18 9h3v13a8 8 0 0 1-3-5z"/></svg>`;
}

/**
 * The Grand Prix cup table (cups.ts): place, racer, their place in each round so far, points from this round and in
 * all. After the last round it's the final standings, with your trophy if you made the podium. `me`: your row's key.
 */
export function cupHtml(cup: CupId, round: number, table: CupRow[], final: boolean, me: string): string {
  const c = CUPS[cup];
  const mine = table.findIndex((r) => r.key === me);
  const rows = table
    .map((r, i) => {
      const rounds = Array.from({ length: roundsOf(cup) }, (_, k) => {
        const p = r.places[k];
        const cls = k > round ? 'todo' : p === 1 ? 'p1' : p === 2 ? 'p2' : p === 3 ? 'p3' : '';
        return `<i class="${cls}" title="${esc(TRACK_DEFS[c.tracks[k]].name)}">${k > round ? '' : p ? p : '–'}</i>`;
      }).join('');
      return `<tr class="${r.key === me ? 'me' : ''}${final && i < 3 ? ' pod' : ''}">
        <td class="pl">${ordinal(i + 1)}</td>
        <td>${r.team !== undefined ? `<i class="rh-tdot" style="--team:${TEAMS[r.team].color}" title="${TEAMS[r.team].name}"></i>` : ''}${esc(r.name)}${r.cpu ? ' <small class="rh-cpu">CPU</small>' : ''}</td>
        <td class="rds">${rounds}</td>
        <td class="gain">${r.last ? `+${r.last}` : ''}</td>
        <td class="pts">${r.pts}<small>pts</small></td></tr>`;
    })
    .join('');
  const podium = final && mine >= 0 && mine < 3;
  const head = final
    ? podium
      ? `<div class="rh-cup-win">${trophySvg(mine + 1)}<div><small>${esc(c.name)}</small><b>${mine === 0 ? 'Cup winner' : `${ordinal(mine + 1)} overall`}</b></div></div>`
      : `<div class="rh-cup-win"><div><small>${esc(c.name)}</small><b>${mine >= 0 ? `${ordinal(mine + 1)} overall` : 'Final standings'}</b></div></div>`
    : '';
  return `<section class="rh-cup" data-cup style="--cup:${c.color}">
    ${table.some((r) => r.team !== undefined) ? teamsHtml(table, final, table[mine]?.team) : head}
    <h3><span>${esc(c.name)}</span><small>${final ? 'Final standings' : `After round ${round + 1} of ${roundsOf(cup)}`}</small></h3>
    <table class="rh-results rh-cup-table"><tbody>${rows}</tbody></table>
  </section>`;
}

/**
 * A Team Grand Prix: Red and Blue's points so far (each racer's points count for their team), over the drivers'
 * table. After the last round the winning team gets the trophy, and your team is marked.
 */
function teamsHtml(table: CupRow[], final: boolean, mine: 0 | 1 | undefined): string {
  const teams = teamTable(table);
  const tie = teams[0].pts === teams[1].pts && teams[0].wins === teams[1].wins;
  const win = final && !tie ? teams[0] : null;
  const cards = teams
    .map((t, i) => {
      const meta = TEAMS[t.team];
      return `<div class="rh-team${win && i === 0 ? ' won' : ''}${t.team === mine ? ' mine' : ''}" style="--team:${meta.color}">
        ${win && i === 0 ? trophySvg(1) : ''}
        <b>${esc(meta.name)}${t.team === mine ? ' <small>your team</small>' : ''}</b>
        <span class="pts">${t.pts}<small>pts</small></span>
        ${t.last ? `<span class="gain">+${t.last}</span>` : ''}
      </div>`;
    })
    .join('');
  const line = final ? (win ? `${TEAMS[win.team].name} wins the cup${mine === undefined ? '' : mine === win.team ? ': your team!' : ''}` : 'The teams finish level') : 'Team standings';
  return `<div class="rh-teams"><small>${esc(line)}</small><div class="rh-team-cards">${cards}</div></div>`;
}

/** The tag before a finish time that was a new best: "Track record" when it tops the all-time board, else "New best". */
function bestTag(b: NewBest | null | undefined): string {
  if (!b) return '';
  if (b.rank === 1) return `<b class="rh-pb rh-tr" title="${b.beat ? `Old record ${fmtTime(b.beat.time)} by ${esc(b.beat.name)}` : 'First time on the board'}">Track record</b>`;
  const gain = b.prev === null ? '' : ` −${(b.prev - b.time).toFixed(3)}`;
  const rank = b.rank ? ` <span class="rh-rank" title="All-time board">#${b.rank}</span>` : '';
  return `<b class="rh-pb" title="${b.prev === null ? 'First finish here' : `Old best ${fmtTime(b.prev)}`}">New best${gain}</b>${rank}`;
}

/** Over the results when someone took the track's all-time record. */
function recordBanner(name: string, b: NewBest): string {
  const beat = b.beat ? (b.beat.name.toLowerCase() === name.toLowerCase() ? `their own ${fmtTime(b.beat.time)}` : `${esc(b.beat.name)}'s ${fmtTime(b.beat.time)}`) : '';
  return `<div class="rh-record" role="status"><span class="rh-record-tag">Track record</span><b>${esc(name)}</b><b class="tm">${fmtTime(b.time)}</b>${beat ? `<small>−${(b.beat!.time - b.time).toFixed(3)} s on ${beat}</small>` : '<small>The first time on the board</small>'}</div>`;
}

export const paintCss = (code: string) => {
  const c = decodeCar(code);
  return c ? '#' + PAINTS[c.look.paint].toString(16).padStart(6, '0') : '#888';
};
