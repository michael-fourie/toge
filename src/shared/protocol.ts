// Wire protocol. JSON for the prototype; swap to a binary encoding once the shape settles.

import type { Team, Winner } from './teams.ts';

export type V3 = [number, number, number];

/** Battle: free-for-all snipers. Survival: co-op against rounds of zombies. */
export type GameMode = 'battle' | 'survival';

export interface LobbyInfo {
  code: string;
  mode: GameMode;
  /** Battle only: two teams instead of free-for-all. */
  teams?: boolean;
  host: string;
  players: number;
  max: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  kills: number;
  deaths: number;
  alive: boolean;
  /** Battle teams only: 0 = Sunset, 1 = Tide (shared/teams.ts). `color` is the team colour then. */
  team?: Team;
  /** Chosen look, as an encoded skin (shared/skin.ts); absent = seeded from name + colour. */
  skin?: string;
}

/** Per-player state inside a snapshot. Flags: 1 = on ground, 2 = wallrunning. */
export interface NetPlayerState {
  id: number;
  p: V3;
  v: V3;
  yaw: number;
  pitch: number;
  f: number;
  /** Grapple anchor while the rope is out, so everyone can see it. */
  g?: V3;
}

export const StateFlag = { Wallrun: 1, Sliding: 2 } as const;

/** A zombie inside a snapshot. Flags: ZombieFlag. */
export interface NetZombie {
  id: number;
  p: V3;
  yaw: number;
  f: number;
}

export const ZombieFlag = { Clawing: 1, Crouching: 2 } as const;

/** Survival round state. `timer` counts down to the next phase change (0 while a round is on). */
export type WavePhase = 'intermission' | 'active' | 'over';
export interface WaveInfo {
  round: number;
  phase: WavePhase;
  left: number;
  timer: number;
}

/** One line of the Survival post-game board. `gone` players left mid-run but keep their kills. */
export interface PostRow {
  id: number;
  name: string;
  color: number;
  kills: number;
  ready: boolean;
  gone: boolean;
}

export type DeathCause = 'snipe' | 'headshot' | 'void' | 'zombie' | 'grenade';

// Client -> server
export type ClientMsg =
  | { t: 'state'; p: V3; v: V3; yaw: number; pitch: number; f: number; g?: V3 }
  | { t: 'shoot'; from: V3; to: V3; victim?: number; zombie?: number; headshot?: boolean }
  | { t: 'fell' }
  | { t: 'nade'; p: V3; v: V3 } // threw a grenade (server rate-limits to GRENADE.cooldown and relays it)
  | { t: 'boom'; p: V3 } // our grenade went off here (server checks it's ours, then does the damage)
  | { t: 'again' } // Survival post-game: ready for another run
  | { t: 'punch' } // Survival: buy the Pack-a-Punch upgrade (server checks range, points, not owned)
  | { t: 'jug' } // Survival: buy Juggernog (same checks)
  | { t: 'team'; team: Team } // Battle teams: switch to this side (before the match is over)
  | { t: 'shuffle' }; // Battle teams: host only, randomise everyone's side

// Server -> client
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'joined'; code: string; mode: GameMode; hostId: number; teams?: boolean; players: PlayerInfo[]; spawn: { p: V3; yaw: number }; wave?: WaveInfo }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number; hostId: number }
  | { t: 'snapshot'; players: NetPlayerState[]; zombies?: NetZombie[] }
  | { t: 'nade'; id: number; p: V3; v: V3 } // someone else's grenade left their hand
  | { t: 'blast'; id: number; p: V3 } // a grenade exploded here (everyone shows it and takes the shove)
  | { t: 'shot'; id: number; from: V3; to: V3; up?: boolean } // up: fired from a Pack-a-Punched rifle
  | { t: 'kill'; killer: number; victim: number; cause: DeathCause; dir: V3 }
  | { t: 'respawn'; id: number; p: V3; yaw: number }
  // Battle teams and matches
  | { t: 'teams'; players: { id: number; team: Team; color: number }[] } // new sides (a switch or a shuffle)
  | { t: 'matchOver'; winner: Winner; players: PlayerInfo[]; restartIn: number } // someone hit the kill limit
  | { t: 'matchStart'; players: PlayerInfo[] } // scores zeroed, everyone respawns (a `respawn` follows for each)
  // Survival
  | { t: 'wave'; wave: WaveInfo }
  | { t: 'zombieDied'; id: number; killer: number; headshot: boolean; dir: V3 }
  | { t: 'postgame'; rounds: number; rows: PostRow[]; waiting: number } // game-over board, resent when readiness changes
  | { t: 'hp'; hp: number; from?: V3 } // only to the player concerned; `from` is where the claw came from
  | { t: 'pts'; pts: number; up?: boolean; jug?: boolean } // only to the player concerned: their points, and whether their rifle is punched
  | { t: 'error'; message: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
