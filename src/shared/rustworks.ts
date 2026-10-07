import type { Trigger } from './collision.ts';
import { PLAYER } from './constants.ts';
import { type MapData, type SpawnPoint, box, gate, hook, house, mirror, mirrorTrigger, padTo, span, surfFrame, wedge } from './map.ts';
import { touches } from './collision.ts';
import type { Box } from './collision.ts';

/**
 * "Rustworks": an abandoned foundry hall, open to the sky where the roof fell in. One big concrete floor
 * (96 x 68 m) walled in by brick, so there's no void to fall into; the fun is in what stands on it.
 * Point-symmetric like Windward: one half (z > 0) is authored and rotated 180° for the other.
 *   Furnace      the centrepiece block: a pad from each side throws you onto its roof, a hook hangs above it
 *   Conveyor     a raised belt with wind gates, the speed lane up the middle-right
 *   Press        a hydraulic press you can walk up a ramp onto, a vantage over the hall
 *   Duct Surf    a ventilation A-frame: pad up to the gantry, drop in, surf out into the centre
 *   Catwalk      a long steel walkway at y 6 over the conveyor, with a gate along it
 *   Dock         a loading dock with a slide ramp down into a gate
 *   Control Tower  three storeys of offices with windows on every side and a sniper roof
 */
function buildRustworks(): MapData {
  const half: Box[] = [
    // Perimeter: a brick wall all round (this half builds the back wall and both side walls; the mirror does the rest).
    span(-49, 0, 34, 49, 16, 35, 'wall'),
    span(48, 0, 0, 49, 16, 35, 'wall'),
    span(-49, 0, 0, -48, 16, 35, 'wall'),
    // Back-wall run: a long steel walkway at y 8 over the dock, reached by a ramp at the +x end (the mirror gives
    // the same run along the other wall, entered from the -x end). A wind gate halfway makes it a speed lane.
    span(-47, 7.4, 31.5, 30, 8, 33.5, 'branch'),
    wedge('ramp', 30, 0, 31.5, 46, 8, 33.5, { axis: 'x', rise: -1 }),
    span(-47, 8, 33.1, 30, 9, 33.5, 'cover'), // a rail on the wall side so you don't clip the brick

    // Loading dock (top 3) with a slide ramp down to the hall.
    span(-47, 0, 22, -33, 3, 33, 'floor'),
    wedge('ramp', -33, 0, 24, -21, 3, 31, { axis: 'x', rise: -1 }),
    box(-41, 3.9, 27, 1.8, 1.8, 1.8, 'cover'),
    box(-44, 3.9, 30, 1.8, 1.8, 1.8, 'cover'),

    // Hydraulic press (top 5) and the ramp up its side.
    span(-14, 0, 18, -6, 5, 28, 'wall'),
    wedge('ramp', -6, 0, 19, 4, 5, 23, { axis: 'x', rise: -1 }),
    box(-10, 5.55, 20, 1.1, 1.1, 1.1, 'cover'),

    // Conveyor: a belt on legs (top 1.2), ramped on at the near end.
    span(14, 0, 6, 16.5, 1.2, 30, 'branch'),
    wedge('ramp', 14, 0, 3, 16.5, 1.2, 6, { axis: 'z', rise: 1 }),

    // Catwalk (top 6) over the conveyor, reached by a long steel ramp at the +x wall.
    span(-4, 5.4, 11, 34, 6, 13.5, 'branch'),
    wedge('ramp', 34, 0, 11, 46, 6, 13.5, { axis: 'x', rise: -1 }),

    // Duct Surf: a ventilation A-frame, entered from a gantry (top 11) that a pad throws you onto.
    ...surfFrame('z', -22, 9, 2, 20, 5),
    span(-27, 10, 20, -17, 11, 24, 'branch'),
    padTo(-19, 0, 28.5, { x: -22, y: 11, z: 22 }, 3, 2.5),

    // Control Tower: 3 storeys, doors west and south, a balcony over the south, a parapeted sniper roof.
    ...house(24, 20, 32, 30, 0, 3, ['-x', '-z'], '-z'),
    padTo(40, 0, 25, { x: 28, y: 12, z: 25 }, 4, 2.5),

    // Mezzanine (top 3.5): a deck on posts you reach by a ramp from the north. Run under it for a low,
    // hidden route, or hold it for a mid-height view over the conveyor lane.
    span(0, 3, 16, 12, 3.5, 30, 'floor'),
    wedge('ramp', 4, 0, 10, 8, 3.5, 16, { axis: 'z', rise: 1 }),
    span(0, 0, 16, 0.6, 3, 16.6, 'wall'),
    span(11.4, 0, 16, 12, 3, 16.6, 'wall'),
    span(0, 0, 29.4, 0.6, 3, 30, 'wall'),
    span(11.4, 0, 29.4, 12, 3, 30, 'wall'),
    span(0, 3.5, 16, 3.6, 4.4, 16.4, 'cover'),
    span(8.4, 3.5, 16, 12, 4.4, 16.4, 'cover'), // rails, with the ramp's mouth left open between them
    span(11.6, 3.5, 16, 12, 4.4, 30, 'cover'),
    box(9, 4.3, 27, 1.6, 1.6, 1.6, 'cover'),
    box(2.6, 4.3, 22, 1.6, 1.6, 1.6, 'cover'),

    // Boiler House (west flank): two storeys, doors east and south, a balcony onto the flank, a roof to hold.
    ...house(-46, 4, -36, 14, 0, 2, ['+x', '-z'], '+x'),

    // The silo: a tall blocker that splits the +x flank's sightlines.
    span(35, 0, 2, 41, 9, 8, 'wall'),

    // Cover: crates, a low pipe run, and broken brick partitions.
    box(-8, 0.9, 10, 1.8, 1.8, 1.8, 'cover'),
    box(-8, 1.1, 14, 2.2, 2.2, 2.2, 'cover'),
    box(-32, 0.6, 17, 1.2, 1.2, 1.2, 'cover'),
    box(-2, 1.1, 26, 2.2, 2.2, 2.2, 'cover'),
    box(20, 1.0, 16, 2, 2, 2, 'cover'),
    box(30, 0.9, 38 - 24, 1.8, 1.8, 1.8, 'cover'),
    span(-12, 0, 6, -11.4, 3.5, 12, 'wall'),
    span(2, 0, 30, 2.6, 4, 34, 'wall'),
    span(40, 0, 17, 47, 3.2, 17.6, 'wall'),

    // Grapple rings: over the press hall, over the silo, and above the west flank.
    hook(-3, 13, 16),
    hook(38, 14, 12),
    hook(-30, 12, 8),
  ];

  const halfTriggers: Trigger[] = [
    gate(-22, 0, 24, -21, 4, 31, '-x', 14), // foot of the dock slide
    gate(14, 1.2, 12, 16.5, 4.2, 13, '+z', 16), // conveyor speed lane
    gate(14, 1.2, 23, 16.5, 4.2, 24, '+z', 18),
    gate(8, 6, 11, 9, 9, 13.5, '-x', 16), // along the catwalk
    gate(-14, 8, 31.5, -13, 11, 33.5, '-x', 18), // down the back-wall run
    gate(-27, 11, 19.2, -17, 14, 20.2, '-z', 14), // off the gantry onto the duct
  ];

  // The furnace and the centre are their own mirror image, so they're written once.
  const centreHalf: Box[] = [padTo(12, 0, 0, { x: 4, y: 7, z: 0 }, 2, 2.5), box(9, 0.9, 5, 1.8, 1.8, 1.8, 'cover'), span(18, 0, -1, 19, 3, 5, 'wall')];
  const centre: Box[] = [
    span(-48, -2, -34, 48, 0, 34, 'floor'),
    span(-6, 0, -4, 6, 7, 4, 'wall'), // furnace
    box(0, 7.4, 0, 1.4, 0.8, 1.4, 'cover'),
    hook(0, 17, 0),
    ...centreHalf,
    ...centreHalf.map(mirror),
  ];

  const boxes = [...centre, ...half, ...half.map(mirror)];
  const triggers = [...halfTriggers, ...halfTriggers.map(mirrorTrigger)];
  return {
    name: 'Rustworks',
    boxes,
    triggers,
    decor: [
      { kind: 'stack', pos: { x: -58, y: 0, z: 20 }, radius: 4 },
      { kind: 'stack', pos: { x: 60, y: 0, z: -14 }, radius: 3.2 },
      { kind: 'stack', pos: { x: 8, y: 0, z: -48 }, radius: 3.6 },
    ],
    spawns: spawnSpots(boxes, triggers, 26),
    killY: -40,
  };
}

/**
 * Spawn points spread over every spot you can stand still on: candidate spots on a 2 m grid on top of floors,
 * crates and catwalks (with headroom, away from edges, pads and gates), then farthest-point sampled so no two
 * are close. Deterministic, so the client and the server agree.
 */
function spawnSpots(boxes: readonly Box[], triggers: readonly Trigger[], count: number): SpawnPoint[] {
  const R = PLAYER.halfWidth + 0.15;
  const solid = boxes.filter((b) => b.kind !== 'hook');
  const clear = (x: number, y: number, z: number) =>
    !solid.some((o) => o.min.x < x + R && o.max.x > x - R && o.min.z < z + R && o.max.z > z - R && o.min.y < y + PLAYER.height + 0.2 && o.max.y > y + 0.05) &&
    !triggers.some((t) => touches({ x, y, z }, t) || touches({ x, y: y + 1, z }, t));
  const spots: [number, number, number][] = [];
  for (const b of solid) {
    if (b.ramp || b.kind === 'pad' || b.kind === 'wall' || b.max.y - b.min.y < 0.2) continue;
    for (let x = Math.ceil((b.min.x + 0.9) / 2) * 2; x <= b.max.x - 0.9; x += 2)
      for (let z = Math.ceil((b.min.z + 0.9) / 2) * 2; z <= b.max.z - 0.9; z += 2) if (clear(x, b.max.y + 0.01, z)) spots.push([x, b.max.y + 0.01, z]);
  }
  const d = (a: number[], c: number[]) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const picked = [spots.reduce((a, c) => (c[0] - c[2] < a[0] - a[2] ? c : a))];
  while (picked.length < Math.min(count, spots.length)) {
    let best = spots[0];
    let bestD = -1;
    for (const c of spots) {
      const near = Math.min(...picked.map((p) => d(p, c)));
      if (near > bestD) {
        best = c;
        bestD = near;
      }
    }
    picked.push(best);
  }
  return picked.map(([x, y, z]) => ({ pos: { x, y, z }, yaw: Math.atan2(x, z) }));
}

export const RUSTWORKS = buildRustworks();
