// The landing page: a game chooser in the style of a classic console home menu. A grid of channels (one per
// game, the rest empty for games to come), a clock in the bottom bar, and a channel page with Menu / Start.
// Works with a mouse, the keyboard (Tab/Enter) and a gamepad (pad.ts moves focus; A starts, B backs out).

import { account } from '../account.ts';
import { gambolBanner, tougeBanner } from './banners.ts';
import type { Render, Screen } from './router.ts';
import { $, esc } from './ui.ts';
import './games.css';

interface Channel {
  id: 'gambol' | 'touge';
  title: string;
  tagline: string;
  about: string;
  facts: string[];
  banner: (c: HTMLCanvasElement) => void;
  /** Where Start goes. */
  start: Screen;
}

const CHANNELS: Channel[] = [
  {
    id: 'gambol',
    title: 'GAMBOL',
    tagline: 'Sky-island sniper brawls',
    about: 'Bhop, surf, slide and wallrun across floating islands with an AWP. Battle, King of the Hill, Battle Royale and Survival.',
    facts: ['1–12 players online', 'Practice vs bots', 'Mouse & keyboard'],
    banner: gambolBanner,
    start: { name: 'title' },
  },
  {
    id: 'touge',
    title: 'TŌGE',
    tagline: 'Mountain pass racing',
    about: 'Race your lobby down the mountain. Real tyre and suspension physics, two passes to master, prize money to gamble on upgrades, and a garage that follows your account.',
    facts: ['1–8 players online', 'Solo vs rivals', 'Controller recommended'],
    banner: tougeBanner,
    start: { name: 'drive' },
  },
];

const SLOTS = 12;

let audio: AudioContext | null = null;
/** Soft UI blips (synthesised): a tick on focus, a two-note chime on select. */
function blip(kind: 'tick' | 'open' | 'start') {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const notes = kind === 'tick' ? [[1760, 0, 0.035, 0.025]] : kind === 'open' ? [[880, 0, 0.12, 0.04], [1318, 0.07, 0.16, 0.035]] : [[659, 0, 0.14, 0.04], [988, 0.08, 0.14, 0.04], [1318, 0.16, 0.3, 0.04]];
    for (const [f, delay, dur, vol] of notes) {
      const t = audio.currentTime + delay;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  } catch {
    /* no audio */
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clock(root: HTMLElement): () => void {
  const tick = () => {
    const d = new Date();
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    const time = root.querySelector('.wii-time');
    const date = root.querySelector('.wii-date');
    if (time) time.innerHTML = `${h}<span class="colon">:</span>${m}<small>${d.getHours() < 12 ? 'AM' : 'PM'}</small>`;
    if (date) date.textContent = `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

const BOTTOM_BAR = `
  <footer class="wii-bar">
    <svg class="wii-curve" viewBox="0 0 1600 140" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 40 C 250 40, 330 120, 520 120 L 1080 120 C 1270 120, 1350 40, 1600 40 L 1600 140 L 0 140 Z" class="fill"/>
      <path d="M0 40 C 250 40, 330 120, 520 120 L 1080 120 C 1270 120, 1350 40, 1600 40" class="line"/>
    </svg>
    <button class="wii-round left" data-act="account" aria-label="Account"><span class="wii-logo">atrous</span></button>
    <div class="wii-clock" aria-live="off"><div class="wii-time"></div><div class="wii-date"></div></div>
    <button class="wii-round right" data-act="mail" aria-label="Message board"><svg viewBox="0 0 48 36" aria-hidden="true"><rect x="3" y="3" width="42" height="30" rx="4"/><path d="M5 6 L24 21 L43 6"/></svg></button>
  </footer>`;

export const games: Render = (root, ctx, screen) => {
  const open = CHANNELS.find((c) => c.id === screen.channel);
  return open ? channelPage(root, ctx, open) : grid(root, ctx);
};

function grid(root: HTMLElement, ctx: Parameters<Render>[1]): () => void {
  const tiles = Array.from({ length: SLOTS }, (_, i) => {
    const c = CHANNELS[i];
    if (!c) return `<div class="wii-tile vacant" aria-hidden="true"></div>`;
    return `
      <button class="wii-tile ${c.id}" data-ch="${c.id}" aria-label="${esc(c.title)}: ${esc(c.tagline)}" ${i === 0 ? 'data-autofocus' : ''}>
        <canvas class="wii-banner" aria-hidden="true"></canvas>
        <span class="wii-tile-name">${esc(c.title)}</span>
      </button>`;
  }).join('');
  root.innerHTML = `
    <main class="wii" aria-label="Choose a game">
      <h1 class="sr-only" tabindex="-1">Choose a game</h1>
      <div class="wii-grid">${tiles}</div>
      <p class="wii-hint" aria-hidden="true"><span>Ⓐ Select</span><span>✥ Move</span></p>
      ${BOTTOM_BAR}
      <div class="wii-board" data-nav-scope hidden role="dialog" aria-label="Message board">
        <div class="wii-board-card">
          <h2>Message Board</h2>
          <p><b>New channel: TŌGE.</b> Race your friends down Kōri Pass and the Saltwind Cliffs. Win prize money, gamble it on upgrade crates, paint and tune your car. Sign in to keep your garage.</p>
          <p>Plug in a controller: every menu works with the D-pad, Ⓐ and Ⓑ.</p>
          <button class="wii-pill" data-act="close">OK</button>
        </div>
      </div>
    </main>`;
  CHANNELS.forEach((c) => {
    const canvas = root.querySelector<HTMLCanvasElement>(`[data-ch="${c.id}"] canvas`);
    if (canvas) c.banner(canvas);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => {
    b.addEventListener('click', () => {
      blip('open');
      b.classList.add('zoom');
      setTimeout(() => ctx.go({ name: 'games', channel: b.dataset.ch }), 180);
    });
    b.addEventListener('mouseenter', () => b.focus({ preventScroll: true }));
  });
  root.addEventListener('focusin', (e) => {
    if ((e.target as HTMLElement).matches('.wii-tile, .wii-round, .wii-pill')) blip('tick');
  });
  const board = $(root, '.wii-board');
  root.querySelector('[data-act="mail"]')!.addEventListener('click', () => {
    board.hidden = false;
    $<HTMLButtonElement>(board, 'button').focus();
  });
  board.querySelector('[data-act="close"]')!.addEventListener('click', () => {
    board.hidden = true;
    $<HTMLButtonElement>(root, '[data-act="mail"]').focus();
  });
  root.querySelector('[data-act="account"]')!.addEventListener('click', () => ctx.go({ name: 'account', signup: !account.user }));
  const closeBoard = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !board.hidden) {
      e.stopImmediatePropagation();
      board.hidden = true;
    }
  };
  addEventListener('keydown', closeBoard, true);
  $<HTMLButtonElement>(root, '[data-autofocus]').focus({ preventScroll: true });
  const stopClock = clock(root);
  return () => {
    stopClock();
    removeEventListener('keydown', closeBoard, true);
  };
}

function channelPage(root: HTMLElement, ctx: Parameters<Render>[1], c: Channel): () => void {
  root.innerHTML = `
    <main class="wii wii-channel ${c.id}" aria-label="${esc(c.title)}">
      <section class="wii-stage">
        <canvas class="wii-banner big" aria-hidden="true"></canvas>
        <div class="wii-stage-text">
          <h1 tabindex="-1">${esc(c.title)}</h1>
          <p class="wii-tagline">${esc(c.tagline)}</p>
          <p class="wii-about">${esc(c.about)}</p>
          <ul class="wii-facts">${c.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        </div>
      </section>
      <footer class="wii-channel-bar">
        <button class="wii-pill" data-back>Menu</button>
        <button class="wii-pill start" data-start data-autofocus>Start</button>
      </footer>
    </main>`;
  c.banner($<HTMLCanvasElement>(root, 'canvas'));
  const start = $<HTMLButtonElement>(root, '[data-start]');
  start.addEventListener('click', () => {
    blip('start');
    root.querySelector('.wii-channel')!.classList.add('launch');
    setTimeout(() => ctx.go(c.start), 260);
  });
  root.addEventListener('focusin', () => blip('tick'));
  const quick = () => start.click();
  addEventListener('padstart', quick);
  start.focus({ preventScroll: true });
  return () => removeEventListener('padstart', quick);
}
