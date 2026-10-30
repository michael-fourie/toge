// The contract between the console menu and a game. A game is a folder in src/games/ with a channel.ts
// whose default export is a GameChannel. See src/games/CLAUDE.md and docs/ADDING_A_GAME.md.

import type { Party, PartyInfo } from './party.ts';
import type { readPad, rumble } from '../client/pad.ts';

export interface GameChannel {
  /** Unique, lowercase letters, digits and dashes (it's also the multiplayer room kind). */
  id: string;
  /** Big name on the channel tile and page. */
  title: string;
  /** One line under the title. */
  tagline: string;
  /** A short paragraph for the channel page. */
  about: string;
  /** Little pills on the channel page, e.g. ['1–8 players online', 'Controller'] */
  facts: string[];
  /** Where it sits in the grid (lower first). Built-ins use 1 and 2; leave gaps. Default 100. */
  order?: number;
  /** Draws the animated banner on the tile and the channel page. Stop when the canvas leaves the page. */
  banner(canvas: HTMLCanvasElement): void;
  /**
   * Starts the game full screen inside `root`. Return a cleanup (stop loops, remove listeners, leave
   * parties); it runs when the player leaves (Esc, Ⓑ, browser Back, or api.exit()).
   */
  mount(root: HTMLElement, api: GameApi): (() => void) | void;
}

/** What a game gets from the host site. */
export interface GameApi {
  /** Who's playing: the account's username, or their guest name. */
  name: string;
  signedIn: boolean;
  /** Back to the console menu (runs your cleanup). */
  exit(): void;
  /** Controllers: the first pad's sticks/triggers/buttons (with pressed-this-frame edges), and rumble. */
  readPad: typeof readPad;
  rumble: typeof rumble;
  /**
   * The menus move focus with the D-pad and press with Ⓐ. That's on by default (handy for your own
   * menus: use real <button>s); turn it off while the player is in the action. It's back on when you leave.
   */
  setMenuNav(on: boolean): void;
  /** Online multiplayer for this game: rooms with 4-letter codes, messages relayed between players. */
  party: {
    host(): Promise<Party>;
    join(code: string): Promise<Party>;
    /** Open rooms for this game (for a Join list). */
    list(): Promise<PartyInfo[]>;
  };
}
