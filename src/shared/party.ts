// Party rooms: generic online multiplayer for any game in src/games/. The server knows nothing about
// the game; it keeps the roster (who's in, who hosts) and relays each player's messages to the others.
// Games put whatever they like in `data` (JSON, small).

export interface PartyMember {
  id: number;
  name: string;
  /** Signed in (the name is their username). */
  user: boolean;
}

export interface PartyInfo {
  code: string;
  game: string;
  host: string;
  players: number;
  max: number;
  /** The host can close the room to new joiners (e.g. while a round is on). */
  open: boolean;
}

export type PartyServerMsg =
  | { t: 'welcome'; id: number; code: string; game: string }
  | { t: 'members'; hostId: number; members: PartyMember[]; open: boolean }
  /** A message from another player (`from` is their id). */
  | { t: 'msg'; from: number; data: unknown }
  | { t: 'error'; message: string };

export type PartyClientMsg =
  /** To everyone else, or just to `to`. */
  | { t: 'send'; data: unknown; to?: number }
  /** Host only. */
  | { t: 'open'; open: boolean };

export const PARTY = {
  maxPlayers: 12,
  /** Biggest message (bytes of JSON) a client may send. */
  maxBytes: 8192,
  /** Messages per second a client may send (a burst allowance, refilled at this rate). */
  perSecond: 60,
};

/** Game ids double as room kinds: keep them simple. */
export const isGameId = (x: unknown): x is string => typeof x === 'string' && /^[a-z0-9-]{1,24}$/.test(x);
