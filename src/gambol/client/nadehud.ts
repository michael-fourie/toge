import './nade.css';

const ICON = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect x="26" y="6" width="12" height="9" rx="2" fill="#d9a84e" stroke="#4a3726" stroke-width="2"/>
  <path d="M38 8 q12 -2 14 8" fill="none" stroke="#4a3726" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="32" cy="38" rx="19" ry="21" fill="#6f8f4a" stroke="#4a3726" stroke-width="3"/>
  <path d="M22 28 h20 M20 38 h24 M22 48 h20 M32 18 v40" stroke="#4a6a32" stroke-width="2.5" fill="none"/>
</svg>`;

/** Bottom-left grenade indicator: full colour when you have one; greyed out with a refilling ring while the next one comes. */
export class NadeHud {
  private el = document.createElement('div');
  private was = true;

  constructor(parent: HTMLElement) {
    this.el.className = 'nade ready';
    this.el.innerHTML = `<div class="nade-ring"></div><div class="nade-icon">${ICON}</div><kbd>Q</kbd><span class="nade-secs"></span>`;
    parent.appendChild(this.el);
  }

  /** `progress` 0..1 of the way to the next grenade (1 = in hand); `secondsLeft` shown while charging. `count`: Royale's grenades carried. */
  update(progress: number, secondsLeft: number, count?: number) {
    const ready = progress >= 1;
    this.el.style.setProperty('--p', String(Math.round(progress * 1000) / 10));
    this.el.classList.toggle('ready', ready);
    if (ready && !this.was) {
      this.el.classList.remove('pop'); // restart the little "got one" bounce
      void this.el.offsetWidth;
      this.el.classList.add('pop');
    }
    this.was = ready;
    this.el.querySelector('.nade-secs')!.textContent = count !== undefined ? `×${count}` : ready ? '' : Math.ceil(secondsLeft).toString();
  }

  dispose() {
    this.el.remove();
  }
}
