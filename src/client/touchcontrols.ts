import type { Input } from './input.ts';

// Fortnite-style phone controls, drawn over the HUD (phones only; see touch.ts):
//   left half    a floating joystick wherever your thumb lands (past halfway it's a full push, so air-strafing works)
//   right half   swipe to look
//   buttons      FIRE (also aims while you drag it) and a second FIRE on the left, jump, slide, scope, grapple,
//                grenade, reload, swap weapon, use (Survival), scores and pause
// Everything goes through Input as if it were the keyboard and mouse, so the game logic is the same on every device.

/** Screen pixels to mouse-count equivalents: a thumb swipe needs more turn per pixel than a mouse. */
const LOOK_GAIN = 2.2;
/** Joystick radius in px; past FULL of it the stick reads as fully pushed. */
const STICK_R = 56;
const FULL = 0.55;

type Act = 'fire' | 'jump' | 'slide' | 'scope' | 'grapple' | 'grenade' | 'reload' | 'swap' | 'use' | 'scores' | 'pause';

const ICON: Record<Act, string> = {
  fire: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  jump: `<svg viewBox="0 0 24 24"><path d="M5 14l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  slide: `<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  scope: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>`,
  grapple: `<svg viewBox="0 0 24 24"><path d="M12 3v11a4 4 0 1 1-4-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M9 6l3-3 3 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  grenade: '',
  reload: `<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.1-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M17.5 3v4.5H13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  swap: `<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  use: '<b>USE</b>',
  scores: `<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
};

interface Hooks {
  /** Next weapon: gun 1 -> gun 2 (if any) -> knife -> gun 1. */
  onSwap(): void;
}

type Grip = { kind: 'stick'; x0: number; y0: number } | { kind: 'look'; x: number; y: number } | { kind: 'button'; act: Act; x: number; y: number };

export class TouchControls {
  readonly root = document.createElement('div');
  private readonly grips = new Map<number, Grip>();
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private scoped = false;
  private scores = false;

  constructor(parent: HTMLElement, private readonly input: Input, private readonly hooks: Hooks) {
    this.root.className = 'touch-ui';
    const btn = (act: Act, extra = '') => `<button class="tbtn t-${act} ${extra}" data-act="${act}" aria-label="${act}">${ICON[act]}</button>`;
    this.root.innerHTML = `
      <div class="t-stick" hidden><i></i></div>
      ${btn('pause')}${btn('scores')}
      ${btn('fire', 'big')}${btn('fire', 't-fire2')}
      ${btn('jump')}${btn('slide')}${btn('scope')}${btn('grapple')}${btn('grenade')}
      ${btn('reload')}${btn('swap')}${btn('use')}`;
    parent.appendChild(this.root);
    this.stick = this.root.querySelector('.t-stick')!;
    this.knob = this.stick.querySelector('i')!;

    this.root.addEventListener('pointerdown', this.down);
    this.root.addEventListener('pointermove', this.move);
    this.root.addEventListener('pointerup', this.up);
    this.root.addEventListener('pointercancel', this.up);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Per frame: the use button only when there's something to use; the scope button shows when it's on. */
  update(canUse: boolean) {
    this.root.classList.toggle('can-use', canUse);
    this.root.classList.toggle('scoped', this.scoped);
  }

  /** Paused or dead: let go of everything so nothing sticks. */
  reset() {
    for (const [id] of this.grips) this.end(id);
    this.scoped = false;
    this.input.setScope(false);
    if (this.scores) this.toggleScores();
  }

  private readonly down = (e: PointerEvent) => {
    e.preventDefault(); // no mouse emulation, no scrolling or zoom
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (b) {
      const act = b.dataset.act as Act;
      this.grips.set(e.pointerId, { kind: 'button', act, x: e.clientX, y: e.clientY });
      b.classList.add('held');
      this.pressAct(act, true);
      return;
    }
    if (e.clientX < innerWidth * 0.42) {
      // Floating joystick: its base appears under the thumb.
      if ([...this.grips.values()].some((g) => g.kind === 'stick')) return;
      this.grips.set(e.pointerId, { kind: 'stick', x0: e.clientX, y0: e.clientY });
      this.stick.hidden = false;
      this.stick.style.transform = `translate(${e.clientX - STICK_R}px, ${e.clientY - STICK_R}px)`;
      this.knob.style.transform = '';
    } else this.grips.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
  };

  private readonly move = (e: PointerEvent) => {
    const g = this.grips.get(e.pointerId);
    if (!g) return;
    if (g.kind === 'stick') {
      const dx = (e.clientX - g.x0) / STICK_R;
      const dy = (e.clientY - g.y0) / STICK_R;
      const len = Math.hypot(dx, dy);
      const shown = Math.min(1, len);
      this.knob.style.transform = len ? `translate(${(dx / len) * shown * STICK_R}px, ${(dy / len) * shown * STICK_R}px)` : '';
      // Past FULL it's a full push in that direction, so strafing in the air gains speed like a key would.
      const mag = len >= FULL ? 1 : len / FULL;
      this.input.stick.x = len ? (dx / len) * mag : 0;
      this.input.stick.y = len ? (-dy / len) * mag : 0;
      return;
    }
    // Looking: the look area, and FIRE / SCOPE (aim while you hold them, like Fortnite).
    if (g.kind === 'look' || g.act === 'fire' || g.act === 'scope') {
      this.input.look((e.clientX - g.x) * LOOK_GAIN, (e.clientY - g.y) * LOOK_GAIN);
      g.x = e.clientX;
      g.y = e.clientY;
    }
  };

  private readonly up = (e: PointerEvent) => this.end(e.pointerId);

  private end(id: number) {
    const g = this.grips.get(id);
    if (!g) return;
    this.grips.delete(id);
    if (g.kind === 'stick') {
      this.stick.hidden = true;
      this.input.stick.x = this.input.stick.y = 0;
    } else if (g.kind === 'button') {
      // Release only once no other finger is holding the same button (two FIREs).
      if (![...this.grips.values()].some((o) => o.kind === 'button' && o.act === g.act)) {
        this.root.querySelectorAll(`[data-act="${g.act}"]`).forEach((b) => b.classList.remove('held'));
        this.pressAct(g.act, false);
      }
    }
  }

  private pressAct(act: Act, on: boolean) {
    const k = this.input.keymap;
    const key = (code: string) => (on ? this.input.press(code) : this.input.release(code));
    switch (act) {
      case 'fire':
        return this.input.setFire(on);
      case 'scope': // a toggle, like Fortnite's ADS button
        if (on) {
          this.scoped = !this.scoped;
          this.input.setScope(this.scoped);
        }
        return;
      case 'jump':
        return key(k.jump);
      case 'slide':
        return key(k.slide);
      case 'grapple':
        return key(k.grapple);
      case 'grenade':
        return key(k.grenade);
      case 'reload':
        return key(k.reload);
      case 'use':
        return key(k.use); // held: keeps repairing a window
      case 'swap':
        if (on) this.hooks.onSwap();
        return;
      case 'scores':
        if (on) this.toggleScores();
        return;
      case 'pause':
        if (on) this.input.unlock();
        return;
    }
  }

  private toggleScores() {
    this.scores = !this.scores;
    if (this.scores) this.input.press(this.input.keymap.scores);
    else this.input.release(this.input.keymap.scores);
  }

  dispose() {
    this.root.remove();
  }
}
