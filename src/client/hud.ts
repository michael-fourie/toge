import { COIN_SVG } from './menu/lootui.ts';
import { MOVE } from '../shared/constants.ts';
import type { PlayerInfo } from '../shared/protocol.ts';
import type { Feat } from './achievements.ts';
import { KILL_LIMIT, TEAMS, teamKills } from '../shared/teams.ts';
import { SpeedFx } from './speedfx.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** DOM overlay. Everything is plain elements; cheap and easy to restyle. */
export class Hud {
  readonly root: HTMLDivElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private speedEl: HTMLElement;
  private speedBar: HTMLElement;
  private wallrunChip: HTMLElement;
  private grappleChip: HTMLElement;
  private fx: SpeedFx;
  private boltBar: HTMLElement;
  private centerTimer = 0;
  private hitTimer = 0;
  private featTimer = 0;

  onResume?: () => void;
  onLeave?: () => void;

  constructor(parent: HTMLElement, lobbyLabel: string) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="scope"><div class="lens"></div></div>
      <div class="crosshair"></div>
      <div class="hitmarker"></div>
      <div class="bolt"><i></i></div>
      <div class="speed"><b>0</b><small>m/s</small><div class="bar"><i></i></div></div>
      <div class="chips"><span class="chip wallrun">WALLRUN</span><span class="chip grapple">GRAPPLE [E]</span></div>
      <div class="ammo"><i class="gunname"></i><div class="slots"></div><b>10</b><small>/ 10</small><span>reloading…</span></div>
      <div class="credit"></div>
      <div class="coins" title="Coins"><b></b><i></i></div>
      <div class="lobby-tag">${esc(lobbyLabel)}</div>
      <div class="topright"><div class="livescore"></div><div class="killfeed"></div></div>
      <div class="center-msg"></div>
      <div class="feats"></div>
      <div class="wave"></div>
      <div class="hurt"></div>
      <div class="health" hidden><b>100</b><div class="bar"><i></i></div></div>
      <div class="death"><h2></h2><p></p></div>
      <div class="killcam"><i></i><b>KILLCAM</b><span></span><em>space to skip</em></div>
      <div class="scoreboard"></div>
      <div class="pause">
        <div class="panel">
          <h1>PAUSED</h1>
          <button class="primary resume">Click to play</button>
          <button class="leave">Leave</button>
          <dl class="keys">
            <dt>WASD</dt><dd>move — in the air, let go of W, hold A/D and turn the mouse with it to gain speed</dd>
            <dt>Space / wheel</dt><dd>jump — hold to bhop, momentum is kept</dd>
            <dt>Shift</dt><dd>slide (hold it in the air to slide on landing; jump out to keep speed)</dd>
            <dt>Run along walls</dt><dd>wallrun, Space to wall-jump</dd>
            <dt>Q</dt><dd>grenade (a new one 8 s after throwing)</dd>
            <dt>E</dt><dd>grapple: reels you toward what you aim at (40 m rope, 1.5 s to recharge); Space lets go and keeps your speed</dd>
            <dt>F</dt><dd>Survival: buy doors, wall guns and the Mystery Box; take a gun from the box; hold at a window to nail the boards back up</dd>
            <dt>LMB / RMB</dt><dd>shoot (hold for automatic guns) / hold to aim down the sights or scope</dd>
            <dt>1 / 2</dt><dd>switch guns (Survival: you carry two)</dd>
            <dt>2 / 3</dt><dd>knife: stab with LMB, one hit kills. It is 2 when you carry one gun, 3 when you carry two</dd>
            <dt>R</dt><dd>reload (auto when empty)</dd>
            <dt>Tab</dt><dd>scores</dd>
            <dt>\`</dt><dd>movement tuning panel</dd>
          </dl>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.speedEl = this.q('.speed b');
    this.speedBar = this.q('.speed .bar i');
    this.boltBar = this.q('.bolt i');
    this.wallrunChip = this.q('.chip.wallrun');
    this.grappleChip = this.q('.chip.grapple');
    this.fx = new SpeedFx(this.root);
    this.q('.resume').addEventListener('click', () => this.onResume?.());
    this.q('.leave').addEventListener('click', () => this.onLeave?.());
  }

  setPaused(p: boolean) {
    this.root.classList.toggle('paused', p);
  }

  setScoped(s: boolean) {
    this.root.classList.toggle('scoped', s);
  }

  /** Chip lights when E would catch a surface (ready) and goes warm while the rope is out (attached). */
  grapple(state: 'off' | 'ready' | 'attached') {
    this.grappleChip.classList.toggle('on', state === 'ready');
    this.grappleChip.classList.toggle('active', state === 'attached');
  }

  /** A quick burst of wind streaks (wall jump, grapple hook, gate). */
  punch(amount?: number) {
    this.fx.punch(amount);
  }

  update(dt: number, speed: number, wallrun: boolean, bolt: number) {
    this.speedEl.textContent = speed.toFixed(1);
    this.fx.update(dt, speed, !this.root.classList.contains('paused') && !this.root.classList.contains('scoped') && !this.root.classList.contains('replay'));
    const k = Math.min(1, speed / MOVE.maxSpeed);
    this.speedBar.style.width = `${k * 100}%`;
    // Cream at walking pace, warming to sunset coral as you build speed.
    this.speedEl.style.color = `hsl(${44 - k * 34}, ${75 + k * 20}%, ${95 - k * 28}%)`;
    this.wallrunChip.classList.toggle('on', wallrun);
    this.boltBar.style.width = `${(1 - bolt) * 100}%`;
    this.root.classList.toggle('cycling', bolt > 0);

    this.centerTimer -= dt;
    if (this.centerTimer <= 0) this.q('.center-msg').classList.remove('show');
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.q('.hitmarker').classList.remove('show');
    this.featTimer -= dt;
    if (this.featTimer <= 0) this.q('.feats').classList.remove('show');
  }

  /** Rounds in the mag, spare rounds (null: endless), the gun's name, and the guns we carry (names, or null for an empty slot) with the one in our hands. */
  ammo(rounds: number, mag: number, reserve: number | null, reloading: boolean, name: string, slots: (string | null)[] = [], cur = 0) {
    this.q('.ammo b').textContent = String(rounds);
    this.q('.ammo small').textContent = reserve === null ? `/ ${mag}` : `/ ${reserve}`;
    this.q('.gunname').textContent = name;
    const html = slots.length > 1 ? slots.map((s, i) => `<u class="${i === cur ? 'cur' : ''}">${i + 1}${s ? ` ${esc(s)}` : ''}</u>`).join('') : '';
    const el = this.q('.slots');
    if (el.innerHTML !== html) el.innerHTML = html;
    this.root.classList.toggle('reloading', reloading);
    this.root.classList.toggle('low-ammo', rounds <= Math.max(1, mag * 0.2) && rounds < 5);
  }

  /** The coin counter (bottom left); `gained` floats up beside it for a moment. */
  coins(total: number, gained = 0) {
    this.q('.coins b').innerHTML = `${COIN_SVG}<span>${total}</span>`;
    if (!gained) return;
    const pop = this.q('.coins i');
    pop.textContent = `+${gained}`;
    pop.classList.remove('pop');
    void pop.offsetWidth;
    pop.classList.add('pop');
  }

  /** Attribution line for a CC BY model, shown small in the pause menu corner. */
  setCredit(text: string | null) {
    this.q('.credit').textContent = text ?? '';
  }

  hitmarker() {
    const el = this.q('.hitmarker');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.hitTimer = 0.25;
  }

  center(text: string, color = '#fff', seconds = 1.4) {
    const el = this.q('.center-msg');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
    this.centerTimer = seconds;
  }

  /**
   * A kill's feats, compounded: style feats read as one title ("360 NO-SCOPE HEADSHOT"), multi-kills and
   * streaks ride underneath, and a combo count when more than one stacked. Chips pop in one by one.
   */
  feats(style: Feat[], extra: Feat[]) {
    const el = this.q('.feats');
    const total = style.length + extra.length;
    const tier = (f: Feat) => `t${f.tier}`;
    let i = 0;
    const word = (f: Feat) => `<span class="${tier(f)}" style="animation-delay:${i++ * 0.07}s">${esc(f.label)}</span>`;
    el.innerHTML = `
      ${style.length ? `<div class="title">${style.map(word).join(' ')}</div>` : ''}
      ${extra.length ? `<div class="extra">${extra.map(word).join('')}</div>` : ''}
      ${total > 1 ? `<div class="combo" style="animation-delay:${i * 0.07}s">×${total} COMBO</div>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.featTimer = 2.4;
  }

  /** Survival health; null hides it (Battle is one shot, one kill). */
  health(hp: number | null, max: number) {
    const el = this.q('.health');
    el.hidden = hp === null;
    if (hp === null) return;
    this.q('.health b').textContent = String(Math.ceil(hp));
    this.q('.health .bar i').style.width = `${(hp / max) * 100}%`;
    el.classList.toggle('low', hp <= max * 0.3);
  }

  hurt() {
    const el = this.q('.hurt');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** Survival round banner along the top; null hides it. */
  wave(html: string | null) {
    const el = this.q('.wave');
    el.classList.toggle('show', html !== null);
    if (html !== null && el.innerHTML !== html) el.innerHTML = html;
  }

  killfeed(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, verb: string) {
    const feed = this.q('.killfeed');
    const row = document.createElement('div');
    const name = (p?: PlayerInfo) => (p ? `<b style="color:${hex(p.color)}">${esc(p.name)}</b>` : '<b>???</b>');
    row.innerHTML = killer && killer !== victim ? `${name(killer)} <span>${verb}</span> ${name(victim)}` : `${name(victim)} <span>${verb}</span>`;
    feed.prepend(row);
    setTimeout(() => row.remove(), 6000);
    while (feed.children.length > 6) feed.lastElementChild!.remove();
  }

  /** Kill-cam banner (cinematic bars, hides the rest of the HUD); null text ends it. */
  killcam(text: string | null) {
    this.root.classList.toggle('replay', text !== null); // not 'killcam': that is the banner's own class
    if (text !== null) this.q('.killcam span').textContent = text;
  }

  /** Death overlay; a null subtitle hides it. */
  death(text: string, sub: string | null) {
    const el = this.q('.death');
    el.classList.toggle('show', sub !== null);
    if (sub === null) return;
    this.q('.death h2').textContent = text;
    this.q('.death p').textContent = sub;
  }

  /** Always-on top-right standings (online only; null hides). Rebuilt only when the numbers change. */
  liveScores(players: PlayerInfo[] | null, selfId: number, teams = false, goalText = `First to ${KILL_LIMIT} kills`) {
    const el = this.q('.livescore');
    el.classList.toggle('show', !!players?.length);
    if (!players) return;
    const goal = `<div class="goal">${goalText}</div>`;
    const tally = teams
      ? teamKills(players)
          .map((k, t) => `<div class="team"><i style="background:${hex(TEAMS[t].color)}"></i><span>${TEAMS[t].name}</span><b>${k}</b></div>`)
          .join('')
      : '';
    const rows = [...players]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => `<div class="${p.id === selfId ? 'me' : ''}"><i style="background:${hex(p.color)}"></i><span>${esc(p.name)}</span><b>${p.kills}</b></div>`)
      .join('');
    const html = goal + tally + rows;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /** Tab board; in teams mode each side gets its own block under a header with the team total. */
  scoreboard(players: PlayerInfo[] | null, selfId: number, teams = false) {
    const el = this.q('.scoreboard');
    el.classList.toggle('show', !!players);
    if (!players) return;
    const row = (p: PlayerInfo) =>
      `<tr class="${p.id === selfId ? 'me' : ''}"><td><i style="background:${hex(p.color)}"></i>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
    const ranked = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const body = teams
      ? TEAMS.map((t, i) => {
          const side = ranked.filter((p) => p.team === i);
          const total = side.reduce((n, p) => n + p.kills, 0);
          return `<tr class="teamhead"><th style="color:${hex(t.color)}">${t.name}</th><th>${total}</th><th></th></tr>${side.map(row).join('')}`;
        }).join('')
      : ranked.map(row).join('');
    el.innerHTML = `<table><thead><tr><th>Player</th><th>K</th><th>D</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  dispose() {
    this.fx.dispose();
    this.root.remove();
  }
}
