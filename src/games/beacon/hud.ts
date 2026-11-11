// The heads-up display: the climb clock, the checkpoint you're on, the height bar with every climber on it, a feed
// of other climbers' checkpoints, the countdown, controls, and the results when someone lights the beacon. Plain
// DOM; names only ever go in through textContent.

import { clock } from './net.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export interface BarMark {
  id: number;
  share: number;
  color: string;
  me: boolean;
  name: string;
}

export class Hud {
  readonly root = el('div', 'bc-hud');
  private time = el('div', 'bc-time');
  private where = el('div', 'bc-where');
  private bar = el('div', 'bc-bar');
  private marks = new Map<number, HTMLElement>();
  private feed = el('div', 'bc-feed');
  private center = el('div', 'bc-center');
  private hints = el('div', 'bc-hints');
  private speed = el('div', 'bc-speed');
  private fadeEl = el('div', 'bc-fade');
  private results = el('div', 'bc-results');
  private cross = el('div', 'bc-cross');
  private centerT = 0;

  constructor(parent: HTMLElement, checkpoints: number[]) {
    const top = el('div', 'bc-top');
    top.append(this.time, this.where);
    const track = el('div', 'bc-track');
    for (const s of checkpoints) {
      const t = el('i', 'bc-tick');
      t.style.bottom = `${s * 100}%`;
      track.append(t);
    }
    const flame = el('b', 'bc-flame', '✦');
    this.bar.append(flame, track);
    this.hints.append(
      ...[
        ['WASD', 'run'],
        ['Space', 'jump'],
        ['C', 'slide / crouch'],
        ['Shift', 'walk'],
        ['R', 'back to checkpoint'],
      ].map(([k, v]) => {
        const row = el('span');
        row.append(el('kbd', '', k), ` ${v}`);
        return row;
      }),
      el('em', '', 'Run along a wall to wall-run. Jump into a wall to climb it. Grab ledges by running into them.'),
    );
    this.results.hidden = true;
    this.root.append(top, this.bar, this.feed, this.center, this.hints, this.speed, this.cross, this.results, this.fadeEl);
    parent.append(this.root);
  }

  setTime(ms: number | null) {
    this.time.textContent = ms === null ? '' : clock(ms);
  }

  setWhere(text: string) {
    if (this.where.textContent !== text) this.where.textContent = text;
  }

  setSpeed(ms: number) {
    this.speed.textContent = ms > 0.5 ? `${ms.toFixed(1)} m/s` : '';
  }

  setHints(on: boolean) {
    this.hints.classList.toggle('off', !on);
  }

  /** Climbers on the height bar. */
  setBar(list: BarMark[]) {
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.id);
      let e = this.marks.get(m.id);
      if (!e) {
        e = el('span', 'bc-mark');
        e.title = m.name;
        this.bar.querySelector('.bc-track')!.append(e);
        this.marks.set(m.id, e);
      }
      e.classList.toggle('me', m.me);
      e.style.bottom = `${m.share * 100}%`;
      e.style.background = m.color;
    }
    for (const [id, e] of this.marks)
      if (!seen.has(id)) {
        e.remove();
        this.marks.delete(id);
      }
  }

  toast(parts: (string | { name: string; color: string })[]) {
    const row = el('div', 'bc-toast');
    for (const p of parts) {
      if (typeof p === 'string') row.append(p);
      else {
        const b = el('b', '', p.name);
        b.style.color = p.color;
        row.append(b);
      }
    }
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('old'), 5000);
    setTimeout(() => row.remove(), 6000);
  }

  /** Big centre text for a moment (checkpoint names, the countdown). */
  announce(big: string, small = '', secs = 2.2) {
    this.center.replaceChildren(el('div', 'big', big), el('div', 'small', small));
    this.center.classList.add('on');
    this.centerT = secs;
  }

  tick(dt: number) {
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.center.classList.remove('on');
    }
  }

  fade(a: number) {
    this.fadeEl.style.opacity = String(a);
  }

  /** The results card (null hides it). */
  showResults(rows: { name: string; color: string; ms: number | null; me: boolean }[] | null, title = 'The light is lit') {
    if (!rows) {
      this.results.hidden = true;
      return;
    }
    this.results.hidden = false;
    this.results.replaceChildren(el('h2', '', title));
    const list = el('ol');
    for (const r of rows) {
      const li = el('li', r.me ? 'me' : '');
      const dot = el('i');
      dot.style.background = r.color;
      li.append(dot, el('span', 'n', r.name), el('span', 't', r.ms === null ? 'climbing…' : clock(r.ms)));
      list.append(li);
    }
    this.results.append(list, el('p', '', 'Keep exploring, or press Esc for the menu.'));
  }

  dispose() {
    this.root.remove();
  }
}
