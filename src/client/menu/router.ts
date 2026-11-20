// A tiny history-backed screen router: every screen change is a history entry, so the
// browser's Back button, the on-screen ← Back and Esc all behave the same.

import type { CarRule, GpState, RaceMode, Racer } from '../../kanjo/shared/protocol.ts';
import type { TrackId } from '../../kanjo/shared/track.ts';
import type { GhostRun } from '../../kanjo/shared/ghost.ts';
import type { RaceNet } from '../../kanjo/client/racenet.ts';

/** `drive` is the landing page (KANJO's garage / home), `drivelobby` a race lobby, `game` a race in progress. */
export type ScreenName = 'drive' | 'drivelobby' | 'account' | 'game';

export interface Screen {
  name: ScreenName;
  notice?: string; // drive: why we came back (e.g. "Disconnected")
  code?: string; // drivelobby: the lobby code to join
  dtab?: string; // drive: which garage tab is open
  board?: TrackId; // drive: open the leaderboard on this track (back from watching its record)
  signup?: boolean; // account: open on Create account
  depth?: number; // how many entries deep we are; Back at depth 0 goes home instead of leaving the site
}

/** What every screen gets to work with. */
export interface Ctx {
  go(s: Screen): void;
  replace(s: Screen): void;
  back(): void;
  /** Start a KANJO race: solo against AI rivals, or online once the lobby's countdown arrives. */
  drive(opts: DriveOpts): void;
}

export interface DriveOpts {
  track: TrackId;
  rivals?: number;
  /** Solo: Physics mode (crash damage). Online it comes with the race. */
  physics?: boolean;
  online?: { net: RaceNet; mode: RaceMode; grid: Record<number, number>; racers: Racer[]; rule: CarRule; cars: Record<number, string>; physics: boolean; ghost?: GhostRun | null; solo?: boolean; laps?: number };
  /** A Grand Prix round: the cup, the round and the cup table so far (solo; online it comes with the room's `load`). */
  gp?: GpState;
  /** Watch this track record's run instead of racing (the leaderboard's Watch; racegame.ts `watch`). */
  watch?: GhostRun;
}

/** Renders into `root`; may return a cleanup that runs when the screen is left. */
export type Render = (root: HTMLElement, ctx: Ctx, screen: Screen) => (() => void) | void;

export function createRouter(show: (s: Screen) => void) {
  const depth = () => (history.state as Screen | null)?.depth ?? 0;
  // Drop ?race=… once we start navigating so a reload doesn't re-trigger it.
  const url = () => location.pathname;
  addEventListener('popstate', (e) => show((e.state as Screen | null) ?? { name: 'drive' }));
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
      else router.replace({ name: 'drive' });
    },
  };
  return router;
}
