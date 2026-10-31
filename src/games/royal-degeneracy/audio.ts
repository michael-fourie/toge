// WebAudio synth sounds (no files), positioned in 3D. Sound is the radar: footsteps per surface, doors, the bonk,
// the pot-and-spoon bell, ghosts' rattles. Anything behind a wall or on another floor is muffled (a low-pass and
// a drop in level), so you can tell "someone's upstairs" from "someone's right behind me".

import type { Mat } from './house.ts';
import type { Vec3 } from '../../shared/math.ts';

export type Sound = 'door' | 'bonk' | 'bell' | 'oof' | 'rattle' | 'ding' | 'evict' | 'horn' | 'click' | 'fail' | 'toboggan' | 'slap' | 'buzz';

/** 0 = clear line, 1 = through a wall, 2 = through a floor too. */
export type Muffle = 0 | 1 | 2;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.8;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a click or key so browsers let sound start. */
  wake() {
    this.ensure();
  }

  setListener(p: Vec3, yaw: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** The chain a sound plays into: muffle filter → panner (or straight out for UI sounds). */
  private out(at: Vec3 | null, muffle: Muffle, gain: number): AudioNode | null {
    const ctx = this.ensure();
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    g.gain.value = gain * (muffle === 2 ? 0.35 : muffle === 1 ? 0.6 : 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muffle === 2 ? 450 : muffle === 1 ? 1100 : 12000;
    g.connect(lp);
    if (at) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.5;
      p.rolloffFactor = 1.3;
      p.maxDistance = 40;
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
      lp.connect(p);
      p.connect(this.master);
    } else lp.connect(this.master);
    return g;
  }

  private burst(dst: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dst);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(dst: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dst);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** One footstep on a surface. `loud` 0..1 (walking ~0.6; crouching never calls this). */
  step(at: Vec3, surface: Mat, muffle: Muffle, loud = 0.6) {
    const dst = this.out(at, muffle, loud);
    if (!dst) return;
    const t = this.ctx!.currentTime;
    switch (surface) {
      case 'tile':
      case 'lino':
        this.burst(dst, t, 0.05, 'highpass', 1800, 0.7, 0.5);
        break;
      case 'grass':
      case 'path':
        this.burst(dst, t, 0.09, 'lowpass', 700, 0.5, 0.45);
        break;
      case 'stair':
        this.burst(dst, t, 0.07, 'bandpass', 500, 1.2, 0.8);
        // The creaky stair.
        if (Math.random() < 0.3) this.tone(dst, t + 0.02, 0.25, 'sawtooth', 320, 210, 0.05);
        break;
      default:
        this.burst(dst, t, 0.07, 'bandpass', 900, 1, 0.65);
    }
  }

  play(s: Sound, at: Vec3 | null = null, muffle: Muffle = 0) {
    const dst = this.out(at, muffle, 1);
    if (!dst) return;
    const t = this.ctx!.currentTime;
    switch (s) {
      case 'door':
        this.tone(dst, t, 0.35, 'sawtooth', 240, 170, 0.04);
        this.burst(dst, t + 0.3, 0.12, 'lowpass', 300, 0.8, 0.9);
        break;
      case 'bonk':
        this.tone(dst, t, 0.18, 'sine', 700, 110, 0.9);
        this.burst(dst, t, 0.15, 'lowpass', 400, 1, 1);
        this.tone(dst, t + 0.12, 0.4, 'triangle', 300, 520, 0.25);
        break;
      case 'bell':
        for (let i = 0; i < 3; i++)
          for (const [f, a] of [
            [520, 0.35],
            [1310, 0.2],
            [2230, 0.12],
          ])
            this.tone(dst, t + i * 0.28, 1.1, 'sine', f, f * 0.98, a);
        break;
      case 'oof':
        this.tone(dst, t, 0.22, 'sawtooth', 210, 120, 0.15);
        this.burst(dst, t, 0.18, 'bandpass', 650, 3, 0.35);
        break;
      case 'rattle':
        this.tone(dst, t, 0.06, 'square', 2400, 2300, 0.08);
        this.tone(dst, t + 0.09, 0.06, 'square', 2900, 2800, 0.06);
        this.burst(dst, t + 0.2, 0.2, 'lowpass', 500, 1, 0.7);
        this.tone(dst, t + 0.25, 0.6, 'sawtooth', 190, 140, 0.04);
        break;
      case 'ding':
        this.tone(dst, t, 0.25, 'sine', 880, 880, 0.3);
        this.tone(dst, t + 0.12, 0.4, 'sine', 1320, 1320, 0.3);
        break;
      case 'evict':
        this.burst(dst, t, 2.5, 'highpass', 3000, 0.3, 0.25);
        this.burst(dst, t + 0.8, 0.2, 'lowpass', 200, 1, 1);
        break;
      case 'horn':
        this.tone(dst, t, 0.9, 'sawtooth', 220, 210, 0.12);
        this.tone(dst, t, 0.9, 'sawtooth', 277, 265, 0.1);
        break;
      case 'click':
        this.tone(dst, t, 0.04, 'square', 1200, 900, 0.06);
        break;
      case 'fail':
        this.tone(dst, t, 0.25, 'square', 200, 120, 0.1);
        break;
      case 'toboggan':
        // Concrete on hardwood: a long grinding roar.
        this.burst(dst, t, 2.6, 'lowpass', 380, 0.8, 1.4);
        this.tone(dst, t, 2.6, 'sawtooth', 70, 55, 0.12);
        break;
      case 'slap':
        this.burst(dst, t, 0.08, 'highpass', 1500, 0.8, 1);
        this.tone(dst, t + 0.05, 0.3, 'sine', 990, 1480, 0.15);
        break;
      case 'buzz':
        for (let i = 0; i < 2; i++) this.tone(dst, t + i * 0.18, 0.12, 'square', 150, 150, 0.06);
        break;
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
