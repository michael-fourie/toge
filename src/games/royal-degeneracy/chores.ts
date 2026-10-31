// The chore close-ups: a short minigame on top of the view while you can't look around (so you listen). A virtual
// cursor moves with the mouse (pointer lock stays on) or the left stick; click / Ⓐ presses. Esc or Ⓑ gives up.
// Four for now: scrub the pan, plunge the toilet, pair the socks, sort the recycling.

import type { ChoreKind } from './house.ts';
import type { Frame } from './input.ts';

const W = 520;
const H = 380;

interface Game {
  title: string;
  hint: string;
  update(dt: number, f: Frame, c: { x: number; y: number }): void;
  draw(g: CanvasRenderingContext2D, c: { x: number; y: number }): void;
  done(): boolean;
  /** Played when the game wants a sound ('hit', 'miss'). */
  sound?: string;
}

const hitKey = (f: Frame) => f.click || f.keys.has('Space') || f.keys.has('KeyE') || f.keys.has('Enter') || !!f.pad[2];

// ---------------------------------------------------------------------------------------------

/** Scrubbing: the crusty pan, or (`mould`) the bathroom ceiling. */
function pan(mould = false): Game {
  const N = 16;
  const dirt = Array.from({ length: N * N }, (_, i) => {
    const x = (i % N) / (N - 1) - 0.5;
    const y = Math.floor(i / N) / (N - 1) - 0.5;
    return Math.hypot(x, y) < 0.48 ? 0.7 + Math.random() * 0.3 : 0;
  });
  const total = dirt.reduce((a, b) => a + b, 0);
  let left = total;
  const R = 140;
  return {
    title: mould ? 'Wipe the mould' : 'Scrub the pan',
    hint: mould ? 'Wipe in circles: get every green spot off the ceiling' : 'Scrub in circles: move the sponge over the crusty bits',
    update(_dt, f, c) {
      const moved = Math.hypot(f.mx, f.my);
      if (moved < 0.5) return;
      for (let i = 0; i < dirt.length; i++) {
        if (!dirt[i]) continue;
        const x = W / 2 + ((i % N) / (N - 1) - 0.5) * 2 * R;
        const y = H / 2 + (Math.floor(i / N) / (N - 1) - 0.5) * 2 * R;
        if (Math.hypot(x - c.x, y - c.y) < 34) {
          const d = Math.min(dirt[i], moved * 0.004);
          dirt[i] -= d;
          left -= d;
        }
      }
    },
    draw(g, c) {
      if (mould) {
        g.fillStyle = '#e8eef0';
        g.fillRect(0, 0, W, H);
      } else {
        g.fillStyle = '#3a3a40';
        g.fillRect(W / 2 + R - 10, H / 2 - 14, 170, 28);
        g.fillStyle = '#56565e';
        g.beginPath();
        g.arc(W / 2, H / 2, R + 12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#76767e';
        g.beginPath();
        g.arc(W / 2, H / 2, R, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < dirt.length; i++) {
        if (dirt[i] < 0.02) continue;
        const x = W / 2 + ((i % N) / (N - 1) - 0.5) * 2 * R;
        const y = H / 2 + (Math.floor(i / N) / (N - 1) - 0.5) * 2 * R;
        g.fillStyle = mould ? `rgba(40, 70, 40, ${dirt[i]})` : `rgba(96, 62, 24, ${dirt[i]})`;
        g.beginPath();
        g.arc(x, y, 13, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f2d44a';
      g.fillRect(c.x - 26, c.y - 16, 52, 32);
      g.fillStyle = '#3f8a4a';
      g.fillRect(c.x - 26, c.y - 16, 52, 10);
    },
    done: () => left / total < 0.08,
  };
}

function plunge(): Game {
  let t = 0;
  let hits = 0;
  let zone = 0.22;
  let flash = 0;
  let push = 0;
  const NEED = 5;
  const g0: Game = {
    title: 'Plunge the toilet',
    hint: 'Click / E / Ⓧ when the marker is in the green. Five good plunges.',
    update(dt, f) {
      t += dt * (1.6 + hits * 0.25);
      flash = Math.max(0, flash - dt);
      push = Math.max(0, push - dt * 3);
      if (!hitKey(f)) return;
      const m = (Math.sin(t * 2.4) + 1) / 2;
      if (Math.abs(m - 0.5) < zone / 2) {
        hits++;
        zone = Math.max(0.12, zone - 0.02);
        push = 1;
        g0.sound = 'hit';
      } else {
        hits = Math.max(0, hits - 1);
        flash = 0.4;
        g0.sound = 'miss';
      }
    },
    draw(g) {
      // The bowl and the plunger.
      g.fillStyle = '#f4f4f0';
      g.beginPath();
      g.ellipse(200, 250, 120, 80, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = flash ? '#8a6a2a' : '#6a8aa8';
      g.beginPath();
      g.ellipse(200, 240, 90, 50, 0, 0, Math.PI * 2);
      g.fill();
      const py = 60 + push * 70;
      g.fillStyle = '#8a5a30';
      g.fillRect(193, py, 14, 150);
      g.fillStyle = '#c0302a';
      g.beginPath();
      g.ellipse(200, py + 150, 46, 26, 0, Math.PI, 0);
      g.fill();
      // The gauge.
      const gx = 400;
      g.fillStyle = '#222';
      g.fillRect(gx, 40, 50, 300);
      g.fillStyle = '#3fae5a';
      g.fillRect(gx, 40 + 300 * (0.5 - zone / 2), 50, 300 * zone);
      const m = (Math.sin(t * 2.4) + 1) / 2;
      g.fillStyle = '#fff36b';
      g.fillRect(gx - 8, 40 + 300 * m - 4, 66, 8);
      g.fillStyle = '#fff';
      g.font = '700 22px system-ui';
      g.fillText(`${hits}/${NEED}`, gx - 2, 370);
    },
    done: () => hits >= NEED,
  };
  return g0;
}

const SOCKS = ['#d94b4b', '#3f7fd9', '#f2c53d'];

function socks(): Game {
  const items = [0, 0, 1, 1, 2, 2]
    .map((c) => ({ c, x: 0, y: 0, hung: false, stripe: Math.random() > 0.5 }))
    .sort(() => Math.random() - 0.5);
  items.forEach((s, i) => {
    s.x = 70 + (i % 3) * 140 + Math.random() * 30;
    s.y = 220 + Math.floor(i / 3) * 80 + Math.random() * 10;
  });
  let held: (typeof items)[number] | null = null;
  let hung = 0;
  let shake = 0;
  const g0: Game = {
    title: 'Pair the socks',
    hint: 'Click a sock, then its twin, to hang the pair on the radiator',
    update(dt, f, c) {
      shake = Math.max(0, shake - dt);
      if (!f.click && !f.pad[2]) return;
      const hit = items.find((s) => !s.hung && Math.abs(s.x - c.x) < 34 && Math.abs(s.y - c.y) < 34);
      if (!hit) return;
      if (!held) {
        held = hit;
        return;
      }
      if (hit === held) return void (held = null);
      if (hit.c === held.c) {
        hit.hung = held.hung = true;
        hit.x = held.x = 110 + hung * 150;
        hit.y = held.y = 70;
        held.x -= 22;
        hit.x += 22;
        hung++;
        g0.sound = 'hit';
      } else {
        shake = 0.3;
        g0.sound = 'miss';
      }
      held = null;
    },
    draw(g) {
      // The radiator.
      g.fillStyle = '#e6e2d8';
      for (let i = 0; i < 14; i++) g.fillRect(40 + i * 32, 40, 24, 110);
      g.fillStyle = '#bdb8ac';
      g.fillRect(36, 30, 448, 10);
      for (const s of items) {
        const wob = s === held ? Math.sin(performance.now() / 60) * 3 : shake && !s.hung ? Math.sin(performance.now() / 20) * 4 : 0;
        g.save();
        g.translate(s.x + wob, s.y);
        g.fillStyle = SOCKS[s.c];
        g.fillRect(-14, -30, 28, 46);
        g.fillRect(-14, 6, 40, 20);
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.fillRect(-14, -30, 28, 8);
        if (s.c === 1) for (let k = 0; k < 3; k++) g.fillRect(-14, -16 + k * 10, 28, 3);
        if (s.c === 2) for (let k = 0; k < 3; k++) g.fillRect(-10 + k * 9, -14, 4, 4);
        if (s === held) {
          g.strokeStyle = '#fff';
          g.lineWidth = 3;
          g.strokeRect(-20, -36, 52, 68);
        }
        g.restore();
      }
    },
    done: () => hung >= 3,
  };
  return g0;
}

type Bin = 0 | 1 | 2;
const BINS = ['Cans', 'Glass', 'Cardboard'];
const TRASH: [string, Bin][] = [
  ['Coors can', 0],
  ['Wine bottle', 1],
  ['Pizza box', 2],
  ['Vodka bottle (empty, obviously)', 1],
  ['Energy drink', 0],
  ['Amazon box', 2],
  ['Hard seltzer', 0],
  ['Pasta sauce jar', 1],
  ['Cereal box', 2],
  ['Sponsored liquor bottle', 1],
  ['“Borrowed” traffic cone box', 2],
];

function recycling(): Game {
  const queue = [...TRASH].sort(() => Math.random() - 0.5).slice(0, 7);
  let i = 0;
  let shake = 0;
  let drop = 0;
  const g0: Game = {
    title: 'Sort the recycling',
    hint: '← / 1 Cans · ↓ / 2 Glass · → / 3 Cardboard (or click a bin)',
    update(dt, f, c) {
      shake = Math.max(0, shake - dt);
      drop = Math.max(0, drop - dt * 4);
      if (i >= queue.length) return;
      let pick: number | null = null;
      if (f.keys.has('ArrowLeft') || f.keys.has('KeyA') || f.keys.has('Digit1') || f.pad[14]) pick = 0;
      else if (f.keys.has('ArrowDown') || f.keys.has('KeyS') || f.keys.has('Digit2') || f.pad[13]) pick = 1;
      else if (f.keys.has('ArrowRight') || f.keys.has('KeyD') || f.keys.has('Digit3') || f.pad[15]) pick = 2;
      else if ((f.click || f.pad[2]) && c.y > 250) pick = Math.max(0, Math.min(2, Math.floor((c.x - 25) / 160)));
      if (pick === null) return;
      if (pick === queue[i][1]) {
        i++;
        drop = 1;
        g0.sound = 'hit';
      } else {
        shake = 0.35;
        g0.sound = 'miss';
      }
    },
    draw(g) {
      BINS.forEach((name, b) => {
        const x = 30 + b * 160;
        g.fillStyle = ['#2f5a8a', '#3f8a5a', '#8a6a3a'][b];
        g.fillRect(x, 260, 140, 100);
        g.fillStyle = '#fff';
        g.font = '700 20px system-ui';
        g.textAlign = 'center';
        g.fillText(name, x + 70, 318);
      });
      if (i < queue.length) {
        const wob = shake ? Math.sin(performance.now() / 18) * 8 : 0;
        g.fillStyle = '#f5efe0';
        g.fillRect(W / 2 - 170 + wob, 80, 340, 80);
        g.fillStyle = '#2a2030';
        g.font = '700 22px system-ui';
        g.textAlign = 'center';
        g.fillText(queue[i][0], W / 2 + wob, 128, 320);
        g.font = '15px system-ui';
        g.fillStyle = '#aaa';
        g.fillText(`${i + 1} of ${queue.length}`, W / 2, 190);
      }
      g.textAlign = 'left';
    },
    done: () => i >= queue.length,
  };
  return g0;
}

/** Find the remote: lift the cushions until it turns up (everything else does first). */
function remote(): Game {
  const finds = ['a single Dorito', '$1.35 in coins', 'a hair tie', 'a bottle cap', 'Nash’s other controller', 'a sock', 'crumbs. so many crumbs'];
  const n = 6;
  const at = Math.floor(Math.random() * n);
  const lifted: string[] = Array(n).fill('');
  let found = false;
  const cushion = (i: number) => ({ x: 40 + (i % 3) * 150, y: 70 + Math.floor(i / 3) * 140 });
  const g0: Game = {
    title: 'Find the remote',
    hint: 'Click the cushions to lift them',
    update(_dt, f, c) {
      if (!f.click && !f.pad[2]) return;
      for (let i = 0; i < n; i++) {
        const p = cushion(i);
        if (lifted[i] || c.x < p.x || c.x > p.x + 140 || c.y < p.y || c.y > p.y + 120) continue;
        lifted[i] = i === at ? 'THE REMOTE' : finds[(i * 3 + at) % finds.length];
        found ||= i === at;
        g0.sound = i === at ? 'hit' : 'miss';
      }
    },
    draw(g) {
      g.fillStyle = '#2d3a5e';
      g.fillRect(20, 50, 480, 300);
      for (let i = 0; i < n; i++) {
        const p = cushion(i);
        g.fillStyle = lifted[i] ? '#1c2440' : '#41548a';
        g.fillRect(p.x, p.y, 140, 120);
        if (lifted[i]) {
          g.fillStyle = lifted[i] === 'THE REMOTE' ? '#fff36b' : '#c9c2e8';
          g.font = '700 15px system-ui';
          g.textAlign = 'center';
          g.fillText(lifted[i], p.x + 70, p.y + 64, 130);
          g.textAlign = 'left';
        }
      }
    },
    done: () => found,
  };
  return g0;
}

/** The bin bag: tie it off (then carry it out to the wheelie bin, which happens in the house). */
function binbag(): Game {
  let knots = 0;
  const g0: Game = {
    title: 'Tie off the bin bag',
    hint: 'Click / E / Ⓧ to knot it (it’s full of pizza boxes). Then carry it out to the wheelie bin.',
    update(_dt, f) {
      if (!f.click && !f.keys.has('KeyE') && !f.keys.has('Space') && !f.pad[2]) return;
      knots++;
      g0.sound = 'hit';
    },
    draw(g) {
      g.fillStyle = '#111114';
      g.beginPath();
      g.ellipse(W / 2, H / 2 + 40, 130 - knots * 6, 110, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a2a30';
      g.fillRect(W / 2 - 20, H / 2 - 100 + knots * 8, 40, 60);
      g.fillStyle = '#fff';
      g.font = '700 22px system-ui';
      g.fillText(`${Math.min(knots, 5)}/5 knots`, W / 2 - 50, 40);
    },
    done: () => knots >= 5,
  };
  return g0;
}

const MAKERS: Record<ChoreKind, () => Game> = { pan: () => pan(), plunge, socks, recycling, remote, mould: () => pan(true), binbag };

/** One chore in progress: draws itself over the view and reports when it's finished. */
export class ChoreView {
  readonly root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private game: Game;
  private cursor = { x: W / 2, y: H / 2 };
  private finished = false;

  constructor(
    parent: HTMLElement,
    kind: ChoreKind,
    /** Called with the game's sounds, and 'done'. */
    private on: (what: 'done' | 'hit' | 'miss') => void,
  ) {
    this.game = MAKERS[kind]();
    this.root.className = 'rd-chore';
    const title = document.createElement('h2');
    title.textContent = this.game.title;
    const hint = document.createElement('p');
    hint.textContent = `${this.game.hint} · Esc to stop`;
    this.canvas.width = W;
    this.canvas.height = H;
    this.root.append(title, this.canvas, hint);
    parent.append(this.root);
  }

  /** Returns true once it's done (the caller sends the chore and closes it). */
  frame(dt: number, f: Frame, speed = 1): boolean {
    if (this.finished) return true;
    this.cursor.x = Math.max(0, Math.min(W, this.cursor.x + f.mx * 0.9));
    this.cursor.y = Math.max(0, Math.min(H, this.cursor.y + f.my * 0.9));
    this.game.update(dt * speed, { ...f, mx: f.mx * speed, my: f.my * speed }, this.cursor);
    if (this.game.sound) {
      this.on(this.game.sound as 'hit' | 'miss');
      this.game.sound = undefined;
    }
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#1d1726';
    g.fillRect(0, 0, W, H);
    this.game.draw(g, this.cursor);
    // The cursor: a little hand.
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.cursor.x, this.cursor.y);
    g.lineTo(this.cursor.x + 14, this.cursor.y + 18);
    g.lineTo(this.cursor.x + 5, this.cursor.y + 18);
    g.lineTo(this.cursor.x, this.cursor.y + 26);
    g.closePath();
    g.fill();
    g.stroke();
    if (this.game.done()) {
      this.finished = true;
      this.on('done');
    }
    return this.finished;
  }

  dispose() {
    this.root.remove();
  }
}
