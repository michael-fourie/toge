// Contraptions (Survival): tower-defence gadgets built at the Tinker's Workbench for coins and placed anywhere inside the
// building. Shared: the catalogue, the placement rule (the client's ghost and the server's check must agree) and the
// damage curve. The server runs them (gambol/server/workshop.ts); the client draws them (gambol/client/contraptions.ts).
import { openRooms } from './colliders.ts';
import type { Box } from './collision.ts';
import { SKYLINE } from './constants.ts';
import type { MapData } from './map.ts';
import type { Vec3 } from '../../shared/math.ts';
import { roomAt } from './nav.ts';

export type ContraptionKind = 'spikes' | 'tacks' | 'goo' | 'lobber' | 'zapper' | 'owl';

interface ContraptionDef {
  name: string;
  blurb: string;
  /** Coins (the client-side currency, not Survival points). */
  price: number;
  /** Its paint, and the menu card's accent. */
  color: number;
  /** How far it reaches (flat metres). */
  range: number;
  /** Seconds between goes. */
  every: number;
  /** Damage per hit at round 1 (contraptionDamage scales it up with the rounds). */
  damage: number;
}

/** The catalogue, cheapest first (the menu's order). */
export const CONTRAPTIONS: Record<ContraptionKind, ContraptionDef> = {
  spikes: { name: 'Spike Dispenser', blurb: 'Drops spike piles around itself. Zombies that tread on one get poked until it wears out.', price: 40, color: 0xd9a95f, range: 3.5, every: 4, damage: 25 },
  tacks: { name: 'Tack Spinner', blurb: 'Spins up and sprays tacks all the way round. Short range, hits everything close.', price: 60, color: 0xff8a5a, range: 3.4, every: 1.2, damage: 32 },
  goo: { name: 'Goo Sprayer', blurb: 'Gums zombies up so they slow to a crawl. No damage, and it never slows you.', price: 70, color: 0x8be36a, range: 5.5, every: 0.25, damage: 0 },
  owl: { name: 'Sniper Owl', blurb: 'A sleepy owl with a long rifle: one big shot at the toughest zombie in sight.', price: 90, color: 0xc9a8ff, range: 30, every: 2.5, damage: 170 },
  lobber: { name: 'Bomb Lobber', blurb: 'Lobs a bomb at the nearest zombie. Boom: the whole bunch around it.', price: 100, color: 0xff6b5a, range: 16, every: 3, damage: 130 },
  zapper: { name: 'Zapper Coil', blurb: 'Chain lightning: zaps one zombie and jumps to the next ones close by.', price: 120, color: 0x8fd8ff, range: 7, every: 2, damage: 90 },
};

export const CONTRAPTION_KINDS = Object.keys(CONTRAPTIONS) as ContraptionKind[];

/** Limits and the per-kind details. The server can't check coins (client-side), so it caps how many there can be. */
export const WORKSHOP = {
  perPlayer: 4,
  perLobby: 12,
  buildCooldown: 2, // seconds between builds, per player
  reach: 8, // you place within this many metres of where you stand
  radius: 0.5, // a contraption's footprint half width...
  height: 1.4, // ...and its height (the clearance it needs)
  spacing: 1.5, // metres between contraptions
  scrapShare: 0.5, // scrapping your own (F) gives back this share of its price
  scrapRange: 1.8,
  perRound: 0.12, // damage grows this much a round (zombies grow faster: they help, they don't win the game)
  sight: 2.5, // short-range kinds only hit zombies within this much height of them
  spikePiles: 3, // piles a dispenser keeps out at once
  spikeCharges: 8, // pokes a pile has in it
  spikeRadius: 0.8,
  spikePoke: 0.5, // seconds between pokes while a zombie stands on it
  gooSlow: 0.4, // a gooed zombie walks at this share of its speed...
  gooFor: 0.6, // ...for this long after it leaves the spray
  bombFlight: 0.9, // seconds a bomb is in the air
  bombRadius: 3,
  bombMinRange: 2, // too close and the lobber can't lob
  zapChain: 4, // further zombies the lightning jumps to
  zapHop: 4, // metres it can jump
  zapFalloff: 0.8, // each jump hits for this share of the last
};

/** Damage per hit for this round. */
export const contraptionDamage = (kind: ContraptionKind, round: number) => Math.round(CONTRAPTIONS[kind].damage * (1 + WORKSHOP.perRound * Math.max(0, round - 1)));

/** What placement needs to know: the map, what's solid for players right now, open doors and the contraptions already out. */
export interface PlaceCtx {
  map: MapData;
  boxes: readonly Box[];
  doorsOpen: readonly boolean[];
  others: readonly { pos: Vec3 }[];
}

const covers = (b: Box, x: number, z: number) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
/** Things you can't stand a contraption on: launch pads and the workbenches. */
const noBase = (b: Box) => !!b.ramp || !!b.launch || b.kind === 'pad' || b.kind === 'cover';

/** The flat top under (x, z) that a ray hit at `hit` lands on: the highest one at or just below it. Null over nothing. */
export function floorUnder(hit: Vec3, boxes: readonly Box[]): Vec3 | null {
  let top = -Infinity;
  for (const b of boxes) if (!b.ramp && covers(b, hit.x, hit.z) && b.max.y <= hit.y + 0.1 && b.max.y > top) top = b.max.y;
  return top === -Infinity ? null : { x: hit.x, y: top, z: hit.z };
}

/** Why a contraption can't stand at `p` (its base, on a floor), or null when it can. The client's ghost and the server agree. */
export function placeProblem(p: Vec3, c: PlaceCtx): string | null {
  const lay = c.map.survival;
  if (!lay) return 'No workshop here';
  if (p.y >= SKYLINE.roofY - 1) return 'Not on the roof';
  const room = roomAt(lay.rooms, p);
  if (!room) return 'Only inside the building';
  if (!openRooms(c.map, c.doorsOpen).has(room.id)) return 'Open that room first';
  const r = WORKSHOP.radius;
  for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
    const x = p.x + dx;
    const z = p.z + dz;
    if (!c.boxes.some((b) => !noBase(b) && covers(b, x, z) && Math.abs(b.max.y - p.y) < 0.05)) return 'Needs flat floor';
  }
  const blocked = c.boxes.some(
    (b) => b.min.x < p.x + r && b.max.x > p.x - r && b.min.z < p.z + r && b.max.z > p.z - r && b.min.y < p.y + WORKSHOP.height && b.max.y > p.y + 0.05,
  );
  if (blocked) return 'Something is in the way';
  if (c.others.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < WORKSHOP.spacing && Math.abs(o.pos.y - p.y) < 2)) return 'Too close to another contraption';
  return null;
}
