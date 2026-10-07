// A tiny history-backed screen router: every screen change is a history entry, so the
// browser's Back button, the on-screen ← Back and Esc all behave the same.

import type { ServerMsg } from '../../shared/protocol.ts';
import type { Net } from '../net.ts';

export type ScreenName = 'title' | 'practice' | 'host' | 'join' | 'lobby' | 'help' | 'skin' | 'game';

export interface Screen {
  name: ScreenName;
  notice?: string; // title: why we came back (e.g. "Disconnected")
  code?: string; // join: prefilled lobby code
  depth?: number; // how many entries deep we are; Back at depth 0 goes to the title instead of leaving the site
}

export type Joined = Extract<ServerMsg, { t: 'joined' }>;

/** What every screen gets to work with. */
export interface Ctx {
  net: Net;
  go(s: Screen): void;
  replace(s: Screen): void;
  back(): void;
  /** Start a match: offline practice without `joined`, online with it. */
  play(joined?: Joined): void;
  /** The lobby we're sitting in (lobby room), kept fresh until we enter the match. */
  joined: Joined | null;
}

/** Renders into `root`; may return a cleanup that runs when the screen is left. */
export type Render = (root: HTMLElement, ctx: Ctx, screen: Screen) => (() => void) | void;

export function createRouter(show: (s: Screen) => void) {
  const depth = () => (history.state as Screen | null)?.depth ?? 0;
  // Drop ?join=… once we start navigating so a reload doesn't re-trigger it.
  const url = () => location.pathname;
  addEventListener('popstate', (e) => show((e.state as Screen | null) ?? { name: 'title' }));
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
      else router.replace({ name: 'title' });
    },
  };
  return router;
}
