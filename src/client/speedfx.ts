// Wind streaks streaming outward from the middle of the screen, scaled by speed. Pure canvas overlay.

const COUNT = 70;
const START = 14; // m/s where streaks begin to show
const FULL = 50; // m/s where they're at full strength
const CLEAR = 0.32; // fraction of the half-diagonal kept clear in the middle so aim isn't hidden

interface Streak {
  angle: number;
  depth: number; // 0 near the clear zone, 1 at the screen edge
  rate: number; // relative speed
}

export class SpeedFx {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private streaks: Streak[] = Array.from({ length: COUNT }, () => ({ angle: Math.random() * Math.PI * 2, depth: Math.random(), rate: 0.6 + Math.random() * 0.8 }));
  private punchK = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement) {
    this.canvas.className = 'speedfx';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.prepend(this.canvas);
  }

  /** A burst of streaks for a wall jump, grapple hook or gate (decays in about a third of a second). */
  punch(amount = 0.6) {
    this.punchK = Math.max(this.punchK, amount);
  }

  /** 0..1 strength for a given speed (eased so the first few m/s past START are subtle). */
  static strength(speed: number): number {
    const t = Math.min(1, Math.max(0, (speed - START) / (FULL - START)));
    return t * t * (3 - 2 * t);
  }

  update(dt: number, speed: number, visible: boolean) {
    this.punchK = Math.max(0, this.punchK - dt * 2);
    const k = visible && !this.reduced ? Math.min(1, SpeedFx.strength(speed) + this.punchK) : 0;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw !== this.w || ch !== this.h) {
      this.w = cw;
      this.h = ch;
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const g = this.ctx;
    g.clearRect(0, 0, cw, ch);
    if (k < 0.02) return;
    const cx = cw / 2;
    const cy = ch / 2;
    const half = Math.hypot(cx, cy);
    g.lineCap = 'round';
    for (const s of this.streaks) {
      s.depth += dt * s.rate * (0.5 + k * 1.6);
      if (s.depth > 1) {
        s.depth = 0;
        s.angle = Math.random() * Math.PI * 2;
        s.rate = 0.6 + Math.random() * 0.8;
      }
      const r0 = half * (CLEAR + (1 - CLEAR) * s.depth ** 1.6);
      const len = half * 0.28 * k * (0.35 + s.depth);
      const dx = Math.cos(s.angle);
      const dy = Math.sin(s.angle);
      const a = k * Math.sin(Math.min(1, s.depth) * Math.PI) ** 0.7;
      const w = 1 + s.depth * 2.2;
      g.beginPath();
      g.moveTo(cx + dx * r0, cy + dy * r0);
      g.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
      // A faint dark under-stroke keeps the white streaks visible against bright sky.
      g.strokeStyle = `rgba(24, 44, 72, ${(0.22 * a).toFixed(3)})`;
      g.lineWidth = w + 2;
      g.stroke();
      g.strokeStyle = `rgba(255, 252, 240, ${(0.7 * a).toFixed(3)})`;
      g.lineWidth = w;
      g.stroke();
    }
  }

  dispose() {
    this.canvas.remove();
  }
}
