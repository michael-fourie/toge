import type { MoveInput } from '../shared/movement.ts';
import { loadSettings } from './settings.ts';

/**
 * Keyboard + raw mouse via Pointer Lock. Look angles update immediately per mouse event
 * (not per tick), which is what makes aiming feel 1:1.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022 * loadSettings().sensitivity; // radians per mouse count, at 1x zoom
  sensitivityScale = 1; // reduced while scoped
  locked = false;

  /** Accumulated look delta since last read, for viewmodel sway. */
  lookDX = 0;
  lookDY = 0;

  private keys = new Set<string>();
  private jumpQueued = false;
  private grappleQueued = false;
  private grenadeQueued = false;
  private fireQueued = false;
  /** Right mouse button currently held (hold-to-scope). Cleared on blur / lock loss / death. */
  scopeHeld = false;
  private disposers: (() => void)[] = [];

  onLockChange?: (locked: boolean) => void;
  onKey?: (code: string, down: boolean) => void;

  constructor(private el: HTMLElement) {
    this.listen(document, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.jumpQueued = true;
        if (e.code === 'KeyE') this.grappleQueued = true;
        if (e.code === 'KeyQ') this.grenadeQueued = true;
        this.onKey?.(e.code, true);
      }
      this.keys.add(e.code);
    });
    this.listen(document, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      this.onKey?.(e.code, false);
    });
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.scopeHeld = false;
    });
    this.listen(document, 'mousemove', (e: MouseEvent) => {
      if (!this.locked) return;
      const k = this.sensitivity * this.sensitivityScale;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * k));
      this.lookDX += e.movementX * k;
      this.lookDY += e.movementY * k;
    });
    this.listen(document, 'mousedown', (e: MouseEvent) => {
      if (!this.locked) return;
      if (e.button === 0) this.fireQueued = true;
      if (e.button === 2) this.scopeHeld = true;
    });
    // Listen for the release even when unlocked so the scope can never get stuck on.
    this.listen(document, 'mouseup', (e: MouseEvent) => {
      if (e.button === 2) this.scopeHeld = false;
    });
    this.listen(document, 'contextmenu', (e: Event) => e.preventDefault());
    // Scroll-wheel jump, the bhopper's best friend.
    this.listen(
      document,
      'wheel',
      (e: WheelEvent) => {
        if (this.locked && e.deltaY > 0) this.jumpQueued = true;
      },
      { passive: true },
    );
    this.listen(document, 'pointerlockchange', () => {
      // The browser can re-announce a lock we already hold (e.g. when it's re-requested); that must not
      // release the movement keys, or every shot would drop W/A/D/Space and kill your momentum.
      const locked = document.pointerLockElement === this.el;
      if (locked === this.locked) return;
      this.locked = locked;
      this.keys.clear();
      this.scopeHeld = false;
      this.onLockChange?.(this.locked);
    });
  }

  private listen<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  async lock() {
    if (document.pointerLockElement === this.el) return; // already locked: re-requesting would reset the keys (and every click comes through here)
    try {
      // Raw input skips OS mouse acceleration where supported.
      await (this.el.requestPointerLock as (o?: object) => Promise<void>).call(this.el, { unadjustedMovement: true });
    } catch {
      try {
        await this.el.requestPointerLock();
      } catch {
        /* user gesture required; they'll click again */
      }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) {
    return this.locked && this.keys.has(code);
  }

  /** Builds the movement input for one sim tick. Edge-triggered jump is consumed by the first tick. */
  sample(out: MoveInput): MoveInput {
    out.forward = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
    out.right = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
    out.jumpPressed = this.jumpQueued && this.locked;
    out.jump = this.down('Space') || out.jumpPressed;
    out.slide = this.down('ShiftLeft') || this.down('ShiftRight');
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.grapplePressed = this.grappleQueued && this.locked;
    this.jumpQueued = false;
    this.grappleQueued = false;
    return out;
  }

  /** True once per Q press while locked (the game decides whether you have a grenade). */
  takeGrenade() {
    const q = this.grenadeQueued && this.locked;
    this.grenadeQueued = false;
    return q;
  }

  takeFire() {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }


  takeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.unlock();
  }
}
