// The HUD, in the DOM over the canvas: the bus's health and fuel, your own health and scrap, the zombie round, the
// checkpoint and what to do there (with an arrow and the distance), what you can do right here, a minimap, your gun,
// ammo and grenades, speed, the crew and their scrap, big banners, the leg's title card and the YEET!/FORE! popups.
// Player names only ever go in with textContent.

import type { ZView } from './director.ts';
import type { Route } from './route.ts';
import { maxFuel, maxHp, type Bus, type RunState } from './rules.ts';


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
  private fuel: HTMLElement;
  private fuelText: HTMLElement;
  private round: HTMLElement;
  private prompt: HTMLElement;
  private me: HTMLElement;
  private meText: HTMLElement;
  private place: HTMLElement;
  private card: HTMLElement;
  private cardT = 0;
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
    div('bd-label', bus, '⛽ FUEL');
    const fuelBar = div('bd-bar fuel', bus);
    this.fuel = div('bd-bar-fill', fuelBar);
    this.fuelText = div('bd-bar-text', fuelBar);
    div('bd-label', bus, '❤ YOU');
    const meBar = div('bd-bar me', bus);
    this.me = div('bd-bar-fill', meBar);
    this.meText = div('bd-bar-text', meBar);
    const row = div('bd-row', bus);
    this.money = div('bd-money', row);
    this.kills = div('bd-kills', row);
    const goal = div('bd-goal', top);
    this.place = div('bd-place', goal);
    this.goal = div('bd-goal-text', goal);
    const where = div('bd-where', goal);
    this.arrow = div('bd-arrow', where, '➤');
    this.dist = div('bd-dist', where);
    this.round = div('bd-round', goal);
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
    this.prompt = div('bd-prompt', this.el);
    this.card = div('bd-legcard', this.el);
  }

  /** The title card over a new leg: the checkpoint's number, the world, where you're headed. */
  legCard(n: number, world: string, place: string, note: string) {
    this.card.replaceChildren();
    div('bd-legcard-n', this.card, `LEG ${n}`);
    div('bd-legcard-world', this.card, world.toUpperCase());
    div('bd-legcard-place', this.card, `Next stop: ${place}`);
    if (note) div('bd-legcard-note', this.card, note);
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    this.cardT = 4.5;
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
      hopper: number;
      gun: string;
      nades: number;
      /** Your own health (0-1), scrap, and whether you're off the bus (lugging a can?) or knocked out. */
      hp: number;
      cash: number;
      onFoot: boolean;
      carrying: boolean;
      ko: number;
      /** The checkpoint: its number and name. */
      place: string;
      reloading: boolean;
      club: number;
      bus: Bus;
      crew: { name: string; driver: boolean; me: boolean; color: string; cash: number; off: boolean }[];
      locked: boolean;
      busy: boolean;
      prompt: string;
    },
  ) {
    const { run } = o;
    const k = Math.max(0, run.busHp / maxHp(run));
    this.hp.style.width = `${k * 100}%`;
    this.hp.style.background = k > 0.5 ? '#5ee06a' : k > 0.25 ? '#ffc23f' : '#ff4a4a';
    this.hpText.textContent = `${Math.ceil(run.busHp)} / ${maxHp(run)}`;
    this.money.textContent = `🔩 ${o.cash}`;
    this.me.style.width = `${Math.max(0, o.hp) * 100}%`;
    this.me.style.background = o.hp > 0.5 ? '#ff6b8a' : o.hp > 0.25 ? '#ffc23f' : '#ff4a4a';
    this.meText.textContent = o.ko > 0 ? `KNOCKED OUT ${Math.ceil(o.ko)}` : `${Math.ceil(o.hp * 100)}`;
    this.place.textContent = o.place;
    const fk = run.fuel / maxFuel(run);
    this.fuel.style.width = `${fk * 100}%`;
    this.fuel.style.background = fk > 0.3 ? '#ffb03a' : '#ff4a4a';
    this.fuelText.textContent = run.fuel <= 0 ? 'EMPTY! Shoot or drive over gas cans' : `${Math.ceil(run.fuel)}`;
    this.round.textContent = run.calm > 0 ? (run.round ? `Round ${run.round} survived · next in ${Math.ceil(run.calm)} s` : `First round in ${Math.ceil(run.calm)} s`) : `ROUND ${run.round} · ${run.left} left`;
    this.round.classList.toggle('calm', run.calm > 0);
    this.prompt.textContent = o.prompt;
    this.prompt.style.display = o.prompt ? 'block' : 'none';
    this.kills.textContent = `🧟 ${run.kills}`;
    this.goal.textContent = o.objective;
    this.dist.textContent = run.phase === 'drive' ? `${Math.round(o.toStop)} m` : '';
    this.arrow.style.visibility = run.phase === 'drive' ? 'visible' : 'hidden';
    this.arrow.style.transform = `rotate(${o.arrow - Math.PI / 2}rad)`;
    this.cross.style.display = o.gunner && !o.busy ? 'block' : 'none';
    this.ammo.style.display = o.gunner ? 'block' : 'none';
    this.ammo.textContent = o.carrying ? '⛽ LUGGING A CAN: get it to the bus' : `${o.gun}  ${o.reloading ? 'RELOADING…' : `🎨 ${o.ammo}/${o.hopper}`}  💣 ${o.nades}${run.club ? (o.club > 0 ? '  🏌 …' : '  🏌 READY') : ''}`;
    this.speed.style.display = o.driver ? 'block' : 'none';
    this.speed.textContent = `${Math.round(Math.abs(o.bus.v) * 3.6)} km/h`;
    this.hints.textContent = o.driver
      ? `W/S or RT/LT drive · A/D steer · Space/Ⓧ handbrake · H/LB horn · C/View ${o.chase ? 'cab view' : 'chase cam'} · F/Ⓨ get up`
      : o.onFoot
        ? `WASD walk · Click/RT shoot · G/D-pad↓ grenade · Q gun${run.club ? ' · V/RB club' : ''} · E/Ⓐ use, or climb aboard at the bus`
        : `WASD walk · Click/RT shoot · G grenade · Q gun · B store${run.club ? ' · V/RB club' : ''} · Space/Ⓑ at the hatch: roof${run.phase === 'stop' ? ' · E/Ⓐ hop off' : ''}`;
    this.lockHint.style.display = o.gunner && !o.locked && !o.busy ? 'block' : 'none';
    this.crew.replaceChildren(
      ...o.crew.map((c) => {
        const d = document.createElement('div');
        d.className = `bd-crewrow${c.me ? ' me' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = c.color;
        const n = document.createElement('span');
        n.textContent = `${c.driver ? '🚌 ' : c.off ? '🥾 ' : ''}${c.name}`;
        const w = document.createElement('span');
        w.className = 'cash';
        w.textContent = `🔩${c.cash}`;
        d.append(dot, n, w);
        return d;
      }),
    );
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.classList.remove('show');
    if (this.cardT > 0 && (this.cardT -= dt) <= 0) this.card.classList.remove('show');
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      p.el.style.transform = `translate(-50%, ${-p.t * 70}px) scale(${1 + Math.min(p.t * 4, 0.4)})`;
      p.el.style.opacity = String(Math.max(0, 1 - p.t / 1.1));
      if (p.t > 1.1) p.el.remove();
      return p.t <= 1.1;
    });
  }

  /** The minimap: the road round the bus, north is the bus's heading. */
  drawMap(route: Route, bus: Bus, zs: readonly ZView[], got: ReadonlySet<number>, done: boolean, me: { x: number; z: number } | null) {
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
    // The checkpoint (until it's cleared), its job's things, and the gate.
    const dot = (wx: number, wz: number, r: number, color: string) => {
      const [x, y] = P(wx, wz);
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    };
    dot(route.stop.x, route.stop.z, 6, done ? '#7a7a7a' : '#ffe14a');
    dot(route.gate.x, route.gate.z, 5, done ? '#3aff8a' : '#ff5a5a');
    if (!done) for (const s of route.sites) if (!got.has(s.id)) dot(s.x, s.z, 3, '#58d0ff');
    if (me) dot(me.x, me.z, 3.5, '#ffffff');
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
