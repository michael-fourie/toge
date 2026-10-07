import type { Box, Trigger } from './collision.ts';
import type { Zone } from './koth.ts';
import { type MapData, type SpawnPoint, box, gate, hook, house, mirror, mirrorTrigger, padTo, span, surfFrame, wedge } from './map.ts';

/**
 * "Crown": the King of the Hill arena. One sky island with the hill in the middle and a team base at each end
 * (Sunset at +Z, Tide at -Z); everything is point-symmetric so neither side has the better hill.
 *
 *   The Crown   a raised plateau (top 3) holding the zone, ramps up from all four sides, chest-high walls and a
 *               monument in the middle so a fight on the hill is close range, not one sniper's view
 *   Main lane   out of the base down a slide ramp into a wind gate: the fastest retake, and the most exposed
 *   Bluff       a high ledge along one flank, reached by a bridge from the base: angles onto the hill, then a ramp down
 *   Gorge surf  a ledge off the other side of the base drops onto a surf A-frame that delivers you beside the hill
 *   Ruin house  a two-storey house off each flank of the hill: cover for the approach, a roof to contest from
 *   Hooks       one over the main lane, one over each flank, one high above the hill to dive in from
 */

/** The hill itself: the circle on the plateau. */
export const CROWN_ZONE: Zone = { x: 0, y: 3, z: 0, r: 8, h: 5 };

function buildCrown(): MapData {
  // ---- One half: the Sunset base (+Z) and everything between it and the hill. ----
  const half: Box[] = [
    // Base island (top 5) with a back wall and short side walls (open at the front corners for the bridges).
    span(-14, 4, 46, 14, 5, 60, 'floor'),
    span(-14, 5, 59.4, 14, 9, 60, 'wall'),
    span(-14, 5, 52, -13.4, 7, 59.4, 'wall'),
    span(13.4, 5, 52, 14, 7, 59.4, 'wall'),
    box(-8, 5.6, 47.5, 1.2, 1.2, 1.2, 'cover'),
    box(8, 5.6, 47.5, 1.2, 1.2, 1.2, 'cover'),

    // Main lane: slide ramp out of the base, crates and broken walls on the way to the hill.
    wedge('ramp', -4, 0, 36, 4, 5, 46, { axis: 'z', rise: 1 }),
    box(-6, 0.9, 26, 1.8, 1.8, 1.8, 'cover'),
    box(7, 1, 22, 2, 2, 2, 'cover'),
    box(-3, 0.6, 19, 1.2, 1.2, 1.2, 'cover'),
    span(-14, 0, 24, -13.4, 2.6, 30, 'wall'),
    span(12, 0, 30, 18, 2.4, 30.6, 'wall'),

    // Bluff: a bridge west from the base onto a long high ledge (top 5), and a ramp down toward the hill.
    span(-24, 4.4, 48, -14, 5, 51, 'branch'),
    span(-34, 0, 18, -24, 5, 52, 'floor'),
    wedge('ramp', -34, 0, 10, -26, 5, 18, { axis: 'z', rise: 1 }),
    box(-27, 5.7, 26, 1.4, 1.4, 1.4, 'cover'),
    box(-32.6, 5.6, 40, 1.2, 1.2, 1.2, 'cover'),
    span(-24.6, 5, 20, -24, 6.1, 30, 'cover'), // a low lip along the inner edge to duck behind
    padTo(-18, 0, 33, { x: -29, y: 5, z: 33 }, 3, 2.5), // back up onto the bluff from the field

    // Gorge surf: a bridge east from the base onto a ledge (top 5), then a surf A-frame down beside the hill.
    span(14, 4.4, 48, 23, 5, 51, 'branch'),
    span(23, 0, 44, 33, 5, 54, 'floor'),
    ...surfFrame('z', 28, 4, 14, 44, 5),

    // Ruin house off the west flank of the hill (its twin sits off the east flank).
    ...house(-32, -5, -22, 5, 0, 2, ['+x', '-z'], '+x'),

    // Grapple rings: over the main lane and over the west flank.
    hook(0, 13, 24),
    hook(-17, 12, 8),
  ];

  const halfTriggers: Trigger[] = [
    gate(-4, 0, 34, 4, 4, 35.5, '-z', 16), // foot of the base ramp: launch toward the hill
    gate(23, 5, 43, 33, 8, 44, '-z', 14), // off the ledge onto the surf
  ];

  // ---- The hill: written once where it is its own mirror image. ----
  const crownHalf: Box[] = [
    wedge('ramp', -3, 0, 10, 3, 3, 16, { axis: 'z', rise: -1 }), // ramp up from the Sunset side
    wedge('ramp', 10, 0, -3, 16, 3, 3, { axis: 'x', rise: -1 }), // and from the east flank
    span(3, 3, 4, 7, 4.1, 4.6, 'cover'), // chest-high walls on the plateau
    span(-6.6, 3, 1, -6, 4.1, 5.5, 'cover'),
    box(5.5, 3.6, -1.5, 1.2, 1.2, 1.2, 'cover'),
  ];
  const centre: Box[] = [
    span(-34, -1, -42, 34, 0, 42, 'floor'), // the island
    span(-10, 0, -10, 10, 3, 10, 'floor'), // the plateau
    span(-1.2, 3, -1.2, 1.2, 6.2, 1.2, 'wall'), // the monument: no seeing straight across the hill
    hook(0, 16, 0), // high above the hill: grapple up, drop in
    ...crownHalf,
    ...crownHalf.map(mirror),
  ];

  // Team spawns on each base, facing the hill. Sunset (team 0) is +Z; Tide's are the mirror image.
  const sunset: SpawnPoint[] = [];
  for (const x of [-10, -5, 0, 5, 10]) for (const z of [52, 56]) sunset.push({ pos: { x, y: 5.01, z }, yaw: 0 });
  const tide: SpawnPoint[] = sunset.map((s) => ({ pos: { x: -s.pos.x, y: s.pos.y, z: -s.pos.z }, yaw: Math.PI }));

  return {
    name: 'Crown',
    boxes: [...centre, ...half, ...half.map(mirror)],
    triggers: [...halfTriggers, ...halfTriggers.map(mirrorTrigger)],
    decor: [],
    spawns: [...sunset, ...tide],
    koth: { zone: CROWN_ZONE, teamSpawns: [sunset, tide] },
    killY: -40,
  };
}

export const CROWN = buildCrown();
