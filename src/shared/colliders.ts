import type { Box } from './collision.ts';
import type { MapData } from './map.ts';

/**
 * The boxes each kind of mover bumps into. A Survival map's doors and window boards change them, so they are rebuilt
 * when that happens (rarely), not every tick.
 * - move: what players and grenades hit: the map, shut doors, and the invisible bars in every window.
 * - zombie: the map, shut doors, and window boards while any are up. Open windows let them through.
 * - shot: what bullets and the grapple hit: the map and shut doors (you can shoot through a window).
 */
export interface Colliders {
  move: Box[];
  zombie: Box[];
  shot: Box[];
}

export function buildColliders(map: MapData, doorsOpen: readonly boolean[] = [], boards: readonly number[] = []): Colliders {
  const lay = map.survival;
  if (!lay) return { move: map.boxes, zombie: map.boxes, shot: map.boxes };
  const shut = lay.doors.filter((d) => !doorsOpen[d.id]).map((d) => d.box);
  const shot = [...map.boxes, ...shut];
  const move = [...shot, ...lay.barricades.map((b) => b.blocker)];
  const zombie = [...shot, ...lay.barricades.filter((b) => (boards[b.id] ?? 0) > 0).map((b) => b.seal)];
  return { move, zombie, shot };
}
