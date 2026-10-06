import { MOVE } from '../shared/constants.ts';
import type { PlayerInfo } from '../shared/protocol.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** DOM overlay. Everything is plain elements; cheap and easy to restyle. */
export class Hud {
  readonly root: HTMLDivElement;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
  private speedEl: HTMLElement;
  private speedBar: HTMLElement;
  private chips: Record<'wallrun' | 'dj', HTMLElement>;
  private boltBar: HTMLElement;
  private centerTimer = 0;
  private hitTimer = 0;

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
      <div class="chips"><span class="chip wallrun">WALLRUN</span><span class="chip dj">AIR JUMP</span></div>
      <div class="lobby-tag">${esc(lobbyLabel)}</div>
      <div class="killfeed"></div>
      <div class="center-msg"></div>
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
            <dt>Run along walls</dt><dd>wallrun, Space to wall-jump</dd>
            <dt>LMB / RMB</dt><dd>shoot / hold to scope</dd>
            <dt>Tab</dt><dd>scores</dd>
            <dt>\`</dt><dd>movement tuning panel</dd>
          </dl>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.speedEl = this.q('.speed b');
    this.speedBar = this.q('.speed .bar i');
    this.boltBar = this.q('.bolt i');
    this.chips = { wallrun: this.q('.chip.wallrun'), dj: this.q('.chip.dj') };
    this.q('.resume').addEventListener('click', () => this.onResume?.());
    this.q('.leave').addEventListener('click', () => this.onLeave?.());
  }

  setPaused(p: boolean) {
    this.root.classList.toggle('paused', p);
  }

  setScoped(s: boolean) {
    this.root.classList.toggle('scoped', s);
  }

  update(dt: number, speed: number, wallrun: boolean, airJump: boolean, bolt: number) {
    this.speedEl.textContent = speed.toFixed(1);
    const k = Math.min(1, speed / 30);
    this.speedBar.style.width = `${k * 100}%`;
    // Cream at walking pace, warming to sunset coral as you build speed.
    this.speedEl.style.color = `hsl(${44 - k * 34}, ${75 + k * 20}%, ${95 - k * 28}%)`;
    this.chips.wallrun.classList.toggle('on', wallrun);
    this.chips.dj.hidden = MOVE.airJumps <= 0; // air jumps are off by default (CS-style movement)
    this.chips.dj.classList.toggle('on', airJump);
    this.boltBar.style.width = `${(1 - bolt) * 100}%`;
    this.root.classList.toggle('cycling', bolt > 0);

    this.centerTimer -= dt;
    if (this.centerTimer <= 0) this.q('.center-msg').classList.remove('show');
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.q('.hitmarker').classList.remove('show');
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

  killfeed(killer: PlayerInfo | undefined, victim: PlayerInfo | undefined, verb: string) {
    const feed = this.q('.killfeed');
    const row = document.createElement('div');
    const name = (p?: PlayerInfo) => (p ? `<b style="color:${hex(p.color)}">${esc(p.name)}</b>` : '<b>???</b>');
    row.innerHTML = killer && killer !== victim ? `${name(killer)} <span>${verb}</span> ${name(victim)}` : `${name(victim)} <span>${verb}</span>`;
    feed.prepend(row);
    setTimeout(() => row.remove(), 6000);
    while (feed.children.length > 6) feed.lastElementChild!.remove();
  }

  death(text: string, respawnIn: number | null) {
    const el = this.q('.death');
    el.classList.toggle('show', respawnIn !== null);
    if (respawnIn === null) return;
    this.q('.death h2').textContent = text;
    this.q('.death p').textContent = respawnIn > 0 ? `respawning in ${respawnIn.toFixed(1)}s` : 'respawning…';
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
