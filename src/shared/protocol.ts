// Wire protocol. JSON for the prototype; swap to a binary encoding once the shape settles.

export type V3 = [number, number, number];

/** Battle: free-for-all snipers. Survival: co-op against rounds of zombies. */
export type GameMode = 'battle' | 'survival';

export interface LobbyInfo {
  code: string;
  mode: GameMode;
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

export type DeathCause = 'snipe' | 'headshot' | 'void' | 'zombie';

// Client -> server
export type ClientMsg =
  | { t: 'state'; p: V3; v: V3; yaw: number; pitch: number; f: number; g?: V3 }
  | { t: 'shoot'; from: V3; to: V3; victim?: number; zombie?: number; headshot?: boolean }
  | { t: 'fell' };

// Server -> client
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'joined'; code: string; mode: GameMode; hostId: number; players: PlayerInfo[]; spawn: { p: V3; yaw: number }; wave?: WaveInfo }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number; hostId: number }
  | { t: 'snapshot'; players: NetPlayerState[]; zombies?: NetZombie[] }
  | { t: 'shot'; id: number; from: V3; to: V3 }
  | { t: 'kill'; killer: number; victim: number; cause: DeathCause; dir: V3 }
  | { t: 'respawn'; id: number; p: V3; yaw: number }
  // Survival
  | { t: 'wave'; wave: WaveInfo }
  | { t: 'zombieDied'; id: number; killer: number; headshot: boolean; dir: V3 }
  | { t: 'hp'; hp: number; from?: V3 } // only to the player concerned; `from` is where the claw came from
  | { t: 'error'; message: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
