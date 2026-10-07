// Survival post-game screen: a full-screen paper panel with the run's scoreboard, Play again and Home.

import { mvpIds, totalKills } from '../shared/postgame.ts';
import type { PostRow } from '../shared/protocol.ts';
import { esc, hex } from './menu/ui.ts';
import { type XpLine, showXp } from './xpcard.ts';

export class PostGame {
  private root: HTMLDivElement;
  private again: HTMLButtonElement;
  private iAmReady = false;
  private shown = false;
  private left: number | null = null;
  private timerAt = 0;

  constructor(
    parent: HTMLElement,
    private selfId: number,
    private cb: { onAgain: () => void; onHome: () => void },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'postgame';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="sheet postgame-card">
        <h2>THE HORDE WON</h2>
        <p class="pg-sub"></p>
        <ol class="pg-rows"></ol>
        <p class="pg-total"></p>
        <div class="pg-xp"></div>
        <div class="pg-buttons">
          <button class="primary" data-again>Play again</button>
          <button data-home>Home</button>
        </div>
        <p class="pg-wait"></p>
      </div>`;
    parent.appendChild(this.root);
    this.again = this.root.querySelector('[data-again]')!;
    this.again.onclick = () => {
      if (this.iAmReady) return;
      this.iAmReady = true;
      this.again.disabled = true;
      this.cb.onAgain();
    };
    (this.root.querySelector('[data-home]') as HTMLElement).onclick = () => this.cb.onHome();
  }

  get visible() {
    return this.shown;
  }

  /** `timeout` is seconds until the server restarts the run regardless. */
  update(rounds: number, rows: PostRow[], waiting: number, timeout: number, now: number) {
    if (!this.shown) {
      this.shown = true;
      this.iAmReady = false;
      this.root.hidden = false;
      document.exitPointerLock?.();
    }
    this.left = timeout;
    this.timerAt = now;
    const me = rows.find((r) => r.id === this.selfId);
    this.iAmReady = !!me?.ready;
    this.again.disabled = this.iAmReady;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    q('.pg-sub').textContent = `You survived ${rounds} round${rounds === 1 ? '' : 's'}`;
    const mvp = mvpIds(rows);
    q('.pg-rows').innerHTML = rows
      .map(
        (r, i) => `<li class="${r.id === this.selfId ? 'me' : ''}${r.gone ? ' gone' : ''}">
          <span class="pg-rank">${i + 1}</span>
          <i style="background:${hex(r.color)}"></i>
          <span class="pg-name">${mvp.has(r.id) ? '<em title="MVP">&#128081;</em> ' : ''}${esc(r.name)}${r.gone ? ' <small>left</small>' : r.ready ? ' <small>ready</small>' : ''}</span>
          <b>${r.kills}</b></li>`,
      )
      .join('');
    const total = totalKills(rows);
    q('.pg-total').innerHTML = `Zombies felled together: <b>${total}</b>`;
    this.waiting(waiting);
  }

  private waiting(n: number) {
    const el = this.root.querySelector('.pg-wait') as HTMLElement;
    el.textContent = this.iAmReady ? (n > 0 ? `Waiting for ${n} player${n === 1 ? '' : 's'}…` : 'Starting…') : '';
  }

  /** Seconds left before the automatic restart, for a gentle nudge near the end. */
  tick(now: number) {
    if (!this.shown || this.left === null) return;
    const s = Math.max(0, Math.ceil(this.left - (now - this.timerAt)));
    if (s <= 15 && !this.iAmReady) (this.root.querySelector('.pg-wait') as HTMLElement).textContent = `New run in ${s}s`;
  }

  /** Level progress for this run (filled once, at game over). */
  showXp(start: number, end: number, lines: readonly XpLine[]) {
    showXp(this.root.querySelector('.pg-xp') as HTMLElement, start, end, lines);
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.root.hidden = true;
  }

  dispose() {
    this.root.remove();
  }
}
