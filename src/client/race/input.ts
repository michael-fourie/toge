// Driving controls: a controller (analog triggers and stick, Forza-style buttons) and/or the keyboard,
// merged into one DriveInput. Keys are digital, so steering and pedals ramp instead of snapping.

import type { DriveInput } from '../../shared/race/vehicle.ts';
import { BTN, readPad } from '../pad.ts';

export type Action = 'camera' | 'reset' | 'pause' | 'shiftUp' | 'shiftDown';

export const KEY_HELP: [string, string][] = [
  ['W / ↑', 'Throttle'],
  ['S / ↓', 'Brake / reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake'],
  ['E / Q', 'Shift up / down (manual)'],
  ['C', 'Camera'],
  ['V (hold)', 'Look back'],
  ['R', 'Reset to road'],
  ['Esc', 'Pause'],
];

export const PAD_HELP: [string, string][] = [
  ['RT', 'Throttle'],
  ['LT', 'Brake / reverse'],
  ['Left stick', 'Steer'],
  ['Ⓐ', 'Handbrake'],
  ['Ⓑ / Ⓧ', 'Shift up / down (manual)'],
  ['Ⓨ', 'Camera'],
  ['LB (hold)', 'Look back'],
  ['View', 'Reset to road'],
  ['Menu', 'Pause'],
];

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
    const map: Record<string, Action> = { KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyE: 'shiftUp', KeyQ: 'shiftDown' };
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
    const rate = want === 0 || Math.sign(want) !== Math.sign(this.kSteer) ? 6 : 2.8;
    this.kSteer += Math.max(-rate * dt, Math.min(rate * dt, want - this.kSteer));
    const ramp = (cur: number, on: boolean) => Math.max(0, Math.min(1, cur + (on ? 5 : -8) * dt));
    this.kThrottle = ramp(this.kThrottle, k('KeyW', 'ArrowUp'));
    this.kBrake = ramp(this.kBrake, k('KeyS', 'ArrowDown'));
    let steer = this.kSteer;
    let throttle = this.kThrottle;
    let brake = this.kBrake;
    let handbrake = k('Space') ? 1 : 0;
    this.lookBack = k('KeyV');
    const pad = readPad();
    if (pad) {
      // A gentle curve: fine control near centre, full lock at the edge.
      const sx = Math.sign(pad.lx) * Math.abs(pad.lx) ** 1.6;
      if (Math.abs(sx) > Math.abs(steer)) steer = sx;
      throttle = Math.max(throttle, pad.rt);
      brake = Math.max(brake, pad.lt);
      if (pad.down[BTN.A]) handbrake = 1;
      if (pad.down[BTN.LB]) this.lookBack = true;
      const map: [number, Action][] = [
        [BTN.Y, 'camera'],
        [BTN.View, 'reset'],
        [BTN.Menu, 'pause'],
        [BTN.B, 'shiftUp'],
        [BTN.X, 'shiftDown'],
      ];
      for (const [b, a] of map) if (pad.pressed[b]) this.queued.push(a);
      if (pad.rt > 0.1 || pad.lt > 0.1 || Math.abs(pad.lx) > 0.2 || pad.pressed.some(Boolean)) this.padSeen = true;
    }
    const inp = this.input;
    inp.steer = steer;
    inp.throttle = throttle;
    inp.brake = brake;
    inp.handbrake = handbrake;
  }

  dispose() {
    removeEventListener('keydown', this.down);
    removeEventListener('keyup', this.up);
    removeEventListener('blur', this.blur);
  }
}
