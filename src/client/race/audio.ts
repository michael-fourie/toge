// Race sound, all synthesised: an engine per car (firing frequency from rpm and cylinder count, a sub
// octave and a harmonic through soft clipping and a throttle-opened filter), tyre squeal, gravel rumble,
// wind, a turbo whistle and blow-off, impacts, shift clunks and the countdown beeps.

const BUS_GAIN = 0.35;
const VOLUME_KEY = 'atrous.raceVolume';
export const VOLUMES = [0, 0.25, 0.5, 0.75, 1];

export function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY) ?? '0.5');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  } catch {
    return 0.5;
  }
}

function saveVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* private mode */
  }
}

export class Engine {
  private oscs: OscillatorNode[];
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private whistle: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private lastLoad = 0;

  constructor(
    private a: RaceAudio,
    private cyl: number,
    turbo: boolean,
    private volume: number,
  ) {
    const ctx = a.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.2;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    const mix = ctx.createGain();
    mix.gain.value = 0.35;
    const types: OscillatorType[] = ['sawtooth', 'square', 'sawtooth'];
    this.oscs = types.map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = [0.6, 0.45, 0.22][i];
      o.connect(g).connect(mix);
      o.start();
      return o;
    });
    this.oscs[2].detune.value = 9;
    mix.connect(shaper).connect(this.filter).connect(this.gain).connect(a.bus);
    if (turbo) {
      this.whistle = ctx.createOscillator();
      this.whistle.type = 'sine';
      this.whistleGain = ctx.createGain();
      this.whistleGain.gain.value = 0;
      this.whistle.connect(this.whistleGain).connect(a.bus);
      this.whistle.start();
    }
  }

  /** `near` scales the volume (1 for your own car, by distance for others). */
  update(rpm: number, load: number, redline: number, near: number) {
    const t = this.a.ctx.currentTime;
    const f = (rpm / 60) * (this.cyl / 2);
    this.oscs[0].frequency.setTargetAtTime(f, t, 0.02);
    this.oscs[1].frequency.setTargetAtTime(f / 2, t, 0.02);
    this.oscs[2].frequency.setTargetAtTime(f * 2, t, 0.02);
    this.filter.frequency.setTargetAtTime(300 + load * 1600 + rpm * 0.15, t, 0.04);
    this.gain.gain.setTargetAtTime((0.04 + load * 0.08 + (rpm / redline) * 0.03) * this.volume * near, t, 0.05);
    if (this.whistle && this.whistleGain) {
      const boost = Math.max(0, rpm / redline - 0.35) * load;
      this.whistle.frequency.setTargetAtTime(1800 + boost * 4200, t, 0.08);
      this.whistleGain.gain.setTargetAtTime(boost * 0.008 * near, t, 0.1);
      if (this.lastLoad > 0.7 && load < 0.15 && rpm > redline * 0.5) this.a.burst(0.3, 0.02 * near, 2400, 'highpass');
    }
    this.lastLoad = load;
  }

  stop() {
    for (const o of this.oscs) o.stop();
    this.whistle?.stop();
    this.gain.disconnect();
  }
}

export class RaceAudio {
  readonly ctx: AudioContext;
  readonly bus: GainNode;
  private noise: AudioBuffer;
  private squeal: { gain: GainNode; filter: BiquadFilterNode };
  private rumble: { gain: GainNode };
  private wind: { gain: GainNode; filter: BiquadFilterNode };

  constructor() {
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = BUS_GAIN * loadVolume();
    this.bus.connect(comp).connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.squeal = this.loop('bandpass', 1150, 6);
    this.rumble = this.loop('lowpass', 180, 0.7);
    this.wind = this.loop('lowpass', 500, 0.5);
  }

  private loop(type: BiquadFilterType, freq: number, q: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    s.connect(filter).connect(gain).connect(this.bus);
    s.start();
    return { gain, filter };
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Tyres, gravel and wind for the car you're following. */
  surroundings(slip: number, offroad: number, speed: number) {
    const t = this.ctx.currentTime;
    const sq = Math.max(0, Math.min(1, (slip - 0.9) * 0.9)) * Math.min(1, speed / 6);
    this.squeal.gain.gain.setTargetAtTime(sq * 0.07, t, 0.05);
    this.squeal.filter.frequency.setTargetAtTime(950 + sq * 500, t, 0.1);
    this.rumble.gain.gain.setTargetAtTime(offroad * Math.min(1, speed / 15) * 0.16, t, 0.08);
    const w = Math.min(1, (speed / 70) ** 2);
    this.wind.gain.gain.setTargetAtTime(w * 0.08, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(300 + w * 1200, t, 0.2);
  }

  burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass') {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random());
    s.stop(t + dur);
  }

  tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  impact(speed: number) {
    const v = Math.min(1, speed / 15);
    this.burst(0.25 + v * 0.3, 0.08 + v * 0.17, 500);
    this.tone(55 + Math.random() * 20, 0.25, 0.12 * v);
  }

  shift() {
    this.tone(120, 0.06, 0.03, 'square');
  }

  beep(go: boolean) {
    this.tone(go ? 1320 : 660, go ? 0.6 : 0.25, 0.08, 'triangle');
  }

  /** Master volume (0..1), saved for next time. */
  setVolume(v: number) {
    saveVolume(v);
    this.bus.gain.setTargetAtTime(BUS_GAIN * v, this.ctx.currentTime, 0.05);
  }

  close() {
    void this.ctx.close();
  }
}
