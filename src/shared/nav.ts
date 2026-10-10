// Zombie navigation without a navmesh: the map is a graph of rooms joined by doorways. A zombie in another room
// than its target heads for the doorway on the shortest route, then through it. Inside a room it just walks straight
// (the zombie AI already hops crates and sidesteps pillars). Rebuilt when a door opens; stateless otherwise.
import type { Vec3 } from './math.ts';
import type { Link, Room, SurvivalLayout } from './layout.ts';

const HOP_COST = 25; // metres of "distance" each doorway adds when ranking who to chase
const UNREACHABLE = 1e4;

/**
 * The room a point stands in, or null (outside, in the yard). Rooms overlap where levels stack: the one with the highest
 * floor-ish `y0` wins (a gantry over the furnace floor, the loft over the stairs' top step), then the smaller (stairs in a hall).
 */
export function roomAt(rooms: readonly Room[], p: Vec3): Room | null {
  let best: Room | null = null;
  for (const r of rooms) {
    if (p.x < r.x0 || p.x > r.x1 || p.z < r.z0 || p.z > r.z1 || p.y < r.y0 || p.y > r.y1) continue;
    if (!best || r.y0 > best.y0 || (r.y0 === best.y0 && (r.x1 - r.x0) * (r.z1 - r.z0) < (best.x1 - best.x0) * (best.z1 - best.z0))) best = r;
  }
  return best;
}

export class Nav {
  /** next[a][b]: the link to take from room a toward room b (-1: none, or already there). */
  private next: number[][] = [];
  private hops: number[][] = [];
  private open: boolean[] = [];

  constructor(private lay: SurvivalLayout) {
    this.setDoors([]);
  }

  /** Which door ids are open: rebuilds the routes. */
  setDoors(open: readonly boolean[]) {
    const n = this.lay.rooms.length;
    const usable = (l: Link) => l.door < 0 || !!open[l.door];
    this.next = [];
    this.hops = [];
    for (let a = 0; a < n; a++) {
      const nx = new Array<number>(n).fill(-1);
      const hp = new Array<number>(n).fill(Infinity);
      // BFS from a, remembering which link we left a by to get to each room.
      hp[a] = 0;
      const queue = [a];
      while (queue.length) {
        const r = queue.shift()!;
        this.lay.links.forEach((l, i) => {
          if (!usable(l) || (l.a !== r && l.b !== r)) return;
          const o = l.a === r ? l.b : l.a;
          if (hp[o] !== Infinity) return;
          hp[o] = hp[r] + 1;
          nx[o] = r === a ? i : nx[r];
          queue.push(o);
        });
      }
      this.next.push(nx);
      this.hops.push(hp);
    }
    // Rooms the horde can currently reach from the start room (where windows are live).
    const from = this.lay.startRoom;
    this.open = this.lay.rooms.map((r) => this.hops[from][r.id] !== Infinity);
  }

  /** Is this room joined to the start room by open doors? Windows in other rooms stay quiet. */
  isOpen(room: number) {
    return !!this.open[room];
  }

  /** The room a point stands in (-1: outside, in the yard). */
  roomAt(p: Vec3): number {
    return roomAt(this.lay.rooms, p)?.id ?? -1;
  }

  /** How far a zombie at `a` is from a player at `b`, counting doorways as detours; huge when walls and shut doors are in the way. */
  cost(a: Vec3, b: Vec3): number {
    const d = Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 1.5;
    const ra = this.roomAt(a);
    const rb = this.roomAt(b);
    if (ra < 0 || rb < 0 || ra === rb) return d;
    const h = this.hops[ra][rb];
    return h === Infinity ? d + UNREACHABLE : d + h * HOP_COST;
  }

  /** The point a zombie at `from` should walk toward to get to `to`. */
  goal(from: Vec3, to: Vec3): Vec3 {
    const ra = this.roomAt(from);
    const rb = this.roomAt(to);
    if (ra < 0 || rb < 0 || ra === rb || this.lay.rooms[ra].base === rb) return to;
    const i = this.next[ra][rb];
    if (i < 0) return to;
    const l = this.lay.links[i];
    const s = l.a === ra ? 1 : -1;
    const nx = l.n.x * s;
    const nz = l.n.z * s;
    const along = (from.x - l.c.x) * nx + (from.z - l.c.z) * nz;
    const lat = (from.x - l.c.x) * -nz + (from.z - l.c.z) * nx;
    // Lined up with the doorway (or already in it): straight through. Otherwise, to a spot in front of it first. A room
    // can wrap round a doorway (a stair shaft standing in the hall), so being past its plane but off to the side isn't "in it".
    if (Math.abs(lat) < l.half * 0.5 || (along > 0 && Math.abs(lat) < l.half + 0.6)) return { x: l.c.x + nx * 2.5, y: l.c.y, z: l.c.z + nz * 2.5 };
    return { x: l.c.x - nx * 2.2, y: l.c.y, z: l.c.z - nz * 2.2 };
  }
}
