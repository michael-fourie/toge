// The stops' minigames, drawn over the game on a 2D canvas: Zombie Tee-Off at the driving range (zombies shamble up
// the floodlit range at you; aim, wind up, swing, and tee them off) and the casino's Reel Stopper (pull the lever,
// then stop each reel yourself). Everyone at the stop can play at once; the results go to the host.

import type { Audio } from './audio.ts';
import type { Frame } from './input.ts';
import { GOLF, REEL_SPEED, SLOTS, SLOT_PAY, reelAt, slotPay, sweep, teesOff } from './rules.ts';

export interface Minigame {
  el: HTMLElement;
  /** A menu of real buttons (the card table): the session frees the pointer and turns the pad's menu moves on. */
  readonly menu?: boolean;
  update(dt: number, f: Frame): void;
}

function frame(title: string, how: string, w: number, h: number) {
  const el = document.createElement('div');
  el.className = 'bd-mini';
  const t = document.createElement('h2');
  t.textContent = title;
  const p = document.createElement('p');
  p.className = 'bd-mini-how';
  p.textContent = how;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const note = document.createElement('p');
  note.className = 'bd-mini-note';
  const out = document.createElement('p');
  out.className = 'bd-mini-out';
  out.textContent = 'E / Ⓑ: step away';
  el.append(t, p, c, note, out);
  return { el, c, g: c.getContext('2d')!, note };
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  text?: string;
}

/** Sparks, coins and words that fly and fade. */
class Bits {
  list: Bit[] = [];
  add(b: Bit) {
    if (this.list.length < 260) this.list.push(b);
  }
  burst(x: number, y: number, n: number, colors: string[], speed = 260, size = 5) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: 0.6 + Math.random() * 0.6, color: colors[k % colors.length], size: size * (0.5 + Math.random()) });
    }
  }
  word(x: number, y: number, text: string, color: string, size = 34) {
    this.add({ x, y, vx: 0, vy: -70, life: 1.1, color, size, text });
  }
  update(dt: number, g: CanvasRenderingContext2D, gravity = 600) {
    this.list = this.list.filter((b) => (b.life -= dt) > 0);
    for (const b of this.list) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!b.text) b.vy += gravity * dt;
      g.globalAlpha = Math.min(1, b.life * 2);
      g.fillStyle = b.color;
      if (b.text) {
        g.font = `900 ${b.size}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.lineWidth = 6;
        g.strokeStyle = '#1b1530';
        g.strokeText(b.text, b.x, b.y);
        g.fillText(b.text, b.x, b.y);
      } else {
        g.beginPath();
        g.arc(b.x, b.y, b.size, 0, 7);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Zombie Tee-Off

interface RangeZombie {
  x: number;
  d: number;
  speed: number;
  phase: number;
  /** Teed off: flying, spinning, then gone. */
  fly: number;
  vx: number;
  shirt: string;
}

const SHIRTS = ['#6d5f8a', '#8a5f5f', '#5f7a8a', '#8a805f', '#4f6a4f', '#a0663a'];

export class Golf implements Minigame {
  el: HTMLElement;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private note: HTMLElement;
  private zs: RangeZombie[] = [];
  private aim = 0;
  private power = 0;
  private chargeT = 0;
  private charging = false;
  private ball: { t: number; aim: number; power: number } | null = null;
  private swingT = 0;
  private grabbedT = 0;
  private shake = 0;
  private flash = 0;
  private bits = new Bits();
  private mine = 0;
  private clock = 0;
  private spawnT = 0;

  constructor(
    private onTee: () => void,
    private audio: Audio,
    private team: () => number,
    private need: number,
  ) {
    const f = frame('ZOMBIE TEE-OFF', 'Aim with the mouse, A/D or the stick. Hold Space / click / Ⓐ to wind up, let go to swing. Land it on a zombie to tee it off.', 720, 400);
    this.el = f.el;
    this.c = f.c;
    this.g = f.g;
    this.note = f.note;
    for (let k = 0; k < GOLF.crowd; k++) this.spawn(0.55 + k * 0.12);
  }

  private spawn(d = 1) {
    this.zs.push({
      x: (Math.random() - 0.5) * 1.5,
      d,
      speed: GOLF.speedMin + Math.random() * (GOLF.speedMax - GOLF.speedMin),
      phase: Math.random() * 6,
      fly: -1,
      vx: 0,
      shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
    });
  }

  /** The range in perspective: across (−1..1) and down the range (0 at the tee, 1 at the far net) to the screen. */
  private P(x: number, d: number) {
    const W = this.c.width;
    const H = this.c.height;
    const horizon = H * 0.3;
    const z = 4 + d * 26;
    const k = ((H * 0.97 - horizon) * 4) / z;
    return { x: W / 2 + (x * 13 * k) / 1.6, y: horizon + k, s: k / ((H * 0.97 - horizon) * 1) };
  }

  update(dt: number, f: Frame) {
    this.clock += dt;
    this.shake = Math.max(0, this.shake - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2);
    // Aim across: the mouse, the keys, either stick.
    this.aim = Math.max(-1, Math.min(1, this.aim - f.yaw * 0.9 + f.nudge * dt * 1.3));
    if (this.grabbedT > 0) {
      this.grabbedT -= dt;
      this.charging = false;
    } else if (!this.ball) {
      if (f.charge && !this.charging) {
        this.charging = true;
        this.chargeT = 0;
      }
      if (this.charging) {
        this.chargeT += dt;
        this.power = sweep(this.chargeT, GOLF.powerPeriod);
        if (!f.charge) {
          this.charging = false;
          this.ball = { t: 0, aim: this.aim, power: this.power };
          this.swingT = 0.35;
          this.audio.play('swing');
        }
      }
    }
    if (this.ball) {
      this.ball.t += dt / GOLF.flight;
      if (this.ball.t >= 1) this.land(this.ball.aim, this.ball.power);
    }
    this.swingT = Math.max(0, this.swingT - dt);
    // The crowd shambles in; a new one walks on for each one gone.
    this.spawnT -= dt;
    for (const z of this.zs) {
      if (z.fly >= 0) {
        z.fly += dt;
        z.x += z.vx * dt;
        continue;
      }
      z.d -= z.speed * dt;
      z.x += (0 - z.x) * dt * 0.08;
      if (z.d <= GOLF.reach) this.grab(z);
    }
    this.zs = this.zs.filter((z) => z.fly < 1.4 && z.d > -0.5);
    if (this.zs.filter((z) => z.fly < 0).length < GOLF.crowd && this.spawnT <= 0) {
      this.spawn();
      this.spawnT = 0.8;
    }
    if (Math.random() < dt * 0.4) this.audio.play('groan', 0.25);
    this.note.textContent = this.grabbedT > 0 ? 'GRABBED! Shake it off…' : `You: ${this.mine} · the boys: ${this.team()}/${this.need}`;
    this.draw();
  }

  private land(aim: number, power: number) {
    this.ball = null;
    const hit = this.zs.find((z) => z.fly < 0 && teesOff(aim, power, z));
    const at = this.P(aim, power);
    if (hit) {
      hit.fly = 0;
      hit.vx = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.6);
      this.mine++;
      this.onTee();
      this.audio.play('thunk');
      this.audio.play('fore', 0.8);
      this.shake = 1;
      this.bits.burst(at.x, at.y - 40 * at.s, 26, ['#7cff5b', '#ffd23f', '#ffffff', '#c8ff5a'], 320, 4);
      this.bits.word(at.x, at.y - 90 * at.s, ['FORE!', 'BONK!', 'HOLE IN ONE!', 'TEED OFF!'][Math.floor(Math.random() * 4)], '#7cff5b', 40);
    } else {
      this.bits.burst(at.x, at.y, 10, ['#6a8a4a', '#8aaa6a'], 120, 3);
      this.bits.word(at.x, at.y - 20, power < 0.08 ? 'DRIBBLE' : 'WHIFF', '#d0d0e0', 24);
    }
  }

  private grab(z: RangeZombie) {
    z.fly = 0;
    z.vx = 2;
    this.grabbedT = GOLF.grabbed;
    this.flash = 1;
    this.shake = 1.2;
    this.audio.play('groan', 1);
    this.audio.play('bump', 0.7);
  }

  private draw() {
    const g = this.g;
    const W = this.c.width;
    const H = this.c.height;
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * this.shake * 10, (Math.random() - 0.5) * this.shake * 10);
    // Night sky over the range.
    const sky = g.createLinearGradient(0, 0, 0, H * 0.3);
    sky.addColorStop(0, '#0a0820');
    sky.addColorStop(1, '#3a2a55');
    g.fillStyle = sky;
    g.fillRect(-20, -20, W + 40, H * 0.3 + 20);
    g.fillStyle = '#eef0ff';
    g.beginPath();
    g.arc(W * 0.82, H * 0.1, 18, 0, 7);
    g.fill();
    // The range: striped turf, darker with distance.
    for (let k = 0; k < 12; k++) {
      const a = this.P(0, k / 12);
      const b = this.P(0, (k + 1) / 12);
      const l1 = this.P(-1.6, k / 12);
      const l2 = this.P(-1.6, (k + 1) / 12);
      const r1 = this.P(1.6, k / 12);
      const r2 = this.P(1.6, (k + 1) / 12);
      const shade = 0.55 - k * 0.03;
      g.fillStyle = k % 2 ? `rgba(70,140,70,${shade + 0.3})` : `rgba(60,120,60,${shade + 0.3})`;
      g.beginPath();
      g.moveTo(l1.x, l1.y);
      g.lineTo(r1.x, r1.y);
      g.lineTo(r2.x, r2.y);
      g.lineTo(l2.x, l2.y);
      g.fill();
      void a;
      void b;
    }
    // Floodlight pools.
    for (const [x, d] of [[-0.9, 0.35], [0.9, 0.35], [-0.9, 0.8], [0.9, 0.8]]) {
      const p = this.P(x, d);
      const r = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 220 * p.s + 30);
      r.addColorStop(0, 'rgba(255,240,190,0.28)');
      r.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = r;
      g.fillRect(p.x - 300, p.y - 200, 600, 400);
    }
    // Yardage boards.
    for (const [d, label] of [[0.25, '50'], [0.5, '100'], [0.75, '150']] as const) {
      const p = this.P(1.25, d);
      g.fillStyle = '#f2f2e8';
      g.fillRect(p.x - 18 * p.s * 2, p.y - 40 * p.s * 2, 36 * p.s * 2, 22 * p.s * 2);
      g.fillStyle = '#1b1530';
      g.font = `900 ${Math.max(8, 15 * p.s * 2)}px system-ui`;
      g.textAlign = 'center';
      g.fillText(label, p.x, p.y - 24 * p.s * 2);
    }
    // The aim line and the landing marker (it slides out as you wind up).
    const tee = this.P(0, 0);
    const want = this.P(this.aim, this.charging ? this.power : 0.5);
    g.setLineDash([6, 8]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(tee.x, tee.y);
    g.lineTo(want.x, want.y);
    g.stroke();
    g.setLineDash([]);
    if (this.charging) {
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(want.x, want.y, 60 * want.s * 2 * GOLF.hitX * 4, 16 * want.s * 2, 0, 0, 7);
      g.stroke();
    }
    // Zombies, far ones first.
    for (const z of [...this.zs].sort((a, b) => b.d - a.d)) this.drawZombie(z);
    // The ball in flight: an arc, with its shadow on the turf.
    if (this.ball) {
      const k = this.ball.t;
      const p = this.P(this.ball.aim * k, this.ball.power * k);
      const lift = Math.sin(k * Math.PI) * 120 * (0.4 + this.ball.power);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(p.x, p.y, 6 * p.s * 3, 2.5 * p.s * 3, 0, 0, 7);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(p.x, p.y - lift * p.s * 1.6, Math.max(2.5, 7 * p.s * 2), 0, 7);
      g.fill();
    }
    // You at the tee: a bean in a toque with a club.
    this.drawGolfer(tee.x, H * 0.99);
    // The power meter.
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(W - 40, 40, 20, H - 90);
    const grad = g.createLinearGradient(0, H - 50, 0, 40);
    grad.addColorStop(0, '#7cff5b');
    grad.addColorStop(0.6, '#ffd23f');
    grad.addColorStop(1, '#ff3d7f');
    g.fillStyle = grad;
    const ph = (H - 90) * (this.charging ? this.power : 0);
    g.fillRect(W - 40, H - 50 - ph, 20, ph);
    g.strokeStyle = '#1b1530';
    g.lineWidth = 3;
    g.strokeRect(W - 40, 40, 20, H - 90);
    this.bits.update(1 / 60, g);
    g.restore();
    if (this.flash > 0) {
      g.fillStyle = `rgba(200,0,0,${this.flash * 0.35})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.grabbedT > 0) {
      g.font = '900 54px system-ui';
      g.textAlign = 'center';
      g.lineWidth = 8;
      g.strokeStyle = '#1b1530';
      g.strokeText('GRABBED!', W / 2, H * 0.45);
      g.fillStyle = '#ff5a5a';
      g.fillText('GRABBED!', W / 2, H * 0.45);
    }
  }

  private drawZombie(z: RangeZombie) {
    const g = this.g;
    const p = this.P(z.x, Math.max(0, z.d));
    const s = p.s * 3.4;
    const walk = Math.sin(this.clock * 7 + z.phase);
    g.save();
    g.translate(p.x, p.y);
    if (z.fly >= 0) {
      g.translate(z.fly * 40 * z.vx, -Math.sin(Math.min(1, z.fly) * Math.PI * 0.9) * 160 * s - z.fly * 60 * s);
      g.rotate(z.fly * 9 * Math.sign(z.vx));
      g.globalAlpha = Math.max(0, 1 - z.fly / 1.4);
    }
    g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(0, 0, 22, 6, 0, 0, 7);
    g.fill();
    g.fillStyle = '#3b3b48';
    g.fillRect(-10, -34, 8, 34 + walk * 3);
    g.fillRect(2, -34, 8, 34 - walk * 3);
    g.fillStyle = z.shirt;
    g.beginPath();
    g.roundRect(-15, -78, 30, 46, 10);
    g.fill();
    g.fillStyle = '#8fbf70';
    g.fillRect(-34, -70 + walk * 2, 24, 8);
    g.fillRect(10, -72 - walk * 2, 24, 8);
    g.beginPath();
    g.arc(0, -92, 17, 0, 7);
    g.fill();
    if (z.fly >= 0) {
      g.strokeStyle = '#111';
      g.lineWidth = 3;
      for (const ex of [-7, 7]) {
        g.beginPath();
        g.moveTo(ex - 4, -97);
        g.lineTo(ex + 4, -89);
        g.moveTo(ex + 4, -97);
        g.lineTo(ex - 4, -89);
        g.stroke();
      }
    } else {
      g.fillStyle = '#d6ff6a';
      g.shadowColor = '#d6ff6a';
      g.shadowBlur = 10;
      for (const ex of [-7, 7]) {
        g.beginPath();
        g.ellipse(ex, -93, 4, 2.5, 0, 0, 7);
        g.fill();
      }
      g.shadowBlur = 0;
    }
    g.restore();
  }

  private drawGolfer(x: number, y: number) {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.fillStyle = '#ff3d7f';
    g.beginPath();
    g.roundRect(-16, -70, 32, 52, 14);
    g.fill();
    g.fillStyle = '#ffd7b0';
    g.beginPath();
    g.arc(0, -84, 16, 0, 7);
    g.fill();
    g.fillStyle = '#ff3d7f';
    g.beginPath();
    g.arc(0, -88, 16, Math.PI, 0);
    g.fill();
    // The club: wound back while charging, a blur through the swing.
    const k = this.swingT > 0 ? -2.6 + (1 - this.swingT / 0.35) * 4.2 : this.charging ? -1.2 - this.power * 1.6 : 0.3;
    g.rotate(k);
    g.strokeStyle = '#c8ccd4';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, -48);
    g.lineTo(0, 10);
    g.stroke();
    g.fillStyle = '#9aa3b3';
    g.fillRect(-4, 6, 16, 8);
    g.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// Reel Stopper

export class Slots implements Minigame {
  el: HTMLElement;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private note: HTMLElement;
  /** idle → pull (the lever) → spin (stopping reels one by one) → paid (the celebration). */
  private state: 'idle' | 'pull' | 'spin' | 'paid' = 'idle';
  private t = 0;
  private clock = 0;
  private starts = [0, 0, 0];
  private stopped: (number | null)[] = [null, null, null];
  private bounce = [0, 0, 0];
  private win = 0;
  private bits = new Bits();

  constructor(
    private onPay: (v: number) => void,
    private audio: Audio,
    private bank: () => number,
    private goal: number,
  ) {
    const f = frame('REEL STOPPER', 'Space / click / Ⓐ pulls the lever, then stops each reel in turn. Pairs pay 50 scrap, three of a kind 120, 💰💰💰 250, 777 400.', 560, 380);
    this.el = f.el;
    this.c = f.c;
    this.g = f.g;
    this.note = f.note;
  }

  update(dt: number, f: Frame) {
    this.clock += dt;
    this.t += dt;
    for (let k = 0; k < 3; k++) this.bounce[k] = Math.max(0, this.bounce[k] - dt * 4);
    if (this.state === 'idle' && f.confirm) {
      this.state = 'pull';
      this.t = 0;
      this.audio.play('reels');
    } else if (this.state === 'pull' && this.t > 0.35) {
      this.state = 'spin';
      this.t = 0;
      this.starts = [0, 1, 2].map(() => Math.random() * SLOTS.length);
      this.stopped = [null, null, null];
    } else if (this.state === 'spin') {
      const next = this.stopped.indexOf(null);
      // Stop the next reel on a press (or by itself if you wait too long).
      if (next >= 0 && (f.confirm || this.t > 2.6 + next * 1.4)) {
        this.stopped[next] = reelAt(this.t, next, this.starts[next]);
        this.bounce[next] = 1;
        this.audio.play('thunk', 0.6);
      }
      if (this.stopped.every((s) => s !== null)) {
        const reels = this.stopped as number[];
        this.win = slotPay(reels);
        this.state = 'paid';
        this.t = 0;
        if (this.win > 0) {
          this.onPay(this.win);
          this.audio.play(this.win >= SLOT_PAY.tripleCash ? 'jingle' : 'cash');
          this.bits.burst(this.c.width / 2, this.c.height * 0.45, Math.min(80, this.win / 4), ['#ffd23f', '#ffe98a', '#f2a516'], 380, 6);
          this.bits.word(this.c.width / 2, this.c.height * 0.3, this.win >= SLOT_PAY.triple7 ? 'JACKPOT!' : `+$${this.win}`, '#ffd23f', this.win >= SLOT_PAY.tripleCash ? 54 : 40);
        } else this.bits.word(this.c.width / 2, this.c.height * 0.3, 'NOTHING', '#c8c8d8', 30);
      }
    } else if (this.state === 'paid' && (this.t > 1.6 || (this.t > 0.4 && f.confirm))) this.state = 'idle';
    this.note.textContent =
      this.state === 'idle' ? `Pull! · Bail fund $${this.bank()} / $${this.goal}` : this.state === 'spin' ? `STOP reel ${this.stopped.indexOf(null) + 1}!` : `Bail fund $${this.bank()} / $${this.goal}`;
    this.draw();
  }

  private draw() {
    const g = this.g;
    const W = this.c.width;
    const H = this.c.height;
    g.clearRect(0, 0, W, H);
    // The cabinet.
    const body = g.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, '#5a1a4a');
    body.addColorStop(1, '#260a20');
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(30, 10, W - 110, H - 20, 26);
    g.fill();
    g.strokeStyle = '#d8b46a';
    g.lineWidth = 6;
    g.stroke();
    // Marquee bulbs round the edge: they chase, and go wild on a win.
    const bulbs = 34;
    const wild = this.state === 'paid' && this.win > 0;
    for (let k = 0; k < bulbs; k++) {
      const u = k / bulbs;
      const per = 2 * (W - 110 + H - 20);
      let d = u * per;
      let x = 30;
      let y = 10;
      const w = W - 110;
      const h = H - 20;
      if (d < w) x += d;
      else if ((d -= w) < h) (x += w), (y += d);
      else if ((d -= h) < w) (x += w - d), (y += h);
      else (d -= w), (y += h - d);
      const on = wild ? Math.floor(this.clock * 14 + k) % 2 === 0 : Math.floor(this.clock * 6 - k) % 4 === 0;
      g.fillStyle = on ? '#fff6b0' : '#6a4a3a';
      if (on) {
        g.shadowColor = '#ffd23f';
        g.shadowBlur = 12;
      }
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fill();
      g.shadowBlur = 0;
    }
    // The neon title.
    g.font = '900 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.shadowColor = '#ff60e0';
    g.shadowBlur = 16;
    g.fillStyle = '#ffd6fb';
    g.fillText('LUCKY LIMESTONE', 30 + (W - 110) / 2, 62);
    g.shadowBlur = 0;
    // The reels.
    const rw = 110;
    const rh = 170;
    const top = 90;
    const left = 30 + ((W - 110) - (rw * 3 + 24)) / 2;
    for (let k = 0; k < 3; k++) {
      const x = left + k * (rw + 12);
      g.save();
      g.beginPath();
      g.roundRect(x, top, rw, rh, 14);
      g.clip();
      g.fillStyle = '#fff4e0';
      g.fillRect(x, top, rw, rh);
      const spinning = this.state === 'spin' && this.stopped[k] === null;
      const pos = spinning ? this.starts[k] + this.t * REEL_SPEED[k] : this.stopped[k] ?? k;
      const frac = spinning ? pos % 1 : -Math.sin(this.bounce[k] * Math.PI) * 0.15;
      const idx = Math.floor(pos);
      g.font = '64px system-ui, sans-serif';
      g.textBaseline = 'middle';
      for (let j = -1; j <= 1; j++) {
        const sym = SLOTS[(((idx + j) % SLOTS.length) + SLOTS.length) % SLOTS.length];
        const y = top + rh / 2 + (j - frac) * 78;
        g.globalAlpha = spinning ? 0.55 : j === 0 ? 1 : 0.35;
        g.fillStyle = sym === '7' ? '#e0242c' : '#1b1530';
        g.font = sym === '7' ? '900 70px system-ui, sans-serif' : '60px system-ui, sans-serif';
        g.fillText(sym, x + rw / 2, y);
        if (spinning) g.fillText(sym, x + rw / 2, y - 22);
      }
      g.globalAlpha = 1;
      // Shading top and bottom, like a drum.
      const shade = g.createLinearGradient(0, top, 0, top + rh);
      shade.addColorStop(0, 'rgba(0,0,0,0.45)');
      shade.addColorStop(0.3, 'rgba(0,0,0,0)');
      shade.addColorStop(0.7, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = shade;
      g.fillRect(x, top, rw, rh);
      g.restore();
      g.strokeStyle = this.state === 'spin' && this.stopped.indexOf(null) === k ? '#7cff5b' : '#d8b46a';
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(x, top, rw, rh, 14);
      g.stroke();
    }
    // The pay line.
    g.strokeStyle = wild ? '#7cff5b' : 'rgba(255,61,127,0.8)';
    g.lineWidth = wild ? 5 : 3;
    g.beginPath();
    g.moveTo(left - 10, top + rh / 2);
    g.lineTo(left + rw * 3 + 34, top + rh / 2);
    g.stroke();
    // The lever: down while it's pulled.
    const pulled = this.state === 'pull' ? Math.sin((this.t / 0.35) * Math.PI) : 0;
    const lx = W - 50;
    const ly = 120 + pulled * 110;
    g.strokeStyle = '#c8ccd4';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(lx, 230);
    g.lineTo(lx, ly);
    g.stroke();
    g.fillStyle = '#e0242c';
    g.beginPath();
    g.arc(lx, ly, 18, 0, 7);
    g.fill();
    g.fillStyle = '#d8b46a';
    g.fillRect(lx - 16, 222, 32, 26);
    this.bits.update(1 / 60, g);
  }
}
