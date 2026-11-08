// Driving controls: a controller (the usual racing layout: RT throttle, LT brake, Ⓐ held to drift) and/or
// the keyboard, merged into one DriveInput. Keys are digital, so steering and pedals ramp instead of snapping.

import type { DriveInput } from '../shared/vehicle.ts';
import { BTN, type Pad, readPad } from '../../client/pad.ts';

export type Action = 'camera' | 'reset' | 'pause' | 'shiftUp' | 'shiftDown' | 'spectate';

export const KEY_HELP: [string, string][] = [
  ['W / ↑', 'Accelerate'],
  ['S / ↓', 'Brake / reverse'],
  ['A D / ← →', 'Steer'],
  ['Space (hold)', 'Drift (let go for a boost)'],
  ['C', 'Camera'],
  ['V (hold)', 'Look back'],
  ['R', 'Reset to road'],
  ['Shift / Ctrl', 'Shift up / down (manual)'],
  ['Esc', 'Pause'],
];

export const PAD_HELP: [string, string][] = [
  ['RT', 'Accelerate'],
  ['LT', 'Brake / reverse'],
  ['Left stick', 'Steer'],
  ['Ⓐ (hold)', 'Drift (let go for a boost)'],
  ['Ⓨ', 'Camera'],
  ['LB (hold)', 'Look back'],
  ['View', 'Reset to road'],
  ['D-pad ↑ ↓', 'Shift (manual)'],
  ['Menu', 'Pause'],
];

/** A trigger's travel as a pedal: a small dead zone at rest, full a little before the stop (worn triggers). */
export function trigger(v: number): number {
  return Math.max(0, Math.min(1, (v - 0.04) / 0.9));
}

/**
 * The pedals and the drift button from a controller, laid out like every other racing game: RT throttle,
 * LT brake (analog, so you can trail off it into a corner), Ⓐ held to drift. Ⓑ brakes fully too.
 */
export function padPedals(pad: Pick<Pad, 'lt' | 'rt' | 'down'>): { throttle: number; brake: number; drift: number } {
  return {
    throttle: trigger(pad.rt),
    brake: pad.down[BTN.B] ? 1 : trigger(pad.lt),
    drift: pad.down[BTN.A] ? 1 : 0,
  };
}

export class DriveControls {
  readonly input: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  lookBack = false;
  /** True once a controller has been used (the HUD shows its button names). */
  padSeen = false;
  private keys = new Set<string>();
  private queued: Action[] = [];
  private kSteer = 0;
  private kThrottle = 0;
  private kBrake = 0;

  constructor() {
    addEventListener('keydown', this.down);
    addEventListener('keyup', this.up);
    addEventListener('blur', this.blur);
  }

  private down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    const map: Record<string, Action> = { KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyE: 'spectate', ShiftLeft: 'shiftUp', ControlLeft: 'shiftDown' };
    if (map[e.code]) this.queued.push(map[e.code]);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  };
  private up = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur = () => this.keys.clear();

  /** Actions pressed since the last call (camera, reset, pause, manual shifts). */
  actions(): Action[] {
    const a = this.queued;
    this.queued = [];
    return a;
  }

  /** Reads the keyboard and the controller into `input`; call once per frame. */
  poll(dt: number) {
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const right = k('KeyD', 'ArrowRight') ? 1 : 0;
    const left = k('KeyA', 'ArrowLeft') ? 1 : 0;
    const want = right - left;
    // Steering ramps in fast, and back to centre faster still.
    const rate = want === 0 || Math.sign(want) !== Math.sign(this.kSteer) ? 10 : 8;
    this.kSteer += Math.max(-rate * dt, Math.min(rate * dt, want - this.kSteer));
    const ramp = (cur: number, on: boolean, rise: number) => Math.max(0, Math.min(1, cur + (on ? rise : -10) * dt));
    // The throttle squeezes in (a stab of a digital key would only spin the wheels); the brake bites at once,
    // as a brake should, while ABS keeps a stamped pedal from locking up.
    this.kThrottle = ramp(this.kThrottle, k('KeyW', 'ArrowUp'), 5);
    this.kBrake = ramp(this.kBrake, k('KeyS', 'ArrowDown'), 14);
    let steer = this.kSteer;
    let throttle = this.kThrottle;
    let brake = this.kBrake;
    let drift = k('Space') ? 1 : 0;
    this.lookBack = k('KeyV');
    const pad = readPad();
    if (pad) {
      // Nearly linear: quick to react, still fine near centre.
      const sx = Math.sign(pad.lx) * Math.abs(pad.lx) ** 1.2;
      if (Math.abs(sx) > Math.abs(steer)) steer = sx;
      const pedals = padPedals(pad);
      throttle = Math.max(throttle, pedals.throttle);
      brake = Math.max(brake, pedals.brake);
      drift = Math.max(drift, pedals.drift);
      if (pad.down[BTN.LB]) this.lookBack = true;
      const map: [number, Action][] = [
        [BTN.Y, 'camera'],
        [BTN.View, 'reset'],
        [BTN.Menu, 'pause'],
        [BTN.X, 'spectate'],
        [BTN.RB, 'spectate'],
        [BTN.Up, 'shiftUp'],
        [BTN.Down, 'shiftDown'],
      ];
      for (const [b, a] of map) if (pad.pressed[b]) this.queued.push(a);
      if (pad.rt > 0.1 || pad.lt > 0.1 || Math.abs(pad.lx) > 0.2 || pad.pressed.some(Boolean)) this.padSeen = true;
    }
    const inp = this.input;
    inp.steer = steer;
    inp.throttle = throttle;
    inp.brake = brake;
    inp.handbrake = 0;
    inp.drift = drift;
  }

  dispose() {
    removeEventListener('keydown', this.down);
    removeEventListener('keyup', this.up);
    removeEventListener('blur', this.blur);
  }
}
