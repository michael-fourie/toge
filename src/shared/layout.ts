// What a Survival map adds on top of plain geometry: rooms, purchasable doors, boardable windows (where the horde
// breaks in), wall guns, the Mystery Box spots and the two stations. Types only; foundry.ts builds one.
import type { Box } from './collision.ts';
import type { Vec3 } from './math.ts';
import type { SpawnPoint } from './map.ts';
import type { PerkId } from './perks.ts';
import type { WeaponId } from './weapons.ts';

/** A walkable region, as a floor-plan rectangle plus the heights it covers (a mezzanine shares its footprint with the hall below). */
export interface Room {
  id: number;
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  /** A ramp or staircase over part of another room's floor: heading for that room, a zombie on it just walks off the side. */
  base?: number;
}

/** A way between two rooms: a doorway centred on `c` whose axis `n` points from room `a` to room `b`. */
export interface Link {
  a: number;
  b: number;
  /** The door that must be open for this link to count, or -1 for an open archway. */
  door: number;
  c: Vec3;
  n: { x: number; z: number };
  half: number;
}

export interface Door {
  id: number;
  name: string;
  price: number;
  /** Solid while the door is shut. */
  box: Box;
  rooms: [number, number];
}

/** A boarded-up opening in an outside wall. Zombies tear the boards off and climb in; players nail them back. */
export interface Barricade {
  id: number;
  room: number;
  /** Centre of the opening on the wall plane (floor level). */
  pos: Vec3;
  /** Unit vector pointing out of the building. */
  out: { x: number; z: number };
  width: number;
  /** Zombies are stopped by this while any board is up. */
  seal: Box;
  /** Players are always stopped by this, even once the boards are gone. */
  blocker: Box;
  /** Where a zombie stands to tear boards, and where it ends up once it is through. */
  outside: Vec3;
  inside: Vec3;
  /** Spots out in the yard where zombies appear for this window. */
  spawns: Vec3[];
}

export interface WallBuy {
  id: number;
  weapon: WeaponId;
  price: number;
  room: number;
  /** Centre of the gun's chalk outline on the wall, and which way the wall faces. */
  pos: Vec3;
  yaw: number;
  /** Where you stand to buy it. */
  at: Vec3;
}

interface BoxSpot {
  pos: Vec3;
  yaw: number;
  room: number;
}

export interface SurvivalLayout {
  rooms: Room[];
  links: Link[];
  doors: Door[];
  barricades: Barricade[];
  wallBuys: WallBuy[];
  boxSpots: BoxSpot[];
  punch: Vec3;
  jug: Vec3;
  /** The other perk machines: where each stands (you buy within reach of it) and how it is turned (`yaw`). */
  perks: { kind: PerkId; pos: Vec3; yaw: number; room: number }[];
  start: SpawnPoint[];
  startRoom: number;
  /** The power switch: perk machines and the Pack-a-Punch are dead (and the lamps dark) until someone throws it. */
  power: { pos: Vec3; yaw: number };
  /** Scythe parts lying in the far rooms, and the workbench where they are put together. */
  parts: { pos: Vec3; room: number }[];
  bench: { pos: Vec3; yaw: number };
  /**
   * The Skyline (roof surf): the door that is its roof hatch, the launch pad under it (live once the hatch is open), and
   * the chutes where the surf lines dive into rooms. A chute's lid stays shut until its room is open.
   */
  hatch: number;
  hatchPad: Box;
  chutes: { room: number; lid: Box }[];
  /** Where the roof's steam vents blow anyone who hangs about up there (or got flung into the yard): high in the Hall, off the pad. */
  vent: Vec3;
  /** The Tinker's Workbench: F opens the contraption menu (contraptions.ts). Its floor centre, and the way its front faces. */
  tinker: { pos: Vec3; yaw: number };
}
