import { SURVIVAL } from '../shared/constants.ts';
import type { Use } from '../shared/interact.ts';
import './usehud.css';

/** Survival points counter (bottom left, above health) and the "press F" prompt (below the crosshair). Appends its own elements to the HUD root. */
export class UseHud {
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

  /** points: null hides the counter (Battle, practice). use: what F would do right now, or null. */
  update(points: number | null, use: Use | null) {
    this.pts.hidden = points === null;
    if (points !== null && points !== this.lastPts) {
      this.lastPts = points;
      this.pts.querySelector('b')!.textContent = String(points);
    }
    let text = '';
    if (use) {
      const price = use.price ? `<em>${use.price} pts</em>` : '';
      if (use.kind === 'board') text = `<kbd>F</kbd> hold to repair <em>+${SURVIVAL.repairPoints} pts a board</em>`;
      else if (use.status === 'ready') text = `<kbd>F</kbd> ${use.text} ${price}`;
      else if (use.status === 'poor') text = `${use.text}: not enough points ${price}`;
      else if (use.status === 'busy') text = `${use.text} is busy`;
      else text = use.text;
    }
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      this.prompt.innerHTML = text;
    }
    this.prompt.classList.toggle('show', !!text);
    this.prompt.classList.toggle('poor', !!use && use.status !== 'ready' && use.kind !== 'board');
  }
}
