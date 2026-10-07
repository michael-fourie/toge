import { SURVIVAL } from '../shared/constants.ts';
import type { PunchStatus } from '../shared/punch.ts';

/** Which station you're standing at and whether you can buy from it. */
export interface Station {
  kind: 'punch' | 'jug';
  status: PunchStatus;
}
import './punch.css';

/** Survival points counter (bottom left, above health) and the station prompt (Pack-a-Punch / Juggernog, below the crosshair). Appends its own elements to the HUD root. */
export class PunchHud {
  private pts: HTMLElement;
  private prompt: HTMLElement;
  private lastPts = -1;
  private lastPrompt = '';

  constructor(root: HTMLElement) {
    this.pts = document.createElement('div');
    this.pts.className = 'points';
    this.pts.hidden = true;
    this.pts.innerHTML = '<b>0</b><small>pts</small>';
    this.prompt = document.createElement('div');
    this.prompt.className = 'punch-prompt';
    root.append(this.pts, this.prompt);
  }

  /** points: null hides the counter (Battle, practice). station: null (or status 'far') hides the prompt. */
  update(points: number | null, station: Station | null) {
    const status = station?.status ?? null;
    const jug = station?.kind === 'jug';
    this.pts.hidden = points === null;
    if (points !== null && points !== this.lastPts) {
      this.lastPts = points;
      this.pts.querySelector('b')!.textContent = String(points);
    }
    const name = jug ? 'Juggernog' : 'Pack-a-Punch';
    const price = jug ? SURVIVAL.jugPrice : SURVIVAL.punchPrice;
    const text =
      status === 'ready'
        ? `<kbd>F</kbd> ${name} <em>${price} pts</em>`
        : status === 'poor'
          ? `${name}: not enough points <em>${price} pts</em>`
          : status === 'owned'
            ? `Already ${jug ? 'Juggernogged' : 'Pack-a-Punched'}`
            : '';
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      this.prompt.innerHTML = text;
    }
    this.prompt.classList.toggle('show', !!text);
    this.prompt.classList.toggle('poor', status === 'poor' || status === 'owned');
  }
}
