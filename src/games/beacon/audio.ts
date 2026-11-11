// Synthesised sound (no audio files): wind that rises with speed and height, the sea below, footsteps that
// sound like what you're running on, landings, wall runs, mantles, the checkpoint bell and the beacon's chord.

import type { Mat } from './move.ts';

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private sea!: GainNode;
  private noise!: AudioBuffer;
  private started = false;
  volume = 0.8;

  /** Browsers only allow sound after a click or key: call from one. */
  start() {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    this.started = true;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // Slightly pink: smoother wind and surf.
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = (Math.random() * 2 - 1) * 0.5 + b * 4;
    }
    const loop = (filter: BiquadFilterNode, gain: GainNode) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
    };
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    loop(this.windFilter, this.wind);
    const seaF = ctx.createBiquadFilter();
    seaF.type = 'lowpass';
    seaF.frequency.value = 380;
    this.sea = ctx.createGain();
    this.sea.gain.value = 0;
    loop(seaF, this.sea);
  }

  /** Per frame: wind from speed and height, surf that fades as you climb (and swells and ebbs). */
  ambience(speed: number, height: number, t: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const w = Math.min(0.5, 0.05 + speed * 0.022 + Math.min(1, height / 150) * 0.08);
    this.wind.gain.setTargetAtTime(w, now, 0.25);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 70 + Math.sin(t * 0.7) * 80, now, 0.3);
    const swell = 0.7 + Math.sin(t * 0.45) * 0.3;
    this.sea.gain.setTargetAtTime(Math.max(0.02, 0.32 - height / 300) * swell, now, 0.5);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private burst(freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, gain: number, dur: number, type: OscillatorType = 'sine', delay = 0, slide = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  footstep(mat: Mat | null, speed: number) {
    const k = Math.min(1, 0.35 + speed / 12);
    const v = 0.9 + Math.random() * 0.2;
    switch (mat) {
      case 'wood':
        this.burst(700 * v, 2.2, 0.32 * k, 0.09);
        this.tone(140 * v, 0.1 * k, 0.07);
        break;
      case 'steel':
        this.burst(2400 * v, 3, 0.2 * k, 0.06);
        this.tone(520 * v, 0.05 * k, 0.18, 'triangle');
        break;
      case 'rock':
      case 'moss':
        this.burst(1100 * v, 0.9, 0.26 * k, 0.07);
        this.burst(3800 * v, 1.2, 0.07 * k, 0.04);
        break;
      default:
        this.burst(1600 * v, 1.2, 0.26 * k, 0.06);
        this.burst(4200 * v, 1.5, 0.06 * k, 0.03);
    }
  }

  jump() {
    this.burst(900, 0.8, 0.12, 0.18);
  }

  land(impact: number, mat: Mat | null) {
    const k = Math.min(1, impact / 14);
    this.tone(90, 0.25 * k + 0.05, 0.16, 'sine', 0, 0.6);
    this.burst(400, 0.7, 0.35 * k + 0.08, 0.14, 'lowpass');
    this.footstep(mat, 6);
  }

  slide() {
    this.burst(1800, 0.5, 0.18, 0.6, 'bandpass');
  }

  wallrun() {
    this.burst(1300, 1, 0.16, 0.12);
  }

  walljump() {
    this.burst(1500, 1, 0.22, 0.08);
    this.burst(700, 0.8, 0.16, 0.25);
  }

  mantle() {
    this.burst(2200, 1.4, 0.18, 0.05);
    this.burst(800, 0.6, 0.14, 0.3, 'bandpass', 0.08);
  }

  checkpoint() {
    this.tone(659, 0.18, 1.6, 'sine');
    this.tone(988, 0.1, 1.9, 'sine', 0.05);
    this.tone(1318, 0.05, 2.2, 'sine', 0.1);
    this.burst(300, 0.5, 0.3, 0.9, 'lowpass', 0.05);
  }

  /** The beacon lights: a slow major chord. */
  finish() {
    [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, 0.12, 4.5, 'triangle', i * 0.12));
    this.burst(200, 0.4, 0.4, 2.5, 'lowpass');
  }

  splash() {
    this.burst(600, 0.4, 0.5, 1.2, 'lowpass');
    this.burst(2500, 0.6, 0.15, 0.6);
  }

  gull() {
    const d = Math.random() * 0.3;
    this.tone(1500 + Math.random() * 400, 0.025, 0.35, 'sawtooth', d, 0.6);
    this.tone(1700 + Math.random() * 300, 0.02, 0.25, 'sawtooth', d + 0.4, 0.55);
  }

  countdown(go: boolean) {
    this.tone(go ? 880 : 440, 0.15, go ? 0.5 : 0.18, 'square');
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
