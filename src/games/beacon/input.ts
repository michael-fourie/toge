// Keyboard + mouse (pointer lock) and controller, read once per rendered frame.
//
// Keys:  WASD / arrows move · Space jump · C or Q crouch/slide · Shift walk · R back to checkpoint · Esc pause
// Pad:   left stick move · right stick look · Ⓐ jump · Ⓑ or RB crouch/slide · Ⓧ back to checkpoint · Start pause

import type { GameApi } from '../types.ts';

export interface Frame {
  fwd: number;
  side: number;
  /** Look change this frame (radians). */
  yaw: number;
  pitch: number;
  jump: boolean;
  /** Jump went down since the last frame (even if it already came back up). */
  jumpTap: boolean;
  crouch: boolean;
  walk: boolean;
  respawn: boolean;
  pause: boolean;
}

const SENS_KEY = 'beacon.sens';
const LOOK = { mouse: 0.0022, stick: 3.2 };

export function loadSens(): number {
  try {
    const v = Number(localStorage.getItem(SENS_KEY));
    return v >= 0.2 && v <= 3 ? v : 1;
  } catch {
    return 1;
  }
}

export function saveSens(v: number) {
  try {
    localStorage.setItem(SENS_KEY, String(v));
  } catch {
    /* blocked storage: this visit only */
  }
}

export class Input {
  private held = new Set<string>();
  private taps = new Set<string>();
  private dx = 0;
  private dy = 0;
  private offs: (() => void)[] = [];
  sens = loadSens();
  /** Off while a menu is up: everything reads as idle. */
  enabled = true;

  constructor(
    private canvas: HTMLElement,
    private api: GameApi,
  ) {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      addEventListener(type, fn as EventListener);
      this.offs.push(() => removeEventListener(type, fn as EventListener));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.taps.add(e.code);
      this.held.add(e.code);
    });
    on('keyup', (e) => this.held.delete(e.code));
    on('blur', () => this.held.clear());
    on('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', noMenu);
    this.offs.push(() => canvas.removeEventListener('contextmenu', noMenu));
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

  poll(dt: number): Frame {
    const pad = this.api.readPad();
    const k = (codes: string[]) => (codes.some((c) => this.held.has(c)) ? 1 : 0);
    const tap = (codes: string[]) => codes.some((c) => this.taps.has(c));
    const pd = pad?.down ?? [];
    const pp = pad?.pressed ?? [];
    let fwd = k(['KeyW', 'ArrowUp']) - k(['KeyS', 'ArrowDown']);
    let side = k(['KeyD', 'ArrowRight']) - k(['KeyA', 'ArrowLeft']);
    if (pad && Math.hypot(pad.lx, pad.ly) > 0) {
      fwd = -pad.ly;
      side = pad.lx;
    }
    const f: Frame = {
      fwd,
      side,
      yaw: -this.dx * LOOK.mouse * this.sens - (pad?.rx ?? 0) * Math.abs(pad?.rx ?? 0) * LOOK.stick * this.sens * dt,
      pitch: -this.dy * LOOK.mouse * this.sens - (pad?.ry ?? 0) * Math.abs(pad?.ry ?? 0) * LOOK.stick * 0.75 * this.sens * dt,
      jump: !!k(['Space']) || !!pd[0],
      jumpTap: tap(['Space']) || !!pp[0],
      crouch: !!k(['KeyC', 'KeyQ', 'ControlLeft']) || !!pd[1] || !!pd[5],
      walk: !!k(['ShiftLeft', 'ShiftRight']),
      respawn: tap(['KeyR']) || !!pp[2],
      pause: !!pp[9],
    };
    this.dx = this.dy = 0;
    this.taps.clear();
    if (!this.enabled) return { ...f, fwd: 0, side: 0, yaw: 0, pitch: 0, jump: false, jumpTap: false, crouch: false, walk: false, respawn: false };
    return f;
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.unlock();
  }
}
