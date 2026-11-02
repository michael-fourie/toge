import type { Box, Trigger } from './collision.ts';
import { type MapData, box, gate, hook, house, mirror, mirrorTrigger, padTo, span, surfFrame, wedge } from './map.ts';
import { spawnSpots } from './rustworks.ts';

/** The plaza well sits at the origin; the renderer dresses this box as its stone curb, with posts and a little roof. */
export const WELL = { half: 1.2, h: 1 };

/** Market stall: a timber counter (cover) under a cloth awning you can hop across from the balconies. */
const stall = (x: number, z: number): Box[] => [box(x, 0.55, z - 1, 3, 1.1, 1, 'cover'), span(x - 1.8, 3.2, z - 1.6, x + 1.8, 3.4, z + 1.6, 'branch')];

/** A palm: a trunk you can wallrun round (the fronds are drawn by the renderer on top). */
const palm = (x: number, z: number, h = 7): Box => box(x, h / 2, z, 1, h, 1, 'trunk');

/**
 * "Dune Village": a sunbaked market town inside a sandstone town wall (100 x 70 m), so there's no void to
 * fall into. Point-symmetric like Rustworks: one half (z > 0) is authored and rotated 180° for the other.
 *   Plaza        the well in the middle under a little roof, palms and crates, a grapple ring high above
 *   Aqueduct     a dry aqueduct on arches along each side of the plaza: its glazed-tile A-frame is the surf,
 *                entered off the Cistern Tower (pad up, the gate on top throws you onto the ridge)
 *   Market Street  stalls with cloth awnings between two houses, a ring above to swing roof to roof
 *   Houses       a three-storey house (west) and a two-storey one (east), stairs inside, sniper roofs
 *   Gatehouse    two towers either side of the town gate; pads up from the street, pads on to the house roofs
 *   Town Wall    a walkway along the top (stairs at one end, the Dune at the other) with a crumbled breach
 *   Dune         sand drifted against the wall corner: slide down it into a two-gate run along the flank
 */
function buildDuneVillage(): MapData {
  const half: Box[] = [
    // Town wall: a high outer face all round (this half builds the back wall and both side walls; the mirror does the rest),
    // and a 2.5 m deep wall body whose top (y 7) is the walkway. The breach is where it crumbled to y 3.
    span(-50, 0, 34, 50, 11, 35, 'wall'),
    span(49, 0, 0, 50, 11, 34, 'wall'),
    span(-50, 0, 0, -49, 11, 34, 'wall'),
    span(-49, 0, 31.5, -23, 7, 34, 'wall'),
    span(-23, 0, 31.5, -20, 3, 34, 'wall'), // the breach: jump it along the walkway, or climb the rubble to it
    span(-20, 0, 31.5, 49, 7, 34, 'wall'),
    wedge('ramp', -23, 0, 27, -20, 3, 31.5, { axis: 'z', rise: 1 }), // rubble slope up into the breach
    // Stairs up to the walkway at the west end: a ramp along the wall onto a stair tower.
    wedge('ramp', -46, 0, 29, -36, 7, 31.5, { axis: 'x', rise: -1 }),
    span(-49, 0, 29, -46, 7, 31.5, 'wall'),
    // Merlons along the walkway's inner edge: something to duck behind up there.
    ...[-40, -30, -14, 16, 24, 32].map((x) => box(x, 7.5, 31.95, 1.4, 1, 0.9, 'cover')),

    // The Dune: sand drifted against the east corner, a slide from the walkway down into the flank run.
    wedge('ramp', 38, 0, 12, 49, 7, 31.5, { axis: 'z', rise: 1 }),

    // Gatehouse: two towers (top 10) either side of the town gate, joined over the arch by a sandstone lintel.
    span(-10, 0, 25, -3, 10, 31.5, 'wall'),
    span(3, 0, 25, 10, 10, 31.5, 'wall'),
    span(-3, 8, 25, 3, 10, 31.5, 'wall'),
    padTo(-5.5, 0, 22, { x: -5, y: 10, z: 28.5 }, 2.5, 2),
    padTo(5.5, 0, 22, { x: 5, y: 10, z: 28.5 }, 2.5, 2),
    padTo(-8.5, 10, 26.5, { x: -27, y: 12, z: 20 }, 3, 2), // west tower -> the tall house's roof
    padTo(8.5, 10, 26.5, { x: 21.5, y: 8, z: 20 }, 2, 2), // east tower -> the small house's roof
    box(-4, 10.5, 30.6, 1.2, 1, 1.2, 'cover'),
    box(4, 10.5, 30.6, 1.2, 1, 1.2, 'cover'),

    // Houses: the tall one (3 storeys, roof 12) and the small one (2 storeys, roof 8), both with balconies over the street.
    ...house(-34, 14, -24, 26, 0, 3, ['-x', '-z'], '+x'),
    ...house(18, 15, 28, 26, 0, 2, ['-x', '-z'], '-z'),

    // Market Street: stalls under awnings, crates and pots.
    ...stall(-16, 19),
    ...stall(-10, 15.5),
    ...stall(11, 15.5),
    ...stall(13, 21.5),
    box(-2, 0.6, 15, 1.2, 1.2, 1.2, 'cover'),
    box(-0.6, 0.45, 15.6, 0.9, 0.9, 0.9, 'cover'),
    box(1, 0.9, 25.5, 1.8, 1.8, 1.8, 'cover'),

    // Cistern Tower (top 13): the clay-jar water tower at the head of the aqueduct.
    span(-26, 0, 6, -22, 13, 10, 'wall'),
    padTo(-28, 0, 3, { x: -24.5, y: 13, z: 8 }, 2.5, 2),
    box(-25.4, 13.6, 6.6, 1, 1.2, 1, 'cover'),
    // The Aqueduct: a glazed-tile A-frame (ridge y 10) on sandstone arches over a shady arcade.
    ...surfFrame('x', 8, 10, -22, 14, 4.5),
    ...[-17, -7, 3, 12].map((x) => span(x - 0.6, 0, 7.3, x + 0.6, 10 - 4.5 * Math.tan((55 * Math.PI) / 180), 8.7, 'wall')),

    // West flank (the far end of the other half's Dune run): palms by the wall, a low wall and pots.
    palm(-47.6, 7),
    palm(-47.6, 19, 8),
    palm(-36, 4, 6.5),
    span(-38, 0, 12, -37.2, 1.1, 20, 'cover'),
    box(-36.5, 0.5, 26, 1, 1, 1, 'cover'),
    // East side: palms, a mud-brick wall and crates between the small house and the Dune.
    palm(33, 21, 8),
    palm(35.5, 6),
    span(30, 0, 12, 36, 1.1, 12.8, 'cover'),
    box(31.5, 0.9, 28, 1.8, 1.8, 1.8, 'cover'),
    box(33.2, 0.6, 28.6, 1.2, 1.2, 1.2, 'cover'),

    // Grapple rings: over Market Street (roof to roof), over the Dune's foot, and above the west flank.
    hook(-2, 17, 19),
    hook(43, 14, 4),
    hook(-42, 13, 14),
  ];

  const halfTriggers: Trigger[] = [
    gate(-23, 13, 6, -22, 16, 10, '+x', 14), // off the Cistern Tower onto the aqueduct ridge
    gate(38, 0, 9, 49, 4, 10, '-z', 16), // the Dune run
    gate(38, 0, 1, 49, 4, 2, '-z', 18),
  ];

  // The plaza is its own mirror image, so it's written once.
  const plazaHalf: Box[] = [
    palm(12, 2.2, 7.5),
    box(-7, 0.6, 2.6, 1.2, 1.2, 1.2, 'cover'),
    box(-8.3, 0.5, 3.1, 1, 1, 1, 'cover'),
    span(20, 0, -2, 20.8, 1.1, 4, 'cover'),
    box(30, 0.9, 1, 1.8, 1.8, 1.8, 'cover'),
  ];
  const centre: Box[] = [
    span(-50, -2, -35, 50, 0, 35, 'floor'),
    box(0, WELL.h / 2, 0, WELL.half * 2, WELL.h, WELL.half * 2, 'cover'), // the well
    span(-1.7, 3.3, -1.7, 1.7, 3.6, 1.7, 'branch'), // its roof
    hook(0, 15, 0),
    ...plazaHalf,
    ...plazaHalf.map(mirror),
  ];

  const boxes = [...centre, ...half, ...half.map(mirror)];
  const triggers = [...halfTriggers, ...halfTriggers.map(mirrorTrigger)];
  return { name: 'Dune Village', boxes, triggers, decor: [], spawns: spawnSpots(boxes, triggers, 26), killY: -40 };
}

export const DUNE_VILLAGE = buildDuneVillage();
