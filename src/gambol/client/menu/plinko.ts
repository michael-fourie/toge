import { PLINKO_MULT, PLINKO_ROWS, type PlinkoDrop, plinkoPayout } from '../../shared/casino.ts';
import { stash } from '../inventoryStore.ts';
import { sfx } from '../sfx.ts';
import { coinText } from './lootui.ts';
import { $, toast } from '../../../client/menu/ui.ts';

const W = 560;
const H = 620;
const DX = 38; // peg spacing
const DY = 36;
const TOP = 70; // y of the first peg row
const SLOT_Y = TOP + PLINKO_ROWS * DY + 6;
const STEP = 0.2; // seconds per bounce

interface Ball {
  drop: PlinkoDrop;
  bet: number;
  t: number;
  settled: boolean;
  tick: number;
}

const colour = (m: number) => (m >= 10 ? '#e0483c' : m >= 5 ? '#f08a3a' : m >= 2 ? '#f2c14e' : m >= 1 ? '#8cc46a' : '#8fa6c4');

/** Where the ball is `t` seconds after being dropped: bounces down a peg per STEP, then settles into its slot. */
function ballAt(path: readonly number[], t: number): { x: number; y: number; row: number } {
  const pts: { x: number; y: number }[] = [{ x: 0, y: TOP - DY }];
  let pos = 0;
  path.forEach((d, r) => {
    pts.push({ x: (pos - r / 2) * DX, y: TOP + r * DY - 9 });
    pos += d;
  });
  pts.push({ x: (pos - PLINKO_ROWS / 2) * DX, y: SLOT_Y + 28 });
  const i = Math.min(pts.length - 2, Math.floor(t / STEP));
  const u = Math.min(1, t / STEP - i);
  const a = pts[i];
  const b = pts[i + 1];
  const bump = i === pts.length - 2 ? 0 : 11 * Math.sin(Math.PI * u) * (1 - u);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * (0.3 * u + 0.7 * u * u) - bump, row: i };
}

/** The Plinko tab: bet any amount of coins, the ball bounces down the pegs into a multiplier slot. */
export function mountPlinko(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="plinko">
      <canvas width="${W * 2}" height="${H * 2}" aria-label="Plinko board"></canvas>
      <div class="plinko-side">
        <label class="bet-field">Bet
          <input id="pl-bet" type="number" min="1" step="1" value="10" inputmode="numeric" />
        </label>
        <div class="bet-quick">
          <button class="pick" data-bet="min">Min</button><button class="pick" data-bet="half">½</button><button class="pick" data-bet="double">2×</button><button class="pick" data-bet="max">Max</button>
        </div>
        <button class="primary big" id="pl-drop">Drop ball</button>
        <p class="notice" id="pl-note" role="status"></p>
        <h4>Recent drops</h4>
        <ul class="plinko-log" id="pl-log" aria-live="polite"></ul>
      </div>
    </div>`;
  const canvas = $<HTMLCanvasElement>(root, 'canvas');
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  const bet = $<HTMLInputElement>(root, '#pl-bet');
  const dropBtn = $<HTMLButtonElement>(root, '#pl-drop');
  const note = $(root, '#pl-note');
  const log = $(root, '#pl-log');
  const balls: Ball[] = [];
  const flash = new Map<number, number>(); // slot -> time left of its glow
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const amount = () => Math.floor(Number(bet.value));
  const sync = () => {
    const n = amount();
    dropBtn.disabled = !(n >= 1 && n <= stash.inv.coins);
    note.textContent = n > stash.inv.coins ? 'Not enough coins' : n < 1 || !Number.isFinite(n) ? 'Bet at least 1 coin' : '';
  };
  bet.addEventListener('input', sync);
  const offStash = stash.onChange(sync);
  sync();

  root.querySelector('.bet-quick')!.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-bet]')?.dataset.bet;
    const n = Math.max(1, amount() || 1);
    const next = k === 'min' ? 1 : k === 'half' ? Math.max(1, Math.floor(n / 2)) : k === 'double' ? n * 2 : stash.inv.coins;
    bet.value = String(Math.max(1, Math.min(next, Math.max(1, stash.inv.coins))));
    sync();
  });

  const settle = (b: Ball) => {
    if (b.settled) return;
    b.settled = true;
    const pay = plinkoPayout(b.bet, b.drop.slot);
    if (pay > 0) stash.reveal(pay); // paid when it was dropped; the counter shows it as it lands
    const m = PLINKO_MULT[b.drop.slot];
    flash.set(b.drop.slot, 1);
    if (pay > b.bet) sfx.coin();
    const li = document.createElement('li');
    li.style.setProperty('--c', colour(m));
    li.innerHTML = `<b>${m}×</b><span>${pay >= b.bet ? '+' : '−'}${coinText(Math.abs(pay - b.bet))}</span>`;
    log.prepend(li);
    while (log.children.length > 8) log.lastElementChild!.remove();
  };

  dropBtn.addEventListener('click', async () => {
    const n = amount();
    sfx.unlock();
    const r = await stash.act({ a: 'plinko', bet: n }, { hold: true }); // the dice are the server's for an account
    if (!r.ok || !r.drop) return toast(r.ok ? 'Something went wrong.' : r.error);
    const ball: Ball = { drop: r.drop, bet: n, t: 0, settled: false, tick: -1 };
    if (still || gone) settle(ball);
    else balls.push(ball);
    sync();
  });

  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, 0);
    // Board
    g.fillStyle = '#fbf4e2';
    g.strokeStyle = '#e8d9b8';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-W / 2 + 6, 6, W - 12, H - 12, 22);
    g.fill();
    g.stroke();
    // Pegs
    g.fillStyle = '#7d6650';
    for (let r = 0; r < PLINKO_ROWS; r++)
      for (let i = 0; i <= r; i++) {
        g.beginPath();
        g.arc((i - r / 2) * DX, TOP + r * DY, 4.2, 0, Math.PI * 2);
        g.fill();
      }
    // Slots
    PLINKO_MULT.forEach((m, k) => {
      const x = (k - PLINKO_ROWS / 2) * DX;
      const glow = flash.get(k) ?? 0;
      g.fillStyle = colour(m);
      g.globalAlpha = 0.55 + glow * 0.45;
      g.beginPath();
      g.roundRect(x - DX / 2 + 2, SLOT_Y, DX - 4, 44 + glow * 6, 8);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#4a3726';
      g.font = `800 ${m >= 10 ? 13 : 14}px Manrope, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(`${m}×`, x, SLOT_Y + 27);
    });
    // Balls
    for (const b of balls) {
      const p = ballAt(b.drop.path, b.t);
      g.fillStyle = '#d9584a';
      g.strokeStyle = '#4a3726';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff88';
      g.beginPath();
      g.arc(p.x - 3, p.y - 3, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const b of balls) {
      b.t += dt;
      const row = Math.floor(b.t / STEP);
      if (row !== b.tick && row <= PLINKO_ROWS) {
        b.tick = row;
        if (row >= 1) sfx.caseTick();
      }
      if (b.t >= (PLINKO_ROWS + 1) * STEP + 0.15) settle(b);
    }
    for (let i = balls.length - 1; i >= 0; i--) if (balls[i].settled) balls.splice(i, 1);
    for (const [k, v] of flash) v <= dt ? flash.delete(k) : flash.set(k, v - dt * 1.4);
    draw();
  };
  raf = requestAnimationFrame(frame);
  draw();

  let gone = false;
  return () => {
    gone = true;
    cancelAnimationFrame(raf);
    offStash();
    for (const b of balls) settle(b); // leaving mid-drop still pays out
  };
}
