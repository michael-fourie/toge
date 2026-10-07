import type { GameMode } from './protocol.ts';
import { FOUNDRY } from './foundry.ts';
import { MAP, type MapData } from './map.ts';

/** Battle and practice are played on Windward in daylight; Survival on the Foundry at night. */
export const mapFor = (mode: GameMode): MapData => (mode === 'survival' ? FOUNDRY : MAP);
