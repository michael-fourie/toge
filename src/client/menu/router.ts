// A tiny history-backed screen router: every screen change is a history entry, so the
// browser's Back button, the on-screen ← Back and Esc all behave the same.

import type { GameMode, ServerMsg } from '../../shared/protocol.ts';
import type { Net } from '../net.ts';
import type { BotLevel } from '../../shared/bot.ts';
import type { Racer } from '../../shared/race/protocol.ts';
import type { TrackId } from '../../shared/race/track.ts';
import type { RaceNet } from '../race/racenet.ts';

/** `games` is the landing page (the game chooser); `title` is Gambol's home, `drive` TOGE's garage. */
export type ScreenName = 'games' | 'title' | 'host' | 'join' | 'lobby' | 'help' | 'settings' | 'account' | 'casino' | 'inventory' | 'practice' | 'drive' | 'drivelobby' | 'game';

export interface Screen {
  name: ScreenName;
  notice?: string; // title: why we came back (e.g. "Disconnected")
  code?: string; // join / drivelobby: prefilled lobby code
  channel?: string; // games: the open channel page
  dtab?: string; // drive: which garage tab is open
  mode?: GameMode; // host: which game type starts selected
  tab?: 'items' | 'character'; // inventory: which tab opens
  game?: 'cases' | 'plinko' | 'blackjack' | 'crash'; // casino: which game opens
  signup?: boolean; // account: open on Create account
  depth?: number; // how many entries deep we are; Back at depth 0 goes to the title instead of leaving the site
}

export type Joined = Extract<ServerMsg, { t: 'joined' }>;

/** What every screen gets to work with. */
export interface Ctx {
  net: Net;
  go(s: Screen): void;
  replace(s: Screen): void;
  back(): void;
  /** Start a match: offline practice (with bots of `bots` difficulty) without `joined`, online with it. */
  play(joined?: Joined, bots?: BotLevel): void;
  /** The lobby we're sitting in (lobby room), kept fresh until we enter the match. */
  joined: Joined | null;
  /** Start a TOGE race: solo against AI rivals, or online once the lobby's countdown arrives. */
  drive(opts: DriveOpts): void;
}

export interface DriveOpts {
  track: TrackId;
  rivals?: number;
  online?: { net: RaceNet; grid: Record<number, number>; countdownMs: number; racers: Racer[] };
}

/** Renders into `root`; may return a cleanup that runs when the screen is left. */
export type Render = (root: HTMLElement, ctx: Ctx, screen: Screen) => (() => void) | void;

export function createRouter(show: (s: Screen) => void) {
  const depth = () => (history.state as Screen | null)?.depth ?? 0;
  // Drop ?join=… once we start navigating so a reload doesn't re-trigger it.
  const url = () => location.pathname;
  addEventListener('popstate', (e) => show((e.state as Screen | null) ?? { name: 'games' }));
  const router = {
    push(s: Screen) {
      const st = { ...s, depth: depth() + 1 };
      history.pushState(st, '', url());
      show(st);
    },
    /** Record an entry without rendering a screen (entering a match: Back then leaves it). */
    mark(s: Screen) {
      history.pushState({ ...s, depth: depth() + 1 }, '', url());
    },
    replace(s: Screen) {
      const st = { ...s, depth: depth() };
      history.replaceState(st, '', url());
      show(st);
    },
    back() {
      if (depth() > 0) history.back();
      else router.replace({ name: 'games' });
    },
  };
  return router;
}
