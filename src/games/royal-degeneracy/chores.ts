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
      // Grubby bathroom tiles behind, the tank, the seat up, and the bowl: the water clears as you get on top of it.
      g.fillStyle = '#d9d4c4';
      g.fillRect(20, 40, 360, 320);
      g.strokeStyle = 'rgba(120,110,90,0.35)';
      g.lineWidth = 2;
      for (let x = 20; x <= 380; x += 40) g.strokeRect(x, 40, 0, 320);
      for (let y = 40; y <= 360; y += 40) g.strokeRect(20, y, 360, 0);
      g.fillStyle = '#ecebe4';
      g.beginPath();
      g.roundRect(110, 60, 180, 90, 10);
      g.fill();
      g.fillStyle = '#b8b8b0';
      g.fillRect(250, 78, 26, 8);
      g.fillStyle = '#e4e3dc';
      g.beginPath();
      g.ellipse(200, 150, 100, 26, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#f4f4f0';
      g.beginPath();
      g.ellipse(200, 260, 120, 80, 0, 0, Math.PI * 2);
      g.fill();
      const murk = 1 - hits / NEED;
      g.fillStyle = flash ? '#7a5a22' : `rgb(${Math.round(110 + 40 * murk)}, ${Math.round(140 - 30 * murk)}, ${Math.round(170 - 110 * murk)})`;
      g.beginPath();
      g.ellipse(200, 250, 90, 50, 0, 0, Math.PI * 2);
      g.fill();
      // The plunger rides the gauge: it's down in the bowl when the marker's in the green.
      const m = (Math.sin(t * 2.4) + 1) / 2;
      const py = 70 + (1 - Math.abs(m - 0.5) * 2) * 40 + push * 18;
      g.fillStyle = '#8a5a30';
      g.fillRect(193, py, 14, 150);
      g.fillStyle = '#c0302a';
      g.beginPath();
      g.ellipse(200, py + 150, 46 + push * 8, 26 - push * 6, 0, Math.PI, 0);
      g.fill();
      if (push > 0.3) {
        // A splash.
        g.fillStyle = 'rgba(170,200,220,0.8)';
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc(200 + Math.cos(i) * 70 * (1.3 - push), 236 - Math.abs(Math.sin(i * 2)) * 50 * (1.3 - push), 5, 0, Math.PI * 2);
          g.fill();
        }
      }
      // The gauge.
      const gx = 400;
      g.fillStyle = '#222';
      g.fillRect(gx, 40, 50, 300);
      g.fillStyle = '#3fae5a';
      g.fillRect(gx, 40 + 300 * (0.5 - zone / 2), 50, 300 * zone);
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

/** A piece of rubbish centred at (x, y): a dented can, a bottle or a flattened box. */
function trash(g: CanvasRenderingContext2D, x: number, y: number, kind: Bin, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(-0.15);
  if (kind === 0) {
    g.fillStyle = '#c8ccd4';
    g.beginPath();
    g.roundRect(-22, -40, 44, 80, 8);
    g.fill();
    g.fillStyle = '#c0303a';
    g.fillRect(-22, -18, 44, 34);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(-14, -36, 6, 72);
  } else if (kind === 1) {
    g.fillStyle = 'rgba(70,130,80,0.9)';
    g.beginPath();
    g.roundRect(-20, -14, 40, 58, 8);
    g.fill();
    g.fillRect(-8, -46, 16, 34);
    g.fillStyle = '#e8dcc0';
    g.fillRect(-18, 4, 36, 22);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(-13, -8, 5, 46);
  } else {
    g.fillStyle = '#b8894e';
    g.fillRect(-52, -30, 104, 60);
    g.strokeStyle = '#8a6232';
    g.lineWidth = 3;
    g.strokeRect(-52, -30, 104, 60);
    g.fillStyle = 'rgba(120,70,30,0.5)';
    g.beginPath();
    g.ellipse(12, 4, 16, 10, 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d8c8a8';
    g.fillRect(-30, -30, 18, 60);
  }
  g.restore();
}

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
      // Three wheelie bins by the back steps, lids propped open.
      g.textAlign = 'center';
      BINS.forEach((name, b) => {
        const x = 30 + b * 160;
        const col = ['#2f5a8a', '#3f8a5a', '#8a6a3a'][b];
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x + 8, 262);
        g.lineTo(x + 132, 262);
        g.lineTo(x + 124, 362);
        g.lineTo(x + 16, 362);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 4, 250, 132, 14);
        g.fillStyle = col;
        g.fillRect(x + 2, 236, 136, 12);
        g.fillStyle = '#16141a';
        g.beginPath();
        g.arc(x + 26, 362, 9, 0, Math.PI * 2);
        g.arc(x + 114, 362, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = '700 19px system-ui';
        g.fillText(name, x + 70, 312);
        g.font = '12px system-ui';
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillText(`${b + 1}`, x + 70, 332);
      });
      // What you just sorted, falling into its bin.
      if (drop > 0 && i > 0) {
        const b = queue[i - 1][1];
        trash(g, 100 + b * 160, 250 - drop * 120, b, 0.6);
      }
      if (i < queue.length) {
        const wob = shake ? Math.sin(performance.now() / 18) * 8 : 0;
        trash(g, W / 2 + wob, 120, queue[i][1], 1);
        g.fillStyle = '#f5efe0';
        g.font = '700 22px system-ui';
        g.fillText(queue[i][0], W / 2 + wob, 196, 420);
        g.font = '14px system-ui';
        g.fillStyle = '#aaa';
        g.fillText(`${i + 1} of ${queue.length}`, W / 2, 218);
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
    draw(g, c) {
      // The black leather couch from above: its frame and back, six cushions with a sheen, piping and creases.
      g.fillStyle = '#141216';
      g.beginPath();
      g.roundRect(14, 40, 492, 320, 26);
      g.fill();
      g.fillStyle = '#1f1c22';
      g.fillRect(30, 52, 460, 14);
      for (let i = 0; i < n; i++) {
        const p = cushion(i);
        if (lifted[i]) {
          // The crevice underneath: dark fabric, crumbs, and whatever's been living there.
          g.fillStyle = '#0b0a0d';
          g.fillRect(p.x, p.y, 140, 120);
          g.fillStyle = 'rgba(200,170,110,0.55)';
          for (let k = 0; k < 14; k++) g.fillRect(p.x + 10 + ((k * 37 + i * 11) % 120), p.y + 12 + ((k * 23 + i * 7) % 96), 3, 2);
          const remote = lifted[i] === 'THE REMOTE';
          if (remote) {
            g.save();
            g.translate(p.x + 70, p.y + 52);
            g.rotate(-0.4);
            g.fillStyle = '#2a2a30';
            g.beginPath();
            g.roundRect(-14, -36, 28, 72, 8);
            g.fill();
            g.fillStyle = '#e04848';
            g.beginPath();
            g.arc(0, -24, 5, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#9a9aa8';
            for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) g.fillRect(-9 + k * 7, -10 + r * 9, 4, 4);
            g.restore();
          }
          g.fillStyle = remote ? '#fff36b' : '#c9c2e8';
          g.font = '700 15px system-ui';
          g.textAlign = 'center';
          g.fillText(lifted[i], p.x + 70, p.y + (remote ? 108 : 64), 130);
          g.textAlign = 'left';
          continue;
        }
        const hover = c.x > p.x && c.x < p.x + 140 && c.y > p.y && c.y < p.y + 120;
        const sheen = g.createLinearGradient(p.x, p.y, p.x + 60, p.y + 120);
        sheen.addColorStop(0, hover ? '#4c4652' : '#38343e');
        sheen.addColorStop(0.35, '#26232b');
        sheen.addColorStop(1, '#1a181e');
        g.fillStyle = sheen;
        g.beginPath();
        g.roundRect(p.x + 2, p.y + 2, 136, 116, 16);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(p.x + 9, p.y + 9, 122, 102, 11);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.07)';
        g.beginPath();
        g.moveTo(p.x + 30, p.y + 80 + (i % 2) * 8);
        g.quadraticCurveTo(p.x + 70, p.y + 70, p.x + 112, p.y + 86);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.ellipse(p.x + 40, p.y + 30, 22, 8, -0.4, 0, Math.PI * 2);
        g.fill();
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
      // A lumpy black bag, pizza box corners poking at it, its yellow ties pulled tighter with every knot.
      const k = Math.min(knots, 5);
      const cx = W / 2;
      const neck = 70 - k * 11;
      // Standing on the kitchen lino.
      g.fillStyle = '#d8ceb4';
      g.fillRect(20, 60, W - 40, 300);
      g.strokeStyle = 'rgba(110,95,70,0.35)';
      g.lineWidth = 2;
      for (let x = 20; x <= W - 20; x += 60) g.strokeRect(x, 60, 0, 300);
      for (let y = 60; y <= 360; y += 60) g.strokeRect(20, y, W - 40, 0);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.ellipse(cx, 352, 150, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#121216';
      g.beginPath();
      g.moveTo(cx - neck / 2, 120);
      g.bezierCurveTo(cx - 170, 150, cx - 160, 350, cx - 40, 352);
      g.lineTo(cx + 40, 352);
      g.bezierCurveTo(cx + 175, 345, cx + 160, 160, cx + neck / 2, 120);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 3;
      for (const [x0, y0, x1, y1] of [[-90, 190, -40, 300], [60, 170, 110, 260], [-20, 230, 30, 330]]) {
        g.beginPath();
        g.moveTo(cx + x0, y0);
        g.quadraticCurveTo(cx + (x0 + x1) / 2 + 20, (y0 + y1) / 2, cx + x1, y1);
        g.stroke();
      }
      // A pizza box corner straining through.
      g.fillStyle = '#26262c';
      g.beginPath();
      g.moveTo(cx + 120, 210);
      g.lineTo(cx + 150, 246);
      g.lineTo(cx + 118, 262);
      g.fill();
      // The neck and the ties.
      g.fillStyle = '#1c1c22';
      g.fillRect(cx - neck / 2, 92, neck, 32);
      g.strokeStyle = '#f2c53d';
      g.lineWidth = 5;
      const ears = 46 - k * 6;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx, 100);
        g.quadraticCurveTo(cx + s * ears, 50 + k * 4, cx + s * (ears * 0.4), 96);
        g.stroke();
      }
      for (let j = 0; j < k; j++) {
        g.fillStyle = '#e0b030';
        g.beginPath();
        g.arc(cx, 104 - j * 5, 7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.font = '700 22px system-ui';
      g.textAlign = 'center';
      g.fillText(`${k}/5 knots`, cx, 40);
      g.textAlign = 'left';
    },
    done: () => knots >= 5,
  };
  return g0;
}

/** Rolling a joint: grind it, sprinkle it along the paper, roll it up, lick and seal. */
function roll(): Game {
  let stage = 0;
  let grinds = 0;
  let sprinkled = 0;
  let rolls = 0;
  let lastY = 0;
  const steps = ['Grind it (click ×4)', 'Sprinkle it along the paper (sweep across)', 'Roll it up (wiggle up and down)', 'Lick and seal (click)'];
  const g0: Game = {
    title: 'Roll a joint',
    hint: 'Grind, sprinkle, roll, lick. Selby makes it look easy.',
    update(_dt, f, c) {
      const click = f.click || f.pad[2] || f.keys.has('KeyE');
      if (stage === 0 && click && ++grinds >= 4) stage = 1;
      else if (stage === 1 && c.y > 200 && c.y < 280 && c.x > 90 && c.x < 430) {
        sprinkled = Math.max(sprinkled, (c.x - 90) / 340);
        if (sprinkled > 0.95) stage = 2;
      } else if (stage === 2) {
        if (Math.abs(c.y - lastY) > 40) {
          lastY = c.y;
          if (++rolls >= 8) stage = 3;
        }
      } else if (stage === 3 && click) stage = 4;
      if (click) g0.sound = 'hit';
    },
    draw(g) {
      g.fillStyle = '#2a2230';
      g.fillRect(40, 60, 440, 280);
      // The grinder, the paper, the green.
      g.fillStyle = '#9a9aa2';
      g.beginPath();
      g.arc(110, 130, 40 - (stage > 0 ? 0 : grinds * 3), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f4f1e6';
      const paperH = stage >= 2 ? Math.max(14, 60 - rolls * 6) : 60;
      g.fillRect(90, 240 - paperH / 2, 340, paperH);
      g.fillStyle = '#4a8a3a';
      g.fillRect(90, 232, 340 * (stage >= 2 ? 1 : sprinkled), 16);
      g.fillStyle = '#fff';
      g.font = '700 20px system-ui';
      g.fillText(stage < 4 ? steps[stage] : 'Beautiful.', 60, 40);
    },
    done: () => stage >= 4,
  };
  return g0;
}

const MAKERS: Record<ChoreKind | 'roll', () => Game> = { pan: () => pan(), plunge, socks, recycling, remote, mould: () => pan(true), binbag, roll };

/** One chore in progress: draws itself over the view and reports when it's finished. */
export class ChoreView {
  readonly root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private game: Game;
  private cursor = { x: W / 2, y: H / 2 };
  private finished = false;

  constructor(
    parent: HTMLElement,
    kind: ChoreKind | 'roll',
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
