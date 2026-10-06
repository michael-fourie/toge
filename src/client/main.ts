import { MOVE } from '../shared/constants.ts';
import { Game } from './game.ts';
import { help } from './menu/help.ts';
import { host } from './menu/host.ts';
import { join } from './menu/join.ts';
import { lobby } from './menu/lobby.ts';
import { practice } from './menu/practice.ts';
import { type Ctx, type Joined, type Render, type Screen, type ScreenName, createRouter } from './menu/router.ts';
import { title } from './menu/title.ts';
import { startSkirmish } from './menu/skirmish.ts';
import { SKY_BACKDROP, playerName } from './menu/ui.ts';
import { Net } from './net.ts';
import { loadSettings } from './settings.ts';
import { sfx } from './sfx.ts';

const app = document.getElementById('app')!;
const SCREENS: Record<Exclude<ScreenName, 'game'>, Render> = { title, practice, host, join, lobby, help };

let game: Game | null = null;
let leaveScreen: (() => void) | null = null;

/** The sky stays put while screens swap on top of it. */
function stage(): HTMLElement {
  let el = app.querySelector<HTMLElement>('.menu-stage');
  if (!el) {
    app.innerHTML = `<div class="menu">${SKY_BACKDROP}<div class="menu-stage"></div></div>`;
    startSkirmish(app.querySelector('canvas.skirmish')!);
    el = app.querySelector<HTMLElement>('.menu-stage')!;
  }
  return el;
}

function show(s: Screen) {
  // Browser Back during a match leaves the match (its onExit brings us back to the title).
  if (game) return game.exit();
  if (s.name === 'game') return router.replace({ name: 'title' });
  leaveScreen?.();
  leaveScreen = null;
  leaveScreen = SCREENS[s.name](stage(), ctx, s) ?? null;
}

const router = createRouter(show);

const ctx: Ctx = {
  net: new Net(),
  go: router.push,
  replace: router.replace,
  back: router.back,
  play: (joined) => void play(joined),
  joined: null,
};

// Esc = Back everywhere in the menu (in a match, Esc belongs to the game's pause menu).
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !game && (history.state as Screen | null)?.name !== 'title') router.back();
});
addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-back]')) router.back();
});

// ---------------------------------------------------------------------------
// Entering a match

const LOADING_LINES = ['Catching the wind…', 'Waking the island spirits…', 'Polishing the brass scopes…', 'Fluffing the clouds…', 'Shooing the dust bunnies…'];

/** Resolves after the next paint; falls back to a timeout when the tab is hidden (rAF paused). */
const nextPaint = () =>
  new Promise<void>((res) => {
    requestAnimationFrame(() => res());
    setTimeout(res, 80);
  });

function showLoading(): () => void {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `${SKY_BACKDROP}<div class="loading-card"><div class="leaf"></div><p>${LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]}</p></div>`;
  document.body.appendChild(el);
  startSkirmish(el.querySelector('canvas.skirmish')!);
  const shownAt = performance.now();
  // Hold briefly so it never flashes, then fade away.
  return () => {
    setTimeout(() => {
      el.classList.add('done');
      setTimeout(() => el.remove(), 700);
    }, Math.max(0, 900 - (performance.now() - shownAt)));
  };
}

async function play(joined?: Joined) {
  sfx.unlock();
  leaveScreen?.();
  leaveScreen = null;
  router.mark({ name: 'game' });
  MOVE.autoHop = loadSettings().autoHop;
  const hide = showLoading();
  // Offline we can let the loading screen paint before building the world. Online, build
  // immediately so no lobby messages arrive before the game is listening.
  if (!joined) await nextPaint();
  app.innerHTML = '';
  game = new Game({
    container: app,
    name: playerName(),
    net: joined ? ctx.net : undefined,
    joined,
    onExit: (reason) => {
      game = null;
      ctx.joined = null;
      router.replace({ name: 'title', notice: reason });
    },
  });
  // The first rendered frames compile shaders; keep the veil up through them.
  await nextPaint();
  await nextPaint();
  hide();
}

// ---------------------------------------------------------------------------
// Boot. A deep link (/?join=ABCD) lands on the Join page with the code filled in.

// A reload restores the page you were on, except the lobby room and matches (the connection is gone).
const deepLink = new URLSearchParams(location.search).get('join');
const restored = history.state as Screen | null;
if (deepLink) {
  history.replaceState({ name: 'title', depth: 0 }, '', location.pathname);
  router.push({ name: 'join', code: deepLink.toUpperCase() });
} else if (restored && restored.name !== 'lobby' && restored.name !== 'game') {
  router.replace({ ...restored, notice: undefined });
} else {
  router.replace({ name: 'title' });
}
