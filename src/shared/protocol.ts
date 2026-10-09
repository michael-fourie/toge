// Wire protocol. JSON for the prototype; swap to a binary encoding once the shape settles.

import type { ContraptionKind } from './contraptions.ts';
import type { KothState } from './koth.ts';
import type { ModId } from './modifiers.ts';
import type { PerkId } from './perks.ts';
import type { LootItem, ZoneState } from './royale.ts';
import type { Team, Winner } from './teams.ts';
import type { Slot, WeaponId } from './weapons.ts';
import type { JobId } from './zombie.ts';

export type V3 = [number, number, number];

/** The Battle arenas (shared/maps.ts). */
export type BattleMap = 'windward' | 'rustworks' | 'summit' | 'dunevillage';

/** Battle: free-for-all snipers. Survival: co-op against rounds of zombies. */
export type GameMode = 'battle' | 'survival';

export interface LobbyInfo {
  code: string;
  mode: GameMode;
  /** Battle only: two teams instead of free-for-all. */
  teams?: boolean;
  /** Battle only: which arena. */
  map?: BattleMap;
  /** Battle teams: King of the Hill (always on Crown) instead of a kill race. */
  koth?: boolean;
  /** Battle: Battle Royale (always on Wildmere), last one standing. */
  br?: boolean;
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
  /** Equipped loot (shared/items.ts gear code): rifle paint, knife, hat, face, back. */
  gear?: string;
  /** Survival: down and waiting for a revive (still on the map, can't move or shoot). */
  down?: boolean;
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

/** Knife: holding the knife instead of a gun. */
export const StateFlag = { Wallrun: 1, Sliding: 2, Knife: 4 } as const;

/** A zombie inside a snapshot. Flags: ZombieFlag. */
export interface NetZombie {
  id: number;
  p: V3;
  yaw: number;
  f: number;
  /** Bosses only: health left, 0..1 (for the boss bar). */
  hp?: number;
  /** A zombie with a job: its outfit. */
  j?: JobId;
}

export const ZombieFlag = { Clawing: 1, Crouching: 2, Boss: 4 } as const;

/** A zombie a shot hit (a shotgun blast can hit several). */
export interface ZombieHit {
  z: number;
  h?: boolean;
}

export type UseKind = 'door' | 'wall' | 'box' | 'take' | 'punch' | 'jug' | 'board' | 'perk' | 'revive' | 'power' | 'part' | 'bench' | 'tinker' | 'scrap' | 'loot';

/** A contraption someone built (Survival): what it is, where it stands (its base), which way it faces, whose it is. */
export interface NetContraption {
  id: number;
  k: ContraptionKind;
  p: V3;
  yaw: number;
  owner: number;
}

/**
 * Something a contraption just did, for the client to animate. pile/pileGone: a spike pile `n` appeared at p[0] or wore
 * out; tacks: a spray all round; goo: a squirt at p[0]; bomb: lobbed at p[0] (it lands after WORKSHOP.bombFlight);
 * zap: lightning through p[0], p[1], ...; owl: a shot at p[0].
 */
export type ContraptionFx = 'pile' | 'pileGone' | 'tacks' | 'goo' | 'bomb' | 'zap' | 'owl';

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
  /** A boss round (every BOSS.every rounds). */
  boss?: boolean;
  /** This round's modifier (every few rounds; modifiers.ts). */
  mod?: ModId;
}

/** The Foundry's changing parts: open doors, planks per window, the Mystery Box, the power, the scythe parts found and the scythe (0: not built, -1: on the bench, else who carries it). */
export interface WorldState {
  doors: boolean[];
  boards: number[];
  box: BoxState;
  power: boolean;
  parts: boolean[];
  scythe: number;
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

export type DeathCause = 'snipe' | 'headshot' | 'void' | 'zombie' | 'grenade' | 'knife' | 'shot' | 'zone';

/**
 * Battle Royale: warmup (everyone runs about with respawns while friends join; `left` seconds to go), live (no
 * respawns; `n` players started) or over (a winner is being shown).
 */
export interface RoyaleInfo {
  phase: 'warmup' | 'live' | 'over';
  left: number;
  n: number;
}

// Client -> server
export type ClientMsg =
  | { t: 'state'; p: V3; v: V3; yaw: number; pitch: number; f: number; g?: V3 }
  | { t: 'shoot'; from: V3; to: V3; victim?: number; headshot?: boolean; hits?: ZombieHit[]; knife?: boolean; ph?: number } // knife: a stab, not a gun shot; ph: Royale, pellets that hit the victim
  | { t: 'fell' }
  | { t: 'nade'; p: V3; v: V3 } // threw a grenade (server rate-limits to GRENADE.cooldown and relays it)
  | { t: 'boom'; p: V3 } // our grenade went off here (server checks it's ours, then does the damage)
  | { t: 'again' } // Survival post-game: ready for another run
  | { t: 'use'; kind: UseKind; id: number } // Survival: buy, take, repair... Royale: pick up loot (the server re-checks range, points and state)
  | { t: 'equip'; slot: number } // Survival and Royale: switch to the gun in this slot
  | { t: 'team'; team: Team } // Battle teams: switch to this side
  | { t: 'shuffle' } // Battle teams: host only, randomise everyone's side
  | { t: 'build'; k: ContraptionKind; p: V3; yaw: number } // Survival: put a contraption here (the client already paid the coins)
  | { t: 'sync' }; // Royale: the game screen opened; resend the loot and what I carry (missed while in the lobby room)

// Server -> client
export type ServerMsg =
  | { t: 'welcome'; id: number }
  | { t: 'joined'; code: string; mode: GameMode; hostId: number; teams?: boolean; map?: BattleMap; koth?: boolean; br?: RoyaleInfo; players: PlayerInfo[]; spawn: { p: V3; yaw: number }; wave?: WaveInfo }
  | { t: 'playerJoined'; player: PlayerInfo }
  | { t: 'playerLeft'; id: number; hostId: number }
  | { t: 'snapshot'; players: NetPlayerState[]; zombies?: NetZombie[]; koth?: KothState; zone?: ZoneState }
  | { t: 'nade'; id: number; p: V3; v: V3 } // someone else's grenade left their hand
  | { t: 'blast'; id: number; p: V3 } // a grenade exploded here (everyone shows it and takes the shove)
  | { t: 'shot'; id: number; from: V3; to: V3; w?: WeaponId; up?: boolean } // w: Survival gun; up: Pack-a-Punched
  | { t: 'kill'; killer: number; victim: number; cause: DeathCause; dir: V3 }
  | { t: 'respawn'; id: number; p: V3; yaw: number }
  // Battle teams and matches
  | { t: 'teams'; players: { id: number; team: Team; color: number }[] } // new sides (a switch or a shuffle)
  | { t: 'matchOver'; winner: Winner; players: PlayerInfo[]; restartIn: number } // someone hit the kill limit
  | { t: 'matchStart'; players: PlayerInfo[] } // scores zeroed, everyone respawns (a `respawn` follows for each)
  // Survival
  | { t: 'wave'; wave: WaveInfo }
  | { t: 'zombieDied'; id: number; killer: number; headshot: boolean; dir: V3; boss?: boolean; job?: JobId; by?: ContraptionKind } // a boss: everyone gets the coins; a Stoker bursts; by: the killer's contraption did it
  | { t: 'postgame'; rounds: number; rows: PostRow[]; waiting: number } // game-over board, resent when readiness changes
  | { t: 'hp'; hp: number; from?: V3; sh?: number } // only to the player concerned; `from` is where the claw (or shot) came from; sh: Royale shield
  | { t: 'me'; pts: number; jug?: boolean; perks?: PerkId[]; slots: (Slot | null)[]; cur: number; fill?: number[]; rounds?: (number | null)[]; nades?: number } // only to the player concerned; fill: slots that start with a full mag and ammo (Royale: with `rounds[i]` rounds in all)
  | { t: 'downed'; id: number; bleed: number; self?: number } // went down: `bleed` seconds to be revived; `self`: Second Wind gets them up after this long
  | { t: 'reviving'; id: number; by: number; prog: number } // a teammate is reviving them (prog 0..1; 0 = they let go)
  | { t: 'revived'; id: number } // back on their feet
  | { t: 'drop'; id: number; p: V3; life: number } // a Max Ammo appeared here; it fades after `life` seconds
  | { t: 'maxAmmo'; id: number; by: number } // someone grabbed it: every player's guns are full
  | { t: 'dropGone'; id: number } // it faded
  | ({ t: 'world' } & WorldState) // Survival: the building as it is now
  | { t: 'contraptions'; list: NetContraption[]; piles: { n: number; p: V3 }[] } // Survival: every contraption (and spike pile) there is, on any change
  | { t: 'cfx'; id: number; fx: ContraptionFx; p?: V3[]; n?: number } // a contraption did something
  | { t: 'refund'; k: ContraptionKind; share: number; why: string } // only to the builder: give back this share of its coin price (refused, or scrapped)
  // Battle Royale
  | { t: 'royale'; info: RoyaleInfo } // the match changed phase (or the warmup clock moved)
  | { t: 'loot'; items: LootItem[]; reset?: boolean } // loot appeared (reset: this is all of it now)
  | { t: 'looted'; id: number; by: number } // someone took it
  | { t: 'ammo'; add: number[] } // only to the player concerned: rounds added to each gun slot's spare ammo
  | { t: 'error'; message: string };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
