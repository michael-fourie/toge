// Watching a track record from the leaderboard (2026-11-20, Andrew: "make the track record clickable on the leaderboard
// to replay the run and spectate the run"): the overlay over racegame.ts's watch mode. The record holder, their car and
// time, the run's clock and speed, a bar to scrub along, play / pause, playback speed, the camera and Back. Styles:
// `.rw` in race.css. The race drives it: `update` every frame, the callbacks when something is pressed.

import { CARS, decodeCar } from '../shared/cars.ts';
import type { GhostRun } from '../shared/ghost.ts';
import { esc } from '../../client/menu/ui.ts';
import { fmtTime } from './hud.ts';

/** Playback speeds, slowest first (1 is real time). */
export const WATCH_RATES = [0.25, 0.5, 1, 2, 4] as const;
/** How far ← / → jump (s). */
export const WATCH_SEEK = 5;

export interface WatchHandlers {
  toggle(): void;
  restart(): void;
  seek(t: number): void;
  rate(dir: 1 | -1): void;
  camera(): void;
  exit(): void;
}

export interface WatchFrame {
  /** Seconds into the run. */
  t: number;
  /** Speed (m/s). */
  speed: number;
  paused: boolean;
  rate: number;
  cam: string;
  /** Past the finish: the run is over. */
  over: boolean;
}

export class WatchUi {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private last = '';
  private dragging = false;

  constructor(
    container: HTMLElement,
    private run: GhostRun,
    trackName: string,
    private h: WatchHandlers,
  ) {
    const car = decodeCar(run.car);
    this.root = document.createElement('div');
    this.root.className = 'rw';
    // (The holder's name is a player's: escaped.)
    this.root.innerHTML = `
      <header class="rw-card">
        <span class="rw-tag">Track record · replay</span>
        <b class="rw-name">${esc(run.name)}</b>
        <small>${esc(trackName)}${car ? ` · ${esc(CARS[car.model].name)}` : ''} · <span class="rw-num">${fmtTime(run.time)}</span></small>
      </header>
      <div class="rw-over" data-el="over" hidden>
        <b>Run complete</b><span class="rw-num">${fmtTime(run.time)}</span>
        <div><button class="rw-btn" data-act="restart">Watch again</button><button class="rw-btn alt" data-act="exit">Back to the leaderboard</button></div>
      </div>
      <div class="rw-bar">
        <button class="rw-btn icon" data-act="toggle" data-el="play" aria-label="Pause"></button>
        <button class="rw-btn icon" data-act="restart" aria-label="From the start">⟲</button>
        <span class="rw-num rw-clock" data-el="clock">0:00.000</span>
        <div class="rw-scrub" data-el="scrub" role="slider" aria-label="Replay position" aria-valuemin="0" aria-valuemax="${run.time.toFixed(1)}" tabindex="0">
          <i data-el="fill"></i><b data-el="knob"></b>
        </div>
        <span class="rw-num rw-speed" data-el="speed">0 km/h</span>
        <span class="rw-rate"><button class="rw-btn icon" data-act="slower" aria-label="Slower">−</button><b class="rw-num" data-el="rate">1×</b><button class="rw-btn icon" data-act="faster" aria-label="Faster">+</button></span>
        <button class="rw-btn" data-act="camera">Camera: <b data-el="cam"></b></button>
        <button class="rw-btn alt" data-act="exit">Back</button>
      </div>
      <p class="rw-keys">Space pause · ← → ${WATCH_SEEK} s · − + speed · C camera · R restart · Esc back</p>`;
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[e.dataset.el!] = e;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act]'))
      b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'toggle') h.toggle();
        else if (a === 'restart') h.restart();
        else if (a === 'slower') h.rate(-1);
        else if (a === 'faster') h.rate(1);
        else if (a === 'camera') h.camera();
        else if (a === 'exit') h.exit();
        b.blur(); // so Space and the arrows go back to the replay, not the last button pressed
      });
    // Scrub: press or drag along the bar.
    const scrub = this.el.scrub;
    const at = (e: PointerEvent) => {
      const r = scrub.getBoundingClientRect();
      h.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * run.time);
    };
    scrub.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      scrub.setPointerCapture(e.pointerId);
      at(e);
    });
    scrub.addEventListener('pointermove', (e) => this.dragging && at(e));
    scrub.addEventListener('pointerup', () => (this.dragging = false));
    scrub.addEventListener('pointercancel', () => (this.dragging = false));
    addEventListener('keydown', this.onKey);
    container.appendChild(this.root);
  }

  /** Keys the race's own controls don't have (Space, the arrows, − / +). C, R and Esc come through its actions. */
  private onKey = (e: KeyboardEvent) => {
    if (e.repeat && e.code === 'Space') return;
    const k = e.code;
    if (k === 'Space') this.h.toggle();
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const now = Number(this.el.scrub.dataset.t ?? 0);
      this.h.seek(Math.max(0, Math.min(this.run.time, now + (k === 'ArrowLeft' ? -WATCH_SEEK : WATCH_SEEK))));
    } else if (k === 'Minus' || k === 'NumpadSubtract' || k === 'BracketLeft') this.h.rate(-1);
    else if (k === 'Equal' || k === 'NumpadAdd' || k === 'BracketRight') this.h.rate(1);
    else return;
    e.preventDefault();
  };

  update(f: WatchFrame) {
    const t = Math.max(0, Math.min(this.run.time, f.t));
    const k = this.run.time > 0 ? t / this.run.time : 0;
    this.el.fill.style.width = `${(k * 100).toFixed(2)}%`;
    this.el.knob.style.left = `${(k * 100).toFixed(2)}%`;
    this.el.scrub.dataset.t = String(t);
    this.el.clock.textContent = fmtTime(t);
    this.el.speed.textContent = `${Math.round(f.speed * 3.6)} km/h`;
    // Only touch what changed: this runs every frame.
    const key = `${f.paused}|${f.rate}|${f.cam}|${f.over}`;
    if (key === this.last) return;
    this.last = key;
    this.el.play.textContent = f.paused || f.over ? '▶' : '❚❚';
    this.el.play.setAttribute('aria-label', f.paused || f.over ? 'Play' : 'Pause');
    this.el.rate.textContent = `${f.rate}×`;
    this.el.cam.textContent = f.cam;
    this.el.scrub.setAttribute('aria-valuenow', t.toFixed(1));
    this.el.over.hidden = !f.over;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
