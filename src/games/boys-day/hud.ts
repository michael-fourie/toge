// The HUD, in the DOM over the canvas: the bus's health, the bail fund, what to do next (with an arrow and the
// distance), a minimap, ammo, speed, the crew, big banners and the YEET!/FORE! popups. Player names only ever go in
// with textContent.

import type { ZView } from './director.ts';
import type { Route } from './route.ts';
import { BUS, GUN, RUN, type Bus, type RunState } from './rules.ts';

const div = (cls: string, parent: HTMLElement, text = '') => {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  parent.append(d);
  return d;
};

export class Hud {
  readonly el: HTMLElement;
  private hp: HTMLElement;
  private hpText: HTMLElement;
  private money: HTMLElement;
  private kills: HTMLElement;
  private goal: HTMLElement;
  private arrow: HTMLElement;
  private dist: HTMLElement;
  private map: HTMLCanvasElement;
  private ammo: HTMLElement;
  private speed: HTMLElement;
  private hints: HTMLElement;
  private crew: HTMLElement;
  private cross: HTMLElement;
  private banner: HTMLElement;
  private bannerT = 0;
  private lockHint: HTMLElement;
  private pops: { el: HTMLElement; t: number }[] = [];

  constructor(parent: HTMLElement) {
    this.el = div('bd-hud', parent);
    const top = div('bd-top', this.el);
    const bus = div('bd-busbox', top);
    div('bd-label', bus, '🚌 BUS');
    const bar = div('bd-bar', bus);
    this.hp = div('bd-bar-fill', bar);
    this.hpText = div('bd-bar-text', bar);
    const row = div('bd-row', bus);
    this.money = div('bd-money', row);
    this.kills = div('bd-kills', row);
    const goal = div('bd-goal', top);
    this.goal = div('bd-goal-text', goal);
    const where = div('bd-where', goal);
    this.arrow = div('bd-arrow', where, '➤');
    this.dist = div('bd-dist', where);
    this.map = document.createElement('canvas');
    this.map.className = 'bd-map';
    this.map.width = this.map.height = 170;
    top.append(this.map);
    this.cross = div('bd-cross', this.el);
    this.ammo = div('bd-ammo', this.el);
    this.speed = div('bd-speed', this.el);
    this.hints = div('bd-hints', this.el);
    this.crew = div('bd-crew', this.el);
    this.banner = div('bd-banner', this.el);
    this.lockHint = div('bd-lockhint', this.el, 'Click to aim');
  }

  /** The health bar flashes green (a repair kit). */
  flashHp() {
    const bar = this.hp.parentElement!;
    bar.classList.remove('heal');
    void bar.offsetWidth;
    bar.classList.add('heal');
  }

  say(text: string) {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerT = 3.2;
  }

  /** A word that pops out of a spot on screen and floats up. */
  pop(text: string, x: number, y: number, color: string, big = false) {
    const el = div(`bd-pop${big ? ' big' : ''}`, this.el, text);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    this.pops.push({ el, t: 0 });
    if (this.pops.length > 30) this.pops.shift()!.el.remove();
  }

  update(
    dt: number,
    o: {
      run: RunState;
      objective: string;
      toStop: number;
      /** Arrow angle on screen (radians, 0 = straight up). */
      arrow: number;
      gunner: boolean;
      driver: boolean;
      chase: boolean;
      ammo: number;
      reloading: boolean;
      club: number;
      bus: Bus;
      crew: { name: string; seat: number; me: boolean; color: string }[];
      locked: boolean;
      busy: boolean;
    },
  ) {
    const { run } = o;
    const k = Math.max(0, run.busHp / BUS.hp);
    this.hp.style.width = `${k * 100}%`;
    this.hp.style.background = k > 0.5 ? '#5ee06a' : k > 0.25 ? '#ffc23f' : '#ff4a4a';
    this.hpText.textContent = `${Math.ceil(run.busHp)}`;
    this.money.textContent = `$${run.money}${run.stage <= 3 && !run.bailPaid ? ` / $${RUN.bail} bail` : ''}`;
    this.kills.textContent = `🧟 ${run.kills}`;
    this.goal.textContent = o.objective;
    this.dist.textContent = run.phase === 'drive' ? `${Math.round(o.toStop)} m` : '';
    this.arrow.style.visibility = run.phase === 'drive' ? 'visible' : 'hidden';
    this.arrow.style.transform = `rotate(${o.arrow - Math.PI / 2}rad)`;
    this.cross.style.display = o.gunner && !o.busy ? 'block' : 'none';
    this.ammo.style.display = o.gunner ? 'block' : 'none';
    this.ammo.textContent = o.reloading ? 'RELOADING…' : `🎨 ${o.ammo}/${GUN.hopper}${run.club ? (o.club > 0 ? '  🏌 …' : '  🏌 READY') : ''}`;
    this.speed.style.display = o.driver ? 'block' : 'none';
    this.speed.textContent = `${Math.round(Math.abs(o.bus.v) * 3.6)} km/h`;
    this.hints.textContent = o.driver
      ? `W/S or RT/LT drive · A/D steer · Space/Ⓧ handbrake · H/LB horn · C/View ${o.chase ? 'cab view' : 'chase cam'} · F/Ⓨ to a window`
      : `Click/RT shoot · R/Ⓧ reload${run.club ? ' · V/RB swing the club' : ''} · F/Ⓨ take the wheel · E/Ⓐ at a stop: go in`;
    this.lockHint.style.display = o.gunner && !o.locked && !o.busy ? 'block' : 'none';
    this.crew.replaceChildren(
      ...o.crew.map((c) => {
        const d = document.createElement('div');
        d.className = `bd-crewrow${c.me ? ' me' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = c.color;
        const n = document.createElement('span');
        n.textContent = `${c.seat === 0 ? '🚌 ' : ''}${c.name}`;
        d.append(dot, n);
        return d;
      }),
    );
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.classList.remove('show');
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      p.el.style.transform = `translate(-50%, ${-p.t * 70}px) scale(${1 + Math.min(p.t * 4, 0.4)})`;
      p.el.style.opacity = String(Math.max(0, 1 - p.t / 1.1));
      if (p.t > 1.1) p.el.remove();
      return p.t <= 1.1;
    });
  }

  /** The minimap: the road round the bus, north is the bus's heading. */
  drawMap(route: Route, bus: Bus, zs: readonly ZView[], nextStop: number) {
    const g = this.map.getContext('2d')!;
    const S = this.map.width;
    const scale = 0.55; // px per metre
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, 7);
    g.clip();
    g.fillStyle = 'rgba(40,60,30,0.75)';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(bus.h);
    const P = (x: number, z: number) => [(x - bus.x) * scale, (z - bus.z) * scale] as const;
    g.strokeStyle = '#b8b8c4';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.beginPath();
    let started = false;
    for (const p of route.road) {
      if (Math.abs(p.x - bus.x) > 220 || Math.abs(p.z - bus.z) > 220) {
        started = false;
        continue;
      }
      const [x, y] = P(p.x, p.z);
      if (started) g.lineTo(x, y);
      else g.moveTo(x, y);
      started = true;
    }
    g.stroke();
    route.stops.forEach((s, i) => {
      const [x, y] = P(s.x, s.z);
      g.fillStyle = i === nextStop ? '#ffe14a' : i < nextStop ? '#7a7a7a' : '#ffffff';
      g.beginPath();
      g.arc(x, y, i === nextStop ? 6 : 4, 0, 7);
      g.fill();
    });
    g.fillStyle = '#ff5a5a';
    for (const z of zs) {
      if (z.st === 'dead') continue;
      const [x, y] = P(z.x, z.z);
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    g.restore();
    g.fillStyle = '#f2a516';
    g.beginPath();
    g.moveTo(S / 2, S / 2 - 8);
    g.lineTo(S / 2 + 5, S / 2 + 6);
    g.lineTo(S / 2 - 5, S / 2 + 6);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, 7);
    g.stroke();
  }
}
