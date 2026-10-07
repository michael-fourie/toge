// Wire protocol. JSON for the prototype; swap to a binary encoding once the shape settles.

import type { Slot, WeaponId } from './weapons.ts';

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

/** A zombie a shot hit (a shotgun blast can hit several). */
export interface ZombieHit {
  z: number;
  h?: boolean;
}

export type UseKind = 'door' | 'wall' | 'box' | 'take' | 'punch' | 'jug' | 'board';

/** The Mystery Box. Closed: pay to open. Rolling: cycling guns. Ready: `owner` may take `gun` (null: the plush, which gives the points back). Leaving: it is moving to another spot. */
type BoxPhase = 'closed' | 'rolling' | 'ready' | 'leaving';
export interface BoxState {
  spot: number;
  phase: BoxPhase;
  gun: WeaponId | null;
  owner: number;
  /** Seconds left in this phase. */
  left: number;
}

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
  | { t: 'shoot'; from: V3; to: V3; victim?: number; headshot?: boolean; hits?: ZombieHit[] }
  | { t: 'fell' }
  | { t: 'nade'; p: V3; v: V3 } // threw a grenade (server rate-limits to GRENADE.cooldown and relays it)
  | { t: 'boom'; p: V3 } // our grenade went off here (server checks it's ours, then does the damage)
  | { t: 'again' } // Survival post-game: ready for another run
  | { t: 'use'; kind: UseKind; id: number } // Survival: buy, take, repair... (the server re-checks range, points and state)
  | { t: 'equip'; slot: number }; // Survival: switch to the gun in this slot

// Server -> client
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'joined'; code: string; mode: GameMode; hostId: number; players: PlayerInfo[]; spawn: { p: V3; yaw: number }; wave?: WaveInfo }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number; hostId: number }
  | { t: 'snapshot'; players: NetPlayerState[]; zombies?: NetZombie[] }
  | { t: 'nade'; id: number; p: V3; v: V3 } // someone else's grenade left their hand
  | { t: 'blast'; id: number; p: V3 } // a grenade exploded here (everyone shows it and takes the shove)
  | { t: 'shot'; id: number; from: V3; to: V3; w?: WeaponId; up?: boolean } // w: Survival gun; up: Pack-a-Punched
  | { t: 'kill'; killer: number; victim: number; cause: DeathCause; dir: V3 }
  | { t: 'respawn'; id: number; p: V3; yaw: number }
  // Survival
  | { t: 'wave'; wave: WaveInfo }
  | { t: 'zombieDied'; id: number; killer: number; headshot: boolean; dir: V3 }
  | { t: 'postgame'; rounds: number; rows: PostRow[]; waiting: number } // game-over board, resent when readiness changes
  | { t: 'hp'; hp: number; from?: V3 } // only to the player concerned; `from` is where the claw came from
  | { t: 'me'; pts: number; jug?: boolean; slots: (Slot | null)[]; cur: number; fill?: number[] } // only to the player concerned; fill: slots that start with a full mag and ammo
  | { t: 'world'; doors: boolean[]; boards: number[]; box: BoxState } // Survival: doors that are open, planks per window, and the Mystery Box
  | { t: 'error'; message: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
