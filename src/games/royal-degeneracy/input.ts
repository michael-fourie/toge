// Keyboard, mouse (pointer lock) and controller, boiled down to one Frame per tick. Crouch is C (and Ctrl, but
// Ctrl+W closes the tab, so C is the one we show).

import type { GameApi } from '../types.ts';

export interface Frame {
  fwd: number;
  side: number;
  /** Look change this frame, radians. */
  yaw: number;
  pitch: number;
  jump: boolean;
  crouch: boolean;
  /** Pressed this frame. */
  use: boolean;
  useHeld: boolean;
  kill: boolean;
  torch: boolean;
  shove: boolean;
  pause: boolean;
  phone: boolean;
  /** R / LB: the Degenerates' key (tap: plant, hold on a clue: wipe). */
  alt: boolean;
  altHeld: boolean;
  /** Raw pointer movement (px) and clicks, for chore minigames' cursor. */
  mx: number;
  my: number;
  click: boolean;
  clickHeld: boolean;
  /** Key codes pressed this frame (chores read arrows and digits). */
  keys: Set<string>;
  /** Pad buttons pressed this frame. */
  pad: boolean[];
}

const LOOK = { mouse: 0.0022, stick: 2.8 };

const BIND = {
  fwd: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  use: ['KeyE'],
  torch: ['KeyT'],
  shove: ['KeyV'],
  phone: ['Tab'],
  alt: ['KeyR'],
};

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  private click = false;
  private mouseDown = false;
  private offs: (() => void)[] = [];
  /** Mouse sensitivity multiplier (settings). */
  sens = 1;
  /** Without pointer lock (meetings), dragging on the view still looks around. */
  dragLook = false;

  constructor(
    private canvas: HTMLElement,
    private api: GameApi,
  ) {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => removeEventListener(type, fn as EventListener, opts));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    on('keyup', (e) => this.held.delete(e.code));
    on('blur', () => this.held.clear());
    on('mousemove', (e) => {
      if (!this.locked && !(this.dragLook && e.buttons & 1 && e.target === this.canvas)) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    on('mousedown', (e) => {
      if (e.button !== 0 || !this.locked) return;
      this.click = true;
      this.mouseDown = true;
    });
    on('mouseup', (e) => e.button === 0 && (this.mouseDown = false));
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* needs a click first */
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  private any(keys: string[], set = this.held) {
    return keys.some((k) => set.has(k));
  }

  /** Everything since the last poll. */
  poll(dt: number): Frame {
    const pad = this.api.readPad();
    const pp = pad?.pressed ?? [];
    const pd = pad?.down ?? [];
    let fwd = (this.any(BIND.fwd) ? 1 : 0) - (this.any(BIND.back) ? 1 : 0);
    let side = (this.any(BIND.right) ? 1 : 0) - (this.any(BIND.left) ? 1 : 0);
    if (pad && (Math.abs(pad.lx) > 0 || Math.abs(pad.ly) > 0)) {
      fwd = -pad.ly;
      side = pad.lx;
    }
    const f: Frame = {
      fwd,
      side,
      yaw: -this.dx * LOOK.mouse * this.sens - (pad?.rx ?? 0) * LOOK.stick * dt,
      pitch: -this.dy * LOOK.mouse * this.sens - (pad?.ry ?? 0) * LOOK.stick * dt * 0.8,
      jump: this.any(BIND.jump) || !!pd[0],
      crouch: this.any(BIND.crouch) || !!pd[1],
      use: this.any(BIND.use, this.pressed) || !!pp[2],
      useHeld: this.any(BIND.use) || !!pd[2],
      kill: this.click || !!pp[7],
      torch: this.any(BIND.torch, this.pressed) || !!pp[12],
      shove: this.any(BIND.shove, this.pressed) || !!pp[11],
      pause: !!pp[9],
      phone: this.any(BIND.phone, this.pressed) || !!pp[8],
      alt: this.any(BIND.alt, this.pressed) || !!pp[4],
      altHeld: this.any(BIND.alt) || !!pd[4],
      mx: this.dx + (pad?.lx ?? 0) * 600 * dt,
      my: this.dy + (pad?.ly ?? 0) * 600 * dt,
      click: this.click || !!pp[0],
      clickHeld: this.mouseDown || !!pd[0],
      keys: new Set(this.pressed),
      pad: pp,
    };
    this.dx = this.dy = 0;
    this.click = false;
    this.pressed.clear();
    return f;
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.unlock();
  }
}
