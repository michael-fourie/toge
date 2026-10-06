// Tiny synthesized sound effects. No assets, deliberately goofy.

let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur: number, vol: number, freq: number, q = 0.8, type: BiquadFilterType = 'lowpass') {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const s = a.createBufferSource();
  s.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur);
}

export const sfx = {
  unlock: () => audio(),
  shoot() {
    burst(0.35, 1.0, 2400);
    tone('square', 140, 40, 0.25, 0.5);
  },
  distantShot(distance: number) {
    const v = Math.max(0.05, 0.5 - distance / 300);
    burst(0.4, v, 900);
  },
  jump: () => tone('sine', 220, 360, 0.09, 0.12),
  airJump: () => tone('triangle', 400, 900, 0.14, 0.18),
  land: (hard: number) => burst(0.08 + hard * 0.08, 0.15 + hard * 0.3, 300),
  wallrun: () => burst(0.35, 0.18, 1400, 2, 'bandpass'),
  wallJump: () => tone('triangle', 300, 700, 0.12, 0.2),
  slide() {
    burst(0.45, 0.22, 700, 1.2, 'bandpass'); // grassy swish
    tone('sine', 260, 140, 0.25, 0.06);
  },
  pad() {
    tone('sine', 120, 900, 0.5, 0.35); // boing
    tone('sine', 180, 1300, 0.45, 0.15, 0.03);
  },
  hit() {
    tone('sine', 1300, 1300, 0.08, 0.25);
    tone('sine', 1950, 1950, 0.1, 0.18, 0.05);
  },
  kill() {
    tone('square', 523, 523, 0.09, 0.15);
    tone('square', 659, 659, 0.09, 0.15, 0.08);
    tone('square', 784, 784, 0.16, 0.15, 0.16);
  },
  death: () => tone('sawtooth', 400, 50, 0.8, 0.25),
  scope: () => tone('sine', 900, 600, 0.05, 0.08),
};
