// Wire protocol. JSON for the prototype; swap to a binary encoding once the shape settles.

export type V3 = [number, number, number];

export interface LobbyInfo {
  code: string;
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
}

/** Per-player state inside a snapshot. Flags: 1 = on ground, 2 = wallrunning. */
export interface NetPlayerState {
  id: number;
  p: V3;
  v: V3;
  yaw: number;
  pitch: number;
  f: number;
}

export const StateFlag = { Ground: 1, Wallrun: 2, Scoped: 4, Sliding: 8 } as const;

export type DeathCause = 'snipe' | 'headshot' | 'void';

// Client -> server
export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'list' }
  | { t: 'host' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'state'; p: V3; v: V3; yaw: number; pitch: number; f: number }
  | { t: 'shoot'; from: V3; to: V3; victim?: number; headshot?: boolean }
  | { t: 'fell' };

// Server -> client
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'lobbies'; lobbies: LobbyInfo[] }
  | { t: 'joined'; code: string; hostId: number; players: PlayerInfo[]; spawn: { p: V3; yaw: number } }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number; hostId: number }
  | { t: 'snapshot'; players: NetPlayerState[] }
  | { t: 'shot'; id: number; from: V3; to: V3 }
  | { t: 'kill'; killer: number; victim: number; cause: DeathCause; dir: V3 }
  | { t: 'respawn'; id: number; p: V3; yaw: number }
  | { t: 'error'; message: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
