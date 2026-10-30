import { MOVE } from '../shared/constants.ts';
import './loot.css';
import { Game } from './game.ts';
import { help } from './menu/help.ts';
import { host } from './menu/host.ts';
import { join } from './menu/join.ts';
import { lobby } from './menu/lobby.ts';
import { type Ctx, type DriveOpts, type Joined, type Render, type Screen, type ScreenName, createRouter } from './menu/router.ts';
import { games } from './menu/games.ts';
import { driveHub } from './race/hub.ts';
import { driveLobby } from './race/lobby.ts';
import { RaceGame } from './race/racegame.ts';
import { garage } from './race/garageStore.ts';
import { current } from '../shared/race/garage.ts';
import { setMenuNav, startMenuNav } from './pad.ts';
import { accountScreen } from './menu/account.ts';
import { inventory } from './menu/inventory.ts';
import { settings } from './menu/settings.ts';
import { casino } from './menu/casino.ts';
import { practice } from './menu/practice.ts';
import type { BotLevel } from '../shared/bot.ts';
import { title } from './menu/title.ts';
import { startSkirmish } from './menu/skirmish.ts';
import { account } from './account.ts';
import { FIELD_BACKDROP, SKY_BACKDROP, playerName } from './menu/ui.ts';
import { Net } from './net.ts';
import { loadSettings } from './settings.ts';
import { sfx } from './sfx.ts';
import { setupTouchPage } from './touch.ts';

const app = document.getElementById('app')!;
const SCREENS: Record<Exclude<ScreenName, 'game'>, Render> = { games, title, host, join, lobby, help, settings, account: accountScreen, casino, inventory, practice, drive: driveHub, drivelobby: driveLobby };

/** Whatever is running full screen: a Gambol match or a TOGE race. Browser Back leaves it. */
let game: { exit(): void } | null = null;
let leaveScreen: (() => void) | null = null;

/** The sky stays put while screens swap on top of it. */
function stage(): HTMLElement {
  let el = app.querySelector<HTMLElement>('.menu-stage');
  if (!el) {
    app.innerHTML = `<div class="menu">${FIELD_BACKDROP}<div class="menu-stage"></div></div>`;
    el = app.querySelector<HTMLElement>('.menu-stage')!;
  }
  return el;
}

function show(s: Screen) {
  // Browser Back during a match leaves the match (its onExit brings us back to the title).
  if (game) return game.exit();
  if (s.name === 'game') return router.replace({ name: 'games' });
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
  play: (joined, bots) => void play(joined, bots),
  drive: (opts) => void drive(opts),
  joined: null,
};

// Esc (or B on a controller) = Back everywhere in the menu (in a match, Esc belongs to the game's pause menu).
addEventListener('keydown', (e) => {
  const at = history.state as Screen | null;
  if (e.key === 'Escape' && !game && !(at?.name === 'games' && !at.channel)) router.back();
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

async function play(joined?: Joined, bots?: BotLevel) {
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
  setMenuNav(false);
  game = new Game({
    container: app,
    name: playerName(),
    net: joined ? ctx.net : undefined,
    joined,
    bots,
    onExit: (reason) => {
      game = null;
      ctx.joined = null;
      setMenuNav(true);
      router.replace({ name: 'title', notice: reason });
    },
  });
  // The first rendered frames compile shaders; keep the veil up through them.
  await nextPaint();
  await nextPaint();
  hide();
}

/** Starts a TOGE race with the car you have selected. */
async function drive(opts: DriveOpts) {
  leaveScreen?.();
  leaveScreen = null;
  router.mark({ name: 'game' });
  const hide = showLoading();
  await nextPaint();
  app.innerHTML = '';
  game = new RaceGame({
    container: app,
    track: opts.track,
    name: playerName(),
    car: current(garage.g),
    rivals: opts.rivals,
    online: opts.online,
    onExit: (to, notice) => {
      game = null;
      router.replace(to === 'lobby' ? { name: 'drivelobby' } : { name: 'drive', notice });
    },
  });
  await nextPaint();
  await nextPaint();
  hide();
}

// ---------------------------------------------------------------------------
// Boot. A deep link (/?join=ABCD) lands on the Join page with the code filled in.

setupTouchPage(); // phones: touch styles + the rotate-your-phone card (nothing on desktop)
startMenuNav(); // controllers: D-pad / stick moves focus, A presses, B backs out
void account.refresh(); // who's signed in (the title updates when this lands)

// A reload restores the page you were on, except lobby rooms and matches (the connection is gone).
const deepLink = new URLSearchParams(location.search).get('join');
const raceLink = new URLSearchParams(location.search).get('race');
const restored = history.state as Screen | null;
if (deepLink) {
  history.replaceState({ name: 'games', depth: 0 }, '', location.pathname);
  router.push({ name: 'join', code: deepLink.toUpperCase() });
} else if (raceLink) {
  history.replaceState({ name: 'games', depth: 0 }, '', location.pathname);
  router.push({ name: 'drivelobby', code: raceLink.toUpperCase() });
} else if (restored && restored.name !== 'lobby' && restored.name !== 'drivelobby' && restored.name !== 'game') {
  router.replace({ ...restored, notice: undefined });
} else {
  router.replace({ name: 'games' });
}
