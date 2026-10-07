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

let wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;

export const sfx = {
  unlock: () => audio(),
  /** Rushing wind that grows with speed: k in 0..1 (0 = silent). Call every frame; it smooths itself. */
  setWind(k: number) {
    const a = audio();
    if (!a) return;
    if (!wind) {
      const src = a.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = a.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      const gain = a.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      wind = { gain, filter };
    }
    const t = a.currentTime;
    wind.gain.gain.setTargetAtTime(k * k * 0.45, t, 0.12);
    wind.filter.frequency.setTargetAtTime(350 + k * 1700, t, 0.12);
  },
  distantShot(distance: number) {
    const v = Math.max(0.05, 0.5 - distance / 300);
    burst(0.4, v, 900);
  },
  jump: () => tone('sine', 220, 360, 0.09, 0.12),
  land: (hard: number) => burst(0.08 + hard * 0.08, 0.15 + hard * 0.3, 300),
  wallrun: () => burst(0.35, 0.18, 1400, 2, 'bandpass'),
  wallJump: () => tone('triangle', 300, 700, 0.12, 0.2),
  grappleHit() {
    tone('square', 900, 500, 0.05, 0.14); // hook bites
    burst(0.1, 0.2, 2200, 1, 'bandpass');
  },
  throwNade: () => burst(0.2, 0.18, 1400, 1.2, 'bandpass'),
  nadeBounce: () => tone('triangle', 900, 500, 0.05, 0.1),
  /** A boom that gets quieter and duller with distance (metres). */
  boom(distance: number) {
    const v = Math.max(0.12, 1 - distance / 80);
    burst(0.7, 0.9 * v, 260 + 500 * v, 0.8);
    tone('sine', 90, 28, 0.55, 0.7 * v);
    burst(0.12, 0.5 * v, 3000, 0.6, 'highpass');
  },
  knife() {
    burst(0.12, 0.4, 4200, 1.2, 'highpass'); // whoosh
    tone('triangle', 900, 300, 0.1, 0.12);
  },
  /** Case reel: one tick as an item passes the marker. */
  caseTick: () => tone('square', 1500, 1100, 0.025, 0.07),
  /** The drop lands: a chime that climbs with rarity (0..6), plus a big shimmer from classified up. */
  caseReveal(tier: number) {
    const scale = [523, 587, 659, 784, 880, 1047, 1319];
    for (let i = 0; i <= Math.min(tier, 6); i++) tone('triangle', scale[i], scale[i], 0.3, 0.14, i * 0.08);
    if (tier >= 4) tone('sine', 1568, 2093, 0.6, 0.14, 0.4);
    if (tier >= 6) tone('sine', 2093, 3136, 0.9, 0.12, 0.6);
  },
  coin: () => tone('square', 1320, 1760, 0.1, 0.1),
  grappleMiss: () => burst(0.25, 0.16, 1800, 1.4, 'bandpass'),
  grappleRelease: () => tone('sine', 520, 260, 0.1, 0.08),
  airJump: () => tone('sine', 380, 640, 0.1, 0.14), // a soft puff, higher than the ground jump
  slide() {
    burst(0.45, 0.22, 700, 1.2, 'bandpass'); // grassy swish
    tone('sine', 260, 140, 0.25, 0.06);
  },
  boost() {
    burst(0.5, 0.3, 900, 0.7, 'bandpass'); // rushing wind
    tone('sine', 300, 700, 0.35, 0.08);
  },
  bounce() {
    tone('sine', 90, 500, 0.35, 0.4); // squishy boing
    tone('triangle', 140, 760, 0.3, 0.12, 0.02);
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
  // Weapon handling: short metallic clacks and slides.
  boltUp: () => tone('square', 1800, 1200, 0.03, 0.06),
  boltBack() {
    burst(0.07, 0.25, 3200, 1.5, 'highpass');
    tone('square', 700, 500, 0.04, 0.06);
  },
  boltForward() {
    burst(0.05, 0.3, 2600, 1.5, 'highpass');
    tone('square', 900, 1300, 0.05, 0.08, 0.02);
  },
  magOut: () => tone('triangle', 500, 260, 0.08, 0.12),
  magIn() {
    burst(0.05, 0.35, 1800, 1, 'bandpass');
    tone('square', 320, 260, 0.06, 0.12);
  },
  dryFire: () => tone('square', 2200, 2000, 0.02, 0.08),

  /** A shot, in each gun's own voice (punched ones ring a little at the end). */
  gun(style: string, punched = false) {
    const v = { pistol: [0.22, 3200, 220, 0.3], revolver: [0.4, 1500, 90, 0.55], smg: [0.12, 4200, 260, 0.28], rifle: [0.2, 2600, 150, 0.4], pump: [0.45, 1300, 70, 0.7], lever: [0.3, 2000, 110, 0.5], lmg: [0.2, 1800, 100, 0.5], bolt: [0.35, 2400, 140, 0.5], ray: [0.3, 0, 0, 0] }[style] ?? [0.3, 2400, 140, 0.5];
    if (style === 'ray') {
      tone('sawtooth', 1400, 260, 0.35, 0.22);
      tone('sine', 700, 1900, 0.25, 0.2, 0.02);
      tone('triangle', 2600, 600, 0.3, 0.1);
    } else {
      burst(v[0], 0.9, v[1]);
      tone('square', v[2], 40, v[0] * 0.8, v[3]);
    }
    if (punched) tone('sine', 1760, 2200, 0.25, 0.08, 0.03);
  },
  /** Another player's gun heard from afar: quieter and duller with distance, and the sound of its type. */
  distantGun(style: string, distance: number) {
    const v = Math.max(0.05, 0.5 - distance / 300);
    if (style === 'ray') tone('sawtooth', 900, 300, 0.25, v * 0.4);
    else burst(style === 'pump' || style === 'revolver' ? 0.5 : 0.25, v, style === 'smg' || style === 'pistol' ? 1500 : 800);
  },
  pump() {
    burst(0.07, 0.25, 2800, 1.5, 'highpass');
    tone('square', 500, 300, 0.06, 0.1);
    tone('square', 800, 1100, 0.06, 0.1, 0.16);
  },
  shell: () => tone('triangle', 1100, 700, 0.05, 0.1),
  lever() {
    tone('square', 600, 380, 0.05, 0.09);
    burst(0.05, 0.2, 3000, 1.2, 'highpass');
    tone('square', 420, 680, 0.05, 0.09, 0.2);
  },
  cover: () => {
    burst(0.1, 0.3, 1200, 1, 'bandpass');
    tone('square', 240, 160, 0.08, 0.14);
  },
  cell() {
    tone('sine', 500, 1500, 0.2, 0.14);
    tone('triangle', 1500, 700, 0.12, 0.08, 0.1);
  },
  cash: () => [988, 1319].forEach((f, i) => tone('square', f, f, 0.09, 0.1, i * 0.07)),
  /** Hammering a board back on. */
  nail() {
    burst(0.05, 0.4, 1800, 1.5, 'bandpass');
    tone('square', 260, 180, 0.05, 0.12);
  },
  /** A zombie ripping a board off: splintering wood. */
  plank() {
    burst(0.22, 0.5, 700, 0.6, 'lowpass');
    tone('sawtooth', 160, 70, 0.18, 0.18);
  },
  door() {
    burst(0.5, 0.5, 300, 0.8);
    tone('sawtooth', 70, 40, 0.5, 0.3);
    tone('square', 180, 120, 0.1, 0.15, 0.3);
  },
  /** The Mystery Box music: a little ascending jingle per cycle. */
  boxTick: (i: number) => tone('triangle', [392, 440, 523, 587, 659][i % 5], [392, 440, 523, 587, 659][i % 5], 0.12, 0.1),
  plush: () => [392, 349, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.97, 0.3, 0.16, i * 0.2)),

  // Achievements: a rising pentatonic sparkle, one note per stacked feat, plus a top note for a legendary one.
  feats(count: number, best: number) {
    const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568];
    for (let i = 0; i < count; i++) tone('triangle', scale[i % scale.length], scale[i % scale.length], 0.16, 0.16, i * 0.07);
    if (best >= 3) {
      tone('sine', 1568, 2093, 0.4, 0.12, count * 0.07);
      tone('triangle', 2093, 2093, 0.3, 0.06, count * 0.07 + 0.05);
    }
  },

  // Survival
  hurt() {
    burst(0.12, 0.5, 1800, 1.2, 'bandpass'); // scratch
    tone('sawtooth', 220, 110, 0.18, 0.18);
  },
  groan(distance: number) {
    const v = Math.max(0, 0.22 - distance / 120);
    if (v <= 0.01) return;
    const f = 90 + Math.random() * 40;
    tone('sawtooth', f, f * 0.7, 0.9, v);
    tone('sine', f * 1.5, f * 1.1, 0.9, v * 0.5, 0.05);
  },
  zombieDown() {
    tone('sine', 300, 60, 0.35, 0.3); // deflating squeak
    burst(0.15, 0.3, 500);
  },
  roundStart() {
    tone('sawtooth', 110, 110, 0.5, 0.18);
    tone('sawtooth', 104, 104, 0.5, 0.18, 0.5);
    tone('sawtooth', 98, 70, 0.9, 0.22, 1.0);
  },
  roundClear() {
    [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.18, i * 0.1));
  },
  /** Pack-a-Punch bought: a rising brassy chime with a shimmer on top. */
  punch() {
    [392, 523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.3, 0.2, i * 0.07));
    [1568, 2093, 2637].forEach((f, i) => tone('sine', f, f * 1.01, 0.5, 0.1, 0.35 + i * 0.08));
    burst(0.3, 0.15, 3000, 0.8, 'highpass');
  },
  /** Glug-glug and a bright finish: a perk drink going down. */
  jug() {
    tone('sine', 240, 120, 0.12, 0.2);
    tone('sine', 300, 150, 0.12, 0.2, 0.14);
    tone('triangle', 420, 880, 0.35, 0.18, 0.3);
  },
  /** The Gale Scythe: a deep whoosh of wind with a chime on top. */
  scythe() {
    burst(0.45, 0.35, 700, 1.2);
    tone('sine', 880, 1320, 0.3, 0.12, 0.08);
  },
  /** A Stoker bursts: a crackling pop. */
  embers() {
    burst(0.4, 0.4, 1800);
    tone('sawtooth', 160, 50, 0.4, 0.2);
  },
  /** The power comes on: a big clunk, then a rising hum. */
  powerOn() {
    burst(0.15, 0.5, 300);
    tone('sawtooth', 50, 120, 1.6, 0.18, 0.1);
    tone('sine', 100, 240, 1.6, 0.12, 0.1);
  },
  /** Picked up a scythe part / built the scythe. */
  part() {
    [659, 880, 1175].forEach((f, i) => tone('triangle', f, f, 0.18, 0.14, i * 0.07));
  },
  /** Max Ammo: a clatter of shells and a fanfare. */
  maxAmmo() {
    for (let i = 0; i < 5; i++) tone('square', 1800 + i * 150, 900, 0.05, 0.08, i * 0.04);
    [262, 330, 392, 523, 659].forEach((f, i) => tone('sawtooth', f, f, 0.18, 0.12, 0.2 + i * 0.08));
    tone('triangle', 784, 788, 0.6, 0.18, 0.62);
  },
  denied: () => tone('square', 180, 120, 0.15, 0.12),
  gameOver: () => [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.35, 0.2, i * 0.22)),
};
