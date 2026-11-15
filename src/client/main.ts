import { type Ctx, type DriveOpts, type Render, type Screen, type ScreenName, createRouter } from './menu/router.ts';
import { driveHub } from '../kanjo/client/hub.ts';
import { driveLobby } from '../kanjo/client/lobby.ts';
import { RaceGame } from '../kanjo/client/racegame.ts';
import { showKanjoLoading } from '../kanjo/client/loading.ts';
import { garage } from '../kanjo/client/garageStore.ts';
import { current } from '../kanjo/shared/garage.ts';
import { startMenuNav } from './pad.ts';
import { accountScreen } from './menu/account.ts';
import { account } from './account.ts';
import { playerName } from './menu/ui.ts';
import { setupTouchPage } from './touch.ts';

const app = document.getElementById('app')!;
const SCREENS: Record<Exclude<ScreenName, 'game'>, Render> = { drive: driveHub, drivelobby: driveLobby, account: accountScreen };

/** The race running full screen, if any. Browser Back leaves it. */
let game: { exit(): void } | null = null;
let leaveScreen: (() => void) | null = null;

/** The page the screens swap in and out of (each KANJO screen paints its own background). */
function stage(): HTMLElement {
  let el = app.querySelector<HTMLElement>('.menu-stage');
  if (!el) {
    app.innerHTML = `<div class="menu"><div class="menu-stage"></div></div>`;
    el = app.querySelector<HTMLElement>('.menu-stage')!;
  }
  return el;
}

function show(s: Screen) {
  // Browser Back during a race leaves the race (its onExit brings us back to the garage).
  if (game) return game.exit();
  if (s.name === 'game') return router.replace({ name: 'drive' });
  leaveScreen?.();
  leaveScreen = null;
  leaveScreen = SCREENS[s.name](stage(), ctx, s) ?? null;
}

const router = createRouter(show);

const ctx: Ctx = {
  go: router.push,
  replace: router.replace,
  back: router.back,
  drive: (opts) => void drive(opts),
};

// Esc (or B on a controller) = Back everywhere in the menu (in a race, Esc belongs to the race's pause menu).
addEventListener('keydown', (e) => {
  const at = history.state as Screen | null;
  if (e.key === 'Escape' && !game && !(at?.name === 'drive' && !at.depth)) router.back();
});
addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-back]')) router.back();
});

/** Resolves after the next paint; falls back to a timeout when the tab is hidden (rAF paused). */
const nextPaint = () =>
  new Promise<void>((res) => {
    requestAnimationFrame(() => res());
    setTimeout(res, 80);
  });

/** Starts a race with the car you have selected. `again`: straight on from the last race (it already has the
 * history entry Back leaves the race by). */
async function drive(opts: DriveOpts, again = false) {
  leaveScreen?.();
  leaveScreen = null;
  if (!again) router.mark({ name: 'game' });
  const hide = showKanjoLoading({
    track: opts.track,
    rivals: opts.rivals,
    physics: opts.online ? opts.online.physics : opts.physics,
    online: opts.online && { mode: opts.online.mode, racers: opts.online.racers.length, ...(opts.online.laps ? { laps: opts.online.laps } : {}) },
    gp: opts.gp && { cup: opts.gp.cup, round: opts.gp.round },
  });
  await nextPaint();
  app.innerHTML = '';
  game = new RaceGame({
    container: app,
    track: opts.track,
    name: playerName(),
    car: current(garage.g),
    rider: garage.g.rider,
    rivals: opts.rivals,
    physics: opts.physics,
    online: opts.online,
    gp: opts.gp,
    onExit: (to, notice) => {
      game = null;
      router.replace(to === 'lobby' ? { name: 'drivelobby' } : { name: 'drive', notice });
    },
    // The host raced again from the results: on to the next race.
    onNext: (next) => {
      game = null;
      void drive(next, true);
    },
  });
  await nextPaint();
  await nextPaint();
  hide();
}

// ---------------------------------------------------------------------------
// Boot. A deep link (/?race=ABCD) lands in that race lobby.

setupTouchPage(); // phones: touch styles + the rotate-your-phone card (nothing on desktop)
startMenuNav(); // controllers: D-pad / stick moves focus, A presses, B backs out
void account.refresh(); // who's signed in (the garage updates when this lands)

// A reload restores the page you were on, except race lobbies and races (the connection is gone).
const raceLink = new URLSearchParams(location.search).get('race');
const restored = history.state as Screen | null;
if (raceLink) {
  history.replaceState({ name: 'drive', depth: 0 }, '', location.pathname);
  router.push({ name: 'drivelobby', code: raceLink.toUpperCase() });
} else if (restored && restored.name in SCREENS && restored.name !== 'drivelobby') {
  router.replace({ ...restored, notice: undefined });
} else {
  router.replace({ name: 'drive' });
}
