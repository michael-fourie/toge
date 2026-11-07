// Every sound is synthesised (no audio files): paintball pops, splats, the bus horn, the engine's drone, zombie
// groans, YEET whooshes, the slot machine and the golf swing.

export type Sound = 'pop' | 'splat' | 'horn' | 'yeet' | 'fore' | 'groan' | 'cash' | 'fix' | 'reels' | 'win' | 'swing' | 'thunk' | 'bump' | 'jingle' | 'reload' | 'lose';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private hornOn: { a: OscillatorNode; b: OscillatorNode; gain: GainNode } | null = null;

  /** Browsers only start audio after a click or key press. */
  wake() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  private tone(t: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, freq: number, q: number, vol: number) {
    const c = this.ctx!;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  /** `vol` 0-1 scales it (distance). */
  play(s: Sound, vol = 1) {
    if (!this.ctx || !this.master || vol <= 0.01) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, vol);
    switch (s) {
      case 'pop':
        this.noise(t, 0.06, 1800, 1.5, 0.35 * v);
        this.tone(t, 0.05, 'square', 220, 90, 0.08 * v);
        break;
      case 'splat':
        this.noise(t, 0.12, 600, 0.8, 0.4 * v);
        break;
      case 'yeet':
        this.tone(t, 0.45, 'sawtooth', 300, 1400, 0.12 * v);
        this.noise(t, 0.3, 2500, 0.6, 0.2 * v);
        break;
      case 'fore':
        this.noise(t, 0.05, 3000, 2, 0.5 * v);
        this.tone(t, 0.08, 'square', 900, 300, 0.2 * v);
        break;
      case 'groan':
        this.tone(t, 0.9, 'sawtooth', 110 + Math.random() * 40, 70, 0.07 * v);
        break;
      case 'cash':
        this.tone(t, 0.12, 'square', 1320, 1320, 0.08 * v);
        this.tone(t + 0.1, 0.25, 'square', 1760, 1760, 0.08 * v);
        break;
      case 'fix':
        this.tone(t, 0.3, 'triangle', 400, 900, 0.15 * v);
        break;
      case 'reels':
        for (let k = 0; k < 8; k++) this.tone(t + k * 0.07, 0.04, 'square', 600 + k * 40, 600 + k * 40, 0.05 * v);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(t + k * 0.1, 0.25, 'triangle', f, f, 0.15 * v));
        break;
      case 'jingle':
        [392, 523, 659, 784, 659, 1047].forEach((f, k) => this.tone(t + k * 0.13, 0.3, 'triangle', f, f, 0.16 * v));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, k) => this.tone(t + k * 0.22, 0.4, 'sawtooth', f, f * 0.97, 0.1 * v));
        break;
      case 'swing':
        this.noise(t, 0.25, 1200, 0.7, 0.3 * v);
        break;
      case 'thunk':
        this.tone(t, 0.15, 'sine', 160, 60, 0.4 * v);
        break;
      case 'bump':
        this.noise(t, 0.2, 200, 0.7, 0.6 * v);
        this.tone(t, 0.2, 'sine', 90, 40, 0.4 * v);
        break;
      case 'reload':
        this.noise(t, 0.05, 2400, 3, 0.25 * v);
        this.noise(t + 0.25, 0.05, 1800, 3, 0.25 * v);
        break;
      case 'horn':
        this.horn(true);
        setTimeout(() => this.horn(false), 350);
        break;
    }
  }

  /** The bus horn: held while the button is (a two-note honk, like a real one). */
  horn(on: boolean) {
    if (!this.ctx || !this.master) return;
    if (on && !this.hornOn) {
      const c = this.ctx;
      const gain = c.createGain();
      gain.gain.value = 0.12;
      const a = c.createOscillator();
      const b = c.createOscillator();
      a.type = b.type = 'square';
      a.frequency.value = 311;
      b.frequency.value = 392;
      a.connect(gain);
      b.connect(gain);
      gain.connect(this.master);
      a.start();
      b.start();
      this.hornOn = { a, b, gain };
    } else if (!on && this.hornOn) {
      const h = this.hornOn;
      h.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      h.a.stop(this.ctx.currentTime + 0.2);
      h.b.stop(this.ctx.currentTime + 0.2);
      this.hornOn = null;
    }
  }

  /** The engine's drone follows the bus's speed. */
  engineAt(speed: number) {
    if (!this.ctx || !this.master) return;
    if (!this.engine) {
      const c = this.ctx;
      const gain = c.createGain();
      gain.gain.value = 0;
      const osc = c.createOscillator();
      const osc2 = c.createOscillator();
      osc.type = 'sawtooth';
      osc2.type = 'square';
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, gain };
    }
    const k = Math.min(1, Math.abs(speed) / 24);
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(38 + k * 70, t, 0.1);
    this.engine.osc2.frequency.setTargetAtTime(19 + k * 35, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(0.05 + k * 0.06, t, 0.2);
  }

  dispose() {
    this.horn(false);
    void this.ctx?.close();
    this.ctx = null;
  }
}
