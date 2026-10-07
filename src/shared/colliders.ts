import type { Box } from './collision.ts';
import type { MapData } from './map.ts';

/**
 * The boxes each kind of mover bumps into. A Survival map's doors and window boards change them, so they are rebuilt
 * when that happens (rarely), not every tick.
 * - move: what players and grenades hit: the map, shut doors, and the invisible bars in every window; the Skyline's pad
 *   once its hatch is open, and the lid of every chute into a room that isn't open yet.
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
  const open = openRooms(map, doorsOpen);
  const shut = [...lay.doors.filter((d) => !doorsOpen[d.id]).map((d) => d.box), ...lay.chutes.filter((c) => !open.has(c.room)).map((c) => c.lid)];
  const shot = [...map.boxes, ...shut];
  const move = [...shot, ...lay.barricades.map((b) => b.blocker), ...(doorsOpen[lay.hatch] ? [lay.hatchPad] : [])];
  const zombie = [...shot, ...lay.barricades.filter((b) => (boards[b.id] ?? 0) > 0).map((b) => b.seal)];
  return { move, zombie, shot };
}

/** Rooms you can walk to from the start room through open doors (and archways). */
export function openRooms(map: MapData, doorsOpen: readonly boolean[]): Set<number> {
  const lay = map.survival!;
  const seen = new Set([lay.startRoom]);
  const queue = [lay.startRoom];
  while (queue.length) {
    const a = queue.pop()!;
    for (const l of lay.links) {
      if (l.door >= 0 && !doorsOpen[l.door]) continue;
      const b = l.a === a ? l.b : l.b === a ? l.a : -1;
      if (b >= 0 && !seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return seen;
}
