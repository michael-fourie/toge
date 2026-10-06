import type { PlayerInfo } from '../shared/protocol.ts';
import type { Feat } from './achievements.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** DOM overlay. Everything is plain elements; cheap and easy to restyle. */
export class Hud {
  readonly root: HTMLDivElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private speedEl: HTMLElement;
  private speedBar: HTMLElement;
  private wallrunChip: HTMLElement;
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
      <div class="chips"><span class="chip wallrun">WALLRUN</span></div>
      <div class="ammo"><b>10</b><small>/ 10</small><span>reloading…</span></div>
      <div class="credit"></div>
      <div class="lobby-tag">${esc(lobbyLabel)}</div>
      <div class="topright"><div class="livescore"></div><div class="killfeed"></div></div>
      <div class="center-msg"></div>
      <div class="feats"></div>
      <div class="wave"></div>
      <div class="hurt"></div>
      <div class="health" hidden><b>100</b><div class="bar"><i></i></div></div>
      <div class="death"><h2></h2><p></p></div>
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
            <dt>LMB / RMB</dt><dd>shoot / hold to scope</dd>
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
    this.q('.resume').addEventListener('click', () => this.onResume?.());
    this.q('.leave').addEventListener('click', () => this.onLeave?.());
  }

  setPaused(p: boolean) {
    this.root.classList.toggle('paused', p);
  }

  setScoped(s: boolean) {
    this.root.classList.toggle('scoped', s);
  }

  update(dt: number, speed: number, wallrun: boolean, bolt: number) {
    this.speedEl.textContent = speed.toFixed(1);
    const k = Math.min(1, speed / 50);
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

  ammo(rounds: number, mag: number, reloading: boolean) {
    this.q('.ammo b').textContent = String(rounds);
    this.q('.ammo small').textContent = `/ ${mag}`;
    this.root.classList.toggle('reloading', reloading);
    this.root.classList.toggle('low-ammo', rounds <= 2);
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

  /** Death overlay; a null subtitle hides it. */
  death(text: string, sub: string | null) {
    const el = this.q('.death');
    el.classList.toggle('show', sub !== null);
    if (sub === null) return;
    this.q('.death h2').textContent = text;
    this.q('.death p').textContent = sub;
  }

  /** Always-on top-right standings (online only; null hides). Rebuilt only when the numbers change. */
  liveScores(players: PlayerInfo[] | null, selfId: number) {
    const el = this.q('.livescore');
    el.classList.toggle('show', !!players?.length);
    if (!players) return;
    const html = [...players]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => `<div class="${p.id === selfId ? 'me' : ''}"><i style="background:${hex(p.color)}"></i><span>${esc(p.name)}</span><b>${p.kills}</b></div>`)
      .join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  scoreboard(players: PlayerInfo[] | null, selfId: number) {
    const el = this.q('.scoreboard');
    el.classList.toggle('show', !!players);
    if (!players) return;
    const rows = [...players]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map(
        (p) =>
          `<tr class="${p.id === selfId ? 'me' : ''}"><td><i style="background:${hex(p.color)}"></i>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`,
      )
      .join('');
    el.innerHTML = `<table><thead><tr><th>Player</th><th>K</th><th>D</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  dispose() {
    this.root.remove();
  }
}
