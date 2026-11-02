// The race HUD (DOM + two small canvases): position and timer, the live leaderboard (top left), name tags
// over the other cars, a vertical "descent" strip with every racer's progress, a heading-up minimap, the tachometer with gear and speed, assist lights, the countdown,
// banners, and the pause and results panels (gamepad-navigable: they're nav scopes).

import { PAINTS, decodeCar, CARS } from '../shared/cars.ts';
import type { Track } from '../shared/track.ts';
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
  place: number;
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
  boost: boolean;
  /** The item slot: what you hold (or the roulette spinning), or null. */
  item: { icon: string; name: string; spinning: boolean } | null;
  heading: number; // yaw
  dots: Dot[];
  board: BoardLine[];
}

export interface ResultLine {
  place: number;
  name: string;
  car: string;
  time: number | null;
  /** Quickest lap (circuits), when known. */
  best?: number | null;
  prize: number;
  me: boolean;
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export class RaceHud {
  readonly root: HTMLElement;
  private tach: HTMLCanvasElement;
  private map: HTMLCanvasElement;
  private el: Record<string, HTMLElement> = {};
  private bannerTimer = 0;
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
      </div>
      <div class="rh-drift" data-el="drift"></div>
      <div class="rh-item" data-el="item"><span class="rh-item-icon" data-el="itemIcon"></span><small data-el="itemName"></small></div>
      <div class="rh-center" data-el="center"></div>
      <div class="rh-banner" data-el="banner"></div>
      <div class="rh-watch" data-el="watch"></div>
      <div class="rh-help" data-el="help"></div>
      <div class="rh-panel" data-el="panel" hidden></div>`;
    container.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.el[e.dataset.el!] = e));
    this.tach = this.root.querySelector('.rh-tach')!;
    this.map = this.root.querySelector('.rh-map')!;
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
    if (h.laps) this.el.lap.textContent = `Lap ${h.lap}/${h.laps}`;
    this.el.speed.textContent = String(Math.round(h.speed * 3.6));
    this.el.gear.textContent = h.gear < 0 ? 'R' : h.gear === 0 ? 'N' : String(h.gear);
    this.el.gear.classList.toggle('shift', h.rpm > h.redline * 0.93);
    this.el.abs.classList.toggle('on', h.abs);
    this.el.tcs.classList.toggle('on', h.tcs);
    this.el.mt.classList.toggle('on', h.manual);
    this.root.classList.toggle('wrong', h.wrongWay);
    const d = this.el.drift;
    const label = h.boost ? 'BOOST!' : h.drift >= 0 ? ['DRIFT', 'DRIFT ●', 'DRIFT ●●', 'DRIFT ●●●'][h.drift] : '';
    if (d.textContent !== label) d.textContent = label;
    d.dataset.level = h.boost ? 'boost' : String(h.drift);
    this.el.item.classList.toggle('on', !!h.item);
    this.el.item.classList.toggle('spinning', !!h.item?.spinning);
    const icon = h.item?.icon ?? '';
    if (this.el.itemIcon.textContent !== icon) this.el.itemIcon.textContent = icon;
    const name = h.item?.name ?? '';
    if (this.el.itemName.textContent !== name) this.el.itemName.textContent = name;
    this.drawTach(h);
    this.drawMap(h);
    this.drawStrip(h.dots);
    this.drawBoard(h.board);
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

  private drawTach(h: HudState) {
    const g = this.tach.getContext('2d')!;
    const W = 260;
    const cx = W / 2;
    const cy = W / 2;
    const R = 112;
    g.clearRect(0, 0, W, W);
    const maxRpm = Math.ceil((h.redline + 500) / 1000) * 1000;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (rpm: number) => a0 + (a1 - a0) * Math.min(1, Math.max(0, rpm / maxRpm));
    g.lineCap = 'round';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    g.strokeStyle = 'rgba(255,60,60,0.85)';
    g.beginPath();
    g.arc(cx, cy, R, ang(h.redline), a1);
    g.stroke();
    const grad = g.createLinearGradient(0, W, W, 0);
    grad.addColorStop(0, '#38d1ff');
    grad.addColorStop(1, '#fff');
    g.strokeStyle = h.rpm > h.redline * 0.93 ? '#ff4a3d' : grad;
    g.beginPath();
    g.arc(cx, cy, R, a0, ang(h.rpm));
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k <= maxRpm / 1000; k++) {
      const a = ang(k * 1000);
      g.fillText(String(k), cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
    }
    const a = ang(h.rpm);
    g.strokeStyle = '#ff5a3c';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
    g.stroke();
  }

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
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 34;
      g.beginPath();
      for (let i = 0; i < t.n; i += 6) (i ? g.lineTo(t.x[i], t.z[i]) : g.moveTo(t.x[i], t.z[i]));
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 18;
      g.beginPath();
      for (let i = i0; i <= i1; i += 2) (i === i0 ? g.moveTo(t.x[i], t.z[i]) : g.lineTo(t.x[i], t.z[i]));
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

  private drawStrip(dots: Dot[]) {
    const t = this.track;
    const span = t.finishS - t.startS;
    this.el.strip.innerHTML = dots
      .map((d) => `<i class="${d.me ? 'me' : ''}" style="top:${Math.min(100, Math.max(0, ((d.s - t.startS) / span) * 100)).toFixed(2)}%;background:${d.me ? '#fff' : d.color}"></i>`)
      .join('');
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
    const rows = lines
      .map((l) => {
        const car = decodeCar(l.car);
        const color = car ? '#' + PAINTS[car.look.paint].toString(16).padStart(6, '0') : '#888';
        return `<tr class="${l.me ? 'me' : ''}">
          <td class="pl">${l.place ? ordinal(l.place) : 'DNF'}</td>
          <td><i class="swatch" style="background:${color}"></i>${esc(l.name)}</td>
          <td class="car">${car ? esc(CARS[car.model].name) : ''}</td>
          <td class="tm">${l.time !== null ? fmtTime(l.time) : '—'}</td>
          ${trial ? `<td class="gap">${l.time !== null && win !== null && l.place > 1 ? '+' + (l.time - win).toFixed(3) : ''}</td><td class="best">${l.best ? `<small>best lap</small> ${fmtTime(l.best)}` : ''}</td>` : ''}
          <td class="pz">+${money(l.prize)}</td></tr>`;
      })
      .join('');
    return `<h2>${esc(title)}</h2><table class="rh-results"><tbody>${rows}</tbody></table>`;
  }

  dispose() {
    clearTimeout(this.bannerTimer);
    clearTimeout(this.helpTimer);
    this.root.remove();
  }
}

export const paintCss = (code: string) => {
  const c = decodeCar(code);
  return c ? '#' + PAINTS[c.look.paint].toString(16).padStart(6, '0') : '#888';
};
