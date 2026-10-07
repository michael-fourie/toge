import type { Box, Trigger } from './collision.ts';
import type { Vec3 } from './math.ts';
import { type MapData, box, gate, hook, house, mirror, mirrorTrigger, padTo, puff, span, surfFrame, wedge } from './map.ts';
import { spawnSpots } from './rustworks.ts';

/**
 * "Summit": a snowy mountain top poking out of a sea of clouds (~98 x 68 m). The plateau's edges are open:
 * step off and you fall into the clouds (killY), so nothing can trap you.
 * Point-symmetric like Rustworks: one half (z > 0) is authored and rotated 180° for the other.
 *   The Ridge    a rock spine across the middle (top 5) splitting the halves; slide ramps run off it into gates
 *   The Peak     the summit nook on the ridge (top 10): a pad from the ridge throws you up, a hook hangs above
 *   Ice Chute    a gully down the west flank with an ice A-frame in it: drop off the Cornice and surf it out
 *   Cable Station  a timber deck (top 6) with a gate-boosted run that leaps onto the Cornice ramp
 *   The Lodge    two storeys of logs, doors west and south, a balcony, a snowy sniper roof (pad up)
 *   Icefall      two ice walls with a puffball between them: bounce, catch the ice, wallrun
 *   The Crag     snowy rock shelves stepping up in the back corner
 */
function buildSummit(): MapData {
  const half: Box[] = [
    // The snowfield: everything east of the gully (the mirror makes the other half).
    span(-33, -8, 0, 48, 0, 34, 'floor'),

    // Ice Chute: a gully (floor -6) walled by rock, an ice A-frame down its middle, a ramp out at the far end.
    span(-47, -8, 0, -33, -6, 30, 'floor'),
    span(-49, -8, 0, -47, 2, 30, 'wall'), // outer lip: the mountain's edge
    ...surfFrame('z', -40, 2, 10, 30, 5),
    wedge('ramp', -47, -6, 0, -33, 0, 8, { axis: 'z', rise: -1 }), // walk (or slide) out of the gully
    // The Cornice (top 6) at the head of the gully, a ramp up to it, and a rock wall at its outer end.
    span(-49, -8, 30, -33, 6, 34, 'floor'),
    wedge('ramp', -33, 0, 30, -21, 6, 34, { axis: 'x', rise: -1 }),
    span(-49, 6, 30, -47, 9, 34, 'wall'),

    // Cable Station: a rock plinth with a timber deck (top 6), a ramp up, and the bullwheel house.
    span(-20, 0, 29, -4, 5.6, 34, 'floor'),
    span(-20, 5.6, 29, -4, 6, 34, 'branch'),
    wedge('ramp', -4, 0, 29, 8, 6, 34, { axis: 'x', rise: -1 }),
    span(-14, 6, 32, -10, 10, 34, 'wall'),

    // Ridge slide ramps (the mirror puts the other two on the far face).
    wedge('ramp', 12, 0, 3, 18, 5, 13, { axis: 'z', rise: -1 }),
    wedge('ramp', -18, 0, 3, -12, 5, 13, { axis: 'z', rise: -1 }),

    // The Lodge: 2 storeys, doors west and south, a balcony over the south door, a parapeted roof (top 8).
    ...house(22, 18, 30, 28, 0, 2, ['-x', '-z'], '-z'),
    padTo(33, 0, 25, { x: 26.5, y: 8, z: 24 }, 4.5),

    // Icefall: two ice walls 8 m apart, lined up with the far side's surf exit.
    span(35, 0, 6, 36, 7, 20, 'wall'),
    span(44, 0, 6, 45, 7, 20, 'wall'),

    // The Crag: shelves you can hop up (1.2 m each).
    span(36, 0, 24, 48, 1.2, 34, 'floor'),
    span(40, 1.2, 27, 48, 2.4, 34, 'floor'),
    span(44, 2.4, 30, 48, 3.6, 34, 'floor'),

    // The Tor: a rock outcrop by the gully, a boulder to hop up it.
    span(-29, 0, 10, -23, 2.4, 17, 'floor'),
    box(-22.2, 0.6, 13.5, 1.4, 1.2, 1.4, 'cover'),

    // Pines (trunks block; the snowy boughs are drawn above head height).
    box(-8, 3.5, 21, 1, 7, 1, 'trunk'),
    box(5, 3.5, 23, 1, 7, 1, 'trunk'),
    box(-27, 3.5, 24, 1, 7, 1, 'trunk'),
    box(21, 3.5, 9, 1, 7, 1, 'trunk'),
    box(-30, 3.5, 5, 1, 7, 1, 'trunk'),
    box(33, 3.5, 30, 1, 7, 1, 'trunk'),

    // Boulders and snowdrifts.
    box(-4, 1, 10, 2, 2, 2, 'cover'),
    box(27, 0.9, 11, 1.8, 1.8, 1.8, 'cover'),
    box(-19, 1, 19, 2.2, 2, 2.2, 'cover'),
    box(2, 0.6, 16, 3.2, 1.2, 1.4, 'cover'),
    box(-12, 0.6, 7, 1.4, 1.2, 3.2, 'cover'),
    box(14, 0.6, 22, 3, 1.2, 1.4, 'cover'),
    box(28, 0.9, 1.5, 1.8, 1.8, 1.8, 'cover'),

    // Grapple rings: over the gully (a way out), over Icefall, over the middle.
    hook(-40, 13, 20),
    hook(40, 15, 13),
    hook(-10, 15, 17),
  ];

  const halfTriggers: Trigger[] = [
    gate(12, 0, 13.5, 18, 4, 14.5, '+z', 15), // feet of the ridge ramps
    gate(-18, 0, 13.5, -12, 4, 14.5, '+z', 15),
    gate(-8, 6, 29, -7, 9, 32, '-x', 15), // the cable station run
    gate(-17, 6, 29, -16, 9, 32, '-x', 18),
    gate(-46, 6, 29, -34, 10, 30, '-z', 14), // off the Cornice onto the ice
    puff(40, 0, 9, 4.5), // Icefall: bounce up between the walls
  ];

  // The Ridge and the Peak are their own mirror image, so they're written once.
  const centreHalf: Box[] = [
    padTo(10, 5, 0, { x: 2, y: 10, z: 0 }, 2.5), // ridge -> summit
    span(-4, 10, 2.3, -0.5, 10.9, 3, 'cover'), // the summit nook's rocky rim
  ];
  const centre: Box[] = [
    span(-22, 0, -3, 22, 5, 3, 'floor'), // the ridge, top 5
    span(-4, 5, -3, 4, 10, 3, 'floor'), // the peak, top 10
    hook(0, 20, 0),
    ...centreHalf,
    ...centreHalf.map(mirror),
  ];

  const boxes = [...centre, ...half, ...half.map(mirror)];
  const triggers = [...halfTriggers, ...halfTriggers.map(mirrorTrigger)];
  return { name: 'Summit', boxes, triggers, decor: [], spawns: spawnSpots(boxes, triggers, 26), killY: -14 }; // well above the visual mountainside below the cliffs, so nobody is seen falling through it
}

export const SUMMIT = buildSummit();

/** Where each cable station's haul rope leaves the bullwheel house, and which way it runs down the mountain (visual only). */
export const CABLEWAYS: { from: Vec3; dir: Vec3 }[] = [
  { from: { x: -12, y: 9.5, z: 33.5 }, dir: { x: 0, y: 0, z: 1 } },
  { from: { x: 12, y: 9.5, z: -33.5 }, dir: { x: 0, y: 0, z: -1 } },
];
