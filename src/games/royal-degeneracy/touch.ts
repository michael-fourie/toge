// Phones and tablets: a floating stick on the left, swipe to look on the right, and buttons for everything else.
// They drive Input's touch methods (the same keys and clicks the keyboard and mouse make), so the game itself
// doesn't know the difference. Landscape only: a portrait phone gets a "turn it sideways" card (royal.css).

import type { Input } from './input.ts';

export const IS_TOUCH =
  typeof matchMedia === 'function' && (matchMedia('(hover: none) and (pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** [label, key code, held (vs tapped)] — 'click' is the mouse button (take out). */
const BUTTONS: [string, string, boolean, string][] = [
  ['E', 'KeyE', true, 'use'],
  ['⤒', 'Space', true, 'jump'],
  ['⤓', 'KeyC', true, 'crouch'],
  ['Q', 'KeyQ', false, 'ability'],
  ['✊', 'click', true, 'kill'],
];
const SMALL: [string, string][] = [
  ['📱', 'Tab'],
  ['🔦', 'KeyT'],
  ['🫸', 'KeyV'],
  ['😀', 'KeyG'],
  ['🔥', 'KeyL'],
  ['⬇', 'KeyX'],
  ['R', 'KeyR'],
  ['⏸', 'Escape'],
];
const STICK = 60;

export class TouchControls {
  readonly root = el('div', 'rd-touchpad');
  private stick = el('div', 'rd-stick');
  private knob = el('div', 'rd-knob');
  private killBtn: HTMLElement;
  private rBtn: HTMLElement;
  private stickId: number | null = null;
  private stickAt = { x: 0, y: 0 };
  private look = new Map<number, { x: number; y: number; moved: number; t: number }>();
  /** Set by the night: taps on the view are clicks (in a chore, rolling a joint). */
  tapsClick = false;

  constructor(
    parent: HTMLElement,
    private input: Input,
    private onPause: () => void,
  ) {
    this.stick.append(this.knob);
    const look = el('div', 'rd-lookzone');
    const pads = el('div', 'rd-tbuttons');
    for (const [label, code, hold, cls] of BUTTONS) {
      const b = el('button', `rd-tbtn ${cls}`, label);
      this.bind(b, code, hold);
      pads.append(b);
    }
    const small = el('div', 'rd-tsmall');
    for (const [label, code] of SMALL) {
      const b = el('button', 'rd-tbtn small', label);
      if (code === 'Escape') b.addEventListener('touchstart', (e) => (e.preventDefault(), this.onPause()), { passive: false });
      else this.bind(b, code, code === 'KeyR' || code === 'KeyL' || code === 'KeyG');
      small.append(b);
    }
    this.killBtn = pads.querySelector('.kill')!;
    this.rBtn = [...small.children].find((b) => b.textContent === 'R') as HTMLElement;
    this.root.append(look, this.stick, pads, small);
    parent.append(this.root);
    // The left half moves (the stick appears under your thumb); the rest looks around.
    look.addEventListener('touchstart', this.start, { passive: false });
    look.addEventListener('touchmove', this.move, { passive: false });
    look.addEventListener('touchend', this.end);
    look.addEventListener('touchcancel', this.end);
    this.setEvil(false);
  }

  private bind(b: HTMLElement, code: string, hold: boolean) {
    b.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        b.classList.add('down');
        this.input.touchButton(code, true);
        if (!hold) this.input.touchButton(code, false);
      },
      { passive: false },
    );
    const up = () => {
      b.classList.remove('down');
      if (hold) this.input.touchButton(code, false);
    };
    b.addEventListener('touchend', up);
    b.addEventListener('touchcancel', up);
  }

  private start = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickAt = { x: t.clientX, y: t.clientY };
        this.stick.style.display = 'block';
        this.stick.style.left = `${t.clientX - STICK}px`;
        this.stick.style.top = `${t.clientY - STICK}px`;
        this.knob.style.transform = 'translate(0, 0)';
      } else this.look.set(t.identifier, { x: t.clientX, y: t.clientY, moved: 0, t: performance.now() });
    }
  };

  private move = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickAt.x;
        let dy = t.clientY - this.stickAt.y;
        const l = Math.hypot(dx, dy);
        if (l > STICK) {
          dx *= STICK / l;
          dy *= STICK / l;
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.input.touchStick(-dy / STICK, dx / STICK);
        continue;
      }
      const l = this.look.get(t.identifier);
      if (!l) continue;
      const dx = t.clientX - l.x;
      const dy = t.clientY - l.y;
      l.moved += Math.hypot(dx, dy);
      l.x = t.clientX;
      l.y = t.clientY;
      this.input.touchLook(dx, dy);
    }
  };

  private end = (e: TouchEvent) => {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.style.display = 'none';
        this.input.touchStick(0, 0);
        continue;
      }
      const l = this.look.get(t.identifier);
      this.look.delete(t.identifier);
      // A quick tap on the view is a click in a minigame.
      if (l && this.tapsClick && l.moved < 12 && performance.now() - l.t < 300) {
        this.input.touchButton('click', true);
        this.input.touchButton('click', false);
      }
    }
  };

  /** The Degenerates' buttons only show for Degenerates. */
  setEvil(on: boolean) {
    this.killBtn.style.display = on ? '' : 'none';
    this.rBtn.style.display = on ? '' : 'none';
  }

  setVisible(on: boolean) {
    this.root.style.display = on ? '' : 'none';
    if (!on) {
      this.stickId = null;
      this.stick.style.display = 'none';
      this.input.touchStick(0, 0);
    }
  }

  dispose() {
    this.root.remove();
  }
}
