import { CRASH, crashMult, crashPayout, crashTime } from '../../shared/casino.ts';
import { stash } from '../inventoryStore.ts';
import { sfx } from '../sfx.ts';
import { coinText } from './lootui.ts';
import { $, toast } from '../../../client/menu/ui.ts';

// Crash, as a kite on the wind: it climbs and the multiplier with it, until the string snaps. Cash out before it does.

const W = 560;
const H = 380;
const PAD = { l: 46, r: 18, t: 18, b: 34 };
const AFTER = 1.6; // seconds the snapped kite tumbles before you can launch again
const PEEK_MS = 350; // how often a flying kite asks whether it has snapped

type Phase = 'idle' | 'flying' | 'snapped';

interface Round {
  bet: number;
  at: number; // where it snaps: Infinity until the table (the server, for an account) says it has
  t: number; // seconds since launch
  cashed: number | null; // multiplier we got out at
  done: number; // seconds since it snapped
}

const colour = (m: number) => (m >= 10 ? '#e0483c' : m >= 3 ? '#f08a3a' : m >= 2 ? '#f2c14e' : m >= 1.2 ? '#8cc46a' : '#8fa6c4');

/** The Crash tab. Returns a cleanup: leaving mid-flight cashes you out where the kite is. */
export function mountCrash(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="crash">
      <canvas width="${W * 2}" height="${H * 2}" aria-label="Crash: the kite's multiplier"></canvas>
      <div class="plinko-side">
        <label class="bet-field">Bet
          <input id="cr-bet" type="number" min="1" step="1" value="10" inputmode="numeric" />
        </label>
        <div class="bet-quick">
          <button class="pick" data-bet="min">Min</button><button class="pick" data-bet="half">½</button><button class="pick" data-bet="double">2×</button><button class="pick" data-bet="max">Max</button>
        </div>
        <label class="bet-field">Auto cash out at
          <input id="cr-auto" type="number" min="1.01" step="0.1" placeholder="off" inputmode="decimal" />
        </label>
        <button class="primary big" id="cr-go">Launch</button>
        <p class="notice" id="cr-note" role="status"></p>
        <h4>Recent kites</h4>
        <ul class="crash-log" id="cr-log" aria-live="polite"></ul>
      </div>
    </div>`;
  const canvas = $<HTMLCanvasElement>(root, 'canvas');
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  const betIn = $<HTMLInputElement>(root, '#cr-bet');
  const autoIn = $<HTMLInputElement>(root, '#cr-auto');
  const go = $<HTMLButtonElement>(root, '#cr-go');
  const note = $(root, '#cr-note');
  const log = $(root, '#cr-log');
  let phase: Phase = 'idle';
  let round: Round | null = null;
  let lastTenth = 0;

  const amount = () => Math.floor(Number(betIn.value));
  const auto = () => {
    const a = Number(autoIn.value);
    return autoIn.value && a >= 1.01 ? a : null;
  };
  const sync = () => {
    if (phase === 'flying' && round && round.cashed === null) {
      go.disabled = false;
      go.textContent = `Cash out ${crashPayout(round.bet, crashMult(round.t))}`;
      go.classList.add('cash');
      return;
    }
    go.classList.remove('cash');
    go.textContent = 'Launch';
    const n = amount();
    go.disabled = phase !== 'idle' || !(n >= 1 && n <= stash.inv.coins);
    if (phase === 'idle') note.textContent = n > stash.inv.coins ? 'Not enough coins' : n < 1 || !Number.isFinite(n) ? 'Bet at least 1 coin' : '';
  };
  betIn.addEventListener('input', sync);
  const offStash = stash.onChange(sync);

  root.querySelector('.bet-quick')!.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-bet]')?.dataset.bet;
    const n = Math.max(1, amount() || 1);
    const next = k === 'min' ? 1 : k === 'half' ? Math.max(1, Math.floor(n / 2)) : k === 'double' ? n * 2 : stash.inv.coins;
    betIn.value = String(Math.max(1, Math.min(next, Math.max(1, stash.inv.coins))));
    sync();
  });

  /** Asks to get out at `m`; the table pays what it agrees to (it can't be higher than the kite really was). */
  let cashing = false;
  const cashOut = async (m: number) => {
    const r0 = round;
    if (!r0 || r0.cashed !== null || cashing) return;
    cashing = true;
    const r = await stash.act({ a: 'crash', op: 'cash', m });
    cashing = false;
    if (!r.ok || r0 !== round) return;
    if (r.crash?.at !== undefined) r0.at = r.crash.at; // too late: it had already snapped
    if (r.crash?.cashed === undefined) return;
    r0.cashed = r.crash.cashed;
    const pay = r.paid ?? crashPayout(r0.bet, r0.cashed);
    sfx.cash();
    note.innerHTML = `Cashed out at <b>${r0.cashed.toFixed(2)}×</b>: +${coinText(pay - r0.bet)}`;
    note.classList.add('win');
    sync();
  };

  /** While a kite is up, ask the table now and then whether its string has snapped (only it knows where). */
  const peeker = setInterval(async () => {
    const r0 = round;
    if (phase !== 'flying' || !r0 || r0.at !== Infinity) return;
    const r = await stash.act({ a: 'crash', op: 'peek' });
    if (r.ok && r.crash?.at !== undefined && r0 === round) r0.at = r.crash.at;
  }, PEEK_MS);

  const snap = () => {
    if (!round) return;
    phase = 'snapped';
    round.done = 0;
    if (round.cashed === null) {
      sfx.denied();
      note.innerHTML = `The string snapped at <b>${round.at.toFixed(2)}×</b>: −${coinText(round.bet)}`;
    }
    const li = document.createElement('li');
    li.style.setProperty('--c', colour(round.at));
    li.textContent = `${round.at.toFixed(2)}×`;
    log.prepend(li);
    while (log.children.length > 12) log.lastElementChild!.remove();
    sync();
  };

  let launching = false;
  go.addEventListener('click', async () => {
    sfx.unlock();
    if (phase === 'flying') return void cashOut(crashMult(round!.t));
    const n = amount();
    if (launching || phase !== 'idle') return;
    launching = true;
    const r = await stash.act({ a: 'crash', op: 'launch', bet: n });
    launching = false;
    if (!r.ok) return toast(r.error);
    round = { bet: n, at: r.crash?.at ?? Infinity, t: 0, cashed: null, done: 0 };
    phase = 'flying';
    lastTenth = 0;
    note.textContent = '';
    note.classList.remove('win');
    if (round.at <= 1) snap(); // it never got off the ground
    sync();
  });

  // --- Drawing -----------------------------------------------------------------
  /** Axes scale with the flight: time and multiplier both stretch as the kite climbs. */
  const scales = (t: number, m: number) => {
    const tMax = Math.max(8, t * 1.15);
    const mMax = Math.max(2, 1 + (m - 1) * 1.2);
    const x = (tt: number) => PAD.l + (tt / tMax) * (W - PAD.l - PAD.r);
    const y = (mm: number) => H - PAD.b - ((mm - 1) / (mMax - 1)) * (H - PAD.t - PAD.b);
    return { x, y, tMax, mMax };
  };

  const kite = (x: number, y: number, tilt: number, colourA: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(tilt);
    // tail ribbons
    g.strokeStyle = '#e0483c';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 16);
    for (let i = 1; i <= 5; i++) g.lineTo(Math.sin(performance.now() / 160 + i) * 5, 16 + i * 7);
    g.stroke();
    g.fillStyle = colourA;
    g.strokeStyle = '#4a3726';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -18);
    g.lineTo(13, 0);
    g.lineTo(0, 16);
    g.lineTo(-13, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(0, -18);
    g.lineTo(0, 16);
    g.moveTo(-13, 0);
    g.lineTo(13, 0);
    g.stroke();
    g.restore();
  };

  const draw = () => {
    g.clearRect(0, 0, W, H);
    // Sky, warming as the multiplier climbs.
    const over = phase !== 'flying'; // a finished round stays on the board until the next launch
    const m = round ? (over ? round.at : crashMult(round.t)) : 1;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, m >= 5 ? '#f6b26b' : m >= 2 ? '#8fc3ea' : '#a9d6f2');
    sky.addColorStop(1, '#fbf4e2');
    g.fillStyle = sky;
    g.beginPath();
    g.roundRect(0, 0, W, H, 18);
    g.fill();
    const t = round ? (over ? crashTime(round.at) : round.t) : 0;
    const s = scales(t, m);
    // Grid: a few multiplier lines.
    g.font = '700 12px Manrope, system-ui, sans-serif';
    g.textAlign = 'right';
    g.strokeStyle = '#ffffff99';
    g.fillStyle = '#4a372699';
    g.lineWidth = 1;
    const step = s.mMax <= 3 ? 0.5 : s.mMax <= 8 ? 1 : s.mMax <= 30 ? 5 : 25;
    for (let v = 1; v <= s.mMax + 1e-6; v += step) {
      g.beginPath();
      g.moveTo(PAD.l, s.y(v));
      g.lineTo(W - PAD.r, s.y(v));
      g.stroke();
      g.fillText(`${v}×`, PAD.l - 6, s.y(v) + 4);
    }
    // The string (the curve) and the kite on it.
    if (round) {
      g.strokeStyle = over && round.cashed === null ? '#e0483c' : '#4a3726';
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i <= 80; i++) {
        const tt = (t * i) / 80;
        const mm = Math.exp(CRASH.growth * tt);
        if (i === 0) g.moveTo(s.x(tt), s.y(mm));
        else g.lineTo(s.x(tt), s.y(mm));
      }
      g.stroke();
      if (round.cashed !== null) {
        // where we got out
        const tc = crashTime(round.cashed);
        g.fillStyle = '#4a7a3a';
        g.beginPath();
        g.arc(s.x(tc), s.y(round.cashed), 6, 0, Math.PI * 2);
        g.fill();
      }
      const kx = s.x(t);
      const ky = s.y(Math.exp(CRASH.growth * t));
      if (phase === 'snapped') {
        // Cut loose: it tumbles off up and away.
        const d = round.done;
        kite(kx + d * 140, ky - d * 60 + d * d * 160, d * 6, '#c9c3b5');
      } else if (phase === 'flying') kite(kx, ky - 4, -0.5 + Math.sin(performance.now() / 300) * 0.08, '#f2c14e');
    }
    // The big number.
    g.textAlign = 'center';
    g.font = '900 54px Manrope, system-ui, sans-serif';
    const snapped = over && round !== null && round.cashed === null;
    g.fillStyle = snapped ? '#e0483c' : round?.cashed != null ? '#4a7a3a' : '#4a3726';
    g.fillText(`${m.toFixed(2)}×`, W / 2, 86);
    g.font = '800 16px Manrope, system-ui, sans-serif';
    if (!round) g.fillText('Launch the kite, cash out before the string snaps', W / 2, 112);
    else if (over) g.fillText(snapped ? 'SNAPPED!' : `SNAPPED AT ${round.at.toFixed(2)}× · YOU GOT OUT AT ${round.cashed!.toFixed(2)}×`, W / 2, 112);
  };

  // --- Loop --------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase === 'flying' && round) {
      round.t += dt;
      const m = crashMult(round.t);
      const a = auto();
      if (round.cashed === null && a !== null && m >= a) void cashOut(Math.min(a, round.at));
      if (m >= round.at) {
        round.t = crashTime(round.at);
        snap();
      } else {
        const tenth = Math.floor(m * 10);
        if (tenth !== lastTenth) {
          lastTenth = tenth;
          sfx.caseTick();
        }
        if (round.cashed === null) go.textContent = `Cash out ${crashPayout(round.bet, m)}`;
      }
    } else if (phase === 'snapped' && round) {
      round.done += dt;
      if (round.done >= AFTER) {
        phase = 'idle';
        sync();
      }
    }
    draw();
  };
  raf = requestAnimationFrame(frame);
  sync();
  draw();

  return () => {
    cancelAnimationFrame(raf);
    clearInterval(peeker);
    offStash();
    // Leaving mid-flight cashes out where the kite is (it hadn't snapped yet).
    if (phase === 'flying' && round && round.cashed === null) void cashOut(crashMult(round.t));
  };
}
