// Keyboard + mouse (pointer lock) and controller, boiled down to one Frame per tick. The same keys mean different
// things in the driver's seat and at a window; the session reads what it needs.
//
// Driver:  W/S or RT/LT gas and brake (hold to reverse), A/D or left stick steer, Space or Ⓧ handbrake, H or LB horn.
// On foot: WASD or left stick walk round the bus, Space or Ⓑ at the hatch climb up or down,
//          mouse or right stick aim, click or RT fire, R or Ⓧ reload, V / right-click or RB swing the club.
// Driver:  mouse or right stick look round, C or View the chase camera.
// Anyone:  F or Ⓨ swap seats, E or Ⓐ use (the stop's minigame), Esc or Start pause.

import type { GameApi } from '../types.ts';

export interface Frame {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** Walking: forward and right, −1..1 (WASD or the left stick). */
  fwd: number;
  side: number;
  /** Space or Ⓑ: up or down the hatch ladder. */
  climb: boolean;
  /** Aim change this frame (radians). */
  yaw: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
  swing: boolean;
  use: boolean;
  seat: boolean;
  honk: boolean;
  pause: boolean;
  /** The driver's camera: in the cab or chasing the bus. */
  view: boolean;
  /** Minigames: the big button (Space, click, Ⓐ), and close (Ⓑ; Esc is handled by the session). */
  confirm: boolean;
  /** Minigames: the big button held (wind up a golf swing). */
  charge: boolean;
  back: boolean;
  /** Minigames' sideways nudge (A/D, arrows, left stick or d-pad). */
  nudge: number;
}

const LOOK = { mouse: 0.0024, stick: 2.6 };

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  private mouse = false;
  private click = false;
  private right = false;
  private offs: (() => void)[] = [];
  sens = 1;

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
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    on('keyup', (e) => this.held.delete(e.code));
    on('blur', () => {
      this.held.clear();
      this.mouse = false;
    });
    on('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    on('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouse = true;
        this.click = true;
      } else if (e.button === 2) this.right = true;
    });
    on('mouseup', (e) => e.button === 0 && (this.mouse = false));
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

  private any(keys: string[], set = this.held) {
    return keys.some((k) => set.has(k));
  }

  poll(dt: number): Frame {
    const pad = this.api.readPad();
    const pp = pad?.pressed ?? [];
    const pd = pad?.down ?? [];
    const key = (k: string[]) => (this.any(k) ? 1 : 0);
    let steer = key(['KeyD', 'ArrowRight']) - key(['KeyA', 'ArrowLeft']);
    if (pad && Math.abs(pad.lx) > 0) steer = pad.lx;
    const nudge = steer || (pd[15] ? 1 : 0) - (pd[14] ? 1 : 0);
    let fwd = key(['KeyW', 'ArrowUp']) - key(['KeyS', 'ArrowDown']);
    if (pad && Math.abs(pad.ly) > 0) fwd = -pad.ly;
    const f: Frame = {
      throttle: Math.max(key(['KeyW', 'ArrowUp']), pad?.rt ?? 0),
      brake: Math.max(key(['KeyS', 'ArrowDown']), pad?.lt ?? 0),
      steer,
      handbrake: this.any(['Space']) || !!pd[2],
      fwd,
      side: steer,
      climb: this.any(['Space'], this.pressed) || !!pp[1],
      yaw: -this.dx * LOOK.mouse * this.sens - (pad?.rx ?? 0) * LOOK.stick * dt,
      pitch: -this.dy * LOOK.mouse * this.sens - (pad?.ry ?? 0) * LOOK.stick * dt * 0.75,
      fire: this.mouse || (pad?.rt ?? 0) > 0.5,
      reload: this.any(['KeyR'], this.pressed) || !!pp[2],
      swing: this.any(['KeyV'], this.pressed) || this.right || !!pp[5],
      use: this.any(['KeyE'], this.pressed) || !!pp[0],
      seat: this.any(['KeyF'], this.pressed) || !!pp[3],
      honk: this.any(['KeyH']) || !!pd[4],
      pause: !!pp[9],
      view: this.any(['KeyC'], this.pressed) || !!pp[8],
      confirm: this.any(['Space', 'Enter'], this.pressed) || this.click || !!pp[0],
      charge: this.any(['Space', 'Enter']) || this.mouse || !!pd[0],
      back: !!pp[1],
      nudge,
    };
    this.dx = this.dy = 0;
    this.click = false;
    this.right = false;
    this.pressed.clear();
    return f;
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.unlock();
  }
}
