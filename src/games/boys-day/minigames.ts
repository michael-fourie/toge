// The stops' minigames, drawn over the game (2D canvas and DOM): the driving range (aim, then power, land it on the
// green) and the casino's slot machine. Everyone at the stop can play at once; the results go to the host.

import type { Audio } from './audio.ts';
import type { Frame } from './input.ts';
import { GOLF, SLOTS, onGreen, slotPay, sweep } from './rules.ts';

export interface Minigame {
  el: HTMLElement;
  update(dt: number, f: Frame): void;
}

function frame(title: string, how: string): { el: HTMLElement; body: HTMLElement; note: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'bd-mini';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'bd-mini-how';
  p.textContent = how;
  const body = document.createElement('div');
  body.className = 'bd-mini-body';
  const note = document.createElement('p');
  note.className = 'bd-mini-note';
  const out = document.createElement('p');
  out.className = 'bd-mini-out';
  out.textContent = 'E / Ⓑ: back on the bus';
  el.append(h, p, body, note, out);
  return { el, body, note };
}

/** The driving range: stop the aim sweep near the middle, then the power sweep on the flag. */
export class Golf implements Minigame {
  el: HTMLElement;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private note: HTMLElement;
  private phase: 'aim' | 'power' | 'flight' | 'result' = 'aim';
  private t = 0;
  private aim = 0;
  private power = 0;
  private target = 0.6;
  private flight = 0;
  private result = '';
  private bonk = -1;
  private zombies = [0.35, 0.55, 0.78].map((x) => ({ x, y: 0.2 + Math.random() * 0.6, dx: (Math.random() - 0.5) * 0.04 }));

  constructor(
    private onGreen: () => void,
    private audio: Audio,
  ) {
    const f = frame('TEE TIME', 'Space / click / Ⓐ to stop the aim, then again for power. Land 3 on the green between you.');
    this.el = f.el;
    this.note = f.note;
    this.c = document.createElement('canvas');
    this.c.width = 640;
    this.c.height = 320;
    f.body.append(this.c);
    this.g = this.c.getContext('2d')!;
    this.newBall();
  }

  private newBall() {
    this.phase = 'aim';
    this.t = Math.random();
    this.target = 0.45 + Math.random() * 0.4;
    this.note.textContent = 'Aim…';
  }

  update(dt: number, f: Frame) {
    this.t += dt;
    for (const z of this.zombies) {
      z.y += z.dx * dt * 3;
      if (z.y < 0.1 || z.y > 0.9) z.dx = -z.dx;
    }
    if (this.phase === 'aim') {
      this.aim = sweep(this.t, GOLF.aimPeriod) * 2 - 1;
      if (f.confirm) {
        this.phase = 'power';
        this.t = 0;
        this.note.textContent = 'Power…';
      }
    } else if (this.phase === 'power') {
      this.power = sweep(this.t, GOLF.powerPeriod);
      if (f.confirm) {
        this.phase = 'flight';
        this.flight = 0;
        this.audio.play('swing');
        this.audio.play('fore', 0.6);
      }
    } else if (this.phase === 'flight') {
      this.flight += dt / 1.1;
      if (this.flight >= 1) {
        this.phase = 'result';
        this.t = 0;
        const ok = onGreen(this.aim, this.power, this.target);
        const lx = 0.1 + this.power * 0.85;
        const ly = 0.5 + this.aim * 0.45;
        this.bonk = this.zombies.findIndex((z) => Math.abs(z.x - lx) < 0.05 && Math.abs(z.y - ly) < 0.12);
        if (ok) {
          this.result = 'ON THE GREEN!';
          this.audio.play('win');
          this.onGreen();
        } else if (this.bonk >= 0) {
          this.result = 'BONK! (a zombie, not the green)';
          this.audio.play('thunk');
        } else this.result = Math.abs(this.aim) > GOLF.aimTol ? 'SHANKED IT' : this.power > this.target ? 'WAY LONG' : 'SHORT';
        this.note.textContent = this.result;
      }
    } else if (this.t > 1.3) this.newBall();
    this.draw();
  }

  private draw() {
    const g = this.g;
    const W = this.c.width;
    const H = this.c.height;
    // Looking down the range from above: tee on the left, the green out at the target distance.
    g.fillStyle = '#5fae4f';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 2 ? '#67b857' : '#5aa64b';
      g.fillRect((k * W) / 8, 0, W / 8, H);
    }
    const gx = (0.1 + this.target * 0.85) * W;
    const gy = H / 2;
    g.fillStyle = '#8fe07a';
    g.beginPath();
    g.ellipse(gx, gy, GOLF.powerTol * 0.85 * W, GOLF.aimTol * 0.45 * H, 0, 0, 7);
    g.fill();
    g.fillStyle = '#eee';
    g.fillRect(gx - 1, gy - 34, 3, 34);
    g.fillStyle = '#ff3030';
    g.fillRect(gx + 2, gy - 34, 18, 11);
    for (const [i, z] of this.zombies.entries()) {
      g.font = '26px system-ui';
      g.textAlign = 'center';
      g.fillText(i === this.bonk && this.phase === 'result' ? '💫' : '🧟', z.x * W, z.y * H + 9);
    }
    g.fillStyle = '#d9c9a0';
    g.fillRect(0.06 * W, gy - 14, 26, 28);
    // The ball, in flight or on the tee.
    let bx = 0.1 * W;
    let by = gy;
    let r = 6;
    if (this.phase === 'flight' || this.phase === 'result') {
      const k = Math.min(1, this.flight);
      bx = (0.1 + this.power * 0.85 * k) * W;
      by = gy + this.aim * 0.45 * H * k;
      r = 6 + Math.sin(k * Math.PI) * 9;
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(bx + 3, by + 4, 6, 0, 7);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(bx, by, r, 0, 7);
    g.fill();
    // The meters: aim along the bottom, power up the side.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(W * 0.25, H - 28, W * 0.5, 16);
    g.fillStyle = '#ffd23f';
    g.fillRect(W * 0.5 - GOLF.aimTol * W * 0.25, H - 28, GOLF.aimTol * W * 0.5, 16);
    g.fillStyle = '#fff';
    g.fillRect(W * 0.5 + this.aim * W * 0.25 - 3, H - 34, 6, 28);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(W - 34, 20, 18, H - 70);
    const py = (p: number) => 20 + (H - 70) * (1 - p);
    g.fillStyle = '#ffd23f';
    g.fillRect(W - 34, py(this.target + GOLF.powerTol), 18, py(this.target - GOLF.powerTol) - py(this.target + GOLF.powerTol));
    g.fillStyle = '#fff';
    g.fillRect(W - 40, py(this.power) - 3, 30, 6);
  }
}

/** The slot machine: pull, three reels, pay the table. Pulls are free; the house always loses tonight. */
export class Slots implements Minigame {
  el: HTMLElement;
  private reels: HTMLElement[] = [];
  private note: HTMLElement;
  private spin = -1;
  private stops = [0, 0, 0];
  private show = [0, 1, 2];
  private tick = 0;

  constructor(
    private onPay: (v: number) => void,
    private audio: Audio,
    private bank: () => number,
    private goal: number,
  ) {
    const f = frame('LUCKY LIMESTONE SLOTS', 'Space / click / Ⓐ to pull. Pairs pay $50, three of a kind $120, 💰💰💰 $250, 777 $400.');
    this.el = f.el;
    this.note = f.note;
    const row = document.createElement('div');
    row.className = 'bd-reels';
    for (let k = 0; k < 3; k++) {
      const r = document.createElement('div');
      r.className = 'bd-reel';
      row.append(r);
      this.reels.push(r);
    }
    f.body.append(row);
    this.paint();
    this.status();
  }

  private status(extra = '') {
    this.note.textContent = `${extra}${extra ? ' · ' : ''}Bail fund: $${this.bank()} / $${this.goal}`;
  }

  private paint() {
    this.reels.forEach((r, k) => (r.textContent = SLOTS[this.show[k]]));
  }

  update(dt: number, f: Frame) {
    if (this.spin < 0) {
      if (f.confirm) {
        this.spin = 0;
        this.stops = [0, 1, 2].map(() => Math.floor(Math.random() * SLOTS.length));
        this.audio.play('reels');
      }
      this.status();
      return;
    }
    this.spin += dt;
    this.tick += dt;
    if (this.tick > 0.06) {
      this.tick = 0;
      for (let k = 0; k < 3; k++) if (this.spin < 0.6 + k * 0.35) this.show[k] = (this.show[k] + 1) % SLOTS.length;
    }
    for (let k = 0; k < 3; k++) if (this.spin >= 0.6 + k * 0.35) this.show[k] = this.stops[k];
    this.paint();
    if (this.spin >= 0.6 + 2 * 0.35 + 0.2) {
      const pay = slotPay(this.stops);
      this.spin = -1;
      if (pay > 0) {
        this.onPay(pay);
        this.audio.play(pay >= 250 ? 'win' : 'cash');
        this.status(`+$${pay}!`);
      } else this.status('Nothing.');
    }
  }
}
