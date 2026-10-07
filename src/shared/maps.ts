import type { BattleMap, GameMode } from './protocol.ts';
import { FOUNDRY } from './foundry.ts';
import { MAP, type MapData } from './map.ts';
import { RUSTWORKS } from './rustworks.ts';
import { SUMMIT } from './summit.ts';

/** The Battle arenas, in menu order. Survival always plays on the Foundry; Practice on Windward. */
export const BATTLE_MAPS: Record<BattleMap, { name: string; blurb: string; data: MapData }> = {
  windward: { name: 'Windward', blurb: 'Sky islands, surf gorges and a great tree', data: MAP },
  rustworks: { name: 'Rustworks', blurb: 'An abandoned foundry: furnace, conveyor, catwalks', data: RUSTWORKS },
  summit: { name: 'Summit', blurb: 'A snowy peak: ice chute, cable station, a log lodge', data: SUMMIT },
};
export const BATTLE_MAP_IDS = Object.keys(BATTLE_MAPS) as BattleMap[];

export const isBattleMap = (v: unknown): v is BattleMap => typeof v === 'string' && v in BATTLE_MAPS;

/** A random arena, for "Random". Picked once by the host and sent as a concrete id so everyone agrees. */
export const randomBattleMap = (rand: () => number = Math.random): BattleMap => BATTLE_MAP_IDS[Math.floor(rand() * BATTLE_MAP_IDS.length)];

export const mapFor = (mode: GameMode, map: BattleMap = 'windward'): MapData => (mode === 'survival' ? FOUNDRY : BATTLE_MAPS[map].data);
